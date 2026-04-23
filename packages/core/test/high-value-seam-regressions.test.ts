import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

async function readSource(relativePath: string): Promise<string> {
  return await readFile(new URL(relativePath, import.meta.url), "utf8");
}

function assertOrdered(source: string, snippets: readonly string[]): void {
  let lastIndex = -1;
  for (const snippet of snippets) {
    const nextIndex = source.indexOf(snippet, lastIndex + 1);
    assert.notEqual(nextIndex, -1, `Expected to find source snippet: ${snippet}`);
    assert.ok(nextIndex > lastIndex, `Expected snippet to appear after the previous one: ${snippet}`);
    lastIndex = nextIndex;
  }
}

test("scheduled-log occurrence keeps dedupe and write steps inside the canonical write lock scope", async () => {
  const source = await readSource("../src/scheduled-logs.ts");
  const start = source.indexOf("export async function executeScheduledLogOccurrence");
  assert.notEqual(start, -1, "Expected executeScheduledLogOccurrence in scheduled-logs.ts");
  const segment = source.slice(start);

  assert.match(segment, /withCanonicalWriteLockScope\(input\.vaultRoot/u);
  assertOrdered(segment, [
    "const lock = await acquireCanonicalWriteLock(input.vaultRoot);",
    "const record = await readScheduledLog({",
    "const existing = await findEventByExternalRef({",
    "if (record.status !== \"active\") {",
    "const written = await executeScheduledLogAction({",
    "await lock.release();",
  ]);
});

test("vault-sync merge keeps planning reads and applyCanonicalWriteBatch inside the canonical write lock scope", async () => {
  const source = await readSource("../src/vault-sync.ts");
  const start = source.indexOf("export async function mergeVaultSyncImportIntoVault");
  assert.notEqual(start, -1, "Expected mergeVaultSyncImportIntoVault in vault-sync.ts");
  const segment = source.slice(start);

  assert.match(segment, /withCanonicalWriteLockScope\(input\.targetVaultRoot/u);
  assertOrdered(segment, [
    "const lock = await acquireCanonicalWriteLock(input.targetVaultRoot);",
    "for (const file of manifest.files) {",
    "await planJsonlMerge({",
    "await planRawMerge({",
    "await planTextMerge({",
    "await validateMergePlanAgainstCurrentVaultContracts({",
    "await applyCanonicalWriteBatch(",
    "await lock.release();",
  ]);
});

test("vault-sync preserves verified raw payloads from memory instead of re-reading source paths during apply", async () => {
  const source = await readSource("../src/vault-sync.ts");
  const rawStart = source.indexOf("async function planRawMerge");
  const textStart = source.indexOf("async function planTextMerge");
  const hasPendingStart = source.indexOf("function hasPendingWrites");
  assert.notEqual(rawStart, -1, "Expected planRawMerge in vault-sync.ts");
  assert.notEqual(textStart, -1, "Expected planTextMerge in vault-sync.ts");
  assert.notEqual(hasPendingStart, -1, "Expected hasPendingWrites in vault-sync.ts");

  const rawSegment = source.slice(rawStart, textStart);
  assert.match(rawSegment, /input\.plan\.rawContents\.push\(/u);
  assert.match(rawSegment, /content: input\.localBytes/u);
  assert.doesNotMatch(rawSegment, /sourcePath:/u);

  const textSegment = source.slice(textStart, hasPendingStart);
  assert.match(textSegment, /input\.plan\.rawContents\.push\(/u);
  assert.match(textSegment, /content,/u);
  assert.doesNotMatch(textSegment, /sourcePath:/u);
});
