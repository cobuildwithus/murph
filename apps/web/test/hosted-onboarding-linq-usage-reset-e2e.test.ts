import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildHostedAiUsageGateNoticeIdempotencyKey } from "@/src/lib/hosted-execution/usage-allowance";
import { renderUserFacingMessage } from "@/src/lib/hosted-messages/user-facing-messages";
import { getHostedAiUsageMonthlyAllowanceUsdMicros } from "@/src/lib/hosted-onboarding/billing-plans";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";

const MEMBER_ID = "member_usage_reset";
const CHAT_ID = "chat_usage_reset";
const OWNER_PHONE = "+14155550100";
const SENDER_PHONE = "+14155550101";
const HOME_URL = "https://withmurph.ai/home";

function buildPulseUpgradeEdgeMessage(input: {
  memberId: string;
  periodStart: Date;
}): string {
  return renderUserFacingMessage({
    context: {
      homeUrl: HOME_URL,
    },
    key: "linq.ai_usage.pulse_upgrade_edge",
    seed: `linq.ai_usage:${input.memberId}:pulse_upgrade_edge:${input.periodStart.toISOString()}`,
  }).text;
}

const activeMember = {
  billingStatus: HostedBillingStatus.active,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  id: MEMBER_ID,
  suspendedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const mocks = vi.hoisted(() => {
  const state = {
    appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
      envelope?: { eventId: string };
      eventId?: string;
    }) => {
      const eventId = input.eventId ?? input.envelope?.eventId;
      if (!eventId) {
        throw new Error("Expected hosted mailbox eventId.");
      }

      return {
        item: {
          dedupeKey: eventId,
          id: `mailbox_${eventId}`,
        },
      };
    }),
    deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
    finishHostedOnboardingTiming: vi.fn(),
    hostedOnboardingEnvironment: {
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
      linqApiToken: "<REDACTED_SECRET>",
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
      stripeSecretKey: "<REDACTED_SECRET>",
      stripeWebhookSecret: "<REDACTED_SECRET>",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    },
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
    lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
    lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
    lookupHostedMemberRoutingByPendingLinqParticipantContact: vi.fn(),
    nudgeHostedRunnerUserBestEffortResult: vi.fn(async (
      input?: {
        context?: string;
        timeoutMs?: number;
        userId: string;
      },
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
    readHostedMailboxItemByDedupeKey: vi.fn(async () => null),
    readHostedMailboxItemOwnerById: vi.fn(async (input: { mailboxItemId: string }) => ({
      id: input.mailboxItemId,
      userId: "member_usage_reset",
    })),
    readHostedMemberHomeLinqRoute: vi.fn(),
    readHostedMemberRoutingState: vi.fn(),
    sendHostedLinqChatMessage: vi.fn(),
    sendHostedLinqReadReceipt: vi.fn(),
    startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
      baseDetails,
      startedAtMs: 0,
      step,
    })),
    signalHostedMailboxAppendRuntime: vi.fn(async () => ({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_usage_reset",
    })),
    upsertHostedMemberHomeLinqBindingTx: vi.fn(async () => undefined),
  };

  return state;
});

