import "server-only";
import { areHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedAuthSmsVerification {
  send(input: { phoneNumber: string }): Promise<string>;
  check(input: { phoneNumber: string; verificationSid: string; code: string }): Promise<boolean>;
}

const phonePattern = /^\+[1-9]\d{6,14}$/u;
const verificationPattern = /^VE[0-9a-f]{32}$/iu;

/** Only closed statuses and bound verification IDs escape this provider boundary. */
export function hostedAuthSmsVerification(signal?: AbortSignal): HostedAuthSmsVerification {
  return {
    async send({ phoneNumber }) {
      if (!phonePattern.test(phoneNumber)) throw unavailable("send");
      const result = await requestVerify("send", "Verifications", {
        To: phoneNumber, Channel: "sms", RiskCheck: "enable",
      }, signal);
      if (!result || result.status !== "pending" || result.to !== phoneNumber || result.channel !== "sms"
        || typeof result.sid !== "string" || !verificationPattern.test(result.sid)) throw unavailable("send");
      return result.sid;
    },
    async check({ phoneNumber, verificationSid, code }) {
      if (!phonePattern.test(phoneNumber) || !verificationPattern.test(verificationSid) || !/^\d{6}$/u.test(code)) return false;
      const result = await requestVerify("check", "VerificationCheck", {
        VerificationSid: verificationSid, Code: code,
      }, signal);
      if (!result) return false;
      if (result.sid !== verificationSid || result.to !== phoneNumber || result.channel !== "sms") throw unavailable("check");
      return result.status === "approved";
    },
  };
}

async function requestVerify(
  operation: "send" | "check", path: "Verifications" | "VerificationCheck",
  body: Record<string, string>, signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    if (areHostedDomainRootProviderCallsDisabled()) throw new Error("Provider calls are forbidden inside auth transactions.");
    const config = readVerifyConfig();
    if (!config) throw unavailable(operation);
    const { account, key, secret, service } = config;
    const response = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
      method: "POST", redirect: "error", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // Verify removes expired, consumed and exhausted challenges. All other
      // failures remain provider-unavailable, never successful verification.
      if (operation === "check" && response.status === 404) return null;
      throw unavailable(operation);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)
      || !("account_sid" in result) || result.account_sid !== account
      || !("service_sid" in result) || result.service_sid !== service) throw unavailable(operation);
    return result;
  } catch { throw unavailable(operation); }
}

function readVerifyConfig() {
  const account = process.env.HOSTED_AUTH_TWILIO_ACCOUNT_SID ?? "";
  const key = process.env.HOSTED_AUTH_TWILIO_API_KEY_SID ?? "";
  const secret = process.env.HOSTED_AUTH_TWILIO_API_KEY_SECRET ?? "";
  const service = process.env.HOSTED_AUTH_TWILIO_VERIFY_SERVICE_SID ?? "";
  if (!/^AC[0-9a-f]{32}$/iu.test(account) || !/^SK[0-9a-f]{32}$/iu.test(key)
    || !/^VA[0-9a-f]{32}$/iu.test(service) || !secret) return null;
  return { account, key, secret, service };
}

function unavailable(operation: "send" | "check") {
  return hostedOnboardingError({
    code: operation === "send" ? "AUTH_DELIVERY_UNAVAILABLE" : "AUTH_VERIFICATION_UNAVAILABLE",
    httpStatus: 503,
    message: operation === "send" ? "We could not send a sign-in code. Try again shortly."
      : "We could not verify your sign-in code. Try again shortly.",
  });
}
