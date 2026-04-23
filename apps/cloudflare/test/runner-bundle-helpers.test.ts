import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  encodeHostedBundleBase64,
  sha256HostedBundleHex,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node/hosted-bundle-codec";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
  describeHostedBase64BundleRef,
  describeHostedBundleBytesRef,
  writeHostedBundleBytesIfChanged,
  type HostedBundleStore,
} from "../src/bundle-store.js";
import {
  buildHostedStorageAad,
} from "../src/crypto-context.js";
import { encryptHostedStorageEnvelope } from "../src/crypto.js";
import { hostedArtifactObjectKey } from "../src/storage-paths.js";
import { HostedBundleGarbageCollector } from "../src/bundle-gc.js";
import { RunnerBundleSync } from "../src/user-runner/runner-bundle-sync.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

describe("writeHostedBundleBytesIfChanged", () => {
  it("reuses the current ref when the payload identity is unchanged", async () => {
    const plaintext = Uint8Array.from([1, 2, 3]);
    const currentRef = {
      ...describeHostedBundleBytesRef("vault", plaintext),
      updatedAt: "2026-03-31T00:00:00.000Z",
    };
    const bundleStore: HostedBundleStore = {
      deleteBundle: vi.fn(async () => undefined),
      readBundle: vi.fn(async () => null),
      writeBundle: vi.fn(async () => {
        throw new Error("writeBundle should not be called when the bundle payload is unchanged.");
      }),
    };

    const result = await writeHostedBundleBytesIfChanged({
      bundleStore,
      currentRef,
      kind: "vault",
      plaintext,
    });

    expect(result).toBe(currentRef);
    expect(bundleStore.writeBundle).not.toHaveBeenCalled();
  });
});

describe("describeHostedBase64BundleRef", () => {
  it("derives payload identity without manufacturing updatedAt metadata", () => {
    const plaintext = Uint8Array.from([7, 8, 9]);
    const described = describeHostedBase64BundleRef({
      kind: "vault",
      value: encodeHostedBundleBase64(plaintext),
    });

    expect(described).not.toBeNull();
    expect(described?.plaintext).toEqual(plaintext);
    expect(described?.ref).toEqual(describeHostedBundleBytesRef("vault", plaintext));
    expect(Object.hasOwn(described!.ref, "updatedAt")).toBe(false);
  });
});

describe("hosted bundle reads", () => {
  const bundleKey = Uint8Array.from({ length: 32 }, () => 9);

  it("fails closed when stored bundle bytes no longer match the recorded ref size", async () => {
    const bucket = createBucketStore();
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
    });
    const ref = await bundleStore.writeBundle("vault", Uint8Array.from(Buffer.from("vault")));
    const corruptedEnvelope = await encryptHostedStorageEnvelope({
      aad: buildHostedStorageAad({
        hash: ref.hash,
        key: ref.key,
        kind: "vault",
        purpose: "bundle",
        size: ref.size,
      }),
      key: bundleKey,
      keyId: "v1",
      plaintext: Uint8Array.from(Buffer.from("vault-corrupted")),
      scope: "bundle",
    });

    await bucket.api.put(ref.key, JSON.stringify(corruptedEnvelope));

    await expect(bundleStore.readBundle(ref)).rejects.toThrow(
      `Hosted bundle ${ref.key} size mismatch: expected ${ref.size}, got ${"vault-corrupted".length}.`,
    );
  });

  it("fails closed when artifact ciphertext is rebound with mismatched AAD", async () => {
    const bucket = createBucketStore();
    const artifactStore = createHostedArtifactStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const artifactBytes = Uint8Array.from(Buffer.from("artifact"));
    const artifactSha = "c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c";

    await artifactStore.writeArtifact(artifactSha, artifactBytes);
    const objectKey = await artifactObjectKeyForTest(bundleKey, "member_123", artifactSha);
    const corruptedEnvelope = await encryptHostedStorageEnvelope({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "artifact",
        sha256: "0".repeat(64),
        userId: "member_123",
      }),
      key: bundleKey,
      keyId: "v1",
      plaintext: Uint8Array.from(Buffer.from("artifact-corrupted")),
      scope: "artifact",
    });

    await bucket.api.put(
      objectKey,
      JSON.stringify(corruptedEnvelope),
    );

    await expect(artifactStore.readArtifact(artifactSha)).rejects.toThrow();
  });
});

