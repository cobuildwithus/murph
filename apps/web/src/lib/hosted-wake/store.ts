import { Prisma } from "@prisma/client";
import type {
  HostedExecutionCursorState,
  HostedWakeCommitResponse,
  HostedWakeFetchResponse,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRowTx,
  findCurrentHostedWakeEventByWakeIdTx,
  findHostedWakeEventByEventIdTx,
  resolveHostedWakeEventId,
} from "./store-data";
import {
  hydrateHostedWakeRecordsTx,
  projectHostedExecutionCursorRecord,
  resolveHostedWakeLifecycleStateTx,
} from "./store-projections";
import {
  issueHostedWakeFetchProof,
  verifyHostedWakeFetchProof,
} from "./commit-proof";
import type {
  HostedWakeEventRow,
  HostedWakeLifecycleRecord,
  HostedWakeMutationTx,
  HostedWakeRepairCandidate,
  HostedWakeRow,
  HostedWakeStoreClient,
  HostedWakeTerminalRow,
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
    wakes: (await hydrateHostedWakeRecordsTx({
      records: wakes,
      tx: prisma,
    })).map((wake) => ({
      ...wake,
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: cursor.committedSeq,
        userId: wake.userId,
        wakeId: wake.id,
        wakeSeq: BigInt(wake.seq),
      }),
    })),
  };
}

