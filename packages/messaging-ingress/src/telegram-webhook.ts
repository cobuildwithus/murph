import {
  normalizeTextValue,
  toIsoTimestamp,
} from "./internal.ts";
import type {
  TelegramChat,
  TelegramContact,
  TelegramLocation,
  TelegramMessageLike,
  TelegramPoll,
  TelegramUpdateLike,
  TelegramUser,
  TelegramVenue,
} from "./telegram-types.ts";

export type {
  TelegramChat,
  TelegramContact,
  TelegramDirectMessagesTopic,
  TelegramFile,
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
  TelegramWebhookInfo,
} from "./telegram-types.ts";

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
  const normalized = normalizeTelegramThreadTarget(input);
  const segments = [normalized.chatId];

  if (normalized.businessConnectionId) {
    segments.push("business", encodeURIComponent(normalized.businessConnectionId));
  }

  if (normalized.messageThreadId) {
    segments.push("topic", String(normalized.messageThreadId));
  }

  if (normalized.directMessagesTopicId) {
    segments.push("dm-topic", String(normalized.directMessagesTopicId));
  }

  return segments.join(":");
}

export function buildTelegramThreadTarget(message: TelegramMessageLike): TelegramThreadTarget {
  return normalizeTelegramThreadTarget({
    businessConnectionId: normalizeTextValue(message.business_connection_id ?? null),
    chatId: String(message.chat.id),
    directMessagesTopicId: normalizeTelegramPositiveInteger(
      message.direct_messages_topic?.topic_id,
    ),
    messageThreadId: normalizeTelegramPositiveInteger(message.message_thread_id),
  });
}

export function buildTelegramThreadId(message: TelegramMessageLike): string {
  return serializeTelegramThreadTarget(buildTelegramThreadTarget(message));
}

export function extractTelegramMessage(update: TelegramUpdateLike): TelegramMessageLike | null {
  return update.message ?? update.business_message ?? null;
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

function normalizeTelegramPositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeTelegramThreadTarget(input: TelegramThreadTarget): TelegramThreadTarget {
  const directMessagesTopicId = normalizeTelegramPositiveInteger(input.directMessagesTopicId);

  return {
    businessConnectionId: normalizeTextValue(input.businessConnectionId ?? null),
    chatId: input.chatId,
    directMessagesTopicId,
    messageThreadId:
      directMessagesTopicId === null
        ? normalizeTelegramPositiveInteger(input.messageThreadId)
        : null,
  };
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
