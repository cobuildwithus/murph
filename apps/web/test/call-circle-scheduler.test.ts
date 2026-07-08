import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendCallCircleConfirmNotificationTx: vi.fn(),
  appendCallCircleHandoffNotificationTx: vi.fn(),
  appendCallCircleOutcomeNotificationTx: vi.fn(),
  appendCallCircleSetupNotificationTx: vi.fn(),
  canAppendCallCircleSetupNotification: vi.fn(),
  canUseActiveCallCircleParticipant: vi.fn(),
  canUseActiveCallCircleParticipantPair: vi.fn(),
  createCallCircleMatchProposal: vi.fn(),
  expirePastCallCircleMatches: vi.fn(),
  listCallCircleEligibleParticipants: vi.fn(),
  listRecentCallCircleMatches: vi.fn(),
  markCallCircleMatchAmAsked: vi.fn(),
  markCallCircleMatchFinalAsked: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  proposeCallCircleMatches: vi.fn(),
  readExistingCallCircleNotificationSignalTx: vi.fn(),
  readLastCallCirclePartnerMemberIds: vi.fn(),
  readCallCircleNotificationSignal: vi.fn(),
  readCallCircleCalendarAvailability: vi.fn(),
  readCallCircleNotificationPreflightTx: vi.fn(),
  signalCallCircleNotificationRuntimesBestEffort: vi.fn(),
  startCallCircleConnectorCall: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  canAppendCallCircleSetupNotification: mocks.canAppendCallCircleSetupNotification,
  canUseActiveCallCircleParticipant: mocks.canUseActiveCallCircleParticipant,
  canUseActiveCallCircleParticipantPair: mocks.canUseActiveCallCircleParticipantPair,
  listCallCircleEligibleParticipants: mocks.listCallCircleEligibleParticipants,
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE: {
    NOT: [
      { status: "canceled" },
      {
        outcome: "notification_blocked",
        status: "dropped",
      },
    ],
  },
  createCallCircleMatchProposal: mocks.createCallCircleMatchProposal,
  expirePastCallCircleMatches: mocks.expirePastCallCircleMatches,
  listRecentCallCircleMatches: mocks.listRecentCallCircleMatches,
  markCallCircleMatchAmAsked: mocks.markCallCircleMatchAmAsked,
  markCallCircleMatchFinalAsked: mocks.markCallCircleMatchFinalAsked,
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
  readLastCallCirclePartnerMemberIds: mocks.readLastCallCirclePartnerMemberIds,
}));

vi.mock("@/src/lib/call-circle/matcher", () => ({
  proposeCallCircleMatches: mocks.proposeCallCircleMatches,
}));

