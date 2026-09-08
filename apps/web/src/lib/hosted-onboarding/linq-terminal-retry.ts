import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { MessageContent } from "@linqapp/sdk/resources";
import type { Message } from "@linqapp/sdk/resources/messages";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import { readHostedLinqFailedMessage, resendHostedLinqMessage } from "./linq-client";
import { recordHostedLinqTerminalRetryAcceptedTx } from "./linq-delivery-store";
import { evaluateHostedLinqEgressPolicy } from "./linq-egress-policy";
import { readHostedRuntimeAiAccessDecision } from "./member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import { sha256Hex } from "../primitives";
import { isHostedOnboardingError } from "./errors";
import { LinqApiTimeoutError } from "../linq/api";
import { logHostedOnboardingDiagnostic, logHostedOnboardingWarning, toHostedOnboardingLogIdSuffix } from "./logging";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";

// Recovery cannot extend the provider's optional 24-hour content lifetime.
const RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type RetryClient = PrismaClient | Prisma.TransactionClient;

export function isHostedLinqTerminalSendFailure(input: {
  failureCode: string | null;
  failureReason: string | null;
}): boolean {
  return input.failureCode === "4001"
    && input.failureReason === "Message send failed";
}

export async function retryHostedLinqTerminalSendForEvent(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.event.eventType !== "message.failed") return;
  if (!isHostedLinqTerminalSendFailure(input.event)) {
    try {
      logHostedOnboardingDiagnostic("hosted-onboarding.linq.terminal-retry", {
        trigger: "failure_webhook", stage: "candidate", outcome: "skipped",
        reason: "failure_not_retryable", attemptClaimed: false,
        eventIdSuffix: toHostedOnboardingLogIdSuffix(input.event.eventId),
      });
    } catch { /* Diagnostics do not grant or block a retry. */ }
    return;
  }
  await retryHostedLinqTerminalSend({
    chatId: input.event.linqChatId,
    messageId: input.event.linqMessageId,
    prisma: input.prisma,
    trigger: "failure_webhook",
    eventId: input.event.eventId,
  });
}

/** Return no request when retrieval cannot preserve the original send semantics. */
export function buildHostedLinqTerminalRetryMessage(
  original: Message,
  idempotencyKey: string,
): MessageContent | null {
  if (!original.parts?.length || original.parts.length > 100) return null;
  const parts: NonNullable<MessageContent["parts"]> = [];
  for (const part of original.parts) {
    switch (part.type) {
      case "text":
        parts.push({
          type: "text",
          value: part.value,
          ...(part.text_decorations ? { text_decorations: part.text_decorations } : {}),
        });
        break;
      case "link":
        parts.push({ type: "link", value: part.value });
        break;
      case "media":
        // Retrieval does not distinguish voice memo bubbles from audio files.
        if (!part.id || !part.mime_type || part.mime_type.startsWith("audio/")) return null;
        parts.push({ type: "media", attachment_id: part.id });
        break;
      default:
        // App cards omit original interaction/experience semantics in retrieval.
        return null;
    }
  }
  return {
    idempotency_key: idempotencyKey,
    parts,
    preferred_service: original.preferred_service ?? "iMessage",
    ...(original.effect ? { effect: original.effect } : {}),
    ...(original.reply_to ? { reply_to: original.reply_to } : {}),
  };
}

