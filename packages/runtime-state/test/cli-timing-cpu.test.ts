import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { test } from "vitest";
import {
  addCliPhaseSample, CLI_TIMING_CPU_PHASES, emptyCliTiming, mergeCliTiming,
  normalizeCliTiming, type CliPhaseTiming, type CliTiming,
} from "../src/cli-timing.ts";
import { startCliPhase, timeCliPhaseSync, withCliTiming } from "../src/node/cli-timing.ts";

function report(...cpuSamples: (number | undefined)[]): CliTiming {
  const phases: CliPhaseTiming[] = [];
  for (const cpu of cpuSamples) addCliPhaseSample(phases, "query-metric-extract", 10, cpu);
  return { ...emptyCliTiming(), reportCount: 1,
    commands: [{ command: "wearables day", outcome: "ok", calls: cpuSamples.length, phases }] };
}

test("CPU aggregation preserves measured coverage through old/new reports and never aliases its input", () => {
  const target = report(undefined, 200);
  const incoming = report(0, 300, undefined);
  mergeCliTiming(target, incoming);
  const phase = target.commands[0]!.phases[0]!;
  assert.equal(phase.count, 5);
  assert.deepEqual(phase.cpu, { count: 3, sumUs: 500, maxUs: 300 });
  assert.deepEqual(normalizeCliTiming(target), target);
  incoming.commands[0]!.phases[0]!.cpu!.sumUs = 999;
  assert.equal(phase.cpu?.sumUs, 500);
  const copy = emptyCliTiming();
  mergeCliTiming(copy, target);
  phase.cpu!.sumUs = 777;
  assert.equal(copy.commands[0]!.phases[0]!.cpu?.sumUs, 500);
});

test("invalid, private or overflowing optional CPU metadata preserves wall samples", () => {
  for (const cpu of [null, "PRIVATE_SENTINEL", { count: 0, sumUs: 0, maxUs: 0 },
    { count: 2, sumUs: 2, maxUs: 1 }, { count: 1, sumUs: 2, maxUs: 1 },
    { count: 1, sumUs: -1, maxUs: 0 }, { count: 1, sumUs: Infinity, maxUs: Infinity },
    { count: 1, sumUs: 1.5, maxUs: 1.5 },
    { get count() { throw Error("PRIVATE_SENTINEL"); } },
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error("PRIVATE_SENTINEL"); } }),
  ]) {
    const input = report(undefined);
    Object.assign(input.commands[0]!.phases[0]!, { cpu });
    assert.deepEqual(normalizeCliTiming(input), report(undefined));
  }
  const trapped = report(undefined);
  trapped.commands[0]!.phases[0] = new Proxy(trapped.commands[0]!.phases[0]!, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "cpu") throw new Error("PRIVATE_SENTINEL");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(normalizeCliTiming(trapped), report(undefined));
  const extra = report(20);
  Object.assign(extra.commands[0]!.phases[0]!.cpu!, { private: "PRIVATE_SENTINEL" });
  assert.deepEqual(normalizeCliTiming(extra), report(20));
  const target = report(Number.MAX_SAFE_INTEGER);
  mergeCliTiming(target, report(1));
  assert.equal(target.commands[0]!.phases[0]!.count, 2);
  assert.equal(target.commands[0]!.phases[0]!.cpu, undefined);
  assert.deepEqual(normalizeCliTiming(target), target);
  const phases: CliPhaseTiming[] = [];
  addCliPhaseSample(phases, "query-metric-extract", 10, Number.MAX_SAFE_INTEGER);
  addCliPhaseSample(phases, "query-metric-extract", 10, 1);
  assert.equal(phases[0]!.cpu, undefined);
  addCliPhaseSample(phases, "query-source-read", 10, 20);
  assert.equal(phases[1]!.cpu, undefined);
});

test("only active synchronous metric spans sample process CPU; nested samples are inclusive and end once", async () => {
  const originalCpu = process.cpuUsage;
  const originalClock = process.hrtime.bigint;
  let cpu = 0;
  let wall = 0n;
  let reads = 0;
  process.hrtime.bigint = () => wall;
  process.cpuUsage = (previous) => { reads += 1; return { user: cpu - (previous?.user ?? 0), system: 0 }; };
  try {
    startCliPhase("query-metric-projection")();
    assert.equal(reads, 0);
    let captured!: CliTiming;
    await withCliTiming(async () => {
      startCliPhase("query-source-read")();
      assert.equal(reads, 0);
      const outer = startCliPhase("query-metric-projection");
      cpu = 100;
      const inner = startCliPhase("query-metric-extract");
      cpu = 300;
      wall = 10_000n;
      inner(); inner();
      outer(); outer();
    }, value => { captured = value; });
    const phases = captured.commands[0]!.phases;
    assert.deepEqual(phases.find(p => p.phase === "query-metric-projection")?.cpu,
      { count: 1, sumUs: 300, maxUs: 300 });
    assert.deepEqual(phases.find(p => p.phase === "query-metric-extract")?.cpu,
      { count: 1, sumUs: 200, maxUs: 200 });
    assert.equal(reads, 4);
    assert.deepEqual(normalizeCliTiming(captured), captured);
  } finally { process.cpuUsage = originalCpu; process.hrtime.bigint = originalClock; }
});

test("unavailable CPU snapshots do not change return values, throws or existing wall diagnostics", async () => {
  const originalCpu = process.cpuUsage;
  const value = { synthetic: true };
  const failure = new Error("synthetic failure");
  try {
    let reads = 0;
    // First span starts successfully but its ending sample fails. The second
    // span cannot start a CPU sample. Neither condition may affect the command.
    process.cpuUsage = () => {
      reads += 1;
      if (reads === 1) return { user: 0, system: 0 };
      throw new Error("synthetic CPU unavailable");
    };
    let captured!: CliTiming;
    await assert.rejects(withCliTiming(async () => {
      assert.equal(timeCliPhaseSync("query-metric-evidence", () => value), value);
      timeCliPhaseSync("query-metric-targets", () => { throw failure; });
    }, timing => { captured = timing; }), error => error === failure);
    assert.equal(captured.commands[0]!.outcome, "error");
    const phases = captured.commands[0]!.phases.filter(p => CLI_TIMING_CPU_PHASES.includes(p.phase));
    assert.equal(phases.length, 2);
    assert.ok(phases.every(p => p.count === 1 && p.cpu === undefined));
  } finally { process.cpuUsage = originalCpu; }
});

const compatibilityBase = process.env.MURPH_CLI_CPU_COMPAT_BASE;
test.skipIf(!compatibilityBase)("actual previous reader drops only CPU metadata and new reader accepts legacy reports", async () => {
  assert.match(compatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${compatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  assert.deepEqual(old.normalizeCliTiming(report(200)), report(undefined));
  assert.deepEqual(normalizeCliTiming(report(undefined)), report(undefined));
});
