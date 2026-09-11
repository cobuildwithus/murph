import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
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
const dbPath = path.join(vaultRoot, ".runtime/projections/query.sqlite");

function observation(index: number, version = originalVersion, corrected = false) {
  return {
    kind: "observation" as const,
    occurredAt: new Date(Date.UTC(2025, 0, 1) + index * 60_000).toISOString(),
    recordedAt: version,
    timeZone: "UTC",
    title: "Synthetic benchmark caffeine observation",
    externalRef: {
      system: "synthetic", resourceType: "metric", resourceId: `sample-${index}`, version,
    },
    fields: {
      metric: "caffeine", unit: "mg", value: corrected ? 500 + index : 45 + index % 200,
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
  const dbBytes = await fileBytes(dbPath);
  const walBytes = await fileBytes(`${dbPath}-wal`);
  const shmBytes = await fileBytes(`${dbPath}-shm`);
  if (dbBytes === 0) { emit(scenario, { dbBytes, walBytes, shmBytes, exists: false }); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const scalar = (sql: string) => Object.values(db.prepare(sql).get() ?? {})[0] ?? null;
    emit(scenario, {
      dbBytes, walBytes, shmBytes, exists: true,
      pageCount: scalar("PRAGMA page_count"), freeListCount: scalar("PRAGMA freelist_count"),
      pageSize: scalar("PRAGMA page_size"), userVersion: scalar("PRAGMA user_version"),
      entityRows: scalar("SELECT count(*) FROM query_entities"),
      metricRows: scalar("SELECT count(*) FROM query_metric_points"),
      sourceFiles: scalar("SELECT count(*) FROM query_source_manifest"),
      searchRows: scalar("SELECT count(*) FROM query_search_document"),
    });
  } finally { db.close(); }
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
    hash.update(JSON.stringify([event.occurredAt, "caffeine", "mg", event.fields.value]));
  }
  return hash.digest("hex");
}

async function verifyAll(count: number, corrected: boolean, scenario: string) {
  const points = await listMetricPoints(vaultRoot, { metricKey: "caffeine", limit: null });
  assert.equal(points.length, count);
  const hash = semanticHash(points);
  assert.equal(hash, expectedHash(count, corrected));
  emit(scenario, { rows: points.length, semanticSha256: hash, passed: true });
}

async function warmReads(scenario: string) {
  let expected: string | undefined;
  const before = await getQueryProjectionStatus(vaultRoot);
  assert.equal(before.fresh, true);
  // Forcing GC before each short query can consume the same CPU quota period
  // and manufacture a post-GC stall outside the operation being measured.
  for (let run = 0; run < warmRuns; run++) {
    const points = await measure(`${scenario}-${run}`, () => listMetricPoints(vaultRoot, {
      metricKey: "caffeine", limit: 50,
    }), { collectBefore: false });
    assert.equal(points.length, Math.min(50, seedCount + (scenario === "warm-after-edit" ? 12 : 0)));
    const hash = semanticHash(points);
    expected ??= hash;
    assert.equal(hash, expected);
    emit(`${scenario}-result-${run}`, { rows: points.length, semanticSha256: hash });
  }
  const after = await getQueryProjectionStatus(vaultRoot);
  assert.equal(after.fresh, true);
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
  emit("complete", { passed: true });
} finally {
  await rm(vaultRoot, { recursive: true, force: true });
}
