import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@healthybob/contracts": "../contracts/src/index.ts",
  "@healthybob/core": "../core/src/index.ts",
  "@healthybob/inboxd": "../inboxd/src/index.ts",
  "@healthybob/parsers": "./src/index.ts",
} as const;

export default defineConfig({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["packages/parsers/test/**/*.test.ts"],
  },
});
