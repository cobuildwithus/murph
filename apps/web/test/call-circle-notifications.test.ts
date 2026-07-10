import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendHostedAssistantNotificationTx: vi.fn(),
  canUseActiveCallCircleParticipant: vi.fn(),
  hasHostedLinqInboundWithinDays: vi.fn(),
  readCallCircleMatchParticipantTimeZones: vi.fn(),
  resolveHostedAssistantNotificationTargetTx: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/assistant-notifications", () => ({
  appendHostedAssistantNotificationTx: mocks.appendHostedAssistantNotificationTx,
  resolveHostedAssistantNotificationTargetTx: mocks.resolveHostedAssistantNotificationTargetTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  hasHostedLinqInboundWithinDays: mocks.hasHostedLinqInboundWithinDays,
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  activeCallCircleParticipantWhere: ({ groupId, memberId }: {
    groupId: string;
    memberId: string;
  }) => ({ groupId, memberId, status: "enrolled" }),
  canUseActiveCallCircleParticipant: mocks.canUseActiveCallCircleParticipant,
  readCallCircleMatchParticipantTimeZones:
    mocks.readCallCircleMatchParticipantTimeZones,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  appendCallCircleConfirmNotificationTx,
  appendCallCircleSetupNotificationTx,
  appendCallCircleTerminalNotificationIfReachableTx,
  appendCallCircleTerminalNotificationsTx,
  buildCallCircleTerminalNotificationEventId,
  readCallCircleConfirmNotificationAnchor,
  readCallCircleNotificationPreflightTx,
  readCallCircleSetupNotificationGroupId,
} from "@/src/lib/call-circle/notifications";

