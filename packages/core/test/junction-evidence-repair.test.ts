import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import { test } from "vitest";

import type { AuditRecord, EventRecord, IntegrationIngestRecord } from "@murphai/contracts";

import {
  deterministicContractId,
  importDeviceBatch,
  initializeVault,
  readJsonlRecords,
  repairJunctionEvidenceDuplicates,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function snapshotVaultFiles(vaultRoot: string): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const relativePath of await fs.readdir(vaultRoot, { recursive: true })) {
    const absolutePath = path.join(vaultRoot, relativePath);
    if ((await fs.stat(absolutePath)).isFile()) {
      snapshot.set(relativePath, await fs.readFile(absolutePath));
    }
  }
  return snapshot;
}

function buildInput(vaultRoot: string) {
  return {
    vaultRoot,
    provider: "junction",
    accountId: "junction-account",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [{
      kind: "observation" as const,
      occurredAt: "2026-06-03T12:00:00.000Z",
      recordedAt: "2026-06-03T21:00:00.000Z",
      title: "Daily activity",
      externalRef: {
        system: "junction",
        resourceType: "daily-activity",
        resourceId: "activity-2026-06-03",
      },
      fields: {
        metric: "daily-steps",
        observationGrain: "summary" as const,
        unit: "count",
        value: 8_000,
      },
      evidenceRoles: ["junction-summary-activity"],
    }],
    evidenceParts: [{
      role: "junction-summary-activity",
      fileName: "junction-summary-activity.json",
      content: { date: "2026-06-03", steps: 8_000 },
    }],
  };
}

async function prependHistoricalProofRow(input: {
  ingestPath: string;
  vaultRoot: string;
}): Promise<{ current: IntegrationIngestRecord; proof: IntegrationIngestRecord }> {
  const absolutePath = path.join(input.vaultRoot, input.ingestPath);
  const [current] = await readJsonlRecords({
    vaultRoot: input.vaultRoot,
    relativePath: input.ingestPath,
  }) as IntegrationIngestRecord[];
  assert.ok(current);
  const proof: IntegrationIngestRecord = {
    ...current,
    id: deterministicContractId("xfm", `historical-proof:${current.id}`),
  };
  await fs.writeFile(
    absolutePath,
    `${JSON.stringify(proof)}\n${JSON.stringify(current)}\n`,
    "utf8",
  );
  return { current, proof };
}

test("historical Junction evidence repair filters proven duplicate parts and exact replay stays a no-op", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const deviceInput = buildInput(vaultRoot);
  const imported = await importDeviceBatch(deviceInput);
  assert.ok(imported.ingestShardPath);
  const { current, proof } = await prependHistoricalProofRow({
    ingestPath: imported.ingestShardPath,
    vaultRoot,
  });

  const bounded = await repairJunctionEvidenceDuplicates({ maxIngestBytes: 1, vaultRoot });
  assert.equal(bounded.hasWork, false);
  assert.equal(bounded.blockedReason, "ingest_bounds_exceeded");

  const beforeDryRun = await fs.readFile(path.join(vaultRoot, imported.ingestShardPath));
  const dryRun = await repairJunctionEvidenceDuplicates({ vaultRoot });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.hasWork, true);
  assert.equal(dryRun.candidatePartCount, 1);
  assert.equal(dryRun.candidateRowCount, 1);
  assert.equal(dryRun.candidateShardCount, 1);
  assert.equal(dryRun.blockedReason, null);
  assert.equal(dryRun.skippedArchivedShardCount, 0);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, imported.ingestShardPath)),
    beforeDryRun,
  );

  const applied = await repairJunctionEvidenceDuplicates({ apply: true, vaultRoot });
  assert.equal(applied.mutated, true);
  assert.ok(applied.auditPath);
  const rows = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.ingestShardPath,
  }) as IntegrationIngestRecord[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], proof);
  assert.equal(rows[1]?.id, current.id);
  assert.equal(rows[1]?.evidenceRetention, "filtered");
  assert.deepEqual(rows[1]?.parts, []);
  assert.deepEqual(rows[1]?.outputs.events, [{ id: imported.events[0]?.id, roles: [] }]);
  assert.deepEqual(rows[1]?.receipt, current.receipt);
  assert.deepEqual(rows[1]?.provenance, current.provenance);
  assert.deepEqual(rows[1]?.counts, current.counts);

  const repairAudits = await readJsonlRecords({
    vaultRoot,
    relativePath: applied.auditPath,
  }) as AuditRecord[];
  const repairAudit = repairAudits.find((record) =>
    record.commandName === "core.repairJunctionEvidenceDuplicates"
  );
  assert.ok(repairAudit);
  assert.equal(repairAudit.action, "vault_repair");
  assert.equal(repairAudit.targetIds, undefined);
  assert.deepEqual(repairAudit.changes, [{ op: "update", path: imported.ingestShardPath }]);
  assert.equal(repairAudit.summary.includes("junction-account"), false);
  assert.equal(repairAudit.summary.includes("Daily activity"), false);

  const replay = await importDeviceBatch(deviceInput);
  assert.equal(replay.applied, false);
  assert.equal(replay.ingestId, null);
  assert.equal((await readJsonlRecords({
    vaultRoot,
    relativePath: imported.ingestShardPath,
  })).length, 2);
  const beforeNoWorkApply = await snapshotVaultFiles(vaultRoot);
  const rerun = await repairJunctionEvidenceDuplicates({ apply: true, vaultRoot });
  assert.equal(rerun.hasWork, false);
  assert.equal(rerun.mutated, false);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeNoWorkApply);
});

