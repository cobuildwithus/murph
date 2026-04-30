import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
} from "@/src/lib/hosted-onboarding/linq";

const mocks = vi.hoisted(() => {
  const state = {
    deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
    claimHostedLinqOnboardingLinkNotice: vi.fn(),
    claimHostedLinqQuotaReplyNotice: vi.fn(),
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
    finishHostedOnboardingTiming: vi.fn(),
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
    nudgeHostedRunnerUserBestEffort: vi.fn(async () => ({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    })),
    sendHostedLinqChatMessage: vi.fn(),
    sendHostedLinqReadReceipt: vi.fn(),
    startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
      baseDetails,
      startedAtMs: 0,
      step,
    })),
    readHostedMailboxItemByDedupeKey: vi.fn(async () => null),
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
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  claimHostedLinqOnboardingLinkNotice: mocks.claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice: mocks.claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
  resolveHostedLinqDayUtc: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerBestEffort: vi.fn(async () => "wake"),
  nudgeHostedRunnerUserBestEffort: mocks.nudgeHostedRunnerUserBestEffort,
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffort,
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
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32, 7),
        },
        readVersions: ["v1"],
      },
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqConversationPhoneNumbers: [],
      linqMaxActiveMembersPerConversationPhone: null,
      linqWebhookSecret: null,
      linqWebhookTimestampToleranceMs: 5 * 60_000,
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment",
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
    requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  };
});

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  hasHostedPrivyPhoneAuthConfig: vi.fn(() => false),
}));

vi.mock("@/src/lib/hosted-onboarding/wallet-address", () => ({
  normalizeHostedWalletAddress: vi.fn(() => null),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service-stripe", () => ({
  handleHostedStripeWebhook: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-linq-dispatch.test.ts");
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/logging", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/logging")>(
    "@/src/lib/hosted-onboarding/logging",
  );

  return {
    ...actual,
    deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
    finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
    startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  };
});

import { handleHostedOnboardingLinqWebhook as handleHostedOnboardingLinqWebhookImpl } from "@/src/lib/hosted-onboarding/webhook-service";

type MockedFunction = ReturnType<typeof vi.fn>;
type HostedOnboardingLinqWebhookInput = Parameters<typeof handleHostedOnboardingLinqWebhookImpl>[0];

type HostedInviteFixture = {
  findFirst?: (input: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }) => Promise<unknown>;
  findUnique?: MockedFunction;
};

