import { hostedOnboardingError } from "../hosted-onboarding/errors";

const NATIVE_TOKEN_PREFIX = "murph_auth_v1.";
const SESSION_TOKEN = /^[A-Za-z0-9]{32}$/u;
const LEGACY_IDENTITY_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

type Credential = { kind: "better-auth"; token: string } | { kind: "anonymous" };

export function hostedAuthCookieName(secure: boolean): string {
  return secure ? "__Host-murph-auth-session" : "murph-auth-session";
}

export function classifyHostedBrowserCredential(input: {
  authorization: string | null;
  cookie: string | null;
  production: boolean;
}): Credential {
  if (input.authorization !== null) throw invalidCredential();
  const cookies = input.cookie?.split(";").map((value) => value.trim()) ?? [];
  const name = hostedAuthCookieName(input.production);
  const replacement = readCookie(cookies, name);
  // A presented replacement credential selects only its verifier. Invalid,
  // expired or revoked replacement state must never fall back to an old cookie.
  if (replacement !== null) return { kind: "better-auth", token: replacement };
  return { kind: "anonymous" };
}

export function classifyHostedNativeCredential(input: {
  authorization: string | null;
  cookie: string | null;
}): Exclude<Credential, { kind: "anonymous" }> {
  if (input.cookie !== null) throw invalidCredential();
  const match = /^Bearer ([^\s]+)$/iu.exec(input.authorization ?? "");
  if (!match || match[1].length > 8192) throw invalidCredential();
  const token = match[1];
  if (token.startsWith(NATIVE_TOKEN_PREFIX)) {
    const sessionToken = token.slice(NATIVE_TOKEN_PREFIX.length);
    if (!SESSION_TOKEN.test(sessionToken)) throw invalidCredential();
    return { kind: "better-auth", token: sessionToken };
  }
  if (token.startsWith("murph_auth") || !LEGACY_IDENTITY_TOKEN.test(token)) throw invalidCredential();
  throw hostedOnboardingError({ code: "AUTH_CLIENT_UPGRADE_REQUIRED", httpStatus: 426, message: "Update Murph to continue signing in." });
}

export function serializeHostedNativeSessionToken(token: string): string {
  if (!SESSION_TOKEN.test(token)) throw invalidCredential();
  return `${NATIVE_TOKEN_PREFIX}${token}`;
}

function readCookie(cookies: string[], name: string): string | null {
  const matches = cookies.filter((cookie) => cookie.startsWith(`${name}=`));
  if (matches.length > 1) throw invalidCredential();
  if (matches.length === 0) return null;
  const token = matches[0].slice(name.length + 1);
  if (!token || token.length > 4096) throw invalidCredential();
  return token;
}

function invalidCredential() {
  return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." });
}
