import type { PrismaClient } from "@prisma/client";
import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  appendPreparedHostedMailboxEnvelopeTx: vi.fn(),
  claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
  environment: {
    linqFirstContactAdmissionModel: "gpt-5.6-luna",
    linqFirstContactAdmissionOpenAiApiKey: "test-openai-key" as string | null,
  },
  hostedLinqDeliveryFindUnique: vi.fn(),
  hostedLinqDeliveryUpdate: vi.fn(),
  hostedLinqDeliveryUpdateMany: vi.fn(),
  hostedMailboxItemUpdateMany: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  prepareHostedMailboxEnvelopeAppend: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  recordHostedAiUsageRecords: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.environment,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: (error: unknown) =>
    error instanceof Error ? error.name : "UnknownError",
  logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
  toHostedOnboardingLogIdSuffix: (value: string) => value.slice(-8),
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
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecords: mocks.recordHostedAiUsageRecords,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  claimHostedLinqDeliveryProviderDispatchTx:
    mocks.claimHostedLinqDeliveryProviderDispatchTx,
  HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE: "instant_first_turn_v1",
  markHostedLinqDeliveryAcceptedTx: mocks.markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx:
    mocks.markHostedLinqDeliverySendFailedTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-observability-identifiers", () => ({
  createHostedLinqDeliveryIdempotencyLookupKey: (value: string) =>
    `lookup:${value}`,
}));

import {
  completeHostedLinqInstantFirstTurn,
  startHostedLinqInstantFirstTurnGeneration,
} from "@/src/lib/hosted-onboarding/linq-instant-first-turn";

