import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_SCHEMA,
} from "@murphai/contracts/browser-vault";
import { parseHostedDataKeyEnvelope } from "@murphai/runtime-state";
import type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaMetricBucketSetRef,
  HostedBrowserVaultReplicaRef,
  HostedBrowserVaultReplicaShardRef,
} from "./contracts.ts";
import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
} from "./contracts.ts";
import {
  requireNumber,
  requireObject,
  requireString,
} from "./parsers/assertions.ts";

export type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaContentEncoding,
  HostedBrowserVaultReplicaMetricBucketId,
  HostedBrowserVaultReplicaMetricBucketRef,
  HostedBrowserVaultReplicaMetricBucketSetRef,
  HostedBrowserVaultReplicaRef,
  HostedBrowserVaultReplicaShardKind,
  HostedBrowserVaultReplicaShardRef,
  HostedBrowserVaultReplicaShardSetRef,
} from "./contracts.ts";
export {
  getHostedBrowserVaultReplicaStorageKeyId,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
} from "./contracts.ts";

export function parseHostedBrowserVaultReplicaRef(
  value: unknown,
  label = "Hosted browser vault replica ref",
): HostedBrowserVaultReplicaCursorRef {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  const replicaSchema = requireString(record.replicaSchema, `${label}.replicaSchema`);

  if (schema !== HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA}.`);
  }
  if (replicaSchema !== BROWSER_VAULT_REPLICA_SCHEMA) {
    throw new TypeError(`${label}.replicaSchema must be ${BROWSER_VAULT_REPLICA_SCHEMA}.`);
  }
  const dataKeyEnvelope = record.dataKeyEnvelope === undefined
    ? undefined
    : parseHostedDataKeyEnvelope(
        record.dataKeyEnvelope,
        `${label}.dataKeyEnvelope`,
      );
  const objectKey = requireString(record.objectKey, `${label}.objectKey`);
  const shards = record.shards === undefined
    ? undefined
    : parseHostedBrowserVaultReplicaShardRefs(record.shards, `${label}.shards`);
  const metricBuckets = record.metricBuckets === undefined
    ? undefined
    : parseHostedBrowserVaultReplicaMetricBucketRefs(
        record.metricBuckets,
        `${label}.metricBuckets`,
      );
  if ((shards === undefined) !== (metricBuckets === undefined)) {
    throw new TypeError(`${label}.shards and ${label}.metricBuckets must be present together.`);
  }
  if (shards && metricBuckets) {
    const objectKeys = [
      objectKey,
      ...HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS.map((shard) => shards[shard].objectKey),
      ...HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map(
        (bucketId) => metricBuckets.buckets[bucketId].objectKey,
      ),
    ];
    if (new Set(objectKeys).size !== objectKeys.length) {
      throw new TypeError(`${label} object keys must be distinct.`);
    }
  }

  return {
    byteLength: requireNumber(record.byteLength, `${label}.byteLength`),
    ...(dataKeyEnvelope === undefined ? {} : { dataKeyEnvelope }),
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    generatedAt: requireIsoTimestampString(record.generatedAt, `${label}.generatedAt`),
    ...(record.generation === undefined
      ? {}
      : { generation: requirePositiveSafeInteger(record.generation, `${label}.generation`) }),
    keyId: requireString(record.keyId, `${label}.keyId`),
    ...(metricBuckets === undefined ? {} : { metricBuckets }),
    objectKey,
    replicaSchema,
    schema,
    runtimeRootKeyId: requireString(record.runtimeRootKeyId, `${label}.runtimeRootKeyId`),
    ...(shards === undefined ? {} : { shards }),
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  } satisfies HostedBrowserVaultReplicaRef;
}

function parseHostedBrowserVaultReplicaShardRefs(
  value: unknown,
  label: string,
): NonNullable<HostedBrowserVaultReplicaRef["shards"]> {
  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  if (schema !== HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA) {
    throw new TypeError(
      `${label}.schema must be ${HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA}.`,
    );
  }
  const allowedKinds = new Set<string>([
    "schema",
    ...HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  ]);
  if (Object.keys(record).some((kind) => !allowedKinds.has(kind))) {
    throw new TypeError(`${label} contains an unsupported shard kind.`);
  }

  for (const shard of HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS) {
    if (record[shard] === undefined) {
      throw new TypeError(`${label}.${shard} is required when shards are present.`);
    }
  }
  return {
    core: parseHostedBrowserVaultReplicaShardRef(record.core, `${label}.core`),
    labs: parseHostedBrowserVaultReplicaShardRef(record.labs, `${label}.labs`),
    metricsIndex: parseHostedBrowserVaultReplicaShardRef(
      record.metricsIndex,
      `${label}.metricsIndex`,
    ),
    schema,
  };
}

function parseHostedBrowserVaultReplicaMetricBucketRefs(
  value: unknown,
  label: string,
): HostedBrowserVaultReplicaMetricBucketSetRef {
  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  if (schema !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA) {
    throw new TypeError(
      `${label}.schema must be ${HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA}.`,
    );
  }
  const bucketCount = requirePositiveSafeInteger(record.bucketCount, `${label}.bucketCount`);
  if (bucketCount !== HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT) {
    throw new TypeError(
      `${label}.bucketCount must be ${HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT}.`,
    );
  }
  const bucketsRecord = requireObject(record.buckets, `${label}.buckets`);
  const allowedBucketIds = new Set<string>(HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS);
  if (Object.keys(bucketsRecord).some((bucketId) => !allowedBucketIds.has(bucketId))) {
    throw new TypeError(`${label}.buckets contains an unsupported metric bucket id.`);
  }
  const buckets = Object.fromEntries(
    HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) => {
      if (bucketsRecord[bucketId] === undefined) {
        throw new TypeError(`${label}.buckets.${bucketId} is required.`);
      }
      return [
        bucketId,
        parseHostedBrowserVaultReplicaShardRef(
          bucketsRecord[bucketId],
          `${label}.buckets.${bucketId}`,
        ),
      ];
    }),
  ) as HostedBrowserVaultReplicaMetricBucketSetRef["buckets"];
  return { bucketCount, buckets, schema };
}

function parseHostedBrowserVaultReplicaShardRef(
  value: unknown,
  label: string,
): HostedBrowserVaultReplicaShardRef {
  const record = requireObject(value, label);
  const contentEncoding = requireString(record.contentEncoding, `${label}.contentEncoding`);
  if (contentEncoding !== "gzip" && contentEncoding !== "identity") {
    throw new TypeError(`${label}.contentEncoding must be gzip or identity.`);
  }
  const byteLength = requirePositiveSafeInteger(record.byteLength, `${label}.byteLength`);
  const encodedByteLength = requirePositiveSafeInteger(
    record.encodedByteLength,
    `${label}.encodedByteLength`,
  );
  if (contentEncoding === "gzip" && encodedByteLength >= byteLength) {
    throw new TypeError(
      `${label}.encodedByteLength must be smaller than ${label}.byteLength for gzip.`,
    );
  }
  if (contentEncoding === "identity" && encodedByteLength !== byteLength) {
    throw new TypeError(
      `${label}.encodedByteLength must equal ${label}.byteLength for identity.`,
    );
  }
  return {
    byteLength,
    contentEncoding,
    encodedByteLength,
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
  };
}

export type BrowserVaultReplicaFreshness = "fresh" | "stale";

export type BrowserVaultReplicaFreshnessReason =
  | "current"
  | "missing"
  | "generation_mismatch"
  | "source_mismatch"
  | "max_age_exceeded"
  | "invalid_generated_at"
  | "invalid_now";

export const BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES = 50 * 1024 * 1024;

export interface BrowserVaultRefreshDecision {
  reason: Exclude<BrowserVaultReplicaFreshnessReason, "current">;
  refresh: true;
}

export interface BrowserVaultReplicaFreshnessAssessment {
  freshness: BrowserVaultReplicaFreshness;
  reason: BrowserVaultReplicaFreshnessReason;
  shouldRefresh: boolean;
}

export interface BrowserVaultReplicaFreshnessInput {
  currentSourceHash?: string | null;
  maxAgeMs?: number | null;
  now?: Date | number | string | null;
  replicaRef: HostedBrowserVaultReplicaRef | null;
}

export function assessBrowserVaultReplicaFreshness(
  input: BrowserVaultReplicaFreshnessInput,
): BrowserVaultReplicaFreshnessAssessment {
  const stale = (
    reason: Exclude<BrowserVaultReplicaFreshnessReason, "current">,
  ): BrowserVaultReplicaFreshnessAssessment => ({
    freshness: "stale",
    reason,
    shouldRefresh: true,
  });

  if (!input.replicaRef) {
    return stale("missing");
  }

  if (input.replicaRef.generation !== BROWSER_VAULT_REPLICA_CURRENT_GENERATION) {
    return stale("generation_mismatch");
  }

  const generatedAtMs = parseFreshnessTimestampMs(input.replicaRef.generatedAt);
  if (generatedAtMs === null) {
    return stale("invalid_generated_at");
  }

  const currentSourceHash = normalizeBrowserVaultSourceHash(input.currentSourceHash);
  if (
    currentSourceHash
    && input.replicaRef.sourceBundleHash !== currentSourceHash
  ) {
    return stale("source_mismatch");
  }

  const maxAgeMs = normalizeBrowserVaultMaxAgeMs(input.maxAgeMs);
  if (maxAgeMs !== null) {
    const nowMs = parseFreshnessNowMs(input.now);
    if (nowMs === null) {
      return stale("invalid_now");
    }
    if (nowMs - generatedAtMs > maxAgeMs) {
      return stale("max_age_exceeded");
    }
  }

  return {
    freshness: "fresh",
    reason: "current",
    shouldRefresh: false,
  };
}

export function getBrowserVaultReplicaFreshness(input: {
  currentSourceHash?: string | null;
  maxAgeMs?: number | null;
  now?: Date | number | string | null;
  replicaRef: HostedBrowserVaultReplicaRef | null;
}): BrowserVaultReplicaFreshness {
  return assessBrowserVaultReplicaFreshness(input).freshness;
}

export function shouldScheduleBrowserVaultRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
  currentSourceHash?: string | null;
  maxAgeMs?: number | null;
  now?: Date | number | string | null;
}): BrowserVaultRefreshDecision | null {
  const assessment = assessBrowserVaultReplicaFreshness({
    currentSourceHash: input.currentSourceHash,
    maxAgeMs: input.maxAgeMs,
    now: input.now,
    replicaRef: input.currentReplicaRef,
  });
  return assessment.shouldRefresh
    ? { reason: assessment.reason as Exclude<BrowserVaultReplicaFreshnessReason, "current">, refresh: true }
    : null;
}

function normalizeBrowserVaultSourceHash(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBrowserVaultMaxAgeMs(value: number | null | undefined): number | null {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS;
  }
  if (!Number.isFinite(value) || value < 0) {
    return BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS;
  }
  return Math.trunc(value);
}

function parseFreshnessNowMs(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return Date.now();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return parseFreshnessTimestampMs(value);
}

function parseFreshnessTimestampMs(value: string): number | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return parsed;
}

function requireIsoTimestampString(value: unknown, label: string): string {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp in canonical UTC form.`);
  }

  return text;
}
