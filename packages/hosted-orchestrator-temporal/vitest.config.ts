import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/hosted-execution/auth": "../hosted-execution/src/auth.ts",
  "@murphai/hosted-execution/contracts": "../hosted-execution/src/contracts.ts",
  "@murphai/hosted-execution/env": "../hosted-execution/src/env.ts",
  "@murphai/hosted-execution/orchestration-control":
    "../hosted-execution/src/orchestration-control.ts",
  "@murphai/hosted-execution/parsers": "../hosted-execution/src/parsers.ts",
  "@murphai/hosted-execution/runtime-control":
    "../hosted-execution/src/runtime-control.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "hosted-orchestrator-temporal",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
