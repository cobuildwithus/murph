import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendCallCircleConfirmNotificationTx: vi.fn(),
  appendCallCircleSetupNotificationTx: vi.fn(),
  callCircleExpiredResponseWhere: vi.fn(() => ({ responseExpired: true })),
  canUseActiveCallCircleParticipantPair: vi.fn(),
  createCallCircleMatchProposal: vi.fn(),
  dropCallCircleMatchForNotificationBlocked: vi.fn(),
  expirePastCallCircleMatches: vi.fn(),
  listCallCircleEligibleParticipants: vi.fn(),
  listCallCircleMemberIdsWithRecentMatch: vi.fn(),
  listRecentCallCircleMatches: vi.fn(),
  markCallCircleMatchAmAsked: vi.fn(),
  markCallCircleMatchFinalAsked: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  proposeCallCircleMatches: vi.fn(),
  readCallCircleMatchParticipantTimeZones: vi.fn(),
  readCallCircleNotificationPreflightTx: vi.fn(),
  readCallCircleNotificationSignal: vi.fn(),
  signalHostedAssistantNotificationsBestEffort: vi.fn(),
  startCallCircleConnectorCall: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  canUseActiveCallCircleParticipantPair: mocks.canUseActiveCallCircleParticipantPair,
  listCallCircleEligibleParticipants: mocks.listCallCircleEligibleParticipants,
  readCallCircleMatchParticipantTimeZones: mocks.readCallCircleMatchParticipantTimeZones,
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  callCircleExpiredResponseWhere: mocks.callCircleExpiredResponseWhere,
  createCallCircleMatchProposal: mocks.createCallCircleMatchProposal,
  dropCallCircleMatchForNotificationBlocked:
    mocks.dropCallCircleMatchForNotificationBlocked,
  expirePastCallCircleMatches: mocks.expirePastCallCircleMatches,
  listCallCircleMemberIdsWithRecentMatch:
    mocks.listCallCircleMemberIdsWithRecentMatch,
  listRecentCallCircleMatches: mocks.listRecentCallCircleMatches,
  markCallCircleMatchAmAsked: mocks.markCallCircleMatchAmAsked,
  markCallCircleMatchFinalAsked: mocks.markCallCircleMatchFinalAsked,
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
}));

