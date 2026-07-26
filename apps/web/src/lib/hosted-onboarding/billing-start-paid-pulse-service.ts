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
} from "./billing-plans";
import {
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
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  applyStripeRecurringFinancialState,
  applyStripeInvoicePaid,
  applyStripeSubscriptionUpdated,
} from "./stripe-billing-events";
import {
  assertHostedStripeSubscriptionMatchesCustomer,
  buildHostedStripeSubscriptionMutationScope,
  buildHostedStripeTenderSubscriptionUpdate,
  classifyHostedStripeFailure,
  classifyHostedStripeInvoiceCollectionState,
  type HostedStripeInvoiceCollectionSnapshot,
  type HostedStripeTender,
  isHostedStripeTenderAppliedToSubscription,
  readHostedStripeBillingAttemptTender,
  readHostedStripeExpandedLatestInvoice,
  readHostedStripeSubscriptionTender,
  retrieveHostedStripeInvoiceCollectionSnapshot,
} from "./stripe-billing-state";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";
import {
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
} from "./stripe-error-log";
import { createHostedStripePortalSession } from "./stripe-portal";

const START_PAID_PULSE_PLAN = "launch_monthly";
const START_PAID_PULSE_PAYMENT_METHOD_RETURN_PATH = "/settings#subscription";
const START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS = [
  "customer",
  "items.data.price",
  "latest_invoice",
] as const;
const START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS = [
  "items.data.price",
  "latest_invoice",
] as const;
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
  | "active-trial-end-now-v3"
  | "paused-attach-tender-v1"
  | "paused-resume-v2";

export type HostedPulseTrialStartPaidResult =
  | {
    billingPlanCode: "launch_monthly";
    status: "billing_pending";
  }
  | {
    billingPlanCode: "launch_monthly";
    status: "started";
  }
  | {
    billingPlanCode: "launch_monthly";
    paymentUrl: string;
    resumeStartAfterPaymentMethodSetup?: true;
    status: "payment_required";
  };

export type HostedPulseTrialContinueResult =
  | HostedPulseTrialStartPaidResult
  | {
    billingPlanCode: "launch_monthly";
    status: "continuing";
  };

interface HostedPulseTrialPaidPlanInput {
  memberId: string;
  now?: Date;
  paymentMethodRecoveryConfirmed?: true;
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
  };

export async function startHostedPulseTrialPaidPlan(
  input: HostedPulseTrialStartPaidPlanInput,
): Promise<HostedPulseTrialStartPaidResult> {
  return transitionHostedPulseTrialPaidPlan({
    ...input,
    timing: "now",
  });
}

export async function continueHostedPulseTrialPaidPlan(
  input: HostedPulseTrialPaidPlanInput,
): Promise<HostedPulseTrialContinueResult> {
  return transitionHostedPulseTrialPaidPlan({
    ...input,
    timing: "at_trial_end",
  });
}

async function transitionHostedPulseTrialPaidPlan(
  input: HostedPulseTrialStartPaidPlanInput & { timing: "now" },
): Promise<HostedPulseTrialStartPaidResult>;
async function transitionHostedPulseTrialPaidPlan(
  input: HostedPulseTrialPaidPlanInput & { timing: "at_trial_end" },
): Promise<HostedPulseTrialContinueResult>;
async function transitionHostedPulseTrialPaidPlan(
  input: HostedPulseTrialStartPaidPlanInput & { timing: "at_trial_end" | "now" },
): Promise<HostedPulseTrialContinueResult> {
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

  assertHostedPulseTrialStartPaidRecoverableSourceState({ billingRef });
  const canStart =
    parseHostedBillingPhase(billingRef?.currentBillingPhase) === "trial";

  if (input.timing === "at_trial_end" && !canStart) {
    throw buildHostedPulseTrialStartPaidUnsupportedError();
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

  const pulseConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: START_PAID_PULSE_PLAN,
  });
  const stripe = pulseConfig.stripe;
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

  const existingInvoiceSnapshot =
    await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
      invoice: readHostedStripeExpandedLatestInvoice(subscription),
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
    });
  if (!canStart && !canResumePausedAutoTrial) {
    if (existingInvoiceSnapshot) {
      const collectionState = classifyHostedStripeInvoiceCollectionState(
        existingInvoiceSnapshot.invoice,
        existingInvoiceSnapshot.invoicePayments,
      );
      if (collectionState.kind !== "paid") {
        const recoveryResult =
          await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
            invoiceSnapshot: existingInvoiceSnapshot,
            memberId: input.memberId,
            now,
            priceId: pulseConfig.priceId,
            prisma,
            stripeCustomerId,
            stripeSubscriptionId,
            subscription,
          });
        if (recoveryResult) {
          return recoveryResult;
        }
      }
    }
    throw buildHostedPulseTrialStartPaidUnsupportedError();
  }

  const existingInvoiceResult =
    subscription.status !== "trialing" &&
      !(
        canResumePausedAutoTrial &&
        isHostedPulseTrialStartPaidZeroAmountPaidInvoice(
          existingInvoiceSnapshot?.invoice ?? null,
        )
      )
      ? await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
        invoiceSnapshot: existingInvoiceSnapshot,
        memberId: input.memberId,
        now,
        priceId: pulseConfig.priceId,
        prisma,
        stripeCustomerId,
        stripeSubscriptionId,
        subscription,
      })
      : null;
  buildHostedStripePulseTrialStartPaidLegacyMeteredItemDeletes({
    priceId: pulseConfig.priceId,
    subscription,
  });

  if (canStart && isHostedStripePulseTrialStartPaidPendingWithoutInvoiceProof(subscription)) {
    if (existingInvoiceResult) {
      return existingInvoiceResult;
    }
    throw buildHostedPulseTrialStartPaidInvoiceMissingError();
  }

  if (existingInvoiceResult) {
    return existingInvoiceResult;
  }

  const customerDefaultConfirmed =
    input.paymentMethodRecoveryConfirmed === true;
  const tender = readHostedStripeBillingAttemptTender(subscription, {
    customerDefaultConfirmed,
  });

  if (canResumePausedAutoTrial) {
    const paymentMethodContinuation = resolveHostedPulseTrialPaymentMethodContinuation({
      continuation: input.paymentMethodContinuation,
      memberId: input.memberId,
      timing: input.timing,
    });
    return resumeHostedPulseTrialStartPaidPausedSubscription({
      memberId: input.memberId,
      now,
      paymentMethodContinuation,
      priceId: pulseConfig.priceId,
      prisma,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription,
      tender,
      customerDefaultConfirmed,
    });
  }

  assertHostedMemberOwnActiveBillingAllowed(member);
  assertHostedStripePulseTrialSubscriptionCanStartPaid({
    now,
    subscription,
  });

  if (!tender) {
    const paymentMethodContinuation = resolveHostedPulseTrialPaymentMethodContinuation({
      continuation: input.paymentMethodContinuation,
      memberId: input.memberId,
      timing: input.timing,
    });
    return {
      billingPlanCode: START_PAID_PULSE_PLAN,
      paymentUrl:
        await createHostedPulseTrialStartPaidPaymentMethodPortalUrlWithLockedOwner({
        continuation: paymentMethodContinuation,
        memberId: input.memberId,
        mode: "active_trial",
        now,
        prisma,
        stripe,
        stripeCustomerId,
        stripeSubscriptionId,
      }),
      ...(paymentMethodContinuation?.kind === "settings"
        ? { resumeStartAfterPaymentMethodSetup: true as const }
        : {}),
      status: "payment_required",
    };
  }

  if (input.timing === "at_trial_end") {
    return {
      billingPlanCode: START_PAID_PULSE_PLAN,
      status: "continuing",
    };
  }

  return updateHostedPulseTrialStartPaidSubscription({
    customerDefaultConfirmed,
    memberId: input.memberId,
    now,
    priceId: pulseConfig.priceId,
    prisma,
    stripe,
    stripeCustomerId,
    stripeSubscriptionId,
  });
}

