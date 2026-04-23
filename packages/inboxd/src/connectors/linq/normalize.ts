import path from "node:path";

import {
  buildLinqMessageText,
  minimizeLinqWebhookEvent,
  parseCanonicalLinqMessageReceivedEvent,
  type LinqMediaPart,
  type LinqMessagePart,
  type LinqMessageReceivedData,
  type LinqMessageReceivedEvent,
  type LinqWebhookEvent,
} from "@murphai/messaging-ingress/linq-webhook";

import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";
import type { ChatMessage } from "../chat/message.ts";
import { createInboundCaptureFromChatMessage } from "../chat/message.ts";
import {
  normalizeTextValue,
  relayAbort,
  toIsoTimestamp,
} from "../../shared-runtime.ts";

export interface LinqAttachmentDownloadDriver {
  downloadUrl(url: string, signal?: AbortSignal): Promise<Uint8Array | null>;
  downloadPart?(
    part: {
      attachmentId?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      type: "media" | "voice_memo";
      url?: string | null;
    },
    signal?: AbortSignal,
  ): Promise<Uint8Array | null>;
}

export interface NormalizeLinqWebhookEventInput {
  event: LinqWebhookEvent;
  source?: string;
  defaultAccountId?: string | null;
  downloadDriver?: LinqAttachmentDownloadDriver | null;
  signal?: AbortSignal;
  attachmentDownloadTimeoutMs?: number | null;
}

export interface NormalizeHostedLinqConversationMessageInput {
  accountId: string;
  linqMessage: {
    chatId: string;
    from: string;
    isFromMe: boolean;
    messageId: string;
    parts: Array<
      | {
          type: "text" | "link";
          value: string;
        }
      | {
          attachmentId?: string | null;
          fileName?: string | null;
          mimeType?: string | null;
          size?: number | null;
          type: "media" | "voice_memo";
          url?: string | null;
        }
    >;
    replyToMessageId?: string | null;
    replyToPartIndex?: number | null;
    service?: string | null;
  };
  occurredAt: string;
  source?: string;
  downloadDriver?: LinqAttachmentDownloadDriver | null;
  signal?: AbortSignal;
  attachmentDownloadTimeoutMs?: number | null;
}

export async function normalizeLinqWebhookEvent({
  event,
  source = "linq",
  defaultAccountId = null,
  downloadDriver = null,
  signal,
  attachmentDownloadTimeoutMs = null,
}: NormalizeLinqWebhookEventInput): Promise<InboundCapture> {
  const messageEvent = parseCanonicalLinqMessageReceivedEvent(event);
  const accountId =
    normalizeTextValue(messageEvent.data.recipient_phone ?? null) ?? defaultAccountId;
  return normalizeLinqMessageReceivedEvent({
    accountId,
    attachmentDownloadTimeoutMs,
    downloadDriver,
    messageEvent,
    signal,
    source,
  });
}

export async function normalizeHostedLinqConversationMessage({
  accountId,
  linqMessage,
  occurredAt,
  source = "linq",
  downloadDriver = null,
  signal,
  attachmentDownloadTimeoutMs = null,
}: NormalizeHostedLinqConversationMessageInput): Promise<InboundCapture> {
  return createInboundCaptureFromChatMessage({
    accountId,
    message: await toHostedLinqChatMessage({
      attachmentDownloadTimeoutMs,
      downloadDriver,
      message: linqMessage,
      occurredAt,
      signal,
    }),
    source,
  });
}

