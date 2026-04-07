type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedExecutionBaseUrlNormalizationOptions {
  allowHttpHosts?: readonly string[];
  allowHttpLocalhost?: boolean;
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

function isHostedExecutionLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
