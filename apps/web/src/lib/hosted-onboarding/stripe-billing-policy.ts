import { HostedBillingStatus } from "@prisma/client";

import {
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  writeHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import {
  type HostedMemberSnapshot,
  readHostedMemberSnapshot,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import {
  lockHostedMemberRow,
  type HostedOnboardingPrismaClient,
  withHostedOnboardingTransaction,
} from "./shared";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  requiresHostedCanonicalStripeBillingStatus,
  resolveHostedStripeBillingStatusForWrite,
} from "./stripe-billing-status";

export async function updateHostedMemberStripeBillingIfFresh(input: {
  billingStatus: HostedBillingStatus;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  suspendedAtOverride?: Date | null;
}): Promise<HostedMemberSnapshot | null> {
  const canonicalBillingStatus = requiresHostedCanonicalStripeBillingStatus(
    input.dispatchContext.sourceType,
  )
    ? await readHostedCanonicalStripeBillingStatus({
        member: input.member,
        stripeSubscriptionId: input.stripeSubscriptionId,
      })
    : null;

  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.core.id);

    const currentMember = await readHostedMemberSnapshot({
      memberId: input.member.core.id,
      prisma: tx,
    });

    if (!currentMember) {
      return null;
    }

    const nextBillingStatus = resolveHostedStripeBillingStatusForWrite({
      billingStatus: input.billingStatus,
      canonicalBillingStatus,
      currentBillingStatus: currentMember.core.billingStatus,
      sourceType: input.dispatchContext.sourceType,
    });

    await updateHostedMemberCoreState({
      billingStatus: nextBillingStatus,
      memberId: currentMember.core.id,
      prisma: tx,
      suspendedAt: input.suspendedAtOverride,
    });

    await writeHostedMemberStripeBillingRef({
      memberId: currentMember.core.id,
      prisma: tx,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    });

    return readHostedMemberSnapshot({
      memberId: currentMember.core.id,
      prisma: tx,
    });
  });
}

async function readHostedCanonicalStripeBillingStatus(input: {
  member: HostedMemberSnapshot;
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

export async function suspendHostedMemberForBillingReversal(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  reason: string;
  stripeCustomerId?: string | null;
}): Promise<void> {
  await updateHostedMemberStripeBillingIfFresh({
    billingStatus: HostedBillingStatus.unpaid,
    dispatchContext: {
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.reason,
    },
    member: input.member,
    prisma: input.prisma,
    stripeCustomerId: input.stripeCustomerId,
    suspendedAtOverride: input.dispatchContext.eventCreatedAt,
  });
}
