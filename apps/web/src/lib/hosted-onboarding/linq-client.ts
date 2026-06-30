import type {
  AttachmentCreateParams,
  AttachmentCreateResponse,
  ChatCreateParams,
  ChatCreateResponse,
  ChatSendVoicememoParams,
  MediaPart,
  SupportedContentType,
  TextPart,
  WebhookEventType,
  WebhookSubscriptionCreateParams,
  WebhookSubscriptionCreateResponse,
} from "@linqapp/sdk/resources";
import type {
  MessageSendParams,
  MessageSendResponse,
} from "@linqapp/sdk/resources/chats";
import { isIP } from "node:net";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_WEBHOOK_EVENT_TYPES = [
  "message.sent",
  "message.received",
  "message.read",
  "message.delivered",
  "message.failed",
  "message.edited",
  "reaction.added",
  "reaction.removed",
  "participant.added",
  "participant.removed",
  "chat.created",
  "chat.group_name_updated",
  "chat.group_icon_updated",
  "chat.group_name_update_failed",
  "chat.group_icon_update_failed",
  "chat.typing_indicator.started",
  "chat.typing_indicator.stopped",
  "phone_number.status_updated",
  "call.initiated",
  "call.ringing",
  "call.answered",
  "call.ended",
  "call.failed",
  "call.declined",
  "call.no_answer",
  "location.sharing.started",
  "location.sharing.stopped",
] as const satisfies readonly WebhookEventType[];
const HOSTED_LINQ_WEBHOOK_EVENT_TYPE_SET: ReadonlySet<string> =
  new Set(HOSTED_LINQ_WEBHOOK_EVENT_TYPES);
const HOSTED_LINQ_ATTACHMENT_UPLOAD_TIMEOUT_MS = 10_000;

export type HostedLinqWebhookSubscription = {
  createdAt: string | null;
  id: string | null;
  isActive: boolean | null;
  phoneNumbers: string[];
  signingSecret: string | null;
  subscribedEvents: string[];
  targetUrl: string | null;
  updatedAt: string | null;
};

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

export async function startHostedLinqTypingIndicator(input: {
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

export async function createHostedLinqChat(input: {
  from: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
  to: string[];
}): Promise<{ chatId: string | null; messageId: string | null }> {
  const body: ChatCreateParams = {
    from: normalizeRequiredString(input.from, "from"),
    message: buildHostedLinqTextMessageBody({
      idempotencyKey: input.idempotencyKey,
      message: input.message,
    }).message,
    to: normalizeHostedLinqRecipients(input.to),
  };

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "outbound chat creation",
    path: "chats",
    signal: input.signal,
    timeoutMessage: "Linq outbound chat creation timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "outbound chat creation",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = (await response.json()) as ChatCreateResponse;
  return {
    chatId: normalizeNullableString(payload.chat?.id),
    messageId: normalizeNullableString(payload.chat?.message?.id),
  };
}

export async function createHostedLinqMediaChat(input: {
  attachmentId: string;
  from: string;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
  to: string[];
}): Promise<{ chatId: string | null; messageId: string | null }> {
  const body: ChatCreateParams = {
    from: normalizeRequiredString(input.from, "from"),
    message: buildHostedLinqMediaMessageBody({
      attachmentId: input.attachmentId,
      idempotencyKey: input.idempotencyKey,
    }).message,
    to: normalizeHostedLinqRecipients(input.to),
  };

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "outbound media chat creation",
    path: "chats",
    signal: input.signal,
    timeoutMessage: "Linq outbound media chat creation timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "outbound media chat creation",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = (await response.json()) as ChatCreateResponse;
  return {
    chatId: normalizeNullableString(payload.chat?.id),
    messageId: normalizeNullableString(payload.chat?.message?.id),
  };
}

export async function uploadHostedLinqAttachment(input: {
  bytes: Uint8Array;
  contentType: SupportedContentType;
  filename: string;
  signal?: AbortSignal;
  sizeBytes: number;
}): Promise<{ attachmentId: string }> {
  const linqConfig = requireHostedOnboardingLinqConfig();
  const body: AttachmentCreateParams = {
    content_type: input.contentType,
    filename: normalizeRequiredString(input.filename, "attachment filename"),
    size_bytes: normalizeHostedLinqAttachmentSize(input.sizeBytes),
  };
  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "attachment creation",
    path: "attachments",
    signal: input.signal,
    timeoutMessage: "Linq attachment creation timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "attachment creation",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const attachment = parseHostedLinqAttachmentUploadResponse(
    (await response.json()) as AttachmentCreateResponse,
    {
      allowedUploadHosts: linqConfig.attachmentUploadAllowedHosts,
    },
  );
  const uploadResponse = await fetchHostedLinqAttachmentUploadUrl({
    bytes: input.bytes,
    requiredHeaders: attachment.requiredHeaders,
    signal: input.signal,
    uploadUrl: attachment.uploadUrl,
  });

  if (!uploadResponse.ok) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: `Linq attachment upload failed with HTTP ${uploadResponse.status}.`,
      httpStatus: 502,
      retryable: isRetryableHostedLinqStatus(uploadResponse.status),
    });
  }

  return { attachmentId: attachment.attachmentId };
}

