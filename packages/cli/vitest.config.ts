import { defineProject } from "vitest/config";

import { resolveMurphVitestFileParallelism } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

export default defineProject({
  test: {
    ...murphVitestNoTimeouts,
    name: "cli",
    environment: "node",
    fileParallelism: resolveMurphVitestFileParallelism(),
    include: ["test/**/*.test.ts"],
  },
});
