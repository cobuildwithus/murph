import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

export async function pruneHostedWorkspaceSnapshotRuntimeOwnedSymlinks(input: {
  durableRoot: string;
  operatorHomeRoot: string;
  signal?: AbortSignal | null;
}): Promise<{ prunedRuntimeSymlinkCount: number }> {
  input.signal?.throwIfAborted();
  const durableRoot = path.resolve(input.durableRoot);
  const operatorHomeRoot = path.resolve(input.operatorHomeRoot);
  if (!isSameOrDescendantPath(operatorHomeRoot, durableRoot)) {
    return { prunedRuntimeSymlinkCount: 0 };
  }

  const rootStats = await lstatIfPresent(operatorHomeRoot, input.signal);
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
      input.signal,
    ),
  };
}

async function pruneRuntimeOwnedRoot(
  rootPath: string,
  signal?: AbortSignal | null,
): Promise<number> {
  signal?.throwIfAborted();
  const stats = await lstatIfPresent(rootPath, signal);
  if (!stats) {
    return 0;
  }
  if (stats.isSymbolicLink()) {
    await rm(rootPath, { force: true });
    signal?.throwIfAborted();
    return 1;
  }
  if (!stats.isDirectory()) {
    return 0;
  }
  return await pruneSymlinkEntriesBelow(rootPath, signal);
}

async function pruneSymlinkEntriesBelow(
  directoryPath: string,
  signal?: AbortSignal | null,
): Promise<number> {
  signal?.throwIfAborted();
  const entries = await readdirIfPresent(directoryPath, signal);
  let prunedCount = 0;
  for (const entry of entries) {
    signal?.throwIfAborted();
    const entryPath = path.join(directoryPath, entry);
    const stats = await lstatIfPresent(entryPath, signal);
    if (!stats) {
      continue;
    }
    if (stats.isSymbolicLink()) {
      await rm(entryPath, { force: true });
      signal?.throwIfAborted();
      prunedCount += 1;
      continue;
    }
    if (stats.isDirectory()) {
      prunedCount += await pruneSymlinkEntriesBelow(entryPath, signal);
    }
  }
  return prunedCount;
}

async function lstatIfPresent(
  filePath: string,
  signal?: AbortSignal | null,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  signal?.throwIfAborted();
  try {
    const stats = await lstat(filePath);
    signal?.throwIfAborted();
    return stats;
  } catch (error) {
    signal?.throwIfAborted();
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function readdirIfPresent(
  directoryPath: string,
  signal?: AbortSignal | null,
): Promise<string[]> {
  signal?.throwIfAborted();
  try {
    const entries = await readdir(directoryPath);
    signal?.throwIfAborted();
    return entries;
  } catch (error) {
    signal?.throwIfAborted();
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
