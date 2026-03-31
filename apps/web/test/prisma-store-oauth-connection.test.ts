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

type MutableConnectionSecret = {
  connectionId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenVersion: number;
  keyVersion: string;
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
  secret: MutableConnectionSecret | null;
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
        deviceOauthSession: {
          findUnique: async ({ where }: { where: { state: string } }) => cloneOAuthSession(sessions.get(where.state) ?? null),
          delete: async ({ where }: { where: { state: string } }) => {
            sessions.delete(where.state);
            return undefined;
          },
        },
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
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
      },
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
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
      },
    });

    await expect(store.consumeOAuthState("state-expired", "2026-03-25T00:30:00.000Z")).resolves.toBeNull();
    expect(sessions.has("state-expired")).toBe(false);
  });
});

describe("PrismaDeviceSyncControlPlaneStore hosted connection access", () => {
  it("creates new hosted connections with the hosted random id shape", async () => {
    const createdArtifacts: {
      connection: MutableConnectionRecord | null;
      secret: MutableConnectionSecret | null;
    } = {
      connection: null,
      secret: null,
    };

    const tx = {
      deviceConnection: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.connection = normalizeCreatedConnection(data);
          return cloneConnection(createdArtifacts.connection);
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          createdArtifacts.connection && createdArtifacts.connection.id === where.id
            ? cloneConnection(createdArtifacts.connection)
            : null,
      },
      deviceConnectionSecret: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdArtifacts.secret = normalizeConnectionSecret(data);
          return { ...createdArtifacts.secret };
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => `enc:${value}`,
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
      },
    });

    const suffix = hostedRandomSuffix(12);
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
        region: "us",
      },
      connectedAt: "2026-03-25T00:00:00.000Z",
      nextReconcileAt: "2026-03-25T05:00:00.000Z",
    });

    expect(created.id).toBe(`dsc_${suffix}`);
    expect(created.id).not.toMatch(/^[a-z0-9-]+_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(createdArtifacts.connection).toMatchObject({
      id: `dsc_${suffix}`,
      userId: "user-123",
      externalAccountId: "acct_456",
    });
    expect(createdArtifacts.secret).toMatchObject({
      connectionId: `dsc_${suffix}`,
      accessTokenEncrypted: "enc:access-token",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 1,
      keyVersion: "v1",
    });
    expect(created.metadata).toEqual({});
    expect(createdArtifacts.connection?.metadataJson).toEqual({
      region: "us",
    });
  });

  it("redacts connection metadata from public reads while preserving internal bundle metadata", async () => {
    const connection = createConnectionRecord();
    connection.metadataJson = {
      personalInfo: {
        email: "sensitive@example.com",
      },
      providerHint: "local-browser",
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            connection.id === where.id && connection.userId === where.userId ? cloneConnection(connection) : null,
        },
      } as never,
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => `enc:${value}`,
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
      },
    });

    await expect(store.getConnectionForUser("user-123", "dsc_123")).resolves.toMatchObject({
      id: "dsc_123",
      metadata: {},
    });
    await expect(store.getConnectionBundleForUser("user-123", "dsc_123")).resolves.toEqual({
      userId: "user-123",
      account: expect.objectContaining({
        id: "dsc_123",
        metadata: {
          personalInfo: {
            email: "sensitive@example.com",
          },
          providerHint: "local-browser",
        },
        accessToken: "access-token",
        refreshToken: "refresh-token",
      }),
      tokenVersion: 4,
      keyVersion: "v1",
    });
  });

  it("returns the decrypted hosted token bundle for the owning user", async () => {
    const connection = createConnectionRecord();
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        deviceConnection: {
          findFirst: async () => cloneConnection(connection),
        },
      } as never,
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => `enc:${value}`,
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
      },
    });

    await expect(store.getConnectionBundleForUser("user-123", "dsc_123")).resolves.toEqual({
      userId: "user-123",
      account: expect.objectContaining({
        id: "dsc_123",
        provider: "oura",
        accessToken: "access-token",
        refreshToken: "refresh-token",
      }),
      tokenVersion: 4,
      keyVersion: "v1",
    });
  });

  it("disconnects the connection inside the transaction and removes the hosted secret bundle", async () => {
    const connection = createConnectionRecord();

    const tx = {
      deviceConnection: {
        findFirst: async () => cloneConnection(connection),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          applyConnectionUpdate(connection, data);
          connection.secret = null;
          return cloneConnection(connection);
        },
      },
      deviceConnectionSecret: {
        deleteMany: async () => {
          connection.secret = null;
          return { count: 1 };
        },
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(
          callback: (transaction: typeof tx) => Promise<TResult>,
        ) => callback(tx),
      } as never,
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => `enc:${value}`,
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
      },
    });

    await expect(
      store.markConnectionDisconnected({
        connectionId: "dsc_123",
        userId: "user-123",
        now: "2026-03-25T02:00:00.000Z",
        errorCode: "REMOTE_DISCONNECT",
        errorMessage: "Provider revoked access",
      }),
    ).resolves.toMatchObject({
      id: "dsc_123",
      status: "disconnected",
      accessTokenExpiresAt: null,
      nextReconcileAt: null,
      lastErrorCode: "REMOTE_DISCONNECT",
      lastErrorMessage: "Provider revoked access",
    });

    expect(connection.secret).toBeNull();
    expect(connection.status).toBe("disconnected");
    expect(connection.accessTokenExpiresAt).toBeNull();
    expect(connection.nextReconcileAt).toBeNull();
  });

  it("records webhook receipt time without bumping the hosted connection updatedAt column", async () => {
    const executeRaw = vi.fn(async () => 1);
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $executeRaw: executeRaw,
      } as never,
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => `enc:${value}`,
        decrypt: (value: string) => value.replace(/^enc:/u, ""),
      },
    });

    await store.markWebhookReceived("dsc_123", "2026-03-25T02:00:00.000Z");

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [query, receivedAt, accountId] = executeRaw.mock.calls[0] as unknown as [
      { strings?: string[] },
      Date,
      string,
    ];
    const queryText = Array.isArray(query?.strings) ? query.strings.join(" ") : String(query);
    expect(queryText).toContain("update device_connection");
    expect(queryText).toContain("set last_webhook_at =");
    expect(queryText).not.toContain("updated_at");
    expect(accountId).toBe("dsc_123");
    expect(receivedAt).toEqual(new Date("2026-03-25T02:00:00.000Z"));
  });
});