function isHostedPulseTrialStartPaidZeroAmountPaidInvoice(
  invoice: Stripe.Invoice | null,
): boolean {
  return invoice?.status === "paid" &&
    invoice.amount_due === 0 &&
    invoice.amount_paid === 0 &&
    invoice.total === 0;
}

function assertHostedPulseTrialStartPaidRecoverableSourceState(input: {
  billingRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>;
}): void {
  if (
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode) === START_PAID_PULSE_PLAN &&
    parseHostedBillingCheckoutOffer(input.billingRef?.currentCheckoutOffer) === HOSTED_PULSE_TRIAL_OFFER
  ) {
    return;
  }

  throw buildHostedPulseTrialStartPaidUnsupportedError();
}

function buildHostedPulseTrialStartPaidUnsupportedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
    httpStatus: 409,
    message: "This Pulse update is only available while your Pulse trial is active.",
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
    () => createHostedStripePortalSession({
      kind: "payment_recovery",
      params: {
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
      },
      stripe: input.stripe,
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

async function createHostedPulseTrialStartPaidPaymentMethodPortalUrlWithLockedOwner(
  input: {
    continuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
    memberId: string;
    mode: "active_trial" | "paused_trial";
    now: Date;
    prisma: PrismaClient;
    stripe: Stripe;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
): Promise<string> {
  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      await readHostedPulseTrialLockedBillingState({
        expectedStripeCustomerId: input.stripeCustomerId,
        expectedStripeSubscriptionId: input.stripeSubscriptionId,
        memberId: input.memberId,
        mode: input.mode,
        tx,
      });
      const lockedSubscription =
        await callHostedStripeStartPaidPulseOperation(
          "subscription.retrieve.locked-payment-method-portal",
          () => input.stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
            expand: [...START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS],
          }),
        );
      assertHostedStripeSubscriptionMatchesCustomer({
        stripeCustomerId: input.stripeCustomerId,
        subscription: lockedSubscription,
      });
      if (input.mode === "active_trial") {
        assertHostedStripePulseTrialSubscriptionCanStartPaid({
          now: input.now,
          subscription: lockedSubscription,
        });
      } else {
        assertHostedStripePulseTrialSubscriptionCanResumePaid({
          subscription: lockedSubscription,
        });
      }
      if (readHostedStripeSubscriptionTender(lockedSubscription)) {
        throw buildHostedPulseTrialStartPaidMutationStateChangedError();
      }

      return createHostedPulseTrialStartPaidPaymentMethodPortalUrl(input);
    },
  });
}

