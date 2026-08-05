import assistantEngineProject from "./packages/assistant-engine/vitest.config.ts";
import assistantCliProject from "./packages/assistant-cli/vitest.config.ts";
import assistantRuntimeProject from "./packages/assistant-runtime/vitest.config.ts";
import assistantdProject from "./packages/assistantd/vitest.config.ts";
import cloudflareHostedControlProject from "./packages/cloudflare-hosted-control/vitest.config.ts";
import clinicalRecordsProject from "./packages/clinical-records/vitest.config.ts";
import contractsProject from "./packages/contracts/vitest.config.ts";
import coreProject from "./packages/core/vitest.config.ts";
import deviceSyncdProject from "./packages/device-syncd/vitest.config.ts";
import exerciseLibraryProject from "./packages/exercise-library/vitest.config.ts";
import gatewayCoreProject from "./packages/gateway-core/vitest.config.ts";
import healthMetricsProject from "./packages/health-metrics/vitest.config.ts";
import hostedExecutionProject from "./packages/hosted-execution/vitest.config.ts";
import importersProject from "./packages/importers/vitest.config.ts";
import inboxServicesProject from "./packages/inbox-services/vitest.config.ts";
import inboxdProject from "./packages/inboxd/vitest.config.ts";
import messagingIngressProject from "./packages/messaging-ingress/vitest.config.ts";
import openclawPluginProject from "./packages/openclaw-plugin/vitest.config.ts";
import operatorConfigProject from "./packages/operator-config/vitest.config.ts";
import {
  cliVitestProjectSpecs,
  createCliVitestProject,
} from "./packages/cli/vitest.workspace.ts";
import parsersProject from "./packages/parsers/vitest.config.ts";
import queryProject from "./packages/query/vitest.config.ts";
import runtimeStateProject from "./packages/runtime-state/vitest.config.ts";
import setupCliProject from "./packages/setup-cli/vitest.config.ts";
import vaultUsecasesProject from "./packages/vault-usecases/vitest.config.ts";
import {
  defineConfig,
  mergeConfig,
  type UserWorkspaceConfig,
} from "vitest/config";

import {
  resolveMurphVitestConcurrency,
  resolveMurphVitestMaxWorkers,
} from "./config/vitest-parallelism.js";
import { murphVitestStandardTimeouts } from "./config/vitest-timeouts.js";

const rootRepoVitestConcurrency = resolveMurphVitestConcurrency();
const rootRepoVitestMaxWorkers = resolveMurphVitestMaxWorkers();
const ROOT_PARALLEL_CLI_PROJECTS = new Set([
  "cli-health-tail",
  "cli-read-model",
  "cli-assistant",
  "cli-expansions",
]);

type RootRepoProject = {
  config: UserWorkspaceConfig;
  root: string;
  include: string[];
};

const ROOT_REPO_PROJECTS: RootRepoProject[] = [
  {
    config: assistantCliProject,
    root: "packages/assistant-cli",
    include: ["test/**/*.test.ts"],
  },
  {
    config: assistantEngineProject,
    root: "packages/assistant-engine",
    include: ["test/**/*.test.ts"],
  },
  {
    config: assistantRuntimeProject,
    root: "packages/assistant-runtime",
    include: ["test/**/*.test.ts"],
  },
  {
    config: assistantdProject,
    root: "packages/assistantd",
    include: ["test/**/*.test.ts"],
  },
  {
    config: cloudflareHostedControlProject,
    root: "packages/cloudflare-hosted-control",
    include: ["test/**/*.test.ts"],
  },
  {
    config: clinicalRecordsProject,
    root: "packages/clinical-records",
    include: ["test/**/*.test.ts"],
  },
  {
    config: contractsProject,
    root: "packages/contracts",
    include: ["test/**/*.test.ts"],
  },
  {
    config: coreProject,
    root: "packages/core",
    include: ["test/**/*.test.ts"],
  },
  {
    config: deviceSyncdProject,
    root: "packages/device-syncd",
    include: ["test/**/*.test.ts"],
  },
  {
    config: exerciseLibraryProject,
    root: "packages/exercise-library",
    include: ["test/**/*.test.ts"],
  },
  {
    config: gatewayCoreProject,
    root: "packages/gateway-core",
    include: ["test/**/*.test.ts"],
  },
  {
    config: healthMetricsProject,
    root: "packages/health-metrics",
    include: ["test/**/*.test.ts"],
  },
  {
    config: hostedExecutionProject,
    root: "packages/hosted-execution",
    include: ["test/**/*.test.ts"],
  },
  {
    config: inboxServicesProject,
    root: "packages/inbox-services",
    include: ["test/**/*.test.ts"],
  },
  {
    config: messagingIngressProject,
    root: "packages/messaging-ingress",
    include: ["test/**/*.test.ts"],
  },
  {
    config: openclawPluginProject,
    root: "packages/openclaw-plugin",
    include: ["test/**/*.test.ts"],
  },
  {
    config: operatorConfigProject,
    root: "packages/operator-config",
    include: ["test/**/*.test.ts"],
  },
  {
    config: importersProject,
    root: "packages/importers",
    include: ["test/**/*.test.ts"],
  },
  {
    config: inboxdProject,
    root: "packages/inboxd",
    include: ["test/**/*.test.ts"],
  },
  {
    config: parsersProject,
    root: "packages/parsers",
    include: ["test/**/*.test.ts"],
  },
  {
    config: queryProject,
    root: "packages/query",
    include: ["test/**/*.test.ts"],
  },
  {
    config: runtimeStateProject,
    root: "packages/runtime-state",
    include: ["test/**/*.test.ts"],
  },
  {
    config: setupCliProject,
    root: "packages/setup-cli",
    include: ["test/**/*.test.ts"],
  },
  {
    config: vaultUsecasesProject,
    root: "packages/vault-usecases",
    include: ["test/**/*.test.ts"],
  },
];

const rootRepoCliProjects = cliVitestProjectSpecs.map(({ fileNames, name }) => ({
  config: createCliVitestProject(name, fileNames),
  name,
}));

export default defineConfig({
  test: {
    ...murphVitestStandardTimeouts,
    maxWorkers: rootRepoVitestMaxWorkers,
    // apps/web and apps/cloudflare stay in their dedicated verify lanes so the
    // root multi-project run does not execute them twice.
    projects: [
      ...ROOT_REPO_PROJECTS.map(({ config, include, root }) =>
        mergeConfig(
          config,
          {
            root,
            test: {
              ...rootRepoVitestConcurrency,
              include,
              sequence: {
                ...rootRepoVitestConcurrency.sequence,
                // Package projects are independent of each other (no fixed
                // ports, no shared mutable dirs), so they share one
                // concurrent group and can fill the worker pool together.
                groupOrder: 0,
              },
            },
          },
        ),
      ),
      ...rootRepoCliProjects.map(({ config: project, name }, index) =>
        mergeConfig(
          project,
          {
            test: {
              sequence: {
                ...project.test?.sequence,
                // Match the package-local CLI workspace: independent buckets
                // share the worker pool, while explicit fileParallelism:false
                // smoke buckets retain distinct serial phases.
                groupOrder: ROOT_PARALLEL_CLI_PROJECTS.has(name)
                  ? 1
                  : 2 + index,
              },
            },
          },
        ),
      ),
    ],
  },
});
