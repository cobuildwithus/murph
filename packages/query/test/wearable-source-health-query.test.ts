import { createWearableSummaryEncoder } from "../src/projection/wearable-summary-shapes.ts";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test, vi } from "vitest";
import * as core from "@murphai/core";
import { withImmediateTransaction } from "@murphai/runtime-state/node";
import * as freshness from "../src/projection/freshness.ts";
import * as shapeStore from "../src/projection/wearable-summary-shapes.ts";
import * as ordinaryRuntime from "../src/query-projection.ts";
import * as wearables from "../src/wearables.ts";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { CANONICAL_WRITE_LOCK_DIRECTORY, withCanonicalWriteLock } from "@murphai/core";
import {
  getQueryProjectionStatus,
  listCanonicalEntitiesRuntime,
  rebuildQueryProjection,
  searchVaultRuntime,
  summarizeWearableSourceHealthRuntime,
} from "../src/query-projection.ts";
import { summarizeWearableSourceHealthFromBundle, type WearableSummaryFilters } from "../src/wearables.ts";
import { readVaultSourceStrict } from "../src/vault-source.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import {
  currentQueryProjectionLocation,
  hasCurrentQueryProjectionSchema,
  hasQueryProjectionTables,
  QUERY_PROJECTION_SQLITE_VERSION,
} from "../src/projection/schema.ts";
import { isWearableProjectionFresh } from "../src/projection/freshness.ts";
import * as rebuild from "../src/projection/rebuild.ts";
import * as metrics from "../src/metrics/projection.ts";
import * as search from "../src/search-shared.ts";
import * as metricStore from "../src/projection/metric-store.ts";
import * as entityStore from "../src/projection/entity-store.ts";
import * as searchStore from "../src/projection/search-store.ts";
import * as wearableStore from "../src/projection/wearable-summary-store.ts";
import * as projector from "../src/projection/wearable-summary-projector.ts";
import * as codec from "../src/projection/wearable-summary-stored-codec.ts";
import * as publicJson from "../src/projection/wearable-summary-public-json.ts";
import * as source from "../src/vault-source.ts";
import * as candidates from "../src/wearables/candidates.ts";
import * as schema from "../src/projection/schema.ts";
import { normalizeCliTiming, type CliTiming, type CliTimingPhase } from "@murphai/runtime-state/cli-timing";
import { timeCliDispatch, withCliTiming } from "@murphai/runtime-state/node/cli-timing";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function observation(id: string, provider: string | undefined, date: string, metric: string, value: number, unit: string) {
  return {
    schemaVersion: "murph.event.v1", id, kind: "observation", dayKey: date,
    occurredAt: `${date}T07:00:00Z`, recordedAt: `${date}T08:00:00Z`,
    source: "device", title: "Synthetic private title", metric, value, unit,
    externalRef: { system: provider, resourceType: "daily", resourceId: id },
    rawRefs: ["raw/private-fixture.json"], lifecycle: { revision: 1 },
  };
}

async function fixture(empty = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wearable-source-query-"));
  roots.push(root);
  const shard = path.join(root, "ledger/events/2026/2026-05.jsonl");
  await mkdir(path.dirname(shard), { recursive: true });
  await writeFile(path.join(root, "vault.json"), JSON.stringify({
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    createdAt: "2026-01-01T00:00:00Z", title: "Synthetic source health", timezone: "UTC",
  }));
  const events = empty ? [] : [
    observation("evt_garmin_steps", "garmin", "2026-05-01", "steps", 8000, "count"),
    observation("evt_garmin_weight", "garmin", "2026-05-01", "weightKg", 75, "kg"),
    observation("evt_garmin_hrv", "garmin", "2026-05-01", "hrv", 50, "ms"),
    observation("evt_garmin_sleep", "garmin", "2026-05-02", "totalSleepMinutes", 450, "minutes"),
    observation("evt_oura_steps", "oura", "2026-05-01", "steps", 7100, "count"),
    observation("evt_oura_sleep", "oura", "2026-05-04", "totalSleepMinutes", 480, "minutes"),
    observation("evt_unknown_steps", undefined, "2026-05-03", "steps", 3200, "count"),
    observation("evt_future_steps", "future_ring", "2026-05-03", "steps", 4000, "count"),
  ];
  await writeFile(shard, events.map(event => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""));
  return { root, shard, events };
}

// Reference is the existing full stored projection, not a copy of health logic.
function storedOracle(root: string, filters: WearableSummaryFilters) {
  const rows = wearableStore.readWearableSummaryRows(currentQueryProjectionLocation(root), { providers: filters.providers });
  return summarizeWearableSourceHealthFromBundle(
    composePublicWearableSummaryBundleFromStoredRows(rows, filters), filters,
  );
}

const filterCases: WearableSummaryFilters[] = [
  {}, { providers: [] }, { providers: ["", "  "] }, { providers: ["missing"] },
  { providers: ["garmin"] }, { providers: ["oura", "garmin"] },
  { providers: [" GARMIN ", "garmin", "missing"] },
  { providers: ["unknown"] }, { providers: ["future_ring"] },
  { date: "2026-05-01" }, { date: "2026-05-03", providers: ["oura", "garmin"] },
  { from: "2026-05-02", to: "2026-05-04" },
  { from: "2026-05-02", to: "2026-05-02", providers: ["garmin"] },
  { from: "2026-05-04", to: "2026-05-01" }, { date: "2030-01-01" },
  { limit: 1 }, { limit: 0 }, { limit: -1 }, { limit: 1.5 },
];

const globalTables = [
  "query_entities", "query_metric_points", "query_metric_payloads", "query_metric_targets",
  "query_source_manifest", "query_search_document", "query_search_fts",
] as const;

function inspectProjection(root: string) {
  const database = new DatabaseSync(currentQueryProjectionLocation(root).absolutePath, { readOnly: true });
  try {
    const existingGlobalTables = globalTables.filter(table =>
      database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    return {
      globalTables: existingGlobalTables,
      currentSchema: hasCurrentQueryProjectionSchema(database),
      global: globalTables.map(table => existingGlobalTables.includes(table)
        ? database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all() : []),
      globalMeta: database.prepare("SELECT * FROM query_meta WHERE key != 'wearable_source_manifest' ORDER BY key").all(),
      wearableMeta: database.prepare("SELECT value FROM query_meta WHERE key = 'wearable_source_manifest'").get()?.value,
      wearable: database.prepare("SELECT * FROM query_wearable_summaries ORDER BY id").all(),
      shapes: database.prepare("SELECT * FROM query_wearable_summary_shapes ORDER BY shape_id").all(),
    };
  } finally {
    database.close();
  }
}

function executeSql(root: string, sql: string) {
  const database = new DatabaseSync(currentQueryProjectionLocation(root).absolutePath);
  try { database.exec(sql); } finally { database.close(); }
}

async function assertWearablesFresh(root: string) {
  assert.equal(await isWearableProjectionFresh(
    currentQueryProjectionLocation(root), await source.listCanonicalSourceManifest(root),
  ), true);
}

async function forceFullReference(root: string) {
  // Force independent full materialization rather than reusing the candidate's
  // partial publication. The oracle still uses ordinary stored composition.
  executeSql(root, "DELETE FROM query_meta WHERE key = 'wearable_source_manifest'");
  await rebuildQueryProjection(root);
}

for (const empty of [false, true]) {
  test(`partial, repeated, full and invalidated reads equal the full stored oracle (empty=${empty})`, async () => {
    const { root, shard, events } = await fixture(empty);
    const cold = await Promise.all(filterCases.map(filters => summarizeWearableSourceHealthRuntime(root, filters)));
    const initial = inspectProjection(root);
    assert.equal(initial.currentSchema, true);
    assert.deepEqual(initial.globalTables, []);
    assert.deepEqual(initial.global, globalTables.map(() => []));
    assert.equal((await getQueryProjectionStatus(root)).fresh, false);
    assert.equal((await getQueryProjectionStatus(root)).builtAt, null);
    await assertWearablesFresh(root);
    await forceFullReference(root);
    for (const [index, filters] of filterCases.entries()) {
      const expected = storedOracle(root, filters);
      assert.deepEqual(cold[index], expected, JSON.stringify(filters));
      assert.deepEqual(await summarizeWearableSourceHealthRuntime(root, filters), expected);
    }
    for (const revision of [2, 3]) {
      await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify({
        ...(events[0] ?? observation("evt_new_source", "garmin", "2026-05-05", "steps", 9000, "count")),
        value: 9500, recordedAt: `2026-05-0${5 + revision}T09:00:00Z`,
        lifecycle: { revision: empty ? revision - 1 : revision, ...(revision === 3 ? { state: "deleted" } : {}) },
      }) + "\n"));
      const before = inspectProjection(root);
      assert.equal((await getQueryProjectionStatus(root)).fresh, false);
      const afterWrite = await Promise.all(filterCases.map(filters => summarizeWearableSourceHealthRuntime(root, filters)));
      const after = inspectProjection(root);
      assert.deepEqual(after.global, before.global);
      assert.deepEqual(after.globalMeta, before.globalMeta);
      assert.notEqual(after.wearableMeta, before.wearableMeta);
      assert.equal((await getQueryProjectionStatus(root)).fresh, false);
      await assertWearablesFresh(root);
      await forceFullReference(root);
      for (const [index, filters] of filterCases.entries()) {
        assert.deepEqual(afterWrite[index], storedOracle(root, filters), `revision ${revision}: ${JSON.stringify(filters)}`);
      }
    }
  });
}

