import "server-only";

import { randomInt } from "node:crypto";
import { sealHostedUserSecureBoxString, openHostedUserSecureBoxString } from "../hosted-crypto/secure-box";
import { startHostedPointerWorkflow } from "./workflow-start";
import { hostedLinqTerminalRetryWorkflow } from "./linq-terminal-retry-workflow";

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

// Five total sends, including the original, within three minutes of acceptance.
const RETRY_MAX_AGE_MS = 180_000;
const RETRY_DELAYS_MS = [10_000, 20_000, 40_000, 80_000] as const;
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
    ...(original.preferred_service != null ? { preferred_service: original.preferred_service } : {}),
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
          { terminalRetryPreviousMessageLookupKeys: { hasSome: input.messageKeys } },
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
          deliveredAt: true,
          service: true,
          failureCode: true,
          failureReason: true,
          terminalRetryOriginalMessageLookupKey: true,
          terminalRetryAttemptedAt: true,
          terminalRetryCount: true,
          terminalRetryClaimedMessageLookupKey: true,
          terminalRetryNextAt: true,
          terminalRetryExpiresAt: true,
          terminalRetryOwnerMemberId: true,
          terminalRetryContextCiphertext: true,
          terminalRetryPreviousMessageLookupKeys: true,
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
    !input.messageKeys.includes(item.messageLookupKey)
    && (item.terminalRetryPreviousMessageLookupKeys.some((key) => input.messageKeys.includes(key))
      || (item.terminalRetryOriginalMessageLookupKey
        && input.messageKeys.includes(item.terminalRetryOriginalMessageLookupKey)))
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
  if (failed.deliveredAt) return { candidate: null, reason: "message_has_delivery_evidence" } as const;
  const attemptBlock = readAttemptBlock(message);
  if (attemptBlock) return { candidate: null, reason: attemptBlock } as const;
  // Never replay an older answer after a newer logical delivery was accepted.
  const newer = await input.prisma.hostedLinqDelivery.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys }, id: { not: delivery.id },
      source: "hosted_runtime_linq_delivery", acceptedAt: { gt: delivery.acceptedAt } },
    select: { id: true },
  });
  if (newer) return { candidate: null, reason: "delivery_superseded" } as const;
  if (failed.status !== "failed" || !isHostedLinqTerminalSendFailure(failed)) {
    return { candidate: null, reason: "failure_not_retryable" } as const;
  }
  // Only this exact failed receipt owns fallback service evidence, not a sibling
  // or the multipart parent's latest-receipt projection.
  return { candidate: { delivery, message, receiptService: failed.service }, reason: null } as const;
}

type RetryCandidate = NonNullable<Awaited<ReturnType<typeof readRetryCandidate>>["candidate"]>;
type RetryMessage = NonNullable<RetryCandidate["message"]>;

function readAttemptBlock(message: RetryMessage | undefined): string | null {
  if (!message) return null;
  if (message.terminalRetryAttemptedAt && (!message.terminalRetryExpiresAt
    || message.terminalRetryClaimedMessageLookupKey === message.messageLookupKey)) return "attempt_already_consumed";
  if (message.terminalRetryCount >= RETRY_DELAYS_MS.length) return "attempt_limit";
  return null;
}

async function readRetryPolicyBlock(input: {
  chatId: string;
  chatKeys: string[];
  lineKey: string;
  threadIsDirect: boolean;
  expectedMemberId?: string | null;
  prisma: RetryClient;
}): Promise<{ reason: string | null; memberId: string | null }> {
  const group = await readHostedThreadRouteByThreadIdentity({
    channel: "linq", threadId: input.chatId, prisma: input.prisma,
  });
  const direct = group ? null : await input.prisma.hostedMemberRouting.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys } },
    select: { memberId: true, linqRecipientPhoneLookupKey: true },
  });
  const memberId = group ? group.containerMemberId : direct?.memberId;
  const lineKey = group ? group.accountLookupKey : direct?.linqRecipientPhoneLookupKey;
  if (!memberId || lineKey !== input.lineKey || Boolean(direct) !== input.threadIsDirect
    || (input.expectedMemberId && input.expectedMemberId !== memberId)) {
    return { reason: "route_mismatch", memberId: null };
  }
  const access = await readHostedRuntimeAiAccessDecision({
    memberId, prisma: input.prisma,
  });
  if (!access.allowed) return { reason: access.reason, memberId };
  const line = await input.prisma.hostedLinqLine.findUnique({
    where: { phoneNumberLookupKey: input.lineKey },
    select: {
      configuredAt: true, egressPolicy: true, healthStatus: true,
      providerReputationStatus: true, providerServiceStatus: true,
    },
  });
  if (!line?.configuredAt) return { reason: "line_not_configured", memberId };
  const chat = await input.prisma.hostedLinqChatHealth.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys } },
    select: { providerStatus: true, phoneNumberLookupKey: true },
  });
  if (chat?.phoneNumberLookupKey && chat.phoneNumberLookupKey !== input.lineKey) return { reason: "chat_line_mismatch", memberId };
  const policy = evaluateHostedLinqEgressPolicy({
    chatHealthStatus: chat?.providerStatus,
    lineDeliveryHealthStatus: line.healthStatus,
    lineEgressPolicy: line.egressPolicy,
    lineReputationStatus: line.providerReputationStatus,
    lineServiceStatus: line.providerServiceStatus,
    newConversation: false,
  });
  return { reason: policy.kind === "allow" ? null : policy.code, memberId };
}

