import path from "node:path";

export type WorkspaceSourceEntryRelativePaths = Readonly<Record<string, string>>;
export type WorkspaceSourceEntries<T extends WorkspaceSourceEntryRelativePaths> = Record<
  keyof T & string,
  string
>;

export const HOSTED_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murph/contracts": "../../packages/contracts/src/index.ts",
  "@murph/hosted-execution": "../../packages/hosted-execution/src/index.ts",
  "@murph/runtime-state": "../../packages/runtime-state/src/index.ts",
  "@murph/core": "../../packages/core/src/index.ts",
  "@murph/importers": "../../packages/importers/src/index.ts",
  "@murph/inboxd": "../../packages/inboxd/src/index.ts",
  "@murph/device-syncd": "../../packages/device-syncd/src/index.ts",
} as const satisfies WorkspaceSourceEntryRelativePaths;

export const LOCAL_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murph/contracts": "../contracts/src/index.ts",
  "@murph/device-syncd": "../device-syncd/src/index.ts",
  "@murph/hosted-execution": "../hosted-execution/src/index.ts",
  "@murph/runtime-state": "../runtime-state/src/index.ts",
  "@murph/query": "../query/src/index.ts",
} as const satisfies WorkspaceSourceEntryRelativePaths;

type VitestAlias = {
  find: RegExp;
  replacement: string;
};

export function createWorkspaceSourcePackageNames<T extends WorkspaceSourceEntryRelativePaths>(
  entryRelativePaths: T,
): readonly (keyof T & string)[] {
  return Object.freeze(Object.keys(entryRelativePaths) as (keyof T & string)[]);
}

export function resolveWorkspaceSourceEntries<T extends WorkspaceSourceEntryRelativePaths>(
  workspaceDir: string,
  entryRelativePaths: T,
): WorkspaceSourceEntries<T> {
  return Object.fromEntries(
    Object.entries(entryRelativePaths).map(([packageName, relativeEntryPath]) => [
      packageName,
      path.resolve(workspaceDir, relativeEntryPath),
    ]),
  ) as WorkspaceSourceEntries<T>;
}

export function createVitestWorkspaceRuntimeAliases(
  entries: Readonly<Record<string, string>>,
): VitestAlias[] {
  return Object.entries(entries).flatMap(([packageName, entryPath]) => {
    const packageSourceRoot = path.dirname(entryPath);

    return [
      {
        find: new RegExp(`^${escapeRegExp(packageName)}$`),
        replacement: entryPath,
      },
      {
        find: new RegExp(`^${escapeRegExp(packageName)}/(.+)$`),
        replacement: `${packageSourceRoot}/$1`,
      },
    ];
  });
}

export const HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES = createWorkspaceSourcePackageNames(
  HOSTED_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
);

export const LOCAL_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES = createWorkspaceSourcePackageNames(
  LOCAL_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
);

export function resolveHostedWebWorkspaceSourceEntries(workspaceDir: string) {
  return resolveWorkspaceSourceEntries(
    workspaceDir,
    HOSTED_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  );
}

export function resolveLocalWebWorkspaceSourceEntries(workspaceDir: string) {
  return resolveWorkspaceSourceEntries(
    workspaceDir,
    LOCAL_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