test("source-only reads publish wearables once per manifest and never invoke global work", async () => {
  const { root, shard } = await fixture();
  const forbidden = [
    vi.spyOn(rebuild, "rebuildQueryProjectionFromCanonicalSource"),
    vi.spyOn(metrics, "buildMetricProjection"),
    vi.spyOn(search, "materializeSearchDocuments"),
    vi.spyOn(search, "materializeSampleSummarySearchDocuments"),
    vi.spyOn(metricStore, "insertMetricPoints"),
    vi.spyOn(metricStore, "extractMetricTargetsFromCanonicalEntities"),
    vi.spyOn(entityStore, "insertQueryEntities"),
    vi.spyOn(searchStore, "insertSearchDocuments"),
  ];
  const projected = vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset");
  const inserted = vi.spyOn(wearableStore, "insertWearableSummaryRows");
  const encoded = vi.spyOn(codec, "stringifyStoredWearableProjectionSummary");
  const strict = vi.spyOn(source, "readVaultSourceStrict");
  const manifest = vi.spyOn(source, "listCanonicalSourceManifest");
  const publicProjection = vi.spyOn(publicJson, "projectPublicWearableSummaryBundle");
  // Even a first request for an absent provider must publish the complete
  // wearable portion, not a filtered subset falsely certified for everyone.
  assert.deepEqual(await summarizeWearableSourceHealthRuntime(root, { providers: ["missing"] }), []);
  assert.equal(manifest.mock.calls.length, 1, "one manifest accompanies one canonical snapshot");
  const first = await summarizeWearableSourceHealthRuntime(root);
  assert.ok(first.length > 0);
  for (let generation = 1; generation <= 4; generation += 1) {
    const encodingCalls = encoded.mock.calls.length;
    const before = inspectProjection(root);
    assert.ok(encodingCalls > 0);
    publicProjection.mockClear();
    for (let repeat = 0; repeat < 3; repeat += 1) {
      assert.deepEqual(await summarizeWearableSourceHealthRuntime(root), first);
    }
    assert.deepEqual(inspectProjection(root), before, "reuse must not republish rows or metadata");
    assert.equal(projected.mock.calls.length, generation);
    assert.equal(inserted.mock.calls.length, generation);
    assert.equal(strict.mock.calls.length, generation);
    assert.equal(encoded.mock.calls.length, encodingCalls);
    assert.ok(publicProjection.mock.calls.length > 0);
    for (const [bundle] of publicProjection.mock.calls) {
      assert.deepEqual([bundle.activityDays, bundle.bodyStateDays, bundle.recoveryDays, bundle.sleepNights], [[], [], [], []]);
    }
    if (generation < 4) {
      await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify({
        schemaVersion: "murph.event.v1", id: `evt_unrelated_${generation}`, kind: "note", source: "manual",
        title: "Synthetic unrelated note", occurredAt: "2026-05-05T12:00:00Z", recordedAt: "2026-05-05T12:00:00Z",
      }) + "\n"));
      assert.deepEqual(await summarizeWearableSourceHealthRuntime(root), first);
    }
  }
  for (const spy of forbidden) assert.equal(spy.mock.calls.length, 0);
  assert.deepEqual(inspectProjection(root).global, globalTables.map(() => []));
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
});

for (const order of ["source-global", "global-source"] as const) {
  test(`${order} derives and encodes provider rows once, including after canonical writes`, async () => {
    const { root, shard } = await fixture();
    const projected = vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset");
    const inserted = vi.spyOn(wearableStore, "insertWearableSummaryRows");
    const metricProjection = vi.spyOn(metrics, "buildMetricProjection");
    const encoded = vi.spyOn(codec, "stringifyStoredWearableProjectionSummary");
    for (let generation = 1; generation <= 3; generation += 1) {
      if (generation > 1) {
        await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify(generation === 2
          ? { schemaVersion: "murph.event.v1", id: "evt_unrelated", kind: "note", source: "manual", title: "Synthetic note", occurredAt: "2026-05-05T12:00:00Z", recordedAt: "2026-05-05T12:00:00Z" }
          : observation("evt_later_sleep", "oura", "2026-05-08", "totalSleepMinutes", 510, "minutes")) + "\n"));
      }
      if (order === "source-global") {
        await summarizeWearableSourceHealthRuntime(root);
        const before = inspectProjection(root);
        const encodingCalls = encoded.mock.calls.length;
        assert.equal((await getQueryProjectionStatus(root)).fresh, false);
        await listCanonicalEntitiesRuntime(root);
        assert.deepEqual(inspectProjection(root).wearable, before.wearable);
        assert.equal(inspectProjection(root).wearableMeta, before.wearableMeta);
        assert.equal(encoded.mock.calls.length, encodingCalls);
      } else {
        await listCanonicalEntitiesRuntime(root);
        const before = inspectProjection(root);
        await summarizeWearableSourceHealthRuntime(root);
        assert.deepEqual(inspectProjection(root), before);
      }
      assert.equal((await getQueryProjectionStatus(root)).fresh, true);
      assert.equal(projected.mock.calls.length, generation);
      assert.equal(inserted.mock.calls.length, generation);
      assert.equal(metricProjection.mock.calls.length, generation);
      assert.deepEqual(await summarizeWearableSourceHealthRuntime(root), storedOracle(root, {}));
    }
  });
}

test("malformed canonical input preserves the strict error and never serves stale rows", async () => {
  const { root, shard } = await fixture();
  await rebuildQueryProjection(root);
  const databasePath = currentQueryProjectionLocation(root).absolutePath;
  const before = await readFile(databasePath);
  await withCanonicalWriteLock(root, () => appendFile(shard, "{malformed canonical record\n"));
  const expected = await readVaultSourceStrict(root).then(() => null, (error: unknown) => error);
  assert.ok(expected instanceof Error);
  for (const filters of [{}, { providers: [] }, { providers: ["missing"] }]) {
    await assert.rejects(summarizeWearableSourceHealthRuntime(root, filters), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.constructor, expected.constructor);
      assert.equal(error.message, expected.message);
      return true;
    });
  }
  assert.deepEqual(await readFile(databasePath), before);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
});

