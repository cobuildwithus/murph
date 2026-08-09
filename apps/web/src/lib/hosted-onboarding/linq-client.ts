import "server-only";

import {
  containsHttpUrlText,
  splitTrailingHttpsLink,
} from "@murphai/contracts";
import {
  HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  hostedRuntimeLinqProviderErrorMessageForCode,
  isHostedRuntimePrivateImageDeliveryUrl,
} from "@murphai/hosted-execution/runtime-control";
import type { TextPart } from "@linqapp/sdk/resources";
import type {
  Chat,
  ChatCreateParams,
  ChatUpdateParams,
  MessageSendParams,
  MessageSendResponse,
} from "@linqapp/sdk/resources/chats";

import {
  fetchLinqApi,
  fetchLinqApiJson,
  LINQ_API_DEFAULT_TIMEOUT_MS,
  LinqApiTimeoutError,
} from "../linq/api";
import {
  readHostedExecutionControlOrigin,
} from "../hosted-execution/environment";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_MULTI_REQUEST_TIMEOUT_MS =
  Math.floor(LINQ_API_DEFAULT_TIMEOUT_MS / 2);
const HOSTED_LINQ_RICH_LINK_ATTEMPT_TIMEOUT_MS =
  Math.floor(HOSTED_LINQ_MULTI_REQUEST_TIMEOUT_MS / 2);
const HOSTED_LINQ_ERROR_RESPONSE_MAX_BYTES = 16 * 1024;

export type HostedLinqSendResult = {
  chatId: string | null;
  messageCreatedAt?: string;
  messageId: string | null;
  providerMessageIds?: string[];
};

export async function createHostedLinqChat(input: {
  from: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
  to: string[];
}): Promise<HostedLinqSendResult> {
  const split = splitTrailingHttpsLink(input.message);
  if (!split.linkUrl) {
    if (containsHttpUrlText(input.message)) {
      throw new TypeError(
        "A new Linq chat cannot include URL text in its first message.",
      );
    }
    return createHostedLinqChatWithPrimaryMessage(input);
  }
  if (!split.message.trim()) {
    throw new TypeError(
      "A new Linq chat with a rich link must include caller-supplied text.",
    );
  }
  if (containsHttpUrlText(split.message)) {
    throw new TypeError(
      "A new Linq chat cannot include URL text in its first message.",
    );
  }

  const result = await createHostedLinqChatWithPrimaryMessage({
    ...input,
    message: split.message,
    timeoutMs: HOSTED_LINQ_MULTI_REQUEST_TIMEOUT_MS,
  });
  if (!result.chatId) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq chat create response was missing a chat id for the rich-link follow-up.",
      httpStatus: 502,
      retryable: true,
    });
  }
  const primaryMessageId = requireHostedLinqPrimaryMessageIdForRichLink({
    messageId: result.messageId,
    operation: "chat create",
  });

  let linkResult: HostedLinqSendResult;
  try {
    linkResult = await sendHostedLinqRichLinkWithTextFallback({
      chatId: result.chatId,
      idempotencyKey: buildHostedLinqRichLinkIdempotencyKey(input.idempotencyKey),
      linkUrl: split.linkUrl,
      signal: input.signal,
    });
  } catch (error) {
    throw createHostedLinqRichLinkPartialDeliveryFailure({
      chatId: result.chatId,
      error,
      providerMessageIds: collectHostedLinqProviderMessageIds(primaryMessageId),
    });
  }
  const providerMessageIds = collectHostedLinqProviderMessageIds(
    primaryMessageId,
    linkResult.messageId,
  );
  if (providerMessageIds.length !== 2) {
    throw createHostedLinqRichLinkPartialDeliveryFailure({
      chatId: result.chatId,
      error: new Error(
        "Linq did not return an identity for every accepted rich-link message.",
      ),
      providerMessageIds,
    });
  }
  return {
    ...linkResult,
    chatId: linkResult.chatId ?? result.chatId,
    providerMessageIds,
  };
}

