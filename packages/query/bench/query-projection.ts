import { readFreshQueryProjectionSections } from "../src/projection/freshness.ts";
import { currentQueryProjectionLocation, QUERY_PROJECTION_CERTIFICATE_KEY, QUERY_PROJECTION_SECTION_NAMES, queryProjectionSectionPath } from "../src/projection/schema.ts";
import { listCanonicalSourceManifest } from "../src/vault-source.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import { importDeviceBatch, initializeVault } from "@murphai/core";
import {
  getQueryProjectionStatus,
  listMetricPoints,
  rebuildQueryProjection,
  type MetricPoint,
} from "@murphai/query";

// Disposable synthetic fixture. Public write/query APIs exercise real ownership,
// validation, source invalidation, projection rebuild, and indexed reads.
const seedCount = Number(process.env.MURPH_QUERY_BENCH_EVENTS ?? 8_000);
const warmRuns = Number(process.env.MURPH_QUERY_BENCH_WARM_RUNS ?? 5);
const noteEvery = Number(process.env.MURPH_QUERY_BENCH_NOTE_EVERY ?? 10);
assert.ok(Number.isSafeInteger(seedCount) && seedCount >= 12 && seedCount <= 50_000);
assert.ok(Number.isSafeInteger(warmRuns) && warmRuns >= 1 && warmRuns <= 20);
assert.ok(Number.isSafeInteger(noteEvery) && noteEvery >= 1 && noteEvery <= 100);
const noteCount = Math.ceil(seedCount / noteEvery);
const originalVersion = "2026-01-01T00:00:00.000Z";
const correctedVersion = "2026-01-02T00:00:00.000Z";
const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-projection-bench-"));
const location = currentQueryProjectionLocation(vaultRoot);
const dbPath = queryProjectionSectionPath(location, "metrics");

function observation(index: number, version = originalVersion, corrected = false) {
  return {
    kind: "observation" as const,
    occurredAt: new Date(Date.UTC(2025, 0, 1) + index * 60_000).toISOString(),
    recordedAt: version,
    timeZone: "UTC",
    title: "Synthetic benchmark metric observation",
    externalRef: {
      system: "synthetic", resourceType: "metric", resourceId: `sample-${index}`, version,
    },
    fields: {
      // Interleave keys so rebuild order differs from the clustered table order.
      metric: index % 4 === 0 ? "caffeine" : `synthetic-metric-${index % 4}`,
      unit: "mg", value: corrected ? 500 + index : 45 + index % 200,
      observationGrain: "summary", qualifiers: { summary: true },
    },
  };
}

function emit(scenario: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ benchmark: "query-projection", scenario, seedCount, noteEvery, noteCount, ...fields }));
}

async function measure<T>(
  scenario: string,
  operation: () => Promise<T>,
  options: { collectBefore?: boolean } = {},
): Promise<T> {
  const forcedGcBeforeRun = options.collectBefore !== false && typeof globalThis.gc === "function";
  if (forcedGcBeforeRun) globalThis.gc?.();
  const start = performance.now();
  const cpu = process.cpuUsage();
  const result = await operation();
  const used = process.cpuUsage(cpu);
  emit(scenario, {
    wallMs: performance.now() - start, cpuMs: (used.user + used.system) / 1_000,
    rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed,
    maxRssKiB: process.resourceUsage().maxRSS, forcedGcBeforeRun,
  });
  return result;
}

