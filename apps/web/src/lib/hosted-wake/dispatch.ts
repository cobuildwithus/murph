import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedExecutionDispatchLifecycleState,
  HostedExecutionDispatchRequest,
  HostedWakeMessagePayload,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  buildHostedWakeEmailMessageReceivedPayload,
  buildHostedWakeLinqMessageReceivedPayload,
  buildHostedWakeTelegramMessageReceivedPayload,
  isHostedMessageWakeDispatch,
} from "@murphai/hosted-execution";

import {
  appendHostedCoalescingWakeTx,
  appendHostedEdgeTriggeredWakeTx,
  appendHostedOrderedWakeTx,
  findHostedWakeEventIdByEventIdTx,
  readHostedWakeLifecycleByDedupeKeyTx,
  readHostedWakeScheduleByEventIdTx,
  type AppendHostedWakeResult,
} from "./store";

export async function appendHostedOrderedWakePayloadTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedOrderedWakeTx({
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: buildHostedWakePayloadValue(input.dispatch),
    payloadSchema: resolveHostedWakePayloadSchema(input.dispatch),
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export async function appendHostedExecutionWakePayloadTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
} | {
  eventId: string;
  kind: "linq.message.received" | "telegram.message.received";
  occurredAt: string;
  payload: HostedWakeMessagePayload;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<AppendHostedWakeResult> {
  if (!("dispatch" in input)) {
    return appendHostedOrderedWakeTx({
      dedupeKey: buildHostedWakeDispatchDedupeKeyFromEventId(input.eventId, input.kind),
      kind: input.kind,
      occurredAt: input.occurredAt,
      payload: input.payload,
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      tx: input.tx,
      userId: input.userId,
    });
  }

  switch (input.dispatch.event.kind) {
    case "device-sync.wake":
    case "member.channels.updated":
      return appendHostedCoalescingWakePayloadTx({
        coalescingKey: buildHostedWakeDispatchCoalescingKey(input.dispatch),
        dispatch: input.dispatch,
        tx: input.tx,
      });
    default:
      return appendHostedOrderedWakePayloadTx(input);
  }
}

export async function appendHostedCoalescingWakePayloadTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedCoalescingWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: buildHostedWakePayloadValue(input.dispatch),
    payloadSchema: resolveHostedWakePayloadSchema(input.dispatch),
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export async function appendHostedEdgeTriggeredWakePayloadTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedEdgeTriggeredWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: buildHostedWakePayloadValue(input.dispatch),
    payloadSchema: resolveHostedWakePayloadSchema(input.dispatch),
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export async function findHostedExecutionWakeEventIdTx(input: {
  eventId: string;
  tx: Prisma.TransactionClient | PrismaClient;
}): Promise<string | null> {
  return findHostedWakeEventIdByEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
  });
}

export async function readHostedExecutionWakeTargetTx(input: {
  eventId: string;
  tx: Prisma.TransactionClient | PrismaClient;
}): Promise<{
  eventId: string;
  seq: string;
  userId: string;
} | null> {
  return readHostedWakeScheduleByEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
  });
}

export async function readHostedExecutionWakeLifecycleStateTx(input: {
  eventId: string;
  tx: Prisma.TransactionClient | PrismaClient;
}): Promise<HostedExecutionDispatchLifecycleState | null> {
  const lifecycle = await readHostedWakeLifecycleByDedupeKeyTx({
    dedupeKey: buildHostedWakeDispatchDedupeKeyFromEventId(input.eventId),
    tx: input.tx,
  });

  return lifecycle?.state ?? null;
}

export function buildHostedWakeDispatchDedupeKey(
  dispatch: HostedExecutionDispatchRequest,
): string {
  return buildHostedWakeDispatchDedupeKeyFromEventId(dispatch.eventId, dispatch.event.kind);
}

export function buildHostedWakeDispatchCoalescingKey(
  dispatch: HostedExecutionDispatchRequest,
): string {
  if (dispatch.event.kind === "device-sync.wake") {
    return `${dispatch.event.kind}:${dispatch.event.userId}:${dispatch.event.connectionId ?? dispatch.event.provider ?? "global"}`;
  }

  return `${dispatch.event.kind}:${dispatch.event.userId}`;
}

function buildHostedWakeDispatchDedupeKeyFromEventId(
  eventId: string,
  eventKind = "unknown",
): string {
  return `dispatch:${eventKind}:${eventId}`;
}

function resolveHostedWakePayloadSchema(
  dispatch: HostedExecutionDispatchRequest,
): string {
  return isHostedMessageWakeDispatch(dispatch)
    ? HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA
    : HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA;
}

function buildHostedWakePayloadValue(
  dispatch: HostedExecutionDispatchRequest,
): unknown {
  if (!isHostedMessageWakeDispatch(dispatch)) {
    return dispatch;
  }

  switch (dispatch.event.kind) {
    case "linq.message.received":
      return buildHostedWakeLinqMessageReceivedPayload({
        eventId: dispatch.eventId,
        linqEvent: dispatch.event.linqEvent,
        ...(dispatch.event.linqMessageId === undefined
          ? {}
          : { linqMessageId: dispatch.event.linqMessageId }),
        phoneLookupKey: dispatch.event.phoneLookupKey,
      });
    case "telegram.message.received":
      return buildHostedWakeTelegramMessageReceivedPayload({
        eventId: dispatch.eventId,
        telegramMessage: dispatch.event.telegramMessage,
      });
    case "email.message.received":
      return buildHostedWakeEmailMessageReceivedPayload({
        eventId: dispatch.eventId,
        identityId: dispatch.event.identityId,
        rawMessageKey: dispatch.event.rawMessageKey,
        ...(dispatch.event.selfAddress === undefined
          ? {}
          : { selfAddress: dispatch.event.selfAddress }),
      });
  }
}