test("derivation and publication retain the canonical lock through exact row capture", async () => {
  const { root } = await fixture();
  const originalProject = projector.buildWearableSummaryProjectionFromDataset;
  vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset").mockImplementation((...args: Parameters<typeof originalProject>) => {
    assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), true);
    return originalProject(...args);
  });
  const originalInsert = wearableStore.insertWearableSummaryRows;
  const insert = vi.spyOn(wearableStore, "insertWearableSummaryRows").mockImplementation((...args: Parameters<typeof originalInsert>) => {
    assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), true);
    return originalInsert(...args);
  });
  const originalRead = wearableStore.readWearableSummaryRows;
  const read = vi.spyOn(wearableStore, "readWearableSummaryRows").mockImplementation((...args: Parameters<typeof originalRead>) => {
    assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), true);
    return originalRead(...args);
  });
  await Promise.all(Array.from({ length: 4 }, () => summarizeWearableSourceHealthRuntime(root)));
  assert.equal(insert.mock.calls.length, 1);
  assert.equal(read.mock.calls.length, 4);
});

for (const state of ["legacy", "future", "unreadable", "missing-metadata", "corrupt-metadata"] as const) {
  test(`source health repairs ${state} derived state without certifying stale global work`, async () => {
    const { root, shard } = await fixture();
    await rebuildQueryProjection(root);
    const expected = storedOracle(root, {});
    const canonicalBefore = await readFile(shard);
    const databasePath = currentQueryProjectionLocation(root).absolutePath;
    if (state === "legacy" || state === "future") {
      executeSql(root, `PRAGMA user_version = ${QUERY_PROJECTION_SQLITE_VERSION + (state === "legacy" ? -1 : 1)}`);
    } else if (state === "unreadable") {
      await writeFile(databasePath, "synthetic unreadable index");
    } else if (state === "missing-metadata") {
      executeSql(root, "DELETE FROM query_meta WHERE key = 'wearable_source_manifest'");
    } else {
      executeSql(root, "UPDATE query_meta SET value = '{bad manifest' WHERE key = 'wearable_source_manifest'");
    }
    assert.equal((await getQueryProjectionStatus(root)).fresh, false);
    const projected = vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset");
    assert.deepEqual(await summarizeWearableSourceHealthRuntime(root), expected);
    assert.equal(projected.mock.calls.length, 1);
    await assertWearablesFresh(root);
    if (["legacy", "future", "unreadable"].includes(state)) {
      assert.deepEqual(inspectProjection(root).global, globalTables.map(() => []));
      assert.equal((await getQueryProjectionStatus(root)).fresh, false);
    } else {
      // Only the wearable certificate was corrupt; the unchanged global
      // manifest still truthfully certifies its previously completed rows.
      assert.equal((await getQueryProjectionStatus(root)).fresh, true);
    }
    await listCanonicalEntitiesRuntime(root);
    assert.equal((await getQueryProjectionStatus(root)).fresh, true);
    assert.equal(projected.mock.calls.length, 1, "global repair reuses the new wearable generation");
    assert.deepEqual(await readFile(shard), canonicalBefore);
  });
}

test("an in-flight older global reader fails closed on a partial store after a version reset", async () => {
  const { root, shard } = await fixture();
  await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify({
    schemaVersion: "murph.event.v1", id: "evt_version_reset_note", kind: "note", source: "manual",
    title: "Synthetic version reset note", occurredAt: "2026-05-05T12:00:00Z", recordedAt: "2026-05-05T12:00:00Z",
  }) + "\n"));
  await rebuildQueryProjection(root);
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  const initialEntities = entityStore.readStoredVaultSource(currentQueryProjectionLocation(root)).entities;
  assert.match(JSON.stringify(initialEntities), /"id":"evt_version_reset_note"/u);
  // Model a version-27 reader which checked freshness before the new owner
  // reset its store. Its unchanged required-global-tables guard must reject the
  // partial replacement even though that reader will not recheck user_version.
  executeSql(root, "PRAGMA user_version = 27");
  await summarizeWearableSourceHealthRuntime(root);
  const location = currentQueryProjectionLocation(root);
  const database = new DatabaseSync(location.absolutePath, { readOnly: true });
  try {
    assert.equal(hasCurrentQueryProjectionSchema(database), true);
    assert.equal(hasQueryProjectionTables(database), false);
  } finally { database.close(); }
  assert.throws(() => entityStore.readStoredVaultSource(location), /missing required tables/u);
  assert.deepEqual(inspectProjection(root).globalTables, []);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  await listCanonicalEntitiesRuntime(root);
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  assert.deepEqual(entityStore.readStoredVaultSource(location).entities, initialEntities);
});

test("a matching empty manifest and a reused builtAt cannot certify unfinished global tables", async () => {
  const { root, shard } = await fixture(true);
  await rm(path.join(root, "vault.json"));
  await rm(shard);
  assert.deepEqual(await source.listCanonicalSourceManifest(root), []);
  assert.deepEqual(await summarizeWearableSourceHealthRuntime(root), []);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  await listCanonicalEntitiesRuntime(root);
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  executeSql(root, "UPDATE query_meta SET value = '2026-01-01T00:00:00.000Z' WHERE key = 'built_at'");
  await withCanonicalWriteLock(root, () => writeFile(shard, JSON.stringify(
    observation("evt_first", "garmin", "2026-05-01", "steps", 8000, "count"),
  ) + "\n"));
  const before = inspectProjection(root);
  await summarizeWearableSourceHealthRuntime(root);
  assert.deepEqual(inspectProjection(root).globalMeta, before.globalMeta);
  assert.notEqual(inspectProjection(root).wearableMeta, before.wearableMeta);
  assert.equal((await getQueryProjectionStatus(root)).builtAt, "2026-01-01T00:00:00.000Z");
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
});

test("failed wearable metadata publication rolls back rows and metadata and remains retryable", async () => {
  const { root, shard } = await fixture();
  await rebuildQueryProjection(root);
  await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify(
    observation("evt_new_sleep", "oura", "2026-05-09", "totalSleepMinutes", 490, "minutes"),
  ) + "\n"));
  const before = inspectProjection(root);
  executeSql(root, `CREATE TRIGGER fail_wearable_metadata BEFORE UPDATE ON query_meta
    WHEN NEW.key = 'wearable_source_manifest' BEGIN
      SELECT RAISE(ABORT, 'injected wearable publication failure');
    END;`);
  let report!: CliTiming;
  await assert.rejects(measuredQuery("wearables sources list", () => summarizeWearableSourceHealthRuntime(root), value => { report = value; }), /injected wearable publication failure/u);
  assertRebuildTiming(report, sourceRebuildPhases, root);
  assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), false);
  assert.deepEqual(inspectProjection(root), before);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  executeSql(root, "DROP TRIGGER fail_wearable_metadata");
  const actual = await summarizeWearableSourceHealthRuntime(root);
  await assertWearablesFresh(root);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  await forceFullReference(root);
  assert.deepEqual(actual, storedOracle(root, {}));
});

test("failed encoding leaves the existing projection unchanged and releases the lock", async () => {
  const { root, shard } = await fixture();
  await summarizeWearableSourceHealthRuntime(root);
  await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify(
    observation("evt_new", "garmin", "2026-05-09", "steps", 9000, "count"),
  ) + "\n"));
  const before = inspectProjection(root);
  const failure = new Error("injected stored encoding failure");
  const encode = vi.spyOn(codec, "stringifyStoredWearableProjectionSummary").mockImplementation(() => { throw failure; });
  let report!: CliTiming;
  await assert.rejects(measuredQuery("wearables sources list", () => summarizeWearableSourceHealthRuntime(root), value => { report = value; }), error => error === failure);
  assertRebuildTiming(report, ["query-source-read", "query-wearable-dataset", "query-wearable-summary"], root);
  assert.deepEqual(inspectProjection(root), before);
  assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), false);
  encode.mockRestore();
  await summarizeWearableSourceHealthRuntime(root);
  await assertWearablesFresh(root);
});

