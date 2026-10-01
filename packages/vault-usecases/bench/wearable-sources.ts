import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node 24 type stripping; only built public package entrypoints are loaded.
// No credentials, provider calls, Git operations, source substitutions or timers
// standing in for work. Every worker owns and removes its synthetic temp vault.
const [major, minor, patch] = process.versions.node.split(".").map(Number);
assert.ok(major > 24 || (major === 24 && (minor > 14 || (minor === 14 && patch >= 1))),
  "Use the repository's Node >=24.14.1 runtime.");
const providers = ["garmin", "oura", "whoop"];
const metrics = [
  ["steps", 8000, "count"], ["activeCalories", 450, "kcal"],
  ["totalSleepMinutes", 450, "minutes"], ["deepMinutes", 90, "minutes"],
  ["remMinutes", 120, "minutes"], ["hrv", 50, "ms"],
  ["restingHeartRate", 60, "bpm"], ["weightKg", 75, "kg"],
] as const;
const repeatReads = 4;
const warmups = 2;
const pairs = 7;

const scenarios = ["source-only", "source-global", "global-source"] as const;
type Scenario = typeof scenarios[number];

interface Sample {
  stage: string;
  operation: "source" | "global";
  wallMs: number;
  cpuMs: number;
  outputBytes: number;
  sha256: string;
  outputCount: number;
  sourceRecords: number;
  observations: number;
  indexExists: boolean;
}
interface ProjectionState {
  globalTables: string[];
  globalRows: number[];
  globalStamp: string;
  wearableStamp: string | null;
  built: boolean;
  version: number;
}
interface WorkerResult {
  scenario: Scenario;
  node: string;
  workload: { days: number; providers: number; observations: number; eventLedgers: number; sourceBytes: number };
  samples: Sample[];
  cumulativeSourceReadMs: number;
  cumulativeSequenceMs: number;
  cardinality: unknown;
  cumulativeReadMs: number;
  sourceThenGlobalMs: number | null;
  projectionStates: ProjectionState[];
  rssBytes: number;
}

