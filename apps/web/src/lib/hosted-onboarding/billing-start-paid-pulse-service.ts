import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { prepareHostedCryptoDomainRootCandidates } from "../hosted-crypto/domain-root-store";
import { signalHostedRuntimeManualWakeBestEffort } from "../hosted-orchestration/manual-wake";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
} from "./billing";
import {
  HOSTED_PULSE_TRIAL_OFFER,
  isHostedPulseTrialBillingState,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedBillingPlanSelectable } from "./billing-plan-eligibility";
import {
  scheduleHostedBillingPlanSwitch,
  type HostedBillingPlanSwitchResult,
} from "./billing-plan-switch-to-pulse-service";
import {
  HOSTED_START_PAID_GROUP_RETURN_PARAM,
  HOSTED_START_PAID_GROUP_RETURN_VALUE,
  HOSTED_START_PAID_PULSE_RETURN_PARAM,
  HOSTED_START_PAID_PULSE_RETURN_VALUE,
  type HostedPulseTrialContinuationAction,
} from "./billing-pulse-trial-continuation-contract";
import {
  buildHostedPulseTrialPaymentReturnUrl,
} from "./billing-pulse-trial-continuation";
import {
  assertHostedMemberOwnActiveBillingAllowed,
  assertHostedMemberNotSuspended,
} from "./entitlement";
import {
  type HostedOnboardingError,
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  buildHostedFamilyBillingClaimError,
  readHostedMemberFamilyBillingClaim,
} from "./family-plan";
import {
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
  writeHostedMemberStripeBillingRefTx,
} from "./hosted-member-billing-store";
import {
  readHostedMemberCoreState,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
  requireValidatedHostedStripeBillingPlanConfig,
} from "./runtime";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  applyStripeInvoicePaid,
  cleanupHostedFamilySponsoredDirectSubscription,
} from "./stripe-billing-events";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";
import {
  buildHostedStripeAlertCorrelationCause,
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
  withHostedStripeActionFailureAlert,
} from "./stripe-error-log";
import {
  hasHostedStripeSubscriptionPaymentMethod,
  readHostedStripeSubscriptionPaymentMethodId,
  readHostedStripeSubscriptionPaymentMethodUpdate,
} from "./stripe-subscription-payment-method";

const START_PAID_PULSE_PLAN = "launch_monthly";
const START_PAID_PULSE_PAYMENT_METHOD_RETURN_PATH = "/settings#subscription";
const START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS = [
  "customer",
  "items.data.price",
  "latest_invoice",
  "latest_invoice.payment_intent",
] as const;
const START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS = [
  "items.data.price",
  "latest_invoice",
  "latest_invoice.payment_intent",
] as const;
const START_PAID_PULSE_AMBIGUOUS_STRIPE_ERROR_TYPES = new Set([
  "api_connection_error",
  "StripeConnectionError",
  "StripeAPIConnectionError",
]);
const START_PAID_PULSE_AMBIGUOUS_STRIPE_ERROR_CODES = new Set([
  "api_connection_error",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ESOCKETTIMEDOUT",
  "ETIMEDOUT",
]);
const START_PAID_PULSE_RECOVERABLE_STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "incomplete",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
]);
const PULSE_TRIAL_EXTENSION_TARGET_METADATA_KEY =
  "murphTrialExtensionTargetTrialEnd";

type HostedPulseTrialStartPaidIdempotencyOperation =
  | "active-trial-end-now-v2"
  | "paused-resume-v2";

export type HostedTrialPaidPlanCode = Extract<
  HostedBillingPlanCode,
  "launch_group_monthly" | "launch_monthly"
>;

export type HostedTrialStartPaidResult<
  TPlanCode extends HostedTrialPaidPlanCode = HostedTrialPaidPlanCode,
> =
  | {
    billingPlanCode: TPlanCode;
    status: "billing_pending";
  }
  | {
    billingPlanCode: TPlanCode;
    status: "started";
  }
  | {
    billingPlanCode: TPlanCode;
    paymentUrl: string;
    resumeStartAfterPaymentMethodSetup?: true;
    status: "payment_required";
  };

export type HostedTrialContinueResult<
  TPlanCode extends HostedTrialPaidPlanCode = HostedTrialPaidPlanCode,
> =
  | HostedTrialStartPaidResult<TPlanCode>
  | {
    billingPlanCode: TPlanCode;
    status: "continuing";
  };

export type HostedPulseTrialStartPaidResult =
  HostedTrialStartPaidResult<"launch_monthly">;
export type HostedPulseTrialContinueResult =
  HostedTrialContinueResult<"launch_monthly">;

export type HostedTrialPaidPlanTransitionResult<
  TPlanCode extends HostedTrialPaidPlanCode = HostedTrialPaidPlanCode,
> =
  | HostedBillingPlanSwitchResult
  | HostedTrialContinueResult<TPlanCode>;

interface HostedPulseTrialPaidPlanInput {
  memberId: string;
  now?: Date;
  paymentMethodContinuation?: "conversation" | "settings";
  prisma?: PrismaClient;
}

type HostedPulseTrialStartPaidPlanInput = HostedPulseTrialPaidPlanInput;

type HostedPulseTrialPaymentMethodPortalContinuation =
  | {
    kind: "conversation";
    action: HostedPulseTrialContinuationAction;
    memberId: string;
  }
  | {
      kind: "settings";
    }
  | {
      kind: "settings_group";
    };

export async function startHostedPulseTrialPaidPlan(
  input: HostedPulseTrialStartPaidPlanInput,
): Promise<HostedPulseTrialStartPaidResult> {
  return transitionHostedPulseTrialPaidPlan({
    ...input,
    targetPlanCode: START_PAID_PULSE_PLAN,
    timing: "now",
  });
}

export async function continueHostedPulseTrialPaidPlan(
  input: HostedPulseTrialPaidPlanInput,
): Promise<HostedPulseTrialContinueResult> {
  return transitionHostedPulseTrialPaidPlan({
    ...input,
    targetPlanCode: START_PAID_PULSE_PLAN,
    timing: "at_trial_end",
  });
}

