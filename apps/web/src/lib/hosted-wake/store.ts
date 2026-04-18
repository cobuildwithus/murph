import { randomUUID } from "node:crypto";

import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type {
  HostedExecutionCursorState,
  HostedExecutionDispatchLifecycleState,
  HostedWakeBehavior,
  HostedWakeCommitResponse,
  HostedWakeFetchResponse,
  HostedWakeRecord,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import {
  decodeHostedWakeStoredPayload,
  encodeHostedWakeStoredPayload,
} from "./payload";

type HostedWakeStoreClient = PrismaClient | Prisma.TransactionClient;
type HostedWakeMutationTx = Prisma.TransactionClient;

interface HostedExecutionCursorRow {
  committedSeq: bigint;
  createdAt: Date;
  nextSeq: bigint;
  snapshotRef: Prisma.JsonValue | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
}

function requireOccurredAtDate(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted wake occurredAt must be a valid ISO-8601 timestamp.");
  }

  return parsed;
}

interface HostedWakeRow {
  behavior: HostedWakeBehavior;
  coalescingKey: string | null;
  createdAt: Date;
  dedupeKey: string | null;
  id: string;
  kind: string;
  occurredAt: Date;
  payloadBytes: number | null;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadSchema: string;
  quarantineCode: string | null;
  quarantinedAt: Date | null;
  seq: bigint;
  updatedAt: Date;
  userId: string;
}

interface HostedWakePayloadRow {
  createdAt: Date;
  payloadBytes: number;
  payloadCiphertext: string;
  payloadSchema: string;
  updatedAt: Date;
  userId: string;
  wakeId: string;
}

export interface AppendHostedWakeInput {
  behavior: HostedWakeBehavior;
  coalescingKey?: string | null;
  dedupeKey?: string | null;
  kind: string;
  occurredAt: string;
  payload: unknown;
  payloadSchema: string;
  tx: HostedWakeMutationTx;
  userId: string;
}

export interface AppendHostedWakeResult {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: HostedWakeRecord;
}

export interface HostedWakeLifecycleRecord {
  eventId: string;
  state: HostedExecutionDispatchLifecycleState;
}

export interface HostedWakeRepairCandidate {
  committedSeq: string;
  nextSeq: string;
  pendingWakeCount: number;
  targetSeqHint: string;
  userId: string;
}

export interface ListHostedWakesInput {
  afterSeq?: bigint | null;
  limit?: number;
  prisma?: HostedWakeStoreClient;
  userId: string;
}

export async function appendHostedOrderedWakeTx(
  input: Omit<AppendHostedWakeInput, "behavior">,
): Promise<AppendHostedWakeResult> {
  return appendHostedWakeTx({
    ...input,
    behavior: "ordered",
  });
}

export async function appendHostedCoalescingWakeTx(
  input: Omit<AppendHostedWakeInput, "behavior"> & {
    coalescingKey: string;
  },
): Promise<AppendHostedWakeResult> {
  return appendHostedWakeTx({
    ...input,
    behavior: "coalescing",
  });
}

export async function appendHostedEdgeTriggeredWakeTx(
  input: Omit<AppendHostedWakeInput, "behavior"> & {
    coalescingKey: string;
  },
): Promise<AppendHostedWakeResult> {
  return appendHostedWakeTx({
    ...input,
    behavior: "edge_triggered",
  });
}

