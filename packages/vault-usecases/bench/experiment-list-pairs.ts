import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { experimentScenarios, type ExperimentScenario, type runExperimentTrial } from "./experiment-list.ts";

const execute = promisify(execFile);
type Label = "base" | "head";
type Mode = "full" | "focused";
type Trial = Awaited<ReturnType<typeof runExperimentTrial>> & { processWallMs: number };
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const scenarios = Object.keys(experimentScenarios) as ExperimentScenario[];
function distribution(values: number[]) {
  assert.ok(values.length === 7 && values.every(value => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values, min: sorted[0], median: sorted[3], max: sorted.at(-1) };
}

export function validateTrial(result: Trial, scenario: ExperimentScenario, mode: Mode) {
  assert.equal(result.scenario, scenario);
  assert.deepEqual(result.steps.map(step => step.operation), experimentScenarios[scenario].filter(op => op !== "edit"));
  assert.equal(result.bytes, result.steps.reduce((sum, step) => sum + step.bytes, 0));
  assert.equal(result.wallMs, result.mutationMs + result.steps.reduce((sum, step) => sum + step.wallMs, 0));
  assert.equal(result.readWallMs, result.steps.filter(step => !step.setup).reduce((sum, step) => sum + step.wallMs, 0));
  let fresh = false;
  let index = 0;
  for (const operation of experimentScenarios[scenario]) {
    if (operation === "edit") { fresh = false; continue; }
    const step = result.steps[index++]!;
    assert.deepEqual(fingerprintBytes(step.json), { sha256: step.sha256, bytes: step.bytes });
    assert.equal(step.setup, operation === "setup-global");
    assert.ok(step.bytes > 2 && step.wallMs > 0 && step.cpuMs >= 0);
    assert.equal(step.commandCalls, 1);
    const count = (name: string) => step.phases.filter(phase => phase.phase === name).reduce((sum, phase) => sum + phase.count, 0);
    const full = mode === "full" || operation !== "list";
    for (const phase of ["query-rebuild", "query-source-read", "query-wearable-dataset", "query-metric-projection",
      "query-wearable-summary", "query-search-documents", "query-publication"]) {
      assert.equal(count(phase), Number(full && !fresh), `${scenario}/${operation}/${phase}`);
    }
    if (full) fresh = true;
  }
  // Compare complete serialized envelopes, not normalized paths or selected fields.
  return result.steps.map(({ operation, setup, json, bytes, sha256 }) => ({ operation, setup, json, bytes, sha256 }));
}
function fingerprintBytes(json: string) { return { sha256: sha256(json), bytes: Buffer.byteLength(json) }; }

async function runPairs(invoke: (label: Label, scenario: ExperimentScenario) => Promise<Trial>, mode: Mode) {
  const measured: Array<Trial & { label: Label; pair: number }> = [];
  const expected = new Map<ExperimentScenario, ReturnType<typeof validateTrial>>();
  for (let pair = 0; pair < 9; pair++) {
    for (const scenario of scenarios) {
      const order: Label[] = pair % 2 ? ["head", "base"] : ["base", "head"];
      for (const label of order) {
        const result = await invoke(label, scenario);
        const signature = validateTrial(result, scenario, label === "base" ? "full" : mode);
        if (!expected.has(scenario)) expected.set(scenario, signature);
        assert.ok(JSON.stringify(signature) === JSON.stringify(expected.get(scenario)), `Complete envelope changed: ${scenario}/${label}/${pair}`);
        console.log(JSON.stringify({ label, pair, warmup: pair < 2, ...result,
          steps: result.steps.map(({ json, ...step }) => step) }));
        if (pair >= 2) measured.push({ label, pair, ...result });
      }
    }
  }
  return scenarios.map(scenario => {
    const rows = (label: Label) => measured.filter(row => row.scenario === scenario && row.label === label);
    const base = rows("base"); const head = rows("head");
    const fields = ["wallMs", "readWallMs", "mutationMs", "processWallMs"] as const;
    return { scenario, pairs: 7, bytes: base[0]!.bytes,
      timings: fields.map(field => ({ field, base: distribution(base.map(row => row[field])), head: distribution(head.map(row => row[field])) })),
      pairedWallRatios: distribution(head.map((row, index) => row.wallMs / base[index]!.wallMs)),
      steps: base[0]!.steps.map((step, index) => ({ operation: step.operation,
        base: distribution(base.map(row => row.steps[index]!.wallMs)), head: distribution(head.map(row => row.steps[index]!.wallMs)) })),
    };
  });
}

async function main() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  assert.ok(major! > 24 || major === 24 && (minor! > 14 || minor === 14 && patch! >= 1), "Use Node >=24.14.1");
  const [base, head, mode, ...extra] = process.argv.slice(2);
  assert.ok(base && head && !extra.length && (mode === "full" || mode === "focused"),
    "Usage: node experiment-list-pairs.ts BASE_CHECKOUT CANDIDATE_CHECKOUT full|focused");
  const checkouts = { base: path.resolve(base), head: path.resolve(head) };
  const sources = ["experiment-list.ts", "experiment-list-pairs.ts", "experiment-list-fixture.ts", "wearable-sleep-fixture.ts"];
  const sourceHashes: Record<string, string> = {};
  for (const file of sources) {
    const hashes = await Promise.all(Object.values(checkouts).map(async checkout =>
      sha256(await readFile(path.join(checkout, "packages/vault-usecases/bench", file)))));
    assert.equal(hashes[0], hashes[1], `Harness differs: ${file}`);
    sourceHashes[file] = hashes[0]!;
  }
  const root = await mkdtemp(path.join(tmpdir(), "murph-experiment-pairs-"));
  const template = path.join(root, "template"); const vault = path.join(root, "vault");
  const worker = (label: Label) => path.join(checkouts[label], "packages/vault-usecases/bench/experiment-list.ts");
  const options = { maxBuffer: 32 * 1024 * 1024, timeout: 180_000,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TZ: "UTC", NODE_NO_WARNINGS: "1" } };
  try {
    await execute(process.execPath, [worker("base"), "seed", template], options);
    console.log(JSON.stringify({ benchmark: "experiment-list", complete: false, node: process.version, sourceHashes,
      scenarioIsolation: "process", warmupPairs: 2, measuredPairs: 7,
      fixture: { days: 30, providers: 3, observations: 720, sessions: 90, notes: 30, experiments: 12, historyRows: 3 } }));
    const summary = await runPairs(async (label, scenario) => {
      // Reset canonical edits, receipts and projection state at the SAME path.
      await rm(vault, { recursive: true, force: true });
      await cp(template, vault, { recursive: true, preserveTimestamps: true });
      const start = performance.now();
      const { stdout } = await execute(process.execPath, [worker(label), "trial", vault, scenario], options);
      return { ...JSON.parse(stdout), processWallMs: performance.now() - start };
    }, mode);
    console.log(JSON.stringify({ summary, complete: true, syntheticOnly: true, productionSpeedupClaim: false }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
