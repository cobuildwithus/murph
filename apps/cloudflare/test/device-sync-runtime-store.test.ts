import { describe, expect, it } from "vitest";

import { createHostedDeviceSyncRuntimeStore } from "../src/device-sync-runtime-store.js";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../src/crypto-context.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "../src/crypto.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

const TIMESTAMP = "2026-04-07T00:00:00.000Z";

describe("createHostedDeviceSyncRuntimeStore", () => {
  it("rejects the removed mirror schema instead of reading it as current state", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const key = createTestRootKey(27);
    const userId = "user_legacy_runtime";
    const objectKey = await deviceSyncRuntimeStateObjectKey(key, userId);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "device-sync-runtime",
        userId,
      }),
      bucket,
      cryptoKey: key,
      key: objectKey,
      keyId: "v1",
      scope: "device-sync-runtime",
      value: {
        generatedAt: "2026-04-06T00:00:00.000Z",
        schema: "murph.hosted-device-sync-runtime-mirror.v1",
        snapshot: {
          connections: [],
          generatedAt: "2026-04-06T00:00:00.000Z",
          userId,
        },
      },
    });

    const store = createHostedDeviceSyncRuntimeStore({
      bucket,
      key,
      keyId: "v1",
    });

    await expect(store.readSnapshot({ userId })).rejects.toThrow(
      "Hosted device-sync runtime state.schema must be murph.hosted-device-sync-runtime.v1.",
    );
  });

  it("sanitizes seeded metadata before persisting runtime state", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const key = createTestRootKey(28);
    const userId = "user_seeded_runtime";
    const store = createHostedDeviceSyncRuntimeStore({
      bucket,
      key,
      keyId: "v1",
    });

    await store.applyUpdates({
      updates: [
        {
          connectionId: "conn_123",
          seed: buildSeed({
            accountTier: "pro",
            nested: { leaked: true },
          }),
        },
      ],
      userId,
    });

    const state = await readStoredRuntimeState(bucket, key, userId);

    expect(state?.snapshot.connections[0]?.connection.metadata).toEqual({
      accountTier: "pro",
    });
  });

  it("sanitizes metadata updates even when callers bypass request parsing", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const key = createTestRootKey(29);
    const userId = "user_updated_runtime";
    const store = createHostedDeviceSyncRuntimeStore({
      bucket,
      key,
      keyId: "v1",
    });

    await store.applyUpdates({
      updates: [
        {
          connectionId: "conn_123",
          seed: buildSeed({
            accountTier: "basic",
          }),
        },
      ],
      userId,
    });

    await store.applyUpdates({
      updates: [
        {
          connection: {
            metadata: {
              accountTier: "pro",
              nested: { leaked: true },
              retryCount: 3,
            },
          },
          connectionId: "conn_123",
        },
      ],
      userId,
    });

    const state = await readStoredRuntimeState(bucket, key, userId);

    expect(state?.snapshot.connections[0]?.connection.metadata).toEqual({
      accountTier: "pro",
      retryCount: 3,
    });
  });
});

function buildSeed(metadata: Record<string, unknown>) {
  return {
    connection: {
      accessTokenExpiresAt: null,
      connectedAt: TIMESTAMP,
      createdAt: TIMESTAMP,
      displayName: "Oura",
      externalAccountId: "acct_123",
      id: "conn_123",
      metadata,
      provider: "oura",
      scopes: ["heartrate:read"],
      status: "active" as const,
      updatedAt: TIMESTAMP,
    },
    localState: {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: null,
    },
    tokenBundle: null,
  };
}

async function readStoredRuntimeState(
  bucket: MemoryEncryptedR2Bucket,
  rootKey: Uint8Array,
  userId: string,
) {
  const key = await deviceSyncRuntimeStateObjectKey(rootKey, userId);
  return readEncryptedR2Json({
    aad: buildHostedStorageAad({
      key,
      purpose: "device-sync-runtime",
      userId,
    }),
    bucket,
    cryptoKey: rootKey,
    expectedKeyId: "v1",
    key,
    parse(value) {
      return value as {
        generatedAt: string;
        schema: string;
        snapshot: {
          connections: Array<{
            connection: {
              metadata: Record<string, unknown>;
            };
          }>;
        };
      };
    },
    scope: "device-sync-runtime",
  });
}

async function deviceSyncRuntimeStateObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "device-sync-runtime-path",
    value: `user:${userId}`,
  });

  return `transient/device-sync-runtime/${userSegment}.json`;
}
