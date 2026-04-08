import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";

import { afterEach, test } from "vitest";

import { VAULT_LAYOUT } from "@murphai/contracts";

import { initializeVault, repairVault, validateVault } from "../src/index.ts";

const tempRoots: string[] = [];

async function createTempVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-vault-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

async function expectDirectoryExists(vaultRoot: string, relativePath: string): Promise<void> {
  const details = await stat(path.join(vaultRoot, relativePath));
  assert.equal(details.isDirectory(), true);
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) => rm(vaultRoot, { recursive: true, force: true })),
  );
});

test("initializeVault creates registry-owned required directories", async () => {
  const vaultRoot = await createTempVaultRoot();

  await initializeVault({ vaultRoot, title: "Registry Test Vault" });

  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.automationsDirectory);
  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory);
  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.rawInboxDirectory);
  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.rawIntegrationsDirectory);
});

test("validateVault validates registry-owned frontmatter and jsonl families", async () => {
  const vaultRoot = await createTempVaultRoot();

  await initializeVault({ vaultRoot, title: "Registry Validation Vault" });
  await writeFile(
    path.join(vaultRoot, VAULT_LAYOUT.automationsDirectory, "broken-automation.md"),
    [
      "---",
      "docType: automation",
      "title: Broken automation",
      "---",
      "Prompt body",
      "",
    ].join("\n"),
    "utf8",
  );
  await mkdir(path.join(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory, "2026"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"captureId":"capture_only"}\n',
    "utf8",
  );

  const result = await validateVault({ vaultRoot });

  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.code === "FRONTMATTER_INVALID" &&
        issue.path === `${VAULT_LAYOUT.automationsDirectory}/broken-automation.md`,
    ),
    true,
  );
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.code === "CONTRACT_INVALID" &&
        issue.path === `${VAULT_LAYOUT.inboxCaptureLedgerDirectory}/2026/2026-04.jsonl`,
    ),
    true,
  );
});

test("repairVault backfills missing registry-owned required directories", async () => {
  const vaultRoot = await createTempVaultRoot();

  await initializeVault({ vaultRoot, title: "Registry Repair Vault" });
  await rm(path.join(vaultRoot, VAULT_LAYOUT.automationsDirectory), {
    recursive: true,
    force: true,
  });
  await rm(path.join(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory), {
    recursive: true,
    force: true,
  });
  await rm(path.join(vaultRoot, VAULT_LAYOUT.rawInboxDirectory), {
    recursive: true,
    force: true,
  });

  const result = await repairVault({ vaultRoot });

  assert.equal(result.updated, true);
  assert.equal(
    result.createdDirectories.includes(VAULT_LAYOUT.automationsDirectory),
    true,
  );
  assert.equal(
    result.createdDirectories.includes(VAULT_LAYOUT.inboxCaptureLedgerDirectory),
    true,
  );
  assert.equal(
    result.createdDirectories.includes(VAULT_LAYOUT.rawInboxDirectory),
    true,
  );
  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.automationsDirectory);
  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory);
  await expectDirectoryExists(vaultRoot, VAULT_LAYOUT.rawInboxDirectory);
});
