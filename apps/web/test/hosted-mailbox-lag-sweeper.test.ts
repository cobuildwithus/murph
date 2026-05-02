import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
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
      hostedMailboxLaneCounter: {
        findMany: mocks.findMany,
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

  it("nudges lagged users and bounds the number of nudge attempts", async () => {
    mocks.findMany.mockResolvedValue([
      buildCounter({
        lane: "conversation",
        nextSeq: 4n,
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "2",
          hostedMailboxSystemImportedSeq: "0",
        },
        userId: "member_lag_1",
      }),
      buildCounter({
        lane: "system",
        nextSeq: 2n,
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "2",
          hostedMailboxSystemImportedSeq: "0",
        },
        userId: "member_lag_1",
      }),
      buildCounter({
        lane: "conversation",
        nextSeq: 3n,
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "2",
        },
        userId: "member_current",
      }),
      buildCounter({
        lane: "conversation",
        nextSeq: 10n,
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "0",
        },
        userId: "member_lag_2",
      }),
      buildCounter({
        lane: "unknown-lane",
        nextSeq: 2n,
        redactedStatusJson: null,
        userId: "member_invalid",
      }),
    ]);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      counterLimit: 10,
      logger,
      nudgeLimit: 1,
    });

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10,
      where: {
        nextSeq: {
          gt: 1n,
        },
      },
    }));
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "hosted-mailbox-lag-sweeper",
      timeoutMs: 5000,
      userId: "member_lag_1",
    });
    expect(result).toEqual({
      candidateCounters: 5,
      currentCounters: 1,
      invalidLaneCounters: 1,
      laggedCounters: 3,
      laggedUsers: 2,
      nudgeAccepted: 1,
      nudgeAttempted: 1,
      nudgeLimit: 1,
      nudgeNotAccepted: 0,
      skippedLaggedUsers: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper nudging runner for mailbox lag.",
      expect.objectContaining({
        userId: "member_lag_1",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper skipped lagged users after nudge limit.",
      {
        nudgeLimit: 1,
        skippedLaggedUsers: 1,
      },
    );
  });

  it("logs a warning when a lag nudge is not accepted", async () => {
    mocks.findMany.mockResolvedValue([
      buildCounter({
        lane: "conversation",
        nextSeq: 4n,
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
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
    });

    expect(result.nudgeNotAccepted).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper runner nudge was not accepted.",
      {
        configured: true,
        errorCode: "TimeoutError",
        userId: "member_lag_1",
      },
    );
  });
});

function buildCounter(input: {
  lane: string;
  nextSeq: bigint;
  redactedStatusJson: Record<string, unknown> | null;
  userId: string;
}) {
  return {
    lane: input.lane,
    member: {
      hostedWorkspace: {
        checkpointedAt: new Date("2026-05-02T00:00:00.000Z"),
        redactedStatusJson: input.redactedStatusJson,
      },
    },
    nextSeq: input.nextSeq,
    updatedAt: new Date("2026-05-02T00:01:00.000Z"),
    userId: input.userId,
  };
}
