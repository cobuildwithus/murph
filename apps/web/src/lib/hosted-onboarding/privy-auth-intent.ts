import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeHostedEmailAddress } from "./contact-normalization";
import { hostedOnboardingError } from "./errors";
import type { HostedPrivyUser } from "./privy";
import {
  coerceHostedPrivyPhoneAccount,
  coerceHostedPrivyTelegramAccount,
  coerceHostedPrivyVerifiedEmailAccount,
  readHostedPrivyLinkedAccountVerifiedAt,
  resolveHostedPrivyLinkedAccounts,
  type HostedPrivyEmailAccount,
  type HostedPrivyPhoneAccount,
  type HostedPrivyTelegramAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import { getHostedOnboardingEnvironment } from "./runtime";
import { isHostedPrivyAuthMethod, type HostedPrivyAuthMethod } from "./types";

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

export type HostedPrivyAuthenticationProof =
  | {
      credential: HostedPrivyEmailAccount & { verifiedAt: number };
      method: "email";
      privyUserId: string;
    }
  | {
      credential: HostedPrivyPhoneAccount;
      method: "phone";
      privyUserId: string;
    }
  | {
      credential: HostedPrivyTelegramAccount & { verifiedAt: number };
      method: "telegram";
      privyUserId: string;
    };

export interface VerifiedHostedPrivyAuthIntent {
  expiresAt: number;
  issuedAt: number;
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

export function verifyHostedPrivyAuthIntent(input: {
  intent: string | null | undefined;
  inviteCode?: string | null;
  now?: Date;
  secret?: string;
}): VerifiedHostedPrivyAuthIntent {
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

  return {
    expiresAt: payload.expiresAt,
    issuedAt: payload.issuedAt,
    method: payload.method,
  };
}

export function verifyHostedPrivyAuthenticationProof(input: {
  intent: VerifiedHostedPrivyAuthIntent;
  now?: Date;
  verifiedPrivyUser: HostedPrivyUser;
}): HostedPrivyAuthenticationProof {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (input.intent.expiresAt < nowSeconds) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTH_PROOF_EXPIRED",
      message: "Request a fresh verification code and try again.",
      httpStatus: 401,
    });
  }

  const proof = resolveUniqueNewestHostedPrivyAuthenticationProof(input.verifiedPrivyUser);
  const verifiedAt = proof?.credential.verifiedAt ?? null;
  if (
    verifiedAt === null
    || verifiedAt < input.intent.issuedAt - HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS
    || verifiedAt > nowSeconds + HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS
    || proof?.method !== input.intent.method
  ) {
    throw hostedOnboardingError({
      code: hostedPrivyMethodNotReadyCode(input.intent.method),
      message: `Your verified ${hostedPrivyMethodLabel(input.intent.method)} has not reached the server-side Privy session yet. Wait a moment and try again.`,
      httpStatus: 409,
      retryable: true,
    });
  }

  return proof;
}

export function verifyHostedPrivyLegacyAuthIntent(input: {
  identityTokenIssuedAt: number | null;
  method: unknown;
  now?: Date;
}): VerifiedHostedPrivyAuthIntent {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const issuedAt = normalizeTimestamp(input.identityTokenIssuedAt);

  if (
    !isHostedPrivyAuthMethod(input.method)
    || issuedAt === null
    || issuedAt > nowSeconds + HOSTED_PRIVY_AUTH_INTENT_CLOCK_SKEW_SECONDS
    || issuedAt + HOSTED_PRIVY_AUTH_INTENT_TTL_SECONDS < nowSeconds
  ) {
    throw hostedPrivyClientUpdateRequired();
  }

  return {
    expiresAt: issuedAt + HOSTED_PRIVY_AUTH_INTENT_TTL_SECONDS,
    issuedAt,
    method: input.method,
  };
}

interface HostedPrivyAuthenticationCandidate {
  dedupeKey: string | null;
  proof: HostedPrivyAuthenticationProof | null;
  verifiedAt: number;
}