async function readRetryCandidate(input: {
  chatKeys: string[];
  messageKeys: string[];
  now: Date;
  prisma: RetryClient;
}) {
  const delivery = await input.prisma.hostedLinqDelivery.findFirst({
    where: {
      linqChatLookupKey: { in: input.chatKeys },
      OR: [
        { messageLookupKey: { in: input.messageKeys } },
        { messages: { some: { OR: [
          { messageLookupKey: { in: input.messageKeys } },
          { terminalRetryOriginalMessageLookupKey: { in: input.messageKeys } },
        ] } } },
      ],
    },
    select: {
      id: true,
      source: true,
      acceptedAt: true,
      deliveredAt: true,
      messageLookupKey: true,
      messageIdSuffix: true,
      phoneNumberLookupKey: true,
      threadIsDirect: true,
      failedAt: true,
      failureCode: true,
      failureReason: true,
      lastReceiptAt: true,
      lastProviderEventId: true,
      service: true,
      status: true,
      messages: {
        select: {
          id: true,
          messageLookupKey: true,
          status: true,
          failureCode: true,
          failureReason: true,
          terminalRetryOriginalMessageLookupKey: true,
          terminalRetryAttemptedAt: true,
        },
        take: 11,
      },
    },
  });
  if (!delivery) return { candidate: null, reason: "delivery_missing" } as const;
  if (delivery.source !== "hosted_runtime_linq_delivery") {
    return { candidate: null, reason: "delivery_not_runtime_owned" } as const;
  }
  if (delivery.messages.some((item) =>
    item.terminalRetryOriginalMessageLookupKey
    && input.messageKeys.includes(item.terminalRetryOriginalMessageLookupKey)
  )) return { candidate: null, reason: "original_already_replaced" } as const;
  if (delivery.status !== "failed") return { candidate: null, reason: "delivery_not_failed" } as const;
  if (!delivery.phoneNumberLookupKey || !delivery.acceptedAt || delivery.threadIsDirect === null) {
    return { candidate: null, reason: "delivery_authority_incomplete" } as const;
  }
  if (delivery.acceptedAt.getTime() < input.now.getTime() - RETRY_MAX_AGE_MS) {
    return { candidate: null, reason: "delivery_expired" } as const;
  }
  if (delivery.messages.length > 10) return { candidate: null, reason: "delivery_message_limit" } as const;
  const message = delivery.messages.find((item) => input.messageKeys.includes(item.messageLookupKey));
  if (delivery.messages.length && !message) return { candidate: null, reason: "message_not_owned" } as const;
  const failed = message ?? delivery;
  if (message?.terminalRetryAttemptedAt) return { candidate: null, reason: "attempt_already_consumed" } as const;
  if (failed.status !== "failed" || !isHostedLinqTerminalSendFailure(failed)) {
    return { candidate: null, reason: "failure_not_retryable" } as const;
  }
  return { candidate: { delivery, message }, reason: null } as const;
}

async function readRetryPolicyBlock(input: {
  chatId: string;
  chatKeys: string[];
  lineKey: string;
  threadIsDirect: boolean;
  prisma: RetryClient;
}): Promise<string | null> {
  const group = await readHostedThreadRouteByThreadIdentity({
    channel: "linq", threadId: input.chatId, prisma: input.prisma,
  });
  const direct = group ? null : await input.prisma.hostedMemberRouting.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys } },
    select: { memberId: true, linqRecipientPhoneLookupKey: true },
  });
  const memberId = group?.containerMemberId ?? direct?.memberId;
  const lineKey = group?.accountLookupKey ?? direct?.linqRecipientPhoneLookupKey;
  if (!memberId || lineKey !== input.lineKey || Boolean(direct) !== input.threadIsDirect) {
    return "route_mismatch";
  }
  const access = await readHostedRuntimeAiAccessDecision({
    memberId, prisma: input.prisma,
  });
  if (!access.allowed) return access.reason;
  const line = await input.prisma.hostedLinqLine.findUnique({
    where: { phoneNumberLookupKey: input.lineKey },
    select: {
      configuredAt: true, egressPolicy: true, healthStatus: true,
      providerReputationStatus: true, providerServiceStatus: true,
    },
  });
  if (!line?.configuredAt) return "line_not_configured";
  const chat = await input.prisma.hostedLinqChatHealth.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys } },
    select: { providerStatus: true, phoneNumberLookupKey: true },
  });
  if (chat?.phoneNumberLookupKey && chat.phoneNumberLookupKey !== input.lineKey) return "chat_line_mismatch";
  const policy = evaluateHostedLinqEgressPolicy({
    chatHealthStatus: chat?.providerStatus,
    lineDeliveryHealthStatus: line.healthStatus,
    lineEgressPolicy: line.egressPolicy,
    lineReputationStatus: line.providerReputationStatus,
    lineServiceStatus: line.providerServiceStatus,
    newConversation: false,
  });
  return policy.kind === "allow" ? null : policy.code;
}