export async function startHostedTrialPaidPlan(
  input: HostedPulseTrialPaidPlanInput & {
    targetPlanCode: HostedTrialPaidPlanCode;
    timing: "at_trial_end" | "now";
  },
): Promise<HostedTrialPaidPlanTransitionResult> {
  if (input.timing === "now") {
    return transitionHostedPulseTrialPaidPlan({
      ...input,
      timing: "now",
    });
  }

  if (
    input.targetPlanCode === "launch_group_monthly"
  ) {
    const switchResult = await scheduleHostedBillingPlanSwitch({
      memberId: input.memberId,
      now: input.now,
      prisma: input.prisma,
      requiredSourceBillingPhase: "trial",
      targetPlanCode: input.targetPlanCode,
    });
    if (switchResult.status !== "payment_method_required") {
      return switchResult;
    }

    const prisma = input.prisma ?? getPrisma();
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
        message: "Your subscription is not ready for billing changes yet.",
      });
    }
    const targetConfig = requireHostedStripeBillingPlanConfig({
      billingPlanCode: input.targetPlanCode,
    });
    const now = input.now ?? new Date();
    const paymentMethodContinuation =
      resolveHostedPulseTrialPaymentMethodContinuation({
        continuation: input.paymentMethodContinuation,
        memberId: input.memberId,
        targetPlanCode: input.targetPlanCode,
        timing: input.timing,
      });

    const paymentUrl = await withHostedStripeActionFailureAlert(
      {
        isTerminalStripeFailure:
          isHostedPulseTrialStartPaidTerminalStripeError,
        operationIdentity: buildHostedPulseTrialPaidPlanOperationIdentity({
          currentBillingPhase: billingRef?.currentBillingPhase ?? null,
          currentCheckoutOffer: billingRef?.currentCheckoutOffer ?? null,
          memberId: input.memberId,
          priceId: targetConfig.priceId,
          stripeSubscriptionId,
          targetPlanCode: input.targetPlanCode,
          timing: input.timing,
          trialEnd: billingRef?.currentTrialEndsAt ?? null,
        }),
        operationName: "billing.start-paid-trial",
        stripeLiveMode: targetConfig.stripeLiveMode,
      },
      () => createHostedPulseTrialStartPaidPaymentMethodPortalUrl({
        continuation: paymentMethodContinuation,
        now,
        stripe: targetConfig.stripe,
        stripeCustomerId,
      }),
    );

    return {
      billingPlanCode: input.targetPlanCode,
      paymentUrl,
      status: "payment_required",
    };
  }

  return transitionHostedPulseTrialPaidPlan({
    ...input,
    targetPlanCode: "launch_monthly",
    timing: "at_trial_end",
  });
}

async function transitionHostedPulseTrialPaidPlan<
  TPlanCode extends HostedTrialPaidPlanCode,
>(
  input: HostedPulseTrialStartPaidPlanInput & {
    targetPlanCode: TPlanCode;
    timing: "now";
  },
): Promise<HostedTrialStartPaidResult<TPlanCode>>;
async function transitionHostedPulseTrialPaidPlan(
  input: HostedPulseTrialPaidPlanInput & {
    targetPlanCode: "launch_monthly";
    timing: "at_trial_end";
  },
): Promise<HostedPulseTrialContinueResult>;
async function transitionHostedPulseTrialPaidPlan<
  TPlanCode extends HostedTrialPaidPlanCode,
