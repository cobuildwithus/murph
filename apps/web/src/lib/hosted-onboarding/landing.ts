import { isLoopbackHostname as isRuntimeLoopbackHostname } from "@murphai/runtime-state";

import { normalizePhoneNumber } from "./phone";
import { resolveHostedPublicBaseUrl as resolveHostedWebPublicBaseUrl } from "../hosted-web/public-url";

const HOSTED_PRIVY_DEFAULT_AUTH_ORIGIN = "https://auth.privy.io";
const HOSTED_PRIVY_TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const HOSTED_PUBLIC_PRIVY_SUBDOMAIN_PREFIXES = ["app", "www", "web"] as const;

export interface HostedSignupPhoneDetails {
  displayValue: string;
  smsValue: string;
}

export function resolveHostedSignupPhoneNumber(
  source: NodeJS.ProcessEnv = process.env,
): HostedSignupPhoneDetails | null {
  return parseHostedSignupPhoneNumber(source.HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER);
}

export function resolveHostedInstallScriptUrl(source: NodeJS.ProcessEnv = process.env): string | null {
  const baseUrl = resolveHostedPublicBaseUrlObject(source);

  if (!baseUrl) {
    return null;
  }

  return new URL("/install.sh", baseUrl).toString();
}

export function parseHostedSignupPhoneNumber(value: string | null | undefined): HostedSignupPhoneDetails | null {
  const displayValue = value?.trim() ?? "";

  if (!displayValue) {
    return null;
  }

  const smsValue = normalizePhoneNumber(displayValue);

  if (!smsValue) {
    return null;
  }

  return {
    displayValue,
    smsValue,
  };
}

export function resolveHostedPrivyClientAppId(source: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeEnvValue(source.NEXT_PUBLIC_PRIVY_APP_ID);
}

export function requireHostedPrivyClientAppId(source: NodeJS.ProcessEnv = process.env): string {
  const value = resolveHostedPrivyClientAppId(source);

  if (!value) {
    throw new TypeError(
      "NEXT_PUBLIC_PRIVY_APP_ID must be configured for hosted Privy signup.",
    );
  }

  return value;
}

export function resolveHostedPrivyClientId(source: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeEnvValue(source.NEXT_PUBLIC_PRIVY_CLIENT_ID);
}

export function hasHostedPrivyClientConfig(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveHostedPrivyClientAppId(source));
}

export function resolveHostedPrivyResourceHintOrigins(
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  return uniqueStrings([
    HOSTED_PRIVY_DEFAULT_AUTH_ORIGIN,
    ...resolveHostedPrivyConfiguredAuthOrigins(source),
    HOSTED_PRIVY_TURNSTILE_ORIGIN,
  ]);
}

function resolveHostedPrivyConfiguredAuthOrigins(source: NodeJS.ProcessEnv): string[] {
  const configuredOrigin = resolveConfiguredOrigin(normalizeEnvValue(source.PRIVY_CUSTOM_AUTH_DOMAIN));

  if (configuredOrigin) {
    return [configuredOrigin];
  }

  const baseDomainOrigin = resolveHostedPrivyBaseDomainOrigin(normalizeEnvValue(source.PRIVY_BASE_DOMAIN));

  if (baseDomainOrigin) {
    return [baseDomainOrigin];
  }

  return resolveHostedPrivyFallbackOrigins(resolveHostedWebPublicBaseUrl(source));
}

function resolveHostedPrivyBaseDomainOrigin(value: string | null): string | null {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed || isLoopbackHostname(parsed.hostname)) {
    return null;
  }

  const normalizedHostname = parsed.hostname.startsWith("privy.")
    ? parsed.hostname
    : `privy.${parsed.hostname.replace(/^www\./u, "")}`;

  return buildOrigin(parsed.protocol, normalizedHostname, parsed.port);
}

function resolveHostedPrivyFallbackOrigins(value: string | null): string[] {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed || isLoopbackHostname(parsed.hostname)) {
    return [];
  }

  const hostnames = new Set<string>([normalizeHostedPrivyHostnameCandidate(parsed.hostname)]);
  const strippedHostname = stripHostedPublicSubdomainPrefix(parsed.hostname);

  if (strippedHostname) {
    hostnames.add(normalizeHostedPrivyHostnameCandidate(strippedHostname));
  }

  return [...hostnames].map((hostname) => buildOrigin(parsed.protocol, hostname, parsed.port));
}

function resolveConfiguredOrigin(value: string | null): string | null {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed || isLoopbackHostname(parsed.hostname)) {
    return null;
  }

  return parsed.origin;
}

function parseConfiguredOrigin(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(candidate);

    if (parsed.protocol !== "https:") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function buildOrigin(protocol: string, hostname: string, port: string): string {
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function stripHostedPublicSubdomainPrefix(hostname: string): string | null {
  const labels = hostname.toLowerCase().split(".");

  if (labels.length < 3) {
    return null;
  }

  const [firstLabel, ...remainingLabels] = labels;

  if (!HOSTED_PUBLIC_PRIVY_SUBDOMAIN_PREFIXES.includes(firstLabel as typeof HOSTED_PUBLIC_PRIVY_SUBDOMAIN_PREFIXES[number])) {
    return null;
  }

  return remainingLabels.join(".");
}

function normalizeHostedPrivyHostnameCandidate(hostname: string): string {
  const normalizedHostname = hostname.toLowerCase();

  if (normalizedHostname.startsWith("privy.")) {
    return normalizedHostname;
  }

  return `privy.${normalizedHostname.replace(/^www\./u, "")}`;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/u, "");

  return normalizedHostname.endsWith(".localhost") || isRuntimeLoopbackHostname(normalizedHostname);
}

function uniqueStrings(values: ReadonlyArray<string | null>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    if (value) {
      unique.add(value);
    }
  }

  return Array.from(unique);
}

function resolveHostedPublicBaseUrlObject(source: NodeJS.ProcessEnv): URL | null {
  const value = resolveHostedWebPublicBaseUrl(source);

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeEnvValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
