import path from "node:path";
import { fileURLToPath } from "node:url";

import { hostedAssistantAutomationEnabledFromEnv } from "@murphai/hosted-execution";

import { isAllowedHostedAssistantReferencedRunnerEnvKey } from "./hosted-env-policy.ts";

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_EXECUTION_SIGNING_SECRET",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
] as const;

const HOSTED_WORKER_OPTIONAL_SECRET_NAMES = [
  "AGENTMAIL_API_KEY",
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEVICE_SYNC_SECRET",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON",
  "HOSTED_EXECUTION_INTERNAL_TOKEN",
  "HOSTED_SHARE_INTERNAL_TOKEN",
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

const HOSTED_WORKER_OPTIONAL_VAR_NAMES = [
  "AGENTMAIL_BASE_URL",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "FFMPEG_COMMAND",
  "HOSTED_ASSISTANT_API_KEY_ENV",
  "HOSTED_ASSISTANT_APPROVAL_POLICY",
  "HOSTED_ASSISTANT_BASE_URL",
  "HOSTED_ASSISTANT_CODEX_COMMAND",
  "HOSTED_ASSISTANT_MODEL",
  "HOSTED_ASSISTANT_OSS",
  "HOSTED_ASSISTANT_PROFILE",
  "HOSTED_ASSISTANT_PROVIDER",
  "HOSTED_ASSISTANT_PROVIDER_NAME",
  "HOSTED_ASSISTANT_REASONING_EFFORT",
  "HOSTED_ASSISTANT_SANDBOX",
  "HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS",
  "HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION",
  "HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER",
  "HOSTED_AI_USAGE_BASE_URL",
  "HOSTED_DEVICE_SYNC_CONTROL_BASE_URL",
  "HOSTED_SHARE_API_BASE_URL",
  "HOSTED_WEB_BASE_URL",
  "LINQ_API_BASE_URL",
  "PDFTOTEXT_COMMAND",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
] as const;

const HOSTED_CONTAINER_IMAGE_VAR_NAMES = [
  "INSTALL_PADDLEOCR",
] as const;

const DEFAULT_DEPLOY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONTAINER_INSTANCE_TYPE = "basic";
const DEFAULT_CONTAINER_MAX_INSTANCES = 50;
const DEFAULT_CONTAINER_SLEEP_AFTER = "5m";
const DEFAULT_LOG_HEAD_SAMPLING_RATE = 1;
const DEFAULT_TRACE_HEAD_SAMPLING_RATE = 0.1;
const NAMED_CONTAINER_INSTANCE_TYPES = new Set([
  "basic",
  "dev",
  "lite",
  "standard",
  "standard-1",
  "standard-2",
  "standard-3",
  "standard-4",
] as const);

type NamedContainerInstanceType =
  | "basic"
  | "dev"
  | "lite"
  | "standard"
  | "standard-1"
  | "standard-2"
  | "standard-3"
  | "standard-4";

export interface HostedContainerCustomInstanceType {
  disk_mb: number;
  memory_mib: number;
  vcpu: number;
}

export type HostedContainerInstanceType =
  | NamedContainerInstanceType
  | HostedContainerCustomInstanceType;

export interface HostedDeployAutomationEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundlesBucketName: string;
  bundlesPreviewBucketName: string;
  bundleEncryptionKeyId: string;
  compatibilityDate: string;
  containerInstanceType: HostedContainerInstanceType;
  containerMaxInstances: number;
  defaultAlarmDelayMs: string;
  imageVars: Record<string, string>;
  logHeadSamplingRate: number;
  maxEventAttempts: string;
  retryDelayMs: string;
  runnerCommitTimeoutMs: string;
  runnerTimeoutMs: string;
  traceHeadSamplingRate: number;
  workerName: string;
  workerVars: Record<string, string>;
}

export type {
  HostedContainerImageListing,
  HostedContainerImageTagReference,
} from "./deploy-automation/container-images.ts";
export {
  parseHostedContainerImageListOutput,
  selectHostedContainerImageTagsForCleanup,
} from "./deploy-automation/container-images.ts";
export type {
  HostedWorkerDeploymentVersionTraffic,
  HostedWorkerGradualDeploymentSupport,
} from "./deploy-automation/deployment-traffic.ts";
export {
  formatHostedWorkerDeploymentVersionSpecs,
  resolveHostedWorkerDeploymentTraffic,
  resolveHostedWorkerGradualDeploymentSupport,
} from "./deploy-automation/deployment-traffic.ts";

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
    compatibilityDate: normalizeString(source.CF_COMPATIBILITY_DATE) ?? "2026-03-27",
    containerInstanceType: normalizeContainerInstanceType(
      source.CF_CONTAINER_INSTANCE_TYPE,
      DEFAULT_CONTAINER_INSTANCE_TYPE,
      "CF_CONTAINER_INSTANCE_TYPE",
    ),
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
    logHeadSamplingRate: normalizeSamplingRate(
      source.CF_LOG_HEAD_SAMPLING_RATE,
      DEFAULT_LOG_HEAD_SAMPLING_RATE,
      "CF_LOG_HEAD_SAMPLING_RATE",
    ),
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
      source.CF_RUNNER_COMMIT_TIMEOUT_MS,
      "30000",
      "CF_RUNNER_COMMIT_TIMEOUT_MS",
    ),
    runnerTimeoutMs: normalizePositiveIntegerString(
      source.CF_RUNNER_TIMEOUT_MS,
      "60000",
      "CF_RUNNER_TIMEOUT_MS",
    ),
    traceHeadSamplingRate: normalizeSamplingRate(
      source.CF_TRACE_HEAD_SAMPLING_RATE,
      DEFAULT_TRACE_HEAD_SAMPLING_RATE,
      "CF_TRACE_HEAD_SAMPLING_RATE",
    ),
    workerName: requireString(source.CF_WORKER_NAME, "CF_WORKER_NAME"),
    workerVars: readHostedWorkerVars(source),
  };
}

