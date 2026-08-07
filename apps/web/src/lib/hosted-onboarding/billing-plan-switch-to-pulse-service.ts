import { Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  canScheduleHostedBillingPlanChange,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedBillingPlanSelectable } from "./billing-plan-eligibility";
import { assertHostedMemberOwnActiveBillingAllowed } from "./entitlement";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId,
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
  writeHostedMemberStripeBillingRefTx,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import {
  requireHostedStripeBillingPlanConfig,
  requireValidatedHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  hasHostedStripeSubscriptionPaymentMethod,
} from "./stripe-subscription-payment-method";
import {
  buildHostedStripeAlertCorrelationCause,
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
  withHostedStripeActionFailureAlert,
} from "./stripe-error-log";

const LEGACY_EDGE_TO_PULSE_SOURCE_PLAN =
  "launch_edge_monthly" satisfies HostedBillingPlanCode;
const LEGACY_EDGE_TO_PULSE_TARGET_PLAN =
  "launch_monthly" satisfies HostedBillingPlanCode;
const LEGACY_EDGE_TO_PULSE_MARKER = "edge_to_pulse_at_period_end";
const DIRECT_PLAN_SWITCH_MARKER = "direct_plan_at_period_end_v1";
const STRIPE_TRIAL_METADATA_KEYS = [
  "trialDurationDays",
  "trialPolicyVersion",
  "trialUsageLimitUsdMicros",
] as const;

export type HostedBillingPlanSwitchResult =
  | {
    billingPlanCode: "launch_group_monthly";
    status: "payment_method_required";
  }
  | {
    effectiveAt: string;
    scheduledBillingPlanCode: HostedBillingPlanCode;
    status: "already_scheduled";
  }
  | {
    effectiveAt: string;
    scheduledBillingPlanCode: HostedBillingPlanCode;
    status: "scheduled";
  };

export type HostedBillingPlanSwitchToPulseResult =
  HostedBillingPlanSwitchResult;

interface HostedStripePlanConfig {
  priceId: string;
}

interface HostedSwitchScheduleContext {
  currentPeriodEnd: Date;
  currentPeriodEndUnix: number;
  memberId: string;
  sourceConfig: HostedStripePlanConfig;
  sourcePlanCode: HostedBillingPlanCode;
  stripeSubscriptionId: string;
  targetConfig: HostedStripePlanConfig;
  targetPlanCode: HostedBillingPlanCode;
}

export async function scheduleHostedBillingPlanSwitch(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  requiredSourceBillingPhase?: "trial";
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanSwitchResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma,
    run: (tx) =>
      scheduleHostedBillingPlanSwitchWithLockedOwner({
        memberId: input.memberId,
        now,
        requiredSourceBillingPhase: input.requiredSourceBillingPhase,
        targetPlanCode: input.targetPlanCode,
        tx,
      }),
  });
}

