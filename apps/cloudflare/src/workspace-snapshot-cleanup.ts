import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

export async function pruneHostedWorkspaceSnapshotRuntimeOwnedSymlinks(input: {
  durableRoot: string;
  operatorHomeRoot: string;
}): Promise<{ prunedRuntimeSymlinkCount: number }> {
  const durableRoot = path.resolve(input.durableRoot);
  const operatorHomeRoot = path.resolve(input.operatorHomeRoot);
  if (!isSameOrDescendantPath(operatorHomeRoot, durableRoot)) {
    return { prunedRuntimeSymlinkCount: 0 };
  }

  const rootStats = await lstatIfPresent(operatorHomeRoot);
  if (!rootStats) {
    return { prunedRuntimeSymlinkCount: 0 };
  }
  if (rootStats.isSymbolicLink()) {
    throw new Error("Hosted workspace snapshot operator home root is a symlink.");
  }
  if (!rootStats.isDirectory()) {
    return { prunedRuntimeSymlinkCount: 0 };
  }

  return {
    prunedRuntimeSymlinkCount: await pruneRuntimeOwnedRoot(
      path.join(operatorHomeRoot, ".codex-hosted"),
    ),
  };
}

async function pruneRuntimeOwnedRoot(rootPath: string): Promise<number> {
  const stats = await lstatIfPresent(rootPath);
  if (!stats) {
    return 0;
  }
  if (stats.isSymbolicLink()) {
    await rm(rootPath, { force: true });
    return 1;
  }
  if (!stats.isDirectory()) {
    return 0;
  }
  return await pruneSymlinkEntriesBelow(rootPath);
}

async function pruneSymlinkEntriesBelow(directoryPath: string): Promise<number> {
  const entries = await readdirIfPresent(directoryPath);
  let prunedCount = 0;
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry);
    const stats = await lstatIfPresent(entryPath);
    if (!stats) {
      continue;
    }
    if (stats.isSymbolicLink()) {
      await rm(entryPath, { force: true });
      prunedCount += 1;
      continue;
    }
    if (stats.isDirectory()) {
      prunedCount += await pruneSymlinkEntriesBelow(entryPath);
    }
  }
  return prunedCount;
}

async function lstatIfPresent(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function readdirIfPresent(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function isSameOrDescendantPath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
