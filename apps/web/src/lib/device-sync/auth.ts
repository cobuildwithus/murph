import { createHmac, timingSafeEqual } from "node:crypto";

import { deviceSyncError } from "@murph/device-syncd";

import type { HostedDeviceSyncEnvironment } from "./env";
import { isRecord, normalizeNullableString, sha256Hex, toIsoTimestamp } from "./shared";

const HOSTED_USER_ASSERTION_SIGNATURE_CONTEXT = "hbds-user-assertion.v1:";
const HOSTED_USER_ASSERTION_MAX_TTL_SECONDS = 5 * 60;
const HOSTED_USER_ASSERTION_CLOCK_SKEW_SECONDS = 60;
const HOSTED_USER_ASSERTION_NONCE_MIN_LENGTH = 16;

export interface AuthenticatedHostedUser {
  id: string;
  email: string | null;
  name: string | null;
  source: "trusted-header" | "development-fallback";
}

export interface HostedUserAssertionClaims {
  id: string;
  email: string | null;
  name: string | null;
  aud: string;
  method: string;
  path: string;
  origin: string | null;
  nonce: string;
  iat: number;
  exp: number;
}

export interface HostedBrowserAssertionNonceStore {
  consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean>;
}

interface RequireAuthenticatedHostedUserOptions {
  nonceStore?: HostedBrowserAssertionNonceStore;
  now?: Date;
}

export async function requireAuthenticatedHostedUser(
  request: Request,
  env: HostedDeviceSyncEnvironment,
  options: RequireAuthenticatedHostedUserOptions = {},
): Promise<AuthenticatedHostedUser> {
  const signedHostedUser = await readSignedHostedUser(request, env, options);

  if (signedHostedUser) {
    return signedHostedUser;
  }

  if (!env.isProduction && env.devUserId) {
    return {
      id: env.devUserId,
      email: env.devUserEmail,
      name: env.devUserName,
      source: "development-fallback",
    };
  }

  throw deviceSyncError({
    code: "AUTH_REQUIRED",
    message:
      "Hosted device-sync browser routes require a cryptographically verified hosted user assertion or DEVICE_SYNC_DEV_USER_ID in development.",
    retryable: false,
    httpStatus: 401,
  });
}

export function assertBrowserMutationOrigin(request: Request, env: HostedDeviceSyncEnvironment): void {
  const origin = normalizeHeaderValue(request.headers.get("origin"));

  if (!origin) {
    throw deviceSyncError({
      code: "CSRF_ORIGIN_REQUIRED",
      message: "Hosted device-sync browser mutation routes require an Origin header.",
      retryable: false,
      httpStatus: 403,
    });
  }

  const requestOrigin = new URL(request.url).origin;

  if (origin === requestOrigin || env.allowedMutationOrigins.includes(origin)) {
    return;
  }

  throw deviceSyncError({
    code: "CSRF_ORIGIN_INVALID",
    message: `Mutation origin ${origin} is not allowed for hosted device-sync routes.`,
    retryable: false,
    httpStatus: 403,
    details: {
      origin,
    },
  });
}

export function encodeHostedUserAssertion(claims: HostedUserAssertionClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

export function createHostedUserAssertionSignature(assertion: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(HOSTED_USER_ASSERTION_SIGNATURE_CONTEXT)
    .update(assertion)
    .digest("hex");
}

async function readSignedHostedUser(
  request: Request,
  env: HostedDeviceSyncEnvironment,
  options: RequireAuthenticatedHostedUserOptions,
): Promise<AuthenticatedHostedUser | null> {
  const assertion = normalizeHeaderValue(request.headers.get(env.trustedUserAssertionHeader));
  const signature = normalizeHeaderValue(request.headers.get(env.trustedUserSignatureHeader));
  const hasAnyTrustedHeader = Boolean(assertion || signature);

  if (!hasAnyTrustedHeader) {
    return null;
  }

  if (!assertion) {
    throw invalidHostedUserHeaders(
      `Hosted device-sync user headers must include the configured ${env.trustedUserAssertionHeader} assertion header.`,
    );
  }

  if (!env.trustedUserSigningSecret) {
    throw invalidHostedUserHeaders(
      "Hosted device-sync user assertions require DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET verification.",
    );
  }

  if (!signature) {
    throw invalidHostedUserHeaders(
      `Hosted device-sync user headers must include the configured ${env.trustedUserSignatureHeader} signature header.`,
    );
  }

  const expectedSignature = createHostedUserAssertionSignature(assertion, env.trustedUserSigningSecret);

  if (!secureEqual(expectedSignature, signature)) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion signature is invalid.");
  }

  const claims = parseHostedUserAssertion(assertion);
  const now = options.now ?? new Date();
  const nowIso = toIsoTimestamp(now);
  validateHostedUserAssertionClaims(claims, request, env, now);

  if (!options.nonceStore) {
    throw deviceSyncError({
      code: "AUTH_CONFIGURATION_INVALID",
      message: "Hosted device-sync user assertions require a nonce store for replay protection.",
      retryable: false,
      httpStatus: 500,
    });
  }

  const consumed = await options.nonceStore.consumeBrowserAssertionNonce({
    nonceHash: sha256Hex(claims.nonce),
    userId: claims.id,
    method: claims.method,
    path: claims.path,
    now: nowIso,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  });

  if (!consumed) {
    throw deviceSyncError({
      code: "AUTH_ASSERTION_REPLAYED",
      message: "Hosted device-sync user assertion was already used and cannot be replayed.",
      retryable: false,
      httpStatus: 401,
    });
  }

  return {
    id: claims.id,
    email: claims.email,
    name: claims.name,
    source: "trusted-header",
  };
}

