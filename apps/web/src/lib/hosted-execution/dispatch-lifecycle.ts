import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
  type HostedExecutionDispatchLifecycleState,
  type HostedExecutionDispatchRequest,
  type HostedWakeMessagePayload,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  appendHostedExecutionWakePayloadTx,
  findHostedExecutionWakeEventIdTx,
  readHostedExecutionWakeLifecycleStateTx,
  readHostedExecutionWakeTargetTx,
} from "../hosted-wake/dispatch";

const DEFAULT_EXECUTION_LIFECYCLE_STATE: HostedExecutionDispatchLifecycleState = "queued";
const EXECUTION_LIFECYCLE_STATE_SET = new Set<HostedExecutionDispatchLifecycleState>(
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
);

type HostedExecutionWakeClient = PrismaClient | Prisma.TransactionClient;

export interface HostedExecutionWakeAppendResult {
  eventId: string;
}

export interface HostedExecutionWakeTarget {
  eventId: string;
  seq: string;
  userId: string;
}

export function readExecutionLifecycleState(
  value: string | null | undefined,
): HostedExecutionDispatchLifecycleState {
  if (
    value
    && EXECUTION_LIFECYCLE_STATE_SET.has(value as HostedExecutionDispatchLifecycleState)
  ) {
    return value as HostedExecutionDispatchLifecycleState;
  }

  return DEFAULT_EXECUTION_LIFECYCLE_STATE;
}

export function isExecutionLifecycleTerminal(
  state: HostedExecutionDispatchLifecycleState,
): boolean {
  return state === "completed"
    || state === "poisoned";
}

export async function appendHostedExecutionWakeTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  now?: string;
  sourceId?: string | null;
  sourceType: string;
  tx: Prisma.TransactionClient;
} | {
  eventId: string;
  kind: "linq.message.received" | "telegram.message.received";
  now?: string;
  occurredAt: string;
  payload: HostedWakeMessagePayload;
  sourceId?: string | null;
  sourceType: string;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<HostedExecutionWakeAppendResult> {
  if ("dispatch" in input) {
    await appendHostedExecutionWakePayloadTx({
      dispatch: input.dispatch,
      tx: input.tx,
    });

    return {
      eventId: input.dispatch.eventId,
    };
  }

  await appendHostedExecutionWakePayloadTx({
    eventId: input.eventId,
    kind: input.kind,
    occurredAt: input.occurredAt,
    payload: input.payload,
    tx: input.tx,
    userId: input.userId,
  });

  return {
    eventId: input.eventId,
  };
}

export async function readHostedExecutionWakeTarget(input: {
  eventId: string;
  prisma?: HostedExecutionWakeClient;
}): Promise<HostedExecutionWakeTarget | null> {
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

export async function findHostedExecutionWakeByEventIdTx(input: {
  eventId: string;
  tx: HostedExecutionWakeClient;
}): Promise<string | null> {
  return findHostedExecutionWakeEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
  });
}

export async function readHostedExecutionWakeLifecycleState(input: {
  eventId: string;
  prisma?: HostedExecutionWakeClient;
}): Promise<HostedExecutionDispatchLifecycleState> {
  const prisma = input.prisma ?? getPrisma();
  const state = await readHostedExecutionWakeLifecycleStateTx({
    eventId: input.eventId,
    tx: prisma,
  });

  return state ?? DEFAULT_EXECUTION_LIFECYCLE_STATE;
}
