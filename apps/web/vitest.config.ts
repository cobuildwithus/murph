import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(repoRoot, "apps/web"),
      },
      ...createVitestWorkspaceRuntimeAliases(resolveHostedWebWorkspaceSourceEntries(appDir)),
    ],
  },
  test: {
    environment: "node",
    include: ["apps/web/test/**/*.test.ts"],
  },
});
