import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

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
    name: "cloudflare-workers",
    fileParallelism: false,
    include: ["apps/cloudflare/test/workers/**/*.test.ts"],
  },
});
