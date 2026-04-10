import { accessSync } from "node:fs";
import { access, readFile } from "node:fs/promises";

export interface LocalStatePathInput {
  currentPath: string;
}

export function hasLocalStatePathSync(input: LocalStatePathInput): boolean {
  try {
    accessSync(input.currentPath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

export async function hasLocalStatePath(input: LocalStatePathInput): Promise<boolean> {
  try {
    await access(input.currentPath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

export async function readLocalStateTextFile(
  input: LocalStatePathInput,
): Promise<{ path: string; text: string }> {
  return {
    path: input.currentPath,
    text: await readFile(input.currentPath, "utf8"),
  };
}
