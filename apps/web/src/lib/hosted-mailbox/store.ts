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
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import type {
  HostedMailboxFetchCursorMode,
  HostedMailboxItem,
  HostedMailboxKind,
  HostedMailboxLane,
  HostedMailboxLaneConsumed,
  HostedMailboxLaneHighWater,
  HostedMailboxPayload,
  HostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionMealPhotoCapturedWake,
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import { parseHostedEmailThreadTarget } from "@murphai/runtime-state";
import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import { recordHostedRuntimeLogTx } from "../hosted-workspace/store";
import { advanceHostedMailboxLaneConsumedSeq } from "./lane-counter-store";
import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
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
  acceptedAllowancePeriodStart?: Date | null;
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
  consumedAt: Date | null;
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

export type HostedMailboxItemRecord = HostedMailboxItem & {
  acceptedAllowancePeriodStart?: string | null;
};
export type HostedMailboxItemWithAcceptedAllowance = HostedMailboxItemRecord & {
  acceptedAllowancePeriodStart: string | null;
};
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

export interface HostedMailboxRuntimeFetchLaneCursor {
  lane: HostedMailboxLane | string;
  importedSeq: bigint | number | string;
}

export interface FetchHostedMailboxItemsResult {
  items: HostedMailboxItemRecord[];
}

export interface FetchHostedRuntimeMailboxProjectionResult {
  consumedSeqByLane: HostedMailboxLaneConsumed[];
  items: HostedMailboxItemRecord[];
  maxSeqByLane: HostedMailboxLaneHighWater[];
}

interface HostedRuntimeMailboxProjectionRow {
  consumedSeq: bigint;
  itemAcceptedAllowancePeriodStart: Date | null;
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
  await acquireHostedMailboxCausalAppendLockTx({
    tx: input.tx,
    userId,
  });
  const causalSeq = await allocateHostedMailboxCausalSeqTx({
    tx: input.tx,
    userId,
  });
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
      causal_seq,
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
      accepted_allowance_period_start,
      consumed_at,
      expires_at,
      updated_at
    )
    VALUES (
      ${itemId},
      ${userId},
      ${causalSeq},
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
      NULL,
      NULL,
      ${expiresAt},
      NOW()
    )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING
      id,
      user_id AS "userId",
      causal_seq AS "causalSeq",
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
      accepted_allowance_period_start AS "acceptedAllowancePeriodStart",
      consumed_at AS "consumedAt",
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
  await assertHostedMailboxEnvelopeWorkspaceTargetTx({
    envelope,
    tx: input.tx,
  });
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

export async function appendHostedMealPhotoMailboxEnvelopeTx(input: {
  envelope: HostedExecutionMealPhotoCapturedWake;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult & { claimedMealPhotoKey: string }> {
  await acquireHostedMailboxDedupeAppendLockTx({
    dedupeKey: input.envelope.eventId,
    tx: input.tx,
    userId: input.envelope.userId,
  });
  const existing = await readHostedMailboxWakeByDedupeKey({
    dedupeKey: input.envelope.eventId,
    prisma: input.tx,
    userId: input.envelope.userId,
  });
  const canonicalEnvelope = existing?.kind === "meal-photo.captured"
    && hasSameMealPhotoCapture(existing, input.envelope)
    ? {
        ...input.envelope,
        mealPhoto: {
          ...input.envelope.mealPhoto,
          mealPhotoKey: existing.mealPhoto.mealPhotoKey,
        },
      }
    : input.envelope;
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: canonicalEnvelope,
    tx: input.tx,
  });
  return {
    ...appended,
    claimedMealPhotoKey: canonicalEnvelope.mealPhoto.mealPhotoKey,
  };
}

function hasSameMealPhotoCapture(
  existing: HostedExecutionMealPhotoCapturedWake,
  requested: HostedExecutionMealPhotoCapturedWake,
): boolean {
  return existing.eventId === requested.eventId
    && existing.userId === requested.userId
    && existing.occurredAt === requested.occurredAt
    && existing.mealPhoto.byteLength === requested.mealPhoto.byteLength
    && existing.mealPhoto.captureId === requested.mealPhoto.captureId
    && existing.mealPhoto.capturedAt === requested.mealPhoto.capturedAt
    && existing.mealPhoto.sha256 === requested.mealPhoto.sha256;
}

async function assertHostedMailboxEnvelopeWorkspaceTargetTx(input: {
  envelope: HostedMailboxProducerEnvelope;
  tx: HostedMailboxMutationTx;
}): Promise<void> {
  if (input.envelope.kind !== "conversation.message") {
    return;
  }

  const message = input.envelope.message;
  if (message.channel === "linq") {
    const authority = message.routeAuthority;
    if (
      message.linqMessage.threadIsDirect === false
      && (
        !authority
        || authority.channel !== "linq"
        || authority.containerMemberId !== input.envelope.userId
        || authority.threadId !== message.linqMessage.chatId
      )
    ) {
      throwHostedMailboxGroupWorkspaceTargetMismatch();
    }

    await acquireHostedLinqChatOwnershipLockTx({
      chatId: message.linqMessage.chatId,
      tx: input.tx,
    });
    const threadIdentityLookupKeys =
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "linq",
        threadId: message.linqMessage.chatId,
      });
    const route = await input.tx.hostedThreadRoute.findFirst({
      select: {
        containerMemberId: true,
      },
      where: {
        channel: "linq",
        threadIdentityLookupKey: {
          in: threadIdentityLookupKeys,
        },
      },
    });
    if (
      route
      && (
        !authority
        || authority.channel !== "linq"
        || authority.containerMemberId !== route.containerMemberId
        || authority.containerMemberId !== input.envelope.userId
        || authority.threadId !== message.linqMessage.chatId
      )
    ) {
      throwHostedMailboxGroupWorkspaceTargetMismatch();
    }
    if (!route && (message.linqMessage.threadIsDirect === false || authority)) {
      throwHostedMailboxGroupWorkspaceTargetMismatch();
    }
    return;
  }

  if (message.channel !== "email") {
    return;
  }

  const threadTarget = parseHostedEmailThreadTarget(message.threadTarget);
  if (threadTarget?.targetKind !== "group" || !threadTarget.groupId) {
    return;
  }

  const group = await input.tx.hostedGroup.findUnique({
    select: {
      runtimeMemberId: true,
    },
    where: {
      id: threadTarget.groupId,
    },
  });
  if (group?.runtimeMemberId !== input.envelope.userId) {
    throwHostedMailboxGroupWorkspaceTargetMismatch();
  }

  const container = await input.tx.hostedThreadContainer.findUnique({
    select: {
      memberId: true,
    },
    where: {
      memberId: input.envelope.userId,
    },
  });
  if (!container) {
    throwHostedMailboxGroupWorkspaceTargetMismatch();
  }
}

