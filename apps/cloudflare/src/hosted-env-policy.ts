import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";

const OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS = [
  "FFMPEG_COMMAND",
  "PDFTOTEXT_COMMAND",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
] as const;

const HOSTED_USER_ENV_PROCESS_CONTROL_KEYS = [
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
] as const;

const DEFAULT_ALLOWED_USER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "BRAVE_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HOSTED_USER_VERIFIED_EMAIL",
  "HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT",
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

const DISALLOWED_USER_ENV_KEYS = new Set([
  ...OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS,
  ...HOSTED_USER_ENV_PROCESS_CONTROL_KEYS,
  "HOME",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_CONTROL_TOKENS",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKENS",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  "NODE_ENV",
  "PATH",
  "PORT",
  "PWD",
  "VAULT",
]);

const DISALLOWED_USER_ENV_PREFIXES = [
  "AGENTMAIL_",
  "CF_",
  "HOSTED_ASSISTANT_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "WRANGLER_",
];

export const HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV =
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES";

const RUNNER_ENV_PROFILE_KEYS = {
  assistant: [
    ...HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
    "HOSTED_ASSISTANT_ZERO_DATA_RETENTION",
    "NODE_ENV",
    ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  ],
  "device-sync": [
    "DEVICE_SYNC_PUBLIC_BASE_URL",
    "DEVICE_SYNC_SECRET",
    "OURA_CLIENT_ID",
    "OURA_CLIENT_SECRET",
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
  ],
  "hosted-email": [
    "HOSTED_EMAIL_DOMAIN",
    "HOSTED_EMAIL_FROM_ADDRESS",
    "HOSTED_EMAIL_LOCAL_PART",
  ],
  linq: [
    "LINQ_API_BASE_URL",
    "LINQ_API_TOKEN",
    "LINQ_WEBHOOK_SECRET",
  ],
  mapbox: [
    "MAPBOX_ACCESS_TOKEN",
  ],
  parsers: [
    "FFMPEG_COMMAND",
    "PDFTOTEXT_COMMAND",
    "WHISPER_COMMAND",
    "WHISPER_MODEL_PATH",
  ],
  telegram: [
    "TELEGRAM_API_BASE_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_FILE_BASE_URL",
  ],
  web: [
    "BRAVE_API_KEY",
    "MURPH_WEB_FETCH_ENABLED",
    "MURPH_WEB_SEARCH_MAX_RESULTS",
    "MURPH_WEB_SEARCH_PROVIDER",
    "MURPH_WEB_SEARCH_TIMEOUT_MS",
  ],
} as const;

const DEFAULT_RUNNER_ENV_PROFILE_NAMES = [
  "assistant",
  "parsers",
  "web",
] as const satisfies readonly RunnerEnvProfileName[];

type RunnerEnvProfileName = keyof typeof RUNNER_ENV_PROFILE_KEYS;
type StringEnvSource = Readonly<Record<string, string | undefined>>;
type UnknownEnvSource = Readonly<Record<string, unknown>>;

export function isHostedUserEnvKeyAllowed(
  key: string,
  source: StringEnvSource = process.env,
): boolean {
  if (DISALLOWED_USER_ENV_KEYS.has(key)) {
    return false;
  }

  if (DISALLOWED_USER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return false;
  }

  const allowedKeys = new Set([
    ...DEFAULT_ALLOWED_USER_ENV_KEYS,
    ...parseHostedEnvCsvList(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS),
  ]);

  // Hosted per-user env is allowed to carry per-user credentials and identity hints,
  // but never executable selectors or process-control variables that steer the runner.
  return allowedKeys.has(key);
}

export function buildHostedRunnerContainerEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  const values: Record<string, string> = {};
  const enabledProfileNames = resolveHostedRunnerEnvProfileNames(source);
  const allowedKeys = resolveHostedRunnerEnvKeys(enabledProfileNames);

  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value !== "string"
      || value.length === 0
      || !allowedKeys.has(key)
    ) {
      continue;
    }

    values[key] = value;
  }

  if (!values.NODE_ENV) {
    values.NODE_ENV = "production";
  }

  const emailCapabilities = enabledProfileNames.has("hosted-email")
    ? readHostedEmailCapabilities(toStringEnvSource(source))
    : {
        ingressReady: false,
        sendReady: false,
      };
  values.HOSTED_EMAIL_INGRESS_READY = emailCapabilities.ingressReady ? "true" : "false";
  values.HOSTED_EMAIL_SEND_READY = emailCapabilities.sendReady ? "true" : "false";

  return values;
}

export function filterHostedRunnerUserEnv(
  env: Readonly<Record<string, string>>,
  source: StringEnvSource = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) =>
      typeof value === "string"
      && value.length > 0
      && isHostedUserEnvKeyAllowed(key, source)
    ),
  );
}

function resolveHostedRunnerEnvProfileNames(
  source: UnknownEnvSource,
): Set<RunnerEnvProfileName> {
  const enabledProfiles = new Set<RunnerEnvProfileName>(
    DEFAULT_RUNNER_ENV_PROFILE_NAMES,
  );
  const configuredProfiles = parseHostedEnvCsvList(
    typeof source[HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV] === "string"
      ? source[HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV]
      : undefined,
    (entry) => entry.toLowerCase(),
  );

  for (const profileName of configuredProfiles) {
    if (isRunnerEnvProfileName(profileName)) {
      enabledProfiles.add(profileName);
    }
  }

  return enabledProfiles;
}

function resolveHostedRunnerEnvKeys(
  profileNames: ReadonlySet<RunnerEnvProfileName>,
): Set<string> {
  const keys = new Set<string>();

  for (const profileName of profileNames) {
    for (const key of RUNNER_ENV_PROFILE_KEYS[profileName]) {
      keys.add(key);
    }
  }

  return keys;
}

function isRunnerEnvProfileName(value: string): value is RunnerEnvProfileName {
  return Object.hasOwn(RUNNER_ENV_PROFILE_KEYS, value);
}

function parseHostedEnvCsvList(
  value: string | undefined,
  normalize: (entry: string) => string = (entry) => entry.toUpperCase(),
): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalize(entry));
}

function toStringEnvSource(source: UnknownEnvSource): StringEnvSource {
  const values: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(source)) {
    values[key] = typeof value === "string" ? value : undefined;
  }

  return values;
}
