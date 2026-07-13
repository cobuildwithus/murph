import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { resolveHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { signalHostedRuntimeManualWakeBestEffort } from "../hosted-orchestration/manual-wake";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  HOSTED_STANDARD_CHECKOUT_OFFER,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberOwnActiveBillingAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import type { HostedOnboardingReadClient } from "./shared";
import { applyStripeSubscriptionUpdated } from "./stripe-billing-events";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";

export type HostedBillingPlanUpgradeResult =
  | {
    billingPlanCode: "launch_edge_monthly";
    status: "already_on_plan";
  }
  | {
    billingPlanCode: "launch_edge_monthly";
    status: "upgraded";
  }
  | {
    billingPlanCode: "launch_monthly";
    billingPortalUrl: string;
    status: "pending_payment";
  };

export type HostedBillingPlanUpgradePreparation = {
  currentBillingPlanCode: "launch_edge_monthly" | "launch_monthly";
  currentPeriodEnd: Date;
  status: "already_on_plan" | "ready";
};

export async function prepareHostedBillingPlanUpgrade(input: {
  memberId: string;
  prisma?: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradePreparation> {
  const state = await readHostedBillingPlanUpgradeState(input);
  return {
    currentBillingPlanCode: state.currentPlanCode,
    currentPeriodEnd: state.currentPeriodEnd,
    status: state.currentPlanCode === state.targetPlanCode
      ? "already_on_plan"
      : "ready",
  };
}

export async function upgradeHostedBillingPlan(input: {
  expectedCurrentPeriodEnd?: Date;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeResult> {
  const prisma = input.prisma ?? getPrisma();
  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma,
    run: async (tx) => upgradeHostedBillingPlanUnderLock({
      expectedCurrentPeriodEnd: input.expectedCurrentPeriodEnd,
      memberId: input.memberId,
      now: input.now ?? new Date(),
      prisma: tx,
      targetPlanCode: input.targetPlanCode,
    }),
  });
}

async function upgradeHostedBillingPlanUnderLock(input: {
  expectedCurrentPeriodEnd?: Date;
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeResult> {
  const prisma = input.prisma;
  const now = input.now;
  const state = await readHostedBillingPlanUpgradeState({
    memberId: input.memberId,
    prisma,
    targetPlanCode: input.targetPlanCode,
  });
  const targetPlanCode = state.targetPlanCode;
  assertHostedBillingApprovedCurrentPeriodEnd({
    expectedCurrentPeriodEnd: input.expectedCurrentPeriodEnd,
    subscription: state.subscription,
  });
  if (state.currentPlanCode === targetPlanCode) {
    if (state.projectedPlanCode !== targetPlanCode) {
      return await finalizeAppliedHostedBillingPlanUpgrade({
        memberId: input.memberId,
        now,
        prisma,
        stripe: state.stripe,
        stripeSubscriptionId: state.stripeSubscriptionId,
        subscription: state.subscription,
        targetPlanCode,
        targetPriceId: state.targetPriceId,
      });
    }
    return {
      billingPlanCode: targetPlanCode,
      status: "already_on_plan",
    };
  }

  const update = buildHostedBillingPlanUpgradeSubscriptionItems({
    currentPriceId: state.currentPriceId,
    subscription: state.subscription,
    targetPriceId: state.targetPriceId,
  });
  let updatedSubscription: Stripe.Subscription;
  try {
    updatedSubscription = await callHostedStripePlanUpgradeOperation(
      "subscription.update.plan-items",
      () =>
        state.stripe.subscriptions.update(state.stripeSubscriptionId, {
          expand: ["items.data.price"],
          items: update.items,
          payment_behavior: "pending_if_incomplete",
          proration_behavior: "always_invoice",
        }, {
          idempotencyKey: buildHostedBillingPlanUpgradeIdempotencyKey({
            currentPeriodEnd: state.currentPeriodEnd.toISOString(),
            currentPlanCode: state.currentPlanCode,
            currentPriceId: state.currentPriceId,
            currentSubscriptionItemId: update.currentSubscriptionItemId,
            memberId: input.memberId,
            stripeSubscriptionId: state.stripeSubscriptionId,
            targetPlanCode,
            targetPriceId: state.targetPriceId,
          }),
        })
    );
  } catch (error) {
    const reconciledSubscription = await state.stripe.subscriptions.retrieve(
      state.stripeSubscriptionId,
      { expand: ["items.data.price"] },
    ).catch(() => null);
    if (
      !reconciledSubscription ||
      !isHostedStripeSubscriptionAppliedPlan({
        subscription: reconciledSubscription,
        targetPriceId: state.targetPriceId,
      })
    ) {
      throw error;
    }
    updatedSubscription = reconciledSubscription;
  }

  if (!isHostedStripeSubscriptionAppliedPlan({
    subscription: updatedSubscription,
    targetPriceId: state.targetPriceId,
  })) {
    return {
      billingPlanCode: state.currentPlanCode,
      billingPortalUrl: await createHostedBillingPlanUpgradePortalUrl({
        stripe: state.stripe,
        stripeCustomerId: state.stripeCustomerId,
      }),
      status: "pending_payment",
    };
  }

  return await finalizeAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now,
    prisma,
    stripe: state.stripe,
    stripeSubscriptionId: state.stripeSubscriptionId,
    subscription: updatedSubscription,
    targetPlanCode,
    targetPriceId: state.targetPriceId,
  });
}

async function readHostedBillingPlanUpgradeState(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<{
  currentPeriodEnd: Date;
  currentPlanCode: "launch_edge_monthly" | "launch_monthly";
  currentPriceId: string;
  projectedPlanCode: HostedBillingPlanCode | null;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
  targetPriceId: string;
}> {
  const prisma = input.prisma ?? getPrisma();
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma,
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }
  assertHostedMemberOwnActiveBillingAllowed(member);
  if (input.targetPlanCode !== "launch_edge_monthly") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_UNSUPPORTED",
      httpStatus: 400,
      message: "This plan change is not supported.",
    });
  }

  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma,
  });
  const stripeCustomerId = billingRef?.stripeCustomerId ?? null;
  const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;
  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
      message: "Your subscription is not ready for plan changes yet.",
    });
  }

  const pulseConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: "launch_monthly",
  });
  const targetConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: input.targetPlanCode,
  });
  const stripe = targetConfig.stripe;
  const subscription = await callHostedStripePlanUpgradeOperation(
    "subscription.retrieve",
    () => stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ["items.data.price"],
    }),
  );
  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId,
    subscription,
  });

  const targetApplied = isHostedStripeSubscriptionAppliedPlan({
    subscription,
    targetPriceId: targetConfig.priceId,
  });
  const livePulsePlan = isHostedStripeSubscriptionAppliedPlan({
    subscription,
    targetPriceId: pulseConfig.priceId,
  });
  if (subscription.status === "trialing" && livePulsePlan) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TRIAL_UNSUPPORTED",
      httpStatus: 409,
      message: "Finish trial billing before upgrading to Edge.",
    });
  }
  const pulseApplied = subscription.status === "active" && livePulsePlan;
  if (!targetApplied && !pulseApplied) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_STATE_CHANGED",
      httpStatus: 409,
      message: "Your billing plan changed. Review the current plan and try again.",
      retryable: true,
    });
  }

  return {
    currentPeriodEnd: requireHostedBillingPlanUpgradeCurrentPeriodEnd(subscription),
    currentPlanCode: targetApplied ? input.targetPlanCode : "launch_monthly",
    currentPriceId: targetApplied ? targetConfig.priceId : pulseConfig.priceId,
    projectedPlanCode:
      billingRef?.currentBillingPlanCode === "launch_edge_monthly" ||
        billingRef?.currentBillingPlanCode === "launch_monthly"
        ? billingRef.currentBillingPlanCode
        : null,
    stripe,
    stripeCustomerId,
    stripeSubscriptionId,
    subscription,
    targetPlanCode: input.targetPlanCode,
    targetPriceId: targetConfig.priceId,
  };
}

