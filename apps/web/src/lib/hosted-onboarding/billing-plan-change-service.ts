import { Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { resolveHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { signalHostedRuntimeManualWakeBestEffort } from "../hosted-orchestration/manual-wake";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  canUpgradeHostedBillingPlan,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  isHostedBillingPlanImmediateUpgrade,
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberOwnActiveBillingAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
  requireValidatedHostedStripeBillingPlanConfig,
} from "./runtime";
import { applyStripeSubscriptionUpdated } from "./stripe-billing-events";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";
import {
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
} from "./stripe-error-log";

export type HostedBillingPlanUpgradeResult =
  | {
    billingPlanCode: HostedBillingPlanCode;
    status: "already_on_plan";
  }
  | {
    billingPlanCode: HostedBillingPlanCode;
    status: "upgraded";
  }
  | {
    billingPlanCode: HostedBillingPlanCode;
    paymentUrl: string;
    status: "pending_payment";
  };

export async function upgradeHostedBillingPlan(input: {
  expectedCurrentPlanCode?: HostedBillingPlanCode;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const result = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma,
    run: (tx) =>
      upgradeHostedBillingPlanWithLockedOwner({
        expectedCurrentPlanCode: input.expectedCurrentPlanCode,
        memberId: input.memberId,
        now,
        targetPlanCode: input.targetPlanCode,
        tx,
      }),
  });

  if (result.status === "upgraded") {
    await signalHostedRuntimeManualWakeBestEffort({
      userId: input.memberId,
    });
  }

  return result;
}

async function upgradeHostedBillingPlanWithLockedOwner(input: {
  expectedCurrentPlanCode?: HostedBillingPlanCode;
  memberId: string;
  now: Date;
  targetPlanCode: HostedBillingPlanCode;
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingPlanUpgradeResult> {
  const prisma = input.tx;
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

  const targetPlanCode = input.targetPlanCode;
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma,
  });
  const currentPlanCode = parseHostedBillingPlanCode(billingRef?.currentBillingPlanCode);

  if (currentPlanCode === targetPlanCode) {
    return {
      billingPlanCode: targetPlanCode,
      status: "already_on_plan",
    };
  }
  if (
    input.expectedCurrentPlanCode
    && currentPlanCode !== input.expectedCurrentPlanCode
  ) {
    throw buildHostedBillingPlanUpgradeSourceChangedError();
  }
  if (parseHostedBillingPlanCode(billingRef?.scheduledBillingPlanCode)) {
    throw buildHostedBillingPlanChangeAlreadyScheduledError();
  }

  const transition = {
    currentPlanCode,
    targetPlanCode,
  };
  assertHostedBillingPlanUpgradeAllowed(transition);
  assertHostedBillingPlanUpgradeSourceState({
    billingRef,
    targetPlanCode,
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

  const currentConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: transition.currentPlanCode,
  });
  const targetConfig = await requireValidatedHostedStripeBillingPlanConfig({
    billingPlanCode: targetPlanCode,
  });
  const stripe = targetConfig.stripe;
  const subscription = await callHostedStripePlanUpgradeOperation("subscription.retrieve", () =>
    stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ["items.data.price"],
    })
  );

  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId,
    subscription,
  });

  if (isHostedStripeSubscriptionAppliedPlan({
    subscription,
    targetPriceId: targetConfig.priceId,
  })) {
    return await finalizeAppliedHostedBillingPlanUpgrade({
      memberId: input.memberId,
      now: input.now,
      prisma,
      stripe,
      stripeSubscriptionId,
      subscription,
      targetPlanCode,
      targetPriceId: targetConfig.priceId,
    });
  }
  if (coerceStripeObjectId(subscription.schedule)) {
    throw buildHostedBillingPlanChangeAlreadyScheduledError();
  }

  const updateItems = buildHostedBillingPlanUpgradeSubscriptionItems({
    currentPriceId: currentConfig.priceId,
    subscription,
    targetPriceId: targetConfig.priceId,
  });
  let updateFailure: { error: unknown } | null = null;
  let updatedSubscription = subscription;

  if (!subscription.pending_update) {
    try {
      updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        expand: ["items.data.price"],
        items: updateItems,
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
      }, {
        idempotencyKey: buildHostedBillingPlanUpgradeIdempotencyKey({
          currentPlanCode: transition.currentPlanCode,
          currentPriceId: currentConfig.priceId,
          memberId: input.memberId,
          stripeSubscriptionId,
          targetPlanCode,
          targetPriceId: targetConfig.priceId,
        }),
      });
    } catch (error) {
      // Logged here because a pending_update outcome absorbs this rejection
      // without ever converting it into a domain error.
      logHostedStripeFailure({
        error,
        operationName: "subscription.update.plan-items",
      });
      updateFailure = { error };
      updatedSubscription = await callHostedStripePlanUpgradeOperation(
        "subscription.retrieve.after-plan-items-error",
        () =>
          stripe.subscriptions.retrieve(stripeSubscriptionId, {
            expand: ["items.data.price"],
          }),
      );
      assertHostedStripeSubscriptionMatchesCustomer({
        stripeCustomerId,
        subscription: updatedSubscription,
      });
    }
  }

  if (!isHostedStripeSubscriptionAppliedPlan({
    subscription: updatedSubscription,
    targetPriceId: targetConfig.priceId,
  })) {
    if (updateFailure && !updatedSubscription.pending_update) {
      throw buildHostedStripePlanUpgradeOperationError(
        "subscription.update.plan-items",
        updateFailure.error,
      );
    }

    assertHostedBillingPlanUpgradePendingUpdateMatches({
      currentPriceId: currentConfig.priceId,
      subscription: updatedSubscription,
      targetPriceId: targetConfig.priceId,
    });

    return {
      billingPlanCode: transition.currentPlanCode,
      paymentUrl: await createHostedBillingPlanUpgradePortalUrl({
        stripe,
        stripeCustomerId,
      }),
      status: "pending_payment",
    };
  }

  return await finalizeAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now: input.now,
    prisma,
    stripe,
    stripeSubscriptionId,
    subscription: updatedSubscription,
    targetPlanCode,
    targetPriceId: targetConfig.priceId,
  });
}