function parseHostedUserAssertion(assertion: string): HostedUserAssertionClaims {
  let decoded = "";

  try {
    decoded = Buffer.from(assertion, "base64url").toString("utf8");
  } catch {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion payload is not valid base64url JSON.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion payload is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion payload must be a JSON object.");
  }

  const id = normalizeStringClaim(parsed.id);
  const aud = normalizeStrictOriginClaim(parsed.aud);
  const method = normalizeMethodClaim(parsed.method);
  const path = normalizePathClaim(parsed.path);
  const origin = normalizeNullableStrictOriginClaim(parsed.origin);
  const nonce = normalizeStringClaim(parsed.nonce);
  const iat = normalizeNumericClaim(parsed.iat);
  const exp = normalizeNumericClaim(parsed.exp);

  if (!id || !aud || !method || !path || !nonce || iat === null || exp === null) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion payload is missing required claims.");
  }

  if (nonce.length < HOSTED_USER_ASSERTION_NONCE_MIN_LENGTH) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion nonce is too short.");
  }

  return {
    id,
    email: normalizeStringClaim(parsed.email),
    name: normalizeStringClaim(parsed.name),
    aud,
    method,
    path,
    origin,
    nonce,
    iat,
    exp,
  };
}

function validateHostedUserAssertionClaims(
  claims: HostedUserAssertionClaims,
  request: Request,
  env: HostedDeviceSyncEnvironment,
  now: Date,
): void {
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= claims.iat) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion timestamps are invalid.");
  }

  if (claims.exp - claims.iat > HOSTED_USER_ASSERTION_MAX_TTL_SECONDS) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion lifetime is too long.");
  }

  if (claims.iat > nowSeconds + HOSTED_USER_ASSERTION_CLOCK_SKEW_SECONDS) {
    throw deviceSyncError({
      code: "AUTH_ASSERTION_STALE",
      message: "Hosted device-sync user assertion is not yet valid.",
      retryable: false,
      httpStatus: 401,
    });
  }

  if (claims.exp < nowSeconds - HOSTED_USER_ASSERTION_CLOCK_SKEW_SECONDS) {
    throw deviceSyncError({
      code: "AUTH_ASSERTION_STALE",
      message: "Hosted device-sync user assertion expired.",
      retryable: false,
      httpStatus: 401,
    });
  }

  const url = new URL(request.url);
  const requestMethod = request.method.toUpperCase();
  const requestOriginHeader = normalizeStrictOriginHeaderValue(request.headers.get("origin"));
  const allowedAudiences = new Set<string>([url.origin]);

  if (env.publicBaseUrl) {
    allowedAudiences.add(new URL(env.publicBaseUrl).origin);
  }

  if (!allowedAudiences.has(claims.aud)) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion audience is invalid.");
  }

  if (claims.method !== requestMethod) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion method binding is invalid.");
  }

  if (claims.path !== url.pathname) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion path binding is invalid.");
  }

  if (claims.origin !== requestOriginHeader) {
    throw invalidHostedUserHeaders("Hosted device-sync user assertion origin binding is invalid.");
  }
}

function secureEqual(expectedValue: string, providedValue: string): boolean {
  const expected = Buffer.from(expectedValue, "utf8");
  const provided = Buffer.from(providedValue, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function invalidHostedUserHeaders(message: string) {
  return deviceSyncError({
    code: "AUTH_HEADER_INVALID",
    message,
    retryable: false,
    httpStatus: 401,
  });
}

function normalizeHeaderValue(value: string | null): string | null {
  return normalizeNullableString(value);
}

function normalizeStringClaim(value: unknown): string | null {
  return typeof value === "string" ? normalizeNullableString(value) : null;
}

function normalizeMethodClaim(value: unknown): string | null {
  const normalized = normalizeStringClaim(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizePathClaim(value: unknown): string | null {
  const normalized = normalizeStringClaim(value);
  return normalized && normalized.startsWith("/") ? normalized : null;
}

function normalizeStrictOriginHeaderValue(value: string | null): string | null {
  return value ? normalizeStrictOriginClaim(value) : null;
}

function normalizeStrictOriginClaim(value: unknown): string | null {
  const normalized = normalizeStringClaim(value);

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    return url.origin === normalized ? url.origin : null;
  } catch {
    return null;
  }
}

function normalizeNullableStrictOriginClaim(value: unknown): string | null {
  return value === null || value === undefined ? null : normalizeStrictOriginClaim(value);
}

function normalizeNumericClaim(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
