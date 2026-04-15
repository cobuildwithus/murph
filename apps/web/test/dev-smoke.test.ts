import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveHostedWebSmokeDevCommand } from "../scripts/dev-smoke";

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
