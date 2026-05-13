import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedDeviceSyncDirtyWake: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  appendHostedDeviceSyncDirtyWake: mocks.appendHostedDeviceSyncDirtyWake,
}));

import {
  runHostedDeviceSyncDirtySweeper,
} from "@/src/lib/device-sync/dirty-sweeper";

describe("hosted device-sync dirty sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedDeviceSyncDirtyWake.mockResolvedValue({
      wakeAppended: true,
    });
  });

  it("appends device-sync wakes for stale pending dirty device-sync rows", async () => {
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
    expect(mocks.appendHostedDeviceSyncDirtyWake).toHaveBeenCalledWith({
      connectionId: "dsc_dirty_1",
      dedupeKey: "dirty-revision:2:sweep:2026-05-05T00:01:00.000Z",
      eventType: "sleep.updated",
      occurredAt: "2026-05-05T00:01:00.000Z",
      provider: "oura",
      resourceCategory: "sleep",
      traceId: null,
      userId: "member_dirty_1",
    });
    expect(result).toEqual({
      dirtyConnections: 1,
      skippedDirtyConnections: 0,
      staleAfterMs: 30000,
      wakeAppended: 1,
      wakeAttempted: 1,
      wakeLimit: 5,
      wakeNotAppended: 0,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper appending device-sync wake for dirty state.",
      expect.objectContaining({
        connectionFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
        dirtyRevision: "2",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("dsc_dirty_1");
  });

  it("reports skipped dirty connections and wake append failures without logging raw ids", async () => {
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
    mocks.appendHostedDeviceSyncDirtyWake.mockResolvedValueOnce({
      reason: "append_failed",
      wakeAppended: false,
    });

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 1,
      store,
    });

    expect(result.wakeNotAppended).toBe(1);
    expect(result.skippedDirtyConnections).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper device-sync wake was not appended.",
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

  it("continues the sweep when one dirty wake append throws", async () => {
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
    mocks.appendHostedDeviceSyncDirtyWake
      .mockRejectedValueOnce(new Error("append failed"))
      .mockResolvedValueOnce({
        wakeAppended: true,
      });

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 2,
      store,
    });

    expect(mocks.appendHostedDeviceSyncDirtyWake).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      wakeAppended: 1,
      wakeAttempted: 2,
      wakeNotAppended: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper device-sync wake append failed.",
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
