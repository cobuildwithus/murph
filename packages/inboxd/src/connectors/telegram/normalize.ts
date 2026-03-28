import type { ChatMessage } from "../chat/message.ts";
import { createInboundCaptureFromChatMessage } from "../chat/message.ts";
import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";
import { normalizeTextValue, sanitizeRawMetadata, toIsoTimestamp } from "../../shared.ts";
import type {
  TelegramChat,
  TelegramContact,
  TelegramDirectMessagesTopic,
  TelegramFile,
  TelegramFileBase,
  TelegramLocation,
  TelegramMessageLike,
  TelegramPoll,
  TelegramPhotoSize,
  TelegramTextQuote,
  TelegramUpdateLike,
  TelegramUser,
  TelegramVenue,
} from "./types.ts";
import {
  serializeTelegramThreadTarget,
  type TelegramThreadTarget,
} from "./target.ts";

export interface TelegramAttachmentDownloadDriver {
  getFile(fileId: string, signal?: AbortSignal): Promise<TelegramFile>;
  downloadFile(filePath: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface NormalizeTelegramUpdateInput {
  update: TelegramUpdateLike;
  source?: string;
  accountId?: string | null;
  botUser?: TelegramUser | null;
  botUserId?: string | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}

export interface NormalizeTelegramMessageInput {
  update: TelegramUpdateLike;
  message: TelegramMessageLike;
  source?: string;
  accountId?: string | null;
  botUser?: TelegramUser | null;
  botUserId?: string | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}

export async function normalizeTelegramUpdate({
  update,
  source = "telegram",
  accountId = "bot",
  botUser = null,
  botUserId = null,
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
    botUserId,
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
  botUserId = null,
  downloadDriver = null,
  signal,
}: NormalizeTelegramMessageInput): Promise<InboundCapture> {
  const chatMessage = await toTelegramChatMessage({
    update,
    message,
    botUser,
    botUserId,
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
    update.business_message ??
    null
  );
}

export async function toTelegramChatMessage(input: {
  update: TelegramUpdateLike;
  message: TelegramMessageLike;
  botUser?: TelegramUser | null;
  botUserId?: string | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  signal?: AbortSignal;
}): Promise<ChatMessage> {
  const {
    message,
    update,
    botUser = null,
    botUserId = null,
    downloadDriver = null,
    signal,
  } = input;
  const actorId = resolveActorId(message);
  const actorDisplayName = resolveActorDisplayName(message);
  const occurredAt = telegramTimestampToIso(message.edit_date ?? message.date ?? nowUnixSeconds());
  const receivedAt = message.date ? telegramTimestampToIso(message.date) : null;
  const attachments = await buildTelegramAttachments(message, downloadDriver, signal);
  const resolvedBotUserId = resolveTelegramBotUserId({
    botUser,
    botUserId,
  });

  return {
    externalId: `update:${update.update_id}`,
    thread: {
      id: buildTelegramThreadId(message),
      title: resolveThreadTitle(message),
      isDirect: isTelegramDirectThread(message),
    },
    actor: {
      id: actorId,
      displayName: actorDisplayName,
      isSelf: isBotActor(message, resolvedBotUserId),
    },
    occurredAt,
    receivedAt,
    text: buildTelegramMessageText(message),
    attachments,
    raw: sanitizeRawTelegramUpdate(update),
  };
}

export function buildTelegramThreadTarget(message: TelegramMessageLike): TelegramThreadTarget {
  return {
    businessConnectionId: normalizeTextValue(message.business_connection_id ?? null),
    chatId: String(message.chat.id),
    directMessagesTopicId: normalizeTelegramPositiveInteger(
      message.direct_messages_topic?.topic_id,
    ),
    messageThreadId: normalizeTelegramPositiveInteger(message.message_thread_id),
  };
}

export function buildTelegramThreadId(message: TelegramMessageLike): string {
  return serializeTelegramThreadTarget(buildTelegramThreadTarget(message));
}

export function resolveThreadTitle(message: TelegramMessageLike): string | null {
  const chat = message.chat;
  const baseTitle =
    chat.type === "private"
      ? displayNameFromChat(chat) ?? resolveActorDisplayName(message)
      : normalizeTextValue(chat.title ?? chat.username ?? null);
  const directMessagesTopicTitle = normalizeTextValue(
    message.direct_messages_topic?.title ?? null,
  );

  if (directMessagesTopicTitle) {
    return baseTitle ? `${baseTitle} / ${directMessagesTopicTitle}` : directMessagesTopicTitle;
  }

  return baseTitle;
}

function isTelegramDirectThread(message: TelegramMessageLike): boolean {
  return message.chat.type === "private" || message.chat.is_direct_messages === true;
}

function buildTelegramMessageText(message: TelegramMessageLike): string | null {
  return (
    normalizeTextValue(message.text ?? message.caption ?? null) ??
    formatTelegramContact(message.contact) ??
    formatTelegramVenue(message.venue) ??
    formatTelegramLocation(message.location) ??
    formatTelegramPoll(message.poll) ??
    null
  );
}

function formatTelegramContact(contact: TelegramContact | null | undefined): string | null {
  if (!contact) {
    return null;
  }

  const name = [contact.first_name, contact.last_name]
    .map((part) => normalizeTextValue(part ?? null))
    .filter((value): value is string => value !== null)
    .join(" ");
  const phoneNumber = normalizeTextValue(contact.phone_number ?? null);

  if (!name && !phoneNumber) {
    return null;
  }

  return phoneNumber ? `Shared contact: ${name || "unknown"} (${phoneNumber})` : `Shared contact: ${name}`;
}

function formatTelegramLocation(location: TelegramLocation | null | undefined): string | null {
  if (!location) {
    return null;
  }

  const latitude = typeof location.latitude === "number" ? location.latitude : null;
  const longitude = typeof location.longitude === "number" ? location.longitude : null;
  if (latitude === null || longitude === null) {
    return null;
  }

  return `Shared location: ${latitude}, ${longitude}`;
}

function formatTelegramVenue(venue: TelegramVenue | null | undefined): string | null {
  if (!venue) {
    return null;
  }

  const title = normalizeTextValue(venue.title ?? null);
  const address = normalizeTextValue(venue.address ?? null);
  const location = formatTelegramLocation(venue.location ?? null);
  const parts = [title, address, location].filter((value): value is string => value !== null);

  if (parts.length === 0) {
    return null;
  }

  return `Shared venue: ${parts.join(" | ")}`;
}

function formatTelegramPoll(poll: TelegramPoll | null | undefined): string | null {
  if (!poll) {
    return null;
  }

  const question = normalizeTextValue(poll.question ?? null);
  const options = (poll.options ?? [])
    .map((option) => normalizeTextValue(option.text ?? null))
    .filter((value): value is string => value !== null);

  if (!question && options.length === 0) {
    return null;
  }

  const detail = options.length > 0 ? ` [${options.join(" | ")}]` : "";
  return `Shared poll: ${question ?? "untitled poll"}${detail}`;
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

function isBotActor(message: TelegramMessageLike, botUserId: string | null): boolean {
  if (botUserId) {
    if (message.sender_business_bot?.id !== undefined) {
      return String(message.sender_business_bot.id) === botUserId;
    }

    if (message.from?.id !== undefined) {
      return String(message.from.id) === botUserId;
    }

    return false;
  }

  return message.sender_business_bot?.is_bot === true;
}

function resolveTelegramBotUserId(input: {
  botUser: TelegramUser | null;
  botUserId: string | null;
}): string | null {
  if (input.botUserId) {
    return input.botUserId;
  }

  if (input.botUser?.id !== undefined) {
    return String(input.botUser.id);
  }

  return null;
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
  return sanitizeRawMetadata(compactRecord({
    update_id: update.update_id,
    message: pickTelegramMessage(update.message),
    business_message: pickTelegramMessage(update.business_message),
  })) as Record<string, unknown>;
}

function pickTelegramMessage(
  message: TelegramMessageLike | null | undefined,
): Record<string, unknown> | null {
  if (!message) {
    return null;
  }

  return compactRecord({
    message_id: message.message_id,
    date: message.date,
    edit_date: message.edit_date,
    business_connection_id: message.business_connection_id,
    direct_messages_topic: pickTelegramDirectMessagesTopic(message.direct_messages_topic),
    media_group_id: message.media_group_id,
    message_thread_id: message.message_thread_id,
    text: message.text,
    caption: message.caption,
    chat: pickTelegramChat(message.chat),
    from: pickTelegramUser(message.from),
    sender_chat: pickTelegramChat(message.sender_chat),
    sender_business_bot: pickTelegramUser(message.sender_business_bot),
    reply_to_message: pickTelegramReplyMessage(message.reply_to_message),
    quote: pickTelegramQuote(message.quote),
    photo: message.photo?.map((photo) => pickTelegramPhotoSize(photo)) ?? message.photo ?? undefined,
    document: pickTelegramFile(message.document),
    audio: pickTelegramFile(message.audio),
    voice: pickTelegramFile(message.voice),
    video: pickTelegramFile(message.video),
    video_note: pickTelegramFile(message.video_note),
    animation: pickTelegramFile(message.animation),
    sticker: pickTelegramFile(message.sticker),
    contact: pickTelegramContact(message.contact),
    location: pickTelegramLocation(message.location),
    venue: pickTelegramVenue(message.venue),
    poll: pickTelegramPoll(message.poll),
  });
}

function pickTelegramChat(chat: TelegramChat | null | undefined): Record<string, unknown> | null {
  if (!chat) {
    return null;
  }

  return compactRecord({
    id: chat.id,
    type: chat.type,
    title: chat.title,
    username: chat.username,
    first_name: chat.first_name,
    last_name: chat.last_name,
    is_direct_messages: chat.is_direct_messages,
  });
}

function pickTelegramUser(user: TelegramUser | null | undefined): Record<string, unknown> | null {
  if (!user) {
    return null;
  }

  return compactRecord({
    id: user.id,
    is_bot: user.is_bot,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
  });
}

function pickTelegramPhotoSize(photo: TelegramPhotoSize): Record<string, unknown> {
  return compactRecord({
    file_id: photo.file_id,
    file_unique_id: photo.file_unique_id,
    file_size: photo.file_size,
    file_name: photo.file_name,
    mime_type: photo.mime_type,
    width: photo.width,
    height: photo.height,
  });
}

function pickTelegramFile(file: TelegramFileBase | null | undefined): Record<string, unknown> | null {
  if (!file) {
    return null;
  }

  return compactRecord({
    file_id: file.file_id,
    file_unique_id: file.file_unique_id,
    file_size: file.file_size,
    file_name: file.file_name,
    mime_type: file.mime_type,
  });
}

function pickTelegramDirectMessagesTopic(
  topic: TelegramDirectMessagesTopic | null | undefined,
): Record<string, unknown> | null {
  if (!topic) {
    return null;
  }

  return compactRecord({
    topic_id: topic.topic_id,
    title: topic.title,
  });
}

function pickTelegramReplyMessage(
  message: TelegramMessageLike | null | undefined,
): Record<string, unknown> | null {
  if (!message) {
    return null;
  }

  return compactRecord({
    message_id: message.message_id,
    date: message.date,
    business_connection_id: message.business_connection_id,
    media_group_id: message.media_group_id,
    message_thread_id: message.message_thread_id,
    text: message.text,
    caption: message.caption,
    chat: pickTelegramChat(message.chat),
    from: pickTelegramUser(message.from),
    sender_chat: pickTelegramChat(message.sender_chat),
    sender_business_bot: pickTelegramUser(message.sender_business_bot),
    quote: pickTelegramQuote(message.quote),
    contact: pickTelegramContact(message.contact),
    location: pickTelegramLocation(message.location),
    venue: pickTelegramVenue(message.venue),
    poll: pickTelegramPoll(message.poll),
  });
}

function pickTelegramQuote(
  quote: TelegramTextQuote | null | undefined,
): Record<string, unknown> | null {
  if (!quote) {
    return null;
  }

  return compactRecord({
    text: quote.text,
  });
}

function pickTelegramContact(
  contact: TelegramContact | null | undefined,
): Record<string, unknown> | null {
  if (!contact) {
    return null;
  }

  return compactRecord({
    first_name: contact.first_name,
    last_name: contact.last_name,
    phone_number: contact.phone_number,
    user_id: contact.user_id,
    vcard: contact.vcard,
  });
}

function pickTelegramLocation(
  location: TelegramLocation | null | undefined,
): Record<string, unknown> | null {
  if (!location) {
    return null;
  }

  return compactRecord({
    latitude: location.latitude,
    longitude: location.longitude,
  });
}

function pickTelegramVenue(
  venue: TelegramVenue | null | undefined,
): Record<string, unknown> | null {
  if (!venue) {
    return null;
  }

  return compactRecord({
    title: venue.title,
    address: venue.address,
    location: pickTelegramLocation(venue.location),
  });
}

function pickTelegramPoll(
  poll: TelegramPoll | null | undefined,
): Record<string, unknown> | null {
  if (!poll) {
    return null;
  }

  return compactRecord({
    question: poll.question,
    options: poll.options?.map((option) =>
      compactRecord({
        text: option.text,
      }),
    ) ?? undefined,
  });
}

function normalizeTelegramPositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function compactRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}
