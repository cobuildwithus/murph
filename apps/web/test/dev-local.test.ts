import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  buildHostedWebDevArgv,
  clearConflictingNextDevLock,
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

test("hosted web dev refuses to terminate non-Next processes from a Next dev lock", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-next-dev-lock-"));
  const lockPath = path.join(tempDir, "lock");
  const terminated: string[] = [];

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await assert.rejects(
      clearConflictingNextDevLock(lockPath, {
        isProcessRunning: () => true,
        processCommand: () => "node unrelated-server.js",
        terminateProcess: (_pid, signal) => terminated.push(signal),
      }),
      /active non-Next process/u,
    );

    assert.deepEqual(terminated, []);
    assert.equal(
      await readFile(lockPath, "utf8"),
      `${JSON.stringify({ pid: 12345, port: 3060 })}\n`,
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("hosted web dev terminates a stale live Next dev lock owner", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-next-dev-lock-"));
  const lockPath = path.join(tempDir, "lock");
  const signals: NodeJS.Signals[] = [];
  let running = true;

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await clearConflictingNextDevLock(lockPath, {
      isProcessRunning: () => running,
      processCommand: () => "next-server (v16.2.4)",
      sleep: async () => {},
      stderr: { write: () => true },
      terminateProcess: (_pid, signal) => {
        signals.push(signal);
        running = false;
      },
    });

    assert.deepEqual(signals, ["SIGINT"]);
    await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/u);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