export async function toLinqChatMessage(input: {
  event: LinqMessageReceivedEvent;
  downloadDriver?: LinqAttachmentDownloadDriver | null;
  signal?: AbortSignal;
  attachmentDownloadTimeoutMs?: number | null;
}): Promise<ChatMessage> {
  const { event, downloadDriver = null, signal, attachmentDownloadTimeoutMs = null } = input;
  const data = event.data;
  const receivedAt = normalizeTextValue(data.received_at);
  const createdAt = normalizeTextValue(event.created_at);
  const messageId = normalizeTextValue(data.message.id);
  if (!messageId) {
    throw new TypeError("Linq message.received event is missing a stable message id.");
  }

  const chatId = normalizeTextValue(data.chat_id);
  if (!chatId) {
    throw new TypeError("Linq message.received event is missing a stable chat id.");
  }

  return {
    externalId: `linq:${messageId}`,
    thread: {
      id: chatId,
      title: buildLinqThreadTitle(data),
      isDirect: true,
    },
    actor: {
      id: normalizeTextValue(data.from),
      displayName: null,
      isSelf: data.is_from_me,
    },
    occurredAt: toIsoTimestamp(receivedAt ?? createdAt ?? new Date()),
    receivedAt: receivedAt
      ? toIsoTimestamp(receivedAt)
      : createdAt
        ? toIsoTimestamp(createdAt)
        : null,
    text: buildLinqMessageText(data.message.parts),
    attachments: await buildLinqAttachments(
      data.message.parts,
      downloadDriver,
      signal,
      attachmentDownloadTimeoutMs,
    ),
    raw: minimizeLinqWebhookEvent(event),
  };
}

async function normalizeLinqMessageReceivedEvent(input: {
  accountId?: string | null;
  attachmentDownloadTimeoutMs?: number | null;
  downloadDriver?: LinqAttachmentDownloadDriver | null;
  externalIdOverride?: string | null;
  messageEvent: LinqMessageReceivedEvent;
  signal?: AbortSignal;
  source: string;
}): Promise<InboundCapture> {
  const message = await toLinqChatMessage({
    attachmentDownloadTimeoutMs: input.attachmentDownloadTimeoutMs,
    downloadDriver: input.downloadDriver,
    event: input.messageEvent,
    signal: input.signal,
  });

  return createInboundCaptureFromChatMessage({
    accountId:
      normalizeTextValue(input.accountId ?? null)
      ?? normalizeTextValue(input.messageEvent.data.recipient_phone ?? null),
    message: input.externalIdOverride
      ? {
          ...message,
          externalId: input.externalIdOverride,
        }
      : message,
    source: input.source,
  });
}

function isCanonicalLinqWebhookEvent(value: unknown): value is LinqWebhookEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.api_version === "string"
    && typeof record.created_at === "string"
    && typeof record.event_id === "string"
    && typeof record.event_type === "string"
    && typeof record.data === "object"
    && record.data !== null
  );
}

async function toHostedLinqChatMessage(input: {
  attachmentDownloadTimeoutMs?: number | null;
  downloadDriver?: LinqAttachmentDownloadDriver | null;
  message: NormalizeHostedLinqConversationMessageInput["linqMessage"];
  occurredAt: string;
  signal?: AbortSignal;
}): Promise<ChatMessage> {
  const { message, downloadDriver = null, occurredAt, signal, attachmentDownloadTimeoutMs = null } = input;
  const messageId = normalizeTextValue(message.messageId);
  if (!messageId) {
    throw new TypeError("Hosted Linq conversation wake is missing a stable message id.");
  }

  const chatId = normalizeTextValue(message.chatId);
  if (!chatId) {
    throw new TypeError("Hosted Linq conversation wake is missing a stable chat id.");
  }

  const parts = message.parts.map((part) => {
    if (part.type === "text" || part.type === "link") {
      return {
        type: part.type,
        value: part.value,
      };
    }

    if (part.type === "media" || part.type === "voice_memo") {
      return {
        attachment_id: part.attachmentId,
        filename: part.fileName,
        mime_type: part.mimeType,
        size: part.size,
        type: part.type,
        url: part.url,
      };
    }

    throw new TypeError(`Unsupported hosted Linq part type: ${String((part as { type: unknown }).type)}`);
  }) as LinqMessagePart[];

  return {
    externalId: `linq:${messageId}`,
    thread: {
      id: chatId,
      title: buildHostedLinqThreadTitle(message),
      isDirect: true,
    },
    actor: {
      id: normalizeTextValue(message.from),
      displayName: null,
      isSelf: message.isFromMe,
    },
    occurredAt: toIsoTimestamp(occurredAt),
    receivedAt: toIsoTimestamp(occurredAt),
    text: buildLinqMessageText(parts),
    attachments: await buildLinqAttachments(
      parts,
      downloadDriver,
      signal,
      attachmentDownloadTimeoutMs,
    ),
    raw: buildHostedLinqRaw(message, parts),
  };
}

