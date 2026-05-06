import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { resolveHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberActiveAccessAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { requireHostedOnboardingPublicBaseUrl, requireHostedStripeCheckoutConfig } from "./runtime";
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

  const stripeCustomerId = billingRef?.stripeCustomerId ?? null;
  const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;

  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
      message: "Your subscription is not ready for plan changes yet.",
    });
  }

  const currentConfig = requireHostedStripeCheckoutConfig({
    billingPlanCode: transition.currentPlanCode,
  });
  const targetConfig = requireHostedStripeCheckoutConfig({
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
      metadata: {
        ...subscription.metadata,
        billingPlanCode: targetPlanCode,
        memberId: input.memberId,
      },
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

  await prisma.$transaction(async (tx) => {
    await applyStripeSubscriptionUpdated(
      updatedSubscription,
      buildHostedBillingPlanUpgradeDispatchContext({
        now,
        stripeSubscriptionId,
      }),
      tx,
    );
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  await resolveHostedAiUsageGate({
    memberId: input.memberId,
    now,
    prisma,
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
    input.currentPlanCode === "launch_monthly" &&
    input.targetPlanCode === "launch_edge_monthly"
  ) {
    return;
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

async function callHostedStripePlanUpgradeOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      httpStatus: 502,
      message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  }
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