function buildHostedBillingPlanChangeAlreadyScheduledError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_CHANGE_ALREADY_SCHEDULED",
    httpStatus: 409,
    message:
      "A plan change is already scheduled. Review the current billing state before changing plans again.",
  });
}

async function finalizeAppliedHostedBillingPlanUpgrade(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
}): Promise<{
  billingPlanCode: HostedBillingPlanCode;
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
  return {
    billingPlanCode: input.targetPlanCode,
    status: "upgraded",
  };
}

function buildHostedBillingPlanUpgradeSourceChangedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
    httpStatus: 409,
    message:
      "Your current plan changed before this upgrade started. Review the latest billing state and try again.",
  });
}

function assertHostedBillingPlanUpgradeAllowed(input: {
  currentPlanCode: HostedBillingPlanCode | null;
  targetPlanCode: HostedBillingPlanCode;
}): asserts input is {
  currentPlanCode: HostedBillingPlanCode;
  targetPlanCode: HostedBillingPlanCode;
} {
  if (
    input.currentPlanCode !== null &&
    isHostedBillingPlanImmediateUpgrade({
      currentPlanCode: input.currentPlanCode,
      targetPlanCode: input.targetPlanCode,
    })
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_UNSUPPORTED",
    httpStatus: 400,
    message: "This plan change is not supported.",
  });
}

function assertHostedBillingPlanUpgradeSourceState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  targetPlanCode: HostedBillingPlanCode;
}): void {
  if (canUpgradeHostedBillingPlan({
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentBillingPlanCode: input.billingRef?.currentBillingPlanCode,
    currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    targetPlanCode: input.targetPlanCode,
  })) {
    return;
  }

  if (isHostedPulseTrialBillingState({
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
  })) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TRIAL_UNSUPPORTED",
      httpStatus: 409,
      message: "Finish trial billing before changing plans.",
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_UNSUPPORTED",
    httpStatus: 400,
    message: "This plan change is not supported.",
  });
}

function buildHostedBillingPlanUpgradeSubscriptionItems(input: {
  currentPriceId: string;
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): Stripe.SubscriptionUpdateParams.Item[] {
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

  return items;
}

async function cleanupAppliedHostedBillingPlanUpgradeSubscriptionItems(input: {
  memberId: string;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: HostedBillingPlanCode;
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
  targetPlanCode: HostedBillingPlanCode;
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
  targetPlanCode: HostedBillingPlanCode;
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
  targetPlanCode: HostedBillingPlanCode;
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

function findHostedStripeSubscriptionItemByPriceId(
  subscription: Stripe.Subscription,
  priceId: string,
): Stripe.SubscriptionItem | null {
  return subscription.items.data.find((item) => item.price?.id === priceId) ?? null;
}

function assertHostedBillingPlanUpgradePendingUpdateMatches(input: {
  currentPriceId: string;
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): void {
  const currentItem = findHostedStripeSubscriptionItemByPriceId(
    input.subscription,
    input.currentPriceId,
  );
  const pendingUpdate = input.subscription.pending_update;
  const pendingItems = pendingUpdate?.subscription_items;

  if (
    !currentItem ||
    !pendingUpdate ||
    !Array.isArray(pendingItems) ||
    pendingItems.length !== 1 ||
    typeof pendingUpdate.expires_at !== "number" ||
    !Number.isFinite(pendingUpdate.expires_at) ||
    pendingUpdate.expires_at <= 0 ||
    pendingUpdate.billing_cycle_anchor != null ||
    pendingUpdate.trial_end != null ||
    pendingUpdate.trial_from_plan === true
  ) {
    throw buildHostedBillingPlanUpgradePendingUpdateConflictError();
  }

  const [pendingItem] = pendingItems;
  if (
    !pendingItem ||
    pendingItem.id !== currentItem.id ||
    coerceStripeObjectId(pendingItem.price) !== input.targetPriceId ||
    (pendingItem.quantity !== undefined && pendingItem.quantity !== 1)
  ) {
    throw buildHostedBillingPlanUpgradePendingUpdateConflictError();
  }
}

function buildHostedBillingPlanUpgradePendingUpdateConflictError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_UPDATE_CONFLICT",
    httpStatus: 409,
    message: "Your subscription already has a different pending billing update.",
  });
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
  targetPlanCode: HostedBillingPlanCode;
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
  currentPlanCode: HostedBillingPlanCode;
  currentPriceId: string;
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
    logHostedStripeFailure({ error, operationName });
    throw buildHostedStripePlanUpgradeOperationError(operationName, error);
  }
}

function buildHostedStripePlanUpgradeOperationError(
  operationName: string,
  error: unknown,
): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
    details: describeHostedStripeErrorDetails({ error, operationName }),
    httpStatus: 502,
    message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
    retryable: true,
  });
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
