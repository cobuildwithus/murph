import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistantd": "./package.json",
  "@murphai/assistant-engine": "../assistant-engine/src/index.ts",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/operator-config": "../operator-config/package.json",
  "@murphai/messaging-ingress": "../messaging-ingress/package.json",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
  "@murphai/vault-usecases": "../vault-usecases/src/index.ts",
  murph: "../cli/src/index.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "assistantd",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