test("failed global publication preserves the independently current wearable portion", async () => {
  const { root } = await fixture();
  const expected = await summarizeWearableSourceHealthRuntime(root);
  const before = inspectProjection(root);
  const projected = vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset");
  const failure = new Error("injected global publication failure");
  const insert = vi.spyOn(searchStore, "insertSearchDocuments").mockImplementation(() => { throw failure; });
  let report!: CliTiming;
  await assert.rejects(measuredQuery("event list", () => listCanonicalEntitiesRuntime(root), value => { report = value; }), error => error === failure);
  assertRebuildTiming(report, rebuildPhases.filter(phase => phase !== "query-wearable-summary"), root);
  assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), false);
  assert.deepEqual(inspectProjection(root), before);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  assert.deepEqual(await summarizeWearableSourceHealthRuntime(root), expected);
  insert.mockRestore();
  await listCanonicalEntitiesRuntime(root);
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  assert.equal(projected.mock.calls.length, 0);
});

test("corrupt stored activity evidence fails closed rather than falling back to raw health", async () => {
  const { root } = await fixture();
  await summarizeWearableSourceHealthRuntime(root);
  const database = new DatabaseSync(currentQueryProjectionLocation(root).absolutePath);
  try {
    database.prepare("UPDATE query_wearable_summaries SET summary_json = ? WHERE summary_kind = 'activity'")
      .run(createWearableSummaryEncoder(database)("{}"));
  } finally {
    database.close();
  }
  await assert.rejects(summarizeWearableSourceHealthRuntime(root), /activity evidence/iu);
});

// Exercise the public query APIs on the same synthetic canonical fixture used
// above, not a test-only reconstruction of the rebuild pipeline.
const rebuildPhases = [
  "query-source-read", "query-wearable-dataset", "query-metric-projection",
  "query-wearable-summary", "query-search-documents", "query-publication",
] as const;
const sourceRebuildPhases = rebuildPhases.filter(phase =>
  phase !== "query-metric-projection" && phase !== "query-search-documents");

async function measuredQuery<T>(command: string, read: () => Promise<T>, publish?: (report: CliTiming) => void): Promise<T> {
  let result!: T;
  await withCliTiming(() => timeCliDispatch(command, async () => { result = await read(); }), publish);
  return result;
}

function assertRebuildTiming(report: CliTiming, expected: readonly CliTimingPhase[], root: string) {
  assert.deepEqual(normalizeCliTiming(report), report);
  assert.equal(report.droppedSpans, 0);
  assert.equal(report.droppedCalls, 0);
  assert.equal(report.commands.length, 1);
  const command = report.commands[0]!;
  assert.equal(command.calls, 1);
  assert.deepEqual(command.phases.filter(phase => rebuildPhases.some(name => name === phase.phase))
    .map(phase => phase.phase), expected);
  for (const phase of command.phases) {
    assert.deepEqual(Object.keys(phase).sort(), ["buckets", "count", "maxUs", "phase", "sumUs"]);
    for (const value of [phase.count, phase.sumUs, phase.maxUs, ...phase.buckets]) {
      assert.ok(Number.isSafeInteger(value) && value >= 0);
    }
    assert.equal(phase.buckets.length, 8);
    assert.equal(phase.buckets.reduce((sum, value) => sum + value, 0), phase.count);
    if (expected.includes(phase.phase)) assert.equal(phase.count, 1);
  }
  const serialized = JSON.stringify(report);
  for (const forbidden of [root, "evt_garmin_steps", "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    "raw/private-fixture.json", "Synthetic private title", "Synthetic source health",
    "SYNTHETIC_QUERY_SENTINEL", "PRIVATE_TIMING_FAILURE", "providers", "entityCount", "searchDocumentCount"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
}

async function removeProjection(root: string) {
  const databasePath = currentQueryProjectionLocation(root).absolutePath;
  await Promise.all(["", "-wal", "-shm"].map(suffix => rm(databasePath + suffix, { force: true })));
}

test("full rebuild timing preserves canonical data, search output and freshness", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
  const { root, shard } = await fixture();
  const journal = path.join(root, "journal/2026/2026-05-01.md");
  await mkdir(path.dirname(journal), { recursive: true });
  await writeFile(journal, "---\ntitle: SYNTHETIC_QUERY_SENTINEL\n---\n\nSYNTHETIC_QUERY_SENTINEL\n");
  const canonical = await readFile(shard);
  const expected = await rebuildQueryProjection(root);
  const expectedSearch = await searchVaultRuntime(root, "SYNTHETIC_QUERY_SENTINEL");
  assert.ok(expectedSearch.total > 0);
  const expectedProjection = inspectProjection(root);
  await removeProjection(root);
  let report!: CliTiming;
  const actual = await measuredQuery("query projection rebuild", () => rebuildQueryProjection(root), value => { report = value; });
  assertRebuildTiming(report, rebuildPhases, root);
  assert.equal(report.commands[0]!.outcome, "ok");
  assert.deepEqual(actual, expected);
  assert.deepEqual(inspectProjection(root), expectedProjection);
  assert.deepEqual(await searchVaultRuntime(root, "SYNTHETIC_QUERY_SENTINEL"), expectedSearch);
  const before = await getQueryProjectionStatus(root);
  assert.equal(before.fresh, true);
  await measuredQuery("search query", () => searchVaultRuntime(root, "SYNTHETIC_QUERY_SENTINEL"), value => { report = value; });
  assertRebuildTiming(report, [], root);
  assert.deepEqual(await getQueryProjectionStatus(root), before);
  assert.deepEqual(await readFile(shard), canonical);
});

test("wearable-only timing omits global work and a later full rebuild omits reused summaries", async () => {
  const { root, shard } = await fixture();
  const canonical = await readFile(shard);
  const expected = await summarizeWearableSourceHealthRuntime(root);
  const expectedProjection = inspectProjection(root);
  await removeProjection(root);
  let report!: CliTiming;
  const actual = await measuredQuery("wearables sources list", () => summarizeWearableSourceHealthRuntime(root), value => { report = value; });
  assertRebuildTiming(report, sourceRebuildPhases, root);
  assert.deepEqual(actual, expected);
  assert.deepEqual(inspectProjection(root), expectedProjection);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  assert.deepEqual(inspectProjection(root).globalTables, []);
  await assertWearablesFresh(root);
  assert.deepEqual(await measuredQuery("wearables sources list", () => summarizeWearableSourceHealthRuntime(root), value => { report = value; }), expected);
  assertRebuildTiming(report, [], root);
  await measuredQuery("query projection rebuild", () => rebuildQueryProjection(root), value => { report = value; });
  assertRebuildTiming(report, rebuildPhases.filter(phase => phase !== "query-wearable-summary"), root);
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  assert.deepEqual(inspectProjection(root).wearable, expectedProjection.wearable);
  assert.deepEqual(await readFile(shard), canonical);
});

test("rebuild phase boundaries measure actual owners including publication open, inserts and close", async () => {
  const { root } = await fixture();
  let tick = 0n;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => tick);
  const advance = (us: number) => { tick += BigInt(us) * 1_000n; };
  const read = source.readVaultSourceStrict;
  vi.spyOn(source, "readVaultSourceStrict").mockImplementation(async (...args) => { advance(11); return read(...args); });
  const dataset = candidates.collectWearableDataset;
  vi.spyOn(candidates, "collectWearableDataset").mockImplementation((...args) => { advance(13); return dataset(...args); });
  const project = metrics.buildMetricProjection;
  vi.spyOn(metrics, "buildMetricProjection").mockImplementation((...args) => { advance(17); return project(...args); });
  const targets = metricStore.extractMetricTargetsFromCanonicalEntities;
  vi.spyOn(metricStore, "extractMetricTargetsFromCanonicalEntities").mockImplementation((...args) => { advance(19); return targets(...args); });
  const summary = projector.buildWearableSummaryProjectionFromDataset;
  vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset").mockImplementation((...args) => { advance(23); return summary(...args); });
  const documents = search.materializeSearchDocuments;
  vi.spyOn(search, "materializeSearchDocuments").mockImplementation((...args) => { advance(29); return documents(...args); });
  const summaries = search.materializeSampleSummarySearchDocuments;
  vi.spyOn(search, "materializeSampleSummarySearchDocuments").mockImplementation((...args) => { advance(31); return summaries(...args); });
  const open = schema.openQueryProjectionDatabase;
  vi.spyOn(schema, "openQueryProjectionDatabase").mockImplementation((location, options) => {
    if (options?.create) advance(37);
    const database = open(location, options);
    if (options?.create) {
      const close = database.close.bind(database);
      vi.spyOn(database, "close").mockImplementation(() => { advance(43); close(); });
    }
    return database;
  });
  const insert = entityStore.insertQueryEntities;
  vi.spyOn(entityStore, "insertQueryEntities").mockImplementation((...args) => { advance(41); return insert(...args); });
  let report!: CliTiming;
  await measuredQuery("query projection rebuild", () => rebuildQueryProjection(root), value => { report = value; });
  assertRebuildTiming(report, rebuildPhases, root);
  assert.deepEqual(Object.fromEntries(report.commands[0]!.phases.filter(phase =>
    rebuildPhases.some(name => name === phase.phase)).map(phase => [phase.phase, phase.sumUs])), {
    "query-source-read": 11, "query-wearable-dataset": 13, "query-metric-projection": 36,
    "query-wearable-summary": 23, "query-search-documents": 60, "query-publication": 121,
  });
});

