import { beforeEach, describe, expect, it, vi } from "vitest";

const { randomBytesMock } = vi.hoisted(() => ({
  randomBytesMock: vi.fn((length: number) => Buffer.from(Array.from({ length }, (_, index) => index))),
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: randomBytesMock,
  };
});

import { buildHostedProviderAccountBlindIndex } from "@/src/lib/device-sync/crypto";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableOAuthSession = {
  state: string;
  userId: string | null;
  provider: string;
  returnTo: string | null;
  createdAt: Date;
  expiresAt: Date;
};

type MutableConnectionRecord = {
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  id: string;
  userId: string;
  provider: string;
  providerAccountBlindIndex: string;
  displayName: string | null;
  externalAccountIdEncrypted: string | null;
  keyVersion: string | null;
  metadataJson: Record<string, unknown> | null;
  refreshTokenEncrypted: string | null;
  scopesJson: string[] | null;
  status: "active" | "disconnected" | "reauthorization_required";
  tokenVersion: number | null;
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

const BLIND_INDEX_KEY = Buffer.alloc(32, 7);
const TEST_CODEC = {
  decrypt: (value: string) => value.replace(/^enc:/u, ""),
  encrypt: (value: string) => `enc:${value}`,
  keyVersion: "v1",
};

describe("PrismaDeviceSyncControlPlaneStore oauth state ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
              deleteMany: ({ where }: { where: { state: string; provider?: string } }) => Promise<{ count: number }>;
            };
          }) => Promise<TResult>,
        ) =>
          callback({
            deviceOauthSession: {
              findUnique: async ({ where }) => cloneOAuthSession(sessions.get(where.state) ?? null),
              deleteMany: async ({ where }) => {
                const record = sessions.get(where.state);

                if (!record) {
                  return { count: 0 };
                }

                if (where.provider && record.provider !== where.provider) {
                  return { count: 0 };
                }

                sessions.delete(where.state);
                return { count: 1 };
              },
            },
          }),
      } as never,
    });

    await expect(store.consumeOAuthState("state-123", "2026-03-25T00:30:00.000Z")).resolves.toEqual({
      status: "consumed",
      record: {
        state: "state-123",
        provider: "oura",
        returnTo: "https://example.test/return",
        metadata: {
          ownerId: "user-123",
        },
        createdAt: "2026-03-25T00:00:00.000Z",
        expiresAt: "2026-03-25T01:00:00.000Z",
      },
    });
    expect(sessions.has("state-123")).toBe(false);
  });

  it("deletes an expired oauth state and returns missing", async () => {
    const sessions = new Map<string, MutableOAuthSession>([
      [
        "state-expired",
        {
          state: "state-expired",
          userId: "user-123",
          provider: "oura",
          returnTo: null,
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
              deleteMany: ({ where }: { where: { state: string; provider?: string } }) => Promise<{ count: number }>;
            };
          }) => Promise<TResult>,
        ) =>
          callback({
            deviceOauthSession: {
              findUnique: async ({ where }) => cloneOAuthSession(sessions.get(where.state) ?? null),
              deleteMany: async ({ where }) => {
                const record = sessions.get(where.state);

                if (!record) {
                  return { count: 0 };
                }

                if (where.provider && record.provider !== where.provider) {
                  return { count: 0 };
                }

                sessions.delete(where.state);
                return { count: 1 };
              },
            },
          }),
      } as never,
    });

    await expect(store.consumeOAuthState("state-expired", "2026-03-25T00:30:00.000Z")).resolves.toEqual({
      status: "missing",
    });
    expect(sessions.has("state-expired")).toBe(false);
  });

  it("keeps an unexpired oauth state when the provider does not match", async () => {
    const sessions = new Map<string, MutableOAuthSession>([
      [
        "state-provider-mismatch",
        {
          state: "state-provider-mismatch",
          userId: "user-123",
          provider: "oura",
          returnTo: "https://example.test/return",
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
              deleteMany: ({ where }: { where: { state: string; provider?: string } }) => Promise<{ count: number }>;
            };
          }) => Promise<TResult>,
        ) =>
          callback({
            deviceOauthSession: {
              findUnique: async ({ where }) => cloneOAuthSession(sessions.get(where.state) ?? null),
              deleteMany: async ({ where }) => {
                const record = sessions.get(where.state);

                if (!record) {
                  return { count: 0 };
                }

                if (where.provider && record.provider !== where.provider) {
                  return { count: 0 };
                }

                sessions.delete(where.state);
                return { count: 1 };
              },
            },
          }),
      } as never,
    });

    await expect(
      store.consumeOAuthState(
        "state-provider-mismatch",
        "2026-03-25T00:30:00.000Z",
        "whoop",
      ),
    ).resolves.toEqual({
      status: "provider_mismatch",
      provider: "oura",
    });
    expect(sessions.has("state-provider-mismatch")).toBe(true);
  });
});

