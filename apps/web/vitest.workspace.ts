import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
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
const requireFromHere = createRequire(import.meta.url);
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

function isHostedWebPrismaClientGenerated(): boolean {
  try {
    const prismaClientPackageJsonPath = requireFromHere.resolve(
      "@prisma/client/package.json",
      { paths: [appDir] },
    );
    requireFromHere.resolve(".prisma/client/default", {
      paths: [path.dirname(prismaClientPackageJsonPath)],
    });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

function generateHostedWebPrismaClient(): void {
  execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--dir", "apps/web", "prisma:generate"],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
}

export function createHostedWebVitestConfig(
  isPrismaClientGenerated: () => boolean = isHostedWebPrismaClientGenerated,
  generatePrismaClient: () => void = generateHostedWebPrismaClient,
) {
  if (!isPrismaClientGenerated()) {
    generatePrismaClient();
  }

  return {
    test: {
      ...murphVitestNoTimeouts,
      maxWorkers: hostedWebVitestMaxWorkers,
      projects: hostedWebVitestProjects,
    },
  };
}

export default defineConfig(() => createHostedWebVitestConfig());
