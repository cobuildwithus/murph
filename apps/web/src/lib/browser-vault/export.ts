import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
  type HostedBrowserSessionKeyEnvelope,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
  parseHostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaContentEncoding,
  type HostedBrowserVaultReplicaMetricBucketId,
  type HostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaShardKind,
} from "@murphai/hosted-execution/browser-vault";
import {
  assembleBrowserVaultLabsReplica,
  assembleBrowserVaultLoadedMetricRows,
  assembleBrowserVaultMetricsIndexReplica,
  BROWSER_VAULT_CORE_SHARD_SCHEMA,
  BROWSER_VAULT_LABS_SHARD_SCHEMA,
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
  BROWSER_VAULT_METRICS_SHARD_SCHEMA,
  parseBrowserVaultCoreShard,
  parseBrowserVaultLabsShard,
  parseBrowserVaultMetricBucketShard,
  parseBrowserVaultMetricsShard,
  parseBrowserVaultReplica,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "@murphai/query/browser-replica-client";

import type { SensitiveActionAuthorization } from "@/src/lib/sensitive-actions/shared";

const SETTINGS_VAULT_EXPORT_ENDPOINT = "/api/settings/vault-export/session";
const VAULT_EXPORT_MIME_TYPE = "application/json; charset=utf-8";
const textDecoder = new TextDecoder();

export interface BrowserVaultExportResult {
  blob: Blob;
  deviceSyncImportPending: boolean;
  freshness: "fresh" | "stale";
  generatedAt: string;
  refreshPending: boolean;
  workspaceVersion: string | null;
}

export interface LoadBrowserVaultExportInput {
  authorization: SensitiveActionAuthorization;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class BrowserVaultExportUnauthorizedError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(`Browser vault export failed with HTTP ${status}: ${message}`);
    this.name = "BrowserVaultExportUnauthorizedError";
    this.status = status;
  }
}

export async function loadBrowserVaultExport({
  authorization,
  fetchImpl = fetch,
  signal,
}: LoadBrowserVaultExportInput): Promise<BrowserVaultExportResult> {
  assertNotAborted(signal);
  const { privateKeyJwk, publicKeyJwk } =
    await generateHostedUserRecipientKeyPair();
  assertNotAborted(signal);
  const acceptsBucketedReplica = typeof DecompressionStream === "function";
  const response = await fetchImpl(SETTINGS_VAULT_EXPORT_ENDPOINT, {
    body: JSON.stringify({
      authorization,
      browserPublicKeyJwk: publicKeyJwk,
      ...(acceptsBucketedReplica
        ? {
            requestedMetricBuckets:
              HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
            requestedShards: HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
          }
        : {}),
    }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    const status = response.status === 401 ? 401 : 403;
    throw new BrowserVaultExportUnauthorizedError(
      status,
      await readJsonErrorMessage(response),
    );
  }
  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response));
  }

  assertNotAborted(signal);
  const session = parseBrowserVaultExportSession(await response.json());
  assertNotAborted(signal);
  assertBrowserVaultExportSessionMatchesAtomicRef(session);

  // Both transports wrap one replica data key. Unwrap it exactly once, after
  // the complete response has passed its atomic ref/AAD validation.
  const replicaKey = await unwrapHostedBrowserSessionKey({
    envelope: session.replicaKeyEnvelope,
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  assertNotAborted(signal);
  const payload = session.transport === "legacy"
    ? await loadLegacyBrowserVaultExport({ replicaKey, session, signal })
    : await loadBucketedBrowserVaultExport({ replicaKey, session, signal });

  return {
    blob: payload.blob,
    deviceSyncImportPending: session.deviceSyncImportPending,
    freshness: session.freshness,
    generatedAt: payload.generatedAt,
    refreshPending: session.refreshPending,
    workspaceVersion: session.workspaceVersion,
  };
}

export function normalizeBrowserVaultExportError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/HTTP 401|HTTP 403/u.test(message)) {
    return "Your dashboard session expired. Refresh and try again.";
  }
  if (/HTTP 404/u.test(message)) {
    return "Your dashboard data is not available yet.";
  }
  return "Your dashboard data is not available right now.";
}