describe("RunnerBundleSync", () => {
  const bundleKey = Uint8Array.from({ length: 32 }, () => 9);

  it("fails closed when the acquired snapshot ref points at a missing R2 object", async () => {
    const bucket = createBucketStore();
    const missingRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    }).writeBundle("vault", Uint8Array.from(Buffer.from("vault")));
    bucket.values.delete(missingRef.key);

    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );

    await expect(bundleSync.readBundlesForRunner(missingRef, "member_123")).rejects.toThrow(
      `Hosted vault bundle ${missingRef.key} is missing from R2.`,
    );
  });

  it("writes the next bundle from the web-owned current snapshot ref", async () => {
    const bucket = createBucketStore();
    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );
    const firstBundle = Uint8Array.from(Buffer.from("bundle-one"));
    const currentBundleRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    }).writeBundle("vault", firstBundle);

    const nextBundle = await bundleSync.applyRunnerResultBundles(
      "member_123",
      currentBundleRef,
      encodeHostedBundleBase64(Uint8Array.from(Buffer.from("bundle-two"))),
    );

    await expect(bundleSync.readBundlesForRunner(nextBundle.bundleRef, "member_123")).resolves.not.toBeNull();
  });

  it("refuses to restore a bundle from another user's namespace", async () => {
    const bucket = createBucketStore();
    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );
    const foreignRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_b",
    }).writeBundle("vault", Uint8Array.from(Buffer.from("bundle-two")));

    await expect(bundleSync.readBundlesForRunner(foreignRef, "member_a")).rejects.toThrow(
      `Hosted bundle ${foreignRef.key} is outside the bound user bundle namespace.`,
    );
  });

  it("still restores legacy global bundle refs when a user namespace is bound", async () => {
    const bucket = createBucketStore();
    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );
    const globalRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
    }).writeBundle("vault", Uint8Array.from(Buffer.from("bundle-global")));

    await expect(bundleSync.readBundlesForRunner(globalRef, "member_a")).resolves.toEqual(
      encodeHostedBundleBase64(Uint8Array.from(Buffer.from("bundle-global"))),
    );
  });

  it("does not delete bundle objects before the authoritative cursor commits the new ref", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const bundleSync = new RunnerBundleSync(
      bucket,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );
    const currentBundleRef = await createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    }).writeBundle("vault", Uint8Array.from(Buffer.from("bundle-one")));

    await expect(bundleSync.applyRunnerResultBundles(
      "member_123",
      currentBundleRef,
      encodeHostedBundleBase64(Uint8Array.from(Buffer.from("bundle-two"))),
    )).resolves.toEqual({
      bundleRef: expect.objectContaining({
        key: expect.any(String),
      }),
    });

    expect(bucket.deleted).toEqual([]);
  });
});

