import { HostedBillingStatus, Prisma } from "@prisma/client";

import {
  type HostedMemberStripeBillingRefSnapshot,
  writeHostedMemberStripeBillingRefTx,
} from "./hosted-member-billing-store";
import {
  type HostedMemberBillingSnapshot,
  readHostedMemberBillingSnapshot,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import { assertHostedMemberNotSuspended } from "./entitlement";
import {
  lockHostedMemberRow,
} from "./shared";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  requiresHostedCanonicalStripeBillingStatus,
  resolveHostedStripeBillingStatusForWrite,
} from "./stripe-billing-status";
import {
  HOSTED_PULSE_TRIAL_OFFER,
  isHostedBillingPlanImmediateUpgrade,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "./billing-plans";
import type { HostedPulseTrialStartSource } from "./pulse-trial-start-source";

type HostedUsagePlanTransitionWrite = {
  usagePlanTransitionAt: Date;
  usagePlanTransitionFromCode: string;
  usagePlanTransitionKind: "plan_upgrade" | "trial_conversion";
  usagePlanTransitionToCode: string;
};

export type HostedStripeBillingFreshnessPolicy =
  | "auto-pulse-trial-entitlement"
  | "proven-current-refund"
  | "strict"
  | "positive-invoice-entitlement"
  | "trial-checkout-entitlement";

export async function prepareHostedMemberStripeBillingWrite(input: {
  canonicalBillingStatus?: HostedBillingStatus | null;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberBillingSnapshot;
}): Promise<{
  canonicalBillingStatus: HostedBillingStatus | null;
  member: HostedMemberBillingSnapshot;
}> {
  const requiresCanonicalBillingStatus = requiresHostedCanonicalStripeBillingStatus(
    input.dispatchContext.sourceType,
  );

  if (requiresCanonicalBillingStatus && input.canonicalBillingStatus === undefined) {
    throw new Error(
      `Canonical Stripe subscription state must be resolved before ${input.dispatchContext.sourceType} billing writes.`,
    );
  }

  return {
    canonicalBillingStatus: input.canonicalBillingStatus ?? null,
    member: input.member,
  };
}

export async function writeHostedMemberStripeBillingTx(input: {
  billingStatus: HostedBillingStatus;
  canonicalBillingStatus: HostedBillingStatus | null;
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentCheckoutOffer?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
  dispatchContext: HostedStripeDispatchContext;
  freshnessPolicy?: HostedStripeBillingFreshnessPolicy;
  member: HostedMemberBillingSnapshot;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  pulseTrialStartSource?: HostedPulseTrialStartSource | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  suspendedAtOverride?: Date | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberBillingSnapshot | null> {
  await lockHostedMemberRow(input.tx, input.member.core.id);
  const currentMember = await readHostedMemberBillingSnapshot({
    memberId: input.member.core.id,
    prisma: input.tx,
  });

  if (!currentMember) {
    return null;
  }

  const intentionalSuspension = input.suspendedAtOverride;
  const billingOwnsCurrentSuspension =
    isHostedStripeBillingOwnedSuspension(currentMember);
  if (intentionalSuspension === undefined && billingOwnsCurrentSuspension) {
    const identityIsCompatible =
      hostedStripeBillingRefValueMatches(
        currentMember.billingRef?.stripeCustomerId,
        input.stripeCustomerId,
      )
      && hostedStripeBillingRefValueMatches(
        currentMember.billingRef?.stripeSubscriptionId,
        input.stripeSubscriptionId,
      );
    const stripeCustomerId =
      identityIsCompatible && !currentMember.billingRef?.stripeCustomerId
        ? input.stripeCustomerId || undefined
        : undefined;
    const stripeSubscriptionId =
      identityIsCompatible && !currentMember.billingRef?.stripeSubscriptionId
        ? input.stripeSubscriptionId || undefined
        : undefined;
    const suspendedAt = currentMember.core.suspendedAt;

    if ((!stripeCustomerId && !stripeSubscriptionId) || !suspendedAt) {
      return currentMember;
    }

    await updateHostedMemberCoreState({
      memberId: currentMember.core.id,
      prisma: input.tx,
      suspendedAt: null,
    });
    await writeHostedMemberStripeBillingRefTx({
      memberId: currentMember.core.id,
      stripeCustomerId,
      stripeSubscriptionId,
      tx: input.tx,
    });
    await updateHostedMemberCoreState({
      memberId: currentMember.core.id,
      prisma: input.tx,
      suspendedAt,
    });

    return readHostedMemberBillingSnapshot({
      memberId: currentMember.core.id,
      prisma: input.tx,
    });
  }

  const freshnessPolicy = input.freshnessPolicy ?? "strict";
  if (shouldRejectPulseTrialEntitlementWriteForCurrentMember({
    billingRef: currentMember.billingRef,
    currentBillingStatus: currentMember.core.billingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentCheckoutOffer: input.currentCheckoutOffer,
    dispatchContext: input.dispatchContext,
    freshnessPolicy,
  })) {
    return null;
  }

  const isStale = isHostedStripeBillingWriteStale(currentMember.billingRef, input.dispatchContext);
  const allowStalePositiveInvoiceWrite = isStale && shouldAllowStalePositiveInvoiceBillingWrite({
    billingRef: currentMember.billingRef,
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingStatus: currentMember.core.billingStatus,
    dispatchContext: input.dispatchContext,
    freshnessPolicy,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  const allowStaleTrialCheckoutWrite = isStale && shouldAllowStaleTrialCheckoutBillingWrite({
    billingRef: currentMember.billingRef,
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingStatus: currentMember.core.billingStatus,
    currentCheckoutOffer: input.currentCheckoutOffer,
    dispatchContext: input.dispatchContext,
    freshnessPolicy,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  const allowStaleAutoPulseTrialWrite = isStale && shouldAllowStaleAutoPulseTrialBillingWrite({
    billingRef: currentMember.billingRef,
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingStatus: currentMember.core.billingStatus,
    currentCheckoutOffer: input.currentCheckoutOffer,
    dispatchContext: input.dispatchContext,
    freshnessPolicy,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  const allowStaleProvenCurrentRefundWrite = isStale && shouldAllowStaleProvenCurrentRefundWrite({
    billingRef: currentMember.billingRef,
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingStatus: currentMember.core.billingStatus,
    dispatchContext: input.dispatchContext,
    freshnessPolicy,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  if (
    isStale &&
    !allowStalePositiveInvoiceWrite &&
    !allowStaleTrialCheckoutWrite &&
    !allowStaleAutoPulseTrialWrite &&
    !allowStaleProvenCurrentRefundWrite
  ) {
    return null;
  }

  const billingRefWriteValues = resolveHostedStripeBillingRefWriteValues({
    billingRef: currentMember.billingRef,
    preserveCurrentWhenNextMissing:
      allowStalePositiveInvoiceWrite ||
      allowStaleTrialCheckoutWrite ||
      allowStaleAutoPulseTrialWrite ||
      allowStaleProvenCurrentRefundWrite,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  const nextBillingStatus = resolveHostedStripeBillingStatusForWrite({
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingStatus: currentMember.core.billingStatus,
    currentCheckoutOffer: input.currentCheckoutOffer,
    currentTrialEndsAt:
      input.currentTrialEndsAt ?? currentMember.billingRef?.currentTrialEndsAt ?? null,
    eventCreatedAt: input.dispatchContext.eventCreatedAt,
    sourceType: input.dispatchContext.sourceType,
  });
  const nextStripeEventCreatedAt = resolveHostedStripeBillingRefEventCreatedAt({
    billingRef: currentMember.billingRef,
    dispatchContext: input.dispatchContext,
  });
  const appliedScheduledPlan =
    input.currentBillingPlanCode !== undefined
    && input.currentBillingPlanCode !== null
    && input.currentBillingPlanCode === currentMember.billingRef?.scheduledBillingPlanCode;
  const usagePlanTransition = resolveHostedUsagePlanTransitionWrite({
    billingRef: currentMember.billingRef,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingPlanCode: input.currentBillingPlanCode,
    currentCheckoutOffer: input.currentCheckoutOffer,
    eventCreatedAt: input.dispatchContext.eventCreatedAt,
  });

  const writeBillingRef = () => writeHostedMemberStripeBillingRefTx({
    memberId: currentMember.core.id,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingPlanCode: input.currentBillingPlanCode,
    currentCheckoutOffer: input.currentCheckoutOffer,
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    currentTrialEndsAt: input.currentTrialEndsAt,
    currentTrialStartedAt: input.currentTrialStartedAt,
    pulseTrialPolicyVersion: input.pulseTrialPolicyVersion,
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt,
    pulseTrialStartSource: input.pulseTrialStartSource,
    ...(appliedScheduledPlan
      ? {
          scheduledBillingEffectiveAt: null,
          scheduledBillingPlanCode: null,
          stripeSubscriptionScheduleId: null,
        }
      : {}),
    stripeEventCreatedAt: nextStripeEventCreatedAt,
    stripeCustomerId: billingRefWriteValues.stripeCustomerId,
    stripeSubscriptionId: billingRefWriteValues.stripeSubscriptionId,
    tx: input.tx,
    ...(usagePlanTransition ?? {}),
  });

  if (
    intentionalSuspension !== undefined
    && currentMember.core.suspendedAt
    && !billingOwnsCurrentSuspension
  ) {
    assertHostedMemberNotSuspended(currentMember.core);
  }
  if (intentionalSuspension !== undefined && intentionalSuspension !== null) {
    if (currentMember.core.suspendedAt) {
      await updateHostedMemberCoreState({
        billingStatus: nextBillingStatus,
        memberId: currentMember.core.id,
        prisma: input.tx,
        suspendedAt: null,
      });
    }
    await writeBillingRef();
    await updateHostedMemberCoreState({
      billingStatus: nextBillingStatus,
      memberId: currentMember.core.id,
      prisma: input.tx,
      suspendedAt: intentionalSuspension,
    });
  } else {
    await updateHostedMemberCoreState({
      billingStatus: nextBillingStatus,
      memberId: currentMember.core.id,
      prisma: input.tx,
      suspendedAt: input.suspendedAtOverride,
    });
    await writeBillingRef();
  }

  return readHostedMemberBillingSnapshot({
    memberId: currentMember.core.id,
    prisma: input.tx,
  });
}

function resolveHostedUsagePlanTransitionWrite(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentCheckoutOffer?: string | null;
  eventCreatedAt: Date;
}): HostedUsagePlanTransitionWrite | null {
  const fromPlanCode = parseHostedBillingPlanCode(
    input.billingRef?.currentBillingPlanCode,
  );
  const toPlanCode = parseHostedBillingPlanCode(
    input.currentBillingPlanCode === undefined
      ? input.billingRef?.currentBillingPlanCode
      : input.currentBillingPlanCode,
  );
  if (!fromPlanCode || !toPlanCode) {
    return null;
  }

  const fromBillingPhase = parseHostedBillingPhase(
    input.billingRef?.currentBillingPhase,
  );
  const toBillingPhase = parseHostedBillingPhase(
    input.currentBillingPhase === undefined
      ? input.billingRef?.currentBillingPhase
      : input.currentBillingPhase,
  );
  const checkoutOffer = parseHostedBillingCheckoutOffer(
    input.currentCheckoutOffer === undefined
      ? input.billingRef?.currentCheckoutOffer
      : input.currentCheckoutOffer,
  );
  const kind =
    fromBillingPhase === "paid" &&
      toBillingPhase === "paid" &&
      isHostedBillingPlanImmediateUpgrade({
        currentPlanCode: fromPlanCode,
        targetPlanCode: toPlanCode,
      })
      ? "plan_upgrade"
      : fromBillingPhase === "trial" &&
          toBillingPhase === "paid" &&
          fromPlanCode === "launch_monthly" &&
          toPlanCode === "launch_monthly" &&
          checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
        ? "trial_conversion"
        : null;
  if (!kind) {
    return null;
  }

  return {
    usagePlanTransitionAt: input.eventCreatedAt,
    usagePlanTransitionFromCode: fromPlanCode,
    usagePlanTransitionKind: kind,
    usagePlanTransitionToCode: toPlanCode,
  };
}

export async function writeHostedMemberStripeBillingRefIfFreshTx(input: {
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentCheckoutOffer?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  memberId: string;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberBillingSnapshot | null> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const currentMember = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });

  if (!currentMember) {
    return null;
  }

  if (isHostedStripeBillingWriteStale(currentMember.billingRef, input.dispatchContext)) {
    return null;
  }

  const usagePlanTransition = resolveHostedUsagePlanTransitionWrite({
    billingRef: currentMember.billingRef,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingPlanCode: input.currentBillingPlanCode,
    currentCheckoutOffer: input.currentCheckoutOffer,
    eventCreatedAt: input.dispatchContext.eventCreatedAt,
  });

  await writeHostedMemberStripeBillingRefTx({
    memberId: input.memberId,
    currentBillingPhase: input.currentBillingPhase,
    currentBillingPlanCode: input.currentBillingPlanCode,
    currentCheckoutOffer: input.currentCheckoutOffer,
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    currentTrialEndsAt: input.currentTrialEndsAt,
    currentTrialStartedAt: input.currentTrialStartedAt,
    pulseTrialPolicyVersion: input.pulseTrialPolicyVersion,
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt,
    stripeEventCreatedAt: input.dispatchContext.eventCreatedAt,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    tx: input.tx,
    ...(usagePlanTransition ?? {}),
  });

  return readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });
}

export async function suspendHostedMemberForBillingReversalTx(input: {
  canonicalBillingStatus: HostedBillingStatus | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">;
  freshnessPolicy?: HostedStripeBillingFreshnessPolicy;
  member: HostedMemberBillingSnapshot;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const suspendedAt = input.freshnessPolicy === "proven-current-refund"
    && input.member.billingRef?.lastStripeEventCreatedAt
    && input.member.billingRef.lastStripeEventCreatedAt.getTime()
      > input.dispatchContext.eventCreatedAt.getTime()
    ? input.member.billingRef.lastStripeEventCreatedAt
    : input.dispatchContext.eventCreatedAt;
  await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.unpaid,
    canonicalBillingStatus: input.canonicalBillingStatus,
    dispatchContext: {
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.dispatchContext.sourceType,
    },
    freshnessPolicy: input.freshnessPolicy,
    member: input.member,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    suspendedAtOverride: suspendedAt,
    tx: input.tx,
  });
}

export async function terminalizeHostedFamilySponsoredDirectBillingTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  memberId: string;
  stripeSubscriptionId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });

  if (
    !member
    || member.billingRef?.stripeSubscriptionId !== input.stripeSubscriptionId
  ) {
    return false;
  }

  const updatedMember = await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.canceled,
    canonicalBillingStatus: HostedBillingStatus.canceled,
    dispatchContext: input.dispatchContext,
    member,
    stripeCustomerId: member.billingRef.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    suspendedAtOverride: isHostedStripeBillingOwnedSuspension(member)
      ? null
      : undefined,
    tx: input.tx,
  });

  if (
    !updatedMember
    || updatedMember.core.billingStatus !== HostedBillingStatus.canceled
    || updatedMember.billingRef?.stripeSubscriptionId !==
      input.stripeSubscriptionId
  ) {
    throw new Error(
      "Family-sponsored Stripe cleanup did not terminalize the exact direct billing projection.",
    );
  }

  return true;
}

function isHostedStripeBillingOwnedSuspension(
  member: HostedMemberBillingSnapshot,
): boolean {
  const suspendedAt = member.core.suspendedAt;
  const lastStripeEventCreatedAt = member.billingRef?.lastStripeEventCreatedAt ?? null;

  return member.core.billingStatus === HostedBillingStatus.unpaid
    && suspendedAt !== null
    && lastStripeEventCreatedAt !== null
    && suspendedAt.getTime() === lastStripeEventCreatedAt.getTime();
}

function isHostedStripeBillingWriteStale(
  billingRef: HostedMemberStripeBillingRefSnapshot | null,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">,
): boolean {
  const lastStripeEventCreatedAt = billingRef?.lastStripeEventCreatedAt ?? null;

  if (!lastStripeEventCreatedAt) {
    return false;
  }

  const nextStripeEventCreatedAtMs = dispatchContext.eventCreatedAt.getTime();
  const lastStripeEventCreatedAtMs = lastStripeEventCreatedAt.getTime();

  // Stripe's event ids are not monotonic, so same-second writes remain eligible.
  if (nextStripeEventCreatedAtMs === lastStripeEventCreatedAtMs) {
    return false;
  }

  return nextStripeEventCreatedAtMs < lastStripeEventCreatedAtMs;
}

function shouldAllowStalePositiveInvoiceBillingWrite(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  billingStatus: HostedBillingStatus;
  canonicalBillingStatus: HostedBillingStatus | null;
  currentBillingStatus: HostedBillingStatus;
  dispatchContext: Pick<HostedStripeDispatchContext, "sourceType">;
  freshnessPolicy: HostedStripeBillingFreshnessPolicy;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): boolean {
  if (input.freshnessPolicy !== "positive-invoice-entitlement") {
    return false;
  }

  if (input.dispatchContext.sourceType !== "stripe.invoice.paid") {
    return false;
  }

  if (
    input.billingStatus !== HostedBillingStatus.active ||
    input.canonicalBillingStatus !== HostedBillingStatus.active
  ) {
    return false;
  }

  if (!canOlderPositiveInvoiceWriteCurrentBillingStatus(input.currentBillingStatus)) {
    return false;
  }

  return hostedStripeBillingRefValueMatches(input.billingRef?.stripeCustomerId, input.stripeCustomerId) &&
    hostedStripeBillingRefValueMatches(input.billingRef?.stripeSubscriptionId, input.stripeSubscriptionId);
}

function shouldAllowStaleTrialCheckoutBillingWrite(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  billingStatus: HostedBillingStatus;
  canonicalBillingStatus: HostedBillingStatus | null;
  currentBillingPhase?: string | null;
  currentBillingStatus: HostedBillingStatus;
  currentCheckoutOffer?: string | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "sourceType">;
  freshnessPolicy: HostedStripeBillingFreshnessPolicy;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): boolean {
  if (input.freshnessPolicy !== "trial-checkout-entitlement") {
    return false;
  }

  if (input.dispatchContext.sourceType !== "stripe.checkout.session.completed") {
    return false;
  }

  if (
    input.billingStatus !== HostedBillingStatus.active ||
    input.canonicalBillingStatus !== HostedBillingStatus.active
  ) {
    return false;
  }

  if (input.currentBillingPhase !== "trial" || input.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return false;
  }

  if (input.billingRef?.currentBillingPhase === "paid") {
    return false;
  }

  if (!canOlderPositiveInvoiceWriteCurrentBillingStatus(input.currentBillingStatus)) {
    return false;
  }

  return hostedStripeBillingRefValueMatches(input.billingRef?.stripeCustomerId, input.stripeCustomerId) &&
    hostedStripeBillingRefValueMatches(input.billingRef?.stripeSubscriptionId, input.stripeSubscriptionId);
}

function shouldAllowStaleAutoPulseTrialBillingWrite(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  billingStatus: HostedBillingStatus;
  canonicalBillingStatus: HostedBillingStatus | null;
  currentBillingPhase?: string | null;
  currentBillingStatus: HostedBillingStatus;
  currentCheckoutOffer?: string | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "sourceType">;
  freshnessPolicy: HostedStripeBillingFreshnessPolicy;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): boolean {
  if (input.freshnessPolicy !== "auto-pulse-trial-entitlement") {
    return false;
  }

  // The auto-trial service timestamps its dispatch after an initial read, but
  // this writer locks and re-reads the member later. A same-subscription
  // passive webhook can advance freshness between those reads; this policy only
  // lets the locally-created trial entitlement finish for the same Stripe ref.
  if (input.dispatchContext.sourceType !== "hosted.auto_pulse_trial.enrolled") {
    return false;
  }

  if (
    input.billingStatus !== HostedBillingStatus.active ||
    input.canonicalBillingStatus !== HostedBillingStatus.active
  ) {
    return false;
  }

  if (input.currentBillingPhase !== "trial" || input.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return false;
  }

  if (input.billingRef?.currentBillingPhase === "paid") {
    return false;
  }

  if (!canOlderPositiveInvoiceWriteCurrentBillingStatus(input.currentBillingStatus)) {
    return false;
  }

  return hostedStripeBillingRefValueMatches(input.billingRef?.stripeCustomerId, input.stripeCustomerId) &&
    hostedStripeBillingRefValueMatches(input.billingRef?.stripeSubscriptionId, input.stripeSubscriptionId);
}

function shouldAllowStaleProvenCurrentRefundWrite(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  billingStatus: HostedBillingStatus;
  canonicalBillingStatus: HostedBillingStatus | null;
  currentBillingStatus: HostedBillingStatus;
  dispatchContext: Pick<HostedStripeDispatchContext, "sourceType">;
  freshnessPolicy: HostedStripeBillingFreshnessPolicy;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): boolean {
  if (
    input.freshnessPolicy !== "proven-current-refund"
    || (
      input.dispatchContext.sourceType !== "stripe.refund.created"
      && input.dispatchContext.sourceType !== "stripe.refund.updated"
    )
    || input.billingStatus !== HostedBillingStatus.unpaid
    || input.canonicalBillingStatus !== HostedBillingStatus.active
    || (
      input.currentBillingStatus !== HostedBillingStatus.active
      && input.currentBillingStatus !== HostedBillingStatus.unpaid
    )
  ) {
    return false;
  }

  const currentCustomerId = input.billingRef?.stripeCustomerId ?? null;
  const currentSubscriptionId = input.billingRef?.stripeSubscriptionId ?? null;
  return Boolean(
    currentCustomerId
    && input.stripeCustomerId
    && currentCustomerId === input.stripeCustomerId
    && currentSubscriptionId
    && input.stripeSubscriptionId
    && currentSubscriptionId === input.stripeSubscriptionId,
  );
}

function shouldRejectPulseTrialEntitlementWriteForCurrentMember(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  currentBillingPhase?: string | null;
  currentBillingStatus: HostedBillingStatus;
  currentCheckoutOffer?: string | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "sourceType">;
  freshnessPolicy: HostedStripeBillingFreshnessPolicy;
}): boolean {
  if (!isPulseTrialEntitlementWritePolicy(input)) {
    return false;
  }

  if (input.currentBillingPhase !== "trial" || input.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return false;
  }

  if (input.billingRef?.pulseTrialRedeemedAt) {
    return true;
  }

  if (input.billingRef?.currentBillingPhase === "paid") {
    return true;
  }

  return input.currentBillingStatus === HostedBillingStatus.active &&
    input.billingRef?.currentBillingPhase !== "trial";
}

function isPulseTrialEntitlementWritePolicy(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "sourceType">;
  freshnessPolicy: HostedStripeBillingFreshnessPolicy;
}): boolean {
  return (
    input.freshnessPolicy === "trial-checkout-entitlement" &&
    input.dispatchContext.sourceType === "stripe.checkout.session.completed"
  ) || (
    input.freshnessPolicy === "auto-pulse-trial-entitlement" &&
    input.dispatchContext.sourceType === "hosted.auto_pulse_trial.enrolled"
  );
}

function canOlderPositiveInvoiceWriteCurrentBillingStatus(
  billingStatus: HostedBillingStatus,
): boolean {
  return billingStatus === HostedBillingStatus.not_started ||
    billingStatus === HostedBillingStatus.incomplete ||
    billingStatus === HostedBillingStatus.active;
}

function hostedStripeBillingRefValueMatches(
  currentValue: string | null | undefined,
  nextValue: string | null | undefined,
): boolean {
  if (!currentValue || !nextValue) {
    return true;
  }

  return currentValue === nextValue;
}

function resolveHostedStripeBillingRefEventCreatedAt(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt">;
}): Date {
  const lastStripeEventCreatedAt = input.billingRef?.lastStripeEventCreatedAt ?? null;

  if (
    lastStripeEventCreatedAt &&
    input.dispatchContext.eventCreatedAt.getTime() < lastStripeEventCreatedAt.getTime()
  ) {
    return lastStripeEventCreatedAt;
  }

  return input.dispatchContext.eventCreatedAt;
}

function resolveHostedStripeBillingRefWriteValues(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  preserveCurrentWhenNextMissing: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
} {
  return {
    stripeCustomerId: resolveHostedStripeBillingRefWriteValue({
      currentValue: input.billingRef?.stripeCustomerId,
      nextValue: input.stripeCustomerId,
      preserveCurrentWhenNextMissing: input.preserveCurrentWhenNextMissing,
    }),
    stripeSubscriptionId: resolveHostedStripeBillingRefWriteValue({
      currentValue: input.billingRef?.stripeSubscriptionId,
      nextValue: input.stripeSubscriptionId,
      preserveCurrentWhenNextMissing: input.preserveCurrentWhenNextMissing,
    }),
  };
}

function resolveHostedStripeBillingRefWriteValue(input: {
  currentValue: string | null | undefined;
  nextValue: string | null | undefined;
  preserveCurrentWhenNextMissing: boolean;
}): string | null | undefined {
  if (
    input.preserveCurrentWhenNextMissing &&
    !input.nextValue &&
    input.currentValue
  ) {
    return input.currentValue;
  }

  return input.nextValue;
}
