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
  searchMemoryRecords,
  upsertMemoryRecord,
} from "@murphai/contracts";
import {
  forgetMemory,
  readMemoryDocument as readMemoryDocumentFromCore,
  resolveMemoryDocumentPath,
  upsertMemory,
} from "@murphai/core";
import {
  readMemoryDocument as readMemoryDocumentFromQuery,
  searchMemory as searchMemoryFromQuery,
} from "@murphai/query";

import { createTempVaultContext } from "./cli-test-helpers.js";
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

  const searchHits = searchMemoryRecords(parsed, { query: "Sam" });
  assert.equal(searchHits[0]?.text, "Call the user Sam.");
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

  const queryHits = await searchMemoryFromQuery(vaultRoot, {
    query: "cutover",
    limit: 10,
  });
  assert.equal(queryHits[0]?.text, "Working on the memory cutover.");

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
