import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fingerprint, readGlobalProof, readSleepProof, reviseSleepFixture, seedSleepFixture, sleepNow, traceSleepRead,
} from "./wearable-sleep-fixture.ts";

// Keep this worker identical at base and candidate. Native Node type stripping;
// runtime imports resolve only built, public workspace package entrypoints.
export const sleepScenarios = {
  cold: ["sleep"],
  repeated: ["sleep", "sleep-repeat-1", "sleep-repeat-2", "sleep-repeat-3"],
  "fresh-global": ["setup-global", "sleep"],
  stale: ["initial-sleep", "mutation", "stale-sleep", "next-global"],
  "sleep-global": ["sleep", "global", "sleep-repeat", "global-repeat"],
  "global-sleep": ["global", "sleep", "global-repeat", "sleep-repeat"],
} as const;
export type SleepScenario = keyof typeof sleepScenarios;
export type SleepMode = "full" | "focused";
const rebuildPhases = ["query-source-read", "query-wearable-dataset", "query-metric-projection",
  "query-wearable-summary", "query-search-documents", "query-publication"] as const;
interface Sample {
  stage: string;
  ms: number;
  cpuMs: number;
  json: string;
  bytes: number;
  sha256: string;
  phases: Record<string, number>;
}
export interface SleepWorkerResult {
  scenario: SleepScenario;
  node: string;
  fixture: Awaited<ReturnType<typeof seedSleepFixture>>;
  startupToWorkerMs: number;
  publicImportMs: number;
  fixtureMs: number;
  mutationMs: number;
  workflowMs: number;
  cleanupMs: number;
  processMs: number;
  samples: Sample[];
}
export interface SleepPair {
  scenario: SleepScenario;
  index: number;
  warmup: boolean;
  first: "before" | "after";
  before: SleepWorkerResult;
  after: SleepWorkerResult;
}

export function validateSleepWorker(result: SleepWorkerResult, scenario: SleepScenario, mode: SleepMode) {
  assert.equal(result.scenario, scenario);
  assert.deepEqual(result.samples.map(sample => sample.stage), sleepScenarios[scenario].filter(stage => stage !== "mutation"));
  assert.equal(result.fixture.days, 90);
  assert.equal(result.fixture.observations, 2160);
  assert.equal(result.fixture.sessions, 270);
  assert.equal(result.fixture.notes, 90);
  assert.equal(result.fixture.providers, 3);
  assert.equal(result.fixture.eventLedgers, 3);
  assert.match(result.fixture.sourceSha256, /^[a-f0-9]{64}$/u);
  for (const value of [result.startupToWorkerMs, result.publicImportMs, result.fixtureMs,
    result.mutationMs, result.workflowMs, result.cleanupMs, result.processMs]) {
    assert.ok(Number.isFinite(value) && value >= 0, "Missing or invalid accounting interval");
  }
  let wearableFresh = false;
  let globalFresh = false;
  for (const stage of sleepScenarios[scenario]) {
    if (stage === "mutation") { wearableFresh = false; globalFresh = false; continue; }
    const sample = result.samples.find(item => item.stage === stage)!;
    assert.ok(sample.ms > 0 && Number.isFinite(sample.ms));
    assert.ok(sample.cpuMs >= 0 && Number.isFinite(sample.cpuMs));
    assert.ok(sample.bytes > 2 && typeof sample.json === "string");
    assert.deepEqual(fingerprint(JSON.parse(sample.json)), { json: sample.json, bytes: sample.bytes, sha256: sample.sha256 });
    const full = stage.includes("global") || mode === "full";
    const rebuild: boolean = full ? !globalFresh : !wearableFresh;
    const expected: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      rebuild, rebuild, full && rebuild, rebuild && !wearableFresh, full && rebuild, rebuild,
    ];
    for (const [index, phase] of rebuildPhases.entries()) {
      assert.equal(sample.phases[phase] ?? 0, Number(expected[index]), `${scenario}/${stage}: ${phase}`);
    }
    if (rebuild) { wearableFresh = true; if (full) globalFresh = true; }
  }
}

