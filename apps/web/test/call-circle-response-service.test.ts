import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendCallCircleConfirmNotificationTx: vi.fn(),
  canUseActiveCallCircleParticipantPair: vi.fn(),
  cancelOpenCallCircleMatchesForParticipant: vi.fn(),
  confirmCallCircleMatchSide: vi.fn(),
  counterCallCircleMatchSide: vi.fn(),
  declineCallCircleMatchSide: vi.fn(),
  markCallCircleMatchAmAsked: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  pauseCallCircleParticipant: vi.fn(),
  readCallCircleNotificationSignal: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readCallCircleNotificationPreflightTx: vi.fn(),
  resumeCallCircleParticipant: vi.fn(),
  signalCallCircleNotificationRuntimesBestEffort: vi.fn(),
  writeCallCirclePreferences: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  cancelOpenCallCircleMatchesForParticipant: mocks.cancelOpenCallCircleMatchesForParticipant,
  confirmCallCircleMatchSide: mocks.confirmCallCircleMatchSide,
  counterCallCircleMatchSide: mocks.counterCallCircleMatchSide,
  declineCallCircleMatchSide: mocks.declineCallCircleMatchSide,
  markCallCircleMatchAmAsked: mocks.markCallCircleMatchAmAsked,
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleConfirmNotificationTx: mocks.appendCallCircleConfirmNotificationTx,
  readCallCircleNotificationSignal: mocks.readCallCircleNotificationSignal,
  readCallCircleNotificationPreflightTx: mocks.readCallCircleNotificationPreflightTx,
  signalCallCircleNotificationRuntimesBestEffort: mocks.signalCallCircleNotificationRuntimesBestEffort,
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  canUseActiveCallCircleParticipantPair: mocks.canUseActiveCallCircleParticipantPair,
  pauseCallCircleParticipant: mocks.pauseCallCircleParticipant,
  resumeCallCircleParticipant: mocks.resumeCallCircleParticipant,
  writeCallCirclePreferences: mocks.writeCallCirclePreferences,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import {
  handleCallCircleRespond,
} from "@/src/lib/call-circle/response-service";

const FRESH_CALL_CIRCLE_REPLY_CONTEXT = {
  inboundMailboxItemIds: ["mailbox_reply"],
};
const FRESH_CALL_CIRCLE_REPLY_OCCURRED_AT =
  new Date("2026-07-06T15:00:00.000Z");

