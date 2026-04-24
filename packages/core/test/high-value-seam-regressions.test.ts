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
  const source = await readSource("../src/vault-sync/merge.ts");
  const start = source.indexOf("export async function mergeVaultSyncImportIntoVault");
  assert.notEqual(start, -1, "Expected mergeVaultSyncImportIntoVault in vault-sync/merge.ts");
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

test("vault-sync preserves verified imported payloads from memory while keeping conflicts manifest-only", async () => {
  const source = await readSource("../src/vault-sync/merge.ts");
  const jsonlStart = source.indexOf("export async function planJsonlMerge");
  const rawStart = source.indexOf("export async function planRawMerge");
  const textStart = source.indexOf("export async function planTextMerge");
  const hasPendingStart = source.indexOf("function hasPendingWrites");
  assert.notEqual(jsonlStart, -1, "Expected planJsonlMerge in vault-sync/merge.ts");
  assert.notEqual(rawStart, -1, "Expected planRawMerge in vault-sync/merge.ts");
  assert.notEqual(textStart, -1, "Expected planTextMerge in vault-sync/merge.ts");
  assert.notEqual(hasPendingStart, -1, "Expected hasPendingWrites in vault-sync/merge.ts");

  const jsonlSegment = source.slice(jsonlStart, rawStart);
  assert.doesNotMatch(jsonlSegment, /input\.plan\.rawContents\.push\(/u);
  assert.match(jsonlSegment, /preservedLocalPath: null/u);

  const rawSegment = source.slice(rawStart, textStart);
  assert.match(rawSegment, /input\.plan\.rawContents\.push\(/u);
  assert.match(rawSegment, /content: input\.localBytes/u);
  assert.doesNotMatch(rawSegment, /sourcePath:/u);
  assert.match(rawSegment, /preservedLocalPath: null/u);

  const textSegment = source.slice(textStart, hasPendingStart);
  assert.match(textSegment, /input\.plan\.textWrites\.push\(/u);
  assert.doesNotMatch(textSegment, /input\.plan\.rawContents\.push\(/u);
  assert.doesNotMatch(textSegment, /sourcePath:/u);
  assert.match(textSegment, /preservedLocalPath: null/u);
});
