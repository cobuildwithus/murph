import type { PrismaClient } from "@prisma/client";
import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE, MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS } from "@murphai/contracts";
import type { Response as OpenAiResponse } from "openai/resources/responses/responses";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { priceHostedAiUsageForAllowance } from "@/src/lib/hosted-execution/usage-allowance";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  appendPreparedHostedMailboxEnvelopeTx: vi.fn(),
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
  environment: {
    linqFirstContactAdmissionModel: "gpt-5.6-luna",
    linqFirstContactAdmissionOpenAiApiKey: "test-openai-key" as string | null,
  },
  hasConflictingHostedLinqInstantFirstTurnForChatTx: vi.fn(),
  handoffHostedMailboxWake: vi.fn(),
  hostedMemberRoutingRecordsEqual: vi.fn(),
  hostedLinqDeliveryFindUnique: vi.fn(),
  readOpeningDeliveries: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  hostedThreadRouteFindMany: vi.fn(),
  readHostedMailboxRecentLiveConversationItemIds: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  hostedLinqDeliveryUpdate: vi.fn(),
  hostedLinqDeliveryUpdateMany: vi.fn(),
  hostedMailboxItemUpdateMany: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery: vi.fn(),
  lockHostedMemberRoutingStateTx: vi.fn(),
  lockHostedLinqMessageReceiptsTx: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  abandonHostedLinqInstantFirstTurnDeliveryTx: vi.fn(),
  recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx: vi.fn(),
  prepareHostedMailboxEnvelopeAppend: vi.fn(),
  projectHostedMemberRoutingState: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedRuntimeAiAccessDecision: vi.fn(),
  readHostedMemberRoutingRecord: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  recordHostedAiUsageRecords: vi.fn(),
  recordHostedIngressAcceptedFromMailboxItem: vi.fn(),
  recordHostedIngressTemporalSignalAccepted: vi.fn(),
  resolveHostedMemberDirectRoute: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));

vi.mock("@/src/lib/hosted-routing/member-direct-route", () => ({
  resolveHostedMemberDirectRoute: mocks.resolveHostedMemberDirectRoute,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  hostedMemberRoutingRecordsEqual: mocks.hostedMemberRoutingRecordsEqual,
  lockHostedMemberRoutingStateTx: mocks.lockHostedMemberRoutingStateTx,
  projectHostedMemberRoutingState: mocks.projectHostedMemberRoutingState,
  readHostedMemberRoutingRecord: mocks.readHostedMemberRoutingRecord,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/member-access")>(),
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.environment,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: (error: unknown) =>
    error instanceof Error ? error.name : "UnknownError",
  logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
  finishHostedOnboardingTiming: vi.fn(),
  startHostedOnboardingTiming: vi.fn(),
  toHostedOnboardingLogIdSuffix: (value: string) => value.slice(-8),
}));

vi.mock("@/src/lib/hosted-orchestration/mailbox-wake", () => ({
  handoffHostedMailboxWake: mocks.handoffHostedMailboxWake,
}));

vi.mock("@/src/lib/hosted-runtime-latency/store", () => ({
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery:
    mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery,
  recordHostedIngressAcceptedFromMailboxItem:
    mocks.recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressDirectEnsureTiming: vi.fn(),
  recordHostedIngressTemporalSignalAccepted:
    mocks.recordHostedIngressTemporalSignalAccepted,
}));

vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxString: vi.fn(async (input: { value: string }) =>
    input.value.startsWith("sealed:") ? input.value.slice(7) : null),
  sealHostedUserSecureBoxString: vi.fn(async (input: { value: string }) =>
    `sealed:${input.value}`),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendPreparedHostedMailboxEnvelopeTx:
    mocks.appendPreparedHostedMailboxEnvelopeTx,
  prepareHostedMailboxEnvelopeAppend:
    mocks.prepareHostedMailboxEnvelopeAppend,
  readHostedMailboxItemByDedupeKey:
    mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxRecentLiveConversationItemIds: mocks.readHostedMailboxRecentLiveConversationItemIds,
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecords: mocks.recordHostedAiUsageRecords,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async (importOriginal) => ({
  buildHostedLinqDeliveryId: (await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")>()).buildHostedLinqDeliveryId,
  claimHostedLinqDeliveryProviderDispatchTx:
    mocks.claimHostedLinqDeliveryProviderDispatchTx,
  hasConflictingHostedLinqInstantFirstTurnForChatTx:
    mocks.hasConflictingHostedLinqInstantFirstTurnForChatTx,
  HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE: "instant_first_turn_v1",
  HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA: "murph.hosted-linq-delivery-payload.instant-first-turn.v1",
  recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx: mocks.recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx,
  markHostedLinqDeliveryAcceptedTx: mocks.markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx:
    mocks.markHostedLinqDeliverySendFailedTx,
  abandonHostedLinqInstantFirstTurnDeliveryTx: mocks.abandonHostedLinqInstantFirstTurnDeliveryTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-message-receipt-lock", () => ({
  lockHostedLinqMessageReceiptsTx: mocks.lockHostedLinqMessageReceiptsTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-observability-identifiers", () => ({
  createHostedLinqDeliverySourceRefLookupKey: (value: string) => `source:${value}`,
  createHostedLinqDeliveryIdempotencyLookupKey: (value: string) =>
    `lookup:${value}`,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/contact-privacy")>(),
  createHostedExternalThreadIdentityLookupKeyReadCandidates: (input: { threadId: string }) => [`thread:${input.threadId}`],
  createHostedLinqChatLookupKeyReadCandidates: (value: string) => [`chat:${value}`],
  createHostedLinqMessageLookupKeyReadCandidates: (value: string) => [`message:${value}`],
}));