for (const mode of ["full", "wearable-only"] as const) {
  for (const boundary of ["source", "open", "close"] as const) {
    test(`${mode} ${boundary} failure closes timing scopes and releases the canonical lock`, async () => {
      const { root } = await fixture();
      const failure = new Error("PRIVATE_TIMING_FAILURE");
      if (boundary === "source") vi.spyOn(source, "readVaultSourceStrict").mockRejectedValue(failure);
      else {
        const open = schema.openQueryProjectionDatabase;
        vi.spyOn(schema, "openQueryProjectionDatabase").mockImplementation((location, options) => {
          if (options?.create && boundary === "open") throw failure;
          const database = open(location, options);
          if (options?.create && boundary === "close") {
            const close = database.close.bind(database);
            vi.spyOn(database, "close").mockImplementation(() => { close(); throw failure; });
          }
          return database;
        });
      }
      const run = (): Promise<unknown> => mode === "full"
        ? rebuildQueryProjection(root) : summarizeWearableSourceHealthRuntime(root);
      let report!: CliTiming;
      await assert.rejects(measuredQuery(mode === "full" ? "query projection rebuild" : "wearables sources list",
        run, value => { report = value; }), error => error === failure);
      assertRebuildTiming(report, boundary === "source" ? ["query-source-read"] :
        mode === "full" ? rebuildPhases : sourceRebuildPhases, root);
      assert.equal(report.commands[0]!.outcome, "error");
      assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), false);
      vi.restoreAllMocks();
      // Closing failed after the actual close: the already-committed publication
      // remains committed, just as before instrumentation. Other failures retry.
      assert.equal(await isWearableProjectionFresh(currentQueryProjectionLocation(root),
        await source.listCanonicalSourceManifest(root)), boundary === "close");
      assert.equal((await getQueryProjectionStatus(root)).fresh, mode === "full" && boundary === "close");
      await run();
      await assertWearablesFresh(root);
    });
  }
}