async function finalizeAppliedHostedBillingPlanUpgrade(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
  targetPriceId: string;
}): Promise<{
  billingPlanCode: "launch_edge_monthly";
  status: "upgraded";
}> {
  const cleanedSubscription = await cleanupAppliedHostedBillingPlanUpgradeSubscriptionItems({
    memberId: input.memberId,
    stripe: input.stripe,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription: input.subscription,
    targetPlanCode: input.targetPlanCode,
    targetPriceId: input.targetPriceId,
  });
  const appliedSubscription = await normalizeAppliedHostedBillingPlanUpgradeSubscription({
    memberId: input.memberId,
    stripe: input.stripe,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription: cleanedSubscription,
    targetPlanCode: input.targetPlanCode,
    targetPriceId: input.targetPriceId,
  });

  await reconcileAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription: appliedSubscription,
    targetPlanCode: input.targetPlanCode,
  });
  await signalHostedRuntimeManualWakeBestEffort({
    userId: input.memberId,
  });

  return {
    billingPlanCode: input.targetPlanCode,
    status: "upgraded",
  };
}

function buildHostedBillingPlanUpgradeSubscriptionItems(input: {
  currentPriceId: string;
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): {
  currentSubscriptionItemId: string;
  items: Stripe.SubscriptionUpdateParams.Item[];
} {
  const recurringItem = findHostedStripeSubscriptionItemByPriceId(
    input.subscription,
    input.currentPriceId,
  );

  if (!recurringItem) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEM_NOT_FOUND",
      httpStatus: 409,
      message: "Your current subscription items are not ready for this plan change.",
    });
  }

  const items: Stripe.SubscriptionUpdateParams.Item[] = [
    {
      id: recurringItem.id,
      price: input.targetPriceId,
      quantity: 1,
    },
  ];

  for (const item of input.subscription.items.data) {
    if (item.id === recurringItem.id) {
      continue;
    }

    if (isHostedStripeLegacyAiUsageMeteredItem(item)) {
      items.push({
        deleted: true,
        id: item.id,
      });
      continue;
    }

    throw buildHostedBillingSubscriptionItemsUnsupportedError();
  }

  return {
    currentSubscriptionItemId: recurringItem.id,
    items,
  };
}