>(
  input: HostedPulseTrialStartPaidPlanInput & {
    targetPlanCode: TPlanCode;
    timing: "at_trial_end" | "now";
  },
): Promise<HostedTrialContinueResult<TPlanCode>> {
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

  assertHostedMemberNotSuspended(member);

  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma,
  });

  if (parseHostedBillingPlanCode(billingRef?.scheduledBillingPlanCode)) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_CHANGE_ALREADY_SCHEDULED",
      httpStatus: 409,
      message:
        "A plan change is already scheduled. Review the current billing state before changing plans again.",
    });
  }

  const sourceDisposition = resolveHostedPulseTrialStartPaidSourceDisposition({
    billingRef,
    billingStatus: member.billingStatus,
    targetPlanCode: input.targetPlanCode,
  });
  if (sourceDisposition === "already_started") {
    return {
      billingPlanCode: input.targetPlanCode,
      status: "started",
    };
  }
  const currentBillingPhase =
    parseHostedBillingPhase(billingRef?.currentBillingPhase);
  const canStart = currentBillingPhase === "trial";

  if (input.timing === "at_trial_end" && !canStart) {
    if (currentBillingPhase === "paid") {
      return {
        billingPlanCode: input.targetPlanCode,
        status: "started",
      };
    }
    throw buildHostedPulseTrialContinueRequiresStartError();
  }

  const stripeCustomerId = billingRef?.stripeCustomerId ?? null;
  const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;

  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
      message: "Your subscription is not ready for billing changes yet.",
    });
  }
  const mutationAuthority: HostedPulseTrialStartPaidMutationAuthority = {
    billingStatus: member.billingStatus,
    currentBillingPhase: billingRef?.currentBillingPhase ?? null,
    currentBillingPlanCode: billingRef?.currentBillingPlanCode ?? null,
    currentCheckoutOffer: billingRef?.currentCheckoutOffer ?? null,
    scheduledBillingPlanCode: billingRef?.scheduledBillingPlanCode ?? null,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscriptionScheduleId:
      billingRef?.stripeSubscriptionScheduleId ?? null,
  };

  const sourceConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: START_PAID_PULSE_PLAN,
  });
  const targetRuntimeConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: input.targetPlanCode,
  });
  const targetPriceId = sourceDisposition === "recover_existing_claim"
    ? requireHostedPulseTrialPaidClaimPriceId(billingRef)
    : targetRuntimeConfig.priceId;
  const performStartPaidTransition = async (): Promise<
    HostedTrialContinueResult<TPlanCode>
  > => {
    const stripe = targetRuntimeConfig.stripe;
    if (sourceDisposition !== "recover_existing_claim") {
      await requireValidatedHostedStripeBillingPlanConfig({
        billingPlanCode: input.targetPlanCode,
      });
    }
    const subscription = await callHostedStripeStartPaidPulseOperation(
      "subscription.retrieve",
      () => stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: [...START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS],
      }),
    );

    assertHostedStripeSubscriptionMatchesCustomer({
      stripeCustomerId,
      subscription,
    });
    assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus({
      subscription,
    });

    const canResumePausedAutoTrial =
      subscription.status === "paused" &&
      isHostedPulseTrialBillingState({
        currentBillingPhase: billingRef?.currentBillingPhase,
        currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      });

    if (input.timing === "at_trial_end" && canResumePausedAutoTrial) {
      throw buildHostedPulseTrialContinueRequiresStartError();
    }

    const resolveExistingInvoiceResult = () => maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
      invoice: readExpandedLatestInvoice(subscription),
      memberId: input.memberId,
      now,
      priceId: targetPriceId,
      prisma,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription,
      targetPlanCode: input.targetPlanCode,
    });

    const transitionItems = buildHostedStripeTrialPaidPlanTransitionItems({
      sourcePriceId: sourceConfig.priceId,
      subscription,
      targetPriceId,
    });

    if (canStart && isHostedStripePulseTrialStartPaidPendingWithoutInvoiceProof(subscription)) {
      const pendingInvoiceResult = await resolveExistingInvoiceResult();
      return pendingInvoiceResult ?? {
        billingPlanCode: input.targetPlanCode,
        status: "billing_pending",
      };
    }

    const existingInvoiceResult = await resolveExistingInvoiceResult();
    if (existingInvoiceResult) {
      return existingInvoiceResult;
    }

    if (!canStart && !canResumePausedAutoTrial) {
      throw buildHostedPulseTrialStartPaidUnsupportedError();
    }

    if (canResumePausedAutoTrial) {
      const paymentMethodContinuation = resolveHostedPulseTrialPaymentMethodContinuation({
        continuation: input.paymentMethodContinuation,
        memberId: input.memberId,
        targetPlanCode: input.targetPlanCode,
        timing: input.timing,
      });
      const pausedStartResult = await resumeHostedPulseTrialStartPaidPausedSubscription({
        memberId: input.memberId,
        now,
        paymentMethodContinuation,
        priceId: targetPriceId,
        prisma,
        stripe,
        stripeCustomerId,
        stripeSubscriptionId,
        subscription,
        sourcePriceId: sourceConfig.priceId,
        targetPlanCode: input.targetPlanCode,
        trialEnd: billingRef?.currentTrialEndsAt ?? null,
      });

      if (pausedStartResult) {
        return pausedStartResult;
      }

      return reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure({
        memberId: input.memberId,
        now,
        priceId: targetPriceId,
        prisma,
        stripe,
        stripeCustomerId,
        stripeSubscriptionId,
        targetPlanCode: input.targetPlanCode,
      });
    }

    assertHostedMemberOwnActiveBillingAllowed(member);
    assertHostedStripePulseTrialSubscriptionCanStartPaid({
      now,
      subscription,
    });

    if (!hasHostedStripeSubscriptionPaymentMethod(subscription)) {
      const paymentMethodContinuation = resolveHostedPulseTrialPaymentMethodContinuation({
        continuation: input.paymentMethodContinuation,
        memberId: input.memberId,
        targetPlanCode: input.targetPlanCode,
        timing: input.timing,
      });
      return {
        billingPlanCode: input.targetPlanCode,
        paymentUrl: await createHostedPulseTrialStartPaidPaymentMethodPortalUrl({
          continuation: paymentMethodContinuation,
          now,
          stripe,
          stripeCustomerId,
        }),
        ...(paymentMethodContinuation?.kind === "settings"
          ? { resumeStartAfterPaymentMethodSetup: true as const }
          : {}),
        status: "payment_required",
      };
    }

    if (input.timing === "at_trial_end") {
      return {
        billingPlanCode: input.targetPlanCode,
        status: "continuing",
      };
    }

    const trialStartResult = await updateHostedPulseTrialStartPaidSubscription({
      authority: mutationAuthority,
      memberId: input.memberId,
      now,
      priceId: targetPriceId,
      prisma,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      targetPlanCode: input.targetPlanCode,
      transitionItems,
      trialEnd: billingRef?.currentTrialEndsAt ?? null,
    });

    if (trialStartResult) {
      return trialStartResult;
    }

    return reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure({
      memberId: input.memberId,
      now,
      priceId: targetPriceId,
      prisma,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      targetPlanCode: input.targetPlanCode,
    });
  };

  return withHostedStripeActionFailureAlert(
    {
      isTerminalStripeFailure: isHostedPulseTrialStartPaidTerminalStripeError,
      operationIdentity: buildHostedPulseTrialPaidPlanOperationIdentity({
        currentBillingPhase: billingRef?.currentBillingPhase ?? null,
        currentCheckoutOffer: billingRef?.currentCheckoutOffer ?? null,
        memberId: input.memberId,
        priceId: targetPriceId,
        stripeSubscriptionId,
        targetPlanCode: input.targetPlanCode,
        timing: input.timing,
        trialEnd: billingRef?.currentTrialEndsAt ?? null,
      }),
      operationName: "billing.start-paid-trial",
      stripeLiveMode: targetRuntimeConfig.stripeLiveMode,
    },
    performStartPaidTransition,
  );
}

function resolveHostedPulseTrialStartPaidSourceDisposition(input: {
  billingRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>;
  billingStatus: HostedBillingStatus;
  requireClaimableState?: boolean;
  targetPlanCode: HostedTrialPaidPlanCode;
}): "already_started" | "claim" | "recover_existing_claim" {
  const currentPlanCode = parseHostedBillingPlanCode(
    input.billingRef?.currentBillingPlanCode,
  );
  if (
    parseHostedBillingCheckoutOffer(input.billingRef?.currentCheckoutOffer) !==
      HOSTED_PULSE_TRIAL_OFFER
  ) {
    throw buildHostedPulseTrialStartPaidUnsupportedError();
  }

  const currentBillingPhase = parseHostedBillingPhase(
    input.billingRef?.currentBillingPhase,
  );
  if (
    input.billingStatus === HostedBillingStatus.active &&
    currentBillingPhase === "paid"
  ) {
    if (currentPlanCode === input.targetPlanCode) {
      return "already_started";
    }
    if (
      currentPlanCode === "launch_group_monthly" ||
      currentPlanCode === "launch_monthly"
    ) {
      throw buildHostedPulseTrialStartPaidChoiceChangedError();
    }
    throw buildHostedPulseTrialStartPaidUnsupportedError();
  }

  if (input.billingStatus === HostedBillingStatus.incomplete) {
    if (currentPlanCode === input.targetPlanCode) {
      return "recover_existing_claim";
    }
    if (
      currentPlanCode === "launch_group_monthly" ||
      currentPlanCode === "launch_monthly"
    ) {
      throw buildHostedPulseTrialStartPaidChoiceChangedError();
    }
    throw buildHostedPulseTrialStartPaidUnsupportedError();
  }

  const originalPulseTrial =
    currentPlanCode === START_PAID_PULSE_PLAN &&
    isHostedPulseTrialBillingState({
      currentBillingPhase: input.billingRef?.currentBillingPhase,
      currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    });
  if (originalPulseTrial && input.requireClaimableState !== true) {
    return "claim";
  }
  if (
    originalPulseTrial &&
    (
      input.billingStatus === HostedBillingStatus.paused ||
      input.billingStatus === HostedBillingStatus.active
    )
  ) {
    return "claim";
  }

  throw buildHostedPulseTrialStartPaidUnsupportedError();
}

function requireHostedPulseTrialPaidClaimPriceId(
  billingRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>,
): string {
  const priceId = billingRef?.pulseTrialPaidClaimPriceId;
  if (typeof priceId === "string" && priceId.length > 0) {
    return priceId;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
    httpStatus: 409,
    message:
      "Your saved plan price could not be confirmed. Contact support before retrying billing.",
  });
}

