import { normalizePhoneNumber } from "./phone";

import {
  createHostedOpaqueIdentifier,
  normalizeHostedEmailAddress,
  normalizeHostedOpaqueInput,
  readHostedPhoneHint,
} from "./contact-privacy-core";

const HOSTED_LINQ_ATTACHMENT_CDN_HOST = "cdn.linqapp.com";

export function sanitizeHostedLinqEventForStorage(
  value: Record<string, unknown>,
  options: {
    omitRecipientPhone?: boolean;
    preserveFrom?: boolean;
  } = {},
): Record<string, unknown> {
  const clone = cloneHostedJsonRecord(value);
  const data = toHostedRecord(clone.data);

  if (!data) {
    return clone;
  }

  const from = normalizeHostedOpaqueInput(data.from);

  if (from && !options.preserveFrom) {
    data.from = createHostedOpaqueIdentifier("linq.from", normalizePhoneNumber(from) ?? from);
  }

  sanitizeHostedLinqHandleRecord(toHostedRecord(data.from_handle), "linq.from");
  sanitizeHostedLinqHandleRecord(toHostedRecord(data.sender_handle), "linq.from");
  sanitizeHostedLinqHandleRecord(toHostedRecord(data.recipient_handle), "linq.recipient");

  const recipientPhone = normalizeHostedOpaqueInput(data.recipient_phone);

  if (recipientPhone) {
    data.recipient_phone = createHostedOpaqueIdentifier(
      "linq.recipient",
      normalizePhoneNumber(recipientPhone) ?? recipientPhone,
    );
  }

  const chat = toHostedRecord(data.chat);

  if (chat) {
    sanitizeHostedLinqHandleRecord(toHostedRecord(chat.owner_handle), "linq.recipient");
  }

  if (options.omitRecipientPhone) {
    delete data.recipient_phone;
  }

  const message = toHostedRecord(data.message);

  if (message) {
    const messageId = normalizeHostedOpaqueInput(message.id);

    if (messageId) {
      message.id = createHostedOpaqueIdentifier("linq.message", messageId);
    }

    if (Array.isArray(message.parts)) {
      message.parts = message.parts.map((part) => sanitizeHostedLinqMessagePart(part));
    }

    const replyTo = toHostedRecord(message.reply_to);

    if (replyTo) {
      const replyToId = normalizeHostedOpaqueInput(replyTo.message_id);

      if (replyToId) {
        replyTo.message_id = createHostedOpaqueIdentifier("linq.message", replyToId);
      }
    }
  }

  return clone;
}

export function sanitizeHostedTelegramUpdateForStorage(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeHostedTelegramValue(cloneHostedJsonRecord(value)) as Record<string, unknown>;
}

export function sanitizeHostedStripeObjectForStorage(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeHostedStripeValue(cloneHostedJsonRecord(value)) as Record<string, unknown>;
}

function sanitizeHostedStripeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeHostedStripeValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (isHostedStripeEmailKey(key) && typeof entry === "string") {
        const normalizedEmail = normalizeHostedEmailAddress(entry) ?? entry.trim().toLowerCase();
        return [key, createHostedOpaqueIdentifier("stripe.email", normalizedEmail)];
      }

      if (isHostedStripePhoneKey(key) && typeof entry === "string") {
        return [key, readHostedPhoneHint(entry)];
      }

      return [key, sanitizeHostedStripeValue(entry)];
    }),
  ) as Record<string, unknown>;
}

function isHostedStripeEmailKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized === "email" || normalized.endsWith("_email");
}

function isHostedStripePhoneKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized === "phone" || normalized === "phone_number" || normalized.endsWith("_phone");
}

function sanitizeHostedTelegramValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeHostedTelegramValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sanitizeHostedTelegramValue(entry),
    ]),
  ) as Record<string, unknown>;

  if (looksLikeHostedTelegramChatRecord(record)) {
    record.first_name = null;
    record.last_name = null;
    record.title = null;
    record.username = null;
    return record;
  }

  if (looksLikeHostedTelegramUserRecord(record)) {
    const id = normalizeHostedOpaqueInput(record.id);

    if (id) {
      record.id = createHostedOpaqueIdentifier("telegram.user", id);
    }

    record.first_name = null;
    record.last_name = null;
    record.username = null;
    return record;
  }

  if (looksLikeHostedTelegramContactRecord(record)) {
    const userId = normalizeHostedOpaqueInput(record.user_id);

    if (userId) {
      record.user_id = createHostedOpaqueIdentifier("telegram.user", userId);
    }

    if (typeof record.phone_number === "string") {
      record.phone_number = readHostedPhoneHint(record.phone_number);
    }

    record.first_name = null;
    record.last_name = null;
    record.vcard = null;
    return record;
  }

  const userId = normalizeHostedOpaqueInput(record.user_id);

  if (userId) {
    record.user_id = createHostedOpaqueIdentifier("telegram.user", userId);
  }

  if (typeof record.phone_number === "string") {
    record.phone_number = readHostedPhoneHint(record.phone_number);
  }

  return record;
}

function looksLikeHostedTelegramUserRecord(record: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(record, "id")
    && (
      Object.prototype.hasOwnProperty.call(record, "is_bot")
      || Object.prototype.hasOwnProperty.call(record, "first_name")
      || Object.prototype.hasOwnProperty.call(record, "last_name")
      || Object.prototype.hasOwnProperty.call(record, "username")
    );
}

function looksLikeHostedTelegramChatRecord(record: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(record, "id")
    && (
      Object.prototype.hasOwnProperty.call(record, "type")
      || Object.prototype.hasOwnProperty.call(record, "title")
      || Object.prototype.hasOwnProperty.call(record, "is_direct_messages")
    );
}

function looksLikeHostedTelegramContactRecord(record: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(record, "phone_number")
    && (
      Object.prototype.hasOwnProperty.call(record, "user_id")
      || Object.prototype.hasOwnProperty.call(record, "vcard")
      || Object.prototype.hasOwnProperty.call(record, "first_name")
      || Object.prototype.hasOwnProperty.call(record, "last_name")
    );
}

function sanitizeHostedLinqMessagePart(value: unknown): unknown {
  const record = toHostedRecord(value);

  if (!record) {
    return value;
  }

  const sanitizedUrl = normalizeHostedLinqAttachmentUrl(record.url);

  if (sanitizedUrl) {
    record.url = sanitizedUrl;
  } else {
    delete record.url;
  }

  return record;
}

function sanitizeHostedLinqHandleRecord(
  value: Record<string, unknown> | null,
  kind: "linq.from" | "linq.recipient",
): void {
  if (!value) {
    return;
  }

  const handle = normalizeHostedOpaqueInput(value.handle);

  if (!handle) {
    return;
  }

  value.handle = createHostedOpaqueIdentifier(kind, normalizePhoneNumber(handle) ?? handle);
}

function normalizeHostedLinqAttachmentUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);

    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== HOSTED_LINQ_ATTACHMENT_CDN_HOST
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function cloneHostedJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function toHostedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
