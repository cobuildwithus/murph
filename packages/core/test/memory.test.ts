import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveAuditShardPath } from "../src/audit.ts";
import { readJsonlRecords } from "../src/index.ts";
import {
  buildMemoryCorePromptBlock,
  forgetMemory,
  getMemoryRecord,
  readMemoryDocument,
  resolveMemoryDocumentPath,
  updateMemory,
  upsertMemory,
} from "../src/memory.ts";
import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  createEmptyMemoryDocument,
  isContractId,
  renderMemoryDocument,
} from "@murphai/contracts";
import * as fsModule from "../src/fs.ts";

async function createVaultRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "murph-core-memory-"));
}

const tempRoots: string[] = [];

async function makeVaultRoot(): Promise<string> {
  const root = await createVaultRoot();
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("core memory package wrapper", () => {
  test("reads a fresh vault as the canonical empty memory document", async () => {
    const vaultRoot = await makeVaultRoot();
    const now = new Date("2026-04-08T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const snapshot = await readMemoryDocument(vaultRoot);

      expect(resolveMemoryDocumentPath(vaultRoot)).toBe(path.join(vaultRoot, "bank/memory.md"));
      expect(snapshot).toMatchObject({
        exists: false,
        records: [],
        sourcePath: "bank/memory.md",
        updatedAt: null,
        frontmatter: {
          docType: FRONTMATTER_DOC_TYPES.memory,
          schemaVersion: CONTRACT_SCHEMA_VERSION.memoryFrontmatter,
          title: "Memory",
          updatedAt: now.toISOString(),
        },
      });
      expect(snapshot.markdown).toBe(
        renderMemoryDocument({ document: createEmptyMemoryDocument(now) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("returns null prompt blocks for empty vaults and renders records in canonical order once populated", async () => {
    const vaultRoot = await makeVaultRoot();
    const createdAt = new Date("2026-04-08T00:00:00.000Z");
    const contextNow = new Date("2026-04-08T00:05:00.000Z");
    const instructionsNow = new Date("2026-04-08T00:10:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(createdAt);
    try {
      expect(await buildMemoryCorePromptBlock(vaultRoot)).toBeNull();

      await upsertMemory(vaultRoot, {
        now: contextNow,
        section: "Context",
        text: " Likes concise answers ",
      });
      await upsertMemory(vaultRoot, {
        now: instructionsNow,
        section: "Instructions",
        text: "Always mention the next step",
      });

      expect(await buildMemoryCorePromptBlock(vaultRoot)).toBe(
        [
          "Memory lives in the canonical vault and is safe to rely on for durable user context.",
          "Memory:\nInstructions:\n- Always mention the next step\n\nContext:\n- Likes concise answers",
        ].join("\n\n"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("upserts, gets, and updates the same memory record through the vault-backed file", async () => {
    const vaultRoot = await makeVaultRoot();
    const createdAt = new Date("2026-04-08T01:00:00.000Z");
    const updatedAt = new Date("2026-04-08T01:05:00.000Z");

    const inserted = await upsertMemory(vaultRoot, {
      now: createdAt,
      section: "Context",
      text: "  Prefers concise answers  ",
    });
    const expectedRecordId = inserted.record.id;

    expect(inserted.created).toBe(true);
    expect(isContractId(expectedRecordId, "mem")).toBe(true);
    expect(inserted.record).toMatchObject({
      createdAt: createdAt.toISOString(),
      id: expectedRecordId,
      section: "Context",
      sourceLine: 11,
      sourcePath: "bank/memory.md",
      text: "Prefers concise answers",
      updatedAt: createdAt.toISOString(),
    });
    expect(await getMemoryRecord(vaultRoot, expectedRecordId)).toEqual(inserted.record);

    const updated = await updateMemory(vaultRoot, {
      now: updatedAt,
      recordId: inserted.record.id,
      section: "Identity",
      text: "Uses Murph daily",
    });

    expect(updated.record).toMatchObject({
      createdAt: createdAt.toISOString(),
      id: expectedRecordId,
      section: "Identity",
      sourceLine: 5,
      sourcePath: "bank/memory.md",
      text: "Uses Murph daily",
      updatedAt: updatedAt.toISOString(),
    });
    expect(updated.document.records).toHaveLength(1);
    expect(updated.document.records[0]).toEqual(updated.record);
    expect(await getMemoryRecord(vaultRoot, expectedRecordId)).toEqual(updated.record);
    const auditRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: resolveAuditShardPath(updatedAt),
    });
    expect(
      auditRecords
        .filter(
          (record) =>
            record.action === "memory_upsert" &&
            Array.isArray(record.targetIds) &&
            record.targetIds.includes(expectedRecordId),
        )
        .map((record) => record.commandName),
    ).toContain("core.updateMemory");
  });

  test("deduplicates replayed anonymous upserts by normalized section and text", async () => {
    const vaultRoot = await makeVaultRoot();

    const results = await Promise.all([
      upsertMemory(vaultRoot, {
        now: new Date("2026-04-08T01:00:00.000Z"),
        section: "Context",
        text: "  Prefers concise answers  ",
      }),
      upsertMemory(vaultRoot, {
        now: new Date("2026-04-08T01:05:00.000Z"),
        section: "Context",
        text: "Prefers   concise\nanswers",
      }),
    ]);
    const first = results.find((result) => result.created);
    const replay = results.find((result) => !result.created);

    expect(first).toBeDefined();
    expect(replay).toBeDefined();
    assert(first);
    assert(replay);
    expect(replay.record.id).toBe(first.record.id);
    expect(replay.record.createdAt).toBe(first.record.createdAt);
    expect(replay.record.text).toBe("Prefers concise answers");

    const snapshot = await readMemoryDocument(vaultRoot);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]?.id).toBe(first.record.id);

    const differentSection = await upsertMemory(vaultRoot, {
      now: new Date("2026-04-08T01:10:00.000Z"),
      section: "Identity",
      text: "Prefers concise answers",
    });

    expect(differentSection.created).toBe(true);
    expect(differentSection.record.id).not.toBe(first.record.id);
    await expect(readMemoryDocument(vaultRoot))
      .resolves.toMatchObject({
        records: [
          expect.objectContaining({
            id: differentSection.record.id,
            section: "Identity",
          }),
          expect.objectContaining({
            id: first.record.id,
            section: "Context",
          }),
        ],
      });
  });

  test("serializes parallel upserts to the singleton memory document without losing records", async () => {
    const vaultRoot = await makeVaultRoot();
    const writes = [
      {
        now: new Date("2026-04-08T01:10:00.000Z"),
        section: "Context" as const,
        text: "Likes concise answers",
      },
      {
        now: new Date("2026-04-08T01:10:01.000Z"),
        section: "Instructions" as const,
        text: "Lead with the answer",
      },
      {
        now: new Date("2026-04-08T01:10:02.000Z"),
        section: "Preferences" as const,
        text: "Use bullets for options",
      },
    ];
    vi.resetModules();
    const operationsModule = await import("../src/operations/index.ts");
    let tail = Promise.resolve();
    const lockSpy = vi
      .spyOn(operationsModule, "withCanonicalResourceLocks")
      .mockImplementation(async (input) => {
        const previous = tail;
        let release: (() => void) | undefined;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;

        try {
          return await input.run();
        } finally {
          release?.();
        }
      });
    const memoryModule = await import("../src/memory.ts");

    try {
      const results = await Promise.all(
        writes.map((entry) =>
          memoryModule.upsertMemory(vaultRoot, {
            now: entry.now,
            section: entry.section,
            text: entry.text,
          }),
        ),
      );
      const snapshot = await memoryModule.readMemoryDocument(vaultRoot);

      expect(results.every((result) => result.created)).toBe(true);
      expect(snapshot.records).toHaveLength(writes.length);
      expect(snapshot.records.map((record) => `${record.section}:${record.text}`).sort()).toEqual(
        writes.map((entry) => `${entry.section}:${entry.text}`).sort(),
      );
    } finally {
      lockSpy.mockRestore();
      vi.resetModules();
    }
  });

  test("updates preserve the existing section by default and reject missing ids", async () => {
    const vaultRoot = await makeVaultRoot();
    const createdAt = new Date("2026-04-08T01:00:00.000Z");
    const updatedAt = new Date("2026-04-08T01:05:00.000Z");

    const inserted = await upsertMemory(vaultRoot, {
      now: createdAt,
      section: "Identity",
      text: "Preferred name is rocketman.",
    });

    const updated = await updateMemory(vaultRoot, {
      now: updatedAt,
      recordId: inserted.record.id,
      text: "Preferred name is Rocketman.",
    });

    expect(updated.record).toMatchObject({
      id: inserted.record.id,
      section: "Identity",
      text: "Preferred name is Rocketman.",
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });

    await expect(
      updateMemory(vaultRoot, {
        recordId: "mem_missing",
        text: "Should fail",
      }),
    ).rejects.toThrow('Memory record "mem_missing" does not exist.');
  });

  test("fails closed on legacy on-disk memory docs and legacy ids", async () => {
    const vaultRoot = await makeVaultRoot();
    const legacyRecordId = "mem_0123456789abcdef";
    const legacyDocumentPath = path.join(vaultRoot, "bank/memory.md");

    await mkdir(path.dirname(legacyDocumentPath), { recursive: true });
    await writeFile(
      legacyDocumentPath,
      [
        "---",
        "docType: murph.memory.v1",
        "schemaVersion: 1",
        "title: Memory",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "# Memory",
        "",
        "## Preferences",
        `- Prefers direct answers <!-- murph-memory:{\"id\":\"${legacyRecordId}\",\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\"} -->`,
      ].join("\n"),
      "utf8",
    );

    await expect(readMemoryDocument(vaultRoot)).rejects.toThrow();

    await expect(
      updateMemory(vaultRoot, {
        now: new Date("2026-04-08T00:05:00.000Z"),
        recordId: legacyRecordId,
        section: "Identity",
        text: "Uses Murph daily",
      }),
    ).rejects.toThrow();

    await expect(forgetMemory(vaultRoot, { recordId: legacyRecordId })).rejects.toThrow();
  });

  test("fails closed when post-write read-back omits the upserted memory record", async () => {
    const vaultRoot = await makeVaultRoot();
    const now = new Date("2026-04-08T01:15:00.000Z");
    const section = "Context";
    const text = "Remember the resource lock runtime.";
    const readSpy = vi
      .spyOn(fsModule, "readUtf8File")
      .mockResolvedValue(renderMemoryDocument({ document: createEmptyMemoryDocument(now) }));

    let error: Error | null = null;
    try {
      await upsertMemory(vaultRoot, {
        now,
        section,
        text,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    } finally {
      readSpy.mockRestore();
    }

    expect(error).not.toBeNull();
    const persistedSnapshot = await readMemoryDocument(vaultRoot);
    const persistedRecord = persistedSnapshot.records[0] ?? null;
    expect(persistedRecord).not.toBeNull();
    expect(isContractId(persistedRecord?.id ?? "", "mem")).toBe(true);
    expect(error?.message).toBe(
      `Memory record "${persistedRecord?.id ?? ""}" was not found after upsert.`,
    );

    expect(persistedRecord).toMatchObject({
      section,
      text,
    });
  });

  test("forgets missing records as a no-op and deletes existing records from the persisted memory file", async () => {
    const vaultRoot = await makeVaultRoot();
    const createdAt = new Date("2026-04-08T02:00:00.000Z");
    const deletedAt = new Date("2026-04-08T03:00:00.000Z");

    const inserted = await upsertMemory(vaultRoot, {
      now: createdAt,
      section: "Preferences",
      text: "Prefers direct answers",
    });

    const missing = await forgetMemory(vaultRoot, {
      recordId: "mem_missing",
    });

    expect(missing.existed).toBe(false);
    expect(missing.record).toBeNull();
    expect(missing.document).toMatchObject({
      records: [inserted.record],
      frontmatter: {
        updatedAt: createdAt.toISOString(),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(deletedAt);
    try {
      const deleted = await forgetMemory(vaultRoot, {
        recordId: inserted.record.id,
      });

      expect(deleted.existed).toBe(true);
      expect(deleted.record).toEqual(inserted.record);
      expect(deleted.document.records).toEqual([]);
      expect(deleted.document.frontmatter.updatedAt).toBe(deletedAt.toISOString());
      expect(await getMemoryRecord(vaultRoot, inserted.record.id)).toBeNull();
      expect(await buildMemoryCorePromptBlock(vaultRoot)).toBeNull();
      const snapshot = await readMemoryDocument(vaultRoot);
      expect(snapshot.markdown).not.toContain("Prefers direct answers");
      const auditRecords = await readJsonlRecords({
        vaultRoot,
        relativePath: resolveAuditShardPath(deletedAt),
      });
      expect(
        auditRecords.some(
          (record) =>
            record.action === "memory_forget" &&
            record.commandName === "core.forgetMemory" &&
            Array.isArray(record.targetIds) &&
            record.targetIds.includes(inserted.record.id),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
