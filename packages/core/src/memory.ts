import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  forgetMemoryRecord,
  memoryDocumentRelativePath,
  parseMemoryDocument,
  renderMemoryDocument,
  setMemoryDisplayName as setMemoryDocumentDisplayName,
  type ForgetMemoryRecordInput,
  type MemoryDocument,
  type MemoryDisplayNameResolution,
  type MemoryDocumentSnapshot,
  type MemoryRecord,
  type MemorySection,
  type SetMemoryDisplayNameInput,
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
  canonicalPathResourceForVault,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { commitAuditedCanonicalWrite } from "./audited-write.ts";

export type {
  ForgetMemoryRecordInput,
  MemoryDocument,
  MemoryDisplayNameResolution,
  MemoryDocumentSnapshot,
  MemoryRecord,
  MemorySection,
  SetMemoryDisplayNameInput,
  UpsertMemoryRecordInput,
} from "@murphai/contracts";

export interface UpdateMemoryInput {
  now?: Date;
  recordId: string;
  section?: MemorySection | null;
  text: string;
}

export class MemoryRecordNotFoundError extends Error {
  readonly code = "MEMORY_RECORD_NOT_FOUND";

  constructor() {
    super("The requested canonical memory record does not exist.");
    this.name = "MemoryRecordNotFoundError";
  }
}

export class MemoryPersistenceError extends Error {
  readonly code = "MEMORY_PERSISTENCE_INVALID";

  constructor() {
    super("The canonical memory write could not be verified after it completed.");
    this.name = "MemoryPersistenceError";
  }
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

export async function setMemoryDisplayName(
  vaultRoot: string,
  input: SetMemoryDisplayNameInput,
): Promise<{
  created: boolean;
  document: MemoryDocumentSnapshot;
  record: MemoryRecord;
}> {
  return await withLockedMemoryDocument(vaultRoot, async () => {
    const snapshot = await readMemoryDocument(vaultRoot);
    const next = setMemoryDocumentDisplayName(snapshot, input);
    if (next.document === snapshot) {
      return {
        created: false,
        document: snapshot,
        record: next.record,
      };
    }
    const markdown = renderMemoryDocument({ document: next.document });
    await writeCanonicalMarkdownDocument({
      vaultRoot,
      operationType: "memory_upsert",
      summary: `Set memory display name ${next.record.id}`,
      occurredAt: input.now,
      target: resolveSingletonMarkdownDocumentTarget({
        relativePath: memoryDocumentRelativePath,
        created: !snapshot.exists,
      }),
      markdown,
      audit: {
        action: "memory_upsert",
        commandName: "core.setMemoryDisplayName",
        summary: "Set memory display name.",
        targetIds: [next.record.id],
      },
    });
    const persisted = await readPersistedMemoryRecord(
      vaultRoot,
      next.record.id,
      markdown,
    );

    return {
      created: next.created,
      document: persisted.document,
      record: persisted.record,
    };
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
    const result = await commitAuditedCanonicalWrite({
      vaultRoot,
      operationType: "memory_update",
      summary: `Update memory record ${input.recordId}`,
      occurredAt: input.now,
      audit: {
        action: "memory_upsert",
        commandName: "core.updateMemory",
        summary: `Updated memory record ${input.recordId}.`,
        targetIds: [input.recordId],
      },
      mutate: async ({ batch, vaultRoot: lockedVaultRoot }) => {
        const snapshot = await readMemoryDocument(lockedVaultRoot);
        const existing = snapshot.records.find((record) => record.id === input.recordId) ?? null;
        if (existing === null) {
          throw new MemoryRecordNotFoundError();
        }

        const next = upsertMemoryRecord(snapshot, {
          now: input.now,
          recordId: input.recordId,
          section: input.section ?? existing.section,
          text: input.text,
        });
        const markdown = renderMemoryDocument({ document: next.document });
        await stageMarkdownDocumentWrite(
          batch,
          resolveSingletonMarkdownDocumentTarget({
            relativePath: memoryDocumentRelativePath,
            created: !snapshot.exists,
          }),
          markdown,
        );

        return {
          result: {
            expectedMarkdown: markdown,
            recordId: next.record.id,
          },
          changes: [
            {
              path: memoryDocumentRelativePath,
              op: snapshot.exists ? "update" : "create",
            },
          ],
        };
      },
    });
    const persisted = await readPersistedMemoryRecord(
      vaultRoot,
      result.result.recordId,
      result.result.expectedMarkdown,
    );

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
      audit: {
        action: "memory_forget",
        commandName: "core.forgetMemory",
        summary: `Forgot memory record ${next.record.id}.`,
        targetIds: [next.record.id],
      },
    });
    const nextSnapshot = await readPersistedMemoryDocument(vaultRoot, markdown);

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
    resources: [await canonicalPathResourceForVault(vaultRoot, memoryDocumentRelativePath)],
    run,
  });
}

async function readPersistedMemoryRecord(
  vaultRoot: string,
  recordId: string,
  expectedMarkdown: string,
): Promise<{
  document: MemoryDocumentSnapshot;
  record: MemoryRecord;
}> {
  const document = await readPersistedMemoryDocument(vaultRoot, expectedMarkdown);
  const record = document.records.find((entry) => entry.id === recordId) ?? null;
  if (record === null) {
    throw new MemoryPersistenceError();
  }

  return {
    document,
    record,
  };
}

async function readPersistedMemoryDocument(
  vaultRoot: string,
  expectedMarkdown: string,
): Promise<MemoryDocumentSnapshot> {
  let document: MemoryDocumentSnapshot;
  try {
    document = await readMemoryDocument(vaultRoot);
  } catch {
    throw new MemoryPersistenceError();
  }
  if (document.markdown !== expectedMarkdown) {
    throw new MemoryPersistenceError();
  }
  return document;
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
  const markdown = renderMemoryDocument({ document: next.document });
  await writeCanonicalMarkdownDocument({
    vaultRoot,
    operationType: "memory_upsert",
    summary: `Upsert memory record ${next.record.id}`,
    target: resolveSingletonMarkdownDocumentTarget({
      relativePath: memoryDocumentRelativePath,
      created: !snapshot.exists,
    }),
    markdown,
    audit: {
      action: "memory_upsert",
      commandName: "core.upsertMemory",
      summary: `Upserted memory record ${next.record.id}.`,
      targetIds: [next.record.id],
    },
  });
  const persisted = await readPersistedMemoryRecord(
    vaultRoot,
    next.record.id,
    markdown,
  );

  return {
    created: next.created,
    document: persisted.document,
    record: persisted.record,
  };
}
