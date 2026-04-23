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

test("food auto-log cron keeps dedupe and addMeal inside the canonical write lock scope", async () => {
  const source = await readSource("../src/assistant/cron/food-auto-log.ts");
  const start = source.indexOf("export async function runFoodAutoLogCronJob");
  assert.notEqual(start, -1, "Expected runFoodAutoLogCronJob in food-auto-log.ts");
  const segment = source.slice(start);

  assert.match(segment, /withCanonicalWriteLockScope\(input\.vault/u);
  assertOrdered(segment, [
    "return await core.withCanonicalWriteLockScope(input.vault, async () => {",
    "const lock = await core.acquireCanonicalWriteLock(input.vault)",
    "const existing = await core.findEventByExternalRef({",
    "const result = await importers.addMeal(mealInput)",
    "await lock.release()",
  ]);
});
