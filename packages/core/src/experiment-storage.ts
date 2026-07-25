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

export interface CanonicalExperimentDocumentPathPage {
  relativePaths: string[];
  yielded: boolean;
}

function isMarkdownFileName(name: string): boolean {
  return path.extname(name).toLowerCase() === ".md";
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

/**
 * Lists only direct experiment documents without walking the outcomes tree.
 *
 * Lifecycle maintenance uses this boundary instead of the general storage
 * scan so foreground work can interrupt directory enumeration and so one
 * maintenance pass can never admit an unbounded number of documents.
 *
 * Residue that cannot be a canonical document is skipped rather than fatal.
 * Directories, symlinks, and non-Markdown files are inert here, and
 * `validateVault` already reports them as storage issues, so refusing to list
 * anything because one is present only costs the caller its whole pass. A
 * stray Markdown file is the one case still worth failing closed on: it may be
 * a mis-named experiment document, and silently dropping it would take that
 * experiment out of lifecycle care without anyone noticing.
 */
export async function listCanonicalExperimentDocumentPathsInterruptible(input: {
  vaultRoot: string;
  maxDocuments: number;
  shouldYield?: (() => boolean) | null;
}): Promise<CanonicalExperimentDocumentPathPage> {
  if (!Number.isSafeInteger(input.maxDocuments) || input.maxDocuments <= 0) {
    throw new TypeError("Experiment document limits must be positive safe integers.");
  }

  if (input.shouldYield?.() === true) {
    return { relativePaths: [], yielded: true };
  }

  const absoluteRoot = normalizeVaultRoot(input.vaultRoot);
  const experimentRoot = resolveVaultPath(absoluteRoot, EXPERIMENTS_DIRECTORY);
  const experimentRootExists = await pathExists(experimentRoot.absolutePath);
  if (input.shouldYield?.() === true) {
    return { relativePaths: [], yielded: true };
  }
  if (!experimentRootExists) {
    return { relativePaths: [], yielded: false };
  }

  await assertPathWithinVaultOnDisk(absoluteRoot, experimentRoot.absolutePath);
  if (input.shouldYield?.() === true) {
    return { relativePaths: [], yielded: true };
  }
  const relativePaths: string[] = [];

  for await (const entry of await fs.opendir(experimentRoot.absolutePath)) {
    if (input.shouldYield?.() === true) {
      return { relativePaths: [], yielded: true };
    }

    const relativePath = `${EXPERIMENTS_DIRECTORY}/${entry.name}`;
    if (!entry.isFile() || !isExperimentDocumentRelativePath(relativePath)) {
      if (entry.isFile() && isMarkdownFileName(entry.name)) {
        throw new VaultError(
          "EXPERIMENT_STORAGE_INVALID",
          "Experiment storage contains an unsupported direct Markdown entry.",
          { relativePath },
        );
      }
      continue;
    }

    if (relativePaths.length >= input.maxDocuments) {
      throw new VaultError(
        "EXPERIMENT_LIFECYCLE_LIMIT_EXCEEDED",
        "Experiment lifecycle maintenance exceeded its bounded document limit.",
        { maxDocuments: input.maxDocuments },
      );
    }
    relativePaths.push(relativePath);
  }

  if (input.shouldYield?.() === true) {
    return { relativePaths: [], yielded: true };
  }
  relativePaths.sort((left, right) => left.localeCompare(right));
  return { relativePaths, yielded: false };
}
