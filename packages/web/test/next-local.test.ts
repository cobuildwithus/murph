import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import {
  buildNextCliArgs,
  isBlockedDotEnvPath,
  resolveQueryBuildEntryPath,
  shouldEnsureQueryBuild,
} from "../scripts/next-local";

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

test("shouldEnsureQueryBuild only targets commands that boot the local app runtime", () => {
  assert.equal(shouldEnsureQueryBuild("dev"), true);
  assert.equal(shouldEnsureQueryBuild("build"), true);
  assert.equal(shouldEnsureQueryBuild("start"), true);
  assert.equal(shouldEnsureQueryBuild("lint"), false);
});

test("resolveQueryBuildEntryPath points at the query package build output", () => {
  assert.equal(
    resolveQueryBuildEntryPath("/repo/packages/web"),
    path.resolve("/repo/packages/query/dist/index.js"),
  );
});
