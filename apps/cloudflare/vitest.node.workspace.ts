import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, defineProject } from "vitest/config";

import { cloudflareVitestAliases } from "./vitest.shared.js";

const cloudflareDir = path.dirname(fileURLToPath(import.meta.url));
const cloudflareNodeVitestMaxWorkers =
  process.env.MURPH_APP_VITEST_MAX_WORKERS ?? process.env.MURPH_VITEST_MAX_WORKERS ?? "25%";
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
      name,
      environment: "node",
      fileParallelism: false,
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
    maxWorkers: cloudflareNodeVitestMaxWorkers,
    projects: cloudflareNodeVitestProjects,
  },
});
