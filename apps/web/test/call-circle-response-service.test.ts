import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  canUseActiveCallCircleParticipantPair: vi.fn(),
  cancelOpenCallCircleMatchesForParticipant: vi.fn(),
  confirmCallCircleMatchSide: vi.fn(),
  counterCallCircleMatchSide: vi.fn(),
  declineCallCircleMatchSide: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  pauseCallCircleParticipant: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readCallCircleMatchParticipantTimeZones: vi.fn(),
  resumeCallCircleParticipant: vi.fn(),
  writeCallCirclePreferences: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  cancelOpenCallCircleMatchesForParticipant: mocks.cancelOpenCallCircleMatchesForParticipant,
  confirmCallCircleMatchSide: mocks.confirmCallCircleMatchSide,
  counterCallCircleMatchSide: mocks.counterCallCircleMatchSide,
  declineCallCircleMatchSide: mocks.declineCallCircleMatchSide,
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  canUseActiveCallCircleParticipantPair: mocks.canUseActiveCallCircleParticipantPair,
  pauseCallCircleParticipant: mocks.pauseCallCircleParticipant,
  readCallCircleMatchParticipantTimeZones: mocks.readCallCircleMatchParticipantTimeZones,
  resumeCallCircleParticipant: mocks.resumeCallCircleParticipant,
  writeCallCirclePreferences: mocks.writeCallCirclePreferences,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import { handleCallCircleRespond } from "@/src/lib/call-circle/response-service";

const NOW = new Date("2026-07-06T14:00:00.000Z");
const WINDOW_START = new Date("2026-07-06T16:00:00.000Z");
const SETUP_CONTEXT = {
  inboundMailboxItemIds: ["mailbox_setup", "mailbox_reply"],
};
const CONFIRM_CONTEXT = {
  inboundMailboxItemIds: ["mailbox_confirm", "mailbox_reply"],
};

