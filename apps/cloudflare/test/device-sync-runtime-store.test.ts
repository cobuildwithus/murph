import { describe, expect, it } from "vitest";

import type { HostedExecutionDeviceSyncRuntimeConnectionSeed } from "@murphai/device-syncd/hosted-runtime";

import type { R2BucketLike } from "../src/bundle-store.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "../src/crypto-context.js";
import { writeEncryptedR2Json } from "../src/crypto.js";
import { createHostedDeviceSyncRuntimeStore } from "../src/device-sync-runtime-store.js";

class InMemoryR2Object {
  constructor(private readonly value: string) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new TextEncoder().encode(this.value).buffer;
  }
}

function createInMemoryR2Bucket() {
  const objects = new Map<string, string>();
  const bucket: R2BucketLike = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : new InMemoryR2Object(value);
    },
    async put(key, value) {
      objects.set(key, value);
    },
  };

  return {
    bucket,
    objects,
  };
}

function createRuntimeStoreHarness() {
  const { bucket, objects } = createInMemoryR2Bucket();
  const key = new Uint8Array(32).fill(7);
  const keyId = "v1";

  return {
    bucket,
    key,
    keyId,
    objects,
    store: createHostedDeviceSyncRuntimeStore({
      bucket,
      key,
      keyId,
    }),
  };
}

function createSeed(input: {
  accessToken: string;
  accessTokenExpiresAt?: string | null;
  connectionId?: string;
  createdAt: string;
  nextReconcileAt?: string | null;
  provider?: string;
  refreshToken?: string | null;
  tokenVersion?: number;
  updatedAt?: string;
}): HostedExecutionDeviceSyncRuntimeConnectionSeed {
  const connectionId = input.connectionId ?? "dsc_test";
  const provider = input.provider ?? "oura";

  return {
    connection: {
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
      connectedAt: input.createdAt,
      createdAt: input.createdAt,
      displayName: "Test device",
      externalAccountId: "external-account-1",
      id: connectionId,
      metadata: {},
      provider,
      scopes: ["read"],
      status: "active",
      updatedAt: input.updatedAt ?? input.createdAt,
    },
    localState: {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: input.nextReconcileAt ?? null,
    },
    tokenBundle: {
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
      keyVersion: "v1",
      refreshToken: input.refreshToken ?? null,
      tokenVersion: input.tokenVersion ?? 1,
    },
  } satisfies HostedExecutionDeviceSyncRuntimeConnectionSeed;
}

