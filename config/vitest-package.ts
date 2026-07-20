import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type TestUserConfig } from "vitest/config";

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from "./vitest-coverage.js";
import {
  resolveMurphVitestConcurrency,
  resolveMurphVitestMaxWorkers,
} from "./vitest-parallelism.js";
import { murphVitestNoTimeouts } from "./vitest-timeouts.js";
import { murphVitestTempGlobalSetup } from "./vitest-temp-lifecycle.js";
import { createVitestAliasesFromTsconfigPaths } from "./workspace-source-resolution.js";

type MurphVitestTestOptions = Omit<
  TestUserConfig,
  "name" | "environment" | "include" | "coverage"
>;

export interface MurphPackageVitestConfigInput {
  configUrl: string;
  name: string;
  rootRelativePath?: string;
  coverage?: ReturnType<typeof createMurphVitestCoverage>;
  coverageInclude?: readonly string[];
  coverageExclude?: readonly string[];
  include?: readonly string[];
  useDefaultConcurrency?: boolean;
  useDefaultTimeouts?: boolean;
  test?: MurphVitestTestOptions;
}

export function createMurphPackageVitestConfig(input: MurphPackageVitestConfigInput) {
  const packageDir = path.dirname(fileURLToPath(input.configUrl));
  const aliases = createVitestAliasesFromTsconfigPaths({
    workspaceDir: packageDir,
    specifierFilter: isWorkspaceSourceSpecifier,
  });

  return defineConfig({
    ...(input.rootRelativePath
      ? { root: path.resolve(packageDir, input.rootRelativePath) }
      : {}),
    ...(aliases.length > 0 ? { resolve: { alias: aliases } } : {}),
    test: {
      ...(input.useDefaultTimeouts === false ? {} : murphVitestNoTimeouts),
      name: input.name,
      environment: "node",
      ...(input.useDefaultConcurrency === false ? {} : resolveMurphVitestConcurrency()),
      maxWorkers: resolveMurphVitestMaxWorkers(),
      globalSetup: [murphVitestTempGlobalSetup],
      include: [...(input.include ?? ["test/**/*.test.ts"])],
      ...(input.test ?? {}),
      coverage:
        input.coverage ??
        createMurphVitestCoverage({
          customProviderModule: resolveMurphVitestCoverageProviderModule(packageDir),
          include: [...(input.coverageInclude ?? ["src/**/*.ts"])],
          ...(input.coverageExclude ? { exclude: [...input.coverageExclude] } : {}),
        }),
    },
  });
}

function isWorkspaceSourceSpecifier(specifier: string): boolean {
  return specifier === "murph" || specifier.startsWith("@murphai/");
}
