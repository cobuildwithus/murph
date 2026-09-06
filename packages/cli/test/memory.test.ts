import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { promises as nodeFs } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";
import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  memoryDocumentRelativePath,
  parseMemoryDocument,
  renderMemoryDocument,
  upsertMemoryRecord,
} from "@murphai/contracts";
import {
  forgetMemory,
  readMemoryDocument as readMemoryDocumentFromCore,
  resolveMemoryDocumentPath,
  upsertMemory,
} from "@murphai/core";
import { readMemoryDocument as readMemoryDocumentFromQuery } from "@murphai/query";

import { createTempVaultContext, runCli, runInProcessJsonCli } from "./cli-test-helpers.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { registerMemoryCommands } from "../src/commands/memory.js";

const cleanupPaths: string[] = [];
const BUILT_MEMORY_TIMEOUT_MS = 120_000;
const SYNTHETIC_MEMORY_SECTIONS = [
  "Identity",
  "Preferences",
  "Instructions",
  "Context",
] as const;

type CompactMemoryRecord = {
  id: string;
  section: string;
  text: string;
};

async function seedPrivateFreeMemoryFixture(vaultRoot: string): Promise<CompactMemoryRecord[]> {
  for (let index = 0; index < 24; index += 1) {
    const section = SYNTHETIC_MEMORY_SECTIONS[index % SYNTHETIC_MEMORY_SECTIONS.length];
    if (!section) {
      throw new Error("Synthetic memory section fixture is incomplete.");
    }
    await upsertMemory(vaultRoot, {
      section,
      text: [
        `Synthetic ${section.toLowerCase()} record ${String(index + 1).padStart(2, "0")}.`,
        "This private-free sentence exercises canonical ordering and the compact assistant projection",
        "without containing a real person, account, health fact, identifier, or production value.",
      ].join(" "),
    });
  }

  const document = await readMemoryDocumentFromCore(vaultRoot);
  return document.records.map(({ id, section, text }) => ({ id, section, text }));
}

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      });
    }),
  );
});

test("memory document renders and parses as one canonical markdown file", () => {
  const base = createEmptyMemoryDocument(new Date("2026-04-06T00:00:00.000Z"));
  const inserted = upsertMemoryRecord(base, {
    now: new Date("2026-04-06T00:00:01.000Z"),
    section: "Identity",
    text: "Call the user Sam.",
  });
  const second = upsertMemoryRecord(inserted.document, {
    now: new Date("2026-04-06T00:00:02.000Z"),
    section: "Preferences",
    text: "Use bullet points.",
  });

  const markdown = renderMemoryDocument({ document: second.document });
  const parsed = parseMemoryDocument({
    sourcePath: memoryDocumentRelativePath,
    text: markdown,
  });

  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0]?.section, "Identity");
  assert.equal(parsed.records[1]?.section, "Preferences");
  assert.match(markdown, /# Memory/u);
  assert.match(markdown, /murph-memory:/u);

  const prompt = buildMemoryPromptBlock(parsed);
  assert.match(prompt ?? "", /Identity:/u);
  assert.match(prompt ?? "", /Preferences:/u);
});

test("core and query agree on the canonical bank/memory.md file", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-");
  cleanupPaths.push(parentRoot);

  const write = await upsertMemory(vaultRoot, {
    section: "Context",
    text: "Working on the memory cutover.",
  });
  assert.equal(write.created, true);
  assert.equal(write.record.section, "Context");

  const absolutePath = resolveMemoryDocumentPath(vaultRoot);
  assert.equal(absolutePath.endsWith(path.join("vault", "bank", "memory.md")), true);

  const file = await readFile(absolutePath, "utf8");
  assert.match(file, /Working on the memory cutover\./u);

  const coreSnapshot = await readMemoryDocumentFromCore(vaultRoot);
  const querySnapshot = await readMemoryDocumentFromQuery(vaultRoot);
  assert.equal(coreSnapshot.records.length, 1);
  assert.equal(querySnapshot.records.length, 1);

  const forgotten = await forgetMemory(vaultRoot, {
    recordId: write.record.id,
  });
  assert.equal(forgotten.existed, true);
  assert.equal(forgotten.document.records.length, 0);
});

