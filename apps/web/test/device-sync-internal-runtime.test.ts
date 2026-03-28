import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mapHostedPublicAccountRecord: vi.fn((record: Record<string, unknown>) => ({
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
  mapHostedPublicAccountRecord: mocks.mapHostedPublicAccountRecord,
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
        }),
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
        }),
        tokenBundle: null,
      },
    ]);
  });

  it("skips stale token writes and emits a reauthorization signal when runtime state requires reconnect", async () => {
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
            connectionId: "dsc_123",
            lastErrorCode: "PROVIDER_AUTH",
            lastErrorMessage: "Reconnect required",
            observedTokenVersion: 1,
            status: "reauthorization_required",
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
      data: {
        lastErrorCode: "PROVIDER_AUTH",
        lastErrorMessage: "Reconnect required",
        status: "reauthorization_required",
      },
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
});
