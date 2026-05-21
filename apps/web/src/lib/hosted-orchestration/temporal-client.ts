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
  tls: HostedRuntimeTemporalTls;
}

export type HostedRuntimeTemporalTls =
  Exclude<ConnectionOptions["tls"], null | undefined>;

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
  return {
    address: readOptionalEnv(source, "HOSTED_TEMPORAL_ADDRESS", "TEMPORAL_ADDRESS"),
    apiKey,
    namespace:
      readOptionalEnv(source, "HOSTED_TEMPORAL_NAMESPACE", "TEMPORAL_NAMESPACE")
      ?? "default",
    taskQueue:
      readOptionalEnv(source, "HOSTED_TEMPORAL_TASK_QUEUE", "TEMPORAL_TASK_QUEUE")
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    tls: readTemporalTlsConfig(source, apiKey !== null),
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

function readTemporalTlsConfig(
  source: NodeJS.ProcessEnv,
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
      "HOSTED_TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
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

function readOptionalPemBuffer(input: {
  base64Keys: readonly string[];
  label: string;
  pemKeys: readonly string[];
  source: NodeJS.ProcessEnv;
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