export function buildHostedWranglerDeployConfig(
  environment: HostedDeployAutomationEnvironment,
): Record<string, unknown> {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: environment.bundleEncryptionKeyId,
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
        class_name: "RunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        instance_type: environment.containerInstanceType,
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
        {
          name: "RUNNER_CONTAINER",
          class_name: "RunnerContainer",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["UserRunnerDurableObject"],
      },
      {
        tag: "v2",
        new_sqlite_classes: ["RunnerContainer"],
      },
    ],
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: environment.bundlesBucketName,
        preview_bucket_name: environment.bundlesPreviewBucketName,
      },
    ],
    observability: {
      enabled: true,
      head_sampling_rate: environment.logHeadSamplingRate,
      traces: {
        enabled: true,
        head_sampling_rate: environment.traceHeadSamplingRate,
      },
    },
    secrets: {
      required: [...HOSTED_WORKER_REQUIRED_SECRET_NAMES],
    },
    vars,
  };
}

function readHostedWorkerVars(source: EnvSource): Record<string, string> {
  return Object.fromEntries(
    HOSTED_WORKER_OPTIONAL_VAR_NAMES.flatMap((key) => {
      const value = resolveHostedWorkerVar(source, key);
      return value ? [[key, value] as const] : [];
    }),
  );
}

export function buildHostedWorkerSecretsPayload(
  source: EnvSource = process.env,
): Record<string, string> {
  return {
    ...readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES),
    ...readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_SECRET_NAMES),
    ...readHostedAssistantReferencedSecret(source),
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

function normalizeContainerInstanceType(
  value: string | undefined,
  fallback: HostedContainerInstanceType,
  label: string,
): HostedContainerInstanceType {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  if (NAMED_CONTAINER_INSTANCE_TYPES.has(normalized as NamedContainerInstanceType)) {
    return normalized as NamedContainerInstanceType;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(
      `${label} must be one of ${Array.from(NAMED_CONTAINER_INSTANCE_TYPES).join(", ")} or a JSON object with vcpu, memory_mib, and disk_mb.`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} custom values must be a JSON object.`);
  }

  const vcpu = requirePositiveNumber(parsed.vcpu, `${label}.vcpu`);
  const memory_mib = requirePositiveNumber(parsed.memory_mib, `${label}.memory_mib`);
  const disk_mb = requirePositiveNumber(parsed.disk_mb, `${label}.disk_mb`);
  const unknownKeys = Object.keys(parsed).filter(
    (key) => key !== "disk_mb" && key !== "memory_mib" && key !== "vcpu",
  );

  if (unknownKeys.length > 0) {
    throw new Error(`${label} custom values include unsupported keys: ${unknownKeys.join(", ")}.`);
  }

  return {
    disk_mb,
    memory_mib,
    vcpu,
  };
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

function normalizeSamplingRate(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`);
  }

  return parsed;
}

function resolveHostedWorkerVar(
  source: EnvSource,
  key: typeof HOSTED_WORKER_OPTIONAL_VAR_NAMES[number],
): string | null {
  const value = normalizeString(source[key]);

  if (
    key === "HOSTED_ASSISTANT_API_KEY_ENV"
    && value
    && !isAllowedHostedAssistantReferencedRunnerEnvKey(value)
  ) {
    return null;
  }

  if (value) {
    return value;
  }

  return key === "HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER" ? DEFAULT_CONTAINER_SLEEP_AFTER : null;
}

function readHostedAssistantReferencedSecret(
  source: EnvSource,
): Record<string, string> {
  if (!hostedAssistantAutomationEnabledFromEnv(source)) {
    return {};
  }

  const envName = normalizeString(source.HOSTED_ASSISTANT_API_KEY_ENV);

  if (!envName || !isAllowedHostedAssistantReferencedRunnerEnvKey(envName)) {
    return {};
  }

  const value = normalizeString(source[envName]);
  return value ? { [envName]: value } : {};
}

function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
