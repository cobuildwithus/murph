import { HostedBillingStatus, HostedMemberStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueHostedExecutionOutbox: vi.fn(),
  runtimeEnv: {
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null as string | null,
    privyAppId: "privy-app-id",
    privyVerificationKey: "privy-key",
    publicBaseUrl: "https://join.example.test",
    revnetChainId: null as number | null,
    revnetProjectId: null as string | null,
    revnetRpcUrl: null as string | null,
    revnetStripeCurrency: null as string | null,
    revnetTerminalAddress: null as string | null,
    revnetTreasuryPrivateKey: null as string | null,
    revnetWeiPerStripeMinorUnit: null as string | null,
    sessionCookieName: "hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "payment" as const,
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: "murph_bot",
    telegramWebhookSecret: null as string | null,
  },
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
  };
});

import { handleHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

describe("handleHostedOnboardingTelegramWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.runtimeEnv.telegramWebhookSecret = null;
  });

  it("reuses an existing transaction when dispatching linked active-member Telegram messages", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          status: HostedMemberStatus.active,
        }),
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 321,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            botUserId: null,
            kind: "telegram.message.received",
            userId: "member_telegram_123",
          }),
          eventId: "telegram:update:321",
        }),
        sourceId: "telegram:telegram:update:321",
        sourceType: "hosted_webhook_receipt",
      }),
    );

    const receiptWrites = (
      prisma as unknown as {
        hostedWebhookReceipt: {
          updateMany: ReturnType<typeof vi.fn>;
        };
      }
    ).hostedWebhookReceipt.updateMany.mock.calls.map((call) => call[0] as Record<string, unknown>);

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
                      eventId: "telegram:update:321",
                      eventKind: "telegram.message.received",
                      userId: "member_telegram_123",
                    }),
                    botUserId: null,
                    telegramUpdate: expect.objectContaining({
                      update_id: 321,
                    }),
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
  });

  it("rejects Telegram webhooks whose configured secret token is missing", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: null,
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WEBHOOK_SECRET_REQUIRED",
      httpStatus: 401,
    });
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhooks when the server-side secret is not configured", async () => {
    const hostedMemberFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: "telegram-secret",
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WEBHOOK_SECRET_NOT_CONFIGURED",
      httpStatus: 500,
    });
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores suspended members even when billing remains active", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          status: HostedMemberStatus.suspended,
        }),
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 321,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "suspended-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores business-account self messages flagged through sender_business_bot", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 654,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        business_message: {
          business_connection_id: "bc_123",
          chat: {
            id: 123,
            is_direct_messages: true,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 9,
          sender_business_bot: {
            id: 999,
            is_bot: true,
            username: "murph_bot",
          },
          text: "echo",
        },
        update_id: 654,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores plain self messages when Telegram marks the sender as the bot user", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 655,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_602,
          from: {
            first_name: "murph_bot",
            id: 999,
            is_bot: true,
            username: "murph_bot",
          },
          message_id: 10,
          text: "self echo",
        },
        update_id: 655,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("dispatches direct-messages topic chats using the shared local direct-thread model", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 777,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_456",
          status: HostedMemberStatus.active,
        }),
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100555,
            is_direct_messages: true,
            title: "Channel inbox",
            type: "supergroup",
          },
          date: 1_774_522_602,
          direct_messages_topic: {
            title: "Priority",
            topic_id: 9,
          },
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 4,
          text: "hello from the DM topic",
        },
        update_id: 777,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ok: true,
      reason: "dispatched-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            botUserId: null,
            kind: "telegram.message.received",
            telegramUpdate: expect.objectContaining({
              message: expect.objectContaining({
                chat: expect.objectContaining({
                  id: -100555,
                  is_direct_messages: true,
                }),
                direct_messages_topic: expect.objectContaining({
                  topic_id: 9,
                }),
              }),
            }),
            userId: "member_telegram_456",
          }),
          eventId: "telegram:update:777",
        }),
      }),
    );
  });

  it("rejects malformed Telegram message payloads before receipt persistence", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn();
    const hostedMemberFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: 123,
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: "telegram-secret",
      }),
    ).rejects.toThrowError(new TypeError("message.chat must be a JSON object."));

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects malformed direct-message topic payloads even when the secret is valid", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn();
    const hostedMemberFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: -100555,
              is_direct_messages: true,
              type: "supergroup",
            },
            date: 1_774_522_603,
            direct_messages_topic: {
              topic_id: "nine",
            },
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 5,
            text: "hello",
          },
          update_id: 778,
        }),
        secretToken: "telegram-secret",
      }),
    ).rejects.toThrowError(new TypeError("message.direct_messages_topic.topic_id must be an integer."));

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });
});

function asPrismaTransactionClient<T extends Record<string, unknown>>(prisma: T) {
  return prisma as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];
}

function withPrismaTransaction<T extends Record<string, unknown>>(prisma: T): T {
  const prismaWithTransaction = prisma as T & {
    $transaction: (callback: (tx: T) => Promise<unknown>) => Promise<unknown>;
  };
  prismaWithTransaction.$transaction = async (callback) => callback(prismaWithTransaction);
  return prismaWithTransaction;
}
