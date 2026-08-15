import { BROWSER_VAULT_REPLICA_SCHEMA } from "@murphai/contracts/browser-vault";
import {
  buildHostedStorageAad as buildRuntimeHostedStorageAad,
  createHostedDataKeyEnvelopeWithDomainRoot,
  deriveHostedStorageKey,
  parseHostedCipherEnvelope,
  unwrapHostedDataKeyWithDomainRoot,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
  type HostedBrowserVaultReplicaMetricBucketId,
  type HostedBrowserVaultReplicaMetricBucketRef,
  type HostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaShardKind,
  type HostedBrowserVaultReplicaShardRef,
} from "@murphai/hosted-execution/contracts";
import {
  BROWSER_VAULT_CORE_SHARD_SCHEMA,
  BROWSER_VAULT_LABS_SHARD_SCHEMA,
  BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
  BROWSER_VAULT_METRICS_SHARD_SCHEMA,
  parseBrowserVaultReplica,
  splitBrowserVaultReplica,
} from "@murphai/query/browser-replica";

import { writeEncryptedR2Payload, type EncryptedR2BucketLike } from "./crypto.js";
import {
  hostedBrowserVaultReplicaObjectKey,
  hostedBrowserVaultReplicaUserPrefix,
} from "./storage-paths.js";
import {
  encodeHostedBrowserVaultReplicaJson,
  encodeHostedBrowserVaultReplicaShardJson,
} from "./browser-vault-limits.ts";

const utf8Decoder = new TextDecoder();

type HostedBrowserVaultReplicaBucketLike = EncryptedR2BucketLike & {
  delete?(key: string): Promise<void>;
};

export const HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA =
  "murph.hosted-browser-vault-replica-orphan-candidate.v1";
export const HOSTED_BROWSER_VAULT_REPLICA_WRITE_CONCURRENCY = 4;

export interface HostedBrowserVaultReplicaOrphanCandidate {
  createdAt: string;
  objectKey: string;
  schema: typeof HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA;
  userId: string;
}

export interface BrowserVaultReplicaAadFields {
  dataKeyId?: string;
  dataKeyRootKeyId?: string;
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  runtimeRootKeyId: string;
  schema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  sourceBundleHash: string;
  userId: string;
}

export interface BrowserVaultReplicaShardAadFields extends BrowserVaultReplicaAadFields {
  byteLength: number;
  contentEncoding: HostedBrowserVaultReplicaShardRef["contentEncoding"];
  encodedByteLength: number;
  generatedAt: string;
  generation?: number;
  shard: HostedBrowserVaultReplicaShardKind;
  shardSetRefSchema: typeof HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA;
  shardSchema:
    | typeof BROWSER_VAULT_CORE_SHARD_SCHEMA
    | typeof BROWSER_VAULT_METRICS_SHARD_SCHEMA
    | typeof BROWSER_VAULT_LABS_SHARD_SCHEMA;
}

export interface BrowserVaultReplicaMetricBucketAadFields
  extends BrowserVaultReplicaAadFields {
  byteLength: number;
  contentEncoding: HostedBrowserVaultReplicaMetricBucketRef["contentEncoding"];
  encodedByteLength: number;
  generatedAt: string;
  generation?: number;
  metricBucketCount: typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT;
  metricBucketId: HostedBrowserVaultReplicaMetricBucketId;
  metricBucketSchema: typeof BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA;
  metricBucketSetRefSchema:
    typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA;
}

export interface HostedBrowserVaultReplicaStore {
  deleteBrowserVaultReplica(ref: HostedBrowserVaultReplicaRef | null): Promise<void>;
  deriveBrowserVaultReplicaKey(ref: HostedBrowserVaultReplicaRef): Promise<Uint8Array>;
  readBrowserVaultReplicaEnvelope(ref: HostedBrowserVaultReplicaRef): Promise<HostedCipherEnvelope | null>;
  readBrowserVaultReplicaShardEnvelope(
    ref: HostedBrowserVaultReplicaRef,
    shard: HostedBrowserVaultReplicaShardKind,
  ): Promise<HostedCipherEnvelope | null>;
  readBrowserVaultReplicaMetricBucketEnvelope(
    ref: HostedBrowserVaultReplicaRef,
    bucketId: HostedBrowserVaultReplicaMetricBucketId,
  ): Promise<HostedCipherEnvelope | null>;
  writeBrowserVaultReplica(input: {
    beforeWrite?(ref: HostedBrowserVaultReplicaRef): Promise<void>;
    replica: unknown;
    userId: string;
  }): Promise<HostedBrowserVaultReplicaRef>;
}

