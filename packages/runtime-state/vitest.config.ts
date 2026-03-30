import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murph/runtime-state": "./src/index.ts",
} as const;

export default defineProject({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    name: "runtime-state",
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
