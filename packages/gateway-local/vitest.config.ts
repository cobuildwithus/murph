import path from "node:path";

import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/contracts": "../contracts/src/index.ts",
  "@murphai/core": "../core/src/index.ts",
  "@murphai/gateway-core": "../gateway-core/src/index.ts",
  "@murphai/gateway-local": "./src/index.ts",
  "@murphai/inboxd": "../inboxd/src/index.ts",
  "@murphai/messaging-ingress": "../messaging-ingress/package.json",
  "@murphai/parsers": "../parsers/src/index.ts",
  "@murphai/runtime-state": "../runtime-state/src/index.ts",
} as const;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "gateway-local",
  workspaceSourceEntryRelativePaths: WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  extraAliases: ({ packageDir }) => [
    {
      find: /^@murphai\/runtime-state\/node$/,
      replacement: path.resolve(packageDir, "../runtime-state/src/node/index.ts"),
    },
  ],
});
