import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(repoRoot, "apps/web"),
      "@healthybob/contracts": path.resolve(repoRoot, "packages/contracts/dist/index.js"),
      "@healthybob/runtime-state": path.resolve(repoRoot, "packages/runtime-state/dist/index.js"),
      "@healthybob/core": path.resolve(repoRoot, "packages/core/dist/index.js"),
      "@healthybob/importers": path.resolve(repoRoot, "packages/importers/dist/index.js"),
      "@healthybob/device-syncd": path.resolve(repoRoot, "apps/web/node_modules/@healthybob/device-syncd"),
      "#device-syncd": path.resolve(repoRoot, "apps/web/node_modules/@healthybob/device-syncd"),
    },
  },
  test: {
    environment: "node",
    include: ["apps/web/test/**/*.test.ts"],
  },
});
