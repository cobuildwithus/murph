import { beforeEach, describe, expect, it, vi } from "vitest";

const { controlClientMocks } = vi.hoisted(() => ({
  controlClientMocks: {
    applyDeviceSyncRuntimeUpdates: vi.fn(),
    getDeviceSyncRuntimeSnapshot: vi.fn(),
    requireHostedDeviceSyncRuntimeClient: vi.fn(),
    readHostedDeviceSyncRuntimeClientIfConfigured: vi.fn(),
  },
}));

vi.mock("@/src/lib/device-sync/runtime-client", () => ({
  requireHostedDeviceSyncRuntimeClient: controlClientMocks.requireHostedDeviceSyncRuntimeClient,
  readHostedDeviceSyncRuntimeClientIfConfigured:
    controlClientMocks.readHostedDeviceSyncRuntimeClientIfConfigured,
}));

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type StaticConnectionRecord = {
  id: string;
  userId: string;
  provider: string;
  providerAccountBlindIndex: string;
  status: "active" | "disconnected" | "reauthorization_required";
  connectedAt: Date;
  lastWebhookAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastSyncCompletedAt: Date | null;
  lastSyncErrorAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextReconcileAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RuntimeConnection = {
  connection: {
    accessTokenExpiresAt: string | null;
    connectedAt: string;
    createdAt: string;
    displayName: string | null;
    externalAccountId: string;
    id: string;
    metadata: Record<string, unknown>;
    provider: string;
    scopes: string[];
    status: "active" | "reauthorization_required" | "disconnected";
    updatedAt: string;
  };
  localState: {
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastSyncCompletedAt: string | null;
    lastSyncErrorAt: string | null;
    lastSyncStartedAt: string | null;
    lastWebhookAt: string | null;
    nextReconcileAt: string | null;
  };
  tokenBundle: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
    tokenVersion: number;
  } | null;
};

function createHeartbeatStore(seed: Partial<RuntimeConnection["localState"]> = {}) {
  const staticRecord: StaticConnectionRecord = {
    id: "dsc_123",
    userId: "user-123",
    provider: "oura",
    providerAccountBlindIndex: "hbdi_test",
    status: "active",
    connectedAt: new Date("2026-03-25T00:00:00.000Z"),
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
  };
  const updateConnection = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...staticRecord,
    status: typeof data.status === "string" ? data.status : staticRecord.status,
    connectedAt: data.connectedAt instanceof Date ? data.connectedAt : staticRecord.connectedAt,
    lastWebhookAt: data.lastWebhookAt instanceof Date ? data.lastWebhookAt : data.lastWebhookAt === null ? null : staticRecord.lastWebhookAt,
    lastSyncStartedAt:
      data.lastSyncStartedAt instanceof Date
        ? data.lastSyncStartedAt
        : data.lastSyncStartedAt === null
          ? null
          : staticRecord.lastSyncStartedAt,
    lastSyncCompletedAt:
      data.lastSyncCompletedAt instanceof Date
        ? data.lastSyncCompletedAt
        : data.lastSyncCompletedAt === null
          ? null
          : staticRecord.lastSyncCompletedAt,
    lastSyncErrorAt:
      data.lastSyncErrorAt instanceof Date
        ? data.lastSyncErrorAt
        : data.lastSyncErrorAt === null
          ? null
          : staticRecord.lastSyncErrorAt,
    lastErrorCode: typeof data.lastErrorCode === "string" ? data.lastErrorCode : data.lastErrorCode === null ? null : staticRecord.lastErrorCode,
    lastErrorMessage:
      typeof data.lastErrorMessage === "string"
        ? data.lastErrorMessage
        : data.lastErrorMessage === null
          ? null
          : staticRecord.lastErrorMessage,
    nextReconcileAt:
      data.nextReconcileAt instanceof Date
        ? data.nextReconcileAt
        : data.nextReconcileAt === null
          ? null
          : staticRecord.nextReconcileAt,
  }));
  const runtimeConnection: RuntimeConnection = {
    connection: {
      accessTokenExpiresAt: null,
      connectedAt: "2026-03-25T00:00:00.000Z",
      createdAt: "2026-03-25T00:00:00.000Z",
      displayName: "Oura",
      externalAccountId: "acct-123",
      id: "dsc_123",
      metadata: {},
      provider: "oura",
      scopes: ["daily"],
      status: "active",
      updatedAt: "2026-03-25T00:00:00.000Z",
    },
    localState: {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: null,
      ...seed,
    },
    tokenBundle: {
      accessToken: "access-token",
      accessTokenExpiresAt: null,
      keyVersion: "v1",
      refreshToken: "refresh-token",
      tokenVersion: 1,
    },
  };

  controlClientMocks.getDeviceSyncRuntimeSnapshot.mockImplementation(async () => ({
    connections: [cloneRuntimeConnection(runtimeConnection)],
    generatedAt: "2026-03-25T00:00:00.000Z",
    userId: "user-123",
  }));
  controlClientMocks.applyDeviceSyncRuntimeUpdates.mockImplementation(async (_userId: string, request: {
    occurredAt: string;
    updates: Array<{
      connectionId: string;
      localState?: {
        lastErrorCode?: string | null;
        lastErrorMessage?: string | null;
        lastSyncCompletedAt?: string | null;
        lastSyncErrorAt?: string | null;
        lastSyncStartedAt?: string | null;
      };
    }>;
  }) => {
    const update = request.updates[0];

    if (!update) {
      throw new Error("Expected heartbeat update payload.");
    }

    if (update.localState?.lastErrorCode !== undefined) {
      runtimeConnection.localState.lastErrorCode = update.localState.lastErrorCode ?? null;
    }

    if (update.localState?.lastErrorMessage !== undefined) {
      runtimeConnection.localState.lastErrorMessage = update.localState.lastErrorMessage ?? null;
    }

    if (update.localState?.lastSyncCompletedAt !== undefined) {
      runtimeConnection.localState.lastSyncCompletedAt = update.localState.lastSyncCompletedAt ?? null;
    }

    if (update.localState?.lastSyncErrorAt !== undefined) {
      runtimeConnection.localState.lastSyncErrorAt = update.localState.lastSyncErrorAt ?? null;
    }

    if (update.localState?.lastSyncStartedAt !== undefined) {
      runtimeConnection.localState.lastSyncStartedAt = update.localState.lastSyncStartedAt ?? null;
    }
    runtimeConnection.connection.updatedAt = request.occurredAt;

    return {
      appliedAt: request.occurredAt,
      updates: [
        {
          connection: cloneRuntimeConnection(runtimeConnection).connection,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "applied",
        },
      ],
      userId: "user-123",
    };
  });
  controlClientMocks.requireHostedDeviceSyncRuntimeClient.mockReturnValue({
    applyDeviceSyncRuntimeUpdates: controlClientMocks.applyDeviceSyncRuntimeUpdates,
    getDeviceSyncRuntimeSnapshot: controlClientMocks.getDeviceSyncRuntimeSnapshot,
  });
  controlClientMocks.readHostedDeviceSyncRuntimeClientIfConfigured.mockReturnValue({
    applyDeviceSyncRuntimeUpdates: controlClientMocks.applyDeviceSyncRuntimeUpdates,
    getDeviceSyncRuntimeSnapshot: controlClientMocks.getDeviceSyncRuntimeSnapshot,
  });

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceConnection: {
        findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
          where.id === staticRecord.id && where.userId === staticRecord.userId ? { ...staticRecord } : null,
        update: updateConnection,
      },
    } as never,
  });

  return {
    runtimeConnection,
    store,
    updateConnection,
  };
}

