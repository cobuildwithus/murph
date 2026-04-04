export interface HostedExecutionDispatchEnvironment {
  dispatchTimeoutMs: number;
  dispatchUrl: string | null;
  signingSecret: string | null;
}

export interface HostedExecutionControlEnvironment {
  baseUrl: string | null;
  signingSecret: string | null;
}

export interface HostedExecutionWebControlPlaneEnvironment {
  deviceSyncRuntimeBaseUrl: string | null;
  internalToken: string | null;
  internalTokens: string[];
  schedulerToken: string | null;
  schedulerTokens: string[];
  shareBaseUrl: string | null;
  shareToken: string | null;
  shareTokens: string[];
  usageBaseUrl?: string | null;
}

export interface HostedExecutionWorkerEnvironment {
  allowedUserEnvKeys: string | null;
  bundleEncryptionKeyBase64: string;
  bundleEncryptionKeyId: string;
  bundleEncryptionKeyringJson: string | null;
  defaultAlarmDelayMs: number;
  dispatchSigningSecret: string;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedExecutionBaseUrlNormalizationOptions {
  allowHttpHosts?: readonly string[];
  allowHttpLocalhost?: boolean;
}

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
    signingSecret: normalizeHostedExecutionString(source.HOSTED_EXECUTION_SIGNING_SECRET),
  };
}

export function readHostedExecutionWebControlPlaneEnvironment(
  source: EnvSource = process.env,
  options?: HostedExecutionBaseUrlNormalizationOptions,
): HostedExecutionWebControlPlaneEnvironment {
  const sharedBaseUrl =
    normalizeHostedExecutionBaseUrl(source.HOSTED_WEB_BASE_URL, options)
    ?? readHostedExecutionVercelProductionBaseUrl(source, options);
  const internalTokens = readHostedExecutionTokenList(
    source,
    "HOSTED_EXECUTION_INTERNAL_TOKENS",
    "HOSTED_EXECUTION_INTERNAL_TOKEN",
  );
  const schedulerTokens = readHostedExecutionTokenList(
    source,
    "HOSTED_EXECUTION_SCHEDULER_TOKENS",
    "CRON_SECRET",
  );
  const shareTokens = readHostedExecutionTokenList(
    source,
    "HOSTED_SHARE_INTERNAL_TOKENS",
    "HOSTED_SHARE_INTERNAL_TOKEN",
  );

  return {
    deviceSyncRuntimeBaseUrl: normalizeHostedExecutionBaseUrl(
      source.HOSTED_DEVICE_SYNC_CONTROL_BASE_URL,
      options,
    ) ?? sharedBaseUrl,
    internalToken: internalTokens[0] ?? null,
    internalTokens,
    schedulerToken: schedulerTokens[0] ?? null,
    schedulerTokens,
    shareBaseUrl: normalizeHostedExecutionBaseUrl(
      source.HOSTED_SHARE_API_BASE_URL,
      options,
    ) ?? sharedBaseUrl,
    shareToken: shareTokens[0] ?? null,
    shareTokens,
    usageBaseUrl: normalizeHostedExecutionBaseUrl(source.HOSTED_AI_USAGE_BASE_URL, options) ?? sharedBaseUrl,
  };
}

export function readHostedExecutionVercelProductionBaseUrl(
  source: EnvSource = process.env,
  options?: HostedExecutionBaseUrlNormalizationOptions,
): string | null {
  const productionUrl = normalizeHostedExecutionString(source.VERCEL_PROJECT_PRODUCTION_URL);

  if (!productionUrl) {
    return null;
  }

  const normalizedInput = /^[a-z][a-z\d+.-]*:\/\//iu.test(productionUrl)
    ? productionUrl
    : `https://${productionUrl}`;

  return normalizeHostedExecutionBaseUrl(normalizedInput, options);
}

export function readHostedExecutionWorkerEnvironment(
  source: EnvSource = process.env,
): HostedExecutionWorkerEnvironment {
  return {
    allowedUserEnvKeys: normalizeHostedExecutionString(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS),
    bundleEncryptionKeyBase64: requireHostedExecutionString(
      source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY,
      "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
    ),
    bundleEncryptionKeyId: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID,
    ) ?? "v1",
    bundleEncryptionKeyringJson: normalizeHostedExecutionString(
      source.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON,
    ),
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
    runnerTimeoutMs: parsePositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS),
      60_000,
      "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
    ),
  };
}

export function normalizeHostedExecutionBaseUrl(
  value: string | null | undefined,
  options?: HostedExecutionBaseUrlNormalizationOptions,
): string | null {
  const normalized = normalizeHostedExecutionString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const allowHttpHosts = new Set((options?.allowHttpHosts ?? []).map((entry) => entry.toLowerCase()));
  const allowHttp =
    protocol === "http:"
    && (
      allowHttpHosts.has(hostname)
      || (options?.allowHttpLocalhost === true && isHostedExecutionLoopbackHost(hostname))
    );

  if (protocol !== "https:" && !allowHttp) {
    throw new TypeError(
      "Hosted execution base URLs must use HTTPS unless the host is explicitly allowlisted for HTTP.",
    );
  }

  if (url.username || url.password) {
    throw new TypeError("Hosted execution base URLs must not include embedded credentials.");
  }

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

function isHostedExecutionLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function readHostedExecutionTokenList(
  source: EnvSource,
  listKey: string,
  fallbackKey: string,
): string[] {
  const explicit = normalizeHostedExecutionString(source[listKey]);

  if (explicit) {
    return explicit
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  const fallback = normalizeHostedExecutionString(source[fallbackKey]);
  return fallback ? [fallback] : [];
}
