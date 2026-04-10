import {
  buildTelegramThreadId,
  extractTelegramMessage,
  summarizeTelegramMessage,
  type TelegramFile,
  type TelegramFileBase,
  type TelegramMessageLike,
  type TelegramPhotoSize,
  type TelegramUpdateLike,
  type TelegramUser,
} from "@murphai/messaging-ingress/telegram-webhook";
import { minimizeTelegramUpdate } from "@murphai/messaging-ingress/telegram-webhook-payload";

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

export interface HostedTelegramAttachmentInput {
  fileId: string;
  fileName?: string | null;
  fileSize?: number | null;
  fileUniqueId?: string | null;
  height?: number | null;
  kind: "animation" | "audio" | "document" | "photo" | "sticker" | "video" | "video_note" | "voice";
  mimeType?: string | null;
  width?: number | null;
}

export interface NormalizeHostedTelegramMessageInput {
  accountId?: string | null;
  downloadDriver?: TelegramAttachmentDownloadDriver | null;
  externalId: string;
  message: {
    attachments?: HostedTelegramAttachmentInput[];
    mediaGroupId?: string | null;
    messageId: string;
    text?: string | null;
    threadId: string;
  };
  occurredAt: string;
  receivedAt?: string | null;
  signal?: AbortSignal;
  source?: string;
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

export async function normalizeHostedTelegramMessage({
  accountId = "bot",
  downloadDriver = null,
  externalId,
  message,
  occurredAt,
  receivedAt = null,
  signal,
  source = "telegram",
}: NormalizeHostedTelegramMessageInput): Promise<InboundCapture> {
  const attachments = await buildHostedTelegramAttachments(
    message.attachments ?? [],
    downloadDriver,
    signal,
  );

  return createInboundCaptureFromChatMessage({
    accountId,
    message: {
      actor: {
        id: null,
        displayName: null,
        isSelf: false,
      },
      attachments,
      externalId,
      occurredAt,
      raw: buildHostedTelegramRawMetadata(message),
      receivedAt,
      text: normalizeTextValue(message.text ?? null),
      thread: {
        id: message.threadId,
        isDirect: true,
        title: null,
      },
    },
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

async function buildHostedTelegramAttachments(
  attachments: readonly HostedTelegramAttachmentInput[],
  downloadDriver: TelegramAttachmentDownloadDriver | null,
  signal: AbortSignal | undefined,
): Promise<InboundAttachment[]> {
  const normalized: InboundAttachment[] = [];

  for (const attachment of attachments) {
    normalized.push(await hydrateHostedTelegramAttachment(attachment, downloadDriver, signal));
  }

  return normalized;
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

async function hydrateHostedTelegramAttachment(
  attachment: HostedTelegramAttachmentInput,
  downloadDriver: TelegramAttachmentDownloadDriver | null,
  signal: AbortSignal | undefined,
): Promise<InboundAttachment> {
  const spec = buildHostedTelegramAttachmentSpec(attachment);
  return hydrateTelegramAttachment(spec, downloadDriver, signal);
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

function buildHostedTelegramAttachmentSpec(
  attachment: HostedTelegramAttachmentInput,
): TelegramAttachmentSpec {
  switch (attachment.kind) {
    case "photo":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `photo-${attachment.fileUniqueId ?? attachment.fileId}.jpg`,
        kind: "image",
        mime: normalizeTextValue(attachment.mimeType ?? null) ?? "image/jpeg",
      };
    case "document":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null),
        kind: inferAttachmentKind(
          normalizeTextValue(attachment.mimeType ?? null),
          normalizeTextValue(attachment.fileName ?? null),
          "document",
        ),
        mime: normalizeTextValue(attachment.mimeType ?? null),
      };
    case "audio":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `audio-${attachment.fileUniqueId ?? attachment.fileId}.bin`,
        kind: "audio",
        mime: normalizeTextValue(attachment.mimeType ?? null) ?? "audio/mpeg",
      };
    case "voice":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `voice-${attachment.fileUniqueId ?? attachment.fileId}.ogg`,
        kind: "audio",
        mime: normalizeTextValue(attachment.mimeType ?? null) ?? "audio/ogg",
      };
    case "video":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `video-${attachment.fileUniqueId ?? attachment.fileId}.mp4`,
        kind: "video",
        mime: normalizeTextValue(attachment.mimeType ?? null) ?? "video/mp4",
      };
    case "video_note":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `video-note-${attachment.fileUniqueId ?? attachment.fileId}.mp4`,
        kind: "video",
        mime: normalizeTextValue(attachment.mimeType ?? null) ?? "video/mp4",
      };
    case "animation":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `animation-${attachment.fileUniqueId ?? attachment.fileId}.mp4`,
        kind: "video",
        mime: normalizeTextValue(attachment.mimeType ?? null) ?? "video/mp4",
      };
    case "sticker":
      return {
        file: toHostedTelegramFileBase(attachment),
        fileName: normalizeTextValue(attachment.fileName ?? null)
          ?? `sticker-${attachment.fileUniqueId ?? attachment.fileId}.webp`,
        kind: "image",
        mime: normalizeTextValue(attachment.mimeType ?? null),
      };
  }
}

function toHostedTelegramFileBase(
  attachment: HostedTelegramAttachmentInput,
): TelegramFileBase {
  const fileName = normalizeTextValue(attachment.fileName ?? null);
  const fileSize =
    typeof attachment.fileSize === "number" && Number.isFinite(attachment.fileSize)
      ? attachment.fileSize
      : undefined;
  const fileUniqueId = normalizeTextValue(attachment.fileUniqueId ?? null);
  const height =
    typeof attachment.height === "number" && Number.isFinite(attachment.height)
      ? attachment.height
      : undefined;
  const mimeType = normalizeTextValue(attachment.mimeType ?? null);
  const width =
    typeof attachment.width === "number" && Number.isFinite(attachment.width)
      ? attachment.width
      : undefined;

  return {
    file_id: attachment.fileId,
    ...(fileName === null ? {} : { file_name: fileName }),
    ...(fileSize === undefined ? {} : { file_size: fileSize }),
    ...(fileUniqueId === null ? {} : { file_unique_id: fileUniqueId }),
    ...(height === undefined ? {} : { height }),
    ...(mimeType === null ? {} : { mime_type: mimeType }),
    ...(width === undefined ? {} : { width }),
  };
}

function buildHostedTelegramRawMetadata(
  message: NormalizeHostedTelegramMessageInput["message"],
): Record<string, unknown> {
  return {
    message_id: message.messageId,
    ...(typeof message.mediaGroupId === "string" ? { media_group_id: message.mediaGroupId } : {}),
    schema: "murph.telegram-capture.v1",
  };
}
