import {
  HOSTED_MAILBOX_KINDS,
  isHostedMailboxKind,
  isHostedMailboxLane,
  type HostedMailboxFetchCursorMode,
  type HostedMailboxItem,
  type HostedMailboxKind,
  type HostedMailboxLane,
  type HostedMailboxLaneConsumed,
  type HostedMailboxLaneHighWater,
} from "@murphai/hosted-execution/runtime-control";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export type HostedMailboxStoreClient = PrismaClient | Prisma.TransactionClient;

export interface HostedMailboxItemRow {
  assistantInputLookupKey: string | null;
  causalSeq?: bigint | null;
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
  sourceMessageLookupKey?: string | null;
  consumedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type HostedMailboxItemRecord = HostedMailboxItem;

export interface HostedMailboxRuntimeFetchLaneCursor {
  lane: HostedMailboxLane | string;
  importedSeq: bigint | number | string;
}

export interface FetchHostedRuntimeMailboxProjectionResult {
  consumedSeqByLane: HostedMailboxLaneConsumed[];
  items: HostedMailboxItemRecord[];
  maxSeqByLane: HostedMailboxLaneHighWater[];
}

export async function tryMarkHostedMailboxConversationAiUsageDenied(input: {
  afterConversationLaneSeq: bigint;
  prisma?: HostedMailboxStoreClient;
  throughConversationLaneSeq: bigint;
  userId: string;
}): Promise<boolean> {
  try {
    if (
      input.afterConversationLaneSeq < 0n
      || input.throughConversationLaneSeq < 0n
    ) {
      throw new TypeError("Hosted mailbox conversation sequence window is invalid.");
    }
    if (
      input.throughConversationLaneSeq <= input.afterConversationLaneSeq
    ) {
      return false;
    }
    const prisma = input.prisma ?? getPrisma();
    const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
    const marked = await prisma.$executeRaw(Prisma.sql`
      UPDATE hosted_mailbox_item
      SET ai_usage_denied_at = GREATEST(
        created_at,
        statement_timestamp() AT TIME ZONE 'UTC'
      )
      WHERE user_id = ${userId}
        AND lane = 'conversation'
        AND lane_seq > ${input.afterConversationLaneSeq}
        AND lane_seq <= ${input.throughConversationLaneSeq}
        AND consumed_at IS NULL
        AND ai_usage_denied_at IS NULL
    `);

    return marked > 0;
  } catch (error) {
    console.warn("Hosted mailbox usage-denial mark failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_MAILBOX_USAGE_DENIAL_MARK_FAILED",
      }),
    });
    return false;
  }
}

interface HostedRuntimeMailboxProjectionRow {
  consumedSeq: bigint;
  itemCausalSeq: bigint | null;
  itemConsumedAt: Date | null;
  itemCreatedAt: Date | null;
  itemDedupeKey: string | null;
  itemExpiresAt: Date | null;
  itemId: string | null;
  itemKind: string | null;
  itemLane: string | null;
  itemLaneSeq: bigint | null;
  itemOccurredAt: Date | null;
  itemPayloadBytes: number | null;
  itemPayloadHash: string | null;
  itemPayloadInlineCiphertext: string | null;
  itemPayloadRef: string | null;
  itemPayloadSchema: string | null;
  itemUpdatedAt: Date | null;
  itemUserId: string | null;
  maxSeq: bigint;
  maxUpdatedAt: Date | null;
  requestedLane: string;
}

