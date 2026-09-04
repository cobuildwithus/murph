import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareLatencyRuns, inspectLatencyWorkflow, parseLatencyRun, runContainer } from "./check-container-latency-ci.mjs";

function rows(value = 1_000) {
  return [
    ...["boot", "seed", "new"].map((scenario) => ({ scenario, cpuMs: value, wallMs: value })),
    ...["disjoint", "replay", "correction"].map((scenario) => ({ scenario })),
    { scenario: "canonical-readback", passed: true },
  ].map((row) => ["new", "disjoint", "replay", "correction"].includes(row.scenario)
    ? { ...row, semanticSha256: "a".repeat(64) } : row);
}
const encode = (input) => input.map((row) => JSON.stringify(row)).join("\n");
const samples = (...values) => values.map((value) => encode(rows(value)));

test("three same-host medians tolerate one outlier but reject repeated CPU growth", () => {
  const base = samples(1_000, 1_000, 1_000);
  assert.ok(compareLatencyRuns(base, samples(1_000, 9_000, 1_000)).every((row) => row.passed));
  assert.ok(compareLatencyRuns(base, samples(1_251, 9_000, 1_000)).some((row) => !row.passed));
  assert.throws(() => compareLatencyRuns(base.slice(1), base), /three base samples/u);
  assert.throws(() => compareLatencyRuns(base, base.slice(1)), /three candidate samples/u);
});

test("CPU and wall thresholds are inclusive and retain absolute noise floors", () => {
  for (const [base, cpuLimit, wallLimit] of [[1_000, 1_250, 1_400], [100, 200, 350]]) {
    for (const [metric, limit] of [["cpuMs", cpuLimit], ["wallMs", wallLimit]]) {
      const candidate = rows(base).map((row) => row.scenario === "seed" ? { ...row, [metric]: limit } : row);
      const compare = () => compareLatencyRuns(samples(base, base, base), Array(3).fill(encode(candidate)));
      assert.ok(compare().every((row) => row.passed));
      candidate[1][metric] += 1;
      assert.equal(compare().find((row) => row.scenario === "seed" && row.metric === metric).passed, false);
    }
  }
});

test("malformed, missing, duplicate, nonfinite and nonpositive measurements fail closed", () => {
  assert.throws(() => parseLatencyRun("invalid-json"));
  assert.throws(() => parseLatencyRun(encode([...rows(), rows()[0]])), /Duplicate/u);
  assert.throws(() => parseLatencyRun(encode(rows().slice(1))), /Missing or invalid boot/u);
  assert.throws(() => parseLatencyRun(encode(rows().slice(0, -1))), /canonical readback/u);
  for (const value of [NaN, Infinity, -1, 0, "100", null]) {
    const invalid = rows();
    invalid[0].cpuMs = value;
    assert.throws(() => parseLatencyRun(encode(invalid)), /invalid boot.cpuMs/u);
  }
  const changed = rows();
  changed[2].semanticSha256 = "b".repeat(64);
  assert.throws(() => compareLatencyRuns(samples(1_000, 1_000, 1_000), Array(3).fill(encode(changed))), /semantics changed/u);
});

test("allows structured runtime lifecycle logs without weakening required measurements", () => {
  const output = encode([...rows(), { level: "info", event: "synthetic.shutdown" }]);
  assert.equal(parseLatencyRun(output).boot.cpuMs, 1_000);
  assert.throws(() => parseLatencyRun(encode([{ level: "info", event: "synthetic.shutdown" }])), /Missing or invalid boot/u);
});

test("container success, workload failure and timeout release only the exact created ID", () => {
  for (const failure of [null, "timeout", "exit-code"]) {
    const calls = [];
    const id = "f".repeat(64);
    const run = (executable, args) => {
      assert.equal(executable, "docker");
      calls.push(args);
      if (args[0] === "create") return id;
      if (args[0] === "start" && failure === "timeout") throw new Error("synthetic timeout");
      if (args[0] === "inspect") return failure === "exit-code" ? "1" : "0";
      return "sample-output";
    };
    if (failure) assert.throws(() => runContainer("image", "/synthetic-bench", "boot.mjs", run));
    else assert.equal(runContainer("image", "/synthetic-bench", "boot.mjs", run), "sample-output");
    assert.deepEqual(calls.at(-1), ["rm", "--force", id]);
    for (const [flag, value] of [["--cpus", "1"], ["--network", "none"], ["--memory", "6g"], ["--memory-swap", "6g"]]) {
      assert.equal(calls[0][calls[0].indexOf(flag) + 1], value);
    }
  }
  const calls = [];
  assert.throws(() => runContainer("image", "/synthetic-bench", "boot.mjs", (_, args) => { calls.push(args); throw new Error("create failed"); }));
  assert.equal(calls.length, 1);
});

test("the existing required bundle job executes the comparator tests and latency gate", async () => {
  const source = await readFile(new URL("../.github/workflows/host-support.yml", import.meta.url), "utf8");
  await inspectLatencyWorkflow(source);
  await assert.rejects(inspectLatencyWorkflow(source.replace("          node candidate/scripts/check-container-latency-ci.mjs base candidate", "")));
  await assert.rejects(inspectLatencyWorkflow(source.replace("          node --test candidate/scripts/check-container-latency-ci.test.mjs", "")));
});
