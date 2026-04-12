import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env";

import { normalizeOptionalString, requireConfiguredString } from "./shared.ts";

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
] as const;

const HOSTED_WORKER_OPTIONAL_SECRET_NAMES = [
  ...HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  "BRAVE_API_KEY",
  "DEVICE_SYNC_SECRET",
  "HOSTED_EMAIL_CLOUDFLARE_API_TOKEN",
  "HOSTED_EMAIL_SIGNING_SECRET",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "MAPBOX_ACCESS_TOKEN",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
] as const;

type EnvSource = Readonly<Record<string, string | undefined>>;

export function buildHostedWorkerSecretsPayload(
  source: EnvSource = process.env,
): Record<string, string> {
  return {
    ...readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES),
    ...readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_SECRET_NAMES),
  };
}

function readPresentStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  const entries = keys.flatMap((key) => {
    const value = normalizeOptionalString(source[key]);
    return value ? [[key, value] as const] : [];
  });

  return Object.fromEntries(entries);
}

function readRequiredStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => [key, requireConfiguredString(source[key], key)]),
  );
}
