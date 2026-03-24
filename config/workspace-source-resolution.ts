import path from "node:path";

export type WorkspaceSourceEntryRelativePaths = Readonly<Record<string, string>>;

const SOURCE_EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

export function createWorkspaceSourcePackageNames(
  relativePaths: WorkspaceSourceEntryRelativePaths,
): readonly string[] {
  return Object.freeze(Object.keys(relativePaths));
}

export function resolveWorkspaceSourceEntries(
  configDir: string,
  relativePaths: WorkspaceSourceEntryRelativePaths,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(relativePaths).map(([packageName, relativePath]) => [
      packageName,
      path.resolve(configDir, relativePath),
    ]),
  );
}

export function createVitestWorkspaceRuntimeAliases(
  sourceEntries: Record<string, string>,
): Array<{
  find: RegExp;
  replacement: string;
}> {
  return Object.entries(sourceEntries).flatMap(([packageName, entryPath]) => {
    const sourceDir = path.dirname(entryPath);
    const escapedPackageName = escapeRegex(packageName);

    return [
      {
        find: new RegExp(`^${escapedPackageName}$`),
        replacement: entryPath,
      },
      {
        find: new RegExp(`^${escapedPackageName}/(.+)$`),
        replacement: `${sourceDir}/$1.ts`,
      },
    ];
  });
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
