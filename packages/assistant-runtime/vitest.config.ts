import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistant-engine": "../assistant-engine/dist/index.js",
  "@murphai/assistant-runtime": "./src/index.ts",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/gateway-local": "../gateway-local/src/index.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/src/index.ts",
  "@murphai/operator-config": "../operator-config/src/index.ts",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

export default defineProject({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "assistant-runtime",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["test/**/*.test.ts"],
  },
});
