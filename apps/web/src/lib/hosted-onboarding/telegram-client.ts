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

export type HostedTelegramInlineKeyboardButton = {
  callbackData: string;
  text: string;
};

export type HostedTelegramSendResult = {
  messageId: string | null;
};

function requireHostedTelegramBotToken(): string {
  const token = normalizeNullableString(getHostedOnboardingEnvironment().telegramBotToken);

  if (!token) {
    throw hostedOnboardingError({
      code: "HOSTED_TELEGRAM_BOT_TOKEN_NOT_CONFIGURED",
      httpStatus: 500,
      message: "TELEGRAM_BOT_TOKEN must be configured to send Telegram messages.",
      retryable: false,
    });
  }
  return token;
}

async function callHostedTelegramApi(input: {
  body: unknown;
  method: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; result?: unknown; status: number }> {
  const token = requireHostedTelegramBotToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOSTED_TELEGRAM_REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(
      `${HOSTED_TELEGRAM_API_BASE_URL}/bot${token}/${input.method}`,
      {
        body: JSON.stringify(input.body),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; result?: unknown }
      | null;
    return {
      ok: payload?.ok === true,
      ...(payload?.result === undefined ? {} : { result: payload.result }),
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Sends exactly one Telegram message. A consent-bearing card must stay atomic:
 * the offered scopes and the button that accepts them cannot land in separate
 * messages, so this never splits long text.
 */
export async function sendHostedTelegramChatMessage(input: {
  buttons?: readonly HostedTelegramInlineKeyboardButton[] | null;
  chatId: string;
  signal?: AbortSignal;
  text: string;
}): Promise<HostedTelegramSendResult> {
  const buttons = input.buttons ?? [];
  const response = await callHostedTelegramApi({
    body: {
      chat_id: input.chatId,
      disable_web_page_preview: true,
      text: input.text,
      ...(buttons.length > 0
        ? {
            reply_markup: {
              inline_keyboard: buttons.map((button) => [
                { callback_data: button.callbackData, text: button.text },
              ]),
            },
          }
        : {}),
    },
    method: "sendMessage",
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "HOSTED_TELEGRAM_SEND_FAILED",
      httpStatus: 502,
      message: "Could not send this Telegram message.",
      retryable: response.status >= 500 || response.status === 429,
    });
  }

  const result = response.result as { message_id?: number | string } | undefined;
  return { messageId: normalizeNullableString(result?.message_id) };
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
