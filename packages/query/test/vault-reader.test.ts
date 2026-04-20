import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, VAULT_LAYOUT } from "@murphai/contracts";

import { readVaultTolerant } from "../src/model.ts";

test("readVaultTolerant builds a read model from sparse canonical layouts", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-vault-reader-"));

  try {
    await writeVaultFile(
      vaultRoot,
      VAULT_LAYOUT.metadata,
      JSON.stringify({
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01K9D9B2D7N4QW5T6Y7Z8A9B0C",
        createdAt: "2026-04-20T00:00:00.000Z",
        title: "Tolerant reader vault",
        timezone: "UTC",
      }),
    );
    await writeVaultFile(
      vaultRoot,
      path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-20.md"),
      [
        "---",
        "title: Tolerant journal",
        "tags:",
        "  - sleep",
        "---",
        "",
        "Lightweight note.",
      ].join("\n"),
    );

    const readModel = await readVaultTolerant(vaultRoot);

    assert.equal(readModel.vaultRoot, vaultRoot);
    assert.equal(readModel.metadata?.title, "Tolerant reader vault");
    assert.equal(readModel.journalEntries[0]?.title, "Tolerant journal");
    assert.deepEqual(readModel.byFamily.journal?.map((entry) => entry.entityId), ["journal:2026-04-20"]);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