async function cleanupAppliedHostedBillingPlanUpgradeSubscriptionItems(input: {
  memberId: string;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
  targetPriceId: string;
}): Promise<Stripe.Subscription> {
  const cleanupItems = buildHostedBillingPlanUpgradeAppliedSubscriptionCleanupItems({
    subscription: input.subscription,
    targetPriceId: input.targetPriceId,
  });

  if (cleanupItems.length === 0) {
    return input.subscription;
  }

  const subscription = await callHostedStripePlanUpgradeOperation(
    "subscription.update.applied-plan-items",
    () =>
      input.stripe.subscriptions.update(
        input.stripeSubscriptionId,
        {
          expand: ["items.data.price"],
          items: cleanupItems,
        },
        {
          idempotencyKey: buildHostedBillingPlanUpgradeAppliedItemsCleanupIdempotencyKey({
            memberId: input.memberId,
            stripeSubscriptionId: input.stripeSubscriptionId,
            targetPlanCode: input.targetPlanCode,
            targetPriceId: input.targetPriceId,
          }),
        },
      ),
  );
  assertHostedBillingPlanUpgradeAppliedSubscriptionItemsClean({
    subscription,
    targetPriceId: input.targetPriceId,
  });
  return subscription;
}

function buildHostedBillingPlanUpgradeAppliedSubscriptionCleanupItems(input: {
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): Stripe.SubscriptionUpdateParams.Item[] {
  const targetItem = findHostedStripeSubscriptionItemByPriceId(
    input.subscription,
    input.targetPriceId,
  );

  if (!targetItem || !isHostedStripeLicensedMonthlyItem(targetItem)) {
    throw buildHostedBillingSubscriptionItemsUnsupportedError();
  }

  const cleanupItems: Stripe.SubscriptionUpdateParams.Item[] = [];

  for (const item of input.subscription.items.data) {
    if (item.id === targetItem.id) {
      continue;
    }

    if (isHostedStripeLegacyAiUsageMeteredItem(item)) {
      cleanupItems.push({
        deleted: true,
        id: item.id,
      });
      continue;
    }

    throw buildHostedBillingSubscriptionItemsUnsupportedError();
  }

  return cleanupItems;
}

function buildHostedBillingSubscriptionItemsUnsupportedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
    httpStatus: 409,
    message: "Your subscription items are not ready for this plan change.",
  });
}

function buildHostedBillingPlanUpgradeSubscriptionMetadata(input: {
  memberId: string;
  targetPlanCode: "launch_edge_monthly";
}): Stripe.MetadataParam {
  return {
    billingPlanCode: input.targetPlanCode,
    checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    memberId: input.memberId,
    ...buildStripeMetadataUnsetFields([
      "trialDurationDays",
      "trialPolicyVersion",
      "trialUsageLimitUsdMicros",
    ]),
  };
}

function buildStripeMetadataUnsetFields(keys: readonly string[]): Stripe.MetadataParam {
  // Stripe removes individual metadata keys when their update value is an empty string.
  return Object.fromEntries(keys.map((key) => [key, ""]));
}

