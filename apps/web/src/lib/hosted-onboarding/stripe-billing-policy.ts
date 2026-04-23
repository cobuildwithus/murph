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
  dispatchContext: HostedStripeDispatchContext;
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

  if (isHostedStripeBillingWriteStale(currentMember.billingRef, input.dispatchContext)) {
    return null;
  }

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
    stripeEventCreatedAt: input.dispatchContext.eventCreatedAt,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    tx: input.tx,
  });

  return readHostedMemberBillingSnapshot({
    memberId: currentMember.core.id,
    prisma: input.tx,
  });
}

export const updateHostedMemberStripeBillingIfFreshTx = writeHostedMemberStripeBillingTx;

export async function writeHostedMemberStripeBillingRefIfFreshTx(input: {
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