test("historical Junction evidence repair preserves an exact part with a novel event link", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-novel-link");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const deviceInput = buildInput(vaultRoot);
  const imported = await importDeviceBatch({
    ...deviceInput,
    events: [
      ...deviceInput.events,
      {
        ...deviceInput.events[0],
        occurredAt: "2026-06-04T12:00:00.000Z",
        recordedAt: "2026-06-04T21:00:00.000Z",
        title: "Next daily activity",
        externalRef: {
          system: "junction",
          resourceType: "daily-activity",
          resourceId: "activity-2026-06-04",
        },
      },
    ],
  });
  assert.ok(imported.ingestShardPath);
  const [current] = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.ingestShardPath,
  }) as IntegrationIngestRecord[];
  assert.ok(current);
  assert.equal(current.outputs.events.length, 2);
  const [proofEvent] = current.outputs.events;
  assert.ok(proofEvent);
  const proof: IntegrationIngestRecord = {
    ...current,
    id: deterministicContractId("xfm", `novel-link-proof:${current.id}`),
    outputs: {
      ...current.outputs,
      events: [proofEvent],
    },
    counts: { ...current.counts, eventCount: 1 },
  };
  await fs.writeFile(
    path.join(vaultRoot, imported.ingestShardPath),
    `${JSON.stringify(proof)}\n${JSON.stringify(current)}\n`,
    "utf8",
  );

  const before = await snapshotVaultFiles(vaultRoot);
  const result = await repairJunctionEvidenceDuplicates({ apply: true, vaultRoot });
  assert.equal(result.hasWork, false);
  assert.equal(result.candidatePartCount, 0);
  assert.equal(result.mutated, false);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
});

test("historical Junction evidence repair excludes accountless, incomplete, and sample-linked rows", async () => {
  const cases = ["accountless", "incomplete", "sample-linked"] as const;
  for (const scenario of cases) {
    const vaultRoot = await makeTempDirectory(`murph-junction-evidence-${scenario}`);
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const imported = await importDeviceBatch(buildInput(vaultRoot));
    assert.ok(imported.ingestShardPath);
    const [stored] = await readJsonlRecords({
      vaultRoot,
      relativePath: imported.ingestShardPath,
    }) as IntegrationIngestRecord[];
    assert.ok(stored);

    const makeIneligible = (record: IntegrationIngestRecord): IntegrationIngestRecord => {
      if (scenario === "accountless") {
        const { accountId: _accountId, ...accountless } = record;
        return accountless;
      }
      if (scenario === "incomplete") {
        return {
          ...record,
          outputs: { ...record.outputs, eventIdsComplete: false },
        };
      }
      return {
        ...record,
        outputs: {
          ...record.outputs,
          sampleIds: [deterministicContractId("smp", "junction-evidence-repair-sample")],
        },
        counts: { ...record.counts, sampleCount: 1 },
      };
    };
    const current = makeIneligible(stored);
    const proof = makeIneligible({
      ...stored,
      id: deterministicContractId("xfm", `${scenario}-proof:${stored.id}`),
    });
    await fs.writeFile(
      path.join(vaultRoot, imported.ingestShardPath),
      `${JSON.stringify(proof)}\n${JSON.stringify(current)}\n`,
      "utf8",
    );

    const before = await snapshotVaultFiles(vaultRoot);
    const result = await repairJunctionEvidenceDuplicates({ apply: true, vaultRoot });
    assert.equal(result.hasWork, false, scenario);
    assert.equal(result.candidatePartCount, 0, scenario);
    assert.equal(result.mutated, false, scenario);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), before, scenario);
  }
});

test("historical Junction evidence repair preserves evidence when its event spine is missing", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-missing-event");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const imported = await importDeviceBatch(buildInput(vaultRoot));
  assert.ok(imported.ingestShardPath);
  await prependHistoricalProofRow({ ingestPath: imported.ingestShardPath, vaultRoot });
  const eventPath = imported.eventShardPaths[0];
  assert.ok(eventPath);
  await fs.unlink(path.join(vaultRoot, eventPath));

  const result = await repairJunctionEvidenceDuplicates({ vaultRoot });
  assert.equal(result.hasWork, false);
  assert.equal(result.candidatePartCount, 0);
  assert.equal(result.revisionProtectedPartCount, 1);
});

