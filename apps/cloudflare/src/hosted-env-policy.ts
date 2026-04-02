import {
  readHostedAssistantApiKeyEnvName,
} from "@murphai/assistant-core";
import {
  hostedAssistantAutomationEnabledFromEnv,
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution";

const DEFAULT_ALLOWED_USER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FFMPEG_COMMAND",
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
  "PDFTOTEXT_COMMAND",
  "TOGETHER_API_KEY",
  "VENICE_API_KEY",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
  "XAI_API_KEY",
] as const;

const DEFAULT_ALLOWED_USER_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CEREBRAS_",
  "DEEPSEEK_",
  "FIREWORKS_",
  "GOOGLE_",
  "GOOGLE_GENERATIVE_AI_",
  "GROQ_",
  "HF_",
  "HOSTED_USER_",
  "HUGGINGFACE_",
  "HUGGING_FACE_",
  "LITELLM_",
  "LM_STUDIO_",
  "MISTRAL_",
  "NGC_",
  "NVIDIA_",
  "OPENAI_",
  "OPENROUTER_",
  "PERPLEXITY_",
  "PDFTOTEXT_",
  "TOGETHER_",
  "VENICE_",
  "VLLM_",
  "WHISPER_",
  "XAI_",
] as const;

const DISALLOWED_USER_ENV_KEYS = new Set([
  "HOME",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
  "HOSTED_EXECUTION_SIGNING_SECRET",
  "NODE_ENV",
  "PATH",
  "PORT",
  "PWD",
  "VAULT",
]);

const DISALLOWED_USER_ENV_PREFIXES = [
  "CF_",
  "HOSTED_ASSISTANT_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "WRANGLER_",
];

const AUTOMATION_ONLY_RUNNER_ENV_KEYS = new Set<string>([
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "HF_TOKEN",
  "HOSTED_EMAIL_DOMAIN",
  "HOSTED_EMAIL_FROM_ADDRESS",
  "HOSTED_EMAIL_LOCAL_PART",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
]);

const RUNNER_EXACT_ALLOWED_ENV_KEYS = new Set<string>([
  "AGENTMAIL_BASE_URL",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "DEVICE_SYNC_SECRET",
  "FFMPEG_COMMAND",
  "FIREWORKS_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "HF_TOKEN",
  "HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EMAIL_LOCAL_PART",
  "HOSTED_EMAIL_FROM_ADDRESS",
  "HOSTED_EMAIL_DOMAIN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "NODE_ENV",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "PDFTOTEXT_COMMAND",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
]);

const AUTOMATION_ONLY_RUNNER_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CEREBRAS_",
  "DEEPSEEK_",
  "FIREWORKS_",
  "GOOGLE_",
  "GROQ_",
  "HF_",
  "HUGGINGFACE_",
  "HUGGING_FACE_",
  "LINQ_",
  "LITELLM_",
  "LM_STUDIO_",
  "MISTRAL_",
  "NGC_",
  "NVIDIA_",
  "OLLAMA_",
  "OPENAI_",
  "OPENROUTER_",
  "PERPLEXITY_",
  "TELEGRAM_",
  "TOGETHER_",
  "VENICE_",
  "VLLM_",
  "XAI_",
];

const RUNNER_ALLOWED_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CEREBRAS_",
  "DEEPSEEK_",
  "DEVICE_SYNC_",
  "FIREWORKS_",
  "GOOGLE_",
  "GROQ_",
  "HF_",
  "HOSTED_ASSISTANT_",
  "HUGGINGFACE_",
  "HUGGING_FACE_",
  "LINQ_",
  "LITELLM_",
  "LM_STUDIO_",
  "MISTRAL_",
  "NGC_",
  "NVIDIA_",
  "OLLAMA_",
  "OPENAI_",
  "OPENROUTER_",
  "OURA_",
  "PADDLEOCR_",
  "PDFTOTEXT_",
  "PERPLEXITY_",
  "TELEGRAM_",
  "TOGETHER_",
  "VENICE_",
  "VLLM_",
  "WHISPER_",
  "WHOOP_",
  "XAI_",
] as const;

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
  if (allowedKeys.has(key)) {
    return true;
  }

  const allowedPrefixes = [
    ...DEFAULT_ALLOWED_USER_ENV_PREFIXES,
    ...parseHostedEnvCsvList(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES),
  ];

  return allowedPrefixes.some((prefix) => key.startsWith(prefix));
}

export function buildHostedRunnerContainerEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  const automationEnabled = hostedAssistantAutomationEnabledFromUnknownEnv(source);
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value !== "string"
      || value.length === 0
      || !shouldForwardHostedRunnerEnv(key, automationEnabled)
    ) {
      continue;
    }

    values[key] = value;
  }

  if (automationEnabled) {
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
  source: UnknownEnvSource,
): Record<string, string> {
  const automationEnabled = hostedAssistantAutomationEnabledFromUnknownEnv(source);
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (isAutomationOnlyRunnerEnvKey(key, automationEnabled)) {
      continue;
    }

    values[key] = value;
  }

  return values;
}

export function isAllowedHostedAssistantReferencedRunnerEnvKey(key: string): boolean {
  return isAllowedRunnerEnvKey(key);
}

function shouldForwardHostedRunnerEnv(key: string, automationEnabled: boolean): boolean {
  return !isAutomationOnlyRunnerEnvKey(key, automationEnabled) && isAllowedRunnerEnvKey(key);
}

function isAllowedRunnerEnvKey(key: string): boolean {
  return RUNNER_EXACT_ALLOWED_ENV_KEYS.has(key)
    || RUNNER_ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isAutomationOnlyRunnerEnvKey(key: string, automationEnabled: boolean): boolean {
  if (automationEnabled) {
    return false;
  }

  return AUTOMATION_ONLY_RUNNER_ENV_KEYS.has(key)
    || AUTOMATION_ONLY_RUNNER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hostedAssistantAutomationEnabledFromUnknownEnv(
  source: UnknownEnvSource,
): boolean {
  return hostedAssistantAutomationEnabledFromEnv({
    HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION:
      typeof source.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION === "string"
        ? source.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION
        : undefined,
  });
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