function readFailedOutboundMismatch(
  original: Message,
  input: { messageId: string; chatId: string; lineKey: string },
): string | null {
  if (original.id !== input.messageId) return "provider_message_mismatch";
  if (original.chat_id !== input.chatId) return "provider_chat_mismatch";
  if (original.is_from_me !== true) return "provider_direction_mismatch";
  if (original.delivery_status !== "failed") return "provider_status_not_failed";
  if (original.service !== "iMessage") return "provider_service_not_imessage";
  return createHostedPhoneLookupKeyReadCandidates(
    original.from_handle?.handle ?? original.from,
  ).includes(input.lineKey) ? null : "provider_sender_mismatch";
}

/**
 * Called both after receipt ingestion and after runtime acceptance so neither
 * arrival order can strand a known terminal failure. The existing message row
 * owns the one-attempt fence, including duplicate/concurrent webhook delivery.
 */
type RetryStage = "candidate" | "policy" | "retrieve" | "content" | "claim" | "send" | "record";
type RetryDiagnostic = {
  stage: RetryStage;
  outcome: "skipped" | "accepted" | "error";
  reason: string;
  attemptClaimed: boolean;
  trigger: "failure_webhook" | "acceptance_callback";
  messageRef: string | null;
  eventIdSuffix: string | null;
  providerStatus?: number;
  errorKind?: "timeout" | "provider_http" | "database" | "unexpected";
};

export async function retryHostedLinqTerminalSend(input: {
  chatId: string | null;
  messageId: string | null;
  prisma: PrismaClient;
  trigger?: RetryDiagnostic["trigger"];
  eventId?: string;
}): Promise<void> {
  const startedAt = Date.now();
  const diagnostic: RetryDiagnostic = {
    stage: "candidate", outcome: "skipped", reason: "missing_provider_identity",
    attemptClaimed: false, trigger: input.trigger ?? "acceptance_callback",
    eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
    messageRef: input.messageId ? sha256Hex(input.messageId).slice(0, 16) : null,
  };
  try {
    await runTerminalRetry(input, diagnostic);
  } catch (error) {
    diagnostic.outcome = "error";
    if (diagnostic.reason !== "replacement_identity_invalid") {
      diagnostic.reason = diagnostic.stage === "send" ? "send_outcome_unknown" : "operation_failed";
    }
    diagnostic.errorKind = error instanceof Prisma.PrismaClientKnownRequestError ? "database" : "unexpected";
    if (isHostedOnboardingError(error)) {
      if (error.cause instanceof LinqApiTimeoutError) diagnostic.errorKind = "timeout";
      const status = error.details?.status;
      if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
        diagnostic.providerStatus = status;
        diagnostic.errorKind = "provider_http";
      }
    }
    throw error;
  } finally {
    // Successful acceptance checks are ordinary, high-volume bookkeeping.
    // A failed-event trigger always leaves an explanation, even without a row.
    if (!(diagnostic.trigger === "acceptance_callback"
      && ["delivery_missing", "delivery_not_failed"].includes(diagnostic.reason))) {
      try {
        const log = diagnostic.outcome === "accepted"
          ? logHostedOnboardingDiagnostic : logHostedOnboardingWarning;
        log("hosted-onboarding.linq.terminal-retry", { ...diagnostic, elapsedMs: Math.max(0, Date.now() - startedAt) });
      } catch { /* Optional diagnostics must never change delivery ownership. */ }
    }
  }
}

