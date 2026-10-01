import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { readExperimentQuerySource } from "../src/experiment-query-source.ts";
import { readVault } from "../src/vault-reader.ts";
import { listMetricPointsBatchRuntime } from "../src/query-projection.ts";
import type { QueryMetricPointFilters } from "../src/query-projection-types.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "experiment-query-source-"));
  roots.push(root);
  await mkdir(path.join(root, "ledger/events/2026"), { recursive: true });
  await writeFile(path.join(root, "vault.json"), JSON.stringify({
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    createdAt: "2026-01-01T00:00:00Z", title: "Synthetic progress", timezone: "UTC",
  }));
  const events = Array.from({ length: 12 }, (_, i) => ({
    schemaVersion: "murph.event.v1", id: `evt_synthetic_progress_${i}`,
    kind: "observation", occurredAt: `2026-06-${String(i + 1).padStart(2, "0")}T07:00:00Z`,
    recordedAt: "2026-07-01T00:00:00Z", source: "device", title: "Synthetic metric",
    dayKey: `2026-06-${String(i + 1).padStart(2, "0")}`,
    metric: i % 2 ? "weight" : "sleep-efficiency", value: 80 + i,
    unit: i % 2 ? "kg" : "percent", visibility: i % 3 ? "display" : undefined,
    externalRef: { system: "whoop", resourceType: "sleep", resourceId: `synthetic-${i}` },
    dataOrigin: i % 2 ? { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop", originConfidence: "high" } : undefined,
    rawRefs: [`raw/synthetic-${i}.json`], lifecycle: { revision: 1 },
  }));
  const shard = path.join(root, "ledger/events/2026/2026-06.jsonl");
  await writeFile(shard, events.map(event => JSON.stringify(event)).join("\n") + "\n");
  return { root, shard, events };
}

test("direct experiment source matches SQLite filtering, ordering and safe metric evidence without creating its cache", async () => {
  const { root } = await fixture();
  const source = await readExperimentQuerySource(root);
  const filters: QueryMetricPointFilters[][] = [
    [], [{ limit: null }], [{ limit: 2 }], [{ limit: -1 }],
    [{ metricKey: "sleep-efficiency", from: "2026-06-03", to: "2026-06-09", limit: null }],
    [{ biomarkerKey: "biomarker:weight", limit: 3 }],
    [{ metricKey: "sleep-efficiency", limit: 3 }, { metricKey: "sleep-efficiency", limit: null }],
    [{ metricKey: "unknown", limit: null }],
    [{ metricKey: "weight", limit: null }, { metricKey: "sleep-efficiency", limit: null }],
  ];
  const actual = filters.map(filter => source.listMetricPoints(filter));
  assert.ok(actual[1]!.length > 0);
  assert.ok(source.readModel.entities.length < 12, "hidden observations must stay hidden");
  assert.equal(existsSync(path.join(root, ".runtime/projections/query.sqlite")), false);
  assert.deepEqual(source.readModel, await readVault(root));
  for (const [index, filter] of filters.entries()) {
    assert.deepEqual(actual[index], await listMetricPointsBatchRuntime(root, filter));
  }
  assert.ok(actual[1]!.every(point => point.provenance.dataOrigin === null));
  assert.ok(actual[1]!.every(point => point.provenance.rawRefs.length === 0));
});

test("each experiment read sees corrections and deletions while its lazy metrics use the original snapshot", async () => {
  const { root, shard, events } = await fixture();
  const before = await readExperimentQuerySource(root);
  const filters = [{ metricKey: "weight", limit: null }] as const;
  await appendFile(shard, JSON.stringify({ ...events[1], value: 65, recordedAt: "2026-07-02T00:00:00Z", lifecycle: { revision: 2 } }) + "\n");
  const corrected = await readExperimentQuerySource(root);
  assert.ok(before.listMetricPoints(filters).some(point => point.value === 81));
  assert.ok(corrected.listMetricPoints(filters).some(point => point.value === 65));
  assert.ok(!corrected.listMetricPoints(filters).some(point => point.value === 81));
  await appendFile(shard, JSON.stringify({ ...events[1], recordedAt: "2026-07-03T00:00:00Z", lifecycle: { revision: 3, state: "deleted" } }) + "\n");
  const deleted = await readExperimentQuerySource(root);
  assert.ok(!deleted.listMetricPoints(filters).some(point => point.value === 65));
  assert.equal(existsSync(path.join(root, ".runtime/projections/query.sqlite")), false);
  assert.deepEqual(deleted.listMetricPoints(filters), await listMetricPointsBatchRuntime(root, filters));
});