async function normalizeAppliedHostedBillingPlanUpgradeSubscription(input: {
  memberId: string;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
  targetPriceId: string;
}): Promise<Stripe.Subscription> {
  if (isHostedBillingPlanUpgradeSubscriptionMetadataNormalized(input)) {
    assertHostedBillingPlanUpgradeAppliedSubscriptionItemsClean({
      subscription: input.subscription,
      targetPriceId: input.targetPriceId,
    });
    return input.subscription;
  }

  const subscription = await callHostedStripePlanUpgradeOperation(
    "subscription.update.metadata",
    () =>
      input.stripe.subscriptions.update(input.stripeSubscriptionId, {
        expand: ["items.data.price"],
        metadata: buildHostedBillingPlanUpgradeSubscriptionMetadata({
          memberId: input.memberId,
          targetPlanCode: input.targetPlanCode,
        }),
      }, {
        idempotencyKey: buildHostedBillingPlanUpgradeMetadataRepairIdempotencyKey({
          memberId: input.memberId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          targetPlanCode: input.targetPlanCode,
        }),
      })
  );
  assertHostedBillingPlanUpgradeAppliedSubscriptionItemsClean({
    subscription,
    targetPriceId: input.targetPriceId,
  });
  return subscription;
}

function isHostedBillingPlanUpgradeSubscriptionMetadataNormalized(input: {
  memberId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
}): boolean {
  const metadata = input.subscription.metadata ?? {};

  return metadata.billingPlanCode === input.targetPlanCode &&
    metadata.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER &&
    metadata.memberId === input.memberId &&
    !hasOwnStripeMetadataKey(metadata, "trialDurationDays") &&
    !hasOwnStripeMetadataKey(metadata, "trialPolicyVersion") &&
    !hasOwnStripeMetadataKey(metadata, "trialUsageLimitUsdMicros");
}

function hasOwnStripeMetadataKey(
  metadata: Stripe.Metadata,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, key);
}

function assertHostedStripeSubscriptionMatchesCustomer(input: {
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
}): void {
  const subscriptionCustomerId = coerceStripeObjectId(input.subscription.customer);

  if (subscriptionCustomerId === input.stripeCustomerId) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
    httpStatus: 409,
    message: "Your subscription could not be matched to this hosted account.",
  });
}

function assertHostedBillingApprovedCurrentPeriodEnd(input: {
  expectedCurrentPeriodEnd?: Date;
  subscription: Stripe.Subscription;
}): void {
  if (!input.expectedCurrentPeriodEnd) {
    return;
  }

  const actualCurrentPeriodEnd =
    readHostedStripeObjectDate(input.subscription, "current_period_end") ??
    input.subscription.items.data
      .map((item) => readHostedStripeObjectDate(item, "current_period_end"))
      .find((value): value is Date => value !== null) ??
    null;
  if (
    actualCurrentPeriodEnd &&
    toUnixSeconds(actualCurrentPeriodEnd) === toUnixSeconds(input.expectedCurrentPeriodEnd)
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_APPROVED_PERIOD_CHANGED",
    httpStatus: 409,
    message: "Your billing period changed after approval. Review the current plan and try again.",
  });
}

function requireHostedBillingPlanUpgradeCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): Date {
  const currentPeriodEnd =
    readHostedStripeObjectDate(subscription, "current_period_end") ??
    subscription.items.data
      .map((item) => readHostedStripeObjectDate(item, "current_period_end"))
      .find((value): value is Date => value !== null) ??
    null;
  if (currentPeriodEnd) {
    return currentPeriodEnd;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_CURRENT_PERIOD_END_REQUIRED",
    httpStatus: 409,
    message: "Your current billing period is still syncing. Try again shortly.",
    retryable: true,
  });
}

