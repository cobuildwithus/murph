import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
  finishHostedOnboardingTiming: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  maybeHandoffHostedExecutionWebhookWake: vi.fn(),
  planHostedOnboardingLinqWebhook: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  requireHostedLinqMessageReceivedEvent: vi.fn(),
  resolveHostedLinqRecipientPhoneNumber: vi.fn(() => "+15555550123"),
  resolveHostedLinqThreadContainerCryptoPreparationTarget: vi.fn(() => null),
  sendHostedLinqReadReceipt: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq")
  >();
  return {
    ...actual,
    requireHostedLinqMessageReceivedEvent: mocks.requireHostedLinqMessageReceivedEvent,
    resolveHostedLinqRecipientPhoneNumber: mocks.resolveHostedLinqRecipientPhoneNumber,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
    verifyAndParseHostedLinqWebhookRequest: mocks.verifyAndParseHostedLinqWebhookRequest,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", () => ({
  planHostedOnboardingLinqWebhook: mocks.planHostedOnboardingLinqWebhook,
  resolveHostedLinqThreadContainerCryptoPreparationTarget:
    mocks.resolveHostedLinqThreadContainerCryptoPreparationTarget,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service-wake", () => ({
  maybeHandoffHostedExecutionWebhookWake: mocks.maybeHandoffHostedExecutionWebhookWake,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
  readHostedThreadRouteByThreadIdentity: mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
  logHostedOnboardingDiagnostic: vi.fn(),
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

import {
  handleHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-service";

describe("hosted Linq read receipt route authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedLinqChatSummary.mockResolvedValue({
      handles: [],
      isGroup: false,
    });
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
    mocks.verifyAndParseHostedLinqWebhookRequest.mockReturnValue({
      event_id: "evt_read_receipt_mismatch",
      event_type: "message.received",
    });
    mocks.requireHostedLinqMessageReceivedEvent.mockReturnValue({
      api_version: "2026-01-01",
      data: {
        chat_id: "chat_123",
        created_at: "2026-06-28T12:00:00.000Z",
        direction: "inbound",
        is_from_me: false,
        message: {
          id: "linq_message_123",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        recipient: "+15555550123",
        service: "iMessage",
        thread_is_direct: true,
      },
      event_id: "evt_read_receipt_mismatch",
      event_type: "message.received",
      webhook_version: "2026-01-01",
    });
    mocks.maybeHandoffHostedExecutionWebhookWake.mockResolvedValue({
      reason: "temporal-signaled",
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
      wakeHandoffs: [{
        eventId: "evt_read_receipt_mismatch",
        linqChatId: "chat_123",
        mailboxItemId: "mailbox_123",
        source: "linq",
        userId: "member_123",
      }],
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
    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      channel: "linq",
      prisma: {},
      threadId: "chat_123",
    });
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 1_500,
    });
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
