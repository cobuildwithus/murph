import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionAssistantCronTickWake,
  HostedExecutionConversationMessagePayload,
  HostedExecutionConversationMessageWake,
  HostedExecutionDeviceSyncWake,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchRequest,
  HostedExecutionEmailConversationMessagePayload,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionLinqMessageReceivedEvent,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionMemberActivatedWake,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionMemberChannelsUpdatedWake,
  HostedExecutionSystemWake,
  HostedExecutionTelegramConversationMessagePayload,
  HostedExecutionTelegramMessage,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionVaultShareAcceptedEvent,
  HostedExecutionVaultShareAcceptedWake,
  HostedExecutionWake,
  HostedMessageWakeDispatch,
  HostedSystemWakeDispatch,
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

export function buildHostedExecutionWakeFromDispatch(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionWake {
  switch (dispatch.event.kind) {
    case "linq.message.received":
      return buildHostedExecutionLinqConversationMessageWake({
        eventId: dispatch.eventId,
        linqEvent: dispatch.event.linqEvent,
        ...(dispatch.event.linqMessageId === undefined
          ? {}
          : { linqMessageId: dispatch.event.linqMessageId }),
        occurredAt: dispatch.occurredAt,
        phoneLookupKey: dispatch.event.phoneLookupKey,
        userId: dispatch.event.userId,
      });
    case "telegram.message.received":
      return buildHostedExecutionTelegramConversationMessageWake({
        eventId: dispatch.eventId,
        occurredAt: dispatch.occurredAt,
        telegramMessage: dispatch.event.telegramMessage,
        userId: dispatch.event.userId,
      });
    case "email.message.received":
      return buildHostedExecutionEmailConversationMessageWake({
        eventId: dispatch.eventId,
        identityId: dispatch.event.identityId,
        occurredAt: dispatch.occurredAt,
        rawMessageKey: dispatch.event.rawMessageKey,
        ...(dispatch.event.selfAddress === undefined
          ? {}
          : { selfAddress: dispatch.event.selfAddress }),
        userId: dispatch.event.userId,
      });
    case "member.activated":
      return buildHostedExecutionMemberActivatedWake({
        eventId: dispatch.eventId,
        ...(dispatch.event.firstContact === undefined
          ? {}
          : { firstContact: dispatch.event.firstContact }),
        memberChannels: dispatch.event.memberChannels,
        memberId: dispatch.event.userId,
        occurredAt: dispatch.occurredAt,
      });
    case "member.channels.updated":
      return buildHostedExecutionMemberChannelsUpdatedWake({
        eventId: dispatch.eventId,
        memberChannels: dispatch.event.memberChannels,
        memberId: dispatch.event.userId,
        occurredAt: dispatch.occurredAt,
      });
    case "assistant.cron.tick":
      return buildHostedExecutionAssistantCronTickWake({
        eventId: dispatch.eventId,
        occurredAt: dispatch.occurredAt,
        reason: dispatch.event.reason,
        userId: dispatch.event.userId,
      });
    case "device-sync.wake":
      return buildHostedExecutionDeviceSyncWake({
        ...(dispatch.event.connectionId === undefined
          ? {}
          : { connectionId: dispatch.event.connectionId }),
        eventId: dispatch.eventId,
        ...(dispatch.event.hint === undefined ? {} : { hint: dispatch.event.hint }),
        occurredAt: dispatch.occurredAt,
        ...(dispatch.event.provider === undefined
          ? {}
          : { provider: dispatch.event.provider }),
        reason: dispatch.event.reason,
        userId: dispatch.event.userId,
      });
    case "vault.share.accepted":
      return buildHostedExecutionVaultShareAcceptedWake({
        eventId: dispatch.eventId,
        memberId: dispatch.event.userId,
        occurredAt: dispatch.occurredAt,
        share: dispatch.event.share,
      });
  }

  throw new TypeError(
    `Unexpected hosted execution event kind: ${String(
      (dispatch as { event?: { kind?: unknown } }).event?.kind ?? "unknown",
    )}`,
  );
}

export function buildHostedExecutionDispatchFromWake(
  wake: HostedExecutionWake,
): HostedExecutionDispatchRequest {
  switch (wake.kind) {
    case "conversation.message":
      switch (wake.message.channel) {
        case "linq":
          return {
            event: {
              kind: "linq.message.received",
              linqEvent: cloneLinqEvent(wake.message.linqEvent),
              ...(wake.message.linqMessageId === undefined
                ? {}
                : { linqMessageId: wake.message.linqMessageId }),
              phoneLookupKey: wake.message.phoneLookupKey,
              userId: wake.userId,
            } satisfies HostedExecutionLinqMessageReceivedEvent,
            eventId: wake.eventId,
            occurredAt: wake.occurredAt,
          };
        case "telegram":
          return {
            event: {
              kind: "telegram.message.received",
              telegramMessage: cloneTelegramMessage(wake.message.telegramMessage),
              userId: wake.userId,
            } satisfies HostedExecutionTelegramMessageReceivedEvent,
            eventId: wake.eventId,
            occurredAt: wake.occurredAt,
          };
        case "email":
          return {
            event: {
              identityId: wake.message.identityId,
              kind: "email.message.received",
              rawMessageKey: wake.message.rawMessageKey,
              ...(wake.message.selfAddress === undefined
                ? {}
                : { selfAddress: wake.message.selfAddress }),
              userId: wake.userId,
            } satisfies HostedExecutionEmailMessageReceivedEvent,
            eventId: wake.eventId,
            occurredAt: wake.occurredAt,
          };
      }
      break;
    case "member.activated":
      return {
        event: {
          ...(wake.firstContact === undefined ? {} : { firstContact: wake.firstContact }),
          kind: "member.activated",
          memberChannels: { ...wake.memberChannels },
          userId: wake.userId,
        } satisfies HostedExecutionMemberActivatedEvent,
        eventId: wake.eventId,
        occurredAt: wake.occurredAt,
      };
    case "member.channels.updated":
      return {
        event: {
          kind: "member.channels.updated",
          memberChannels: { ...wake.memberChannels },
          userId: wake.userId,
        } satisfies HostedExecutionMemberChannelsUpdatedEvent,
        eventId: wake.eventId,
        occurredAt: wake.occurredAt,
      };
    case "assistant.cron.tick":
      return {
        event: {
          kind: "assistant.cron.tick",
          reason: wake.reason,
          userId: wake.userId,
        } satisfies HostedExecutionAssistantCronTickEvent,
        eventId: wake.eventId,
        occurredAt: wake.occurredAt,
      };
    case "device-sync.wake":
      return {
        event: {
          ...(wake.connectionId === undefined ? {} : { connectionId: wake.connectionId }),
          ...(wake.hint === undefined ? {} : { hint: wake.hint }),
          kind: "device-sync.wake",
          ...(wake.provider === undefined ? {} : { provider: wake.provider }),
          reason: wake.reason,
          userId: wake.userId,
        } satisfies HostedExecutionDeviceSyncWakeEvent,
        eventId: wake.eventId,
        occurredAt: wake.occurredAt,
      };
    case "vault.share.accepted":
      return {
        event: {
          kind: "vault.share.accepted",
          share: wake.share,
          userId: wake.userId,
        } satisfies HostedExecutionVaultShareAcceptedEvent,
        eventId: wake.eventId,
        occurredAt: wake.occurredAt,
      };
  }

  throw new TypeError("Unsupported hosted execution wake.");
}

export function buildHostedExecutionMemberActivatedDispatch(input: {
  eventId: string;
  firstContact?: HostedExecutionMemberActivatedEvent["firstContact"];
  memberId: string;
  memberChannels: HostedExecutionMemberChannels;
  occurredAt: string;
}): HostedSystemWakeDispatch {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionMemberActivatedWake(input),
  ) as HostedSystemWakeDispatch;
}

