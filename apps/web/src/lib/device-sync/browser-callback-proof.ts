import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";

const HOSTED_DEVICE_SYNC_CALLBACK_PROOF_DOMAIN =
  "murph.hosted-device-sync-browser-callback";
// The app's completion proof has its own signing domain and token prefix, so a
// browser cookie value can never finish an app-started connection or the reverse.
const HOSTED_DEVICE_SYNC_APP_COMPLETION_PROOF_DOMAIN =
  "murph.hosted-device-sync-app-completion";
const HOSTED_DEVICE_SYNC_APP_COMPLETION_PROOF_TOKEN_PREFIX =
  "murph_device_sync_app_completion_v1";
const HOSTED_DEVICE_SYNC_CALLBACK_PROOF_VERSION = 1;
const HOSTED_DEVICE_SYNC_CALLBACK_PROOF_MAX_AGE_SECONDS = 15 * 60;
const HOSTED_DEVICE_SYNC_CALLBACK_PROOF_TOKEN_PREFIX = "murph_device_sync_callback_v1";
const HOSTED_DEVICE_SYNC_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const HOSTED_DEVICE_SYNC_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type HostedDeviceSyncCallbackProofScope = { domain: string; tokenPrefix: string };
const BROWSER_CALLBACK_PROOF_SCOPE: HostedDeviceSyncCallbackProofScope = {
  domain: HOSTED_DEVICE_SYNC_CALLBACK_PROOF_DOMAIN,
  tokenPrefix: HOSTED_DEVICE_SYNC_CALLBACK_PROOF_TOKEN_PREFIX,
};
const APP_COMPLETION_PROOF_SCOPE: HostedDeviceSyncCallbackProofScope = {
  domain: HOSTED_DEVICE_SYNC_APP_COMPLETION_PROOF_DOMAIN,
  tokenPrefix: HOSTED_DEVICE_SYNC_APP_COMPLETION_PROOF_TOKEN_PREFIX,
};

type HostedDeviceSyncCallbackProofBinding = {
  memberId: string;
  now?: Date;
  provider: string;
  sessionId: string;
  state: string;
};

export function buildHostedDeviceSyncCallbackProof(
  input: HostedDeviceSyncCallbackProofBinding,
): { cookie: string; expiresAt: Date } {
  const proof = buildHostedDeviceSyncCallbackProofToken(BROWSER_CALLBACK_PROOF_SCOPE, input);

  return {
    cookie: buildHostedDeviceSyncCallbackProofCookie({
      maxAgeSeconds: HOSTED_DEVICE_SYNC_CALLBACK_PROOF_MAX_AGE_SECONDS,
      provider: proof.provider,
      value: proof.token,
    }),
    expiresAt: proof.expiresAt,
  };
}

/**
 * The proof the Murph app holds in memory between starting a connection and
 * finishing it. It binds the member, the app session that started, the
 * provider, the pending state and a 15-minute expiry, like the browser cookie.
 */
export function buildHostedDeviceSyncAppCompletionProof(
  input: HostedDeviceSyncCallbackProofBinding,
): string {
  return buildHostedDeviceSyncCallbackProofToken(APP_COMPLETION_PROOF_SCOPE, input).token;
}

function buildHostedDeviceSyncCallbackProofToken(
  scope: HostedDeviceSyncCallbackProofScope,
  input: HostedDeviceSyncCallbackProofBinding,
): { expiresAt: Date; provider: string; token: string } {
  const provider = requireHostedDeviceSyncProvider(input.provider);
  const state = requireHostedDeviceSyncState(input.state);
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + HOSTED_DEVICE_SYNC_CALLBACK_PROOF_MAX_AGE_SECONDS * 1_000,
  );
  const expiresAtMs = expiresAt.getTime();
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new TypeError("Hosted device-sync callback proof expiry is invalid.");
  }

  const authenticator = createHostedDeviceSyncCallbackProofAuthenticator(scope, {
    expiresAtMs,
    memberId: input.memberId,
    provider,
    sessionId: input.sessionId,
    state,
  });

  return {
    expiresAt,
    provider,
    token: [scope.tokenPrefix, expiresAtMs, authenticator].join("."),
  };
}

export type HostedDeviceSyncCallbackProofError =
  | "CALLBACK_STATE_INVALID"
  | "CALLBACK_PROOF_MISSING"
  | "CALLBACK_PROOF_MALFORMED"
  | "CALLBACK_PROOF_EXPIRED"
  | "CALLBACK_PROOF_MISMATCH";

export function readHostedDeviceSyncCallbackProofError(input: {
  memberId: string;
  now?: Date;
  provider: string;
  request: Request;
  sessionId: string;
  state: string | null;
}): HostedDeviceSyncCallbackProofError | null {
  return readHostedDeviceSyncCallbackProofTokenError(BROWSER_CALLBACK_PROOF_SCOPE, {
    ...input,
    readToken: (provider) => readCookieFromRequest(
      input.request,
      hostedDeviceSyncCallbackProofCookieName(provider),
    ),
  });
}