function buildHostedPulseTrialStartPaidUnsupportedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
    httpStatus: 409,
    message: "This Pulse update is only available while your Pulse trial is active.",
  });
}

function buildHostedPulseTrialContinueRequiresStartError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_CONTINUE_REQUIRES_START",
    httpStatus: 409,
    message:
      "Your Pulse trial has ended. Review the plan before starting paid Pulse.",
  });
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

function assertHostedStripePulseTrialSubscriptionCanStartPaid(input: {
  now: Date;
  subscription: Stripe.Subscription;
}): void {
  if (input.subscription.status !== "trialing") {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_STATE_UNSUPPORTED",
      httpStatus: 409,
      message: "Your Pulse trial is not ready to start paid billing.",
    });
  }

  assertHostedStripePulseTrialSubscriptionBillingShapeCanChange({
    subscription: input.subscription,
  });

  if (!isFutureUnixSecond(input.subscription.trial_end, input.now)) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_TRIAL_END_INVALID",
      httpStatus: 409,
      message: "Your trial end could not be confirmed.",
    });
  }
}

function isHostedStripePulseTrialStartPaidPendingWithoutInvoiceProof(
  subscription: Stripe.Subscription,
): boolean {
  return subscription.status === "active" ||
    subscription.status === "incomplete" ||
    subscription.status === "past_due" ||
    subscription.status === "unpaid";
}

function assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus(input: {
  subscription: Stripe.Subscription;
}): void {
  if (START_PAID_PULSE_RECOVERABLE_STRIPE_SUBSCRIPTION_STATUSES.has(input.subscription.status)) {
    return;
  }

  throw buildHostedPulseTrialStartPaidUnsupportedError();
}

function assertHostedStripePulseTrialSubscriptionCanResumePaid(input: {
  subscription: Stripe.Subscription;
}): void {
  if (input.subscription.status !== "paused") {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_STATE_UNSUPPORTED",
      httpStatus: 409,
      message: "Your Pulse trial is not ready to start paid billing.",
    });
  }

  assertHostedStripePulseTrialSubscriptionBillingShapeCanChange({
    subscription: input.subscription,
  });
}

function assertHostedStripePulseTrialSubscriptionBillingShapeCanChange(input: {
  subscription: Stripe.Subscription;
}): void {
  if (input.subscription.cancel_at_period_end) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_CANCELING",
      httpStatus: 409,
      message: "Your subscription is already scheduled to cancel. Open billing to manage it.",
    });
  }

  if (input.subscription.pending_update) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_PENDING_UPDATE",
      httpStatus: 409,
      message: "Your subscription already has a pending billing update.",
    });
  }

  if (coerceStripeObjectId(input.subscription.schedule)) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_SCHEDULE_UNSUPPORTED",
      httpStatus: 409,
      message: "Your subscription already has a scheduled billing change.",
    });
  }

  if (input.subscription.collection_method !== "charge_automatically") {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_METHOD_UNSUPPORTED",
      httpStatus: 409,
      message: "Your subscription billing settings are not ready to start paid billing.",
    });
  }

  if (input.subscription.pause_collection) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_PAUSED",
      httpStatus: 409,
      message: "Your subscription billing settings are not ready to start paid billing.",
    });
  }
}

async function createHostedPulseTrialStartPaidPaymentMethodPortalUrl(input: {
  continuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
  now: Date;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<string> {
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const returnUrl = new URL(START_PAID_PULSE_PAYMENT_METHOD_RETURN_PATH, publicBaseUrl).toString();
  const completedReturnUrl = buildHostedPulseTrialPaymentMethodCompletedReturnUrl({
    continuation: input.continuation,
    now: input.now,
    publicBaseUrl,
    settingsReturnUrl: returnUrl,
  });
  const session = await callHostedStripeStartPaidPulseOperation(
    "billingPortal.sessions.create.payment-method-update",
    () => input.stripe.billingPortal.sessions.create({
      customer: input.stripeCustomerId,
      flow_data: {
        after_completion: {
          redirect: {
            return_url: completedReturnUrl,
          },
          type: "redirect",
        },
        type: "payment_method_update",
      },
      return_url: returnUrl,
    }),
  );

  if (session.url) {
    return session.url;
  }

  throw hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_METHOD_URL_MISSING",
    httpStatus: 502,
    message: "Stripe did not return a billing setup link. Try again shortly.",
    retryable: true,
  });
}

function resolveHostedPulseTrialPaymentMethodContinuation(input: {
  continuation: HostedPulseTrialPaidPlanInput["paymentMethodContinuation"];
  memberId: string;
  targetPlanCode: HostedTrialPaidPlanCode;
  timing: "at_trial_end" | "now";
}): HostedPulseTrialPaymentMethodPortalContinuation | null {
  if (input.continuation === undefined) {
    return null;
  }

  // The legacy continuation contract can only resume Pulse. A Group payment
  // setup therefore returns to a marked Settings receipt. Settings derives
  // whether to recover an exact committed claim or request a fresh choice from
  // the canonical billing projection.
  if (input.targetPlanCode === "launch_group_monthly") {
    return { kind: "settings_group" };
  }

  if (input.continuation === "settings") {
    if (input.timing !== "now") {
      throw new TypeError(
        "Settings payment continuation is only valid for starting Pulse now.",
      );
    }
    return { kind: "settings" };
  }

  return {
    action: input.timing === "now" ? "start_pulse_now" : "continue_pulse",
    kind: "conversation",
    memberId: input.memberId,
  };
}

function buildHostedPulseTrialPaymentMethodCompletedReturnUrl(input: {
  continuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
  now: Date;
  publicBaseUrl: string;
  settingsReturnUrl: string;
}): string {
  if (input.continuation?.kind === "conversation") {
    return buildHostedPulseTrialPaymentReturnUrl({
      action: input.continuation.action,
      memberId: input.continuation.memberId,
      now: input.now,
      publicBaseUrl: input.publicBaseUrl,
    });
  }

  const completedReturnUrl = new URL(input.settingsReturnUrl);
  if (input.continuation?.kind === "settings_group") {
    completedReturnUrl.searchParams.set(
      HOSTED_START_PAID_GROUP_RETURN_PARAM,
      HOSTED_START_PAID_GROUP_RETURN_VALUE,
    );
  }
  if (input.continuation?.kind === "settings") {
    completedReturnUrl.searchParams.set(
      HOSTED_START_PAID_PULSE_RETURN_PARAM,
      HOSTED_START_PAID_PULSE_RETURN_VALUE,
    );
  }
  return completedReturnUrl.toString();
}

