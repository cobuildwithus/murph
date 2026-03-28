export interface HostedExecutionDispatchEnvironment {
  dispatchTimeoutMs: number;
  dispatchUrl: string | null;
  signingSecret: string | null;
}

export interface HostedExecutionControlEnvironment {
  baseUrl: string | null;
  controlToken: string | null;
}

export interface HostedExecutionWebControlPlaneEnvironment {
  deviceSyncRuntimeBaseUrl: string | null;
  internalToken: string | null;
  schedulerToken: string | null;
  shareBaseUrl: string | null;
  shareToken: string | null;
}

export interface HostedExecutionWorkerEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundleEncryptionKeyBase64: string;
  bundleEncryptionKeyId: string;
  controlToken: string | null;
  defaultAlarmDelayMs: number;
  dispatchSigningSecret: string;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerControlToken: string | null;
  runnerTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionDispatchEnvironment(
  source: EnvSource = process.env,
): HostedExecutionDispatchEnvironment {
  const dispatchUrl = normalizeHostedExecutionBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL);
  const signingSecret = normalizeHostedExecutionString(source.HOSTED_EXECUTION_SIGNING_SECRET);
  const dispatchTimeout = normalizeHostedExecutionString(source.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS);

  return {
    dispatchTimeoutMs: parsePositiveInteger(
      dispatchTimeout,
      30_000,
      "HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS",
    ),
    dispatchUrl,
    signingSecret,
  };
}

export function readHostedExecutionControlEnvironment(
  source: EnvSource = process.env,
): HostedExecutionControlEnvironment {
  const dispatchUrl = normalizeHostedExecutionBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL);

  return {
    baseUrl: dispatchUrl,
    controlToken: normalizeHostedExecutionString(source.HOSTED_EXECUTION_CONTROL_TOKEN),
  };
}

export function readHostedExecutionWebControlPlaneEnvironment(
  source: EnvSource = process.env,
): HostedExecutionWebControlPlaneEnvironment {
  const sharedBaseUrl = normalizeHostedExecutionBaseUrl(source.HOSTED_ONBOARDING_PUBLIC_BASE_URL);

  return {
    deviceSyncRuntimeBaseUrl: normalizeHostedExecutionBaseUrl(
      source.HOSTED_DEVICE_SYNC_CONTROL_BASE_URL,
    ) ?? sharedBaseUrl,
    internalToken: normalizeHostedExecutionString(source.HOSTED_EXECUTION_INTERNAL_TOKEN),
    schedulerToken: normalizeHostedExecutionString(source.CRON_SECRET),
    shareBaseUrl: normalizeHostedExecutionBaseUrl(
      source.HOSTED_SHARE_BASE_URL ?? source.HOSTED_SHARE_API_BASE_URL,
    ) ?? sharedBaseUrl,
    shareToken: normalizeHostedExecutionString(source.HOSTED_SHARE_INTERNAL_TOKEN),
  };
}

export function readHostedExecutionWorkerEnvironment(
  source: EnvSource = process.env,
): HostedExecutionWorkerEnvironment {
  return {
    allowedUserEnvKeys: normalizeHostedExecutionString(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS),
    allowedUserEnvPrefixes: normalizeHostedExecutionString(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES),
    bundleEncryptionKeyBase64: requireHostedExecutionString(
      source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY,
      "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
    ),
    bundleEncryptionKeyId: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID,
    ) ?? "v1",
    controlToken: normalizeHostedExecutionString(source.HOSTED_EXECUTION_CONTROL_TOKEN),
    defaultAlarmDelayMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS),
      15 * 60 * 1000,
      "HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS",
    ),
    dispatchSigningSecret: requireHostedExecutionString(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_SIGNING_SECRET),
      "HOSTED_EXECUTION_SIGNING_SECRET",
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
    runnerControlToken: normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN),
    runnerTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS),
      60_000,
      "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
    ),
  };
}

export function normalizeHostedExecutionBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeHostedExecutionString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

export function normalizeHostedExecutionString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return parsed;
}
