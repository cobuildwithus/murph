import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprint } from "./wearable-sleep-fixture.ts";
import {
  sleepScenarios, summarizeSleepPairs, validateSleepPair, validateSleepWorker,
  type SleepMode, type SleepPair, type SleepScenario, type SleepWorkerResult,
} from "./wearable-sleep.ts";

// Validator fixtures only, never performance evidence. No workspace runtime,
// provider, subprocess, wall-clock comparison or source-loader substitution.
const full = { "query-source-read": 1, "query-wearable-dataset": 1, "query-metric-projection": 1,
  "query-wearable-summary": 1, "query-search-documents": 1, "query-publication": 1 };
const focused = { "query-source-read": 1, "query-wearable-dataset": 1, "query-wearable-summary": 1, "query-publication": 1 };
const promotion = { ...full, "query-wearable-summary": 0 };
function result(scenario: SleepScenario, mode: SleepMode, ms = 10): SleepWorkerResult {
  const phases = mode === "full" ? {
    cold: [full], repeated: [full, {}, {}, {}], "fresh-global": [full, {}],
    stale: [full, full, {}], "sleep-global": [full, {}, {}, {}], "global-sleep": [full, {}, {}, {}],
  } : {
    cold: [focused], repeated: [focused, {}, {}, {}], "fresh-global": [full, {}],
    stale: [focused, focused, promotion], "sleep-global": [focused, promotion, {}, {}], "global-sleep": [full, {}, {}, {}],
  };
  return {
    scenario, node: "synthetic-validator", fixture: {
      days: 90, providers: 3, observations: 2160, sessions: 270, notes: 90, eventLedgers: 3, sourceSha256: "a".repeat(64),
    }, startupToWorkerMs: 1, publicImportMs: 1, fixtureMs: 1, mutationMs: 0,
    workflowMs: ms * phases[scenario].length, cleanupMs: 1, processMs: ms * phases[scenario].length + 4,
    samples: sleepScenarios[scenario].filter(stage => stage !== "mutation").map((stage, index) => ({
      stage, ms, cpuMs: 1, ...fingerprint({ syntheticValidatorPayload: stage }), phases: { ...phases[scenario][index] },
    })),
  };
}
function pair(scenario: SleepScenario, index = 0, mode: SleepMode = "focused"): SleepPair {
  return { scenario, index, warmup: index < 2, first: index % 2 ? "after" : "before",
    before: result(scenario, "full", 10 + index), after: result(scenario, mode, 8 + index) };
}
function completePairs() {
  return (Object.keys(sleepScenarios) as SleepScenario[]).flatMap(scenario => Array.from({ length: 9 }, (_, index) => pair(scenario, index)));
}

test("all six full/full controls and full/focused workflows satisfy the mechanism contract", () => {
  for (const scenario of Object.keys(sleepScenarios) as SleepScenario[]) {
    validateSleepPair(pair(scenario, 0, "full"), "full");
    validateSleepPair(pair(scenario), "focused");
  }
});
test("missing, duplicated, reordered or non-alternating measured pairs fail closed", () => {
  assert.throws(() => summarizeSleepPairs(completePairs().slice(1)));
  for (const mutate of [
    (pairs: SleepPair[]) => { pairs[3] = pairs[2]!; },
    (pairs: SleepPair[]) => { pairs[2]!.warmup = true; },
    (pairs: SleepPair[]) => { pairs[3]!.first = "before"; },
  ]) {
    const pairs = completePairs(); mutate(pairs);
    assert.throws(() => summarizeSleepPairs(pairs));
  }
});
test("removed global phases and later promotion/reuse are required, not inferred from speed", () => {
  const cold = result("cold", "focused");
  cold.samples[0]!.phases["query-metric-projection"] = 1;
  assert.throws(() => validateSleepWorker(cold, "cold", "focused"));
  const mixed = result("sleep-global", "focused");
  mixed.samples[1]!.phases["query-search-documents"] = 0;
  assert.throws(() => validateSleepWorker(mixed, "sleep-global", "focused"));
  mixed.samples[1]!.phases = { ...full };
  assert.throws(() => validateSleepWorker(mixed, "sleep-global", "focused"));
});
test("equal byte lengths with different complete output still fail parity", () => {
  const changed = pair("cold");
  Object.assign(changed.after.samples[0]!, fingerprint({ syntheticValidatorPayload: "SLEEP" }));
  assert.equal(changed.before.samples[0]!.bytes, changed.after.samples[0]!.bytes);
  assert.throws(() => validateSleepPair(changed, "focused"));
});
test("missing results, invalid hashes and impossible timing intervals fail validation", () => {
  for (const mutate of [
    (value: SleepWorkerResult) => { value.samples = []; },
    (value: SleepWorkerResult) => { value.samples[0]!.sha256 = "0".repeat(64); },
    (value: SleepWorkerResult) => { Object.assign(value.samples[0]!, fingerprint([])); },
    (value: SleepWorkerResult) => { value.samples[0]!.ms = NaN; },
    (value: SleepWorkerResult) => { value.publicImportMs = NaN; },
    (value: SleepWorkerResult) => { value.fixture.observations = 0; },
  ]) {
    const value = result("cold", "focused"); mutate(value);
    assert.throws(() => validateSleepWorker(value, "cold", "focused"));
  }
});
test("summaries retain seven samples, ranges, medians and signed paired/cumulative costs", () => {
  const summary = summarizeSleepPairs(completePairs());
  const repeated = summary.find(item => item.scenario === "repeated")!;
  const first = repeated.timings.find(item => item.label === "sleep")!;
  assert.deepEqual(first.before, { samples: [12, 13, 14, 15, 16, 17, 18], min: 12, max: 18, median: 15 });
  assert.deepEqual(first.pairedDeltaMs, { samples: [-2, -2, -2, -2, -2, -2, -2], min: -2, max: -2, median: -2 });
  assert.equal(first.candidateWins, 7);
  for (let count = 1; count <= 3; count += 1) {
    const cumulative = repeated.timings.find(item => item.label === `cold-plus-${count}-repeats`)!;
    assert.equal(cumulative.before.median, 15 * (count + 1));
    assert.equal(cumulative.pairedDeltaMs.median, -2 * (count + 1));
  }
  const mixed = summary.find(item => item.scenario === "sleep-global")!;
  assert.equal(mixed.timings.find(item => item.label === "complete-read-workflow")!.before.median, 60);
});
