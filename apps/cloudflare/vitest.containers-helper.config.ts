import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestConcurrency,
} from "../../config/vitest-parallelism.js";
import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

const cloudflareDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: path.resolve(
          cloudflareDir,
          "test/stubs/cloudflare-workers-containers-helper.ts",
        ),
      },
    ],
  },
  ssr: {
    noExternal: ["@cloudflare/containers"],
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "cloudflare-containers-helper",
    environment: "node",
    globalSetup: [murphVitestTempGlobalSetup],
    maxWorkers: resolveMurphAppVitestMaxWorkers(),
    ...resolveMurphVitestConcurrency(),
    include: [
      path.join(
        cloudflareDir,
        "test",
        "containers-helper-readiness.test.ts",
      ),
    ],
  },
});
