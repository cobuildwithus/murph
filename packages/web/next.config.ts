import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@healthybob/contracts": "../contracts/src/index.ts",
  "@healthybob/runtime-state": "../runtime-state/src/index.ts",
  "@healthybob/query": "../query/src/index.ts",
} as const;
const SOURCE_EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

export const WORKSPACE_SOURCE_PACKAGE_NAMES = Object.freeze(
  Object.keys(WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
);

export function resolveWorkspaceSourceEntries(packageDir: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS).map(([packageName, relativePath]) => [
      packageName,
      path.resolve(packageDir, relativePath),
    ]),
  );
}

interface ResolveConfigLike {
  extensionAlias?: Record<string, string[]>;
}

interface WebpackConfigLike {
  resolve?: ResolveConfigLike;
}

export function installSourceExtensionAliases<T extends WebpackConfigLike>(config: T): T {
  config.resolve = {
    ...config.resolve,
    extensionAlias: {
      ...(config.resolve?.extensionAlias ?? {}),
      ...SOURCE_EXTENSION_ALIAS,
    },
  };

  return config;
}

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
