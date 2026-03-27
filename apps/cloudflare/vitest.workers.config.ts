import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { cloudflareVitestAliases } from "./vitest.shared.js";

export default defineConfig({
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
    include: ["apps/cloudflare/test/workers/**/*.test.ts"],
  },
});