vi.mock("@/src/lib/call-circle/matcher", () => ({
  proposeCallCircleMatches: mocks.proposeCallCircleMatches,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleConfirmNotificationTx: mocks.appendCallCircleConfirmNotificationTx,
  appendCallCircleSetupNotificationTx: mocks.appendCallCircleSetupNotificationTx,
  buildCallCircleSetupNotificationEventIdPrefix: ({ groupId, memberId }: {
    groupId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:setup:${groupId}:${memberId}`,
  readCallCircleNotificationPreflightTx: mocks.readCallCircleNotificationPreflightTx,
  readCallCircleNotificationSignal: mocks.readCallCircleNotificationSignal,
}));

vi.mock("@/src/lib/hosted-execution/assistant-notifications", () => ({
  signalHostedAssistantNotificationsBestEffort:
    mocks.signalHostedAssistantNotificationsBestEffort,
}));

vi.mock("@/src/lib/call-circle/connector-call", () => ({
  startCallCircleConnectorCall: mocks.startCallCircleConnectorCall,
}));

import { runCallCircleScheduler } from "@/src/lib/call-circle/scheduler";

describe("runCallCircleScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendCallCircleConfirmNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_confirm",
      status: "sent",
    });
    mocks.appendCallCircleSetupNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_setup",
      status: "sent",
    });
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(true);
    mocks.createCallCircleMatchProposal.mockResolvedValue(null);
    mocks.dropCallCircleMatchForNotificationBlocked.mockResolvedValue(true);
    mocks.expirePastCallCircleMatches.mockResolvedValue(0);
    mocks.listCallCircleEligibleParticipants.mockResolvedValue([]);
    mocks.listCallCircleMemberIdsWithRecentMatch.mockResolvedValue([]);
    mocks.listRecentCallCircleMatches.mockResolvedValue([]);
    mocks.markCallCircleMatchAmAsked.mockResolvedValue(true);
    mocks.markCallCircleMatchFinalAsked.mockResolvedValue(true);
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.proposeCallCircleMatches.mockReturnValue([]);
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue({
      memberATimeZone: "UTC",
      memberBTimeZone: "UTC",
    });
    mocks.readCallCircleNotificationPreflightTx.mockResolvedValue({ status: "ok" });
    mocks.readCallCircleNotificationSignal.mockImplementation(({ memberId, notification }) =>
      notification.status === "sent" && notification.mailboxItemId
        ? { mailboxItemId: notification.mailboxItemId, memberId }
        : null);
    mocks.signalHostedAssistantNotificationsBestEffort.mockResolvedValue(undefined);
    mocks.startCallCircleConnectorCall.mockResolvedValue({
      phoneCallId: "hpc_123",
      status: "calling",
    });
  });

  it("matches one bounded due page and advances every considered group to the fixed epoch", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const recentMatches = [{
      createdAt: new Date("2026-06-20T09:30:00.000Z"),
      memberAId: "member_a",
      memberBId: "member_c",
    }];
    const participants = [
      eligibleParticipant("member_a"),
      eligibleParticipant("member_b"),
    ];
    const prisma = createSchedulerPrisma({
      dueParticipants: [{ groupId: "hgrp_123", id: "hccp_a" }],
    });
    mocks.listCallCircleEligibleParticipants.mockResolvedValue(participants);
    mocks.listRecentCallCircleMatches.mockResolvedValue(recentMatches);
    mocks.proposeCallCircleMatches.mockReturnValue([{
      memberAId: "member_a",
      memberBId: "member_b",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    }]);
    mocks.createCallCircleMatchProposal.mockResolvedValue({ id: "hccm_123" });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ proposals: 1 });

    const dueQueries = prisma.hostedCallCircleParticipant.findMany.mock.calls
      .filter(([args]) => args.where?.preferencesJson?.not !== undefined);
    expect(dueQueries).toHaveLength(1);
    expect(dueQueries[0]?.[0]).toEqual({
      orderBy: [
        { nextMatchingAt: "asc" },
        { id: "asc" },
      ],
      select: { groupId: true },
      take: 32,
      where: {
        nextMatchingAt: { lte: now },
        preferencesJson: { not: expect.anything() },
        status: "enrolled",
      },
    });
    expect(mocks.proposeCallCircleMatches).toHaveBeenCalledWith({
      now,
      participants,
      recentMatches,
    });
    expect(mocks.listCallCircleMemberIdsWithRecentMatch).toHaveBeenCalledWith({
      memberIds: ["member_a", "member_b"],
      now,
      prisma: expect.any(Object),
    });
    expect(mocks.readCallCircleNotificationPreflightTx).toHaveBeenCalledWith({
      memberId: "member_a",
      now,
      requireDaytime: false,
      timeZone: "UTC",
      tx: expect.any(Object),
    });
    expect(prisma.hostedCallCircleParticipant.updateMany).toHaveBeenCalledWith({
      data: { nextMatchingAt: new Date("2026-07-13T00:00:00.000Z") },
      where: {
        groupId: "hgrp_123",
        nextMatchingAt: { lte: now },
        preferencesJson: { not: expect.anything() },
        status: "enrolled",
      },
    });
  });

  it("removes globally recent members before matching the remaining group", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const prisma = createSchedulerPrisma({
      dueParticipants: [{ groupId: "hgrp_123", id: "hccp_a" }],
    });
    mocks.listCallCircleEligibleParticipants.mockResolvedValue([
      eligibleParticipant("member_a"),
      eligibleParticipant("member_b"),
      eligibleParticipant("member_c"),
    ]);
    mocks.listCallCircleMemberIdsWithRecentMatch.mockResolvedValue(["member_a"]);
    mocks.proposeCallCircleMatches.mockReturnValue([{
      memberAId: "member_b",
      memberBId: "member_c",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    }]);
    mocks.createCallCircleMatchProposal.mockResolvedValue({ id: "hccm_123" });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ proposals: 1 });

    expect(mocks.listCallCircleMemberIdsWithRecentMatch).toHaveBeenCalledWith({
      memberIds: ["member_a", "member_b", "member_c"],
      now,
      prisma: expect.any(Object),
    });
    expect(mocks.proposeCallCircleMatches).toHaveBeenCalledWith({
      now,
      participants: [
        eligibleParticipant("member_b"),
        eligibleParticipant("member_c"),
      ],
      recentMatches: [],
    });
    expect(mocks.createCallCircleMatchProposal).toHaveBeenCalledWith({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_b",
        memberBId: "member_c",
        now,
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma: expect.any(Object),
    });
  });

  it("advances unmatched and unreachable due participants so they cannot starve later groups", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const prisma = createSchedulerPrisma({
      dueParticipants: [
        { groupId: "hgrp_blocked", id: "hccp_blocked" },
        { groupId: "hgrp_single", id: "hccp_single" },
      ],
    });
    mocks.listCallCircleEligibleParticipants.mockImplementation(async ({ groupId }) =>
      groupId === "hgrp_blocked"
        ? [eligibleParticipant("member_blocked", groupId)]
        : [eligibleParticipant("member_single", groupId)]);
    mocks.readCallCircleNotificationPreflightTx.mockResolvedValue({
      reason: "missing_recent_inbound",
      status: "blocked",
    });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ proposals: 0 });

    expect(prisma.hostedCallCircleParticipant.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedCallCircleParticipant.updateMany).toHaveBeenCalledWith({
      data: { nextMatchingAt: new Date("2026-07-13T00:00:00.000Z") },
      where: expect.objectContaining({ groupId: "hgrp_blocked" }),
    });
    expect(prisma.hostedCallCircleParticipant.updateMany).toHaveBeenCalledWith({
      data: { nextMatchingAt: new Date("2026-07-13T00:00:00.000Z") },
      where: expect.objectContaining({ groupId: "hgrp_single" }),
    });
  });

  it("expires only the selected bounded match ids through the match-store predicate", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma({
      expiredMatches: [{ id: "hccm_1" }, { id: "hccm_2" }],
    });
    mocks.expirePastCallCircleMatches.mockResolvedValue(2);

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ expired: 2 });

    expect(mocks.expirePastCallCircleMatches).toHaveBeenCalledWith({
      matchIds: ["hccm_1", "hccm_2"],
      now,
      prisma,
    });
    const expiryQuery = findMatchQuery(prisma, "expiry");
    expect(expiryQuery).toMatchObject({
      select: { id: true },
      take: 100,
    });
  });

  it("uses one confirmation implementation for a morning ask and only notifies pending sides", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const match = schedulerMatch({
      sideAResponse: "countered",
      sideBResponse: "pending",
      status: "asking",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({ morningMatches: [match] });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ askedMorning: 1 });

    expect(mocks.markCallCircleMatchAmAsked).toHaveBeenCalledWith({
      groupId: match.groupId,
      matchId: match.id,
      memberAId: match.memberAId,
      memberBId: match.memberBId,
      now,
      prisma: expect.any(Object),
      sideAResponse: "countered",
      sideBResponse: "pending",
      windowEndAt: match.windowEndAt,
      windowStartAt: match.windowStartAt,
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_b", stage: "am" }),
    );
  });

  it("runs the final stage through the same preflight/mark/append path", async () => {
    const now = new Date("2026-07-06T14:45:00.000Z");
    const match = schedulerMatch({
      amAskedAt: new Date("2026-07-06T09:30:00.000Z"),
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({ finalMatches: [match] });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ askedFinal: 1 });

    expect(mocks.markCallCircleMatchFinalAsked).toHaveBeenCalledOnce();
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ memberId: "member_a", stage: "final" }),
    );
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ memberId: "member_b", stage: "final" }),
    );
  });

  it("advances the final ask before jittered cutoff expiry", async () => {
    const now = new Date("2026-07-06T14:40:05.000Z");
    const match = schedulerMatch({
      amAskedAt: new Date("2026-07-06T09:30:00.000Z"),
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({
      expiredMatches: [{ id: match.id }],
      finalMatches: [match],
    });
    mocks.expirePastCallCircleMatches.mockImplementationOnce(async () => {
      expect(mocks.markCallCircleMatchFinalAsked).toHaveBeenCalledOnce();
      return 0;
    });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ askedFinal: 1, expired: 0 });
  });

  it("drops the current final stage when either notification preflight is blocked", async () => {
    const now = new Date("2026-07-06T14:45:00.000Z");
    const match = schedulerMatch({
      amAskedAt: new Date("2026-07-06T09:30:00.000Z"),
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({ finalMatches: [match] });
    mocks.readCallCircleNotificationPreflightTx
      .mockResolvedValueOnce({ status: "ok" })
      .mockResolvedValueOnce({ reason: "line_unavailable", status: "blocked" });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ askedFinal: 0 });

    expect(mocks.dropCallCircleMatchForNotificationBlocked).toHaveBeenCalledWith({
      groupId: match.groupId,
      matchId: match.id,
      prisma: expect.any(Object),
      sideAResponse: match.sideAResponse,
      sideBResponse: match.sideBResponse,
      stage: "final",
      windowEndAt: match.windowEndAt,
      windowStartAt: match.windowStartAt,
    });
    expect(mocks.markCallCircleMatchFinalAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("fails closed instead of sending a scheduled ask with an invalid stored timezone", async () => {
    const now = new Date("2026-07-06T14:45:00.000Z");
    const prisma = createSchedulerPrisma({
      finalMatches: [schedulerMatch({
        amAskedAt: new Date("2026-07-06T09:30:00.000Z"),
        sideAResponse: "confirmed",
        sideBResponse: "confirmed",
        status: "both_confirmed",
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      })],
    });
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue({
      memberATimeZone: "Not/A_Time_Zone",
      memberBTimeZone: "UTC",
    });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ askedFinal: 0 });

    expect(mocks.readCallCircleNotificationPreflightTx).not.toHaveBeenCalled();
    expect(mocks.markCallCircleMatchFinalAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("selects every recoverable bridge shape and reads a fresh clock before the call", async () => {
    const baseMs = new Date("2026-07-06T15:00:00.000Z").getTime();
    let tick = 0;
    const clock = () => new Date(baseMs + tick++ * 1_000);
    const match = schedulerMatch({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({ bridgeMatches: [match] });

    await expect(runCallCircleScheduler({ clock, prisma: prisma as never }))
      .resolves.toMatchObject({ bridgeAttempts: 1 });

    const bridgeQuery = findMatchQuery(prisma, "bridge");
    expect(bridgeQuery).toMatchObject({
      take: 100,
      where: {
        OR: [
          {
            phoneCallId: null,
            status: "both_confirmed",
          },
          {
            phoneCallId: null,
            status: "bridging",
          },
          {
            phoneCall: {
              is: {
                providerCallId: null,
                providerStartAttemptedAt: null,
                status: "starting",
              },
            },
            status: "bridging",
          },
          {
            phoneCall: {
              is: {
                analyzedAt: null,
                endedAt: null,
                providerCallId: null,
                status: "failed",
              },
            },
            status: "bridging",
          },
        ],
        finalAskedAt: { not: null },
      },
    });
    expect(bridgeQuery).not.toHaveProperty("include");
    const starterNow = mocks.startCallCircleConnectorCall.mock.calls[0]?.[0]?.now;
    expect(starterNow).toBeInstanceOf(Date);
    expect(starterNow.getTime()).toBeGreaterThan(baseMs);
  });

  it("delegates selected bridge rows even when the fresh clock crosses the deadline", async () => {
    const baseMs = new Date("2026-07-06T15:00:00.000Z").getTime();
    let tick = 0;
    const clock = () => new Date(baseMs + tick++ * 16 * 60 * 1000);
    const match = schedulerMatch({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({ bridgeMatches: [match] });

    await expect(runCallCircleScheduler({ clock, prisma: prisma as never }))
      .resolves.toMatchObject({ bridgeAttempts: 1 });

    expect(mocks.startCallCircleConnectorCall).toHaveBeenCalledWith({
      matchId: match.id,
      now: expect.any(Date),
      prisma: expect.any(Object),
    });
  });

  it("delegates elapsed bridge recovery to the connector owner", async () => {
    const now = new Date("2026-07-06T15:16:00.000Z");
    const match = schedulerMatch({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T17:00:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const prisma = createSchedulerPrisma({ handoffMatches: [match] });
    mocks.startCallCircleConnectorCall.mockResolvedValueOnce({
      status: "handoff",
    });

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ bridgeAttempts: 0, handoffs: 1 });

    expect(mocks.startCallCircleConnectorCall).toHaveBeenCalledWith({
      matchId: match.id,
      now,
      prisma: expect.any(Object),
    });
    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
  });

  it("processes at most one setup page per run", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const setupParticipants = Array.from({ length: 100 }, (_, index) => ({
      groupId: "hgrp_123",
      id: `hccp_${index}`,
      memberId: `member_${index}`,
    }));
    const prisma = createSchedulerPrisma({ setupParticipants });
    mocks.appendCallCircleSetupNotificationTx.mockResolvedValue(null);

    await expect(runCallCircleScheduler({ now, prisma: prisma as never }))
      .resolves.toMatchObject({ setupAsks: 0 });

    const setupQueries = prisma.hostedCallCircleParticipant.findMany.mock.calls
      .filter(([args]) => args.where?.preferencesJson?.equals !== undefined);
    expect(setupQueries).toHaveLength(1);
    expect(setupQueries[0]?.[0]).toMatchObject({
      orderBy: [
        { nextMatchingAt: "asc" },
        { id: "asc" },
      ],
      take: 100,
      where: {
        nextMatchingAt: { lte: now },
      },
    });
    expect(prisma.hostedCallCircleParticipant.updateMany).toHaveBeenCalledTimes(100);
  });

  it("keeps every growing scheduler phase hard-bounded", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createSchedulerPrisma();

    await runCallCircleScheduler({ now, prisma: prisma as never });

    for (const [args] of prisma.hostedCallCircleMatch.findMany.mock.calls) {
      expect(args.take).toBe(100);
    }
    for (const [args] of prisma.hostedCallCircleParticipant.findMany.mock.calls) {
      expect([32, 100]).toContain(args.take);
    }
  });

  it("rotates an unready confirmation page so the next row is inspected", async () => {
    const now = new Date("2026-07-06T09:30:00.000Z");
    const staleAt = new Date("2026-07-06T00:00:00.000Z");
    const morningMatches = Array.from({ length: 101 }, (_, index) =>
      schedulerMatch({
        id: `hccm_${String(index).padStart(3, "0")}`,
        memberAId: `member_a_${index}`,
        memberBId: `member_b_${index}`,
        status: "asking",
        updatedAt: staleAt,
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      }));
    const prisma = createSchedulerPrisma({ morningMatches });
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue({
      memberATimeZone: "America/Los_Angeles",
      memberBTimeZone: "America/Los_Angeles",
    });

    await runCallCircleScheduler({ now, prisma: prisma as never });
    await runCallCircleScheduler({ now, prisma: prisma as never });

    expect(mocks.readCallCircleMatchParticipantTimeZones).toHaveBeenCalledTimes(200);
    expect(mocks.readCallCircleMatchParticipantTimeZones.mock.calls[100]?.[0])
      .toMatchObject({
        memberAId: "member_a_100",
        memberBId: "member_b_100",
      });
  });
});

type SchedulerMatch = ReturnType<typeof schedulerMatch>;

function createSchedulerPrisma(input: {
  bridgeMatches?: SchedulerMatch[];
  dueParticipants?: Array<{ groupId: string; id: string }>;
  expiredMatches?: Array<{ id: string }>;
  finalMatches?: SchedulerMatch[];
  handoffMatches?: SchedulerMatch[];
  morningMatches?: SchedulerMatch[];
  setupParticipants?: Array<{ groupId: string; id: string; memberId: string }>;
} = {}) {
  const matchFindMany = vi.fn(async (args: MatchFindManyArgs) => {
    if (isMatchPhase(args, "expiry")) return input.expiredMatches ?? [];
    if (isMatchPhase(args, "handoff")) return input.handoffMatches ?? [];
    if (isMatchPhase(args, "morning")) {
      return [...(input.morningMatches ?? [])]
        .sort((left, right) =>
          left.updatedAt.getTime() - right.updatedAt.getTime()
          || left.windowStartAt.getTime() - right.windowStartAt.getTime()
          || left.id.localeCompare(right.id))
        .slice(0, args.take);
    }
    if (isMatchPhase(args, "final")) return input.finalMatches ?? [];
    if (isMatchPhase(args, "bridge")) return input.bridgeMatches ?? [];
    throw new Error(`Unexpected Call Circle match query: ${JSON.stringify(args)}`);
  });
  const participantFindMany = vi.fn(async (args: ParticipantFindManyArgs) =>
    args.where?.preferencesJson?.equals !== undefined
      ? input.setupParticipants ?? []
      : input.dueParticipants ?? []);
  const tx = {
    hostedMailboxItem: {
      findFirst: vi.fn(async () => null),
    },
  };
  const matchUpdateMany = vi.fn(async (args: {
    data: { updatedAt?: Date };
    where: { id?: { in?: string[] } };
  }) => {
    const ids = new Set(args.where.id?.in ?? []);
    if (args.data.updatedAt) {
      for (const match of input.morningMatches ?? []) {
        if (ids.has(match.id)) match.updatedAt = args.data.updatedAt;
      }
    }
    return { count: ids.size };
  });
  return {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)),
    hostedCallCircleMatch: {
      findMany: matchFindMany,
      updateMany: matchUpdateMany,
    },
    hostedCallCircleParticipant: {
      findMany: participantFindMany,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

interface MatchFindManyArgs {
  include?: unknown;
  orderBy?: unknown;
  select?: { id?: boolean };
  take?: number;
  where?: Record<string, unknown>;
}

interface ParticipantFindManyArgs {
  take?: number;
  where?: {
    nextMatchingAt?: unknown;
    preferencesJson?: { equals?: unknown; not?: unknown };
  };
}

type MatchPhase = "bridge" | "expiry" | "final" | "handoff" | "morning";

function isMatchPhase(args: MatchFindManyArgs, phase: MatchPhase): boolean {
  const where = args.where ?? {};
  switch (phase) {
    case "expiry":
      return args.select?.id === true;
    case "handoff":
      return Array.isArray(where.AND)
        && where.AND.some((clause) => {
          if (!clause || typeof clause !== "object" || !("OR" in clause)) {
            return false;
          }
          return Array.isArray(clause.OR)
            && clause.OR.some((entry: unknown) =>
              entry
              && typeof entry === "object"
              && "windowEndAt" in entry
            );
        });
    case "morning":
      return where.amAskedAt === null;
    case "final":
      return typeof where.amAskedAt === "object"
        && where.amAskedAt !== null
        && where.status === "both_confirmed";
    case "bridge":
      return Boolean(
        where.finalAskedAt
        && typeof where.finalAskedAt === "object"
        && "not" in where.finalAskedAt
        && where.windowStartAt
        && typeof where.windowStartAt === "object"
        && "lte" in where.windowStartAt,
      );
  }
}

function findMatchQuery(
  prisma: ReturnType<typeof createSchedulerPrisma>,
  phase: MatchPhase,
): MatchFindManyArgs {
  const call = prisma.hostedCallCircleMatch.findMany.mock.calls
    .find(([args]) => isMatchPhase(args, phase));
  if (!call) throw new Error(`Missing ${phase} match query.`);
  return call[0];
}

function eligibleParticipant(memberId: string, groupId = "hgrp_123") {
  return {
    groupId,
    memberId,
    preferences: {
      timeZone: "UTC",
      windows: [{
        dayOfWeek: 1 as const,
        endLocalTime: "15:30",
        startLocalTime: "15:00",
      }],
    },
  };
}

function schedulerMatch(input: {
  amAskedAt?: Date | null;
  finalAskedAt?: Date | null;
  id?: string;
  memberAId?: string;
  memberBId?: string;
  sideAResponse?: "confirmed" | "countered" | "declined" | "pending";
  sideBResponse?: "confirmed" | "countered" | "declined" | "pending";
  status: string;
  updatedAt?: Date;
  windowEndAt: Date;
  windowStartAt: Date;
}) {
  return {
    amAskedAt: input.amAskedAt ?? null,
    finalAskedAt: input.finalAskedAt ?? null,
    groupId: "hgrp_123",
    id: input.id ?? "hccm_123",
    memberAId: input.memberAId ?? "member_a",
    memberBId: input.memberBId ?? "member_b",
    sideAResponse: input.sideAResponse ?? "pending",
    sideBResponse: input.sideBResponse ?? "pending",
    status: input.status,
    updatedAt: input.updatedAt ?? new Date("2026-07-06T00:00:00.000Z"),
    windowEndAt: input.windowEndAt,
    windowStartAt: input.windowStartAt,
  };
}
