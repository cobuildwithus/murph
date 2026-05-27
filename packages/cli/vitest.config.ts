import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";
import { cliVitestCoverage } from "./vitest.workspace.ts";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistantd": "../assistantd/package.json",
  "@murphai/assistant-cli": "../assistant-cli/package.json",
  "@murphai/assistant-engine": "../assistant-engine/src/index.ts",
  "@murphai/operator-config": "../operator-config/package.json",
  "@murphai/setup-cli": "../setup-cli/package.json",
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/device-syncd/client": "../device-syncd/src/client.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/importers": "../importers/src/index.ts",
  "@murphai/inbox-services": "../inbox-services/src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/package.json",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/query": "../query/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
  "@murphai/vault-usecases/testing": "../vault-usecases/src/testing.ts",
  murph: "./src/index.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "cli",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  coverage: cliVitestCoverage,
});
