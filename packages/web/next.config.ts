import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const QUERY_RUNTIME_ENTRY_RELATIVE_PATH = "../query/dist/index.js";

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
  return path.resolve(packageDir, QUERY_RUNTIME_ENTRY_RELATIVE_PATH);
}

export function installQueryRuntimeAlias<T extends WebpackConfigLike>(
  config: T,
  packageDir: string,
): T {
  const currentAlias = config.resolve?.alias;
  const queryRuntimeEntryPath = resolveQueryRuntimeEntryPath(packageDir);

  const nextAlias = Array.isArray(currentAlias)
    ? [
        ...currentAlias.filter((entry) => entry.name !== "@healthybob/query"),
        {
          alias: queryRuntimeEntryPath,
          name: "@healthybob/query",
          onlyModule: true,
        },
      ]
    : {
        ...(currentAlias ?? {}),
        "@healthybob/query$": queryRuntimeEntryPath,
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
