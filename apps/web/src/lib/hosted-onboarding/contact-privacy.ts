import { createHmac } from "node:crypto";

import { getHostedOnboardingEnvironment } from "./runtime";
import { maskPhoneNumber, normalizePhoneNumber } from "./phone";

// Lookup keys are durable at-rest identifiers. Keep this version stable until an
// explicit dual-read migration/backfill exists for rotating contact-privacy keys.
const HOSTED_PRIVACY_KEY_VERSION = "v1";
const HOSTED_BLIND_INDEX_PREFIX = "hbidx";
const HOSTED_OPAQUE_ID_PREFIX = "hbid";
const MASKED_PHONE_HINT_PATTERN = /^\*{3}\s+\d{4}$/u;
const HOSTED_LINQ_ATTACHMENT_CDN_HOST = "cdn.linqapp.com";
const TEST_HOSTED_PRIVACY_ROOT_KEY = Buffer.from(
  "vitest-hosted-contact-privacy-root-key",
  "utf8",
);

export function createHostedPhoneLookupKey(value: string | null | undefined): string | null {
  const normalized = normalizePhoneNumber(value);
  return normalized ? createHostedBlindIndex("phone", normalized) : null;
}

export function createHostedTelegramUserLookupKey(value: string | null | undefined): string | null {
  const normalized = normalizeHostedOpaqueInput(value);
  return normalized ? createHostedBlindIndex("telegram-user", normalized) : null;
}

export function createHostedEmailLookupKey(value: string | null | undefined): string | null {
  const normalized = normalizeHostedEmailAddress(value);
  return normalized ? createHostedBlindIndex("email", normalized) : null;
}

export function createHostedOpaqueIdentifier(
  kind: string,
  value: string | number | null | undefined,
): string | null {
  const normalized = normalizeHostedOpaqueInput(value);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith(`${HOSTED_OPAQUE_ID_PREFIX}:${kind}:${HOSTED_PRIVACY_KEY_VERSION}:`)) {
    return normalized;
  }

  if (normalized.startsWith(`${HOSTED_OPAQUE_ID_PREFIX}:`)) {
    return normalized;
  }

  return `${HOSTED_OPAQUE_ID_PREFIX}:${kind}:${HOSTED_PRIVACY_KEY_VERSION}:${digestHostedPrivacyValue(kind, normalized)}`;
}

export function readHostedPhoneHint(value: string | null | undefined): string {
  const normalized = normalizeHostedOpaqueInput(value);
  if (normalized && MASKED_PHONE_HINT_PATTERN.test(normalized)) {
    return normalized;
  }

  return maskPhoneNumber(normalized);
}

export function sanitizeHostedLinqEventForStorage(
  value: Record<string, unknown>,
  options: {
    omitRecipientPhone?: boolean;
  } = {},
): Record<string, unknown> {
  const clone = cloneHostedJsonRecord(value);
  const data = toHostedRecord(clone.data);

  if (!data) {
    return clone;
  }

  const from = normalizeHostedOpaqueInput(data.from);
  if (from) {
    data.from = createHostedOpaqueIdentifier("linq.from", normalizePhoneNumber(from) ?? from);
  }

  const recipientPhone = normalizeHostedOpaqueInput(data.recipient_phone);
  if (recipientPhone) {
    data.recipient_phone = createHostedOpaqueIdentifier(
      "linq.recipient",
      normalizePhoneNumber(recipientPhone) ?? recipientPhone,
    );
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

function createHostedBlindIndex(kind: string, value: string): string {
  return `${HOSTED_BLIND_INDEX_PREFIX}:${kind}:${HOSTED_PRIVACY_KEY_VERSION}:${digestHostedPrivacyValue(kind, value)}`;
}

function digestHostedPrivacyValue(kind: string, value: string): string {
  return createHmac("sha256", deriveHostedPrivacyKey(`blind-index:${kind}`))
    .update(value)
    .digest("hex");
}

function deriveHostedPrivacyKey(purpose: string): Buffer {
  return createHmac("sha256", readHostedPrivacyRootKey())
    .update(`hosted-contact-privacy:${purpose}`)
    .digest();
}

function readHostedPrivacyRootKey(): string | Buffer {
  let environment: ReturnType<typeof getHostedOnboardingEnvironment> | null = null;

  try {
    environment = getHostedOnboardingEnvironment();
  } catch (error) {
    if (!(process.env.NODE_ENV === "test" || typeof process.env.VITEST === "string")) {
      throw error;
    }
  }

  if (
    environment
    && (typeof environment.encryptionKey === "string" || Buffer.isBuffer(environment.encryptionKey))
  ) {
    return environment.encryptionKey;
  }

  if (process.env.NODE_ENV === "test" || typeof process.env.VITEST === "string") {
    return TEST_HOSTED_PRIVACY_ROOT_KEY;
  }

  throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY is required for hosted contact privacy.");
}

function normalizeHostedOpaqueInput(
  value: string | number | null | undefined | unknown,
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    ? normalized
    : null;
}

function cloneHostedJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function toHostedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