function throwHostedMailboxGroupWorkspaceTargetMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_WORKSPACE_TARGET_MISMATCH",
    httpStatus: 409,
    message:
      "Hosted group conversation mailbox target does not match its persisted runtime container.",
    retryable: true,
  });
}

export async function fetchHostedMailboxItemsAfterLaneCursors(input: {
  lanes: readonly HostedMailboxLaneCursor[];
  limitPerLane: number;
  now?: Date | string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<FetchHostedMailboxItemsResult> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const limitPerLane = normalizeHostedMailboxFetchLimit(input.limitPerLane);
  const payloadAvailabilityAt = normalizeHostedMailboxDate(
    input.now ?? new Date(),
    "Hosted mailbox fetch date",
  );
  const seenLanes = new Set<HostedMailboxLane>();
  const items: HostedMailboxItemRecord[] = [];

  for (const cursor of input.lanes) {
    const lane = requireHostedMailboxLane(cursor.lane);

    if (seenLanes.has(lane)) {
      throw new TypeError(`Hosted mailbox lane ${JSON.stringify(lane)} was requested more than once.`);
    }

    seenLanes.add(lane);
    const afterSeq = normalizeHostedMailboxSeq(cursor.afterSeq, "Hosted mailbox cursor afterSeq");
    const records = await fetchHostedMailboxItemRowsAfterSeq({
      afterSeq,
      at: payloadAvailabilityAt,
      lane,
      prisma,
      take: limitPerLane,
      userId,
    });

    items.push(...records.map((record) =>
        projectHostedMailboxItem(record, {
          conversationConsumedSeq: afterSeq,
          payloadAvailabilityAt,
        })
      ));
  }

  return { items };
}

export async function fetchHostedRuntimeMailboxProjection(input: {
  cursorMode?: HostedMailboxFetchCursorMode | null;
  lanes: readonly HostedMailboxRuntimeFetchLaneCursor[];
  limitPerLane: number;
  now?: Date | string;
  prisma?: HostedMailboxStoreClient;
  replayAuthority?: {
    acceptedConversationSeq: string;
    includeBootstrapActivation: boolean;
  } | null;
  userId: string;
}): Promise<FetchHostedRuntimeMailboxProjectionResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  if (isHostedMailboxRootClient(prisma)) {
    return prisma.$transaction((tx) =>
      fetchHostedRuntimeMailboxProjectionTx({
        ...input,
        now,
        tx,
      })
    );
  }

  return fetchHostedRuntimeMailboxProjectionTx({
    ...input,
    now,
    tx: prisma,
  });
}

