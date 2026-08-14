import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedDeviceSyncScheduledReconcileWake: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  appendHostedDeviceSyncScheduledReconcileWake: mocks.appendHostedDeviceSyncScheduledReconcileWake,
  buildHostedDeviceSyncScheduledReconcileWakeEventId: (input: {
    connectionId: string; expectedConnectedAt: string; nextReconcileAt: string;
  }) => [
    "device-sync",
    "scheduled-reconcile",
    "v3",
    input.connectionId,
    input.expectedConnectedAt,
    input.nextReconcileAt,
  ].join(":"),
}));

import {
  runHostedDeviceSyncDueReconcileSweeper,
} from "@/src/lib/device-sync/due-reconcile-sweeper";

describe("hosted device-sync due reconcile sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValue({
      wakeAccepted: true,
      wakeAppended: true,
      wakeDuplicate: false,
      wakeInserted: true,
    });
  });

  it("requests scheduled mailbox wakes for active due connections", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
    ]);

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      now: new Date("2026-05-05T00:01:00.000Z"),
      wakeLimit: 5,
      store,
    });

    expect(store.listDueReconcileConnectionsForSweep).toHaveBeenCalledWith({
      dueAt: new Date("2026-05-05T00:01:00.000Z"),
      limit: 6,
      recoveryBucketStartedAt: new Date("2026-05-05T00:00:00.000Z"),
    });
    expect(mocks.appendHostedDeviceSyncScheduledReconcileWake).toHaveBeenCalledWith({
      connectionId: "dsc_due_1",
      createdAt: "2026-05-05T00:01:00.000Z",
      eventId: "device-sync:scheduled-reconcile:v3:dsc_due_1:2026-05-04T12:00:00.000Z:2026-05-05T00:00:00.000Z",
      expectedConnectedAt: "2026-05-04T12:00:00.000Z",
      nextReconcileAt: "2026-05-05T00:00:00.000Z",
      provider: "whoop",
      traceId: null,
      userId: "member_due_1",
    });
    expect(result).toEqual({
      dueConnections: 1,
      skippedDueConnections: 0,
      wakeAccepted: 1,
      wakeAttempted: 1,
      wakeFailed: 0,
      wakeLimit: 5,
      wakeNotAccepted: 0,
    });
    const infoLogs = JSON.stringify(logger.info.mock.calls);
    expect(infoLogs).not.toContain("member_due_1");
    expect(infoLogs).not.toContain("dsc_due_1");
    expect(infoLogs).not.toContain("whoop");
  });

  it("passes the wake bucket to the selector so retries stay bounded", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
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

  it("keeps scheduled wakes distinct for different due connections", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_2",
        connectedAt: "2026-05-04T12:05:00.000Z",
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

    expect(mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls).toEqual([
      [{
        connectionId: "dsc_due_1",
        createdAt: "2026-05-05T00:01:00.000Z",
        eventId: "device-sync:scheduled-reconcile:v3:dsc_due_1:2026-05-04T12:00:00.000Z:2026-05-05T00:00:00.000Z",
        expectedConnectedAt: "2026-05-04T12:00:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        traceId: null,
        userId: "member_due_1",
      }],
      [{
        connectionId: "dsc_due_2",
        createdAt: "2026-05-05T00:01:00.000Z",
        eventId: "device-sync:scheduled-reconcile:v3:dsc_due_2:2026-05-04T12:05:00.000Z:2026-05-05T00:00:00.000Z",
        expectedConnectedAt: "2026-05-04T12:05:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        traceId: null,
        userId: "member_due_2",
      }],
    ]);
  });

  it("reports skipped due connections and wake failures without logging raw ids", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_2",
        connectedAt: "2026-05-04T12:05:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:01.000Z",
        provider: "whoop",
        userId: "member_due_2",
      },
    ]);
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValueOnce({
      reason: "wake_failed",
      wakeAccepted: false,
      wakeAppended: false,
      wakeDuplicate: false,
      wakeInserted: false,
    });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      wakeLimit: 1,
      store,
    });

    expect(result.wakeNotAccepted).toBe(1);
    expect(result.wakeFailed).toBe(1);
    expect(result.skippedDueConnections).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper wake was not accepted.",
      expect.objectContaining({
        errorCode: "HOSTED_DEVICE_SYNC_DUE_RECONCILE_WAKE_NOT_ACCEPTED",
        reason: "wake_failed",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper skipped due connections after wake limit.",
      {
        wakeLimit: 1,
        skippedDueConnections: 1,
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_due_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_due_2");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_due_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_due_2");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("whoop");
  });

  it("treats a consent-withdrawn race as an expected skipped wake", async () => {
    const logger = buildLogger();
    const store = buildStore([{
      connectionId: "dsc_due_1",
      connectedAt: "2026-05-04T12:00:00.000Z",
      nextReconcileAt: "2026-05-05T00:00:00.000Z",
      provider: "whoop",
      userId: "member_due_1",
    }]);
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValueOnce({
      reason: "health_data_consent_withdrawn",
      wakeAccepted: false,
      wakeAppended: false,
      wakeDuplicate: false,
      wakeInserted: false,
    });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      store,
    });

    expect(result).toMatchObject({
      wakeAccepted: 0,
      wakeAttempted: 1,
      wakeFailed: 0,
      wakeNotAccepted: 1,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile wake skipped after consent withdrawal.",
      { reason: "health_data_consent_withdrawn" },
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper wake was not accepted.",
      expect.anything(),
    );
  });

  it("continues the sweep when one scheduled wake throws", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_2",
        connectedAt: "2026-05-04T12:05:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:01.000Z",
        provider: "whoop",
        userId: "member_due_2",
      },
    ]);
    mocks.appendHostedDeviceSyncScheduledReconcileWake
      .mockRejectedValueOnce(new Error("wake failed"))
      .mockResolvedValueOnce({
        wakeAccepted: true,
        wakeAppended: true,
        wakeDuplicate: false,
        wakeInserted: true,
      });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      wakeLimit: 2,
      store,
    });

    expect(mocks.appendHostedDeviceSyncScheduledReconcileWake).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      wakeAccepted: 1,
      wakeAttempted: 2,
      wakeFailed: 1,
      wakeNotAccepted: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper wake request failed.",
      expect.objectContaining({
        errorCode: "HOSTED_DEVICE_SYNC_DUE_RECONCILE_WAKE_REQUEST_FAILED",
        errorMessage: "wake failed",
      }),
    );
  });
});

function buildStore(rows: Array<{
  connectionId: string;
  connectedAt: string;
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