async function fileBytes(filePath: string): Promise<number> {
  try { return (await stat(filePath)).size; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

async function databaseStats(scenario: string) {
  let totalDbBytes = 0;
  let totalZstdBytes = 0;
  for (const section of QUERY_PROJECTION_SECTION_NAMES) {
    const sectionPath = queryProjectionSectionPath(location, section);
    const dbBytes = await fileBytes(sectionPath);
    totalDbBytes += dbBytes;
    if (dbBytes === 0) { emit(scenario, { section, dbBytes, exists: false }); continue; }
    const db = new DatabaseSync(sectionPath, { readOnly: true });
    try {
      const scalar = (sql: string) => Object.values(db.prepare(sql).get() ?? {})[0] ?? null;
      const rows = (table: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table)
        ? scalar(`SELECT count(*) FROM ${table}`) : null;
      const certificate = db.prepare("SELECT value FROM query_meta WHERE key = ?").get(QUERY_PROJECTION_CERTIFICATE_KEY);
      const zstdBytes = compressedBytes(sectionPath);
      totalZstdBytes += zstdBytes;
      emit(scenario, {
        section, dbBytes, zstdBytes, exists: true,
        pageCount: scalar("PRAGMA page_count"), freeListCount: scalar("PRAGMA freelist_count"),
        pageSize: scalar("PRAGMA page_size"), userVersion: scalar("PRAGMA user_version"),
        entityRows: rows("query_entities"), metricRows: rows("query_metric_points"),
        wearableRows: rows("query_wearable_summaries"), searchRows: rows("query_search_document"),
        sourceFiles: certificate ? JSON.parse(String(certificate.value)).length : null,
      });
    } finally { db.close(); }
  }
  // Per-file compression is a layout diagnostic, not the full encrypted archive size.
  emit(scenario, { totalDbBytes, totalZstdBytes });
}

function compressedBytes(filePath: string): number {
  return execFileSync("zstd", ["-q", "-9", "--long=27", "-c", filePath], {
    maxBuffer: 128 * 1024 * 1024,
  }).byteLength;
}

async function compareSortedPacking() {
  const sortedPath = path.join(vaultRoot, "sorted-query-metrics.sqlite");
  await copyFile(dbPath, sortedPath);
  const database = new DatabaseSync(sortedPath);
  try {
    const orderedRows = () => JSON.stringify(database.prepare(`
      SELECT * FROM query_metric_points
      ORDER BY metric_key, effective_date DESC, observed_at DESC, id
    `).all());
    const before = orderedRows();
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TEMP TABLE metric_copy AS SELECT * FROM query_metric_points;
      DELETE FROM query_metric_points;
      INSERT INTO query_metric_points SELECT * FROM metric_copy
        ORDER BY metric_key, effective_date DESC, observed_at DESC, id;
      DROP TABLE metric_copy;
      COMMIT;
      VACUUM;
    `);
    assert.equal(orderedRows(), before);
  } finally { database.close(); }
  emit("sorted-packing", {
    dbBytes: await fileBytes(dbPath), sortedDbBytes: await fileBytes(sortedPath),
    zstdBytes: compressedBytes(dbPath), sortedZstdBytes: compressedBytes(sortedPath),
    rowsIdentical: true,
  });
  await rm(sortedPath);
}

function semanticHash(points: readonly MetricPoint[]): string {
  const hash = createHash("sha256");
  for (const point of [...points].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
    hash.update(JSON.stringify([point.observedAt, point.metricKey, point.unit, point.value]));
  }
  return hash.digest("hex");
}

function expectedHash(count: number, corrected: boolean): string {
  const hash = createHash("sha256");
  for (let index = 0; index < count; index++) {
    const event = observation(index, originalVersion, corrected && index < 12);
    hash.update(JSON.stringify([event.occurredAt, event.fields.metric, "mg", event.fields.value]));
  }
  return hash.digest("hex");
}

async function verifyAll(count: number, corrected: boolean, scenario: string) {
  const points = await listMetricPoints(vaultRoot, { limit: null });
  assert.equal(points.length, count);
  const hash = semanticHash(points);
  assert.equal(hash, expectedHash(count, corrected));
  emit(scenario, { rows: points.length, semanticSha256: hash, passed: true });
}

async function warmReads(scenario: string) {
  let expected: string | undefined;
  const before = await getQueryProjectionStatus(vaultRoot);
  assert.equal((await readFreshQueryProjectionSections(
    currentQueryProjectionLocation(vaultRoot), await listCanonicalSourceManifest(vaultRoot),
  )).has("metrics"), true);
  // Forcing GC before each short query can consume the same CPU quota period
  // and manufacture a post-GC stall outside the operation being measured.
  for (let run = 0; run < warmRuns; run++) {
    const points = await measure(`${scenario}-${run}`, () => listMetricPoints(vaultRoot, {
      metricKey: "caffeine", limit: 50,
    }), { collectBefore: false });
    assert.equal(points.length, Math.min(50, Math.ceil((seedCount + (scenario === "warm-after-edit" ? 12 : 0)) / 4)));
    const hash = semanticHash(points);
    expected ??= hash;
    assert.equal(hash, expected);
    emit(`${scenario}-result-${run}`, { rows: points.length, semanticSha256: hash });
  }
  const after = await getQueryProjectionStatus(vaultRoot);
  assert.equal((await readFreshQueryProjectionSections(
    currentQueryProjectionLocation(vaultRoot), await listCanonicalSourceManifest(vaultRoot),
  )).has("metrics"), true);
  assert.deepEqual(after, before);
  assert.equal(after.builtAt, before.builtAt);
}

try {
  await initializeVault({ vaultRoot, createdAt: originalVersion });
  await measure("seed-import", async () => {
    // Respect the public ingest boundary; accumulated history can be larger
    // than an individual provider batch without weakening runtime limits.
    for (let offset = 0; offset < seedCount; offset += 8_000) {
      const batchCount = Math.min(8_000, seedCount - offset);
      const result = await importDeviceBatch({
        vaultRoot, provider: "synthetic", importedAt: originalVersion,
        events: Array.from({ length: batchCount }, (_, index) => observation(offset + index)),
      });
      assert.equal(result.events.length, batchCount);
    }
    // Device observations intentionally cannot override query visibility. Add
    // real note imports to exercise entity/search storage through the same
    // public boundary instead of bypassing that invariant.
    for (let offset = 0; offset < noteCount; offset += 8_000) {
      const batchCount = Math.min(8_000, noteCount - offset);
      const result = await importDeviceBatch({
        vaultRoot, provider: "synthetic", importedAt: originalVersion,
        events: Array.from({ length: batchCount }, (_, index) => ({
          kind: "note", occurredAt: observation((offset + index) * noteEvery).occurredAt,
          recordedAt: originalVersion, timeZone: "UTC",
          title: "Synthetic benchmark canonical note",
          note: "Synthetic benchmark canonical note with searchable body. ".repeat(8),
          externalRef: {
            system: "synthetic", resourceType: "note", resourceId: `note-${offset + index}`,
            version: originalVersion,
          },
        })),
      });
      assert.equal(result.events.length, batchCount);
    }
  });
  await databaseStats("before-first-rebuild");
  const rebuilt = await measure("cold-full-rebuild", () => rebuildQueryProjection(vaultRoot));
  assert.equal(rebuilt.fresh, true);
  assert.ok(rebuilt.entityCount >= noteCount);
  assert.ok(rebuilt.searchDocumentCount >= noteCount);
  await databaseStats("after-first-rebuild");
  await verifyAll(seedCount, false, "cold-correctness");
  await warmReads("warm-cache");

  await measure("append-twelve-import", async () => {
    const result = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: originalVersion,
      events: Array.from({ length: 12 }, (_, index) => observation(seedCount + index)),
    });
    assert.equal(result.events.length, 12);
  });
  assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, false);
  await databaseStats("before-append-invalidation");
  await measure("append-invalidated-query", () => listMetricPoints(vaultRoot, { metricKey: "caffeine", limit: 50 }));
  await databaseStats("after-append-invalidation");
  await verifyAll(seedCount + 12, false, "append-correctness");

  await measure("correct-twelve-import", async () => {
    const result = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: correctedVersion,
      events: Array.from({ length: 12 }, (_, index) => observation(index, correctedVersion, true)),
    });
    assert.equal(result.events.length, 12);
    assert.ok(result.events.every((event) => event.lifecycle?.revision === 2));
  });
  assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, false);
  await databaseStats("before-correction-invalidation");
  await measure("correction-invalidated-query", () => listMetricPoints(vaultRoot, { metricKey: "caffeine", limit: 50 }));
  await databaseStats("after-correction-invalidation");
  await verifyAll(seedCount + 12, true, "correction-correctness");
  await warmReads("warm-after-edit");
  await compareSortedPacking();
  emit("complete", { passed: true });
} finally {
  await rm(vaultRoot, { recursive: true, force: true });
}
