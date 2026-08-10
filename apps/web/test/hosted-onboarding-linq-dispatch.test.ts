import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedAiUsageGateDecision } from "@/src/lib/hosted-execution/usage-allowance";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { buildHostedMemberRoutingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
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

type HostedRuntimeAiAccessDecisionReader =
  typeof import("@/src/lib/hosted-onboarding/member-access").readHostedRuntimeAiAccessDecision;

const mocks = vi.hoisted(() => {
  const state = {
    deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
    claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
    readHostedLinqDeliveryProviderDispatchIntentTx: vi.fn(),
    claimHostedLinqOnboardingLinkNotice: vi.fn(),
    claimHostedLinqQuotaReplyNotice: vi.fn(),
    markHostedLinqOnboardingLinkNoticeSent: vi.fn(),
    classifyHostedLinqFirstContactAdmission: vi.fn(),
    ensureHostedLinqInstantStartPulseTrialEnrollment: vi.fn(),
    runHostedLinqInstantStartDeferredActivationWakeBestEffort: vi.fn(),
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
      linqInstantStartPhonePrefixes: ["+44"] as readonly string[],
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
    readHostedRuntimeAiAccessDecisionActual:
      null as HostedRuntimeAiAccessDecisionReader | null,
    readHostedRuntimeAiAccessDecision: vi.fn<HostedRuntimeAiAccessDecisionReader>(),
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
    checkHostedAiUsageGate: vi.fn(async (): Promise<HostedAiUsageGateDecision> => ({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 100_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    })),
    getHostedLinqChatSummary: vi.fn(async (): Promise<{
      handles: string[];
      isGroup: boolean | null;
    }> => ({
      handles: [],
      isGroup: false,
    })),
    logHostedOnboardingDiagnostic: vi.fn(),
    sendHostedLinqChatMessage: vi.fn(),
    createHostedLinqChat: vi.fn(),
    sendHostedLinqReadReceipt: vi.fn(),
    startHostedLinqChatTypingIndicator: vi.fn(),
    stopHostedLinqChatTypingIndicator: vi.fn(),
    shareMurphHostedLinqNativeContactCardToChat: vi.fn().mockResolvedValue({
      status: "sent",
    }),
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
    planHostedLinqMessageEditedWebhook: vi.fn(),
    appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
      dispatch?: { eventId: string };
      envelope?: { eventId: string };
      eventId?: string;
      tx?: unknown;
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
    appendHostedMailboxEnvelopeWithSourceMessageTx: vi.fn(),
    materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
    acceptHostedFamilyInviteFromPhoneTx: vi.fn(),
    buildHostedFamilyInviteAcceptedReplyText: vi.fn(() => "Welcome to Murph Family."),
    resolveHostedFamilyInviteTokenForInbound: vi.fn(),
    resolveHostedLinqMailboxPayloadRootPrewarmMemberId: vi.fn(async () => null),
    resolveHostedLinqTypingPrewarmMemberId:
      vi.fn(async (): Promise<string | null> => null),
  };

  return state;
});

const HOME_REDIRECT_EXPLICIT_RESEND_PATTERN =
  /\b(?:resend (?:(?:the|this|your)(?: last)? message|what you just wrote)|send (?:(?:the|this|your)(?: last)? message|that)(?: again)?|that message can't move between threads\. resend it to the number above)\b/iu;

function expectHostedLinqPointerSignalAccepted(eventId = "evt_123", userId = "member_123"): void {
  expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
    abortSignal: expect.any(AbortSignal),
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
    appendHostedMailboxEnvelopeWithSourceMessageTx:
      mocks.appendHostedMailboxEnvelopeWithSourceMessageTx,
    readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/webhook-provider-linq")
  >();
  return {
    ...actual,
    planHostedLinqMessageEditedWebhook:
      mocks.planHostedLinqMessageEditedWebhook,
    resolveHostedLinqMailboxPayloadRootPrewarmMemberId:
      mocks.resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
    resolveHostedLinqTypingPrewarmMemberId:
      mocks.resolveHostedLinqTypingPrewarmMemberId,
  };
});

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
}));

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

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/member-access")>(
    "@/src/lib/hosted-onboarding/member-access",
  );
  mocks.readHostedRuntimeAiAccessDecisionActual = actual.readHostedRuntimeAiAccessDecision;

  return {
    ...actual,
    readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    ...actual,
    claimHostedLinqDeliveryProviderDispatchTx: mocks.claimHostedLinqDeliveryProviderDispatchTx,
    readHostedLinqDeliveryProviderDispatchIntentTx:
      mocks.readHostedLinqDeliveryProviderDispatchIntentTx,
  };
});

