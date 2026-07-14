import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REMOVE_OPTIONS = {
  force: true,
  maxRetries: 2,
  recursive: true,
} as const;

const currentModulePath = fileURLToPath(import.meta.url);
const defaultPackageRoot = path.resolve(path.dirname(currentModulePath), "..");
const repoRoot = path.resolve(defaultPackageRoot, "../..");
const legacyTempConfigName = ".tsconfig.build-next.json";
const publishTempPrefix = ".dist-publish-";
const backupTempPrefix = ".dist-backup-";

export type BuildCommandContext = {
  packageRoot: string;
  safeBuildConfigPath: string;
  tempDistPath: string;
  tempTsBuildInfoPath: string;
};

export type BuildCommandResult = {
  error?: Error;
  status: number | null;
};

export type SafeBuildOptions = {
  packageRoot?: string;
  runBuildCommand?: (context: BuildCommandContext) => BuildCommandResult;
};

function formatRelativePath(rootPath: string, candidatePath: string): string {
  const relativePath = path.relative(rootPath, candidatePath);
  if (!containsRelativePath(relativePath)) {
    return "<outside-package>";
  }
  return relativePath.split(path.sep).join(path.posix.sep);
}

function listFiles(root: string, packageRoot = root): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error(
      `Refusing to publish symlinked TypeScript output root: ${formatRelativePath(packageRoot, root)}`,
    );
  }
  if (!rootStat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Refusing to publish symlink from TypeScript output: ${formatRelativePath(packageRoot, fullPath)}`,
      );
    }
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath, packageRoot));
      continue;
    }
    if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function containsRelativePath(relativePath: string): boolean {
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function assertPathInside(rootPath: string, candidatePath: string): void {
  if (!containsRelativePath(path.relative(rootPath, candidatePath))) {
    throw new Error(
      `Refusing to write outside package build output: ${formatRelativePath(rootPath, candidatePath)}`,
    );
  }
}

function removePackageEntriesWithPrefix(packageRoot: string, prefix: string): void {
  if (!existsSync(packageRoot)) {
    return;
  }

  for (const entry of readdirSync(packageRoot)) {
    if (!entry.startsWith(prefix)) {
      continue;
    }

    const entryPath = path.join(packageRoot, entry);
    assertPathInside(packageRoot, entryPath);
    rmSync(entryPath, REMOVE_OPTIONS);
  }
}

function listPackageEntriesWithPrefix(packageRoot: string, prefix: string): string[] {
  if (!existsSync(packageRoot)) {
    return [];
  }

  return readdirSync(packageRoot)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => path.join(packageRoot, entry));
}

function restoreInterruptedPublish(packageRoot: string, distPath: string): void {
  removePackageEntriesWithPrefix(packageRoot, publishTempPrefix);

  const backupPaths = listPackageEntriesWithPrefix(packageRoot, backupTempPrefix);
  if (existsSync(distPath)) {
    for (const backupPath of backupPaths) {
      assertPathInside(packageRoot, backupPath);
      rmSync(backupPath, REMOVE_OPTIONS);
    }
    return;
  }

  if (backupPaths.length === 0) {
    return;
  }

  if (backupPaths.length > 1) {
    throw new Error("Refusing to pick between multiple interrupted importers dist backups.");
  }

  const backupPath = backupPaths[0];
  if (backupPath) {
    renameSync(backupPath, distPath);
  }
}

export function syncBuiltDist(tempDistPath: string, distPath: string): void {
  const packageRoot = path.dirname(distPath);
  const tempFiles = listFiles(tempDistPath, packageRoot);
  const publishTempRoot = mkdtempSync(path.join(packageRoot, publishTempPrefix));

  try {
    for (const tempFilePath of tempFiles) {
      const relativePath = path.relative(tempDistPath, tempFilePath);
      const tempTargetPath = path.join(publishTempRoot, relativePath);
      assertPathInside(publishTempRoot, tempTargetPath);
      mkdirSync(path.dirname(tempTargetPath), { recursive: true });
      copyFileSync(tempFilePath, tempTargetPath);
    }

    replaceDistDirectory(distPath, publishTempRoot);
  } finally {
    rmSync(publishTempRoot, REMOVE_OPTIONS);
  }
}

function replaceDistDirectory(distPath: string, publishTempRoot: string): void {
  const packageRoot = path.dirname(distPath);
  let backupPath: string | undefined;

  try {
    if (existsSync(distPath)) {
      const distStat = lstatSync(distPath);
      if (distStat.isDirectory() && !distStat.isSymbolicLink()) {
        backupPath = mkdtempSync(path.join(packageRoot, backupTempPrefix));
        rmSync(backupPath, REMOVE_OPTIONS);
        renameSync(distPath, backupPath);
      } else {
        rmSync(distPath, REMOVE_OPTIONS);
      }
    }

    renameSync(publishTempRoot, distPath);

    if (backupPath) {
      rmSync(backupPath, REMOVE_OPTIONS);
    }
  } catch (error) {
    if (backupPath && existsSync(backupPath) && !existsSync(distPath)) {
      renameSync(backupPath, distPath);
    }

    throw error;
  }
}

function runTypeScriptBuild(context: BuildCommandContext): BuildCommandResult {
  const relativeConfigPath = path.relative(context.packageRoot, context.safeBuildConfigPath);
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "run-typescript.mjs"),
      "package",
      "-b",
      relativeConfigPath,
      "--pretty",
      "false",
    ],
    {
      cwd: context.packageRoot,
      stdio: "inherit",
    },
  );

  return {
    error: result.error,
    status: result.status,
  };
}

export function runSafeBuild(options: SafeBuildOptions = {}): number {
  const packageRoot = options.packageRoot ?? defaultPackageRoot;
  const distPath = path.join(packageRoot, "dist");
  const tempDistPath = path.join(packageRoot, ".dist-next");
  const safeBuildConfigPath = path.join(packageRoot, "tsconfig.safe-build.json");
  const tempTsBuildInfoPath = path.join(packageRoot, ".dist-next.tsbuildinfo");
  const context = {
    packageRoot,
    safeBuildConfigPath,
    tempDistPath,
    tempTsBuildInfoPath,
  };
  const runBuildCommand = options.runBuildCommand ?? runTypeScriptBuild;

  restoreInterruptedPublish(packageRoot, distPath);
  rmSync(tempDistPath, REMOVE_OPTIONS);
  rmSync(tempTsBuildInfoPath, REMOVE_OPTIONS);
  rmSync(path.join(packageRoot, legacyTempConfigName), REMOVE_OPTIONS);

  try {
    const result = runBuildCommand(context);
    if (result.error) {
      throw result.error;
    }

    const status = result.status ?? 1;
    if (status !== 0) {
      return status;
    }

    if (!existsSync(tempDistPath)) {
      throw new Error("TypeScript build finished without producing .dist-next.");
    }

    syncBuiltDist(tempDistPath, distPath);
    return 0;
  } finally {
    rmSync(tempDistPath, REMOVE_OPTIONS);
    rmSync(tempTsBuildInfoPath, REMOVE_OPTIONS);
    rmSync(path.join(packageRoot, legacyTempConfigName), REMOVE_OPTIONS);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentModulePath) {
  try {
    process.exit(runSafeBuild());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
