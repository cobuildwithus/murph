import { describe, expect, it, vi } from "vitest";

const prismaClient = vi.hoisted(() => ({
  Prisma: {
    DbNull: Symbol.for("prisma.db-null"),
  },
  PrismaClient: class PrismaClient {},
}));

const deviceSyncd = vi.hoisted(() => ({
  deviceSyncError: (input: {
    code: string;
    message: string;
    retryable?: boolean;
    httpStatus?: number;
    details?: unknown;
  }) =>
    Object.assign(new Error(input.message), {
      code: input.code,
      retryable: input.retryable ?? false,
      httpStatus: input.httpStatus ?? 500,
      details: input.details,
    }),
}));

vi.mock("@prisma/client", () => prismaClient);
vi.mock("@healthybob/device-syncd", () => deviceSyncd);

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableConnection = {
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

function createConnectionStore(seed: MutableConnection[]) {
  const connections = new Map<string, MutableConnection>(
    seed.map((connection) => [
      connection.id,
      {
        ...connection,
        scopes: [...connection.scopes],
        metadataJson: structuredClone(connection.metadataJson),
      },
    ]),
  );

  const deviceConnection = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      for (const connection of connections.values()) {
        if (typeof where.id === "string" && connection.id !== where.id) {
          continue;
        }

        if (typeof where.userId === "string" && connection.userId !== where.userId) {
          continue;
        }

        return cloneConnection(connection);
      }

      return null;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (typeof where.id !== "string") {
        throw new TypeError("Expected connection id.");
      }

      const connection = connections.get(where.id);

      if (!connection) {
        throw new TypeError("Connection not found.");
      }

      applyConnectionUpdate(connection, data);
      return cloneConnection(connection);
    },
  };

  const tx = {
    deviceConnection,
  };

  const prisma = {
    deviceConnection,
    $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: prisma as never,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    connections,
    store,
  };
}

describe("PrismaDeviceSyncControlPlaneStore local heartbeat updates", () => {
  it("rejects regressive completion timestamps", async () => {
    const { connections, store } = createConnectionStore([
      createConnection({
        lastSyncStartedAt: new Date("2026-03-25T10:00:00.000Z"),
      }),
    ]);

    await expect(
      store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
        lastSyncCompletedAt: "2026-03-25T09:59:59.000Z",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_LOCAL_HEARTBEAT",
      httpStatus: 400,
    });

    expect(connections.get("dsc_123")?.lastSyncCompletedAt).toBeNull();
  });

  it("ignores runtime attempts to overwrite status or nextReconcileAt", async () => {
    const { connections, store } = createConnectionStore([
      createConnection({
        nextReconcileAt: new Date("2026-03-30T00:00:00.000Z"),
      }),
    ]);

    const result = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T10:00:00.000Z",
      status: "disconnected",
      nextReconcileAt: "2099-01-01T00:00:00.000Z",
    } as never);

    expect(result).toMatchObject({
      status: "active",
      nextReconcileAt: "2026-03-30T00:00:00.000Z",
      lastSyncStartedAt: "2026-03-25T10:00:00.000Z",
    });
    expect(connections.get("dsc_123")).toMatchObject({
      status: "active",
    });
    expect(connections.get("dsc_123")?.nextReconcileAt?.toISOString()).toBe("2026-03-30T00:00:00.000Z");
  });

  it("treats local error fields as append-only telemetry", async () => {
    const { store } = createConnectionStore([
      createConnection({
        lastSyncErrorAt: new Date("2026-03-25T09:30:00.000Z"),
        lastErrorCode: "SYNC_FAILED",
        lastErrorMessage: "Previous reconcile failed",
      }),
    ]);

    const result = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastSyncCompletedAt: "2026-03-25T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      lastSyncCompletedAt: "2026-03-25T10:00:00.000Z",
      lastSyncErrorAt: "2026-03-25T09:30:00.000Z",
      lastErrorCode: "SYNC_FAILED",
      lastErrorMessage: "Previous reconcile failed",
      status: "active",
    });
  });
});

function createConnection(overrides: Partial<MutableConnection> = {}): MutableConnection {
  return {
    id: "dsc_123",
    userId: "user-123",
    provider: "whoop",
    externalAccountId: "acct_123",
    displayName: "Test connection",
    status: "active",
    scopes: [],
    accessTokenExpiresAt: null,
    metadataJson: {},
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
    ...overrides,
  };
}

function cloneConnection(connection: MutableConnection): MutableConnection {
  return {
    ...connection,
    scopes: [...connection.scopes],
    metadataJson: structuredClone(connection.metadataJson),
    accessTokenExpiresAt: cloneDate(connection.accessTokenExpiresAt),
    connectedAt: new Date(connection.connectedAt),
    lastWebhookAt: cloneDate(connection.lastWebhookAt),
    lastSyncStartedAt: cloneDate(connection.lastSyncStartedAt),
    lastSyncCompletedAt: cloneDate(connection.lastSyncCompletedAt),
    lastSyncErrorAt: cloneDate(connection.lastSyncErrorAt),
    nextReconcileAt: cloneDate(connection.nextReconcileAt),
    createdAt: new Date(connection.createdAt),
    updatedAt: new Date(connection.updatedAt),
  };
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function applyConnectionUpdate(connection: MutableConnection, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    switch (key) {
      case "lastSyncStartedAt":
      case "lastSyncCompletedAt":
      case "lastSyncErrorAt":
      case "nextReconcileAt":
      case "accessTokenExpiresAt":
      case "lastWebhookAt":
      case "updatedAt":
        (connection as Record<string, unknown>)[key] = value instanceof Date ? new Date(value) : value;
        break;
      default:
        (connection as Record<string, unknown>)[key] = value;
    }
  }
}
