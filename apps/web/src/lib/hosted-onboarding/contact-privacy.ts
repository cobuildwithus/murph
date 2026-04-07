import { createHmac } from "node:crypto";

import { getHostedOnboardingEnvironment } from "./runtime";
import { maskPhoneNumber, normalizePhoneNumber } from "./phone";

const TEST_HOSTED_PRIVACY_VERSION = "v1";
const HOSTED_BLIND_INDEX_PREFIX = "hbidx";
const HOSTED_OPAQUE_ID_PREFIX = "hbid";
const MASKED_PHONE_HINT_PATTERN = /^\*{3}\s+\d{4}$/u;
const HOSTED_LINQ_ATTACHMENT_CDN_HOST = "cdn.linqapp.com";
const HOSTED_BLIND_INDEX_PATTERN =
  /^(?<prefix>hbidx):(?<kind>[a-z0-9-]+):(?<version>v[0-9]+):(?<digest>[0-9a-f]+)$/u;
const TEST_HOSTED_PRIVACY_KEYRING = {
  currentVersion: TEST_HOSTED_PRIVACY_VERSION,
  keysByVersion: {
    [TEST_HOSTED_PRIVACY_VERSION]: Buffer.from(
      "vitest-hosted-contact-privacy-root-key",
      "utf8",
    ),
  },
  readVersions: [TEST_HOSTED_PRIVACY_VERSION],
} as const;

export type HostedBlindIndexKind =
  | "email"
  | "linq-chat"
  | "phone"
  | "privy-user"
  | "stripe-billing-event"
  | "stripe-checkout-session"
  | "stripe-customer"
  | "stripe-subscription"
  | "telegram-user"
  | "wallet-address";

export interface HostedBlindIndexParts {
  digest: string;
  kind: string;
  prefix: typeof HOSTED_BLIND_INDEX_PREFIX;
  version: string;
}

export function createHostedPhoneLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("phone", normalizePhoneNumber(value));
}

export function createHostedPhoneLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("phone", normalizePhoneNumber(value));
}

export function createHostedTelegramUserLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("telegram-user", normalizeHostedOpaqueInput(value));
}

export function createHostedTelegramUserLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("telegram-user", normalizeHostedOpaqueInput(value));
}

export function createHostedEmailLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("email", normalizeHostedEmailAddress(value));
}

export function createHostedPrivyUserLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("privy-user", normalizeHostedOpaqueInput(value));
}

export function createHostedPrivyUserLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("privy-user", normalizeHostedOpaqueInput(value));
}

export function createHostedWalletAddressLookupKey(value: string | null | undefined): string | null {
  const normalized = normalizeHostedOpaqueInput(value)?.toLowerCase() ?? null;
  return createHostedLookupKey("wallet-address", normalized);
}

export function createHostedWalletAddressLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  const normalized = normalizeHostedOpaqueInput(value)?.toLowerCase() ?? null;
  return createHostedLookupKeyReadCandidates("wallet-address", normalized);
}

export function createHostedLinqChatLookupKey(value: string | number | null | undefined): string | null {
  return createHostedLookupKey("linq-chat", normalizeHostedOpaqueInput(value));
}

