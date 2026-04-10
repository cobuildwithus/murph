import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  forgetMemoryRecord,
  memoryDocumentRelativePath,
  parseMemoryDocument,
  renderMemoryDocument,
  type ForgetMemoryRecordInput,
  type MemoryDocument,
  type MemoryDocumentSnapshot,
  type MemoryRecord,
  type MemorySection,
  type UpsertMemoryRecordInput,
  upsertMemoryRecord,
} from "@murphai/contracts";

import {
  pathExists,
  readUtf8File,
} from "./fs.ts";
import {
  stageMarkdownDocumentWrite,
  resolveSingletonMarkdownDocumentTarget,
  writeCanonicalMarkdownDocument,
} from "./markdown-documents.ts";
import {
  canonicalPathResource,
  runCanonicalWrite,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import { resolveVaultPath } from "./path-safety.ts";

export type {
  ForgetMemoryRecordInput,
  MemoryDocument,
  MemoryDocumentSnapshot,
  MemoryRecord,
  MemorySection,
  UpsertMemoryRecordInput,
} from "@murphai/contracts";

export interface UpdateMemoryInput {
  now?: Date;
  recordId: string;
  section?: MemorySection | null;
  text: string;
}

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
  return await withLockedMemoryDocument(vaultRoot, async () => {
    const snapshot = await readMemoryDocument(vaultRoot);
    return await persistUpsertMemory(vaultRoot, snapshot, input);
  });
}

export async function updateMemory(
  vaultRoot: string,
  input: UpdateMemoryInput,
): Promise<{
  document: MemoryDocumentSnapshot;
  record: MemoryRecord;
}> {
  return await withLockedMemoryDocument(vaultRoot, async () => {
    const result = await runCanonicalWrite({
      vaultRoot,
      operationType: "memory_update",
      summary: `Update memory record ${input.recordId}`,
      occurredAt: input.now,
      mutate: async ({ batch, vaultRoot: lockedVaultRoot }) => {
        const snapshot = await readMemoryDocument(lockedVaultRoot);
        const existing = snapshot.records.find((record) => record.id === input.recordId) ?? null;
        if (existing === null) {
          throw new Error(`Memory record "${input.recordId}" does not exist.`);
        }

        const next = upsertMemoryRecord(snapshot, {
          now: input.now,
          recordId: input.recordId,
          section: input.section ?? existing.section,
          text: input.text,
        });
        await stageMarkdownDocumentWrite(
          batch,
          resolveSingletonMarkdownDocumentTarget({
            relativePath: memoryDocumentRelativePath,
            created: !snapshot.exists,
          }),
          renderMemoryDocument({ document: next.document }),
        );

        return {
          recordId: next.record.id,
        };
      },
    });
    const persisted = await readPersistedMemoryRecord(vaultRoot, result.recordId, "update");

    return {
      document: persisted.document,
      record: persisted.record,
    };
  });
}

export async function forgetMemory(
  vaultRoot: string,
  input: ForgetMemoryRecordInput,
): Promise<{
  document: MemoryDocumentSnapshot;
  existed: boolean;
  record: MemoryRecord | null;
}> {
  return await withLockedMemoryDocument(vaultRoot, async () => {
    const snapshot = await readMemoryDocument(vaultRoot);
    const next = forgetMemoryRecord(snapshot, input);
    if (next.record === null) {
      return {
        document: snapshot,
        existed: false,
        record: null,
      };
    }

    const markdown = renderMemoryDocument({ document: next.document });
    await writeCanonicalMarkdownDocument({
      vaultRoot,
      operationType: "memory_forget",
      summary: `Forget memory record ${next.record.id}`,
      target: resolveSingletonMarkdownDocumentTarget({
        relativePath: memoryDocumentRelativePath,
        created: !snapshot.exists,
      }),
      markdown,
    });
    const nextSnapshot = await readMemoryDocument(vaultRoot);

    return {
      document: nextSnapshot,
      existed: true,
      record: next.record,
    };
  });
}

export async function buildMemoryCorePromptBlock(vaultRoot: string): Promise<string | null> {
  return buildMemoryPromptBlock(await readMemoryDocument(vaultRoot));
}

async function withLockedMemoryDocument<TResult>(
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return await withCanonicalResourceLocks({
    vaultRoot,
    resources: [canonicalPathResource(memoryDocumentRelativePath)],
    run,
  });
}

async function readPersistedMemoryRecord(
  vaultRoot: string,
  recordId: string,
  operation: "update" | "upsert",
): Promise<{
  document: MemoryDocumentSnapshot;
  record: MemoryRecord;
}> {
  const document = await readMemoryDocument(vaultRoot);
  const record = document.records.find((entry) => entry.id === recordId) ?? null;
  if (record === null) {
    throw new Error(`Memory record "${recordId}" was not found after ${operation}.`);
  }

  return {
    document,
    record,
  };
}

async function persistUpsertMemory(
  vaultRoot: string,
  snapshot: MemoryDocumentSnapshot,
  input: UpsertMemoryRecordInput,
): Promise<{
  created: boolean;
  document: MemoryDocumentSnapshot;
  record: MemoryRecord;
}> {
  const next = upsertMemoryRecord(snapshot, input);
  await writeCanonicalMarkdownDocument({
    vaultRoot,
    operationType: "memory_upsert",
    summary: `Upsert memory record ${next.record.id}`,
    target: resolveSingletonMarkdownDocumentTarget({
      relativePath: memoryDocumentRelativePath,
      created: !snapshot.exists,
    }),
    markdown: renderMemoryDocument({ document: next.document }),
  });
  const persisted = await readPersistedMemoryRecord(vaultRoot, next.record.id, "upsert");

  return {
    created: next.created,
    document: persisted.document,
    record: persisted.record,
  };
}
