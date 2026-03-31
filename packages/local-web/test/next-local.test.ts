import assert from "node:assert/strict";

import { test } from "vitest";

import { isBlockedDotEnvPath } from "../scripts/next-local";

test("isBlockedDotEnvPath matches .env and .env.* files only", () => {
  assert.equal(isBlockedDotEnvPath("/tmp/.env"), true);
  assert.equal(isBlockedDotEnvPath("/tmp/.env.local"), true);
  assert.equal(isBlockedDotEnvPath("/tmp/not-env"), false);
  assert.equal(isBlockedDotEnvPath("/tmp/config.env"), false);
});

test("isBlockedDotEnvPath also handles URL and Uint8Array paths", () => {
  assert.equal(isBlockedDotEnvPath(new URL("file:///tmp/.env.production")), true);
  assert.equal(isBlockedDotEnvPath(new TextEncoder().encode("/tmp/.env.test")), true);
});

test("next-local stays focused on env guards", () => {
  assert.equal(typeof isBlockedDotEnvPath, "function");
});