function buildHostedStripeTrialPaidPlanTransitionItems(input: {
  sourcePriceId: string;
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): Stripe.SubscriptionUpdateParams.Item[] {
  const activeItems = input.subscription.items.data;
  const acceptedRecurringPriceIds = new Set([
    input.sourcePriceId,
    input.targetPriceId,
  ]);
  const recurringItems = activeItems.filter((item) =>
    acceptedRecurringPriceIds.has(item.price?.id ?? "")
  );

  if (activeItems.length !== 1 || recurringItems.length !== 1) {
    throw buildHostedPulseTrialStartPaidItemError();
  }

  const recurringItem = recurringItems[0];

  if (
    recurringItem.price.recurring?.interval !== "month" ||
    recurringItem.price.recurring?.usage_type === "metered" ||
    recurringItem.quantity !== 1
  ) {
    throw buildHostedPulseTrialStartPaidItemError();
  }

  return recurringItem.price.id === input.targetPriceId
    ? []
    : [{
        id: recurringItem.id,
        price: input.targetPriceId,
        quantity: 1,
      }];
}

function buildHostedStripePausedResumeTransitionItems(input: {
  sourcePriceId: string;
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): Stripe.SubscriptionUpdateParams.Item[] {
  buildHostedStripeTrialPaidPlanTransitionItems(input);
  const recurringItem = input.subscription.items.data[0];
  if (!recurringItem) {
    throw buildHostedPulseTrialStartPaidItemError();
  }
  return [{
    id: recurringItem.id,
    price: input.targetPriceId,
    quantity: 1,
  }];
}

function buildHostedPulseTrialStartPaidItemError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
    httpStatus: 409,
    message: "Your subscription has billing items that are not supported by this change.",
  });
}

function assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape(input: {
  priceId: string;
  subscription: Stripe.Subscription;
}): void {
  buildHostedStripeTrialPaidPlanTransitionItems({
    sourcePriceId: input.priceId,
    subscription: input.subscription,
    targetPriceId: input.priceId,
  });
}

async function maybeResolveHostedPulseTrialStartPaidInvoiceResult<
  TPlanCode extends HostedTrialPaidPlanCode,
>(input: {
  invoice: Stripe.Invoice | null;
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: TPlanCode;
}): Promise<HostedTrialStartPaidResult<TPlanCode> | null> {
  if (!input.invoice || !isHostedPulseTrialStartPaidInvoiceForSubscription({
    expectedPriceId: input.priceId,
    invoice: input.invoice,
    stripeSubscriptionId: input.stripeSubscriptionId,
  })) {
    return null;
  }

  assertHostedPulseTrialStartPaidInvoiceMatchesCustomer({
    invoice: input.invoice,
    stripeCustomerId: input.stripeCustomerId,
  });

  if (input.invoice.status === "paid") {
    await reconcileHostedPulseTrialStartPaidInvoice({
      invoice: input.invoice,
      memberId: input.memberId,
      now: input.now,
      prisma: input.prisma,
      subscription: input.subscription,
    });

    return await hasHostedPulseTrialStartPaidLocallyStarted({
      memberId: input.memberId,
      prisma: input.prisma,
      targetPlanCode: input.targetPlanCode,
    })
      ? {
          billingPlanCode: input.targetPlanCode,
          status: "started",
        }
      : {
          billingPlanCode: input.targetPlanCode,
          status: "billing_pending",
        };
  }

  const paymentRequired = isHostedPulseTrialStartPaidPaymentRequired(input.invoice);
  const paymentUrl = readHostedPulseTrialStartPaidPaymentUrl(input.invoice);

  if (paymentUrl && paymentRequired) {
    return {
      billingPlanCode: input.targetPlanCode,
      paymentUrl,
      status: "payment_required",
    };
  }

  if (paymentRequired) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_URL_MISSING",
      httpStatus: 409,
      message: "Payment is required, but Stripe did not provide a payment link. Contact support.",
    });
  }

  if (
    input.invoice.status === "draft" ||
    input.invoice.status === "open" ||
    input.invoice.status === "uncollectible"
  ) {
    return {
      billingPlanCode: input.targetPlanCode,
      status: "billing_pending",
    };
  }

  return null;
}

async function maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult<
  TPlanCode extends HostedTrialPaidPlanCode,
>(input: {
  invoice: Stripe.Invoice | null;
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  targetPlanCode: TPlanCode;
}): Promise<HostedTrialStartPaidResult<TPlanCode> | null> {
  assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus({
    subscription: input.subscription,
  });

  if (!input.invoice || !isHostedPulseTrialStartPaidInvoiceForSubscription({
    expectedPriceId: input.priceId,
    invoice: input.invoice,
    stripeSubscriptionId: input.stripeSubscriptionId,
  })) {
    return null;
  }

  assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
    priceId: input.priceId,
    subscription: input.subscription,
  });

  return maybeResolveHostedPulseTrialStartPaidInvoiceResult(input);
}

interface HostedPulseTrialStartPaidMutationAuthority {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  scheduledBillingPlanCode: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeSubscriptionScheduleId: string | null;
}

async function assertHostedPulseTrialStartPaidMutationAuthorityTx(input: {
  authority: HostedPulseTrialStartPaidMutationAuthority;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [member, billingRef] = await Promise.all([
    readHostedMemberCoreState({ memberId: input.memberId, prisma: input.tx }),
    readHostedMemberStripeBillingRef({ memberId: input.memberId, prisma: input.tx }),
  ]);
  if (
    !member
    || member.suspendedAt
    || member.billingStatus !== input.authority.billingStatus
    || (billingRef?.currentBillingPhase ?? null)
      !== input.authority.currentBillingPhase
    || (billingRef?.currentBillingPlanCode ?? null)
      !== input.authority.currentBillingPlanCode
    || (billingRef?.currentCheckoutOffer ?? null)
      !== input.authority.currentCheckoutOffer
    || (billingRef?.scheduledBillingPlanCode ?? null)
      !== input.authority.scheduledBillingPlanCode
    || billingRef?.stripeCustomerId !== input.authority.stripeCustomerId
    || billingRef?.stripeSubscriptionId !== input.authority.stripeSubscriptionId
    || (billingRef?.stripeSubscriptionScheduleId ?? null)
      !== input.authority.stripeSubscriptionScheduleId
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_AUTHORITY_CHANGED",
      httpStatus: 409,
      message: "Billing changed before the trial could start paid service. Refresh and try again.",
      retryable: true,
    });
  }
}

async function updateHostedPulseTrialStartPaidSubscription<
  TPlanCode extends HostedTrialPaidPlanCode,
