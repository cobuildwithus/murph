import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  HOSTED_WEB_SMOKE_HEALTH_PATH,
  clearStaleHostedWebSmokeLocks,
  isHostedWebSmokeArtifactFresh,
  isRecoverableHostedWebSmokeLockOwner,
  resolveHostedWebSmokeDevCommand,
  shouldPruneHostedWebSmokeCache,
} from "../scripts/dev-smoke";
import { createHostedWebSmokeEnvironment } from "../next-artifacts";

function createEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  };
}

test("hosted web smoke uses the linked vercel path outside CI", () => {
  assert.equal(
    resolveHostedWebSmokeDevCommand(createEnv({
      CI: "false",
    })),
    "dev",
  );
});

test("hosted web smoke probes the lightweight internal health route", () => {
  assert.equal(HOSTED_WEB_SMOKE_HEALTH_PATH, "/api/internal/health");
});

test("hosted web smoke uses the local-env path in CI", () => {
  assert.equal(
    resolveHostedWebSmokeDevCommand(createEnv({
      CI: "true",
    })),
    "dev:local-env",
  );
});

test("hosted web smoke accepts an explicit local-env override", () => {
  assert.equal(
    resolveHostedWebSmokeDevCommand(createEnv({
      CI: "false",
      MURPH_HOSTED_WEB_SMOKE_USE_LOCAL_ENV: "1",
    })),
    "dev:local-env",
  );
});

test("hosted web smoke can reuse a verifier-prepared local env", () => {
  assert.equal(
    resolveHostedWebSmokeDevCommand(createEnv({
      CI: "true",
      MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV: "1",
      MURPH_HOSTED_WEB_SMOKE_USE_LOCAL_ENV: "1",
    })),
    "dev:prepared-local-env",
  );
});

test("hosted web smoke keeps the Turbopack cache locally by default", () => {
  assert.equal(
    shouldPruneHostedWebSmokeCache(createEnv({
      CI: "false",
    })),
    false,
  );
});

test("hosted web smoke prunes the Turbopack cache in CI", () => {
  assert.equal(
    shouldPruneHostedWebSmokeCache(createEnv({
      CI: "true",
    })),
    true,
  );
});

test("hosted web smoke accepts explicit cache-prune overrides", () => {
  assert.equal(
    shouldPruneHostedWebSmokeCache(createEnv({
      CI: "true",
      MURPH_HOSTED_WEB_SMOKE_PRUNE_CACHE: "0",
    })),
    false,
  );
  assert.equal(
    shouldPruneHostedWebSmokeCache(createEnv({
      CI: "false",
      MURPH_HOSTED_WEB_SMOKE_PRUNE_CACHE: "1",
    })),
    true,
  );
});

test("hosted web smoke artifact freshness allows current-run mtimes", () => {
  assert.equal(isHostedWebSmokeArtifactFresh({ mtimeMs: 10_000 }, 10_000), true);
  assert.equal(isHostedWebSmokeArtifactFresh({ mtimeMs: 8_500 }, 10_000), true);
  assert.equal(isHostedWebSmokeArtifactFresh({ mtimeMs: 7_999 }, 10_000), false);
});

test("hosted web smoke recognizes recoverable Next lock owners", () => {
  assert.equal(isRecoverableHostedWebSmokeLockOwner("next-server (v16.2.4)"), true);
  assert.equal(
    isRecoverableHostedWebSmokeLockOwner("/repo/node_modules/next/dist/bin/next dev"),
    true,
  );
  assert.equal(isRecoverableHostedWebSmokeLockOwner("node unrelated-server.js"), false);
  assert.equal(isRecoverableHostedWebSmokeLockOwner(null), false);
});

test("hosted web smoke removes a stale lock when its pid is no longer running", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-dev-smoke-lock-"));
  const lockPath = path.join(tempDir, "lock");

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await clearStaleHostedWebSmokeLocks(lockPath, {
      isProcessRunning: () => false,
    });

    await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/u);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("hosted web smoke refuses to terminate non-Next stale lock owners", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-dev-smoke-lock-"));
  const lockPath = path.join(tempDir, "lock");
  const terminated: string[] = [];

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await assert.rejects(
      clearStaleHostedWebSmokeLocks(lockPath, {
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

test("hosted web smoke terminates a stale live Next lock owner", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-dev-smoke-lock-"));
  const lockPath = path.join(tempDir, "lock");
  const signals: NodeJS.Signals[] = [];
  let running = true;

  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: 12345, port: 3060 })}\n`, "utf8");

    await clearStaleHostedWebSmokeLocks(lockPath, {
      isProcessRunning: () => running,
      processCommand: () => "next-server (v16.2.4)",
      sleep: async () => {},
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

test("hosted web smoke falls back to the local database url when none is configured", () => {
  const environment = createEnv({});
  delete environment.DATABASE_URL;
  delete environment.HOSTED_APP_SESSION_HMAC_KEY;
  delete environment.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  delete environment.HOSTED_CONTACT_PRIVACY_KEYS;
  delete environment.HOSTED_MAILBOX_FINGERPRINT_KEY;
  delete environment.NEXT_PUBLIC_PRIVY_APP_ID;
  const smokeEnv = createHostedWebSmokeEnvironment(environment);

  assert.equal(
    smokeEnv.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
  );
  assert.equal(
    smokeEnv.HOSTED_APP_SESSION_HMAC_KEY,
    Buffer.alloc(32, 8).toString("base64url"),
  );
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION, "v1");
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_KEYS, "v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
  assert.equal(smokeEnv.HOSTED_MAILBOX_FINGERPRINT_KEY, "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID, "cm_app_smoke_placeholder1");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID?.length, 25);
});

test("hosted web smoke preserves an existing database url", () => {
  const smokeEnv = createHostedWebSmokeEnvironment(createEnv({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/murph_test",
    HOSTED_APP_SESSION_HMAC_KEY: Buffer.alloc(32, 10).toString("base64url"),
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v9",
    HOSTED_CONTACT_PRIVACY_KEYS: "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    HOSTED_MAILBOX_FINGERPRINT_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_real",
  }));

  assert.equal(smokeEnv.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:1/murph_test");
  assert.equal(
    smokeEnv.HOSTED_APP_SESSION_HMAC_KEY,
    Buffer.alloc(32, 10).toString("base64url"),
  );
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION, "v9");
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_KEYS, "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(smokeEnv.HOSTED_MAILBOX_FINGERPRINT_KEY, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID, "cm_app_real");
});
