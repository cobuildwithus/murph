import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from "../../config/vitest-coverage.js";
import {
  resolveMurphVitestConcurrency,
  resolveMurphVitestMaxWorkers,
} from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";
import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";
import {
  resolveVitestBucketFiles,
  type VitestBucketSeed,
} from "../../config/vitest-test-buckets.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const cliVitestConcurrency = resolveMurphVitestConcurrency();
const cliVitestMaxWorkers = resolveMurphVitestMaxWorkers();
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistantd": "../assistantd/src/index.ts",
  "@murphai/assistant-cli": "../assistant-cli/src/index.ts",
  "@murphai/assistant-engine": "../assistant-engine/src/index.ts",
  "@murphai/operator-config": "../operator-config/src/index.ts",
  "@murphai/setup-cli": "../setup-cli/src/index.ts",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/gateway-local": "../gateway-local/src/index.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/inboxd-imessage": "../inboxd-imessage/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/src/index.ts",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
  "@murphai/vault-usecases": "../vault-usecases/src/index.ts",
  murph: "./src/index.ts",
} as const;
const cliVitestRuntimeAliases = createVitestWorkspaceRuntimeAliases(
  resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
);

export const cliVitestCoverage = createMurphVitestCoverage({
  customProviderModule: resolveMurphVitestCoverageProviderModule(packageDir),
  include: [path.resolve(packageDir, "src/**/*.ts")],
  thresholds: {
    perFile: true,
    lines: 83,
    functions: 77,
    branches: 60,
    statements: 83,
  },
});

type CliVitestProjectSpec = {
  readonly env?: Record<string, string>;
  readonly fileParallelism?: boolean;
  readonly name: string;
  readonly fileNames: readonly string[];
};

type CliVitestProjectSeed = Omit<CliVitestProjectSpec, "fileNames"> &
  VitestBucketSeed;

function cliTestFile(fileName: string): string {
  return path.join(packageDir, "test", fileName);
}

export function createCliVitestProject(name: string, fileNames: readonly string[]) {
  const spec = cliVitestProjectSpecs.find((projectSpec) => projectSpec.name === name);

  return defineConfig({
    resolve: {
      alias: cliVitestRuntimeAliases,
    },
    test: {
      ...murphVitestNoTimeouts,
      name,
      environment: "node",
      ...cliVitestConcurrency,
      fileParallelism:
        spec?.fileParallelism ?? cliVitestConcurrency.fileParallelism,
      env: spec?.env,
      include: fileNames.map(cliTestFile),
      coverage: cliVitestCoverage,
    },
  });
}

const cliVitestProjectSeeds: readonly CliVitestProjectSeed[] = [
  {
    name: "cli-health-tail",
    patterns: ["health-*.test.ts"],
  },
  {
    name: "cli-read-model",
    includeRemaining: true,
    patterns: [
      "canonical-*.test.ts",
      "json-input.test.ts",
      "list-surface.test.ts",
      "memory.test.ts",
      "record-mutations.test.ts",
      "runtime.test.ts",
      "search-runtime.test.ts",
      "selector-filter-normalization.test.ts",
      "stdin-input.test.ts",
      "vault-usecase-helpers.test.ts",
    ],
  },
  {
    name: "cli-schemas-smoke",
    includeRemaining: true,
    patterns: [
      "assistant-chat-theme.test.ts",
      "automation.test.ts",
      "cli-entry.test.ts",
      "cli-test-helpers.test.ts",
      "device-cli.test.ts",
      "http-json-retry.test.ts",
      "inbox-incur-smoke.test.ts",
      "incur-smoke.test.ts",
      "knowledge-cli-contracts.test.ts",
      "knowledge-documents.test.ts",
      "release-*.test.ts",
      "wearables-schema.test.ts",
    ],
  },
  {
    name: "cli-assistant",
    env: {
      MURPH_CLI_TEST_PERSISTENT_HARNESS: "0",
    },
    patterns: [
      "assistant-*.test.ts",
      "knowledge-runtime.test.ts",
      "research-runtime.test.ts",
    ],
  },
  {
    name: "cli-expansions",
    patterns: ["cli-expansion-*.test.ts"],
  },
  {
    name: "cli-inbox-setup",
    fileParallelism: false,
    patterns: [
      "cli-expansion-inbox-attachments.test.ts",
      "device-daemon.test.ts",
      "device-sync-client.test.ts",
      "gateway-*.test.ts",
      "inbox-*.test.ts",
      "setup-*.test.ts",
    ],
  },
];

export const cliVitestProjectSpecs: readonly CliVitestProjectSpec[] =
  resolveVitestBucketFiles(path.join(packageDir, "test"), cliVitestProjectSeeds, {
    label: "packages/cli/test",
  });

export const cliVitestProjects = cliVitestProjectSpecs.map(({ name, fileNames }) =>
  createCliVitestProject(name, fileNames),
);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: cliVitestMaxWorkers,
    coverage: cliVitestCoverage,
    projects: cliVitestProjects,
  },
});