// Opt-in local measurement: no endpoint, provider, private vault or new harness.
// Rotated cold pairs exercise both public operations; timings are observations,
// not a flaky CI latency threshold or evidence of production speedup.
test.skipIf(process.env.MURPH_QUERY_REBUILD_PHASE_MEASURE !== "1")("synthetic rebuild phase measurement", async () => {
  const priorEndpoint = process.env.MURPH_CLI_TIMING_ENDPOINT;
  delete process.env.MURPH_CLI_TIMING_ENDPOINT;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
  try {
    const { root } = await fixture();
    for (const mode of ["full", "wearable-only"] as const) {
      const samples = { disabled: [] as number[], enabled: [] as number[] };
      const run = (): Promise<unknown> => mode === "full"
        ? rebuildQueryProjection(root) : summarizeWearableSourceHealthRuntime(root);
      let expected: unknown;
      let report!: CliTiming;
      let maxEnvelopeBytes = 0;
      for (let round = -1; round < 7; round += 1) {
        for (const enabled of round % 2 === 0 ? [false, true] : [true, false]) {
          await removeProjection(root);
          const started = process.hrtime.bigint();
          const result = await measuredQuery(mode === "full" ? "query projection rebuild" : "wearables sources list", run,
            enabled ? value => { report = value; } : undefined);
          const us = Number((process.hrtime.bigint() - started) / 1_000n);
          expected ??= result;
          assert.deepEqual(result, expected);
          if (round >= 0) samples[enabled ? "enabled" : "disabled"].push(us);
          if (enabled) {
            assertRebuildTiming(report, mode === "full" ? rebuildPhases : sourceRebuildPhases, root);
            maxEnvelopeBytes = Math.max(maxEnvelopeBytes, Buffer.byteLength(JSON.stringify({
              key: "a".repeat(32), startedUs: Number.MAX_SAFE_INTEGER, endedUs: Number.MAX_SAFE_INTEGER, timing: report,
            })));
          }
        }
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
      assert.ok(maxEnvelopeBytes <= 8_192);
      console.log(JSON.stringify({ measurement: "synthetic-query-rebuild-phases", mode, pairs: 7,
        disabledSamplesUs: samples.disabled, enabledSamplesUs: samples.enabled,
        pairedDeltasUs: samples.enabled.map((us, index) => us - samples.disabled[index]!),
        disabledMedianUs: median(samples.disabled), enabledMedianUs: median(samples.enabled),
        observedDeltaUs: median(samples.enabled) - median(samples.disabled), maxEnvelopeBytes,
        phases: report.commands[0]!.phases,
        method: "Warm process, rotated cold-projection pairs, in-memory sink; bounded spans/bytes, no transport or production speedup claim." }));
    }
  } finally {
    if (priorEndpoint === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
    else process.env.MURPH_CLI_TIMING_ENDPOINT = priorEndpoint;
  }
});

// The old ordinary-read path composed these same stored rows after global
// freshness. Keep that oracle independent of the new focused helper.
interface OrdinaryWearableReader {
  name: string;
  read: (root: string, filters: wearables.WearableMetricSummaryFilters) => Promise<unknown>;
  select: (bundle: wearables.ProjectedWearableSummaryBundle, filters: wearables.WearableMetricSummaryFilters) => unknown;
}
const ordinaryWearableReaders: OrdinaryWearableReader[] = [
  { name: "day", read: (root, filters) => ordinaryRuntime.summarizeWearableDayRuntime(root, filters.date ?? "2026-05-01", { providers: filters.providers }),
    select: (bundle, filters) => wearables.summarizeWearableDayFromBundle(bundle, filters.date ?? "2026-05-01") },
  { name: "latest", read: ordinaryRuntime.summarizeWearableLatestRuntime, select: wearables.summarizeWearableLatestFromBundle },
  { name: "metric-latest", read: (root, filters) => ordinaryRuntime.summarizeWearableMetricLatestRuntime(root, "steps", filters),
    select: (bundle, filters) => wearables.summarizeWearableMetricLatestFromBundle(bundle, "steps", filters) },
  { name: "metric-trend", read: (root, filters) => ordinaryRuntime.summarizeWearableMetricTrendRuntime(root, "hrv", filters),
    select: (bundle, filters) => wearables.summarizeWearableMetricTrendFromBundle(bundle, "hrv", filters) },
  { name: "drift", read: ordinaryRuntime.explainWearableDriftRuntime, select: wearables.explainWearableDriftFromBundle },
  { name: "activity", read: ordinaryRuntime.summarizeWearableActivityRuntime, select: wearables.summarizeWearableActivityFromBundle },
  { name: "body", read: ordinaryRuntime.summarizeWearableBodyStateRuntime, select: wearables.summarizeWearableBodyStateFromBundle },
  { name: "recovery", read: ordinaryRuntime.summarizeWearableRecoveryRuntime, select: wearables.summarizeWearableRecoveryFromBundle },
];
function ordinaryStoredOracle(reader: OrdinaryWearableReader, root: string, filters: wearables.WearableMetricSummaryFilters) {
  const compositionFilters = reader.name === "day"
    ? { date: filters.date ?? "2026-05-01", providers: filters.providers } : filters;
  const rows = wearableStore.readWearableSummaryRows(currentQueryProjectionLocation(root), { providers: filters.providers });
  return reader.select(composePublicWearableSummaryBundleFromStoredRows(rows, compositionFilters), filters);
}

for (const reader of ordinaryWearableReaders) {
  for (const empty of [false, true]) {
    test(`${reader.name}: focused cold/repeated/fresh/global/correction/deletion equals independent full rows (empty=${empty})`, async () => {
      const { root, shard, events } = await fixture(empty);
      const cases: wearables.WearableMetricSummaryFilters[] = [...filterCases,
        { providers: ["garmin", "oura"] }, { from: "2026-05-01", to: "2026-05-04", windowDays: 3 }];
      let report!: CliTiming;
      const read = (filters: wearables.WearableMetricSummaryFilters) => measuredQuery(
        `wearables ${reader.name}`, () => reader.read(root, filters), value => { report = value; });
      const cold = [];
      for (const [index, filters] of cases.entries()) {
        cold.push(await read(filters));
        assertRebuildTiming(report, index === 0 ? sourceRebuildPhases : [], root);
      }
      assert.deepEqual(inspectProjection(root).globalTables, []);
      assert.equal((await getQueryProjectionStatus(root)).fresh, false);
      await assertWearablesFresh(root);
      // A real global operation must still do its work, without re-encoding
      // the focused generation. Then force an independent full-row oracle.
      await measuredQuery("query list", () => listCanonicalEntitiesRuntime(root), value => { report = value; });
      assertRebuildTiming(report, rebuildPhases.filter(phase => phase !== "query-wearable-summary"), root);
      assert.equal((await getQueryProjectionStatus(root)).fresh, true);
      await forceFullReference(root);
      const full = inspectProjection(root);
      for (const [index, filters] of cases.entries()) {
        const expected = JSON.stringify(ordinaryStoredOracle(reader, root, filters));
        assert.equal(JSON.stringify(cold[index]), expected);
        assert.equal(JSON.stringify(await read(filters)), expected);
        assertRebuildTiming(report, [], root);
      }
      assert.deepEqual(inspectProjection(root), full);
      for (const revision of empty ? [] : [2, 3]) {
        await withCanonicalWriteLock(root, () => appendFile(shard, events.map(event => JSON.stringify({
          ...event, value: event.value + 10, recordedAt: "2026-05-05T12:00:00Z",
          lifecycle: { revision, ...(revision === 3 ? { state: "deleted" } : {}) },
        })).join("\n") + "\n"));
        const before = inspectProjection(root);
        const actual = [];
        for (const [index, filters] of cases.entries()) {
          actual.push(await read(filters));
          assertRebuildTiming(report, index === 0 ? sourceRebuildPhases : [], root);
        }
        assert.deepEqual(inspectProjection(root).global, before.global);
        assert.deepEqual(inspectProjection(root).globalMeta, before.globalMeta);
        assert.equal((await getQueryProjectionStatus(root)).fresh, false);
        await measuredQuery("query list", () => listCanonicalEntitiesRuntime(root), value => { report = value; });
        assertRebuildTiming(report, rebuildPhases.filter(phase => phase !== "query-wearable-summary"), root);
        await forceFullReference(root);
        for (const [index, filters] of cases.entries()) {
          assert.equal(JSON.stringify(actual[index]), JSON.stringify(ordinaryStoredOracle(reader, root, filters)));
        }
      }
    });
  }

  test(`${reader.name}: focused capture holds the reentrant lock and failed publication rolls back`, async () => {
    const { root, shard, events } = await fixture();
    await summarizeWearableSourceHealthRuntime(root);
    const capture = wearableStore.readWearableSummaryRows;
    const captured = vi.spyOn(wearableStore, "readWearableSummaryRows").mockImplementation((...args) => {
      assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), true);
      return capture(...args);
    });
    await withCanonicalWriteLock(root, () => reader.read(root, {}));
    assert.equal(captured.mock.calls.length, 1);
    await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify({ ...events[0],
      value: 9900, recordedAt: "2026-05-05T12:00:00Z", lifecycle: { revision: 2 },
    }) + "\n"));
    const before = inspectProjection(root);
    const insert = wearableStore.insertWearableSummaryRows;
    const failing = vi.spyOn(wearableStore, "insertWearableSummaryRows").mockImplementation((...args) => {
      insert(...args);
      throw new Error("synthetic wearable publication failure");
    });
    await assert.rejects(reader.read(root, {}), /synthetic wearable publication failure/u);
    assert.deepEqual(inspectProjection(root), before);
    assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), false);
    failing.mockRestore();
    await reader.read(root, {});
    await assertWearablesFresh(root);
    assert.equal((await getQueryProjectionStatus(root)).fresh, false);
  });
}

test("all eight ordinary readers reject malformed canonical input even for empty provider scopes", async () => {
  const { root, shard } = await fixture();
  await rebuildQueryProjection(root);
  const dbPath = currentQueryProjectionLocation(root).absolutePath;
  const before = await readFile(dbPath);
  await withCanonicalWriteLock(root, () => appendFile(shard, "{malformed synthetic source\n"));
  const expected = await readVaultSourceStrict(root).then(() => null, (error: unknown) => error);
  assert.ok(expected instanceof Error);
  for (const reader of ordinaryWearableReaders) {
    for (const filters of [{}, { providers: [] }, { providers: ["missing"] }]) {
      await assert.rejects(reader.read(root, filters), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.constructor, expected.constructor);
        assert.equal(error.message, expected.message);
        return true;
      });
    }
  }
  assert.deepEqual(await readFile(dbPath), before);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
});


function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function phaseCount(report: CliTiming, phase: CliTimingPhase) {
  return report.commands.flatMap(command => command.phases).filter(row => row.phase === phase)
    .reduce((sum, row) => sum + row.count, 0);
}

