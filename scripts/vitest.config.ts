import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../config/vitest-timeouts.js";
import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../config/workspace-source-resolution.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostedWebAppDir = path.join(repoRoot, "apps", "web");

export default defineConfig({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveHostedWebWorkspaceSourceEntries(hostedWebAppDir),
    ),
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "repo-tools",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["scripts/**/*.test.ts"],
  },
});
