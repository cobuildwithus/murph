import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHostedAiUsageMonthlyAllowanceUsdMicros } from "@/src/lib/hosted-onboarding/billing-plans";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";

const MEMBER_ID = "member_usage_reset";
const CHAT_ID = "chat_usage_reset";
const OWNER_PHONE = "+14155550100";
const SENDER_PHONE = "+14155550101";

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
      tx?: unknown;
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
    getHostedLinqChatSummary: vi.fn(),
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
    hasActiveHostedCryptoDomainRootsForUserTx: vi.fn(),
    lockAndReadActiveHostedDomainRootKeyIdTx: vi.fn(),
    lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
    lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
    lookupHostedMemberRoutingByPendingLinqParticipantContact: vi.fn(),
    projectHostedMemberRoutingState: vi.fn(),
    readHostedMailboxItemByDedupeKey: vi.fn(async () => null),
    readHostedMailboxItemOwnerById: vi.fn(async (input: { mailboxItemId: string }) => ({
      id: input.mailboxItemId,
      userId: "member_usage_reset",
    })),
    readHostedMemberHomeLinqRoute: vi.fn(),
    readHostedMemberRoutingRecord: vi.fn(),
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
    unwrapHostedDomainRootForWeb: vi.fn(),
  };

  return state;
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    hasActiveHostedCryptoDomainRootsForUserTx:
      mocks.hasActiveHostedCryptoDomainRootsForUserTx,
    lockAndReadActiveHostedDomainRootKeyIdTx:
      mocks.lockAndReadActiveHostedDomainRootKeyIdTx,
    unwrapHostedDomainRootForWeb: mocks.unwrapHostedDomainRootForWeb,
  };
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
    appendHostedMailboxEnvelopeWithSourceMessageTx: (
      input: Parameters<typeof actual.appendHostedMailboxEnvelopeWithSourceMessageTx>[0],
    ) =>
      mocks.appendHostedMailboxEnvelopeTx({
        envelope: input.envelope,
        tx: input.tx,
      }),
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
    projectHostedMemberRoutingState: mocks.projectHostedMemberRoutingState,
    readHostedMemberHomeLinqRoute: mocks.readHostedMemberHomeLinqRoute,
    readHostedMemberRoutingRecord: mocks.readHostedMemberRoutingRecord,
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

vi.mock("@/src/lib/hosted-onboarding/linq-client", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq-client")>(
    "@/src/lib/hosted-onboarding/linq-client",
  );

  return {
    ...actual,
    getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
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
  };
  hostedAccountGroupMembership: {
    count: MockedFunction;
    findFirst: MockedFunction;
  };
  hostedGroupMember: {
    findMany: MockedFunction;
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
    findMany: MockedFunction;
  };
  hostedMember: {
    findUnique: MockedFunction;
  };
  hostedMemberRouting: {
    findMany: MockedFunction;
    findUnique: MockedFunction;
    updateMany: MockedFunction;
  };
  hostedThreadRoute: {
    findFirst: MockedFunction;
    findMany: MockedFunction;
    groupBy: MockedFunction;
    updateMany: MockedFunction;
  };
};

