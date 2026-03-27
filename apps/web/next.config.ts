import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import {
  createTurbopackSourceResolutionOptions,
  createWorkspaceSourcePackageNames,
  installSourceExtensionAliases,
  resolveWorkspaceSourceEntries as resolveWorkspaceSourceEntriesFromMap,
} from "../../config/workspace-source-resolution";

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
const sourceImportRewriteLoaderPath = path.resolve(
  appDir,
  "../../config/turbopack-rewrite-relative-js-imports-loader.cjs",
);
const require = createRequire(import.meta.url);
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@healthybob/contracts": "../../packages/contracts/src/index.ts",
  "@healthybob/hosted-execution": "../../packages/hosted-execution/src/index.ts",
  "@healthybob/runtime-state": "../../packages/runtime-state/src/index.ts",
  "@healthybob/core": "../../packages/core/src/index.ts",
  "@healthybob/importers": "../../packages/importers/src/index.ts",
  "@healthybob/inboxd": "../../packages/inboxd/src/index.ts",
  "@healthybob/device-syncd": "../../packages/device-syncd/src/index.ts",
} as const;

export const WORKSPACE_SOURCE_PACKAGE_NAMES = createWorkspaceSourcePackageNames(
  WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
);

export function resolveWorkspaceSourceEntries(appDir: string): Record<string, string> {
  return resolveWorkspaceSourceEntriesFromMap(
    appDir,
    WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  );
}

export { installSourceExtensionAliases };

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

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(appDir, "../.."),
  transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
  turbopack: {
    root: path.resolve(appDir, "../.."),
    ...createTurbopackSourceResolutionOptions(sourceImportRewriteLoaderPath),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  headers: async () => [
    {
      source: HOSTED_WEB_HEADER_SOURCE,
      headers: buildHostedWebSecurityHeaders(process.env),
    },
  ],
  webpack: (config) => installOptionalModuleFallbacks(installSourceExtensionAliases(config)),
};

export default nextConfig;

function uniqueSources(sources: readonly (string | null | undefined)[]): string[] {
  return [...new Set(sources.filter((value): value is string => Boolean(value)))];
}
