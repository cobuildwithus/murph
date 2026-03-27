const EXACT_ALLOWED_ENV_KEYS = new Set<string>([
  "AGENTMAIL_API_BASE_URL",
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_BASE_URL",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "DEVICE_SYNC_SECRET",
  "FFMPEG_COMMAND",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
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
  "WHISPER_MODEL",
  "WHISPER_MODEL_DIR",
  "WHISPER_MODEL_PATH",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
]);

const ALLOWED_ENV_PREFIXES = [
  "AGENTMAIL_",
  "ANTHROPIC_",
  "DEVICE_SYNC_",
  "FFMPEG_",
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
    if (typeof value !== "string" || value.length === 0 || !shouldForwardRunnerEnv(key)) {
      continue;
    }

    values[key] = value;
  }

  if (!values.NODE_ENV) {
    values.NODE_ENV = "production";
  }

  return values;
}

function shouldForwardRunnerEnv(key: string): boolean {
  return EXACT_ALLOWED_ENV_KEYS.has(key)
    || ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}
