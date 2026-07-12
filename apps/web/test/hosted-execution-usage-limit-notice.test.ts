import { beforeEach, describe, expect, it, vi } from "vitest";

const controlMocks = vi.hoisted(() => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  sendTelegramUsageLimitNotice: vi.fn(),
}));

const deliveryMocks = vi.hoisted(() => ({
  markHostedAiUsageLimitNoticeDeliveryRetryableTx: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  startHostedAiUsageLimitNoticeDispatchTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    controlMocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS: 15 * 60 * 1000,
  markHostedAiUsageLimitNoticeDeliveryRetryableTx:
    deliveryMocks.markHostedAiUsageLimitNoticeDeliveryRetryableTx,
  markHostedLinqDeliveryAcceptedTx: deliveryMocks.markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx:
    deliveryMocks.markHostedLinqDeliverySendFailedTx,
  startHostedAiUsageLimitNoticeDispatchTx:
    deliveryMocks.startHostedAiUsageLimitNoticeDispatchTx,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", () => ({
  createHostedWebhookLinqMessageSideEffect: vi.fn(),
  drainHostedLinqSideEffectsDirect: vi.fn(),
}));

import {
  sendClaimedHostedAiUsageLimitNoticeToTelegramThread,
} from "@/src/lib/hosted-execution/usage-limit-notice";

describe("hosted usage-limit notice delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controlMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      sendTelegramUsageLimitNotice: controlMocks.sendTelegramUsageLimitNotice,
    });
    deliveryMocks.startHostedAiUsageLimitNoticeDispatchTx.mockResolvedValue({
      idempotencyKey: "usage_notice_claim_1",
      status: "claimed",
    });
    deliveryMocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValue(true);
    controlMocks.sendTelegramUsageLimitNotice.mockImplementation(
      async (input: { onRequestAttempted?: () => Promise<void> | void }) => {
        await input.onRequestAttempted?.();
        return { status: "sent" };
      },
    );
  });

  it("claims and sends a Telegram notice to the originating thread", async () => {
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const sentAt = new Date("2026-07-12T15:00:00.000Z");
    const prisma = {};

    await expect(sendClaimedHostedAiUsageLimitNoticeToTelegramThread({
      memberId: "member_usage_notice_1",
      message: "You reached your monthly Murph AI limit.",
      periodStart,
      prisma: prisma as never,
      replyToMessageId: "telegram_message_usage_notice_1",
      sentAt,
      sourceEventId: "usage_event_1",
      target: "telegram_thread_usage_notice_1",
    })).resolves.toEqual({ status: "sent" });

    expect(deliveryMocks.startHostedAiUsageLimitNoticeDispatchTx)
      .toHaveBeenCalledExactlyOnceWith({
        attemptedAt: sentAt,
        memberId: "member_usage_notice_1",
        periodStart,
        prisma,
        source: "hosted_runtime_ai_usage_limit_notice",
        sourceRef: "usage_event_1",
        targetKind: "telegram_thread",
      });
    expect(controlMocks.sendTelegramUsageLimitNotice).toHaveBeenCalledExactlyOnceWith({
      onRequestAttempted: expect.any(Function),
      request: {
        message: "You reached your monthly Murph AI limit.",
        replyToMessageId: "telegram_message_usage_notice_1",
        target: "telegram_thread_usage_notice_1",
      },
      userId: "member_usage_notice_1",
    });
    expect(deliveryMocks.markHostedLinqDeliveryAcceptedTx)
      .toHaveBeenCalledExactlyOnceWith({
        acceptedAt: sentAt,
        idempotencyKey: "usage_notice_claim_1",
        prisma,
      });
  });
});
