import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  type HostedAiUsageGateDecision,
} from "@/src/lib/hosted-execution/usage-allowance";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import {
  buildHostedInviteReply,
  type HostedLinqWebhookEvent,
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { hostedLinqFirstContactContainsBlockedContent } from "@/src/lib/hosted-onboarding/webhook-provider-linq-shared";
import { renderUserFacingMessage } from "@/src/lib/hosted-messages/user-facing-messages";

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

function buildTrialConversionPendingMessage(input: {
  memberId: string;
  periodStart: Date;
}): string {
  return renderUserFacingMessage({
    context: {
      homeUrl: HOME_URL,
    },
    key: "linq.ai_usage.trial_conversion_pending",
    seed: `linq.ai_usage:${input.memberId}:trial_conversion_pending:${input.periodStart.toISOString()}`,
  }).text;
}

const mocks = vi.hoisted(() => {
  const state = {
    deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
    claimHostedAiUsageLimitNotice: vi.fn(),
    releaseHostedAiUsageLimitNotice: vi.fn(),
    claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
    claimHostedLinqOnboardingLinkNotice: vi.fn(),
    claimHostedLinqQuotaReplyNotice: vi.fn(),
    markHostedLinqOnboardingLinkNoticeSent: vi.fn(),
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
      linqFirstContactAdmissionModel: "gpt-5.4-nano",
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
    createHostedLinqChat: vi.fn(),
    sendHostedLinqReadReceipt: vi.fn(),
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
    readHostedMailboxItemByDedupeKey: vi.fn(async () => null),
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
    acceptHostedFamilyInviteFromPhoneTx: vi.fn(),
    buildHostedFamilyInviteAcceptedReplyText: vi.fn(() => "Welcome to Murph Family."),
    resolveHostedFamilyInviteTokenForInbound: vi.fn(),
  };

  return state;
});

function expectHostedLinqPointerSignalAccepted(eventId = "evt_123", userId = "member_123"): void {
  expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
    expectedUserId: userId,
    mailboxItemId: `mailbox_${eventId}`,
  });
}