function readHostedStripeObjectDate(value: object, field: string): Date | null {
  const rawValue = Reflect.get(value, field);
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return null;
  }

  const date = new Date(rawValue * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function findHostedStripeSubscriptionItemByPriceId(
  subscription: Stripe.Subscription,
  priceId: string,
): Stripe.SubscriptionItem | null {
  return subscription.items.data.find((item) => item.price?.id === priceId) ?? null;
}

function isHostedStripeLicensedMonthlyItem(item: Stripe.SubscriptionItem): boolean {
  const recurring = item.price?.recurring;
  return recurring?.interval === "month" &&
    (recurring.interval_count ?? 1) === 1 &&
    recurring.usage_type === "licensed" &&
    !hasUnsupportedHostedStripeSubscriptionItemQuantity(item);
}

function hasHostedStripeSubscriptionItemQuantity(item: Stripe.SubscriptionItem): boolean {
  return typeof item.quantity === "number" && Number.isFinite(item.quantity);
}

function hasUnsupportedHostedStripeSubscriptionItemQuantity(item: Stripe.SubscriptionItem): boolean {
  return hasHostedStripeSubscriptionItemQuantity(item) && item.quantity !== 1;
}

function isHostedStripeSubscriptionAppliedPlan(input: {
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): boolean {
  if (input.subscription.pending_update) {
    return false;
  }

  if (
    input.subscription.status !== "active" &&
    input.subscription.status !== "trialing"
  ) {
    return false;
  }

  const itemPriceIds = new Set(
    input.subscription.items.data
      .map((item) => item.price?.id)
      .filter((priceId): priceId is string => typeof priceId === "string"),
  );

  return itemPriceIds.has(input.targetPriceId);
}

function assertHostedBillingPlanUpgradeAppliedSubscriptionItemsClean(input: {
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): void {
  const cleanupItems = buildHostedBillingPlanUpgradeAppliedSubscriptionCleanupItems(input);
  if (cleanupItems.length > 0) {
    throw buildHostedBillingSubscriptionItemsUnsupportedError();
  }
}

async function reconcileAppliedHostedBillingPlanUpgrade(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
}): Promise<void> {
  await applyStripeSubscriptionUpdated(
    input.subscription,
    buildHostedBillingPlanUpgradeDispatchContext({
      now: input.now,
      stripeSubscriptionId: input.stripeSubscriptionId,
    }),
    input.prisma,
  );

  const gate = await resolveHostedAiUsageGate({
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
  });

  if (gate.billingPlanCode === input.targetPlanCode) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_RECONCILIATION_PENDING",
    httpStatus: 409,
    message: "Your plan change is still syncing. Try again shortly.",
    retryable: true,
  });
}

async function createHostedBillingPlanUpgradePortalUrl(input: {
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<string> {
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const session = await callHostedStripePlanUpgradeOperation(
    "billingPortal.sessions.create",
    () =>
      input.stripe.billingPortal.sessions.create({
        customer: input.stripeCustomerId,
        return_url: new URL("/home", publicBaseUrl).toString(),
      })
  );

  if (!session.url) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      httpStatus: 502,
      message: "Stripe did not return a billing portal URL.",
    });
  }

  return session.url;
}

function buildHostedBillingPlanUpgradeIdempotencyKey(input: {
  currentPeriodEnd: string;
  currentPlanCode: HostedBillingPlanCode;
  currentPriceId: string;
  currentSubscriptionItemId: string;
  memberId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
}): string {
  return `hosted-billing-plan-upgrade:${sha256Hex(JSON.stringify(input))}`;
}

function buildHostedBillingPlanUpgradeMetadataRepairIdempotencyKey(input: {
  memberId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
}): string {
  return `hosted-billing-plan-upgrade-metadata:${sha256Hex(JSON.stringify(input))}`;
}

function buildHostedBillingPlanUpgradeAppliedItemsCleanupIdempotencyKey(input: {
  memberId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
}): string {
  return `hosted-billing-plan-upgrade-applied-items:${sha256Hex(JSON.stringify(input))}`;
}

async function callHostedStripePlanUpgradeOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      details: {
        operationName,
        ...describeSafeStripePlanChangeError(error),
      },
      httpStatus: 502,
      message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  }
}

function describeSafeStripePlanChangeError(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) {
    return {
      type: typeof error,
    };
  }

  const code = Reflect.get(error, "code");
  const stripeParam = parseSafeStripeErrorParam(Reflect.get(error, "param"));
  const statusCode = Reflect.get(error, "statusCode");
  const type = Reflect.get(error, "type");
  const requestId = Reflect.get(error, "requestId");

  return {
    ...(typeof type === "string" && type.length > 0 ? { type } : {}),
    ...(typeof code === "string" && code.length > 0 ? { code } : {}),
    ...(stripeParam ? { stripeParam } : {}),
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    requestIdPresent: typeof requestId === "string" && requestId.length > 0,
  };
}

function parseSafeStripeErrorParam(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    return null;
  }

  return /^[A-Za-z0-9_.\-[\]]+$/u.test(value) ? value : null;
}

function buildHostedBillingPlanUpgradeDispatchContext(input: {
  now: Date;
  stripeSubscriptionId: string;
}): HostedStripeDispatchContext {
  return {
    eventCreatedAt: input.now,
    occurredAt: input.now.toISOString(),
    sourceEventId: `subscription:${input.stripeSubscriptionId}:plan-upgrade`,
    sourceType: "stripe.customer.subscription.updated.inline-plan-upgrade",
  };
}
