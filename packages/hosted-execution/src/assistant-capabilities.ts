const HOSTED_ELEVENLABS_ENV = {
  forwardedConfig: [
    "MURPH_ELEVENLABS_MODEL_ID",
    "MURPH_ELEVENLABS_VOICE_ID",
  ],
  workerSecrets: [
    "ELEVENLABS_API_KEY",
  ],
} as const;

const HOSTED_EXA_SEARCH_ENV = {
  codexShellWorkerSecrets: [
    "EXA_API_KEY",
  ],
} as const;

const HOSTED_MAPBOX_ROUTES_ENV = {
  codexShellWorkerSecrets: [
    "MAPBOX_ACCESS_TOKEN",
  ],
} as const;

const HOSTED_MURPH_DATA_API_ENV = {
  codexShellWorkerSecrets: [
    "MURPH_DATA_API_KEY",
  ],
} as const;

const HOSTED_LINQ_DELIVERY_ENV = {
  forwardedConfig: [
    "LINQ_ATTACHMENT_CDN_BASE_URL",
    "LINQ_API_BASE_URL",
  ],
  workerSecrets: [
    "LINQ_API_TOKEN",
  ],
} as const;

const HOSTED_TELEGRAM_DELIVERY_ENV = {
  forwardedConfig: [
    "TELEGRAM_API_BASE_URL",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_FILE_BASE_URL",
  ],
  workerSecrets: [
    "TELEGRAM_BOT_TOKEN",
  ],
} as const;

const HOSTED_WHATSAPP_DELIVERY_ENV = {
  forwardedConfig: [
    "WHATSAPP_API_BASE_URL",
    "WHATSAPP_GRAPH_VERSION",
  ],
  workerSecrets: [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
  ],
} as const;

export const HOSTED_ELEVENLABS_ENV_NAMES = [
  ...HOSTED_ELEVENLABS_ENV.workerSecrets,
  ...HOSTED_ELEVENLABS_ENV.forwardedConfig,
] as const;

export const HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES = [
  ...HOSTED_EXA_SEARCH_ENV.codexShellWorkerSecrets,
] as const;

export const HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES = [
  ...HOSTED_MAPBOX_ROUTES_ENV.codexShellWorkerSecrets,
] as const;

export const HOSTED_MURPH_DATA_API_CODEX_SHELL_ENV_NAMES = [
  ...HOSTED_MURPH_DATA_API_ENV.codexShellWorkerSecrets,
] as const;

export const HOSTED_LINQ_DELIVERY_ENV_NAMES = [
  ...HOSTED_LINQ_DELIVERY_ENV.forwardedConfig,
  ...HOSTED_LINQ_DELIVERY_ENV.workerSecrets,
] as const;

export const HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES = [
  ...HOSTED_TELEGRAM_DELIVERY_ENV.forwardedConfig,
] as const;

export const HOSTED_WHATSAPP_DELIVERY_FORWARDED_ENV_NAMES = [
  ...HOSTED_WHATSAPP_DELIVERY_ENV.forwardedConfig,
] as const;

export const HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES = [
  ...HOSTED_ELEVENLABS_ENV.workerSecrets,
  ...HOSTED_EXA_SEARCH_ENV.codexShellWorkerSecrets,
  ...HOSTED_MAPBOX_ROUTES_ENV.codexShellWorkerSecrets,
  ...HOSTED_MURPH_DATA_API_ENV.codexShellWorkerSecrets,
  ...HOSTED_LINQ_DELIVERY_ENV.workerSecrets,
  ...HOSTED_TELEGRAM_DELIVERY_ENV.workerSecrets,
  ...HOSTED_WHATSAPP_DELIVERY_ENV.workerSecrets,
] as const;

export const HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES = [
  ...HOSTED_ELEVENLABS_ENV.forwardedConfig,
  ...HOSTED_LINQ_DELIVERY_ENV.forwardedConfig,
  ...HOSTED_TELEGRAM_DELIVERY_ENV.forwardedConfig,
  ...HOSTED_WHATSAPP_DELIVERY_ENV.forwardedConfig,
] as const;

export const HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES = [
  ...HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES,
  ...HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES,
  ...HOSTED_MURPH_DATA_API_CODEX_SHELL_ENV_NAMES,
] as const;
