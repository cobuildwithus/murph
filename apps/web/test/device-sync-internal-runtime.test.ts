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
}));

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  mapHostedInternalAccountRecord: mocks.mapHostedInternalAccountRecord,
  PrismaDeviceSyncControlPlaneStore: class PrismaDeviceSyncControlPlaneStore {},
}));

describe("device-sync hosted runtime helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds metadata-only runtime snapshots from hosted device connections", async () => {
    const { buildHostedDeviceSyncRuntimeSnapshot } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const store = {
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
              status: "active",
              updatedAt: "2026-03-20T10:00:00.000Z",
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

    expect(snapshot).toEqual({
      connections: [
        {
          connection: expect.objectContaining({
            id: "dsc_123",
            metadata: { source: "oauth" },
            provider: "oura",
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
      ],
      generatedAt: expect.any(String),
      userId: "user-123",
    });
  });

  it("requires a token bundle when composing a Cloudflare-backed runtime account", async () => {
    const {
      composeHostedRuntimeDeviceSyncAccount,
      requireHostedDeviceSyncRuntimeTokenBundle,
    } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );

    expect(() => requireHostedDeviceSyncRuntimeTokenBundle({
      connectionId: "dsc_123",
      runtimeConnection: null,
      userId: "user-123",
    })).toThrow("Hosted device-sync connection no longer has an escrowed token bundle.");

    const tokenBundle = requireHostedDeviceSyncRuntimeTokenBundle({
      connectionId: "dsc_123",
      runtimeConnection: {
        connection: {
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          displayName: "Oura",
          externalAccountId: "oura_alice",
          id: "dsc_123",
          metadata: { source: "oauth" },
          provider: "oura",
          scopes: ["heartrate"],
          status: "active",
          updatedAt: "2026-03-26T12:00:00.000Z",
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
        tokenBundle: {
          accessToken: "access-token",
          accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
          keyVersion: "v1",
          refreshToken: "refresh-token",
          tokenVersion: 3,
        },
      },
      userId: "user-123",
    });

    expect(composeHostedRuntimeDeviceSyncAccount({
      connection: {
        id: "dsc_123",
        provider: "oura",
        externalAccountId: "oura_alice",
        displayName: "Oura",
        status: "active",
        scopes: ["heartrate"],
        accessTokenExpiresAt: null,
        metadata: {
          nested: {
            drop: true,
          },
          source: "oauth",
        },
        connectedAt: "2026-03-26T12:00:00.000Z",
        lastWebhookAt: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextReconcileAt: null,
        createdAt: "2026-03-26T12:00:00.000Z",
        updatedAt: "2026-03-26T12:00:00.000Z",
      },
      tokenBundle,
    })).toEqual(expect.objectContaining({
      accessToken: "access-token",
      disconnectGeneration: 0,
      metadata: {
        source: "oauth",
      },
      refreshToken: "refresh-token",
    }));
  });

  it("binds device-sync runtime requests to the trusted hosted execution user and normalizes timestamps", async () => {
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
      occurredAt: "2026-03-26T12:00:00Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastSyncStartedAt: "2026-03-26T07:00:00-05:00",
          },
          observedUpdatedAt: "2026-03-26T12:00:00+00:00",
          tokenBundle: {
            accessToken: "new-access-token",
            accessTokenExpiresAt: "2026-03-30T01:30:00+01:30",
            keyVersion: "cloudflare-runtime",
            refreshToken: "new-refresh-token",
            tokenVersion: 1,
          },
        },
      ],
      userId: "user-123",
    }, "user-123")).toEqual({
      occurredAt: "2026-03-26T12:00:00.000Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastSyncStartedAt: "2026-03-26T12:00:00.000Z",
          },
          observedUpdatedAt: "2026-03-26T12:00:00.000Z",
          tokenBundle: {
            accessToken: "new-access-token",
            accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
            keyVersion: "cloudflare-runtime",
            refreshToken: "new-refresh-token",
            tokenVersion: 1,
          },
        },
      ],
      userId: "user-123",
    });
  });
});
