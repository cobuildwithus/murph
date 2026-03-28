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

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const LINQ_API_BASE_URL_ENV_KEYS = ["LINQ_API_BASE_URL"] as const;
const LINQ_API_TOKEN_ENV_KEYS = ["LINQ_API_TOKEN"] as const;
const LINQ_WEBHOOK_SECRET_ENV_KEYS = ["LINQ_WEBHOOK_SECRET"] as const;

export interface HostedLinqEnvironment {
  apiBaseUrl: string;
  apiToken: string | null;
  webhookSecret: string | null;
}

export function readHostedLinqEnvironment(source: NodeJS.ProcessEnv = process.env): HostedLinqEnvironment {
  return {
    apiBaseUrl: readEnv(source, LINQ_API_BASE_URL_ENV_KEYS) ?? DEFAULT_LINQ_API_BASE_URL,
    apiToken: readEnv(source, LINQ_API_TOKEN_ENV_KEYS),
    webhookSecret: readEnv(source, LINQ_WEBHOOK_SECRET_ENV_KEYS),
  };
}
