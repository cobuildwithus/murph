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
import {
  buildTelegramCaptureRawMetadata,
  minimizeTelegramUpdate,
} from "@murphai/messaging-ingress/telegram-webhook-payload";

import type { ChatMessage } from "../chat/message.ts";
import { createInboundCaptureFromChatMessage } from "../chat/message.ts";
import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";
import { normalizeTextValue, toIsoTimestamp } from "../../shared-runtime.ts";

const TELEGRAM_ATTACHMENT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

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
    replyContextPreview?: string | null;
    replyToMessageId?: string;
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

type DefaultTelegramAttachmentKind = Exclude<HostedTelegramAttachmentInput["kind"], "document">;

const TELEGRAM_ATTACHMENT_DEFAULTS: Record<DefaultTelegramAttachmentKind, {
  kind: InboundAttachment["kind"];
  mime: string | null;
  prefix: string;
  extension: string;
}> = {
  photo: { kind: "image", mime: "image/jpeg", prefix: "photo", extension: "jpg" },
  audio: { kind: "audio", mime: "audio/mpeg", prefix: "audio", extension: "bin" },
  voice: { kind: "audio", mime: "audio/ogg", prefix: "voice", extension: "ogg" },
  video: { kind: "video", mime: "video/mp4", prefix: "video", extension: "mp4" },
  video_note: { kind: "video", mime: "video/mp4", prefix: "video-note", extension: "mp4" },
  animation: { kind: "video", mime: "video/mp4", prefix: "animation", extension: "mp4" },
  sticker: { kind: "image", mime: null, prefix: "sticker", extension: "webp" },
};

function buildDefaultTelegramAttachmentSpec(
  file: TelegramFileBase,
  kind: DefaultTelegramAttachmentKind,
  fileNameId = file.file_unique_id ?? file.file_id,
): TelegramAttachmentSpec {
  const defaults = TELEGRAM_ATTACHMENT_DEFAULTS[kind];
  return {
    file,
    kind: defaults.kind,
    mime: normalizeTextValue(file.mime_type ?? null) ?? defaults.mime,
    fileName: normalizeTextValue(file.file_name ?? null)
      ?? `${defaults.prefix}-${fileNameId}.${defaults.extension}`,
  };
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
    // Native document inference deliberately uses the untrimmed provider fields.
    specs.push({
      file: message.document,
      kind: inferAttachmentKind(message.document.mime_type ?? null, message.document.file_name ?? null, "document"),
      mime: normalizeTextValue(message.document.mime_type ?? null),
      fileName: normalizeTextValue(message.document.file_name ?? null),
    });
  }

  for (const kind of ["audio", "voice", "video", "video_note", "animation", "sticker"] as const) {
    const file = message[kind];
    if (file) {
      specs.push(buildDefaultTelegramAttachmentSpec(file, kind));
    }
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
  if (isKnownOversizedTelegramFile(spec.file)) {
    return attachment;
  }

  try {
    const file = await downloadDriver.getFile(spec.file.file_id, signal);

    if (!file.file_path || isKnownOversizedTelegramFile(file)) {
      return attachment;
    }

    const data = await downloadDriver.downloadFile(file.file_path, signal);
    return {
      ...attachment,
      data,
      byteSize: attachment.byteSize ?? data.byteLength,
    };
  } catch (error) {
    if (isTelegramAttachmentHydrationAbortError(error, signal)) {
      throw error;
    }
    return attachment;
  }
}

function isKnownOversizedTelegramFile(file: TelegramFileBase): boolean {
  return typeof file.file_size === "number"
    && Number.isSafeInteger(file.file_size)
    && file.file_size > TELEGRAM_ATTACHMENT_DOWNLOAD_MAX_BYTES;
}

function isTelegramAttachmentHydrationAbortError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return signal?.aborted === true
    || (
      error instanceof DOMException
      && error.name === "AbortError"
    )
    || (
      error instanceof Error
      && error.name === "AbortError"
    );
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
  const file = toHostedTelegramFileBase(attachment);
  if (attachment.kind === "document") {
    const mime = file.mime_type ?? null;
    const fileName = file.file_name ?? null;
    return {
      file,
      fileName,
      kind: inferAttachmentKind(mime, fileName, "document"),
      mime,
    };
  }

  // Names use the original nullish ID, not the normalized external identity.
  return buildDefaultTelegramAttachmentSpec(
    file,
    attachment.kind,
    attachment.fileUniqueId ?? attachment.fileId,
  );
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
  return buildTelegramCaptureRawMetadata({
    mediaGroupId: message.mediaGroupId ?? null,
    messageId: message.messageId,
    replyContextPreview: message.replyContextPreview ?? null,
    replyToMessageId: message.replyToMessageId ?? null,
  });
}