export class HostedBrowserVaultReplicaOwnershipError extends Error {
  constructor(message = "Hosted browser vault replica is outside the bound user replica namespace.") {
    super(message);
    this.name = "HostedBrowserVaultReplicaOwnershipError";
  }
}

export class HostedBrowserVaultReplicaRootKeyUnavailableError extends Error {
  readonly runtimeRootKeyId: string | null;

  constructor(runtimeRootKeyId: string | null = null) {
    super("Hosted browser vault replica runtime root key is unavailable.");
    this.name = "HostedBrowserVaultReplicaRootKeyUnavailableError";
    this.runtimeRootKeyId = runtimeRootKeyId;
  }
}

export function createBrowserVaultReplicaAadFields(input: {
  ref: HostedBrowserVaultReplicaRef;
  userId: string;
}): BrowserVaultReplicaAadFields {
  assertHostedBrowserVaultReplicaDataKeyEnvelopeMatchesRef({
    ref: input.ref,
    userId: input.userId,
  });
  return {
    ...(input.ref.dataKeyEnvelope
      ? {
          dataKeyId: input.ref.dataKeyEnvelope.dataKeyId,
          dataKeyRootKeyId: input.ref.dataKeyEnvelope.rootKeyId,
        }
      : {}),
    dataVersion: input.ref.dataVersion,
    objectKey: input.ref.objectKey,
    purpose: "browser-vault-replica",
    runtimeRootKeyId: requireBrowserVaultReplicaRuntimeRootKeyId(input.ref),
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    sourceBundleHash: input.ref.sourceBundleHash,
    userId: input.userId,
  };
}

export function createBrowserVaultReplicaShardAadFields(input: {
  ref: HostedBrowserVaultReplicaRef;
  shard: HostedBrowserVaultReplicaShardKind;
  userId: string;
}): BrowserVaultReplicaShardAadFields {
  const shardSet = input.ref.shards;
  const shardRef = shardSet?.[input.shard];
  if (!shardSet || !shardRef) {
    throw new TypeError(`Hosted browser vault replica ref is missing shards.${input.shard}.`);
  }
  const base = createBrowserVaultReplicaAadFields({
    ref: input.ref,
    userId: input.userId,
  });
  return {
    ...base,
    byteLength: shardRef.byteLength,
    contentEncoding: shardRef.contentEncoding,
    encodedByteLength: shardRef.encodedByteLength,
    generatedAt: input.ref.generatedAt,
    ...(input.ref.generation === undefined ? {} : { generation: input.ref.generation }),
    objectKey: shardRef.objectKey,
    shard: input.shard,
    shardSetRefSchema: shardSet.schema,
    shardSchema: browserVaultReplicaShardSchema(input.shard),
  };
}

export function createBrowserVaultReplicaMetricBucketAadFields(input: {
  bucketId: HostedBrowserVaultReplicaMetricBucketId;
  ref: HostedBrowserVaultReplicaRef;
  userId: string;
}): BrowserVaultReplicaMetricBucketAadFields {
  const bucketSet = input.ref.metricBuckets;
  const bucketRef = bucketSet?.buckets[input.bucketId];
  if (!bucketSet || !bucketRef) {
    throw new TypeError(
      `Hosted browser vault replica ref is missing metricBuckets.buckets.${input.bucketId}.`,
    );
  }
  const base = createBrowserVaultReplicaAadFields({
    ref: input.ref,
    userId: input.userId,
  });
  return {
    ...base,
    byteLength: bucketRef.byteLength,
    contentEncoding: bucketRef.contentEncoding,
    encodedByteLength: bucketRef.encodedByteLength,
    generatedAt: input.ref.generatedAt,
    ...(input.ref.generation === undefined ? {} : { generation: input.ref.generation }),
    metricBucketCount: bucketSet.bucketCount,
    metricBucketId: input.bucketId,
    metricBucketSchema: BROWSER_VAULT_METRIC_BUCKET_SHARD_SCHEMA,
    metricBucketSetRefSchema: bucketSet.schema,
    objectKey: bucketRef.objectKey,
  };
}

