import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  isHostedMailboxKind,
  isHostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedMailboxItem,
  HostedMailboxKind,
  HostedMailboxLane,
  HostedMailboxLaneConsumed,
  HostedMailboxLaneHighWater,
  HostedMailboxPayload,
  HostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import { recordHostedRuntimeLogTx } from "../hosted-workspace/store";
import {
  HOSTED_MAILBOX_SYSTEM_AI_USAGE_GATED_KINDS,
} from "./ai-usage-gate";
import {
  decryptHostedMailboxPayloadString,
  encryptHostedMailboxPayloadString,
  type HostedMailboxPayloadStorage,
} from "./encryption";
import { hashHostedMailboxStoredPayload } from "./fingerprint";

export {
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
};

export type HostedMailboxStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedMailboxMutationTx = Prisma.TransactionClient;

export interface HostedMailboxItemRow {
  id: string;
  userId: string;
  lane: string;
  laneSeq: bigint;
  dedupeKey: string;
  kind: string;
  occurredAt: Date;
  payloadSchema: string;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadBytes: number | null;
  payloadHash: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostedMailboxPayloadRow {
  mailboxItemId: string;
  userId: string;
  payloadCiphertext: string;
  payloadSchema: string;
  createdAt: Date;
}

export type HostedMailboxItemRecord = HostedMailboxItem;
export type HostedMailboxPayloadRecord = HostedMailboxPayload;

export interface HostedMailboxItemCheckpointRecord {
  id: string;
  lane: HostedMailboxLane;
  laneSeq: string;
  occurredAt: string;
  userId: string;
}

export interface AppendHostedMailboxItemResult {
  duplicate: boolean;
  dedupeConflict: boolean;
  inserted: boolean;
  item: HostedMailboxItemRecord;
}

export interface HostedMailboxLaneCursor {
  lane: HostedMailboxLane | string;
  afterSeq: bigint | number | string;
}

export interface FetchHostedMailboxItemsResult {
  items: HostedMailboxItemRecord[];
}

export type HostedMailboxProducerEnvelope = HostedExecutionWake;

interface AppendHostedMailboxItemBaseInput {
  dedupeKey: string;
  expiresAt?: Date | string | null;
  kind: HostedMailboxKind | string;
  lane: HostedMailboxLane | string;
  occurredAt: Date | string;
  payloadSchema?: string | null;
  payloadSerializedJson: string;
  userId: string;
}

export async function appendHostedMailboxItem(
  input: AppendHostedMailboxItemBaseInput & {
    prisma?: PrismaClient;
  },
): Promise<AppendHostedMailboxItemResult> {
  const prisma = input.prisma ?? getPrisma();

  try {
    return await prisma.$transaction((tx) => appendHostedMailboxItemTx({
      ...input,
      tx,
    }));
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      const existing = await findHostedMailboxItemByDedupeKeyTx({
        dedupeKey: input.dedupeKey,
        tx: prisma,
        userId: input.userId,
      });

      if (existing) {
        const payloadMetadata = deriveHostedMailboxStoredPayloadMetadata({
          payloadSerializedJson: input.payloadSerializedJson,
          userId: input.userId,
        });

        return {
          duplicate: true,
          dedupeConflict: hasHostedMailboxDedupeConflict({
            existing,
            kind: input.kind,
            lane: input.lane,
            payloadBytes: payloadMetadata.payloadBytes,
            payloadHash: payloadMetadata.payloadHash,
            payloadSchema: normalizeNullableString(input.payloadSchema)
              ?? HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
          }),
          inserted: false,
          item: await hydrateHostedMailboxItemTx({
            record: existing,
          }),
        };
      }
    }

    throw error;
  }
}

