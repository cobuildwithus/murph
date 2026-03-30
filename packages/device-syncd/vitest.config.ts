import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murph/contracts": "../contracts/src/index.ts",
  "@murph/core": "../core/src/index.ts",
  "@murph/device-syncd": "./src/index.ts",
  "@murph/importers": "../importers/src/index.ts",
  "@murph/runtime-state": "../runtime-state/src/index.ts",
} as const;

export default defineProject({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    name: "device-syncd",
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
