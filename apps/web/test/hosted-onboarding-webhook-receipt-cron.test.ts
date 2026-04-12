import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  claimHostedWebhookReceiptForContinuation: vi.fn(),
  continueHostedWebhookReceipt: vi.fn(),
  createHostedWebhookReceiptHandlers: vi.fn(),
  listHostedWebhookReceiptContinuationCandidates: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-receipts", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/webhook-receipts")>(
    "@/src/lib/hosted-onboarding/webhook-receipts",
  );

  return {
    ...actual,
    claimHostedWebhookReceiptForContinuation: mocks.claimHostedWebhookReceiptForContinuation,
    continueHostedWebhookReceipt: mocks.continueHostedWebhookReceipt,
    listHostedWebhookReceiptContinuationCandidates: mocks.listHostedWebhookReceiptContinuationCandidates,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", () => ({
  createHostedWebhookReceiptHandlers: mocks.createHostedWebhookReceiptHandlers,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-webhook-receipt-cron.test.ts");
  }),
}));

import { drainHostedOnboardingWebhookReceipts } from "@/src/lib/hosted-onboarding/webhook-service";

describe("drainHostedOnboardingWebhookReceipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedWebhookReceiptHandlers.mockReturnValue({
      enqueueDispatchEffect: vi.fn(),
      performSideEffect: vi.fn(),
    });
  });

  it("skips claim races and continues draining later receipts", async () => {
    const prisma = {
      prisma: true,
    };
    const claimedReceipt = {
      eventId: "evt_ready",
      source: "telegram",
      state: {
        attemptCount: 1,
        attemptId: "attempt_123",
        completedAt: null,
        lastError: null,
        lastReceivedAt: "2026-04-08T00:00:00.000Z",
        plannedAt: "2026-04-08T00:00:00.000Z",
        sideEffects: [],
        status: "processing" as const,
      },
      version: 1,
    };
    mocks.listHostedWebhookReceiptContinuationCandidates.mockResolvedValue([
      {
        eventId: "evt_busy",
        source: "linq",
      },
      {
        eventId: "evt_ready",
        source: "telegram",
      },
    ]);
    mocks.claimHostedWebhookReceiptForContinuation
      .mockRejectedValueOnce(
        hostedOnboardingError({
          code: "WEBHOOK_RECEIPT_IN_PROGRESS",
          httpStatus: 503,
          message: "Hosted webhook receipt is already being processed.",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(claimedReceipt);
    mocks.continueHostedWebhookReceipt.mockResolvedValue(undefined);

    await expect(drainHostedOnboardingWebhookReceipts({
      prisma: prisma as never,
    })).resolves.toEqual([
      {
        eventId: "evt_busy",
        source: "linq",
        status: "skipped",
      },
      {
        eventId: "evt_ready",
        source: "telegram",
        status: "continued",
      },
    ]);

    expect(mocks.claimHostedWebhookReceiptForContinuation).toHaveBeenCalledTimes(2);
    expect(mocks.continueHostedWebhookReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.continueHostedWebhookReceipt).toHaveBeenCalledWith({
      claimedReceipt,
      eventId: "evt_ready",
      handlers: expect.any(Object),
      prisma,
      source: "telegram",
    });
  });
});
