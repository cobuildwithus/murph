import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildNextCliArgs,
  isBlockedDotEnvPath,
} from "../scripts/next-local";

test("buildNextCliArgs leaves host selection unchanged for dev and start", () => {
  assert.deepEqual(buildNextCliArgs(["dev"]), ["dev", "--webpack"]);
  assert.deepEqual(buildNextCliArgs(["start"]), ["start"]);
  assert.deepEqual(buildNextCliArgs(["start", "--hostname", "localhost"]), [
    "start",
    "--hostname",
    "localhost",
  ]);
});

test("buildNextCliArgs preserves explicit bundler flags", () => {
  assert.deepEqual(buildNextCliArgs(["build"]), ["build", "--webpack"]);
  assert.deepEqual(buildNextCliArgs(["dev", "--turbopack"]), ["dev", "--turbopack"]);
});

test("isBlockedDotEnvPath matches .env and .env.* files only", () => {
  assert.equal(isBlockedDotEnvPath("/tmp/.env"), true);
  assert.equal(isBlockedDotEnvPath("/tmp/.env.local"), true);
  assert.equal(isBlockedDotEnvPath("/tmp/not-env"), false);
  assert.equal(isBlockedDotEnvPath("/tmp/config.env"), false);
});

test("next-local stays focused on Next CLI argument normalization and env guards", () => {
  assert.equal(typeof buildNextCliArgs, "function");
  assert.equal(typeof isBlockedDotEnvPath, "function");
});
