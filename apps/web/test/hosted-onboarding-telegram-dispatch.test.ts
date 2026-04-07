import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";
import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteHostedStoredDispatchPayloadBestEffort: vi.fn(),
  enqueueHostedExecutionOutbox: vi.fn(),
  maybeStageHostedExecutionDispatchPayload: vi.fn(),
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
    stripeBillingMode: "payment" as const,
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: "murph_bot",
    telegramWebhookSecret: null as string | null,
  },
  stagedDispatches: new Map<string, HostedExecutionDispatchRequest>(),
}));

vi.mock("@/src/lib/hosted-execution/outbox", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-execution/outbox")>(
    "@/src/lib/hosted-execution/outbox",
  );

  return {
    ...actual,
    enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
    enqueueHostedExecutionOutboxPayload: (input: {
      payload: {
        dispatch?: HostedExecutionDispatchRequest;
        dispatchRef?: {
          eventId: string;
        };
      };
      sourceId: string;
      sourceType: string;
      tx: unknown;
    }) => mocks.enqueueHostedExecutionOutbox({
      dispatch:
        input.payload.dispatch
        ?? (input.payload.dispatchRef
          ? mocks.stagedDispatches.get(input.payload.dispatchRef.eventId)
          : undefined),
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      tx: input.tx,
    }),
  };
});

vi.mock("@/src/lib/hosted-execution/control", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-execution/control")>(
    "@/src/lib/hosted-execution/control",
  );

  return {
    ...actual,
    deleteHostedStoredDispatchPayloadBestEffort: mocks.deleteHostedStoredDispatchPayloadBestEffort,
    maybeStageHostedExecutionDispatchPayload: mocks.maybeStageHostedExecutionDispatchPayload,
  };
});

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
    mocks.stagedDispatches.clear();
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.maybeStageHostedExecutionDispatchPayload.mockImplementation(
      async (dispatch: HostedExecutionDispatchRequest) => {
        mocks.stagedDispatches.set(dispatch.eventId, dispatch);
        return createStagedPayload(dispatch);
      },
    );
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
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
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
          completedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          create: expect.objectContaining({
            dispatchPayloadJson: expect.objectContaining({
              dispatchRef: expect.objectContaining({
                eventId: "telegram:update:321",
                eventKind: "telegram.message.received",
                userId: "member_telegram_123",
              }),
              payloadRef: expect.objectContaining({
                key: expect.stringContaining("/member_telegram_123/telegram:update:321.json"),
              }),
            }),
            kind: "hosted_execution_dispatch",
            status: "pending",
          }),
        }),
      ]),
    );
  });

  it("rejects Telegram webhooks whose configured secret token is missing", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
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
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhooks when the server-side secret is not configured", async () => {
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
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
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
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
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
          },
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
    const hostedMemberRoutingFindUnique = vi.fn();
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
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
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
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores plain self messages when Telegram marks the sender as the bot user", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn();
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
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
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
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
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
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_456",
            suspendedAt: null,
          },
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
            kind: "telegram.message.received",
            telegramMessage: expect.objectContaining({
              messageId: "4",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello from the DM topic",
              threadId: "-100555:dm-topic:9",
            }),
            userId: "member_telegram_456",
          }),
          eventId: "telegram:update:777",
        }),
      }),
    );
  });

  it("coarsens non-text Telegram payloads into placeholder text without carrying durable PII fields", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn().mockResolvedValue({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_telegram_789",
        suspendedAt: null,
      },
    });
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 880,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    }) as unknown as Parameters<typeof handleHostedOnboardingTelegramWebhook>[0]["prisma"];

    const cases = [
      {
        expectedText: "[shared contact]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
            username: "alice_private",
          },
          contact: {
            first_name: "Alice",
            last_name: "Example",
            phone_number: "+15555550123",
            user_id: 456,
          },
          date: 1_774_522_604,
          from: {
            first_name: "Alice",
            id: 456,
            username: "alice_sender",
          },
          message_id: 6,
        },
        updateId: 880,
      },
      {
        expectedText: "[shared location]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
          },
          date: 1_774_522_605,
          from: {
            first_name: "Alice",
            id: 456,
          },
          location: {
            latitude: 12.34,
            longitude: 56.78,
          },
          message_id: 7,
        },
        updateId: 881,
      },
      {
        expectedText: "[shared venue]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
          },
          date: 1_774_522_606,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 8,
          venue: {
            address: "123 Secret Street",
            latitude: 12.34,
            longitude: 56.78,
            title: "Secret Cafe",
          },
        },
        updateId: 882,
      },
      {
        expectedText: "[shared poll]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
          },
          date: 1_774_522_607,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 9,
          poll: {
            id: "poll_123",
            options: [
              { text: "Yes", voter_count: 1 },
              { text: "No", voter_count: 0 },
            ],
            question: "Where should we meet?",
            total_voter_count: 1,
          },
        },
        updateId: 883,
      },
    ];

    for (const testCase of cases) {
      mocks.enqueueHostedExecutionOutbox.mockClear();

      const response = await handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: testCase.message,
          update_id: testCase.updateId,
        }),
        secretToken: "telegram-secret",
      });

      expect(response).toEqual({
        ok: true,
        reason: "dispatched-active-member",
      });

      const enqueueCall = mocks.enqueueHostedExecutionOutbox.mock.calls.at(-1)?.[0] as {
        dispatch: HostedExecutionDispatchRequest;
      } | undefined;
      expect(enqueueCall?.dispatch.event.kind).toBe("telegram.message.received");
      if (enqueueCall?.dispatch.event.kind !== "telegram.message.received") {
        throw new Error("Expected a hosted Telegram dispatch.");
      }

      expect(enqueueCall.dispatch.event.telegramMessage).toEqual({
        messageId: String(testCase.message.message_id),
        schema: "murph.hosted-telegram-message.v1",
        text: testCase.expectedText,
        threadId: "123",
      });
    }

    expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(cases.length);
  });

  it("rejects malformed Telegram message payloads before receipt persistence", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn();
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
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
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects malformed direct-message topic payloads even when the secret is valid", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn();
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
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
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });
});