>(input: {
  authority: HostedPulseTrialStartPaidMutationAuthority;
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  targetPlanCode: TPlanCode;
  transitionItems: Stripe.SubscriptionUpdateParams.Item[];
  trialEnd: Date | null;
}): Promise<HostedTrialStartPaidResult<TPlanCode> | null> {
  let stripeMutationCompleted = false;

  try {
    const updatedSubscription = await withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma: input.prisma,
      run: async (tx) => {
        await assertHostedPulseTrialStartPaidMutationAuthorityTx({
          authority: input.authority,
          memberId: input.memberId,
          tx,
        });
        await assertHostedBillingPlanSelectable({
          memberId: input.memberId,
          prisma: tx,
          targetPlanCode: input.targetPlanCode,
        });
        const updateParams: Stripe.SubscriptionUpdateParams = {
          expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
          metadata: { murphTrialExtensionTargetTrialEnd: "" },
          payment_behavior: "allow_incomplete",
          trial_end: "now",
        };
        if (input.transitionItems.length > 0) {
          updateParams.items = input.transitionItems;
        }
        const subscription = await callHostedStripeStartPaidPulseOperation(
          "subscription.update.trial-end-now",
          () => input.stripe.subscriptions.update(input.stripeSubscriptionId, updateParams, {
            idempotencyKey: buildHostedPulseTrialStartPaidIdempotencyKey({
              memberId: input.memberId,
              operation: "active-trial-end-now-v2",
              priceId: input.priceId,
              stripeSubscriptionId: input.stripeSubscriptionId,
              trialEnd: input.trialEnd,
            }),
          }),
        );
        stripeMutationCompleted = true;
        return subscription;
      },
    });

    assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
      priceId: input.priceId,
      subscription: updatedSubscription,
    });

    const updatedInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
      invoice: readExpandedLatestInvoice(updatedSubscription),
      memberId: input.memberId,
      now: input.now,
      priceId: input.priceId,
      prisma: input.prisma,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscription: updatedSubscription,
      targetPlanCode: input.targetPlanCode,
    });

    return updatedInvoiceResult ?? {
      billingPlanCode: input.targetPlanCode,
      status: "billing_pending",
    };
  } catch (error) {
    if (
      !stripeMutationCompleted &&
      !isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error)
    ) {
      throw error;
    }

    return null;
  }
}

async function reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure<
  TPlanCode extends HostedTrialPaidPlanCode,
>(input: {
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  targetPlanCode: TPlanCode;
}): Promise<HostedTrialStartPaidResult<TPlanCode>> {
  const subscription = await callHostedStripeStartPaidPulseOperation(
    "subscription.retrieve.reconcile-trial-end-now",
    () => input.stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
      expand: [...START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS],
    }),
  );

  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId: input.stripeCustomerId,
    subscription,
  });
  assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus({
    subscription,
  });

  const existingInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
    invoice: readExpandedLatestInvoice(subscription),
    memberId: input.memberId,
    now: input.now,
    priceId: input.priceId,
    prisma: input.prisma,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription,
    targetPlanCode: input.targetPlanCode,
  });

  if (existingInvoiceResult) {
    return existingInvoiceResult;
  }

  // The first update may have committed even when Stripe returned a 5xx/network
  // failure. Do not issue the same paid transition under a fresh idempotency key.
  return {
    billingPlanCode: input.targetPlanCode,
    status: "billing_pending",
  };
}

async function resumeHostedPulseTrialStartPaidPausedSubscription<
  TPlanCode extends HostedTrialPaidPlanCode,
