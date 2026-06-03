import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createVitestAliasesFromTsconfigPaths,
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from "../../config/workspace-source-resolution.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appDir = path.join(repoRoot, "apps/cloudflare");

export const cloudflareVitestAliases = [
  {
    find: "@cloudflare/containers",
    replacement: path.resolve(
      repoRoot,
      "apps/cloudflare/test/stubs/cloudflare-containers.ts",
    ),
  },
  {
    find: "server-only",
    replacement: path.resolve(repoRoot, "apps/cloudflare/test/stubs/server-only.ts"),
  },
  ...createVitestWorkspaceRuntimeAliases(
    resolveWorkspaceSourceEntries(repoRoot, {
      "@murphai/assistant-engine": "packages/assistant-engine/src/index.ts",
      "@murphai/operator-config": "packages/operator-config/package.json",
      "@murphai/assistant-runtime": "packages/assistant-runtime/src/index.ts",
      "@murphai/cloudflare-hosted-control": "packages/cloudflare-hosted-control/package.json",
      "#hosted-web-testing": "apps/web/test/support/hosted-web-testkit.ts",
      "@murphai/murph": "packages/cli/src/index.ts",
      "@murphai/contracts": "packages/contracts/src/index.ts",
      "@murphai/core": "packages/core/src/index.ts",
      "@murphai/device-syncd": "packages/device-syncd/src/index.ts",
      "@murphai/gateway-core": "packages/gateway-core/src/index.ts",
      "@murphai/health-metrics": "packages/health-metrics/src/index.ts",
      "@murphai/hosted-execution": "packages/hosted-execution/src/index.ts",
      "@murphai/hosted-local-harness": "packages/hosted-local-harness/package.json",
      "@murphai/importers": "packages/importers/src/index.ts",
      "@murphai/inbox-services": "packages/inbox-services/src/index.ts",
      "@murphai/inboxd": "packages/inboxd/src/index.ts",
      "@murphai/messaging-ingress": "packages/messaging-ingress/package.json",
      "@murphai/parsers": "packages/parsers/src/index.ts",
      "@murphai/query": "packages/query/src/index.ts",
      "@murphai/runtime-state": "packages/runtime-state/src/index.ts",
      "@murphai/vault-usecases": "packages/vault-usecases/src/index.ts",
    }),
  ),
  ...createVitestAliasesFromTsconfigPaths({
    workspaceDir: appDir,
    specifierFilter: isCloudflareWorkspaceSourceSpecifier,
  }),
];

function isCloudflareWorkspaceSourceSpecifier(specifier: string): boolean {
  return (
    specifier === "#hosted-web-testing" ||
    specifier === "murph" ||
    specifier.startsWith("@murphai/")
  );
}