test("historical Junction evidence repair preserves evidence linked to a multi-row event spine", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-revision-proof");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const imported = await importDeviceBatch(buildInput(vaultRoot));
  assert.ok(imported.ingestShardPath);
  await prependHistoricalProofRow({ ingestPath: imported.ingestShardPath, vaultRoot });
  const eventPath = imported.eventShardPaths[0];
  assert.ok(eventPath);
  const [event] = await readJsonlRecords({ vaultRoot, relativePath: eventPath }) as EventRecord[];
  assert.ok(event);
  await fs.appendFile(path.join(vaultRoot, eventPath), `${JSON.stringify(event)}\n`, "utf8");

  const bounded = await repairJunctionEvidenceDuplicates({ maxEventRows: 1, vaultRoot });
  assert.equal(bounded.hasWork, false);
  assert.equal(bounded.blockedReason, "event_bounds_exceeded");
  assert.equal(bounded.scannedEventRowCount, 1);

  const result = await repairJunctionEvidenceDuplicates({ vaultRoot });
  assert.equal(result.hasWork, false);
  assert.equal(result.candidatePartCount, 0);
  assert.equal(result.revisionProtectedPartCount, 1);
});

test("current filtered device ingests carry explicit partial-evidence semantics", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-current-marker");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const firstInput = buildInput(vaultRoot);
  const first = await importDeviceBatch(firstInput);
  const changedInput = {
    ...firstInput,
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      ...firstInput.events,
      {
        kind: "observation" as const,
        occurredAt: "2026-06-03T22:00:00.000Z",
        recordedAt: "2026-06-04T21:00:00.000Z",
        title: "Daily sleep",
        externalRef: {
          system: "junction",
          resourceType: "daily-sleep",
          resourceId: "sleep-2026-06-03",
        },
        fields: {
          metric: "sleep-score",
          observationGrain: "summary" as const,
          unit: "%",
          value: 90,
        },
        evidenceRoles: ["junction-summary-sleep"],
      },
    ],
    evidenceParts: [
      ...firstInput.evidenceParts,
      {
        role: "junction-summary-sleep",
        fileName: "junction-summary-sleep.json",
        content: { date: "2026-06-03", score: 90 },
      },
    ],
  };
  const changed = await importDeviceBatch(changedInput);
  assert.ok(first.applied);
  assert.ok(changed.applied);
  assert.ok(changed.ingestId);
  const rows = await readJsonlRecords({
    vaultRoot,
    relativePath: changed.ingestShardPath as string,
  }) as IntegrationIngestRecord[];
  const stored = rows.find((row) => row.id === changed.ingestId);
  assert.equal(stored?.evidenceRetention, "filtered");
  assert.equal(stored?.parts.length, 1);
});

test("historical Junction evidence repair preserves later changed evidence and event revisions", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-later-revision");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const originalInput = buildInput(vaultRoot);
  const original = await importDeviceBatch(originalInput);
  assert.ok(original.ingestShardPath);
  await prependHistoricalProofRow({ ingestPath: original.ingestShardPath, vaultRoot });
  const repaired = await repairJunctionEvidenceDuplicates({ apply: true, vaultRoot });
  assert.equal(repaired.mutated, true);

  const changedInput = {
    ...originalInput,
    importedAt: "2026-06-04T21:00:00.000Z",
    events: originalInput.events.map((event) => ({
      ...event,
      recordedAt: "2026-06-04T21:00:00.000Z",
      fields: { ...event.fields, value: 8_500 },
    })),
    evidenceParts: originalInput.evidenceParts.map((part) => ({
      ...part,
      content: { date: "2026-06-03", steps: 8_500 },
    })),
  };
  const changed = await importDeviceBatch(changedInput);
  assert.equal(changed.applied, true);
  assert.equal(changed.persistedEvidencePartCount, 1);
  assert.ok(changed.ingestId);
  const rows = await readJsonlRecords({
    vaultRoot,
    relativePath: changed.ingestShardPath as string,
  }) as IntegrationIngestRecord[];
  const changedRow = rows.find((row) => row.id === changed.ingestId);
  assert.equal(changedRow?.evidenceRetention, undefined);
  assert.equal(changedRow?.parts.length, 1);

  const eventPath = changed.eventShardPaths[0];
  assert.ok(eventPath);
  const eventRows = await readJsonlRecords({ vaultRoot, relativePath: eventPath });
  assert.equal(eventRows.length, 2);
});

test("historical Junction evidence repair explicitly reports archived shards as skipped", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-evidence-archived-skip");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const imported = await importDeviceBatch(buildInput(vaultRoot));
  assert.ok(imported.ingestShardPath);
  await prependHistoricalProofRow({ ingestPath: imported.ingestShardPath, vaultRoot });
  const absolutePath = path.join(vaultRoot, imported.ingestShardPath);
  await fs.writeFile(`${absolutePath}.gz`, gzipSync(await fs.readFile(absolutePath)));
  await fs.unlink(absolutePath);

  const result = await repairJunctionEvidenceDuplicates({ vaultRoot });
  assert.equal(result.hasWork, false);
  assert.equal(result.mutated, false);
  assert.equal(result.scannedIngestShardCount, 0);
  assert.equal(result.skippedArchivedShardCount, 1);
});
