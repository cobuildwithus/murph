import "server-only";
import { areHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedAuthSmsVerification {
  send(input: { phoneNumber: string }): Promise<string>;
  check(input: { phoneNumber: string; verificationSid: string; code: string }): Promise<boolean>;
}

const phonePattern = /^\+[1-9]\d{6,14}$/u;
const verificationPattern = /^VE[0-9a-f]{32}$/iu;
type VerifyFailure = "invalid_request" | "configuration" | "transaction" | "transport"
  | "aborted" | "timeout" | "provider_http" | "invalid_response" | "binding_mismatch";

/** Only closed statuses and bound verification IDs escape this provider boundary. */
export function hostedAuthSmsVerification(signal?: AbortSignal): HostedAuthSmsVerification {
  return {
    async send({ phoneNumber }) {
      if (!phonePattern.test(phoneNumber)) throw verificationError("send", "invalid_request");
      const result = await requestVerify("send", "Verifications", {
        To: phoneNumber, Channel: "sms", RiskCheck: "enable",
      }, signal);
      if (!result || result.status !== "pending" || result.to !== phoneNumber || result.channel !== "sms"
        || typeof result.sid !== "string" || !verificationPattern.test(result.sid)) throw verificationError("send", "invalid_response");
      return result.sid;
    },
    async check({ phoneNumber, verificationSid, code }) {
      if (!phonePattern.test(phoneNumber) || !verificationPattern.test(verificationSid) || !/^\d{6}$/u.test(code)) return false;
      const result = await requestVerify("check", "VerificationCheck", {
        VerificationSid: verificationSid, Code: code,
      }, signal);
      if (!result) return false;
      if (result.sid !== verificationSid || result.to !== phoneNumber || result.channel !== "sms") throw verificationError("check", "binding_mismatch");
      return result.status === "approved";
    },
  };
}

async function requestVerify(
  operation: "send" | "check", path: "Verifications" | "VerificationCheck",
  body: Record<string, string>, signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  if (areHostedDomainRootProviderCallsDisabled()) throw verificationError(operation, "transaction");
  const config = readVerifyConfig();
  if (!config) throw verificationError(operation, "configuration");
  const { account, key, secret, service } = config;
  const response = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
    method: "POST", redirect: "error", cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    headers: {
      authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  }).catch((error: unknown) => {
    const reason = signal?.aborted ? "aborted"
      : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "transport";
    throw verificationError(operation, reason);
  });
  if (!response.ok) {
    // Verify removes expired, consumed and exhausted challenges. All other
    // failures remain provider-unavailable, never successful verification.
    if (operation === "check" && response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const failure = await readVerifyFailure(response);
    throw verificationError(operation, "provider_http", response.status, failure?.code, failure?.parameter);
  }
  const result: unknown = await response.json().catch(() => { throw verificationError(operation, "invalid_response"); });
  if (!result || typeof result !== "object" || Array.isArray(result)
    || !("account_sid" in result) || result.account_sid !== account
    || !("service_sid" in result) || result.service_sid !== service) throw verificationError(operation, "binding_mismatch");
  return result;
}

// Twilio messages can contain contacts. Retain only its numeric error code and
// exact known parameter labels; never attach the provider body or thrown cause.
async function readVerifyFailure(response: Response): Promise<{ code?: number; parameter?: string } | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) return undefined;
      chunks.push(value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object") return undefined;
    const code = "code" in result && typeof result.code === "number" && Number.isInteger(result.code)
      && result.code >= 10000 && result.code <= 99999 ? result.code : undefined;
    const parameter = code === 60200 && "message" in result && typeof result.message === "string"
      ? /^Invalid parameter: (To|Channel|RiskCheck|Code|VerificationSid)$/u.exec(result.message)?.[1]
      : undefined;
    return { code, parameter };
  } catch { /* Missing diagnostics must preserve the provider's HTTP failure. */ }
  finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return undefined;
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

function verificationError(operation: "send" | "check", reason: VerifyFailure, status?: number, providerCode?: number, parameter?: string) {
  if (operation === "send" && reason === "provider_http" && status === 400
    && providerCode === 60200 && parameter === "To") {
    return hostedOnboardingError({
      code: "AUTH_REQUEST_INVALID", httpStatus: 400,
      message: "Check your phone number, including its country code, and try again.",
    });
  }
  return hostedOnboardingError({
    cause: new Error(`Twilio Verify ${operation}: ${reason}${status === undefined ? "" : `; HTTP ${status}`}${providerCode === undefined ? "" : `; code ${providerCode}`}${parameter === undefined ? "" : `; parameter ${parameter}`}.`),
    code: operation === "send" ? "AUTH_DELIVERY_UNAVAILABLE" : "AUTH_VERIFICATION_UNAVAILABLE",
    httpStatus: 503,
    message: operation === "send" ? "We could not send a sign-in code. Try again shortly."
      : "We could not verify your sign-in code. Try again shortly.",
  });
}
