import {
  buildTelegramThreadId,
  extractTelegramMessage,
  minimizeTelegramUpdate,
  summarizeTelegramMessage,
  type TelegramFile,
  type TelegramFileBase,
  type TelegramMessageLike,
  type TelegramPhotoSize,
  type TelegramUpdateLike,
  type TelegramUser,
} from "@murphai/messaging-ingress/telegram-webhook";

import type { ChatMessage } from "../chat/message.ts";
import { createInboundCaptureFromChatMessage } from "../chat/message.ts";
import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";
import { normalizeTextValue, toIsoTimestamp } from "../../shared-runtime.ts";

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
    accountId,
    botUser,
    botUserId,
    downloadDriver,
    message,
    signal,
    source,
    update,
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
    botUser,
    botUserId,
    downloadDriver,
    message,
    signal,
    update,
  });

  return createInboundCaptureFromChatMessage({
    accountId,
    message: chatMessage,
    source,
  });
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
  const summary = summarizeTelegramMessage({
    botUser,
    botUserId,
    message,
  });
  const attachments = await buildTelegramAttachments(message, downloadDriver, signal);

  return {
    externalId: `update:${update.update_id}`,
    thread: {
      id: summary.thread.id,
      title: summary.thread.title,
      isDirect: summary.thread.isDirect,
    },
    actor: {
      id: summary.actor.id,
      displayName: summary.actor.displayName,
      isSelf: summary.actor.isSelf,
    },
    occurredAt: summary.occurredAt,
    receivedAt: message.date ? toIsoTimestamp(message.date * 1000) : null,
    text: summary.text,
    attachments,
    raw: minimizeTelegramUpdate(update),
  };
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
