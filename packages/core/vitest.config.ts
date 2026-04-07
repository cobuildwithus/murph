import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "./src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

export default defineConfig({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "core",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "custom",
      customProviderModule: "../../config/vitest-coverage-provider.ts",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "src/constants.ts",
        "src/ids.ts",
        "src/jsonl.ts",
        "src/mutations.ts",
        "src/raw.ts",
        "src/vault-core-document.ts",
        "src/vault-metadata.ts",
        "src/vault-upgrade.ts",
        "src/vault.ts",
      ],
      exclude: [
        "coverage/**",
        "dist/**",
        "**/*.d.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
      reportOnFailure: true,
    },
  },
});
