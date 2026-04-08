import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { afterEach, test } from "vitest";
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

import { createTempVaultContext, runInProcessJsonCli } from "./cli-test-helpers.js";
import { registerMemoryCommands } from "../src/commands/memory.js";

const cleanupPaths: string[] = [];

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

test("memory commands round-trip upsert, show, and forget through the registered CLI", async () => {
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
        } | null;
      }
    ).memory?.id,
    createdMemoryId.memory.id,
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