function resolveUniqueNewestHostedPrivyAuthenticationProof(
  verifiedPrivyUser: HostedPrivyUser,
): HostedPrivyAuthenticationProof | null {
  const candidates = resolveHostedPrivyLinkedAccounts(verifiedPrivyUser)
    .filter(isHostedPrivyLoginCapableAccount)
    .map((account) => buildHostedPrivyAuthenticationCandidate({
      account,
      privyUserId: verifiedPrivyUser.id,
    }))
    .filter((candidate): candidate is HostedPrivyAuthenticationCandidate => candidate !== null);

  const directTelegram = verifiedPrivyUser.telegram;
  if (isRecord(directTelegram)) {
    const directCandidate = buildHostedPrivyTelegramAuthenticationCandidate({
      account: directTelegram,
      privyUserId: verifiedPrivyUser.id,
    });
    if (directCandidate) {
      candidates.push(directCandidate);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const newestVerifiedAt = Math.max(...candidates.map((candidate) => candidate.verifiedAt));
  const newestCandidates = candidates.filter(
    (candidate) => candidate.verifiedAt === newestVerifiedAt,
  );
  if (newestCandidates.some((candidate) => candidate.proof === null || candidate.dedupeKey === null)) {
    return null;
  }

  const uniqueProofs = new Map<string, HostedPrivyAuthenticationProof>();
  for (const candidate of newestCandidates) {
    if (candidate.dedupeKey && candidate.proof) {
      uniqueProofs.set(candidate.dedupeKey, candidate.proof);
    }
  }

  return uniqueProofs.size === 1
    ? uniqueProofs.values().next().value ?? null
    : null;
}

function buildHostedPrivyAuthenticationCandidate(input: {
  account: PrivyLinkedAccountLike;
  privyUserId: string;
}): HostedPrivyAuthenticationCandidate | null {
  const verifiedAt = readHostedPrivyLinkedAccountVerifiedAt(input.account);
  if (verifiedAt === null) {
    return null;
  }

  if (input.account.type === "email") {
    const credential = coerceHostedPrivyVerifiedEmailAccount(input.account);
    const normalizedAddress = normalizeHostedEmailAddress(credential?.address);
    if (!credential || !normalizedAddress) {
      return { dedupeKey: null, proof: null, verifiedAt };
    }
    return {
      dedupeKey: `email:${normalizedAddress}`,
      proof: {
        credential: { address: normalizedAddress, verifiedAt },
        method: "email",
        privyUserId: input.privyUserId,
      },
      verifiedAt,
    };
  }

  if (input.account.type === "phone") {
    const credential = coerceHostedPrivyPhoneAccount(input.account);
    if (!credential) {
      return { dedupeKey: null, proof: null, verifiedAt };
    }
    return {
      dedupeKey: `phone:${credential.number}`,
      proof: {
        credential,
        method: "phone",
        privyUserId: input.privyUserId,
      },
      verifiedAt,
    };
  }

  if (input.account.type === "telegram") {
    return buildHostedPrivyTelegramAuthenticationCandidate({
      account: input.account,
      privyUserId: input.privyUserId,
    });
  }

  return { dedupeKey: null, proof: null, verifiedAt };
}

function buildHostedPrivyTelegramAuthenticationCandidate(input: {
  account: Record<string, unknown>;
  privyUserId: string;
}): HostedPrivyAuthenticationCandidate | null {
  const verifiedAt = readHostedPrivyLinkedAccountVerifiedAt(input.account);
  if (verifiedAt === null) {
    return null;
  }

  const credential = coerceHostedPrivyTelegramAccount(input.account);
  if (!credential) {
    return { dedupeKey: null, proof: null, verifiedAt };
  }

  return {
    dedupeKey: `telegram:${credential.telegramUserId}`,
    proof: {
      credential: { ...credential, verifiedAt },
      method: "telegram",
      privyUserId: input.privyUserId,
    },
    verifiedAt,
  };
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

function hostedPrivyClientUpdateRequired() {
  return hostedOnboardingError({
    code: "HOSTED_CLIENT_UPDATE_REQUIRED",
    message: "Reload this page and verify again to finish signing in.",
    httpStatus: 409,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