test("memory command module registers without throwing", () => {
  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  registerMemoryCommands(cli);
  assert.ok(cli);
});

test("memory set-name stores the preferred display name in canonical memory", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-name-cli-");
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  registerMemoryCommands(cli);

  const saved = await runInProcessJsonCli(cli, [
    "memory",
    "set-name",
    "Theo",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(saved.exitCode, null);
  assert.equal(saved.envelope.ok, true);
  assert.equal(
    (
      saved.envelope.data as {
        created: boolean;
        memory: {
          section: string;
          text: string;
        };
      }
    ).created,
    true,
  );
  assert.equal(
    (
      saved.envelope.data as {
        memory: {
          section: string;
          text: string;
        };
      }
    ).memory.section,
    "Identity",
  );
  assert.equal(
    (
      saved.envelope.data as {
        memory: {
          section: string;
          text: string;
        };
      }
    ).memory.text,
    "Preferred display name: Theo",
  );
});

test("memory show returns onboarding demographic context from the complete canonical document", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-memory-demographic-cli-",
  );
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });

  registerMemoryCommands(cli);

  const saved = await runInProcessJsonCli(cli, [
    "memory",
    "upsert",
    "Age: 16",
    "--section",
    "Identity",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(saved.exitCode, null);
  assert.equal(saved.envelope.ok, true);

  const shown = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(shown.exitCode, null);
  assert.equal(shown.envelope.ok, true);
  assert.deepEqual(
    (
      shown.envelope.data as {
        document: {
          records: Array<{ section: string; text: string }>;
        };
      }
    ).document.records.map(({ section, text }) => ({ section, text })),
    [{ section: "Identity", text: "Age: 16" }],
  );
});

test("record-only memory reads and compact mutation receipts preserve exact records", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-receipts-");
  cleanupPaths.push(parentRoot);
  const cli = Cli.create("vault-cli", { description: "memory receipt test", version: "0.0.0-test" });
  registerMemoryCommands(cli);
  const records = await seedPrivateFreeMemoryFixture(vaultRoot);
  const selected = records[0];
  assert.ok(selected);
  const execute = (args: string[]) => runInProcessJsonCli(cli, ["memory", ...args, "--vault", vaultRoot]);
  const full = await execute(["show", selected.id]);
  const exact = await execute(["show", selected.id, "--record-only"]);
  assert.equal(full.envelope.ok, true);
  assert.equal(exact.envelope.ok, true);
  assert.deepEqual(exact.envelope.data, { memory: (full.envelope.data as { memory: unknown }).memory });
  assert.ok(JSON.stringify(exact.envelope.data).length < JSON.stringify(full.envelope.data).length / 10);
  const missingId = await execute(["show", "--record-only"]);
  assert.equal(missingId.envelope.ok, false);
  const unknown = await execute(["show", "missing-record", "--record-only"]);
  assert.equal(unknown.envelope.ok, false);

  for (const args of [
    ["upsert", "Synthetic preference for short summaries.", "--section", "Preferences"],
    ["update", selected.id, "Synthetic corrected context."],
    ["set-name", "Sample"],
  ]) {
    const saved = await execute([...args, "--compact"]);
    assert.equal(saved.envelope.ok, true);
    const receipt = saved.envelope.data as { created: boolean; memory: { id: string } };
    assert.deepEqual(Object.keys(receipt).sort(), ["created", "memory"]);
    const readback = await execute(["show", receipt.memory.id, "--record-only"]);
    assert.equal(readback.envelope.ok, true);
    assert.deepEqual(readback.envelope.data, { memory: receipt.memory });
  }
  const removed = await execute(["forget", selected.id, "--compact"]);
  assert.equal(removed.envelope.ok, true);
  const receipt = removed.envelope.data as { existed: boolean; memory: { id: string } };
  assert.deepEqual(Object.keys(receipt).sort(), ["existed", "memory"]);
  assert.equal(receipt.existed, true);
  assert.equal(receipt.memory.id, selected.id);
  assert.equal((await execute(["show", selected.id, "--record-only"])).envelope.ok, false);
  const after = await readMemoryDocumentFromCore(vaultRoot);
  assert.equal(after.records.some((record) => record.id === selected.id), false);
  assert.ok(records.slice(1).every((record) => after.records.some((current) => current.id === record.id && current.text === record.text)));
});

