import "server-only";
import { randomUUID } from "node:crypto";
import { readHostedResendPlainTextEmailConfig, sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type { HostedAuthDelivery } from "./auth";

// Delivery only. Better Auth owns generation, storage, expiry and consumption.
// Provider response bodies, codes, contacts and authorization never enter logs.
export function hostedAuthDelivery(signal?: AbortSignal): HostedAuthDelivery {
  return {
    async email({ address, code }) {
      const config = readHostedResendPlainTextEmailConfig({
        ...process.env, HOSTED_SIGNUP_WELCOME_EMAIL_FROM: process.env.HOSTED_AUTH_EMAIL_FROM,
      });
      if (!config || !/^\d{6}$/u.test(code)) throw deliveryUnavailable();
      try {
        await sendHostedResendPlainTextEmail({
          config, idempotencyKey: `auth-${randomUUID()}`, signal, to: [address],
          subject: "Your Murph sign-in code",
          text: `Your Murph sign-in code is ${code}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`,
        });
      } catch { throw deliveryUnavailable(); }
    },
    async sms({ phoneNumber, code }) {
      const config = readHostedAuthSmsConfig();
      if (!config || !/^\d{6}$/u.test(code) || !/^\+[1-9]\d{6,14}$/u.test(phoneNumber)) throw deliveryUnavailable();
      const { account, key, secret, service } = config;
      try {
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
          method: "POST", redirect: "error", cache: "no-store",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
          headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            To: phoneNumber, MessagingServiceSid: service,
            Body: `${code} is your Murph sign-in code. It expires in 5 minutes.`,
            ValidityPeriod: "300", ContentRetention: "discard", AddressRetention: "obfuscate", RiskCheck: "enable",
          }),
        });
        await response.body?.cancel();
        if (!response.ok) throw deliveryUnavailable();
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