export function scheduleHostedBillingPlanSwitchToPulse(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedBillingPlanSwitchToPulseResult> {
  return scheduleHostedBillingPlanSwitch({
    ...input,
    targetPlanCode: LEGACY_EDGE_TO_PULSE_TARGET_PLAN,
  });
}

async function scheduleHostedBillingPlanSwitchWithLockedOwner(input: {
  memberId: string;
  now: Date;
  requiredSourceBillingPhase?: "trial";
  targetPlanCode: HostedBillingPlanCode;
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingPlanSwitchResult> {
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

  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.tx,
  });
  const sourceIsPulseTrial = isHostedPulseTrialBillingState({
    currentBillingPhase: billingRef?.currentBillingPhase,
    currentCheckoutOffer: billingRef?.currentCheckoutOffer,
  });

  if (
    input.requiredSourceBillingPhase
    && !sourceIsPulseTrial
  ) {
    throw buildHostedBillingPlanSwitchSourceChangedError();
  }

  assertHostedBillingPlanSwitchSourceState({
    billingRef,
    member,
    targetPlanCode: input.targetPlanCode,
  });
  await assertHostedBillingPlanSelectable({
    memberId: input.memberId,
    prisma: input.tx,
    targetPlanCode: input.targetPlanCode,
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

  const sourcePlanCode = parseHostedBillingPlanCode(
    billingRef?.currentBillingPlanCode,
  );
  if (!sourcePlanCode) {
    throw buildHostedBillingPlanSwitchSourceChangedError();
  }
  const sourceConfig = requireHostedSwitchPlanConfig(sourcePlanCode);
  const targetRuntimeConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: input.targetPlanCode,
  });
  const performPlanSwitch = async (): Promise<HostedBillingPlanSwitchResult> => {
    const targetConfig = await requireValidatedHostedStripeBillingPlanConfig({
      billingPlanCode: input.targetPlanCode,
    });
    const stripe = sourceConfig.stripe;
    const subscription = await callHostedStripePlanSwitchOperation(
      "subscription.retrieve",
      () =>
        stripe.subscriptions.retrieve(stripeSubscriptionId, {
          expand: ["customer", "items.data.price"],
        }),
    );

    assertHostedStripeSubscriptionMatchesCustomer({
      stripeCustomerId,
      subscription,
    });
    if (
      sourceIsPulseTrial
      && subscription.status !== "trialing"
    ) {
      throw buildHostedBillingPlanSwitchSourceChangedError();
    }
    assertHostedStripeSubscriptionScheduleableState({
      allowTrialing: sourceIsPulseTrial,
      now: input.now,
      subscription,
    });
    assertHostedStripeCanonicalSourceSubscriptionItems({
      sourceConfig,
      subscription,
    });

    if (
      sourceIsPulseTrial
      && input.targetPlanCode === "launch_group_monthly"
      && !hasHostedStripeSubscriptionPaymentMethod(subscription)
    ) {
      return {
        billingPlanCode: "launch_group_monthly",
        status: "payment_method_required",
      };
    }

    const currentPeriodEnd = requireHostedStripeSubscriptionCurrentPeriodEnd({
      now: input.now,
      subscription,
    });
    const currentPeriodEndUnix = toUnixSeconds(currentPeriodEnd);
    const context: HostedSwitchScheduleContext = {
      currentPeriodEnd,
      currentPeriodEndUnix,
      memberId: input.memberId,
      sourceConfig,
      sourcePlanCode,
      stripeSubscriptionId,
      targetConfig,
      targetPlanCode: input.targetPlanCode,
    };
    const existingScheduleId = coerceStripeObjectId(subscription.schedule);

    if (existingScheduleId) {
      const existingSchedule = await retrieveHostedBillingPlanSwitchSchedule({
        scheduleId: existingScheduleId,
        stripe,
      });

      if (isHostedBillingPlanSwitchToPulseScheduleCompatible(existingSchedule, context)) {
        await persistHostedBillingPlanSwitchToPulsePendingFields({
          context,
          schedule: existingSchedule,
          tx: input.tx,
        });

        return {
          effectiveAt: currentPeriodEnd.toISOString(),
          scheduledBillingPlanCode: input.targetPlanCode,
          status: "already_scheduled",
        };
      }

      const recoveredSchedule = await tryRecoverHostedBillingPlanSwitchScheduleFromCreateIdempotency({
        context,
        stripe,
        stripeSubscriptionId,
      });

      if (!recoveredSchedule || recoveredSchedule.id !== existingSchedule.id) {
        throw buildHostedBillingPlanSwitchScheduleConflictError();
      }

      const updatedSchedule = await updateHostedBillingPlanSwitchToPulseSchedule({
        context,
        schedule: recoveredSchedule,
        stripe,
      });
      await persistHostedBillingPlanSwitchToPulsePendingFields({
        context,
        schedule: updatedSchedule,
        tx: input.tx,
      });

      return {
        effectiveAt: currentPeriodEnd.toISOString(),
        scheduledBillingPlanCode: input.targetPlanCode,
        status: "scheduled",
      };
    }

    const createdSchedule = await createHostedBillingPlanSwitchScheduleFromSubscription({
      context,
      stripe,
      stripeSubscriptionId,
    });
    const retrievedSchedule = await retrieveHostedBillingPlanSwitchSchedule({
      scheduleId: createdSchedule.id,
      stripe,
    });
    const updatedSchedule = await updateHostedBillingPlanSwitchToPulseSchedule({
      context,
      schedule: retrievedSchedule,
      stripe,
    });

    await persistHostedBillingPlanSwitchToPulsePendingFields({
      context,
      schedule: updatedSchedule,
      tx: input.tx,
    });

    return {
      effectiveAt: currentPeriodEnd.toISOString(),
      scheduledBillingPlanCode: input.targetPlanCode,
      status: "scheduled",
    };
  };

  return withHostedStripeActionFailureAlert(
    {
      isTerminalStripeFailure: isHostedBillingPlanSwitchStripeUnavailableError,
      operationIdentity: buildHostedBillingPlanSwitchOperationIdentity({
        sourcePlanCode,
        sourcePriceId: sourceConfig.priceId,
        stripeSubscriptionId,
        targetPlanCode: input.targetPlanCode,
        targetPriceId: targetRuntimeConfig.priceId,
      }),
      operationName: "billing.plan-switch",
      stripeLiveMode: sourceConfig.stripeLiveMode,
    },
    performPlanSwitch,
  );
}

export async function refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx(input: {
  schedule: Stripe.SubscriptionSchedule;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lookup = await lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId({
    prisma: input.tx,
    stripeSubscriptionScheduleId: input.schedule.id,
  });

  if (!lookup) {
    return;
  }

  const context = buildHostedBillingPlanSwitchContextFromLocalPendingState({
    billingRef: lookup.billingRef,
    memberId: lookup.core.id,
  });

  if (context && isHostedBillingPlanSwitchToPulseScheduleCompatible(input.schedule, context)) {
    await writeHostedMemberStripeBillingRefTx({
      memberId: context.memberId,
      scheduledBillingEffectiveAt: context.currentPeriodEnd,
      scheduledBillingPlanCode: context.targetPlanCode,
      stripeSubscriptionScheduleId: input.schedule.id,
      tx: input.tx,
    });
    return;
  }

  await clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx({
    memberId: lookup.core.id,
    stripeSubscriptionScheduleId: input.schedule.id,
    tx: input.tx,
  });
}

export async function clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx(input: {
  memberId?: string;
  stripeSubscriptionScheduleId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const memberId = input.memberId ?? (await lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId({
    prisma: input.tx,
    stripeSubscriptionScheduleId: input.stripeSubscriptionScheduleId,
  }))?.core.id ?? null;

  if (!memberId) {
    return;
  }

  await writeHostedMemberStripeBillingRefTx({
    memberId,
    scheduledBillingEffectiveAt: null,
    scheduledBillingPlanCode: null,
    stripeSubscriptionScheduleId: null,
    tx: input.tx,
  });
}

function assertHostedBillingPlanSwitchSourceState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  member: {
    billingStatus: unknown;
    suspendedAt?: Date | null;
  };
  targetPlanCode: HostedBillingPlanCode;
}): void {
  if (canScheduleHostedBillingPlanChange({
    billingStatus: input.member.billingStatus,
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentBillingPlanCode: input.billingRef?.currentBillingPlanCode,
    currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    stripeCustomerId: input.billingRef?.stripeCustomerId,
    stripeSubscriptionId: input.billingRef?.stripeSubscriptionId,
    suspendedAt: input.member.suspendedAt,
    targetPlanCode: input.targetPlanCode,
  })) {
    return;
  }

  const hasPotentialSourceState = canScheduleHostedBillingPlanChange({
    billingStatus: input.member.billingStatus,
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentBillingPlanCode: input.billingRef?.currentBillingPlanCode,
    currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    stripeCustomerId: "present",
    stripeSubscriptionId: "present",
    suspendedAt: input.member.suspendedAt,
    targetPlanCode: input.targetPlanCode,
  });

  if (
    hasPotentialSourceState &&
    (!input.billingRef?.stripeCustomerId || !input.billingRef?.stripeSubscriptionId)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
      message: "Your subscription is not ready for plan changes yet.",
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_SWITCH_UNSUPPORTED",
    httpStatus: 400,
    message: "This scheduled plan change is not supported.",
  });
}

