import type { InboundAttachment, InboundCapture } from "../../contracts/capture.js";
import type { ChatMessage } from "../chat/message.js";
import { createInboundCaptureFromChatMessage } from "../chat/message.js";
import { normalizeTextValue, sanitizeRawMetadata, toIsoTimestamp } from "../../shared.js";
import type {
  AgentmailMessageAttachment,
  AgentmailMessageLike,
} from "./types.js";

export interface AgentmailAttachmentDownloadDriver {
  downloadAttachment(input: {
    attachmentId: string;
    messageId: string;
    signal?: AbortSignal;
  }): Promise<Uint8Array | null>;
}

export interface NormalizeAgentmailMessageInput {
  message: AgentmailMessageLike;
  source?: string;
  accountId?: string | null;
  accountAddress?: string | null;
  downloadDriver?: AgentmailAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}

export async function normalizeAgentmailMessage({
  message,
  source = "email",
  accountId = null,
  accountAddress = null,
  downloadDriver = null,
  signal,
}: NormalizeAgentmailMessageInput): Promise<InboundCapture> {
  const normalizedMessage = await toAgentmailChatMessage({
    message,
    accountAddress,
    downloadDriver,
    signal,
  });

  return createInboundCaptureFromChatMessage({
    source,
    accountId,
    message: normalizedMessage,
  });
}

export async function toAgentmailChatMessage(input: {
  message: AgentmailMessageLike;
  accountAddress?: string | null;
  downloadDriver?: AgentmailAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}): Promise<ChatMessage> {
  const { message, accountAddress = null, downloadDriver = null, signal } = input;
  if (!message.message_id) {
    throw new TypeError("AgentMail message is missing a stable message_id.");
  }

  if (!message.thread_id) {
    throw new TypeError("AgentMail message is missing a stable thread_id.");
  }

  const occurredAt = toIsoTimestamp(
    normalizeTextValue(message.timestamp) ?? normalizeTextValue(message.created_at) ?? new Date(),
  );
  const receivedAt = firstTimestamp(message.timestamp, message.created_at);
  const actorId = resolveAgentmailAddress(message.from ?? null);
  const actorDisplayName = resolveAgentmailDisplayName(message.from ?? null);
  const normalizedAccountAddress = resolveAgentmailAddress(accountAddress ?? null);

  return {
    externalId: `email:${message.message_id}`,
    thread: {
      id: message.thread_id,
      title: normalizeTextValue(message.subject ?? null),
      isDirect: inferDirectEmailThread(message, normalizedAccountAddress),
    },
    actor: {
      id: actorId,
      displayName: actorDisplayName,
      isSelf:
        normalizedAccountAddress !== null &&
        actorId !== null &&
        actorId.toLowerCase() === normalizedAccountAddress.toLowerCase(),
    },
    occurredAt,
    receivedAt,
    text: buildAgentmailMessageText(message),
    attachments: await buildAgentmailAttachments(message, downloadDriver, signal),
    raw: sanitizeRawAgentmailMessage(message),
  };
}

export function buildAgentmailMessageText(
  message: AgentmailMessageLike,
): string | null {
  return (
    normalizeTextValue(message.extracted_text ?? null) ??
    normalizeTextValue(stripHtml(message.extracted_html ?? null)) ??
    normalizeTextValue(message.text ?? null) ??
    normalizeTextValue(stripHtml(message.html ?? null)) ??
    normalizeTextValue(message.preview ?? null) ??
    null
  );
}

export function inferDirectEmailThread(
  message: AgentmailMessageLike,
  accountAddress: string | null,
): boolean {
  const allParticipants = new Set<string>();
  const otherParticipants = new Set<string>();

  const appendParticipant = (value: string | null | undefined) => {
    const normalized = resolveAgentmailAddress(value ?? null);
    if (!normalized) {
      return;
    }

    const normalizedLower = normalized.toLowerCase();
    allParticipants.add(normalizedLower);

    if (
      accountAddress !== null &&
      normalizedLower === accountAddress.toLowerCase()
    ) {
      return;
    }

    otherParticipants.add(normalizedLower);
  };

  appendParticipant(message.from ?? null);
  for (const value of message.to ?? []) {
    appendParticipant(value);
  }
  for (const value of message.cc ?? []) {
    appendParticipant(value);
  }
  for (const value of message.bcc ?? []) {
    appendParticipant(value);
  }

  if (accountAddress !== null && otherParticipants.size > 0) {
    return otherParticipants.size <= 1;
  }

  if (accountAddress === null && allParticipants.size > 0) {
    return allParticipants.size <= 2;
  }

  const recipientCount = [
    ...(message.to ?? []),
    ...(message.cc ?? []),
    ...(message.bcc ?? []),
  ]
    .map((value) => normalizeTextValue(value))
    .filter((value): value is string => value !== null).length;

  return recipientCount <= 1;
}

