import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  containsHttpUrlText,
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";
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
  hasConflictingHostedLinqInstantFirstTurnForChatTx,
  HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
  isHostedLinqInstantFirstTurnFallbackTerminal,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  markHostedLinqDeliverySkippedTx,
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
  createHostedLinqMessageLookupKeyReadCandidates,
} from "./contact-privacy-core";
import {
  deriveHostedOnboardingTimingErrorName,
  logHostedOnboardingDiagnostic,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import { getHostedOnboardingEnvironment } from "./runtime";
import type { HostedWebhookWakeHandoff } from "./webhook-service-types";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
import {
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import {
  hostedMemberRoutingRecordsEqual,
  lockHostedMemberRoutingStateTx,
  projectHostedMemberRoutingState,
  readHostedMemberRoutingRecord,
} from "./hosted-member-routing-store";
import { resolveHostedMemberDirectRoute } from "../hosted-routing/member-direct-route";
import { readActiveHostedMemberAccess } from "./member-access";

const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
const HOSTED_LINQ_INSTANT_FIRST_TURN_MODEL = "gpt-5.6-luna";
const HOSTED_LINQ_INSTANT_FIRST_TURN_TIMEOUT_MS = 18_000;
const HOSTED_LINQ_INSTANT_FIRST_TURN_MAX_CHARS = 600;
const HOSTED_LINQ_INSTANT_FIRST_TURN_PROMPT_VERSION = "v1";
const HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA =
  "murph.hosted-linq-delivery-payload.instant-first-turn.v1";
const HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCOPE =
  "hosted-linq-delivery-payload:instant-first-turn";

const HOSTED_LINQ_INSTANT_FIRST_TURN_INSTRUCTIONS = `You write Murph's first reply in a private iMessage conversation. Murph is a personal health assistant that helps people understand what matters, learn from their own data and life context, try practical changes, and follow through.

Return kind "welcome" for a bare greeting, vague opener, or general question about Murph's identity or capabilities. Return kind "answer" for every concrete question or request, even when it starts with a greeting. Web supplies Murph's canonical welcome, so never reproduce or paraphrase it.

For an answer, be warm, curious, direct, practical, plainspoken, and nonjudgmental. This call sees only the current text. It cannot see account history, connected data, files, images, or current circumstances; browse; use tools; or take actions. Never claim you checked, saved, scheduled, connected, changed, sent, or completed anything. Answer general knowledge directly. When personal data or an action is needed, explain that naturally and ask at most one useful next question. Be honest about uncertainty, do not diagnose or overstate evidence, and give clear immediate-help guidance for urgent safety concerns.

Never mention models, prompts, routing, signup, activation, delivery, tools, containers, or internal architecture. Write one natural iMessage under 600 characters with no URL, heading, sign-off, marketing language, or support-bot voice.`;

type HostedLinqInstantFirstTurnModelResult = {
  kind: "answer" | "welcome";
  message: string;
};

export type HostedLinqInstantFirstTurnClaim =
  | { kind: "completed" }
  | { kind: "generate" }
  | { kind: "resume" }
  | { kind: "unavailable" };

type HostedLinqInstantFirstTurnUsageSeed = {
  requestedModel: string;
  response: Response;
};

export type HostedLinqInstantFirstTurnGeneration =
  | {
      kind: "completed";
    }
  | {
      kind: "reply";
      message: string;
      usage: HostedLinqInstantFirstTurnUsageSeed;
    }
  | {
      kind: "resume";
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
      kind: "pending";
    }
  | {
      kind: "fallback";
    };

const hostedLinqInstantFirstTurnPayloadSchema = z.strictObject({
  accepted: z.strictObject({
    acceptedAt: z.string(),
    chatId: z.string(),
    messageId: z.string(),
  }).nullable(),
  inboundMessageId: z.string(),
  message: z.string(),
  participantContact: z.strictObject({
    kind: z.literal("phone"),
    lookupKey: z.string(),
  }),
  recipientPhoneNumber: z.string(),
  service: z.string().nullable(),
  wakeHandoff: z.strictObject({
    eventId: z.string(),
    linqChatId: z.string(),
    mailboxItemId: z.string(),
    source: z.literal("linq"),
    userId: z.string(),
    wakeMailboxCheckpoint: z.strictObject({
      lane: z.literal("conversation"),
      laneSeq: z.string(),
    }).optional(),
  }),
});

type HostedLinqInstantFirstTurnPayload = z.infer<
  typeof hostedLinqInstantFirstTurnPayloadSchema
>;

export function isHostedLinqInstantFirstTurnRequestEligible(
  request: HostedLinqFirstContactAdmissionRequest,
): boolean {
  return request.participantContactKind === "phone"
    && request.service === "imessage"
    && request.partTypes.length === 1
    && request.partTypes[0] === "text"
    && !request.textWasTruncated
    && Boolean(request.text?.trim());
}

export async function claimHostedLinqInstantFirstTurn(input: {
  linqChatId: string;
  prisma?: PrismaClient;
  request: HostedLinqFirstContactAdmissionRequest;
}): Promise<HostedLinqInstantFirstTurnClaim> {
  if (!isHostedLinqInstantFirstTurnRequestEligible(input.request)) {
    return { kind: "unavailable" };
  }
  const prisma = input.prisma ?? getPrisma();
  const idempotencyKey = buildHostedLinqInstantFirstTurnIdempotencyKey(
    input.request.eventId,
  );
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: input.linqChatId,
        tx,
      });
      if (await readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma: tx,
        threadId: input.linqChatId,
      })) {
        return { kind: "unavailable" } as const;
      }
      if (await hasConflictingHostedLinqInstantFirstTurnForChatTx({
        eventId: input.request.eventId,
        linqChatId: input.linqChatId,
        prisma: tx,
      })) {
        throw buildHostedLinqInstantFirstTurnRetryError(
          "earlier-chat-reply-unresolved",
        );
      }

      const claim = await claimHostedLinqDeliveryProviderDispatchTx({
        idempotencyKey,
        linqChatId: input.linqChatId,
        prisma: tx,
        reclaimStalePreProviderAttempt: true,
        source: "hosted_web_instant_first_turn",
        sourceRef: input.request.eventId,
        status: "attempted",
        targetKind: "thread",
        template: HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
      });
      if (!claim.claimed) {
        if (claim.outcome === "completed") {
          return { kind: "completed" } as const;
        }
        if (claim.outcome === "terminal") {
          return { kind: "unavailable" } as const;
        }
        throw buildHostedLinqInstantFirstTurnRetryError(
          claim.outcome === "incompatible"
            ? "delivery-intent-incompatible"
            : "delivery-in-flight",
        );
      }
      if (!claim.id) {
        throw new Error("Hosted Linq instant first-turn claim has no row id.");
      }
      const delivery = await tx.hostedLinqDelivery.findUnique({
        select: { payloadCiphertext: true },
        where: { id: claim.id },
      });
      if (!delivery) {
        throw new Error("Hosted Linq instant first-turn claim was not retained.");
      }
      return delivery.payloadCiphertext
        ? { kind: "resume" } as const
        : { kind: "generate" } as const;
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY"
    ) {
      throw error;
    }
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-claim-unconfirmed",
      error,
    );
  }
}

