import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestConcurrency,
} from "../../config/vitest-parallelism.js";
import { murphVitestStandardTimeouts } from "../../config/vitest-timeouts.js";
import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";

export default defineProject({
  plugins: [
    cloudflareTest({
      main: "./apps/cloudflare/test/workers/worker-entry.ts",
      wrangler: {
        configPath: "./apps/cloudflare/test/workers/wrangler.vitest.jsonc",
      },
    }),
  ],
  resolve: {
    alias: cloudflareVitestAliases,
  },
  test: {
    ...murphVitestStandardTimeouts,
    name: "cloudflare-workers",
    globalSetup: [murphVitestTempGlobalSetup],
    maxWorkers: resolveMurphAppVitestMaxWorkers(),
    ...resolveMurphVitestConcurrency(),
    include: ["apps/cloudflare/test/workers/**/*.test.ts"],
  },
});