export async function appendHostedMailboxItemTx(
  input: AppendHostedMailboxItemBaseInput & {
    tx: HostedMailboxMutationTx;
  },
): Promise<AppendHostedMailboxItemResult> {
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const lane = requireHostedMailboxLane(input.lane);
  const dedupeKey = requireNonEmptyString(input.dedupeKey, "Hosted mailbox dedupeKey");
  const kind = requireHostedMailboxKind(input.kind);
  const occurredAt = requireDate(input.occurredAt, "Hosted mailbox occurredAt");
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null
    ? null
    : requireDate(input.expiresAt, "Hosted mailbox expiresAt");
  const payloadSchema = normalizeNullableString(input.payloadSchema)
    ?? HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA;
  const payloadMetadata = deriveHostedMailboxStoredPayloadMetadata({
    payloadSerializedJson: input.payloadSerializedJson,
    userId,
  });
  const { payloadBytes, payloadHash, serialized } = payloadMetadata;
  await acquireHostedMailboxDedupeAppendLockTx({
    dedupeKey,
    tx: input.tx,
    userId,
  });
  const existing = await findHostedMailboxItemByDedupeKeyTx({
    dedupeKey,
    tx: input.tx,
    userId,
  });

  if (existing) {
    const dedupeConflict = hasHostedMailboxDedupeConflict({
      existing,
      kind,
      lane,
      payloadBytes,
      payloadHash,
      payloadSchema,
    });
    await recordHostedMailboxDedupeConflictLogTx({
      dedupeConflict,
      existing,
      kind,
      lane,
      payloadBytes,
      payloadHash,
      payloadSchema,
      tx: input.tx,
      userId,
    });
    await recordHostedMailboxAppendLogTx({
      outcome: "duplicate",
      item: existing,
      payloadStorage: existing.payloadRef ? "ref" : "inline",
      tx: input.tx,
      userId,
    });

    return {
      duplicate: true,
      dedupeConflict,
      inserted: false,
      item: await hydrateHostedMailboxItemTx({
        record: existing,
      }),
    };
  }

  const itemId = randomUUID();
  const laneSeq = await allocateHostedMailboxLaneSeqTx({
    lane,
    tx: input.tx,
    userId,
  });
  const payloadStorage = await encryptHostedMailboxPayloadStorage({
    dedupeKey,
    itemId,
    kind,
    lane,
    laneSeq,
    occurredAt,
    payloadBytes,
    payloadSchema,
    prisma: input.tx,
    serialized,
    userId,
  });
  const inserted = await input.tx.$queryRaw<HostedMailboxItemRow[]>`
    INSERT INTO hosted_mailbox_item (
      id,
      user_id,
      lane,
      lane_seq,
      dedupe_key,
      kind,
      occurred_at,
      payload_schema,
      payload_inline_ciphertext,
      payload_ref,
      payload_bytes,
      payload_hash,
      expires_at,
      updated_at
    )
    VALUES (
      ${itemId},
      ${userId},
      ${lane},
      ${laneSeq},
      ${dedupeKey},
      ${kind},
      ${occurredAt},
      ${payloadSchema},
      ${payloadStorage.payloadInlineCiphertext},
      ${payloadStorage.payloadRef},
      ${payloadBytes},
      ${payloadHash},
      ${expiresAt},
      NOW()
    )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING
      id,
      user_id AS "userId",
      lane,
      lane_seq AS "laneSeq",
      dedupe_key AS "dedupeKey",
      kind,
      occurred_at AS "occurredAt",
      payload_schema AS "payloadSchema",
      payload_inline_ciphertext AS "payloadInlineCiphertext",
      payload_ref AS "payloadRef",
      payload_bytes AS "payloadBytes",
      payload_hash AS "payloadHash",
      expires_at AS "expiresAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  const item = inserted[0] ?? null;

  if (!item) {
    const concurrentExisting = await findHostedMailboxItemByDedupeKeyTx({
      dedupeKey,
      tx: input.tx,
      userId,
    });

    if (!concurrentExisting) {
      throw new Error("Hosted mailbox append conflict could not be resolved.");
    }

    const dedupeConflict = hasHostedMailboxDedupeConflict({
      existing: concurrentExisting,
      kind,
      lane,
      payloadBytes,
      payloadHash,
      payloadSchema,
    });
    await recordHostedMailboxDedupeConflictLogTx({
      dedupeConflict,
      existing: concurrentExisting,
      kind,
      lane,
      payloadBytes,
      payloadHash,
      payloadSchema,
      tx: input.tx,
      userId,
    });
    await recordHostedMailboxAppendLogTx({
      outcome: "duplicate",
      item: concurrentExisting,
      payloadStorage: concurrentExisting.payloadRef ? "ref" : "inline",
      tx: input.tx,
      userId,
    });

    return {
      duplicate: true,
      dedupeConflict,
      inserted: false,
      item: await hydrateHostedMailboxItemTx({
        record: concurrentExisting,
      }),
    };
  }

  if (payloadStorage.storage === "ref") {
    await input.tx.hostedMailboxPayload.create({
      data: {
        mailboxItemId: item.id,
        payloadCiphertext: payloadStorage.payloadCiphertext,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        userId,
      },
    });
  }

  await recordHostedMailboxAppendLogTx({
    outcome: "inserted",
    item,
    payloadStorage: payloadStorage.storage,
    tx: input.tx,
    userId,
  });

  return {
    duplicate: false,
    dedupeConflict: false,
    inserted: true,
    item: await hydrateHostedMailboxItemTx({
      record: item,
    }),
  };
}

export async function appendHostedMailboxEnvelopeTx(input: {
  envelope: HostedMailboxProducerEnvelope;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult> {
  const envelope = input.envelope;
  await input.tx.hostedWorkspace.upsert({
    create: {
      userId: envelope.userId,
    },
    update: {},
    where: {
      userId: envelope.userId,
    },
  });
  const encodedPayload = serializeHostedMailboxPayload(envelope);

  return appendHostedMailboxItemTx({
    dedupeKey: envelope.eventId,
    kind: envelope.kind,
    lane: resolveHostedMailboxLaneForKind(envelope.kind),
    occurredAt: envelope.occurredAt,
    payloadSerializedJson: encodedPayload.serialized,
    tx: input.tx,
    userId: envelope.userId,
  });
}

export async function fetchHostedMailboxItemsAfterLaneCursors(input: {
  lanes: readonly HostedMailboxLaneCursor[];
  limitPerLane: number;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<FetchHostedMailboxItemsResult> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const limitPerLane = normalizeHostedMailboxFetchLimit(input.limitPerLane);
  const seenLanes = new Set<HostedMailboxLane>();
  const items: HostedMailboxItemRecord[] = [];

  for (const cursor of input.lanes) {
    const lane = requireHostedMailboxLane(cursor.lane);

    if (seenLanes.has(lane)) {
      throw new TypeError(`Hosted mailbox lane ${JSON.stringify(lane)} was requested more than once.`);
    }

    seenLanes.add(lane);
    const records = await prisma.hostedMailboxItem.findMany({
      where: {
        lane,
        laneSeq: {
          gt: normalizeHostedMailboxSeq(cursor.afterSeq, "Hosted mailbox cursor afterSeq"),
        },
        userId,
      },
      orderBy: {
        laneSeq: "asc",
      },
      take: limitPerLane,
    });

    items.push(...records.map((record) => projectHostedMailboxItem(record)));
  }

  return { items };
}

export async function readHostedMailboxMaxSeqByLane(input: {
  lanes?: readonly (HostedMailboxLane | string)[];
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxLaneHighWater[]> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const seenLanes = new Set<HostedMailboxLane>();
  const result: HostedMailboxLaneHighWater[] = [];

  for (const rawLane of lanes) {
    const lane = requireHostedMailboxLane(rawLane);

    if (seenLanes.has(lane)) {
      throw new TypeError(`Hosted mailbox lane ${JSON.stringify(lane)} was requested more than once.`);
    }

    seenLanes.add(lane);

    const row = await prisma.hostedMailboxItem.findFirst({
      orderBy: {
        laneSeq: "desc",
      },
      where: {
        lane,
        userId,
      },
    });

    result.push({
      lane,
      maxSeq: row?.laneSeq.toString() ?? "0",
      maxUpdatedAt: row?.updatedAt.toISOString() ?? null,
    });
  }

  return result;
}

export async function readHostedMailboxConsumedSeqByLane(input: {
  lanes?: readonly (HostedMailboxLane | string)[];
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxLaneConsumed[]> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const result: HostedMailboxLaneConsumed[] = [];

  for (const rawLane of lanes) {
    const lane = requireHostedMailboxLane(rawLane);
    const row = await prisma.hostedMailboxLaneCounter.findUnique({
      where: {
        userId_lane: {
          lane,
          userId,
        },
      },
    });

    result.push({
      consumedSeq: row?.consumedSeq.toString() ?? "0",
      lane,
    });
  }

  return result;
}

export async function advanceHostedMailboxConsumedSeqByLane(input: {
  lanes: readonly { consumedSeq: bigint | number | string; lane: HostedMailboxLane | string }[];
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxLaneConsumed[]> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const result: HostedMailboxLaneConsumed[] = [];

  const seenLanes = new Set<HostedMailboxLane>();

  for (const entry of input.lanes) {
    const lane = requireHostedMailboxLane(entry.lane);
    if (seenLanes.has(lane)) {
      throw new TypeError(`Hosted mailbox lane ${JSON.stringify(lane)} was consumed more than once.`);
    }
    seenLanes.add(lane);
    const requestedSeq = normalizeHostedMailboxSeq(
      entry.consumedSeq,
      "Hosted mailbox consumedSeq",
    );
    // A lane that has never appended has no counter row; consuming it is a
    // no-op rather than an upsert so the watermark cannot run ahead of the
    // append counter.
    const row = await prisma.hostedMailboxLaneCounter.findUnique({
      where: {
        userId_lane: {
          lane,
          userId,
        },
      },
    });
    if (!row) {
      result.push({
        consumedSeq: "0",
        lane,
      });
      continue;
    }

    // Clamp to the lane's append high-water (appends allocate next_seq - 1):
    // a buggy or compromised runner must not be able to mark unseen future
    // messages as handled and durably suppress replies to them. Reading the
    // row first is race-safe in the conservative direction — a concurrent
    // append only raises next_seq, so a stale read clamps lower, never higher.
    const maxConsumableSeq = row.nextSeq - 1n;
    const consumedSeq = requestedSeq < maxConsumableSeq ? requestedSeq : maxConsumableSeq;
    // Monotonic max: late or replayed acks never move the watermark backwards.
    if (consumedSeq > row.consumedSeq) {
      await prisma.hostedMailboxLaneCounter.updateMany({
        data: {
          consumedSeq,
        },
        where: {
          consumedSeq: {
            lt: consumedSeq,
          },
          lane,
          userId,
        },
      });
    }
    const updated = await prisma.hostedMailboxLaneCounter.findUnique({
      where: {
        userId_lane: {
          lane,
          userId,
        },
      },
    });

    result.push({
      consumedSeq: updated?.consumedSeq.toString() ?? "0",
      lane,
    });
  }

  return result;
}

export async function readHostedMailboxPendingSystemItemsNeedAiUsageGate(input: {
  afterSeq: bigint | number | string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const afterSeq = normalizeHostedMailboxSeq(
    input.afterSeq,
    "Hosted mailbox pending system afterSeq",
  );
  const row = await prisma.hostedMailboxItem.findFirst({
    select: {
      id: true,
    },
    where: {
      kind: {
        in: [...HOSTED_MAILBOX_SYSTEM_AI_USAGE_GATED_KINDS],
      },
      lane: "system",
      laneSeq: {
        gt: afterSeq,
      },
      userId,
    },
  });

  return row !== null;
}

export async function readHostedMailboxItemByDedupeKey(input: {
  dedupeKey: string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxItemRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const record = await findHostedMailboxItemByDedupeKeyTx({
    dedupeKey: input.dedupeKey,
    tx: prisma,
    userId: input.userId,
  });

  return record
    ? hydrateHostedMailboxItemTx({
      record,
    })
    : null;
}

export async function hasHostedMailboxItemByKind(input: {
  kind: HostedMailboxKind | string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const kind = requireHostedMailboxKind(input.kind);
  const record = await prisma.hostedMailboxItem.findFirst({
    select: {
      id: true,
    },
    where: {
      kind,
      userId,
    },
  });

  return Boolean(record);
}

export async function readHostedMailboxItemOwnerById(input: {
  mailboxItemId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<{ id: string; userId: string } | null> {
  const prisma = input.prisma ?? getPrisma();
  const mailboxItemId = requireNonEmptyString(
    input.mailboxItemId,
    "Hosted mailbox item id",
  );

  return await prisma.hostedMailboxItem.findUnique({
    select: {
      id: true,
      userId: true,
    },
    where: {
      id: mailboxItemId,
    },
  });
}

export async function readHostedMailboxItemCheckpointById(input: {
  mailboxItemId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<HostedMailboxItemCheckpointRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const mailboxItemId = requireNonEmptyString(
    input.mailboxItemId,
    "Hosted mailbox item id",
  );

  const record = await prisma.hostedMailboxItem.findUnique({
    select: {
      id: true,
      lane: true,
      laneSeq: true,
      occurredAt: true,
      userId: true,
    },
    where: {
      id: mailboxItemId,
    },
  });

  return record
    ? {
      id: record.id,
      lane: requireHostedMailboxLane(record.lane),
      laneSeq: record.laneSeq.toString(),
      occurredAt: record.occurredAt.toISOString(),
      userId: record.userId,
    }
    : null;
}

export async function readHostedMailboxItemById(input: {
  mailboxItemId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<HostedMailboxItemRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const mailboxItemId = requireNonEmptyString(
    input.mailboxItemId,
    "Hosted mailbox item id",
  );

  const record = await prisma.hostedMailboxItem.findUnique({
    where: {
      id: mailboxItemId,
    },
  });

  return record ? projectHostedMailboxItem(record) : null;
}

export async function fetchHostedMailboxPayload(input: {
  dedupeKey: string;
  mailboxItemId: string;
  payloadRef?: string | null;
  prisma?: HostedMailboxStoreClient;
  requestId: string;
  userId: string;
}): Promise<HostedMailboxPayloadFetchResponse> {
  const payloadResult = await readHostedMailboxPayloadAvailability(input);

  return {
    fetchedAt: new Date().toISOString(),
    payload: payloadResult.payload,
    unavailable: payloadResult.payload
      ? null
      : {
        code: payloadResult.unavailableCode,
        retryable: payloadResult.retryable,
      },
  };
}

export async function readHostedMailboxPayload(input: {
  dedupeKey: string;
  mailboxItemId: string;
  payloadRef?: string | null;
  prisma?: HostedMailboxStoreClient;
  requestId?: string;
  userId: string;
}): Promise<HostedMailboxPayloadRecord | null> {
  return (await readHostedMailboxPayloadAvailability(input)).payload;
}

async function readHostedMailboxPayloadAvailability(input: {
  dedupeKey: string;
  mailboxItemId: string;
  payloadRef?: string | null;
  prisma?: HostedMailboxStoreClient;
  requestId?: string;
  userId: string;
}): Promise<{
  payload: HostedMailboxPayloadRecord | null;
  retryable: boolean;
  unavailableCode: "expired" | "not_found";
}> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox payload userId");
  const mailboxItemId = requireNonEmptyString(
    input.mailboxItemId,
    "Hosted mailbox payload mailboxItemId",
  );
  const dedupeKey = requireNonEmptyString(
    input.dedupeKey,
    "Hosted mailbox payload dedupeKey",
  );
  const payloadRef = normalizeNullableString(input.payloadRef);

  if (input.requestId !== undefined) {
    requireNonEmptyString(input.requestId, "Hosted mailbox payload requestId");
  }

  if (payloadRef && resolveHostedMailboxPayloadRef(payloadRef) !== mailboxItemId) {
    return {
      payload: null,
      retryable: false,
      unavailableCode: "not_found",
    };
  }

  const fetchedAt = new Date();
  const item = await prisma.hostedMailboxItem.findFirst({
    where: {
      dedupeKey,
      id: mailboxItemId,
      userId,
    },
  });

  if (!item) {
    return {
      payload: null,
      retryable: false,
      unavailableCode: "not_found",
    };
  }

  if (isHostedMailboxItemExpired(item, fetchedAt)) {
    return {
      payload: null,
      retryable: false,
      unavailableCode: "expired",
    };
  }

  const row = await prisma.hostedMailboxPayload.findFirst({
    where: {
      mailboxItem: {
        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: fetchedAt,
            },
          },
        ],
      },
      mailboxItemId,
      userId,
    },
  });

  return {
    payload: row ? projectHostedMailboxPayload(row) : null,
    retryable: row === null,
    unavailableCode: "not_found",
  };
}

export async function findHostedMailboxItemByDedupeKeyTx(input: {
  dedupeKey: string;
  tx: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxItemRow | null> {
  const dedupeKey = normalizeNullableString(input.dedupeKey);

  if (!dedupeKey) {
    return null;
  }

  return input.tx.hostedMailboxItem.findUnique({
    where: {
      userId_dedupeKey: {
        dedupeKey,
        userId: input.userId,
      },
    },
  });
}

export async function allocateHostedMailboxLaneSeqTx(input: {
  lane: HostedMailboxLane;
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<bigint> {
  const rows = await input.tx.$queryRaw<Array<{ seq: bigint }>>`
    INSERT INTO hosted_mailbox_lane_counter (user_id, lane, next_seq, updated_at)
    VALUES (${input.userId}, ${input.lane}, 2, NOW())
    ON CONFLICT (user_id, lane)
    DO UPDATE SET next_seq = hosted_mailbox_lane_counter.next_seq + 1,
                  updated_at = NOW()
    RETURNING next_seq - 1 AS seq
  `;

  if (rows.length !== 1) {
    throw new Error("Hosted mailbox lane allocation failed.");
  }

  return rows[0].seq;
}

async function acquireHostedMailboxDedupeAppendLockTx(input: {
  dedupeKey: string;
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.userId}), hashtext(${input.dedupeKey}))
  `;
}