async function createHostedLinqChatWithPrimaryMessage(input: {
  from: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  to: string[];
}): Promise<HostedLinqSendResult> {
  const messageBody = buildHostedLinqTextMessageBody({
    idempotencyKey: input.idempotencyKey,
    message: input.message,
  });
  const body: ChatCreateParams = {
    from: normalizeRequiredString(input.from, "from"),
    message: messageBody.message,
    to: normalizeRequiredStringList(input.to, "recipient"),
  };

  const response = await fetchHostedLinqJsonApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    path: "chats",
    signal: input.signal,
    timeoutMessage: "Linq chat create timed out.",
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "chat create",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const chat = readHostedLinqJsonObjectField(response.payload, "chat");
  const message = readHostedLinqJsonObjectField(chat, "message");
  return {
    chatId: normalizeNullableString(readHostedLinqJsonField(chat, "id")),
    messageId: normalizeNullableString(
      readHostedLinqJsonField(message, "id"),
    ),
  };
}

export async function sendHostedLinqChatMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  const split = splitTrailingHttpsLink(input.message);
  if (!split.linkUrl) {
    return sendHostedLinqTextMessage(input);
  }

  if (!split.message.trim()) {
    return sendHostedLinqRichLinkWithTextFallback({
      chatId: input.chatId,
      idempotencyKey: input.idempotencyKey,
      linkUrl: split.linkUrl,
      signal: input.signal,
    });
  }

  const primaryResult = await sendHostedLinqTextMessage({
    ...input,
    message: split.message,
    timeoutMs: HOSTED_LINQ_MULTI_REQUEST_TIMEOUT_MS,
  });
  const primaryMessageId = requireHostedLinqPrimaryMessageIdForRichLink({
    messageId: primaryResult.messageId,
    operation: "message send",
  });
  let linkResult: HostedLinqSendResult;
  try {
    linkResult = await sendHostedLinqRichLinkWithTextFallback({
      chatId: input.chatId,
      idempotencyKey: buildHostedLinqRichLinkIdempotencyKey(input.idempotencyKey),
      linkUrl: split.linkUrl,
      signal: input.signal,
    });
  } catch (error) {
    throw createHostedLinqRichLinkPartialDeliveryFailure({
      chatId: primaryResult.chatId ?? input.chatId,
      error,
      providerMessageIds: collectHostedLinqProviderMessageIds(
        primaryMessageId,
      ),
    });
  }
  const providerMessageIds = collectHostedLinqProviderMessageIds(
    primaryMessageId,
    linkResult.messageId,
  );
  if (providerMessageIds.length !== 2) {
    throw createHostedLinqRichLinkPartialDeliveryFailure({
      chatId: linkResult.chatId ?? primaryResult.chatId ?? input.chatId,
      error: new Error(
        "Linq did not return an identity for every accepted rich-link message.",
      ),
      providerMessageIds,
    });
  }
  return {
    ...linkResult,
    chatId: linkResult.chatId ?? primaryResult.chatId ?? input.chatId,
    providerMessageIds,
  };
}

