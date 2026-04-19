import { Prisma } from "@prisma/client";
import type {
  HostedExecutionBundleRef,
  HostedExecutionCursorState,
  HostedWakeCommitResponse,
  HostedWakeFetchResponse,
  HostedWakeSnapshotRef,
  HostedWakeTerminalState,
} from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionCursorSnapshotRef } from "@murphai/hosted-execution/parsers";

import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRowTx,
  findCurrentHostedWakeEventByWakeIdTx,
  findHostedWakeEventByEventIdTx,
  lockHostedExecutionCursorRowTx,
  resolveHostedWakeEventId,
} from "./store-data";
import {
  hydrateHostedWakeRecordsTx,
  isCurrentHostedWakeTerminalReceipt,
  projectHostedExecutionCursorRecord,
  resolveHostedWakeLifecycleStateTx,
} from "./store-projections";
import {
  issueHostedWakeFetchProof,
  verifyHostedWakeFetchProof,
} from "./fetch-proof";
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

export async function countPendingHostedWakes(input: {
  prisma?: HostedWakeStoreClient;
  userId: string;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: prisma,
    userId: input.userId,
  });
  const wakes = await prisma.hostedWake.findMany({
    where: {
      seq: {
        gt: cursor.committedSeq,
      },
      userId: input.userId,
    },
    select: {
      id: true,
      quarantinedAt: true,
      seq: true,
      userId: true,
    },
  });

  if (wakes.length === 0) {
    return 0;
  }

  const terminals = await prisma.hostedWakeTerminal.findMany({
    where: {
      userId: input.userId,
      wakeId: {
        in: wakes.map((wake) => wake.id),
      },
    },
    select: {
      fetchedCommittedSeq: true,
      fetchedCursorVersion: true,
      state: true,
      userId: true,
      wakeId: true,
      wakeSeq: true,
    },
  });
  const wakesById = new Map(wakes.map((wake) => [wake.id, wake] as const));
  const terminalWakeIds = new Set(
    terminals
      .filter((terminal) => {
        const wake = wakesById.get(terminal.wakeId);
        const receipt = {
          ...terminal,
          state: parseHostedWakeTerminalState(terminal.state),
        };
        return Boolean(
          wake
            && receipt.state === "completed"
            && isCurrentHostedWakeTerminalReceipt({
              cursor,
              receipt,
              wake,
            }),
        );
      })
      .map((terminal) => terminal.wakeId),
  );

  return wakes.filter((wake) => !wake.quarantinedAt && !terminalWakeIds.has(wake.id)).length;
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
    wakes: await Promise.all((await hydrateHostedWakeRecordsTx({
      records: wakes,
      tx: prisma,
    })).map(async (wake) => ({
      ...wake,
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: cursor.committedSeq,
        fetchedCursorVersion: cursor.version,
        userId: wake.userId,
        wakeEventId: await resolveHostedWakeCurrentEventIdTx({
          tx: prisma,
          wake: {
            dedupeKey: wake.dedupeKey ?? null,
            id: wake.id,
            seq: BigInt(wake.seq),
            userId: wake.userId,
          },
        }),
        wakeId: wake.id,
        wakeSeq: BigInt(wake.seq),
      }),
    }))),
  };
}

