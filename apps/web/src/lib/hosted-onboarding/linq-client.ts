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
import type { LinqAPIV3 } from "@linqapp/sdk";
import type { TextPart } from "@linqapp/sdk/resources";
import type { SupportedContentType } from "@linqapp/sdk/resources/attachments";
import type {
  Chat,
  ChatCreateParams,
  ChatUpdateParams,
  MessageSendParams,
  MessageSendResponse,
} from "@linqapp/sdk/resources/chats";

import {
  LINQ_API_DEFAULT_TIMEOUT_MS,
  LinqApiTimeoutError,
  isLinqApiResponseUnreadableError,
  readLinqApiErrorPayload,
  readLinqApiErrorStatus,
  runLinqApiRequest,
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
const HOSTED_LINQ_ATTACHMENT_CONTENT_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/heic", "image/heif",
  "image/tiff", "image/bmp", "image/svg+xml", "image/webp", "image/x-icon",
  "video/mp4", "video/quicktime", "video/mpeg", "video/mpeg2", "video/x-m4v",
  "video/x-msvideo", "video/3gpp", "audio/mpeg", "audio/mp3", "audio/x-m4a",
  "audio/mp4", "audio/x-caf", "audio/x-wav", "audio/x-aiff", "audio/aiff",
  "audio/aac", "audio/midi", "audio/amr", "application/pdf",
  "application/vnd.apple.pkpass", "text/plain", "text/markdown", "text/vcard",
  "text/rtf", "text/csv", "text/html", "text/calendar", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/x-iwork-pages-sffpages", "application/x-iwork-numbers-sffnumbers",
  "application/x-iwork-keynote-sffkey", "application/epub+zip", "text/xml",
  "application/json", "application/zip", "application/x-gzip",
] satisfies readonly SupportedContentType[];
// One attachment-send attempt when the caller supplies a deadline, covering
// headers and body together. Owned here because this is the layer that spends
// it; callers size their own budgets against it rather than restating it. Two
// of these plus the pre-send stretch must fit inside the caller's window, so it
// is deliberately tighter than the shared default.
export const HOSTED_LINQ_ATTACHMENT_SEND_ATTEMPT_TIMEOUT_MS = 7 * 1000;

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

  const response = await requestHostedLinqSdkOrThrow({
    operation: "chat create",
    request: (client) => client.chats.create(body, { signal: input.signal }),
    signal: input.signal,
    timeoutMessage: "Linq chat create timed out.",
    timeoutMs: input.timeoutMs,
  });

  const chat = response.chat;
  return {
    chatId: normalizeNullableString(chat?.id),
    messageId: normalizeNullableString(chat?.message?.id),
  };
}

export async function sendHostedLinqChatMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  resumeRichLinkAfterAcceptedText?: boolean;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  const split = splitTrailingHttpsLink(input.message);
  if (input.resumeRichLinkAfterAcceptedText === true) {
    if (!split.linkUrl || !split.message.trim()) {
      throw new TypeError(
        "A resumed Linq rich-link delivery requires accepted text and a trailing link.",
      );
    }
    try {
      return await sendHostedLinqRichLinkWithTextFallback({
        chatId: input.chatId,
        idempotencyKey: buildHostedLinqRichLinkIdempotencyKey(
          input.idempotencyKey,
        ),
        linkUrl: split.linkUrl,
        signal: input.signal,
      });
    } catch (error) {
      throw createHostedLinqRichLinkPartialDeliveryFailure({
        chatId: input.chatId,
        error,
        providerMessageIds: [],
      });
    }
  }
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

/**
 * Reaction-bound prompts must remain one provider message because the returned
 * message identity is the consent target. Do not split their first-party link
 * into a second rich-link bubble.
 */
export async function sendHostedLinqReactionBoundChatMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  return sendHostedLinqTextMessage(input);
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
  const chatId = normalizeRequiredString(input.chatId, "chat id");
  const response = await requestHostedLinqSdkOrThrow({
    operation: "outbound reply",
    request: (client) => client.chats.messages.send(chatId, input.body, {
      signal: input.signal,
    }),
    signal: input.signal,
    timeoutMessage: "Linq outbound reply timed out.",
    timeoutMs: input.timeoutMs,
  });

  const messageCreatedAt = normalizeHostedLinqMessageCreatedAt(
    response.message?.created_at,
  );
  return {
    chatId: normalizeNullableString(response.chat_id),
    ...(messageCreatedAt ? { messageCreatedAt } : {}),
    messageId: normalizeNullableString(response.message?.id),
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
  const body: ChatUpdateParams = {
    group_chat_icon: normalizeHostedLinqGroupChatIconUrl(input.groupChatIconUrl),
  };
  await requestHostedLinqSdkOrThrow({
    maxResponseBytes: HOSTED_LINQ_ERROR_RESPONSE_MAX_BYTES,
    operation: "chat avatar update",
    providerErrorDiagnostics: true,
    request: (client) => client.chats.update(
      normalizeRequiredString(input.chatId, "chat id"),
      body,
      { signal: input.signal },
    ),
    signal: input.signal,
    timeoutMessage: "Linq chat avatar update timed out.",
  });
}

export async function updateHostedLinqChatDisplayName(input: {
  chatId: string;
  displayName: string;
  signal?: AbortSignal;
}): Promise<void> {
  const body: ChatUpdateParams = {
    display_name: normalizeHostedLinqChatDisplayName(input.displayName),
  };
  await requestHostedLinqSdkOrThrow({
    operation: "chat display name update",
    request: (client) => client.chats.update(
      normalizeRequiredString(input.chatId, "chat id"),
      body,
      { signal: input.signal },
    ),
    signal: input.signal,
    timeoutMessage: "Linq chat display name update timed out.",
  });
}

export async function sendHostedLinqReadReceipt(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
}> {
  return requestHostedLinqNoContentStatus({
    request: async (client) => {
      const result = await client.chats.markAsRead(
        normalizeRequiredString(input.chatId, "chat id"),
        { signal: input.signal },
      ).withResponse();
      return result.response.status;
    },
    signal: input.signal,
    timeoutMessage: "Linq read receipt timed out.",
    timeoutMs: input.timeoutMs,
  });
}

export async function startHostedLinqChatTypingIndicator(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
}> {
  return requestHostedLinqNoContentStatus({
    request: async (client) => {
      const result = await client.chats.typing.start(
        normalizeRequiredString(input.chatId, "chat id"),
        { signal: input.signal },
      ).withResponse();
      return result.response.status;
    },
    signal: input.signal,
    timeoutMessage: "Linq typing indicator start timed out.",
    timeoutMs: input.timeoutMs,
  });
}

