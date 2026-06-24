import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";

import { test } from "vitest";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(TEST_DIRECTORY, "../src");

const CANONICAL_WRITE_ALLOWLIST = new Set([
  "audit.ts",
  "audited-write.ts",
  "domains/events/attachment-backed.ts",
  "domains/events/ledger.ts",
  "domains/experiments.ts",
  "domains/shared.ts",
  "history/api.ts",
  "integration-ingest-migration.ts",
  "junction-hr-zone-repair.ts",
  "mutations.ts",
  "operations/write-batch.ts",
  "vault.ts",
  "wearable-receipts.ts",
  "wearable-storage-migration.ts",
]);

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".ts")) {
      files.push(absolutePath);
    }
  }

  return files;
}

test("direct canonical write primitives stay behind the audited seam allowlist", async () => {
  const directUsers: string[] = [];

  for (const absolutePath of await listSourceFiles(SOURCE_ROOT)) {
    const relativePath = path.relative(SOURCE_ROOT, absolutePath).split(path.sep).join(path.posix.sep);
    const source = await readFile(absolutePath, "utf8");

    if (
      source.includes("runCanonicalWrite(") ||
      source.includes("runCanonicalWrite<") ||
      source.includes("runLoadedCanonicalWrite(") ||
      source.includes("runLoadedCanonicalWrite<")
    ) {
      directUsers.push(relativePath);
    }
  }

  assert.deepEqual(directUsers.sort(), [...CANONICAL_WRITE_ALLOWLIST].sort());
});
