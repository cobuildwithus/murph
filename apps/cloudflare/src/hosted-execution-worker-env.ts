import {
  type HostedExecutionBaseUrlNormalizationOptions,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export interface HostedExecutionWorkerEnvironment {
  allowedRunnerSecretKeys: string | null;
  hostedCryptoAuthoritySignKeyVersion: string;
  hostedCryptoAuthoritySignPublicKeyPem: string;
  hostedCryptoCloudflareAutomationKeyId: string;
  hostedCryptoCloudflareAutomationPrivateJwk: string;
  hostedCryptoEnv: string;
  hostedWebBaseUrl: string;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerReadyTimeoutMs: number;
  runnerTimeoutMs: number;
  webControlTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedExecutionWorkerEnvironmentOptions {
  allowHostedWebHttpHosts?: readonly string[];
}

export function readHostedExecutionWorkerEnvironment(
  source: EnvSource = process.env,
  options: HostedExecutionWorkerEnvironmentOptions = {},
): HostedExecutionWorkerEnvironment {
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
    hostedCryptoCloudflareAutomationKeyId: requireHostedExecutionString(
      source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
    ),
    hostedCryptoCloudflareAutomationPrivateJwk: requireHostedExecutionString(
      source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
    ),
    hostedCryptoEnv: requireHostedExecutionString(
      source.HOSTED_CRYPTO_ENV,
      "HOSTED_CRYPTO_ENV",
    ),
    hostedWebBaseUrl: requireHostedExecutionBaseUrl(
      source.HOSTED_WEB_BASE_URL,
      "HOSTED_WEB_BASE_URL",
      {
        allowHttpHosts: options.allowHostedWebHttpHosts,
        requireOriginOnly: true,
      },
    ),
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
    runnerReadyTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS),
      20_000,
      "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS",
    ),
    runnerTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS),
      600_000,
      "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
    ),
    webControlTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS),
      30_000,
      "HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS",
    ),
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
  options?: HostedExecutionBaseUrlNormalizationOptions,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
    ...options,
  });

  if (!normalized) {
    throw new TypeError(`${label} must be a valid absolute URL.`);
  }

  return normalized;
}

function parsePositiveInteger(value: string | null, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
}