export async function stopHostedLinqChatTypingIndicator(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
}> {
  return requestHostedLinqNoContentStatus({
    request: async (client) => {
      const result = await client.chats.typing.stop(
        normalizeRequiredString(input.chatId, "chat id"),
        { signal: input.signal },
      ).withResponse();
      return result.response.status;
    },
    signal: input.signal,
    timeoutMessage: "Linq typing indicator stop timed out.",
    timeoutMs: input.timeoutMs,
  });
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
  const payload = await requestHostedLinqSdkOrThrow({
    operation: "chat read",
    request: (client) => client.chats.retrieve(
      normalizeRequiredString(input.chatId, "chat id"),
      { signal: input.signal },
    ),
    signal: input.signal,
    timeoutMessage: "Linq chat read timed out.",
    timeoutMs: input.timeoutMs,
  });

  const canonical = readHostedLinqCanonicalChat(payload);
  const displayName = normalizeNullableString(canonical?.display_name);
  const handles: Chat["handles"] = canonical?.handles ?? [];
  const isGroup: Chat["is_group"] | null = canonical?.is_group ?? null;

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
  const payload = await requestHostedLinqSdkOrThrow({
    operation: "message read",
    request: (client) => client.messages.retrieve(
      normalizeRequiredString(input.messageId, "message id"),
      { signal: input.signal },
    ),
    signal: input.signal,
    timeoutMessage: "Linq message read timed out.",
  });

  const message = parseHostedLinqReactionTargetMessage(payload);
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
  /**
   * Optional tighter deadline for the prepare phase only. Everything it bounds
   * provably precedes the message POST, so expiring under it can never leave an
   * ambiguous send. The final POST and its reconciliation deliberately keep the
   * caller signal: cutting an irreversible send short is worse than waiting.
   */
  prepareSignal?: AbortSignal;
  /** Absolute deadline for the prepare phase, including SDK response parsing. */
  prepareDeadlineAt?: number;
  /** Absolute deadline shared by the message POST and its one reconciliation. */
  sendDeadlineAt?: number;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
  const chatId = normalizeRequiredString(input.chatId, "chat id");
  const prepareSignal = input.prepareSignal ?? input.signal;

  const { attachmentId } = await withHostedLinqAttachmentPreparePhase(async () => {
    const prepareRemainingMs = input.prepareDeadlineAt === undefined
      ? LINQ_API_DEFAULT_TIMEOUT_MS
      : input.prepareDeadlineAt - Date.now();
    if (prepareRemainingMs <= 0) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq attachment preparation exceeded its deadline.",
        httpStatus: 502,
        retryable: false,
      });
    }

    const created = await requestHostedLinqSdkOrThrow({
      operation: "attachment create",
      request: (client) => client.attachments.create({
        content_type: normalizeHostedLinqAttachmentContentType(input.contentType),
        filename: normalizeRequiredString(input.fileName, "attachment file name"),
        size_bytes: input.bytes.byteLength,
      }, { signal: prepareSignal }),
      signal: prepareSignal,
      timeoutMessage: "Linq attachment create timed out.",
      timeoutMs: Math.min(LINQ_API_DEFAULT_TIMEOUT_MS, prepareRemainingMs),
    });
    const createdAttachmentId = normalizeNullableString(created.attachment_id);
    const uploadUrl = normalizeNullableString(created.upload_url);
    if (!createdAttachmentId || !uploadUrl) {
      throw buildHostedLinqRequestFailedError({
        operation: "attachment create",
        retryable: false,
        status: 502,
      });
    }

    const uploadTimeout = AbortSignal.timeout(HOSTED_LINQ_ATTACHMENT_UPLOAD_TIMEOUT_MS);
    // provider-request-boundary-allow-next-line: linq-presigned-bytes
    const uploadResponse = await fetch(uploadUrl, {
      body: new Uint8Array(input.bytes).buffer,
      headers: parseHostedLinqAttachmentUploadHeaders(created.required_headers),
      method: "PUT",
      signal: prepareSignal
        ? AbortSignal.any([prepareSignal, uploadTimeout])
        : uploadTimeout,
    });
    await endHostedLinqPresignedResponseBody(uploadResponse);
    if (!uploadResponse.ok) {
      throw buildHostedLinqRequestFailedError({
        operation: "attachment upload",
        retryable: isRetryableHostedLinqStatus(uploadResponse.status),
        status: uploadResponse.status,
      });
    }
    return { attachmentId: createdAttachmentId };
  });

  if (
    input.prepareDeadlineAt !== undefined
    && Date.now() >= input.prepareDeadlineAt
  ) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      details: { phase: HOSTED_LINQ_ATTACHMENT_SEND_PHASE_PREPARE },
      message: "Linq attachment preparation exceeded its deadline.",
      httpStatus: 502,
      retryable: false,
    });
  }

  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const message: MessageSendParams["message"] = {
    parts: [{ attachment_id: attachmentId, type: "media" }],
  };
  if (idempotencyKey) {
    message.idempotency_key = idempotencyKey;
  }
  const sendBody: MessageSendParams = { message };
  const submitSend = async (): Promise<HostedLinqSendResult> => {
    const remainingMs = input.sendDeadlineAt === undefined
      ? LINQ_API_DEFAULT_TIMEOUT_MS
      : input.sendDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq attachment send deadline elapsed before the request.",
        httpStatus: 502,
        retryable: false,
      });
    }
    const attemptBudgetMs = input.sendDeadlineAt === undefined
      ? LINQ_API_DEFAULT_TIMEOUT_MS
      : Math.min(HOSTED_LINQ_ATTACHMENT_SEND_ATTEMPT_TIMEOUT_MS, remainingMs);
    const body = await requestHostedLinqSdk({
      maxResponseBytes: HOSTED_LINQ_ERROR_RESPONSE_MAX_BYTES,
      preserveResponseStatusOnReadAbort: true,
      request: async (client) => {
        const response = await client.chats.messages.send(
          chatId,
          sendBody,
          { signal: input.signal },
        ).asResponse();
        return await response.text();
      },
      signal: input.signal,
      timeoutMessage: "Linq attachment send timed out.",
      timeoutMs: attemptBudgetMs,
    });
    return readHostedLinqAttachmentSendResult(body);
  };

  try {
    return await submitSend();
  } catch (error) {
    const status = readLinqApiErrorStatus(error);
    if (
      status !== null
      && status >= 200
      && status < 300
      && isLinqApiResponseUnreadableError(error)
    ) {
      if (idempotencyKey === null) {
        return { chatId: null, messageId: null };
      }
      return await reconcileHostedLinqAttachmentSend({
        cause: buildHostedLinqUnreadAcknowledgementCause(status),
        submitSend,
      });
    }
    if (status !== null) {
      const conflict = idempotencyKey !== null
        && isHostedLinqIdempotencyKeyReuseApiError(error);
      const retryable = isRetryableHostedLinqStatus(status);
      const failure = buildHostedLinqRequestFailedError({
        operation: "attachment send",
        retryable,
        status,
        ...(conflict ? { idempotencyKeyReuseConflict: true } : {}),
      });
      if (conflict || idempotencyKey === null) {
        throw failure;
      }
      if (!retryable && !isLinqApiResponseUnreadableError(error)) {
        throw failure;
      }
      return await reconcileHostedLinqAttachmentSend({
        cause: failure,
        submitSend,
      });
    }
    if (idempotencyKey === null) {
      throw error;
    }
    return await reconcileHostedLinqAttachmentSend({ cause: error, submitSend });
  }
}

