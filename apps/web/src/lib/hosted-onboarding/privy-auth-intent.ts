import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { hostedOnboardingError } from "./errors";
import type { HostedPrivyIdentity } from "./privy";
import {
  readHostedPrivyLinkedAccountVerifiedAt,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import { getHostedOnboardingEnvironment } from "./runtime";
import type { HostedPrivyAuthMethod } from "./types";

const HOSTED_PRIVY_AUTH_INTENT_PREFIX = "hpai1";
const HOSTED_PRIVY_AUTH_INTENT_TTL_SECONDS = 60 * 10;
const HOSTED_PRIVY_AUTH_INTENT_DOMAIN = "murph.hosted-privy-auth-intent.v1";
const HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS = 5;
const HOSTED_PRIVY_AUTH_INTENT_COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-murph-privy-auth-intent"
  : "murph-privy-auth-intent";

interface HostedPrivyAuthIntentPayload {
  expiresAt: number;
  inviteCode: string | null;
  issuedAt: number;
  method: HostedPrivyAuthMethod;
  version: 1;
}

export interface HostedPrivyAuthenticationProof {
  method: HostedPrivyAuthMethod;
}

export function buildHostedPrivyAuthIntentCookie(intent: string): string {
  return buildHostedPrivyAuthIntentCookieValue({
    maxAgeSeconds: HOSTED_PRIVY_AUTH_INTENT_TTL_SECONDS,
    value: intent,
  });
}

export function buildHostedPrivyAuthIntentClearCookie(): string {
  return buildHostedPrivyAuthIntentCookieValue({
    maxAgeSeconds: 0,
    value: "",
  });
}

export function readHostedPrivyAuthIntentFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(/;\s*/u)) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) continue;
    if (entry.slice(0, separatorIndex).trim() !== HOSTED_PRIVY_AUTH_INTENT_COOKIE_NAME) continue;

    const value = entry.slice(separatorIndex + 1);
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return value || null;
    }
  }

  return null;
}

export function issueHostedPrivyAuthIntent(input: {
  inviteCode?: string | null;
  method: HostedPrivyAuthMethod;
  now?: Date;
  secret?: string;
}): string {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const payload: HostedPrivyAuthIntentPayload = {
    expiresAt: issuedAt + HOSTED_PRIVY_AUTH_INTENT_TTL_SECONDS,
    inviteCode: normalizeInviteCode(input.inviteCode),
    issuedAt,
    method: input.method,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signHostedPrivyAuthIntent(encodedPayload, requireIntentSecret(input.secret));

  return `${HOSTED_PRIVY_AUTH_INTENT_PREFIX}.${encodedPayload}.${signature}`;
}

export function verifyHostedPrivyAuthenticationProof(input: {
  identity: HostedPrivyIdentity;
  intent: string | null | undefined;
  inviteCode?: string | null;
  linkedAccounts: readonly PrivyLinkedAccountLike[];
  now?: Date;
  secret?: string;
}): HostedPrivyAuthenticationProof {
  const payload = readVerifiedHostedPrivyAuthIntent({
    intent: input.intent,
    secret: requireIntentSecret(input.secret),
  });
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (payload.expiresAt < nowSeconds) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTH_PROOF_EXPIRED",
      message: "Request a fresh verification code and try again.",
      httpStatus: 401,
    });
  }

  if (
    payload.issuedAt > nowSeconds + HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS
    || payload.expiresAt !== payload.issuedAt + HOSTED_PRIVY_AUTH_INTENT_TTL_SECONDS
  ) {
    throw invalidHostedPrivyAuthProof();
  }

  if (payload.inviteCode !== normalizeInviteCode(input.inviteCode)) {
    throw invalidHostedPrivyAuthProof();
  }

  const verifiedAt = readHostedPrivyMethodVerifiedAt({
    identity: input.identity,
    method: payload.method,
  });

  const newestMethod = readUniqueNewestHostedPrivyAuthMethod(input.linkedAccounts);
  if (
    verifiedAt === null
    || verifiedAt < payload.issuedAt - HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS
    || verifiedAt > nowSeconds + HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS
    || newestMethod !== payload.method
  ) {
    throw hostedOnboardingError({
      code: hostedPrivyMethodNotReadyCode(payload.method),
      message: `Your verified ${hostedPrivyMethodLabel(payload.method)} has not reached the server-side Privy session yet. Wait a moment and try again.`,
      httpStatus: 409,
      retryable: true,
    });
  }

  return { method: payload.method };
}

function readUniqueNewestHostedPrivyAuthMethod(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
): HostedPrivyAuthMethod | null {
  const candidates = linkedAccounts
    .filter(isHostedPrivyLoginCapableAccount)
    .map((account) => ({
      method: readSupportedHostedPrivyAuthMethod(account),
      verifiedAt: readHostedPrivyLinkedAccountVerifiedAt(account),
    }))
    .filter((candidate): candidate is {
      method: HostedPrivyAuthMethod | null;
      verifiedAt: number;
    } => candidate.verifiedAt !== null);

  if (candidates.length === 0) return null;

  const newestVerifiedAt = Math.max(...candidates.map((candidate) => candidate.verifiedAt));
  const newest = candidates.filter((candidate) => candidate.verifiedAt === newestVerifiedAt);
  if (newest.length !== 1) return null;

  return newest[0]?.method ?? null;
}

