import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedDeviceSyncScheduledReconcileRecovery: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  requestHostedDeviceSyncScheduledReconcileRecovery: mocks.requestHostedDeviceSyncScheduledReconcileRecovery,
}));

import {
  runHostedDeviceSyncDueReconcileSweeper,
} from "@/src/lib/device-sync/due-reconcile-sweeper";

describe("hosted device-sync due reconcile sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestHostedDeviceSyncScheduledReconcileRecovery.mockResolvedValue({
      recoveryRequested: true,
    });
  });

  it("requests scheduled background recovery for active due connections", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
    ]);

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      now: new Date("2026-05-05T00:01:00.000Z"),
      nudgeLimit: 5,
      store,
    });

    expect(store.listDueReconcileConnectionsForSweep).toHaveBeenCalledWith({
      dueAt: new Date("2026-05-05T00:01:00.000Z"),
      limit: 6,
      recoveryBucketStartedAt: new Date("2026-05-05T00:00:00.000Z"),
    });
    expect(mocks.requestHostedDeviceSyncScheduledReconcileRecovery).toHaveBeenCalledWith({
      connectionId: "dsc_due_1",
      createdAt: "2026-05-05T00:01:00.000Z",
      nextReconcileAt: "2026-05-05T00:00:00.000Z",
      provider: "whoop",
      traceId: null,
      userId: "member_due_1",
    });
    expect(result).toEqual({
      dueConnections: 1,
      recoveryAttempted: 1,
      recoveryFailed: 0,
      recoveryLimit: 5,
      recoveryNotRequested: 0,
      recoveryRequested: 1,
      skippedDueConnections: 0,
    });
    const infoLogs = JSON.stringify(logger.info.mock.calls);
    expect(infoLogs).not.toContain("member_due_1");
    expect(infoLogs).not.toContain("dsc_due_1");
    expect(infoLogs).not.toContain("whoop");
  });

  it("passes the recovery bucket to the selector so retries stay bounded", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
    ]);

    await runHostedDeviceSyncDueReconcileSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:04:59.000Z"),
      store,
    });
    await runHostedDeviceSyncDueReconcileSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:05:00.000Z"),
      store,
    });

    expect(store.listDueReconcileConnectionsForSweep).toHaveBeenNthCalledWith(1, {
      dueAt: new Date("2026-05-05T00:04:59.000Z"),
      limit: 26,
      recoveryBucketStartedAt: new Date("2026-05-05T00:00:00.000Z"),
    });
    expect(store.listDueReconcileConnectionsForSweep).toHaveBeenNthCalledWith(2, {
      dueAt: new Date("2026-05-05T00:05:00.000Z"),
      limit: 26,
      recoveryBucketStartedAt: new Date("2026-05-05T00:05:00.000Z"),
    });
  });

  it("keeps scheduled recovery requests distinct for different due connections", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_2",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_2",
      },
    ]);

    await runHostedDeviceSyncDueReconcileSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:01:00.000Z"),
      store,
    });

    expect(mocks.requestHostedDeviceSyncScheduledReconcileRecovery.mock.calls).toEqual([
      [{
        connectionId: "dsc_due_1",
        createdAt: "2026-05-05T00:01:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        traceId: null,
        userId: "member_due_1",
      }],
      [{
        connectionId: "dsc_due_2",
        createdAt: "2026-05-05T00:01:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        traceId: null,
        userId: "member_due_2",
      }],
    ]);
  });

  it("reports skipped due connections and recovery request failures without logging raw ids", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_2",
        nextReconcileAt: "2026-05-05T00:00:01.000Z",
        provider: "whoop",
        userId: "member_due_2",
      },
    ]);
    mocks.requestHostedDeviceSyncScheduledReconcileRecovery.mockResolvedValueOnce({
      reason: "request_failed",
      recoveryRequested: false,
    });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      nudgeLimit: 1,
      store,
    });

    expect(result.recoveryNotRequested).toBe(1);
    expect(result.recoveryFailed).toBe(1);
    expect(result.skippedDueConnections).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper background recovery was not requested.",
      expect.objectContaining({
        reason: "request_failed",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper skipped due connections after recovery limit.",
      {
        recoveryLimit: 1,
        skippedDueConnections: 1,
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_due_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_due_2");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_due_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_due_2");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("whoop");
  });

  it("continues the sweep when one scheduled recovery request throws", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_2",
        nextReconcileAt: "2026-05-05T00:00:01.000Z",
        provider: "whoop",
        userId: "member_due_2",
      },
    ]);
    mocks.requestHostedDeviceSyncScheduledReconcileRecovery
      .mockRejectedValueOnce(new Error("request failed"))
      .mockResolvedValueOnce({
        recoveryRequested: true,
      });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      nudgeLimit: 2,
      store,
    });

    expect(mocks.requestHostedDeviceSyncScheduledReconcileRecovery).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      recoveryAttempted: 2,
      recoveryFailed: 1,
      recoveryNotRequested: 1,
      recoveryRequested: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper background recovery request failed.",
      expect.objectContaining({
        errorName: "Error",
      }),
    );
  });
});

function buildStore(rows: Array<{
  connectionId: string;
  nextReconcileAt: string;
  provider: string;
  userId: string;
}>) {
  return {
    listDueReconcileConnectionsForSweep: vi.fn(async () => rows),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}