async function reconcileHostedLinqAttachmentSend(input: {
  cause: unknown;
  submitSend: () => Promise<HostedLinqSendResult>;
}): Promise<HostedLinqSendResult> {
  try {
    return await input.submitSend();
  } catch (error) {
    if (isHostedLinqIdempotencyKeyReuseApiError(error)) {
      throw buildHostedLinqRequestFailedError({
        idempotencyKeyReuseConflict: true,
        operation: "attachment send",
        retryable: false,
        status: 409,
      });
    }
    throw buildHostedLinqUnconfirmedAcknowledgementError(input.cause);
  }
}

function readHostedLinqAttachmentSendResult(
  body: string | null,
): HostedLinqSendResult {
  const payload = parseHostedLinqOptionalJson<MessageSendResponse>(body);
  return {
    chatId: normalizeNullableString(payload?.chat_id),
    messageId: normalizeNullableString(payload?.message?.id),
  };
}

async function endHostedLinqPresignedResponseBody(
  response: Response,
): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
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
    // An abort or transport error here is still provably before the message
    // POST, so callers may treat it as "nothing reached the chat" too.
    throw hostedOnboardingError({
      cause: error,
      code: "LINQ_SEND_FAILED",
      details: { phase: HOSTED_LINQ_ATTACHMENT_SEND_PHASE_PREPARE },
      httpStatus: 502,
      message: "Linq attachment preparation failed.",
      retryable: false,
    });
  }
}

