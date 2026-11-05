import type { PrismaClient } from "@prisma/client";

import {
  classifyHostedLinqAckReaction,
  HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS,
  HOSTED_LINQ_ACK_REACTION_HEAVY_THRESHOLD,
  type HostedLinqAckReactionDecision,
  type HostedLinqAckReactionMessage,
} from "./linq-ack-reaction-classifier";
import {
  claimHostedLinqAckReaction,
  confirmHostedLinqAckReaction,
  markHostedLinqAckReactionHeavy,
  releaseHostedLinqAckReaction,
} from "./linq-ack-reaction-store";
import { addHostedLinqMessageReaction } from "./linq-client";
import { deriveHostedOnboardingTimingErrorName, logHostedOnboardingDiagnostic } from "./logging";
import type { HostedLinqMessageReceivedEvent } from "./linq-webhook";
import { getHostedOnboardingEnvironment } from "./runtime";

const HOSTED_LINQ_ACK_REACTION_MAX_TEXT_LENGTH = 1_000;
const HOSTED_LINQ_ACK_REACTION_MAX_IMAGES = 2;

/** The whole optional task, classifier through tapback, ends by this budget. */
export const HOSTED_LINQ_ACK_REACTION_DEADLINE_MS = 4_000;
const HOSTED_LINQ_ACK_REACTION_MIN_SEND_MS = 250;

type HostedLinqAckReactionOutcome =
  | "answered_or_burst_taken"
  | "classifier_error"
  | "expired"
  | "heavy"
  | "provider_ambiguous"
  | "provider_refused"
  | "quiet"
  | "reacted"
  | "reacted_unconfirmed"
  | "skipped_empty"
  | "store_error";

/**
 * Text plus image URLs from the raw Linq event. The mailbox envelope drops the
 * signed media URLs, so this must read the webhook payload.
 */
export function readHostedLinqAckReactionMessage(
  event: HostedLinqMessageReceivedEvent,
): HostedLinqAckReactionMessage | null {
  const texts: string[] = [];
  const imageUrls: string[] = [];
  for (const part of event.data.message?.parts ?? []) {
    if (part.type === "text" || part.type === "link") {
      if (part.value.trim()) texts.push(part.value.trim());
    } else if (
      part.type === "media"
      && part.mime_type?.toLowerCase().startsWith("image/")
      && part.url?.startsWith("https://")
      && imageUrls.length < HOSTED_LINQ_ACK_REACTION_MAX_IMAGES
    ) {
      imageUrls.push(part.url);
    }
  }
  const text = texts.join("\n").slice(0, HOSTED_LINQ_ACK_REACTION_MAX_TEXT_LENGTH);
  return text || imageUrls.length > 0 ? { imageUrls, text } : null;
}

type HostedLinqAckReactionGateInput = {
  currentInboundReply: { chatId: string | null; messageId: string | null } | null;
  event: { event_type: string } | null;
  instantFirstTurnOwnsReply: boolean;
  response: { reason?: string | null };
  wakeHandoff?: { conversationIsGroup?: boolean; linqChatId?: string | null } | null;
  wakeHandoffResult?: { started?: boolean } | null;
};

/** Only an ordinary direct member turn whose wake was handed off qualifies. */
function isHostedLinqAckReactionTurn(input: HostedLinqAckReactionGateInput): boolean {
  return input.response.reason === "wake-appended-active-member"
    && input.wakeHandoffResult?.started === true
    && !input.instantFirstTurnOwnsReply
    && input.wakeHandoff?.conversationIsGroup === false;
}

/** The member's own direct iMessage; SMS cannot show a custom tapback. */
function readHostedLinqAckReactionEvent(
  event: { event_type: string } | null,
): HostedLinqMessageReceivedEvent | null {
  if (event?.event_type !== "message.received") return null;
  const message = event as HostedLinqMessageReceivedEvent;
  return message.data.chat?.is_group !== true
    && !message.data.is_from_me
    && message.data.service?.trim().toLowerCase() === "imessage"
    ? message
    : null;
}

/** The exact current inbound, which also excludes converted member reactions. */
function readHostedLinqAckReactionTarget(
  input: HostedLinqAckReactionGateInput,
  event: HostedLinqMessageReceivedEvent,
): { linqChatId: string; messageId: string } | null {
  const linqChatId = input.wakeHandoff?.linqChatId?.trim() ?? "";
  const messageId = event.data.message?.id?.trim() ?? "";
  const current = input.currentInboundReply;
  return linqChatId
    && messageId
    && current?.chatId?.trim() === linqChatId
    && current.messageId?.trim() === messageId
    ? { linqChatId, messageId }
    : null;
}

/**
 * Decides synchronously whether this inbound may get a tapback and, if so,
 * hands the work to the after-response scheduler. It never awaits, never
 * throws, and runs only once the wake handoff has settled, so the webhook
 * response, the wake, and later requests never wait on it.
 */
