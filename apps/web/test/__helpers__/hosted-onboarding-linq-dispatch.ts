import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import { expect, vi } from "vitest";

import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  type HostedAiUsageGateDecision,
} from "@/src/lib/hosted-execution/usage-allowance";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { hostedLinqFirstContactContainsBlockedContent } from "@/src/lib/hosted-onboarding/webhook-provider-linq-shared";

const mocks = vi.hoisted(() => {
  const state = {
    deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
    claimHostedAiUsageLimitNotice: vi.fn(),
    releaseHostedAiUsageLimitNotice: vi.fn(),
    claimHostedLinqOnboardingLinkNotice: vi.fn(),
    claimHostedLinqQuotaReplyNotice: vi.fn(),
    classifyHostedLinqFirstContactAdmission: vi.fn(),
    releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn(),
    releaseHostedLinqQuotaReplyNoticeClaim: vi.fn(),
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
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
      linqApiToken: "linq-token",
      linqConversationPhoneNumbers: [],
      linqFirstContactAdmissionMode: "off" as "enforce" | "off",
      linqFirstContactAdmissionModel: "gpt-5.5",
      linqFirstContactAdmissionOpenAiApiKey: "test-first-contact-openai-key",
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
    readHostedExecutionControlClientIfConfigured: vi.fn(),
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
    nudgeHostedRunnerUserBestEffort: vi.fn(async () => ({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    })),
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
    checkHostedAiUsageGate: vi.fn(async (): Promise<HostedAiUsageGateDecision> => ({
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
    signalHostedMailboxAppendRuntime: vi.fn(async () => ({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    })),
    startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
      baseDetails,
      startedAtMs: 0,
      step,
    })),
    readHostedLinqDailyState: vi.fn<() => Promise<HostedLinqDailyState | null>>(async () => null),
    readHostedMailboxItemByDedupeKey: vi.fn(async (): Promise<{ id: string } | null> => null),
    readHostedMailboxItemOwnerById: vi.fn(async (input: { mailboxItemId: string }) => ({
      id: input.mailboxItemId,
      userId: "member_123",
    })),
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

export function expectHostedLinqReadReceiptSent(chatId = "chat_123"): void {
  expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
    chatId,
    signal: undefined,
  });
}

export function expectHostedLinqPointerSignalAccepted(eventId = "evt_123", userId = "member_123"): void {
  expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
    expectedUserId: userId,
    mailboxItemId: `mailbox_${eventId}`,
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
    releaseHostedLinqOnboardingLinkNoticeClaim: mocks.releaseHostedLinqOnboardingLinkNoticeClaim,
    releaseHostedLinqQuotaReplyNoticeClaim: mocks.releaseHostedLinqQuotaReplyNoticeClaim,
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerBestEffort: vi.fn(async () => "wake"),
  nudgeHostedRunnerUserBestEffort: mocks.nudgeHostedRunnerUserBestEffort,
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-allowance")
  >("@/src/lib/hosted-execution/usage-allowance");
  return {
    ...actual,
    claimHostedAiUsageLimitNotice: mocks.claimHostedAiUsageLimitNotice,
    checkHostedAiUsageGate: mocks.checkHostedAiUsageGate,
    releaseHostedAiUsageLimitNotice: mocks.releaseHostedAiUsageLimitNotice,
  };
});

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-first-contact-admission", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-first-contact-admission")
  >("@/src/lib/hosted-onboarding/linq-first-contact-admission");

  return {
    ...actual,
    classifyHostedLinqFirstContactAdmission: mocks.classifyHostedLinqFirstContactAdmission,
    readHostedLinqFirstContactAdmissionMode: () =>
      mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode,
  };
});

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
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

