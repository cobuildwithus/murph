import "server-only";
import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey, type JWTPayload } from "jose";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

const issuer = "https://oauth.telegram.org";
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5_000 });
// Only the key-set fetch raises these: a non-200 or unreadable response, a
// malformed key set, or a timeout. The token was never judged.
const keySetFailures = new Set([errors.JOSEError.code, errors.JWKSInvalid.code, errors.JWKSTimeout.code]);

export function requireHostedTelegramClientId(): string {
  const clientId = process.env.HOSTED_AUTH_TELEGRAM_CLIENT_ID ?? "";
  if (!/^[1-9]\d{0,15}$/u.test(clientId)) throw new TypeError("Configure the Telegram Login client ID.");
  return clientId;
}

export async function verifyHostedTelegramIdToken(input: {
  token: string; clientId: string;
} & ({ nonce: string; transport?: "browser" } | { transport: "native"; nonce?: never }), keyResolver: JWTVerifyGetKey = keys) {
  const native = input.transport === "native";
  if (input.token.length > 8_192 || (!native && !/^[A-Za-z0-9_-]{43}$/u.test(input.nonce))) throw invalidToken("input");
  const { payload } = await jwtVerify(input.token, keyResolver, {
    issuer, audience: input.clientId, algorithms: ["RS256", "ES256"],
    requiredClaims: native ? ["exp", "iat", "sub"] : ["exp", "iat", "nonce"],
    maxTokenAge: native ? "2m" : "5m", clockTolerance: 5,
  }).catch((error: unknown) => { throw verificationFailure(error); });
  // OIDC sub and Telegram's Bot API user ID are different identifiers. Only
  // the verified profile id preserves the canonical messaging/login binding.
  if (!native && payload.nonce !== input.nonce) throw invalidToken("nonce_mismatch");
  const telegramUserId = readTelegramProfileId(payload.id);
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") throw invalidToken("timestamp");
  const authenticatedAt = new Date(payload.iat * 1_000);
  const expiresAt = new Date(payload.exp * 1_000);
  if (!Number.isFinite(authenticatedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) throw invalidToken("timestamp");
  if (native) assertNativeFreshness(payload, authenticatedAt, expiresAt);
  return { telegramUserId, authenticatedAt, expiresAt };
}

function verificationFailure(error: unknown) {
  // A failed key-set request (a network error is not a JOSE error) is an outage,
  // not a bad token, so it uses the provider-outage code the SMS verifier
  // already answers with. The message is unchanged.
  if (!(error instanceof errors.JOSEError) || keySetFailures.has(error.code)) {
    return hostedOnboardingError({
      cause: error, code: "AUTH_VERIFICATION_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Telegram sign-in could not be verified. Try again.", details: { code: "telegram_verification_unavailable" },
    });
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    const claim = ["iss", "aud", "iat", "exp", "nonce"].includes(error.claim) ? error.claim : "other";
    return invalidToken(`claim_${claim}`);
  }
  return invalidToken(error.code);
}

function assertNativeFreshness(payload: JWTPayload, authenticatedAt: Date, expiresAt: Date) {
  const now = Date.now();
  if (now - authenticatedAt.getTime() > 120_000 || authenticatedAt.getTime() - now > 5_000
    || expiresAt.getTime() <= now || typeof payload.sub !== "string" || !payload.sub) throw invalidToken("freshness");
}

function readTelegramProfileId(value: unknown): string {
  const id = typeof value === "number" ? String(value) : value;
  if (typeof id !== "string" || !/^[1-9]\d{0,15}$/u.test(id) || !Number.isSafeInteger(Number(id))) {
    throw invalidToken(value === undefined ? "profile_id_missing" : "profile_id_format");
  }
  return id;
}

function invalidToken(reason: string) {
  return hostedOnboardingError({ code: "AUTH_TELEGRAM_INVALID", httpStatus: 401, message: "Telegram sign-in could not be verified. Try again.", details: { code: `telegram_${reason}` } });
}
