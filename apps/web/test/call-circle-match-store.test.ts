import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readActiveHostedMemberAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  activeHostedMemberAccessWithParticipantsWhere: () => ({ suspendedAt: null }),
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import {
  attachCallCirclePhoneCall,
  cancelOpenCallCircleMatchesForParticipant,
  confirmCallCircleMatchSide as confirmMatchSide,
  counterCallCircleMatchSide as counterMatchSide,
  claimCallCircleMatchForConnector as claimMatchForConnector,
  createCallCircleMatchProposal,
  declineCallCircleMatchSide as declineMatchSide,
  dropCallCircleMatchForNotificationBlocked,
  expirePastCallCircleMatches,
  listRecentCallCircleMatches,
  markCallCircleMatchAmAsked,
  markCallCircleMatchFinalAsked,
  markCallCircleMatchOutcome,
} from "@/src/lib/call-circle/match-store";
import {
  acceptCallCircleOfferEnrollment,
  activeCallCircleParticipantPairMatchWhere,
  advanceCallCircleParticipantMatchingCursors,
  canUseActiveCallCircleParticipant,
  canUseActiveCallCircleParticipantPair,
  HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX,
  pauseCallCircleParticipant,
  readActiveCallCircleParticipantPair,
  readCallCircleMatchParticipantTimeZones,
  refreshCallCircleParticipantMemberNameKey,
  resumeCallCircleParticipant,
  writeCallCirclePreferences,
} from "@/src/lib/call-circle/participant-store";
import {
  createHostedCallCircleMemberNameLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

describe("Call Circle conditional mutations", () => {
  const updateMany = vi.fn();

  beforeEach(() => {
    mocks.readActiveHostedMemberAccess.mockReset();
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("confirms one side with a conditional updateMany before convergence", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T14:50:00.000Z");
    const amAskedAt = new Date("2026-07-06T14:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");
    const windowStartAt = new Date("2026-07-06T15:15:00.000Z");

    await expect(confirmMatchSide({
      expectedAsk: {
        amAskedAt,
        finalAskedAt: null,
        windowEndAt,
        windowStartAt,
      },
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_a",
      now,
      prisma: prisma as never,
      side: "A",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        sideAResponse: "confirmed",
        status: "asking",
      },
      where: {
        ...activeCallCircleParticipantPairMatchWhere({
          groupId: "hgrp_123",
          memberAId: "member_a",
          memberBId: "member_b",
        }),
        amAskedAt,
        finalAskedAt: null,
        groupId: "hgrp_123",
        id: "hccm_123",
        memberAId: "member_a",
        sideAResponse: "pending",
        status: { in: ["proposed", "asking"] },
        windowEndAt: { equals: windowEndAt, gt: now },
        windowStartAt: {
          equals: windowStartAt,
          gt: new Date("2026-07-06T15:10:00.000Z"),
        },
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: { status: "both_confirmed" },
      where: {
        groupId: "hgrp_123",
        id: "hccm_123",
        sideAResponse: { in: ["confirmed", "countered"] },
        sideBResponse: { in: ["confirmed", "countered"] },
        status: "asking",
        windowEndAt: { gt: now },
      },
    });
  });

  it("rejects a delayed morning response after the final ask supersedes its snapshot", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const amAskedAt = new Date("2026-07-06T09:00:00.000Z");
    const now = new Date("2026-07-06T14:46:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(confirmMatchSide({
      expectedAsk: {
        amAskedAt,
        finalAskedAt: null,
        windowEndAt,
        windowStartAt,
      },
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_a",
      now,
      prisma: prisma as never,
      side: "A",
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        amAskedAt,
        finalAskedAt: null,
        windowEndAt: { equals: windowEndAt, gt: now },
        windowStartAt: {
          equals: windowStartAt,
          gt: new Date("2026-07-06T15:06:00.000Z"),
        },
      }),
    }));
  });

  it("uses a single conditional updateMany for a counter window", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const windowStartAt = new Date("2026-07-06T16:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T16:30:00.000Z");
    const expectedWindowStartAt = new Date("2026-07-06T15:30:00.000Z");
    const expectedWindowEndAt = new Date("2026-07-06T15:45:00.000Z");
    const amAskedAt = new Date("2026-07-06T14:00:00.000Z");

    await expect(counterMatchSide({
      expectedAsk: {
        amAskedAt,
        finalAskedAt: null,
        windowEndAt: expectedWindowEndAt,
        windowStartAt: expectedWindowStartAt,
      },
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_b",
      now: new Date("2026-07-06T15:00:00.000Z"),
      prisma: prisma as never,
      side: "B",
      windowEndAt,
      windowStartAt,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        amAskedAt: null,
        counterUsedB: true,
        finalAskedAt: null,
        sideAResponse: "pending",
        sideBResponse: "countered",
        status: "asking",
        windowEndAt,
        windowStartAt,
      },
      where: {
        ...activeCallCircleParticipantPairMatchWhere({
          groupId: "hgrp_123",
          memberAId: "member_a",
          memberBId: "member_b",
        }),
        amAskedAt,
        counterUsedB: false,
        finalAskedAt: null,
        groupId: "hgrp_123",
        id: "hccm_123",
        memberBId: "member_b",
        OR: [
          {
            sideBResponse: "pending",
            status: { in: ["proposed", "asking"] },
          },
          {
            sideAResponse: "pending",
            sideBResponse: { in: ["confirmed", "countered"] },
            status: "asking",
          },
        ],
        windowEndAt: {
          equals: expectedWindowEndAt,
          gt: new Date("2026-07-06T15:00:00.000Z"),
        },
        windowStartAt: {
          equals: expectedWindowStartAt,
          gt: new Date("2026-07-06T15:20:00.000Z"),
        },
      },
    });
  });

  it.each([
    {
      affirmativeWhere: {
        sideAResponse: { in: ["confirmed", "countered"] },
        sideBResponse: "pending",
        status: "asking",
      },
      memberId: "member_a",
      pendingWhere: {
        sideAResponse: "pending",
        status: { in: ["proposed", "asking"] },
      },
      side: "A" as const,
    },
    {
      affirmativeWhere: {
        sideAResponse: "pending",
        sideBResponse: { in: ["confirmed", "countered"] },
        status: "asking",
      },
      memberId: "member_b",
      pendingWhere: {
        sideBResponse: "pending",
        status: { in: ["proposed", "asking"] },
      },
      side: "B" as const,
    },
  ])("allows side $side to counter after its own confirmation", async ({
    affirmativeWhere,
    memberId,
    pendingWhere,
    side,
  }) => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");
    const expectedWindowStartAt = new Date("2026-07-06T15:30:00.000Z");
    const expectedWindowEndAt = new Date("2026-07-06T15:45:00.000Z");

    await expect(counterMatchSide({
      expectedAsk: {
        amAskedAt: new Date("2026-07-06T14:00:00.000Z"),
        finalAskedAt: null,
        windowEndAt: expectedWindowEndAt,
        windowStartAt: expectedWindowStartAt,
      },
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId,
      now,
      prisma: prisma as never,
      side,
      windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        finalAskedAt: null,
        OR: [pendingWhere, affirmativeWhere],
      }),
    }));
  });

  it("rejects a counter after the final-stage reset", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(counterMatchSide({
      expectedAsk: {
        amAskedAt: new Date("2026-07-06T09:00:00.000Z"),
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:15:00.000Z"),
      },
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_a",
      now: new Date("2026-07-06T15:00:00.000Z"),
      prisma: prisma as never,
      side: "A",
      windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ finalAskedAt: null }),
    }));
  });

  it("allows a late no after either a final pair confirmation or this side's earlier yes", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");
    const finalAskedAt = new Date("2026-07-06T14:45:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");
    const windowStartAt = new Date("2026-07-06T15:15:00.000Z");

    await expect(declineMatchSide({
      expectedAsk: {
        amAskedAt: new Date("2026-07-06T09:00:00.000Z"),
        finalAskedAt,
        windowEndAt,
        windowStartAt,
      },
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_a",
      now,
      prisma: prisma as never,
      side: "A",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "declined_by_a",
        sideAResponse: "declined",
        status: "dropped",
      },
      where: {
        ...activeCallCircleParticipantPairMatchWhere({
          groupId: "hgrp_123",
          memberAId: "member_a",
          memberBId: "member_b",
        }),
        amAskedAt: new Date("2026-07-06T09:00:00.000Z"),
        finalAskedAt,
        groupId: "hgrp_123",
        id: "hccm_123",
        memberAId: "member_a",
        OR: [
          {
            sideAResponse: "pending",
            status: { in: ["proposed", "asking"] },
          },
          {
            sideAResponse: { in: ["confirmed", "countered"] },
            sideBResponse: "pending",
            status: "asking",
          },
          { status: "both_confirmed" },
        ],
        windowEndAt: { equals: windowEndAt, gt: now },
        windowStartAt: {
          equals: windowStartAt,
          gt: new Date("2026-07-06T14:45:00.000Z"),
        },
      },
    });
  });

  it("marks a morning ask only while the same staged window is still current", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T09:30:00.000Z");
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");

    await expect(markCallCircleMatchAmAsked({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now,
      prisma: prisma as never,
      sideAResponse: "countered",
      sideBResponse: "pending",
      windowEndAt,
      windowStartAt,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        amAskedAt: now,
        status: "asking",
      },
      where: {
        ...activeCallCircleParticipantPairMatchWhere({
          groupId: "hgrp_123",
          memberAId: "member_a",
          memberBId: "member_b",
        }),
        amAskedAt: null,
        finalAskedAt: null,
        groupId: "hgrp_123",
        id: "hccm_123",
        phoneCallId: null,
        sideAResponse: "countered",
        sideBResponse: "pending",
        status: { in: ["proposed", "asking"] },
        windowEndAt,
        windowStartAt,
      },
    });
  });

  it("resets side responses when sending the final confirmation ask", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T14:45:00.000Z");
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");

    await expect(markCallCircleMatchFinalAsked({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now,
      prisma: prisma as never,
      sideAResponse: "confirmed",
      sideBResponse: "countered",
      windowEndAt,
      windowStartAt,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        finalAskedAt: now,
        sideAResponse: "pending",
        sideBResponse: "pending",
        status: "asking",
      },
      where: {
        ...activeCallCircleParticipantPairMatchWhere({
          groupId: "hgrp_123",
          memberAId: "member_a",
          memberBId: "member_b",
        }),
        amAskedAt: { not: null },
        finalAskedAt: null,
        groupId: "hgrp_123",
        id: "hccm_123",
        phoneCallId: null,
        sideAResponse: "confirmed",
        sideBResponse: "countered",
        status: "both_confirmed",
        windowEndAt,
        windowStartAt,
      },
    });
  });

  it("keeps an explicit null phone-call guard when marking an outcome", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    await expect(markCallCircleMatchOutcome({
      matchId: "hccm_123",
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: prisma as never,
      status: "dropped",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "text_handoff",
        status: "dropped",
      },
      where: {
        id: "hccm_123",
        phoneCallId: null,
        status: { in: ["proposed", "asking", "both_confirmed", "bridging"] },
      },
    });
  });

  it("can restrict an outcome transition to the scheduler-owned pre-provider stage", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    await expect(markCallCircleMatchOutcome({
      expectedStatuses: ["both_confirmed"],
      matchId: "hccm_123",
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: prisma as never,
      status: "dropped",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "text_handoff",
        status: "dropped",
      },
      where: {
        id: "hccm_123",
        phoneCallId: null,
        status: { in: ["both_confirmed"] },
      },
    });
  });

  it("can restrict a terminal correction to the prior text handoff", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    await expect(markCallCircleMatchOutcome({
      expectedOutcome: "text_handoff",
      expectedStatuses: ["dropped"],
      matchId: "hccm_123",
      outcome: "completed",
      phoneCallId: "hpc_123",
      prisma: prisma as never,
      status: "completed",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "completed",
        status: "completed",
      },
      where: {
        id: "hccm_123",
        outcome: "text_handoff",
        phoneCallId: "hpc_123",
        status: { in: ["dropped"] },
      },
    });
  });

  it("drops a notification-blocked morning ask only while the same stage is still pending", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");

    await expect(dropCallCircleMatchForNotificationBlocked({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      prisma: prisma as never,
      sideAResponse: "pending",
      sideBResponse: "countered",
      stage: "am",
      windowEndAt,
      windowStartAt,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "notification_blocked",
        status: "dropped",
      },
      where: {
        amAskedAt: null,
        finalAskedAt: null,
        groupId: "hgrp_123",
        id: "hccm_123",
        phoneCallId: null,
        sideAResponse: "pending",
        sideBResponse: "countered",
        status: { in: ["proposed", "asking"] },
        windowEndAt,
        windowStartAt,
      },
    });
  });

  it("drops a notification-blocked final ask only before the final stage is marked", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T15:30:00.000Z");

    await expect(dropCallCircleMatchForNotificationBlocked({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      prisma: prisma as never,
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      stage: "final",
      windowEndAt,
      windowStartAt,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "notification_blocked",
        status: "dropped",
      },
      where: {
        amAskedAt: { not: null },
        finalAskedAt: null,
        groupId: "hgrp_123",
        id: "hccm_123",
        phoneCallId: null,
        sideAResponse: "confirmed",
        sideBResponse: "confirmed",
        status: "both_confirmed",
        windowEndAt,
        windowStartAt,
      },
    });
  });

  it("leaves final-confirmed matches for scheduler handoff instead of generic expiry", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:45:00.000Z");

    await expect(expirePastCallCircleMatches({
      matchIds: ["hccm_123"],
      now,
      prisma: prisma as never,
    })).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "expired",
        status: "expired",
      },
      where: {
        AND: [{
          OR: [
            {
              finalAskedAt: null,
              status: { in: ["proposed", "asking", "both_confirmed"] },
              windowStartAt: {
                lt: new Date("2026-07-06T16:05:00.000Z"),
              },
            },
            {
              finalAskedAt: { not: null },
              OR: [
                { windowEndAt: { lte: now } },
                {
                  windowStartAt: {
                    lte: new Date("2026-07-06T15:30:00.000Z"),
                  },
                },
              ],
              status: "asking",
            },
          ],
        }],
        id: { in: ["hccm_123"] },
      },
    });
  });

  it("reattaches the same reserved phone call idempotently", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };

    await expect(attachCallCirclePhoneCall({
      matchId: "hccm_123",
      phoneCallId: "hpc_123",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: { phoneCallId: "hpc_123" },
      where: {
        id: "hccm_123",
        OR: [
          { phoneCallId: null },
          { phoneCallId: "hpc_123" },
        ],
        status: "bridging",
      },
    });
  });

  it("claims connector work with the active pair predicate on the durable update", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(claimMatchForConnector({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now,
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        status: "bridging",
      },
      where: {
        ...activePairMatchWhere(),
        finalAskedAt: { not: null },
        id: "hccm_123",
        status: "both_confirmed",
        windowEndAt: { gt: now },
        windowStartAt: {
          gt: new Date("2026-07-06T14:45:00.000Z"),
          lte: now,
        },
      },
    });
  });

  it("does not claim a broad stored window after the narrow bridge deadline", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T12:00:00.000Z");

    await expect(claimMatchForConnector({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now,
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        status: "bridging",
      },
      where: {
        ...activePairMatchWhere(),
        finalAskedAt: { not: null },
        id: "hccm_123",
        status: "both_confirmed",
        windowEndAt: { gt: now },
        windowStartAt: {
          gt: new Date("2026-07-06T11:45:00.000Z"),
          lte: now,
        },
      },
    });
  });

  it("does not create a proposal when the pair is inactive", async () => {
    const create = vi.fn();
    const prisma = {
      $queryRaw: vi.fn(),
      hostedCallCircleMatch: { create },
      hostedCallCircleParticipant: {
        findMany: vi.fn(async () => [{
          memberId: "member_a",
          preferencesJson: storedPreferences(),
        }]),
      },
    };

    await expect(createCallCircleMatchProposal({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_a",
        memberBId: "member_b",
        now: new Date("2026-07-06T15:00:00.000Z"),
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma: prisma as never,
    })).resolves.toBeNull();

    expect(create).not.toHaveBeenCalled();
  });

  it("locks and rechecks both participants before creating a proposal", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const create = vi.fn(async () => ({
      id: "hccm_123",
    }));
    const tx = {
      $queryRaw: vi.fn(),
      hostedCallCircleMatch: {
        create,
        findMany: vi.fn(async () => []),
      },
      hostedCallCircleParticipant: {
        findMany: vi.fn(async () => [
          { memberId: "member_a", preferencesJson: storedPreferences() },
          { memberId: "member_b", preferencesJson: storedPreferences() },
        ]),
      },
    };
    const transaction = vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(tx));
    const prisma = {
      $transaction: transaction,
    };

    await expect(createCallCircleMatchProposal({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_b",
        memberBId: "member_a",
        now,
        windowEndAt: new Date("2026-07-06T17:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T17:00:00.000Z"),
      },
      prisma: prisma as never,
    })).resolves.toEqual({ id: "hccm_123" });

    expect(tx.hostedCallCircleMatch.findMany).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: 200,
      select: {
        createdAt: true,
        memberAId: true,
        memberBId: true,
        status: true,
      },
      where: {
        AND: [
          {
            OR: [
              {
                status: {
                  in: ["proposed", "asking", "both_confirmed", "bridging"],
                },
              },
              {
                createdAt: {
                  gte: new Date("2026-06-09T03:00:00.000Z"),
                },
                NOT: [
                  {
                    amAskedAt: null,
                    finalAskedAt: null,
                    status: "canceled",
                  },
                  {
                    outcome: "notification_blocked",
                    status: "dropped",
                  },
                ],
              },
            ],
          },
          {
            OR: [
              { memberAId: { in: ["member_a", "member_b"] } },
              { memberBId: { in: ["member_a", "member_b"] } },
            ],
          },
        ],
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        createdAt: now,
        groupId: "hgrp_123",
        id: expect.stringMatching(/^hccm_/u),
        memberAId: "member_a",
        memberBId: "member_b",
        status: "proposed",
        updatedAt: now,
        windowEndAt: new Date("2026-07-06T17:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T17:00:00.000Z"),
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[1])
      .toBeLessThan(create.mock.invocationCallOrder[0] ?? 0);
  });

  it("rejects a staged window that no longer matches locked preferences", async () => {
    const create = vi.fn();
    const prisma = {
      $queryRaw: vi.fn(),
      hostedCallCircleMatch: {
        create,
        findMany: vi.fn(async () => []),
      },
      hostedCallCircleParticipant: {
        findMany: vi.fn(async () => [
          { memberId: "member_a", preferencesJson: storedPreferences() },
          { memberId: "member_b", preferencesJson: storedPreferences() },
        ]),
      },
    };

    await expect(createCallCircleMatchProposal({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_a",
        memberBId: "member_b",
        now: new Date("2026-07-06T15:00:00.000Z"),
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma: prisma as never,
    })).resolves.toBeNull();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create a proposal when either member already has a recent match in another group", async () => {
    const create = vi.fn();
    const participantUpdateMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hostedCallCircleMatch: {
        create,
        findMany: vi.fn(async () => [{
          createdAt: new Date("2026-07-01T15:00:00.000Z"),
          memberAId: "member_a",
          memberBId: "member_other",
        }]),
      },
      hostedCallCircleParticipant: {
        findMany: vi.fn(async () => [
          { memberId: "member_a", preferencesJson: storedPreferences() },
          { memberId: "member_b", preferencesJson: storedPreferences() },
        ]),
        updateMany: participantUpdateMany,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(tx)),
    };

    await expect(createCallCircleMatchProposal({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_a",
        memberBId: "member_b",
        now: new Date("2026-07-06T15:00:00.000Z"),
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma: prisma as never,
    })).resolves.toBeNull();

    expect(tx.hostedCallCircleMatch.findMany).toHaveBeenCalled();
    expect(participantUpdateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rechecks private never preferences after locking and rejects only the future proposal", async () => {
    const create = vi.fn();
    const findMany = vi.fn(async () => []);
    const prisma = {
      $queryRaw: vi.fn(),
      hostedCallCircleMatch: { create, findMany },
      hostedCallCircleParticipant: {
        findMany: vi.fn(async () => [
          {
            memberId: "member_a",
            preferencesJson: storedPreferences([{
              cadence: "never",
              memberId: "member_b",
            }]),
          },
          { memberId: "member_b", preferencesJson: storedPreferences() },
        ]),
      },
    };

    await expect(createCallCircleMatchProposal({
      proposal: {
        groupId: "hgrp_123",
        memberAId: "member_a",
        memberBId: "member_b",
        now: new Date("2026-07-06T15:00:00.000Z"),
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma: prisma as never,
    })).resolves.toBeNull();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores notification-blocked dropped rows when reading recent match history", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const findMany = vi.fn(async () => []);
    const prisma = {
      hostedCallCircleMatch: { findMany },
    };

    await expect(listRecentCallCircleMatches({
      memberIds: ["member_b", "member_a", "member_a"],
      now,
      prisma: prisma as never,
    })).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: 200,
      select: {
        createdAt: true,
        memberAId: true,
        memberBId: true,
        status: true,
      },
      where: {
        AND: [
          {
            OR: [
              {
                status: {
                  in: ["proposed", "asking", "both_confirmed", "bridging"],
                },
              },
              {
                createdAt: { gte: new Date("2026-06-09T03:00:00.000Z") },
                NOT: [
                  {
                    amAskedAt: null,
                    finalAskedAt: null,
                    status: "canceled",
                  },
                  {
                    outcome: "notification_blocked",
                    status: "dropped",
                  },
                ],
              },
            ],
          },
          {
            OR: [
              { memberAId: { in: ["member_b", "member_a"] } },
              { memberBId: { in: ["member_b", "member_a"] } },
            ],
          },
        ],
      },
    });
  });

  it("does not claim connector work when the durable active pair predicate misses", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(claimMatchForConnector({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now,
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      data: { status: "bridging" },
      where: {
        ...activePairMatchWhere(),
        finalAskedAt: { not: null },
        id: "hccm_123",
        status: "both_confirmed",
        windowEndAt: { gt: now },
        windowStartAt: {
          gt: new Date("2026-07-06T14:45:00.000Z"),
          lte: now,
        },
      },
    });
  });

  it("cancels open matches for a paused participant in the current group", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    await expect(cancelOpenCallCircleMatchesForParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        outcome: "participant_unavailable",
        status: "canceled",
      },
      where: {
        groupId: "hgrp_123",
        AND: [
          {
            OR: [
              { memberAId: "member_a" },
              { memberBId: "member_a" },
            ],
          },
          {
            OR: [
              { status: { in: ["proposed", "asking", "both_confirmed"] } },
              { phoneCallId: null, status: "bridging" },
              {
                phoneCall: {
                  is: {
                    providerStartAttemptedAt: null,
                  },
                },
                status: "bridging",
              },
            ],
          },
        ],
      },
    });
  });

  it("refreshes pauses and resumes only paused participants", async () => {
    const queryRaw = vi.fn(async () => []);
    const prisma = {
      $queryRaw: queryRaw,
      hostedCallCircleParticipant: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(pauseCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toBe(true);
    await expect(resumeCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0] ?? Infinity,
    );

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        pausedAt: now,
        status: "paused",
      },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        nextMatchingAt: now,
        pausedAt: null,
        status: "enrolled",
      },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
        status: "paused",
      },
    });
  });

  it("resumes from a fresh offer even after paused preferences are edited", async () => {
    const paused = {
      createdAt: new Date("2026-07-06T14:00:00.000Z"),
      groupId: "hgrp_123",
      id: "hccp_123",
      nextMatchingAt: new Date("2026-07-13T00:00:00.000Z"),
      pausedAt: new Date("2026-07-06T14:30:00.000Z"),
      memberId: "member_123",
      preferencesJson: null,
      status: "paused",
      updatedAt: new Date("2026-07-06T14:50:00.000Z"),
    };
    const resumed = {
      ...paused,
      pausedAt: null,
      status: "enrolled",
      updatedAt: new Date("2026-07-06T15:00:00.000Z"),
    };
    const create = vi.fn();
    const findUnique = vi.fn(async () => paused);
    const findUniqueOrThrow = vi.fn(async () => resumed);
    const updateManyParticipant = vi.fn(async () => ({ count: 1 }));
    const queryRaw = vi.fn(async () => []);
    const prisma = {
      $queryRaw: queryRaw,
      hostedCallCircleParticipant: {
        create,
        findUnique,
        findUniqueOrThrow,
        updateMany: updateManyParticipant,
      },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");
    const offerPostedAt = new Date("2026-07-06T14:45:00.000Z");

    await expect(acceptCallCircleOfferEnrollment({
      groupId: "hgrp_123",
      memberId: "member_123",
      now,
      offerPostedAt,
      prisma: prisma as never,
    })).resolves.toBe(resumed);

    expect(queryRaw).toHaveBeenCalled();
    expect(updateManyParticipant).toHaveBeenCalledWith({
      data: {
        nextMatchingAt: now,
        pausedAt: null,
        status: "enrolled",
        updatedAt: now,
      },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
        pausedAt: { lt: offerPostedAt },
        status: "paused",
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves a paused participant paused when an older offer reaction replays", async () => {
    const paused = {
      createdAt: new Date("2026-07-06T14:00:00.000Z"),
      groupId: "hgrp_123",
      id: "hccp_123",
      nextMatchingAt: new Date("2026-07-13T00:00:00.000Z"),
      pausedAt: new Date("2026-07-06T14:30:00.000Z"),
      memberId: "member_123",
      preferencesJson: null,
      status: "paused",
      updatedAt: new Date("2026-07-06T14:30:00.000Z"),
    };
    const updateManyParticipant = vi.fn();
    const queryRaw = vi.fn();
    const prisma = {
      $queryRaw: queryRaw,
      hostedCallCircleParticipant: {
        create: vi.fn(),
        findUnique: vi.fn(async () => paused),
        findUniqueOrThrow: vi.fn(),
        updateMany: updateManyParticipant,
      },
    };

    await expect(acceptCallCircleOfferEnrollment({
      groupId: "hgrp_123",
      memberId: "member_123",
      now: new Date("2026-07-06T15:00:00.000Z"),
      offerPostedAt: new Date("2026-07-06T14:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toBe(paused);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(updateManyParticipant).not.toHaveBeenCalled();
  });

  it("keeps a repeated pause newer than an offer when its reaction arrives later", async () => {
    const offerPostedAt = new Date("2026-07-06T14:45:00.000Z");
    const repeatedPauseAt = new Date("2026-07-06T15:00:00.000Z");
    let participant = {
      createdAt: new Date("2026-07-06T14:00:00.000Z"),
      groupId: "hgrp_123",
      id: "hccp_123",
      nextMatchingAt: new Date("2026-07-13T00:00:00.000Z"),
      pausedAt: new Date("2026-07-06T14:30:00.000Z"),
      memberId: "member_123",
      preferencesJson: null,
      status: "paused" as const,
      updatedAt: new Date("2026-07-06T14:30:00.000Z"),
    };
    const updateManyParticipant = vi.fn(async (args: {
      data: { pausedAt: Date; status: "paused" };
    }) => {
      participant = {
        ...participant,
        pausedAt: args.data.pausedAt,
        status: args.data.status,
        updatedAt: repeatedPauseAt,
      };
      return { count: 1 };
    });
    const queryRaw = vi.fn(async () => []);
    const prisma = {
      $queryRaw: queryRaw,
      hostedCallCircleParticipant: {
        findUnique: vi.fn(async () => participant),
        updateMany: updateManyParticipant,
      },
    };

    await expect(pauseCallCircleParticipant({
      groupId: participant.groupId,
      memberId: participant.memberId,
      now: repeatedPauseAt,
      prisma: prisma as never,
    })).resolves.toBe(true);
    await expect(acceptCallCircleOfferEnrollment({
      groupId: participant.groupId,
      memberId: participant.memberId,
      now: new Date("2026-07-06T15:05:00.000Z"),
      offerPostedAt,
      prisma: prisma as never,
    })).resolves.toEqual(participant);

    expect(participant).toMatchObject({
      pausedAt: repeatedPauseAt,
      status: "paused",
      updatedAt: repeatedPauseAt,
    });
    expect(updateManyParticipant).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it("rejects new enrollment once the group participant cap is reached", async () => {
    const create = vi.fn();
    const count = vi.fn(async () => HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX);
    const findUnique = vi.fn(async () => null);
    const prisma = {
      $queryRaw: vi.fn(async () => []),
      hostedCallCircleParticipant: {
        count,
        create,
        findUnique,
      },
    };

    await expect(acceptCallCircleOfferEnrollment({
      groupId: "hgrp_123",
      memberId: "member_new",
      now: new Date("2026-07-06T15:00:00.000Z"),
      offerPostedAt: new Date("2026-07-06T14:55:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_PARTICIPANT_LIMIT_REACHED",
    });

    expect(count).toHaveBeenCalledWith({
      where: { groupId: "hgrp_123" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("patches private preferences without changing enrollment", async () => {
    const findUnique = vi.fn(async (): Promise<{
      preferencesJson: ReturnType<typeof storedPreferences>;
    } | null> => ({
      preferencesJson: {
        cadence: "weekly" as const,
        memberCadences: [{ cadence: "monthly" as const, memberId: "member_old" }],
        timeZone: "UTC",
        windows: [{
          dayOfWeek: 1,
          endLocalTime: "17:30",
          startLocalTime: "17:00",
        }],
      },
    }));
    const samKey = requireCallCircleMemberNameKey("hgrp_123", "sam");
    const oldKey = requireCallCircleMemberNameKey("hgrp_123", "old");
    const findMany = vi.fn(async () => [
      { memberId: "member_housemate", memberNameKey: samKey },
      { memberId: "member_old", memberNameKey: oldKey },
    ]);
    const prisma = {
      $queryRaw: vi.fn(),
      hostedCallCircleParticipant: { findMany, findUnique, updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(writeCallCirclePreferences({
      groupId: "hgrp_123",
      memberId: "member_123",
      now,
      patch: {
        cadence: "biweekly",
        memberCadenceUpdates: [
          { cadence: "never", memberName: "Sam" },
          { cadence: "default", memberName: "Old" },
        ],
      },
      prisma: prisma as never,
    })).resolves.toBe("updated");

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        nextMatchingAt: now,
        preferencesJson: {
          cadence: "biweekly",
          memberCadences: [{ cadence: "never", memberId: "member_housemate" }],
          timeZone: "UTC",
          windows: [{
            dayOfWeek: 1,
            endLocalTime: "17:30",
            startLocalTime: "17:00",
          }],
        },
      },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
        memberNameKey: true,
      },
      take: HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX,
      where: {
        groupId: "hgrp_123",
        member: {
          hostedGroupMemberships: {
            some: { groupId: "hgrp_123" },
          },
          suspendedAt: null,
        },
        memberNameKey: { in: [samKey, oldKey] },
      },
    });
    expect(JSON.stringify(updateMany.mock.calls[0]?.[0])).not.toMatch(/Sam|Old/u);

    findUnique.mockResolvedValueOnce(null);
    await expect(writeCallCirclePreferences({
      groupId: "hgrp_missing",
      memberId: "member_123",
      now,
      patch: { cadence: "weekly" },
      prisma: prisma as never,
    })).resolves.toBe("missing");
  });

  it("rejects self and non-member cadence overrides without exposing which check failed", async () => {
    const update = vi.fn();
    const alexKey = requireCallCircleMemberNameKey("hgrp_123", "alex");
    const samKey = requireCallCircleMemberNameKey("hgrp_123", "sam");
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ memberId: "member_a", memberNameKey: alexKey }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { memberId: "member_b", memberNameKey: samKey },
        { memberId: "member_c", memberNameKey: samKey },
      ]);
    const prisma = {
      $queryRaw: vi.fn(),
      hostedCallCircleParticipant: {
        findMany,
        findUnique: vi.fn(async () => ({ preferencesJson: storedPreferences() })),
        updateMany: update,
      },
    };

    await expect(writeCallCirclePreferences({
      groupId: "hgrp_123",
      memberId: "member_a",
      patch: {
        memberCadenceUpdates: [{ cadence: "never", memberName: "Alex" }],
      },
      prisma: prisma as never,
    })).resolves.toBe("invalid_member_cadences");
    await expect(writeCallCirclePreferences({
      groupId: "hgrp_123",
      memberId: "member_a",
      patch: {
        memberCadenceUpdates: [{ cadence: "never", memberName: "Unknown" }],
      },
      prisma: prisma as never,
    })).resolves.toBe("invalid_member_cadences");
    await expect(writeCallCirclePreferences({
      groupId: "hgrp_123",
      memberId: "member_a",
      patch: {
        memberCadenceUpdates: [{ cadence: "never", memberName: "Sam" }],
      },
      prisma: prisma as never,
    })).resolves.toBe("invalid_member_cadences");
    expect(update).not.toHaveBeenCalled();
  });

  it("stores only the current blind index for the runtime-derived member name", async () => {
    const update = vi.fn<(input: {
      data: { memberNameKey: string | null };
      where: { groupId: string; memberId: string };
    }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedCallCircleParticipant: { updateMany: update },
    };

    await refreshCallCircleParticipantMemberNameKey({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
      selfMemberName: "Sam",
    });

    const storedKey = update.mock.calls[0]?.[0]?.data?.memberNameKey;
    expect(storedKey).toMatch(/^hbidx:call-circle-member-name:v1:/u);
    expect(storedKey).not.toContain("Sam");

    await refreshCallCircleParticipantMemberNameKey({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
      selfMemberName: null,
    });
    expect(update).toHaveBeenLastCalledWith({
      data: { memberNameKey: null },
      where: { groupId: "hgrp_123", memberId: "member_a" },
    });
  });

  it("advances weekly matching cursors and preserves concurrent edits", async () => {
    const update = vi.fn(async () => ({ count: 1 }));
    const now = new Date("2026-07-06T09:30:00.000Z");
    const weeklyPreferences = storedPreferences();
    const monthlyPreferences = { ...storedPreferences(), cadence: "monthly" as const };
    const invalidPreferences = { invalid: true };

    await advanceCallCircleParticipantMatchingCursors({
      now,
      participants: [
        {
          groupId: "hgrp_123",
          memberId: "member_weekly",
          preferences: weeklyPreferences,
          storedPreferencesJson: weeklyPreferences,
        },
        {
          groupId: "hgrp_123",
          memberId: "member_monthly",
          preferences: monthlyPreferences,
          storedPreferencesJson: monthlyPreferences,
        },
        {
          groupId: "hgrp_123",
          memberId: "member_invalid",
          preferences: null,
          storedPreferencesJson: invalidPreferences,
        },
      ],
      prisma: {
        hostedCallCircleParticipant: { updateMany: update },
      } as never,
    });

    expect(update).toHaveBeenCalledWith({
      data: { nextMatchingAt: new Date("2026-07-13T00:00:00.000Z") },
      where: {
        groupId: "hgrp_123",
        memberId: "member_weekly",
        nextMatchingAt: { lte: now },
        preferencesJson: { equals: weeklyPreferences },
        status: "enrolled",
      },
    });
    expect(update).toHaveBeenCalledWith({
      data: { nextMatchingAt: new Date("2026-07-13T00:00:00.000Z") },
      where: {
        groupId: "hgrp_123",
        memberId: "member_monthly",
        nextMatchingAt: { lte: now },
        preferencesJson: { equals: monthlyPreferences },
        status: "enrolled",
      },
    });
    expect(update).toHaveBeenCalledWith({
      data: { nextMatchingAt: new Date("2026-07-13T00:00:00.000Z") },
      where: {
        groupId: "hgrp_123",
        memberId: "member_invalid",
        nextMatchingAt: { lte: now },
        preferencesJson: { equals: invalidPreferences },
        status: "enrolled",
      },
    });
  });

  it("does not expose an invalid stored timezone to scheduled notification work", async () => {
    const findMany = vi.fn(async () => [
      {
        memberId: "member_a",
        preferencesJson: {
          timeZone: "Not/A_Time_Zone",
          windows: [{
            dayOfWeek: 1,
            endLocalTime: "20:00",
            startLocalTime: "19:00",
          }],
        },
      },
      {
        memberId: "member_b",
        preferencesJson: {
          timeZone: "UTC",
          windows: [{
            dayOfWeek: 1,
            endLocalTime: "20:00",
            startLocalTime: "19:00",
          }],
        },
      },
    ]);
    const prisma = {
      hostedCallCircleParticipant: { findMany },
    };

    await expect(readCallCircleMatchParticipantTimeZones({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBeNull();
  });

  it("requires access, membership, and enrolled rows for an active participant pair", async () => {
    const prisma = {
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 2),
      },
    };

    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedCallCircleParticipant.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: { in: ["member_a", "member_b"] },
        member: {
          hostedGroupMemberships: {
            some: { groupId: "hgrp_123" },
          },
          suspendedAt: null,
        },
        status: "enrolled",
      },
    });

    prisma.hostedCallCircleParticipant.count.mockResolvedValueOnce(1);
    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBe(false);

    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);
  });

  it("reads both active participants and their private preferences for proposal checks", async () => {
    const findMany = vi.fn(async () => [
      {
        memberId: "member_a",
        preferencesJson: storedPreferences([{
          cadence: "never",
          memberId: "member_b",
        }]),
      },
      { memberId: "member_b", preferencesJson: storedPreferences() },
    ]);

    await expect(readActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: { hostedCallCircleParticipant: { findMany } } as never,
    })).resolves.toEqual({
      memberA: {
        memberId: "member_a",
        preferences: storedPreferences([{
          cadence: "never",
          memberId: "member_b",
        }]),
      },
      memberB: {
        memberId: "member_b",
        preferences: storedPreferences(),
      },
    });

    findMany.mockResolvedValueOnce([
      { memberId: "member_a", preferencesJson: storedPreferences() },
      { memberId: "member_b", preferencesJson: storedPreferences() },
    ]);
    await expect(readActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: { hostedCallCircleParticipant: { findMany } } as never,
    })).resolves.toEqual({
      memberA: { memberId: "member_a", preferences: storedPreferences() },
      memberB: { memberId: "member_b", preferences: storedPreferences() },
    });
  });

  it("requires access, membership, and enrollment for a single active participant", async () => {
    const prisma = {
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 1),
      },
    };

    await expect(canUseActiveCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedCallCircleParticipant.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: "member_a",
        member: {
          hostedGroupMemberships: {
            some: { groupId: "hgrp_123" },
          },
          suspendedAt: null,
        },
        status: "enrolled",
      },
    });

    prisma.hostedCallCircleParticipant.count.mockResolvedValueOnce(0);
    await expect(canUseActiveCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);

  });
});

function activePairMatchWhere() {
  return activeCallCircleParticipantPairMatchWhere({
    groupId: "hgrp_123",
    memberAId: "member_a",
    memberBId: "member_b",
  });
}

function storedPreferences(memberCadences: Array<{
  cadence: "weekly" | "biweekly" | "monthly" | "never";
  memberId: string;
}> = []) {
  return {
    cadence: "weekly" as const,
    memberCadences,
    timeZone: "UTC",
    windows: [{
      dayOfWeek: 1 as const,
      endLocalTime: "17:30",
      startLocalTime: "17:00",
    }],
  };
}

function requireCallCircleMemberNameKey(groupId: string, normalizedMemberName: string): string {
  const key = createHostedCallCircleMemberNameLookupKey({
    groupId,
    normalizedMemberName,
  });
  if (!key) throw new Error("Expected a Call Circle member-name lookup key.");
  return key;
}
