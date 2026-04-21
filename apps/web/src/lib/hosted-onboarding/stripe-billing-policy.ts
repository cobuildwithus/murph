import { HostedBillingStatus, Prisma } from "@prisma/client";

import {
  writeHostedMemberStripeBillingRefTx,
} from "./hosted-member-billing-store";
import {
  type HostedMemberBillingSnapshot,
  readHostedMemberBillingSnapshot,
  readHostedMemberCoreState,
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

export async function updateHostedMemberStripeBillingIfFreshTx(input: {
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

  const currentMember = await readHostedMemberCoreState({
    memberId: input.member.core.id,
    prisma: input.tx,
  });

  if (!currentMember) {
    return null;
  }

  const nextBillingStatus = resolveHostedStripeBillingStatusForWrite({
    billingStatus: input.billingStatus,
    canonicalBillingStatus: input.canonicalBillingStatus,
    currentBillingStatus: currentMember.billingStatus,
    sourceType: input.dispatchContext.sourceType,
  });

  await updateHostedMemberCoreState({
    billingStatus: nextBillingStatus,
    memberId: currentMember.id,
    prisma: input.tx,
    suspendedAt: input.suspendedAtOverride,
  });

  await writeHostedMemberStripeBillingRefTx({
    memberId: currentMember.id,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    tx: input.tx,
  });

  return readHostedMemberBillingSnapshot({
    memberId: currentMember.id,
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
  await updateHostedMemberStripeBillingIfFreshTx({
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
