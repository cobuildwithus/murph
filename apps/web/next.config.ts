import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import {
  HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES,
} from "../../config/workspace-source-resolution";
import { resolveHostedWebDistDir } from "./next-artifacts";

interface StaticHeader {
  key: string;
  value: string;
}

const HOSTED_WEB_HEADER_SOURCE = "/(.*)";
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
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
    const host = parsed.host.trim();

    if (!host) {
      return null;
    }

    return `https://${host.startsWith("privy.") ? host : `privy.${host}`}`;
  } catch {
    return null;
  }
}

export function buildHostedWebContentSecurityPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const isDevelopment = environment.NODE_ENV === "development";
  const isProduction = environment.NODE_ENV === "production";
  const privyBaseDomainOrigin = resolvePrivyBaseDomainOrigin(environment.PRIVY_BASE_DOMAIN);
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

function installOptionalModuleFallbacks(config: Parameters<NonNullable<NextConfig["webpack"]>>[0]) {
  config.resolve ??= {};
  config.resolve.alias ??= {};

  try {
    require.resolve("@farcaster/mini-app-solana");
  } catch {
    config.resolve.alias["@farcaster/mini-app-solana"] = false;
  }

  return config;
}

export function buildHostedWebTurbopackConfig(): NextConfig["turbopack"] {
  return {
    root: path.resolve(appDir, "../.."),
  };
}

export function buildHostedWebNextConfig(phase: string): NextConfig {
  return {
    distDir: resolveHostedWebDistDir(phase, process.env),
    outputFileTracingRoot: path.resolve(appDir, "../.."),
    transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
    turbopack: buildHostedWebTurbopackConfig(),
    typescript: {
      ignoreBuildErrors: true,
    },
    headers: async () => [
      {
        source: HOSTED_WEB_HEADER_SOURCE,
        headers: buildHostedWebSecurityHeaders(process.env),
      },
    ],
    webpack: (config) => installOptionalModuleFallbacks(config),
  };
}

export default function nextConfig(phase: string): NextConfig {
  return buildHostedWebNextConfig(phase);
}

function uniqueSources(sources: readonly (string | null | undefined)[]): string[] {
  return [...new Set(sources.filter((value): value is string => Boolean(value)))];
}
