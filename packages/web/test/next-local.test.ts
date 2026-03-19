import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import {
  buildNextCliArgs,
  isBlockedDotEnvPath,
  resolveRuntimeBuildTargets,
  resolveQueryBuildEntryPath,
  shouldEnsureRuntimeBuild,
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

test("shouldEnsureRuntimeBuild only targets commands that boot the local app runtime", () => {
  assert.equal(shouldEnsureRuntimeBuild("dev"), true);
  assert.equal(shouldEnsureRuntimeBuild("build"), true);
  assert.equal(shouldEnsureRuntimeBuild("start"), true);
  assert.equal(shouldEnsureRuntimeBuild("lint"), false);
});

test("resolveQueryBuildEntryPath points at the query package build output", () => {
  assert.equal(
    resolveQueryBuildEntryPath("/repo/packages/web"),
    path.resolve("/repo/packages/query/dist/index.js"),
  );
});

test("resolveRuntimeBuildTargets includes the query runtime dependency closure", () => {
  assert.deepEqual(resolveRuntimeBuildTargets("/repo/packages/web"), [
    {
      buildDir: "../contracts",
      entryPath: path.resolve("/repo/packages/contracts/dist/index.js"),
      packageName: "@healthybob/contracts",
      requiredPaths: [path.resolve("/repo/packages/contracts/dist/index.js")],
    },
    {
      buildDir: "../runtime-state",
      entryPath: path.resolve("/repo/packages/runtime-state/dist/index.js"),
      packageName: "@healthybob/runtime-state",
      requiredPaths: [path.resolve("/repo/packages/runtime-state/dist/index.js")],
    },
    {
      buildDir: "../query",
      entryPath: path.resolve("/repo/packages/query/dist/index.js"),
      packageName: "@healthybob/query",
      requiredPaths: [
        path.resolve("/repo/packages/query/dist/index.js"),
        path.resolve("/repo/packages/query/dist/canonical-entities.js"),
        path.resolve("/repo/packages/query/dist/export-pack.js"),
        path.resolve("/repo/packages/query/dist/export-pack-health.js"),
        path.resolve("/repo/packages/query/dist/health-library.js"),
        path.resolve("/repo/packages/query/dist/health/canonical-collector.js"),
        path.resolve("/repo/packages/query/dist/health/comparators.js"),
        path.resolve("/repo/packages/query/dist/health/loaders.js"),
        path.resolve("/repo/packages/query/dist/health/shared.js"),
      ],
    },
  ]);
});
