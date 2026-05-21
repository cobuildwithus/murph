import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "./orchestration-control.ts";

export const HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS = "localhost:7233";
export const HOSTED_RUNTIME_TEMPORAL_DEFAULT_NAMESPACE = "default";

const DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 10_000;
const MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTED_EXECUTION_RUNNER_TIMEOUT_MS = 600_000;
const DEFAULT_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS = 30_000;
const DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 30_000;
const MAX_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 3_600_000;

export type HostedRuntimeTemporalEnvSource =
  Readonly<Record<string, string | undefined>>;

export interface HostedRuntimeTemporalEnvironment {
  address: string | null;
  apiKey: string | null;
  namespace: string;
  taskQueue: string;
  tls: HostedRuntimeTemporalTls;
}

export interface HostedRuntimeTemporalEnvironmentOptions {
  defaultAddress?: string | null;
  defaultNamespace?: string;
  defaultTaskQueue?: string;
}

export type HostedRuntimeTemporalTls = boolean | HostedRuntimeTemporalTlsConfig;

export interface HostedRuntimeTemporalTlsConfig {
  clientCertPair?: {
    crt: Buffer;
    key: Buffer;
  };
  serverNameOverride?: string;
  serverRootCACertificate?: Buffer;
}

export interface HostedRuntimeTemporalWorkflowOptions {
  ensureCloudflareExecutionStartToCloseTimeoutMs: number;
  readRuntimeDemandStartToCloseTimeoutMs: number;
  runtimeCompletedFailureRecheckDelayMs: number;
}

export function readHostedRuntimeTemporalEnvironment(
  source: HostedRuntimeTemporalEnvSource = process.env,
  options: HostedRuntimeTemporalEnvironmentOptions = {},
): HostedRuntimeTemporalEnvironment {
  const apiKey = readOptionalEnv(
    source,
    "HOSTED_TEMPORAL_API_KEY",
    "TEMPORAL_API_KEY",
  );
  return {
    address:
      readOptionalEnv(source, "HOSTED_TEMPORAL_ADDRESS", "TEMPORAL_ADDRESS")
      ?? options.defaultAddress
      ?? null,
    apiKey,
    namespace:
      readOptionalEnv(source, "HOSTED_TEMPORAL_NAMESPACE", "TEMPORAL_NAMESPACE")
      ?? options.defaultNamespace
      ?? HOSTED_RUNTIME_TEMPORAL_DEFAULT_NAMESPACE,
    taskQueue:
      readOptionalEnv(source, "HOSTED_TEMPORAL_TASK_QUEUE", "TEMPORAL_TASK_QUEUE")
      ?? options.defaultTaskQueue
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    tls: readTemporalTlsConfig(source, apiKey !== null),
  };
}

export function readHostedRuntimeTemporalWorkflowOptions(
  source: HostedRuntimeTemporalEnvSource = process.env,
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
    runtimeCompletedFailureRecheckDelayMs: parseBoundedPositiveInteger(
      readOptionalEnv(
        source,
        "HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS",
      ),
      DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      MAX_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      "HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS",
    ),
  };
}

function readOptionalEnv(
  source: HostedRuntimeTemporalEnvSource,
  ...keys: readonly string[]
): string | null {
  return readOptionalEnvEntry(source, ...keys)?.value ?? null;
}

function readOptionalEnvEntry(
  source: HostedRuntimeTemporalEnvSource,
  ...keys: readonly string[]
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) {
      return { key, value };
    }
  }
  return null;
}

