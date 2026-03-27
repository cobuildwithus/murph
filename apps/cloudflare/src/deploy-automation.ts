import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_EXECUTION_SIGNING_SECRET",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
] as const;

const RUNNER_REQUIRED_ENV_NAMES = [
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
] as const;

const RUNNER_DEFAULT_ENV: Readonly<Record<string, string>> = {
  HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "30000",
  NODE_ENV: "production",
  PADDLEOCR_MODEL_DIR: "/root/.healthybob/models/paddleocr",
  PARSER_FFMPEG_PATH: "/usr/bin/ffmpeg",
  PORT: "8080",
  WHISPER_MODEL: "base",
  WHISPER_MODEL_DIR: "/root/.healthybob/models/whisper",
};

const RUNNER_PASSTHROUGH_KEYS = [
  "PARSER_FFMPEG_PATH",
  "PORT",
  "WHISPER_MODEL",
  "WHISPER_MODEL_DIR",
  "PADDLEOCR_MODEL_DIR",
] as const;

const RUNNER_PASSTHROUGH_PREFIXES = [
  "AGENTMAIL_",
  "ANTHROPIC_",
  "DEVICE_SYNC_",
  "GOOGLE_",
  "GOOGLE_GENERATIVE_AI_",
  "GROQ_",
  "HB_USER_",
  "HEALTHYBOB_LINQ_",
  "LINQ_",
  "MISTRAL_",
  "OPENAI_",
  "OPENROUTER_",
  "OURA_",
  "PADDLEOCR_",
  "TELEGRAM_",
  "TOGETHER_",
  "WHISPER_",
  "WHOOP_",
  "XAI_",
] as const;

const DEFAULT_DEPLOY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface HostedDeployAutomationEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundlesBucketName: string;
  bundlesPreviewBucketName: string;
  bundleEncryptionKeyId: string;
  cloudflareBaseUrl: string;
  compatibilityDate: string;
  defaultAlarmDelayMs: string;
  maxEventAttempts: string;
  retryDelayMs: string;
  runnerBaseUrl: string;
  runnerTimeoutMs: string;
  workerName: string;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedDeployAutomationEnvironment(
  source: EnvSource = process.env,
): HostedDeployAutomationEnvironment {
  return {
    allowedUserEnvKeys: normalizeString(source.HB_CF_ALLOWED_USER_ENV_KEYS),
    allowedUserEnvPrefixes: normalizeString(source.HB_CF_ALLOWED_USER_ENV_PREFIXES),
    bundlesBucketName: requireString(source.HB_CF_BUNDLES_BUCKET, "HB_CF_BUNDLES_BUCKET"),
    bundlesPreviewBucketName: requireString(
      source.HB_CF_BUNDLES_PREVIEW_BUCKET,
      "HB_CF_BUNDLES_PREVIEW_BUCKET",
    ),
    bundleEncryptionKeyId: normalizeString(source.HB_CF_BUNDLE_KEY_ID) ?? "v1",
    cloudflareBaseUrl: normalizeBaseUrl(
      requireString(source.HB_CF_PUBLIC_BASE_URL, "HB_CF_PUBLIC_BASE_URL"),
      "HB_CF_PUBLIC_BASE_URL",
    ),
    compatibilityDate: normalizeString(source.HB_CF_COMPATIBILITY_DATE) ?? "2026-03-26",
    defaultAlarmDelayMs: normalizePositiveIntegerString(
      source.HB_CF_DEFAULT_ALARM_DELAY_MS,
      "900000",
      "HB_CF_DEFAULT_ALARM_DELAY_MS",
    ),
    maxEventAttempts: normalizePositiveIntegerString(
      source.HB_CF_MAX_EVENT_ATTEMPTS,
      "3",
      "HB_CF_MAX_EVENT_ATTEMPTS",
    ),
    retryDelayMs: normalizePositiveIntegerString(
      source.HB_CF_RETRY_DELAY_MS,
      "30000",
      "HB_CF_RETRY_DELAY_MS",
    ),
    runnerBaseUrl: normalizeBaseUrl(
      requireString(source.HB_CF_RUNNER_BASE_URL, "HB_CF_RUNNER_BASE_URL"),
      "HB_CF_RUNNER_BASE_URL",
    ),
    runnerTimeoutMs: normalizePositiveIntegerString(
      source.HB_CF_RUNNER_TIMEOUT_MS,
      "60000",
      "HB_CF_RUNNER_TIMEOUT_MS",
    ),
    workerName: requireString(source.HB_CF_WORKER_NAME, "HB_CF_WORKER_NAME"),
  };
}

