import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, test } from "vitest";

import { VAULT_LAYOUT } from "@murphai/contracts";

import { listCanonicalSourceManifest } from "../src/vault-source.ts";

const tempRoots: string[] = [];

async function createTempVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-vault-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content = "test\n",
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) => rm(vaultRoot, { recursive: true, force: true })),
  );
});

test("listCanonicalSourceManifest uses shared vault family inclusion rules", async () => {
  const vaultRoot = await createTempVaultRoot();

  await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, '{"formatVersion":1}\n');
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "---\ntitle: Core\n---\n# Core\n");
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "test-experiment.md"),
    "---\nexperimentId: exp_test\nslug: test-experiment\n---\n# Experiment\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-08.md"),
    "---\ndayKey: 2026-04-08\n---\n# Journal\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.goalsDirectory, "test-goal.md"),
    "---\ngoalId: goal_test\ntitle: Test goal\nstatus: active\nhorizon: ongoing\n---\n# Goal\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"id":"evt_1"}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.auditDirectory, "2026", "2026-04.jsonl"),
    '{"id":"aud_1"}\n',
  );

  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily-check-in.md"),
    "---\ntitle: Automation\n---\nPrompt\n",
  );
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.memoryDocument, "---\ntitle: Memory\n---\n# Memory\n");
  await writeVaultFile(
    vaultRoot,
    VAULT_LAYOUT.preferencesDocument,
    '{"schemaVersion":1,"updatedAt":"2026-04-08T00:00:00.000Z","workoutUnitPreferences":{"distance":"km"}}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.inboxCaptureLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"captureId":"capture_1"}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.rawInboxDirectory, "email", "capture", "envelope.json"),
    '{"schema":"murph.inbox-envelope.v1"}\n',
  );

  const manifest = await listCanonicalSourceManifest(vaultRoot);
  const relativePaths = manifest.map((entry) => entry.relativePath);

  assert.deepEqual(relativePaths, [
    VAULT_LAYOUT.coreDocument,
    path.posix.join(VAULT_LAYOUT.auditDirectory, "2026", "2026-04.jsonl"),
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "test-experiment.md"),
    path.posix.join(VAULT_LAYOUT.goalsDirectory, "test-goal.md"),
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-08.md"),
    path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "2026-04.jsonl"),
    VAULT_LAYOUT.metadata,
  ]);
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily-check-in.md")),
    false,
  );
  assert.equal(relativePaths.includes(VAULT_LAYOUT.memoryDocument), false);
  assert.equal(relativePaths.includes(VAULT_LAYOUT.preferencesDocument), false);
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.inboxCaptureLedgerDirectory, "2026", "2026-04.jsonl")),
    false,
  );
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.rawInboxDirectory, "email", "capture", "envelope.json")),
    false,
  );
});
