import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from "../../config/vitest-coverage.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "contracts",
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: createMurphVitestCoverage({
      customProviderModule: resolveMurphVitestCoverageProviderModule(packageDir),
      include: ["src/**/*.ts"],
    }),
  },
});
