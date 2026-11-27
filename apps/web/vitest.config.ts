import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import { resolveMurphAppVitestMaxWorkers, resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";
import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineProject({
  root: repoRoot,
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(repoRoot, "apps/web"),
      },
      ...createVitestWorkspaceRuntimeAliases({
        ...resolveHostedWebWorkspaceSourceEntries(appDir),
        // The clinical connector fixture runs the mailbox owner in this Vitest project.
        "@murphai/assistant-engine": path.resolve(repoRoot, "packages/assistant-engine/src/index.ts"),
        "@murphai/inbox-services": path.resolve(repoRoot, "packages/inbox-services/src/index.ts"),
        "@murphai/recap-video": path.resolve(repoRoot, "packages/recap-video/src/index.ts"),
        "@murphai/vault-usecases": path.resolve(repoRoot, "packages/vault-usecases/package.json"),
      }),
    ],
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "hosted-web",
    environment: "node",
    globalSetup: [murphVitestTempGlobalSetup],
    ...resolveMurphVitestConcurrency(),
    maxWorkers: resolveMurphAppVitestMaxWorkers(),
    include: [
      "apps/web/test/**/*.test.ts",
      "apps/web/test/**/*.test.tsx",
      "apps/web/src/lib/health-wins/**/*.test.ts",
      "apps/web/src/lib/health-you/**/*.test.ts",
      "apps/web/src/lib/health-profile/**/*.test.ts",
    ],
    setupFiles: [path.join(appDir, "test", "setup-env.ts")],
  },
});
