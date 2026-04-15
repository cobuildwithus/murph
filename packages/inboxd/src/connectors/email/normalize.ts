import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";
import type { ChatMessage } from "../chat/message.ts";
import { createInboundCaptureFromChatMessage } from "../chat/message.ts";
import { normalizeTextValue, sanitizeRawMetadata, toIsoTimestamp } from "../../shared.ts";
import type { AgentmailMessageLike } from "./types.ts";

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


export interface BuildEmailMessageTextInput {
  extractedHtml?: string | null;
  extractedText?: string | null;
  html?: string | null;
  preview?: string | null;
  text?: string | null;
}

export interface InferDirectEmailThreadParticipantsInput {
  accountAddress?: string | null;
  bcc?: ReadonlyArray<string | null | undefined> | null;
  cc?: ReadonlyArray<string | null | undefined> | null;
  from?: string | null;
  selfAddresses?: ReadonlyArray<string | null | undefined> | null;
  to?: ReadonlyArray<string | null | undefined> | null;
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
  return buildEmailMessageText({
    extractedHtml: message.extracted_html ?? null,
    extractedText: message.extracted_text ?? null,
    html: message.html ?? null,
    preview: message.preview ?? null,
    text: message.text ?? null,
  });
}

export function buildEmailMessageText(input: BuildEmailMessageTextInput): string | null {
  return (
    normalizeTextValue(input.extractedText ?? null) ??
    normalizeTextValue(stripHtml(input.extractedHtml ?? null)) ??
    normalizeTextValue(input.text ?? null) ??
    normalizeTextValue(stripHtml(input.html ?? null)) ??
    normalizeTextValue(input.preview ?? null) ??
    null
  );
}

export function inferDirectEmailThread(
  message: AgentmailMessageLike,
  accountAddress: string | null,
): boolean {
  return inferDirectEmailThreadFromParticipants({
    accountAddress,
    bcc: message.bcc ?? [],
    cc: message.cc ?? [],
    from: message.from ?? null,
    to: message.to ?? [],
  });
}

export function inferDirectEmailThreadFromParticipants(
  input: InferDirectEmailThreadParticipantsInput,
): boolean {
  const selfAddresses = resolveEmailParticipantSet([
    input.accountAddress,
    ...(input.selfAddresses ?? []),
  ]);
  const allParticipants = new Set<string>();
  const otherParticipants = new Set<string>();

  const appendParticipant = (value: string | null | undefined) => {
    const normalized = resolveEmailAddress(value ?? null);
    if (!normalized) {
      return;
    }

    const normalizedLower = normalized.toLowerCase();
    allParticipants.add(normalizedLower);

    if (selfAddresses.has(normalizedLower)) {
      return;
    }

    otherParticipants.add(normalizedLower);
  };

  appendParticipant(input.from ?? null);
  for (const value of input.to ?? []) {
    appendParticipant(value);
  }
  for (const value of input.cc ?? []) {
    appendParticipant(value);
  }
  for (const value of input.bcc ?? []) {
    appendParticipant(value);
  }

  if (selfAddresses.size > 0 && otherParticipants.size > 0) {
    return otherParticipants.size <= 1;
  }

  if (selfAddresses.size === 0 && allParticipants.size > 0) {
    return allParticipants.size <= 2;
  }

  const recipientCount = [
    ...(input.to ?? []),
    ...(input.cc ?? []),
    ...(input.bcc ?? []),
  ]
    .map((value) => normalizeTextValue(value ?? null))
    .filter((value): value is string => value !== null).length;

  return recipientCount <= 1;
}

function resolveEmailParticipantSet(
  values: ReadonlyArray<string | null | undefined>,
): Set<string> {
  const participants = new Set<string>();

  for (const value of values) {
    const normalized = resolveEmailAddress(value ?? null);
    if (!normalized) {
      continue;
    }

    participants.add(normalized.toLowerCase());
  }

  return participants;
}

export function resolveAgentmailAddress(
  value: string | null | undefined,
): string | null {
  return resolveEmailAddress(value);
}

export function resolveEmailAddress(
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
  return resolveEmailDisplayName(value);
}

export function resolveEmailDisplayName(
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

export function inferAttachmentKind(
  attachment: {
    content_type?: string | null;
    filename?: string | null;
  },
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
    schema: "murph.email-agentmail-capture.v1",
    timestamp: message.timestamp,
    created_at: message.created_at,
    updated_at: message.updated_at,
    size: message.size,
    label_count: countNormalizedEntries(message.labels),
    to_count: countNormalizedEntries(message.to),
    cc_count: countNormalizedEntries(message.cc),
    bcc_count: countNormalizedEntries(message.bcc),
    reply_to_count: countNormalizedEntries(message.reply_to),
    reference_count: countNormalizedEntries(message.references),
    attachment_count: countArrayEntries(message.attachments),
    has_subject: truthyFlag(message.subject),
    has_preview: truthyFlag(message.preview),
    has_text: truthyFlag(message.text),
    has_html: truthyFlag(message.html),
    has_extracted_text: truthyFlag(message.extracted_text),
    has_extracted_html: truthyFlag(message.extracted_html),
    has_in_reply_to: truthyFlag(message.in_reply_to),
    header_count: countRecordEntries(message.headers),
  })) as Record<string, unknown>;
}

function truthyFlag(value: string | null | undefined): boolean | undefined {
  return normalizeTextValue(value) ? true : undefined;
}

function countNormalizedEntries(
  values: ReadonlyArray<string | null | undefined> | null | undefined,
): number | undefined {
  const count = (values ?? []).filter((value) => normalizeTextValue(value) !== null).length;
  return count > 0 ? count : undefined;
}

function countArrayEntries(
  values: ReadonlyArray<unknown> | null | undefined,
): number | undefined {
  const count = values?.length ?? 0;
  return count > 0 ? count : undefined;
}

function countRecordEntries(
  value: Record<string, unknown> | null | undefined,
): number | undefined {
  const count = value ? Object.keys(value).length : 0;
  return count > 0 ? count : undefined;
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
