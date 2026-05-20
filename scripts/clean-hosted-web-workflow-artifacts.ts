import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR =
  "apps/web/app/.well-known/workflow";
export const HOSTED_WEB_WORKFLOW_GENERATED_CACHE_PATHS = [
  "apps/web/.next/cache/workflow-generated-manifest",
  "apps/web/.next/cache/workflow-socket.json",
  "apps/web/.next/cache/workflows.json",
] as const;

const HOSTED_WEB_WORKFLOW_NEXT_SERVER_DIR = "apps/web/.next/server";
const workflowGeneratedSourceMarkers = [
  "WORKFLOW_STEP_SOURCE_B64:",
  "__workflow_step_files__",
] as const;

export async function cleanHostedWebWorkflowGeneratedArtifacts(input: {
  repoRoot?: string;
} = {}): Promise<string[]> {
  const repoRoot = input.repoRoot ?? defaultRepoRoot;
  const removedPaths: string[] = [];

  await removeIfPresent(repoRoot, HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR, removedPaths);

  for (const relativePath of HOSTED_WEB_WORKFLOW_GENERATED_CACHE_PATHS) {
    await removeIfPresent(repoRoot, relativePath, removedPaths);
  }

  await removeWorkflowGeneratedSourceMaps(repoRoot, removedPaths);

  return removedPaths.sort();
}

async function removeIfPresent(
  repoRoot: string,
  relativePath: string,
  removedPaths: string[],
): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);

  try {
    await lstat(absolutePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  await rm(absolutePath, { force: true, recursive: true });
  removedPaths.push(relativePath);
}

async function removeWorkflowGeneratedSourceMaps(
  repoRoot: string,
  removedPaths: string[],
): Promise<void> {
  const serverDir = path.join(repoRoot, HOSTED_WEB_WORKFLOW_NEXT_SERVER_DIR);

  for (const filePath of await listFiles(serverDir)) {
    if (!filePath.endsWith(".map")) {
      continue;
    }

    let contents: string;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw error;
    }

    if (!workflowGeneratedSourceMarkers.some((marker) => contents.includes(marker))) {
      continue;
    }

    await rm(filePath, { force: true });
    removedPaths.push(path.relative(repoRoot, filePath).replace(/\\/g, "/"));
  }
}

async function listFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const childPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      return listFiles(childPath);
    }

    return entry.isFile() ? [childPath] : [];
  }));

  return files.flat();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes("--quiet");
  const removedPaths = await cleanHostedWebWorkflowGeneratedArtifacts();

  if (quiet) {
    return;
  }

  console.log(`Removed generated Workflow artifacts: ${removedPaths.join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
