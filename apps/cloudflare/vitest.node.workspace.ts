import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, defineProject } from "vitest/config";

import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestConcurrency,
} from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";

const cloudflareDir = path.dirname(fileURLToPath(import.meta.url));
const cloudflareNodeVitestConcurrency = resolveMurphVitestConcurrency();
const cloudflareNodeVitestMaxWorkers = resolveMurphAppVitestMaxWorkers();
const nodeOnlyAliases = [
  {
    find: "cloudflare:workers",
    replacement: path.resolve(cloudflareDir, "test/stubs/cloudflare-workers.ts"),
  },
];
const cloudflareNodeAliases = [
  ...nodeOnlyAliases,
  ...cloudflareVitestAliases,
];

function cloudflareNodePattern(pattern: string): string {
  return path.join(cloudflareDir, "test", pattern);
}

function createCloudflareNodeProject(name: string, patterns: readonly string[]) {
  return defineProject({
    resolve: {
      alias: cloudflareNodeAliases,
    },
    test: {
      ...murphVitestNoTimeouts,
      name,
      environment: "node",
      ...cloudflareNodeVitestConcurrency,
      include: patterns.map(cloudflareNodePattern),
    },
  });
}

export const cloudflareNodeVitestProjects = [
  createCloudflareNodeProject("cloudflare-node-runner", [
    "node-runner*.test.ts",
    "outbox-delivery-journal.test.ts",
    "runner-*.test.ts",
    "user-env.test.ts",
    "user-runner.test.ts",
    "gateway-store.test.ts",
  ]),
  createCloudflareNodeProject("cloudflare-node-platform", [
    "auth.test.ts",
    "container-entrypoint.test.ts",
    "crypto.test.ts",
    "env.test.ts",
    "index.test.ts",
    "wrangler-runner.test.ts",
  ]),
  createCloudflareNodeProject("cloudflare-node-deploy", [
    "deploy-*.test.ts",
    "r2-lifecycle.test.ts",
    "smoke-hosted-deploy.test.ts",
  ]),
];

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: cloudflareNodeVitestMaxWorkers,
    projects: cloudflareNodeVitestProjects,
  },
});