describe("handleCallCircleRespond", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmCallCircleMatchSide.mockResolvedValue({ changed: true });
    mocks.counterCallCircleMatchSide.mockResolvedValue({ changed: true });
    mocks.declineCallCircleMatchSide.mockResolvedValue({ changed: true });
    mocks.markCallCircleMatchAmAsked.mockResolvedValue(true);
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(true);
    mocks.cancelOpenCallCircleMatchesForParticipant.mockResolvedValue(1);
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.pauseCallCircleParticipant.mockResolvedValue(true);
    mocks.appendCallCircleConfirmNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_confirm",
      status: "sent",
    });
    mocks.readCallCircleNotificationSignal.mockImplementation(({ memberId, notification }) =>
      notification.status === "sent" && notification.mailboxItemId
        ? { mailboxItemId: notification.mailboxItemId, memberId }
        : null);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readCallCircleNotificationPreflightTx.mockResolvedValue({
      route: { channel: "linq" },
      status: "ok",
    });
    mocks.resumeCallCircleParticipant.mockResolvedValue(true);
    mocks.signalCallCircleNotificationRuntimesBestEffort.mockResolvedValue(undefined);
    mocks.writeCallCirclePreferences.mockResolvedValue(true);
  });

  it("does not let a private preferences response create Call Circle consent", async () => {
    const prisma = createResponsePrisma({ participantStatus: null });

    await expect(handleCallCircleRespond({
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        groupId: "hgrp_123",
        kind: "preferences",
        windows: [{
          dayOfWeek: 1,
          endLocalTime: "17:30",
          startLocalTime: "17:00",
        }],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_not_enrolled",
    });

    expect(mocks.writeCallCirclePreferences).not.toHaveBeenCalled();
  });

  it("records preferences for a paused opted-in participant without resuming", async () => {
    const prisma = createResponsePrisma({ participantStatus: "paused" });

    await expect(handleCallCircleRespond({
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        excludeMemberIds: ["member_skip"],
        groupId: "hgrp_123",
        kind: "preferences",
        windows: [{
          dayOfWeek: 2,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.writeCallCirclePreferences).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_123",
      preferences: {
        excludeMemberIds: ["member_skip"],
        windows: [{
          dayOfWeek: 2,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
      prisma: expect.any(Object),
    });
  });

  it("uses setup notification context for omitted group preferences", async () => {
    const prisma = createResponsePrisma({
      participantGroups: ["hgrp_old", "hgrp_new"],
      participantStatus: "enrolled",
      setupNotificationGroupId: "hgrp_new",
    });

    await expect(handleCallCircleRespond({
      context: { inboundMailboxItemIds: ["mailbox_reply", "mailbox_setup"] },
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        kind: "preferences",
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({ status: "ok" });

    expect(prisma.tx.hostedMailboxItem.findMany).toHaveBeenNthCalledWith(1, {
      select: { dedupeKey: true },
      where: {
        dedupeKey: {
          endsWith: ":member_123",
          startsWith: "assistant.notification.requested:call-circle:setup:",
        },
        id: { in: ["mailbox_reply", "mailbox_setup"] },
        kind: "assistant.notification.requested",
        userId: "member_123",
      },
    });
    expect(mocks.writeCallCirclePreferences).toHaveBeenCalledWith({
      groupId: "hgrp_new",
      memberId: "member_123",
      preferences: {
        excludeMemberIds: [],
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
      prisma: expect.any(Object),
    });
  });

  it("fails closed for omitted group preferences across multiple groups without setup context", async () => {
    const prisma = createResponsePrisma({
      participantGroups: ["hgrp_old", "hgrp_new"],
      participantStatus: "enrolled",
    });

    await expect(handleCallCircleRespond({
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        kind: "preferences",
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    });

    expect(mocks.writeCallCirclePreferences).not.toHaveBeenCalled();
  });

  it("uses the exact setup notification anchor when multiple prior setup prompts exist", async () => {
    const prisma = createResponsePrisma({
      participantGroups: ["hgrp_old", "hgrp_new"],
      participantStatus: "enrolled",
      setupNotificationItems: [
        { groupId: "hgrp_new", id: "mailbox_setup_new" },
        { groupId: "hgrp_old", id: "mailbox_setup_old" },
      ],
    });

    await expect(handleCallCircleRespond({
      context: { inboundMailboxItemIds: ["mailbox_reply", "mailbox_setup_new"] },
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        kind: "preferences",
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.writeCallCirclePreferences).toHaveBeenCalledWith({
      groupId: "hgrp_new",
      memberId: "member_123",
      preferences: {
        excludeMemberIds: [],
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
      prisma: expect.any(Object),
    });
  });

  it("fails closed when model groupId conflicts with exact setup context", async () => {
    const prisma = createResponsePrisma({
      participantGroups: ["hgrp_old", "hgrp_new"],
      participantStatus: "enrolled",
      setupNotificationItems: [
        { groupId: "hgrp_new", id: "mailbox_setup_new" },
      ],
    });

    await expect(handleCallCircleRespond({
      context: { inboundMailboxItemIds: ["mailbox_reply", "mailbox_setup_new"] },
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        groupId: "hgrp_old",
        kind: "preferences",
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    });

    expect(mocks.writeCallCirclePreferences).not.toHaveBeenCalled();
  });

  it("fails closed when reply context contains multiple setup anchors", async () => {
    const prisma = createResponsePrisma({
      participantGroups: ["hgrp_old", "hgrp_new"],
      participantStatus: "enrolled",
      setupNotificationItems: [
        { groupId: "hgrp_new", id: "mailbox_setup_new" },
        { groupId: "hgrp_old", id: "mailbox_setup_old" },
      ],
    });

    await expect(handleCallCircleRespond({
      context: {
        inboundMailboxItemIds: [
          "mailbox_reply",
          "mailbox_setup_new",
          "mailbox_setup_old",
        ],
      },
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        kind: "preferences",
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    });

    expect(mocks.writeCallCirclePreferences).not.toHaveBeenCalled();
  });

  it("fails closed when ambiguous setup context includes a model groupId", async () => {
    const prisma = createResponsePrisma({
      participantGroups: ["hgrp_old", "hgrp_new"],
      participantStatus: "enrolled",
      setupNotificationItems: [
        { groupId: "hgrp_new", id: "mailbox_setup_new" },
        { groupId: "hgrp_old", id: "mailbox_setup_old" },
      ],
    });

    await expect(handleCallCircleRespond({
      context: {
        inboundMailboxItemIds: [
          "mailbox_reply",
          "mailbox_setup_new",
          "mailbox_setup_old",
        ],
      },
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        groupId: "hgrp_old",
        kind: "preferences",
        windows: [{
          dayOfWeek: 4,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_context_unavailable",
    });

    expect(mocks.writeCallCirclePreferences).not.toHaveBeenCalled();
  });

  it("cancels open matches when a participant pauses", async () => {
    const prisma = createResponsePrisma({ participantStatus: "enrolled" });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        groupId: "hgrp_123",
        kind: "pause",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.pauseCallCircleParticipant).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_123",
      prisma: expect.any(Object),
    });
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_123",
      now,
      prisma: expect.any(Object),
    });
  });

  it("rejects match confirmation after the participant pauses", async () => {
    const prisma = createResponsePrisma({ participantStatus: "paused" });

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      prisma: prisma as never,
      request: {
        groupId: "hgrp_123",
        kind: "confirm",
        matchId: "hccm_123",
        side: "A",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_paused",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("derives the pending match side for a simple private confirmation", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-06T14:00:00.000Z"),
        memberAId: "member_other",
        memberBId: "member_123",
      }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        kind: "confirm",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(prisma.tx.hostedCallCircleMatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              memberBId: "member_123",
              sideBResponse: "pending",
            }),
          ]),
        }),
      }),
    );
    expect(mocks.confirmCallCircleMatchSide).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberId: "member_123",
      now,
      prisma: expect.any(Object),
      side: "B",
    });
  });

  it("rejects stale morning confirmations after the final ask resets consent", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-06T09:00:00.000Z"),
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        memberAId: "member_other",
        memberBId: "member_123",
        status: "asking",
      }),
      participantStatus: "enrolled",
      replyOccurredAt: new Date("2026-07-06T14:30:00.000Z"),
    });

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now: FRESH_CALL_CIRCLE_REPLY_OCCURRED_AT,
      prisma: prisma as never,
      request: {
        kind: "confirm",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("accepts confirmations that are newer than the final ask", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-06T09:00:00.000Z"),
        finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
        memberAId: "member_other",
        memberBId: "member_123",
        status: "asking",
      }),
      participantStatus: "enrolled",
      replyOccurredAt: new Date("2026-07-06T14:50:00.000Z"),
    });

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now: FRESH_CALL_CIRCLE_REPLY_OCCURRED_AT,
      prisma: prisma as never,
      request: {
        kind: "confirm",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.confirmCallCircleMatchSide).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberId: "member_123",
      now: FRESH_CALL_CIRCLE_REPLY_OCCURRED_AT,
      prisma: expect.any(Object),
      side: "B",
    });
  });

  it("rejects stale confirmations after an immediate counter reask", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-06T15:05:00.000Z"),
        memberAId: "member_other",
        memberBId: "member_123",
      }),
      participantStatus: "enrolled",
      replyOccurredAt: FRESH_CALL_CIRCLE_REPLY_OCCURRED_AT,
    });

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now: new Date("2026-07-06T15:10:00.000Z"),
      prisma: prisma as never,
      request: {
        kind: "confirm",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("rejects stale match confirmations before the current counter ask is sent", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: null,
        finalAskedAt: null,
        memberAId: "member_other",
        memberBId: "member_123",
      }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        kind: "confirm",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("cancels a match response when the counterpart is no longer active", async () => {
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(false);
    const prisma = createResponsePrisma({
      match: callCircleMatch({ amAskedAt: new Date("2026-07-06T14:00:00.000Z") }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        groupId: "hgrp_123",
        kind: "confirm",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "participant_unavailable",
      prisma: expect.any(Object),
      status: "canceled",
    });
    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("does not reask an inactive counterpart after a counter mutation", async () => {
    mocks.canUseActiveCallCircleParticipantPair
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const prisma = createResponsePrisma({
      match: callCircleMatch({ amAskedAt: new Date("2026-07-06T14:00:00.000Z") }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T16:30:00.000Z",
          startAt: "2026-07-06T16:00:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.counterCallCircleMatchSide).toHaveBeenCalled();
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "participant_unavailable",
      prisma: expect.any(Object),
      status: "canceled",
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("drops a counter after the conditional mutation when the counterpart reask is blocked", async () => {
    mocks.readCallCircleNotificationPreflightTx.mockResolvedValueOnce({
      reason: "missing_recent_inbound",
      status: "blocked",
    });
    const prisma = createResponsePrisma({
      match: callCircleMatch({ amAskedAt: new Date("2026-07-06T14:00:00.000Z") }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T16:30:00.000Z",
          startAt: "2026-07-06T16:00:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "counter_reask_unavailable",
    });

    expect(mocks.counterCallCircleMatchSide).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      matchId: "hccm_123",
      memberId: "member_123",
      now,
      prisma: expect.any(Object),
      side: "A",
      windowEndAt: new Date("2026-07-06T16:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(
      mocks.counterCallCircleMatchSide.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readCallCircleNotificationPreflightTx.mock.invocationCallOrder[0],
    );
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "notification_blocked",
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("ignores a stale explicit counter without dropping the match", async () => {
    mocks.counterCallCircleMatchSide.mockResolvedValueOnce({ changed: false });
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-06T14:00:00.000Z"),
        status: "both_confirmed",
      }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T16:30:00.000Z",
          startAt: "2026-07-06T16:00:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.counterCallCircleMatchSide).toHaveBeenCalled();
    expect(mocks.readCallCircleNotificationPreflightTx).not.toHaveBeenCalled();
    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("rejects an expired explicit match id before recording a response", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-06T14:00:00.000Z"),
        windowEndAt: new Date("2026-07-06T14:30:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      }),
      participantStatus: "enrolled",
      replyOccurredAt: new Date("2026-07-06T15:00:00.000Z"),
    });

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now: new Date("2026-07-06T15:00:00.000Z"),
      prisma: prisma as never,
      request: {
        groupId: "hgrp_123",
        kind: "confirm",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });

    expect(mocks.confirmCallCircleMatchSide).not.toHaveBeenCalled();
    expect(mocks.declineCallCircleMatchSide).not.toHaveBeenCalled();
    expect(mocks.counterCallCircleMatchSide).not.toHaveBeenCalled();
  });

  it("defers a counter reask outside the counterpart's quiet hours", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({
        amAskedAt: new Date("2026-07-07T00:00:00.000Z"),
        memberATimeZone: "America/New_York",
        memberBTimeZone: "America/New_York",
        windowEndAt: new Date("2026-07-07T13:00:00.000Z"),
        windowStartAt: new Date("2026-07-07T12:30:00.000Z"),
      }),
      participantStatus: "enrolled",
      replyOccurredAt: new Date("2026-07-07T01:00:00.000Z"),
    });
    const now = new Date("2026-07-07T01:30:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-07T13:30:00.000Z",
          startAt: "2026-07-07T13:00:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.readCallCircleNotificationPreflightTx).not.toHaveBeenCalled();
    expect(mocks.counterCallCircleMatchSide).toHaveBeenCalled();
    expect(mocks.markCallCircleMatchAmAsked).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("marks a counter ask when sending the immediate counterpart reask", async () => {
    const prisma = createResponsePrisma({
      match: callCircleMatch({ amAskedAt: new Date("2026-07-06T14:00:00.000Z") }),
      participantStatus: "enrolled",
    });
    const now = new Date("2026-07-06T15:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T16:30:00.000Z",
          startAt: "2026-07-06T16:00:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.markCallCircleMatchAmAsked).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      prisma: expect.any(Object),
    });
    expect(mocks.appendCallCircleConfirmNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_other",
        stage: "am",
        windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
      }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_confirm",
      memberId: "member_other",
    }]);
  });

  it("rejects counter windows that cannot receive the final ask during quiet hours", async () => {
    const prisma = createResponsePrisma({ participantStatus: "enrolled" });
    const now = new Date("2026-07-06T07:00:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T09:00:00.000Z",
          startAt: "2026-07-06T08:00:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "counter_window_invalid",
    });

    expect(mocks.readCallCircleNotificationPreflightTx).not.toHaveBeenCalled();
    expect(mocks.counterCallCircleMatchSide).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });

  it("rejects counter windows when the morning reask slot has already passed", async () => {
    const prisma = createResponsePrisma({ participantStatus: "enrolled" });
    const now = new Date("2026-07-06T08:10:00.000Z");

    await expect(handleCallCircleRespond({
      context: FRESH_CALL_CIRCLE_REPLY_CONTEXT,
      memberId: "member_123",
      now,
      prisma: prisma as never,
      request: {
        counterWindow: {
          endAt: "2026-07-06T09:00:00.000Z",
          startAt: "2026-07-06T08:25:00.000Z",
        },
        groupId: "hgrp_123",
        kind: "counter",
        matchId: "hccm_123",
      },
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "counter_window_invalid",
    });

    expect(mocks.readCallCircleNotificationPreflightTx).not.toHaveBeenCalled();
    expect(mocks.counterCallCircleMatchSide).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleConfirmNotificationTx).not.toHaveBeenCalled();
  });
});

function createResponsePrisma(input: {
  match?: ReturnType<typeof callCircleMatch>;
  matches?: Array<ReturnType<typeof callCircleMatch>>;
  memberInGroup?: boolean;
  participantGroups?: string[];
  participantStatus: "enrolled" | "paused" | null;
  replyOccurredAt?: Date;
  setupNotificationGroupId?: string;
  setupNotificationGroupIds?: string[];
  setupNotificationItems?: Array<{
    groupId: string;
    id: string;
  }>;
  setupNotificationOccurredAt?: Date;
}) {
  const match = input.match ?? callCircleMatch();
  const participantGroups = input.participantGroups
    ?? (input.participantStatus === null ? [] : [match.groupId]);
  const hostedMailboxItemFindMany = vi.fn(async (args: {
    where?: {
      id?: { in?: string[] };
      kind?: string;
    };
  }) => {
    if (args.where?.kind === "assistant.notification.requested") {
      const requestedIds = new Set(args.where.id?.in ?? []);
      const setupNotificationItems = input.setupNotificationItems
        ?? (input.setupNotificationGroupIds
          ? input.setupNotificationGroupIds.map((groupId, index) => ({
              groupId,
              id: `mailbox_setup_${index}`,
            }))
          : input.setupNotificationGroupId
            ? [{ groupId: input.setupNotificationGroupId, id: "mailbox_setup" }]
            : []);
      return setupNotificationItems
        .filter((item) => requestedIds.has(item.id))
        .map((item) => ({
            dedupeKey:
              `assistant.notification.requested:call-circle:setup:${item.groupId}:member_123`,
            occurredAt: input.setupNotificationOccurredAt
              ?? new Date("2026-07-06T14:00:00.000Z"),
          }));
    }
    return [{
      occurredAt: input.replyOccurredAt ?? FRESH_CALL_CIRCLE_REPLY_OCCURRED_AT,
    }];
  });
  const tx = {
    hostedCallCircleMatch: {
      findMany: vi.fn(async () => input.matches ?? [match]),
      findUnique: vi.fn(async () => match),
    },
    hostedMailboxItem: {
      findMany: hostedMailboxItemFindMany,
    },
    hostedCallCircleParticipant: {
      findMany: vi.fn(async () => input.participantStatus === null
        ? []
        : participantGroups.map((groupId) => ({ groupId }))),
      findUnique: vi.fn(async () => input.participantStatus === null
        ? null
        : { status: input.participantStatus }),
    },
    hostedGroupMember: {
      findUnique: vi.fn(async () => input.memberInGroup === false
        ? null
        : { id: "hgmem_123" }),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
    tx,
  };
}

function callCircleMatch(input: Partial<{
  amAskedAt: Date | null;
  finalAskedAt: Date | null;
  groupId: string;
  id: string;
  memberAId: string;
  memberATimeZone: string | null;
  memberBId: string;
  memberBTimeZone: string | null;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}> = {}) {
  return {
    amAskedAt: input.amAskedAt === undefined
      ? new Date("2026-07-06T14:00:00.000Z")
      : input.amAskedAt,
    finalAskedAt: input.finalAskedAt === undefined ? null : input.finalAskedAt,
    groupId: input.groupId ?? "hgrp_123",
    id: input.id ?? "hccm_123",
    memberA: { pendingActivationTimeZone: input.memberATimeZone ?? "UTC" },
    memberAId: input.memberAId ?? "member_123",
    memberB: { pendingActivationTimeZone: input.memberBTimeZone ?? "UTC" },
    memberBId: input.memberBId ?? "member_other",
    status: input.status ?? "asking",
    windowEndAt: input.windowEndAt ?? new Date("2026-07-06T16:30:00.000Z"),
    windowStartAt: input.windowStartAt ?? new Date("2026-07-06T16:00:00.000Z"),
  };
}
