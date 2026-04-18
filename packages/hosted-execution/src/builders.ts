import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionLinqMessageReceivedEvent,
  HostedExecutionMemberActivatedEvent,
  HostedMessageWakeDispatch,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedSystemWakeDispatch,
  HostedExecutionVaultShareAcceptedEvent,
  HostedWakeEmailMessageReceivedPayload,
  HostedWakeLinqMessageReceivedPayload,
  HostedWakeTelegramMessageReceivedPayload,
} from "./contracts.ts";

export function buildHostedExecutionMemberActivatedDispatch(input: {
  eventId: string;
  firstContact?: HostedExecutionMemberActivatedEvent["firstContact"];
  memberId: string;
  memberChannels: HostedExecutionMemberChannels;
  occurredAt: string;
}): HostedSystemWakeDispatch {
  return {
    event: {
      ...(input.firstContact === undefined ? {} : { firstContact: input.firstContact }),
      kind: "member.activated",
      memberChannels: { ...input.memberChannels },
      userId: input.memberId,
    } satisfies HostedExecutionMemberActivatedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedExecutionMemberChannelsUpdatedDispatch(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedSystemWakeDispatch {
  return {
    event: {
      kind: "member.channels.updated",
      memberChannels: { ...input.memberChannels },
      userId: input.memberId,
    } satisfies HostedExecutionMemberChannelsUpdatedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedExecutionLinqMessageReceivedDispatch(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
  occurredAt: string;
  phoneLookupKey: string;
  userId: string;
}): HostedMessageWakeDispatch & { event: HostedExecutionLinqMessageReceivedEvent } {
  return {
    event: {
      kind: "linq.message.received",
      linqEvent: { ...input.linqEvent },
      ...(input.linqMessageId === undefined ? {} : { linqMessageId: input.linqMessageId }),
      phoneLookupKey: input.phoneLookupKey,
      userId: input.userId,
    } satisfies HostedExecutionLinqMessageReceivedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedWakeLinqMessageReceivedPayload(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
  phoneLookupKey: string;
}): HostedWakeLinqMessageReceivedPayload {
  return {
    eventId: input.eventId,
    linqEvent: { ...input.linqEvent },
    ...(input.linqMessageId === undefined ? {} : { linqMessageId: input.linqMessageId }),
    phoneLookupKey: input.phoneLookupKey,
  };
}

export function buildHostedExecutionTelegramMessageReceivedDispatch(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedExecutionTelegramMessageReceivedEvent["telegramMessage"];
  userId: string;
}): HostedMessageWakeDispatch & { event: HostedExecutionTelegramMessageReceivedEvent } {
  return {
    event: {
      kind: "telegram.message.received",
      telegramMessage: {
        ...input.telegramMessage,
        ...(input.telegramMessage.attachments
          ? {
              attachments: input.telegramMessage.attachments.map((attachment) => ({ ...attachment })),
            }
          : {}),
      },
      userId: input.userId,
    } satisfies HostedExecutionTelegramMessageReceivedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedWakeTelegramMessageReceivedPayload(input: {
  eventId: string;
  telegramMessage: HostedExecutionTelegramMessageReceivedEvent["telegramMessage"];
}): HostedWakeTelegramMessageReceivedPayload {
  return {
    eventId: input.eventId,
    telegramMessage: {
      ...input.telegramMessage,
      ...(input.telegramMessage.attachments
        ? {
            attachments: input.telegramMessage.attachments.map((attachment) => ({ ...attachment })),
          }
        : {}),
    },
  };
}

export function buildHostedExecutionEmailMessageReceivedDispatch(input: {
  eventId: string;
  identityId: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  userId: string;
}): HostedMessageWakeDispatch & { event: HostedExecutionEmailMessageReceivedEvent } {
  return {
    event: {
      identityId: input.identityId,
      kind: "email.message.received",
      rawMessageKey: input.rawMessageKey,
      ...(input.selfAddress === undefined ? {} : { selfAddress: input.selfAddress }),
      userId: input.userId,
    } satisfies HostedExecutionEmailMessageReceivedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedWakeEmailMessageReceivedPayload(input: {
  eventId: string;
  identityId: string | null;
  rawMessageKey: string;
  selfAddress?: string | null;
}): HostedWakeEmailMessageReceivedPayload {
  return {
    eventId: input.eventId,
    identityId: input.identityId,
    rawMessageKey: input.rawMessageKey,
    ...(input.selfAddress === undefined ? {} : { selfAddress: input.selfAddress }),
  };
}

export function buildHostedExecutionAssistantCronTickDispatch(input: {
  eventId: string;
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  userId: string;
}): HostedSystemWakeDispatch {
  return {
    event: {
      kind: "assistant.cron.tick",
      reason: input.reason,
      userId: input.userId,
    } satisfies HostedExecutionAssistantCronTickEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedExecutionDeviceSyncWakeDispatch(input: {
  connectionId?: string | null;
  eventId: string;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider?: string | null;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  userId: string;
}): HostedSystemWakeDispatch {
  return {
    event: {
      ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      ...(input.hint === undefined ? {} : { hint: input.hint }),
      kind: "device-sync.wake",
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      reason: input.reason,
      userId: input.userId,
    } satisfies HostedExecutionDeviceSyncWakeEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedExecutionVaultShareAcceptedDispatch(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  share: HostedExecutionVaultShareAcceptedEvent["share"];
}): HostedSystemWakeDispatch {
  return {
    event: {
      kind: "vault.share.accepted",
      share: input.share,
      userId: input.memberId,
    } satisfies HostedExecutionVaultShareAcceptedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}
