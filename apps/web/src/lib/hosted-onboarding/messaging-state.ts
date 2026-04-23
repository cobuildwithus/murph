import type {
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";

import { normalizePhoneNumber } from "./phone";

interface HostedMemberMessagingIdentitySlice {
  phoneLookupKey?: string | null;
}

interface HostedMemberMessagingRoutingSlice {
  telegramThreadId?: string | null;
  telegramUserId?: string | null;
}

export interface HostedMemberMessagingState {
  hasDirectMessagingChannel: boolean;
  hasPhone: boolean;
  hasTelegram: boolean;
  phoneLookupKey: string | null;
  telegramThreadId: string | null;
}

export type HostedMemberAssistantNotificationRoute =
  | HostedExecutionAssistantNotificationRoute
  | null;

export function resolveHostedMemberMessagingState(input: {
  identity: HostedMemberMessagingIdentitySlice | null;
  routing: HostedMemberMessagingRoutingSlice | null;
}): HostedMemberMessagingState {
  const phoneLookupKey = normalizeMessagingIdentity(input.identity?.phoneLookupKey);
  const telegramThreadId =
    normalizeMessagingIdentity(input.routing?.telegramThreadId)
    ?? normalizeMessagingIdentity(input.routing?.telegramUserId);
  const hasPhone = phoneLookupKey !== null;
  const hasTelegram = telegramThreadId !== null;

  return {
    hasDirectMessagingChannel: hasPhone || hasTelegram,
    hasPhone,
    hasTelegram,
    phoneLookupKey,
    telegramThreadId,
  };
}

export function isHostedMemberMessagingSetupRequired(input: {
  identity: HostedMemberMessagingIdentitySlice | null;
  routing: HostedMemberMessagingRoutingSlice | null;
}): boolean {
  return !resolveHostedMemberMessagingState(input).hasDirectMessagingChannel;
}

export function resolveHostedMemberChannels(input: {
  emailLinked: boolean;
  identity: HostedMemberMessagingIdentitySlice | null;
  routing: HostedMemberMessagingRoutingSlice | null;
}): HostedExecutionMemberChannels {
  const messaging = resolveHostedMemberMessagingState(input);

  return {
    email: input.emailLinked,
    linq: messaging.hasPhone,
    telegram: messaging.hasTelegram,
  };
}

export function resolveHostedMemberAssistantNotificationRoute(input: {
  linqChatId: string | null;
  linqRecipientPhone?: string | null;
  memberPhoneNumber?: string | null;
  messaging: HostedMemberMessagingState;
}): HostedMemberAssistantNotificationRoute {
  const memberPhoneNumber = normalizePhoneNumber(input.memberPhoneNumber);

  if (input.linqChatId && input.messaging.phoneLookupKey) {
    return {
      actorId: memberPhoneNumber,
      channel: "linq",
      delivery: {
        kind: "thread",
        target: input.linqChatId,
      },
      identityId: input.messaging.phoneLookupKey,
      threadId: input.linqChatId,
      threadIsDirect: true,
    };
  }

  const linqRecipientPhone = normalizePhoneNumber(input.linqRecipientPhone);

  if (memberPhoneNumber && linqRecipientPhone && input.messaging.phoneLookupKey) {
    return {
      actorId: memberPhoneNumber,
      channel: "linq",
      delivery: {
        kind: "participant",
        source: {
          fromPhoneNumber: linqRecipientPhone,
          kind: "linq",
        },
        target: memberPhoneNumber,
      },
      identityId: input.messaging.phoneLookupKey,
      threadId: null,
      threadIsDirect: true,
    };
  }

  if (input.messaging.telegramThreadId) {
    return {
      actorId: null,
      channel: "telegram",
      delivery: {
        kind: "thread",
        target: input.messaging.telegramThreadId,
      },
      identityId: null,
      threadId: input.messaging.telegramThreadId,
      threadIsDirect: true,
    };
  }

  return null;
}

function normalizeMessagingIdentity(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
