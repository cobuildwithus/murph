import assert from "node:assert/strict";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { initializeVault, withCanonicalWriteLock } from "@murphai/core";
import { afterEach, test, vi } from "vitest";
import * as query from "../src/query-projection.ts";
import * as source from "../src/vault-source.ts";
import * as summaries from "../src/summaries.ts";
import * as metrics from "../src/metrics/projection.ts";
import * as candidates from "../src/wearables/candidates.ts";
import * as metricStore from "../src/projection/metric-store.ts";
import * as projector from "../src/projection/wearable-summary-projector.ts";
import { publishQueryProjectionSections } from "../src/projection/rebuild.ts";
import { readFreshQueryProjectionSections, readProjectionStatus } from "../src/projection/freshness.ts";
import {
  currentQueryProjectionLocation, queryProjectionSectionPath, publishQueryProjectionSection,
  openQueryProjectionSection, QUERY_PROJECTION_SECTION_NAMES, QUERY_PROJECTION_SQLITE_VERSION,
  QUERY_PROJECTION_SCHEMA_ID, QUERY_PROJECTION_CERTIFICATE_KEY,
  type QueryProjectionSection,
} from "../src/projection/schema.ts";
import { listStoredMetricPoints } from "../src/projection/metric-store.ts";
import { readStoredVaultSource } from "../src/projection/entity-store.ts";
import { readWearableSummaryRows } from "../src/projection/wearable-summary-store.ts";

const sectionTables = {
  entities: ["query_entities", "query_search_document", "query_search_fts"],
  metrics: ["query_metric_payloads", "query_metric_points", "query_metric_targets"],
  wearables: ["query_wearable_summary_shapes", "query_wearable_summaries"],
};

const roots: string[] = [];
const eventPath = "ledger/events/2026/2026-07.jsonl";
const samplePath = "ledger/metric-samples/glucose/2026/2026-07.jsonl";
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "query-sections-"));
  roots.push(root);
  return root;
}

// Same canonical sample and sleep shapes as query.test and the sleep-pattern
// runtime fixture; use real strict source reads for every publication.
async function fixture() {
  const root = await tempRoot();
  await initializeVault({ vaultRoot: root, timezone: "UTC", createdAt: "2026-07-01T00:00:00Z" });
  const events = [{
    schemaVersion: "murph.event.v1", id: "evt_sections_steps", kind: "observation", source: "device",
    title: "Synthetic steps", occurredAt: "2026-07-10T12:00:00Z", recordedAt: "2026-07-10T12:05:00Z",
    dayKey: "2026-07-10", metric: "steps", unit: "count", value: 8000,
    externalRef: { system: "garmin", resourceType: "daily", resourceId: "sections-steps" },
  }, {
    schemaVersion: "murph.event.v1", id: "evt_sections_sleep", kind: "sleep_session", source: "device",
    title: "Synthetic sleep", occurredAt: "2026-07-10T03:00:00Z", recordedAt: "2026-07-10T11:05:00Z",
    dayKey: "2026-07-10", startAt: "2026-07-10T03:00:00Z", endAt: "2026-07-10T11:00:00Z",
    durationMinutes: 480, sleepType: "main_sleep",
    externalRef: { system: "oura", resourceType: "sleep", resourceId: "sections-sleep" },
  }];
  const samples = [
    { id: "smp_sections_derived", quality: "derived", value: 104, recordedAt: "2026-07-10T12:00:00Z" },
    { id: "smp_sections_raw", quality: "raw", value: 999, recordedAt: "2026-07-11T12:00:00Z" },
  ].map(sample => ({ schemaVersion: "murph.metric-sample.v1", metric: "glucose", source: "device",
    unit: "mg_dL", dayKey: sample.recordedAt.slice(0, 10), ...sample }));
  for (const [relativePath, rows] of [[eventPath, events], [samplePath, samples]] as const) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  }
  return { root, events };
}

const readers: Record<QueryProjectionSection, (root: string) => Promise<unknown>> = {
  entities: root => query.searchVaultRuntime(root, "glucose", { kinds: ["sample_summary"] }),
  metrics: root => query.listMetricPointsRuntime(root, { metricKey: "steps", limit: null }),
  wearables: root => query.summarizeWearableSourceHealthRuntime(root),
};
async function fresh(root: string) {
  return [...await readFreshQueryProjectionSections(currentQueryProjectionLocation(root), await source.listCanonicalSourceManifest(root))];
}