describe("createHostedDeviceSyncRuntimeStore", () => {
  it("treats local-state writes as compare-and-swap updates when observedUpdatedAt is supplied", async () => {
    const { store } = createRuntimeStoreHarness();
    const userId = "user_local_state";
    const connectionId = "dsc_local_state";
    const createdAt = "2026-04-01T00:00:00.000Z";
    const firstHeartbeatAt = "2026-04-01T00:05:00.000Z";
    const staleHeartbeatAt = "2026-04-01T00:10:00.000Z";

    await store.applyUpdates({
      userId,
      occurredAt: createdAt,
      updates: [
        {
          connectionId,
          seed: createSeed({
            accessToken: "access-1",
            connectionId,
            createdAt,
          }),
          tokenBundle: {
            accessToken: "access-1",
            accessTokenExpiresAt: null,
            keyVersion: "v1",
            refreshToken: null,
            tokenVersion: 1,
          },
        },
      ],
    });

    await store.applyUpdates({
      userId,
      occurredAt: firstHeartbeatAt,
      updates: [
        {
          connectionId,
          observedUpdatedAt: createdAt,
          localState: {
            lastWebhookAt: firstHeartbeatAt,
          },
        },
      ],
    });

    const response = await store.applyUpdates({
      userId,
      occurredAt: staleHeartbeatAt,
      updates: [
        {
          connectionId,
          observedUpdatedAt: createdAt,
          localState: {
            lastErrorCode: "STALE_HEARTBEAT",
            lastErrorMessage: "stale heartbeat should not overwrite newer runtime state",
          },
        },
      ],
    });

    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");

    const snapshot = await store.readSnapshot({ userId });
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.connections[0]?.connection.updatedAt).toBe(firstHeartbeatAt);
    expect(snapshot.connections[0]?.localState.lastWebhookAt).toBe(firstHeartbeatAt);
    expect(snapshot.connections[0]?.localState.lastErrorCode).toBeNull();
    expect(snapshot.connections[0]?.localState.lastErrorMessage).toBeNull();
  });

  it("skips disconnect-like mutations when the observed token version is stale even without observedUpdatedAt", async () => {
    const { store } = createRuntimeStoreHarness();
    const userId = "user_token_version";
    const connectionId = "dsc_token_version";
    const createdAt = "2026-04-02T00:00:00.000Z";
    const disconnectAttemptAt = "2026-04-02T00:05:00.000Z";
    const nextReconcileAt = "2026-04-03T00:00:00.000Z";

    await store.applyUpdates({
      userId,
      occurredAt: createdAt,
      updates: [
        {
          connectionId,
          seed: createSeed({
            accessToken: "access-2",
            connectionId,
            createdAt,
            nextReconcileAt,
            refreshToken: "refresh-2",
            tokenVersion: 2,
          }),
          tokenBundle: {
            accessToken: "access-2",
            accessTokenExpiresAt: null,
            keyVersion: "v1",
            refreshToken: "refresh-2",
            tokenVersion: 2,
          },
        },
      ],
    });

    const response = await store.applyUpdates({
      userId,
      occurredAt: disconnectAttemptAt,
      updates: [
        {
          connectionId,
          observedTokenVersion: 1,
          connection: {
            status: "disconnected",
          },
          localState: {
            clearError: true,
            nextReconcileAt: null,
          },
          tokenBundle: null,
        },
      ],
    });

    expect(response.updates[0]?.tokenUpdate).toBe("skipped_version_mismatch");
    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");
    expect(response.updates[0]?.connection?.status).toBe("active");
    expect(response.updates[0]?.connection?.updatedAt).toBe(createdAt);

    const snapshot = await store.readSnapshot({ userId });
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.connections[0]?.connection.status).toBe("active");
    expect(snapshot.connections[0]?.connection.updatedAt).toBe(createdAt);
    expect(snapshot.connections[0]?.localState.nextReconcileAt).toBe(nextReconcileAt);
    expect(snapshot.connections[0]?.tokenBundle?.tokenVersion).toBe(2);
    expect(snapshot.connections[0]?.tokenBundle?.accessToken).toBe("access-2");
    expect(snapshot.connections[0]?.tokenBundle?.refreshToken).toBe("refresh-2");
  });

  it("treats missing current tokens as a token-version mismatch for stale reactivation attempts", async () => {
    const { store } = createRuntimeStoreHarness();
    const userId = "user_cleared_token_guard";
    const connectionId = "dsc_cleared_token_guard";
    const createdAt = "2026-04-03T00:00:00.000Z";
    const disconnectedAt = "2026-04-03T00:05:00.000Z";
    const staleRefreshAt = "2026-04-03T00:10:00.000Z";

    await store.applyUpdates({
      userId,
      occurredAt: createdAt,
      updates: [
        {
          connectionId,
          seed: createSeed({
            accessToken: "access-3",
            accessTokenExpiresAt: "2026-04-04T00:00:00.000Z",
            connectionId,
            createdAt,
            refreshToken: "refresh-3",
            tokenVersion: 2,
          }),
          tokenBundle: {
            accessToken: "access-3",
            accessTokenExpiresAt: "2026-04-04T00:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "refresh-3",
            tokenVersion: 2,
          },
        },
      ],
    });

    await store.applyUpdates({
      userId,
      occurredAt: disconnectedAt,
      updates: [
        {
          connectionId,
          observedTokenVersion: 2,
          connection: {
            status: "disconnected",
          },
          tokenBundle: null,
        },
      ],
    });

    const response = await store.applyUpdates({
      userId,
      occurredAt: staleRefreshAt,
      updates: [
        {
          connectionId,
          connection: {
            status: "active",
          },
          localState: {
            clearError: true,
          },
          observedTokenVersion: 2,
          tokenBundle: {
            accessToken: "access-3b",
            accessTokenExpiresAt: null,
            keyVersion: "v1",
            refreshToken: "refresh-3",
            tokenVersion: 2,
          },
        },
      ],
    });

    expect(response.updates[0]?.tokenUpdate).toBe("skipped_version_mismatch");
    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");
    expect(response.updates[0]?.connection?.status).toBe("disconnected");
    expect(response.updates[0]?.connection?.accessTokenExpiresAt).toBeNull();
    expect(response.updates[0]?.connection?.updatedAt).toBe(disconnectedAt);

    const snapshot = await store.readSnapshot({ userId });
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.connections[0]?.connection.status).toBe("disconnected");
    expect(snapshot.connections[0]?.connection.accessTokenExpiresAt).toBeNull();
    expect(snapshot.connections[0]?.connection.updatedAt).toBe(disconnectedAt);
    expect(snapshot.connections[0]?.tokenBundle).toBeNull();
  });

  it("sanitizes metadata from both seeds and later connection updates", async () => {
    const { store } = createRuntimeStoreHarness();
    const userId = "user_metadata";
    const connectionId = "dsc_metadata";
    const createdAt = "2026-04-04T00:00:00.000Z";
    const updatedAt = "2026-04-04T00:05:00.000Z";

    await store.applyUpdates({
      userId,
      occurredAt: createdAt,
      updates: [
        {
          connectionId,
          seed: {
            ...createSeed({
              accessToken: "access-3",
              connectionId,
              createdAt,
            }),
            connection: {
              ...createSeed({
                accessToken: "access-3",
                connectionId,
                createdAt,
              }).connection,
              metadata: {
                access_token: "blocked",
                allowed: "seed-safe",
                nested: {
                  ignored: true,
                },
              },
            },
          },
          tokenBundle: {
            accessToken: "access-3",
            accessTokenExpiresAt: null,
            keyVersion: "v1",
            refreshToken: null,
            tokenVersion: 1,
          },
        },
      ],
    });

    await store.applyUpdates({
      userId,
      occurredAt: updatedAt,
      updates: [
        {
          connectionId,
          connection: {
            metadata: {
              allowed: "updated-safe",
              enabled: true,
              refreshToken: "blocked",
              nested: {
                ignored: false,
              },
            },
          },
          observedUpdatedAt: createdAt,
        },
      ],
    });

    const snapshot = await store.readSnapshot({ userId });
    expect(snapshot.connections[0]?.connection.metadata).toEqual({
      allowed: "updated-safe",
      enabled: true,
    });
  });

  it("rejects stored snapshots that use a legacy schema", async () => {
    const { bucket, key, keyId, store } = createRuntimeStoreHarness();
    const userId = "user_legacy_schema";
    const objectKey = `transient/device-sync-runtime/${await deriveHostedStorageOpaqueId({
      length: 24,
      rootKey: key,
      scope: "device-sync-runtime-path",
      value: `user:${userId}`,
    })}.json`;

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "device-sync-runtime",
        userId,
      }),
      bucket,
      cryptoKey: key,
      key: objectKey,
      keyId,
      scope: "device-sync-runtime",
      value: {
        generatedAt: "2026-04-05T00:00:00.000Z",
        schema: "murph.hosted-device-sync-runtime.v0",
        snapshot: {
          connections: [],
          generatedAt: "2026-04-05T00:00:00.000Z",
          userId,
        },
      },
    });

    await expect(store.readSnapshot({ userId })).rejects.toThrow(
      "Hosted device-sync runtime state.schema must be murph.hosted-device-sync-runtime.v1.",
    );
  });
});
