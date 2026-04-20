import type {
  HostedExecutionCursorState,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRowTx,
  findCurrentHostedWakeEventByWakeIdTx,
  findHostedWakeEventByEventIdTx,
  resolveHostedWakeEventId,
} from "./store-data";
import {
  projectHostedExecutionCursorRecord,
  resolveHostedWakeLifecycleStateTx,
} from "./store-projections";
import type {
  HostedWakeEventRow,
  HostedWakeLifecycleRecord,
  HostedWakeRow,
  HostedWakeStoreClient,
} from "./store.types";

export type {
  AppendHostedWakeInput,
  AppendHostedWakeResult,
  HostedWakeLifecycleRecord,
} from "./store.types";
export {
  appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx,
  appendHostedWakeTx,
} from "./store-append";
export { ensureHostedExecutionCursorRowTx } from "./store-data";
export {
  projectHostedExecutionCursorRecord,
  projectHostedWakeRecord,
} from "./store-projections";


export async function findHostedWakeEventIdByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<string | null> {
  const event = await findHostedWakeEventByEventIdTx(input);
  return event?.wakeId ?? null;
}

export async function readHostedExecutionCursor(input: {
  prisma?: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedExecutionCursorState> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: prisma,
    userId: input.userId,
  });

  return projectHostedExecutionCursorRecord(cursor);
}

export async function countPendingHostedWakes(input: {
  prisma?: HostedWakeStoreClient;
  userId: string;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: prisma,
    userId: input.userId,
  });

  return prisma.hostedWake.count({
    where: {
      completedAt: null,
      quarantinedAt: null,
      seq: {
        gt: cursor.committedSeq,
      },
      state: {
        in: ["pending", "running"],
      },
      userId: input.userId,
    },
  });
}

export async function readHostedWakeLifecycleByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedWakeLifecycleRecord | null> {
  const resolved = await resolveHostedWakeEventResolutionTx(input);

  if (!resolved) {
    return null;
  }

  return {
    eventId: resolved.event.eventId,
    replacedByEventId: resolved.event.replacedByEventId,
    state: resolved.event.replacedByEventId
      ? "replaced"
      : await resolveHostedWakeLifecycleStateTx({
        record: resolved.wake,
        tx: input.tx,
      }),
  };
}

export async function readHostedWakeLifecycleByDedupeKeyTx(input: {
  dedupeKey: string;
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedWakeLifecycleRecord | null> {
  return readHostedWakeLifecycleByEventIdTx({
    eventId: input.dedupeKey,
    tx: input.tx,
    userId: input.userId,
  });
}

export async function readHostedWakeScheduleByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<{
  eventId: string;
  occurredAt: string;
  seq: string;
  state: HostedWakeLifecycleRecord["state"];
  userId: string;
} | null> {
  const resolved = await resolveHostedWakeEventResolutionTx(input);

  if (!resolved) {
    return null;
  }

  return {
    eventId: resolved.event.eventId,
    occurredAt: resolved.wake.occurredAt.toISOString(),
    seq: resolved.wake.seq.toString(),
    state: resolved.event.replacedByEventId
      ? "replaced"
      : await resolveHostedWakeLifecycleStateTx({
        record: resolved.wake,
        tx: input.tx,
      }),
    userId: resolved.wake.userId,
  };
}

export async function readLatestHostedWakeLifecycleByKind(input: {
  kind: string;
  prisma?: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedWakeLifecycleRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const wake = await prisma.hostedWake.findFirst({
    where: {
      kind: input.kind,
      userId: input.userId,
    },
    orderBy: {
      seq: "desc",
    },
  });

  if (!wake) {
    return null;
  }

  const event = await findCurrentHostedWakeEventByWakeIdTx({
    tx: prisma,
    userId: input.userId,
    wakeId: wake.id,
  });

  return {
    eventId: event?.eventId ?? resolveHostedWakeEventId(wake),
    replacedByEventId: event?.replacedByEventId ?? null,
    state: event?.replacedByEventId
      ? "replaced"
      : await resolveHostedWakeLifecycleStateTx({
        record: wake,
        tx: prisma,
      }),
  };
}

async function resolveHostedWakeEventResolutionTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<{
  event: HostedWakeEventRow;
  wake: HostedWakeRow;
} | null> {
  const event = await findHostedWakeEventByEventIdTx({
    eventId: input.eventId,
    tx: input.tx,
    userId: input.userId,
  });

  if (!event) {
    return null;
  }

  const wake = await input.tx.hostedWake.findUnique({
    where: {
      id: event.wakeId,
    },
  });

  if (!wake || wake.userId !== input.userId) {
    return null;
  }

  return { event, wake };
}