function buildHostedBillingPlanSwitchContextFromLocalPendingState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot;
  memberId: string;
}): HostedSwitchScheduleContext | null {
  const stripeSubscriptionId = input.billingRef.stripeSubscriptionId;
  const currentPeriodEnd = input.billingRef.scheduledBillingEffectiveAt;
  const sourcePlanCode = parseHostedBillingPlanCode(
    input.billingRef.currentBillingPlanCode,
  );
  const targetPlanCode = parseHostedBillingPlanCode(
    input.billingRef.scheduledBillingPlanCode,
  );

  if (
    !stripeSubscriptionId ||
    !currentPeriodEnd ||
    !sourcePlanCode ||
    !targetPlanCode
  ) {
    return null;
  }

  const sourceConfig = requireHostedSwitchPlanConfig(sourcePlanCode);
  const targetConfig = requireHostedSwitchPlanConfig(targetPlanCode);

  return {
    currentPeriodEnd,
    currentPeriodEndUnix: toUnixSeconds(currentPeriodEnd),
    memberId: input.memberId,
    sourceConfig,
    sourcePlanCode,
    stripeSubscriptionId,
    targetConfig,
    targetPlanCode,
  };
}

function requireHostedSwitchPlanConfig(
  billingPlanCode: HostedBillingPlanCode,
): HostedStripePlanConfig & { stripe: Stripe; stripeLiveMode: boolean } {
  const config = requireHostedStripeBillingPlanConfig({
    billingPlanCode,
  });

  return {
    priceId: config.priceId,
    stripe: config.stripe,
    stripeLiveMode: config.stripeLiveMode,
  };
}

