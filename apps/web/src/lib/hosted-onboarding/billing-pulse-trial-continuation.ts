import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { readHostedAppSessionHmacKey } from "./app-session-config";
import {
  HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM,
  HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM,
  HOSTED_PULSE_TRIAL_CONTINUATION_PATH,
  HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM,
  type HostedPulseTrialContinuationAction,
} from "./billing-pulse-trial-continuation-contract";

const CONTINUATION_COOKIE_NAME_PRODUCTION = "__Host-murph-start-pulse";
const CONTINUATION_COOKIE_NAME_DEVELOPMENT = "murph-start-pulse";
const START_CONTINUATION_TOKEN_PREFIX = "murph_start_paid_pulse_v1";
const CONTINUE_CONTINUATION_TOKEN_PREFIX = "murph_continue_paid_pulse_v1";
const START_CONTINUATION_AUTHENTICATOR_DOMAIN =
  "murph.hosted-start-paid-pulse-continuation";
const CONTINUE_CONTINUATION_AUTHENTICATOR_DOMAIN =
  "murph.hosted-continue-paid-pulse-continuation";
const CONTINUATION_COOKIE_AUTHENTICATOR_VERSION = 1;
const CONTINUATION_MAX_AGE_SECONDS = 15 * 60;
const PAYMENT_RETURN_AUTHENTICATOR_DOMAIN =
  "murph.hosted-pulse-trial-payment-return";
const PAYMENT_RETURN_AUTHENTICATOR_VERSION = 1;
const PAYMENT_RETURN_MAX_AGE_SECONDS = 30 * 60;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const CONTINUATION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? CONTINUATION_COOKIE_NAME_PRODUCTION
    : CONTINUATION_COOKIE_NAME_DEVELOPMENT;

export function buildHostedPulseTrialContinuationCookie(input: {
  action: HostedPulseTrialContinuationAction;
  memberId: string;
  now?: Date;
  sessionId: string;
}): string {
  const now = input.now ?? new Date();
  const expiresAtMs = now.getTime() + CONTINUATION_MAX_AGE_SECONDS * 1_000;
  assertValidUnixMilliseconds(expiresAtMs);

  const authenticator = createContinuationAuthenticator({
    action: input.action,
    expiresAtMs,
    memberId: input.memberId,
    sessionId: input.sessionId,
  });
  const token = `${continuationTokenPrefix(input.action)}.${expiresAtMs}.${authenticator}`;

  return buildContinuationCookie({
    maxAgeSeconds: CONTINUATION_MAX_AGE_SECONDS,
    value: token,
  });
}

export function buildHostedPulseTrialContinuationClearCookie(): string {
  return buildContinuationCookie({
    maxAgeSeconds: 0,
    value: "",
  });
}

export async function readHostedPulseTrialContinuationCookie(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
}): Promise<HostedPulseTrialContinuationAction | null> {
  const cookieStore = await cookies();
  return readHostedPulseTrialContinuationToken({
    ...input,
    token: cookieStore.get(CONTINUATION_COOKIE_NAME)?.value,
  });
}

export function readHostedPulseTrialContinuationRequest(input: {
  memberId: string;
  now?: Date;
  request: Request;
  sessionId: string;
}): HostedPulseTrialContinuationAction | null {
  return readHostedPulseTrialContinuationToken({
    ...input,
    token: readCookieFromRequest(input.request, CONTINUATION_COOKIE_NAME),
  });
}

export function readHostedPulseTrialContinuationToken(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
  token: string | null | undefined;
}): HostedPulseTrialContinuationAction | null {
  if (
    typeof input.token !== "string"
    || input.token !== input.token.trim()
  ) {
    return null;
  }

  const parts = input.token.split(".");
  const action = continuationActionFromTokenPrefix(parts[0]);
  if (parts.length !== 3 || action === null) {
    return null;
  }

  const expiresAtText = parts[1];
  const authenticator = parts[2];
  if (!/^[1-9][0-9]*$/u.test(expiresAtText) || !SHA256_BASE64URL_PATTERN.test(authenticator)) {
    return null;
  }

  const expiresAtMs = Number(expiresAtText);
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isSafeInteger(expiresAtMs)
    || !Number.isSafeInteger(nowMs)
    || expiresAtMs <= nowMs
  ) {
    return null;
  }

  const expected = createContinuationAuthenticator({
    action,
    expiresAtMs,
    memberId: input.memberId,
    sessionId: input.sessionId,
  });

  return timingSafeEqual(
    Buffer.from(authenticator, "base64url"),
    Buffer.from(expected, "base64url"),
  ) ? action : null;
}