async function sendHostedLinqTextMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HostedLinqSendResult> {
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);
  return sendHostedLinqMessageBody({
    body: buildHostedLinqTextMessageBody({
      idempotencyKey: input.idempotencyKey,
      message: input.message,
      replyToMessageId,
    }),
    chatId: input.chatId,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
}

async function sendHostedLinqMessageBody(input: {
  body: MessageSendParams;
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HostedLinqSendResult> {
  const response = await fetchHostedLinqJsonApiOrThrow({
    body: JSON.stringify(input.body),
    method: "POST",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/messages`,
    signal: input.signal,
    timeoutMessage: "Linq outbound reply timed out.",
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "outbound reply",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const message = readHostedLinqJsonObjectField(response.payload, "message");
  const messageCreatedAt = normalizeHostedLinqMessageCreatedAt(
    readHostedLinqJsonField(message, "created_at"),
  );
  return {
    chatId: normalizeNullableString(
      readHostedLinqJsonField(response.payload, "chat_id"),
    ),
    ...(messageCreatedAt ? { messageCreatedAt } : {}),
    messageId: normalizeNullableString(
      readHostedLinqJsonField(message, "id"),
    ),
  };
}

function normalizeHostedLinqMessageCreatedAt(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function sendHostedLinqRichLinkWithTextFallback(input: {
  chatId: string;
  idempotencyKey?: string | null;
  linkUrl: string;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await sendHostedLinqMessageBody({
        body: buildHostedLinqRichLinkMessageBody({
          idempotencyKey: input.idempotencyKey,
          linkUrl: input.linkUrl,
        }),
        chatId: input.chatId,
        signal: input.signal,
        timeoutMs: HOSTED_LINQ_RICH_LINK_ATTEMPT_TIMEOUT_MS,
      });
    } catch (error) {
      lastError = error;
      if (!shouldRetryHostedLinqRichLinkRequest(error, input.signal)) {
        break;
      }
    }
  }

  if (!isDefinitiveHostedLinqRichLinkRejection(lastError)) {
    throw lastError;
  }
  return sendHostedLinqTextMessage({
    chatId: input.chatId,
    idempotencyKey:
      buildHostedLinqRichLinkFallbackIdempotencyKey(input.idempotencyKey),
    message: input.linkUrl,
    signal: input.signal,
    timeoutMs: HOSTED_LINQ_RICH_LINK_ATTEMPT_TIMEOUT_MS,
  });
}

function shouldRetryHostedLinqRichLinkRequest(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted) {
    return false;
  }
  return !isHostedOnboardingError(error) || error.retryable;
}

function isDefinitiveHostedLinqRichLinkRejection(error: unknown): boolean {
  const status = isHostedOnboardingError(error) ? error.details?.status : null;
  return isHostedOnboardingError(error)
    && error.details?.failureStage === "http"
    && !error.retryable
    && (status === 400 || status === 415 || status === 422);
}

function collectHostedLinqProviderMessageIds(
  ...values: readonly (string | null | undefined)[]
): string[] {
  const output: string[] = [];
  for (const value of values) {
    const messageId = normalizeNullableString(value);
    if (messageId && !output.includes(messageId)) {
      output.push(messageId);
    }
  }
  return output;
}

function requireHostedLinqPrimaryMessageIdForRichLink(input: {
  messageId: string | null;
  operation: "chat create" | "message send";
}): string {
  const messageId = normalizeNullableString(input.messageId);
  if (messageId) {
    return messageId;
  }

  throw Object.assign(hostedOnboardingError({
    code: "LINQ_SEND_FAILED",
    details: {
      failureStage: "http",
    },
    httpStatus: 502,
    message:
      `Linq ${input.operation} response was missing the primary message identity for a rich-link follow-up.`,
    retryable: true,
  }), {
    deliveryMayHaveSucceeded: true as const,
  });
}

function createHostedLinqRichLinkPartialDeliveryFailure(input: {
  chatId: string;
  error: unknown;
  providerMessageIds: readonly string[];
}): Error & {
  deliveryMayHaveSucceeded: true;
  expectedProviderMessageCount: 2;
  providerMessageId: string | null;
  providerMessageIds: string[];
  providerThreadId: string;
} {
  const providerMessageIds = [...input.providerMessageIds];
  const failure = hostedOnboardingError({
    cause: input.error,
    code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
    details: {
      expectedProviderMessageCount: 2,
      providerMessageIds,
      providerThreadId: input.chatId,
    },
    httpStatus: 502,
    message:
      "Linq rich-link delivery could not confirm both provider messages after the primary request was accepted; deterministic recovery must reuse the same provider keys.",
    retryable: false,
  });
  return Object.assign(failure, {
    deliveryMayHaveSucceeded: true as const,
    expectedProviderMessageCount: 2 as const,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    providerThreadId: input.chatId,
  });
}

export async function updateHostedLinqChatAvatar(input: {
  chatId: string;
  groupChatIconUrl: string;
  signal?: AbortSignal;
}): Promise<void> {
  // Mirrors @linqapp/sdk Chats.update / ChatUpdateParams.group_chat_icon while
  // preserving this wrapper's shared auth, timeout, and redacted-error behavior.
  const body: ChatUpdateParams = {
    group_chat_icon: normalizeHostedLinqGroupChatIconUrl(input.groupChatIconUrl),
  };

  const response = await fetchHostedLinqJsonApiOrThrow({
    body: JSON.stringify(body),
    maxResponseBytes: HOSTED_LINQ_ERROR_RESPONSE_MAX_BYTES,
    method: "PUT",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}`,
    signal: input.signal,
    timeoutMessage: "Linq chat avatar update timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "chat avatar update",
      providerErrorDiagnostics: readHostedLinqProviderErrorDiagnostics(
        response.payload,
      ),
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }
}

export async function updateHostedLinqChatDisplayName(input: {
  chatId: string;
  displayName: string;
  signal?: AbortSignal;
}): Promise<void> {
  // Mirrors @linqapp/sdk Chats.update / ChatUpdateParams.display_name while
  // preserving this wrapper's shared auth, timeout, and redacted-error behavior.
  const body: ChatUpdateParams = {
    display_name: normalizeHostedLinqChatDisplayName(input.displayName),
  };

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "PUT",
    operation: "chat display name update",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}`,
    signal: input.signal,
    timeoutMessage: "Linq chat display name update timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "chat display name update",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }
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

export async function startHostedLinqChatTypingIndicator(input: {
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
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/typing`,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}

export async function stopHostedLinqChatTypingIndicator(input: {
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
    method: "DELETE",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/typing`,
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

export type HostedLinqChatSummary = {
  displayName?: string | null;
  handles: HostedLinqChatHandleSummary[];
  isGroup: boolean | null;
};

export type HostedLinqReactionTargetMessage = {
  chatId: string;
  id: string;
  parts: string[];
};

const HOSTED_LINQ_REACTION_TARGET_MAX_PARTS = 32;
const HOSTED_LINQ_REACTION_TARGET_TEXT_MAX_CHARS = 512;
const HOSTED_LINQ_REACTION_TARGET_URL_PATTERN =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/[^\s)"'<>]+|\b(?:blob|cid|data|geo|javascript|magnet|mailto|sms|tel|urn|xmpp):[^\s)"'<>]+|\bwww\.[^\s)"'<>]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s)"'<>]*)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#][^\s)"'<>]*)?)/giu;

export async function getHostedLinqChatSummary(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HostedLinqChatSummary> {
  const response = await fetchHostedLinqJsonApiOrThrow({
    method: "GET",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}`,
    signal: input.signal,
    timeoutMessage: "Linq chat read timed out.",
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "chat read",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = readHostedLinqCanonicalChat(response.payload);
  const displayName = normalizeNullableString(payload?.display_name);
  const handles: Chat["handles"] = payload?.handles ?? [];
  const isGroup: Chat["is_group"] | null = payload?.is_group ?? null;

  return {
    displayName,
    handles: handles
      .map(parseHostedLinqChatHandleSummary)
      .filter((handle): handle is HostedLinqChatHandleSummary => handle !== null),
    isGroup,
  };
}

export async function getHostedLinqReactionTargetMessage(input: {
  messageId: string;
  signal?: AbortSignal;
}): Promise<HostedLinqReactionTargetMessage> {
  const response = await fetchHostedLinqJsonApiOrThrow({
    method: "GET",
    path: `messages/${encodeURIComponent(normalizeRequiredString(input.messageId, "message id"))}`,
    signal: input.signal,
    timeoutMessage: "Linq message read timed out.",
  });
  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "message read",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const message = parseHostedLinqReactionTargetMessage(response.payload);
  if (!message) {
    throw hostedOnboardingError({
      code: "LINQ_MESSAGE_READ_INVALID",
      httpStatus: 502,
      message: "Linq message read returned an invalid canonical response.",
      retryable: false,
    });
  }
  return message;
}

function parseHostedLinqReactionTargetMessage(
  value: unknown,
): HostedLinqReactionTargetMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = normalizeNullableString(record.id);
  const chatId = normalizeNullableString(record.chat_id);
  if (
    !id
    || !chatId
    || !(record.parts === null || record.parts === undefined || Array.isArray(record.parts))
  ) {
    return null;
  }
  const parts = Array.isArray(record.parts) ? record.parts : [];
  return {
    chatId,
    id,
    parts: parts
      .slice(0, HOSTED_LINQ_REACTION_TARGET_MAX_PARTS)
      .map(parseHostedLinqReactionTargetPart),
  };
}

function parseHostedLinqReactionTargetPart(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "[unsupported content]";
  }
  const record = value as Record<string, unknown>;
  if (record.type === "text" && typeof record.value === "string") {
    const text = normalizeNullableString(record.value)
      ?.slice(0, HOSTED_LINQ_REACTION_TARGET_TEXT_MAX_CHARS)
      .replace(HOSTED_LINQ_REACTION_TARGET_URL_PATTERN, "[link]")
      .slice(0, HOSTED_LINQ_REACTION_TARGET_TEXT_MAX_CHARS);
    return text || "[unsupported content]";
  }
  if (record.type === "link") {
    return "[link]";
  }
  if (record.type === "media") {
    return "[attachment]";
  }
  if (record.type === "imessage_app") {
    return "[iMessage app]";
  }
  return "[unsupported content]";
}

function readHostedLinqCanonicalChat(
  value: unknown,
): Pick<Chat, "display_name" | "handles" | "is_group"> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.handles) || typeof record.is_group !== "boolean") {
    return null;
  }

  return {
    display_name: normalizeNullableString(record.display_name),
    handles: record.handles,
    is_group: record.is_group,
  };
}