function resolveHostedPulseTrialPaymentMethodContinuation(input: {
  continuation: HostedPulseTrialPaidPlanInput["paymentMethodContinuation"];
  memberId: string;
  timing: "at_trial_end" | "now";
}): HostedPulseTrialPaymentMethodPortalContinuation | null {
  if (input.continuation === undefined) {
    return null;
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
  if (input.continuation?.kind === "settings") {
    completedReturnUrl.searchParams.set(
      HOSTED_START_PAID_PULSE_RETURN_PARAM,
      HOSTED_START_PAID_PULSE_RETURN_VALUE,
    );
  }
  return completedReturnUrl.toString();
}

function buildHostedStripePulseTrialStartPaidLegacyMeteredItemDeletes(input: {
  priceId: string;
  subscription: Stripe.Subscription;
}): Stripe.SubscriptionUpdateParams.Item[] {
  const activeItems = input.subscription.items.data;
  const recurringItems = activeItems.filter((item) => item.price?.id === input.priceId);

  if (recurringItems.length !== 1) {
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

  const legacyMeteredItems: Stripe.SubscriptionUpdateParams.Item[] = [];

  for (const item of activeItems) {
    if (item.id === recurringItem.id) {
      continue;
    }

    if (isHostedStripeLegacyAiUsageMeteredItem(item)) {
      legacyMeteredItems.push({
        deleted: true,
        id: item.id,
      });
      continue;
    }

    throw buildHostedPulseTrialStartPaidItemError();
  }

  return legacyMeteredItems;
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
  const legacyMeteredItems = buildHostedStripePulseTrialStartPaidLegacyMeteredItemDeletes(input);

  if (legacyMeteredItems.length > 0) {
    throw buildHostedPulseTrialStartPaidItemError();
  }
}

async function maybeResolveHostedPulseTrialStartPaidInvoiceResult(input: {
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): Promise<HostedPulseTrialStartPaidResult | null> {
  if (!input.invoiceSnapshot) {
    return null;
  }
  const invoice = input.invoiceSnapshot.invoice;

  assertHostedPulseTrialStartPaidInvoiceMatchesCustomer({
    invoice,
    stripeCustomerId: input.stripeCustomerId,
  });

  assertHostedPulseTrialStartPaidInvoiceMatchesSubscription({
    invoice,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  const collectionState = classifyHostedStripeInvoiceCollectionState(
    invoice,
    input.invoiceSnapshot.invoicePayments,
  );
  switch (collectionState.kind) {
    case "paid": {
      await reconcileHostedPulseTrialStartPaidInvoice({
        invoice,
        memberId: input.memberId,
        now: input.now,
        prisma: input.prisma,
        subscription: input.subscription,
      });

      if (await hasHostedPulseTrialStartPaidLocallyStarted({
        memberId: input.memberId,
        prisma: input.prisma,
      })) {
        return {
          billingPlanCode: START_PAID_PULSE_PLAN,
          status: "started",
        };
      }
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_START_PAID_RECONCILIATION_PENDING",
        httpStatus: 409,
        message: "Stripe confirmed payment, but the billing update has not reconciled yet. Try again shortly.",
        retryable: true,
      });
    }
    case "payment_required":
      if (collectionState.deadlineUnixSeconds * 1000 <= input.now.getTime()) {
        throw hostedOnboardingError({
          code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_TIMED_OUT",
          httpStatus: 409,
          message: "Stripe did not finish this invoice before its collection deadline. Open billing before retrying.",
        });
      }
      if (!collectionState.paymentUrl) {
        throw hostedOnboardingError({
          code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_URL_MISSING",
          httpStatus: 409,
          message: "Payment is required, but Stripe did not provide a payment link. Contact support.",
        });
      }
      return {
        billingPlanCode: START_PAID_PULSE_PLAN,
        paymentUrl: collectionState.paymentUrl,
        status: "payment_required",
      };
    case "none":
      throw buildHostedPulseTrialStartPaidInvoiceMissingError();
    case "processing":
      if (collectionState.deadlineUnixSeconds * 1000 <= input.now.getTime()) {
        throw hostedOnboardingError({
          code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_TIMED_OUT",
          httpStatus: 409,
          message: "Stripe did not finish this invoice before its collection deadline. Open billing before retrying.",
        });
      }
      return {
        billingPlanCode: START_PAID_PULSE_PLAN,
        status: "billing_pending",
      };
    case "voided":
      if (
        input.subscription.status === "paused" ||
        input.subscription.status === "trialing"
      ) {
        return null;
      }
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_START_PAID_ATTEMPT_EXPIRED",
        httpStatus: 409,
        message: "The last billing invoice expired. Open billing before trying again.",
      });
    case "uncollectible":
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_START_PAID_UNCOLLECTIBLE",
        httpStatus: 409,
        message: "Stripe marked this invoice uncollectible. Open billing to update payment before retrying.",
      });
    case "failed":
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_FAILED",
        details: collectionState.reason ? { reason: collectionState.reason } : undefined,
        httpStatus: 409,
        message: "Stripe could not complete this billing attempt. Open billing and try again.",
      });
  }
}

async function maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult(input: {
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): Promise<HostedPulseTrialStartPaidResult | null> {
  assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus({
    subscription: input.subscription,
  });

  if (!input.invoiceSnapshot) {
    return null;
  }

  assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
    priceId: input.priceId,
    subscription: input.subscription,
  });

  return maybeResolveHostedPulseTrialStartPaidInvoiceResult(input);
}