export function listHostedBrowserVaultReplicaObjectKeys(
  ref: HostedBrowserVaultReplicaRef,
): string[] {
  return [...new Set([
    ref.objectKey,
    ...HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS.flatMap((shard) => {
      const objectKey = ref.shards?.[shard]?.objectKey;
      return objectKey ? [objectKey] : [];
    }),
    ...HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.flatMap((bucketId) => {
      const objectKey = ref.metricBuckets?.buckets[bucketId]?.objectKey;
      return objectKey ? [objectKey] : [];
    }),
  ])];
}

export function listHostedBrowserVaultReplicaSiblingObjectKeys(
  objectKey: string,
): string[] {
  return [
    ...HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS.map((shard) =>
      browserVaultReplicaShardObjectKey(objectKey, shard)),
    ...HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) =>
      browserVaultReplicaMetricBucketObjectKey(objectKey, bucketId)),
  ];
}

export function createHostedBrowserVaultReplicaStore(input: {
  bucket: HostedBrowserVaultReplicaBucketLike;
  rootKey: Uint8Array;
  rootKeyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
  userId?: string | null;
}): HostedBrowserVaultReplicaStore {
  return {
    async deleteBrowserVaultReplica(ref) {
      if (!ref || !input.bucket.delete) {
        return;
      }

      await assertHostedBrowserVaultReplicaOwnedByUser(input, ref);

      let firstError: unknown;
      for (const objectKey of listHostedBrowserVaultReplicaObjectKeys(ref)) {
        try {
          await input.bucket.delete(objectKey);
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) {
        throw firstError;
      }
    },

    async deriveBrowserVaultReplicaKey(ref) {
      return deriveBrowserVaultReplicaKey(input, ref);
    },

    async readBrowserVaultReplicaEnvelope(ref) {
      await assertHostedBrowserVaultReplicaOwnedByUser(input, ref);

      const object = await input.bucket.get(ref.objectKey);

      if (!object) {
        return null;
      }

      const envelopeValue: unknown = JSON.parse(utf8Decoder.decode(await object.arrayBuffer()));
      return parseHostedCipherEnvelope(
        envelopeValue,
        "Hosted browser vault replica envelope",
      );
    },

    async readBrowserVaultReplicaShardEnvelope(ref, shard) {
      await assertHostedBrowserVaultReplicaOwnedByUser(input, ref);
      const shardRef = ref.shards?.[shard];
      if (!shardRef) {
        return null;
      }
      const object = await input.bucket.get(shardRef.objectKey);
      if (!object) {
        return null;
      }
      const envelopeValue: unknown = JSON.parse(utf8Decoder.decode(await object.arrayBuffer()));
      return parseHostedCipherEnvelope(
        envelopeValue,
        `Hosted browser vault ${shard} shard envelope`,
      );
    },

    async readBrowserVaultReplicaMetricBucketEnvelope(ref, bucketId) {
      await assertHostedBrowserVaultReplicaOwnedByUser(input, ref);
      const bucketRef = ref.metricBuckets?.buckets[bucketId];
      if (!bucketRef) {
        return null;
      }
      const object = await input.bucket.get(bucketRef.objectKey);
      if (!object) {
        return null;
      }
      const envelopeValue: unknown = JSON.parse(utf8Decoder.decode(await object.arrayBuffer()));
      return parseHostedCipherEnvelope(
        envelopeValue,
        `Hosted browser vault metric bucket ${bucketId} envelope`,
      );
    },

    async writeBrowserVaultReplica({ beforeWrite, replica, userId }) {
      const parsed = parseBrowserVaultReplicaStorageInput(replica);

      const encodedReplica = encodeHostedBrowserVaultReplicaJson({ replica });
      const parsedReplica = parseBrowserVaultReplica(replica);
      const shardSet = await splitBrowserVaultReplica(parsedReplica);
      const objectKey = await hostedBrowserVaultReplicaObjectKey({
        dataVersion: parsed.source.dataVersion,
        generatedAt: parsed.generatedAt,
        userId,
      });
      const encodedShards = new Map<HostedBrowserVaultReplicaShardKind, {
        bytes: Uint8Array;
        ref: HostedBrowserVaultReplicaShardRef;
      }>();
      for (const shard of HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS) {
        const encoded = await encodeHostedBrowserVaultReplicaShardJson({
          shard: shard === "core"
            ? shardSet.core
            : shard === "labs"
            ? shardSet.labs
            : shardSet.metrics,
        });
        encodedShards.set(shard, {
          bytes: encoded.bytes,
          ref: {
            byteLength: encoded.byteLength,
            contentEncoding: encoded.contentEncoding,
            encodedByteLength: encoded.encodedByteLength,
            objectKey: browserVaultReplicaShardObjectKey(objectKey, shard),
          },
        });
      }
      const encodedMetricBuckets = new Map<HostedBrowserVaultReplicaMetricBucketId, {
        bytes: Uint8Array;
        ref: HostedBrowserVaultReplicaMetricBucketRef;
      }>();
      for (const bucketId of HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS) {
        const encoded = await encodeHostedBrowserVaultReplicaShardJson({
          shard: shardSet.metricBuckets[bucketId],
        });
        encodedMetricBuckets.set(bucketId, {
          bytes: encoded.bytes,
          ref: {
            byteLength: encoded.byteLength,
            contentEncoding: encoded.contentEncoding,
            encodedByteLength: encoded.encodedByteLength,
            objectKey: browserVaultReplicaMetricBucketObjectKey(objectKey, bucketId),
          },
        });
      }
      const shards: NonNullable<HostedBrowserVaultReplicaRef["shards"]> = {
        core: requireEncodedBrowserVaultReplicaShard(encodedShards, "core").ref,
        labs: requireEncodedBrowserVaultReplicaShard(encodedShards, "labs").ref,
        metricsIndex: requireEncodedBrowserVaultReplicaShard(
          encodedShards,
          "metricsIndex",
        ).ref,
        schema: HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
      };
      const metricBuckets: NonNullable<HostedBrowserVaultReplicaRef["metricBuckets"]> = {
        bucketCount: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
        buckets: Object.fromEntries(
          HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) => [
            bucketId,
            requireEncodedBrowserVaultReplicaMetricBucket(
              encodedMetricBuckets,
              bucketId,
            ).ref,
          ]),
        ) as NonNullable<HostedBrowserVaultReplicaRef["metricBuckets"]>["buckets"],
        schema: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
      };
      const ref: HostedBrowserVaultReplicaRef = {
        byteLength: encodedReplica.byteLength,
        dataVersion: parsed.source.dataVersion,
        generatedAt: parsed.generatedAt,
        ...(parsed.generation === undefined ? {} : { generation: parsed.generation }),
        keyId: createBrowserVaultReplicaKeyId(parsed.source.dataVersion),
        metricBuckets,
        objectKey,
        replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
        runtimeRootKeyId: requireBrowserVaultReplicaRootKeyId(input.rootKeyId),
        schema: HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
        shards,
        sourceBundleHash: parsed.source.sourceBundleHash,
      };
      const { dataKey, envelope: dataKeyEnvelope } =
        await createHostedDataKeyEnvelopeWithDomainRoot({
          domain: "runtime",
          lane: "browser-vault-replica",
          resource: {
            objectKey,
            purpose: "browser-vault-replica",
            userId,
          },
          rootKey: input.rootKey,
          rootKeyId: ref.runtimeRootKeyId,
        });
      const persistedRef: HostedBrowserVaultReplicaRef = {
        ...ref,
        dataKeyEnvelope,
      };

      const aadFields = createBrowserVaultReplicaAadFields({ ref: persistedRef, userId });

      await beforeWrite?.(persistedRef);

      const writes: Array<{
        aad: Uint8Array;
        key: string;
        plaintext: Uint8Array;
      }> = [{
        aad: buildRuntimeHostedStorageAad({
          dataKeyId: aadFields.dataKeyId,
          dataKeyRootKeyId: aadFields.dataKeyRootKeyId,
          dataVersion: aadFields.dataVersion,
          objectKey: aadFields.objectKey,
          purpose: aadFields.purpose,
          runtimeRootKeyId: aadFields.runtimeRootKeyId,
          schema: aadFields.schema,
          sourceBundleHash: aadFields.sourceBundleHash,
          userId: aadFields.userId,
        }),
        key: objectKey,
        plaintext: encodedReplica.bytes,
      }];

      for (const shard of HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS) {
        const encoded = encodedShards.get(shard);
        if (!encoded || !persistedRef.shards?.[shard]) {
          continue;
        }
        const shardAad = createBrowserVaultReplicaShardAadFields({
          ref: persistedRef,
          shard,
          userId,
        });
        writes.push({
          aad: buildRuntimeHostedStorageAad({
            byteLength: shardAad.byteLength,
            contentEncoding: shardAad.contentEncoding,
            dataKeyId: shardAad.dataKeyId,
            dataKeyRootKeyId: shardAad.dataKeyRootKeyId,
            dataVersion: shardAad.dataVersion,
            encodedByteLength: shardAad.encodedByteLength,
            generatedAt: shardAad.generatedAt,
            generation: shardAad.generation,
            objectKey: shardAad.objectKey,
            purpose: shardAad.purpose,
            runtimeRootKeyId: shardAad.runtimeRootKeyId,
            schema: shardAad.schema,
            shard: shardAad.shard,
            shardSchema: shardAad.shardSchema,
            shardSetRefSchema: shardAad.shardSetRefSchema,
            sourceBundleHash: shardAad.sourceBundleHash,
            userId: shardAad.userId,
          }),
          key: encoded.ref.objectKey,
          plaintext: encoded.bytes,
        });
      }

      for (const bucketId of HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS) {
        const encoded = requireEncodedBrowserVaultReplicaMetricBucket(
          encodedMetricBuckets,
          bucketId,
        );
        const bucketAad = createBrowserVaultReplicaMetricBucketAadFields({
          bucketId,
          ref: persistedRef,
          userId,
        });
        writes.push({
          aad: buildRuntimeHostedStorageAad({
            byteLength: bucketAad.byteLength,
            contentEncoding: bucketAad.contentEncoding,
            dataKeyId: bucketAad.dataKeyId,
            dataKeyRootKeyId: bucketAad.dataKeyRootKeyId,
            dataVersion: bucketAad.dataVersion,
            encodedByteLength: bucketAad.encodedByteLength,
            generatedAt: bucketAad.generatedAt,
            generation: bucketAad.generation,
            metricBucketCount: bucketAad.metricBucketCount,
            metricBucketId: bucketAad.metricBucketId,
            metricBucketSchema: bucketAad.metricBucketSchema,
            metricBucketSetRefSchema: bucketAad.metricBucketSetRefSchema,
            objectKey: bucketAad.objectKey,
            purpose: bucketAad.purpose,
            runtimeRootKeyId: bucketAad.runtimeRootKeyId,
            schema: bucketAad.schema,
            sourceBundleHash: bucketAad.sourceBundleHash,
            userId: bucketAad.userId,
          }),
          key: encoded.ref.objectKey,
          plaintext: encoded.bytes,
        });
      }

      let nextWriteIndex = 0;
      let firstWriteError: unknown;
      const workerCount = Math.min(
        HOSTED_BROWSER_VAULT_REPLICA_WRITE_CONCURRENCY,
        writes.length,
      );
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextWriteIndex < writes.length) {
          const write = writes[nextWriteIndex];
          nextWriteIndex += 1;
          if (!write) {
            continue;
          }
          try {
            await writeEncryptedR2Payload({
              aad: write.aad,
              bucket: input.bucket,
              cryptoKey: dataKey,
              key: write.key,
              keyId: dataKeyEnvelope.dataKeyId,
              plaintext: write.plaintext,
              scope: "browser-vault-replica",
            });
          } catch (error) {
            firstWriteError ??= error;
          }
        }
      }));
      if (firstWriteError !== undefined) {
        throw firstWriteError;
      }

      return persistedRef;
    },
  };
}

