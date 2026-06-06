import { execFile } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages", "apps", "e2e"] as const;
const gitListMaxBuffer = 16 * 1024 * 1024;
export const generatedArtifactDirectories = [
  "apps/cloudflare/.deploy/.deploy",
  "apps/cloudflare/.deploy/dry-run",
  "apps/cloudflare/.deploy/smoke-dist",
] as const;
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"] as const;
const sourceSidecarSuffixes = [
  ".d.ts.map",
  ".js.map",
  ".mjs.map",
  ".cjs.map",
  ".d.ts",
  ".js",
  ".mjs",
  ".cjs",
] as const;

export async function main(): Promise<void> {
  const quiet = process.argv.includes("--quiet");
  const verbose = process.argv.includes("--verbose");
  const prunedFiles = await pruneGeneratedSourceSidecars();

  if (quiet || prunedFiles.length === 0) {
    return;
  }

  console.log(
    `Pruned ${prunedFiles.length} generated source sidecar${prunedFiles.length === 1 ? "" : "s"}.`,
  );

  if (!verbose) {
    return;
  }

  for (const filePath of prunedFiles) {
    console.log(`- ${filePath}`);
  }
}

export async function pruneGeneratedSourceSidecars(): Promise<string[]> {
  const prunedGeneratedArtifactPaths = await pruneKnownGeneratedArtifactDirectories();
  const [trackedFiles, untrackedFiles] = await Promise.all([
    listGitFiles(["ls-files", "--", ...scanRoots]),
    listGitFiles(["ls-files", "--others", "--exclude-standard", "--", ...scanRoots]),
  ]);
  const trackedSourceFiles = new Set(trackedFiles);
  const prunedFiles = [...prunedGeneratedArtifactPaths];

  for (const filePath of untrackedFiles) {
    if (getGeneratedSourceSidecarSourcePath(filePath, trackedSourceFiles) === null) {
      continue;
    }

    await rm(path.join(repoRoot, filePath), { force: true });
    prunedFiles.push(filePath);
  }

  return prunedFiles.sort();
}

async function pruneKnownGeneratedArtifactDirectories(): Promise<string[]> {
  const prunedPaths: string[] = [];

  for (const relativePath of generatedArtifactDirectories) {
    await pruneKnownGeneratedArtifactDirectory(repoRoot, relativePath);
    prunedPaths.push(relativePath);
  }

  return prunedPaths;
}

export async function pruneKnownGeneratedArtifactDirectory(
  root: string,
  relativePath: string,
): Promise<void> {
  const normalizedRelativePath = normalizeRepoRelativePath(relativePath);
  const symlinkedParent = await findSymlinkedParentPath(root, normalizedRelativePath);

  if (symlinkedParent) {
    throw new Error(
      `Refusing to prune generated artifacts through symlinked parent "${symlinkedParent}".`,
    );
  }

  const absolutePath = path.join(root, normalizedRelativePath);
  const stats = await lstatIfExists(absolutePath);

  if (stats?.isSymbolicLink()) {
    await rm(absolutePath, { force: true });
    return;
  }

  await rm(absolutePath, { force: true, recursive: true });
}

export function getGeneratedSourceSidecarSourcePath(
  filePath: string,
  trackedSourceFiles: ReadonlySet<string>,
): string | null {
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const suffix of sourceSidecarSuffixes) {
    if (!normalizedPath.endsWith(suffix)) {
      continue;
    }

    const stem = normalizedPath.slice(0, -suffix.length);

    for (const extension of sourceExtensions) {
      const sourcePath = `${stem}${extension}`;

      if (trackedSourceFiles.has(sourcePath)) {
        return sourcePath;
      }
    }

    return null;
  }

  return null;
}

async function listGitFiles(args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    maxBuffer: gitListMaxBuffer,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function findSymlinkedParentPath(
  root: string,
  relativePath: string,
): Promise<string | null> {
  const parts = relativePath.split("/").filter((part) => part.length > 0);
  let currentRelativePath = "";

  for (const part of parts.slice(0, -1)) {
    currentRelativePath = currentRelativePath
      ? `${currentRelativePath}/${part}`
      : part;
    const stats = await lstatIfExists(path.join(root, currentRelativePath));

    if (!stats) {
      return null;
    }
    if (stats.isSymbolicLink()) {
      return currentRelativePath;
    }
  }

  return null;
}

async function lstatIfExists(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function normalizeRepoRelativePath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
  ) {
    throw new Error(`Generated artifact path must be repo-relative: ${relativePath}`);
  }
  return normalized;
}

function isNodeErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
