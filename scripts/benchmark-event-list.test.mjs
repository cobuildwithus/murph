import assert from "node:assert/strict";
import { test } from "node:test";
import { runEventListPairs } from "./benchmark-event-list.mjs";

// Driver protocol proof only. These invented timings are NOT benchmark evidence.
function report(label, scenario) {
  return {
    scenario, wallMs: label === "base" ? 10 : 5, cpuMs: label === "base" ? 8 : 4,
    readWallMs: label === "base" ? 6 : 3, readCpuMs: label === "base" ? 4 : 2,
    steps: [{ operation: "event", setup: false, hash: "a".repeat(64), bytes: 100, count: 1 }],
  };
}

for (const field of ["hash", "bytes", "count"]) {
  test(`a ${field} mismatch fails before a performance summary`, async () => {
    await assert.rejects(runEventListPairs(async (label, scenario) => {
      const result = report(label, scenario);
      if (label === "head") result.steps[0][field] = field === "hash" ? "b".repeat(64) : 2;
      return result;
    }, () => {}), /Full output hash\/bytes\/count changed/u);
  });
}

// A warm subtotal must not hide a mixed-sequence regression.
test("warm-read savings do not replace whole-sequence totals", async () => {
  const summary = await runEventListPairs(async (label, scenario) => {
    const result = report(label, scenario);
    if (scenario === "warm-global") {
      result.wallMs = label === "base" ? 10 : 12;
      result.readWallMs = label === "base" ? 6 : 3;
      result.steps.unshift({ operation: "global", setup: true, hash: "b".repeat(64), bytes: 200, count: 2 });
    }
    return result;
  }, () => {});
  const warm = summary.find((entry) => entry.scenario === "warm-global");
  assert.equal(warm.medianPairedWallRatio, 1.2);
  assert.equal(warm.baseMedianReadWallMs, 6);
  assert.equal(warm.headMedianReadWallMs, 3);
});

test("a late prewarming mismatch is not hidden by identical warmups", async () => {
  let calls = 0;
  await assert.rejects(runEventListPairs(async (label, scenario) => {
    const result = report(label, scenario);
    if (scenario === "warm-global") result.steps.unshift({ operation: "global", setup: true,
      hash: (++calls === 18 ? "c" : "b").repeat(64), bytes: 200, count: 2 });
    return result;
  }, () => {}), /Full output hash\/bytes\/count changed/u);
});

test("a worker cannot substitute a different scenario", async () => {
  await assert.rejects(runEventListPairs(async (label) => report(label, "warm-global"),
    () => {}), /Worker returned the wrong scenario/u);
});
