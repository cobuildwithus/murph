import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedAiUsageGateDecision,
} from "@/src/lib/hosted-execution/usage-allowance";
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
    hostedOnboardingEnvironment: {
      aiUsageBillingMode: "disabled",
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
      linqLocalAllowedInboundPhoneNumbers: undefined as readonly string[] | undefined,
      linqMaxActiveMembersPerConversationPhone: null,
      linqWebhookSecret: null,
      linqWebhookTimestampToleranceMs: 5 * 60_000,
      publicBaseUrl: "https://join.example.test",
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    },
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
    nudgeHostedRunnerUserBestEffortResult: vi.fn(async () => ({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    })),
    resolveHostedAiUsageGate: vi.fn(async (): Promise<HostedAiUsageGateDecision> => ({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      remainingUsdMicros: 100_000n,
      spentUsdMicros: 0n,
    })),
    sendHostedLinqChatMessage: vi.fn(),
    sendHostedLinqReadReceipt: vi.fn(),
    startHostedLinqTypingIndicator: vi.fn(),
    startHostedWebhookNudgeWorkflow: vi.fn(async () => ({
      runId: "workflow-run-123",
    })),
    startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
      baseDetails,
      startedAtMs: 0,
      step,
    })),
    readHostedLinqDailyState: vi.fn<() => Promise<HostedLinqDailyState | null>>(async () => null),
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
          id: `mailbox_${eventId}`,
        },
      };
    }),
  };

  return state;
});

function expectDirectLinqReadReceiptSent(chatId = "chat_123"): void {
  expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
    chatId,
    timeoutMs: 5000,
  });
}

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

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq-daily-state")>(
    "@/src/lib/hosted-onboarding/linq-daily-state",
  );

  return {
    ...actual,
    claimHostedLinqOnboardingLinkNotice: mocks.claimHostedLinqOnboardingLinkNotice,
    claimHostedLinqQuotaReplyNotice: mocks.claimHostedLinqQuotaReplyNotice,
    incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
    incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
    readHostedLinqDailyState: mocks.readHostedLinqDailyState,
    resolveHostedLinqDayUtc: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerBestEffort: vi.fn(async () => "wake"),
  nudgeHostedRunnerUserBestEffort: mocks.nudgeHostedRunnerUserBestEffort,
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-workflow-start", () => ({
  startHostedWebhookNudgeWorkflow: mocks.startHostedWebhookNudgeWorkflow,
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
    startHostedLinqTypingIndicator: mocks.startHostedLinqTypingIndicator,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => mocks.hostedOnboardingEnvironment,
    requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  };
});

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  hasHostedPrivyPhoneAuthConfig: vi.fn(() => false),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
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

