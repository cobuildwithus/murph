import { describe, expect, it } from "vitest";

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

function createHeartbeatStore(seed: MutableConnection[]) {
  const connections = new Map<string, MutableConnection>(
    seed.map((connection) => [
      connection.id,
      {
        ...connection,
        scopes: [...connection.scopes],
        metadataJson: { ...connection.metadataJson },
      },
    ]),
  );

  const deviceConnection = {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const connection = findConnection(connections, where);

      if (!connection) {
        return { count: 0 };
      }

      applyConnectionUpdate(connection, data);
      return { count: 1 };
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      return cloneConnection(findConnection(connections, where) ?? null);
    },
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceConnection,
    } as never,
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
  it("treats clearError as authoritative even when error fields are also present", async () => {
    const { connections, store } = createHeartbeatStore([
      createConnection({
        lastSyncErrorAt: new Date("2026-03-25T01:00:00.000Z"),
        lastErrorCode: "OLD_CODE",
        lastErrorMessage: "Old failure",
      }),
    ]);

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      clearError: true,
      lastErrorCode: "IGNORED_CODE",
      lastErrorMessage: "Ignored message",
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: "2026-03-25T01:30:00.000Z",
      lastSyncErrorAt: null,
    });
    expect(connections.get("dsc_123")).toMatchObject({
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  });

  it("only applies the provided error fields when clearError is not set", async () => {
    const { connections, store } = createHeartbeatStore([
      createConnection({
        lastErrorCode: "OLD_CODE",
        lastErrorMessage: "Old failure",
      }),
    ]);

    const updated = await store.updateConnectionFromLocalHeartbeat("user-123", "dsc_123", {
      lastErrorMessage: "New failure",
    });

    expect(updated).toMatchObject({
      id: "dsc_123",
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "New failure",
    });
    expect(connections.get("dsc_123")).toMatchObject({
      lastErrorCode: "OLD_CODE",
      lastErrorMessage: "New failure",
    });
  });
});

function createConnection(overrides: Partial<MutableConnection> = {}): MutableConnection {
  return {
    id: "dsc_123",
    userId: "user-123",
    provider: "oura",
    externalAccountId: "acct-123",
    displayName: "Oura",
    status: "active",
    scopes: ["daily"],
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

function findConnection(
  connections: Map<string, MutableConnection>,
  where: Record<string, unknown>,
): MutableConnection | null {
  for (const connection of connections.values()) {
    if (
      (typeof where.id === "string" && connection.id !== where.id) ||
      (typeof where.userId === "string" && connection.userId !== where.userId)
    ) {
      continue;
    }

    return connection;
  }

  return null;
}

function cloneConnection(connection: MutableConnection | null): MutableConnection | null {
  if (!connection) {
    return null;
  }

  return {
    ...connection,
    scopes: [...connection.scopes],
    metadataJson: { ...connection.metadataJson },
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

function applyConnectionUpdate(connection: MutableConnection, data: Record<string, unknown>): void {
  if ("status" in data && isStatus(data.status)) {
    connection.status = data.status;
  }

  applyNullableDate(connection, "lastSyncStartedAt", data.lastSyncStartedAt);
  applyNullableDate(connection, "lastSyncCompletedAt", data.lastSyncCompletedAt);
  applyNullableDate(connection, "lastSyncErrorAt", data.lastSyncErrorAt);
  applyNullableDate(connection, "nextReconcileAt", data.nextReconcileAt);

  if ("lastErrorCode" in data) {
    connection.lastErrorCode = data.lastErrorCode === null || typeof data.lastErrorCode === "string" ? data.lastErrorCode : connection.lastErrorCode;
  }

  if ("lastErrorMessage" in data) {
    connection.lastErrorMessage =
      data.lastErrorMessage === null || typeof data.lastErrorMessage === "string"
        ? data.lastErrorMessage
        : connection.lastErrorMessage;
  }
}

function applyNullableDate(
  connection: MutableConnection,
  key: "lastSyncStartedAt" | "lastSyncCompletedAt" | "lastSyncErrorAt" | "nextReconcileAt",
  value: unknown,
): void {
  if (!(value instanceof Date) && value !== null && value !== undefined) {
    return;
  }

  connection[key] = value instanceof Date ? new Date(value) : value === null ? null : connection[key];
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function isStatus(value: unknown): value is MutableConnection["status"] {
  return value === "active" || value === "reauthorization_required" || value === "disconnected";
}