import {
  abandonHostedLinqInstantFirstTurn,
  claimHostedLinqInstantFirstTurn,
  completeHostedLinqInstantFirstTurn,
  isHostedLinqInstantFirstTurnRequestEligible,
  startHostedLinqInstantFirstTurnGeneration,
} from "@/src/lib/hosted-onboarding/linq-instant-first-turn";
import { maybeHandoffHostedExecutionWebhookWake } from "@/src/lib/hosted-onboarding/webhook-service-wake";

const ATTEMPTED_AT = new Date("2026-08-22T21:00:00.000Z");

const REQUEST = {
  eventId: "evt_instant_first_turn",
  participantContactKind: "phone" as const,
  partTypes: ["text"],
  service: "imessage" as const,
  text: "Hey Murph, what can you do?",
  textWasTruncated: false,
};

const WAKE_HANDOFF = {
  eventId: REQUEST.eventId,
  linqChatId: "chat_123",
  mailboxItemId: "mailbox_inbound",
  source: "linq" as const,
  userId: "member_123",
  wakeMailboxCheckpoint: {
    lane: "conversation" as const,
    laneSeq: "1",
  },
};

function createPrisma(): PrismaClient {
  const transaction = {
    $queryRaw: mocks.readOpeningDeliveries,
    hostedThreadRoute: { findMany: mocks.hostedThreadRouteFindMany },
    hostedLinqDelivery: {
      findUnique: mocks.hostedLinqDeliveryFindUnique,
      update: mocks.hostedLinqDeliveryUpdate,
      updateMany: mocks.hostedLinqDeliveryUpdateMany,
    },
    hostedMailboxItem: {
      updateMany: mocks.hostedMailboxItemUpdateMany,
    },
  };
  const prisma = {
    $queryRaw: mocks.readOpeningDeliveries,
    hostedThreadRoute: { findMany: mocks.hostedThreadRouteFindMany },
    hostedMember: { findUnique: mocks.hostedMemberFindUnique },
    $transaction: vi.fn(async (operation: (tx: typeof transaction) => unknown) =>
      operation(transaction)),
    hostedLinqDelivery: {
      findUnique: mocks.hostedLinqDeliveryFindUnique,
      updateMany: mocks.hostedLinqDeliveryUpdateMany,
    },
  };
  // This unit fixture implements only the Prisma methods exercised by the
  // instant-turn owner; production still receives the full Prisma client.
  // @ts-expect-error -- deliberate narrow test double for this owner boundary.
  return prisma;
}

