import type { PrismaClient } from "@prisma/client";
import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";
import type { Response as OpenAiResponse } from "openai/resources/responses/responses";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  hostedMemberRoutingRecordsEqual: vi.fn(),
  hostedLinqDeliveryFindUnique: vi.fn(),
  hostedLinqDeliveryUpdate: vi.fn(),
  hostedLinqDeliveryUpdateMany: vi.fn(),
  hostedMailboxItemUpdateMany: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  lockHostedMemberRoutingStateTx: vi.fn(),
  markHostedLinqDeliveryAcceptedTx: vi.fn(),
  markHostedLinqDeliverySendFailedTx: vi.fn(),
  markHostedLinqDeliverySkippedTx: vi.fn(),
  prepareHostedMailboxEnvelopeAppend: vi.fn(),
  projectHostedMemberRoutingState: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberRoutingRecord: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  recordHostedAiUsageRecords: vi.fn(),
  resolveHostedMemberDirectRoute: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
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

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
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
  hasConflictingHostedLinqInstantFirstTurnForChatTx:
    mocks.hasConflictingHostedLinqInstantFirstTurnForChatTx,
  HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE: "instant_first_turn_v1",
  isHostedLinqInstantFirstTurnFallbackTerminal: (input: {
    failedAt: Date | null;
    payloadCiphertext: string | null;
    payloadSchema: string | null;
    skippedAt: Date | null;
    status: string;
  }) => input.skippedAt !== null
    || input.status === "skipped"
    || (
      (input.failedAt !== null || input.status === "failed")
      && input.payloadCiphertext === null
      && input.payloadSchema === null
    ),
  markHostedLinqDeliveryAcceptedTx: mocks.markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx:
    mocks.markHostedLinqDeliverySendFailedTx,
  markHostedLinqDeliverySkippedTx: mocks.markHostedLinqDeliverySkippedTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-observability-identifiers", () => ({
  createHostedLinqDeliveryIdempotencyLookupKey: (value: string) =>
    `lookup:${value}`,
}));

import {
  abandonHostedLinqInstantFirstTurn,
  claimHostedLinqInstantFirstTurn,
  completeHostedLinqInstantFirstTurn,
  isHostedLinqInstantFirstTurnRequestEligible,
  startHostedLinqInstantFirstTurnGeneration,
} from "@/src/lib/hosted-onboarding/linq-instant-first-turn";

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
  kind: "answer" | "welcome";
  message: string;
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

