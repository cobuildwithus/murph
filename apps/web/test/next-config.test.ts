import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { test } from "vitest";

import { resolveHostedWebWorkspaceSourceEntries } from "../../../config/workspace-source-resolution";
import {
  HOSTED_WEB_BUILD_DIST_DIR,
  HOSTED_WEB_DEV_DIST_DIR,
  HOSTED_WEB_SMOKE_DIST_DIR,
  createHostedWebSmokeEnvironment,
  isHostedWebDevFileSystemCacheEnabled,
  resolveHostedWebDistDir,
} from "../next-artifacts";
import {
  HOSTED_WEB_WORKFLOW_OPTIONS,
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  buildHostedWebNextConfig,
  buildHostedWebTurbopackConfig,
  buildHostedWebContentSecurityPolicy,
  buildHostedWebSecurityHeaders,
  resolveHostedPrivyOrigin,
  resolveHostedPrivyOrigins,
  resolvePrivyBaseDomainOrigin,
} from "../next.config";

const productionNextConfig = buildHostedWebNextConfig(PHASE_PRODUCTION_BUILD);
const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const hostedWebWorkspaceEntries = resolveHostedWebWorkspaceSourceEntries(path.join(repoRoot, "apps/web"));

test("resolveHostedWebWorkspaceSourceEntries points at hosted source package entries", () => {
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/cloudflare-hosted-control"],
    path.join(repoRoot, "packages/cloudflare-hosted-control/package.json"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/device-syncd"],
    path.join(repoRoot, "packages/device-syncd/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/gateway-core"],
    path.join(repoRoot, "packages/gateway-core/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/parsers"],
    path.join(repoRoot, "packages/parsers/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/core"],
    path.join(repoRoot, "packages/core/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/hosted-execution"],
    path.join(repoRoot, "packages/hosted-execution/src/index.ts"),
  );
});

test("next.config transpiles hosted workspace source packages instead of pinning dist aliases", () => {
  assert.deepEqual(productionNextConfig.transpilePackages, [...WORKSPACE_SOURCE_PACKAGE_NAMES]);
});

test("hosted web dist-dir selection reserves a dedicated artifact directory for interactive dev", () => {
  assert.equal(resolveHostedWebDistDir(PHASE_DEVELOPMENT_SERVER), HOSTED_WEB_DEV_DIST_DIR);
  assert.equal(resolveHostedWebDistDir(PHASE_PRODUCTION_BUILD), HOSTED_WEB_BUILD_DIST_DIR);
  assert.equal(productionNextConfig.distDir, HOSTED_WEB_BUILD_DIST_DIR);
});

test("hosted web dev smoke uses its own Next artifact directory", () => {
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_DEVELOPMENT_SERVER,
      createHostedWebSmokeEnvironment(createProcessEnv({})),
    ),
    HOSTED_WEB_SMOKE_DIST_DIR,
  );
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_PRODUCTION_BUILD,
      createHostedWebSmokeEnvironment(createProcessEnv({})),
    ),
    HOSTED_WEB_BUILD_DIST_DIR,
  );
});

test("hosted web dev smoke can isolate concurrent runs with a dist-dir suffix", () => {
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_DEVELOPMENT_SERVER,
      createHostedWebSmokeEnvironment(createProcessEnv({
        NEXT_DIST_DIR_SUFFIX: "e2e-run",
      })),
    ),
    `${HOSTED_WEB_SMOKE_DIST_DIR}-e2e-run`,
  );
});

test("hosted web dev filesystem cache defaults off and allows explicit opt-in", () => {
  assert.equal(isHostedWebDevFileSystemCacheEnabled(), false);
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "1",
      }),
    ),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "yes",
      }),
    ),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "true",
      }),
    ),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "0",
      }),
    ),
    false,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "no",
      }),
    ),
    false,
  );
});