vi.mock("@/src/lib/call-circle/free-busy", () => ({
  readCallCircleCalendarAvailability: mocks.readCallCircleCalendarAvailability,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleConfirmNotificationTx: mocks.appendCallCircleConfirmNotificationTx,
  appendCallCircleHandoffNotificationTx: mocks.appendCallCircleHandoffNotificationTx,
  appendCallCircleOutcomeNotificationTx: mocks.appendCallCircleOutcomeNotificationTx,
  appendCallCircleSetupNotificationTx: mocks.appendCallCircleSetupNotificationTx,
  buildCallCircleHandoffNotificationEventId: ({ matchId, memberId }: {
    matchId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:handoff:${matchId}:${memberId}`,
  buildCallCircleOutcomeNotificationEventId: ({ matchId, memberId }: {
    matchId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:outcome:${matchId}:${memberId}`,
  buildCallCircleSetupNotificationEventId: ({ groupId, memberId }: {
    groupId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:setup:${groupId}:${memberId}`,
  readExistingCallCircleNotificationSignalTx: mocks.readExistingCallCircleNotificationSignalTx,
  readCallCircleNotificationSignal: mocks.readCallCircleNotificationSignal,
  readCallCircleNotificationPreflightTx: mocks.readCallCircleNotificationPreflightTx,
  signalCallCircleNotificationRuntimesBestEffort: mocks.signalCallCircleNotificationRuntimesBestEffort,
}));

vi.mock("@/src/lib/call-circle/connector-call", () => ({
  startCallCircleConnectorCall: mocks.startCallCircleConnectorCall,
}));

import {
  runCallCircleScheduler,
} from "@/src/lib/call-circle/scheduler";

describe("runCallCircleScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.expirePastCallCircleMatches.mockResolvedValue(0);
    mocks.listCallCircleEligibleParticipants.mockResolvedValue([]);
    mocks.listRecentCallCircleMatches.mockResolvedValue([]);
    mocks.proposeCallCircleMatches.mockReturnValue([]);
    mocks.canAppendCallCircleSetupNotification.mockResolvedValue(true);
    mocks.canUseActiveCallCircleParticipant.mockResolvedValue(true);
    mocks.readLastCallCirclePartnerMemberIds.mockResolvedValue(new Map());
    mocks.createCallCircleMatchProposal.mockResolvedValue(null);
    mocks.markCallCircleMatchAmAsked.mockResolvedValue(true);
    mocks.markCallCircleMatchFinalAsked.mockResolvedValue(true);
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(true);
    mocks.appendCallCircleConfirmNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_confirm",
      status: "sent",
    });
    mocks.appendCallCircleHandoffNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_handoff",
      status: "sent",
    });
    mocks.appendCallCircleOutcomeNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_outcome",
      status: "sent",
    });
    mocks.appendCallCircleSetupNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_setup",
      status: "sent",
    });
    mocks.readCallCircleNotificationSignal.mockImplementation(({ memberId, notification }) =>
      notification.status === "sent" && notification.mailboxItemId
        ? { mailboxItemId: notification.mailboxItemId, memberId }
        : null);
    mocks.readExistingCallCircleNotificationSignalTx.mockImplementation(async ({
      eventId,
      memberId,
      tx,
    }: {
      eventId: string;
      memberId: string;
      tx: {
        hostedMailboxItem: {
          findUnique(input: unknown): Promise<{ consumedAt: Date | null; id: string } | null>;
        };
      };
    }) => {
      const existing = await tx.hostedMailboxItem.findUnique({
        select: {
          consumedAt: true,
          id: true,
        },
        where: {
          userId_dedupeKey: {
            dedupeKey: eventId,
            userId: memberId,
          },
        },
      });
      if (!existing) return { exists: false, signal: null };
      if (existing.consumedAt) return { exists: true, signal: null };
      return {
        exists: true,
        signal: {
          mailboxItemId: existing.id,
          memberId,
        },
      };
    });
    mocks.readCallCircleCalendarAvailability.mockResolvedValue("unknown");
    mocks.readCallCircleNotificationPreflightTx.mockResolvedValue({ status: "ok" });
    mocks.signalCallCircleNotificationRuntimesBestEffort.mockResolvedValue(undefined);
    mocks.startCallCircleConnectorCall.mockResolvedValue({
      phoneCallId: "hpc_123",
      status: "calling",
    });
  });

  it("expires old matches and creates disjoint weekly proposals for eligible group members", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [{ groupId: "hgrp_123" }],
      recentWeeklyMatchCount: 0,
    });
    mocks.expirePastCallCircleMatches.mockResolvedValue(2);
    mocks.listCallCircleEligibleParticipants.mockResolvedValue([{
      groupId: "hgrp_123",
      lastMatchedAt: null,
      memberId: "member_a",
      preferences: { excludeMemberIds: [], windows: [] },
      timeZone: "UTC",
    }, {
      groupId: "hgrp_123",
      lastMatchedAt: null,
      memberId: "member_b",
      preferences: { excludeMemberIds: [], windows: [] },
      timeZone: "UTC",
    }, {
      groupId: "hgrp_123",
      lastMatchedAt: null,
      memberId: "member_c",
      preferences: { excludeMemberIds: [], windows: [] },
      timeZone: "UTC",
    }, {
      groupId: "hgrp_123",
      lastMatchedAt: null,
      memberId: "member_d",
      preferences: { excludeMemberIds: [], windows: [] },
      timeZone: "UTC",
    }]);
    mocks.proposeCallCircleMatches.mockReturnValue([
      {
        memberAId: "member_a",
        memberBId: "member_b",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      {
        memberAId: "member_c",
        memberBId: "member_d",
        windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
      },
    ]);
    mocks.createCallCircleMatchProposal.mockResolvedValue({ id: "hccm_123" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      expired: 2,
      proposals: 2,
    });

    expect(prisma.hostedCallCircleParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ["groupId"],
        orderBy: { groupId: "asc" },
        take: 100,
        where: expect.objectContaining({
          status: "enrolled",
        }),
      }),
    );
    expect(prisma.hostedCallCircleMatch.count).not.toHaveBeenCalled();
    expect(mocks.createCallCircleMatchProposal).toHaveBeenNthCalledWith(1, {
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_a",
        memberBId: "member_b",
        now,
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma,
    });
    expect(mocks.createCallCircleMatchProposal).toHaveBeenNthCalledWith(2, {
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_c",
        memberBId: "member_d",
        now,
        windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
      },
      prisma,
    });
  });

  it("pages weekly proposal groups so later eligible groups are not starved", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const firstGroupPage = Array.from({ length: 100 }, (_, index) => ({
      groupId: `hgrp_${String(index + 1).padStart(3, "0")}`,
    }));
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groupPages: [
        firstGroupPage,
        [{ groupId: "hgrp_101" }],
      ],
      groups: [],
      recentWeeklyMatchCount: 0,
    });
    mocks.listCallCircleEligibleParticipants.mockImplementation(async ({
      groupId,
    }: {
      groupId: string;
    }) => groupId === "hgrp_101"
      ? [
          callCircleEligibleParticipant({ groupId, memberId: "member_a" }),
          callCircleEligibleParticipant({ groupId, memberId: "member_b" }),
        ]
      : []);
    mocks.proposeCallCircleMatches.mockImplementation(({
      participants,
    }: {
      participants: Array<{ memberId: string }>;
    }) => participants.length === 2
      ? [{
          memberAId: "member_a",
          memberBId: "member_b",
          windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
          windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
        }]
      : []);
    mocks.createCallCircleMatchProposal.mockResolvedValue({ id: "hccm_123" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      proposals: 1,
    });

    expect(prisma.hostedCallCircleParticipant.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          groupId: { gt: "hgrp_100" },
        }),
      }),
    );
    expect(mocks.readLastCallCirclePartnerMemberIds).toHaveBeenCalledWith({
      groupId: "hgrp_101",
      memberIds: ["member_a", "member_b"],
      prisma,
    });
    expect(mocks.createCallCircleMatchProposal).toHaveBeenCalledWith({
      proposal: {
        groupId: "hgrp_101",
        memberAId: "member_a",
        memberBId: "member_b",
        now,
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma,
    });
  });

  it("filters notification-blocked participants before weekly matching", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [{ groupId: "hgrp_123" }],
      recentWeeklyMatchCount: 0,
    });
    mocks.listCallCircleEligibleParticipants.mockResolvedValue([
      callCircleEligibleParticipant({ memberId: "member_a" }),
      callCircleEligibleParticipant({ memberId: "member_b" }),
      callCircleEligibleParticipant({ memberId: "member_c" }),
    ]);
    mocks.readCallCircleNotificationPreflightTx.mockImplementation(async ({
      memberId,
    }: {
      memberId: string;
    }) => memberId === "member_a"
      ? { reason: "missing_recent_inbound", status: "blocked" }
      : { route: { channel: "linq" }, status: "ok" });
    mocks.proposeCallCircleMatches.mockReturnValue([{
      memberAId: "member_b",
      memberBId: "member_c",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    }]);
    mocks.createCallCircleMatchProposal.mockResolvedValue({ id: "hccm_123" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      proposals: 1,
    });

    expect(mocks.proposeCallCircleMatches).toHaveBeenCalledWith({
      now,
      participants: [
        callCircleEligibleParticipant({
          lastPartnerMemberId: null,
          memberId: "member_b",
        }),
        callCircleEligibleParticipant({
          lastPartnerMemberId: null,
          memberId: "member_c",
        }),
      ],
      recentMatches: [],
    });
    expect(mocks.createCallCircleMatchProposal).toHaveBeenCalledWith({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_b",
        memberBId: "member_c",
        now,
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma,
    });
    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
  });

  it("filters inactive participants before matching so stale rows cannot consume active members", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [{ groupId: "hgrp_123" }],
      recentWeeklyMatchCount: 0,
    });
    mocks.listCallCircleEligibleParticipants.mockResolvedValue([
      callCircleEligibleParticipant({ memberId: "member_a" }),
      callCircleEligibleParticipant({ memberId: "member_b" }),
      callCircleEligibleParticipant({ memberId: "member_c" }),
    ]);
    mocks.canUseActiveCallCircleParticipant.mockImplementation(async ({
      memberId,
    }: {
      memberId: string;
    }) => memberId !== "member_a");
    mocks.proposeCallCircleMatches.mockReturnValue([{
      memberAId: "member_b",
      memberBId: "member_c",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    }]);
    mocks.createCallCircleMatchProposal.mockResolvedValue({ id: "hccm_123" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      proposals: 1,
    });

    expect(mocks.proposeCallCircleMatches).toHaveBeenCalledWith({
      now,
      participants: [
        callCircleEligibleParticipant({
          lastPartnerMemberId: null,
          memberId: "member_b",
        }),
        callCircleEligibleParticipant({
          lastPartnerMemberId: null,
          memberId: "member_c",
        }),
      ],
      recentMatches: [],
    });
    expect(mocks.createCallCircleMatchProposal).toHaveBeenCalledWith({
      proposal: expect.objectContaining({
        memberAId: "member_b",
        memberBId: "member_c",
      }),
      prisma,
    });
  });

  it("pages due matches so later actionable confirmations are not stranded behind inert rows", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");
    const firstDuePage = Array.from({ length: 100 }, (_, index) =>
      schedulerMatch({
        amAskedAt: new Date("2026-07-06T09:00:00.000Z"),
        id: `hccm_inert_${String(index + 1).padStart(3, "0")}`,
        status: "asking",
        windowEndAt,
        windowStartAt,
      })
    );
    const actionable = schedulerMatch({
      id: "hccm_actionable_101",
      status: "proposed",
      windowEndAt,
      windowStartAt,
    });
    const prisma = createSchedulerPrisma({
      dueMatchPages: [
        firstDuePage,
        [actionable],
      ],
      dueMatches: [],
      groups: [],
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedMorning: 1,
    });

    expect(prisma.hostedCallCircleMatch.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { windowStartAt: { gt: windowStartAt } },
                {
                  id: { gt: "hccm_inert_100" },
                  windowStartAt,
                },
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(mocks.markCallCircleMatchAmAsked).toHaveBeenCalledWith({
      matchId: "hccm_actionable_101",
      now,
      prisma: expect.any(Object),
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledTimes(2);
  });

  it("drops a morning ask without sending when notification preflight is unavailable", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        status: "proposed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });
    mocks.readCallCircleCalendarAvailability.mockResolvedValue("free");
    mocks.readCallCircleNotificationPreflightTx
      .mockResolvedValueOnce({ status: "ok" })
      .mockResolvedValueOnce({ status: "unavailable", unavailableReason: "route_unavailable" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedMorning: 0,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "notification_blocked",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.readCallCircleCalendarAvailability).not.toHaveBeenCalled();
    expect(mocks.markCallCircleMatchAmAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("sends morning confirmations for cross-timezone pairs during shared local daytime", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        memberATimeZone: "America/New_York",
        memberBTimeZone: "America/Los_Angeles",
        status: "proposed",
        windowEndAt: new Date("2026-07-06T20:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T20:00:00.000Z"),
      })],
      groups: [],
      tx,
    });
    mocks.readCallCircleCalendarAvailability.mockResolvedValue("free");

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedMorning: 1,
    });

    expect(mocks.markCallCircleMatchAmAsked).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma: tx,
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_a",
        windowStartAt: new Date("2026-07-06T20:00:00.000Z"),
      }),
    );
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_b",
        windowStartAt: new Date("2026-07-06T20:00:00.000Z"),
      }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_confirm", memberId: "member_a" },
      { mailboxItemId: "mailbox_confirm", memberId: "member_b" },
    ]);
  });

  it("sends only the pending side after a deferred counter", async () => {
    const now = new Date("2026-07-07T12:00:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        sideAResponse: "countered",
        sideBResponse: "pending",
        status: "asking",
        windowEndAt: new Date("2026-07-07T13:30:00.000Z"),
        windowStartAt: new Date("2026-07-07T13:00:00.000Z"),
      })],
      groups: [],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedMorning: 1,
    });

    expect(mocks.markCallCircleMatchAmAsked).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma: tx,
    });
    expect(mocks.readCallCircleNotificationPreflightTx).toHaveBeenCalledTimes(2);
    expect(mocks.readCallCircleNotificationPreflightTx).toHaveBeenNthCalledWith(1, {
      memberId: "member_b",
      now,
      tx,
    });
    expect(mocks.readCallCircleNotificationPreflightTx).toHaveBeenNthCalledWith(2, {
      memberId: "member_b",
      now,
      tx,
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_b",
        stage: "am",
        windowStartAt: new Date("2026-07-07T13:00:00.000Z"),
      }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_confirm", memberId: "member_b" },
    ]);
  });

  it("wakes both members after final confirmations are appended", async () => {
    const now = new Date("2026-07-06T14:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        status: "both_confirmed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedFinal: 1,
    });

    expect(mocks.markCallCircleMatchFinalAsked).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma: tx,
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_confirm", memberId: "member_a" },
      { mailboxItemId: "mailbox_confirm", memberId: "member_b" },
    ]);
  });

  it("cancels a pending match before asking when a participant is no longer active", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        status: "proposed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(false);

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedMorning: 0,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "participant_unavailable",
      prisma: tx,
      status: "canceled",
    });
    expect(mocks.readCallCircleCalendarAvailability).not.toHaveBeenCalled();
    expect(mocks.readCallCircleNotificationPreflightTx).not.toHaveBeenCalled();
    expect(mocks.markCallCircleMatchAmAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("drops a morning ask after gated calendar busy without notifying", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        status: "proposed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });
    mocks.readCallCircleCalendarAvailability
      .mockResolvedValueOnce("free")
      .mockResolvedValueOnce("busy");

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedMorning: 0,
    });

    expect(mocks.readCallCircleNotificationPreflightTx).toHaveBeenCalledTimes(2);
    expect(mocks.readCallCircleCalendarAvailability).toHaveBeenCalledTimes(2);
    expect(mocks.readCallCircleNotificationPreflightTx.mock.invocationCallOrder[1])
      .toBeLessThan(mocks.readCallCircleCalendarAvailability.mock.invocationCallOrder[0]);
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "calendar_busy",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.markCallCircleMatchAmAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("drops a final confirmation when either notification preflight is blocked", async () => {
    const now = new Date("2026-07-06T14:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        status: "both_confirmed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });
    mocks.readCallCircleNotificationPreflightTx
      .mockResolvedValueOnce({ status: "ok" })
      .mockResolvedValueOnce({ reason: "missing_route", status: "blocked" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      askedFinal: 0,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "notification_blocked",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.markCallCircleMatchFinalAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("attempts the connector only during the matched call window", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        status: "both_confirmed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: now,
      })],
      groups: [],
    });
    const connectorStarter = vi.fn(async () => ({
      phoneCallId: "hpc_123",
      status: "calling" as const,
    }));

    await expect(runCallCircleScheduler({
      connectorStarter,
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      bridgeAttempts: 1,
    });

    expect(connectorStarter).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma,
    });
  });

  it("retries an attached unstarted bridge during the call window", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        phoneCall: {
          analyzedAt: null,
          id: "hpc_starting",
          providerCallId: null,
          status: "starting",
        },
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: now,
      })],
      groups: [],
    });
    const connectorStarter = vi.fn(async () => ({
      phoneCallId: "hpc_starting",
      status: "ignored" as const,
    }));

    await expect(runCallCircleScheduler({
      connectorStarter,
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      bridgeAttempts: 1,
    });

    expect(connectorStarter).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma,
    });
  });

  it("retries setup asks for enrolled participants that have not written preferences", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      pendingSetupParticipants: [{
        groupId: "hgrp_123",
        memberId: "member_a",
      }],
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      setupAsks: 1,
    });

    expect(prisma.hostedCallCircleParticipant.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "enrolled",
        }),
      }),
    );
    expect(mocks.appendCallCircleSetupNotificationTx).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_a",
      now,
      tx: expect.any(Object),
    });
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_setup",
      memberId: "member_a",
    }]);
  });

  it("pages setup asks so later eligible members are not starved by blocked rows", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const firstSetupPage = Array.from({ length: 100 }, (_, index) =>
      pendingSetupParticipant(`member_${String(index + 1).padStart(3, "0")}`, index)
    );
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      pendingSetupParticipantPages: [
        firstSetupPage,
        [pendingSetupParticipant("member_101", 100)],
      ],
    });
    mocks.appendCallCircleSetupNotificationTx.mockImplementation(async ({
      memberId,
    }: {
      memberId: string;
    }) => memberId === "member_101"
      ? { mailboxItemId: "mailbox_setup_101", status: "sent" }
      : { reason: "missing_recent_inbound", status: "blocked" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      setupAsks: 1,
    });

    expect(prisma.hostedCallCircleParticipant.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
    expect(mocks.appendCallCircleSetupNotificationTx).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_101",
      now,
      tx: expect.any(Object),
    });
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_setup_101",
      memberId: "member_101",
    }]);
  });

  it("does not append setup asks after member access or group membership becomes inactive", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const tx = {
      hostedMailboxItem: {
        findUnique: vi.fn(async () => null),
      },
    };
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      pendingSetupParticipants: [{
        groupId: "hgrp_123",
        memberId: "member_a",
      }],
      tx,
    });
    mocks.canAppendCallCircleSetupNotification.mockResolvedValueOnce(false);

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      setupAsks: 0,
    });

    expect(mocks.canAppendCallCircleSetupNotification).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: tx,
    });
    expect(mocks.appendCallCircleSetupNotificationTx).not.toHaveBeenCalled();
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalledWith([
      expect.objectContaining({ memberId: "member_a" }),
    ]);
  });

  it("keeps off-hours setup asks retryable without appending a wake", async () => {
    const now = new Date("2026-07-06T03:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      pendingSetupParticipants: [{
        groupId: "hgrp_123",
        memberId: "member_a",
      }],
    });
    mocks.appendCallCircleSetupNotificationTx.mockResolvedValueOnce({
      reason: "quiet_hours",
      status: "blocked",
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      setupAsks: 0,
    });

    expect(mocks.appendCallCircleSetupNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "hgrp_123",
        memberId: "member_a",
      }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalledWith([
      expect.objectContaining({ memberId: "member_a" }),
    ]);
  });

  it("does not bridge when the final confirmation ask has not completed", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: null,
        status: "both_confirmed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: now,
      })],
      groups: [],
    });
    const connectorStarter = vi.fn(async () => ({
      phoneCallId: "hpc_123",
      status: "calling" as const,
    }));

    await expect(runCallCircleScheduler({
      connectorStarter,
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      bridgeAttempts: 0,
    });

    expect(connectorStarter).not.toHaveBeenCalled();
  });

  it("retries a claimed bridge with no attached phone call during the matched window", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: now,
      })],
      groups: [],
    });
    const connectorStarter = vi.fn(async () => ({
      phoneCallId: "hpc_123",
      status: "calling" as const,
    }));

    await expect(runCallCircleScheduler({
      connectorStarter,
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      bridgeAttempts: 1,
    });

    expect(connectorStarter).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma,
    });
  });

  it("hands off a claimed bridge with no attached phone call after the window", async () => {
    const now = new Date("2026-07-06T15:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 1,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_handoff", memberId: "member_a" },
      { mailboxItemId: "mailbox_handoff", memberId: "member_b" },
    ]);
  });

  it("terminalizes a bridge even when one handoff notification is blocked", async () => {
    const now = new Date("2026-07-06T03:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T02:45:00.000Z"),
        status: "bridging",
        windowEndAt: new Date("2026-07-06T03:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T03:00:00.000Z"),
      })],
      groups: [],
      tx,
    });
    mocks.readCallCircleNotificationPreflightTx
      .mockResolvedValueOnce({ reason: "quiet_hours", status: "blocked" })
      .mockResolvedValueOnce({ route: { channel: "linq" }, status: "ok" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 1,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_b" }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_handoff", memberId: "member_b" },
    ]);
  });

  it("hands off a final-confirmed match after a missed call window before expiry", async () => {
    const now = new Date("2026-07-06T15:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      missedHandoffMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        status: "both_confirmed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      expired: 0,
      handoffs: 1,
    });

    expect(prisma.hostedCallCircleMatch.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        finalAskedAt: { not: null },
        phoneCallId: null,
        status: "both_confirmed",
        windowEndAt: {
          gt: new Date("2026-06-29T15:45:00.000Z"),
          lte: now,
        },
      }),
    }));
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.markCallCircleMatchOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.expirePastCallCircleMatches.mock.invocationCallOrder[0]);
  });

  it("hands off an attached unstarted bridge after the normal due window is missed", async () => {
    const now = new Date("2026-07-06T17:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        phoneCall: {
          analyzedAt: null,
          id: "hpc_starting",
          providerCallId: null,
          status: "starting",
        },
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 1,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: "hpc_starting",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(2);
    expect(prisma.hostedCallCircleMatch.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{
            status: "bridging",
            windowEndAt: {
              gt: new Date("2026-06-29T17:45:00.000Z"),
            },
          }]),
        }),
      }),
    );
  });

  it("retries terminal Call Circle outcome notifications that were not appended yet", async () => {
    const now = new Date("2026-07-06T17:00:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      terminalNotificationMatches: [schedulerMatch({
        outcome: "completed",
        status: "completed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      resultNotifications: 1,
    });

    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "hccm_123",
        memberId: "member_a",
      }),
    );
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "hccm_123",
        memberId: "member_b",
      }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_outcome", memberId: "member_a" },
      { mailboxItemId: "mailbox_outcome", memberId: "member_b" },
    ]);
  });

  it("pages terminal result notifications past newer rows that already have dedupe records", async () => {
    const now = new Date("2026-07-06T17:00:00.000Z");
    const firstTerminalPage = Array.from({ length: 100 }, (_, index) =>
      schedulerMatch({
        endedAt: new Date("2026-07-06T16:00:00.000Z"),
        id: `hccm_terminal_${String(index + 1).padStart(3, "0")}`,
        outcome: "completed",
        status: "completed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })
    );
    const olderMissingNotification = schedulerMatch({
      endedAt: new Date("2026-07-06T15:00:00.000Z"),
      id: "hccm_terminal_101",
      outcome: "completed",
      status: "completed",
      windowEndAt: new Date("2026-07-06T14:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
    });
    let existingReadCount = 0;
    const tx = {
      hostedMailboxItem: {
        findUnique: vi.fn(async () => {
          existingReadCount += 1;
          return existingReadCount <= 200
            ? { consumedAt: new Date("2026-07-06T16:05:00.000Z"), id: "mailbox_existing" }
            : null;
        }),
      },
    };
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      terminalNotificationMatchPages: [
        firstTerminalPage,
        [olderMissingNotification],
      ],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      resultNotifications: 1,
    });

    expect(prisma.hostedCallCircleMatch.findMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { endedAt: { lt: new Date("2026-07-06T16:00:00.000Z") } },
                {
                  endedAt: new Date("2026-07-06T16:00:00.000Z"),
                  windowEndAt: { lt: new Date("2026-07-06T15:30:00.000Z") },
                },
                {
                  endedAt: new Date("2026-07-06T16:00:00.000Z"),
                  id: { gt: "hccm_terminal_100" },
                  windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
                },
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "hccm_terminal_101",
      }),
    );
  });

  it("re-signals unconsumed terminal Call Circle notifications without appending duplicates", async () => {
    const now = new Date("2026-07-06T17:00:00.000Z");
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ consumedAt: null, id: "mailbox_existing_a" })
      .mockResolvedValueOnce({ consumedAt: null, id: "mailbox_existing_b" });
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      terminalNotificationMatches: [schedulerMatch({
        outcome: "completed",
        status: "completed",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      tx: {
        hostedMailboxItem: {
          findUnique,
        },
      },
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      resultNotifications: 1,
    });

    expect(mocks.appendCallCircleOutcomeNotificationTx).not.toHaveBeenCalled();
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_existing_a", memberId: "member_a" },
      { mailboxItemId: "mailbox_existing_b", memberId: "member_b" },
    ]);
  });

  it("keeps terminal Call Circle handoff notifications retryable per blocked member", async () => {
    const now = new Date("2026-07-06T03:45:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [],
      groups: [],
      terminalNotificationMatches: [schedulerMatch({
        outcome: "text_handoff",
        status: "dropped",
        windowEndAt: new Date("2026-07-06T03:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T03:00:00.000Z"),
      })],
    });
    mocks.readCallCircleNotificationPreflightTx
      .mockResolvedValueOnce({ reason: "quiet_hours", status: "blocked" })
      .mockResolvedValueOnce({ route: { channel: "linq" }, status: "ok" });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      resultNotifications: 1,
    });

    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_b" }),
    );
  });

  it("does not hand off an ended bridge before phone-call analysis decides the outcome", async () => {
    const now = new Date("2026-07-06T15:45:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        phoneCall: {
          analyzedAt: null,
          endedAt: new Date("2026-07-06T15:40:00.000Z"),
          id: "hpc_123",
          providerCallId: "retell_123",
          status: "ended",
        },
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 0,
    });

    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("hands off an ended bridge when phone-call analysis never arrives", async () => {
    const now = new Date("2026-07-06T15:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        phoneCall: {
          analyzedAt: null,
          endedAt: new Date("2026-07-06T15:34:00.000Z"),
          id: "hpc_123",
          providerCallId: "retell_123",
          status: "ended",
        },
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 1,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: "hpc_123",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(2);
  });

  it("does not hand off a failed bridge before phone-call analysis decides the outcome", async () => {
    const now = new Date("2026-07-06T15:45:00.000Z");
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        phoneCall: {
          analyzedAt: null,
          endedAt: new Date("2026-07-06T15:40:00.000Z"),
          id: "hpc_123",
          providerCallId: "retell_123",
          status: "failed",
        },
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 0,
    });

    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("hands off an analyzed failed bridge", async () => {
    const now = new Date("2026-07-06T15:45:00.000Z");
    const tx = {};
    const prisma = createSchedulerPrisma({
      dueMatches: [schedulerMatch({
        phoneCall: {
          analyzedAt: new Date("2026-07-06T15:40:00.000Z"),
          id: "hpc_123",
          status: "failed",
        },
        status: "bridging",
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
      groups: [],
      tx,
    });

    await expect(runCallCircleScheduler({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      handoffs: 1,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: "hpc_123",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(2);
  });
});

function createSchedulerPrisma(input: {
  dueMatchPages?: unknown[][];
  dueMatches: unknown[];
  groups: Array<{ groupId: string }>;
  groupPages?: Array<Array<{ groupId: string }>>;
  missedHandoffMatches?: unknown[];
  pendingSetupParticipants?: unknown[];
  pendingSetupParticipantPages?: unknown[][];
  recentWeeklyMatchCount?: number;
  terminalNotificationMatchPages?: unknown[][];
  terminalNotificationMatches?: unknown[];
  tx?: unknown;
}) {
  const tx = input.tx ?? {
    hostedCallCircleParticipant: {
      count: vi.fn(async () => 1),
    },
    hostedGroupMember: {
      count: vi.fn(async () => 1),
    },
    hostedMailboxItem: {
      findUnique: vi.fn(async () => null),
    },
  };
  const dueMatchPages = input.dueMatchPages ?? [input.dueMatches];
  const terminalNotificationMatchPages = input.terminalNotificationMatchPages
    ?? [input.terminalNotificationMatches ?? []];
  let dueMatchPageIndex = 0;
  let terminalNotificationPageIndex = 0;
  const matchFindMany = vi.fn(async (args: {
    orderBy?: unknown;
    where?: {
      finalAskedAt?: unknown;
    };
  }) => {
    if (args.where?.finalAskedAt) {
      return input.missedHandoffMatches ?? [];
    }
    if (
      Array.isArray(args.orderBy)
      && args.orderBy.some((entry) =>
        typeof entry === "object"
        && entry !== null
        && "endedAt" in entry
      )
    ) {
      return terminalNotificationMatchPages[terminalNotificationPageIndex++] ?? [];
    }
    return dueMatchPages[dueMatchPageIndex++] ?? [];
  });
  const groupPages = input.groupPages ?? [input.groups];
  const setupPages = input.pendingSetupParticipantPages
    ?? [input.pendingSetupParticipants ?? []];
  let groupPageIndex = 0;
  let setupPageIndex = 0;
  const participantFindMany = vi.fn(async (args: { distinct?: unknown }) => {
    if (args.distinct) {
      return groupPages[groupPageIndex++] ?? [];
    }
    return setupPages[setupPageIndex++] ?? [];
  });
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
    hostedCallCircleMatch: {
      count: vi.fn(async () => input.recentWeeklyMatchCount ?? 0),
      findMany: matchFindMany,
    },
    hostedCallCircleParticipant: {
      findMany: participantFindMany,
    },
  };
}

function callCircleEligibleParticipant(input: {
  groupId?: string;
  lastPartnerMemberId?: string | null;
  memberId: string;
}) {
  return {
    groupId: input.groupId ?? "hgrp_123",
    lastMatchedAt: null,
    lastPartnerMemberId: input.lastPartnerMemberId,
    memberId: input.memberId,
    preferences: {
      excludeMemberIds: [],
      windows: [{
        dayOfWeek: 1,
        endLocalTime: "15:30",
        startLocalTime: "15:00",
      }],
    },
    timeZone: "UTC",
  };
}

function pendingSetupParticipant(memberId: string, index: number) {
  const at = new Date(new Date("2026-07-06T15:00:00.000Z").getTime() + index);
  return {
    createdAt: at,
    groupId: "hgrp_123",
    id: `hccp_${memberId}`,
    memberId,
    updatedAt: at,
  };
}

function schedulerMatch(input: {
  amAskedAt?: Date | null;
  endedAt?: Date | null;
  finalAskedAt?: Date | null;
  id?: string;
  memberATimeZone?: string | null;
  memberBTimeZone?: string | null;
  phoneCall?: {
    analyzedAt: Date | null;
    endedAt?: Date | null;
    id: string;
    providerCallId?: string | null;
    status: string;
  } | null;
  outcome?: string | null;
  sideAResponse?: string;
  sideBResponse?: string;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}) {
  return {
    amAskedAt: input.amAskedAt ?? null,
    endedAt: input.endedAt ?? input.windowEndAt,
    finalAskedAt: input.finalAskedAt ?? null,
    groupId: "hgrp_123",
    id: input.id ?? "hccm_123",
    memberA: { pendingActivationTimeZone: input.memberATimeZone ?? "UTC" },
    memberAId: "member_a",
    memberB: { pendingActivationTimeZone: input.memberBTimeZone ?? "UTC" },
    memberBId: "member_b",
    outcome: input.outcome ?? null,
    phoneCall: input.phoneCall
      ? {
          ...input.phoneCall,
          providerCallId: input.phoneCall.providerCallId ?? null,
        }
      : null,
    sideAResponse: input.sideAResponse ?? "pending",
    sideBResponse: input.sideBResponse ?? "pending",
    status: input.status,
    windowEndAt: input.windowEndAt,
    windowStartAt: input.windowStartAt,
  };
}
