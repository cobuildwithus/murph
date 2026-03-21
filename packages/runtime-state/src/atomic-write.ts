import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await writeFile(tempPath, normalizedValue, "utf8");

    if (typeof options.mode === "number") {
      await chmod(tempPath, options.mode);
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
