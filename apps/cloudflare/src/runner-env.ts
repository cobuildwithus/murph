const AUTOMATION_ONLY_EXACT_ALLOWED_ENV_KEYS = new Set<string>([
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "HOSTED_EMAIL_DOMAIN",
  "HOSTED_EMAIL_FROM_ADDRESS",
  "HOSTED_EMAIL_LOCAL_PART",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
]);

const EXACT_ALLOWED_ENV_KEYS = new Set<string>([
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_BASE_URL",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "DEVICE_SYNC_SECRET",
  "FFMPEG_COMMAND",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES",
  "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
  "HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EMAIL_LOCAL_PART",
  "HOSTED_EMAIL_FROM_ADDRESS",
  "HOSTED_EMAIL_DOMAIN",
  "NODE_ENV",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "PADDLEOCR_COMMAND",
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

const AUTOMATION_ONLY_ALLOWED_ENV_PREFIXES = [
  "ANTHROPIC_",
  "GOOGLE_",
  "GROQ_",
  "LINQ_",
  "MISTRAL_",
  "OLLAMA_",
  "OPENAI_",
  "OPENROUTER_",
  "PERPLEXITY_",
  "TELEGRAM_",
  "TOGETHER_",
  "XAI_",
];

const ALLOWED_ENV_PREFIXES = [
  "ANTHROPIC_",
  "DEVICE_SYNC_",
  "GOOGLE_",
  "GROQ_",
  "LINQ_",
  "MISTRAL_",
  "OLLAMA_",
  "OPENAI_",
  "OPENROUTER_",
  "OURA_",
  "PADDLEOCR_",
  "PDFTOTEXT_",
  "PERPLEXITY_",
  "TELEGRAM_",
  "TOGETHER_",
  "WHISPER_",
  "WHOOP_",
  "XAI_",
];

export function buildHostedRunnerContainerEnv(
  source: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string" || value.length === 0 || !shouldForwardRunnerEnv(key, source)) {
      continue;
    }

    values[key] = value;
  }

  if (!values.NODE_ENV) {
    values.NODE_ENV = "production";
  }

  return values;
}

export function filterHostedRunnerUserEnv(
  env: Readonly<Record<string, string>>,
  source: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (shouldStripAutomationOnlyEnvKey(key, source)) {
      continue;
    }

    values[key] = value;
  }

  return values;
}

function shouldForwardRunnerEnv(
  key: string,
  source: Readonly<Record<string, unknown>>,
): boolean {
  if (shouldStripAutomationOnlyEnvKey(key, source)) {
    return false;
  }

  return EXACT_ALLOWED_ENV_KEYS.has(key)
    || ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function shouldStripAutomationOnlyEnvKey(
  key: string,
  source: Readonly<Record<string, unknown>>,
): boolean {
  if (hostedAssistantAutomationEnabled(source)) {
    return false;
  }

  if (AUTOMATION_ONLY_EXACT_ALLOWED_ENV_KEYS.has(key)) {
    return true;
  }

  return AUTOMATION_ONLY_ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hostedAssistantAutomationEnabled(source: Readonly<Record<string, unknown>>): boolean {
  const value = typeof source.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION === "string"
    ? source.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION.trim().toLowerCase()
    : "";

  return value === "1" || value === "true" || value === "yes";
}
