import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR =
  "apps/web/app/.well-known/workflow";
export const HOSTED_WEB_WORKFLOW_GENERATED_CONFIG_PATH =
  `${HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR}/v1/config.json`;
export const HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV =
  "MURPH_HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_PATH";
export const HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME =
  "workflow-config.json";
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
  prebuiltConfigCapturePath?: string;
  repoRoot?: string;
} = {}): Promise<string[]> {
  const repoRoot = input.repoRoot ?? defaultRepoRoot;
  const removedPaths: string[] = [];

  if (input.prebuiltConfigCapturePath) {
    await capturePrebuiltWorkflowConfig(
      repoRoot,
      input.prebuiltConfigCapturePath,
    );
  }

  await removeIfPresent(
    repoRoot,
    HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR,
    removedPaths,
  );

  for (const relativePath of HOSTED_WEB_WORKFLOW_GENERATED_CACHE_PATHS) {
    await removeIfPresent(repoRoot, relativePath, removedPaths);
  }

  await removeWorkflowGeneratedSourceMaps(repoRoot, removedPaths);

  return removedPaths.sort();
}

async function capturePrebuiltWorkflowConfig(
  repoRoot: string,
  capturePath: string,
): Promise<void> {
  if (
    !path.isAbsolute(capturePath) ||
    path.basename(capturePath) !==
      HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME
  ) {
    throw new Error(
      "Workflow SDK config capture must use the local prebuilt temporary file.",
    );
  }

  const sourcePath = path.join(
    repoRoot,
    HOSTED_WEB_WORKFLOW_GENERATED_CONFIG_PATH,
  );
  let sourceStats;
  try {
    sourceStats = await lstat(sourcePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        "Workflow SDK config is missing at the local prebuilt capture boundary.",
      );
    }
    throw new Error(
      "Unable to inspect the Workflow SDK config at the local prebuilt capture boundary.",
    );
  }
  if (!sourceStats.isFile()) {
    throw new Error(
      "Workflow SDK config must be a regular file at the local prebuilt capture boundary.",
    );
  }

  const resolvedRepoRoot = await realpath(repoRoot);
  const resolvedSourcePath = await realpath(sourcePath);
  assertPathWithin(
    resolvedRepoRoot,
    resolvedSourcePath,
    "Workflow SDK config",
  );

  const captureDirectory = path.dirname(capturePath);
  let captureDirectoryStats;
  try {
    captureDirectoryStats = await lstat(captureDirectory);
  } catch {
    throw new Error(
      "Local prebuilt Workflow config capture directory is unavailable.",
    );
  }
  if (!captureDirectoryStats.isDirectory()) {
    throw new Error(
      "Local prebuilt Workflow config capture directory must be a regular directory.",
    );
  }

  const resolvedTemporaryRoot = await realpath(os.tmpdir());
  const resolvedCaptureDirectory = await realpath(captureDirectory);
  assertPathWithin(
    resolvedTemporaryRoot,
    resolvedCaptureDirectory,
    "Local prebuilt Workflow config capture directory",
  );
  const resolvedCapturePath = path.join(
    resolvedCaptureDirectory,
    HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
  );

  try {
    await copyFile(
      resolvedSourcePath,
      resolvedCapturePath,
      fsConstants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new Error(
        "A stale Workflow SDK config capture blocks the local prebuilt build.",
      );
    }
    throw new Error(
      "Unable to capture the Workflow SDK config for the local prebuilt build.",
    );
  }
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

function assertPathWithin(
  rootPath: string,
  candidatePath: string,
  label: string,
): void {
  const relativePath = path.relative(rootPath, candidatePath);
  if (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  ) {
    return;
  }
  throw new Error(`${label} resolves outside its allowed boundary.`);
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes("--quiet");
  const removedPaths = await cleanHostedWebWorkflowGeneratedArtifacts({
    prebuiltConfigCapturePath:
      process.env[HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV],
  });

  if (quiet) {
    return;
  }

  console.log(`Removed generated Workflow artifacts: ${removedPaths.join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