type HostedLinqDailyStateFixture = {
  findUnique?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  updateMany?: (input: {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
};

type HostedMemberFixture = {
  findUnique?: (input: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
  }) => Promise<unknown>;
  updateMany?: MockedFunction;
};

type HostedMemberIdentityFixture = {
  findFirst?: (input: {
    include?: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
  findUnique?: (input: {
    include?: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
  upsert?: (input: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
};

type HostedMemberRoutingFixture = {
  findFirst?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  findUnique?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  updateMany?: (input: {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
  upsert?: MockedFunction;
};

type HostedWebhookReceiptFixture = {
  create?: MockedFunction;
  findUnique?: MockedFunction;
  updateMany?: MockedFunction;
};

type HostedWebhookReceiptSideEffectFixture = {
  deleteMany?: MockedFunction;
  upsert?: MockedFunction;
};

type PrismaFixtureBase = {
  $executeRaw?: MockedFunction;
  $queryRaw?: MockedFunction;
  $transaction?: MockedFunction;
  hostedInvite?: HostedInviteFixture;
  hostedLinqDailyState?: HostedLinqDailyStateFixture;
  hostedMember?: HostedMemberFixture;
  hostedMemberIdentity?: HostedMemberIdentityFixture;
  hostedMemberRouting?: HostedMemberRoutingFixture;
  hostedWebhookReceipt?: HostedWebhookReceiptFixture;
  hostedWebhookReceiptSideEffect?: HostedWebhookReceiptSideEffectFixture;
};

type HostedOnboardingLinqWebhookPrismaFixture = PrismaFixtureBase & {
  $executeRaw: MockedFunction;
  $queryRaw: MockedFunction;
  $transaction?: MockedFunction;
};

type HostedOnboardingLinqWebhookTestInput = Omit<HostedOnboardingLinqWebhookInput, "prisma"> & {
  prisma?: HostedOnboardingLinqWebhookPrismaFixture;
};

async function handleHostedOnboardingLinqWebhook(input: HostedOnboardingLinqWebhookTestInput) {
  return handleHostedOnboardingLinqWebhookImpl(input as HostedOnboardingLinqWebhookInput);
}

describe("handleHostedOnboardingLinqWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValue(makeHostedLinqDailyState());
    mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(makeHostedLinqDailyState({
      outboundCount: 1,
    }));
    mocks.nudgeHostedRunnerUserBestEffort.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
  });

  it("builds the inactive signup invite with the concise Murph positioning line", () => {
    expect(buildHostedInviteReply({
      joinUrl: "https://join.example.test/join/code_first_text",
    })).toBe(`Welcome to Murph, your personal health assistant.

Verify your phone to finish signup here:
https://join.example.test/join/code_first_text`);
  });

  it.each(["sms", "RCS"] as const)(
    "reuses an existing transaction when dispatching active-member Linq %s messages",
    async (service) => {
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
            phoneLookupKey: "+15551234567",
          }),
        },
      });

      const response = await handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          data: {
            extra_field: "discard-me",
            extra_message_field: "discard-me-too",
          },
          service,
        }),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });
      expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            eventId: "evt_123",
            kind: "conversation.message",
            message: expect.objectContaining({
              channel: "linq",
              linqMessage: expect.objectContaining({
                messageId: "msg_123",
                service,
              }),
            }),
            userId: "member_123",
          }),
        }),
      );
      expect(mocks.nudgeHostedRunnerUserBestEffort).toHaveBeenCalledWith({
        context: "webhook:linq",
        userId: "member_123",
      });
      expect(response).not.toHaveProperty("wakeUserId");
      expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
      expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
        chatId: "chat_123",
        signal: undefined,
        timeoutMs: 750,
      });
      expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
        memberId: "member_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
      });
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.plan",
        expect.objectContaining({
          eventIdSuffix: "vt_123",
          eventType: "message.received",
        }),
      );
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq.plan",
        }),
        "wake-appended-active-member",
        expect.objectContaining({
          desiredSideEffectCount: 0,
          duplicate: false,
          ingressReadReceiptRequested: true,
          ok: true,
          wakeUserPresent: true,
        }),
      );
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.verify-request",
        expect.objectContaining({
          signaturePresent: false,
          timestampPresent: false,
        }),
      );
      expect(mocks.startHostedOnboardingTiming).not.toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.receipt",
        expect.anything(),
      );
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq",
        }),
        "completed",
        expect.objectContaining({
          duplicate: false,
          eventIdSuffix: "vt_123",
          eventType: "message.received",
          responseReason: "wake-appended-active-member",
          signalAbortedBeforeReturn: false,
        }),
      );
      expect(
        mocks.finishHostedOnboardingTiming.mock.calls.some(
          ([handle, outcome]) =>
            (handle as { step?: string } | undefined)?.step === "hosted-onboarding.webhook.linq.wake-nudge"
            && outcome === "accepted",
        ),
      ).toBe(true);
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq.wake-nudge",
        }),
        "accepted",
        expect.objectContaining({
          accepted: true,
          alarmScheduled: false,
          alreadyRunning: false,
          configured: true,
          errorCode: null,
          inFlight: false,
          nextAlarmAtPresent: false,
        }),
      );
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq.wake-handoff",
        }),
        "completed",
        expect.objectContaining({
          deferred: false,
        }),
      );
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.wake-handoff",
        expect.objectContaining({
          deferred: false,
          eventIdSuffix: "vt_123",
          responseReason: "wake-appended-active-member",
          userIdPresent: true,
          userIdSuffix: "er_123",
        }),
      );
    },
  );

  it("does not wait for the hosted execution dispatch nudge when one is deferred", async () => {
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
          phoneLookupKey: "+15551234567",
        }),
      },
    });
    const deferred: Array<() => Promise<void>> = [];

    await expect(handleHostedOnboardingLinqWebhook({
      defer: (drain) => {
        deferred.push(drain);
      },
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_deferred_dispatch",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(deferred).toHaveLength(1);
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();

    await deferred[0]?.();

    expect(mocks.nudgeHostedRunnerUserBestEffort).toHaveBeenCalledWith({
      context: "webhook:linq",
      userId: "member_123",
    });
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-onboarding.webhook.linq.wake-handoff",
      expect.objectContaining({
        deferred: true,
        eventIdSuffix: "spatch",
        responseReason: "wake-appended-active-member",
        userIdPresent: true,
        userIdSuffix: "er_123",
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "scheduled",
      expect.objectContaining({
        deferred: true,
      }),
    );
    expect(
      mocks.finishHostedOnboardingTiming.mock.calls.some(
        ([handle, outcome]) =>
          (handle as { step?: string } | undefined)?.step === "hosted-onboarding.webhook.linq.wake-nudge"
          && outcome === "accepted",
      ),
    ).toBe(true);
  });

  it("sends an ingress Linq read receipt before a deferred Cloudflare handoff", async () => {
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
          phoneLookupKey: "+15551234567",
        }),
      },
    });
    const deferred: Array<() => Promise<void>> = [];
    const defer = vi.fn((drain: () => Promise<void>) => {
      deferred.push(drain);
    });

    await expect(handleHostedOnboardingLinqWebhook({
      defer,
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_ingress_read_receipt",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
      timeoutMs: 750,
    });
    expect(mocks.sendHostedLinqReadReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      defer.mock.invocationCallOrder[0],
    );
    expect(deferred).toHaveLength(1);
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-onboarding.webhook.linq.ingress-read-receipt",
      expect.objectContaining({
        chatIdPresent: true,
        responseReason: "wake-appended-active-member",
        timeoutMs: 750,
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "sent",
      expect.objectContaining({
        httpStatus: 204,
        responseReason: "wake-appended-active-member",
      }),
    );
  });

  it("keeps webhook success independent from ingress Linq read receipts", async () => {
    mocks.sendHostedLinqReadReceipt.mockRejectedValueOnce(new Error("read receipt failed"));
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
          phoneLookupKey: "+15551234567",
        }),
      },
    });
    const deferred: Array<() => Promise<void>> = [];

    await expect(handleHostedOnboardingLinqWebhook({
      defer: (drain) => {
        deferred.push(drain);
      },
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_ingress_read_receipt_failure",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
      timeoutMs: 750,
    });
    expect(deferred).toHaveLength(1);
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
        responseReason: "wake-appended-active-member",
      }),
    );

    await deferred[0]?.();
    expect(mocks.nudgeHostedRunnerUserBestEffort).toHaveBeenCalledWith({
      context: "webhook:linq",
      userId: "member_123",
    });
  });

  it("opens a Prisma transaction when dispatching an active-member Linq message from a root client", async () => {
    const transactionReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionHostedMemberFindUnique = vi.fn().mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
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
          phoneLookupKey: "+15551234567",
        }),
      },
    }, transactionClient);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody(),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionHostedMemberFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: transactionClient,
        envelope: expect.objectContaining({
          eventId: "evt_123",
          kind: "conversation.message",
          occurredAt: "2026-03-26T12:00:00.000Z",
          message: expect.objectContaining({
            channel: "linq",
            linqMessage: expect.objectContaining({
              messageId: "msg_123",
            }),
          }),
          userId: "member_123",
        }),
      }),
    );
    expect(transactionReceiptUpdateMany).not.toHaveBeenCalled();
    expect(readHostedWebhookSideEffectUpsertCalls(transactionClient)).toEqual([]);
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
      timeoutMs: 750,
    });
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: transactionClient,
    });
  });

  it("rejects malformed message.received events before journaling or side effects", async () => {
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = asPrismaTransactionClient({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          id: null,
          sent_at: "2026-03-26T12:00:05.000Z",
        },
        eventId: "evt_missing_message_id",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Linq message.received message.id");

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("rejects invalid message.received timestamps before journaling or side effects", async () => {
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = asPrismaTransactionClient({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sent_at: "not-a-timestamp",
        },
        eventId: "evt_invalid_sent_at",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("sent_at must be a valid timestamp");

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("prefers sent_at when building active-member dispatch metadata", async () => {
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
          phoneLookupKey: "+15551234567",
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
          phoneLookupKey: "+15551234567",
        }),
      },
    }, transactionClient);

    await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sent_at: "2026-03-26T12:00:05.000Z",
        },
        eventId: "evt_456",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "evt_456",
          kind: "conversation.message",
          occurredAt: "2026-03-26T12:00:05.000Z",
        }),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(transactionClient)).toEqual([]);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:05.000Z",
      prisma: transactionClient,
    });
  });

  it("ignores suspended Linq members before dispatching or inviting", async () => {
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
          phoneLookupKey: "+15551234567",
          suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_suspended",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "suspended-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("does not send a Linq read receipt when active-member mailbox persistence fails", async () => {
    mocks.enqueueHostedExecutionOutbox.mockRejectedValueOnce(new Error("mailbox append failed"));
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
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_mailbox_append_failure",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("mailbox append failed");

    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
  });

  it("sends the signup link on the first inbound Linq message", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_first_text",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "hello there",
            },
          ],
        },
        eventId: "evt_non_trigger",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_first_text",
      joinUrl: "https://join.example.test/join/code_first_text",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_first_text",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0],
    );
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores non-iMessage first-contact texts without sending signup links", async () => {
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_sms_first_contact",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "non-imessage-first-contact",
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it.each(["sms", "RCS"] as const)(
    "ignores existing inactive non-iMessage first-contact %s texts without sending signup links",
    async (service) => {
      const prismaMocks = {
        $queryRaw: vi.fn().mockResolvedValue([]),
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
        hostedInvite: {
          create: vi.fn(),
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        hostedMember: {
          create: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            billingStatus: HostedBillingStatus.not_started,
            id: "member_123",
            invites: [],
            phoneLookupKey: "+15551234567",
            suspendedAt: null,
          }),
          update: vi.fn(),
        },
      };
      const prisma = asPrismaTransactionClient(prismaMocks);

      const response = await handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          eventId: `evt_${service.toLowerCase()}_inactive_first_contact`,
          service,
        }),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "non-imessage-first-contact",
      });
      expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
      expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
      expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
      expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
      expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
      expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
      expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    },
  );

  it("keeps first-contact signup replies inline even when a defer hook is provided", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_deferred",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const deferred: Array<() => Promise<void>> = [];

    const response = await handleHostedOnboardingLinqWebhook({
      defer: (drain) => {
        deferred.push(drain);
      },
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_deferred_signup",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_deferred",
      joinUrl: "https://join.example.test/join/code_deferred",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(deferred).toHaveLength(0);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_deferred",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("passes the request signal through inline signup replies", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_aborted",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const controller = new AbortController();
    const deferred: Array<() => Promise<void>> = [];

    await expect(handleHostedOnboardingLinqWebhook({
      defer: (drain) => {
        deferred.push(drain);
      },
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_aborted_signup",
        service: "iMessage",
      }),
      signal: controller.signal,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });

    expect(deferred).toHaveLength(0);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_aborted",
        }),
        replyToMessageId: "msg_123",
        signal: controller.signal,
      }),
    );
    controller.abort();
  });

  it("sends the signup link even when the first-contact Linq message has no text", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_non_text",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "media",
              url: "https://example.test/signup.jpg",
            },
          ],
        },
        eventId: "evt_non_text",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_non_text",
      joinUrl: "https://join.example.test/join/code_non_text",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_non_text",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("redirects active users who text a non-home Murph line without rebinding the home chat", async () => {
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
          phoneLookupKey: "+15551234567",
          routing: {
            linqChatIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-chat-id",
              memberId: "member_123",
              value: "chat_home",
            }),
            linqRecipientPhoneEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-recipient-phone",
              memberId: "member_123",
              value: "+15550100001",
            }),
            memberId: "member_123",
            pendingLinqChatIdEncrypted: null,
            pendingLinqRecipientPhoneEncrypted: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: null,
          },
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatIdEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-chat-id",
            memberId: "member_123",
            value: "chat_home",
          }),
          linqRecipientPhoneEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-recipient-phone",
            memberId: "member_123",
            value: "+15550100001",
          }),
          memberId: "member_123",
          pendingLinqChatIdEncrypted: null,
          pendingLinqRecipientPhoneEncrypted: null,
          telegramUserIdEncrypted: null,
          telegramUserLookupKey: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_other",
            owner_handle: {
              handle: "+15550100002",
              id: "handle_owner_other",
              is_me: true,
              service: "sms",
            },
          },
        },
        eventId: "evt_redirect",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "redirected-to-home-line",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_other",
        message: buildHostedLinqConversationHomeRedirectReply({
          homeRecipientPhone: "+15550100001",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
  });

  it("ignores sparse non-home webhook payloads when the saved home line is known but the incoming line is missing", async () => {
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
          phoneLookupKey: "+15551234567",
          routing: {
            linqChatIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-chat-id",
              memberId: "member_123",
              value: "chat_home",
            }),
            linqRecipientPhoneEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-recipient-phone",
              memberId: "member_123",
              value: "+15550100001",
            }),
            memberId: "member_123",
            pendingLinqChatIdEncrypted: null,
            pendingLinqRecipientPhoneEncrypted: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: null,
          },
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_other",
          },
        },
        eventId: "evt_sparse_redirect",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unknown-home-line",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
  });

  it("suppresses repeat signup links after the first send that day", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 2,
      onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
    }));
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
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_repeat_signup",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "signup-link-already-sent",
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("suppresses signup links when another transaction already claimed the one-shot notice", async () => {
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValueOnce(false);
    const hostedInviteCreate = vi.fn();
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
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_signup_claim_lost",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "signup-link-already-sent",
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(hostedInviteCreate).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("sends one daily quota reply after the 100th active-member inbound message", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 101,
    }));
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
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_over_limit",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-daily-quota-reply",
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: "You have reached Murph's daily text limit of 100 messages. Try again tomorrow.",
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
  });

  it("suppresses duplicate quota replies when another transaction already claimed the daily notice", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 101,
    }));
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValueOnce(false);
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
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_over_limit_claim_lost",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "daily-quota-reached",
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("keeps the daily quota marker claimed when the inline active-member quota reply fails", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 101,
    }));
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(new Error("linq send failed"));
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
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_over_limit_send_failure",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("linq send failed");

    expect(mocks.claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0],
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
  });

  it("tracks echoed outbound Linq messages without dispatching hosted execution", async () => {
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
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          direction: "outbound",
          recipient_phone: "+15559876543",
          sender_handle: {
            handle: "+15551234567",
            id: "handle_sender_123",
            service: "sms",
          },
        },
        eventId: "evt_outbound_echo",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(mocks.incrementHostedLinqOutboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: "not-an-array",
        },
        eventId: "evt_invalid_payload",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_PAYLOAD_INVALID",
      httpStatus: 400,
    });
  });
});

