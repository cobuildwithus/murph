import { readFreshQueryProjectionSections } from "../src/projection/freshness.ts";
import { listCanonicalSourceManifest } from "../src/vault-source.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { importDeviceBatch, initializeVault } from "@murphai/core";
import type { MetricPoint } from "@murphai/health-metrics";
import { withImmediateTransaction } from "@murphai/runtime-state/node";
import { afterEach, test } from "vitest";

import { listMetricPoints } from "../src/index.ts";
import { insertMetricPoints, listStoredMetricPoints } from "../src/projection/metric-store.ts";
import {
  QUERY_PROJECTION_SQLITE_VERSION,
  currentQueryProjectionLocation,
  ensureQueryProjectionSectionSchema,
  openQueryProjectionDatabase,
  type DatabaseSync,
} from "../src/projection/schema.ts";
import { getQueryProjectionStatus } from "../src/query-projection.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-clustered-"));
  roots.push(root);
  return root;
}

// The actual v35 metric layout, including its required sort_rank and global ID
// constraint. Other query tables did not change in v36.
function restoreV35MetricTable(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(query_metric_points)").all()
    .map(row => String(row.name)).filter(name => name !== "sort_rank").join(", ");
  withImmediateTransaction(database, () => database.exec(`
    CREATE TEMP TABLE saved_metric_points AS SELECT * FROM query_metric_points;
    DROP TABLE query_metric_points;
    CREATE TABLE query_metric_points (
      id TEXT PRIMARY KEY,
      sort_rank INTEGER NOT NULL,
      metric_key TEXT NOT NULL,
      biomarker_key TEXT,
      value REAL,
      text_value TEXT,
      comparator TEXT,
      unit TEXT,
      canonical_value REAL,
      canonical_unit TEXT,
      observed_at TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      recorded_at TEXT,
      reported_at TEXT,
      grain TEXT NOT NULL,
      statistic TEXT NOT NULL,
      source_family TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_result_index INTEGER,
      source_path TEXT NOT NULL,
      confidence TEXT NOT NULL,
      payload_id INTEGER NOT NULL REFERENCES query_metric_payloads(payload_id)
    );
    INSERT INTO query_metric_points (sort_rank, ${columns})
      SELECT 0, ${columns} FROM saved_metric_points;
    DROP TABLE saved_metric_points;
    CREATE INDEX query_metric_points_metric_latest_idx
      ON query_metric_points(metric_key, effective_date DESC, observed_at DESC);
    CREATE INDEX query_metric_points_biomarker_latest_idx
      ON query_metric_points(biomarker_key, effective_date DESC, observed_at DESC)
      WHERE biomarker_key IS NOT NULL;
    PRAGMA user_version = 35;
  `));
}

function point(index: number): MetricPoint {
  const date = `2026-09-${String(1 + index % 3).padStart(2, "0")}`;
  return {
    id: `metric-point:synthetic:${index}`, schemaVersion: "murph.metric-point.v1",
    metricKey: index % 2 ? "apob" : "steps", biomarkerKey: index % 2 ? "biomarker:apob" : null,
    value: index, canonicalValue: index, unit: "count", canonicalUnit: "count",
    textValue: null, comparator: null, observedAt: `${date}T${index % 5 ? "12" : "13"}:00:00Z`,
    effectiveDate: date, recordedAt: null, reportedAt: null,
    grain: "day", statistic: "value", confidence: "high", context: {},
    source: { family: "event", kind: "observation", recordId: `evt_synthetic_${index}`,
      resultIndex: null, path: "ledger/events/2026/2026-09.jsonl" },
    provenance: { dataOrigin: null, externalRef: null, labName: null,
      provider: null, rawRefs: [], sourceLabel: null },
  };
}

