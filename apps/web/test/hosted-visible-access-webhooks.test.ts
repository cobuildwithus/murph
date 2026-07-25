import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedTelegramMessagePayload: vi.fn(),
  buildHostedTelegramWebhookEventId: vi.fn(() => "telegram:update:321"),
  getPrisma: vi.fn(),
  handleHostedOnboardingTelegramWebhook: vi.fn(),
  parseHostedTelegramWebhookUpdate: vi.fn(),
  resolveHostedMemberRoutingByTelegramUserId: vi.fn(),
  resolveHostedRecognizedInboundAccess: vi.fn(),
  sendHostedTelegramAccessNotice: vi.fn(),
  summarizeHostedTelegramWebhook: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-execution/telegram-access-notice", () => ({
  sendHostedTelegramAccessNotice: mocks.sendHostedTelegramAccessNotice,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  resolveHostedMemberRoutingByTelegramUserId:
    mocks.resolveHostedMemberRoutingByTelegramUserId,
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
vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingTelegramWebhook:
    mocks.handleHostedOnboardingTelegramWebhook,
}));

import {
  handleHostedOnboardingTelegramWebhookWithVisibleAccess,
} from "@/src/lib/hosted-onboarding/visible-access-webhooks";

describe("visible access webhook recovery", () => {
  const prisma = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(prisma);
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
      authorizedTelegramUserId: "456",
      memberId: "member_telegram",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      prisma,
      replyToMessageId: "7",
      sourceEventId: "telegram:update:321",
      target: "456",
    });
  });

  it("replies generically to a recognized suspended Telegram member", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ignored: true,
      ok: true,
      reason: "suspended-member",
    });
    const update = { update_id: 322 };
    mocks.parseHostedTelegramWebhookUpdate.mockReturnValue(update);
    mocks.summarizeHostedTelegramWebhook.mockResolvedValue({
      isDirect: true,
      occurredAt: "2026-07-25T12:00:00.000Z",
      senderTelegramUserId: "456",
    });
    mocks.buildHostedTelegramMessagePayload.mockReturnValue({
      messageId: "8",
      threadId: "456",
    });
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: {
        core: {
          id: "member_suspended",
          suspendedAt: new Date("2026-07-25T11:00:00.000Z"),
        },
      },
      status: "found",
    });
    mocks.resolveHostedRecognizedInboundAccess.mockResolvedValue({
      kind: "access_notice",
      message: "Check account settings or contact support.",
      noticeCode: "billing_inactive",
      responseReason: "sent-account-unavailable-notice",
    });
    mocks.sendHostedTelegramAccessNotice.mockResolvedValue({ status: "sent" });

    await expect(handleHostedOnboardingTelegramWebhookWithVisibleAccess({
      prisma,
      rawBody: "{}",
      secretToken: null,
    })).resolves.toEqual({
      ignored: false,
      ok: true,
      reason: "sent-account-unavailable-notice",
    });

    expect(mocks.sendHostedTelegramAccessNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedTelegramUserId: "456",
        memberId: "member_suspended",
        message: "Check account settings or contact support.",
        target: "456",
      }),
    );
  });

  it("keeps inactive Telegram group conversations silent", async () => {
    const original = {
      ignored: true,
      ok: true,
      reason: "inactive-member" as const,
    };
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue(original);
    const update = { update_id: 323 };
    mocks.parseHostedTelegramWebhookUpdate.mockReturnValue(update);
    mocks.summarizeHostedTelegramWebhook.mockResolvedValue({
      isDirect: false,
      occurredAt: "2026-07-25T12:00:00.000Z",
      senderTelegramUserId: "456",
    });
    mocks.buildHostedTelegramMessagePayload.mockReturnValue({
      messageId: "9",
      threadId: "group:456",
    });

    await expect(handleHostedOnboardingTelegramWebhookWithVisibleAccess({
      prisma,
      rawBody: "{}",
      secretToken: null,
    })).resolves.toBe(original);

    expect(mocks.resolveHostedMemberRoutingByTelegramUserId).not.toHaveBeenCalled();
    expect(mocks.resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
    expect(mocks.sendHostedTelegramAccessNotice).not.toHaveBeenCalled();
  });
});
