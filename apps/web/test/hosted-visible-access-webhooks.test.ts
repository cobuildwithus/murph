import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedTelegramMessagePayload: vi.fn(),
  buildHostedTelegramWebhookEventId: vi.fn(() => "telegram:update:321"),
  buildInactiveMemberAccessNoticeResponse: vi.fn(),
  buildSignupLinkResponse: vi.fn(),
  drainHostedLinqSideEffectsDirect: vi.fn(),
  getPrisma: vi.fn(),
  handleHostedOnboardingLinqWebhook: vi.fn(),
  handleHostedOnboardingTelegramWebhook: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  parseHostedTelegramWebhookUpdate: vi.fn(),
  resolveHostedMemberRoutingByTelegramUserId: vi.fn(),
  resolveHostedOnboardingLinqMessageContext: vi.fn(),
  resolveHostedRecognizedInboundAccess: vi.fn(),
  sendHostedTelegramAccessNotice: vi.fn(),
  summarizeHostedTelegramWebhook: vi.fn(),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-execution/telegram-access-notice", () => ({
  sendHostedTelegramAccessNotice: mocks.sendHostedTelegramAccessNotice,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lookupHostedMemberRoutingByHomeLinqChatId:
    mocks.lookupHostedMemberRoutingByHomeLinqChatId,
  resolveHostedMemberRoutingByTelegramUserId:
    mocks.resolveHostedMemberRoutingByTelegramUserId,
}));
vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  verifyAndParseHostedLinqWebhookRequest:
    mocks.verifyAndParseHostedLinqWebhookRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/recognized-inbound-access", () => ({
  resolveHostedRecognizedInboundAccess:
    mocks.resolveHostedRecognizedInboundAccess,
}));
vi.mock("@/src/lib/hosted-onboarding/telegram", () => ({
  buildHostedTelegramMessagePayload: mocks.buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId: mocks.buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate: mocks.parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook: mocks.summarizeHostedTelegramWebhook,
}));
vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq-shared", () => ({
  buildInactiveMemberAccessNoticeResponse:
    mocks.buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse: mocks.buildSignupLinkResponse,
  resolveHostedOnboardingLinqMessageContext:
    mocks.resolveHostedOnboardingLinqMessageContext,
}));
vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingLinqWebhook:
    mocks.handleHostedOnboardingLinqWebhook,
  handleHostedOnboardingTelegramWebhook:
    mocks.handleHostedOnboardingTelegramWebhook,
}));
vi.mock("@/src/lib/hosted-onboarding/webhook-transport", () => ({
  drainHostedLinqSideEffectsDirect: mocks.drainHostedLinqSideEffectsDirect,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  handleHostedOnboardingLinqWebhookWithVisibleAccess,
  handleHostedOnboardingTelegramWebhookWithVisibleAccess,
} from "@/src/lib/hosted-onboarding/visible-access-webhooks";

describe("visible access webhook recovery", () => {
  const prisma = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 1,
      skipped: [],
    });
  });

  it("turns a permanent Linq home-route collision into a signup reply", async () => {
    mocks.handleHostedOnboardingLinqWebhook.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_LINQ_HOME_ROUTE_CHANGED",
        httpStatus: 503,
        message: "route changed",
        retryable: true,
      }),
    );
    mocks.verifyAndParseHostedLinqWebhookRequest.mockReturnValue({
      event_id: "linq:event:123",
      event_type: "message.received",
    });
    mocks.resolveHostedOnboardingLinqMessageContext.mockReturnValue({
      messageEvent: {
        data: { chat: { is_group: false }, service: "iMessage" },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
      participantContact: { kind: "phone", value: "+15550100001" },
      summary: {
        chatId: "chat_home",
        isFromMe: false,
        messageId: "message_123",
      },
    });
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      core: { id: "member_123", suspendedAt: null },
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

    await expect(handleHostedOnboardingLinqWebhookWithVisibleAccess({
      prisma,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toEqual(plan.response);

    expect(mocks.buildSignupLinkResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_home",
        inviteCode: "invite_code",
        memberId: "member_123",
        threadIsDirect: true,
      }),
    );
    expect(mocks.drainHostedLinqSideEffectsDirect).toHaveBeenCalledWith(
      expect.objectContaining({ sideEffects: plan.desiredSideEffects }),
    );
  });

  it("replies to a recognized inactive Telegram member on the inbound thread", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });
    const update = { update_id: 321 };
    mocks.parseHostedTelegramWebhookUpdate.mockReturnValue(update);
    mocks.summarizeHostedTelegramWebhook.mockResolvedValue({
      isDirect: true,
      occurredAt: "2026-07-25T12:00:00.000Z",
      senderTelegramUserId: "456",
    });
    mocks.buildHostedTelegramMessagePayload.mockReturnValue({
      messageId: "7",
      threadId: "456",
    });
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: {
        core: { id: "member_telegram", suspendedAt: null },
      },
      status: "found",
    });
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "access_notice",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      responseReason: "sent-billing-inactive-notice",
    });
    mocks.sendHostedTelegramAccessNotice.mockResolvedValue({ status: "sent" });

    await expect(handleHostedOnboardingTelegramWebhookWithVisibleAccess({
      prisma,
      rawBody: "{}",
      secretToken: null,
    })).resolves.toEqual({
      ignored: false,
      ok: true,
      reason: "sent-billing-inactive-notice",
    });

    expect(mocks.sendHostedTelegramAccessNotice).toHaveBeenCalledWith({
      memberId: "member_telegram",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      prisma,
      replyToMessageId: "7",
      sourceEventId: "telegram:update:321",
      target: "456",
    });
  });
});
