import { defineConfig } from "vitest/config";

import { cloudflareVitestAliases } from "./vitest.shared.js";

export default defineConfig({
  resolve: {
    alias: cloudflareVitestAliases,
  },
  test: {
    environment: "node",
    exclude: ["apps/cloudflare/test/workers/**/*.test.ts"],
    include: ["apps/cloudflare/test/**/*.test.ts"],
  },
});
