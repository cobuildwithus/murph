import { normalizeNullableString } from "../device-sync/shared";

function readEnv(source: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeNullableString(source[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

export const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
export const DEFAULT_LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const LINQ_API_BASE_URL_ENV_KEYS = ["LINQ_API_BASE_URL"] as const;
const LINQ_API_TOKEN_ENV_KEYS = ["LINQ_API_TOKEN"] as const;
const LINQ_WEBHOOK_SECRET_ENV_KEYS = ["LINQ_WEBHOOK_SECRET"] as const;
const LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS = ["LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS"] as const;

export interface HostedLinqEnvironment {
  apiBaseUrl: string;
  apiToken: string | null;
  webhookSecret: string | null;
  webhookTimestampToleranceMs: number;
}

export function readLinqEnvironment(source: NodeJS.ProcessEnv = process.env): HostedLinqEnvironment {
  return {
    apiBaseUrl: readEnv(source, LINQ_API_BASE_URL_ENV_KEYS) ?? DEFAULT_LINQ_API_BASE_URL,
    apiToken: readEnv(source, LINQ_API_TOKEN_ENV_KEYS),
    webhookSecret: readEnv(source, LINQ_WEBHOOK_SECRET_ENV_KEYS),
    webhookTimestampToleranceMs: readWebhookTimestampToleranceMs(source),
  };
}

export function readHostedLinqEnvironment(source: NodeJS.ProcessEnv = process.env): HostedLinqEnvironment {
  return readLinqEnvironment(source);
}

function readWebhookTimestampToleranceMs(source: NodeJS.ProcessEnv): number {
  const parsed = parseOptionalInteger(readEnv(source, LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS));

  if (parsed == null) {
    return DEFAULT_LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS;
  }

  if (parsed < 0) {
    throw new RangeError("LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS must be greater than or equal to zero.");
  }

  return parsed;
}

function parseOptionalInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  if (!/^-?\d+$/u.test(value)) {
    throw new TypeError("LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS must be an integer.");
  }

  return Number.parseInt(value, 10);
}
