import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { VaultServices } from "@murphai/vault-usecases/vault-services";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import { fingerprint, readGlobalProof, readSleepProof, reviseSleepFixture, seedSleepFixture, sleepDate, sleepNow } from "./wearable-sleep-fixture.ts";

export const ordinaryReaders = ["day", "latest", "metric-latest", "metric-trend", "drift", "activity", "body", "recovery"] as const;
export type OrdinaryReader = typeof ordinaryReaders[number];
type Filters = { date?: string; from?: string; to?: string; providers?: string[]; limit?: number; windowDays?: number };
type OrdinaryResult = Awaited<ReturnType<VaultServices["query"][
  "showWearableDay" | "showWearableLatest" | "showWearableMetricLatest" | "showWearableMetricTrend" |
  "showWearableDrift" | "listWearableActivity" | "listWearableBodyState" | "listWearableRecovery"
]>>;
export async function readOrdinary(services: VaultServices, vault: string, reader: OrdinaryReader, filters: Filters = {}): Promise<OrdinaryResult> {
  const input = { vault, requestId: null, ...filters };
  switch (reader) {
    case "day": return services.query.showWearableDay({ ...input, date: filters.date ?? sleepDate(89) });
    case "latest": return services.query.showWearableLatest(input);
    case "metric-latest": return services.query.showWearableMetricLatest({ ...input, metric: "total-sleep-minutes" });
    case "metric-trend": return services.query.showWearableMetricTrend({ ...input, metric: "total-sleep-minutes" });
    case "drift": return services.query.showWearableDrift(input);
    case "activity": return services.query.listWearableActivity({ ...input, limit: filters.limit ?? 7 });
    case "body": return services.query.listWearableBodyState({ ...input, limit: filters.limit ?? 7 });
    case "recovery": return services.query.listWearableRecovery({ ...input, limit: filters.limit ?? 7 });
  }
}

export const scenarios = {
  "cold-latest": ["latest"], "cold-activity": ["activity"], "cold-recovery": ["recovery"],
  repeated: ["latest", "activity", "recovery", "latest"],
  "wearable-current-global-stale": ["setup-global", "edit", "setup-sleep", "latest", "activity", "recovery", "global"],
  "fresh-global": ["setup-global", "latest", "activity", "recovery"],
  "wearable-global": ["latest", "global", "recovery", "global"],
  "global-wearable": ["global", "recovery", "global", "latest"],
  "global-cold": ["global"], "global-edit": ["global", "edit", "global"],
  "blood-cold": ["blood"], "blood-repeated": ["blood", "blood"],
  "blood-global": ["blood", "global", "blood", "global"],
  "global-blood": ["global", "blood", "global"],
  "blood-stale": ["setup-global", "blood-edit", "blood", "global"],
  "browser-default": ["replica-default"], "browser-raw": ["replica-raw"],
} as const;
export type Scenario = keyof typeof scenarios;
type Mode = "full" | "focused" | "additions";
type PairMode = Mode | "additions-control";
type Counts = { total: number; replacer: number; metric: number; emptyMetric: number; metricIdentity: number };
const zeroCounts = (): Counts => ({ total: 0, replacer: 0, metric: 0, emptyMetric: 0, metricIdentity: 0 });
const globalOperation = (operation: string): operation is "global" | "setup-global" => operation === "global" || operation === "setup-global";

