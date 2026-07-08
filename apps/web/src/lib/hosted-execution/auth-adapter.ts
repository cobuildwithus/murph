import { getVercelOidcToken } from "@vercel/oidc";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

const HOSTED_EXECUTION_VERCEL_OIDC_DEFAULT_CACHE_KEY = "default";
const HOSTED_EXECUTION_VERCEL_OIDC_REFRESH_MARGIN_MS = 60_000;

interface CachedHostedExecutionVercelOidcToken {
  expiresAtEpochMs: number;
  token: string;
}

const hostedExecutionVercelOidcTokenCache = new Map<
  string,
  CachedHostedExecutionVercelOidcToken
>();
const hostedExecutionVercelOidcTokenRefreshes = new Map<string, Promise<string>>();

export function createHostedExecutionVercelOidcBearerTokenProvider(): () => Promise<string> {
  return () =>
    readCachedHostedExecutionVercelOidcBearerToken(
      HOSTED_EXECUTION_VERCEL_OIDC_DEFAULT_CACHE_KEY,
    );
}

async function readHostedExecutionVercelOidcBearerToken(): Promise<string> {
  const token = await getVercelOidcToken();

  if (typeof token !== "string" || token.trim().length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_VERCEL_OIDC_TOKEN_REQUIRED",
      message:
        "Vercel OIDC must be enabled and available before hosted execution requests can reach Cloudflare.",
      httpStatus: 500,
    });
  }

  return token.trim();
}

async function readCachedHostedExecutionVercelOidcBearerToken(
  cacheKey: string,
): Promise<string> {
  const now = Date.now();
  const cached = hostedExecutionVercelOidcTokenCache.get(cacheKey);

  if (cached && isHostedExecutionVercelOidcTokenFresh(cached, now)) {
    return cached.token;
  }

  const inFlight = hostedExecutionVercelOidcTokenRefreshes.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const refresh = refreshHostedExecutionVercelOidcBearerToken(cacheKey);
  hostedExecutionVercelOidcTokenRefreshes.set(cacheKey, refresh);
  try {
    return await refresh;
  } finally {
    hostedExecutionVercelOidcTokenRefreshes.delete(cacheKey);
  }
}

async function refreshHostedExecutionVercelOidcBearerToken(
  cacheKey: string,
): Promise<string> {
  const token = await readHostedExecutionVercelOidcBearerToken();
  const expiresAtEpochMs = readJwtExpiresAtEpochMs(token);

  if (expiresAtEpochMs === null) {
    hostedExecutionVercelOidcTokenCache.delete(cacheKey);
    return token;
  }

  const cached = {
    expiresAtEpochMs,
    token,
  };
  if (isHostedExecutionVercelOidcTokenFresh(cached, Date.now())) {
    hostedExecutionVercelOidcTokenCache.set(cacheKey, cached);
  } else {
    hostedExecutionVercelOidcTokenCache.delete(cacheKey);
  }

  return token;
}

function isHostedExecutionVercelOidcTokenFresh(
  cached: CachedHostedExecutionVercelOidcToken,
  nowEpochMs: number,
): boolean {
  return cached.expiresAtEpochMs - HOSTED_EXECUTION_VERCEL_OIDC_REFRESH_MARGIN_MS > nowEpochMs;
}

function readJwtExpiresAtEpochMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }
    const expiresAtEpochMs = payload.exp * 1000;
    return Number.isSafeInteger(expiresAtEpochMs) && expiresAtEpochMs > 0
      ? expiresAtEpochMs
      : null;
  } catch {
    return null;
  }
}
