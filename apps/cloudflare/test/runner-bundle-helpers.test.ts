import { describe, expect, it, vi } from "vitest";

import { createHostedVerifiedEmailUserEnv } from "@murphai/runtime-state";
import { encodeHostedBundleBase64 } from "@murphai/runtime-state/node";

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
  deriveHostedStorageOpaqueId,
} from "../src/crypto-context.js";
import { encryptHostedBundle } from "../src/crypto.js";
import { resolveHostedEmailIngressRoute } from "../src/hosted-email/routes.js";
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
    const corruptedEnvelope = await encryptHostedBundle({
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
  const hostedEmailConfig = {
    domain: "mail.example.test",
    fromAddress: "assistant@mail.example.test",
    localPart: "assistant",
    signingSecret: "email-secret",
  };

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
      `UPDATE runner_bundle_slots
        SET bundle_ref_json = ?, bundle_version = ?
        WHERE slot = ?`,
      JSON.stringify(missingRef),
      1,
      "vault",
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

  it("syncs, moves, clears, and conflict-checks the public sender verified-owner index", async () => {
    const bucket = createBucketStore();
    const sharedUserEnvSource = {
      HOSTED_EMAIL_DOMAIN: hostedEmailConfig.domain,
      HOSTED_EMAIL_FROM_ADDRESS: hostedEmailConfig.fromAddress,
      HOSTED_EMAIL_LOCAL_PART: hostedEmailConfig.localPart,
      HOSTED_EMAIL_SIGNING_SECRET: hostedEmailConfig.signingSecret,
    };
    const firstQueueStore = new RunnerQueueStore({
      storage: {
        sql: createTestSqlStorage(),
      },
    } as never);
    const secondQueueStore = new RunnerQueueStore({
      storage: {
        sql: createTestSqlStorage(),
      },
    } as never);
    await firstQueueStore.bootstrapUser("member_123");
    await secondQueueStore.bootstrapUser("member_456");

    const firstBundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
      firstQueueStore,
      sharedUserEnvSource,
    );
    const secondBundleSync = new RunnerBundleSync(
      bucket.api,
      bundleKey,
      "v1",
      {
        v1: bundleKey,
      },
      secondQueueStore,
      sharedUserEnvSource,
    );

    await firstBundleSync.updateUserEnv("member_123", {
      env: createHostedVerifiedEmailUserEnv({
        address: "owner@example.test",
      }),
      mode: "replace",
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket: bucket.api,
      config: hostedEmailConfig,
      envelopeFrom: "owner@example.test",
      hasRepeatedHeaderFrom: false,
      headerFrom: "owner@example.test",
      key: bundleKey,
      keyId: "v1",
      to: hostedEmailConfig.fromAddress,
    })).resolves.toMatchObject({
      routeAddress: hostedEmailConfig.fromAddress,
      userId: "member_123",
    });

    await firstBundleSync.updateUserEnv("member_123", {
      env: createHostedVerifiedEmailUserEnv({
        address: "new-owner@example.test",
      }),
      mode: "replace",
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket: bucket.api,
      config: hostedEmailConfig,
      envelopeFrom: "owner@example.test",
      hasRepeatedHeaderFrom: false,
      headerFrom: "owner@example.test",
      key: bundleKey,
      keyId: "v1",
      to: hostedEmailConfig.fromAddress,
    })).resolves.toBeNull();
    await expect(resolveHostedEmailIngressRoute({
      bucket: bucket.api,
      config: hostedEmailConfig,
      envelopeFrom: "new-owner@example.test",
      hasRepeatedHeaderFrom: false,
      headerFrom: "new-owner@example.test",
      key: bundleKey,
      keyId: "v1",
      to: hostedEmailConfig.fromAddress,
    })).resolves.toMatchObject({
      userId: "member_123",
    });

    await expect(secondBundleSync.updateUserEnv("member_456", {
      env: createHostedVerifiedEmailUserEnv({
        address: "new-owner@example.test",
      }),
      mode: "replace",
    })).rejects.toThrow("Hosted verified email sender route is already assigned to a different user.");

    await firstBundleSync.updateUserEnv("member_123", {
      env: {},
      mode: "replace",
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket: bucket.api,
      config: hostedEmailConfig,
      envelopeFrom: "new-owner@example.test",
      hasRepeatedHeaderFrom: false,
      headerFrom: "new-owner@example.test",
      key: bundleKey,
      keyId: "v1",
      to: hostedEmailConfig.fromAddress,
    })).resolves.toBeNull();
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

async function artifactObjectKeyForTest(rootKey: Uint8Array, userId: string, sha256: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "artifact",
    value: `user:${userId}`,
  });
  const artifactSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "artifact",
    value: `artifact:${userId}:${sha256}`,
  });

  return `users/${userSegment}/artifacts/${artifactSegment}.artifact.bin`;
}