for (const first of QUERY_PROJECTION_SECTION_NAMES) {
  test(`${first} can publish first without creating or certifying other sections`, async () => {
    const { root } = await fixture();
    const result = await readers[first](root);
    if (Array.isArray(result)) assert.ok(result.length > 0);
    else assert.ok(result && typeof result === "object" && "total" in result && Number(result.total) > 0);
    assert.deepEqual(await fresh(root), [first]);
    const location = currentQueryProjectionLocation(root);
    for (const section of QUERY_PROJECTION_SECTION_NAMES) {
      assert.equal(existsSync(queryProjectionSectionPath(location, section)), section === first);
    }
    const database = openQueryProjectionSection(location, first);
    try {
      for (const section of QUERY_PROJECTION_SECTION_NAMES) {
        for (const table of sectionTables[section]) {
          assert.equal(Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table)), section === first);
        }
      }
      assert.deepEqual(database.prepare("SELECT key FROM query_meta WHERE key LIKE '%manifest%' ").all().map(row => row.key), [QUERY_PROJECTION_CERTIFICATE_KEY]);
    } finally { database.close(); }
    const status = await query.getQueryProjectionStatus(root);
    assert.equal(status.exists, true);
    assert.equal(status.schemaVersion, QUERY_PROJECTION_SCHEMA_ID);
    assert.equal(status.dbPath, ".runtime/projections/query-entities.sqlite");
    assert.equal(status.fresh, false);
    assert.equal(status.entityCount > 0, first === "entities");
    assert.equal(status.searchDocumentCount > 0, first === "entities");
    if (first === "entities") assert.ok(status.builtAt);
    else assert.deepEqual([status.entityCount, status.searchDocumentCount, status.builtAt], [0, 0, null]);
    for (const section of QUERY_PROJECTION_SECTION_NAMES.filter(section => section !== first)) {
      await readers[section](root);
      assert.equal((await query.getQueryProjectionStatus(root)).fresh, (await fresh(root)).length === 3);
    }
    assert.deepEqual(await fresh(root), QUERY_PROJECTION_SECTION_NAMES);
    const complete = await query.getQueryProjectionStatus(root);
    assert.equal(complete.exists, true);
    assert.equal(complete.schemaVersion, QUERY_PROJECTION_SCHEMA_ID);
    assert.ok(complete.entityCount > 0 && complete.searchDocumentCount > 0 && complete.builtAt);
    assert.equal(complete.fresh, true);
  });
}

test("publication leaves audit records unread", async () => {
  const { root } = await fixture();
  await mkdir(path.join(root, "audit/2026"), { recursive: true });
  await writeFile(path.join(root, "audit/2026/2026-07.jsonl"), "not an audit record\n");
  // The default strict read still covers audits, and rejects this one.
  await assert.rejects(source.readVaultSourceStrict(root));
  assert.equal((await source.readVaultSourceStrict(root, { audits: false })).entities.some(entity => entity.family === "audit"), false);
  const rebuilt = await query.rebuildQueryProjection(root);
  assert.equal(rebuilt.fresh, true);
  assert.deepEqual(await fresh(root), QUERY_PROJECTION_SECTION_NAMES);
});

test("entities retain display-grade summary IDs, filters and citations without metric or wearable work", async () => {
  const { root } = await fixture();
  const dataset = vi.spyOn(candidates, "collectWearableDataset");
  const metric = vi.spyOn(metrics, "buildMetricProjection");
  const wearable = vi.spyOn(projector, "buildWearableSummaryProjectionFromDataset");
  const scoped = await query.searchVaultRuntime(root, "glucose", { streams: ["glucose"] });
  assert.doesNotMatch(JSON.stringify(scoped), /999|smp_sections_raw|sample-summary:2026-07-11/u);
  const result = await query.searchVaultRuntime(root, "glucose", { streams: ["glucose"], kinds: ["sample_summary"] });
  assert.equal(result.total, 1);
  assert.equal(result.hits[0]?.recordId, "sample-summary:2026-07-10:glucose:mg_dL");
  assert.equal(result.hits[0]?.kind, "sample_summary");
  assert.equal(result.hits[0]?.recordType, "sample");
  assert.equal(result.hits[0]?.citation.path, samplePath);
  assert.deepEqual(await query.searchVaultRuntime(root, "glucose", { kinds: ["sample_summary"] }), result);
  assert.equal((await query.searchVaultRuntime(root, "glucose", { streams: ["heart_rate"] })).total, 0);
  assert.doesNotMatch(JSON.stringify(result), /999|smp_sections_raw|sample-summary:2026-07-11/u);
  assert.equal(dataset.mock.calls.length, 0);
  assert.equal(metric.mock.calls.length, 0);
  assert.equal(wearable.mock.calls.length, 0);
  await query.rebuildQueryProjection(root);
  assert.deepEqual(await query.searchVaultRuntime(root, "glucose", { streams: ["glucose"], kinds: ["sample_summary"] }), result);
});

