import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
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

export type BuildCommandContext = {
  packageRoot: string;
  tempConfigPath: string;
  tempDistPath: string;
};

export type BuildCommandResult = {
  error?: Error;
  status: number | null;
};

export type SafeBuildOptions = {
  packageRoot?: string;
  runBuildCommand?: (context: BuildCommandContext) => BuildCommandResult;
};

type TsConfigReference = {
  path: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTsConfigReferences(packageRoot: string): TsConfigReference[] | undefined {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(packageRoot, "tsconfig.json"), "utf8"),
  );

  if (!isRecord(parsed) || !Array.isArray(parsed.references)) {
    return undefined;
  }

  const references = parsed.references.flatMap((reference): TsConfigReference[] => {
    if (!isRecord(reference) || typeof reference.path !== "string") {
      return [];
    }
    return [{ path: reference.path }];
  });

  return references.length > 0 ? references : undefined;
}

function writeTempBuildConfig(context: BuildCommandContext): void {
  const references = readTsConfigReferences(context.packageRoot);
  const tempConfig = {
    extends: "./tsconfig.json",
    compilerOptions: {
      outDir: "./.dist-next",
      tsBuildInfoFile: "./.dist-next/.tsbuildinfo",
    },
    ...(references ? { references } : {}),
  };

  writeFileSync(`${context.tempConfigPath}`, `${JSON.stringify(tempConfig, null, 2)}\n`);
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Refusing to publish symlinked TypeScript output root: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to publish symlink from TypeScript output: ${fullPath}`);
    }
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath));
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
    throw new Error(`Refusing to write outside package build output: ${candidatePath}`);
  }
}

function removeStaleEntry(entryPath: string, rootDistPath: string): void {
  assertPathInside(rootDistPath, entryPath);
  rmSync(entryPath, REMOVE_OPTIONS);
}

function pruneStaleEntries(
  rootDistPath: string,
  currentDistPath: string,
  expectedRelativeFiles: Set<string>,
): void {
  if (!existsSync(currentDistPath)) {
    return;
  }

  for (const entry of readdirSync(currentDistPath)) {
    const entryPath = path.join(currentDistPath, entry);
    assertPathInside(rootDistPath, entryPath);

    const stat = lstatSync(entryPath);
    const relativePath = path.relative(rootDistPath, entryPath);
    if (stat.isSymbolicLink()) {
      if (!expectedRelativeFiles.has(relativePath)) {
        removeStaleEntry(entryPath, rootDistPath);
      }
      continue;
    }

    if (stat.isDirectory()) {
      pruneStaleEntries(rootDistPath, entryPath, expectedRelativeFiles);
      if (readdirSync(entryPath).length === 0) {
        removeStaleEntry(entryPath, rootDistPath);
      }
      continue;
    }

    if (!expectedRelativeFiles.has(relativePath)) {
      removeStaleEntry(entryPath, rootDistPath);
    }
  }
}

function ensureSafeTargetParent(distPath: string, targetPath: string): void {
  assertPathInside(distPath, targetPath);

  let currentPath = distPath;
  const relativeParent = path.relative(distPath, path.dirname(targetPath));
  if (!containsRelativePath(relativeParent)) {
    return;
  }

  for (const part of relativeParent.split(path.sep)) {
    currentPath = path.join(currentPath, part);
    if (existsSync(currentPath) && lstatSync(currentPath).isSymbolicLink()) {
      throw new Error(`Refusing to write through symlinked build output path: ${currentPath}`);
    }
  }
}

function ensureOutputDirectory(rootPath: string): void {
  if (existsSync(rootPath)) {
    const stat = lstatSync(rootPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      return;
    }
    rmSync(rootPath, REMOVE_OPTIONS);
  }

  mkdirSync(rootPath, { recursive: true });
}

export function syncBuiltDist(tempDistPath: string, distPath: string): void {
  ensureOutputDirectory(distPath);

  const tempFiles = listFiles(tempDistPath);
  const expectedRelativeFiles = new Set<string>();

  for (const tempFilePath of tempFiles) {
    const relativePath = path.relative(tempDistPath, tempFilePath);
    expectedRelativeFiles.add(relativePath);
  }

  pruneStaleEntries(distPath, distPath, expectedRelativeFiles);

  const publishTempRoot = mkdtempSync(path.join(path.dirname(distPath), ".dist-publish-"));
  try {
    for (const tempFilePath of tempFiles) {
      const relativePath = path.relative(tempDistPath, tempFilePath);

      const targetPath = path.join(distPath, relativePath);
      const tempTargetPath = path.join(publishTempRoot, relativePath);
      assertPathInside(publishTempRoot, tempTargetPath);
      ensureSafeTargetParent(distPath, targetPath);
      mkdirSync(path.dirname(tempTargetPath), { recursive: true });
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(tempFilePath, tempTargetPath);
      renameSync(tempTargetPath, targetPath);
    }
  } finally {
    rmSync(publishTempRoot, REMOVE_OPTIONS);
  }
}

function runTypeScriptBuild(context: BuildCommandContext): BuildCommandResult {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsc", "-b", path.basename(context.tempConfigPath), "--force"],
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
  const tempConfigPath = path.join(packageRoot, ".tsconfig.build-next.json");
  const context = {
    packageRoot,
    tempConfigPath,
    tempDistPath,
  };
  const runBuildCommand = options.runBuildCommand ?? runTypeScriptBuild;

  rmSync(tempDistPath, REMOVE_OPTIONS);
  rmSync(tempConfigPath, REMOVE_OPTIONS);
  writeTempBuildConfig(context);

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
    rmSync(tempConfigPath, REMOVE_OPTIONS);
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
