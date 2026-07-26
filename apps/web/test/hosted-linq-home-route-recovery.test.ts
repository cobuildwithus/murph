import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildInactiveMemberAccessNoticeResponse: vi.fn(),
  buildSignupLinkResponse: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  resolveHostedOnboardingLinqMessageContext: vi.fn(),
  resolveHostedRecognizedInboundAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lookupHostedMemberRoutingByHomeLinqChatId:
    mocks.lookupHostedMemberRoutingByHomeLinqChatId,
}));
vi.mock("@/src/lib/hosted-onboarding/recognized-inbound-access", () => ({
  resolveHostedRecognizedInboundAccess:
    mocks.resolveHostedRecognizedInboundAccess,
}));
vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq-shared", () => ({
  buildInactiveMemberAccessNoticeResponse:
    mocks.buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse: mocks.buildSignupLinkResponse,
  resolveHostedOnboardingLinqMessageContext:
    mocks.resolveHostedOnboardingLinqMessageContext,
}));

import {
  planHostedLinqPermanentHomeRouteRecovery,
} from "@/src/lib/hosted-onboarding/linq-home-route-recovery";

describe("Linq permanent home-route recovery", () => {
  const prisma = {} as never;
  const event = {
    event_id: "linq:event:123",
    event_type: "message.received",
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("plans a signup reply for a recognized owner with no subscription", async () => {
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

    await expect(planHostedLinqPermanentHomeRouteRecovery({
      event,
      prisma,
    })).resolves.toBe(plan);

    expect(mocks.buildSignupLinkResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_home",
        inviteCode: "invite_code",
        memberId: "member_123",
        threadIsDirect: true,
      }),
    );
  });

  it("plans the existing billing notice for a recoverable owner", async () => {
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "access_notice",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      responseReason: "sent-billing-inactive-notice",
    });
    const plan = {
      desiredSideEffects: [{ effectId: "notice-effect" }],
      response: { ok: true, reason: "sent-billing-inactive-notice" },
    };
    mocks.buildInactiveMemberAccessNoticeResponse.mockReturnValue(plan);

    await expect(planHostedLinqPermanentHomeRouteRecovery({
      event,
      prisma,
    })).resolves.toBe(plan);

    expect(mocks.buildSignupLinkResponse).not.toHaveBeenCalled();
  });

  it("judges entitlement at the current time, not the message timestamp", async () => {
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "silent",
    });

    await planHostedLinqPermanentHomeRouteRecovery({ event, prisma });

    expect(mocks.resolveHostedRecognizedInboundAccess).toHaveBeenCalledWith(
      expect.not.objectContaining({ now: expect.anything() }),
    );
  });

  it("declines the real routing race so the retry is preserved", async () => {
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "allowed",
    });

    await expect(planHostedLinqPermanentHomeRouteRecovery({
      event,
      prisma,
    })).resolves.toBeNull();
  });

  it("stays silent in a group chat", async () => {
    mocks.resolveHostedOnboardingLinqMessageContext.mockReturnValue({
      messageEvent: {
        data: { chat: { is_group: true }, service: "iMessage" },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
      participantContact: { kind: "phone", value: "+15550100001" },
      summary: {
        chatId: "chat_group",
        isFromMe: false,
        messageId: "message_123",
      },
    });

    await expect(planHostedLinqPermanentHomeRouteRecovery({
      event,
      prisma,
    })).resolves.toBeNull();

    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
  });

  it("declines when the chat has no permanent home owner", async () => {
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue(null);

    await expect(planHostedLinqPermanentHomeRouteRecovery({
      event,
      prisma,
    })).resolves.toBeNull();

    expect(mocks.resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
  });
});
