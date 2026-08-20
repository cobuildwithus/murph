import {
  isMurphAndroidAppEnabled,
  MURPH_ANDROID_APP_ENABLED_ENV,
} from "@murphai/hosted-execution/env";

import {
  HOSTED_WORKER_OPTIONAL_VAR_DEFAULTS,
  HOSTED_WORKER_REQUIRED_VAR_NAMES,
  HOSTED_WORKER_TRIMMED_OPTIONAL_VAR_NAMES,
} from "./worker-optional-vars.ts";

import {
  isObjectRecord,
  normalizeOptionalString,
  requireConfiguredString,
} from "./shared.ts";
const DEFAULT_LOG_HEAD_SAMPLING_RATE = 1;
const DEFAULT_TRACE_HEAD_SAMPLING_RATE = 1;
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

const DEFAULT_CONTAINER_INSTANCE_TYPE: HostedContainerInstanceType = {
  disk_mb: 6000,
  memory_mib: 6144,
  vcpu: 2,
};
const DEFAULT_CONTAINER_MAX_INSTANCES = 1000;
const RUNNER_COMMIT_RESPONSE_MARGIN_MS = 5_000;

export interface HostedDeployAutomationEnvironment {
  allowedRunnerSecretKeys: string | null;
  bundlesBucketName: string;
  bundlesPreviewBucketName: string;
  compatibilityDate: string;
  containerInstanceType: HostedContainerInstanceType;
  containerMaxInstances: number;
  logHeadSamplingRate: number;
  maxEventAttempts: string;
  retryDelayMs: string;
  runnerCommitTimeoutMs: string;
  runnerReadyTimeoutMs: string;
  traceHeadSamplingRate: number;
  webControlTimeoutMs: string;
  workerName: string;
  workerVars: Record<string, string>;
}

export function readHostedDeployAutomationTimeouts(
  source: EnvSource = process.env,
): Pick<
  HostedDeployAutomationEnvironment,
  "runnerCommitTimeoutMs" | "webControlTimeoutMs"
> {
  const runnerCommitTimeoutMs = normalizePositiveIntegerString(
    source.CF_RUNNER_COMMIT_TIMEOUT_MS,
    "45000",
    "CF_RUNNER_COMMIT_TIMEOUT_MS",
  );
  const webControlTimeoutMs = normalizePositiveIntegerString(
    source.CF_WEB_CONTROL_TIMEOUT_MS,
    "30000",
    "CF_WEB_CONTROL_TIMEOUT_MS",
  );
  if (
    Number(runnerCommitTimeoutMs)
    < Number(webControlTimeoutMs) + RUNNER_COMMIT_RESPONSE_MARGIN_MS
  ) {
    throw new Error(
      "CF_RUNNER_COMMIT_TIMEOUT_MS must be at least "
      + `${RUNNER_COMMIT_RESPONSE_MARGIN_MS}ms greater than `
      + "CF_WEB_CONTROL_TIMEOUT_MS.",
    );
  }
  return {
    runnerCommitTimeoutMs,
    webControlTimeoutMs,
  };
}

export function readHostedDeployAutomationEnvironment(
  source: EnvSource = process.env,
): HostedDeployAutomationEnvironment {
  const bundlesBucketName = requireConfiguredString(source.CF_BUNDLES_BUCKET, "CF_BUNDLES_BUCKET");
  const bundlesPreviewBucketName = requireConfiguredString(
    source.CF_BUNDLES_PREVIEW_BUCKET,
    "CF_BUNDLES_PREVIEW_BUCKET",
  );
  const workerName = requireConfiguredString(source.CF_WORKER_NAME, "CF_WORKER_NAME");
  const timeouts = readHostedDeployAutomationTimeouts(source);
  const workerVars = readHostedWorkerVars(source);
  assertHostedR2Configuration({
    bundlesBucketName,
    workerVars,
  });

  return {
    allowedRunnerSecretKeys: normalizeOptionalString(source.CF_ALLOWED_RUNNER_SECRET_KEYS),
    bundlesBucketName,
    bundlesPreviewBucketName,
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
    runnerCommitTimeoutMs: timeouts.runnerCommitTimeoutMs,
    runnerReadyTimeoutMs: normalizePositiveIntegerString(
      source.CF_RUNNER_READY_TIMEOUT_MS,
      "90000",
      "CF_RUNNER_READY_TIMEOUT_MS",
    ),
    traceHeadSamplingRate: normalizeSamplingRate(
      source.CF_TRACE_HEAD_SAMPLING_RATE,
      DEFAULT_TRACE_HEAD_SAMPLING_RATE,
      "CF_TRACE_HEAD_SAMPLING_RATE",
    ),
    webControlTimeoutMs: timeouts.webControlTimeoutMs,
    workerName,
    workerVars,
  };
}

function assertHostedR2Configuration(input: {
  bundlesBucketName: string;
  workerVars: Readonly<Record<string, string>>;
}): void {
  if (input.workerVars.HOSTED_R2_PRESIGN_BUCKET_NAME !== input.bundlesBucketName) {
    throw new TypeError(
      "HOSTED_R2_PRESIGN_BUCKET_NAME must match CF_BUNDLES_BUCKET.",
    );
  }
}

function readHostedWorkerVars(source: EnvSource): Record<string, string> {
  const androidAppEnabled = isMurphAndroidAppEnabled(source);

  return {
    ...Object.fromEntries(
      HOSTED_WORKER_REQUIRED_VAR_NAMES.map((key) => [
        key,
        requireConfiguredString(source[key], key),
      ]),
    ),
    ...Object.fromEntries(
      HOSTED_WORKER_TRIMMED_OPTIONAL_VAR_NAMES.flatMap((key) => {
        const value = resolveHostedWorkerVar(source, key);
        return value ? [[key, value] as const] : [];
      }),
    ),
    ...(androidAppEnabled
      ? { [MURPH_ANDROID_APP_ENABLED_ENV]: "1" }
      : {}),
  };
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
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be a ${description}.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a ${description}.`);
  }

  return parsed;
}

function resolveHostedWorkerVar(
  source: EnvSource,
  key: typeof HOSTED_WORKER_TRIMMED_OPTIONAL_VAR_NAMES[number],
): string | null {
  return normalizeOptionalString(source[key])
    ?? HOSTED_WORKER_OPTIONAL_VAR_DEFAULTS[key]
    ?? null;
}

function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return value;
}
