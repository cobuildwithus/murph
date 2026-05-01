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
  decryptHostedMailboxNullableString,
  encryptHostedMailboxNullableString,
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
  payloadBytes: number;
  payloadCiphertext?: string | null;
  payloadHash?: string | null;
  payloadInlineCiphertext?: string | null;
  payloadSchema?: string | null;
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
        return {
          duplicate: true,
          dedupeConflict: hasHostedMailboxDedupeConflict({
            existing,
            kind: input.kind,
            lane: input.lane,
            payloadBytes: input.payloadBytes,
            payloadHash: input.payloadHash,
            payloadSchema: input.payloadSchema ?? HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
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
  const payloadBytes = requirePositivePayloadBytes(input.payloadBytes);
  const payloadHash = normalizeNullableString(input.payloadHash);
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
  const payloadStorage = resolveHostedMailboxPayloadStorage({
    itemId,
    payloadCiphertext: input.payloadCiphertext,
    payloadInlineCiphertext: input.payloadInlineCiphertext,
  });
  const laneSeq = await allocateHostedMailboxLaneSeqTx({
    lane,
    tx: input.tx,
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
  const encodedPayload = await encodeHostedMailboxStoredPayload({
    prisma: input.tx,
    userId: envelope.userId,
    value: envelope,
  });

  return appendHostedMailboxItemTx({
    dedupeKey: envelope.eventId,
    kind: envelope.kind,
    lane: resolveHostedMailboxLaneForKind(envelope.kind),
    occurredAt: envelope.occurredAt,
    payloadBytes: encodedPayload.payloadBytes,
    payloadCiphertext: encodedPayload.payloadRefCiphertext,
    payloadHash: encodedPayload.payloadHash,
    payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
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
    });
  }

  return result;
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
        retryable: false,
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
      unavailableCode: "not_found",
    };
  }

  if (isHostedMailboxItemExpired(item, fetchedAt)) {
    return {
      payload: null,
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
  payloadCiphertext?: string | null;
  payloadInlineCiphertext?: string | null;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<unknown | null> {
  const inlineCiphertext = normalizeNullableString(input.payloadInlineCiphertext);
  const refCiphertext = normalizeNullableString(input.payloadCiphertext);
  const serialized = inlineCiphertext
      ? await decryptHostedMailboxNullableString({
          field: HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD,
          prisma: input.prisma,
          userId: input.userId,
          value: inlineCiphertext,
        })
    : refCiphertext
      ? await decryptHostedMailboxNullableString({
          field: HOSTED_MAILBOX_REF_PAYLOAD_FIELD,
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

interface EncodedHostedMailboxStoredPayload {
  payloadBytes: number;
  payloadHash: string;
  payloadInlineCiphertext: string | null;
  payloadRefCiphertext: string | null;
}

const HOSTED_MAILBOX_MAX_INLINE_PAYLOAD_BYTES = 16 * 1024;
const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";
const HOSTED_MAILBOX_PAYLOAD_REF_PREFIX = "hosted-mailbox-payload:";

async function encodeHostedMailboxStoredPayload(input: {
  prisma?: HostedMailboxStoreClient;
  userId: string;
  value: unknown;
}): Promise<EncodedHostedMailboxStoredPayload> {
  const serialized = JSON.stringify(input.value);

  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new TypeError("Hosted mailbox payload must serialize to a non-empty JSON string.");
  }

  const payloadBytes = Buffer.byteLength(serialized, "utf8");
  const payloadHash = hashHostedMailboxStoredPayload({
    serialized,
    userId: input.userId,
  });

  if (payloadBytes <= HOSTED_MAILBOX_MAX_INLINE_PAYLOAD_BYTES) {
    const payloadInlineCiphertext = await encryptHostedMailboxNullableString({
      field: HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD,
      prisma: input.prisma,
      userId: input.userId,
      value: serialized,
    });

    if (!payloadInlineCiphertext) {
      throw new TypeError("Hosted mailbox payload encryption returned an empty ciphertext.");
    }

    return {
      payloadBytes,
      payloadHash,
      payloadInlineCiphertext,
      payloadRefCiphertext: null,
    };
  }

  const payloadRefCiphertext = await encryptHostedMailboxNullableString({
    field: HOSTED_MAILBOX_REF_PAYLOAD_FIELD,
    prisma: input.prisma,
    userId: input.userId,
    value: serialized,
  });

  if (!payloadRefCiphertext) {
    throw new TypeError("Hosted mailbox payload spill encryption returned an empty ciphertext.");
  }

  return {
    payloadBytes,
    payloadHash,
    payloadInlineCiphertext: null,
    payloadRefCiphertext,
  };
}

function resolveHostedMailboxPayloadStorage(input: {
  itemId: string;
  payloadCiphertext?: string | null;
  payloadInlineCiphertext?: string | null;
}): (
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
  }
) {
  const inlineCiphertext = normalizeNullableString(input.payloadInlineCiphertext);
  const refCiphertext = normalizeNullableString(input.payloadCiphertext);

  if (inlineCiphertext && refCiphertext) {
    throw new TypeError("Hosted mailbox item must not provide both inline and ref payload ciphertext.");
  }

  if (!inlineCiphertext && !refCiphertext) {
    throw new TypeError("Hosted mailbox item requires encrypted payload ciphertext.");
  }

  if (inlineCiphertext) {
    return {
      payloadCiphertext: null,
      payloadInlineCiphertext: inlineCiphertext,
      payloadRef: null,
      storage: "inline",
    };
  }

  if (!refCiphertext) {
    throw new TypeError("Hosted mailbox item requires encrypted payload ciphertext.");
  }

  return {
    payloadCiphertext: refCiphertext,
    payloadInlineCiphertext: null,
    payloadRef: `${HOSTED_MAILBOX_PAYLOAD_REF_PREFIX}${input.itemId}`,
    storage: "ref",
  };
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

function requirePositivePayloadBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted mailbox payloadBytes must be a positive integer.");
  }

  return value;
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
