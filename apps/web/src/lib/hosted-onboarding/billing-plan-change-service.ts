import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { resolveHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { signalHostedRuntimeManualWakeBestEffort } from "../hosted-orchestration/manual-wake";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
} from "./billing";
import {
  canUpgradeHostedBillingPlanToEdge,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberOwnActiveBillingAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberStripeBillingRef,
  type HostedMemberStripeBillingRefSnapshot,
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  classifyHostedStripeRecurringFinancialHealth,
  readHostedStripeRecurringFinancialState,
} from "./stripe-billing-lookup";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  applyStripeRecurringFinancialState,
  applyStripeSubscriptionUpdated,
} from "./stripe-billing-events";
import {
  assertHostedStripeSubscriptionMatchesCustomer,
  buildHostedStripeSubscriptionMutationScope,
  classifyHostedStripeFailure,
  classifyHostedStripeInvoiceCollectionState,
  HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS,
  type HostedStripeInvoiceCollectionSnapshot,
  readHostedStripeInvoicePaymentUrl,
  retrieveHostedStripeInvoiceCollectionSnapshot,
} from "./stripe-billing-state";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";
import {
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
} from "./stripe-error-log";
import { createHostedStripePortalSession } from "./stripe-portal";

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
    paymentUrl: string;
    status: "payment_required";
  }
  | {
    billingPlanCode: "launch_monthly";
    status: "processing";
  };

type HostedBillingPlanUpgradeLockedResult =
  | HostedBillingPlanUpgradeResult
  | {
      billingPlanCode: "launch_monthly";
      status: "financially_blocked";
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

  assertHostedMemberOwnActiveBillingAllowed(member);

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
    if (!billingRef) {
      throw buildHostedBillingPlanUpgradeSourceChangedError();
    }
    return withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma,
      run: async (tx) =>
        resolveHostedBillingPlanUpgradeAlreadyAppliedWithLockedOwner({
          expectedBillingRef: billingRef,
          memberId: input.memberId,
          targetPlanCode,
          tx,
        }),
    });
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

  if (!billingRef || !stripeCustomerId || !stripeSubscriptionId) {
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
  const result = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma,
    run: async (tx) =>
      upgradeHostedBillingPlanWithLockedOwner({
        currentConfig,
        expectedBillingRef: billingRef,
        memberId: input.memberId,
        now,
        targetConfig,
        targetPlanCode,
        tx,
      }),
  });

  if (result.status === "financially_blocked") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_FINANCIAL_STATE_BLOCKED",
      httpStatus: 409,
      message:
        "Stripe shows an unsettled invoice, refund, or dispute on this subscription. Open billing before retrying.",
    });
  }
  if (result.status === "upgraded") {
    await signalHostedRuntimeManualWakeBestEffort({
      userId: input.memberId,
    });
  }

  return result;
}

