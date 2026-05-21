import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "@murphai/hosted-execution/orchestration-control";

import type {
  HostedUserRuntimeWorkflowOptions,
} from "./index.js";

const DEFAULT_TEMPORAL_ADDRESS = "localhost:7233";
const DEFAULT_TEMPORAL_NAMESPACE = "default";
const DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 10_000;
const MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTED_EXECUTION_RUNNER_TIMEOUT_MS = 600_000;
const DEFAULT_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS = 30_000;

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedRuntimeTemporalEnvironment {
  address: string;
  namespace: string;
  taskQueue: string;
  tls: boolean;
}

export function readHostedRuntimeTemporalEnvironment(
  source: EnvSource = process.env,
): HostedRuntimeTemporalEnvironment {
  return {
    address:
      readOptionalTrimmedString(source.TEMPORAL_ADDRESS)
      ?? DEFAULT_TEMPORAL_ADDRESS,
    namespace:
      readOptionalTrimmedString(source.TEMPORAL_NAMESPACE)
      ?? DEFAULT_TEMPORAL_NAMESPACE,
    taskQueue:
      readOptionalTrimmedString(source.TEMPORAL_TASK_QUEUE)
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    tls: readBooleanEnv(source.TEMPORAL_TLS_ENABLED, "TEMPORAL_TLS_ENABLED"),
  };
}

export function readHostedUserRuntimeWorkflowOptions(
  source: EnvSource = process.env,
): HostedUserRuntimeWorkflowOptions {
  const runnerTimeoutMs = parsePositiveInteger(
    readOptionalTrimmedString(source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS),
    DEFAULT_HOSTED_EXECUTION_RUNNER_TIMEOUT_MS,
    "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
  );
  const ensureExecutionTimeoutMarginMs = parsePositiveInteger(
    readOptionalTrimmedString(source.HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS),
    DEFAULT_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS,
    "HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS",
  );

  return {
    ensureCloudflareExecutionStartToCloseTimeoutMs:
      runnerTimeoutMs + ensureExecutionTimeoutMarginMs,
    readRuntimeDemandStartToCloseTimeoutMs: parseBoundedPositiveInteger(
      readOptionalTrimmedString(source.HOSTED_RUNTIME_DEMAND_TIMEOUT_MS),
      DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS",
    ),
  };
}

function readOptionalTrimmedString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readBooleanEnv(value: string | undefined, label: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  throw new TypeError(`${label} must be true or false.`);
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  label: string,
): number {
  if (value === null) {
    return fallback;
  }
  if (!/^[0-9]+$/u.test(value)) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseBoundedPositiveInteger(
  value: string | null,
  fallback: number,
  max: number,
  label: string,
): number {
  const parsed = parsePositiveInteger(value, fallback, label);
  if (parsed > max) {
    throw new TypeError(`${label} must be less than or equal to ${max}.`);
  }
  return parsed;
}