test("entities and metrics share one strict read and one sample summarization", async () => {
  const { root } = await fixture();
  const read = vi.spyOn(source, "readVaultSourceStrict");
  const summarize = vi.spyOn(summaries, "summarizeDailySamples");
  const dataset = vi.spyOn(candidates, "collectWearableDataset");
  await publishQueryProjectionSections(root, ["entities", "metrics"], () => undefined);
  assert.equal(read.mock.calls.length, 1);
  assert.equal(summarize.mock.calls.length, 1);
  assert.equal(dataset.mock.calls.length, 1);
  assert.deepEqual(await fresh(root), ["entities", "metrics"]);
  await publishQueryProjectionSections(root, ["entities", "metrics"], () => undefined);
  assert.equal(read.mock.calls.length, 1, "fresh sections reuse their publication");
});

test("an empty manifest cannot certify absent sections or merely created tables", async () => {
  const root = await tempRoot();
  assert.deepEqual(await source.listCanonicalSourceManifest(root), []);
  assert.deepEqual(await fresh(root), []);
  await readers.wearables(root);
  const database = new DatabaseSync(queryProjectionSectionPath(currentQueryProjectionLocation(root), "entities"));
  try { database.exec("CREATE TABLE query_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); }
  finally { database.close(); }
  assert.deepEqual(await fresh(root), ["wearables"]);
  assert.equal((await query.getQueryProjectionStatus(root)).fresh, false);
  await readers.entities(root);
  assert.deepEqual(await fresh(root), ["entities", "wearables"]);
  assert.equal((await query.getQueryProjectionStatus(root)).fresh, false);
  await readers.metrics(root);
  assert.equal((await query.getQueryProjectionStatus(root)).fresh, true);
});

test("provider-specific metric reads refresh wearable rows after a metrics-only refresh", async () => {
  const { root, events } = await fixture();
  await query.rebuildQueryProjection(root);
  const input = { metricKeys: ["steps"], providers: ["garmin"] };
  const before = await query.listMetricPointsByPublicSourceRuntime(root, input);
  await withCanonicalWriteLock(root, () => appendFile(path.join(root, eventPath), JSON.stringify({
    ...events[0], value: 9100, lifecycle: { revision: 2 }, recordedAt: "2026-07-12T12:00:00Z",
  }) + "\n"));
  await readers.metrics(root);
  assert.deepEqual(await fresh(root), ["metrics"]);
  const current = await query.listMetricPointsByPublicSourceRuntime(root, input);
  assert.notDeepEqual(current, before);
  assert.equal(current[0]?.points[0]?.value, 9100);
  assert.deepEqual(await fresh(root), ["metrics", "wearables"]);
  await query.rebuildQueryProjection(root);
  assert.deepEqual(await query.listMetricPointsByPublicSourceRuntime(root, input), current);
});

test("sleep pattern uses changed canonical timezone after wearables-only publication", async () => {
  const { root } = await fixture();
  await query.rebuildQueryProjection(root);
  const metadataPath = path.join(root, "vault.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  await withCanonicalWriteLock(root, () => writeFile(metadataPath, JSON.stringify({ ...metadata, timezone: "America/New_York" })));
  await readers.wearables(root);
  const build = vi.spyOn(summaries, "summarizeDailySamples");
  const result = await query.summarizeWearableSleepPatternRuntime(root, { date: "2026-07-10", now: "2026-07-11T12:00:00Z" });
  assert.equal(result.reportingTimeZone, "America/New_York");
  assert.equal(result.reportingTimeZoneSource, "vault_metadata");
  assert.equal(result.bedtime.medianLocalTime, "23:00");
  assert.equal(result.wakeTime.medianLocalTime, "07:00");
  assert.deepEqual(await fresh(root), ["wearables"]);
  assert.equal(build.mock.calls.length, 0);
  assert.equal(readStoredVaultSource(currentQueryProjectionLocation(root)).metadata?.timezone, "UTC");
});

// Malformed unrelated goal frontmatter + stale event reads without publication
// remain covered by vault-usecases/test/event-list-contract.test.ts and
// blood-test-focused.test.ts; their lock/order assertions stay in those owners.

test("forced publication after partial generations equals a fresh full store, table for table", async () => {
  const { root, events } = await fixture();
  await readers.entities(root);
  await withCanonicalWriteLock(root, () => appendFile(path.join(root, eventPath), JSON.stringify({
    ...events[0], value: 9200, lifecycle: { revision: 2 }, recordedAt: "2026-07-12T12:00:00Z",
  }) + "\n"));
  await readers.metrics(root);
  await readers.wearables(root);
  // A copied partial cache retains independent generations without certifying
  // the stale entity rows. The source manifest comes from unchanged canonicals.
  const restored = currentQueryProjectionLocation(await tempRoot());
  for (const section of QUERY_PROJECTION_SECTION_NAMES) {
    const destination = queryProjectionSectionPath(restored, section);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(queryProjectionSectionPath(currentQueryProjectionLocation(root), section), destination);
  }
  const manifest = await source.listCanonicalSourceManifest(root);
  assert.deepEqual([...await readFreshQueryProjectionSections(restored, manifest)], ["metrics", "wearables"]);
  assert.equal((await readProjectionStatus(restored, manifest))?.fresh, false);
  await query.rebuildQueryProjection(root);
  const reference = currentQueryProjectionLocation(await tempRoot());
  await publishQueryProjectionSections(root, QUERY_PROJECTION_SECTION_NAMES, () => undefined, { location: reference, force: true });
  for (const section of QUERY_PROJECTION_SECTION_NAMES) {
    const actual = openQueryProjectionSection(currentQueryProjectionLocation(root), section);
    const expected = openQueryProjectionSection(reference, section);
    try {
      for (const table of sectionTables[section]) {
        const order = table === "query_metric_points" ? "metric_key, effective_date DESC, observed_at DESC, id" : "rowid";
        assert.deepEqual(actual.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(),
          expected.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(), table);
      }
    } finally { actual.close(); expected.close(); }
  }
});

// A section file gets its tables, rows, certificate and version in one
// transaction and is never modified, so there is no table-presence check.
test("a direct read of an unpublished section fails closed", async () => {
  const { root } = await fixture();
  const location = currentQueryProjectionLocation(root);
  await readers.wearables(root);
  assert.throws(() => readStoredVaultSource(location), /is missing.*Rebuild the projection/u);
  assert.throws(() => listStoredMetricPoints(location, {}), /is missing.*Rebuild the projection/u);
  assert.deepEqual(await fresh(root), ["wearables"]);
});


test("section builds use an in-memory journal, 8192-byte pages and no disk sidecars", async () => {
  const location = currentQueryProjectionLocation(await tempRoot());
  const file = queryProjectionSectionPath(location, "entities");
  publishQueryProjectionSection(location, "entities", "[]", database => {
    assert.equal(database.prepare("PRAGMA journal_mode").get()?.journal_mode, "memory");
    assert.equal(database.prepare("PRAGMA page_size").get()?.page_size, 8192);
    assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file) + ".tmp"]);
  });
  assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
  const database = openQueryProjectionSection(location, "entities");
  try {
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, QUERY_PROJECTION_SQLITE_VERSION);
    assert.equal(database.prepare("PRAGMA page_size").get()?.page_size, 8192);
    assert.equal(database.prepare("SELECT value FROM query_meta WHERE key = ?").get(QUERY_PROJECTION_CERTIFICATE_KEY)?.value, "[]");
    assert.throws(() => database.exec("DELETE FROM query_meta"), /readonly/u);
  } finally { database.close(); }
});