function readFailedOutboundMismatch(
  original: Message,
  input: { messageId: string; chatId: string; lineKey: string; receiptService: string | null },
): string | null {
  if (original.id !== input.messageId) return "provider_message_mismatch";
  if (original.chat_id !== input.chatId) return "provider_chat_mismatch";
  if (original.is_from_me !== true) return "provider_direction_mismatch";
  if (original.delivery_status !== "failed" || original.is_delivered === true || original.is_read === true) return "provider_status_not_failed";
  // A definitive no-send can have no transport at all. Preserve the original
  // automatic policy; never infer or force iMessage from missing metadata.
  if ((original.service != null && original.service !== "iMessage")
    || (input.receiptService != null && input.receiptService !== "iMessage")) {
    return "provider_service_not_imessage";
  }
  if (original.preferred_service != null && original.preferred_service !== "iMessage") {
    return "provider_preferred_service_not_imessage";
  }
  return createHostedPhoneLookupKeyReadCandidates(
    original.from_handle?.handle ?? original.from,
  ).includes(input.lineKey) ? null : "provider_sender_mismatch";
}

type RetryServiceClass = "omitted" | "null" | "imessage" | "sms" | "rcs" | "unknown";

function classifyRetryService(value: unknown): RetryServiceClass {
  switch (value) {
    case undefined: return "omitted";
    case null: return "null";
    case "iMessage": return "imessage";
    case "SMS": return "sms";
    case "RCS": return "rcs";
    default: return "unknown";
  }
}

type RetryStage = "candidate" | "policy" | "schedule" | "retrieve" | "content" | "claim" | "send" | "record";
type RetryDiagnostic = {
  stage: RetryStage;
  outcome: "skipped" | "scheduled" | "accepted" | "error";
  reason: string;
  attemptClaimed: boolean;
  trigger: "failure_webhook" | "acceptance_callback" | "durable_wake";
  messageRef: string | null;
  deliveryRef?: string;
  attempt?: number;
  replacementMessageRef?: string;
  eventIdSuffix: string | null;
  providerStatus?: number;
  providerServiceClass?: RetryServiceClass;
  providerPreferredServiceClass?: RetryServiceClass;
  receiptServiceClass?: RetryServiceClass;
  errorKind?: "timeout" | "provider_http" | "database" | "unexpected";
};

/**
 * Called both after receipt ingestion and after runtime acceptance so neither
 * arrival order can strand a known terminal failure. The existing message row
 * owns each permanent dispatch fence, including duplicate/concurrent webhook delivery.
 */
export async function retryHostedLinqTerminalSend(input: {
  chatId: string | null;
  messageId: string | null;
  prisma: PrismaClient;
  trigger?: RetryDiagnostic["trigger"];
  eventId?: string;
  execute?: boolean;
}): Promise<RetryDiagnostic> {
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
        const log = diagnostic.outcome === "accepted" || diagnostic.outcome === "scheduled"
          ? logHostedOnboardingDiagnostic : logHostedOnboardingWarning;
        log("hosted-onboarding.linq.terminal-retry", { ...diagnostic, elapsedMs: Math.max(0, Date.now() - startedAt) });
      } catch { /* Optional diagnostics must never change delivery ownership. */ }
    }
  }
  return diagnostic;
}