export function parseHostedBrowserVaultReplicaOrphanCandidate(
  value: unknown,
  label = "Hosted browser vault replica orphan candidate",
): HostedBrowserVaultReplicaOrphanCandidate {
  const record = requireRecord(value, label);
  if (record.schema !== HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA) {
    throw new TypeError(`${label} schema is invalid.`);
  }
  return {
    createdAt: requireIsoTimestampString(record.createdAt, `${label} createdAt`),
    objectKey: requireString(record.objectKey, `${label} objectKey`),
    schema: HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
    userId: requireString(record.userId, `${label} userId`),
  };
}

async function assertHostedBrowserVaultReplicaOwnedByUser(
  input: {
    userId?: string | null;
  },
  ref: HostedBrowserVaultReplicaRef,
): Promise<void> {
  if (!input.userId) {
    throw new HostedBrowserVaultReplicaOwnershipError(
      "Hosted browser vault replica store requires a bound user for replica object access.",
    );
  }

  const expectedPrefix = await hostedBrowserVaultReplicaUserPrefix({
    userId: input.userId,
  });
  if (listHostedBrowserVaultReplicaObjectKeys(ref).some(
    (objectKey) => !objectKey.startsWith(expectedPrefix),
  )) {
    throw new HostedBrowserVaultReplicaOwnershipError();
  }
}

