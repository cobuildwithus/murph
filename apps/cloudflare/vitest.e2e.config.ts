import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";

const cloudflareDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: path.resolve(cloudflareDir, "test/stubs/cloudflare-workers.ts"),
      },
      ...cloudflareVitestAliases,
    ],
  },
  test: {
    ...murphVitestNoTimeouts,
    environment: "node",
    fileParallelism: false,
    hookTimeout: 600_000,
    include: [path.join(cloudflareDir, "test", "hosted-local-e2e.test.ts")],
    maxWorkers: 1,
    name: "cloudflare-hosted-local-e2e",
    testTimeout: 600_000,
  },
});
