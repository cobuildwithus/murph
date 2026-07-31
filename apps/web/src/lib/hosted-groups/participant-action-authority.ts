import "server-only";

import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";

import { readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hasHostedMemberActivationProof } from "../hosted-onboarding/member-activation";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { resolveHostedGroupMessageSenderMemberId } from "./group-message-sender";

export async function assertHostedGroupParticipantActionOriginHasOwnMurph(input: {
  originAssistantInputId: string;
  prisma?: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}): Promise<string> {
  const prisma = input.prisma ?? getPrisma();
  input.signal?.throwIfAborted();
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.originAssistantInputId,
    memberId: input.routeAuthority.containerMemberId,
    prisma,
  });
  input.signal?.throwIfAborted();
  const memberId = wake
    ? await resolveHostedGroupMessageSenderMemberId({
        prisma,
        routeAuthority: input.routeAuthority,
        wake,
      })
    : null;
  if (!memberId) {
    throwParticipantAuthorityRequired();
  }

  const memberships = await prisma.hostedGroupMember.findMany({
    select: {
      member: { select: { suspendedAt: true } },
      memberId: true,
    },
    take: 2,
    where: {
      group: {
        is: { runtimeMemberId: input.routeAuthority.containerMemberId },
      },
      joinedAt: { not: null },
      memberId,
    },
  });
  const membership = memberships[0];
  if (
    memberships.length !== 1
    || !membership
    || membership.member.suspendedAt !== null
  ) {
    throwParticipantAuthorityRequired();
  }
  input.signal?.throwIfAborted();
  if (!await hasHostedMemberActivationProof({ memberId, prisma })) {
    throwParticipantAuthorityRequired();
  }
  return memberId;
}

function throwParticipantAuthorityRequired(): never {
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_PARTICIPANT_ACTION_AUTHORITY_REQUIRED",
    httpStatus: 403,
    message:
      "This group action requires one current activated participant as its origin.",
    retryable: false,
  });
}