export function buildHostedExecutionMemberChannelsUpdatedDispatch(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedSystemWakeDispatch {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionMemberChannelsUpdatedWake(input),
  ) as HostedSystemWakeDispatch;
}

export function buildHostedExecutionLinqMessageReceivedDispatch(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
  occurredAt: string;
  phoneLookupKey: string;
  userId: string;
}): HostedMessageWakeDispatch & { event: HostedExecutionLinqMessageReceivedEvent } {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionLinqConversationMessageWake(input),
  ) as HostedMessageWakeDispatch & { event: HostedExecutionLinqMessageReceivedEvent };
}

export function buildHostedExecutionTelegramMessageReceivedDispatch(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedExecutionTelegramMessageReceivedEvent["telegramMessage"];
  userId: string;
}): HostedMessageWakeDispatch & { event: HostedExecutionTelegramMessageReceivedEvent } {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionTelegramConversationMessageWake(input),
  ) as HostedMessageWakeDispatch & { event: HostedExecutionTelegramMessageReceivedEvent };
}

export function buildHostedExecutionEmailMessageReceivedDispatch(input: {
  eventId: string;
  identityId: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  userId: string;
}): HostedMessageWakeDispatch & { event: HostedExecutionEmailMessageReceivedEvent } {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionEmailConversationMessageWake(input),
  ) as HostedMessageWakeDispatch & { event: HostedExecutionEmailMessageReceivedEvent };
}

export function buildHostedExecutionAssistantCronTickDispatch(input: {
  eventId: string;
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  userId: string;
}): HostedSystemWakeDispatch {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionAssistantCronTickWake(input),
  ) as HostedSystemWakeDispatch;
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
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionDeviceSyncWake(input),
  ) as HostedSystemWakeDispatch;
}

export function buildHostedExecutionVaultShareAcceptedDispatch(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  share: HostedExecutionVaultShareAcceptedEvent["share"];
}): HostedSystemWakeDispatch {
  return buildHostedExecutionDispatchFromWake(
    buildHostedExecutionVaultShareAcceptedWake(input),
  ) as HostedSystemWakeDispatch;
}
