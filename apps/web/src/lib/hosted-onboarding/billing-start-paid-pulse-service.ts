import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

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
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import { applyStripeInvoicePaid } from "./stripe-billing-events";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";

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
// Matches the signed return link's lifetime so the browser and webhook recovery
// paths cannot disagree about whether an intent is still live.
const PULSE_TRIAL_PAYMENT_INTENT_MAX_AGE_MS = 30 * 60 * 1000;

type HostedPulseTrialStartPaidIdempotencyOperation =
  | "active-trial-end-now-v2"
  | "paused-resume-v1";

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

  const resolveExistingInvoiceResult = () => maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
    invoice: readExpandedLatestInvoice(subscription),
    memberId: input.memberId,
    now,
    priceId: pulseConfig.priceId,
    prisma,
    stripeCustomerId,
    stripeSubscriptionId,
    subscription,
  });

  const legacyMeteredItems = buildHostedStripePulseTrialStartPaidLegacyMeteredItemDeletes({
    priceId: pulseConfig.priceId,
    subscription,
  });

  if (canStart && isHostedStripePulseTrialStartPaidPendingWithoutInvoiceProof(subscription)) {
    const pendingInvoiceResult = await resolveExistingInvoiceResult();
    return pendingInvoiceResult ?? {
      billingPlanCode: START_PAID_PULSE_PLAN,
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
      timing: input.timing,
    });
    const pausedStartResult = await resumeHostedPulseTrialStartPaidPausedSubscription({
      legacyMeteredItems,
      memberId: input.memberId,
      now,
      paymentMethodContinuation,
      priceId: pulseConfig.priceId,
      prisma,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription,
      trialEnd: billingRef?.currentTrialEndsAt ?? null,
    });

    if (pausedStartResult) {
      return pausedStartResult;
    }

    return reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure({
      memberId: input.memberId,
      now,
      priceId: pulseConfig.priceId,
      prisma,
      stripe,
      stripeCustomerId,
      stripeSubscriptionId,
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
      timing: input.timing,
    });
    return {
      billingPlanCode: START_PAID_PULSE_PLAN,
      paymentUrl: await createHostedPulseTrialStartPaidPaymentMethodPortalUrl({
        continuation: paymentMethodContinuation,
        memberId: input.memberId,
        now,
        prisma,
        stripe,
        stripeCustomerId,
        timing: input.timing,
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

  const trialStartResult = await updateHostedPulseTrialStartPaidSubscription({
    legacyMeteredItems,
    memberId: input.memberId,
    now,
    priceId: pulseConfig.priceId,
    prisma,
    stripe,
    stripeCustomerId,
    stripeSubscriptionId,
    trialEnd: billingRef?.currentTrialEndsAt ?? null,
  });

  if (trialStartResult) {
    return trialStartResult;
  }

  return reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure({
    memberId: input.memberId,
    now,
    priceId: pulseConfig.priceId,
    prisma,
    stripe,
    stripeCustomerId,
    stripeSubscriptionId,
  });
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

function hasHostedStripeSubscriptionPaymentMethod(subscription: Stripe.Subscription): boolean {
  const subscriptionPaymentMethodId =
    coerceStripeObjectId(subscription.default_payment_method) ||
    coerceStripeObjectId(subscription.default_source);

  if (subscriptionPaymentMethodId) {
    return true;
  }

  const customer = readExpandedStripeCustomer(subscription.customer);
  if (!customer) {
    return false;
  }

  const customerPaymentMethodId =
    coerceStripeObjectId(customer.invoice_settings.default_payment_method) ||
    coerceStripeObjectId(customer.default_source);

  return Boolean(customerPaymentMethodId);
}

function readExpandedStripeCustomer(
  customer: Stripe.Subscription["customer"],
): Stripe.Customer | null {
  return customer &&
    typeof customer === "object" &&
    customer.object === "customer" &&
    !customer.deleted
    ? customer
    : null;
}

async function createHostedPulseTrialStartPaidPaymentMethodPortalUrl(input: {
  continuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  timing: "at_trial_end" | "now";
}): Promise<string> {
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  await recordHostedPulseTrialPaymentIntent({
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
    timing: input.timing,
  });
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

// Best effort on purpose: failing to record the intent must not cost the member
// the payment link itself, which is still the primary way they finish. Kept in
// our own row rather than on the Stripe subscription so that handing out a link
// never mutates the subscription before a card exists.
async function recordHostedPulseTrialPaymentIntent(input: {
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  timing: "at_trial_end" | "now";
}): Promise<void> {
  try {
    await input.prisma.hostedMemberBillingRef.update({
      where: { memberId: input.memberId },
      data: {
        pulseTrialPaymentIntentAction:
          input.timing === "now" ? "start_pulse_now" : "continue_pulse",
        pulseTrialPaymentIntentExpiresAt: new Date(
          input.now.getTime() + PULSE_TRIAL_PAYMENT_INTENT_MAX_AGE_MS,
        ),
      },
    });
  } catch (error) {
    console.warn(
      "Pulse trial payment intent was not recorded before the payment-method handoff.",
      error,
    );
  }
}

export function readHostedPulseTrialPaymentIntent(input: {
  action: string | null;
  expiresAt: Date | null;
  now: Date;
}): HostedPulseTrialContinuationAction | null {
  if (input.action !== "continue_pulse" && input.action !== "start_pulse_now") {
    return null;
  }

  if (!(input.expiresAt instanceof Date) || input.expiresAt.getTime() <= input.now.getTime()) {
    return null;
  }

  return input.action;
}

export async function clearHostedPulseTrialPaymentIntent(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedMemberBillingRef.update({
    where: { memberId: input.memberId },
    data: {
      pulseTrialPaymentIntentAction: null,
      pulseTrialPaymentIntentExpiresAt: null,
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
  invoice: Stripe.Invoice | null;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): Promise<HostedPulseTrialStartPaidResult | null> {
  if (!input.invoice || !isHostedPulseTrialStartPaidInvoiceForSubscription({
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
    })
      ? {
          billingPlanCode: START_PAID_PULSE_PLAN,
          status: "started",
        }
      : {
          billingPlanCode: START_PAID_PULSE_PLAN,
          status: "billing_pending",
        };
  }

  const paymentRequired = isHostedPulseTrialStartPaidPaymentRequired(input.invoice);
  const paymentUrl = readHostedPulseTrialStartPaidPaymentUrl(input.invoice);

  if (paymentUrl && paymentRequired) {
    return {
      billingPlanCode: START_PAID_PULSE_PLAN,
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
      billingPlanCode: START_PAID_PULSE_PLAN,
      status: "billing_pending",
    };
  }

  return null;
}

async function maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult(input: {
  invoice: Stripe.Invoice | null;
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

  if (!input.invoice || !isHostedPulseTrialStartPaidInvoiceForSubscription({
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

async function updateHostedPulseTrialStartPaidSubscription(input: {
  legacyMeteredItems: Stripe.SubscriptionUpdateParams.Item[];
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialEnd: Date | null;
}): Promise<HostedPulseTrialStartPaidResult | null> {
  let stripeMutationCompleted = false;

  try {
    const updatedSubscription = await withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma: input.prisma,
      run: async () => {
        const subscription = await callHostedStripeStartPaidPulseOperation(
          "subscription.update.trial-end-now",
          () => input.stripe.subscriptions.update(input.stripeSubscriptionId, {
            expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
            ...(input.legacyMeteredItems.length > 0 ? { items: input.legacyMeteredItems } : {}),
            metadata: { murphTrialExtensionTargetTrialEnd: "" },
            payment_behavior: "allow_incomplete",
            trial_end: "now",
          }, {
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
    });

    return updatedInvoiceResult ?? {
      billingPlanCode: START_PAID_PULSE_PLAN,
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

async function reconcileHostedPulseTrialStartPaidSubscriptionAfterStripeFailure(input: {
  memberId: string;
  now: Date;
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

  const existingInvoiceResult = await maybeResolveHostedPulseTrialStartPaidPostMutationInvoiceResult({
    invoice: readExpandedLatestInvoice(subscription),
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

  // The first update may have committed even when Stripe returned a 5xx/network
  // failure. Do not issue the same paid transition under a fresh idempotency key.
  return {
    billingPlanCode: START_PAID_PULSE_PLAN,
    status: "billing_pending",
  };
}

async function resumeHostedPulseTrialStartPaidPausedSubscription(input: {
  legacyMeteredItems: Stripe.SubscriptionUpdateParams.Item[];
  memberId: string;
  now: Date;
  paymentMethodContinuation: HostedPulseTrialPaymentMethodPortalContinuation | null;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
  trialEnd: Date | null;
}): Promise<HostedPulseTrialStartPaidResult | null> {
  assertHostedStripePulseTrialSubscriptionCanResumePaid({
    subscription: input.subscription,
  });

  if (!hasHostedStripeSubscriptionPaymentMethod(input.subscription)) {
    return {
      billingPlanCode: START_PAID_PULSE_PLAN,
      paymentUrl: await createHostedPulseTrialStartPaidPaymentMethodPortalUrl({
        continuation: input.paymentMethodContinuation,
        memberId: input.memberId,
        now: input.now,
        prisma: input.prisma,
        stripe: input.stripe,
        stripeCustomerId: input.stripeCustomerId,
        timing: "now",
      }),
      ...(input.paymentMethodContinuation?.kind === "settings"
        ? { resumeStartAfterPaymentMethodSetup: true as const }
        : {}),
      status: "payment_required",
    };
  }

  let stripeMutationCompleted = false;

  try {
    const resumedSubscription = await withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma: input.prisma,
      run: async () => {
        const cleanedSubscription = await callHostedStripeStartPaidPulseOperation(
          "subscription.update.paused-pre-resume-cleanup",
          () => input.stripe.subscriptions.update(input.stripeSubscriptionId, {
            expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
            ...(input.legacyMeteredItems.length > 0
              ? { items: input.legacyMeteredItems }
              : {}),
            metadata: {
              [PULSE_TRIAL_EXTENSION_TARGET_METADATA_KEY]: "",
            },
            proration_behavior: "none",
          }, {
            idempotencyKey:
              buildHostedPulseTrialStartPaidCleanupIdempotencyKey(),
          }),
        );
        assertHostedStripePulseTrialStartPaidPostMutationSubscriptionShape({
          priceId: input.priceId,
          subscription: cleanedSubscription,
        });
        if (cleanedSubscription.status !== "paused") {
          return cleanedSubscription;
        }

        const subscription = await callHostedStripeStartPaidPulseOperation(
          "subscription.resume.paused-trial",
          () => input.stripe.subscriptions.resume(input.stripeSubscriptionId, {
            billing_cycle_anchor: "now",
            expand: [...START_PAID_PULSE_STRIPE_UPDATE_EXPANSIONS],
          }, {
            idempotencyKey: buildHostedPulseTrialStartPaidIdempotencyKey({
              memberId: input.memberId,
              operation: "paused-resume-v1",
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
    });

    return resumedInvoiceResult ?? {
      billingPlanCode: START_PAID_PULSE_PLAN,
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
  await input.prisma.$transaction(async (tx) => {
    await applyStripeInvoicePaid(
      input.invoice,
      buildHostedPulseTrialStartPaidDispatchContext(input),
      tx,
      HostedBillingStatus.active,
      input.subscription,
    );
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  await signalHostedRuntimeManualWakeBestEffort({
    userId: input.memberId,
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

function isHostedPulseTrialStartPaidPaymentRequired(invoice: Stripe.Invoice): boolean {
  const paymentIntent = readExpandedPaymentIntent(invoice);

  if (paymentIntent) {
    return paymentIntent.status === "requires_action" ||
      paymentIntent.status === "requires_confirmation" ||
      paymentIntent.status === "requires_payment_method";
  }

  return invoice.status === "open" && invoice.attempted === true &&
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
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      details: {
        operationName,
        ...describeSafeStripeStartPaidPulseError(error),
      },
      httpStatus: 502,
      message: "Stripe billing is unavailable for starting Pulse right now. Try again shortly.",
      retryable: true,
    });
  }
}

function describeSafeStripeStartPaidPulseError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {};
  }

  const candidate = error as {
    code?: unknown;
    rawType?: unknown;
    requestId?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };

  return {
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(typeof candidate.rawType === "string" ? { type: candidate.rawType } : {}),
    ...(typeof candidate.type === "string" ? { type: candidate.type } : {}),
    ...(typeof candidate.statusCode === "number" ? { statusCode: candidate.statusCode } : {}),
    ...(typeof candidate.requestId === "string" ? { requestIdPresent: true } : {}),
  };
}

function isHostedPulseTrialStartPaidStripeUnavailableError(error: unknown): error is HostedOnboardingError {
  return isHostedOnboardingError(error) &&
    error.code === "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE";
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

function buildHostedPulseTrialStartPaidCleanupIdempotencyKey(): string {
  // Clearing metadata and deleting already-selected legacy items are
  // convergent operations. A fresh key per top-level attempt prevents Stripe
  // from replaying a cached cleanup response after provider state changes.
  return `hosted-billing-start-paid-pulse:paused-cleanup:${randomUUID()}`;
}