function expectHostedLinqReadReceiptSent(chatId = CHAT_ID): void {
  expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
    chatId,
    signal: undefined,
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
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/hosted-member-identity-store")>(
    "@/src/lib/hosted-onboarding/hosted-member-identity-store",
  );

  return {
    ...actual,
    lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/hosted-member-routing-store")>(
    "@/src/lib/hosted-onboarding/hosted-member-routing-store",
  );

  return {
    ...actual,
    lookupHostedMemberRoutingByPendingLinqParticipantContact:
      mocks.lookupHostedMemberRoutingByPendingLinqParticipantContact,
    readHostedMemberHomeLinqRoute: mocks.readHostedMemberHomeLinqRoute,
    readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
    upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/hosted-member-store")>(
    "@/src/lib/hosted-onboarding/hosted-member-store",
  );

  return {
    ...actual,
    lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq-daily-state")>(
    "@/src/lib/hosted-onboarding/linq-daily-state",
  );

  return {
    ...actual,
    incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
    incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerBestEffort: vi.fn(async () => "wake"),
  nudgeHostedRunnerUserBestEffort: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("../src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/linq")>(
    "../src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    assertHostedLinqWebhookSignature: vi.fn(),
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
    // This regression isolates usage reset behavior; Linq HMAC verification is
    // covered by dedicated webhook-auth tests.
    verifyAndParseHostedLinqWebhookRequest: vi.fn((input: { rawBody: string }) =>
      actual.parseHostedLinqWebhookEvent(input.rawBody),
    ),
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

vi.mock("@/src/lib/hosted-onboarding/webhook-service-stripe", () => ({
  handleHostedStripeWebhook: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-linq-usage-reset-e2e.test.ts");
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

type HostedOnboardingLinqWebhookInput = Parameters<typeof handleHostedOnboardingLinqWebhookImpl>[0];
type HostedOnboardingLinqWebhookTestInput = Omit<HostedOnboardingLinqWebhookInput, "prisma"> & {
  prisma?: UsageResetPrismaFixture;
};
type MockedFunction = ReturnType<typeof vi.fn>;

type UsagePeriodRecord = {
  billingPlanCode: "launch_monthly" | "launch_edge_monthly";
  blockedAt: Date | null;
  lastUsageAt: Date | null;
  limitNoticeSentAt: Date | null;
  limitUsdMicros: bigint;
  memberId: string;
  periodEnd: Date;
  periodStart: Date;
  spentUsdMicros: bigint;
  updatedAt: Date | null;
};

type UsagePeriodSelect = Partial<Record<keyof UsagePeriodRecord, boolean>>;

type UsageLedgerRecord = {
  allowanceAccountedAt: Date | null;
  allowanceCostUsdMicros: bigint;
  allowanceCounted: boolean;
  memberId: string;
  occurredAt: Date;
};

type UsageResetPrismaFixture = {
  $executeRaw: MockedFunction;
  $queryRaw: MockedFunction;
  $transaction: MockedFunction;
  hostedAiUsage: {
    aggregate: MockedFunction;
    updateMany: MockedFunction;
  };
  hostedAiUsagePeriod: {
    createMany: MockedFunction;
    delete: MockedFunction;
    findUnique: MockedFunction;
    findUniqueOrThrow: MockedFunction;
    update: MockedFunction;
    updateMany: MockedFunction;
  };
  hostedAccountGroupMembership: {
    count: MockedFunction;
    findFirst: MockedFunction;
  };
  hostedLinqAlert: {
    createMany: MockedFunction;
  };
  hostedLinqDelivery: {
    create: MockedFunction;
    findFirst: MockedFunction;
    findMany: MockedFunction;
    findUnique: MockedFunction;
    update: MockedFunction;
    updateMany: MockedFunction;
    upsert: MockedFunction;
  };
  hostedLinqLine: {
    findMany: MockedFunction;
    findUnique: MockedFunction;
    update: MockedFunction;
    upsert: MockedFunction;
  };
  hostedLinqProviderEvent: {
    createMany: MockedFunction;
  };
  hostedMember: {
    findUnique: MockedFunction;
  };
  hostedMemberRouting: {
    findMany: MockedFunction;
    updateMany: MockedFunction;
  };
  hostedThreadRoute: {
    findMany: MockedFunction;
    updateMany: MockedFunction;
  };
};

describe("hosted Linq usage reset e2e", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    vi.clearAllMocks();

    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: activeMember,
      identity: {
        maskedPhoneNumberHint: null,
        memberId: MEMBER_ID,
        phoneNumber: SENDER_PHONE,
        phoneNumberVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      matchedBy: "phoneNumber",
    });
    mocks.lookupHostedMemberRoutingByPendingLinqParticipantContact.mockResolvedValue(null);
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: CHAT_ID,
      linqRecipientPhone: OWNER_PHONE,
      memberId: MEMBER_ID,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: CHAT_ID,
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: OWNER_PHONE,
      memberId: MEMBER_ID,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValue(makeHostedLinqDailyState());
    mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(makeHostedLinqDailyState({
      outboundCount: 1,
    }));
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: CHAT_ID,
      messageId: "provider_msg_usage_reset",
    });
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_usage_reset",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("blocks an exhausted monthly period, then resumes message wakes after the reset creates a fresh period", async () => {
    const monthlyLimit = getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly");
    const usage = createUsageResetPrismaFixture({
      initialPeriod: {
        limitUsdMicros: monthlyLimit,
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        spentUsdMicros: monthlyLimit,
      },
    });

    const deniedResponse = await handleHostedOnboardingLinqWebhook({
      prisma: usage.prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-04-30T12:00:00.000Z",
        data: {
          id: "msg_before_reset",
          parts: [
            {
              type: "text",
              value: "Can you answer before the reset?",
            },
          ],
          sent_at: "2026-04-30T12:00:00.000Z",
        },
        eventId: "evt_before_reset",
      }),
      signature: null,
      timestamp: null,
    });

    expect(deniedResponse).toMatchObject({
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    });
    const expectedUsageLimitIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: MEMBER_ID,
      noticeCode: "pulse_upgrade_edge",
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      idempotencyKey: expectedUsageLimitIdempotencyKey,
      message: buildPulseUpgradeEdgeMessage({
        memberId: MEMBER_ID,
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
      }),
      replyToMessageId: "msg_before_reset",
      signal: undefined,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(usage.getPeriod("2026-04-01T00:00:00.000Z")).toMatchObject({
      limitNoticeSentAt: new Date("2026-04-30T12:00:00.000Z"),
      spentUsdMicros: monthlyLimit,
    });

    vi.setSystemTime(new Date("2026-05-01T00:01:00.000Z"));

    const resumedResponse = await handleHostedOnboardingLinqWebhook({
      prisma: usage.prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-05-01T00:01:00.000Z",
        data: {
          id: "msg_after_reset",
          parts: [
            {
              type: "text",
              value: "Can you answer after the reset?",
            },
          ],
          sent_at: "2026-05-01T00:01:00.000Z",
        },
        eventId: "evt_after_reset",
      }),
      signature: null,
      timestamp: null,
    });

    expect(resumedResponse).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    // The webhook gate is read-first: the fresh-month allow decision is served
    // without creating the May period row. Period bookkeeping is owned by the
    // mutating turn-admission gate (runtime reconciliation facts), which runs
    // before any AI spend can land. The only webhook-driven period ensure is
    // the April escalation that confirmed the exhausted-period denial.
    expect(usage.periods.has("2026-05-01T00:00:00.000Z")).toBe(false);
    expect(usage.ensuredPeriodStarts).toEqual([
      "2026-04-01T00:00:00.000Z",
    ]);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_after_reset",
        kind: "conversation.message",
        message: expect.objectContaining({
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: CHAT_ID,
            messageId: "msg_after_reset",
            parts: [
              {
                type: "text",
                value: "Can you answer after the reset?",
              },
            ],
          }),
        }),
        userId: MEMBER_ID,
      }),
      tx: usage.prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: MEMBER_ID,
      mailboxItemId: "mailbox_evt_after_reset",
    });
    expectHostedLinqReadReceiptSent();
  });

  it("suppresses the usage-limit reply when the exhausted period notice was already claimed", async () => {
    const monthlyLimit = getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly");
    const alreadyClaimedAt = new Date("2026-04-29T16:30:00.000Z");
    const usage = createUsageResetPrismaFixture({
      initialPeriod: {
        limitNoticeSentAt: alreadyClaimedAt,
        limitUsdMicros: monthlyLimit,
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        spentUsdMicros: monthlyLimit,
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: usage.prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-04-30T12:00:00.000Z",
        data: {
          id: "msg_after_notice_claimed",
          parts: [
            {
              type: "text",
              value: "Are you there?",
            },
          ],
          sent_at: "2026-04-30T12:00:00.000Z",
        },
        eventId: "evt_after_notice_claimed",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "ai-usage-gate-denied",
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(usage.prisma.hostedAiUsagePeriod.updateMany).toHaveBeenCalledTimes(1);
    expect(usage.getPeriod("2026-04-01T00:00:00.000Z")).toMatchObject({
      limitNoticeSentAt: alreadyClaimedAt,
      spentUsdMicros: monthlyLimit,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });
});

async function handleHostedOnboardingLinqWebhook(input: HostedOnboardingLinqWebhookTestInput) {
  return handleHostedOnboardingLinqWebhookImpl(input as HostedOnboardingLinqWebhookInput);
}

function createUsageResetPrismaFixture(input: {
  initialPeriod: {
    limitNoticeSentAt?: Date | null;
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    spentUsdMicros: bigint;
  };
}) {
  const periods = new Map<string, UsagePeriodRecord>();
  const ensuredPeriodStarts: string[] = [];
  const initial = buildUsagePeriodRecord(input.initialPeriod);
  const ledgerUsage: UsageLedgerRecord[] = initial.spentUsdMicros > 0n
    ? [
        {
          allowanceAccountedAt: new Date(initial.periodStart.getTime() + 60_000),
          allowanceCostUsdMicros: initial.spentUsdMicros,
          allowanceCounted: true,
          memberId: initial.memberId,
          occurredAt: new Date(initial.periodStart.getTime() + 60_000),
        },
      ]
    : [];
  periods.set(periodKey(initial.periodStart), initial);

  const prisma: UsageResetPrismaFixture = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (run: (tx: UsageResetPrismaFixture) => Promise<unknown>) => run(prisma)),
    hostedAiUsage: {
      aggregate: vi.fn(async (aggregateInput: {
        where?: {
          allowanceAccountedAt?: { not: null };
          allowanceCounted?: boolean;
          memberId?: string;
          occurredAt?: {
            gte?: Date;
            lt?: Date;
          };
        };
      }) => {
        const where = aggregateInput.where ?? {};
        const rows = ledgerUsage.filter((row) => {
          if (where.memberId && row.memberId !== where.memberId) {
            return false;
          }
          if (where.allowanceCounted === true && !row.allowanceCounted) {
            return false;
          }
          if (where.allowanceAccountedAt?.not === null && row.allowanceAccountedAt === null) {
            return false;
          }
          if (where.occurredAt?.gte && row.occurredAt.getTime() < where.occurredAt.gte.getTime()) {
            return false;
          }
          if (where.occurredAt?.lt && row.occurredAt.getTime() >= where.occurredAt.lt.getTime()) {
            return false;
          }

          return true;
        });
        const spentUsdMicros = rows.reduce(
          (total, row) => total + row.allowanceCostUsdMicros,
          0n,
        );
        const lastUsageAt = rows
          .map((row) => row.occurredAt)
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

        return {
          _max: {
            occurredAt: lastUsageAt,
          },
          _sum: {
            allowanceCostUsdMicros: spentUsdMicros > 0n ? spentUsdMicros : null,
          },
        };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    hostedAiUsagePeriod: {
      createMany: vi.fn(async (periodInput: {
        data: {
          billingPlanCode: "launch_monthly" | "launch_edge_monthly";
          limitUsdMicros: bigint;
          memberId: string;
          periodEnd: Date;
          periodStart: Date;
          spentUsdMicros: bigint;
        };
        skipDuplicates: true;
      }) => {
        const key = periodKey(periodInput.data.periodStart);
        ensuredPeriodStarts.push(key);
        if (!periods.has(key)) {
          periods.set(key, buildUsagePeriodRecord(periodInput.data));
        }
        return { count: 1 };
      }),
      delete: vi.fn(async (periodInput: { where: UsagePeriodWhere }) => {
        periods.delete(periodKey(periodInput.where.memberId_periodStart.periodStart));
        return {};
      }),
      findUnique: vi.fn(async (periodInput: { select?: UsagePeriodSelect; where: UsagePeriodWhere }) => {
        const period = periods.get(periodKey(periodInput.where.memberId_periodStart.periodStart));
        return period ? selectUsagePeriod(period, periodInput.select) : null;
      }),
      findUniqueOrThrow: vi.fn(async (periodInput: { select?: UsagePeriodSelect; where: UsagePeriodWhere }) => {
        const period = periods.get(periodKey(periodInput.where.memberId_periodStart.periodStart));
        if (!period) {
          throw new Error("Expected usage period to exist.");
        }

        return selectUsagePeriod(period, periodInput.select);
      }),
      update: vi.fn(async (periodInput: {
        data: Partial<UsagePeriodRecord>;
        select?: UsagePeriodSelect;
        where: UsagePeriodWhere;
      }) => {
        const key = periodKey(periodInput.where.memberId_periodStart.periodStart);
        const period = periods.get(key);
        if (!period) {
          throw new Error("Expected usage period to exist before update.");
        }

        const updated = {
          ...period,
          ...periodInput.data,
        };
        periods.set(key, updated);
        return selectUsagePeriod(updated, periodInput.select);
      }),
      updateMany: vi.fn(async (periodInput: {
        data: {
          limitNoticeSentAt?: Date;
        };
        where: {
          limitNoticeSentAt?: null;
          memberId: string;
          periodStart: Date;
        };
      }) => {
        const period = periods.get(periodKey(periodInput.where.periodStart));
        if (
          !period ||
          period.memberId !== periodInput.where.memberId ||
          period.limitNoticeSentAt !== null
        ) {
          return { count: 0 };
        }

        period.limitNoticeSentAt = periodInput.data.limitNoticeSentAt ?? null;
        periods.set(periodKey(period.periodStart), period);
        return { count: 1 };
      }),
    },
    hostedAccountGroupMembership: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
    },
    hostedLinqAlert: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedLinqDelivery: {
      create: vi.fn().mockResolvedValue({ id: "hld_random" }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: "hld_123" }),
    },
    hostedLinqLine: {
      findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } }) => {
        const lookupKeys = new Set(query.where?.phoneNumberLookupKey?.in ?? []);
        if (
          !createHostedPhoneLookupKeyReadCandidates(OWNER_PHONE).some((lookupKey) =>
            lookupKeys.has(lookupKey)
          )
        ) {
          return [];
        }
        return [{
          activeMemberLimit: null,
          assignmentWeight: 1,
          maxNewConversationsPerDay: null,
          phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(OWNER_PHONE),
          phoneNumberHint: "*** 0100",
          phoneNumberLookupKey: createHostedPhoneLookupKey(OWNER_PHONE),
        }];
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((input: { where?: { phoneNumberLookupKey?: string } }) =>
        Promise.resolve({
          phoneNumberLookupKey: input.where?.phoneNumberLookupKey ?? "hbidx:phone:updated",
        })),
      upsert: vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) =>
        Promise.resolve({
          phoneNumberLookupKey: input.create.phoneNumberLookupKey,
        })),
    },
    hostedLinqProviderEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        ...activeMember,
        billingRef: null,
        threadContainer: null,
      })),
    },
    hostedMemberRouting: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedThreadRoute: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  return {
    getPeriod(periodStart: string): UsagePeriodRecord {
      const period = periods.get(periodStart);
      if (!period) {
        throw new Error(`Expected usage period ${periodStart}.`);
      }

      return period;
    },
    periods,
    prisma,
    ensuredPeriodStarts,
  };
}