async function resolveHostedBillingPlanUpgradeAlreadyAppliedWithLockedOwner(input: {
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot;
  memberId: string;
  targetPlanCode: "launch_edge_monthly";
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingPlanUpgradeResult> {
  const billingRef = await readHostedBillingPlanUpgradeLockedSource({
    expectedBillingRef: input.expectedBillingRef,
    memberId: input.memberId,
    tx: input.tx,
  });
  if (
    parseHostedBillingPlanCode(billingRef.currentBillingPlanCode) !==
      input.targetPlanCode
  ) {
    throw buildHostedBillingPlanUpgradeSourceChangedError();
  }

  return {
    billingPlanCode: input.targetPlanCode,
    status: "already_on_plan",
  };
}

async function upgradeHostedBillingPlanWithLockedOwner(input: {
  currentConfig: ReturnType<typeof requireHostedStripeBillingPlanConfig>;
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot;
  memberId: string;
  now: Date;
  targetConfig: ReturnType<typeof requireHostedStripeBillingPlanConfig>;
  targetPlanCode: "launch_edge_monthly";
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingPlanUpgradeLockedResult> {
  const billingRef = await readHostedBillingPlanUpgradeLockedSource({
    expectedBillingRef: input.expectedBillingRef,
    memberId: input.memberId,
    tx: input.tx,
  });
  const currentPlanCode = parseHostedBillingPlanCode(
    billingRef.currentBillingPlanCode,
  );
  const transition = {
    currentPlanCode,
    targetPlanCode: input.targetPlanCode,
  };
  assertHostedBillingPlanUpgradeAllowed(transition);
  assertHostedBillingPlanUpgradeSourceState({
    billingRef,
  });

  const stripeCustomerId = billingRef.stripeCustomerId;
  const stripeSubscriptionId = billingRef.stripeSubscriptionId;
  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw buildHostedBillingPlanUpgradeSourceChangedError();
  }

  const stripe = input.targetConfig.stripe;
  const subscription = await callHostedStripePlanUpgradeOperation("subscription.retrieve", () =>
    stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
    })
  );

  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId,
    subscription,
  });

  const existingInvoiceSnapshot =
    await retrieveHostedBillingPlanUpgradeInvoiceSnapshot({
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription,
    });
  const previousLatestInvoiceId = coerceStripeObjectId(
    subscription.latest_invoice,
  );

  if (isHostedStripeSubscriptionAppliedPlan({
    subscription,
    targetPriceId: input.targetConfig.priceId,
  })) {
    // Validate the applied item shape before considering collection proof, but
    // do not repair Stripe or grant Edge until the exact upgrade invoice paid.
    buildHostedBillingPlanUpgradeAppliedSubscriptionCleanupItems({
      subscription,
      targetPriceId: input.targetConfig.priceId,
    });
    const collectionResult =
      await resolveHostedBillingPlanUpgradeAppliedCollection({
        currentPlanCode: transition.currentPlanCode,
        invoiceSnapshot: existingInvoiceSnapshot,
        now: input.now,
        stripe,
        stripeCustomerId,
      });
    if (collectionResult) {
      return collectionResult;
    }
    return await finalizeAppliedHostedBillingPlanUpgrade({
      memberId: input.memberId,
      now: input.now,
      tx: input.tx,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription,
      targetPlanCode: input.targetPlanCode,
      targetPriceId: input.targetConfig.priceId,
    });
  }

  if (subscription.pending_update) {
    assertHostedBillingPlanUpgradePendingUpdateMatches({
      currentPriceId: input.currentConfig.priceId,
      subscription,
      targetPriceId: input.targetConfig.priceId,
    });
    assertHostedBillingPlanUpgradeInvoiceMatchesPendingAttempt({
      invoiceSnapshot: existingInvoiceSnapshot,
    });
    return resolveHostedBillingPlanUpgradePendingResult({
      currentPlanCode: transition.currentPlanCode,
      invoiceSnapshot: existingInvoiceSnapshot,
      now: input.now,
      pendingUpdateExpiresAt:
        readHostedBillingPlanUpgradePendingUpdateExpiresAt(subscription),
      stripe,
      stripeCustomerId,
    });
  }

  const existingCollectionResult =
    await maybeResolveHostedBillingPlanUpgradeExistingCollection({
      currentPlanCode: transition.currentPlanCode,
      invoiceSnapshot: existingInvoiceSnapshot,
      now: input.now,
      stripe,
      stripeCustomerId,
    });
  if (existingCollectionResult) {
    return existingCollectionResult;
  }
  const financialPreflightResult =
    await resolveHostedBillingPlanUpgradeFinancialPreflight({
      currentPlanCode: transition.currentPlanCode,
      now: input.now,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription,
    });
  if (financialPreflightResult) {
    return financialPreflightResult;
  }

  const updateItems = buildHostedBillingPlanUpgradeSubscriptionItems({
    currentPriceId: input.currentConfig.priceId,
    subscription,
    targetPriceId: input.targetConfig.priceId,
  });
  let updateFailure: { error: unknown } | null = null;
  let updatedSubscription = subscription;

  try {
    updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
      expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
      items: updateItems,
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    }, {
      idempotencyKey: buildHostedBillingPlanUpgradeIdempotencyKey({
        currentPlanCode: transition.currentPlanCode,
        currentPriceId: input.currentConfig.priceId,
        memberId: input.memberId,
        providerState: buildHostedStripeSubscriptionMutationScope(
          subscription,
          existingInvoiceSnapshot,
        ),
        stripeSubscriptionId,
        targetPlanCode: input.targetPlanCode,
        targetPriceId: input.targetConfig.priceId,
      }),
    });
  } catch (error) {
    // A provider error can still follow a committed update. Canonical reread
    // decides whether there is an applied or pending target before surfacing it.
    logHostedStripeFailure({
      error,
      operationName: "subscription.update.plan-items",
    });
    updateFailure = { error };
    updatedSubscription = await callHostedStripePlanUpgradeOperation(
      "subscription.retrieve.after-plan-items-error",
      () =>
        stripe.subscriptions.retrieve(stripeSubscriptionId, {
          expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
        }),
    );
    assertHostedStripeSubscriptionMatchesCustomer({
      stripeCustomerId,
      subscription: updatedSubscription,
    });
  }

  const updatedInvoiceSnapshot =
    await retrieveHostedBillingPlanUpgradeInvoiceSnapshot({
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription: updatedSubscription,
    });

  if (!isHostedStripeSubscriptionAppliedPlan({
    subscription: updatedSubscription,
    targetPriceId: input.targetConfig.priceId,
  })) {
    if (updateFailure && !updatedSubscription.pending_update) {
      throw buildHostedStripePlanUpgradeOperationError(
        "subscription.update.plan-items",
        updateFailure.error,
      );
    }

    assertHostedBillingPlanUpgradePendingUpdateMatches({
      currentPriceId: input.currentConfig.priceId,
      subscription: updatedSubscription,
      targetPriceId: input.targetConfig.priceId,
    });
    assertHostedBillingPlanUpgradeCreatedInvoice({
      invoiceSnapshot: updatedInvoiceSnapshot,
      previousLatestInvoiceId,
      errorCode: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_INVOICE_MISMATCH",
    });
    assertHostedBillingPlanUpgradeInvoiceMatchesPendingAttempt({
      invoiceSnapshot: updatedInvoiceSnapshot,
    });

    return resolveHostedBillingPlanUpgradePendingResult({
      currentPlanCode: transition.currentPlanCode,
      invoiceSnapshot: updatedInvoiceSnapshot,
      now: input.now,
      pendingUpdateExpiresAt:
        readHostedBillingPlanUpgradePendingUpdateExpiresAt(
          updatedSubscription,
        ),
      stripe,
      stripeCustomerId,
    });
  }

  buildHostedBillingPlanUpgradeAppliedSubscriptionCleanupItems({
    subscription: updatedSubscription,
    targetPriceId: input.targetConfig.priceId,
  });
  assertHostedBillingPlanUpgradeCreatedInvoice({
    invoiceSnapshot: updatedInvoiceSnapshot,
    previousLatestInvoiceId,
    errorCode: "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_MISSING",
  });
  const appliedCollectionResult =
    await resolveHostedBillingPlanUpgradeAppliedCollection({
      currentPlanCode: transition.currentPlanCode,
      invoiceSnapshot: updatedInvoiceSnapshot,
      now: input.now,
      stripe,
      stripeCustomerId,
    });
  if (appliedCollectionResult) {
    return appliedCollectionResult;
  }

  return await finalizeAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
    stripe,
    stripeCustomerId,
    stripeSubscriptionId,
    subscription: updatedSubscription,
    targetPlanCode: input.targetPlanCode,
    targetPriceId: input.targetConfig.priceId,
  });
}

