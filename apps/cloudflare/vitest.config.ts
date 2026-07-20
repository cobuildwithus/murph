import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestLongRunningTimeouts } from "../../config/vitest-timeouts.js";
import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";

const nodeOnlyAliases = [
  {
    find: "cloudflare:workers",
    replacement: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "test/stubs/cloudflare-workers.ts",
    ),
  },
  {
    find: "cloudflare:email",
    replacement: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "test/stubs/cloudflare-email.ts",
    ),
  },
];

export default defineProject({
  resolve: {
    alias: [
      ...nodeOnlyAliases,
      ...cloudflareVitestAliases,
    ],
  },
  test: {
    ...murphVitestLongRunningTimeouts,
    name: "cloudflare-node",
    environment: "node",
    globalSetup: [murphVitestTempGlobalSetup],
    ...resolveMurphVitestConcurrency(),
    exclude: ["apps/cloudflare/test/workers/**/*.test.ts"],
    include: ["apps/cloudflare/test/**/*.test.ts"],
  },
});
