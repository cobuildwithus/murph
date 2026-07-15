import path from "node:path";
import { fileURLToPath } from "node:url";

import { createVitestAliasesFromTsconfigPaths } from "../../config/workspace-source-resolution.ts";

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
  {
    find: "@",
    replacement: path.resolve(repoRoot, "apps/web"),
  },
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