async function readHostedBillingPlanUpgradeLockedSource(input: {
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeBillingRefSnapshot> {
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }
  assertHostedMemberOwnActiveBillingAllowed(member);

  const source = {
    currentBillingRef: await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    expectedBillingRef: input.expectedBillingRef,
  };
  assertHostedBillingPlanUpgradeSourceUnchanged(source);
  return source.currentBillingRef;
}

async function finalizeAppliedHostedBillingPlanUpgrade(input: {
  memberId: string;
  now: Date;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
  targetPriceId: string;
  tx: Prisma.TransactionClient;
}): Promise<
  | {
      billingPlanCode: "launch_edge_monthly";
      status: "upgraded";
    }
  | {
      billingPlanCode: "launch_monthly";
      status: "financially_blocked";
    }
> {
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

  const projected = await reconcileAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now: input.now,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription: appliedSubscription,
    targetPlanCode: input.targetPlanCode,
    tx: input.tx,
  });
  if (!projected) {
    return {
      billingPlanCode: "launch_monthly",
      status: "financially_blocked",
    };
  }

  return {
    billingPlanCode: input.targetPlanCode,
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

function assertHostedBillingPlanUpgradeSourceUnchanged(input: {
  currentBillingRef: HostedMemberStripeBillingRefSnapshot | null;
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot;
}): asserts input is {
  currentBillingRef: HostedMemberStripeBillingRefSnapshot;
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot;
} {
  const current = input.currentBillingRef;
  const expected = input.expectedBillingRef;
  if (
    current &&
    current.memberId === expected.memberId &&
    (current.currentBillingPhase ?? null) ===
      (expected.currentBillingPhase ?? null) &&
    (current.currentBillingPlanCode ?? null) ===
      (expected.currentBillingPlanCode ?? null) &&
    (current.currentCheckoutOffer ?? null) ===
      (expected.currentCheckoutOffer ?? null) &&
    current.stripeCustomerId === expected.stripeCustomerId &&
    current.stripeSubscriptionId === expected.stripeSubscriptionId
  ) {
    return;
  }

  throw buildHostedBillingPlanUpgradeSourceChangedError();
}

function buildHostedBillingPlanUpgradeSourceChangedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
    httpStatus: 409,
    message: "Your billing owner or subscription changed before the plan change started. Refresh and try again.",
    retryable: true,
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
          expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
          items: cleanupItems,
        },
        {
          idempotencyKey: buildHostedBillingPlanUpgradeAppliedItemsCleanupIdempotencyKey({
            memberId: input.memberId,
            providerState: buildHostedStripeSubscriptionMutationScope(input.subscription),
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
        expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
        metadata: buildHostedBillingPlanUpgradeSubscriptionMetadata({
          memberId: input.memberId,
          targetPlanCode: input.targetPlanCode,
        }),
      }, {
        idempotencyKey: buildHostedBillingPlanUpgradeMetadataRepairIdempotencyKey({
          memberId: input.memberId,
          providerState: buildHostedStripeSubscriptionMutationScope(input.subscription),
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

function readHostedBillingPlanUpgradePendingUpdateExpiresAt(
  subscription: Stripe.Subscription,
): number {
  const expiresAt = subscription.pending_update?.expires_at;
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0
  ) {
    throw buildHostedBillingPlanUpgradePendingUpdateConflictError();
  }
  return expiresAt;
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
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: "launch_edge_monthly";
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const dispatchContext = buildHostedBillingPlanUpgradeDispatchContext({
    now: input.now,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  const financialProjection = await applyStripeRecurringFinancialState({
    dispatchContext,
    owner: {
      kind: "member",
      lockMemberId: input.memberId,
      memberId: input.memberId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
    restoreWhenHealthy: false,
    subscription: input.subscription,
    tx: input.tx,
  });
  if (financialProjection.blockActiveProjection) {
    return false;
  }
  await applyStripeSubscriptionUpdated(
    input.subscription,
    dispatchContext,
    input.tx,
  );

  const gate = await resolveHostedAiUsageGate({
    memberId: input.memberId,
    now: input.now,
    prisma: input.tx,
  });

  if (gate.billingPlanCode === input.targetPlanCode) {
    return true;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_RECONCILIATION_PENDING",
    httpStatus: 409,
    message: "Your plan change is still syncing. Try again shortly.",
    retryable: true,
  });
}

async function retrieveHostedBillingPlanUpgradeInvoiceSnapshot(input: {
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): Promise<HostedStripeInvoiceCollectionSnapshot | null> {
  const invoiceId = coerceStripeObjectId(input.subscription.latest_invoice);
  if (!invoiceId) {
    return null;
  }

  return retrieveHostedBillingPlanUpgradeInvoiceSnapshotById({
    invoiceId,
    stripe: input.stripe,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
}

async function retrieveHostedBillingPlanUpgradeInvoiceSnapshotById(input: {
  invoiceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<HostedStripeInvoiceCollectionSnapshot> {
  const invoiceSnapshot = await callHostedStripePlanUpgradeOperation(
    "invoice.retrieve.collection-state",
    () =>
      retrieveHostedStripeInvoiceCollectionSnapshot({
        invoiceId: input.invoiceId,
        stripe: input.stripe,
      }),
  );
  assertHostedBillingPlanUpgradeInvoiceMatchesOwner({
    invoice: invoiceSnapshot.invoice,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  return invoiceSnapshot;
}

async function resolveHostedBillingPlanUpgradeFinancialPreflight(input: {
  currentPlanCode: "launch_monthly";
  now: Date;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): Promise<HostedBillingPlanUpgradeLockedResult | null> {
  const financialState = await readHostedStripeRecurringFinancialState(
    input.subscription,
  );
  const health = classifyHostedStripeRecurringFinancialHealth(financialState);
  if (health.kind === "healthy") {
    return null;
  }
  if (
    health.reason === "collection_unsettled" &&
    (
      health.collectionState.kind === "processing" ||
      health.collectionState.kind === "payment_required"
    ) &&
    financialState.invoiceId
  ) {
    const invoiceSnapshot =
      await retrieveHostedBillingPlanUpgradeInvoiceSnapshotById({
        invoiceId: financialState.invoiceId,
        stripe: input.stripe,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
      });
    const recoveryResult =
      await maybeResolveHostedBillingPlanUpgradeExistingCollection({
        currentPlanCode: input.currentPlanCode,
        invoiceSnapshot,
        now: input.now,
        stripe: input.stripe,
        stripeCustomerId: input.stripeCustomerId,
      });
    if (recoveryResult) {
      return recoveryResult;
    }
  }

  return {
    billingPlanCode: input.currentPlanCode,
    status: "financially_blocked",
  };
}

async function maybeResolveHostedBillingPlanUpgradeExistingCollection(input: {
  currentPlanCode: "launch_monthly";
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  now: Date;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<HostedBillingPlanUpgradeResult | null> {
  const collectionState = classifyHostedStripeInvoiceCollectionState(
    input.invoiceSnapshot?.invoice ?? null,
    input.invoiceSnapshot?.invoicePayments ?? [],
  );

  switch (collectionState.kind) {
    case "none":
    case "paid":
    case "voided":
      return null;
    case "processing":
      if (collectionState.deadlineUnixSeconds * 1000 <= input.now.getTime()) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
          httpStatus: 409,
          message: "Stripe did not finish the current invoice before its collection deadline. Open billing before changing plans.",
        });
      }
      return resolveHostedBillingPlanUpgradeProcessingResult(input);
    case "payment_required":
      if (collectionState.deadlineUnixSeconds * 1000 <= input.now.getTime()) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
          httpStatus: 409,
          message: "Stripe did not finish the current invoice before its collection deadline. Open billing before changing plans.",
        });
      }
      return resolveHostedBillingPlanUpgradePaymentRequiredResult(input);
    case "uncollectible":
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_UNCOLLECTIBLE",
        httpStatus: 409,
        message: "Stripe marked the current invoice uncollectible. Open billing before changing plans.",
      });
    case "failed":
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_FAILED",
        details: collectionState.reason ? { reason: collectionState.reason } : undefined,
        httpStatus: 409,
        message: "Stripe could not collect the current invoice. Open billing before changing plans.",
      });
  }
}

async function resolveHostedBillingPlanUpgradeAppliedCollection(input: {
  currentPlanCode: "launch_monthly";
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  now: Date;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<HostedBillingPlanUpgradeResult | null> {
  if (input.invoiceSnapshot?.invoice.billing_reason !== "subscription_update") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_MISSING",
      httpStatus: 409,
      message: "Stripe did not provide the exact paid invoice for the applied plan change.",
    });
  }

  const collectionState = classifyHostedStripeInvoiceCollectionState(
    input.invoiceSnapshot.invoice,
    input.invoiceSnapshot.invoicePayments,
  );
  switch (collectionState.kind) {
    case "paid":
      return null;
    case "processing":
      if (collectionState.deadlineUnixSeconds * 1000 <= input.now.getTime()) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
          httpStatus: 409,
          message: "Stripe did not finish the applied plan-change invoice before its collection deadline.",
        });
      }
      return resolveHostedBillingPlanUpgradeProcessingResult(input);
    case "payment_required":
      if (collectionState.deadlineUnixSeconds * 1000 <= input.now.getTime()) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
          httpStatus: 409,
          message: "Stripe did not finish the applied plan-change invoice before its collection deadline.",
        });
      }
      return resolveHostedBillingPlanUpgradePaymentRequiredResult(input);
    case "none":
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_MISSING",
        httpStatus: 409,
        message: "Stripe did not provide collection proof for the applied plan change.",
      });
    case "voided":
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_VOIDED",
        httpStatus: 409,
        message: "Stripe voided the invoice for the applied plan change. Open billing before continuing.",
      });
    case "uncollectible":
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_UNCOLLECTIBLE",
        httpStatus: 409,
        message: "Stripe marked the applied plan-change invoice uncollectible. Open billing before continuing.",
      });
    case "failed":
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_FAILED",
        details: collectionState.reason ? { reason: collectionState.reason } : undefined,
        httpStatus: 409,
        message: "Stripe could not collect the applied plan-change invoice. Open billing before continuing.",
      });
  }
}

