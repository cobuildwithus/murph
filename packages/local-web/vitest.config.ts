import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveLocalWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  oxc: {
    jsx: {
      importSource: "react",
      runtime: "automatic",
    },
  },
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(resolveLocalWebWorkspaceSourceEntries(packageDir)),
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "local-web",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["packages/local-web/test/**/*.test.ts"],
  },
});