vi.mock("@/src/lib/hosted-onboarding/webhook-service-stripe", () => ({
  handleHostedStripeWebhook: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-linq-dispatch tests");
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

export type MockedFunction = ReturnType<typeof vi.fn>;
export type HostedLinqReceiptRecord = Record<string, unknown> & {
  processingOwnerToken?: unknown;
  status?: unknown;
  updatedAt?: Date;
};
export type HostedMemberRecord = Record<string, unknown> & {
  billingStatus: HostedBillingStatus;
};
export type MockedAsyncFunction<TInput, TResult = unknown> = MockedFunction & ((input: TInput) => Promise<TResult>);
export type HostedOnboardingLinqWebhookInput = Parameters<typeof handleHostedOnboardingLinqWebhookImpl>[0];

export type HostedInviteFixture = {
  create?: MockedFunction;
  findFirst?: (input: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }) => Promise<unknown>;
  findUnique?: MockedFunction;
  update?: MockedFunction;
  updateMany?: MockedFunction;
};

export type HostedLinqDailyStateFixture = {
  findUnique?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  updateMany?: (input: {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
};

export type HostedLinqFirstContactAdmissionDecisionFixture = {
  create?: MockedFunction;
  findUnique?: MockedFunction;
};

export type HostedLinqFirstContactEventReceiptFixture = {
  create?: MockedAsyncFunction<{ data: Record<string, unknown> }>;
  deleteMany?: MockedAsyncFunction<{ where: Record<string, unknown> }>;
  findUnique?: MockedAsyncFunction<{ where: Record<string, unknown> }>;
  updateMany?: MockedAsyncFunction<{
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }>;
  upsert?: MockedAsyncFunction<{
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    where?: Record<string, unknown>;
  }>;
};

export type HostedMemberFixture = {
  findUnique?: (input: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
  }) => Promise<unknown>;
  updateMany?: MockedFunction;
};

export type HostedMemberIdentityFixture = {
  createMany?: MockedFunction;
  findFirst?: (input: {
    include?: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
  findMany?: (input: {
    include?: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown[]>;
  findUnique?: (input: {
    include?: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
  upsert?: (input: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
};

export type HostedMemberEmailAuthorizationFixture = {
  findMany?: (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown[]>;
  findUnique?: (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>;
};

export type HostedMemberRoutingFixture = {
  createMany?: MockedFunction;
  findFirst?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  findMany?: (input: { where: Record<string, unknown> }) => Promise<unknown[]>;
  findUnique?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  updateMany?: (input: {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<unknown>;
  upsert?: MockedFunction;
};

export type HostedWebhookReceiptFixture = {
  create?: MockedFunction;
  findUnique?: MockedFunction;
  updateMany?: MockedFunction;
};

export type HostedWebhookReceiptSideEffectFixture = {
  deleteMany?: MockedFunction;
  upsert?: MockedFunction;
};

export type PrismaFixtureBase = {
  $executeRaw?: MockedFunction;
  $queryRaw?: MockedFunction;
  $transaction?: MockedFunction;
  hostedInvite?: HostedInviteFixture;
  hostedLinqDailyState?: HostedLinqDailyStateFixture;
  hostedLinqFirstContactAdmissionDecision?: HostedLinqFirstContactAdmissionDecisionFixture;
  hostedLinqFirstContactEventReceipt?: HostedLinqFirstContactEventReceiptFixture;
  hostedMember?: HostedMemberFixture;
  hostedMemberEmailAuthorization?: HostedMemberEmailAuthorizationFixture;
  hostedMemberIdentity?: HostedMemberIdentityFixture;
  hostedMemberRouting?: HostedMemberRoutingFixture;
  hostedThreadRoute?: {
    findMany?: MockedFunction;
  };
  hostedWebhookReceipt?: HostedWebhookReceiptFixture;
  hostedWebhookReceiptSideEffect?: HostedWebhookReceiptSideEffectFixture;
};

export type HostedOnboardingLinqWebhookPrismaFixture = PrismaFixtureBase & {
  $executeRaw: MockedFunction;
  $queryRaw: MockedFunction;
  $transaction?: MockedFunction;
};

export type HostedOnboardingLinqWebhookTestInput = Omit<HostedOnboardingLinqWebhookInput, "prisma"> & {
  prisma?: HostedOnboardingLinqWebhookPrismaFixture;
};

export async function handleHostedOnboardingLinqWebhook(input: HostedOnboardingLinqWebhookTestInput) {
  return handleHostedOnboardingLinqWebhookImpl(input as HostedOnboardingLinqWebhookInput);
}

export function asPrismaTransactionClient<T extends PrismaFixtureBase>(
  prisma: T,
): T & HostedOnboardingLinqWebhookPrismaFixture {
  const hostedInvite = prisma.hostedInvite;
  const hostedLinqDailyState = prisma.hostedLinqDailyState;
  const hostedLinqFirstContactAdmissionDecision = prisma.hostedLinqFirstContactAdmissionDecision;
  const hostedLinqFirstContactEventReceipt = prisma.hostedLinqFirstContactEventReceipt;
  const hostedMemberIdentity = prisma.hostedMemberIdentity;
  const hostedMemberRouting = prisma.hostedMemberRouting;
  const hostedMember = prisma.hostedMember;
  const hostedMemberEmailAuthorization = prisma.hostedMemberEmailAuthorization;

  prisma.$executeRaw ??= vi.fn(async () => 0);
  prisma.$queryRaw ??= vi.fn(async () => []);

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

  if (
    hostedMemberEmailAuthorization
    && !hostedMemberEmailAuthorization.findMany
    && hostedMemberEmailAuthorization.findUnique
  ) {
    hostedMemberEmailAuthorization.findMany = vi.fn(async () => {
      const record = await hostedMemberEmailAuthorization.findUnique?.({});
      return record ? [record] : [];
    });
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
        findMany: vi.fn(async (
          input: {
            include?: Record<string, unknown>;
            where: Record<string, unknown>;
          },
        ) => {
          const identity = await prisma.hostedMemberIdentity?.findFirst?.(input);
          return identity ? [identity] : [];
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
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
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
  if (
    prisma.hostedMemberIdentity
    && !prisma.hostedMemberIdentity.findMany
    && prisma.hostedMemberIdentity.findFirst
  ) {
    prisma.hostedMemberIdentity.findMany = vi.fn(async (
      input: {
        include?: Record<string, unknown>;
        where: Record<string, unknown>;
      },
    ) => {
      const identity = await prisma.hostedMemberIdentity?.findFirst?.(input);
      return identity ? [identity] : [];
    });
  }
  if (prisma.hostedMemberIdentity && !prisma.hostedMemberIdentity.createMany) {
    prisma.hostedMemberIdentity.createMany = vi.fn().mockResolvedValue({ count: 1 });
  }

  if (!hostedMemberRouting?.upsert) {
    Object.defineProperty(prisma, "hostedMemberRouting", {
      configurable: true,
      value: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
  } else if (!hostedMemberRouting.findFirst && hostedMemberRouting.findUnique) {
    hostedMemberRouting.findFirst = hostedMemberRouting.findUnique;
  }
  if (prisma.hostedMemberRouting && !prisma.hostedMemberRouting.createMany) {
    prisma.hostedMemberRouting.createMany = vi.fn().mockResolvedValue({ count: 1 });
  }
  if (prisma.hostedMemberRouting && !prisma.hostedMemberRouting.findMany) {
    prisma.hostedMemberRouting.findMany = vi.fn(async (input: { where: Record<string, unknown> }) => {
      const record = await readHostedMemberRoutingFromMockLookup({
        findFirst: prisma.hostedMemberRouting?.findFirst,
        findUnique: prisma.hostedMemberRouting?.findUnique,
        input,
      });
      return record ? [record] : [];
    });
  }

  if (!prisma.hostedThreadRoute?.findMany) {
    Object.defineProperty(prisma, "hostedThreadRoute", {
      configurable: true,
      value: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
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

  if (!hostedLinqFirstContactAdmissionDecision?.findUnique || !hostedLinqFirstContactAdmissionDecision?.create) {
    Object.defineProperty(prisma, "hostedLinqFirstContactAdmissionDecision", {
      configurable: true,
      value: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
  }

  if (!hostedLinqFirstContactEventReceipt) {
    Object.defineProperty(prisma, "hostedLinqFirstContactEventReceipt", {
      configurable: true,
      value: createHostedLinqFirstContactEventReceiptFixture(),
    });
  } else {
    hostedLinqFirstContactEventReceipt.create ??= vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    hostedLinqFirstContactEventReceipt.deleteMany ??= vi.fn().mockResolvedValue({ count: 0 });
    hostedLinqFirstContactEventReceipt.findUnique ??= vi.fn().mockResolvedValue(null);
    hostedLinqFirstContactEventReceipt.updateMany ??= vi.fn().mockResolvedValue({ count: 0 });
    hostedLinqFirstContactEventReceipt.upsert ??= vi.fn(async (
      { create, update }: { create: Record<string, unknown>; update: Record<string, unknown> },
    ) => {
      const data = {
        ...create,
        ...update,
      };
      if (hostedLinqFirstContactEventReceipt.create) {
        await hostedLinqFirstContactEventReceipt.create({ data });
      }
      return data;
    });
  }

  return prisma as T & HostedOnboardingLinqWebhookPrismaFixture;
}

export function withSerializedPrismaTransactions<T extends PrismaFixtureBase>(
  prisma: T,
): T & HostedOnboardingLinqWebhookPrismaFixture {
  const prismaWithTransaction = asPrismaTransactionClient(prisma);
  let tail = Promise.resolve();

  prismaWithTransaction.$transaction = vi.fn(async (
    callback: (transaction: typeof prismaWithTransaction) => Promise<unknown>,
  ) => {
    const previous = tail;
    let release: () => void = () => {};
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await callback(prismaWithTransaction);
    } finally {
      release();
    }
  });

  return prismaWithTransaction;
}

export function createHostedLinqFirstContactEventReceiptFixture(): Required<HostedLinqFirstContactEventReceiptFixture> {
  const receipts = new Map<string, Record<string, unknown>>();

  return {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const eventId = typeof data.eventId === "string" ? data.eventId : "";
      if (receipts.has(eventId)) {
        throw {
          code: "P2002",
        };
      }
      const record = {
        ...data,
        updatedAt: new Date(),
      };
      receipts.set(eventId, record);
      return record;
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const eventId = typeof where.eventId === "string" ? where.eventId : "";
      const existing = receipts.get(eventId);
      if (
        typeof where.processingOwnerToken === "string"
        && existing?.processingOwnerToken !== where.processingOwnerToken
      ) {
        return {
          count: 0,
        };
      }
      const existed = receipts.delete(eventId);
      return {
        count: existed ? 1 : 0,
      };
    }),
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const eventId = typeof where.eventId === "string" ? where.eventId : "";
      return receipts.get(eventId) ?? null;
    }),
    updateMany: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
      const eventId = typeof where.eventId === "string" ? where.eventId : "";
      const existing = receipts.get(eventId);
      if (!existing) {
        return {
          count: 0,
        };
      }
      if (typeof where.status === "string" && existing.status !== where.status) {
        return {
          count: 0,
        };
      }
      if (
        typeof where.processingOwnerToken === "string"
        && existing.processingOwnerToken !== where.processingOwnerToken
      ) {
        return {
          count: 0,
        };
      }
      if (where.updatedAt && typeof where.updatedAt === "object") {
        if (!(existing.updatedAt instanceof Date)) {
          return {
            count: 0,
          };
        }
        const cutoff = where.updatedAt as { gte?: Date; lt?: Date };
        if (cutoff.lt instanceof Date && existing.updatedAt.getTime() >= cutoff.lt.getTime()) {
          return {
            count: 0,
          };
        }
        if (cutoff.gte instanceof Date && existing.updatedAt.getTime() < cutoff.gte.getTime()) {
          return {
            count: 0,
          };
        }
      }
      const record = {
        ...existing,
        ...data,
        updatedAt: new Date(),
      };
      receipts.set(eventId, record);
      return {
        count: 1,
      };
    }),
    upsert: vi.fn(async (
      { create, update, where }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where?: Record<string, unknown>;
      },
    ) => {
      const eventId = typeof where?.eventId === "string"
        ? where.eventId
        : typeof create.eventId === "string"
          ? create.eventId
          : "";
      const existing = receipts.get(eventId);
      const record = {
        ...(existing ?? create),
        ...update,
        eventId,
        updatedAt: new Date(),
      };
      receipts.set(eventId, record);
      return record;
    }),
  };
}

export function withPrismaTransaction<
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

async function readHostedMemberRoutingFromMockLookup(input: {
  findFirst?: (query: { where: Record<string, unknown> }) => Promise<unknown>;
  findUnique?: (query: { where: Record<string, unknown> }) => Promise<unknown>;
  input: { where: Record<string, unknown> };
}): Promise<unknown> {
  if (input.findFirst) {
    return await input.findFirst(input.input);
  }

  if (!input.findUnique) {
    return null;
  }

  const where = input.input.where;
  const linqChatLookupKey = readFirstLookupCandidate(where.linqChatLookupKey);
  const pendingLinqParticipantContactLookupKey = readFirstLookupCandidate(
    where.pendingLinqParticipantContactLookupKey,
  );

  return await input.findUnique({
    where: {
      ...(typeof linqChatLookupKey === "string" ? { linqChatLookupKey } : {}),
      ...(typeof pendingLinqParticipantContactLookupKey === "string"
        ? { pendingLinqParticipantContactLookupKey }
        : {}),
    },
  });
}

function readFirstLookupCandidate(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { in?: unknown[] }).in)
  ) {
    const [first] = (value as { in: unknown[] }).in;
    return typeof first === "string" && first.trim().length > 0 ? first : null;
  }

  return null;
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

export function buildHostedLinqWebhookBody(input: {
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

export function buildTypingWebhookBody(input: {
  eventId?: string;
  service?: string;
} = {}): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat_id: "chat_typing_123",
      service: input.service ?? "iMessage",
    },
    event_id: input.eventId ?? "evt_typing_123",
    event_type: "chat.typing_indicator.started",
  });
}

export function readHostedWebhookReceiptCreateMock(prisma: PrismaFixtureBase | null | undefined): MockedFunction {
  return requireMock(prisma?.hostedWebhookReceipt?.create, "hostedWebhookReceipt.create");
}

export function readHostedWebhookReceiptUpdateManyMock(prisma: PrismaFixtureBase | null | undefined): MockedFunction {
  return requireMock(prisma?.hostedWebhookReceipt?.updateMany, "hostedWebhookReceipt.updateMany");
}

export function readHostedMemberRoutingUpsertMock(prisma: PrismaFixtureBase | null | undefined): MockedFunction {
  return requireMock(prisma?.hostedMemberRouting?.upsert, "hostedMemberRouting.upsert");
}

function requireMock(mock: MockedFunction | undefined, label: string): MockedFunction {
  if (!mock) {
    throw new Error(`Expected ${label} mock.`);
  }

  return mock;
}

export function readHostedWebhookSideEffectUpsertCalls(
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

export function makeHostedLinqDailyState(input: {
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

export function resetHostedOnboardingLinqDispatchMocks(): void {
  vi.clearAllMocks();
  mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);
  mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
  mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
  mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValue({
    category: "join_intent",
    confidence: 0.9,
    kind: "allow",
    source: "model",
  });
  mocks.releaseHostedLinqOnboardingLinkNoticeClaim.mockResolvedValue(undefined);
  mocks.releaseHostedLinqQuotaReplyNoticeClaim.mockResolvedValue(undefined);
  mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
  mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
  mocks.incrementHostedLinqInboundDailyState.mockResolvedValue(makeHostedLinqDailyState());
  mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(makeHostedLinqDailyState({
    outboundCount: 1,
  }));
  mocks.readHostedLinqDailyState.mockResolvedValue(null);
  mocks.hostedOnboardingEnvironment.linqLocalAllowedInboundPhoneNumbers = undefined;
  mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "off";
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
  mocks.checkHostedAiUsageGate.mockResolvedValue({
    allowed: true,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 100_000n,
    memberId: "member_123",
    periodEnd: new Date("2026-04-01T00:00:00.000Z"),
    periodStart: new Date("2026-03-01T00:00:00.000Z"),
    remainingUsdMicros: 100_000n,
    spentUsdMicros: 0n,
  });
  mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
  mocks.sendHostedLinqReadReceipt.mockResolvedValue({
    ok: true,
    status: 204,
  });
  mocks.startHostedLinqTypingIndicator.mockResolvedValue({
    ok: true,
    status: 204,
  });
  mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:member_123",
  });
}

export { mocks };
