import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { test, vi } from "vitest";

import { importDeviceBatch, initializeVault, readIntegrationIngestById, type DeviceBatchImportTiming } from "../src/index.ts";
import { buildIntegrationIngestAppendPlanFromInspection, inspectIntegrationIngestHistory } from "../src/integration-ingests.ts";
import * as inventory from "../src/integration-ingest-inventory.ts";
import { withCanonicalWriteLock } from "../src/operations/canonical-write-lock.ts";
import * as publication from "../src/operations/write-batch.ts";

function input(vaultRoot: string, day: number, month = "02") {
  const at = `2026-${month}-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  return { vaultRoot, provider: "synthetic", accountId: "synthetic-account", importedAt: at, events: [{
    kind: "observation" as const, occurredAt: at, recordedAt: at,
    externalRef: { system: "synthetic", resourceType: "metric", resourceId: `sample-${month}-${day}` },
    fields: { metric: "synthetic-metric", unit: "count", value: day },
    evidenceRoles: ["metric"],
  }], evidenceParts: [{ role: "metric", fileName: "metric.json", content: { day, month, text: "雪" } }] };
}

async function withVault(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ingest-inventory-"));
  try {
    await initializeVault({ vaultRoot: root, createdAt: "2026-01-01T00:00:00.000Z" });
    await run(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

for (const change of ["append", "same-size replacement", "same-size write", "truncation", "vault restore", "archive", "month"] as const) {
  test(`ingest inventory discards an unobserved ${change}`, async () => withVault(async (root) => {
    const seed = await importDeviceBatch(input(root, 1));
    assert.ok(seed.ingestShardPath);
    const shard = path.join(root, seed.ingestShardPath);
    let timing: DeviceBatchImportTiming | undefined;
    const options = { onTiming: (value: DeviceBatchImportTiming) => { timing = value; } };
    await importDeviceBatch(input(root, 2), options);
    assert.equal(timing?.ingestInventoryCacheHit, true);
    const bytes = await fs.readFile(shard);
    if (change === "append") {
      const row = JSON.parse(bytes.toString().split("\n")[0]!);
      await fs.appendFile(shard, JSON.stringify({ ...row, id: "xfm_ExternalInventoryAppend" }) + "\n");
    } else if (change === "same-size replacement") {
      await fs.writeFile(`${shard}.replacement`, bytes);
      await fs.rename(`${shard}.replacement`, shard);
    } else if (change === "same-size write") {
      await fs.writeFile(shard, bytes);
    } else if (change === "truncation") {
      await fs.truncate(shard, bytes.indexOf(0x0a) + 1);
    } else if (change === "vault restore") {
      // Keep every shard inode while replacing the vault root itself.
      await fs.rename(root, `${root}-old`);
      await fs.mkdir(root);
      for (const child of await fs.readdir(`${root}-old`)) await fs.rename(path.join(`${root}-old`, child), path.join(root, child));
      await fs.rmdir(`${root}-old`);
    } else if (change === "archive") {
      await fs.writeFile(`${shard}.gz`, gzipSync(bytes));
      await fs.unlink(shard);
    }
    const month = change === "month" ? "03" : "02";
    const next = await importDeviceBatch(input(root, 3, month), options);
    assert.equal(next.applied, true);
    assert.equal(timing?.ingestInventoryCacheHit, false);
    await importDeviceBatch(input(root, 4, month), options);
    assert.equal(timing?.ingestInventoryCacheHit, change !== "archive");
  }));
}

for (const afterCommit of [false, true]) {
  test(`ingest inventory is evicted after failure ${afterCommit ? "after" : "before"} commit`, async () => withVault(async (root) => {
    await importDeviceBatch(input(root, 1));
    const realWrite = publication.runCanonicalWrite;
    const spy = vi.spyOn(publication, "runCanonicalWrite").mockImplementation(async (request) => {
      if (afterCommit) await realWrite(request);
      throw new Error("Synthetic uncertain publication");
    });
    try {
      await assert.rejects(importDeviceBatch(input(root, 2)), /Synthetic uncertain publication/);
    } finally { spy.mockRestore(); }
    let hit: boolean | undefined;
    const retry = await importDeviceBatch(input(root, 2), { onTiming: (timing) => { hit = timing.ingestInventoryCacheHit; } });
    assert.equal(hit, false);
    assert.equal(retry.applied, !afterCommit);
  }));
}

test("warm and cold imports have identical applied, replay and evidence-only results", async () => withVault(async (root) => {
  await withVault(async (coldRoot) => {
    for (const request of [input(root, 1), input(root, 2), input(root, 1), { ...input(root, 2), events: [] }]) {
      const warm = await importDeviceBatch(request);
      inventory.invalidateIntegrationIngestInventory(coldRoot);
      const cold = await importDeviceBatch({ ...request, vaultRoot: coldRoot });
      assert.deepEqual(warm, cold);
      // Restore this resident vault without changing canonical state.
      await withCanonicalWriteLock(root, () => inspectIntegrationIngestHistory(root, request.importedAt, new Set(), { useInventory: true }));
    }
  });
}));

test("inventory capacity counts every row and a different resident vault evicts the old one", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  const shard = path.join(root, seed.ingestShardPath!);
  const original = await fs.readFile(shard);
  const record = JSON.parse(original.toString().trim());
  const history = Array.from({ length: 100_000 }, (_, index) => JSON.stringify({
    ...record, id: `xfm_Capacity${index}`, parts: [],
    outputs: { events: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true },
    counts: { eventCount: 0, sampleCount: 0 },
  })).join("\n") + "\n";
  await fs.appendFile(shard, history);
  const hits: boolean[] = [];
  const options = { onTiming: (timing: DeviceBatchImportTiming) => hits.push(timing.ingestInventoryCacheHit) };
  await importDeviceBatch(input(root, 2), options);
  await importDeviceBatch(input(root, 3), options);
  assert.deepEqual(hits, [false, false]);
  await fs.writeFile(shard, original);
  await importDeviceBatch(input(root, 4));
  await withVault(async (other) => { await importDeviceBatch(input(other, 1)); });
  await importDeviceBatch(input(root, 5), options);
  assert.equal(hits.at(-1), false);
}));

test("committed byte offsets support multibyte evidence and a later evidence-only no-op", async () => withVault(async (root) => {
  await importDeviceBatch(input(root, 1));
  await importDeviceBatch(input(root, 2));
  const scans = vi.spyOn(inventory, "readPlainIngestRows");
  try {
    const replay = await importDeviceBatch({ ...input(root, 2), importedAt: "2026-02-04T00:00:00.000Z", events: [] });
    assert.equal(replay.applied, false);
    assert.equal(scans.mock.calls.length, 0);
  } finally { scans.mockRestore(); }
}));

test("plain inventory scans preserve byte ranges across chunks, CRLF, blank lines and an unfinished tail", async () => withVault(async (root) => {
  const file = path.join(root, "offsets.jsonl");
  const first = JSON.stringify("x".repeat(1024 * 1024 - 3) + "雪");
  const bytes = Buffer.from(`${first}\r\n\n{"text":"雪"}\nunfinished`);
  await fs.writeFile(file, bytes);
  const rows: { line: string; offset: number; length: number; terminated: boolean }[] = [];
  await inventory.readPlainIngestRows(file, 2 * 1024 * 1024, ({ line, range, terminated }) => {
    assert.deepEqual(bytes.subarray(range.offset, range.offset + range.length), line);
    rows.push({ line: line.toString(), ...range, terminated });
  });
  assert.deepEqual(rows.map(({ line, terminated }) => [line, terminated]), [
    [first + "\r", true], ["", true], ['{"text":"雪"}', true], ["unfinished", false],
  ]);
  assert.equal(rows.at(-1)!.offset + rows.at(-1)!.length, bytes.length);
  await assert.rejects(inventory.readPlainIngestRows(file, 1024 * 1024, () => {
    assert.fail("An oversized row must not reach the visitor.");
  }), /exceeds the byte limit/);
}));

test("repeated evidence stops reading candidates once the requested output links are proved", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  const stored = await readIntegrationIngestById(root, seed.ingestId!);
  assert.ok(stored);
  await fs.appendFile(path.join(root, seed.ingestShardPath!), Array.from({ length: 100 }, (_, index) =>
    JSON.stringify({ ...stored.record, id: `xfm_RepeatedEvidence${index}` })
  ).join("\n") + "\n");
  await withCanonicalWriteLock(root, () => inspectIntegrationIngestHistory(root, stored.record.importedAt, new Set(), { useInventory: true }));
  const parses = vi.spyOn(JSON, "parse");
  try {
    const replay = await importDeviceBatch({ ...input(root, 1), importedAt: "2026-02-04T00:00:00.000Z", events: [] });
    assert.equal(replay.applied, false);
    assert.equal(parses.mock.calls.filter(([line]) => line.includes('"parts":')).length, 1);
  } finally { parses.mockRestore(); }
}));

test("a second applied import on a large shard never reads or parses its full prefix", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  assert.ok(seed.ingestId && seed.ingestShardPath);
  const stored = await readIntegrationIngestById(root, seed.ingestId);
  assert.ok(stored);
  const padding = Array.from({ length: 65 }, (_, index) => JSON.stringify({
    ...stored.record, id: `xfm_${index.toString(16).padStart(24, "0")}`, provider: "unrelated",
    provenance: { padding: "x".repeat(140_000) },
  })).join("\r\n") + "\r\n";
  await fs.appendFile(path.join(root, seed.ingestShardPath), padding);
  await importDeviceBatch(input(root, 2));
  const scans = vi.spyOn(inventory, "readPlainIngestRows");
  const parses = vi.spyOn(JSON, "parse");
  try {
    let timing: DeviceBatchImportTiming | undefined;
    const next = await importDeviceBatch(input(root, 3), { onTiming: (value) => { timing = value; } });
    assert.equal(next.applied, true);
    assert.equal(timing?.ingestInventoryCacheHit, true);
    assert.ok((timing?.ingestInspectionElapsedMs ?? -1) >= 0);
    assert.equal(scans.mock.calls.length, 0);
    assert.equal(parses.mock.calls.filter(([line]) => line.includes('"provider":"unrelated"')).length, 0);
    assert.ok(await readIntegrationIngestById(root, next.ingestId!));
  } finally { scans.mockRestore(); parses.mockRestore(); }
}));

test("late association IDs use the same inventory and retain the append conflict guard", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  const stored = await readIntegrationIngestById(root, seed.ingestId!);
  assert.ok(stored);
  await withCanonicalWriteLock(root, async () => {
    const inspection = await inspectIntegrationIngestHistory(root, stored.record.importedAt, new Set(["xfm_InitialCandidate"]), { useInventory: true });
    assert.equal(inspection.inventoryCacheHit, true);
    assert.equal(inspection.entriesById.has(stored.record.id), false);
    assert.throws(() => buildIntegrationIngestAppendPlanFromInspection([stored.record], inspection), /different delivery/);
    const extended = await inspection.inspectIds([stored.record.id, "xfm_NewAssociation"]);
    assert.equal(extended, inspection);
    assert.deepEqual(buildIntegrationIngestAppendPlanFromInspection([stored.record], extended).appendedIds, []);
    assert.throws(() => buildIntegrationIngestAppendPlanFromInspection([{ ...stored.record, accountId: "other-account" }], extended));
    assert.deepEqual(buildIntegrationIngestAppendPlanFromInspection([{ ...stored.record, id: "xfm_NewAssociation" }], extended).appendedIds, ["xfm_NewAssociation"]);
  });
}));

test("an unrelated integrity failure preserves warm reuse and is rejected when selected by offset", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  const stored = await readIntegrationIngestById(root, seed.ingestId!);
  assert.ok(stored);
  const target = { ...stored.record, id: "xfm_InvalidOldEvidence", provider: "unrelated" };
  const invalid = { ...target, parts: [{ ...target.parts[0], content: "invalid" }] };
  const padding = Array.from({ length: 65 }, (_, index) => ({
    ...stored.record, id: `xfm_UnrelatedPadding${index}`, provenance: { padding: "x".repeat(140_000) },
  }));
  await fs.appendFile(path.join(root, seed.ingestShardPath!), [invalid, ...padding].map((row) => JSON.stringify(row)).join("\n") + "\n");
  let hit: boolean | undefined;
  const options = { onTiming: (timing: DeviceBatchImportTiming) => { hit = timing.ingestInventoryCacheHit; } };
  assert.equal((await importDeviceBatch(input(root, 2), options)).applied, true);
  assert.equal(hit, false);
  const scans = vi.spyOn(inventory, "readPlainIngestRows");
  try {
    assert.equal((await importDeviceBatch(input(root, 3), options)).applied, true);
    assert.equal(hit, true);
    await withCanonicalWriteLock(root, async () => {
      const inspection = await inspectIntegrationIngestHistory(root, target.importedAt, new Set(), {
        useInventory: true, deferEvidence: true,
        evidence: { provider: target.provider, accountId: target.accountId, parts: target.parts },
      });
      assert.equal(inspection.inventoryCacheHit, true);
      assert.equal(inspection.invalidIds.has(target.id), false);
      const novelty = await inspection.inspectEvidence({ includeReceipt: false });
      assert.equal(inspection.invalidIds.has(target.id), true);
      assert.deepEqual(novelty.parts, target.parts);
      assert.equal(scans.mock.calls.length, 0);
      const withId = await inspection.inspectIds([target.id]);
      assert.equal(withId.invalidIds.has(target.id), true);
      assert.throws(() => buildIntegrationIngestAppendPlanFromInspection([target], withId));
    });
  } finally { scans.mockRestore(); }
}));

for (const corruption of ["duplicate", "invalid"] as const) {
  test(`an old ${corruption} ID beyond the tail takes the slow path`, async () => withVault(async (root) => {
    const seed = await importDeviceBatch(input(root, 1));
    const stored = await readIntegrationIngestById(root, seed.ingestId!);
    assert.ok(stored);
    const target = { ...stored.record, id: "xfm_OldConflictingInventoryId" };
    const rows = corruption === "duplicate" ? [target, { ...target, accountId: "other-account" }] : [{ ...target, parts: [{ ...target.parts[0], content: "invalid" }] }];
    rows.push(...Array.from({ length: 65 }, (_, index) => ({ ...stored.record, id: `xfm_Padding${index}`, provenance: { padding: "x".repeat(140_000) } })));
    await fs.appendFile(path.join(root, seed.ingestShardPath!), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await withCanonicalWriteLock(root, async () => {
      await inspectIntegrationIngestHistory(root, stored.record.importedAt, new Set(["xfm_Absent"]), { useInventory: true });
      const inspection = await inspectIntegrationIngestHistory(root, stored.record.importedAt, new Set([target.id]), { useInventory: true });
      assert.equal(inspection.inventoryCacheHit, false);
      assert.equal(inspection.invalidIds.has(target.id), true);
      assert.throws(() => buildIntegrationIngestAppendPlanFromInspection([target], inspection));
    });
  }));
}
