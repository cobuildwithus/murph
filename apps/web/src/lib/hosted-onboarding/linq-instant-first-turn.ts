import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { containsHttpUrlText } from "@murphai/contracts";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

import {
  appendPreparedHostedMailboxEnvelopeTx,
  prepareHostedMailboxEnvelopeAppend,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import { recordHostedAiUsageRecords } from "../hosted-execution/usage";
import { getPrisma } from "../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
} from "./linq-delivery-store";
import {
  sendHostedLinqChatMessage,
  type HostedLinqSendResult,
} from "./linq-client";
import type { HostedLinqFirstContactAdmissionRequest } from "./linq-first-contact-admission";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "./linq-observability-identifiers";
import {
  deriveHostedOnboardingTimingErrorName,
  logHostedOnboardingDiagnostic,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import { getHostedOnboardingEnvironment } from "./runtime";
import type { HostedWebhookWakeHandoff } from "./webhook-service-types";

const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
const HOSTED_LINQ_INSTANT_FIRST_TURN_MODEL = "gpt-5.6-luna";
const HOSTED_LINQ_INSTANT_FIRST_TURN_TIMEOUT_MS = 6_000;
const HOSTED_LINQ_INSTANT_FIRST_TURN_MAX_CHARS = 600;
const HOSTED_LINQ_INSTANT_FIRST_TURN_PROMPT_VERSION = "v1";
const HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA =
  "murph.hosted-linq-delivery-payload.instant-first-turn.v1";
const HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCOPE =
  "hosted-linq-delivery-payload:instant-first-turn";

const HOSTED_LINQ_INSTANT_FIRST_TURN_INSTRUCTIONS = `# Role

You are Luna, the fast first response from Murph in an iMessage conversation. Murph is a personal health assistant.

# Task

Decide whether you can give a complete, useful first response using only the user's message. You have no tools, account context, saved health data, files, web access, or ability to take actions.

- Choose reply for greetings, introductions, casual conversation, and timeless low-risk general information you can answer safely from the message alone.
- Choose defer when the request needs any tool, current or external facts, personal or account data, an action, a file or image, diagnosis or treatment, or more context to answer responsibly.
- Never claim that you saved, changed, scheduled, checked, sent, connected, or completed anything.
- Never mention signup, activation, delivery, notifications, classifiers, routing, tools, deferral, or this decision.

# Reply style

Write one natural iMessage from Murph. Be warm, direct, and concise. Use at most 600 characters. Do not include URLs, markdown headings, or a sign-off. If you choose defer, return an empty message.`;

type HostedLinqInstantFirstTurnModelResult = {
  action: "defer" | "reply";
  message: string;
};

export type HostedLinqInstantFirstTurnGeneration =
  | {
      kind: "completed";
    }
  | {
      kind: "defer";
      usage: AssistantUsageRecord;
    }
  | {
      kind: "reply";
      message: string;
      persisted: boolean;
      usage: AssistantUsageRecord | null;
    }
  | {
      kind: "unavailable";
    };

export type HostedLinqInstantFirstTurnCompletion =
  | {
      kind: "accepted";
      wakeHandoff: HostedWebhookWakeHandoff;
    }
  | {
      kind: "fallback";
    };

export function startHostedLinqInstantFirstTurnGeneration(input: {
  memberId: string;
  prisma?: PrismaClient;
  request: HostedLinqFirstContactAdmissionRequest;
  signal?: AbortSignal;
}): Promise<HostedLinqInstantFirstTurnGeneration> {
  return generateHostedLinqInstantFirstTurn(input);
}

export async function completeHostedLinqInstantFirstTurn(input: {
  generation: HostedLinqInstantFirstTurnGeneration;
  inboundMessageId: string;
  participantContact: HostedLinqParticipantContact;
  prisma?: PrismaClient;
  recipientPhoneNumber: string;
  service: string | null;
  wakeHandoff: HostedWebhookWakeHandoff;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  const prisma = input.prisma ?? getPrisma();
  if (input.generation.kind === "completed") {
    return readCompletedHostedLinqInstantFirstTurn({
      prisma,
      wakeHandoff: input.wakeHandoff,
    });
  }
  if (input.generation.kind === "unavailable") {
    return { kind: "fallback" };
  }

  if (input.generation.usage) {
    await recordHostedLinqInstantFirstTurnUsageBestEffort({
      prisma,
      usage: input.generation.usage,
      userId: input.wakeHandoff.userId,
    });
  }
  if (input.generation.kind === "defer") {
    return { kind: "fallback" };
  }

  const idempotencyKey = buildHostedLinqInstantFirstTurnIdempotencyKey(
    input.wakeHandoff.eventId,
  );
  let payloadCiphertext: string;
  try {
    payloadCiphertext = await sealHostedLinqInstantFirstTurnPayload({
      idempotencyKey,
      message: input.generation.message,
      prisma,
      userId: input.wakeHandoff.userId,
    });
  } catch (error) {
    if (input.generation.persisted) {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "delivery-payload-unavailable",
        error,
      );
    }
    return { kind: "fallback" };
  }
  let claim: Awaited<ReturnType<
    typeof claimHostedLinqDeliveryProviderDispatchTx
  >>;
  try {
    claim = await prisma.$transaction(async (tx) => {
      const claimed = await claimHostedLinqDeliveryProviderDispatchTx({
        idempotencyKey,
        linqChatId: input.wakeHandoff.linqChatId,
        prisma: tx,
        reclaimStalePreProviderAttempt: true,
        source: "hosted_web_instant_first_turn",
        sourceRef: input.wakeHandoff.eventId,
        status: "provider_dispatch_started",
        targetKind: "thread",
        template: HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
      });
      if (claimed.claimed && claimed.id) {
        await tx.hostedLinqDelivery.update({
          data: {
            payloadCiphertext,
            payloadOwnerMemberId: input.wakeHandoff.userId,
            payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
          },
          where: { id: claimed.id },
        });
      }
      return claimed;
    });
  } catch (error) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-claim-unconfirmed",
      error,
    );
  }
  if (!claim.claimed) {
    if (claim.outcome === "completed") {
      return readCompletedHostedLinqInstantFirstTurn({
        prisma,
        wakeHandoff: input.wakeHandoff,
      });
    }
    throw buildHostedLinqInstantFirstTurnRetryError(
      claim.outcome === "incompatible"
        ? "delivery-intent-incompatible"
        : "delivery-in-flight",
    );
  }

  let sendResult: HostedLinqSendResult;
  try {
    sendResult = await sendHostedLinqChatMessage({
      chatId: requireNonEmptyString(
        input.wakeHandoff.linqChatId,
        "Hosted Linq instant first-turn chat id",
      ),
      idempotencyKey,
      message: input.generation.message,
      replyToMessageId: input.inboundMessageId,
    });
  } catch (error) {
    try {
      await markHostedLinqDeliverySendFailedTx({
        failureCode: readHostedLinqInstantFirstTurnFailureCode(error),
        idempotencyKey,
        linqChatId: input.wakeHandoff.linqChatId,
        prisma,
      });
    } catch (markError) {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "delivery-failure-unrecorded",
        markError,
      );
    }
    if (isDefinitiveHostedLinqInstantFirstTurnSendFailure(error)) {
      try {
        await clearHostedLinqInstantFirstTurnPayload({
          idempotencyKey,
          prisma,
          userId: input.wakeHandoff.userId,
        });
      } catch (clearError) {
        throw buildHostedLinqInstantFirstTurnRetryError(
          "delivery-payload-clear-unconfirmed",
          clearError,
        );
      }
      return { kind: "fallback" };
    }
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-unconfirmed",
      error,
    );
  }

  if (!sendResult.messageId) {
    try {
      await markHostedLinqDeliverySendFailedTx({
        failureCode: "missing-provider-message-id",
        idempotencyKey,
        linqChatId: sendResult.chatId ?? input.wakeHandoff.linqChatId,
        prisma,
      });
    } catch (error) {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "delivery-failure-unrecorded",
        error,
      );
    }
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-unconfirmed",
    );
  }

  try {
    return await finalizeHostedLinqInstantFirstTurn({
      acceptedAt: parseOptionalDate(sendResult.messageCreatedAt) ?? new Date(),
      inboundMessageId: input.inboundMessageId,
      message: input.generation.message,
      participantContact: input.participantContact,
      prisma,
      providerChatId:
        sendResult.chatId ?? input.wakeHandoff.linqChatId ?? null,
      providerMessageId: sendResult.messageId,
      recipientPhoneNumber: input.recipientPhoneNumber,
      service: input.service,
      wakeHandoff: input.wakeHandoff,
    });
  } catch (error) {
    await markHostedLinqDeliverySendFailedTx({
      failureCode: "accepted-finalization-failed",
      idempotencyKey,
      linqChatId: sendResult.chatId ?? input.wakeHandoff.linqChatId,
      prisma,
    }).catch(() => undefined);
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-finalization-failed",
      error,
    );
  }
}