export function buildHostedPulseTrialPaymentReturnUrl(input: {
  action: HostedPulseTrialContinuationAction;
  memberId: string;
  now?: Date;
  publicBaseUrl: string;
}): string {
  const now = input.now ?? new Date();
  const expiresAtMs = now.getTime() + PAYMENT_RETURN_MAX_AGE_SECONDS * 1_000;
  assertValidUnixMilliseconds(expiresAtMs);
  const url = new URL(HOSTED_PULSE_TRIAL_CONTINUATION_PATH, input.publicBaseUrl);
  url.searchParams.set(HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM, input.action);
  url.searchParams.set(
    HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM,
    String(expiresAtMs),
  );
  url.searchParams.set(
    HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM,
    createPaymentReturnAuthenticator({
      action: input.action,
      expiresAtMs,
      memberId: input.memberId,
    }),
  );
  return url.toString();
}

export function readHostedPulseTrialPaymentReturnAction(input: {
  memberId: string;
  now?: Date;
  request: Request;
}): HostedPulseTrialContinuationAction | null {
  const url = new URL(input.request.url);
  const actionValues = url.searchParams.getAll(
    HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM,
  );
  const expiresValues = url.searchParams.getAll(
    HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM,
  );
  const signatureValues = url.searchParams.getAll(
    HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM,
  );
  if (
    actionValues.length !== 1
    || expiresValues.length !== 1
    || signatureValues.length !== 1
  ) {
    return null;
  }

  const action = parseHostedPulseTrialContinuationAction(actionValues[0]);
  const expiresAtText = expiresValues[0];
  const signature = signatureValues[0];
  if (
    action === null
    || !/^[1-9][0-9]*$/u.test(expiresAtText)
    || !SHA256_BASE64URL_PATTERN.test(signature)
  ) {
    return null;
  }

  const expiresAtMs = Number(expiresAtText);
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isSafeInteger(expiresAtMs)
    || !Number.isSafeInteger(nowMs)
    || expiresAtMs <= nowMs
  ) {
    return null;
  }

  const expected = createPaymentReturnAuthenticator({
    action,
    expiresAtMs,
    memberId: input.memberId,
  });
  return timingSafeEqual(
    Buffer.from(signature, "base64url"),
    Buffer.from(expected, "base64url"),
  ) ? action : null;
}

function createContinuationAuthenticator(input: {
  action: HostedPulseTrialContinuationAction;
  expiresAtMs: number;
  memberId: string;
  sessionId: string;
}): string {
  const payload = JSON.stringify([
    continuationAuthenticatorDomain(input.action),
    CONTINUATION_COOKIE_AUTHENTICATOR_VERSION,
    input.sessionId,
    input.memberId,
    input.expiresAtMs,
  ]);

  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(payload, "utf8")
    .digest("base64url");
}

function createPaymentReturnAuthenticator(input: {
  action: HostedPulseTrialContinuationAction;
  expiresAtMs: number;
  memberId: string;
}): string {
  const payload = JSON.stringify([
    PAYMENT_RETURN_AUTHENTICATOR_DOMAIN,
    PAYMENT_RETURN_AUTHENTICATOR_VERSION,
    input.memberId,
    input.action,
    input.expiresAtMs,
  ]);

  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(payload, "utf8")
    .digest("base64url");
}

function continuationTokenPrefix(
  action: HostedPulseTrialContinuationAction,
): string {
  return action === "start_pulse_now"
    ? START_CONTINUATION_TOKEN_PREFIX
    : CONTINUE_CONTINUATION_TOKEN_PREFIX;
}

function continuationAuthenticatorDomain(
  action: HostedPulseTrialContinuationAction,
): string {
  return action === "start_pulse_now"
    ? START_CONTINUATION_AUTHENTICATOR_DOMAIN
    : CONTINUE_CONTINUATION_AUTHENTICATOR_DOMAIN;
}

function continuationActionFromTokenPrefix(
  value: string | undefined,
): HostedPulseTrialContinuationAction | null {
  if (value === START_CONTINUATION_TOKEN_PREFIX) {
    return "start_pulse_now";
  }
  if (value === CONTINUE_CONTINUATION_TOKEN_PREFIX) {
    return "continue_pulse";
  }
  return null;
}

function parseHostedPulseTrialContinuationAction(
  value: string | undefined,
): HostedPulseTrialContinuationAction | null {
  return value === "start_pulse_now" || value === "continue_pulse"
    ? value
    : null;
}

function assertValidUnixMilliseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Pulse continuation time must be valid.");
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