export async function recordHostedWakeTerminalTx(input: {
  fetchProof: string;
  state: "completed" | "replaced";
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}): Promise<boolean> {
  const claims = verifyHostedWakeFetchProof({
    proof: input.fetchProof,
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  });
  const wake = await input.tx.hostedWake.findFirst({
    where: {
      id: input.wakeId,
      seq: input.wakeSeq,
      userId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!wake) {
    return false;
  }

  const existing = await input.tx.hostedWakeTerminal.findUnique({
    where: {
      wakeId: input.wakeId,
    },
  });

  if (!existing) {
    await input.tx.hostedWakeTerminal.create({
      data: {
        fetchedCommittedSeq: BigInt(claims.fetchedCommittedSeq),
        state: input.state,
        userId: input.userId,
        wakeId: input.wakeId,
        wakeSeq: input.wakeSeq,
      },
    });
    return true;
  }

  if (
    existing.userId !== input.userId
    || existing.wakeSeq !== input.wakeSeq
    || existing.state !== input.state
  ) {
    throw new TypeError("Hosted wake terminal receipt conflicts with the existing canonical record.");
  }

  return true;
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
  const canAdvanceSingleWake = shouldAdvanceCommittedSeq
    && input.committedSeq === cursor.committedSeq + 1n
    && input.committedSeq < cursor.nextSeq;

  if (!shouldAdvanceCommittedSeq && !snapshotRefChanged) {
    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
    };
  }

  if (shouldAdvanceCommittedSeq && !canAdvanceSingleWake) {
    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
    };
  }

  if (shouldAdvanceCommittedSeq) {
    const wake = await input.tx.hostedWake.findFirst({
      where: {
        seq: input.committedSeq,
        userId: input.userId,
      },
      select: {
        id: true,
        quarantinedAt: true,
      },
    });

    if (!wake) {
      return {
        committed: false,
        cursor: projectHostedExecutionCursorRecord(cursor),
      };
    }

    if (!wake.quarantinedAt) {
      const receipt = await input.tx.hostedWakeTerminal.findUnique({
        where: {
          wakeId: wake.id,
        },
      });

      if (!isTerminalHostedWakeReceipt(receipt, {
        userId: input.userId,
        wakeId: wake.id,
        wakeSeq: input.committedSeq,
      })) {
        return {
          committed: false,
          cursor: projectHostedExecutionCursorRecord(cursor),
        };
      }
    }
  }

  const updated = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      userId: input.userId,
      version: input.expectedVersion,
      ...(shouldAdvanceCommittedSeq
        ? {
            committedSeq: cursor.committedSeq,
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

function isTerminalHostedWakeReceipt(
  receipt: HostedWakeTerminalRow | null,
  input: {
    userId: string;
    wakeId: string;
    wakeSeq: bigint;
  },
): boolean {
  return Boolean(
    receipt
      && receipt.userId === input.userId
      && receipt.wakeId === input.wakeId
      && receipt.wakeSeq === input.wakeSeq
      && (receipt.state === "completed" || receipt.state === "replaced"),
  );
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
  userId?: string;
}): Promise<string | null> {
  const event = await findHostedWakeEventByEventIdTx(input);

  if (!event) {
    return null;
  }

  return event.eventId;
}

export async function readHostedWakeLifecycleByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<HostedWakeLifecycleRecord | null> {
  const resolved = await resolveHostedWakeEventResolutionTx(input);

  if (!resolved) {
    return null;
  }

  if (resolved.event.replacedByEventId) {
    return {
      eventId: resolved.event.eventId,
      replacedByEventId: resolved.event.replacedByEventId,
      state: "replaced",
    };
  }

  return {
    eventId: resolved.activeEvent.eventId,
    state: await resolveHostedWakeLifecycleStateTx({
      record: resolved.wake,
      tx: input.tx,
    }),
  };
}

export async function readHostedWakeLifecycleByDedupeKeyTx(input: {
  dedupeKey: string;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<HostedWakeLifecycleRecord | null> {
  return readHostedWakeLifecycleByEventIdTx({
    eventId: input.dedupeKey,
    tx: input.tx,
    ...(input.userId ? { userId: input.userId } : {}),
  });
}

export async function readHostedWakeScheduleByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<{
  eventId: string;
  seq: string;
  userId: string;
} | null> {
  const resolved = await resolveHostedWakeEventResolutionTx(input);

  if (!resolved) {
    return null;
  }

  if (resolved.event.replacedByEventId) {
    return null;
  }

  return {
    eventId: resolved.activeEvent.eventId,
    seq: resolved.wake.seq.toString(),
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

  return {
    eventId: await resolveHostedWakeCurrentEventIdTx({
      tx: prisma,
      wake,
    }),
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

async function resolveHostedWakeEventResolutionTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<{
  activeEvent: HostedWakeEventRow;
  event: HostedWakeEventRow;
  wake: HostedWakeRow;
} | null> {
  const event = await findHostedWakeEventByEventIdTx(input);

  if (!event) {
    return null;
  }

  const activeEvent = await resolveHostedWakeActiveEventTx({
    event,
    tx: input.tx,
    ...(input.userId ? { userId: input.userId } : {}),
  });
  const wake = await input.tx.hostedWake.findUnique({
    where: {
      id: activeEvent.wakeId,
    },
  });

  if (!wake) {
    throw new Error(`Hosted wake ${activeEvent.wakeId} missing for event ${activeEvent.eventId}.`);
  }

  return {
    activeEvent,
    event,
    wake,
  };
}

async function resolveHostedWakeActiveEventTx(input: {
  event: HostedWakeEventRow;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<HostedWakeEventRow> {
  const seen = new Set<string>();
  let current = input.event;

  while (current.replacedByEventId) {
    if (seen.has(current.eventId)) {
      throw new Error(`Hosted wake event replacement loop detected for ${current.eventId}.`);
    }
    seen.add(current.eventId);

    const replacement = await findHostedWakeEventByEventIdTx({
      eventId: current.replacedByEventId,
      tx: input.tx,
      ...(input.userId ? { userId: input.userId } : { userId: current.userId }),
    });

    if (!replacement) {
      throw new Error(
        `Hosted wake replacement event ${current.replacedByEventId} missing for ${current.eventId}.`,
      );
    }

    current = replacement;
  }

  return current;
}

async function resolveHostedWakeCurrentEventIdTx(input: {
  tx: HostedWakeStoreClient;
  wake: HostedWakeRow;
}): Promise<string> {
  const currentEvent = await findCurrentHostedWakeEventByWakeIdTx({
    tx: input.tx,
    userId: input.wake.userId,
    wakeId: input.wake.id,
  });

  return currentEvent?.eventId ?? resolveHostedWakeEventId(input.wake);
}
