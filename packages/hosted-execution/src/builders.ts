import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionAssistantCronTickWake,
  HostedExecutionConversationMessagePayload,
  HostedExecutionConversationMessageWake,
  HostedExecutionDeviceSyncWake,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionEmailConversationMessagePayload,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionMemberActivatedWake,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedWake,
  HostedExecutionTelegramConversationMessagePayload,
  HostedExecutionTelegramMessage,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionVaultShareAcceptedEvent,
  HostedExecutionVaultShareAcceptedWake,
  HostedWakeEmailMessageReceivedPayload,
  HostedWakeLinqMessageReceivedPayload,
  HostedWakeTelegramMessageReceivedPayload,
} from "./contracts.ts";

function cloneLinqEvent(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function cloneTelegramMessage(value: HostedExecutionTelegramMessage): HostedExecutionTelegramMessage {
  return {
    ...value,
    ...(value.attachments
      ? {
          attachments: value.attachments.map((attachment) => ({ ...attachment })),
        }
      : {}),
  };
}

function cloneConversationMessagePayload(
  value: HostedExecutionConversationMessagePayload,
): HostedExecutionConversationMessagePayload {
  switch (value.channel) {
    case "linq":
      return {
        ...value,
        linqEvent: cloneLinqEvent(value.linqEvent),
      };
    case "telegram":
      return {
        ...value,
        telegramMessage: cloneTelegramMessage(value.telegramMessage),
      };
    case "email":
      return {
        ...value,
      };
  }
}

export function buildHostedExecutionConversationMessageWake(input: {
  eventId: string;
  message: HostedExecutionConversationMessagePayload;
  occurredAt: string;
  userId: string;
}): HostedExecutionConversationMessageWake {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: cloneConversationMessagePayload(input.message),
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionLinqConversationMessageWake(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
  occurredAt: string;
  phoneLookupKey: string;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionLinqConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "linq",
      linqEvent: cloneLinqEvent(input.linqEvent),
      ...(input.linqMessageId === undefined ? {} : { linqMessageId: input.linqMessageId }),
      phoneLookupKey: input.phoneLookupKey,
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedWakeLinqMessageReceivedPayload(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
  phoneLookupKey: string;
}): HostedWakeLinqMessageReceivedPayload {
  return {
    channel: "linq",
    eventId: input.eventId,
    linqEvent: cloneLinqEvent(input.linqEvent),
    ...(input.linqMessageId === undefined ? {} : { linqMessageId: input.linqMessageId }),
    phoneLookupKey: input.phoneLookupKey,
  };
}

export function buildHostedExecutionTelegramConversationMessageWake(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedExecutionTelegramMessageReceivedEvent["telegramMessage"];
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionTelegramConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: cloneTelegramMessage(input.telegramMessage),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedWakeTelegramMessageReceivedPayload(input: {
  eventId: string;
  telegramMessage: HostedExecutionTelegramMessageReceivedEvent["telegramMessage"];
}): HostedWakeTelegramMessageReceivedPayload {
  return {
    channel: "telegram",
    eventId: input.eventId,
    telegramMessage: cloneTelegramMessage(input.telegramMessage),
  };
}

export function buildHostedExecutionEmailConversationMessageWake(input: {
  eventId: string;
  identityId: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionEmailConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "email",
      identityId: input.identityId,
      rawMessageKey: input.rawMessageKey,
      ...(input.selfAddress === undefined ? {} : { selfAddress: input.selfAddress }),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedWakeEmailMessageReceivedPayload(input: {
  eventId: string;
  identityId: string | null;
  rawMessageKey: string;
  selfAddress?: string | null;
}): HostedWakeEmailMessageReceivedPayload {
  return {
    channel: "email",
    eventId: input.eventId,
    identityId: input.identityId,
    rawMessageKey: input.rawMessageKey,
    ...(input.selfAddress === undefined ? {} : { selfAddress: input.selfAddress }),
  };
}

export function buildHostedExecutionMemberActivatedWake(input: {
  eventId: string;
  firstContact?: HostedExecutionMemberActivatedEvent["firstContact"];
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedExecutionMemberActivatedWake {
  return {
    ...(input.firstContact === undefined ? {} : { firstContact: input.firstContact }),
    eventId: input.eventId,
    kind: "member.activated",
    memberChannels: { ...input.memberChannels },
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

export function buildHostedExecutionMemberChannelsUpdatedWake(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedExecutionMemberChannelsUpdatedWake {
  return {
    eventId: input.eventId,
    kind: "member.channels.updated",
    memberChannels: { ...input.memberChannels },
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

export function buildHostedExecutionAssistantCronTickWake(input: {
  eventId: string;
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  userId: string;
}): HostedExecutionAssistantCronTickWake {
  return {
    eventId: input.eventId,
    kind: "assistant.cron.tick",
    occurredAt: input.occurredAt,
    reason: input.reason,
    userId: input.userId,
  };
}

export function buildHostedExecutionDeviceSyncWake(input: {
  connectionId?: string | null;
  eventId: string;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider?: string | null;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  userId: string;
}): HostedExecutionDeviceSyncWake {
  return {
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    eventId: input.eventId,
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    kind: "device-sync.wake",
    occurredAt: input.occurredAt,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    reason: input.reason,
    userId: input.userId,
  };
}

export function buildHostedExecutionVaultShareAcceptedWake(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  share: HostedExecutionVaultShareAcceptedEvent["share"];
}): HostedExecutionVaultShareAcceptedWake {
  return {
    eventId: input.eventId,
    kind: "vault.share.accepted",
    occurredAt: input.occurredAt,
    share: input.share,
    userId: input.memberId,
  };
}