describe("HostedBundleGarbageCollector", () => {
  const bundleKey = Uint8Array.from({ length: 32 }, () => 7);

  it("deletes superseded bundle objects and removed artifacts after a committed ref swap", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const artifactStore = createHostedArtifactStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const bundleStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const previousArtifactBytes = Uint8Array.from(Buffer.from("old-artifact"));
    const previousArtifactSha = sha256HostedBundleHex(previousArtifactBytes);

    await artifactStore.writeArtifact(previousArtifactSha, previousArtifactBytes);
    const previousBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle(previousArtifactSha, previousArtifactBytes.byteLength),
    );
    const nextBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle("", 0),
    );
    const previousArtifactKey = await artifactObjectKeyForTest(
      bundleKey,
      "member_123",
      previousArtifactSha,
    );

    await new HostedBundleGarbageCollector(
      bucket,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    ).cleanupBundleTransition({
      nextBundleRef,
      previousBundleRef,
      userId: "member_123",
    });

    expect(bucket.deleted).toEqual(expect.arrayContaining([
      previousArtifactKey,
      previousBundleRef.key,
    ]));
    expect(bucket.deleted).toHaveLength(2);
    expect(bucket.objects.has(previousArtifactKey)).toBe(false);
    expect(bucket.objects.has(previousBundleRef.key)).toBe(false);
    expect(bucket.objects.has(nextBundleRef.key)).toBe(true);
  });

  it("keeps another user's distinct bundle object alive after one user cleans up a superseded ref", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const firstUserStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_a",
    });
    const secondUserStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_b",
    });
    const firstUserPreviousBytes = createArtifactOnlyBundle("", 0);
    const secondUserBytes = createArtifactOnlyBundle("a".repeat(64), 1);
    const replacementBytes = createArtifactOnlyBundle("b".repeat(64), 1);
    const firstUserPreviousRef = await firstUserStore.writeBundle("vault", firstUserPreviousBytes);
    const secondUserRef = await secondUserStore.writeBundle("vault", secondUserBytes);
    const firstUserNextRef = await firstUserStore.writeBundle("vault", replacementBytes);

    expect(firstUserPreviousRef.key).not.toBe(secondUserRef.key);

    await new HostedBundleGarbageCollector(
      bucket,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    ).cleanupBundleTransition({
      nextBundleRef: firstUserNextRef,
      previousBundleRef: firstUserPreviousRef,
      userId: "member_a",
    });

    expect(bucket.objects.has(firstUserPreviousRef.key)).toBe(false);
    expect(bucket.objects.has(firstUserNextRef.key)).toBe(true);
    expect(bucket.objects.has(secondUserRef.key)).toBe(true);
    await expect(secondUserStore.readBundle(secondUserRef)).resolves.toEqual(secondUserBytes);
  });

  it("refuses bundle cleanup when the ref belongs to another user's namespace", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const firstUserStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_a",
    });
    const secondUserStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_b",
    });
    const foreignRef = await secondUserStore.writeBundle(
      "vault",
      createArtifactOnlyBundle("a".repeat(64), 1),
    );
    const replacementRef = await firstUserStore.writeBundle(
      "vault",
      createArtifactOnlyBundle("", 0),
    );

    await expect(
      new HostedBundleGarbageCollector(
        bucket,
        bundleKey,
        "v1",
        {
          v1: bundleKey,
        },
      ).cleanupBundleTransition({
        nextBundleRef: replacementRef,
        previousBundleRef: foreignRef,
        userId: "member_a",
      }),
    ).rejects.toThrow(`Hosted bundle ${foreignRef.key} is outside the bound user bundle namespace.`);

    expect(bucket.objects.has(foreignRef.key)).toBe(true);
    expect(bucket.objects.has(replacementRef.key)).toBe(true);
    expect(bucket.deleted).toEqual([]);
  });

  it("fails closed and preserves the previous bundle when the authoritative next bundle is missing", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const artifactStore = createHostedArtifactStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const bundleStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const previousArtifactBytes = Uint8Array.from(Buffer.from("old-artifact"));
    const previousArtifactSha = sha256HostedBundleHex(previousArtifactBytes);

    await artifactStore.writeArtifact(previousArtifactSha, previousArtifactBytes);
    const previousBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle(previousArtifactSha, previousArtifactBytes.byteLength),
    );
    const nextBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle("", 0),
    );
    const previousArtifactKey = await artifactObjectKeyForTest(
      bundleKey,
      "member_123",
      previousArtifactSha,
    );

    await bucket.delete(nextBundleRef.key);

    await expect(
      new HostedBundleGarbageCollector(
        bucket,
        bundleKey,
        "v1",
        {
          v1: bundleKey,
        },
      ).cleanupBundleTransition({
        nextBundleRef,
        previousBundleRef,
        userId: "member_123",
      }),
    ).rejects.toThrow(
      `Hosted vault bundle ${nextBundleRef.key} is missing from R2.`,
    );

    expect(bucket.objects.has(previousArtifactKey)).toBe(true);
    expect(bucket.objects.has(previousBundleRef.key)).toBe(true);
    expect(bucket.deleted).toEqual([nextBundleRef.key]);
  });

  it("fails closed and preserves an artifact-free previous bundle when the authoritative next bundle is missing", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const bundleStore = createHostedBundleStore({
      bucket,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const previousBundleRef = await bundleStore.writeBundle(
      "vault",
      createTextOnlyBundle("notes/previous.txt", "previous"),
    );
    const nextBundleRef = await bundleStore.writeBundle(
      "vault",
      createTextOnlyBundle("notes/next.txt", "next"),
    );

    await bucket.delete(nextBundleRef.key);
    bucket.deleted.length = 0;

    await expect(
      new HostedBundleGarbageCollector(
        bucket,
        bundleKey,
        "v1",
        {
          v1: bundleKey,
        },
      ).cleanupBundleTransition({
        nextBundleRef,
        previousBundleRef,
        userId: "member_123",
      }),
    ).rejects.toThrow(
      `Hosted vault bundle ${nextBundleRef.key} is missing from R2.`,
    );

    expect(bucket.deleted).toEqual([]);
    expect(bucket.objects.has(previousBundleRef.key)).toBe(true);
  });

  it("fails closed and preserves the previous bundle when the authoritative next bundle cannot be decrypted", async () => {
    const bucket = createBucketStore();
    const artifactStore = createHostedArtifactStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
    });
    const previousArtifactBytes = Uint8Array.from(Buffer.from("old-artifact"));
    const previousArtifactSha = sha256HostedBundleHex(previousArtifactBytes);

    await artifactStore.writeArtifact(previousArtifactSha, previousArtifactBytes);
    const previousBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle(previousArtifactSha, previousArtifactBytes.byteLength),
    );
    const nextBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle("", 0),
    );
    const previousArtifactKey = await artifactObjectKeyForTest(
      bundleKey,
      "member_123",
      previousArtifactSha,
    );
    const corruptedEnvelope = await encryptHostedStorageEnvelope({
      aad: buildHostedStorageAad({
        hash: nextBundleRef.hash,
        key: nextBundleRef.key,
        kind: "vault",
        purpose: "bundle",
        size: nextBundleRef.size,
      }),
      key: Uint8Array.from({ length: 32 }, () => 1),
      keyId: "v1",
      plaintext: createArtifactOnlyBundle("", 0),
      scope: "bundle",
    });

    await bucket.api.put(nextBundleRef.key, JSON.stringify(corruptedEnvelope));

    await expect(
      new HostedBundleGarbageCollector(
        bucket.api,
        bundleKey,
        "v1",
        {
          v1: bundleKey,
        },
      ).cleanupBundleTransition({
        nextBundleRef,
        previousBundleRef,
        userId: "member_123",
      }),
    ).rejects.toThrow();

    expect(bucket.deleted).toEqual([]);
    expect(bucket.values.has(previousArtifactKey)).toBe(true);
    expect(bucket.values.has(previousBundleRef.key)).toBe(true);
  });

  it("fails closed and preserves an artifact-free previous bundle when the authoritative next bundle cannot be decrypted", async () => {
    const bucket = createBucketStore();
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
    });
    const previousBundleRef = await bundleStore.writeBundle(
      "vault",
      createTextOnlyBundle("notes/previous.txt", "previous"),
    );
    const nextBundleRef = await bundleStore.writeBundle(
      "vault",
      createTextOnlyBundle("notes/next.txt", "next"),
    );
    const corruptedEnvelope = await encryptHostedStorageEnvelope({
      aad: buildHostedStorageAad({
        hash: nextBundleRef.hash,
        key: nextBundleRef.key,
        kind: "vault",
        purpose: "bundle",
        size: nextBundleRef.size,
      }),
      key: Uint8Array.from({ length: 32 }, () => 1),
      keyId: "v1",
      plaintext: createTextOnlyBundle("notes/next.txt", "next"),
      scope: "bundle",
    });

    await bucket.api.put(nextBundleRef.key, JSON.stringify(corruptedEnvelope));

    await expect(
      new HostedBundleGarbageCollector(
        bucket.api,
        bundleKey,
        "v1",
        {
          v1: bundleKey,
        },
      ).cleanupBundleTransition({
        nextBundleRef,
        previousBundleRef,
        userId: "member_123",
      }),
    ).rejects.toThrow();

    expect(bucket.deleted).toEqual([]);
    expect(bucket.values.has(previousBundleRef.key)).toBe(true);
  });

  it("skips artifact diffing but still deletes an unreadable superseded previous bundle", async () => {
    const bucket = createBucketStore();
    const artifactStore = createHostedArtifactStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: bundleKey,
      keyId: "v1",
      userId: "member_123",
    });
    const previousArtifactBytes = Uint8Array.from(Buffer.from("old-artifact"));
    const previousArtifactSha = sha256HostedBundleHex(previousArtifactBytes);

    await artifactStore.writeArtifact(previousArtifactSha, previousArtifactBytes);
    const previousBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle(previousArtifactSha, previousArtifactBytes.byteLength),
    );
    const nextBundleRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyBundle("", 0),
    );
    const previousArtifactKey = await artifactObjectKeyForTest(
      bundleKey,
      "member_123",
      previousArtifactSha,
    );
    const corruptedEnvelope = await encryptHostedStorageEnvelope({
      aad: buildHostedStorageAad({
        hash: previousBundleRef.hash,
        key: previousBundleRef.key,
        kind: "vault",
        purpose: "bundle",
        size: previousBundleRef.size,
      }),
      key: Uint8Array.from({ length: 32 }, () => 1),
      keyId: "v1",
      plaintext: createArtifactOnlyBundle(previousArtifactSha, previousArtifactBytes.byteLength),
      scope: "bundle",
    });

    await bucket.api.put(previousBundleRef.key, JSON.stringify(corruptedEnvelope));

    await expect(
      new HostedBundleGarbageCollector(
        bucket.api,
        bundleKey,
        "v1",
        {
          v1: bundleKey,
        },
      ).cleanupBundleTransition({
        nextBundleRef,
        previousBundleRef,
        userId: "member_123",
      }),
    ).resolves.toBeUndefined();

    expect(bucket.deleted).toEqual([previousBundleRef.key]);
    expect(bucket.values.has(previousArtifactKey)).toBe(true);
    expect(bucket.values.has(previousBundleRef.key)).toBe(false);
    expect(bucket.values.has(nextBundleRef.key)).toBe(true);
  });
});

function createArtifactOnlyBundle(sha256: string, byteSize: number): Uint8Array {
  return Uint8Array.from(
    gzipSync(
      Buffer.from(JSON.stringify({
        files: sha256.length === 0
          ? []
          : [
              {
                artifact: {
                  byteSize,
                  sha256,
                },
                path: "artifacts/report.pdf",
                root: "vault",
              },
            ],
        kind: "vault",
        schema: "murph.hosted-bundle.v1",
      })),
    ),
  );
}

function createTextOnlyBundle(path: string, text: string): Uint8Array {
  return writeHostedBundleTextFile({
    bytes: null,
    kind: "vault",
    path,
    root: "vault",
    text,
  });
}

function createBucketStore() {
  const values = new Map<string, string>();
  const deleted: string[] = [];

  return {
    deleted,
    api: {
      async delete(key: string) {
        deleted.push(key);
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        const bytes = Buffer.from(value, "utf8");

        return {
          async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          },
        };
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    },
    values,
  };
}

async function artifactObjectKeyForTest(_rootKey: Uint8Array, userId: string, sha256: string): Promise<string> {
  return hostedArtifactObjectKey(_rootKey, userId, sha256);
}
