import { createHmac } from "node:crypto";

import { readHostedContactPrivacyKeyring } from "./env";
import { maskPhoneNumber, normalizePhoneNumber } from "./phone";

const HOSTED_BLIND_INDEX_PREFIX = "hbidx";
const HOSTED_OPAQUE_ID_PREFIX = "hbid";
const MASKED_PHONE_HINT_PATTERN = /^\*{3}\s+\d{4}$/u;
const HOSTED_BLIND_INDEX_PATTERN =
  /^(?<prefix>hbidx):(?<kind>[a-z0-9-]+):(?<version>v[0-9]+):(?<digest>[0-9a-f]+)$/u;

export type HostedBlindIndexKind =
  | "email"
  | "external-thread"
  | "external-thread-identity"
  | "linq-chat"
  | "linq-message"
  | "phone"
  | "privy-user"
  | "stripe-billing-event"
  | "stripe-checkout-session"
  | "stripe-customer"
  | "stripe-subscription"
  | "stripe-subscription-item"
  | "stripe-subscription-schedule"
  | "telegram-username"
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

export function normalizeHostedTelegramUsernameForLookup(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedOpaqueInput(value);

  if (!normalized) {
    return null;
  }

  const username = normalized.startsWith("@") ? normalized.slice(1) : normalized;

  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? username.toLowerCase() : null;
}

export function createHostedTelegramUsernameLookupKey(
  value: string | null | undefined,
): string | null {
  return createHostedLookupKey(
    "telegram-username",
    normalizeHostedTelegramUsernameForLookup(value),
  );
}

export function createHostedTelegramUsernameLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates(
    "telegram-username",
    normalizeHostedTelegramUsernameForLookup(value),
  );
}

export function createHostedEmailLookupKey(value: string | null | undefined): string | null {
  return createHostedLookupKey("email", normalizeHostedEmailAddress(value));
}

export function createHostedEmailLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("email", normalizeHostedEmailAddress(value));
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

export function createHostedLinqChatLookupKey(value: string | number | null | undefined): string | null {
  return createHostedLookupKey("linq-chat", normalizeHostedOpaqueInput(value));
}

export function createHostedLinqChatLookupKeyReadCandidates(
  value: string | number | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("linq-chat", normalizeHostedOpaqueInput(value));
}

export function createHostedLinqMessageLookupKey(value: string | number | null | undefined): string | null {
  return createHostedLookupKey("linq-message", normalizeHostedOpaqueInput(value));
}

export function createHostedLinqMessageLookupKeyReadCandidates(
  value: string | number | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates("linq-message", normalizeHostedOpaqueInput(value));
}

export const HOSTED_EXTERNAL_THREAD_CHANNELS = [
  "email",
  "linq",
  "telegram",
] as const;

export type HostedExternalThreadChannel =
  (typeof HOSTED_EXTERNAL_THREAD_CHANNELS)[number];

export function createHostedExternalThreadLookupKey(input: {
  accountLookupKey: string | null | undefined;
  channel: string | null | undefined;
  threadId: string | number | null | undefined;
}): string | null {
  return createHostedLookupKey(
    "external-thread",
    normalizeHostedExternalThreadLookupInput(input),
  );
}

export function createHostedExternalThreadLookupKeyReadCandidates(input: {
  accountLookupKey: string | null | undefined;
  channel: string | null | undefined;
  threadId: string | number | null | undefined;
}): string[] {
  return createHostedLookupKeyReadCandidates(
    "external-thread",
    normalizeHostedExternalThreadLookupInput(input),
  );
}

export function createHostedExternalThreadIdentityLookupKey(input: {
  channel: string | null | undefined;
  threadId: string | number | null | undefined;
}): string | null {
  return createHostedLookupKey(
    "external-thread-identity",
    normalizeHostedExternalThreadIdentityLookupInput(input),
  );
}

export function createHostedExternalThreadIdentityLookupKeyReadCandidates(input: {
  channel: string | null | undefined;
  threadId: string | number | null | undefined;
}): string[] {
  return createHostedLookupKeyReadCandidates(
    "external-thread-identity",
    normalizeHostedExternalThreadIdentityLookupInput(input),
  );
}

export function isHostedExternalThreadChannel(
  value: string | null | undefined,
): value is HostedExternalThreadChannel {
  return normalizeHostedExternalThreadChannel(value) !== null;
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

export function createHostedStripeSubscriptionItemLookupKey(
  value: string | null | undefined,
): string | null {
  return createHostedLookupKey("stripe-subscription-item", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeSubscriptionItemLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates(
    "stripe-subscription-item",
    normalizeHostedOpaqueInput(value),
  );
}

export function createHostedStripeSubscriptionScheduleLookupKey(
  value: string | null | undefined,
): string | null {
  return createHostedLookupKey("stripe-subscription-schedule", normalizeHostedOpaqueInput(value));
}

export function createHostedStripeSubscriptionScheduleLookupKeyReadCandidates(
  value: string | null | undefined,
): string[] {
  return createHostedLookupKeyReadCandidates(
    "stripe-subscription-schedule",
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

export function hostedEmailLookupKeyMatchesValue(
  address: string | null | undefined,
  expectedLookupKey: string | null | undefined,
): boolean {
  return hostedLookupKeyMatchesValue({
    expectedLookupKey,
    kind: "email",
    normalizedValue: normalizeHostedEmailAddress(address),
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

export function normalizeHostedOpaqueInput(
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

function normalizeHostedExternalThreadLookupInput(input: {
  accountLookupKey: string | null | undefined;
  channel: string | null | undefined;
  threadId: string | number | null | undefined;
}): string | null {
  const accountLookupKey = normalizeHostedOpaqueInput(input.accountLookupKey);
  const channel = normalizeHostedExternalThreadChannel(input.channel);
  const threadId = normalizeHostedOpaqueInput(input.threadId);

  return accountLookupKey && channel && threadId
    ? `${channel}:${accountLookupKey}:${threadId}`
    : null;
}

function normalizeHostedExternalThreadIdentityLookupInput(input: {
  channel: string | null | undefined;
  threadId: string | number | null | undefined;
}): string | null {
  const channel = normalizeHostedExternalThreadChannel(input.channel);
  const threadId = normalizeHostedOpaqueInput(input.threadId);

  return channel && threadId ? `${channel}:${threadId}` : null;
}

function normalizeHostedExternalThreadChannel(
  value: string | null | undefined,
): HostedExternalThreadChannel | null {
  const normalized = value?.trim().toLowerCase() ?? "";

  switch (normalized) {
    case "email":
    case "linq":
    case "telegram":
      return normalized;
    default:
      return null;
  }
}

export function normalizeHostedEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    ? normalized
    : null;
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
  return readHostedContactPrivacyKeyring(process.env);
}
