import {
  compactRecord,
  normalizeTextValue,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "./internal.ts";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  [key: string]: unknown;
}

export interface TelegramChat {
  id: number | string;
  type?: "private" | "group" | "supergroup" | "channel" | string;
  title?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_direct_messages?: boolean | null;
  [key: string]: unknown;
}

export interface TelegramFileBase {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
  [key: string]: unknown;
}

export interface TelegramPhotoSize extends TelegramFileBase {
  width?: number;
  height?: number;
}

export interface TelegramDirectMessagesTopic {
  topic_id?: number | null;
  title?: string | null;
  [key: string]: unknown;
}

export interface TelegramContact {
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  user_id?: number | null;
  vcard?: string | null;
  [key: string]: unknown;
}

export interface TelegramLocation {
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

export interface TelegramVenue {
  title?: string | null;
  address?: string | null;
  location?: TelegramLocation | null;
  [key: string]: unknown;
}

export interface TelegramPollOption {
  text?: string | null;
  [key: string]: unknown;
}

export interface TelegramPoll {
  question?: string | null;
  options?: TelegramPollOption[] | null;
  [key: string]: unknown;
}

export interface TelegramTextQuote {
  text?: string | null;
  [key: string]: unknown;
}

export interface TelegramMessageLike {
  message_id: number;
  date?: number | null;
  edit_date?: number | null;
  business_connection_id?: string | null;
  direct_messages_topic?: TelegramDirectMessagesTopic | null;
  media_group_id?: string | null;
  message_thread_id?: number | null;
  text?: string | null;
  caption?: string | null;
  chat: TelegramChat;
  from?: TelegramUser | null;
  sender_chat?: TelegramChat | null;
  sender_business_bot?: TelegramUser | null;
  reply_to_message?: TelegramMessageLike | null;
  quote?: TelegramTextQuote | null;
  photo?: TelegramPhotoSize[] | null;
  document?: TelegramFileBase | null;
  audio?: TelegramFileBase | null;
  voice?: TelegramFileBase | null;
  video?: TelegramFileBase | null;
  video_note?: TelegramFileBase | null;
  animation?: TelegramFileBase | null;
  sticker?: TelegramFileBase | null;
  contact?: TelegramContact | null;
  location?: TelegramLocation | null;
  venue?: TelegramVenue | null;
  poll?: TelegramPoll | null;
  [key: string]: unknown;
}

export interface TelegramUpdateLike {
  update_id: number;
  message?: TelegramMessageLike;
  business_message?: TelegramMessageLike;
  [key: string]: unknown;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
  [key: string]: unknown;
}

export interface TelegramWebhookInfo {
  url?: string;
  pending_update_count?: number;
  [key: string]: unknown;
}

export interface TelegramThreadTarget {
  chatId: string;
  messageThreadId?: number | null;
  businessConnectionId?: string | null;
  directMessagesTopicId?: number | null;
}

export interface TelegramIngressSummary {
  actor: {
    displayName: string | null;
    id: string | null;
    isSelf: boolean;
    senderTelegramUserId: string | null;
  };
  botUserId: string | null;
  occurredAt: string;
  text: string | null;
  thread: {
    chatType: string | null;
    id: string;
    isDirect: boolean;
    title: string | null;
  };
}

export function parseTelegramThreadTarget(target: string): TelegramThreadTarget | null {
  const normalized = normalizeTextValue(target);
  if (!normalized) {
    return null;
  }

  const segments = normalized.split(":");
  const chatId = segments.shift();
  if (!chatId) {
    return null;
  }

  const parsed: TelegramThreadTarget = { chatId };

  while (segments.length > 0) {
    const key = segments.shift();
    const value = segments.shift();
    if (!key || value === undefined) {
      return null;
    }

    if (key === "topic") {
      const topicId = parseTelegramPositiveInteger(value);
      if (
        topicId === null ||
        parsed.messageThreadId != null ||
        parsed.directMessagesTopicId != null
      ) {
        return null;
      }
      parsed.messageThreadId = topicId;
      continue;
    }

    if (key === "business") {
      const businessConnectionId = safeDecodeURIComponent(value);
      if (!businessConnectionId || parsed.businessConnectionId != null) {
        return null;
      }
      parsed.businessConnectionId = businessConnectionId;
      continue;
    }

    if (key === "dm-topic") {
      const directMessagesTopicId = parseTelegramPositiveInteger(value);
      if (
        directMessagesTopicId === null ||
        parsed.directMessagesTopicId != null ||
        parsed.messageThreadId != null
      ) {
        return null;
      }
      parsed.directMessagesTopicId = directMessagesTopicId;
      continue;
    }

    return null;
  }

  return parsed;
}

export function serializeTelegramThreadTarget(input: TelegramThreadTarget): string {
  const segments = [input.chatId];

  if (input.businessConnectionId) {
    segments.push("business", encodeURIComponent(input.businessConnectionId));
  }

  if (input.messageThreadId) {
    segments.push("topic", String(input.messageThreadId));
  }

  if (input.directMessagesTopicId) {
    segments.push("dm-topic", String(input.directMessagesTopicId));
  }

  return segments.join(":");
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

export function extractTelegramMessage(update: TelegramUpdateLike): TelegramMessageLike | null {
  return update.message ?? update.business_message ?? null;
}

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

export function summarizeTelegramUpdate(input: {
  update: TelegramUpdateLike;
  botUser?: TelegramUser | null;
  botUserId?: string | null;
  inferBotUserIdFromMessage?: boolean;
}): TelegramIngressSummary | null {
  const message = extractTelegramMessage(input.update);

  if (!message) {
    return null;
  }

  return summarizeTelegramMessage({
    botUser: input.botUser,
    botUserId: input.botUserId,
    inferBotUserIdFromMessage: input.inferBotUserIdFromMessage,
    message,
  });
}

export function summarizeTelegramMessage(input: {
  botUser?: TelegramUser | null;
  botUserId?: string | null;
  inferBotUserIdFromMessage?: boolean;
  message: TelegramMessageLike;
}): TelegramIngressSummary {
  const resolvedBotUserId = resolveTelegramBotUserId({
    botUser: input.botUser ?? null,
    botUserId: input.botUserId ?? null,
    inferFromMessage: input.inferBotUserIdFromMessage === true,
    message: input.message,
  });
  const actorId = resolveActorId(input.message);
  const isSelf = isBotActor(input.message, resolvedBotUserId);
  const senderTelegramUserId =
    !isSelf && actorId && /^-?\d+$/u.test(actorId)
      ? actorId
      : null;

  return {
    actor: {
      displayName: resolveActorDisplayName(input.message),
      id: actorId,
      isSelf,
      senderTelegramUserId,
    },
    botUserId: resolvedBotUserId,
    occurredAt: telegramTimestampToIso(input.message.edit_date ?? input.message.date ?? nowUnixSeconds()),
    text: buildTelegramMessageText(input.message),
    thread: {
      chatType: normalizeTextValue(input.message.chat?.type ?? null),
      id: buildTelegramThreadId(input.message),
      isDirect: isTelegramDirectThread(input.message),
      title: resolveThreadTitle(input.message),
    },
  };
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

function resolveThreadTitle(message: TelegramMessageLike): string | null {
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
  inferFromMessage: boolean;
  message: TelegramMessageLike;
}): string | null {
  if (input.botUserId) {
    return input.botUserId;
  }

  if (input.botUser?.id !== undefined) {
    return String(input.botUser.id);
  }

  if (input.inferFromMessage) {
    return inferTelegramBotUserId(input.message);
  }

  return null;
}

function inferTelegramBotUserId(message: TelegramMessageLike): string | null {
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

function telegramTimestampToIso(value: number): string {
  return toIsoTimestamp(value * 1000);
}

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
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

function normalizeTelegramPositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseTelegramPositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return normalizeTextValue(decodeURIComponent(value));
  } catch {
    return null;
  }
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