async function runTerminalRetry(input: {
  chatId: string | null;
  messageId: string | null;
  prisma: PrismaClient;
}, diagnostic: RetryDiagnostic): Promise<void> {
  if (!input.chatId || !input.messageId) return;
  const { chatId, messageId, prisma } = input;
  const keys = {
    chatKeys: createHostedLinqChatLookupKeyReadCandidates(chatId),
    messageKeys: createHostedLinqMessageLookupKeyReadCandidates(messageId),
    now: new Date(),
  };
  const result = await readRetryCandidate({ ...keys, prisma });
  if (!result.candidate) { diagnostic.reason = result.reason; return; }
  const { delivery } = result.candidate;
  const lineKey = delivery.phoneNumberLookupKey!;
  const threadIsDirect = delivery.threadIsDirect!;
  const policyInput = { chatId, chatKeys: keys.chatKeys, lineKey, threadIsDirect };
  diagnostic.stage = "policy";
  const policyReason = await readRetryPolicyBlock({ ...policyInput, prisma });
  if (policyReason) { diagnostic.reason = policyReason; return; }

  diagnostic.stage = "retrieve";
  const original = await readHostedLinqFailedMessage(messageId);
  const mismatch = readFailedOutboundMismatch(original, { messageId, chatId, lineKey });
  if (mismatch) { diagnostic.reason = mismatch; return; }
  const messageRowId = result.candidate.message?.id
    ?? `hlm_terminal_${sha256Hex(delivery.id)}`;
  diagnostic.stage = "content";
  const body = buildHostedLinqTerminalRetryMessage(original, `terminal-retry:${messageRowId}`);
  if (!body) {
    diagnostic.reason = !original.parts?.length ? "content_missing"
      : original.parts.length > 100 ? "content_part_limit"
      : original.parts.some((part) => part.type === "imessage_app") ? "app_card_not_reconstructible"
      : original.parts.some((part) => part.type === "media" && part.mime_type?.startsWith("audio/")) ? "audio_not_reconstructible"
      : "content_not_reconstructible";
    return;
  }

  diagnostic.stage = "claim";
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM hosted_linq_delivery WHERE id = ${delivery.id} FOR UPDATE
    `);
    const currentResult = await readRetryCandidate({ ...keys, now: new Date(), prisma: tx });
    const current = currentResult.candidate;
    if (!current) { diagnostic.reason = currentResult.reason; return false; }
    if (current.delivery.id !== delivery.id) { diagnostic.reason = "delivery_changed"; return false; }
    const reason = await readRetryPolicyBlock({ ...policyInput, prisma: tx });
    if (reason) { diagnostic.reason = reason; return false; }
    if (!current.message) {
      await tx.hostedLinqDeliveryMessage.create({
        data: {
          id: messageRowId, deliveryId: delivery.id, ordinal: 0,
          messageLookupKey: current.delivery.messageLookupKey!,
          messageIdSuffix: current.delivery.messageIdSuffix,
          acceptedAt: current.delivery.acceptedAt!,
          deliveredAt: current.delivery.deliveredAt,
          failedAt: current.delivery.failedAt,
          failureCode: current.delivery.failureCode,
          failureReason: current.delivery.failureReason,
          lastReceiptAt: current.delivery.lastReceiptAt,
          lastProviderEventId: current.delivery.lastProviderEventId,
          service: current.delivery.service,
          status: "failed",
        },
      });
    }
    const claim = await tx.hostedLinqDeliveryMessage.updateMany({
      where: { id: messageRowId, terminalRetryAttemptedAt: null },
      data: { terminalRetryAttemptedAt: new Date() },
    });
    if (claim.count !== 1) diagnostic.reason = "claim_lost";
    return claim.count === 1;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (!claimed) return;
  diagnostic.attemptClaimed = true;

  // Ambiguous dispatch consumes the attempt; never release this fence.
  diagnostic.stage = "send";
  const accepted = await resendHostedLinqMessage({ chatId, message: body });
  if (accepted.chatId !== chatId || !accepted.messageId || accepted.messageId === messageId) {
    diagnostic.stage = "record";
    diagnostic.reason = "replacement_identity_invalid";
    throw new Error("Linq terminal retry response omitted the expected identity.");
  }
  diagnostic.stage = "record";
  await prisma.$transaction((tx) => recordHostedLinqTerminalRetryAcceptedTx({
    acceptedAt: new Date(), deliveryId: delivery.id, messageRowId,
    messageId: accepted.messageId!, phoneNumberLookupKey: lineKey, prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  diagnostic.outcome = "accepted";
  diagnostic.reason = "replacement_accepted_delivery_unconfirmed";
}
