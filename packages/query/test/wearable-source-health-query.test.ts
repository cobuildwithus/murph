import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test, vi } from "vitest";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { CANONICAL_WRITE_LOCK_DIRECTORY, withCanonicalWriteLock } from "@murphai/core";
import {
  getQueryProjectionStatus,
  listCanonicalEntitiesRuntime,
  rebuildQueryProjection,
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

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
  "query_entities", "query_metric_points", "query_metric_targets",
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
  await assert.rejects(summarizeWearableSourceHealthRuntime(root), /injected wearable publication failure/u);
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
  await assert.rejects(summarizeWearableSourceHealthRuntime(root), error => error === failure);
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
  await assert.rejects(listCanonicalEntitiesRuntime(root), error => error === failure);
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
  executeSql(root, "UPDATE query_wearable_summaries SET summary_json = '{}' WHERE summary_kind = 'activity'");
  await assert.rejects(summarizeWearableSourceHealthRuntime(root), /activity evidence/iu);
});
