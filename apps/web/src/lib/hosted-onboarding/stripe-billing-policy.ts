import {
  HostedBillingStatus,
  HostedRevnetIssuanceStatus,
  type Prisma,
} from "@prisma/client";

import { provisionManagedUserCryptoInHostedExecution } from "../hosted-execution/control";
import {
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
import {
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  buildHostedMemberActivationDispatch,
} from "./member-activation";
import {
  deriveHostedEntitlement,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import {
  type HostedMemberSnapshot,
  readHostedMemberSnapshot,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import {
  writeHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { requireHostedStripeApi } from "./runtime";
import {
  lockHostedMemberRow,
  withHostedOnboardingTransaction,
} from "./shared";

export type HostedStripeDispatchContext = {
  eventCreatedAt: Date;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
};

export type HostedMemberActivationResult = {
  activated: boolean;
  hostedExecutionEventId: string | null;
  memberId: string;
};

export type HostedMemberActivationTransactionResult = HostedMemberActivationResult & {
  postCommitProvisionUserId: string | null;
};

type HostedOnboardingPrismaClient = Prisma.TransactionClient;

export async function activateHostedMemberFromConfirmedRevnetIssuance(input: {
  member: HostedMemberSnapshot;
  occurredAt: string;
  prisma: HostedOnboardingPrismaClient;
  sourceEventId: string;
  sourceType: string;
}): Promise<HostedMemberActivationResult> {
  const activated = await tryActivateHostedMemberIfStillAllowed({
    member: input.member,
    prisma: input.prisma,
    revnetIssuanceStatus: HostedRevnetIssuanceStatus.confirmed,
    revnetRequired: true,
  });

  if (!activated) {
    return {
      activated: false,
      hostedExecutionEventId: null,
      memberId: input.member.core.id,
    };
  }

  await provisionManagedUserCryptoInHostedExecution(input.member.core.id);

  const dispatch = buildHostedMemberActivationDispatchForMember({
    member: input.member,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
  });
  await enqueueHostedExecutionOutbox({
    dispatch,
    sourceId: input.sourceEventId,
    sourceType: "hosted_revnet_issuance",
    tx: input.prisma,
  });

  return {
    activated: true,
    hostedExecutionEventId: dispatch.eventId,
    memberId: input.member.core.id,
  };
}

export function resolveHostedSubscriptionBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus;
  nextBillingStatus: HostedBillingStatus;
}): HostedBillingStatus {
  if (input.nextBillingStatus === HostedBillingStatus.active) {
    return input.currentBillingStatus === HostedBillingStatus.active
      ? HostedBillingStatus.active
      : HostedBillingStatus.incomplete;
  }

  return input.nextBillingStatus;
}

export async function activateHostedMemberForPositiveSource(input: {
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  skipIfBillingAlreadyActive?: boolean;
  sourceType: string;
}): Promise<HostedMemberActivationTransactionResult> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.core.id);

    const currentMember = await findHostedMemberById(tx, input.member.core.id);

    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
      return buildHostedInactiveMemberActivationResult(input.member.core.id);
    }

    const dispatch = buildHostedMemberActivationDispatchForMember({
      member: currentMember,
      occurredAt: input.dispatchContext.occurredAt,
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.sourceType,
    });

    if (
      input.skipIfBillingAlreadyActive &&
      currentMember.core.billingStatus === HostedBillingStatus.active
    ) {
      const existingDispatch = await tx.executionOutbox.findUnique({
        where: {
          eventId: dispatch.eventId,
        },
        select: {
          eventId: true,
        },
      });

      return existingDispatch
        ? {
            activated: false,
            hostedExecutionEventId: existingDispatch.eventId,
            memberId: currentMember.core.id,
            postCommitProvisionUserId: currentMember.core.id,
          }
        : buildHostedInactiveMemberActivationResult(currentMember.core.id);
    }

    const entitlement = deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: currentMember.core.suspendedAt,
    });

    if (!entitlement.activationReady) {
      return buildHostedInactiveMemberActivationResult(currentMember.core.id);
    }

    await updateHostedMemberCoreState({
      billingStatus: HostedBillingStatus.active,
      memberId: currentMember.core.id,
      prisma: tx,
    });

    const outboxRecord = await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: `stripe:${input.dispatchContext.sourceEventId}`,
      sourceType: "hosted_stripe_event",
      tx,
    });

    return {
      activated: true,
      hostedExecutionEventId: outboxRecord.eventId,
      memberId: currentMember.core.id,
      postCommitProvisionUserId: currentMember.core.id,
    };
  });
}