export function startHostedLinqInstantFirstTurnGeneration(input: {
  claim: HostedLinqInstantFirstTurnClaim;
  request: HostedLinqFirstContactAdmissionRequest;
  signal?: AbortSignal;
}): Promise<HostedLinqInstantFirstTurnGeneration> {
  if (input.claim.kind !== "generate") {
    return Promise.resolve(input.claim);
  }
  return generateHostedLinqInstantFirstTurn(input);
}

export async function abandonHostedLinqInstantFirstTurn(input: {
  eventId: string;
  linqChatId: string;
  prisma?: PrismaClient;
  reason: string;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  await prisma.$transaction(async (tx) => {
    await acquireHostedLinqChatOwnershipLockTx({
      chatId: input.linqChatId,
      tx,
    });
    const delivery = await markHostedLinqDeliverySkippedTx({
      idempotencyKey: buildHostedLinqInstantFirstTurnIdempotencyKey(
        input.eventId,
      ),
      linqChatId: input.linqChatId,
      prisma: tx,
      reason: input.reason,
      source: "hosted_web_instant_first_turn",
      sourceRef: input.eventId,
      targetKind: "thread",
      template: HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
    });
    const terminal = await tx.hostedLinqDelivery.findUnique({
      select: {
        failedAt: true,
        payloadCiphertext: true,
        payloadSchema: true,
        skippedAt: true,
        status: true,
      },
      where: { id: delivery.id },
    });
    if (!terminal || !isHostedLinqInstantFirstTurnFallbackTerminal(terminal)) {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "fallback-terminalization-unconfirmed",
      );
    }
  });
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
  const chatId = requireNonEmptyString(
    input.wakeHandoff.linqChatId,
    "Hosted Linq instant first-turn chat id",
  );
  if (input.generation.kind === "completed") {
    return reconcileHostedLinqInstantFirstTurn({
      prisma,
      wakeHandoff: input.wakeHandoff,
    });
  }
  if (input.generation.kind === "unavailable") {
    return await abandonHostedLinqInstantFirstTurnForFallback({
      eventId: input.wakeHandoff.eventId,
      linqChatId: chatId,
      prisma,
      reason: "generation-unavailable",
    });
  }

  let message: string;
  const resumed = input.generation.kind === "resume";
  if (input.generation.kind === "resume") {
    const persisted = await readHostedLinqInstantFirstTurnPayload({
      eventId: input.wakeHandoff.eventId,
      memberId: input.wakeHandoff.userId,
      prisma,
    });
    if (persisted.kind === "completed") {
      return readCompletedHostedLinqInstantFirstTurn({
        prisma,
        wakeHandoff: input.wakeHandoff,
      });
    }
    if (persisted.kind === "unavailable") {
      return { kind: "fallback" };
    }
    if (persisted.kind !== "reply") {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "delivery-payload-incomplete",
      );
    }
    message = persisted.message;
  } else {
    message = input.generation.message;
  }

  if (input.generation.kind === "reply") {
    await recordHostedLinqInstantFirstTurnUsageBestEffort({
      prisma,
      usage: buildHostedLinqInstantFirstTurnUsageRecord({
        eventId: input.wakeHandoff.eventId,
        memberId: input.wakeHandoff.userId,
        requestedModel: input.generation.usage.requestedModel,
        response: input.generation.usage.response,
      }),
      userId: input.wakeHandoff.userId,
    });
  }

  const idempotencyKey = buildHostedLinqInstantFirstTurnIdempotencyKey(
    input.wakeHandoff.eventId,
  );
  const pendingPayload: HostedLinqInstantFirstTurnPayload = {
    accepted: null,
    inboundMessageId: input.inboundMessageId,
    message,
    participantContact: {
      kind: "phone",
      lookupKey: input.participantContact.lookupKey,
    },
    recipientPhoneNumber: input.recipientPhoneNumber,
    service: input.service,
    wakeHandoff: {
      eventId: input.wakeHandoff.eventId,
      linqChatId: chatId,
      mailboxItemId: input.wakeHandoff.mailboxItemId,
      source: "linq",
      userId: input.wakeHandoff.userId,
      ...(input.wakeHandoff.wakeMailboxCheckpoint
        ? {
            wakeMailboxCheckpoint: {
              lane: "conversation",
              laneSeq: input.wakeHandoff.wakeMailboxCheckpoint.laneSeq,
            },
          }
        : {}),
    },
  };
  let payloadCiphertext: string | null = null;
  if (!resumed) {
    try {
      payloadCiphertext = await sealHostedLinqInstantFirstTurnPayload({
        idempotencyKey,
        payload: pendingPayload,
        prisma,
        userId: input.wakeHandoff.userId,
      });
    } catch {
      return await abandonHostedLinqInstantFirstTurnForFallback({
        eventId: input.wakeHandoff.eventId,
        linqChatId: chatId,
        prisma,
        reason: "payload-seal-unavailable",
      });
    }
  }
  let routingRecord: Awaited<ReturnType<typeof readHostedMemberRoutingRecord>>;
  let routingState: Awaited<ReturnType<typeof projectHostedMemberRoutingState>>
    | null;
  try {
    routingRecord = await readHostedMemberRoutingRecord({
      memberId: input.wakeHandoff.userId,
      prisma,
    });
    routingState = routingRecord
      ? await projectHostedMemberRoutingState(routingRecord, prisma)
      : null;
  } catch (error) {
    if (resumed) {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "direct-route-unconfirmed",
        error,
      );
    }
    return await abandonHostedLinqInstantFirstTurnForFallback({
      eventId: input.wakeHandoff.eventId,
      linqChatId: chatId,
      prisma,
      reason: "direct-route-unavailable",
    });
  }
  const directRoute = resolveHostedMemberDirectRoute(routingState);
  if (
    directRoute?.channel !== "linq"
    || directRoute.threadId !== chatId
  ) {
    if (resumed) {
      throw buildHostedLinqInstantFirstTurnRetryError(
        "direct-route-changed",
      );
    }
    return await abandonHostedLinqInstantFirstTurnForFallback({
      eventId: input.wakeHandoff.eventId,
      linqChatId: chatId,
      prisma,
      reason: "direct-route-changed",
    });
  }
  let claim: Awaited<ReturnType<
    typeof claimHostedLinqDeliveryProviderDispatchTx
  >>;
  try {
    claim = await prisma.$transaction(async (tx) => {
      await lockHostedMemberRoutingStateTx({
        memberId: input.wakeHandoff.userId,
        prisma: tx,
      });
      const currentRoutingRecord = await readHostedMemberRoutingRecord({
        memberId: input.wakeHandoff.userId,
        prisma: tx,
      });
      if (
        !hostedMemberRoutingRecordsEqual(currentRoutingRecord, routingRecord)
        || !(await readActiveHostedMemberAccess({
          memberId: input.wakeHandoff.userId,
          prisma: tx,
        }))
      ) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
          httpStatus: 409,
          message: "Hosted Linq instant first-turn route authority changed.",
          retryable: false,
        });
      }
      await acquireHostedLinqChatOwnershipLockTx({ chatId, tx });
      if (await readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma: tx,
        threadId: chatId,
      })) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
          httpStatus: 409,
          message: "Hosted Linq instant first-turn chat is no longer direct.",
          retryable: false,
        });
      }
      const claimed = await claimHostedLinqDeliveryProviderDispatchTx({
        advancePreProviderAttempt: true,
        idempotencyKey,
        linqChatId: chatId,
        prisma: tx,
        reclaimStalePreProviderAttempt: true,
        source: "hosted_web_instant_first_turn",
        sourceRef: input.wakeHandoff.eventId,
        status: "provider_dispatch_started",
        targetKind: "thread",
        template: HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
      });
      if (claimed.claimed && claimed.id && payloadCiphertext) {
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
    if (
      !resumed
      && isHostedOnboardingError(error)
      && error.code === "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH"
    ) {
      return await abandonHostedLinqInstantFirstTurnForFallback({
        eventId: input.wakeHandoff.eventId,
        linqChatId: chatId,
        prisma,
        reason: "direct-route-changed",
      });
    }
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
    if (claim.outcome === "terminal") {
      return { kind: "fallback" };
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
      chatId,
      idempotencyKey,
      message,
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

  const acceptedAt = parseOptionalDate(sendResult.messageCreatedAt) ?? new Date();
  const acceptedPayload: HostedLinqInstantFirstTurnPayload = {
    ...pendingPayload,
    accepted: {
      acceptedAt: acceptedAt.toISOString(),
      chatId: sendResult.chatId ?? chatId,
      messageId: sendResult.messageId,
    },
  };
  let acceptedPayloadCiphertext: string;
  try {
    acceptedPayloadCiphertext = await sealHostedLinqInstantFirstTurnPayload({
      idempotencyKey,
      payload: acceptedPayload,
      prisma,
      userId: input.wakeHandoff.userId,
    });
  } catch (error) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-payload-seal-unconfirmed",
      error,
    );
  }

  try {
    return await recordHostedLinqInstantFirstTurnAcceptance({
      acceptedAt,
      acceptedPayloadCiphertext,
      idempotencyKey,
      prisma,
      payload: acceptedPayload,
      providerChatId: sendResult.chatId ?? chatId,
      providerMessageId: sendResult.messageId,
    });
  } catch (error) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-finalization-failed",
      error,
    );
  }
}

