import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  HOSTED_WAKE_LIFECYCLE_STATES,
  type HostedExecutionWake,
  type HostedWakeLifecycleState,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  appendHostedExecutionWakePayloadTx,
  findHostedExecutionWakeEventIdTx,
  readHostedExecutionWakeLifecycleStateTx,
  readHostedExecutionWakeTargetTx,
} from "./queue";

const HOSTED_WAKE_LIFECYCLE_STATE_SET = new Set<HostedWakeLifecycleState>(
  HOSTED_WAKE_LIFECYCLE_STATES,
);

type HostedWakeClient = PrismaClient | Prisma.TransactionClient;

export type { HostedWakeLifecycleState };

export interface HostedExecutionWakeMaterializationResult {
  eventId: string;
}

export interface HostedWakeTarget {
  eventId: string;
  seq: string;
  userId: string;
}

export function normalizeHostedWakeLifecycleState(
  value: string | null | undefined,
): HostedWakeLifecycleState | null {
  if (value && HOSTED_WAKE_LIFECYCLE_STATE_SET.has(value as HostedWakeLifecycleState)) {
    return value as HostedWakeLifecycleState;
  }

  return null;
}

export function isHostedWakeLifecycleTerminal(
  state: HostedWakeLifecycleState,
): boolean {
  return state === "completed" || state === "poisoned";
}

export async function materializeHostedExecutionWakeTx(input: {
  wake: HostedExecutionWake;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionWakeMaterializationResult> {
  await appendHostedExecutionWakePayloadTx({
    wake: input.wake,
    tx: input.tx,
  });

  return {
    eventId: input.wake.eventId,
  };
}

export async function readHostedWakeTarget(input: {
  eventId: string;
  prisma?: HostedWakeClient;
}): Promise<HostedWakeTarget | null> {
  const prisma = input.prisma ?? getPrisma();
  const wakeRecord = await readHostedExecutionWakeTargetTx({
    eventId: input.eventId,
    tx: prisma,
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

export async function findHostedWakeByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeClient;
}): Promise<string | null> {
  return findHostedExecutionWakeEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
  });
}

export async function readHostedWakeLifecycleState(input: {
  eventId: string;
  prisma?: HostedWakeClient;
}): Promise<HostedWakeLifecycleState | null> {
  const prisma = input.prisma ?? getPrisma();
  const state = await readHostedExecutionWakeLifecycleStateTx({
    eventId: input.eventId,
    tx: prisma,
  });

  return state ?? null;
}
