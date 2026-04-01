import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHostedWebDevArgv,
  resolveHostedWebDevCacheLimitBytes,
  resolveHostedWebDevRuntimePaths,
} from "../scripts/dev-local";

function createEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  };
}

test("hosted web dev disables source maps by default", () => {
  assert.deepEqual(buildHostedWebDevArgv(["--port", "3000"]), [
    "--port",
    "3000",
    "--turbopack",
    "--disable-source-maps",
  ]);
});

test("hosted web dev respects an explicit webpack flag", () => {
  assert.deepEqual(buildHostedWebDevArgv(["--port", "3000", "--webpack"]), [
    "--port",
    "3000",
    "--webpack",
    "--disable-source-maps",
  ]);
});

test("hosted web dev accepts a webpack env override when no bundler flag is provided", () => {
  assert.deepEqual(
    buildHostedWebDevArgv(["--port", "3000"], createEnv({
      MURPH_NEXT_DEV_BUNDLER: "webpack",
    })),
    ["--port", "3000", "--webpack", "--disable-source-maps"],
  );
});

test("hosted web dev drops the standalone pnpm argument separator before forwarding to Next", () => {
  assert.deepEqual(buildHostedWebDevArgv(["--", "--port", "3000"]), [
    "--port",
    "3000",
    "--turbopack",
    "--disable-source-maps",
  ]);
});

test("hosted web dev keeps source maps when explicitly requested through the env override", () => {
  assert.deepEqual(
    buildHostedWebDevArgv(["--port", "3000"], createEnv({
      MURPH_NEXT_DEV_SOURCE_MAPS: "1",
    })),
    ["--port", "3000", "--turbopack"],
  );
});

test("hosted web dev cache limit defaults to four GiB and accepts an env override in MiB", () => {
  assert.equal(resolveHostedWebDevCacheLimitBytes(), 4 * 1024 * 1024 * 1024);
  assert.equal(
    resolveHostedWebDevCacheLimitBytes(createEnv({
      MURPH_NEXT_DEV_CACHE_LIMIT_MB: "512",
    })),
    512 * 1024 * 1024,
  );
});

test("hosted web dev lock paths stay isolated between interactive and smoke artifact modes", () => {
  const interactivePaths = resolveHostedWebDevRuntimePaths("/repo/apps/web");
  const smokePaths = resolveHostedWebDevRuntimePaths("/repo/apps/web", createEnv({
    NEXT_DIST_DIR_MODE: "smoke",
  }));

  assert.equal(interactivePaths.distDir, "/repo/apps/web/.next-dev");
  assert.equal(interactivePaths.lockPath, "/repo/apps/web/.next-dev/.dev-server.lock");
  assert.equal(smokePaths.distDir, "/repo/apps/web/.next-smoke");
  assert.equal(smokePaths.lockPath, "/repo/apps/web/.next-smoke/.dev-server.lock");
});