export function maybeScheduleHostedLinqAckReaction(input: HostedLinqAckReactionGateInput & {
  prisma: Pick<PrismaClient, "$transaction">;
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
  webhookReceivedAt?: Date;
}): boolean {
  try {
    const schedule = input.scheduleAfterResponse;
    const messageReceivedAt = input.webhookReceivedAt;
    if (!schedule || !messageReceivedAt || !isHostedLinqAckReactionTurn(input)) return false;
    const event = readHostedLinqAckReactionEvent(input.event);
    const target = event ? readHostedLinqAckReactionTarget(input, event) : null;
    const apiKey = target ? getHostedOnboardingEnvironment().linqAckReactionOpenAiApiKey : null;
    if (!event || !target || !apiKey) return false;
    const prisma = input.prisma;
    // The route falls back to `void task()` when after() is unavailable, so the
    // task must never reject.
    schedule(() => runHostedLinqAckReactionBestEffort({
      apiKey,
      event,
      ...target,
      messageReceivedAt,
      prisma,
    }).catch(() => undefined));
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs after the webhook response, after the mailbox wake was handed off.
 * One deadline bounds the whole task; database work is bounded by its own
 * short transaction limits. Never throws: every outcome ends with one
 * diagnostic line.
 */
export async function runHostedLinqAckReactionBestEffort(input: {
  addReaction?: typeof addHostedLinqMessageReaction;
  apiKey: string;
  classify?: typeof classifyHostedLinqAckReaction;
  deadlineMs?: number;
  event: HostedLinqMessageReceivedEvent;
  linqChatId: string;
  messageId: string;
  messageReceivedAt: Date;
  prisma: Pick<PrismaClient, "$transaction">;
}): Promise<void> {
  const startedAt = performance.now();
  const deadlineAt = Date.now() + (input.deadlineMs ?? HOSTED_LINQ_ACK_REACTION_DEADLINE_MS);
  const remainingMs = () => deadlineAt - Date.now();
  let decision: HostedLinqAckReactionDecision | null = null;
  let classifierMs: number | null = null;
  const finish = (outcome: HostedLinqAckReactionOutcome, details: {
    error?: unknown;
    httpStatus?: number;
  } = {}) => {
    logHostedOnboardingDiagnostic("hosted-onboarding.webhook.linq.ack-reaction", {
      classifierMs,
      ...(details.error === undefined ? {} : { errorName: deriveHostedOnboardingTimingErrorName(details.error) }),
      heavy: decision ? decision.heavy >= HOSTED_LINQ_ACK_REACTION_HEAVY_THRESHOLD : null,
      ...(details.httpStatus === undefined ? {} : { httpStatus: details.httpStatus }),
      kind: decision?.kind ?? null,
      outcome,
      totalMs: Math.round(performance.now() - startedAt),
    });
  };

  const message = readHostedLinqAckReactionMessage(input.event);
  if (!message) {
    finish("skipped_empty");
    return;
  }

  try {
    decision = await (input.classify ?? classifyHostedLinqAckReaction)({
      apiKey: input.apiKey,
      message,
      signal: AbortSignal.timeout(Math.max(1, Math.min(
        HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS,
        remainingMs(),
      ))),
    });
  } catch (error) {
    classifierMs = Math.round(performance.now() - startedAt);
    finish("classifier_error", { error });
    return;
  }
  classifierMs = Math.round(performance.now() - startedAt);

  let claimedAt: Date | null;
  try {
    if (decision && decision.heavy >= HOSTED_LINQ_ACK_REACTION_HEAVY_THRESHOLD) {
      await markHostedLinqAckReactionHeavy({
        linqChatId: input.linqChatId,
        messageReceivedAt: input.messageReceivedAt,
        prisma: input.prisma,
      });
      finish("heavy");
      return;
    }
    if (!decision?.emoji) {
      finish("quiet");
      return;
    }
    if (remainingMs() < HOSTED_LINQ_ACK_REACTION_MIN_SEND_MS) {
      finish("expired");
      return;
    }
    claimedAt = await claimHostedLinqAckReaction({
      linqChatId: input.linqChatId,
      messageId: input.messageId,
      messageReceivedAt: input.messageReceivedAt,
      prisma: input.prisma,
      reaction: decision.emoji,
    });
  } catch (error) {
    finish("store_error", { error });
    return;
  }
  if (!claimedAt) {
    finish("answered_or_burst_taken");
    return;
  }

  const release = async () => {
    try {
      await releaseHostedLinqAckReaction({ claimedAt, linqChatId: input.linqChatId, prisma: input.prisma });
    } catch {
      // The reservation stays: this burst simply gets no tapback.
    }
  };
  const sendBudgetMs = remainingMs();
  if (sendBudgetMs < HOSTED_LINQ_ACK_REACTION_MIN_SEND_MS) {
    // Nothing was sent, so freeing the reservation is safe.
    await release();
    finish("expired");
    return;
  }

  let result: { ok: boolean; status: number };
  try {
    result = await (input.addReaction ?? addHostedLinqMessageReaction)({
      emoji: decision.emoji,
      messageId: input.messageId,
      signal: AbortSignal.timeout(sendBudgetMs),
      timeoutMs: sendBudgetMs,
    });
  } catch (error) {
    // A timeout or transport error may still have reached the chat. Keep the
    // reservation so the burst cannot get a second tapback, and leave it
    // unconfirmed so progress updates still go out.
    finish("provider_ambiguous", { error });
    return;
  }
  if (result.ok) {
    try {
      await confirmHostedLinqAckReaction({ claimedAt, linqChatId: input.linqChatId, prisma: input.prisma });
    } catch (error) {
      finish("reacted_unconfirmed", { error, httpStatus: result.status });
      return;
    }
    finish("reacted", { httpStatus: result.status });
    return;
  }
  if (isHostedLinqDefiniteRejection(result.status)) {
    await release();
    finish("provider_refused", { httpStatus: result.status });
    return;
  }
  finish("provider_ambiguous", { httpStatus: result.status });
}

/** A 4xx other than a timeout means Linq refused before sending anything. */
function isHostedLinqDefiniteRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408;
}
