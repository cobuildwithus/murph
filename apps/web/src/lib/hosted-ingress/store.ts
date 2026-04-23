import type {
  HostedExecutionCursorState,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRow,
  findCurrentHostedIngressEventAliasByWakeId,
  findHostedIngressEventAliasByEventId,
  resolveHostedIngressEventAliasId,
} from "./store-data";
import {
  projectHostedExecutionCursorRecord,
  resolveHostedIngressLifecycleStateTx,
} from "./store-projections";
import type {
  HostedIngressEventAliasRow,
  HostedIngressLifecycleRecord,
  HostedIngressEventRow,
  HostedIngressStoreClient,
} from "./store.types";

export type {
  AppendHostedIngressInput,
  AppendHostedIngressResult,
  HostedIngressLifecycleRecord,
} from "./store.types";
export {
  appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx,
  appendHostedIngressTx,
} from "./store-append";
export { ensureHostedExecutionCursorRow } from "./store-data";
export {
  projectHostedExecutionCursorRecord,
  projectHostedIngressEvent,
} from "./store-projections";


export async function findHostedIngressEventAliasIdByEventIdTx(input: {
  eventId: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<string | null> {
  const event = await findHostedIngressEventAliasByEventId(input);
  return event?.ingressEventId ?? null;
}

export async function readHostedExecutionCursor(input: {
  prisma?: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedExecutionCursorState> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRow({
    tx: prisma,
    userId: input.userId,
  });

  return projectHostedExecutionCursorRecord(cursor);
}

export async function countPendingHostedIngressEvents(input: {
  prisma?: HostedIngressStoreClient;
  userId: string;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRow({
    tx: prisma,
    userId: input.userId,
  });

  return prisma.hostedIngressEvent.count({
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

export async function readHostedIngressLifecycleByEventIdTx(input: {
  eventId: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressLifecycleRecord | null> {
  const resolved = await resolveHostedIngressEventAliasResolutionTx(input);

  if (!resolved) {
    return null;
  }

  return {
    eventId: resolved.event.eventId,
    replacedByEventId: resolved.event.replacedByEventId,
    state: resolved.event.replacedByEventId
      ? "replaced"
      : await resolveHostedIngressLifecycleStateTx({
        record: resolved.wake,
        tx: input.tx,
      }),
  };
}

export async function readHostedIngressLifecycleByDedupeKeyTx(input: {
  dedupeKey: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressLifecycleRecord | null> {
  return readHostedIngressLifecycleByEventIdTx({
    eventId: input.dedupeKey,
    tx: input.tx,
    userId: input.userId,
  });
}

export async function readHostedIngressScheduleByEventIdTx(input: {
  eventId: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<{
  eventId: string;
  occurredAt: string;
  seq: string;
  state: HostedIngressLifecycleRecord["state"];
  userId: string;
} | null> {
  const resolved = await resolveHostedIngressEventAliasResolutionTx(input);

  if (!resolved) {
    return null;
  }

  return {
    eventId: resolved.event.eventId,
    occurredAt: resolved.wake.occurredAt.toISOString(),
    seq: resolved.wake.seq.toString(),
    state: resolved.event.replacedByEventId
      ? "replaced"
      : await resolveHostedIngressLifecycleStateTx({
        record: resolved.wake,
        tx: input.tx,
      }),
    userId: resolved.wake.userId,
  };
}

export async function readLatestHostedIngressLifecycleByKind(input: {
  kind: string;
  prisma?: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressLifecycleRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const wake = await prisma.hostedIngressEvent.findFirst({
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

  const event = await findCurrentHostedIngressEventAliasByWakeId({
    ingressEventId: wake.id,
    tx: prisma,
    userId: input.userId,
  });

  return {
    eventId: event?.eventId ?? resolveHostedIngressEventAliasId(wake),
    replacedByEventId: event?.replacedByEventId ?? null,
    state: event?.replacedByEventId
      ? "replaced"
      : await resolveHostedIngressLifecycleStateTx({
        record: wake,
        tx: prisma,
      }),
  };
}

async function resolveHostedIngressEventAliasResolutionTx(input: {
  eventId: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<{
  event: HostedIngressEventAliasRow;
  wake: HostedIngressEventRow;
} | null> {
  const event = await findHostedIngressEventAliasByEventId({
    eventId: input.eventId,
    tx: input.tx,
    userId: input.userId,
  });

  if (!event) {
    return null;
  }

  const wake = await input.tx.hostedIngressEvent.findUnique({
    where: {
      id: event.ingressEventId,
    },
  });

  if (!wake || wake.userId !== input.userId) {
    return null;
  }

  return { event, wake };
}
