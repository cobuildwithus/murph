import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueHostedExecutionOutbox: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    assertHostedLinqWebhookSignature: vi.fn(),
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      encryptionKeyVersion: "v1",
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: null,
      publicBaseUrl: "https://join.example.test",
      sessionCookieName: "hosted_session",
      sessionTtlDays: 30,
      stripeBillingMode: "payment",
      stripePriceId: "price_123",
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
  };
});

import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

describe("handleHostedOnboardingLinqWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
  });

  it("reuses an existing transaction when dispatching active-member Linq messages", async () => {
    const prisma = asPrismaTransactionClient({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify({
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
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            kind: "linq.message.received",
            userId: "member_123",
          }),
          eventId: "evt_123",
        }),
        sourceId: "linq:evt_123",
        sourceType: "hosted_webhook_receipt",
      }),
    );
    const receiptWrites = (
      prisma as unknown as {
        hostedWebhookReceipt: {
          updateMany: ReturnType<typeof vi.fn>;
        };
      }
    ).hostedWebhookReceipt.updateMany.mock.calls.map(
      (call) => call[0] as Record<string, unknown>,
    );
    expect(receiptWrites.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptState: expect.objectContaining({
              sideEffects: expect.arrayContaining([
                expect.objectContaining({
                  kind: "hosted_execution_dispatch",
                  payload: expect.objectContaining({
                    dispatchRef: expect.objectContaining({
                      eventId: "evt_123",
                      eventKind: "linq.message.received",
                      userId: "member_123",
                    }),
                    linqEvent: expect.objectContaining({
                      event_id: "evt_123",
                    }),
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("opens a Prisma transaction when dispatching an active-member Linq message from a root client", async () => {
    const transactionReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      hostedWebhookReceipt: {
        updateMany: transactionReceiptUpdateMany,
      },
    };
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
      },
    }, transactionClient) as unknown as Parameters<typeof handleHostedOnboardingLinqWebhook>[0]["prisma"] & {
      $transaction: ReturnType<typeof vi.fn>;
    };

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify({
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
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            kind: "linq.message.received",
            userId: "member_123",
          }),
          eventId: "evt_123",
        }),
        sourceId: "linq:evt_123",
        sourceType: "hosted_webhook_receipt",
        tx: transactionClient,
      }),
    );
    expect(transactionReceiptUpdateMany).toHaveBeenCalledTimes(1);
    expect(transactionReceiptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptState: expect.objectContaining({
              sideEffects: expect.arrayContaining([
                expect.objectContaining({
                  kind: "hosted_execution_dispatch",
                  payload: expect.objectContaining({
                    dispatchRef: expect.objectContaining({
                      eventId: "evt_123",
                      eventKind: "linq.message.received",
                      userId: "member_123",
                    }),
                  }),
                  result: {
                    dispatched: true,
                  },
                  status: "sent",
                }),
              ]),
            }),
          }),
        }),
        where: expect.objectContaining({
          eventId: "evt_123",
          source: "linq",
        }),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });
});

function asPrismaTransactionClient<T extends Record<string, unknown>>(prisma: T) {
  return prisma as unknown as Parameters<typeof handleHostedOnboardingLinqWebhook>[0]["prisma"];
}

function withPrismaTransaction<
  T extends Record<string, unknown>,
  TTx extends Record<string, unknown>,
>(prisma: T, tx: TTx): T & {
  $transaction: ReturnType<typeof vi.fn>;
} {
  let prismaWithTransaction: T & {
    $transaction: ReturnType<typeof vi.fn>;
  };
  const transaction = vi.fn(async (callback: (tx: TTx) => Promise<unknown>) => callback(tx));
  prismaWithTransaction = prisma as T & {
    $transaction: ReturnType<typeof vi.fn>;
  };
  prismaWithTransaction.$transaction = transaction;
  return prismaWithTransaction;
}
