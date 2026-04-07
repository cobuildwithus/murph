import { beforeEach, describe, expect, it, vi } from "vitest";

const { randomBytesMock, runtimeMocks } = vi.hoisted(() => ({
  randomBytesMock: vi.fn((length: number) => Buffer.from(Array.from({ length }, (_, index) => index))),
  runtimeMocks: {
    applyDeviceSyncRuntimeUpdates: vi.fn(),
    getDeviceSyncRuntimeSnapshot: vi.fn(),
    readHostedExecutionControlClientIfConfigured: vi.fn(),
  },
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: randomBytesMock,
  };
});

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: runtimeMocks.readHostedExecutionControlClientIfConfigured,
}));

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableOAuthSession = {
  state: string;
  userId: string | null;
  provider: string;
  returnTo: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
};

type MutableConnectionRecord = {
  id: string;
  userId: string;
  provider: string;
  externalAccountId: string;
  displayName: string | null;
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type MutableSignalRecord = {
  id: number;
  connectionId: string | null;
  kind: string;
  payloadJson: Record<string, unknown> | null;
  createdAt: Date;
};

describe("PrismaDeviceSyncControlPlaneStore oauth state ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
  });

  it("consumes and deletes an unexpired oauth state record", async () => {
    const sessions = new Map<string, MutableOAuthSession>([
      [
        "state-123",
        {
          state: "state-123",
          userId: "user-123",
          provider: "oura",
          returnTo: "https://example.test/return",
          metadataJson: {
            ownerId: "user-123",
            source: "browser",
          },
          createdAt: new Date("2026-03-25T00:00:00.000Z"),
          expiresAt: new Date("2026-03-25T01:00:00.000Z"),
        },
      ],
    ]);

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: {
            deviceOauthSession: {
              findUnique: ({ where }: { where: { state: string } }) => Promise<MutableOAuthSession | null>;
              delete: ({ where }: { where: { state: string } }) => Promise<void>;
            };
          }) => Promise<TResult>,
        ) =>
          callback({
            deviceOauthSession: {
              findUnique: async ({ where }) => cloneOAuthSession(sessions.get(where.state) ?? null),
              delete: async ({ where }) => {
                sessions.delete(where.state);
                return undefined;
              },
            },
          }),
      } as never,
    });

    await expect(store.consumeOAuthState("state-123", "2026-03-25T00:30:00.000Z")).resolves.toEqual({
      state: "state-123",
      provider: "oura",
      returnTo: "https://example.test/return",
      metadata: {
        ownerId: "user-123",
        source: "browser",
      },
      createdAt: "2026-03-25T00:00:00.000Z",
      expiresAt: "2026-03-25T01:00:00.000Z",
    });
    expect(sessions.has("state-123")).toBe(false);
  });

  it("deletes an expired oauth state and returns null", async () => {
    const sessions = new Map<string, MutableOAuthSession>([
      [
        "state-expired",
        {
          state: "state-expired",
          userId: "user-123",
          provider: "oura",
          returnTo: null,
          metadataJson: {},
          createdAt: new Date("2026-03-25T00:00:00.000Z"),
          expiresAt: new Date("2026-03-25T00:05:00.000Z"),
        },
      ],
    ]);

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: {
            deviceOauthSession: {
              findUnique: ({ where }: { where: { state: string } }) => Promise<MutableOAuthSession | null>;
              delete: ({ where }: { where: { state: string } }) => Promise<void>;
            };
          }) => Promise<TResult>,
        ) =>
          callback({
            deviceOauthSession: {
              findUnique: async ({ where }) => cloneOAuthSession(sessions.get(where.state) ?? null),
              delete: async ({ where }) => {
                sessions.delete(where.state);
                return undefined;
              },
            },
          }),
      } as never,
    });

    await expect(store.consumeOAuthState("state-expired", "2026-03-25T00:30:00.000Z")).resolves.toBeNull();
    expect(sessions.has("state-expired")).toBe(false);
  });
});

