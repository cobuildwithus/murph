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

export type HostedStripeBillingFreshnessPolicy =
  | "strict"
  | "positive-invoice-entitlement";

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
  currentBillingPlanCode?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  dispatchContext: HostedStripeDispatchContext;
  freshnessPolicy?: HostedStripeBillingFreshnessPolicy;
  member: HostedMemberBillingSnapshot;
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

  const freshnessPolicy = input.freshnessPolicy ?? "strict";
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

  if (isStale && !allowStalePositiveInvoiceWrite) {
    return null;
  }

  const billingRefWriteValues = resolveHostedStripeBillingRefWriteValues({
    billingRef: currentMember.billingRef,
    preserveCurrentWhenNextMissing: allowStalePositiveInvoiceWrite,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  const nextBillingStatus = resolveHostedStripeBillingStatusForWrite({
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingStatus: currentMember.core.billingStatus,
    sourceType: input.dispatchContext.sourceType,
  });

  await updateHostedMemberCoreState({
    billingStatus: nextBillingStatus,
    memberId: currentMember.core.id,
    prisma: input.tx,
    suspendedAt: input.suspendedAtOverride,
  });

  await writeHostedMemberStripeBillingRefTx({
    memberId: currentMember.core.id,
    currentBillingPlanCode: input.currentBillingPlanCode,
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    stripeEventCreatedAt: resolveHostedStripeBillingRefEventCreatedAt({
      billingRef: currentMember.billingRef,
      dispatchContext: input.dispatchContext,
    }),
    stripeCustomerId: billingRefWriteValues.stripeCustomerId,
    stripeSubscriptionId: billingRefWriteValues.stripeSubscriptionId,
    tx: input.tx,
  });

  return readHostedMemberBillingSnapshot({
    memberId: currentMember.core.id,
    prisma: input.tx,
  });
}

export const updateHostedMemberStripeBillingIfFreshTx = writeHostedMemberStripeBillingTx;

export async function writeHostedMemberStripeBillingRefIfFreshTx(input: {
  currentBillingPlanCode?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  memberId: string;
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

  await writeHostedMemberStripeBillingRefTx({
    memberId: input.memberId,
    currentBillingPlanCode: input.currentBillingPlanCode,
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    stripeEventCreatedAt: input.dispatchContext.eventCreatedAt,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    tx: input.tx,
  });

  return readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });
}

export async function suspendHostedMemberForBillingReversalTx(input: {
  canonicalBillingStatus: HostedBillingStatus | null;
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">;
  member: HostedMemberBillingSnapshot;
  stripeCustomerId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.unpaid,
    canonicalBillingStatus: input.canonicalBillingStatus,
    dispatchContext: {
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.dispatchContext.sourceType,
    },
    member: input.member,
    stripeCustomerId: input.stripeCustomerId,
    suspendedAtOverride: input.dispatchContext.eventCreatedAt,
    tx: input.tx,
  });
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
