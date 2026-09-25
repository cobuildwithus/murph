import "server-only";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { requireHostedOnboardingPublicBaseUrl } from "../hosted-onboarding/runtime";

export function requireHostedBetterAuthConfig() {
  const secret = process.env.HOSTED_BETTER_AUTH_SECRET ?? "";
  const key = Buffer.from(secret, "base64url");
  try {
    if (key.length !== 32 || key.toString("base64url") !== secret) {
      throw new TypeError("HOSTED_BETTER_AUTH_SECRET must be a canonical 32-byte base64url key.");
    }
  } finally { key.fill(0); }
  return { baseURL: requireHostedOnboardingPublicBaseUrl(), secret };
}

export function assertHostedBetterAuthIssuanceEnabled(): void {
  if (process.env.HOSTED_BETTER_AUTH_ENABLED !== "true") {
    throw hostedOnboardingError({ code: "AUTH_UNAVAILABLE", httpStatus: 503, message: "Sign-in is temporarily unavailable. Try again shortly." });
  }
}
