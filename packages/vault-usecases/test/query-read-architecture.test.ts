import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

const allowedFullVaultReaders = new Map<string, number>([
  ["packages/cli/src/commands/export-intake-read-helpers.ts", 1],
  ["packages/cli/src/commands/search.ts", 1],
  ["packages/vault-usecases/src/usecases/experiment-journal-vault.ts", 1],
  ["packages/vault-usecases/src/usecases/integrated-services.ts", 1],
  ["packages/vault-usecases/src/usecases/measurement-read.ts", 2],
  ["packages/vault-usecases/src/usecases/workout-live-state.ts", 1],
]);

const narrowReaderContracts = new Map<string, readonly string[]>([
  [
    "packages/cli/src/commands/audit-command-helpers.ts",
    ["resolveCanonicalEntityInFamily", "listCanonicalEntities"],
  ],
  [
    "packages/cli/src/commands/export-intake-read-helpers.ts",
    ["resolveCanonicalEntityInFamily"],
  ],
  [
    "packages/vault-usecases/src/usecases/capture.ts",
    ["readCanonicalEntityFamilySource", "listCanonicalEntities"],
  ],
  [
    "packages/vault-usecases/src/usecases/event-record-mutations.ts",
    ["resolveCanonicalEntityInFamily"],
  ],
  [
    "packages/vault-usecases/src/usecases/experiment-journal-vault.ts",
    ["resolveCanonicalEntityInFamily", "readVaultMetadataSource"],
  ],
  [
    "packages/vault-usecases/src/usecases/integrated-services.ts",
    ["resolveCanonicalEntityInFamily"],
  ],
  [
    "packages/vault-usecases/src/usecases/intervention-experiment-link.ts",
    ["readCanonicalEntityFamilySource", "readExactEventRecord", "readVaultMetadataSource"],
  ],
  [
    "packages/vault-usecases/src/usecases/measurement-read.ts",
    ["readExactEventRecord"],
  ],
  [
    "packages/vault-usecases/src/usecases/workout-read.ts",
    ["readExactEventRecord", "listCanonicalEntities"],
  ],
]);

const forbiddenExactReaderCalls = [
  "ensureFreshQueryProjection(",
  "loadProjectedVaultSource(",
  "searchVaultRuntime(",
] as const;

test("full-vault query hydration remains confined to aggregate and derived owners", async () => {
  const sourceFiles = await Promise.all([
    walkTypeScriptFiles(path.join(repositoryRoot, "packages", "cli", "src")),
    walkTypeScriptFiles(path.join(repositoryRoot, "packages", "vault-usecases", "src")),
  ]).then((groups) => groups.flat());
  const actual = new Map<string, number>();

  for (const absolutePath of sourceFiles) {
    const source = await readFile(absolutePath, "utf8");
    const count = source.match(/\.readVault\s*\(/gu)?.length ?? 0;
    if (count > 0) {
      actual.set(toRepositoryPath(absolutePath), count);
    }
  }

  assert.deepEqual(
    [...actual.entries()].sort(([left], [right]) => left.localeCompare(right)),
    [...allowedFullVaultReaders.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
});

test("exact and family-local command owners depend on narrow query capabilities", async () => {
  for (const [relativePath, requiredCalls] of narrowReaderContracts) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");

    for (const requiredCall of requiredCalls) {
      assert.ok(
        source.includes(requiredCall),
        `${relativePath} must retain the ${requiredCall} narrow-reader boundary`,
      );
    }
    for (const forbiddenCall of forbiddenExactReaderCalls) {
      assert.equal(
        source.includes(forbiddenCall),
        false,
        `${relativePath} must not call ${forbiddenCall}`,
      );
    }
  }
});

async function walkTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return walkTypeScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolutePath] : [];
  }));
  return files.flat();
}

function toRepositoryPath(absolutePath: string): string {
  return path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
}
