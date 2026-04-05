import {
  DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
} from "./callback-hosts.ts";
import {
  requireHostedExecutionVercelOidcValidationEnvironment,
  type HostedExecutionVercelOidcValidationEnvironment,
} from "./vercel-oidc.ts";
export interface HostedExecutionDispatchEnvironment {
  dispatchTimeoutMs: number;
  dispatchUrl: string | null;
}

export interface HostedExecutionControlEnvironment {
  baseUrl: string | null;
}

export interface HostedExecutionWebControlPlaneEnvironment {
  deviceSyncRuntimeBaseUrl: string;
  signingSecret: string | null;
  usageBaseUrl: string;
}

export interface HostedExecutionWorkerEnvironment {
  allowedUserEnvKeys: string | null;
  automationRecipientKeyId: string;
  automationRecipientPrivateJwkJson: string;
  automationRecipientPrivateKeyringJson: string | null;
  automationRecipientPublicJwkJson: string;
  platformEnvelopeKeyBase64: string;
  platformEnvelopeKeyId: string;
  platformEnvelopeKeyringJson: string | null;
  defaultAlarmDelayMs: number;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerTimeoutMs: number;
  vercelOidcValidation: HostedExecutionVercelOidcValidationEnvironment;
  webInternalSigningSecret: string;
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
  const dispatchTimeout = normalizeHostedExecutionString(source.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS);

  return {
    dispatchTimeoutMs: parsePositiveInteger(
      dispatchTimeout,
      30_000,
      "HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS",
    ),
    dispatchUrl,
  };
}

export function readHostedExecutionControlEnvironment(
  source: EnvSource = process.env,
): HostedExecutionControlEnvironment {
  return {
    baseUrl: normalizeHostedExecutionBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL),
  };
}

export function readHostedExecutionWebControlPlaneEnvironment(
  source: EnvSource = process.env,
  _options?: HostedExecutionBaseUrlNormalizationOptions,
): HostedExecutionWebControlPlaneEnvironment {
  return {
    deviceSyncRuntimeBaseUrl: DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
    signingSecret: normalizeHostedExecutionString(source.HOSTED_WEB_INTERNAL_SIGNING_SECRET),
    usageBaseUrl: DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
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
    vercelOidcValidation: requireHostedExecutionVercelOidcValidationEnvironment(source),
    webInternalSigningSecret: requireHostedExecutionString(
      normalizeHostedExecutionString(source.HOSTED_WEB_INTERNAL_SIGNING_SECRET),
      "HOSTED_WEB_INTERNAL_SIGNING_SECRET",
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