function withPrismaTransaction<T extends Record<string, unknown>>(prisma: T): T {
  const prismaWithTransaction = prisma as T & {
    $queryRaw: () => Promise<unknown>;
    $transaction: (callback: (tx: T) => Promise<unknown>) => Promise<unknown>;
    hostedMemberRouting?: {
      findFirst?: ReturnType<typeof vi.fn>;
      findUnique?: ReturnType<typeof vi.fn>;
    };
    hostedWebhookReceiptSideEffect?: {
      deleteMany?: ReturnType<typeof vi.fn>;
      upsert?: ReturnType<typeof vi.fn>;
    };
  };
  prismaWithTransaction.$queryRaw = async () => [];
  prismaWithTransaction.$transaction = async (callback) => callback(prismaWithTransaction);
  if (
    prismaWithTransaction.hostedMemberRouting?.findFirst === undefined &&
    prismaWithTransaction.hostedMemberRouting?.findUnique
  ) {
    prismaWithTransaction.hostedMemberRouting.findFirst =
      prismaWithTransaction.hostedMemberRouting.findUnique;
  }
  if (!prismaWithTransaction.hostedWebhookReceiptSideEffect?.deleteMany || !prismaWithTransaction.hostedWebhookReceiptSideEffect?.upsert) {
    prismaWithTransaction.hostedWebhookReceiptSideEffect = {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    };
  }
  return prismaWithTransaction;
}

function createStagedPayload(
  dispatch: HostedExecutionDispatchRequest,
) {
  return {
    dispatchRef: {
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      occurredAt: dispatch.occurredAt,
      userId: dispatch.event.userId,
    },
    payloadRef: {
      key: `transient/dispatch-payloads/${dispatch.event.userId}/${dispatch.eventId}.json`,
    },
    schemaVersion: "murph.execution-outbox.v2",
    storage: "reference" as const,
  };
}

function readHostedWebhookSideEffectUpsertCalls(prisma: object | null | undefined): Record<string, unknown>[] {
  const hostedWebhookReceiptSideEffect = (prisma as {
    hostedWebhookReceiptSideEffect?: {
      upsert?: {
        mock?: {
          calls?: unknown[][];
        };
      };
    };
  }).hostedWebhookReceiptSideEffect;

  return (hostedWebhookReceiptSideEffect?.upsert?.mock?.calls ?? []).map(
    (call) => ((call[0] as Record<string, unknown> | undefined) ?? {}),
  );
}