describe("PrismaDeviceSyncControlPlaneStore hosted connection access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) => {
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
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
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
      provider: "oura",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "oura",
        externalAccountId: "acct_456",
      }),
      status: "active",
      nextReconcileAt: new Date("2026-03-25T05:00:00.000Z"),
    });
    expect(createdArtifacts.secretCreateCalled).toBe(false);
    expect(created.metadata).toEqual({});
  });

  it("keeps hosted device connection persistence provider-generic", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
    } = {
      connection: null,
    };

    const tx = {
      deviceConnection: {
        findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) => {
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
          throw new Error("deviceConnectionSecret rows should stay unused");
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    const created = await store.upsertConnection({
      ownerId: "user-123",
      provider: "demo",
      externalAccountId: "acct_demo",
      displayName: "Demo provider",
      scopes: ["demo:read"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      metadata: {
        region: "test",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    });

    expect(created.provider).toBe("demo");
    expect(createdArtifacts.connection).toMatchObject({
      id: created.id,
      provider: "demo",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "demo",
        externalAccountId: "acct_demo",
      }),
      status: "active",
    });
  });

  it("updates an existing connection without writing a Prisma secret row", async () => {
    const existing = createConnection({
      id: "dsc_123",
      provider: "oura",
      status: "active",
      userId: "user-123",
    });
    const updated = createConnection({
      id: "dsc_123",
      nextReconcileAt: new Date("2026-03-25T05:00:00.000Z"),
      provider: "oura",
      status: "active",
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
      codec: TEST_CODEC,
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
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
      lastWebhookAt: new Date("2026-03-25T06:00:00.000Z"),
      nextReconcileAt: new Date("2026-03-25T07:00:00.000Z"),
      provider: "oura",
      status: "active",
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findMany: async () => [cloneConnection(connection)],
        },
      } as never,
    });

    await expect(store.listConnectionsForUser("user-123")).resolves.toEqual([
      expect.objectContaining({
        id: "dsc_123",
        provider: "oura",
        status: "active",
        scopes: [],
        nextReconcileAt: "2026-03-25T07:00:00.000Z",
        lastWebhookAt: "2026-03-25T06:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
      }),
    ]);
  });

  it("keeps webhook-ingress external-account lookups on the durable Prisma owner", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      status: "active",
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { provider_providerAccountBlindIndex: { provider: string; providerAccountBlindIndex: string } } }) =>
            where.provider_providerAccountBlindIndex.provider === "oura"
              && where.provider_providerAccountBlindIndex.providerAccountBlindIndex === buildHostedProviderAccountBlindIndex({
                key: BLIND_INDEX_KEY,
                provider: "oura",
                externalAccountId: "acct_456",
              })
              ? cloneConnection(connection)
              : null,
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await expect(store.getConnectionByExternalAccount("oura", "acct_456")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    }));
  });

  it("keeps explicit operational connection reads on durable Prisma metadata", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
      lastErrorCode: "REMOTE_REVOKE_FAILED",
      lastErrorMessage: "Provider revoke request failed during disconnect.",
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      lastWebhookAt: new Date("2026-03-25T07:00:00.000Z"),
      status: "disconnected",
      updatedAt: new Date("2026-03-25T08:00:00.000Z"),
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      status: "disconnected",
      metadata: {},
      lastErrorCode: "REMOTE_REVOKE_FAILED",
      lastErrorMessage: null,
      lastWebhookAt: "2026-03-25T07:00:00.000Z",
      updatedAt: "2026-03-25T08:00:00.000Z",
    }));
  });

  it("persists webhook receipt timestamps in durable Prisma state", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
    });
    const updateConnection = vi.fn(async () => undefined);

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) => {
            if ("id" in where && where.id === connection.id) {
              return cloneConnection(connection);
            }

            return null;
          },
          update: updateConnection,
        },
      } as never,
    });

    await store.markWebhookReceived("dsc_123", "2026-03-25T06:00:00.000Z");

    expect(updateConnection).toHaveBeenCalledWith({
      where: {
        id: "dsc_123",
      },
      data: {
        lastWebhookAt: new Date("2026-03-25T06:00:00.000Z"),
      },
    });
  });

  it("preserves the stored external account binding across token clears, tokenless reads, and retokenization", async () => {
    let connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
          findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) =>
            "id" in where && where.id === connection.id ? cloneConnection(connection) : null,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            connection = {
              ...connection,
              accessTokenEncrypted: typeof data.accessTokenEncrypted === "string"
                ? data.accessTokenEncrypted
                : data.accessTokenEncrypted === null
                  ? null
                  : connection.accessTokenEncrypted,
              accessTokenExpiresAt: data.accessTokenExpiresAt instanceof Date
                ? data.accessTokenExpiresAt
                : data.accessTokenExpiresAt === null
                  ? null
                  : connection.accessTokenExpiresAt,
              externalAccountIdEncrypted: typeof data.externalAccountIdEncrypted === "string"
                ? data.externalAccountIdEncrypted
                : data.externalAccountIdEncrypted === null
                  ? null
                  : connection.externalAccountIdEncrypted,
              keyVersion: typeof data.keyVersion === "string"
                ? data.keyVersion
                : data.keyVersion === null
                  ? null
                  : connection.keyVersion,
              refreshTokenEncrypted: typeof data.refreshTokenEncrypted === "string"
                ? data.refreshTokenEncrypted
                : data.refreshTokenEncrypted === null
                  ? null
                  : connection.refreshTokenEncrypted,
              tokenVersion: typeof data.tokenVersion === "number"
                ? data.tokenVersion
                : data.tokenVersion === null
                  ? null
                  : connection.tokenVersion,
            };

            return cloneConnection(connection);
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.persistStoredConnectionTokenBundle({
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: null,
    });

    expect(connection.accessTokenEncrypted).toBeNull();
    expect(connection.refreshTokenEncrypted).toBeNull();
    expect(connection.tokenVersion).toBeNull();
    expect(connection.externalAccountIdEncrypted).toBe("enc:acct_456");
    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toBeNull();
    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      externalAccountId: "acct_456",
      id: "dsc_123",
      provider: "oura",
    }));

    await store.persistStoredConnectionTokenBundle({
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: {
        accessToken: "fresh-access-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
        keyVersion: "v1",
        refreshToken: "fresh-refresh-token",
        tokenVersion: 1,
      },
    });

    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toEqual(
      expect.objectContaining({
        accessToken: "fresh-access-token",
        externalAccountId: "acct_456",
        refreshToken: "fresh-refresh-token",
        tokenVersion: 1,
      }),
    );
  });

  it("clears the stored external account binding only when explicitly requested", async () => {
    let connection = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 2,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
          findUnique: async ({ where }: { where: { id?: string } | { provider_providerAccountBlindIndex?: { provider: string; providerAccountBlindIndex: string } } }) =>
            "id" in where && where.id === connection.id ? cloneConnection(connection) : null,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            connection = {
              ...connection,
              accessTokenEncrypted: typeof data.accessTokenEncrypted === "string"
                ? data.accessTokenEncrypted
                : data.accessTokenEncrypted === null
                  ? null
                  : connection.accessTokenEncrypted,
              accessTokenExpiresAt: data.accessTokenExpiresAt instanceof Date
                ? data.accessTokenExpiresAt
                : data.accessTokenExpiresAt === null
                  ? null
                  : connection.accessTokenExpiresAt,
              externalAccountIdEncrypted: typeof data.externalAccountIdEncrypted === "string"
                ? data.externalAccountIdEncrypted
                : data.externalAccountIdEncrypted === null
                  ? null
                  : connection.externalAccountIdEncrypted,
              keyVersion: typeof data.keyVersion === "string"
                ? data.keyVersion
                : data.keyVersion === null
                  ? null
                  : connection.keyVersion,
              refreshTokenEncrypted: typeof data.refreshTokenEncrypted === "string"
                ? data.refreshTokenEncrypted
                : data.refreshTokenEncrypted === null
                  ? null
                  : connection.refreshTokenEncrypted,
              tokenVersion: typeof data.tokenVersion === "number"
                ? data.tokenVersion
                : data.tokenVersion === null
                  ? null
                  : connection.tokenVersion,
            };

            return cloneConnection(connection);
          },
        },
      } as never,
      providerAccountBlindIndexKey: BLIND_INDEX_KEY,
    });

    await store.persistStoredConnectionTokenBundle({
      clearExternalAccountId: true,
      connectionId: "dsc_123",
      externalAccountId: null,
      provider: "oura",
      tokenBundle: null,
    });

    expect(connection.externalAccountIdEncrypted).toBeNull();
    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      externalAccountId: "opaque:dsc_123",
      id: "dsc_123",
      provider: "oura",
    }));
  });
});