describe("hosted Linq usage reset e2e", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    vi.clearAllMocks();

    mocks.getHostedLinqChatSummary.mockResolvedValue({
      handles: [],
      isGroup: false,
    });

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
    mocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValue(true);
    mocks.lockAndReadActiveHostedDomainRootKeyIdTx.mockResolvedValue(
      "root_usage_reset",
    );
    mocks.unwrapHostedDomainRootForWeb.mockImplementation(async (input: {
      domain: HostedCryptoDomain;
      userId: string;
    }) => {
      const envelope: HostedDomainRootKeyEnvelopeV1 = {
        authoritySignature: {
          alg: "GCP-KMS-EC-P256-SHA256",
          keyVersionName: "test-authority-key",
          signature: "test-signature",
          signedAt: "2026-04-30T00:00:00.000Z",
        },
        createdAt: "2026-04-30T00:00:00.000Z",
        domain: input.domain,
        generation: 1,
        rootKeyId: "root_usage_reset",
        schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
        updatedAt: "2026-04-30T00:00:00.000Z",
        userId: input.userId,
        wraps: [],
      };
      const cachedRoot = Promise.resolve({
        envelope,
        rootKey: new Uint8Array(32).fill(7),
      });
      const cache = getHostedDomainRootUnwrapCache();
      cache?.set(`${input.userId}|${input.domain}|@active`, cachedRoot);
      cache?.set(
        `${input.userId}|${input.domain}|${envelope.rootKeyId}`,
        cachedRoot,
      );
      return {
        envelope,
        rootKey: new Uint8Array(32).fill(7),
      };
    });
    mocks.lookupHostedMemberRoutingByPendingLinqParticipantContact.mockResolvedValue(null);
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: CHAT_ID,
      linqRecipientPhone: OWNER_PHONE,
      memberId: MEMBER_ID,
    });
    mocks.readHostedMemberRoutingRecord.mockResolvedValue({
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
    mocks.projectHostedMemberRoutingState.mockImplementation(() =>
      mocks.readHostedMemberRoutingState()
    );
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValue(makeHostedLinqDailyState());
    mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(makeHostedLinqDailyState({
      outboundCount: 1,
    }));
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

  it("preserves exhausted-period messages and later appends fresh-period messages", async () => {
    const monthlyLimit = getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly");
    const usage = createUsageResetPrismaFixture({
      initialPeriod: {
        limitUsdMicros: monthlyLimit,
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        spentUsdMicros: monthlyLimit,
      },
    });

    const exhaustedResponse = await handleHostedOnboardingLinqWebhook({
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

    expect(exhaustedResponse).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenLastCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_before_reset",
        kind: "conversation.message",
        message: expect.objectContaining({
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: CHAT_ID,
            messageId: "msg_before_reset",
            parts: [
              {
                type: "text",
                value: "Can you answer before the reset?",
              },
            ],
            threadIsDirect: true,
          }),
        }),
        userId: MEMBER_ID,
      }),
      tx: usage.prisma,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: MEMBER_ID,
      mailboxItemId: "mailbox_evt_before_reset",
    });
    expectHostedLinqReadReceiptSent();
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      timeoutMs: 1_500,
    });
    expect(usage.getPeriod("2026-04-01T00:00:00.000Z")).toMatchObject({
      spentUsdMicros: monthlyLimit,
    });

    vi.clearAllMocks();
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_usage_reset",
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
    // Period bookkeeping is owned by the mutating turn-admission gate (runtime
    // reconciliation facts), which runs before any AI spend can land. Linq
    // ingress only preserves the user-authored input as mailbox work.
    expect(usage.periods.has("2026-05-01T00:00:00.000Z")).toBe(false);
    expect(usage.ensuredPeriodStarts).toEqual([]);
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
            threadIsDirect: true,
          }),
        }),
        userId: MEMBER_ID,
      }),
      tx: usage.prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: MEMBER_ID,
      mailboxItemId: "mailbox_evt_after_reset",
    });
    expectHostedLinqReadReceiptSent();
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      timeoutMs: 1_500,
    });
  });
});

async function handleHostedOnboardingLinqWebhook(input: HostedOnboardingLinqWebhookTestInput) {
  return handleHostedOnboardingLinqWebhookImpl(input as HostedOnboardingLinqWebhookInput);
}

function createUsageResetPrismaFixture(input: {
  initialPeriod: {
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
    $queryRaw: vi.fn(async (
      query: readonly string[] | { strings?: readonly string[] },
      ...values: unknown[]
    ) => {
      const taggedTemplate = Array.isArray(query);
      const strings = taggedTemplate
        ? query as readonly string[]
        : (query as { strings?: readonly string[] }).strings ?? [];
      return strings.join(" ").toLowerCase().includes("for update skip locked")
        ? [{ id: values[0] }]
        : [];
    }),
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
    },
    hostedAccountGroupMembership: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
    },
    hostedGroupMember: {
      findMany: vi.fn(async () => []),
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
      findMany: vi.fn().mockResolvedValue([]),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        ...activeMember,
        accountGroupMemberships: [],
        billingRef: null,
        consentGrants: [],
        threadContainer: null,
      })),
    },
    hostedMemberRouting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedThreadRoute: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
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
