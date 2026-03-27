import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchRequest,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionLinqMessageReceivedEvent,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionVaultShareAcceptedEvent,
} from "./contracts.ts";

export function buildHostedExecutionMemberActivatedDispatch(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatch({
    event: {
      kind: "member.activated",
      userId: input.memberId,
    } satisfies HostedExecutionMemberActivatedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedExecutionLinqMessageReceivedDispatch(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  normalizedPhoneNumber: string;
  occurredAt: string;
  userId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatch({
    event: {
      kind: "linq.message.received",
      linqEvent: { ...input.linqEvent },
      normalizedPhoneNumber: input.normalizedPhoneNumber,
      userId: input.userId,
    } satisfies HostedExecutionLinqMessageReceivedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedExecutionEmailMessageReceivedDispatch(input: {
  envelopeFrom: string | null;
  envelopeTo: string | null;
  eventId: string;
  identityId: string;
  occurredAt: string;
  rawMessageKey: string;
  threadTarget: string | null;
  userId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatch({
    event: {
      envelopeFrom: input.envelopeFrom,
      envelopeTo: input.envelopeTo,
      identityId: input.identityId,
      kind: "email.message.received",
      rawMessageKey: input.rawMessageKey,
      threadTarget: input.threadTarget,
      userId: input.userId,
    } satisfies HostedExecutionEmailMessageReceivedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedExecutionAssistantCronTickDispatch(input: {
  eventId: string;
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  userId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatch({
    event: {
      kind: "assistant.cron.tick",
      reason: input.reason,
      userId: input.userId,
    } satisfies HostedExecutionAssistantCronTickEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedExecutionDeviceSyncWakeDispatch(input: {
  eventId: string;
  occurredAt: string;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  userId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatch({
    event: {
      kind: "device-sync.wake",
      reason: input.reason,
      userId: input.userId,
    } satisfies HostedExecutionDeviceSyncWakeEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedExecutionVaultShareAcceptedDispatch(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  share: HostedExecutionVaultShareAcceptedEvent["share"];
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatch({
    event: {
      kind: "vault.share.accepted",
      share: input.share,
      userId: input.memberId,
    } satisfies HostedExecutionVaultShareAcceptedEvent,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}

export function buildHostedExecutionDispatch(
  input: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRequest {
  return {
    event: input.event,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  };
}
