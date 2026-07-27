import "server-only";

import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionExternalThreadRouteAuthority,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX,
  type HostedPhoneCallGroupRequester,
} from "@murphai/hosted-execution/phone-calls";
import {
  lookupHostedGroupParticipantMemberByHandle,
  lookupHostedGroupParticipantMemberByProviderEvidence,
} from "../hosted-groups/participant-member";
import {
  readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxWakeByItemId,
} from "../hosted-mailbox/store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hasHostedMemberActivationProof } from "../hosted-onboarding/member-activation";
import { resolveHostedMemberRoutingByTelegramUserId } from "../hosted-onboarding/hosted-member-routing-store";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export async function assertHostedGroupPhoneCallRequesterHasOwnMurph(input: {
  groupRequester: HostedPhoneCallGroupRequester | null;
  inboundMailboxItemIds?: readonly string[];
  prisma?: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}): Promise<void> {
  if (!input.groupRequester) {
    await assertLegacyHostedGroupPhoneCallRequesterHasOwnMurph({
      ...input,
      inboundMailboxItemIds: input.inboundMailboxItemIds ?? [],
    });
    return;
  }
  const participant = normalizeHostedGroupPhoneCallRequester(
    input.groupRequester,
  );
  if (
    !participant
    || participant.source !== input.routeAuthority.channel
    || (
      input.routeAuthority.channel !== "linq"
      && input.routeAuthority.channel !== "telegram"
    )
  ) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }

  const prisma = input.prisma ?? getPrisma();
  input.signal?.throwIfAborted();
  const selectedParticipant = await readHostedGroupPhoneCallSelectedParticipant({
    assistantInputId: participant.assistantInputId,
    prisma,
    routeAuthority: input.routeAuthority,
  });
  input.signal?.throwIfAborted();
  if (
    !selectedParticipant
    || selectedParticipant.source !== participant.source
    || selectedParticipant.senderHandle !== participant.senderHandle
  ) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }

  const requester = await lookupHostedGroupParticipantMemberByProviderEvidence({
    participant: selectedParticipant,
    prisma,
  });
  input.signal?.throwIfAborted();
  if (!requester) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }

  await assertHostedGroupPhoneCallRequesterCurrentMembership({
    memberId: requester.core.id,
    prisma,
    routeAuthority: input.routeAuthority,
  });
  input.signal?.throwIfAborted();
  if (
    !await hasHostedMemberActivationProof({
      memberId: requester.core.id,
      prisma,
    })
  ) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }
}

async function assertLegacyHostedGroupPhoneCallRequesterHasOwnMurph(input: {
  inboundMailboxItemIds: readonly string[];
  prisma?: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}): Promise<void> {
  const mailboxItemIds = normalizeHostedGroupPhoneCallMailboxItemIds(
    input.inboundMailboxItemIds ?? [],
  );
  if (mailboxItemIds.length === 0) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }

  const prisma = input.prisma ?? getPrisma();
  let requesterMemberId: string | null = null;
  for (const mailboxItemId of mailboxItemIds) {
    input.signal?.throwIfAborted();
    const wake = await readHostedMailboxWakeByItemId({ mailboxItemId, prisma });
    const memberId = wake
      ? await resolveLegacyHostedGroupPhoneCallRequesterMemberId({
          prisma,
          routeAuthority: input.routeAuthority,
          wake,
        })
      : null;
    if (
      !memberId
      || (requesterMemberId !== null && requesterMemberId !== memberId)
    ) {
      throwHostedGroupPhoneCallRequesterActivationRequired();
    }
    requesterMemberId = memberId;
  }

  input.signal?.throwIfAborted();
  if (!requesterMemberId) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }
  await assertHostedGroupPhoneCallRequesterCurrentMembership({
    memberId: requesterMemberId,
    prisma,
    routeAuthority: input.routeAuthority,
  });
  input.signal?.throwIfAborted();
  if (!await hasHostedMemberActivationProof({
    memberId: requesterMemberId,
    prisma,
  })) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }
}

async function readHostedGroupPhoneCallSelectedParticipant(input: {
  assistantInputId: string;
  prisma: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
}): Promise<HostedPhoneCallGroupRequester | null> {
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.assistantInputId,
    memberId: input.routeAuthority.containerMemberId,
    prisma: input.prisma,
  });
  if (
    !wake
    || wake.userId !== input.routeAuthority.containerMemberId
    || !matchesHostedGroupPhoneCallRouteAuthority(
      readHostedGroupPhoneCallWakeRouteAuthority(wake),
      input.routeAuthority,
    )
  ) {
    return null;
  }
  return readHostedGroupPhoneCallWakeParticipant({
    assistantInputId: input.assistantInputId,
    routeAuthority: input.routeAuthority,
    wake,
  });
}

