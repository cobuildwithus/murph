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
    mocks.requestHostedDeviceSyncDirtyRecovery.mockResolvedValue(buildRecoveryResult());
  });

  it("requests one background recovery for each stale dirty user", async () => {
    const logger = buildLogger();
    const store = buildStore([
      {
        dirtyConnectionCount: 1n,
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
    expect(mocks.requestHostedDeviceSyncDirtyRecovery).toHaveBeenCalledWith({
      userId: "member_dirty_1",
    });
    expect(result).toEqual({
      dirtyConnections: 1,
      dirtyUsers: 1,
      recoveryAttempted: 1,
      recoveryFailed: 0,
      recoveryLimit: 5,
      recoveryNotRequested: 0,
      recoveryRequested: 1,
      skippedDirtyUsers: 0,
      staleAfterMs: 30000,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper requesting background recovery for dirty user state.",
      expect.objectContaining({
        dirtyConnectionCount: "1",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
  });

  it("keeps dirty recovery coalesced by user instead of signaling once per dirty connection", async () => {
    const store = buildStore([
      {
        dirtyConnectionCount: 4n,
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        userId: "member_dirty_1",
      },
    ]);

    const result = await runHostedDeviceSyncDirtySweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:01:00.000Z"),
      store,
    });

    expect(mocks.requestHostedDeviceSyncDirtyRecovery).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedDeviceSyncDirtyRecovery).toHaveBeenCalledWith({
      userId: "member_dirty_1",
    });
    expect(result).toMatchObject({
      dirtyConnections: 4,
      dirtyUsers: 1,
      recoveryAttempted: 1,
      recoveryRequested: 1,
    });
  });

  it("requests separate background recoveries for separate dirty users", async () => {
    const store = buildStore([
      {
        dirtyConnectionCount: 1n,
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        userId: "member_dirty_1",
      },
      {
        dirtyConnectionCount: 2n,
        latestDirtyAt: "2026-05-05T00:00:01.000Z",
        userId: "member_dirty_2",
      },
    ]);

    await runHostedDeviceSyncDirtySweeper({
      logger: buildLogger(),
      now: new Date("2026-05-05T00:01:00.000Z"),
      store,
    });

    expect(mocks.requestHostedDeviceSyncDirtyRecovery.mock.calls).toEqual([
      [{ userId: "member_dirty_1" }],
      [{ userId: "member_dirty_2" }],
    ]);
  });

  it("reports skipped dirty users and recovery request failures without logging raw ids", async () => {
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
    mocks.requestHostedDeviceSyncDirtyRecovery.mockResolvedValueOnce({
      reason: "request_failed",
      recoveryRequested: false,
    });

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 1,
      store,
    });

    expect(result.recoveryNotRequested).toBe(1);
    expect(result.recoveryFailed).toBe(1);
    expect(result.skippedDirtyUsers).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper background recovery was not requested.",
      expect.objectContaining({
        reason: "request_failed",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper skipped dirty users after recovery limit.",
      {
        recoveryLimit: 1,
        skippedDirtyUsers: 1,
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_dirty_2");
  });

  it("continues the sweep when one dirty recovery request throws", async () => {
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
    mocks.requestHostedDeviceSyncDirtyRecovery
      .mockRejectedValueOnce(new Error("request failed"))
      .mockResolvedValueOnce(buildRecoveryResult());

    const result = await runHostedDeviceSyncDirtySweeper({
      logger,
      nudgeLimit: 2,
      store,
    });

    expect(mocks.requestHostedDeviceSyncDirtyRecovery).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      recoveryAttempted: 2,
      recoveryFailed: 1,
      recoveryNotRequested: 1,
      recoveryRequested: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync dirty sweeper background recovery request failed.",
      expect.objectContaining({
        errorName: "Error",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/u),
      }),
    );
  });
});

function buildRecoveryResult(overrides: Partial<{
  reason: string;
  recoveryRequested: boolean;
}> = {}) {
  return {
    recoveryRequested: true,
    ...overrides,
  };
}

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