function createConnectionRecord(): MutableConnectionRecord {
  return {
    id: "dsc_123",
    userId: "user-123",
    provider: "oura",
    externalAccountId: "acct_123",
    displayName: "Oura ring",
    status: "active",
    scopes: ["daily"],
    accessTokenExpiresAt: new Date("2026-03-25T04:00:00.000Z"),
    metadataJson: {
      region: "us",
    },
    connectedAt: new Date("2026-03-25T00:00:00.000Z"),
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: new Date("2026-03-25T05:00:00.000Z"),
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    secret: {
      connectionId: "dsc_123",
      accessTokenEncrypted: "enc:access-token",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 4,
      keyVersion: "v1",
    },
  };
}

function normalizeCreatedConnection(data: Record<string, unknown>): MutableConnectionRecord {
  if (
    typeof data.id !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.provider !== "string" ||
    typeof data.externalAccountId !== "string" ||
    !(data.connectedAt instanceof Date)
  ) {
    throw new TypeError("Invalid hosted connection record.");
  }

  return {
    id: data.id,
    userId: data.userId,
    provider: data.provider,
    externalAccountId: data.externalAccountId,
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    status: isConnectionStatus(data.status) ? data.status : "active",
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((value): value is string => typeof value === "string") : [],
    accessTokenExpiresAt: data.accessTokenExpiresAt instanceof Date ? new Date(data.accessTokenExpiresAt) : null,
    metadataJson: isRecord(data.metadataJson) ? { ...data.metadataJson } : {},
    connectedAt: new Date(data.connectedAt),
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: data.nextReconcileAt instanceof Date ? new Date(data.nextReconcileAt) : null,
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    secret: null,
  };
}

