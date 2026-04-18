import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionDispatchLifecycleState,
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  buildHostedExecutionAssistantCronTickWake,
  isHostedConversationMessageWake,
} from "@murphai/hosted-execution";

import {
  appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx,
  findHostedWakeEventIdByEventIdTx,
  readHostedWakeLifecycleByDedupeKeyTx,
  readHostedWakeScheduleByEventIdTx,
  type AppendHostedWakeResult,
} from "./store";

export async function appendHostedOrderedExecutionWakeTx(input: {
  tx: Prisma.TransactionClient;
  wake: HostedExecutionWake;
}): Promise<AppendHostedWakeResult> {
  const { wake } = input;
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

export async function appendHostedExecutionWakePayloadTx(input: {
  tx: Prisma.TransactionClient;
  wake: HostedExecutionWake;
}): Promise<AppendHostedWakeResult> {
  const { wake } = input;

  switch (wake.kind) {
    case "assistant.cron.tick":
    case "device-sync.wake":
    case "member.channels.updated":
      return appendHostedCoalescingExecutionWakeTx({
        coalescingKey: buildHostedWakeCoalescingKey(wake),
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

async function appendHostedCoalescingExecutionWakeTx(input: {
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
    dedupeKey: buildHostedWakeDedupeKeyFromEventId(input.eventId),
    tx: input.tx,
  });

  return lifecycle?.state ?? null;
}

export async function materializeHostedAssistantCronWakeTx(input: {
  eventId?: string;
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<AppendHostedWakeResult> {
  const wake = buildHostedExecutionAssistantCronTickWake({
    eventId: input.eventId ?? buildHostedAssistantCronWakeEventId(input),
    occurredAt: input.occurredAt,
    reason: input.reason,
    userId: input.userId,
  });

  return appendHostedExecutionWakePayloadTx({
    tx: input.tx,
    wake,
  });
}

export function buildHostedExecutionWakeDedupeKey(wake: HostedExecutionWake): string {
  return buildHostedWakeDedupeKey(wake);
}

export function buildHostedExecutionWakeCoalescingKey(wake: HostedExecutionWake): string {
  return buildHostedWakeCoalescingKey(wake);
}

export function buildHostedAssistantCronWakeEventId(input: {
  occurredAt: string;
  reason: HostedExecutionAssistantCronTickEvent["reason"];
  userId: string;
}): string {
  const occurredAt = new Date(input.occurredAt);

  if (Number.isNaN(occurredAt.getTime())) {
    throw new TypeError("Hosted assistant cron wake occurredAt must be a valid ISO-8601 timestamp.");
  }

  const bucketedOccurredAt = new Date(Math.floor(occurredAt.getTime() / 60_000) * 60_000);
  return `assistant.cron.tick:${input.userId}:${input.reason}:${bucketedOccurredAt.toISOString()}`;
}

function buildHostedWakeDedupeKey(wake: HostedExecutionWake): string {
  return buildHostedWakeDedupeKeyFromEventId(wake.eventId, wake.kind);
}

function buildHostedWakeCoalescingKey(wake: HostedExecutionWake): string {
  if (wake.kind === "device-sync.wake") {
    return `${wake.kind}:${wake.userId}:${wake.connectionId ?? wake.provider ?? "global"}`;
  }

  return `${wake.kind}:${wake.userId}`;
}

function buildHostedWakeDedupeKeyFromEventId(
  eventId: string,
  eventKind = "unknown",
): string {
  // Keep the legacy on-disk prefix until the shared contract and Cloudflare callers move.
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
