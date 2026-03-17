import type { ChatMessage } from "../chat/message.js";
import { createInboundCaptureFromChatMessage } from "../chat/message.js";
import type { InboundAttachment, InboundCapture } from "../../contracts/capture.js";
import { mapObjectEntries, normalizeTextValue, sanitizeObjectKey, toIsoTimestamp } from "../../shared.js";
import type {
  TelegramChat,
  TelegramFile,
  TelegramFileBase,
  TelegramMessageLike,
  TelegramPhotoSize,
  TelegramUpdateLike,
  TelegramUser,
} from "./types.js";

export interface TelegramAttachmentDownloadDriver {
  getFile(fileId: string, signal?: AbortSignal): Promise<TelegramFile>;
  downloadFile(filePath: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface NormalizeTelegramUpdateInput {
  update: TelegramUpdateLike;
  source?: string;
  accountId?: string | null;
  botUser?: TelegramUser | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}

export interface NormalizeTelegramMessageInput {
  update: TelegramUpdateLike;
  message: TelegramMessageLike;
  source?: string;
  accountId?: string | null;
  botUser?: TelegramUser | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}

export async function normalizeTelegramUpdate({
  update,
  source = "telegram",
  accountId = "bot",
  botUser = null,
  downloadDriver = null,
  signal,
}: NormalizeTelegramUpdateInput): Promise<InboundCapture> {
  const message = extractTelegramMessage(update);

  if (!message) {
    throw new TypeError("Telegram update does not contain a supported message payload.");
  }

  return normalizeTelegramMessage({
    update,
    message,
    source,
    accountId,
    botUser,
    downloadDriver,
    signal,
  });
}

export async function normalizeTelegramMessage({
  update,
  message,
  source = "telegram",
  accountId = "bot",
  botUser = null,
  downloadDriver = null,
  signal,
}: NormalizeTelegramMessageInput): Promise<InboundCapture> {
  const chatMessage = await toTelegramChatMessage({
    update,
    message,
    botUser,
    downloadDriver,
    signal,
  });

  return createInboundCaptureFromChatMessage({
    source,
    accountId,
    message: chatMessage,
  });
}

export function extractTelegramMessage(update: TelegramUpdateLike): TelegramMessageLike | null {
  return (
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post ??
    update.business_message ??
    update.edited_business_message ??
    null
  );
}

export async function toTelegramChatMessage(input: {
  update: TelegramUpdateLike;
  message: TelegramMessageLike;
  botUser?: TelegramUser | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}): Promise<ChatMessage> {
  const { message, update, botUser = null, downloadDriver = null, signal } = input;
  const actorId = resolveActorId(message);
  const actorDisplayName = resolveActorDisplayName(message);
  const occurredAt = telegramTimestampToIso(message.edit_date ?? message.date ?? nowUnixSeconds());
  const receivedAt = message.date ? telegramTimestampToIso(message.date) : null;
  const attachments = await buildTelegramAttachments(message, downloadDriver, signal);

  return {
    externalId: `update:${update.update_id}`,
    thread: {
      id: buildTelegramThreadId(message),
      title: resolveThreadTitle(message),
      isDirect: message.chat.type === "private",
    },
    actor: {
      id: actorId,
      displayName: actorDisplayName,
      isSelf: isBotActor(message, botUser),
    },
    occurredAt,
    receivedAt,
    text: normalizeTextValue(message.text ?? message.caption ?? null),
    attachments,
    raw: sanitizeRawTelegramUpdate(update),
  };
}

export function buildTelegramThreadId(message: TelegramMessageLike): string {
  const chatId = String(message.chat.id);

  if (message.message_thread_id !== null && message.message_thread_id !== undefined) {
    return `${chatId}:topic:${message.message_thread_id}`;
  }

  return chatId;
}

export function resolveThreadTitle(message: TelegramMessageLike): string | null {
  const chat = message.chat;

  if (chat.type === "private") {
    return displayNameFromChat(chat) ?? resolveActorDisplayName(message);
  }

  return normalizeTextValue(chat.title ?? chat.username ?? null);
}

function resolveActorId(message: TelegramMessageLike): string | null {
  if (message.from?.id !== undefined) {
    return String(message.from.id);
  }

  if (message.sender_chat?.id !== undefined) {
    return `chat:${message.sender_chat.id}`;
  }

  return null;
}

function resolveActorDisplayName(message: TelegramMessageLike): string | null {
  return (
    displayNameFromUser(message.from) ??
    displayNameFromChat(message.sender_chat ?? null) ??
    displayNameFromChat(message.chat) ??
    null
  );
}

function displayNameFromUser(user: TelegramUser | null | undefined): string | null {
  if (!user) {
    return null;
  }

  const parts = [user.first_name, user.last_name]
    .map((part) => normalizeTextValue(part ?? null))
    .filter((value): value is string => value !== null);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return normalizeTextValue(user.username ? `@${user.username}` : null);
}

function displayNameFromChat(chat: TelegramChat | null | undefined): string | null {
  if (!chat) {
    return null;
  }

  const parts = [chat.first_name, chat.last_name]
    .map((part) => normalizeTextValue(part ?? null))
    .filter((value): value is string => value !== null);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return normalizeTextValue(chat.title ?? (chat.username ? `@${chat.username}` : null));
}

function isBotActor(message: TelegramMessageLike, botUser: TelegramUser | null): boolean {
  if (botUser && message.from?.id !== undefined) {
    return message.from.id === botUser.id;
  }

  return Boolean(message.from?.is_bot);
}

async function buildTelegramAttachments(
  message: TelegramMessageLike,
  downloadDriver: TelegramAttachmentDownloadDriver | null,
  signal: AbortSignal | undefined,
): Promise<InboundAttachment[]> {
  const specs = collectAttachmentSpecs(message);
  const attachments: InboundAttachment[] = [];

  for (const spec of specs) {
    attachments.push(await hydrateTelegramAttachment(spec, downloadDriver, signal));
  }

  return attachments;
}

interface TelegramAttachmentSpec {
  file: TelegramFileBase;
  kind: InboundAttachment["kind"];
  mime: string | null;
  fileName: string | null;
}

function collectAttachmentSpecs(message: TelegramMessageLike): TelegramAttachmentSpec[] {
  const specs: TelegramAttachmentSpec[] = [];
  const photo = selectLargestPhoto(message.photo ?? []);

  if (photo) {
    specs.push({
      file: photo,
      kind: "image",
      mime: "image/jpeg",
      fileName: `photo-${photo.file_unique_id ?? photo.file_id}.jpg`,
    });
  }

  if (message.document) {
    specs.push({
      file: message.document,
      kind: inferAttachmentKind(message.document.mime_type ?? null, message.document.file_name ?? null, "document"),
      mime: normalizeTextValue(message.document.mime_type ?? null),
      fileName: normalizeTextValue(message.document.file_name ?? null),
    });
  }

  if (message.audio) {
    specs.push({
      file: message.audio,
      kind: "audio",
      mime: normalizeTextValue(message.audio.mime_type ?? null) ?? "audio/mpeg",
      fileName: normalizeTextValue(message.audio.file_name ?? null) ?? `audio-${message.audio.file_unique_id ?? message.audio.file_id}.bin`,
    });
  }

  if (message.voice) {
    specs.push({
      file: message.voice,
      kind: "audio",
      mime: normalizeTextValue(message.voice.mime_type ?? null) ?? "audio/ogg",
      fileName: normalizeTextValue(message.voice.file_name ?? null) ?? `voice-${message.voice.file_unique_id ?? message.voice.file_id}.ogg`,
    });
  }

  if (message.video) {
    specs.push({
      file: message.video,
      kind: "video",
      mime: normalizeTextValue(message.video.mime_type ?? null) ?? "video/mp4",
      fileName: normalizeTextValue(message.video.file_name ?? null) ?? `video-${message.video.file_unique_id ?? message.video.file_id}.mp4`,
    });
  }

  if (message.video_note) {
    specs.push({
      file: message.video_note,
      kind: "video",
      mime: normalizeTextValue(message.video_note.mime_type ?? null) ?? "video/mp4",
      fileName: normalizeTextValue(message.video_note.file_name ?? null) ?? `video-note-${message.video_note.file_unique_id ?? message.video_note.file_id}.mp4`,
    });
  }

  if (message.animation) {
    specs.push({
      file: message.animation,
      kind: "video",
      mime: normalizeTextValue(message.animation.mime_type ?? null) ?? "video/mp4",
      fileName: normalizeTextValue(message.animation.file_name ?? null) ?? `animation-${message.animation.file_unique_id ?? message.animation.file_id}.mp4`,
    });
  }

  if (message.sticker) {
    specs.push({
      file: message.sticker,
      kind: "image",
      mime: normalizeTextValue(message.sticker.mime_type ?? null),
      fileName: normalizeTextValue(message.sticker.file_name ?? null) ?? `sticker-${message.sticker.file_unique_id ?? message.sticker.file_id}.webp`,
    });
  }

  return specs;
}

async function hydrateTelegramAttachment(
  spec: TelegramAttachmentSpec,
  downloadDriver: TelegramAttachmentDownloadDriver | null,
  signal: AbortSignal | undefined,
): Promise<InboundAttachment> {
  const attachment: InboundAttachment = {
    externalId: spec.file.file_unique_id ?? spec.file.file_id,
    kind: spec.kind,
    mime: spec.mime,
    fileName: spec.fileName,
    byteSize: spec.file.file_size ?? null,
  };

  if (!downloadDriver) {
    return attachment;
  }

  try {
    const file = await downloadDriver.getFile(spec.file.file_id, signal);

    if (!file.file_path) {
      return attachment;
    }

    const data = await downloadDriver.downloadFile(file.file_path, signal);
    return {
      ...attachment,
      data,
      byteSize: attachment.byteSize ?? data.byteLength,
    };
  } catch {
    return attachment;
  }
}

function selectLargestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize | null {
  if (photos.length === 0) {
    return null;
  }

  return [...photos].sort((left, right) => {
    const leftScore = (left.file_size ?? 0) || (left.width ?? 0) * (left.height ?? 0);
    const rightScore = (right.file_size ?? 0) || (right.width ?? 0) * (right.height ?? 0);
    return rightScore - leftScore;
  })[0] ?? null;
}

function telegramTimestampToIso(value: number): string {
  return toIsoTimestamp(value * 1000);
}

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function inferAttachmentKind(
  mime: string | null,
  fileName: string | null,
  fallback: InboundAttachment["kind"],
): InboundAttachment["kind"] {
  const lowerMime = String(mime ?? "").toLowerCase();
  const lowerName = String(fileName ?? "").toLowerCase();

  if (lowerMime.startsWith("image/") || /\.(gif|jpe?g|png|tgs|webp)$/u.test(lowerName)) {
    return "image";
  }

  if (lowerMime.startsWith("audio/") || /\.(aac|m4a|mp3|ogg|wav)$/u.test(lowerName)) {
    return "audio";
  }

  if (lowerMime.startsWith("video/") || /\.(gif|mov|mp4|m4v|webm)$/u.test(lowerName)) {
    return "video";
  }

  if (lowerMime === "application/pdf" || /\.(csv|docx?|pdf|rtf|txt|xls|xlsx)$/u.test(lowerName)) {
    return "document";
  }

  return fallback;
}

function sanitizeRawTelegramUpdate(update: TelegramUpdateLike): Record<string, unknown> {
  return coerceRawValue(update) as Record<string, unknown>;
}

function coerceRawValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => coerceRawValue(entry));
  }

  if (typeof value === "object") {
    return mapObjectEntries(value, (key, entry) => [sanitizeObjectKey(key), coerceRawValue(entry)]);
  }

  return String(value);
}
