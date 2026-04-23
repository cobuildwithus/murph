import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistant-cli": "./package.json",
  "@murphai/assistant-engine": "../assistant-engine/src/index.ts",
  "@murphai/assistantd": "../assistantd/package.json",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/inbox-services": "../inbox-services/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/package.json",
  "@murphai/operator-config": "../operator-config/package.json",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
  "@murphai/vault-usecases": "../vault-usecases/src/index.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "assistant-cli",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  useDefaultConcurrency: false,
  useDefaultTimeouts: false,
});
