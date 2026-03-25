import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import {
  createWorkspaceSourcePackageNames,
  installSourceExtensionAliases,
  resolveWorkspaceSourceEntries as resolveWorkspaceSourceEntriesFromMap,
} from "../../config/workspace-source-resolution";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@healthybob/contracts": "../../packages/contracts/src/index.ts",
  "@healthybob/runtime-state": "../../packages/runtime-state/src/index.ts",
  "@healthybob/core": "../../packages/core/src/index.ts",
  "@healthybob/importers": "../../packages/importers/src/index.ts",
  "@healthybob/inboxd": "../../packages/inboxd/src/index.ts",
  "@healthybob/device-syncd": "../../packages/device-syncd/src/index.ts",
} as const;

export const WORKSPACE_SOURCE_PACKAGE_NAMES = createWorkspaceSourcePackageNames(
  WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
);

export function resolveWorkspaceSourceEntries(appDir: string): Record<string, string> {
  return resolveWorkspaceSourceEntriesFromMap(
    appDir,
    WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  );
}

export { installSourceExtensionAliases };

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(appDir, "../.."),
  transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => installSourceExtensionAliases(config),
};

export default nextConfig;
