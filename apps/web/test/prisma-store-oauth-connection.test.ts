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

import { buildHostedProviderAccountBlindIndex } from "@/src/lib/device-sync/routing-index";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableOAuthSession = {
  state: string;
  userId: string | null;
  provider: string;
  returnTo: string | null;
  metadataJson: Record<string, unknown> | null;
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
  credentialKind: "oauth_tokens" | "provider_config" | "none";
  credentialMetadataJson: Record<string, unknown> | null;
  providerConfigKey: string | null;
  displayName: string | null;
  externalAccountIdEncrypted: string | null;
  keyVersion: string | null;
  metadataJson: Record<string, unknown> | null;
  refreshTokenEncrypted: string | null;
  scopesJson: string[] | null;
  setupExpiresAt: Date | null;
  setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
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
          metadataJson: {
            __murphConnectSourceId: "oura",
            __murphConnectTarget: "oura",
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
        ownerId: "user-123",
        metadata: {
          __murphConnectSourceId: "oura",
          __murphConnectTarget: "oura",
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
          metadataJson: null,
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
          metadataJson: null,
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

  it("keeps an unexpired oauth state when the expected owner does not match", async () => {
    const sessions = new Map<string, MutableOAuthSession>([
      [
        "state-owner-mismatch",
        {
          state: "state-owner-mismatch",
          userId: "user-123",
          provider: "oura",
          returnTo: "https://example.test/return",
          metadataJson: null,
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
              deleteMany: ({ where }: { where: { state: string; provider?: string; userId?: string } }) => Promise<{ count: number }>;
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

                if (where.userId && record.userId !== where.userId) {
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
        "state-owner-mismatch",
        "2026-03-25T00:30:00.000Z",
        "oura",
        "user-456",
      ),
    ).resolves.toEqual({
      status: "owner_mismatch",
    });
    expect(sessions.has("state-owner-mismatch")).toBe(true);
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

  it("creates provider-config hosted connections without fake OAuth token material", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
    } = {
      connection: null,
    };

    const tx = {
      deviceConnection: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.connection = normalizeCreatedConnection(data);
          return cloneConnection(createdArtifacts.connection);
        },
        findFirst: async () => null,
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
      provider: "junction",
      externalAccountId: "junction-user-123",
      displayName: "Junction",
      status: "active",
      setupPhase: "pending_link",
      setupExpiresAt: "2026-03-25T00:30:00.000Z",
      scopes: ["profile"],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        subject: {
          accountId: "raw-account",
          client_user_id: "raw-client-user",
          hmacSecret: "do-not-store",
          ownerId: "raw-owner",
          ownerIdHash: "owner-hash",
          profileId: "raw-profile",
          region: "us",
          userId: "raw-user",
          userIdHash: "user-hash",
        },
      },
      metadata: {
        accountId: "raw-account",
        client_user_id: "raw-client-user",
        connectedSources: ["oura"],
        hmacSecret: "do-not-store",
        ownerId: "raw-owner",
        ownerIdHash: "owner-hash",
        profileId: "raw-profile",
        region: "us",
        resourceAvailability: ["profile"],
        userId: "raw-user",
        userIdHash: "user-hash",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    } as Parameters<typeof store.upsertConnection>[0] & {
      setupExpiresAt: string;
      setupPhase: "pending_link";
    });

    expect(created).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^dsc_[A-Za-z0-9_-]+$/u),
      provider: "junction",
      status: "active",
    }));
    expect(createdArtifacts.connection).toMatchObject({
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialKind: "provider_config",
      credentialMetadataJson: {
        "subject.ownerIdHash": "owner-hash",
        "subject.region": "us",
        "subject.userIdHash": "user-hash",
      },
      externalAccountIdEncrypted: "enc:junction-user-123",
      keyVersion: null,
      metadataJson: {
        ownerIdHash: "owner-hash",
        region: "us",
        userIdHash: "user-hash",
      },
      provider: "junction",
      providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
        key: BLIND_INDEX_KEY,
        provider: "junction",
        externalAccountId: "junction-user-123",
      }),
      providerConfigKey: "junction",
      refreshTokenEncrypted: null,
      setupExpiresAt: new Date("2026-03-25T00:30:00.000Z"),
      setupPhase: "pending_link",
      status: "active",
      tokenVersion: null,
    });
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("connectedSources");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("resourceAvailability");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-owner");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-user");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-client-user");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-account");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("raw-profile");
    expect(JSON.stringify(createdArtifacts.connection)).not.toContain("do-not-store");
  });

  it("hydrates provider-config stored connection accounts without token material", async () => {
    const connection = createConnection({
      accessTokenEncrypted: null,
      credentialKind: "provider_config",
      credentialMetadataJson: {
        "subject.region": "us",
      },
      externalAccountIdEncrypted: "enc:junction-user-123",
      keyVersion: null,
      provider: "junction",
      providerConfigKey: "junction",
      refreshTokenEncrypted: null,
      tokenVersion: null,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(store.getStoredConnectionAccountForUser("user-123", "dsc_123")).resolves.toEqual(
      expect.objectContaining({
        credential: {
          kind: "provider_config",
          credentialMetadata: {
            "subject.region": "us",
          },
          providerConfigKey: "junction",
        },
        disconnectGeneration: 0,
        externalAccountId: "junction-user-123",
        id: "dsc_123",
        keyVersion: null,
        provider: "junction",
        tokenVersion: null,
      }),
    );
  });

  it("rejects provider-config hosted connection credentials with unexpected provider profile keys", async () => {
    let createCalled = false;
    const tx = {
      deviceConnection: {
        findUnique: async () => null,
        create: async () => {
          createCalled = true;
          throw new Error("create should not be called");
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

    await expect(store.upsertConnection({
      ownerId: "user-123",
      provider: "junction",
      externalAccountId: "junction-user-123",
      displayName: "Junction",
      status: "active",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "wrong-profile",
      },
      metadata: {},
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: null,
    })).rejects.toMatchObject({
      code: "PROVIDER_CONFIG_KEY_MISMATCH",
    });
    expect(createCalled).toBe(false);
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

  it("reactivates a disconnected hosted connection on successful OAuth reconnect", async () => {
    let stored = createConnection({
      accessTokenEncrypted: null,
      id: "dsc_123",
      keyVersion: null,
      provider: "whoop",
      refreshTokenEncrypted: null,
      status: "disconnected",
      tokenVersion: null,
      userId: "user-123",
    });
    const updateConnection = vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
      stored = {
        ...stored,
        ...data,
        updatedAt: new Date("2026-03-26T04:00:00.000Z"),
      };
      return cloneConnection(stored);
    });

    const tx = {
      deviceConnection: {
        findUnique: async () => cloneConnection(stored),
        update: updateConnection,
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
      provider: "whoop",
      externalAccountId: "acct_456",
      displayName: "WHOOP",
      scopes: ["read:recovery", "read:sleep"],
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
      },
      metadata: {},
      connectedAt: "2026-03-26T03:00:00.000Z",
      nextReconcileAt: "2026-03-26T09:00:00.000Z",
    })).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      provider: "whoop",
      status: "active",
    }));

    expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessTokenEncrypted: "enc:new-access-token",
        keyVersion: "v1",
        refreshTokenEncrypted: "enc:new-refresh-token",
        status: "active",
        tokenVersion: 1,
      }),
    }));
    expect(stored.status).toBe("active");
  });

  it("clears hosted OAuth tokens when post-connect setup fails", async () => {
    let stored = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      keyVersion: "v1",
      nextReconcileAt: new Date("2026-03-26T05:00:00.000Z"),
      refreshTokenEncrypted: "enc:refresh-token",
      status: "active",
      tokenVersion: 3,
    });

    const tx = {
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update: vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
          stored = {
            ...stored,
            ...data,
            updatedAt: new Date("2026-03-26T06:00:00.000Z"),
          };
          return cloneConnection(stored);
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

    const result = await store.markConnectionSetupFailed({
      accountId: "dsc_123",
      now: "2026-03-26T06:00:00.000Z",
      code: "OAUTH_SETUP_FAILED",
      message: "post-connect setup failed",
    });

    expect(tx.deviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        keyVersion: null,
        lastErrorCode: "OAUTH_SETUP_FAILED",
        lastErrorMessage: "post-connect setup failed",
        nextReconcileAt: null,
        refreshTokenEncrypted: null,
        setupExpiresAt: null,
        setupPhase: "failed",
        status: "reauthorization_required",
        tokenVersion: null,
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      accessTokenExpiresAt: null,
      lastErrorCode: "OAUTH_SETUP_FAILED",
      lastErrorMessage: "post-connect setup failed",
      nextReconcileAt: null,
      status: "reauthorization_required",
    }));
    expect(stored.accessTokenEncrypted).toBeNull();
    expect(stored.refreshTokenEncrypted).toBeNull();
    expect(stored.setupPhase).toBe("failed");
  });

  it("drops unsafe post-connect setup failure messages before durable writes", async () => {
    let stored = createConnection({
      accessTokenEncrypted: "enc:access-token",
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      keyVersion: "v1",
      refreshTokenEncrypted: "enc:refresh-token",
      status: "active",
      tokenVersion: 3,
    });

    const tx = {
      deviceConnection: {
        findUnique: vi.fn(async () => cloneConnection(stored)),
        update: vi.fn(async ({ data }: { data: Partial<MutableConnectionRecord> }) => {
          stored = {
            ...stored,
            ...data,
            updatedAt: new Date("2026-03-26T06:00:00.000Z"),
          };
          return cloneConnection(stored);
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

    const result = await store.markConnectionSetupFailed({
      accountId: "dsc_123",
      now: "2026-03-26T06:00:00.000Z",
      code: "OAUTH_SETUP_FAILED",
      message:
        "post-connect setup failed for api.example.test/path owner@example.test authorization=Bearer secret-token",
    });

    expect(tx.deviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorMessage: null,
      }),
    }));
    expect(result?.lastErrorMessage).toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("api.example.test");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("secret-token");
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
      codec: TEST_CODEC,
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
      codec: TEST_CODEC,
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

  it("rehydrates seeded hosted callback accounts by durable connection id", async () => {
    const connection = createConnection({
      id: "dsc_seeded",
      provider: "junction",
      status: "active",
      userId: "user-123",
      externalAccountIdEncrypted: "enc:junction-user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === "dsc_seeded" ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(store.getConnectionById("dsc_seeded")).resolves.toEqual(expect.objectContaining({
      externalAccountId: "junction-user-123",
      id: "dsc_seeded",
      provider: "junction",
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
      codec: TEST_CODEC,
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
      lastErrorMessage: "Provider revoke request failed during disconnect.",
      lastWebhookAt: "2026-03-25T07:00:00.000Z",
      updatedAt: "2026-03-25T08:00:00.000Z",
    }));
  });

  it("returns safe provider failure reasons from durable connection state", async () => {
    const providerReason =
      "WHOOP token request failed. Provider reason: The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed";
    const connection = createConnection({
      id: "dsc_123",
      provider: "whoop",
      userId: "user-123",
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage: providerReason,
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      status: "active",
      updatedAt: new Date("2026-03-25T08:00:00.000Z"),
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage: providerReason,
      provider: "whoop",
    }));
  });

  it("drops unsafe durable connection error messages before returning them", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "whoop",
      userId: "user-123",
      lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      lastErrorMessage:
        "Provider request failed for https://api.example.test/oauth?refresh_token=secret owner@example.test authorization=Bearer secret-token",
      lastSyncErrorAt: new Date("2026-03-25T08:00:00.000Z"),
      status: "active",
      updatedAt: new Date("2026-03-25T08:00:00.000Z"),
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
    });

    const result = await store.getConnectionForUser("user-123", "dsc_123");

    expect(result?.lastErrorMessage).toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("refresh_token=secret");
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
        credential: {
          kind: "oauth_tokens",
          tokens: {
            accessToken: "fresh-access-token",
            accessTokenExpiresAt: "2026-03-26T04:00:00.000Z",
            refreshToken: "fresh-refresh-token",
          },
        },
        externalAccountId: "acct_456",
        tokenVersion: 1,
      }),
    );
  });

  it("fails closed when OAuth token rows store invalid token versions", async () => {
    for (const tokenVersion of [0, -1, 1.5]) {
      const connection = createConnection({
        accessTokenEncrypted: "enc:access-token",
        accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
        externalAccountIdEncrypted: "enc:acct_456",
        keyVersion: "v1",
        provider: "oura",
        refreshTokenEncrypted: "enc:refresh-token",
        tokenVersion,
        userId: "user-123",
      });

      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: TEST_CODEC,
        prisma: {
          deviceConnection: {
            findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
              where.id === connection.id && where.userId === connection.userId
                ? cloneConnection(connection)
                : null,
          },
        } as never,
      });

      await expect(
        store.getStoredConnectionAccountForUser("user-123", "dsc_123"),
      ).rejects.toThrow("Hosted device-sync tokenVersion must be a positive integer.");
    }
  });

  it("fails closed when provider-config rows contain token material", async () => {
    const connection = createConnection({
      accessTokenEncrypted: "enc:legacy-token",
      credentialKind: "provider_config",
      externalAccountIdEncrypted: "enc:junction-user-123",
      keyVersion: "v1",
      provider: "junction",
      providerConfigKey: "junction",
      refreshTokenEncrypted: "enc:legacy-refresh",
      tokenVersion: 7,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(
      store.getStoredConnectionAccountForUser("user-123", "dsc_123"),
    ).rejects.toThrow(/non-token credential rows must not contain token material/u);
  });

  it("fails closed when hosted credential rows use an unknown credential kind", async () => {
    const connection = createConnection({
      accessTokenEncrypted: "enc:legacy-token",
      credentialKind: "bogus" as MutableConnectionRecord["credentialKind"],
      externalAccountIdEncrypted: "enc:acct_456",
      keyVersion: "v1",
      provider: "oura",
      refreshTokenEncrypted: "enc:legacy-refresh",
      tokenVersion: 7,
      userId: "user-123",
    });

    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: TEST_CODEC,
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            where.id === connection.id && where.userId === connection.userId ? cloneConnection(connection) : null,
        },
      } as never,
    });

    await expect(
      store.getStoredConnectionAccountForUser("user-123", "dsc_123"),
    ).rejects.toThrow(/credential_kind is invalid/u);
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
    credentialKind: overrides.credentialKind ?? "oauth_tokens",
    credentialMetadataJson: overrides.credentialMetadataJson ?? {},
    providerConfigKey: overrides.providerConfigKey ?? null,
    displayName: overrides.displayName ?? "Oura ring",
    externalAccountIdEncrypted: overrides.externalAccountIdEncrypted ?? "enc:acct_456",
    keyVersion: overrides.keyVersion ?? null,
    metadataJson: overrides.metadataJson ?? {},
    refreshTokenEncrypted: overrides.refreshTokenEncrypted ?? null,
    scopesJson: overrides.scopesJson ?? [],
    setupExpiresAt: overrides.setupExpiresAt ?? null,
    setupPhase: overrides.setupPhase ?? null,
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
    credentialKind: (data.credentialKind as MutableConnectionRecord["credentialKind"]) ?? "oauth_tokens",
    credentialMetadataJson: (data.credentialMetadataJson as Record<string, unknown> | null) ?? {},
    externalAccountIdEncrypted: typeof data.externalAccountIdEncrypted === "string"
      ? data.externalAccountIdEncrypted
      : null,
    metadataJson: (data.metadataJson as Record<string, unknown> | null) ?? {},
    providerConfigKey: typeof data.providerConfigKey === "string" ? data.providerConfigKey : null,
    setupExpiresAt: data.setupExpiresAt instanceof Date ? data.setupExpiresAt : null,
    setupPhase: (data.setupPhase as MutableConnectionRecord["setupPhase"]) ?? null,
    status: (data.status as MutableConnectionRecord["status"]) ?? "active",
    connectedAt: data.connectedAt instanceof Date ? data.connectedAt : new Date("2026-03-25T00:00:00.000Z"),
    nextReconcileAt: data.nextReconcileAt instanceof Date ? data.nextReconcileAt : null,
  });
}
