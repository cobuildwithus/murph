import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import {
  runHostedDeviceSyncDirtySweeper,
} from "@/src/lib/device-sync/dirty-sweeper";

describe("hosted device-sync dirty sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: true,
    });
  });

  it("nudges users with stale pending dirty device-sync rows", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        dirtyConnectionCount: 2n,
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
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

    expect(store.listDirtyUsersForSweep).toHaveBeenCalledWith({
      limit: 6,
      staleBefore: new Date("2026-05-05T00:00:30.000Z"),
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "hosted-device-sync-dirty-sweeper",
      timeoutMs: 5000,
      userId: "member_dirty_1",
    });
    expect(result).toEqual({
      dirtyUsers: 1,
      nudgeAccepted: 1,
      nudgeAttempted: 1,
      nudgeLimit: 5,
      nudgeNotAccepted: 0,
      skippedDirtyUsers: 0,
      staleAfterMs: 30000,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper nudging runner for dirty state.",
      expect.objectContaining({
        dirtyConnectionCount: "2",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
  });

  it("reports skipped dirty users and nudge failures without logging raw user ids", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        dirtyConnectionCount: 1n,
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        userId: "member_dirty_1",
      },
      {
        dirtyConnectionCount: 1n,
        latestDirtyAt: "2026-05-05T00:00:01.000Z",
        userId: "member_dirty_2",
      },
    ]);
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: true,
      errorCode: "TimeoutError",
      inFlight: null,
      nextAlarmAtPresent: null,
    });

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 1,
      store,
    });

    expect(result.nudgeNotAccepted).toBe(1);
    expect(result.skippedDirtyUsers).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper runner nudge was not accepted.",
      {
        configured: true,
        errorCode: "TimeoutError",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper skipped dirty users after nudge limit.",
      {
        nudgeLimit: 1,
        skippedDirtyUsers: 1,
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_2");
  });
});

function buildStore(rows: Array<{
  dirtyConnectionCount: bigint;
  latestDirtyAt: string;
  userId: string;
}>) {
  return {
    listDirtyUsersForSweep: vi.fn(async () => rows),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}
