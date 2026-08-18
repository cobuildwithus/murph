/**
 * Owns Telegram webhook secret-token verification, already-authenticated
 * payload parsing, and sparse raw minimization so the public telegram-webhook
 * entrypoint can stay focused on thread targeting and ingress summary
 * behavior.
 */

import { timingSafeEqual } from "node:crypto";

import {
  compactRecord,
  normalizeTextValue,
  sanitizeRawMetadata,
} from "./internal.ts";

import type {
  TelegramCallbackQueryLike,
  TelegramCallbackQueryMessageLike,
  TelegramChat,
  TelegramContact,
  TelegramDirectMessagesTopic,
  TelegramFileBase,
  TelegramLocation,
  TelegramMessageLike,
  TelegramPhotoSize,
  TelegramPoll,
  TelegramPollOption,
  TelegramTextQuote,
  TelegramUpdateLike,
  TelegramUser,
  TelegramVenue,
} from "./telegram-types.ts";

const TELEGRAM_CAPTURE_RAW_SCHEMA = "murph.telegram-capture.v1";
const TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT = 240;
const TELEGRAM_SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";

type TelegramWebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export function readTelegramWebhookHeader(
  headers: TelegramWebhookHeaders,
  name: string,
): string | null {
  return normalizeTextValue(readTelegramWebhookRawHeader(headers, name));
}

export function readTelegramWebhookSecretToken(
  headers: TelegramWebhookHeaders,
): string | null {
  return readTelegramWebhookRawHeader(headers, TELEGRAM_SECRET_TOKEN_HEADER);
}

export function assertTelegramWebhookSecretToken(input: {
  secretToken: string | null | undefined;
  webhookSecret: string | null | undefined;
}): void {
  const expectedSecret =
    typeof input.webhookSecret === "string" && input.webhookSecret.length > 0
      ? input.webhookSecret
      : null;

  if (!expectedSecret) {
    throw new TypeError("Telegram webhook secret is required.");
  }

  const providedSecret =
    typeof input.secretToken === "string" && input.secretToken.length > 0
      ? input.secretToken
      : null;
  if (!providedSecret || !timingSafeEquals(expectedSecret, providedSecret)) {
    throw new TypeError("Invalid Telegram webhook secret token.");
  }
}

export function verifyAndParseTelegramWebhookRequest(input: {
  headers: TelegramWebhookHeaders;
  rawBody: Buffer | Uint8Array | ArrayBuffer | string;
  webhookSecret: string | null | undefined;
}): TelegramUpdateLike {
  assertTelegramWebhookSecretToken({
    secretToken: readTelegramWebhookSecretToken(input.headers),
    webhookSecret: input.webhookSecret,
  });

  return parseTelegramWebhookUpdate(normalizeTelegramWebhookRawBody(input.rawBody));
}

/**
 * Parses an already-authenticated Telegram webhook update.
 * Use `verifyAndParseTelegramWebhookRequest()` for raw inbound webhooks.
 */
