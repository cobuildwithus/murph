import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

const issuer = "https://oauth.telegram.org";
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5_000 });

export function requireHostedTelegramClientId(): string {
  const clientId = process.env.HOSTED_AUTH_TELEGRAM_CLIENT_ID ?? "";
  if (!/^[1-9]\d{0,15}$/u.test(clientId)) throw new TypeError("Configure the Telegram Login client ID.");
  return clientId;
}

export async function verifyHostedTelegramIdToken(input: {
  token: string; nonce: string; clientId: string;
}, keyResolver: JWTVerifyGetKey = keys) {
  if (input.token.length > 8_192 || !/^[A-Za-z0-9_-]{43}$/u.test(input.nonce)) throw invalidToken();
  try {
    const { payload } = await jwtVerify(input.token, keyResolver, {
      issuer, audience: input.clientId, algorithms: ["RS256", "ES256"],
      requiredClaims: ["exp", "iat", "nonce"], maxTokenAge: "5m", clockTolerance: 5,
    });
    // OIDC sub and Telegram's Bot API user ID are different identifiers. Only
    // the verified profile id preserves the canonical messaging/login binding.
    if (payload.nonce !== input.nonce || typeof payload.id !== "number"
      || !Number.isSafeInteger(payload.id) || payload.id <= 0
      || typeof payload.iat !== "number" || typeof payload.exp !== "number") throw invalidToken();
    const authenticatedAt = new Date(payload.iat * 1_000);
    const expiresAt = new Date(payload.exp * 1_000);
    if (!Number.isFinite(authenticatedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) throw invalidToken();
    return { telegramUserId: String(payload.id), authenticatedAt, expiresAt };
  } catch {
    throw invalidToken();
  }
}

function invalidToken() {
  return hostedOnboardingError({ code: "AUTH_TELEGRAM_INVALID", httpStatus: 401, message: "Telegram verification expired. Try again." });
}
