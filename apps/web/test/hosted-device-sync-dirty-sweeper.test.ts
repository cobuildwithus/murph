import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedDeviceSyncDirtyRecovery: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  requestHostedDeviceSyncDirtyRecovery: mocks.requestHostedDeviceSyncDirtyRecovery,
}));

import {
  runHostedDeviceSyncDirtySweeper,
} from "@/src/lib/device-sync/dirty-sweeper";

describe("hosted device-sync dirty sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestHostedDeviceSyncDirtyRecovery.mockResolvedValue(buildDirtyWakeResult());
  });

  it("requests background recovery for stale pending dirty device-sync rows", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_dirty_1",
        dirtyRevision: 2n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: "trace_dirty_1",
        provider: "oura",
        userId: "member_dirty_1",
      },
    ]);

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      now: new Date("2026-05-05T00:01:00.000Z"),
      nudgeLimit: 5,
      staleAfterMs: 30_000,
      store,
    });

    expect(store.listDirtyConnectionsForSweep).toHaveBeenCalledWith({
      limit: 6,
      staleBefore: new Date("2026-05-05T00:00:30.000Z"),
    });
    expect(mocks.requestHostedDeviceSyncDirtyRecovery).toHaveBeenCalledWith({
      connectionId: "dsc_dirty_1",
      dirtyRevision: 2n,
      eventType: "sleep.updated",
      occurredAt: "2026-05-05T00:00:00.000Z",
      provider: "oura",
      resourceCategory: "sleep",
      userId: "member_dirty_1",
    });
    expect(mocks.requestHostedDeviceSyncDirtyRecovery.mock.calls.map(([wake]) => wake.occurredAt))
      .not.toContain("2026-05-05T00:01:00.000Z");
    expect(result).toEqual({
      dirtyConnections: 1,
      skippedDirtyConnections: 0,
      staleAfterMs: 30000,
      wakeAppended: 1,
      wakeAttempted: 1,
      wakeDuplicate: 0,
      wakeFailed: 0,
      wakeLimit: 5,
      wakeNotAppended: 0,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper requesting background recovery for dirty state.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        dirtyRevision: "2",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_dirty_1");
  });

  it("uses a stable dirty revision across sweeps for the same unresolved dirty row", async () => {
    const row = {
      connectionId: "dsc_dirty_1",
      dirtyRevision: 2n,
      latestEventType: "sleep.updated",
      latestDirtyAt: "2026-05-05T00:00:00.000Z",
      latestResourceCategory: "sleep",
      latestTraceId: "trace_dirty_1",
      provider: "oura",
      userId: "member_dirty_1",
    };
    const store = buildStore([row]);

    await runHostedDeviceSyncDirtySweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:01:00.000Z"),
      store,
    });
    await runHostedDeviceSyncDirtySweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:02:00.000Z"),
      store,
    });

    const firstWake = mocks.requestHostedDeviceSyncDirtyRecovery.mock.calls[0]?.[0];
    const secondWake = mocks.requestHostedDeviceSyncDirtyRecovery.mock.calls[1]?.[0];
    expect(firstWake?.dirtyRevision).toBe(2n);
    expect(secondWake?.dirtyRevision).toBe(2n);
    expect(firstWake?.connectionId).toBe(secondWake?.connectionId);
    expect(firstWake?.occurredAt).toBe("2026-05-05T00:00:00.000Z");
    expect(secondWake?.occurredAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("passes each dirty connection identity to the dirty recovery primitive", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_dirty_1",
        dirtyRevision: 2n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_1",
      },
      {
        connectionId: "dsc_dirty_2",
        dirtyRevision: 2n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_2",
      },
    ]);

    await runHostedDeviceSyncDirtySweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:01:00.000Z"),
      store,
    });

    const firstWake = mocks.requestHostedDeviceSyncDirtyRecovery.mock.calls[0]?.[0];
    const secondWake = mocks.requestHostedDeviceSyncDirtyRecovery.mock.calls[1]?.[0];
    expect(firstWake).toMatchObject({
      connectionId: "dsc_dirty_1",
      dirtyRevision: 2n,
    });
    expect(secondWake).toMatchObject({
      connectionId: "dsc_dirty_2",
      dirtyRevision: 2n,
    });
  });

  it("reports skipped dirty connections and recovery request failures without logging raw ids", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_dirty_1",
        dirtyRevision: 1n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_1",
      },
      {
        connectionId: "dsc_dirty_2",
        dirtyRevision: 1n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:01.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_2",
      },
    ]);
    mocks.requestHostedDeviceSyncDirtyRecovery.mockResolvedValueOnce({
      reason: "append_failed",
      wakeAccepted: false,
      wakeAppended: false,
      wakeDuplicate: false,
      wakeInserted: false,
    });

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 1,
      store,
    });

    expect(result.wakeNotAppended).toBe(1);
    expect(result.wakeFailed).toBe(1);
    expect(result.skippedDirtyConnections).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper background recovery was not requested.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        reason: "append_failed",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper skipped dirty connections after wake limit.",
      {
        skippedDirtyConnections: 1,
        wakeLimit: 1,
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_2");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_dirty_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_dirty_2");
  });

  it("continues the sweep when one dirty recovery request throws", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        connectionId: "dsc_dirty_1",
        dirtyRevision: 1n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_1",
      },
      {
        connectionId: "dsc_dirty_2",
        dirtyRevision: 1n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:01.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_2",
      },
    ]);
    mocks.requestHostedDeviceSyncDirtyRecovery
      .mockRejectedValueOnce(new Error("append failed"))
      .mockResolvedValueOnce(buildDirtyWakeResult());

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 2,
      store,
    });

    expect(mocks.requestHostedDeviceSyncDirtyRecovery).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      wakeAppended: 1,
      wakeAttempted: 2,
      wakeFailed: 1,
      wakeNotAppended: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper background recovery request failed.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        errorName: "Error",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
  });

  it("counts duplicate dirty recovery requests as accepted recovery work", async () => {
    const store = buildStore([
      {
        connectionId: "dsc_dirty_1",
        dirtyRevision: 1n,
        latestEventType: "sleep.updated",
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestResourceCategory: "sleep",
        latestTraceId: null,
        provider: "oura",
        userId: "member_dirty_1",
      },
    ]);
    mocks.requestHostedDeviceSyncDirtyRecovery.mockResolvedValueOnce(
      buildDirtyWakeResult({
        wakeAppended: false,
        wakeDuplicate: true,
        wakeInserted: false,
      }),
    );

    const result = await runHostedDeviceSyncDirtySweeper({
      logger: buildLogger(),
      nudgeLimit: 1,
      store,
    });

    expect(result).toMatchObject({
      wakeAppended: 0,
      wakeAttempted: 1,
      wakeDuplicate: 1,
      wakeFailed: 0,
      wakeNotAppended: 0,
    });
  });
});

function buildDirtyWakeResult(overrides: Partial<{
  reason: string;
  wakeAccepted: boolean;
  wakeAppended: boolean;
  wakeDuplicate: boolean;
  wakeInserted: boolean;
}> = {}) {
  return {
    wakeAccepted: true,
    wakeAppended: true,
    wakeDuplicate: false,
    wakeInserted: true,
    ...overrides,
  };
}

function buildStore(rows: Array<{
  connectionId: string;
  dirtyRevision: bigint;
  latestEventType: string | null;
  latestDirtyAt: string;
  latestResourceCategory: string | null;
  latestTraceId: string | null;
  provider: string;
  userId: string;
}>) {
  return {
    listDirtyConnectionsForSweep: vi.fn(async () => rows),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}
