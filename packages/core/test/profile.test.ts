import assert from "node:assert/strict";
import { access, mkdtemp, rm, rm as remove, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  appendProfileSnapshot,
  initializeVault,
  readCurrentProfile,
  readJsonlRecords,
  rebuildCurrentProfile,
} from "../src/index.js";

type AuditRecordShape = {
  action?: string;
  summary?: string;
  targetIds?: string[];
  changes?: Array<{ path?: string; op?: string }>;
};

function auditsWithAction(records: unknown[], action: string): AuditRecordShape[] {
  return records.filter((record) => (record as AuditRecordShape).action === action) as AuditRecordShape[];
}

test("appendProfileSnapshot keeps current-profile rebuild audit details aligned with the materialized markdown change", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-profile-"));

  try {
    await initializeVault({ vaultRoot });
    const appended = await appendProfileSnapshot({
      vaultRoot,
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "manual",
      profile: {
        topGoalIds: ["goal_sleep"],
        sleep: {
          averageHours: 7,
        },
      },
    });
    const auditRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: appended.auditPath,
    });
    const profileCurrentRebuildAudits = auditsWithAction(auditRecords, "profile_current_rebuild");
    const profileSnapshotAddAudits = auditsWithAction(auditRecords, "profile_snapshot_add");
    const rebuildAuditIndex = auditRecords.findIndex(
      (record) => (record as AuditRecordShape).action === "profile_current_rebuild",
    );
    const snapshotAddAuditIndex = auditRecords.findIndex(
      (record) => (record as AuditRecordShape).action === "profile_snapshot_add",
    );

    assert.equal(profileCurrentRebuildAudits.length, 1);
    assert.equal(profileSnapshotAddAudits.length, 1);
    assert.notEqual(rebuildAuditIndex, -1);
    assert.notEqual(snapshotAddAuditIndex, -1);
    assert.ok(rebuildAuditIndex < snapshotAddAuditIndex);
    assert.equal(
      profileCurrentRebuildAudits[0]?.summary,
      `Rebuilt current profile from snapshot ${appended.snapshot.id}.`,
    );
    assert.deepEqual(profileCurrentRebuildAudits[0]?.targetIds, [appended.snapshot.id]);
    assert.deepEqual(profileCurrentRebuildAudits[0]?.changes, [
      {
        path: "bank/profile/current.md",
        op: "create",
      },
    ]);
    assert.deepEqual(profileSnapshotAddAudits[0]?.changes, [
      {
        path: appended.ledgerPath,
        op: "append",
      },
    ]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("rebuildCurrentProfile removes stale current profile markdown when no snapshots remain", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-profile-"));
  const currentProfilePath = path.join(vaultRoot, "bank/profile/current.md");

  try {
    await initializeVault({ vaultRoot });
    const appended = await appendProfileSnapshot({
      vaultRoot,
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "manual",
      profile: {
        topGoalIds: ["goal_sleep"],
        sleep: {
          averageHours: 7,
        },
      },
    });
    const appendAuditRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: appended.auditPath,
    });

    await access(currentProfilePath);
    await remove(path.join(vaultRoot, "ledger/profile-snapshots"), {
      recursive: true,
      force: true,
    });

    const rebuilt = await rebuildCurrentProfile({ vaultRoot });
    const current = await readCurrentProfile({ vaultRoot });
    const rebuildAuditRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: rebuilt.auditPath,
    });
    const rebuildProfileCurrentAudits = auditsWithAction(rebuildAuditRecords, "profile_current_rebuild");
    const staleRemovalAudit = rebuildProfileCurrentAudits.at(-1);

    assert.equal(rebuilt.exists, false);
    assert.equal(rebuilt.snapshot, null);
    assert.equal(rebuilt.updated, true);
    assert.equal(current.exists, false);
    assert.equal(current.markdown, null);
    assert.equal(staleRemovalAudit?.summary, "Removed stale current profile because no snapshots remain.");
    assert.deepEqual(staleRemovalAudit?.changes, [
      {
        path: "bank/profile/current.md",
        op: "update",
      },
    ]);
    assert.equal(
      appendAuditRecords.filter((record) => (record as { action?: string }).action === "profile_snapshot_add").length,
      1,
    );
    assert.equal(
      auditsWithAction(appendAuditRecords, "profile_current_rebuild").length,
      1,
    );
    assert.equal(rebuildProfileCurrentAudits.length, 2);
    await assert.rejects(access(currentProfilePath));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("rebuildCurrentProfile keeps rebuild audit details aligned when refreshing an existing current profile", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-profile-"));
  const currentProfilePath = path.join(vaultRoot, "bank/profile/current.md");

  try {
    await initializeVault({ vaultRoot });
    const appended = await appendProfileSnapshot({
      vaultRoot,
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "manual",
      profile: {
        topGoalIds: ["goal_sleep"],
        sleep: {
          averageHours: 7,
        },
      },
    });

    await writeFile(currentProfilePath, "# stale current profile\n", "utf8");

    const rebuilt = await rebuildCurrentProfile({ vaultRoot });
    const rebuildAuditRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: rebuilt.auditPath,
    });
    const refreshAudit = auditsWithAction(rebuildAuditRecords, "profile_current_rebuild").at(-1);

    assert.equal(rebuilt.exists, true);
    assert.equal(rebuilt.updated, true);
    assert.equal(rebuilt.snapshot?.id, appended.snapshot.id);
    assert.equal(refreshAudit?.summary, `Rebuilt current profile from snapshot ${appended.snapshot.id}.`);
    assert.deepEqual(refreshAudit?.targetIds, [appended.snapshot.id]);
    assert.deepEqual(refreshAudit?.changes, [
      {
        path: "bank/profile/current.md",
        op: "update",
      },
    ]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("rebuildCurrentProfile records no current-profile file changes when the markdown is already current", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-profile-"));

  try {
    await initializeVault({ vaultRoot });
    const appended = await appendProfileSnapshot({
      vaultRoot,
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "manual",
      profile: {
        topGoalIds: ["goal_sleep"],
        sleep: {
          averageHours: 7,
        },
      },
    });

    const rebuilt = await rebuildCurrentProfile({ vaultRoot });
    const rebuildAuditRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: rebuilt.auditPath,
    });
    const noOpAudit = auditsWithAction(rebuildAuditRecords, "profile_current_rebuild").at(-1);

    assert.equal(rebuilt.exists, true);
    assert.equal(rebuilt.updated, false);
    assert.equal(noOpAudit?.summary, `Rebuilt current profile from snapshot ${appended.snapshot.id}.`);
    assert.deepEqual(noOpAudit?.targetIds, [appended.snapshot.id]);
    assert.deepEqual(noOpAudit?.changes, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