async function retrieveHostedPulseTrialStartPaidInvoiceSnapshot(input: {
  invoice: Stripe.Invoice | null;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<HostedStripeInvoiceCollectionSnapshot | null> {
  if (!input.invoice || !isHostedPulseTrialStartPaidInvoiceForSubscription({
    invoice: input.invoice,
    stripeSubscriptionId: input.stripeSubscriptionId,
  })) {
    return null;
  }
  const invoice = input.invoice;

  assertHostedPulseTrialStartPaidInvoiceMatchesCustomer({
    invoice,
    stripeCustomerId: input.stripeCustomerId,
  });
  const invoiceSnapshot = await callHostedStripeStartPaidPulseOperation(
    "invoice.retrieve.collection-state",
    () =>
      retrieveHostedStripeInvoiceCollectionSnapshot({
        invoiceId: invoice.id,
        stripe: input.stripe,
      }),
  );
  assertHostedPulseTrialStartPaidInvoiceMatchesSubscription({
    invoice: invoiceSnapshot.invoice,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  assertHostedPulseTrialStartPaidInvoiceMatchesCustomer({
    invoice: invoiceSnapshot.invoice,
    stripeCustomerId: input.stripeCustomerId,
  });
  return invoiceSnapshot;
}

async function readHostedPulseTrialLockedBillingState(input: {
  expectedStripeCustomerId: string;
  expectedStripeSubscriptionId: string;
  memberId: string;
  mode: "active_trial" | "paused_trial";
  tx: Prisma.TransactionClient;
}): Promise<NonNullable<Awaited<
  ReturnType<typeof readHostedMemberStripeBillingRef>
>>> {
  const [member, billingRef] = await Promise.all([
    readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: input.tx,
    }),
  ]);
  if (!member || !billingRef) {
    throw buildHostedPulseTrialStartPaidMutationStateChangedError();
  }
  assertHostedMemberNotSuspended(member);

  const ownsExpectedStripeObjects =
    billingRef.stripeCustomerId === input.expectedStripeCustomerId &&
    billingRef.stripeSubscriptionId === input.expectedStripeSubscriptionId;
  if (!ownsExpectedStripeObjects) {
    throw buildHostedPulseTrialStartPaidMutationStateChangedError();
  }

  assertHostedPulseTrialStartPaidRecoverableSourceState({ billingRef });
  const ownsExpectedBillingPhase = input.mode === "active_trial"
    ? parseHostedBillingPhase(billingRef.currentBillingPhase) === "trial"
    : isHostedPulseTrialBillingState({
        currentBillingPhase: billingRef.currentBillingPhase,
        currentCheckoutOffer: billingRef.currentCheckoutOffer,
      });
  if (!ownsExpectedBillingPhase) {
    throw buildHostedPulseTrialStartPaidMutationStateChangedError();
  }
  if (input.mode === "active_trial") {
    assertHostedMemberOwnActiveBillingAllowed(member);
  }

  return billingRef;
}

function buildHostedPulseTrialStartPaidMutationStateChangedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_STATE_CHANGED",
    httpStatus: 409,
    message: "Your billing state changed. Check it again before retrying.",
    retryable: true,
  });
}

function buildHostedPulseTrialStartPaidInvoiceMissingError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_INVOICE_MISSING",
    httpStatus: 409,
    message: "Stripe did not provide the exact invoice for this billing attempt.",
  });
}

function buildHostedPulseTrialStartPaidPreexistingInvoiceConflictError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_PREEXISTING_INVOICE_CONFLICT",
    httpStatus: 409,
    message: "Stripe has another invoice in progress for this trial. Open billing before starting paid Pulse.",
  });
}

function buildHostedPulseTrialStartPaidInvoiceFreeResumeError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_RESUMED_WITHOUT_INVOICE",
    httpStatus: 409,
    message: "Stripe resumed this subscription without creating a payment invoice. Open billing before retrying.",
  });
}

function buildHostedPulseTrialStartPaidOutcomeUnconfirmedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
    httpStatus: 502,
    message: "Stripe did not confirm this billing change. Try again shortly.",
    retryable: true,
  });
}

function readHostedPulseTrialStartPaidCreatedInvoice(input: {
  previousLatestInvoiceId: string | null;
  subscription: Stripe.Subscription;
}): Stripe.Invoice | null {
  const invoice = readHostedStripeExpandedLatestInvoice(input.subscription);
  return invoice && invoice.id !== input.previousLatestInvoiceId
    ? invoice
    : null;
}

