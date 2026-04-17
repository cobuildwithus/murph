import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedExecutionDispatchLifecycleState,
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";

import {
  HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
} from "./payload";
import {
  appendHostedCoalescingWakeTx,
  appendHostedEdgeTriggeredWakeTx,
  appendHostedOrderedWakeTx,
  findHostedWakeEventIdByEventIdTx,
  readHostedWakeLifecycleByDedupeKeyTx,
  readHostedWakeScheduleByEventIdTx,
  type AppendHostedWakeResult,
} from "./store";

export async function appendHostedOrderedDispatchWakeTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedOrderedWakeTx({
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: input.dispatch,
    payloadSchema: HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export async function appendHostedExecutionDispatchWakeTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  switch (input.dispatch.event.kind) {
    case "device-sync.wake":
    case "member.channels.updated":
      return appendHostedCoalescingDispatchWakeTx({
        coalescingKey: buildHostedWakeDispatchCoalescingKey(input.dispatch),
        dispatch: input.dispatch,
        tx: input.tx,
      });
    default:
      return appendHostedOrderedDispatchWakeTx(input);
  }
}

export async function appendHostedCoalescingDispatchWakeTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedCoalescingWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: input.dispatch,
    payloadSchema: HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export async function appendHostedEdgeTriggeredDispatchWakeTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedEdgeTriggeredWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: input.dispatch,
    payloadSchema: HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
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

export async function readHostedExecutionWakeScheduleTx(input: {
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