function resolveHostedBillingPlanUpgradeProcessingResult(input: {
  currentPlanCode: "launch_monthly";
}): HostedBillingPlanUpgradeResult {
  return {
    billingPlanCode: input.currentPlanCode,
    status: "processing",
  };
}

async function resolveHostedBillingPlanUpgradePaymentRequiredResult(input: {
  currentPlanCode: "launch_monthly";
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<HostedBillingPlanUpgradeResult> {
  const invoicePaymentUrl = readHostedBillingPlanUpgradeStripeUrl({
    kind: "invoice",
    value: readHostedStripeInvoicePaymentUrl(
      input.invoiceSnapshot?.invoice ?? null,
    ),
  });
  return {
    billingPlanCode: input.currentPlanCode,
    paymentUrl: invoicePaymentUrl ??
      await createHostedBillingPlanUpgradePortalUrl({
        stripe: input.stripe,
        stripeCustomerId: input.stripeCustomerId,
      }),
    status: "payment_required",
  };
}

function readHostedBillingPlanUpgradeStripeUrl(input: {
  kind: "invoice" | "portal";
  value: string | null;
}): string | null {
  if (!input.value) {
    return null;
  }

  try {
    const parsed = new URL(input.value);
    const expectedOrigin = input.kind === "invoice"
      ? "https://invoice.stripe.com"
      : "https://billing.stripe.com";
    return parsed.origin === expectedOrigin &&
        parsed.username === "" &&
        parsed.password === ""
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

async function resolveHostedBillingPlanUpgradePendingResult(input: {
  currentPlanCode: "launch_monthly";
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  now: Date;
  pendingUpdateExpiresAt: number;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<HostedBillingPlanUpgradeResult> {
  const collectionState = classifyHostedStripeInvoiceCollectionState(
    input.invoiceSnapshot?.invoice ?? null,
    input.invoiceSnapshot?.invoicePayments ?? [],
  );

  if (input.pendingUpdateExpiresAt * 1000 <= input.now.getTime()) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_ATTEMPT_EXPIRED",
      httpStatus: 409,
      message: "That plan-change attempt expired. Try the plan change again.",
      retryable: true,
    });
  }
  if (collectionState.kind === "none") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_INVOICE_MISMATCH",
      httpStatus: 409,
      message: "Stripe did not provide the exact pending invoice for this plan change.",
    });
  }
  if (collectionState.kind === "voided") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_ATTEMPT_EXPIRED",
      httpStatus: 409,
      message: "That plan-change invoice expired. Try the plan change again.",
      retryable: true,
    });
  }
  if (collectionState.kind === "uncollectible") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_UNCOLLECTIBLE",
      httpStatus: 409,
      message: "Stripe marked this plan-change invoice uncollectible. Open billing before retrying.",
    });
  }
  if (collectionState.kind === "failed") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_FAILED",
      details: collectionState.reason ? { reason: collectionState.reason } : undefined,
      httpStatus: 409,
      message: "Stripe could not collect the plan-change invoice. Open billing before retrying.",
    });
  }
  if (
    (
      collectionState.kind === "processing" ||
      collectionState.kind === "payment_required"
    ) &&
    Math.min(
      collectionState.deadlineUnixSeconds,
      input.pendingUpdateExpiresAt,
    ) * 1000 <= input.now.getTime()
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
      httpStatus: 409,
      message: "Stripe did not finish the plan-change invoice before its collection deadline. Try the plan change again.",
      retryable: true,
    });
  }

  return collectionState.kind === "payment_required"
    ? resolveHostedBillingPlanUpgradePaymentRequiredResult(input)
    : resolveHostedBillingPlanUpgradeProcessingResult(input);
}

