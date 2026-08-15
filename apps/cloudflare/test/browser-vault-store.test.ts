import { describe, expect, it } from "vitest";

import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts";
import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
} from "@murphai/hosted-execution/contracts";

import {
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
  splitBrowserVaultReplica,
} from "@murphai/query/browser";

import {
  createBrowserVaultReplicaAadFields,
  createBrowserVaultReplicaMetricBucketAadFields,
  createBrowserVaultReplicaShardAadFields,
  createHostedBrowserVaultReplicaStore,
  HOSTED_BROWSER_VAULT_REPLICA_WRITE_CONCURRENCY,
  listHostedBrowserVaultReplicaObjectKeys,
} from "../src/browser-vault-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { readEncryptedR2Payload } from "../src/crypto.js";
import { expectOpaqueStrings } from "./object-key-assertions.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

describe("hosted browser vault replica store", () => {
  it("keeps hosted bucket ids exactly aligned with the query partition", () => {
    expect(HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS)
      .toEqual(BROWSER_VAULT_METRIC_BUCKET_IDS);
  });

  it("round-trips browser vault replicas through the browser-vault-replica scope", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(29);
    const rootKeyId = "runtime-root-current";
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId,
      userId: "user_123",
    });
    type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];
    const entities: BrowserVaultEntity[] = [{
      attributes: {
        source: "browser",
      },
      body: null,
      date: "2026-04-17",
      entityId: "journal_browser_01",
      experimentSlug: null,
      family: "journal",
      frontmatter: null,
      kind: "journal_day",
      links: [],
      lookupIds: ["journal_browser_01"],
      occurredAt: "2026-04-17T08:00:00.000Z",
      path: "history/journal/2026-04-17.md",
      primaryLookupId: "journal_browser_01",
      recordClass: "ledger",
      relatedIds: [],
      status: null,
      stream: null,
      tags: ["browser"],
      title: "Browser vault journal",
    }];
    const metadata = {
      nested: {
        flag: true,
      },
      source: "browser",
    };
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "a".repeat(64),
      vault: createVaultReadModel({
        entities,
        metadata,
        vaultRoot: "browser://vault",
      }),
    });

    entities[0]!.tags.push("mutated");
    metadata.nested.flag = false;

    const replicaRef = await store.writeBrowserVaultReplica({
      replica,
      userId: "user_123",
    });

    const storedKey = replicaRef.objectKey;
    expect(storedKey).toMatch(
      /^users\/hsn_[0-9a-f]{24}\/browser-vault-replicas\/[0-9a-f]{48}\.json$/u,
    );
    expectOpaqueStrings([storedKey], ["user_123"]);
    expect(replicaRef).toMatchObject({
      byteLength: new TextEncoder().encode(JSON.stringify(replica)).byteLength,
      dataVersion: replica.source.dataVersion,
      generatedAt: replica.generatedAt,
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
      objectKey: storedKey,
      replicaSchema: replica.schema,
      runtimeRootKeyId: rootKeyId,
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: replica.source.sourceBundleHash,
    });
    expect(replicaRef.dataKeyEnvelope).toMatchObject({
      alg: "AES-256-GCM-HKDF-SHA256",
      domain: "runtime",
      lane: "browser-vault-replica",
      resource: {
        objectKey: storedKey,
        purpose: "browser-vault-replica",
        userId: "user_123",
      },
      rootKeyId,
      schema: "murph.hosted-data-key-envelope.v1",
    });
    expect(replicaRef.keyId).toBe(`browser-vault-replica:${replica.source.dataVersion.slice(0, 32)}`);
    expect(replicaRef.shards).toEqual({
      core: expect.objectContaining({
        objectKey: storedKey.replace(/\.json$/u, ".core.json"),
      }),
      labs: expect.objectContaining({
        objectKey: storedKey.replace(/\.json$/u, ".labs.json"),
      }),
      metricsIndex: expect.objectContaining({
        objectKey: storedKey.replace(/\.json$/u, ".metrics-index.json"),
      }),
      schema: "murph.hosted-browser-vault-replica-shards.v1",
    });
    expect(replicaRef.metricBuckets).toMatchObject({
      bucketCount: 32,
      schema: "murph.hosted-browser-vault-replica-metric-buckets.v1",
    });
    expect(Object.keys(replicaRef.metricBuckets?.buckets ?? {}).sort())
      .toEqual([...HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS].sort());

    await expect(store.readBrowserVaultReplicaEnvelope(replicaRef)).resolves.toMatchObject({
      algorithm: "AES-GCM",
      keyId: replicaRef.dataKeyEnvelope?.dataKeyId,
      scope: "browser-vault-replica",
    });

    const aadFields = createBrowserVaultReplicaAadFields({
      ref: replicaRef,
      userId: "user_123",
    });
    expect(aadFields).not.toHaveProperty("generatedAt");
    expect(aadFields).not.toHaveProperty("generation");
    const loadedBytes = await readEncryptedR2Payload({
      aad: buildHostedStorageAad({
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
      bucket,
      cryptoKey: await store.deriveBrowserVaultReplicaKey(replicaRef),
      expectedKeyId: replicaRef.dataKeyEnvelope?.dataKeyId,
      key: replicaRef.objectKey,
      scope: "browser-vault-replica",
    });
    expect(loadedBytes).not.toBeNull();
    const loaded: unknown = JSON.parse(new TextDecoder().decode(loadedBytes ?? undefined));
    expect(loaded).toEqual(replica);
    expect(parseBrowserVaultReplica(loaded)).toEqual(replica);
    const expectedShards = await splitBrowserVaultReplica(replica);
    for (const shard of ["core", "metricsIndex", "labs"] as const) {
      const shardRef = replicaRef.shards?.[shard];
      expect(shardRef).toBeDefined();
      expectShardEncodingSizes(shardRef);
      await expect(store.readBrowserVaultReplicaShardEnvelope(replicaRef, shard))
        .resolves.toMatchObject({
          algorithm: "AES-GCM",
          keyId: replicaRef.dataKeyEnvelope?.dataKeyId,
          scope: "browser-vault-replica",
        });
      const shardAad = createBrowserVaultReplicaShardAadFields({
        ref: replicaRef,
        shard,
        userId: "user_123",
      });
      expect(shardAad).toMatchObject({
        generatedAt: replica.generatedAt,
        generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
        shard,
        shardSetRefSchema: "murph.hosted-browser-vault-replica-shards.v1",
      });
      const encryptedShardBytes = await readEncryptedR2Payload({
        aad: buildHostedStorageAad({
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
        bucket,
        cryptoKey: await store.deriveBrowserVaultReplicaKey(replicaRef),
        expectedKeyId: replicaRef.dataKeyEnvelope?.dataKeyId,
        key: shardAad.objectKey,
        scope: "browser-vault-replica",
      });
      expect(encryptedShardBytes?.byteLength).toBe(shardRef?.encodedByteLength);
      const decodedShardBytes = await decodeChildBytes(
        encryptedShardBytes ?? new Uint8Array(),
        shardRef?.contentEncoding ?? "identity",
      );
      expect(decodedShardBytes.byteLength).toBe(shardRef?.byteLength);
      expect(JSON.parse(new TextDecoder().decode(decodedShardBytes))).toEqual(
        shard === "metricsIndex" ? expectedShards.metrics : expectedShards[shard],
      );
    }
    for (const bucketId of HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS) {
      const bucketRef = replicaRef.metricBuckets?.buckets[bucketId];
      expect(bucketRef).toBeDefined();
      expectShardEncodingSizes(bucketRef);
      await expect(store.readBrowserVaultReplicaMetricBucketEnvelope(replicaRef, bucketId))
        .resolves.toMatchObject({
          algorithm: "AES-GCM",
          keyId: replicaRef.dataKeyEnvelope?.dataKeyId,
          scope: "browser-vault-replica",
        });
      const bucketAad = createBrowserVaultReplicaMetricBucketAadFields({
        bucketId,
        ref: replicaRef,
        userId: "user_123",
      });
      expect(bucketAad).toMatchObject({
        generatedAt: replica.generatedAt,
        generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
        metricBucketCount: 32,
        metricBucketId: bucketId,
        metricBucketSetRefSchema:
          "murph.hosted-browser-vault-replica-metric-buckets.v1",
      });
      const encryptedBucketBytes = await readEncryptedR2Payload({
        aad: buildHostedStorageAad({
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
        bucket,
        cryptoKey: await store.deriveBrowserVaultReplicaKey(replicaRef),
        expectedKeyId: replicaRef.dataKeyEnvelope?.dataKeyId,
        key: bucketAad.objectKey,
        scope: "browser-vault-replica",
      });
      const decodedBucketBytes = await decodeChildBytes(
        encryptedBucketBytes ?? new Uint8Array(),
        bucketRef?.contentEncoding ?? "identity",
      );
      expect(decodedBucketBytes.byteLength).toBe(bucketRef?.byteLength);
      expect(JSON.parse(new TextDecoder().decode(decodedBucketBytes)))
        .toEqual(expectedShards.metricBuckets[bucketId]);
    }
    expect(replica.entities[0]?.tags).toEqual(["browser"]);
    expect(replica.entities[0]?.title).toBe("Browser vault journal");
    expect(() =>
      parseBrowserVaultReplica(
        {
          ...replica,
          schema: "murph.browser-vault-replica.wrong",
        },
        "Browser vault replica",
      ),
    ).toThrow("Browser vault replica.schema must be murph.browser-vault-replica.");
  });

  it("rejects invalid replica timestamps before writing encrypted objects", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: createTestRootKey(40),
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "a".repeat(64),
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });

    await expect(store.writeBrowserVaultReplica({
      replica: {
        ...replica,
        generatedAt: "not-a-date",
      },
      userId: "user_123",
    })).rejects.toThrow("Browser vault replica generatedAt must be a valid ISO-8601 timestamp.");
    expect(bucket.objects.size).toBe(0);
  });

  it("records the planned replica reference before writing the encrypted object", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: createTestRootKey(42),
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "a".repeat(64),
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });
    let plannedObjectKeys: string[] = [];

    await expect(store.writeBrowserVaultReplica({
      beforeWrite: async (replicaRef) => {
        plannedObjectKeys = listHostedBrowserVaultReplicaObjectKeys(replicaRef);
        expect(bucket.objects.size).toBe(0);
        throw new Error("orphan candidate recording failed");
      },
      replica,
      userId: "user_123",
    })).rejects.toThrow("orphan candidate recording failed");

    expect(plannedObjectKeys[0]).toMatch(
      /^users\/hsn_[0-9a-f]{24}\/browser-vault-replicas\/[0-9a-f]{48}\.json$/u,
    );
    expect(plannedObjectKeys).toHaveLength(36);
    expect(plannedObjectKeys.slice(1)).toEqual([
      plannedObjectKeys[0]?.replace(/\.json$/u, ".core.json"),
      plannedObjectKeys[0]?.replace(/\.json$/u, ".labs.json"),
      plannedObjectKeys[0]?.replace(/\.json$/u, ".metrics-index.json"),
      ...HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) =>
        plannedObjectKeys[0]?.replace(
          /\.json$/u,
          `.metric-bucket-${bucketId}.json`,
        )),
    ]);
    expect(bucket.objects.size).toBe(0);
  });

  it("settles every planned write through a bounded R2 worker pool", async () => {
    let releaseFirstBatch = (): void => {};
    const firstBatchGate = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    class TrackingBucket extends MemoryEncryptedR2Bucket {
      activePuts = 0;
      peakActivePuts = 0;
      readonly putKeys: string[] = [];

      override async put(key: string, value: string): Promise<void> {
        this.putKeys.push(key);
        this.activePuts += 1;
        this.peakActivePuts = Math.max(this.peakActivePuts, this.activePuts);
        if (this.putKeys.length === HOSTED_BROWSER_VAULT_REPLICA_WRITE_CONCURRENCY) {
          releaseFirstBatch();
        }
        try {
          await firstBatchGate;
          if (key.endsWith(".metric-bucket-00.json")) {
            throw new Error("synthetic metric bucket write failure");
          }
          await super.put(key, value);
        } finally {
          this.activePuts -= 1;
        }
      }
    }
    const bucket = new TrackingBucket();
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: createTestRootKey(52),
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "a".repeat(64),
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });

    await expect(store.writeBrowserVaultReplica({ replica, userId: "user_123" }))
      .rejects.toThrow("synthetic metric bucket write failure");

    expect(bucket.putKeys).toHaveLength(36);
    expect(new Set(bucket.putKeys).size).toBe(36);
    expect(bucket.peakActivePuts).toBe(HOSTED_BROWSER_VAULT_REPLICA_WRITE_CONCURRENCY);
    expect(bucket.activePuts).toBe(0);
  });

  it("keeps legacy generations readable and rejects invalid generation metadata", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: createTestRootKey(41),
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "a".repeat(64),
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });
    const legacyReplica: Record<string, unknown> = { ...replica };
    delete legacyReplica.generation;

    await expect(store.writeBrowserVaultReplica({
      replica: legacyReplica,
      userId: "user_123",
    })).resolves.not.toHaveProperty("generation");
    await expect(store.writeBrowserVaultReplica({
      replica: { ...replica, generation: 0 },
      userId: "user_123",
    })).rejects.toThrow("Browser vault replica generation must be a positive safe integer.");
  });

  it("derives browser-vault replica keys from the ref runtime root id across rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldRootKey = createTestRootKey(30);
    const nextRootKey = createTestRootKey(31);
    const oldRootKeyId = "runtime-root-old";
    const nextRootKeyId = "runtime-root-next";
    const userId = "user_123";
    const oldStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: oldRootKey,
      rootKeyId: oldRootKeyId,
      userId,
    });
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "a".repeat(64),
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });
    const replicaRef = await oldStore.writeBrowserVaultReplica({ replica, userId });
    const rotatedStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: nextRootKey,
      rootKeyId: nextRootKeyId,
      resolveRootKeyById: async (rootKeyId) => rootKeyId === oldRootKeyId ? oldRootKey : null,
      userId,
    });

    await expect(rotatedStore.readBrowserVaultReplicaEnvelope(replicaRef)).resolves.toMatchObject({
      keyId: replicaRef.dataKeyEnvelope?.dataKeyId,
      scope: "browser-vault-replica",
    });
    await expect(rotatedStore.deriveBrowserVaultReplicaKey(replicaRef))
      .resolves.toEqual(await oldStore.deriveBrowserVaultReplicaKey(replicaRef));
    await expect(createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey: nextRootKey,
      rootKeyId: nextRootKeyId,
      userId,
    }).deriveBrowserVaultReplicaKey(replicaRef)).rejects.toThrow(
      "Hosted browser vault replica runtime root key is unavailable.",
    );
  });

  it("keeps prior replica objects until explicitly deleted", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(31);
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });

    const firstRef = await store.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        metricPoints: [],
        generatedAt: "2026-04-17T00:00:00.000Z",
        sourceBundleHash: "b".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });
    const secondRef = await store.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        metricPoints: [],
        generatedAt: "2026-04-18T00:00:00.000Z",
        sourceBundleHash: "b".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    expect(firstRef.objectKey).not.toBe(secondRef.objectKey);
    expect(firstRef.dataVersion).toBe(secondRef.dataVersion);
    expect(bucket.objects.has(firstRef.objectKey)).toBe(true);
    expect(bucket.objects.has(secondRef.objectKey)).toBe(true);
    expect(bucket.deleted).toEqual([]);

    await store.deleteBrowserVaultReplica(firstRef);

    expect(bucket.deleted).toEqual(listHostedBrowserVaultReplicaObjectKeys(firstRef));
    expect(listHostedBrowserVaultReplicaObjectKeys(firstRef).every(
      (objectKey) => !bucket.objects.has(objectKey),
    )).toBe(true);
    expect(bucket.objects.has(secondRef.objectKey)).toBe(true);
  });

  it("derives replica object keys independently of root-key bytes", async () => {
    const replica = await createBrowserVaultReplica({
      metricPoints: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      sourceBundleHash: "g".repeat(64),
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });

    const firstRef = await createHostedBrowserVaultReplicaStore({
      bucket: new MemoryEncryptedR2Bucket(),
      rootKey: createTestRootKey(45),
      rootKeyId: "runtime-root-first",
      userId: "user_123",
    }).writeBrowserVaultReplica({
      replica,
      userId: "user_123",
    });
    const secondRef = await createHostedBrowserVaultReplicaStore({
      bucket: new MemoryEncryptedR2Bucket(),
      rootKey: createTestRootKey(46),
      rootKeyId: "runtime-root-second",
      userId: "user_123",
    }).writeBrowserVaultReplica({
      replica,
      userId: "user_123",
    });

    expect(firstRef.objectKey).toBe(secondRef.objectKey);
    expect(firstRef.runtimeRootKeyId).toBe("runtime-root-first");
    expect(secondRef.runtimeRootKeyId).toBe("runtime-root-second");
    expect(firstRef.dataKeyEnvelope?.rootKeyId).toBe("runtime-root-first");
    expect(secondRef.dataKeyEnvelope?.rootKeyId).toBe("runtime-root-second");
    expect(firstRef.dataKeyEnvelope?.dataKeyId).not.toBe(secondRef.dataKeyEnvelope?.dataKeyId);
    expectOpaqueStrings([firstRef.objectKey], ["user_123"]);
  });

  it("refuses data-key envelopes that do not bind to the requested replica object", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(47);
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const ref = await store.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        metricPoints: [],
        generatedAt: "2026-04-17T00:00:00.000Z",
        sourceBundleHash: "h".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    await expect(store.deriveBrowserVaultReplicaKey({
      ...ref,
      dataKeyEnvelope: ref.dataKeyEnvelope
        ? {
            ...ref.dataKeyEnvelope,
            resource: {
              ...ref.dataKeyEnvelope.resource,
              objectKey: `${ref.objectKey}.other`,
            },
          }
        : undefined,
    })).rejects.toThrow(/dataKeyEnvelope\.resource\.objectKey must match objectKey/u);
  });

  it("refuses to delete a replica outside the bound user's namespace", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(37);
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
    });
    const foreignDeleteStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
      userId: "user_456",
    });

    const foreignRef = await store.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        metricPoints: [],
        generatedAt: "2026-04-17T00:00:00.000Z",
        sourceBundleHash: "d".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    await expect(foreignDeleteStore.deleteBrowserVaultReplica(foreignRef)).rejects.toThrow(
      "Hosted browser vault replica is outside the bound user replica namespace.",
    );

    expect(bucket.deleted).toEqual([]);
    expect(bucket.objects.has(foreignRef.objectKey)).toBe(true);
  });

  it("refuses to read a replica outside the bound user's namespace before bucket lookup", async () => {
    class TrackingBucket extends MemoryEncryptedR2Bucket {
      readonly getCalls: string[] = [];

      override async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
        this.getCalls.push(key);
        return super.get(key);
      }
    }

    const bucket = new TrackingBucket();
    const rootKey = createTestRootKey(41);
    const ownerStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const foreignReadStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
      userId: "user_456",
    });

    const foreignRef = await ownerStore.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        metricPoints: [],
        generatedAt: "2026-04-17T00:00:00.000Z",
        sourceBundleHash: "e".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    await expect(foreignReadStore.readBrowserVaultReplicaEnvelope(foreignRef)).rejects.toThrow(
      "Hosted browser vault replica is outside the bound user replica namespace.",
    );
    expect(bucket.getCalls).toEqual([]);
  });

  it("refuses unbound replica reads before bucket lookup without echoing the object key", async () => {
    class TrackingBucket extends MemoryEncryptedR2Bucket {
      readonly getCalls: string[] = [];

      override async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
        this.getCalls.push(key);
        return super.get(key);
      }
    }

    const bucket = new TrackingBucket();
    const rootKey = createTestRootKey(43);
    const ownerStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
      userId: "user_123",
    });
    const unboundReadStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      rootKeyId: "runtime-root-current",
    });
    const ref = await ownerStore.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        metricPoints: [],
        generatedAt: "2026-04-17T00:00:00.000Z",
        sourceBundleHash: "f".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    await expect(unboundReadStore.readBrowserVaultReplicaEnvelope(ref)).rejects.toThrow(
      "Hosted browser vault replica store requires a bound user for replica object access.",
    );
    await expect(unboundReadStore.readBrowserVaultReplicaEnvelope(ref)).rejects.not.toThrow(ref.objectKey);
    expect(bucket.getCalls).toEqual([]);
  });
});

async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeChildBytes(
  bytes: Uint8Array,
  contentEncoding: "gzip" | "identity",
): Promise<Uint8Array> {
  return contentEncoding === "gzip" ? decompressGzip(bytes) : bytes;
}

function expectShardEncodingSizes(ref: {
  byteLength: number;
  contentEncoding: "gzip" | "identity";
  encodedByteLength: number;
} | undefined): void {
  expect(ref).toBeDefined();
  if (ref?.contentEncoding === "gzip") {
    expect(ref.encodedByteLength).toBeLessThan(ref.byteLength);
  } else {
    expect(ref?.encodedByteLength).toBe(ref?.byteLength);
  }
}
