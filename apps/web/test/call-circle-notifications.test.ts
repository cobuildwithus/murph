import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendHostedAssistantNotificationTx: vi.fn(),
  hasHostedLinqInboundWithinDays: vi.fn(),
  resolveHostedAssistantNotificationRouteTx: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/assistant-notifications", () => ({
  appendHostedAssistantNotificationTx: mocks.appendHostedAssistantNotificationTx,
  resolveHostedAssistantNotificationRouteTx: mocks.resolveHostedAssistantNotificationRouteTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  hasHostedLinqInboundWithinDays: mocks.hasHostedLinqInboundWithinDays,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  appendCallCircleOutcomeNotificationTx,
  appendCallCircleSetupNotificationTx,
  buildCallCircleConfirmNotificationEventId,
  readCallCircleNotificationPreflightTx,
} from "@/src/lib/call-circle/notifications";

describe("Call Circle notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedAssistantNotificationTx.mockResolvedValue({
      mailboxItemId: "hmi_123",
    });
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(true);
    mocks.resolveHostedAssistantNotificationRouteTx.mockResolvedValue({
      channel: "linq",
    });
  });

  it("keys confirmation notifications by the proposed window", () => {
    const first = buildCallCircleConfirmNotificationEventId({
      matchId: "hccm_123",
      memberId: "member_b",
      stage: "am",
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    const countered = buildCallCircleConfirmNotificationEventId({
      matchId: "hccm_123",
      memberId: "member_b",
      stage: "am",
      windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
    });

    expect(first).toBe(
      "assistant.notification.requested:call-circle:am:hccm_123:member_b:2026-07-06T15:00:00.000Z",
    );
    expect(countered).not.toBe(first);
  });

  it("blocks private Call Circle notifications outside member daytime", async () => {
    const tx = createNotificationTx({
      memberTimeZone: "America/New_York",
      now: new Date("2026-07-06T06:30:00.000Z"),
    });

    await expect(readCallCircleNotificationPreflightTx({
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      tx: tx as never,
    })).resolves.toEqual({
      reason: "quiet_hours",
      status: "blocked",
    });

    await expect(appendCallCircleSetupNotificationTx({
      groupId: "hgrp_123",
      memberId: "member_a",
      now: new Date("2026-07-06T06:30:00.000Z"),
      tx: tx as never,
    })).resolves.toEqual({
      reason: "quiet_hours",
      status: "blocked",
    });
    expect(mocks.appendHostedAssistantNotificationTx).not.toHaveBeenCalled();
  });

  it("blocks Linq Call Circle notifications without a recent inbound day", async () => {
    mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false);
    const tx = createNotificationTx({
      memberTimeZone: "America/New_York",
      now: new Date("2026-07-06T15:30:00.000Z"),
    });

    await expect(readCallCircleNotificationPreflightTx({
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      tx: tx as never,
    })).resolves.toEqual({
      reason: "missing_recent_inbound",
      status: "blocked",
    });
  });

  it("keeps completed-call notifications informational without a renewal yes/no prompt", async () => {
    const tx = createNotificationTx({
      memberTimeZone: "America/New_York",
      now: new Date("2026-07-06T15:30:00.000Z"),
    });

    await expect(appendCallCircleOutcomeNotificationTx({
      matchId: "hccm_123",
      memberId: "member_a",
      now: new Date("2026-07-06T15:30:00.000Z"),
      preflight: {
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
        status: "ok",
      },
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

function createNotificationTx(input: {
  memberTimeZone: string | null;
  now: Date;
}) {
  return {
    hostedLinqLine: {
      count: vi.fn(async () => 1),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        pendingActivationTimeZone: input.memberTimeZone,
      })),
    },
  };
}
