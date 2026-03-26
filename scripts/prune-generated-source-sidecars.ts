import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages", "apps", "e2e"] as const;
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
  const [trackedFiles, untrackedFiles] = await Promise.all([
    listGitFiles(["ls-files", "--", ...scanRoots]),
    listGitFiles(["ls-files", "--others", "--exclude-standard", "--", ...scanRoots]),
  ]);
  const trackedSourceFiles = new Set(trackedFiles);
  const prunedFiles: string[] = [];

  for (const filePath of untrackedFiles) {
    if (getGeneratedSourceSidecarSourcePath(filePath, trackedSourceFiles) === null) {
      continue;
    }

    await rm(path.join(repoRoot, filePath), { force: true });
    prunedFiles.push(filePath);
  }

  return prunedFiles.sort();
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
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