interface BrowserVaultReplicaAad {
  dataKeyId?: string;
  dataKeyRootKeyId?: string;
  dataVersion: string;
  generatedAt?: string;
  generation?: number;
  objectKey: string;
  purpose: "browser-vault-replica";
  runtimeRootKeyId: string;
  schema: "murph.browser-vault-replica";
  sourceBundleHash: string;
  userId: string;
}

interface BrowserVaultReplicaShardAad extends BrowserVaultReplicaAad {
  byteLength: number;
  contentEncoding: HostedBrowserVaultReplicaContentEncoding;
  encodedByteLength: number;
  shard: HostedBrowserVaultReplicaShardKind;
  shardSchema: string;
  shardSetRefSchema: typeof HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA;
}

interface BrowserVaultReplicaMetricBucketAad extends BrowserVaultReplicaAad {
  byteLength: number;
  contentEncoding: HostedBrowserVaultReplicaContentEncoding;
  encodedByteLength: number;
  metricBucketCount: typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT;
  metricBucketId: HostedBrowserVaultReplicaMetricBucketId;
  metricBucketSchema: typeof BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA;
  metricBucketSetRefSchema:
    typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA;
}

interface BrowserVaultEncryptedShard {
  encryptedShard: HostedCipherEnvelope;
  shardAad: BrowserVaultReplicaShardAad;
}

interface BrowserVaultEncryptedMetricBucket {
  encryptedMetricBucket: HostedCipherEnvelope;
  metricBucketAad: BrowserVaultReplicaMetricBucketAad;
}

interface BrowserVaultExportSessionMetadata {
  deviceSyncImportPending: boolean;
  freshness: "fresh" | "stale";
  refreshPending: boolean;
  workspaceVersion: string | null;
}

type BrowserVaultExportSession = BrowserVaultExportSessionMetadata & (
  | {
      encryptedReplica: HostedCipherEnvelope;
      replicaAad: BrowserVaultReplicaAad;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      transport: "legacy";
    }
  | {
      metricBuckets: Record<
        HostedBrowserVaultReplicaMetricBucketId,
        BrowserVaultEncryptedMetricBucket
      >;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      shards: Record<HostedBrowserVaultReplicaShardKind, BrowserVaultEncryptedShard>;
      transport: "bucketed";
    }
);

function parseBrowserVaultExportSession(value: unknown): BrowserVaultExportSession {
  const record = requireRecord(value, "Browser vault export response");
  if (record.state !== "ready") {
    throw new TypeError("Browser vault export response.state must be ready.");
  }
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Browser vault export response.replicaRef",
  );
  if (!replicaRef) {
    throw new TypeError("Browser vault export response.replicaRef must not be null.");
  }
  const shared = {
    deviceSyncImportPending: readOptionalBoolean(
      record.deviceSyncImportPending,
      false,
      "Browser vault export response.deviceSyncImportPending",
    ),
    freshness: parseFreshness(record.freshness),
    refreshPending: readOptionalBoolean(
      record.refreshPending,
      false,
      "Browser vault export response.refreshPending",
    ),
    replicaKeyEnvelope: parseHostedBrowserSessionKeyEnvelope(
      record.replicaKeyEnvelope,
      "Browser vault export response.replicaKeyEnvelope",
    ),
    replicaRef,
    workspaceVersion: readOptionalNullableString(
      record.workspaceVersion,
      "Browser vault export response.workspaceVersion",
    ),
  };

  if (record.shards !== undefined || record.metricBuckets !== undefined) {
    if (record.shards === undefined || record.metricBuckets === undefined) {
      throw new TypeError(
        "Browser vault export response requires fixed shards and metric buckets together.",
      );
    }
    if (record.encryptedReplica !== undefined && record.encryptedReplica !== null) {
      throw new TypeError(
        "Browser vault bucketed export response.encryptedReplica must be null or omitted.",
      );
    }
    if (record.replicaAad !== undefined && record.replicaAad !== null) {
      throw new TypeError(
        "Browser vault bucketed export response.replicaAad must be null or omitted.",
      );
    }
    return {
      ...shared,
      metricBuckets: parseEncryptedMetricBuckets(record.metricBuckets),
      shards: parseEncryptedShards(record.shards),
      transport: "bucketed",
    };
  }

  return {
    ...shared,
    encryptedReplica: parseHostedCipherEnvelope(
      record.encryptedReplica,
      "Browser vault export response.encryptedReplica",
    ),
    replicaAad: parseReplicaAad(
      record.replicaAad,
      "Browser vault export response.replicaAad",
      false,
    ),
    transport: "legacy",
  };
}