export async function fetchHostedRuntimeMailboxProjection(input: {
  cursorMode?: HostedMailboxFetchCursorMode | null;
  lanes: readonly HostedMailboxRuntimeFetchLaneCursor[];
  limitPerLane: number;
  now?: Date | string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<FetchHostedRuntimeMailboxProjectionResult> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const limitPerLane = normalizeHostedMailboxFetchLimit(input.limitPerLane);
  const fetchedAt = normalizeHostedMailboxDate(
    input.now ?? new Date(),
    "Hosted mailbox fetch date",
  );
  const retainedAt = new Date(fetchedAt.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const seenLanes = new Set<HostedMailboxLane>();
  const lanes = input.lanes.map((cursor, ordinal) => {
    const lane = requireHostedMailboxLane(cursor.lane);
    if (seenLanes.has(lane)) {
      throw new TypeError(`Hosted mailbox lane ${JSON.stringify(lane)} was requested more than once.`);
    }
    seenLanes.add(lane);

    return {
      importedSeq: normalizeHostedMailboxSeq(
        cursor.importedSeq,
        "Hosted mailbox importedSeq",
      ),
      lane,
      ordinal,
    };
  });

  if (lanes.length === 0) {
    return {
      consumedSeqByLane: [],
      items: [],
      maxSeqByLane: [],
    };
  }

  const requestedLaneValues = lanes.map((entry) => Prisma.sql`(
    ${entry.ordinal}::integer,
    ${entry.lane}::text,
    ${entry.importedSeq}::bigint
  )`);
  const rows = await prisma.$queryRaw<HostedRuntimeMailboxProjectionRow[]>(Prisma.sql`
    WITH requested_lane (ordinal, lane, imported_seq) AS (
      VALUES ${Prisma.join(requestedLaneValues)}
    ),
    lane_projection AS (
      SELECT
        requested_lane.ordinal,
        requested_lane.lane,
        requested_lane.imported_seq,
        GREATEST(
          COALESCE(lane_counter.consumed_seq, 0::bigint),
          COALESCE(oldest_live.lane_seq - 1::bigint, 0::bigint)
        ) AS consumed_seq,
        COALESCE(newest_live.lane_seq, 0::bigint) AS max_seq,
        newest_live.updated_at AS max_updated_at
      FROM requested_lane
      LEFT JOIN hosted_mailbox_lane_counter AS lane_counter
        ON lane_counter.user_id = ${userId}
        AND lane_counter.lane = requested_lane.lane
      LEFT JOIN LATERAL (
        SELECT mailbox_item.lane_seq
        FROM hosted_mailbox_item AS mailbox_item
        WHERE mailbox_item.user_id = ${userId}
          AND mailbox_item.lane = requested_lane.lane
          AND mailbox_item.created_at > ${retainedAt}
          AND (mailbox_item.expires_at IS NULL OR mailbox_item.expires_at > ${fetchedAt})
        ORDER BY mailbox_item.lane_seq ASC
        LIMIT 1
      ) AS oldest_live ON TRUE
      LEFT JOIN LATERAL (
        SELECT mailbox_item.lane_seq, mailbox_item.updated_at
        FROM hosted_mailbox_item AS mailbox_item
        WHERE mailbox_item.user_id = ${userId}
          AND mailbox_item.lane = requested_lane.lane
          AND mailbox_item.created_at > ${retainedAt}
          AND (mailbox_item.expires_at IS NULL OR mailbox_item.expires_at > ${fetchedAt})
        ORDER BY mailbox_item.lane_seq DESC
        LIMIT 1
      ) AS newest_live ON TRUE
    )
    SELECT
      lane_projection.lane AS "requestedLane",
      lane_projection.consumed_seq AS "consumedSeq",
      lane_projection.max_seq AS "maxSeq",
      lane_projection.max_updated_at AS "maxUpdatedAt",
      mailbox_item.id AS "itemId",
      mailbox_item.user_id AS "itemUserId",
      mailbox_item.causal_seq AS "itemCausalSeq",
      mailbox_item.lane AS "itemLane",
      mailbox_item.lane_seq AS "itemLaneSeq",
      mailbox_item.dedupe_key AS "itemDedupeKey",
      mailbox_item.kind AS "itemKind",
      mailbox_item.occurred_at AS "itemOccurredAt",
      mailbox_item.payload_schema AS "itemPayloadSchema",
      mailbox_item.payload_inline_ciphertext AS "itemPayloadInlineCiphertext",
      mailbox_item.payload_ref AS "itemPayloadRef",
      mailbox_item.payload_bytes AS "itemPayloadBytes",
      mailbox_item.payload_hash AS "itemPayloadHash",
      mailbox_item.consumed_at AS "itemConsumedAt",
      mailbox_item.expires_at AS "itemExpiresAt",
      mailbox_item.created_at AS "itemCreatedAt",
      mailbox_item.updated_at AS "itemUpdatedAt"
    FROM lane_projection
    LEFT JOIN LATERAL (
      SELECT mailbox_item.*
      FROM hosted_mailbox_item AS mailbox_item
      WHERE mailbox_item.user_id = ${userId}
        AND mailbox_item.lane = lane_projection.lane
        AND mailbox_item.lane_seq > CASE
          WHEN ${input.cursorMode === "imported_seq"}
            OR lane_projection.lane <> 'conversation'
            THEN lane_projection.imported_seq
          ELSE LEAST(lane_projection.imported_seq, lane_projection.consumed_seq)
        END
        AND mailbox_item.created_at > ${retainedAt}
        AND (mailbox_item.expires_at IS NULL OR mailbox_item.expires_at > ${fetchedAt})
      ORDER BY mailbox_item.lane_seq ASC
      LIMIT ${limitPerLane}
    ) AS mailbox_item ON TRUE
    ORDER BY lane_projection.ordinal ASC, mailbox_item.lane_seq ASC NULLS LAST
  `);

  const laneProjection = new Map<HostedMailboxLane, {
    consumedSeq: bigint;
    maxSeq: bigint;
    maxUpdatedAt: Date | null;
  }>();
  const items: HostedMailboxItemRecord[] = [];
  for (const row of rows) {
    const lane = requireHostedMailboxLane(row.requestedLane);
    laneProjection.set(lane, {
      consumedSeq: row.consumedSeq,
      maxSeq: row.maxSeq,
      maxUpdatedAt: row.maxUpdatedAt,
    });
    const item = projectHostedRuntimeMailboxProjectionItem({
      fetchedAt,
      row,
    });
    if (item) {
      items.push(item);
    }
  }

  return {
    consumedSeqByLane: lanes.map(({ lane }) => {
      const projection = requireHostedRuntimeMailboxLaneProjection(laneProjection, lane);
      return {
        consumedSeq: projection.consumedSeq.toString(),
        lane,
      };
    }),
    items,
    maxSeqByLane: lanes.map(({ lane }) => {
      const projection = requireHostedRuntimeMailboxLaneProjection(laneProjection, lane);
      return {
        lane,
        maxSeq: projection.maxSeq.toString(),
        maxUpdatedAt: projection.maxUpdatedAt?.toISOString() ?? null,
      };
    }),
  };
}

function projectHostedRuntimeMailboxProjectionItem(input: {
  fetchedAt: Date;
  row: HostedRuntimeMailboxProjectionRow;
}): HostedMailboxItemRecord | null {
  const row = input.row;
  if (row.itemId === null) {
    return null;
  }

  return projectHostedMailboxItem({
    assistantInputLookupKey: null,
    causalSeq: row.itemCausalSeq,
    consumedAt: row.itemConsumedAt,
    createdAt: requireHostedRuntimeMailboxProjectionValue(
      row.itemCreatedAt,
      "Hosted mailbox projected item createdAt",
    ),
    dedupeKey: requireHostedRuntimeMailboxProjectionValue(
      row.itemDedupeKey,
      "Hosted mailbox projected item dedupeKey",
    ),
    expiresAt: row.itemExpiresAt,
    id: row.itemId,
    kind: requireHostedRuntimeMailboxProjectionValue(
      row.itemKind,
      "Hosted mailbox projected item kind",
    ),
    lane: requireHostedRuntimeMailboxProjectionValue(
      row.itemLane,
      "Hosted mailbox projected item lane",
    ),
    laneSeq: requireHostedRuntimeMailboxProjectionValue(
      row.itemLaneSeq,
      "Hosted mailbox projected item laneSeq",
    ),
    occurredAt: requireHostedRuntimeMailboxProjectionValue(
      row.itemOccurredAt,
      "Hosted mailbox projected item occurredAt",
    ),
    payloadBytes: row.itemPayloadBytes,
    payloadHash: row.itemPayloadHash,
    payloadInlineCiphertext: row.itemPayloadInlineCiphertext,
    payloadRef: row.itemPayloadRef,
    payloadSchema: requireHostedRuntimeMailboxProjectionValue(
      row.itemPayloadSchema,
      "Hosted mailbox projected item payloadSchema",
    ),
    updatedAt: requireHostedRuntimeMailboxProjectionValue(
      row.itemUpdatedAt,
      "Hosted mailbox projected item updatedAt",
    ),
    userId: requireHostedRuntimeMailboxProjectionValue(
      row.itemUserId,
      "Hosted mailbox projected item userId",
    ),
  }, {
    payloadAvailabilityAt: input.fetchedAt,
  });
}

function requireHostedRuntimeMailboxLaneProjection(
  projectionByLane: ReadonlyMap<HostedMailboxLane, {
    consumedSeq: bigint;
    maxSeq: bigint;
    maxUpdatedAt: Date | null;
  }>,
  lane: HostedMailboxLane,
): {
  consumedSeq: bigint;
  maxSeq: bigint;
  maxUpdatedAt: Date | null;
} {
  const projection = projectionByLane.get(lane);
  if (!projection) {
    throw new Error(`Hosted mailbox projection omitted lane ${JSON.stringify(lane)}.`);
  }
  return projection;
}

function requireHostedRuntimeMailboxProjectionValue<T>(
  value: T | null,
  label: string,
): T {
  if (value === null) {
    throw new Error(`${label} must not be null.`);
  }
  return value;
}

export function projectHostedMailboxItem(
  record: HostedMailboxItemRow,
  options: {
    payloadAvailabilityAt?: Date | null;
  } = {},
): HostedMailboxItemRecord {
  const payloadExpired = options.payloadAvailabilityAt
    ? isHostedMailboxItemExpired(record, options.payloadAvailabilityAt)
    : false;

  return {
    causalSeq: record.causalSeq?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    dedupeKey: record.dedupeKey,
    consumedAt: record.consumedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    id: record.id,
    kind: requireHostedMailboxKind(record.kind),
    lane: requireHostedMailboxLane(record.lane),
    laneSeq: record.laneSeq.toString(),
    occurredAt: record.occurredAt.toISOString(),
    payloadBytes: record.payloadBytes,
    payloadInlineCiphertext: payloadExpired ? null : record.payloadInlineCiphertext,
    payloadRef: payloadExpired ? null : record.payloadRef,
    payloadSchema: record.payloadSchema,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  };
}

const HOSTED_MAILBOX_FETCH_LIMIT_MAX = 100;

// The read filter below and the retention DELETE in hosted-retention/cleanup.ts
// must apply the same window: a read that still surfaces rows the sweep has
// already deleted (or hides rows it has not) desynchronizes the consumed
// watermark. Exported so cleanup.ts consumes this value rather than restating
// it. Retention direction is one-way — cleanup depends on the mailbox, never
// the reverse — so this stays the single definition.
export const HOSTED_MAILBOX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function normalizeHostedMailboxFetchLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted mailbox fetch limit must be a positive integer.");
  }

  return Math.min(value, HOSTED_MAILBOX_FETCH_LIMIT_MAX);
}

export function isHostedMailboxItemExpired(
  item: Pick<HostedMailboxItemRow, "createdAt" | "expiresAt">,
  at: Date,
): boolean {
  return (
    (item.expiresAt !== null && item.expiresAt.getTime() <= at.getTime())
    || item.createdAt.getTime() <= at.getTime() - HOSTED_MAILBOX_RETENTION_MS
  );
}

export function normalizeHostedMailboxDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be valid.`);
  }

  return date;
}

export function normalizeHostedMailboxSeq(
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

export function requireHostedMailboxLane(value: string): HostedMailboxLane {
  const normalized = requireNonEmptyString(value, "Hosted mailbox lane");

  if (isHostedMailboxLane(normalized)) {
    return normalized;
  }

  throw new TypeError(`Hosted mailbox lane is invalid: ${normalized}`);
}

export function requireHostedMailboxKind(value: string): HostedMailboxKind {
  const normalized = requireNonEmptyString(value, "Hosted mailbox kind");

  if (isHostedMailboxKind(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `Hosted mailbox kind must be one of ${HOSTED_MAILBOX_KINDS.join(", ")}.`,
  );
}

export function requireNonEmptyString(value: string, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }

  return normalized;
}