test("all eight fresh-global readers finish before an unrelated parked writer, without acquiring its lock", async () => {
  const { root } = await fixture();
  await rebuildQueryProjection(root);
  const cases = ordinaryWearableReaders.flatMap(reader => [{}, { providers: [] }].map(filters => ({
    reader, filters, expected: JSON.stringify(ordinaryStoredOracle(reader, root, filters)),
  })));
  const held = gate(); const release = gate(); const attempted = gate();
  const owner = withCanonicalWriteLock(root, async () => { held.release(); await release.promise; });
  await held.promise;
  const lock = core.withCanonicalWriteLock;
  const acquired = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof lock>) => {
    attempted.release(); return lock(...args);
  });
  const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
  const pending: Promise<unknown>[] = [];
  try {
    for (const { reader, filters, expected } of cases) {
      let report!: CliTiming;
      const read = measuredQuery(`wearables ${reader.name}`, () => reader.read(root, filters), value => { report = value; });
      pending.push(read);
      assert.equal(await Promise.race([read.then(() => "read"), attempted.promise.then(() => "locked")]), "read");
      assert.equal(JSON.stringify(await read), expected);
      assertRebuildTiming(report, [], root);
      for (const phase of ["query-freshness", "query-manifest", "query-status"] as const) assert.equal(phaseCount(report, phase), 1);
      assert.equal(phaseCount(report, "query-wait"), 0);
    }
    assert.equal(acquired.mock.calls.length, 0);
    assert.equal(focused.mock.calls.length, 0);
    assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), true);
  } finally { release.release(); await owner; await Promise.allSettled(pending); }
});

for (const read of [ordinaryRuntime.summarizeWearableSleepRuntime, summarizeWearableSourceHealthRuntime]) {
  test(`${read.name} keeps its original focused ownership even with a fresh global cache`, async () => {
    const { root } = await fixture(); await rebuildQueryProjection(root);
    const expected = await read(root);
    const held = gate(); const release = gate(); const attempted = gate();
    const owner = withCanonicalWriteLock(root, async () => { held.release(); await release.promise; });
    await held.promise;
    const lock = core.withCanonicalWriteLock;
    vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof lock>) => {
      attempted.release(); return lock(...args);
    });
    const globalStatus = vi.spyOn(freshness, "readProjectionStatus");
    const capture = vi.spyOn(wearableStore, "readWearableSummaryRows");
    const pending = read(root);
    try {
      assert.equal(await Promise.race([pending.then(() => "read"), attempted.promise.then(() => "locked")]), "locked");
      assert.equal(capture.mock.calls.length, 0);
      assert.equal(globalStatus.mock.calls.length, 0);
    } finally { release.release(); await owner; await pending.catch(() => undefined); }
    assert.deepEqual(await pending, expected);
  });
}

for (const state of ["missing", "wearable-only", "legacy", "future", "unreadable", "schema-id", "built-at", "global-manifest", "wearable-manifest"] as const) {
  test(`ordinary global preflight cannot treat ${state} as fresh`, async () => {
    const { root } = await fixture(); await rebuildQueryProjection(root);
    const reader = ordinaryWearableReaders[1]!;
    const expected = JSON.stringify(ordinaryStoredOracle(reader, root, {}));
    if (state === "missing" || state === "wearable-only") {
      await removeProjection(root);
      if (state === "wearable-only") await summarizeWearableSourceHealthRuntime(root);
    } else if (state === "legacy" || state === "future") {
      executeSql(root, `PRAGMA user_version = ${QUERY_PROJECTION_SQLITE_VERSION + (state === "legacy" ? -1 : 1)}`);
    } else if (state === "unreadable") await writeFile(currentQueryProjectionLocation(root).absolutePath, "synthetic invalid database");
    else if (state === "schema-id") executeSql(root, "UPDATE query_meta SET value = 'unsupported' WHERE key = 'schema_version'");
    else if (state === "built-at") executeSql(root, "DELETE FROM query_meta WHERE key = 'built_at'");
    else if (state === "global-manifest") executeSql(root, "UPDATE query_source_manifest SET size_bytes = size_bytes + 1");
    else executeSql(root, "DELETE FROM query_meta WHERE key = 'wearable_source_manifest'");
    assert.equal((await getQueryProjectionStatus(root)).fresh, false);
    const captured = wearableStore.readWearableSummaryRows;
    vi.spyOn(wearableStore, "readWearableSummaryRows").mockImplementation((...args) => {
      assert.equal(existsSync(path.join(root, CANONICAL_WRITE_LOCK_DIRECTORY)), true); return captured(...args);
    });
    let report!: CliTiming;
    assert.equal(JSON.stringify(await measuredQuery("wearables latest", () => reader.read(root, {}), value => { report = value; })), expected);
    for (const phase of ["query-freshness", "query-manifest", "query-status"] as const) assert.equal(phaseCount(report, phase), 2);
    assert.equal(phaseCount(report, "query-wait"), 1);
    assert.equal(phaseCount(report, "query-metric-projection") + phaseCount(report, "query-search-documents"), 0);
    await assertWearablesFresh(root);
    // Repairing only a corrupt wearable certificate can recertify unchanged
    // completed global work; no other partial/reset case can do so.
    assert.equal((await getQueryProjectionStatus(root)).fresh, state === "wearable-manifest");
    await listCanonicalEntitiesRuntime(root);
    assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  });
}

for (const outcome of ["commit", "rollback"] as const) {
  test(`all eight readers wait for ${outcome}, even after reentrant wearable publication inside the outer writer`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wearable-global-write-")); roots.push(root);
    await core.initializeVault({ vaultRoot: root, timezone: "UTC", createdAt: "2026-05-01T00:00:00Z" });
    await rebuildQueryProjection(root);
    const before = inspectProjection(root);
    const held = gate(); const release = gate(); const attempted = gate();
    const failure = new Error("synthetic persistence rollback");
    const writer = core.withHostedCanonicalWritePort({ async persistCanonicalWrite() {
      // This is a real canonical mutation before durable persistence completes.
      // A wearable certificate here is not proof that the outer owner committed.
      await summarizeWearableSourceHealthRuntime(root);
      held.release(); await release.promise;
      // Outside ordinary readers are now queued behind this owner. Its own
      // ordinary read must remain reentrant, not join any pending reader.
      await ordinaryRuntime.summarizeWearableLatestRuntime(root);
      if (outcome === "rollback") throw failure;
    } }, () => core.importDeviceBatch({ vaultRoot: root, provider: "garmin", importedAt: "2026-05-06T09:00:00Z", events: [{
      kind: "observation", title: "Synthetic concurrent steps", timeZone: "UTC",
      occurredAt: "2026-05-06T08:00:00Z", recordedAt: "2026-05-06T09:00:00Z",
      externalRef: { system: "garmin", resourceType: "daily", resourceId: "synthetic-concurrent" },
      fields: { metric: "steps", value: 9900, unit: "count" },
    }] })).then(() => null, (error: unknown) => error);
    await Promise.race([held.promise, writer.then(() => { throw new Error("Writer did not reach the persistence boundary"); })]);
    const lock = core.withCanonicalWriteLock; let attempts = 0;
    vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof lock>) => {
      if (++attempts === ordinaryWearableReaders.length) attempted.release(); return lock(...args);
    });
    const captured = vi.spyOn(wearableStore, "readWearableSummaryRows");
    const globalRebuild = vi.spyOn(rebuild, "rebuildQueryProjectionFromCanonicalSource");
    const pending = ordinaryWearableReaders.map(reader => reader.read(root, {}));
    const reads = Promise.all(pending);
    try {
      await assertWearablesFresh(root);
      assert.equal((await getQueryProjectionStatus(root)).fresh, false);
      assert.equal(await Promise.race([...pending.map(read => read.then(() => "read")), attempted.promise.then(() => "locked")]), "locked");
      assert.equal(captured.mock.calls.length, 0);
    } finally { release.release(); await writer; await reads.catch(() => undefined); }
    assert.equal(await writer, outcome === "rollback" ? failure : null);
    const actual = await reads;
    assert.equal(globalRebuild.mock.calls.length, 0);
    assert.deepEqual(inspectProjection(root).global, before.global);
    assert.deepEqual(inspectProjection(root).globalMeta, before.globalMeta);
    await forceFullReference(root);
    for (const [index, reader] of ordinaryWearableReaders.entries()) {
      assert.equal(JSON.stringify(actual[index]), JSON.stringify(ordinaryStoredOracle(reader, root, {})));
    }
  });
}

