import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingTelegramPrivateState,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  createHostedTelegramUsernameLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => {
  const state = {
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
    nudgeHostedRunnerUserBestEffort: vi.fn(async () => ({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    })),
    nudgeHostedRunnerUserBestEffortResult: vi.fn(async (
      input?: { context?: string; timeoutMs?: number; userId: string },
    ) => {
      void input;
      return {
        accepted: true,
        alarmScheduled: false,
        configured: true,
        errorCode: null,
        immediateDriveStarted: false,
        inFlight: false,
        nextAlarmAtPresent: false,
      };
    }),
    nudgeHostedAssistantRunnerUserBestEffortResult: vi.fn(async (
      input: { context?: string; timeoutMs?: number; userId: string },
    ) => {
      void input;
      return {
        accepted: true,
        alarmScheduled: false,
        configured: true,
        errorCode: null,
        immediateDriveStarted: false,
        inFlight: false,
        nextAlarmAtPresent: false,
        usageGateDenied: false,
      };
    }),
    signalHostedMailboxAppendRuntime: vi.fn(async () => ({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    })),
    readHostedMailboxItemByDedupeKey: vi.fn(async () => null),
    readHostedMailboxItemOwnerById: vi.fn(async (input: {
      mailboxItemId: string;
    }) => ({
      id: input.mailboxItemId,
      userId: "member_telegram_123",
    })),
    runtimeEnv: {
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32, 7),
        } as Record<string, Buffer>,
        readVersions: ["v1"] as string[],
      },
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: null as string | null,
      privyAppId: "privy-app-id",
      privyVerificationKey: "privy-key",
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment" as const,
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: "murph_bot",
      telegramWebhookSecret: null as string | null,
    },
    appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
      dispatch?: { eventId: string };
      envelope?: { eventId: string };
      eventId?: string;
      wake?: { eventId: string };
    }) => {
      await state.enqueueHostedExecutionOutbox(input);
      const eventId = typeof input.eventId === "string"
        ? input.eventId
        : input.dispatch?.eventId ?? input.envelope?.eventId ?? input.wake?.eventId;
      if (!eventId) {
        throw new Error("Expected a hosted mailbox append eventId.");
      }
      return {
        item: {
          dedupeKey: eventId,
          id: `mailbox_${eventId}`,
        },
      };
    }),
  };

  return state;
});

vi.mock("@/src/lib/hosted-mailbox/store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/store")>(
    "@/src/lib/hosted-mailbox/store",
  );

  return {
    ...actual,
    appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
    readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
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

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  hasHostedPrivyPhoneAuthConfig: vi.fn(() => false),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service-stripe", () => ({
  handleHostedStripeWebhook: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-telegram-dispatch.test.ts");
  }),
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerBestEffort: vi.fn(async () => "wake"),
  nudgeHostedRunnerUserBestEffort: mocks.nudgeHostedRunnerUserBestEffort,
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import { handleHostedOnboardingTelegramWebhook as handleHostedOnboardingTelegramWebhookImpl } from "@/src/lib/hosted-onboarding/webhook-service";

type HostedOnboardingTelegramWebhookInput = Parameters<typeof handleHostedOnboardingTelegramWebhookImpl>[0];
type TelegramWebhookPrismaHarness = {
  $executeRaw: () => Promise<unknown>;
  $queryRaw: () => Promise<unknown>;
  $transaction: (callback: (tx: TelegramWebhookPrismaHarness) => Promise<unknown>) => Promise<unknown>;
  hostedMember?: {
    findUnique?: ReturnType<typeof vi.fn>;
  };
  hostedMemberRouting?: {
    findMany?: (...args: unknown[]) => Promise<unknown>;
    findFirst?: (...args: unknown[]) => Promise<unknown>;
    findUnique?: (...args: unknown[]) => Promise<unknown>;
    upsert?: ReturnType<typeof vi.fn>;
  };
  hostedWebhookReceipt?: {
    create?: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
  };
  hostedWebhookReceiptSideEffect?: {
    deleteMany?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
  };
};

describe("handleHostedOnboardingTelegramWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.nudgeHostedRunnerUserBestEffort.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockImplementation(async (input) => ({
      ...await mocks.nudgeHostedRunnerUserBestEffortResult(input),
      usageGateDenied: false,
    }));
    mocks.readHostedMailboxItemOwnerById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => ({
      id: input.mailboxItemId,
      userId: "member_telegram_123",
    }));
    mocks.runtimeEnv.telegramWebhookSecret = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses an existing transaction when dispatching linked active-member Telegram messages", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
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
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

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
          quote: {
            text: "quoted",
          },
          reply_to_message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_599,
            from: {
              first_name: "Casey",
              id: 457,
              username: "casey",
            },
            message_id: 0,
            text: "Earlier message",
          },
          text: "hello",
        },
        update_id: 321,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:321",
          kind: "conversation.message",
          message: expect.objectContaining({
            channel: "telegram",
            telegramMessage: expect.objectContaining({
              messageId: "1",
              replyContextPreview: "Replying to: Earlier message\nQuoted text: quoted",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello",
              threadId: "123",
            }),
          }),
          userId: "member_telegram_123",
        }),
      }),
    );
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:321",
    });
    expect(response).not.toHaveProperty("wakeUserId");
    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
  });

  it("routes Murph Family questions to the assistant", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn(async (args?: { where?: { memberId?: string } }) => {
      if (args?.where?.memberId) {
        return null;
      }

      return {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          suspendedAt: null,
        },
        memberId: "member_telegram_123",
      };
    });
    const prisma = withPrismaTransaction({
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
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
          message_id: 2,
          text: "wiesz cos o family planie?",
        },
        update_id: 322,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:322",
          kind: "conversation.message",
          message: expect.objectContaining({
            telegramMessage: expect.objectContaining({
              text: "wiesz cos o family planie?",
            }),
          }),
        }),
      }),
    );
  });

  it("routes unknown token-shaped Telegram text to the assistant", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn(async (args?: { where?: { memberId?: string } }) => {
      if (args?.where?.memberId) {
        return null;
      }

      return {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          suspendedAt: null,
        },
        memberId: "member_telegram_123",
      };
    });
    const hostedAccountGroupInviteFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = withPrismaTransaction({
      hostedAccountGroupInvite: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: hostedAccountGroupInviteFindUnique,
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
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
            username: "alice_user",
          },
          message_id: 6,
          text: "sending the family_photos album now",
        },
        update_id: 326,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(hostedAccountGroupInviteFindUnique).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        inviteCode: "photos",
      },
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:326",
          kind: "conversation.message",
          message: expect.objectContaining({
            telegramMessage: expect.objectContaining({
              text: "sending the family_photos album now",
            }),
          }),
        }),
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:326",
    });
  });

  it("ignores Telegram family invite tokens that are not acceptable for the sender", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedAccountGroupInviteFindUnique = vi.fn().mockResolvedValue({
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      status: "pending",
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Alice_User"),
    });
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedAccountGroupInvite: {
        findUnique: hostedAccountGroupInviteFindUnique,
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Bob",
            id: 456,
            username: "bob_user",
          },
          message_id: 3,
          text: "/start family_invite_telegram",
        },
        update_id: 323,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "family-invite-not-accepted",
    });

    expect(hostedAccountGroupInviteFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        inviteCode: "invite_telegram",
      },
    }));
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("refreshes the persisted Telegram routing target when the inbound direct thread carries business context", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
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
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          business_connection_id: "biz-42",
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
        update_id: 654,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          message: expect.objectContaining({
            telegramMessage: expect.objectContaining({
              threadId: "123:business:biz-42",
            }),
          }),
        }),
      }),
    );
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
  });

  it("preserves a richer persisted Telegram thread target when a later webhook only carries a plain DM thread", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const existingTelegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_telegram_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: "123:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
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
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
          telegramUserIdEncrypted: existingTelegramPrivateColumns.telegramUserIdEncrypted,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 2,
          text: "plain direct reply",
        },
        update_id: 655,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const upsertCall = hostedMemberRoutingUpsert.mock.calls[0]?.[0] as {
      update: {
        telegramUserIdEncrypted: string;
      };
    };

    expect(
      await readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_telegram_123",
        telegramUserIdEncrypted: upsertCall.update.telegramUserIdEncrypted,
      }),
    ).toEqual({
      telegramThreadId: "123:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
  });

  it("fails closed when Telegram lookup resolves to multiple members across rotated blind-index candidates", async () => {
    const previousContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    const previousContactPrivacyCurrentVersion =
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.runtimeEnv.contactPrivacyKeyring = {
      currentVersion: "v2",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
        v2: Buffer.alloc(32, 8),
      },
      readVersions: ["v2", "v1"],
    };
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
      `v1:${Buffer.alloc(32, 7).toString("base64url")}`,
      `v2:${Buffer.alloc(32, 8).toString("base64url")}`,
    ].join(",");
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    const hostedMemberRoutingFindMany = vi.fn().mockResolvedValue([
      {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_v1",
          suspendedAt: null,
        },
        memberId: "member_telegram_v1",
      },
      {
        member: {
          billingStatus: HostedBillingStatus.incomplete,
          id: "member_telegram_v2",
          suspendedAt: null,
        },
        memberId: "member_telegram_v2",
      },
    ]);
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
        findMany: hostedMemberRoutingFindMany,
      },
    });

    try {
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
        reason: "ambiguous-telegram-binding",
      });
      expect(hostedMemberRoutingFindMany).toHaveBeenCalledWith({
        select: {
          linqChatIdEncrypted: true,
          linqChatLookupKey: true,
          linqHomeLineAssignedAt: true,
          linqRecipientPhoneEncrypted: true,
          linqRecipientPhoneLookupKey: true,
          member: {
            select: {
              billingStatus: true,
              createdAt: true,
              id: true,
              suspendedAt: true,
              updatedAt: true,
            },
          },
          memberId: true,
          pendingLinqChatIdEncrypted: true,
          pendingLinqChatLookupKey: true,
          pendingLinqParticipantContactEncrypted: true,
          pendingLinqParticipantContactKind: true,
          pendingLinqParticipantContactLookupKey: true,
          pendingLinqParticipantContactObservedAt: true,
          pendingLinqRecipientPhoneEncrypted: true,
          pendingLinqRecipientPhoneLookupKey: true,
          replyAliasLookupKey: true,
          telegramUserIdEncrypted: true,
          telegramUserLookupKey: true,
        },
        where: {
          telegramUserLookupKey: {
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:telegram-user:v2:/u),
              expect.stringMatching(/^hbidx:telegram-user:v1:/u),
            ]),
          },
        },
      });
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
      expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    } finally {
      restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousContactPrivacyKeys);
      restoreEnvValue(
        "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
        previousContactPrivacyCurrentVersion,
      );
    }
  });

  it("bounds hosted Telegram replyContextPreview before writing the hosted wake payload", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 322,
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
    });

    await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 2,
          quote: {
            text: "Q".repeat(220),
          },
          reply_to_message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            message_id: 1,
            text: "R".repeat(220),
          },
          text: "hello",
        },
        update_id: 322,
      }),
      secretToken: "telegram-secret",
    });

    const enqueueCall = mocks.enqueueHostedExecutionOutbox.mock.calls.at(-1)?.[0] as {
      envelope?: {
        message?: {
          telegramMessage?: {
            replyContextPreview?: unknown;
          };
        };
      };
    } | undefined;
    const preview = enqueueCall?.envelope?.message?.telegramMessage?.replyContextPreview;

    expect(typeof preview).toBe("string");
    expect(preview).toHaveLength(240);
    expect(preview).toMatch(/^Replying to: /u);
    expect(preview).toMatch(/\.\.\.$/u);
  });

  it("requires the hosted execution nudge before returning active-member success", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
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
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
        }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
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
        update_id: 654,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:654",
    });
  });

  it("signals Temporal for active-member Telegram messages", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: false,
      configured: false,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
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
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
        }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
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
        update_id: 655,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:655",
    });
  });

  it("accepts Telegram webhooks whose secret header is missing", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn().mockResolvedValue({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_telegram_123",
        invitedAt: "2026-03-01T00:00:00.000Z",
        paymentGraceEndsAt: null,
        stripeCurrentPeriodEndsAt: "2026-04-01T00:00:00.000Z",
        stripeSubscriptionStatus: "active",
        suspendedAt: null,
      },
    });
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
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

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
      code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
      httpStatus: 401,
    });
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhooks when the secret token does not match", async () => {
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
    });

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
        secretToken: "wrong-secret",
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
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
    });

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
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores suspended members even when billing remains active", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
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
        updateMany: hostedWebhookReceiptUpdateMany,
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
    });

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
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
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
    });

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
    });

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
    });

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
      reason: "wake-appended-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:777",
          kind: "conversation.message",
          message: expect.objectContaining({
            channel: "telegram",
            telegramMessage: expect.objectContaining({
              messageId: "4",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello from the DM topic",
              threadId: "-100555:dm-topic:9",
            }),
          }),
          userId: "member_telegram_456",
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
    });

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
        reason: "wake-appended-active-member",
      });

      const enqueueCall = mocks.enqueueHostedExecutionOutbox.mock.calls.at(-1)?.[0] as {
        envelope?: {
          kind?: string;
          message?: {
            telegramMessage?: unknown;
          };
        };
      } | undefined;
      expect(enqueueCall?.envelope?.kind).toBe("conversation.message");
      if (!enqueueCall?.envelope?.message || typeof enqueueCall.envelope.message !== "object") {
        throw new Error("Expected a hosted Telegram wake message.");
      }

      expect(enqueueCall.envelope.message.telegramMessage).toEqual({
        messageId: String(testCase.message.message_id),
        schema: "murph.hosted-telegram-message.v1",
        text: testCase.expectedText,
        threadId: "123",
      });
    }

    expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(cases.length * 3);
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
    });

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
    });

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

