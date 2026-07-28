import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
  lockHostedMemberRoutingStateTx: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  parseTelegramThreadTarget: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@murphai/messaging-ingress/telegram-webhook", () => ({
  parseTelegramThreadTarget: mocks.parseTelegramThreadTarget,
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    telegramBotToken: "telegram-token",
  }),
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

import {
  sendHostedTelegramAccessNotice,
} from "@/src/lib/hosted-execution/telegram-access-notice";

describe("Telegram access notice HTTP outcome integration", () => {
  const fetchMock = vi.fn();
  const tx = {};
  const prisma = {
    $transaction: vi.fn(async (run: (transaction: unknown) => Promise<unknown>) =>
      await run(tx)
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.parseTelegramThreadTarget.mockReturnValue({ chatId: "456" });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "456",
      telegramUserId: "456",
    });
    mocks.markHostedLinqDeliverySendFailedTx.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries an HTTP 5xx through the real client as terminal ambiguity across replay", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    mocks.claimHostedLinqDeliveryProviderDispatchTx
      .mockResolvedValueOnce({
        claimed: true,
        id: "delivery_123",
      })
      .mockResolvedValueOnce({
        claimed: false,
        failureCode: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
        id: "delivery_123",
      });

    const input = {
      authorizedTelegramUserId: "456",
      memberId: "member_123",
      message: "Finish setup, then try the group again.",
      noticeCode: "signup_required",
      prisma: prisma as never,
      replyToMessageId: null,
      sourceEventId: "telegram:update:http-502",
      target: "456",
    };

    await expect(sendHostedTelegramAccessNotice(input)).resolves.toEqual({
      status: "already_notified",
    });
    await expect(sendHostedTelegramAccessNotice(input)).resolves.toEqual({
      status: "already_notified",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: expect.any(Date),
      failedAt: expect.any(Date),
      failureCode: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
      failureReason: "Telegram sendMessage failed with HTTP 502.",
      idempotencyKey: expect.stringMatching(/^telegram-access-notice:/u),
      prisma,
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });
});
