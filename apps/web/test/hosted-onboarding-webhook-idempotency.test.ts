import { HostedBillingMode, HostedBillingStatus, Prisma } from "@prisma/client";
import { REVNET_NATIVE_TOKEN } from "@cobuild/wire";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stripeConstructEvent = vi.fn();

  return {
    dispatchHostedExecution: vi.fn(),
    isHostedOnboardingRevnetEnabled: vi.fn(),
    normalizeHostedWalletAddress: vi.fn((value: string | null | undefined) => value ?? null),
    requireHostedRevnetConfig: vi.fn(),
    sendHostedLinqChatMessage: vi.fn(),
    submitHostedRevnetPayment: vi.fn(),
    stripeConstructEvent,
    waitForHostedRevnetPaymentConfirmation: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecution: mocks.dispatchHostedExecution,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    publicBaseUrl: "https://join.example.test",
    revnetChainId: null,
    revnetProjectId: null,
    revnetRpcUrl: null,
    revnetStripeCurrency: null,
    revnetTerminalAddress: null,
    revnetTreasuryPrivateKey: null,
    revnetWaitConfirmations: 1,
    revnetWeiPerStripeMinorUnit: null,
    sessionCookieName: "hb_hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
  }),
  getHostedOnboardingSecretCodec: () => ({
    encrypt: (value: string) => `enc:${value}`,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  requireHostedOnboardingStripeConfig: () => ({
    billingMode: "payment",
    priceId: "price_123",
    stripe: {
      webhooks: {
        constructEvent: mocks.stripeConstructEvent,
      },
    },
    webhookSecret: "whsec_123",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/revnet", () => ({
  coerceHostedWalletAddress: (value: string | null | undefined) => value ?? null,
  convertStripeMinorAmountToRevnetPaymentAmount: (amountMinor: number, weiPerStripeMinorUnit: bigint) =>
    BigInt(amountMinor) * weiPerStripeMinorUnit,
  isHostedOnboardingRevnetEnabled: mocks.isHostedOnboardingRevnetEnabled,
  normalizeHostedWalletAddress: mocks.normalizeHostedWalletAddress,
  requireHostedRevnetConfig: mocks.requireHostedRevnetConfig,
  submitHostedRevnetPayment: mocks.submitHostedRevnetPayment,
  waitForHostedRevnetPaymentConfirmation: mocks.waitForHostedRevnetPaymentConfirmation,
}));

import {
  handleHostedOnboardingLinqWebhook,
  handleHostedStripeWebhook,
} from "@/src/lib/hosted-onboarding/service";

describe("hosted onboarding webhook retry safety", () => {
  beforeEach(() => {
    mocks.dispatchHostedExecution.mockReset();
    mocks.isHostedOnboardingRevnetEnabled.mockReset();
    mocks.normalizeHostedWalletAddress.mockReset();
    mocks.requireHostedRevnetConfig.mockReset();
    mocks.sendHostedLinqChatMessage.mockReset();
    mocks.submitHostedRevnetPayment.mockReset();
    mocks.stripeConstructEvent.mockReset();
    mocks.waitForHostedRevnetPaymentConfirmation.mockReset();
    mocks.dispatchHostedExecution.mockResolvedValue({ dispatched: true });
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(false);
    mocks.normalizeHostedWalletAddress.mockImplementation((value: string | null | undefined) => value ?? null);
    mocks.requireHostedRevnetConfig.mockReturnValue({
      chainId: 8453,
      projectId: 1n,
      rpcUrl: "https://rpc.example.test",
      stripeCurrency: "usd",
      terminalAddress: "0x0000000000000000000000000000000000000001",
      treasuryPrivateKey: `0x${"11".repeat(32)}`,
      waitConfirmations: 1,
      weiPerStripeMinorUnit: 2_000_000_000_000n,
    });
    mocks.submitHostedRevnetPayment.mockResolvedValue({
      payTxHash: "0xabc123",
      paymentAmount: 1_000_000_000_000_000n,
    });
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "out_msg_123",
    });
    mocks.waitForHostedRevnetPaymentConfirmation.mockResolvedValue(undefined);
  });

  it("allows a Linq active-member webhook to retry after a dispatch failure", async () => {
    mocks.dispatchHostedExecution
      .mockRejectedValueOnce(new Error("runner unavailable"))
      .mockResolvedValueOnce({ dispatched: true });

    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn()
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(createUniqueConstraintError()),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_EXECUTION_DISPATCH_FAILED",
      retryable: true,
    });

    const firstAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(firstAttemptCalls).toHaveLength(4);
    expect(firstAttemptCalls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                eventId: "evt_123",
                status: "pending",
              }),
            ],
            status: "processing",
          }),
        }),
      }),
    );
    expect(firstAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastError: expect.objectContaining({
              name: "HostedOnboardingError",
            }),
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: expect.any(String),
                lastError: {
                  code: "HOSTED_EXECUTION_DISPATCH_FAILED",
                  message: "Hosted execution dispatch failed and the webhook should be retried.",
                  name: "HostedOnboardingError",
                  retryable: true,
                },
                status: "pending",
              }),
            ],
            status: "failed",
          }),
        }),
      }),
    );
    prisma.hostedWebhookReceipt.findUnique.mockResolvedValueOnce({
      payloadJson: firstAttemptCalls.at(-1)?.data?.payloadJson,
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    const secondAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls
      .slice(firstAttemptCalls.length)
      .map(([payload]: [Record<string, unknown>]) => payload);
    expect(secondAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 2,
                eventId: "evt_123",
                lastAttemptAt: expect.any(String),
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledTimes(2);
  });

  it("allows a Stripe invoice webhook to retry after durable updates but before activation dispatch completes", async () => {
    mocks.dispatchHostedExecution
      .mockRejectedValueOnce(new Error("dispatch unavailable"))
      .mockResolvedValueOnce({ dispatched: true });
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: "cus_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
      },
      id: "evt_stripe_123",
      type: "invoice.paid",
    });

    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn()
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(createUniqueConstraintError()),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: "active",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
      },
    };

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_123" }),
        signature: "sig_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_EXECUTION_DISPATCH_FAILED",
      retryable: true,
    });

    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    const firstAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(firstAttemptCalls).toHaveLength(4);
    expect(firstAttemptCalls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              type: "invoice.paid",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildMemberActivationDispatchSideEffect({
                occurredAt: expect.any(String),
                sourceEventId: "evt_stripe_123",
                sourceType: "stripe.invoice.paid",
                status: "pending",
              }),
            ],
            status: "processing",
          }),
        }),
      }),
    );
    expect(firstAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              type: "invoice.paid",
            },
            lastError: expect.objectContaining({
              name: "HostedOnboardingError",
            }),
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildMemberActivationDispatchSideEffect({
                attemptCount: 1,
                lastAttemptAt: expect.any(String),
                lastError: {
                  code: "HOSTED_EXECUTION_DISPATCH_FAILED",
                  message: "Hosted execution dispatch failed and the webhook should be retried.",
                  name: "HostedOnboardingError",
                  retryable: true,
                },
                occurredAt: expect.any(String),
                sourceEventId: "evt_stripe_123",
                sourceType: "stripe.invoice.paid",
                status: "pending",
              }),
            ],
            status: "failed",
          }),
        }),
      }),
    );
    prisma.hostedWebhookReceipt.findUnique.mockResolvedValueOnce({
      payloadJson: firstAttemptCalls.at(-1)?.data?.payloadJson,
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(2);
    const secondAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls
      .slice(firstAttemptCalls.length)
      .map(([payload]: [Record<string, unknown>]) => payload);
    expect(secondAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              type: "invoice.paid",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildMemberActivationDispatchSideEffect({
                attemptCount: 2,
                lastAttemptAt: expect.any(String),
                occurredAt: expect.any(String),
                sentAt: expect.any(String),
                sourceEventId: "evt_stripe_123",
                sourceType: "stripe.invoice.paid",
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledTimes(2);
  });

  it("does not redispatch an already-sent Linq side effect when reclaiming a failed receipt", async () => {
    const failedReceiptPayload = buildWebhookReceiptPayload({
      attemptCount: 1,
      attemptId: "attempt-1",
      eventPayload: {
        eventType: "message.received",
      },
      lastError: {
        message: "Receipt completion failed after the outbound dispatch was recorded.",
        name: "HostedOnboardingError",
      },
      lastReceivedAt: "2026-03-26T12:00:00.500Z",
      sideEffects: [
        buildDispatchSideEffect({
          attemptCount: 1,
          eventId: "evt_123",
          lastAttemptAt: "2026-03-26T12:00:00.250Z",
          sentAt: "2026-03-26T12:00:00.400Z",
          status: "sent",
        }),
      ],
      status: "failed",
    });
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: failedReceiptPayload,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: failedReceiptPayload,
          },
        }),
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                sentAt: "2026-03-26T12:00:00.400Z",
                status: "sent",
              }),
            ],
            status: "processing",
          }),
        }),
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                sentAt: "2026-03-26T12:00:00.400Z",
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.dispatchHostedExecution).not.toHaveBeenCalled();
  });

  it("treats completed Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: "2026-03-26T12:00:00.000Z",
            status: "completed",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedExecution).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("treats completed legacy flat Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildLegacyWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              eventType: "message.received",
            },
            status: "completed",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedExecution).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("treats in-flight processing Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-processing",
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: "2026-03-26T12:00:00.000Z",
            status: "processing",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedExecution).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("treats in-flight legacy flat Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildLegacyWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-processing",
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: "2026-03-26T12:00:00.000Z",
            status: "processing",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedExecution).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("reclaims malformed Linq receipts instead of treating them as duplicates", async () => {
    const malformedReceiptPayload = {
      receiptState: {
        attemptCount: "bad",
        status: 42,
      },
      strayLegacyField: "keep-me-if-possible",
    };
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: malformedReceiptPayload,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: malformedReceiptPayload,
          },
        }),
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
              strayLegacyField: "keep-me-if-possible",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [],
            status: "processing",
          }),
        }),
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
              strayLegacyField: "keep-me-if-possible",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: expect.any(String),
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledTimes(1);
  });

  it("submits and confirms an inline RevNet payment exactly once for a paid invoice", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          payment_intent: "pi_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
      },
      id: "evt_stripe_revnet_123",
      type: "invoice.paid",
    });

    const issuanceRow = {
      id: "hbrv_123",
      idempotencyKey: "stripe:invoice:in_123",
      payTxHash: null,
      status: "pending",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const submittedIssuanceRow = {
      ...issuanceRow,
      payTxHash: "0xabc123",
      status: "submitted",
      updatedAt: new Date("2026-03-26T12:00:01.000Z"),
    };

    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
      hostedRevnetIssuance: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockResolvedValue(issuanceRow),
        update: vi.fn()
          .mockResolvedValueOnce(submittedIssuanceRow)
          .mockResolvedValueOnce({
            ...submittedIssuanceRow,
            confirmedAt: new Date("2026-03-26T12:00:02.000Z"),
            status: "confirmed",
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedRevnetIssuance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
          paymentAmount: "1000000000000000",
          paymentAssetAddress: REVNET_NATIVE_TOKEN,
          stripeInvoiceId: "in_123",
          stripePaymentIntentId: "pi_123",
          stripePaymentAmountMinor: 500,
          stripePaymentCurrency: "usd",
        }),
        where: {
          idempotencyKey: "stripe:invoice:in_123",
        },
      }),
    );
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledWith({
      amountMinor: 500,
      beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
      memo: "HealthyBob invoice in_123 member member_123",
    });
    expect(mocks.waitForHostedRevnetPaymentConfirmation).toHaveBeenCalledWith({
      txHash: "0xabc123",
    });
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledTimes(1);
    expect(mocks.waitForHostedRevnetPaymentConfirmation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatchHostedExecution.mock.invocationCallOrder[0],
    );
  });

  it("does not resubmit a RevNet payment when the issuance is already confirmed", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          payment_intent: "pi_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
      },
      id: "evt_stripe_revnet_confirmed_123",
      type: "invoice.paid",
    });

    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
      hostedRevnetIssuance: {
        upsert: vi.fn().mockResolvedValue({
          id: "hbrv_123",
          idempotencyKey: "stripe:invoice:in_123",
          payTxHash: "0xabc123",
          status: "confirmed",
          updatedAt: new Date("2026-03-26T12:00:02.000Z"),
        }),
      },
    };

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_confirmed_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedRevnetIssuance.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.submitHostedRevnetPayment).not.toHaveBeenCalled();
    expect(mocks.waitForHostedRevnetPaymentConfirmation).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledTimes(1);
  });

  it("treats completed Stripe receipts as duplicates without replaying durable updates", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: "cus_123",
        },
      },
      id: "evt_stripe_123",
      type: "invoice.paid",
    });

    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildLegacyWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              type: "invoice.paid",
            },
            status: "completed",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedExecution).not.toHaveBeenCalled();
  });
});