export async function getHostedLinqChatHandles(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HostedLinqChatHandleSummary[]> {
  return (await getHostedLinqChatSummary(input)).handles;
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
  const message: MessageSendParams["message"] = {
    parts: [
      {
        attachment_id: attachmentId,
        type: "media",
      },
    ],
  };
  if (idempotencyKey) {
    message.idempotency_key = idempotencyKey;
  }
  // Captured once so a reconciliation attempt can resubmit the byte-identical
  // body: same attachment, same key, same URL is what lets the provider answer
  // with the original message instead of accepting a second one.
  const sendBody = JSON.stringify({ message } satisfies MessageSendParams);
  const sendPath = `chats/${encodeURIComponent(chatId)}/messages`;
  const submitSend = async () => await fetchHostedLinqApiOrThrow({
    body: sendBody,
    method: "POST",
    operation: "attachment send",
    path: sendPath,
    signal: input.signal,
    timeoutMessage: "Linq attachment send timed out.",
  });

  let sendResponse: Response;
  try {
    sendResponse = await submitSend();
  } catch (error) {
    // A timeout or transport loss says nothing about acceptance: the request
    // may already have created the message. Only a keyed send can safely ask
    // the provider again.
    if (idempotencyKey === null) {
      throw error;
    }
    return await reconcileHostedLinqAttachmentSend({ cause: error, submitSend });
  }
  if (!sendResponse.ok) {
    // A replay of one accepted request re-creates its attachment, so the body
    // under a reused idempotency key legitimately differs and the provider
    // answers with a key-reuse conflict. Classify only that exact response so
    // a caller with a stable per-request key can read it as "already sent";
    // every other 409 and error stays an ordinary failure.
    const idempotencyConflict = idempotencyKey !== null
      && sendResponse.status === 409
      && await isHostedLinqIdempotencyKeyReuseConflict(sendResponse);
    const retryable = isRetryableHostedLinqStatus(sendResponse.status);
    const failure = buildHostedLinqRequestFailedError({
      operation: "attachment send",
      retryable,
      status: sendResponse.status,
      ...(idempotencyConflict ? { idempotencyKeyReuseConflict: true } : {}),
    });
    // A retryable response can arrive after the provider already accepted the
    // message and lost the acknowledgement, so it does not prove the card is
    // absent. A definitive rejection does, and stays an ordinary failure.
    if (idempotencyKey !== null && !idempotencyConflict && retryable) {
      return await reconcileHostedLinqAttachmentSend({ cause: failure, submitSend });
    }
    throw failure;
  }

  return await readHostedLinqAttachmentSendResult(sendResponse);
}

/**
 * Establish the provider result for one already-submitted final message whose
 * response was ambiguous. The provider owns exactly-once for the idempotency
 * key, so resubmitting the byte-identical body is the only way to learn what
 * happened: an accepted request replays its original message identity, and a
 * body that differs under that key is rejected outright. Exactly one extra
 * attempt, inside the original call, with no durable record.
 *
 * When it still cannot resolve, the failure carries `acknowledgementUnconfirmed`
 * so the caller can report uncertainty rather than claim the send failed.
 */
async function reconcileHostedLinqAttachmentSend(input: {
  cause: unknown;
  submitSend: () => Promise<Response>;
}): Promise<HostedLinqSendResult> {
  let response: Response;
  try {
    response = await input.submitSend();
  } catch {
    throw buildHostedLinqUnconfirmedAcknowledgementError(input.cause);
  }
  if (response.ok) {
    return await readHostedLinqAttachmentSendResult(response);
  }
  if (
    response.status === 409
    && await isHostedLinqIdempotencyKeyReuseConflict(response)
  ) {
    throw buildHostedLinqRequestFailedError({
      idempotencyKeyReuseConflict: true,
      operation: "attachment send",
      retryable: false,
      status: response.status,
    });
  }
  throw buildHostedLinqUnconfirmedAcknowledgementError(input.cause);
}

async function readHostedLinqAttachmentSendResult(
  response: Response,
): Promise<HostedLinqSendResult> {
  const payload = await readHostedLinqOptionalJsonResponse<MessageSendResponse>(response);
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
  timeoutMs?: number;
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
      timeoutMs: input.timeoutMs,
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

async function fetchHostedLinqJsonApiOrThrow(input: {
  body?: string;
  maxResponseBytes?: number;
  method: string;
  path: string;
  signal?: AbortSignal;
  timeoutMessage: string;
  timeoutMs?: number;
}) {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  try {
    return await fetchLinqApiJson({
      apiBaseUrl,
      apiToken,
      body: input.body,
      method: input.method,
      ...(input.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: input.maxResponseBytes }),
      path: input.path,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
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
  idempotencyKeyReuseConflict?: boolean;
  operation: string;
  providerErrorDiagnostics?: {
    providerErrorCode?: number;
  } | null;
  retryable: boolean;
  status: number;
}) {
  return hostedOnboardingError({
    code: "LINQ_SEND_FAILED",
    details: {
      failureStage: "http",
      status: input.status,
      ...(input.idempotencyKeyReuseConflict
        ? { idempotencyKeyReuseConflict: true }
        : {}),
      ...input.providerErrorDiagnostics,
    },
    message: `Linq ${input.operation} failed with HTTP ${input.status}.`,
    httpStatus: 502,
    retryable: input.retryable,
  });
}

const HOSTED_LINQ_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Conflicting Linq idempotency-key reuse.";

/**
 * Narrow reader for the provider's exact same-key/different-payload conflict.
 * It rejects bodies above 500 code units and requires the exact JSON shape, so
 * a generic 409 or wrapped phrase cannot be mistaken for a proven duplicate.
 */
async function isHostedLinqIdempotencyKeyReuseConflict(
  response: Response,
): Promise<boolean> {
  let body: string;
  try {
    body = await response.clone().text();
  } catch {
    return false;
  }
  if (body.length > 500) {
    return false;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const keys = Object.keys(payload);
  return keys.length === 1
    && keys[0] === "error"
    && Reflect.get(payload, "error")
      === HOSTED_LINQ_IDEMPOTENCY_CONFLICT_MESSAGE;
}

/**
 * True only when the provider rejected a reused idempotency key whose payload
 * differed. A caller whose key identifies one accepted request may treat this
 * as proof that request already reached the chat.
 */
export function isHostedLinqIdempotencyKeyReuseFailure(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.details?.idempotencyKeyReuseConflict === true;
}

function buildHostedLinqUnconfirmedAcknowledgementError(cause: unknown) {
  return hostedOnboardingError({
    cause,
    code: "LINQ_SEND_FAILED",
    details: { acknowledgementUnconfirmed: true },
    // Not retryable: another blind attempt cannot resolve this and the send is
    // irreversible, so the decision belongs to the member, not to a retry loop.
    httpStatus: 502,
    message: "Linq attachment send acknowledgement is unconfirmed.",
    retryable: false,
  });
}

/**
 * True only when a keyed attachment send failed ambiguously and reconciling the
 * identical body under the same key still could not establish the result. The
 * message may or may not be in the chat; a caller must say so rather than
 * report a failed send.
 */
export function isHostedLinqUnconfirmedAcknowledgementFailure(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.details?.acknowledgementUnconfirmed === true;
}

function readHostedLinqProviderErrorDiagnostics(payload: unknown): {
  providerErrorCode?: number;
} | null {
  if (
    payload === null
    || typeof payload !== "object"
    || Array.isArray(payload)
    || Reflect.get(payload, "success") !== false
  ) {
    return null;
  }
  const providerError = Reflect.get(payload, "error");
  if (
    providerError === null
    || typeof providerError !== "object"
    || Array.isArray(providerError)
  ) {
    return null;
  }

  const code = Reflect.get(providerError, "code");
  const providerErrorCode = typeof code === "number"
    && Number.isSafeInteger(code)
    && code >= 1_000
    && code <= 9_999
      ? code
      : null;
  if (providerErrorCode === null) {
    return null;
  }
  if (
    hostedRuntimeLinqProviderErrorMessageForCode(providerErrorCode) === null
  ) {
    return null;
  }
  return { providerErrorCode };
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

function readHostedLinqJsonField(
  input: unknown,
  field: string,
): unknown {
  return input !== null && typeof input === "object"
    ? Reflect.get(input, field)
    : null;
}

function readHostedLinqJsonObjectField(
  input: unknown,
  field: string,
): object | null {
  const value = readHostedLinqJsonField(input, field);
  return value !== null && typeof value === "object" ? value : null;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function normalizeRequiredHttpsUrl(value: unknown, label: string): string {
  const normalized = normalizeRequiredString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(`${label} must be an HTTPS URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${label} must be an HTTPS URL.`);
  }
  return parsed.toString();
}

function normalizeHostedLinqGroupChatIconUrl(value: unknown): string {
  const normalized = normalizeRequiredHttpsUrl(value, "group chat icon url");
  if (normalized.length > HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH) {
    throw new TypeError("group chat icon url must be a hosted private media URL.");
  }
  const parsed = new URL(normalized);
  if (!isHostedRuntimePrivateImageDeliveryUrl(
    parsed,
    readHostedExecutionControlOrigin() ?? undefined,
  )) {
    throw new TypeError("group chat icon url must be a hosted private media URL.");
  }
  return normalized;
}

function normalizeHostedLinqChatDisplayName(value: unknown): string {
  const normalized = normalizeRequiredString(value, "chat display name")
    .replace(/\s+/gu, " ");
  if (normalized.length > HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH) {
    throw new TypeError("chat display name is too long.");
  }
  return normalized;
}

function normalizeRequiredStringList(values: readonly string[], label: string): string[] {
  const normalizedValues = values
    .map((value) => normalizeRequiredString(value, label))
    .filter((value, index, array) => array.indexOf(value) === index);

  if (normalizedValues.length === 0) {
    throw new TypeError(`${label} list must contain at least one non-empty value.`);
  }

  return normalizedValues;
}

function isRetryableHostedLinqStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildHostedLinqRichLinkMessageBody(input: {
  idempotencyKey?: string | null;
  linkUrl: string;
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const message: MessageSendParams["message"] = {
    parts: [{
      type: "link",
      value: normalizeRequiredString(input.linkUrl, "rich link url"),
    }],
  };
  if (idempotencyKey) {
    message.idempotency_key = idempotencyKey;
  }
  return { message };
}

function buildHostedLinqRichLinkIdempotencyKey(
  value: string | null | undefined,
): string | null {
  const idempotencyKey = normalizeNullableString(value);
  return idempotencyKey ? `${idempotencyKey}:link` : null;
}

function buildHostedLinqRichLinkFallbackIdempotencyKey(
  value: string | null | undefined,
): string | null {
  const idempotencyKey = normalizeNullableString(value);
  return idempotencyKey ? `${idempotencyKey}:fallback` : null;
}

function buildHostedLinqTextMessageBody(input: {
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const textPart: TextPart = {
    type: "text",
    value: normalizeRequiredString(input.message, "message"),
  };
  const message: MessageSendParams["message"] = {
    parts: [textPart],
  };
  if (idempotencyKey) {
    message.idempotency_key = idempotencyKey;
  }
  return { message };
}
