import { randomUUID } from "node:crypto";

import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type {
  HostedExecutionCursorState,
  HostedWakeBehavior,
  HostedWakeCommitResponse,
  HostedWakeFetchResponse,
  HostedWakeRecord,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import { encodeHostedWakeInlinePayload } from "./payload";

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
  const existingDuplicate = await findHostedWakeByDedupeKeyTx({
    dedupeKey: input.dedupeKey ?? null,
    tx: input.tx,
  });

  if (existingDuplicate) {
    return {
      duplicate: true,
      inserted: false,
      updatedExisting: false,
      wake: projectHostedWakeRecord(existingDuplicate),
    };
  }

  await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

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
          wake: projectHostedWakeRecord(unresolved),
        };
      }

      if (occurredAt.getTime() < unresolved.occurredAt.getTime()) {
        return {
          duplicate: false,
          inserted: false,
          updatedExisting: false,
          wake: projectHostedWakeRecord(unresolved),
        };
      }

      const encodedPayload = encodeHostedWakeInlinePayload({
        userId: input.userId,
        value: input.payload,
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
          payloadRef: null,
          payloadSchema: input.payloadSchema,
          quarantineCode: null,
          quarantinedAt: null,
        },
      });

      return {
        duplicate: false,
        inserted: false,
        updatedExisting: true,
        wake: projectHostedWakeRecord(updated),
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
        wake: projectHostedWakeRecord(unresolved),
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
  const afterSeq = input.afterSeq ?? cursor.committedSeq;
  const wakes = await prisma.hostedWake.findMany({
    where: {
      quarantinedAt: null,
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
    wakes: wakes.map((wake) => projectHostedWakeRecord(wake)),
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

  if (input.committedSeq < cursor.committedSeq) {
    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
    };
  }

  const nextSnapshotRef: Prisma.InputJsonValue | typeof Prisma.DbNull = input.snapshotRef === undefined
    ? cursor.snapshotRef === null
      ? Prisma.DbNull
      : cursor.snapshotRef as Prisma.InputJsonValue
    : input.snapshotRef ?? Prisma.DbNull;
  const updated = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      committedSeq: {
        lte: input.committedSeq,
      },
      nextSeq: {
        gt: input.committedSeq,
      },
      userId: input.userId,
      version: input.expectedVersion,
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
): HostedWakeRecord {
  return {
    behavior: record.behavior,
    coalescingKey: record.coalescingKey,
    createdAt: record.createdAt.toISOString(),
    dedupeKey: record.dedupeKey,
    id: record.id,
    kind: record.kind,
    occurredAt: record.occurredAt.toISOString(),
    payloadBytes: record.payloadBytes,
    payloadInlineCiphertext: record.payloadInlineCiphertext,
    payloadRef: record.payloadRef,
    payloadSchema: record.payloadSchema,
    quarantineCode: record.quarantineCode,
    quarantinedAt: record.quarantinedAt?.toISOString() ?? null,
    seq: record.seq.toString(),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  };
}


async function createHostedWakeTx(
  input: AppendHostedWakeInput,
): Promise<AppendHostedWakeResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);
  const encodedPayload = encodeHostedWakeInlinePayload({
    userId: input.userId,
    value: input.payload,
  });
  const seq = await allocateHostedWakeSeqTx({
    tx: input.tx,
    userId: input.userId,
  });

  try {
    const wake = await input.tx.hostedWake.create({
      data: {
        behavior: input.behavior,
        coalescingKey: input.coalescingKey ?? null,
        dedupeKey: input.dedupeKey ?? null,
        id: randomUUID(),
        kind: input.kind,
        occurredAt,
        payloadBytes: encodedPayload.payloadBytes,
        payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
        payloadRef: null,
        payloadSchema: input.payloadSchema,
        seq,
        userId: input.userId,
      },
    });

    return {
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: projectHostedWakeRecord(wake),
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
        return {
          duplicate: true,
          inserted: false,
          updatedExisting: false,
          wake: projectHostedWakeRecord(existing),
        };
      }
    }

    throw error;
  }
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
  tx: HostedWakeMutationTx;
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
