import { describe, expect, it } from "vitest";

import {
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
} from "@murphai/query/browser";

import {
  createBrowserVaultReplicaAadFields,
  createHostedBrowserVaultReplicaStore,
} from "../src/browser-vault-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { readEncryptedR2Payload } from "../src/crypto.js";
import { expectOpaqueStrings, findStoredObjectKey } from "./object-key-assertions.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

describe("hosted browser vault replica store", () => {
  it("round-trips browser vault replicas through the browser-vault-replica scope", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(29);
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
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

    const storedKey = findStoredObjectKey(
      bucket,
      (key) => key.includes("/browser-vault-replicas/"),
    );
    expect(storedKey).toMatch(
      /^users\/hsn_[0-9a-f]{24}\/browser-vault-replicas\/[0-9a-f]{48}\.json$/u,
    );
    expectOpaqueStrings([storedKey], ["user_123"]);
    expect(replicaRef).toMatchObject({
      byteLength: new TextEncoder().encode(JSON.stringify(replica)).byteLength,
      dataVersion: replica.source.dataVersion,
      generatedAt: replica.generatedAt,
      objectKey: storedKey,
      replicaSchema: replica.schema,
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: replica.source.sourceBundleHash,
    });
    expect(replicaRef.keyId).toBe(`browser-vault-replica:${replica.source.dataVersion.slice(0, 32)}`);

    await expect(store.readBrowserVaultReplicaEnvelope(replicaRef)).resolves.toMatchObject({
      algorithm: "AES-GCM",
      keyId: replicaRef.keyId,
      scope: "browser-vault-replica",
    });

    const aadFields = createBrowserVaultReplicaAadFields({
      ref: replicaRef,
      userId: "user_123",
    });
    const loadedBytes = await readEncryptedR2Payload({
      aad: buildHostedStorageAad({
        dataVersion: aadFields.dataVersion,
        objectKey: aadFields.objectKey,
        purpose: aadFields.purpose,
        schema: aadFields.schema,
        sourceBundleHash: aadFields.sourceBundleHash,
        userId: aadFields.userId,
      }),
      bucket,
      cryptoKey: await store.deriveBrowserVaultReplicaKey(replicaRef),
      expectedKeyId: replicaRef.keyId,
      key: replicaRef.objectKey,
      scope: "browser-vault-replica",
    });
    expect(loadedBytes).not.toBeNull();
    const loaded: unknown = JSON.parse(new TextDecoder().decode(loadedBytes ?? undefined));
    expect(loaded).toEqual(replica);
    expect(parseBrowserVaultReplica(loaded)).toEqual(replica);
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
    ).toThrow("Browser vault replica.schema must be murph.browser-vault-replica.v1.");
  });

  it("keeps prior replica objects until explicitly deleted", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(31);
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      userId: "user_123",
    });

    const firstRef = await store.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
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
        generatedAt: "2026-04-18T00:00:00.000Z",
        sourceBundleHash: "c".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: {
            revision: 2,
          },
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    expect(firstRef.objectKey).not.toBe(secondRef.objectKey);
    expect(firstRef.dataVersion).not.toBe(secondRef.dataVersion);
    expect(bucket.objects.has(firstRef.objectKey)).toBe(true);
    expect(bucket.objects.has(secondRef.objectKey)).toBe(true);
    expect(bucket.deleted).toEqual([]);

    await store.deleteBrowserVaultReplica(firstRef);

    expect(bucket.deleted).toEqual([firstRef.objectKey]);
    expect(bucket.objects.has(firstRef.objectKey)).toBe(false);
    expect(bucket.objects.has(secondRef.objectKey)).toBe(true);
  });

  it("derives replica object keys independently of root-key bytes", async () => {
    const replica = await createBrowserVaultReplica({
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
      userId: "user_123",
    }).writeBrowserVaultReplica({
      replica,
      userId: "user_123",
    });
    const secondRef = await createHostedBrowserVaultReplicaStore({
      bucket: new MemoryEncryptedR2Bucket(),
      rootKey: createTestRootKey(46),
      userId: "user_123",
    }).writeBrowserVaultReplica({
      replica,
      userId: "user_123",
    });

    expect(firstRef.objectKey).toBe(secondRef.objectKey);
    expectOpaqueStrings([firstRef.objectKey], ["user_123"]);
  });

  it("refuses to delete a replica outside the bound user's namespace", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(37);
    const store = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
    });
    const foreignDeleteStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      userId: "user_456",
    });

    const foreignRef = await store.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
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
      userId: "user_123",
    });
    const foreignReadStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
      userId: "user_456",
    });

    const foreignRef = await ownerStore.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
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
      userId: "user_123",
    });
    const unboundReadStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
    });
    const ref = await ownerStore.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
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