async function runTerminalRetry(input: {
  chatId: string | null;
  messageId: string | null;
  prisma: PrismaClient;
  execute?: boolean;
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
  diagnostic.deliveryRef = sha256Hex(delivery.id).slice(0, 16);
  diagnostic.receiptServiceClass = classifyRetryService(result.candidate.receiptService);
  const lineKey = delivery.phoneNumberLookupKey!;
  const threadIsDirect = delivery.threadIsDirect!;
  const policyInput = { chatId, chatKeys: keys.chatKeys, lineKey, threadIsDirect,
    expectedMemberId: result.candidate.message?.terminalRetryOwnerMemberId };
  diagnostic.stage = "policy";
  const authority = await readRetryPolicyBlock({ ...policyInput, prisma });
  if (authority.reason || !authority.memberId) { diagnostic.reason = authority.reason ?? "route_mismatch"; return; }
  const memberId = authority.memberId;
  const messageRowId = result.candidate.message?.id ?? `hlm_terminal_${sha256Hex(delivery.id)}`;
  const attempt = (result.candidate.message?.terminalRetryCount ?? 0) + 1;
  diagnostic.attempt = attempt;
  const expiresAt = result.candidate.message?.terminalRetryExpiresAt
    ?? new Date(delivery.acceptedAt!.getTime() + RETRY_MAX_AGE_MS);
  if (Date.now() + 8_000 >= expiresAt.getTime()) { diagnostic.reason = "delivery_expired"; return; }
  if (!input.execute || !result.candidate.message?.terminalRetryNextAt) {
    diagnostic.stage = "schedule";
    await scheduleTerminalRetry({ chatId, messageId, prisma, messageRowId, memberId,
      deliveryId: delivery.id, keys, policyInput, expiresAt, attempt, execute: Boolean(input.execute) }, diagnostic);
    return;
  }
  if (result.candidate.message.terminalRetryOwnerMemberId !== memberId) { diagnostic.reason = "route_mismatch"; return; }
  if (result.candidate.message.terminalRetryNextAt.getTime() > Date.now()) { diagnostic.reason = "retry_not_due"; return; }

  await executeTerminalRetry({ chatId, messageId, prisma, messageRowId, memberId,
    deliveryId: delivery.id, keys, policyInput, expiresAt, attempt,
    candidate: result.candidate, message: result.candidate.message }, diagnostic);
}

async function executeTerminalRetry(input: Omit<Parameters<typeof scheduleTerminalRetry>[0], "execute"> & {
  candidate: RetryCandidate; message: RetryMessage;
}, diagnostic: RetryDiagnostic): Promise<void> {
  const { chatId, messageId, prisma, messageRowId, memberId, expiresAt,
    attempt, keys, policyInput, candidate, message } = input;
  const { delivery } = candidate;
  const lineKey = policyInput.lineKey;
  diagnostic.stage = "retrieve";
  const original = await readHostedLinqFailedMessage(messageId);
  diagnostic.providerServiceClass = classifyRetryService(original.service);
  diagnostic.providerPreferredServiceClass = classifyRetryService(original.preferred_service);
  const mismatch = readFailedOutboundMismatch(original, {
    messageId, chatId, lineKey, receiptService: candidate.receiptService,
  });
  if (mismatch) { diagnostic.reason = mismatch; return; }
  diagnostic.stage = "content";
  const body = buildHostedLinqTerminalRetryMessage(original, `terminal-retry:${messageRowId}:${attempt}`);
  if (!body) {
    diagnostic.reason = readRetryContentExclusion(original);
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
    diagnostic.receiptServiceClass = classifyRetryService(current.receiptService);
    const mismatch = readFailedOutboundMismatch(original, {
      messageId, chatId, lineKey, receiptService: current.receiptService,
    });
    if (mismatch) { diagnostic.reason = mismatch; return false; }
    const policy = await readRetryPolicyBlock({ ...policyInput, prisma: tx });
    if (policy.reason || policy.memberId !== memberId) { diagnostic.reason = policy.reason ?? "route_mismatch"; return false; }
    if (Date.now() + 5_000 >= expiresAt.getTime()) { diagnostic.reason = "delivery_expired"; return false; }
    const claim = await tx.hostedLinqDeliveryMessage.updateMany({
      where: { id: messageRowId, messageLookupKey: current.message!.messageLookupKey,
        terminalRetryCount: attempt - 1, terminalRetryNextAt: { lte: new Date() } },
      data: { terminalRetryAttemptedAt: new Date(), terminalRetryCount: attempt,
        terminalRetryClaimedMessageLookupKey: current.message!.messageLookupKey },
    });
    if (claim.count !== 1) diagnostic.reason = "claim_lost";
    return claim.count === 1;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (!claimed) return;
  diagnostic.attemptClaimed = true;

  // Ambiguous dispatch consumes the attempt; never release this fence.
  diagnostic.stage = "send";
  const accepted = await resendHostedLinqMessage({ chatId, message: body });
  if (accepted.chatId !== chatId || !accepted.messageId || accepted.messageId === messageId
    || createHostedLinqMessageLookupKeyReadCandidates(accepted.messageId).some((key) => message.terminalRetryPreviousMessageLookupKeys.includes(key))) {
    diagnostic.stage = "record";
    diagnostic.reason = "replacement_identity_invalid";
    throw new Error("Linq terminal retry response omitted the expected identity.");
  }
  diagnostic.stage = "record";
  const contextCiphertext = await sealRetryContext({ prisma, memberId, messageRowId, chatId, messageId: accepted.messageId });
  await prisma.$transaction((tx) => recordHostedLinqTerminalRetryAcceptedTx({
    acceptedAt: new Date(), deliveryId: delivery.id, messageRowId,
    messageId: accepted.messageId!, phoneNumberLookupKey: lineKey, prisma: tx,
    expectedMessageLookupKey: message.messageLookupKey, attempt, contextCiphertext,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  diagnostic.replacementMessageRef = sha256Hex(accepted.messageId).slice(0, 16);
  diagnostic.outcome = "accepted";
  diagnostic.reason = "replacement_accepted_delivery_unconfirmed";
}

function readRetryContentExclusion(original: Message): string {
  if (!original.parts?.length) return "content_missing";
  if (original.parts.length > 100) return "content_part_limit";
  if (original.parts.some((part) => part.type === "imessage_app")) return "app_card_not_reconstructible";
  if (original.parts.some((part) => part.type === "media" && part.mime_type?.startsWith("audio/"))) return "audio_not_reconstructible";
  return "content_not_reconstructible";
}

async function scheduleTerminalRetry(input: {
  chatId: string; messageId: string; prisma: PrismaClient; messageRowId: string;
  memberId: string; deliveryId: string; expiresAt: Date; attempt: number; execute: boolean;
  keys: { chatKeys: string[]; messageKeys: string[]; now: Date };
  policyInput: Omit<Parameters<typeof readRetryPolicyBlock>[0], "prisma">;
}, diagnostic: RetryDiagnostic): Promise<void> {
  const { chatId, messageId, prisma, messageRowId, memberId, deliveryId,
    expiresAt, attempt, keys, policyInput, execute } = input;
  const contextCiphertext = await sealRetryContext({ prisma, memberId, messageRowId, chatId, messageId });
  const nextAt = new Date(Date.now() + Math.floor(RETRY_DELAYS_MS[attempt - 1]! * randomInt(80, 101) / 100));
  const scheduled = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM hosted_linq_delivery WHERE id = ${deliveryId} FOR UPDATE`);
    const current = await readRetryCandidate({ ...keys, now: new Date(), prisma: tx });
    if (!current.candidate) { diagnostic.reason = current.reason; return false; }
    const policy = await readRetryPolicyBlock({ ...policyInput, prisma: tx });
    if (policy.reason || policy.memberId !== memberId) { diagnostic.reason = policy.reason ?? "route_mismatch"; return false; }
    if (!current.candidate.message) await promoteLegacyMessage(tx, messageRowId, current.candidate.delivery);
    await tx.hostedLinqDeliveryMessage.updateMany({
      where: { id: messageRowId, terminalRetryNextAt: null },
      // Close the legacy one-shot writer at admission during rolling deploys.
      // New writers use count + exact claimed key as the dispatch authority.
      data: { terminalRetryAttemptedAt: new Date(), terminalRetryNextAt: nextAt, terminalRetryExpiresAt: expiresAt,
        terminalRetryContextCiphertext: contextCiphertext, terminalRetryOwnerMemberId: memberId },
    });
    return true;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (scheduled) {
    if (!execute) await startHostedPointerWorkflow({
      workflow: hostedLinqTerminalRetryWorkflow, payload: { messageRowId },
      signal: AbortSignal.timeout(5_000),
      error: { code: "HOSTED_LINQ_RETRY_START_FAILED", message: "Linq delivery recovery could not be scheduled." },
    });
    diagnostic.outcome = "scheduled";
    diagnostic.reason = "terminal_recovery_scheduled";
  }
}

function retryContextOptions(input: { memberId: string; messageRowId: string; prisma: PrismaClient }) {
  return { aad: { field: "terminal_retry_context_ciphertext", purpose: "linq-terminal-retry",
    rowId: input.messageRowId, table: "hosted_linq_delivery_message" },
    lane: "hosted-member-private-field" as const, scope: "linq-terminal-retry:v1",
    userId: input.memberId, prisma: input.prisma };
}

async function sealRetryContext(input: {
  memberId: string; messageRowId: string; prisma: PrismaClient; chatId: string; messageId: string;
}): Promise<string> {
  const encrypted = await sealHostedUserSecureBoxString({ ...retryContextOptions(input),
    value: JSON.stringify({ chatId: input.chatId, messageId: input.messageId }) });
  if (!encrypted) throw new Error("Linq recovery context encryption failed.");
  return encrypted;
}

async function promoteLegacyMessage(prisma: Prisma.TransactionClient, id: string,
  delivery: NonNullable<Awaited<ReturnType<typeof readRetryCandidate>>["candidate"]>["delivery"]) {
  await prisma.hostedLinqDeliveryMessage.create({ data: {
    id, deliveryId: delivery.id, ordinal: 0, messageLookupKey: delivery.messageLookupKey!,
    messageIdSuffix: delivery.messageIdSuffix, acceptedAt: delivery.acceptedAt!,
    deliveredAt: delivery.deliveredAt, failedAt: delivery.failedAt, failureCode: delivery.failureCode,
    failureReason: delivery.failureReason, lastReceiptAt: delivery.lastReceiptAt,
    lastProviderEventId: delivery.lastProviderEventId, service: delivery.service, status: "failed",
  } });
}

/** Pointer-only durable wake; all authority and dispatch fences remain in Postgres. */
export async function processHostedLinqTerminalRetry(input: {
  messageRowId: string; prisma: PrismaClient;
}): Promise<Date | null> {
  const row = await input.prisma.hostedLinqDeliveryMessage.findUnique({ where: { id: input.messageRowId } });
  if (!row?.terminalRetryExpiresAt || !row.terminalRetryContextCiphertext || !row.terminalRetryOwnerMemberId) return null;
  if (row.terminalRetryExpiresAt.getTime() <= Date.now() + 8_000
    || row.terminalRetryCount >= RETRY_DELAYS_MS.length
    || row.terminalRetryClaimedMessageLookupKey === row.messageLookupKey
    || row.status !== "failed" || !isHostedLinqTerminalSendFailure(row)) return null;
  const context = await openRetryContext({ ...input, memberId: row.terminalRetryOwnerMemberId,
    ciphertext: row.terminalRetryContextCiphertext, messageLookupKey: row.messageLookupKey });
  if (!context) return null;
  const result = await retryHostedLinqTerminalSend({ chatId: context.chatId, messageId: context.messageId,
    prisma: input.prisma, execute: true, trigger: "durable_wake" });
  if (result.outcome === "skipped" && result.reason !== "retry_not_due") return null;
  const current = await input.prisma.hostedLinqDeliveryMessage.findUnique({ where: { id: input.messageRowId } });
  if (!current || current.status !== "failed" || current.terminalRetryCount >= RETRY_DELAYS_MS.length
    || current.terminalRetryClaimedMessageLookupKey === current.messageLookupKey) return null;
  return current.terminalRetryNextAt ?? new Date(Date.now() + 1_000);
}

async function openRetryContext(input: {
  messageRowId: string; memberId: string; prisma: PrismaClient; ciphertext: string; messageLookupKey: string;
}): Promise<{ chatId: string; messageId: string } | null> {
  const raw = await openHostedUserSecureBoxString({ ...retryContextOptions({ ...input, memberId: input.memberId }),
    value: input.ciphertext });
  const context: unknown = raw ? JSON.parse(raw) : null;
  if (!context || typeof context !== "object" || !("chatId" in context) || !("messageId" in context)
    || typeof context.chatId !== "string" || typeof context.messageId !== "string"
    || !createHostedLinqMessageLookupKeyReadCandidates(context.messageId).includes(input.messageLookupKey)) return null;
  return { chatId: context.chatId, messageId: context.messageId };
}
