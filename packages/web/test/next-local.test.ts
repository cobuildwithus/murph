import assert from "node:assert/strict";

import { test } from "vitest";

import { buildNextCliArgs, isBlockedDotEnvPath } from "../scripts/next-local";

test("buildNextCliArgs forces localhost for dev and start", () => {
  assert.deepEqual(buildNextCliArgs(["dev"]), ["dev", "--hostname", "127.0.0.1", "--webpack"]);
  assert.deepEqual(buildNextCliArgs(["start"]), ["start", "--hostname", "127.0.0.1"]);
  assert.deepEqual(buildNextCliArgs(["start", "--hostname", "localhost"]), [
    "start",
    "--hostname",
    "localhost",
  ]);
});

test("buildNextCliArgs preserves explicit bundler flags", () => {
  assert.deepEqual(buildNextCliArgs(["build"]), ["build", "--webpack"]);
  assert.deepEqual(buildNextCliArgs(["dev", "--turbopack"]), [
    "dev",
    "--hostname",
    "127.0.0.1",
    "--turbopack",
  ]);
});

test("isBlockedDotEnvPath matches .env and .env.* files only", () => {
  assert.equal(isBlockedDotEnvPath("/tmp/.env"), true);
  assert.equal(isBlockedDotEnvPath("/tmp/.env.local"), true);
  assert.equal(isBlockedDotEnvPath("/tmp/not-env"), false);
  assert.equal(isBlockedDotEnvPath("/tmp/config.env"), false);
});
