import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, defineProject } from "vitest/config";

import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestConcurrency,
} from "../../config/vitest-parallelism.js";
import {
  murphVitestLongRunningTimeouts,
  murphVitestNoTimeouts,
} from "../../config/vitest-timeouts.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";
import { resolveVitestBucketFiles } from "../../config/vitest-test-buckets.js";

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

function createCloudflareNodeProject(name: string, fileNames: readonly string[]) {
  return defineProject({
    resolve: {
      alias: cloudflareNodeAliases,
    },
    test: {
      ...(name === "cloudflare-node-runner"
        ? murphVitestLongRunningTimeouts
        : murphVitestNoTimeouts),
      name,
      environment: "node",
      ...cloudflareNodeVitestConcurrency,
      include: fileNames.map(cloudflareNodePattern),
    },
  });
}

const cloudflareNodeVitestProjectSpecs = resolveVitestBucketFiles(
  path.join(cloudflareDir, "test"),
  [
    {
      name: "cloudflare-node-runner",
      patterns: [
        "gateway-store.test.ts",
        "node-runner*.test.ts",
        "runner-*.test.ts",
        "side-effect-journal.test.ts",
        "user-env.test.ts",
        "user-key-store.test.ts",
        "user-runner.test.ts",
      ],
    },
    {
      includeRemaining: true,
      name: "cloudflare-node-platform",
      patterns: [
        "auth*.test.ts",
        "base64.test.ts",
        "business-outcomes.test.ts",
        "container-entrypoint.test.ts",
        "crypto.test.ts",
        "device-sync-runtime-store.test.ts",
        "dispatch-payload-store.test.ts",
        "env.test.ts",
        "hosted-email*.test.ts",
        "index*.test.ts",
        "share-store.test.ts",
        "storage-path*.test.ts",
        "usage-store.test.ts",
        "wrangler-runner.test.ts",
      ],
    },
    {
      name: "cloudflare-node-deploy",
      patterns: [
        "container-image-contract.test.ts",
        "deploy-*.test.ts",
        "r2-lifecycle.test.ts",
        "smoke-hosted-deploy.test.ts",
      ],
    },
  ],
  {
    ignorePatterns: [
      "workers/*.test.ts",
      "workers/**/*.test.ts",
    ],
    label: "apps/cloudflare/test",
  },
);

export const cloudflareNodeVitestProjects = cloudflareNodeVitestProjectSpecs.map(
  ({ fileNames, name }) => createCloudflareNodeProject(name, fileNames),
);

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    maxWorkers: cloudflareNodeVitestMaxWorkers,
    projects: cloudflareNodeVitestProjects,
  },
});