async function generateHostedLinqInstantFirstTurn(input: {
  memberId: string;
  prisma?: PrismaClient;
  request: HostedLinqFirstContactAdmissionRequest;
  signal?: AbortSignal;
}): Promise<HostedLinqInstantFirstTurnGeneration> {
  const text = input.request.text?.trim() ?? "";
  let persisted: Awaited<ReturnType<
    typeof readHostedLinqInstantFirstTurnPayload
  >>;
  try {
    persisted = await readHostedLinqInstantFirstTurnPayload({
      eventId: input.request.eventId,
      memberId: input.memberId,
      prisma: input.prisma ?? getPrisma(),
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY"
    ) {
      throw error;
    }
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-payload-unavailable",
      error,
    );
  }
  if (persisted.kind === "completed") {
    return persisted;
  }
  if (persisted.kind === "unavailable") {
    return persisted;
  }
  if (persisted.kind === "reply") {
    return {
      kind: "reply",
      message: persisted.message,
      persisted: true,
      usage: null,
    };
  }
  const environment = getHostedOnboardingEnvironment();
  const apiKey = environment.linqFirstContactAdmissionOpenAiApiKey;
  if (!text || !apiKey) {
    return { kind: "unavailable" };
  }

  const timeoutSignal = AbortSignal.timeout(
    HOSTED_LINQ_INSTANT_FIRST_TURN_TIMEOUT_MS,
  );
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;
  const openAi = new OpenAI({
    adminAPIKey: null,
    apiKey,
    baseURL: OPENAI_RESPONSES_BASE_URL,
    logLevel: "off",
    maxRetries: 0,
    organization: null,
    project: null,
    timeout: HOSTED_LINQ_INSTANT_FIRST_TURN_TIMEOUT_MS,
    webhookSecret: null,
  });

  try {
    const response = await openAi.responses.create(
      buildHostedLinqInstantFirstTurnOpenAiBody({
        text,
      }),
      {
        maxRetries: 0,
        signal,
        timeout: HOSTED_LINQ_INSTANT_FIRST_TURN_TIMEOUT_MS,
      },
    );
    const usage = buildHostedLinqInstantFirstTurnUsageRecord({
      eventId: input.request.eventId,
      memberId: input.memberId,
      requestedModel: HOSTED_LINQ_INSTANT_FIRST_TURN_MODEL,
      response,
    });
    const result = response.status === "completed"
      ? parseHostedLinqInstantFirstTurnModelResult(response.output_text)
      : null;
    if (!result || result.action === "defer") {
      return { kind: "defer", usage };
    }
    const message = normalizeHostedLinqInstantFirstTurnMessage(result.message);
    return message
      ? { kind: "reply", message, persisted: false, usage }
      : { kind: "defer", usage };
  } catch (error) {
    logHostedOnboardingDiagnostic(
      "hosted-onboarding.webhook.linq.instant-first-turn-generation",
      {
        errorName: deriveHostedOnboardingTimingErrorName(error),
        eventIdSuffix: toHostedOnboardingLogIdSuffix(input.request.eventId),
        outcome: "unavailable",
      },
    );
    return { kind: "unavailable" };
  }
}

