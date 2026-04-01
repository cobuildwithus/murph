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
}

export interface NormalizeLinqWebhookEventInput {
  event: LinqWebhookEvent;
  source?: string;
  defaultAccountId?: string | null;
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
  const message = await toLinqChatMessage({
    attachmentDownloadTimeoutMs,
    downloadDriver,
    event: messageEvent,
    signal,
  });

  return createInboundCaptureFromChatMessage({
    accountId,
    message,
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

async function buildLinqAttachments(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
  downloadDriver: LinqAttachmentDownloadDriver | null,
  signal?: AbortSignal,
  attachmentDownloadTimeoutMs?: number | null,
): Promise<InboundAttachment[]> {
  const attachments: InboundAttachment[] = [];

  for (const [index, part] of (parts ?? []).entries()) {
    if (part.type !== "media") {
      continue;
    }

    const data = await downloadLinqAttachmentInlineBestEffort(
      part,
      downloadDriver,
      signal,
      attachmentDownloadTimeoutMs,
    );
    const fileName = normalizeTextValue(part.filename ?? null) ?? inferAttachmentFileName(part);
    const mime = normalizeTextValue(part.mime_type ?? null);

    attachments.push({
      externalId: normalizeTextValue(part.attachment_id ?? null) ?? `part:${index + 1}`,
      kind: inferLinqAttachmentKind(mime, fileName),
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
  if (!downloadDriver || !url) {
    return null;
  }

  try {
    const normalizedTimeoutMs = normalizeAttachmentDownloadTimeout(attachmentDownloadTimeoutMs);
    if (normalizedTimeoutMs !== null) {
      return await downloadLinqAttachmentWithTimeout(
        downloadDriver,
        url,
        normalizedTimeoutMs,
        signal,
      );
    }

    return await downloadDriver.downloadUrl(url, signal);
  } catch {
    return null;
  }
}

async function downloadLinqAttachmentWithTimeout(
  downloadDriver: LinqAttachmentDownloadDriver,
  url: string,
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

      void downloadDriver
        .downloadUrl(url, controller.signal)
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

function inferLinqAttachmentKind(
  mime: string | null,
  fileName: string | null,
): InboundAttachment["kind"] {
  const lowerMime = String(mime ?? "").toLowerCase();
  const lowerName = String(fileName ?? "").toLowerCase();

  if (lowerMime.startsWith("image/") || /\.(gif|heic|heif|jpe?g|png|webp)$/u.test(lowerName)) {
    return "image";
  }
  if (lowerMime.startsWith("audio/") || /\.(aac|m4a|mp3|ogg|wav)$/u.test(lowerName)) {
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

function normalizeAttachmentByteSize(
  value: number | null | undefined,
  data: Uint8Array | null,
): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  return data?.byteLength ?? null;
}