test("a populated v35 file rebuilds to the current schema through an ordinary metric read", async () => {
  const root = await tempRoot();
  await initializeVault({ vaultRoot: root });
  await importDeviceBatch({
    vaultRoot: root, provider: "synthetic", importedAt: "2026-09-04T00:00:00Z",
    events: Array.from({ length: 12 }, (_, index) => ({
      kind: "observation", occurredAt: point(index).observedAt,
      recordedAt: "2026-09-04T00:00:00Z", timeZone: "UTC",
      title: "Synthetic metric observation",
      externalRef: { system: "synthetic", resourceType: "metric", resourceId: `sample-${index}` },
      fields: { metric: "caffeine", unit: "mg", value: index },
    })),
  });
  const expected = await listMetricPoints(root, { limit: null });
  assert.equal(expected.length, 12);
  const location = currentQueryProjectionLocation(root);
  const old = openQueryProjectionDatabase(location);
  try { restoreV35MetricTable(old); } finally { old.close(); }
  assert.deepEqual(listStoredMetricPoints(location, { limit: null }), expected);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  assert.deepEqual(await listMetricPoints(root, { limit: null }), expected);
  assert.deepEqual([...await readFreshQueryProjectionSections(location, await listCanonicalSourceManifest(root))], ["metrics"]);
  const rebuilt = openQueryProjectionDatabase(location, { readOnly: true });
  try {
    assert.equal(rebuilt.prepare("PRAGMA user_version").get()?.user_version, QUERY_PROJECTION_SQLITE_VERSION);
    assert.equal(rebuilt.prepare("PRAGMA table_info(query_metric_points)").all()
      .some(row => row.name === "sort_rank"), false);
    assert.throws(() => rebuilt.prepare("SELECT rowid FROM query_metric_points"), /no such column: rowid/u);
  } finally { rebuilt.close(); }
});

test("clustered metric reads match v35 byte for byte across filters, limits and tied timestamps", async () => {
  const root = await tempRoot();
  const current = currentQueryProjectionLocation(root);
  const legacy = currentQueryProjectionLocation(path.join(root, "legacy"));
  const points = Array.from({ length: 240 }, (_, index) => point(index));
  for (const location of [current, legacy]) {
    const database = openQueryProjectionDatabase(location);
    ensureQueryProjectionSectionSchema(database, "metrics");
    try {
      withImmediateTransaction(database, () => insertMetricPoints(database, points));
      if (location === legacy) restoreV35MetricTable(database);
    } finally { database.close(); }
  }
  for (const metricKey of [undefined, "steps", "apob", "absent"]) {
    for (const biomarkerKey of [undefined, "biomarker:apob", "absent"]) {
      for (const from of [undefined, "2026-09-02", "2026-09-04"]) {
        for (const to of [undefined, "2026-09-02", "2026-08-31"]) {
          for (const limit of [undefined, null, 1, 17]) {
            const filters = { metricKey, biomarkerKey, from, to, limit };
            assert.equal(JSON.stringify(listStoredMetricPoints(current, filters)),
              JSON.stringify(listStoredMetricPoints(legacy, filters)), JSON.stringify(filters));
          }
        }
      }
    }
  }
  const database = openQueryProjectionDatabase(current, { readOnly: true });
  ensureQueryProjectionSectionSchema(database, "metrics");
  try {
    const plan = database.prepare(`
      EXPLAIN QUERY PLAN SELECT id, metric_point_json FROM query_metric_points
      JOIN query_metric_payloads USING (payload_id)
      WHERE metric_key = ? ORDER BY effective_date DESC, observed_at DESC, id ASC LIMIT 10
    `).all("steps");
    assert.ok(plan.some(row => String(row.detail).includes("PRIMARY KEY")));
    assert.ok(plan.every(row => !String(row.detail).includes("TEMP B-TREE")));
    assert.equal(database.prepare("PRAGMA index_list(query_metric_points)").all()
      .some(row => row.name === "query_metric_points_metric_latest_idx"), false);
  } finally { database.close(); }
});

test.each([
  { metricKey: "other" },
  { effectiveDate: "2026-09-04" },
  { observedAt: "2026-09-01T18:00:00Z" },
])("duplicate IDs across clustered key components still abort publication: %j", async override => {
  const database = openQueryProjectionDatabase(currentQueryProjectionLocation(await tempRoot()));
  ensureQueryProjectionSectionSchema(database, "metrics");
  try {
    const original = point(0);
    assert.throws(() => withImmediateTransaction(database, () => insertMetricPoints(database, [
      original, { ...original, ...override },
    ])), /UNIQUE constraint failed: query_metric_points.id/u);
    assert.equal(database.prepare("SELECT count(*) AS count FROM query_metric_points").get()?.count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM query_metric_payloads").get()?.count, 0);
  } finally { database.close(); }
});
