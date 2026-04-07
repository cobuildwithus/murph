import {
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export interface HostedExecutionWorkerEnvironment {
  allowedUserEnvKeys: string | null;
  automationRecipientKeyId: string;
  automationRecipientPrivateJwkJson: string;
  automationRecipientPrivateKeyringJson: string | null;
  automationRecipientPublicJwkJson: string;
  recoveryRecipientKeyId: string;
  recoveryRecipientPublicJwkJson: string;
  teeAutomationRecipientKeyId: string | null;
  teeAutomationRecipientPublicJwkJson: string | null;
  platformEnvelopeKeyBase64: string;
  platformEnvelopeKeyId: string;
  platformEnvelopeKeyringJson: string | null;
  defaultAlarmDelayMs: number;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionWorkerEnvironment(
  source: EnvSource = process.env,
): HostedExecutionWorkerEnvironment {
  return {
    allowedUserEnvKeys: normalizeHostedExecutionString(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS),
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
    defaultAlarmDelayMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS),
      15 * 60 * 1000,
      "HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS",
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
    runnerTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS),
      60_000,
      "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
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