function assertHostedBillingPlanUpgradeInvoiceMatchesPendingAttempt(input: {
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
}): void {
  const invoice = input.invoiceSnapshot?.invoice;
  if (invoice?.billing_reason === "subscription_update") {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_INVOICE_MISMATCH",
    httpStatus: 409,
    message: "Stripe did not match the pending invoice to this plan change.",
  });
}

function assertHostedBillingPlanUpgradeCreatedInvoice(input: {
  errorCode:
    | "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_MISSING"
    | "HOSTED_BILLING_PLAN_UPGRADE_PENDING_INVOICE_MISMATCH";
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  previousLatestInvoiceId: string | null;
}): void {
  if (
    input.invoiceSnapshot &&
    input.invoiceSnapshot.invoice.id !== input.previousLatestInvoiceId
  ) {
    return;
  }
  throw hostedOnboardingError({
    code: input.errorCode,
    httpStatus: 409,
    message: "Stripe did not provide the exact new invoice for this plan-change attempt.",
  });
}

function assertHostedBillingPlanUpgradeInvoiceMatchesOwner(input: {
  invoice: Stripe.Invoice;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): void {
  if (
    coerceStripeObjectId(input.invoice.customer) === input.stripeCustomerId &&
    coerceStripeInvoiceSubscriptionId(input.invoice) ===
      input.stripeSubscriptionId
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_MISMATCH",
    httpStatus: 409,
    message: "Stripe did not match this invoice to your subscription.",
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
      createHostedStripePortalSession({
        kind: "payment_recovery",
        params: {
          customer: input.stripeCustomerId,
          return_url: new URL("/home", publicBaseUrl).toString(),
        },
        stripe: input.stripe,
      })
  );

  const portalUrl = readHostedBillingPlanUpgradeStripeUrl({
    kind: "portal",
    value: session.url,
  });
  if (!portalUrl) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      httpStatus: 502,
      message: "Stripe did not return a billing portal URL.",
    });
  }

  return portalUrl;
}

