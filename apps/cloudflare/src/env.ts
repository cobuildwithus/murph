import { decodeBase64Key } from "./base64.js";

export interface HostedExecutionEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeyId: string;
  cloudflareBaseUrl: string | null;
  controlToken: string | null;
  defaultAlarmDelayMs: number;
  dispatchSigningSecret: string;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerBaseUrl: string | null;
  runnerControlToken: string | null;
  runnerTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionEnvironment(
  source: EnvSource = process.env,
): HostedExecutionEnvironment {
  const dispatchSigningSecret = requireString(
    source.HOSTED_EXECUTION_SIGNING_SECRET
      ?? source.HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET,
    "HOSTED_EXECUTION_SIGNING_SECRET",
  );
  const bundleEncryptionKey = requireString(
    source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY ?? source.HB_HOSTED_BUNDLE_KEY,
    "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  );

  return {
    allowedUserEnvKeys: normalizeString(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS),
    allowedUserEnvPrefixes: normalizeString(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES),
    bundleEncryptionKey: decodeBase64Key(bundleEncryptionKey),
    bundleEncryptionKeyId: normalizeString(source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID) ?? "v1",
    cloudflareBaseUrl: normalizeBaseUrl(source.HOSTED_EXECUTION_CLOUDFLARE_BASE_URL),
    controlToken: normalizeString(source.HOSTED_EXECUTION_CONTROL_TOKEN),
    defaultAlarmDelayMs: parsePositiveInteger(
      normalizeString(source.HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS),
      15 * 60 * 1000,
      "HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS",
    ),
    dispatchSigningSecret,
    maxEventAttempts: parsePositiveInteger(
      normalizeString(source.HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS),
      3,
      "HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS",
    ),
    retryDelayMs: parsePositiveInteger(
      normalizeString(source.HOSTED_EXECUTION_RETRY_DELAY_MS),
      30_000,
      "HOSTED_EXECUTION_RETRY_DELAY_MS",
    ),
    runnerBaseUrl: normalizeBaseUrl(source.HOSTED_EXECUTION_RUNNER_BASE_URL),
    runnerControlToken: normalizeString(source.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN),
    runnerTimeoutMs: parsePositiveInteger(
      normalizeString(source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS),
      60_000,
      "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
    ),
  };
}

function requireString(value: string | undefined, label: string): string {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
