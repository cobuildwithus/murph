import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { addMeal, initializeVault } from "@murphai/core";
import type { MetricPoint } from "@murphai/health-metrics";
import { withImmediateTransaction } from "@murphai/runtime-state/node";
import { test } from "vitest";

import { getQueryProjectionStatus, listCanonicalEntitiesRuntime, rebuildQueryProjection } from "../src/query-projection.ts";
import { readProjectionStatus } from "../src/projection/freshness.ts";
import { insertMetricPoints, listStoredMetricPoints } from "../src/projection/metric-store.ts";
import { currentQueryProjectionLocation, openQueryProjectionDatabase } from "../src/projection/schema.ts";
import { insertWearableSummaryRows, readWearableSummaryRows } from "../src/projection/wearable-summary-store.ts";
import { listCanonicalSourceManifest } from "../src/vault-source.ts";

function metricPoint(index: number, biomarkerKey: string | null): MetricPoint {
  return {
    id: `metric-point:synthetic:${index}`, schemaVersion: "murph.metric-point.v1",
    metricKey: biomarkerKey ? "apob" : "steps", biomarkerKey,
    value: index, canonicalValue: index, unit: "count", canonicalUnit: "count",
    textValue: null, comparator: null, observedAt: "2026-09-01T12:00:00Z",
    effectiveDate: "2026-09-01", recordedAt: null, reportedAt: null,
    grain: "day", statistic: "value", confidence: "high", context: {},
    source: { family: "event", kind: "observation", recordId: `evt_synthetic_${index}`,
      resultIndex: null, path: "ledger/events/2026/2026-09.jsonl" },
    provenance: { dataOrigin: null, externalRef: null, labName: null,
      provider: null, rawRefs: [], sourceLabel: null },
  };
}

test("sparse biomarker index preserves filtered and unfiltered metric reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-index-"));
  const location = currentQueryProjectionLocation(root);
  try {
    const points = Array.from({ length: 1000 }, (_, index) => metricPoint(index, null));
    points.push(metricPoint(1000, "biomarker:apob"));
    const database = openQueryProjectionDatabase(location);
    try {
      withImmediateTransaction(database, () => insertMetricPoints(database, points));
      const indexed = database.prepare(`
        SELECT count(*) AS count FROM query_metric_points
        INDEXED BY query_metric_points_biomarker_latest_idx
        WHERE biomarker_key IS NOT NULL
      `).get();
      assert.equal(indexed?.count, 1);
      const plan = database.prepare(`
        EXPLAIN QUERY PLAN SELECT id FROM query_metric_points
        WHERE biomarker_key = ? ORDER BY effective_date DESC, observed_at DESC, id ASC LIMIT 10
      `).all("biomarker:apob");
      assert.ok(plan.some(row => String(row.detail).includes("query_metric_points_biomarker_latest_idx")));
    } finally {
      database.close();
    }
    assert.deepEqual(listStoredMetricPoints(location, { biomarkerKey: "biomarker:apob" }), [points[1000]]);
    assert.equal(listStoredMetricPoints(location, { metricKey: "steps", limit: null }).length, 1000);
    assert.equal(listStoredMetricPoints(location, { limit: null }).length, 1001);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("query replacement clears retired payloads for compression and preserves rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-retired-"));
  const payload = Array.from({ length: 4096 }, (_, index) =>
    createHash("sha256").update(`synthetic-retired-${index}`).digest("hex")).join("");
  const summary = { id: "synthetic", providerScopeJson: "[]", providerScopeKey: "all",
    sortRank: 0, summaryDate: "2026-09-01", summaryJson: JSON.stringify({ payload }),
    summaryKind: "activity" as const };
  const compressedBytes: number[] = [];
  try {
    for (const clearRetired of [false, true]) {
      const location = currentQueryProjectionLocation(path.join(root, String(clearRetired)));
      const database = openQueryProjectionDatabase(location);
      try {
        // The control recreates the old connection behavior.
        if (!clearRetired) database.exec("PRAGMA secure_delete = OFF");
        insertWearableSummaryRows(database, [summary]);
        assert.throws(() => withImmediateTransaction(database, () => {
          database.exec("DELETE FROM query_wearable_summaries");
          throw new Error("synthetic publication failure");
        }), /synthetic publication failure/u);
        assert.equal(database.prepare("SELECT summary_json FROM query_wearable_summaries").get()?.summary_json,
          summary.summaryJson);
        withImmediateTransaction(database, () => {
          database.exec("DELETE FROM query_wearable_summaries");
          insertWearableSummaryRows(database, [{ ...summary, summaryJson: "{}" }]);
        });
      } finally {
        database.close();
      }
      assert.equal(readWearableSummaryRows(location).rows[0]?.summaryJson, "{}");
      const bytes = await readFile(location.absolutePath);
      assert.equal(bytes.includes(Buffer.from(payload.slice(4096, 4160))), !clearRetired);
      compressedBytes.push(deflateSync(bytes).byteLength);
    }
    assert.ok(compressedBytes[1]! < compressedBytes[0]! / 4,
      "retired high-entropy bytes should not inflate compressed snapshots");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v29 caches rebuild once and current SQLite bytes remain reusable after restore", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-storage-upgrade-"));
  try {
    await initializeVault({ vaultRoot: root });
    await addMeal({ vaultRoot: root, occurredAt: "2026-09-01T12:00:00Z", note: "Synthetic meal" });
    await rebuildQueryProjection(root);
    const before = await listCanonicalEntitiesRuntime(root);
    const location = currentQueryProjectionLocation(root);
    const database = openQueryProjectionDatabase(location);
    try {
      database.exec(`
        DROP INDEX query_metric_points_biomarker_latest_idx;
        CREATE INDEX query_metric_points_biomarker_latest_idx
          ON query_metric_points(biomarker_key, effective_date DESC, observed_at DESC);
        PRAGMA user_version = 29;
      `);
    } finally {
      database.close();
    }
    assert.equal((await getQueryProjectionStatus(root)).fresh, false);
    assert.deepEqual(await listCanonicalEntitiesRuntime(root), before);
    assert.equal((await getQueryProjectionStatus(root)).fresh, true);
    const current = openQueryProjectionDatabase(location, { readOnly: true });
    try {
      assert.equal(current.prepare("PRAGMA index_list(query_metric_points)").all()
        .find(row => row.name === "query_metric_points_biomarker_latest_idx")?.partial, 1);
    } finally {
      current.close();
    }
    const restored = currentQueryProjectionLocation(path.join(root, "restored"));
    await mkdir(path.dirname(restored.absolutePath), { recursive: true });
    await copyFile(location.absolutePath, restored.absolutePath);
    assert.equal((await readProjectionStatus(restored, await listCanonicalSourceManifest(root)))?.fresh, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
