import { normalizeNullableString, parseInteger } from "../primitives";

const HOSTED_RESEND_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_RESEND_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_RESEND_EMAIL_MAX_TIMEOUT_MS = 30_000;

export type HostedResendPlainTextEmailEnv =
  Readonly<Record<string, string | undefined>>;

export type HostedResendPlainTextEmailConfig = {
  apiBaseUrl?: string;
  apiKey: string;
  from: string;
  timeoutMs: number;
};

export function readHostedResendPlainTextEmailConfig(
  source: HostedResendPlainTextEmailEnv,
): HostedResendPlainTextEmailConfig | null {
  const apiKey = normalizeNullableString(source.RESEND_API_KEY);
  const from = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FROM);

  if (!apiKey || !from) {
    return null;
  }

  return {
    apiKey,
    from,
    timeoutMs: readHostedResendPlainTextEmailTimeoutMs(source),
  };
}

function readHostedResendPlainTextEmailTimeoutMs(
  source: HostedResendPlainTextEmailEnv,
): number {
  const configured = parseInteger(source.HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS);

  if (!configured) {
    return HOSTED_RESEND_EMAIL_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(configured, HOSTED_RESEND_EMAIL_MIN_TIMEOUT_MS),
    HOSTED_RESEND_EMAIL_MAX_TIMEOUT_MS,
  );
}
