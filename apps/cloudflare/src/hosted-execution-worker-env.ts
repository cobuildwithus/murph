import {
  assertHostedRuntimeProcessingTimeoutMs,
} from "@murphai/hosted-execution/contracts";
import {
  type HostedExecutionBaseUrlNormalizationOptions,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export interface HostedExecutionWorkerEnvironment {
  allowedRunnerSecretKeys: string | null;
  hostedCryptoAuthoritySignKeyVersion: string;
  hostedCryptoAuthoritySignPublicKeyPem: string;
  hostedCryptoAuthorityVerifyKeyringJson: string | null;
  hostedCryptoCloudflareAutomationKeyId: string;
  hostedCryptoCloudflareAutomationPrivateJwk: string;
  hostedCryptoCloudflareAutomationPrivateKeyringJson: string | null;
  hostedCryptoEnv: string;
  hostedWebAllowHttpHosts?: readonly string[];
  hostedWebBaseUrl: string;
  idleCheckpointDelayMs: number;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerCommitTimeoutMs: number;
  runnerReadyTimeoutMs: number;
  runnerIdleTtlMs: number;
  runnerLifecycleReevaluationMs: number;
  webControlTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;
const HOSTED_EXECUTION_LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);
const HOSTED_EXECUTION_RUNNER_COMMIT_RESPONSE_MARGIN_MS = 5_000;
const HOSTED_EXECUTION_MIN_PRODUCTION_IDLE_CHECKPOINT_DELAY_MS = 180_000;

export interface HostedExecutionWorkerEnvironmentOptions {
  allowHostedWebHttpHosts?: readonly string[];
}

interface HostedExecutionWorkerBaseUrlOptions extends HostedExecutionBaseUrlNormalizationOptions {
  rejectHttpLoopbackInProduction?: boolean;
}

export function readHostedExecutionWorkerEnvironment(
  source: EnvSource = process.env,
  options: HostedExecutionWorkerEnvironmentOptions = {},
): HostedExecutionWorkerEnvironment {
  const hostedCryptoEnv = requireHostedExecutionString(
    source.HOSTED_CRYPTO_ENV,
    "HOSTED_CRYPTO_ENV",
  );
  const isProduction = isHostedWorkerProductionEnvironment(source, hostedCryptoEnv);
  const runnerIdleTtlMs = parsePositiveInteger(
    normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS),
    300_000,
    "HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS",
  );
  const runnerLifecycleReevaluationMs = parsePositiveInteger(
    normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS,
    ),
    runnerIdleTtlMs,
    "HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS",
  );
  const idleCheckpointDelayMs = parsePositiveInteger(
    normalizeHostedExecutionString(source.HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS),
    180_000,
    "HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS",
  );
  if (
    isProduction
    && idleCheckpointDelayMs < HOSTED_EXECUTION_MIN_PRODUCTION_IDLE_CHECKPOINT_DELAY_MS
  ) {
    throw new TypeError(
      "HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS must be at least 180000 in production.",
    );
  }
  const runnerCommitTimeoutMs = parsePositiveInteger(
    normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS),
    45_000,
    "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  );
  const webControlTimeoutMs = parsePositiveInteger(
    normalizeHostedExecutionString(source.HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS),
    30_000,
    "HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS",
  );
  assertHostedRuntimeProcessingTimeoutMs(
    webControlTimeoutMs,
    "HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS",
  );
  if (
    runnerCommitTimeoutMs
    < webControlTimeoutMs + HOSTED_EXECUTION_RUNNER_COMMIT_RESPONSE_MARGIN_MS
  ) {
    throw new TypeError(
      "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS must be at least "
      + `${HOSTED_EXECUTION_RUNNER_COMMIT_RESPONSE_MARGIN_MS}ms greater than `
      + "HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS.",
    );
  }

  return {
    allowedRunnerSecretKeys: normalizeHostedExecutionString(source.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS),
    hostedCryptoAuthoritySignKeyVersion: requireHostedExecutionString(
      source.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
      "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
    ),
    hostedCryptoAuthoritySignPublicKeyPem: requireHostedExecutionString(
      source.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
      "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    ),
    hostedCryptoAuthorityVerifyKeyringJson: normalizeHostedExecutionString(
      source.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
    ),
    hostedCryptoCloudflareAutomationKeyId: requireHostedExecutionString(
      source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
    ),
    hostedCryptoCloudflareAutomationPrivateJwk: requireHostedExecutionString(
      source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
    ),
    hostedCryptoCloudflareAutomationPrivateKeyringJson: normalizeHostedExecutionString(
      source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
    ),
    hostedCryptoEnv,
    ...(options.allowHostedWebHttpHosts && options.allowHostedWebHttpHosts.length > 0
      ? { hostedWebAllowHttpHosts: options.allowHostedWebHttpHosts }
      : {}),
    hostedWebBaseUrl: requireHostedExecutionBaseUrl(
      source.HOSTED_WEB_BASE_URL,
      "HOSTED_WEB_BASE_URL",
      {
        allowHttpHosts: options.allowHostedWebHttpHosts,
        requireOriginOnly: true,
        rejectHttpLoopbackInProduction: isProduction,
      },
    ),
    idleCheckpointDelayMs,
    maxEventAttempts: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS),
      3,
      "HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS",
    ),
    retryDelayMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RETRY_DELAY_MS),
      30_000,
      "HOSTED_EXECUTION_RETRY_DELAY_MS",
    ),
    runnerCommitTimeoutMs,
    runnerReadyTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS),
      20_000,
      "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS",
    ),
    runnerIdleTtlMs,
    runnerLifecycleReevaluationMs,
    webControlTimeoutMs,
  };
}

function requireHostedExecutionString(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeHostedExecutionString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function requireHostedExecutionBaseUrl(
  value: string | null | undefined,
  label: string,
  options?: HostedExecutionWorkerBaseUrlOptions,
): string {
  const {
    rejectHttpLoopbackInProduction = false,
    ...normalizationOptions
  } = options ?? {};
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
    ...normalizationOptions,
  });

  if (!normalized) {
    throw new TypeError(`${label} must be a valid absolute URL.`);
  }

  if (rejectHttpLoopbackInProduction && isHostedExecutionHttpBaseUrl(normalized)) {
    if (isHostedExecutionHttpLoopbackBaseUrl(normalized)) {
      throw new TypeError(`${label} must not use HTTP loopback in production.`);
    }

    throw new TypeError(`${label} must not use HTTP in production.`);
  }

  return normalized;
}

function parsePositiveInteger(value: string | null, fallback: number, label: string): number {
  if (!value) {
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

function isHostedWorkerProductionEnvironment(source: EnvSource, hostedCryptoEnv: string): boolean {
  const normalizedHostedCryptoEnv = normalizeEnvironmentMarker(hostedCryptoEnv);
  return normalizeEnvironmentMarker(source.NODE_ENV) === "production"
    || normalizeEnvironmentMarker(source.VERCEL_ENV) === "production"
    || normalizedHostedCryptoEnv === "prod"
    || normalizedHostedCryptoEnv === "production";
}

function normalizeEnvironmentMarker(value: string | null | undefined): string {
  return normalizeHostedExecutionString(value)?.toLowerCase() ?? "";
}

function isHostedExecutionHttpLoopbackBaseUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol.toLowerCase() === "http:"
    && HOSTED_EXECUTION_LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

function isHostedExecutionHttpBaseUrl(value: string): boolean {
  return new URL(value).protocol.toLowerCase() === "http:";
}
