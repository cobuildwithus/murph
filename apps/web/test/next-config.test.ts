import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import nextConfig, {
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  buildHostedWebTurbopackConfig,
  buildHostedWebContentSecurityPolicy,
  buildHostedWebSecurityHeaders,
  resolvePrivyBaseDomainOrigin,
  resolveWorkspaceSourceEntries,
} from "../next.config";

test("resolveWorkspaceSourceEntries points at hosted source package entries", () => {
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/apps/web")["@healthybob/device-syncd"],
    path.resolve("/repo/packages/device-syncd/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/apps/web")["@healthybob/core"],
    path.resolve("/repo/packages/core/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/apps/web")["@healthybob/hosted-execution"],
    path.resolve("/repo/packages/hosted-execution/src/index.ts"),
  );
});

test("next.config transpiles hosted workspace source packages instead of pinning dist aliases", () => {
  assert.deepEqual(nextConfig.transpilePackages, [...WORKSPACE_SOURCE_PACKAGE_NAMES]);
});

test("next.config keeps Turbopack focused on the repo root without custom workspace rewrite rules", () => {
  assert.deepEqual(nextConfig.turbopack, {
    root: process.cwd(),
  });
});

test("buildHostedWebTurbopackConfig always points Turbopack at the repo root", () => {
  const turbopackConfig = buildHostedWebTurbopackConfig();

  assert.deepEqual(turbopackConfig, {
    root: process.cwd(),
  });
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
  const routes = await nextConfig.headers?.();

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
