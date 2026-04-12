import {
  isHostedAssistantApiKeyEnvName,
  readHostedAssistantApiKeyEnvName,
} from "@murphai/assistant-runtime/hosted-assistant-env";
import {
  HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV,
} from "../../src/hosted-env-policy.ts";

import {
  isObjectRecord,
  normalizeOptionalString,
  requireConfiguredString,
} from "./shared.ts";

const HOSTED_WORKER_OPTIONAL_VAR_NAMES = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "FFMPEG_COMMAND",
  "MURPH_WEB_FETCH_ENABLED",
  "HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID",
  "HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL",
  "HOSTED_EMAIL_DEFAULT_SUBJECT",
  "HOSTED_EMAIL_DOMAIN",
  "HOSTED_EMAIL_FROM_ADDRESS",
  "HOSTED_EMAIL_LOCAL_PART",
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
  "HOSTED_ASSISTANT_ZERO_DATA_RETENTION",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV,
  "HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS",
  "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_WEB_BASE_URL",
  "LINQ_API_BASE_URL",
  "MURPH_WEB_SEARCH_MAX_RESULTS",
  "MURPH_WEB_SEARCH_PROVIDER",
  "MURPH_WEB_SEARCH_TIMEOUT_MS",
  "PDFTOTEXT_COMMAND",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
] as const;

const DEFAULT_CONTAINER_INSTANCE_TYPE: NamedContainerInstanceType = "standard-1";
const DEFAULT_CONTAINER_MAX_INSTANCES = 50;
const DEFAULT_LOG_HEAD_SAMPLING_RATE = 0;
const DEFAULT_TRACE_HEAD_SAMPLING_RATE = 0;
const NAMED_CONTAINER_INSTANCE_TYPES = [
  "basic",
  "dev",
  "lite",
  "standard",
  "standard-1",
  "standard-2",
  "standard-3",
  "standard-4",
] as const;
const NAMED_CONTAINER_INSTANCE_TYPE_SET = new Set<string>(NAMED_CONTAINER_INSTANCE_TYPES);

type NamedContainerInstanceType = (typeof NAMED_CONTAINER_INSTANCE_TYPES)[number];

type EnvSource = Readonly<Record<string, string | undefined>>;

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
  bundlesBucketName: string;
  bundlesPreviewBucketName: string;
  platformEnvelopeKeyId: string;
  compatibilityDate: string;
  containerInstanceType: HostedContainerInstanceType;
  containerMaxInstances: number;
  logHeadSamplingRate: number;
  maxEventAttempts: string;
  retryDelayMs: string;
  runnerCommitTimeoutMs: string;
  runnerTimeoutMs: string;
  traceHeadSamplingRate: number;
  workerName: string;
  workerVars: Record<string, string>;
}

export function readHostedDeployAutomationEnvironment(
  source: EnvSource = process.env,
): HostedDeployAutomationEnvironment {
  return {
    allowedUserEnvKeys: normalizeOptionalString(source.CF_ALLOWED_USER_ENV_KEYS),
    bundlesBucketName: requireConfiguredString(source.CF_BUNDLES_BUCKET, "CF_BUNDLES_BUCKET"),
    bundlesPreviewBucketName: requireConfiguredString(
      source.CF_BUNDLES_PREVIEW_BUCKET,
      "CF_BUNDLES_PREVIEW_BUCKET",
    ),
    platformEnvelopeKeyId: normalizeOptionalString(source.CF_PLATFORM_ENVELOPE_KEY_ID) ?? "v1",
    compatibilityDate: normalizeOptionalString(source.CF_COMPATIBILITY_DATE) ?? "2026-03-27",
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
      "120000",
      "CF_RUNNER_TIMEOUT_MS",
    ),
    traceHeadSamplingRate: normalizeSamplingRate(
      source.CF_TRACE_HEAD_SAMPLING_RATE,
      DEFAULT_TRACE_HEAD_SAMPLING_RATE,
      "CF_TRACE_HEAD_SAMPLING_RATE",
    ),
    workerName: requireConfiguredString(source.CF_WORKER_NAME, "CF_WORKER_NAME"),
    workerVars: readHostedWorkerVars(source),
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

function normalizePositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return fallback;
  }

  return parsePositiveInteger(normalized, label, "positive integer");
}

function isNamedContainerInstanceType(value: string): value is NamedContainerInstanceType {
  return NAMED_CONTAINER_INSTANCE_TYPE_SET.has(value);
}

function normalizeContainerInstanceType(
  value: string | undefined,
  fallback: HostedContainerInstanceType,
  label: string,
): HostedContainerInstanceType {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return fallback;
  }

  if (isNamedContainerInstanceType(normalized)) {
    return normalized;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(
      `${label} must be one of ${NAMED_CONTAINER_INSTANCE_TYPES.join(", ")} or a JSON object with vcpu, memory_mib, and disk_mb.`,
    );
  }

  if (!isObjectRecord(parsed)) {
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
  const normalized = normalizeOptionalString(value) ?? fallback;
  return String(parsePositiveInteger(normalized, label, "positive integer string"));
}

function normalizeSamplingRate(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`);
  }

  return parsed;
}

function parsePositiveInteger(value: string, label: string, description: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a ${description}.`);
  }

  return parsed;
}

function resolveHostedWorkerVar(
  source: EnvSource,
  key: typeof HOSTED_WORKER_OPTIONAL_VAR_NAMES[number],
): string | null {
  const value = key === "HOSTED_ASSISTANT_API_KEY_ENV"
    ? readHostedAssistantApiKeyEnvName(source)
    : normalizeOptionalString(source[key]);

  if (
    key === "HOSTED_ASSISTANT_API_KEY_ENV"
    && value
    && !isHostedAssistantApiKeyEnvName(value)
  ) {
    return null;
  }

  return value ?? (key === "MURPH_WEB_FETCH_ENABLED" ? "true" : null);
}

function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return value;
}
