import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import {
  HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES,
} from "../../config/workspace-source-resolution";
import {
  KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES,
  KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES,
} from "./kernel-live-view-origin";
import {
  isHostedWebDevFileSystemCacheEnabled,
  resolveHostedWebDistDir,
} from "./next-artifacts";

interface StaticHeader {
  key: string;
  value: string;
}

const HOSTED_WEB_HEADER_SOURCE = "/(.*)";
const MURPH_SAFE_HEADER_SOURCE = "/search/:path*";
const PRIVY_CUSTOM_DOMAIN_ENV_KEYS = ["PRIVY_CUSTOM_AUTH_DOMAIN"] as const;
const PRIVY_BASE_DOMAIN_ENV_KEYS = ["PRIVY_BASE_DOMAIN"] as const;
const HOSTED_PUBLIC_BASE_URL_ENV_KEYS = [
  "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
  "HOSTED_WEB_BASE_URL",
] as const;
const HOSTED_PUBLIC_VERCEL_URL_ENV_KEY = "VERCEL_PROJECT_PRODUCTION_URL";
const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEY = "DEVICE_SYNC_PUBLIC_BASE_URL";
const MURPH_TELEGRAM_USERNAME_OVERRIDE_ENV_KEY = "MURPH_TELEGRAM_USERNAME_OVERRIDE";
const HOSTED_PUBLIC_SUBDOMAIN_PREFIXES = ["app", "www", "web"] as const;
const WORKFLOW_LOCAL_DATA_DIR_ENV_KEY = "WORKFLOW_LOCAL_DATA_DIR";
const WORKFLOW_TARGET_WORLD_ENV_KEY = "WORKFLOW_TARGET_WORLD";
const WORKFLOW_NEXT_DEFAULT_LOCAL_DATA_DIR = ".next/workflow-data";
const WORKFLOW_LOCAL_TARGET_WORLD = "local";
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
const PRIVY_REQUIRED_SCRIPT_SOURCES = [
  "https://auth.privy.io",
] as const;
const TELEGRAM_REQUIRED_SCRIPT_SOURCES = [
  "https://telegram.org",
] as const;
const TELEGRAM_REQUIRED_FRAME_SOURCES = [
  "https://oauth.telegram.org",
] as const;
const TURNSTILE_SOURCES = ["https://challenges.cloudflare.com"] as const;
// Brand assets that OG and share-card route handlers read from disk at render
// time through app/font-files.ts. They must be traced into each of those
// serverless functions or every non-prerendered render 500s with ENOENT.
// scripts/check-og-asset-traces.ts fails the build when a trace goes missing.
const OG_SHARE_ASSET_TRACE_INCLUDES = [
  "app/fonts/*.ttf",
  "public/logo.svg",
];
// The footer availability indicator reads the incident.io status-page summary
// from the browser, so the status-page origin must be reachable client-side.
const STATUS_PAGE_CONNECT_SOURCES = ["https://status.withmurph.ai"] as const;

const appDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const WORKSPACE_SOURCE_PACKAGE_NAMES = HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES;
export const HOSTED_WEB_NEXT_TSCONFIG_PATH = "./tsconfig.next.json";
export const HOSTED_WEB_PRODUCTION_BUILD_CPUS = 2;
export const HOSTED_WEB_WORKFLOW_OPTIONS = {
  workflows: {
    lazyDiscovery: true,
  },
} satisfies Parameters<typeof withWorkflow>[1];

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

export function resolveHostedPrivyOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configuredCustomOrigin = resolveConfiguredOrigin(readFirstConfiguredValue(environment, PRIVY_CUSTOM_DOMAIN_ENV_KEYS));

  if (configuredCustomOrigin) {
    return [configuredCustomOrigin];
  }

  const configuredBaseDomainOrigin = resolvePrivyBaseDomainOrigin(
    readFirstConfiguredValue(environment, PRIVY_BASE_DOMAIN_ENV_KEYS),
  );

  if (configuredBaseDomainOrigin) {
    return [configuredBaseDomainOrigin];
  }

  return resolveHostedPrivyFallbackOrigins(readHostedPublicOriginFromEnvironment(environment));
}

export function buildHostedWebContentSecurityPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const isDevelopment = environment.NODE_ENV === "development";
  const isProduction = environment.NODE_ENV === "production";
  const privyOrigins = resolveHostedPrivyOrigins(environment);
  const privyFrameSources = uniqueSources([
    ...PRIVY_REQUIRED_CHILD_FRAME_SOURCES,
    ...privyOrigins,
  ]);
  const frameSources = uniqueSources([
    ...privyFrameSources,
    ...TELEGRAM_REQUIRED_FRAME_SOURCES,
    ...TURNSTILE_SOURCES,
    ...KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES,
  ]);
  const connectSources = uniqueSources([
    "'self'",
    ...PRIVY_REQUIRED_CONNECT_SOURCES,
    ...privyOrigins,
    ...KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES,
    ...STATUS_PAGE_CONNECT_SOURCES,
    ...(isDevelopment ? ["ws:", "wss:"] : []),
  ]);
  const scriptSources = uniqueSources([
    "'self'",
    "'unsafe-inline'",
    ...PRIVY_REQUIRED_SCRIPT_SOURCES,
    ...TELEGRAM_REQUIRED_SCRIPT_SOURCES,
    ...TURNSTILE_SOURCES,
    ...(isDevelopment ? ["'unsafe-eval'", "https://ui.sh"] : []),
  ]);

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
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
      value: "strict-origin",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin-allow-popups",
    },
    {
      key: "Origin-Agent-Cluster",
      value: "?1",
    },
    {
      key: "X-DNS-Prefetch-Control",
      value: "off",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Permissions-Policy",
      // The Environment recorder is same-origin and still requires the
      // browser's explicit per-site permission. Embedded origins stay blocked.
      value: "camera=(), geolocation=(), microphone=(self)",
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

export function configureHostedWebWorkflowLocalDataDir(
  phase: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.VERCEL_DEPLOYMENT_ID) {
    return;
  }

  const targetWorld = environment[WORKFLOW_TARGET_WORLD_ENV_KEY]?.trim();

  if (targetWorld && targetWorld !== WORKFLOW_LOCAL_TARGET_WORLD) {
    return;
  }

  const configuredDataDir = environment[WORKFLOW_LOCAL_DATA_DIR_ENV_KEY]?.trim();

  if (configuredDataDir && configuredDataDir !== WORKFLOW_NEXT_DEFAULT_LOCAL_DATA_DIR) {
    return;
  }

  environment[WORKFLOW_LOCAL_DATA_DIR_ENV_KEY] = path.join(
    resolveHostedWebDistDir(phase, environment),
    "workflow-data",
  );
}

