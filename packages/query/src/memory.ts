import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  memoryDocumentRelativePath,
  parseMemoryDocument,
  renderMemoryDocument,
  searchMemoryRecords,
  type MemoryDocumentSnapshot,
  type MemoryRecord,
  type MemorySearchHit,
  type SearchMemoryRecordsInput,
} from "../../contracts/src/memory.js";

export type {
  MemoryDocumentSnapshot,
  MemoryRecord,
  MemorySearchHit,
  SearchMemoryRecordsInput,
} from "../../contracts/src/memory.js";

export async function readMemoryDocument(
  vaultRoot: string,
): Promise<MemoryDocumentSnapshot> {
  const sourcePath = memoryDocumentPath(vaultRoot);

  try {
    const markdown = await readFile(sourcePath, "utf8");
    const document = parseMemoryDocument({
      sourcePath: memoryDocumentRelativePath,
      text: markdown,
    });

    return {
      ...document,
      exists: true,
      markdown,
      sourcePath: memoryDocumentRelativePath,
      updatedAt: document.frontmatter.updatedAt,
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const document = createEmptyMemoryDocument();
    return {
      ...document,
      exists: false,
      markdown: renderMemoryDocument({ document }),
      sourcePath: memoryDocumentRelativePath,
      updatedAt: null,
    };
  }
}

export async function getMemoryRecord(
  vaultRoot: string,
  recordId: string,
): Promise<MemoryRecord | null> {
  const snapshot = await readMemoryDocument(vaultRoot);
  return snapshot.records.find((record) => record.id === recordId) ?? null;
}

export async function searchMemory(
  vaultRoot: string,
  input: SearchMemoryRecordsInput,
): Promise<MemorySearchHit[]> {
  const snapshot = await readMemoryDocument(vaultRoot);
  return searchMemoryRecords(snapshot, input);
}

export async function buildMemoryReadPromptBlock(
  vaultRoot: string,
): Promise<string | null> {
  return buildMemoryPromptBlock(await readMemoryDocument(vaultRoot));
}

function memoryDocumentPath(vaultRoot: string): string {
  return path.join(vaultRoot, memoryDocumentRelativePath);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