function withPrismaTransaction<T extends Record<string, unknown>>(
  prisma: T,
): T & TelegramWebhookPrismaHarness {
  const prismaWithTransaction = prisma as T & TelegramWebhookPrismaHarness;
  prismaWithTransaction.$executeRaw = async () => 0;
  prismaWithTransaction.$queryRaw = async () => [];
  prismaWithTransaction.$transaction = async (
    callback: (tx: TelegramWebhookPrismaHarness) => Promise<unknown>,
  ) => callback(prismaWithTransaction);
  if (prismaWithTransaction.hostedMemberRouting?.findUnique) {
    const originalFindUnique = prismaWithTransaction.hostedMemberRouting.findUnique;
    prismaWithTransaction.hostedMemberRouting.findUnique = vi.fn(async (...args: unknown[]) => {
      const result = await originalFindUnique(...args);
      return normalizeHostedMemberRoutingHarnessResult(result);
    });
  }
  if (
    prismaWithTransaction.hostedMemberRouting?.findFirst === undefined &&
    prismaWithTransaction.hostedMemberRouting?.findUnique
  ) {
    prismaWithTransaction.hostedMemberRouting.findFirst =
      prismaWithTransaction.hostedMemberRouting.findUnique;
  }
  if (
    prismaWithTransaction.hostedMemberRouting?.findMany === undefined &&
    prismaWithTransaction.hostedMemberRouting?.findFirst
  ) {
    prismaWithTransaction.hostedMemberRouting.findMany = vi.fn(async (...args: unknown[]) => {
      const result = await prismaWithTransaction.hostedMemberRouting?.findFirst?.(...args);
      return result ? [result] : [];
    });
  }
  if (
    prismaWithTransaction.hostedMemberRouting &&
    prismaWithTransaction.hostedMemberRouting.upsert === undefined
  ) {
    prismaWithTransaction.hostedMemberRouting.upsert = vi.fn().mockResolvedValue({});
  }
  if (prismaWithTransaction.hostedMember?.findUnique === undefined) {
    // The unified access gate loads the member access shape directly; every
    // linked member reaching that gate in these tests is a direct-paid active
    // member.
    prismaWithTransaction.hostedMember = {
      findUnique: vi.fn(async () => ({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      })),
    };
  }
  if (!prismaWithTransaction.hostedWebhookReceiptSideEffect?.deleteMany || !prismaWithTransaction.hostedWebhookReceiptSideEffect?.upsert) {
    prismaWithTransaction.hostedWebhookReceiptSideEffect = {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    };
  }
  return prismaWithTransaction;
}

