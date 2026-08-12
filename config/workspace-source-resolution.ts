import fs from "node:fs";
import path from "node:path";

export type WorkspaceSourceEntryRelativePaths = Readonly<Record<string, string>>;
export type WorkspaceSourceEntries<T extends WorkspaceSourceEntryRelativePaths> = Record<
  keyof T & string,
  string
>;

export const HOSTED_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  "@murphai/assistant-runtime": "../../packages/assistant-runtime/src/index.ts",
  "@murphai/clinical-records": "../../packages/clinical-records/src/index.ts",
  "@murphai/cloudflare-hosted-control": "../../packages/cloudflare-hosted-control/package.json",
  "@murphai/contracts": "../../packages/contracts/src/index.ts",
  "@murphai/health-commons": "../../packages/health-commons/src/index.ts",
  "@murphai/health-metrics": "../../packages/health-metrics/src/index.ts",
  "@murphai/gateway-core": "../../packages/gateway-core/src/index.ts",
  "@murphai/hosted-execution": "../../packages/hosted-execution/src/index.ts",
  "@murphai/messaging-ingress": "../../packages/messaging-ingress/package.json",
  "@murphai/runtime-state": "../../packages/runtime-state/src/index.ts",
  "@murphai/query": "../../packages/query/src/index.ts",
  "@murphai/core": "../../packages/core/src/index.ts",
  "@murphai/importers": "../../packages/importers/src/index.ts",
  "@murphai/inboxd": "../../packages/inboxd/src/index.ts",
  "@murphai/parsers": "../../packages/parsers/src/index.ts",
  "@murphai/device-syncd": "../../packages/device-syncd/src/index.ts",
} as const satisfies WorkspaceSourceEntryRelativePaths;

type VitestAlias = {
  find: RegExp;
  replacement: string;
};

type PackageExportSourceEntry = {
  find: RegExp | string;
  replacement: string;
};

export interface WorkspaceSourceImportExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

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
    Object.entries(entryRelativePaths).map(([packageName, relativeEntryPath]) => {
      const resolvedPath = path.resolve(workspaceDir, relativeEntryPath);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(
          `Workspace source entry ${packageName} points at missing path ${resolvedPath}.`,
        );
      }

      return [packageName, resolvedPath];
    }),
  ) as WorkspaceSourceEntries<T>;
}

export function resolveWorkspaceRepoRoot(workspaceDir: string): string {
  return path.resolve(workspaceDir, "../..");
}

export function createWorkspaceSourceImportExecOptions(
  workspaceDir: string,
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceSourceImportExecOptions {
  const repoRoot = resolveWorkspaceRepoRoot(workspaceDir);

  return {
    cwd: repoRoot,
    env: {
      HOME: env.HOME,
      NODE_ENV: env.NODE_ENV,
      PATH: env.PATH,
      TEMP: env.TEMP,
      TMP: env.TMP,
      TMPDIR: env.TMPDIR,
      TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.base.json"),
    },
  };
}

export function createVitestWorkspaceRuntimeAliases(
  entries: Readonly<Record<string, string>>,
): VitestAlias[] {
  const aliases: VitestAlias[] = [];
  const seen = new Set<string>();

  const appendAlias = (specifier: RegExp | string, replacement: string) => {
    const find = typeof specifier === "string"
      ? new RegExp(`^${escapeRegExp(specifier)}$`)
      : specifier;
    const key = `${find.source}\u0000${replacement}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    aliases.push({
      find,
      replacement,
    });
  };

  for (const [specifier, entryPath] of Object.entries(entries)) {
    if (!isPackageRootSpecifier(specifier)) {
      appendAlias(specifier, entryPath);
      continue;
    }

    const packageDir = resolveWorkspacePackageDir(entryPath);
    const packageJson = readWorkspacePackageJson(packageDir);

    if (workspacePackageAllowsRootSpecifier(packageJson)) {
      appendAlias(specifier, entryPath);
    }

    for (const { find, replacement } of resolvePackageExportSourceEntries(
      specifier,
      packageDir,
      packageJson,
    )) {
      appendAlias(find, replacement);
    }
  }

  return aliases;
}

export function createVitestAliasesFromTsconfigPaths(input: {
  specifierFilter?: (specifier: string) => boolean;
  tsconfigPath?: string;
  workspaceDir: string;
}): VitestAlias[] {
  const repoRoot = resolveWorkspaceRepoRoot(input.workspaceDir);
  const tsconfigPath =
    input.tsconfigPath ?? path.join(repoRoot, "tsconfig.base.json");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
    compilerOptions?: {
      paths?: Record<string, string[]>;
    };
  };
  const pathMappings = tsconfig.compilerOptions?.paths ?? {};
  const aliases: VitestAlias[] = [];
  const seen = new Set<string>();

  const appendAlias = (find: RegExp, replacement: string) => {
    const key = `${find.source}\u0000${replacement}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    aliases.push({ find, replacement });
  };

  for (const [specifier, targets] of Object.entries(pathMappings)) {
    if (input.specifierFilter && !input.specifierFilter(specifier)) {
      continue;
    }

    const target = targets[0];
    if (typeof target !== "string") {
      continue;
    }

    const specifierStars = countOccurrences(specifier, "*");
    const targetStars = countOccurrences(target, "*");
    if (specifierStars !== targetStars || specifierStars > 1) {
      continue;
    }

    if (specifierStars === 0) {
      appendAlias(
        new RegExp(`^${escapeRegExp(specifier)}$`),
        path.resolve(repoRoot, target),
      );
      continue;
    }

    appendAlias(
      new RegExp(`^${escapeRegExp(specifier).replace("\\*", "(.+)")}$`),
      path.resolve(repoRoot, target.replace("*", "$1")),
    );
  }

  return aliases;
}

export const HOSTED_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES = createWorkspaceSourcePackageNames(
  HOSTED_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
);

export function resolveHostedWebWorkspaceSourceEntries(workspaceDir: string) {
  return resolveWorkspaceSourceEntries(
    workspaceDir,
    HOSTED_WEB_WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS,
  );
}

function isPackageRootSpecifier(specifier: string): boolean {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length === 2;
  }

  return segments.length === 1;
}