async function updateHostedPulseTrialStartPaidSubscription(input: {
  customerDefaultConfirmed: boolean;
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<HostedPulseTrialStartPaidResult> {
  let previousLatestInvoiceId: string | null = null;
  let stripeMutationAttempted = false;
  let stripeMutationCompleted = false;

  try {
    const transition = await withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma: input.prisma,
      run: async (tx) => {
        const lockedBillingRef = await readHostedPulseTrialLockedBillingState({
          expectedStripeCustomerId: input.stripeCustomerId,
          expectedStripeSubscriptionId: input.stripeSubscriptionId,
          memberId: input.memberId,
          mode: "active_trial",
          tx,
        });
        const canonicalSubscription =
          await callHostedStripeStartPaidPulseOperation(
            "subscription.retrieve.locked-trial-end-now",
            () => input.stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
              expand: [...START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS],
            }),
          );
        assertHostedStripeSubscriptionMatchesCustomer({
          stripeCustomerId: input.stripeCustomerId,
          subscription: canonicalSubscription,
        });
        assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus({
          subscription: canonicalSubscription,
        });

        previousLatestInvoiceId = coerceStripeObjectId(
          canonicalSubscription.latest_invoice,
        );
        const existingInvoiceSnapshot =
          await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
            invoice: readHostedStripeExpandedLatestInvoice(canonicalSubscription),
            stripe: input.stripe,
            stripeCustomerId: input.stripeCustomerId,
            stripeSubscriptionId: input.stripeSubscriptionId,
          });
        if (canonicalSubscription.status !== "trialing") {
          if (
            isHostedStripePulseTrialStartPaidPendingWithoutInvoiceProof(
              canonicalSubscription,
            )
          ) {
            if (!existingInvoiceSnapshot) {
              throw buildHostedPulseTrialStartPaidInvoiceMissingError();
            }
            return {
              invoiceSnapshot: existingInvoiceSnapshot,
              subscription: canonicalSubscription,
            };
          }
          throw buildHostedPulseTrialStartPaidMutationStateChangedError();
        }

        assertHostedStripePulseTrialSubscriptionCanStartPaid({
          now: input.now,
          subscription: canonicalSubscription,
        });
        if (existingInvoiceSnapshot) {
          const existingCollectionState =
            classifyHostedStripeInvoiceCollectionState(
              existingInvoiceSnapshot.invoice,
              existingInvoiceSnapshot.invoicePayments,
            );
          if (
            existingCollectionState.kind !== "paid" &&
            existingCollectionState.kind !== "voided"
          ) {
            throw buildHostedPulseTrialStartPaidPreexistingInvoiceConflictError();
          }
        }

        const tender = readHostedStripeBillingAttemptTender(
          canonicalSubscription,
          {
            customerDefaultConfirmed: input.customerDefaultConfirmed,
          },
        );
        if (!tender) {
          throw buildHostedPulseTrialStartPaidMutationStateChangedError();
        }
        const legacyMeteredItems =
          buildHostedStripePulseTrialStartPaidLegacyMeteredItemDeletes({
            priceId: input.priceId,
            subscription: canonicalSubscription,
          });
        stripeMutationAttempted = true;
        const updatedSubscription = await callHostedStripeStartPaidPulseOperation(
          "subscription.update.trial-end-now",
          () => input.stripe.subscriptions.update(input.stripeSubscriptionId, {
            ...buildHostedStripeTenderSubscriptionUpdate(tender),
            expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
            ...(legacyMeteredItems.length > 0 ? { items: legacyMeteredItems } : {}),
            metadata: { murphTrialExtensionTargetTrialEnd: "" },
            payment_behavior: "allow_incomplete",
            trial_end: "now",
          }, {
            idempotencyKey: buildHostedPulseTrialStartPaidIdempotencyKey({
              memberId: input.memberId,
              operation: "active-trial-end-now-v3",
              priceId: input.priceId,
              providerState: buildHostedPulseTrialProviderState({
                invoiceSnapshot: existingInvoiceSnapshot,
                subscription: canonicalSubscription,
                tender,
              }),
              stripeSubscriptionId: input.stripeSubscriptionId,
              trialEnd: lockedBillingRef.currentTrialEndsAt ?? null,
            }),
          }),
        );
        stripeMutationCompleted = true;
        assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
          priceId: input.priceId,
          subscription: updatedSubscription,
        });
        if (!isHostedStripeTenderAppliedToSubscription({
          subscription: updatedSubscription,
          tender,
        })) {
          throw hostedOnboardingError({
            code: "HOSTED_PULSE_TRIAL_START_PAID_TENDER_NOT_ATTACHED",
            httpStatus: 409,
            message: "Stripe did not attach the saved payment method to this subscription.",
          });
        }

        const updatedInvoice =
          readHostedPulseTrialStartPaidCreatedInvoice({
            previousLatestInvoiceId,
            subscription: updatedSubscription,
          });
        const updatedInvoiceSnapshot =
          await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
            invoice: updatedInvoice,
            stripe: input.stripe,
            stripeCustomerId: input.stripeCustomerId,
            stripeSubscriptionId: input.stripeSubscriptionId,
          });
        if (!updatedInvoiceSnapshot) {
          throw buildHostedPulseTrialStartPaidInvoiceMissingError();
        }
        return {
          invoiceSnapshot: updatedInvoiceSnapshot,
          subscription: updatedSubscription,
        };
      },
    });

    const updatedInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
      invoiceSnapshot: transition.invoiceSnapshot,
      memberId: input.memberId,
      now: input.now,
      priceId: input.priceId,
      prisma: input.prisma,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscription: transition.subscription,
    });

    if (!updatedInvoiceResult) {
      throw buildHostedPulseTrialStartPaidInvoiceMissingError();
    }
    return updatedInvoiceResult;
  } catch (error) {
    if (
      (
        !stripeMutationAttempted ||
        (
          !stripeMutationCompleted &&
          !isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error)
        )
      ) ||
      (
        isHostedPulseTrialStartPaidStripeUnavailableError(error) &&
        !error.retryable
      ) ||
      isHostedPulseTrialStartPaidNonReconciliableError(error)
    ) {
      throw error;
    }

    return reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure({
      memberId: input.memberId,
      now: input.now,
      previousLatestInvoiceId,
      priceId: input.priceId,
      prisma: input.prisma,
      stripe: input.stripe,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    });
  }
}

async function reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure(input: {
  memberId: string;
  now: Date;
  previousLatestInvoiceId: string | null;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<HostedPulseTrialStartPaidResult> {
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

  const invoiceSnapshot =
    await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
      invoice: readHostedPulseTrialStartPaidCreatedInvoice({
        previousLatestInvoiceId: input.previousLatestInvoiceId,
        subscription,
      }),
      stripe: input.stripe,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    });
  const existingInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
    invoiceSnapshot,
    memberId: input.memberId,
    now: input.now,
    priceId: input.priceId,
    prisma: input.prisma,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription,
  });

  if (existingInvoiceResult) {
    return existingInvoiceResult;
  }

  if (
    isHostedStripePulseTrialStartPaidPendingWithoutInvoiceProof(subscription)
  ) {
    throw buildHostedPulseTrialStartPaidInvoiceMissingError();
  }

  // The first mutation may have failed before Stripe committed it. The caller
  // can safely retry because unchanged canonical provider state yields the same
  // idempotency key; do not call an object-less wait "billing pending."
  throw buildHostedPulseTrialStartPaidOutcomeUnconfirmedError();
}