async function worker(checkout: string, scenario: Scenario): Promise<WorkerResult> {
  const require = createRequire(path.join(checkout, "packages/vault-usecases/package.json"));
  const servicesModule: typeof import("../src/vault-services.js") =
    await import(pathToFileURL(require.resolve("@murphai/vault-usecases/vault-services")).href);
  const core: typeof import("@murphai/core") =
    await import(pathToFileURL(require.resolve("@murphai/core")).href);
  const root = await mkdtemp(path.join(os.tmpdir(), "wearable-sources-bench-"));
  const shards = new Map<string, string[]>();
  let sourceBytes = 0;
  let observations = 0;
  let sourceRecords = 0;
  const samples: Sample[] = [];
  const service = servicesModule.createIntegratedVaultServices();
  try {
    await core.initializeVault({ vaultRoot: root, timezone: "UTC", createdAt: "2025-01-01T00:00:00Z" });
    for (let day = 0; day < 365; day += 1) {
      const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
      const shard = `ledger/events/2025/${date.slice(0, 7)}.jsonl`;
      for (const provider of providers) for (const [metric, value, unit] of metrics) {
        const id = `evt_synthetic_${provider}_${day}_${metric}`;
        const line = JSON.stringify({
          schemaVersion: "murph.event.v1", id, kind: "observation", dayKey: date,
          occurredAt: `${date}T07:00:00Z`, recordedAt: `${date}T08:00:00Z`,
          source: "device", title: "Synthetic benchmark metric", metric, value, unit,
          externalRef: { system: provider, resourceType: "daily", resourceId: id },
        });
        const lines = shards.get(shard) ?? [];
        lines.push(line);
        shards.set(shard, lines);
        observations += 1;
      }
    }
    await core.withCanonicalWriteLock(root, async () => {
      for (const [relativePath, lines] of shards) {
        const filename = path.join(root, relativePath);
        const text = lines.join("\n") + "\n";
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, text);
        sourceBytes += Buffer.byteLength(text);
      }
    });
    sourceRecords = observations;
    assert.equal(observations, 8760);
    assert.equal(shards.size, 12);
    const workload = { days: 365, providers: 3, observations, eventLedgers: shards.size, sourceBytes };
    const indexPath = path.join(root, ".runtime/projections/query.sqlite");
    assert.equal(existsSync(indexPath), false);
    async function read(stage: string, operation: Sample["operation"] = "source") {
      const start = performance.now();
      const cpu = process.cpuUsage();
      // This public activity usecase invokes the ordinary FULL query owner.
      // Its bounded public response has deterministic, redacted provenance.
      const result = operation === "source"
        ? await service.query.listWearableSources({ vault: root, requestId: null, limit: 50 })
        : await service.query.listWearableActivity({ vault: root, requestId: null, limit: 7 });
      const used = process.cpuUsage(cpu);
      const wallMs = performance.now() - start;
      const text = JSON.stringify(result);
      assert.equal(result.count, operation === "source" ? 3 : 7);
      samples.push({
        stage, operation, wallMs, cpuMs: (used.user + used.system) / 1000,
        outputBytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"),
        outputCount: result.count, sourceRecords, observations, indexExists: existsSync(indexPath),
      });
      if (operation === "source") {
        // Runtime discriminator is not carried by the union's item type. The
        // complete response above, not this diagnostic projection, is hashed.
        return result.items.map(item => ({
          provider: "provider" in item ? item.provider : null,
          candidateMetrics: "candidateMetrics" in item ? item.candidateMetrics : null,
          selectedMetrics: "selectedMetrics" in item ? item.selectedMetrics : null,
          activityDays: "activityDays" in item ? item.activityDays : null,
          sleepNights: "sleepNights" in item ? item.sleepNights : null,
          recoveryDays: "recoveryDays" in item ? item.recoveryDays : null,
          bodyStateDays: "bodyStateDays" in item ? item.bodyStateDays : null,
        }));
      }
      return null;
    }
    async function repeat(prefix: string, expectedHash: string) {
      for (let run = 0; run < repeatReads; run += 1) {
        await read(`${prefix}-${run + 1}`);
        assert.equal(samples.at(-1)?.sha256, expectedHash);
      }
    }
    async function unrelatedWrite() {
      await core.withCanonicalWriteLock(root, () => appendFile(path.join(root, "ledger/events/2025/2025-12.jsonl"), JSON.stringify({
        schemaVersion: "murph.event.v1", id: "evt_synthetic_unrelated_note", kind: "note", source: "manual",
        title: "Synthetic unrelated note", occurredAt: "2025-12-31T12:00:00Z", recordedAt: "2025-12-31T12:00:00Z",
      }) + "\n"));
      sourceRecords += 1;
    }
    async function sourceWrite(sleepOnly = false) {
      const provider = sleepOnly ? "oura" : "garmin";
      const date = sleepOnly ? "2026-01-03" : "2026-01-01";
      await core.importDeviceBatch({
        vaultRoot: root, provider, importedAt: `${date}T08:00:00Z`,
        events: [{
          kind: "observation", timeZone: "UTC", occurredAt: `${date}T07:00:00Z`,
          recordedAt: `${date}T08:00:00Z`, title: sleepOnly ? "Synthetic sleep-only freshness" : "Synthetic new source day",
          externalRef: { system: provider, resourceType: "daily", resourceId: sleepOnly ? "synthetic-sleep-after-index" : "synthetic-after-write" },
          // Preserve the attested public-import spelling, not totalSleepMinutes.
          fields: sleepOnly
            ? { metric: "total-sleep-minutes", value: 450, unit: "minutes" }
            : { metric: "steps", value: 9000, unit: "count" },
        }],
      });
      observations += 1;
      sourceRecords += 1;
    }
    const sequenceStart = performance.now();
    let cardinality: unknown;
    let cumulativeSourceReadMs: number;
    let cumulativeSequenceMs: number;
    let sourceThenGlobalMs: number | null = null;
    const projectionStates: ProjectionState[] = [];
    if (scenario === "source-only") {
      cardinality = await read("cold");
      const initialHash = samples.at(-1)!.sha256;
      await repeat("source-only-repeat", initialHash);
      await unrelatedWrite();
      await read("after-unrelated-write");
      assert.equal(samples.at(-1)?.sha256, initialHash);
      await repeat("after-unrelated-repeat", initialHash);
      await sourceWrite();
      await read("after-source-write");
      const changedHash = samples.at(-1)!.sha256;
      assert.notEqual(changedHash, initialHash);
      await repeat("after-source-repeat", changedHash);
      assert.equal(samples.length, 15);
      cumulativeSequenceMs = performance.now() - sequenceStart;
      cumulativeSourceReadMs = samples.reduce((total, sample) => total + sample.wallMs, 0);
      projectionStates.push(inspectProjection(indexPath));
      // No ignored/preloaded accelerator work: this is an actual public global
      // read with its own timer, bytes/hash and a source-sequence+global total.
      await read("source-sequence-global", "global");
      sourceThenGlobalMs = cumulativeSourceReadMs + samples.at(-1)!.wallMs;
      projectionStates.push(inspectProjection(indexPath));
      await repeat("fresh-index-accelerator", changedHash);
      await sourceWrite(true);
      await read("invalidated-index-sleep-write");
      const sleepHash = samples.at(-1)!.sha256;
      assert.notEqual(sleepHash, changedHash);
      await repeat("invalidated-index-repeat", sleepHash);
      projectionStates.push(inspectProjection(indexPath));
    } else {
      async function composedRead(stage: string) {
        const order: Sample["operation"][] = scenario === "source-global" ? ["source", "global"] : ["global", "source"];
        for (const operation of order) {
          const counts = await read(`${stage}-${operation}`, operation);
          if (cardinality === undefined && counts !== null) cardinality = counts;
        }
        return Object.fromEntries(samples.slice(-2).map(sample => [sample.operation, sample.sha256]));
      }
      let previous: Record<string, string> | undefined;
      for (const stage of ["cold", "after-unrelated-write", "after-source-write"]) {
        if (stage === "after-unrelated-write") await unrelatedWrite();
        if (stage === "after-source-write") await sourceWrite();
        const hashes = await composedRead(stage);
        if (stage === "after-unrelated-write") assert.deepEqual(hashes, previous);
        if (stage === "after-source-write") {
          assert.notEqual(hashes.source, previous?.source);
          assert.notEqual(hashes.global, previous?.global);
        }
        assert.deepEqual(await composedRead(`${stage}-repeat`), hashes);
        previous = hashes;
      }
      cumulativeSequenceMs = performance.now() - sequenceStart;
      cumulativeSourceReadMs = samples.filter(sample => sample.operation === "source")
        .reduce((total, sample) => total + sample.wallMs, 0);
    }
    return {
      scenario, node: process.version, workload, samples, cumulativeSourceReadMs, cumulativeSequenceMs,
      cumulativeReadMs: samples.reduce((total, sample) => total + sample.wallMs, 0),
      sourceThenGlobalMs, projectionStates, cardinality, rssBytes: process.memoryUsage().rss,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function inspectProjection(indexPath: string): ProjectionState {
  const database = new DatabaseSync(indexPath, { readOnly: true });
  try {
    const tables = ["query_entities", "query_metric_points", "query_metric_targets", "query_search_document"];
    const hasTable = (table: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    const globalRows = tables.map(table => hasTable(table)
      ? Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count) : 0);
    const globalMeta = database.prepare("SELECT * FROM query_meta WHERE key != 'wearable_source_manifest' ORDER BY key").all();
    const manifest = hasTable("query_source_manifest")
      ? database.prepare("SELECT * FROM query_source_manifest ORDER BY relative_path").all() : [];
    const wearable = database.prepare("SELECT value FROM query_meta WHERE key = 'wearable_source_manifest'").get();
    return {
      globalTables: [...tables, "query_source_manifest", "query_search_fts"].filter(hasTable),
      globalRows,
      globalStamp: createHash("sha256").update(JSON.stringify([globalMeta, manifest, globalRows])).digest("hex"),
      wearableStamp: wearable ? createHash("sha256").update(String(wearable.value)).digest("hex") : null,
      built: globalMeta.some(row => row.key === "built_at"),
      version: Number(database.prepare("PRAGMA user_version").get()!.user_version),
    };
  } finally { database.close(); }
}

async function runWorker(checkout: string, scenario: Scenario): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", checkout, scenario], {
      cwd: checkout, stdio: ["ignore", "pipe", "pipe"],
      // Do not pass connected account or hosted runtime credentials to workers.
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), TZ: "UTC" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) { reject(new Error(`Synthetic benchmark worker failed (${code}): ${stderr}`)); return; }
      try {
        const result: WorkerResult = JSON.parse(stdout);
        validateWorker(result, scenario);
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

function semantics(result: WorkerResult) {
  return result.samples.map(({ stage, operation, outputBytes, sha256, outputCount, sourceRecords, observations }) =>
    ({ stage, operation, outputBytes, sha256, outputCount, sourceRecords, observations }));
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function parseScenario(value: string | undefined): Scenario {
  const scenario = scenarios.find(candidate => candidate === (value ?? "source-only"));
  assert.ok(scenario, "Expected source-only, source-global or global-source");
  return scenario;
}

interface PairResult {
  benchmark: "wearable-sources";
  scenario: Scenario;
  pair: number;
  warmup: boolean;
  candidateFirst: boolean;
  before: WorkerResult;
  after: WorkerResult;
}

function exactKeys(value: unknown, keys: string[]) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Expected an evidence object");
  assert.deepEqual(Object.keys(value).sort(), keys.sort(), "Missing or unknown evidence fields");
}

// This describes the unchanged worker sequence, not a second workload runner.
function expectedSamples(scenario: Scenario) {
  const samples: Pick<Sample, "stage" | "operation" | "sourceRecords" | "observations">[] = [];
  const add = (stage: string, operation: Sample["operation"], sourceRecords: number, observations: number) => {
    samples.push({ stage, operation, sourceRecords, observations });
  };
  if (scenario === "source-only") {
    for (const [stage, prefix, records, observations] of [
      ["cold", "source-only-repeat", 8760, 8760],
      ["after-unrelated-write", "after-unrelated-repeat", 8761, 8760],
      ["after-source-write", "after-source-repeat", 8762, 8761],
    ] as const) {
      add(stage, "source", records, observations);
      for (let run = 1; run <= repeatReads; run += 1) add(`${prefix}-${run}`, "source", records, observations);
    }
    add("source-sequence-global", "global", 8762, 8761);
    for (let run = 1; run <= repeatReads; run += 1) add(`fresh-index-accelerator-${run}`, "source", 8762, 8761);
    add("invalidated-index-sleep-write", "source", 8763, 8762);
    for (let run = 1; run <= repeatReads; run += 1) add(`invalidated-index-repeat-${run}`, "source", 8763, 8762);
  } else {
    const order: Sample["operation"][] = scenario === "source-global" ? ["source", "global"] : ["global", "source"];
    for (const [stage, records, observations] of [
      ["cold", 8760, 8760], ["after-unrelated-write", 8761, 8760], ["after-source-write", 8762, 8761],
    ] as const) for (const suffix of ["", "-repeat"]) for (const operation of order) {
      add(`${stage}${suffix}-${operation}`, operation, records, observations);
    }
  }
  return samples;
}

function validateSamples(result: WorkerResult, scenario: Scenario) {
  assert.ok(Array.isArray(result.samples));
  const expected = expectedSamples(scenario);
  assert.equal(result.samples.length, expected.length);
  const previous = new Map<Sample["operation"], Sample>();
  for (const [index, sample] of result.samples.entries()) {
    exactKeys(sample, ["stage", "operation", "wallMs", "cpuMs", "outputBytes", "sha256", "outputCount",
      "sourceRecords", "observations", "indexExists"]);
    const { stage, operation, sourceRecords, observations } = sample;
    assert.deepEqual({ stage, operation, sourceRecords, observations }, expected[index], "Fixed sample sequence/counts changed");
    for (const ms of [sample.wallMs, sample.cpuMs]) assert.ok(Number.isFinite(ms) && ms >= 0);
    assert.ok(Number.isSafeInteger(sample.outputBytes) && sample.outputBytes > 0);
    assert.match(sample.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(sample.outputCount, operation === "source" ? 3 : 7);
    assert.equal(sample.indexExists, true);
    const prior = previous.get(operation);
    if (prior?.observations === observations) {
      assert.deepEqual([sample.sha256, sample.outputBytes], [prior.sha256, prior.outputBytes], "Repeat/unrelated-write response changed");
    } else if (prior) assert.notEqual(sample.sha256, prior.sha256, "Source write did not change the complete response");
    previous.set(operation, sample);
  }
}

function validateWorker(result: WorkerResult, scenario: Scenario) {
  exactKeys(result, ["scenario", "node", "workload", "samples", "cumulativeSourceReadMs", "cumulativeSequenceMs",
    "cardinality", "cumulativeReadMs", "sourceThenGlobalMs", "projectionStates", "rssBytes"]);
  assert.equal(result.scenario, scenario);
  assert.match(result.node, /^v\d+\.\d+\.\d+$/u);
  const [major = 0, minor = 0, patch = 0] = result.node.slice(1).split(".").map(Number);
  assert.ok(major > 24 || (major === 24 && (minor > 14 || (minor === 14 && patch >= 1))), "Unsupported captured runtime");
  // Exact initial event-ledger bytes for the fixed 365-day fixture above.
  assert.deepEqual(result.workload, { days: 365, providers: 3, observations: 8760, eventLedgers: 12, sourceBytes: 3522810 });
  validateSamples(result, scenario);
  const sourceSamples = scenario === "source-only" ? result.samples.slice(0, 15)
    : result.samples.filter(sample => sample.operation === "source");
  assert.equal(result.cumulativeSourceReadMs, sourceSamples.reduce((total, sample) => total + sample.wallMs, 0));
  assert.equal(result.cumulativeReadMs, result.samples.reduce((total, sample) => total + sample.wallMs, 0));
  assert.equal(result.sourceThenGlobalMs, scenario === "source-only" ? result.cumulativeSourceReadMs + result.samples[15]!.wallMs : null);
  for (const ms of [result.cumulativeSourceReadMs, result.cumulativeReadMs, result.sourceThenGlobalMs ?? 0]) {
    assert.ok(Number.isFinite(ms) && ms >= 0);
  }
  assert.ok(Number.isFinite(result.cumulativeSequenceMs) && result.cumulativeSequenceMs >=
    (scenario === "source-only" ? result.cumulativeSourceReadMs : result.cumulativeReadMs));
  assert.ok(Number.isSafeInteger(result.rssBytes) && result.rssBytes > 0);
  assert.ok(Array.isArray(result.cardinality) && result.cardinality.length === providers.length);
  for (const item of result.cardinality) {
    exactKeys(item, ["provider", "candidateMetrics", "selectedMetrics", "activityDays", "sleepNights", "recoveryDays", "bodyStateDays"]);
  }
  assert.deepEqual(result.cardinality.map(item => item.provider).sort(), [...providers].sort());
  validateProjectionStates(result, scenario);
}

function validateProjectionStates(result: WorkerResult, scenario: Scenario) {
  assert.ok(Array.isArray(result.projectionStates));
  assert.equal(result.projectionStates.length, scenario === "source-only" ? 3 : 0);
  for (const state of result.projectionStates) {
    exactKeys(state, ["globalTables", "globalRows", "globalStamp", "wearableStamp", "built", "version"]);
    assert.ok(Array.isArray(state.globalTables) && state.globalTables.every(table =>
      ["query_entities", "query_metric_points", "query_metric_targets", "query_search_document", "query_source_manifest", "query_search_fts"].includes(table)));
    assert.equal(new Set(state.globalTables).size, state.globalTables.length);
    assert.ok(Array.isArray(state.globalRows) && state.globalRows.length === 4 &&
      state.globalRows.every(count => Number.isSafeInteger(count) && count >= 0));
    for (const [index, table] of ["query_entities", "query_metric_points", "query_metric_targets", "query_search_document"].entries()) {
      if (!state.globalTables.includes(table)) assert.equal(state.globalRows[index], 0, "Rows reported for a missing global table");
    }
    assert.match(state.globalStamp, /^[0-9a-f]{64}$/u);
    if (state.wearableStamp !== null) assert.match(state.wearableStamp, /^[0-9a-f]{64}$/u);
    assert.equal(typeof state.built, "boolean");
    assert.ok(Number.isSafeInteger(state.version) && state.version > 0);
  }
}

// Shared by live capture and replay; warmups receive the same semantic checks.
function addPair(record: PairResult, records: PairResult[]) {
  exactKeys(record, ["benchmark", "scenario", "pair", "warmup", "candidateFirst", "before", "after"]);
  assert.equal(record.benchmark, "wearable-sources", "Unknown JSONL record");
  const { scenario, pair, before, after } = record;
  assert.ok(scenarios.includes(scenario));
  assert.ok(Number.isInteger(pair) && pair >= -warmups && pair < pairs, "Unexpected pair slot");
  assert.equal(record.warmup, pair < 0);
  assert.equal(record.candidateFirst, Math.abs(pair) % 2 === 1);
  assert.ok(!records.some(record => record.scenario === scenario && record.pair === pair), "Duplicate scenario/pair slot");
  validateWorker(before, scenario);
  validateWorker(after, scenario);
  assert.equal(after.node, before.node);
  if (records.length) assert.equal(before.node, records[0]!.before.node, "Mixed captured runtimes");
  assert.deepEqual(before.workload, after.workload);
  assert.deepEqual(semantics(after), semantics(before), "All complete response bytes/hashes must match, including composed and after-write results");
  assert.deepEqual(after.cardinality, before.cardinality);
  const reference = records.find(record => record.scenario === scenario);
  if (reference) {
    assert.deepEqual(semantics(before), semantics(reference.before), "Mismatched response evidence across pairs");
    assert.deepEqual(before.cardinality, reference.before.cardinality);
  }
  if (scenario === "source-only") {
    const [partial, full, invalidated] = after.projectionStates;
    assert.ok(partial && full && invalidated);
    assert.equal(partial.version, 28);
    assert.deepEqual(partial.globalTables, [], "partial replacement must fail closed for older global readers");
    assert.deepEqual(partial.globalRows, [0, 0, 0, 0], "source-only must not publish global rows");
    assert.equal(partial.built, false, "source-only must not certify a global build");
    assert.ok(partial.wearableStamp);
    assert.equal(full.built, true);
    assert.ok(full.globalRows[0]! > 0 && full.globalRows[1]! > 0 && full.globalRows[3]! > 0);
    assert.equal(full.wearableStamp, partial.wearableStamp, "the following global read reuses the current wearable generation");
    assert.equal(invalidated.globalStamp, full.globalStamp, "source-only must not refresh or certify stale global work");
    assert.notEqual(invalidated.wearableStamp, full.wearableStamp);
    assert.ok(invalidated.wearableStamp);
    assert.equal(full.version, 28);
    assert.equal(invalidated.version, 28);
    assert.equal(invalidated.built, full.built);
    assert.deepEqual(invalidated.globalTables, full.globalTables);
    assert.deepEqual(invalidated.globalRows, full.globalRows);
  }
  records.push(record);
}

function isRepeat(stage: string) {
  return stage.includes("repeat") || stage.startsWith("fresh-index-accelerator");
}

function summarize(records: PairResult[]) {
  assert.equal(records.length, scenarios.length * (warmups + pairs), "Expected all 27 unique scenario/pair slots");
  const measured = records.filter(record => !record.warmup);
  const summaries = scenarios.map(scenario => {
    const matching = measured.filter(pair => pair.before.scenario === scenario);
    assert.equal(matching.length, pairs);
    const stages = matching[0]!.before.samples.map((sample, index) => ({
      stage: sample.stage,
      operation: sample.operation,
      beforeMedianMs: median(matching.map(pair => pair.before.samples[index]!.wallMs)),
      afterMedianMs: median(matching.map(pair => pair.after.samples[index]!.wallMs)),
      pairedWins: matching.filter(pair => pair.after.samples[index]!.wallMs < pair.before.samples[index]!.wallMs).length,
    }));
    const repeatCohorts = (["source", "global"] as const).flatMap(operation => {
      const indices = stages.flatMap((stage, index) => stage.operation === operation && isRepeat(stage.stage) ? [index] : []);
      if (!indices.length) return [];
      const totals = (result: WorkerResult) => indices.reduce((total, index) => total + result.samples[index]!.wallMs, 0);
      const before = matching.map(pair => totals(pair.before));
      const after = matching.map(pair => totals(pair.after));
      return [{ scenario, operation, repeatsPerWorker: indices.length,
        beforeMedianMs: median(before), afterMedianMs: median(after),
        pairedWins: after.filter((total, index) => total < before[index]!).length,
        medianPairedDeltaMs: median(after.map((total, index) => total - before[index]!)),
      }];
    });
    const beforeCumulative = median(matching.map(pair => scenario === "source-only" ? pair.before.cumulativeSourceReadMs : pair.before.cumulativeReadMs));
    const afterCumulative = median(matching.map(pair => scenario === "source-only" ? pair.after.cumulativeSourceReadMs : pair.after.cumulativeReadMs));
    const sourceRepeatPositionsAccepted = stages.filter(stage => stage.operation === "source" && isRepeat(stage.stage))
      .every(stage => stage.afterMedianMs <= stage.beforeMedianMs);
    return {
      scenario, beforeMedianCumulativeMs: beforeCumulative, afterMedianCumulativeMs: afterCumulative,
      beforeMedianSourceThenGlobalMs: scenario === "source-only" ? median(matching.map(pair => pair.before.sourceThenGlobalMs!)) : null,
      afterMedianSourceThenGlobalMs: scenario === "source-only" ? median(matching.map(pair => pair.after.sourceThenGlobalMs!)) : null,
      pairedCumulativeWins: matching.filter(pair => scenario === "source-only"
        ? pair.after.cumulativeSourceReadMs < pair.before.cumulativeSourceReadMs
        : pair.after.cumulativeReadMs < pair.before.cumulativeReadMs).length,
      stages,
      sourceRepeatPositionsAccepted,
      repeatCohorts,
      // Retain every position; global increases require investigation, not an
      // automatic failure when the matched repeated-query cohort is sound.
      globalPositionIncreases: stages.filter(stage => stage.operation === "global" && stage.afterMedianMs > stage.beforeMedianMs),
      repeatedReadsAccepted: sourceRepeatPositionsAccepted && repeatCohorts.every(cohort =>
        cohort.afterMedianMs <= cohort.beforeMedianMs && cohort.medianPairedDeltaMs <= 0),
      cumulativeAccepted: afterCumulative < beforeCumulative,
    };
  });
  const primary = summaries[0]!;
  const cold = primary.stages.find(stage => stage.stage === "cold")!;
  const accepted = cold.afterMedianMs < cold.beforeMedianMs
    && summaries.every(summary => summary.repeatedReadsAccepted && summary.cumulativeAccepted)
    && primary.afterMedianSourceThenGlobalMs! <= primary.beforeMedianSourceThenGlobalMs!;
  return { benchmark: "wearable-sources-summary", warmups, pairs, summaries, accepted };
}

if (process.argv[2] === "--worker") {
  assert.ok(process.argv[3], "Missing worker checkout");
  console.log(JSON.stringify(await worker(await realpath(process.argv[3]), parseScenario(process.argv[4]))));
} else {
  const records: PairResult[] = [];
  if (process.argv[2] === "--replay") {
    assert.equal(process.argv.length, 4, "Usage: node wearable-sources.ts --replay /absolute/saved-results.jsonl");
    const lines = (await readFile(process.argv[3]!, "utf8")).trimEnd().split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const record = JSON.parse(line);
      if (record?.benchmark === "wearable-sources-summary") {
        // The prior position-based verdict is not an input to acceptance.
        assert.equal(index, lines.length - 1, "Only one terminal summary may be ignored");
        exactKeys(record, ["benchmark", "warmups", "pairs", "summaries", "accepted"]);
        assert.equal(record.warmups, warmups);
        assert.equal(record.pairs, pairs);
        assert.equal(typeof record.accepted, "boolean");
        assert.ok(Array.isArray(record.summaries));
        assert.deepEqual(record.summaries.map((summary: { scenario: unknown }) => summary.scenario), [...scenarios]);
      } else {
        addPair(record, records);
        console.log(JSON.stringify(record));
      }
    }
  } else {
    const [baseArgument, candidateArgument] = process.argv.slice(2);
    assert.ok(baseArgument && candidateArgument, "Usage: node wearable-sources.ts /absolute/base-checkout /absolute/candidate-checkout");
    const base = await realpath(baseArgument);
    const candidate = await realpath(candidateArgument);
    assert.notEqual(base, candidate, "Base and candidate must be independently built checkouts");
    for (let pair = -warmups; pair < pairs; pair += 1) {
      for (const scenario of scenarios) {
        const candidateFirst = Math.abs(pair) % 2 === 1;
        const first = await runWorker(candidateFirst ? candidate : base, scenario);
        const second = await runWorker(candidateFirst ? base : candidate, scenario);
        const before = candidateFirst ? second : first;
        const after = candidateFirst ? first : second;
        const record: PairResult = { benchmark: "wearable-sources", scenario, pair, warmup: pair < 0, candidateFirst, before, after };
        addPair(record, records);
        console.log(JSON.stringify(record));
      }
    }
  }
  const summary = summarize(records);
  console.log(JSON.stringify(summary));
  if (!summary.accepted) process.exitCode = 1;
}