function buildHostedBillingPlanUpgradeIdempotencyKey(input: {
  currentPlanCode: HostedBillingPlanCode;
  currentPriceId: string;
  memberId: string;
  providerState: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
}): string {
  return `hosted-billing-plan-upgrade:${sha256Hex(JSON.stringify(input))}`;
}

function buildHostedBillingPlanUpgradeMetadataRepairIdempotencyKey(input: {
  memberId: string;
  providerState: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
}): string {
  return `hosted-billing-plan-upgrade-metadata:${sha256Hex(JSON.stringify(input))}`;
}

function buildHostedBillingPlanUpgradeAppliedItemsCleanupIdempotencyKey(input: {
  memberId: string;
  providerState: string;
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
  const failure = classifyHostedStripeFailure(error);
  return hostedOnboardingError({
    code: failure.kind === "provider_ambiguous"
      ? "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE"
      : "HOSTED_BILLING_STRIPE_PLAN_CHANGE_PROVIDER_REJECTED",
    details: describeHostedStripeErrorDetails({ error, operationName }),
    httpStatus: failure.httpStatus,
    message: failure.kind === "provider_ambiguous"
      ? "Stripe billing is unavailable for plan changes right now. Try again shortly."
      : "Stripe rejected this plan change. Contact support before retrying.",
    retryable: failure.retryable,
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
