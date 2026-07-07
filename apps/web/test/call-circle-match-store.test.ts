import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readActiveHostedMemberAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import {
  cancelOpenCallCircleMatchesForParticipant,
  confirmCallCircleMatchSide as confirmMatchSide,
  counterCallCircleMatchSide as counterMatchSide,
  claimCallCircleMatchForConnector as claimMatchForConnector,
  createCallCircleMatchProposal,
  declineCallCircleMatchSide as declineMatchSide,
  expirePastCallCircleMatches,
  listRecentCallCircleMatches,
  markCallCircleMatchFinalAsked,
  markCallCircleMatchOutcome,
  readLastCallCirclePartnerMemberIds,
} from "@/src/lib/call-circle/match-store";
import {
  canAppendCallCircleSetupNotification,
  canUseActiveCallCircleParticipant,
  canUseActiveCallCircleParticipantPair,
  enrollCallCircleParticipant,
  pauseCallCircleParticipant,
  resumeCallCircleParticipant,
  writeCallCirclePreferences,
} from "@/src/lib/call-circle/participant-store";

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
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(confirmMatchSide({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberId: "member_a",
      now,
      prisma: prisma as never,
      side: "A",
    })).resolves.toEqual({ changed: true, matchId: "hccm_123" });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        sideAResponse: "confirmed",
        status: "asking",
      },
      where: {
        groupId: "hgrp_123",
        id: "hccm_123",
        memberAId: "member_a",
        OR: [
          { amAskedAt: { not: null } },
          { finalAskedAt: { not: null } },
        ],
        sideAResponse: "pending",
        status: { in: ["proposed", "asking"] },
        windowEndAt: { gt: now },
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

  it("uses a single conditional updateMany for a counter window", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const windowStartAt = new Date("2026-07-06T16:00:00.000Z");
    const windowEndAt = new Date("2026-07-06T16:30:00.000Z");

    await expect(counterMatchSide({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberId: "member_b",
      now: new Date("2026-07-06T15:00:00.000Z"),
      prisma: prisma as never,
      side: "B",
      windowEndAt,
      windowStartAt,
    })).resolves.toEqual({ changed: true, matchId: "hccm_123" });

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
        counterUsedB: false,
        groupId: "hgrp_123",
        id: "hccm_123",
        memberBId: "member_b",
        OR: [
          { amAskedAt: { not: null } },
          { finalAskedAt: { not: null } },
        ],
        sideBResponse: "pending",
        status: { in: ["proposed", "asking"] },
        windowEndAt: { gt: new Date("2026-07-06T15:00:00.000Z") },
      },
    });
  });

  it("declines a final confirmed match so a late no can stop the bridge", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(declineMatchSide({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberId: "member_a",
      now,
      prisma: prisma as never,
      side: "A",
    })).resolves.toEqual({ changed: true, matchId: "hccm_123" });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: now,
        outcome: "declined_by_a",
        sideAResponse: "declined",
        status: "dropped",
      },
      where: {
        groupId: "hgrp_123",
        id: "hccm_123",
        memberAId: "member_a",
        OR: [
          {
            OR: [
              { amAskedAt: { not: null } },
              { finalAskedAt: { not: null } },
            ],
            sideAResponse: "pending",
            status: { in: ["proposed", "asking"] },
          },
          { status: "both_confirmed" },
        ],
        windowEndAt: { gt: now },
      },
    });
  });

  it("resets side responses when sending the final confirmation ask", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T14:45:00.000Z");

    await expect(markCallCircleMatchFinalAsked({
      matchId: "hccm_123",
      now,
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        finalAskedAt: now,
        sideAResponse: "pending",
        sideBResponse: "pending",
        status: "asking",
      },
      where: {
        finalAskedAt: null,
        id: "hccm_123",
        status: "both_confirmed",
      },
    });
  });

  it("keeps an explicit null phone-call guard when marking an outcome", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:45:00.000Z");

    await expect(markCallCircleMatchOutcome({
      matchId: "hccm_123",
      now,
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: prisma as never,
      status: "dropped",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: now,
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

  it("leaves final-confirmed matches for scheduler handoff instead of generic expiry", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:45:00.000Z");

    await expect(expirePastCallCircleMatches({
      now,
      prisma: prisma as never,
    })).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: now,
        outcome: "expired",
        status: "expired",
      },
      where: {
        OR: [
          { status: { in: ["proposed", "asking"] } },
          { finalAskedAt: null, status: "both_confirmed" },
        ],
        windowEndAt: { lte: now },
      },
    });
  });

  it("claims connector work only after the pair is still active", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 2),
      },
      hostedGroupMember: {
        count: vi.fn(async () => 2),
      },
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
        claimedAt: now,
        status: "bridging",
      },
      where: {
        claimedAt: null,
        finalAskedAt: { not: null },
        id: "hccm_123",
        status: "both_confirmed",
        windowEndAt: { gt: now },
        windowStartAt: { lte: now },
      },
    });
  });

  it("does not create a proposal or advance lastMatchedAt when the pair is inactive", async () => {
    const create = vi.fn();
    const participantUpdateMany = vi.fn();
    const prisma = {
      hostedCallCircleMatch: { create },
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 2),
        updateMany: participantUpdateMany,
      },
      hostedGroupMember: {
        count: vi.fn(async () => 1),
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
    expect(participantUpdateMany).not.toHaveBeenCalled();
  });

  it("claims both participants before creating a weekly proposal", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const create = vi.fn(async () => ({
      id: "hccm_123",
    }));
    const participantUpdateMany = vi.fn(async () => ({ count: 2 }));
    const tx = {
      hostedCallCircleMatch: { create },
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 2),
        updateMany: participantUpdateMany,
      },
      hostedGroupMember: {
        count: vi.fn(async () => 2),
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
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      prisma: prisma as never,
    })).resolves.toEqual({ id: "hccm_123" });

    expect(participantUpdateMany).toHaveBeenCalledWith({
      data: { lastMatchedAt: now },
      where: {
        groupId: "hgrp_123",
        memberId: { in: ["member_a", "member_b"] },
        OR: [
          { lastMatchedAt: null },
          {
            lastMatchedAt: {
              lt: new Date("2026-06-29T15:00:00.000Z"),
            },
          },
        ],
        preferencesJson: { not: Prisma.DbNull },
        status: "enrolled",
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
        windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
    });
    expect(participantUpdateMany.mock.invocationCallOrder[0])
      .toBeLessThan(create.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not create a proposal when another scheduler already claimed one participant", async () => {
    const create = vi.fn();
    const tx = {
      hostedCallCircleMatch: { create },
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 2),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedGroupMember: {
        count: vi.fn(async () => 2),
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

    expect(create).not.toHaveBeenCalled();
  });

  it("ignores notification-blocked dropped rows when reading recent match history", async () => {
    const findMany = vi.fn(async () => []);
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = {
      hostedCallCircleMatch: { findMany },
    };

    await expect(listRecentCallCircleMatches({
      groupId: "hgrp_123",
      now,
      prisma: prisma as never,
    })).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        memberAId: true,
        memberBId: true,
        status: true,
        windowStartAt: true,
      },
      where: {
        createdAt: {
          gte: new Date("2026-06-29T15:00:00.000Z"),
        },
        groupId: "hgrp_123",
        NOT: [
          { status: "canceled" },
          {
            outcome: "notification_blocked",
            status: "dropped",
          },
        ],
      },
    });
  });

  it("reads each participant's last partner from blocking match history", async () => {
    const findFirst = vi.fn(async (input: {
      where: {
        OR: Array<{ memberAId?: string; memberBId?: string }>;
      };
    }) => {
      const memberId = input.where.OR[0]?.memberAId ?? input.where.OR[1]?.memberBId;
      if (memberId === "member_a") {
        return {
          memberAId: "member_a",
          memberBId: "member_b",
        };
      }
      if (memberId === "member_c") {
        return {
          memberAId: "member_d",
          memberBId: "member_c",
        };
      }
      return null;
    });
    const prisma = {
      hostedCallCircleMatch: { findFirst },
    };

    await expect(readLastCallCirclePartnerMemberIds({
      groupId: "hgrp_123",
      memberIds: ["member_a", "member_c", "member_missing", "member_a"],
      prisma: prisma as never,
    })).resolves.toEqual(new Map([
      ["member_a", "member_b"],
      ["member_c", "member_d"],
    ]));

    expect(findFirst).toHaveBeenCalledTimes(3);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" },
      select: {
        memberAId: true,
        memberBId: true,
      },
      where: expect.objectContaining({
        groupId: "hgrp_123",
        NOT: [
          { status: "canceled" },
          {
            outcome: "notification_blocked",
            status: "dropped",
          },
        ],
      }),
    }));
  });

  it("does not claim connector work after a pair becomes inactive", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 1),
      },
      hostedGroupMember: {
        count: vi.fn(async () => 2),
      },
    };

    await expect(claimMatchForConnector({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now: new Date("2026-07-06T15:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("cancels open matches for a paused participant in the current group", async () => {
    const prisma = {
      hostedCallCircleMatch: { updateMany },
    };
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(cancelOpenCallCircleMatchesForParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      now,
      prisma: prisma as never,
    })).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: now,
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
            ],
          },
        ],
      },
    });
  });

  it("pauses and resumes participants through status-guarded updateMany calls", async () => {
    const prisma = {
      hostedCallCircleParticipant: { updateMany },
    };

    await expect(pauseCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_123",
      prisma: prisma as never,
    })).resolves.toBe(true);
    await expect(resumeCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_123",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: { status: "paused" },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
        status: "enrolled",
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: { status: "enrolled" },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
        status: "paused",
      },
    });
  });

  it("leaves a paused participant paused when enrollment is replayed", async () => {
    const existing = {
      createdAt: new Date("2026-07-06T14:00:00.000Z"),
      groupId: "hgrp_123",
      id: "hccp_123",
      lastMatchedAt: null,
      memberId: "member_123",
      preferencesJson: {
        excludeMemberIds: [],
        windows: [{
          dayOfWeek: 1,
          endLocalTime: "17:30",
          startLocalTime: "17:00",
        }],
      },
      status: "paused",
      updatedAt: new Date("2026-07-06T14:30:00.000Z"),
    };
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        clientVersion: "test",
        code: "P2002",
      });
    });
    const findUniqueOrThrow = vi.fn(async () => existing);
    const update = vi.fn();
    const prisma = {
      hostedCallCircleParticipant: {
        create,
        findUniqueOrThrow,
        update,
      },
    };

    await expect(enrollCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_123",
      now: new Date("2026-07-06T15:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toBe(existing);

    expect(update).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: {
        groupId_memberId: {
          groupId: "hgrp_123",
          memberId: "member_123",
        },
      },
    });
  });

  it("writes preferences only to an existing participant without changing enrollment", async () => {
    const prisma = {
      hostedCallCircleParticipant: { updateMany },
    };
    const preferences = {
      excludeMemberIds: ["member_skip"],
      windows: [{
        dayOfWeek: 1,
        endLocalTime: "17:30",
        startLocalTime: "17:00",
      }],
    };

    await expect(writeCallCirclePreferences({
      groupId: "hgrp_123",
      memberId: "member_123",
      preferences,
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        preferencesJson: preferences,
      },
      where: {
        groupId: "hgrp_123",
        memberId: "member_123",
      },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(writeCallCirclePreferences({
      groupId: "hgrp_missing",
      memberId: "member_123",
      preferences,
      prisma: prisma as never,
    })).resolves.toBe(false);
  });

  it("requires access, membership, and enrolled rows for an active participant pair", async () => {
    const prisma = {
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 2),
      },
      hostedGroupMember: {
        count: vi.fn(async () => 2),
      },
    };

    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedGroupMember.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: { in: ["member_a", "member_b"] },
      },
    });
    expect(prisma.hostedCallCircleParticipant.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: { in: ["member_a", "member_b"] },
        status: "enrolled",
      },
    });

    prisma.hostedGroupMember.count.mockResolvedValueOnce(1);
    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBe(false);

    prisma.hostedCallCircleParticipant.count.mockResolvedValueOnce(1);
    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBe(false);

    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    await expect(canUseActiveCallCircleParticipantPair({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: prisma as never,
    })).resolves.toBe(false);
  });

  it("requires access, membership, and enrollment for a single active participant", async () => {
    const prisma = {
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 1),
      },
      hostedGroupMember: {
        count: vi.fn(async () => 1),
      },
    };

    await expect(canUseActiveCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedGroupMember.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: "member_a",
      },
    });
    expect(prisma.hostedCallCircleParticipant.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: "member_a",
        status: "enrolled",
      },
    });

    prisma.hostedGroupMember.count.mockResolvedValueOnce(0);
    await expect(canUseActiveCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);

    prisma.hostedCallCircleParticipant.count.mockResolvedValueOnce(0);
    await expect(canUseActiveCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);

    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    await expect(canUseActiveCallCircleParticipant({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);
  });

  it("requires active access, membership, and no-preferences enrollment before setup notification append", async () => {
    const prisma = {
      hostedCallCircleParticipant: {
        count: vi.fn(async () => 1),
      },
      hostedGroupMember: {
        count: vi.fn(async () => 1),
      },
    };

    await expect(canAppendCallCircleSetupNotification({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedGroupMember.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: "member_a",
      },
    });
    expect(prisma.hostedCallCircleParticipant.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: "member_a",
        preferencesJson: { equals: Prisma.DbNull },
        status: "enrolled",
      },
    });

    prisma.hostedGroupMember.count.mockResolvedValueOnce(0);
    await expect(canAppendCallCircleSetupNotification({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);

    prisma.hostedCallCircleParticipant.count.mockResolvedValueOnce(0);
    await expect(canAppendCallCircleSetupNotification({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);

    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    await expect(canAppendCallCircleSetupNotification({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: prisma as never,
    })).resolves.toBe(false);
  });
});
