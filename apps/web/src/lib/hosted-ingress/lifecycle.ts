import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  HOSTED_INGRESS_LIFECYCLE_STATES,
  type HostedIngressEnvelope,
  type HostedIngressLifecycleState,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  appendHostedIngressEnvelopePayloadTx,
  findHostedIngressEnvelopeEventIdTx,
  readHostedIngressEnvelopeTargetTx,
} from "./queue";
import {
  readHostedIngressLifecycleByEventIdTx,
} from "./store";
import type {
  HostedIngressLifecycleRecord,
} from "./store.types";

const HOSTED_INGRESS_LIFECYCLE_STATE_SET = new Set<HostedIngressLifecycleState>(
  HOSTED_INGRESS_LIFECYCLE_STATES,
);

type HostedIngressClient = PrismaClient | Prisma.TransactionClient;

export type {
  HostedIngressLifecycleRecord,
  HostedIngressLifecycleState,
};

export interface HostedIngressEnvelopeMaterializationResult {
  eventId: string;
}

export interface HostedIngressTarget {
  eventId: string;
  seq: string;
  userId: string;
}

export function normalizeHostedIngressLifecycleState(
  value: string | null | undefined,
): HostedIngressLifecycleState | null {
  if (value && HOSTED_INGRESS_LIFECYCLE_STATE_SET.has(value as HostedIngressLifecycleState)) {
    return value as HostedIngressLifecycleState;
  }

  return null;
}

export function isHostedIngressLifecycleTerminal(
  state: HostedIngressLifecycleState,
): boolean {
  return state === "completed" || state === "replaced" || state === "quarantined";
}

export async function materializeHostedIngressEnvelopeTx(input: {
  wake: HostedIngressEnvelope;
  tx: Prisma.TransactionClient;
}): Promise<HostedIngressEnvelopeMaterializationResult> {
  await appendHostedIngressEnvelopePayloadTx({
    wake: input.wake,
    tx: input.tx,
  });

  return {
    eventId: input.wake.eventId,
  };
}

export async function readHostedIngressTarget(input: {
  eventId: string;
  prisma?: HostedIngressClient;
  userId: string;
}): Promise<HostedIngressTarget | null> {
  const prisma = input.prisma ?? getPrisma();
  const wakeRecord = await readHostedIngressEnvelopeTargetTx({
    eventId: input.eventId,
    tx: prisma,
    userId: input.userId,
  });

  if (!wakeRecord) {
    return null;
  }

  return {
    eventId: wakeRecord.eventId,
    seq: wakeRecord.seq,
    userId: wakeRecord.userId,
  };
}

export async function findHostedIngressByEventId(input: {
  eventId: string;
  tx: HostedIngressClient;
  userId: string;
}): Promise<string | null> {
  return findHostedIngressEnvelopeEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
    userId: input.userId,
  });
}

export async function readHostedIngressLifecycleState(input: {
  eventId: string;
  prisma?: HostedIngressClient;
  userId: string;
}): Promise<HostedIngressLifecycleState | null> {
  const lifecycle = await readHostedIngressLifecycle(input);

  return lifecycle?.state ?? null;
}

export async function readHostedIngressLifecycle(input: {
  eventId: string;
  prisma?: HostedIngressClient;
  userId: string;
}): Promise<HostedIngressLifecycleRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const lifecycle = await readHostedIngressLifecycleByEventIdTx({
    eventId: input.eventId,
    tx: prisma,
    userId: input.userId,
  });

  return lifecycle ?? null;
}
