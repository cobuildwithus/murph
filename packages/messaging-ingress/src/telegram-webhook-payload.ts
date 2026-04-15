/**
 * Owns raw Telegram webhook payload parsing and sparse raw minimization so the
 * public telegram-webhook entrypoint can stay focused on thread targeting and
 * ingress summary behavior.
 */

import {
  compactRecord,
  sanitizeRawMetadata,
} from "./internal.ts";

import type {
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

  return {
    ...record,
    business_message: businessMessage,
    message,
    update_id: updateId,
  } as TelegramUpdateLike;
}

export function minimizeTelegramUpdate(update: TelegramUpdateLike): Record<string, unknown> {
  return sanitizeRawMetadata(
    compactRecord({
      update_id: update.update_id,
      message: pickTelegramMessage(update.message),
      business_message: pickTelegramMessage(update.business_message),
    }),
  ) as Record<string, unknown>;
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
    direct_messages_topic: pickTelegramDirectMessagesTopic(message.direct_messages_topic),
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
      })) ?? undefined,
  });
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
