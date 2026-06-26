import type {
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
  hashNullableHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

import { normalizePhoneNumber } from "./phone";

interface HostedMemberMessagingIdentitySlice {
  phoneLookupKey?: string | null;
}

interface HostedMemberMessagingRoutingSlice {
  linqChatId?: string | null;
  pendingLinqChatId?: string | null;
  pendingLinqParticipantContact?: {
    lookupKey?: string | null;
  } | null;
  telegramThreadId?: string | null;
  telegramUserId?: string | null;
}

export interface HostedMemberMessagingState {
  hasDirectMessagingChannel: boolean;
  hasLinq: boolean;
  hasPhone: boolean;
  hasTelegram: boolean;
  linqContactLookupKey: string | null;
  linqThreadId: string | null;
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
  const linqThreadId =
    normalizeMessagingIdentity(input.routing?.linqChatId)
    ?? normalizeMessagingIdentity(input.routing?.pendingLinqChatId);
  const linqContactLookupKey =
    phoneLookupKey
    ?? normalizeMessagingIdentity(input.routing?.pendingLinqParticipantContact?.lookupKey);
  const telegramThreadId =
    normalizeMessagingIdentity(input.routing?.telegramThreadId)
    ?? normalizeMessagingIdentity(input.routing?.telegramUserId);
  const hasPhone = phoneLookupKey !== null;
  const hasLinq = hasPhone || (linqThreadId !== null && linqContactLookupKey !== null);
  const hasTelegram = telegramThreadId !== null;

  return {
    hasDirectMessagingChannel: hasLinq || hasTelegram,
    hasLinq,
    hasPhone,
    hasTelegram,
    linqContactLookupKey,
    linqThreadId,
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
    linq: messaging.hasLinq || (input.emailLinked && Boolean(input.routing?.linqChatId)),
    telegram: messaging.hasTelegram,
  };
}

export function resolveHostedMemberAssistantNotificationRoute(input: {
  linqChatId: string | null;
  linqContactLookupKey?: string | null;
  linqRecipientPhone?: string | null;
  memberId: string;
  memberPhoneNumber?: string | null;
  messaging: HostedMemberMessagingState;
}): HostedMemberAssistantNotificationRoute {
  const memberPhoneNumber = normalizePhoneNumber(input.memberPhoneNumber);
  const linqContactLookupKey =
    normalizeMessagingIdentity(input.linqContactLookupKey)
    ?? input.messaging.linqContactLookupKey
    ?? input.messaging.phoneLookupKey;

  if (input.linqChatId && linqContactLookupKey) {
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: linqContactLookupKey,
      userId: input.memberId,
    });
    return {
      actorId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        memberPhoneNumber,
      ),
      channel: "linq",
      delivery: {
        kind: "thread",
        target: input.linqChatId,
      },
      identityId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        linqContactLookupKey,
      ),
      threadId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        input.linqChatId,
      ),
      threadIsDirect: true,
    };
  }

  if (input.messaging.telegramThreadId) {
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: input.messaging.telegramThreadId,
      userId: input.memberId,
    });
    return {
      actorId: null,
      channel: "telegram",
      delivery: {
        kind: "thread",
        target: input.messaging.telegramThreadId,
      },
      identityId: null,
      threadId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        input.messaging.telegramThreadId,
      ),
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