export async function sendHostedLinqVoiceMemo(input: {
  attachmentId: string;
  chatId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const body: ChatSendVoicememoParams = {
    attachment_id: normalizeRequiredString(input.attachmentId, "attachment id"),
  };
  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "voice memo send",
    path: `chats/${
      encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))
    }/voicememo`,
    signal: input.signal,
    timeoutMessage: "Linq voice memo send timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "voice memo send",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }
}

export async function createHostedLinqWebhookSubscription(input: {
  phoneNumbers?: readonly string[] | null;
  signal?: AbortSignal;
  subscribedEvents: readonly string[];
  targetUrl: string;
}): Promise<HostedLinqWebhookSubscription> {
  const phoneNumbers = input.phoneNumbers && input.phoneNumbers.length > 0
    ? normalizeHostedLinqRecipients(input.phoneNumbers)
    : null;
  const body: WebhookSubscriptionCreateParams = {
    ...(phoneNumbers
      ? {
          phone_numbers: phoneNumbers,
        }
      : {}),
    subscribed_events: normalizeHostedLinqSubscribedEvents(input.subscribedEvents),
    target_url: normalizeRequiredString(input.targetUrl, "target url"),
  };

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "webhook subscription creation",
    path: "webhook-subscriptions",
    signal: input.signal,
    timeoutMessage: "Linq webhook subscription creation timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "webhook subscription creation",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = (await response.json()) as WebhookSubscriptionCreateResponse;
  return {
    createdAt: normalizeNullableString(payload.created_at),
    id: normalizeNullableString(payload.id),
    isActive: typeof payload.is_active === "boolean" ? payload.is_active : null,
    phoneNumbers: normalizeHostedLinqOptionalTextArray(payload.phone_numbers),
    signingSecret: normalizeNullableString(payload.signing_secret),
    subscribedEvents: normalizeHostedLinqOptionalTextArray(payload.subscribed_events),
    targetUrl: normalizeNullableString(payload.target_url),
    updatedAt: normalizeNullableString(payload.updated_at),
  };
}

async function fetchHostedLinqApiOrThrow(input: {
  body?: string;
  headers?: HeadersInit;
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
      headers: input.headers,
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

async function fetchHostedLinqAttachmentUploadUrl(input: {
  bytes: Uint8Array;
  requiredHeaders: Record<string, string>;
  signal?: AbortSignal;
  uploadUrl: string;
}): Promise<Response> {
  const { clearTimeout, didTimeout, signal } = createHostedLinqTimeoutSignal({
    signal: input.signal,
    timeoutMs: HOSTED_LINQ_ATTACHMENT_UPLOAD_TIMEOUT_MS,
  });

  try {
    return await fetch(input.uploadUrl, {
      body: copyBytesToArrayBuffer(input.bytes),
      headers: normalizeHostedLinqAttachmentUploadHeaders(input.requiredHeaders),
      method: "PUT",
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (didTimeout() && !input.signal?.aborted) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq attachment upload timed out.",
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  } finally {
    clearTimeout();
  }
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createHostedLinqTimeoutSignal(input: {
  signal?: AbortSignal;
  timeoutMs: number;
}): {
  clearTimeout: () => void;
  didTimeout: () => boolean;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => {
    controller.abort(input.signal?.reason);
  };

  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort(input.signal.reason);
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new LinqApiTimeoutError("Linq attachment upload timed out."));
  }, input.timeoutMs);

  return {
    clearTimeout: () => {
      clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", onAbort);
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}

function normalizeHostedLinqAttachmentSize(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("attachment size must be a positive integer.");
  }

  return value;
}

function normalizeHostedLinqAttachmentUploadUrl(
  value: unknown,
  allowedUploadHosts: readonly string[],
): string {
  let url: URL;

  try {
    url = new URL(normalizeRequiredString(value, "attachment upload URL"));
  } catch {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload URL was invalid.",
      httpStatus: 502,
      retryable: false,
    });
  }

  if (url.protocol !== "https:") {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload URL must use HTTPS.",
      httpStatus: 502,
      retryable: false,
    });
  }

  if (url.username || url.password || url.hash) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload URL must not include credentials or fragments.",
      httpStatus: 502,
      retryable: false,
    });
  }

  if (!isAllowedHostedLinqAttachmentUploadHost(url.hostname, allowedUploadHosts)) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload URL host is not authorized.",
      httpStatus: 502,
      retryable: false,
    });
  }

  return url.toString();
}