// Native public entrypoints only. No source loader, runtime replacement, copied
// projector, hidden warmup read or result-field normalization is used here.
export async function runTrial(vault: string, scenario: Scenario, probe = false) {
  let services: VaultServices | undefined;
  let mutationMs = 0;
  let bloodValue = 87;
  const steps = [];
  let counts = zeroCounts();
  const stringify = JSON.stringify;
  if (probe) JSON.stringify = (...args: unknown[]) => {
    counts.total++;
    if (typeof args[1] === "function") counts.replacer++;
    const value = args[0];
    if (Array.isArray(value) && value.length === 13 && typeof value[0] === "string"
      && typeof value[1] === "string" && typeof value[2] === "string"
      && ["derived", "sample", "event"].includes(value[5]) && typeof value[9] === "string") counts.metricIdentity++;
    if (value && typeof value === "object" && "metric" in value && "candidates" in value
      && "selection" in value && value.selection && typeof value.selection === "object") {
      counts.metric++;
      if ("resolution" in value.selection && value.selection.resolution === "none") counts.emptyMetric++;
    }
    return Reflect.apply(stringify, JSON, args);
  };
  mock.timers.enable({ apis: ["Date"], now: Date.parse(sleepNow) });
  const workflowStart = performance.now();
  try {
    for (const operation of scenarios[scenario]) {
      if (operation === "edit" || operation === "blood-edit") {
        const start = performance.now();
        if (operation === "blood-edit") { bloodValue = 79; await writeBloodFixture(vault, 2); }
        else await reviseSleepFixture(await import("@murphai/core"), vault, 90);
        mutationMs += performance.now() - start;
        continue;
      }
      counts = zeroCounts();
      const start = performance.now();
      const cpuStart = process.cpuUsage();
      const timing = await import("@murphai/runtime-state/node/cli-timing");
      services ??= (await import("@murphai/vault-usecases/vault-services")).createIntegratedVaultServices();
      const service = services;
      let report: CliTiming | undefined;
      let value: unknown;
      let replicaBuildMs: number | undefined;
      let replicaBuildCpuMs: number | undefined;
      let replicaBuildCalls: Counts | undefined;
      await timing.withCliTiming(() => timing.timeCliDispatch(`benchmark ${operation}`, async () => {
        if (globalOperation(operation)) {
          const query = await import("@murphai/query");
          // Global first is essential: the existing composite proof starts with
          // activity, which is now focused. Count all subsequent proof reads.
          const entities = await query.listCanonicalEntities(vault, { limit: null });
          const events = entities.filter(entity => entity.family === "event");
          // Dense observations feed wearables/metrics, not query_entities.
          assert.equal(events.length, 360 + Number(scenario.includes("blood")));
          assert.equal(events.filter(entity => entity.kind === "sleep_session").length, 270);
          assert.equal(events.filter(entity => entity.kind === "note").length, 90);
          value = { entities, ...await readGlobalProof(service, query, vault, 90) };
        } else if (operation === "blood") {
          const query = await import("@murphai/query");
          const records = await query.listBloodTests(vault, { text: "ApoB", limit: 1 });
          assert.equal(records.length, 1);
          assert.equal(records[0]?.id, "evt_synthetic_blood_panel");
          assert.deepEqual(records[0]?.data.results, [{ analyte: "ApoB", value: bloodValue, unit: "mg/dL" }]);
          value = records;
        } else if (operation === "replica-default" || operation === "replica-raw") {
          const query = await import("@murphai/query");
          const replica = await import("@murphai/query/browser-replica-server");
          const { isDefaultProjectedQueryEntity } = await import("@murphai/query/query-visibility");
          const raw = await query.readVaultRawTolerant(vault);
          assert.equal(raw.entities.filter(entity => entity.kind === "observation").length, 2160);
          const input = { vault: operation === "replica-raw" ? raw : query.createVaultReadModel({ ...raw,
            entities: raw.entities.filter(isDefaultProjectedQueryEntity) }),
            metricPoints: query.buildMetricProjection(raw).metricPoints,
            generatedAt: sleepNow, sourceBundleHash: "a".repeat(64) };
          const before = JSON.stringify(input);
          const callsBefore = { ...counts };
          const buildStart = performance.now(); const buildCpu = process.cpuUsage();
          const result = await replica.createBrowserVaultReplica(input);
          replicaBuildMs = performance.now() - buildStart;
          const used = process.cpuUsage(buildCpu); replicaBuildCpuMs = (used.user + used.system) / 1000;
          replicaBuildCalls = { ...counts };
          for (const key of Object.keys(counts) as Array<keyof Counts>) replicaBuildCalls[key] -= callsBefore[key];
          assert.equal(JSON.stringify(input), before, "Replica consumers must not mutate shared input");
          assert.match(result.source.dataVersion, /^[a-f0-9]{64}$/u);
          assert.ok(result.sourceHealthRows.length > 0 && result.entities.length > 0);
          value = result;
        } else if (operation === "setup-sleep") {
          value = await readSleepProof(service, vault, 90, 410);
        } else {
          const result = await readOrdinary(service, vault, operation, { providers: ["oura"], from: sleepDate(83), to: sleepDate(89) });
          if ("items" in result) assert.equal(result.count, 7, "Missing rows are not a speedup");
          else assert.ok(result.summary, "Missing facts are not a speedup");
          value = result;
        }
      }), result => { report = result; });
      const used = process.cpuUsage(cpuStart);
      const wallMs = performance.now() - start;
      assert.ok(report);
      assert.equal(report.droppedCalls + report.droppedSpans, 0);
      assert.equal(report.transportTruncated, false);
      const observed = { ...counts };
      steps.push({ operation, wallMs, cpuMs: (used.user + used.system) / 1000,
        ...fingerprint(value), phases: report.commands.flatMap(command => command.phases),
        commandCalls: report.commands.reduce((sum, command) => sum + command.calls, 0),
        ...(probe ? { stringifyCalls: observed } : {}),
        ...(replicaBuildMs === undefined ? {} : { replicaBuildMs, replicaBuildCpuMs,
          ...(probe ? { replicaBuildCalls } : {}) }) });
    }
    return { scenario, probe, steps, mutationMs, workflowMs: performance.now() - workflowStart,
      workMs: mutationMs + steps.reduce((sum, step) => sum + step.wallMs, 0) };
  } finally { JSON.stringify = stringify; mock.timers.reset(); }
}
export type Trial = Awaited<ReturnType<typeof runTrial>>;

