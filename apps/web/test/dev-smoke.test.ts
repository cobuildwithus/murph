import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveHostedWebSmokeDevCommand } from "../scripts/dev-smoke";
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

test("hosted web smoke falls back to the local database url when none is configured", () => {
  const environment = createEnv({});
  delete environment.DATABASE_URL;
  delete environment.NEXT_PUBLIC_PRIVY_APP_ID;
  const smokeEnv = createHostedWebSmokeEnvironment(environment);

  assert.equal(
    smokeEnv.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
  );
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID, "cm_app_smoke");
});

test("hosted web smoke preserves an existing database url", () => {
  const smokeEnv = createHostedWebSmokeEnvironment(createEnv({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/murph_test",
    NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_real",
  }));

  assert.equal(smokeEnv.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:1/murph_test");
  assert.equal(smokeEnv.NEXT_PUBLIC_PRIVY_APP_ID, "cm_app_real");
});