function buildHostedBillingPlanSwitchOperationIdentity(input: {
  sourcePlanCode: HostedBillingPlanCode;
  sourcePriceId: string;
  stripeSubscriptionId: string;
  targetPlanCode: HostedBillingPlanCode;
  targetPriceId: string;
}): string {
  return `hosted-billing-plan-switch:${sha256Hex(JSON.stringify(input))}`;
}

function isHostedBillingPlanSwitchStripeUnavailableError(
  error: unknown,
): boolean {
  return isHostedOnboardingError(error) &&
    (
      error.code === "HOSTED_BILLING_PRICE_UNAVAILABLE" ||
      error.code === "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE"
    );
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

function assertHostedStripeSubscriptionScheduleableState(input: {
  allowTrialing: boolean;
  now: Date;
  subscription: Stripe.Subscription;
}): void {
  if (
    input.subscription.status !== "active"
    && !(input.allowTrialing && input.subscription.status === "trialing")
  ) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("status");
  }

  if (input.subscription.cancel_at_period_end) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("cancel_at_period_end");
  }

  if (input.subscription.pending_update) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("pending_update");
  }

  requireHostedStripeSubscriptionCurrentPeriodEnd(input);
}

function requireHostedStripeSubscriptionCurrentPeriodEnd(input: {
  now: Date;
  subscription: Stripe.Subscription;
}): Date {
  const currentPeriodEnd =
    readHostedStripeObjectDate(input.subscription, "current_period_end") ??
    readHostedStripeSubscriptionItemCurrentPeriodEnd(input.subscription);

  if (!currentPeriodEnd || currentPeriodEnd.getTime() <= input.now.getTime()) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("current_period_end");
  }

  return currentPeriodEnd;
}

function readHostedStripeSubscriptionItemCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): Date | null {
  for (const item of subscription.items?.data ?? []) {
    const currentPeriodEnd = readHostedStripeObjectDate(item, "current_period_end");
    if (currentPeriodEnd) {
      return currentPeriodEnd;
    }
  }

  return null;
}

function assertHostedStripeCanonicalSourceSubscriptionItems(input: {
  sourceConfig: HostedStripePlanConfig;
  subscription: Stripe.Subscription;
}): void {
  const items = input.subscription.items?.data ?? [];
  const recurringItem = items[0];
  if (
    items.length !== 1 ||
    !recurringItem ||
    recurringItem.price?.id !== input.sourceConfig.priceId
  ) {
    throw buildHostedStripeSubscriptionItemsUnsupportedError();
  }

  if (!isHostedStripeLicensedMonthlyPrice(recurringItem.price) || !isSupportedRecurringQuantity(recurringItem)) {
    throw buildHostedStripeSubscriptionItemsUnsupportedError();
  }
}

function isHostedStripeLicensedMonthlyPrice(price: Stripe.Price | null | undefined): boolean {
  return price?.recurring?.interval === "month" &&
    (price.recurring.interval_count ?? 1) === 1 &&
    price.recurring.usage_type === "licensed";
}

function isSupportedRecurringQuantity(item: Stripe.SubscriptionItem): boolean {
  const quantity = readHostedStripeObjectNumber(item, "quantity");
  return quantity === null || quantity === 1;
}

async function retrieveHostedBillingPlanSwitchSchedule(input: {
  scheduleId: string;
  stripe: Stripe;
}): Promise<Stripe.SubscriptionSchedule> {
  return callHostedStripePlanSwitchOperation(
    "subscriptionSchedules.retrieve",
    () => input.stripe.subscriptionSchedules.retrieve(input.scheduleId),
  );
}

async function createHostedBillingPlanSwitchScheduleFromSubscription(input: {
  context: HostedSwitchScheduleContext;
  stripe: Stripe;
  stripeSubscriptionId: string;
}): Promise<Stripe.SubscriptionSchedule> {
  return callHostedStripePlanSwitchOperation(
    "subscriptionSchedules.create",
    () =>
      input.stripe.subscriptionSchedules.create({
        from_subscription: input.stripeSubscriptionId,
      }, {
        idempotencyKey: buildHostedBillingPlanSwitchToPulseCreateIdempotencyKey(input.context),
      }),
  );
}

async function tryRecoverHostedBillingPlanSwitchScheduleFromCreateIdempotency(input: {
  context: HostedSwitchScheduleContext;
  stripe: Stripe;
  stripeSubscriptionId: string;
}): Promise<Stripe.SubscriptionSchedule | null> {
  try {
    return await createHostedBillingPlanSwitchScheduleFromSubscription(input);
  } catch {
    return null;
  }
}

async function updateHostedBillingPlanSwitchToPulseSchedule(input: {
  context: HostedSwitchScheduleContext;
  schedule: Stripe.SubscriptionSchedule;
  stripe: Stripe;
}): Promise<Stripe.SubscriptionSchedule> {
  const currentPhase = requireHostedBillingPlanSwitchCurrentPhase(input.schedule);
  const updatedSchedule = await callHostedStripePlanSwitchOperation(
    "subscriptionSchedules.update",
    () =>
      input.stripe.subscriptionSchedules.update(input.schedule.id, {
        end_behavior: "release",
        metadata: buildHostedBillingPlanSwitchScheduleMetadata(input.context),
        phases: [
          buildHostedBillingPlanSwitchCurrentPhaseParams({
            context: input.context,
            phase: currentPhase,
          }),
          buildHostedBillingPlanSwitchFuturePhaseParams(input.context),
        ],
        proration_behavior: "none",
      }, {
        idempotencyKey: buildHostedBillingPlanSwitchToPulseUpdateIdempotencyKey(input.context),
      }),
  );

  if (!isHostedBillingPlanSwitchToPulseScheduleCompatible(updatedSchedule, input.context)) {
    throw buildHostedBillingPlanSwitchScheduleConflictError();
  }

  return updatedSchedule;
}

