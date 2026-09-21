import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import type { ConversationPollSnapshot } from "@murphai/hosted-execution/conversation-polls";
import { parseTelegramThreadTarget } from "@murphai/messaging-ingress/telegram-webhook";
import { runLinqApiRequest } from "../linq/api";
import { requireHostedOnboardingLinqConfig } from "../hosted-onboarding/runtime";
import { callHostedTelegramApi } from "../hosted-onboarding/telegram-client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export const telegramPollSchema = z.object({
  id: z.string().min(1).max(200),
  question: z.string().max(300),
  options: z.array(z.object({ text: z.string().max(100), voter_count: z.number().int().nonnegative() })).max(100),
  total_voter_count: z.number().int().nonnegative(),
  is_closed: z.boolean(),
  is_anonymous: z.boolean(),
  allows_multiple_answers: z.boolean(),
});
const linqPollSchema = z.object({
  chat_id: z.string(),
  message_id: z.string(),
  poll: z.object({
    options: z.array(z.object({ text: z.string().max(100), voters: z.array(z.unknown()) })).max(100),
    total_voters: z.number().int().nonnegative(),
  }),
});

export function telegramPollSnapshot(raw: unknown, pollRef: string, freshness: ConversationPollSnapshot["freshness"]): ConversationPollSnapshot {
  const poll = telegramPollSchema.parse(raw);
  return {
    pollRef, channel: "telegram", question: poll.question,
    options: poll.options.map((option) => ({ text: option.text, votes: option.voter_count })),
    totalVoters: poll.total_voter_count, anonymous: poll.is_anonymous,
    multipleAnswers: poll.allows_multiple_answers, closed: poll.is_closed,
    observedAt: new Date().toISOString(), freshness,
  };
}

export async function callLinqPoll(input: {
  action: "create" | "read";
  chatId: string;
  pollRef: string;
  question: string;
  options?: string[];
  messageId?: string;
}): Promise<{ messageId: string; snapshot: ConversationPollSnapshot }> {
  const config = requireHostedOnboardingLinqConfig();
  try {
    const raw = await runLinqApiRequest({
      ...config,
      timeoutMs: 8_000,
      timeoutMessage: "Poll provider request timed out.",
      request: (client) => input.action === "create"
        ? client.chats.polls.create(input.chatId, {
            poll: { options: (input.options ?? []).map((text) => ({ text })), idempotency_key: input.pollRef },
          })
        : client.messages.poll.retrieve(input.messageId ?? ""),
    });
    const result = linqPollSchema.parse(raw);
    if (result.chat_id !== input.chatId || (input.messageId && result.message_id !== input.messageId)) {
      throw new Error("Poll response route mismatch.");
    }
    return {
      messageId: result.message_id,
      snapshot: {
        pollRef: input.pollRef, channel: "linq", question: input.question,
        options: result.poll.options.map((option) => ({ text: option.text, votes: option.voters.length })),
        totalVoters: result.poll.total_voters, anonymous: false, multipleAnswers: true,
        closed: false, observedAt: new Date().toISOString(),
        freshness: input.action === "create" ? "creation" : "provider_read",
      },
    };
  } catch {
    throw hostedOnboardingError({ code: "HOSTED_POLL_PROVIDER_FAILED", message: "Poll provider request could not be confirmed.", httpStatus: 502, retryable: false });
  }
}

export async function callTelegramPoll(input: {
  action: "create" | "close";
  target: string;
  pollRef: string;
  question?: string;
  options?: string[];
  messageId?: string;
}) {
  const target = parseTelegramThreadTarget(input.target);
  if (!target) throw new TypeError("Invalid Telegram poll target.");
  if (target.directMessagesTopicId) throw new TypeError("Telegram channel direct messages do not support polls.");
  const body = {
    chat_id: target.chatId,
    ...(target.businessConnectionId ? { business_connection_id: target.businessConnectionId } : {}),
    ...(input.action === "create" ? {
      ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
      question: input.question,
      options: input.options?.map((text) => ({ text })),
      is_anonymous: true, allows_multiple_answers: false,
    } : { message_id: Number(input.messageId) }),
  };
  const response = z.object({ ok: z.literal(true), result: z.unknown() }).parse(
    await callHostedTelegramApi({ body, method: input.action === "create" ? "sendPoll" : "stopPoll", readJson: true }),
  );
  const message = input.action === "create"
    ? z.object({ message_id: z.number().int().positive(), chat: z.object({ id: z.union([z.number(), z.string()]) }), poll: telegramPollSchema }).parse(response.result)
    : null;
  if (message && String(message.chat.id) !== String(target.chatId)) throw new TypeError("Poll response route mismatch.");
  const poll = telegramPollSchema.parse(message?.poll ?? response.result);
  return {
    messageId: message ? String(message.message_id) : input.messageId!,
    providerPollId: poll.id,
    snapshot: telegramPollSnapshot(poll, input.pollRef, input.action === "create" ? "creation" : "provider_read"),
  };
}
