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
    "ANTHROPIC_API_KEY",
    "CEREBRAS_API_KEY",
    "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "PERPLEXITY_API_KEY",
    "TOGETHER_API_KEY",
    "VERCEL_AI_API_KEY",
    "VENICE_API_KEY",
    "XAI_API_KEY",
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
  "ANTHROPIC_API_KEY",
  "BRAVE_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VERCEL_AI_API_KEY",
  "VENICE_API_KEY",
  "XAI_API_KEY",
] as const;
