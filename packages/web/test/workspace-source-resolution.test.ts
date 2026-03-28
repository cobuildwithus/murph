import assert from "node:assert/strict";

import { test } from "vitest";

import { createVitestWorkspaceRuntimeAliases } from "../../../config/workspace-source-resolution";

test("createVitestWorkspaceRuntimeAliases maps package roots and subpaths to workspace sources", () => {
  const aliases = createVitestWorkspaceRuntimeAliases({
    "@murph/query": "/repo/packages/query/src/index.ts",
  });

  assert.deepEqual(aliases, [
    {
      find: /^@murph\/query$/,
      replacement: "/repo/packages/query/src/index.ts",
    },
    {
      find: /^@murph\/query\/(.+)$/,
      replacement: "/repo/packages/query/src/$1",
    },
  ]);
});
