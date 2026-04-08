import assistantEngineProject from "./packages/assistant-engine/vitest.config.ts";
import assistantRuntimeProject from "./packages/assistant-runtime/vitest.config.ts";
import assistantdProject from "./packages/assistantd/vitest.config.ts";
import coreProject from "./packages/core/vitest.config.ts";
import deviceSyncdProject from "./packages/device-syncd/vitest.config.ts";
import hostedExecutionProject from "./packages/hosted-execution/vitest.config.ts";
import importersProject from "./packages/importers/vitest.config.ts";
import inboxdProject from "./packages/inboxd/vitest.config.ts";
import messagingIngressProject from "./packages/messaging-ingress/vitest.config.ts";
import {
  cliVitestProjectSpecs,
  createCliVitestProject,
} from "./packages/cli/vitest.workspace.ts";
import parsersProject from "./packages/parsers/vitest.config.ts";
import queryProject from "./packages/query/vitest.config.ts";
import runtimeStateProject from "./packages/runtime-state/vitest.config.ts";
import {
  defineConfig,
  defineProject,
  mergeConfig,
  type UserWorkspaceConfig,
} from "vitest/config";

import {
  resolveMurphVitestConcurrency,
  resolveMurphVitestMaxWorkers,
} from "./config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "./config/vitest-timeouts.js";

const rootRepoVitestConcurrency = resolveMurphVitestConcurrency();
const rootRepoVitestMaxWorkers = resolveMurphVitestMaxWorkers();

type RootRepoProject = {
  config: UserWorkspaceConfig;
  include: string[];
};

const ROOT_REPO_PROJECTS: RootRepoProject[] = [
  {
    config: assistantEngineProject,
    include: ["packages/assistant-engine/test/**/*.test.ts"],
  },
  {
    config: assistantRuntimeProject,
    include: ["packages/assistant-runtime/test/**/*.test.ts"],
  },
  {
    config: assistantdProject,
    include: ["packages/assistantd/test/**/*.test.ts"],
  },
  {
    config: coreProject,
    include: ["packages/core/test/**/*.test.ts"],
  },
  {
    config: deviceSyncdProject,
    include: ["packages/device-syncd/test/**/*.test.ts"],
  },
  {
    config: hostedExecutionProject,
    include: ["packages/hosted-execution/test/**/*.test.ts"],
  },
  {
    config: messagingIngressProject,
    include: ["packages/messaging-ingress/test/**/*.test.ts"],
  },
  {
    config: importersProject,
    include: ["packages/importers/test/**/*.test.ts"],
  },
  {
    config: inboxdProject,
    include: ["packages/inboxd/test/**/*.test.ts"],
  },
  {
    config: parsersProject,
    include: ["packages/parsers/test/**/*.test.ts"],
  },
  {
    config: queryProject,
    include: ["packages/query/test/**/*.test.ts"],
  },
  {
    config: runtimeStateProject,
    include: ["packages/runtime-state/test/**/*.test.ts"],
  },
];

const rootRepoCliProjects = cliVitestProjectSpecs
  .map(({ fileNames, name }) => createCliVitestProject(name, fileNames))
  .filter((project): project is UserWorkspaceConfig => project !== null);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: rootRepoVitestMaxWorkers,
    coverage: {
      enabled: true,
      provider: "custom",
      customProviderModule: "./config/vitest-coverage-provider.ts",
      // The workspace verify lane clears ./coverage once before the root
      // multi-project run. Letting each project clean the shared directory
      // races with sibling projects writing coverage shards into .tmp.
      clean: false,
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "packages/core/src/constants.ts",
        "packages/core/src/ids.ts",
        "packages/core/src/jsonl.ts",
        "packages/core/src/mutations.ts",
        "packages/core/src/raw.ts",
        "packages/core/src/vault-core-document.ts",
        "packages/core/src/vault-metadata.ts",
        "packages/core/src/vault-upgrade.ts",
        "packages/core/src/vault.ts",
        "packages/importers/src/csv-sample-importer.ts",
        "packages/importers/src/document-importer.ts",
        "packages/importers/src/meal-importer.ts",
        "packages/hosted-execution/src/auth.ts",
        "packages/hosted-execution/src/client.ts",
        "packages/hosted-execution/src/contracts.ts",
        "packages/hosted-execution/src/env.ts",
        "packages/hosted-execution/src/routes.ts",
        "packages/query/src/export-pack.ts",
        "packages/query/src/model.ts",
        "packages/query/src/search.ts",
        "packages/query/src/summaries.ts",
        "packages/query/src/timeline.ts",
      ],
      exclude: [
        "coverage/**",
        "dist/**",
        "packages/inboxd/src/**",
        "packages/parsers/src/**",
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
    // apps/web and apps/cloudflare stay in their dedicated verify lanes so the
    // root multi-project run does not execute them twice.
    projects: [
      ...ROOT_REPO_PROJECTS.map(({ config, include }, index) =>
        mergeConfig(
          config,
          defineProject({
            test: {
              ...rootRepoVitestConcurrency,
              include,
              sequence: {
                ...rootRepoVitestConcurrency.sequence,
                groupOrder: index,
              },
            },
          }),
        ),
      ),
      ...rootRepoCliProjects.map((project, index) =>
        mergeConfig(
          project,
          defineProject({
            test: {
              sequence: {
                ...project.test?.sequence,
                groupOrder: ROOT_REPO_PROJECTS.length + index,
              },
            },
          }),
        ),
      ),
    ],
  },
});
