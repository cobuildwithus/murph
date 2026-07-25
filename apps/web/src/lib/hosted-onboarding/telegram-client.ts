import "server-only";

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
 * Issues one bounded Bot API request. No caller consumes the Bot API result
 * today, so nothing here parses one; a future outbound sender can add exactly
 * the parsing its own delivery proof requires.
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
    await fetch(`${HOSTED_TELEGRAM_API_BASE_URL}/bot${token}/${input.method}`, {
      body: JSON.stringify(input.body),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
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
