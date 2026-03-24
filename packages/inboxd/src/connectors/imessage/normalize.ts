import type { InboundAttachment, InboundCapture } from "../../contracts/capture.js";
import { normalizeTextValue, sanitizeRawMetadata, toIsoTimestamp } from "../../shared.js";

export interface ImessageKitAttachmentLike {
  guid?: string | null;
  id?: string | null;
  filename?: string | null;
  fileName?: string | null;
  path?: string | null;
  data?: Uint8Array | null;
  transferName?: string | null;
  mimeType?: string | null;
  mime?: string | null;
  type?: string | null;
  size?: number | null;
  byteSize?: number | null;
  [key: string]: unknown;
}

export interface ImessageKitMessageLike {
  guid?: string | null;
  id?: string | null;
  text?: string | null;
  message?: string | null;
  attributedBody?: string | null;
  date?: string | number | Date | null;
  dateDelivered?: string | number | Date | null;
  dateReceived?: string | number | Date | null;
  dateRead?: string | number | Date | null;
  chatGuid?: string | null;
  chatId?: string | null;
  handleId?: string | null;
  sender?: string | null;
  from?: string | null;
  displayName?: string | null;
  senderName?: string | null;
  isFromMe?: boolean | null;
  fromMe?: boolean | null;
  attachments?: ImessageKitAttachmentLike[] | null;
  [key: string]: unknown;
}

export interface ImessageKitChatLike {
  guid?: string | null;
  chatGuid?: string | null;
  id?: string | null;
  displayName?: string | null;
  title?: string | null;
  isGroup?: boolean | null;
  participants?: Array<{ id?: string | null } | string> | null;
  participantCount?: number | null;
  [key: string]: unknown;
}

export interface NormalizeImessageInput {
  message: ImessageKitMessageLike;
  source?: string;
  accountId?: string | null;
  chat?: ImessageKitChatLike | null;
}

export function normalizeImessageAttachment(
  attachment: ImessageKitAttachmentLike,
): InboundAttachment {
  const fileName = attachment.fileName ?? attachment.filename ?? attachment.transferName ?? null;
  const mime = attachment.mime ?? attachment.mimeType ?? null;
  const originalPath = attachment.path ?? null;

  return {
    externalId: attachment.guid ?? attachment.id ?? null,
    kind: inferAttachmentKind(mime, fileName, attachment.type ?? null),
    mime,
    originalPath,
    fileName,
    byteSize: attachment.byteSize ?? attachment.size ?? null,
    data: attachment.data ?? null,
  };
}

export function normalizeImessageMessage({
  message,
  source = "imessage",
  accountId = "self",
  chat = null,
}: NormalizeImessageInput): InboundCapture {
  const externalId = message.guid ?? message.id;
  const threadId = message.chatGuid ?? message.chatId ?? chat?.guid ?? chat?.chatGuid ?? chat?.id;

  if (!externalId) {
    throw new TypeError("iMessage message is missing a stable external id.");
  }

  if (!threadId) {
    throw new TypeError("iMessage message is missing a stable thread id.");
  }

  const occurredAt = toIsoTimestamp(message.date ?? new Date());
  const actorId = message.handleId ?? message.sender ?? message.from ?? null;
  const actorName = message.displayName ?? message.senderName ?? null;
  const attachments = (message.attachments ?? []).map(normalizeImessageAttachment);
  const text = normalizeTextValue(message.text ?? message.message ?? message.attributedBody ?? null);
  const isSelf = message.isFromMe ?? message.fromMe ?? false;

  return {
    source,
    externalId,
    accountId,
    thread: {
      id: threadId,
      title: chat?.displayName ?? chat?.title ?? null,
      isDirect: inferDirectChat(chat),
    },
    actor: {
      id: actorId,
      displayName: actorName,
      isSelf: Boolean(isSelf),
    },
    occurredAt,
    receivedAt: firstTimestamp(message.dateReceived, message.dateDelivered),
    text,
    attachments,
    raw: sanitizeRawMessage(message),
  };
}

function inferDirectChat(chat: ImessageKitChatLike | null): boolean {
  if (!chat) {
    return true;
  }

  if (typeof chat.isGroup === "boolean") {
    return !chat.isGroup;
  }

  if (Array.isArray(chat.participants)) {
    return chat.participants.length <= 2;
  }

  if (typeof chat.participantCount === "number") {
    return chat.participantCount <= 2;
  }

  return true;
}

function firstTimestamp(...values: Array<Date | string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }

    try {
      return toIsoTimestamp(value);
    } catch {
      continue;
    }
  }

  return null;
}

function inferAttachmentKind(
  mime: string | null,
  fileName: string | null,
  type: string | null,
): InboundAttachment["kind"] {
  const lowerMime = String(mime ?? "").toLowerCase();
  const lowerType = String(type ?? "").toLowerCase();
  const lowerName = String(fileName ?? "").toLowerCase();

  if (lowerMime.startsWith("image/") || /\.(heic|heif|gif|jpe?g|png|webp)$/u.test(lowerName)) {
    return "image";
  }

  if (lowerMime.startsWith("audio/") || /\.(aac|m4a|mp3|wav)$/u.test(lowerName)) {
    return "audio";
  }

  if (lowerMime.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/u.test(lowerName)) {
    return "video";
  }

  if (
    lowerMime === "application/pdf" ||
    /\.(csv|docx?|pdf|rtf|txt|xls|xlsx)$/u.test(lowerName) ||
    lowerType.includes("document")
  ) {
    return "document";
  }

  return "other";
}

function sanitizeRawMessage(message: ImessageKitMessageLike): Record<string, unknown> {
  return sanitizeRawMetadata(compactRecord({
    guid: message.guid,
    id: message.id,
    text: message.text,
    message: message.message,
    attributed_body: message.attributedBody,
    date: message.date,
    date_delivered: message.dateDelivered,
    date_received: message.dateReceived,
    date_read: message.dateRead,
    chat_guid: message.chatGuid,
    chat_id: message.chatId,
    handle_id: message.handleId,
    sender: message.sender,
    from: message.from,
    display_name: message.displayName,
    sender_name: message.senderName,
    is_from_me: message.isFromMe,
    from_me: message.fromMe,
    attachments:
      message.attachments?.map((attachment) => pickImessageAttachment(attachment)) ??
      message.attachments ??
      undefined,
  })) as Record<string, unknown>;
}

function pickImessageAttachment(
  attachment: ImessageKitAttachmentLike,
): Record<string, unknown> {
  return compactRecord({
    guid: attachment.guid,
    id: attachment.id,
    filename: attachment.filename,
    file_name: attachment.fileName,
    path: attachment.path,
    transfer_name: attachment.transferName,
    mime_type: attachment.mimeType,
    mime: attachment.mime,
    type: attachment.type,
    size: attachment.size,
    byte_size: attachment.byteSize,
  });
}

function compactRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}