function requireHostedBillingPlanSwitchCurrentPhase(
  schedule: Stripe.SubscriptionSchedule,
): Stripe.SubscriptionSchedule.Phase {
  const currentPhase = schedule.current_phase;
  const phase = schedule.phases.find((candidate) =>
    currentPhase
      ? candidate.start_date === currentPhase.start_date &&
        candidate.end_date === currentPhase.end_date
      : candidate.start_date <= schedule.created && candidate.end_date > schedule.created
  ) ?? schedule.phases[0] ?? null;

  if (!phase) {
    throw buildHostedBillingPlanSwitchScheduleConflictError();
  }

  return phase;
}

function buildHostedBillingPlanSwitchCurrentPhaseParams(input: {
  context: HostedSwitchScheduleContext;
  phase: Stripe.SubscriptionSchedule.Phase;
}): Stripe.SubscriptionScheduleUpdateParams.Phase {
  const params: Stripe.SubscriptionScheduleUpdateParams.Phase = {
    end_date: input.context.currentPeriodEndUnix,
    items: [
      {
        price: input.context.sourceConfig.priceId,
        quantity: 1,
      },
    ],
    start_date: input.phase.start_date,
  };
  copySupportedHostedStripeSchedulePhaseFields(params, input.phase);
  return params;
}

function buildHostedBillingPlanSwitchFuturePhaseParams(
  context: HostedSwitchScheduleContext,
): Stripe.SubscriptionScheduleUpdateParams.Phase {
  return {
    duration: {
      interval: "month",
      interval_count: 1,
    },
    items: [
      {
        price: context.targetConfig.priceId,
        quantity: 1,
      },
    ],
    metadata: buildHostedBillingPlanSwitchFuturePhaseMetadata(context),
    proration_behavior: "none",
    start_date: context.currentPeriodEndUnix,
  };
}

function copySupportedHostedStripeSchedulePhaseFields(
  params: Stripe.SubscriptionScheduleUpdateParams.Phase,
  phase: Stripe.SubscriptionSchedule.Phase,
): void {
  if (phase.application_fee_percent !== null) {
    params.application_fee_percent = phase.application_fee_percent;
  }
  if (phase.automatic_tax) {
    params.automatic_tax = { enabled: phase.automatic_tax.enabled };
  }
  if (phase.billing_cycle_anchor) {
    params.billing_cycle_anchor = phase.billing_cycle_anchor;
  }
  if (phase.collection_method) {
    params.collection_method = phase.collection_method;
  }
  if (phase.currency) {
    params.currency = phase.currency;
  }
  const defaultPaymentMethodId = coerceStripeObjectId(phase.default_payment_method);
  if (defaultPaymentMethodId) {
    params.default_payment_method = defaultPaymentMethodId;
  }
  if (Array.isArray(phase.default_tax_rates) && phase.default_tax_rates.length > 0) {
    params.default_tax_rates = phase.default_tax_rates.flatMap((taxRate) => {
      const id = coerceStripeObjectId(taxRate);
      return id ? [id] : [];
    });
  }
  if (phase.description) {
    params.description = phase.description;
  }
  if (phase.metadata) {
    params.metadata = phase.metadata;
  }
  if (phase.proration_behavior) {
    params.proration_behavior = phase.proration_behavior;
  }
  if (phase.trial_end) {
    params.trial_end = phase.trial_end;
  }
}

function buildHostedBillingPlanSwitchScheduleMetadata(
  context: HostedSwitchScheduleContext,
): Stripe.MetadataParam {
  return {
    billingPlanCode: context.targetPlanCode,
    checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    memberId: context.memberId,
    murphPlanSwitch: resolveHostedBillingPlanSwitchMarker(context),
  };
}

