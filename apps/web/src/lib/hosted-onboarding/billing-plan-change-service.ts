import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE,
  HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM,
} from "./billing-plan-change-contract";
import {
  canUpgradeHostedBillingPlan,
  isHostedBillingPlanImmediateUpgrade,
  parseHostedBillingPlanCode,
  readHostedBillingPlanChangePortalConfigurationId,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberOwnPaidBillingAllowed } from "./entitlement";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
  requireValidatedHostedStripeBillingPlanConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";
import {
  buildHostedStripeAlertCorrelationCause,
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
  withHostedStripeActionFailureAlert,
} from "./stripe-error-log";

export type HostedBillingPlanUpgradeResult =
  | {
    billingPlanCode: HostedBillingPlanCode;
    status: "already_on_plan";
  }
  | {
    billingPlanCode: HostedBillingPlanCode;
    paymentUrl: string;
    status: "pending_payment";
  };

interface HostedBillingPlanUpgradeOwnerSnapshot {
  currentPlanCode: HostedBillingPlanCode;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

export async function upgradeHostedBillingPlan(input: {
  expectedCurrentPlanCode?: HostedBillingPlanCode;
  memberId: string;
  prisma?: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeResult> {
  const prisma = input.prisma ?? getPrisma();
  const owner = await readHostedBillingPlanUpgradeOwner({
    expectedCurrentPlanCode: input.expectedCurrentPlanCode,
    memberId: input.memberId,
    prisma,
    targetPlanCode: input.targetPlanCode,
  });

  const currentConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: owner.currentPlanCode,
  });
  const targetRuntimeConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: input.targetPlanCode,
  });
  return withHostedStripeActionFailureAlert(
    {
      isTerminalStripeFailure: isHostedBillingPlanUpgradeStripeUnavailableError,
      operationIdentity: buildHostedBillingPlanUpgradeOperationIdentity({
        currentPlanCode: owner.currentPlanCode,
        currentPriceId: currentConfig.priceId,
        stripeSubscriptionId: owner.stripeSubscriptionId,
        targetPlanCode: input.targetPlanCode,
        targetPriceId: targetRuntimeConfig.priceId,
      }),
      operationName: "billing.plan-upgrade",
      stripeLiveMode: targetRuntimeConfig.stripeLiveMode,
    },
    () => performHostedBillingPlanUpgrade({
      currentConfig,
      memberId: input.memberId,
      owner,
      prisma,
      targetPlanCode: input.targetPlanCode,
    }),
  );
}

async function performHostedBillingPlanUpgrade(input: {
  currentConfig: ReturnType<typeof requireHostedStripeBillingPlanConfig>;
  memberId: string;
  owner: HostedBillingPlanUpgradeOwnerSnapshot;
  prisma: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeResult> {
  const targetConfig = await requireValidatedHostedStripeBillingPlanConfig({
    billingPlanCode: input.targetPlanCode,
  });
  const stripe = targetConfig.stripe;
  const subscription = await callHostedStripePlanUpgradeOperation(
    "subscription.retrieve.portal-confirmation",
    () => stripe.subscriptions.retrieve(input.owner.stripeSubscriptionId, {
      expand: ["items.data.price"],
    }),
  );

  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId: input.owner.stripeCustomerId,
    subscription,
  });
  if (coerceStripeObjectId(subscription.schedule)) {
    throw buildHostedBillingPlanChangeAlreadyScheduledError();
  }
  if (subscription.pending_update) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_CHANGE_PENDING",
      httpStatus: 409,
      message:
        "A previous plan change is still waiting for payment. Finish or cancel it before starting another change.",
    });
  }
  assertHostedStripeSubscriptionLiveBillable(subscription);
  if (isHostedStripeSubscriptionAppliedPlan({
    subscription,
    targetPriceId: targetConfig.priceId,
  })) {
    return {
      billingPlanCode: input.targetPlanCode,
      status: "already_on_plan",
    };
  }

  const sourceItem = requireHostedStripePlanChangeSourceItem({
    sourcePriceId: input.currentConfig.priceId,
    subscription,
  });
  const returnUrls = buildHostedBillingPlanChangeReturnUrls({
    targetPlanCode: input.targetPlanCode,
  });
  const portalConfigurationId =
    requireHostedBillingPlanChangePortalConfigurationId(input.targetPlanCode);
  const session = await callHostedStripePlanUpgradeOperation(
    "billing-portal.session.create.subscription-update-confirm",
    () => stripe.billingPortal.sessions.create({
      configuration: portalConfigurationId,
      customer: input.owner.stripeCustomerId,
      flow_data: {
        after_completion: {
          redirect: {
            return_url: returnUrls.completed,
          },
          type: "redirect",
        },
        subscription_update_confirm: {
          items: [{
            id: sourceItem.id,
            price: targetConfig.priceId,
            quantity: 1,
          }],
          subscription: input.owner.stripeSubscriptionId,
        },
        type: "subscription_update_confirm",
      },
      return_url: returnUrls.canceled,
    }),
  );
  const paymentUrl = normalizeNullableString(session.url);
  if (!paymentUrl) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      httpStatus: 502,
      message: "Stripe did not return a plan confirmation URL.",
    });
  }

  await assertHostedBillingPlanUpgradeOwnerStillCurrent({
    expected: input.owner,
    memberId: input.memberId,
    prisma: input.prisma,
    targetPlanCode: input.targetPlanCode,
  });

  return {
    billingPlanCode: input.owner.currentPlanCode,
    paymentUrl,
    status: "pending_payment",
  };
}

