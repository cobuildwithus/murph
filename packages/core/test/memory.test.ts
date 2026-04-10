import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, test, vi } from "vitest";

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
  createEmptyMemoryDocument,
  createMemoryRecordId,
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
          docType: "murph.memory.v1",
          schemaVersion: 1,
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
    const expectedRecordId = createMemoryRecordId({
      section: "Context",
      text: "Prefers concise answers",
    });

    expect(inserted.created).toBe(true);
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

  test("fails closed when post-write read-back omits the upserted memory record", async () => {
    const vaultRoot = await makeVaultRoot();
    const now = new Date("2026-04-08T01:15:00.000Z");
    const section = "Context";
    const text = "Remember the resource lock runtime.";
    const recordId = createMemoryRecordId({ section, text });
    const readSpy = vi
      .spyOn(fsModule, "readUtf8File")
      .mockResolvedValue(renderMemoryDocument({ document: createEmptyMemoryDocument(now) }));

    try {
      await expect(
        upsertMemory(vaultRoot, {
          now,
          section,
          text,
        }),
      ).rejects.toThrow(`Memory record "${recordId}" was not found after upsert.`);
    } finally {
      readSpy.mockRestore();
    }

    expect(await getMemoryRecord(vaultRoot, recordId)).toMatchObject({
      id: recordId,
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
    } finally {
      vi.useRealTimers();
    }
  });
});
