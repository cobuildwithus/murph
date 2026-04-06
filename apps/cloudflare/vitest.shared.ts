import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const cloudflareVitestAliases = [
  {
    find: "@cloudflare/containers",
    replacement: path.resolve(
      repoRoot,
      "apps/cloudflare/test/stubs/cloudflare-containers.ts",
    ),
  },
  ...createVitestWorkspaceRuntimeAliases(
    resolveWorkspaceSourceEntries(repoRoot, {
      "@murphai/assistant-engine": "packages/assistant-engine/src/index.ts",
      "@murphai/operator-config": "packages/operator-config/src/index.ts",
      "@murphai/assistant-runtime": "packages/assistant-runtime/src/index.ts",
      "@murphai/murph": "packages/cli/src/index.ts",
      "@murphai/contracts": "packages/contracts/src/index.ts",
      "@murphai/core": "packages/core/src/index.ts",
      "@murphai/device-syncd": "packages/device-syncd/src/index.ts",
      "@murphai/gateway-core": "packages/gateway-core/src/index.ts",
      "@murphai/gateway-local": "packages/gateway-local/src/index.ts",
      "@murphai/hosted-execution": "packages/hosted-execution/src/index.ts",
      "@murphai/importers": "packages/importers/src/index.ts",
      "@murphai/inboxd": "packages/inboxd/src/index.ts",
      "@murphai/messaging-ingress": "packages/messaging-ingress/src/index.ts",
      "@murphai/parsers": "packages/parsers/src/index.ts",
      "@murphai/query": "packages/query/src/index.ts",
      "@murphai/runtime-state": "packages/runtime-state/src/index.ts",
    }),
  ),
];