function parseHostedLinqAttachmentUploadResponse(
  value: AttachmentCreateResponse,
  options: {
    allowedUploadHosts: readonly string[];
  },
): {
  attachmentId: string;
  requiredHeaders: Record<string, string>;
  uploadUrl: string;
} {
  const record = readRecord(value);
  const attachmentId = normalizeNullableString(record?.attachment_id);
  const uploadUrl = normalizeNullableString(record?.upload_url);
  const expiresAt = normalizeNullableString(record?.expires_at);
  const httpMethod = normalizeNullableString(record?.http_method);
  const requiredHeaders = readStringRecord(record?.required_headers);

  if (!attachmentId || !uploadUrl || !expiresAt || !requiredHeaders) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload response was missing required fields.",
      httpStatus: 502,
      retryable: false,
    });
  }

  if (httpMethod && httpMethod.toUpperCase() !== "PUT") {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload response returned an unsupported upload method.",
      httpStatus: 502,
      retryable: false,
    });
  }

  return {
    attachmentId,
    requiredHeaders,
    uploadUrl: normalizeHostedLinqAttachmentUploadUrl(
      uploadUrl,
      options.allowedUploadHosts,
    ),
  };
}

function normalizeHostedLinqAttachmentUploadHeaders(
  value: Record<string, string>,
): Headers {
  const headers = new Headers();

  for (const [name, headerValue] of Object.entries(value)) {
    if (!name || typeof headerValue !== "string") {
      throw new TypeError("attachment upload headers are invalid.");
    }

    if (isForbiddenHostedLinqAttachmentUploadHeader(name)) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq attachment upload headers included an unsafe header.",
        httpStatus: 502,
        retryable: false,
      });
    }

    headers.set(name, headerValue);
  }

  return headers;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringRecord(value: unknown): Record<string, string> | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const output: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(record)) {
    if (typeof recordValue !== "string") {
      return null;
    }
    output[key] = recordValue;
  }

  return output;
}

function isAllowedHostedLinqAttachmentUploadHost(
  hostname: string,
  allowedUploadHosts: readonly string[],
): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    !normalized
    || normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
  ) {
    return false;
  }

  const ipLiteral = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;

  return isIP(ipLiteral) === 0 && allowedUploadHosts.includes(normalized);
}

function isForbiddenHostedLinqAttachmentUploadHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "authorization"
    || normalized === "cookie"
    || normalized === "proxy-authorization";
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

function buildHostedLinqMediaMessageBody(input: {
  attachmentId: string;
  idempotencyKey?: string | null;
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const mediaPart: MediaPart = {
    attachment_id: normalizeRequiredString(input.attachmentId, "attachment id"),
    type: "media",
  };

  return {
    message: {
      parts: [
        mediaPart,
      ],
      ...(idempotencyKey
        ? {
            idempotency_key: idempotencyKey,
          }
        : {}),
    },
  };
}

function normalizeHostedLinqRecipients(values: readonly string[]): string[] {
  const recipients = values
    .map((value) => normalizeRequiredString(value, "recipient"))
    .filter((value, index, array) => array.indexOf(value) === index);

  if (recipients.length === 0) {
    throw new TypeError("At least one Linq recipient is required.");
  }

  return recipients;
}

function normalizeHostedLinqSubscribedEvents(values: readonly string[]): WebhookEventType[] {
  const subscribedEvents = values
    .map((value) => normalizeRequiredString(value, "subscribed event"))
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((value) => {
      if (isHostedLinqWebhookEventType(value)) {
        return value;
      }

      throw new TypeError("Linq subscribed event is not supported by the Linq SDK contract.");
    });

  if (subscribedEvents.length === 0) {
    throw new TypeError("At least one Linq subscribed event is required.");
  }

  return subscribedEvents;
}

function isHostedLinqWebhookEventType(value: string): value is WebhookEventType {
  return HOSTED_LINQ_WEBHOOK_EVENT_TYPE_SET.has(value);
}

function normalizeHostedLinqOptionalTextArray(values: readonly unknown[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => normalizeNullableString(value))
    .filter((value): value is string => value !== null);
}