async function tryActivateHostedMemberIfStillAllowed(input: {
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
  skipIfBillingAlreadyActive?: boolean;
}): Promise<boolean> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.core.id);

    const currentMember = await findHostedMemberById(tx, input.member.core.id);

    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
      return false;
    }

    if (
      input.skipIfBillingAlreadyActive &&
      currentMember.core.billingStatus === HostedBillingStatus.active
    ) {
      return false;
    }

    const entitlement = deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      revnetIssuanceStatus: input.revnetIssuanceStatus,
      revnetRequired: input.revnetRequired,
      suspendedAt: currentMember.core.suspendedAt,
    });

    if (!entitlement.activationReady) {
      return false;
    }

    await updateHostedMemberCoreState({
      billingStatus: HostedBillingStatus.active,
      memberId: currentMember.core.id,
      prisma: tx,
    });

    return true;
  });
}

function buildHostedInactiveMemberActivationResult(
  memberId: string,
): HostedMemberActivationTransactionResult {
  return {
    activated: false,
    hostedExecutionEventId: null,
    memberId,
    postCommitProvisionUserId: null,
  };
}

function buildHostedMemberActivationDispatchForMember(input: {
  member: HostedMemberSnapshot;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}) {
  return buildHostedMemberActivationDispatch({
    linqChatId: input.member.routing?.linqChatId ?? null,
    memberId: input.member.core.id,
    phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
  });
}

export async function updateHostedMemberStripeBillingIfFresh(input: {
  billingStatus: HostedBillingStatus;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  suspendedAtOverride?: Date | null;
}): Promise<HostedMemberSnapshot | null> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.core.id);

    const currentMember = await findHostedMemberById(tx, input.member.core.id);

    if (!currentMember) {
      return null;
    }

    const nextBillingStatus = await resolveHostedBillingStatusForWrite({
      billingStatus: input.billingStatus,
      currentMember,
      dispatchContext: input.dispatchContext,
      stripeSubscriptionId: input.stripeSubscriptionId,
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

    return findHostedMemberById(tx, currentMember.core.id);
  });
}

async function findHostedMemberById(
  prisma: HostedOnboardingPrismaClient,
  memberId: string,
): Promise<HostedMemberSnapshot | null> {
  return readHostedMemberSnapshot({
    memberId,
    prisma,
  });
}

async function resolveHostedBillingStatusForWrite(input: {
  billingStatus: HostedBillingStatus;
  currentMember: HostedMemberSnapshot;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<HostedBillingStatus> {
  if (isHostedStripeBillingReversalSourceType(input.dispatchContext.sourceType)) {
    return input.billingStatus;
  }

  const canonicalBillingStatus = await resolveHostedCanonicalStripeBillingStatus(input);

  if (canonicalBillingStatus !== null) {
    if (isHostedStripeSubscriptionSourceType(input.dispatchContext.sourceType)) {
      return resolveHostedSubscriptionBillingStatus({
        currentBillingStatus: input.currentMember.core.billingStatus,
        nextBillingStatus: canonicalBillingStatus,
      });
    }

    if (input.dispatchContext.sourceType === "stripe.invoice.paid") {
      return canonicalBillingStatus === HostedBillingStatus.active
        ? HostedBillingStatus.active
        : canonicalBillingStatus;
    }

    return canonicalBillingStatus;
  }

  if (
    isHostedStripeSubscriptionSourceType(input.dispatchContext.sourceType) ||
    isHostedStripeInvoiceSourceType(input.dispatchContext.sourceType)
  ) {
    throw new Error(
      `Canonical Stripe subscription state is required for ${input.dispatchContext.sourceType}.`,
    );
  }

  return input.billingStatus;
}

async function resolveHostedCanonicalStripeBillingStatus(input: {
  currentMember: HostedMemberSnapshot;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<HostedBillingStatus | null> {
  const subscriptionId =
    input.stripeSubscriptionId ?? input.currentMember.billingRef?.stripeSubscriptionId ?? null;

  if (!subscriptionId) {
    return null;
  }

  const stripe = requireHostedStripeApi();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
}

function isHostedStripeBillingReversalSourceType(sourceType: string): boolean {
  return sourceType === "stripe.refund.created" || sourceType.startsWith("stripe.charge.dispute.");
}

function isHostedStripeSubscriptionSourceType(sourceType: string): boolean {
  return sourceType === "stripe.customer.subscription.created" ||
    sourceType === "stripe.customer.subscription.updated" ||
    sourceType === "stripe.customer.subscription.deleted";
}

function isHostedStripeInvoiceSourceType(sourceType: string): boolean {
  return sourceType === "stripe.invoice.paid" ||
    sourceType === "stripe.invoice.payment_failed";
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