function browserVaultReplicaShardObjectKey(
  objectKey: string,
  shard: HostedBrowserVaultReplicaShardKind,
): string {
  if (!objectKey.endsWith(".json")) {
    throw new TypeError("Hosted browser vault replica object key must end in .json.");
  }
  const suffix = shard === "metricsIndex" ? "metrics-index" : shard;
  return `${objectKey.slice(0, -".json".length)}.${suffix}.json`;
}

function browserVaultReplicaMetricBucketObjectKey(
  objectKey: string,
  bucketId: HostedBrowserVaultReplicaMetricBucketId,
): string {
  if (!objectKey.endsWith(".json")) {
    throw new TypeError("Hosted browser vault replica object key must end in .json.");
  }
  return `${objectKey.slice(0, -".json".length)}.metric-bucket-${bucketId}.json`;
}

function browserVaultReplicaShardSchema(
  shard: HostedBrowserVaultReplicaShardKind,
): BrowserVaultReplicaShardAadFields["shardSchema"] {
  if (shard === "core") return BROWSER_VAULT_CORE_SHARD_SCHEMA;
  if (shard === "metricsIndex") return BROWSER_VAULT_METRICS_SHARD_SCHEMA;
  return BROWSER_VAULT_LABS_SHARD_SCHEMA;
}

