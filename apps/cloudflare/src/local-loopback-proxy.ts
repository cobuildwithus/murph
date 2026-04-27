import type { StringEnvSource } from "./string-env.ts";

const LOCAL_INTERNAL_PROXY_BRIDGE_HOSTS = new Set([
  "host.containers.internal",
  "host.docker.internal",
]);

export function isLocalLoopbackProxyProtocol(value: string): boolean {
  return value === "http:" || value === "https:";
}

export function assertHostedLocalInternalProxyEnvironment(
  source: StringEnvSource,
): void {
  const localInternalProxyBaseUrl = normalizeOptionalString(
    source.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL,
  );
  const allowLocalInternalProxy = normalizeOptionalString(
    source.ALLOW_LOCAL_INTERNAL_PROXY,
  );

  if (!localInternalProxyBaseUrl && allowLocalInternalProxy !== "true") {
    return;
  }

  if (source.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT !== "development") {
    throw new TypeError(
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL and ALLOW_LOCAL_INTERNAL_PROXY are only supported when HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development.",
    );
  }

  if (!localInternalProxyBaseUrl) {
    return;
  }

  if (allowLocalInternalProxy !== "true") {
    throw new TypeError(
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL requires ALLOW_LOCAL_INTERNAL_PROXY=true.",
    );
  }

  assertHostedLocalInternalProxyBaseUrl(localInternalProxyBaseUrl);
}

export function assertHostedLocalInternalProxyBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(
      `HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL must be a valid absolute URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isLocalLoopbackProxyProtocol(url.protocol)) {
    throw new TypeError("HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL must use http or https.");
  }

  if (!isLocalInternalProxyHostname(url.hostname)) {
    throw new TypeError(
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL must use a loopback, private-network, or local bridge hostname.",
    );
  }

  return url;
}

export function isLocalInternalProxyHostname(value: string): boolean {
  const hostname = normalizeLocalInternalProxyHostname(value);

  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || isPrivateOrLoopbackIpv6(hostname)
    || LOCAL_INTERNAL_PROXY_BRIDGE_HOSTS.has(hostname)
    || isPrivateOrLoopbackIpv4(hostname)
    || isIpv4MappedPrivateOrLoopback(hostname);
}

export function normalizeLocalInternalProxyHostname(value: string): string {
  const normalized = value.trim().toLowerCase();
  const unbracketed = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
  return unbracketed.endsWith(".") ? unbracketed.slice(0, -1) : unbracketed;
}

function isPrivateOrLoopbackIpv4(value: string): boolean {
  const parts = parseIpv4Parts(value);
  if (!parts) {
    return false;
  }

  const [first, second] = parts;
  return first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168;
}

function isPrivateOrLoopbackIpv6(value: string): boolean {
  return value.includes(":")
    && (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:"));
}

function isIpv4MappedPrivateOrLoopback(value: string): boolean {
  const match = /^::ffff:(?<ipv4>\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value);
  return match?.groups?.ipv4 ? isPrivateOrLoopbackIpv4(match.groups.ipv4) : false;
}

function parseIpv4Parts(value: string): [number, number, number, number] | null {
  const rawParts = value.split(".");
  if (rawParts.length !== 4) {
    return null;
  }

  const parts = rawParts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return Number.NaN;
    }
    return Number(part);
  });

  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts as [number, number, number, number];
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