function resolvePackageExportSourceEntries(
  packageName: string,
  packageDir: string,
  packageJson: Record<string, unknown>,
): PackageExportSourceEntry[] {
  const exportsField = packageJson.exports;
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return [];
  }

  const aliases: PackageExportSourceEntry[] = [];
  for (const [exportKey, exportValue] of Object.entries(exportsField)) {
    if (exportKey === "." || !exportKey.startsWith("./")) {
      continue;
    }

    const exportTarget = resolvePackageExportDefaultTarget(exportValue);
    if (!exportTarget) {
      continue;
    }

    if (exportKey.includes("*")) {
      if (countOccurrences(exportKey, "*") !== 1 || countOccurrences(exportTarget, "*") !== 1) {
        continue;
      }

      aliases.push({
        find: new RegExp(`^${escapeRegExp(`${packageName}/${exportKey.slice(2)}`).replace("\\*", "(.+)")}$`),
        replacement: resolveWorkspacePathFromPackageExportTarget(packageDir, exportTarget).replace("*", "$1"),
      });
      continue;
    }

    aliases.push({
      find: `${packageName}/${exportKey.slice(2)}`,
      replacement: resolveWorkspacePathFromPackageExportTarget(packageDir, exportTarget),
    });
  }

  return aliases;
}

function workspacePackageAllowsRootSpecifier(packageJson: Record<string, unknown>): boolean {
  if (!("exports" in packageJson)) {
    return true;
  }

  const exportsField = packageJson.exports;
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return true;
  }

  if (!exportsField || typeof exportsField !== "object") {
    return false;
  }

  const exportKeys = Object.keys(exportsField);
  if (exportKeys.some((key) => !key.startsWith("."))) {
    return true;
  }

  return Object.hasOwn(exportsField, ".");
}

function resolveWorkspacePackageDir(entryPath: string): string {
  let currentDir = path.dirname(entryPath);

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve package directory for workspace entry: ${entryPath}`);
    }
    currentDir = parentDir;
  }
}

function readWorkspacePackageJson(packageDir: string): Record<string, unknown> {
  const packageJsonPath = path.join(packageDir, "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
}

function resolvePackageExportDefaultTarget(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Readonly<Record<string, unknown>>;
  for (const key of ["default", "import", "node", "browser"]) {
    const candidate = resolvePackageExportDefaultTarget(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function resolveWorkspacePathFromPackageExportTarget(packageDir: string, exportTarget: string): string {
  if (!exportTarget.startsWith("./dist/")) {
    return path.resolve(packageDir, exportTarget.replace(/^\.\//u, ""));
  }

  const sourceRelativePath = exportTarget
    .replace(/^\.\//u, "")
    .replace(/^dist\//u, "src/")
    .replace(/\.js$/u, ".ts");
  const tsPath = path.resolve(packageDir, sourceRelativePath);
  if (fs.existsSync(tsPath)) {
    return tsPath;
  }

  const tsxPath = tsPath.replace(/\.ts$/u, ".tsx");
  if (fs.existsSync(tsxPath)) {
    return tsxPath;
  }

  const mtsPath = tsPath.replace(/\.ts$/u, ".mts");
  if (fs.existsSync(mtsPath)) {
    return mtsPath;
  }

  throw new Error(
    `Unable to resolve a source file for export target ${exportTarget} under ${packageDir}.`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
