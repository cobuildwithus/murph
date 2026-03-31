import assistantRuntimeProject from "./packages/assistant-runtime/vitest.config.ts";
import assistantdProject from "./packages/assistantd/vitest.config.ts";
import coreProject from "./packages/core/vitest.config.ts";
import deviceSyncdProject from "./packages/device-syncd/vitest.config.ts";
import hostedExecutionProject from "./packages/hosted-execution/vitest.config.ts";
import importersProject from "./packages/importers/vitest.config.ts";
import inboxdProject from "./packages/inboxd/vitest.config.ts";
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

const ROOT_REPO_CLI_INCLUDE = new Set([
  "packages/cli/test/health-descriptors.test.ts",
  "packages/cli/test/health-tail.test.ts",
  "packages/cli/test/canonical-write-lock.test.ts",
  "packages/cli/test/canonical-write-source-audit.test.ts",
  "packages/cli/test/assistant-harness.test.ts",
  "packages/cli/test/assistant-state.test.ts",
  "packages/cli/test/assistant-provider.test.ts",
  "packages/cli/test/assistant-codex.test.ts",
  "packages/cli/test/assistant-daemon-client.test.ts",
  "packages/cli/test/assistant-cli-access.test.ts",
  "packages/cli/test/assistant-channel.test.ts",
  "packages/cli/test/assistant-chat-theme.test.ts",
  "packages/cli/test/assistant-runtime.test.ts",
  "packages/cli/test/assistant-cli.test.ts",
  "packages/cli/test/assistant-observability.test.ts",
  "packages/cli/test/assistant-robustness.test.ts",
  "packages/cli/test/assistant-service.test.ts",
  "packages/cli/test/device-daemon.test.ts",
  "packages/cli/test/device-sync-client.test.ts",
  "packages/cli/test/json-input.test.ts",
  "packages/cli/test/incur-smoke.test.ts",
  "packages/cli/test/canonical-mutation-boundary.test.ts",
  "packages/cli/test/inbox-incur-smoke.test.ts",
  "packages/cli/test/inbox-cli.test.ts",
  "packages/cli/test/inbox-model-harness.test.ts",
  "packages/cli/test/inbox-model-route.test.ts",
  "packages/cli/test/list-cursor-compat.test.ts",
  "packages/cli/test/cli-expansion-export-intake.test.ts",
  "packages/cli/test/cli-expansion-workout.test.ts",
  "packages/cli/test/runtime.test.ts",
  "packages/cli/test/search-runtime.test.ts",
  "packages/cli/test/setup-channels.test.ts",
  "packages/cli/test/setup-cli.test.ts",
  "packages/cli/test/selector-filter-normalization.test.ts",
  "packages/cli/test/stdin-input.test.ts",
  "packages/cli/test/vault-usecase-helpers.test.ts",
  "packages/cli/test/release-script-coverage-audit.test.ts",
  "packages/cli/test/release-workflow-guards.test.ts",
]);

const ROOT_REPO_PROJECTS: RootRepoProject[] = [
  {
    config: assistantRuntimeProject,
    include: [
      "packages/assistant-runtime/test/assistant-core-boundary.test.ts",
      "packages/assistant-runtime/test/hosted-email-route.test.ts",
      "packages/assistant-runtime/test/hosted-runtime-usage.test.ts",
    ],
  },
  {
    config: assistantdProject,
    include: [
      "packages/assistantd/test/assistant-core-boundary.test.ts",
      "packages/assistantd/test/http.test.ts",
    ],
  },
  {
    config: coreProject,
    include: [
      "packages/core/test/canonical-mutations-boundary.test.ts",
      "packages/core/test/core.test.ts",
      "packages/core/test/device-import.test.ts",
      "packages/core/test/health-bank.test.ts",
      "packages/core/test/profile.test.ts",
      "packages/core/test/share-pack.test.ts",
      "packages/core/test/health-history-family.test.ts",
      "packages/core/test/ids.test.ts",
    ],
  },
  {
    config: deviceSyncdProject,
    include: [
      "packages/device-syncd/test/config.test.ts",
      "packages/device-syncd/test/http.test.ts",
      "packages/device-syncd/test/oura-provider.test.ts",
      "packages/device-syncd/test/public-ingress.test.ts",
      "packages/device-syncd/test/oura-webhooks.test.ts",
      "packages/device-syncd/test/service.test.ts",
      "packages/device-syncd/test/shared-ids.test.ts",
      "packages/device-syncd/test/whoop-provider.test.ts",
    ],
  },
  {
    config: hostedExecutionProject,
    include: ["packages/hosted-execution/test/hosted-execution.test.ts"],
  },
  {
    config: importersProject,
    include: [
      "packages/importers/test/device-providers.test.ts",
      "packages/importers/test/importers.test.ts",
      "packages/importers/test/input-validation.test.ts",
    ],
  },
  {
    config: inboxdProject,
    include: [
      "packages/inboxd/test/connectors-daemon.test.ts",
      "packages/inboxd/test/email-connector.test.ts",
      "packages/inboxd/test/idempotency-rebuild.test.ts",
      "packages/inboxd/test/inboxd.test.ts",
      "packages/inboxd/test/shared-ids.test.ts",
    ],
  },
  {
    config: parsersProject,
    include: ["packages/parsers/test/parsers.test.ts"],
  },
  {
    config: queryProject,
    include: [
      "packages/query/test/health-registry-definitions.test.ts",
      "packages/query/test/health-tail.test.ts",
      "packages/query/test/query.test.ts",
    ],
  },
  {
    config: runtimeStateProject,
    include: [
      "packages/runtime-state/test/hosted-bundle.test.ts",
      "packages/runtime-state/test/assistant-usage.test.ts",
      "packages/runtime-state/test/hosted-execution-reexport.test.ts",
      "packages/runtime-state/test/hosted-user-env.test.ts",
      "packages/runtime-state/test/ulid.test.ts",
    ],
  },
];

const rootRepoCliProjects = cliVitestProjectSpecs
  .map(({ fileNames, name }) => {
    const filteredFileNames = fileNames.filter((fileName) =>
      ROOT_REPO_CLI_INCLUDE.has(`packages/cli/test/${fileName}`),
    );

    if (filteredFileNames.length === 0) {
      return null;
    }

    return createCliVitestProject(name, filteredFileNames);
  })
  .filter((project): project is UserWorkspaceConfig => project !== null);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: rootRepoVitestMaxWorkers,
    coverage: {
      enabled: true,
      provider: "v8",
      clean: true,
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "packages/core/src/constants.ts",
        "packages/core/src/ids.ts",
        "packages/core/src/jsonl.ts",
        "packages/core/src/mutations.ts",
        "packages/core/src/raw.ts",
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
    // packages/local-web, apps/web, and apps/cloudflare stay in their dedicated
    // verify lanes so the root multi-project run does not execute them twice.
    projects: [
      ...ROOT_REPO_PROJECTS.map(({ config, include }) =>
        mergeConfig(
          config,
          defineProject({
            test: {
              ...rootRepoVitestConcurrency,
              include,
            },
          }),
        ),
      ),
      ...rootRepoCliProjects,
    ],
  },
});
