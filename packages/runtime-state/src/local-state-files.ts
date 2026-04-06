import { readFile, stat } from "node:fs/promises";
import { statSync } from "node:fs";

export interface LocalStatePathInput {
  currentPath: string;
}

export function hasLocalStatePathSync(input: LocalStatePathInput): boolean {
  try {
    statSync(input.currentPath);
    return true;
  } catch {
    return false;
  }
}

export async function hasLocalStatePath(input: LocalStatePathInput): Promise<boolean> {
  try {
    await stat(input.currentPath);
    return true;
  } catch {
    return false;
  }
}

export async function readLocalStateTextFile(
  input: LocalStatePathInput,
): Promise<{ path: string; text: string }> {
  return {
    path: input.currentPath,
    text: await readFile(input.currentPath, "utf8"),
  };
}
