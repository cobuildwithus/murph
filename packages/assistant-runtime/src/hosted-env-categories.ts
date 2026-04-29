// Ingress-only verification secrets stay on the control-plane/webhook boundary
// and must not enter user-executable hosted runtime env.
export const HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES = [
  "LINQ_WEBHOOK_SECRET",
] as const;

export const HOSTED_SHARED_MAILBOX_PLATFORM_ENV_NAMES = [
  "HOSTED_WAKE_ENCRYPTION_KEY",
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
  "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
] as const;

export const HOSTED_SHARED_CHANNEL_PLATFORM_ENV_NAMES = [
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
] as const;

// Platform-owned runtime vars must never be user-controlled. Telegram routing
// vars authorize privileged Bot API traffic, and wake encryption vars decrypt
// hosted mailbox payloads.
export const HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES = [
  ...HOSTED_SHARED_MAILBOX_PLATFORM_ENV_NAMES,
  ...HOSTED_SHARED_CHANNEL_PLATFORM_ENV_NAMES,
] as const;

export const HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS = {
  assistantConfigured: [
    "VERCEL_AI_API_KEY",
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
  parserToolingConfigured: [
    "FFMPEG_COMMAND",
    "FILE_COMMAND",
    "MUTOOL_COMMAND",
    "PDFINFO_COMMAND",
    "PDFTOPPM_COMMAND",
    "PDFTOTEXT_COMMAND",
    "QPDF_COMMAND",
    "WHISPER_COMMAND",
    "WHISPER_MODEL_PATH",
  ],
  telegramConfigured: [
    "TELEGRAM_API_BASE_URL",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_FILE_BASE_URL",
  ],
  webSearchConfigured: [
    "BRAVE_API_KEY",
    "MURPH_WEB_FETCH_ENABLED",
    "MURPH_WEB_SEARCH_MAX_RESULTS",
    "MURPH_WEB_SEARCH_PROVIDER",
  ],
} as const satisfies Record<string, readonly string[]>;

export const HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES = [
  "VERCEL_AI_API_KEY",
] as const;
