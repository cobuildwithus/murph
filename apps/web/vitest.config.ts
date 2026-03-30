import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineProject({
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
    name: "hosted-web",
    environment: "node",
    fileParallelism: false,
    include: ["apps/web/test/**/*.test.ts"],
  },
});
