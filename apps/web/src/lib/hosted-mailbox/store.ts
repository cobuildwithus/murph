import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  isHostedMailboxKind,
  isHostedMailboxLane,
  isHostedRetiredMailboxKind,
  type HostedMailboxFetchCursorMode,
  type HostedMailboxItem,
  type HostedMailboxKind,
  type HostedMailboxLane,
  type HostedMailboxLaneConsumed,
  type HostedMailboxLaneHighWater,
  type HostedMailboxPayload,
  type HostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  createHostedMailboxAssistantInputId,
  readHostedConversationAssistantIdentifierSecret,
} from "@murphai/hosted-execution/assistant-identifiers";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import type {
  HostedExecutionConversationMessageWake,
  HostedExecutionEnvironmentVoiceCapturedWake,
  HostedExecutionMealPhotoCapturedWake,
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeSubscriptionAction,
} from "@murphai/hosted-execution/subscription";
import {
  getHostedCryptoDomainForLane,
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  prepareHostedDomainRootForWeb,
  revalidatePreparedHostedDomainRootForWebTx,
  HostedDomainRootPreparationMismatchError,
  type PreparedHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import {
  runWithFreshHostedDomainRootUnwrapCache,
  runWithHostedDomainRootUnwrapCache,
  type CachedUnwrappedHostedDomainRoot,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import { advanceHostedMailboxLaneConsumedSeq } from "./lane-counter-store";
import {
  createHostedAssistantInputLookupKey,
  createHostedAssistantInputLookupKeyReadCandidates,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
import {
  decryptHostedMailboxPayloadStringsWithPreparedRoots,
  decryptHostedMailboxPayloadString,
  encryptHostedMailboxPayloadString,
  encryptPreparedHostedMailboxPayloadString,
  prewarmHostedMailboxPayloadActiveRoot,
  prewarmHostedMailboxPayloadStrings,
  type HostedMailboxPayloadCryptoMetadata,
  encryptHostedMailboxPayloadStringFromPreparedRoot,
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

export interface HostedMailboxSourceConversationEntry {
  contentAvailable: boolean;
  itemId: string;
  userId: string;
  wake: HostedExecutionConversationMessageWake | null;
}

export interface HostedMailboxSourceConversationPreparationRow {
  causalSeq: bigint | null;
  createdAt: Date;
  dedupeKey: string;
  expiresAt: Date | null;
  itemId: string;
  kind: string;
  lane: string;
  laneSeq: bigint;
  occurredAt: Date;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadSchema: string;
  sidecarMailboxItemId: string | null;
  sidecarPayloadCiphertext: string | null;
  sidecarPayloadSchema: string | null;
  sidecarUserId: string | null;
  sourceMessageLookupKey: string | null;
  userId: string;
}

export interface HostedMailboxSourceConversationPreparation {
  preparedAt: Date;
  rows: readonly HostedMailboxSourceConversationPreparationRow[];
  sourceMessageLookupKeys: readonly string[];
}

export class HostedMailboxSourceConversationPreparationMismatchError extends Error {
  constructor() {
    super("Hosted mailbox source conversation changed after preparation.");
    this.name = "HostedMailboxSourceConversationPreparationMismatchError";
  }
}

export function isHostedMailboxSourceConversationPreparationMismatchError(
  error: unknown,
): error is HostedMailboxSourceConversationPreparationMismatchError {
  return error instanceof HostedMailboxSourceConversationPreparationMismatchError;
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

export type HostedMailboxProducerEnvelope = HostedExecutionWake;

export type PreparedHostedMailboxEnvelopeAppend =
  | {
      dedupeKey: string;
      existingItemId: string;
      itemKind: HostedMailboxKind;
      lane: HostedMailboxLane;
      mode: "existing";
      payloadBytes: number;
      payloadHash: string;
      payloadSchema: string;
      userId: string;
    }
  | {
      assistantInputLookupKey: string | null;
      dedupeKey: string;
      expiresAt: Date | null;
      itemId: string;
      itemKind: HostedMailboxKind;
      lane: HostedMailboxLane;
      occurredAt: Date;
      payloadBytes: number;
      payloadHash: string;
      payloadSchema: string;
      payloadStorage: HostedMailboxEncryptedPayloadStorage;
      sourceMessageLookupKey: string | null;
      userId: string;
      mode: "prepared";
    };

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

interface AppendHostedMailboxItemInternalInput extends AppendHostedMailboxItemBaseInput {
  itemId?: string;
  sourceMessageLookupKey?: string | null;
}

interface NormalizedHostedMailboxAppendInput {
  dedupeKey: string;
  expiresAt: Date | null;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  occurredAt: Date;
  payloadBytes: number;
  payloadHash: string;
  payloadSchema: string;
  serialized: string;
  userId: string;
}

type HostedMailboxAppendEncryptionOwner =
  | { mode: "legacy-transaction" }
  | {
      mode: "prepared-root";
      prepared: PreparedHostedMailboxItemAppendCrypto;
    };

type HostedMailboxPayloadEncryptionOwner =
  | {
      mode: "legacy-provider-capable";
      prisma: HostedMailboxStoreClient;
    }
  | {
      mode: "prepared-root-local-only";
      root: Promise<CachedUnwrappedHostedDomainRoot>;
      rootKeyId: string;
    };

const HOSTED_MAILBOX_APPEND_CRYPTO_DOMAIN =
  getHostedCryptoDomainForLane("mailbox-payload");
const HOSTED_MAILBOX_APPEND_CRYPTO_PREPARATION_ATTEMPTS = 2;
export type PreparedHostedMailboxItemAppendCrypto =
  PreparedHostedDomainRootForWeb;

/**
 * Provider-capable mailbox crypto preparation. The returned token contains
 * crypto identity only, grants no member/workspace/route authority, and is
 * usable solely while the exact unwrapped ingress root remains in the
 * surrounding request-scoped cache.
 */
export async function prepareHostedMailboxItemAppendCrypto(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<PreparedHostedMailboxItemAppendCrypto> {
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  return prepareHostedDomainRootForWeb({
    domain: HOSTED_MAILBOX_APPEND_CRYPTO_DOMAIN,
    prepareMissing: false,
    prisma: input.prisma,
    reason: "hosted-mailbox.append-payload",
    userId,
  });
}

/**
 * Owns the bounded preparation lifecycle for transaction-local mailbox
 * appends. Provider-capable work finishes before `append` opens its owner
 * transaction; exact root drift retries the whole preparation once with a
 * fresh request cache.
 */
export async function runWithPreparedHostedMailboxItemAppendCrypto<TResult>(
  input: {
    append: (
      prepared: PreparedHostedMailboxItemAppendCrypto,
    ) => Promise<TResult>;
    prisma: PrismaClient;
    userId: string;
  },
): Promise<TResult> {
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  for (
    let attempt = 0;
    attempt < HOSTED_MAILBOX_APPEND_CRYPTO_PREPARATION_ATTEMPTS;
    attempt += 1
  ) {
    const runAttempt = async () => {
      const prepared = await prepareHostedMailboxItemAppendCrypto({
        prisma: input.prisma,
        userId,
      });
      return input.append(prepared);
    };

    try {
      return await (attempt === 0
        ? runWithHostedDomainRootUnwrapCache(runAttempt)
        : runWithFreshHostedDomainRootUnwrapCache(runAttempt));
    } catch (error) {
      if (!(error instanceof HostedDomainRootPreparationMismatchError)) {
        throw error;
      }
      if (
        attempt + 1
        >= HOSTED_MAILBOX_APPEND_CRYPTO_PREPARATION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }

  throw new Error(
    "Hosted mailbox append crypto preparation retry exhausted unexpectedly.",
  );
}

async function revalidatePreparedHostedMailboxAppendCryptoTx(input: {
  prepared: PreparedHostedMailboxItemAppendCrypto;
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<{
  root: Promise<CachedUnwrappedHostedDomainRoot>;
  rootKeyId: string;
}> {
  const prepared = input.prepared;
  if (
    !prepared
    || typeof prepared !== "object"
    || prepared.domain !== HOSTED_MAILBOX_APPEND_CRYPTO_DOMAIN
    || prepared.userId !== input.userId
    || typeof prepared.rootKeyId !== "string"
    || prepared.rootKeyId.trim().length === 0
  ) {
    throw new TypeError(
      "Hosted mailbox append prepared crypto identity does not match the append.",
    );
  }
  return revalidatePreparedHostedDomainRootForWebTx({
    prepared,
    tx: input.tx,
  });
}

export async function appendHostedMailboxItem(
  input: AppendHostedMailboxItemBaseInput & {
    prisma?: PrismaClient;
  },
): Promise<AppendHostedMailboxItemResult> {
  const prisma = input.prisma ?? getPrisma();
  const normalized = normalizeHostedMailboxAppendInput(input);
  const existingBeforePreparation = await findHostedMailboxItemByDedupeKeyTx({
    dedupeKey: normalized.dedupeKey,
    tx: prisma,
    userId: normalized.userId,
  });
  if (existingBeforePreparation) {
    const duplicate = await buildHostedMailboxDuplicateResult({
      existing: existingBeforePreparation,
      normalized,
    });
    recordHostedMailboxDedupeConflictLog({
      dedupeConflict: duplicate.dedupeConflict,
      existing: existingBeforePreparation,
      kind: normalized.kind,
      lane: normalized.lane,
      payloadBytes: normalized.payloadBytes,
      payloadHash: normalized.payloadHash,
      payloadSchema: normalized.payloadSchema,
    });
    return duplicate;
  }

  try {
    return await runWithPreparedHostedMailboxItemAppendCrypto({
      append: (prepared) =>
        prisma.$transaction((tx) =>
            appendHostedMailboxItemWithPreparedCryptoTx({
              dedupeKey: normalized.dedupeKey,
              expiresAt: normalized.expiresAt,
              kind: normalized.kind,
              lane: normalized.lane,
              occurredAt: normalized.occurredAt,
              payloadSchema: normalized.payloadSchema,
              payloadSerializedJson: normalized.serialized,
              prepared,
              tx,
              userId: normalized.userId,
            })
        ),
      prisma,
      userId: normalized.userId,
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      const existing = await findHostedMailboxItemByDedupeKeyTx({
        dedupeKey: normalized.dedupeKey,
        tx: prisma,
        userId: normalized.userId,
      });

      if (existing) {
        return buildHostedMailboxDuplicateResult({
          existing,
          normalized,
        });
      }
    }

    throw error;
  }
}

/**
 * Legacy provider-capable transaction surface retained for separately migrated
 * callers. New generic owners must use the prepared transaction surface below.
 */
export async function appendHostedMailboxItemTx(
  input: AppendHostedMailboxItemBaseInput & {
    tx: HostedMailboxMutationTx;
  },
): Promise<AppendHostedMailboxItemResult> {
  return appendHostedMailboxItemWithAssistantInputLookupKeyTx({
    ...input,
    assistantInputLookupKey: null,
  });
}

/**
 * Transaction-safe generic append surface. Crypto must be prepared before the
 * transaction begins; this owner revalidates root authority and seals only
 * from the exact request-scoped cache entry represented by `prepared`. The
 * token does not replace any caller-owned admission or target checks.
 */
export async function appendHostedMailboxItemWithPreparedCryptoTx(
  input: AppendHostedMailboxItemBaseInput & {
    prepared: PreparedHostedMailboxItemAppendCrypto;
    tx: HostedMailboxMutationTx;
  },
): Promise<AppendHostedMailboxItemResult> {
  return appendHostedMailboxItemWithEncryptionTx({
    ...input,
    assistantInputLookupKey: null,
    encryption: {
      mode: "prepared-root",
      prepared: input.prepared,
    },
  });
}

async function appendHostedMailboxItemWithAssistantInputLookupKeyTx(
  input: AppendHostedMailboxItemInternalInput & {
    assistantInputLookupKey: string | null;
    tx: HostedMailboxMutationTx;
  },
): Promise<AppendHostedMailboxItemResult> {
  return appendHostedMailboxItemWithEncryptionTx({
    ...input,
    encryption: { mode: "legacy-transaction" },
  });
}

async function appendHostedMailboxItemWithEncryptionTx(
  input: AppendHostedMailboxItemInternalInput & {
    assistantInputLookupKey: string | null;
    encryption: HostedMailboxAppendEncryptionOwner;
    tx: HostedMailboxMutationTx;
  },
): Promise<AppendHostedMailboxItemResult> {
  const normalized = normalizeHostedMailboxAppendInput(input);
  const {
    dedupeKey,
    expiresAt,
    kind,
    lane,
    occurredAt,
    payloadBytes,
    payloadHash,
    payloadSchema,
    serialized,
    userId,
  } = normalized;
  const sourceMessageLookupKey = input.sourceMessageLookupKey === undefined
    || input.sourceMessageLookupKey === null
    ? null
    : requireNonEmptyString(
        input.sourceMessageLookupKey,
        "Hosted mailbox sourceMessageLookupKey",
      );
  const payloadEncryption = input.encryption.mode === "prepared-root"
    ? {
        mode: "prepared-root-local-only" as const,
        ...await revalidatePreparedHostedMailboxAppendCryptoTx({
          prepared: input.encryption.prepared,
          tx: input.tx,
          userId,
        }),
      }
    : {
        mode: "legacy-provider-capable" as const,
        prisma: input.tx,
      };
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
    recordHostedMailboxDedupeConflictLog({
      dedupeConflict,
      existing,
      kind,
      lane,
      payloadBytes,
      payloadHash,
      payloadSchema,
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

  const itemId = input.itemId === undefined
    ? randomUUID()
    : requireHostedMailboxItemId(input.itemId);
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
    encryption: payloadEncryption,
    itemId,
    kind,
    lane,
    laneSeq,
    occurredAt,
    payloadBytes,
    payloadSchema,
    serialized,
    userId,
  });
  const inserted = await input.tx.$queryRaw<HostedMailboxItemRow[]>`
    INSERT INTO hosted_mailbox_item (
      id,
      user_id,
      assistant_input_lookup_key,
      source_message_lookup_key,
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
      consumed_at,
      expires_at,
      updated_at
    )
    VALUES (
      ${itemId},
      ${userId},
      ${input.assistantInputLookupKey},
      ${sourceMessageLookupKey},
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
      ${expiresAt},
      NOW()
    )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING
      id,
      user_id AS "userId",
      assistant_input_lookup_key AS "assistantInputLookupKey",
      source_message_lookup_key AS "sourceMessageLookupKey",
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
    recordHostedMailboxDedupeConflictLog({
      dedupeConflict,
      existing: concurrentExisting,
      kind,
      lane,
      payloadBytes,
      payloadHash,
      payloadSchema,
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
  return appendHostedMailboxEnvelopeInternalTx({
    ...input,
    encryption: { mode: "legacy-transaction" },
  });
}

/**
 * Transaction-safe envelope append surface for callers that prepared mailbox
 * crypto before opening their owner transaction. Envelope target and workspace
 * authority remain transaction-owned; the prepared token supplies only the
 * exact local ingress-root capability used by the final append.
 */
export async function appendHostedMailboxEnvelopeWithPreparedCryptoTx(input: {
  envelope: HostedMailboxProducerEnvelope;
  expiresAt?: Date | string | null;
  itemId?: string;
  prepared: PreparedHostedMailboxItemAppendCrypto;
  sourceMessageLookupKey?: string;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult> {
  const itemId = input.itemId === undefined
    ? undefined
    : requireHostedMailboxItemId(input.itemId);
  if (itemId !== undefined && itemId !== input.envelope.eventId) {
    throw new TypeError(
      "Hosted mailbox item identity must equal the envelope event id.",
    );
  }
  return appendHostedMailboxEnvelopeInternalTx({
    ...input,
    ...(itemId === undefined ? {} : { itemId }),
    encryption: {
      mode: "prepared-root",
      prepared: input.prepared,
    },
  });
}

export async function prepareHostedMailboxEnvelopeAppend(input: {
  envelope: HostedMailboxProducerEnvelope;
  prisma: PrismaClient;
}): Promise<PreparedHostedMailboxEnvelopeAppend> {
  const envelope = input.envelope;
  const lane = resolveHostedMailboxLaneForKind(envelope.kind);
  const encodedPayload = serializeHostedMailboxPayload(envelope);
  const metadata = deriveHostedMailboxStoredPayloadMetadata({
    payloadSerializedJson: encodedPayload.serialized,
    userId: envelope.userId,
  });
  const payloadSchema = HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA;
  const assistantInputLookupKey = envelope.kind === "conversation.message"
    ? requireNonEmptyString(
        createHostedAssistantInputLookupKey(createHostedMailboxAssistantInputId({
          dedupeKey: envelope.eventId,
          eventId: envelope.eventId,
          lane,
          secret: readHostedConversationAssistantIdentifierSecret(envelope),
          userId: envelope.userId,
        })) ?? "",
        "Hosted mailbox assistant input lookup key",
      )
    : null;
  const reserved = await input.prisma.$transaction(async (tx) => {
    await assertHostedMailboxEnvelopeWorkspaceTargetTx({ envelope, tx });
    await tx.hostedWorkspace.upsert({
      create: { userId: envelope.userId },
      update: {},
      where: { userId: envelope.userId },
    });
    await acquireHostedMailboxDedupeAppendLockTx({
      dedupeKey: envelope.eventId,
      tx,
      userId: envelope.userId,
    });
    const existing = await findHostedMailboxItemByDedupeKeyTx({
      dedupeKey: envelope.eventId,
      tx,
      userId: envelope.userId,
    });
    if (existing) {
      if (hasHostedMailboxDedupeConflict({
        existing,
        kind: requireHostedMailboxWritableKind(envelope.kind),
        lane,
        payloadBytes: metadata.payloadBytes,
        payloadHash: metadata.payloadHash,
        payloadSchema,
      })) {
        throw new TypeError("Hosted mailbox prepared append conflicts with an existing event.");
      }
      return { existingItemId: existing.id } as const;
    }
    return { prepared: true } as const;
  });
  if ("existingItemId" in reserved) {
    if (typeof reserved.existingItemId !== "string") {
      throw new TypeError("Hosted mailbox existing item id is missing.");
    }
    return {
      dedupeKey: envelope.eventId,
      existingItemId: requireNonEmptyString(
        reserved.existingItemId,
        "Hosted mailbox existing item id",
      ),
      itemKind: requireHostedMailboxWritableKind(envelope.kind),
      lane,
      mode: "existing",
      payloadBytes: metadata.payloadBytes,
      payloadHash: metadata.payloadHash,
      payloadSchema,
      userId: envelope.userId,
    };
  }
  const itemId = randomUUID();
  const occurredAt = requireDate(envelope.occurredAt, "Hosted mailbox occurredAt");
  const payloadStorage = await encryptHostedMailboxPayloadStorage({
    dedupeKey: envelope.eventId,
    encryption: {
      mode: "legacy-provider-capable",
      prisma: input.prisma,
    },
    itemId,
    kind: requireHostedMailboxWritableKind(envelope.kind),
    lane,
    occurredAt,
    payloadBytes: metadata.payloadBytes,
    payloadSchema,
    serialized: metadata.serialized,
    userId: envelope.userId,
  });
  return {
    assistantInputLookupKey,
    dedupeKey: envelope.eventId,
    expiresAt: null,
    itemId,
    itemKind: requireHostedMailboxWritableKind(envelope.kind),
    lane,
    occurredAt,
    payloadBytes: metadata.payloadBytes,
    payloadHash: metadata.payloadHash,
    payloadSchema,
    payloadStorage,
    sourceMessageLookupKey: null,
    userId: envelope.userId,
    mode: "prepared",
  };
}

export async function appendPreparedHostedMailboxEnvelopeTx(input: {
  prepared: PreparedHostedMailboxEnvelopeAppend;
  tx: HostedMailboxMutationTx;
}): Promise<{ mailboxItemId: string }> {
  if (input.prepared.mode === "existing") {
    await acquireHostedMailboxDedupeAppendLockTx({
      dedupeKey: input.prepared.dedupeKey,
      tx: input.tx,
      userId: input.prepared.userId,
    });
    const existing = await findHostedMailboxItemByDedupeKeyTx({
      dedupeKey: input.prepared.dedupeKey,
      tx: input.tx,
      userId: input.prepared.userId,
    });
    if (
      !existing
      || existing.id !== input.prepared.existingItemId
      || hasHostedMailboxDedupeConflict({
        existing,
        kind: input.prepared.itemKind,
        lane: input.prepared.lane,
        payloadBytes: input.prepared.payloadBytes,
        payloadHash: input.prepared.payloadHash,
        payloadSchema: input.prepared.payloadSchema,
      })
    ) {
      throw new TypeError("Hosted mailbox existing prepared append changed before commit.");
    }
    return { mailboxItemId: existing.id };
  }
  const prepared = input.prepared;
  await acquireHostedMailboxDedupeAppendLockTx({
    dedupeKey: prepared.dedupeKey,
    tx: input.tx,
    userId: prepared.userId,
  });
  const existing = await findHostedMailboxItemByDedupeKeyTx({
    dedupeKey: prepared.dedupeKey,
    tx: input.tx,
    userId: prepared.userId,
  });
  if (existing) {
    if (hasHostedMailboxDedupeConflict({
      existing,
      kind: prepared.itemKind,
      lane: prepared.lane,
      payloadBytes: prepared.payloadBytes,
      payloadHash: prepared.payloadHash,
      payloadSchema: prepared.payloadSchema,
    })) {
      throw new TypeError("Hosted mailbox prepared append changed before commit.");
    }
    return { mailboxItemId: existing.id };
  }
  await acquireHostedMailboxCausalAppendLockTx({
    tx: input.tx,
    userId: prepared.userId,
  });
  const causalSeq = await allocateHostedMailboxCausalSeqTx({
    tx: input.tx,
    userId: prepared.userId,
  });
  const laneSeq = await allocateHostedMailboxLaneSeqTx({
    lane: prepared.lane,
    tx: input.tx,
    userId: prepared.userId,
  });
  const rows = await input.tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO hosted_mailbox_item (
      id, user_id, assistant_input_lookup_key, source_message_lookup_key,
      causal_seq, lane, lane_seq, dedupe_key, kind, occurred_at,
      payload_schema, payload_inline_ciphertext, payload_ref, payload_bytes,
      payload_hash, consumed_at, expires_at, updated_at
    ) VALUES (
      ${prepared.itemId}, ${prepared.userId}, ${prepared.assistantInputLookupKey},
      ${prepared.sourceMessageLookupKey}, ${causalSeq}, ${prepared.lane},
      ${laneSeq}, ${prepared.dedupeKey}, ${prepared.itemKind},
      ${prepared.occurredAt}, ${prepared.payloadSchema},
      ${prepared.payloadStorage.payloadInlineCiphertext},
      ${prepared.payloadStorage.payloadRef}, ${prepared.payloadBytes},
      ${prepared.payloadHash}, NULL, ${prepared.expiresAt}, NOW()
    )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING id
  `;
  const mailboxItemId = rows[0]?.id;
  if (!mailboxItemId) {
    throw new Error("Hosted mailbox prepared append conflict could not be resolved.");
  }
  if (prepared.payloadStorage.storage === "ref") {
    await input.tx.hostedMailboxPayload.create({
      data: {
        mailboxItemId,
        payloadCiphertext: prepared.payloadStorage.payloadCiphertext,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        userId: prepared.userId,
      },
    });
  }
  return { mailboxItemId };
}

export async function appendHostedMailboxEnvelopeWithSourceMessageTx(input: {
  envelope: HostedMailboxProducerEnvelope;
  sourceMessageLookupKey: string;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult> {
  return appendHostedMailboxEnvelopeInternalTx({
    ...input,
    encryption: { mode: "legacy-transaction" },
  });
}

export async function appendHostedMailboxEnvelopeWithIdentityTx(input: {
  envelope: HostedMailboxProducerEnvelope;
  expiresAt: Date | string | null;
  itemId: string;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult> {
  const itemId = requireHostedMailboxItemId(input.itemId);
  if (itemId !== input.envelope.eventId) {
    throw new TypeError("Hosted mailbox item identity must equal the envelope event id.");
  }
  return appendHostedMailboxEnvelopeInternalTx({
    ...input,
    encryption: { mode: "legacy-transaction" },
    itemId,
  });
}

async function appendHostedMailboxEnvelopeInternalTx(input: {
  encryption: HostedMailboxAppendEncryptionOwner;
  envelope: HostedMailboxProducerEnvelope;
  expiresAt?: Date | string | null;
  itemId?: string;
  sourceMessageLookupKey?: string | null;
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
  const lane = resolveHostedMailboxLaneForKind(envelope.kind);
  const assistantInputLookupKey = envelope.kind === "conversation.message"
    ? requireNonEmptyString(
        createHostedAssistantInputLookupKey(createHostedMailboxAssistantInputId({
          dedupeKey: envelope.eventId,
          eventId: envelope.eventId,
          lane,
          secret: readHostedConversationAssistantIdentifierSecret(envelope),
          userId: envelope.userId,
        })) ?? "",
        "Hosted mailbox assistant input lookup key",
      )
    : null;

  return appendHostedMailboxItemWithEncryptionTx({
    assistantInputLookupKey,
    dedupeKey: envelope.eventId,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
    kind: envelope.kind,
    lane,
    occurredAt: envelope.occurredAt,
    payloadSerializedJson: encodedPayload.serialized,
    ...(input.sourceMessageLookupKey === undefined
      ? {}
      : { sourceMessageLookupKey: input.sourceMessageLookupKey }),
    encryption: input.encryption,
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
    ? existing
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

export async function appendHostedEnvironmentVoiceMailboxEnvelopeTx(input: {
  envelope: HostedExecutionEnvironmentVoiceCapturedWake;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult & { claimedAudioKey: string }> {
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
  const canonicalEnvelope =
    existing?.kind === "environment-voice.captured"
    && hasSameEnvironmentVoiceCapture(existing, input.envelope)
      ? existing
      : input.envelope;
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: canonicalEnvelope,
    tx: input.tx,
  });
  return {
    ...appended,
    claimedAudioKey: canonicalEnvelope.environmentVoice.audioKey,
  };
}

function hasSameEnvironmentVoiceCapture(
  existing: HostedExecutionEnvironmentVoiceCapturedWake,
  requested: HostedExecutionEnvironmentVoiceCapturedWake,
): boolean {
  return existing.eventId === requested.eventId
    && existing.userId === requested.userId
    && existing.occurredAt === requested.occurredAt
    && existing.environmentVoice.byteLength
      === requested.environmentVoice.byteLength
    && existing.environmentVoice.captureId
      === requested.environmentVoice.captureId
    && existing.environmentVoice.capturedAt
      === requested.environmentVoice.capturedAt
    && existing.environmentVoice.contentType
      === requested.environmentVoice.contentType
    && existing.environmentVoice.durationMs
      === requested.environmentVoice.durationMs
    && existing.environmentVoice.sha256
      === requested.environmentVoice.sha256;
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

    const row = await prisma.hostedMailboxItem.findFirst({
      orderBy: {
        laneSeq: "desc",
      },
      where: {
        ...buildHostedMailboxLiveItemWhere(now),
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

export async function readHostedMailboxFirstLiveSystemItemAfterSeq(input: {
  afterSeq: bigint | number | string;
  at: Date;
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<{ kind: HostedMailboxKind; laneSeq: string } | null> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const afterSeq = normalizeHostedMailboxSeq(
    input.afterSeq,
    "Hosted mailbox system frontier afterSeq",
  );
  const row = await prisma.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "asc",
    },
    select: {
      kind: true,
      laneSeq: true,
    },
    where: {
      ...buildHostedMailboxLiveItemWhere(input.at),
      lane: "system",
      laneSeq: {
        gt: afterSeq,
      },
      userId,
    },
  });

  return row
    ? {
        kind: requireHostedMailboxKind(row.kind),
        laneSeq: row.laneSeq.toString(),
      }
    : null;
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
      ...buildHostedMailboxLiveItemWhere(new Date()),
      lane: "conversation",
      laneSeq: {
        gt: afterSeq,
      },
      userId,
    },
  });

  return row ? projectHostedMailboxItem(row) : null;
}

export async function hasHostedMailboxMealPhotoCaptureSince(input: {
  prisma?: HostedMailboxStoreClient;
  since: Date;
  userId: string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const row = await prisma.hostedMailboxItem.findFirst({
    select: {
      id: true,
    },
    where: {
      createdAt: {
        gte: input.since,
      },
      kind: "meal-photo.captured",
      lane: "system",
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

export async function readHostedMailboxSourceConversationPreparation(input: {
  preparedAt?: Date;
  prisma?: HostedMailboxStoreClient;
  sourceMessageLookupKeys: readonly string[];
}): Promise<HostedMailboxSourceConversationPreparation> {
  const sourceMessageLookupKeys = normalizeHostedMailboxSourceMessageLookupKeys(
    input.sourceMessageLookupKeys,
  );
  const preparedAt = input.preparedAt ?? new Date();
  return {
    preparedAt,
    rows: sourceMessageLookupKeys.length === 0
      ? []
      : await readHostedMailboxSourceConversationRows({
          prisma: input.prisma ?? getPrisma(),
          sourceMessageLookupKeys,
        }),
    sourceMessageLookupKeys,
  };
}

export async function prewarmHostedMailboxSourceConversationPreparation(input: {
  preparation: HostedMailboxSourceConversationPreparation;
  prisma?: HostedMailboxStoreClient;
}): Promise<void> {
  const payloadEntries = input.preparation.rows.flatMap((row) => {
    const payload = buildHostedMailboxSourceConversationPayloadEntry({
      availableAt: input.preparation.preparedAt,
      row,
    });
    return payload ? [payload.crypto] : [];
  });

  let firstError: unknown;
  let hasError = false;
  try {
    await prewarmHostedMailboxPayloadStrings({
      entries: payloadEntries,
      prisma: input.prisma,
    });
  } catch (error) {
    firstError = error;
    hasError = true;
  }

  const sourceUserIds = new Set(input.preparation.rows.map((row) => row.userId));
  const appendUserId = input.preparation.rows.length <= 6 && sourceUserIds.size === 1
    ? input.preparation.rows[0]?.userId ?? null
    : null;
  if (appendUserId) {
    try {
      await prewarmHostedMailboxPayloadActiveRoot({
        prisma: input.prisma,
        userId: appendUserId,
      });
    } catch (error) {
      if (!hasError) {
        firstError = error;
        hasError = true;
      }
    }
  }

  if (hasError) {
    throw firstError;
  }
}

export async function readHostedMailboxSourceConversationEntriesTx(input: {
  preparation: HostedMailboxSourceConversationPreparation;
  sourceMessageLookupKeys: readonly string[];
  tx: HostedMailboxMutationTx;
}): Promise<HostedMailboxSourceConversationEntry[]> {
  const sourceMessageLookupKeys = normalizeHostedMailboxSourceMessageLookupKeys(
    input.sourceMessageLookupKeys,
  );
  if (
    !areHostedMailboxSourceMessageLookupKeysEqual(
      sourceMessageLookupKeys,
      input.preparation.sourceMessageLookupKeys,
    )
  ) {
    throw new TypeError("Hosted mailbox source preparation does not match its lookup keys.");
  }
  if (sourceMessageLookupKeys.length === 0) {
    return [];
  }

  // Edit planners hold this lock from the lineage read through correction
  // append. Ordinary source-indexed appends do not take it: an edit that races
  // an uncommitted original sees a missing source and uses the bounded provider
  // retry path after the original commits.
  await acquireHostedMailboxSourceMessageLocksTx({
    sourceMessageLookupKeys,
    tx: input.tx,
  });
  const rows = await readHostedMailboxSourceConversationRows({
    prisma: input.tx,
    sourceMessageLookupKeys,
  });
  if (!areHostedMailboxSourceConversationRowsEqual(rows, input.preparation.rows)) {
    throw new HostedMailboxSourceConversationPreparationMismatchError();
  }

  const availableAt = new Date();
  const payloads = rows.map((row) =>
    buildHostedMailboxSourceConversationPayloadEntry({ availableAt, row })
  );
  const decrypted = await decryptHostedMailboxPayloadStringsWithPreparedRoots({
    entries: payloads.flatMap((payload) => payload ? [payload.crypto] : []),
  });
  let decryptedIndex = 0;
  return rows.map((row, rowIndex) => {
    const payload = payloads[rowIndex];
    const serialized = payload ? decrypted[decryptedIndex++] ?? null : null;
    if (!serialized) {
      return {
        contentAvailable: false,
        itemId: row.itemId,
        userId: row.userId,
        wake: null,
      };
    }
    const wake = parseHostedExecutionWake(JSON.parse(serialized));
    const conversationWake = wake.kind === "conversation.message"
      ? wake
      : null;
    return {
      contentAvailable: conversationWake !== null,
      itemId: row.itemId,
      userId: row.userId,
      wake: conversationWake,
    };
  });
}

const HOSTED_MAILBOX_SOURCE_CONVERSATION_MAX_ROWS = 7;
const HOSTED_MAILBOX_SOURCE_MESSAGE_MAX_LOOKUP_KEYS = 2;

async function readHostedMailboxSourceConversationRows(input: {
  prisma: HostedMailboxStoreClient;
  sourceMessageLookupKeys: readonly string[];
}): Promise<HostedMailboxSourceConversationPreparationRow[]> {
  return input.prisma.$queryRaw<HostedMailboxSourceConversationPreparationRow[]>(
    Prisma.sql`
      SELECT
        item.id AS "itemId",
        item.user_id AS "userId",
        item.source_message_lookup_key AS "sourceMessageLookupKey",
        item.causal_seq AS "causalSeq",
        item.lane,
        item.lane_seq AS "laneSeq",
        item.dedupe_key AS "dedupeKey",
        item.kind,
        item.occurred_at AS "occurredAt",
        item.payload_schema AS "payloadSchema",
        item.payload_inline_ciphertext AS "payloadInlineCiphertext",
        item.payload_ref AS "payloadRef",
        item.created_at AS "createdAt",
        item.expires_at AS "expiresAt",
        payload.mailbox_item_id AS "sidecarMailboxItemId",
        payload.user_id AS "sidecarUserId",
        payload.payload_ciphertext AS "sidecarPayloadCiphertext",
        payload.payload_schema AS "sidecarPayloadSchema"
      FROM hosted_mailbox_item AS item
      LEFT JOIN hosted_mailbox_payload AS payload
        ON payload.mailbox_item_id = item.id
       AND item.payload_inline_ciphertext IS NULL
       AND (
         item.payload_ref = item.id
         OR item.payload_ref = ${HOSTED_MAILBOX_PAYLOAD_REF_PREFIX} || item.id
       )
      WHERE item.kind = 'conversation.message'
        AND item.source_message_lookup_key IN (${Prisma.join(input.sourceMessageLookupKeys)})
      ORDER BY item.causal_seq ASC NULLS FIRST, item.id ASC
      LIMIT ${HOSTED_MAILBOX_SOURCE_CONVERSATION_MAX_ROWS}
    `,
  );
}

function buildHostedMailboxSourceConversationPayloadEntry(input: {
  availableAt: Date;
  row: HostedMailboxSourceConversationPreparationRow;
}): {
  crypto: HostedMailboxPayloadCryptoMetadata & {
    value: string;
  };
} | null {
  if (isHostedMailboxItemExpired(input.row, input.availableAt)) {
    return null;
  }
  const inlineCiphertext = normalizeNullableString(
    input.row.payloadInlineCiphertext,
  );
  if (inlineCiphertext) {
    return {
      crypto: {
        dedupeKey: input.row.dedupeKey,
        itemId: input.row.itemId,
        kind: input.row.kind,
        lane: input.row.lane,
        laneSeq: input.row.laneSeq,
        occurredAt: input.row.occurredAt.toISOString(),
        payloadSchema: input.row.payloadSchema,
        payloadStorage: "inline",
        userId: input.row.userId,
        value: inlineCiphertext,
      },
    };
  }

  const payloadRef = normalizeNullableString(input.row.payloadRef);
  const sidecarCiphertext = normalizeNullableString(
    input.row.sidecarPayloadCiphertext,
  );
  if (
    !payloadRef
    || resolveHostedMailboxPayloadRef(payloadRef) !== input.row.itemId
    || input.row.sidecarMailboxItemId !== input.row.itemId
    || input.row.sidecarUserId !== input.row.userId
    || !sidecarCiphertext
  ) {
    return null;
  }
  return {
    crypto: {
      dedupeKey: input.row.dedupeKey,
      itemId: input.row.itemId,
      kind: input.row.kind,
      lane: input.row.lane,
      laneSeq: input.row.laneSeq,
      occurredAt: input.row.occurredAt.toISOString(),
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadStorage: "sidecar",
      userId: input.row.userId,
      value: sidecarCiphertext,
    },
  };
}

function areHostedMailboxSourceConversationRowsEqual(
  current: readonly HostedMailboxSourceConversationPreparationRow[],
  prepared: readonly HostedMailboxSourceConversationPreparationRow[],
): boolean {
  return current.length === prepared.length
    && current.every((row, index) => {
      const candidate = prepared[index];
      return candidate !== undefined
        && row.itemId === candidate.itemId
        && row.userId === candidate.userId
        && row.sourceMessageLookupKey === candidate.sourceMessageLookupKey
        && row.causalSeq === candidate.causalSeq
        && row.lane === candidate.lane
        && row.laneSeq === candidate.laneSeq
        && row.dedupeKey === candidate.dedupeKey
        && row.kind === candidate.kind
        && row.occurredAt.getTime() === candidate.occurredAt.getTime()
        && row.payloadSchema === candidate.payloadSchema
        && row.payloadInlineCiphertext === candidate.payloadInlineCiphertext
        && row.payloadRef === candidate.payloadRef
        && row.createdAt.getTime() === candidate.createdAt.getTime()
        && nullableHostedMailboxDateEquals(row.expiresAt, candidate.expiresAt)
        && row.sidecarMailboxItemId === candidate.sidecarMailboxItemId
        && row.sidecarUserId === candidate.sidecarUserId
        && row.sidecarPayloadCiphertext === candidate.sidecarPayloadCiphertext
        && row.sidecarPayloadSchema === candidate.sidecarPayloadSchema;
    });
}

function nullableHostedMailboxDateEquals(
  left: Date | null,
  right: Date | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

function areHostedMailboxSourceMessageLookupKeysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export async function readHostedMailboxWakeByItemId(input: {
  availableAt?: Date;
  mailboxItemId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<HostedExecutionWake | null> {
  const prisma = input.prisma ?? getPrisma();
  const item = await readHostedMailboxLiveItemById({
    availableAt: input.availableAt ?? new Date(),
    mailboxItemId: input.mailboxItemId,
    prisma,
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

export async function hasPendingHostedEnvironmentVoiceMailboxItemTx(input: {
  tx: HostedMailboxMutationTx;
  userId: string;
}): Promise<boolean> {
  return await hasPendingHostedEnvironmentVoiceMailboxItem({
    prisma: input.tx,
    userId: input.userId,
  });
}

export async function hasPendingHostedEnvironmentVoiceMailboxItem(input: {
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const laneCounter = await prisma.hostedMailboxLaneCounter.findUnique({
    select: { consumedSeq: true },
    where: {
      userId_lane: {
        lane: "system",
        userId: input.userId,
      },
    },
  });
  const item = await prisma.hostedMailboxItem.findFirst({
    select: { id: true },
    where: {
      kind: "environment-voice.captured",
      lane: "system",
      laneSeq: {
        gt: laneCounter?.consumedSeq ?? 0n,
      },
      userId: input.userId,
    },
  });
  return item !== null;
}

export async function readHostedMailboxUserIdsByKind(input: {
  kind: HostedMailboxKind | string;
  prisma?: HostedMailboxStoreClient;
  userIds: readonly string[];
}): Promise<ReadonlySet<string>> {
  const prisma = input.prisma ?? getPrisma();
  const kind = requireHostedMailboxKind(input.kind);
  const userIds = [
    ...new Set(
      input.userIds.map((userId) =>
        requireNonEmptyString(userId, "Hosted mailbox userId")
      ),
    ),
  ];
  if (userIds.length === 0) {
    return new Set();
  }

  const records = await prisma.hostedMailboxItem.groupBy({
    by: ["userId"],
    where: {
      kind,
      userId: { in: userIds },
    },
  });

  return new Set(records.map((record) => record.userId));
}

export async function hasPendingHostedEnvironmentInterviewMailboxItem(input: {
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<boolean> {
  return (await readPendingHostedEnvironmentInterviewMailboxItem(input)) !== null;
}

export async function readPendingHostedEnvironmentInterviewMailboxItem(input: {
  prisma?: HostedMailboxStoreClient;
  userId: string;
}): Promise<{ id: string } | null> {
  const prisma = input.prisma ?? getPrisma();
  const laneCounter = await prisma.hostedMailboxLaneCounter.findUnique({
    select: { consumedSeq: true },
    where: {
      userId_lane: {
        lane: "system",
        userId: input.userId,
      },
    },
  });
  const item = await prisma.hostedMailboxItem.findFirst({
    orderBy: { laneSeq: "asc" },
    select: { id: true },
    where: {
      kind: "environment-interview.completed",
      lane: "system",
      laneSeq: {
        gt: laneCounter?.consumedSeq ?? 0n,
      },
      userId: input.userId,
    },
  });
  return item;
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

  if (isHostedMailboxItemExpired(item, fetchedAt)) {
    return {
      payload: null,
      retryable: false,
      unavailableCode: "expired",
    };
  }

  const row = await prisma.hostedMailboxPayload.findFirst({
    where: {
      mailboxItem: buildHostedMailboxLiveItemWhere(fetchedAt),
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

export interface HostedMailboxConversationInputAuthority {
  causalSeq: string;
  occurredAt: string;
}

export type HostedMailboxSubscriptionActionClaimResult =
  | "claimed"
  | "conflict"
  | "replayed";

export async function claimHostedMailboxConversationSubscriptionAction(input: {
  action: HostedRuntimeSubscriptionAction;
  actionClaim?: string;
  assistantInputId: string;
  memberId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<HostedMailboxSubscriptionActionClaimResult | null> {
  const prisma = input.prisma ?? getPrisma();

  if (isHostedMailboxRootClient(prisma)) {
    return prisma.$transaction((tx) =>
      claimHostedMailboxConversationSubscriptionActionTx({
        ...input,
        tx,
      })
    );
  }

  return claimHostedMailboxConversationSubscriptionActionTx({
    ...input,
    tx: prisma,
  });
}

async function claimHostedMailboxConversationSubscriptionActionTx(input: {
  action: HostedRuntimeSubscriptionAction;
  actionClaim?: string;
  assistantInputId: string;
  memberId: string;
  tx: HostedMailboxMutationTx;
}): Promise<HostedMailboxSubscriptionActionClaimResult | null> {
  const assistantInputId = normalizeNullableString(input.assistantInputId);
  const memberId = normalizeNullableString(input.memberId);
  const actionClaim = normalizeNullableString(
    input.actionClaim ?? input.action,
  );
  const assistantInputLookupKeys = assistantInputId
    ? createHostedAssistantInputLookupKeyReadCandidates(assistantInputId)
    : [];

  if (
    assistantInputLookupKeys.length === 0
    || !memberId
    || !actionClaim
    || actionClaim.length > 512
  ) {
    return null;
  }

  const now = new Date();
  const authorityWhere = {
    assistantInputLookupKey: {
      in: assistantInputLookupKeys,
    },
    causalSeq: {
      not: null,
    },
    kind: "conversation.message",
    lane: "conversation",
    ...buildHostedMailboxLiveItemWhere(now),
    userId: memberId,
  } as const;
  const rows = await input.tx.hostedMailboxItem.findMany({
    select: {
      id: true,
      subscriptionActionClaim: true,
    },
    take: 2,
    where: authorityWhere,
  });

  const row = rows[0];
  if (!row || rows.length !== 1) {
    return null;
  }
  if (row.subscriptionActionClaim === actionClaim) {
    return "replayed";
  }
  if (row.subscriptionActionClaim !== null) {
    return "conflict";
  }

  const claimed = await input.tx.hostedMailboxItem.updateMany({
    data: {
      subscriptionActionClaim: actionClaim,
    },
    where: {
      ...authorityWhere,
      id: row.id,
      subscriptionActionClaim: null,
    },
  });
  if (claimed.count === 1) {
    return "claimed";
  }

  const raced = await input.tx.hostedMailboxItem.findFirst({
    select: {
      subscriptionActionClaim: true,
    },
    where: {
      ...authorityWhere,
      id: row.id,
    },
  });
  if (raced?.subscriptionActionClaim === actionClaim) {
    return "replayed";
  }
  return raced?.subscriptionActionClaim ? "conflict" : null;
}

export async function readHostedMailboxConversationInputAuthorityByAssistantInputIdTx(input: {
  assistantInputId: string;
  memberId: string;
  prisma: HostedMailboxStoreClient;
}): Promise<HostedMailboxConversationInputAuthority | null> {
  const assistantInputId = normalizeNullableString(input.assistantInputId);
  const memberId = normalizeNullableString(input.memberId);
  const assistantInputLookupKeys = assistantInputId
    ? createHostedAssistantInputLookupKeyReadCandidates(assistantInputId)
    : [];

  if (assistantInputLookupKeys.length === 0 || !memberId) {
    return null;
  }

  const rows = await input.prisma.hostedMailboxItem.findMany({
    select: {
      causalSeq: true,
      occurredAt: true,
    },
    take: 2,
    where: {
      assistantInputLookupKey: {
        in: assistantInputLookupKeys,
      },
      causalSeq: {
        not: null,
      },
      kind: "conversation.message",
      lane: "conversation",
      ...buildHostedMailboxLiveItemWhere(new Date()),
      userId: memberId,
    },
  });

  const causalSeq = rows[0]?.causalSeq;
  const occurredAt = rows[0]?.occurredAt;
  if (
    rows.length !== 1
    || causalSeq === undefined
    || causalSeq === null
    || occurredAt === undefined
  ) {
    return null;
  }

  return {
    causalSeq: causalSeq.toString(),
    occurredAt: occurredAt.toISOString(),
  };
}

export async function readHostedMailboxConversationWakeByAssistantInputId(input: {
  assistantInputId: string;
  availableAt?: Date;
  memberId: string;
  prisma?: HostedMailboxStoreClient;
}): Promise<HostedExecutionConversationMessageWake | null> {
  const prisma = input.prisma ?? getPrisma();
  const assistantInputId = normalizeNullableString(input.assistantInputId);
  const memberId = normalizeNullableString(input.memberId);
  const assistantInputLookupKeys = assistantInputId
    ? createHostedAssistantInputLookupKeyReadCandidates(assistantInputId)
    : [];
  const availableAt = input.availableAt ?? new Date();

  if (assistantInputLookupKeys.length === 0 || !memberId) {
    return null;
  }

  const rows = await prisma.hostedMailboxItem.findMany({
    select: { id: true },
    take: 2,
    where: {
      assistantInputLookupKey: { in: assistantInputLookupKeys },
      kind: "conversation.message",
      lane: "conversation",
      ...buildHostedMailboxLiveItemWhere(availableAt),
      userId: memberId,
    },
  });
  if (rows.length !== 1 || !rows[0]) {
    return null;
  }

  const wake = await readHostedMailboxWakeByItemId({
    availableAt,
    mailboxItemId: rows[0].id,
    prisma,
  });
  return wake?.kind === "conversation.message" ? wake : null;
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

export async function acquireHostedMailboxSourceMessageLocksTx(input: {
  sourceMessageLookupKeys: readonly string[];
  tx: HostedMailboxMutationTx;
}): Promise<void> {
  const sourceMessageLookupKeys = normalizeHostedMailboxSourceMessageLookupKeys(
    input.sourceMessageLookupKeys,
  );
  for (const sourceMessageLookupKey of sourceMessageLookupKeys) {
    await input.tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('mailbox-source-message'),
        hashtext(${sourceMessageLookupKey})
      )
    `;
  }
}

function normalizeHostedMailboxSourceMessageLookupKeys(
  values: readonly string[],
): string[] {
  const normalized = [...new Set(values.map((value) =>
    requireNonEmptyString(value, "Hosted mailbox sourceMessageLookupKey")
  ))].sort();
  if (normalized.length > HOSTED_MAILBOX_SOURCE_MESSAGE_MAX_LOOKUP_KEYS) {
    throw new TypeError(
      `Hosted mailbox source lookup accepts at most ${HOSTED_MAILBOX_SOURCE_MESSAGE_MAX_LOOKUP_KEYS} privacy versions.`,
    );
  }
  return normalized;
}

function recordHostedMailboxDedupeConflictLog(input: {
  dedupeConflict: boolean;
  existing: HostedMailboxItemRow;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  payloadBytes: number;
  payloadHash: string | null;
  payloadSchema: string;
}): void {
  if (!input.dedupeConflict) {
    return;
  }

  // The mailbox row is already the durable append authority. Keep only this
  // rare mismatch in platform logs, with content-free metadata, so optional
  // diagnostics cannot add work to or abort the canonical transaction.
  console.warn(
    "Hosted mailbox dedupe conflict.",
    summarizeHostedMailboxDedupeConflictForLog(input),
  );
}

function summarizeHostedMailboxDedupeConflictForLog(input: {
  existing: HostedMailboxItemRow;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  payloadBytes: number;
  payloadHash: string | null;
  payloadSchema: string;
}) {
  return {
    component: "mailbox",
    eventCode: "mailbox.dedupe_conflict",
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
  };
}

export async function hydrateHostedMailboxItemTx(input: {
  record: HostedMailboxItemRow;
}): Promise<HostedMailboxItemRecord> {
  return projectHostedMailboxItem(input.record);
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

function normalizeHostedMailboxAppendInput(
  input: AppendHostedMailboxItemBaseInput,
): NormalizedHostedMailboxAppendInput {
  const userId = requireNonEmptyString(input.userId, "Hosted mailbox userId");
  const lane = requireHostedMailboxLane(input.lane);
  const dedupeKey = requireNonEmptyString(
    input.dedupeKey,
    "Hosted mailbox dedupeKey",
  );
  const kind = requireHostedMailboxWritableKind(input.kind);
  const occurredAt = new Date(
    requireDate(input.occurredAt, "Hosted mailbox occurredAt").getTime(),
  );
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null
    ? null
    : new Date(
        requireDate(input.expiresAt, "Hosted mailbox expiresAt").getTime(),
      );
  const payloadSchema = normalizeNullableString(input.payloadSchema)
    ?? HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA;
  const payloadMetadata = deriveHostedMailboxStoredPayloadMetadata({
    payloadSerializedJson: input.payloadSerializedJson,
    userId,
  });

  return {
    dedupeKey,
    expiresAt,
    kind,
    lane,
    occurredAt,
    payloadBytes: payloadMetadata.payloadBytes,
    payloadHash: payloadMetadata.payloadHash,
    payloadSchema,
    serialized: payloadMetadata.serialized,
    userId,
  };
}

async function encryptHostedMailboxPayloadStorage(input: {
  dedupeKey: string;
  encryption: HostedMailboxPayloadEncryptionOwner;
  itemId: string;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  laneSeq?: bigint;
  occurredAt: Date;
  payloadBytes: number;
  payloadSchema: string;
  serialized: string;
  userId: string;
}): Promise<HostedMailboxEncryptedPayloadStorage> {
  const payloadStorage: HostedMailboxPayloadStorage = input.payloadBytes <= HOSTED_MAILBOX_MAX_INLINE_PAYLOAD_BYTES
    ? "inline"
    : "sidecar";
  const aadPayloadSchema = payloadStorage === "inline"
    ? input.payloadSchema
    : HOSTED_MAILBOX_PAYLOAD_SCHEMA;
  const encryptionInput = {
    dedupeKey: input.dedupeKey,
    itemId: input.itemId,
    kind: input.kind,
    lane: input.lane,
    occurredAt: input.occurredAt.toISOString(),
    payloadSchema: aadPayloadSchema,
    payloadStorage,
    userId: input.userId,
    value: input.serialized,
  };
  const ciphertext = input.laneSeq === undefined
    ? await encryptPreparedHostedMailboxPayloadString(encryptionInput)
    : input.encryption.mode === "prepared-root-local-only"
    ? await encryptHostedMailboxPayloadStringFromPreparedRoot({
        ...encryptionInput,
        laneSeq: input.laneSeq,
        preparedRoot: input.encryption.root,
        preparedRootKeyId: input.encryption.rootKeyId,
      })
    : await encryptHostedMailboxPayloadString({
        ...encryptionInput,
        laneSeq: input.laneSeq,
        prisma: input.encryption.prisma,
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

async function buildHostedMailboxDuplicateResult(input: {
  existing: HostedMailboxItemRow;
  normalized: NormalizedHostedMailboxAppendInput;
}): Promise<AppendHostedMailboxItemResult> {
  return {
    duplicate: true,
    dedupeConflict: hasHostedMailboxDedupeConflict({
      existing: input.existing,
      kind: input.normalized.kind,
      lane: input.normalized.lane,
      payloadBytes: input.normalized.payloadBytes,
      payloadHash: input.normalized.payloadHash,
      payloadSchema: input.normalized.payloadSchema,
    }),
    inserted: false,
    item: await hydrateHostedMailboxItemTx({
      record: input.existing,
    }),
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

export function resolveHostedMailboxPayloadRef(payloadRef: string): string {
  return payloadRef.startsWith(HOSTED_MAILBOX_PAYLOAD_REF_PREFIX)
    ? payloadRef.slice(HOSTED_MAILBOX_PAYLOAD_REF_PREFIX.length)
    : payloadRef;
}

const HOSTED_MAILBOX_FETCH_LIMIT_MAX = 100;
// The read filter below and the retention DELETE in hosted-retention/cleanup.ts
// must apply the same window: a read that still surfaces rows the sweep has
// already deleted (or hides rows it has not) desynchronizes the consumed
// watermark. Exported so cleanup.ts consumes this value rather than restating
// it. Retention direction is one-way — cleanup depends on the mailbox, never
// the reverse — so this stays the single definition.
export const HOSTED_MAILBOX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

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
      ...buildHostedMailboxLiveItemWhere(input.at),
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
      ...buildHostedMailboxLiveItemWhere(now),
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
  item: Pick<HostedMailboxItemRow, "createdAt" | "expiresAt">,
  at: Date,
): boolean {
  return (
    (item.expiresAt !== null && item.expiresAt.getTime() <= at.getTime())
    || item.createdAt.getTime() <= at.getTime() - HOSTED_MAILBOX_RETENTION_MS
  );
}

export function buildHostedMailboxLiveItemWhere(at: Date): {
  createdAt: { gt: Date };
  OR: [{ expiresAt: null }, { expiresAt: { gt: Date } }];
} {
  return {
    createdAt: {
      gt: new Date(at.getTime() - HOSTED_MAILBOX_RETENTION_MS),
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

function requireHostedMailboxWritableKind(value: string): HostedMailboxKind {
  const kind = requireHostedMailboxKind(value);

  if (isHostedRetiredMailboxKind(kind)) {
    throw new TypeError("Hosted mailbox retired kinds are read-only.");
  }

  return kind;
}

function requireNonEmptyString(value: string, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }

  return normalized;
}

function requireHostedMailboxItemId(value: string): string {
  const itemId = requireNonEmptyString(value, "Hosted mailbox item id");
  if (itemId.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(itemId)) {
    throw new TypeError("Hosted mailbox item id is invalid.");
  }
  return itemId;
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
