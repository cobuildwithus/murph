import { HostedBillingStatus, Prisma } from "@prisma/client";

import {
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  writeHostedMemberStripeBillingRefTx,
} from "./hosted-member-billing-store";
import {
  type HostedMemberBillingSnapshot,
  readHostedMemberBillingSnapshot,
  readHostedMemberCoreState,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import {
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  requiresHostedCanonicalStripeBillingStatus,
  resolveHostedStripeBillingStatusForWrite,
} from "./stripe-billing-status";

export async function prepareHostedMemberStripeBillingWrite(input: {
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberBillingSnapshot;
  prisma: HostedOnboardingReadClient;
  stripeSubscriptionId?: string | null;
}): Promise<{
  canonicalBillingStatus: HostedBillingStatus | null;
  member: HostedMemberBillingSnapshot;
}> {
  const requiresCanonicalBillingStatus = requiresHostedCanonicalStripeBillingStatus(
    input.dispatchContext.sourceType,
  );
  const member =
    requiresCanonicalBillingStatus && !input.stripeSubscriptionId
      ? (await readHostedMemberBillingSnapshot({
          memberId: input.member.core.id,
          prisma: input.prisma,
        })) ?? input.member
      : input.member;

  return {
    canonicalBillingStatus: requiresCanonicalBillingStatus
      ? await readHostedCanonicalStripeBillingStatus({
          member,
          stripeSubscriptionId: input.stripeSubscriptionId,
        })
      : null,
    member,
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

async function readHostedCanonicalStripeBillingStatus(input: {
  member: HostedMemberBillingSnapshot;
  stripeSubscriptionId?: string | null;
}): Promise<HostedBillingStatus | null> {
  const subscriptionId =
    input.stripeSubscriptionId ?? input.member.billingRef?.stripeSubscriptionId ?? null;

  if (!subscriptionId) {
    return null;
  }

  const stripe = requireHostedStripeApi();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
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