async function resumeHostedPulseTrialStartPaidPausedSubscription(input: {
  customerDefaultConfirmed: boolean;
  memberId: string;
  now: Date;
  paymentMethodContinuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  tender: HostedStripeTender | null;
}): Promise<HostedPulseTrialStartPaidResult> {
  assertHostedStripePulseTrialSubscriptionCanResumePaid({
    subscription: input.subscription,
  });

  if (!input.tender) {
    return {
      billingPlanCode: START_PAID_PULSE_PLAN,
      paymentUrl:
        await createHostedPulseTrialStartPaidPaymentMethodPortalUrlWithLockedOwner({
        continuation: input.paymentMethodContinuation,
        memberId: input.memberId,
        mode: "paused_trial",
        now: input.now,
        prisma: input.prisma,
        stripe: input.stripe,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
      }),
      ...(input.paymentMethodContinuation?.kind === "settings"
        ? { resumeStartAfterPaymentMethodSetup: true as const }
        : {}),
      status: "payment_required",
    };
  }

  let previousLatestInvoiceId: string | null = null;
  let stripeMutationAttempted = false;
  let stripeMutationCompleted = false;

  try {
    const resumedTransition = await withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma: input.prisma,
      run: async (tx) => {
        const lockedBillingRef = await readHostedPulseTrialLockedBillingState({
          expectedStripeCustomerId: input.stripeCustomerId,
          expectedStripeSubscriptionId: input.stripeSubscriptionId,
          memberId: input.memberId,
          mode: "paused_trial",
          tx,
        });
        const lockedSubscription =
          await callHostedStripeStartPaidPulseOperation(
            "subscription.retrieve.locked-paused-resume",
            () => input.stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
              expand: [...START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS],
            }),
          );
        assertHostedStripeSubscriptionMatchesCustomer({
          stripeCustomerId: input.stripeCustomerId,
          subscription: lockedSubscription,
        });
        assertHostedStripePulseTrialStartPaidRecoverableSubscriptionStatus({
          subscription: lockedSubscription,
        });
        previousLatestInvoiceId = coerceStripeObjectId(
          lockedSubscription.latest_invoice,
        );
        const existingInvoiceSnapshot =
          await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
            invoice: readHostedStripeExpandedLatestInvoice(lockedSubscription),
            stripe: input.stripe,
            stripeCustomerId: input.stripeCustomerId,
            stripeSubscriptionId: input.stripeSubscriptionId,
          });
        if (lockedSubscription.status !== "paused") {
          throw buildHostedPulseTrialStartPaidMutationStateChangedError();
        }
        assertHostedStripePulseTrialSubscriptionCanResumePaid({
          subscription: lockedSubscription,
        });
        if (existingInvoiceSnapshot) {
          const existingCollectionState =
            classifyHostedStripeInvoiceCollectionState(
              existingInvoiceSnapshot.invoice,
              existingInvoiceSnapshot.invoicePayments,
            );
          if (
            existingCollectionState.kind !== "paid" &&
            existingCollectionState.kind !== "voided"
          ) {
            throw buildHostedPulseTrialStartPaidPreexistingInvoiceConflictError();
          }
        }

        const tender = readHostedStripeBillingAttemptTender(
          lockedSubscription,
          {
            customerDefaultConfirmed: input.customerDefaultConfirmed,
          },
        );
        if (!tender) {
          throw buildHostedPulseTrialStartPaidMutationStateChangedError();
        }
        const legacyMeteredItems =
          buildHostedStripePulseTrialStartPaidLegacyMeteredItemDeletes({
            priceId: input.priceId,
            subscription: lockedSubscription,
          });
        const providerState = buildHostedPulseTrialProviderState({
          invoiceSnapshot: existingInvoiceSnapshot,
          subscription: lockedSubscription,
          tender,
        });

        let attachFailure: unknown = null;
        let cleanedSubscription: Stripe.Subscription | null = null;
        stripeMutationAttempted = true;
        try {
          cleanedSubscription = await callHostedStripeStartPaidPulseOperation(
            "subscription.update.paused-pre-resume-cleanup",
            // Stripe rejects `proration_behavior` outright while a subscription is
            // paused ("Resume the subscription first"), so it may only ride along
            // with the item deletes it exists for.
            () => input.stripe.subscriptions.update(input.stripeSubscriptionId, {
              ...buildHostedStripeTenderSubscriptionUpdate(tender),
              expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
              ...(legacyMeteredItems.length > 0
                ? {
                  items: legacyMeteredItems,
                  proration_behavior: "none" as const,
                }
                : {}),
              metadata: {
                [PULSE_TRIAL_EXTENSION_TARGET_METADATA_KEY]: "",
              },
            }, {
              idempotencyKey: buildHostedPulseTrialStartPaidIdempotencyKey({
                memberId: input.memberId,
                operation: "paused-attach-tender-v1",
                priceId: input.priceId,
                providerState,
                stripeSubscriptionId: input.stripeSubscriptionId,
                trialEnd: lockedBillingRef.currentTrialEndsAt ?? null,
              }),
            }),
          );
        } catch (error) {
          if (!isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error)) {
            throw error;
          }
          attachFailure = error;
        }

        cleanedSubscription ??=
          await callHostedStripeStartPaidPulseOperation(
            "subscription.retrieve.after-paused-pre-resume-cleanup",
            () =>
              input.stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
                expand: [...START_PAID_PULSE_STRIPE_RETRIEVE_EXPANSIONS],
              }),
          );
        assertHostedStripeSubscriptionMatchesCustomer({
          stripeCustomerId: input.stripeCustomerId,
          subscription: cleanedSubscription,
        });
        const tenderApplied = isHostedStripeTenderAppliedToSubscription({
          subscription: cleanedSubscription,
          tender,
        });
        const remainingItemIds = new Set(
          cleanedSubscription.items.data.map((item) => item.id),
        );
        const expectedDeletedItemRemains = legacyMeteredItems.some(
          (item) => typeof item.id === "string" &&
            remainingItemIds.has(item.id),
        );
        const extensionTargetRemains =
          cleanedSubscription.metadata[
            PULSE_TRIAL_EXTENSION_TARGET_METADATA_KEY
          ]?.length > 0;
        if (
          attachFailure &&
          (
            !tenderApplied ||
            expectedDeletedItemRemains ||
            extensionTargetRemains
          )
        ) {
          throw attachFailure;
        }
        assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
          priceId: input.priceId,
          subscription: cleanedSubscription,
        });
        if (!tenderApplied) {
          if (attachFailure) {
            throw attachFailure;
          }
          throw hostedOnboardingError({
            code: "HOSTED_PULSE_TRIAL_START_PAID_TENDER_NOT_ATTACHED",
            httpStatus: 409,
            message: "Stripe did not attach the saved payment method to this subscription.",
          });
        }
        if (cleanedSubscription.status !== "paused") {
          stripeMutationCompleted = true;
          const createdInvoice =
            readHostedPulseTrialStartPaidCreatedInvoice({
              previousLatestInvoiceId,
              subscription: cleanedSubscription,
            });
          if (!createdInvoice && cleanedSubscription.status === "active") {
            const projected =
              await reconcileHostedPulseTrialStartPaidInvoiceFreeResume({
              memberId: input.memberId,
              now: input.now,
              stripeCustomerId: input.stripeCustomerId,
              subscription: cleanedSubscription,
              tx,
            });
            if (!projected) {
              return {
                kind: "financially_blocked" as const,
                subscription: cleanedSubscription,
              };
            }
            return {
              kind: "invoice_free" as const,
              subscription: cleanedSubscription,
            };
          }
          if (!createdInvoice) {
            throw buildHostedPulseTrialStartPaidOutcomeUnconfirmedError();
          }
          return {
            kind: "invoice" as const,
            invoiceSnapshot:
              await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
                invoice: createdInvoice,
                stripe: input.stripe,
                stripeCustomerId: input.stripeCustomerId,
                stripeSubscriptionId: input.stripeSubscriptionId,
              }),
            subscription: cleanedSubscription,
          };
        }

        const resumeParams: Stripe.SubscriptionResumeParams = {
          billing_cycle_anchor: "now",
          expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
        };
        const canonicalSubscription = await callHostedStripeStartPaidPulseOperation(
          "subscription.resume.paused-trial",
          () => input.stripe.subscriptions.resume(input.stripeSubscriptionId, resumeParams, {
            idempotencyKey: buildHostedPulseTrialStartPaidIdempotencyKey({
              memberId: input.memberId,
              operation: "paused-resume-v2",
              priceId: input.priceId,
              providerState: buildHostedStripeSubscriptionMutationScope(
                cleanedSubscription,
              ),
              stripeSubscriptionId: input.stripeSubscriptionId,
              trialEnd: lockedBillingRef.currentTrialEndsAt ?? null,
            }),
          }),
        );
        stripeMutationCompleted = true;
        assertHostedStripeSubscriptionMatchesCustomer({
          stripeCustomerId: input.stripeCustomerId,
          subscription: canonicalSubscription,
        });
        assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
          priceId: input.priceId,
          subscription: canonicalSubscription,
        });

        const createdInvoice =
          readHostedPulseTrialStartPaidCreatedInvoice({
            previousLatestInvoiceId,
            subscription: canonicalSubscription,
          });
        if (!createdInvoice && canonicalSubscription.status === "active") {
          const projected =
            await reconcileHostedPulseTrialStartPaidInvoiceFreeResume({
            memberId: input.memberId,
            now: input.now,
            stripeCustomerId: input.stripeCustomerId,
            subscription: canonicalSubscription,
            tx,
          });
          if (!projected) {
            return {
              kind: "financially_blocked" as const,
              subscription: canonicalSubscription,
            };
          }
          return {
            kind: "invoice_free" as const,
            subscription: canonicalSubscription,
          };
        }
        if (!createdInvoice) {
          throw buildHostedPulseTrialStartPaidOutcomeUnconfirmedError();
        }

        const invoiceSnapshot =
          await retrieveHostedPulseTrialStartPaidInvoiceSnapshot({
            invoice: createdInvoice,
            stripe: input.stripe,
            stripeCustomerId: input.stripeCustomerId,
            stripeSubscriptionId: input.stripeSubscriptionId,
          });
        if (!invoiceSnapshot) {
          throw buildHostedPulseTrialStartPaidInvoiceMissingError();
        }

        return {
          kind: "invoice" as const,
          invoiceSnapshot,
          subscription: canonicalSubscription,
        };
      },
    });
    assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
      priceId: input.priceId,
      subscription: resumedTransition.subscription,
    });
    if (resumedTransition.kind === "financially_blocked") {
      throw buildHostedPulseTrialStartPaidFinancialStateBlockedError();
    }
    if (resumedTransition.kind === "invoice_free") {
      throw buildHostedPulseTrialStartPaidInvoiceFreeResumeError();
    }
    const resumedInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
      invoiceSnapshot: resumedTransition.invoiceSnapshot,
      memberId: input.memberId,
      now: input.now,
      priceId: input.priceId,
      prisma: input.prisma,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscription: resumedTransition.subscription,
    });

    if (!resumedInvoiceResult) {
      throw buildHostedPulseTrialStartPaidInvoiceMissingError();
    }
    return resumedInvoiceResult;
  } catch (error) {
    if (
      (
        !stripeMutationAttempted ||
        (
          !stripeMutationCompleted &&
          !isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error)
        )
      ) ||
      (
        isHostedPulseTrialStartPaidStripeUnavailableError(error) &&
        !error.retryable
      ) ||
      isHostedPulseTrialStartPaidNonReconciliableError(error)
    ) {
      throw error;
    }

    return reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure({
      memberId: input.memberId,
      now: input.now,
      previousLatestInvoiceId,
      priceId: input.priceId,
      prisma: input.prisma,
      stripe: input.stripe,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    });
  }
}