function buildLinqMessageWebhookBody(): string {
  return JSON.stringify({
    api_version: "v1",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      recipient_phone: "+15550000000",
      received_at: "2026-03-26T12:00:00.000Z",
      service: "sms",
    },
    event_id: "evt_123",
    event_type: "message.received",
  });
}

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    clientVersion: "test",
    code: "P2002",
  });
}

function buildWebhookReceiptPayload(input: {
  attemptCount: number;
  attemptId?: unknown;
  completedAt?: unknown;
  eventPayload: Record<string, unknown>;
  lastError?: unknown;
  lastReceivedAt?: unknown;
  sideEffects?: unknown[];
  status: "completed" | "failed" | "processing";
}) {
  return {
    eventPayload: input.eventPayload,
    receiptState: {
      attemptCount: input.attemptCount,
      attemptId: input.attemptId ?? "attempt-1",
      completedAt:
        input.completedAt ??
        (input.status === "completed" ? "2026-03-26T12:00:00.000Z" : null),
      lastError:
        input.lastError ??
        (input.status === "failed"
          ? {
            message: "Unknown hosted webhook failure.",
            name: "UnknownError",
          }
          : null),
      lastReceivedAt: input.lastReceivedAt ?? "2026-03-26T12:00:00.000Z",
      sideEffects: input.sideEffects ?? [],
      status: input.status,
    },
  };
}

