import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  hostedWorkspaceFindMany: vi.fn(),
  getPrisma: vi.fn(),
  mailboxFindFirst: vi.fn(),
  signalHostedMailboxLagObservedRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxLagObservedRuntime: mocks.signalHostedMailboxLagObservedRuntime,
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
    mocks.signalHostedMailboxLagObservedRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_lag_1",
    });
  });

  it("signals lagged users from mailbox item high-water rows", async () => {
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
      signalLimit: 5,
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
    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledWith({
      userId: "member_lag_1",
    });
    expect(result).toEqual({
      highWaterRows: 3,
      laggedUsers: 1,
      signalAccepted: 1,
      signalAttempted: 1,
      signalFailed: 0,
      signalLimit: 5,
      skippedLaggedUsers: 0,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper signaling Temporal for mailbox lag.",
      expect.objectContaining({
        userFingerprint: expect.stringMatching(/^[0-9a-f]{12}$/u),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_lag_1");
  });

  it("signals when only foreground import logs reached mailbox high water", async () => {
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
      signalLimit: 5,
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      highWaterRows: 2,
      laggedUsers: 1,
      signalAccepted: 1,
      signalAttempted: 1,
      signalFailed: 0,
      signalLimit: 5,
      skippedLaggedUsers: 0,
    });
  });

  it("rotates the signal window when lagged users exceed the per-run limit", async () => {
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
      signalLimit: 1,
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledWith(
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
        signalLimit: 1,
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
      signalLimit: 5,
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
    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledTimes(1);
    expect(result.skippedLaggedUsers).toBe(0);
  });

  it("keeps lag signals on a bounded retry cadence after the first wide window", async () => {
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
      signalLimit: 5,
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).not.toHaveBeenCalled();
    expect(skipped.skippedLaggedUsers).toBe(1);

    mocks.signalHostedMailboxLagObservedRuntime.mockClear();
    logger.warn.mockClear();

    const eligible = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("2026-05-02T00:50:00.000Z"),
      signalLimit: 5,
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledTimes(1);
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
      signalLimit: 5,
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      laggedUsers: 1,
      signalAttempted: 1,
      skippedLaggedUsers: 0,
    });
  });

  it("lets fresh mailbox lag reach the normal checkpoint path before signaling", async () => {
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
      signalLimit: 5,
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).not.toHaveBeenCalled();
    expect(result).toEqual({
      highWaterRows: 1,
      laggedUsers: 1,
      signalAccepted: 0,
      signalAttempted: 0,
      signalFailed: 0,
      signalLimit: 5,
      skippedLaggedUsers: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper skipped lagged users.",
      expect.objectContaining({
        eligibleLaggedUsers: 0,
        freshGraceUsers: 1,
        limitSkippedUsers: 0,
        signalLimit: 5,
        skippedLaggedUsers: 1,
      }),
    );
  });

  it("signals Temporal for conversation-only lag without signed usage decisions", async () => {
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

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:21:00.000Z"),
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledWith({
      userId: "member_capped_lag",
    });
    expect(result).toMatchObject({
      signalAccepted: 1,
      signalAttempted: 1,
      signalFailed: 0,
    });
  });

  it("signals Temporal when conversation lag is mixed with system lag", async () => {
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

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger: buildLogger(),
      now: new Date("2026-05-02T00:21:00.000Z"),
    });

    expect(mocks.signalHostedMailboxLagObservedRuntime).toHaveBeenCalledWith({
      userId: "member_capped_mixed_lag",
    });
    expect(result).toMatchObject({
      signalAccepted: 1,
      signalAttempted: 1,
      signalFailed: 0,
    });
  });

  it("logs a warning when a lag signal fails", async () => {
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
    const error = new Error("network details are intentionally not logged");
    error.name = "TemporalUnavailable";
    mocks.signalHostedMailboxLagObservedRuntime.mockRejectedValueOnce(error);
    const logger = buildLogger();

    const result = await lagSweeper.runHostedMailboxLagSweeper({
      logger,
      now: new Date("2026-05-02T00:21:00.000Z"),
    });

    expect(result.signalFailed).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted mailbox lag sweeper Temporal signal failed.",
      {
        errorCode: "TemporalUnavailable",
        userFingerprint: expect.stringMatching(/^[0-9a-f]{12}$/u),
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("member_lag_1");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("network details");
  });

  it("does not import Cloudflare runner nudge helpers", async () => {
    const source = await readFile(
      new URL("../src/lib/hosted-mailbox/lag-sweeper.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("hosted-runner/assistant-nudge");
    expect(source).not.toContain("hosted-runner/control");
    expect(source).not.toContain([
      "nudgeHosted",
      "AssistantRunner",
      "UserBestEffortResult",
    ].join(""));
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