function buildUsageResponse(): OpenAiResponse {
  // This fixture supplies only fields read by usage accounting.
  // @ts-expect-error -- deliberate narrow provider response fixture.
  return {
    id: "resp_123",
    model: "gpt-5.6-luna-2026-08-01",
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
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "delivery_123",
    });
    mocks.hostedLinqDeliveryUpdate.mockResolvedValue({ id: "delivery_123" });
    mocks.hostedLinqDeliveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.hostedMailboxItemUpdateMany.mockResolvedValue({ count: 2 });
    mocks.projectHostedMemberRoutingState.mockResolvedValue({ route: "linq" });
    mocks.readActiveHostedMemberAccess.mockResolvedValue({ id: "access_123" });
    mocks.readHostedMemberRoutingRecord.mockResolvedValue({
      memberId: WAKE_HANDOFF.userId,
    });
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
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
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    mocks.markHostedLinqDeliverySendFailedTx.mockResolvedValue(null);
    mocks.markHostedLinqDeliverySkippedTx.mockResolvedValue({
      id: "delivery_123",
    });
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

  it("limits the web path to a direct, plain-text-only iMessage", () => {
    expect(isHostedLinqInstantFirstTurnRequestEligible(REQUEST)).toBe(true);
    for (const request of [
      { ...REQUEST, partTypes: ["text", "text"] },
      { ...REQUEST, partTypes: ["text", "image"] },
      { ...REQUEST, partTypes: ["image"] },
      { ...REQUEST, service: "sms" as const },
      { ...REQUEST, participantContactKind: "email" as const },
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
    })).resolves.toEqual({ kind: "generate" });

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
    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim,
      request,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("terminalizes a speculative claim under the same chat lock", async () => {
    const prisma = createPrisma();

    await abandonHostedLinqInstantFirstTurn({
      eventId: REQUEST.eventId,
      linqChatId: "chat_123",
      prisma,
      reason: "planner-selected-non-instant-path",
    });

    expect(mocks.acquireHostedLinqChatOwnershipLockTx).toHaveBeenCalledWith({
      chatId: "chat_123",
      tx: expect.any(Object),
    });
    expect(mocks.markHostedLinqDeliverySkippedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        linqChatId: "chat_123",
        reason: "planner-selected-non-instant-path",
        sourceRef: REQUEST.eventId,
        template: "instant_first_turn_v1",
      }),
    );
    expect(mocks.acquireHostedLinqChatOwnershipLockTx.mock.invocationCallOrder[0]!)
      .toBeLessThan(mocks.markHostedLinqDeliverySkippedTx.mock.invocationCallOrder[0]!);
  });

  it("resumes the same encrypted obligation without regenerating", async () => {
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      payloadCiphertext: "sealed:Exact prior reply",
    });

    await expect(claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma: createPrisma(),
      request: REQUEST,
    })).resolves.toEqual({ kind: "resume" });
    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim: { kind: "resume" },
      request: REQUEST,
    })).resolves.toEqual({ kind: "resume" });
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
    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim,
      request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
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
      claim: { kind: "generate" },
      request: REQUEST,
    });
    expect(result).toMatchObject({
      kind: "reply",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      input: [{ content: REQUEST.text, role: "user" }],
      model: "gpt-5.6-luna",
      reasoning: { effort: "high" },
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
      claim: { kind: "generate" },
      request: { ...REQUEST, text: "Hey Murph" },
    })).resolves.toMatchObject({
      kind: "reply",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    });
  });

  it("runs one high-reasoning reply from durable claim through the runtime handoff", async () => {
    const prisma = createPrisma();
    const reply =
      "A short walk after dinner can help your muscles use glucose, which may soften the post-meal blood-sugar rise.";
    const fetchMock = vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer",
      message: reply,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const claim = await claimHostedLinqInstantFirstTurn({
      linqChatId: "chat_123",
      prisma,
      request: REQUEST,
    });
    const generation = await startHostedLinqInstantFirstTurnGeneration({
      claim,
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
      reasoning: { effort: "high" },
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
    expect(mocks.hostedMailboxItemUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: new Date("2026-08-22T21:00:01.000Z") },
      where: expect.objectContaining({
        id: { in: ["mailbox_inbound", "mailbox_outbound"] },
      }),
    });
    expect(completion).toEqual({
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

  it("makes unsafe model output unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildOpenAiResponse({
      kind: "answer",
      message: "Read https://example.com",
    })));

    await expect(startHostedLinqInstantFirstTurnGeneration({
      claim: { kind: "generate" },
      request: REQUEST,
    })).resolves.toEqual({ kind: "unavailable" });
  });

  it("delivers the accepted reply and wakes through two consumed conversation rows", async () => {
    const prisma = createPrisma();
    const result = await completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
          response: buildUsageResponse(),
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

  it("terminalizes a generated reply when direct-route projection fails", async () => {
    mocks.projectHostedMemberRoutingState.mockRejectedValueOnce(
      new Error("Synthetic route projection failure."),
    );

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
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

    expect(mocks.markHostedLinqDeliverySkippedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "direct-route-unavailable",
        sourceRef: REQUEST.eventId,
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
    mocks.markHostedLinqDeliverySkippedTx.mockRejectedValueOnce(
      new Error("Synthetic terminalization failure."),
    );

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
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

  it("retains Web ownership when the skip writer preserves provider entry", async () => {
    mocks.readHostedMemberRoutingRecord.mockRejectedValueOnce(
      new Error("Synthetic route read failure."),
    );
    mocks.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      failedAt: null,
      payloadCiphertext: "sealed:Exact prior reply",
      payloadSchema: "murph.hosted-linq-delivery-payload.instant-first-turn.v1",
      skippedAt: null,
      status: "provider_dispatch_started",
    });

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
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

    expect(mocks.markHostedLinqDeliverySkippedTx).toHaveBeenCalledOnce();
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("keeps accepted Web ownership when a buffered provider failure is replayed", async () => {
    mocks.markHostedLinqDeliveryAcceptedTx.mockResolvedValueOnce({
      deliveryStatus: "failed",
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
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
        mailboxItemId: "mailbox_outbound",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "2",
        },
      },
    });

    expect(mocks.appendPreparedHostedMailboxEnvelopeTx).toHaveBeenCalledOnce();
    expect(mocks.hostedMailboxItemUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: new Date("2026-08-22T21:00:01.000Z") },
      where: expect.objectContaining({
        id: { in: ["mailbox_inbound", "mailbox_outbound"] },
      }),
    });
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

  it("retries instead of exposing a partial continuity handoff", async () => {
    mocks.hostedMailboxItemUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(completeHostedLinqInstantFirstTurn({
      generation: {
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
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

    expect(mocks.readHostedMailboxItemByDedupeKey).not.toHaveBeenCalled();
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
      generation: { kind: "resume" },
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
        kind: "reply",
        message: "Hey! What would you like help with?",
        usage: {
          requestedModel: "gpt-5.6-luna",
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
        usage: {
          requestedModel: "gpt-5.6-luna",
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