export async function recordHostedWakeTerminalTx(input: {
  fetchProof: string;
  state: "completed" | "quarantined";
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
  await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  const fetchFence = parseHostedWakeFetchFence(claims);

  assertCurrentHostedWakeFetchFence(cursor, fetchFence);
  const wake = await readCurrentHostedWakeTerminalTargetTx({
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  });

  if (!wake) {
    return false;
  }

  assertCurrentHostedWakeFetchIdentity(claims, wake.currentEventId);

  if (input.state === "quarantined" && wake.quarantinedAt === null) {
    return false;
  }

  await upsertHostedWakeTerminalTx({
    fetchedCommittedSeq: fetchFence.fetchedCommittedSeq,
    fetchedCursorVersion: fetchFence.fetchedCursorVersion,
    state: input.state,
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  });

  return true;
}

export async function commitHostedExecutionCursorTx(input: {
  committedSeq: bigint;
  expectedVersion: bigint;
  snapshotRef?: HostedWakeSnapshotRef;
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

  let nextSnapshotRef: Prisma.InputJsonObject | typeof Prisma.DbNull;
  if (input.snapshotRef === undefined) {
    if (cursor.snapshotRef === null) {
      nextSnapshotRef = Prisma.DbNull;
    } else {
      const currentSnapshotRef = parseHostedExecutionCursorSnapshotRef(
        cursor.snapshotRef,
        "Hosted execution cursor snapshotRef",
      );
      if (currentSnapshotRef === null) {
        throw new Error("Hosted execution cursor snapshotRef must be present when stored.");
      }
      nextSnapshotRef = serializeHostedWakeSnapshotRef(currentSnapshotRef);
    }
  } else if (input.snapshotRef === null) {
    nextSnapshotRef = Prisma.DbNull;
  } else {
    nextSnapshotRef = serializeHostedWakeSnapshotRef(input.snapshotRef);
  }
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
      },
    });

    if (!wake) {
      return {
        committed: false,
        cursor: projectHostedExecutionCursorRecord(cursor),
      };
    }

    const receipt = await input.tx.hostedWakeTerminal.findUnique({
      where: {
        wakeId: wake.id,
      },
    });
    const currentReceipt = {
      cursor,
      receipt: receipt === null ? null : {
        ...receipt,
        state: parseHostedWakeTerminalState(receipt.state),
      },
      wake: {
        id: wake.id,
        seq: input.committedSeq,
        userId: input.userId,
      },
    };

    if (!isCurrentHostedWakeTerminalReceipt(currentReceipt)) {
      return {
        committed: false,
        cursor: projectHostedExecutionCursorRecord(cursor),
      };
    }

    if (
      currentReceipt.receipt.state !== "completed"
      && currentReceipt.receipt.state !== "quarantined"
    ) {
      return {
        committed: false,
        cursor: projectHostedExecutionCursorRecord(cursor),
      };
    }
  }

  const updated = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      userId: input.userId,
      version: input.expectedVersion,
      committedSeq: cursor.committedSeq,
    },
    data: {
      committedSeq: input.committedSeq,
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

function serializeHostedWakeSnapshotRef(
  snapshotRef: HostedExecutionBundleRef,
): Prisma.InputJsonObject {
  return {
    hash: snapshotRef.hash,
    key: snapshotRef.key,
    size: snapshotRef.size,
    updatedAt: snapshotRef.updatedAt,
  };
}

function shouldRefreshTerminalFetchFence(
  receipt: HostedWakeTerminalRow,
  input: {
    fetchedCommittedSeq: bigint;
    fetchedCursorVersion: bigint;
  },
): boolean {
  return receipt.fetchedCursorVersion < input.fetchedCursorVersion
    || (
      receipt.fetchedCursorVersion === input.fetchedCursorVersion
      && receipt.fetchedCommittedSeq < input.fetchedCommittedSeq
    );
}

export async function quarantineHostedWakeTx(input: {
  fetchProof: string;
  quarantineCode: string;
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}): Promise<boolean> {
  if (!input.quarantineCode.trim()) {
    throw new TypeError("quarantineCode must not be blank.");
  }

  const claims = verifyHostedWakeFetchProof({
    proof: input.fetchProof,
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  });
  await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  const fetchFence = parseHostedWakeFetchFence(claims);

  assertCurrentHostedWakeFetchFence(cursor, fetchFence);
  const wake = await readCurrentHostedWakeTerminalTargetTx({
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  });

  if (!wake) {
    return false;
  }

  assertCurrentHostedWakeFetchIdentity(claims, wake.currentEventId);

  const updated = await input.tx.hostedWake.updateMany({
    where: {
      id: input.wakeId,
      seq: input.wakeSeq,
      quarantinedAt: null,
      userId: input.userId,
    },
    data: {
      quarantineCode: input.quarantineCode.trim(),
      quarantinedAt: new Date(),
    },
  });

  if (updated.count !== 1) {
    return false;
  }

  await upsertHostedWakeTerminalTx({
    fetchedCommittedSeq: fetchFence.fetchedCommittedSeq,
    fetchedCursorVersion: fetchFence.fetchedCursorVersion,
    state: "quarantined",
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  });

  return true;
}

export async function findHostedWakeEventIdByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId: string;
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
  userId: string;
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
  userId: string;
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
    userId: input.userId,
  });
  const wake = await input.tx.hostedWake.findUnique({
    where: {
      id: activeEvent.wakeId,
    },
  });

  if (!wake) {
    throw new Error(`Hosted wake ${activeEvent.wakeId} missing for event ${activeEvent.eventId}.`);
  }

  if (wake.userId !== input.userId) {
    return null;
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
  userId: string;
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
      userId: input.userId,
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
  wake: Pick<HostedWakeRow, "dedupeKey" | "id" | "seq" | "userId">;
}): Promise<string> {
  const currentEvent = await findCurrentHostedWakeEventByWakeIdTx({
    tx: input.tx,
    userId: input.wake.userId,
    wakeId: input.wake.id,
  });

  return currentEvent?.eventId ?? resolveHostedWakeEventId(input.wake);
}

