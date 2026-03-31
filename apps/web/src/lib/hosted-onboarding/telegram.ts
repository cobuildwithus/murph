import { timingSafeEqual } from "node:crypto";

import {
  extractTelegramMessage,
  toTelegramChatMessage,
  type TelegramMessageLike,
  type TelegramUpdateLike,
} from "@murph/inboxd/telegram";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedTelegramWebhookSummary {
  botUserId: string | null;
  chatType: string | null;
  isBotMessage: boolean;
  isDirect: boolean;
  occurredAt: string;
  senderTelegramUserId: string | null;
}

type HostedTelegramChat = TelegramMessageLike["chat"];
type HostedTelegramContact = Exclude<TelegramMessageLike["contact"], null | undefined>;
type HostedTelegramDirectMessagesTopic = Exclude<
  TelegramMessageLike["direct_messages_topic"],
  null | undefined
>;
type HostedTelegramFileBase = Exclude<TelegramMessageLike["document"], null | undefined>;
type HostedTelegramLocation = Exclude<TelegramMessageLike["location"], null | undefined>;
type HostedTelegramPhotoSize = Exclude<NonNullable<TelegramMessageLike["photo"]>[number], null | undefined>;
type HostedTelegramPoll = Exclude<TelegramMessageLike["poll"], null | undefined>;
type HostedTelegramTextQuote = Exclude<TelegramMessageLike["quote"], null | undefined>;
type HostedTelegramUser = Exclude<TelegramMessageLike["from"], null | undefined>;
type HostedTelegramVenue = Exclude<TelegramMessageLike["venue"], null | undefined>;

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
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
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

  return {
    ...record,
    business_message: businessMessage,
    message,
    update_id: updateId,
  } as TelegramUpdateLike;
}

export async function summarizeHostedTelegramWebhook(
  update: TelegramUpdateLike,
): Promise<HostedTelegramWebhookSummary | null> {
  const message = extractTelegramMessage(update);

  if (!message) {
    return null;
  }

  const botUserId = inferHostedTelegramBotUserId(message);
  const chatMessage = await toTelegramChatMessage({
    botUserId,
    message,
    update,
  });
  const isBotMessage = chatMessage.actor.isSelf;
  const actorId = normalizeNullableString(chatMessage.actor.id ?? null);
  const senderTelegramUserId =
    !isBotMessage && actorId && /^-?\d+$/u.test(actorId)
      ? actorId
      : null;
  const chatType = normalizeNullableString(message.chat?.type ?? null);

  return {
    botUserId,
    chatType,
    isBotMessage,
    isDirect: chatMessage.thread.isDirect === true,
    occurredAt: chatMessage.occurredAt,
    senderTelegramUserId,
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

function inferHostedTelegramBotUserId(message: TelegramMessageLike): string | null {
  if (typeof message.sender_business_bot?.id === "number" && Number.isFinite(message.sender_business_bot.id)) {
    return String(message.sender_business_bot.id);
  }

  if (
    message.from?.is_bot === true
    && typeof message.from.id === "number"
    && Number.isFinite(message.from.id)
  ) {
    return String(message.from.id);
  }

  return null;
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

function validateTelegramChat(value: unknown, label: string): HostedTelegramChat {
  const record = requireTelegramRecord(value, label);
  const id = record.id;

  if (
    (typeof id !== "number" || !Number.isFinite(id)) &&
    typeof id !== "string"
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
  } as HostedTelegramChat;
}

function validateOptionalTelegramChat(value: unknown, label: string): HostedTelegramChat | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  return validateTelegramChat(value, label);
}

function validateOptionalTelegramUser(value: unknown, label: string): HostedTelegramUser | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    first_name: readOptionalTelegramString(record.first_name, `${label}.first_name`),
    id: requireTelegramInteger(record.id, `${label}.id`),
    is_bot: readOptionalTelegramBoolean(record.is_bot, `${label}.is_bot`),
    last_name: readOptionalTelegramString(record.last_name, `${label}.last_name`),
    username: readOptionalTelegramString(record.username, `${label}.username`),
  } as HostedTelegramUser;
}

function validateOptionalTelegramDirectMessagesTopic(
  value: unknown,
  label: string,
): HostedTelegramDirectMessagesTopic | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    title: readOptionalTelegramString(record.title, `${label}.title`),
    topic_id: readOptionalTelegramInteger(record.topic_id, `${label}.topic_id`),
  } as HostedTelegramDirectMessagesTopic;
}

function validateOptionalTelegramTextQuote(
  value: unknown,
  label: string,
): HostedTelegramTextQuote | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    text: readOptionalTelegramString(record.text, `${label}.text`),
  } as HostedTelegramTextQuote;
}

function validateOptionalTelegramPhotoSizes(
  value: unknown,
  label: string,
): HostedTelegramPhotoSize[] | null | undefined {
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
    } as HostedTelegramPhotoSize;
  });
}

function validateOptionalTelegramFileBase(
  value: unknown,
  label: string,
): HostedTelegramFileBase | null | undefined {
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
  } as HostedTelegramFileBase;
}

function validateOptionalTelegramContact(
  value: unknown,
  label: string,
): HostedTelegramContact | null | undefined {
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
  } as HostedTelegramContact;
}

function validateOptionalTelegramLocation(
  value: unknown,
  label: string,
): HostedTelegramLocation | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    latitude: readOptionalTelegramNumber(record.latitude, `${label}.latitude`),
    longitude: readOptionalTelegramNumber(record.longitude, `${label}.longitude`),
  } as HostedTelegramLocation;
}

function validateOptionalTelegramVenue(
  value: unknown,
  label: string,
): HostedTelegramVenue | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  const record = requireTelegramRecord(value, label);

  return {
    ...record,
    address: readOptionalTelegramString(record.address, `${label}.address`),
    location: validateOptionalTelegramLocation(record.location, `${label}.location`),
    title: readOptionalTelegramString(record.title, `${label}.title`),
  } as HostedTelegramVenue;
}

function validateOptionalTelegramPoll(
  value: unknown,
  label: string,
): HostedTelegramPoll | null | undefined {
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
    options: options?.map((entry, index) => {
      const option = requireTelegramRecord(entry, `${label}.options[${index}]`);

      return {
        ...option,
        text: readOptionalTelegramString(option.text, `${label}.options[${index}].text`),
      };
    }),
    question: readOptionalTelegramString(record.question, `${label}.question`),
  } as HostedTelegramPoll;
}

function requireTelegramRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function requireTelegramString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function requireTelegramInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }

  return value as number;
}

function readOptionalTelegramString(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function readOptionalTelegramBoolean(value: unknown, label: string): boolean | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readOptionalTelegramInteger(value: unknown, label: string): number | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }

  return value as number;
}

function readOptionalTelegramNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function timingSafeEquals(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}
