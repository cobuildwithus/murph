import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildInactiveMemberAccessNoticeResponse: vi.fn(),
  buildSignupLinkResponse: vi.fn(),
  drainHostedLinqSideEffectsDirect: vi.fn(),
  getPrisma: vi.fn(),
  isHostedLinqConversationMessageWake: vi.fn(),
  isHostedTelegramConversationMessageWake: vi.fn(),
  readHostedMailboxLatestPendingConversationItem: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  readHostedRuntimeReconciliationFacts: vi.fn(),
  resolveHostedRecognizedInboundAccess: vi.fn(),
  sendHostedTelegramAccessNotice: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", () => ({
  isHostedLinqConversationMessageWake:
    mocks.isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake:
    mocks.isHostedTelegramConversationMessageWake,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/telegram-access-notice", () => ({
  sendHostedTelegramAccessNotice: mocks.sendHostedTelegramAccessNotice,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxLatestPendingConversationItem:
    mocks.readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
}));

vi.mock("@/src/lib/hosted-onboarding/recognized-inbound-access", () => ({
  resolveHostedRecognizedInboundAccess:
    mocks.resolveHostedRecognizedInboundAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq-shared", () => ({
  buildInactiveMemberAccessNoticeResponse:
    mocks.buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse: mocks.buildSignupLinkResponse,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", () => ({
  drainHostedLinqSideEffectsDirect: mocks.drainHostedLinqSideEffectsDirect,
}));

vi.mock("@/src/lib/hosted-orchestration/runtime-reconciliation-facts", () => ({
  readHostedRuntimeReconciliationFacts:
    mocks.readHostedRuntimeReconciliationFacts,
}));

import {
  readHostedRuntimeReconciliationFactsWithVisibleAccess,
} from "@/src/lib/hosted-orchestration/visible-runtime-reconciliation";