async function hasHostedPulseTrialStartPaidLocallyStarted(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<boolean> {
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  return parseHostedBillingPlanCode(billingRef?.currentBillingPlanCode) === START_PAID_PULSE_PLAN &&
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
  const stripeCustomerId = coerceStripeObjectId(input.subscription.customer);
  if (!stripeCustomerId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
      httpStatus: 409,
      message: "Your subscription could not be matched to this hosted account.",
    });
  }
  const dispatchContext = buildHostedPulseTrialStartPaidDispatchContext(input);
  const projected = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const financialProjection = await applyStripeRecurringFinancialState({
        dispatchContext,
        owner: {
          kind: "member",
          lockMemberId: input.memberId,
          memberId: input.memberId,
          stripeCustomerId,
          stripeSubscriptionId: input.subscription.id,
        },
        restoreWhenHealthy: false,
        subscription: input.subscription,
        tx,
      });
      if (financialProjection.blockActiveProjection) {
        return false;
      }
      await applyStripeInvoicePaid(
        input.invoice,
        dispatchContext,
        tx,
        HostedBillingStatus.active,
        input.subscription,
        preparedCryptoDomainRoots,
      );
      return true;
    },
  });
  if (!projected) {
    throw buildHostedPulseTrialStartPaidFinancialStateBlockedError();
  }

  await signalHostedRuntimeManualWakeBestEffort({
    userId: input.memberId,
  });
}