describe("PrismaDeviceSyncControlPlaneStore hosted connection access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
  });

  it("creates new hosted connections without creating a Prisma secret row", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
      secretCreateCalled: boolean;
    } = {
      connection: null,
      secretCreateCalled: false,
    };

    const tx = {
      deviceConnection: {
        findUnique: async ({ where }: { where: { id?: string } | { provider_externalAccountId?: { provider: string; externalAccountId: string } } }) => {
          if ("id" in where && where.id && createdArtifacts.connection?.id === where.id) {
            return cloneConnection(createdArtifacts.connection);
          }

          return null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.connection = normalizeCreatedConnection(data);
          return cloneConnection(createdArtifacts.connection);
        },
        findFirst: async () => null,
      },
      deviceConnectionSecret: {
        create: async () => {
          createdArtifacts.secretCreateCalled = true;
          return {};
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
    });

    const created = await store.upsertConnection({
      ownerId: "user-123",
      provider: "oura",
      externalAccountId: "acct_456",
      displayName: "Oura ring",
      scopes: ["daily"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-03-25T04:00:00.000Z",
      },
      metadata: {
        allowed: true,
        ignored: {
          nested: "value",
        },
        longText: "x".repeat(300),
        region: "us",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: "2026-03-25T05:00:00.000Z",
    });

    expect(created.id).toMatch(/^dsc_[A-Za-z0-9_-]+$/u);
    expect(createdArtifacts.connection).toMatchObject({
      id: created.id,
      userId: "user-123",
      externalAccountId: "acct_456",
      displayName: "Oura ring",
    });
    expect(createdArtifacts.secretCreateCalled).toBe(false);
    expect(created.metadata).toEqual({});
  });

  it("updates an existing connection without writing a Prisma secret row", async () => {
    const existing = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
    });
    const updated = createConnection({
      displayName: "Updated Oura ring",
      id: "dsc_123",
      provider: "oura",
      updatedAt: new Date("2026-03-26T04:00:00.000Z"),
      userId: "user-123",
    });

    const tx = {
      deviceConnection: {
        findUnique: async () => cloneConnection(existing),
        update: async () => cloneConnection(updated),
      },
      deviceConnectionSecret: {
        upsert: vi.fn(async () => {
          throw new Error("secret upsert should not run");
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
    });

    await expect(store.upsertConnection({
      ownerId: "user-123",
      provider: "oura",
      externalAccountId: "acct_456",
      displayName: "Updated Oura ring",
      scopes: ["daily"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
      },
      metadata: {
        region: "ca",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: "2026-03-25T05:00:00.000Z",
    })).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      metadata: {},
    }));
    expect(tx.deviceConnectionSecret.upsert).not.toHaveBeenCalled();
  });

  it("serves ordinary hosted connection lists from durable Prisma metadata without live runtime reads", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
      userId: "user-123",
    });
    const signals: MutableSignalRecord[] = [
      {
        id: 2,
        connectionId: "dsc_123",
        kind: "webhook_hint",
        payloadJson: {
          occurredAt: "2026-03-25T06:00:00.000Z",
        },
        createdAt: new Date("2026-03-25T06:01:00.000Z"),
      },
      {
        id: 1,
        connectionId: "dsc_123",
        kind: "connected",
        payloadJson: {
          nextReconcileAt: "2026-03-25T07:00:00.000Z",
          scopes: ["daily", "sleep"],
        },
        createdAt: new Date("2026-03-25T00:30:00.000Z"),
      },
    ];

    runtimeMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      applyDeviceSyncRuntimeUpdates: runtimeMocks.applyDeviceSyncRuntimeUpdates,
      getDeviceSyncRuntimeSnapshot: runtimeMocks.getDeviceSyncRuntimeSnapshot,
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findMany: async () => [cloneConnection(connection)],
        },
        deviceSyncSignal: {
          findMany: async () => cloneSignals(signals),
        },
      } as never,
    });

    await expect(store.listConnectionsForUser("user-123")).resolves.toEqual([
      expect.objectContaining({
        id: "dsc_123",
        provider: "oura",
        status: "active",
        scopes: ["daily", "sleep"],
        nextReconcileAt: "2026-03-25T07:00:00.000Z",
        lastWebhookAt: "2026-03-25T06:00:00.000Z",
        updatedAt: "2026-03-25T06:01:00.000Z",
      }),
    ]);
    expect(runtimeMocks.getDeviceSyncRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it("keeps webhook-ingress external-account lookups on the live runtime path", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
    });

    runtimeMocks.getDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-25T00:00:00.000Z",
            createdAt: "2026-03-25T00:00:00.000Z",
            displayName: "Oura ring",
            externalAccountId: "acct_456",
            id: "dsc_123",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "disconnected",
            updatedAt: "2026-03-25T08:00:00.000Z",
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
        },
      ],
      generatedAt: "2026-03-25T08:00:00.000Z",
      userId: "user-123",
    });
    runtimeMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      applyDeviceSyncRuntimeUpdates: runtimeMocks.applyDeviceSyncRuntimeUpdates,
      getDeviceSyncRuntimeSnapshot: runtimeMocks.getDeviceSyncRuntimeSnapshot,
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findUnique: async () => cloneConnection(connection),
        },
      } as never,
    });

    await expect(store.getConnectionByExternalAccount("oura", "acct_456")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      status: "disconnected",
      updatedAt: "2026-03-25T08:00:00.000Z",
    }));
    expect(runtimeMocks.getDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith("user-123", {
      connectionId: "dsc_123",
      provider: "oura",
    });
  });

  it("keeps explicit operational connection reads on the live Cloudflare runtime path", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
    });

    runtimeMocks.getDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-25T00:00:00.000Z",
            createdAt: "2026-03-25T00:00:00.000Z",
            displayName: "Oura ring",
            externalAccountId: "acct_456",
            id: "dsc_123",
            metadata: {
              region: "us",
            },
            provider: "oura",
            scopes: ["daily"],
            status: "disconnected",
            updatedAt: "2026-03-25T08:00:00.000Z",
          },
          localState: {
            lastErrorCode: "REMOTE_REVOKE_FAILED",
            lastErrorMessage: "Provider revoke request failed during disconnect.",
            lastSyncCompletedAt: null,
            lastSyncErrorAt: "2026-03-25T08:00:00.000Z",
            lastSyncStartedAt: null,
            lastWebhookAt: "2026-03-25T07:00:00.000Z",
            nextReconcileAt: null,
          },
          tokenBundle: null,
        },
      ],
      generatedAt: "2026-03-25T08:00:00.000Z",
      userId: "user-123",
    });
    runtimeMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      applyDeviceSyncRuntimeUpdates: runtimeMocks.applyDeviceSyncRuntimeUpdates,
      getDeviceSyncRuntimeSnapshot: runtimeMocks.getDeviceSyncRuntimeSnapshot,
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    await expect(store.getRuntimeConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      status: "disconnected",
      metadata: {},
      lastWebhookAt: "2026-03-25T07:00:00.000Z",
      updatedAt: "2026-03-25T08:00:00.000Z",
    }));
    expect(runtimeMocks.getDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith("user-123", {
      connectionId: "dsc_123",
      provider: "oura",
    });
  });

  it("forwards webhook receipt timestamps into the Cloudflare runtime instead of Prisma runtime columns", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
    });
    runtimeMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      applyDeviceSyncRuntimeUpdates: runtimeMocks.applyDeviceSyncRuntimeUpdates,
      getDeviceSyncRuntimeSnapshot: runtimeMocks.getDeviceSyncRuntimeSnapshot,
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id?: string } | { provider_externalAccountId?: { provider: string; externalAccountId: string } } }) => {
            if ("id" in where && where.id === connection.id) {
              return cloneConnection(connection);
            }

            return null;
          },
        },
      } as never,
    });

    await store.markWebhookReceived("dsc_123", "2026-03-25T06:00:00.000Z");

    expect(runtimeMocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledWith("user-123", {
      occurredAt: "2026-03-25T06:00:00.000Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastWebhookAt: "2026-03-25T06:00:00.000Z",
          },
        },
      ],
    });
  });
});

