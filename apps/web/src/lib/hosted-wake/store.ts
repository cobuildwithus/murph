import { Prisma } from "@prisma/client";
import type {
  HostedExecutionCursorState,
  HostedWakeCommitResponse,
  HostedWakeFetchResponse,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRowTx,
  findHostedWakeByDedupeKeyTx,
  findHostedWakeByEventIdTx,
  resolveHostedWakeEventId,
} from "./store-data";
import {
  hydrateHostedWakeRecordsTx,
  projectHostedExecutionCursorRecord,
  resolveHostedWakeLifecycleStateTx,
} from "./store-projections";
import type {
  HostedWakeLifecycleRecord,
  HostedWakeMutationTx,
  HostedWakeRepairCandidate,
  HostedWakeStoreClient,
  ListHostedWakesInput,
} from "./store.types";

export type {
  AppendHostedWakeInput,
  AppendHostedWakeResult,
  HostedWakeLifecycleRecord,
  HostedWakeRepairCandidate,
  ListHostedWakesInput,
} from "./store.types";
export {
  appendHostedCoalescingWakeTx,
  appendHostedEdgeTriggeredWakeTx,
  appendHostedOrderedWakeTx,
  appendHostedWakeTx,
} from "./store-append";
export { ensureHostedExecutionCursorRowTx } from "./store-data";
export {
  projectHostedExecutionCursorRecord,
  projectHostedWakeRecord,
} from "./store-projections";

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

export async function listHostedWakesAfterSeq(
  input: ListHostedWakesInput,
): Promise<HostedWakeFetchResponse> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: prisma,
    userId: input.userId,
  });
  const requestedAfterSeq = input.afterSeq ?? cursor.committedSeq;
  const afterSeq = requestedAfterSeq > cursor.committedSeq
    ? requestedAfterSeq
    : cursor.committedSeq;
  const wakes = await prisma.hostedWake.findMany({
    where: {
      seq: {
        gt: afterSeq,
      },
      userId: input.userId,
    },
    orderBy: {
      seq: "asc",
    },
    take: Math.max(1, input.limit ?? 64),
  });

  return {
    cursor: projectHostedExecutionCursorRecord(cursor),
    wakes: await hydrateHostedWakeRecordsTx({
      records: wakes,
      tx: prisma,
    }),
  };
}

export async function commitHostedExecutionCursorTx(input: {
  committedSeq: bigint;
  expectedVersion: bigint;
  snapshotRef?: Prisma.InputJsonValue | null;
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<HostedWakeCommitResponse> {
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (input.committedSeq <= cursor.committedSeq) {
    if (input.committedSeq < cursor.committedSeq) {
      return {
        committed: false,
        cursor: projectHostedExecutionCursorRecord(cursor),
      };
    }
  }

  const nextSnapshotRef: Prisma.InputJsonValue | typeof Prisma.DbNull = input.snapshotRef === undefined
    ? cursor.snapshotRef === null
      ? Prisma.DbNull
      : cursor.snapshotRef as Prisma.InputJsonValue
    : input.snapshotRef ?? Prisma.DbNull;
  const nextSnapshotJson = nextSnapshotRef === Prisma.DbNull ? null : nextSnapshotRef;
  const snapshotRefChanged = input.snapshotRef !== undefined
    && JSON.stringify(cursor.snapshotRef ?? null) !== JSON.stringify(nextSnapshotJson);
  const shouldAdvanceCommittedSeq = input.committedSeq > cursor.committedSeq;

  if (!shouldAdvanceCommittedSeq && !snapshotRefChanged) {
    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
    };
  }

  const updated = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      userId: input.userId,
      version: input.expectedVersion,
      ...(shouldAdvanceCommittedSeq
        ? {
            committedSeq: cursor.committedSeq,
            nextSeq: {
              gt: input.committedSeq,
            },
          }
        : {
            committedSeq: cursor.committedSeq,
          }),
    },
    data: {
      committedSeq: shouldAdvanceCommittedSeq ? input.committedSeq : cursor.committedSeq,
      snapshotRef: nextSnapshotRef,
      version: {
        increment: 1,
      },
    },
  });
  const current = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  return {
    committed: updated.count === 1,
    cursor: projectHostedExecutionCursorRecord(current),
  };
}

export async function quarantineHostedWakeTx(input: {
  quarantineCode: string;
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
}): Promise<boolean> {
  if (!input.quarantineCode.trim()) {
    throw new TypeError("quarantineCode must not be blank.");
  }

  const updated = await input.tx.hostedWake.updateMany({
    where: {
      id: input.wakeId,
      quarantinedAt: null,
      userId: input.userId,
    },
    data: {
      quarantineCode: input.quarantineCode.trim(),
      quarantinedAt: new Date(),
    },
  });

  return updated.count === 1;
}

export async function findHostedWakeEventIdByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
}): Promise<string | null> {
  const row = await findHostedWakeByEventIdTx(input);

  if (!row) {
    return null;
  }

  return resolveHostedWakeEventId(row);
}

export async function readHostedWakeLifecycleByDedupeKeyTx(input: {
  dedupeKey: string;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeLifecycleRecord | null> {
  const row = await findHostedWakeByDedupeKeyTx({
    dedupeKey: input.dedupeKey,
    tx: input.tx,
  });

  if (!row) {
    return null;
  }

  return {
    eventId: row.dedupeKey ?? row.id,
    state: await resolveHostedWakeLifecycleStateTx({
      record: row,
      tx: input.tx,
    }),
  };
}

export async function readHostedWakeScheduleByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
}): Promise<{
  eventId: string;
  seq: string;
  userId: string;
} | null> {
  const row = await findHostedWakeByEventIdTx(input);

  if (!row) {
    return null;
  }

  return {
    eventId: resolveHostedWakeEventId(row),
    seq: row.seq.toString(),
    userId: row.userId,
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

  return {
    eventId: resolveHostedWakeEventId(wake),
    state: await resolveHostedWakeLifecycleStateTx({
      record: wake,
      tx: prisma,
    }),
  };
}

export async function listHostedWakeRepairCandidates(input: {
  limit?: number;
  olderThan: Date;
  prisma?: HostedWakeStoreClient;
}): Promise<HostedWakeRepairCandidate[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.$queryRaw<Array<{
    committed_seq: bigint;
    next_seq: bigint;
    pending_wake_count: bigint;
    target_seq_hint: bigint;
    user_id: string;
  }>>`
    SELECT committed_seq,
           next_seq,
           GREATEST(next_seq - committed_seq - 1, 0) AS pending_wake_count,
           next_seq - 1 AS target_seq_hint,
           user_id
    FROM hosted_execution_cursor
    WHERE next_seq > committed_seq + 1
      AND updated_at < ${input.olderThan}
    ORDER BY updated_at ASC
    LIMIT ${Math.max(1, input.limit ?? 128)}
  `;

  return rows.map((row) => ({
    committedSeq: row.committed_seq.toString(),
    nextSeq: row.next_seq.toString(),
    pendingWakeCount: Number(row.pending_wake_count),
    targetSeqHint: row.target_seq_hint.toString(),
    userId: row.user_id,
  }));
}
