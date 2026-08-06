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

const webhookMocks = vi.hoisted(() => ({
  createHostedWebhookLinqMessageSideEffect: vi.fn(),
  drainHostedLinqSideEffectsDirect: vi.fn(),
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
}));

vi.mock("@/src/lib/hosted-execution/usage-limit-notice-claim", () => ({
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx:
    deliveryMocks.startHostedAiUsageLimitNoticeDispatchTx,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", () => ({
  createHostedWebhookLinqMessageSideEffect:
    webhookMocks.createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect: webhookMocks.drainHostedLinqSideEffectsDirect,
}));

import {
  sendClaimedHostedAiUsageLimitNoticeToLinqChat,
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
      providerIdempotencyKey: "usage_notice_provider_attempt_1",
      status: "claimed",
    });
    deliveryMocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValue(true);
    webhookMocks.createHostedWebhookLinqMessageSideEffect.mockReturnValue({
      effectId: "usage_notice_claim_1",
      payload: { template: "ai_usage_quota" },
    });
    webhookMocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 1,
      skipped: [],
    });
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
      usageCreditLedgerVersion: 7n,
    })).resolves.toEqual({ status: "sent" });

    expect(deliveryMocks.startHostedAiUsageLimitNoticeDispatchTx)
      .toHaveBeenCalledExactlyOnceWith({
        attemptedAt: sentAt,
        memberId: "member_usage_notice_1",
        noticeDeliveryTarget: {
          channel: "telegram",
          replyToMessageId: "telegram_message_usage_notice_1",
          target: "telegram_thread_usage_notice_1",
        },
        periodStart,
        planResetAt: null,
        prisma,
        source: "hosted_runtime_ai_usage_limit_notice",
        sourceRef: "usage_event_1",
        targetKind: "telegram_thread",
        usageCreditLedgerVersion: 7n,
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

  it("returns the durable Linq claim retry time to the reconciliation owner", async () => {
    const retryAt = new Date("2026-07-12T15:15:00.000Z");
    webhookMocks.drainHostedLinqSideEffectsDirect.mockResolvedValue({
      sentCount: 0,
      skipped: [{
        effectId: "usage_notice_claim_1",
        reason: "notice_in_flight",
        retryAt,
        template: "ai_usage_quota",
      }],
    });

    await expect(sendClaimedHostedAiUsageLimitNoticeToLinqChat({
      chatId: "linq_chat_usage_notice_1",
      claimToken: {
        periodStart: "2026-07-01T00:00:00.000Z",
        sentAt: "2026-07-12T15:00:00.000Z",
        usageCreditLedgerVersion: "7",
      },
      memberId: "member_usage_notice_1",
      message: "You reached your monthly Murph AI limit.",
      noticeCode: "edge_usage_limit_reached",
      occurredAt: "2026-07-12T14:59:00.000Z",
      prisma: {} as never,
      sourceEventId: "usage_event_1",
    })).resolves.toEqual({ retryAt, status: "in_flight" });
  });

  it("returns the durable Telegram retry time to the reconciliation owner", async () => {
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const sentAt = new Date("2026-07-12T15:00:00.000Z");
    const retryAt = new Date("2026-07-12T15:05:00.000Z");
    controlMocks.sendTelegramUsageLimitNotice.mockImplementation(
      async (input: { onRequestAttempted?: () => Promise<void> | void }) => {
        await input.onRequestAttempted?.();
        return {
          failureCode: "telegram_temporarily_unavailable",
          retryAfterSeconds: 300,
          retryable: true,
          status: "failed",
        };
      },
    );

    await expect(sendClaimedHostedAiUsageLimitNoticeToTelegramThread({
      memberId: "member_usage_notice_1",
      message: "You reached your monthly Murph AI limit.",
      periodStart,
      prisma: {} as never,
      replyToMessageId: "telegram_message_usage_notice_1",
      sentAt,
      sourceEventId: "usage_event_1",
      target: "telegram_thread_usage_notice_1",
      usageCreditLedgerVersion: 7n,
    })).resolves.toEqual({ retryAt, status: "in_flight" });

    expect(deliveryMocks.markHostedAiUsageLimitNoticeDeliveryRetryableTx)
      .toHaveBeenCalledWith(expect.objectContaining({ retryAfterAt: retryAt }));
  });

  it("throws when Telegram control fails before acquiring a durable claim", async () => {
    controlMocks.sendTelegramUsageLimitNotice.mockRejectedValue(
      new Error("control unavailable before request"),
    );

    await expect(sendClaimedHostedAiUsageLimitNoticeToTelegramThread({
      memberId: "member_usage_notice_1",
      message: "You reached your monthly Murph AI limit.",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      prisma: {} as never,
      replyToMessageId: "telegram_message_usage_notice_1",
      sentAt: new Date("2026-07-12T15:00:00.000Z"),
      sourceEventId: "usage_event_1",
      target: "telegram_thread_usage_notice_1",
      usageCreditLedgerVersion: 7n,
    })).rejects.toThrow("control unavailable before request");

    expect(deliveryMocks.markHostedAiUsageLimitNoticeDeliveryRetryableTx)
      .not.toHaveBeenCalled();
  });
});
