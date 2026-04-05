import { defineProject } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

export default defineProject({
  test: {
    ...murphVitestNoTimeouts,
    name: "openclaw",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["test/**/*.test.ts"],
  },
});