async function buildLinqAttachments(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
  attachmentDownloadTimeoutMs?: number | null,
): Promise<InboundAttachment[]> {
  const attachments: InboundAttachment[] = [];

  for (const [index, part] of (parts ?? []).entries()) {
    if (!isLinqAttachmentPart(part)) {
      continue;
    }

    const data = await downloadLinqAttachmentInlineBestEffort(
      part,
      downloadDriver,
      signal,
      attachmentDownloadTimeoutMs,
    );
    const mime = normalizeTextValue(part.mime_type ?? null);
    const fileName = normalizeTextValue(part.filename ?? null)
      ?? inferAttachmentFileName(part)
      ?? inferFallbackAttachmentFileName(part, mime, index);

    attachments.push({
      externalId: normalizeTextValue(part.attachment_id ?? null) ?? `part:${index + 1}`,
      kind: inferLinqAttachmentKind(part.type, mime, fileName),
      mime,
      fileName,
      byteSize: normalizeAttachmentByteSize(part.size, data),
      data,
    });
  }

  return attachments;
}

async function downloadLinqAttachmentInlineBestEffort(
  part: LinqMediaPart,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
  attachmentDownloadTimeoutMs?: number | null,
): Promise<Uint8Array | null> {
  const url = normalizeTextValue(part.url ?? null);
  if (!downloadDriver || (!url && !downloadDriver.downloadPart)) {
    return null;
  }

  try {
    const normalizedTimeoutMs = normalizeAttachmentDownloadTimeout(attachmentDownloadTimeoutMs);
    const attachmentDownloadPart = {
      attachmentId: normalizeTextValue(part.attachment_id ?? null),
      fileName: normalizeTextValue(part.filename ?? null),
      mimeType: normalizeTextValue(part.mime_type ?? null),
      type: part.type,
      url,
    };
    const downloadOperation = (downloadSignal?: AbortSignal) => {
      if (url) {
        return downloadDriver
          .downloadUrl(url, downloadSignal)
          .catch(async (error) => {
            if (!downloadDriver.downloadPart) {
              throw error;
            }

            return downloadDriver.downloadPart(attachmentDownloadPart, downloadSignal);
          })
          .then(async (data) => {
            if (data !== null || !downloadDriver.downloadPart) {
              return data;
            }

            return downloadDriver.downloadPart(attachmentDownloadPart, downloadSignal);
          });
      }

      if (!downloadDriver.downloadPart) {
        return Promise.resolve<Uint8Array | null>(null);
      }

      return downloadDriver.downloadPart(attachmentDownloadPart, downloadSignal);
    };

    if (normalizedTimeoutMs !== null) {
      return await runLinqAttachmentDownloadWithTimeout(downloadOperation, normalizedTimeoutMs, signal);
    }

    return await downloadOperation(signal);
  } catch {
    return null;
  }
}

async function runLinqAttachmentDownloadWithTimeout(
  downloadOperation: (signal?: AbortSignal) => Promise<Uint8Array | null>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const releaseRelay = signal ? relayAbort(signal, controller) : () => {};

  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);

      void downloadOperation(controller.signal)
        .then((data) => {
          clearTimeout(timeout);
          resolve(data);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  } finally {
    releaseRelay();
  }
}

function normalizeAttachmentDownloadTimeout(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor(value));
}