function buildHostedBillingPlanSwitchFuturePhaseMetadata(
  context: HostedSwitchScheduleContext,
): Stripe.MetadataParam {
  const metadata = buildHostedBillingPlanSwitchScheduleMetadata(context);
  for (const key of STRIPE_TRIAL_METADATA_KEYS) {
    metadata[key] = "";
  }
  return metadata;
}

function isHostedBillingPlanSwitchToPulseScheduleCompatible(
  schedule: Stripe.SubscriptionSchedule,
  context: HostedSwitchScheduleContext,
): boolean {
  if (schedule.status !== "active") {
    return false;
  }

  if (schedule.end_behavior !== "release") {
    return false;
  }

  if (coerceStripeObjectId(schedule.subscription) !== context.stripeSubscriptionId) {
    return false;
  }

  if (!isHostedBillingPlanSwitchScheduleMetadataCompatible(schedule.metadata, context)) {
    return false;
  }

  if (schedule.phases.length !== 2) {
    return false;
  }

  const [currentPhase, futurePhase] = schedule.phases;
  if (!currentPhase || !futurePhase) {
    return false;
  }

  return currentPhase.start_date < context.currentPeriodEndUnix &&
    currentPhase.end_date === context.currentPeriodEndUnix &&
    hasHostedStripeSchedulePhaseItems(currentPhase, {
      recurringPriceId: context.sourceConfig.priceId,
    }) &&
    futurePhase.start_date === context.currentPeriodEndUnix &&
    futurePhase.end_date > context.currentPeriodEndUnix &&
    futurePhase.proration_behavior === "none" &&
    isHostedBillingPlanSwitchScheduleMetadataCompatible(futurePhase.metadata, context) &&
    hasHostedStripeTrialMetadataClears(futurePhase.metadata) &&
    hasHostedStripeSchedulePhaseItems(futurePhase, {
      recurringPriceId: context.targetConfig.priceId,
    });
}

function isHostedBillingPlanSwitchScheduleMetadataCompatible(
  metadata: Stripe.Metadata | null,
  context: HostedSwitchScheduleContext,
): boolean {
  return metadata?.murphPlanSwitch ===
      resolveHostedBillingPlanSwitchMarker(context) &&
    metadata.memberId === context.memberId &&
    metadata.billingPlanCode === context.targetPlanCode;
}

function hasHostedStripeSchedulePhaseItems(
  phase: Stripe.SubscriptionSchedule.Phase,
  expected: {
    recurringPriceId: string;
  },
): boolean {
  if (phase.items.length !== 1) {
    return false;
  }

  const recurringItems = phase.items.filter((item) =>
    coerceStripeObjectId(item.price) === expected.recurringPriceId
  );

  return recurringItems.length === 1 &&
    readHostedStripeObjectNumber(recurringItems[0], "quantity") === 1;
}

function hasHostedStripeTrialMetadataClears(metadata: Stripe.Metadata | null): boolean {
  return STRIPE_TRIAL_METADATA_KEYS.every((key) => metadata?.[key] === "");
}

