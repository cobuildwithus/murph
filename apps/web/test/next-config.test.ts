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
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  buildHostedWebNextConfig,
  buildHostedWebTurbopackConfig,
  buildHostedWebContentSecurityPolicy,
  buildHostedWebSecurityHeaders,
  resolvePrivyBaseDomainOrigin,
} from "../next.config";

const productionNextConfig = buildHostedWebNextConfig(PHASE_PRODUCTION_BUILD);
const require = createRequire(import.meta.url);

test("resolveHostedWebWorkspaceSourceEntries points at hosted source package entries", () => {
  assert.equal(
    resolveHostedWebWorkspaceSourceEntries("/repo/apps/web")["@murphai/device-syncd"],
    path.resolve("/repo/packages/device-syncd/src/index.ts"),
  );
  assert.equal(
    resolveHostedWebWorkspaceSourceEntries("/repo/apps/web")["@murphai/core"],
    path.resolve("/repo/packages/core/src/index.ts"),
  );
  assert.equal(
    resolveHostedWebWorkspaceSourceEntries("/repo/apps/web")["@murphai/hosted-execution"],
    path.resolve("/repo/packages/hosted-execution/src/index.ts"),
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
      createHostedWebSmokeEnvironment({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ),
    HOSTED_WEB_SMOKE_DIST_DIR,
  );
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_PRODUCTION_BUILD,
      createHostedWebSmokeEnvironment({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ),
    HOSTED_WEB_BUILD_DIST_DIR,
  );
});

test("hosted web dev filesystem cache stays opt-in", () => {
  assert.equal(isHostedWebDevFileSystemCacheEnabled(), false);
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled({
      MURPH_NEXT_DEV_FILESYSTEM_CACHE: "1",
    } as unknown as NodeJS.ProcessEnv),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled({
      MURPH_NEXT_DEV_FILESYSTEM_CACHE: "yes",
    } as unknown as NodeJS.ProcessEnv),
    true,
  );
});

test("next.config keeps Turbopack focused on the repo root without custom workspace rewrite rules", () => {
  assert.equal(productionNextConfig.turbopack?.root, process.cwd());
  assert.equal(productionNextConfig.webpack, undefined);
  assert.equal(productionNextConfig.typescript, undefined);
});

test("next.config disables the Turbopack dev filesystem cache unless explicitly enabled", () => {
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
  assert.equal(resolvePrivyBaseDomainOrigin("   "), null);
});

test("buildHostedWebContentSecurityPolicy includes Privy, WalletConnect, and hosted browser protections", () => {
  const csp = buildHostedWebContentSecurityPolicy({
    NODE_ENV: "production",
    PRIVY_BASE_DOMAIN: "example.com",
  } as NodeJS.ProcessEnv);

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /child-src [^;]*https:\/\/auth\.privy\.io/);
  assert.match(csp, /child-src [^;]*https:\/\/privy\.example\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/verify\.walletconnect\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/\*\.rpc\.privy\.systems/);
  assert.match(csp, /connect-src [^;]*https:\/\/explorer-api\.walletconnect\.com/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test("buildHostedWebContentSecurityPolicy keeps Next development relaxations scoped to development", () => {
  const csp = buildHostedWebContentSecurityPolicy({
    NODE_ENV: "development",
  } as NodeJS.ProcessEnv);

  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
  assert.match(csp, /connect-src [^;]*ws:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("buildHostedWebSecurityHeaders adds production-only HSTS alongside the CSP bundle", () => {
  const productionHeaders = buildHostedWebSecurityHeaders({
    NODE_ENV: "production",
  } as NodeJS.ProcessEnv);
  const productionHeaderKeys = productionHeaders.map((header) => header.key);

  assert.deepEqual(productionHeaderKeys, [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]);

  const testHeaders = buildHostedWebSecurityHeaders({
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
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