export function buildHostedWebNextConfig(phase: string): NextConfig {
  return {
    // The repository already owns agent guidance at its root. Avoid generating
    // nested AGENTS.md and CLAUDE.md files whenever an agent starts Next dev.
    agentRules: false,
    allowedDevOrigins: ["local.withmurph.ai"],
    distDir: resolveHostedWebDistDir(phase, process.env),
    env: buildHostedWebClientEnv(process.env),
    experimental: {
      cpus: HOSTED_WEB_PRODUCTION_BUILD_CPUS,
      // Next 16.3 enables persistent production-build caching by default.
      // Keep builds independent until that new state owner is evaluated
      // separately.
      turbopackFileSystemCacheForBuild: false,
      turbopackFileSystemCacheForDev: isHostedWebDevFileSystemCacheEnabled(process.env),
      // Source-map emission is the largest proven build-memory cost.
      turbopackSourceMaps: false,
    },
    outputFileTracingIncludes: {
      "/experiments": [
        "../../packages/health-commons/generated/web/browse/experiments.json",
      ],
      "/experiments/[experimentId]": [
        "../../packages/health-commons/generated/web/routes/index.json",
        "../../packages/health-commons/generated/web/shell/experiments/**/*.json",
        "../../packages/health-commons/generated/web/tabs/experiments/**/*.json",
      ],
      "/experiments/[experimentId]/research": [
        "../../packages/health-commons/generated/web/routes/index.json",
        "../../packages/health-commons/generated/web/shell/experiments/**/*.json",
        "../../packages/health-commons/generated/web/tabs/experiments/**/*.json",
      ],
      "/experiments/[experimentId]/results": [
        "../../packages/health-commons/generated/web/routes/index.json",
        "../../packages/health-commons/generated/web/shell/experiments/**/*.json",
        "../../packages/health-commons/generated/web/tabs/experiments/**/*.json",
      ],
      "/biomarkers": [
        "../../packages/health-commons/generated/web/browse/biomarkers.json",
        "../../packages/health-commons/generated/web/routes/index.json",
        "../../packages/health-commons/generated/web/shell/biomarkers/**/*.json",
        "../../packages/health-commons/generated/web/pages/biomarkers/**/*.json",
      ],
      "/measurement-methods/[measurementMethodId]": [
        "../../packages/health-commons/generated/web/routes/index.json",
        "../../packages/health-commons/generated/web/bundles/measurement_method/**/*.json",
      ],
      // Keys are picomatch globs matched with `contains: true` against the
      // route path (route groups stripped), so "/opengraph-image" covers every
      // `opengraph-image` metadata route: the static marketing images and the
      // dynamic invite/group/biomarker/experiment unfurls that are never
      // prerendered. The two share-card route handlers are keyed explicitly.
      "/opengraph-image": OG_SHARE_ASSET_TRACE_INCLUDES,
      "/changelog/card/v1/[items]": OG_SHARE_ASSET_TRACE_INCLUDES,
      "/experiments/[experimentId]/card": OG_SHARE_ASSET_TRACE_INCLUDES,
      "/imessage/card/v1/[payload]": OG_SHARE_ASSET_TRACE_INCLUDES,
    },
    outputFileTracingRoot: path.resolve(appDir, "../.."),
    transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
    turbopack: buildHostedWebTurbopackConfig(),
    typescript: {
      tsconfigPath: HOSTED_WEB_NEXT_TSCONFIG_PATH,
    },
    headers: async () => [
      {
        source: HOSTED_WEB_HEADER_SOURCE,
        headers: buildHostedWebSecurityHeaders(process.env),
      },
      {
        source: MURPH_SAFE_HEADER_SOURCE,
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
    ],
  };
}

export function buildHostedWebClientEnv(
  environment: NodeJS.ProcessEnv = process.env,
): NonNullable<NextConfig["env"]> {
  return {
    [MURPH_TELEGRAM_USERNAME_OVERRIDE_ENV_KEY]:
      environment[MURPH_TELEGRAM_USERNAME_OVERRIDE_ENV_KEY]?.trim() ?? "",
  };
}

export function assertHostedBrowserDeviceSyncCallbackHostnameConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const configuredCallbackValue =
    environment[DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEY]?.trim() ?? "";
  const derivedCallbackSource = HOSTED_PUBLIC_BASE_URL_ENV_KEYS.find(
    (label) => Boolean(environment[label]?.trim()),
  ) ?? (
    environment[HOSTED_PUBLIC_VERCEL_URL_ENV_KEY]?.trim()
      ? HOSTED_PUBLIC_VERCEL_URL_ENV_KEY
      : null
  );
  if (!configuredCallbackValue && !derivedCallbackSource) {
    return;
  }

  const callbackSource = configuredCallbackValue
    ? DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEY
    : derivedCallbackSource;
  const configuredCallbackBaseUrl = normalizeConfiguredBaseUrl(
    configuredCallbackValue || environment[callbackSource ?? ""],
    {
      allowHttpLoopback: true,
      requireOriginOnly: Boolean(!configuredCallbackValue),
    },
  );

  if (!configuredCallbackBaseUrl) {
    throw new TypeError(
      `${callbackSource ?? DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEY} must resolve to a valid hosted browser OAuth callback URL.`,
    );
  }

  const configuredAppSessionBaseUrls = HOSTED_PUBLIC_BASE_URL_ENV_KEYS
    .flatMap((label) => {
      const baseUrl = normalizeConfiguredBaseUrl(environment[label], {
        allowHttpLoopback: true,
      });
      return baseUrl ? [{ baseUrl, label }] : [];
    });
  const vercelAppSessionBaseUrl = normalizeConfiguredBaseUrl(
    environment[HOSTED_PUBLIC_VERCEL_URL_ENV_KEY],
    { allowHttpLoopback: true },
  );
  const appSessionBaseUrls = configuredAppSessionBaseUrls.length > 0
    ? configuredAppSessionBaseUrls
    : vercelAppSessionBaseUrl
      ? [{
          baseUrl: vercelAppSessionBaseUrl,
          label: HOSTED_PUBLIC_VERCEL_URL_ENV_KEY,
        }]
      : [];
  const callbackHostname = new URL(configuredCallbackBaseUrl).hostname;

  for (const appSessionBaseUrl of appSessionBaseUrls) {
    if (new URL(appSessionBaseUrl.baseUrl).hostname === callbackHostname) {
      continue;
    }

    throw new TypeError(
      `The effective hosted browser device callback from ${callbackSource ?? DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEY} must use the ${appSessionBaseUrl.label} hostname.`,
    );
  }
}

