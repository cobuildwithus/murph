import { Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  canSwitchHostedBillingPlanToPulse,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { assertHostedMemberOwnActiveBillingAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId,
  readHostedMemberStripeBillingRef,
  writeHostedMemberStripeBillingRefTx,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";

const SWITCH_TO_PULSE_SOURCE_PLAN = "launch_edge_monthly" satisfies HostedBillingPlanCode;
const SWITCH_TO_PULSE_TARGET_PLAN = "launch_monthly" satisfies HostedBillingPlanCode;
const SWITCH_TO_PULSE_MARKER = "edge_to_pulse_at_period_end";
const STRIPE_TRIAL_METADATA_KEYS = [
  "trialDurationDays",
  "trialPolicyVersion",
  "trialUsageLimitUsdMicros",
] as const;

export type HostedBillingPlanSwitchToPulseResult =
  | {
    effectiveAt: string;
    scheduledBillingPlanCode: "launch_monthly";
    status: "already_scheduled";
  }
  | {
    effectiveAt: string;
    scheduledBillingPlanCode: "launch_monthly";
    status: "scheduled";
  };

interface HostedStripePlanConfig {
  priceId: string;
}

interface HostedSwitchScheduleContext {
  currentPeriodEnd: Date;
  currentPeriodEndUnix: number;
  edgeConfig: HostedStripePlanConfig;
  memberId: string;
  pulseConfig: HostedStripePlanConfig;
  stripeSubscriptionId: string;
}

export async function scheduleHostedBillingPlanSwitchToPulse(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedBillingPlanSwitchToPulseResult> {
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

  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma,
  });

  assertHostedBillingPlanSwitchToPulseSourceState({
    billingRef,
    member,
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

  const edgeConfig = requireHostedSwitchPlanConfig(SWITCH_TO_PULSE_SOURCE_PLAN);
  const pulseConfig = requireHostedSwitchPlanConfig(SWITCH_TO_PULSE_TARGET_PLAN);
  const stripe = edgeConfig.stripe;
  const subscription = await callHostedStripePlanSwitchOperation(
    "subscription.retrieve",
    () =>
      stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ["items.data.price"],
      }),
  );

  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId,
    subscription,
  });
  assertHostedStripeSubscriptionScheduleableState({
    now,
    subscription,
  });
  assertHostedStripeCanonicalEdgeSubscriptionItems({
    edgeConfig,
    subscription,
  });

  const currentPeriodEnd = requireHostedStripeSubscriptionCurrentPeriodEnd({
    now,
    subscription,
  });
  const currentPeriodEndUnix = toUnixSeconds(currentPeriodEnd);
  const context: HostedSwitchScheduleContext = {
    currentPeriodEnd,
    currentPeriodEndUnix,
    edgeConfig,
    memberId: input.memberId,
    pulseConfig,
    stripeSubscriptionId,
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
        prisma,
        schedule: existingSchedule,
      });

      return {
        effectiveAt: currentPeriodEnd.toISOString(),
        scheduledBillingPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
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
      prisma,
      schedule: updatedSchedule,
    });

    return {
      effectiveAt: currentPeriodEnd.toISOString(),
      scheduledBillingPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
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
    prisma,
    schedule: updatedSchedule,
  });

  return {
    effectiveAt: currentPeriodEnd.toISOString(),
    scheduledBillingPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
    status: "scheduled",
  };
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
      scheduledBillingPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
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

function assertHostedBillingPlanSwitchToPulseSourceState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  member: {
    billingStatus: unknown;
    suspendedAt?: Date | null;
  };
}): void {
  if (canSwitchHostedBillingPlanToPulse({
    billingStatus: input.member.billingStatus,
    currentBillingPhase: input.billingRef?.currentBillingPhase,
    currentBillingPlanCode: input.billingRef?.currentBillingPlanCode,
    stripeCustomerId: input.billingRef?.stripeCustomerId,
    stripeSubscriptionId: input.billingRef?.stripeSubscriptionId,
    suspendedAt: input.member.suspendedAt,
  })) {
    return;
  }

  const hasPaidEdgeSourceState =
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode) === SWITCH_TO_PULSE_SOURCE_PLAN &&
    parseHostedBillingPhase(input.billingRef?.currentBillingPhase) === "paid" &&
    input.member.billingStatus === "active" &&
    !(input.member.suspendedAt instanceof Date);

  if (
    hasPaidEdgeSourceState &&
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
    message: "This plan change is not supported.",
  });
}