describe("PrismaDeviceSyncControlPlaneStore local heartbeat updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the exact validated heartbeat update shape to hosted runtime", async () => {
    const { runtimeConnection, store, updateConnection } = createHeartbeatStore({
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "Old failure",
      lastSyncErrorAt: "2026-03-25T01:00:00.000Z",
    });

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastErrorCode: "NEW_CODE",
      lastErrorMessage: "New failure",
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorCode: "NEW_CODE",
      lastErrorMessage: "New failure",
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
      lastSyncErrorAt: "2026-03-25T01:00:00.000Z",
    });
    expect(runtimeConnection.localState).toMatchObject({
      lastErrorCode: "NEW_CODE",
      lastErrorMessage: "New failure",
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
      lastSyncErrorAt: "2026-03-25T01:00:00.000Z",
    });
    expect(controlClientMocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledWith("user-123", expect.objectContaining({
      updates: [
        expect.objectContaining({
          connectionId: "dsc_123",
          localState: {
            lastErrorCode: "NEW_CODE",
            lastErrorMessage: "New failure",
            lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
          },
        }),
      ],
    }));
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorCode: "NEW_CODE",
        lastSyncCompletedAt: expect.any(Date),
      }),
    }));
  });

  it("only applies the provided error fields", async () => {
    const { runtimeConnection, store } = createHeartbeatStore({
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "Old failure",
    });

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastErrorMessage: "New failure",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "New failure",
    });
    expect(runtimeConnection.localState).toMatchObject({
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "New failure",
    });
  });

  it("rejects regressive heartbeat timestamps before writing stale state", async () => {
    const { runtimeConnection, store } = createHeartbeatStore({
      lastSyncStartedAt: "2026-03-25T02:00:00.000Z",
    });

    await expect(store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T01:30:00.000Z",
    })).rejects.toMatchObject({
      code: "INVALID_LOCAL_HEARTBEAT",
      httpStatus: 400,
    });
    expect(runtimeConnection.localState.lastSyncStartedAt).toBe("2026-03-25T02:00:00.000Z");
    expect(controlClientMocks.applyDeviceSyncRuntimeUpdates).not.toHaveBeenCalled();
  });

  it("fails closed when hosted runtime reports a stale heartbeat write conflict", async () => {
    const { runtimeConnection, store } = createHeartbeatStore({
      lastWebhookAt: "2026-03-25T01:00:00.000Z",
    });

    controlClientMocks.applyDeviceSyncRuntimeUpdates.mockResolvedValueOnce({
      appliedAt: "2026-03-25T01:30:00.000Z",
      updates: [
        {
          connection: cloneRuntimeConnection(runtimeConnection).connection,
          connectionId: "dsc_123",
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "skipped_version_mismatch",
        },
      ],
      userId: "user-123",
    });

    await expect(store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastWebhookAt: "2026-03-25T01:30:00.000Z",
    })).rejects.toMatchObject({
      code: "RUNTIME_STATE_CONFLICT",
      httpStatus: 409,
      retryable: true,
    });
  });

});

function cloneRuntimeConnection(connection: RuntimeConnection): RuntimeConnection {
  return {
    connection: {
      ...connection.connection,
      metadata: { ...connection.connection.metadata },
      scopes: [...connection.connection.scopes],
    },
    localState: {
      ...connection.localState,
    },
    tokenBundle: connection.tokenBundle
      ? {
          ...connection.tokenBundle,
        }
      : null,
  };
}