async function persistHostedBillingPlanSwitchToPulsePendingFields(input: {
  context: HostedSwitchScheduleContext;
  schedule: Stripe.SubscriptionSchedule;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await writeHostedMemberStripeBillingRefTx({
    memberId: input.context.memberId,
    scheduledBillingEffectiveAt: input.context.currentPeriodEnd,
    scheduledBillingPlanCode: input.context.targetPlanCode,
    stripeSubscriptionScheduleId: input.schedule.id,
    tx: input.tx,
  });
}

function buildHostedBillingPlanSwitchToPulseCreateIdempotencyKey(
  context: HostedSwitchScheduleContext,
): string {
  if (isLegacyEdgeToPulseSwitch(context)) {
    return `hosted-billing-switch-to-pulse:create:${sha256Hex(JSON.stringify({
      currentPeriodEnd: context.currentPeriodEndUnix,
      memberId: context.memberId,
      stripeSubscriptionId: context.stripeSubscriptionId,
      targetPlanCode: LEGACY_EDGE_TO_PULSE_TARGET_PLAN,
    }))}`;
  }

  return `hosted-billing-switch:create:v1:${sha256Hex(JSON.stringify({
    currentPeriodEnd: context.currentPeriodEndUnix,
    memberId: context.memberId,
    sourcePlanCode: context.sourcePlanCode,
    stripeSubscriptionId: context.stripeSubscriptionId,
    targetPlanCode: context.targetPlanCode,
  }))}`;
}

function buildHostedBillingPlanSwitchToPulseUpdateIdempotencyKey(
  context: HostedSwitchScheduleContext,
): string {
  if (isLegacyEdgeToPulseSwitch(context)) {
    return `hosted-billing-switch-to-pulse:update:${sha256Hex(JSON.stringify({
      currentPeriodEnd: context.currentPeriodEndUnix,
      memberId: context.memberId,
      edgePriceId: context.sourceConfig.priceId,
      pulsePriceId: context.targetConfig.priceId,
      stripeSubscriptionId: context.stripeSubscriptionId,
      targetPlanCode: LEGACY_EDGE_TO_PULSE_TARGET_PLAN,
    }))}`;
  }

  return `hosted-billing-switch:update:v1:${sha256Hex(JSON.stringify({
    currentPeriodEnd: context.currentPeriodEndUnix,
    memberId: context.memberId,
    sourcePlanCode: context.sourcePlanCode,
    sourcePriceId: context.sourceConfig.priceId,
    stripeSubscriptionId: context.stripeSubscriptionId,
    targetPlanCode: context.targetPlanCode,
    targetPriceId: context.targetConfig.priceId,
  }))}`;
}

function isLegacyEdgeToPulseSwitch(
  context: HostedSwitchScheduleContext,
): boolean {
  return context.sourcePlanCode === LEGACY_EDGE_TO_PULSE_SOURCE_PLAN
    && context.targetPlanCode === LEGACY_EDGE_TO_PULSE_TARGET_PLAN;
}

function resolveHostedBillingPlanSwitchMarker(
  context: HostedSwitchScheduleContext,
): string {
  return isLegacyEdgeToPulseSwitch(context)
    ? LEGACY_EDGE_TO_PULSE_MARKER
    : DIRECT_PLAN_SWITCH_MARKER;
}

function buildHostedBillingPlanSwitchSourceChangedError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_SWITCH_SOURCE_CHANGED",
    httpStatus: 409,
    message: "Your billing state changed. Review the latest plan options.",
  });
}

function buildHostedStripeSubscriptionStateUnsupportedError(reason: string) {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED",
    details: {
      code: reason,
    },
    httpStatus: 409,
    message: "Your subscription state is not ready for this plan change.",
  });
}

function buildHostedStripeSubscriptionItemsUnsupportedError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED",
    httpStatus: 409,
    message: "Your subscription items are not ready for this plan change.",
  });
}

function buildHostedBillingPlanSwitchScheduleConflictError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
    httpStatus: 409,
    message: "A billing change is already scheduled. Contact support if you want to change it.",
  });
}

async function callHostedStripePlanSwitchOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logHostedStripeFailure({ error, operationName });
    throw hostedOnboardingError({
      cause: buildHostedStripeAlertCorrelationCause(error),
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      details: describeHostedStripeErrorDetails({ error, operationName }),
      httpStatus: 502,
      message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  }
}

function readHostedStripeObjectDate(
  value: object,
  field: string,
): Date | null {
  const rawValue = Reflect.get(value, field);

  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return null;
  }

  const date = new Date(rawValue * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function readHostedStripeObjectNumber(
  value: object,
  field: string,
): number | null {
  const rawValue = Reflect.get(value, field);
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
