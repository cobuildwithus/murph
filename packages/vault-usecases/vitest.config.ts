import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from "../../config/vitest-coverage.js";
import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/health-commons": "../health-commons/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/operator-config": "../operator-config/package.json",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));

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
  coverage: createMurphVitestCoverage({
    customProviderModule: resolveMurphVitestCoverageProviderModule(PACKAGE_DIR),
    include: ["src/**/*.ts"],
    thresholds: {
      perFile: false,
      lines: 54,
      functions: 59,
      branches: 47,
      statements: 54,
    },
  }),
});
