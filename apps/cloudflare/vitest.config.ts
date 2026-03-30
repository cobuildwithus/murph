import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

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
    name: "cloudflare-node",
    environment: "node",
    fileParallelism: false,
    exclude: ["apps/cloudflare/test/workers/**/*.test.ts"],
    include: ["apps/cloudflare/test/**/*.test.ts"],
  },
});
