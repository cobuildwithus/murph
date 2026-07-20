import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  assertHostedWebDevRequiredEnv,
  buildHostedWebDevArgv,
  clearConflictingNextDevLock,
  loadHostedWebDevLocalEnv,
  removeHostedWebDevServerLockIfOwned,
  resolveHostedWebDevCacheLimitBytes,
  resolveHostedWebDevOwnerPid,
  resolveHostedWebDevRuntimePaths,
} from "../scripts/dev-local";

function createEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  };
}

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("hosted web dev disables source maps by default", () => {
  assert.deepEqual(buildHostedWebDevArgv(["--port", "3000"]), [
    "--port",
    "3000",
    "--turbopack",
    "--disable-source-maps",
  ]);
});

test("hosted web dev fails before boot when DATABASE_URL is missing", () => {
  assert.throws(
    () => assertHostedWebDevRequiredEnv(createEnv({ DATABASE_URL: "" })),
    /DATABASE_URL is required for the hosted web control plane/u,
  );
});

test("hosted web dev loads local env before checking required database config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-web-env-"));

  try {
    delete process.env.DATABASE_URL;
    await writeFile(
      path.join(tempDir, ".env.local"),
      "DATABASE_URL=postgresql://user:pass@example.com/db?sslmode=require\n",
      "utf8",
    );

    loadHostedWebDevLocalEnv(tempDir);

    assert.equal(process.env.DATABASE_URL, "postgresql://user:pass@example.com/db?sslmode=require");
    assert.doesNotThrow(() => assertHostedWebDevRequiredEnv(process.env));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
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

test("hosted web dev owner pid is optional and accepts only positive integers", () => {
  assert.equal(resolveHostedWebDevOwnerPid(createEnv({})), null);
  assert.equal(resolveHostedWebDevOwnerPid(createEnv({
    MURPH_HOSTED_WEB_DEV_OWNER_PID: "1234",
  })), 1234);
  assert.equal(resolveHostedWebDevOwnerPid(createEnv({
    MURPH_HOSTED_WEB_DEV_OWNER_PID: "0",
  })), null);
  assert.equal(resolveHostedWebDevOwnerPid(createEnv({
    MURPH_HOSTED_WEB_DEV_OWNER_PID: "not-a-pid",
  })), null);
});

test("hosted web dev lock paths stay isolated between interactive and smoke artifact modes", () => {
  const interactivePaths = resolveHostedWebDevRuntimePaths("/repo/apps/web");
  const smokePaths = resolveHostedWebDevRuntimePaths("/repo/apps/web", createEnv({
    NEXT_DIST_DIR_MODE: "smoke",
  }));
  const isolatedSmokePaths = resolveHostedWebDevRuntimePaths("/repo/apps/web", createEnv({
    NEXT_DIST_DIR_MODE: "smoke",
    NEXT_DIST_DIR_SUFFIX: "e2e-run",
  }));

  assert.equal(interactivePaths.distDir, "/repo/apps/web/.next-dev");
  assert.equal(interactivePaths.lockPath, "/repo/apps/web/.next-dev/.dev-server.lock");
  assert.equal(smokePaths.distDir, "/repo/apps/web/.next-smoke");
  assert.equal(smokePaths.lockPath, "/repo/apps/web/.next-smoke/.dev-server.lock");
  assert.equal(isolatedSmokePaths.distDir, "/repo/apps/web/.next-smoke-e2e-run");
  assert.equal(
    isolatedSmokePaths.lockPath,
    "/repo/apps/web/.next-smoke-e2e-run/.dev-server.lock",
  );
});

test("hosted web dev package wrappers leave lock cleanup to the owner-aware dev helper", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };

  for (const scriptName of ["dev:local-env", "dev:prepared-local-env"]) {
    const script = packageJson.scripts?.[scriptName] ?? "";

    assert.match(script, /apps\/web\/scripts\/dev-local\.ts/u);
    assert.doesNotMatch(script, /rm\s+-rf\s+\.next-dev\/\.dev-server\.lock/u);
  }
});

test("hosted web dev lock release does not remove another owner metadata lock", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-web-dev-owner-lock-"));
  const runtimePaths = resolveHostedWebDevRuntimePaths(tempDir);

  try {
    await mkdir(runtimePaths.lockPath, { recursive: true });
    await writeFile(
      runtimePaths.lockMetadataPath,
      `${JSON.stringify({
        command: "next-server",
        pid: process.pid + 1,
        port: 3000,
        startedAt: "2026-03-25T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    await removeHostedWebDevServerLockIfOwned(runtimePaths);
    assert.equal(
      await readFile(runtimePaths.lockMetadataPath, "utf8"),
      `${JSON.stringify({
        command: "next-server",
        pid: process.pid + 1,
        port: 3000,
        startedAt: "2026-03-25T00:00:00.000Z",
      })}\n`,
    );

    await writeFile(
      runtimePaths.lockMetadataPath,
      `${JSON.stringify({
        command: "tsx dev-local.ts",
        pid: process.pid,
        port: 3000,
        startedAt: "2026-03-25T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    await removeHostedWebDevServerLockIfOwned(runtimePaths);
    await assert.rejects(readFile(runtimePaths.lockMetadataPath, "utf8"), /ENOENT/u);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("hosted web dev removes a stale Next dev lock when its pid is no longer running", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-next-dev-lock-"));
  const lockPath = path.join(tempDir, "lock");

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await clearConflictingNextDevLock(lockPath, {
      isProcessRunning: () => false,
    });

    await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/u);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("hosted web dev fails closed for every live Next dev lock", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-next-dev-lock-"));
  const lockPath = path.join(tempDir, "lock");

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await assert.rejects(
      clearConflictingNextDevLock(lockPath, {
        isProcessRunning: () => true,
      }),
      /active process/u,
    );

    assert.equal(
      await readFile(lockPath, "utf8"),
      `${JSON.stringify({ pid: 12345, port: 3060 })}\n`,
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("hosted web dev removes a malformed Next dev lock without process inspection", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-next-dev-lock-"));
  const lockPath = path.join(tempDir, "lock");

  try {
    await writeFile(lockPath, "not-json\n", "utf8");

    await clearConflictingNextDevLock(lockPath, {
      isProcessRunning: () => {
        throw new Error("malformed locks must not trigger process inspection");
      },
    });

    await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/u);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