function buildHostedLinqInstantFirstTurnOpenAiBody(input: {
  text: string;
}): ResponseCreateParamsNonStreaming {
  return {
    input: [{
      content: input.text,
      role: "user",
    }],
    instructions: HOSTED_LINQ_INSTANT_FIRST_TURN_INSTRUCTIONS,
    max_output_tokens: 300,
    model: HOSTED_LINQ_INSTANT_FIRST_TURN_MODEL,
    reasoning: { effort: "none" },
    service_tier: "priority",
    store: false,
    text: {
      format: {
        name: "hosted_linq_instant_first_turn",
        schema: {
          additionalProperties: false,
          properties: {
            action: {
              enum: ["reply", "defer"],
              type: "string",
            },
            message: {
              maxLength: HOSTED_LINQ_INSTANT_FIRST_TURN_MAX_CHARS,
              type: "string",
            },
          },
          required: ["action", "message"],
          type: "object",
        },
        strict: true,
        type: "json_schema",
      },
      verbosity: "low",
    },
  };
}

async function finalizeHostedLinqInstantFirstTurn(input: {
  acceptedAt: Date;
  inboundMessageId: string;
  message: string;
  participantContact: HostedLinqParticipantContact;
  prisma: PrismaClient;
  providerChatId: string | null;
  providerMessageId: string;
  recipientPhoneNumber: string;
  service: string | null;
  wakeHandoff: HostedWebhookWakeHandoff;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  const envelope = buildHostedExecutionLinqConversationMessageWake({
    contactKind: input.participantContact.kind,
    contactLookupKey: input.participantContact.lookupKey,
    eventId: buildHostedLinqInstantFirstTurnMailboxDedupeKey(
      input.wakeHandoff.eventId,
    ),
    linqMessage: {
      chatId: requireNonEmptyString(
        input.providerChatId,
        "Hosted Linq instant first-turn provider chat id",
      ),
      from: requireNonEmptyString(
        input.recipientPhoneNumber,
        "Hosted Linq instant first-turn recipient phone number",
      ),
      isFromMe: true,
      messageId: input.providerMessageId,
      parts: [{ type: "text", value: input.message }],
      replyToMessageId: input.inboundMessageId,
      service: input.service,
      threadIsDirect: true,
    },
    occurredAt: input.acceptedAt.toISOString(),
    ...(input.participantContact.kind === "phone"
      ? { phoneLookupKey: input.participantContact.lookupKey }
      : {}),
    userId: input.wakeHandoff.userId,
  });
  const prepared = await prepareHostedMailboxEnvelopeAppend({
    envelope,
    prisma: input.prisma,
  });
  const idempotencyKey = buildHostedLinqInstantFirstTurnIdempotencyKey(
    input.wakeHandoff.eventId,
  );

  const finalization = await input.prisma.$transaction(async (tx) => {
    const milestone = await markHostedLinqDeliveryAcceptedTx({
      acceptedAt: input.acceptedAt,
      idempotencyKey,
      linqChatId: input.providerChatId,
      messageId: input.providerMessageId,
      prisma: tx,
    });
    if (milestone.deliveryStatus === "failed") {
      const cleared = await tx.hostedLinqDelivery.updateMany({
        data: {
          payloadCiphertext: null,
          payloadOwnerMemberId: null,
          payloadSchema: null,
        },
        where: {
          idempotencyKey:
            requireHostedLinqInstantFirstTurnIdempotencyLookupKey(
              idempotencyKey,
            ),
          payloadOwnerMemberId: input.wakeHandoff.userId,
          payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
        },
      });
      if (cleared.count !== 1) {
        throw new Error(
          "Hosted Linq instant first-turn failed payload was not cleared.",
        );
      }
      return "failed" as const;
    }
    if (
      milestone.deliveryStatus !== "accepted"
      && milestone.deliveryStatus !== "delivered"
    ) {
      throw new Error(
        "Hosted Linq instant first-turn acceptance was not persisted.",
      );
    }
    const appended = await appendPreparedHostedMailboxEnvelopeTx({
      prepared,
      tx,
    });
    const consumed = await tx.hostedMailboxItem.updateMany({
      data: { consumedAt: input.acceptedAt },
      where: {
        id: {
          in: [
            input.wakeHandoff.mailboxItemId,
            appended.mailboxItemId,
          ],
        },
        kind: "conversation.message",
        lane: "conversation",
        userId: input.wakeHandoff.userId,
      },
    });
    if (consumed.count !== 2) {
      throw new Error(
        "Hosted Linq instant first-turn continuity rows were not both consumed.",
      );
    }
    const cleared = await tx.hostedLinqDelivery.updateMany({
      data: {
        payloadCiphertext: null,
        payloadOwnerMemberId: null,
        payloadSchema: null,
      },
      where: {
        idempotencyKey: requireHostedLinqInstantFirstTurnIdempotencyLookupKey(
          idempotencyKey,
        ),
        payloadOwnerMemberId: input.wakeHandoff.userId,
        payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
      },
    });
    if (cleared.count !== 1) {
      throw new Error(
        "Hosted Linq instant first-turn accepted payload was not cleared.",
      );
    }
    return "accepted" as const;
  });
  if (finalization === "failed") {
    return { kind: "fallback" };
  }
  return readCompletedHostedLinqInstantFirstTurn({
    prisma: input.prisma,
    wakeHandoff: input.wakeHandoff,
  });
}

async function readCompletedHostedLinqInstantFirstTurn(input: {
  prisma: PrismaClient;
  wakeHandoff: HostedWebhookWakeHandoff;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  let item: Awaited<ReturnType<typeof readHostedMailboxItemByDedupeKey>>;
  try {
    item = await readHostedMailboxItemByDedupeKey({
      dedupeKey: buildHostedLinqInstantFirstTurnMailboxDedupeKey(
        input.wakeHandoff.eventId,
      ),
      prisma: input.prisma,
      userId: input.wakeHandoff.userId,
    });
  } catch (error) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-context-unavailable",
      error,
    );
  }
  if (!item?.consumedAt) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-context-unavailable",
    );
  }
  return {
    kind: "accepted",
    wakeHandoff: {
      ...input.wakeHandoff,
      mailboxItemId: item.id,
      wakeMailboxCheckpoint: {
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
    },
  };
}

