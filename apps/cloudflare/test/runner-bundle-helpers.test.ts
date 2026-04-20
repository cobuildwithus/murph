import { describe, expect, it, vi } from "vitest";

import { encodeHostedBundleBase64 } from "@murphai/runtime-state/node/hosted-bundle-codec";

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
    const missingRef = {
      hash: "a".repeat(64),
      key: `bundles/vault/${"a".repeat(64)}.bundle.json`,
      size: 5,
      updatedAt: "2026-04-02T00:00:00.000Z",
    };

    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );

    await expect(bundleSync.readBundlesForRunner(missingRef)).rejects.toThrow(
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
    }).writeBundle("vault", firstBundle);

    const nextBundle = await bundleSync.applyRunnerResultBundles(
      "member_123",
      currentBundleRef,
      encodeHostedBundleBase64(Uint8Array.from(Buffer.from("bundle-two"))),
    );

    await expect(bundleSync.readBundlesForRunner(nextBundle.bundleRef)).resolves.not.toBeNull();
  });

  it("logs best-effort cleanup failures after a successful bundle swap", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cleanupSpy = vi.spyOn(
      HostedBundleGarbageCollector.prototype,
      "cleanupBundleTransition",
    ).mockRejectedValueOnce(new Error("cleanup failed"));
    const bucket = createBucketStore();
    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
    );

    await expect(bundleSync.applyRunnerResultBundles(
      "member_123",
      null,
      null,
    )).resolves.toEqual({
      bundleRef: null,
    });

    expect(cleanupSpy).toHaveBeenCalledOnce();
    const logRecords = warnSpy.mock.calls.map(([entry]) => JSON.parse(String(entry)) as {
      details?: {
        nextBundleRefKey?: string | null;
        previousBundleRefKey?: string | null;
        userId?: string;
      };
      message: string;
    });
    expect(logRecords.some((record) => record.message.includes("bundle cleanup failed")
      && record.details?.userId === "member_123")).toBe(true);
    cleanupSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

function createBucketStore() {
  const values = new Map<string, string>();

  return {
    api: {
      async delete(key: string) {
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
  };
}

async function artifactObjectKeyForTest(_rootKey: Uint8Array, userId: string, sha256: string): Promise<string> {
  return hostedArtifactObjectKey(_rootKey, userId, sha256);
}
