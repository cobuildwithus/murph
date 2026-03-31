import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import { resolveMurphVitestFileParallelism } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";

const nodeOnlyAliases = [
  {
    find: "cloudflare:workers",
    replacement: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "test/stubs/cloudflare-workers.ts",
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
    ...murphVitestNoTimeouts,
    name: "cloudflare-node",
    environment: "node",
    fileParallelism: resolveMurphVitestFileParallelism(),
    exclude: ["apps/cloudflare/test/workers/**/*.test.ts"],
    include: ["apps/cloudflare/test/**/*.test.ts"],
  },
});