function asPrismaTransactionClient<T extends PrismaFixtureBase>(
  prisma: T,
): T & HostedOnboardingLinqWebhookPrismaFixture {
  const hostedInvite = prisma.hostedInvite;
  const hostedLinqDailyState = prisma.hostedLinqDailyState;
  const hostedMemberIdentity = prisma.hostedMemberIdentity;
  const hostedMemberRouting = prisma.hostedMemberRouting;
  const hostedMember = prisma.hostedMember;

  if (hostedInvite && !hostedInvite.findUnique && hostedInvite.findFirst) {
    hostedInvite.findUnique = vi.fn(async (input: { where?: Record<string, unknown>; select?: Record<string, unknown> }) =>
      hostedInvite.findFirst?.({
        select: input.select,
        where: input.where,
      }),
    );
  }

  if (hostedMember && !hostedMember.updateMany) {
    hostedMember.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  }

  if (!hostedMemberIdentity?.findUnique) {
    Object.defineProperty(prisma, "hostedMemberIdentity", {
      configurable: true,
      value: {
        findFirst: vi.fn(async ({ include, where }: { include?: Record<string, unknown>; where: Record<string, unknown> }) => {
          const phoneLookupKey = Array.isArray((where.phoneLookupKey as { in?: unknown[] } | undefined)?.in)
            ? (where.phoneLookupKey as { in: unknown[] }).in[0]
            : undefined;
          const member = await hostedMember?.findUnique?.({
            include,
            where: {
              ...(typeof phoneLookupKey === "string"
                ? {
                    phoneLookupKey,
                  }
                : {}),
            },
          });
          const identity = readHostedMemberIdentityFromMockMember(member, phoneLookupKey);

          if (!identity) {
            return null;
          }

          return include?.member ? { ...identity, member } : identity;
        }),
        findUnique: vi.fn(async ({ include, where }: { include?: Record<string, unknown>; where: Record<string, unknown> }) => {
          const member = await hostedMember?.findUnique?.({
            include,
            where,
          });
          const identity = readHostedMemberIdentityFromMockMember(member, where.phoneLookupKey);

          if (!identity) {
            return null;
          }

          return include?.member ? { ...identity, member } : identity;
        }),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
          ...create,
          ...update,
        })),
      },
    });
  } else if (!hostedMemberIdentity.findFirst && hostedMemberIdentity.findUnique) {
    hostedMemberIdentity.findFirst = vi.fn(async ({
      include,
      where,
    }: {
      include?: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      const phoneLookupKey = Array.isArray((where.phoneLookupKey as { in?: unknown[] } | undefined)?.in)
        ? (where.phoneLookupKey as { in: unknown[] }).in[0]
        : undefined;

      const findUnique = hostedMemberIdentity.findUnique;

      if (!findUnique) {
        return null;
      }

      return findUnique({
        include,
        where: {
          ...(typeof phoneLookupKey === "string"
            ? {
                phoneLookupKey,
              }
            : {}),
        },
      });
    });
  }

  if (!hostedMemberRouting?.upsert) {
    Object.defineProperty(prisma, "hostedMemberRouting", {
      configurable: true,
      value: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create),
      },
    });
  } else if (!hostedMemberRouting.findFirst && hostedMemberRouting.findUnique) {
    hostedMemberRouting.findFirst = hostedMemberRouting.findUnique;
  }

  if (!prisma.hostedWebhookReceiptSideEffect?.deleteMany || !prisma.hostedWebhookReceiptSideEffect?.upsert) {
    Object.defineProperty(prisma, "hostedWebhookReceiptSideEffect", {
      configurable: true,
      value: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
  }

  if (!hostedLinqDailyState?.findUnique) {
    Object.defineProperty(prisma, "hostedLinqDailyState", {
      configurable: true,
      value: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
  } else if (!hostedLinqDailyState.updateMany) {
    hostedLinqDailyState.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  }

  return prisma as T & HostedOnboardingLinqWebhookPrismaFixture;
}

function withPrismaTransaction<
  T extends PrismaFixtureBase,
  TTx extends PrismaFixtureBase,
>(prisma: T, tx: TTx): T & HostedOnboardingLinqWebhookPrismaFixture & {
  $executeRaw: MockedFunction;
  $queryRaw: MockedFunction;
  $transaction: MockedFunction;
} {
  const prismaWithTransaction = asPrismaTransactionClient(prisma);
  const transactionClient = asPrismaTransactionClient(tx);
  const transaction = vi.fn(async (callback: (innerTx: typeof transactionClient) => Promise<unknown>) =>
    callback(transactionClient)
  );
  prismaWithTransaction.$executeRaw = vi.fn(async () => 0);
  prismaWithTransaction.$queryRaw = vi.fn(async () => []);
  transactionClient.$executeRaw ??= vi.fn(async () => 0);
  transactionClient.$queryRaw ??= vi.fn(async () => []);
  prismaWithTransaction.$transaction = transaction;
  return prismaWithTransaction as T & HostedOnboardingLinqWebhookPrismaFixture & {
    $executeRaw: MockedFunction;
    $queryRaw: MockedFunction;
    $transaction: MockedFunction;
  };
}


function readHostedMemberIdentityFromMockMember(
  member: unknown,
  requestedPhoneLookupKey?: unknown,
) {
  if (!member || typeof member !== "object") {
    return null;
  }

  const record = member as Record<string, unknown>;
  const identity =
    record.identity && typeof record.identity === "object"
      ? (record.identity as Record<string, unknown>)
      : record;
  const memberId =
    typeof identity.memberId === "string"
      ? identity.memberId
      : typeof record.id === "string"
        ? record.id
        : null;

  if (!memberId) {
    return null;
  }

  const phoneLookupKey =
    typeof requestedPhoneLookupKey === "string"
      ? requestedPhoneLookupKey
      : typeof identity.phoneLookupKey === "string"
        ? identity.phoneLookupKey
        : null;

  if (!phoneLookupKey) {
    return null;
  }

  return {
    maskedPhoneNumberHint:
      typeof identity.maskedPhoneNumberHint === "string" ? identity.maskedPhoneNumberHint : "*** 4567",
    memberId,
    phoneLookupKey,
    phoneNumberVerifiedAt:
      identity.phoneNumberVerifiedAt instanceof Date ? identity.phoneNumberVerifiedAt : null,
    privyUserId: typeof identity.privyUserId === "string" ? identity.privyUserId : null,
    walletAddress: typeof identity.walletAddress === "string" ? identity.walletAddress : null,
    walletChainType: typeof identity.walletChainType === "string" ? identity.walletChainType : null,
    walletCreatedAt: identity.walletCreatedAt instanceof Date ? identity.walletCreatedAt : null,
    walletProvider: typeof identity.walletProvider === "string" ? identity.walletProvider : null,
  };
}

function buildHostedLinqWebhookBody(input: {
  createdAt?: string;
  data?: Record<string, unknown>;
  eventId?: string;
  service?: string;
} = {}): string {
  const service = input.service ?? "sms";

  return JSON.stringify({
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-26T12:00:00.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_123",
          is_me: true,
          service,
        },
      },
      direction: "inbound",
      id: "msg_123",
      parts: [
        {
          type: "text",
          value: "hello",
        },
      ],
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service,
      },
      sent_at: "2026-03-26T12:00:00.000Z",
      service,
      ...(input.data ?? {}),
    },
    event_id: input.eventId ?? "evt_123",
    event_type: "message.received",
  });
}