export function validateSleepPair(pair: SleepPair, afterMode: SleepMode) {
  validateSleepWorker(pair.before, pair.scenario, "full");
  validateSleepWorker(pair.after, pair.scenario, afterMode);
  assert.deepEqual(pair.before.fixture, pair.after.fixture);
  assert.equal(pair.before.node, pair.after.node);
  for (const [index, before] of pair.before.samples.entries()) {
    const after = pair.after.samples[index]!;
    assert.equal(after.json, before.json, `${pair.scenario}/${before.stage}: complete service/global response bytes`);
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.sha256, before.sha256);
  }
}

function distribution(values: number[]) {
  assert.ok(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { samples: values, min: sorted[0]!, max: sorted.at(-1)!,
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2 };
}

export function summarizeSleepPairs(pairs: SleepPair[]) {
  assert.equal(pairs.length, Object.keys(sleepScenarios).length * 9, "Incomplete run");
  return Object.keys(sleepScenarios).map(name => {
    const scenario = name as SleepScenario;
    const all = pairs.filter(pair => pair.scenario === scenario);
    assert.deepEqual(all.map(pair => [pair.index, pair.warmup, pair.first]), Array.from({ length: 9 }, (_, index) =>
      [index, index < 2, index % 2 ? "after" : "before"]), "Missing, duplicate or non-alternating pairs");
    const measured = all.filter(pair => !pair.warmup);
    const totals = (result: SleepWorkerResult) => result.samples.reduce((sum, sample) => sum + sample.ms, 0);
    const fields: [string, (result: SleepWorkerResult) => number][] = [
      ["complete-read-workflow", totals], ["workflow-including-mutation-and-proof", result => result.workflowMs],
      ["process-including-imports-fixture-cleanup", result => result.processMs],
      ["startup-to-worker", result => result.startupToWorkerMs], ["public-imports", result => result.publicImportMs],
      ["fixture", result => result.fixtureMs], ["canonical-mutation", result => result.mutationMs],
      ["cleanup", result => result.cleanupMs],
      ...measured[0]!.before.samples.map(sample => [sample.stage,
        (result: SleepWorkerResult) => result.samples.find(item => item.stage === sample.stage)!.ms] as [string, (result: SleepWorkerResult) => number]),
    ];
    if (scenario === "repeated") for (let count = 1; count <= 3; count += 1) {
      fields.push([`cold-plus-${count}-repeats`, result => result.samples.slice(0, count + 1).reduce((sum, sample) => sum + sample.ms, 0)]);
    }
    return { scenario, timings: fields.map(([label, value]) => {
      const before = measured.map(pair => value(pair.before));
      const after = measured.map(pair => value(pair.after));
      return { label, before: distribution(before), after: distribution(after),
        pairedDeltaMs: distribution(after.map((value, index) => value - before[index]!)),
        candidateWins: after.filter((value, index) => value < before[index]!).length };
    }) };
  });
}

async function worker(checkout: string, scenario: SleepScenario): Promise<SleepWorkerResult> {
  const startupToWorkerMs = performance.now();
  const require = createRequire(path.join(checkout, "packages/vault-usecases/package.json"));
  const startImports = performance.now();
  const servicesModule: typeof import("@murphai/vault-usecases/vault-services") =
    await import(pathToFileURL(require.resolve("@murphai/vault-usecases/vault-services")).href);
  const core: typeof import("@murphai/core") = await import(pathToFileURL(require.resolve("@murphai/core")).href);
  const query: typeof import("@murphai/query") = await import(pathToFileURL(require.resolve("@murphai/query")).href);
  const timing: typeof import("@murphai/runtime-state/node/cli-timing") =
    await import(pathToFileURL(require.resolve("@murphai/runtime-state/node/cli-timing")).href);
  const publicImportMs = performance.now() - startImports;
  const fixtureStart = performance.now();
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-bench-"));
  mock.timers.enable({ apis: ["Date"], now: Date.parse(sleepNow) });
  let result: SleepWorkerResult | undefined;
  try {
    const fixture = await seedSleepFixture(core, root);
    const service = servicesModule.createIntegratedVaultServices();
    const fixtureMs = performance.now() - fixtureStart;
    const samples: Sample[] = [];
    let mutationMs = 0;
    let expectedLatest = 450 + (fixture.days - 1) % 3 * 5;
    const startWorkflow = performance.now();
    for (const stage of sleepScenarios[scenario]) {
      const start = performance.now();
      if (stage === "mutation") {
        await reviseSleepFixture(core, root, fixture.days);
        expectedLatest = 410;
        mutationMs += performance.now() - start;
        continue;
      }
      const cpu = process.cpuUsage();
      const global = stage.includes("global");
      const read = await traceSleepRead<unknown>(timing, global ? "wearables activity list" : "wearables sleep list", () =>
        global ? readGlobalProof(service, query, root, fixture.days) : readSleepProof(service, root, fixture.days, expectedLatest));
      const ms = performance.now() - start;
      const used = process.cpuUsage(cpu);
      samples.push({ stage, ms, cpuMs: (used.user + used.system) / 1000, ...fingerprint(read.value), phases: read.phases });
    }
    result = { scenario, node: process.version, fixture, startupToWorkerMs, publicImportMs, fixtureMs,
      mutationMs, workflowMs: performance.now() - startWorkflow, samples, cleanupMs: 0, processMs: 0 };
    return result;
  } finally {
    const start = performance.now();
    mock.timers.reset();
    await rm(root, { recursive: true, force: true });
    if (result) result.cleanupMs = performance.now() - start;
  }
}

const script = fileURLToPath(import.meta.url);
function runWorker(checkout: string, scenario: SleepScenario) {
  const start = performance.now();
  const child = spawnSync(process.execPath, [script, "--worker", checkout, scenario], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000,
    // No dotenv, provider calls, secret-dependent fixtures or source loaders.
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TZ: "UTC", NODE_NO_WARNINGS: "1" },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const result: SleepWorkerResult = JSON.parse(child.stdout);
  result.processMs = performance.now() - start;
  return result;
}

async function main() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  assert.ok(major! > 24 || (major === 24 && (minor! > 14 || (minor === 14 && patch! >= 1))), "Use Node >=24.14.1");
  const args = process.argv.slice(2);
  if (args[0] === "--worker") {
    assert.ok(args[1] && args[2] && Object.hasOwn(sleepScenarios, args[2]));
    process.stdout.write(JSON.stringify(await worker(path.resolve(args[1]), args[2] as SleepScenario)));
    return;
  }
  assert.equal(args.length, 8, "Usage: node wearable-sleep.ts --before BASE --after BASE_OR_CANDIDATE --expect-after full|focused --output RESULT.json");
  assert.deepEqual([args[0], args[2], args[4], args[6]], ["--before", "--after", "--expect-after", "--output"]);
  const beforeRoot = path.resolve(args[1]!);
  const afterRoot = path.resolve(args[3]!);
  const mode = args[5];
  assert.ok(mode === "full" || mode === "focused");
  const pairs: SleepPair[] = [];
  const output = path.resolve(args[7]!);
  const save = (complete: boolean, summary?: ReturnType<typeof summarizeSleepPairs>) => writeFile(output, JSON.stringify({
    format: "murph.sleep-benchmark.v1", complete, afterMode: mode, warmupPairs: 2, measuredPairs: 7, pairs, summary,
  }, (key, value) => key === "json" ? undefined : value, 2) + "\n");
  await save(false);
  for (const scenario of Object.keys(sleepScenarios) as SleepScenario[]) {
    for (let index = 0; index < 9; index += 1) {
      const first = index % 2 ? "after" : "before";
      const firstResult = runWorker(first === "before" ? beforeRoot : afterRoot, scenario);
      const secondResult = runWorker(first === "before" ? afterRoot : beforeRoot, scenario);
      const pair: SleepPair = { scenario, index, warmup: index < 2, first,
        before: first === "before" ? firstResult : secondResult, after: first === "after" ? firstResult : secondResult };
      validateSleepPair(pair, mode);
      pairs.push(pair);
      await save(false);
      process.stderr.write(`${scenario}: ${index < 2 ? "warmup" : "measured"} pair ${index + 1}/9 verified\n`);
    }
  }
  const summary = summarizeSleepPairs(pairs);
  await save(true, summary);
  process.stdout.write(JSON.stringify({ complete: true, summary }, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) await main();
