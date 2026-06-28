import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
  finishHostedOnboardingTiming: vi.fn(),
  maybeHandoffHostedExecutionWebhookWake: vi.fn(),
  planHostedOnboardingLinqWebhook: vi.fn(),
  requireHostedLinqMessageReceivedEvent: vi.fn(),
  sendHostedLinqReadReceipt: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  requireHostedLinqMessageReceivedEvent: mocks.requireHostedLinqMessageReceivedEvent,
  sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
  verifyAndParseHostedLinqWebhookRequest: mocks.verifyAndParseHostedLinqWebhookRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", () => ({
  planHostedOnboardingLinqWebhook: mocks.planHostedOnboardingLinqWebhook,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service-wake", () => ({
  maybeHandoffHostedExecutionWebhookWake: mocks.maybeHandoffHostedExecutionWebhookWake,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
  startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix: vi.fn((value: string | null | undefined) =>
    value ? value.slice(-6) : null
  ),
}));

vi.mock("@/src/lib/hosted-onboarding/telegram", () => ({
  assertHostedTelegramWebhookSecret: vi.fn(),
  buildHostedTelegramWebhookEventId: vi.fn(),
  parseHostedTelegramWebhookUpdate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-telegram", () => ({
  planHostedOnboardingTelegramWebhook: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-whatsapp", () => ({
  planHostedOnboardingWhatsAppWebhook: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/whatsapp", () => ({
  parseHostedWhatsAppInboundTexts: vi.fn(),
  verifyAndParseHostedWhatsAppWebhookRequest: vi.fn(),
}));

import {
  handleHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-service";

describe("hosted Linq read receipt route authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAndParseHostedLinqWebhookRequest.mockReturnValue({
      event_id: "evt_read_receipt_mismatch",
      event_type: "message.received",
    });
    mocks.maybeHandoffHostedExecutionWebhookWake.mockResolvedValue({
      reason: null,
      signalAccepted: true,
      started: true,
    });
  });

  it("skips read receipts when route authority targets a different chat", async () => {
    mocks.planHostedOnboardingLinqWebhook.mockResolvedValue({
      desiredSideEffects: [],
      linqReadReceiptRouteAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member_123",
        threadId: "chat_other",
      },
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-active-member",
      },
      wakeLinqChatId: "chat_123",
      wakeMailboxItemId: "mailbox_123",
      wakeUserId: "member_123",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "skipped-route-authority-mismatch",
      expect.objectContaining({
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });
});