function buildHostedBillingPlanUpgradeOperationIdentity(input: {
  currentPlanCode: HostedBillingPlanCode;
  currentPriceId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
}): string {
  return `hosted-billing-plan-upgrade:${sha256Hex(JSON.stringify(input))}`;
}

function isHostedBillingPlanUpgradeStripeUnavailableError(
  error: unknown,
): boolean {
  return isHostedOnboardingError(error) &&
    (
      error.code === "HOSTED_BILLING_PRICE_UNAVAILABLE" ||
      error.code === "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE"
    );
}

async function readHostedBillingPlanUpgradeOwner(input: {
  expectedCurrentPlanCode?: HostedBillingPlanCode;
  memberId: string;
  prisma: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanUpgradeOwnerSnapshot> {
  return await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const member = await readHostedMemberCoreState({
        memberId: input.memberId,
        prisma: tx,
      });
      if (!member) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_NOT_FOUND",
          httpStatus: 403,
          message: "Finish signup from your latest Murph link before continuing.",
        });
      }
      const billingRef = await readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma: tx,
      });
      assertHostedMemberOwnPaidBillingAllowed({
        ...member,
        billingRef,
      });
      return buildHostedBillingPlanUpgradeOwnerSnapshot({
        billingRef,
        expectedCurrentPlanCode: input.expectedCurrentPlanCode,
        targetPlanCode: input.targetPlanCode,
      });
    },
  });
}

function buildHostedBillingPlanUpgradeOwnerSnapshot(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  expectedCurrentPlanCode?: HostedBillingPlanCode;
  targetPlanCode: HostedBillingPlanCode;
}): HostedBillingPlanUpgradeOwnerSnapshot {
  const currentPlanCode = parseHostedBillingPlanCode(
    input.billingRef?.currentBillingPlanCode,
  );
  if (
    input.expectedCurrentPlanCode
    && currentPlanCode !== input.expectedCurrentPlanCode
  ) {
    throw buildHostedBillingPlanUpgradeSourceChangedError();
  }
  if (parseHostedBillingPlanCode(input.billingRef?.scheduledBillingPlanCode)) {
    throw buildHostedBillingPlanChangeAlreadyScheduledError();
  }

  const verifiedCurrentPlanCode = requireHostedBillingPlanUpgradeAllowed({
    currentPlanCode,
    targetPlanCode: input.targetPlanCode,
  });
  assertHostedBillingPlanUpgradeSourceState({
    billingRef: input.billingRef,
    targetPlanCode: input.targetPlanCode,
  });

  const stripeCustomerId = input.billingRef?.stripeCustomerId ?? null;
  const stripeSubscriptionId = input.billingRef?.stripeSubscriptionId ?? null;
  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
      message: "Your subscription is not ready for plan changes yet.",
    });
  }

  return {
    currentPlanCode: verifiedCurrentPlanCode,
    stripeCustomerId,
    stripeSubscriptionId,
  };
}