function buildLegacyWebhookReceiptPayload(input: {
  attemptCount: number;
  attemptId?: unknown;
  completedAt?: unknown;
  eventPayload: Record<string, unknown>;
  lastError?: unknown;
  lastReceivedAt?: unknown;
  status: "completed" | "failed" | "processing";
}) {
  return {
    ...input.eventPayload,
    receiptAttemptCount: input.attemptCount,
    receiptAttemptId: input.attemptId ?? "attempt-1",
    receiptCompletedAt:
      input.completedAt ??
      (input.status === "completed" ? "2026-03-26T12:00:00.000Z" : null),
    receiptLastError:
      input.lastError ??
      (input.status === "failed"
        ? {
          message: "Unknown hosted webhook failure.",
          name: "UnknownError",
        }
        : null),
    receiptLastReceivedAt: input.lastReceivedAt ?? "2026-03-26T12:00:00.000Z",
    receiptStatus: input.status,
  };
}

function makeActiveMember() {
  return {
    billingStatus: HostedBillingStatus.active,
    id: "member_123",
    invites: [],
    linqChatId: "chat_123",
    normalizedPhoneNumber: "+15551234567",
  };
}

function buildDispatchSideEffect(input: {
  attemptCount?: number;
  effectId?: unknown;
  eventId: string;
  lastAttemptAt?: unknown;
  lastError?: unknown;
  occurredAt?: unknown;
  sentAt?: unknown;
  status: "pending" | "sent";
}) {
  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: input.effectId ?? `dispatch:${input.eventId}`,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload: {
      dispatch: {
        event: {
          kind: "linq.message.received",
          linqChatId: "chat_123",
          linqEvent: {
            api_version: "v1",
            created_at: "2026-03-26T12:00:00.000Z",
            data: {
              chat_id: "chat_123",
              from: "+15551234567",
              is_from_me: false,
              message: {
                id: "msg_123",
                parts: [
                  {
                    type: "text",
                    value: "hello",
                  },
                ],
              },
              received_at: "2026-03-26T12:00:00.000Z",
              recipient_phone: "+15550000000",
              service: "sms",
            },
            event_id: "evt_123",
            event_type: "message.received",
            partner_id: null,
            trace_id: null,
          },
          normalizedPhoneNumber: "+15551234567",
          userId: "member_123",
        },
        eventId: input.eventId,
        occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
      },
    },
    result: input.status === "sent" ? { dispatched: true } : null,
    sentAt:
      input.sentAt ??
      (input.status === "sent" ? "2026-03-26T12:00:01.000Z" : null),
    status: input.status,
  };
}

function buildMemberActivationDispatchSideEffect(input: {
  attemptCount?: number;
  effectId?: unknown;
  lastAttemptAt?: unknown;
  lastError?: unknown;
  linqChatId?: string | null;
  memberId?: string;
  normalizedPhoneNumber?: string;
  occurredAt?: unknown;
  sentAt?: unknown;
  sourceEventId: string;
  sourceType: string;
  status: "pending" | "sent";
}) {
  const memberId = input.memberId ?? "member_123";
  const eventId =
    input.effectId ??
    `dispatch:member.activated:${input.sourceType}:${memberId}:${input.sourceEventId}`;

  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: eventId,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload: {
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: input.linqChatId ?? "chat_123",
          normalizedPhoneNumber: input.normalizedPhoneNumber ?? "+15551234567",
          userId: memberId,
        },
        eventId: String(eventId).replace(/^dispatch:/u, ""),
        occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
      },
    },
    result: input.status === "sent" ? { dispatched: true } : null,
    sentAt:
      input.sentAt ??
      (input.status === "sent" ? "2026-03-26T12:00:01.000Z" : null),
    status: input.status,
  };
}
