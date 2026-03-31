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
      "@murph/assistant-core": "packages/assistant-core/src/index.ts",
      "@murph/assistant-runtime": "packages/assistant-runtime/src/index.ts",
      murph: "packages/cli/src/index.ts",
      "@murph/contracts": "packages/contracts/src/index.ts",
      "@murph/core": "packages/core/src/index.ts",
      "@murph/device-syncd": "packages/device-syncd/src/index.ts",
      "@murph/gateway-core": "packages/gateway-core/src/index.ts",
      "@murph/hosted-execution": "packages/hosted-execution/src/index.ts",
      "@murph/importers": "packages/importers/src/index.ts",
      "@murph/inboxd": "packages/inboxd/src/index.ts",
      "@murph/parsers": "packages/parsers/src/index.ts",
      "@murph/query": "packages/query/src/index.ts",
      "@murph/runtime-state": "packages/runtime-state/src/index.ts",
    }),
  ),
];
