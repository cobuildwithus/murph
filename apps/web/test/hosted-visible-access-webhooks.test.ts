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
vi.mock("@/src/lib/hosted-onboarding/recognized-inbound-access", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/recognized-inbound-access")
  >();
  return {
    ...actual,
    resolveHostedRecognizedInboundAccess:
      mocks.resolveHostedRecognizedInboundAccess,
  };
});
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

  it("privately recovers an inactive Telegram group sender without exposing billing in the room", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });
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
      message: "Billing needs attention.\n\nOnce that's sorted, send me another message in the group and I'll try again.",
      noticeCode: "billing_inactive",
      prisma,
      replyToMessageId: null,
      sourceEventId: "telegram:update:321",
      target: "456",
    });
  });

  it("accepts an ambiguous private-send replay without sending neutral room guidance", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });
    const update = { update_id: 324 };
    mocks.parseHostedTelegramWebhookUpdate.mockReturnValue(update);
    mocks.summarizeHostedTelegramWebhook.mockResolvedValue({
      isDirect: false,
      occurredAt: "2026-07-25T12:00:00.000Z",
      senderTelegramUserId: "456",
    });
    mocks.buildHostedTelegramMessagePayload.mockReturnValue({
      messageId: "10",
      threadId: "group:456",
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
    mocks.sendHostedTelegramAccessNotice.mockResolvedValue({
      status: "already_notified",
    });

    await expect(handleHostedOnboardingTelegramWebhookWithVisibleAccess({
      prisma,
      rawBody: "{}",
      secretToken: null,
    })).resolves.toEqual({
      ignored: false,
      ok: true,
      reason: "sent-billing-inactive-notice",
    });
  });

  it("hands a definitely rejected private group recovery to the neutral room fallback", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });
    const update = { update_id: 324 };
    mocks.parseHostedTelegramWebhookUpdate.mockReturnValue(update);
    mocks.summarizeHostedTelegramWebhook.mockResolvedValue({
      isDirect: false,
      occurredAt: "2026-07-25T12:00:00.000Z",
      senderTelegramUserId: "456",
    });
    mocks.buildHostedTelegramMessagePayload.mockReturnValue({
      messageId: "10",
      threadId: "group:456",
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
    mocks.sendHostedTelegramAccessNotice.mockResolvedValue({
      status: "definite_failure",
    });

    await expect(handleHostedOnboardingTelegramWebhookWithVisibleAccess({
      prisma,
      rawBody: "{}",
      secretToken: null,
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "group-chat-provision-unavailable",
    });
  });
});
