import { HostedBillingMode, HostedBillingStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stripeConstructEvent = vi.fn();

  return {
    dispatchHostedExecution: vi.fn(),
    sendHostedLinqChatMessage: vi.fn(),
    stripeConstructEvent,
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

import {
  handleHostedOnboardingLinqWebhook,
  handleHostedStripeWebhook,
} from "@/src/lib/hosted-onboarding/service";

describe("hosted onboarding webhook retry safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            payloadJson: {
              receiptAttemptId: "attempt-1",
              eventType: "message.received",
              receiptAttemptCount: 1,
              receiptLastError: {
                message: "Hosted execution dispatch failed and the webhook should be retried.",
                name: "HostedOnboardingError",
              },
              receiptStatus: "failed",
            },
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
    ).rejects.toMatchObject({
      code: "HOSTED_EXECUTION_DISPATCH_FAILED",
      retryable: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptLastError: expect.objectContaining({
              name: "HostedOnboardingError",
            }),
            receiptStatus: "failed",
          }),
        }),
      }),
    );

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

    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: expect.objectContaining({
              receiptAttemptId: "attempt-1",
              receiptStatus: "failed",
            }),
          },
        }),
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptAttemptId: expect.any(String),
            receiptAttemptCount: 2,
            receiptStatus: "processing",
          }),
        }),
      }),
    );
    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: expect.objectContaining({
              receiptAttemptCount: 2,
              receiptStatus: "processing",
            }),
          },
        }),
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptAttemptCount: 2,
            receiptCompletedAt: expect.any(String),
            receiptLastError: null,
            receiptStatus: "completed",
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
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            payloadJson: {
              receiptAttemptId: "attempt-1",
              receiptAttemptCount: 1,
              receiptLastError: {
                message: "Hosted execution dispatch failed and the webhook should be retried.",
                name: "HostedOnboardingError",
              },
              receiptStatus: "failed",
              type: "invoice.paid",
            },
          }),
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
        update: vi.fn().mockResolvedValue({}),
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
    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptStatus: "failed",
          }),
        }),
      }),
    );

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
    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: expect.objectContaining({
              receiptAttemptId: "attempt-1",
              receiptStatus: "failed",
            }),
          },
        }),
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptAttemptId: expect.any(String),
            receiptAttemptCount: 2,
            receiptStatus: "processing",
          }),
        }),
      }),
    );
    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: expect.objectContaining({
              receiptAttemptCount: 2,
              receiptStatus: "processing",
            }),
          },
        }),
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptAttemptCount: 2,
            receiptCompletedAt: expect.any(String),
            receiptLastError: null,
            receiptStatus: "completed",
          }),
        }),
      }),
    );
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledTimes(2);
  });

  it("treats completed Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptCompletedAt: "2026-03-26T12:00:00.000Z",
            receiptStatus: "completed",
          },
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
          payloadJson: {
            eventType: "message.received",
            receiptAttemptId: "attempt-processing",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
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
          payloadJson: {
            receiptAttemptCount: 1,
            receiptCompletedAt: "2026-03-26T12:00:00.000Z",
            receiptStatus: "completed",
            type: "invoice.paid",
          },
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

function makeActiveMember() {
  return {
    billingStatus: HostedBillingStatus.active,
    id: "member_123",
    invites: [],
    linqChatId: "chat_123",
    normalizedPhoneNumber: "+15551234567",
  };
}
