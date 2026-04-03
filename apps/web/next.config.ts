import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import {
  HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES,
} from "../../config/workspace-source-resolution";
import {
  isHostedWebDevFileSystemCacheEnabled,
  resolveHostedWebDistDir,
} from "./next-artifacts";

interface StaticHeader {
  key: string;
  value: string;
}

const HOSTED_WEB_HEADER_SOURCE = "/(.*)";
const PRIVY_CUSTOM_DOMAIN_ENV_KEYS = [
  "PRIVY_CUSTOM_AUTH_DOMAIN",
  "NEXT_PUBLIC_PRIVY_CUSTOM_AUTH_DOMAIN",
  "PRIVY_AUTH_DOMAIN",
  "NEXT_PUBLIC_PRIVY_AUTH_DOMAIN",
] as const;
const PRIVY_BASE_DOMAIN_ENV_KEYS = [
  "PRIVY_BASE_DOMAIN",
  "NEXT_PUBLIC_PRIVY_BASE_DOMAIN",
] as const;
const HOSTED_PUBLIC_BASE_URL_ENV_KEYS = [
  "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "HOSTED_WEB_BASE_URL",
] as const;
const HOSTED_PUBLIC_VERCEL_URL_ENV_KEY = "VERCEL_PROJECT_PRODUCTION_URL";
const PRIVY_REQUIRED_CHILD_FRAME_SOURCES = [
  "https://auth.privy.io",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
] as const;
const PRIVY_REQUIRED_CONNECT_SOURCES = [
  "https://auth.privy.io",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://www.walletlink.org",
  "https://*.rpc.privy.systems",
  "https://explorer-api.walletconnect.com",
] as const;
const TURNSTILE_SOURCES = ["https://challenges.cloudflare.com"] as const;

const appDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const WORKSPACE_SOURCE_PACKAGE_NAMES = HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES;

export function resolvePrivyBaseDomainOrigin(value: string | null | undefined): string | null {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed || isLoopbackHostname(parsed.hostname)) {
    return null;
  }

  const normalizedHostname = parsed.hostname.startsWith("privy.")
    ? parsed.hostname
    : `privy.${parsed.hostname.replace(/^www\./u, "")}`;

  return buildOrigin(parsed.protocol, normalizedHostname, parsed.port);
}

export function resolveHostedPrivyOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configuredCustomOrigin = resolveConfiguredOrigin(readFirstConfiguredValue(environment, PRIVY_CUSTOM_DOMAIN_ENV_KEYS));

  if (configuredCustomOrigin) {
    return configuredCustomOrigin;
  }

  const configuredBaseDomainOrigin = resolvePrivyBaseDomainOrigin(
    readFirstConfiguredValue(environment, PRIVY_BASE_DOMAIN_ENV_KEYS),
  );

  if (configuredBaseDomainOrigin) {
    return configuredBaseDomainOrigin;
  }

  return resolvePrivyBaseDomainOrigin(readHostedPublicOriginFromEnvironment(environment));
}

export function buildHostedWebContentSecurityPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const isDevelopment = environment.NODE_ENV === "development";
  const isProduction = environment.NODE_ENV === "production";
  const privyBaseDomainOrigin = resolveHostedPrivyOrigin(environment);
  const privyFrameSources = uniqueSources([
    ...PRIVY_REQUIRED_CHILD_FRAME_SOURCES,
    privyBaseDomainOrigin,
  ]);
  const frameSources = uniqueSources([...privyFrameSources, ...TURNSTILE_SOURCES]);
  const connectSources = uniqueSources([
    "'self'",
    ...PRIVY_REQUIRED_CONNECT_SOURCES,
    privyBaseDomainOrigin,
    ...(isDevelopment ? ["ws:", "wss:"] : []),
  ]);
  const scriptSources = uniqueSources([
    "'self'",
    "'unsafe-inline'",
    ...TURNSTILE_SOURCES,
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ]);

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `child-src ${privyFrameSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function buildHostedWebSecurityHeaders(
  environment: NodeJS.ProcessEnv = process.env,
): StaticHeader[] {
  const headers: StaticHeader[] = [
    {
      key: "Content-Security-Policy",
      value: buildHostedWebContentSecurityPolicy(environment),
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), geolocation=(), microphone=()",
    },
  ];

  if (environment.NODE_ENV === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  }

  return headers;
}

function hasOptionalModule(specifier: string): boolean {
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

export function buildHostedWebTurbopackConfig(): NextConfig["turbopack"] {
  const resolveAlias: Record<string, string> = {};

  if (!hasOptionalModule("@farcaster/mini-app-solana")) {
    resolveAlias["@farcaster/mini-app-solana"] = "./src/lib/empty-module.ts";
  }

  return {
    root: path.resolve(appDir, "../.."),
    ...(Object.keys(resolveAlias).length > 0 ? { resolveAlias } : {}),
  };
}

export function buildHostedWebNextConfig(phase: string): NextConfig {
  return {
    distDir: resolveHostedWebDistDir(phase, process.env),
    experimental: {
      turbopackFileSystemCacheForDev: isHostedWebDevFileSystemCacheEnabled(process.env),
    },
    outputFileTracingRoot: path.resolve(appDir, "../.."),
    transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
    turbopack: buildHostedWebTurbopackConfig(),
    headers: async () => [
      {
        source: HOSTED_WEB_HEADER_SOURCE,
        headers: buildHostedWebSecurityHeaders(process.env),
      },
    ],
  };
}

export default function nextConfig(phase: string): NextConfig {
  return buildHostedWebNextConfig(phase);
}

function uniqueSources(sources: readonly (string | null | undefined)[]): string[] {
  return [...new Set(sources.filter((value): value is string => Boolean(value)))];
}

function readFirstConfiguredValue(
  environment: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = environment[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function resolveConfiguredOrigin(value: string | null | undefined): string | null {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed) {
    return null;
  }

  return buildOrigin(parsed.protocol, parsed.hostname, parsed.port);
}

function parseConfiguredOrigin(value: string | null | undefined): URL | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
  } catch {
    return null;
  }
}

function readHostedPublicOriginFromEnvironment(
  environment: NodeJS.ProcessEnv,
): string | null {
  const baseUrl = readHostedPublicBaseUrlFromEnvironment(environment);
  return baseUrl ? new URL(baseUrl).origin : null;
}

function readHostedPublicBaseUrlFromEnvironment(
  environment: NodeJS.ProcessEnv,
): string | null {
  const configuredBaseUrl = readFirstNormalizedBaseUrl(environment, HOSTED_PUBLIC_BASE_URL_ENV_KEYS);

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return normalizeConfiguredBaseUrl(environment[HOSTED_PUBLIC_VERCEL_URL_ENV_KEY], {
    allowHttpLoopback: true,
  });
}

function readFirstNormalizedBaseUrl(
  environment: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = environment[key];

    const normalized = normalizeConfiguredBaseUrl(value, {
      allowHttpLoopback: true,
    });

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeConfiguredBaseUrl(
  value: string | null | undefined,
  options?: {
    allowHttpLoopback?: boolean;
  },
): string | null {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed) {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const allowHttp = protocol === "http:" && options?.allowHttpLoopback === true && isLoopbackHostname(hostname);

  if (protocol !== "https:" && !allowHttp) {
    throw new TypeError(
      "Hosted public base URLs must use HTTPS unless the host is a loopback address.",
    );
  }

  if (parsed.username || parsed.password) {
    throw new TypeError("Hosted public base URLs must not include embedded credentials.");
  }

  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/u, "");
}

function buildOrigin(protocol: string, hostname: string, port: string): string {
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
