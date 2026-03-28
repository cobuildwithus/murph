import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveLocalWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
    environment: "node",
    fileParallelism: false,
    include: ["packages/web/test/**/*.test.ts"],
  },
});
