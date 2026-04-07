import { isAllowedHostedAssistantReferencedRunnerEnvKey } from "../hosted-env-policy.ts";

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
] as const;

const HOSTED_WORKER_OPTIONAL_SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "BRAVE_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEVICE_SYNC_SECRET",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HOSTED_EMAIL_CLOUDFLARE_API_TOKEN",
  "HOSTED_EMAIL_SIGNING_SECRET",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "LITELLM_PROXY_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TOGETHER_API_KEY",
  "VENICE_API_KEY",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "XAI_API_KEY",
] as const;

type EnvSource = Readonly<Record<string, string | undefined>>;

export function buildHostedWorkerSecretsPayload(
  source: EnvSource = process.env,
): Record<string, string> {
  return {
    ...readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES),
    ...readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_SECRET_NAMES),
    ...readHostedAssistantReferencedSecret(source),
  };
}

function readHostedAssistantReferencedSecret(
  source: EnvSource,
): Record<string, string> {
  const envName = normalizeString(source.HOSTED_ASSISTANT_API_KEY_ENV);

  if (!envName || !isAllowedHostedAssistantReferencedRunnerEnvKey(envName)) {
    return {};
  }

  const value = normalizeString(source[envName]);
  return value ? { [envName]: value } : {};
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireString(value: string | undefined, label: string): string {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new Error(`${label} must be configured.`);
  }

  return normalized;
}

function readPresentStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  const entries = keys.flatMap((key) => {
    const value = normalizeString(source[key]);
    return value ? [[key, value] as const] : [];
  });

  return Object.fromEntries(entries);
}

function readRequiredStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => [key, requireString(source[key], key)]),
  );
}
