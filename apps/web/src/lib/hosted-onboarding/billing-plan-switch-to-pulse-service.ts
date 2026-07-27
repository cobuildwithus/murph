import {
  Prisma,
  type HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { coerceStripeObjectId } from "./billing";
import {
  canScheduleHostedBillingPlanChange,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import {
  assertHostedBillingPlanSelectable,
} from "./billing-plan-eligibility";
import { assertHostedMemberOwnActiveBillingAllowed } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId,
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
  writeHostedMemberStripeBillingRefTx,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
} from "./stripe-error-log";
import {
  assertHostedStripeSubscriptionMatchesCustomer,
  isHostedStripeRetryableFailure,
} from "./stripe-billing-state";

const LEGACY_EDGE_TO_PULSE_SOURCE_PLAN =
  "launch_edge_monthly" satisfies HostedBillingPlanCode;
const LEGACY_EDGE_TO_PULSE_TARGET_PLAN =
  "launch_monthly" satisfies HostedBillingPlanCode;
const LEGACY_EDGE_TO_PULSE_MARKER = "edge_to_pulse_at_period_end";
const DIRECT_PLAN_SWITCH_MARKER = "direct_plan_at_period_end_v1";
const SWITCH_TO_PULSE_UPDATE_OPERATION_VERSION = "v2";
const SWITCH_TO_PULSE_PROVIDER_BUDGET_MS = 90_000;
const SWITCH_TO_PULSE_STRIPE_REQUEST_TIMEOUT_MS = 15_000;
const STRIPE_TRIAL_METADATA_KEYS = [
  "trialDurationDays",
  "trialPolicyVersion",
  "trialUsageLimitUsdMicros",
] as const;

export type HostedBillingPlanSwitchResult =
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
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  targetConfig: HostedStripePlanConfig;
  targetPlanCode: HostedBillingPlanCode;
}