test("next.config keeps Turbopack focused on the repo root without custom workspace rewrite rules", () => {
  assert.equal(productionNextConfig.turbopack?.root, process.cwd());
  assert.equal(productionNextConfig.webpack, undefined);
  assert.equal(productionNextConfig.typescript, undefined);
});

test("next.config uses Workflow lazy discovery to avoid eager dev rebuild loops", () => {
  assert.deepEqual(HOSTED_WEB_WORKFLOW_OPTIONS, {
    workflows: {
      lazyDiscovery: true,
    },
  });
});

test("next.config traces generated Health Commons route files without the monolithic catalog", () => {
  assert.deepEqual(
    productionNextConfig.outputFileTracingIncludes?.["/measurement-methods/[measurementMethodId]"],
    [
      "../../packages/health-commons/generated/web/routes/index.json",
      "../../packages/health-commons/generated/web/bundles/measurement_method/**/*.json",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(productionNextConfig.outputFileTracingIncludes),
    /generated\/catalog\.json/u,
  );
});

test("next.config disables the Turbopack dev filesystem cache by default and honors explicit opt-in", () => {
  const previousValue = process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE;

  try {
    delete process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE;
    assert.equal(
      buildHostedWebNextConfig(PHASE_DEVELOPMENT_SERVER).experimental
        ?.turbopackFileSystemCacheForDev,
      false,
    );

    process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE = "1";
    assert.equal(
      buildHostedWebNextConfig(PHASE_DEVELOPMENT_SERVER).experimental
        ?.turbopackFileSystemCacheForDev,
      true,
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE;
    } else {
      process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE = previousValue;
    }
  }
});

test("buildHostedWebTurbopackConfig always points Turbopack at the repo root", () => {
  const turbopackConfig = buildHostedWebTurbopackConfig();
  const resolveAlias = turbopackConfig?.resolveAlias;
  const hasOptionalModule = resolveHostedOptionalModule();

  assert.equal(turbopackConfig?.root, process.cwd());
  if (hasOptionalModule) {
    assert.equal(resolveAlias, undefined);
  } else {
    assert.deepEqual(resolveAlias, {
      "@farcaster/mini-app-solana": "./src/lib/empty-module.ts",
    });
  }
});

test("resolvePrivyBaseDomainOrigin normalizes base-domain inputs into a Privy origin", () => {
  assert.equal(resolvePrivyBaseDomainOrigin("example.com"), "https://privy.example.com");
  assert.equal(
    resolvePrivyBaseDomainOrigin("https://privy.example.com/dashboard"),
    "https://privy.example.com",
  );
  assert.equal(resolvePrivyBaseDomainOrigin("https://www.example.com/join"), "https://privy.example.com");
  assert.equal(resolvePrivyBaseDomainOrigin("   "), null);
});

test("resolveHostedPrivyOrigin prefers an explicit custom auth domain and otherwise falls back to the hosted public origin", () => {
  assert.equal(
    resolveHostedPrivyOrigin(createProcessEnv({
      PRIVY_CUSTOM_AUTH_DOMAIN: "privy.custom.example.com",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.example.com",
    })),
    "https://privy.custom.example.com",
  );
  assert.equal(
    resolveHostedPrivyOrigin(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.example.com",
    })),
    "https://privy.example.com",
  );
});

test("resolveHostedPrivyOrigin rejects hosted public base URLs with non-root paths", () => {
  assert.throws(
    () => resolveHostedPrivyOrigin(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.example.com/join",
    })),
    /must not include a path/u,
  );
});

test("resolveHostedPrivyOrigin rejects a pathful HOSTED_WEB_BASE_URL fallback", () => {
  assert.throws(
    () => resolveHostedPrivyOrigin(createProcessEnv({
      HOSTED_WEB_BASE_URL: "https://www.example.com/app",
    })),
    /must not include a path/u,
  );
});

test("resolveHostedPrivyOrigin rejects a pathful Vercel production fallback", () => {
  assert.throws(
    () => resolveHostedPrivyOrigin(createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.example.com/app",
    })),
    /must not include a path/u,
  );
});

