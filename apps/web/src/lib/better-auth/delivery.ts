import "server-only";
import { randomUUID } from "node:crypto";
import { readHostedResendPlainTextEmailConfig, sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type { HostedAuthDelivery } from "./auth";
import { hostedAuthCodeEmail } from "./code-email";

// Email delivery only. Better Auth owns email code generation and consumption.
// Provider response bodies, codes, contacts and authorization never enter logs.
export function hostedAuthDelivery(signal?: AbortSignal): HostedAuthDelivery {
  return {
    async email({ address, code }) {
      const config = readHostedResendPlainTextEmailConfig({
        ...process.env, HOSTED_SIGNUP_WELCOME_EMAIL_FROM: process.env.HOSTED_AUTH_EMAIL_FROM,
      });
      if (!config) throw deliveryUnavailable();
      try {
        await sendHostedResendPlainTextEmail({
          config, idempotencyKey: `auth-${randomUUID()}`, signal, to: [address],
          ...hostedAuthCodeEmail(code),
        });
      } catch { throw deliveryUnavailable(); }
    },
  };
}

function deliveryUnavailable() {
  return hostedOnboardingError({ code: "AUTH_DELIVERY_UNAVAILABLE", httpStatus: 503, message: "We could not send a sign-in code. Try again shortly." });
}

export function readHostedAuthSmsConfig() {
  const account = process.env.HOSTED_AUTH_TWILIO_ACCOUNT_SID ?? "";
  const key = process.env.HOSTED_AUTH_TWILIO_API_KEY_SID ?? "";
  const secret = process.env.HOSTED_AUTH_TWILIO_API_KEY_SECRET ?? "";
  const service = process.env.HOSTED_AUTH_TWILIO_MESSAGING_SERVICE_SID ?? "";
  return /^AC[0-9a-f]{32}$/iu.test(account) && /^SK[0-9a-f]{32}$/iu.test(key)
    && /^MG[0-9a-f]{32}$/iu.test(service) && secret ? { account, key, secret, service } : null;
}

export function isHostedAuthSmsReady(): boolean {
  return process.env.HOSTED_BETTER_AUTH_ENABLED === "true" && readHostedAuthSmsConfig() !== null;
}
