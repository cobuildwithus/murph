import type { TextPart } from "@linqapp/sdk/resources";
import type {
  MessageSendParams,
  MessageSendResponse,
} from "@linqapp/sdk/resources/chats";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
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

const HOSTED_LINQ_ATTACHMENT_UPLOAD_TIMEOUT_MS = 30_000;

export type HostedLinqChatHandleSummary = {
  handle: string;
  isMe: boolean;
  status: string | null;
};

export async function getHostedLinqChatHandles(input: {
  chatId: string;
  signal?: AbortSignal;
}): Promise<HostedLinqChatHandleSummary[]> {
  const response = await fetchHostedLinqApiOrThrow({
    method: "GET",
    operation: "chat read",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}`,
    signal: input.signal,
    timeoutMessage: "Linq chat read timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "chat read",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = await readHostedLinqOptionalJsonResponse<{
    chat?: { handles?: unknown } | null;
    handles?: unknown;
  }>(response);
  const handles = Array.isArray(payload?.handles)
    ? payload.handles
    : Array.isArray(payload?.chat?.handles)
      ? payload.chat.handles
      : [];

  return handles
    .map(parseHostedLinqChatHandleSummary)
    .filter((handle): handle is HostedLinqChatHandleSummary => handle !== null);
}

function parseHostedLinqChatHandleSummary(value: unknown): HostedLinqChatHandleSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const handle = normalizeNullableString(record.handle);
  if (!handle) {
    return null;
  }
  return {
    handle,
    isMe: record.is_me === true,
    status: normalizeNullableString(record.status),
  };
}

export async function sendHostedLinqAttachmentMessage(input: {
  bytes: Uint8Array;
  chatId: string;
  contentType: string;
  fileName: string;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  const chatId = normalizeRequiredString(input.chatId, "chat id");
  // Everything before the final message POST is tagged phase "prepare":
  // failures here provably never created a chat message, so callers may undo
  // side effects such as share reservations. The message POST itself stays
  // untagged/ambiguous (it may have been accepted with a lost response).
  const { attachmentId } = await withHostedLinqAttachmentPreparePhase(async () => {
    const createResponse = await fetchHostedLinqApiOrThrow({
      body: JSON.stringify({
        content_type: normalizeRequiredString(input.contentType, "attachment content type"),
        filename: normalizeRequiredString(input.fileName, "attachment file name"),
        size_bytes: input.bytes.byteLength,
      }),
      method: "POST",
      operation: "attachment create",
      path: "attachments",
      signal: input.signal,
      timeoutMessage: "Linq attachment create timed out.",
    });
    if (!createResponse.ok) {
      throw buildHostedLinqRequestFailedError({
        operation: "attachment create",
        retryable: isRetryableHostedLinqStatus(createResponse.status),
        status: createResponse.status,
      });
    }
    const created = await readHostedLinqOptionalJsonResponse<{
      attachment_id?: unknown;
      required_headers?: unknown;
      upload_url?: unknown;
    }>(createResponse);
    const createdAttachmentId = normalizeNullableString(created?.attachment_id);
    const uploadUrl = normalizeNullableString(created?.upload_url);
    if (!createdAttachmentId || !uploadUrl) {
      throw buildHostedLinqRequestFailedError({
        operation: "attachment create",
        retryable: false,
        status: 502,
      });
    }

    const uploadTimeout = AbortSignal.timeout(HOSTED_LINQ_ATTACHMENT_UPLOAD_TIMEOUT_MS);
    const uploadResponse = await fetch(uploadUrl, {
      body: new Uint8Array(input.bytes).buffer,
      headers: parseHostedLinqAttachmentUploadHeaders(created?.required_headers),
      method: "PUT",
      signal: input.signal ? AbortSignal.any([input.signal, uploadTimeout]) : uploadTimeout,
    });
    if (!uploadResponse.ok) {
      throw buildHostedLinqRequestFailedError({
        operation: "attachment upload",
        retryable: isRetryableHostedLinqStatus(uploadResponse.status),
        status: uploadResponse.status,
      });
    }
    return { attachmentId: createdAttachmentId };
  });

  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const sendResponse = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify({
      message: {
        parts: [
          {
            attachment_id: attachmentId,
            type: "media",
          },
        ],
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    }),
    method: "POST",
    operation: "attachment send",
    path: `chats/${encodeURIComponent(chatId)}/messages`,
    signal: input.signal,
    timeoutMessage: "Linq attachment send timed out.",
  });
  if (!sendResponse.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "attachment send",
      retryable: isRetryableHostedLinqStatus(sendResponse.status),
      status: sendResponse.status,
    });
  }

  const payload = await readHostedLinqOptionalJsonResponse<MessageSendResponse>(sendResponse);
  return {
    chatId: normalizeNullableString(payload?.chat_id),
    messageId: normalizeNullableString(payload?.message?.id),
  };
}

export const HOSTED_LINQ_ATTACHMENT_SEND_PHASE_PREPARE = "prepare";

export function isHostedLinqAttachmentSendPrepareFailure(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.details?.phase === HOSTED_LINQ_ATTACHMENT_SEND_PHASE_PREPARE;
}

async function withHostedLinqAttachmentPreparePhase<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw hostedOnboardingError({
        cause: error,
        code: error.code,
        details: {
          ...(error.details ?? {}),
          phase: HOSTED_LINQ_ATTACHMENT_SEND_PHASE_PREPARE,
        },
        httpStatus: error.httpStatus,
        message: error.message,
        retryable: error.retryable,
      });
    }
    throw error;
  }
}

function parseHostedLinqAttachmentUploadHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof headerValue === "string" && key.trim()) {
      headers[key] = headerValue;
    }
  }
  return headers;
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
