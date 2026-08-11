import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE } from "@murphai/device-syncd/public-account";

const { openHostedUserSecureBoxStringMock } = vi.hoisted(() => ({
  openHostedUserSecureBoxStringMock: vi.fn(
    async (_input: { prisma?: unknown; value?: unknown }) => "acct_456",
  ),
}));

// Only the secure-box open seam is mocked so the Prisma client the store hands
// to the decrypt path stays observable.
vi.mock("@/src/lib/hosted-crypto/secure-box", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-crypto/secure-box")>()),
  openHostedUserSecureBoxString: openHostedUserSecureBoxStringMock,
}));

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type StaticConnectionRecord = {
  accessTokenEncrypted?: string | null;
  accessTokenExpiresAt?: Date | null;
  id: string;
  userId: string;
  provider: string;
  providerAccountBlindIndex: string;
  status: "active" | "disconnected" | "reauthorization_required";
  credentialKind: "oauth_tokens" | "provider_config" | "none";
  credentialMetadataJson: Record<string, unknown> | null;
  providerConfigKey: string | null;
  connectedAt: Date;
  displayName: string | null;
  externalAccountIdEncrypted?: string | null;
  keyVersion?: string | null;
  lastWebhookAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastSyncCompletedAt: Date | null;
  lastSyncErrorAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metadataJson: Record<string, unknown> | null;
  nextReconcileAt: Date | null;
  refreshTokenEncrypted?: string | null;
  scopesJson: string[] | null;
  setupExpiresAt: Date | null;
  setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  tokenVersion?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function createHeartbeatStore(seed: Partial<Pick<
  StaticConnectionRecord,
  | "displayName"
  | "lastErrorCode"
  | "lastErrorMessage"
  | "lastSyncCompletedAt"
  | "lastSyncErrorAt"
  | "lastSyncStartedAt"
  | "lastWebhookAt"
  | "metadataJson"
  | "nextReconcileAt"
  | "scopesJson"
  | "status"
  | "updatedAt"
>> = {}, options: {
  beforeUpdate?: (record: StaticConnectionRecord) => void;
} = {}) {
  const staticRecord: StaticConnectionRecord = {
    id: "dsc_123",
    userId: "user-123",
    provider: "oura",
    providerAccountBlindIndex: "hbdi_test",
    status: "active",
    credentialKind: "oauth_tokens",
    credentialMetadataJson: null,
    providerConfigKey: null,
    displayName: "Oura ring",
    connectedAt: new Date("2026-03-25T00:00:00.000Z"),
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    metadataJson: {
      product: "ring",
    },
    nextReconcileAt: null,
    scopesJson: ["daily", "sleep"],
    setupExpiresAt: null,
    setupPhase: null,
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    ...seed,
  };
  const findFirst = vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === staticRecord.id && where.userId === staticRecord.userId ? { ...staticRecord } : null,
  );
  const executeRaw = vi.fn(async () => 0);
  const updateConnection = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    options.beforeUpdate?.(staticRecord);
    Object.assign(staticRecord, {
      status: typeof data.status === "string" ? data.status : staticRecord.status,
      connectedAt: data.connectedAt instanceof Date ? data.connectedAt : staticRecord.connectedAt,
      displayName:
        typeof data.displayName === "string"
          ? data.displayName
          : data.displayName === null
            ? null
            : staticRecord.displayName,
      lastWebhookAt:
        data.lastWebhookAt instanceof Date
          ? data.lastWebhookAt
          : data.lastWebhookAt === null
            ? null
            : staticRecord.lastWebhookAt,
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
      lastErrorCode:
        typeof data.lastErrorCode === "string"
          ? data.lastErrorCode
          : data.lastErrorCode === null
            ? null
            : staticRecord.lastErrorCode,
      lastErrorMessage:
        typeof data.lastErrorMessage === "string"
          ? data.lastErrorMessage
          : data.lastErrorMessage === null
            ? null
            : staticRecord.lastErrorMessage,
      metadataJson:
        data.metadataJson && typeof data.metadataJson === "object" && !Array.isArray(data.metadataJson)
          ? { ...(data.metadataJson as Record<string, unknown>) }
          : data.metadataJson === null
            ? null
            : staticRecord.metadataJson,
      nextReconcileAt:
        data.nextReconcileAt instanceof Date
          ? data.nextReconcileAt
          : data.nextReconcileAt === null
            ? null
            : staticRecord.nextReconcileAt,
      scopesJson:
        Array.isArray(data.scopesJson)
          ? [...(data.scopesJson as string[])]
          : data.scopesJson === null
            ? null
            : staticRecord.scopesJson,
      updatedAt: new Date(staticRecord.updatedAt.getTime() + 60_000),
    });

    return {
      ...staticRecord,
      metadataJson: staticRecord.metadataJson ? { ...staticRecord.metadataJson } : null,
      scopesJson: staticRecord.scopesJson ? [...staticRecord.scopesJson] : null,
    };
  });
  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceConnection: {
        findFirst,
        update: updateConnection,
      },
      $transaction: async (
        callback: (tx: {
          $executeRaw: typeof executeRaw;
          deviceConnection: {
            findFirst: typeof findFirst;
            update: typeof updateConnection;
          };
        }) => Promise<unknown>,
      ) => callback({
        $executeRaw: executeRaw,
        deviceConnection: {
          findFirst,
          update: updateConnection,
        },
      }),
    } as never,
  });

  return {
    executeRaw,
    store,
    staticRecord,
    updateConnection,
  };
}

