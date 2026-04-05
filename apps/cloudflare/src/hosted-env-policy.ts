import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  readHostedAssistantApiKeyEnvName,
} from "@murphai/assistant-core";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution";

const DEFAULT_ALLOWED_USER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "BRAVE_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FFMPEG_COMMAND",
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
  "PDFTOTEXT_COMMAND",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VENICE_API_KEY",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
  "XAI_API_KEY",
] as const;

const DISALLOWED_USER_ENV_KEYS = new Set([
  "HOME",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_CONTROL_SIGNING_SECRET",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_CONTROL_TOKENS",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKENS",
  "HOSTED_EXECUTION_SIGNING_SECRET",
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

const RUNNER_EXACT_ALLOWED_ENV_KEYS = new Set<string>([
  "ANTHROPIC_API_KEY",
  "BRAVE_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "DEVICE_SYNC_SECRET",
  "FFMPEG_COMMAND",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HOSTED_EMAIL_LOCAL_PART",
  "HOSTED_EMAIL_FROM_ADDRESS",
  "HOSTED_EMAIL_DOMAIN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LINQ_API_BASE_URL",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "LITELLM_PROXY_API_KEY",
  "LM_STUDIO_API_KEY",
  "MISTRAL_API_KEY",
  "MURPH_WEB_FETCH_ENABLED",
  "MURPH_WEB_SEARCH_MAX_RESULTS",
  "MURPH_WEB_SEARCH_PROVIDER",
  "MURPH_WEB_SEARCH_TIMEOUT_MS",
  "NODE_ENV",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OLLAMA_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "PDFTOTEXT_COMMAND",
  "PERPLEXITY_API_KEY",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "TOGETHER_API_KEY",
  "VENICE_API_KEY",
  "VLLM_API_KEY",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "XAI_API_KEY",
  ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
]);

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

  return allowedKeys.has(key);
}

export function buildHostedRunnerContainerEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value !== "string"
      || value.length === 0
      || !isAllowedRunnerEnvKey(key)
    ) {
      continue;
    }

    values[key] = value;
  }

  const hostedAssistantApiKeyEnv = readHostedAssistantApiKeyEnvName(source);
  const hostedAssistantApiKeyValue = hostedAssistantApiKeyEnv
    ? source[hostedAssistantApiKeyEnv]
    : undefined;

  if (
    hostedAssistantApiKeyEnv
    && isAllowedHostedAssistantReferencedRunnerEnvKey(hostedAssistantApiKeyEnv)
    && typeof hostedAssistantApiKeyValue === "string"
    && hostedAssistantApiKeyValue.length > 0
  ) {
    values[hostedAssistantApiKeyEnv] = hostedAssistantApiKeyValue;
  }

  if (!values.NODE_ENV) {
    values.NODE_ENV = "production";
  }

  const emailCapabilities = readHostedEmailCapabilities(toStringEnvSource(source));
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

export function isAllowedHostedAssistantReferencedRunnerEnvKey(key: string): boolean {
  return !DISALLOWED_USER_ENV_KEYS.has(key)
    && !DISALLOWED_USER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isAllowedRunnerEnvKey(key: string): boolean {
  return RUNNER_EXACT_ALLOWED_ENV_KEYS.has(key);
}

function parseHostedEnvCsvList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toUpperCase());
}

function toStringEnvSource(source: UnknownEnvSource): StringEnvSource {
  const values: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(source)) {
    values[key] = typeof value === "string" ? value : undefined;
  }

  return values;
}
