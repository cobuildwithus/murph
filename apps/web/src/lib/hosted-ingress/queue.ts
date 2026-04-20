import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedIngressEnvelope,
  HostedIngressPayloadSchema,
  HostedIngressLifecycleState,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  isHostedIngressKind,
} from "@murphai/hosted-execution";

import {
  appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx,
  findHostedIngressEventAliasIdByEventIdTx,
  readHostedIngressLifecycleByEventIdTx,
  readHostedIngressScheduleByEventIdTx,
  type AppendHostedIngressResult,
} from "./store";

export async function appendHostedOrderedIngressEnvelopeTx(input: {
  tx: Prisma.TransactionClient;
  wake: HostedIngressEnvelope;
}): Promise<AppendHostedIngressResult> {
  const { wake } = input;
  return appendHostedOrderedWakeTx({
    dedupeKey: buildHostedIngressEnvelopeDedupeKey(wake),
    eventId: wake.eventId,
    kind: wake.kind,
    occurredAt: wake.occurredAt,
    payload: buildHostedIngressPayloadValue(wake),
    payloadSchema: resolveHostedIngressPayloadSchema(),
    tx: input.tx,
    userId: wake.userId,
  });
}

export async function appendHostedIngressEnvelopePayloadTx(input: {
  tx: Prisma.TransactionClient;
  wake: HostedIngressEnvelope;
}): Promise<AppendHostedIngressResult> {
  const { wake } = input;
  if (!isHostedIngressKind(wake.kind)) {
    throw new TypeError(
      "Hosted ingress accepts only canonical external ingress kinds.",
    );
  }

  switch (wake.kind) {
    case "member.channels.updated":
      return appendHostedCoalescingIngressEnvelopeTx({
        coalescingKey: buildHostedIngressCoalescingKey(wake),
        tx: input.tx,
        wake,
      });
    default:
      return appendHostedOrderedIngressEnvelopeTx({
        tx: input.tx,
        wake,
      });
  }
}

async function appendHostedCoalescingIngressEnvelopeTx(input: {
  coalescingKey: string;
  tx: Prisma.TransactionClient;
  wake: HostedIngressEnvelope;
}): Promise<AppendHostedIngressResult> {
  return appendHostedCoalescingWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedIngressEnvelopeDedupeKey(input.wake),
    eventId: input.wake.eventId,
    kind: input.wake.kind,
    occurredAt: input.wake.occurredAt,
    payload: buildHostedIngressPayloadValue(input.wake),
    payloadSchema: resolveHostedIngressPayloadSchema(),
    tx: input.tx,
    userId: input.wake.userId,
  });
}

export async function findHostedIngressEnvelopeEventIdTx(input: {
  eventId: string;
  tx: Prisma.TransactionClient | PrismaClient;
  userId: string;
}): Promise<string | null> {
  return findHostedIngressEventAliasIdByEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
    userId: input.userId,
  });
}

export async function readHostedIngressEnvelopeTargetTx(input: {
  eventId: string;
  tx: Prisma.TransactionClient | PrismaClient;
  userId: string;
}): Promise<{
  eventId: string;
  seq: string;
  userId: string;
} | null> {
  return readHostedIngressScheduleByEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
    userId: input.userId,
  });
}

export async function readHostedIngressEnvelopeLifecycleStateTx(input: {
  eventId: string;
  tx: Prisma.TransactionClient | PrismaClient;
  userId: string;
}): Promise<HostedIngressLifecycleState | null> {
  const lifecycle = await readHostedIngressLifecycleByEventIdTx({
    eventId: buildHostedIngressDedupeKeyFromEventId(input.eventId),
    tx: input.tx,
    userId: input.userId,
  });

  return lifecycle?.state ?? null;
}

export function buildHostedIngressEnvelopeDedupeKey(wake: HostedIngressEnvelope): string {
  return buildHostedIngressDedupeKey(wake);
}

function buildHostedIngressDedupeKey(wake: HostedIngressEnvelope): string {
  return buildHostedIngressDedupeKeyFromEventId(wake.eventId);
}

function buildHostedIngressCoalescingKey(wake: HostedIngressEnvelope): string {
  return `${wake.kind}:${wake.userId}`;
}

function buildHostedIngressDedupeKeyFromEventId(
  eventId: string,
): string {
  return eventId;
}

function resolveHostedIngressPayloadSchema(): HostedIngressPayloadSchema {
  return HOSTED_INGRESS_PAYLOAD_SCHEMA;
}

function buildHostedIngressPayloadValue(wake: HostedIngressEnvelope): unknown {
  return wake;
}
