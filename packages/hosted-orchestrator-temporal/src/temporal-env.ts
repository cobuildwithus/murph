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
const DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 30_000;
const MAX_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 3_600_000;

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedRuntimeTemporalEnvironment {
  address: string;
  apiKey?: string;
  namespace: string;
  taskQueue: string;
  tls: HostedRuntimeTemporalTls;
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

export function readHostedRuntimeTemporalEnvironment(
  source: EnvSource = process.env,
): HostedRuntimeTemporalEnvironment {
  const apiKey =
    readOptionalEnv(source, "HOSTED_TEMPORAL_API_KEY", "TEMPORAL_API_KEY")
    ?? undefined;
  return {
    address:
      readOptionalEnv(source, "HOSTED_TEMPORAL_ADDRESS", "TEMPORAL_ADDRESS")
      ?? DEFAULT_TEMPORAL_ADDRESS,
    ...(apiKey ? { apiKey } : {}),
    namespace:
      readOptionalEnv(source, "HOSTED_TEMPORAL_NAMESPACE", "TEMPORAL_NAMESPACE")
      ?? DEFAULT_TEMPORAL_NAMESPACE,
    taskQueue:
      readOptionalEnv(source, "HOSTED_TEMPORAL_TASK_QUEUE", "TEMPORAL_TASK_QUEUE")
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    tls: readTemporalTlsConfig(source, apiKey !== undefined),
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
    runtimeCompletedFailureRecheckDelayMs: parseBoundedPositiveInteger(
      readOptionalTrimmedString(source.HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS),
      DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      MAX_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      "HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS",
    ),
  };
}

function readOptionalTrimmedString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readOptionalEnv(
  source: EnvSource,
  ...keys: readonly string[]
): string | null {
  const entry = readOptionalEnvEntry(source, ...keys);
  return entry?.value ?? null;
}

function readOptionalEnvEntry(
  source: EnvSource,
  ...keys: readonly string[]
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = readOptionalTrimmedString(source[key]);
    if (value !== null) {
      return { key, value };
    }
  }
  return null;
}

function readTemporalTlsConfig(
  source: EnvSource,
  hasApiKey: boolean,
): HostedRuntimeTemporalTls {
  const tlsEnabled = readOptionalBooleanEnv(
    source,
    "HOSTED_TEMPORAL_TLS_ENABLED",
    "TEMPORAL_TLS_ENABLED",
  );
  const clientCert = readOptionalPemBuffer(
    source,
    [
      "HOSTED_TEMPORAL_CLIENT_CERT_PEM",
      "TEMPORAL_CLIENT_CERT_PEM",
    ],
    [
      "HOSTED_TEMPORAL_CLIENT_CERT_BASE64",
      "TEMPORAL_CLIENT_CERT_BASE64",
    ],
    "TEMPORAL_CLIENT_CERT",
  );
  const clientKey = readOptionalPemBuffer(
    source,
    [
      "HOSTED_TEMPORAL_CLIENT_KEY_PEM",
      "TEMPORAL_CLIENT_KEY_PEM",
    ],
    [
      "HOSTED_TEMPORAL_CLIENT_KEY_BASE64",
      "TEMPORAL_CLIENT_KEY_BASE64",
    ],
    "TEMPORAL_CLIENT_KEY",
  );
  const serverRootCa = readOptionalPemBuffer(
    source,
    [
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
      "TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
    ],
    [
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
      "TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
    ],
    "TEMPORAL_SERVER_ROOT_CA_CERT",
  );
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

  if (tlsEnabled === false && (hasTlsMaterial || hasApiKey)) {
    throw new TypeError(
      "TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
    );
  }
  if ((clientCert === null) !== (clientKey === null)) {
    throw new TypeError(
      "TEMPORAL_CLIENT_CERT and TEMPORAL_CLIENT_KEY must be configured together.",
    );
  }
  if (hasTlsMaterial) {
    const tls: HostedRuntimeTemporalTlsConfig = {};
    if (clientCert !== null && clientKey !== null) {
      tls.clientCertPair = {
        crt: clientCert,
        key: clientKey,
      };
    }
    if (serverRootCa !== null) {
      tls.serverRootCACertificate = serverRootCa;
    }
    if (serverNameOverride !== null) {
      tls.serverNameOverride = serverNameOverride;
    }
    return tls;
  }
  if (hasApiKey) {
    return true;
  }
  return tlsEnabled ?? false;
}

function readOptionalBooleanEnv(
  source: EnvSource,
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

function readOptionalPemBuffer(
  source: EnvSource,
  pemKeys: readonly string[],
  base64Keys: readonly string[],
  label: string,
): Buffer | null {
  const pem = readOptionalEnv(source, ...pemKeys);
  const base64 = readOptionalEnv(source, ...base64Keys);
  if (pem !== null && base64 !== null) {
    throw new TypeError(`${label}_PEM and ${label}_BASE64 are mutually exclusive.`);
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