async function readHostedLinqInstantFirstTurnPayload(input: {
  eventId: string;
  memberId: string;
  prisma: PrismaClient;
}): Promise<
  | { kind: "completed" }
  | { kind: "none" }
  | { kind: "reply"; message: string }
  | { kind: "unavailable" }
> {
  const idempotencyKey = buildHostedLinqInstantFirstTurnIdempotencyKey(
    input.eventId,
  );
  const delivery = await input.prisma.hostedLinqDelivery.findUnique({
    select: {
      acceptedAt: true,
      deliveredAt: true,
      payloadCiphertext: true,
      payloadOwnerMemberId: true,
      payloadSchema: true,
      status: true,
      template: true,
    },
    where: {
      idempotencyKey:
        requireHostedLinqInstantFirstTurnIdempotencyLookupKey(idempotencyKey),
    },
  });
  if (!delivery) {
    return { kind: "none" };
  }
  if (delivery.template !== HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-intent-incompatible",
    );
  }
  if (delivery.acceptedAt || delivery.deliveredAt) {
    return { kind: "completed" };
  }
  if (
    delivery.payloadOwnerMemberId === null
    && delivery.payloadCiphertext === null
    && delivery.payloadSchema === null
    && delivery.status === "failed"
  ) {
    return { kind: "unavailable" };
  }
  if (
    delivery.payloadOwnerMemberId !== input.memberId
    || delivery.payloadSchema !== HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA
    || !delivery.payloadCiphertext
  ) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-payload-incomplete",
    );
  }
  const message = normalizeHostedLinqInstantFirstTurnMessage(
    await openHostedUserSecureBoxString({
      aad: buildHostedLinqInstantFirstTurnPayloadAad(idempotencyKey),
      lane: "hosted-member-private-field",
      prisma: input.prisma,
      scope: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCOPE,
      userId: input.memberId,
      value: delivery.payloadCiphertext,
    }) ?? "",
  );
  if (!message) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-payload-invalid",
    );
  }
  return { kind: "reply", message };
}

