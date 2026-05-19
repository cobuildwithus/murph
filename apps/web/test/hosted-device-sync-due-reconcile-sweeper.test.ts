import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedDeviceSyncScheduledReconcileWake: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  appendHostedDeviceSyncScheduledReconcileWake: mocks.appendHostedDeviceSyncScheduledReconcileWake,
}));

import {
  runHostedDeviceSyncDueReconcileSweeper,
} from "@/src/lib/device-sync/due-reconcile-sweeper";

describe("hosted device-sync due reconcile sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValue({
      wakeAppended: true,
    });
  });

  it("appends scheduled device-sync wakes for active due connections", async () => {
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
    });
    expect(mocks.appendHostedDeviceSyncScheduledReconcileWake).toHaveBeenCalledWith({
      connectionId: "dsc_due_1",
      createdAt: "2026-05-05T00:01:00.000Z",
      eventId: expect.stringMatching(/^device-sync:scheduled-reconcile:[0-9a-f]{32}$/u),
      nextReconcileAt: "2026-05-05T00:00:00.000Z",
      provider: "whoop",
      traceId: null,
      userId: "member_due_1",
    });
    expect(result).toEqual({
      dueConnections: 1,
      skippedDueConnections: 0,
      wakeAppended: 1,
      wakeAttempted: 1,
      wakeLimit: 5,
      wakeNotAppended: 0,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper appending scheduled device-sync wake.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("member_due_1");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("dsc_due_1");
  });

  it("uses a stable scheduled wake event id inside the same recovery bucket", async () => {
    const row = {
      connectionId: "dsc_due_1",
      nextReconcileAt: "2026-05-05T00:00:00.000Z",
      provider: "whoop",
      userId: "member_due_1",
    };
    const store = buildStore([row]);

    await runHostedDeviceSyncDueReconcileSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:01:00.000Z"),
      store,
    });
    await runHostedDeviceSyncDueReconcileSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:04:00.000Z"),
      store,
    });

    const firstWake = mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls[0]?.[0];
    const secondWake = mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls[1]?.[0];
    expect(firstWake?.eventId).toBe(secondWake?.eventId);
    expect(firstWake?.eventId).toMatch(/^device-sync:scheduled-reconcile:[0-9a-f]{32}$/u);
    expect(firstWake?.createdAt).toBe("2026-05-05T00:01:00.000Z");
    expect(secondWake?.createdAt).toBe("2026-05-05T00:04:00.000Z");
    expect(firstWake?.nextReconcileAt).toBe("2026-05-05T00:00:00.000Z");
    expect(secondWake?.nextReconcileAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("creates fresh bounded wake demand when a due connection stays stale across recovery buckets", async () => {
    const row = {
      connectionId: "dsc_due_1",
      nextReconcileAt: "2026-05-05T00:00:00.000Z",
      provider: "whoop",
      userId: "member_due_1",
    };
    const store = buildStore([row]);

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

    const firstWake = mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls[0]?.[0];
    const secondWake = mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls[1]?.[0];
    expect(firstWake?.eventId).toMatch(/^device-sync:scheduled-reconcile:[0-9a-f]{32}$/u);
    expect(secondWake?.eventId).toMatch(/^device-sync:scheduled-reconcile:[0-9a-f]{32}$/u);
    expect(firstWake?.eventId).not.toBe(secondWake?.eventId);
    expect(firstWake?.nextReconcileAt).toBe("2026-05-05T00:00:00.000Z");
    expect(secondWake?.nextReconcileAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("keeps scheduled wake event ids distinct for different due timestamps and connections", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:30:00.000Z",
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
      now: new Date("2026-05-05T00:31:00.000Z"),
      store,
    });

    const eventIds = mocks.appendHostedDeviceSyncScheduledReconcileWake.mock.calls.map(([input]) => input.eventId);
    expect(eventIds).toHaveLength(3);
    expect(new Set(eventIds).size).toBe(3);
    for (const eventId of eventIds) {
      expect(eventId).toMatch(/^device-sync:scheduled-reconcile:[0-9a-f]{32}$/u);
    }
  });

  it("reports skipped due connections and wake append failures without logging raw ids", async () => {
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
    mocks.appendHostedDeviceSyncScheduledReconcileWake.mockResolvedValueOnce({
      reason: "append_failed",
      wakeAppended: false,
    });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      nudgeLimit: 1,
      store,
    });

    expect(result.wakeNotAppended).toBe(1);
    expect(result.skippedDueConnections).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper device-sync wake was not appended.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        reason: "append_failed",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper skipped due connections after wake limit.",
      {
        skippedDueConnections: 1,
        wakeLimit: 1,
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_due_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_due_2");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_due_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_due_2");
  });

  it("continues the sweep when one scheduled wake append throws", async () => {
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
    mocks.appendHostedDeviceSyncScheduledReconcileWake
      .mockRejectedValueOnce(new Error("append failed"))
      .mockResolvedValueOnce({
        wakeAppended: true,
      });

    const result = await runHostedDeviceSyncDueReconcileSweeper({
      logger,
      nudgeLimit: 2,
      store,
    });

    expect(mocks.appendHostedDeviceSyncScheduledReconcileWake).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      wakeAppended: 1,
      wakeAttempted: 2,
      wakeNotAppended: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync due reconcile sweeper device-sync wake append failed.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        errorName: "Error",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
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
