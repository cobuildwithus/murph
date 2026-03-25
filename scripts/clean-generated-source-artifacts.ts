import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["packages", "apps", "e2e"] as const;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/u, "").replace(/\/+$/u, "");
}

export function isWithinScanRoots(relativePath: string): boolean {
  return scanRoots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
}

export function getExpectedSourceSibling(relativePath: string): string | null {
  const normalizedPath = normalizePath(relativePath);

  if (normalizedPath.endsWith(".d.ts.map")) {
    return normalizedPath.slice(0, -".d.ts.map".length) + ".ts";
  }
  if (normalizedPath.endsWith(".d.ts")) {
    return normalizedPath.slice(0, -".d.ts".length) + ".ts";
  }
  if (normalizedPath.endsWith(".js.map")) {
    return normalizedPath.slice(0, -".js.map".length) + ".ts";
  }
  if (normalizedPath.endsWith(".js")) {
    return normalizedPath.slice(0, -".js".length) + ".ts";
  }

  return null;
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function listGeneratedSourceArtifactsToClean(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...scanRoots],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  const untrackedFiles = stdout
    .split("\u0000")
    .map((entry) => normalizePath(entry))
    .filter((entry) => entry.length > 0 && isWithinScanRoots(entry));

  const removablePaths: string[] = [];
  for (const relativePath of untrackedFiles) {
    const expectedSourceSibling = getExpectedSourceSibling(relativePath);
    if (!expectedSourceSibling) {
      continue;
    }

    if (await pathExists(expectedSourceSibling)) {
      removablePaths.push(relativePath);
    }
  }

  return removablePaths.sort();
}

export async function cleanGeneratedSourceArtifacts(): Promise<string[]> {
  const removablePaths = await listGeneratedSourceArtifactsToClean();

  for (const relativePath of removablePaths) {
    await rm(path.join(repoRoot, relativePath), { force: true });
  }

  return removablePaths;
}

export async function main(): Promise<void> {
  const removedPaths = await cleanGeneratedSourceArtifacts();

  if (removedPaths.length === 0) {
    console.log("No untracked generated source artifacts required cleanup.");
    return;
  }

  console.log(`Removed ${removedPaths.length} untracked generated source artifact(s).`);
  for (const relativePath of removedPaths) {
    console.log(`- ${relativePath}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