function cloneOAuthSession(session: MutableOAuthSession | null): MutableOAuthSession | null {
  return session
    ? {
        ...session,
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
      }
    : null;
}

function cloneConnection(record: MutableConnectionRecord | null): MutableConnectionRecord | null {
  return record
    ? {
        ...record,
        accessTokenExpiresAt: record.accessTokenExpiresAt ? new Date(record.accessTokenExpiresAt) : null,
        connectedAt: new Date(record.connectedAt),
        lastWebhookAt: record.lastWebhookAt ? new Date(record.lastWebhookAt) : null,
        lastSyncStartedAt: record.lastSyncStartedAt ? new Date(record.lastSyncStartedAt) : null,
        lastSyncCompletedAt: record.lastSyncCompletedAt ? new Date(record.lastSyncCompletedAt) : null,
        lastSyncErrorAt: record.lastSyncErrorAt ? new Date(record.lastSyncErrorAt) : null,
        nextReconcileAt: record.nextReconcileAt ? new Date(record.nextReconcileAt) : null,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      }
    : null;
}

function createConnection(overrides: Partial<MutableConnectionRecord>): MutableConnectionRecord {
  return {
    accessTokenEncrypted: overrides.accessTokenEncrypted ?? null,
    accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? null,
    id: overrides.id ?? "dsc_123",
    userId: overrides.userId ?? "user-123",
    provider: overrides.provider ?? "oura",
    providerAccountBlindIndex: overrides.providerAccountBlindIndex
      ?? buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: overrides.provider ?? "oura",
        externalAccountId: "acct_456",
      }),
    displayName: overrides.displayName ?? "Oura ring",
    externalAccountIdEncrypted: overrides.externalAccountIdEncrypted ?? "enc:acct_456",
    keyVersion: overrides.keyVersion ?? null,
    metadataJson: overrides.metadataJson ?? {},
    refreshTokenEncrypted: overrides.refreshTokenEncrypted ?? null,
    scopesJson: overrides.scopesJson ?? [],
    status: overrides.status ?? "reauthorization_required",
    tokenVersion: overrides.tokenVersion ?? null,
    connectedAt: overrides.connectedAt ?? new Date("2026-03-25T00:00:00.000Z"),
    lastWebhookAt: overrides.lastWebhookAt ?? null,
    lastSyncStartedAt: overrides.lastSyncStartedAt ?? null,
    lastSyncCompletedAt: overrides.lastSyncCompletedAt ?? null,
    lastSyncErrorAt: overrides.lastSyncErrorAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    nextReconcileAt: overrides.nextReconcileAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-25T00:00:00.000Z"),
  };
}

function normalizeCreatedConnection(data: Record<string, unknown>): MutableConnectionRecord {
  return createConnection({
    id: String(data.id),
    userId: String(data.userId),
    provider: String(data.provider),
    providerAccountBlindIndex: String(data.providerAccountBlindIndex),
    status: (data.status as MutableConnectionRecord["status"]) ?? "active",
    connectedAt: data.connectedAt instanceof Date ? data.connectedAt : new Date("2026-03-25T00:00:00.000Z"),
    nextReconcileAt: data.nextReconcileAt instanceof Date ? data.nextReconcileAt : null,
  });
}