export async function appendHostedWakeTx(
  input: AppendHostedWakeInput,
): Promise<AppendHostedWakeResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);

  await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (input.dedupeKey) {
    const existingDuplicate = await findHostedWakeByDedupeKeyTx({
      dedupeKey: input.dedupeKey,
      tx: input.tx,
    });

    if (existingDuplicate) {
      assertHostedWakeUserMatch(existingDuplicate, input.userId, input.dedupeKey);
      return {
        duplicate: true,
        inserted: false,
        updatedExisting: false,
        wake: await hydrateHostedWakeRecordTx({
          record: existingDuplicate,
          tx: input.tx,
        }),
      };
    }
  }

  if (input.behavior === "coalescing") {
    const unresolved = await findUncommittedWakeByCoalescingKeyTx({
      coalescingKey: input.coalescingKey ?? null,
      tx: input.tx,
      userId: input.userId,
    });

    if (unresolved) {
      if (input.dedupeKey && unresolved.dedupeKey === input.dedupeKey) {
        return {
          duplicate: true,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedWakeRecordTx({
            record: unresolved,
            tx: input.tx,
          }),
        };
      }

      if (occurredAt.getTime() < unresolved.occurredAt.getTime()) {
        return {
          duplicate: false,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedWakeRecordTx({
            record: unresolved,
            tx: input.tx,
          }),
        };
      }

      const encodedPayload = encodeHostedWakeStoredPayload({
        userId: input.userId,
        value: input.payload,
      });
      await writeHostedWakePayloadStorageTx({
        payload: encodedPayload,
        payloadSchema: input.payloadSchema,
        tx: input.tx,
        userId: input.userId,
        wakeId: unresolved.id,
      });
      const updated = await input.tx.hostedWake.update({
        where: {
          id: unresolved.id,
        },
        data: {
          dedupeKey: input.dedupeKey ?? null,
          kind: input.kind,
          occurredAt,
          payloadBytes: encodedPayload.payloadBytes,
          payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
          payloadRef: encodedPayload.storage === "ref" ? unresolved.id : null,
          payloadSchema: input.payloadSchema,
          quarantineCode: null,
          quarantinedAt: null,
        },
      });

      return {
        duplicate: false,
        inserted: false,
        updatedExisting: true,
        wake: await hydrateHostedWakeRecordTx({
          record: updated,
          tx: input.tx,
        }),
      };
    }
  }

  if (input.behavior === "edge_triggered") {
    const unresolved = await findUncommittedWakeByCoalescingKeyTx({
      coalescingKey: input.coalescingKey ?? null,
      tx: input.tx,
      userId: input.userId,
    });

    if (unresolved) {
      return {
        duplicate: false,
        inserted: false,
        updatedExisting: false,
        wake: await hydrateHostedWakeRecordTx({
          record: unresolved,
          tx: input.tx,
        }),
      };
    }
  }

  return createHostedWakeTx({
    ...input,
    occurredAt: occurredAt.toISOString(),
  });
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

export async function ensureHostedExecutionCursorRowTx(input: {
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedExecutionCursorRow> {
  return input.tx.hostedExecutionCursor.upsert({
    where: {
      userId: input.userId,
    },
    create: {
      userId: input.userId,
    },
    update: {},
  });
}

async function resolveHostedWakeLifecycleStateTx(input: {
  record: HostedWakeRow;
  tx: HostedWakeStoreClient;
}): Promise<HostedExecutionDispatchLifecycleState> {
  if (input.record.quarantinedAt) {
    return "poisoned";
  }

  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.record.userId,
  });

  return input.record.seq > cursor.committedSeq ? "queued" : "completed";
}

export function projectHostedExecutionCursorRecord(
  record: HostedExecutionCursorRow,
): HostedExecutionCursorState {
  return {
    committedSeq: record.committedSeq.toString(),
    createdAt: record.createdAt.toISOString(),
    nextSeq: record.nextSeq.toString(),
    snapshotRef: record.snapshotRef,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    version: record.version.toString(),
  };
}

export function projectHostedWakeRecord(
  record: HostedWakeRow,
  payloadJson: unknown | null = null,
): HostedWakeRecord {
  return {
    behavior: record.behavior,
    coalescingKey: record.coalescingKey,
    createdAt: record.createdAt.toISOString(),
    dedupeKey: record.dedupeKey,
    id: record.id,
    kind: record.kind,
    occurredAt: record.occurredAt.toISOString(),
    ...(payloadJson === null ? {} : { payloadJson }),
    payloadSchema: record.payloadSchema,
    quarantineCode: record.quarantineCode,
    quarantinedAt: record.quarantinedAt?.toISOString() ?? null,
    seq: record.seq.toString(),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  };
}

