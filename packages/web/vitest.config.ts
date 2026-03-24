import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createVitestWorkspaceRuntimeAliases } from "../../config/workspace-source-resolution";
import { resolveWorkspaceSourceEntries } from "./next.config";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: {
    jsx: {
      importSource: "react",
      runtime: "automatic",
    },
  },
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir),
    ),
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["packages/web/test/**/*.test.ts"],
  },
});
