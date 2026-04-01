import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES,
  LOCAL_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES,
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
  resolveLocalWebWorkspaceSourceEntries,
} from "../../../config/workspace-source-resolution";

test("createVitestWorkspaceRuntimeAliases maps package roots and subpaths to workspace sources", () => {
  const aliases = createVitestWorkspaceRuntimeAliases({
    "@murphai/query": "/repo/packages/query/src/index.ts",
  });

  assert.deepEqual(aliases, [
    {
      find: /^@murphai\/query$/,
      replacement: "/repo/packages/query/src/index.ts",
    },
    {
      find: /^@murphai\/query\/(.+)$/,
      replacement: "/repo/packages/query/src/$1",
    },
  ]);
});

test("workspace source resolution keeps the hosted and local web package allowlists exact", () => {
  assert.deepEqual(HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES, [
    "@murphai/contracts",
    "@murphai/hosted-execution",
    "@murphai/runtime-state",
    "@murphai/core",
    "@murphai/importers",
    "@murphai/inboxd",
    "@murphai/device-syncd",
  ]);
  assert.deepEqual(LOCAL_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES, [
    "@murphai/contracts",
    "@murphai/device-syncd",
    "@murphai/hosted-execution",
    "@murphai/runtime-state",
    "@murphai/query",
  ]);
});

test("workspace source resolution does not widen beyond the explicit hosted/local package sets", () => {
  const hostedEntries = resolveHostedWebWorkspaceSourceEntries("/repo/apps/web");
  const localEntries = resolveLocalWebWorkspaceSourceEntries("/repo/packages/local-web");

  assert.deepEqual(Object.keys(hostedEntries).sort(), [...HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES].sort());
  assert.deepEqual(Object.keys(localEntries).sort(), [...LOCAL_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES].sort());

  assert.equal("@murphai/query" in hostedEntries, false);
  assert.equal("@murphai/core" in localEntries, false);
  assert.equal("@murphai/runtime-state" in localEntries, true);
});
