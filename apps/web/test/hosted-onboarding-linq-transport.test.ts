import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInviteUrl: vi.fn((inviteCode: string) => `https://join.test/${inviteCode}`),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  buildHostedDailyQuotaReply: vi.fn(() => "daily-quota"),
  buildHostedInviteReply: vi.fn(() => "invite-reply"),
  buildHostedLinqConversationHomeRedirectReply: vi.fn(({ homeRecipientPhone }: { homeRecipientPhone: string }) => `redirect:${homeRecipientPhone}`),
  sendHostedLinqChatMessage: vi.fn().mockResolvedValue(undefined),
}));

import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";

describe("hosted Linq webhook transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the stored redirect phone fallback when current routing is unavailable", async () => {
    vi.mocked(readHostedMemberRoutingState).mockResolvedValue(null);
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "conversation_home_redirect",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith({
      homeRecipientPhone: "+15555550100",
    });
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: effect.effectId,
        message: "redirect:+15555550100",
        replyToMessageId: "message-1",
      }),
    );
  });

  it("prefers the latest routing phone over the stored redirect fallback", async () => {
    vi.mocked(readHostedMemberRoutingState).mockResolvedValue({
      linqChatId: "home-chat-1",
      linqRecipientPhone: "+15555550200",
      memberId: "member-1",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "conversation_home_redirect",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith({
      homeRecipientPhone: "+15555550200",
    });
  });

  it("delivers legacy invite_signin side effects as invite signup replies", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "legacy-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const effect = {
      effectId: "linq-message:event-legacy",
      payload: {
        chatId: "chat-1",
        inviteId: "invite-1",
        replyToMessageId: "message-1",
        template: "invite_signin",
      },
    } as const;

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: effect.effectId,
        message: "invite-reply",
        replyToMessageId: "message-1",
      }),
    );
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      data: {
        sentAt: expect.any(Date),
      },
      where: {
        id: "invite-1",
      },
    });
  });

  it("logs safe structured Linq side-effect details when delivery fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValue(Object.assign(
      new Error("send failed"),
      {
        code: "LINQ_SEND_FAILED",
        details: {
          failureStage: "http",
          status: 502,
        },
        retryable: true,
      },
    ));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "daily_quota",
    });

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: {} as never,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("send failed");

      expect(errorSpy).toHaveBeenCalledWith(
        "Hosted Linq side-effect delivery failed.",
        expect.objectContaining({
          effectId: effect.effectId,
          failureStage: "http",
          hasIdempotencyKey: true,
          hasReplyToMessageId: true,
          operation: "send_message",
          provider: "linq",
          errorMessage: "send failed",
          retryable: true,
          status: 502,
          template: "daily_quota",
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
