import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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

export default defineConfig({
  resolve: {
    alias: [
      ...nodeOnlyAliases,
      ...cloudflareVitestAliases,
    ],
  },
  test: {
    environment: "node",
    exclude: ["apps/cloudflare/test/workers/**/*.test.ts"],
    include: ["apps/cloudflare/test/**/*.test.ts"],
  },
});
