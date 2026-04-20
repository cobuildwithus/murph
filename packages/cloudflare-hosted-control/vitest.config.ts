import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/cloudflare-hosted-control/client": "./src/client.ts",
  "@murphai/cloudflare-hosted-control/routes": "./src/routes.ts",
  "@murphai/hosted-execution": "../hosted-execution/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "cloudflare-hosted-control",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
});
