import "server-only";

import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

import { readHostedAppSessionHmacKey } from "./app-session-config";
import { resolveHostedLinqDayUtc } from "./linq-daily-state";
import {
  createHostedLinqParticipantContact,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import { normalizePhoneNumber } from "./phone";
import { requireHostedOnboardingPublicBaseUrl } from "./runtime";
import { sha256Hex } from "../primitives";

export const HOSTED_LINQ_GROUP_SETUP_TEMPLATE = "group_setup";
export const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE =
  "group_email_recovery";

const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX =
  "murph_linq_group_email_v1.";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN =
  "murph.linq-group-email-recovery.v1";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_ENCRYPTION_KEY_DOMAIN =
  "murph.linq-group-email-recovery.v1.encryption-key";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_KEY_DOMAIN =
  "murph.linq-group-email-recovery.v1.iv-key";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_VERSION = 1;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES = 12;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES = 16;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_MAX_BYTES = 4_096;
const HOSTED_LINQ_GROUP_CHAT_ID_MAX_CHARS = 512;

type HostedLinqGroupEmailRecoveryTokenPayload = {
  chatId: string;
  email: string;
  expiresAt: string;
  issuedAt: string;
  observedAt: string;
  recipientPhone: string;
  version: 1;
};

export type HostedLinqGroupEmailRecovery = {
  chatId: string;
  participantContact: HostedLinqParticipantContact & { kind: "email" };
  observedAt: Date;
  recipientPhone: string;
};

// One setup link per group chat per inbound UTC day. Keying on the chat alone
// would mute a chat forever after a single link: if the wrong person redeems
// it, or nobody does, the group could never be offered another one. The
// provider occurrence day keeps webhook retries deduped even when processing
// crosses midnight.
export function buildHostedLinqGroupSetupEffectId(input: {
  chatId: string;
  occurredAt: string | Date;
}): string {
  const chatId = normalizeHostedLinqGroupChatId(input.chatId);
  const dayUtc = resolveHostedLinqDayUtc(input.occurredAt);
  if (!chatId || Number.isNaN(dayUtc.getTime())) {
    throw new TypeError(
      "Hosted Linq group setup requires a non-empty chat id and a valid occurrence time.",
    );
  }

  return `linq-group-setup:${sha256Hex(JSON.stringify({
    chatId,
    dayUtc: dayUtc.toISOString(),
  })).slice(0, 32)}`;
}

// One private recovery link per address per group chat per inbound UTC day,
// for the same reason as the in-group link above.
export function buildHostedLinqGroupEmailRecoveryEffectId(input: {
  chatId: string;
  occurredAt: string | Date;
  participantEmail: string;
  recipientPhone: string;
}): string {
  const chatId = normalizeHostedLinqGroupChatId(input.chatId);
  const dayUtc = resolveHostedLinqDayUtc(input.occurredAt);
  const participantContact = createHostedLinqParticipantContact({
    kind: "email",
    value: input.participantEmail,
  });
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  if (
    !chatId
    || Number.isNaN(dayUtc.getTime())
    || !participantContact
    || participantContact.kind !== "email"
    || !recipientPhone
  ) {
    throw new TypeError(
      "Hosted Linq group email recovery requires a valid chat, occurrence time, email, and recipient line.",
    );
  }

  // Hashes normalized raw inputs directly: the contact-privacy lookup keys
  // embed the current keyring version, so a rotation would change this id and
  // re-send a duplicate private recovery link to the same address.
  return `linq-group-email-recovery:${sha256Hex(JSON.stringify({
    chatId,
    dayUtc: dayUtc.toISOString(),
    participantEmail: participantContact.value,
    recipientPhone,
  })).slice(0, 32)}`;
}

export function buildHostedLinqGroupSetupUrl(): string {
  return `${requireHostedOnboardingPublicBaseUrl().replace(/\/+$/u, "")}/groups/start`;
}

export function buildHostedLinqGroupSetupMessage(): string {
  return [
    "I'm here — someone in this chat needs to finish setting up Murph,",
    "then message me here again:",
    buildHostedLinqGroupSetupUrl(),
  ].join(" ");
}

export function buildHostedLinqGroupEmailRecoveryMessage(input: {
  recoveryToken: string;
}): string {
  const recoveryUrl = buildHostedLinqGroupEmailRecoveryUrl(input.recoveryToken);
  return [
    "It looks like Messages sent your group message from an email Murph hasn't seen before.",
    "Open this to use your existing Murph account or create one,",
    "then message me in the group again:",
    recoveryUrl,
  ].join(" ");
}

export function issueHostedLinqGroupEmailRecoveryToken(input: {
  chatId: string;
  now?: Date;
  observedAt: string | Date;
  participantEmail: string;
  recipientPhone: string;
}): string {
  const chatId = normalizeHostedLinqGroupChatId(input.chatId);
  const participantContact = createHostedLinqParticipantContact({
    kind: "email",
    value: input.participantEmail,
  });
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const observedAt = new Date(input.observedAt);
  const issuedAt = input.now ?? new Date();
  if (
    !chatId
    || !participantContact
    || participantContact.kind !== "email"
    || !recipientPhone
    || Number.isNaN(observedAt.getTime())
    || Number.isNaN(issuedAt.getTime())
  ) {
    throw new TypeError(
      "Hosted Linq group email recovery requires valid observed provider authority.",
    );
  }

  const expiresAt = new Date(
    issuedAt.getTime() + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TTL_MS,
  );
  const payload: HostedLinqGroupEmailRecoveryTokenPayload = {
    chatId,
    email: participantContact.value,
    expiresAt: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    observedAt: observedAt.toISOString(),
    recipientPhone,
    version: HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_VERSION,
  };
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.byteLength > HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_MAX_BYTES) {
    throw new RangeError("Hosted Linq group email recovery token is too large.");
  }

  const iv = createHmac(
    "sha256",
    deriveHostedLinqGroupEmailRecoveryIvKey(),
  )
    .update(plaintext)
    .digest()
    .subarray(0, HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveHostedLinqGroupEmailRecoveryEncryptionKey(),
    iv,
  );
  cipher.setAAD(Buffer.from(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX}${Buffer.concat([
    iv,
    tag,
    ciphertext,
  ]).toString("base64url")}`;
}

export function openHostedLinqGroupEmailRecoveryToken(input: {
  now?: Date;
  token: string | null | undefined;
}): HostedLinqGroupEmailRecovery | null {
  const token = input.token?.trim() ?? "";
  if (
    !token.startsWith(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX)
    || token !== input.token
  ) {
    return null;
  }

  const encoded = token.slice(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX.length,
  );
  if (!encoded || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return null;
  }

  let packed: Buffer;
  try {
    packed = Buffer.from(encoded, "base64url");
  } catch {
    return null;
  }
  if (
    packed.toString("base64url") !== encoded
    || packed.byteLength
      <= HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES
        + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES
    || packed.byteLength > HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_MAX_BYTES
  ) {
    return null;
  }

  const iv = packed.subarray(0, HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES);
  const tag = packed.subarray(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES,
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES
      + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES,
  );
  const ciphertext = packed.subarray(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES
      + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES,
  );

  let payload: unknown;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveHostedLinqGroupEmailRecoveryEncryptionKey(),
      iv,
    );
    decipher.setAAD(
      Buffer.from(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN),
    );
    decipher.setAuthTag(tag);
    payload = JSON.parse(
      Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    return null;
  }

  const parsed = parseHostedLinqGroupEmailRecoveryPayload(payload);
  if (!parsed) {
    return null;
  }
  const now = input.now ?? new Date();
  if (
    Number.isNaN(now.getTime())
    || parsed.issuedAt.getTime()
      > now.getTime() + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CLOCK_SKEW_MS
    || parsed.expiresAt <= now
  ) {
    return null;
  }

  return {
    chatId: parsed.chatId,
    observedAt: parsed.observedAt,
    participantContact: parsed.participantContact,
    recipientPhone: parsed.recipientPhone,
  };
}

function buildHostedLinqGroupEmailRecoveryUrl(token: string): string {
  const url = new URL(buildHostedLinqGroupSetupUrl());
  url.hash = new URLSearchParams({ recover: token }).toString();
  return url.toString();
}

function deriveHostedLinqGroupEmailRecoveryEncryptionKey(): Buffer {
  return deriveHostedLinqGroupEmailRecoveryKey(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_ENCRYPTION_KEY_DOMAIN,
  );
}

function deriveHostedLinqGroupEmailRecoveryIvKey(): Buffer {
  return deriveHostedLinqGroupEmailRecoveryKey(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_KEY_DOMAIN,
  );
}

function deriveHostedLinqGroupEmailRecoveryKey(domain: string): Buffer {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(domain, "utf8")
    .digest();
}

function parseHostedLinqGroupEmailRecoveryPayload(value: unknown): {
  chatId: string;
  expiresAt: Date;
  issuedAt: Date;
  observedAt: Date;
  participantContact: HostedLinqParticipantContact & { kind: "email" };
  recipientPhone: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_VERSION
    || typeof record.chatId !== "string"
    || typeof record.email !== "string"
    || typeof record.recipientPhone !== "string"
    || typeof record.observedAt !== "string"
    || typeof record.issuedAt !== "string"
    || typeof record.expiresAt !== "string"
  ) {
    return null;
  }

  const chatId = normalizeHostedLinqGroupChatId(record.chatId);
  const participantContact = createHostedLinqParticipantContact({
    kind: "email",
    value: record.email,
  });
  const recipientPhone = normalizePhoneNumber(record.recipientPhone);
  const observedAt = new Date(record.observedAt);
  const issuedAt = new Date(record.issuedAt);
  const expiresAt = new Date(record.expiresAt);
  if (
    !chatId
    || !participantContact
    || participantContact.kind !== "email"
    || !recipientPhone
    || Number.isNaN(observedAt.getTime())
    || Number.isNaN(issuedAt.getTime())
    || Number.isNaN(expiresAt.getTime())
    || expiresAt.getTime() - issuedAt.getTime()
      !== HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TTL_MS
  ) {
    return null;
  }

  return {
    chatId,
    expiresAt,
    issuedAt,
    observedAt,
    participantContact: {
      kind: "email",
      lookupKey: participantContact.lookupKey,
      value: participantContact.value,
    },
    recipientPhone,
  };
}

function normalizeHostedLinqGroupChatId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= HOSTED_LINQ_GROUP_CHAT_ID_MAX_CHARS
    ? normalized
    : null;
}