async function sealHostedLinqInstantFirstTurnPayload(input: {
  idempotencyKey: string;
  message: string;
  prisma: PrismaClient;
  userId: string;
}): Promise<string> {
  const ciphertext = await sealHostedUserSecureBoxString({
    aad: buildHostedLinqInstantFirstTurnPayloadAad(input.idempotencyKey),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCOPE,
    userId: input.userId,
    value: input.message,
  });
  return requireNonEmptyString(
    ciphertext,
    "Hosted Linq instant first-turn encrypted payload",
  );
}

async function clearHostedLinqInstantFirstTurnPayload(input: {
  idempotencyKey: string;
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  const cleared = await input.prisma.hostedLinqDelivery.updateMany({
    data: {
      payloadCiphertext: null,
      payloadOwnerMemberId: null,
      payloadSchema: null,
    },
    where: {
      idempotencyKey: requireHostedLinqInstantFirstTurnIdempotencyLookupKey(
        input.idempotencyKey,
      ),
      payloadOwnerMemberId: input.userId,
      payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
    },
  });
  if (cleared.count !== 1) {
    throw new Error(
      "Hosted Linq instant first-turn payload was not cleared.",
    );
  }
}

function buildHostedLinqInstantFirstTurnPayloadAad(idempotencyKey: string): {
  field: string;
  purpose: string;
  rowId: string;
  table: string;
} {
  return {
    field: "payload_ciphertext",
    purpose: "hosted-linq-delivery-payload",
    rowId: idempotencyKey,
    table: "hosted_linq_delivery",
  };
}

function buildHostedLinqInstantFirstTurnUsageRecord(input: {
  eventId: string;
  memberId: string;
  requestedModel: string;
  response: Response;
}): AssistantUsageRecord {
  const turnId = `turn_linq_instant_${digestHostedLinqInstantFirstTurnId(
    input.eventId,
  )}`;
  const usage = input.response.usage;
  return {
    apiKeyEnv:
      "HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY",
    attemptCount: 1,
    baseUrl: OPENAI_RESPONSES_BASE_URL,
    cacheWriteTokens: null,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    credentialSource: "platform",
    featureKey: "linq-instant-first-turn",
    gatewayTags: [],
    inputTokens: usage?.input_tokens ?? null,
    memberId: input.memberId,
    occurredAt: new Date().toISOString(),
    outputTokens: usage?.output_tokens ?? null,
    provider: "openai",
    providerName: "OpenAI",
    providerRequestId: input.response.id,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens:
      usage?.output_tokens_details?.reasoning_tokens ?? null,
    reportingUserId: null,
    requestedModel: input.requestedModel,
    routeId: null,
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: input.response.model,
    sessionId: turnId,
    stripeMeterSource: "murph",
    surface: "hosted-web",
    tokenPricingBasis: "standard",
    totalTokens: usage?.total_tokens ?? null,
    triggerKind: "linq-instant-first-turn",
    turnId,
    turnProfileJson: null,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: "openai.responses.usage",
    usageExtractionVersion: "openai-responses-v1",
  };
}

async function recordHostedLinqInstantFirstTurnUsageBestEffort(input: {
  prisma: PrismaClient;
  usage: AssistantUsageRecord;
  userId: string;
}): Promise<void> {
  try {
    await recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: input.prisma,
      trustedUserId: input.userId,
      usage: [input.usage],
    });
  } catch (error) {
    logHostedOnboardingDiagnostic(
      "hosted-onboarding.webhook.linq.instant-first-turn-usage",
      {
        errorName: deriveHostedOnboardingTimingErrorName(error),
        outcome: "failed",
      },
    );
  }
}

