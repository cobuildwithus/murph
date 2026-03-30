import { randomUUID } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";

import {
  ensureAssistantStateParentDirectory,
  resolveAssistantStateFileMode,
} from "./assistant-state-security.ts";

export interface AtomicWriteOptions {
  mode?: number;
  trailingNewline?: boolean;
}

export async function writeTextFileAtomic(
  filePath: string,
  value: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const normalizedValue =
    options.trailingNewline && !value.endsWith("\n") ? `${value}\n` : value;
  const tempPath = `${filePath}.${randomUUID().replace(/-/g, "")}.tmp`;
  const mode = resolveAssistantStateFileMode(filePath, options.mode);

  await ensureAssistantStateParentDirectory(filePath);

  try {
    await writeFile(tempPath, normalizedValue, "utf8");

    if (typeof mode === "number") {
      await chmod(tempPath, mode);
    }

    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await writeTextFileAtomic(filePath, JSON.stringify(value, null, 2), {
    ...options,
    trailingNewline: options.trailingNewline ?? true,
  });
}
