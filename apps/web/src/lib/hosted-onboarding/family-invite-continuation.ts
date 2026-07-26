import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { cookies } from "next/headers";

import { readHostedAppSessionHmacKey } from "./app-session-config";
import type {
  HostedFamilyInviteContinuationPayload,
  HostedFamilyInvitePaymentContinuation,
} from "./family-invite-continuation-contract";

const CONTINUATION_COOKIE_NAME_PRODUCTION =
  "__Host-murph-family-invite-continuation";
const CONTINUATION_COOKIE_NAME_DEVELOPMENT =
  "murph-family-invite-continuation";
const CONTINUATION_TOKEN_PREFIX = "murph_family_invite_v1";
const CONTINUATION_SCHEMA = "murph.hosted-family-invite-continuation.v1";
const CONTINUATION_KEY_PURPOSE = "hosted-family-invite-continuation";
const CONTINUATION_MAX_AGE_SECONDS = 30 * 60;
const CONTINUATION_MAX_TOKEN_LENGTH = 3_500;
const CONTINUATION_MAX_FIELD_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

const CONTINUATION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? CONTINUATION_COOKIE_NAME_PRODUCTION
    : CONTINUATION_COOKIE_NAME_DEVELOPMENT;

export function buildHostedFamilyInviteContinuationCookie(input: {
  continuation: HostedFamilyInvitePaymentContinuation;
  groupId: string;
  memberId: string;
  now?: Date;
  sessionId: string;
}): string {
  const expiresAtMs =
    (input.now ?? new Date()).getTime() +
    CONTINUATION_MAX_AGE_SECONDS * 1_000;
  assertValidUnixMilliseconds(expiresAtMs);
  const continuation = parseHostedFamilyInvitePaymentContinuation({
    ...input.continuation,
    expiresAtMs,
    schema: CONTINUATION_SCHEMA,
  });
  if (!continuation) {
    throw new TypeError("Family invite continuation is invalid.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveHostedFamilyInviteContinuationKey(),
    iv,
  );
  cipher.setAAD(buildHostedFamilyInviteContinuationAad(input));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(continuation), "utf8"),
    cipher.final(),
  ]);
  const token = [
    CONTINUATION_TOKEN_PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
  if (token.length > CONTINUATION_MAX_TOKEN_LENGTH) {
    throw new TypeError("Family invite continuation is too large.");
  }

  return buildHostedFamilyInviteContinuationSetCookie({
    maxAgeSeconds: CONTINUATION_MAX_AGE_SECONDS,
    value: token,
  });
}

export function buildHostedFamilyInviteContinuationClearCookie(): string {
  return buildHostedFamilyInviteContinuationSetCookie({
    maxAgeSeconds: 0,
    value: "",
  });
}

export async function readHostedFamilyInviteContinuationCookie(input: {
  groupId: string;
  memberId: string;
  now?: Date;
  sessionId: string;
}): Promise<HostedFamilyInvitePaymentContinuation | null> {
  const cookieStore = await cookies();
  return readHostedFamilyInviteContinuationToken({
    ...input,
    token: cookieStore.get(CONTINUATION_COOKIE_NAME)?.value,
  });
}

export function readHostedFamilyInviteContinuationToken(input: {
  groupId: string;
  memberId: string;
  now?: Date;
  sessionId: string;
  token: string | null | undefined;
}): HostedFamilyInvitePaymentContinuation | null {
  if (
    typeof input.token !== "string" ||
    input.token !== input.token.trim() ||
    input.token.length > CONTINUATION_MAX_TOKEN_LENGTH
  ) {
    return null;
  }
  const parts = input.token.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== CONTINUATION_TOKEN_PREFIX ||
    !parts.slice(1).every(isCanonicalBase64Url) ||
    Buffer.from(parts[1], "base64url").byteLength !== 12 ||
    Buffer.from(parts[3], "base64url").byteLength !== 16
  ) {
    return null;
  }

  const key = deriveHostedFamilyInviteContinuationKey();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parts[1], "base64url"),
    );
    decipher.setAAD(buildHostedFamilyInviteContinuationAad(input));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const continuation = parseHostedFamilyInvitePaymentContinuation(
      JSON.parse(plaintext),
    );
    if (
      !continuation ||
      continuation.expiresAtMs <= (input.now ?? new Date()).getTime()
    ) {
      return null;
    }
    return {
      paymentUrl: continuation.paymentUrl,
      payload: continuation.payload,
    };
  } catch {
    return null;
  }
}

