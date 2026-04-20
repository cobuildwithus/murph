import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/messaging-ingress": "./package.json",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "messaging-ingress",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
