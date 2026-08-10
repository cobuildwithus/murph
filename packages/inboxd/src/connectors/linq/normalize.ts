import path from "node:path";

import {
  buildLinqMessageText,
  parseLinqMessageReceivedEvent,
  readLinqRecipientLineHandle,
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

const LINQ_CAPTURE_RAW_SCHEMA = "murph.linq-capture.v1";
const LINQ_ATTACHMENT_DOWNLOAD_CONCURRENCY = 2;

export interface LinqAttachmentDownloadDriver {
  downloadUrl(url: string, signal?: AbortSignal): Promise<Uint8Array | null>;
  downloadPart?(
    part: {
      attachmentId?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      size?: number | null;
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
    threadIsDirect?: boolean | null;
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
  const messageEvent = parseLinqMessageReceivedEvent(event);
  const accountId =
    normalizeTextValue(readLinqRecipientLineHandle(messageEvent.data))
    ?? defaultAccountId;
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
    raw: buildLinqCaptureRawMetadata({
      chatId,
      eventId: normalizeTextValue(event.event_id),
      isFromMe: data.is_from_me,
      messageId,
      parts: data.message.parts,
      replyToMessageId: normalizeTextValue(data.message.reply_to?.message_id ?? null),
      replyToPartIndex: data.message.reply_to?.part_index ?? null,
      service: normalizeTextValue(data.service ?? null),
    }),
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
      ?? normalizeTextValue(readLinqRecipientLineHandle(input.messageEvent.data)),
    message: input.externalIdOverride
      ? {
          ...message,
          externalId: input.externalIdOverride,
        }
      : message,
    source: input.source,
  });
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
      isDirect: typeof message.threadIsDirect === "boolean"
        ? message.threadIsDirect
        : true,
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
    raw: buildLinqCaptureRawMetadata({
      chatId,
      isFromMe: message.isFromMe,
      messageId,
      parts,
      replyToMessageId: normalizeTextValue(message.replyToMessageId ?? null),
      replyToPartIndex: message.replyToPartIndex ?? null,
      service: normalizeTextValue(message.service ?? null),
    }),
  };
}

async function buildLinqAttachments(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
  attachmentDownloadTimeoutMs?: number | null,
): Promise<InboundAttachment[]> {
  const attachmentParts = (parts ?? [])
    .map((part, index) => ({ index, part }))
    .filter((entry): entry is { index: number; part: LinqMediaPart } =>
      isLinqAttachmentPart(entry.part)
    );
  const normalizedTimeoutMs = normalizeAttachmentDownloadTimeout(attachmentDownloadTimeoutMs);
  const deadlineMs = normalizedTimeoutMs === null ? null : Date.now() + normalizedTimeoutMs;
  const attachments = new Array<InboundAttachment>(attachmentParts.length);
  let nextAttachmentIndex = 0;

  async function buildNextAttachment(): Promise<void> {
    for (;;) {
      const resultIndex = nextAttachmentIndex;
      nextAttachmentIndex += 1;
      const entry = attachmentParts[resultIndex];
      if (!entry) {
        return;
      }

      attachments[resultIndex] = await buildLinqAttachment({
        deadlineMs,
        downloadDriver,
        part: entry.part,
        partIndex: entry.index,
        signal,
      });
    }
  }

  const workerCount = Math.min(LINQ_ATTACHMENT_DOWNLOAD_CONCURRENCY, attachmentParts.length);
  await Promise.all(Array.from({ length: workerCount }, () => buildNextAttachment()));
  return attachments;
}

async function buildLinqAttachment(input: {
  deadlineMs: number | null;
  downloadDriver: LinqAttachmentDownloadDriver | null;
  part: LinqMediaPart;
  partIndex: number;
  signal?: AbortSignal;
}): Promise<InboundAttachment> {
  const remainingTimeoutMs = readRemainingLinqAttachmentDownloadBudgetMs(input.deadlineMs);
  const data = remainingTimeoutMs === 0
    ? null
    : await runLinqAttachmentDownloadWithTimeout(
      (downloadSignal) => downloadLinqAttachmentInlineBestEffort(
        input.part,
        input.downloadDriver,
        downloadSignal,
      ),
      remainingTimeoutMs,
      input.signal,
    );
  const mime = normalizeTextValue(input.part.mime_type ?? null);
  const fileName = normalizeTextValue(input.part.filename ?? null)
    ?? inferAttachmentFileName(input.part, data)
    ?? inferFallbackAttachmentFileName(input.part, mime, input.partIndex, data);

  return {
    externalId: normalizeTextValue(input.part.attachment_id ?? null) ?? `part:${input.partIndex + 1}`,
    kind: inferLinqAttachmentKind(input.part.type, mime, fileName),
    mime,
    fileName,
    byteSize: normalizeAttachmentByteSize(input.part.size, data),
    data,
  };
}

