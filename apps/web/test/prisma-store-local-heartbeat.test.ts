import { beforeEach, describe, expect, it, vi } from "vitest";

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

function createHeartbeatStore(seed: Partial<Pick<
  StaticConnectionRecord,
  "lastErrorCode" | "lastErrorMessage" | "lastSyncCompletedAt" | "lastSyncErrorAt" | "lastSyncStartedAt" | "lastWebhookAt" | "nextReconcileAt"
>> = {}) {
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
    ...seed,
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
    store,
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
});
