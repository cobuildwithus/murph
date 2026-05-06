import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { resolveHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  canUpgradeHostedBillingPlanToEdge,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberActiveAccessAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberStripeBillingRef,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
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

export async function upgradeHostedBillingPlan(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
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

  assertHostedMemberActiveAccessAllowed(member);

  const targetPlanCode = input.targetPlanCode;
  if (targetPlanCode !== "launch_edge_monthly") {
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
  const currentPlanCode = parseHostedBillingPlanCode(billingRef?.currentBillingPlanCode);

  if (currentPlanCode === targetPlanCode) {
    return {
      billingPlanCode: targetPlanCode,
      status: "already_on_plan",
    };
  }

  const transition = {
    currentPlanCode,
    targetPlanCode,
  };
  assertHostedBillingPlanUpgradeAllowed(transition);
  assertHostedBillingPlanUpgradeSourceState({
    billingRef,
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
  const targetConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: targetPlanCode,
  });
  const stripe = targetConfig.stripe;
  const subscription = await callHostedStripePlanUpgradeOperation(() =>
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
    targetUsagePriceId: targetConfig.usagePriceId,
  })) {
    const appliedSubscription = await normalizeAppliedHostedBillingPlanUpgradeSubscription({
      memberId: input.memberId,
      stripe,
      stripeSubscriptionId,
      subscription,
      targetPlanCode,
    });
    await reconcileAppliedHostedBillingPlanUpgrade({
      memberId: input.memberId,
      now,
      prisma,
      stripeSubscriptionId,
      subscription: appliedSubscription,
      targetPlanCode,
    });
    await nudgeHostedRunnerUserBestEffortResult({
      context: "billing.plan-upgrade",
      userId: input.memberId,
    });

    return {
      billingPlanCode: targetPlanCode,
      status: "upgraded",
    };
  }

  const updateItems = buildHostedBillingPlanUpgradeSubscriptionItems({
    currentPriceId: currentConfig.priceId,
    currentUsagePriceId: currentConfig.usagePriceId,
    subscription,
    targetPriceId: targetConfig.priceId,
    targetUsagePriceId: targetConfig.usagePriceId,
  });
  const updatedSubscription = await callHostedStripePlanUpgradeOperation(() =>
    stripe.subscriptions.update(stripeSubscriptionId, {
      expand: ["items.data.price", "latest_invoice.payment_intent"],
      items: updateItems,
      metadata: buildHostedBillingPlanUpgradeSubscriptionMetadata({
        memberId: input.memberId,
        targetPlanCode,
      }),
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    }, {
      idempotencyKey: buildHostedBillingPlanUpgradeIdempotencyKey({
        currentPlanCode: transition.currentPlanCode,
        currentPriceId: currentConfig.priceId,
        currentUsagePriceId: currentConfig.usagePriceId,
        memberId: input.memberId,
        stripeSubscriptionId,
        targetPlanCode,
        targetPriceId: targetConfig.priceId,
        targetUsagePriceId: targetConfig.usagePriceId,
      }),
    })
  );

  if (!isHostedStripeSubscriptionAppliedPlan({
    subscription: updatedSubscription,
    targetPriceId: targetConfig.priceId,
    targetUsagePriceId: targetConfig.usagePriceId,
  })) {
    return {
      billingPlanCode: transition.currentPlanCode,
      billingPortalUrl: await createHostedBillingPlanUpgradePortalUrl({
        stripe,
        stripeCustomerId,
      }),
      status: "pending_payment",
    };
  }

  await reconcileAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now,
    prisma,
    stripeSubscriptionId,
    subscription: updatedSubscription,
    targetPlanCode,
  });
  await nudgeHostedRunnerUserBestEffortResult({
    context: "billing.plan-upgrade",
    userId: input.memberId,
  });

  return {
    billingPlanCode: targetPlanCode,
    status: "upgraded",
  };
}

function assertHostedBillingPlanUpgradeAllowed(input: {
  currentPlanCode: HostedBillingPlanCode | null;
  targetPlanCode: HostedBillingPlanCode;
}): asserts input is {
  currentPlanCode: "launch_monthly";
  targetPlanCode: "launch_edge_monthly";
} {
  if (
    input.targetPlanCode === "launch_edge_monthly" &&
    input.currentPlanCode === "launch_monthly"
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
}): void {
  if (canUpgradeHostedBillingPlanToEdge({
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentBillingPlanCode: input.billingRef?.currentBillingPlanCode,
    currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
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
      message: "Finish trial billing before upgrading to Edge.",
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
  currentUsagePriceId: string | null;
  subscription: Stripe.Subscription;
  targetPriceId: string;
  targetUsagePriceId: string | null;
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

  if (input.targetUsagePriceId) {
    const usageItem = input.currentUsagePriceId
      ? findHostedStripeSubscriptionItemByPriceId(
        input.subscription,
        input.currentUsagePriceId,
      )
      : null;

    items.push(usageItem
      ? {
        id: usageItem.id,
        price: input.targetUsagePriceId,
      }
      : {
        price: input.targetUsagePriceId,
      });
  }

  return items;
}

function buildHostedBillingPlanUpgradeSubscriptionMetadata(input: {
  memberId: string;
  targetPlanCode: "launch_edge_monthly";
}): Stripe.MetadataParam {
  return {
    billingPlanCode: input.targetPlanCode,
    checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    memberId: input.memberId,
    trialDurationDays: "",
    trialPolicyVersion: "",
    trialUsageLimitUsdMicros: "",
  };
}

async function normalizeAppliedHostedBillingPlanUpgradeSubscription(input: {
  memberId: string;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
}): Promise<Stripe.Subscription> {
  if (isHostedBillingPlanUpgradeSubscriptionMetadataNormalized(input)) {
    return input.subscription;
  }

  return callHostedStripePlanUpgradeOperation(() =>
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

function findHostedStripeSubscriptionItemByPriceId(
  subscription: Stripe.Subscription,
  priceId: string,
): Stripe.SubscriptionItem | null {
  return subscription.items.data.find((item) => item.price?.id === priceId) ?? null;
}

function isHostedStripeSubscriptionAppliedPlan(input: {
  subscription: Stripe.Subscription;
  targetPriceId: string;
  targetUsagePriceId: string | null;
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

  return itemPriceIds.has(input.targetPriceId) &&
    (!input.targetUsagePriceId || itemPriceIds.has(input.targetUsagePriceId));
}

async function reconcileAppliedHostedBillingPlanUpgrade(input: {
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await applyStripeSubscriptionUpdated(
      input.subscription,
      buildHostedBillingPlanUpgradeDispatchContext({
        now: input.now,
        stripeSubscriptionId: input.stripeSubscriptionId,
      }),
      tx,
    );
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

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
  const session = await callHostedStripePlanUpgradeOperation(() =>
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
  currentUsagePriceId: string | null;
  memberId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
  targetUsagePriceId: string | null;
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

async function callHostedStripePlanUpgradeOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      details: describeSafeStripePlanChangeError(error),
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
  const statusCode = Reflect.get(error, "statusCode");
  const type = Reflect.get(error, "type");
  const requestId = Reflect.get(error, "requestId");

  return {
    ...(typeof type === "string" && type.length > 0 ? { type } : {}),
    ...(typeof code === "string" && code.length > 0 ? { code } : {}),
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    requestIdPresent: typeof requestId === "string" && requestId.length > 0,
  };
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
