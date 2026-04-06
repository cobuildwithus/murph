import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

export interface LegacyLocalStatePathInput {
  currentPath: string;
  legacyPath?: string | null;
}

export interface PromoteLegacyLocalStateFileSyncInput extends LegacyLocalStatePathInput {
  companionSuffixes?: readonly string[];
}

function pathExistsSync(targetPath: string): boolean {
  try {
    statSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function hasLocalStatePathSync(input: LegacyLocalStatePathInput): boolean {
  return pathExistsSync(input.currentPath)
    || (typeof input.legacyPath === "string" && input.legacyPath.length > 0 && pathExistsSync(input.legacyPath));
}

export async function hasLocalStatePath(input: LegacyLocalStatePathInput): Promise<boolean> {
  return (await pathExists(input.currentPath))
    || (typeof input.legacyPath === "string" && input.legacyPath.length > 0 && await pathExists(input.legacyPath));
}

export function promoteLegacyLocalStateDirectorySync(input: LegacyLocalStatePathInput): boolean {
  const legacyPath = normalizeLegacyPath(input.legacyPath);

  if (!legacyPath || pathExistsSync(input.currentPath) || !pathExistsSync(legacyPath)) {
    return false;
  }

  mkdirSync(path.dirname(input.currentPath), { recursive: true });
  renameSync(legacyPath, input.currentPath);
  return true;
}

export async function promoteLegacyLocalStateDirectory(
  input: LegacyLocalStatePathInput,
): Promise<boolean> {
  const legacyPath = normalizeLegacyPath(input.legacyPath);

  if (!legacyPath || await pathExists(input.currentPath) || !(await pathExists(legacyPath))) {
    return false;
  }

  await mkdir(path.dirname(input.currentPath), { recursive: true });
  await rename(legacyPath, input.currentPath);
  return true;
}

export function promoteLegacyLocalStateFileSync(
  input: PromoteLegacyLocalStateFileSyncInput,
): boolean {
  const legacyPath = normalizeLegacyPath(input.legacyPath);

  if (!legacyPath || pathExistsSync(input.currentPath) || !pathExistsSync(legacyPath)) {
    return false;
  }

  mkdirSync(path.dirname(input.currentPath), { recursive: true });
  renameSync(legacyPath, input.currentPath);

  for (const suffix of input.companionSuffixes ?? []) {
    const legacyCompanionPath = `${legacyPath}${suffix}`;
    if (!pathExistsSync(legacyCompanionPath)) {
      continue;
    }

    const currentCompanionPath = `${input.currentPath}${suffix}`;
    if (pathExistsSync(currentCompanionPath)) {
      continue;
    }

    renameSync(legacyCompanionPath, currentCompanionPath);
  }

  return true;
}

export async function promoteLegacyLocalStateFile(
  input: PromoteLegacyLocalStateFileSyncInput,
): Promise<boolean> {
  const legacyPath = normalizeLegacyPath(input.legacyPath);

  if (!legacyPath || await pathExists(input.currentPath) || !(await pathExists(legacyPath))) {
    return false;
  }

  await mkdir(path.dirname(input.currentPath), { recursive: true });
  await rename(legacyPath, input.currentPath);

  for (const suffix of input.companionSuffixes ?? []) {
    const legacyCompanionPath = `${legacyPath}${suffix}`;
    if (!(await pathExists(legacyCompanionPath))) {
      continue;
    }

    const currentCompanionPath = `${input.currentPath}${suffix}`;
    if (await pathExists(currentCompanionPath)) {
      continue;
    }

    await rename(legacyCompanionPath, currentCompanionPath);
  }

  return true;
}

export async function readLocalStateTextFileWithFallback(
  input: LegacyLocalStatePathInput,
): Promise<{ path: string; text: string }> {
  await promoteLegacyLocalStateFile(input);

  try {
    return {
      path: input.currentPath,
      text: await readFile(input.currentPath, "utf8"),
    };
  } catch (error) {
    const legacyPath = normalizeLegacyPath(input.legacyPath);

    if (!legacyPath || !isMissingFileError(error) || !(await pathExists(legacyPath))) {
      throw error;
    }

    return {
      path: legacyPath,
      text: await readFile(legacyPath, "utf8"),
    };
  }
}

function normalizeLegacyPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
