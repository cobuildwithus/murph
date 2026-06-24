import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";

import { afterEach, test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, VAULT_LAYOUT } from "@murphai/contracts";

import {
  hashCanonicalQuerySources,
  isCanonicalQuerySourcePath,
  listCanonicalSourceManifest,
} from "../src/vault-source.ts";

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

  await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, `{"formatVersion":${CURRENT_VAULT_FORMAT_VERSION}}\n`);
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
    path.posix.join(VAULT_LAYOUT.integrationIngestLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"id":"xfm_1"}\n',
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
    '{"schemaVersion":1,"updatedAt":"2026-04-08T00:00:00.000Z","workoutUnitPreferences":{"weight":"kg"}}\n',
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
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.integrationIngestLedgerDirectory, "2026", "2026-04.jsonl")),
    false,
  );
});

test("hashCanonicalQuerySources is stable across mtimes and ignores non-query files", async () => {
  const vaultRoot = await createTempVaultRoot();
  const experimentPath = path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md");
  const automationPath = path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily.md");
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, `{"formatVersion":${CURRENT_VAULT_FORMAT_VERSION}}\n`);
  await writeVaultFile(vaultRoot, experimentPath, "---\ntitle: Trial\n---\n# Trial\n");

  const initial = await hashCanonicalQuerySources(vaultRoot);
  await utimes(
    path.join(vaultRoot, experimentPath),
    new Date("2026-05-01T00:00:00.000Z"),
    new Date("2026-05-01T00:00:00.000Z"),
  );
  await writeVaultFile(vaultRoot, automationPath, "---\ntitle: Daily\n---\nPrompt\n");
  const touched = await hashCanonicalQuerySources(vaultRoot);

  assert.deepEqual(touched, initial);
  await writeVaultFile(vaultRoot, experimentPath, "---\ntitle: Trial Changed\n---\n# Trial\n");
  const changed = await hashCanonicalQuerySources(vaultRoot);
  assert.notEqual(changed.hash, initial.hash);
});

test("hashCanonicalQuerySources changes when query-visible files are deleted", async () => {
  const vaultRoot = await createTempVaultRoot();
  const experimentPath = path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md");
  await writeVaultFile(vaultRoot, experimentPath, "---\ntitle: Trial\n---\n# Trial\n");

  const populated = await hashCanonicalQuerySources(vaultRoot);
  await rm(path.join(vaultRoot, experimentPath));
  const empty = await hashCanonicalQuerySources(vaultRoot);

  assert.equal(populated.fileCount, 1);
  assert.equal(empty.fileCount, 0);
  assert.notEqual(empty.hash, populated.hash);
});

test("isCanonicalQuerySourcePath matches the shared source families", () => {
  assert.equal(isCanonicalQuerySourcePath(VAULT_LAYOUT.metadata), true);
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md")),
    true,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "events.jsonl")),
    true,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.integrationIngestLedgerDirectory, "2026", "ingests.jsonl")),
    false,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily.md")),
    false,
  );
  assert.equal(isCanonicalQuerySourcePath("../vault.json"), false);
  assert.equal(isCanonicalQuerySourcePath("experiments\\trial.md"), false);
});
