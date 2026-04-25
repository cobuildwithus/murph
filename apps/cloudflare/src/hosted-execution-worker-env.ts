import {
  type HostedExecutionBaseUrlNormalizationOptions,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export interface HostedExecutionWorkerEnvironment {
  allowedRunnerSecretKeys: string | null;
  automationRecipientKeyId: string;
  automationRecipientPrivateJwkJson: string;
  automationRecipientPrivateKeyringJson: string | null;
  automationRecipientPublicJwkJson: string;
  hostedWakeEncryptionKey: string;
  hostedWakeEncryptionKeyVersion: string;
  hostedWakeEncryptionKeyringJson: string | null;
  recoveryRecipientKeyId: string;
  recoveryRecipientPublicJwkJson: string;
  teeAutomationRecipientKeyId: string | null;
  teeAutomationRecipientPublicJwkJson: string | null;
  platformEnvelopeKeyBase64: string;
  platformEnvelopeKeyId: string;
  platformEnvelopeKeyringJson: string | null;
  hostedWebBaseUrl: string;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerReadyTimeoutMs: number;
  runnerTimeoutMs: number;
  webControlTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionWorkerEnvironment(
  source: EnvSource = process.env,
): HostedExecutionWorkerEnvironment {
  return {
    allowedRunnerSecretKeys: normalizeHostedExecutionString(source.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS),
    automationRecipientKeyId: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID,
    ) ?? "automation:v1",
    automationRecipientPrivateJwkJson: requireHostedExecutionString(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK),
      "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
    ),
    automationRecipientPrivateKeyringJson: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON,
    ),
    automationRecipientPublicJwkJson: requireHostedExecutionString(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK),
      "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
    ),
    hostedWakeEncryptionKey: requireHostedExecutionString(
      normalizeHostedExecutionString(source.HOSTED_WAKE_ENCRYPTION_KEY),
      "HOSTED_WAKE_ENCRYPTION_KEY",
    ),
    hostedWakeEncryptionKeyVersion: normalizeHostedExecutionString(
      source.HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
    ) ?? "v1",
    hostedWakeEncryptionKeyringJson: normalizeHostedExecutionString(
      source.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON,
    ),
    recoveryRecipientKeyId: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID,
    ) ?? "recovery:v1",
    recoveryRecipientPublicJwkJson: requireHostedExecutionString(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK),
      "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
    ),
    teeAutomationRecipientKeyId: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID,
    ),
    teeAutomationRecipientPublicJwkJson: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    ),
    platformEnvelopeKeyBase64: requireHostedExecutionString(
      source.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY,
      "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
    ),
    platformEnvelopeKeyId: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID,
    ) ?? "v1",
    platformEnvelopeKeyringJson: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON,
    ),
    hostedWebBaseUrl: requireHostedExecutionBaseUrl(
      source.HOSTED_WEB_BASE_URL,
      "HOSTED_WEB_BASE_URL",
      {
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

export function assertHostedExecutionOptionalJwkPairConfigured(input: {
  currentKeyId: string | null;
  currentPublicJwkJson: string | null;
  keyIdLabel: string;
  publicJwkLabel: string;
}): void {
  const hasKeyId = Boolean(input.currentKeyId);
  const hasPublicJwk = Boolean(input.currentPublicJwkJson);

  if (hasKeyId === hasPublicJwk) {
    return;
  }

  throw new TypeError(
    `${input.keyIdLabel} and ${input.publicJwkLabel} must either both be configured or both be omitted.`,
  );
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
