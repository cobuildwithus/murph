import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, defineProject } from "vitest/config";

import {
  resolveMurphVitestConcurrency,
  resolveMurphVitestMaxWorkers,
} from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";
import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const cliVitestConcurrency = resolveMurphVitestConcurrency();
const cliVitestMaxWorkers = resolveMurphVitestMaxWorkers();
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistantd": "../assistantd/src/index.ts",
  "@murphai/assistant-core": "../assistant-core/src/index.ts",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/gateway-local": "../gateway-local/src/index.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
  murph: "./src/index.ts",
} as const;
const cliVitestRuntimeAliases = createVitestWorkspaceRuntimeAliases(
  resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
);

type CliVitestProjectSpec = {
  readonly env?: Record<string, string>;
  readonly name: string;
  readonly fileNames: readonly string[];
};

function cliTestFile(fileName: string): string {
  return path.join(packageDir, "test", fileName);
}

export function createCliVitestProject(name: string, fileNames: readonly string[]) {
  const spec = cliVitestProjectSpecs.find((projectSpec) => projectSpec.name === name)

  return defineProject({
    resolve: {
      alias: cliVitestRuntimeAliases,
    },
    test: {
      ...murphVitestNoTimeouts,
      name,
      environment: "node",
      ...cliVitestConcurrency,
      env: spec?.env,
      include: fileNames.map(cliTestFile),
    },
  });
}

export const cliVitestProjectSpecs: readonly CliVitestProjectSpec[] = [
  {
    name: "cli-health-tail",
    fileNames: [
      "health-tail.test.ts",
      "health-descriptors.test.ts",
    ],
  },
  {
    name: "cli-read-model",
    fileNames: [
      "search-runtime.test.ts",
      "list-cursor-compat.test.ts",
      "runtime.test.ts",
      "selector-filter-normalization.test.ts",
      "stdin-input.test.ts",
      "canonical-mutation-boundary.test.ts",
      "canonical-write-lock.test.ts",
      "canonical-write-source-audit.test.ts",
      "json-input.test.ts",
      "record-mutations.test.ts",
      "vault-usecase-helpers.test.ts",
    ],
  },
  {
    name: "cli-schemas-smoke",
    fileNames: [
      "incur-smoke.test.ts",
      "inbox-incur-smoke.test.ts",
      "cli-test-helpers.test.ts",
      "release-script-coverage-audit.test.ts",
      "release-workflow-guards.test.ts",
      "assistant-cli-access.test.ts",
      "assistant-chat-theme.test.ts",
      "device-cli.test.ts",
    ],
  },
  {
    name: "cli-assistant",
    env: {
      MURPH_CLI_TEST_PERSISTENT_HARNESS: "0",
    },
    fileNames: [
      "assistant-cli.test.ts",
      "assistant-runtime.test.ts",
      "assistant-service.test.ts",
      "assistant-channel.test.ts",
      "assistant-cron.test.ts",
      "assistant-state.test.ts",
      "assistant-observability.test.ts",
      "assistant-robustness.test.ts",
      "assistant-provider.test.ts",
      "assistant-daemon-client.test.ts",
      "assistant-codex.test.ts",
      "assistant-harness.test.ts",
      "assistant-memory-boundaries.test.ts",
      "assistant-runtime-state-service.test.ts",
      "assistant-core-facades.test.ts",
      "assistant-web-search.test.ts",
      "research-runtime.test.ts",
    ],
  },
  {
    name: "cli-expansions",
    fileNames: [
      "cli-expansion-workout.test.ts",
      "cli-expansion-intervention.test.ts",
      "cli-expansion-provider-event-samples.test.ts",
      "cli-expansion-samples-audit.test.ts",
      "cli-expansion-document-meal.test.ts",
      "cli-expansion-experiment-journal-vault.test.ts",
      "cli-expansion-experiment-journal-vault-phase2.test.ts",
      "cli-expansion-export-intake.test.ts",
    ],
  },
  {
    name: "cli-inbox-setup",
    fileNames: [
      "setup-cli.test.ts",
      "setup-channels.test.ts",
      "inbox-cli.test.ts",
      "inbox-model-harness.test.ts",
      "inbox-model-route.test.ts",
      "inbox-service-boundaries.test.ts",
      "cli-expansion-inbox-attachments.test.ts",
      "gateway-core.test.ts",
      "gateway-local-service.test.ts",
      "device-daemon.test.ts",
      "device-sync-client.test.ts",
    ],
  },
];

export const cliVitestProjects = cliVitestProjectSpecs.map(({ name, fileNames }) =>
  createCliVitestProject(name, fileNames),
);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: cliVitestMaxWorkers,
    projects: cliVitestProjects,
  },
});