function validateStepEvidence(step: Trial["steps"][number], browser: boolean) {
  assert.ok(Number.isFinite(step.wallMs) && step.wallMs > 0 && Number.isFinite(step.cpuMs) && step.cpuMs >= 0);
  assert.equal(step.commandCalls, 1);
  assert.ok(step.bytes > 2);
  assert.deepEqual(fingerprint(JSON.parse(step.json)), { json: step.json, bytes: step.bytes, sha256: step.sha256 });
  if (browser) {
    assert.ok(typeof step.replicaBuildMs === "number" && step.replicaBuildMs > 0 && step.replicaBuildMs <= step.wallMs);
    assert.ok(typeof step.replicaBuildCpuMs === "number" && step.replicaBuildCpuMs >= 0);
  }
}

function validateStepPhases(step: Trial["steps"][number], scenario: Scenario, mode: Mode,
  { browser, wearableFresh, globalFresh }: { browser: boolean; wearableFresh: boolean; globalFresh: boolean }) {
  const { operation } = step;
  const eventOnly = operation === "blood" && mode === "additions";
  const full = globalOperation(operation) || operation === "blood" && !eventOnly || mode === "full" && operation !== "setup-sleep";
  const rebuild: boolean = !browser && !eventOnly && (full ? !globalFresh : !wearableFresh);
  const expected: Record<string, boolean> = { "query-rebuild": rebuild, "query-source-read": rebuild || eventOnly && !globalFresh, "query-wearable-dataset": rebuild,
    "query-metric-projection": full && rebuild, "query-wearable-summary": rebuild && !wearableFresh,
    "query-search-documents": full && rebuild, "query-publication": rebuild };
  for (const [phase, present] of Object.entries(expected)) {
    assert.equal(step.phases.filter(item => item.phase === phase).reduce((sum, item) => sum + item.count, 0),
      Number(present), `${scenario}/${operation}/${phase}`);
  }
  return { full, rebuild };
}

function validateStepStringify(step: Trial["steps"][number], probe: boolean) {
  assert.equal(Boolean(step.stringifyCalls), probe);
  if (step.stringifyCalls) {
    const calls = step.stringifyCalls;
    assert.ok(Object.values(calls).every(value => Number.isSafeInteger(value) && value >= 0));
    assert.ok(calls.emptyMetric <= calls.metric && calls.metric <= calls.total && calls.replacer <= calls.total && calls.metricIdentity <= calls.total);
  }
}

