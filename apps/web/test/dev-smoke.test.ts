import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_WEB_SMOKE_HEALTH_PATH,
  isHostedWebSmokeArtifactFresh,
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

test("hosted web smoke falls back to the local database url when none is configured", () => {
  const environment = createEnv({});
  delete environment.DATABASE_URL;
  delete environment.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  delete environment.HOSTED_CONTACT_PRIVACY_KEYS;
  delete environment.HOSTED_WEB_ENCRYPTION_KEY;
  delete environment.HOSTED_WEB_ENCRYPTION_KEY_VERSION;
  delete environment.HOSTED_WAKE_ENCRYPTION_KEY;
  delete environment.HOSTED_WAKE_ENCRYPTION_KEY_VERSION;
  delete environment.NEXT_PUBLIC_PRIVY_APP_ID;
  const smokeEnv = createHostedWebSmokeEnvironment(environment);

  assert.equal(
    smokeEnv.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
  );
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION, "v1");
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_KEYS, "v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
  assert.equal(smokeEnv.HOSTED_WEB_ENCRYPTION_KEY, "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
  assert.equal(smokeEnv.HOSTED_WEB_ENCRYPTION_KEY_VERSION, "v1");
  assert.equal(smokeEnv.HOSTED_WAKE_ENCRYPTION_KEY, "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
  assert.equal(smokeEnv.HOSTED_WAKE_ENCRYPTION_KEY_VERSION, "v1");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID, "cm_app_smoke_placeholder1");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID?.length, 25);
});

test("hosted web smoke preserves an existing database url", () => {
  const smokeEnv = createHostedWebSmokeEnvironment(createEnv({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/murph_test",
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v9",
    HOSTED_CONTACT_PRIVACY_KEYS: "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    HOSTED_WEB_ENCRYPTION_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    HOSTED_WEB_ENCRYPTION_KEY_VERSION: "v8",
    HOSTED_WAKE_ENCRYPTION_KEY: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "v7",
    NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_real",
  }));

  assert.equal(smokeEnv.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:1/murph_test");
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION, "v9");
  assert.equal(smokeEnv.HOSTED_CONTACT_PRIVACY_KEYS, "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(smokeEnv.HOSTED_WEB_ENCRYPTION_KEY, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(smokeEnv.HOSTED_WEB_ENCRYPTION_KEY_VERSION, "v8");
  assert.equal(smokeEnv.HOSTED_WAKE_ENCRYPTION_KEY, "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC");
  assert.equal(smokeEnv.HOSTED_WAKE_ENCRYPTION_KEY_VERSION, "v7");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID, "cm_app_real");
});