function normalizeHostedMemberRoutingHarnessResult(result: unknown) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as {
    member?: {
      id?: unknown;
    } | null;
    memberId?: unknown;
    telegramUserIdEncrypted?: unknown;
  };
  const memberId = typeof record.memberId === "string"
    ? record.memberId
    : typeof record.member?.id === "string"
      ? record.member.id
      : null;

  return {
    ...record,
    ...(memberId ? { memberId } : {}),
    ...(record.telegramUserIdEncrypted === undefined
      ? { telegramUserIdEncrypted: null }
      : {}),
  };
}

type HostedOnboardingTelegramWebhookTestInput = Omit<HostedOnboardingTelegramWebhookInput, "prisma"> & {
  prisma?: TelegramWebhookPrismaHarness;
};

async function handleHostedOnboardingTelegramWebhook(
  input: HostedOnboardingTelegramWebhookTestInput,
) {
  return handleHostedOnboardingTelegramWebhookImpl(input as HostedOnboardingTelegramWebhookInput);
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

  return (hostedWebhookReceiptSideEffect?.upsert?.mock?.calls ?? []).map((call) =>
    normalizeHostedWebhookSideEffectUpsertCall(
      ((call[0] as Record<string, unknown> | undefined) ?? {}),
    )
  );
}

function normalizeHostedWebhookSideEffectUpsertCall(
  call: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...call,
    create: normalizeHostedWebhookSideEffectRecord(call.create),
    update: normalizeHostedWebhookSideEffectRecord(call.update),
  };
}

function normalizeHostedWebhookSideEffectRecord(value: unknown): Record<string, unknown> | unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    ...record,
    dispatchPayloadJson: record.kind === "hosted_execution_dispatch" ? record.payloadJson ?? null : null,
  };
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