/** Checks a proof the app sent back in a request body, never one from a URL or cookie. */
export function readHostedDeviceSyncAppCompletionProofError(input: {
  completionProof: string | null;
  memberId: string;
  now?: Date;
  provider: string;
  sessionId: string;
  state: string | null;
}): HostedDeviceSyncCallbackProofError | null {
  return readHostedDeviceSyncCallbackProofTokenError(APP_COMPLETION_PROOF_SCOPE, {
    ...input,
    readToken: () => input.completionProof,
  });
}

function readHostedDeviceSyncCallbackProofTokenError(
  scope: HostedDeviceSyncCallbackProofScope,
  input: {
    memberId: string;
    now?: Date;
    provider: string;
    readToken: (provider: string) => string | null;
    sessionId: string;
    state: string | null;
  },
): HostedDeviceSyncCallbackProofError | null {
  const provider = normalizeHostedDeviceSyncProvider(input.provider);
  const state = normalizeHostedDeviceSyncState(input.state);
  if (!provider || !state) {
    return "CALLBACK_STATE_INVALID";
  }

  const tokenValue = input.readToken(provider);
  if (!tokenValue) {
    return "CALLBACK_PROOF_MISSING";
  }

  const tokenParts = tokenValue.split(".");
  if (tokenParts.length !== 3 || tokenParts[0] !== scope.tokenPrefix) {
    return "CALLBACK_PROOF_MALFORMED";
  }

  const expiresAtMs = Number(tokenParts[1]);
  const authenticator = tokenParts[2] ?? "";
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs > nowMs + HOSTED_DEVICE_SYNC_CALLBACK_PROOF_MAX_AGE_SECONDS * 1_000
    || !SHA256_BASE64URL_PATTERN.test(authenticator)
  ) {
    return "CALLBACK_PROOF_MALFORMED";
  }

  if (expiresAtMs <= nowMs) {
    return "CALLBACK_PROOF_EXPIRED";
  }

  const expectedAuthenticator = createHostedDeviceSyncCallbackProofAuthenticator(scope, {
    expiresAtMs,
    memberId: input.memberId,
    provider,
    sessionId: input.sessionId,
    state,
  });

  return safeEqual(authenticator, expectedAuthenticator) ? null : "CALLBACK_PROOF_MISMATCH";
}

export function readHostedDeviceSyncCallbackState(url: URL): string | null {
  return normalizeHostedDeviceSyncState(
    url.searchParams.get("murph_state") ?? url.searchParams.get("state"),
  );
}

function createHostedDeviceSyncCallbackProofAuthenticator(
  scope: HostedDeviceSyncCallbackProofScope,
  input: {
    expiresAtMs: number;
    memberId: string;
    provider: string;
    sessionId: string;
    state: string;
  },
): string {
  const payload = JSON.stringify([
    scope.domain,
    HOSTED_DEVICE_SYNC_CALLBACK_PROOF_VERSION,
    input.expiresAtMs,
    input.provider,
    input.state,
    input.memberId,
    input.sessionId,
  ]);

  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(payload, "utf8")
    .digest("base64url");
}

function hostedDeviceSyncCallbackProofCookieName(provider: string): string {
  const prefix = process.env.NODE_ENV === "production"
    ? "__Host-murph-device-sync"
    : "murph-device-sync";
  return `${prefix}-${provider}`;
}

function buildHostedDeviceSyncCallbackProofCookie(input: {
  maxAgeSeconds: number;
  provider: string;
  value: string;
}): string {
  return [
    `${hostedDeviceSyncCallbackProofCookieName(input.provider)}=${encodeURIComponent(input.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
    process.env.NODE_ENV === "production" ? "Secure" : null,
  ].filter((part): part is string => Boolean(part)).join("; ");
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

function requireHostedDeviceSyncProvider(provider: string): string {
  const normalized = normalizeHostedDeviceSyncProvider(provider);
  if (!normalized) {
    throw new TypeError("Hosted device-sync callback proof provider is invalid.");
  }
  return normalized;
}

function normalizeHostedDeviceSyncProvider(provider: string): string | null {
  const normalized = provider.trim().toLowerCase();
  return HOSTED_DEVICE_SYNC_PROVIDER_PATTERN.test(normalized) ? normalized : null;
}

function requireHostedDeviceSyncState(state: string): string {
  const normalized = normalizeHostedDeviceSyncState(state);
  if (!normalized) {
    throw new TypeError("Hosted device-sync callback proof state is invalid.");
  }
  return normalized;
}

function normalizeHostedDeviceSyncState(state: string | null | undefined): string | null {
  const normalized = state?.trim() ?? "";
  return HOSTED_DEVICE_SYNC_STATE_PATTERN.test(normalized) ? normalized : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
