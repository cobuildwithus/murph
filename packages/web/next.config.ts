import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import {
  createWorkspaceSourcePackageNames,
  installSourceExtensionAliases,
  resolveWorkspaceSourceEntries as resolveWorkspaceSourceEntriesFromMap,
} from "../../config/workspace-source-resolution";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@healthybob/contracts": "../contracts/src/index.ts",
  "@healthybob/runtime-state": "../runtime-state/src/index.ts",
  "@healthybob/query": "../query/src/index.ts",
} as const;

export const WORKSPACE_SOURCE_PACKAGE_NAMES = createWorkspaceSourcePackageNames(
  WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
);

export function resolveWorkspaceSourceEntries(packageDir: string): Record<string, string> {
  return resolveWorkspaceSourceEntriesFromMap(
    packageDir,
    WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  );
}

export { installSourceExtensionAliases };

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(packageDir, "../.."),
  transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
  typescript: {
    // Repo verification runs a dedicated package-local typecheck before build.
    ignoreBuildErrors: true,
  },
  webpack: (config) => installSourceExtensionAliases(config),
};

export default nextConfig;