describe("Call Circle notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedAssistantNotificationTx.mockResolvedValue({
      mailboxItemId: "hmi_123",
    });
    mocks.canUseActiveCallCircleParticipant.mockResolvedValue(true);
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(true);
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue({
      memberATimeZone: "America/Los_Angeles",
      memberBTimeZone: "America/New_York",
    });
    mocks.resolveHostedAssistantNotificationTargetTx.mockResolvedValue({
      linqSourceLineLookupKey: "line_1",
      route: {
        actorId: "+15550002222",
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_123",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: "chat_123",
        threadIsDirect: true,
      },
    });
  });

  it("round-trips the writer's confirmation anchor through the response parser", async () => {
    const windowStartAt = new Date("2026-07-06T15:00:00.000Z");
    await appendCallCircleConfirmNotificationTx({
      matchId: "hccm_123",
      memberId: "member_b",
      now: new Date("2026-07-06T09:00:00.000Z"),
      preflight: {
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: { kind: "thread", target: "chat_123" },
          identityId: "hbidx:phone:v1:test",
          threadId: "chat_123",
          threadIsDirect: true,
        },
        status: "ok",
      },
      stage: "am",
      tx: createNotificationTx() as never,
      windowLabel: "Mon at 11:00 AM",
      windowStartAt,
    });
    const eventId = mocks.appendHostedAssistantNotificationTx.mock.calls[0]?.[0]?.eventId;

    expect(eventId).toBe(
      "assistant.notification.requested:call-circle:am:hccm_123:member_b:2026-07-06T15:00:00.000Z",
    );
    expect(readCallCircleConfirmNotificationAnchor({
      eventId,
      memberId: "member_b",
    })).toEqual({
      key: "am:hccm_123:2026-07-06T15:00:00.000Z",
      matchId: "hccm_123",
      stage: "am",
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
  });

  it("can key setup notifications by a fresh offer anchor", () => {
    const offerEventId =
      "assistant.notification.requested:call-circle:setup:hgrp_123:member_a:offer:hgjo_123";
    expect(readCallCircleSetupNotificationGroupId({
      eventId: offerEventId,
      memberId: "member_a",
    })).toBe("hgrp_123");
  });

  it("owns terminal notification identity and reachable append in one primitive", async () => {
    const tx = createNotificationTx();

    expect(buildCallCircleTerminalNotificationEventId({
      kind: "handoff",
      matchId: "hccm_123",
      memberId: "member_a",
    })).toBe(
      "assistant.notification.requested:call-circle:handoff:hccm_123:member_a",
    );
    await expect(appendCallCircleTerminalNotificationIfReachableTx({
      groupId: "hgrp_123",
      kind: "outcome",
      matchId: "hccm_123",
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "America/New_York",
      tx: tx as never,
    })).resolves.toEqual({
      mailboxItemId: "hmi_123",
      status: "sent",
    });
    expect(mocks.appendHostedAssistantNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId:
          "assistant.notification.requested:call-circle:outcome:hccm_123:member_a",
      }),
    );
  });

  it("blocks scheduled Call Circle notifications outside member daytime", async () => {
    const tx = createNotificationTx();

    await expect(readCallCircleNotificationPreflightTx({
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      timeZone: "America/New_York",
      tx: tx as never,
    })).resolves.toEqual({
      reason: "quiet_hours",
      status: "blocked",
    });

    expect(mocks.appendHostedAssistantNotificationTx).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid stored timezone for non-handoff terminal copy", async () => {
    const tx = createNotificationTx();

    await expect(appendCallCircleTerminalNotificationIfReachableTx({
      groupId: "hgrp_123",
      kind: "outcome",
      matchId: "hccm_123",
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "Not/A_Time_Zone",
      tx: tx as never,
    })).resolves.toBeNull();

    expect(mocks.appendHostedAssistantNotificationTx).not.toHaveBeenCalled();
  });

  it("delivers terminal handoff copy even when the bridge ends during quiet hours", async () => {
    await expect(appendCallCircleTerminalNotificationIfReachableTx({
      groupId: "hgrp_123",
      kind: "handoff",
      matchId: "hccm_123",
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      timeZone: "America/New_York",
      tx: createNotificationTx() as never,
    })).resolves.toEqual({
      mailboxItemId: "hmi_123",
      status: "sent",
    });
  });

  it("treats setup as an immediate follow-up while retaining route gates", async () => {
    const tx = createNotificationTx();

    await expect(appendCallCircleSetupNotificationTx({
      groupId: "hgrp_123",
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      tx: tx as never,
    })).resolves.toEqual({
      mailboxItemId: "hmi_123",
      status: "sent",
    });
    expect(tx.hostedCallCircleParticipant.count).toHaveBeenCalledWith({
      where: {
        groupId: "hgrp_123",
        memberId: "member_a",
        preferencesJson: { equals: Prisma.DbNull },
        status: "enrolled",
      },
    });
  });

  it("defers scheduler-retried setup asks outside member daytime", async () => {
    await expect(appendCallCircleSetupNotificationTx({
      groupId: "hgrp_123",
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      requireDaytime: true,
      timeZone: "America/New_York",
      tx: createNotificationTx() as never,
    })).resolves.toEqual({
      reason: "quiet_hours",
      status: "blocked",
    });
    expect(mocks.appendHostedAssistantNotificationTx).not.toHaveBeenCalled();
  });

  it("does not append setup after participant authority is lost", async () => {
    const tx = createNotificationTx();
    tx.hostedCallCircleParticipant.count.mockResolvedValueOnce(0);

    await expect(appendCallCircleSetupNotificationTx({
      groupId: "hgrp_123",
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      tx: tx as never,
    })).resolves.toBeNull();

    expect(mocks.resolveHostedAssistantNotificationTargetTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedAssistantNotificationTx).not.toHaveBeenCalled();
  });

  it("does not notify a member after current Call Circle authority is lost", async () => {
    mocks.canUseActiveCallCircleParticipant.mockResolvedValue(false);

    await expect(appendCallCircleTerminalNotificationIfReachableTx({
      groupId: "hgrp_123",
      kind: "outcome",
      matchId: "hccm_123",
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "America/New_York",
      tx: createNotificationTx() as never,
    })).resolves.toBeNull();

    expect(mocks.canUseActiveCallCircleParticipant).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberId: "member_a",
      prisma: expect.any(Object),
    });
    expect(mocks.resolveHostedAssistantNotificationTargetTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedAssistantNotificationTx).not.toHaveBeenCalled();
  });

  it("owns both terminal notifications and their timezone lookup in one transaction", async () => {
    const tx = createNotificationTx();

    await expect(appendCallCircleTerminalNotificationsTx({
      groupId: "hgrp_123",
      kind: "outcome",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now: new Date("2026-07-06T18:00:00.000Z"),
      tx: tx as never,
    })).resolves.toEqual([
      { mailboxItemId: "hmi_123", memberId: "member_a" },
      { mailboxItemId: "hmi_123", memberId: "member_b" },
    ]);

    expect(mocks.readCallCircleMatchParticipantTimeZones).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      prisma: tx,
    });
    expect(mocks.appendHostedAssistantNotificationTx).toHaveBeenCalledTimes(2);
  });

  it("blocks Linq Call Circle notifications without a recent inbound day", async () => {
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);
    const tx = createNotificationTx();

    await expect(readCallCircleNotificationPreflightTx({
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "America/New_York",
      tx: tx as never,
    })).resolves.toEqual({
      reason: "missing_recent_inbound",
      status: "blocked",
    });
  });

  it("blocks Linq participant routes that runtime egress cannot send for Call Circle", async () => {
    mocks.resolveHostedAssistantNotificationTargetTx.mockResolvedValue({
      linqSourceLineLookupKey: "line_1",
      route: {
        actorId: "+15550001111",
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550002222",
            kind: "linq",
          },
          target: "+15550001111",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: null,
        threadIsDirect: true,
      },
    });
    const tx = createNotificationTx();

    await expect(readCallCircleNotificationPreflightTx({
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "America/New_York",
      tx: tx as never,
    })).resolves.toEqual({
      reason: "missing_route",
      status: "blocked",
    });

    expect(mocks.hasHostedLinqInboundWithinDays).not.toHaveBeenCalled();
    expect(tx.hostedLinqLine.findUnique).not.toHaveBeenCalled();
  });

  it("checks the exact routed Linq line instead of any healthy line", async () => {
    const tx = createNotificationTx(false);

    await expect(readCallCircleNotificationPreflightTx({
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "America/New_York",
      tx: tx as never,
    })).resolves.toEqual({
      reason: "line_unavailable",
      status: "blocked",
    });

    expect(tx.hostedLinqLine.findUnique).toHaveBeenCalledWith({
      select: { phoneNumberLookupKey: true },
      where: expect.objectContaining({ phoneNumberLookupKey: "line_1" }),
    });
  });

  it("keeps completed-call notifications informational without a renewal yes/no prompt", async () => {
    const tx = createNotificationTx();

    await expect(appendCallCircleTerminalNotificationIfReachableTx({
      groupId: "hgrp_123",
      kind: "outcome",
      matchId: "hccm_123",
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      timeZone: "America/New_York",
      tx: tx as never,
    })).resolves.toEqual({
      mailboxItemId: "hmi_123",
      status: "sent",
    });

    expect(mocks.appendHostedAssistantNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: "Tell the member the Call Circle call is complete.",
      }),
    );
    expect(mocks.appendHostedAssistantNotificationTx.mock.calls[0]?.[0].instructions)
      .not.toContain("Reply yes or no");
  });
});

function createNotificationTx(lineAvailable = true) {
  return {
    hostedCallCircleParticipant: {
      count: vi.fn(async () => 1),
    },
    hostedLinqLine: {
      findUnique: vi.fn(async () => lineAvailable
        ? { phoneNumberLookupKey: "line_1" }
        : null),
    },
  };
}
