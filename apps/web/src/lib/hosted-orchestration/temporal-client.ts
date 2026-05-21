import "server-only";

import {
  Client,
  Connection,
  type ConnectionOptions,
} from "@temporalio/client";

import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "@murphai/hosted-execution";

const DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 10_000;
const MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTED_EXECUTION_RUNNER_TIMEOUT_MS = 600_000;
const DEFAULT_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS = 30_000;

export interface HostedRuntimeTemporalEnvironment {
  address: string | null;
  apiKey: string | null;
  namespace: string;
  taskQueue: string;
  tls: boolean;
}

export interface HostedRuntimeTemporalWorkflowOptions {
  ensureCloudflareExecutionStartToCloseTimeoutMs: number;
  readRuntimeDemandStartToCloseTimeoutMs: number;
}

export interface HostedRuntimeTemporalSignalClient {
  workflow: {
    signalWithStart(
      workflowType: string,
      options: {
        args: unknown[];
        signal: string;
        signalArgs: unknown[];
        taskQueue: string;
        workflowId: string;
      },
    ): Promise<unknown>;
  };
}

let cachedClient:
  | Promise<HostedRuntimeTemporalSignalClient | null>
  | null = null;

export function readHostedRuntimeTemporalEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): HostedRuntimeTemporalEnvironment {
  const apiKey = readOptionalEnv(
    source,
    "HOSTED_TEMPORAL_API_KEY",
    "TEMPORAL_API_KEY",
  );
  const tls =
    readOptionalBooleanEnv(
      source,
      "HOSTED_TEMPORAL_TLS_ENABLED",
      "TEMPORAL_TLS_ENABLED",
    )
    ?? Boolean(apiKey);
  if (apiKey && tls === false) {
    throw new TypeError(
      "HOSTED_TEMPORAL_TLS_ENABLED cannot be false when HOSTED_TEMPORAL_API_KEY is configured.",
    );
  }

  return {
    address: readOptionalEnv(source, "HOSTED_TEMPORAL_ADDRESS", "TEMPORAL_ADDRESS"),
    apiKey,
    namespace:
      readOptionalEnv(source, "HOSTED_TEMPORAL_NAMESPACE", "TEMPORAL_NAMESPACE")
      ?? "default",
    taskQueue:
      readOptionalEnv(source, "HOSTED_TEMPORAL_TASK_QUEUE", "TEMPORAL_TASK_QUEUE")
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    tls,
  };
}

export function readHostedRuntimeTemporalWorkflowOptions(
  source: NodeJS.ProcessEnv = process.env,
): HostedRuntimeTemporalWorkflowOptions {
  const runnerTimeoutMs = parsePositiveInteger(
    readOptionalEnv(source, "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS"),
    DEFAULT_HOSTED_EXECUTION_RUNNER_TIMEOUT_MS,
    "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
  );
  const ensureExecutionTimeoutMarginMs = parsePositiveInteger(
    readOptionalEnv(source, "HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS"),
    DEFAULT_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS,
    "HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS",
  );

  return {
    ensureCloudflareExecutionStartToCloseTimeoutMs:
      runnerTimeoutMs + ensureExecutionTimeoutMarginMs,
    readRuntimeDemandStartToCloseTimeoutMs: parseBoundedPositiveInteger(
      readOptionalEnv(source, "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS"),
      DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS",
    ),
  };
}

export async function readHostedRuntimeTemporalSignalClientIfConfigured(): Promise<
  HostedRuntimeTemporalSignalClient | null
> {
  cachedClient ??= createHostedRuntimeTemporalSignalClient();
  return cachedClient;
}

export function resetHostedRuntimeTemporalSignalClientForTesting(): void {
  cachedClient = null;
}

async function createHostedRuntimeTemporalSignalClient(): Promise<
  HostedRuntimeTemporalSignalClient | null
> {
  const environment = readHostedRuntimeTemporalEnvironment();
  if (!environment.address) {
    return null;
  }

  const connection = await Connection.connect(buildConnectionOptions(environment));

  return new Client({
    connection,
    namespace: environment.namespace,
  });
}

function buildConnectionOptions(
  environment: HostedRuntimeTemporalEnvironment,
): ConnectionOptions {
  if (!environment.address) {
    throw new TypeError("HOSTED_TEMPORAL_ADDRESS must be configured.");
  }

  return {
    address: environment.address,
    ...(environment.apiKey ? { apiKey: environment.apiKey } : {}),
    tls: environment.tls,
  };
}

function readOptionalEnv(
  source: NodeJS.ProcessEnv,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function readOptionalBooleanEnv(
  source: NodeJS.ProcessEnv,
  ...keys: readonly string[]
): boolean | null {
  const value = readOptionalEnv(source, ...keys);
  if (value === null) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  throw new TypeError(`${keys[0]} must be true or false.`);
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
