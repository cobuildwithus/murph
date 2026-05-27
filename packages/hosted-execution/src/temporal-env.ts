import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "./orchestration-control.ts";

export const HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS = "localhost:7233";
export const HOSTED_RUNTIME_TEMPORAL_DEFAULT_NAMESPACE = "default";

const DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 10_000;
const MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS = 10_000;
const MAX_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS = 30_000;
const MAX_HOSTED_RUNTIME_PROCESSING_START_TO_CLOSE_TIMEOUT_MS = 3_600_000;
export const HOSTED_TEMPORAL_ENSURE_PROCESSING_REPORTING_SLACK_MS = 5_000;

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
  ensureRuntimeProcessingStartToCloseTimeoutMs: number;
  readRuntimeDemandStartToCloseTimeoutMs: number;
}

export interface HostedRuntimeEnsureProcessingTimeouts {
  ensureRuntimeProcessingHttpTimeoutMs: number;
  ensureRuntimeProcessingStartToCloseTimeoutMs: number;
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
  const ensureRuntimeProcessingTimeouts =
    readHostedRuntimeEnsureProcessingTimeouts(source);

  return {
    ensureRuntimeProcessingStartToCloseTimeoutMs:
      ensureRuntimeProcessingTimeouts.ensureRuntimeProcessingStartToCloseTimeoutMs,
    readRuntimeDemandStartToCloseTimeoutMs: parseBoundedPositiveInteger(
      readOptionalEnv(source, "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS"),
      DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS",
    ),
  };
}

export function readHostedRuntimeEnsureProcessingTimeouts(
  source: HostedRuntimeTemporalEnvSource = process.env,
): HostedRuntimeEnsureProcessingTimeouts {
  const ensureRuntimeProcessingHttpTimeoutMs = parseBoundedPositiveInteger(
    readOptionalEnv(source, "HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS"),
    DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
    MAX_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
    "HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS",
  );
  const ensureRuntimeProcessingStartToCloseTimeoutMs =
    ensureRuntimeProcessingHttpTimeoutMs
    + HOSTED_TEMPORAL_ENSURE_PROCESSING_REPORTING_SLACK_MS;
  if (
    !Number.isSafeInteger(ensureRuntimeProcessingStartToCloseTimeoutMs)
    || ensureRuntimeProcessingStartToCloseTimeoutMs
      > MAX_HOSTED_RUNTIME_PROCESSING_START_TO_CLOSE_TIMEOUT_MS
  ) {
    throw new TypeError(
      "HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS plus Temporal reporting slack must be less than or equal to 3600000.",
    );
  }

  return {
    ensureRuntimeProcessingHttpTimeoutMs,
    ensureRuntimeProcessingStartToCloseTimeoutMs,
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
    hostedBase64Key: "HOSTED_TEMPORAL_CLIENT_CERT_BASE64",
    hostedPemKey: "HOSTED_TEMPORAL_CLIENT_CERT_PEM",
    label: "TEMPORAL_CLIENT_CERT",
    legacyBase64Key: "TEMPORAL_CLIENT_CERT_BASE64",
    legacyPemKey: "TEMPORAL_CLIENT_CERT_PEM",
    source,
  });
  const clientKey = readOptionalPemBuffer({
    hostedBase64Key: "HOSTED_TEMPORAL_CLIENT_KEY_BASE64",
    hostedPemKey: "HOSTED_TEMPORAL_CLIENT_KEY_PEM",
    label: "TEMPORAL_CLIENT_KEY",
    legacyBase64Key: "TEMPORAL_CLIENT_KEY_BASE64",
    legacyPemKey: "TEMPORAL_CLIENT_KEY_PEM",
    source,
  });
  const serverRootCa = readOptionalPemBuffer({
    hostedBase64Key: "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
    hostedPemKey: "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
    label: "TEMPORAL_SERVER_ROOT_CA_CERT",
    legacyBase64Key: "TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
    legacyPemKey: "TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
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
  hostedBase64Key: string;
  hostedPemKey: string;
  label: string;
  legacyBase64Key: string;
  legacyPemKey: string;
  source: HostedRuntimeTemporalEnvSource;
}): Buffer | null {
  const hostedPem = readOptionalEnv(input.source, input.hostedPemKey);
  const hostedBase64 = readOptionalEnv(input.source, input.hostedBase64Key);
  if (hostedPem !== null && hostedBase64 !== null) {
    throw new TypeError(
      `${input.label}_PEM and ${input.label}_BASE64 are mutually exclusive.`,
    );
  }
  if (hostedPem !== null) {
    return Buffer.from(hostedPem, "utf8");
  }
  if (hostedBase64 !== null) {
    return Buffer.from(hostedBase64, "base64");
  }

  const legacyPem = readOptionalEnv(input.source, input.legacyPemKey);
  const legacyBase64 = readOptionalEnv(input.source, input.legacyBase64Key);
  if (legacyPem !== null && legacyBase64 !== null) {
    throw new TypeError(
      `${input.label}_PEM and ${input.label}_BASE64 are mutually exclusive.`,
    );
  }
  if (legacyPem !== null) {
    return Buffer.from(legacyPem, "utf8");
  }
  if (legacyBase64 !== null) {
    return Buffer.from(legacyBase64, "base64");
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