function readHostedWebhookReceiptCreateMock(prisma: PrismaFixtureBase | null | undefined): MockedFunction {
  return requireMock(prisma?.hostedWebhookReceipt?.create, "hostedWebhookReceipt.create");
}

function readHostedWebhookReceiptUpdateManyMock(prisma: PrismaFixtureBase | null | undefined): MockedFunction {
  return requireMock(prisma?.hostedWebhookReceipt?.updateMany, "hostedWebhookReceipt.updateMany");
}

function readHostedMemberRoutingUpsertMock(prisma: PrismaFixtureBase | null | undefined): MockedFunction {
  return requireMock(prisma?.hostedMemberRouting?.upsert, "hostedMemberRouting.upsert");
}

function requireMock(mock: MockedFunction | undefined, label: string): MockedFunction {
  if (!mock) {
    throw new Error(`Expected ${label} mock.`);
  }

  return mock;
}

function readHostedWebhookSideEffectUpsertCalls(
  prisma: PrismaFixtureBase | null | undefined,
): Record<string, unknown>[] {
  return (prisma?.hostedWebhookReceiptSideEffect?.upsert?.mock?.calls ?? []).map((call) =>
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
  const payload =
    record.payloadJson && typeof record.payloadJson === "object" && !Array.isArray(record.payloadJson)
      ? record.payloadJson as Record<string, unknown>
      : null;
  const result =
    record.resultJson && typeof record.resultJson === "object" && !Array.isArray(record.resultJson)
      ? record.resultJson as Record<string, unknown>
      : null;

  return {
    ...record,
    dispatchPayloadJson: record.kind === "hosted_execution_dispatch" ? record.payloadJson ?? null : null,
    linqChatId: record.kind === "linq_message_send" && typeof payload?.chatId === "string" ? payload.chatId : null,
    linqMemberId: record.kind === "linq_message_send" && typeof payload?.memberId === "string" ? payload.memberId : null,
    linqInviteId: record.kind === "linq_message_send" && typeof payload?.inviteId === "string" ? payload.inviteId : null,
    linqReplyToMessageId:
      record.kind === "linq_message_send" && typeof payload?.replyToMessageId === "string"
        ? payload.replyToMessageId
        : null,
    linqResultChatId:
      record.kind === "linq_message_send" && typeof result?.chatId === "string" ? result.chatId : null,
    linqResultMessageId:
      record.kind === "linq_message_send" && typeof result?.messageId === "string" ? result.messageId : null,
    linqTemplate: record.kind === "linq_message_send" && typeof payload?.template === "string" ? payload.template : null,
  };
}

function makeHostedLinqDailyState(input: {
  dayUtc?: Date;
  inboundCount?: number;
  onboardingLinkSentAt?: Date | null;
  outboundCount?: number;
  quotaReplySentAt?: Date | null;
} = {}) {
  return {
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    dayUtc: input.dayUtc ?? new Date("2026-03-26T00:00:00.000Z"),
    firstSeenAt: new Date("2026-03-26T12:00:00.000Z"),
    inboundCount: input.inboundCount ?? 1,
    lastSeenAt: new Date("2026-03-26T12:00:00.000Z"),
    memberId: "member_123",
    onboardingLinkSentAt: input.onboardingLinkSentAt ?? null,
    outboundCount: input.outboundCount ?? 0,
    quotaReplySentAt: input.quotaReplySentAt ?? null,
    updatedAt: new Date("2026-03-26T12:00:00.000Z"),
  };
}