export function resolveAgentmailAddress(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeTextValue(value ?? null);
  if (!normalized) {
    return null;
  }

  const angleMatch = normalized.match(/<([^>]+)>/u);
  const candidate = angleMatch?.[1] ?? normalized;
  const trimmed = candidate.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveAgentmailDisplayName(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeTextValue(value ?? null);
  if (!normalized) {
    return null;
  }

  const angleIndex = normalized.indexOf("<");
  if (angleIndex <= 0) {
    return null;
  }

  const candidate = normalized.slice(0, angleIndex).trim().replace(/^"|"$/gu, "");
  return candidate.length > 0 ? candidate : null;
}

async function buildAgentmailAttachments(
  message: AgentmailMessageLike,
  downloadDriver: AgentmailAttachmentDownloadDriver | null,
  signal?: AbortSignal,
): Promise<InboundAttachment[]> {
  const attachments: InboundAttachment[] = [];

  for (const attachment of message.attachments ?? []) {
    const data =
      downloadDriver && attachment.attachment_id
        ? await downloadDriver.downloadAttachment({
            attachmentId: attachment.attachment_id,
            messageId: message.message_id,
            signal,
          })
        : null;

    attachments.push({
      externalId: attachment.attachment_id ?? null,
      kind: inferAttachmentKind(attachment),
      mime: normalizeTextValue(attachment.content_type ?? null),
      fileName: normalizeTextValue(attachment.filename ?? null),
      byteSize:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? Math.max(0, Math.floor(attachment.size))
          : data?.byteLength ?? null,
      data,
    });
  }

  return attachments;
}

function inferAttachmentKind(
  attachment: AgentmailMessageAttachment,
): InboundAttachment["kind"] {
  const mime = String(attachment.content_type ?? "").toLowerCase();
  const fileName = String(attachment.filename ?? "").toLowerCase();

  if (mime.startsWith("image/") || /\.(gif|heic|heif|jpe?g|png|webp)$/u.test(fileName)) {
    return "image";
  }
  if (mime.startsWith("audio/") || /\.(aac|m4a|mp3|wav)$/u.test(fileName)) {
    return "audio";
  }
  if (mime.startsWith("video/") || /\.(m4v|mov|mp4|webm)$/u.test(fileName)) {
    return "video";
  }
  if (
    mime === "application/pdf" ||
    /\.(csv|docx?|pdf|rtf|txt|xls|xlsx)$/u.test(fileName)
  ) {
    return "document";
  }

  return "other";
}

function sanitizeRawAgentmailMessage(
  message: AgentmailMessageLike,
): Record<string, unknown> {
  return sanitizeRawMetadata(compactRecord({
    inbox_id: message.inbox_id,
    thread_id: message.thread_id,
    message_id: message.message_id,
    labels: message.labels ?? undefined,
    timestamp: message.timestamp,
    from: message.from,
    to: message.to ?? undefined,
    size: message.size,
    updated_at: message.updated_at,
    created_at: message.created_at,
    reply_to: message.reply_to ?? undefined,
    cc: message.cc ?? undefined,
    bcc: message.bcc ?? undefined,
    subject: message.subject,
    preview: message.preview,
    text: message.text,
    html: message.html,
    extracted_text: message.extracted_text,
    extracted_html: message.extracted_html,
    attachments:
      message.attachments?.map((attachment) => pickAttachment(attachment)) ?? undefined,
    in_reply_to: message.in_reply_to,
    references: message.references ?? undefined,
    headers: message.headers ?? undefined,
  })) as Record<string, unknown>;
}

function pickAttachment(
  attachment: AgentmailMessageAttachment,
): Record<string, unknown> {
  return compactRecord({
    attachment_id: attachment.attachment_id,
    size: attachment.size,
    filename: attachment.filename,
    content_type: attachment.content_type,
    content_disposition: attachment.content_disposition,
    content_id: attachment.content_id,
  });
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function firstTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = normalizeTextValue(value ?? null);
    if (!normalized) {
      continue;
    }

    try {
      return toIsoTimestamp(normalized);
    } catch {}
  }

  return null;
}

function stripHtml(value: string | null | undefined): string | null {
  const normalized = normalizeTextValue(value ?? null);
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}