function normalizeHostedLinqAttachmentContentType(
  value: unknown,
): SupportedContentType {
  const normalized = normalizeRequiredString(value, "attachment content type");
  const contentType = HOSTED_LINQ_ATTACHMENT_CONTENT_TYPES.find(
    (candidate) => candidate === normalized,
  );
  if (!contentType) {
    throw new TypeError("attachment content type is not supported by Linq.");
  }
  return contentType;
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
  await requestHostedLinqSdkOrThrow({
    operation: "contact-card share",
    request: (client) => client.chats.shareContactCard(
      normalizeRequiredString(input.chatId, "chat id"),
      { signal: input.signal },
    ),
    retryableForStatus: () => false,
    signal: input.signal,
    timeoutMessage: "Linq contact-card share timed out.",
  });
}

async function requestHostedLinqSdk<T>(input: {
  maxResponseBytes?: number;
  preserveResponseStatusOnReadAbort?: boolean;
  request: (client: LinqAPIV3) => Promise<T>;
  signal?: AbortSignal;
  timeoutMessage: string;
  timeoutMs?: number;
}): Promise<T> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();
  return await runLinqApiRequest({
    apiBaseUrl,
    apiToken,
    ...(input.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: input.maxResponseBytes }),
    request: input.request,
    preserveResponseStatusOnReadAbort: input.preserveResponseStatusOnReadAbort,
    signal: input.signal,
    timeoutMessage: input.timeoutMessage,
    timeoutMs: input.timeoutMs,
  });
}

async function requestHostedLinqSdkOrThrow<T>(input: {
  maxResponseBytes?: number;
  operation: string;
  providerErrorDiagnostics?: boolean;
  request: (client: LinqAPIV3) => Promise<T>;
  retryableForStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  timeoutMessage: string;
  timeoutMs?: number;
}): Promise<T> {
  try {
    return await requestHostedLinqSdk(input);
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        cause: error,
        code: "LINQ_SEND_FAILED",
        message: input.timeoutMessage,
        httpStatus: 502,
        retryable: true,
      });
    }

    const status = readLinqApiErrorStatus(error);
    if (status !== null) {
      throw buildHostedLinqRequestFailedError({
        operation: input.operation,
        providerErrorDiagnostics: input.providerErrorDiagnostics
          ? readHostedLinqProviderErrorDiagnostics(readLinqApiErrorPayload(error))
          : null,
        retryable: input.retryableForStatus?.(status)
          ?? isRetryableHostedLinqStatus(status),
        status,
      });
    }
    throw error;
  }
}

async function requestHostedLinqNoContentStatus(input: {
  request: (client: LinqAPIV3) => Promise<number>;
  signal?: AbortSignal;
  timeoutMessage: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number }> {
  try {
    const status = await requestHostedLinqSdk(input);
    return { ok: true, status };
  } catch (error) {
    const status = readLinqApiErrorStatus(error);
    if (status !== null) {
      return { ok: false, status };
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

function isHostedLinqIdempotencyKeyReuseApiError(error: unknown): boolean {
  if (readLinqApiErrorStatus(error) !== 409) {
    return false;
  }
  const payload = readLinqApiErrorPayload(error);
  if (payload === HOSTED_LINQ_IDEMPOTENCY_CONFLICT_MESSAGE) {
    return true;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const keys = Object.keys(payload);
  return keys.length === 1
    && keys[0] === "error"
    && Reflect.get(payload, "error") === HOSTED_LINQ_IDEMPOTENCY_CONFLICT_MESSAGE;
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


function buildHostedLinqUnreadAcknowledgementCause(status: number) {
  return hostedOnboardingError({
    code: "LINQ_SEND_FAILED",
    details: { status },
    httpStatus: 502,
    message: "Linq attachment send response body did not finish arriving.",
    retryable: true,
  });
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
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (Reflect.get(payload, "success") !== false) {
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
  if (
    providerErrorCode === null
    || hostedRuntimeLinqProviderErrorMessageForCode(providerErrorCode) === null
  ) {
    return null;
  }
  return { providerErrorCode };
}

function parseHostedLinqOptionalJson<T>(body: string | null): T | null {
  if (!body?.trim()) {
    return null;
  }
  try {
    return JSON.parse(body) as T;
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