describe("visible runtime access reconciliation", () => {
  const hostedMemberFindUnique = vi.fn();
  const prisma = {
    hostedMember: {
      findUnique: hostedMemberFindUnique,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxLatestPendingConversationItem.mockResolvedValue({
      id: "mailbox_123",
    });
    hostedMemberFindUnique.mockResolvedValue({
      id: "member_123",
      suspendedAt: null,
      threadContainer: null,
    });
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 1,
      skipped: [],
    });
    mocks.isHostedLinqConversationMessageWake.mockImplementation(
      (wake: { channel?: string }) => wake.channel === "linq",
    );
    mocks.isHostedTelegramConversationMessageWake.mockImplementation(
      (wake: { channel?: string }) => wake.channel === "telegram",
    );
  });

  it("delivers an inactive-billing notice on the pending Telegram thread", async () => {
    const facts = blockedFacts("ai_usage_denied");
    mocks.readHostedRuntimeReconciliationFacts.mockResolvedValue(facts);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "telegram",
      eventId: "telegram:update:321",
      kind: "conversation.message",
      message: {
        telegramMessage: {
          messageId: "7",
          threadId: "456",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "access_notice",
      message: "Your billing needs attention.",
      noticeCode: "billing_inactive",
      responseReason: "sent-billing-inactive-notice",
    });
    mocks.sendHostedTelegramAccessNotice.mockResolvedValue({ status: "sent" });

    await expect(readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    })).resolves.toBe(facts);

    expect(mocks.sendHostedTelegramAccessNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      message: "Your billing needs attention.",
      noticeCode: "billing_inactive",
      prisma,
      replyToMessageId: "7",
      sourceEventId: "telegram:update:321",
      target: "456",
    });
  });

  it("judges entitlement at reconciliation time, not the admitted message time", async () => {
    const facts = blockedFacts("ai_usage_denied");
    mocks.readHostedRuntimeReconciliationFacts.mockResolvedValue(facts);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "telegram",
      eventId: "telegram:update:322",
      kind: "conversation.message",
      message: {
        telegramMessage: {
          messageId: "7",
          threadId: "456",
          threadIsDirect: true,
        },
      },
      // Admitted while access was valid; reconciled after billing became inactive.
      occurredAt: "2020-01-01T00:00:00.000Z",
    });
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "access_notice",
      message: "Your billing needs attention.",
      noticeCode: "billing_inactive",
      responseReason: "sent-billing-inactive-notice",
    });
    mocks.sendHostedTelegramAccessNotice.mockResolvedValue({ status: "sent" });

    await readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    });

    const resolvedNow = mocks.resolveHostedRecognizedInboundAccess.mock
      .calls[0]?.[0]?.now as Date;
    expect(resolvedNow.toISOString()).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Date.now() - resolvedNow.getTime()).toBeLessThan(60_000);
    expect(mocks.sendHostedTelegramAccessNotice).toHaveBeenCalledOnce();
  });

  it("leaves Linq AI-usage notices to the canonical reconciliation owner", async () => {
    const facts = blockedFacts("ai_usage_denied");
    mocks.readHostedRuntimeReconciliationFacts.mockResolvedValue(facts);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "linq",
      eventId: "linq:event:usage-denied",
      kind: "conversation.message",
      message: {
        linqMessage: {
          chatId: "chat_home",
          messageId: "message_usage_denied",
          service: "iMessage",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });

    await expect(readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    })).resolves.toBe(facts);

    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
    expect(mocks.buildInactiveMemberAccessNoticeResponse).not.toHaveBeenCalled();
    expect(mocks.buildSignupLinkResponse).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
    expect(mocks.sendHostedTelegramAccessNotice).not.toHaveBeenCalled();
  });

  it("turns post-admission Linq access loss into a signup handoff", async () => {
    const facts = blockedFacts("user_not_active");
    mocks.readHostedRuntimeReconciliationFacts.mockResolvedValue(facts);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "linq",
      eventId: "linq:event:123",
      kind: "conversation.message",
      message: {
        linqMessage: {
          chatId: "chat_home",
          messageId: "message_123",
          service: "iMessage",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      inviteCode: "invite_code",
      inviteId: "invite_123",
      joinUrl: "https://withmurph.ai/join/invite_code",
      kind: "signup",
      message: "Finish setup.",
      responseReason: "sent-signup-link",
    });
    const plan = {
      desiredSideEffects: [{ effectId: "signup-effect" }],
      response: { ok: true, reason: "sent-signup-link" },
    };
    mocks.buildSignupLinkResponse.mockReturnValue(plan);

    await expect(readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    })).resolves.toBe(facts);

    expect(mocks.buildSignupLinkResponse).toHaveBeenCalledWith({
      chatId: "chat_home",
      inviteCode: "invite_code",
      inviteId: "invite_123",
      memberId: "member_123",
      messageId: "message_123",
      occurredAt: "2026-07-25T12:00:00.000Z",
      service: "iMessage",
      sourceEventId: "linq:event:123",
      threadIsDirect: true,
    });
    expect(mocks.drainHostedLinqSideEffectsDirect).toHaveBeenCalledWith({
      prisma,
      sideEffects: plan.desiredSideEffects,
    });
  });

  it("re-runs reconciliation when access is restored during the blocked read", async () => {
    const blocked = blockedFacts("user_not_active");
    const runnable = {
      blocked: null,
      mailboxLag: [{ lane: "conversation", lag: "1" }],
      workspace: { nextWakeAt: null },
    };
    mocks.readHostedRuntimeReconciliationFacts
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(runnable);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "telegram",
      eventId: "telegram:update:321",
      kind: "conversation.message",
      message: {
        telegramMessage: {
          messageId: "7",
          threadId: "456",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "allowed",
    });

    await expect(readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    })).resolves.toBe(runnable);
    expect(mocks.readHostedRuntimeReconciliationFacts).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedTelegramAccessNotice).not.toHaveBeenCalled();
  });

  it("does not disclose account state for a synthetic thread-container member", async () => {
    const facts = blockedFacts("user_not_active");
    mocks.readHostedRuntimeReconciliationFacts.mockResolvedValue(facts);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "telegram",
      eventId: "telegram:update:container",
      kind: "conversation.message",
      message: {
        telegramMessage: {
          messageId: "9",
          threadId: "group:456",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });
    hostedMemberFindUnique.mockResolvedValue({
      id: "member_123",
      suspendedAt: null,
      threadContainer: { memberId: "member_owner" },
    });

    await expect(readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    })).resolves.toBe(facts);

    expect(mocks.resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
    expect(mocks.sendHostedTelegramAccessNotice).not.toHaveBeenCalled();
  });

  it("does not disclose account state into a group conversation", async () => {
    const facts = blockedFacts("user_not_active");
    mocks.readHostedRuntimeReconciliationFacts.mockResolvedValue(facts);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      channel: "telegram",
      eventId: "telegram:update:group",
      kind: "conversation.message",
      message: {
        telegramMessage: {
          messageId: "8",
          threadId: "group:456",
          threadIsDirect: false,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });

    await expect(readHostedRuntimeReconciliationFactsWithVisibleAccess({
      userId: "member_123",
    })).resolves.toBe(facts);
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
    expect(mocks.sendHostedTelegramAccessNotice).not.toHaveBeenCalled();
  });
});

function blockedFacts(reason: "ai_usage_denied" | "user_not_active") {
  return {
    blocked: {
      reason,
      retryAt: "2026-07-25T12:15:00.000Z",
    },
    mailboxLag: [],
    workspace: null,
  };
}
