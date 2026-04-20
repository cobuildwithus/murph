import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "./src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "core",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
