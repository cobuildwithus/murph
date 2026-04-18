import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedExecutionDispatchLifecycleState,
  HostedExecutionDispatchRequest,
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  buildHostedExecutionDispatchFromWake,
  buildHostedExecutionWakeFromDispatch,
  isHostedConversationMessageWake,
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

type CanonicalHostedWakeInput =
  | {
      dispatch: HostedExecutionDispatchRequest;
      tx: Prisma.TransactionClient;
    }
  | {
      tx: Prisma.TransactionClient;
      wake: HostedExecutionWake;
    };

export async function appendHostedOrderedExecutionWakeTx(input: CanonicalHostedWakeInput): Promise<AppendHostedWakeResult> {
  const wake = normalizeHostedExecutionWakeInput(input);
  return appendHostedOrderedWakeTx({
    dedupeKey: buildHostedExecutionWakeDedupeKey(wake),
    kind: wake.kind,
    occurredAt: wake.occurredAt,
    payload: buildHostedWakePayloadValue(wake),
    payloadSchema: resolveHostedWakePayloadSchema(wake),
    tx: input.tx,
    userId: wake.userId,
  });
}

export async function appendHostedOrderedWakePayloadTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedOrderedExecutionWakeTx(input);
}

export async function appendHostedExecutionWakePayloadTx(
  input: CanonicalHostedWakeInput,
): Promise<AppendHostedWakeResult> {
  const wake = normalizeHostedExecutionWakeInput(input);

  switch (wake.kind) {
    case "device-sync.wake":
    case "member.channels.updated":
      return appendHostedCoalescingExecutionWakeTx({
        coalescingKey: buildHostedExecutionWakeCoalescingKey(wake),
        tx: input.tx,
        wake,
      });
    default:
      return appendHostedOrderedExecutionWakeTx({
        tx: input.tx,
        wake,
      });
  }
}

export async function appendHostedCoalescingExecutionWakeTx(input: {
  coalescingKey: string;
  tx: Prisma.TransactionClient;
  wake: HostedExecutionWake;
}): Promise<AppendHostedWakeResult> {
  return appendHostedCoalescingWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedExecutionWakeDedupeKey(input.wake),
    kind: input.wake.kind,
    occurredAt: input.wake.occurredAt,
    payload: buildHostedWakePayloadValue(input.wake),
    payloadSchema: resolveHostedWakePayloadSchema(input.wake),
    tx: input.tx,
    userId: input.wake.userId,
  });
}

export async function appendHostedCoalescingWakePayloadTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedCoalescingExecutionWakeTx({
    coalescingKey: input.coalescingKey,
    tx: input.tx,
    wake: buildHostedExecutionWakeFromDispatch(input.dispatch),
  });
}

export async function appendHostedEdgeTriggeredExecutionWakeTx(input: {
  coalescingKey: string;
  tx: Prisma.TransactionClient;
  wake: HostedExecutionWake;
}): Promise<AppendHostedWakeResult> {
  return appendHostedEdgeTriggeredWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedExecutionWakeDedupeKey(input.wake),
    kind: input.wake.kind,
    occurredAt: input.wake.occurredAt,
    payload: buildHostedWakePayloadValue(input.wake),
    payloadSchema: resolveHostedWakePayloadSchema(input.wake),
    tx: input.tx,
    userId: input.wake.userId,
  });
}

export async function appendHostedEdgeTriggeredWakePayloadTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedEdgeTriggeredExecutionWakeTx({
    coalescingKey: input.coalescingKey,
    tx: input.tx,
    wake: buildHostedExecutionWakeFromDispatch(input.dispatch),
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

export function buildHostedExecutionWakeDedupeKey(wake: HostedExecutionWake): string {
  return buildHostedWakeDispatchDedupeKeyFromEventId(wake.eventId, wake.kind);
}

export function buildHostedWakeDispatchDedupeKey(
  dispatch: HostedExecutionDispatchRequest,
): string {
  return buildHostedExecutionWakeDedupeKey(buildHostedExecutionWakeFromDispatch(dispatch));
}

export function buildHostedExecutionWakeCoalescingKey(wake: HostedExecutionWake): string {
  if (wake.kind === "device-sync.wake") {
    return `${wake.kind}:${wake.userId}:${wake.connectionId ?? wake.provider ?? "global"}`;
  }

  return `${wake.kind}:${wake.userId}`;
}

export function buildHostedWakeDispatchCoalescingKey(
  dispatch: HostedExecutionDispatchRequest,
): string {
  return buildHostedExecutionWakeCoalescingKey(buildHostedExecutionWakeFromDispatch(dispatch));
}

function buildHostedWakeDispatchDedupeKeyFromEventId(
  eventId: string,
  eventKind = "unknown",
): string {
  return `dispatch:${eventKind}:${eventId}`;
}

function resolveHostedWakePayloadSchema(wake: HostedExecutionWake): string {
  return isHostedConversationMessageWake(wake)
    ? HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA
    : HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA;
}

function buildHostedWakePayloadValue(wake: HostedExecutionWake): unknown {
  if (!isHostedConversationMessageWake(wake)) {
    return wake;
  }

  return {
    eventId: wake.eventId,
    ...wake.message,
  };
}

function normalizeHostedExecutionWakeInput(input: CanonicalHostedWakeInput): HostedExecutionWake {
  return "wake" in input
    ? input.wake
    : buildHostedExecutionWakeFromDispatch(input.dispatch);
}

export function buildHostedExecutionDispatchFromStoredWake(wake: HostedExecutionWake): HostedExecutionDispatchRequest {
  return buildHostedExecutionDispatchFromWake(wake);
}
