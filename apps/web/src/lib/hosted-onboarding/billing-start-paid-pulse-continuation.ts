import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { readHostedAppSessionHmacKey } from "./app-session-config";

const CONTINUATION_COOKIE_NAME_PRODUCTION = "__Host-murph-start-pulse";
const CONTINUATION_COOKIE_NAME_DEVELOPMENT = "murph-start-pulse";
const CONTINUATION_TOKEN_PREFIX = "murph_start_paid_pulse_v1";
const CONTINUATION_AUTHENTICATOR_DOMAIN =
  "murph.hosted-start-paid-pulse-continuation";
const CONTINUATION_AUTHENTICATOR_VERSION = 1;
const CONTINUATION_MAX_AGE_SECONDS = 15 * 60;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const CONTINUATION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? CONTINUATION_COOKIE_NAME_PRODUCTION
    : CONTINUATION_COOKIE_NAME_DEVELOPMENT;

export function buildHostedStartPaidPulseContinuationCookie(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
}): string {
  const now = input.now ?? new Date();
  const expiresAtMs = now.getTime() + CONTINUATION_MAX_AGE_SECONDS * 1_000;
  assertValidUnixMilliseconds(expiresAtMs);

  const authenticator = createContinuationAuthenticator({
    expiresAtMs,
    memberId: input.memberId,
    sessionId: input.sessionId,
  });
  const token = `${CONTINUATION_TOKEN_PREFIX}.${expiresAtMs}.${authenticator}`;

  return buildContinuationCookie({
    maxAgeSeconds: CONTINUATION_MAX_AGE_SECONDS,
    value: token,
  });
}

export function buildHostedStartPaidPulseContinuationClearCookie(): string {
  return buildContinuationCookie({
    maxAgeSeconds: 0,
    value: "",
  });
}

export async function hasHostedStartPaidPulseContinuationCookie(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
}): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyHostedStartPaidPulseContinuationToken({
    ...input,
    token: cookieStore.get(CONTINUATION_COOKIE_NAME)?.value,
  });
}

export function hasHostedStartPaidPulseContinuationRequest(input: {
  memberId: string;
  now?: Date;
  request: Request;
  sessionId: string;
}): boolean {
  return verifyHostedStartPaidPulseContinuationToken({
    ...input,
    token: readCookieFromRequest(input.request, CONTINUATION_COOKIE_NAME),
  });
}

export function verifyHostedStartPaidPulseContinuationToken(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
  token: string | null | undefined;
}): boolean {
  if (
    typeof input.token !== "string"
    || input.token !== input.token.trim()
  ) {
    return false;
  }

  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== CONTINUATION_TOKEN_PREFIX) {
    return false;
  }

  const expiresAtText = parts[1];
  const authenticator = parts[2];
  if (!/^[1-9][0-9]*$/u.test(expiresAtText) || !SHA256_BASE64URL_PATTERN.test(authenticator)) {
    return false;
  }

  const expiresAtMs = Number(expiresAtText);
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isSafeInteger(expiresAtMs)
    || !Number.isSafeInteger(nowMs)
    || expiresAtMs <= nowMs
  ) {
    return false;
  }

  const expected = createContinuationAuthenticator({
    expiresAtMs,
    memberId: input.memberId,
    sessionId: input.sessionId,
  });

  return timingSafeEqual(
    Buffer.from(authenticator, "base64url"),
    Buffer.from(expected, "base64url"),
  );
}

function createContinuationAuthenticator(input: {
  expiresAtMs: number;
  memberId: string;
  sessionId: string;
}): string {
  const payload = JSON.stringify([
    CONTINUATION_AUTHENTICATOR_DOMAIN,
    CONTINUATION_AUTHENTICATOR_VERSION,
    input.sessionId,
    input.memberId,
    input.expiresAtMs,
  ]);

  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(payload, "utf8")
    .digest("base64url");
}

function assertValidUnixMilliseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Start Pulse continuation time must be valid.");
  }
}

function readCookieFromRequest(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(/;\s*/u)) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || entry.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    const rawValue = entry.slice(separatorIndex + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function buildContinuationCookie(input: {
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
