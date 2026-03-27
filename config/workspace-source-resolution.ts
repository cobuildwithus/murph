import path from "node:path";

export type WorkspaceSourceEntryRelativePaths = Readonly<Record<string, string>>;
export type WorkspaceSourceEntries<T extends WorkspaceSourceEntryRelativePaths> = Record<
  keyof T & string,
  string
>;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
