import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
  lockHostedMemberRoutingStateTx: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  parseTelegramThreadTarget: vi.fn(),
  readCloudflareHostedControlHttpError: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  sendHostedTelegramTextMessage: vi.fn(),
  sendTelegramUsageLimitNotice: vi.fn(),
}));

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  readCloudflareHostedControlHttpError:
    mocks.readCloudflareHostedControlHttpError,
}));

vi.mock("@murphai/messaging-ingress/telegram-webhook", () => ({
  parseTelegramThreadTarget: mocks.parseTelegramThreadTarget,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  claimHostedLinqDeliveryProviderDispatchTx:
    mocks.claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx: mocks.markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx:
    mocks.markHostedLinqDeliverySendFailedTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lockHostedMemberRoutingStateTx: mocks.lockHostedMemberRoutingStateTx,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram-client", () => ({
  sendHostedTelegramTextMessage: mocks.sendHostedTelegramTextMessage,
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

import {
  buildHostedTelegramAccessNoticeIdempotencyKey,
  sendHostedTelegramAccessNotice,
} from "@/src/lib/hosted-execution/telegram-access-notice";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

describe("Telegram access notice delivery", () => {
  const tx = {};
  const prisma = {
    $transaction: vi.fn(async (run: (transaction: unknown) => Promise<unknown>) =>
      await run(tx)
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseTelegramThreadTarget.mockReturnValue({ chatId: "456" });
    mocks.readCloudflareHostedControlHttpError.mockReturnValue(null);
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "456",
      telegramUserId: "456",
    });
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "delivery_123",
    });
    mocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValue({
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    mocks.markHostedLinqDeliverySendFailedTx.mockResolvedValue(undefined);
    mocks.sendHostedTelegramTextMessage.mockResolvedValue(undefined);
    mocks.sendTelegramUsageLimitNotice.mockImplementation(async (input: {
      onRequestAttempted?: () => Promise<void>;
    }) => {
      await input.onRequestAttempted?.();
      return { status: "sent" };
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      sendTelegramUsageLimitNotice: mocks.sendTelegramUsageLimitNotice,
    });
  });

  it("uses a stable event-scoped idempotency key", () => {
    const first = buildHostedTelegramAccessNoticeIdempotencyKey({
      memberId: "member_123",
      noticeCode: "billing_inactive",
      sourceEventId: "telegram:update:321",
    });
    const repeated = buildHostedTelegramAccessNoticeIdempotencyKey({
      memberId: "member_123",
      noticeCode: "billing_inactive",
      sourceEventId: "telegram:update:321",
    });
    const nextEvent = buildHostedTelegramAccessNoticeIdempotencyKey({
      memberId: "member_123",
      noticeCode: "billing_inactive",
      sourceEventId: "telegram:update:322",
    });

    expect(first).toBe(repeated);
    expect(first).not.toBe(nextEvent);
  });

  it("claims immediately before provider dispatch and records acceptance", async () => {
    const sentAt = new Date("2026-07-25T12:00:00.000Z");

    await expect(sendHostedTelegramAccessNotice({
      memberId: "member_123",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      prisma: prisma as never,
      replyToMessageId: "7",
      sentAt,
      sourceEventId: "telegram:update:321",
      target: "456",
    })).resolves.toEqual({ status: "sent" });

    expect(mocks.lockHostedMemberRoutingStateTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedAt: sentAt,
        prisma: tx,
        reclaimStalePreProviderAttempt: true,
        source: "hosted_runtime_ai_usage_limit_notice",
        sourceRef: "telegram:update:321",
        status: "provider_dispatch_started",
        targetKind: "telegram_thread",
        template: "access_notice",
      }),
    );
    expect(mocks.sendTelegramUsageLimitNotice).toHaveBeenCalledWith({
      onRequestAttempted: expect.any(Function),
      request: {
        message: "Billing needs attention.",
        replyToMessageId: "7",
        target: "456",
      },
      userId: "member_123",
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: sentAt,
        prisma,
      }),
    );
  });

  it("uses an authenticated direct inbound before its thread is persisted", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: null,
      telegramUserId: "456",
    });

    await expect(sendHostedTelegramAccessNotice({
      authorizedTelegramUserId: "456",
      memberId: "member_123",
      message: "Check account settings.",
      noticeCode: "billing_inactive",
      prisma: prisma as never,
      replyToMessageId: "8",
      sourceEventId: "telegram:update:322",
      target: "456:business:connection:dm-topic:9",
    })).resolves.toEqual({ status: "sent" });

    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledOnce();
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledOnce();
  });

  it("sends an unanchored private notice through the same durable event claim", async () => {
    const sentAt = new Date("2026-07-25T12:00:00.000Z");

    await expect(sendHostedTelegramAccessNotice({
      authorizedTelegramUserId: "456",
      memberId: "member_123",
      message: "Finish setup, then try the group again.",
      noticeCode: "signup_required",
      prisma: prisma as never,
      replyToMessageId: null,
      sentAt,
      sourceEventId: "telegram:update:323",
      target: "456",
    })).resolves.toEqual({ status: "sent" });

    expect(mocks.sendHostedTelegramTextMessage).toHaveBeenCalledWith({
      message: "Finish setup, then try the group again.",
      replyToMessageId: null,
      target: { chatId: "456" },
    });
    expect(mocks.sendTelegramUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedAt: sentAt,
        sourceRef: "telegram:update:323",
      }),
    );
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: sentAt,
        prisma,
      }),
    );
  });

  it("terminalizes an ambiguous unanchored send instead of duplicating it on replay", async () => {
    mocks.sendHostedTelegramTextMessage.mockRejectedValue(
      new Error("Telegram request outcome was unknown."),
    );

    await expect(sendHostedTelegramAccessNotice({
      authorizedTelegramUserId: "456",
      memberId: "member_123",
      message: "Finish setup, then try the group again.",
      noticeCode: "signup_required",
      prisma: prisma as never,
      replyToMessageId: null,
      sourceEventId: "telegram:update:324",
      target: "456",
    })).resolves.toEqual({ status: "already_notified" });

    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "Error",
        idempotencyKey: expect.stringMatching(/^telegram-access-notice:/u),
        prisma,
      }),
    );
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("reports a provider-confirmed private rejection for neutral group fallback", async () => {
    mocks.sendHostedTelegramTextMessage.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_TELEGRAM_API_REQUEST_FAILED",
        httpStatus: 502,
        message: "Telegram sendMessage failed with HTTP 403.",
        retryable: false,
      }),
    );

    await expect(sendHostedTelegramAccessNotice({
      authorizedTelegramUserId: "456",
      memberId: "member_123",
      message: "Finish setup, then try the group again.",
      noticeCode: "signup_required",
      prisma: prisma as never,
      replyToMessageId: null,
      sourceEventId: "telegram:update:325",
      target: "456",
    })).resolves.toEqual({ status: "definite_failure" });

    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "HOSTED_TELEGRAM_API_REQUEST_FAILED",
        idempotencyKey: expect.stringMatching(/^telegram-access-notice:/u),
        prisma,
      }),
    );
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("rejects a stale Telegram target under the routing lock before provider dispatch", async () => {
    const providerRequests: string[] = [];
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "789",
      telegramUserId: "789",
    });
    mocks.sendTelegramUsageLimitNotice.mockImplementation(async (input: {
      onRequestAttempted?: () => Promise<void>;
    }) => {
      await input.onRequestAttempted?.();
      providerRequests.push("provider-request");
      return { status: "sent" };
    });

    await expect(sendHostedTelegramAccessNotice({
      authorizedTelegramUserId: "456",
      memberId: "member_123",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      prisma: prisma as never,
      replyToMessageId: "7",
      sourceEventId: "telegram:update:321",
      target: "456",
    })).resolves.toEqual({ status: "not_applicable" });

    expect(mocks.lockHostedMemberRoutingStateTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(providerRequests).toEqual([]);
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
  });

  it("does not claim a new attempt when another delivery already owns the event", async () => {
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: false,
      id: "delivery_123",
    });

    await expect(sendHostedTelegramAccessNotice({
      memberId: "member_123",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      prisma: prisma as never,
      replyToMessageId: "7",
      sourceEventId: "telegram:update:321",
      target: "456",
    })).resolves.toEqual({ status: "already_notified" });

    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
  });
});
