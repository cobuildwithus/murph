import "server-only";

import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionExternalThreadRouteAuthority,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";

import {
  resolveHostedMemberRoutingByTelegramUserId,
} from "../hosted-onboarding/hosted-member-routing-store";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  lookupHostedGroupParticipantMemberByHandle,
} from "./participant-member";

/**
 * Resolves the human author of one authenticated group-message wake through the
 * channel's canonical identity index. The optional senderMemberId carried by
 * the transport is deliberately ignored: it is attribution context, not
 * runtime authority.
 */
export async function resolveHostedGroupMessageSenderMemberId(input: {
  prisma: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  wake: HostedExecutionWake;
}): Promise<string | null> {
  if (
    input.wake.userId !== input.routeAuthority.containerMemberId
    || !matchesHostedGroupMessageRouteAuthority(
      readHostedGroupMessageWakeRouteAuthority(input.wake),
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
    const senderHandle = normalizeHostedGroupMessageSenderHandle(message.from);
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
    const telegramUserId = normalizeHostedGroupMessageSenderHandle(message.from);
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

function readHostedGroupMessageWakeRouteAuthority(
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

function matchesHostedGroupMessageRouteAuthority(
  actual: HostedExecutionExternalThreadRouteAuthority | null,
  expected: HostedExecutionExternalThreadRouteAuthority,
): boolean {
  return actual !== null
    && actual.channel === expected.channel
    && actual.containerMemberId === expected.containerMemberId
    && actual.threadId === expected.threadId
    && (actual.accountLookupKey ?? null) === (expected.accountLookupKey ?? null);
}

function normalizeHostedGroupMessageSenderHandle(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}
