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

const LINQ_WEBHOOK_SECRET_ENV_KEYS = ["LINQ_WEBHOOK_SECRET"] as const;

export interface HostedLinqEnvironment {
  webhookSecret: string | null;
}

export function readHostedLinqEnvironment(source: NodeJS.ProcessEnv = process.env): HostedLinqEnvironment {
  return {
    webhookSecret: readEnv(source, LINQ_WEBHOOK_SECRET_ENV_KEYS),
  };
}