export function validateTrial(result: Trial, scenario: Scenario, mode: Mode) {
  assert.equal(result.scenario, scenario);
  assert.deepEqual(result.steps.map(step => step.operation), scenarios[scenario].filter(operation => operation !== "edit" && operation !== "blood-edit"));
  assert.equal(result.workMs, result.mutationMs + result.steps.reduce((sum, step) => sum + step.wallMs, 0));
  assert.ok(Number.isFinite(result.workflowMs) && result.workflowMs >= result.workMs);
  let wearableFresh = false; let globalFresh = false; let index = 0;
  for (const operation of scenarios[scenario]) {
    if (operation === "edit" || operation === "blood-edit") { wearableFresh = false; globalFresh = false; continue; }
    const step = result.steps[index++]!;
    const browser = operation === "replica-default" || operation === "replica-raw";
    validateStepEvidence(step, browser);
    const { full, rebuild } = validateStepPhases(step, scenario, mode, { browser, wearableFresh, globalFresh });
    validateStepStringify(step, result.probe);
    if (rebuild) { wearableFresh = true; if (full) globalFresh = true; }
  }
  return result.steps.map(({ operation, json, bytes, sha256 }) => ({ operation, json, bytes, sha256 }));
}
export function distribution(values: number[]) {
  assert.ok(values.length === 7 && values.every(Number.isFinite));
  const sorted = [...values].sort((left, right) => left - right);
  return { samples: values, min: sorted[0], median: sorted[3], max: sorted[6] };
}

