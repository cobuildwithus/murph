import "server-only";

import type { TelegramThreadTarget } from "@murphai/messaging-ingress/telegram-webhook";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const HOSTED_TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Telegram caps `callback_data` at 64 bytes. Murph never needs a token there:
 * the callback update already carries the exact chat and message the button was
 * attached to, and that pair is the durable binding to the stored offer.
 */
export const HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA = "murph:group:join";
export const HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA = "murph:group:allow";

function requireHostedTelegramBotToken(): string {
  const token = normalizeNullableString(getHostedOnboardingEnvironment().telegramBotToken);

  if (!token) {
    throw hostedOnboardingError({
      code: "HOSTED_TELEGRAM_BOT_TOKEN_NOT_CONFIGURED",
      httpStatus: 500,
      message: "TELEGRAM_BOT_TOKEN must be configured to call the Telegram Bot API.",
      retryable: false,
    });
  }
  return token;
}

/**
 * Issues one bounded Bot API request. Callers that need delivery proof only rely
 * on Telegram accepting the request; response bodies stay outside this small
 * transport boundary.
 */
async function callHostedTelegramApi(input: {
  body: unknown;
  method: string;
  signal?: AbortSignal;
}): Promise<void> {
  const token = requireHostedTelegramBotToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOSTED_TELEGRAM_REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(`${HOSTED_TELEGRAM_API_BASE_URL}/bot${token}/${input.method}`, {
        body: JSON.stringify(input.body),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
    } catch {
      throw hostedOnboardingError({
        code: "HOSTED_TELEGRAM_API_REQUEST_FAILED",
        httpStatus: 502,
        message: `Telegram ${input.method} request failed.`,
        retryable: true,
      });
    }

    if (!response.ok) {
      const retryAfterSeconds = readHostedTelegramRetryAfterSeconds(response);
      throw hostedOnboardingError({
        code: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
        details: {
          status: response.status,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
        httpStatus: 502,
        message: `Telegram ${input.method} failed with HTTP ${response.status}.`,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

function readHostedTelegramRetryAfterSeconds(
  response: Response,
): number | undefined {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  return Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds
    : undefined;
}

export async function sendHostedTelegramTextMessage(input: {
  message: string;
  replyToMessageId?: number | null;
  signal?: AbortSignal;
  target: TelegramThreadTarget;
}): Promise<void> {
  const chatId = normalizeNullableString(input.target.chatId);
  const message = normalizeNullableString(input.message);
  if (!chatId || !message) {
    throw new TypeError("Hosted Telegram text delivery requires a target and message.");
  }

  const replyToMessageId = typeof input.replyToMessageId === "number"
    && Number.isSafeInteger(input.replyToMessageId)
    && input.replyToMessageId > 0
    ? input.replyToMessageId
    : null;

  await callHostedTelegramApi({
    body: {
      chat_id: chatId,
      text: message,
      ...(input.target.businessConnectionId
        ? { business_connection_id: input.target.businessConnectionId }
        : {}),
      ...(input.target.messageThreadId
        ? { message_thread_id: input.target.messageThreadId }
        : {}),
      ...(input.target.directMessagesTopicId
        ? { direct_messages_topic_id: input.target.directMessagesTopicId }
        : {}),
      ...(replyToMessageId
        ? {
            reply_parameters: {
              allow_sending_without_reply: true,
              message_id: replyToMessageId,
            },
          }
        : {}),
    },
    method: "sendMessage",
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

/**
 * Telegram clients spin a progress indicator on the tapped button until the
 * callback is answered, so this runs on every outcome, accepted or ignored.
 * It is best effort: the durable grant already committed before this point.
 */
export async function answerHostedTelegramCallbackQueryBestEffort(input: {
  callbackQueryId: string;
  signal?: AbortSignal;
  text?: string | null;
}): Promise<void> {
  const text = normalizeNullableString(input.text);

  try {
    await callHostedTelegramApi({
      body: {
        callback_query_id: input.callbackQueryId,
        ...(text ? { text } : {}),
      },
      method: "answerCallbackQuery",
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch {
    // The tap already produced its durable effect; a failed acknowledgement
    // only leaves the client spinner running briefly.
  }
}