function normalizeConnectionSecret(data: Record<string, unknown>): MutableConnectionSecret {
  if (
    typeof data.connectionId !== "string" ||
    typeof data.accessTokenEncrypted !== "string" ||
    (data.refreshTokenEncrypted !== null && typeof data.refreshTokenEncrypted !== "string") ||
    typeof data.tokenVersion !== "number" ||
    typeof data.keyVersion !== "string"
  ) {
    throw new TypeError("Invalid hosted connection secret.");
  }

  return {
    connectionId: data.connectionId,
    accessTokenEncrypted: data.accessTokenEncrypted,
    refreshTokenEncrypted: data.refreshTokenEncrypted,
    tokenVersion: data.tokenVersion,
    keyVersion: data.keyVersion,
  };
}

function applyConnectionUpdate(connection: MutableConnectionRecord, data: Record<string, unknown>): void {
  if ("status" in data && isConnectionStatus(data.status)) {
    connection.status = data.status;
  }

  if ("accessTokenExpiresAt" in data) {
    connection.accessTokenExpiresAt = data.accessTokenExpiresAt instanceof Date ? new Date(data.accessTokenExpiresAt) : null;
  }

  if ("nextReconcileAt" in data) {
    connection.nextReconcileAt = data.nextReconcileAt instanceof Date ? new Date(data.nextReconcileAt) : null;
  }

  if ("lastSyncErrorAt" in data) {
    connection.lastSyncErrorAt = data.lastSyncErrorAt instanceof Date ? new Date(data.lastSyncErrorAt) : null;
  }

  if ("lastErrorCode" in data) {
    connection.lastErrorCode = data.lastErrorCode === null || typeof data.lastErrorCode === "string" ? data.lastErrorCode : connection.lastErrorCode;
  }

  if ("lastErrorMessage" in data) {
    connection.lastErrorMessage =
      data.lastErrorMessage === null || typeof data.lastErrorMessage === "string"
        ? data.lastErrorMessage
        : connection.lastErrorMessage;
  }

  if ("updatedAt" in data && data.updatedAt instanceof Date) {
    connection.updatedAt = new Date(data.updatedAt);
  }
}

function cloneOAuthSession(record: MutableOAuthSession | null): MutableOAuthSession | null {
  if (!record) {
    return null;
  }

  return {
    ...record,
    metadataJson: { ...record.metadataJson },
    createdAt: new Date(record.createdAt),
    expiresAt: new Date(record.expiresAt),
  };
}

function cloneConnection(record: MutableConnectionRecord): MutableConnectionRecord {
  return {
    ...record,
    scopes: [...record.scopes],
    metadataJson: { ...record.metadataJson },
    accessTokenExpiresAt: cloneDate(record.accessTokenExpiresAt),
    connectedAt: new Date(record.connectedAt),
    lastWebhookAt: cloneDate(record.lastWebhookAt),
    lastSyncStartedAt: cloneDate(record.lastSyncStartedAt),
    lastSyncCompletedAt: cloneDate(record.lastSyncCompletedAt),
    lastSyncErrorAt: cloneDate(record.lastSyncErrorAt),
    nextReconcileAt: cloneDate(record.nextReconcileAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    secret: record.secret
      ? {
          ...record.secret,
        }
      : null,
  };
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function hostedRandomSuffix(length: number): string {
  return Buffer.from(Array.from({ length }, (_, index) => index)).toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConnectionStatus(value: unknown): value is MutableConnectionRecord["status"] {
  return value === "active" || value === "reauthorization_required" || value === "disconnected";
}
