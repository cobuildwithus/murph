import assistantEngineProject from "./packages/assistant-engine/vitest.config.ts";
import assistantCliProject from "./packages/assistant-cli/vitest.config.ts";
import assistantRuntimeProject from "./packages/assistant-runtime/vitest.config.ts";
import assistantdProject from "./packages/assistantd/vitest.config.ts";
import cloudflareHostedControlProject from "./packages/cloudflare-hosted-control/vitest.config.ts";
import contractsProject from "./packages/contracts/vitest.config.ts";
import coreProject from "./packages/core/vitest.config.ts";
import deviceSyncdProject from "./packages/device-syncd/vitest.config.ts";
import gatewayCoreProject from "./packages/gateway-core/vitest.config.ts";
import gatewayLocalProject from "./packages/gateway-local/vitest.config.ts";
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

import { resolveMurphVitestConcurrency } from "./config/vitest-parallelism.js";
import { murphVitestStandardTimeouts } from "./config/vitest-timeouts.js";

const rootRepoVitestConcurrency = resolveMurphVitestConcurrency();

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
    config: gatewayCoreProject,
    root: "packages/gateway-core",
    include: ["test/**/*.test.ts"],
  },
  {
    config: gatewayLocalProject,
    root: "packages/gateway-local",
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

const rootRepoCliProjects: UserWorkspaceConfig[] = cliVitestProjectSpecs.map(
  ({ fileNames, name }) => createCliVitestProject(name, fileNames),
);

export default defineConfig({
  test: {
    ...murphVitestStandardTimeouts,
    // apps/web and apps/cloudflare stay in their dedicated verify lanes so the
    // root multi-project run does not execute them twice.
    projects: [
      ...ROOT_REPO_PROJECTS.map(({ config, include, root }, index) =>
        mergeConfig(
          config,
          {
            root,
            test: {
              ...rootRepoVitestConcurrency,
              include,
              sequence: {
                ...rootRepoVitestConcurrency.sequence,
                groupOrder: index,
              },
            },
          },
        ),
      ),
      ...rootRepoCliProjects.map((project, index) =>
        mergeConfig(
          project,
          {
            test: {
              sequence: {
                ...project.test?.sequence,
                groupOrder: ROOT_REPO_PROJECTS.length + index,
              },
            },
          },
        ),
      ),
    ],
  },
});
