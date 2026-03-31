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
  "@murph/assistantd": "../assistantd/src/index.ts",
  "@murph/assistant-core": "../assistant-core/src/index.ts",
  "@murph/contracts": "../contracts/src/index.ts",
  "@murph/core": "../core/src/index.ts",
  "@murph/device-syncd": "../device-syncd/src/index.ts",
  "@murph/gateway-core": "../gateway-core/src/index.ts",
  "@murph/gateway-local": "../gateway-local/src/index.ts",
  "@murph/hosted-execution": "../hosted-execution/src/index.ts",
  "@murph/importers": "../importers/src/index.ts",
  "@murph/inboxd": "../inboxd/src/index.ts",
  "@murph/parsers": "../parsers/src/index.ts",
  "@murph/query": "../query/src/index.ts",
  "@murph/runtime-state": "../runtime-state/src/index.ts",
  murph: "./src/index.ts",
} as const;

export default defineProject({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    ...murphVitestNoTimeouts,
    name: "cli",
    environment: "node",
    ...resolveMurphVitestConcurrency(),
    include: ["test/**/*.test.ts"],
  },
});