async function reconcileHostedPulseTrialStartPaidInvoiceFreeResume(input: {
  memberId: string;
  now: Date;
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const eventCreatedAt = input.now;
  const dispatchContext: HostedStripeDispatchContext = {
    eventCreatedAt,
    occurredAt: eventCreatedAt.toISOString(),
    sourceEventId:
      `stripe.subscription.updated:inline-invoice-free-resume:${input.subscription.id}`,
    sourceType:
      "stripe.customer.subscription.updated.inline-invoice-free-resume",
  };
  const financialProjection = await applyStripeRecurringFinancialState({
    dispatchContext,
    owner: {
      kind: "member",
      lockMemberId: input.memberId,
      memberId: input.memberId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.subscription.id,
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
  return true;
}

function buildHostedPulseTrialStartPaidFinancialStateBlockedError(): HostedOnboardingError {
  return hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_FINANCIAL_STATE_BLOCKED",
    httpStatus: 409,
    message:
      "Stripe shows a refund or dispute on this subscription. Open billing before retrying.",
  });
}

function isHostedPulseTrialStartPaidInvoiceForSubscription(input: {
  invoice: Stripe.Invoice;
  stripeSubscriptionId: string;
}): boolean {
  return coerceStripeInvoiceSubscriptionId(input.invoice) === input.stripeSubscriptionId &&
    readHostedStripeInvoiceBillingReason(input.invoice) !== "subscription_create";
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

function assertHostedPulseTrialStartPaidInvoiceMatchesSubscription(input: {
  invoice: Stripe.Invoice;
  stripeSubscriptionId: string;
}): void {
  if (isHostedPulseTrialStartPaidInvoiceForSubscription(input)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_INVOICE_MISMATCH",
    httpStatus: 409,
    message: "Stripe did not match this invoice to your Pulse subscription.",
  });
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
}): HostedStripeDispatchContext {
  const paidAt = input.invoice.status_transitions?.paid_at;
  if (
    typeof paidAt !== "number" ||
    !Number.isFinite(paidAt) ||
    paidAt <= 0
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_INVOICE_PAID_AT_MISSING",
      httpStatus: 409,
      message: "Stripe did not provide the payment time for this invoice.",
    });
  }
  const eventCreatedAt = new Date(paidAt * 1000);

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
    const failure = classifyHostedStripeFailure(error);
    throw hostedOnboardingError({
      code: failure.kind === "provider_ambiguous"
        ? "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE"
        : "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_PROVIDER_REJECTED",
      details: describeHostedStripeErrorDetails({ error, operationName }),
      httpStatus: failure.httpStatus,
      message: failure.kind === "provider_ambiguous"
        ? "Stripe billing is unavailable for starting Pulse right now. Try again shortly."
        : "Stripe rejected this Pulse billing change. Contact support before retrying.",
      retryable: failure.retryable,
    });
  }
}

function isHostedPulseTrialStartPaidStripeUnavailableError(error: unknown): error is HostedOnboardingError {
  return isHostedOnboardingError(error) &&
    error.code === "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE";
}

function isHostedPulseTrialStartPaidNonReconciliableError(
  error: unknown,
): error is HostedOnboardingError {
  return isHostedOnboardingError(error) &&
    (
      error.code === "HOSTED_PULSE_TRIAL_START_PAID_INVOICE_MISSING" ||
      error.code === "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED" ||
      error.code ===
        "HOSTED_PULSE_TRIAL_START_PAID_RESUMED_WITHOUT_INVOICE" ||
      error.code ===
        "HOSTED_PULSE_TRIAL_START_PAID_FINANCIAL_STATE_BLOCKED" ||
      error.code === "HOSTED_PULSE_TRIAL_START_PAID_TENDER_NOT_ATTACHED"
    );
}

function isHostedPulseTrialStartPaidAmbiguousStripeMutationError(error: unknown): boolean {
  return isHostedPulseTrialStartPaidStripeUnavailableError(error) && error.retryable;
}

function buildHostedPulseTrialProviderState(input: {
  invoiceSnapshot: HostedStripeInvoiceCollectionSnapshot | null;
  subscription: Stripe.Subscription;
  tender: HostedStripeTender | null;
}): string {
  return sha256Hex(JSON.stringify({
    subscription: buildHostedStripeSubscriptionMutationScope(
      input.subscription,
      input.invoiceSnapshot,
    ),
    tender: input.tender,
  }));
}

function buildHostedPulseTrialStartPaidIdempotencyKey(input: {
  memberId: string;
  operation?: HostedPulseTrialStartPaidIdempotencyOperation;
  priceId: string;
  providerState: string;
  stripeSubscriptionId: string;
  trialEnd: Date | null;
}): string {
  const keyPayload = {
    memberId: input.memberId,
    priceId: input.priceId,
    providerState: input.providerState,
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
