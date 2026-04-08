import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveMurphVitestConcurrency } from "../../config/vitest-parallelism.js";
import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";
import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.js";
import { cliVitestCoverage } from "./vitest.workspace.ts";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistantd": "../assistantd/src/index.ts",
  "@murphai/assistant-cli": "../assistant-cli/src/index.ts",
  "@murphai/assistant-engine": "../assistant-engine/src/index.ts",
  "@murphai/operator-config": "../operator-config/src/index.ts",
  "@murphai/setup-cli": "../setup-cli/src/index.ts",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/gateway-local": "../gateway-local/src/index.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/inboxd-imessage": "../inboxd-imessage/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/src/index.ts",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
  murph: "./src/index.ts",
} as const;

export default defineConfig({
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
    coverage: cliVitestCoverage,
  },
});
