import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_RUNTIME_ENTRY_RELATIVE_PATHS = {
  "@healthybob/contracts": "../contracts/dist/index.js",
  "@healthybob/runtime-state": "../runtime-state/dist/index.js",
  "@healthybob/query": "../query/dist/index.js",
} as const;

interface ResolveConfigLike {
  alias?: Record<string, unknown> | readonly WebpackAliasLike[];
}

interface WebpackConfigLike {
  resolve?: ResolveConfigLike;
}

interface WebpackAliasLike {
  alias: string;
  name: string;
  onlyModule?: boolean;
}

export function resolveQueryRuntimeEntryPath(packageDir: string): string {
  return resolveWorkspaceRuntimeAliases(packageDir)["@healthybob/query"];
}

export function resolveWorkspaceRuntimeAliases(packageDir: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(WORKSPACE_RUNTIME_ENTRY_RELATIVE_PATHS).map(([packageName, relativePath]) => [
      packageName,
      path.resolve(packageDir, relativePath),
    ]),
  );
}

export function installQueryRuntimeAlias<T extends WebpackConfigLike>(
  config: T,
  packageDir: string,
): T {
  const currentAlias = config.resolve?.alias;
  const workspaceRuntimeAliases = resolveWorkspaceRuntimeAliases(packageDir);

  const nextAlias = Array.isArray(currentAlias)
    ? [
        ...currentAlias.filter((entry) => !(entry.name in workspaceRuntimeAliases)),
        ...Object.entries(workspaceRuntimeAliases).map(([packageName, alias]) => ({
          alias,
          name: packageName,
          onlyModule: true,
        })),
      ]
    : {
        ...(currentAlias ?? {}),
        ...Object.fromEntries(
          Object.entries(workspaceRuntimeAliases).map(([packageName, alias]) => [
            `${packageName}$`,
            alias,
          ]),
        ),
      };

  config.resolve = {
    ...config.resolve,
    alias: nextAlias,
  };

  return config;
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(packageDir, "../.."),
  typescript: {
    // Repo verification runs a dedicated package-local typecheck before build.
    ignoreBuildErrors: true,
  },
  webpack: (config) => installQueryRuntimeAlias(config, packageDir),
};

export default nextConfig;