test("memory show compact preserves all canonical facts while materially reducing serialized output", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-memory-compact-cli-",
  );
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  registerMemoryCommands(cli);

  const expectedRecords = await seedPrivateFreeMemoryFixture(vaultRoot);
  const full = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    "--vault",
    vaultRoot,
  ]);
  const compact = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    "--compact",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(full.exitCode, null);
  assert.equal(full.envelope.ok, true);
  assert.equal(compact.exitCode, null);
  assert.equal(compact.envelope.ok, true);

  const fullData = full.envelope.data as {
    document: {
      exists: boolean;
      frontmatter: Record<string, unknown>;
      markdown: string;
      records: Array<Record<string, unknown>>;
      sourcePath: string;
      updatedAt: string | null;
    };
    memory: unknown;
    vault: string;
  };
  const compactData = compact.envelope.data as {
    document: {
      exists: boolean;
      records: CompactMemoryRecord[];
    };
    memory: CompactMemoryRecord | null;
  };

  assert.deepEqual(Object.keys(fullData).sort(), ["document", "memory", "vault"]);
  assert.deepEqual(Object.keys(fullData.document).sort(), [
    "exists",
    "frontmatter",
    "markdown",
    "records",
    "sourcePath",
    "updatedAt",
  ]);
  assert.deepEqual(Object.keys(fullData.document.records[0] ?? {}).sort(), [
    "createdAt",
    "id",
    "section",
    "sourceLine",
    "sourcePath",
    "text",
    "updatedAt",
  ]);
  assert.equal(fullData.vault, vaultRoot);
  assert.equal(fullData.document.exists, true);
  assert.equal(fullData.document.records.length, 24);
  assert.equal(typeof fullData.document.markdown, "string");
  assert.equal(fullData.memory, null);

  assert.deepEqual(compactData, {
    document: {
      exists: true,
      records: expectedRecords,
    },
    memory: null,
  });
  assert.deepEqual(Object.keys(compactData), ["document", "memory"]);
  assert.deepEqual(Object.keys(compactData.document), ["exists", "records"]);
  assert.deepEqual(Object.keys(compactData.document.records[0] ?? {}), [
    "id",
    "section",
    "text",
  ]);

  const compactJson = JSON.stringify(compactData);
  assert.doesNotMatch(
    compactJson,
    /"(?:vault|markdown|frontmatter|sourcePath|sourceLine|createdAt|updatedAt)"/u,
  );

  const fullBytes = Buffer.byteLength(JSON.stringify(fullData), "utf8");
  const compactBytes = Buffer.byteLength(compactJson, "utf8");
  assert.ok(
    compactBytes * 2 < fullBytes,
    `Expected compact memory output below half of full output; full=${fullBytes}, compact=${compactBytes}.`,
  );
  assert.ok(
    fullBytes - compactBytes > 5_000,
    `Expected compact memory output to save more than 5,000 bytes; full=${fullBytes}, compact=${compactBytes}.`,
  );
});

test("memory show compact returns the empty canonical document without local metadata", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-memory-compact-empty-cli-",
  );
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  registerMemoryCommands(cli);

  const shown = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    "--compact",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(shown.exitCode, null);
  assert.equal(shown.envelope.ok, true);
  assert.deepEqual(shown.envelope.data, {
    document: {
      exists: false,
      records: [],
    },
    memory: null,
  });
});

test("memory show compact preserves the targeted record identity and facts", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-memory-compact-target-cli-",
  );
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  registerMemoryCommands(cli);

  const expectedRecords = await seedPrivateFreeMemoryFixture(vaultRoot);
  const target = expectedRecords[11];
  if (!target) {
    throw new Error("Synthetic memory target fixture is incomplete.");
  }

  const shown = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    target.id,
    "--compact",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(shown.exitCode, null);
  assert.equal(shown.envelope.ok, true);
  assert.deepEqual(shown.envelope.data, {
    document: {
      exists: true,
      records: expectedRecords,
    },
    memory: target,
  });
});