async function pairs(base: string, head: string, mode: PairMode, probe: boolean) {
  const additions = mode === "additions" || mode === "additions-control";
  const baseMode: Mode = additions ? "focused" : "full";
  const headMode: Mode = mode === "additions-control" ? "focused" : mode;
  const execute = promisify(execFile);
  const checkouts = { base: path.resolve(base), head: path.resolve(head) };
  const sourceHashes: Record<string, string> = {};
  for (const file of ["global-projection.ts", "wearable-sleep-fixture.ts"]) {
    const hashes = await Promise.all(Object.values(checkouts).map(async checkout => createHash("sha256")
      .update(await readFile(path.join(checkout, "packages/vault-usecases/bench", file))).digest("hex")));
    assert.equal(hashes[0], hashes[1], `Different harness: ${file}`);
    sourceHashes[file] = hashes[0]!;
  }
  const root = await mkdtemp(path.join(tmpdir(), "murph-global-pairs-"));
  const template = path.join(root, "template"); const bloodTemplate = path.join(root, "blood-template"); const vault = path.join(root, "vault");
  const worker = (label: keyof typeof checkouts) => path.join(checkouts[label], "packages/vault-usecases/bench/global-projection.ts");
  const options = { maxBuffer: 64 * 1024 * 1024, timeout: 180_000,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TZ: "UTC", NODE_NO_WARNINGS: "1" } };
  try {
    await execute(process.execPath, [worker("base"), "seed", template], options);
    if (additions) {
      await cp(template, bloodTemplate, { recursive: true, preserveTimestamps: true });
      await execute(process.execPath, [worker("base"), "blood-seed", bloodTemplate], options);
    }
    console.log(JSON.stringify({ benchmark: "global-projection", node: process.version, sourceHashes, probe,
      complete: false, warmupPairs: 2, measuredPairs: 7,
      fixture: { days: 90, providers: 3, observations: 2160, sessions: 270, notes: 90 } }));
    const summaries = [];
    const selected = (Object.keys(scenarios) as Scenario[]).filter(scenario => additions
      ? scenario.includes("blood") || scenario.startsWith("browser") || scenario === "global-cold" || scenario === "global-edit"
      : !scenario.includes("blood") && !scenario.startsWith("browser"));
    for (const scenario of selected) {
      const samples: Record<"base" | "head", Array<Trial & { processWallMs: number }>> = { base: [], head: [] };
      let expected: ReturnType<typeof validateTrial> | undefined;
      for (let pair = 0; pair < 9; pair++) {
        const order = pair % 2 ? ["head", "base"] as const : ["base", "head"] as const;
        for (const label of order) {
          await rm(vault, { recursive: true, force: true });
          await cp(scenario.includes("blood") ? bloodTemplate : template, vault, { recursive: true, preserveTimestamps: true });
          const start = performance.now();
          const { stdout } = await execute(process.execPath, [worker(label), "trial", vault, scenario, ...(probe ? ["probe"] : [])], options);
          const result: Trial & { processWallMs: number } = { ...JSON.parse(stdout), processWallMs: performance.now() - start };
          assert.equal(result.probe, probe);
          const signature = validateTrial(result, scenario, label === "base" ? baseMode : headMode);
          expected ??= signature;
          assert.ok(JSON.stringify(signature) === JSON.stringify(expected), `Complete bytes changed: ${scenario}/${label}/${pair}`);
          console.log(JSON.stringify({ label, pair, warmup: pair < 2, ...result,
            steps: result.steps.map(({ json, ...step }) => step) }));
          if (pair >= 2) samples[label].push(result);
        }
      }
      const fields = ["workMs", "workflowMs", "mutationMs", "processWallMs"] as const;
      summaries.push({ scenario, timings: fields.map(field => ({ field,
        base: distribution(samples.base.map(row => row[field])), head: distribution(samples.head.map(row => row[field])),
        pairedDeltaMs: distribution(samples.head.map((row, index) => row[field] - samples.base[index]![field])) })),
        steps: samples.base[0]!.steps.map((step, index) => {
          const compare = (value: (step: Trial["steps"][number]) => number) => ({
            base: distribution(samples.base.map(row => value(row.steps[index]!))),
            head: distribution(samples.head.map(row => value(row.steps[index]!))),
          });
          const phases = [...new Set([...step.phases, ...samples.head[0]!.steps[index]!.phases].map(row => row.phase))];
          return { operation: step.operation, wallMs: compare(row => row.wallMs), cpuMs: compare(row => row.cpuMs),
            ...(step.replicaBuildMs === undefined ? {} : { replicaBuildMs: compare(row => row.replicaBuildMs!),
              replicaBuildCpuMs: compare(row => row.replicaBuildCpuMs!),
              ...(probe ? { replicaBuildCalls: Object.keys(zeroCounts()).map(key => ({ key,
                ...compare(row => row.replicaBuildCalls![key as keyof Counts]) })) } : {}) }),
            phases: phases.map(phase => ({ phase, sumUs: compare(row => row.phases.filter(item => item.phase === phase)
              .reduce((sum, item) => sum + item.sumUs, 0)) })),
            ...(probe ? { stringifyCalls: Object.keys(zeroCounts()).map(key => ({ key,
              ...compare(row => row.stringifyCalls![key as keyof Counts]) })) } : {}),
          };
        }) });
    }
    console.log(JSON.stringify({ complete: true, syntheticOnly: true, performanceTimings: !probe, summaries }));
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function writeBloodFixture(vault: string, revision: number) {
  const core = await import("@murphai/core");
  await core.withCanonicalWriteLock(vault, () => appendFile(path.join(vault, "ledger/events/2026/2026-03.jsonl"), JSON.stringify({
    schemaVersion: "murph.event.v1", id: "evt_synthetic_blood_panel", kind: "test", source: "manual",
    title: "Synthetic blood panel", testName: "synthetic-panel", testCategory: "blood", specimenType: "serum",
    occurredAt: "2026-03-31T08:00:00Z", recordedAt: sleepNow, lifecycle: { revision },
    results: [{ analyte: "ApoB", value: revision === 1 ? 87 : 79, unit: "mg/dL" }],
  }) + "\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  assert.ok(major! > 24 || major === 24 && (minor! > 14 || minor === 14 && patch! >= 1), "Use Node >=24.14.1");
  const [command, first, second, third, fourth, ...extra] = process.argv.slice(2);
  assert.ok(first && extra.length === 0);
  if (command === "seed") {
    assert.ok(!second && !third && !fourth);
    await seedSleepFixture(await import("@murphai/core"), first);
  } else if (command === "blood-seed") {
    assert.ok(!second && !third && !fourth);
    await writeBloodFixture(first, 1);
  } else if (command === "trial") {
    assert.ok(second && Object.hasOwn(scenarios, second) && (!third || third === "probe") && !fourth);
    console.log(JSON.stringify(await runTrial(first, second as Scenario, third === "probe")));
  } else {
    assert.ok(command === "pairs" && second && (third === "full" || third === "focused" || third === "additions" || third === "additions-control") && (!fourth || fourth === "probe"),
      "Usage: node global-projection.ts pairs BASE CANDIDATE full|focused|additions|additions-control [probe]");
    await pairs(first, second, third, fourth === "probe");
  }
}
