import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  resolveMurphVitestConcurrency,
  resolveMurphVitestMaxWorkers,
} from "../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../config/vitest-timeouts.js";
import { murphVitestTempGlobalSetup } from "../config/vitest-temp-lifecycle.js";
import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../config/workspace-source-resolution.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostedWebAppDir = path.join(repoRoot, "apps", "web");
const workspaceRuntimeEntries = {
  ...resolveHostedWebWorkspaceSourceEntries(hostedWebAppDir),
  "@murphai/operator-config": path.join(repoRoot, "packages", "operator-config", "package.json"),
};

export default defineConfig({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      workspaceRuntimeEntries,
    ),
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "repo-tools",
    environment: "node",
    globalSetup: [murphVitestTempGlobalSetup],
    ...resolveMurphVitestConcurrency(),
    maxWorkers: resolveMurphVitestMaxWorkers(),
    include: ["scripts/**/*.test.ts"],
    exclude: ["scripts/murph-age/**/*.test.ts"],
  },
});
