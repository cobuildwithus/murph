import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueHostedExecutionOutbox: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("../src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/linq")>(
    "../src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    assertHostedLinqWebhookSignature: vi.fn(),
    verifyAndParseHostedLinqWebhookRequest: vi.fn((input: { rawBody: string }) =>
      actual.parseHostedLinqWebhookEvent(input.rawBody),
    ),
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
          extra_field: "discard-me",
          from: "+15551234567",
          is_from_me: false,
          message: {
            extra_message_field: "discard-me-too",
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
                      data: expect.not.objectContaining({
                        extra_field: "discard-me",
                      }),
                    }),
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    const persistedLinqEvent = readPersistedLinqDispatchEvent(receiptWrites.at(-1));
    expect(persistedLinqEvent?.data).not.toHaveProperty("extra_field");
    expect((persistedLinqEvent?.data as { message?: Record<string, unknown> } | undefined)?.message).not.toHaveProperty(
      "extra_message_field",
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("opens a Prisma transaction when dispatching an active-member Linq message from a root client", async () => {
    const transactionReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionHostedMemberFindUnique = vi.fn().mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      normalizedPhoneNumber: "+15551234567",
    });
    const transactionClient = {
      hostedWebhookReceipt: {
        updateMany: transactionReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: transactionHostedMemberFindUnique,
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
    expect(transactionHostedMemberFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            kind: "linq.message.received",
            userId: "member_123",
          }),
          eventId: "evt_123",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "linq:evt_123",
        sourceType: "hosted_webhook_receipt",
        tx: transactionClient,
      }),
    );
    const receiptUpdateWrites = transactionReceiptUpdateMany.mock.calls.map(
      (call) => call[0] as Record<string, unknown>,
    );
    expect(receiptUpdateWrites).toContainEqual(
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

  it("rejects malformed message.received events before journaling or side effects", async () => {
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    } as unknown as Parameters<typeof handleHostedOnboardingLinqWebhook>[0]["prisma"];

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify({
        api_version: "v1",
        created_at: "2026-03-26T12:00:00.000Z",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
          message: {
            id: null,
            parts: [
              {
                type: "text",
                value: "hello",
              },
            ],
          },
          recipient_phone: "+15550000000",
          received_at: "2026-03-26T12:00:05.000Z",
          service: "sms",
        },
        event_id: "evt_missing_message_id",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Linq message.received message.id");

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("rejects invalid message.received timestamps before journaling or side effects", async () => {
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    } as unknown as Parameters<typeof handleHostedOnboardingLinqWebhook>[0]["prisma"];

    await expect(handleHostedOnboardingLinqWebhook({
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
          received_at: "not-a-timestamp",
          service: "sms",
        },
        event_id: "evt_invalid_received_at",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("received_at must be a valid timestamp");

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("prefers received_at when building active-member dispatch metadata", async () => {
    const transactionReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      hostedWebhookReceipt: {
        updateMany: transactionReceiptUpdateMany,
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

    await handleHostedOnboardingLinqWebhook({
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
          received_at: "2026-03-26T12:00:05.000Z",
          service: "sms",
        },
        event_id: "evt_456",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          eventId: "evt_456",
          occurredAt: "2026-03-26T12:00:05.000Z",
        }),
      }),
    );
    expect(transactionReceiptUpdateMany.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            data: expect.objectContaining({
              payloadJson: expect.objectContaining({
                receiptState: expect.objectContaining({
                  sideEffects: expect.arrayContaining([
                    expect.objectContaining({
                      payload: expect.objectContaining({
                        dispatchRef: expect.objectContaining({
                          occurredAt: "2026-03-26T12:00:05.000Z",
                        }),
                      }),
                    }),
                  ]),
                }),
              }),
            }),
          }),
        ],
      ]),
    );
  });

  it("rejects malformed Linq message payloads with the hosted payload error surface", async () => {
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
        findUnique: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify({
        api_version: "v1",
        created_at: "2026-03-26T12:00:00.000Z",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: "false",
          message: {
            id: "msg_123",
            parts: "not-an-array",
          },
        },
        event_id: "evt_invalid_payload",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_PAYLOAD_INVALID",
      httpStatus: 400,
    });
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

function readPersistedLinqDispatchEvent(
  receiptWrite: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const data =
    receiptWrite?.data && typeof receiptWrite.data === "object"
      ? (receiptWrite.data as Record<string, unknown>)
      : null;
  const payloadJson =
    data?.payloadJson && typeof data.payloadJson === "object"
      ? (data.payloadJson as Record<string, unknown>)
      : null;
  const receiptState =
    payloadJson?.receiptState && typeof payloadJson.receiptState === "object"
      ? (payloadJson.receiptState as Record<string, unknown>)
      : null;
  const sideEffect = Array.isArray(receiptState?.sideEffects)
    ? (receiptState.sideEffects[0] as Record<string, unknown> | undefined)
    : undefined;
  const payload =
    sideEffect?.payload && typeof sideEffect.payload === "object"
      ? (sideEffect.payload as Record<string, unknown>)
      : null;

  return payload?.linqEvent && typeof payload.linqEvent === "object"
    ? (payload.linqEvent as Record<string, unknown>)
    : undefined;
}