function requireEncodedBrowserVaultReplicaShard(
  encodedShards: ReadonlyMap<HostedBrowserVaultReplicaShardKind, {
    bytes: Uint8Array;
    ref: HostedBrowserVaultReplicaShardRef;
  }>,
  shard: HostedBrowserVaultReplicaShardKind,
): {
  bytes: Uint8Array;
  ref: HostedBrowserVaultReplicaShardRef;
} {
  const encoded = encodedShards.get(shard);
  if (!encoded) {
    throw new TypeError(`Hosted browser vault replica ${shard} shard encoding is missing.`);
  }
  return encoded;
}

function requireEncodedBrowserVaultReplicaMetricBucket(
  encodedBuckets: ReadonlyMap<HostedBrowserVaultReplicaMetricBucketId, {
    bytes: Uint8Array;
    ref: HostedBrowserVaultReplicaMetricBucketRef;
  }>,
  bucketId: HostedBrowserVaultReplicaMetricBucketId,
): {
  bytes: Uint8Array;
  ref: HostedBrowserVaultReplicaMetricBucketRef;
} {
  const encoded = encodedBuckets.get(bucketId);
  if (!encoded) {
    throw new TypeError(
      `Hosted browser vault replica metric bucket ${bucketId} encoding is missing.`,
    );
  }
  return encoded;
}

async function resolveBrowserVaultReplicaRootKey(
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
    resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
  },
  ref: HostedBrowserVaultReplicaRef,
): Promise<Uint8Array> {
  return resolveBrowserVaultReplicaRootKeyById(
    input,
    requireBrowserVaultReplicaRuntimeRootKeyId(ref),
  );
}

async function resolveBrowserVaultReplicaRootKeyById(
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
    resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
  },
  rootKeyId: string,
): Promise<Uint8Array> {
  const normalizedRootKeyId = requireBrowserVaultReplicaRootKeyId(rootKeyId);
  if (normalizedRootKeyId === requireBrowserVaultReplicaRootKeyId(input.rootKeyId)) {
    return input.rootKey;
  }

  const keyFromKeyring = input.keysById?.[normalizedRootKeyId];
  if (keyFromKeyring) {
    return keyFromKeyring;
  }

  const resolvedKey = await input.resolveRootKeyById?.(normalizedRootKeyId) ?? null;
  if (resolvedKey) {
    return resolvedKey;
  }

  throw new HostedBrowserVaultReplicaRootKeyUnavailableError(normalizedRootKeyId);
}

