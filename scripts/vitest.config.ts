import { defineConfig } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../config/vitest-timeouts.js";

export default defineConfig({
  test: {
    ...murphVitestNoTimeouts,
    name: "repo-tools",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["scripts/**/*.test.ts"],
  },
});
