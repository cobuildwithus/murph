import { timingSafeEqual } from "node:crypto";

import {
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  type HostedExecutionTelegramMessage,
} from "@murphai/hosted-execution";
import {
  buildTelegramThreadId,
  extractTelegramMessage,
  parseTelegramWebhookUpdate,
  summarizeTelegramUpdate,
  type TelegramFileBase,
  type TelegramPhotoSize,
  type TelegramUpdateLike,
} from "@murphai/messaging-ingress/telegram-webhook";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedTelegramWebhookSummary {
  chatType: string | null;
  isBotMessage: boolean;
  isDirect: boolean;
  occurredAt: string;
  senderTelegramUserId: string | null;
}

export function assertHostedTelegramWebhookSecret(secretToken: string | null): void {
  const expectedSecret = getHostedOnboardingEnvironment().telegramWebhookSecret;

  if (!expectedSecret) {
    throw hostedOnboardingError({
      code: "TELEGRAM_WEBHOOK_SECRET_NOT_CONFIGURED",
      message: "TELEGRAM_WEBHOOK_SECRET must be configured for Telegram webhooks.",
      httpStatus: 500,
    });
  }

  const normalizedSecret = normalizeNullableString(secretToken);

  if (!normalizedSecret) {
    throw hostedOnboardingError({
      code: "TELEGRAM_WEBHOOK_SECRET_REQUIRED",
      message: "Missing Telegram webhook secret header.",
      httpStatus: 401,
    });
  }

  if (!timingSafeEquals(expectedSecret, normalizedSecret)) {
    throw hostedOnboardingError({
      code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
      message: "Invalid Telegram webhook secret.",
      httpStatus: 401,
    });
  }
}

export function parseHostedTelegramWebhookUpdate(rawBody: string): TelegramUpdateLike {
  return parseTelegramWebhookUpdate(rawBody);
}

export function buildHostedTelegramMessagePayload(
  update: TelegramUpdateLike,
): HostedExecutionTelegramMessage | null {
  const message = extractTelegramMessage(update);

  if (!message) {
    return null;
  }

  const attachments = buildHostedTelegramAttachmentPayloads(message);
  const mediaGroupId = normalizeNullableString(message.media_group_id ?? null);
  const text = resolveHostedTelegramMessageText(message);

  return {
    ...(mediaGroupId === null ? {} : { mediaGroupId }),
    ...(attachments.length > 0 ? { attachments } : {}),
    messageId: String(message.message_id),
    schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
    ...(text === null ? {} : { text }),
    threadId: buildTelegramThreadId(message),
  };
}

export async function summarizeHostedTelegramWebhook(
  update: TelegramUpdateLike,
): Promise<HostedTelegramWebhookSummary | null> {
  const summary = summarizeTelegramUpdate({
    inferBotUserIdFromMessage: true,
    update,
  });

  if (!summary) {
    return null;
  }

  return {
    chatType: summary.thread.chatType,
    isBotMessage: summary.actor.isSelf,
    isDirect: summary.thread.isDirect,
    occurredAt: summary.occurredAt,
    senderTelegramUserId: summary.actor.senderTelegramUserId,
  };
}

export function buildHostedTelegramWebhookEventId(update: TelegramUpdateLike): string {
  return `telegram:update:${update.update_id}`;
}

export function buildHostedTelegramBotLink(start: string | null = null): string | null {
  const username = normalizeNullableString(getHostedOnboardingEnvironment().telegramBotUsername);

  if (!username) {
    return null;
  }

  const botUsername = username.startsWith("@") ? username.slice(1) : username;
  const url = new URL(`https://t.me/${botUsername}`);

  if (start && start.trim()) {
    url.searchParams.set("start", start.trim());
  }

  return url.toString();
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function resolveHostedTelegramMessageText(
  message: NonNullable<ReturnType<typeof extractTelegramMessage>>,
): string | null {
  return normalizeNullableString(message.text ?? message.caption ?? null)
    ?? hostedTelegramPlaceholderForMessage(message);
}

function hostedTelegramPlaceholderForMessage(
  message: NonNullable<ReturnType<typeof extractTelegramMessage>>,
): string | null {
  if (message.contact) {
    return "[shared contact]";
  }

  if (message.venue) {
    return "[shared venue]";
  }

  if (message.location) {
    return "[shared location]";
  }

  if (message.poll) {
    return "[shared poll]";
  }

  return null;
}

function buildHostedTelegramAttachmentPayloads(
  message: NonNullable<ReturnType<typeof extractTelegramMessage>>,
): NonNullable<HostedExecutionTelegramMessage["attachments"]> {
  const attachments: NonNullable<HostedExecutionTelegramMessage["attachments"]> = [];
  const largestPhoto = selectHostedTelegramLargestPhoto(message.photo ?? []);

  if (largestPhoto) {
    attachments.push(buildHostedTelegramAttachmentPayload("photo", largestPhoto));
  }

  pushHostedTelegramAttachment(attachments, "document", message.document ?? null);
  pushHostedTelegramAttachment(attachments, "audio", message.audio ?? null);
  pushHostedTelegramAttachment(attachments, "voice", message.voice ?? null);
  pushHostedTelegramAttachment(attachments, "video", message.video ?? null);
  pushHostedTelegramAttachment(attachments, "video_note", message.video_note ?? null);
  pushHostedTelegramAttachment(attachments, "animation", message.animation ?? null);
  pushHostedTelegramAttachment(attachments, "sticker", message.sticker ?? null);

  return attachments;
}

function pushHostedTelegramAttachment(
  attachments: NonNullable<HostedExecutionTelegramMessage["attachments"]>,
  kind: NonNullable<HostedExecutionTelegramMessage["attachments"]>[number]["kind"],
  file: TelegramFileBase | null,
): void {
  if (!file) {
    return;
  }

  attachments.push(buildHostedTelegramAttachmentPayload(kind, file));
}

function buildHostedTelegramAttachmentPayload(
  kind: NonNullable<HostedExecutionTelegramMessage["attachments"]>[number]["kind"],
  file: TelegramFileBase,
): NonNullable<HostedExecutionTelegramMessage["attachments"]>[number] {
  return {
    fileId: file.file_id,
    ...(file.file_name === undefined ? {} : { fileName: normalizeNullableString(file.file_name) }),
    ...(file.file_size === undefined ? {} : { fileSize: file.file_size ?? null }),
    ...(file.file_unique_id === undefined ? {} : { fileUniqueId: normalizeNullableString(file.file_unique_id) }),
    ...(hasHostedTelegramDimension(file.height) ? { height: file.height } : {}),
    kind,
    ...(file.mime_type === undefined ? {} : { mimeType: normalizeNullableString(file.mime_type) }),
    ...(hasHostedTelegramDimension(file.width) ? { width: file.width } : {}),
  };
}

function selectHostedTelegramLargestPhoto(
  photos: TelegramPhotoSize[],
): TelegramPhotoSize | null {
  if (photos.length === 0) {
    return null;
  }

  return [...photos].sort((left, right) => {
    const leftScore = (left.file_size ?? 0) || (left.width ?? 0) * (left.height ?? 0);
    const rightScore = (right.file_size ?? 0) || (right.width ?? 0) * (right.height ?? 0);
    return rightScore - leftScore;
  })[0] ?? null;
}

function hasHostedTelegramDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