async function deriveBrowserVaultReplicaKey(
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
    resolveRootKeyById?: (rootKeyId: string) => Promise<Uint8Array | null>;
    userId?: string | null;
  },
  ref: HostedBrowserVaultReplicaRef,
): Promise<Uint8Array> {
  if (ref.dataKeyEnvelope) {
    assertHostedBrowserVaultReplicaDataKeyEnvelopeMatchesRef({
      ref,
      userId: input.userId ?? undefined,
    });
    const rootKey = await resolveBrowserVaultReplicaRootKeyById(
      input,
      ref.dataKeyEnvelope.rootKeyId,
    );
    return unwrapHostedDataKeyWithDomainRoot({
      envelope: ref.dataKeyEnvelope,
      rootKey,
      rootKeyId: ref.dataKeyEnvelope.rootKeyId,
    });
  }

  const runtimeRootKeyId = requireBrowserVaultReplicaRuntimeRootKeyId(ref);
  const rootKey = await resolveBrowserVaultReplicaRootKey(input, ref);
  return deriveHostedStorageKey(
    rootKey,
    `id:browser-vault-replica:${runtimeRootKeyId}:${ref.sourceBundleHash}:${ref.dataVersion}`,
  );
}

function assertHostedBrowserVaultReplicaDataKeyEnvelopeMatchesRef(input: {
  ref: HostedBrowserVaultReplicaRef;
  userId?: string;
}): void {
  const envelope = input.ref.dataKeyEnvelope;
  if (!envelope) {
    return;
  }

  if (envelope.domain !== "runtime") {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.domain must be runtime.");
  }
  if (envelope.lane !== "browser-vault-replica") {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.lane must be browser-vault-replica.");
  }
  if (envelope.rootKeyId !== requireBrowserVaultReplicaRuntimeRootKeyId(input.ref)) {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.rootKeyId must match runtimeRootKeyId.");
  }
  if (envelope.resource.objectKey !== input.ref.objectKey) {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.resource.objectKey must match objectKey.");
  }
  if (envelope.resource.purpose !== "browser-vault-replica") {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.resource.purpose must be browser-vault-replica.");
  }
  if (input.userId && envelope.resource.userId !== input.userId) {
    throw new TypeError("Hosted browser vault replica dataKeyEnvelope.resource.userId must match userId.");
  }
}

function requireBrowserVaultReplicaRootKeyId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("Hosted browser vault replica rootKeyId must be a non-empty string.");
  }
  return normalized;
}

function requireBrowserVaultReplicaRuntimeRootKeyId(ref: HostedBrowserVaultReplicaRef): string {
  const runtimeRootKeyId = ref.runtimeRootKeyId?.trim() ?? "";
  if (!runtimeRootKeyId) {
    throw new HostedBrowserVaultReplicaRootKeyUnavailableError(null);
  }
  return runtimeRootKeyId;
}

function createBrowserVaultReplicaKeyId(dataVersion: string): string {
  return `browser-vault-replica:${dataVersion.slice(0, 32)}`;
}

function parseBrowserVaultReplicaStorageInput(value: unknown): {
  generatedAt: string;
  generation?: number;
  source: {
    dataVersion: string;
    sourceBundleHash: string;
  };
} {
  const record = requireRecord(value, "Browser vault replica");
  const schema = requireString(record.schema, "Browser vault replica schema");

  if (schema !== BROWSER_VAULT_REPLICA_SCHEMA) {
    throw new TypeError(`Browser vault replica schema must be ${BROWSER_VAULT_REPLICA_SCHEMA}.`);
  }

  const source = requireRecord(record.source, "Browser vault replica source");

  return {
    generatedAt: requireIsoTimestampString(record.generatedAt, "Browser vault replica generatedAt"),
    ...(record.generation === undefined
      ? {}
      : { generation: requirePositiveSafeInteger(record.generation, "Browser vault replica generation") }),
    source: {
      dataVersion: requireString(source.dataVersion, "Browser vault replica dataVersion"),
      sourceBundleHash: requireString(source.sourceBundleHash, "Browser vault replica sourceBundleHash"),
    },
  };
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireIsoTimestampString(value: unknown, label: string): string {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return text;
}
