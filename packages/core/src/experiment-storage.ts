import path from "node:path";
import { promises as fs } from "node:fs";

import {
  classifyExperimentStorageFile,
  EXPERIMENTS_DIRECTORY,
  EXPERIMENT_OUTCOMES_DIRECTORY,
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

/**
 * Bounds the residue inspection below one direct experiment subdirectory.
 *
 * Reclaimed legacy trees are a handful of empty directories, so this only has
 * to be large enough to prove that shape inert while keeping the lifecycle
 * reader's work bounded.
 */
const MAX_EXPERIMENT_RESIDUE_ENTRIES = 4_096;

const EXPERIMENT_OUTCOMES_DIRECTORY_NAME =
  EXPERIMENT_OUTCOMES_DIRECTORY.split("/").at(-1);

/**
 * Proves a direct subdirectory cannot hide a canonical experiment document.
 *
 * A directory is never a document, but it can *contain* one, and a reader that
 * skipped it unconditionally would hand back a complete-looking snapshot that
 * silently omits that experiment. Callers archive support automations and
 * resolve due one-shots from this snapshot, so absence has to mean absence.
 * Anything this cannot prove inert — a Markdown file at any depth, a symlink,
 * a non-regular file, or a tree larger than the bound — returns false so the
 * caller fails closed instead.
 */
async function experimentDirectoryIsDocumentFree(
  absoluteDirectory: string,
): Promise<boolean> {
  const pending = [absoluteDirectory];
  let inspected = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }

    for (const child of await fs.readdir(current, { withFileTypes: true })) {
      inspected += 1;
      if (inspected > MAX_EXPERIMENT_RESIDUE_ENTRIES) {
        return false;
      }
      if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) {
        return false;
      }
      if (child.isDirectory()) {
        pending.push(path.join(current, child.name));
        continue;
      }
      if (isMarkdownFileName(child.name)) {
        return false;
      }
    }
  }

  return true;
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

/** Classifies one direct experiment-root entry the lifecycle reader may skip. */
async function experimentStorageEntryIsProvenInert(
  entry: { isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean; name: string },
  absolutePath: string,
): Promise<boolean> {
  if (entry.isSymbolicLink()) {
    return false;
  }
  if (entry.isDirectory()) {
    return entry.name === EXPERIMENT_OUTCOMES_DIRECTORY_NAME
      || await experimentDirectoryIsDocumentFree(absolutePath);
  }
  return entry.isFile() && !isMarkdownFileName(entry.name);
}

/**
 * Lists only direct experiment documents without walking the outcomes tree.
 *
 * Lifecycle maintenance uses this boundary instead of the general storage
 * scan so foreground work can interrupt directory enumeration and so one
 * maintenance pass can never admit an unbounded number of documents.
 *
 * Residue that is *proven* unable to hold a canonical document is skipped
 * rather than fatal: non-Markdown regular files, and directories whose subtree
 * contains no Markdown at all. Reclaimed legacy media trees are that shape, and
 * `validateVault` already reports them, so refusing to list anything because one
 * is present only costs the caller its whole pass.
 *
 * Everything else still fails closed, because callers treat this snapshot as
 * authoritative absence — they archive support automations and resolve due
 * one-shots from it. Silently omitting a document that exists would delete the
 * user's experiment work. So a stray Markdown file, a directory holding Markdown
 * at any depth, a symlink, and a non-regular file all remain
 * `EXPERIMENT_STORAGE_INVALID`.
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
      if (
        await experimentStorageEntryIsProvenInert(
          entry,
          path.join(experimentRoot.absolutePath, entry.name),
        )
      ) {
        continue;
      }

      throw new VaultError(
        "EXPERIMENT_STORAGE_INVALID",
        "Experiment storage contains an entry that could hold an experiment document.",
        { relativePath },
      );
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