async function downloadLinqAttachmentInlineBestEffort(
  part: LinqMediaPart,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const url = normalizeTextValue(part.url ?? null);
  if (!downloadDriver || (!url && !downloadDriver.downloadPart)) {
    return null;
  }

  try {
    const attachmentDownloadPart = {
      attachmentId: normalizeTextValue(part.attachment_id ?? null),
      fileName: normalizeTextValue(part.filename ?? null),
      mimeType: normalizeTextValue(part.mime_type ?? null),
      size: normalizeAttachmentDeclaredByteSize(part.size),
      type: part.type,
      url,
    };
    const downloadOperation = (downloadSignal?: AbortSignal) => {
      if (downloadDriver.downloadPart) {
        return downloadDriver.downloadPart(attachmentDownloadPart, downloadSignal);
      }

      if (url) {
        return downloadDriver.downloadUrl(url, downloadSignal);
      }

      return Promise.resolve<Uint8Array | null>(null);
    };

    return await downloadOperation(signal);
  } catch {
    return null;
  }
}

async function runLinqAttachmentDownloadWithTimeout(
  downloadOperation: (signal?: AbortSignal) => Promise<Uint8Array | null>,
  timeoutMs: number | null,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  if (timeoutMs === null) {
    return await downloadOperation(signal);
  }

  const controller = new AbortController();
  const releaseRelay = signal ? relayAbort(signal, controller) : () => {};

  try {
    return await new Promise<Uint8Array | null>((resolve) => {
      const timeout = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);

      void downloadOperation(controller.signal)
        .then((data) => {
          clearTimeout(timeout);
          resolve(data);
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve(null);
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

function readRemainingLinqAttachmentDownloadBudgetMs(deadlineMs: number | null): number | null {
  if (deadlineMs === null) {
    return null;
  }

  return Math.max(0, Math.floor(deadlineMs - Date.now()));
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

function buildLinqCaptureRawMetadata(input: {
  chatId: string;
  eventId?: string | null;
  isFromMe: boolean;
  messageId: string;
  parts: ReadonlyArray<LinqMessagePart>;
  replyToMessageId?: string | null;
  replyToPartIndex?: number | null;
  service?: string | null;
}): Record<string, unknown> {
  let textPartCount = 0;
  let linkPartCount = 0;
  let mediaPartCount = 0;
  let voiceMemoPartCount = 0;
  let imessageAppPartCount = 0;
  const attachments: Array<Record<string, unknown>> = [];

  for (const part of input.parts) {
    if (part.type === "text") {
      textPartCount += 1;
      continue;
    }

    if (part.type === "link") {
      linkPartCount += 1;
      continue;
    }

    if (part.type === "imessage_app") {
      imessageAppPartCount += 1;
      continue;
    }

    if (part.type === "media") {
      mediaPartCount += 1;
    } else {
      voiceMemoPartCount += 1;
    }

    const attachment: Record<string, unknown> = {
      type: part.type,
    };
    const attachmentId = normalizeTextValue(part.attachment_id ?? null);
    const mimeType = normalizeTextValue(part.mime_type ?? null);

    if (attachmentId) {
      attachment.attachment_id = attachmentId;
    }
    if (mimeType) {
      attachment.mime_type = mimeType;
    }
    if (typeof part.size === "number" && Number.isFinite(part.size) && part.size >= 0) {
      attachment.size = Math.floor(part.size);
    }

    attachments.push(attachment);
  }

  const raw: Record<string, unknown> = {
    schema: LINQ_CAPTURE_RAW_SCHEMA,
    event_type: "message.received",
    chat_id: input.chatId,
    message_id: input.messageId,
    is_from_me: input.isFromMe,
    text_part_count: textPartCount,
    link_part_count: linkPartCount,
    media_part_count: mediaPartCount,
    voice_memo_part_count: voiceMemoPartCount,
    reaction_eligible: input.service?.trim().toLowerCase() === "imessage"
      && input.parts.length === 1,
  };

  if (input.eventId) {
    raw.event_id = input.eventId;
  }
  if (imessageAppPartCount > 0) {
    raw.imessage_app_part_count = imessageAppPartCount;
  }
  if (input.service) {
    raw.service = input.service;
  }
  if (input.replyToMessageId) {
    raw.reply_to_message_id = input.replyToMessageId;
  }
  if (typeof input.replyToPartIndex === "number" && Number.isSafeInteger(input.replyToPartIndex)) {
    raw.reply_to_part_index = input.replyToPartIndex;
  }
  if (attachments.length > 0) {
    raw.attachments = attachments;
  }

  return raw;
}

function inferAttachmentFileName(
  part: LinqMediaPart,
  data: Uint8Array | null,
): string | null {
  if (data === null) {
    return null;
  }

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
  data: Uint8Array | null,
): string | null {
  if (data === null) {
    const isVoiceMemo = part.type === "voice_memo";
    const suffix = inferFileExtensionFromMime(mime) ?? (isVoiceMemo ? "m4a" : null);
    const prefix = isVoiceMemo ? "voice-memo" : "attachment";
    return suffix
      ? `${prefix}-part-${index + 1}.${suffix}`
      : `${prefix}-part-${index + 1}`;
  }

  if (part.type !== "voice_memo") {
    return null;
  }

  const suffix = inferFileExtensionFromMime(mime) ?? "m4a";
  return `voice-memo-part-${index + 1}.${suffix}`;
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
  const declaredSize = normalizeAttachmentDeclaredByteSize(value);
  if (declaredSize !== null) {
    return declaredSize;
  }

  return data?.byteLength ?? null;
}

function normalizeAttachmentDeclaredByteSize(
  value: number | null | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}
