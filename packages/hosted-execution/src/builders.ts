import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchRequest,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionGatewayMessageSendEvent,
  HostedExecutionLinqMessageReceivedEvent,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionVaultShareAcceptedEvent,
} from "./contracts.ts";

export function buildHostedExecutionMemberActivatedDispatch(input: {
  eventId: string;
  firstContact?: HostedExecutionMemberActivatedEvent["firstContact"];
  memberId: string;
  occurredAt: string;
}): HostedExecutionDispatchRequest {
  return {
    event: {
      ...(input.firstContact === undefined ? {} : { firstContact: input.firstContact }),
      kind: "member.activated",
      userId: input.memberId,
    } satisfies HostedExecutionMemberActivatedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedExecutionLinqMessageReceivedDispatch(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  occurredAt: string;
  phoneLookupKey: string;
  userId: string;
}): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "linq.message.received",
      linqEvent: { ...input.linqEvent },
      phoneLookupKey: input.phoneLookupKey,
      userId: input.userId,
    } satisfies HostedExecutionLinqMessageReceivedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}

export function buildHostedExecutionTelegramMessageReceivedDispatch(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedExecutionTelegramMessageReceivedEvent["telegramMessage"];
  userId: string;
}): HostedExecutionDispatchRequest {
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

export function buildHostedExecutionEmailMessageReceivedDispatch(input: {
  eventId: string;
  identityId: string;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  userId: string;
}): HostedExecutionDispatchRequest {
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

export function buildHostedExecutionAssistantCronTickDispatch(input: {
  eventId: string;
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  userId: string;
}): HostedExecutionDispatchRequest {
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
  runtimeSnapshot?: HostedExecutionDeviceSyncWakeEvent["runtimeSnapshot"];
  userId: string;
}): HostedExecutionDispatchRequest {
  return {
    event: {
      ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      ...(input.hint === undefined ? {} : { hint: input.hint }),
      kind: "device-sync.wake",
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      reason: input.reason,
      ...(input.runtimeSnapshot === undefined ? {} : { runtimeSnapshot: input.runtimeSnapshot }),
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
}): HostedExecutionDispatchRequest {
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

export function buildHostedExecutionGatewayMessageSendDispatch(input: {
  clientRequestId?: string | null;
  eventId: string;
  occurredAt: string;
  replyToMessageId?: string | null;
  sessionKey: string;
  text: string;
  userId: string;
}): HostedExecutionDispatchRequest {
  return {
    event: {
      clientRequestId: input.clientRequestId ?? null,
      kind: "gateway.message.send",
      replyToMessageId: input.replyToMessageId ?? null,
      sessionKey: input.sessionKey,
      text: input.text,
      userId: input.userId,
    } satisfies HostedExecutionGatewayMessageSendEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}