const REQUEST = {
  eventId: "evt_instant_first_turn",
  participantContactKind: "phone" as const,
  partTypes: ["text"],
  service: "imessage" as const,
  text: "Hey Murph, what can you do?",
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
    hostedLinqDelivery: {
      update: mocks.hostedLinqDeliveryUpdate,
      updateMany: mocks.hostedLinqDeliveryUpdateMany,
    },
    hostedMailboxItem: {
      updateMany: mocks.hostedMailboxItemUpdateMany,
    },
  };
  const prisma = {
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
  action: "defer" | "reply";
  message: string;
}): Response {
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

function buildUsage(): AssistantUsageRecord {
  const turnId = "turn_linq_instant_test";
  return {
    apiKeyEnv:
      "HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.openai.com/v1",
    cacheWriteTokens: null,
    cachedInputTokens: 0,
    credentialSource: "platform",
    featureKey: "linq-instant-first-turn",
    gatewayTags: [],
    inputTokens: 90,
    memberId: WAKE_HANDOFF.userId,
    occurredAt: "2026-08-22T21:00:00.000Z",
    outputTokens: 22,
    provider: "openai",
    providerName: "OpenAI",
    providerRequestId: "resp_123",
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: 0,
    reportingUserId: null,
    requestedModel: "gpt-5.6-luna",
    routeId: null,
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "gpt-5.6-luna-2026-08-01",
    sessionId: turnId,
    stripeMeterSource: "murph",
    surface: "hosted-web",
    tokenPricingBasis: "standard",
    totalTokens: 112,
    triggerKind: "linq-instant-first-turn",
    turnId,
    turnProfileJson: null,
    usageId: createAssistantUsageId({ attemptCount: 1, turnId }),
    usageExtractionSourcePath: "openai.responses.usage",
    usageExtractionVersion: "openai-responses-v1",
  };
}

describe("hosted Linq instant first turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.environment.linqFirstContactAdmissionModel = "gpt-5.6-luna";
    mocks.environment.linqFirstContactAdmissionOpenAiApiKey = "test-openai-key";
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValue(null);
    mocks.recordHostedAiUsageRecords.mockResolvedValue({ recordedIds: [] });
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "delivery_123",
    });
    mocks.hostedLinqDeliveryUpdate.mockResolvedValue({ id: "delivery_123" });
    mocks.hostedLinqDeliveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.hostedMailboxItemUpdateMany.mockResolvedValue({ count: 2 });
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
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    mocks.markHostedLinqDeliverySendFailedTx.mockResolvedValue(null);
    mocks.appendPreparedHostedMailboxEnvelopeTx.mockResolvedValue({
      mailboxItemId: "mailbox_outbound",
    });
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      consumedAt: new Date("2026-08-22T21:00:01.000Z"),
      id: "mailbox_outbound",
      lane: "conversation",
      laneSeq: "2",
    });
  });

  it("requests one tool-free low-reasoning Luna reply with strict output", async () => {
    mocks.environment.linqFirstContactAdmissionModel = "gpt-5.4-nano";
    const fetchMock = vi.fn().mockResolvedValue(buildOpenAiResponse({
      action: "reply",
      message: "I can help you understand your health, track patterns, and turn goals into practical next steps. What are you working on?",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startHostedLinqInstantFirstTurnGeneration({
      memberId: WAKE_HANDOFF.userId,
      prisma: createPrisma(),
      request: REQUEST,
    });
    expect(result).toMatchObject({
      kind: "reply",
      persisted: false,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      input: [{ content: REQUEST.text, role: "user" }],
      max_output_tokens: 300,
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
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
    expect(body.instructions).toContain("You have no tools");
    expect(body.instructions).toContain("Choose defer");
    expect(body.instructions).not.toContain("new user");
  });

  it("defers model output that contains a URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({
      action: "reply",
      message: "Read https://example.com",
    })));

    await expect(startHostedLinqInstantFirstTurnGeneration({
      memberId: WAKE_HANDOFF.userId,
      prisma: createPrisma(),
      request: REQUEST,
    })).resolves.toMatchObject({ kind: "defer" });
  });

  it("delivers the accepted reply and wakes through two consumed conversation rows", async () => {
    const prisma = createPrisma();
    const result = await completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        persisted: false,
        usage: buildUsage(),
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
    expect(mocks.hostedMailboxItemUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: new Date("2026-08-22T21:00:01.000Z") },
      where: expect.objectContaining({
        id: { in: ["mailbox_inbound", "mailbox_outbound"] },
      }),
    });
    expect(result).toEqual({
      kind: "accepted",
      wakeHandoff: {
        ...WAKE_HANDOFF,
        mailboxItemId: "mailbox_outbound",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "2",
        },
      },
    });
  });

  it("falls back only after a failed provider milestone clears the pending body", async () => {
    mocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValueOnce({
      deliveryStatus: "failed",
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        persisted: false,
        usage: buildUsage(),
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

    expect(mocks.appendPreparedHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          payloadCiphertext: null,
          payloadOwnerMemberId: null,
          payloadSchema: null,
        },
      }),
    );
  });

  it("retries instead of exposing a partial continuity handoff", async () => {
    mocks.hostedMailboxItemUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        persisted: false,
        usage: buildUsage(),
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

    expect(mocks.readHostedMailboxItemByDedupeKey).not.toHaveBeenCalled();
  });

  it("reuses the encrypted outbox body without another Luna request", async () => {
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

    await expect(startHostedLinqInstantFirstTurnGeneration({
      memberId: WAKE_HANDOFF.userId,
      prisma: createPrisma(),
      request: REQUEST,
    })).resolves.toEqual({
      kind: "reply",
      message: "Exact prior reply",
      persisted: true,
      usage: null,
    });
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
        kind: "reply",
        message: "Hey! What would you like help with?",
        persisted: false,
        usage: buildUsage(),
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
    expect(mocks.markHostedLinqDeliverySendFailedTx).toHaveBeenCalledOnce();
    expect(mocks.prepareHostedMailboxEnvelopeAppend).not.toHaveBeenCalled();
  });

  it("falls back to the runtime after a definitive provider rejection", async () => {
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      details: { failureStage: "http", status: 422 },
      httpStatus: 502,
      message: "Linq rejected the message.",
      retryable: false,
    }));

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        persisted: false,
        usage: buildUsage(),
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
    expect(mocks.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          payloadCiphertext: null,
          payloadOwnerMemberId: null,
          payloadSchema: null,
        },
      }),
    );
  });
});
