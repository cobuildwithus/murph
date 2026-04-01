import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mapHostedInternalAccountRecord: vi.fn((record: Record<string, unknown>) => ({
    accessTokenExpiresAt: typeof record.accessTokenExpiresAt === "string" ? record.accessTokenExpiresAt : null,
    connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : "2026-03-26T12:00:00.000Z",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "2026-03-26T12:00:00.000Z",
    displayName: typeof record.displayName === "string" ? record.displayName : null,
    externalAccountId: typeof record.externalAccountId === "string" ? record.externalAccountId : "acct_123",
    id: String(record.id),
    lastErrorCode: typeof record.lastErrorCode === "string" ? record.lastErrorCode : null,
    lastErrorMessage: typeof record.lastErrorMessage === "string" ? record.lastErrorMessage : null,
    lastSyncCompletedAt: typeof record.lastSyncCompletedAt === "string" ? record.lastSyncCompletedAt : null,
    lastSyncErrorAt: typeof record.lastSyncErrorAt === "string" ? record.lastSyncErrorAt : null,
    lastSyncStartedAt: typeof record.lastSyncStartedAt === "string" ? record.lastSyncStartedAt : null,
    lastWebhookAt: typeof record.lastWebhookAt === "string" ? record.lastWebhookAt : null,
    metadata: (record.metadataJson as Record<string, unknown> | undefined) ?? {},
    nextReconcileAt: typeof record.nextReconcileAt === "string" ? record.nextReconcileAt : null,
    provider: String(record.provider),
    scopes: Array.isArray(record.scopes) ? record.scopes.filter((entry): entry is string => typeof entry === "string") : [],
    status: record.status === "reauthorization_required" || record.status === "disconnected" ? record.status : "active",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "2026-03-26T12:00:00.000Z",
  })),
  requireHostedConnectionBundleRecord: vi.fn((record: Record<string, unknown>) => ({
    account: {
      accessToken: "access-token",
      accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
      refreshToken: "refresh-token",
    },
    keyVersion: "v1",
    tokenVersion: typeof (record.secret as { tokenVersion?: unknown } | undefined)?.tokenVersion === "number"
      ? (record.secret as { tokenVersion: number }).tokenVersion
      : 1,
    userId: String(record.userId ?? "user-123"),
  })),
}));

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  hostedConnectionWithSecretArgs: {},
  mapHostedInternalAccountRecord: mocks.mapHostedInternalAccountRecord,
  PrismaDeviceSyncControlPlaneStore: class PrismaDeviceSyncControlPlaneStore {},
  requireHostedConnectionBundleRecord: mocks.requireHostedConnectionBundleRecord,
}));

