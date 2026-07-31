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
  emailLinked?: boolean;
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
  hasEmail: boolean;
  hasLinq: boolean;
  hasPhone: boolean;
  hasTelegram: boolean;
  linqContactLookupKey: string | null;
  linqThreadId: string | null;
  phoneLookupKey: string | null;
  telegramAwaitingInbound: boolean;
  telegramTarget: string | null;
}

export type HostedMemberAssistantNotificationRoute =
  | HostedExecutionAssistantNotificationRoute
  | null;

type HostedMemberAssistantNotificationRouteInput = {
  channel?: "linq" | "telegram";
  linqChatId: string | null;
  linqContactLookupKey?: string | null;
  linqRecipientPhone?: string | null;
  memberId: string;
  memberPhoneNumber?: string | null;
  messaging: HostedMemberMessagingState;
};

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
  const telegramTarget = normalizeMessagingIdentity(input.routing?.telegramThreadId);
  const hasEmail = input.identity?.emailLinked === true;
  const hasPhone = phoneLookupKey !== null;
  const hasLinq = hasPhone || (linqThreadId !== null && linqContactLookupKey !== null);
  const hasTelegram = telegramTarget !== null;
  // Telegram bots cannot open a conversation, so the direct thread target only
  // exists once the member messages the bot. A linked Telegram account is
  // therefore set up but not yet deliverable, which is a distinct state from
  // having no Telegram at all.
  const telegramAwaitingInbound =
    !hasTelegram && normalizeMessagingIdentity(input.routing?.telegramUserId) !== null;

  return {
    // Preserve the historical chat-specific meaning used by the dashboard.
    // Verified email satisfies onboarding readiness below, but it does not
    // imply that a Linq or Telegram conversation thread already exists.
    hasDirectMessagingChannel: hasLinq || hasTelegram,
    hasEmail,
    hasLinq,
    hasPhone,
    hasTelegram,
    linqContactLookupKey,
    linqThreadId,
    phoneLookupKey,
    telegramAwaitingInbound,
    telegramTarget,
  };
}

export function isHostedMemberMessagingSetupRequired(input: {
  identity: HostedMemberMessagingIdentitySlice | null;
  routing: HostedMemberMessagingRoutingSlice | null;
}): boolean {
  const messaging = resolveHostedMemberMessagingState(input);

  // Verified email is already a real Murph route. A linked Telegram account
  // also completes setup even before its first inbound thread exists: the
  // member has told us how to reach them, while delivery remains an independent
  // concern surfaced as telegramAwaitingInbound.
  return !messaging.hasEmail
    && !messaging.hasDirectMessagingChannel
    && !messaging.telegramAwaitingInbound;
}

export function resolveHostedMemberChannels(input: {
  emailLinked: boolean;
  identity: HostedMemberMessagingIdentitySlice | null;
  routing: HostedMemberMessagingRoutingSlice | null;
}): HostedExecutionMemberChannels {
  const messaging = resolveHostedMemberMessagingState({
    identity: {
      ...(input.identity ?? {}),
      emailLinked: input.emailLinked,
    },
    routing: input.routing,
  });

  return {
    email: messaging.hasEmail,
    linq: messaging.hasLinq || (messaging.hasEmail && Boolean(input.routing?.linqChatId)),
    telegram: messaging.hasTelegram,
  };
}

export function resolveHostedMemberAssistantNotificationRoute(
  input: HostedMemberAssistantNotificationRouteInput,
): HostedMemberAssistantNotificationRoute {
  const memberPhoneNumber = normalizePhoneNumber(input.memberPhoneNumber);
  const linqRecipientPhone = normalizePhoneNumber(input.linqRecipientPhone);
  const linqContactLookupKey =
    normalizeMessagingIdentity(input.linqContactLookupKey)
    ?? input.messaging.linqContactLookupKey
    ?? input.messaging.phoneLookupKey;

  if (
    input.channel !== "telegram"
    && input.linqChatId
    && linqContactLookupKey
  ) {
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

  if (
    input.channel !== "telegram"
    && linqRecipientPhone
    && memberPhoneNumber
    && input.messaging.phoneLookupKey
  ) {
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: input.messaging.phoneLookupKey,
      userId: input.memberId,
    });
    return {
      actorId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        memberPhoneNumber,
      ),
      channel: "linq",
      delivery: {
        kind: "participant",
        source: {
          fromPhoneNumber: linqRecipientPhone,
          kind: "linq",
        },
        target: memberPhoneNumber,
      },
      identityId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        input.messaging.phoneLookupKey,
      ),
      threadId: null,
      threadIsDirect: true,
    };
  }

  if (
    input.channel !== "linq"
    && input.messaging.telegramTarget
  ) {
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: input.messaging.telegramTarget,
      userId: input.memberId,
    });
    return {
      actorId: null,
      channel: "telegram",
      delivery: {
        kind: "thread",
        target: input.messaging.telegramTarget,
      },
      identityId: null,
      threadId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        input.messaging.telegramTarget,
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