function cloneOAuthSession(session: MutableOAuthSession | null): MutableOAuthSession | null {
  return session
    ? {
        ...session,
        metadataJson: { ...session.metadataJson },
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
      }
    : null;
}

function cloneConnection(record: MutableConnectionRecord | null): MutableConnectionRecord | null {
  return record
    ? {
        ...record,
        connectedAt: new Date(record.connectedAt),
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      }
    : null;
}

function cloneSignals(records: readonly MutableSignalRecord[]): MutableSignalRecord[] {
  return records.map((record) => ({
    ...record,
    payloadJson: record.payloadJson ? { ...record.payloadJson } : null,
    createdAt: new Date(record.createdAt),
  }));
}

function createConnection(overrides: Partial<MutableConnectionRecord>): MutableConnectionRecord {
  return {
    id: overrides.id ?? "dsc_123",
    userId: overrides.userId ?? "user-123",
    provider: overrides.provider ?? "oura",
    externalAccountId: overrides.externalAccountId ?? "acct_456",
    displayName: overrides.displayName ?? "Oura ring",
    connectedAt: overrides.connectedAt ?? new Date("2026-03-25T00:00:00.000Z"),
    createdAt: overrides.createdAt ?? new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-25T00:00:00.000Z"),
  };
}

function normalizeCreatedConnection(data: Record<string, unknown>): MutableConnectionRecord {
  return createConnection({
    id: String(data.id),
    userId: String(data.userId),
    provider: String(data.provider),
    externalAccountId: String(data.externalAccountId),
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    connectedAt: data.connectedAt instanceof Date ? data.connectedAt : new Date("2026-03-25T00:00:00.000Z"),
  });
}