function expectHostedLinqReadReceiptSent(chatId = "chat_123"): void {
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

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq-daily-state")>(
    "@/src/lib/hosted-onboarding/linq-daily-state",
  );

  return {
    ...actual,
    claimHostedLinqOnboardingLinkNotice: mocks.claimHostedLinqOnboardingLinkNotice,
    claimHostedLinqQuotaReplyNotice: mocks.claimHostedLinqQuotaReplyNotice,
    markHostedLinqOnboardingLinkNoticeSent: mocks.markHostedLinqOnboardingLinkNoticeSent,
    incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
    incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
    readHostedLinqDailyState: mocks.readHostedLinqDailyState,
    releaseHostedLinqOnboardingLinkNoticeClaim: mocks.releaseHostedLinqOnboardingLinkNoticeClaim,
    releaseHostedLinqQuotaReplyNoticeClaim: mocks.releaseHostedLinqQuotaReplyNoticeClaim,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    ...actual,
    claimHostedLinqDeliveryProviderDispatchTx: mocks.claimHostedLinqDeliveryProviderDispatchTx,
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

vi.mock("../src/lib/hosted-onboarding/linq-client", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/linq-client")>(
    "../src/lib/hosted-onboarding/linq-client",
  );

  return {
    ...actual,
    createHostedLinqChat: mocks.createHostedLinqChat,
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
  };
});

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

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/family-plan")>(
    "@/src/lib/hosted-onboarding/family-plan",
  );
  mocks.resolveHostedFamilyInviteTokenForInbound.mockImplementation(async (input: {
    text: string | null | undefined;
  }) => actual.parseHostedFamilyInviteStartToken(input.text));

  return {
    ...actual,
    acceptHostedFamilyInviteFromPhoneTx: mocks.acceptHostedFamilyInviteFromPhoneTx,
    buildHostedFamilyInviteAcceptedReplyText: mocks.buildHostedFamilyInviteAcceptedReplyText,
    resolveHostedFamilyInviteTokenForInbound: mocks.resolveHostedFamilyInviteTokenForInbound,
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
import { HOSTED_LINQ_DAILY_TEXT_LIMIT } from "@/src/lib/hosted-onboarding/linq-daily-state";

type MockedFunction = ReturnType<typeof vi.fn>;
type HostedOnboardingLinqWebhookInput = Parameters<typeof handleHostedOnboardingLinqWebhookImpl>[0];

type HostedInviteFixture = {
  create?: MockedFunction;
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

type HostedLinqAlertFixture = {
  createMany?: MockedFunction;
};

type HostedLinqDeliveryFixture = {
  create?: MockedFunction;
  findFirst?: MockedFunction;
  findMany?: MockedFunction;
  findUnique?: MockedFunction;
  update?: MockedFunction;
  updateMany?: MockedFunction;
  upsert?: MockedFunction;
};

type HostedLinqLineFixture = {
  findMany?: MockedFunction;
  findUnique?: MockedFunction;
  update?: MockedFunction;
  updateMany?: MockedFunction;
  upsert?: MockedFunction;
};

type HostedLinqProviderEventFixture = {
  createMany?: MockedFunction;
};

type HostedLinqFirstContactAdmissionDecisionFixture = {
  createMany?: MockedFunction;
  findUnique?: MockedFunction;
};

type HostedLinqFirstContactAdmissionBudgetFixture = {
  count?: MockedFunction;
  create?: MockedFunction;
  findFirst?: MockedFunction;
};

type HostedMemberFixture = {
  create?: MockedFunction;
  findUnique?: (input: {
    where?: Record<string, unknown>;
    include?: Record<string, unknown>;
  }) => Promise<unknown>;
  updateMany?: MockedFunction;
};

type HostedMemberIdentityFixture = {
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

type HostedMemberEmailAuthorizationFixture = {
  findMany?: (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown[]>;
  findUnique?: (input: { select?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>;
};

type HostedMemberRoutingFixture = {
  createMany?: MockedFunction;
  findFirst?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  findMany?: (input: { where: Record<string, unknown> }) => Promise<unknown[]>;
  findUnique?: (input: { where: Record<string, unknown> }) => Promise<unknown>;
  groupBy?: MockedFunction;
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

type HostedAccountGroupMembershipFixture = {
  findFirst?: MockedFunction;
};

type PrismaFixtureBase = {
  $executeRaw?: MockedFunction;
  $queryRaw?: MockedFunction;
  $transaction?: MockedFunction;
  hostedAccountGroupMembership?: HostedAccountGroupMembershipFixture;
  hostedInvite?: HostedInviteFixture;
  hostedLinqAlert?: HostedLinqAlertFixture;
  hostedLinqDailyState?: HostedLinqDailyStateFixture;
  hostedLinqDelivery?: HostedLinqDeliveryFixture;
  hostedLinqFirstContactAdmissionBudget?: HostedLinqFirstContactAdmissionBudgetFixture;
  hostedLinqFirstContactAdmissionDecision?: HostedLinqFirstContactAdmissionDecisionFixture;
  hostedLinqLine?: HostedLinqLineFixture;
  hostedLinqProviderEvent?: HostedLinqProviderEventFixture;
  hostedMember?: HostedMemberFixture;
  hostedMemberEmailAuthorization?: HostedMemberEmailAuthorizationFixture;
  hostedMemberIdentity?: HostedMemberIdentityFixture;
  hostedMemberRouting?: HostedMemberRoutingFixture;
  hostedThreadRoute?: {
    findMany?: MockedFunction;
    updateMany?: MockedFunction;
  };
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
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "hld_claimed",
    });
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.markHostedLinqOnboardingLinkNoticeSent.mockResolvedValue(true);
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValue({
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
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockResolvedValue(null);
    mocks.buildHostedFamilyInviteAcceptedReplyText.mockReturnValue("Welcome to Murph Family.");
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
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "provider_msg_123",
    });
    mocks.createHostedLinqChat.mockResolvedValue({
      chatId: "chat_fallback",
      messageId: "provider_msg_fallback",
    });
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
  });

  it("builds inactive signup invites from the rotating signup copy bank", () => {
    const reply = buildHostedInviteReply({
      joinUrl: "https://join.example.test/join/code_first_text",
      seed: "first-text-signup:test",
    });

    expect(reply).toContain("https://join.example.test/join/code_first_text");
    expect(reply.trim().length).toBeGreaterThan(
      "https://join.example.test/join/code_first_text".length,
    );
  });

  it("accepts Linq typing events without signaling runtime work", async () => {
    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: buildTypingWebhookBody(),
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "typing-ignored",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
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
            accountGroupMemberships: [],
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
                reactionEligible: false,
                service,
              }),
            }),
            userId: "member_123",
          }),
        }),
      );
      expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
      expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
      expectHostedLinqPointerSignalAccepted();
      expect(response).not.toHaveProperty("wakeUserId");
      expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
      expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expectHostedLinqReadReceiptSent();
      expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
        memberId: "member_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
      });
      expect(mocks.checkHostedAiUsageGate).toHaveBeenCalledWith({
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
        "temporal-signaled",
        expect.objectContaining({
          workflowIdSuffix: expect.any(String),
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

  it("does not add synthetic route authority to active-member direct iMessage wakes", async () => {
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
          accountGroupMemberships: [],
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
        chatIsGroup: false,
        service: "iMessage",
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
          message: expect.objectContaining({
            linqMessage: expect.objectContaining({
              service: "iMessage",
              threadIsDirect: true,
            }),
          }),
          userId: "member_123",
        }),
      }),
    );
    const outboxCall = mocks.enqueueHostedExecutionOutbox.mock.calls[0]?.[0];
    expect(outboxCall?.envelope.message).not.toHaveProperty("accountLookupKey");
    expect(outboxCall?.envelope.message).not.toHaveProperty("routeAuthority");
  });

  it("marks Linq reaction eligibility from raw parts before mailbox text compaction", async () => {
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
          accountGroupMemberships: [],
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
          parts: [
            {
              type: "text",
              value: "hello",
            },
            {
              type: "link",
              value: "https://example.test/check-in",
            },
          ],
        },
        eventId: "evt_text_link_reaction_eligible",
        service: "iMessage",
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
          eventId: "evt_text_link_reaction_eligible",
          message: expect.objectContaining({
            linqMessage: expect.objectContaining({
              parts: [
                {
                  type: "text",
                  value: "hello\nhttps://example.test/check-in",
                },
              ],
              reactionEligible: false,
              service: "iMessage",
            }),
          }),
        }),
      }),
    );
  });

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
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores empty Linq message events before member lookup or wake handoff", async () => {
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
        data: {
          parts: [],
        },
        eventId: "evt_empty_linq_message",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "empty-message-parts",
    });
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqOutboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores unbound Linq group chats from non-members before signup side effects", async () => {
    const prisma = asPrismaTransactionClient({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
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
        data: {
          chat: {
            id: "chat_group_123",
            is_group: true,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_group_chat",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    // The sender identity read is expected (it gates auto-provisioning), but a
    // non-member group message must produce no onboarding or runtime side effects.
    expect(prisma.hostedMemberIdentity.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMemberRouting.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
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
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted();
  });

  it("routes an active Linq member's unknown token-shaped text as a normal message", async () => {
    mocks.resolveHostedFamilyInviteTokenForInbound.mockResolvedValueOnce(null);
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
          accountGroupMemberships: [],
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
              value: "sending the family_photos album now",
            },
          ],
        },
        eventId: "evt_unknown_family_shape_linq",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.resolveHostedFamilyInviteTokenForInbound).toHaveBeenCalledWith({
      prisma,
      text: "sending the family_photos album now",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_unknown_family_shape_linq",
        kind: "conversation.message",
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                value: "sending the family_photos album now",
              }),
            ]),
          }),
        }),
      }),
      tx: prisma,
    });
    expectHostedLinqPointerSignalAccepted("evt_unknown_family_shape_linq");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
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
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_attachments_before_text");
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
          accountGroupMemberships: [],
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
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_oversized_parts");
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
          accountGroupMemberships: [],
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
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_link_compaction");
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
          accountGroupMemberships: [],
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

  it("signals Temporal after an active-member mailbox append", async () => {
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
          accountGroupMemberships: [],
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
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_required_nudge_failed");
    expectHostedLinqReadReceiptSent();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "temporal-signaled",
      expect.objectContaining({
        workflowIdSuffix: expect.any(String),
      }),
    );
  });

  it("sends active-member Linq read receipts without durable thread-route authority", async () => {
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
          accountGroupMemberships: [],
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
        eventId: "evt_read_receipt_failure",
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
    });
    expectHostedLinqPointerSignalAccepted("evt_read_receipt_failure");
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "sent",
      expect.objectContaining({
        httpStatus: 204,
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("can schedule active-member Linq read receipt checks after the webhook response", async () => {
    const scheduledTasks: Array<() => Promise<void>> = [];
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
          accountGroupMemberships: [],
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
        eventId: "evt_scheduled_read_receipt",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(scheduledTasks).toHaveLength(3);

    await scheduledTasks[2]?.();

    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
    });
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "sent",
      expect.objectContaining({
        httpStatus: 204,
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("sends scheduled active-member Linq read receipts with current inbound proof", async () => {
    const scheduledTasks: Array<() => Promise<void>> = [];
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_scheduled_read_receipt_route_drift",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(scheduledTasks).toHaveLength(3);

    for (const task of scheduledTasks) {
      await task();
    }

    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
    });
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "sent",
      expect.objectContaining({
        httpStatus: 204,
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("revalidates routed Linq read receipts before provider delivery", async () => {
    const routeAccountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!routeAccountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const routeLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: routeAccountLookupKey,
      channel: "linq",
      threadId: "chat_123",
    });
    const routeIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_123",
    });
    if (!routeLookupKey || !routeIdentityLookupKey) {
      throw new Error("Expected test route lookup keys.");
    }
    const threadContainerAccessRecord = {
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-03-26T00:00:00.000Z"),
      id: "member_thread_container_123",
      suspendedAt: null,
      updatedAt: new Date("2026-03-26T00:00:00.000Z"),
    };
    const ownerAccessRecord = {
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-03-26T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-03-26T00:00:00.000Z"),
    };
    const prisma = asPrismaTransactionClient({
      hostedThreadRoute: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            {
              channel: "linq",
              container: {
                member: {
                  billingStatus: HostedBillingStatus.active,
                  createdAt: new Date("2026-03-26T00:00:00.000Z"),
                  id: "member_thread_container_123",
                  suspendedAt: null,
                  updatedAt: new Date("2026-03-26T00:00:00.000Z"),
                },
                owner: ownerAccessRecord,
              },
              containerMemberId: "member_thread_container_123",
              threadLookupKey: routeLookupKey,
            },
          ])
          .mockResolvedValue([]),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          ...threadContainerAccessRecord,
          threadContainer: {
            owner: ownerAccessRecord,
          },
        }),
      },
      hostedThreadContainerParticipant: {
        findFirst: vi.fn().mockResolvedValue(null),
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

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_routed_read_receipt_stale",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-thread-route",
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_thread_container_123",
      mailboxItemId: "mailbox_evt_routed_read_receipt_stale",
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          threadIdentityLookupKey: {
            in: expect.arrayContaining([routeIdentityLookupKey]),
          },
        }),
      }),
    );
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          threadIdentityLookupKey: {
            in: expect.arrayContaining([routeIdentityLookupKey]),
          },
        }),
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
        responseReason: "wake-appended-thread-route",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("fails the Linq webhook before read receipt when Temporal signaling fails", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("Temporal unavailable"));
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
          accountGroupMemberships: [],
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
        eventId: "evt_direct_nudge_read_receipt",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Temporal unavailable");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_direct_nudge_read_receipt",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
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

  it("fails webhook success when Temporal signaling fails after mailbox append", async () => {
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: false,
      configured: false,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("Temporal unavailable"));
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
          accountGroupMemberships: [],
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
    })).rejects.toThrow("Temporal unavailable");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_ingress_read_receipt_skipped",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
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
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    const transactionHostedMemberFindUnique = vi.fn().mockResolvedValue({
      accountGroupMemberships: [],
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
      hostedMemberRouting,
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
      hostedMemberRouting,
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
    // Identity match + unified access read both run on the transaction client.
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
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted();
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
          accountGroupMemberships: [],
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
          accountGroupMemberships: [],
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
          accountGroupMemberships: [],
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
          accountGroupMemberships: [],
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

  it("does not bind an active member home route when no fallback Linq line is assignable", async () => {
    const hostedLinqLine = buildUnassignableHostedLinqLineFixture();
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    const prisma = asPrismaTransactionClient({
      hostedLinqLine,
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_active_unassignable_line",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(hostedLinqLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        configuredAt: { not: null },
        egressPolicy: "enabled",
        healthStatus: { in: ["healthy", "unknown"] },
        phoneNumberEncrypted: { not: null },
      }),
    }));
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("keeps a matching active home chat without filling a missing recipient from inbound metadata", async () => {
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_123",
      }),
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildUnassignableHostedLinqLineFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_active_same_chat_missing_recipient",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    // The chat is already the member's home chat with no pending state, so
    // the wake skips the binding rewrite entirely — the missing recipient
    // stays missing rather than being filled from inbound metadata.
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("still rewrites the home binding when a stale pending lookup key persists on the routing row", async () => {
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_123",
      }),
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      // Stale artifact: the lookup key survived while its encrypted pending
      // contact value is gone, so decoded pending fields all read empty.
      pendingLinqParticipantContactLookupKey: "stale-pending-contact-key",
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildUnassignableHostedLinqLineFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_active_same_chat_stale_pending_key",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    // The raw pending column keeps the rewrite alive so clearPending repairs
    // the stale lookup key instead of leaving it to misroute later inbounds.
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        pendingLinqParticipantContactLookupKey: null,
      }),
    }));
  });

  it("does not bind a new active member home route from a sparse Linq payload", async () => {
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    const prisma = asPrismaTransactionClient({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        data: {
          chat: {
            id: "chat_sparse",
            is_group: false,
          },
        },
        eventId: "evt_active_sparse_no_line",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unassignable-home-line",
    });
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("binds an active member's bare home-line recipient even when the line left the assignable pool", async () => {
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: "+15550000000",
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildUnassignableHostedLinqLineFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_active_stale_bare_line",
      }),
      signature: null,
      timestamp: null,
    });

    // The bare assignment is durable authority: line-pool assignability
    // gates new claims, not routes the member already owns.
    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(hostedMemberRouting.upsert).toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("fails closed when the inbound chat is already another member's home chat", async () => {
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_other",
        value: "chat_123",
      }),
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_other",
        value: "+15550000000",
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
      memberId: "member_other",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildHostedLinqLineFixture({
        phoneNumber: "+15550000000",
      }),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_home_chat_owner_mismatch",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-chat-owner-mismatch",
    });
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(hostedMemberRouting.updateMany).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not bind an active member home route from a capacity-exhausted inbound Linq line", async () => {
    const homeLinePhone = "+15550000000";
    const homeLineLookupKey = createHostedPhoneLookupKey(homeLinePhone);
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    hostedMemberRouting.groupBy.mockImplementation(
      async (input: { where?: { linqHomeLineAssignedAt?: unknown } }) =>
        input.where?.linqHomeLineAssignedAt
          ? [{
              linqRecipientPhoneLookupKey: homeLineLookupKey,
              _count: { _all: 1 },
            }]
          : []
    );
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildHostedLinqLineFixture({
        maxNewConversationsPerDay: 1,
        phoneNumber: homeLinePhone,
      }),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_active_capacity_exhausted_line",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("accepts a phone-bound Family invite token from inbound iMessage", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockResolvedValueOnce({
      groupId: "group_family",
      memberId: "member_family",
      role: "member",
      status: "active",
    });

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(null),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "family_phone_token",
            },
          ],
        },
        eventId: "evt_family_linq",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "family-invite-accepted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledWith({
      now: new Date("2026-03-26T12:00:00.000Z"),
      onAcceptedMemberValidated: expect.any(Function),
      phoneNumber: "+15551234567",
      text: "family_phone_token",
      tx: prisma,
    });
    const hostedMemberRouting = prisma.hostedMemberRouting;
    if (!hostedMemberRouting) {
      throw new Error("Expected hosted member routing fixture.");
    }
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        linqChatLookupKey: expect.stringContaining("hbidx:linq-chat:v1:"),
        linqRecipientPhoneLookupKey: expect.stringContaining("hbidx:phone:v1:"),
        memberId: "member_family",
        pendingLinqChatLookupKey: null,
      }),
      update: expect.objectContaining({
        linqChatLookupKey: expect.stringContaining("hbidx:linq-chat:v1:"),
        linqRecipientPhoneLookupKey: expect.stringContaining("hbidx:phone:v1:"),
        pendingLinqChatLookupKey: null,
      }),
      where: {
        memberId: "member_family",
      },
    }));
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_family",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_123",
      idempotencyKey: "linq-message:evt_family_linq",
      message: "Welcome to Murph Family.",
      replyToMessageId: "msg_123",
      signal: undefined,
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("accepts a Family invite token from an existing saved home chat with sparse line metadata", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockResolvedValueOnce({
      groupId: "group_family",
      memberId: "member_123",
      role: "member",
      status: "active",
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
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
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550100001"),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildUnassignableHostedLinqLineFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.incomplete,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        data: {
          chat: {
            id: "chat_home",
            is_group: false,
          },
          parts: [
            {
              type: "text",
              value: "family_sparse_token",
            },
          ],
        },
        eventId: "evt_family_sparse_saved_home",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "family-invite-accepted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledWith({
      now: new Date("2026-03-26T12:00:00.000Z"),
      onAcceptedMemberValidated: expect.any(Function),
      phoneNumber: "+15551234567",
      text: "family_sparse_token",
      tx: prisma,
    });
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalled();
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqChatLookupKey: expect.stringContaining("hbidx:linq-chat:v1:"),
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550100001"),
      }),
    }));
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_home",
      idempotencyKey: "linq-message:evt_family_sparse_saved_home",
    }));
  });

  it("does not accept a Family invite token that would rebind an unattested active home chat", async () => {
    const homeLinePhone = "+15550100001";
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_home",
      }),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: homeLinePhone,
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildHostedLinqLineFixture({
        phoneNumber: homeLinePhone,
      }),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        data: {
          chat: {
            id: "chat_possible_group",
            owner_handle: {
              handle: homeLinePhone,
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [
            {
              type: "text",
              value: "family_phone_token",
            },
          ],
        },
        eventId: "evt_family_unattested_rebind",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unattested-direct-chat",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).not.toHaveBeenCalled();
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not accept a Family invite token from an unassignable inbound Linq line", async () => {
    const hostedLinqLine = buildUnassignableHostedLinqLineFixture();
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedLinqLine,
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(null),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "family_phone_token",
            },
          ],
        },
        eventId: "evt_family_unassignable_line",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(hostedLinqLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        configuredAt: { not: null },
        egressPolicy: "enabled",
        healthStatus: { in: ["healthy", "unknown"] },
        phoneNumberEncrypted: { not: null },
      }),
    }));
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).not.toHaveBeenCalled();
    const hostedMemberRouting = prisma.hostedMemberRouting;
    if (!hostedMemberRouting) {
      throw new Error("Expected hosted member routing fixture.");
    }
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not accept a Family invite token when the inbound Linq line is missing", async () => {
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_missing_recipient_line",
            is_group: false,
          },
          parts: [
            {
              type: "text",
              value: "family_missing_line_token",
            },
          ],
        },
        eventId: "evt_family_missing_recipient_line",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unassignable-home-line",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not accept a Family invite token from a capacity-exhausted inbound Linq line", async () => {
    const homeLinePhone = "+15550000000";
    const homeLineLookupKey = createHostedPhoneLookupKey(homeLinePhone);
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    hostedMemberRouting.groupBy.mockImplementation(
      async (input: { where?: { linqHomeLineAssignedAt?: unknown } }) =>
        input.where?.linqHomeLineAssignedAt
          ? [{
              linqRecipientPhoneLookupKey: homeLineLookupKey,
              _count: { _all: 1 },
            }]
          : []
    );
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedLinqLine: buildHostedLinqLineFixture({
        maxNewConversationsPerDay: 1,
        phoneNumber: homeLinePhone,
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting,
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
        data: {
          parts: [
            {
              type: "text",
              value: "family_capacity_token",
            },
          ],
        },
        eventId: "evt_family_capacity_exhausted_line",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).not.toHaveBeenCalled();
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not send a generic signup link for unaccepted Family invite tokens", async () => {
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "family_expired_or_wrong_line",
            },
          ],
        },
        eventId: "evt_family_linq_unaccepted",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "family-invite-not-accepted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledWith({
      now: new Date("2026-03-26T12:00:00.000Z"),
      onAcceptedMemberValidated: expect.any(Function),
      phoneNumber: "+15551234567",
      text: "family_expired_or_wrong_line",
      tx: prisma,
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("retries the Family welcome reply when the first Linq send fails after acceptance", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockResolvedValue({
      groupId: "group_family",
      memberId: "member_family",
      role: "member",
      status: "active",
    });
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(new Error("linq send failed"));

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(null),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      data: {
        parts: [
          {
            type: "text",
            value: "family_retry_token",
          },
        ],
      },
      eventId: "evt_family_linq_retry",
      service: "iMessage",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).rejects.toThrow("linq send failed");

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "family-invite-accepted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenLastCalledWith({
      chatId: "chat_123",
      idempotencyKey: "linq-message:evt_family_linq_retry",
      message: "Welcome to Murph Family.",
      replyToMessageId: "msg_123",
      signal: undefined,
    });
  });

  it("ignores wrong-phone Family invite tokens without failing Linq", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different phone number.",
    }));

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "family_wrong_phone",
            },
          ],
        },
        eventId: "evt_family_linq_wrong_phone",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "family-invite-not-accepted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledWith({
      now: new Date("2026-03-26T12:00:00.000Z"),
      onAcceptedMemberValidated: expect.any(Function),
      phoneNumber: "+15551234567",
      text: "family_wrong_phone",
      tx: prisma,
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
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
    expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        linqHomeLineAssignedAt: expect.any(Date),
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
        pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
      }),
      update: expect.objectContaining({
        linqHomeLineAssignedAt: expect.any(Date),
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
        pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
      }),
    }));
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining("https://join.example.test/join/code_first_text"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markHostedLinqOnboardingLinkNoticeSent.mock.invocationCallOrder[0],
    );
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("does not create a pending signup route when the inbound Linq line is not assignable", async () => {
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
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildUnassignableHostedLinqLineFixture(),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberRouting: {
        upsert: vi.fn(),
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
        eventId: "evt_unassignable_line_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(prismaMocks.hostedLinqLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        configuredAt: { not: null },
        egressPolicy: "enabled",
        healthStatus: { in: ["healthy", "unknown"] },
        phoneNumberEncrypted: { not: null },
      }),
    }));
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not create a pending signup route when the inbound Linq line has exhausted capacity", async () => {
    const homeLinePhone = "+15550000000";
    const homeLineLookupKey = createHostedPhoneLookupKey(homeLinePhone);
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
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLineFixture({
        maxNewConversationsPerDay: 1,
        phoneNumber: homeLinePhone,
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberRouting: {
        groupBy: vi.fn(async (input: { where?: { linqHomeLineAssignedAt?: unknown } }) =>
          input.where?.linqHomeLineAssignedAt
            ? [{
                linqRecipientPhoneLookupKey: homeLineLookupKey,
                _count: { _all: 1 },
              }]
            : []
        ),
        upsert: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_capacity_exhausted_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(prismaMocks.hostedMemberRouting.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        linqHomeLineAssignedAt: {
          gte: expect.any(Date),
        },
      }),
    }));
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_email",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberEmailAuthorization: {
        findMany: vi.fn().mockResolvedValue([]),
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
    expect(prismaMocks.hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
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
        message: expect.stringContaining("https://join.example.test/join/code_email_handle"),
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
          accountGroupMemberships: [],
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
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining("https://join.example.test/join/code_many_parts"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("sends the signup link on the first inbound SMS phone message", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const firstContactAdmissionOrder: string[] = [];
    mocks.classifyHostedLinqFirstContactAdmission.mockImplementationOnce(async () => {
      firstContactAdmissionOrder.push("classify");
      return {
        confidence: 1,
        kind: "allow",
        source: "deterministic",
      };
    });
    const invite = {
      channel: "linq",
      id: "invite_sms",
      inviteCode: "code_sms",
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
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          firstContactAdmissionOrder.push("claim");
          return data;
        }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            confidence: 1,
            decision: "allow",
            eventId: "evt_sms_first_contact",
            source: "deterministic",
          }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_sms",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
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
              value: "Murph can you help me start?",
            },
          ],
        },
        eventId: "evt_sms_first_contact",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_sms",
      joinUrl: "https://join.example.test/join/code_sms",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(firstContactAdmissionOrder).toEqual(["claim", "classify"]);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 1,
        decision: "allow",
        eventId: "evt_sms_first_contact",
        source: "deterministic",
      },
      skipDuplicates: true,
    });
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining("https://join.example.test/join/code_sms"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores non-phone SMS first contact before invite side effects", async () => {
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberEmailAuthorization: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([]),
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
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sender_handle: {
            handle: "buddy@example.test",
            id: "handle_sender_email_sms",
            service: "sms",
          },
        },
        eventId: "evt_sms_email_first_contact",
        service: "sms",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "undeliverable-first-contact",
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("blocks classifier-denied unknown Linq first contacts before member or invite side effects", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      confidence: 0.94,
      kind: "block",
      source: "model",
    });
    const rejectedMessageText = `Hey Gail! ${"x".repeat(2_050)}`;
    const boundedRejectedMessageText = rejectedMessageText.slice(0, 2_000);

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
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            confidence: 0.94,
            decision: "block",
            eventId: "evt_wrong_person_first_contact",
            source: "model",
          }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            accountGroupMemberships: [],
            billingStatus: HostedBillingStatus.active,
            id: "member_concurrent",
            invites: [],
            linqChatId: "chat_123",
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
        data: {
          parts: [
            {
              type: "text",
              value: rejectedMessageText,
            },
          ],
        },
        eventId: "evt_wrong_person_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledWith({
      request: expect.objectContaining({
        eventId: "evt_wrong_person_first_contact",
        participantContactKind: "phone",
        partTypes: ["text"],
        service: "imessage",
        text: boundedRejectedMessageText,
      }),
      signal: undefined,
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 0.94,
        decision: "block",
        eventId: "evt_wrong_person_first_contact",
        source: "model",
      },
      skipDuplicates: true,
    });
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("does not hold the budget transaction open while classifying first contact", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const admissionOrder: string[] = [];
    let transactionOpen = false;
    mocks.classifyHostedLinqFirstContactAdmission.mockImplementationOnce(async () => {
      expect(transactionOpen).toBe(false);
      admissionOrder.push("classify");
      return {
        confidence: 0.94,
        kind: "block",
        source: "model",
      };
    });
    const transactionDecisionCreateMany = vi.fn(async () => {
      throw new Error("first-contact admission decision should not be recorded inside the budget transaction");
    });
    const transactionClient = {
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          admissionOrder.push("claim");
          return data;
        }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: transactionDecisionCreateMany,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const rootDecisionCreateMany = vi.fn(async () => {
      admissionOrder.push("record");
      return { count: 1 };
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
      hostedLinqFirstContactAdmissionDecision: {
        createMany: rootDecisionCreateMany,
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            confidence: 0.94,
            decision: "block",
            eventId: "evt_transactional_first_contact_block",
            source: "model",
          }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    }) as HostedOnboardingLinqWebhookPrismaFixture & {
      $transaction: MockedFunction;
    };
    const transactionPrisma = asPrismaTransactionClient(transactionClient);
    prisma.$transaction = vi.fn(async (
      callback: (innerTx: typeof transactionPrisma) => Promise<unknown>,
    ) => {
      transactionOpen = true;
      try {
        return await callback(transactionPrisma);
      } finally {
        transactionOpen = false;
      }
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "discount blast",
            },
          ],
        },
        eventId: "evt_transactional_first_contact_block",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(admissionOrder).toEqual(["claim", "classify", "record"]);
    expect(transactionDecisionCreateMany).not.toHaveBeenCalled();
    expect(rootDecisionCreateMany).toHaveBeenCalledWith({
      data: {
        confidence: 0.94,
        decision: "block",
        eventId: "evt_transactional_first_contact_block",
        source: "model",
      },
      skipDuplicates: true,
    });
    expect(transactionClient.hostedMember.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("deterministically blocks media-only unknown Linq first contacts without claiming a classifier-budget attempt", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

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
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            confidence: 1,
            decision: "block",
            eventId: "evt_media_only_first_contact",
            source: "deterministic",
          }),
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
        data: {
          parts: [
            {
              type: "media",
              value: "https://example.test/cat.jpg",
            },
          ],
        },
        eventId: "evt_media_only_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });
    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.findFirst).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.count).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 1,
        decision: "block",
        eventId: "evt_media_only_first_contact",
        source: "deterministic",
      },
      skipDuplicates: true,
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("stops classifying unknown Linq first contacts after four budgeted attempts", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

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
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(4),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
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
        data: {
          parts: [
            {
              type: "text",
              value: "Murph can you help me with this?",
            },
          ],
        },
        eventId: "evt_first_contact_budget_exhausted",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "first-contact-admission-budget-exhausted",
    });
    // The locked claim checks same-event idempotency first (findFirst) so
    // transport retries of an already-claimed event can re-run the classifier;
    // only brand-new events for an already-exhausted contact short-circuit on
    // the total-count read, before model egress or any insert.
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.findFirst).toHaveBeenCalledWith({
      where: {
        eventId: "evt_first_contact_budget_exhausted",
        participantContactLookupKey: {
          in: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.count).toHaveBeenCalledWith({
      where: {
        participantContactLookupKey: {
          in: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("reuses stored classifier blocks for duplicate unknown Linq first contacts", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 2,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.94,
          decision: "block",
          eventId: "evt_recorded_wrong_person_first_contact",
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "Hey Gail, I left the plates outside.",
            },
          ],
        },
        eventId: "evt_recorded_wrong_person_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("reuses stored classifier blocks even after the sender has active member state", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 2,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.94,
          decision: "block",
          eventId: "evt_recorded_block_after_member_state",
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_after_block",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_recorded_block_after_member_state",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("bounds first-contact classifier service metadata before OpenAI egress", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      confidence: 0.94,
      kind: "block",
      source: "model",
    });

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
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            confidence: 0.94,
            decision: "block",
            eventId: "evt_first_contact_untrusted_service",
            source: "model",
          }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_first_contact_untrusted_service",
        service: `malformed-${"x".repeat(4_096)}`,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledWith({
      request: expect.objectContaining({
        eventId: "evt_first_contact_untrusted_service",
        service: "unknown",
      }),
      signal: undefined,
    });
  });

  it("fails open when the first-contact classifier is unavailable", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(hostedOnboardingError({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "transport",
      },
      httpStatus: 503,
      message: "Linq first-contact admission classifier is unavailable.",
      retryable: true,
    }));

    const invite = {
      channel: "linq",
      id: "invite_classifier_fallback",
      inviteCode: "code_classifier_fallback",
      memberId: "member_classifier_fallback",
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
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            confidence: 1,
            decision: "allow",
            eventId: "evt_classifier_transport_retry",
            source: "deterministic",
          }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: invite.id,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: invite.memberId,
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
        eventId: "evt_classifier_transport_retry",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 1,
        decision: "allow",
        eventId: "evt_classifier_transport_retry",
        source: "deterministic",
      },
      skipDuplicates: true,
    });
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: invite.memberId,
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: invite.memberId,
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining(`https://join.example.test/join/${invite.inviteCode}`),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("does not fail open for plain errors that only mimic the classifier-unavailable code", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

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
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_classifier_plain_object_error",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).not.toHaveBeenCalled();
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

  it("fails open for same-event classifier retries without spending another budget attempt", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(hostedOnboardingError({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "transport",
      },
      httpStatus: 503,
      message: "Linq first-contact admission classifier is unavailable.",
      retryable: true,
    }));

    const eventId = "evt_classifier_transport_retry_replay";
    const invite = {
      channel: "linq",
      id: "invite_classifier_replay_fallback",
      inviteCode: "code_classifier_replay_fallback",
      memberId: "member_classifier_replay_fallback",
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
            receiptAttemptCount: 2,
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
          id: invite.id,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn(),
      },
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValue(4),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          eventId,
          participantContactKind: "phone",
          participantContactLookupKey: "blind:v1:retry-contact",
        }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            confidence: 1,
            decision: "allow",
            eventId,
            source: "deterministic",
          }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: invite.memberId,
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
        eventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 1,
        decision: "allow",
        eventId,
        source: "deterministic",
      },
      skipDuplicates: true,
    });
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: invite.memberId,
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: invite.memberId,
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining(`https://join.example.test/join/${invite.inviteCode}`),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("bypasses first-contact admission for known active Linq members", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        chatIsGroup: false,
        eventId: "evt_active_member_no_first_contact_classifier",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
  });

  it.each(["sms", "RCS"] as const)(
    "sends signup links for existing inactive phone first-contact %s texts",
    async (service) => {
      mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
      mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
          confidence: 0.94,
        kind: "block",
        source: "model",
      });
      const invite = {
        channel: "linq",
        id: `invite_${service.toLowerCase()}`,
        inviteCode: `code_${service.toLowerCase()}`,
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
            id: invite.id,
            sentAt: new Date("2026-03-26T12:00:01.000Z"),
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        hostedMember: {
          create: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            accountGroupMemberships: [],
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
        inviteCode: invite.inviteCode,
        joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
        ok: true,
        reason: "sent-signup-link",
      });
      expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
      expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
      expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
      expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
      expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalled();
      expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
        memberId: "member_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
      });
      expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
        memberId: "member_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
      });
      expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "chat_123",
          message: expect.stringContaining(`https://join.example.test/join/${invite.inviteCode}`),
          replyToMessageId: "msg_123",
        }),
      );
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
      expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "URL text",
      parts: [
        {
          type: "text",
          value: "Check this out https://spam.example.test",
        },
      ],
    },
    {
      label: "bare domain URL text",
      parts: [
        {
          type: "text",
          value: "Open example.com/join for details",
        },
      ],
    },
    {
      label: "short bare domain URL text",
      parts: [
        {
          type: "text",
          value: "bit.ly/foo",
        },
      ],
    },
    {
      label: "unlisted short bare domain URL text",
      parts: [
        {
          type: "text",
          value: "rb.gy/foo",
        },
      ],
    },
    {
      label: "unlisted bare domain URL text",
      parts: [
        {
          type: "text",
          value: "example.xyz/join",
        },
      ],
    },
    {
      label: "shopping bare domain URL text",
      parts: [
        {
          type: "text",
          value: "site.shop/path",
        },
      ],
    },
    {
      label: "punctuation-wrapped bare domain URL text",
      parts: [
        {
          type: "text",
          value: "(example.com/path).",
        },
      ],
    },
    {
      label: "link part",
      parts: [
        {
          type: "link",
          value: "https://spam.example.test",
        },
      ],
    },
    {
      label: "message/data rates boilerplate",
      parts: [
        {
          type: "text",
          value: "Msg&data rates may apply. Text 'STOP' to quit.",
        },
      ],
    },
    {
      label: "slash-separated message/data rates boilerplate",
      parts: [
        {
          type: "text",
          value: "Msg/data rates apply.",
        },
      ],
    },
    {
      label: "standard message rates boilerplate",
      parts: [
        {
          type: "text",
          value: "Standard message rates apply.",
        },
      ],
    },
    {
      label: "STOP opt-out boilerplate",
      parts: [
        {
          type: "text",
          value: "Reply STOP to unsubscribe",
        },
      ],
    },
    {
      label: "hyphenated STOP opt-out boilerplate",
      parts: [
        {
          type: "text",
          value: "Text STOP to opt-out",
        },
      ],
    },
    {
      label: "STOP end boilerplate",
      parts: [
        {
          type: "text",
          value: "Text STOP to end",
        },
      ],
    },
    {
      label: "standalone STOP opt-out command",
      parts: [
        {
          type: "text",
          value: "STOP",
        },
      ],
    },
    {
      label: "standalone lowercase stop opt-out command",
      parts: [
        {
          type: "text",
          value: "stop",
        },
      ],
    },
    {
      label: "standalone UNSUBSCRIBE opt-out command",
      parts: [
        {
          type: "text",
          value: "UNSUBSCRIBE",
        },
      ],
    },
    {
      label: "standalone CANCEL opt-out command",
      parts: [
        {
          type: "text",
          value: "CANCEL",
        },
      ],
    },
    {
      label: "standalone END opt-out command",
      parts: [
        {
          type: "text",
          value: "END",
        },
      ],
    },
    {
      label: "standalone QUIT opt-out command",
      parts: [
        {
          type: "text",
          value: "QUIT",
        },
      ],
    },
    {
      label: "standalone STOP opt-out command over RCS",
      parts: [
        {
          type: "text",
          value: "STOP",
        },
      ],
      service: "RCS",
    },
  ])("ignores first-contact phone message with $label before invite side effects", async ({ parts, service }) => {
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
        data: {
          parts,
        },
        eventId: "evt_blocked_first_contact",
        service,
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-content",
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

  it("applies standalone opt-out blocking only to SMS-like or unknown phone first-contact services", () => {
    const phoneContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    const emailContact = createHostedLinqParticipantContact({
      kind: "email",
      value: "buddy@example.test",
    });
    if (!phoneContact || !emailContact) {
      throw new Error("Expected valid Linq participant contacts.");
    }

    const messageEvent = requireHostedLinqMessageReceivedEvent(parseHostedLinqWebhookEvent(
      buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "STOP",
            },
          ],
        },
        service: "iMessage",
      }),
    ));
    const messageEventWithoutService = {
      ...messageEvent,
      data: {
        ...messageEvent.data,
        service: undefined,
      },
    };

    expect(hostedLinqFirstContactContainsBlockedContent({
      event: messageEventWithoutService,
      participantContact: phoneContact,
    })).toBe(true);
    expect(hostedLinqFirstContactContainsBlockedContent({
      event: messageEventWithoutService,
      participantContact: emailContact,
    })).toBe(false);
    expect(hostedLinqFirstContactContainsBlockedContent({
      event: messageEvent,
      participantContact: phoneContact,
    })).toBe(false);
  });

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
          accountGroupMemberships: [],
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
        message: expect.stringContaining("https://join.example.test/join/code_deferred"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
  });

  it("delivers first-contact signup links from a fallback line when the incoming line is at quota", async () => {
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const incomingLineLookupKey = createHostedPhoneLookupKey(incomingLinePhone);
    const invite = {
      channel: "linq",
      id: "invite_fallback_quota",
      inviteCode: "code_fallback_quota",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    hostedMemberRouting.groupBy.mockImplementation(async (
      input: { where?: { linqHomeLineAssignedAt?: unknown } },
    ) =>
      input.where?.linqHomeLineAssignedAt
        ? [{
            linqRecipientPhoneLookupKey: incomingLineLookupKey,
            _count: { _all: 1 },
          }]
        : []
    );
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
          id: "invite_fallback_quota",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [
          {
            maxNewConversationsPerDay: 1,
            phoneNumber: incomingLinePhone,
          },
          {
            phoneNumber: fallbackLinePhone,
          },
        ],
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting,
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_fallback_quota_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_fallback_quota",
      joinUrl: "https://join.example.test/join/code_fallback_quota",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqChatLookupKey: null,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(fallbackLinePhone),
        pendingLinqChatLookupKey: null,
      }),
    }));
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).toHaveBeenCalledWith({
      from: fallbackLinePhone,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      message: expect.stringContaining("https://join.example.test/join/code_fallback_quota"),
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.createHostedLinqChat.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markHostedLinqOnboardingLinkNoticeSent.mock.invocationCallOrder[0],
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("delivers first-contact signup links from a fallback line when the incoming line is degraded", async () => {
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const invite = {
      channel: "linq",
      id: "invite_fallback_degraded",
      inviteCode: "code_fallback_degraded",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
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
          id: "invite_fallback_degraded",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [
          {
            phoneNumber: fallbackLinePhone,
          },
        ],
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting,
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_degraded",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_fallback_degraded_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_fallback_degraded",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqChatLookupKey: null,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(fallbackLinePhone),
        pendingLinqChatLookupKey: null,
      }),
    }));
    expect(mocks.createHostedLinqChat).toHaveBeenCalledWith({
      from: fallbackLinePhone,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      message: expect.stringContaining("https://join.example.test/join/code_fallback_degraded"),
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("keeps same-phone fallback first-contact races on the first assigned home line", async () => {
    const incomingLinePhone = "+15550000000";
    const firstFallbackLinePhone = "+15550100001";
    const secondFallbackLinePhone = "+15550100002";
    const memberPhone = "+15551234567";
    let createdMemberId: string | null = null;
    let identityLookupCount = 0;
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    hostedMemberRouting.findMany.mockResolvedValue([]);
    let dailyAssignmentCountReadCount = 0;
    hostedMemberRouting.groupBy.mockImplementation(async (
      input: { where?: { linqHomeLineAssignedAt?: unknown } },
    ) => {
      if (!input.where?.linqHomeLineAssignedAt) {
        return [];
      }

      dailyAssignmentCountReadCount += 1;
      return dailyAssignmentCountReadCount === 1
        ? [
            {
              linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(incomingLinePhone),
              _count: { _all: 1 },
            },
            {
              linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(secondFallbackLinePhone),
              _count: { _all: 1 },
            },
          ]
        : [
            {
              linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(incomingLinePhone),
              _count: { _all: 1 },
            },
            {
              linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(firstFallbackLinePhone),
              _count: { _all: 1 },
            },
          ];
    });
    const hostedMemberIdentity = {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn(async () => {
        identityLookupCount += 1;
        if (identityLookupCount !== 4 || !createdMemberId) {
          return [];
        }

        return [{
          maskedPhoneNumberHint: "*** 4567",
          member: {
            billingStatus: HostedBillingStatus.not_started,
            createdAt: new Date("2026-03-26T00:00:00.000Z"),
            id: createdMemberId,
            suspendedAt: null,
            updatedAt: new Date("2026-03-26T00:00:00.000Z"),
          },
          memberId: createdMemberId,
          phoneLookupKey: createHostedPhoneLookupKey(memberPhone),
          phoneNumberEncrypted: null,
          phoneNumberVerifiedAt: null,
          privyUserIdEncrypted: null,
          signupPhoneCodeSendAttemptId: null,
          signupPhoneCodeSendAttemptStartedAt: null,
          signupPhoneCodeSentAt: null,
          signupPhoneNumberEncrypted: null,
          walletAddressEncrypted: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        }];
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async ({ create, update }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({
        ...create,
        ...update,
      })),
    };
    let inviteRecord: Record<string, unknown> | null = null;
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          inviteRecord = {
            ...data,
            sentAt: null,
            status: "pending",
          };
          return inviteRecord;
        }),
        findFirst: vi.fn(async () => inviteRecord),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          inviteRecord = {
            ...(inviteRecord ?? {}),
            ...data,
          };
          return inviteRecord;
        }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [
          {
            maxNewConversationsPerDay: 1,
            phoneNumber: incomingLinePhone,
          },
          {
            maxNewConversationsPerDay: 1,
            phoneNumber: firstFallbackLinePhone,
          },
          {
            maxNewConversationsPerDay: 2,
            phoneNumber: secondFallbackLinePhone,
          },
        ],
      }),
      hostedMember: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          createdMemberId = data.id;
          return {
            billingStatus: HostedBillingStatus.not_started,
            createdAt: new Date("2026-03-26T00:00:00.000Z"),
            id: data.id,
            suspendedAt: null,
            updatedAt: new Date("2026-03-26T00:00:00.000Z"),
          };
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberIdentity,
      hostedMemberRouting,
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

    const firstResponse = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_fallback_race_first",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });
    const secondResponse = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_fallback_race_second",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(firstResponse).toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });
    expect(secondResponse).toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });
    expect(createdMemberId).toEqual(expect.any(String));
    expect(prisma.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(hostedMemberIdentity.createMany).toHaveBeenCalledTimes(1);
    expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalledTimes(1);
    expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqChatLookupKey: null,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(firstFallbackLinePhone),
        pendingLinqChatLookupKey: null,
      }),
    }));
    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(mocks.createHostedLinqChat).toHaveBeenNthCalledWith(1, expect.objectContaining({
      from: firstFallbackLinePhone,
      idempotencyKey: `linq-invite-signup:${createdMemberId}:2026-03-26T00:00:00.000Z`,
      to: [memberPhone],
    }));
    expect(mocks.createHostedLinqChat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      from: firstFallbackLinePhone,
      idempotencyKey: `linq-invite-signup:${createdMemberId}:2026-03-26T00:00:00.000Z`,
      to: [memberPhone],
    }));
  });

  it("retries fallback signup delivery after provider failure instead of redirecting to the fallback line", async () => {
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const invite = {
      channel: "linq",
      id: "invite_fallback_retry",
      inviteCode: "code_fallback_retry",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
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
          id: "invite_fallback_retry",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [
          {
            phoneNumber: fallbackLinePhone,
          },
        ],
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting,
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const deliveryError = new Error("fallback provider unavailable");
    mocks.createHostedLinqChat
      .mockRejectedValueOnce(deliveryError)
      .mockResolvedValueOnce({
        chatId: "chat_fallback_retry",
        messageId: "provider_msg_fallback_retry",
      });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_degraded",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_fallback_retry_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("fallback provider unavailable");

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_degraded",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_fallback_retry_second_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_fallback_retry",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(mocks.createHostedLinqChat).toHaveBeenNthCalledWith(2, {
      from: fallbackLinePhone,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      message: expect.stringContaining("https://join.example.test/join/code_fallback_retry"),
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledTimes(1);
    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
  });

  it("re-emits fallback signup delivery after a terminal failed receipt reopens onboarding", async () => {
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const invite = {
      channel: "linq",
      id: "invite_fallback_receipt_retry",
      inviteCode: "code_fallback_receipt_retry",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    let onboardingLinkSentAt: Date | null = null;
    mocks.readHostedLinqDailyState.mockImplementation(async () =>
      makeHostedLinqDailyState({
        onboardingLinkSentAt,
      })
    );
    mocks.incrementHostedLinqInboundDailyState.mockImplementation(async () =>
      makeHostedLinqDailyState({
        onboardingLinkSentAt,
      })
    );
    mocks.markHostedLinqOnboardingLinkNoticeSent.mockImplementation(async () => {
      onboardingLinkSentAt = new Date("2026-03-26T12:00:01.000Z");
      return true;
    });
    mocks.releaseHostedLinqOnboardingLinkNoticeClaim.mockImplementation(async () => {
      onboardingLinkSentAt = null;
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    const effectId = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_fallback_receipt_retry",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqAlert: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqDelivery: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "hld_fallback_receipt_retry" }),
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: "hld_fallback_receipt_original",
            idempotencyKey: null,
            phoneNumberLookupKey: null,
            sourceRef: effectId,
            template: "invite_signup_fallback",
          })
          .mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [
          {
            phoneNumber: fallbackLinePhone,
          },
        ],
      }),
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting,
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

    await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_degraded",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_fallback_receipt_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });
    expect(onboardingLinkSentAt).toEqual(new Date("2026-03-26T12:00:01.000Z"));

    await ingestHostedLinqProviderEventTx({
      event: requireParsedHostedLinqProviderEvent(buildHostedLinqProviderReceiptEvent({
        eventId: "evt_fallback_receipt_failed",
        eventType: "message.failed",
        messageId: "provider_msg_fallback",
      })),
      prisma: prisma as never,
    });
    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_degraded",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_fallback_receipt_second_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T00:00:00.000Z",
      prisma,
    });
    expect(response).toMatchObject({
      inviteCode: "code_fallback_receipt_retry",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(mocks.createHostedLinqChat).toHaveBeenNthCalledWith(2, {
      from: fallbackLinePhone,
      idempotencyKey: effectId,
      message: expect.stringContaining("https://join.example.test/join/code_fallback_receipt_retry"),
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("keeps all-unassignable first-contact line routing ignored", async () => {
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
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
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [],
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting,
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_all_lines_unassignable_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "home-line-capacity-exhausted",
    });
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("ignores email-only first contact when fallback delivery has no member phone", async () => {
    const fallbackLinePhone = "+15550100001";
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
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
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [
          {
            phoneNumber: fallbackLinePhone,
          },
        ],
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberEmailAuthorization: {
        findMany: vi.fn().mockResolvedValue([{
          directPublicSenderAddressEncrypted: null,
          directPublicSenderAuthorizedAt: null,
          directPublicSenderLookupKey: null,
          member: {
            billingStatus: HostedBillingStatus.not_started,
            createdAt: new Date("2026-03-26T00:00:00.000Z"),
            id: "member_email",
            suspendedAt: null,
            updatedAt: new Date("2026-03-26T00:00:00.000Z"),
          },
          memberId: "member_email",
          stripeCheckoutEmailAddressEncrypted: null,
          stripeCheckoutEmailCollectedAt: null,
          verifiedEmailAddressEncrypted: null,
          verifiedEmailLookupKey: "hbidx:email:v1:test",
          verifiedEmailVerifiedAt: new Date("2026-03-25T00:00:00.000Z"),
        }]),
      },
      hostedMemberRouting,
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sender_handle: {
            handle: "buddy@example.test",
            id: "handle_sender_email_fallback",
            service: "iMessage",
          },
        },
        eventId: "evt_fallback_email_only_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unassignable-home-line",
    });
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
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
        message: expect.stringContaining("https://join.example.test/join/code_aborted"),
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
          accountGroupMemberships: [],
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
        message: expect.stringContaining("https://join.example.test/join/code_non_text"),
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
          accountGroupMemberships: [],
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
        message: expect.stringContaining("+15550100001"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
  });

  it("sends a deterministic Linq quota reply instead of the daily quota reply when the usage gate denies an active member", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
    }));
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
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
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
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
          accountGroupMemberships: [],
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
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member_123",
      noticeCode: "pulse_upgrade_edge",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        idempotencyKey: expectedIdempotencyKey,
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("sends an action-oriented Linq trial-expiry reply without claiming a usage-limit period", async () => {
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      reason: "trial_expired_pending_billing",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-04-08T12:15:00.000Z"),
      spentUsdMicros: 4_500_000n,
      userNotice: {
        code: "trial_conversion_pending",
        message: buildTrialConversionPendingMessage({
          memberId: "member_123",
          periodStart: new Date("2026-04-01T12:00:00.000Z"),
        }),
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
          accountGroupMemberships: [],
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
        eventId: "evt_trial_expired",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    });
    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        idempotencyKey: "linq-message:evt_trial_expired",
        message: buildTrialConversionPendingMessage({
          memberId: "member_123",
          periodStart: new Date("2026-04-01T12:00:00.000Z"),
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("sends Linq AI usage quota replies to the current inbound chat when the stored route is stale", async () => {
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
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
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
      },
    });
    const staleHomeRoute = {
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_stale_home",
      }),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: "+15550000000",
      }),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    };
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          routing: staleHomeRoute,
          suspendedAt: null,
        }),
      },
      hostedMemberRouting: (() => {
        let route = staleHomeRoute;
        return {
          findUnique: vi.fn().mockImplementation(async () =>
            withHostedMemberRoutingMember(route)
          ),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
            route = {
              ...route,
              ...create,
              ...update,
              memberId: "member_123",
            };
            return withHostedMemberRoutingMember(route);
          }),
        };
      })(),
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_current_inbound",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "sms",
            },
          },
        },
        eventId: "evt_ai_usage_limit_current_chat",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    });
    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_current_inbound",
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_stale_home",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("releases the Linq AI usage quota claim when current-chat delivery fails", async () => {
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
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
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
      },
    });
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_ai_usage_limit_send_failure",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("linq send failed");

    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma,
      sentAt: expect.any(Date),
    });
    const claimSentAt = mocks.claimHostedAiUsageLimitNotice.mock.calls[0]?.[0]?.sentAt;
    expect(claimSentAt).toBeInstanceOf(Date);
    expect(mocks.releaseHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart: "2026-03-01T00:00:00.000Z",
      prisma,
      sentAt: (claimSentAt as Date).toISOString(),
    });
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
  });

  it("sends Linq AI usage quota replies even after the daily quota notice is already marked", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
      quotaReplySentAt: new Date("2026-03-26T12:01:00.000Z"),
    }));
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
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
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
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
          accountGroupMemberships: [],
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
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    });
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member_123",
      noticeCode: "pulse_upgrade_edge",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        idempotencyKey: expectedIdempotencyKey,
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("suppresses repeat Linq AI usage quota replies after the usage-period notice is already claimed", async () => {
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValueOnce(false);
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
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
        message: buildPulseUpgradeEdgeMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
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
          accountGroupMemberships: [],
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
        eventId: "evt_ai_usage_limit_repeat_suppressed",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "ai-usage-gate-denied",
    });
    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma,
      sentAt: expect.any(Date),
    });
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
          accountGroupMemberships: [],
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
        message: expect.stringContaining("+15550100001"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
  });

  it("routes sparse webhook payloads when the saved home chat matches even if the incoming line is missing", async () => {
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
          accountGroupMemberships: [],
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
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_home",
          },
        },
        eventId: "evt_sparse_home",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "evt_sparse_home",
          userId: "member_123",
        }),
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
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

  it("refuses to rebind a member's home chat to a new chat id when the payload does not attest the chat is direct", async () => {
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
          accountGroupMemberships: [],
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

    // Same recipient line as the bound home, NEW chat id, and no is_group flag at all —
    // exactly what a group message would look like if the provider's flag went missing.
    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_possible_group",
            owner_handle: {
              handle: "+15550100001",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_unattested_rebind",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unattested-direct-chat",
    });
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rechecks the current home route under lock before binding an active Linq chat", async () => {
    const homeLinePhone = "+15550100001";
    const currentRoute = {
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_current",
      }),
      linqHomeLineAssignedAt: new Date("2026-03-26T11:30:00.000Z"),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: homeLinePhone,
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    };
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock(currentRoute);
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildHostedLinqLineFixture({
        phoneNumber: homeLinePhone,
      }),
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          routing: null,
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_possible_group",
            owner_handle: {
              handle: homeLinePhone,
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_stale_route_recheck",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "unattested-direct-chat",
    });
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("rebinds an active member's direct chat on the same owned line without consuming capacity", async () => {
    const homeLinePhone = "+15550100001";
    const assignedAt = new Date("2026-03-26T11:30:00.000Z");
    const routingRecord = {
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_home",
      }),
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: homeLinePhone,
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    };
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock(routingRecord);
    hostedMemberRouting.groupBy.mockImplementation(async () => {
      throw new Error("same-member same-line rebinds must reuse the existing claim");
    });
    const prisma = asPrismaTransactionClient({
      hostedLinqLine: buildHostedLinqLineFixture({
        activeMemberLimit: 1,
        maxNewConversationsPerDay: 1,
        phoneNumber: homeLinePhone,
      }),
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
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          routing: routingRecord,
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        chatIsGroup: false,
        data: {
          chat: {
            id: "chat_new",
            is_group: false,
            owner_handle: {
              handle: homeLinePhone,
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_direct_rebind_same_line",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalled();
    expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqHomeLineAssignedAt: assignedAt,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      }),
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_direct_rebind_same_line");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
          accountGroupMemberships: [],
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

  it("re-sends a first-contact signup link after a terminal failed receipt reopens onboarding", async () => {
    let onboardingLinkSentAt: Date | null = new Date("2026-03-26T12:00:01.000Z");
    mocks.readHostedLinqDailyState.mockImplementation(async () =>
      makeHostedLinqDailyState({
        onboardingLinkSentAt,
      })
    );
    mocks.incrementHostedLinqInboundDailyState.mockImplementation(async () =>
      makeHostedLinqDailyState({
        onboardingLinkSentAt,
      })
    );
    mocks.releaseHostedLinqOnboardingLinkNoticeClaim.mockImplementation(async () => {
      onboardingLinkSentAt = null;
    });
    const effectId = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    const hostedInviteCreate = vi.fn().mockResolvedValue({
      channel: "linq",
      id: "invite_reopened",
      inviteCode: "code_reopened",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    });
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            inviteCode: "code_reopened",
          }),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedLinqAlert: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqDelivery: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "hld_reopened_retry" }),
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: "hld_reopened_original",
            idempotencyKey: null,
            phoneNumberLookupKey: null,
            sourceRef: effectId,
            template: "invite_signup",
          })
          .mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLineFixture({
        phoneNumber: "+15550000000",
      }),
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
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

    await ingestHostedLinqProviderEventTx({
      event: requireParsedHostedLinqProviderEvent(buildHostedLinqProviderReceiptEvent({
        eventId: "evt_reopened_signup_failed",
        eventType: "message.failed",
        messageId: "provider_msg_123",
      })),
      prisma: prisma as never,
    });
    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_reopened_signup_next_inbound",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T00:00:00.000Z",
      prisma,
    });
    expect(response).toMatchObject({
      inviteCode: "code_reopened",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(hostedInviteCreate).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining("https://join.example.test/join/code_reopened"),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("does not let a stale pre-send signup notice claim suppress first reach-out", async () => {
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
          accountGroupMemberships: [],
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
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining("https://join.example.test/join/code_first_text"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markHostedLinqOnboardingLinkNoticeSent.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("reuses an existing pending home-line reservation when retrying an unsent signup link", async () => {
    const homeLinePhone = "+15550000000";
    const assignedAt = new Date("2026-03-26T12:00:00.000Z");
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(null);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState());
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: null,
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: homeLinePhone,
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.pending-linq-chat-id",
        memberId: "member_123",
        value: "chat_123",
      }),
      pendingLinqChatLookupKey: "lookup:chat_123",
      pendingLinqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.pending-linq-recipient-phone",
        memberId: "member_123",
        value: homeLinePhone,
      }),
      pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    hostedMemberRouting.groupBy.mockImplementation(async () => {
      throw new Error("retry should reuse the existing route reservation before recounting capacity");
    });
    const hostedInviteCreate = vi.fn().mockResolvedValue({
      channel: "linq",
      id: "invite_retry",
      inviteCode: "code_retry",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    });
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            inviteCode: "code_retry",
          }),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedLinqLine: buildHostedLinqLineFixture({
        maxNewConversationsPerDay: 1,
        phoneNumber: homeLinePhone,
      }),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
      hostedMemberRouting,
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
        eventId: "evt_signup_retry_reuses_reservation",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_retry",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(hostedInviteCreate).toHaveBeenCalled();
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalled();
    expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqHomeLineAssignedAt: assignedAt,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
        pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
      }),
    }));
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining("https://join.example.test/join/code_retry"),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("sends one daily quota reply after 100 active-member inbound messages", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
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
          accountGroupMemberships: [],
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
        message: expect.stringContaining(String(HOSTED_LINQ_DAILY_TEXT_LIMIT)),
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
  });

  it("uses the sent quota marker, not a pre-send claim, to suppress repeat quota replies", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
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
          accountGroupMemberships: [],
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

  it("keeps daily quota suppression ahead of repeat trial conversion notices", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
      quotaReplySentAt: new Date("2026-03-26T12:01:00.000Z"),
    }));
    mocks.checkHostedAiUsageGate.mockResolvedValueOnce({
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 0n,
      memberId: "member_123",
      periodEnd: new Date("2026-03-26T12:15:00.000Z"),
      periodStart: new Date("2026-03-26T12:00:00.000Z"),
      reason: "trial_expired_pending_billing",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-03-26T12:15:00.000Z"),
      spentUsdMicros: 0n,
      userNotice: {
        code: "trial_conversion_pending",
        message: buildTrialConversionPendingMessage({
          memberId: "member_123",
          periodStart: new Date("2026-03-26T12:00:00.000Z"),
        }),
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
          accountGroupMemberships: [],
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
        eventId: "evt_trial_conversion_after_daily_quota",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "daily-quota-reached",
    });
    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("releases the daily quota notice claim when inline active-member quota delivery fails", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
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
          accountGroupMemberships: [],
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
    expect(mocks.releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
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
          accountGroupMemberships: [],
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

function buildUnassignableHostedLinqLineFixture(): HostedLinqLineFixture {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ phoneNumberLookupKey: "lookup:line" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({ phoneNumberLookupKey: "lookup:line" }),
  };
}

function buildHostedLinqLineFixture(input: {
  activeMemberLimit?: number | null;
  maxNewConversationsPerDay?: number | null;
  phoneNumber: string;
}): HostedLinqLineFixture {
  return {
    findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } }) => {
      const lookupKeys = new Set(query.where?.phoneNumberLookupKey?.in ?? []);
      return (
        lookupKeys.size === 0
        || createHostedPhoneLookupKeyReadCandidates(input.phoneNumber).some((lookupKey) =>
          lookupKeys.has(lookupKey)
        )
      )
        ? [{
            activeMemberLimit: input.activeMemberLimit ?? null,
            assignmentWeight: 1,
            maxNewConversationsPerDay: input.maxNewConversationsPerDay ?? null,
            phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(input.phoneNumber),
            phoneNumberHint: `*** ${input.phoneNumber.slice(-4)}`,
            phoneNumberLookupKey: createHostedPhoneLookupKey(input.phoneNumber),
          }]
        : [];
    }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({
      phoneNumberLookupKey: createHostedPhoneLookupKey(input.phoneNumber),
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({
      phoneNumberLookupKey: createHostedPhoneLookupKey(input.phoneNumber),
    }),
  };
}

function buildHostedLinqLinePoolFixture(input: {
  lines: Array<{
    activeMemberLimit?: number | null;
    maxNewConversationsPerDay?: number | null;
    phoneNumber: string;
  }>;
}): HostedLinqLineFixture {
  const rows = input.lines.map((line) => ({
    activeMemberLimit: line.activeMemberLimit ?? null,
    assignmentWeight: 1,
    maxNewConversationsPerDay: line.maxNewConversationsPerDay ?? null,
    phoneNumber: line.phoneNumber,
    phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(line.phoneNumber),
    phoneNumberHint: `*** ${line.phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: createHostedPhoneLookupKey(line.phoneNumber),
  }));

  return {
    findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } } = {}) => {
      const lookupKeys = new Set(query.where?.phoneNumberLookupKey?.in ?? []);
      const matchingRows = lookupKeys.size > 0
        ? rows.filter((row) =>
            createHostedPhoneLookupKeyReadCandidates(row.phoneNumber).some((lookupKey) =>
              lookupKeys.has(lookupKey)
            )
          )
        : rows;

      return matchingRows.map(({ phoneNumber: _phoneNumber, ...row }) => row);
    }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({
      phoneNumberLookupKey: createHostedPhoneLookupKey(input.lines[0]?.phoneNumber ?? "+15550000000"),
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({
      phoneNumberLookupKey: createHostedPhoneLookupKey(input.lines[0]?.phoneNumber ?? "+15550000000"),
    }),
  };
}

function asPrismaTransactionClient<T extends PrismaFixtureBase>(
  prisma: T,
): T & HostedOnboardingLinqWebhookPrismaFixture {
  const hostedInvite = prisma.hostedInvite;
  const hostedLinqDailyState = prisma.hostedLinqDailyState;
  const hostedLinqAlert = prisma.hostedLinqAlert;
  const hostedLinqDelivery = prisma.hostedLinqDelivery;
  const hostedLinqFirstContactAdmissionBudget = prisma.hostedLinqFirstContactAdmissionBudget;
  const hostedLinqFirstContactAdmissionDecision = prisma.hostedLinqFirstContactAdmissionDecision;
  const hostedLinqLine = prisma.hostedLinqLine;
  const hostedLinqProviderEvent = prisma.hostedLinqProviderEvent;
  const hostedMemberIdentity = prisma.hostedMemberIdentity;
  const hostedMemberRouting = prisma.hostedMemberRouting;
  const hostedMember = prisma.hostedMember;
  const hostedMemberEmailAuthorization = prisma.hostedMemberEmailAuthorization;

  prisma.$executeRaw ??= vi.fn(async () => 0);
  prisma.$queryRaw ??= vi.fn(async () => []);

  if (!hostedLinqProviderEvent?.createMany) {
    Object.defineProperty(prisma, "hostedLinqProviderEvent", {
      configurable: true,
      value: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
  }

  if (
    !hostedLinqLine?.upsert
    || !hostedLinqLine.update
    || !hostedLinqLine.findUnique
    || !hostedLinqLine.findMany
  ) {
    Object.defineProperty(prisma, "hostedLinqLine", {
      configurable: true,
      value: {
        findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } }) => {
          const lookupKeys = new Set(query.where?.phoneNumberLookupKey?.in ?? []);
          return [
            "+15550000000",
            "+15550100001",
            "+15550100002",
            "+15551234567",
            "+15559876543",
            "+15559999999",
          ].flatMap((phoneNumber) =>
            (
              lookupKeys.size === 0
              || createHostedPhoneLookupKeyReadCandidates(phoneNumber).some((lookupKey) =>
                lookupKeys.has(lookupKey)
              )
            )
              ? [{
                  activeMemberLimit: null,
                  assignmentWeight: 1,
                  maxNewConversationsPerDay: null,
                  phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
                  phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
                  phoneNumberLookupKey: createHostedPhoneLookupKey(phoneNumber),
                }]
              : []
          );
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation((input: { where?: { phoneNumberLookupKey?: string } }) =>
          Promise.resolve({
            phoneNumberLookupKey: input.where?.phoneNumberLookupKey ?? "hbidx:phone:updated",
          })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) =>
          Promise.resolve({
            phoneNumberLookupKey: input.create.phoneNumberLookupKey,
          })),
      },
    });
  }

  if (!hostedLinqDelivery?.findUnique || !hostedLinqDelivery.findFirst) {
    Object.defineProperty(prisma, "hostedLinqDelivery", {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue({ id: "hld_random" }),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn().mockResolvedValue({ id: "hld_123" }),
      },
    });
  } else if (!hostedLinqDelivery.findMany) {
    hostedLinqDelivery.findMany = vi.fn().mockResolvedValue([]);
  }

  if (!hostedLinqAlert?.createMany) {
    Object.defineProperty(prisma, "hostedLinqAlert", {
      configurable: true,
      value: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
  }

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
      value: createStatefulHostedMemberRoutingMock(),
    });
  } else if (!hostedMemberRouting.findFirst && hostedMemberRouting.findUnique) {
    hostedMemberRouting.findFirst = hostedMemberRouting.findUnique;
  }
  if (prisma.hostedMemberRouting && !prisma.hostedMemberRouting.createMany) {
    prisma.hostedMemberRouting.createMany = vi.fn().mockResolvedValue({ count: 1 });
  }
  if (prisma.hostedMemberRouting && !prisma.hostedMemberRouting.updateMany) {
    prisma.hostedMemberRouting.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  }
  if (prisma.hostedMemberRouting && !prisma.hostedMemberRouting.groupBy) {
    prisma.hostedMemberRouting.groupBy = vi.fn().mockResolvedValue([]);
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
  } else if (!prisma.hostedThreadRoute.updateMany) {
    prisma.hostedThreadRoute.updateMany = vi.fn().mockResolvedValue({ count: 1 });
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

  if (!prisma.hostedAccountGroupMembership?.findFirst) {
    Object.defineProperty(prisma, "hostedAccountGroupMembership", {
      configurable: true,
      value: {
        findFirst: vi.fn().mockResolvedValue(null),
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

  if (!hostedLinqFirstContactAdmissionDecision?.findUnique || !hostedLinqFirstContactAdmissionDecision?.createMany) {
    const decisionRecords = new Map<string, Record<string, unknown>>();
    Object.defineProperty(prisma, "hostedLinqFirstContactAdmissionDecision", {
      configurable: true,
      value: {
        createMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.eventId === "string") {
            decisionRecords.set(data.eventId, data);
          }
          return { count: 1 };
        }),
        findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
          decisionRecords.get(where.eventId) ?? null,
        ),
      },
    });
  }

  if (
    !hostedLinqFirstContactAdmissionBudget?.findFirst
    || !hostedLinqFirstContactAdmissionBudget?.create
    || !hostedLinqFirstContactAdmissionBudget?.count
  ) {
    Object.defineProperty(prisma, "hostedLinqFirstContactAdmissionBudget", {
      configurable: true,
      value: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
  }

  return prisma as T & HostedOnboardingLinqWebhookPrismaFixture;
}

function createStatefulHostedMemberRoutingMock(initialRecord: Record<string, unknown> | null = null) {
  let hostedMemberRoutingRecord = initialRecord;
  return {
    findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const record = withHostedMemberRoutingMember(hostedMemberRoutingRecord);
      if (!record) {
        return null;
      }
      const excluded = where?.NOT;
      if (
        typeof excluded === "object"
        && excluded !== null
        && "memberId" in excluded
        && record.memberId === (excluded as { memberId?: unknown }).memberId
      ) {
        return null;
      }
      if (typeof where?.memberId === "string" && record.memberId !== where.memberId) {
        return null;
      }
      return record;
    }),
    findMany: vi.fn(async () => {
      const record = withHostedMemberRoutingMember(hostedMemberRoutingRecord);
      return record ? [record] : [];
    }),
    findUnique: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      if (!hostedMemberRoutingRecord) {
        return null;
      }
      if (
        typeof where?.memberId === "string"
        && hostedMemberRoutingRecord.memberId !== where.memberId
      ) {
        return null;
      }
      return withHostedMemberRoutingMember(hostedMemberRoutingRecord);
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    groupBy: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(async ({ create, update }: {
      create: Record<string, unknown>;
      update?: Record<string, unknown>;
    }) => {
      hostedMemberRoutingRecord = {
        ...create,
        ...(update ?? {}),
      };
      return hostedMemberRoutingRecord;
    }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
}

function withHostedMemberRoutingMember(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!record || record.member) {
    return record;
  }
  const memberId = typeof record.memberId === "string" ? record.memberId : "member_123";
  return {
    ...record,
    member: {
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-03-26T00:00:00.000Z"),
      id: memberId,
      suspendedAt: null,
      updatedAt: new Date("2026-03-26T00:00:00.000Z"),
    },
  };
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

function buildHostedLinqWebhookBody(input: {
  chatIsGroup?: boolean;
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
        ...(input.chatIsGroup === undefined ? {} : { is_group: input.chatIsGroup }),
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

function buildHostedLinqProviderReceiptEvent(input: {
  createdAt?: string;
  eventId: string;
  eventType: "message.delivered" | "message.failed";
  messageId: string;
}): HostedLinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-26T12:00:02.000Z",
    data: {
      error: input.eventType === "message.failed"
        ? {
            code: "30007",
            message: "carrier filtered",
          }
        : undefined,
      message_id: input.messageId,
      phone_number: "+15550000000",
      service: "iMessage",
    },
    event_id: input.eventId,
    event_type: input.eventType,
    trace_id: "trace_delivery_receipt",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}

function requireParsedHostedLinqProviderEvent(event: HostedLinqWebhookEvent) {
  const parsed = parseHostedLinqProviderEvent({
    event,
    rawBody: JSON.stringify(event),
  });
  if (!parsed) {
    throw new TypeError("Expected hosted Linq provider receipt event to parse.");
  }

  return parsed;
}

function buildTypingWebhookBody(input: {
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
