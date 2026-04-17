import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
  type HostedExecutionDispatchLifecycleState,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  appendHostedExecutionDispatchWakeTx,
  findHostedExecutionWakeEventIdTx,
  readHostedExecutionWakeLifecycleStateTx,
  readHostedExecutionWakeScheduleTx,
} from "../hosted-wake/dispatch";

const DEFAULT_EXECUTION_LIFECYCLE_STATE: HostedExecutionDispatchLifecycleState = "queued";
const EXECUTION_LIFECYCLE_STATE_SET = new Set<HostedExecutionDispatchLifecycleState>(
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
);

type HostedExecutionScheduleClient = PrismaClient | Prisma.TransactionClient;

export type HostedExecutionDispatchRoute = "wake";

export interface HostedExecutionDispatchScheduleResult {
  eventId: string;
  route: HostedExecutionDispatchRoute;
}

export interface HostedExecutionScheduledDispatchTarget {
  eventId: string;
  route: HostedExecutionDispatchRoute;
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

export async function scheduleHostedExecutionDispatchTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  now?: string;
  sourceId?: string | null;
  sourceType: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionDispatchScheduleResult> {
  await appendHostedExecutionDispatchWakeTx({
    dispatch: input.dispatch,
    tx: input.tx,
  });

  return {
    eventId: input.dispatch.eventId,
    route: "wake",
  };
}

export async function readHostedExecutionScheduledDispatchTarget(input: {
  eventId: string;
  prisma?: HostedExecutionScheduleClient;
}): Promise<HostedExecutionScheduledDispatchTarget | null> {
  const prisma = input.prisma ?? getPrisma();
  const wakeRecord = await readHostedExecutionWakeScheduleTx({
    eventId: input.eventId,
    tx: prisma,
  });

  if (!wakeRecord) {
    return null;
  }

  return {
    eventId: wakeRecord.eventId,
    route: "wake",
    seq: wakeRecord.seq,
    userId: wakeRecord.userId,
  };
}

export async function findHostedExecutionScheduledEventIdTx(input: {
  eventId: string;
  tx: HostedExecutionScheduleClient;
}): Promise<string | null> {
  return findHostedExecutionWakeEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
  });
}

export async function readHostedExecutionLifecycleStateFromWake(input: {
  eventId: string;
  prisma?: HostedExecutionScheduleClient;
}): Promise<HostedExecutionDispatchLifecycleState> {
  const prisma = input.prisma ?? getPrisma();
  const state = await readHostedExecutionWakeLifecycleStateTx({
    eventId: input.eventId,
    tx: prisma,
  });

  return state ?? DEFAULT_EXECUTION_LIFECYCLE_STATE;
}