describe("device-sync hosted runtime helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds runtime snapshots from escrowed hosted device connections", async () => {
    const { buildHostedDeviceSyncRuntimeSnapshot } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const store = {
      codec: {
        decrypt: (value: string) => value,
        encrypt: (value: string) => value,
        keyVersion: "v1",
      },
      prisma: {
        deviceConnection: {
          findMany: vi.fn().mockResolvedValue([
            {
              connectedAt: "2026-03-20T10:00:00.000Z",
              createdAt: "2026-03-20T10:00:00.000Z",
              displayName: "Alice Oura",
              externalAccountId: "oura_alice",
              id: "dsc_123",
              metadataJson: { source: "oauth" },
              provider: "oura",
              scopes: ["heartrate"],
              secret: {
                tokenVersion: 3,
              },
              status: "active",
              updatedAt: "2026-03-20T10:00:00.000Z",
              userId: "user-123",
            },
            {
              connectedAt: "2026-03-21T10:00:00.000Z",
              createdAt: "2026-03-21T10:00:00.000Z",
              displayName: "Bob Whoop",
              externalAccountId: "whoop_bob",
              id: "dsc_456",
              metadataJson: {},
              provider: "whoop",
              scopes: ["offline"],
              secret: null,
              status: "disconnected",
              updatedAt: "2026-03-21T10:00:00.000Z",
              userId: "user-123",
            },
          ]),
        },
      },
    };

    const snapshot = await buildHostedDeviceSyncRuntimeSnapshot(
      store as never,
      {
        userId: "user-123",
      },
    );

    expect(snapshot.userId).toBe("user-123");
    expect(snapshot.connections).toEqual([
      {
        connection: expect.objectContaining({
          id: "dsc_123",
          provider: "oura",
          updatedAt: "2026-03-20T10:00:00.000Z",
        }),
        localState: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          nextReconcileAt: null,
        },
        tokenBundle: {
          accessToken: "access-token",
          accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
          keyVersion: "v1",
          refreshToken: "refresh-token",
          tokenVersion: 3,
        },
      },
      {
        connection: expect.objectContaining({
          id: "dsc_456",
          provider: "whoop",
          updatedAt: "2026-03-21T10:00:00.000Z",
        }),
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
      },
    ]);
  });

  it("binds device-sync runtime requests to the trusted hosted execution user when present", async () => {
    const {
      parseHostedDeviceSyncRuntimeApplyRequest,
      parseHostedDeviceSyncRuntimeSnapshotRequest,
    } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );

    expect(parseHostedDeviceSyncRuntimeSnapshotRequest({
      provider: "oura",
      userId: "user-123",
    }, "user-123")).toEqual({
      provider: "oura",
      userId: "user-123",
    });

    expect(parseHostedDeviceSyncRuntimeApplyRequest({
      updates: [],
    }, "user-123")).toEqual({
      updates: [],
      userId: "user-123",
    });

    expect(() => parseHostedDeviceSyncRuntimeSnapshotRequest({
      userId: "user-456",
    }, "user-123")).toThrow(
      "userId must match the authenticated hosted execution user.",
    );
  });

  it("normalizes runtime timestamp fields and rejects malformed timestamp input", async () => {
    const { parseHostedDeviceSyncRuntimeApplyRequest } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );

    expect(parseHostedDeviceSyncRuntimeApplyRequest({
      occurredAt: "2026-03-26T12:00:00Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastSyncStartedAt: "2026-03-26T07:00:00-05:00",
            nextReconcileAt: "2026-03-27T00:00:00-05:00",
          },
          observedUpdatedAt: "2026-03-26T12:00:00+00:00",
          tokenBundle: {
            accessToken: "new-access-token",
            accessTokenExpiresAt: "2026-03-30T01:30:00+01:30",
            keyVersion: "local-runtime",
            refreshToken: "new-refresh-token",
            tokenVersion: 0,
          },
        },
      ],
      userId: "user-123",
    })).toEqual({
      occurredAt: "2026-03-26T12:00:00.000Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastSyncStartedAt: "2026-03-26T12:00:00.000Z",
            nextReconcileAt: "2026-03-27T05:00:00.000Z",
          },
          observedUpdatedAt: "2026-03-26T12:00:00.000Z",
          tokenBundle: {
            accessToken: "new-access-token",
            accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
            keyVersion: "local-runtime",
            refreshToken: "new-refresh-token",
            tokenVersion: 0,
          },
        },
      ],
      userId: "user-123",
    });

    expect(() => parseHostedDeviceSyncRuntimeApplyRequest({
      occurredAt: "not-a-timestamp",
      updates: [],
      userId: "user-123",
    })).toThrow("occurredAt must be an ISO-8601 timestamp.");

    expect(() => parseHostedDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "dsc_123",
          observedUpdatedAt: "soon",
        },
      ],
      userId: "user-123",
    })).toThrow("updates[0].observedUpdatedAt must be an ISO-8601 timestamp.");

    expect(parseHostedDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "dsc_legacy",
          lastErrorCode: "PROVIDER_AUTH",
          lastSyncStartedAt: "2026-03-26T07:00:00-05:00",
          metadata: {
            nested: "drop-me",
            source: "browser",
          },
          observedUpdatedAt: "2026-03-26T12:00:00+00:00",
          status: "reauthorization_required",
        },
      ],
      userId: "user-123",
    })).toEqual({
      updates: [
        {
          connection: {
            metadata: {
              nested: "drop-me",
              source: "browser",
            },
            status: "reauthorization_required",
          },
          connectionId: "dsc_legacy",
          localState: {
            lastErrorCode: "PROVIDER_AUTH",
            lastSyncStartedAt: "2026-03-26T12:00:00.000Z",
          },
          observedUpdatedAt: "2026-03-26T12:00:00.000Z",
        },
      ],
      userId: "user-123",
    });
  });

  it("skips stale token writes, fences expiry metadata, and emits a reauthorization signal when runtime state requires reconnect", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: new Date("2026-03-28T00:00:00.000Z"),
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Alice Oura",
      externalAccountId: "oura_alice",
      id: "dsc_123",
      lastSyncErrorAt: new Date("2026-03-25T23:00:00.000Z"),
      metadataJson: { source: "oauth" },
      provider: "oura",
      scopes: ["heartrate"],
      secret: {
        accessTokenEncrypted: "enc:old-access",
        refreshTokenEncrypted: "enc:old-refresh",
        tokenVersion: 2,
      },
      status: "active",
      updatedAt: "2026-03-20T10:00:00.000Z",
      userId: "user-123",
    };
    const updated = {
      ...existing,
      lastErrorCode: "PROVIDER_AUTH",
      lastErrorMessage: "Reconnect required",
      status: "reauthorization_required",
      updatedAt: "2026-03-26T12:00:00.000Z",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn().mockResolvedValue({ id: 12 }),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const result = await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:00:00.000Z",
        updates: [
          {
            connection: {
              status: "reauthorization_required",
            },
            connectionId: "dsc_123",
            localState: {
              lastErrorCode: "PROVIDER_AUTH",
              lastErrorMessage: "Reconnect required",
            },
            observedTokenVersion: 1,
            tokenBundle: {
              accessToken: "new-access-token",
              accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
              keyVersion: "local-runtime",
              refreshToken: "new-refresh-token",
              tokenVersion: 1,
            },
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "dsc_123",
      },
      data: expect.objectContaining({
        lastErrorCode: "PROVIDER_AUTH",
        lastErrorMessage: "Reconnect required",
        status: "reauthorization_required",
      }),
    });
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
    expect(store.createSignal).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:00:00.000Z",
      kind: "reauthorization_required",
      payload: {
        lastErrorCode: "PROVIDER_AUTH",
        lastErrorMessage: "Reconnect required",
        occurredAt: "2026-03-26T12:00:00.000Z",
        reason: "hosted_runtime",
      },
      provider: "oura",
      tx,
      userId: "user-123",
    });
    expect(result).toEqual({
      appliedAt: "2026-03-26T12:00:00.000Z",
      updates: [
        {
          connection: expect.objectContaining({
            id: "dsc_123",
            provider: "oura",
            status: "reauthorization_required",
          }),
          connectionId: "dsc_123",
          status: "updated",
          tokenUpdate: "skipped_version_mismatch",
        },
      ],
      userId: "user-123",
    });
  });

  it("skips stale connection-state and token writes while still applying local-state clears when the hosted row advanced mid-pass", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Hosted Disconnect",
      externalAccountId: "whoop_disconnect",
      id: "dsc_midpass",
      lastErrorCode: "PROVIDER_AUTH",
      lastErrorMessage: "Reconnect in browser",
      metadataJson: { source: "browser" },
      provider: "whoop",
      scopes: ["offline"],
      secret: null,
      status: "disconnected",
      updatedAt: new Date("2026-03-26T12:05:00.000Z"),
      userId: "user-123",
    };
    const updated = {
      ...existing,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const result = await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:10:00.000Z",
        updates: [
          {
            connection: {
              status: "active",
            },
            connectionId: "dsc_midpass",
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
            },
            observedUpdatedAt: "2026-03-26T12:00:00.000Z",
            observedTokenVersion: null,
            tokenBundle: {
              accessToken: "new-access-token",
              accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
              keyVersion: "local-runtime",
              refreshToken: "new-refresh-token",
              tokenVersion: 0,
            },
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "dsc_midpass",
      },
      data: {
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
    expect(store.createSignal).not.toHaveBeenCalled();
    expect(result).toEqual({
      appliedAt: "2026-03-26T12:10:00.000Z",
      updates: [
        {
          connection: expect.objectContaining({
            id: "dsc_midpass",
            status: "disconnected",
          }),
          connectionId: "dsc_midpass",
          status: "updated",
          tokenUpdate: "missing",
        },
      ],
      userId: "user-123",
    });
  });

  it("sanitizes hosted runtime metadata updates before persistence", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Hosted Metadata",
      externalAccountId: "oura_metadata",
      id: "dsc_metadata",
      metadataJson: { source: "browser" },
      provider: "oura",
      scopes: ["heartrate"],
      secret: null,
      status: "active",
      updatedAt: "2026-03-26T12:05:00.000Z",
      userId: "user-123",
    };
    const updated = {
      ...existing,
      metadataJson: {
        flag: true,
      },
      updatedAt: "2026-03-26T12:10:00.000Z",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:10:00.000Z",
        updates: [
          {
            connection: {
              metadata: {
                flag: true,
                longText: "x".repeat(300),
                nested: {
                  secret: "drop-me",
                },
                source: {
                  nested: "drop-me-too",
                },
              },
            },
            connectionId: "dsc_metadata",
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "dsc_metadata",
      },
      data: expect.objectContaining({
        metadataJson: {
          flag: true,
        },
      }),
    });
  });

  it("does not let a stale baseline disconnect an already-advanced hosted row", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Hosted Active",
      externalAccountId: "whoop_disconnect",
      id: "dsc_disconnect_midpass",
      metadataJson: { source: "browser" },
      provider: "whoop",
      scopes: ["offline"],
      secret: {
        accessTokenEncrypted: "enc:old-access",
        refreshTokenEncrypted: "enc:old-refresh",
        tokenVersion: 3,
      },
      status: "active",
      updatedAt: new Date("2026-03-26T12:05:00.000Z"),
      userId: "user-123",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn(),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const result = await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:10:00.000Z",
        updates: [
          {
            connection: {
              status: "disconnected",
            },
            connectionId: "dsc_disconnect_midpass",
            observedUpdatedAt: "2026-03-26T12:00:00.000Z",
          },
        ],
        userId: "user-123",
      },
    );

    expect(store.markConnectionDisconnected).not.toHaveBeenCalled();
    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
    expect(store.createSignal).not.toHaveBeenCalled();
    expect(result).toEqual({
      appliedAt: "2026-03-26T12:10:00.000Z",
      updates: [
        {
          connection: expect.objectContaining({
            id: "dsc_disconnect_midpass",
            status: "active",
          }),
          connectionId: "dsc_disconnect_midpass",
          status: "updated",
          tokenUpdate: "unchanged",
        },
      ],
      userId: "user-123",
    });
  });

  it("reports token writes as skipped when a stale hosted row fences the request before any local-state mutation", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Hosted Active",
      externalAccountId: "oura_refresh",
      id: "dsc_token_midpass",
      metadataJson: { source: "browser" },
      provider: "oura",
      scopes: ["heartrate"],
      secret: {
        accessTokenEncrypted: "enc:old-access",
        refreshTokenEncrypted: "enc:old-refresh",
        tokenVersion: 3,
      },
      status: "active",
      updatedAt: new Date("2026-03-26T12:05:00.000Z"),
      userId: "user-123",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn(),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const result = await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:10:00.000Z",
        updates: [
          {
            connectionId: "dsc_token_midpass",
            observedUpdatedAt: "2026-03-26T12:00:00.000Z",
            tokenBundle: {
              accessToken: "new-access-token",
              accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
              keyVersion: "local-runtime",
              refreshToken: "new-refresh-token",
              tokenVersion: 0,
            },
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
    expect(result.updates[0]?.tokenUpdate).toBe("skipped_version_mismatch");
  });

  it("does not bump token versions when a null-expiry token bundle is unchanged", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Alice Oura",
      externalAccountId: "oura_alice",
      id: "dsc_123",
      metadataJson: { source: "oauth" },
      provider: "oura",
      scopes: ["heartrate"],
      secret: {
        accessTokenEncrypted: "enc:access-token",
        refreshTokenEncrypted: "enc:refresh-token",
        tokenVersion: 2,
      },
      status: "active",
      updatedAt: "2026-03-20T10:00:00.000Z",
      userId: "user-123",
    };
    const updated = {
      ...existing,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: "2026-03-26T12:00:00.000Z",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const result = await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:00:00.000Z",
        updates: [
          {
            connectionId: "dsc_123",
            observedTokenVersion: 2,
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              keyVersion: "local-runtime",
              refreshToken: "refresh-token",
              tokenVersion: 2,
            },
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "dsc_123",
      },
      data: {
        accessTokenExpiresAt: null,
      },
    });
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      appliedAt: "2026-03-26T12:00:00.000Z",
      updates: [
        {
          connection: expect.objectContaining({
            id: "dsc_123",
            provider: "oura",
            status: "active",
          }),
          connectionId: "dsc_123",
          status: "updated",
          tokenUpdate: "unchanged",
        },
      ],
      userId: "user-123",
    });
  });

  it("does not recreate a hosted secret on an already disconnected row", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Hosted Disconnect",
      externalAccountId: "whoop_disconnect",
      id: "dsc_disconnected",
      metadataJson: { source: "browser" },
      provider: "whoop",
      scopes: ["offline"],
      secret: null,
      status: "disconnected",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      userId: "user-123",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(existing),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const result = await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:10:00.000Z",
        updates: [
          {
            connectionId: "dsc_disconnected",
            observedUpdatedAt: "2026-03-26T12:00:00.000Z",
            observedTokenVersion: null,
            tokenBundle: {
              accessToken: "new-access-token",
              accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
              keyVersion: "local-runtime",
              refreshToken: "new-refresh-token",
              tokenVersion: 0,
            },
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      appliedAt: "2026-03-26T12:10:00.000Z",
      updates: [
        {
          connection: expect.objectContaining({
            id: "dsc_disconnected",
            status: "disconnected",
          }),
          connectionId: "dsc_disconnected",
          status: "updated",
          tokenUpdate: "missing",
        },
      ],
      userId: "user-123",
    });
  });

  it("fences expiry-only token mutations on token-version mismatch while still applying non-token fields", async () => {
    const { applyHostedDeviceSyncRuntimeUpdates } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const existing = {
      accessTokenExpiresAt: new Date("2026-03-28T00:00:00.000Z"),
      connectedAt: "2026-03-20T10:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      displayName: "Alice Oura",
      externalAccountId: "oura_alice",
      id: "dsc_789",
      metadataJson: { source: "oauth" },
      provider: "oura",
      scopes: ["heartrate"],
      secret: {
        accessTokenEncrypted: "enc:old-access",
        refreshTokenEncrypted: "enc:old-refresh",
        tokenVersion: 2,
      },
      status: "active",
      updatedAt: "2026-03-20T10:00:00.000Z",
      userId: "user-123",
    };
    const updated = {
      ...existing,
      displayName: "Hosted Rename",
      updatedAt: "2026-03-26T12:00:00.000Z",
    };
    const tx = {
      deviceConnection: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
      deviceConnectionSecret: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const store = {
      codec: {
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
        encrypt: (value: string) => `enc:${value}`,
        keyVersion: "v1",
      },
      createSignal: vi.fn(),
      markConnectionDisconnected: vi.fn(),
      prisma: {},
      withConnectionRefreshLock: vi.fn(async (_connectionId: string, callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    await applyHostedDeviceSyncRuntimeUpdates(
      store as never,
      {
        occurredAt: "2026-03-26T12:00:00.000Z",
        updates: [
          {
            connection: {
              displayName: "Hosted Rename",
            },
            connectionId: "dsc_789",
            observedTokenVersion: 1,
          },
        ],
        userId: "user-123",
      },
    );

    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "dsc_789",
      },
      data: {
        displayName: "Hosted Rename",
      },
    });
    expect(tx.deviceConnectionSecret.create).not.toHaveBeenCalled();
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
  });
});
