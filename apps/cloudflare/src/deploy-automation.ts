import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_EXECUTION_SIGNING_SECRET",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
] as const;

const HOSTED_WORKER_OPTIONAL_SECRET_NAMES = [
  "AGENTMAIL_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEVICE_SYNC_SECRET",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TOGETHER_API_KEY",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "XAI_API_KEY",
] as const;

const HOSTED_WORKER_OPTIONAL_VAR_NAMES = [
  "AGENTMAIL_API_BASE_URL",
  "AGENTMAIL_BASE_URL",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "FFMPEG_COMMAND",
  "LINQ_API_BASE_URL",
  "PADDLEOCR_COMMAND",
  "PADDLEOCR_MODEL_DIR",
  "PARSER_FFMPEG_PATH",
  "PDFTOTEXT_COMMAND",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "WHISPER_COMMAND",
  "WHISPER_MODEL",
  "WHISPER_MODEL_DIR",
  "WHISPER_MODEL_PATH",
] as const;

const HOSTED_CONTAINER_IMAGE_VAR_NAMES = [
  "INSTALL_PADDLEOCR",
] as const;

const DEFAULT_DEPLOY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONTAINER_MAX_INSTANCES = 1000;

export interface HostedDeployAutomationEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundlesBucketName: string;
  bundlesPreviewBucketName: string;
  bundleEncryptionKeyId: string;
  cloudflareBaseUrl: string;
  compatibilityDate: string;
  containerMaxInstances: number;
  defaultAlarmDelayMs: string;
  imageVars: Record<string, string>;
  maxEventAttempts: string;
  retryDelayMs: string;
  runnerCommitTimeoutMs: string;
  runnerTimeoutMs: string;
  workerName: string;
  workerVars: Record<string, string>;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedDeployAutomationEnvironment(
  source: EnvSource = process.env,
): HostedDeployAutomationEnvironment {
  return {
    allowedUserEnvKeys: normalizeString(source.CF_ALLOWED_USER_ENV_KEYS),
    allowedUserEnvPrefixes: normalizeString(source.CF_ALLOWED_USER_ENV_PREFIXES),
    bundlesBucketName: requireString(source.CF_BUNDLES_BUCKET, "CF_BUNDLES_BUCKET"),
    bundlesPreviewBucketName: requireString(
      source.CF_BUNDLES_PREVIEW_BUCKET,
      "CF_BUNDLES_PREVIEW_BUCKET",
    ),
    bundleEncryptionKeyId: normalizeString(source.CF_BUNDLE_KEY_ID) ?? "v1",
    cloudflareBaseUrl: normalizeBaseUrl(
      requireString(source.CF_PUBLIC_BASE_URL, "CF_PUBLIC_BASE_URL"),
      "CF_PUBLIC_BASE_URL",
    ),
    compatibilityDate: normalizeString(source.CF_COMPATIBILITY_DATE) ?? "2026-03-27",
    containerMaxInstances: normalizePositiveInteger(
      source.CF_CONTAINER_MAX_INSTANCES,
      DEFAULT_CONTAINER_MAX_INSTANCES,
      "CF_CONTAINER_MAX_INSTANCES",
    ),
    defaultAlarmDelayMs: normalizePositiveIntegerString(
      source.CF_DEFAULT_ALARM_DELAY_MS,
      "21600000",
      "CF_DEFAULT_ALARM_DELAY_MS",
    ),
    imageVars: readPresentStringMap(source, HOSTED_CONTAINER_IMAGE_VAR_NAMES),
    maxEventAttempts: normalizePositiveIntegerString(
      source.CF_MAX_EVENT_ATTEMPTS,
      "3",
      "CF_MAX_EVENT_ATTEMPTS",
    ),
    retryDelayMs: normalizePositiveIntegerString(
      source.CF_RETRY_DELAY_MS,
      "30000",
      "CF_RETRY_DELAY_MS",
    ),
    runnerCommitTimeoutMs: normalizePositiveIntegerString(
      normalizeString(source.CF_RUNNER_COMMIT_TIMEOUT_MS)
        ?? normalizeString(source.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS)
        ?? "30000",
      "30000",
      "CF_RUNNER_COMMIT_TIMEOUT_MS or HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
    ),
    runnerTimeoutMs: normalizePositiveIntegerString(
      source.CF_RUNNER_TIMEOUT_MS,
      "60000",
      "CF_RUNNER_TIMEOUT_MS",
    ),
    workerName: requireString(source.CF_WORKER_NAME, "CF_WORKER_NAME"),
    workerVars: readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_VAR_NAMES),
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
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: environment.runnerCommitTimeoutMs,
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: environment.runnerTimeoutMs,
    ...environment.workerVars,
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
    containers: [
      {
        class_name: "UserRunnerDurableObject",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        ...(Object.keys(environment.imageVars).length > 0
          ? {
              image_vars: environment.imageVars,
            }
          : {}),
        max_instances: environment.containerMaxInstances,
      },
    ],
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
  return {
    ...readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES),
    ...readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_SECRET_NAMES),
  };
}

export function resolveCloudflareDeployPaths(baseDir = DEFAULT_DEPLOY_ROOT): {
  deployDir: string;
  workerSecretsPath: string;
  wranglerConfigPath: string;
} {
  const deployDir = path.join(baseDir, ".deploy");

  return {
    deployDir,
    workerSecretsPath: path.join(deployDir, "worker-secrets.json"),
    wranglerConfigPath: path.join(deployDir, "wrangler.generated.jsonc"),
  };
}

function normalizeBaseUrl(value: string, label: string): string {
  const url = new URL(value.trim());

  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${label} must be an https URL.`);
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

function normalizePositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function normalizePositiveIntegerString(
  value: string | undefined,
  fallback: string,
  label: string,
): string {
  const normalized = normalizeString(value) ?? fallback;
  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer string.`);
  }

  return String(parsed);
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