test("memory commands round-trip upsert, update, show, and forget through the registered CLI", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-cli-");
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });

  registerMemoryCommands(cli);

  const upserted = await runInProcessJsonCli(cli, [
    "memory",
    "upsert",
    "Remember the coverage seam is package-local.",
    "--section",
    "Context",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(upserted.exitCode, null);
  assert.equal(upserted.envelope.ok, true);

  const createdMemoryId = (
    upserted.envelope.data as {
      memory: {
        id: string;
        section: string;
      };
      created: boolean;
    }
  );
  assert.equal(createdMemoryId.created, true);
  assert.equal(createdMemoryId.memory.section, "Context");

  const updated = await runInProcessJsonCli(cli, [
    "memory",
    "update",
    createdMemoryId.memory.id,
    "Keep answers concise and direct.",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(updated.exitCode, null);
  assert.equal(updated.envelope.ok, true);
  assert.equal(
    (
      updated.envelope.data as {
        created: boolean;
        memory: {
          id: string;
          section: string;
          text: string;
        };
      }
    ).created,
    false,
  );
  assert.equal(
    (
      updated.envelope.data as {
        created: boolean;
        memory: {
          id: string;
          section: string;
          text: string;
        };
      }
    ).memory.id,
    createdMemoryId.memory.id,
  );
  assert.equal(
    (
      updated.envelope.data as {
        created: boolean;
        memory: {
          id: string;
          section: string;
          text: string;
        };
      }
    ).memory.section,
    "Context",
  );
  assert.equal(
    (
      updated.envelope.data as {
        created: boolean;
        memory: {
          id: string;
          section: string;
          text: string;
        };
      }
    ).memory.text,
    "Keep answers concise and direct.",
  );

  const shownDocument = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(shownDocument.exitCode, null);
  assert.equal(shownDocument.envelope.ok, true);
  assert.equal(
    (
      shownDocument.envelope.data as {
        document: {
          records: unknown[];
        };
        memory: unknown;
      }
    ).document.records.length,
    1,
  );
  assert.equal(
    (
      shownDocument.envelope.data as {
        document: {
          records: unknown[];
        };
        memory: unknown;
      }
    ).memory,
    null,
  );

  const shownRecord = await runInProcessJsonCli(cli, [
    "memory",
    "show",
    createdMemoryId.memory.id,
    "--vault",
    vaultRoot,
  ]);
  assert.equal(shownRecord.exitCode, null);
  assert.equal(shownRecord.envelope.ok, true);
  assert.equal(
    (
      shownRecord.envelope.data as {
        memory: {
          id: string;
          text: string;
        } | null;
      }
    ).memory?.id,
    createdMemoryId.memory.id,
  );
  assert.equal(
    (
      shownRecord.envelope.data as {
        memory: {
          id: string;
          text: string;
        } | null;
      }
    ).memory?.text,
    "Keep answers concise and direct.",
  );

  const forgotten = await runInProcessJsonCli(cli, [
    "memory",
    "forget",
    createdMemoryId.memory.id,
    "--vault",
    vaultRoot,
  ]);
  assert.equal(forgotten.exitCode, null);
  assert.equal(forgotten.envelope.ok, true);
  assert.equal(
    (
      forgotten.envelope.data as {
        existed: boolean;
        memory: {
          id: string;
        } | null;
        document: {
          records: unknown[];
        };
      }
    ).existed,
    true,
  );
  assert.equal(
    (
      forgotten.envelope.data as {
        existed: boolean;
        memory: {
          id: string;
        } | null;
        document: {
          records: unknown[];
        };
      }
    ).memory?.id,
    createdMemoryId.memory.id,
  );
  assert.equal(
    (
      forgotten.envelope.data as {
        existed: boolean;
        memory: {
          id: string;
        } | null;
        document: {
          records: unknown[];
        };
      }
    ).document.records.length,
    0,
  );
});

test("memory update refuses missing record ids through the registered CLI", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-cli-missing-");
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  registerMemoryCommands(cli);

  const updated = await runInProcessJsonCli(cli, [
    "memory",
    "update",
    "mem_missing",
    "Should fail",
    "--vault",
    vaultRoot,
  ]);
  assert.equal(updated.exitCode, 1);
  assert.equal(updated.envelope.ok, false);
  assert.equal(updated.envelope.error.code, "memory_not_found");
  assert.equal(updated.envelope.error.retryable, false);
  assert.equal(updated.envelope.error.stage, "read");
  assert.equal(updated.envelope.error.message, "The requested canonical memory record does not exist.");
  assert.doesNotMatch(JSON.stringify(updated.envelope), /mem_missing|Should fail/u);
});

test("memory upsert exposes a terminal inspect-first envelope after a failed post-write read-back", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-memory-cli-persistence-",
  );
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerMemoryCommands(cli);

  const memoryPath = resolveMemoryDocumentPath(vaultRoot);
  const originalReadFile = nodeFs.readFile.bind(nodeFs);
  let readbackFailureCount = 0;
  const readSpy = vi.spyOn(nodeFs, "readFile").mockImplementation(async (filePath, options) => {
    if (filePath === memoryPath && options === "utf8") {
      readbackFailureCount += 1;
      throw new Error("private injected post-write read-back failure");
    }
    return await originalReadFile(filePath, options);
  });
  const result = await (async () => {
    try {
      return await runInProcessJsonCli(cli, [
        "memory",
        "upsert",
        "private-post-write-memory-marker",
        "--section",
        "Context",
        "--vault",
        vaultRoot,
      ]);
    } finally {
      readSpy.mockRestore();
    }
  })();

  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.ok, false);
  if (result.envelope.ok) {
    throw new Error("Expected the ambiguous memory write to fail.");
  }
  assert.equal(result.envelope.error.code, "memory_persistence_invalid");
  assert.equal(result.envelope.error.retryable, false);
  assert.equal(result.envelope.error.stage, "persistence");
  assert.equal(
    result.envelope.error.message,
    "The canonical memory write completed but could not be verified. Inspect canonical memory before deciding whether another write is necessary.",
  );
  assert.doesNotMatch(result.envelope.error.message ?? "", /retry|rerun|try again/iu);
  assert.equal(readbackFailureCount, 1);
  const persisted = await readMemoryDocumentFromCore(vaultRoot);
  assert.equal(
    persisted.records.filter((record) => record.text === "private-post-write-memory-marker").length,
    1,
  );
  const serialized = JSON.stringify(result.envelope);
  assert.doesNotMatch(
    serialized,
    /private-post-write-memory-marker|private injected post-write read-back failure/u,
  );
  assert.doesNotMatch(
    serialized,
    new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
});