export async function scheduleHostedBillingPlanSwitch(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  targetPlanCode: HostedBillingPlanCode;
}): Promise<HostedBillingPlanSwitchResult> {
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

  assertHostedBillingPlanSwitchSourceState({
    billingRef,
    member,
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

  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma,
    run: (tx) =>
      scheduleHostedBillingPlanSwitchWithLockedOwner({
        expectedStripeCustomerId: stripeCustomerId,
        expectedStripeSubscriptionId: stripeSubscriptionId,
        memberId: input.memberId,
        now,
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
  expectedStripeCustomerId: string;
  expectedStripeSubscriptionId: string;
  memberId: string;
  now: Date;
  targetPlanCode: HostedBillingPlanCode;
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingPlanSwitchResult> {
  const providerDeadlineMs =
    Date.now() + SWITCH_TO_PULSE_PROVIDER_BUDGET_MS;
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma: input.tx,
  });
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.tx,
  });
  assertHostedBillingPlanSwitchLockedSource({
    billingRef,
    expectedStripeCustomerId: input.expectedStripeCustomerId,
    expectedStripeSubscriptionId: input.expectedStripeSubscriptionId,
    member,
    targetPlanCode: input.targetPlanCode,
  });
  await assertHostedBillingPlanSelectable({
    memberId: input.memberId,
    prisma: input.tx,
    targetPlanCode: input.targetPlanCode,
  });

  const sourcePlanCode = parseHostedBillingPlanCode(
    billingRef?.currentBillingPlanCode,
  );
  if (!sourcePlanCode) {
    throw buildHostedBillingPlanSwitchSourceChangedError();
  }
  const sourceConfig = requireHostedSwitchPlanConfig(sourcePlanCode);
  const targetConfig = requireHostedSwitchPlanConfig(input.targetPlanCode);
  const stripe = sourceConfig.stripe;
  const subscription = await callHostedStripePlanSwitchOperation(
    "subscription.retrieve",
    () =>
      stripe.subscriptions.retrieve(input.expectedStripeSubscriptionId, {
        expand: ["items.data.price"],
      }, buildHostedBillingPlanSwitchStripeRequestOptions({
        providerDeadlineMs,
      })),
  );

  assertHostedStripeSubscriptionMatchesCustomer({
    stripeCustomerId: input.expectedStripeCustomerId,
    subscription,
  });
  assertHostedStripeSubscriptionScheduleableState({
    allowTrialing:
      parseHostedBillingPhase(billingRef?.currentBillingPhase) === "trial",
    now: input.now,
    subscription,
  });
  assertHostedStripeCanonicalSourceSubscriptionItems({
    sourceConfig,
    subscription,
  });
  assertHostedStripeSubscriptionConfigurationSupported(subscription);

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
    stripeCustomerId: input.expectedStripeCustomerId,
    stripeSubscriptionId: input.expectedStripeSubscriptionId,
    targetConfig,
    targetPlanCode: input.targetPlanCode,
  };
  const existingScheduleId = coerceStripeObjectId(subscription.schedule);

  if (existingScheduleId) {
    const existingSchedule = await retrieveHostedBillingPlanSwitchSchedule({
      providerDeadlineMs,
      scheduleId: existingScheduleId,
      stripe,
    });
    assertHostedStripeScheduleConfigurationSupported(existingSchedule, context);

    if (isHostedBillingPlanSwitchToPulseScheduleCompatible(
      existingSchedule,
      context,
      subscription,
    )) {
      await persistHostedBillingPlanSwitchToPulsePendingFields({
        context,
        expectedStripeCustomerId: input.expectedStripeCustomerId,
        schedule: existingSchedule,
        tx: input.tx,
      });

      return {
        effectiveAt: currentPeriodEnd.toISOString(),
        scheduledBillingPlanCode: input.targetPlanCode,
        status: "already_scheduled",
      };
    }

    if (!isHostedBillingPlanSwitchPristineAttachedSchedule({
      context,
      liveSchedule: existingSchedule,
      subscription,
    })) {
      throw buildHostedBillingPlanSwitchScheduleConflictError();
    }

    const updatedSchedule = await updateHostedBillingPlanSwitchToPulseSchedule({
      context,
      providerDeadlineMs,
      schedule: existingSchedule,
      stripe,
    });
    await persistHostedBillingPlanSwitchToPulsePendingFields({
      context,
      expectedStripeCustomerId: input.expectedStripeCustomerId,
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
    providerDeadlineMs,
    stripe,
    stripeSubscriptionId: input.expectedStripeSubscriptionId,
  });
  const retrievedSchedule = await retrieveHostedBillingPlanSwitchSchedule({
    providerDeadlineMs,
    scheduleId: createdSchedule.id,
    stripe,
  });
  assertHostedStripeScheduleConfigurationSupported(retrievedSchedule, context);
  if (!isHostedBillingPlanSwitchPristineAttachedSchedule({
    context,
    liveSchedule: retrievedSchedule,
    subscription,
  })) {
    throw buildHostedBillingPlanSwitchScheduleConflictError();
  }
  const updatedSchedule = await updateHostedBillingPlanSwitchToPulseSchedule({
    context,
    providerDeadlineMs,
    schedule: retrievedSchedule,
    stripe,
  });

  await persistHostedBillingPlanSwitchToPulsePendingFields({
    context,
    expectedStripeCustomerId: input.expectedStripeCustomerId,
    schedule: updatedSchedule,
    tx: input.tx,
  });

  return {
    effectiveAt: currentPeriodEnd.toISOString(),
    scheduledBillingPlanCode: input.targetPlanCode,
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

function assertHostedBillingPlanSwitchLockedSource(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  expectedStripeCustomerId: string;
  expectedStripeSubscriptionId: string;
  member: {
    billingStatus: HostedBillingStatus;
    suspendedAt?: Date | null;
  } | null;
  targetPlanCode: HostedBillingPlanCode;
}): void {
  if (
    !input.member ||
    input.billingRef?.stripeCustomerId !== input.expectedStripeCustomerId ||
    input.billingRef?.stripeSubscriptionId !==
      input.expectedStripeSubscriptionId
  ) {
    throw buildHostedBillingPlanSwitchSourceChangedError();
  }

  try {
    assertHostedMemberOwnActiveBillingAllowed(input.member);
    assertHostedBillingPlanSwitchSourceState({
      billingRef: input.billingRef,
      member: input.member,
      targetPlanCode: input.targetPlanCode,
    });
  } catch {
    throw buildHostedBillingPlanSwitchSourceChangedError();
  }
}

function buildHostedBillingPlanSwitchContextFromLocalPendingState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot;
  memberId: string;
}): HostedSwitchScheduleContext | null {
  const stripeSubscriptionId = input.billingRef.stripeSubscriptionId;
  const stripeCustomerId = input.billingRef.stripeCustomerId;
  const currentPeriodEnd = input.billingRef.scheduledBillingEffectiveAt;
  const sourcePlanCode = parseHostedBillingPlanCode(
    input.billingRef.currentBillingPlanCode,
  );
  const targetPlanCode = parseHostedBillingPlanCode(
    input.billingRef.scheduledBillingPlanCode,
  );

  if (
    !stripeCustomerId ||
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
    stripeCustomerId,
    stripeSubscriptionId,
    targetConfig,
    targetPlanCode,
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

function assertHostedStripeSubscriptionScheduleableState(input: {
  allowTrialing: boolean;
  now: Date;
  subscription: Stripe.Subscription;
}): void {
  if (
    input.subscription.status !== "active" &&
    !(input.allowTrialing && input.subscription.status === "trialing")
  ) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("status");
  }

  if (input.subscription.cancel_at_period_end) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("cancel_at_period_end");
  }

  if (input.subscription.cancel_at !== null && input.subscription.cancel_at !== undefined) {
    throw buildHostedStripeSubscriptionStateUnsupportedError("cancel_at");
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
  const recurringItems = items.filter((item) => item.price?.id === input.sourceConfig.priceId);
  const unsupportedItems = items.filter((item) =>
    item.price?.id !== input.sourceConfig.priceId &&
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

  assertHostedStripeSubscriptionItemConfigurationSupported(recurringItem);

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

function assertHostedStripeSubscriptionConfigurationSupported(
  subscription: Stripe.Subscription,
): void {
  const reason = readHostedStripeUnsupportedSubscriptionConfigurationReason(
    subscription,
  );

  if (reason) {
    throw buildHostedStripeSubscriptionConfigurationUnsupportedError(reason);
  }
}

function readHostedStripeUnsupportedSubscriptionConfigurationReason(
  subscription: Stripe.Subscription,
): string | null {
  if (
    subscription.application_fee_percent !== null
    && subscription.application_fee_percent !== undefined
  ) {
    return "application_fee_percent";
  }
  if (hasUnsupportedHostedStripeAutomaticTax(subscription.automatic_tax)) {
    return "automatic_tax";
  }
  if (
    subscription.billing_cycle_anchor_config !== null
    && subscription.billing_cycle_anchor_config !== undefined
  ) {
    return "billing_cycle_anchor_config";
  }
  if (
    subscription.billing_mode?.type
    && subscription.billing_mode.type !== "classic"
  ) {
    return "billing_mode";
  }
  if (
    subscription.billing_thresholds !== null
    && subscription.billing_thresholds !== undefined
  ) {
    return "billing_thresholds";
  }
  if (
    subscription.collection_method
    && subscription.collection_method !== "charge_automatically"
  ) {
    return "collection_method";
  }
  if (
    subscription.days_until_due !== null
    && subscription.days_until_due !== undefined
  ) {
    return "days_until_due";
  }
  if (hasHostedStripeValues(subscription.default_tax_rates)) {
    return "default_tax_rates";
  }
  if (hasHostedStripeValues(subscription.discounts)) {
    return "discounts";
  }
  if (
    subscription.default_source !== null
    && subscription.default_source !== undefined
  ) {
    return "default_source";
  }
  if (hasUnsupportedHostedStripeInvoiceSettings(subscription.invoice_settings)) {
    return "invoice_settings";
  }
  if (
    subscription.managed_payments !== null
    && subscription.managed_payments !== undefined
  ) {
    return "managed_payments";
  }
  if (subscription.on_behalf_of !== null && subscription.on_behalf_of !== undefined) {
    return "on_behalf_of";
  }
  if (
    subscription.pause_collection !== null
    && subscription.pause_collection !== undefined
  ) {
    return "pause_collection";
  }
  if (hasUnsupportedHostedStripePaymentSettings(subscription.payment_settings)) {
    return "payment_settings";
  }
  if (
    subscription.pending_invoice_item_interval !== null
    && subscription.pending_invoice_item_interval !== undefined
  ) {
    return "pending_invoice_item_interval";
  }
  if (subscription.transfer_data !== null && subscription.transfer_data !== undefined) {
    return "transfer_data";
  }

  return null;
}

function assertHostedStripeSubscriptionItemConfigurationSupported(
  item: Stripe.SubscriptionItem,
): void {
  const reason = readHostedStripeUnsupportedItemConfigurationReason(item);

  if (reason) {
    throw buildHostedStripeSubscriptionConfigurationUnsupportedError(
      `item.${reason}`,
    );
  }
}

function assertHostedStripeScheduleConfigurationSupported(
  schedule: Stripe.SubscriptionSchedule,
  context: HostedSwitchScheduleContext,
): void {
  const reason = readHostedStripeUnsupportedScheduleConfigurationReason(
    schedule,
    context,
  );

  if (reason) {
    throw buildHostedStripeSubscriptionConfigurationUnsupportedError(reason);
  }
}

function readHostedStripeUnsupportedScheduleConfigurationReason(
  schedule: Stripe.SubscriptionSchedule,
  context: HostedSwitchScheduleContext,
): string | null {
  if (
    schedule.billing_mode?.type
    && schedule.billing_mode.type !== "classic"
  ) {
    return "schedule.billing_mode";
  }
  if (Reflect.get(schedule, "renewal_interval") != null) {
    return "schedule.renewal_interval";
  }

  const defaultSettingsReason = readHostedStripeUnsupportedScheduleSettingsReason(
    schedule.default_settings,
  );
  if (defaultSettingsReason) {
    return `schedule.default_settings.${defaultSettingsReason}`;
  }

  for (const phase of schedule.phases) {
    const phaseReason = readHostedStripeUnsupportedSchedulePhaseReason(
      phase,
      context,
    );
    if (phaseReason) {
      return `schedule.phase.${phaseReason}`;
    }
  }

  return null;
}

function readHostedStripeUnsupportedScheduleSettingsReason(
  settings: Stripe.SubscriptionSchedule.DefaultSettings | undefined,
): string | null {
  if (!settings) {
    return null;
  }
  if (
    settings.application_fee_percent !== null
    && settings.application_fee_percent !== undefined
  ) {
    return "application_fee_percent";
  }
  if (hasUnsupportedHostedStripeAutomaticTax(settings.automatic_tax)) {
    return "automatic_tax";
  }
  if (
    settings.billing_thresholds !== null
    && settings.billing_thresholds !== undefined
  ) {
    return "billing_thresholds";
  }
  if (settings.collection_method && settings.collection_method !== "charge_automatically") {
    return "collection_method";
  }
  if (Reflect.get(settings, "default_source") != null) {
    return "default_source";
  }
  if (hasUnsupportedHostedStripeInvoiceSettings(settings.invoice_settings)) {
    return "invoice_settings";
  }
  if (settings.on_behalf_of !== null && settings.on_behalf_of !== undefined) {
    return "on_behalf_of";
  }
  if (settings.transfer_data !== null && settings.transfer_data !== undefined) {
    return "transfer_data";
  }

  return null;
}

function readHostedStripeUnsupportedSchedulePhaseReason(
  phase: Stripe.SubscriptionSchedule.Phase,
  context: HostedSwitchScheduleContext,
): string | null {
  if (hasHostedStripeValues(phase.add_invoice_items)) {
    return "add_invoice_items";
  }
  if (
    phase.application_fee_percent !== null
    && phase.application_fee_percent !== undefined
  ) {
    return "application_fee_percent";
  }
  if (hasUnsupportedHostedStripeAutomaticTax(phase.automatic_tax)) {
    return "automatic_tax";
  }
  if (phase.billing_thresholds !== null && phase.billing_thresholds !== undefined) {
    return "billing_thresholds";
  }
  if (phase.collection_method && phase.collection_method !== "charge_automatically") {
    return "collection_method";
  }
  if (hasHostedStripeValues(phase.default_tax_rates)) {
    return "default_tax_rates";
  }
  if (hasHostedStripeValues(phase.discounts)) {
    return "discounts";
  }
  if (hasUnsupportedHostedStripeInvoiceSettings(phase.invoice_settings)) {
    return "invoice_settings";
  }
  if (phase.on_behalf_of !== null && phase.on_behalf_of !== undefined) {
    return "on_behalf_of";
  }
  if (phase.transfer_data !== null && phase.transfer_data !== undefined) {
    return "transfer_data";
  }

  for (const item of phase.items) {
    const priceId = coerceStripeObjectId(item.price);
    if (
      priceId !== context.sourceConfig.priceId
      && priceId !== context.targetConfig.priceId
    ) {
      continue;
    }

    const itemReason = readHostedStripeUnsupportedItemConfigurationReason(item);
    if (itemReason) {
      return `item.${itemReason}`;
    }
  }

  return null;
}

function readHostedStripeUnsupportedItemConfigurationReason(item: {
  billing_thresholds?: object | null;
  discounts?: readonly unknown[] | null;
  metadata?: Stripe.Metadata | null;
  tax_rates?: readonly unknown[] | null;
}): string | null {
  if (item.billing_thresholds !== null && item.billing_thresholds !== undefined) {
    return "billing_thresholds";
  }
  if (hasHostedStripeValues(item.discounts)) {
    return "discounts";
  }
  if (item.metadata && Object.keys(item.metadata).length > 0) {
    return "metadata";
  }
  if (hasHostedStripeValues(item.tax_rates)) {
    return "tax_rates";
  }

  return null;
}

function hasUnsupportedHostedStripeAutomaticTax(
  automaticTax: {
    disabled_reason?: string | null;
    enabled: boolean;
    liability?: object | null;
  } | undefined,
): boolean {
  return automaticTax?.enabled === true
    || (automaticTax?.disabled_reason !== null
      && automaticTax?.disabled_reason !== undefined)
    || (automaticTax?.liability !== null
      && automaticTax?.liability !== undefined);
}

function hasUnsupportedHostedStripeInvoiceSettings(
  invoiceSettings: {
    account_tax_ids?: readonly unknown[] | null;
    days_until_due?: number | null;
    issuer?: {
      type: string;
    } | null;
  } | null | undefined,
): boolean {
  if (!invoiceSettings) {
    return false;
  }

  return hasHostedStripeValues(invoiceSettings.account_tax_ids)
    || (invoiceSettings?.days_until_due !== null
      && invoiceSettings?.days_until_due !== undefined)
    || (invoiceSettings?.issuer?.type !== undefined
      && invoiceSettings.issuer.type !== "self")
    || hasHostedStripeValues(Reflect.get(invoiceSettings, "custom_fields"))
    || Reflect.get(invoiceSettings, "description") != null
    || Reflect.get(invoiceSettings, "footer") != null
    || Reflect.get(invoiceSettings, "rendering_options") != null;
}

function hasUnsupportedHostedStripePaymentSettings(
  paymentSettings: {
    payment_method_options?: object | null;
    payment_method_types?: readonly unknown[] | null;
    save_default_payment_method?: string | null;
  } | null | undefined,
): boolean {
  return (paymentSettings?.payment_method_options !== null
      && paymentSettings?.payment_method_options !== undefined)
    || hasHostedStripeValues(paymentSettings?.payment_method_types)
    || (paymentSettings?.save_default_payment_method !== null
      && paymentSettings?.save_default_payment_method !== undefined
      && paymentSettings.save_default_payment_method !== "off");
}

function hasHostedStripeValues(
  values: unknown,
): boolean {
  return Array.isArray(values) && values.length > 0;
}

async function retrieveHostedBillingPlanSwitchSchedule(input: {
  providerDeadlineMs: number;
  scheduleId: string;
  stripe: Stripe;
}): Promise<Stripe.SubscriptionSchedule> {
  const requestOptions = buildHostedBillingPlanSwitchStripeRequestOptions({
    providerDeadlineMs: input.providerDeadlineMs,
  });
  return callHostedStripePlanSwitchOperation(
    "subscriptionSchedules.retrieve",
    () =>
      input.stripe.subscriptionSchedules.retrieve(
        input.scheduleId,
        {},
        requestOptions,
      ),
  );
}

async function createHostedBillingPlanSwitchScheduleFromSubscription(input: {
  context: HostedSwitchScheduleContext;
  providerDeadlineMs: number;
  stripe: Stripe;
  stripeSubscriptionId: string;
}): Promise<Stripe.SubscriptionSchedule> {
  const requestOptions = buildHostedBillingPlanSwitchStripeRequestOptions({
    idempotencyKey:
      buildHostedBillingPlanSwitchToPulseCreateIdempotencyKey(input.context),
    providerDeadlineMs: input.providerDeadlineMs,
  });
  return callHostedStripePlanSwitchOperation(
    "subscriptionSchedules.create",
    () =>
      input.stripe.subscriptionSchedules.create({
        from_subscription: input.stripeSubscriptionId,
      }, requestOptions),
  );
}

async function updateHostedBillingPlanSwitchToPulseSchedule(input: {
  context: HostedSwitchScheduleContext;
  providerDeadlineMs: number;
  schedule: Stripe.SubscriptionSchedule;
  stripe: Stripe;
}): Promise<Stripe.SubscriptionSchedule> {
  assertHostedStripeScheduleConfigurationSupported(
    input.schedule,
    input.context,
  );
  const currentPhase = requireHostedBillingPlanSwitchCurrentPhase(input.schedule);
  const requestOptions = buildHostedBillingPlanSwitchStripeRequestOptions({
    idempotencyKey:
      buildHostedBillingPlanSwitchToPulseUpdateIdempotencyKey(input.context),
    providerDeadlineMs: input.providerDeadlineMs,
  });
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
      }, requestOptions),
  );

  assertHostedStripeScheduleConfigurationSupported(
    updatedSchedule,
    input.context,
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
  const defaultPaymentMethodId = coerceStripeObjectId(
    input.phase.default_payment_method,
  );

  return {
    ...(input.phase.billing_cycle_anchor
      ? { billing_cycle_anchor: input.phase.billing_cycle_anchor }
      : {}),
    ...(input.phase.collection_method
      ? { collection_method: input.phase.collection_method }
      : {}),
    ...(input.phase.currency ? { currency: input.phase.currency } : {}),
    ...(defaultPaymentMethodId
      ? { default_payment_method: defaultPaymentMethodId }
      : {}),
    ...(input.phase.description ? { description: input.phase.description } : {}),
    end_date: input.context.currentPeriodEndUnix,
    items: [
      {
        price: input.context.sourceConfig.priceId,
        quantity: 1,
      },
    ],
    ...(input.phase.metadata ? { metadata: input.phase.metadata } : {}),
    ...(input.phase.proration_behavior
      ? { proration_behavior: input.phase.proration_behavior }
      : {}),
    start_date: input.phase.start_date,
    ...(input.phase.trial_end ? { trial_end: input.phase.trial_end } : {}),
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
        price: context.targetConfig.priceId,
        quantity: 1,
      },
    ],
    metadata: buildHostedBillingPlanSwitchFuturePhaseMetadata(context),
    proration_behavior: "none",
    start_date: context.currentPeriodEndUnix,
  };
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
  subscription?: Stripe.Subscription,
): boolean {
  if (readHostedStripeUnsupportedScheduleConfigurationReason(schedule, context)) {
    return false;
  }

  if (schedule.status !== "active") {
    return false;
  }

  if (schedule.end_behavior !== "release") {
    return false;
  }

  if (coerceStripeObjectId(schedule.subscription) !== context.stripeSubscriptionId) {
    return false;
  }
  if (coerceStripeObjectId(schedule.customer) !== context.stripeCustomerId) {
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
  if (
    subscription &&
    (
      !hasHostedBillingPlanSwitchPristineDefaultSettings({
        schedule,
        subscription,
      }) ||
      !hasHostedBillingPlanSwitchCurrentPhaseCanonicalState({
        context,
        currentPhase,
        subscription,
      })
    )
  ) {
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

function isHostedBillingPlanSwitchPristineAttachedSchedule(input: {
  context: HostedSwitchScheduleContext;
  liveSchedule: Stripe.SubscriptionSchedule;
  subscription: Stripe.Subscription;
}): boolean {
  if (
    input.liveSchedule.status !== "active"
    || input.liveSchedule.end_behavior !== "release"
    || coerceStripeObjectId(input.liveSchedule.subscription)
      !== input.context.stripeSubscriptionId
    || coerceStripeObjectId(input.liveSchedule.customer)
      !== input.context.stripeCustomerId
    || Object.keys(input.liveSchedule.metadata ?? {}).length > 0
    || input.liveSchedule.phases.length !== 1
    || !hasHostedBillingPlanSwitchPristineDefaultSettings({
      schedule: input.liveSchedule,
      subscription: input.subscription,
    })
  ) {
    return false;
  }

  const currentPhase = input.liveSchedule.phases[0];
  if (
    !currentPhase
    || !input.liveSchedule.current_phase
    || currentPhase.start_date !== input.liveSchedule.current_phase.start_date
    || currentPhase.end_date !== input.liveSchedule.current_phase.end_date
    || !hasHostedBillingPlanSwitchCurrentPhaseCanonicalState({
      context: input.context,
      currentPhase,
      subscription: input.subscription,
    })
  ) {
    return false;
  }

  return true;
}

function hasHostedBillingPlanSwitchCurrentPhaseCanonicalState(input: {
  context: HostedSwitchScheduleContext;
  currentPhase: Stripe.SubscriptionSchedule.Phase;
  subscription: Stripe.Subscription;
}): boolean {
  return input.currentPhase.start_date < input.context.currentPeriodEndUnix &&
    input.currentPhase.end_date === input.context.currentPeriodEndUnix &&
    isHostedBillingPlanSwitchPristinePhaseMetadata({
      phaseMetadata: input.currentPhase.metadata,
      subscriptionMetadata: input.subscription.metadata,
    }) &&
    coerceStripeObjectId(input.currentPhase.default_payment_method) ===
      coerceStripeObjectId(input.subscription.default_payment_method) &&
    input.currentPhase.collection_method ===
      input.subscription.collection_method &&
    input.currentPhase.description === input.subscription.description &&
    (input.currentPhase.trial_end ?? null) ===
      (input.subscription.trial_end ?? null) &&
    hasExactHostedStripeSchedulePhaseItems(
      input.currentPhase,
      input.subscription.items.data,
    );
}

function isHostedBillingPlanSwitchPristinePhaseMetadata(input: {
  phaseMetadata: Stripe.Metadata | null;
  subscriptionMetadata: Stripe.Metadata;
}): boolean {
  const phaseMetadata = input.phaseMetadata ?? {};
  if (Object.keys(phaseMetadata).length === 0) {
    return true;
  }

  const subscriptionEntries = Object.entries(input.subscriptionMetadata);
  return Object.keys(phaseMetadata).length === subscriptionEntries.length &&
    subscriptionEntries.every(
      ([key, value]) => phaseMetadata[key] === value,
    );
}

function hasHostedBillingPlanSwitchPristineDefaultSettings(input: {
  schedule: Stripe.SubscriptionSchedule;
  subscription: Stripe.Subscription;
}): boolean {
  const settings = input.schedule.default_settings;
  return settings.billing_cycle_anchor === "automatic" &&
    settings.collection_method === input.subscription.collection_method &&
    coerceStripeObjectId(settings.default_payment_method) ===
      coerceStripeObjectId(input.subscription.default_payment_method) &&
    settings.description === input.subscription.description;
}

function hasExactHostedStripeSchedulePhaseItems(
  phase: Stripe.SubscriptionSchedule.Phase,
  subscriptionItems: readonly Stripe.SubscriptionItem[],
): boolean {
  const canonicalizeItem = (item: {
    price: string | Stripe.Price | Stripe.DeletedPrice;
    quantity?: number | null;
  }): string | null => {
    const priceId = coerceStripeObjectId(item.price);
    return priceId
      ? `${priceId}:${item.quantity ?? "metered"}`
      : null;
  };
  const actualItems = phase.items.map(canonicalizeItem).sort();
  const expectedItems = subscriptionItems.map(canonicalizeItem).sort();
  return actualItems.length === expectedItems.length &&
    !actualItems.includes(null) &&
    !expectedItems.includes(null) &&
    actualItems.every((item, index) => item === expectedItems[index]);
}

function isHostedBillingPlanSwitchScheduleMetadataCompatible(
  metadata: Stripe.Metadata | null,
  context: HostedSwitchScheduleContext,
): boolean {
  return metadata?.murphPlanSwitch ===
      resolveHostedBillingPlanSwitchMarker(context) &&
    metadata.memberId === context.memberId &&
    metadata.billingPlanCode === context.targetPlanCode &&
    metadata.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER;
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
  expectedStripeCustomerId: string;
  schedule: Stripe.SubscriptionSchedule;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const member = await readHostedMemberCoreState({
    memberId: input.context.memberId,
    prisma: input.tx,
  });
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.context.memberId,
    prisma: input.tx,
  });
  assertHostedBillingPlanSwitchLockedSource({
    billingRef,
    expectedStripeCustomerId: input.expectedStripeCustomerId,
    expectedStripeSubscriptionId: input.context.stripeSubscriptionId,
    member,
    targetPlanCode: input.context.targetPlanCode,
  });

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
    return `hosted-billing-switch-to-pulse:${SWITCH_TO_PULSE_UPDATE_OPERATION_VERSION}:update:${sha256Hex(JSON.stringify({
      currentPeriodEnd: context.currentPeriodEndUnix,
      memberId: context.memberId,
      edgePriceId: context.sourceConfig.priceId,
      pulsePriceId: context.targetConfig.priceId,
      stripeSubscriptionId: context.stripeSubscriptionId,
      targetPlanCode: LEGACY_EDGE_TO_PULSE_TARGET_PLAN,
    }))}`;
  }

  return `hosted-billing-switch:v1:update:${sha256Hex(JSON.stringify({
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
  return context.sourcePlanCode === LEGACY_EDGE_TO_PULSE_SOURCE_PLAN &&
    context.targetPlanCode === LEGACY_EDGE_TO_PULSE_TARGET_PLAN;
}

function resolveHostedBillingPlanSwitchMarker(
  context: HostedSwitchScheduleContext,
): string {
  return isLegacyEdgeToPulseSwitch(context)
    ? LEGACY_EDGE_TO_PULSE_MARKER
    : DIRECT_PLAN_SWITCH_MARKER;
}

function buildHostedBillingPlanSwitchStripeRequestOptions(input: {
  idempotencyKey?: string;
  providerDeadlineMs: number;
}): Stripe.RequestOptions {
  const remainingMs = Math.floor(input.providerDeadlineMs - Date.now());
  if (remainingMs <= 0) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      httpStatus: 502,
      message:
        "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  }

  return {
    ...(input.idempotencyKey
      ? { idempotencyKey: input.idempotencyKey }
      : {}),
    maxNetworkRetries: 0,
    timeout: Math.min(
      remainingMs,
      SWITCH_TO_PULSE_STRIPE_REQUEST_TIMEOUT_MS,
    ),
  };
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

function buildHostedStripeSubscriptionConfigurationUnsupportedError(
  reason: string,
) {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_CONFIGURATION_UNSUPPORTED",
    details: {
      code: reason,
    },
    httpStatus: 409,
    message:
      "Your Stripe subscription has billing settings that this plan change cannot safely preserve.",
  });
}

function buildHostedBillingPlanSwitchScheduleConflictError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
    httpStatus: 409,
    message: "A billing change is already scheduled. Contact support if you want to change it.",
  });
}

function buildHostedBillingPlanSwitchSourceChangedError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_SWITCH_STATE_CHANGED",
    httpStatus: 409,
    message: "Your billing ownership changed before this plan switch could start.",
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
    const retryable = isHostedStripeRetryableFailure(error);
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      details: describeHostedStripeErrorDetails({ error, operationName }),
      httpStatus: retryable ? 502 : 500,
      message: retryable
        ? "Stripe billing is unavailable for plan changes right now. Try again shortly."
        : "Stripe could not complete this plan change. Contact support before trying again.",
      retryable,
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
