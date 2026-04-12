import {
  HostedBillingStatus,
  HostedRevnetIssuanceStatus,
} from "@prisma/client";
import {
  buildHostedExecutionMemberActivatedDispatch,
  type HostedExecutionDispatchRequest,
  type HostedExecutionMemberActivatedEvent,
} from "@murphai/hosted-execution";

import { provisionManagedUserCryptoInHostedExecution } from "../hosted-execution/control";
import {
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
import {
  deriveHostedEntitlement,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import {
  type HostedMemberSnapshot,
  readHostedMemberSnapshot,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import { resolveHostedMemberActivationLinqRoute } from "./linq-home-routing";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  lockHostedMemberRow,
  type HostedOnboardingPrismaClient,
  withHostedOnboardingTransaction,
} from "./shared";

export type HostedMemberActivationResult = {
  activated: boolean;
  hostedExecutionEventId: string | null;
  memberId: string;
};

export type HostedMemberActivationTransactionResult = HostedMemberActivationResult & {
  postCommitProvisionUserId: string | null;
};

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

  const linqRoute = await resolveHostedMemberActivationLinqRoute({
    member: input.member,
    prisma: input.prisma,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
  });
  const dispatch = buildHostedMemberActivationDispatchForMember({
    firstContactLinqChatId: linqRoute.firstContactLinqChatId,
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

export async function activateHostedMemberForPositiveSource(input: {
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  skipIfBillingAlreadyActive?: boolean;
}): Promise<HostedMemberActivationTransactionResult> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.core.id);

    const currentMember = await readHostedMemberSnapshot({
      memberId: input.member.core.id,
      prisma: tx,
    });

    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
      return buildHostedInactiveMemberActivationResult(input.member.core.id);
    }

    const activationEventId = buildHostedMemberActivationEventId({
      memberId: currentMember.core.id,
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.dispatchContext.sourceType,
    });

    if (
      input.skipIfBillingAlreadyActive &&
      currentMember.core.billingStatus === HostedBillingStatus.active
    ) {
      const existingDispatch = await tx.executionOutbox.findUnique({
        where: {
          eventId: activationEventId,
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

    const linqRoute = await resolveHostedMemberActivationLinqRoute({
      member: currentMember,
      prisma: tx,
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.dispatchContext.sourceType,
    });
    const dispatch = buildHostedMemberActivationDispatchForMember({
      firstContactLinqChatId: linqRoute.firstContactLinqChatId,
      member: currentMember,
      occurredAt: input.dispatchContext.occurredAt,
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.dispatchContext.sourceType,
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

export function buildHostedMemberActivationDispatch(input: {
  linqChatId?: string | null;
  memberId: string;
  phoneLookupKey?: string | null;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: buildHostedMemberActivationEventId(input),
    firstContact: buildHostedMemberActivationFirstContact({
      linqChatId: input.linqChatId ?? null,
      phoneLookupKey: input.phoneLookupKey ?? null,
    }),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedMemberActivationFirstContact(input: {
  linqChatId: string | null;
  phoneLookupKey: string | null;
}): HostedExecutionMemberActivatedEvent["firstContact"] {
  return input.linqChatId && input.phoneLookupKey
    ? {
        channel: "linq",
        identityId: input.phoneLookupKey,
        threadId: input.linqChatId,
        threadIsDirect: true,
      }
    : null;
}

export async function runHostedMemberActivationPostCommitEffects(input: {
  postCommitProvisionUserId: string | null;
}): Promise<void> {
  if (!input.postCommitProvisionUserId) {
    return;
  }

  await provisionManagedUserCryptoInHostedExecution(input.postCommitProvisionUserId);
}

async function tryActivateHostedMemberIfStillAllowed(input: {
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
}): Promise<boolean> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.core.id);

    const currentMember = await readHostedMemberSnapshot({
      memberId: input.member.core.id,
      prisma: tx,
    });

    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
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
  firstContactLinqChatId: string | null;
  member: HostedMemberSnapshot;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedExecutionDispatchRequest {
  return buildHostedMemberActivationDispatch({
    linqChatId: input.firstContactLinqChatId,
    memberId: input.member.core.id,
    phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
  });
}

export function buildHostedMemberActivationEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member.activated:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}
