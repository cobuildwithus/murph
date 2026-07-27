import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestStandardTimeouts } from "../../config/vitest-timeouts.js";
import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";

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
    ...murphVitestStandardTimeouts,
    name: "hosted-web",
    environment: "node",
    globalSetup: [murphVitestTempGlobalSetup],
    ...resolveMurphVitestConcurrency(),
    include: ["apps/web/test/**/*.test.ts", "apps/web/test/**/*.test.tsx"],
    setupFiles: [path.join(appDir, "test", "setup-env.ts")],
  },
});