test("a canonical write after the fresh status observation retains the old check/read boundary", async () => {
  const { root, shard, events } = await fixture(); await rebuildQueryProjection(root);
  const filters = { providers: ["garmin"] };
  const expected = JSON.stringify(ordinaryStoredOracle(ordinaryWearableReaders[0]!, root, filters));
  const status = freshness.readProjectionStatus;
  const check = vi.spyOn(freshness, "readProjectionStatus").mockImplementationOnce(async (...args) => {
    const observed = await status(...args); assert.equal(observed?.fresh, true);
    await withCanonicalWriteLock(root, () => appendFile(shard, JSON.stringify({ ...events[0], value: 9100,
      lifecycle: { revision: 2 }, recordedAt: "2026-05-06T09:00:00Z" }) + "\n"));
    return observed;
  });
  // The committed write occurs after the real fresh observation, before the
  // stored-row capture. The baseline did not retry this check/read window.
  const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
  const captured = vi.spyOn(wearableStore, "readWearableSummaryRows");
  const result = await ordinaryWearableReaders[0]!.read(root, filters);
  assert.equal(JSON.stringify(result), expected);
  assert.equal(focused.mock.calls.length, 0);
  assert.equal(check.mock.calls.length, 1); assert.equal(captured.mock.calls.length, 1);
  check.mockRestore();
  const current = await ordinaryRuntime.summarizeWearableDayRuntime(root, "2026-05-01", filters);
  assert.notEqual(JSON.stringify(current), expected);
  assert.equal(focused.mock.calls.length, 1);
  assert.equal((await getQueryProjectionStatus(root)).fresh, false);
});

for (const race of ["version-only", "reset", "missing-table", "corrupt-dictionary"] as const) {
  test(`fresh-global ${race} after status retains direct stored-read success/error semantics`, async () => {
    const { root } = await fixture();
    for (const filters of [{}, { providers: [] }]) {
      await removeProjection(root); await rebuildQueryProjection(root);
      const status = freshness.readProjectionStatus;
      vi.spyOn(freshness, "readProjectionStatus").mockImplementationOnce(async (...args) => {
        const observed = await status(...args); assert.equal(observed?.fresh, true);
        if (race === "version-only" || race === "reset") executeSql(root, `PRAGMA user_version = ${QUERY_PROJECTION_SQLITE_VERSION - 1}`);
        if (race === "reset") await freshness.resetUnsupportedQueryProjection(currentQueryProjectionLocation(root));
        if (race === "missing-table") executeSql(root, "DROP TABLE query_wearable_summary_shapes");
        if (race === "corrupt-dictionary") executeSql(root, "UPDATE query_wearable_summary_shapes SET keys_json = '[1]'");
        return observed;
      });
      const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
      const reader = ordinaryWearableReaders[1]!;
      const actual = await reader.read(root, filters).then(value => ({ value }), (error: unknown) => ({ error }));
      // This is precisely the old ordinary reader's post-status operation.
      const expected = await Promise.resolve().then(() => ordinaryStoredOracle(reader, root, filters))
        .then(value => ({ value }), (error: unknown) => ({ error }));
      assert.equal("error" in actual, filters.providers === undefined && race !== "version-only");
      if ("error" in expected) {
        assert.ok(expected.error instanceof Error); assert.ok("error" in actual && actual.error instanceof Error);
        assert.equal(actual.error.constructor, expected.error.constructor); assert.equal(actual.error.message, expected.error.message);
      } else {
        assert.ok("value" in actual); assert.deepEqual(actual.value, expected.value);
      }
      assert.equal(focused.mock.calls.length, 0, "No catch/retry, schema reset or fallback after a successful status check");
      vi.restoreAllMocks();
    }
  });
}

test("fresh-global ordinary read captures dictionary and rows in one SQLite generation", async () => {
  const { root } = await fixture(); await rebuildQueryProjection(root);
  const location = currentQueryProjectionLocation(root); const filters = { providers: ["garmin"] };
  const rows = wearableStore.readWearableSummaryRows(location, filters);
  const before = ordinaryStoredOracle(ordinaryWearableReaders[0]!, root, filters);
  const next = { ...rows, rows: rows.rows.map(row => ({ ...row, summaryJson: JSON.stringify(Object.fromEntries(
    Object.entries(JSON.parse(row.summaryJson.replace(/8000/gu, "9100"))).reverse(),
  )) })) };
  const writer = schema.openQueryProjectionDatabase(location);
  const readShapes = shapeStore.readWearableSummaryShapes;
  const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
  vi.spyOn(shapeStore, "readWearableSummaryShapes").mockImplementationOnce(database => {
    const shapes = readShapes(database);
    withImmediateTransaction(writer, () => {
      writer.exec("DELETE FROM query_wearable_summaries; DELETE FROM query_wearable_summary_shapes;");
      wearableStore.insertWearableSummaryRows(writer, next.rows);
    });
    return shapes;
  });
  try {
    assert.deepEqual(await ordinaryRuntime.summarizeWearableDayRuntime(root, "2026-05-01", filters), before);
    const after = wearables.summarizeWearableDayFromBundle(composePublicWearableSummaryBundleFromStoredRows(next, { ...filters, date: "2026-05-01" }), "2026-05-01");
    assert.notDeepEqual(after, before);
    assert.deepEqual(await ordinaryRuntime.summarizeWearableDayRuntime(root, "2026-05-01", filters), after);
    assert.equal(focused.mock.calls.length, 0);
  } finally { writer.close(); }
});

test("ordinary timing charges extra global preflight separately from the locked focused recheck", async () => {
  const { root } = await fixture(); await summarizeWearableSourceHealthRuntime(root);
  let tick = 0n; vi.spyOn(process.hrtime, "bigint").mockImplementation(() => tick);
  const manifest = source.listCanonicalSourceManifest;
  vi.spyOn(source, "listCanonicalSourceManifest").mockImplementation(async (...args) => { tick += 11_000n; return manifest(...args); });
  const status = freshness.readProjectionStatus;
  vi.spyOn(freshness, "readProjectionStatus").mockImplementation(async (...args) => { tick += 13_000n; return status(...args); });
  const wearableStatus = freshness.isWearableProjectionFresh;
  vi.spyOn(freshness, "isWearableProjectionFresh").mockImplementation(async (...args) => { tick += 17_000n; return wearableStatus(...args); });
  let report!: CliTiming;
  const read = () => measuredQuery("wearables latest", () => ordinaryRuntime.summarizeWearableLatestRuntime(root), value => { report = value; });
  await read(); assertRebuildTiming(report, [], root);
  const phase = (name: CliTimingPhase) => report.commands[0]!.phases.find(row => row.phase === name)!;
  assert.equal(phase("query-freshness").count, 2); assert.equal(phase("query-freshness").sumUs, 52);
  assert.equal(phase("query-manifest").sumUs, 22); assert.equal(phase("query-status").sumUs, 30);
  await rebuildQueryProjection(root);
  await read(); assertRebuildTiming(report, [], root);
  assert.equal(phase("query-freshness").count, 1); assert.equal(phase("query-freshness").sumUs, 24);
  assert.equal(phaseCount(report, "query-wait"), 0);
  const failure = new Error("synthetic preflight failure");
  vi.spyOn(source, "listCanonicalSourceManifest").mockRejectedValueOnce(failure);
  const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
  await assert.rejects(read(), error => error === failure);
  assert.equal(report.commands[0]!.outcome, "error");
  assert.equal(phaseCount(report, "query-freshness"), 1); assert.equal(focused.mock.calls.length, 0);
});
