import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, defineProject } from "vitest/config";

import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestConcurrency,
} from "../../config/vitest-parallelism.js";
import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";
import { hostedWebVitestProjectSpecs } from "./vitest-project-specs.mjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");
const hostedWebVitestConcurrency = resolveMurphVitestConcurrency();
const hostedWebVitestMaxWorkers = resolveMurphAppVitestMaxWorkers();
const hostedWebAliases = [
  {
    find: "@",
    replacement: path.resolve(repoRoot, "apps/web"),
  },
  ...createVitestWorkspaceRuntimeAliases(resolveHostedWebWorkspaceSourceEntries(appDir)),
];

function hostedWebPattern(pattern: string): string {
  return path.join(appDir, "test", pattern);
}

function createHostedWebProject(name: string, fileNames: readonly string[]) {
  return defineProject({
    resolve: {
      alias: hostedWebAliases,
    },
    test: {
      ...murphVitestNoTimeouts,
      name,
      environment: "node",
      globalSetup: [murphVitestTempGlobalSetup],
      ...hostedWebVitestConcurrency,
      include: fileNames.map(hostedWebPattern),
      setupFiles: [
        path.join(appDir, "test", "setup-env.ts"),
      ],
    },
  });
}

export const hostedWebVitestProjects = hostedWebVitestProjectSpecs.map(
  ({ fileNames, name }) => createHostedWebProject(name, fileNames),
);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: hostedWebVitestMaxWorkers,
    projects: hostedWebVitestProjects,
  },
});