type HostedMemberEmailAuthorizationFixture = {
  findUnique?: MockedFunction;
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
  hostedMemberEmailAuthorization?: HostedMemberEmailAuthorizationFixture;
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
    mocks.readHostedLinqDailyState.mockResolvedValue(null);
    mocks.hostedOnboardingEnvironment.linqLocalAllowedInboundPhoneNumbers = undefined;
    mocks.nudgeHostedRunnerUserBestEffort.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.resolveHostedAiUsageGate.mockResolvedValue({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      remainingUsdMicros: 100_000n,
      spentUsdMicros: 0n,
    });
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.startHostedLinqTypingIndicator.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.startHostedWebhookNudgeWorkflow.mockResolvedValue({
      runId: "workflow-run-123",
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
      expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
      expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
        context: "webhook:linq:direct",
        timeoutMs: 5000,
        userId: "member_123",
      });
      expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
      expect(response).not.toHaveProperty("wakeUserId");
      expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
      expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expectDirectLinqReadReceiptSent();
      expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
        memberId: "member_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
      });
      expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
        memberId: "member_123",
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
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq.wake-handoff",
        }),
        "runner-nudged",
        expect.objectContaining({
          directNudgeAttempted: true,
          directNudgeConfigured: true,
          directNudgeErrorCode: null,
        }),
      );
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.wake-handoff",
        expect.objectContaining({
          eventIdSuffix: "vt_123",
          responseReason: "wake-appended-active-member",
          userIdPresent: true,
          userIdSuffix: "er_123",
        }),
      );
    },
  );

  it("ignores non-allowlisted local Linq inbound messages before member lookup or wake handoff", async () => {
    mocks.hostedOnboardingEnvironment.linqLocalAllowedInboundPhoneNumbers = ["+15559999999"];
    const prisma = asPrismaTransactionClient({
      hostedMember: {
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberRouting: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
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
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_local_guard_blocked",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "local-inbound-not-allowlisted",
    });
    expect(prisma.hostedMemberIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("preserves all active-member Linq text parts when the inbound part count exceeds the old cap", async () => {
    const prisma = asPrismaTransactionClient({
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
        data: {
          parts: Array.from({ length: 33 }, (_, index) => ({
            type: "text",
            value: `part ${index}`,
          })),
        },
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const serializedEnvelope = JSON.stringify(envelope);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("part 32"),
            }),
          ]),
        }),
      }),
    }));
    expect(serializedEnvelope).toContain("part 0");
    expect(serializedEnvelope).not.toContain("LINQ_MESSAGE_PARTS_TOO_MANY");
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expectDirectLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
  });

  it("prioritizes active-member Linq text when attachment descriptors arrive first", async () => {
    const prisma = asPrismaTransactionClient({
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
        data: {
          parts: [
            ...Array.from({ length: 33 }, (_, index) => ({
              attachment_id: `att_${index}`,
              filename: `file-${index}.jpg`,
              mime_type: "image/jpeg",
              size: 1234,
              type: "media" as const,
              url: `https://cdn.linq.example.test/file-${index}.jpg`,
            })),
            {
              type: "text",
              value: "late user question after attachments",
            },
          ],
        },
        eventId: "evt_attachments_before_text",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const serializedEnvelope = JSON.stringify(envelope);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("late user question after attachments"),
            }),
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("1 attachment descriptor(s) omitted"),
            }),
          ]),
        }),
      }),
    }));
    expect(serializedEnvelope).not.toContain("file-32.jpg");
    expect(serializedEnvelope).not.toContain("cdn.linq.example.test");
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expectDirectLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
  });

  it("compacts active-member Linq messages with oversized content and still appends a wake", async () => {
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
        data: {
          parts: [
            {
              type: "text",
              value: "x".repeat((128 * 1024) + 1),
            },
          ],
        },
        eventId: "evt_oversized_parts",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(JSON.stringify(envelope).length).toBeLessThan(128 * 1024);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("[truncated]"),
            }),
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("some content truncated"),
            }),
          ]),
        }),
      }),
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expectDirectLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
  });

  it("preserves active-member Linq link content when truncation is required", async () => {
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
        data: {
          parts: [
            {
              type: "link",
              value: "https://example.test/linked-context",
            },
            {
              type: "text",
              value: "x".repeat((128 * 1024) + 1),
            },
            {
              attachment_id: "att_link_compaction",
              filename: "proof.jpg",
              mime_type: "image/jpeg",
              size: 1234,
              type: "media",
              url: "https://cdn.example.test/proof.jpg",
            },
          ],
        },
        eventId: "evt_link_compaction",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const serializedEnvelope = JSON.stringify(envelope);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("https://example.test/linked-context"),
            }),
          ]),
        }),
      }),
    }));
    expect(serializedEnvelope).toContain("some content truncated");
    expect(serializedEnvelope).not.toContain("cdn.example.test");
    expectDirectLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
  });

  it("omits signed Linq attachment URLs from active-member mailbox wakes", async () => {
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
        data: {
          parts: [
            {
              attachment_id: "att_voice_123",
              filename: "voice-note.m4a",
              mime_type: "audio/mp4",
              size: 12345,
              type: "voice_memo",
              url: "https://cdn.linqapp.com/files/signed-voice-url.m4a",
            },
          ],
        },
        eventId: "evt_attachment_url_omitted",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: [
            expect.objectContaining({
              attachmentId: "att_voice_123",
              fileName: "voice-note.m4a",
              mimeType: "audio/mp4",
              size: 12345,
              type: "voice_memo",
            }),
          ],
        }),
      }),
    }));
    expect(JSON.stringify(envelope)).not.toContain("signed-voice-url");
  });

  it("sends a Linq read receipt after active-member direct nudge without starting fallback workflow", async () => {
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
        eventId: "evt_required_nudge_failed",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 5000,
    });
    expect(mocks.startHostedLinqTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "runner-nudged",
      expect.objectContaining({
        directNudgeAttempted: true,
        directNudgeConfigured: true,
      }),
    );
  });

  it("keeps webhook success independent when the Linq handoff workflow cannot start", async () => {
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: false,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.startHostedWebhookNudgeWorkflow.mockRejectedValueOnce(new Error("workflow unavailable"));
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
        eventId: "evt_ingress_read_receipt_skipped",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_evt_ingress_read_receipt_skipped",
      source: "linq",
    });
    expect(mocks.startHostedLinqTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
      }),
    );
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
    expect(transactionHostedMemberFindUnique).toHaveBeenCalledTimes(1);
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
    expectDirectLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
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
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimHostedLinqOnboardingLinkNotice.mock.invocationCallOrder[0],
    );
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("stores iMessage email handles as pending Linq contact claims instead of verified emails", async () => {
    const invite = {
      channel: "linq",
      id: "invite_email_handle",
      inviteCode: "code_email_handle",
      memberId: "member_email",
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
          id: "invite_email_handle",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_email",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberEmailAuthorization: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
          ...create,
          ...update,
        })),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
          ...create,
          ...update,
        })),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sender_handle: {
            handle: "Buddy@iCloud.com",
            id: "handle_sender_email",
            service: "iMessage",
          },
        },
        eventId: "evt_email_handle",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_email_handle",
      joinUrl: "https://join.example.test/join/code_email_handle",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMemberEmailAuthorization.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMemberIdentity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          phoneLookupKey: null,
          phoneNumberEncrypted: null,
        }),
      }),
    );
    expect(prismaMocks.hostedMemberRouting.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          pendingLinqParticipantContactKind: "email",
          pendingLinqParticipantContactLookupKey: expect.stringMatching(/^hbidx:email:v1:/u),
        }),
        update: expect.objectContaining({
          pendingLinqParticipantContactKind: "email",
          pendingLinqParticipantContactLookupKey: expect.stringMatching(/^hbidx:email:v1:/u),
        }),
      }),
    );
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_email_handle",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("sends first-contact signup links even when inbound Linq parts exceed mailbox limits", async () => {
    const invite = {
      channel: "linq",
      id: "invite_many_parts",
      inviteCode: "code_many_parts",
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
          id: "invite_many_parts",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn(),
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

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: Array.from({ length: 33 }, (_, index) => ({
            type: "text",
            value: `part ${index}`,
          })),
        },
        eventId: "evt_first_contact_many_parts",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_many_parts",
      joinUrl: "https://join.example.test/join/code_many_parts",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_many_parts",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_many_parts",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
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

  it("keeps first-contact signup replies inline", async () => {
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

    const response = await handleHostedOnboardingLinqWebhook({
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

    await expect(handleHostedOnboardingLinqWebhook({
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
            linqChatIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-chat-id",
              memberId: "member_123",
              value: "chat_home",
            }),
            linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
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
          linqChatIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-chat-id",
            memberId: "member_123",
            value: "chat_home",
          }),
          linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
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

  it("sends a deterministic Linq quota reply instead of nudging the runner when the usage gate denies an active member", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 100_000n,
      userNotice: {
        code: "pulse_upgrade_edge",
        message:
          "Hey, you've reached your usage limit for the month. Open https://withmurph.ai/home to upgrade to Edge.",
      },
    });
    const prisma = asPrismaTransactionClient({
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_ai_usage_limit",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimHostedLinqQuotaReplyNotice.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        idempotencyKey: "linq-message:evt_ai_usage_limit",
        message:
          "Hey, you've reached your usage limit for the month. Open https://withmurph.ai/home to upgrade to Edge.",
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("suppresses repeat Linq AI usage quota replies after the daily quota notice is already marked", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      quotaReplySentAt: new Date("2026-03-26T12:01:00.000Z"),
    }));
    mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 100_000n,
      userNotice: {
        code: "pulse_upgrade_edge",
        message:
          "Hey, you've reached your usage limit for the month. Open https://withmurph.ai/home to upgrade to Edge.",
      },
    });
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
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_ai_usage_limit_repeat",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "ai-usage-quota-reached",
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("sends non-home-line redirects even when inbound Linq parts exceed mailbox limits", async () => {
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
            linqChatIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-chat-id",
              memberId: "member_123",
              value: "chat_home",
            }),
            linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
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
          linqChatIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-chat-id",
            memberId: "member_123",
            value: "chat_home",
          }),
          linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
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

    await expect(handleHostedOnboardingLinqWebhook({
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
          parts: Array.from({ length: 33 }, (_, index) => ({
            type: "text",
            value: `part ${index}`,
          })),
        },
        eventId: "evt_redirect_many_parts",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "redirected-to-home-line",
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_other",
        message: buildHostedLinqConversationHomeRedirectReply({
          homeRecipientPhone: "+15550100001",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
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
            linqChatIdEncrypted: await encryptHostedWebNullableString({
              field: "hosted-member-routing.home-linq-chat-id",
              memberId: "member_123",
              value: "chat_home",
            }),
            linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
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
          linqChatIdEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-chat-id",
            memberId: "member_123",
            value: "chat_home",
          }),
          linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
            field: "hosted-member-routing.home-linq-recipient-phone",
            memberId: "member_123",
            value: "+15550100001",
          }),
          memberId: "member_123",
        }),
        upsert: vi.fn(),
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
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 1,
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
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("sends signup links before marking the one-shot notice sent", async () => {
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValueOnce(false);
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(null);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState());
    const hostedInviteCreate = vi.fn().mockResolvedValue({
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_first_text",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    });
    const prisma = asPrismaTransactionClient({
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
        create: hostedInviteCreate,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            inviteCode: "code_first_text",
          }),
        update: vi.fn().mockResolvedValue({}),
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
        eventId: "evt_signup_mark_after_send",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });
    expect(hostedInviteCreate).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimHostedLinqOnboardingLinkNotice.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("sends one daily quota reply after the 150th active-member inbound message", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 151,
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
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimHostedLinqQuotaReplyNotice.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: "You have reached Murph's daily text limit of 150 messages. Try again tomorrow.",
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
  });

  it("uses the sent quota marker, not a pre-send claim, to suppress repeat quota replies", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 151,
      quotaReplySentAt: new Date("2026-03-26T12:01:00.000Z"),
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
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("does not mark the daily quota notice sent when the inline active-member quota reply fails", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 151,
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

    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
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
} = {}): HostedLinqDailyState {
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
