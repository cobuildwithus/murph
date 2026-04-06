import path from "node:path";

import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  forgetMemoryRecord,
  memoryDocumentRelativePath,
  parseMemoryDocument,
  renderMemoryDocument,
  searchMemoryRecords,
  type ForgetMemoryRecordInput,
  type MemoryDocument,
  type MemoryDocumentSnapshot,
  type MemoryRecord,
  type MemorySearchHit,
  type MemorySection,
  type SearchMemoryRecordsInput,
  type UpsertMemoryRecordInput,
  upsertMemoryRecord,
} from "@murphai/contracts";

import {
  ensureVaultDirectory,
  pathExists,
  readUtf8File,
  writeVaultTextFile,
} from "./fs.ts";
import { resolveVaultPath } from "./path-safety.ts";

export type {
  ForgetMemoryRecordInput,
  MemoryDocument,
  MemoryDocumentSnapshot,
  MemoryRecord,
  MemorySearchHit,
  MemorySection,
  SearchMemoryRecordsInput,
  UpsertMemoryRecordInput,
} from "@murphai/contracts";

export function resolveMemoryDocumentPath(vaultRoot: string): string {
  return resolveVaultPath(vaultRoot, memoryDocumentRelativePath).absolutePath;
}

export async function readMemoryDocument(
  vaultRoot: string,
): Promise<MemoryDocumentSnapshot> {
  const resolved = resolveVaultPath(vaultRoot, memoryDocumentRelativePath);
  if (!(await pathExists(resolved.absolutePath))) {
    const document = createEmptyMemoryDocument();
    return {
      ...document,
      exists: false,
      markdown: renderMemoryDocument({ document }),
      sourcePath: resolved.relativePath,
      updatedAt: null,
    };
  }

  const markdown = await readUtf8File(vaultRoot, memoryDocumentRelativePath);
  const document = parseMemoryDocument({
    sourcePath: resolved.relativePath,
    text: markdown,
  });

  return {
    ...document,
    exists: true,
    markdown,
    sourcePath: resolved.relativePath,
    updatedAt: document.frontmatter.updatedAt,
  };
}

export async function getMemoryRecord(
  vaultRoot: string,
  recordId: string,
): Promise<MemoryRecord | null> {
  const snapshot = await readMemoryDocument(vaultRoot);
  return snapshot.records.find((record) => record.id === recordId) ?? null;
}

export async function upsertMemory(
  vaultRoot: string,
  input: UpsertMemoryRecordInput,
): Promise<{
  created: boolean;
  document: MemoryDocumentSnapshot;
  record: MemoryRecord;
}> {
  const snapshot = await readMemoryDocument(vaultRoot);
  const next = upsertMemoryRecord(snapshot, input);
  await ensureVaultDirectory(vaultRoot, path.posix.dirname(memoryDocumentRelativePath));
  await writeVaultTextFile(
    vaultRoot,
    memoryDocumentRelativePath,
    renderMemoryDocument({ document: next.document }),
  );

  const nextSnapshot = await readMemoryDocument(vaultRoot);

  return {
    created: next.created,
    document: nextSnapshot,
    record: nextSnapshot.records.find((record) => record.id === next.record.id) ?? next.record,
  };
}

export async function forgetMemory(
  vaultRoot: string,
  input: ForgetMemoryRecordInput,
): Promise<{
  document: MemoryDocumentSnapshot;
  existed: boolean;
  record: MemoryRecord | null;
}> {
  const snapshot = await readMemoryDocument(vaultRoot);
  const next = forgetMemoryRecord(snapshot, input);
  if (next.record === null) {
    return {
      document: snapshot,
      existed: false,
      record: null,
    };
  }

  await ensureVaultDirectory(vaultRoot, path.posix.dirname(memoryDocumentRelativePath));
  const markdown = renderMemoryDocument({ document: next.document });
  await writeVaultTextFile(vaultRoot, memoryDocumentRelativePath, markdown);
  const nextSnapshot = await readMemoryDocument(vaultRoot);

  return {
    document: nextSnapshot,
    existed: true,
    record: next.record,
  };
}

export async function buildMemoryCorePromptBlock(vaultRoot: string): Promise<string | null> {
  return buildMemoryPromptBlock(await readMemoryDocument(vaultRoot));
}

export async function searchMemory(
  vaultRoot: string,
  input: SearchMemoryRecordsInput,
): Promise<MemorySearchHit[]> {
  return searchMemoryRecords(await readMemoryDocument(vaultRoot), input);
}
