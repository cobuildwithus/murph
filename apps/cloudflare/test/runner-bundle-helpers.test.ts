import { describe, expect, it, vi } from "vitest";

import { encodeHostedBundleBase64 } from "@murphai/runtime-state/node";

import {
  artifactObjectKey,
  createHostedArtifactStore,
  createHostedBundleStore,
  describeHostedBase64BundleRef,
  describeHostedBundleBytesRef,
  writeHostedBundleBytesIfChanged,
  type HostedBundleStore,
} from "../src/bundle-store.js";
import { encryptHostedBundle } from "../src/crypto.js";
import { RunnerBundleSync } from "../src/user-runner/runner-bundle-sync.js";
import { RunnerQueueStore } from "../src/user-runner/runner-queue-store.js";
import { createTestSqlStorage } from "./sql-storage.js";

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
      kind: "agent-state",
      value: encodeHostedBundleBase64(plaintext),
    });

    expect(described).not.toBeNull();
    expect(described?.plaintext).toEqual(plaintext);
    expect(described?.ref).toEqual(describeHostedBundleBytesRef("agent-state", plaintext));
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
    const corruptedEnvelope = await encryptHostedBundle({
      key: bundleKey,
      keyId: "v1",
      plaintext: Uint8Array.from(Buffer.from("vault-corrupted")),
    });

    await bucket.api.put(ref.key, JSON.stringify(corruptedEnvelope));

    await expect(bundleStore.readBundle(ref)).rejects.toThrow(
      `Hosted bundle ${ref.key} size mismatch: expected ${ref.size}, got ${"vault-corrupted".length}.`,
    );
  });

  it("fails closed when stored artifact bytes no longer match the requested sha", async () => {
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
    const corruptedEnvelope = await encryptHostedBundle({
      key: bundleKey,
      keyId: "v1",
      plaintext: Uint8Array.from(Buffer.from("artifact-corrupted")),
    });

    await bucket.api.put(
      artifactObjectKey("member_123", artifactSha),
      JSON.stringify(corruptedEnvelope),
    );

    await expect(artifactStore.readArtifact(artifactSha)).rejects.toThrow(
      `Hosted artifact hash mismatch: expected ${artifactSha}`,
    );
  });
});

describe("RunnerBundleSync", () => {
  const bundleKey = Uint8Array.from({ length: 32 }, () => 9);

  it("fails closed when durable bundle refs point at missing R2 objects", async () => {
    const bucket = createBucketStore();
    const sql = createTestSqlStorage();
    const state = {
      storage: {
        sql,
      },
    };
    const queueStore = new RunnerQueueStore(state as never);
    await queueStore.bootstrapUser("member_123");

    const missingRef = {
      hash: "a".repeat(64),
      key: `bundles/vault/${"a".repeat(64)}.bundle.json`,
      size: 5,
      updatedAt: "2026-04-02T00:00:00.000Z",
    };
    sql.exec(
      `UPDATE runner_meta
        SET vault_bundle_ref_json = ?, vault_bundle_version = ?
        WHERE singleton = 1`,
      JSON.stringify(missingRef),
      1,
    );

    const bundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
      queueStore,
      {},
    );

    await expect(bundleSync.readBundlesForRunner()).rejects.toThrow(
      `Hosted vault bundle ${missingRef.key} is missing from R2.`,
    );
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