function readTemporalTlsConfig(
  source: HostedRuntimeTemporalEnvSource,
  hasApiKey: boolean,
): HostedRuntimeTemporalTls {
  const tlsEnabled = readOptionalBooleanEnv(
    source,
    "HOSTED_TEMPORAL_TLS_ENABLED",
    "TEMPORAL_TLS_ENABLED",
  );
  const clientCert = readOptionalPemBuffer({
    base64Keys: [
      "HOSTED_TEMPORAL_CLIENT_CERT_BASE64",
      "TEMPORAL_CLIENT_CERT_BASE64",
    ],
    label: "TEMPORAL_CLIENT_CERT",
    pemKeys: [
      "HOSTED_TEMPORAL_CLIENT_CERT_PEM",
      "TEMPORAL_CLIENT_CERT_PEM",
    ],
    source,
  });
  const clientKey = readOptionalPemBuffer({
    base64Keys: [
      "HOSTED_TEMPORAL_CLIENT_KEY_BASE64",
      "TEMPORAL_CLIENT_KEY_BASE64",
    ],
    label: "TEMPORAL_CLIENT_KEY",
    pemKeys: [
      "HOSTED_TEMPORAL_CLIENT_KEY_PEM",
      "TEMPORAL_CLIENT_KEY_PEM",
    ],
    source,
  });
  const serverRootCa = readOptionalPemBuffer({
    base64Keys: [
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
      "TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
    ],
    label: "TEMPORAL_SERVER_ROOT_CA_CERT",
    pemKeys: [
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
      "TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
    ],
    source,
  });
  const serverNameOverride = readOptionalEnv(
    source,
    "HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE",
    "TEMPORAL_TLS_SERVER_NAME_OVERRIDE",
  );
  const hasTlsMaterial =
    clientCert !== null
    || clientKey !== null
    || serverRootCa !== null
    || serverNameOverride !== null;

  if (tlsEnabled === false && (hasApiKey || hasTlsMaterial)) {
    throw new TypeError(
      `${readTemporalTlsEnabledKey(source)} cannot be false when Temporal credentials or TLS material are configured.`,
    );
  }
  if ((clientCert === null) !== (clientKey === null)) {
    throw new TypeError(
      "TEMPORAL_CLIENT_CERT and TEMPORAL_CLIENT_KEY must be configured together.",
    );
  }
  if (hasTlsMaterial) {
    return {
      ...(clientCert !== null && clientKey !== null
        ? {
            clientCertPair: {
              crt: clientCert,
              key: clientKey,
            },
          }
        : {}),
      ...(serverRootCa !== null ? { serverRootCACertificate: serverRootCa } : {}),
      ...(serverNameOverride !== null ? { serverNameOverride } : {}),
    };
  }
  if (hasApiKey) {
    return true;
  }
  return tlsEnabled ?? false;
}

function readTemporalTlsEnabledKey(
  source: HostedRuntimeTemporalEnvSource,
): "HOSTED_TEMPORAL_TLS_ENABLED" | "TEMPORAL_TLS_ENABLED" {
  return source.HOSTED_TEMPORAL_TLS_ENABLED?.trim()
    ? "HOSTED_TEMPORAL_TLS_ENABLED"
    : "TEMPORAL_TLS_ENABLED";
}

function readOptionalBooleanEnv(
  source: HostedRuntimeTemporalEnvSource,
  ...keys: readonly string[]
): boolean | null {
  const entry = readOptionalEnvEntry(source, ...keys);
  if (entry === null) {
    return null;
  }
  const normalized = entry.value.toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  throw new TypeError(`${entry.key} must be true or false.`);
}

function readOptionalPemBuffer(input: {
  base64Keys: readonly string[];
  label: string;
  pemKeys: readonly string[];
  source: HostedRuntimeTemporalEnvSource;
}): Buffer | null {
  const pem = readOptionalEnv(input.source, ...input.pemKeys);
  const base64 = readOptionalEnv(input.source, ...input.base64Keys);
  if (pem !== null && base64 !== null) {
    throw new TypeError(
      `${input.label}_PEM and ${input.label}_BASE64 are mutually exclusive.`,
    );
  }
  if (pem !== null) {
    return Buffer.from(pem, "utf8");
  }
  if (base64 !== null) {
    return Buffer.from(base64, "base64");
  }
  return null;
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
