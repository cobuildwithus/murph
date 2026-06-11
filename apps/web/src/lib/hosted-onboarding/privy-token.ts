import { hostedOnboardingError } from "./errors";

export interface HostedPrivyCookieStore {
  get(name: string): { value?: string } | undefined;
}

export const HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME = "privy-id-token";

export function readHostedPrivyIdentityTokenFromCookieStore(cookieStore: HostedPrivyCookieStore): string | null {
  return normalizeHostedPrivyIdentityToken(
    cookieStore.get(HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME)?.value,
  );
}

export function readHostedPrivyIdentityTokenFromCookieHeader(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  for (const entry of value.split(/;\s*/u)) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    if (entry.slice(0, separatorIndex).trim() !== HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME) {
      continue;
    }

    const rawCookieValue = entry.slice(separatorIndex + 1);

    try {
      return normalizeHostedPrivyIdentityToken(decodeURIComponent(rawCookieValue));
    } catch {
      return normalizeHostedPrivyIdentityToken(rawCookieValue);
    }
  }

  return null;
}

export function readHostedPrivyIdentityTokenFromRequestCookies(request: Request): string | null {
  return readHostedPrivyIdentityTokenFromCookieHeader(request.headers.get("cookie"));
}

/**
 * Reads a Privy identity token from `Authorization: Bearer <token>`.
 * Used by native (non-browser) clients such as the iOS companion app.
 * Deliberately no cookie fallback: bearer-authenticated routes carry no
 * browser-session ambient authority, so they stay CSRF-immune.
 */
export function readHostedPrivyIdentityTokenFromAuthorizationHeader(request: Request): string | null {
  const header = request.headers.get("authorization");

  if (typeof header !== "string") {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim());
  return match ? normalizeHostedPrivyIdentityToken(match[1]) : null;
}

export function requireHostedPrivyIdentityToken(value: string | null | undefined): string {
  const token = normalizeHostedPrivyIdentityToken(value);

  if (!token) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
      message: "A Privy identity token is required to continue.",
      httpStatus: 401,
    });
  }

  return token;
}

function normalizeHostedPrivyIdentityToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
