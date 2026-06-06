// Ingress-only verification secrets stay on the control-plane/webhook boundary
// and must not enter user-executable hosted runtime env.
export const HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES = [
  "LINQ_WEBHOOK_SECRET",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
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
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_API_BASE_URL",
  "WHATSAPP_GRAPH_VERSION",
  "WHATSAPP_PHONE_NUMBER_ID",
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
  "JUNCTION_TIMESERIES_RESOURCES",
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
  "HOSTED_LOG_FINGERPRINT_SECRET",
] as const;

// These vars may come from trusted forwarded runtime profiles for legacy/local
// paths, but user-provided runtime env must not control them.
export const HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES = [
  ...HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
  "LINQ_ATTACHMENT_CDN_BASE_URL",
] as const;

export const HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS = {
  assistantConfigured: [
    "OPENAI_API_KEY",
  ],
  hostedEmailConfigured: [
    "HOSTED_EMAIL_DOMAIN",
    "HOSTED_EMAIL_FROM_ADDRESS",
    "HOSTED_EMAIL_LOCAL_PART",
  ],
  linqConfigured: [
    "LINQ_ATTACHMENT_CDN_BASE_URL",
    "LINQ_API_BASE_URL",
    "LINQ_API_TOKEN",
  ],
  telegramConfigured: [
    "TELEGRAM_API_BASE_URL",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_FILE_BASE_URL",
  ],
  whatsappConfigured: [
    "WHATSAPP_API_BASE_URL",
    "WHATSAPP_GRAPH_VERSION",
  ],
} as const satisfies Record<string, readonly string[]>;

export const HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES = [
  "OPENAI_API_KEY",
] as const;
