import "server-only";

import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionExternalThreadRouteAuthority,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX,
} from "@murphai/hosted-execution/phone-calls";

import {
  lookupHostedGroupParticipantMemberByHandle,
} from "../hosted-groups/participant-member";
import { readHostedMailboxWakeByItemId } from "../hosted-mailbox/store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hasHostedMemberActivationProof } from "../hosted-onboarding/member-activation";
import { resolveHostedMemberRoutingByTelegramUserId } from "../hosted-onboarding/hosted-member-routing-store";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export async function assertHostedGroupPhoneCallRequesterHasOwnMurph(input: {
  inboundMailboxItemIds: readonly string[];
  prisma?: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}): Promise<void> {
  const mailboxItemIds = normalizeHostedGroupPhoneCallMailboxItemIds(
    input.inboundMailboxItemIds,
  );
  if (mailboxItemIds.length === 0) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }

  const prisma = input.prisma ?? getPrisma();
  let requesterMemberId: string | null = null;

  for (const mailboxItemId of mailboxItemIds) {
    input.signal?.throwIfAborted();
    const wake = await readHostedMailboxWakeByItemId({
      mailboxItemId,
      prisma,
    });
    const memberId = wake
      ? await resolveHostedGroupPhoneCallRequesterMemberId({
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
  if (
    !requesterMemberId
    || !await hasHostedMemberActivationProof({
      memberId: requesterMemberId,
      prisma,
    })
  ) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }
}

async function resolveHostedGroupPhoneCallRequesterMemberId(input: {
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

  // The authenticated inbound wake is the current participation proof. The
  // roster table is a best-effort Linq projection and is not Telegram-complete.
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
    const telegramUserId = normalizeHostedGroupPhoneCallSenderHandle(message.from);
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
    return resolution.status === "found"
      ? resolution.lookup.core.id
      : null;
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

function throwHostedGroupPhoneCallRequesterActivationRequired(): never {
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    httpStatus: 403,
    message:
      "Group phone calls require the requesting participant to have an activated Murph.",
    retryable: false,
  });
}
