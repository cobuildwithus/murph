import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  hostedWorkspaceFindMany: vi.fn(),
  getPrisma: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

type LagSweeperModule = typeof import("../src/lib/hosted-mailbox/lag-sweeper");

let lagSweeper: LagSweeperModule;

describe("hosted mailbox lag sweeper", () => {
  beforeAll(async () => {
    lagSweeper = await import("../src/lib/hosted-mailbox/lag-sweeper");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({
      hostedMailboxItem: {
        groupBy: mocks.groupBy,
      },
      hostedWorkspace: {
        findMany: mocks.hostedWorkspaceFindMany,
      },
    });
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

  it("nudges lagged users from mailbox item high-water rows", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 3n,
        userId: "member_lag_1",
      }),
      buildHighWater({
        lane: "system",
        maxSeq: 1n,
        userId: "member_lag_1",
      }),
      buildHighWater({
        lane: "conversation",
        maxSeq: 2n,
        userId: "member_current",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "2",
          hostedMailboxSystemImportedSeq: "0",
        },
        userId: "member_lag_1",
      }),
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "2",
        },
        userId: "member_current",
      }),
    ]);
    const logger = buildLogger();

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("1970-01-01T00:00:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.groupBy).toHaveBeenCalledWith({
      _max: {
        laneSeq: true,
        updatedAt: true,
      },
      by: ["userId", "lane"],
    });
    expect(mocks.hostedWorkspaceFindMany).toHaveBeenCalledWith({
      select: {
        checkpointedAt: true,
        redactedStatusJson: true,
        userId: true,
      },
      where: {
        userId: {
          in: ["member_lag_1", "member_current"],
        },
      },
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "hosted-mailbox-lag-sweeper",
      timeoutMs: 5000,
      userId: "member_lag_1",
    });
    expect(result).toEqual({
      highWaterRows: 3,
      laggedUsers: 1,
      nudgeAccepted: 1,
      nudgeAttempted: 1,
      nudgeLimit: 5,
      nudgeNotAccepted: 0,
      skippedLaggedUsers: 0,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper nudging runner for mailbox lag.",
      expect.objectContaining({
        userFingerprint: expect.stringMatching(/^[0-9a-f]{12}$/u),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_lag_1");
  });

  it("rotates the nudge window when lagged users exceed the per-run limit", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({ lane: "conversation", maxSeq: 1n, userId: "member_lag_1" }),
      buildHighWater({ lane: "conversation", maxSeq: 1n, userId: "member_lag_2" }),
      buildHighWater({ lane: "conversation", maxSeq: 1n, userId: "member_lag_3" }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({ redactedStatusJson: { hostedMailboxConversationImportedSeq: "0" }, userId: "member_lag_1" }),
      buildWorkspace({ redactedStatusJson: { hostedMailboxConversationImportedSeq: "0" }, userId: "member_lag_2" }),
      buildWorkspace({ redactedStatusJson: { hostedMailboxConversationImportedSeq: "0" }, userId: "member_lag_3" }),
    ]);
    const logger = buildLogger();

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("1970-01-01T00:01:00.000Z"),
      nudgeLimit: 1,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "member_lag_2",
      }),
    );
    expect(result.skippedLaggedUsers).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper skipped lagged users after nudge limit.",
      {
        nudgeLimit: 1,
        skippedLaggedUsers: 2,
      },
    );
  });

  it("logs a warning when a lag nudge is not accepted", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 4n,
        userId: "member_lag_1",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "0",
        },
        userId: "member_lag_1",
      }),
    ]);
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: true,
      errorCode: "TimeoutError",
      inFlight: null,
      nextAlarmAtPresent: null,
    });
    const logger = buildLogger();

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
    });

    expect(result.nudgeNotAccepted).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper runner nudge was not accepted.",
      {
        configured: true,
        errorCode: "TimeoutError",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{12}$/u),
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_lag_1");
  });
});

function buildHighWater(input: {
  lane: string;
  maxSeq: bigint;
  userId: string;
}) {
  return {
    _max: {
      laneSeq: input.maxSeq,
      updatedAt: new Date("2026-05-02T00:01:00.000Z"),
    },
    lane: input.lane,
    userId: input.userId,
  };
}

function buildWorkspace(input: {
  redactedStatusJson: Record<string, unknown> | null;
  userId: string;
}) {
  return {
    checkpointedAt: new Date("2026-05-02T00:00:00.000Z"),
    redactedStatusJson: input.redactedStatusJson,
    userId: input.userId,
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}