async function recordHostedMailboxAppendLogTx(input: {
  outcome: "duplicate" | "inserted";
  item: HostedMailboxItemRow;
  payloadStorage: "inline" | "ref";
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<void> {
  const inserted = input.outcome === "inserted";
  await recordHostedRuntimeLogTx({
    component: "mailbox",
    eventCode: "mailbox.appended",
    level: "info",
    mailboxLane: input.item.lane,
    mailboxSeqEnd: input.item.laneSeq,
    mailboxSeqStart: input.item.laneSeq,
    phase: "import",
    redacted: {
      bytes: input.item.payloadBytes ?? null,
      dedupeKeyPresent: true,
      duplicate: !inserted,
      inserted,
      kind: input.item.kind,
      schema: input.item.payloadSchema,
      storage: input.payloadStorage,
    },
    tx: input.tx,
    userId: input.userId,
  });
}

async function recordHostedMailboxDedupeConflictLogTx(input: {
  dedupeConflict: boolean;
  existing: HostedMailboxItemRow;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  payloadBytes: number;
  payloadHash: string | null;
  payloadSchema: string;
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<void> {
  if (!input.dedupeConflict) {
    return;
  }

  await recordHostedRuntimeLogTx({
    component: "mailbox",
    eventCode: "mailbox.dedupe_conflict",
    level: "warn",
    mailboxLane: input.existing.lane,
    mailboxSeqEnd: input.existing.laneSeq,
    mailboxSeqStart: input.existing.laneSeq,
    phase: "import",
    redacted: {
      existingBytes: input.existing.payloadBytes ?? null,
      existingHasHash: input.existing.payloadHash != null,
      existingKind: input.existing.kind,
      existingLane: input.existing.lane,
      existingSchema: input.existing.payloadSchema,
      requestedBytes: input.payloadBytes,
      requestedHasHash: input.payloadHash != null,
      requestedKind: input.kind,
      requestedLane: input.lane,
      requestedSchema: input.payloadSchema,
    },
    tx: input.tx,
    userId: input.userId,
  });
}

export async function hydrateHostedMailboxItemTx(input: {
  record: HostedMailboxItemRow;
}): Promise<HostedMailboxItemRecord> {
  return projectHostedMailboxItem(input.record);
}

export function projectHostedMailboxItem(
  record: HostedMailboxItemRow,
): HostedMailboxItemRecord {
  return {
    createdAt: record.createdAt.toISOString(),
    dedupeKey: record.dedupeKey,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    id: record.id,
    kind: requireHostedMailboxKind(record.kind),
    lane: requireHostedMailboxLane(record.lane),
    laneSeq: record.laneSeq.toString(),
    occurredAt: record.occurredAt.toISOString(),
    payloadBytes: record.payloadBytes,
    payloadInlineCiphertext: record.payloadInlineCiphertext,
    payloadRef: record.payloadRef,
    payloadSchema: record.payloadSchema,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  };
}

export function projectHostedMailboxPayload(
  record: HostedMailboxPayloadRow,
): HostedMailboxPayloadRecord {
  return {
    createdAt: record.createdAt.toISOString(),
    mailboxItemId: record.mailboxItemId,
    payloadCiphertext: record.payloadCiphertext,
    payloadSchema: record.payloadSchema,
    userId: record.userId,
  };
}

export async function decodeHostedMailboxStoredPayload(input: {
  dedupeKey: string;
  kind: string;
  lane: string;
  laneSeq: bigint | number | string;
  mailboxItemId: string;
  occurredAt: string;
  payloadCiphertext?: string | null;
  payloadInlineCiphertext?: string | null;
  payloadSchema?: string | null;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<unknown | null> {
  const inlineCiphertext = normalizeNullableString(input.payloadInlineCiphertext);
  const refCiphertext = normalizeNullableString(input.payloadCiphertext);
  const payloadSchema = normalizeNullableString(input.payloadSchema)
    ?? HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA;
  const serialized = inlineCiphertext
    ? await decryptHostedMailboxPayloadString({
      dedupeKey: input.dedupeKey,
      itemId: input.mailboxItemId,
      kind: input.kind,
      lane: input.lane,
      laneSeq: input.laneSeq,
      occurredAt: input.occurredAt,
      payloadSchema,
      payloadStorage: "inline",
      prisma: input.prisma,
      userId: input.userId,
      value: inlineCiphertext,
    })
    : refCiphertext
      ? await decryptHostedMailboxPayloadString({
        dedupeKey: input.dedupeKey,
        itemId: input.mailboxItemId,
        kind: input.kind,
        lane: input.lane,
        laneSeq: input.laneSeq,
        occurredAt: input.occurredAt,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        payloadStorage: "sidecar",
        prisma: input.prisma,
        userId: input.userId,
        value: refCiphertext,
      })
      : null;

  if (!serialized) {
    return null;
  }

  return JSON.parse(serialized);
}

export function resolveHostedMailboxLaneForKind(kind: string): HostedMailboxLane {
  return kind === "conversation.message" ? "conversation" : "system";
}

interface HostedMailboxStoredPayloadMetadata {
  payloadBytes: number;
  payloadHash: string;
  serialized: string;
}

type HostedMailboxEncryptedPayloadStorage =
  | {
    payloadCiphertext: null;
    payloadInlineCiphertext: string;
    payloadRef: null;
    storage: "inline";
  }
  | {
    payloadCiphertext: string;
    payloadInlineCiphertext: null;
    payloadRef: string;
    storage: "ref";
  };

// Keep active conversation messages stageable from the mailbox item itself.
// Sidecar payloads remain available for unusually large system/background work,
// but normal Linq/Telegram/email conversation wakes should not depend on a second fetch.
const HOSTED_MAILBOX_MAX_INLINE_PAYLOAD_BYTES = 128 * 1024;
const HOSTED_MAILBOX_PAYLOAD_REF_PREFIX = "hosted-mailbox-payload:";

function serializeHostedMailboxPayload(value: unknown): Pick<HostedMailboxStoredPayloadMetadata, "serialized"> {
  const serialized = JSON.stringify(value);

  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new TypeError("Hosted mailbox payload must serialize to a non-empty JSON string.");
  }

  return {
    serialized,
  };
}

function deriveHostedMailboxStoredPayloadMetadata(input: {
  payloadSerializedJson: string;
  userId: string;
}): HostedMailboxStoredPayloadMetadata {
  const serialized = requireHostedMailboxSerializedPayload(input.payloadSerializedJson);
  const payloadBytes = Buffer.byteLength(serialized, "utf8");
  const payloadHash = hashHostedMailboxStoredPayload({
    serialized,
    userId: input.userId,
  });

  return {
    payloadBytes,
    payloadHash,
    serialized,
  };
}

async function encryptHostedMailboxPayloadStorage(input: {
  dedupeKey: string;
  itemId: string;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  laneSeq: bigint;
  occurredAt: Date;
  payloadBytes: number;
  payloadSchema: string;
  prisma?: HostedMailboxStoreClient;
  serialized: string;
  userId: string;
}): Promise<HostedMailboxEncryptedPayloadStorage> {
  const payloadStorage: HostedMailboxPayloadStorage = input.payloadBytes <= HOSTED_MAILBOX_MAX_INLINE_PAYLOAD_BYTES
    ? "inline"
    : "sidecar";
  const aadPayloadSchema = payloadStorage === "inline"
    ? input.payloadSchema
    : HOSTED_MAILBOX_PAYLOAD_SCHEMA;
  const ciphertext = await encryptHostedMailboxPayloadString({
    dedupeKey: input.dedupeKey,
    itemId: input.itemId,
    kind: input.kind,
    lane: input.lane,
    laneSeq: input.laneSeq,
    occurredAt: input.occurredAt.toISOString(),
    payloadSchema: aadPayloadSchema,
    payloadStorage,
    prisma: input.prisma,
    userId: input.userId,
    value: input.serialized,
  });

  if (!ciphertext) {
    throw new TypeError("Hosted mailbox payload encryption returned an empty ciphertext.");
  }

  return payloadStorage === "inline"
    ? {
      payloadCiphertext: null,
      payloadInlineCiphertext: ciphertext,
      payloadRef: null,
      storage: "inline",
    }
    : {
      payloadCiphertext: ciphertext,
      payloadInlineCiphertext: null,
      payloadRef: `${HOSTED_MAILBOX_PAYLOAD_REF_PREFIX}${input.itemId}`,
      storage: "ref",
    };
}

function requireHostedMailboxSerializedPayload(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Hosted mailbox item requires serialized payload JSON for encrypted append.");
  }

  return value;
}

function hasHostedMailboxDedupeConflict(input: {
  existing: Pick<HostedMailboxItemRow, "kind" | "lane" | "payloadBytes" | "payloadHash" | "payloadSchema">;
  kind: string;
  lane: string;
  payloadBytes: number;
  payloadHash?: string | null;
  payloadSchema: string;
}): boolean {
  return (
    input.existing.kind !== input.kind
    || input.existing.lane !== input.lane
    || input.existing.payloadBytes !== input.payloadBytes
    || normalizeNullableString(input.existing.payloadHash) !== normalizeNullableString(input.payloadHash)
    || input.existing.payloadSchema !== input.payloadSchema
  );
}

function resolveHostedMailboxPayloadRef(payloadRef: string): string {
  return payloadRef.startsWith(HOSTED_MAILBOX_PAYLOAD_REF_PREFIX)
    ? payloadRef.slice(HOSTED_MAILBOX_PAYLOAD_REF_PREFIX.length)
    : payloadRef;
}

function normalizeHostedMailboxFetchLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted mailbox fetch limit must be a positive integer.");
  }

  return Math.min(value, 100);
}

function isHostedMailboxItemExpired(
  item: Pick<HostedMailboxItemRow, "expiresAt">,
  at: Date,
): boolean {
  return item.expiresAt !== null && item.expiresAt.getTime() <= at.getTime();
}

function normalizeHostedMailboxSeq(
  value: bigint | number | string,
  label: string,
): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/u.test(value)) {
    return BigInt(value);
  }

  throw new TypeError(`${label} must be a non-negative integer.`);
}

function requireHostedMailboxLane(value: string): HostedMailboxLane {
  const normalized = requireNonEmptyString(value, "Hosted mailbox lane");

  if (isHostedMailboxLane(normalized)) {
    return normalized;
  }

  throw new TypeError(`Hosted mailbox lane is invalid: ${normalized}`);
}

function requireHostedMailboxKind(value: string): HostedMailboxKind {
  const normalized = requireNonEmptyString(value, "Hosted mailbox kind");

  if (isHostedMailboxKind(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `Hosted mailbox kind must be one of ${HOSTED_MAILBOX_KINDS.join(", ")}.`,
  );
}

function requireNonEmptyString(value: string, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }

  return normalized;
}

function requireDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return date;
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
