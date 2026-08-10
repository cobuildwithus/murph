type EnvSource = Readonly<Record<string, string | undefined>>;
const HOSTED_EXECUTION_ABSOLUTE_URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//iu;
const HOSTED_EXECUTION_LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

export const HOSTED_RUNTIME_PROCESS_ENV = "MURPH_HOSTED_RUNTIME_PROCESS";
export const HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV =
  "MURPH_HOSTED_CODEX_APP_SERVER_COMMAND";
export const HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV =
  "MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON";
export const MURPH_ANDROID_APP_ENABLED_ENV = "MURPH_ANDROID_APP_ENABLED";

export interface HostedExecutionBaseUrlNormalizationOptions {
  allowHttpHosts?: readonly string[];
  allowHttpLocalhost?: boolean;
  requireOriginOnly?: boolean;
}

export function isHostedRuntimeProcessEnv(env: EnvSource): boolean {
  return env[HOSTED_RUNTIME_PROCESS_ENV]?.trim() === "1";
}

export function isMurphAndroidAppEnabled(env: EnvSource): boolean {
  return env[MURPH_ANDROID_APP_ENABLED_ENV] === "1";
}

export function normalizeHostedExecutionBaseUrl(
  value: string | null | undefined,
  options?: HostedExecutionBaseUrlNormalizationOptions,
): string | null {
  const normalized = normalizeHostedExecutionString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(
    HOSTED_EXECUTION_ABSOLUTE_URL_SCHEME_PATTERN.test(normalized)
      ? normalized
      : `https://${normalized}`,
  );
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

  if (options?.requireOriginOnly === true && url.pathname !== "" && url.pathname !== "/") {
    throw new TypeError(
      "Hosted execution origin base URLs must not include a path; configure only the origin.",
    );
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

function isHostedExecutionLoopbackHost(hostname: string): boolean {
  return HOSTED_EXECUTION_LOOPBACK_HOSTS.has(hostname);
}