function readHostedGroupPhoneCallWakeParticipant(input: {
  assistantInputId: string;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  wake: HostedExecutionConversationMessageWake;
}): HostedPhoneCallGroupRequester | null {
  if (
    input.routeAuthority.channel === "linq"
    && isHostedLinqConversationMessageWake(input.wake)
  ) {
    const message = input.wake.message.linqMessage;
    const senderHandle = normalizeHostedGroupPhoneCallSenderHandle(message.from);
    return message.chatId === input.routeAuthority.threadId
      && message.threadIsDirect === false
      && message.isFromMe === false
      && senderHandle
      ? {
          assistantInputId: input.assistantInputId,
          senderHandle,
          source: "linq",
        }
      : null;
  }

  if (
    input.routeAuthority.channel === "telegram"
    && isHostedTelegramConversationMessageWake(input.wake)
  ) {
    const message = input.wake.message.telegramMessage;
    const senderHandle = normalizeHostedGroupPhoneCallSenderHandle(message.from);
    return message.threadId === input.routeAuthority.threadId
      && message.threadIsDirect === false
      && senderHandle
      ? {
          assistantInputId: input.assistantInputId,
          senderHandle,
          source: "telegram",
        }
      : null;
  }
  return null;
}

async function assertHostedGroupPhoneCallRequesterCurrentMembership(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
}): Promise<void> {
  const memberships = await input.prisma.hostedGroupMember.findMany({
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
      memberId: input.memberId,
    },
  });
  const membership = memberships[0];
  if (
    memberships.length !== 1
    || !membership
    || membership.memberId !== input.memberId
    || membership.member.suspendedAt !== null
  ) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }
}

async function resolveLegacyHostedGroupPhoneCallRequesterMemberId(input: {
  prisma: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  wake: HostedExecutionWake;
}): Promise<string | null> {
  if (
    input.wake.userId !== input.routeAuthority.containerMemberId
    || !matchesHostedGroupPhoneCallRouteAuthority(
      readHostedGroupPhoneCallWakeRouteAuthority(input.wake),
      input.routeAuthority,
    )
  ) {
    return null;
  }

  if (
    input.routeAuthority.channel === "linq"
    && isHostedLinqConversationMessageWake(input.wake)
  ) {
    const message = input.wake.message.linqMessage;
    const senderHandle = normalizeHostedGroupPhoneCallSenderHandle(message.from);
    if (
      message.chatId !== input.routeAuthority.threadId
      || message.threadIsDirect !== false
      || message.isFromMe !== false
      || !senderHandle
    ) {
      return null;
    }
    const lookup = await lookupHostedGroupParticipantMemberByHandle({
      handle: senderHandle,
      prisma: input.prisma,
    });
    return lookup?.core.id ?? null;
  }

  if (
    input.routeAuthority.channel === "telegram"
    && isHostedTelegramConversationMessageWake(input.wake)
  ) {
    const message = input.wake.message.telegramMessage;
    const telegramUserId =
      normalizeHostedGroupPhoneCallSenderHandle(message.from);
    if (
      message.threadId !== input.routeAuthority.threadId
      || message.threadIsDirect !== false
      || !telegramUserId
    ) {
      return null;
    }
    const resolution = await resolveHostedMemberRoutingByTelegramUserId({
      prisma: input.prisma,
      telegramUserId,
    });
    return resolution.status === "found" ? resolution.lookup.core.id : null;
  }
  return null;
}

function readHostedGroupPhoneCallWakeRouteAuthority(
  wake: HostedExecutionWake,
): HostedExecutionExternalThreadRouteAuthority | null {
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.routeAuthority ?? null;
  }
  if (isHostedTelegramConversationMessageWake(wake)) {
    return wake.message.routeAuthority ?? null;
  }
  return null;
}

function matchesHostedGroupPhoneCallRouteAuthority(
  actual: HostedExecutionExternalThreadRouteAuthority | null,
  expected: HostedExecutionExternalThreadRouteAuthority,
): boolean {
  return actual !== null
    && actual.channel === expected.channel
    && actual.containerMemberId === expected.containerMemberId
    && actual.threadId === expected.threadId
    && (actual.accountLookupKey ?? null) === (expected.accountLookupKey ?? null);
}

function normalizeHostedGroupPhoneCallMailboxItemIds(
  values: readonly string[],
): string[] {
  if (
    values.length === 0
    || values.length > HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX
  ) {
    return [];
  }
  const normalized = new Set<string>();
  for (const value of values) {
    const mailboxItemId = typeof value === "string" ? value.trim() : "";
    if (!mailboxItemId || mailboxItemId.length > 200) {
      return [];
    }
    normalized.add(mailboxItemId);
  }
  return [...normalized];
}

function normalizeHostedGroupPhoneCallSenderHandle(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

function normalizeHostedGroupPhoneCallRequester(
  value: HostedPhoneCallGroupRequester | null,
): HostedPhoneCallGroupRequester | null {
  if (
    !value
    || !/^ain_[0-9a-f]{32}$/u.test(value.assistantInputId)
    || (value.source !== "linq" && value.source !== "telegram")
  ) {
    return null;
  }
  const senderHandle = value.senderHandle.trim();
  if (!senderHandle || senderHandle.length > 512) {
    return null;
  }
  return {
    assistantInputId: value.assistantInputId,
    senderHandle,
    source: value.source,
  };
}

function throwHostedGroupPhoneCallRequesterActivationRequired(): never {
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    httpStatus: 403,
    message:
      "Group phone calls require the requesting participant to have an activated Murph.",
    retryable: false,
  });
}
