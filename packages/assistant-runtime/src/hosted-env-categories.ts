import {
  HOSTED_LINQ_DELIVERY_ENV_NAMES,
  HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
} from "@murphai/hosted-execution/assistant-capabilities";
import {
  MURPH_ANDROID_APP_ENABLED_ENV,
} from "@murphai/hosted-execution/env";

// Ingress-only verification secrets stay on the control-plane/webhook boundary
// and must not enter user-executable hosted runtime env.
export const HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES = [
  "LINQ_WEBHOOK_SECRET",
] as const;

export const HOSTED_SHARED_MAILBOX_PLATFORM_ENV_NAMES = [
  "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS",
  "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
] as const;

export const HOSTED_SHARED_CHANNEL_PLATFORM_ENV_NAMES = [
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
] as const;

export const HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_ENV",
  "JUNCTION_PROVIDER_FILTER",
  "JUNCTION_RECONCILE_DAYS",
  "JUNCTION_RECONCILE_INTERVAL_MS",
  "JUNCTION_REGION",
  "JUNCTION_REQUEST_TIMEOUT_MS",
  "JUNCTION_SUMMARY_BACKFILL_DAYS",
  "JUNCTION_SUMMARY_RESOURCES",
  "JUNCTION_TIMESERIES_BACKFILL_DAYS",
  "JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
] as const;

// Platform-owned runtime vars must never be user-controlled. Telegram routing
// vars authorize privileged Bot API traffic, and mailbox platform vars fetch
// and unwrap hosted mailbox payload roots. Junction runtime vars hydrate
// provider-owned execution credentials without serializing them into user env.
// The log fingerprint secret enables metadata-only HMAC diagnostics and must
// not be exposed through forwarded child env or member-supplied user env.
export const HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES = [
  ...HOSTED_SHARED_MAILBOX_PLATFORM_ENV_NAMES,
  ...HOSTED_SHARED_CHANNEL_PLATFORM_ENV_NAMES,
  ...HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES,
  "CF_PUBLIC_BASE_URL",
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "HOSTED_PHYSICAL_NOTES_ENABLED",
  MURPH_ANDROID_APP_ENABLED_ENV,
] as const;

// These vars may come from trusted forwarded runtime profiles for legacy/local
// paths, but user-provided runtime env must not control them.
export const HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES = [
  ...HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
  "LINQ_ATTACHMENT_CDN_BASE_URL",
] as const;

export const HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS = {
  assistantConfigured: [
    "MURPH_CUSTOM_INFERENCE_API_KEY",
    "OPENAI_API_KEY",
    "VENICE_API_KEY",
  ],
  hostedEmailConfigured: [
    "HOSTED_EMAIL_DOMAIN",
    "HOSTED_EMAIL_FROM_ADDRESS",
    "HOSTED_EMAIL_LOCAL_PART",
  ],
  linqConfigured: HOSTED_LINQ_DELIVERY_ENV_NAMES,
  telegramConfigured: HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
} as const satisfies Record<string, readonly string[]>;

export const HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES = [
  "MURPH_CUSTOM_INFERENCE_API_KEY",
  "OPENAI_API_KEY",
  "VENICE_API_KEY",
] as const;