function buildLinqThreadTitle(data: LinqMessageReceivedData): string | null {
  const from = normalizeTextValue(data.from);
  const recipient = normalizeTextValue(data.recipient_phone ?? null);
  const service = normalizeTextValue(data.service ?? null);
  const participants = [from, recipient].filter((value): value is string => value !== null);
  if (participants.length === 0 && !service) {
    return null;
  }

  const base = participants.join(" ↔ ");
  return service ? (base ? `${base} (${service})` : service) : base;
}

function buildHostedLinqThreadTitle(
  message: NormalizeHostedLinqConversationMessageInput["linqMessage"],
): string | null {
  const from = normalizeTextValue(message.from);
  const service = normalizeTextValue(message.service ?? null);
  if (!from && !service) {
    return null;
  }

  return service ? (from ? `${from} (${service})` : service) : from;
}

function buildHostedLinqRaw(
  message: NormalizeHostedLinqConversationMessageInput["linqMessage"],
  parts: LinqMessagePart[],
): Record<string, unknown> {
  return {
    chatId: message.chatId,
    from: message.from,
    isFromMe: message.isFromMe,
    messageId: message.messageId,
    parts,
    ...(message.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: message.replyToMessageId }),
    ...(message.replyToPartIndex === undefined
      ? {}
      : { replyToPartIndex: message.replyToPartIndex }),
    ...(message.service === undefined ? {} : { service: message.service }),
  };
}

function inferAttachmentFileName(part: LinqMediaPart): string | null {
  const url = normalizeTextValue(part.url ?? null);
  if (!url) {
    return null;
  }

  try {
    const pathname = new URL(url).pathname;
    const base = path.posix.basename(pathname);
    return normalizeTextValue(base);
  } catch {
    return null;
  }
}

function inferFallbackAttachmentFileName(
  part: LinqMediaPart,
  mime: string | null,
  index: number,
): string | null {
  if (part.type !== "voice_memo") {
    return null;
  }

  const suffix = inferFileExtensionFromMime(mime) ?? "m4a";
  const identifier = normalizeTextValue(part.attachment_id ?? null) ?? `part-${index + 1}`;
  return `voice-memo-${identifier}.${suffix}`;
}

function inferLinqAttachmentKind(
  partType: LinqMediaPart["type"],
  mime: string | null,
  fileName: string | null,
): InboundAttachment["kind"] {
  if (partType === "voice_memo") {
    return "audio";
  }

  const lowerMime = String(mime ?? "").toLowerCase();
  const lowerName = String(fileName ?? "").toLowerCase();

  if (lowerMime.startsWith("image/") || /\.(bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/u.test(lowerName)) {
    return "image";
  }
  if (lowerMime.startsWith("audio/") || /\.(aac|aif|aiff|amr|caf|m4a|mp3|ogg|wav)$/u.test(lowerName)) {
    return "audio";
  }
  if (lowerMime.startsWith("video/") || /\.(m4v|mov|mp4|webm)$/u.test(lowerName)) {
    return "video";
  }
  if (
    lowerMime === "application/pdf"
    || /\.(csv|docx?|pdf|rtf|txt|xls|xlsx)$/u.test(lowerName)
  ) {
    return "document";
  }

  return "other";
}

function inferFileExtensionFromMime(value: string | null): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  switch (normalized) {
    case "audio/aac":
    case "audio/x-aac":
      return "aac";
    case "audio/aiff":
    case "audio/x-aiff":
      return "aiff";
    case "audio/amr":
      return "amr";
    case "audio/caf":
    case "audio/x-caf":
      return "caf";
    case "audio/m4a":
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    default:
      return null;
  }
}

function isLinqAttachmentPart(part: LinqMessagePart): part is LinqMediaPart {
  return part.type === "media" || part.type === "voice_memo";
}

function normalizeAttachmentByteSize(
  value: number | null | undefined,
  data: Uint8Array | null,
): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  return data?.byteLength ?? null;
}