export function parseTelegramWebhookUpdate(rawBody: string): TelegramUpdateLike {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    throw new TypeError(
      `Telegram webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Telegram webhook payload must be a JSON object.");
  }

  const record = payload as Record<string, unknown>;
  const updateId = requireTelegramInteger(record.update_id, "update_id");
  const message = validateOptionalTelegramMessage(record.message, "message");
  const businessMessage = validateOptionalTelegramMessage(record.business_message, "business_message");
  const callbackQuery = validateOptionalTelegramCallbackQuery(record.callback_query, "callback_query");

  return {
    ...record,
    business_message: businessMessage,
    callback_query: callbackQuery,
    message,
    update_id: updateId,
  } as TelegramUpdateLike;
}

function validateOptionalTelegramCallbackQuery(
  value: unknown,
  label: string,
): TelegramCallbackQueryLike | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireTelegramRecord(value, label);
  const id = readOptionalTelegramString(record.id, `${label}.id`);

  if (!id) {
    throw new TypeError(`${label}.id must be a non-empty string.`);
  }

  return {
    ...record,
    data: readOptionalTelegramString(record.data, `${label}.data`),
    from: requireTelegramUser(record.from, `${label}.from`),
    id,
    inline_message_id: readOptionalTelegramString(
      record.inline_message_id,
      `${label}.inline_message_id`,
    ),
    message: validateOptionalTelegramCallbackQueryMessage(
      record.message,
      `${label}.message`,
    ),
  } as TelegramCallbackQueryLike;
}

function validateOptionalTelegramCallbackQueryMessage(
  value: unknown,
  label: string,
): TelegramCallbackQueryMessageLike | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    chat: validateTelegramChat(record.chat, `${label}.chat`),
    message_id: requireTelegramInteger(record.message_id, `${label}.message_id`),
  } as TelegramCallbackQueryMessageLike;
}

export function buildTelegramCaptureRawMetadata(input: {
  mediaGroupId?: string | null;
  messageId: number | string | null | undefined;
  replyContextPreview?: string | null;
  replyToMessageId?: number | string | null;
}): Record<string, unknown> {
  const normalizedPreview = normalizeTelegramReplyContextPreview(
    input.replyContextPreview ?? null,
  );
  return sanitizeRawMetadata(
    compactRecord({
      media_group_id: normalizeTextValue(input.mediaGroupId ?? null) ?? undefined,
      message_id: normalizeTelegramCaptureMessageId(input.messageId),
      reply_context_preview: normalizedPreview ?? undefined,
      reply_to_message_id: normalizeTelegramCaptureMessageId(
        input.replyToMessageId,
      ),
      schema: TELEGRAM_CAPTURE_RAW_SCHEMA,
    }),
  ) as Record<string, unknown>;
}

export function minimizeTelegramUpdate(update: TelegramUpdateLike): Record<string, unknown> {
  const message = update.message ?? update.business_message ?? null;

  return buildTelegramCaptureRawMetadata({
    mediaGroupId: message?.media_group_id ?? null,
    messageId: message?.message_id,
    replyContextPreview: buildTelegramReplyContextPreview(message),
    replyToMessageId: message?.reply_to_message?.message_id,
  });
}

function normalizeTelegramWebhookRawBody(
  value: Buffer | Uint8Array | ArrayBuffer | string,
): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }

  return Buffer.from(value).toString("utf8");
}

function readTelegramWebhookRawHeader(
  headers: TelegramWebhookHeaders,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }

  const matchedKey = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  if (!matchedKey) {
    return null;
  }

  const rawValue = headers[matchedKey];
  if (Array.isArray(rawValue)) {
    return rawValue.find((value) => typeof value === "string") ?? null;
  }

  return typeof rawValue === "string" ? rawValue : null;
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeTelegramCaptureMessageId(
  value: number | string | null | undefined,
): number | string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = normalizeTextValue(value);
    return normalized && /^\d+$/u.test(normalized) ? normalized : undefined;
  }

  return undefined;
}

function normalizeTelegramReplyContextPreview(value: string | null): string | null {
  const normalized = normalizeTextValue(value);
  if (!normalized) {
    return null;
  }

  return normalized.length > TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT
    ? `${normalized.slice(0, TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT - 3)}...`
    : normalized;
}

export function buildTelegramReplyContextPreview(
  message: TelegramMessageLike | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const lines: string[] = [];
  const replyPreview = summarizeTelegramReplyTarget(message.reply_to_message);
  if (replyPreview) {
    lines.push(`Replying to: ${replyPreview}`);
  } else if (message.reply_to_message) {
    lines.push("Replying to an earlier Telegram message");
  }

  const quotePreview = normalizeTextValue(message.quote?.text ?? null);
  if (quotePreview) {
    lines.push(`Quoted text: ${summarizeTelegramPreviewText(quotePreview)}`);
  }

  return lines.length > 0
    ? normalizeTelegramReplyContextPreview(lines.join("\n"))
    : null;
}

function summarizeTelegramReplyTarget(
  message: TelegramMessageLike | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const textPreview = normalizeTextValue(message.text ?? message.caption ?? null);
  if (textPreview) {
    return summarizeTelegramPreviewText(textPreview);
  }

  if (message.contact) {
    return "Shared contact card";
  }

  const venuePreview = buildTelegramVenuePreview(message.venue);
  if (venuePreview) {
    return venuePreview;
  }

  if (hasCompleteTelegramLocation(message.location)) {
    return "Shared location";
  }

  const pollPreview = buildTelegramPollPreview(message.poll);
  if (pollPreview) {
    return pollPreview;
  }

  return null;
}

function buildTelegramVenuePreview(
  venue: TelegramVenue | null | undefined,
): string | null {
  if (!venue) {
    return null;
  }

  const title = normalizeTextValue(venue.title ?? null);
  return title ? `Shared venue ${summarizeTelegramPreviewText(title)}` : "Shared venue";
}

function hasCompleteTelegramLocation(
  location: TelegramLocation | null | undefined,
): boolean {
  return (
    typeof location?.latitude === "number"
    && Number.isFinite(location.latitude)
    && typeof location.longitude === "number"
    && Number.isFinite(location.longitude)
  );
}

function buildTelegramPollPreview(
  poll: TelegramPoll | null | undefined,
): string | null {
  if (!poll) {
    return null;
  }

  const question = normalizeTextValue(poll.question ?? null);
  const options = (poll.options ?? [])
    .map((option) => normalizeTextValue(option.text ?? null))
    .filter((value): value is string => value !== null)
    .map((value) => summarizeTelegramPreviewText(value));

  if (!question && options.length === 0) {
    return null;
  }

  const questionPreview = summarizeTelegramPreviewText(question ?? "untitled poll");
  return options.length > 0
    ? `Poll ${questionPreview} [${options.join(" | ")}]`
    : `Poll ${questionPreview}`;
}

function summarizeTelegramPreviewText(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length > TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT
    ? `${normalized.slice(0, TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT - 3)}...`
    : normalized;
}

function requireTelegramRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function requireTelegramString(value: unknown, label: string): string {
  const normalized = readOptionalTelegramString(value, label);

  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function requireTelegramInteger(value: unknown, label: string): number {
  const normalized = readOptionalTelegramInteger(value, label);

  if (normalized === null) {
    throw new TypeError(`${label} must be an integer.`);
  }

  return normalized;
}

function readOptionalTelegramString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function readOptionalTelegramBoolean(value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readOptionalTelegramInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }

  return value as number;
}

function readOptionalTelegramNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function validateOptionalTelegramMessage(
  value: unknown,
  label: string,
): TelegramMessageLike | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    animation: validateOptionalTelegramFileBase(record.animation, `${label}.animation`),
    audio: validateOptionalTelegramFileBase(record.audio, `${label}.audio`),
    business_connection_id: readOptionalTelegramString(record.business_connection_id, `${label}.business_connection_id`),
    caption: readOptionalTelegramString(record.caption, `${label}.caption`),
    chat: validateTelegramChat(record.chat, `${label}.chat`),
    contact: validateOptionalTelegramContact(record.contact, `${label}.contact`),
    date: readOptionalTelegramInteger(record.date, `${label}.date`),
    direct_messages_topic: validateOptionalTelegramDirectMessagesTopic(
      record.direct_messages_topic,
      `${label}.direct_messages_topic`,
    ),
    document: validateOptionalTelegramFileBase(record.document, `${label}.document`),
    edit_date: readOptionalTelegramInteger(record.edit_date, `${label}.edit_date`),
    from: validateOptionalTelegramUser(record.from, `${label}.from`),
    location: validateOptionalTelegramLocation(record.location, `${label}.location`),
    media_group_id: readOptionalTelegramString(record.media_group_id, `${label}.media_group_id`),
    message_id: requireTelegramInteger(record.message_id, `${label}.message_id`),
    message_thread_id: readOptionalTelegramInteger(record.message_thread_id, `${label}.message_thread_id`),
    photo: validateOptionalTelegramPhotoSizes(record.photo, `${label}.photo`),
    poll: validateOptionalTelegramPoll(record.poll, `${label}.poll`),
    quote: validateOptionalTelegramTextQuote(record.quote, `${label}.quote`),
    reply_to_message: validateOptionalTelegramMessage(record.reply_to_message, `${label}.reply_to_message`),
    sender_business_bot: validateOptionalTelegramUser(record.sender_business_bot, `${label}.sender_business_bot`),
    sender_chat: validateOptionalTelegramChat(record.sender_chat, `${label}.sender_chat`),
    sticker: validateOptionalTelegramFileBase(record.sticker, `${label}.sticker`),
    text: readOptionalTelegramString(record.text, `${label}.text`),
    venue: validateOptionalTelegramVenue(record.venue, `${label}.venue`),
    video: validateOptionalTelegramFileBase(record.video, `${label}.video`),
    video_note: validateOptionalTelegramFileBase(record.video_note, `${label}.video_note`),
    voice: validateOptionalTelegramFileBase(record.voice, `${label}.voice`),
  } as TelegramMessageLike;
}

function validateTelegramChat(value: unknown, label: string): TelegramChat {
  const record = requireTelegramRecord(value, label);
  const id = record.id;

  if (
    (typeof id !== "number" || !Number.isFinite(id))
    && typeof id !== "string"
  ) {
    throw new TypeError(`${label}.id must be a string or finite number.`);
  }

  return {
    ...record,
    first_name: readOptionalTelegramString(record.first_name, `${label}.first_name`),
    id,
    is_direct_messages: readOptionalTelegramBoolean(record.is_direct_messages, `${label}.is_direct_messages`),
    last_name: readOptionalTelegramString(record.last_name, `${label}.last_name`),
    title: readOptionalTelegramString(record.title, `${label}.title`),
    type: readOptionalTelegramString(record.type, `${label}.type`),
    username: readOptionalTelegramString(record.username, `${label}.username`),
  } as TelegramChat;
}

function validateOptionalTelegramChat(value: unknown, label: string): TelegramChat | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  return validateTelegramChat(value, label);
}

function requireTelegramUser(value: unknown, label: string): TelegramUser {
  const user = validateOptionalTelegramUser(value, label);

  if (!user) {
    throw new TypeError(`${label} must be an object.`);
  }

  return user;
}

function validateOptionalTelegramUser(value: unknown, label: string): TelegramUser | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    first_name: readOptionalTelegramString(record.first_name, `${label}.first_name`),
    id: requireTelegramInteger(record.id, `${label}.id`),
    is_bot: readOptionalTelegramBoolean(record.is_bot, `${label}.is_bot`) ?? undefined,
    last_name: readOptionalTelegramString(record.last_name, `${label}.last_name`),
    username: readOptionalTelegramString(record.username, `${label}.username`),
  } as TelegramUser;
}

function validateOptionalTelegramDirectMessagesTopic(
  value: unknown,
  label: string,
): TelegramDirectMessagesTopic | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    title: readOptionalTelegramString(record.title, `${label}.title`),
    topic_id: readOptionalTelegramInteger(record.topic_id, `${label}.topic_id`),
  } as TelegramDirectMessagesTopic;
}

function validateOptionalTelegramTextQuote(
  value: unknown,
  label: string,
): TelegramTextQuote | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    text: readOptionalTelegramString(record.text, `${label}.text`),
  } as TelegramTextQuote;
}

function validateOptionalTelegramPhotoSizes(
  value: unknown,
  label: string,
): TelegramPhotoSize[] | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    const base = validateOptionalTelegramFileBase(entry, `${label}[${index}]`);

    if (!base) {
      throw new TypeError(`${label}[${index}] must be a JSON object.`);
    }

    const record = base as Record<string, unknown>;

    return {
      ...record,
      file_id: base.file_id,
      file_name: base.file_name,
      file_size: base.file_size,
      file_unique_id: base.file_unique_id,
      height: readOptionalTelegramInteger(record.height, `${label}[${index}].height`),
      mime_type: base.mime_type,
      width: readOptionalTelegramInteger(record.width, `${label}[${index}].width`),
    } as TelegramPhotoSize;
  });
}

function validateOptionalTelegramFileBase(
  value: unknown,
  label: string,
): TelegramFileBase | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    file_id: requireTelegramString(record.file_id, `${label}.file_id`),
    file_name: readOptionalTelegramString(record.file_name, `${label}.file_name`),
    file_size: readOptionalTelegramInteger(record.file_size, `${label}.file_size`),
    file_unique_id: readOptionalTelegramString(record.file_unique_id, `${label}.file_unique_id`),
    mime_type: readOptionalTelegramString(record.mime_type, `${label}.mime_type`),
  } as TelegramFileBase;
}

function validateOptionalTelegramContact(
  value: unknown,
  label: string,
): TelegramContact | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    first_name: readOptionalTelegramString(record.first_name, `${label}.first_name`),
    last_name: readOptionalTelegramString(record.last_name, `${label}.last_name`),
    phone_number: readOptionalTelegramString(record.phone_number, `${label}.phone_number`),
    user_id: readOptionalTelegramInteger(record.user_id, `${label}.user_id`),
    vcard: readOptionalTelegramString(record.vcard, `${label}.vcard`),
  } as TelegramContact;
}

function validateOptionalTelegramLocation(
  value: unknown,
  label: string,
): TelegramLocation | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    latitude: readOptionalTelegramNumber(record.latitude, `${label}.latitude`),
    longitude: readOptionalTelegramNumber(record.longitude, `${label}.longitude`),
  } as TelegramLocation;
}

function validateOptionalTelegramVenue(value: unknown, label: string): TelegramVenue | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    address: readOptionalTelegramString(record.address, `${label}.address`),
    location: validateOptionalTelegramLocation(record.location, `${label}.location`),
    title: readOptionalTelegramString(record.title, `${label}.title`),
  } as TelegramVenue;
}

function validateOptionalTelegramPoll(value: unknown, label: string): TelegramPoll | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);
  const options = record.options;

  if (options !== undefined && options !== null && !Array.isArray(options)) {
    throw new TypeError(`${label}.options must be an array.`);
  }

  return {
    ...record,
    options: Array.isArray(options)
      ? options.map((option, index) => {
          const optionRecord = requireTelegramRecord(option, `${label}.options[${index}]`);
          return {
            ...optionRecord,
            text: readOptionalTelegramString(optionRecord.text, `${label}.options[${index}].text`),
          } as TelegramPollOption;
        })
      : (options as TelegramPollOption[] | null | undefined),
    question: readOptionalTelegramString(record.question, `${label}.question`),
  } as TelegramPoll;
}
