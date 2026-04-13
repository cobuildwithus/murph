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

vi.mock("@/src/lib/hosted-onboarding/stripe-revnet-issuance", () => ({
  maybeIssueHostedRevnetForStripeInvoice: vi.fn(),
}));

import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "@/src/lib/hosted-onboarding/linq";
import { createHostedWebhookLinqMessageSideEffect } from "@/src/lib/hosted-onboarding/webhook-receipt-types";
import { createHostedWebhookReceiptHandlers } from "@/src/lib/hosted-onboarding/webhook-transport";

describe("hosted Linq webhook transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the stored redirect phone fallback when current routing is unavailable", async () => {
    vi.mocked(readHostedMemberRoutingState).mockResolvedValue(null);
    const handlers = createHostedWebhookReceiptHandlers();
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "conversation_home_redirect",
    });

    await expect(
      handlers.performSideEffect(effect, {
        prisma: {} as never,
      }),
    ).resolves.toEqual({ delivered: true });

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
      telegramUserLookupKey: null,
    });
    const handlers = createHostedWebhookReceiptHandlers();
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "conversation_home_redirect",
    });

    await expect(
      handlers.performSideEffect(effect, {
        prisma: {} as never,
      }),
    ).resolves.toEqual({ delivered: true });

    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith({
      homeRecipientPhone: "+15555550200",
    });
  });
});
