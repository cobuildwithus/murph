import path from "node:path";

export type WorkspaceSourceEntryRelativePaths = Readonly<Record<string, string>>;

const SOURCE_EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};
const TURBOPACK_SOURCE_RESOLVE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".json",
] as const;
const TURBOPACK_SOURCE_REWRITE_GLOBS = [
  "*.ts",
  "*.tsx",
  "*.mts",
  "*.cts",
] as const;
const TURBOPACK_SOURCE_REWRITE_CONDITION: {
  all: [
    { not: "foreign" },
    {
      path: RegExp;
    },
  ];
} = {
  all: [
    { not: "foreign" },
    { path: /^packages\/[^/]+\/src\// },
  ],
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

interface TurbopackRuleLike {
  as: (typeof TURBOPACK_SOURCE_REWRITE_GLOBS)[number];
  condition: typeof TURBOPACK_SOURCE_REWRITE_CONDITION;
  loaders: string[];
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

export function createTurbopackSourceResolutionOptions(
  sourceImportRewriteLoaderPath: string,
): {
  resolveExtensions: string[];
  rules: Record<(typeof TURBOPACK_SOURCE_REWRITE_GLOBS)[number], TurbopackRuleLike>;
} {
  return {
    resolveExtensions: [...TURBOPACK_SOURCE_RESOLVE_EXTENSIONS],
    rules: Object.fromEntries(
      TURBOPACK_SOURCE_REWRITE_GLOBS.map((as) => [
        as,
        {
          as,
          condition: TURBOPACK_SOURCE_REWRITE_CONDITION,
          loaders: [sourceImportRewriteLoaderPath],
        } satisfies TurbopackRuleLike,
      ]),
    ) as Record<(typeof TURBOPACK_SOURCE_REWRITE_GLOBS)[number], TurbopackRuleLike>,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
