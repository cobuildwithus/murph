import path from "node:path";

import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/operator-config": "../operator-config/package.json",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;
export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "vault-usecases",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  extraAliases: ({ packageDir }) => [
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
  ],
  coverageInclude: [
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
    "src/health-registry-command-metadata.ts",
    "src/health-registry-families.ts",
    "src/health-cli-method-types.ts",
    "src/commands/command-helpers.ts",
    "src/commands/query-record-command-helpers.ts",
    "src/usecases/runtime.ts",
    "src/usecases/shared.ts",
    "src/usecases/text-duration.ts",
    "src/usecases/vault-usecase-helpers.ts",
    "src/usecases/capture.ts",
    "src/captures.ts",
    "src/usecases/workout-model.ts",
  ],
});