function isCanonicalBase64Url(value: string): boolean {
  if (value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength > 0 && decoded.toString("base64url") === value;
}

function deriveHostedFamilyInviteContinuationKey(): Buffer {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(CONTINUATION_KEY_PURPOSE, "utf8")
    .digest();
}

function buildHostedFamilyInviteContinuationAad(input: {
  groupId: string;
  memberId: string;
  sessionId: string;
}): Buffer {
  return Buffer.from(JSON.stringify([
    CONTINUATION_SCHEMA,
    input.sessionId,
    input.memberId,
    input.groupId,
  ]));
}

function parseHostedFamilyInvitePaymentContinuation(
  value: unknown,
): (HostedFamilyInvitePaymentContinuation & {
  expiresAtMs: number;
  schema: typeof CONTINUATION_SCHEMA;
}) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = Object.fromEntries(Object.entries(value));
  if (
    record.schema !== CONTINUATION_SCHEMA ||
    !Number.isSafeInteger(record.expiresAtMs) ||
    typeof record.expiresAtMs !== "number" ||
    record.expiresAtMs <= 0 ||
    typeof record.paymentUrl !== "string" ||
    !isHostedFamilyInvitePaymentUrl(record.paymentUrl) ||
    !record.payload ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload)
  ) {
    return null;
  }
  const payloadRecord = Object.fromEntries(Object.entries(record.payload));
  const targetEmail = readOptionalContinuationField(payloadRecord.targetEmail);
  const targetLabel = readOptionalContinuationField(payloadRecord.targetLabel);
  const targetPhoneNumber = readOptionalContinuationField(
    payloadRecord.targetPhoneNumber,
  );
  const targetTelegramUsername = readOptionalContinuationField(
    payloadRecord.targetTelegramUsername,
  );
  if (
    payloadRecord.addSeatIfNeeded !== true ||
    (payloadRecord.planCode !== "pulse" && payloadRecord.planCode !== "edge") ||
    targetEmail === false ||
    targetLabel === false ||
    targetPhoneNumber === false ||
    targetTelegramUsername === false ||
    (!targetEmail && !targetPhoneNumber && !targetTelegramUsername)
  ) {
    return null;
  }
  const payload: HostedFamilyInviteContinuationPayload = {
    addSeatIfNeeded: true,
    planCode: payloadRecord.planCode,
    ...(targetEmail ? { targetEmail } : {}),
    ...(targetLabel ? { targetLabel } : {}),
    ...(targetPhoneNumber ? { targetPhoneNumber } : {}),
    ...(targetTelegramUsername ? { targetTelegramUsername } : {}),
  };
  return {
    expiresAtMs: record.expiresAtMs,
    paymentUrl: new URL(record.paymentUrl).toString(),
    payload,
    schema: CONTINUATION_SCHEMA,
  };
}

function readOptionalContinuationField(
  value: unknown,
): string | null | false {
  if (value === undefined) {
    return null;
  }
  return typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= CONTINUATION_MAX_FIELD_LENGTH
    ? value
    : false;
}

function isHostedFamilyInvitePaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      (
        url.origin === "https://invoice.stripe.com" ||
        url.origin === "https://billing.stripe.com"
      );
  } catch {
    return false;
  }
}

function assertValidUnixMilliseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Family invite continuation time must be valid.");
  }
}

function buildHostedFamilyInviteContinuationSetCookie(input: {
  maxAgeSeconds: number;
  value: string;
}): string {
  return [
    `${CONTINUATION_COOKIE_NAME}=${encodeURIComponent(input.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
    process.env.NODE_ENV === "production" ? "Secure" : null,
  ].filter((part): part is string => Boolean(part)).join("; ");
}