async function nextConfig(phase: string): Promise<NextConfig> {
  configureHostedWebWorkflowLocalDataDir(phase);
  assertHostedBrowserDeviceSyncCallbackHostnameConfiguration();
  return buildHostedWebNextConfig(phase);
}

export const HOSTED_WEB_WORKFLOW_NEXT_CONFIG = withWorkflow(
  nextConfig,
  HOSTED_WEB_WORKFLOW_OPTIONS,
);

export default HOSTED_WEB_WORKFLOW_NEXT_CONFIG;

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

function resolveHostedPrivyFallbackOrigins(value: string | null | undefined): string[] {
  const parsed = parseConfiguredOrigin(value);

  if (!parsed || isLoopbackHostname(parsed.hostname)) {
    return [];
  }

  const hostnames = new Set<string>([normalizePrivyHostnameCandidate(parsed.hostname)]);
  const strippedHostname = stripHostedPublicSubdomainPrefix(parsed.hostname);

  if (strippedHostname) {
    hostnames.add(normalizePrivyHostnameCandidate(strippedHostname));
  }

  return [...hostnames].map((hostname) => buildOrigin(parsed.protocol, hostname, parsed.port));
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

function stripHostedPublicSubdomainPrefix(hostname: string): string | null {
  const labels = hostname.toLowerCase().split(".");

  if (labels.length < 3) {
    return null;
  }

  const [firstLabel, ...remainingLabels] = labels;

  if (!HOSTED_PUBLIC_SUBDOMAIN_PREFIXES.includes(firstLabel as typeof HOSTED_PUBLIC_SUBDOMAIN_PREFIXES[number])) {
    return null;
  }

  return remainingLabels.join(".");
}

function normalizePrivyHostnameCandidate(hostname: string): string {
  const normalizedHostname = hostname.toLowerCase();

  if (normalizedHostname.startsWith("privy.")) {
    return normalizedHostname;
  }

  return `privy.${normalizedHostname.replace(/^www\./u, "")}`;
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
    requireOriginOnly?: boolean;
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

  if (
    (options?.requireOriginOnly ?? true)
    && parsed.pathname !== ""
    && parsed.pathname !== "/"
  ) {
    throw new TypeError(
      "Hosted public base URLs must not include a path; configure only the origin.",
    );
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
