import type { TextPart } from "@linqapp/sdk/resources";
import type {
  MessageSendParams,
  MessageSendResponse,
} from "@linqapp/sdk/resources/chats";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

export type HostedLinqSendResult = {
  chatId: string | null;
  messageId: string | null;
};

export async function sendHostedLinqChatMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(buildHostedLinqTextMessageBody({
      idempotencyKey: input.idempotencyKey,
      message: input.message,
      replyToMessageId,
    })),
    method: "POST",
    operation: "outbound reply",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/messages`,
    signal: input.signal,
    timeoutMessage: "Linq outbound reply timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "outbound reply",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = await readHostedLinqOptionalJsonResponse<MessageSendResponse>(response);
  return {
    chatId: normalizeNullableString(payload?.chat_id),
    messageId: normalizeNullableString(payload?.message?.id),
  };
}

export async function sendHostedLinqReadReceipt(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
}> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  const response = await fetchLinqApi({
    apiBaseUrl,
    apiToken,
    method: "POST",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/read`,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}

export async function shareHostedLinqContactCard(input: {
  chatId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetchHostedLinqApiOrThrow({
    method: "POST",
    operation: "contact-card share",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/share_contact_card`,
    signal: input.signal,
    timeoutMessage: "Linq contact-card share timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "contact-card share",
      retryable: false,
      status: response.status,
    });
  }
}

async function fetchHostedLinqApiOrThrow(input: {
  body?: string;
  method: string;
  operation: string;
  path: string;
  signal?: AbortSignal;
  timeoutMessage: string;
}): Promise<Response> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  try {
    return await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      body: input.body,
      method: input.method,
      path: input.path,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: input.timeoutMessage,
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  }
}

function buildHostedLinqRequestFailedError(input: {
  operation: string;
  retryable: boolean;
  status: number;
}) {
  return hostedOnboardingError({
    code: "LINQ_SEND_FAILED",
    message: `Linq ${input.operation} failed with HTTP ${input.status}.`,
    httpStatus: 502,
    retryable: input.retryable,
  });
}

async function readHostedLinqOptionalJsonResponse<T>(response: Response): Promise<T | null> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function isRetryableHostedLinqStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildHostedLinqTextMessageBody(input: {
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);
  const textPart: TextPart = {
    type: "text",
    value: normalizeRequiredString(input.message, "message"),
  };

  return {
    message: {
      parts: [
        textPart,
      ],
      ...(idempotencyKey
        ? {
            idempotency_key: idempotencyKey,
          }
        : {}),
      ...(replyToMessageId
        ? {
            reply_to: {
              message_id: replyToMessageId,
            },
          }
        : {}),
    },
  };
}
