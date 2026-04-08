import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from "../../config/vitest-coverage.js";
import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";
import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/gateway-local": "./src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/src/index.ts",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

const runtimeAliases = createVitestWorkspaceRuntimeAliases(
  resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
)

runtimeAliases.push({
  find: /^@murphai\/runtime-state\/node$/,
  replacement: path.resolve(packageDir, "../runtime-state/src/node/index.ts"),
})

export default defineProject({
  resolve: {
    alias: runtimeAliases,
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "gateway-local",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["test/**/*.test.ts"],
    coverage: createMurphVitestCoverage({
      customProviderModule: resolveMurphVitestCoverageProviderModule(packageDir),
      include: ["src/shared.ts", "src/store/permissions.ts"],
    }),
  },
});