>(input: {
  memberId: string;
  now: Date;
  paymentMethodContinuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  sourcePriceId: string;
  targetPlanCode: TPlanCode;
  trialEnd: Date | null;
}): Promise<HostedTrialStartPaidResult<TPlanCode> | null> {
  assertHostedStripePulseTrialSubscriptionCanResumePaid({
    subscription: input.subscription,
  });

  const paymentMethodUpdate =
    readHostedStripeSubscriptionPaymentMethodUpdate(input.subscription);

  // Family acceptance uses the same member row lock. Commit the non-lapsed
  // fence and its exact target before a portal or provider mutation. The first
  // selection is therefore durable beyond Stripe's bounded idempotency cache,
  // and invoice reconciliation alone may promote the projection to `active`.
  const claimDisposition = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const lockedMember = await readHostedMemberCoreState({
        memberId: input.memberId,
        prisma: tx,
      });
      const lockedBillingRef = await readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma: tx,
      });
      if (!lockedMember) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_NOT_FOUND",
          httpStatus: 403,
          message: "Finish signup from your latest Murph link before continuing.",
        });
      }
      assertHostedMemberNotSuspended(lockedMember);
      if (
        lockedBillingRef?.stripeCustomerId !== input.stripeCustomerId ||
        lockedBillingRef?.stripeSubscriptionId !== input.stripeSubscriptionId
      ) {
        throw buildHostedPulseTrialStartPaidChoiceChangedError();
      }
      const lockedSourceDisposition =
        resolveHostedPulseTrialStartPaidSourceDisposition({
          billingRef: lockedBillingRef,
          billingStatus: lockedMember.billingStatus,
          requireClaimableState: true,
          targetPlanCode: input.targetPlanCode,
        });
      if (lockedSourceDisposition === "already_started") {
        return lockedSourceDisposition;
      }
      if (
        lockedSourceDisposition === "recover_existing_claim" &&
        lockedBillingRef?.pulseTrialPaidClaimPriceId !== input.priceId
      ) {
        throw buildHostedPulseTrialStartPaidChoiceChangedError();
      }
      const familyClaim = await readHostedMemberFamilyBillingClaim({
        memberId: input.memberId,
        prisma: tx,
      });
      if (familyClaim) {
        throw buildHostedFamilyBillingClaimError(familyClaim);
      }
      if (lockedSourceDisposition === "claim") {
        await assertHostedBillingPlanSelectable({
          memberId: input.memberId,
          prisma: tx,
          targetPlanCode: input.targetPlanCode,
        });
        await writeHostedMemberStripeBillingRefTx({
          currentBillingPlanCode: input.targetPlanCode,
          memberId: input.memberId,
          pulseTrialPaidClaimPriceId: input.priceId,
          tx,
        });
        await updateHostedMemberCoreState({
          billingStatus: HostedBillingStatus.incomplete,
          memberId: input.memberId,
          prisma: tx,
        });
      }
      return lockedSourceDisposition;
    },
  });
  if (claimDisposition === "already_started") {
    return {
      billingPlanCode: input.targetPlanCode,
      status: "started",
    };
  }

  if (!paymentMethodUpdate) {
    return {
      billingPlanCode: input.targetPlanCode,
      paymentUrl: await createHostedPulseTrialStartPaidPaymentMethodPortalUrl({
        continuation: input.paymentMethodContinuation,
        now: input.now,
        stripe: input.stripe,
        stripeCustomerId: input.stripeCustomerId,
      }),
      ...(input.paymentMethodContinuation?.kind === "settings"
        ? { resumeStartAfterPaymentMethodSetup: true as const }
        : {}),
      status: "payment_required",
    };
  }

  const paymentMethodId = "default_payment_method" in paymentMethodUpdate
    ? paymentMethodUpdate.default_payment_method
    : paymentMethodUpdate.default_source;
  let stripeMutationCompleted = false;

  try {
    const claimedTransitionItems =
      buildHostedStripePausedResumeTransitionItems({
        sourcePriceId: input.sourcePriceId,
        subscription: input.subscription,
        targetPriceId: input.priceId,
      });
    const cleanupParams: Stripe.SubscriptionUpdateParams = {
      expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
      items: claimedTransitionItems,
      metadata: {
        [PULSE_TRIAL_EXTENSION_TARGET_METADATA_KEY]: "",
      },
    };
    if (input.priceId !== input.sourcePriceId) {
      cleanupParams.proration_behavior = "none";
    }
    // Customer-level payment inheritance is made explicit here because
    // Resume does not accept either payment instrument field.
    if ("default_payment_method" in paymentMethodUpdate) {
      cleanupParams.default_payment_method =
        paymentMethodUpdate.default_payment_method;
    } else {
      cleanupParams.default_source = paymentMethodUpdate.default_source;
    }
    let cleanedSubscription: Stripe.Subscription;
    try {
      cleanedSubscription = await callHostedStripeStartPaidPulseOperation(
        "subscription.update.paused-pre-resume-cleanup",
        () => input.stripe.subscriptions.update(input.stripeSubscriptionId, cleanupParams, {
          idempotencyKey:
            buildHostedPulseTrialStartPaidCleanupIdempotencyKey({
              memberId: input.memberId,
              priceId: input.priceId,
              stripeSubscriptionId: input.stripeSubscriptionId,
              trialEnd: input.trialEnd,
            }),
        }),
      );
    } catch (error) {
      if (isHostedPulseTrialStartPaidIdempotencyConflict(error)) {
        throw buildHostedPulseTrialStartPaidChoiceChangedError();
      }
      throw error;
    }
    assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
      priceId: input.priceId,
      subscription: cleanedSubscription,
    });
    if (
      readHostedStripeSubscriptionPaymentMethodId(cleanedSubscription) !==
        paymentMethodId
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_STATE_UNSUPPORTED",
        httpStatus: 409,
        message: "Your subscription payment method could not be confirmed.",
      });
    }
    let resumedSubscription = cleanedSubscription;
    if (cleanedSubscription.status === "paused") {
      resumedSubscription = await callHostedStripeStartPaidPulseOperation(
        "subscription.resume.paused-trial",
        () => input.stripe.subscriptions.resume(
          input.stripeSubscriptionId,
          {
            billing_cycle_anchor: "now",
            expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
          },
          {
            idempotencyKey: buildHostedPulseTrialStartPaidIdempotencyKey({
              memberId: input.memberId,
              operation: "paused-resume-v2",
              priceId: input.priceId,
              stripeSubscriptionId: input.stripeSubscriptionId,
              trialEnd: input.trialEnd,
            }),
          },
        ),
      );
      stripeMutationCompleted = true;
    }
    assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
      priceId: input.priceId,
      subscription: resumedSubscription,
    });
    const resumedInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
      invoice: readExpandedLatestInvoice(resumedSubscription),
      memberId: input.memberId,
      now: input.now,
      priceId: input.priceId,
      prisma: input.prisma,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscription: resumedSubscription,
      targetPlanCode: input.targetPlanCode,
    });

    return resumedInvoiceResult ?? {
      billingPlanCode: input.targetPlanCode,
      status: "billing_pending",
    };
  } catch (error) {
    if (
      !stripeMutationCompleted &&
      !isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error)
    ) {
      throw error;
    }

    return null;
  }
}

async function hasHostedPulseTrialStartPaidLocallyStarted(input: {
  memberId: string;
  prisma: PrismaClient;
  targetPlanCode: HostedTrialPaidPlanCode;
}): Promise<boolean> {
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  return parseHostedBillingPlanCode(billingRef?.currentBillingPlanCode) ===
      input.targetPlanCode &&
    parseHostedBillingPhase(billingRef?.currentBillingPhase) === "paid";
}

async function reconcileHostedPulseTrialStartPaidInvoice(input: {
  invoice: Stripe.Invoice;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  subscription: Stripe.Subscription;
}): Promise<void> {
  const preparedCryptoDomainRoots =
    await prepareHostedCryptoDomainRootCandidates({
      prisma: input.prisma,
      userId: input.memberId,
    });
  const dispatchContext = buildHostedPulseTrialStartPaidDispatchContext(input);
  const outcome = await input.prisma.$transaction(async (tx) =>
    applyStripeInvoicePaid(
      input.invoice,
      dispatchContext,
      tx,
      HostedBillingStatus.active,
      input.subscription,
      preparedCryptoDomainRoots,
    ), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (outcome.cleanupFamilySponsoredStripeSubscriptionId) {
    await cleanupHostedFamilySponsoredDirectSubscription({
      memberId: input.memberId,
      prisma: input.prisma,
      sourceEventId: `${dispatchContext.sourceEventId}:family-sponsored-cleanup`,
      subscriptionId: outcome.cleanupFamilySponsoredStripeSubscriptionId,
    });
  }
  if (outcome.cleanupFamilySponsoredCheckout) {
    await cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId:
        outcome.cleanupFamilySponsoredCheckout.checkoutSessionId,
      memberId: input.memberId,
      prisma: input.prisma,
      sourceEventId: `${dispatchContext.sourceEventId}:family-sponsored-checkout-cleanup`,
      subscriptionId: outcome.cleanupFamilySponsoredCheckout.subscriptionId,
    });
  }

  await signalHostedRuntimeManualWakeBestEffort({
    userId: input.memberId,
  });
}

function isHostedPulseTrialStartPaidInvoiceForSubscription(input: {
  expectedPriceId: string;
  invoice: Stripe.Invoice;
  stripeSubscriptionId: string;
}): boolean {
  return coerceStripeInvoiceSubscriptionId(input.invoice) === input.stripeSubscriptionId &&
    readHostedStripeInvoiceBillingReason(input.invoice) !== "subscription_create" &&
    readHostedStripeInvoicePriceIds(input.invoice).includes(input.expectedPriceId);
}