function buildHostedBillingPlanSwitchContextFromLocalPendingState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot;
  memberId: string;
}): HostedSwitchScheduleContext | null {
  const stripeSubscriptionId = input.billingRef.stripeSubscriptionId;
  const currentPeriodEnd = input.billingRef.scheduledBillingEffectiveAt;

  if (
    !stripeSubscriptionId ||
    !currentPeriodEnd ||
    input.billingRef.scheduledBillingPlanCode !== SWITCH_TO_PULSE_TARGET_PLAN
  ) {
    return null;
  }

  const edgeConfig = requireHostedSwitchPlanConfig(SWITCH_TO_PULSE_SOURCE_PLAN);
  const pulseConfig = requireHostedSwitchPlanConfig(SWITCH_TO_PULSE_TARGET_PLAN);

  return {
    currentPeriodEnd,
    currentPeriodEndUnix: toUnixSeconds(currentPeriodEnd),
    edgeConfig,
    memberId: input.memberId,
    pulseConfig,
    stripeSubscriptionId,
  };
}

function requireHostedSwitchPlanConfig(
  billingPlanCode: HostedBillingPlanCode,
): HostedStripePlanConfig & { stripe: Stripe } {
  const config = requireHostedStripeBillingPlanConfig({
    billingPlanCode,
  });

  return {
    priceId: config.priceId,
    stripe: config.stripe,
  };
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
  now: Date;
  subscription: Stripe.Subscription;
}): void {
  if (input.subscription.status !== "active") {
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

function assertHostedStripeCanonicalEdgeSubscriptionItems(input: {
  edgeConfig: HostedStripePlanConfig;
  subscription: Stripe.Subscription;
}): void {
  const items = input.subscription.items?.data ?? [];
  const recurringItems = items.filter((item) => item.price?.id === input.edgeConfig.priceId);
  const unsupportedItems = items.filter((item) =>
    item.price?.id !== input.edgeConfig.priceId &&
    !isHostedStripeLegacyAiUsageMeteredItem(item)
  );

  if (
    recurringItems.length !== 1 ||
    unsupportedItems.length > 0
  ) {
    throw buildHostedStripeSubscriptionItemsUnsupportedError();
  }

  const recurringItem = recurringItems[0];

  if (!isHostedStripeLicensedMonthlyPrice(recurringItem.price) || !isSupportedRecurringQuantity(recurringItem)) {
    throw buildHostedStripeSubscriptionItemsUnsupportedError();
  }

  for (const item of items) {
    if (
      item.id !== recurringItem.id &&
      !isHostedStripeLegacyAiUsageMeteredItem(item)
    ) {
      throw buildHostedStripeSubscriptionItemsUnsupportedError();
    }
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
  return {
    ...copySupportedHostedStripeSchedulePhaseFields(input.phase),
    end_date: input.context.currentPeriodEndUnix,
    items: [
      {
        price: input.context.edgeConfig.priceId,
        quantity: 1,
      },
    ],
    start_date: input.phase.start_date,
  };
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
        price: context.pulseConfig.priceId,
        quantity: 1,
      },
    ],
    metadata: buildHostedBillingPlanSwitchFuturePhaseMetadata(context),
    proration_behavior: "none",
    start_date: context.currentPeriodEndUnix,
  };
}

