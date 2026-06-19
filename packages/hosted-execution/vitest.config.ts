import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/device-syncd/hosted-runtime": "../device-syncd/src/hosted-runtime.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/hosted-execution": "./src/index.ts",
  "@murphai/hosted-execution/assistant-identifiers": "./src/assistant-identifiers.ts",
  "@murphai/hosted-execution/computer-use": "./src/computer-use.ts",
  "@murphai/hosted-execution/dashboard-replica": "./src/dashboard-replica.ts",
  "@murphai/hosted-execution/legacy-dashboard-replica": "./src/legacy-dashboard-replica.ts",
  "@murphai/hosted-execution/orchestration-control": "./src/orchestration-control.ts",
  "@murphai/hosted-execution/runtime-control": "./src/runtime-control.ts",
  "@murphai/hosted-execution/temporal-env": "./src/temporal-env.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "hosted-execution",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