test("resolveHostedPrivyOrigin falls back to the Vercel production URL when no hosted public base URL is configured", () => {
  assert.equal(
    resolveHostedPrivyOrigin(createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.example.com",
    })),
    "https://privy.example.com",
  );
});

test("resolveHostedPrivyOrigins adds the base-domain fallback for common hosted-web subdomains", () => {
  assert.deepEqual(
    resolveHostedPrivyOrigins(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://app.withmurph.ai",
    })),
    [
      "https://privy.app.withmurph.ai",
      "https://privy.withmurph.ai",
    ],
  );
});

test("resolveHostedPrivyOrigins prefers PRIVY_BASE_DOMAIN over hosted public subdomain fallbacks", () => {
  assert.deepEqual(
    resolveHostedPrivyOrigins(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://app.withmurph.ai",
      PRIVY_BASE_DOMAIN: "withmurph.ai",
    })),
    ["https://privy.withmurph.ai"],
  );
});

test("buildHostedWebContentSecurityPolicy includes Privy, WalletConnect, and hosted browser protections", () => {
  const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
    NODE_ENV: "production",
    PRIVY_CUSTOM_AUTH_DOMAIN: "https://privy.custom.example.com",
  }));

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src [^;]*https:\/\/auth\.privy\.io/);
  assert.match(csp, /script-src [^;]*https:\/\/telegram\.org/);
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /child-src [^;]*https:\/\/auth\.privy\.io/);
  assert.match(csp, /child-src [^;]*https:\/\/privy\.custom\.example\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/privy\.custom\.example\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/oauth\.telegram\.org/);
  assert.match(csp, /frame-src [^;]*https:\/\/verify\.walletconnect\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/privy\.custom\.example\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/\*\.rpc\.privy\.systems/);
  assert.match(csp, /connect-src [^;]*https:\/\/explorer-api\.walletconnect\.com/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test("buildHostedWebContentSecurityPolicy includes the base-domain Privy fallback for common hosted-web subdomains", () => {
  for (const hostedPublicBaseUrl of [
    "https://app.withmurph.ai",
    "https://www.withmurph.ai",
    "https://web.withmurph.ai",
  ]) {
    const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
      NODE_ENV: "production",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: hostedPublicBaseUrl,
    }));

    assert.match(csp, /child-src [^;]*https:\/\/privy\.withmurph\.ai/);
    assert.match(csp, /frame-src [^;]*https:\/\/privy\.withmurph\.ai/);
    assert.match(csp, /connect-src [^;]*https:\/\/privy\.withmurph\.ai/);
  }
});

test("buildHostedWebContentSecurityPolicy keeps Next development relaxations scoped to development", () => {
  const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
    NODE_ENV: "development",
  }));

  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
  assert.match(csp, /connect-src [^;]*ws:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("buildHostedWebSecurityHeaders adds production-only HSTS alongside the CSP bundle", () => {
  const productionHeaders = buildHostedWebSecurityHeaders(createProcessEnv({
    NODE_ENV: "production",
  }));
  const productionHeaderKeys = productionHeaders.map((header) => header.key);

  assert.deepEqual(productionHeaderKeys, [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]);

  const testHeaders = buildHostedWebSecurityHeaders(createProcessEnv({
    NODE_ENV: "test",
  }));
  const testHeaderKeys = testHeaders.map((header) => header.key);

  assert.deepEqual(testHeaderKeys, [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Permissions-Policy",
  ]);
});

test("next.config serves the hosted security headers on every route", async () => {
  const routes = await productionNextConfig.headers?.();

  assert.ok(routes);
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.source, "/(.*)");
  assert.deepEqual(
    routes[0]?.headers.map((header) => header.key),
    [
      "Content-Security-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Permissions-Policy",
    ],
  );
});

function resolveHostedOptionalModule(): boolean {
  try {
    require.resolve("@farcaster/mini-app-solana");
    return true;
  } catch {
    return false;
  }
}

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}