function parseHostedLinqInstantFirstTurnModelResult(
  value: string,
): HostedLinqInstantFirstTurnModelResult | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      (record.action !== "reply" && record.action !== "defer")
      || typeof record.message !== "string"
    ) {
      return null;
    }
    return {
      action: record.action,
      message: record.message,
    };
  } catch {
    return null;
  }
}

function normalizeHostedLinqInstantFirstTurnMessage(value: string): string | null {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > HOSTED_LINQ_INSTANT_FIRST_TURN_MAX_CHARS
    || containsHttpUrlText(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isDefinitiveHostedLinqInstantFirstTurnSendFailure(
  error: unknown,
): boolean {
  if (!isHostedOnboardingError(error) || error.retryable) {
    return false;
  }
  const status = error.details?.status;
  return error.details?.failureStage === "http"
    && typeof status === "number"
    && status >= 400
    && status < 500
    && status !== 408
    && status !== 409
    && status !== 429;
}

function readHostedLinqInstantFirstTurnFailureCode(error: unknown): string {
  if (isHostedOnboardingError(error)) {
    return error.code;
  }
  return deriveHostedOnboardingTimingErrorName(error);
}

function buildHostedLinqInstantFirstTurnRetryError(
  reason: string,
  cause?: unknown,
): ReturnType<typeof hostedOnboardingError> {
  return hostedOnboardingError({
    ...(cause === undefined ? {} : { cause }),
    code: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY",
    details: { reason },
    httpStatus: 503,
    message:
      "The instant first reply is still reconciling; retry the same webhook before running the hosted assistant.",
    retryable: true,
  });
}

function buildHostedLinqInstantFirstTurnIdempotencyKey(eventId: string): string {
  return `linq-instant-first-turn-${HOSTED_LINQ_INSTANT_FIRST_TURN_PROMPT_VERSION}-${digestHostedLinqInstantFirstTurnId(eventId)}`;
}

function requireHostedLinqInstantFirstTurnIdempotencyLookupKey(
  idempotencyKey: string,
): string {
  return requireNonEmptyString(
    createHostedLinqDeliveryIdempotencyLookupKey(idempotencyKey),
    "Hosted Linq instant first-turn idempotency lookup key",
  );
}

function buildHostedLinqInstantFirstTurnMailboxDedupeKey(
  eventId: string,
): string {
  return `linq.instant-first-turn.${HOSTED_LINQ_INSTANT_FIRST_TURN_PROMPT_VERSION}.${digestHostedLinqInstantFirstTurnId(eventId)}`;
}

function digestHostedLinqInstantFirstTurnId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireNonEmptyString(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}
