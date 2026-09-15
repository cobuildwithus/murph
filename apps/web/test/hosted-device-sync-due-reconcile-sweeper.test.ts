import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedDeviceSyncScheduledReconcileWake: vi.fn(),
  preflight: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/scheduled-reconcile-preflight", () => ({ preflightHostedScheduledReconcile: mocks.preflight }));

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
    mocks.preflight.mockResolvedValue({
      outcome: "ineligible", reason: "no_proof", wakeAvoided: false,
      requestCount: 0, recordCount: 0, responseBytes: 0, elapsedMs: 0,
    });
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValue({
      wakeAccepted: true,
      wakeAppended: true,
      wakeDuplicate: false,
      wakeInserted: true,
    });
  });

  it("avoids only proven unchanged ordinary wakes, bounds probes, and retains recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    try {
      const rows = Array.from({ length: 8 }, (_, index) => ({
        connectionId: `synthetic-preflight-${index}`, userId: `synthetic-preflight-member-${index}`,
        provider: "junction", connectedAt: "2026-01-01T00:00:00.000Z", nextReconcileAt: "2026-01-02T00:00:00.000Z",
        ...(index === 0 ? { orphanedDirtyRecoveryKey: "1" } : {}),
      }));
      mocks.preflight.mockResolvedValue({
        outcome: "unchanged", reason: "content_unchanged", wakeAvoided: true,
        requestCount: 2, recordCount: 3, responseBytes: 400, elapsedMs: 5,
      });
      const logger = buildLogger();
      const run = runHostedDeviceSyncDueReconcileSweeper({ logger, store: buildStore(rows), wakeLimit: 8 });
      await vi.runAllTimersAsync();
      expect(await run).toMatchObject({ wakeAccepted: 3, wakeAttempted: 3 });
      expect(mocks.preflight).toHaveBeenCalledTimes(5);
      expect(mocks.preflight.mock.calls.every(([input]) => input.connection.connectionId !== rows[0].connectionId)).toBe(true);
      expect(mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls.some(([wake]) => wake.connectionId === rows[0].connectionId)).toBe(true);
      expect(logger.info).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ preflight: {
        attempted: 5, eligible: 5, avoidedWakes: 5, logicalCollectionReads: 10,
        decodedRecordCount: 15, decodedRecordBytes: 2000, elapsedMs: 25,
        reasons: { content_unchanged: 5, budget_exhausted: 2 },
        webhookAgeOutcomes: { "unavailable:unchanged": 5 },
      } }));
    } finally { vi.useRealTimers(); }
  });

  it("falls back to the scheduled wake when preflight throws without logging raw errors", async () => {
    vi.useFakeTimers();
    try {
      const logger = buildLogger();
      mocks.preflight.mockRejectedValue(new Error("synthetic private response body"));
      const run = runHostedDeviceSyncDueReconcileSweeper({ logger, store: buildStore([{
        connectionId: "synthetic-failed-probe", userId: "synthetic-member", provider: "junction",
        connectedAt: "2026-01-01T00:00:00.000Z", nextReconcileAt: "2026-01-02T00:00:00.000Z",
      }]) });
      await vi.runAllTimersAsync();
      expect(await run).toMatchObject({ wakeAccepted: 1, wakeAttempted: 1 });
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain("synthetic private response body");
    } finally { vi.useRealTimers(); }
  });

  it("jitters individual scheduled wake transactions across the selected cohort", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(0);
    try {
      const starts: number[] = [];
      const rows = Array.from({ length: 250 }, (_, index) => ({
        connectionId: `synthetic-connection-${index}`,
        connectedAt: "2026-01-01T00:00:00.000Z",
        nextReconcileAt: "2026-01-02T00:00:00.000Z",
        provider: "whoop",
        userId: `synthetic-member-${index}`,
      }));
      mocks.appendHostedDeviceSyncScheduledReconcileWake.mockImplementation(async () => {
        starts.push(performance.now());
        return { wakeAccepted: true };
      });
      const sweep = runHostedDeviceSyncDueReconcileSweeper({
        logger: buildLogger(), store: buildStore(rows), wakeLimit: 250,
        now: new Date("2026-01-02T00:01:00.000Z"),
      });
      await vi.runAllTimersAsync();
      expect(await sweep).toMatchObject({ wakeAccepted: 250, wakeAttempted: 250 });
      expect(new Set(starts).size).toBeGreaterThan(230);
      expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(3_000);
      expect(Math.max(...starts)).toBeLessThanOrEqual(5_000);
      for (const [wake] of mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls) {
        expect(wake.nextReconcileAt).toBe("2026-01-02T00:00:00.000Z");
        expect(wake.expectedConnectedAt).toBe("2026-01-01T00:00:00.000Z");
      }
    } finally {
      vi.useRealTimers();
    }
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

    expect([...mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls].sort(
      ([left], [right]) => left.connectionId.localeCompare(right.connectionId),
    )).toEqual([
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

  it("counts multiple already-owned retries as accepted without sweep failures", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_shared",
      },
      {
        connectionId: "dsc_due_2",
        connectedAt: "2026-05-04T12:05:00.000Z",
        nextReconcileAt: "2026-05-05T00:00:01.000Z",
        provider: "oura",
        userId: "member_due_shared",
      },
    ]);
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValue({
      wakeAccepted: true,
      wakeAppended: false,
      wakeDuplicate: true,
      wakeInserted: false,
    });

    await expect(runHostedDeviceSyncDueReconcileSweeper({
      logger,
      store,
      wakeLimit: 2,
    })).resolves.toEqual({
      dueConnections: 2,
      skippedDueConnections: 0,
      wakeAccepted: 2,
      wakeAttempted: 2,
      wakeFailed: 0,
      wakeLimit: 2,
      wakeNotAccepted: 0,
    });
    expect(logger.warn).not.toHaveBeenCalled();
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
