import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createVitestWorkspaceRuntimeAliases } from "../../config/workspace-source-resolution";
import { resolveWorkspaceSourceEntries } from "./next.config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(repoRoot, "apps/web"),
      },
      ...createVitestWorkspaceRuntimeAliases(resolveWorkspaceSourceEntries(appDir)),
    ],
  },
  test: {
    environment: "node",
    include: ["apps/web/test/**/*.test.ts"],
  },
});
