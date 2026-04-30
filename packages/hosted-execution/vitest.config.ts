import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/device-syncd": "../device-syncd/src/index.ts",
  "@murphai/device-syncd/hosted-runtime": "../device-syncd/src/hosted-runtime.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/hosted-execution": "./src/index.ts",
  "@murphai/hosted-execution/assistant-identifiers": "./src/assistant-identifiers.ts",
  "@murphai/hosted-execution/runtime-control": "./src/runtime-control.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "hosted-execution",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