describe("PrismaDeviceSyncControlPlaneStore local heartbeat updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the exact validated heartbeat update shape in durable state", async () => {
    const { store, updateConnection } = createHeartbeatStore({
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "Old failure",
      lastSyncErrorAt: new Date("2026-03-25T01:00:00.000Z"),
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
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorCode: "NEW_CODE",
        lastSyncCompletedAt: expect.any(Date),
      }),
    }));
  });

  it("decrypts heartbeat connection secrets through the mutation transaction client", async () => {
    const record: StaticConnectionRecord = {
      id: "dsc_123",
      userId: "user-123",
      provider: "oura",
      providerAccountBlindIndex: "hbdi_test",
      status: "active",
      credentialKind: "oauth_tokens",
      credentialMetadataJson: null,
      providerConfigKey: null,
      displayName: "Oura ring",
      externalAccountIdEncrypted: "sealed:acct_456",
      connectedAt: new Date("2026-03-25T00:00:00.000Z"),
      lastWebhookAt: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      metadataJson: {},
      nextReconcileAt: null,
      scopesJson: ["daily"],
      setupExpiresAt: null,
      setupPhase: null,
      createdAt: new Date("2026-03-25T00:00:00.000Z"),
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    };
    // The heartbeat update runs inside an interactive transaction that already
    // holds a pooled connection; a secret read that falls back to the root
    // client would check out a second one.
    const rootClientUse = vi.fn();
    const failOnRootClientUse = async () => {
      rootClientUse();
      throw new Error("root Prisma client must not be used inside a transaction");
    };
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      deviceConnection: {
        findFirst: vi.fn(async () => ({ ...record })),
        update: vi.fn(async () => ({ ...record })),
      },
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findFirst: failOnRootClientUse,
          update: failOnRootClientUse,
        },
        $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      } as never,
    });

    await expect(store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastErrorMessage: "Heartbeat failure",
    })).resolves.toMatchObject({
      externalAccountId: "acct_456",
      id: "dsc_123",
    });

    // Both the pre-update read and the post-update rebuild decrypt the stored
    // external account id; each must use the transaction client.
    expect(openHostedUserSecureBoxStringMock).toHaveBeenCalledTimes(2);
    for (const [input] of openHostedUserSecureBoxStringMock.mock.calls) {
      expect(input.prisma).toBe(tx);
    }
    expect(rootClientUse).not.toHaveBeenCalled();
  });

  it("only applies the provided error fields", async () => {
    const { store } = createHeartbeatStore({
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
  });

  it("echoes and persists sanitized heartbeat error text", async () => {
    const { store, updateConnection } = createHeartbeatStore();

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastErrorMessage: "Sensitive sync failure",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorMessage: "Sensitive sync failure",
    });
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorMessage: "Sensitive sync failure",
      }),
    }));
  });

  it("drops unsafe heartbeat error text in durable writes and the response", async () => {
    const { store, updateConnection } = createHeartbeatStore();

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastErrorMessage:
        "Provider request failed for api.example.test/oauth owner@example.test authorization=Bearer secret-token",
      lastSyncErrorAt: "2026-03-25T01:30:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorMessage: null,
      lastSyncErrorAt: "2026-03-25T01:30:00.000Z",
    });
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorMessage: null,
      }),
    }));
    const serialized = JSON.stringify(updated);
    expect(serialized).not.toContain("api.example.test");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("secret-token");
  });

  it("rejects regressive heartbeat timestamps before writing stale state", async () => {
    const { store } = createHeartbeatStore({
      lastSyncStartedAt: new Date("2026-03-25T02:00:00.000Z"),
    });

    await expect(store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T01:30:00.000Z",
    })).rejects.toMatchObject({
      code: "INVALID_LOCAL_HEARTBEAT",
      httpStatus: 400,
    });
  });

  it("clears stale completion and error state before persisting an advanced sync start", async () => {
    const { store, updateConnection } = createHeartbeatStore({
      lastErrorCode: "SYNC_FAILED",
      lastErrorMessage: "Token expired",
      lastSyncCompletedAt: new Date("2026-03-25T01:05:00.000Z"),
      lastSyncErrorAt: new Date("2026-03-25T01:06:00.000Z"),
      lastSyncStartedAt: new Date("2026-03-25T01:00:00.000Z"),
    });

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T01:10:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: "2026-03-25T01:10:00.000Z",
    });
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: expect.any(Date),
      }),
    }));
  });

  it("clears completion and error timestamps equal to a new sync start before persisting", async () => {
    const { store, updateConnection } = createHeartbeatStore({
      lastErrorCode: "SYNC_FAILED",
      lastErrorMessage: "Token expired",
      lastSyncCompletedAt: new Date("2026-03-25T01:10:00.000Z"),
      lastSyncErrorAt: new Date("2026-03-25T01:10:00.000Z"),
      lastSyncStartedAt: new Date("2026-03-25T01:00:00.000Z"),
    });

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T01:10:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: "2026-03-25T01:10:00.000Z",
    });
    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: expect.any(Date),
      }),
    }));
  });

  it("rejects a late heartbeat while server-owned disconnect is in progress", async () => {
    const { store, updateConnection } = createHeartbeatStore({
      lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      lastErrorMessage: null,
      lastSyncStartedAt: new Date("2026-03-25T01:00:00.000Z"),
      status: "reauthorization_required",
    });

    await expect(store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T01:10:00.000Z",
    })).rejects.toMatchObject({
      code: "CONNECTION_DISCONNECT_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("preserves concurrent non-heartbeat connection updates across a later heartbeat write", async () => {
    const { executeRaw, store, updateConnection } = createHeartbeatStore({
      displayName: "Oura ring",
      metadataJson: {
        source: "stale",
      },
      nextReconcileAt: new Date("2026-03-25T02:00:00.000Z"),
      scopesJson: ["daily"],
      status: "active",
      updatedAt: new Date("2026-03-25T01:00:00.000Z"),
    }, {
      beforeUpdate(record) {
        record.displayName = "Oura ring 2";
        record.metadataJson = {
          source: "fresh",
        };
        record.nextReconcileAt = new Date("2026-03-25T03:00:00.000Z");
        record.scopesJson = ["daily", "workouts"];
        record.status = "reauthorization_required";
        record.updatedAt = new Date("2026-03-25T01:05:00.000Z");
      },
    });

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
    });

    expect(updated).toMatchObject({
      displayName: "Oura ring 2",
      nextReconcileAt: "2026-03-25T03:00:00.000Z",
      scopes: ["daily", "workouts"],
      status: "reauthorization_required",
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);

    const updateCall = updateConnection.mock.calls[0]?.[0];
    expect(updateCall?.data).toEqual({
      lastSyncCompletedAt: expect.any(Date),
    });
  });
});