test("interrupted temporary builds are replaced on the next publication", async () => {
  const location = currentQueryProjectionLocation(await tempRoot());
  const file = queryProjectionSectionPath(location, "metrics");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", "incomplete interrupted build");
  publishQueryProjectionSection(location, "metrics", "[]", () => undefined);
  assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
  const database = openQueryProjectionSection(location, "metrics");
  try { assert.equal(database.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok"); }
  finally { database.close(); }
});

test("a later publication failure leaves earlier sections fresh and the failed file byte-identical, skips capture and retries", async () => {
  const { root, events } = await fixture();
  await query.rebuildQueryProjection(root);
  const location = currentQueryProjectionLocation(root);
  const metricsPath = queryProjectionSectionPath(location, "metrics");
  const entitiesPath = queryProjectionSectionPath(location, "entities");
  const previousMetrics = await readFile(metricsPath);
  const previousEntities = await readFile(entitiesPath);
  await withCanonicalWriteLock(root, () => appendFile(path.join(root, eventPath), JSON.stringify({
    ...events[0], value: 9300, lifecycle: { revision: 2 }, recordedAt: "2026-07-12T12:00:00Z",
  }) + "\n"));
  const insert = metricStore.insertMetricPoints;
  const failure = new Error("synthetic metric insertion failure");
  const fail = vi.spyOn(metricStore, "insertMetricPoints").mockImplementation((...args) => {
    insert(...args);
    throw failure;
  });
  const capture = vi.fn();
  // Reversed requests still publish in the canonical entities/metrics order.
  await assert.rejects(publishQueryProjectionSections(root, ["metrics", "entities"], capture), error => error === failure);
  assert.equal(capture.mock.calls.length, 0);
  assert.notDeepEqual(await readFile(entitiesPath), previousEntities);
  assert.deepEqual(await readFile(metricsPath), previousMetrics);
  assert.deepEqual(await fresh(root), ["entities"]);
  assert.equal(listStoredMetricPoints(location, { metricKey: "steps" })[0]?.value, 8000);
  fail.mockRestore();
  const entitiesAfter = await readFile(entitiesPath);
  await publishQueryProjectionSections(root, ["entities", "metrics"], capture);
  assert.equal(capture.mock.calls.length, 1);
  assert.deepEqual(await readFile(entitiesPath), entitiesAfter);
  assert.deepEqual(await fresh(root), ["entities", "metrics"]);
  assert.equal(listStoredMetricPoints(location, { metricKey: "steps" })[0]?.value, 9300);
});

for (const section of QUERY_PROJECTION_SECTION_NAMES) {
  for (const state of ["v38", "corrupt"] as const) {
    test(`${section} reader replaces a ${state} section without changing other files`, async () => {
      const { root } = await fixture();
      await query.rebuildQueryProjection(root);
      const expected = await readers[section](root);
      const location = currentQueryProjectionLocation(root);
      const otherSections = QUERY_PROJECTION_SECTION_NAMES.filter(name => name !== section);
      const before = await Promise.all(otherSections.map(name => readFile(queryProjectionSectionPath(location, name))));
      const file = queryProjectionSectionPath(location, section);
      if (state === "corrupt") await writeFile(file, "synthetic corrupt section");
      else {
        const database = new DatabaseSync(file);
        try { database.exec("PRAGMA user_version = 38"); } finally { database.close(); }
      }
      assert.deepEqual(await fresh(root), otherSections);
      assert.deepEqual(await readers[section](root), expected);
      assert.deepEqual(await fresh(root), QUERY_PROJECTION_SECTION_NAMES);
      assert.deepEqual(await Promise.all(otherSections.map(name => readFile(queryProjectionSectionPath(location, name)))), before);
    });
  }
}

test("a legacy shared query.sqlite is ignored and left byte-identical", async () => {
  const { root } = await fixture();
  const legacy = path.join(root, ".runtime/projections/query.sqlite");
  await mkdir(path.dirname(legacy), { recursive: true });
  const database = new DatabaseSync(legacy);
  try { database.exec("CREATE TABLE legacy (value TEXT); INSERT INTO legacy VALUES ('synthetic'); PRAGMA user_version = 38"); }
  finally { database.close(); }
  const before = await readFile(legacy);
  assert.equal((await query.getQueryProjectionStatus(root)).exists, false);
  assert.deepEqual(await fresh(root), []);
  await query.rebuildQueryProjection(root);
  assert.deepEqual(await fresh(root), QUERY_PROJECTION_SECTION_NAMES);
  assert.deepEqual(await readFile(legacy), before);
});