function readHostedStripeInvoicePriceIds(invoice: Stripe.Invoice): string[] {
  return invoice.lines?.data.flatMap((line) => {
    const priceId = coerceStripeObjectId(
      line.pricing?.price_details?.price,
    );
    return priceId ? [priceId] : [];
  }) ?? [];
}

function assertHostedPulseTrialStartPaidInvoiceMatchesCustomer(input: {
  invoice: Stripe.Invoice;
  stripeCustomerId: string;
}): void {
  if (coerceStripeObjectId(input.invoice.customer) === input.stripeCustomerId) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
    httpStatus: 409,
    message: "Your subscription could not be matched to this hosted account.",
  });
}

function isHostedPulseTrialStartPaidPaymentRequired(invoice: Stripe.Invoice): boolean {
  const paymentIntent = readExpandedPaymentIntent(invoice);

  if (paymentIntent) {
    return paymentIntent.status === "requires_action" ||
      paymentIntent.status === "requires_confirmation" ||
      paymentIntent.status === "requires_payment_method";
  }

  // Resume can create an immediately payable hosted invoice before Stripe has
  // attempted an automatic charge or attached a PaymentIntent.
  return invoice.status === "open" &&
    typeof invoice.amount_remaining === "number" &&
    invoice.amount_remaining > 0;
}

function readHostedPulseTrialStartPaidPaymentUrl(invoice: Stripe.Invoice): string | null {
  return typeof invoice.hosted_invoice_url === "string" &&
    invoice.hosted_invoice_url.startsWith("https://")
    ? invoice.hosted_invoice_url
    : null;
}

function readExpandedLatestInvoice(subscription: Stripe.Subscription): Stripe.Invoice | null {
  const latestInvoice = subscription.latest_invoice;

  return latestInvoice && typeof latestInvoice === "object" ? latestInvoice : null;
}

function readExpandedPaymentIntent(invoice: Stripe.Invoice): Stripe.PaymentIntent | null {
  const paymentIntent = Reflect.get(invoice, "payment_intent");

  return paymentIntent && typeof paymentIntent === "object" ? paymentIntent : null;
}

function readHostedStripeInvoiceBillingReason(invoice: Stripe.Invoice): string | null {
  const value = (invoice as Stripe.Invoice & { billing_reason?: unknown }).billing_reason;
  return typeof value === "string" ? value : null;
}

function isFutureUnixSecond(value: number | null, now: Date): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value * 1000 > now.getTime();
}

function buildHostedPulseTrialStartPaidDispatchContext(input: {
  invoice: Stripe.Invoice;
  now: Date;
}): HostedStripeDispatchContext {
  const eventCreatedAt = input.now;

  return {
    eventCreatedAt,
    occurredAt: eventCreatedAt.toISOString(),
    sourceEventId: `stripe.invoice.paid:${input.invoice.id}`,
    sourceType: "stripe.invoice.paid",
  };
}

async function callHostedStripeStartPaidPulseOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logHostedStripeFailure({ error, operationName });
    throw hostedOnboardingError({
      cause: buildHostedStripeAlertCorrelationCause(error),
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      details: describeHostedStripeErrorDetails({ error, operationName }),
      httpStatus: 502,
      message: "Stripe billing is unavailable for starting Pulse right now. Try again shortly.",
      retryable: true,
    });
  }
}

function isHostedPulseTrialStartPaidStripeUnavailableError(error: unknown): error is HostedOnboardingError {
  return isHostedOnboardingError(error) &&
    error.code === "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE";
}

function isHostedPulseTrialStartPaidTerminalStripeError(
  error: unknown,
): boolean {
  return isHostedPulseTrialStartPaidStripeUnavailableError(error) ||
    (
      isHostedOnboardingError(error) &&
      error.code === "HOSTED_BILLING_PRICE_UNAVAILABLE"
    );
}

function buildHostedPulseTrialPaidPlanOperationIdentity(input: {
  currentBillingPhase: string | null;
  currentCheckoutOffer: string | null;
  memberId: string;
  priceId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedTrialPaidPlanCode;
  timing: "at_trial_end" | "now";
  trialEnd: Date | null;
}): string {
  return [
    buildHostedPulseTrialStartPaidIdempotencyKey({
      memberId: input.memberId,
      priceId: input.priceId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      trialEnd: input.trialEnd,
    }),
    input.targetPlanCode,
    input.timing,
    input.currentBillingPhase ?? "unknown-phase",
    input.currentCheckoutOffer ?? "unknown-offer",
  ].join(":");
}

function isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error: unknown): boolean {
  if (!isHostedPulseTrialStartPaidStripeUnavailableError(error)) {
    return false;
  }

  const statusCode = error.details?.statusCode;
  if (typeof statusCode === "number") {
    return statusCode >= 500;
  }

  const type = error.details?.type;
  if (
    typeof type === "string" &&
    START_PAID_PULSE_AMBIGUOUS_STRIPE_ERROR_TYPES.has(type)
  ) {
    return true;
  }

  const code = error.details?.code;
  return typeof code === "string" &&
    START_PAID_PULSE_AMBIGUOUS_STRIPE_ERROR_CODES.has(code);
}

function isHostedPulseTrialStartPaidIdempotencyConflict(error: unknown): boolean {
  if (!isHostedPulseTrialStartPaidStripeUnavailableError(error)) {
    return false;
  }
  const type = error.details?.type;
  const code = error.details?.code;
  return (type === "idempotency_error" || type === "StripeIdempotencyError")
    && code !== "idempotency_key_in_use";
}

function buildHostedPulseTrialStartPaidChoiceChangedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
    httpStatus: 409,
    message:
      "That plan choice is no longer current. Review the latest billing state before confirming again.",
  });
}

function buildHostedPulseTrialStartPaidIdempotencyKey(input: {
  memberId: string;
  operation?: HostedPulseTrialStartPaidIdempotencyOperation;
  priceId: string;
  stripeSubscriptionId: string;
  trialEnd: Date | null;
}): string {
  const keyPayload = {
    memberId: input.memberId,
    priceId: input.priceId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    trialEnd: input.trialEnd?.toISOString() ?? null,
  };

  return `hosted-billing-start-paid-pulse:${sha256Hex(JSON.stringify(input.operation
    ? {
        ...keyPayload,
        operation: input.operation,
      }
    : keyPayload))}`;
}

function buildHostedPulseTrialStartPaidCleanupIdempotencyKey(input: {
  memberId: string;
  priceId: string;
  stripeSubscriptionId: string;
  trialEnd: Date | null;
}): string {
  return `hosted-billing-start-paid-pulse:paused-cleanup:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    operation: "paused-pre-resume-v4",
    priceId: input.priceId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    trialEnd: input.trialEnd?.toISOString() ?? null,
  }))}`;
}