function parseHostedWakeFetchFence(
  claims: ReturnType<typeof verifyHostedWakeFetchProof>,
): {
  fetchedCommittedSeq: bigint;
  fetchedCursorVersion: bigint;
} {
  return {
    fetchedCommittedSeq: BigInt(claims.fetchedCommittedSeq),
    fetchedCursorVersion: BigInt(claims.fetchedCursorVersion),
  };
}

function assertCurrentHostedWakeFetchFence(
  cursor: {
    committedSeq: bigint;
    version: bigint;
  },
  input: {
    fetchedCommittedSeq: bigint;
    fetchedCursorVersion: bigint;
  },
): void {
  if (
    cursor.committedSeq !== input.fetchedCommittedSeq
    || cursor.version !== input.fetchedCursorVersion
  ) {
    throw new TypeError("Hosted wake fetch proof is stale for the current cursor.");
  }
}

async function upsertHostedWakeTerminalTx(input: {
  fetchedCommittedSeq: bigint;
  fetchedCursorVersion: bigint;
  state: "completed" | "quarantined" | "replaced";
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}): Promise<void> {
  const existing = await input.tx.hostedWakeTerminal.findUnique({
    where: {
      wakeId: input.wakeId,
    },
  });
  const typedExisting = existing === null ? null : {
    ...existing,
    state: parseHostedWakeTerminalState(existing.state),
  };

  if (!typedExisting) {
    await input.tx.hostedWakeTerminal.create({
      data: {
        fetchedCommittedSeq: input.fetchedCommittedSeq,
        fetchedCursorVersion: input.fetchedCursorVersion,
        state: input.state,
        userId: input.userId,
        wakeId: input.wakeId,
        wakeSeq: input.wakeSeq,
      },
    });
    return;
  }

  if (
    typedExisting.userId !== input.userId
    || typedExisting.wakeSeq !== input.wakeSeq
    || typedExisting.state !== input.state
  ) {
    throw new TypeError("Hosted wake terminal receipt conflicts with the existing canonical record.");
  }

  if (shouldRefreshTerminalFetchFence(typedExisting, input)) {
    await input.tx.hostedWakeTerminal.update({
      where: {
        wakeId: input.wakeId,
      },
      data: {
        fetchedCommittedSeq: input.fetchedCommittedSeq,
        fetchedCursorVersion: input.fetchedCursorVersion,
      },
    });
  }
}

async function readCurrentHostedWakeTerminalTargetTx(input: {
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}): Promise<{
  currentEventId: string;
  quarantinedAt: Date | null;
} | null> {
  const wake = await input.tx.hostedWake.findFirst({
    where: {
      id: input.wakeId,
      seq: input.wakeSeq,
      userId: input.userId,
    },
  });

  if (!wake) {
    return null;
  }

  return {
    currentEventId: await resolveHostedWakeCurrentEventIdTx({
      tx: input.tx,
      wake,
    }),
    quarantinedAt: wake.quarantinedAt,
  };
}

function assertCurrentHostedWakeFetchIdentity(
  claims: ReturnType<typeof verifyHostedWakeFetchProof>,
  currentEventId: string,
): void {
  // Rollout compatibility: older web instances minted proofs before wakeEventId existed.
  if (claims.wakeEventId === undefined) {
    return;
  }

  if (claims.wakeEventId !== currentEventId) {
    throw new TypeError("Hosted wake fetch proof is stale for the current wake identity.");
  }
}

function parseHostedWakeTerminalState(value: string): HostedWakeTerminalState {
  switch (value) {
    case "completed":
    case "quarantined":
    case "replaced":
      return value;
    default:
      throw new TypeError(`Hosted wake terminal state is invalid: ${value}`);
  }
}