function parseEncryptedShards(
  value: unknown,
): Record<HostedBrowserVaultReplicaShardKind, BrowserVaultEncryptedShard> {
  const record = requireExactRecord(
    value,
    HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
    "Browser vault export response.shards",
  );
  return Object.fromEntries(
    HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS.map((shard) => {
      const label = `Browser vault export response.shards.${shard}`;
      const entry = requireRecord(record[shard], label);
      const shardAad = parseShardAad(entry.shardAad, `${label}.shardAad`);
      if (shardAad.shard !== shard) {
        throw new TypeError(`${label}.shardAad.shard must be ${shard}.`);
      }
      return [
        shard,
        {
          encryptedShard: parseHostedCipherEnvelope(
            entry.encryptedShard,
            `${label}.encryptedShard`,
          ),
          shardAad,
        },
      ];
    }),
  ) as Record<HostedBrowserVaultReplicaShardKind, BrowserVaultEncryptedShard>;
}

function parseEncryptedMetricBuckets(
  value: unknown,
): Record<HostedBrowserVaultReplicaMetricBucketId, BrowserVaultEncryptedMetricBucket> {
  const record = requireExactRecord(
    value,
    HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
    "Browser vault export response.metricBuckets",
  );
  return Object.fromEntries(
    HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) => {
      const label = `Browser vault export response.metricBuckets.${bucketId}`;
      const entry = requireRecord(record[bucketId], label);
      const metricBucketAad = parseMetricBucketAad(
        entry.metricBucketAad,
        `${label}.metricBucketAad`,
      );
      if (metricBucketAad.metricBucketId !== bucketId) {
        throw new TypeError(
          `${label}.metricBucketAad.metricBucketId must be ${bucketId}.`,
        );
      }
      return [
        bucketId,
        {
          encryptedMetricBucket: parseHostedCipherEnvelope(
            entry.encryptedMetricBucket,
            `${label}.encryptedMetricBucket`,
          ),
          metricBucketAad,
        },
      ];
    }),
  ) as Record<
    HostedBrowserVaultReplicaMetricBucketId,
    BrowserVaultEncryptedMetricBucket
  >;
}

