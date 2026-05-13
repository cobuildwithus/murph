import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface MockAssistantNudgeResult {
  accepted: boolean;
  alarmScheduled: boolean | null;
  alreadyRunning: boolean | null;
  configured: boolean;
  errorCode: string | null;
  immediateDriveStarted: boolean | null;
  inFlight: boolean | null;
  nextAlarmAtPresent: boolean | null;
  usageGateDenied: boolean;
}

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  hostedWorkspaceFindMany: vi.fn(),
  getPrisma: vi.fn(),
  mailboxFindFirst: vi.fn(),
  nudgeHostedAssistantRunnerUserBestEffortResult: vi.fn(async (
    input: { aiUsageAllowDecision?: unknown; context?: string; timeoutMs?: number; userId: string },
  ): Promise<MockAssistantNudgeResult> => {
    void input;
    return {
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
      usageGateDenied: false,
    };
  }),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
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
        findFirst: mocks.mailboxFindFirst,
        groupBy: mocks.groupBy,
      },
      hostedWorkspace: {
        findMany: mocks.hostedWorkspaceFindMany,
      },
    });
    mocks.mailboxFindFirst.mockResolvedValue({
      updatedAt: new Date("2026-05-02T00:01:00.000Z"),
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: true,
      inFlight: false,
      nextAlarmAtPresent: true,
    });
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockImplementation(async (input) => ({
      ...await mocks.nudgeHostedRunnerUserBestEffortResult(input),
      usageGateDenied: false,
    }));
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

  it("nudges when only foreground import logs reached mailbox high water", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 457n,
        userId: "member_foreground_import",
      }),
      buildHighWater({
        lane: "system",
        maxSeq: 6n,
        userId: "member_foreground_import",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "444",
          hostedMailboxSystemImportedSeq: "6",
        },
        userId: "member_foreground_import",
      }),
    ]);
    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:21:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      highWaterRows: 2,
      laggedUsers: 1,
      nudgeAccepted: 1,
      nudgeAttempted: 1,
      nudgeLimit: 5,
      nudgeNotAccepted: 0,
      skippedLaggedUsers: 0,
    });
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
      "Hosted mailbox lag sweeper skipped lagged users.",
      expect.objectContaining({
        eligibleLaggedUsers: 3,
        freshGraceUsers: 0,
        limitSkippedUsers: 2,
        nudgeLimit: 1,
        skippedLaggedUsers: 2,
      }),
    );
  });

  it("uses the oldest uncheckpointed item instead of the latest mailbox row", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 4n,
        updatedAt: new Date("2026-05-02T00:19:00.000Z"),
        userId: "member_steady_inbound",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "1",
        },
        userId: "member_steady_inbound",
      }),
    ]);
    mocks.mailboxFindFirst.mockResolvedValue({
      updatedAt: new Date("2026-05-02T00:01:00.000Z"),
    });

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:25:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.mailboxFindFirst).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "asc",
      },
      select: {
        updatedAt: true,
      },
      where: {
        lane: "conversation",
        laneSeq: {
          gt: 1n,
        },
        userId: "member_steady_inbound",
      },
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(result.skippedLaggedUsers).toBe(0);
  });

  it("keeps lag nudges on a bounded retry cadence after the first wide window", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 4n,
        updatedAt: new Date("2026-05-02T00:35:00.000Z"),
        userId: "member_stuck_lag",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "1",
        },
        userId: "member_stuck_lag",
      }),
    ]);
    mocks.mailboxFindFirst.mockResolvedValue({
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    });
    const logger = buildLogger();

    const skipped = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("2026-05-02T00:35:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(skipped.skippedLaggedUsers).toBe(1);

    mocks.nudgeHostedRunnerUserBestEffortResult.mockClear();
    logger.warn.mockClear();

    const eligible = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("2026-05-02T00:50:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(eligible.skippedLaggedUsers).toBe(0);
  });

  it("does not let fresh activity on one lane suppress stale lag on another lane", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 5n,
        updatedAt: new Date("2026-05-02T00:24:00.000Z"),
        userId: "member_mixed_lanes",
      }),
      buildHighWater({
        lane: "system",
        maxSeq: 2n,
        updatedAt: new Date("2026-05-02T00:01:00.000Z"),
        userId: "member_mixed_lanes",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "4",
          hostedMailboxSystemImportedSeq: "0",
        },
        userId: "member_mixed_lanes",
      }),
    ]);
    mocks.mailboxFindFirst.mockImplementation(async (query) => ({
      updatedAt: query.where.lane === "system"
        ? new Date("2026-05-02T00:01:00.000Z")
        : new Date("2026-05-02T00:24:00.000Z"),
    }));

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:25:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      laggedUsers: 1,
      nudgeAttempted: 1,
      skippedLaggedUsers: 0,
    });
  });

  it("lets fresh mailbox lag reach the normal checkpoint path before nudging", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 4n,
        updatedAt: new Date("2026-05-02T00:01:00.000Z"),
        userId: "member_recent_lag",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "0",
        },
        userId: "member_recent_lag",
      }),
    ]);

    const logger = buildLogger();

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("2026-05-02T00:05:00.000Z"),
      nudgeLimit: 5,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(result).toEqual({
      highWaterRows: 1,
      laggedUsers: 1,
      nudgeAccepted: 0,
      nudgeAttempted: 0,
      nudgeLimit: 5,
      nudgeNotAccepted: 0,
      skippedLaggedUsers: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper skipped lagged users.",
      expect.objectContaining({
        eligibleLaggedUsers: 0,
        freshGraceUsers: 1,
        limitSkippedUsers: 0,
        nudgeLimit: 5,
        skippedLaggedUsers: 1,
      }),
    );
  });

  it("does not nudge the regular runner when assistant usage is capped for conversation-only lag", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 4n,
        userId: "member_capped_lag",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "0",
        },
        userId: "member_capped_lag",
      }),
    ]);
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: true,
      errorCode: "AI_USAGE_GATE_DENIED",
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
      usageGateDenied: true,
    });

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:21:00.000Z"),
    });

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "hosted-mailbox-lag-sweeper",
      timeoutMs: 5000,
      userId: "member_capped_lag",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nudgeAttempted: 1,
      nudgeNotAccepted: 1,
    });
  });

  it("does not nudge the regular runner when capped assistant lag is mixed with system lag", async () => {
    mocks.groupBy.mockResolvedValue([
      buildHighWater({
        lane: "conversation",
        maxSeq: 4n,
        userId: "member_capped_mixed_lag",
      }),
      buildHighWater({
        lane: "system",
        maxSeq: 2n,
        userId: "member_capped_mixed_lag",
      }),
    ]);
    mocks.hostedWorkspaceFindMany.mockResolvedValue([
      buildWorkspace({
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        userId: "member_capped_mixed_lag",
      }),
    ]);
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: true,
      errorCode: "AI_USAGE_GATE_DENIED",
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
      usageGateDenied: true,
    });

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:21:00.000Z"),
    });

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "hosted-mailbox-lag-sweeper",
      timeoutMs: 5000,
      userId: "member_capped_mixed_lag",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nudgeAttempted: 1,
      nudgeNotAccepted: 1,
    });
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
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
    });
    const logger = buildLogger();

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("2026-05-02T00:21:00.000Z"),
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
  updatedAt?: Date;
  userId: string;
}) {
  return {
    _max: {
      laneSeq: input.maxSeq,
      updatedAt: input.updatedAt ?? new Date("2026-05-02T00:01:00.000Z"),
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