describe("handleCallCircleRespond", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(true);
    mocks.cancelOpenCallCircleMatchesForParticipant.mockResolvedValue(1);
    mocks.confirmCallCircleMatchSide.mockResolvedValue(true);
    mocks.counterCallCircleMatchSide.mockResolvedValue(true);
    mocks.declineCallCircleMatchSide.mockResolvedValue(true);
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.pauseCallCircleParticipant.mockResolvedValue(true);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue({
      memberATimeZone: "UTC",
      memberBTimeZone: "UTC",
    });
    mocks.resumeCallCircleParticipant.mockResolvedValue(true);
    mocks.writeCallCirclePreferences.mockResolvedValue("updated");
  });

  it("records preferences only for an enrolled member in the exact setup context", async () => {
    const prisma = createResponsePrisma();
    const windows = [{
      dayOfWeek: 1,
      endLocalTime: "17:30",
      startLocalTime: "17:00",
    }];

    await expect(handleCallCircleRespond({
      context: SETUP_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: {
        kind: "preferences",
        timeZone: "UTC",
        windows,
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.writeCallCirclePreferences).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_a",
      now: NOW,
      patch: {
        timeZone: "UTC",
        windows,
      },
      prisma: prisma.tx,
    });
  });

  it("stores a private per-member cadence without canceling open work", async () => {
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: SETUP_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: {
        kind: "preferences",
        memberCadenceUpdates: [{
          cadence: "never",
          memberId: "member_housemate",
        }],
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.writeCallCirclePreferences).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_a",
      now: NOW,
      patch: {
        memberCadenceUpdates: [{
          cadence: "never",
          memberId: "member_housemate",
        }],
      },
      prisma: prisma.tx,
    });
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).not.toHaveBeenCalled();
  });

  it("returns a generic failure for invalid member cadence targets", async () => {
    mocks.writeCallCirclePreferences.mockResolvedValue("invalid_member_cadences");

    await expect(handleCallCircleRespond({
      context: SETUP_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: createResponsePrisma() as never,
      request: {
        kind: "preferences",
        memberCadenceUpdates: [{
          cadence: "never",
          memberId: "member_unknown",
        }],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_member_cadences_invalid",
    });
  });

  it("does not let a private response create enrollment", async () => {
    const prisma = createResponsePrisma({ participantStatus: null });

    await expect(handleCallCircleRespond({
      context: SETUP_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: {
        kind: "preferences",
        timeZone: "UTC",
        windows: [],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_not_enrolled",
    });

    expect(mocks.writeCallCirclePreferences).not.toHaveBeenCalled();
  });

  it("uses the sole enrolled group only for lifecycle actions", async () => {
    const prisma = createResponsePrisma({ setupGroupId: null });

    await expect(handleCallCircleRespond({
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "pause" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.pauseCallCircleParticipant).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_a",
      now: NOW,
      prisma: prisma.tx,
    });
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_a",
      prisma: prisma.tx,
    });
  });

  it("routes a repeated pause through the same locked lifecycle primitive", async () => {
    const prisma = createResponsePrisma({
      participantStatus: "paused",
      setupGroupId: null,
    });

    await expect(handleCallCircleRespond({
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "pause" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.pauseCallCircleParticipant).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_a",
      now: NOW,
      prisma: prisma.tx,
    });
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).toHaveBeenCalledOnce();
  });

  it("rejects lifecycle actions when setup and confirmation anchors name different groups", async () => {
    const prisma = createResponsePrisma({ setupGroupId: "group_2" });

    await expect(handleCallCircleRespond({
      context: {
        inboundMailboxItemIds: [
          "mailbox_setup",
          "mailbox_confirm",
          "mailbox_reply",
        ],
      },
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "pause" },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    });

    expect(mocks.pauseCallCircleParticipant).not.toHaveBeenCalled();
  });

  it("ignores participant rows for groups the member has left", async () => {
    const prisma = createResponsePrisma({
      orphanParticipantGroups: ["group_left"],
      setupGroupId: null,
    });

    await expect(handleCallCircleRespond({
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "pause" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.pauseCallCircleParticipant).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_a",
      now: NOW,
      prisma: prisma.tx,
    });
  });

  it("derives match identity and side only from a current notification anchor", async () => {
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "confirm" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.confirmCallCircleMatchSide).toHaveBeenCalledWith({
      expectedAsk: {
        amAskedAt: NOW,
        finalAskedAt: null,
        windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
        windowStartAt: WINDOW_START,
      },
      groupId: "group_1",
      matchId: "match_1",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_a",
      now: NOW,
      prisma: prisma.tx,
      side: "A",
    });
    expect(prisma.tx.hostedMailboxItem.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.readCallCircleMatchParticipantTimeZones).not.toHaveBeenCalled();
  });

  it("records a decline without reading participant preferences", async () => {
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue(null);
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "decline" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.declineCallCircleMatchSide).toHaveBeenCalledTimes(1);
    expect(mocks.readCallCircleMatchParticipantTimeZones).not.toHaveBeenCalled();
  });

  it("accepts an exact retry after this side was already confirmed", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({ sideAResponse: "confirmed" }),
    });

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "confirm" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("accepts an exact retry after this side's decline was applied", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        outcome: "declined_by_a",
        sideAResponse: "declined",
        status: "dropped",
      }),
    });

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "decline" },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.declineCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("fails closed without an exact match notification anchor", async () => {
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: { inboundMailboxItemIds: ["mailbox_reply"] },
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "confirm" },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("rejects stale anchors after the match window changes", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        windowStartAt: new Date("2026-07-06T17:00:00.000Z"),
      }),
    });

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "decline" },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.declineCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("rejects a morning-stage reply after the final-ask cutoff of a long window", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        windowEndAt: new Date("2026-07-13T16:00:00.000Z"),
      }),
      replyOccurredAt: new Date("2026-07-06T15:41:00.000Z"),
    });

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: new Date("2026-07-06T15:41:00.000Z"),
      prisma: prisma as never,
      request: { kind: "confirm" },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("records one valid counter through the same anchored authority path", async () => {
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T16:30:00.000Z",
          startAt: "2026-07-06T16:00:00.000Z",
        },
        kind: "counter",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.counterCallCircleMatchSide).toHaveBeenCalledWith({
      expectedAsk: {
        amAskedAt: NOW,
        finalAskedAt: null,
        windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
        windowStartAt: WINDOW_START,
      },
      groupId: "group_1",
      matchId: "match_1",
      memberAId: "member_a",
      memberBId: "member_b",
      memberId: "member_a",
      now: NOW,
      prisma: prisma.tx,
      side: "A",
      windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
      windowStartAt: WINDOW_START,
    });
    expect(mocks.readCallCircleMatchParticipantTimeZones).toHaveBeenCalledTimes(1);
  });

  it("rejects a counter when participant timezones are unavailable", async () => {
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue(null);
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T16:30:00.000Z",
          startAt: "2026-07-06T16:00:00.000Z",
        },
        kind: "counter",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "counter_window_invalid",
    });

    expect(mocks.counterCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it.each([
    {
      endAt: "2026-07-06T16:05:00.000Z",
      startAt: "2026-07-06T16:00:00.000Z",
    },
    {
      endAt: "2026-07-06T14:45:00.000Z",
      startAt: "2026-07-06T14:30:00.000Z",
    },
  ])("rejects a counter the scheduler cannot complete ($startAt)", async (counterWindow) => {
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { counterWindow, kind: "counter" },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "counter_window_invalid",
    });

    expect(mocks.counterCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("terminalizes the match when participant authority is lost", async () => {
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(false);
    const prisma = createResponsePrisma();

    await expect(handleCallCircleRespond({
      context: CONFIRM_CONTEXT,
      memberId: "member_a",
      now: NOW,
      prisma: prisma as never,
      request: { kind: "confirm" },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "match_1",
      outcome: "participant_unavailable",
      prisma: prisma.tx,
      status: "canceled",
    });
  });
});

function createResponsePrisma(input: {
  match?: ReturnType<typeof callCircleMatch>;
  orphanParticipantGroups?: string[];
  participantGroups?: string[];
  participantStatus?: "enrolled" | "paused" | null;
  replyOccurredAt?: Date;
  setupGroupId?: string | null;
} = {}) {
  const match = input.match ?? callCircleMatch();
  const participantStatus = input.participantStatus === undefined
    ? "enrolled"
    : input.participantStatus;
  const participantGroups = input.participantGroups
    ?? (participantStatus === null ? [] : [match.groupId]);
  const setupGroupId = input.setupGroupId === undefined
    ? match.groupId
    : input.setupGroupId;

  const tx = {
    hostedCallCircleMatch: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === match.id ? match : null),
    },
    hostedCallCircleParticipant: {
      findMany: vi.fn(async (args: {
        where?: {
          group?: { members?: { some?: { memberId?: string } } };
        };
      }) => {
        const groups = args.where?.group?.members?.some?.memberId === "member_a"
          ? participantGroups
          : [...participantGroups, ...(input.orphanParticipantGroups ?? [])];
        return groups.map((groupId) => ({ groupId }));
      }),
      findUnique: vi.fn(async () =>
        participantStatus === null ? null : { status: participantStatus }),
    },
    hostedGroupMember: {
      findUnique: vi.fn(async () => ({ id: "membership_1" })),
    },
    hostedMailboxItem: {
      findMany: vi.fn(async (args: {
        where?: { id?: { in?: string[] } };
      }) => {
        const ids = new Set(args.where?.id?.in ?? []);
        return [
          ...(setupGroupId && ids.has("mailbox_setup")
            ? [{
                dedupeKey:
                  `assistant.notification.requested:call-circle:setup:${setupGroupId}:member_a`,
                kind: "assistant.notification.requested",
                occurredAt: NOW,
              }]
            : []),
          ...(ids.has("mailbox_confirm")
            ? [{
                dedupeKey: [
                  "assistant.notification.requested",
                  "call-circle",
                  "am",
                  match.id,
                  "member_a",
                  WINDOW_START.toISOString(),
                ].join(":"),
                kind: "assistant.notification.requested",
                occurredAt: NOW,
              }]
            : []),
          ...(ids.has("mailbox_reply")
            ? [{
                dedupeKey: "conversation:reply",
                kind: "conversation.message",
                occurredAt: input.replyOccurredAt
                  ?? new Date("2026-07-06T15:00:00.000Z"),
              }]
            : []),
        ];
      }),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx)),
    tx,
  };
}

function callCircleMatch(input: Partial<{
  amAskedAt: Date | null;
  finalAskedAt: Date | null;
  groupId: string;
  id: string;
  memberAId: string;
  memberBId: string;
  outcome: string | null;
  sideAResponse: string;
  sideBResponse: string;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}> = {}) {
  return {
    amAskedAt: input.amAskedAt === undefined ? NOW : input.amAskedAt,
    finalAskedAt: input.finalAskedAt ?? null,
    groupId: input.groupId ?? "group_1",
    id: input.id ?? "match_1",
    memberAId: input.memberAId ?? "member_a",
    memberBId: input.memberBId ?? "member_b",
    outcome: input.outcome ?? null,
    sideAResponse: input.sideAResponse ?? "pending",
    sideBResponse: input.sideBResponse ?? "pending",
    status: input.status ?? "asking",
    windowEndAt:
      input.windowEndAt ?? new Date("2026-07-06T16:30:00.000Z"),
    windowStartAt: input.windowStartAt ?? WINDOW_START,
  };
}