async function hydrateHostedWakeRecordTx(input: {
  record: HostedWakeRow;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRecord> {
  if (input.record.quarantinedAt) {
    return projectHostedWakeRecord(input.record);
  }

  const payloadJson = await resolveHostedWakePayloadJson(input.record, input.tx);
  return projectHostedWakeRecord(input.record, payloadJson);
}

async function hydrateHostedWakeRecordsTx(input: {
  records: HostedWakeRow[];
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRecord[]> {
  if (input.records.length === 0) {
    return [];
  }

  const payloadRowsByWakeId = await readHostedWakePayloadRowsByWakeIdTx({
    tx: input.tx,
    userId: input.records[0].userId,
    wakeIds: input.records
      .filter((record) => record.quarantinedAt === null)
      .map((record) => record.payloadRef)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  });

  return input.records.map((record) => {
    if (record.quarantinedAt) {
      return projectHostedWakeRecord(record);
    }

    const payloadJson = resolveHostedWakePayloadJsonSync(
      record,
      payloadRowsByWakeId.get(record.payloadRef ?? "") ?? null,
    );
    return projectHostedWakeRecord(record, payloadJson);
  });
}


async function createHostedWakeTx(
  input: AppendHostedWakeInput,
): Promise<AppendHostedWakeResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);
  const encodedPayload = encodeHostedWakeStoredPayload({
    userId: input.userId,
    value: input.payload,
  });
  const seq = await allocateHostedWakeSeqTx({
    tx: input.tx,
    userId: input.userId,
  });
  const wakeId = randomUUID();

  try {
    const wake = await input.tx.hostedWake.create({
      data: {
        behavior: input.behavior,
        coalescingKey: input.coalescingKey ?? null,
        dedupeKey: input.dedupeKey ?? null,
        id: wakeId,
        kind: input.kind,
        occurredAt,
        payloadBytes: encodedPayload.payloadBytes,
        payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
        payloadRef: encodedPayload.storage === "ref" ? wakeId : null,
        payloadSchema: input.payloadSchema,
        seq,
        userId: input.userId,
      },
    });
    await writeHostedWakePayloadStorageTx({
      payload: encodedPayload,
      payloadSchema: input.payloadSchema,
      tx: input.tx,
      userId: input.userId,
      wakeId,
    });

    return {
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: await hydrateHostedWakeRecordTx({
        record: wake,
        tx: input.tx,
      }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
      && input.dedupeKey
    ) {
      const existing = await findHostedWakeByDedupeKeyTx({
        dedupeKey: input.dedupeKey,
        tx: input.tx,
      });

      if (existing) {
        assertHostedWakeUserMatch(existing, input.userId, input.dedupeKey);
        return {
          duplicate: true,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedWakeRecordTx({
            record: existing,
            tx: input.tx,
          }),
        };
      }
    }

    throw error;
  }
}

async function writeHostedWakePayloadStorageTx(input: {
  payload: ReturnType<typeof encodeHostedWakeStoredPayload>;
  payloadSchema: string;
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
}): Promise<void> {
  if (input.payload.storage === "inline") {
    await input.tx.hostedWakePayload.deleteMany({
      where: {
        wakeId: input.wakeId,
      },
    });
    return;
  }

  if (!input.payload.payloadRefCiphertext) {
    throw new TypeError("Hosted wake payload spill storage requires ciphertext.");
  }

  await input.tx.hostedWakePayload.upsert({
    where: {
      wakeId: input.wakeId,
    },
    create: {
      payloadBytes: input.payload.payloadBytes,
      payloadCiphertext: input.payload.payloadRefCiphertext,
      payloadSchema: input.payloadSchema,
      userId: input.userId,
      wakeId: input.wakeId,
    },
    update: {
      payloadBytes: input.payload.payloadBytes,
      payloadCiphertext: input.payload.payloadRefCiphertext,
      payloadSchema: input.payloadSchema,
      userId: input.userId,
    },
  });
}

async function resolveHostedWakePayloadJson(
  record: HostedWakeRow,
  tx: HostedWakeStoreClient,
): Promise<unknown | null> {
  if (record.payloadInlineCiphertext) {
    return resolveHostedWakePayloadJsonSync(record, null);
  }

  if (!record.payloadRef) {
    return null;
  }

  const payloadRow = await tx.hostedWakePayload.findUnique({
    where: {
      wakeId: record.payloadRef,
    },
  });

  return resolveHostedWakePayloadJsonSync(record, payloadRow);
}

function resolveHostedWakePayloadJsonSync(
  record: HostedWakeRow,
  payloadRow: HostedWakePayloadRow | null,
): unknown | null {
  if (record.payloadInlineCiphertext) {
    return decodeHostedWakeStoredPayload({
      payloadInlineCiphertext: record.payloadInlineCiphertext,
      userId: record.userId,
    });
  }

  if (!record.payloadRef || !payloadRow || payloadRow.userId !== record.userId) {
    return null;
  }

  return decodeHostedWakeStoredPayload({
    payloadRefCiphertext: payloadRow.payloadCiphertext,
    userId: record.userId,
  });
}

async function readHostedWakePayloadRowsByWakeIdTx(input: {
  tx: HostedWakeStoreClient;
  userId: string;
  wakeIds: string[];
}): Promise<Map<string, HostedWakePayloadRow>> {
  if (input.wakeIds.length === 0) {
    return new Map();
  }

  const rows = await input.tx.hostedWakePayload.findMany({
    where: {
      userId: input.userId,
      wakeId: {
        in: input.wakeIds,
      },
    },
  });

  return new Map(rows.map((row) => [row.wakeId, row]));
}

async function lockHostedExecutionCursorRowTx(input: {
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<void> {
  const rows = await input.tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id
    FROM hosted_execution_cursor
    WHERE user_id = ${input.userId}
    FOR UPDATE
  `;

  if (rows.length !== 1) {
    throw new Error(`Hosted execution cursor lock failed for ${input.userId}.`);
  }
}

async function allocateHostedWakeSeqTx(input: {
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<bigint> {
  const rows = await input.tx.$queryRaw<Array<{ seq: bigint }>>`
    UPDATE hosted_execution_cursor
    SET next_seq = next_seq + 1,
        updated_at = NOW()
    WHERE user_id = ${input.userId}
    RETURNING next_seq - 1 AS seq
  `;

  if (rows.length !== 1) {
    throw new Error(`Hosted execution cursor allocation failed for ${input.userId}.`);
  }

  return rows[0].seq;
}

async function findHostedWakeByDedupeKeyTx(input: {
  dedupeKey: string | null;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRow | null> {
  if (!input.dedupeKey) {
    return null;
  }

  return input.tx.hostedWake.findUnique({
    where: {
      dedupeKey: input.dedupeKey,
    },
  });
}

async function findHostedWakeByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRow | null> {
  if (!input.eventId.trim()) {
    return null;
  }

  const rows = await input.tx.hostedWake.findMany({
    where: {
      dedupeKey: {
        endsWith: `:${input.eventId}`,
        startsWith: "dispatch:",
      },
    },
  });

  return rows.find((row) => resolveHostedWakeEventId(row) === input.eventId) ?? null;
}

async function findUncommittedWakeByCoalescingKeyTx(input: {
  coalescingKey: string | null;
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<HostedWakeRow | null> {
  if (!input.coalescingKey) {
    return null;
  }

  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  return input.tx.hostedWake.findFirst({
    where: {
      coalescingKey: input.coalescingKey,
      quarantinedAt: null,
      seq: {
        gt: cursor.committedSeq,
      },
      userId: input.userId,
    },
    orderBy: {
      seq: "desc",
    },
  });
}

function assertHostedWakeUserMatch(
  wake: HostedWakeRow,
  userId: string,
  dedupeKey: string,
): void {
  if (wake.userId === userId) {
    return;
  }

  throw new Error(
    `Hosted wake dedupe key ${JSON.stringify(dedupeKey)} is already owned by ${wake.userId}, not ${userId}.`,
  );
}

function resolveHostedWakeEventId(
  wake: Pick<HostedWakeRow, "dedupeKey" | "id" | "kind">,
): string {
  if (wake.dedupeKey) {
    const dispatchPrefix = `dispatch:${wake.kind}:`;

    if (wake.dedupeKey.startsWith(dispatchPrefix)) {
      return wake.dedupeKey.slice(dispatchPrefix.length);
    }

    return wake.dedupeKey;
  }

  return wake.id;
}