type UsagePeriodWhere = {
  memberId_periodStart: {
    memberId: string;
    periodStart: Date;
  };
};

function buildUsagePeriodRecord(input: {
  billingPlanCode?: "launch_monthly" | "launch_edge_monthly";
  limitNoticeSentAt?: Date | null;
  limitUsdMicros: bigint;
  memberId?: string;
  periodEnd: Date;
  periodStart: Date;
  spentUsdMicros: bigint;
}): UsagePeriodRecord {
  return {
    billingPlanCode: input.billingPlanCode ?? "launch_monthly",
    blockedAt: input.spentUsdMicros >= input.limitUsdMicros
      ? new Date(input.periodEnd.getTime() - 60_000)
      : null,
    lastUsageAt: input.spentUsdMicros > 0n
      ? new Date(input.periodStart.getTime() + 60_000)
      : null,
    limitNoticeSentAt: input.limitNoticeSentAt ?? null,
    limitUsdMicros: input.limitUsdMicros,
    memberId: input.memberId ?? MEMBER_ID,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
    spentUsdMicros: input.spentUsdMicros,
    updatedAt: null,
  };
}

function selectUsagePeriod(
  period: UsagePeriodRecord,
  select: UsagePeriodSelect | undefined,
): Partial<UsagePeriodRecord> | UsagePeriodRecord {
  if (!select) {
    return period;
  }

  const selected: Partial<UsagePeriodRecord> = {};
  if (select.billingPlanCode) {
    selected.billingPlanCode = period.billingPlanCode;
  }
  if (select.blockedAt) {
    selected.blockedAt = period.blockedAt;
  }
  if (select.limitNoticeSentAt) {
    selected.limitNoticeSentAt = period.limitNoticeSentAt;
  }
  if (select.lastUsageAt) {
    selected.lastUsageAt = period.lastUsageAt;
  }
  if (select.limitUsdMicros) {
    selected.limitUsdMicros = period.limitUsdMicros;
  }
  if (select.memberId) {
    selected.memberId = period.memberId;
  }
  if (select.periodEnd) {
    selected.periodEnd = period.periodEnd;
  }
  if (select.periodStart) {
    selected.periodStart = period.periodStart;
  }
  if (select.spentUsdMicros) {
    selected.spentUsdMicros = period.spentUsdMicros;
  }
  if (select.updatedAt) {
    selected.updatedAt = period.updatedAt;
  }

  return selected;
}