export function createHostedLinqChatLookupKeyReadCandidates(
  value: string | number | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("linq-chat", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeCustomerLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("stripe-customer", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeCustomerLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("stripe-customer", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeSubscriptionLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("stripe-subscription", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeSubscriptionLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates(
    "stripe-subscription",
    normalizeHostedOpaqueInput(value),
  );
}

export function createHostedStripeCheckoutSessionLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("stripe-checkout-session", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeBillingEventLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("stripe-billing-event", normalizeHostedOpaqueInput(value));
}

export function hostedLookupKeyMatchesValue(input: {
  expectedLookupKey: string | null | undefined;
  kind: HostedBlindIndexKind;
  normalizedValue: string | null;
}): boolean {
  const expectedLookupKey = normalizeHostedOpaqueInput(input.expectedLookupKey);

  if (!expectedLookupKey || !input.normalizedValue) {
    return false;
  }

  return createHostedLookupKeyReadCandidates(input.kind, input.normalizedValue)
    .includes(expectedLookupKey);
}

export function hostedPhoneLookupKeyMatchesValue(
  phoneNumber: string | null | undefined,
  expectedLookupKey: string | null | undefined,
): boolean {
  return hostedLookupKeyMatchesValue({
    expectedLookupKey,
    kind: "phone",
    normalizedValue: normalizePhoneNumber(phoneNumber),
  });
}

export function parseHostedBlindIndex(value: string | null | undefined): HostedBlindIndexParts | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(HOSTED_BLIND_INDEX_PATTERN);

  if (!match?.groups) {
    return null;
  }

  return {
    digest: match.groups.digest,
    kind: match.groups.kind,
    prefix: HOSTED_BLIND_INDEX_PREFIX,
    version: match.groups.version,
  };
}

export function readHostedContactPrivacyCurrentVersion(): string {
  return readHostedPrivacyKeyring().currentVersion;
}

export function createHostedOpaqueIdentifier(
  kind: string,
  value: string | number | null | undefined,
): string | null {
  const normalized = normalizeHostedOpaqueInput(value);
  if (!normalized) {
    return null;
  }

  const currentVersion = readHostedContactPrivacyCurrentVersion();

  if (normalized.startsWith(`${HOSTED_OPAQUE_ID_PREFIX}:${kind}:${currentVersion}:`)) {
    return normalized;
  }

  if (normalized.startsWith(`${HOSTED_OPAQUE_ID_PREFIX}:`)) {
    return normalized;
  }

  return `${HOSTED_OPAQUE_ID_PREFIX}:${kind}:${currentVersion}:${digestHostedPrivacyValue(kind, currentVersion, normalized)}`;
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

function createHostedLookupKey(
  kind: HostedBlindIndexKind,
  normalizedValue: string | null,
): string | null {
  if (!normalizedValue) {
    return null;
  }

  const { currentVersion } = readHostedPrivacyKeyring();
  return createHostedBlindIndex(kind, normalizedValue, currentVersion);
}

function createHostedLookupKeyReadCandidates(
  kind: HostedBlindIndexKind,
  normalizedValue: string | null,
): string[] {
  if (!normalizedValue) {
    return [];
  }

  const { readVersions } = readHostedPrivacyKeyring();
  return [...new Set(readVersions.map((version) => createHostedBlindIndex(kind, normalizedValue, version)))];
}

function createHostedBlindIndex(
  kind: HostedBlindIndexKind,
  value: string,
  version: string,
): string {
  return `${HOSTED_BLIND_INDEX_PREFIX}:${kind}:${version}:${digestHostedPrivacyValue(kind, version, value)}`;
}

function digestHostedPrivacyValue(kind: string, version: string, value: string): string {
  return createHmac("sha256", deriveHostedPrivacyKey(`blind-index:${kind}`, version))
    .update(value)
    .digest("hex");
}

function deriveHostedPrivacyKey(purpose: string, version: string): Buffer {
  const keyMaterial = readHostedPrivacyKeyring().keysByVersion[version];

  if (!keyMaterial) {
    throw new TypeError(`Hosted contact privacy keyring is missing ${version}.`);
  }

  return createHmac("sha256", keyMaterial)
    .update(`hosted-contact-privacy:${version}:${purpose}`)
    .digest();
}

function readHostedPrivacyKeyring(): {
  currentVersion: string;
  keysByVersion: Readonly<Record<string, Buffer>>;
  readVersions: readonly string[];
} {
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
    && environment.contactPrivacyKeyring
  ) {
    return environment.contactPrivacyKeyring;
  }

  if (process.env.NODE_ENV === "test" || typeof process.env.VITEST === "string") {
    return TEST_HOSTED_PRIVACY_KEYRING;
  }

  throw new TypeError(
    "HOSTED_CONTACT_PRIVACY_KEYS is required for hosted contact privacy.",
  );
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
