import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@cloudflare/containers",
        replacement: path.resolve(
          repoRoot,
          "apps/cloudflare/test/stubs/cloudflare-containers.ts",
        ),
      },
      ...createVitestWorkspaceRuntimeAliases(
        resolveWorkspaceSourceEntries(repoRoot, {
          "@healthybob/assistant-runtime": "packages/assistant-runtime/src/index.ts",
          healthybob: "packages/cli/src/index.ts",
          "@healthybob/contracts": "packages/contracts/src/index.ts",
          "@healthybob/core": "packages/core/src/index.ts",
          "@healthybob/device-syncd": "packages/device-syncd/src/index.ts",
          "@healthybob/hosted-execution": "packages/hosted-execution/src/index.ts",
          "@healthybob/importers": "packages/importers/src/index.ts",
          "@healthybob/inboxd": "packages/inboxd/src/index.ts",
          "@healthybob/parsers": "packages/parsers/src/index.ts",
          "@healthybob/query": "packages/query/src/index.ts",
          "@healthybob/runtime-state": "packages/runtime-state/src/index.ts",
        }),
      ),
    ],
  },
  test: {
    environment: "node",
    include: ["apps/cloudflare/test/**/*.test.ts"],
  },
});