function isHostedPrivyLoginCapableAccount(account: PrivyLinkedAccountLike): boolean {
  const type = Reflect.get(account, "type");
  if (type === "smart_wallet" || type === "authorization_key") return false;

  if (type === "wallet") {
    const connectorType = Reflect.get(account, "connector_type")
      ?? Reflect.get(account, "connectorType");
    const walletClient = Reflect.get(account, "wallet_client")
      ?? Reflect.get(account, "walletClient");
    const walletClientType = Reflect.get(account, "wallet_client_type")
      ?? Reflect.get(account, "walletClientType");

    return (
      connectorType !== "embedded"
      && walletClient !== "privy"
      && walletClientType !== "privy"
      && walletClientType !== "privy-v2"
    );
  }

  return typeof type === "string";
}

function readSupportedHostedPrivyAuthMethod(
  account: PrivyLinkedAccountLike,
): HostedPrivyAuthMethod | null {
  const type = Reflect.get(account, "type");
  if (type === "phone" || type === "email" || type === "telegram") return type;
  return null;
}

function readVerifiedHostedPrivyAuthIntent(input: {
  intent: string | null | undefined;
  secret: string;
}): HostedPrivyAuthIntentPayload {
  if (typeof input.intent !== "string") {
    throw invalidHostedPrivyAuthProof();
  }

  const [prefix, encodedPayload, signature, extra] = input.intent.split(".");
  if (
    prefix !== HOSTED_PRIVY_AUTH_INTENT_PREFIX
    || !encodedPayload
    || !signature
    || extra !== undefined
  ) {
    throw invalidHostedPrivyAuthProof();
  }

  const expectedSignature = signHostedPrivyAuthIntent(encodedPayload, input.secret);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw invalidHostedPrivyAuthProof();
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw invalidHostedPrivyAuthProof();
  }

  if (!isHostedPrivyAuthIntentPayload(value)) {
    throw invalidHostedPrivyAuthProof();
  }

  return value;
}

function readHostedPrivyMethodVerifiedAt(input: {
  identity: HostedPrivyIdentity;
  method: HostedPrivyAuthMethod;
}): number | null {
  if (input.method === "phone") {
    return normalizeTimestamp(input.identity.phone?.verifiedAt);
  }

  if (input.method === "email") {
    return normalizeTimestamp(input.identity.email?.verifiedAt);
  }

  return normalizeTimestamp(input.identity.telegram?.verifiedAt);
}

function isHostedPrivyAuthIntentPayload(value: unknown): value is HostedPrivyAuthIntentPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (
    Number.isInteger(Reflect.get(value, "expiresAt"))
    && (Reflect.get(value, "inviteCode") === null || typeof Reflect.get(value, "inviteCode") === "string")
    && Number.isInteger(Reflect.get(value, "issuedAt"))
    && (
      Reflect.get(value, "method") === "phone"
      || Reflect.get(value, "method") === "email"
      || Reflect.get(value, "method") === "telegram"
    )
    && Reflect.get(value, "version") === 1
  );
}

function buildHostedPrivyAuthIntentCookieValue(input: {
  maxAgeSeconds: number;
  value: string;
}): string {
  return [
    `${HOSTED_PRIVY_AUTH_INTENT_COOKIE_NAME}=${encodeURIComponent(input.value)}`,
    "Path=/",
    `Max-Age=${input.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

function signHostedPrivyAuthIntent(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${HOSTED_PRIVY_AUTH_INTENT_DOMAIN}.${encodedPayload}`)
    .digest("base64url");
}

function requireIntentSecret(override: string | undefined): string {
  // The Privy app secret is already required by this server-side authentication
  // boundary. Domain separation and the ten-minute TTL keep this stateless proof
  // independent from Privy's own API authentication while avoiding another key.
  const secret = override ?? getHostedOnboardingEnvironment().privyAppSecret;
  if (!secret) {
    throw hostedOnboardingError({
      code: "PRIVY_CONFIG_REQUIRED",
      message: "Secure sign-in is temporarily unavailable.",
      httpStatus: 503,
      retryable: true,
    });
  }
  return secret;
}

function normalizeInviteCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

function hostedPrivyMethodNotReadyCode(
  method: HostedPrivyAuthMethod,
): "PRIVY_PHONE_REQUIRED" | "PRIVY_EMAIL_REQUIRED" | "PRIVY_TELEGRAM_REQUIRED" {
  if (method === "phone") return "PRIVY_PHONE_REQUIRED";
  if (method === "email") return "PRIVY_EMAIL_REQUIRED";
  return "PRIVY_TELEGRAM_REQUIRED";
}

function hostedPrivyMethodLabel(method: HostedPrivyAuthMethod): string {
  if (method === "phone") return "phone number";
  if (method === "email") return "email address";
  return "Telegram account";
}

function invalidHostedPrivyAuthProof() {
  return hostedOnboardingError({
    code: "HOSTED_AUTH_PROOF_INVALID",
    message: "Request a fresh verification code and try again.",
    httpStatus: 401,
  });
}