function copySupportedHostedStripeSchedulePhaseFields(
  phase: Stripe.SubscriptionSchedule.Phase,
): Partial<Stripe.SubscriptionScheduleUpdateParams.Phase> {
  return {
    ...(phase.application_fee_percent !== null
      ? { application_fee_percent: phase.application_fee_percent }
      : {}),
    ...(phase.automatic_tax
      ? {
          automatic_tax: {
            enabled: phase.automatic_tax.enabled,
          },
        }
      : {}),
    ...(phase.billing_cycle_anchor ? { billing_cycle_anchor: phase.billing_cycle_anchor } : {}),
    ...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
    ...(phase.currency ? { currency: phase.currency } : {}),
    ...(typeof coerceStripeObjectId(phase.default_payment_method) === "string"
      ? { default_payment_method: coerceStripeObjectId(phase.default_payment_method) ?? undefined }
      : {}),
    ...(Array.isArray(phase.default_tax_rates) && phase.default_tax_rates.length > 0
      ? {
          default_tax_rates: phase.default_tax_rates.flatMap((taxRate) => {
            const id = coerceStripeObjectId(taxRate);
            return id ? [id] : [];
          }),
        }
      : {}),
    ...(phase.description ? { description: phase.description } : {}),
    ...(phase.metadata ? { metadata: phase.metadata } : {}),
    ...(phase.proration_behavior ? { proration_behavior: phase.proration_behavior } : {}),
    ...(phase.trial_end ? { trial_end: phase.trial_end } : {}),
  };
}

function buildHostedBillingPlanSwitchScheduleMetadata(
  context: HostedSwitchScheduleContext,
): Stripe.MetadataParam {
  return {
    billingPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
    checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    memberId: context.memberId,
    murphPlanSwitch: SWITCH_TO_PULSE_MARKER,
  };
}

function buildHostedBillingPlanSwitchFuturePhaseMetadata(
  context: HostedSwitchScheduleContext,
): Stripe.MetadataParam {
  return {
    ...buildHostedBillingPlanSwitchScheduleMetadata(context),
    ...buildStripeMetadataUnsetFields(STRIPE_TRIAL_METADATA_KEYS),
  };
}

function buildStripeMetadataUnsetFields(keys: readonly string[]): Stripe.MetadataParam {
  return Object.fromEntries(keys.map((key) => [key, ""]));
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
      recurringPriceId: context.edgeConfig.priceId,
    }) &&
    futurePhase.start_date === context.currentPeriodEndUnix &&
    futurePhase.end_date > context.currentPeriodEndUnix &&
    futurePhase.proration_behavior === "none" &&
    isHostedBillingPlanSwitchScheduleMetadataCompatible(futurePhase.metadata, context) &&
    hasHostedStripeTrialMetadataClears(futurePhase.metadata) &&
    hasHostedStripeSchedulePhaseItems(futurePhase, {
      recurringPriceId: context.pulseConfig.priceId,
    });
}

function isHostedBillingPlanSwitchScheduleMetadataCompatible(
  metadata: Stripe.Metadata | null,
  context: HostedSwitchScheduleContext,
): boolean {
  return metadata?.murphPlanSwitch === SWITCH_TO_PULSE_MARKER &&
    metadata.memberId === context.memberId &&
    metadata.billingPlanCode === SWITCH_TO_PULSE_TARGET_PLAN;
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
  prisma: PrismaClient;
  schedule: Stripe.SubscriptionSchedule;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await writeHostedMemberStripeBillingRefTx({
      memberId: input.context.memberId,
      scheduledBillingEffectiveAt: input.context.currentPeriodEnd,
      scheduledBillingPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
      stripeSubscriptionScheduleId: input.schedule.id,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function buildHostedBillingPlanSwitchToPulseCreateIdempotencyKey(
  context: HostedSwitchScheduleContext,
): string {
  return `hosted-billing-switch-to-pulse:create:${sha256Hex(JSON.stringify({
    currentPeriodEnd: context.currentPeriodEndUnix,
    memberId: context.memberId,
    stripeSubscriptionId: context.stripeSubscriptionId,
    targetPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
  }))}`;
}

function buildHostedBillingPlanSwitchToPulseUpdateIdempotencyKey(
  context: HostedSwitchScheduleContext,
): string {
  return `hosted-billing-switch-to-pulse:update:${sha256Hex(JSON.stringify({
    currentPeriodEnd: context.currentPeriodEndUnix,
    memberId: context.memberId,
    edgePriceId: context.edgeConfig.priceId,
    pulsePriceId: context.pulseConfig.priceId,
    stripeSubscriptionId: context.stripeSubscriptionId,
    targetPlanCode: SWITCH_TO_PULSE_TARGET_PLAN,
  }))}`;
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
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      details: {
        operationName,
        ...describeSafeStripePlanSwitchError(error),
      },
      httpStatus: 502,
      message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  }
}

function describeSafeStripePlanSwitchError(error: unknown): Record<string, unknown> {
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
