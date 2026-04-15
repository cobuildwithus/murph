import type {
  HostedExecutionFirstContactTarget,
  HostedExecutionMemberActivatedEvent,
} from "@murphai/hosted-execution";

import { normalizePhoneNumber } from "./phone";

interface HostedMemberMessagingIdentitySlice {
  phoneLookupKey?: string | null;
}

interface HostedMemberMessagingRoutingSlice {
  telegramUserId?: string | null;
}

export interface HostedMemberMessagingState {
  hasDirectMessagingChannel: boolean;
  hasPhone: boolean;
  hasTelegram: boolean;
  phoneLookupKey: string | null;
  telegramThreadId: string | null;
}

export type HostedMemberFirstContactTarget = HostedExecutionFirstContactTarget | null;

export function resolveHostedMemberMessagingState(input: {
  identity: HostedMemberMessagingIdentitySlice | null;
  routing: HostedMemberMessagingRoutingSlice | null;
}): HostedMemberMessagingState {
  const phoneLookupKey = normalizeMessagingIdentity(input.identity?.phoneLookupKey);
  const telegramThreadId = normalizeMessagingIdentity(input.routing?.telegramUserId);
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

export function resolveHostedMemberFirstContactTarget(input: {
  linqChatId: string | null;
  linqRecipientPhone?: string | null;
  memberPhoneNumber?: string | null;
  messaging: HostedMemberMessagingState;
}): HostedMemberFirstContactTarget {
  if (input.linqChatId && input.messaging.phoneLookupKey) {
    return {
      channel: "linq",
      identityId: input.messaging.phoneLookupKey,
      threadId: input.linqChatId,
      threadIsDirect: true,
    };
  }

  const memberPhoneNumber = normalizePhoneNumber(input.memberPhoneNumber);
  const linqRecipientPhone = normalizePhoneNumber(input.linqRecipientPhone);

  if (memberPhoneNumber && linqRecipientPhone && input.messaging.phoneLookupKey) {
    return {
      channel: "linq",
      fromPhoneNumber: linqRecipientPhone,
      identityId: input.messaging.phoneLookupKey,
      kind: "linq-materialize-home-thread",
      toPhoneNumber: memberPhoneNumber,
    };
  }

  if (input.messaging.telegramThreadId) {
    return {
      channel: "telegram",
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