function buildOpenAiResponse(input: {
  kind: "answer" | "welcome" | "handoff";
  message: string;
  serviceTier?: "default" | "fast" | "priority";
}): globalThis.Response {
  return new Response(JSON.stringify({
    created_at: 1_787_400_000,
    id: "resp_123",
    model: "gpt-5.6-luna-2026-08-01",
    object: "response",
    output: [{
      content: [{
        annotations: [],
        text: JSON.stringify(input),
        type: "output_text",
      }],
      id: "msg_123",
      role: "assistant",
      status: "completed",
      type: "message",
    }],
    service_tier: input.serviceTier ?? "priority",
    status: "completed",
    usage: {
      input_tokens: 90,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 22,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 112,
    },
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function buildUsageResponse(
  serviceTier: "default" | "priority" = "priority",
): OpenAiResponse {
  // This fixture supplies only fields read by usage accounting.
  // @ts-expect-error -- deliberate narrow provider response fixture.
  return {
    id: "resp_123",
    model: "gpt-5.6-luna-2026-08-01",
    service_tier: serviceTier,
    usage: {
      input_tokens: 90,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 22,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 112,
    },
  };
}

describe("hosted Linq instant first turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handoffHostedMailboxWake.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.readOpeningDeliveries.mockResolvedValue([]);
    mocks.hostedMemberFindUnique.mockResolvedValue({ assistantTone: "formal" });
    mocks.readHostedMailboxRecentLiveConversationItemIds.mockResolvedValue(["mailbox_welcome"]);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      eventId: "welcome_event", kind: "conversation.message", userId: WAKE_HANDOFF.userId,
      message: { channel: "linq", linqMessage: {
        chatId: "chat_123", messageId: "welcome_message", isFromMe: true, threadIsDirect: true,
        parts: [{ type: "text", value: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }],
      } },
    });
    mocks.environment.linqFirstContactAdmissionModel = "gpt-5.6-luna";
    mocks.environment.linqFirstContactAdmissionOpenAiApiKey = "test-openai-key";
    mocks.hasConflictingHostedLinqInstantFirstTurnForChatTx.mockResolvedValue(
      false,
    );
    mocks.hostedMemberRoutingRecordsEqual.mockReturnValue(true);
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValue({
      failedAt: null,
      payloadCiphertext: null,
      payloadSchema: null,
      skippedAt: new Date("2026-08-22T21:00:00.000Z"),
      status: "skipped",
    });
    mocks.recordHostedAiUsageRecords.mockResolvedValue({ recordedIds: [] });
    mocks.lockHostedLinqMessageReceiptsTx.mockResolvedValue(undefined);
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      attemptedAt: ATTEMPTED_AT,      id: "delivery_123",
    });
    mocks.hostedLinqDeliveryUpdate.mockResolvedValue({ id: "delivery_123" });
    mocks.hostedLinqDeliveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.hostedMailboxItemUpdateMany.mockResolvedValue({ count: 2 });
    mocks.projectHostedMemberRoutingState.mockResolvedValue({ route: "linq" });
    mocks.readActiveHostedMemberAccess.mockResolvedValue({ id: "access_123" });
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });
    mocks.readHostedMemberRoutingRecord.mockResolvedValue({
      memberId: WAKE_HANDOFF.userId,
    });
    mocks.hostedThreadRouteFindMany.mockResolvedValue([]);
    mocks.resolveHostedMemberDirectRoute.mockReturnValue({
      channel: "linq",
      threadId: "chat_123",
    });
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_123",
      messageCreatedAt: "2026-08-22T21:00:01.000Z",
      messageId: "provider_message_123",
    });
    mocks.prepareHostedMailboxEnvelopeAppend.mockResolvedValue({
      dedupeKey: "outbound",
      mode: "prepared",
    });
    mocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValue({
      deliveryStatus: "accepted",
      restoreOnboardingLink: null,
    });
    mocks.markHostedLinqDeliverySendFailedTx.mockResolvedValue(null);
    mocks.abandonHostedLinqInstantFirstTurnDeliveryTx.mockResolvedValue(true);
    mocks.recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx.mockResolvedValue(true);
    mocks.appendPreparedHostedMailboxEnvelopeTx.mockResolvedValue({
      mailboxItemId: "mailbox_outbound",
    });
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      consumedAt: null,
      id: "mailbox_outbound",
      lane: "conversation",
      laneSeq: "2",
    });
  });

  function prepareContinuation() {
    mocks.readOpeningDeliveries.mockResolvedValue([
      { acceptedAt: new Date("2026-09-01T12:00:00Z"), messageLookupKey: "message:welcome_message" },
    ]);
  }

  it("admits a second opening reply for an ordinary private chat without a thread container", async () => {
    prepareContinuation();
    const prisma = createPrisma();
    const request = { ...REQUEST, text: "Yes, ready." };
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId,
      linqChatId: "chat_123",
      prisma,
      request,
    });
    expect(claim).toEqual({ attemptedAt: ATTEMPTED_AT, kind: "generate", opening: { tone: "formal", question: "identity" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer", message: "Ignored model wording",
    })));
    const generation = await startHostedLinqInstantFirstTurnGeneration({ claim: requireAvailableClaim(claim), request });
    await expect(completeHostedLinqInstantFirstTurn({
      generation,
      inboundMessageId: "inbound_message",
      participantContact: { kind: "phone", lookupKey: "phone_lookup", value: "+15555550199" },
      prisma,
      recipientPhoneNumber: "+15555550199",
      service: "imessage",
      wakeHandoff: WAKE_HANDOFF,
    })).resolves.toMatchObject({ kind: "accepted" });
    expect(mocks.hostedThreadRouteFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      chatId: "chat_123",
      message: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal,
    }));
    expect(mocks.appendPreparedHostedMailboxEnvelopeTx).toHaveBeenCalledOnce();
    expect(mocks.prepareHostedMailboxEnvelopeAppend).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        userId: WAKE_HANDOFF.userId,
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            chatId: "chat_123",
            parts: [{ type: "text", value: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal }],
          }),
        }),
      }),
    }));
  });

  function prepareAspiration() {
    mocks.readOpeningDeliveries.mockResolvedValue([
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
      { acceptedAt: new Date(), messageLookupKey: "message:identity_message" },
    ]);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      eventId: "identity_event", kind: "conversation.message", userId: WAKE_HANDOFF.userId,
      message: { channel: "linq", linqMessage: {
        chatId: "chat_123", messageId: "identity_message", isFromMe: true, threadIsDirect: true,
        parts: [{ type: "text", value: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal }],
      } },
    });
  }

  it("delivers a third opening reply and imports it through the existing suppression boundary", async () => {
    prepareAspiration();
    const prisma = createPrisma();
    const request = { ...REQUEST, text: "Morgan, 29, nonbinary" };
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma, request,
    });
    expect(claim).toEqual({ attemptedAt: ATTEMPTED_AT, kind: "generate", opening: { tone: "formal", question: "aspiration" } });
    const message = "Good to meet you, Morgan. What would you most like from your health?";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({ kind: "answer", message })));
    const generation = await startHostedLinqInstantFirstTurnGeneration({ claim: requireAvailableClaim(claim), request });
    expect(generation).toMatchObject({ attemptedAt: ATTEMPTED_AT, kind: "reply", message });
    await expect(completeHostedLinqInstantFirstTurn({
      generation, inboundMessageId: "identity_answer", prisma,
      participantContact: { kind: "phone", lookupKey: "phone_lookup", value: "+15555550199" },
      recipientPhoneNumber: "+15555550199", service: "imessage", wakeHandoff: WAKE_HANDOFF,
    })).resolves.toMatchObject({ kind: "accepted" });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message }));
    expect(mocks.prepareHostedMailboxEnvelopeAppend).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({ message: expect.objectContaining({
        linqMessage: expect.objectContaining({ replyToMessageId: "identity_answer", parts: [{ type: "text", value: message }] }),
      }) }),
    }));
  });

  it("caps the opening at three replies and rejects an unaccepted predecessor", async () => {
    prepareAspiration();
    mocks.readOpeningDeliveries.mockResolvedValue([
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
      { acceptedAt: new Date(), messageLookupKey: "message:identity_message" },
      { acceptedAt: new Date(), messageLookupKey: "message:aspiration_message" },
    ]);
    const input = { continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST };
    await expect(claimHostedLinqInstantFirstTurn(input)).resolves.toEqual({ kind: "unavailable" });
    mocks.readOpeningDeliveries.mockResolvedValue([
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
      { acceptedAt: null, messageLookupKey: "message:identity_message" },
    ]);
    await expect(claimHostedLinqInstantFirstTurn(input)).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
  });

  it("rechecks the third reply allowance under the chat lock", async () => {
    prepareAspiration();
    const prior = [
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
      { acceptedAt: new Date(), messageLookupKey: "message:identity_message" },
    ];
    mocks.readOpeningDeliveries.mockResolvedValueOnce(prior).mockResolvedValueOnce([...prior, { acceptedAt: null, messageLookupKey: null }]);
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
  });

  it("hands mixed identity and immediate needs to the runtime without sending", async () => {
    prepareAspiration();
    const request = { ...REQUEST, text: "Morgan, 29. Help with a symptom first." };
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({ kind: "handoff", message: "" })));
    expect((await startHostedLinqInstantFirstTurnGeneration({ claim: requireAvailableClaim(claim), request })).kind).toBe("unavailable");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("leaves an unresolved direct member to the runtime without claiming a first reply", async () => {
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: null,
      linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
  });

  it.each(["health_data_consent_withdrawn", "hosted_access_inactive"])("does not start a continuation model call when %s", async (reason) => {
    prepareContinuation();
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: false, reason });
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId,
      linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    });
    expect(claim).toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
  });

  it("uses the prior confirmed welcome for one second reply and the existing ledger for the cap", async () => {
    prepareContinuation();
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: { ...REQUEST, text: "yes" },
    });
    expect(claim).toEqual({ attemptedAt: ATTEMPTED_AT, kind: "generate", opening: { tone: "formal", question: "identity" } });
    expect(mocks.readOpeningDeliveries.mock.calls[0]).toContain(WAKE_HANDOFF.userId);
    mocks.readOpeningDeliveries.mockResolvedValue([
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
      { acceptedAt: new Date(), messageLookupKey: "message:identity_message" },
    ]);
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledOnce();
  });

  it.each(["second", "third"])("recovers the exact accepted %s reply after later messages without regenerating", async (stage) => {
    if (stage === "third") prepareAspiration();
    else prepareContinuation();
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValue({
      template: "instant_first_turn_v1", linqChatLookupKey: "chat:chat_123",
      acceptedAt: new Date(), payloadCiphertext: null,
    });
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(null);
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({ claimed: false, outcome: "completed" });
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    });
    expect(claim.kind).toBe("completed");
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await startHostedLinqInstantFirstTurnGeneration({ claim: requireAvailableClaim(claim), request: REQUEST });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechecks the two-reply cap under the existing chat lock", async () => {
    prepareContinuation();
    mocks.readOpeningDeliveries.mockResolvedValueOnce([
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
    ]).mockResolvedValueOnce([
      { acceptedAt: new Date(), messageLookupKey: "message:welcome_message" },
      { acceptedAt: null, messageLookupKey: null },
    ]);
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
  });

  it("rejects a group route under the chat lock after continuation preflight", async () => {
    prepareContinuation();
    mocks.hostedThreadRouteFindMany.mockResolvedValue([{
      channel: "linq", containerMemberId: "group_container",
      container: { member: { id: "group_container" }, owner: { id: "group_owner" } },
    }]);
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
  });

  it("leaves returning, missing-history, and non-welcome conversations to the runtime", async () => {
    prepareContinuation();
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(null);
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue({
      eventId: "earlier_inbound", kind: "conversation.message", userId: WAKE_HANDOFF.userId,
      message: { channel: "linq", linqMessage: { isFromMe: false, parts: [] } },
    });
    await expect(claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId, linqChatId: "chat_123", prisma: createPrisma(), request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
  });

  it.each(["casual", "formal"] as const)("renders the canonical %s identity question on acceptance", async (openingTone) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer", message: "Ignored model wording",
    })));
    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim: { attemptedAt: ATTEMPTED_AT, kind: "generate", opening: { tone: openingTone, question: "identity" } }, request: { ...REQUEST, text: "yes" },
    })).resolves.toMatchObject({
      attemptedAt: ATTEMPTED_AT, kind: "reply", message: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS[openingTone],
    });
  });

  it.each(["Call me Robin", "I would rather skip setup", "Can you help with a symptom first?"])("hands off %s from an ordinary private chat and accounts for the Luna call", async (text) => {
    prepareContinuation();
    const request = { ...REQUEST, text };
    const claim = await claimHostedLinqInstantFirstTurn({
      continuationMemberId: WAKE_HANDOFF.userId,
      linqChatId: "chat_123", prisma: createPrisma(), request,
    });
    expect(claim).toEqual({ attemptedAt: ATTEMPTED_AT, kind: "generate", opening: { tone: "formal", question: "identity" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({ kind: "handoff", message: "" })));
    const generation = await startHostedLinqInstantFirstTurnGeneration({
      claim: requireAvailableClaim(claim), request,
    });
    expect(generation.kind).toBe("unavailable");
    await expect(completeHostedLinqInstantFirstTurn({
      generation, inboundMessageId: "inbound_message", participantContact: { kind: "phone", lookupKey: "phone_lookup", value: "+15555550199" },
      prisma: createPrisma(), recipientPhoneNumber: "+15555550199", service: "imessage", wakeHandoff: WAKE_HANDOFF,
    })).resolves.toEqual({ kind: "fallback" });
    expect(mocks.recordHostedAiUsageRecords).toHaveBeenCalledOnce();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("limits the web path to a direct, plain-text-only iMessage", () => {
    expect(isHostedLinqInstantFirstTurnRequestEligible(REQUEST)).toBe(true);
    expect(isHostedLinqInstantFirstTurnRequestEligible({
      ...REQUEST,
      participantContactKind: "email",
    })).toBe(true);
    for (const request of [
      { ...REQUEST, partTypes: ["text", "text"] },
      { ...REQUEST, partTypes: ["text", "image"] },
      { ...REQUEST, partTypes: ["image"] },
      { ...REQUEST, service: "sms" as const },
      { ...REQUEST, text: "   " },
      { ...REQUEST, textWasTruncated: true },
    ]) {
      expect(isHostedLinqInstantFirstTurnRequestEligible(request)).toBe(false);
    }
  });

  it("claims durable chat ownership before requesting a model reply", async () => {
    await expect(claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma: createPrisma(),
      request: REQUEST,
    })).resolves.toEqual({ attemptedAt: ATTEMPTED_AT, kind: "generate" });

    expect(mocks.acquireHostedLinqChatOwnershipLockTx).toHaveBeenCalledOnce();
    expect(
      mocks.hasConflictingHostedLinqInstantFirstTurnForChatTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      eventId: REQUEST.eventId,
      linqChatId: "chat_123",
    }));
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: REQUEST.eventId,
        status: "attempted",
      }),
    );
  });

  it("does not claim or generate from a truncated classifier representation", async () => {
    const prisma = createPrisma();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      ...REQUEST,
      text: "x".repeat(2_000),
      textWasTruncated: true,
    };

    const claim = await claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma,
      request,
    });

    expect(claim).toEqual({ kind: "unavailable" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("terminalizes a speculative claim under the same chat lock", async () => {
    await abandonHostedLinqInstantFirstTurn({
      expectedAttemptedAt: ATTEMPTED_AT, eventId: REQUEST.eventId,
      linqChatId: "chat_123", prisma: createPrisma(), reason: "planner-selected-non-instant-path",
    });
    expect(mocks.abandonHostedLinqInstantFirstTurnDeliveryTx).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptedAt: ATTEMPTED_AT, reason: "planner-selected-non-instant-path",
      idempotencyKey: expect.stringContaining("linq-instant-first-turn-v1-"),
    }));
    expect(mocks.acquireHostedLinqChatOwnershipLockTx.mock.invocationCallOrder[0]!)
      .toBeLessThan(mocks.abandonHostedLinqInstantFirstTurnDeliveryTx.mock.invocationCallOrder[0]!);
  });

  it("resumes the same encrypted obligation without regenerating", async () => {
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      payloadCiphertext: "sealed:Exact prior reply",
    });

    await expect(claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma: createPrisma(),
      request: REQUEST,
    })).resolves.toEqual({ attemptedAt: ATTEMPTED_AT, kind: "resume" });
    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim: { attemptedAt: ATTEMPTED_AT, kind: "resume" },
      request: REQUEST,
    })).resolves.toEqual({ attemptedAt: ATTEMPTED_AT, kind: "resume" });
  });

  it("does not regenerate a terminal ledger fallback on an exact retry", async () => {
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValueOnce({
      claimed: false,
      id: "delivery_123",
      outcome: "terminal",
    });

    const claim = await claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma: createPrisma(),
      request: REQUEST,
    });

    expect(claim).toEqual({ kind: "unavailable" });
    expect(mocks.hostedLinqDeliveryFindUnique).not.toHaveBeenCalled();
  });

  it("requests one tool-free Murph answer with strict output", async () => {
    mocks.environment.linqFirstContactAdmissionModel = "gpt-5.4-nano";
    const fetchMock = vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer",
      message: "I can help you understand your health, track patterns, and turn goals into practical next steps. What are you working on?",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startHostedLinqInstantFirstTurnGeneration({
      claim: { attemptedAt: ATTEMPTED_AT, kind: "generate" },
      request: REQUEST,
    });
    expect(result).toMatchObject({
      attemptedAt: ATTEMPTED_AT, kind: "reply",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      input: [{ content: REQUEST.text, role: "user" }],
      model: "gpt-6-luna",
      reasoning: { effort: "medium" },
      service_tier: "priority",
      store: false,
      text: {
        format: {
          strict: true,
          type: "json_schema",
        },
        verbosity: "low",
      },
    });
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.instructions).toContain("cannot see account history");
    expect(body.instructions).toContain("Return kind \"welcome\"");
    expect(body.instructions).not.toContain("Luna");
    expect(body.instructions).not.toContain("new user");
  });

  it("uses Murph's package-owned canonical welcome verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "welcome",
      message: "This model-authored text must not be sent.",
    })));

    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim: { attemptedAt: ATTEMPTED_AT, kind: "generate" },
      request: { ...REQUEST, text: "Hey Murph" },
    })).resolves.toMatchObject({
      attemptedAt: ATTEMPTED_AT, kind: "reply",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    });
  });

  it.each(["priority", "fast"] as const)("accounts for a %s reply from durable claim through the runtime handoff", async (serviceTier) => {
    const prisma = createPrisma();
    const reply =
      "A short walk after dinner can help your muscles use glucose, which may soften the post-meal blood-sugar rise.";
    const fetchMock = vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer",
      message: reply,
      serviceTier,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const claim = await claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma,
      request: REQUEST,
    });
    const generation = await startHostedLinqInstantFirstTurnGeneration({
      claim: requireAvailableClaim(claim),
      request: REQUEST,
    });
    const completion = await completeHostedLinqInstantFirstTurn({
      generation,
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma,
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(requestBody).toMatchObject({
      reasoning: { effort: "medium" },
      service_tier: "priority",
    });
    expect(requestBody).not.toHaveProperty("max_output_tokens");
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .toHaveBeenNthCalledWith(1, expect.objectContaining({
        sourceRef: REQUEST.eventId,
        status: "attempted",
      }));
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: reply }),
    );
    expect(mocks.recordHostedAiUsageRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: [expect.objectContaining({
          tokenPricingBasis: "standard",
        })],
      }),
    );
    const usage = parseAssistantUsageRecord(mocks.recordHostedAiUsageRecords.mock.calls[0]?.[0].usage[0]);
    const memberPrice = priceHostedAiUsageForAllowance(usage);
    const standardPrice = priceHostedAiUsageForAllowance({ ...usage, tokenPricingBasis: "standard" });
    const priorityPrice = priceHostedAiUsageForAllowance({ ...usage, tokenPricingBasis: "openai-priority" });
    expect(memberPrice.costUsdMicros).toBeGreaterThan(0n);
    expect(memberPrice.costUsdMicros).toBe(standardPrice.costUsdMicros);
    expect(memberPrice.costUsdMicros * 2n).toBe(priorityPrice.costUsdMicros);
    expect(mocks.prepareHostedMailboxEnvelopeAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          message: expect.objectContaining({
            linqMessage: expect.objectContaining({
              parts: [{ type: "text", value: reply }],
            }),
          }),
        }),
      }),
    );
    expect(mocks.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
    expect(completion).toEqual({
      kind: "accepted",
      wakeHandoff: {
        ...WAKE_HANDOFF,
        acceptedLinqDeliveryId: "hld_9fcbd74ffb0be2360b61fcbb8599b45b",
        mailboxItemId: "mailbox_outbound",
        originalInboundMailboxItemId: "mailbox_inbound",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "2",
        },
      },
    });
  });

  it("retains the accepted delivery link on completed webhook replay without resending", async () => {
    const result = await completeHostedLinqInstantFirstTurn({
      generation: { kind: "completed" },
      inboundMessageId: "inbound_message_123",
      participantContact: { kind: "phone", lookupKey: "phone_lookup_123", value: "+15551234567" },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    });
    expect(result).toMatchObject({
      kind: "accepted",
      wakeHandoff: {
        acceptedLinqDeliveryId: "hld_9fcbd74ffb0be2360b61fcbb8599b45b",
        mailboxItemId: "mailbox_outbound",
        originalInboundMailboxItemId: "mailbox_inbound",
      },
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  for (const wakeFails of [false, true]) {
    it.each(["reply", "completed", "resume"] as const)(
      `links original ingress after %s completion with echo wake failure=${wakeFails}`,
      async (generationKind) => {
        const tasks: Array<() => Promise<void>> = [];
        const scheduleAfterResponse = (task: () => Promise<void>) => { tasks.push(task); };
        const wakeHandoff = structuredClone(WAKE_HANDOFF);
        const wakeError = new Error("synthetic signal failure");
        if (wakeFails) mocks.handoffHostedMailboxWake.mockRejectedValueOnce(wakeError);
        if (generationKind === "resume") {
          mocks.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
            acceptedAt: new Date("2026-08-22T21:00:01.000Z"),
            template: "instant_first_turn_v1",
          });
        }
        const completion = await completeHostedLinqInstantFirstTurn({
          generation: generationKind === "reply" ? {
            attemptedAt: ATTEMPTED_AT, kind: "reply",
            message: "Hey! What would you like help with?",
            usage: { requestedModel: "gpt-6-luna", response: buildUsageResponse() },
          } : generationKind === "resume" ? { attemptedAt: ATTEMPTED_AT, kind: "resume" } : { kind: "completed" },
          inboundMessageId: "inbound_message_123",
          participantContact: { kind: "phone", lookupKey: "phone_lookup_123", value: "+15551234567" },
          prisma: createPrisma(),
          recipientPhoneNumber: "+15550000000",
          service: "iMessage",
          wakeHandoff,
        });
        if (completion.kind !== "accepted") throw new Error("Expected accepted completion");

        const result = maybeHandoffHostedExecutionWebhookWake({
          response: { ok: true },
          scheduleAfterResponse,
          wakeHandoff: completion.wakeHandoff,
        });
        if (wakeFails) await expect(result).rejects.toBe(wakeError);
        else await expect(result).resolves.toEqual({
          reason: "temporal-signaled",
          signalAccepted: true,
          started: true,
          workflowId: "hosted-user-runtime:member_123",
        });

        expect(wakeHandoff).toEqual(WAKE_HANDOFF);
        expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(generationKind === "reply" ? 1 : 0);
        expect(mocks.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
        expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledExactlyOnceWith({
          directWakeSource: "linq",
          expectedUserId: "member_123",
          knownCheckpoint: { lane: "conversation", laneSeq: "2", userId: "member_123" },
          mailboxItemId: "mailbox_outbound",
          onDirectWakeTiming: expect.any(Function),
          scheduleAfterResponse,
          signal: undefined,
          timeoutMs: undefined,
        });
        expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
        expect(tasks).toHaveLength(1);
        await tasks[0]!();
        expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).toHaveBeenCalledExactlyOnceWith({
          authenticatedUserId: "member_123",
          answeredMailboxItemIds: ["mailbox_outbound", "mailbox_inbound"],
          linqDeliveryId: "hld_9fcbd74ffb0be2360b61fcbb8599b45b",
          replyRuntimeAttemptId: null,
        });
        const ingress = {
          ingressTypingAcceptedAt: undefined,
          webhookReceivedAt: undefined,
          mailboxItemId: "mailbox_outbound",
          source: "linq",
        };
        if (wakeFails) {
          expect(mocks.recordHostedIngressAcceptedFromMailboxItem).toHaveBeenCalledExactlyOnceWith(ingress);
          expect(mocks.recordHostedIngressTemporalSignalAccepted).not.toHaveBeenCalled();
        } else {
          expect(mocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledExactlyOnceWith({
            ...ingress, at: expect.any(Date), expectedUserId: "member_123",
          });
          expect(mocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();
        }
      },
    );
  }

  it("makes unsafe model output unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer",
      message: "Read https://example.com",
    })));

    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim: { attemptedAt: ATTEMPTED_AT, kind: "generate" },
      request: REQUEST,
    })).resolves.toEqual({ attemptedAt: ATTEMPTED_AT, kind: "unavailable" });
  });

  it("delivers the accepted reply and leaves both conversation rows for runtime import", async () => {
    const prisma = createPrisma();
    const result = await completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse("default"),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma,
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_123",
      idempotencyKey: expect.stringContaining("linq-instant-first-turn-v1-"),
      message: "Hey! What would you like help with?",
      replyToMessageId: "inbound_message_123",
    });
    expect(mocks.lockHostedLinqMessageReceiptsTx).toHaveBeenCalledExactlyOnceWith({
      messageIds: ["provider_message_123"],
      prisma: expect.anything(),
    });
    expect(mocks.markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        prisma: mocks.lockHostedLinqMessageReceiptsTx.mock.calls[0]?.[0].prisma,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lockHostedLinqMessageReceiptsTx.mock.invocationCallOrder[0]!,
    );
    expect(mocks.lockHostedLinqMessageReceiptsTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markHostedLinqDeliveryAcceptedTx.mock.invocationCallOrder[0]!,
    );
    expect(mocks.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recordHostedAiUsageRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: [expect.objectContaining({
          tokenPricingBasis: "standard",
        })],
      }),
    );
    expect(result).toEqual({
      kind: "accepted",
      wakeHandoff: {
        ...WAKE_HANDOFF,
        acceptedLinqDeliveryId: "hld_9fcbd74ffb0be2360b61fcbb8599b45b",
        mailboxItemId: "mailbox_outbound",
        originalInboundMailboxItemId: "mailbox_inbound",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "2",
        },
      },
    });
  });

  it("terminalizes a generated reply when direct-route projection fails", async () => {
    mocks.projectHostedMemberRoutingState.mockRejectedValueOnce(
      new Error("Synthetic route projection failure."),
    );

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    })).resolves.toEqual({ kind: "fallback" });

    expect(mocks.abandonHostedLinqInstantFirstTurnDeliveryTx).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "direct-route-unavailable",
        expectedAttemptedAt: ATTEMPTED_AT,
      }),
    );
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("retains Web ownership when pre-provider terminalization is unconfirmed", async () => {
    mocks.readHostedMemberRoutingRecord.mockRejectedValueOnce(
      new Error("Synthetic route read failure."),
    );
    mocks.abandonHostedLinqInstantFirstTurnDeliveryTx.mockRejectedValueOnce(
      new Error("Synthetic terminalization failure."),
    );

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY",
      details: { reason: "fallback-terminalization-unconfirmed" },
      retryable: true,
    });

    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("retains Web ownership when guarded abandonment loses", async () => {
    mocks.readHostedMemberRoutingRecord.mockRejectedValueOnce(new Error("Synthetic route read failure."));
    mocks.abandonHostedLinqInstantFirstTurnDeliveryTx.mockResolvedValueOnce(false);

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY",
      details: { reason: "fallback-terminalization-unconfirmed" },
      retryable: true,
    });

    expect(mocks.abandonHostedLinqInstantFirstTurnDeliveryTx).toHaveBeenCalledOnce();
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("keeps accepted Web ownership when a buffered provider failure is replayed", async () => {
    mocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValueOnce({
      deliveryStatus: "failed",
      restoreOnboardingLink: null,
    });

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    })).resolves.toEqual({
      kind: "accepted",
      wakeHandoff: {
        ...WAKE_HANDOFF,
        acceptedLinqDeliveryId: "hld_9fcbd74ffb0be2360b61fcbb8599b45b",
        mailboxItemId: "mailbox_outbound",
        originalInboundMailboxItemId: "mailbox_inbound",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "2",
        },
      },
    });

    expect(mocks.appendPreparedHostedMailboxEnvelopeTx).toHaveBeenCalledOnce();
    expect(mocks.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
    expect(mocks.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          payloadCiphertext: null,
          payloadOwnerMemberId: null,
          payloadSchema: null,
        },
      }),
    );
    const clearData = mocks.hostedLinqDeliveryUpdateMany.mock.calls.at(-1)?.[0]
      ?.data;
    expect(clearData).not.toHaveProperty("skippedAt");
    expect(clearData).not.toHaveProperty("skipReason");
  });

  it("retries instead of exposing a missing continuity handoff", async () => {
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce(null);

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY",
      retryable: true,
    });

    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledOnce();
  });

  it("reuses the encrypted outbox body without another model request", async () => {
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValue({
      acceptedAt: null,
      deliveredAt: null,
      payloadCiphertext: "sealed:Exact prior reply",
      payloadOwnerMemberId: WAKE_HANDOFF.userId,
      payloadSchema:
        "murph.hosted-linq-delivery-payload.instant-first-turn.v1",
      status: "failed",
      template: "instant_first_turn_v1",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeHostedLinqInstantFirstTurn({
      generation: { attemptedAt: ATTEMPTED_AT, kind: "resume" },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    })).resolves.toMatchObject({ kind: "accepted" });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Exact prior reply" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("withholds the runtime wake when Linq acceptance is ambiguous", async () => {
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq send timed out.",
      retryable: true,
    }));

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    }).then((completion) => maybeHandoffHostedExecutionWebhookWake({
      response: { ok: true },
      wakeHandoff: completion.kind === "accepted" ? completion.wakeHandoff : WAKE_HANDOFF,
    }))).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY",
      retryable: true,
    });
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledOnce();
    expect(mocks.prepareHostedMailboxEnvelopeAppend).not.toHaveBeenCalled();
    expect(mocks.handoffHostedMailboxWake).not.toHaveBeenCalled();
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
  });

  it("falls back to the runtime after a definitive provider rejection", async () => {
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      details: { failureStage: "http", status: 422 },
      httpStatus: 502,
      message: "Linq rejected the message.",
      retryable: false,
    }));

    const completion = await completeHostedLinqInstantFirstTurn({
      generation: {
        attemptedAt: ATTEMPTED_AT, kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-6-luna",
          response: buildUsageResponse(),
        },
      },
      inboundMessageId: "inbound_message_123",
      participantContact: {
        kind: "phone",
        lookupKey: "phone_lookup_123",
        value: "+15551234567",
      },
      prisma: createPrisma(),
      recipientPhoneNumber: "+15550000000",
      service: "iMessage",
      wakeHandoff: WAKE_HANDOFF,
    });
    expect(completion).toEqual({ kind: "fallback" });
    const tasks: Array<() => Promise<void>> = [];
    await maybeHandoffHostedExecutionWebhookWake({
      response: { ok: true },
      scheduleAfterResponse: (task) => { tasks.push(task); },
      wakeHandoff: completion.kind === "accepted" ? completion.wakeHandoff : WAKE_HANDOFF,
    });
    for (const task of tasks) await task();
    expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledWith(expect.objectContaining({
      mailboxItemId: "mailbox_inbound",
      knownCheckpoint: { lane: "conversation", laneSeq: "1", userId: "member_123" },
    }));
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAttemptedAt: ATTEMPTED_AT }),
    );
    expect(mocks.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
  });
});

function requireAvailableClaim(claim: Awaited<ReturnType<typeof claimHostedLinqInstantFirstTurn>>) {
  if (claim.kind === "unavailable") throw new Error("Synthetic claim must be available.");
  return claim;
}