function parseReplicaAad(
  value: unknown,
  label: string,
  requireGeneratedAt: boolean,
): BrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireString(record.purpose, `${label}.purpose`);
  const schema = requireString(record.schema, `${label}.schema`);
  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.`);
  }
  const generatedAt = record.generatedAt === undefined
    ? undefined
    : requireIsoTimestamp(record.generatedAt, `${label}.generatedAt`);
  if (requireGeneratedAt && generatedAt === undefined) {
    throw new TypeError(`${label}.generatedAt is required.`);
  }
  return {
    ...(record.dataKeyId === undefined
      ? {}
      : { dataKeyId: requireString(record.dataKeyId, `${label}.dataKeyId`) }),
    ...(record.dataKeyRootKeyId === undefined
      ? {}
      : {
          dataKeyRootKeyId: requireString(
            record.dataKeyRootKeyId,
            `${label}.dataKeyRootKeyId`,
          ),
        }),
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    ...(generatedAt === undefined ? {} : { generatedAt }),
    ...(record.generation === undefined
      ? {}
      : { generation: requirePositiveSafeInteger(record.generation, `${label}.generation`) }),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    purpose,
    runtimeRootKeyId: requireString(
      record.runtimeRootKeyId,
      `${label}.runtimeRootKeyId`,
    ),
    schema,
    sourceBundleHash: requireString(
      record.sourceBundleHash,
      `${label}.sourceBundleHash`,
    ),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function parseShardAad(
  value: unknown,
  label: string,
): BrowserVaultReplicaShardAad {
  const record = requireRecord(value, label);
  const base = parseReplicaAad(record, label, true);
  const shard = requireHostedShardKind(record.shard, `${label}.shard`);
  const shardSchema = requireString(record.shardSchema, `${label}.shardSchema`);
  const expectedSchema = getQueryShardSchema(shard);
  if (shardSchema !== expectedSchema) {
    throw new TypeError(`${label}.shardSchema must be ${expectedSchema}.`);
  }
  const shardSetRefSchema = requireString(
    record.shardSetRefSchema,
    `${label}.shardSetRefSchema`,
  );
  if (shardSetRefSchema !== HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA) {
    throw new TypeError(
      `${label}.shardSetRefSchema must be ${HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA}.`,
    );
  }
  return {
    ...base,
    ...parseEncodedChildFields(record, label),
    shard,
    shardSchema,
    shardSetRefSchema,
  };
}

function parseMetricBucketAad(
  value: unknown,
  label: string,
): BrowserVaultReplicaMetricBucketAad {
  const record = requireRecord(value, label);
  const base = parseReplicaAad(record, label, true);
  const metricBucketCount = requirePositiveSafeInteger(
    record.metricBucketCount,
    `${label}.metricBucketCount`,
  );
  if (metricBucketCount !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT) {
    throw new TypeError(
      `${label}.metricBucketCount must be ${HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT}.`,
    );
  }
  const metricBucketId = requireMetricBucketId(
    record.metricBucketId,
    `${label}.metricBucketId`,
  );
  const metricBucketSchema = requireString(
    record.metricBucketSchema,
    `${label}.metricBucketSchema`,
  );
  if (metricBucketSchema !== BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA) {
    throw new TypeError(
      `${label}.metricBucketSchema must be ${BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA}.`,
    );
  }
  const metricBucketSetRefSchema = requireString(
    record.metricBucketSetRefSchema,
    `${label}.metricBucketSetRefSchema`,
  );
  if (
    metricBucketSetRefSchema
    !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA
  ) {
    throw new TypeError(
      `${label}.metricBucketSetRefSchema must be ${HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA}.`,
    );
  }
  return {
    ...base,
    ...parseEncodedChildFields(record, label),
    metricBucketCount,
    metricBucketId,
    metricBucketSchema,
    metricBucketSetRefSchema,
  };
}

function parseEncodedChildFields(
  record: Record<string, unknown>,
  label: string,
) {
  const contentEncoding = requireContentEncoding(
    record.contentEncoding,
    `${label}.contentEncoding`,
  );
  const byteLength = requirePositiveSafeInteger(
    record.byteLength,
    `${label}.byteLength`,
  );
  const encodedByteLength = requirePositiveSafeInteger(
    record.encodedByteLength,
    `${label}.encodedByteLength`,
  );
  if (
    (contentEncoding === "identity" && encodedByteLength !== byteLength)
    || (contentEncoding === "gzip" && encodedByteLength >= byteLength)
  ) {
    throw new TypeError(`${label} has invalid encoded and decoded byte lengths.`);
  }
  return { byteLength, contentEncoding, encodedByteLength };
}

function assertBrowserVaultExportSessionMatchesAtomicRef(
  session: BrowserVaultExportSession,
): void {
  if (session.transport === "legacy") {
    assertBaseAadMatchesRef({
      aad: session.replicaAad,
      objectKey: session.replicaRef.objectKey,
      ref: session.replicaRef,
      requireReplicaTime: false,
    });
    assertSessionMemberIdentity(
      session.replicaKeyEnvelope.userId,
      [session.replicaAad.userId],
    );
    return;
  }
  const shardRefs = session.replicaRef.shards;
  const metricBucketRefs = session.replicaRef.metricBuckets;
  if (!shardRefs || !metricBucketRefs) {
    throw new Error(
      "Browser vault bucketed export ref is missing fixed shards or metric buckets.",
    );
  }
  const memberIds: string[] = [];
  for (const shard of HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS) {
    const aad = session.shards[shard].shardAad;
    const childRef = shardRefs[shard];
    assertBaseAadMatchesRef({
      aad,
      objectKey: childRef.objectKey,
      ref: session.replicaRef,
      requireReplicaTime: true,
    });
    assertEncodedChildMatchesRef(aad, childRef);
    if (aad.shardSetRefSchema !== shardRefs.schema) {
      throw new Error(`Browser vault ${shard} shard AAD did not match its set ref.`);
    }
    memberIds.push(aad.userId);
  }
  for (const bucketId of HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS) {
    const aad = session.metricBuckets[bucketId].metricBucketAad;
    const childRef = metricBucketRefs.buckets[bucketId];
    assertBaseAadMatchesRef({
      aad,
      objectKey: childRef.objectKey,
      ref: session.replicaRef,
      requireReplicaTime: true,
    });
    assertEncodedChildMatchesRef(aad, childRef);
    if (
      aad.metricBucketCount !== metricBucketRefs.bucketCount
      || aad.metricBucketSetRefSchema !== metricBucketRefs.schema
    ) {
      throw new Error(
        `Browser vault metric bucket ${bucketId} AAD did not match its set ref.`,
      );
    }
    memberIds.push(aad.userId);
  }
  assertSessionMemberIdentity(session.replicaKeyEnvelope.userId, memberIds);
}

function assertBaseAadMatchesRef(input: {
  aad: BrowserVaultReplicaAad;
  objectKey: string;
  ref: HostedBrowserVaultReplicaRef;
  requireReplicaTime: boolean;
}): void {
  if (
    input.aad.dataVersion !== input.ref.dataVersion
    || input.aad.objectKey !== input.objectKey
    || input.aad.runtimeRootKeyId !== input.ref.runtimeRootKeyId
    || input.aad.sourceBundleHash !== input.ref.sourceBundleHash
  ) {
    throw new Error("Browser vault export AAD did not match its atomic session ref.");
  }
  if (
    input.requireReplicaTime
    && (
      input.aad.generatedAt !== input.ref.generatedAt
      || input.aad.generation !== input.ref.generation
    )
  ) {
    throw new Error("Browser vault export AAD time identity did not match its session ref.");
  }
  if (
    !input.requireReplicaTime
    && (
      (input.aad.generatedAt !== undefined
        && input.aad.generatedAt !== input.ref.generatedAt)
      || (input.aad.generation !== undefined
        && input.aad.generation !== input.ref.generation)
    )
  ) {
    throw new Error("Browser vault legacy AAD time identity did not match its session ref.");
  }
  const dataKeyEnvelope = input.ref.dataKeyEnvelope;
  if (
    dataKeyEnvelope
    && (
      input.aad.dataKeyId !== dataKeyEnvelope.dataKeyId
      || input.aad.dataKeyRootKeyId !== dataKeyEnvelope.rootKeyId
    )
  ) {
    throw new Error("Browser vault export AAD data key did not match its session ref.");
  }
}

function assertEncodedChildMatchesRef(
  aad: Pick<
    BrowserVaultReplicaShardAad,
    "byteLength" | "contentEncoding" | "encodedByteLength"
  >,
  ref: {
    byteLength: number;
    contentEncoding: HostedBrowserVaultReplicaContentEncoding;
    encodedByteLength: number;
  },
): void {
  if (
    aad.byteLength !== ref.byteLength
    || aad.contentEncoding !== ref.contentEncoding
    || aad.encodedByteLength !== ref.encodedByteLength
  ) {
    throw new Error("Browser vault export child AAD did not match its session ref.");
  }
}

function assertSessionMemberIdentity(
  sessionUserId: string,
  childUserIds: readonly string[],
): void {
  if (childUserIds.some((userId) => userId !== sessionUserId)) {
    throw new Error("Browser vault export children did not share one member identity.");
  }
}

async function loadLegacyBrowserVaultExport(input: {
  replicaKey: Uint8Array;
  session: Extract<BrowserVaultExportSession, { transport: "legacy" }>;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; generatedAt: string }> {
  const plaintext = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({ ...input.session.replicaAad }),
    envelope: input.session.encryptedReplica,
    expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(
      input.session.replicaRef,
    ),
    key: input.replicaKey,
    scope: "browser-vault-replica",
  });
  assertNotAborted(input.signal);
  if (plaintext.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
    throw new Error("Browser vault legacy export exceeded the supported byte limit.");
  }
  if (plaintext.byteLength !== input.session.replicaRef.byteLength) {
    throw new Error(
      "Browser vault legacy export length did not match its session ref.",
    );
  }
  const replica = parseBrowserVaultReplica(parseJsonBytes(plaintext));
  assertReplicaIdentityMatchesRef(replica, input.session.replicaRef);
  return {
    blob: new Blob([JSON.stringify(replica, null, 2)], {
      type: VAULT_EXPORT_MIME_TYPE,
    }),
    generatedAt: replica.generatedAt,
  };
}

async function loadBucketedBrowserVaultExport(input: {
  replicaKey: Uint8Array;
  session: Extract<BrowserVaultExportSession, { transport: "bucketed" }>;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; generatedAt: string }> {
  const decodedBudget = { byteLength: 0 };
  const parsedFixed: Partial<{
    core: ReturnType<typeof parseBrowserVaultCoreShard>;
    labs: ReturnType<typeof parseBrowserVaultLabsShard>;
    metrics: ReturnType<typeof parseBrowserVaultMetricsShard>;
  }> = {};

  // Export is deliberately sequential. Only the separately authorized export
  // endpoint requests every bucket, and it never builds interactive query
  // clients or interactive query indexes while decrypting them.
  for (const shard of HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS) {
    const encrypted = input.session.shards[shard];
    const value = await decryptDecodeAndParseChild({
      aad: encrypted.shardAad,
      budget: decodedBudget,
      envelope: encrypted.encryptedShard,
      replicaKey: input.replicaKey,
      replicaRef: input.session.replicaRef,
      signal: input.signal,
    });
    if (shard === "core") {
      parsedFixed.core = parseBrowserVaultCoreShard(value);
    } else if (shard === "labs") {
      parsedFixed.labs = parseBrowserVaultLabsShard(value);
    } else {
      parsedFixed.metrics = parseBrowserVaultMetricsShard(value);
    }
  }

  if (!parsedFixed.core || !parsedFixed.labs || !parsedFixed.metrics) {
    throw new Error("Browser vault export did not provide every fixed shard.");
  }
  const metricsIndexReplica = assembleBrowserVaultMetricsIndexReplica(
    parsedFixed.core,
    parsedFixed.metrics,
  );
  const labsReplica = assembleBrowserVaultLabsReplica(
    parsedFixed.core,
    parsedFixed.labs,
  );
  assertReplicaIdentityMatchesRef(
    metricsIndexReplica,
    input.session.replicaRef,
  );

  // Only immutable serialized parts survive an iteration. The parsed bucket
  // and its restored row objects can be reclaimed before the next decrypt.
  const metricRowPartsByMetricKey = new Map<string, Blob>();
  let serializedMetricRowCount = 0;
  for (const bucketId of BROWSER_VAULT_METRIC_BUCKET_IDS) {
    const encrypted = input.session.metricBuckets[bucketId];
    const value = await decryptDecodeAndParseChild({
      aad: encrypted.metricBucketAad,
      budget: decodedBudget,
      envelope: encrypted.encryptedMetricBucket,
      replicaKey: input.replicaKey,
      replicaRef: input.session.replicaRef,
      signal: input.signal,
    });
    const bucket = await parseBrowserVaultMetricBucketShard(
      value,
      bucketId,
    );
    const restoredRows = assembleBrowserVaultLoadedMetricRows(
      parsedFixed.metrics,
      { [bucketId]: bucket },
    );
    const rowsByMetricKey = new Map<string, BrowserVaultMetricRow[]>();
    for (const row of restoredRows) {
      const rows = rowsByMetricKey.get(row.metricKey);
      if (rows) rows.push(row);
      else rowsByMetricKey.set(row.metricKey, [row]);
    }
    for (const entry of parsedFixed.metrics.metricDirectory) {
      if (entry.bucketId !== bucketId) continue;
      const rows = rowsByMetricKey.get(entry.metricKey);
      if (!rows || metricRowPartsByMetricKey.has(entry.metricKey)) {
        throw new Error(
          `Browser vault export metric directory did not match ${entry.metricKey}.`,
        );
      }
      metricRowPartsByMetricKey.set(
        entry.metricKey,
        createMetricRowsJsonPart(rows),
      );
      serializedMetricRowCount += rows.length;
      rowsByMetricKey.delete(entry.metricKey);
    }
    if (rowsByMetricKey.size !== 0) {
      throw new Error(
        `Browser vault export metric bucket ${bucketId} contained an unindexed series.`,
      );
    }
  }

  if (
    metricRowPartsByMetricKey.size
      !== parsedFixed.metrics.metricDirectory.length
    || serializedMetricRowCount !== parsedFixed.metrics.metricRowCount
  ) {
    throw new Error(
      "Browser vault export metric buckets did not match the metrics index.",
    );
  }

  const fixedJson = JSON.stringify(metricsIndexReplica);
  const blobParts: BlobPart[] = [
    fixedJson.slice(0, -1),
    ',"metricRows":[',
  ];
  let wroteMetricRows = false;
  for (const entry of parsedFixed.metrics.metricDirectory) {
    const part = metricRowPartsByMetricKey.get(entry.metricKey);
    if (!part) {
      throw new Error(
        `Browser vault export metric rows were missing ${entry.metricKey}.`,
      );
    }
    if (part.size === 0) continue;
    if (wroteMetricRows) blobParts.push(",");
    blobParts.push(part);
    wroteMetricRows = true;
  }
  blobParts.push(
    '],"labResultRows":',
    JSON.stringify(labsReplica.labResultRows),
    "}",
  );
  return {
    blob: new Blob(blobParts, { type: VAULT_EXPORT_MIME_TYPE }),
    generatedAt: metricsIndexReplica.generatedAt,
  };
}

function createMetricRowsJsonPart(rows: readonly BrowserVaultMetricRow[]): Blob {
  const parts: BlobPart[] = [];
  rows.forEach((row, index) => {
    if (index > 0) parts.push(",");
    parts.push(JSON.stringify(row));
  });
  return new Blob(parts, { type: VAULT_EXPORT_MIME_TYPE });
}

async function decryptDecodeAndParseChild(input: {
  aad: BrowserVaultReplicaMetricBucketAad | BrowserVaultReplicaShardAad;
  budget: { byteLength: number };
  envelope: HostedCipherEnvelope;
  replicaKey: Uint8Array;
  replicaRef: HostedBrowserVaultReplicaRef;
  signal?: AbortSignal;
}): Promise<unknown> {
  const encoded = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({ ...input.aad }),
    envelope: input.envelope,
    expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.replicaRef),
    key: input.replicaKey,
    scope: "browser-vault-replica",
  });
  assertNotAborted(input.signal);
  const plaintext = await decodeBrowserVaultChild({
    budget: input.budget,
    byteLength: input.aad.byteLength,
    bytes: encoded,
    contentEncoding: input.aad.contentEncoding,
    encodedByteLength: input.aad.encodedByteLength,
    signal: input.signal,
  });
  return parseJsonBytes(plaintext);
}

async function decodeBrowserVaultChild(input: {
  budget: { byteLength: number };
  byteLength: number;
  bytes: Uint8Array;
  contentEncoding: HostedBrowserVaultReplicaContentEncoding;
  encodedByteLength: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (input.bytes.byteLength !== input.encodedByteLength) {
    throw new Error("Browser vault export child encoded length did not match its AAD.");
  }
  if (
    input.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
    || input.encodedByteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
    || input.budget.byteLength + input.byteLength
      > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
  ) {
    throw new Error("Browser vault export exceeded the supported byte limit.");
  }
  if (input.contentEncoding === "identity") {
    if (input.bytes.byteLength !== input.byteLength) {
      throw new Error("Browser vault identity child length did not match its AAD.");
    }
    input.budget.byteLength += input.byteLength;
    return input.bytes;
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("Browser vault export decompression is unavailable.");
  }

  const stream = new Blob([Uint8Array.from(input.bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    if (input.signal?.aborted) {
      await reader.cancel();
      assertNotAborted(input.signal);
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    byteLength += value.byteLength;
    if (
      byteLength > input.byteLength
      || input.budget.byteLength + byteLength
        > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
    ) {
      await reader.cancel();
      throw new Error("Browser vault export child decoded beyond its declared limit.");
    }
    chunks.push(value);
  }
  if (byteLength !== input.byteLength) {
    throw new Error("Browser vault export child decoded length did not match its AAD.");
  }
  const decoded = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  input.budget.byteLength += byteLength;
  return decoded;
}

function assertReplicaIdentityMatchesRef(
  replica: Pick<
    BrowserVaultReplica,
    "generatedAt" | "generation" | "source"
  >,
  ref: HostedBrowserVaultReplicaRef,
): void {
  if (
    replica.source.dataVersion !== ref.dataVersion
    || replica.source.sourceBundleHash !== ref.sourceBundleHash
    || replica.generatedAt !== ref.generatedAt
    || replica.generation !== ref.generation
  ) {
    throw new Error("Browser vault export identity did not match its session ref.");
  }
}

function getQueryShardSchema(
  shard: HostedBrowserVaultReplicaShardKind,
): string {
  if (shard === "core") return BROWSER_VAULT_CORE_SHARD_SCHEMA;
  if (shard === "labs") return BROWSER_VAULT_LABS_SHARD_SCHEMA;
  return BROWSER_VAULT_METRICS_SHARD_SCHEMA;
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(textDecoder.decode(bytes)) as unknown;
}

async function readJsonErrorMessage(response: Response): Promise<string> {
  try {
    const record = requireRecord(
      await response.json(),
      "Browser vault export error response",
    );
    const error = record.error;
    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = Reflect.get(error, "message");
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }
  } catch {
    // Use the status-only fallback below.
  }
  return `Browser vault export failed with HTTP ${response.status}.`;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("Browser vault export was aborted.");
  error.name = "AbortError";
  throw error;
}

function parseFreshness(value: unknown): "fresh" | "stale" {
  if (value === undefined) return "fresh";
  if (value !== "fresh" && value !== "stale") {
    throw new TypeError("Browser vault export response.freshness is invalid.");
  }
  return value;
}

function readOptionalBoolean(
  value: unknown,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function readOptionalNullableString(
  value: unknown,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requireRecord(value, label);
  const expected = new Set(keys);
  if (
    Object.keys(record).length !== keys.length
    || Object.keys(record).some((key) => !expected.has(key))
    || keys.some((key) => record[key] === undefined)
  ) {
    throw new TypeError(`${label} must contain exactly the complete export set.`);
  }
  return record;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new TypeError(`${label} must be a canonical ISO-8601 timestamp.`);
  }
  return timestamp;
}

function requireContentEncoding(
  value: unknown,
  label: string,
): HostedBrowserVaultReplicaContentEncoding {
  if (value !== "gzip" && value !== "identity") {
    throw new TypeError(`${label} must be gzip or identity.`);
  }
  return value;
}

function requireHostedShardKind(
  value: unknown,
  label: string,
): HostedBrowserVaultReplicaShardKind {
  if (
    !HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS.includes(
      value as HostedBrowserVaultReplicaShardKind,
    )
  ) {
    throw new TypeError(`${label} is unsupported.`);
  }
  return value as HostedBrowserVaultReplicaShardKind;
}

function requireMetricBucketId(
  value: unknown,
  label: string,
): HostedBrowserVaultReplicaMetricBucketId {
  if (
    !HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.includes(
      value as HostedBrowserVaultReplicaMetricBucketId,
    )
  ) {
    throw new TypeError(`${label} is unsupported.`);
  }
  return value as HostedBrowserVaultReplicaMetricBucketId;
}