export function buildHostedWranglerDeployConfig(
  environment: HostedDeployAutomationEnvironment,
): Record<string, unknown> {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: environment.bundleEncryptionKeyId,
    HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: environment.cloudflareBaseUrl,
    HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS: environment.defaultAlarmDelayMs,
    HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: environment.maxEventAttempts,
    HOSTED_EXECUTION_RETRY_DELAY_MS: environment.retryDelayMs,
    HOSTED_EXECUTION_RUNNER_BASE_URL: environment.runnerBaseUrl,
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: environment.runnerTimeoutMs,
  };

  if (environment.allowedUserEnvKeys) {
    vars.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = environment.allowedUserEnvKeys;
  }

  if (environment.allowedUserEnvPrefixes) {
    vars.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES = environment.allowedUserEnvPrefixes;
  }

  return {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: environment.workerName,
    main: "../src/index.ts",
    compatibility_date: environment.compatibilityDate,
    compatibility_flags: ["nodejs_compat"],
    durable_objects: {
      bindings: [
        {
          name: "USER_RUNNER",
          class_name: "UserRunnerDurableObject",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["UserRunnerDurableObject"],
      },
    ],
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: environment.bundlesBucketName,
        preview_bucket_name: environment.bundlesPreviewBucketName,
      },
    ],
    vars,
    secrets: {
      required: [...HOSTED_WORKER_REQUIRED_SECRET_NAMES],
    },
  };
}

export function buildHostedWorkerSecretsPayload(
  source: EnvSource = process.env,
): Record<string, string> {
  return readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES);
}

export function buildHostedRunnerEnvironment(
  source: EnvSource = process.env,
): Record<string, string> {
  const base = {
    ...RUNNER_DEFAULT_ENV,
    ...readRequiredStringMap(source, RUNNER_REQUIRED_ENV_NAMES),
  };
  const next: Record<string, string> = { ...base };

  for (const key of RUNNER_PASSTHROUGH_KEYS) {
    const value = normalizeString(source[key]);

    if (value) {
      next[key] = value;
    }
  }

  for (const [key, rawValue] of Object.entries(source)) {
    const value = normalizeString(rawValue);

    if (!value) {
      continue;
    }

    if (RUNNER_PASSTHROUGH_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      next[key] = value;
    }
  }

  next.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS = normalizePositiveIntegerString(
    source.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? source.HB_CF_RUNNER_COMMIT_TIMEOUT_MS,
    RUNNER_DEFAULT_ENV.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  );

  if (normalizeString(source.HB_CF_ALLOWED_USER_ENV_KEYS)) {
    next.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = source.HB_CF_ALLOWED_USER_ENV_KEYS!.trim();
  }

  if (normalizeString(source.HB_CF_ALLOWED_USER_ENV_PREFIXES)) {
    next.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES = source.HB_CF_ALLOWED_USER_ENV_PREFIXES!.trim();
  }

  return sortRecord(next);
}

export function formatEnvFile(input: Readonly<Record<string, string>>): string {
  return `${Object.entries(sortRecord(input)).map(([key, value]) => `${key}=${escapeEnvValue(value)}`).join("\n")}\n`;
}

export function resolveCloudflareDeployPaths(baseDir = DEFAULT_DEPLOY_ROOT): {
  deployDir: string;
  runnerEnvPath: string;
  workerSecretsPath: string;
  wranglerConfigPath: string;
} {
  const deployDir = path.join(baseDir, ".deploy");

  return {
    deployDir,
    runnerEnvPath: path.join(deployDir, "runner.env"),
    workerSecretsPath: path.join(deployDir, "worker-secrets.json"),
    wranglerConfigPath: path.join(deployDir, "wrangler.generated.jsonc"),
  };
}

function escapeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]+$/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeBaseUrl(value: string, label: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";

  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new TypeError(`${label} must be an https URL.`);
  }

  return url.toString().replace(/\/$/u, "");
}

function normalizePositiveIntegerString(
  value: string | undefined,
  fallback: string,
  label: string,
): string {
  const normalized = normalizeString(value) ?? fallback;

  if (!/^\d+$/u.test(normalized) || Number.parseInt(normalized, 10) <= 0) {
    throw new TypeError(`${label} must be a positive integer string.`);
  }

  return normalized;
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readRequiredStringMap<TKeys extends readonly string[]>(
  source: EnvSource,
  keys: TKeys,
): Record<TKeys[number], string> {
  const entries = keys.map((key) => [key, requireString(source[key], key)]);

  return Object.fromEntries(entries) as Record<TKeys[number], string>;
}

function requireString(value: string | undefined, label: string): string {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new TypeError(`${label} must be configured.`);
  }

  return normalized;
}

function sortRecord<TValue>(value: Readonly<Record<string, TValue>>): Record<string, TValue> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}
