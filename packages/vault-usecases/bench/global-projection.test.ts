import assert from "node:assert/strict";
import { test } from "node:test";
import type { CliTimingPhase } from "@murphai/runtime-state/cli-timing";
import { distribution, scenarios, validateTrial, type Scenario, type Trial } from "./global-projection.ts";
import { fingerprint } from "./wearable-sleep-fixture.ts";

// Validator controls only; these are deliberately synthetic reports, never
// benchmark measurements. Real workers must supply all phases and full bytes.
function report(scenario: Scenario, mode: "full" | "focused" | "additions"): Trial {
  let wearable = false; let global = false;
  const steps: Trial["steps"] = [];
  for (const operation of scenarios[scenario]) {
    if (operation === "edit" || operation === "blood-edit") { wearable = false; global = false; continue; }
    const browser = operation.startsWith("replica-");
    const eventOnly = operation === "blood" && mode === "additions";
    const full = operation.includes("global") || operation === "blood" && !eventOnly || mode === "full" && operation !== "setup-sleep";
    const rebuild = !browser && !eventOnly && (full ? !global : !wearable);
    const phases: CliTimingPhase[] = [];
    if (rebuild) phases.push("query-rebuild", "query-source-read", "query-wearable-dataset", "query-publication");
    if (eventOnly && !global) phases.push("query-source-read");
    if (rebuild && !wearable) phases.push("query-wearable-summary");
    if (rebuild && full) phases.push("query-metric-projection", "query-search-documents");
    steps.push({ operation, wallMs: 10, cpuMs: 5, commandCalls: 1,
      ...fingerprint({ syntheticValidatorPayload: "complete" }),
      ...(browser ? { replicaBuildMs: 4, replicaBuildCpuMs: 2 } : {}),
      phases: phases.map(phase => ({ phase, count: 1, sumUs: 1, maxUs: 1, buckets: [1, 0, 0, 0, 0, 0, 0, 0] })) });
    if (rebuild) { wearable = true; if (full) global = true; }
  }
  const mutationMs = scenarios[scenario].some(operation => operation === "edit" || operation === "blood-edit") ? 1 : 0;
  const workMs = mutationMs + steps.length * 10;
  return { scenario, probe: false, steps, mutationMs, workMs, workflowMs: workMs + 1 };
}

test("all paired scenarios admit the expected full and focused work, including complete mixed costs", () => {
  for (const scenario of Object.keys(scenarios) as Scenario[]) for (const mode of ["full", "focused", "additions"] as const) {
    validateTrial(report(scenario, mode), scenario, mode);
  }
});
test("wearable freshness never excuses missing global publication or relevant-edit rebuild", () => {
  for (const scenario of ["wearable-current-global-stale", "wearable-global", "global-edit"] as const) {
    const value = report(scenario, "focused");
    const global = [...value.steps].reverse().find(step => step.operation === "global" && step.phases.length > 0)!;
    global.phases = global.phases.filter(phase => phase.phase !== "query-metric-projection");
    assert.throws(() => validateTrial(value, scenario, "focused"));
  }
});
test("missing bytes, invalid hashes, skipped reads and unaccounted time fail validation", () => {
  for (const change of [
    (value: Trial) => { value.steps = []; },
    (value: Trial) => { value.steps[0]!.sha256 = "0".repeat(64); },
    (value: Trial) => { Object.assign(value.steps[0]!, fingerprint([])); },
    (value: Trial) => { value.steps[0]!.wallMs = NaN; },
    (value: Trial) => { value.steps[0]!.commandCalls = 0; },
    (value: Trial) => { value.workMs = 0; },
    (value: Trial) => { value.workflowMs = 0; },
  ]) {
    const value = report("cold-latest", "focused"); change(value);
    assert.throws(() => validateTrial(value, "cold-latest", "focused"));
  }
});
test("probe labels and counts cannot masquerade as uninstrumented timings", () => {
  const value = report("cold-latest", "focused");
  value.probe = true;
  assert.throws(() => validateTrial(value, "cold-latest", "focused"));
  value.steps[0]!.stringifyCalls = { total: 10, replacer: 8, metric: 5, emptyMetric: 3, metricIdentity: 2 };
  validateTrial(value, "cold-latest", "focused");
  value.steps[0]!.stringifyCalls!.emptyMetric = 20;
  assert.throws(() => validateTrial(value, "cold-latest", "focused"));
});
test("variation retains all seven measurements and signed deltas", () => {
  assert.deepEqual(distribution([3, -4, 2, 0, 5, -2, 1]), { samples: [3, -4, 2, 0, 5, -2, 1], min: -4, median: 1, max: 5 });
  assert.throws(() => distribution([1, 2]));
});


test("focused blood repeats re-read canonical events and never certify global freshness", () => {
  const value = report("blood-global", "additions");
  validateTrial(value, "blood-global", "additions");
  assert.deepEqual(value.steps[0]!.phases.map(row => row.phase), ["query-source-read"]);
  assert.ok(value.steps[1]!.phases.some(row => row.phase === "query-wearable-summary"));
  value.steps[0]!.phases = [];
  assert.throws(() => validateTrial(value, "blood-global", "additions"));
});
test("replica build time is a measured subinterval, not omitted source preparation", () => {
  const value = report("browser-raw", "additions");
  validateTrial(value, "browser-raw", "additions");
  value.steps[0]!.replicaBuildMs = value.steps[0]!.wallMs + 1;
  assert.throws(() => validateTrial(value, "browser-raw", "additions"));
});
