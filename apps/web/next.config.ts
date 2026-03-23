import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_RUNTIME_ALIASES = [
  {
    alias: path.resolve(appDir, "../../packages/contracts/dist/index.js"),
    name: "@healthybob/contracts",
    onlyModule: true,
  },
  {
    alias: path.resolve(appDir, "../../packages/runtime-state/dist/index.js"),
    name: "@healthybob/runtime-state",
    onlyModule: true,
  },
  {
    alias: path.resolve(appDir, "../../packages/core/dist/index.js"),
    name: "@healthybob/core",
    onlyModule: true,
  },
  {
    alias: path.resolve(appDir, "../../packages/importers/dist/index.js"),
    name: "@healthybob/importers",
    onlyModule: true,
  },
  {
    alias: path.resolve(appDir, "node_modules/@healthybob/device-syncd"),
    name: "@healthybob/device-syncd",
    onlyModule: true,
  },
  {
    alias: path.resolve(appDir, "node_modules/@healthybob/device-syncd"),
    name: "#device-syncd",
    onlyModule: true,
  },
  {
    alias: appDir,
    name: "apps/web",
    onlyModule: false,
  },
] as const;

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

function installRuntimeAliases<T extends WebpackConfigLike>(config: T): T {
  const currentAlias = config.resolve?.alias;

  const nextAlias = Array.isArray(currentAlias)
    ? [
        ...currentAlias.filter((entry) => !WORKSPACE_RUNTIME_ALIASES.some((alias) => alias.name === entry.name)),
        ...WORKSPACE_RUNTIME_ALIASES,
      ]
    : {
        ...(currentAlias ?? {}),
        ...Object.fromEntries(
          WORKSPACE_RUNTIME_ALIASES.map((entry) => [
            entry.onlyModule ? `${entry.name}$` : entry.name,
            entry.alias,
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
  outputFileTracingRoot: path.resolve(appDir, "../.."),
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => installRuntimeAliases(config),
};

export default nextConfig;