// Keep this mock self-contained: importing the actual module here can expose
// this mocked namespace to another serialized file in the CI Vitest project.
vi.mock("@/src/lib/hosted-onboarding/linq-contact-card-share", () => ({
  isHostedLinqContactCardAutoShareEligible: (input: { service: string | null }) =>
    input.service?.trim().toLowerCase() === "imessage",
  shareMurphHostedLinqNativeContactCardToChat:
    mocks.shareMurphHostedLinqNativeContactCardToChat,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-allowance")
  >("@/src/lib/hosted-execution/usage-allowance");
  return {
    ...actual,
    checkHostedAiUsageGate: mocks.checkHostedAiUsageGate,
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

vi.mock("@/src/lib/hosted-onboarding/auto-trial-enrollment-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/auto-trial-enrollment-service")
  >("@/src/lib/hosted-onboarding/auto-trial-enrollment-service");
  return {
    ...actual,
    ensureHostedLinqInstantStartPulseTrialEnrollment:
      mocks.ensureHostedLinqInstantStartPulseTrialEnrollment,
    runHostedLinqInstantStartDeferredActivationWakeBestEffort:
      mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort,
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
    getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
    startHostedLinqChatTypingIndicator: mocks.startHostedLinqChatTypingIndicator,
    stopHostedLinqChatTypingIndicator: mocks.stopHostedLinqChatTypingIndicator,
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
  prepareHostedCryptoDomainRootCandidates: vi.fn(async () => new Map()),
  prewarmPreparedHostedCryptoDomainRootForWeb: vi.fn(async () => undefined),
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
  provisionPreparedHostedCryptoDomainRootsTx: vi.fn(async () => undefined),
  unwrapHostedDomainRootForWeb: vi.fn(async () => ({
    rootKey: new Uint8Array(32),
  })),
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
    logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
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
  findMany?: MockedFunction;
  findUnique?: MockedFunction;
};

type HostedLinqFirstContactAdmissionDecisionFixture = {
  createMany?: MockedFunction;
  findMany?: MockedFunction;
  findUnique?: MockedFunction;
};

type HostedLinqFirstContactAdmissionBudgetFixture = {
  count?: MockedFunction;
  create?: MockedFunction;
  findFirst?: MockedFunction;
  findMany?: MockedFunction;
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
  hostedGroupJoinOutreach?: {
    findMany?: MockedFunction;
    updateMany?: MockedFunction;
  };
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
    findFirst?: MockedFunction;
    findMany?: MockedFunction;
    groupBy?: MockedFunction;
    updateMany?: MockedFunction;
  };
  hostedUsageReferral?: {
    findUnique?: MockedFunction;
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
    const actualReadHostedRuntimeAiAccessDecision =
      mocks.readHostedRuntimeAiAccessDecisionActual;
    if (!actualReadHostedRuntimeAiAccessDecision) {
      throw new Error("Expected the hosted runtime access reader test implementation.");
    }
    mocks.readHostedRuntimeAiAccessDecision.mockReset();
    mocks.readHostedRuntimeAiAccessDecision.mockImplementation(
      actualReadHostedRuntimeAiAccessDecision,
    );
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "hld_claimed",
    });
    mocks.readHostedLinqDeliveryProviderDispatchIntentTx.mockResolvedValue(null);
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.markHostedLinqOnboardingLinkNoticeSent.mockResolvedValue(true);
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValue({
      confidence: 0.9,
      kind: "allow",
      source: "model",
    });
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockResolvedValue({
      deferredActivationWake: {
        hostedExecutionEventId: "member.activated:instant-start",
        memberId: "member_123",
      },
      redirectPath: "/home",
      status: "enrolled",
    });
    mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort
      .mockResolvedValue(undefined);
    mocks.releaseHostedLinqOnboardingLinkNoticeClaim.mockResolvedValue(undefined);
    mocks.releaseHostedLinqQuotaReplyNoticeClaim.mockResolvedValue(undefined);
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValue(makeHostedLinqDailyState());
    mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(makeHostedLinqDailyState({
      outboundCount: 1,
    }));
    mocks.checkHostedAiUsageGate.mockReset();
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockResolvedValue(null);
    mocks.buildHostedFamilyInviteAcceptedReplyText.mockReturnValue("Welcome to Murph Family.");
    mocks.readHostedLinqDailyState.mockResolvedValue(null);
    mocks.hostedOnboardingEnvironment.linqLocalAllowedInboundPhoneNumbers = undefined;
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "off";
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+44"];
    mocks.checkHostedAiUsageGate.mockResolvedValue({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 100_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
    mocks.startHostedLinqChatTypingIndicator.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.stopHostedLinqChatTypingIndicator.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.appendHostedMailboxEnvelopeWithSourceMessageTx.mockImplementation(
      async (input: { envelope: { eventId: string }; tx: unknown }) =>
        mocks.appendHostedMailboxEnvelopeTx({
          envelope: input.envelope,
          tx: input.tx,
        }),
    );
    mocks.planHostedLinqMessageEditedWebhook.mockResolvedValue({
      desiredSideEffects: [],
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-message-edit",
      },
      wakeHandoffs: [{
        eventId: "evt_edit_123",
        linqChatId: "chat_123",
        mailboxItemId: "mailbox_evt_edit_123",
        source: "linq",
        userId: "member_123",
      }],
    });
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
    // clearAllMocks preserves queued one-shot implementations from an aborted test.
    mocks.shareMurphHostedLinqNativeContactCardToChat.mockReset();
    mocks.shareMurphHostedLinqNativeContactCardToChat.mockResolvedValue({
      status: "sent",
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

  it("acknowledges Linq typing before resolving the best-effort shell prewarm", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];
    const prewarmRuntimeShell = vi.fn(async () => ({ accepted: true as const }));
    mocks.resolveHostedLinqTypingPrewarmMemberId.mockResolvedValueOnce("member_typing");
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: vi.fn(),
      prewarmRuntimeShell,
    });
    const response = await handleHostedOnboardingLinqWebhook({
      prisma: asPrismaTransactionClient({}),
      rawBody: buildTypingWebhookBody(),
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
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
    expect(prewarmRuntimeShell).not.toHaveBeenCalled();
    expect(afterResponseTasks).toHaveLength(1);

    await Promise.all(afterResponseTasks.map((task) => task()));

    expect(mocks.resolveHostedLinqTypingPrewarmMemberId).toHaveBeenCalledWith({
      event: expect.objectContaining({
        data: {
          chat_id: "chat_typing_123",
        },
        event_type: "chat.typing_indicator.started",
      }),
      prisma: expect.any(Object),
    });
    expect(prewarmRuntimeShell).toHaveBeenCalledWith("member_typing");
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("keeps unresolved Linq typing hints best-effort and process-free", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];
    const prewarmRuntimeShell = vi.fn(async () => ({ accepted: true as const }));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: vi.fn(),
      prewarmRuntimeShell,
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: asPrismaTransactionClient({}),
      rawBody: buildTypingWebhookBody(),
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      reason: "typing-ignored",
    });

    await Promise.all(afterResponseTasks.map((task) => task()));

    expect(prewarmRuntimeShell).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("settles Linq typing lookup failures after acknowledgement", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];
    const prewarmRuntimeShell = vi.fn(async () => ({ accepted: true as const }));
    mocks.resolveHostedLinqTypingPrewarmMemberId.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "LINQ_HOME_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
        httpStatus: 500,
        message: "Hosted Linq prewarm lookup matched multiple members.",
        retryable: true,
      }),
    );
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: vi.fn(),
      prewarmRuntimeShell,
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: asPrismaTransactionClient({}),
      rawBody: buildTypingWebhookBody(),
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      reason: "typing-ignored",
    });

    await expect(Promise.all(afterResponseTasks.map((task) => task())))
      .resolves.toEqual([undefined]);
    expect(prewarmRuntimeShell).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("rejects malformed Linq typing events before scheduling a hint", async () => {
    const scheduleAfterResponse = vi.fn();

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: asPrismaTransactionClient({}),
      rawBody: JSON.stringify({
        api_version: "v3",
        created_at: "2026-03-26T12:00:00.000Z",
        data: {},
        event_id: "evt_typing_invalid",
        event_type: "chat.typing_indicator.started",
      }),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_PAYLOAD_INVALID",
      httpStatus: 400,
    });

    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(mocks.resolveHostedLinqTypingPrewarmMemberId).not.toHaveBeenCalled();
  });

  it("routes message edits through the narrow correction planner without a read receipt", async () => {
    const prisma = asPrismaTransactionClient({});
    const scheduleAfterResponse = vi.fn();
    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify({
        api_version: "v3",
        created_at: "2026-07-28T18:01:00.000Z",
        data: {
          chat: { id: "chat_123" },
          direction: "inbound",
          edited_at: "2026-07-28T18:01:00.000Z",
          id: "msg_123",
          part: {
            index: 0,
            text: "Corrected question",
          },
          sender_handle: {
            handle: "+15551234567",
            id: "handle_sender_edit_123",
            is_me: false,
            service: "iMessage",
          },
        },
        event_id: "evt_edit_123",
        event_type: "message.edited",
        webhook_version: "2026-02-03",
      }),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: false,
      ok: true,
      reason: "wake-appended-message-edit",
    });
    expect(mocks.planHostedLinqMessageEditedWebhook).toHaveBeenCalledWith({
      event: expect.objectContaining({
        event_id: "evt_edit_123",
        event_type: "message.edited",
      }),
      prisma,
    });
    expectHostedLinqPointerSignalAccepted("evt_edit_123");
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(scheduleAfterResponse).toHaveBeenCalledTimes(2);
  });

  it.each([
    { chatId: "chat_signup_direct", threadKind: "direct" },
    { chatId: "chat_signup_group", threadKind: "group" },
  ])(
    "shares a delivered invite_signup contact card exactly once in the correlated $threadKind chat",
    async ({ chatId }: { chatId: string }) => {
      const effectId = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
      const prisma = createHostedLinqDeliveryReceiptWebhookPrisma({
        providerEventCreateCounts: [1, 0],
        receiptUpdateCounts: [1],
        sourceRef: effectId,
        template: "invite_signup",
      });
      const shareControl: { resolve?: () => void } = {};
      const pendingShare = new Promise<{ status: "sent" }>((resolve) => {
        shareControl.resolve = () => resolve({ status: "sent" });
      });
      mocks.shareMurphHostedLinqNativeContactCardToChat.mockReturnValueOnce(pendingShare);
      const scheduledTasks: Array<() => Promise<void>> = [];
      const scheduleAfterResponse = vi.fn((task: () => Promise<void>) => {
        scheduledTasks.push(task);
      });
      const event = buildHostedLinqProviderReceiptEvent({
        chatId,
        eventId: `evt_delivered_${chatId}`,
        eventType: "message.delivered",
        messageId: `provider_msg_${chatId}`,
      });

      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: JSON.stringify(event),
        scheduleAfterResponse,
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ignored: true,
        ok: true,
        reason: "recorded-linq-provider-event:message.delivered",
      });
      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: JSON.stringify(event),
        scheduleAfterResponse,
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        duplicate: true,
        ignored: true,
        ok: true,
        reason: "duplicate-linq-provider-event",
      });

      expect(mocks.shareMurphHostedLinqNativeContactCardToChat).not.toHaveBeenCalled();
      expect(scheduledTasks).toHaveLength(1);
      const [scheduledTask] = scheduledTasks;
      if (!scheduledTask) {
        throw new Error("Expected a delivered-signup contact-card task.");
      }
      let scheduledTaskSettled = false;
      const scheduledTaskPromise = scheduledTask().finally(() => {
        scheduledTaskSettled = true;
      });

      await vi.waitFor(() => {
        expect(mocks.shareMurphHostedLinqNativeContactCardToChat).toHaveBeenCalledTimes(1);
      });
      expect(scheduledTaskSettled).toBe(false);
      const resolveShare = shareControl.resolve;
      if (!resolveShare) {
        throw new Error("Expected the delivered-signup contact-card share to start.");
      }
      resolveShare();
      await expect(scheduledTaskPromise).resolves.toBeUndefined();
      expect(scheduledTaskSettled).toBe(true);

      expect(mocks.shareMurphHostedLinqNativeContactCardToChat).toHaveBeenCalledTimes(1);
      expect(mocks.shareMurphHostedLinqNativeContactCardToChat).toHaveBeenCalledWith({
        chatId,
        memberId: "member_123",
        prisma,
      });
    },
  );

  it.each([
    {
      data: {
        chat: {
          health_status: {
            status: "CRITICAL",
            updated_at: "2026-05-04T10:15:11.000Z",
          },
          id: "chat_icon_nested_ignored",
          owner_handle: {
            handle: "+15550999999",
            service: "iMessage",
          },
        },
        chat_id: "chat_icon_123",
        new_value: "https://media.example.test/private/new-token",
        old_value: "https://media.example.test/private/old-token",
        updated_at: "2026-05-04T10:15:12.000Z",
      },
      eventType: "chat.group_icon_updated",
      expectedFailureCode: null,
      expectedProviderStatus: "updated",
    },
    {
      data: {
        chat_id: "chat_icon_123",
        error_code: 3007,
        failed_at: "2026-05-04T10:15:13.000Z",
      },
      eventType: "chat.group_icon_update_failed",
      expectedFailureCode: "3007",
      expectedProviderStatus: "failed",
    },
  ])(
    "records $eventType as a privacy-minimized provider event",
    async ({ data, eventType, expectedFailureCode, expectedProviderStatus }) => {
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = asPrismaTransactionClient({
        hostedLinqProviderEvent: {
          createMany,
        },
      });
      prisma.$transaction = vi.fn(async (
        operation: (
          transaction: HostedOnboardingLinqWebhookPrismaFixture,
        ) => Promise<unknown>,
      ) => operation(prisma));
      const event = {
        api_version: "v3",
        created_at: "2026-05-04T10:15:10.000Z",
        data,
        event_id: `evt_${eventType}`,
        event_type: eventType,
        trace_id: "trace_group_icon_outcome",
        webhook_version: "2026-02-03",
      } as HostedLinqWebhookEvent;

      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: JSON.stringify(event),
        signature: null,
        timestamp: null,
      })).resolves.toEqual({
        ignored: true,
        ok: true,
        reason: `recorded-linq-provider-event:${eventType}`,
      });

      expect(createMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chatHealthStatus: null,
          chatHealthUpdatedAt: null,
          eventType,
          failureCode: expectedFailureCode,
          phoneNumberLookupKey: null,
          providerStatus: expectedProviderStatus,
        }),
        skipDuplicates: true,
      });
      const persistedData = JSON.stringify(createMany.mock.calls);
      expect(persistedData).not.toContain("new-token");
      expect(persistedData).not.toContain("old-token");
      expect(persistedData).not.toContain("+15550999999");
      expect(prisma.hostedLinqAlert?.createMany).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine?.update).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine?.updateMany).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine?.upsert).not.toHaveBeenCalled();
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({ step: "hosted-onboarding.webhook.linq" }),
        "completed",
        expect.objectContaining({
          chatIdSuffix: "on_123",
          eventType,
          failureCode: expectedFailureCode,
          providerStatus: expectedProviderStatus,
        }),
      );
      expect(JSON.stringify(mocks.finishHostedOnboardingTiming.mock.calls))
        .not.toContain("+15550999999");
    },
  );

  it.each([
    {
      data: {
        chat_id: "chat_unrelated_failed",
        error: { code: "4001" },
        message_id: "provider_msg_unrelated_failed",
      },
      eventType: "message.failed",
    },
    {
      data: {
        changed_at: "2026-05-04T10:15:13.000Z",
        new_status: "ACTIVE",
        phone_number: "+15550000000",
      },
      eventType: "phone_number.status_updated",
    },
  ])(
    "keeps group-icon timing fields off $eventType diagnostics",
    async ({ data, eventType }) => {
      const prisma = asPrismaTransactionClient({});
      prisma.$transaction = vi.fn(async (
        operation: (
          transaction: HostedOnboardingLinqWebhookPrismaFixture,
        ) => Promise<unknown>,
      ) => operation(prisma));
      const event = {
        api_version: "v3",
        created_at: "2026-05-04T10:15:10.000Z",
        data,
        event_id: `evt_${eventType}`,
        event_type: eventType,
        trace_id: "trace_unrelated_provider_event",
        webhook_version: "2026-02-03",
      } as HostedLinqWebhookEvent;

      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: JSON.stringify(event),
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ignored: true,
        ok: true,
      });

      const completedTiming = mocks.finishHostedOnboardingTiming.mock.calls.find(
        ([handle, outcome]) =>
          handle.step === "hosted-onboarding.webhook.linq"
          && outcome === "completed",
      );
      expect(completedTiming).toBeDefined();
      expect(completedTiming?.[2]).not.toHaveProperty("chatIdSuffix");
      expect(completedTiming?.[2]).not.toHaveProperty("failureCode");
      expect(completedTiming?.[2]).not.toHaveProperty("providerStatus");
    },
  );

  it("shares a delivered invite_signup_fallback contact card once in the newly created chat", async () => {
    const prisma = createHostedLinqDeliveryReceiptWebhookPrisma({
      providerEventCreateCounts: [1, 0],
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      template: "invite_signup_fallback",
    });
    const scheduledTasks: Array<() => Promise<void>> = [];
    const scheduleAfterResponse = vi.fn((task: () => Promise<void>) => {
      scheduledTasks.push(task);
    });
    const event = buildHostedLinqProviderReceiptEvent({
      chatId: "chat_fallback",
      eventId: "evt_delivered_fallback",
      eventType: "message.delivered",
      messageId: "provider_msg_fallback",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify(event),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "recorded-linq-provider-event:message.delivered",
    });
    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify(event),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-linq-provider-event",
    });

    expect(scheduledTasks).toHaveLength(1);
    const [scheduledTask] = scheduledTasks;
    if (!scheduledTask) {
      throw new Error("Expected a delivered-fallback contact-card task.");
    }
    await scheduledTask();
    expect(mocks.shareMurphHostedLinqNativeContactCardToChat).toHaveBeenCalledTimes(1);
    expect(mocks.shareMurphHostedLinqNativeContactCardToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_fallback",
        memberId: "member_123",
      }),
    );
  });

  it.each([
    {
      eventId: "evt_sent_signup",
      eventType: "message.sent" as const,
      expectedScheduledTaskCount: 0,
      label: "message.sent",
      providerEventCreateCounts: [1],
      receiptUpdateCounts: [1],
    },
    {
      eventId: "evt_failed_signup",
      eventType: "message.failed" as const,
      expectedScheduledTaskCount: 1,
      label: "message.failed",
      providerEventCreateCounts: [1],
      receiptUpdateCounts: [1],
    },
    {
      eventId: "evt_duplicate_signup",
      eventType: "message.delivered" as const,
      expectedScheduledTaskCount: 0,
      label: "duplicate",
      providerEventCreateCounts: [0],
      receiptUpdateCounts: [1],
    },
    {
      createdAt: "2026-03-26T11:59:00.000Z",
      eventId: "evt_stale_signup",
      eventType: "message.delivered" as const,
      expectedScheduledTaskCount: 0,
      label: "stale",
      providerEventCreateCounts: [1],
      receiptUpdateCounts: [0],
    },
    {
      createdAt: "2026-03-26T12:00:02.000Z",
      eventId: "evt_non_advancing_signup",
      eventType: "message.delivered" as const,
      expectedScheduledTaskCount: 0,
      label: "non-advancing",
      providerEventCreateCounts: [1],
      receiptUpdateCounts: [0],
    },
    {
      eventId: "evt_delivered_non_invite",
      eventType: "message.delivered" as const,
      expectedScheduledTaskCount: 0,
      label: "non-invite template",
      providerEventCreateCounts: [1],
      receiptUpdateCounts: [1],
      template: "ai_usage_quota" as const,
    },
  ])(
    "does not share for a $label delivery event",
    async ({
      createdAt,
      eventId,
      eventType,
      expectedScheduledTaskCount,
      providerEventCreateCounts,
      receiptUpdateCounts,
      template = "invite_signup",
    }: {
      createdAt?: string;
      eventId: string;
      eventType: "message.delivered" | "message.failed" | "message.sent";
      expectedScheduledTaskCount: number;
      providerEventCreateCounts: readonly number[];
      receiptUpdateCounts: readonly number[];
      template?: "ai_usage_quota" | "invite_signup";
    }) => {
      const prisma = createHostedLinqDeliveryReceiptWebhookPrisma({
        providerEventCreateCounts,
        receiptUpdateCounts,
        sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
        template,
      });
      const scheduledTasks: Array<() => Promise<void>> = [];
      const scheduleAfterResponse = vi.fn((task: () => Promise<void>) => {
        scheduledTasks.push(task);
      });

      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: JSON.stringify(buildHostedLinqProviderReceiptEvent({
          chatId: "chat_signup_no_share",
          createdAt,
          eventId,
          eventType,
          messageId: "provider_msg_no_share",
        })),
        scheduleAfterResponse,
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ignored: true,
        ok: true,
      });

      expect(scheduledTasks).toHaveLength(expectedScheduledTaskCount);
      for (const scheduledTask of scheduledTasks) {
        await scheduledTask();
      }
      expect(mocks.shareMurphHostedLinqNativeContactCardToChat).not.toHaveBeenCalled();
    },
  );

  it("does not share a delivered signup contact card over SMS", async () => {
    const prisma = createHostedLinqDeliveryReceiptWebhookPrisma({
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      template: "invite_signup",
    });
    const scheduleAfterResponse = vi.fn();

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify(buildHostedLinqProviderReceiptEvent({
        chatId: "chat_signup_sms",
        eventId: "evt_delivered_signup_sms",
        eventType: "message.delivered",
        messageId: "provider_msg_signup_sms",
        service: "sms",
      })),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
    });

    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(mocks.shareMurphHostedLinqNativeContactCardToChat).not.toHaveBeenCalled();
  });

  it("keeps delivered signup receipt handling successful when the card share fails", async () => {
    mocks.shareMurphHostedLinqNativeContactCardToChat.mockRejectedValueOnce(
      new Error("share failed"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = createHostedLinqDeliveryReceiptWebhookPrisma({
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      template: "invite_signup",
    });
    const scheduledTasks: Array<() => Promise<void>> = [];
    const scheduleAfterResponse = vi.fn((task: () => Promise<void>) => {
      scheduledTasks.push(task);
    });

    try {
      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: JSON.stringify(buildHostedLinqProviderReceiptEvent({
          chatId: "chat_signup_share_failure",
          eventId: "evt_delivered_signup_share_failure",
          eventType: "message.delivered",
          messageId: "provider_msg_signup_share_failure",
        })),
        scheduleAfterResponse,
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ignored: true,
        ok: true,
        reason: "recorded-linq-provider-event:message.delivered",
      });

      expect(mocks.shareMurphHostedLinqNativeContactCardToChat).not.toHaveBeenCalled();
      expect(scheduledTasks).toHaveLength(1);
      const [scheduledTask] = scheduledTasks;
      if (!scheduledTask) {
        throw new Error("Expected a delivered-signup contact-card task.");
      }
      await expect(scheduledTask()).resolves.toBeUndefined();
      expect(mocks.shareMurphHostedLinqNativeContactCardToChat).toHaveBeenCalledTimes(1);
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expect(scheduleAfterResponse).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted Linq contact-card share failed.",
        expect.objectContaining({ operation: "share_contact_card" }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it.each(["sms", "RCS"] as const)(
    "canonically classifies route-less inbound Linq %s direct chats despite conflicting preferred-service metadata",
    async (service) => {
      mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
        handles: [],
        isGroup: false,
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
            preferred_service: "iMessage",
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
                threadIsDirect: true,
              }),
            }),
            userId: "member_123",
          }),
        }),
      );
      expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
        chatId: "chat_123",
        timeoutMs: 1_500,
      });
      expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.chat-classification",
        { outcome: "canonical-direct" },
      );
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
      expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
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

  it("keeps active-member iMessage ingress direct when canonical classification is direct", async () => {
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [],
      isGroup: false,
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
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 1_500,
    });
    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
      "hosted-onboarding.webhook.linq.chat-classification",
      { outcome: "canonical-direct" },
    );
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

  it.each([
    {
      lookupError: new TypeError("Linq chat read unavailable"),
      summary: null,
    },
    {
      lookupError: null,
      summary: {
        handles: [],
        isGroup: null,
      },
    },
  ])("fails before planning when canonical classification is unavailable", async ({
    lookupError,
    summary,
  }) => {
    if (summary) {
      mocks.getHostedLinqChatSummary.mockResolvedValueOnce(summary);
    } else {
      mocks.getHostedLinqChatSummary.mockRejectedValueOnce(lookupError as Error);
    }
    const prisma = asPrismaTransactionClient({
      hostedMember: {
        findUnique: vi.fn(),
      },
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        chatIsGroup: false,
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      ...(lookupError ? { cause: lookupError } : {}),
      code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
      "hosted-onboarding.webhook.linq.chat-classification",
      { outcome: "canonical-unavailable" },
    );
    expect(prisma.hostedWebhookReceipt?.create).not.toHaveBeenCalled();
    expect(prisma.hostedMember?.findUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it.each(["sms", "RCS"] as const)(
    "fails before planning when canonical %s classification is unavailable",
    async (service) => {
      const lookupError = new TypeError("Linq chat read unavailable");
      mocks.getHostedLinqChatSummary.mockRejectedValueOnce(lookupError);
      const prisma = asPrismaTransactionClient({
        $transaction: vi.fn(),
        hostedMember: {
          findUnique: vi.fn(),
        },
        hostedWebhookReceipt: {
          create: vi.fn(),
          findUnique: vi.fn(),
          updateMany: vi.fn(),
        },
      });

      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          chatIsGroup: false,
          service,
        }),
        signature: null,
        timestamp: null,
      })).rejects.toMatchObject({
        cause: lookupError,
        code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
        httpStatus: 502,
        retryable: true,
      });

      expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
        chatId: "chat_123",
        timeoutMs: 1_500,
      });
      expect(prisma.hostedThreadRoute?.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.hostedWebhookReceipt?.create).not.toHaveBeenCalled();
      expect(prisma.hostedMember?.findUnique).not.toHaveBeenCalled();
      expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
      expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
      expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    },
  );

  it("propagates caller cancellation before Linq planning", async () => {
    const controller = new AbortController();
    const abortReason = new Error("caller cancelled");
    controller.abort(abortReason);

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: buildHostedLinqWebhookBody({
        chatIsGroup: false,
        service: "iMessage",
      }),
      signal: controller.signal,
      signature: null,
      timestamp: null,
    })).rejects.toBe(abortReason);

    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
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

  it("offers unbound Linq group chats from non-members setup without signup side effects", async () => {
    const prisma = asPrismaTransactionClient({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedLinqLine: buildManagedInboundHostedLinqLineFixture("+15550000000"),
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
      ok: true,
      reason: "sent-group-setup",
    });
    // The reply is one setup link. Sender identity is checked before admission,
    // but an unbound non-member group message must not inspect or mutate
    // personal routing state, nor start a signup.
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_123",
        message: expect.stringContaining("https://join.example.test/groups/start"),
      }),
    );
    // Planning resolves the provisional group roster once, then crypto
    // preflight independently confirms that no active sender needs a new
    // container. Neither read mutates or grants personal routing authority.
    expect(prisma.hostedMemberIdentity.findMany).toHaveBeenCalledTimes(2);
    // Preflight and the authoritative transaction repeat only the pending
    // group-contact recovery lookup scoped to this chat and line. Personal
    // routing is neither read by identity nor mutated.
    expect(prisma.hostedMemberRouting.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMemberRouting.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pendingLinqChatLookupKey: expect.anything(),
          pendingLinqParticipantContactLookupKey: expect.anything(),
          pendingLinqRecipientPhoneLookupKey: expect.anything(),
        }),
      }),
    );
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("retries before secondary recovery while the group setup delivery is in flight", async () => {
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValueOnce({
      claimed: false,
      id: "hld_group_setup_in_flight",
      retryAt: new Date("2026-03-26T12:15:00.000Z"),
    });
    const prisma = asPrismaTransactionClient({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedLinqLine: buildManagedInboundHostedLinqLineFixture("+15550000000"),
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
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_group_setup_in_flight",
            is_group: true,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_group_setup_in_flight",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_group_setup_in_flight",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_GROUP_SETUP_DELIVERY_IN_FLIGHT",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
    expect(scheduledTasks).toHaveLength(4);

    await scheduledTasks[3]?.();

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
    expect(scheduledTasks).toHaveLength(4);

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
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_thread_container_123",
      mailboxItemId: "mailbox_evt_routed_read_receipt_stale",
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenCalledTimes(3);
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
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenNthCalledWith(
      3,
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
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_direct_nudge_read_receipt",
    });
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
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_ingress_read_receipt_skipped",
    });
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
    // Initial access, exact post-lock admission, and the route-owner recheck all
    // run on the transaction client.
    expect(transactionHostedMemberFindUnique).toHaveBeenCalledTimes(3);
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
    const establishedParticipantLookupKey = "hbidx:email:v1:established-participant";
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_123",
        value: "chat_123",
      }),
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      linqParticipantContactKind: "email",
      linqParticipantContactLookupKey: establishedParticipantLookupKey,
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
    // The chat is already the member's home chat with no pending state, but
    // the live webhook chat id is still rewritten so stale lookup keys heal.
    // The missing recipient stays missing rather than being filled from
    // inbound metadata.
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        linqRecipientPhoneLookupKey: null,
      }),
      update: expect.objectContaining({
        linqParticipantContactKind: "email",
        linqParticipantContactLookupKey: establishedParticipantLookupKey,
        linqRecipientPhoneLookupKey: null,
      }),
      where: {
        memberId: "member_123",
      },
    }));
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          contactKind: "email",
          contactLookupKey: establishedParticipantLookupKey,
        }),
      }),
      tx: prisma,
    });
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

  it("prefers the canonical home owner over another member's stale pending contact", async () => {
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }

    const homeParticipantLookupKey = "hbidx:phone:v1:home-participant";
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId: "member_home",
        value: "chat_123",
      }),
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      linqParticipantContactKind: "phone",
      linqParticipantContactLookupKey: homeParticipantLookupKey,
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_home",
        value: "+15550000000",
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
      memberId: "member_home",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const pendingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_pending",
      pendingLinqChatId: "chat_pending",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const pendingRecord = withHostedMemberRoutingMember({
      ...pendingPrivate,
      linqChatLookupKey: null,
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId: "member_pending",
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_pending"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt: new Date("2026-03-26T11:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const homeFindMany = hostedMemberRouting.findMany;
    hostedMemberRouting.findMany = vi.fn(async (query: {
      where?: Record<string, unknown>;
    } = {}) => {
      if (query.where && "pendingLinqParticipantContactLookupKey" in query.where) {
        return pendingRecord ? [pendingRecord] : [];
      }
      return homeFindMany();
    });
    const prisma = asPrismaTransactionClient({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          id: "member_home",
          invites: [],
          suspendedAt: null,
        }),
      },
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([]),
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
        eventId: "evt_home_owner_over_stale_pending",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(hostedMemberRouting.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        pendingLinqParticipantContactLookupKey: expect.anything(),
      }),
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          contactKind: "phone",
          contactLookupKey: homeParticipantLookupKey,
        }),
      }),
      tx: prisma,
    });
  });

  it("keeps active-member inbound work moving from a degraded line when fallback capacity is exhausted", async () => {
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const fallbackLineLookupKey = createHostedPhoneLookupKey(fallbackLinePhone);
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    const hostedLinqLine = buildHostedLinqLinePoolFixture({
      lines: [{
        phoneNumber: fallbackLinePhone,
        proactiveConversationCount: 50,
        proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
      }],
    });
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
        data: {
          chat: {
            id: "chat_degraded_active",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded_active",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_active_capacity_exhausted_line",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqRecipientPhoneLookupKey: fallbackLineLookupKey,
      }),
    }));
    expect(hostedLinqLine.updateMany).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("accepts a Family invite from a degraded line when fallback capacity is exhausted", async () => {
    const fallbackLinePhone = "+15550100001";
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementationOnce(async (input: {
      onAcceptedMemberActivated: (result: {
        activated: boolean;
        hostedExecutionEventId: string;
        hostedExecutionMailboxItemId: string;
        memberId: string;
      }) => Promise<void> | void;
      onAcceptedMemberLocked: (result: {
        acceptedMemberId: string;
        invite: { id: string };
      }) => Promise<void>;
    }) => {
      await input.onAcceptedMemberLocked({
        acceptedMemberId: "member_family",
        invite: { id: "family_invite" },
      });
      await input.onAcceptedMemberActivated({
        activated: true,
        hostedExecutionEventId: "member.activated:family:member_family",
        hostedExecutionMailboxItemId: "mailbox_member_family_activation",
        memberId: "member_family",
      });
      return {
        groupId: "group_family",
        memberId: "member_family",
        role: "member",
        status: "active",
      };
    });

    const hostedLinqLine = buildHostedLinqLinePoolFixture({
      lines: [{
        phoneNumber: fallbackLinePhone,
        proactiveConversationCount: 50,
        proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
      }],
    });
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
      onAcceptedMemberActivated: expect.any(Function),
      onAcceptedMemberLocked: expect.any(Function),
      phoneNumber: "+15551234567",
      text: "family_phone_token",
      tx: prisma,
    });
    const hostedMemberRouting = prisma.hostedMemberRouting;
    const hostedMemberRoutingUpsert = hostedMemberRouting?.upsert;
    if (!hostedMemberRoutingUpsert) {
      throw new Error("Expected hosted member routing upsert fixture.");
    }
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        linqChatLookupKey: expect.stringContaining("hbidx:linq-chat:v1:"),
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(fallbackLinePhone),
        memberId: "member_family",
        pendingLinqChatLookupKey: null,
      }),
      update: expect.objectContaining({
        linqChatLookupKey: expect.stringContaining("hbidx:linq-chat:v1:"),
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(fallbackLinePhone),
        pendingLinqChatLookupKey: null,
      }),
      where: {
        memberId: "member_family",
      },
    }));
    expect(hostedMemberRoutingUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      create: expect.objectContaining({
        linqParticipantContactKind: "phone",
        linqParticipantContactLookupKey: expect.stringContaining("hbidx:phone:v1:"),
      }),
      update: expect.objectContaining({
        linqParticipantContactKind: "phone",
        linqParticipantContactLookupKey: expect.stringContaining("hbidx:phone:v1:"),
      }),
    }));
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_family",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(hostedMemberRoutingUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[0],
    );
    expect(mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
    );
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_family",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.buildHostedFamilyInviteAcceptedReplyText).toHaveBeenCalledWith({
      memberId: "member_family",
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_123",
      idempotencyKey: "linq-message:evt_family_linq",
      message: "Welcome to Murph Family.",
      replyToMessageId: "msg_123",
      signal: undefined,
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(hostedLinqLine.updateMany).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_family",
      mailboxItemId: "mailbox_member_family_activation",
    });
  });

  it("accepts a Family invite token from an existing saved home chat with sparse line metadata", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementationOnce(async (input: {
      onAcceptedMemberLocked: (result: {
        acceptedMemberId: string;
        invite: { id: string };
      }) => Promise<void>;
    }) => {
      await input.onAcceptedMemberLocked({
        acceptedMemberId: "member_123",
        invite: { id: "family_invite" },
      });
      return {
        groupId: "group_family",
        memberId: "member_123",
        role: "member",
        status: "active",
      };
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
      onAcceptedMemberActivated: expect.any(Function),
      onAcceptedMemberLocked: expect.any(Function),
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

  it("does not accept a Family invite token when canonical chat classification is unavailable", async () => {
    const classificationError = new Error("Linq chat read unavailable");
    mocks.getHostedLinqChatSummary.mockRejectedValueOnce(classificationError);
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

    await expect(handleHostedOnboardingLinqWebhook({
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
    })).rejects.toMatchObject({
      cause: classificationError,
      code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).not.toHaveBeenCalled();
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not accept a Family invite token from an unassignable inbound Linq line", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementationOnce(async (input: {
      onAcceptedMemberLocked: (result: {
        acceptedMemberId: string;
        invite: { id: string };
      }) => Promise<void>;
    }) => {
      await input.onAcceptedMemberLocked({
        acceptedMemberId: "member_family",
        invite: { id: "family_invite" },
      });
      return null;
    });
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
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledTimes(1);
    const hostedMemberRouting = prisma.hostedMemberRouting;
    if (!hostedMemberRouting) {
      throw new Error("Expected hosted member routing fixture.");
    }
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not accept a Family invite token when the inbound Linq line is missing", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementationOnce(async (input: {
      onAcceptedMemberLocked: (result: {
        acceptedMemberId: string;
        invite: { id: string };
      }) => Promise<void>;
    }) => {
      await input.onAcceptedMemberLocked({
        acceptedMemberId: "member_family",
        invite: { id: "family_invite" },
      });
      return null;
    });
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
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("keeps invalid Family invite handling independent of proactive capacity", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementationOnce(async (input: {
      onAcceptedMemberLocked: (result: {
        acceptedMemberId: string;
        invite: { id: string };
      }) => Promise<void>;
    }) => {
      await input.onAcceptedMemberLocked({
        acceptedMemberId: "member_family",
        invite: { id: "family_invite" },
      });
      return null;
    });
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
      reason: "family-invite-not-accepted",
    });
    expect(mocks.acceptHostedFamilyInviteFromPhoneTx).toHaveBeenCalledTimes(1);
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        linqHomeLineAssignedAt: { gte: expect.any(Date) },
      }),
    }));
    expect(hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqRecipientPhoneLookupKey: homeLineLookupKey,
      }),
    }));
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
      onAcceptedMemberActivated: expect.any(Function),
      onAcceptedMemberLocked: expect.any(Function),
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
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementation(async (input: {
      onAcceptedMemberLocked: (result: {
        acceptedMemberId: string;
        invite: { id: string };
      }) => Promise<void>;
    }) => {
      await input.onAcceptedMemberLocked({
        acceptedMemberId: "member_family",
        invite: { id: "family_invite" },
      });
      return {
        groupId: "group_family",
        memberId: "member_family",
        role: "member",
        status: "active",
      };
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
    expect(mocks.buildHostedFamilyInviteAcceptedReplyText).toHaveBeenLastCalledWith({
      memberId: "member_family",
    });
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
      onAcceptedMemberActivated: expect.any(Function),
      onAcceptedMemberLocked: expect.any(Function),
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
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .not.toHaveBeenCalled();
    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("fails retryably when the required signup delivery is still in flight", async () => {
    const invite = {
      channel: "linq",
      id: "invite_in_flight",
      inviteCode: "code_in_flight",
      memberId: "member_in_flight",
      sentAt: null,
      status: "pending",
    };
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValueOnce({
      claimed: false,
      id: "hld_in_flight",
      retryAt: new Date("2026-03-26T12:15:00.000Z"),
    });
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_in_flight",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_signup_in_flight",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_SIGNUP_DELIVERY_IN_FLIGHT",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).not.toHaveBeenCalled();
  });

  it("reports a decided target rejection without claiming that a signup link sent", async () => {
    const invite = {
      channel: "linq",
      id: "invite_target_unavailable",
      inviteCode: "code_target_unavailable",
      memberId: "member_target_unavailable",
      sentAt: null,
      status: "pending",
    };
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValueOnce({
      claimed: false,
      id: "hld_target_unavailable",
      outcome: "incompatible",
    });
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: "member_target_unavailable",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_signup_target_unavailable",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "signup-link-target-unavailable",
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).not.toHaveBeenCalled();
  });

  it("keeps an existing inactive member on the signup-link path", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_existing_inactive";
    const invite = {
      channel: "linq",
      id: "invite_existing_inactive",
      inviteCode: "code_existing_inactive",
      memberId,
      sentAt: null,
      status: "pending",
    };
    const hostedMemberCreate = vi.fn();
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
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
        create: hostedMemberCreate,
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          createdAt: new Date("2026-03-25T12:00:00.000Z"),
          id: memberId,
          invites: [],
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
          threadContainer: null,
          updatedAt: new Date("2026-03-25T12:00:00.000Z"),
        }),
        update: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId: "evt_existing_inactive",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(hostedMemberCreate).not.toHaveBeenCalled();
    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining(invite.inviteCode),
      }),
    );
  });

  it("reconciles an exact provider-redelivered event after activation commits before its continuation returns", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_instant_start_retry";
    const eventId = "evt_instant_start_retry";
    const activationEventId = "member.activated:instant-start";
    const durableMailboxDedupeKeys = new Set<string>();
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }
    const pendingRoutingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      ...pendingRoutingPrivate,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt:
        new Date("2026-03-26T12:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey:
        createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "invite_instant_start_retry",
      instantStartAdmissionEventId: eventId as string | null,
      inviteCode: "code_instant_start_retry",
      memberId,
      sentAt: null,
      status: "pending",
    };
    let trialActive = false;
    const hostedMemberFindUnique = vi.fn(async () => ({
      accountGroupMemberships: [],
      billingStatus: trialActive
        ? HostedBillingStatus.active
        : HostedBillingStatus.not_started,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      id: memberId,
      invites: [],
      phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
      suspendedAt: null,
      threadContainer: null,
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    }));
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn(async () =>
          invite.instantStartAdmissionEventId ? invite : null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue(invite),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.99,
          decision: "allow",
          eventId,
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: hostedMemberFindUnique,
        update: vi.fn(),
      },
      hostedMemberRouting,
    });
    mocks.readHostedMailboxItemOwnerById.mockResolvedValueOnce({
      id: "mailbox_item_123",
      userId: memberId,
    });
    mocks.appendHostedMailboxEnvelopeWithSourceMessageTx.mockImplementation(
      async (input: { envelope: { eventId: string }; tx: unknown }) => {
        durableMailboxDedupeKeys.add(input.envelope.eventId);
        return mocks.appendHostedMailboxEnvelopeTx({
          envelope: input.envelope,
          tx: input.tx,
        });
      },
    );
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockImplementationOnce(
      async () => {
        // Model the only request-local loss window: the transaction committed
        // active access and its mailbox row, but the process disappeared before
        // the caller received the continuation or appended the conversation.
        trialActive = true;
        invite.instantStartAdmissionEventId = null;
        durableMailboxDedupeKeys.add(activationEventId);
        throw hostedOnboardingError({
          code: "TEST_PROCESS_INTERRUPTED_AFTER_ACTIVATION_COMMIT",
          httpStatus: 503,
          message: "The request ended after activation committed.",
          retryable: true,
        });
      },
    );
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async () => {
      // Temporal receives the conversation pointer only after both durable
      // lanes exist, so its ordinary reconciliation can import activation too.
      expect(durableMailboxDedupeKeys).toEqual(new Set([
        activationEventId,
        eventId,
      ]));
      return {
        signalAccepted: true,
        workflowId: `hosted-user-runtime:${memberId}`,
      };
    });
    const rawBody = buildHostedLinqWebhookBody({
      data: {
        chat: {
          id: "chat_123",
          is_group: false,
          owner_handle: {
            handle: "+15550000000",
            id: "handle_owner_123",
            is_me: true,
            service: "iMessage",
          },
        },
        parts: [{ type: "text", value: "Hey Murph" }],
      },
      eventId,
      service: "iMessage",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "TEST_PROCESS_INTERRUPTED_AFTER_ACTIVATION_COMMIT",
      retryable: true,
    });

    expect(durableMailboxDedupeKeys).toEqual(new Set([activationEventId]));
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
      .not.toHaveBeenCalled();

    // Linq owns this redelivery. The exact raw event now observes the member
    // state committed by attempt one and follows the ordinary active path.
    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .toHaveBeenCalledOnce();
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledOnce();
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: eventId,
      prisma,
      userId: memberId,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expectHostedLinqPointerSignalAccepted(eventId, memberId);
    expect(durableMailboxDedupeKeys).toEqual(new Set([
      activationEventId,
      eventId,
    ]));
    expect(mocks.startHostedLinqChatTypingIndicator).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("starts only the owner-neutral shell before enrollment and keeps runtime authority after the conversation signal", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_instant_start_prewarm";
    const eventId = "evt_instant_start_prewarm";
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }
    const pendingRoutingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      ...pendingRoutingPrivate,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt:
        new Date("2026-03-26T12:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey:
        createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "invite_instant_start_prewarm",
      instantStartAdmissionEventId: eventId as string | null,
      inviteCode: "code_instant_start_prewarm",
      memberId,
      sentAt: null,
      status: "pending",
    };
    const callOrder: string[] = [];
    let trialActive = false;
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn(async () =>
          invite.instantStartAdmissionEventId ? invite : null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue(invite),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.99,
          decision: "allow",
          eventId,
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async () => {
          if (trialActive) {
            callOrder.push("replan");
          }
          return {
            accountGroupMemberships: [],
            billingStatus: trialActive
              ? HostedBillingStatus.active
              : HostedBillingStatus.not_started,
            createdAt: new Date("2026-03-26T12:00:00.000Z"),
            id: memberId,
            invites: [],
            phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
            suspendedAt: null,
            threadContainer: null,
            updatedAt: new Date("2026-03-26T12:00:00.000Z"),
          };
        }),
        update: vi.fn(),
      },
      hostedMemberRouting,
    });
    mocks.readHostedMailboxItemOwnerById.mockResolvedValueOnce({
      id: "mailbox_item_123",
      userId: memberId,
    });
    const typingResult = createDeferred<{ ok: boolean; status: number }>();
    const ensureRuntimeProcessing = vi.fn();
    const prewarmRuntimeShell = vi.fn(() => {
      callOrder.push("shell-prewarm");
      return new Promise<{ accepted: true }>(() => undefined);
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing,
      prewarmRuntimeShell,
    });
    mocks.startHostedLinqChatTypingIndicator.mockImplementation(
      (input: { chatId: string }) => {
        callOrder.push(`typing:${input.chatId}`);
        return typingResult.promise;
      },
    );
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockImplementationOnce(
      async () => {
        callOrder.push("enrollment");
        trialActive = true;
        invite.instantStartAdmissionEventId = null;
        return {
          deferredActivationWake: {
            hostedExecutionEventId: "member.activated:instant-start",
            memberId,
          },
          redirectPath: "/home",
          status: "enrolled",
        };
      },
    );
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async () => {
      callOrder.push("conversation-signal");
      return {
        signalAccepted: true,
        workflowId: `hosted-user-runtime:${memberId}`,
      };
    });
    mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort
      .mockImplementationOnce(async () => {
        callOrder.push("activation-continuation");
      });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId,
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });
    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    const enrollmentIndex = callOrder.indexOf("enrollment");
    const activationWakeIndex = callOrder.indexOf("activation-continuation");
    const replanIndex = callOrder.indexOf("replan");
    const signalIndex = callOrder.indexOf("conversation-signal");
    const shellPrewarmIndex = callOrder.indexOf("shell-prewarm");
    const typingIndex = callOrder.indexOf("typing:chat_123");
    expect(enrollmentIndex).toBeGreaterThanOrEqual(0);
    expect(replanIndex).toBeGreaterThan(enrollmentIndex);
    expect(signalIndex).toBeGreaterThan(replanIndex);
    expect(activationWakeIndex).toBeGreaterThan(signalIndex);
    expect(typingIndex).toBeGreaterThanOrEqual(0);
    expect(typingIndex).toBeLessThan(enrollmentIndex);
    expect(shellPrewarmIndex).toBeGreaterThanOrEqual(0);
    expect(shellPrewarmIndex).toBeLessThan(enrollmentIndex);
    expect(prewarmRuntimeShell).toHaveBeenCalledOnce();
    expect(prewarmRuntimeShell).toHaveBeenCalledWith(memberId);
    expect(ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(mocks.startHostedLinqChatTypingIndicator).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 2_500,
    });
    expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
      .toHaveBeenCalledWith({
        continuation: {
          hostedExecutionEventId: "member.activated:instant-start",
          memberId,
        },
        prisma,
      });

    typingResult.resolve({ ok: false, status: 503 });
    await typingResult.promise;
    await vi.waitFor(() => {
      expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.instant-start-typing-hint-failed",
        { httpStatus: 503 },
      );
    });
    // A successful handoff owns the visible continuation; the hint stays.
    expect(mocks.stopHostedLinqChatTypingIndicator).not.toHaveBeenCalled();
  });

  it("keeps the signup-link fallback intact when enrollment fails after the shell hint", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_instant_start_prewarm_fail";
    const eventId = "evt_instant_start_prewarm_fail";
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }
    const pendingRoutingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      ...pendingRoutingPrivate,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt:
        new Date("2026-03-26T12:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey:
        createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "invite_instant_start_prewarm_fail",
      instantStartAdmissionEventId: eventId as string | null,
      inviteCode: "code_instant_start_prewarm_fail",
      memberId,
      sentAt: null,
      status: "pending",
    };
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn(async () =>
          invite.instantStartAdmissionEventId ? invite : null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: invite.id,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.99,
          decision: "allow",
          eventId,
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          createdAt: new Date("2026-03-26T12:00:00.000Z"),
          id: memberId,
          invites: [],
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
          threadContainer: null,
          updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        })),
        update: vi.fn(),
      },
      hostedMemberRouting,
    });
    const ensureRuntimeProcessing = vi.fn<
      (input: { userId: string }) => Promise<{ accepted: boolean }>
    >(async () => ({ accepted: true }));
    const prewarmRuntimeShell = vi.fn(async () => ({ accepted: true as const }));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing,
      prewarmRuntimeShell,
    });
    mocks.startHostedLinqChatTypingIndicator.mockRejectedValueOnce(
      new Error("typing unavailable"),
    );
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockRejectedValueOnce(
      new Error("stripe unavailable"),
    );

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId,
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prewarmRuntimeShell).toHaveBeenCalledOnce();
    expect(prewarmRuntimeShell).toHaveBeenCalledWith(memberId);
    expect(ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(mocks.startHostedLinqChatTypingIndicator).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.instant-start-typing-hint-failed",
        { errorName: "Error" },
      );
    });
    // The sent signup-link fallback owns the visible continuation; no stop.
    expect(mocks.stopHostedLinqChatTypingIndicator).not.toHaveBeenCalled();
  });

  it("clears the typing hint after the in-flight start when the webhook fails retryably", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_instant_start_typing_stop";
    const eventId = "evt_instant_start_typing_stop";
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }
    const pendingRoutingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      ...pendingRoutingPrivate,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt:
        new Date("2026-03-26T12:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey:
        createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "invite_instant_start_typing_stop",
      instantStartAdmissionEventId: eventId as string | null,
      inviteCode: "code_instant_start_typing_stop",
      memberId,
      sentAt: null,
      status: "pending",
    };
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn(async () =>
          invite.instantStartAdmissionEventId ? invite : null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue(invite),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.99,
          decision: "allow",
          eventId,
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          createdAt: new Date("2026-03-26T12:00:00.000Z"),
          id: memberId,
          invites: [],
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
          threadContainer: null,
          updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        })),
        update: vi.fn(),
      },
      hostedMemberRouting,
    });
    const typingStart = createDeferred<{ ok: boolean; status: number }>();
    mocks.startHostedLinqChatTypingIndicator.mockReturnValueOnce(
      typingStart.promise,
    );
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_STRIPE_UNAVAILABLE",
        httpStatus: 503,
        message: "Stripe is unavailable. Retry this webhook.",
        retryable: true,
      }),
    );
    const afterResponseTasks: Array<() => Promise<void>> = [];

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId,
        service: "iMessage",
      }),
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({ retryable: true });

    // The cleanup must be owned by the request's post-response scheduler, not
    // a detached promise: the failing invocation may freeze after the error
    // response, so only scheduled work is guaranteed to run.
    expect(mocks.startHostedLinqChatTypingIndicator).toHaveBeenCalledTimes(1);
    expect(mocks.stopHostedLinqChatTypingIndicator).not.toHaveBeenCalled();
    expect(afterResponseTasks.length).toBeGreaterThan(0);
    // The stop must also chain behind the still-pending start, not race it.
    typingStart.resolve({ ok: true, status: 204 });
    await Promise.all(afterResponseTasks.map((task) => task()));
    expect(mocks.stopHostedLinqChatTypingIndicator).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 2_500,
    });
    expect(mocks.stopHostedLinqChatTypingIndicator).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("clears the typing hint once when the wake handoff fails after enrollment", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_instant_start_handoff_fail";
    const eventId = "evt_instant_start_handoff_fail";
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }
    const pendingRoutingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      ...pendingRoutingPrivate,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt:
        new Date("2026-03-26T12:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey:
        createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "invite_instant_start_handoff_fail",
      instantStartAdmissionEventId: eventId as string | null,
      inviteCode: "code_instant_start_handoff_fail",
      memberId,
      sentAt: null,
      status: "pending",
    };
    let trialActive = false;
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn(async () =>
          invite.instantStartAdmissionEventId ? invite : null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue(invite),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          confidence: 0.99,
          decision: "allow",
          eventId,
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          accountGroupMemberships: [],
          billingStatus: trialActive
            ? HostedBillingStatus.active
            : HostedBillingStatus.not_started,
          createdAt: new Date("2026-03-26T12:00:00.000Z"),
          id: memberId,
          invites: [],
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
          suspendedAt: null,
          threadContainer: null,
          updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        })),
        update: vi.fn(),
      },
      hostedMemberRouting,
    });
    mocks.readHostedMailboxItemOwnerById.mockResolvedValueOnce({
      id: "mailbox_item_123",
      userId: memberId,
    });
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockImplementationOnce(
      async () => {
        trialActive = true;
        invite.instantStartAdmissionEventId = null;
        return {
          deferredActivationWake: {
            hostedExecutionEventId: "member.activated:instant-start",
            memberId,
          },
          redirectPath: "/home",
          status: "enrolled",
        };
      },
    );
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("temporal unavailable"),
    );
    const afterResponseTasks: Array<() => Promise<void>> = [];

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId,
        service: "iMessage",
      }),
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).rejects.toThrow("temporal unavailable");

    expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
      .toHaveBeenCalledWith({
        continuation: {
          hostedExecutionEventId: "member.activated:instant-start",
          memberId,
        },
        prisma,
      });
    expect(mocks.stopHostedLinqChatTypingIndicator).not.toHaveBeenCalled();
    await Promise.all(afterResponseTasks.map((task) => task()));
    expect(mocks.stopHostedLinqChatTypingIndicator).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 2_500,
    });
    expect(mocks.stopHostedLinqChatTypingIndicator).toHaveBeenCalledTimes(1);
  });

  it("retries a different inbound before counting it while the admitted instant start owns the inactive member", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const memberId = "member_instant_start_follow_up";
    const admissionEventId = "evt_instant_start_original";
    const followUpEventId = "evt_instant_start_follow_up";
    const participantContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    if (!participantContact) {
      throw new Error("Expected a valid participant contact.");
    }
    const pendingRoutingPrivate = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: participantContact.value,
      pendingLinqRecipientPhone: "+15550000000",
      telegramThreadId: null,
      telegramUserId: null,
    });
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock({
      ...pendingRoutingPrivate,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      linqRecipientPhoneLookupKey: null,
      memberId,
      pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      pendingLinqParticipantContactKind: participantContact.kind,
      pendingLinqParticipantContactLookupKey: participantContact.lookupKey,
      pendingLinqParticipantContactObservedAt:
        new Date("2026-03-26T12:00:00.000Z"),
      pendingLinqRecipientPhoneLookupKey:
        createHostedPhoneLookupKey("+15550000000"),
      telegramUserLookupKey: null,
    });
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "invite_instant_start_follow_up",
      instantStartAdmissionEventId: admissionEventId,
      inviteCode: "code_instant_start_follow_up",
      memberId,
      sentAt: null,
      status: "pending",
    };
    const hostedMemberFindUnique = vi.fn(async () => ({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.not_started,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      id: memberId,
      invites: [invite],
      phoneLookupKey: participantContact.lookupKey,
      phoneNumberVerifiedAt: new Date("2026-03-26T12:00:00.000Z"),
      suspendedAt: null,
      threadContainer: null,
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    }));
    const hostedInviteUpdate = vi.fn(async ({ data }: {
      data: { instantStartAdmissionEventId?: string | null };
    }) => ({
      ...invite,
      ...data,
    }));
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(invite),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: hostedInviteUpdate,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn(),
        findUnique: vi.fn(async ({ where }: {
          where: { eventId: string };
        }) => where.eventId === admissionEventId
          ? {
              confidence: 0.99,
              decision: "allow",
              eventId: admissionEventId,
              source: "model",
            }
          : null),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: hostedMemberFindUnique,
        update: vi.fn(),
      },
      hostedMemberRouting,
    });
    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "One more question" }],
        },
        eventId: followUpEventId,
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_START_IN_PROGRESS",
      retryable: true,
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .not.toHaveBeenCalled();
    expect(hostedInviteUpdate).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
  });

  it("instant-starts a model-approved group-outreach reply and links the originating group", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const groupId = "hgrp_instant_start_reply";
    const groupJoinCode = "join_instant_start_reply";
    const groupJoinOutreachId = "hgrpjoa_instant_start_reply";
    const newerGroupId = "hgrp_instant_start_reply_newer";
    const newerGroupJoinCode = "join_instant_start_reply_newer";
    const newerGroupJoinOutreachId = "hgrpjoa_instant_start_reply_newer";
    const providerGroupOutreachMessageId = "provider_group_outreach";
    const providerNewerGroupOutreachMessageId =
      "provider_group_outreach_newer";
    let createdMemberId: string | null = null;
    const createdInviteState: {
      current: {
        channel: string;
        id: string;
        instantStartAdmissionEventId: string | null;
        inviteCode: string;
        memberId: string;
        sentAt: Date | null;
        status: string;
      } | null;
    } = { current: null };
    let trialActive = false;
    const hostedMemberCreate = vi.fn(async ({ data }: {
      data: { billingStatus: HostedBillingStatus; id: string };
    }) => {
      createdMemberId = data.id;
      return {
        billingStatus: data.billingStatus,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: data.id,
        suspendedAt: null,
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      };
    });
    const hostedMemberFindUnique = vi.fn(async () => {
      if (!createdMemberId) {
        return null;
      }
      return {
        accountGroupMemberships: [],
        billingStatus: trialActive
          ? HostedBillingStatus.active
          : HostedBillingStatus.not_started,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: createdMemberId,
        invites: [],
        phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
        suspendedAt: null,
        threadContainer: null,
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      };
    });
    const hostedInviteCreate = vi.fn(async ({ data }: {
      data: {
        channel: string;
        id: string;
        instantStartAdmissionEventId?: string | null;
        inviteCode: string;
        memberId: string;
      };
    }) => {
      createdInviteState.current = {
        ...data,
        instantStartAdmissionEventId:
          data.instantStartAdmissionEventId ?? null,
        sentAt: null,
        status: "pending",
      };
      return createdInviteState.current;
    });
    const hostedInviteUpdate = vi.fn(async ({ data }: {
      data: {
        channel?: string;
        instantStartAdmissionEventId?: string | null;
        sentAt?: Date;
      };
    }) => {
      if (!createdInviteState.current) {
        throw new Error("Expected the instant-start invite before reuse.");
      }
      createdInviteState.current = {
        ...createdInviteState.current,
        ...data,
      };
      return createdInviteState.current;
    });
    const participantPhoneLookupKey = createHostedPhoneLookupKey("+15551234567");
    const linqChatLookupKey = createHostedLinqChatLookupKey("chat_123");
    const providerGroupOutreachLookupKey =
      createHostedLinqMessageLookupKey(providerGroupOutreachMessageId);
    const providerNewerGroupOutreachLookupKey =
      createHostedLinqMessageLookupKey(providerNewerGroupOutreachMessageId);
    if (
      !participantPhoneLookupKey
      || !linqChatLookupKey
      || !providerGroupOutreachLookupKey
      || !providerNewerGroupOutreachLookupKey
    ) {
      throw new Error("Expected group-outreach lookup keys.");
    }
    const hostedLinqDeliveryFindMany = vi.fn(async ({ where }: {
      where?: {
        AND?: Array<{
          OR?: Array<{
            linqChatLookupKey?: { in?: string[] };
          }>;
        }>;
        groupJoinOutreach?: {
          is?: {
            participantPhoneLookupKey?: { in?: string[] };
          };
        };
        messageLookupKey?: { in?: string[] };
        source?: string;
        template?: string;
      };
    }) => {
      const participantPhoneLookupKeys =
        where?.groupJoinOutreach?.is?.participantPhoneLookupKey?.in ?? [];
      const linqChatLookupKeys = where?.AND
        ?.flatMap((condition) => condition.OR ?? [])
        .flatMap((condition) => condition.linqChatLookupKey?.in ?? [])
        ?? [];
      const messageLookupKeys = where?.messageLookupKey?.in ?? [];
      return where?.source === "hosted_group_join_outreach"
        && where?.template === "group_join_outreach"
        && participantPhoneLookupKeys.includes(participantPhoneLookupKey)
        && linqChatLookupKeys.includes(linqChatLookupKey)
          ? [{
              groupJoinOutreach: {
                id: newerGroupJoinOutreachId,
                offer: {
                  group: {
                    id: newerGroupId,
                    joinCode: newerGroupJoinCode,
                    runtimeMember: { suspendedAt: null },
                    runtimeMemberId: "member_group_runtime_newer",
                  },
                  revokedAt: null,
                },
              },
              groupJoinOutreachId: newerGroupJoinOutreachId,
              id: "hld_group_opener_newer",
              linqChatLookupKey,
              messageLookupKey: providerNewerGroupOutreachLookupKey,
              phoneNumberLookupKey: participantPhoneLookupKey,
            }, {
              groupJoinOutreach: {
                id: groupJoinOutreachId,
                offer: {
                  group: {
                    id: groupId,
                    joinCode: groupJoinCode,
                    runtimeMember: { suspendedAt: null },
                    runtimeMemberId: "member_group_runtime",
                  },
                  revokedAt: null,
                },
              },
              groupJoinOutreachId,
              id: "hld_group_opener",
              linqChatLookupKey,
              messageLookupKey: providerGroupOutreachLookupKey,
              phoneNumberLookupKey: participantPhoneLookupKey,
            }].filter((delivery) =>
              messageLookupKeys.includes(delivery.messageLookupKey)
            )
          : [];
    });
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedGroupJoinOutreach: {
        findFirst: vi.fn().mockResolvedValue({
          offer: {
            group: {
              id: groupId,
              joinCode: groupJoinCode,
              runtimeMember: { suspendedAt: null },
              runtimeMemberId: "member_group_runtime",
            },
            revokedAt: null,
          },
        }),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedGroupMember: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn(async () => createdInviteState.current),
        findUnique: vi.fn(async () => createdInviteState.current),
        update: hostedInviteUpdate,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_signup" }),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: hostedLinqDeliveryFindMany,
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn().mockResolvedValue({ id: "hld_signup" }),
      },
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedMember: {
        create: hostedMemberCreate,
        findUnique: hostedMemberFindUnique,
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    let transactionOpen = false;
    prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(prisma);
      } finally {
        transactionOpen = false;
      }
    });
    mocks.readHostedMailboxItemOwnerById.mockImplementationOnce(
      async ({ mailboxItemId }: { mailboxItemId: string }) => ({
        id: mailboxItemId,
        userId: createdMemberId ?? "member_123",
      }),
    );
    mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockImplementationOnce(
      async ({ inviteCode, memberId, prisma: enrollmentPrisma }) => {
        expect(transactionOpen).toBe(false);
        expect(inviteCode).toEqual(expect.any(String));
        expect(memberId).toBe(createdMemberId);
        expect(enrollmentPrisma).toBe(prisma);
        trialActive = true;
        return {
          redirectPath: "/home",
          status: "enrolled",
        };
      },
    );

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph, what can you do?" }],
          reply_to: {
            message_id: providerGroupOutreachMessageId,
            part_index: 0,
          },
        },
        eventId: "evt_instant_start",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    const issuedInvite = createdInviteState.current;
    if (!issuedInvite) {
      throw new Error("Expected the phone-bound instant-start invite.");
    }
    const expectedJoinUrl =
      `https://join.example.test/groups/join/${groupJoinCode}?invite=${issuedInvite.inviteCode}`;
    expect(response).toEqual(expect.objectContaining({
      inviteCode: issuedInvite.inviteCode,
      joinUrl: expectedJoinUrl,
      ok: true,
      reason: "sent-signup-link",
    }));
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledOnce();
    expect(prisma.hostedLinqFirstContactAdmissionDecision!.createMany)
      .toHaveBeenCalledWith({
        data: expect.objectContaining({
          decision: "allow",
          eventId: "evt_instant_start",
          source: "model",
        }),
        skipDuplicates: true,
      });
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .toHaveBeenCalledOnce();
    expect(hostedMemberCreate).toHaveBeenCalledOnce();
    expect(hostedInviteCreate).toHaveBeenCalledOnce();
    expect(hostedInviteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instantStartAdmissionEventId: "evt_instant_start",
        memberId: createdMemberId,
      }),
    });
    expect(prisma.hostedMemberIdentity!.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: createdMemberId,
        phoneNumberVerifiedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      skipDuplicates: true,
    });
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledTimes(1);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: createdMemberId,
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    const sentMessage = (
      mocks.sendHostedLinqChatMessage.mock.calls[0]?.[0] as
        | { message?: string }
        | undefined
    )?.message;
    expect(sentMessage?.match(/https?:\/\/[^\s]+/gu)).toEqual([expectedJoinUrl]);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining(expectedJoinUrl),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        groupJoinOutreachId,
        groupJoinReplyOccurredAt: new Date("2026-03-26T12:00:00.000Z"),
        source: "hosted_webhook_side_effect",
        template: "invite_signup",
      }),
    );
    expect(hostedInviteUpdate).toHaveBeenCalledTimes(2);
    expect(hostedInviteUpdate).toHaveBeenNthCalledWith(1, {
      data: {
        channel: "linq",
        instantStartAdmissionEventId: null,
      },
      where: { id: expect.any(String) },
    });
    expect(hostedInviteUpdate).toHaveBeenNthCalledWith(2, {
      data: { sentAt: expect.any(Date) },
      where: { id: expect.any(String) },
    });
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledOnce();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("keeps a model-approved new contact on the signup-link path when routing selects another line", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const createdInviteCode = "code_instant_start_cross_line";
    let createdMemberId: string | null = null;
    let createdInvite: {
      channel: string;
      id: string;
      inviteCode: string;
      memberId: string;
      sentAt: Date | null;
      status: string;
    } | null = null;
    const hostedMemberCreate = vi.fn(async ({ data }: {
      data: { billingStatus: HostedBillingStatus; id: string };
    }) => {
      createdMemberId = data.id;
      return {
        billingStatus: data.billingStatus,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: data.id,
        suspendedAt: null,
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      };
    });
    const hostedMemberFindUnique = vi.fn(async () => {
      if (!createdMemberId) {
        return null;
      }
      return {
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.not_started,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        id: createdMemberId,
        invites: [],
        phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
        suspendedAt: null,
        threadContainer: null,
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      };
    });
    const hostedInviteCreate = vi.fn(async ({ data }: {
      data: { channel: string; id: string; inviteCode: string; memberId: string };
    }) => {
      createdInvite = {
        ...data,
        inviteCode: createdInviteCode,
        sentAt: null,
        status: "pending",
      };
      return createdInvite;
    });
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn(async () => createdInvite),
        findUnique: vi.fn(async () => createdInvite),
        update: vi.fn().mockImplementation(async ({ where }: {
          where: { id: string };
        }) => ({
          id: where.id,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqLine: buildHostedLinqLinePoolFixture({
        lines: [{
          maxNewConversationsPerDay: 10,
          phoneNumber: fallbackLinePhone,
          proactiveConversationCount: 0,
          proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
        }],
      }),
      hostedMember: {
        create: hostedMemberCreate,
        findUnique: hostedMemberFindUnique,
        update: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_instant_start_cross_line",
            is_group: false,
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_instant_start_cross_line",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId: "evt_instant_start_cross_line",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: createdInviteCode,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(createdMemberId).toEqual(expect.any(String));
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledOnce();
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .not.toHaveBeenCalled();
    expect(hostedMemberCreate).toHaveBeenCalledOnce();
    expect(hostedInviteCreate).toHaveBeenCalledOnce();
    expect(prisma.hostedMemberIdentity!.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: createdMemberId,
        phoneNumberVerifiedAt: null,
      }),
      skipDuplicates: true,
    });
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledOnce();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).toHaveBeenCalledWith({
      from: fallbackLinePhone,
      idempotencyKey: expect.stringContaining(String(createdMemberId)),
      message: expect.stringContaining(createdInviteCode),
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      configureEnrollment: () => {
        mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockRejectedValueOnce(
          new Error("Synthetic trial enrollment failure."),
        );
      },
      activationCommitted: false,
      outcome: "fails",
      retryable: false,
    },
    {
      configureEnrollment: () => {
        mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockResolvedValueOnce({
          deferredActivationWake: {
            hostedExecutionEventId: "member.activated:instant-start",
            memberId: "member_instant_start_fallback",
          },
          redirectPath: "/home",
          status: "enrolled",
        });
      },
      activationCommitted: true,
      outcome: "resolves without making the member active",
      retryable: false,
    },
    {
      configureEnrollment: () => {
        mocks.ensureHostedLinqInstantStartPulseTrialEnrollment.mockRejectedValueOnce(
          hostedOnboardingError({
            code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_UNAVAILABLE",
            httpStatus: 503,
            message: "Stripe is still confirming this trial. Try again.",
            retryable: true,
          }),
        );
      },
      activationCommitted: false,
      outcome: "is retryable",
      retryable: true,
    },
  ])("handles instant-start trial enrollment when it $outcome", async ({
    activationCommitted,
    configureEnrollment,
    retryable,
  }) => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    configureEnrollment();
    const invite = {
      channel: "linq",
      id: "invite_instant_start_fallback",
      inviteCode: "code_instant_start_fallback",
      memberId: "member_instant_start_fallback",
      sentAt: null,
      status: "pending",
    };
    let memberCreated = false;
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(invite),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          ...invite,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockImplementation(async () => {
          memberCreated = true;
          return {
            billingStatus: HostedBillingStatus.not_started,
            createdAt: new Date("2026-03-26T12:00:00.000Z"),
            id: invite.memberId,
            suspendedAt: null,
            updatedAt: new Date("2026-03-26T12:00:00.000Z"),
          };
        }),
        findUnique: vi.fn().mockImplementation(async () =>
          memberCreated
            ? {
                accountGroupMemberships: [],
                billingStatus: HostedBillingStatus.not_started,
                createdAt: new Date("2026-03-26T12:00:00.000Z"),
                id: invite.memberId,
                invites: [invite],
                phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
                suspendedAt: null,
                threadContainer: null,
                updatedAt: new Date("2026-03-26T12:00:00.000Z"),
              }
            : null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const request = handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId: "evt_instant_start_fallback",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });
    if (retryable) {
      await expect(request).rejects.toMatchObject({
        code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_UNAVAILABLE",
        retryable: true,
      });
      expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
        .toHaveBeenCalledOnce();
      expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
        .not.toHaveBeenCalled();
      return;
    }

    await expect(request).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .toHaveBeenCalledOnce();
    expect(prismaMocks.hostedInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          instantStartAdmissionEventId: null,
        }),
      }),
    );
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining(invite.inviteCode),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    if (activationCommitted) {
      expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
        .toHaveBeenCalledWith({
          continuation: {
            hostedExecutionEventId: "member.activated:instant-start",
            memberId: invite.memberId,
          },
          prisma,
        });
    } else {
      expect(mocks.runHostedLinqInstantStartDeferredActivationWakeBestEffort)
        .not.toHaveBeenCalled();
    }
  });

  it("keeps a model-blocked instant-start candidate on the existing signup-link path when admission enforcement is off", async () => {
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      confidence: 0.98,
      kind: "block",
      source: "model",
    });
    const invite = {
      channel: "linq",
      id: "invite_model_block_fallback",
      inviteCode: "code_model_block_fallback",
      memberId: "member_model_block_fallback",
      sentAt: null,
      status: "pending",
    };
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
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
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: invite.memberId,
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          parts: [{ type: "text", value: "Hey Murph" }],
        },
        eventId: "evt_model_block_fallback",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledOnce();
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: expect.stringContaining(invite.inviteCode),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
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
      ...createHostedLinqAdmissionTables({
        onAttemptCreated: () => firstContactAdmissionOrder.push("claim"),
      }),
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
      ...createHostedLinqAdmissionTables(),
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
      hostedLinqFirstContactAdmissionBudget: createHostedLinqAdmissionTables({
        onAttemptCreated: () => admissionOrder.push("claim"),
      }).hostedLinqFirstContactAdmissionBudget,
      hostedLinqFirstContactAdmissionDecision: {
        createMany: transactionDecisionCreateMany,
        findMany: vi.fn().mockResolvedValue([]),
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
        findMany: vi.fn().mockResolvedValue([]),
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
      // Four attempts that never completed a classification: none of them is a
      // fail-open, so all four are chargeable and the cap stands.
      ...createHostedLinqAdmissionTables({
        attemptEventIds: [
          "evt_first_contact_attempt_1",
          "evt_first_contact_attempt_2",
          "evt_first_contact_attempt_3",
          "evt_first_contact_attempt_4",
        ],
      }),
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
    // the contact-history read, before model egress or any insert.
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.findFirst).toHaveBeenCalledWith({
      where: {
        eventId: "evt_first_contact_budget_exhausted",
        participantContactLookupKey: {
          in: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.findMany).toHaveBeenCalledWith({
      select: {
        eventId: true,
      },
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

  it("keeps offering group setup on later days by reusing one recorded first-contact allow", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    // The delivery row's idempotency key is the effect id, so a repeat of an
    // already-claimed effect is the real dedupe: one offer per key.
    const claimedEffectIds: string[] = [];
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockImplementation(
      async ({ idempotencyKey }: { idempotencyKey: string }) => {
        if (claimedEffectIds.includes(idempotencyKey)) {
          return { claimed: false, outcome: "completed" };
        }
        claimedEffectIds.push(idempotencyKey);
        return { claimed: true, id: `hld_group_setup_${claimedEffectIds.length}` };
      },
    );

    const prisma = asPrismaTransactionClient({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedLinqLine: buildManagedInboundHostedLinqLineFixture("+15550000000"),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
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

    // Four messages on one day plus one the next: more events than the
    // four-attempt lifetime cap, all from the same unresolved sender.
    for (
      const { createdAt, eventId } of [
        { createdAt: "2026-03-26T12:00:00.000Z", eventId: "evt_group_offer_day1_first" },
        { createdAt: "2026-03-26T13:00:00.000Z", eventId: "evt_group_offer_day1_second" },
        { createdAt: "2026-03-26T14:00:00.000Z", eventId: "evt_group_offer_day1_third" },
        { createdAt: "2026-03-26T15:00:00.000Z", eventId: "evt_group_offer_day1_fourth" },
        { createdAt: "2026-03-27T12:00:00.000Z", eventId: "evt_group_offer_day2_first" },
      ]
    ) {
      await expect(handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          createdAt,
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
            sender_handle: {
              handle: "+15551112222",
              id: "handle_group_stranger",
              service: "iMessage",
            },
            sent_at: createdAt,
          },
          eventId,
          service: "iMessage",
        }),
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ok: true,
        reason: "sent-group-setup",
      });
    }

    // One classifier call and one budget attempt for the contact's lifetime:
    // every later event re-plans on the stored allow.
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledWith({
      request: expect.objectContaining({
        eventId: "evt_group_offer_day1_first",
      }),
      signal: undefined,
    });
    expect(
      requireMock(
        prisma.hostedLinqFirstContactAdmissionBudget?.create,
        "hostedLinqFirstContactAdmissionBudget.create",
      ),
    ).toHaveBeenCalledTimes(1);
    // The offer itself stays one per chat per UTC day: three same-day repeats
    // claim nothing new, and the next day earns a fresh link.
    expect(claimedEffectIds).toHaveLength(2);
    expect(claimedEffectIds[0]).not.toBe(claimedEffectIds[1]);
    for (const effectId of claimedEffectIds) {
      expect(effectId).toMatch(/^linq-group-setup:/u);
    }
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
  });

  it("classifies a contact again once the classifier recovers from an outage that spanned four events", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    // A launch prefix, so the later direct message is a genuine instant-start
    // candidate and the entitlement assertions below have teeth.
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
    const classifierUnavailable = () => hostedOnboardingError({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "transport",
      },
      httpStatus: 503,
      message: "Linq first-contact admission classifier is unavailable.",
      retryable: true,
    });
    const outageEventIds = [
      "evt_outage_group_1",
      "evt_outage_group_2",
      "evt_outage_group_3",
      "evt_outage_group_4",
    ] as const;
    outageEventIds.forEach(() => {
      mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(
        classifierUnavailable(),
      );
    });

    const invite = {
      channel: "linq",
      id: "invite_after_outage",
      inviteCode: "code_after_outage",
      memberId: "member_after_outage",
      sentAt: null,
      status: "pending",
    };
    const prisma = asPrismaTransactionClient({
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: invite.id,
          sentAt: new Date("2026-03-30T12:00:01.000Z"),
        }),
        updateMany: vi.fn(),
      },
      hostedLinqLine: buildManagedInboundHostedLinqLineFixture("+15550000000"),
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          id: invite.memberId,
          phoneLookupKey: "+15551112222",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
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
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
    });
    const groupWebhook = (input: { createdAt: string; eventId: string }) =>
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          createdAt: input.createdAt,
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
            sender_handle: {
              handle: "+15551112222",
              id: "handle_group_stranger",
              service: "iMessage",
            },
            sent_at: input.createdAt,
          },
          eventId: input.eventId,
          service: "iMessage",
        }),
        signature: null,
        timestamp: null,
      });

    // Four events while OpenAI is unreachable. Each fails open, so each records
    // a deterministic allow that nobody may reuse.
    for (const [index, eventId] of outageEventIds.entries()) {
      await expect(groupWebhook({
        createdAt: `2026-03-2${6 + index}T12:00:00.000Z`,
        eventId,
      })).resolves.toMatchObject({
        ok: true,
        reason: "sent-group-setup",
      });
    }

    // The classifier recovers. The contact must still be reachable: an outage
    // alone may not spend the lifetime cap.
    const recoveredEventId = "evt_recovered_group";
    await expect(groupWebhook({
      createdAt: "2026-03-30T12:00:00.000Z",
      eventId: recoveredEventId,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(5);
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenNthCalledWith(5, {
      request: expect.objectContaining({ eventId: recoveredEventId }),
      signal: undefined,
    });

    // The ordinary direct path is reachable for the same contact too, on the
    // recovered model allow, and it mints no instant-start authority.
    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-03-30T13:00:00.000Z",
        data: {
          chat: {
            id: "chat_123",
            is_group: false,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
          sender_handle: {
            handle: "+15551112222",
            id: "handle_direct_stranger",
            service: "iMessage",
          },
          sent_at: "2026-03-30T13:00:00.000Z",
        },
        eventId: "evt_recovered_direct",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      ok: true,
      reason: "sent-signup-link",
    });

    // A replay of the recovered event reuses its own stored decision: no sixth
    // classification and no sixth attempt row.
    await expect(groupWebhook({
      createdAt: "2026-03-30T12:00:00.000Z",
      eventId: recoveredEventId,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(5);

    const budgetCreate = requireMock(
      prisma.hostedLinqFirstContactAdmissionBudget?.create,
      "hostedLinqFirstContactAdmissionBudget.create",
    );
    expect(
      (budgetCreate.mock.calls as [{ data: { eventId: string } }][])
        .map(([{ data }]) => data.eventId),
    ).toEqual([...outageEventIds, recoveredEventId]);

    // Every decision stays owned by the event that earned it: four fail-opens,
    // one model allow, and nothing at all for the direct message.
    const decisionCreateMany = requireMock(
      prisma.hostedLinqFirstContactAdmissionDecision?.createMany,
      "hostedLinqFirstContactAdmissionDecision.createMany",
    );
    expect(
      (decisionCreateMany.mock.calls as [{ data: { eventId: string; source: string } }][])
        .map(([{ data }]) => [data.eventId, data.source]),
    ).toEqual([
      ...outageEventIds.map((eventId) => [eventId, "deterministic"]),
      [recoveredEventId, "model"],
    ]);

    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment).not.toHaveBeenCalled();
    const inviteCreate = requireMock(
      prisma.hostedInvite?.create,
      "hostedInvite.create",
    );
    for (const [{ data }] of inviteCreate.mock.calls as [
      { data: { instantStartAdmissionEventId?: string | null } },
    ][]) {
      expect(data.instantStartAdmissionEventId ?? null).toBeNull();
    }
    const identityCreateMany = requireMock(
      prisma.hostedMemberIdentity?.createMany,
      "hostedMemberIdentity.createMany",
    );
    for (const [{ data }] of identityCreateMany.mock.calls as [
      { data: { phoneNumberVerifiedAt?: Date | null } },
    ][]) {
      expect(data.phoneNumberVerifiedAt ?? null).toBeNull();
    }
  });

  it("admits a direct first contact whose contact recorded an allow after the attempt cap filled", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

    const invite = {
      channel: "linq",
      id: "invite_after_group_offers",
      inviteCode: "code_after_group_offers",
      memberId: "member_after_group_offers",
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
        // Four group offers already used the contact-global lifetime cap.
        count: vi.fn().mockResolvedValue(4),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_group_offer_1" },
          { eventId: "evt_group_offer_2" },
          { eventId: "evt_group_offer_3" },
          { eventId: "evt_group_offer_4" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        // The winning classifier call recorded its allow only after the
        // concurrent events had already claimed the last attempt slots.
        findMany: vi.fn().mockResolvedValue([{
          confidence: 0.93,
          decision: "allow",
          eventId: "evt_group_offer_2",
          source: "model",
        }]),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            confidence: 0.93,
            decision: "allow",
            eventId: "evt_direct_after_group_offers",
            source: "model",
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
        eventId: "evt_direct_after_group_offers",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: invite.inviteCode,
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
  });

  it("never lends an earlier group allow to a launch-prefix direct first contact as instant-start authority", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    // The production default prefix list includes +1, so the later direct
    // message below is a genuine instant-start candidate.
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];

    const groupAdmissionEventId = "evt_group_offer_model_allow";
    // The contact's only classification happened on a group message, which may
    // never mint instant-start entitlement for a different inbound.
    const budgetRows = [{ eventId: groupAdmissionEventId }];
    const decisionRows = new Map<string, Record<string, unknown>>([
      [groupAdmissionEventId, {
        confidence: 0.9,
        decision: "allow",
        eventId: groupAdmissionEventId,
        source: "model",
      }],
    ]);
    const invite = {
      channel: "linq",
      id: "invite_direct_after_group_allow",
      inviteCode: "code_direct_after_group_allow",
      memberId: "member_direct_after_group_allow",
      sentAt: null,
      status: "pending",
    };
    // The admission tables outlive one webhook attempt; the rest of the
    // fixture is rebuilt per attempt so the retry is a clean redelivery.
    const budgetCreate = vi.fn(async ({ data }: { data: { eventId: string } }) => {
      budgetRows.push({ eventId: data.eventId });
      return data;
    });
    const decisionCreateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (typeof data.eventId !== "string" || decisionRows.has(data.eventId)) {
        return { count: 0 };
      }
      decisionRows.set(data.eventId, data);
      return { count: 1 };
    });
    const inviteCreate = vi.fn().mockResolvedValue(invite);
    const buildDirectAttemptPrisma = () => asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn(async () => budgetRows.length),
        create: budgetCreate,
        findFirst: vi.fn(async ({ where }: { where: { eventId: string } }) =>
          budgetRows.find((row) => row.eventId === where.eventId) ?? null),
        findMany: vi.fn(async () => budgetRows.map(({ eventId }) => ({ eventId }))),
      },
      hostedLinqFirstContactAdmissionDecision: {
        createMany: decisionCreateMany,
        findMany: vi.fn(async ({ where }: {
          where: { decision?: string; eventId?: { in?: string[] } };
        }) =>
          [...decisionRows.values()].filter((row) =>
            (where.decision === undefined || row.decision === where.decision)
            && (where.eventId?.in ?? []).includes(String(row.eventId))
          )),
        findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
          decisionRows.get(where.eventId) ?? null),
      },
      hostedInvite: {
        create: inviteCreate,
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
    });

    const attempts = [buildDirectAttemptPrisma(), buildDirectAttemptPrisma()];
    const directWebhook = (prisma: ReturnType<typeof buildDirectAttemptPrisma>) =>
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          data: {
            chat: {
              id: "chat_123",
              is_group: false,
              owner_handle: {
                handle: "+15550000000",
                id: "handle_owner_123",
                is_me: true,
                service: "iMessage",
              },
            },
            parts: [{ type: "text", value: "Limited spots left on our program." }],
          },
          eventId: "evt_direct_after_group_allow",
          service: "iMessage",
        }),
        signature: null,
        timestamp: null,
      });

    // The delivery attempt and its redelivery must both land on the ordinary
    // signup link, never on instant start.
    for (const attempt of attempts) {
      await expect(directWebhook(attempt)).resolves.toMatchObject({
        inviteCode: invite.inviteCode,
        ok: true,
        reason: "sent-signup-link",
      });
    }

    // The earlier allow satisfies the gate without spending an attempt or a
    // classifier call, and it is never copied onto this event: the model-source
    // proof stays owned by the event the model actually judged, so no retry can
    // read instant-start authority back out of the decision table.
    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(budgetCreate).not.toHaveBeenCalled();
    expect(decisionCreateMany).not.toHaveBeenCalled();
    expect([...decisionRows.keys()]).toEqual([groupAdmissionEventId]);
    // No instant-start entitlement: no trial enrollment, no admission id on the
    // invite, and no phone verified off the back of a group classification.
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment).not.toHaveBeenCalled();
    expect(inviteCreate).toHaveBeenCalledTimes(attempts.length);
    for (const [{ data }] of inviteCreate.mock.calls as [
      { data: { instantStartAdmissionEventId?: string | null } },
    ][]) {
      expect(data.instantStartAdmissionEventId ?? null).toBeNull();
    }
    for (const attempt of attempts) {
      const identityCreateMany = requireMock(
        attempt.hostedMemberIdentity?.createMany,
        "hostedMemberIdentity.createMany",
      );
      expect(identityCreateMany).toHaveBeenCalled();
      for (const [call] of identityCreateMany.mock.calls as [
        { data: { phoneNumberVerifiedAt?: Date | null } },
      ][]) {
        expect(call.data.phoneNumberVerifiedAt ?? null).toBeNull();
      }
    }
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

  it("fails open to the signup link, not instant start, when the classifier is unavailable", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.hostedOnboardingEnvironment.linqInstantStartPhonePrefixes = ["+1"];
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
      ...createHostedLinqAdmissionTables(),
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
    expect(mocks.ensureHostedLinqInstantStartPulseTrialEnrollment)
      .not.toHaveBeenCalled();
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
      ...createHostedLinqAdmissionTables(),
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
      // The contact is already at the cap, and this event is one of the four
      // attempts: a transport retry of an already-claimed event still
      // classifies rather than short-circuiting.
      ...createHostedLinqAdmissionTables({
        attemptEventIds: [
          eventId,
          "evt_classifier_transport_retry_other_1",
          "evt_classifier_transport_retry_other_2",
          "evt_classifier_transport_retry_other_3",
        ],
      }),
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

  it("keeps member-initiated first contact on the incoming line when weighted planning prefers a paced-out fallback", async () => {
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
            _count: { _all: 500 },
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
            maxNewConversationsPerDay: 1,
            phoneNumber: fallbackLinePhone,
            proactiveConversationCount: 1,
            proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
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
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(incomingLinePhone),
        pendingLinqChatLookupKey: expect.any(String),
      }),
    }));
    expect(hostedMemberRouting.groupBy).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        linqHomeLineAssignedAt: { gte: expect.any(Date) },
      }),
    }));
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markHostedLinqOnboardingLinkNoticeSent.mock.invocationCallOrder[0],
    );
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_123",
      message: expect.stringContaining("https://join.example.test/join/code_fallback_quota"),
    }));
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
            maxNewConversationsPerDay: 10,
            phoneNumber: fallbackLinePhone,
            proactiveConversationCount: 9,
            proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
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
    expect(prismaMocks.hostedLinqLine.updateMany).toHaveBeenCalledWith({
      data: {
        proactiveConversationCount: { increment: 1 },
      },
      where: {
        phoneNumberLookupKey: createHostedPhoneLookupKey(fallbackLinePhone),
        proactiveConversationCount: { lt: 10 },
        proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
      },
    });
  });

  it("retries before claiming capacity when concurrent routing changes the fallback line", async () => {
    const incomingLinePhone = "+15550000000";
    const selectedFallbackPhone = "+15550100001";
    const concurrentHomePhone = "+15550100002";
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    hostedMemberRouting.findUnique.mockResolvedValue({
      linqChatIdEncrypted: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T11:59:00.000Z"),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId: "member_123",
        value: concurrentHomePhone,
      }),
      linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(concurrentHomePhone),
      memberId: "member_123",
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    });
    const hostedLinqLine = buildHostedLinqLinePoolFixture({
      lines: [{
        phoneNumber: selectedFallbackPhone,
      }],
    });
    const concurrentMember = {
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
      suspendedAt: null,
    };
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqLine,
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(concurrentMember),
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

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_degraded_concurrent_route",
            owner_handle: {
              handle: incomingLinePhone,
              id: "handle_owner_degraded_concurrent_route",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_fallback_concurrent_route",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_HOME_ROUTE_CHANGED",
      retryable: true,
    });

    expect(hostedLinqLine.updateMany).not.toHaveBeenCalled();
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
  });

  it.each([
    {
      eventId: "evt_fallback_degraded_capped",
      maxNewConversationsPerDay: 10,
      proactiveConversationCount: 10,
      scenario: "every healthy line is already capped",
    },
    {
      eventId: "evt_fallback_claim_lost",
      maxNewConversationsPerDay: null,
      proactiveConversationCount: 49,
      scenario: "the final capacity claim loses",
    },
  ])("commits only inbound identity when $scenario", async ({
    eventId,
    maxNewConversationsPerDay,
    proactiveConversationCount,
  }) => {
    const incomingLinePhone = "+15550000000";
    const fallbackLinePhone = "+15550100001";
    const hostedMemberRouting = createStatefulHostedMemberRoutingMock();
    const hostedLinqLine = buildHostedLinqLinePoolFixture({
      lines: [{
        maxNewConversationsPerDay,
        phoneNumber: fallbackLinePhone,
        proactiveConversationCount,
        proactiveConversationDayUtc: startOfUtcDayForTest(new Date()),
      }],
    });
    const updateHostedLinqLine = hostedLinqLine.updateMany;
    if (!updateHostedLinqLine) {
      throw new Error("Expected hosted Linq line update fixture.");
    }
    updateHostedLinqLine.mockResolvedValue({ count: 0 });
    const hostedInviteCreate = vi.fn();
    const hostedLinqDeliveryCreate = vi.fn();
    const hostedLinqDeliveryUpsert = vi.fn();
    const hostedMemberCreate = vi.fn(async (input: {
      data: {
        billingStatus: HostedBillingStatus;
        id: string;
      };
    }) => ({
      billingStatus: input.data.billingStatus,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      id: input.data.id,
      suspendedAt: null,
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    }));
    const hostedMemberIdentityCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedLinqDelivery: {
        create: hostedLinqDeliveryCreate,
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: hostedLinqDeliveryUpsert,
      },
      hostedLinqLine,
      hostedMember: {
        create: hostedMemberCreate,
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        createMany: hostedMemberIdentityCreateMany,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting,
      hostedWebhookReceipt: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = withPrismaTransaction({
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
    }, transactionClient);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: `chat_${eventId}`,
            owner_handle: {
              handle: incomingLinePhone,
              id: `handle_owner_${eventId}`,
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId,
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
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(hostedMemberCreate).toHaveBeenCalledTimes(1);
    const createdMemberId = hostedMemberCreate.mock.calls[0]?.[0].data.id;
    expect(createdMemberId).toEqual(expect.any(String));
    expect(hostedMemberIdentityCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        memberId: createdMemberId,
        phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
      }),
      skipDuplicates: true,
    }));
    expect(updateHostedLinqLine).toHaveBeenCalledTimes(2);
    expect(hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(hostedInviteCreate).not.toHaveBeenCalled();
    expect(hostedLinqDeliveryCreate).not.toHaveBeenCalled();
    expect(hostedLinqDeliveryUpsert).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
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
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(HOME_REDIRECT_EXPLICIT_RESEND_PATTERN),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
    expect(readHostedWebhookReceiptCreateMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
  });

  it("replies with the trial-conversion notice when a paused member texts their bound home chat", async () => {
    const fixture = await buildPausedHostedMemberHomeRouteFixture();
    const scheduledTasks: Array<() => Promise<void>> = [];
    const prisma = asPrismaTransactionClient({
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(fixture.member),
      },
      hostedMemberRouting: createSingleHostedMemberRoutingMock(fixture.routing),
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-07-23T12:00:00.000Z",
        data: {
          chat: {
            id: fixture.homeChatId,
            owner_handle: {
              handle: fixture.homeLinePhone,
              id: "handle_owner_home",
              is_me: true,
              service: "iMessage",
            },
          },
          sent_at: "2026-07-23T12:00:00.000Z",
        },
        eventId: "evt_paused_home_notice",
        service: "iMessage",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    });

    for (const task of scheduledTasks) {
      await task();
    }

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-trial-conversion-notice",
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: fixture.homeChatId,
        message: expect.stringContaining("https://withmurph.ai/settings#subscription"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("replies with the billing-inactive notice when a past_due member texts their bound home chat", async () => {
    const fixture = await buildPausedHostedMemberHomeRouteFixture({
      billingStatus: HostedBillingStatus.past_due,
    });
    const scheduledTasks: Array<() => Promise<void>> = [];
    const prisma = asPrismaTransactionClient({
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(fixture.member),
      },
      hostedMemberRouting: createSingleHostedMemberRoutingMock(fixture.routing),
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-07-23T12:00:00.000Z",
        data: {
          chat: {
            id: fixture.homeChatId,
            owner_handle: {
              handle: fixture.homeLinePhone,
              id: "handle_owner_home",
              is_me: true,
              service: "iMessage",
            },
          },
          sent_at: "2026-07-23T12:00:00.000Z",
        },
        eventId: "evt_past_due_home_notice",
        service: "iMessage",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    });

    for (const task of scheduledTasks) {
      await task();
    }

    // A lapsed paying member must never reach the first-contact pending bind,
    // which would raise HOSTED_LINQ_HOME_ROUTE_CHANGED on every provider retry.
    expect(response).toMatchObject({
      ok: true,
      reason: "sent-billing-inactive-notice",
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: fixture.homeChatId,
        message: expect.stringContaining("https://withmurph.ai/settings#subscription"),
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  // Every lapsed-after-activation billing state must answer on the member's own
  // bound home chat. Reaching the first-contact tail here raises a retryable
  // HOSTED_LINQ_HOME_ROUTE_CHANGED that can never succeed, which silently drops
  // the message on every provider retry.
  it.each([
    [HostedBillingStatus.paused, "sent-trial-conversion-notice"],
    [HostedBillingStatus.past_due, "sent-billing-inactive-notice"],
    [HostedBillingStatus.canceled, "sent-billing-inactive-notice"],
    [HostedBillingStatus.unpaid, "sent-billing-inactive-notice"],
    // `incomplete` reaches here only because the fixture owns a subscription;
    // a first-time `incomplete` member has none and stays on the signup path.
    [HostedBillingStatus.incomplete, "sent-billing-inactive-notice"],
  ] as const)(
    "answers a %s member on their bound home chat instead of dropping the text",
    async (billingStatus, expectedReason) => {
      const fixture = await buildPausedHostedMemberHomeRouteFixture({ billingStatus });
      const scheduledTasks: Array<() => Promise<void>> = [];
      const prisma = asPrismaTransactionClient({
        hostedLinqProviderEvent: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
        hostedMember: { findUnique: vi.fn().mockResolvedValue(fixture.member) },
        hostedMemberRouting: createSingleHostedMemberRoutingMock(fixture.routing),
      });

      const response = await handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          createdAt: "2026-07-23T12:00:00.000Z",
          data: {
            chat: {
              id: fixture.homeChatId,
              owner_handle: {
                handle: fixture.homeLinePhone,
                id: "handle_owner_home",
                is_me: true,
                service: "iMessage",
              },
            },
            sent_at: "2026-07-23T12:00:00.000Z",
          },
          eventId: `evt_lapsed_${billingStatus}`,
          service: "iMessage",
        }),
        scheduleAfterResponse: (task) => {
          scheduledTasks.push(task);
        },
        signature: null,
        timestamp: null,
      });

      for (const task of scheduledTasks) {
        await task();
      }

      expect(response).toMatchObject({ ok: true, reason: expectedReason });
      expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: fixture.homeChatId,
          message: expect.stringContaining("https://withmurph.ai/settings#subscription"),
        }),
      );
      expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
      expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
      expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    },
  );

  it("keeps the home-line redirect when a paused member texts another hosted line", async () => {
    const fixture = await buildPausedHostedMemberHomeRouteFixture();
    const scheduledTasks: Array<() => Promise<void>> = [];
    const prisma = asPrismaTransactionClient({
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(fixture.member),
      },
      hostedMemberRouting: createSingleHostedMemberRoutingMock(fixture.routing),
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-07-23T12:00:00.000Z",
        data: {
          chat: {
            id: "chat_other_paused",
            owner_handle: {
              handle: "+15550100002",
              id: "handle_owner_other_paused",
              is_me: true,
              service: "iMessage",
            },
          },
          sent_at: "2026-07-23T12:00:00.000Z",
        },
        eventId: "evt_paused_other_redirect",
        service: "iMessage",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    });

    for (const task of scheduledTasks) {
      await task();
    }

    expect(response).toMatchObject({
      ok: true,
      reason: "redirected-to-home-line",
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_other_paused",
        message: expect.stringContaining(fixture.homeLinePhone),
        replyToMessageId: "msg_123",
      }),
    );
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("answers a bound-home member with no billing to recover instead of retrying forever", async () => {
    const fixture = await buildPausedHostedMemberHomeRouteFixture();
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({
      allowed: false,
      reason: "hosted_access_inactive",
      retryAfter: new Date("2026-07-23T12:15:00.000Z"),
      userNotice: null,
    });
    const prisma = asPrismaTransactionClient({
      // Recovery runs after the planner transaction rolled back, so it opens
      // its own transaction on the top-level client.
      $transaction: vi.fn(
        async (run: (tx: unknown) => unknown) => run(prisma),
      ) as never,
      hostedInvite: {
        create: vi.fn().mockResolvedValue({
          expiresAt: new Date("2026-07-24T12:00:00.000Z"),
          id: "hin_recovery",
          inviteCode: "recovery_invite_code",
        }),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ inviteCode: "recovery_invite_code" }),
        update: vi.fn(),
      },
      hostedLinqProviderEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedWebhookReceipt: buildHostedWebhookReceiptFixture(),
      hostedMember: { findUnique: vi.fn().mockResolvedValue(fixture.member) },
      hostedMemberRouting: createSingleHostedMemberRoutingMock(fixture.routing),
    });

    // No notice means there is no billing to recover, so this member belongs on
    // the signup journey rather than being answered as a lapsed member. The
    // permanent-route guard still owns the storage layer: it aborts the
    // transaction, and recovery then answers on the chat the member used.
    const scheduledTasks: Array<() => Promise<void> | void> = [];
    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        createdAt: "2026-07-23T12:00:00.000Z",
        data: {
          chat: {
            id: fixture.homeChatId,
            owner_handle: {
              handle: fixture.homeLinePhone,
              id: "handle_owner_home",
              is_me: true,
              service: "iMessage",
            },
          },
          sent_at: "2026-07-23T12:00:00.000Z",
        },
        eventId: "evt_home_without_notice",
        service: "iMessage",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    });

    for (const task of scheduledTasks) {
      await task();
    }

    expect(response).toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: fixture.homeChatId }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("appends active-member Linq input even when the usage gate would deny", async () => {
    mocks.checkHostedAiUsageGate.mockRejectedValueOnce(
      new Error("webhook usage gate should not run"),
    );
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
      reason: "wake-appended-active-member",
    });
    expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "evt_ai_usage_limit",
          kind: "conversation.message",
          message: expect.objectContaining({
            channel: "linq",
            linqMessage: expect.objectContaining({
              chatId: "chat_123",
              messageId: "msg_123",
            }),
          }),
          userId: "member_123",
        }),
      }),
    );
    expectHostedLinqPointerSignalAccepted("evt_ai_usage_limit");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
  });

  it.each([
    {
      label: "commits every admitted direct-home transition",
      overQuota: false,
    },
    {
      label: "does not commit a transition when the daily quota suppresses the input",
      overQuota: true,
    },
  ])("$label", async ({ overQuota }) => {
    mocks.checkHostedAiUsageGate.mockRejectedValueOnce(
      new Error("webhook usage gate should not run"),
    );
    if (overQuota) {
      mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
        inboundCount: HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
        quotaReplySentAt: new Date("2026-03-26T12:01:00.000Z"),
      }));
    }
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

    expect(response).toMatchObject(overQuota
      ? {
          ignored: true,
          ok: true,
          reason: "daily-quota-reached",
        }
      : {
          ok: true,
          reason: "wake-appended-active-member",
        });
    expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
    if (overQuota) {
      expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
      expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    } else {
      expect(readHostedMemberRoutingUpsertMock(prisma))
        .toHaveBeenCalledTimes(1);
      expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            eventId: "evt_ai_usage_limit_current_chat",
            kind: "conversation.message",
            message: expect.objectContaining({
              channel: "linq",
              linqMessage: expect.objectContaining({
                chatId: "chat_current_inbound",
                messageId: "msg_123",
              }),
            }),
            userId: "member_123",
          }),
        }),
      );
      expectHostedLinqPointerSignalAccepted("evt_ai_usage_limit_current_chat");
      expectHostedLinqReadReceiptSent("chat_current_inbound");
    }
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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

  it("refuses to rebind a member's home chat when canonical chat classification is unavailable", async () => {
    const classificationError = new Error("Linq chat read unavailable");
    mocks.getHostedLinqChatSummary.mockRejectedValueOnce(classificationError);
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
    await expect(handleHostedOnboardingLinqWebhook({
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
    })).rejects.toMatchObject({
      cause: classificationError,
      code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });
    expect(readHostedMemberRoutingUpsertMock(prisma)).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not change a current home route when canonical chat classification is unavailable", async () => {
    const classificationError = new Error("Linq chat read unavailable");
    mocks.getHostedLinqChatSummary.mockRejectedValueOnce(classificationError);
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

    await expect(handleHostedOnboardingLinqWebhook({
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
    })).rejects.toMatchObject({
      cause: classificationError,
      code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
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

  it("keeps daily quota suppression ahead of mailbox append", async () => {
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
    expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
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

/**
 * A fully configured, healthy managed line. Inbound line state (unlike
 * assignment eligibility) also reads `configuredAt` and the health/provider
 * columns, so unknown-group setup recovery needs them populated.
 */
function buildManagedInboundHostedLinqLineFixture(
  phoneNumber: string,
): HostedLinqLineFixture {
  const phoneNumberLookupKey = createHostedPhoneLookupKey(phoneNumber);
  return {
    findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } }) => {
      const lookupKeys = new Set(query.where?.phoneNumberLookupKey?.in ?? []);
      return (
        lookupKeys.size === 0
        || createHostedPhoneLookupKeyReadCandidates(phoneNumber).some((lookupKey) =>
          lookupKeys.has(lookupKey)
        )
      )
        ? [{
            activeMemberLimit: null,
            assignmentWeight: 1,
            configuredAt: new Date("2026-03-26T00:00:00.000Z"),
            egressPolicy: "enabled",
            healthStatus: "healthy",
            maxNewConversationsPerDay: null,
            phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
            phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
            phoneNumberLookupKey,
            providerReputationStatus: "HEALTHY",
            providerServiceStatus: "ACTIVE",
          }]
        : [];
    }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ phoneNumberLookupKey }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({ phoneNumberLookupKey }),
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
    proactiveConversationCount?: number | null;
    proactiveConversationDayUtc?: Date | null;
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
    proactiveConversationCount: line.proactiveConversationCount ?? null,
    proactiveConversationDayUtc: line.proactiveConversationDayUtc ?? null,
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

      return matchingRows.map((row) => ({
        activeMemberLimit: row.activeMemberLimit,
        assignmentWeight: row.assignmentWeight,
        maxNewConversationsPerDay: row.maxNewConversationsPerDay,
        phoneNumberEncrypted: row.phoneNumberEncrypted,
        phoneNumberHint: row.phoneNumberHint,
        phoneNumberLookupKey: row.phoneNumberLookupKey,
        proactiveConversationCount: row.proactiveConversationCount,
        proactiveConversationDayUtc: row.proactiveConversationDayUtc,
      }));
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

function startOfUtcDayForTest(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
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

  // Inbound planning consults pending pre-member group-join outreach to recover
  // the originating group. These fixtures have no outreach rows.
  if (!prisma.hostedGroupJoinOutreach?.findMany) {
    Object.defineProperty(prisma, "hostedGroupJoinOutreach", {
      configurable: true,
      value: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
  }

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
    hostedInvite.findUnique = vi.fn(async (input: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
      if (input.select?.id === true && typeof input.where?.id === "string") {
        return { id: input.where.id };
      }
      return hostedInvite.findFirst?.({
        select: input.select,
        where: input.where,
      });
    });
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
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
  } else {
    prisma.hostedThreadRoute.findFirst ??= vi.fn().mockResolvedValue(null);
    prisma.hostedThreadRoute.groupBy ??= vi.fn().mockResolvedValue([]);
    prisma.hostedThreadRoute.updateMany ??= vi.fn().mockResolvedValue({ count: 1 });
  }
  if (!prisma.hostedUsageReferral?.findUnique) {
    Object.defineProperty(prisma, "hostedUsageReferral", {
      configurable: true,
      value: {
        findUnique: vi.fn().mockResolvedValue(null),
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

  const defaultAdmissionTables = createHostedLinqAdmissionTables();
  if (!hostedLinqFirstContactAdmissionDecision?.findUnique || !hostedLinqFirstContactAdmissionDecision?.createMany) {
    Object.defineProperty(prisma, "hostedLinqFirstContactAdmissionDecision", {
      configurable: true,
      value: defaultAdmissionTables.hostedLinqFirstContactAdmissionDecision,
    });
  }

  if (
    !hostedLinqFirstContactAdmissionBudget?.findFirst
    || !hostedLinqFirstContactAdmissionBudget?.create
    || !hostedLinqFirstContactAdmissionBudget?.count
  ) {
    Object.defineProperty(prisma, "hostedLinqFirstContactAdmissionBudget", {
      configurable: true,
      value: defaultAdmissionTables.hostedLinqFirstContactAdmissionBudget,
    });
  }

  return prisma as T & HostedOnboardingLinqWebhookPrismaFixture;
}

type HostedLinqAdmissionDecisionRow = {
  confidence: number;
  decision: string;
  eventId: string;
  source: string;
};

/**
 * One stateful stand-in for the two first-contact admission tables. The claim
 * derives the contact's chargeable attempt count and its reusable allow by
 * joining budget rows to decision rows on the event id, so a double that
 * answers a fixed count cannot express the scenarios these tests describe.
 * Seed `attemptEventIds` and `decisions` to state the contact's prior history;
 * everything written during the run is read back the way Postgres would.
 */
function createHostedLinqAdmissionTables(input: {
  attemptEventIds?: readonly string[];
  decisions?: readonly HostedLinqAdmissionDecisionRow[];
  onAttemptCreated?: (eventId: string) => void;
} = {}) {
  const attempts = (input.attemptEventIds ?? []).map((eventId) => ({
    eventId,
    participantContactKind: "phone",
    participantContactLookupKey: null as string | null,
  }));
  const decisions = new Map<string, HostedLinqAdmissionDecisionRow>(
    (input.decisions ?? []).map((row) => [row.eventId, row]),
  );
  // Seeded rows belong to whichever contact the test is exercising, so they
  // match every lookup-key candidate; rows written during the run carry the
  // key the claim inserted.
  const matchesContact = (
    row: { participantContactLookupKey: string | null },
    where: { participantContactLookupKey?: { in?: string[] } },
  ) => row.participantContactLookupKey === null
    || (where.participantContactLookupKey?.in ?? []).includes(
      row.participantContactLookupKey,
    );

  return {
    hostedLinqFirstContactAdmissionBudget: {
      count: vi.fn(async ({ where }: {
        where: { participantContactLookupKey?: { in?: string[] } };
      }) => attempts.filter((row) => matchesContact(row, where)).length),
      create: vi.fn(async ({ data }: {
        data: {
          eventId: string;
          participantContactKind: string;
          participantContactLookupKey: string;
        };
      }) => {
        attempts.push({ ...data });
        input.onAttemptCreated?.(data.eventId);
        return data;
      }),
      findFirst: vi.fn(async ({ where }: {
        where: { eventId: string; participantContactLookupKey?: { in?: string[] } };
      }) =>
        attempts.find((row) =>
          row.eventId === where.eventId && matchesContact(row, where)
        ) ?? null),
      findMany: vi.fn(async ({ where }: {
        where: { participantContactLookupKey?: { in?: string[] } };
      }) =>
        attempts
          .filter((row) => matchesContact(row, where))
          .map(({ eventId }) => ({ eventId }))),
    },
    hostedLinqFirstContactAdmissionDecision: {
      // `decision.eventId` is the primary key and inserts are
      // `skipDuplicates`, so the first write for an event wins.
      createMany: vi.fn(async ({ data }: { data: HostedLinqAdmissionDecisionRow }) => {
        if (decisions.has(data.eventId)) {
          return { count: 0 };
        }
        decisions.set(data.eventId, data);
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ where }: {
        where: { eventId?: { in?: string[] } };
      }) => {
        const eventIds = where.eventId?.in ?? null;
        return [...decisions.values()].filter((row) =>
          !eventIds || eventIds.includes(row.eventId)
        );
      }),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
        decisions.get(where.eventId) ?? null),
    },
  };
}

function createSingleHostedMemberRoutingMock(record: Record<string, unknown>) {
  const matchesLookup = (where: Record<string, unknown> | undefined, key: string) => {
    const condition = where?.[key];
    if (typeof condition === "string") {
      return record[key] === condition;
    }
    if (typeof condition !== "object" || condition === null || !("in" in condition)) {
      return true;
    }
    const values = (condition as { in?: unknown }).in;
    return Array.isArray(values) && values.includes(record[key]);
  };
  const matchesWhere = (where: Record<string, unknown> | undefined) => {
    const excluded = where?.NOT;
    if (
      typeof excluded === "object"
      && excluded !== null
      && "memberId" in excluded
      && record.memberId === (excluded as { memberId?: unknown }).memberId
    ) {
      return false;
    }

    return matchesLookup(where, "memberId")
      && matchesLookup(where, "linqChatLookupKey")
      && matchesLookup(where, "pendingLinqParticipantContactLookupKey")
      && matchesLookup(where, "pendingLinqChatLookupKey");
  };

  return {
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      matchesWhere(where) ? record : null),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      matchesWhere(where) ? [record] : []),
    findUnique: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      matchesWhere(where) ? record : null),
    groupBy: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn(),
  };
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

type PausedHostedMemberBillingRefFixture = {
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  pulseTrialPolicyVersion: string | null;
  pulseTrialRedeemedAt: Date | null;
};

async function buildPausedHostedMemberHomeRouteFixture(input: {
  billingRef?: PausedHostedMemberBillingRefFixture;
  billingStatus?: HostedBillingStatus;
} = {}) {
  const billingStatus = input.billingStatus ?? HostedBillingStatus.paused;
  const memberId = "member_paused";
  const homeChatId = "chat_paused_home";
  const homeLinePhone = "+15550100001";
  const createdAt = new Date("2026-07-03T12:00:00.000Z");
  const updatedAt = new Date("2026-07-13T12:00:00.000Z");
  const linqChatIdEncrypted = await encryptHostedWebNullableString({
    field: "hosted-member-routing.home-linq-chat-id",
    memberId,
    value: homeChatId,
  });
  const linqRecipientPhoneEncrypted = await encryptHostedWebNullableString({
    field: "hosted-member-routing.home-linq-recipient-phone",
    memberId,
    value: homeLinePhone,
  });
  const routing = {
    linqChatIdEncrypted,
    linqChatLookupKey: createHostedLinqChatLookupKey(homeChatId),
    linqHomeLineAssignedAt: createdAt,
    linqParticipantContactKind: "phone",
    linqParticipantContactLookupKey: createHostedPhoneLookupKey("+15551234567"),
    linqRecipientPhoneEncrypted,
    linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(homeLinePhone),
    member: {
      billingStatus,
      createdAt,
      id: memberId,
      suspendedAt: null,
      updatedAt,
    },
    memberId,
    pendingLinqChatIdEncrypted: null,
    pendingLinqChatLookupKey: null,
    pendingLinqParticipantContactEncrypted: null,
    pendingLinqParticipantContactKind: null,
    pendingLinqParticipantContactLookupKey: null,
    pendingLinqParticipantContactObservedAt: null,
    pendingLinqRecipientPhoneEncrypted: null,
    pendingLinqRecipientPhoneLookupKey: null,
    replyAliasLookupKey: null,
    telegramUserIdEncrypted: null,
    telegramUserLookupKey: null,
  };

  return {
    homeChatId,
    homeLinePhone,
    member: {
      accountGroupMemberships: [],
      billingRef: input.billingRef ?? {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-07-13T12:00:00.000Z"),
        currentTrialStartedAt: createdAt,
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: createdAt,
        stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:existing",
      },
      billingStatus,
      createdAt,
      id: memberId,
      invites: [],
      phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
      routing,
      suspendedAt: null,
      threadContainer: null,
      updatedAt,
    },
    routing,
  };
}

function buildHostedWebhookReceiptFixture() {
  return {
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({
      payloadJson: {
        eventType: "message.received",
        receiptAttemptCount: 1,
        receiptStatus: "processing",
      },
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
  chatId?: string | null;
  createdAt?: string;
  eventId: string;
  eventType: "message.delivered" | "message.failed" | "message.sent";
  messageId: string;
  service?: string;
}): HostedLinqWebhookEvent {
  const service = input.service ?? "iMessage";
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-26T12:00:02.000Z",
    data: {
      ...(input.chatId === null
        ? {}
        : { chat_id: input.chatId ?? "chat_123" }),
      error: input.eventType === "message.failed"
        ? {
            code: "30007",
            message: "carrier filtered",
          }
        : undefined,
      message_id: input.messageId,
      phone_number: "+15550000000",
      service,
    },
    event_id: input.eventId,
    event_type: input.eventType,
    trace_id: "trace_delivery_receipt",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}

function createHostedLinqDeliveryReceiptWebhookPrisma(input: {
  providerEventCreateCounts?: readonly number[];
  receiptUpdateCounts?: readonly number[];
  sourceRef: string;
  template: "ai_usage_quota" | "invite_signup" | "invite_signup_fallback";
}): HostedOnboardingLinqWebhookPrismaFixture {
  const providerEventCreateCounts = input.providerEventCreateCounts ?? [1];
  const hostedLinqProviderEventCreateMany = vi.fn().mockResolvedValue({
    count: providerEventCreateCounts[providerEventCreateCounts.length - 1] ?? 1,
  });
  for (const count of providerEventCreateCounts) {
    hostedLinqProviderEventCreateMany.mockResolvedValueOnce({ count });
  }

  const receiptUpdateCounts = input.receiptUpdateCounts ?? [1];
  const hostedLinqDeliveryUpdateMany = vi.fn().mockResolvedValue({
    count: receiptUpdateCounts[receiptUpdateCounts.length - 1] ?? 1,
  });
  for (const count of receiptUpdateCounts) {
    hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count });
  }

  const prisma = asPrismaTransactionClient({
    hostedLinqAlert: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedLinqDelivery: {
      findFirst: vi.fn().mockResolvedValue({
        id: "hld_signup_receipt",
        idempotencyKey: null,
        phoneNumberLookupKey: null,
        sourceRef: input.sourceRef,
        template: input.template,
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: hostedLinqDeliveryUpdateMany,
    },
    hostedLinqLine: buildHostedLinqLineFixture({
      phoneNumber: "+15550000000",
    }),
    hostedLinqProviderEvent: {
      createMany: hostedLinqProviderEventCreateMany,
      findUnique: vi.fn().mockResolvedValue({
        groupJoinOfferHandledAt: null,
      }),
    },
  });
  prisma.$transaction = vi.fn(async (
    operation: (transaction: HostedOnboardingLinqWebhookPrismaFixture) => Promise<unknown>,
  ) => operation(prisma));
  return prisma;
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
} = {}): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat_id: "chat_typing_123",
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return {
    promise,
    resolve,
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
