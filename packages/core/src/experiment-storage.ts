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

/**
 * Bounds one lifecycle enumeration so a pathological tree cannot run unbounded.
 *
 * Experiment storage holds one document per experiment plus one JSON record per
 * completed outcome, so this sits far above any real vault and exists only as a
 * ceiling.
 */
const MAX_EXPERIMENT_STORAGE_ENTRIES = 16_384;

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
 * Lists the canonical experiment documents, bounded and interruptible.
 *
 * Callers treat this snapshot as *authoritative absence*: support-series
 * reconciliation archives automations for experiments it does not name, and
 * fire-time one-shot lookup consumes an occurrence whose owner it cannot find.
 * Completeness is therefore the contract, and one rule enforces it at every
 * depth — the same `classifyExperimentStorageFile` the write policy and
 * `validateVault` already use, so there is no second notion of what belongs
 * here to drift apart from.
 *
 * Every regular file is classified by its own path. A document is listed, an
 * outcome record is ignored, and anything else is fatal only when it could
 * itself be a document — that is, when it is Markdown. That single rule covers
 * the reserved outcomes subtree without naming it, so a document hidden there
 * fails closed like any other.
 *
 * Directories are pure containers and are walked, never trusted by name, which
 * is what makes the reclaimed legacy media trees this reader must tolerate
 * (nested but holding no Markdown) inert without an exemption. Symlinks and
 * non-regular entries can stand in for a document and stay fatal.
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
  const pending: Array<{ absolutePath: string; relativePath: string }> = [{
    absolutePath: experimentRoot.absolutePath,
    relativePath: EXPERIMENTS_DIRECTORY,
  }];
  let inspected = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      break;
    }

    for (
      const entry of await fs.readdir(directory.absolutePath, { withFileTypes: true })
    ) {
      if (input.shouldYield?.() === true) {
        return { relativePaths: [], yielded: true };
      }

      inspected += 1;
      if (inspected > MAX_EXPERIMENT_STORAGE_ENTRIES) {
        throw new VaultError(
          "EXPERIMENT_LIFECYCLE_LIMIT_EXCEEDED",
          "Experiment lifecycle maintenance exceeded its bounded storage limit.",
          { maxEntries: MAX_EXPERIMENT_STORAGE_ENTRIES },
        );
      }

      const relativePath = `${directory.relativePath}/${entry.name}`;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new VaultError(
          "EXPERIMENT_STORAGE_INVALID",
          "Experiment storage contains an entry that could stand in for a document.",
          { relativePath },
        );
      }

      if (entry.isDirectory()) {
        pending.push({
          absolutePath: path.join(directory.absolutePath, entry.name),
          relativePath,
        });
        continue;
      }

      const fileKind = classifyExperimentStorageFile(relativePath);
      if (fileKind === "outcome") {
        continue;
      }
      if (fileKind === "unsupported") {
        if (isMarkdownFileName(entry.name)) {
          throw new VaultError(
            "EXPERIMENT_STORAGE_INVALID",
            "Experiment storage contains a Markdown file that is not a canonical document.",
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
  }

  if (input.shouldYield?.() === true) {
    return { relativePaths: [], yielded: true };
  }
  relativePaths.sort((left, right) => left.localeCompare(right));
  return { relativePaths, yielded: false };
}
