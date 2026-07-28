import {
  normalizeNullableString,
  parseCommaSeparatedList,
  parseInteger,
} from "../primitives";
import type { HostedResendPlainTextEmailConfig } from "./resend-plain-text-email";

const HOSTED_OPERATIONAL_ALERT_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_OPERATIONAL_ALERT_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_OPERATIONAL_ALERT_EMAIL_MAX_TIMEOUT_MS = 30_000;
const HOSTED_OPERATIONAL_ALERT_EMAIL_LOCAL_API_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
]);

export type HostedOperationalAlertEmailConfig = {
  recipients: string[];
  resend: HostedResendPlainTextEmailConfig;
};

export function readHostedOperationalAlertEmailConfig(
  source: Readonly<Record<string, string | undefined>>,
): HostedOperationalAlertEmailConfig | null {
  const apiKey = normalizeNullableString(source.RESEND_API_KEY);
  const from = normalizeNullableString(source.HOSTED_LINQ_ALERT_EMAIL_FROM);
  const recipients = parseCommaSeparatedList(source.HOSTED_LINQ_ALERT_EMAILS);
  if (!apiKey || !from || recipients.length === 0) {
    return null;
  }

  const apiBaseUrl = readHostedLocalResendApiBaseUrl(source);
  return {
    recipients,
    resend: {
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      apiKey,
      from,
      timeoutMs: readHostedOperationalAlertEmailTimeoutMs(source),
    },
  };
}

function readHostedOperationalAlertEmailTimeoutMs(
  source: Readonly<Record<string, string | undefined>>,
): number {
  const configured = parseInteger(source.HOSTED_LINQ_ALERT_EMAIL_TIMEOUT_MS);
  if (!configured) {
    return HOSTED_OPERATIONAL_ALERT_EMAIL_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(configured, HOSTED_OPERATIONAL_ALERT_EMAIL_MIN_TIMEOUT_MS),
    HOSTED_OPERATIONAL_ALERT_EMAIL_MAX_TIMEOUT_MS,
  );
}

function readHostedLocalResendApiBaseUrl(
  source: Readonly<Record<string, string | undefined>>,
): string | null {
  const configured = normalizeNullableString(
    source.MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL,
  );
  if (!configured) {
    return null;
  }
  if (source.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED !== "1") {
    throw new Error("Hosted local Resend API base URL requires E2E isolation.");
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Hosted local Resend API base URL is invalid.");
  }
  if (
    url.protocol !== "http:"
    || !HOSTED_OPERATIONAL_ALERT_EMAIL_LOCAL_API_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error(
      "Hosted local Resend API base URL must be a loopback origin.",
    );
  }
  return url.origin;
}