async function generateHostedLinqInstantFirstTurn(input: {
  request: HostedLinqFirstContactAdmissionRequest;
  signal?: AbortSignal;
}): Promise<HostedLinqInstantFirstTurnGeneration> {
  const text = input.request.text?.trim() ?? "";
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
    const result = response.status === "completed"
      ? parseHostedLinqInstantFirstTurnModelResult(response.output_text)
      : null;
    if (!result) {
      return { kind: "unavailable" };
    }
    const message = result.kind === "welcome"
      ? MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE
      : normalizeHostedLinqInstantFirstTurnMessage(result.message);
    return message
      ? {
          kind: "reply",
          message,
          usage: {
            requestedModel: HOSTED_LINQ_INSTANT_FIRST_TURN_MODEL,
            response,
          },
        }
      : { kind: "unavailable" };
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

export function buildHostedLinqInstantFirstTurnOpenAiBody(input: {
  text: string;
}): ResponseCreateParamsNonStreaming {
  return {
    input: [{
      content: input.text,
      role: "user",
    }],
    instructions: HOSTED_LINQ_INSTANT_FIRST_TURN_INSTRUCTIONS,
    model: HOSTED_LINQ_INSTANT_FIRST_TURN_MODEL,
    reasoning: { effort: "high" },
    service_tier: "priority",
    store: false,
    text: {
      format: {
        name: "hosted_linq_instant_first_turn",
        schema: {
          additionalProperties: false,
          properties: {
            kind: {
              enum: ["welcome", "answer"],
              type: "string",
            },
            message: {
              maxLength: HOSTED_LINQ_INSTANT_FIRST_TURN_MAX_CHARS,
              type: "string",
            },
          },
          required: ["kind", "message"],
          type: "object",
        },
        strict: true,
        type: "json_schema",
      },
      verbosity: "low",
    },
  };
}

async function recordHostedLinqInstantFirstTurnAcceptance(input: {
  acceptedAt: Date;
  acceptedPayloadCiphertext: string;
  idempotencyKey: string;
  payload: HostedLinqInstantFirstTurnPayload;
  prisma: PrismaClient;
  providerChatId: string;
  providerMessageId: string;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  const deliveryStatus = await input.prisma.$transaction(async (tx) => {
    const milestone = await markHostedLinqDeliveryAcceptedTx({
      acceptedAt: input.acceptedAt,
      idempotencyKey: input.idempotencyKey,
      linqChatId: input.providerChatId,
      messageId: input.providerMessageId,
      prisma: tx,
    });
    if (
      milestone.deliveryStatus !== "accepted"
      && milestone.deliveryStatus !== "delivered"
      && milestone.deliveryStatus !== "failed"
    ) {
      throw new Error(
        "Hosted Linq instant first-turn acceptance was not persisted.",
      );
    }
    const retained = await tx.hostedLinqDelivery.updateMany({
      data: { payloadCiphertext: input.acceptedPayloadCiphertext },
      where: {
        idempotencyKey: requireHostedLinqInstantFirstTurnIdempotencyLookupKey(
          input.idempotencyKey,
        ),
        payloadOwnerMemberId: input.payload.wakeHandoff.userId,
        payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
      },
    });
    if (retained.count !== 1) {
      throw new Error(
        "Hosted Linq instant first-turn accepted payload was not retained.",
      );
    }
    return milestone.deliveryStatus;
  });

  return deliveryStatus === "accepted"
    ? { kind: "pending" }
    : reconcileHostedLinqInstantFirstTurn({
        prisma: input.prisma,
        wakeHandoff: input.payload.wakeHandoff,
      });
}

async function settleHostedLinqInstantFirstTurnTerminal(input: {
  deliveryStatus: "delivered" | "failed";
  idempotencyLookupKey: string;
  payload: HostedLinqInstantFirstTurnPayload;
  prisma: PrismaClient;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  if (!input.payload.accepted) {
    throw new Error(
      "Hosted Linq instant first-turn terminal payload lacks provider acceptance.",
    );
  }
  if (input.deliveryStatus === "failed") {
    const cleared = await input.prisma.hostedLinqDelivery.updateMany({
      data: {
        payloadCiphertext: null,
        payloadOwnerMemberId: null,
        payloadSchema: null,
      },
      where: {
        idempotencyKey: input.idempotencyLookupKey,
        messageLookupKey: {
          in: createHostedLinqMessageLookupKeyReadCandidates(
            input.payload.accepted.messageId,
          ),
        },
        payloadOwnerMemberId: input.payload.wakeHandoff.userId,
        payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
        status: "failed",
      },
    });
    if (cleared.count !== 1) {
      throw new Error(
        "Hosted Linq instant first-turn failed payload was not released.",
      );
    }
    return { kind: "fallback" };
  }

  return finalizeHostedLinqInstantFirstTurnContinuity({
    ...input,
    deliveryStatus: "delivered",
  });
}

async function finalizeHostedLinqInstantFirstTurnContinuity(input: {
  deliveryStatus: "delivered";
  idempotencyLookupKey: string;
  payload: HostedLinqInstantFirstTurnPayload;
  prisma: PrismaClient;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  const accepted = input.payload.accepted;
  if (!accepted) {
    throw new Error(
      "Hosted Linq instant first-turn delivered payload lacks provider acceptance.",
    );
  }
  const acceptedAt = requireValidDate(
    accepted.acceptedAt,
    "Hosted Linq instant first-turn accepted at",
  );
  const envelope = buildHostedExecutionLinqConversationMessageWake({
    contactKind: input.payload.participantContact.kind,
    contactLookupKey: input.payload.participantContact.lookupKey,
    eventId: buildHostedLinqInstantFirstTurnMailboxDedupeKey(
      input.payload.wakeHandoff.eventId,
    ),
    linqMessage: {
      chatId: accepted.chatId,
      from: input.payload.recipientPhoneNumber,
      isFromMe: true,
      messageId: accepted.messageId,
      parts: [{ type: "text", value: input.payload.message }],
      replyToMessageId: input.payload.inboundMessageId,
      service: input.payload.service,
      threadIsDirect: true,
    },
    occurredAt: acceptedAt.toISOString(),
    phoneLookupKey: input.payload.participantContact.lookupKey,
    userId: input.payload.wakeHandoff.userId,
  });
  const prepared = await prepareHostedMailboxEnvelopeAppend({
    envelope,
    prisma: input.prisma,
  });

  await input.prisma.$transaction(async (tx) => {
    const appended = await appendPreparedHostedMailboxEnvelopeTx({
      prepared,
      tx,
    });
    const consumed = await tx.hostedMailboxItem.updateMany({
      data: { consumedAt: acceptedAt },
      where: {
        consumedAt: null,
        id: {
          in: [
            input.payload.wakeHandoff.mailboxItemId,
            appended.mailboxItemId,
          ],
        },
        kind: "conversation.message",
        lane: "conversation",
        userId: input.payload.wakeHandoff.userId,
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
        idempotencyKey: input.idempotencyLookupKey,
        messageLookupKey: {
          in: createHostedLinqMessageLookupKeyReadCandidates(
            accepted.messageId,
          ),
        },
        payloadOwnerMemberId: input.payload.wakeHandoff.userId,
        payloadSchema: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA,
        status: "delivered",
      },
    });
    if (cleared.count !== 1) {
      throw new Error(
        "Hosted Linq instant first-turn accepted payload was not cleared.",
      );
    }
  });
  return readCompletedHostedLinqInstantFirstTurn({
    prisma: input.prisma,
    wakeHandoff: input.payload.wakeHandoff,
  });
}

export async function finalizeHostedLinqInstantFirstTurnReceipt(input: {
  deliveryStatus: "delivered" | "failed";
  messageId: string;
  prisma?: PrismaClient;
}): Promise<HostedWebhookWakeHandoff | null> {
  const prisma = input.prisma ?? getPrisma();
  const delivery = await prisma.hostedLinqDelivery.findFirst({
    select: {
      deliveredAt: true,
      failedAt: true,
      idempotencyKey: true,
      payloadCiphertext: true,
      payloadOwnerMemberId: true,
      payloadSchema: true,
      status: true,
    },
    where: {
      messageLookupKey: {
        in: createHostedLinqMessageLookupKeyReadCandidates(input.messageId),
      },
      template: HOSTED_LINQ_INSTANT_FIRST_TURN_TEMPLATE,
    },
  });
  if (!delivery?.payloadCiphertext) {
    return null;
  }
  if (
    input.deliveryStatus === "delivered"
      ? delivery.status !== "delivered" || !delivery.deliveredAt
      : delivery.status !== "failed" || !delivery.failedAt
  ) {
    return null;
  }
  const payload = await openHostedLinqInstantFirstTurnPayload({
    delivery,
    prisma,
  });
  const completion = await settleHostedLinqInstantFirstTurnTerminal({
    deliveryStatus: input.deliveryStatus,
    idempotencyLookupKey: requireNonEmptyString(
      delivery.idempotencyKey,
      "Hosted Linq instant first-turn delivery idempotency key",
    ),
    payload,
    prisma,
  });
  return completion.kind === "accepted"
    ? completion.wakeHandoff
    : payload.wakeHandoff;
}

async function reconcileHostedLinqInstantFirstTurn(input: {
  prisma: PrismaClient;
  wakeHandoff: HostedWebhookWakeHandoff;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  const idempotencyKey = buildHostedLinqInstantFirstTurnIdempotencyKey(
    input.wakeHandoff.eventId,
  );
  const delivery = await input.prisma.hostedLinqDelivery.findUnique({
    select: {
      deliveredAt: true,
      failedAt: true,
      idempotencyKey: true,
      payloadCiphertext: true,
      payloadOwnerMemberId: true,
      payloadSchema: true,
      status: true,
    },
    where: {
      idempotencyKey:
        requireHostedLinqInstantFirstTurnIdempotencyLookupKey(idempotencyKey),
    },
  });
  if (!delivery) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-context-unavailable",
    );
  }
  if (!delivery.payloadCiphertext) {
    return delivery.status === "failed"
      ? { kind: "fallback" }
      : readCompletedHostedLinqInstantFirstTurn({
          prisma: input.prisma,
          wakeHandoff: input.wakeHandoff,
        });
  }
  const payload = await openHostedLinqInstantFirstTurnPayload({
    delivery,
    prisma: input.prisma,
  });
  if (delivery.status === "accepted") {
    return { kind: "pending" };
  }
  if (delivery.status !== "delivered" && delivery.status !== "failed") {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "accepted-context-unavailable",
    );
  }
  return settleHostedLinqInstantFirstTurnTerminal({
    deliveryStatus: delivery.status,
    idempotencyLookupKey:
      requireHostedLinqInstantFirstTurnIdempotencyLookupKey(idempotencyKey),
    payload,
    prisma: input.prisma,
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
      idempotencyKey: true,
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
  if (delivery.acceptedAt || delivery.deliveredAt) {
    return { kind: "completed" };
  }
  const payload = await openHostedLinqInstantFirstTurnPayload({
    delivery,
    prisma: input.prisma,
  });
  return { kind: "reply", message: payload.message };
}

async function sealHostedLinqInstantFirstTurnPayload(input: {
  idempotencyKey: string;
  payload: HostedLinqInstantFirstTurnPayload;
  prisma: PrismaClient;
  userId: string;
}): Promise<string> {
  const idempotencyLookupKey =
    requireHostedLinqInstantFirstTurnIdempotencyLookupKey(input.idempotencyKey);
  const ciphertext = await sealHostedUserSecureBoxString({
    aad: buildHostedLinqInstantFirstTurnPayloadAad(idempotencyLookupKey),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCOPE,
    userId: input.userId,
    value: JSON.stringify(input.payload),
  });
  return requireNonEmptyString(
    ciphertext,
    "Hosted Linq instant first-turn encrypted payload",
  );
}

async function openHostedLinqInstantFirstTurnPayload(input: {
  delivery: {
    idempotencyKey: string | null;
    payloadCiphertext: string | null;
    payloadOwnerMemberId: string | null;
    payloadSchema: string | null;
  };
  prisma: PrismaClient;
}): Promise<HostedLinqInstantFirstTurnPayload> {
  if (
    !input.delivery.idempotencyKey
    || !input.delivery.payloadCiphertext
    || !input.delivery.payloadOwnerMemberId
    || input.delivery.payloadSchema
      !== HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCHEMA
  ) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-payload-incomplete",
    );
  }
  const value = await openHostedUserSecureBoxString({
    aad: buildHostedLinqInstantFirstTurnPayloadAad(
      input.delivery.idempotencyKey,
    ),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_LINQ_INSTANT_FIRST_TURN_PAYLOAD_SCOPE,
    userId: input.delivery.payloadOwnerMemberId,
    value: input.delivery.payloadCiphertext,
  });
  const payload = parseHostedLinqInstantFirstTurnPayload(value);
  if (!payload) {
    throw buildHostedLinqInstantFirstTurnRetryError(
      "delivery-payload-invalid",
    );
  }
  return payload;
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
      (record.kind !== "answer" && record.kind !== "welcome")
      || typeof record.message !== "string"
    ) {
      return null;
    }
    return {
      kind: record.kind,
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

function parseHostedLinqInstantFirstTurnPayload(
  value: string | null,
): HostedLinqInstantFirstTurnPayload | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = hostedLinqInstantFirstTurnPayloadSchema.safeParse(
      JSON.parse(value),
    );
    if (!parsed.success) {
      return null;
    }
    const message = normalizeHostedLinqInstantFirstTurnMessage(
      parsed.data.message,
    );
    return message ? { ...parsed.data, message } : null;
  } catch {
    return null;
  }
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

async function abandonHostedLinqInstantFirstTurnForFallback(input: {
  eventId: string;
  linqChatId: string;
  prisma: PrismaClient;
  reason: string;
}): Promise<HostedLinqInstantFirstTurnCompletion> {
  try {
    await abandonHostedLinqInstantFirstTurn(input);
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY"
    ) {
      throw error;
    }
    throw buildHostedLinqInstantFirstTurnRetryError(
      "fallback-terminalization-unconfirmed",
      error,
    );
  }
  return { kind: "fallback" };
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

function requireValidDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
  return date;
}
