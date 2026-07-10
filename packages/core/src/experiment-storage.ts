import path from "node:path";
import { promises as fs } from "node:fs";

import {
  classifyExperimentStorageFile,
  EXPERIMENTS_DIRECTORY,
  isExperimentDocumentRelativePath,
  type ExperimentStorageFileKind,
} from "@murphai/contracts";

import { VaultError } from "./errors.ts";
import { pathExists } from "./fs.ts";
import {
  assertPathWithinVaultOnDisk,
  normalizeVaultRoot,
  resolveVaultPath,
} from "./path-safety.ts";

export interface ExperimentStorageEntry {
  entryKind: "file" | "symlink" | "special";
  fileKind: ExperimentStorageFileKind;
  modifiedAt: string | null;
  relativePath: string;
  sizeBytes: number | null;
}

export function assertExperimentDocumentRelativePath(relativePath: string): void {
  if (isExperimentDocumentRelativePath(relativePath)) {
    return;
  }

  throw new VaultError(
    "EXPERIMENT_PATH_INVALID",
    "Experiment reads and writes require a direct slug-named Markdown document.",
    { relativePath },
  );
}

export async function scanExperimentStorage(
  vaultRoot: string,
): Promise<ExperimentStorageEntry[]> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const experimentRoot = resolveVaultPath(absoluteRoot, EXPERIMENTS_DIRECTORY);
  if (!(await pathExists(experimentRoot.absolutePath))) {
    return [];
  }

  await assertPathWithinVaultOnDisk(absoluteRoot, experimentRoot.absolutePath);
  const entries: ExperimentStorageEntry[] = [];

  async function walk(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
    await assertPathWithinVaultOnDisk(absoluteRoot, absoluteDirectory);
    const children = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const absolutePath = path.join(absoluteDirectory, child.name);
      const relativePath = `${relativeDirectory}/${child.name}`;
      const stats = await fs.lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        entries.push({
          entryKind: "symlink",
          fileKind: "unsupported",
          modifiedAt: null,
          relativePath,
          sizeBytes: null,
        });
        continue;
      }

      if (stats.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!stats.isFile()) {
        entries.push({
          entryKind: "special",
          fileKind: "unsupported",
          modifiedAt: null,
          relativePath,
          sizeBytes: null,
        });
        continue;
      }

      entries.push({
        entryKind: "file",
        fileKind: classifyExperimentStorageFile(relativePath),
        modifiedAt: stats.mtime.toISOString(),
        relativePath,
        sizeBytes: stats.size,
      });
    }
  }

  await walk(experimentRoot.absolutePath, EXPERIMENTS_DIRECTORY);
  return entries;
}

export async function listCanonicalExperimentDocumentPaths(
  vaultRoot: string,
): Promise<string[]> {
  return (await scanExperimentStorage(vaultRoot))
    .filter((entry) => entry.entryKind === "file" && entry.fileKind === "document")
    .map((entry) => entry.relativePath);
}