function periodKey(value: Date): string {
  return value.toISOString();
}

function buildHostedLinqWebhookBody(input: {
  createdAt: string;
  data: {
    id: string;
    parts: Array<{
      type: "text";
      value: string;
    }>;
    sent_at: string;
  };
  eventId: string;
}): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: input.createdAt,
    data: {
      chat: {
        id: CHAT_ID,
        owner_handle: {
          handle: OWNER_PHONE,
          id: "handle_owner_usage_reset",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      sender_handle: {
        handle: SENDER_PHONE,
        id: "handle_sender_usage_reset",
        service: "sms",
      },
      service: "sms",
      ...input.data,
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });
}

function makeHostedLinqDailyState(input: {
  dayUtc?: Date;
  inboundCount?: number;
  onboardingLinkSentAt?: Date | null;
  outboundCount?: number;
  quotaReplySentAt?: Date | null;
} = {}): HostedLinqDailyState {
  return {
    createdAt: new Date("2026-04-30T12:00:00.000Z"),
    dayUtc: input.dayUtc ?? new Date("2026-04-30T00:00:00.000Z"),
    firstSeenAt: new Date("2026-04-30T12:00:00.000Z"),
    inboundCount: input.inboundCount ?? 1,
    lastSeenAt: new Date("2026-04-30T12:00:00.000Z"),
    memberId: MEMBER_ID,
    onboardingLinkSentAt: input.onboardingLinkSentAt ?? null,
    outboundCount: input.outboundCount ?? 0,
    quotaReplySentAt: input.quotaReplySentAt ?? null,
    updatedAt: new Date("2026-04-30T12:00:00.000Z"),
  };
}