test("memory show refuses missing record ids in full and compact modes", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-cli-show-missing-");
  cleanupPaths.push(parentRoot);

  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  registerMemoryCommands(cli);

  for (const mode of [[], ["--compact"]] as const) {
    const shown = await runInProcessJsonCli(cli, [
      "memory",
      "show",
      "mem_missing",
      ...mode,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.exitCode, 1);
    assert.equal(shown.envelope.ok, false);
    assert.equal(shown.envelope.error.code, "memory_not_found");
    assert.equal(shown.envelope.error.stage, "read");
    assert.equal(shown.envelope.error.message, "The requested canonical memory record does not exist.");
    assert.doesNotMatch(JSON.stringify(shown.envelope), /mem_missing/u);
  }
});

test("built memory mutation parse failures stay pre-write and expose a fixed safe field", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-memory-cli-invalid-");
  cleanupPaths.push(parentRoot);
  const memoryPath = path.join(vaultRoot, memoryDocumentRelativePath);
  await mkdir(path.dirname(memoryPath), { recursive: true });
  const invalidMarkdown = renderMemoryDocument({
    document: upsertMemoryRecord(
      createEmptyMemoryDocument(new Date("2026-08-24T00:00:00.000Z")),
      {
        now: new Date("2026-08-24T00:00:01.000Z"),
        section: "Context",
        text: "private-marker-that-must-not-echo",
      },
    ).document,
  }).replace(/murph-memory:\{.*\}/u, "murph-memory:{broken-json}");
  const invalidLine = invalidMarkdown
    .split("\n")
    .findIndex((line) => line.includes("private-marker-that-must-not-echo")) + 1;
  await writeFile(memoryPath, invalidMarkdown, "utf8");
  const bytesBefore = await readFile(memoryPath);

  const envelope = await runCli([
    "memory",
    "upsert",
    "private-request-that-must-not-echo",
    "--section",
    "Context",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(envelope.ok, false);
  if (envelope.ok) {
    throw new Error("Expected malformed canonical memory to fail.");
  }
  assert.equal(envelope.error.code, "memory_document_invalid");
  assert.equal(envelope.error.retryable, false);
  assert.equal(envelope.error.stage, "read");
  assert.deepEqual(envelope.error.fieldErrors, [
    {
      code: "custom",
      expected: "",
      message: "This field is invalid.",
      path: "metadata",
      received: "invalid",
    },
  ]);
  assert.match(
    envelope.error.message ?? "",
    new RegExp(`bank/memory\\.md:${invalidLine}`, "u"),
  );
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(
    serialized,
    /private-marker-that-must-not-echo|private-request-that-must-not-echo/u,
  );
  assert.doesNotMatch(serialized, new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.deepEqual(await readFile(memoryPath), bytesBefore);
}, BUILT_MEMORY_TIMEOUT_MS);

test("built memory reads and mutations reject duplicate ids without writing or echoing private data", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-memory-cli-duplicate-id-",
  );
  cleanupPaths.push(parentRoot);
  const memoryPath = path.join(vaultRoot, memoryDocumentRelativePath);
  await mkdir(path.dirname(memoryPath), { recursive: true });
  const first = upsertMemoryRecord(
    createEmptyMemoryDocument(new Date("2026-08-30T16:00:00.000Z")),
    {
      now: new Date("2026-08-30T16:00:01.000Z"),
      section: "Context",
      text: "private-duplicate-id-memory-one",
    },
  );
  const second = upsertMemoryRecord(first.document, {
    now: new Date("2026-08-30T16:00:02.000Z"),
    section: "Context",
    text: "private-duplicate-id-memory-two",
  });
  const duplicateMarkdown = renderMemoryDocument({
    document: second.document,
  }).replace(second.record.id, first.record.id);
  const duplicateLine = duplicateMarkdown
    .split("\n")
    .findIndex((line) => line.includes("private-duplicate-id-memory-two")) + 1;
  await writeFile(memoryPath, duplicateMarkdown, "utf8");
  const bytesBefore = await readFile(memoryPath);

  const commands = [
    ["memory", "show", first.record.id, "--vault", vaultRoot],
    [
      "memory",
      "update",
      first.record.id,
      "private-duplicate-id-update-request",
      "--vault",
      vaultRoot,
    ],
    ["memory", "forget", first.record.id, "--vault", vaultRoot],
  ] as const;

  for (const command of commands) {
    const envelope = await runCli([...command]);

    assert.equal(envelope.ok, false);
    if (envelope.ok) {
      throw new Error("Expected duplicate canonical memory ids to fail.");
    }
    assert.equal(envelope.error.code, "memory_document_invalid");
    assert.equal(envelope.error.retryable, false);
    assert.equal(envelope.error.stage, "read");
    assert.deepEqual(envelope.error.fieldErrors, [
      {
        code: "custom",
        expected: "",
        message: "This field is invalid.",
        path: "id",
        received: "invalid",
      },
    ]);
    assert.match(
      envelope.error.message ?? "",
      new RegExp(`bank/memory\\.md:${duplicateLine}`, "u"),
    );
    const serialized = JSON.stringify(envelope);
    assert.doesNotMatch(
      serialized,
      /private-duplicate-id-memory|private-duplicate-id-update-request/u,
    );
    assert.doesNotMatch(serialized, new RegExp(first.record.id, "u"));
    assert.doesNotMatch(
      serialized,
      new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
    assert.deepEqual(await readFile(memoryPath), bytesBefore);
  }
}, BUILT_MEMORY_TIMEOUT_MS);

test("memory command module does not register a search subcommand", async () => {
  const cli = Cli.create("vault-cli", {
    description: "memory test cli",
    version: "0.0.0-test",
  });
  const output: string[] = [];
  let exitCode: number | null = null;

  registerMemoryCommands(cli);
  await cli.serve(["memory", "search", "--schema", "--format", "json"], {
    env: process.env,
    exit(code) {
      exitCode = code;
    },
    stdout(chunk) {
      output.push(chunk);
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.join("").trim(), /'search' is not a command for 'vault-cli memory'/u);
});