async function fetchHostedRuntimeMailboxProjectionTx(input: {
  cursorMode?: HostedMailboxFetchCursorMode | null;
  lanes: readonly HostedMailboxRuntimeFetchLaneCursor[];
  limitPerLane: number;
  now: Date | string;
  replayAuthority?: {
    acceptedConversationSeq: string;
    includeBootstrapActivation: boolean;
  } | null;
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<FetchHostedRuntimeMailboxProjectionResult> {
  const prisma = input.tx;
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const limitPerLane = normalizeHostedMailboxFetchLimit(input.limitPerLane);
  const fetchedAt = normalizeHostedMailboxDate(
    input.now ?? new Date(),
    "Hosted mailbox fetch date",
  );
  const retainedAt = new Date(fetchedAt.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const replayAcceptedConversationSeq = input.replayAuthority
    ? normalizeHostedMailboxSeq(
        input.replayAuthority.acceptedConversationSeq,
        "Hosted mailbox replay accepted conversation seq",
      )
    : null;
  const includeReplayBootstrapActivation =
    input.replayAuthority?.includeBootstrapActivation === true;
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
          AND (
            (
              requested_lane.lane = 'conversation'
              AND mailbox_item.kind = 'conversation.message'
              AND mailbox_item.lane_seq > COALESCE(lane_counter.consumed_seq, 0::bigint)
            )
            OR (
              mailbox_item.created_at >= ${retainedAt}
              AND (mailbox_item.expires_at IS NULL OR mailbox_item.expires_at > ${fetchedAt})
            )
          )
        ORDER BY mailbox_item.lane_seq ASC
        LIMIT 1
      ) AS oldest_live ON TRUE
      LEFT JOIN LATERAL (
        SELECT mailbox_item.lane_seq, mailbox_item.updated_at
        FROM hosted_mailbox_item AS mailbox_item
        WHERE mailbox_item.user_id = ${userId}
          AND mailbox_item.lane = requested_lane.lane
          AND (
            (
              requested_lane.lane = 'conversation'
              AND mailbox_item.kind = 'conversation.message'
              AND mailbox_item.lane_seq > COALESCE(lane_counter.consumed_seq, 0::bigint)
            )
            OR (
              mailbox_item.created_at >= ${retainedAt}
              AND (mailbox_item.expires_at IS NULL OR mailbox_item.expires_at > ${fetchedAt})
            )
          )
        ORDER BY mailbox_item.lane_seq DESC
        LIMIT 1
      ) AS newest_live ON TRUE
    )
    SELECT
      lane_projection.lane AS "requestedLane",
      lane_projection.consumed_seq AS "consumedSeq",
      lane_projection.max_seq AS "maxSeq",
      lane_projection.max_updated_at AS "maxUpdatedAt",
      mailbox_item.accepted_allowance_period_start AS "itemAcceptedAllowancePeriodStart",
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
        AND (
          (
            ${replayAcceptedConversationSeq}::bigint IS NOT NULL
            AND lane_projection.lane = 'conversation'
            AND mailbox_item.lane_seq = ${replayAcceptedConversationSeq}::bigint
          )
          OR (
            ${includeReplayBootstrapActivation}
            AND lane_projection.lane = 'system'
            AND mailbox_item.kind = 'member.activated'
            AND mailbox_item.lane_seq > lane_projection.imported_seq
          )
          OR (
            ${replayAcceptedConversationSeq}::bigint IS NULL
            AND mailbox_item.lane_seq > CASE
              WHEN ${input.cursorMode === "imported_seq"}
                OR lane_projection.lane <> 'conversation'
                THEN lane_projection.imported_seq
              ELSE LEAST(lane_projection.imported_seq, lane_projection.consumed_seq)
            END
          )
        )
        AND (
          (
            lane_projection.lane = 'conversation'
            AND mailbox_item.kind = 'conversation.message'
            AND mailbox_item.lane_seq > lane_projection.consumed_seq
          )
          OR (
            mailbox_item.created_at >= ${retainedAt}
            AND (mailbox_item.expires_at IS NULL OR mailbox_item.expires_at > ${fetchedAt})
          )
        )
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

function isHostedMailboxRootClient(
  client: HostedMailboxStoreClient,
): client is PrismaClient {
  return "$transaction" in client;
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
    acceptedAllowancePeriodStart: row.itemAcceptedAllowancePeriodStart,
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
    conversationConsumedSeq: row.consumedSeq,
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

export function resolveHostedMailboxRuntimeFetchLaneCursors(input: {
  consumedSeqByLane?: readonly HostedMailboxLaneConsumed[];
  cursorMode?: HostedMailboxFetchCursorMode | null;
  lanes: readonly HostedMailboxRuntimeFetchLaneCursor[];
}): HostedMailboxLaneCursor[] {
  const consumedSeqByLane = new Map<HostedMailboxLane, bigint>();

  for (const entry of input.consumedSeqByLane ?? []) {
    const lane = requireHostedMailboxLane(entry.lane);
    const consumedSeq = normalizeHostedMailboxSeq(
      entry.consumedSeq,
      "Hosted mailbox consumedSeq",
    );
    const current = consumedSeqByLane.get(lane);

    if (current === undefined || consumedSeq > current) {
      consumedSeqByLane.set(lane, consumedSeq);
    }
  }

  return input.lanes.map((cursor) => {
    const lane = requireHostedMailboxLane(cursor.lane);
    const importedSeq = normalizeHostedMailboxSeq(
      cursor.importedSeq,
      "Hosted mailbox importedSeq",
    );
    const consumedSeq = consumedSeqByLane.get(lane) ?? null;

    return {
      afterSeq: resolveHostedMailboxRuntimeFetchAfterSeq({
        consumedSeq,
        cursorMode: input.cursorMode ?? null,
        importedSeq,
        lane,
      }).toString(),
      lane,
    };
  });
}

function resolveHostedMailboxRuntimeFetchAfterSeq(input: {
  consumedSeq: bigint | null;
  cursorMode: HostedMailboxFetchCursorMode | null;
  importedSeq: bigint;
  lane: HostedMailboxLane;
}): bigint {
  if (
    input.cursorMode === "imported_seq"
    || input.lane !== "conversation"
    || input.consumedSeq === null
  ) {
    return input.importedSeq;
  }

  return input.consumedSeq < input.importedSeq
    ? input.consumedSeq
    : input.importedSeq;
}

export async function readHostedMailboxMaxSeqByLane(input: {
  lanes?: readonly (HostedMailboxLane | string)[];
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxLaneHighWater[]> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const now = new Date();
  const seenLanes = new Set<HostedMailboxLane>();
  const result: HostedMailboxLaneHighWater[] = [];

  for (const rawLane of lanes) {
    const lane = requireHostedMailboxLane(rawLane);

    if (seenLanes.has(lane)) {
      throw new TypeError(`Hosted mailbox lane ${JSON.stringify(lane)} was requested more than once.`);
    }

    seenLanes.add(lane);

    const consumedSeq = lane === "conversation"
      ? (await prisma.hostedMailboxLaneCounter.findUnique({
          where: {
            userId_lane: {
              lane,
              userId,
            },
          },
        }))?.consumedSeq ?? 0n
      : 0n;

    const row = await prisma.hostedMailboxItem.findFirst({
      orderBy: {
        laneSeq: "desc",
      },
      where: {
        ...buildHostedMailboxReadableItemWhere({
          at: now,
          consumedSeq,
          lane,
        }),
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
    const consumedSeq = row?.consumedSeq ?? 0n;

    result.push({
      consumedSeq: (await resolveHostedMailboxEffectiveConsumedSeq({
        consumedSeq,
        lane,
        prisma,
        userId,
      })).toString(),
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
    const consumedSeq = await advanceHostedMailboxLaneConsumedSeq({
      consumedSeq: requestedSeq,
      lane,
      prisma,
      userId,
    });

    result.push({
      consumedSeq: consumedSeq.toString(),
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
      ...buildHostedMailboxLiveItemWhere(new Date()),
      lane: "system",
      laneSeq: {
        gt: afterSeq,
      },
      userId,
    },
  });

  return row !== null;
}

export async function readHostedMailboxLatestPendingConversationItem(input: {
  afterSeq: bigint | number | string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxItemRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const afterSeq = normalizeHostedMailboxSeq(
    input.afterSeq,
    "Hosted mailbox pending conversation afterSeq",
  );
  const row = await prisma.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "desc",
    },
    where: {
      consumedAt: null,
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: {
        gt: afterSeq,
      },
      userId,
    },
  });

  return row ? projectHostedMailboxItem(row) : null;
}

export async function readHostedMailboxEarliestConversationItem(input: {
  afterSeq: bigint | number | string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxItemWithAcceptedAllowance | null> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const afterSeq = normalizeHostedMailboxSeq(
    input.afterSeq,
    "Hosted mailbox pending conversation afterSeq",
  );
  const row = await prisma.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "asc",
    },
    where: {
      kind: "conversation.message",
      ...buildHostedMailboxReadableItemWhere({
        at: new Date(),
        consumedSeq: afterSeq,
        lane: "conversation",
      }),
      lane: "conversation",
      laneSeq: {
        gt: afterSeq,
      },
      userId,
    },
  });

  return row ? projectHostedMailboxItemWithAcceptedAllowance(row) : null;
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

export async function readHostedMailboxItemByLaneSeq(input: {
  lane: HostedMailboxLane;
  laneSeq: string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedMailboxItemRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const lane = requireHostedMailboxLane(input.lane);
  const laneSeq = normalizeHostedMailboxSeq(
    input.laneSeq,
    "Hosted mailbox lane seq",
  );
  const record = await prisma.hostedMailboxItem.findUnique({
    where: {
      userId_lane_laneSeq: {
        lane,
        laneSeq,
        userId,
      },
    },
  });

  return record
    ? hydrateHostedMailboxItemTx({ record })
    : null;
}

export async function readHostedMailboxWakeByDedupeKey(input: {
  dedupeKey: string;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<HostedExecutionWake | null> {
  const prisma = input.prisma ?? getPrisma();
  const item = await readHostedMailboxItemByDedupeKey({
    dedupeKey: input.dedupeKey,
    prisma,
    userId: input.userId,
  });
  if (!item) {
    return null;
  }
  const payload = item.payloadRef
    ? await readHostedMailboxPayload({
        dedupeKey: item.dedupeKey,
        mailboxItemId: item.id,
        payloadRef: item.payloadRef,
        prisma,
        userId: item.userId,
      })
    : null;
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq,
    mailboxItemId: item.id,
    occurredAt: item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: item.payloadInlineCiphertext,
    payloadSchema: item.payloadSchema,
    prisma,
    userId: item.userId,
  });
  return decoded ? parseHostedExecutionWake(decoded) : null;
}

export async function readHostedMailboxWakeAfterDedupeLockTx(input: {
  dedupeKey: string;
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<HostedExecutionWake | null> {
  await acquireHostedMailboxDedupeAppendLockTx({
    dedupeKey: input.dedupeKey,
    tx: input.tx,
    userId: input.userId,
  });
  return await readHostedMailboxWakeByDedupeKey({
    dedupeKey: input.dedupeKey,
    prisma: input.tx,
    userId: input.userId,
  });
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

export async function readHostedMailboxLiveItemById(input: {
  availableAt: Date;
  mailboxItemId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<HostedMailboxItemRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const mailboxItemId = requireNonEmptyString(
    input.mailboxItemId,
    "Hosted live mailbox item id",
  );
  const record = await prisma.hostedMailboxItem.findFirst({
    where: {
      id: mailboxItemId,
      ...buildHostedMailboxLiveItemWhere(input.availableAt),
    },
  });

  return record
    ? projectHostedMailboxItem(record, {
        payloadAvailabilityAt: input.availableAt,
      })
    : null;
}

export async function readHostedMailboxRecentLiveConversationItemIds(input: {
  availableAt: Date;
  limit: number;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<string[]> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(
    input.userId,
    "Hosted mailbox userId",
  );
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit <= 0 ||
    input.limit > 100
  ) {
    throw new TypeError(
      "Hosted mailbox recent conversation limit must be between 1 and 100.",
    );
  }

  const records = await prisma.hostedMailboxItem.findMany({
    orderBy: {
      laneSeq: "desc",
    },
    select: {
      id: true,
    },
    take: input.limit,
    where: {
      ...buildHostedMailboxLiveItemWhere(input.availableAt),
      kind: "conversation.message",
      lane: "conversation",
      userId,
    },
  });

  return records.map((record) => record.id);
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

  const conversationConsumedSeq = item.kind === "conversation.message"
      && item.lane === "conversation"
    ? (await prisma.hostedMailboxLaneCounter.findUnique({
        where: {
          userId_lane: {
            lane: "conversation",
            userId,
          },
        },
      }))?.consumedSeq ?? 0n
    : null;

  if (isHostedMailboxItemExpired(item, fetchedAt, conversationConsumedSeq)) {
    return {
      payload: null,
      retryable: false,
      unavailableCode: "expired",
    };
  }

  const row = await prisma.hostedMailboxPayload.findFirst({
    where: {
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

async function allocateHostedMailboxCausalSeqTx(input: {
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<bigint> {
  const rows = await input.tx.$queryRaw<Array<{ seq: bigint }>>`
    INSERT INTO hosted_mailbox_lane_counter (user_id, lane, next_seq, updated_at)
    VALUES (${input.userId}, 'causal', 2, NOW())
    ON CONFLICT (user_id, lane)
    DO UPDATE SET next_seq = hosted_mailbox_lane_counter.next_seq + 1,
                  updated_at = NOW()
    RETURNING next_seq - 1 AS seq
  `;

  if (rows.length !== 1) {
    throw new Error("Hosted mailbox causal sequence allocation failed.");
  }

  return rows[0].seq;
}

async function acquireHostedMailboxCausalAppendLockTx(input: {
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.userId}), hashtext('mailbox-causal-seq'))
  `;
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

function projectHostedMailboxItemWithAcceptedAllowance(
  record: HostedMailboxItemRow,
): HostedMailboxItemWithAcceptedAllowance {
  return {
    ...projectHostedMailboxItem(record),
    acceptedAllowancePeriodStart:
      record.acceptedAllowancePeriodStart?.toISOString() ?? null,
  };
}

export function projectHostedMailboxItem(
  record: HostedMailboxItemRow,
  options: {
    conversationConsumedSeq?: bigint | null;
    payloadAvailabilityAt?: Date | null;
  } = {},
): HostedMailboxItemRecord {
  const payloadExpired = options.payloadAvailabilityAt
    ? isHostedMailboxItemExpired(
        record,
        options.payloadAvailabilityAt,
        options.conversationConsumedSeq ?? null,
      )
    : false;

  return {
    acceptedAllowancePeriodStart:
      record.acceptedAllowancePeriodStart?.toISOString() ?? null,
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

const HOSTED_MAILBOX_FETCH_LIMIT_MAX = 100;
const HOSTED_MAILBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchHostedMailboxItemRowsAfterSeq(input: {
  afterSeq: bigint;
  at: Date;
  lane: HostedMailboxLane;
  prisma: HostedMailboxStoreClient;
  take: number;
  userId: string;
}): Promise<HostedMailboxItemRow[]> {
  return input.prisma.hostedMailboxItem.findMany({
    where: {
      lane: input.lane,
      laneSeq: {
        gt: input.afterSeq,
      },
      ...buildHostedMailboxReadableItemWhere({
        at: input.at,
        consumedSeq: input.afterSeq,
        lane: input.lane,
      }),
      userId: input.userId,
    },
    orderBy: {
      laneSeq: "asc",
    },
    take: input.take,
  });
}

function normalizeHostedMailboxFetchLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted mailbox fetch limit must be a positive integer.");
  }

  return Math.min(value, HOSTED_MAILBOX_FETCH_LIMIT_MAX);
}

async function resolveHostedMailboxEffectiveConsumedSeq(input: {
  consumedSeq: bigint;
  lane: HostedMailboxLane;
  prisma: HostedMailboxStoreClient;
  userId: string;
}): Promise<bigint> {
  const now = new Date();
  const oldestRetained = await input.prisma.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "asc",
    },
    where: {
      ...buildHostedMailboxReadableItemWhere({
        at: now,
        consumedSeq: input.consumedSeq,
        lane: input.lane,
      }),
      lane: input.lane,
      userId: input.userId,
    },
  });

  if (!oldestRetained || oldestRetained.laneSeq === 0n) {
    return input.consumedSeq;
  }

  const retainedFloor = oldestRetained.laneSeq - 1n;
  return input.consumedSeq > retainedFloor ? input.consumedSeq : retainedFloor;
}

function isHostedMailboxItemExpired(
  item: Pick<
    HostedMailboxItemRow,
    "createdAt" | "expiresAt" | "kind" | "lane" | "laneSeq"
  >,
  at: Date,
  conversationConsumedSeq: bigint | null,
): boolean {
  if (
    conversationConsumedSeq !== null
    && item.kind === "conversation.message"
    && item.lane === "conversation"
    && item.laneSeq > conversationConsumedSeq
  ) {
    return false;
  }

  return (
    (item.expiresAt !== null && item.expiresAt.getTime() <= at.getTime())
    || item.createdAt.getTime() < at.getTime() - HOSTED_MAILBOX_RETENTION_MS
  );
}

function buildHostedMailboxReadableItemWhere(input: {
  at: Date;
  consumedSeq: bigint;
  lane: HostedMailboxLane;
}): Prisma.HostedMailboxItemWhereInput {
  const retained = buildHostedMailboxLiveItemWhere(input.at);
  if (input.lane !== "conversation") {
    return retained;
  }

  return {
    OR: [
      retained,
      {
        kind: "conversation.message",
        laneSeq: {
          gt: input.consumedSeq,
        },
      },
    ],
  };
}

function buildHostedMailboxLiveItemWhere(at: Date): {
  createdAt: { gte: Date };
  OR: [{ expiresAt: null }, { expiresAt: { gt: Date } }];
} {
  return {
    createdAt: {
      gte: new Date(at.getTime() - HOSTED_MAILBOX_RETENTION_MS),
    },
    OR: [
      {
        expiresAt: null,
      },
      {
        expiresAt: {
          gt: at,
        },
      },
    ],
  };
}

function normalizeHostedMailboxDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be valid.`);
  }

  return date;
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