async function assertHostedBillingPlanUpgradeOwnerStillCurrent(input: {
  expected: HostedBillingPlanUpgradeOwnerSnapshot;
  memberId: string;
  prisma: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<void> {
  const current = await readHostedBillingPlanUpgradeOwner({
    expectedCurrentPlanCode: input.expected.currentPlanCode,
    memberId: input.memberId,
    prisma: input.prisma,
    targetPlanCode: input.targetPlanCode,
  });
  if (
    current.stripeCustomerId !== input.expected.stripeCustomerId
    || current.stripeSubscriptionId !== input.expected.stripeSubscriptionId
  ) {
    throw buildHostedBillingPlanUpgradeSourceChangedError();
  }
}

function requireHostedBillingPlanUpgradeAllowed(input: {
  currentPlanCode: HostedBillingPlanCode | null;
  targetPlanCode: HostedBillingPlanCode;
}): HostedBillingPlanCode {
  if (
    input.currentPlanCode !== null
    && isHostedBillingPlanImmediateUpgrade({
      currentPlanCode: input.currentPlanCode,
      targetPlanCode: input.targetPlanCode,
    })
  ) {
    return input.currentPlanCode;
  }
  if (
    input.currentPlanCode !== null
    && input.currentPlanCode === input.targetPlanCode
  ) {
    return input.currentPlanCode;
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
  if (
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode)
      === input.targetPlanCode
  ) {
    return;
  }
  if (canUpgradeHostedBillingPlan({
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentBillingPlanCode: input.billingRef?.currentBillingPlanCode,
    currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    targetPlanCode: input.targetPlanCode,
  })) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_INVALID",
    httpStatus: 409,
    message: "Your current billing state is not ready for this plan change.",
  });
}

function requireHostedStripePlanChangeSourceItem(input: {
  sourcePriceId: string;
  subscription: Stripe.Subscription;
}): Stripe.SubscriptionItem {
  if (input.subscription.items.data.length !== 1) {
    throw buildHostedBillingSubscriptionItemsUnsupportedError();
  }
  const item = input.subscription.items.data[0];
  if (
    item.price.id !== input.sourcePriceId
    || item.price.recurring?.interval !== "month"
    || item.price.recurring.usage_type !== "licensed"
    || item.quantity !== 1
  ) {
    throw buildHostedBillingSubscriptionItemsUnsupportedError();
  }
  return item;
}

function isHostedStripeSubscriptionAppliedPlan(input: {
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): boolean {
  const item = input.subscription.items.data[0];
  return input.subscription.items.data.length === 1
    && item?.price.id === input.targetPriceId
    && item.price.recurring?.interval === "month"
    && item.price.recurring.usage_type === "licensed"
    && item.quantity === 1;
}

function assertHostedStripeSubscriptionMatchesCustomer(input: {
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
}): void {
  if (coerceStripeObjectId(input.subscription.customer) === input.stripeCustomerId) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
    httpStatus: 409,
    message: "Your subscription does not match your billing account.",
  });
}

function assertHostedStripeSubscriptionLiveBillable(
  subscription: Stripe.Subscription,
): void {
  if (
    subscription.status === "active"
    && subscription.cancel_at == null
    && subscription.cancel_at_period_end !== true
    && subscription.pause_collection == null
    && subscription.collection_method === "charge_automatically"
  ) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_INVALID",
    httpStatus: 409,
    message:
      "Your current billing state is not ready for this plan change. Resolve the pending Stripe billing change and try again.",
  });
}

function buildHostedBillingPlanChangeReturnUrls(input: {
  targetPlanCode: HostedBillingPlanCode;
}): { canceled: string; completed: string } {
  const settings = new URL(
    "/settings#subscription",
    requireHostedOnboardingPublicBaseUrl(),
  );
  const canceled = new URL(settings);
  canceled.searchParams.set(
    HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM,
    HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE,
  );
  const completed = new URL(settings);
  completed.searchParams.set(
    HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM,
    input.targetPlanCode,
  );
  return {
    canceled: canceled.toString(),
    completed: completed.toString(),
  };
}

function requireHostedBillingPlanChangePortalConfigurationId(
  targetPlanCode: HostedBillingPlanCode,
): string {
  const configurationId =
    readHostedBillingPlanChangePortalConfigurationId(targetPlanCode);
  if (configurationId) {
    return configurationId;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_CHANGE_PORTAL_CONFIGURATION_REQUIRED",
    httpStatus: 503,
    message: "Plan changes are temporarily unavailable. Try again shortly.",
    retryable: true,
  });
}

function buildHostedBillingPlanUpgradeSourceChangedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
    httpStatus: 409,
    message:
      "Your current plan changed before this upgrade started. Review the latest billing state and try again.",
  });
}

function buildHostedBillingPlanChangeAlreadyScheduledError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_CHANGE_ALREADY_SCHEDULED",
    httpStatus: 409,
    message:
      "A plan change is already scheduled. Review the current billing state before changing plans again.",
  });
}

function buildHostedBillingSubscriptionItemsUnsupportedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
    httpStatus: 409,
    message:
      "Your subscription needs a billing cleanup before this plan change. Contact support.",
  });
}

async function callHostedStripePlanUpgradeOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logHostedStripeFailure({ error, operationName });
    throw hostedOnboardingError({
      cause: buildHostedStripeAlertCorrelationCause(error),
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      details: describeHostedStripeErrorDetails({ error, operationName }),
      httpStatus: 502,
      message:
        "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  }
}
