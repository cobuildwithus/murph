import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/operator-config": "../operator-config/src/index.ts",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;
const selfAliases = [
  {
    find: /^@murphai\/vault-usecases$/,
    replacement: path.resolve(packageDir, "./src/index.ts"),
  },
  {
    find: /^@murphai\/vault-usecases\/helpers$/,
    replacement: path.resolve(packageDir, "./src/helpers.ts"),
  },
  {
    find: /^@murphai\/vault-usecases\/records$/,
    replacement: path.resolve(packageDir, "./src/records.ts"),
  },
  {
    find: /^@murphai\/vault-usecases\/runtime$/,
    replacement: path.resolve(packageDir, "./src/runtime.ts"),
  },
  {
    find: /^@murphai\/vault-usecases\/testing$/,
    replacement: path.resolve(packageDir, "./src/testing.ts"),
  },
  {
    find: /^@murphai\/vault-usecases\/vault-services$/,
    replacement: path.resolve(packageDir, "./src/vault-services.ts"),
  },
  {
    find: /^@murphai\/vault-usecases\/workouts$/,
    replacement: path.resolve(packageDir, "./src/workouts.ts"),
  },
];

export default defineConfig({
  resolve: {
    alias: [
      ...createVitestWorkspaceRuntimeAliases(
        resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
      ),
      ...selfAliases,
    ],
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "vault-usecases",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["test/**/*.test.ts"],
    coverage: createMurphVitestCoverage({
      customProviderModule: resolveMurphVitestCoverageProviderModule(packageDir),
      include: [
        "src/index.ts",
        "src/helpers.ts",
        "src/json-input.ts",
        "src/option-utils.ts",
        "src/query-runtime.ts",
        "src/record-metadata.ts",
        "src/runtime-errors.ts",
        "src/runtime.ts",
        "src/records.ts",
        "src/testing.ts",
        "src/vault-services.ts",
        "src/workouts.ts",
        "src/health-cli-descriptors.ts",
        "src/health-cli-method-types.ts",
        "src/commands/command-helpers.ts",
        "src/commands/query-record-command-helpers.ts",
        "src/usecases/runtime.ts",
        "src/usecases/shared.ts",
        "src/usecases/text-duration.ts",
        "src/usecases/vault-usecase-helpers.ts",
        "src/usecases/workout-model.ts",
      ],
    }),
  },
});
