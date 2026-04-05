import { describe, expect, it, vi } from "vitest";

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
  status: "active" | "reauthorization_required" | "disconnected";
  scopes: string[];
  accessTokenExpiresAt: Date | null;
  metadataJson: Record<string, unknown>;
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

describe("PrismaDeviceSyncControlPlaneStore oauth state ingress", () => {
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
      metadataJson: {
        allowed: true,
        region: "us",
      },
    });
    expect(createdArtifacts.secretCreateCalled).toBe(false);
    expect(created.metadata).toEqual({});
  });

  it("updates an existing connection without writing a Prisma secret row", async () => {
    const existing = createConnection({
      accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
      id: "dsc_123",
      metadataJson: { region: "us" },
      provider: "oura",
      userId: "user-123",
    });
    const updated = createConnection({
      accessTokenExpiresAt: new Date("2026-03-26T04:00:00.000Z"),
      id: "dsc_123",
      metadataJson: { region: "ca" },
      provider: "oura",
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
      displayName: "Oura ring",
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

  it("disconnects the connection inside the transaction without touching a Prisma secret row", async () => {
    const connection = createConnection({
      id: "dsc_123",
      provider: "oura",
      userId: "user-123",
    });
    const tx = {
      deviceConnection: {
        findFirst: async () => cloneConnection(connection),
        update: async ({ data }: { data: Record<string, unknown> }) => cloneConnection({
          ...connection,
          accessTokenExpiresAt: null,
          lastErrorCode: (data.lastErrorCode as string | null | undefined) ?? null,
          lastErrorMessage: (data.lastErrorMessage as string | null | undefined) ?? null,
          nextReconcileAt: null,
          status: "disconnected",
          updatedAt: data.updatedAt as Date,
        }),
      },
      deviceConnectionSecret: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
    });

    await expect(store.markConnectionDisconnected({
      connectionId: "dsc_123",
      userId: "user-123",
      now: "2026-03-25T06:00:00.000Z",
    })).resolves.toEqual(expect.objectContaining({
      id: "dsc_123",
      status: "disconnected",
    }));
    expect(tx.deviceConnectionSecret.deleteMany).not.toHaveBeenCalled();
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
        scopes: [...record.scopes],
        metadataJson: { ...record.metadataJson },
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
    id: overrides.id ?? "dsc_123",
    userId: overrides.userId ?? "user-123",
    provider: overrides.provider ?? "oura",
    externalAccountId: overrides.externalAccountId ?? "acct_456",
    displayName: overrides.displayName ?? "Oura ring",
    status: overrides.status ?? "active",
    scopes: overrides.scopes ?? ["daily"],
    accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? null,
    metadataJson: overrides.metadataJson ?? {},
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
    externalAccountId: String(data.externalAccountId),
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((entry): entry is string => typeof entry === "string") : [],
    accessTokenExpiresAt: data.accessTokenExpiresAt instanceof Date ? data.accessTokenExpiresAt : null,
    metadataJson: (data.metadataJson as Record<string, unknown>) ?? {},
    connectedAt: data.connectedAt instanceof Date ? data.connectedAt : new Date("2026-03-25T00:00:00.000Z"),
    nextReconcileAt: data.nextReconcileAt instanceof Date ? data.nextReconcileAt : null,
  });
}
