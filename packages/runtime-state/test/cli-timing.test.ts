import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { test } from "vitest";

import {
  addCliPhaseSample, CLI_TIMING_MAX_COMMANDS, CLI_TIMING_MAX_SPANS,
  CLI_TIMING_PHASES, cliTimingCommand, cliTimingFailureCode, emptyCliTiming, mergeCliTiming,
  normalizeCliTiming, cliTimingValidationFailure, CLI_TIMING_MAX_VALIDATION_ISSUES, type CliTiming, type CliValidationDiagnostic,
  CLI_TIMING_REJECTIONS, CLI_TIMING_PARSE_REJECTIONS, CLI_TIMING_FILTER_REJECTIONS, cliTimingRejectionFailure,
  type CliCommandTiming, type CliFailureTiming, type CliTimingFilterRejection, type CliTimingParseRejection,
  cliTimingSourceCauseFailure, CLI_TIMING_MAX_FAILURES, type CliTimingSourceCause,
} from "../src/cli-timing.ts";
import {
  finishCliTimingAction, isCliTimingActive, noteCliTimingExit,
  startCliPhase, timeCliDispatch, timeCliPhase, timeCliPhaseSync, withCliTiming,
} from "../src/node/cli-timing.ts";

async function clocked(run: (advance: (us: number) => void) => Promise<void>) {
  const original = process.hrtime.bigint;
  let clock = 0n;
  process.hrtime.bigint = () => clock;
  try { await run((us) => { clock += BigInt(us) * 1_000n; }); }
  finally { process.hrtime.bigint = original; }
}
function sample(command = "goal list", us = 0): CliTiming {
  const report = emptyCliTiming();
  const phases: CliTiming["commands"][number]["phases"] = [];
  assert.equal(addCliPhaseSample(phases, "total", us), true);
  report.commands.push({ command, outcome: "ok", calls: 1, phases });
  return report;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("monotonic lifecycle and nested query spans distinguish setup, dispatch and teardown", async () => {
  await clocked(async (advance) => {
    let report!: CliTiming;
    const result = await withCliTiming(async () => {
      advance(300_000);
      await timeCliDispatch("goal list", async () => {
        const freshness = startCliPhase("query-freshness");
        await timeCliPhase("query-manifest", async () => { advance(800_000); });
        await timeCliPhase("query-status", async () => { advance(200_000); });
        freshness();
        advance(700_000); // Remaining handler work is not relabelled DB/provider time.
      });
      advance(50_000);
      finishCliTimingAction();
      const teardown = startCliPhase("teardown");
      advance(25_000);
      teardown();
      return "unchanged";
    }, (value) => { report = value; });
    assert.equal(result, "unchanged");
    const command = report.commands[0]!;
    assert.equal(command.command, "goal list");
    assert.equal(command.outcome, "ok");
    assert.deepEqual(Object.fromEntries(command.phases.map((p) => [p.phase, p.sumUs])), {
      setup: 300_000, "query-manifest": 800_000, "query-status": 200_000,
      "query-freshness": 1_000_000, dispatch: 1_700_000,
      "post-dispatch": 50_000, teardown: 25_000, total: 2_075_000,
    });
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.equal(isCliTimingActive(), false);
  });
});

test("same-command tail survives aggregation; batch parent is not a second inclusive sample", async () => {
  await clocked(async (advance) => {
    let report!: CliTiming;
    await withCliTiming(async () => {
      await timeCliDispatch("batch", async () => {
        for (const us of [5_000, 5_000_000]) {
          await withCliTiming(async () => {
            await timeCliDispatch("memory show", async () => { advance(us); });
          });
        }
      });
    }, (value) => { report = value; });
    assert.equal(report.batchContainers, 1);
    assert.equal(report.reportCount, 1);
    assert.equal(report.commands.length, 1);
    const command = report.commands[0]!;
    assert.equal(command.calls, 2);
    const dispatch = command.phases.find((p) => p.phase === "dispatch")!;
    assert.deepEqual(dispatch, { phase: "dispatch", count: 2, sumUs: 5_005_000,
      maxUs: 5_000_000, buckets: [1, 0, 0, 0, 1, 0, 0, 0] });
  });
});

test("zero is measured, missing is absent; authoritative failures stay separate", async () => {
  await clocked(async () => {
    let report!: CliTiming;
    const failure = new Error("PRIVATE_SENTINEL");
    await withCliTiming(async () => {
      await timeCliDispatch("batch", async () => {
        await withCliTiming(() => timeCliDispatch("goal list", async () => {}));
        await assert.rejects(withCliTiming(() => timeCliDispatch("goal list", async () => {
          throw failure;
        })), (error) => error === failure);
        await withCliTiming(async () => { noteCliTimingExit(2, false); });
      });
    }, (value) => { report = value; });
    assert.deepEqual(report.commands.map((c) => [c.command, c.outcome]), [
      ["goal list", "ok"], ["goal list", "error"], ["other", "error"],
    ]);
    assert.equal(report.commands[0]!.phases.find((p) => p.phase === "dispatch")!.maxUs, 0);
    assert.equal(report.commands[2]!.phases.some((p) => p.phase === "dispatch"), false);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
  });
});

test("parallel and nested invocation contexts do not contaminate one another", async () => {
  const gate = deferred();
  const entered = deferred();
  const reports: CliTiming[] = [];
  const first = withCliTiming(() => timeCliDispatch("goal list", async () => {
    const end = startCliPhase("query-rebuild");
    entered.resolve();
    await gate.promise;
    end();
  }), (report) => { reports.push(report); });
  await entered.promise;
  await withCliTiming(() => timeCliDispatch("family list", async () => {
    await timeCliPhase("query-wait", async () => {});
  }), (report) => { reports.push(report); });
  gate.resolve();
  await first;
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.map((r) => r.commands.map((c) => c.command)), [["family list"], ["goal list"]]);
  assert.equal(reports[0]!.commands[0]!.phases.some((p) => p.phase === "query-rebuild"), false);
  assert.equal(reports[1]!.commands[0]!.phases.some((p) => p.phase === "query-wait"), false);
});

test("late work and unfinished spans cannot mutate a closed collection", async () => {
  const gate = deferred();
  let pending!: Promise<void>;
  let report!: CliTiming;
  let endLate!: () => void;
  await withCliTiming(async () => {
    await timeCliDispatch("goal list", async () => {
      endLate = startCliPhase("query-manifest");
      pending = withCliTiming(() => timeCliDispatch("memory show", async () => {
        await gate.promise;
        await timeCliPhase("query-status", async () => {});
      }));
    });
  }, (value) => { report = value; });
  const before = JSON.stringify(report);
  assert.equal(report.droppedCalls, 1);
  assert.equal(report.droppedSpans, 1);
  gate.resolve();
  await pending;
  endLate();
  assert.equal(JSON.stringify(report), before);
});

test("fixed span budget is explicit; unknown command strings never escape", async () => {
  let report!: CliTiming;
  await withCliTiming(() => timeCliDispatch("goal list /PRIVATE_SENTINEL", async () => {
    for (let i = 0; i < CLI_TIMING_MAX_SPANS + 3; i += 1) startCliPhase("query-status")();
  }), (value) => { report = value; });
  assert.equal(report.commands[0]!.command, "other");
  assert.equal(report.commands[0]!.phases.find((p) => p.phase === "query-status")!.count, 63);
  assert.equal(report.droppedSpans, 4); // Dispatch consumes one of the 64 spans.
  assert.ok(report.commands[0]!.phases.length <= CLI_TIMING_PHASES.length);
  assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
});

test("missing, malformed and failing diagnostic sinks preserve values, throws and EPIPE", async () => {
  const old = process.env.MURPH_CLI_TIMING_ENDPOINT;
  try {
    for (const endpoint of [undefined, "https://PRIVATE_SENTINEL", "0:abcd"]) {
      if (endpoint === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
      else process.env.MURPH_CLI_TIMING_ENDPOINT = endpoint;
      assert.equal(await withCliTiming(async () => {
        assert.equal(isCliTimingActive(), false);
        return 17;
      }), 17);
    }
    assert.equal(await withCliTiming(async () => 23, () => { throw Error("sink unavailable"); }), 23);
    for (const error of [Object.assign(new Error("pipe"), { code: "EPIPE" }),
      Object.assign(new Error("cancelled"), { name: "AbortError" })]) {
      let report!: CliTiming;
      await assert.rejects(withCliTiming(async () => { throw error; }, (r) => { report = r; }),
        (caught) => caught === error);
      assert.equal(report.commands[0]!.outcome, "code" in error ? "unknown" : "error");
    }
  } finally {
    if (old === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
    else process.env.MURPH_CLI_TIMING_ENDPOINT = old;
  }
});

test("normalization strips extras and rejects unsafe labels, numbers, dimensions and getters", () => {
  const valid = sample();
  const extra = { ...valid, argv: ["PRIVATE_SENTINEL"], commands: valid.commands.map((c) => ({
    ...c, path: "/PRIVATE_SENTINEL", phases: c.phases.map((p) => ({ ...p, sql: "PRIVATE_SENTINEL" })),
  })) };
  assert.deepEqual(normalizeCliTiming(JSON.parse(JSON.stringify(extra))), valid);
  assert.equal(cliTimingCommand("goal list --id PRIVATE_SENTINEL"), "other");
  for (const leaf of ["report", "scaffold", "preview", "preview-view", "calculate", "calculate-bundle",
    "inputs", "model-cards", "evidence"]) {
    assert.equal(cliTimingCommand(`age ${leaf}`), "other");
  }
  for (const mutate of [
    (r: CliTiming) => { r.commands[0]!.command = "/PRIVATE_SENTINEL"; },
    (r: CliTiming) => { r.commands[0]!.calls = Number.MAX_SAFE_INTEGER + 1; },
    (r: CliTiming) => { r.commands[0]!.phases[0]!.count = -1; },
    (r: CliTiming) => { r.commands[0]!.phases[0]!.sumUs = NaN; },
    (r: CliTiming) => { r.commands[0]!.phases[0]!.maxUs = Infinity; },
    (r: CliTiming) => { r.commands[0]!.phases[0]!.buckets.push(0); },
    (r: CliTiming) => { r.commands[0]!.phases[0]!.buckets[7] = 1; },
    (r: CliTiming) => { r.commands.push(r.commands[0]!); },
    (r: CliTiming) => { r.commands[0]!.phases.push(r.commands[0]!.phases[0]!); },
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    assert.equal(normalizeCliTiming(changed), null);
  }
  assert.equal(normalizeCliTiming({ get schema() { throw Error("PRIVATE_SENTINEL"); } }), null);
  const oversized = { ...valid, commands: Array(CLI_TIMING_MAX_COMMANDS + 1).fill(valid.commands[0]) };
  assert.equal(normalizeCliTiming(oversized), null);
});

test("bounded cardinality and arithmetic overflow drop whole incoming calls, not legacy data", () => {
  const aggregate = emptyCliTiming();
  const names = ["blood-test show", "capture show", "condition show", "document show", "food show",
    "goal show", "provider list", "supplement list", "allergy list", "allergy save", "allergy show",
    "allergy scaffold", "assertion save", "assertion scaffold", "assistant ask", "assistant chat",
    "assistant status", "assistant stop", "assistant run", "audit list", "audit show", "audit tail",
    "automation list", "automation show", "batch", "blood-test list", "capture list", "condition list",
    "device connect", "document list", "exercise list", "family list", "food list", "goal list"];
  for (const name of names.filter((name) => name !== "batch")) mergeCliTiming(aggregate, sample(name));
  assert.equal(aggregate.commands.length, CLI_TIMING_MAX_COMMANDS);
  assert.equal(aggregate.droppedCalls, 1);
  assert.notEqual(normalizeCliTiming(aggregate), null);
  const huge = sample("goal list", Number.MAX_SAFE_INTEGER);
  mergeCliTiming(huge, sample("goal list", 1));
  assert.equal(huge.commands[0]!.calls, 1);
  assert.equal(huge.droppedCalls, 1);
  assert.notEqual(normalizeCliTiming(huge), null);
});

test("phase-boundary validation retains feasible histograms and rejects impossible summaries", () => {
  for (const us of [0, 249_999, 250_000, 999_999, 1_000_000, 2_500_000,
    5_000_000, 10_000_000, 30_000_000, 60_000_000, Number.MAX_SAFE_INTEGER]) {
    const report = sample("goal list", us);
    assert.deepEqual(normalizeCliTiming(report), report);
  }
  const impossible = [
    { count: 2, sumUs: 400_000, maxUs: 300_000, buckets: [0, 2, 0, 0, 0, 0, 0, 0] },
    { count: 2, sumUs: 1, maxUs: 0, buckets: [2, 0, 0, 0, 0, 0, 0, 0] },
    { count: 1, sumUs: 250_000, maxUs: 250_000, buckets: [1, 0, 0, 0, 0, 0, 0, 0] },
    { count: Number.MAX_SAFE_INTEGER, sumUs: 0, maxUs: 0,
      buckets: [Number.MAX_SAFE_INTEGER, 1, 0, 0, 0, 0, 0, 0] },
  ];
  for (const phase of impossible) {
    const report = sample();
    report.commands[0]!.phases[0] = { phase: "total", ...phase };
    assert.equal(normalizeCliTiming(report), null);
  }
});

test("nested validation catches getters while never reading unowned fields", () => {
  for (const level of ["report", "command", "phase", "bucket"] as const) {
    const report = sample();
    const targets = { report, command: report.commands[0]!,
      phase: report.commands[0]!.phases[0]!, bucket: report.commands[0]!.phases[0]!.buckets };
    const fields = { report: "schema", command: "outcome", phase: "count", bucket: "0" };
    Object.defineProperty(targets[level], fields[level], {
      get() { throw Error("PRIVATE_SENTINEL"); },
    });
    assert.equal(normalizeCliTiming(report), null);
  }
  const report = sample();
  for (const value of [report, report.commands[0]!, report.commands[0]!.phases[0]!]) {
    Object.defineProperty(value, "privateExtra", {
      enumerable: true, get() { throw Error("Unowned fields must not be inspected"); },
    });
  }
  assert.deepEqual(normalizeCliTiming(report), sample());
});

test("session failure retains finite detail once without changing the thrown object", async () => {
  const failure = Object.assign(new Error("PRIVATE_SENTINEL"), {
    code: "invalid_payload", context: { stage: "validation", value: "PRIVATE_SENTINEL" },
  });
  let report!: CliTiming;
  await assert.rejects(withCliTiming(() => timeCliDispatch("experiment session log", async () => {
    throw failure;
  }), (value) => { report = value; }), (error) => error === failure);
  assert.equal(report.commands.length, 1);
  assert.equal(report.commands[0]!.command, "experiment session log");
  assert.equal(report.commands[0]!.outcome, "error");
  assert.equal(report.commands[0]!.calls, 1);
  assert.deepEqual(report.commands[0]!.failures, [
    { code: "invalid_payload", stage: "validation", count: 1 },
  ]);
  assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
});

test("first observation wins across catches; nested scopes and reused throws count per invocation", async () => {
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  const original = Object.assign(new Error("PRIVATE_SENTINEL"), {
    code: "invalid_payload", context: { stage: "validation" },
  });
  let report!: CliTiming;
  await withCliTiming(() => timeCliDispatch("batch", async () => {
    await withCliTiming(() => timeCliDispatch("batch", async () => {
      for (let index = 0; index < 2; index += 1) {
        await assert.rejects(withCliTiming(() => timeCliDispatch("experiment session log", async () => {
          noteCliTimingFailure(original);
          noteCliTimingFailure(original);
          throw new Error("PRIVATE_SENTINEL replacement exit");
        })), /replacement exit/u);
      }
    }));
    await withCliTiming(() => timeCliDispatch("experiment session log", async () => {}));
  }), (value) => { report = value; });
  assert.equal(report.batchContainers, 2);
  assert.deepEqual(report.commands.map(({ command, outcome, calls, failures }) => ({ command, outcome, calls, failures })), [
    { command: "experiment session log", outcome: "error", calls: 2,
      failures: [{ code: "invalid_payload", stage: "validation", count: 2 }] },
    { command: "experiment session log", outcome: "ok", calls: 1, failures: undefined },
  ]);
});

test("failure capture is finite, own-data-only, private-safe and inert without an active scope", async () => {
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  const cases: Array<{ error: unknown; code: string; stage: string }> = [
    { error: Object.assign(new Error("PRIVATE_SENTINEL"), { code: "conflict", stage: "persistence" }), code: "conflict", stage: "persistence" },
    { error: { code: "PRIVATE_SENTINEL", name: "PRIVATE_SENTINEL", stage: "PRIVATE_SENTINEL", message: "PRIVATE_SENTINEL", context: { stage: "PRIVATE_SENTINEL" }, cause: { code: "invalid_payload", stage: "validation" }, extra: "PRIVATE_SENTINEL" }, code: "unknown", stage: "unknown" },
    { error: { code: "ECONNRESET_PRIVATE_SENTINEL", stage: "transport_PRIVATE_SENTINEL" }, code: "unknown", stage: "unknown" },
    { error: { name: "Incur.ValidationError", fieldErrors: [{ path: "PRIVATE_SENTINEL" }] }, code: "VALIDATION_ERROR", stage: "validation" },
    { error: { name: "Incur.ParseError" }, code: "VALIDATION_ERROR", stage: "validation" },
    { error: { name: "ZodError" }, code: "invalid_payload", stage: "validation" },
    { error: { code: "ETIMEDOUT", context: { stage: "transport" } }, code: "ETIMEDOUT", stage: "transport" },
    { error: Object.create({ code: "conflict", stage: "persistence" }), code: "unknown", stage: "unknown" },
    { error: "PRIVATE_SENTINEL", code: "unknown", stage: "unknown" },
    { error: null, code: "unknown", stage: "unknown" },
  ];
  let reads = 0;
  const hostile = Object.defineProperties({}, Object.fromEntries(
    ["code", "name", "stage", "message", "context", "cause", "extra"].map((key) => [key, {
      get() { reads += 1; throw new Error("PRIVATE_SENTINEL"); },
    }])));
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("PRIVATE_SENTINEL"); },
    get() { throw new Error("PRIVATE_SENTINEL"); }, has() { throw new Error("PRIVATE_SENTINEL"); } });
  cases.push({ error: hostile, code: "unknown", stage: "unknown" }, { error: proxy, code: "unknown", stage: "unknown" });
  for (const { error, code, stage } of cases) {
    let report!: CliTiming;
    // Observe before a generic exit without asking application code to inspect
    // hostile metadata. Capture itself must never invoke any accessor.
    await withCliTiming(async () => {
      await timeCliDispatch("experiment session log", async () => { noteCliTimingFailure(error); });
      noteCliTimingExit(1, false);
    }, (value) => { report = value; });
    assert.deepEqual(report.commands[0]!.failures, [{ code, stage, count: 1 }]);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
  }
  assert.equal(reads, 0);
  const previous = process.env.MURPH_CLI_TIMING_ENDPOINT;
  try {
    delete process.env.MURPH_CLI_TIMING_ENDPOINT;
    const unchanged = {};
    assert.equal(await withCliTiming(async () => { noteCliTimingFailure(hostile); return unchanged; }), unchanged);
    noteCliTimingFailure(hostile);
    assert.equal(reads, 0);
  } finally {
    if (previous === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
    else process.env.MURPH_CLI_TIMING_ENDPOINT = previous;
  }
  // Even the pre-existing EPIPE outcome probe must not replace a hostile throw.
  let caught: unknown;
  try { await withCliTiming(async () => { throw proxy; }, () => {}); }
  catch (error) { caught = error; }
  assert.equal(caught, proxy);
});

test("nonzero exits without detail are unknown observations; success and EPIPE semantics stay intact", async () => {
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  let report!: CliTiming;
  await withCliTiming(async () => { noteCliTimingExit(3, false); }, (value) => { report = value; });
  assert.equal(report.commands[0]!.outcome, "error");
  assert.deepEqual(report.commands[0]!.failures, [{ code: "unknown", stage: "unknown", count: 1 }]);
  const pipe = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "EPIPE" });
  await assert.rejects(withCliTiming(async () => { throw pipe; }, (value) => { report = value; }), (error) => error === pipe);
  assert.equal(report.commands[0]!.outcome, "unknown");
  assert.deepEqual(report.commands[0]!.failures, [{ code: "EPIPE", stage: "unknown", count: 1 }]);
  await withCliTiming(async () => { noteCliTimingFailure(pipe); noteCliTimingExit(0, false); }, (value) => { report = value; });
  assert.equal(report.commands[0]!.outcome, "ok");
  assert.equal(report.commands[0]!.failures, undefined);
});

test("optional failure normalization never invalidates timing and collapses only to finite vocabulary", () => {
  const legacy = sample("experiment session log");
  legacy.commands[0]!.outcome = "error";
  legacy.commands[0]!.calls = 3;
  const command = legacy.commands[0]!;
  const malformed: unknown[] = [null, "PRIVATE_SENTINEL", {}, Array(9).fill({ code: "conflict", stage: "write", count: 1 }),
    [{ code: "conflict", stage: "write", count: 0 }], [{ code: "conflict", stage: "write", count: 4 }],
    [{ code: "conflict", stage: "write", count: Number.MAX_SAFE_INTEGER + 1 }],
    [{ get count() { throw new Error("PRIVATE_SENTINEL"); } }]];
  for (const failures of malformed) {
    assert.deepEqual(normalizeCliTiming({ ...legacy, commands: [{ ...command, failures }] }), legacy);
  }
  assert.deepEqual(normalizeCliTiming({ ...legacy, commands: [{ ...command,
    get failures() { throw new Error("PRIVATE_SENTINEL"); } }] }), legacy);
  assert.deepEqual(normalizeCliTiming({ ...legacy, commands: [{ ...command,
    failures: [{ code: "conflict", stage: "write", count: 2 }], droppedFailures: 2 }] }), legacy);
  assert.deepEqual(normalizeCliTiming({ ...legacy, commands: [{ ...command,
    get droppedFailures() { throw new Error("PRIVATE_SENTINEL"); } }] }), legacy);
  const normalized = normalizeCliTiming({ ...legacy, commands: [{ ...command, failures: [
    { code: "PRIVATE_SENTINEL", stage: "PRIVATE_SENTINEL", count: 1, message: "PRIVATE_SENTINEL" },
    { code: "other_PRIVATE_SENTINEL", stage: "other_PRIVATE_SENTINEL", count: 1 },
    { code: "invalid_payload", stage: "validation", count: 1 },
  ] }] });
  assert.deepEqual(normalized?.commands[0]!.failures, [
    { code: "unknown", stage: "unknown", count: 2 }, { code: "invalid_payload", stage: "validation", count: 1 },
  ]);
  assert.equal(JSON.stringify(normalized).includes("PRIVATE_SENTINEL"), false);
  assert.deepEqual(normalizeCliTiming(sample()), sample());
});

test("failure merging preserves legacy identities, bounded drops, mixed-version coverage and independent copies", () => {
  const codes = ["invalid_payload", "conflict", "not_found", "permission_denied", "invalid_path",
    "storage_unavailable", "ENOENT", "ENOSPC", "ETIMEDOUT"] as const;
  const report = emptyCliTiming();
  for (const code of codes) {
    const incoming = sample("experiment session log");
    incoming.commands[0]!.outcome = "error";
    incoming.commands[0]!.failures = [{ code, stage: "validation", count: 1 }];
    const original = structuredClone(incoming);
    mergeCliTiming(report, incoming);
    assert.deepEqual(incoming, original);
    incoming.commands[0]!.failures[0]!.count = 100;
  }
  assert.equal(report.commands.length, 1);
  assert.equal(report.commands[0]!.calls, 9);
  assert.equal(report.commands[0]!.failures?.length, 8);
  assert.equal(report.commands[0]!.droppedFailures, 1);
  assert.equal(report.droppedCalls, 0);
  const oldError = sample("experiment session log");
  oldError.commands[0]!.outcome = "error";
  mergeCliTiming(report, oldError);
  assert.equal(report.commands[0]!.calls, 10);
  assert.equal(report.commands[0]!.failures?.reduce((n, entry) => n + entry.count, 0), 8);
  mergeCliTiming(report, sample("experiment session log"));
  assert.equal(report.commands.length, 2);
  const differentStage = sample("experiment session log");
  differentStage.commands[0]!.outcome = "error";
  differentStage.commands[0]!.failures = [{ code: "invalid_payload", stage: "write", count: 1 }];
  mergeCliTiming(report, differentStage);
  assert.equal(report.commands[0]!.droppedFailures, 2);
  assert.deepEqual(normalizeCliTiming(report), report);
  const copied = emptyCliTiming();
  mergeCliTiming(copied, report);
  copied.commands[0]!.failures![0]!.count += 1;
  assert.equal(report.commands[0]!.failures![0]!.count, 1);
  const overflow = sample("experiment session log");
  overflow.commands[0]!.outcome = "error";
  overflow.commands[0]!.calls = Number.MAX_SAFE_INTEGER;
  overflow.commands[0]!.failures = [{ code: "conflict", stage: "write", count: Number.MAX_SAFE_INTEGER }];
  const before = structuredClone(overflow.commands);
  mergeCliTiming(overflow, differentStage);
  assert.deepEqual(overflow.commands, before);
  assert.equal(overflow.droppedCalls, 1);
});


test("optional normalization uses own indexed data and never invokes failure accessors", () => {
  const timing = sample("experiment session log");
  timing.commands[0]!.outcome = "error";
  let reads = 0;
  const failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 1,
    get validation() { reads += 1; throw new Error("PRIVATE_SENTINEL"); },
  }];
  Object.defineProperty(failures, Symbol.iterator, { get() { throw new Error("PRIVATE_SENTINEL"); } });
  const normalized = normalizeCliTiming({ ...timing, commands: [{ ...timing.commands[0], failures }] });
  assert.deepEqual(normalized?.commands[0]!.failures, [{ code: "VALIDATION_ERROR", stage: "validation", count: 1 }]);
  const accessor = { code: "conflict", stage: "write", get count() { reads += 1; return 1; } };
  assert.deepEqual(normalizeCliTiming({ ...timing, commands: [{ ...timing.commands[0], failures: [accessor] }] }), timing);
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(normalized).includes("PRIVATE_SENTINEL"), false);
});

test("exercise source codes are optional finite evidence; legacy and unknown-code reports retain counts", () => {
  for (const code of ["exercise_not_found", "exercise_catalog_unavailable", "exercise_catalog_invalid"] as const) {
    const legacy = sample("exercise show");
    legacy.commands[0]!.outcome = "error";
    assert.deepEqual(normalizeCliTiming(legacy), legacy);
    const report = structuredClone(legacy);
    report.commands[0]!.failures = [{ code, stage: "unknown", count: 1 }];
    assert.deepEqual(normalizeCliTiming(report), report);
    // Exactly the mixed-version rule: an unknown/newer code never discards
    // the command, outcome or count, and never admits its arbitrary string.
    const future = { ...report, commands: [{ ...report.commands[0]!, failures: [
      { code: `${code}_PRIVATE_SENTINEL`, stage: "unknown", count: 1 },
    ] }] };
    const normalized = normalizeCliTiming(future)!;
    assert.equal(normalized.commands[0]!.outcome, "error");
    assert.equal(normalized.commands[0]!.calls, 1);
    assert.deepEqual(normalized.commands[0]!.failures, [{ code: "unknown", stage: "unknown", count: 1 }]);
    assert.ok(!JSON.stringify(normalized).includes("PRIVATE_SENTINEL"));
  }
});

test("memory read failure capture and normalization admit only the two exact codes", async () => {
  const admitted = ["memory_not_found", "memory_document_invalid"] as const;
  const unknown = ["SYNTHETIC_FORBIDDEN_CONTENT", "memory_persistence_invalid", "memory_not_f\u043eund",
    ...admitted.flatMap((code) => [`prefix_${code}`, `${code}_suffix`, `${code} `, code.toUpperCase(), code.replaceAll("_", "-")])];
  for (const code of [...admitted, ...unknown]) {
    const expected = admitted.find((value) => value === code) ?? "unknown";
    assert.equal(cliTimingFailureCode(code), expected);
    const error = Object.assign(new Error("SYNTHETIC_FORBIDDEN_CONTENT"), {
      code, context: { stage: "read", sourcePath: "/SYNTHETIC_PRIVATE_PATH/memory.md",
        values: ["SYNTHETIC_FORBIDDEN_CONTENT"] }, cause: { code: "conflict" },
    });
    let report!: CliTiming;
    let reports = 0;
    await assert.rejects(withCliTiming(() => timeCliDispatch("memory show", async () => { throw error; }),
      (value) => { report = value; reports += 1; }), (caught) => caught === error);
    assert.equal(reports, 1);
    assert.deepEqual(report.commands[0]!.failures, [{ code: expected, stage: "read", count: 1 }]);
    assert.deepEqual(normalizeCliTiming(report), report);
    // Exercise the public consumer too, including extras a future writer must
    // never make durable. It must retain accounting, not raw diagnostic data.
    const input = { ...report, message: error.message, commands: [{ ...report.commands[0],
      failures: [{ code, stage: "read", count: 1, message: error.message,
        sourcePath: error.context.sourcePath, values: error.context.values }],
    }] };
    assert.deepEqual(normalizeCliTiming(input), report);
    for (const forbidden of [error.message, error.context.sourcePath]) {
      assert.ok(!JSON.stringify(report).includes(forbidden));
    }
  }
});

// Use the actual pre-admission portable reader, never a test copy of its parser.
// The parent supplies the available main base from the active execution plan.
const memoryFailureCompatibilityBase = process.env.MURPH_CLI_MEMORY_FAILURE_COMPAT_BASE;
test.skipIf(!memoryFailureCompatibilityBase)("actual older memory-code reader maps new codes to unknown without losing counts or outcomes", async () => {
  assert.match(memoryFailureCompatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${memoryFailureCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; cliTimingFailureCode: typeof cliTimingFailureCode } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  for (const code of ["memory_not_found", "memory_document_invalid"]) {
    assert.equal(old.cliTimingFailureCode(code), "unknown", "compatibility base must precede admission");
  }
  let report!: CliTiming;
  await withCliTiming(() => timeCliDispatch("batch", async () => {
    for (const code of ["memory_not_found", "memory_document_invalid", "memory_not_found"] as const) {
      const error = Object.assign(new Error("SYNTHETIC_FORBIDDEN_CONTENT"), { code, context: { stage: "read" } });
      await assert.rejects(withCliTiming(() => timeCliDispatch("memory show", async () => { throw error; })),
        (caught) => caught === error);
    }
    await withCliTiming(() => timeCliDispatch("memory show", async () => {}));
  }), (value) => { report = value; });
  assert.deepEqual(report.commands[0]!.failures, [
    { code: "memory_not_found", stage: "read", count: 2 },
    { code: "memory_document_invalid", stage: "read", count: 1 },
  ]);
  assert.deepEqual(report.commands.map(({ outcome, calls }) => ({ outcome, calls })), [
    { outcome: "error", calls: 3 }, { outcome: "ok", calls: 1 },
  ]);
  assert.deepEqual(normalizeCliTiming(report), report);
  const expected = structuredClone(report);
  expected.commands[0]!.failures = [{ code: "unknown", stage: "read", count: 3 }];
  assert.deepEqual(old.normalizeCliTiming(report), expected);
  assert.deepEqual(normalizeCliTiming(expected), expected);
  delete expected.commands[0]!.failures;
  assert.deepEqual(old.normalizeCliTiming(expected), expected);
  assert.deepEqual(normalizeCliTiming(expected), expected);
  assert.ok(!JSON.stringify(report).includes("SYNTHETIC_FORBIDDEN_CONTENT"));
});


test("validation selection admits only exact schema-owned fields and one standard issue", () => {
  const scopes = [
    ["automation list", ["limit", "status"]],
    ["event list", ["kind", "from", "to", "tag", "experiment", "limit", "arguments"]],
    ["event payload-schema", ["kind", "for"]],
    ["exercise list", ["query", "kind", "environment", "category", "target", "level",
      "equipment", "position", "modality", "commonness", "limit", "arguments"]],
    ["knowledge show", ["slug", "arguments"]],
    ["measurement entry list", ["metric", "from", "to", "limit"]],
    ["food search-labels", ["query", "limit"]],
    ["wearables day", ["date", "provider", "arguments"]],
    ["knowledge upsert", ["body", "slug", "title", "pageType", "status", "clearLibraryLinks", "relatedSlug", "librarySlug", "sourcePath", "arguments"]],
    ["knowledge append-section", ["slug", "heading", "body", "title", "position", "sourcePath"]],
  ] as const;
  for (const [command, fields] of scopes) for (const field of fields) {
    const issue = { path: field, code: "invalid_type", missing: true, message: "PRIVATE_SENTINEL", value: "PRIVATE_SENTINEL" };
    const expected = { field, code: "invalid_type", missing: true };
    for (const property of ["publicIssues", "fieldErrors"] as const) {
      assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { [property]: [issue, { ...issue, code: "too_small" }] }, property), { validation: expected });
    }
    assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { validation: { ...expected, path: "PRIVATE_SENTINEL" } }, "validation"), { validation: expected });
  }
  for (const command of ["other", "food search-labels-batch", "knowledge show", "knowledge upsert PRIVATE_SENTINEL", "FOOD search-labels"]) {
    assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { publicIssues: [{ path: "body", code: "invalid_type", missing: true }] }, "publicIssues"), {});
  }
  for (const path of ["body", "query.value", "query[0]", "query.0", "PRIVATE_SENTINEL.query", "queryPRIVATE_SENTINEL",
    " query", "query ", "Query", "quеry", ["query"], 0, null, { toString() { throw Error("must not coerce"); } }]) {
    assert.deepEqual(cliTimingValidationFailure("food search-labels", "VALIDATION_ERROR", { publicIssues: [{ path, code: "invalid_type", missing: true }] }, "publicIssues"), {});
  }
  const source = { publicIssues: [{ path: "query", code: "invalid_type", received: "undefined", message: "Required" }] };
  assert.deepEqual(cliTimingValidationFailure("food search-labels", "VALIDATION_ERROR", source, "publicIssues"), { validation: { field: "query", code: "invalid_type" } });
  let reads = 0;
  const uninspected = new Proxy({}, { getOwnPropertyDescriptor() { reads += 1; throw Error("PRIVATE_SENTINEL"); } });
  for (const code of [undefined, "unknown", "invalid_payload", "VALIDATION_ERROR_PRIVATE_SENTINEL", "validation_error", "VALIDATION_ERROR "]) {
    for (const property of ["publicIssues", "fieldErrors", "validation"] as const) {
      assert.deepEqual(cliTimingValidationFailure("food search-labels", code, uninspected, property), {});
    }
  }
  assert.equal(reads, 0);
});

for (const [command, field] of [
  ["food search-labels", "query"], ["event list", "limit"],
  ["event list", "arguments"], ["knowledge upsert", "arguments"],
  ["exercise list", "kind"], ["exercise list", "limit"], ["exercise list", "arguments"],
  ["meal add", "nutritionCalories"], ["meal edit", "nutritionSource"],
  ["meal add", "occurredAt"], ["meal edit", "arguments"],
  ["meal edit", "id"], ["meal edit", "nutritionProteinGrams"], ["meal edit", "nutritionConfidence"],
] as const) test(`${command}/${field} validation reads a fixed prefix without getters, prototypes, causes or proxy escapes`, () => {
  let reads = 0;
  const getter = { get() { reads += 1; throw Error("PRIVATE_SENTINEL"); } };
  const good = { path: field, code: "invalid_type", missing: true };
  const huge: unknown[] = new Array(1_000_000);
  Object.defineProperty(huge, "0", getter);
  Object.defineProperty(huge, Symbol.iterator, getter);
  Object.defineProperty(huge, String(CLI_TIMING_MAX_VALIDATION_ISSUES), getter);
  assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { publicIssues: huge }, "publicIssues"), {});
  huge[CLI_TIMING_MAX_VALIDATION_ISSUES - 1] = good;
  assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { publicIssues: huge }, "publicIssues"),
    { validation: { field, code: "invalid_type", missing: true } });
  const hostile = Object.defineProperty({}, "publicIssues", getter);
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw Error("PRIVATE_SENTINEL"); }, get: getter.get });
  const revoked = Proxy.revocable([], {}); revoked.revoke();
  for (const source of [hostile, proxy, { publicIssues: revoked.proxy }, { publicIssues: [proxy] },
    Object.create({ publicIssues: [good] }), { cause: { publicIssues: [good] } },
    { publicIssues: [Object.create(good)] }, { publicIssues: [Object.assign([], good)] }, { publicIssues: [Object.defineProperty({ ...good }, "path", getter)] }]) {
    assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", source, "publicIssues"), {});
  }
  for (const key of ["message", "expected", "received", "value", "argument", "cause"]) Object.defineProperty(good, key, getter);
  assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { publicIssues: [good] }, "publicIssues"),
    { validation: { field, code: "invalid_type", missing: true } });
  assert.equal(reads, 0);
});

for (const commandName of ["food search-labels", "exercise list"]) test(`${commandName}: malformed optional validation preserves failure counts and boundaries`, () => {
  const report = sample(commandName);
  const command = report.commands[0]!;
  command.outcome = "error";
  command.failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 1 }];
  const good = { field: "query", code: "invalid_type", missing: true };
  let reads = 0;
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw Error("PRIVATE_SENTINEL"); } });
  for (const validation of [null, [], "PRIVATE_SENTINEL", proxy, Object.create(good),
    { ...good, field: "body" }, { ...good, field: "query.PRIVATE_SENTINEL" }, { ...good, field: ["query"] },
    ...["INVALID_TYPE", "invalid_type ", "invalid_type_PRIVATE_SENTINEL", "PRIVATE_SENTINEL"].map((code) => ({ ...good, code })),
    ...[null, "true", 1, {}].map((missing) => ({ ...good, missing })),
    Object.defineProperty({ ...good }, "code", { get() { reads += 1; throw Error("PRIVATE_SENTINEL"); } })]) {
    assert.deepEqual(normalizeCliTiming({ ...report, commands: [{ ...command,
      failures: [{ ...command.failures[0], validation }] }] }), report);
  }
  assert.equal(reads, 0);
  const input = { ...report, commands: [{ ...command, failures: [{ ...command.failures[0],
    validation: { ...good, path: "PRIVATE_SENTINEL", expected: "PRIVATE_SENTINEL", value: "PRIVATE_SENTINEL" } }] }] };
  assert.deepEqual(normalizeCliTiming(input)?.commands[0]!.failures, [{ ...command.failures[0], validation: good }]);
  assert.ok(!JSON.stringify(normalizeCliTiming(input)).includes("PRIVATE_SENTINEL"));
  for (const name of ["other", "exercise show", "knowledge show"]) {
    assert.equal(normalizeCliTiming({ ...input, commands: [{ ...input.commands[0], command: name }] })?.commands[0]!.failures?.[0]?.validation, undefined);
  }
  const unknown = { ...input, commands: [{ ...command, failures: [{ code: "PRIVATE_SENTINEL", stage: "validation", count: 1, validation: good }] }] };
  assert.deepEqual(normalizeCliTiming(unknown)?.commands[0]!.failures, [{ code: "unknown", stage: "validation", count: 1 }]);
  assert.equal(normalizeCliTiming({ ...input, commands: [{ ...input.commands[0], outcome: "ok" }] })?.commands[0]!.failures, undefined);
});

test("original validation capture is first-observation-only and retains neither the error nor mutable issues", async () => {
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  const issues = [{ path: "body", code: "invalid_type", missing: true }];
  const original = Object.assign(new Error("PRIVATE_SENTINEL"), { name: "Incur.ValidationError", publicIssues: issues });
  const replacement = new Error("PRIVATE_SENTINEL");
  let report!: CliTiming, reports = 0;
  await assert.rejects(withCliTiming(() => timeCliDispatch("knowledge upsert", async () => {
    noteCliTimingFailure(original);
    issues[0]!.path = "PRIVATE_SENTINEL";
    throw replacement;
  }), (value) => { report = value; reports += 1; }), (caught) => caught === replacement);
  assert.equal(reports, 1);
  assert.equal(report.commands[0]!.calls, 1);
  assert.deepEqual(report.commands[0]!.failures, [{ code: "VALIDATION_ERROR", stage: "validation", count: 1,
    validation: { field: "body", code: "invalid_type", missing: true } }]);
  assert.deepEqual(normalizeCliTiming(report), report);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_SENTINEL"));
  await withCliTiming(() => timeCliDispatch("knowledge upsert", async () => {
    noteCliTimingFailure(original); noteCliTimingExit(0, false);
  }), (value) => { report = value; });
  assert.equal(report.commands[0]!.failures, undefined);
});

const readValidationCases = [
  ["knowledge show", "arguments", "custom", false],
  ["knowledge show", "slug", "invalid_type", true],
  ["knowledge show", "slug", "invalid_format", false],
  ["event payload-schema", "kind", "invalid_value", true],
  ["event payload-schema", "kind", "invalid_value", false],
  ["event payload-schema", "for", "invalid_value", false],
] as const;

const exerciseValidationCases = [
  ["exercise list", "kind", "invalid_value", false],
  ["exercise list", "limit", "too_big", false],
  ["exercise list", "arguments", "custom", false, "unknown_flag"],
  ["exercise list", "arguments", "custom", false, "missing_value"],
] as const;

const measurementValidationCases = [
  ["measurement entry list", "metric", "invalid_type", true],
  ["measurement entry list", "from", "invalid_format", false],
  ["measurement entry list", "to", "custom", false],
  ["measurement entry list", "limit", "too_big", false],
] as const;

const eventInvocationValidationCases = [
  ["event list", "kind", "invalid_value", false],
  ["event list", "from", "invalid_format", false],
  ["event list", "to", "custom", false],
  ["event list", "tag", "too_small", false],
  ["event list", "experiment", "invalid_format", false],
  ["event list", "limit", "too_big", false],
  ["event list", "arguments", "custom", false],
  ["knowledge upsert", "arguments", "custom", false],
] as const;

const mealValidationCases = [
  ["meal add", "nutritionCalories", "too_small", false],
  ["meal add", "nutritionSource", "invalid_value", false],
  ["meal add", "occurredAt", "invalid_format", false],
  ["meal add", "occurredAt", "custom", false],
  ["meal add", "arguments", "custom", false],
  ["meal edit", "nutritionCalories", "too_small", false],
  ["meal edit", "nutritionSource", "invalid_value", false],
  ["meal edit", "occurredAt", "invalid_format", false],
  ["meal edit", "occurredAt", "custom", false],
  ["meal edit", "arguments", "custom", false],
] as const;

const mealEditValidationCases = [
  ["meal edit", "id", "invalid_type", true],
  ["meal edit", "nutritionProteinGrams", "too_small", false],
  ["meal edit", "nutritionConfidence", "invalid_value", false],
] as const;

test("allowlisted commands preserve original errors and round-trip only finite validation detail", async () => {
  for (const [command, field, code, missing] of [
    ["automation list", "limit", "too_big", false], ["automation list", "status", "invalid_value", false],
    ...exerciseValidationCases,
    ...readValidationCases, ...measurementValidationCases, ...eventInvocationValidationCases, ...mealValidationCases, ...mealEditValidationCases,
  ] as const) for (const property of ["publicIssues", "fieldErrors"] as const) {
    const validation = { field, code, missing };
    const original = Object.assign(new Error("PRIVATE_SENTINEL"), {
      name: "Incur.ValidationError", fieldErrors: [{ path: "limit", code: "custom" }], [property]: [
        { path: "vault", code: "invalid_type", missing: true },
        { path: field, code, missing, value: "PRIVATE_SENTINEL", message: "PRIVATE_SENTINEL" },
      ], cause: { code: "PRIVATE_SENTINEL" },
    });
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw original; }),
      (value) => { report = value; }), (caught) => caught === original);
    assert.equal(original.message, "PRIVATE_SENTINEL");
    assert.equal(report.reportCount, 1);
    assert.equal(report.commands.length, 1);
    assert.equal(report.commands[0]!.calls, 1);
    assert.equal(report.commands[0]!.outcome, "error");
    const failure = { code: "VALIDATION_ERROR", stage: "validation", count: 1 };
    assert.deepEqual(report.commands[0]!.failures, [{ ...failure, validation }]);
    assert.deepEqual(normalizeCliTiming(JSON.parse(JSON.stringify(report))), report);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_SENTINEL"));
    const legacy = structuredClone(report);
    delete legacy.commands[0]!.failures![0]!.validation;
    assert.deepEqual(normalizeCliTiming(legacy), legacy);
    assert.equal(normalizeCliTiming({ ...report, commands: [{ ...report.commands[0], outcome: "ok" }] })?.commands[0]!.failures, undefined);
    let success!: CliTiming;
    await withCliTiming(() => timeCliDispatch(command, async () => {}), (value) => { success = value; });
    assert.equal(success.commands[0]!.outcome, "ok");
    assert.equal(success.commands[0]!.failures, undefined);
    assert.deepEqual(normalizeCliTiming(success), success);
    for (const otherCode of ["invalid_payload", "knowledge_page_not_found", "unknown"] as const) {
      const other = Object.assign(new Error("PRIVATE_SENTINEL"), original, { code: otherCode });
      let otherReport!: CliTiming;
      await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw other; }),
        (value) => { otherReport = value; }), (caught) => caught === other);
      assert.deepEqual(otherReport.commands[0]!.failures, [{ code: otherCode, stage: "unknown", count: 1 }]);
      assert.deepEqual(normalizeCliTiming({ ...legacy, commands: [{ ...legacy.commands[0],
        failures: [{ code: otherCode, stage: "unknown", count: 1, validation }] }] })?.commands[0]!.failures,
        otherReport.commands[0]!.failures);
    }
    for (const invalid of [{ ...validation, field: "vault" }, { ...validation, field: `${field}.0` },
      { ...validation, code: "PRIVATE_SENTINEL" }, { ...validation, missing: "false" }]) {
      assert.deepEqual(normalizeCliTiming({ ...report, commands: [{ ...report.commands[0],
        failures: [{ ...failure, validation: invalid }] }] }), legacy);
    }
  }
});

test("command validation omits other fields, commands and malformed evidence on every projection", () => {
  for (const [command, field, otherFields] of [
    ["automation list", "status", ["sourcePath", "text", "supportSeriesId", "cursor", "compact"]],
    ["knowledge show", "slug", ["kind", "for", "body", "sourcePath"]],
    ["event payload-schema", "kind", ["slug", "body", "sourcePath"]],
    ["event payload-schema", "for", ["slug", "body", "sourcePath"]],
    ...exerciseValidationCases.map(([command, field]) =>
      [command, field, ["lookup", "body", "slug", "sourcePath", "value", "context", "config"]] as const),
    ...measurementValidationCases.map(([command, field]) =>
      [command, field, ["value", "unit", "slug", "body", "sourcePath"]] as const),
    ...eventInvocationValidationCases.map(([command, field]) =>
      [command, field, ["value", "unit", "cursor", "text"]] as const),
    ...[...mealValidationCases, ...mealEditValidationCases].map(([command, field]) =>
      [command, field, [...(command === "meal add" ? ["id"] : []), "source", "timeZone", "dayKey", "note", "photo", "audio", "ingredient", "nutrition",
        "nutritionSourceDetail", "nutrition.totals.calories", "env", "0", "value", "context"]] as const),
  ] as const) {
    const good = { path: field, code: "invalid_value", missing: false };
    const invalid = [
      ...["vault", "requestId", ...otherFields, `${field}.0`, `${field}[0]`, [field], [field, 0], field.toUpperCase(),
        ` ${field}`, `${field} `, `${field}PRIVATE_SENTINEL`, "PRIVATE_SENTINEL"].map((path) => ({ ...good, path })),
      ...[null, "false", 0, {}].map((missing) => ({ ...good, missing })),
      ...["INVALID_VALUE", "invalid_value ", "invalid_value_PRIVATE_SENTINEL"].map((code) => ({ ...good, code })),
    ];
    for (const issue of invalid) for (const property of ["publicIssues", "fieldErrors", "validation"] as const) {
      const detail = property === "validation" ? { field: issue.path, code: issue.code, missing: issue.missing }
        : [{ ...issue, value: "PRIVATE_SENTINEL", message: "PRIVATE_SENTINEL" }];
      assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { [property]: detail }, property), {});
    }
    for (const other of ["other", "exercise show", "exercise facets", "automation show", "automation set-status", "event show", "knowledge list",
      "measurement list", "measurement add", `${command} PRIVATE_SENTINEL`, command.toUpperCase()]) {
      assert.deepEqual(cliTimingValidationFailure(other, "VALIDATION_ERROR", { publicIssues: [good] }, "publicIssues"), {});
    }
    for (const publicIssues of [undefined, null, {}, [],
      Array(CLI_TIMING_MAX_VALIDATION_ISSUES).fill({ ...good, path: "PRIVATE_SENTINEL" }).concat(good)]) {
      assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", { publicIssues }, "publicIssues"), {});
    }
    assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", {
      publicIssues: [{ path: field, code: "invalid_value", received: "undefined" }],
    }, "publicIssues"), { validation: { field, code: "invalid_value" } });
  }
});

// Load the actual pre-extension reader, not a copied telemetry parser.
const automationValidationCompatibilityBase = process.env.MURPH_CLI_AUTOMATION_VALIDATION_COMPAT_BASE;
test.skipIf(!automationValidationCompatibilityBase)("actual older automation reader omits new detail without losing accounting", async () => {
  assert.match(automationValidationCompatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${automationValidationCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; cliTimingValidationFailure: typeof cliTimingValidationFailure } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  for (const [field, code] of [["limit", "too_big"], ["status", "invalid_value"]] as const) {
    const validation = { field, code, missing: false };
    for (const property of ["publicIssues", "fieldErrors"] as const) {
      const source = { [property]: [{ path: field, code, missing: false }] };
      assert.deepEqual(old.cliTimingValidationFailure("automation list", "VALIDATION_ERROR", source, property), {});
      assert.deepEqual(cliTimingValidationFailure("automation list", "VALIDATION_ERROR", source, property), { validation });
    }
    const report = sample("automation list");
    report.commands[0]!.outcome = "error";
    report.commands[0]!.failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 1, validation }];
    const legacy = structuredClone(report);
    delete legacy.commands[0]!.failures![0]!.validation;
    assert.deepEqual(old.normalizeCliTiming(report), legacy);
    assert.deepEqual(normalizeCliTiming(legacy), legacy);
    assert.deepEqual(old.normalizeCliTiming(sample("automation list")), sample("automation list"));
  }
});

for (const [reader, base, cases] of [
  ["exercise-validation", process.env.MURPH_CLI_EXERCISE_VALIDATION_COMPAT_BASE, exerciseValidationCases],
  ["read-validation", process.env.MURPH_CLI_READ_VALIDATION_COMPAT_BASE, readValidationCases],
  ["measurement-validation", process.env.MURPH_CLI_MEASUREMENT_VALIDATION_COMPAT_BASE, measurementValidationCases],
  ["event-invocation-validation", process.env.MURPH_CLI_EVENT_INVOCATION_VALIDATION_COMPAT_BASE, eventInvocationValidationCases],
  ["meal-validation", process.env.MURPH_CLI_MEAL_VALIDATION_COMPAT_BASE, mealValidationCases],
  ["meal-edit-validation", process.env.MURPH_CLI_MEAL_FAILURE_ATTRIBUTION_COMPAT_BASE, mealEditValidationCases],
  ["knowledge-parser-validation", process.env.MURPH_CLI_KNOWLEDGE_PARSER_VALIDATION_COMPAT_BASE,
    [["knowledge show", "arguments", "custom", false]]],
] as const) test.skipIf(!base)(`actual older ${reader} consumer drops detail but preserves the envelope and counts`, async () => {
  assert.match(base ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${base}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; cliTimingValidationFailure: typeof cliTimingValidationFailure } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  for (const entry of cases) {
    const [command, field, code, missing] = entry;
    const rejection = entry.length === 5 ? entry[4] : undefined;
    const validation = { field, code, missing };
    for (const property of ["publicIssues", "fieldErrors"] as const) {
      const source = { [property]: [{ path: field, code, missing }] };
      assert.deepEqual(old.cliTimingValidationFailure(command, "VALIDATION_ERROR", source, property), {});
      assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", source, property), { validation });
    }
    const report = sample(command);
    report.commands[0]!.outcome = "error";
    report.commands[0]!.calls = 3;
    report.commands[0]!.failures = [
      { code: "VALIDATION_ERROR", stage: "validation", count: 1, validation,
        ...(rejection ? { rejection } : {}) },
      { code: "VALIDATION_ERROR", stage: "validation", count: 1 },
    ];
    report.commands[0]!.droppedFailures = 1;
    const legacy = structuredClone(report);
    legacy.commands[0]!.failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 2 }];
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.deepEqual(old.normalizeCliTiming(report), legacy);
    assert.deepEqual(normalizeCliTiming(legacy), legacy);
    delete legacy.commands[0]!.failures;
    delete legacy.commands[0]!.droppedFailures;
    assert.deepEqual(old.normalizeCliTiming(legacy), legacy);
    assert.deepEqual(normalizeCliTiming(legacy), legacy);
    assert.deepEqual(old.normalizeCliTiming(sample(command)), sample(command));
    assert.deepEqual(normalizeCliTiming(sample(command)), sample(command));
  }
});

test("validation variants merge separately with cap eight, legacy absence, independent copies and unchanged drops", () => {
  const variants: (CliValidationDiagnostic | undefined)[] = [
    { field: "body", code: "invalid_type", missing: true },
    { field: "body", code: "invalid_type", missing: false },
    { field: "body", code: "invalid_type" },
    { field: "body", code: "too_small", missing: false },
    { field: "slug", code: "invalid_format", missing: false },
    { field: "title", code: "too_small", missing: false },
    { field: "status", code: "too_small", missing: false },
    undefined, // Old failure-aware peer; must not coalesce with unknown missing.
    { field: "pageType", code: "too_small", missing: false },
  ];
  const aggregate = emptyCliTiming();
  for (const validation of [...variants, variants[0]]) {
    const incoming = sample("knowledge upsert");
    incoming.commands[0]!.outcome = "error";
    incoming.commands[0]!.failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 1,
      ...(validation ? { validation: { ...validation } } : {}) }];
    const original = structuredClone(incoming);
    mergeCliTiming(aggregate, incoming);
    assert.deepEqual(incoming, original);
    const detail = incoming.commands[0]!.failures[0]!.validation;
    if (detail) detail.missing = !detail.missing;
  }
  const legacy = sample("knowledge upsert"); legacy.commands[0]!.outcome = "error";
  mergeCliTiming(aggregate, legacy); // No invented observation for an old call.
  assert.equal(aggregate.commands.length, 1);
  const command = aggregate.commands[0]!;
  assert.equal(command.calls, 11);
  assert.equal(command.failures?.length, 8);
  assert.equal(command.failures?.[0]?.count, 2);
  assert.deepEqual(command.failures?.map((failure) => failure.validation), variants.slice(0, 8));
  assert.equal(command.droppedFailures, 1);
  assert.equal(command.failures!.reduce((sum, failure) => sum + failure.count, 0) + command.droppedFailures!, 10);
  assert.equal(aggregate.droppedCalls, 0);
  assert.equal(aggregate.droppedSpans, 0);
  assert.deepEqual(normalizeCliTiming(aggregate), aggregate);
  // Duplicate normalized entries use the same variant identity as merging.
  const repeated = { ...command, calls: 2, droppedFailures: 0,
    failures: [command.failures![1], command.failures![1]] };
  assert.deepEqual(normalizeCliTiming({ ...aggregate, commands: [repeated] })?.commands[0]!.failures,
    [{ ...command.failures![1], count: 2 }]);
});

test("only the three existing knowledge source codes survive producer and wire admission", async () => {
  const admitted = ["knowledge_source_unreadable", "knowledge_invalid_source_path", "knowledge_invalid_library_slug"] as const;
  for (const code of [...admitted, "knowledge_source_not_found", "knowledge_source_unreadаble",
    ...admitted.flatMap((value) => [`prefix_${value}`, `${value}_suffix`, `${value} `, value.toUpperCase()])]) {
    const expected = admitted.find((value) => value === code) ?? "unknown";
    const error = Object.assign(new Error("PRIVATE_SENTINEL"), { code, context: { sourcePath: "PRIVATE_SENTINEL" } });
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch("knowledge append-section", async () => { throw error; }),
      (value) => { report = value; }), (caught) => caught === error);
    assert.deepEqual(report.commands[0]!.failures, [{ code: expected, stage: "unknown", count: 1 }]);
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_SENTINEL"));
  }
});


const researchFailureCodes = [
  "research_scout_invalid_batch_payload", "research_scout_invalid_window", "research_exa_token_missing",
] as const;

test("research timing admits only three exact source codes without inferring a stage or retaining private data", async () => {
  const unknown = ["research_scout_invalid_profile", "research_exa_request_failed", "PRIVATE_ERROR_LABEL",
    ...researchFailureCodes.flatMap((code) => [code.toUpperCase(), `prefix_${code}`, `${code}_suffix`,
      `${code} `, code.replaceAll("_", "-"), code.replace("research", "rese\u0430rch")])];
  for (const code of [...researchFailureCodes, ...unknown]) {
    const expected = researchFailureCodes.find((known) => known === code) ?? "unknown";
    assert.equal(cliTimingFailureCode(code), expected);
    const error = Object.assign(new Error("PRIVATE_ERROR_MESSAGE"), { code,
      context: { token: "PRIVATE_TOKEN", path: "/PRIVATE_PATH", payload: "PRIVATE_PAYLOAD" },
      cause: { code: "invalid_payload", stage: "validation" }, argv: ["PRIVATE_ARGUMENT"] });
    let report!: CliTiming;
    let reports = 0;
    await assert.rejects(withCliTiming(() => timeCliDispatch("research scout-batch", async () => { throw error; }),
      (value) => { report = value; reports += 1; }), (caught) => caught === error);
    assert.equal(reports, 1);
    assert.equal(report.reportCount, 1);
    assert.equal(report.commands.length, 1);
    assert.equal(report.commands[0]!.calls, 1);
    assert.equal(report.commands[0]!.outcome, "error");
    assert.deepEqual(report.commands[0]!.failures, [{ code: expected, stage: "unknown", count: 1 }]);
    assert.deepEqual(normalizeCliTiming(report), report);
    // Future/malicious optional evidence must not remove accounting or escape.
    const wire = { ...report, argv: error.argv, commands: [{ ...report.commands[0]!, failures: [
      { code, stage: "PRIVATE_STAGE", count: 1, message: error.message, ...error.context,
        validation: { field: "PRIVATE_FIELD", code: "PRIVATE_ISSUE" } },
    ] }] };
    assert.deepEqual(normalizeCliTiming(wire), report);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
  }
});

function researchRejectionError(value?: unknown, descriptor: PropertyDescriptor = { value }): Error {
  const error = Object.assign(new Error("PRIVATE_ERROR_MESSAGE"), { code: "research_scout_invalid_batch_payload" });
  if (value !== undefined || !("value" in descriptor)) Object.defineProperty(error, "cliTimingRejection", descriptor);
  return error;
}

test("research batch rejection is private own data, finite, gated and inert to hostile metadata", async () => {
  const capture = async (error: Error, command = "research scout-batch") => {
    const visible = { keys: Object.keys(error), json: JSON.stringify(error), name: error.name, message: error.message };
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw error; }),
      (value) => { report = value; }), (caught) => caught === error);
    assert.deepEqual({ keys: Object.keys(error), json: JSON.stringify(error), name: error.name, message: error.message }, visible);
    // Disabled timing has the same throw identity and visible error shape.
    await assert.rejects(withCliTiming(async () => { throw error; }, undefined), (caught) => caught === error);
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.ok(!JSON.stringify(report).includes("PRIVATE"));
    return report.commands[0]!.failures;
  };
  const base = { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 } as const;
  for (const rejection of CLI_TIMING_REJECTIONS) {
    assert.deepEqual(await capture(researchRejectionError(rejection)), [{ ...base, rejection }]);
    // Other commands/codes never admit the field, even with identical metadata.
    assert.deepEqual(await capture(researchRejectionError(rejection), "research scout"), [{ ...base }]);
    const window = Object.assign(researchRejectionError(rejection), { code: "research_scout_invalid_window" });
    assert.deepEqual(await capture(window), [{ ...base, code: "research_scout_invalid_window" }]);
  }
  let reads = 0;
  const hostile: Error[] = [
    researchRejectionError(), researchRejectionError("PRIVATE_REASON"), researchRejectionError("Envelope"),
    researchRejectionError("envelope "), researchRejectionError(["envelope"]), researchRejectionError({ toString: () => "envelope" }),
    researchRejectionError(new String("envelope")), researchRejectionError(1),
    researchRejectionError(new Proxy({}, { get: () => { reads += 1; return "envelope"; } })),
    researchRejectionError(undefined, { get: () => { reads += 1; return "envelope"; } }),
    Object.setPrototypeOf(researchRejectionError(), { cliTimingRejection: "envelope" }) as Error,
  ];
  for (const error of hostile) assert.deepEqual(await capture(error), [{ ...base }]);
  assert.equal(reads, 0);
  assert.deepEqual(cliTimingRejectionFailure("research scout-batch", "research_scout_invalid_batch_payload",
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("PRIVATE_TRAP"); } }), "cliTimingRejection"), {});
});

test("a source proxy's descriptor trap can supply only an allowlisted literal, never arbitrary data", async () => {
  // Not proxy detection: the descriptor trap may run. Only a fixed primitive leaves.
  const proxied = (rejection: unknown) => new Proxy(new Error("PRIVATE_ERROR_MESSAGE"), {
    getOwnPropertyDescriptor: (target, key) => {
      if (key === "code") return { value: "research_scout_invalid_batch_payload", configurable: true, enumerable: true, writable: true };
      if (key === "cliTimingRejection") return { value: rejection, configurable: true, enumerable: false, writable: false };
      if (key === "context" || key === "stage") return { value: { stage: "PRIVATE_STAGE" }, configurable: true, enumerable: true, writable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const capture = async (error: object) => {
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch("research scout-batch", async () => { throw error; }),
      (value) => { report = value; }), (caught) => caught === error);
    assert.ok(!JSON.stringify(report).includes("PRIVATE"));
    return report.commands[0]!.failures;
  };
  const base = { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 } as const;
  assert.deepEqual(await capture(proxied("public_concept")), [{ ...base, rejection: "public_concept" }]);
  for (const value of ["PRIVATE_REASON", { PRIVATE: "PRIVATE_VALUE" }, ["envelope"], new String("envelope")]) {
    const failures = await capture(proxied(value));
    assert.deepEqual(failures, [{ ...base }]);
    assert.deepEqual(cliTimingRejectionFailure("research scout-batch", base.code, proxied(value), "cliTimingRejection"), {});
  }
});

test("rejection variants share failure caps, coalesce exactly and drop only detail when malformed on the wire", () => {
  const aggregate = emptyCliTiming();
  const variants = [...CLI_TIMING_REJECTIONS, undefined, CLI_TIMING_REJECTIONS[0]];
  for (const rejection of variants) {
    const incoming = sample("research scout-batch");
    incoming.commands[0]!.outcome = "error";
    incoming.commands[0]!.failures = [{ code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1,
      ...(rejection ? { rejection } : {}) }];
    mergeCliTiming(aggregate, incoming);
  }
  const command = aggregate.commands[0]!;
  assert.equal(command.calls, 9);
  assert.equal(command.failures!.length, 8);
  assert.equal(command.failures![0]!.count, 2);
  assert.deepEqual(command.failures!.map((failure) => failure.rejection), [...CLI_TIMING_REJECTIONS, undefined]);
  assert.equal(command.droppedFailures, undefined);
  assert.deepEqual(normalizeCliTiming(aggregate), aggregate);
  const extra = sample("research scout-batch");
  extra.commands[0]!.outcome = "error";
  extra.commands[0]!.failures = [{ code: "research_scout_invalid_batch_payload", stage: "validation", count: 1,
    rejection: "envelope" }];
  mergeCliTiming(aggregate, extra);
  assert.equal(aggregate.commands[0]!.droppedFailures, 1);
  assert.equal(aggregate.commands[0]!.failures!.reduce((sum, failure) => sum + failure.count, 0) + 1, 10);
  // Wire detail is admitted only for the exact command/code; hostile values drop only the detail.
  const wire = sample("research scout-batch");
  wire.commands[0]!.outcome = "error";
  wire.commands[0]!.calls = 4;
  const entries = [
    { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1, rejection: "PRIVATE_REASON" },
    { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 },
    { code: "research_scout_invalid_window", stage: "unknown", count: 1, rejection: "envelope" },
    Object.defineProperty({ code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 }, "rejection",
      { enumerable: true, get: () => "envelope" }),
  ];
  const normalized = normalizeCliTiming({ ...wire, commands: [{ ...wire.commands[0]!, failures: entries }] });
  assert.deepEqual(normalized?.commands[0]!.failures, [
    { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 3 },
    { code: "research_scout_invalid_window", stage: "unknown", count: 1 },
  ]);
  const other = sample("research scout");
  other.commands[0]!.outcome = "error";
  other.commands[0]!.failures = [{ code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1,
    rejection: "envelope" }];
  assert.deepEqual(normalizeCliTiming(other)?.commands[0]!.failures,
    [{ code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 }]);
});

// Actual pre-rejection reader (named in the active plan), never a copied parser.
const researchRejectionCompatibilityBase = process.env.MURPH_CLI_RESEARCH_REJECTION_COMPAT_BASE;
test.skipIf(!researchRejectionCompatibilityBase)("actual pre-rejection reader drops only the category and keeps counts", async () => {
  assert.match(researchRejectionCompatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${researchRejectionCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; mergeCliTiming: typeof mergeCliTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  const report = sample("research scout-batch");
  report.commands[0]!.outcome = "error";
  report.commands[0]!.calls = 4;
  report.commands[0]!.failures = [
    { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1, rejection: "public_concept" },
    { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1, rejection: "envelope" },
    { code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 },
  ];
  report.commands[0]!.droppedFailures = 1;
  assert.deepEqual(normalizeCliTiming(report), report);
  const legacy = structuredClone(report);
  legacy.commands[0]!.failures = [{ code: "research_scout_invalid_batch_payload", stage: "unknown", count: 3 }];
  assert.deepEqual(old.normalizeCliTiming(report), legacy);
  assert.deepEqual(normalizeCliTiming(legacy), legacy);
  const oldMerged = emptyCliTiming();
  old.mergeCliTiming(oldMerged, report);
  assert.deepEqual(oldMerged.commands, legacy.commands);
  delete legacy.commands[0]!.failures;
  delete legacy.commands[0]!.droppedFailures;
  assert.deepEqual(old.normalizeCliTiming(legacy), legacy);
  assert.deepEqual(normalizeCliTiming(legacy), legacy);
});

// The CLI bridge's timing-only copy of Incur's typed projection plus parser reason.
function parseRejectionEnvelope(value?: unknown): object {
  return { code: "VALIDATION_ERROR", stage: "validation", message: "PRIVATE_MESSAGE",
    fieldErrors: [{ path: "arguments", code: "custom", missing: false }],
    ...(value === undefined ? {} : { cliTimingRejection: value }) };
}
const parseValidation = { field: "arguments", code: "custom", missing: false } as const;

for (const owner of ["knowledge upsert", "exercise list"]) test(`${owner} parse rejection is gated, finite and separate from research categories`, async () => {
  const capture = async (error: object, command = owner) => {
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw error; }),
      (value) => { report = value; }), (caught) => caught === error);
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.ok(!JSON.stringify(report).includes("PRIVATE"));
    return report.commands[0]!.failures;
  };
  const base = { code: "VALIDATION_ERROR", stage: "validation", count: 1, validation: parseValidation } as const;
  for (const rejection of CLI_TIMING_PARSE_REJECTIONS) {
    assert.deepEqual(await capture(parseRejectionEnvelope(rejection)), [{ ...base, rejection }]);
    assert.deepEqual(await capture(parseRejectionEnvelope(rejection), "event list"),
      [{ ...base, validation: { ...parseValidation } }]);
    const research = Object.assign(new Error("PRIVATE_MESSAGE"), { code: "research_scout_invalid_batch_payload" });
    Object.defineProperty(research, "cliTimingRejection", { value: rejection });
    assert.deepEqual(await capture(research, "research scout-batch"),
      [{ code: "research_scout_invalid_batch_payload", stage: "unknown", count: 1 }]);
  }
  let reads = 0;
  for (const value of ["envelope", "PRIVATE_REASON", "Unknown_flag", new String("unknown_flag"), ["missing_value"], 1]) {
    assert.deepEqual(await capture(parseRejectionEnvelope(value)), [{ ...base }]);
  }
  const accessor = Object.defineProperty(parseRejectionEnvelope(), "cliTimingRejection",
    { enumerable: true, get: () => { reads += 1; return "unknown_flag"; } });
  assert.deepEqual(await capture(accessor), [{ ...base }]);
  const inherited = Object.setPrototypeOf(parseRejectionEnvelope(), { cliTimingRejection: "unknown_flag" });
  assert.deepEqual(await capture(inherited), [{ ...base }]);
  assert.equal(reads, 0);
  const other = { ...parseRejectionEnvelope("unknown_flag"), code: "knowledge_page_invalid" };
  assert.deepEqual(cliTimingRejectionFailure(owner, other.code, other, "cliTimingRejection"), {});
});

test("parse rejection variants coalesce, conserve counts and drop only malformed wire detail", () => {
  const aggregate = emptyCliTiming();
  for (const rejection of [...CLI_TIMING_PARSE_REJECTIONS, undefined, CLI_TIMING_PARSE_REJECTIONS[0]]) {
    const incoming = sample("knowledge upsert");
    incoming.commands[0]!.outcome = "error";
    incoming.commands[0]!.failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 1,
      validation: { ...parseValidation }, ...(rejection ? { rejection } : {}) }];
    mergeCliTiming(aggregate, incoming);
  }
  const command = aggregate.commands[0]!;
  assert.equal(command.calls, 4);
  assert.deepEqual(command.failures!.map(({ rejection, count }) => ({ rejection, count })), [
    { rejection: "unknown_flag", count: 2 }, { rejection: "missing_value", count: 1 }, { rejection: undefined, count: 1 },
  ]);
  assert.deepEqual(normalizeCliTiming(aggregate), aggregate);
  const wire = sample("knowledge upsert");
  wire.commands[0]!.outcome = "error";
  wire.commands[0]!.calls = 4;
  const entries = [
    { code: "VALIDATION_ERROR", stage: "validation", count: 1, rejection: "PRIVATE_REASON" },
    { code: "VALIDATION_ERROR", stage: "validation", count: 1, rejection: "envelope" },
    { code: "knowledge_page_invalid", stage: "validation", count: 1, rejection: "unknown_flag" },
    Object.defineProperty({ code: "VALIDATION_ERROR", stage: "validation", count: 1 }, "rejection",
      { enumerable: true, get: () => "missing_value" }),
  ];
  const normalized = normalizeCliTiming({ ...wire, commands: [{ ...wire.commands[0]!, failures: entries }] });
  assert.deepEqual(normalized?.commands[0]!.failures, [
    { code: "VALIDATION_ERROR", stage: "validation", count: 3 },
    { code: "knowledge_page_invalid", stage: "validation", count: 1 },
  ]);
  assert.ok(!JSON.stringify(normalized).includes("PRIVATE"));
});

// Actual pre-parse-rejection reader, never a copied parser.
const parseRejectionCompatibilityBase = process.env.MURPH_CLI_PARSE_REJECTION_COMPAT_BASE;
test.skipIf(!parseRejectionCompatibilityBase)("actual pre-parse-rejection reader drops only the reason and keeps counts", async () => {
  assert.match(parseRejectionCompatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${parseRejectionCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; mergeCliTiming: typeof mergeCliTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  const report = sample("knowledge upsert");
  report.commands[0]!.outcome = "error";
  report.commands[0]!.calls = 3;
  report.commands[0]!.failures = [
    { code: "VALIDATION_ERROR", stage: "validation", count: 1, validation: { ...parseValidation }, rejection: "unknown_flag" },
    { code: "VALIDATION_ERROR", stage: "validation", count: 1, validation: { ...parseValidation }, rejection: "missing_value" },
    { code: "VALIDATION_ERROR", stage: "validation", count: 1, validation: { ...parseValidation } },
  ];
  assert.deepEqual(normalizeCliTiming(report), report);
  const legacy = structuredClone(report);
  legacy.commands[0]!.failures = [{ code: "VALIDATION_ERROR", stage: "validation", count: 3, validation: { ...parseValidation } }];
  assert.deepEqual(old.normalizeCliTiming(report), legacy);
  assert.deepEqual(normalizeCliTiming(legacy), legacy, "New readers never invent a reason for old reports.");
  const oldMerged = emptyCliTiming();
  old.mergeCliTiming(oldMerged, report);
  assert.deepEqual(oldMerged.commands, legacy.commands);
});

test("knowledge show and wearables day admit the same parser reasons; search query admits only filter classes", async () => {
  const capture = async (error: object, command: string) => {
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw error; }),
      (value) => { report = value; }), (caught) => caught === error);
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.ok(!JSON.stringify(report).includes("PRIVATE"));
    return report.commands[0]!.failures;
  };
  const base = { code: "VALIDATION_ERROR", stage: "validation", count: 1, validation: parseValidation } as const;
  for (const command of ["knowledge show", "wearables day"]) {
    for (const rejection of CLI_TIMING_PARSE_REJECTIONS) {
      assert.deepEqual(await capture(parseRejectionEnvelope(rejection), command), [{ ...base, rejection }]);
    }
    for (const rejection of [...CLI_TIMING_FILTER_REJECTIONS, ...CLI_TIMING_REJECTIONS, "PRIVATE_REASON"]) {
      assert.deepEqual(await capture(parseRejectionEnvelope(rejection), command), [{ ...base }]);
    }
  }
  // The shared normalizer's VaultCliError shape: own non-enumerable data, no stage.
  const filterError = (value: unknown, code = "invalid_option") => Object.defineProperty(
    Object.assign(new Error("PRIVATE_MESSAGE"), { code }), "cliTimingRejection", { value });
  const filterBase = { code: "invalid_option", stage: "unknown", count: 1 } as const;
  for (const rejection of CLI_TIMING_FILTER_REJECTIONS) {
    assert.deepEqual(await capture(filterError(rejection), "search query"), [{ ...filterBase, rejection }]);
    // Other callers of the shared normalizer and other codes never admit it.
    for (const command of ["list", "event list", "knowledge show", "journal link"]) {
      assert.deepEqual(await capture(filterError(rejection), command), [{ ...filterBase }]);
    }
    assert.deepEqual(await capture(filterError(rejection, "invalid_query"), "search query"),
      [{ code: "unknown", stage: "unknown", count: 1 }]);
    assert.deepEqual(await capture(parseRejectionEnvelope(rejection), "search query"),
      [{ code: "VALIDATION_ERROR", stage: "validation", count: 1 }]);
  }
  let reads = 0;
  for (const value of [...CLI_TIMING_PARSE_REJECTIONS, "Comma_delimited", "PRIVATE_REASON", new String("comma_delimited"), ["unsupported_value"], 1]) {
    assert.deepEqual(await capture(filterError(value), "search query"), [{ ...filterBase }]);
  }
  const accessor = Object.defineProperty(Object.assign(new Error("PRIVATE_MESSAGE"), { code: "invalid_option" }),
    "cliTimingRejection", { get: () => { reads += 1; return "comma_delimited"; } });
  assert.deepEqual(await capture(accessor, "search query"), [{ ...filterBase }]);
  const inherited = Object.setPrototypeOf(Object.assign(new Error("PRIVATE_MESSAGE"), { code: "invalid_option" }),
    Object.create(Error.prototype, { cliTimingRejection: { value: "comma_delimited" } }));
  assert.deepEqual(await capture(inherited, "search query"), [{ ...filterBase }]);
  assert.equal(reads, 0);
});

test("new rejection owners coalesce per variant and drop malformed wire detail without losing counts", () => {
  for (const [command, code, stage, admitted] of [
    ["exercise list", "VALIDATION_ERROR", "validation", CLI_TIMING_PARSE_REJECTIONS],
    ["knowledge show", "VALIDATION_ERROR", "validation", CLI_TIMING_PARSE_REJECTIONS],
    ["wearables day", "VALIDATION_ERROR", "validation", CLI_TIMING_PARSE_REJECTIONS],
    ["search query", "invalid_option", "unknown", CLI_TIMING_FILTER_REJECTIONS],
  ] as const) {
    const aggregate = emptyCliTiming();
    for (const rejection of [...admitted, undefined, admitted[0]]) {
      const incoming = sample(command);
      incoming.commands[0]!.outcome = "error";
      incoming.commands[0]!.failures = [{ code, stage, count: 1, ...(rejection ? { rejection } : {}) }];
      mergeCliTiming(aggregate, incoming);
    }
    assert.equal(aggregate.commands[0]!.calls, 4);
    assert.deepEqual(aggregate.commands[0]!.failures!.map(({ rejection, count }) => ({ rejection, count })), [
      { rejection: admitted[0], count: 2 }, { rejection: admitted[1], count: 1 }, { rejection: undefined, count: 1 },
    ]);
    assert.deepEqual(normalizeCliTiming(aggregate), aggregate);
    const wire = sample(command);
    wire.commands[0]!.outcome = "error";
    wire.commands[0]!.calls = 4;
    const foreign = admitted === CLI_TIMING_FILTER_REJECTIONS ? "unknown_flag" : "comma_delimited";
    const failure: CliFailureTiming = { code, stage, count: 1,
      ...(command === "exercise list" ? { validation: { ...parseValidation } } : {}) };
    let reads = 0;
    const entries = [
      { ...failure, rejection: "PRIVATE_REASON" },
      { ...failure, rejection: foreign },
      Object.defineProperty({ ...failure }, "rejection", {
        enumerable: true, get: () => { reads += 1; return admitted[0]; },
      }),
      Object.assign(Object.create({ rejection: admitted[0] }), failure),
    ];
    assert.deepEqual(normalizeCliTiming({ ...wire, commands: [{ ...wire.commands[0]!, failures: entries }] })
      ?.commands[0]!.failures, [{ ...failure, count: 4 }]);
    assert.equal(reads, 0);
  }
});

// Actual pre-change reader for the knowledge show, wearables day and search query
// details; it must drop only the optional detail and keep accounting.
const filterRejectionCompatibilityBase = process.env.MURPH_CLI_FILTER_REJECTION_COMPAT_BASE;
test.skipIf(!filterRejectionCompatibilityBase)("actual pre-filter-rejection reader drops only new detail and keeps counts", async () => {
  assert.match(filterRejectionCompatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${filterRejectionCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; mergeCliTiming: typeof mergeCliTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  const report = emptyCliTiming();
  // Typed mutable fixtures: each call builds fresh arrays checked against the contract.
  const argv = (rejection?: CliTimingParseRejection): CliFailureTiming => ({ code: "VALIDATION_ERROR", stage: "validation",
    count: 1, validation: { ...parseValidation }, ...(rejection ? { rejection } : {}) });
  const filtered = (rejection: CliTimingFilterRejection): CliFailureTiming =>
    ({ code: "invalid_option", stage: "unknown", count: 1, rejection });
  const rows: Array<[string, () => CliFailureTiming[], () => CliFailureTiming[]]> = [
    ["knowledge show", () => [argv("unknown_flag"), argv("missing_value")], () => [{ ...argv(), count: 2 }]],
    ["wearables day", () => [argv("unknown_flag"), { code: "VALIDATION_ERROR", stage: "validation", count: 1,
      validation: { field: "date", code: "invalid_format", missing: false } }],
    () => [{ code: "VALIDATION_ERROR", stage: "validation", count: 2 }]],
    ["search query", () => [filtered("comma_delimited"), filtered("unsupported_value")],
      () => [{ code: "invalid_option", stage: "unknown", count: 2 }]],
  ];
  for (const [command, failures, legacy] of rows) {
    const entry = sample(command).commands[0]!;
    report.commands.push({ ...entry, outcome: "error", calls: 2, failures: failures() });
    const expected: CliCommandTiming = { ...entry, outcome: "error", calls: 2, failures: legacy() };
    const current = { ...report, commands: [report.commands.at(-1)!] };
    assert.deepEqual(normalizeCliTiming(current), current);
    assert.deepEqual(old.normalizeCliTiming(current)?.commands, [expected]);
    assert.deepEqual(normalizeCliTiming({ ...report, commands: [expected] })?.commands, [expected],
      "New readers never invent detail for old reports.");
  }
  const oldMerged = emptyCliTiming();
  old.mergeCliTiming(oldMerged, report);
  assert.deepEqual(oldMerged.commands.map(({ command, calls, failures }) => ({ command, calls,
    count: failures!.reduce((sum, item) => sum + item.count, 0) })), [
    { command: "knowledge show", calls: 2, count: 2 },
    { command: "wearables day", calls: 2, count: 2 },
    { command: "search query", calls: 2, count: 2 },
  ]);
});

// Actual history-backed reader, not a copied parser or current-reader roundtrip.
const researchFailureCompatibilityBase = process.env.MURPH_CLI_RESEARCH_FAILURE_COMPAT_BASE;
test.skipIf(!researchFailureCompatibilityBase)("actual pre-research reader collapses only new evidence and preserves mixed counts", async () => {
  assert.match(researchFailureCompatibilityBase ?? "", /^[a-f0-9]{7,40}$/u);
  const source = execFileSync("git", ["show", `${researchFailureCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; cliTimingFailureCode: typeof cliTimingFailureCode } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  for (const code of researchFailureCodes) assert.equal(old.cliTimingFailureCode(code), "unknown");
  let report!: CliTiming;
  await withCliTiming(() => timeCliDispatch("batch", async () => {
    for (const code of [...researchFailureCodes, researchFailureCodes[0]]) {
      const error = Object.assign(new Error("PRIVATE_ERROR_MESSAGE"), { code });
      await assert.rejects(withCliTiming(() => timeCliDispatch("research scout-batch", async () => { throw error; })),
        (caught) => caught === error);
    }
    await withCliTiming(() => timeCliDispatch("research scout-batch", async () => {}));
  }), (value) => { report = value; });
  assert.deepEqual(report.commands[0]!.failures, researchFailureCodes.map((code, index) => ({
    code, stage: "unknown", count: index === 0 ? 2 : 1,
  })));
  assert.deepEqual(report.commands.map(({ outcome, calls }) => ({ outcome, calls })), [
    { outcome: "error", calls: 4 }, { outcome: "ok", calls: 1 },
  ]);
  assert.equal(report.batchContainers, 1);
  assert.equal(report.reportCount, 1);
  assert.equal(report.commands[1]!.failures, undefined);
  assert.deepEqual(normalizeCliTiming(report), report);
  const expected = structuredClone(report);
  expected.commands[0]!.failures = [{ code: "unknown", stage: "unknown", count: 4 }];
  assert.deepEqual(old.normalizeCliTiming(report), expected);
  assert.deepEqual(normalizeCliTiming(expected), expected);
  delete expected.commands[0]!.failures;
  assert.deepEqual(old.normalizeCliTiming(expected), expected);
  assert.deepEqual(normalizeCliTiming(expected), expected);
  // Mixing an old report with no failure evidence adds calls, not invented observations.
  mergeCliTiming(expected, report);
  assert.equal(expected.commands[0]!.calls, 8);
  assert.equal(expected.commands[1]!.calls, 2);
  assert.deepEqual(expected.commands[0]!.failures, report.commands[0]!.failures);
  const oldMixed = structuredClone(expected);
  oldMixed.commands[0]!.failures = [{ code: "unknown", stage: "unknown", count: 4 }];
  assert.deepEqual(old.normalizeCliTiming(expected), oldMixed);
  assert.deepEqual(normalizeCliTiming(oldMixed), oldMixed);
});


const eventReadPhases = ["event-core-load", "event-owner-candidates", "event-owner-revisions"] as const;

test("phase admission is exactly thirty-four fixed names without raising invocation caps", async () => {
  assert.deepEqual(CLI_TIMING_PHASES, [
    "total", "setup", "dispatch", "post-dispatch", "teardown", "unattributed",
    "query-freshness", "query-manifest", "query-status", "query-rebuild", "query-wait",
    "query-source-read", "query-wearable-dataset", "query-metric-projection",
    "query-wearable-summary", "query-search-documents", "query-publication",
    "query-entity-read", "query-wearable-compose", "query-metric-read", "query-pattern-report",
    "service-runtime-load", "query-runtime-load", "query-projection-load",
    "query-metric-samples", "query-metric-evidence", "query-metric-extract",
    "query-metric-precedence", "query-metric-targets",
    "canonical-write-wait", "importers-runtime-load",
    "event-core-load", "event-owner-candidates", "event-owner-revisions",
  ]);
  assert.equal(CLI_TIMING_MAX_COMMANDS, 32);
  assert.equal(CLI_TIMING_MAX_SPANS, 64);
  const report = sample("search query");
  for (const phase of CLI_TIMING_PHASES.slice(1)) {
    assert.equal(addCliPhaseSample(report.commands[0]!.phases, phase, 37_000_000), true);
  }
  assert.equal(report.commands[0]!.phases.length, 34);
  assert.deepEqual(normalizeCliTiming(report), report);
  // Unknown labels are rejected, not pattern-admitted or serialized as paths.
  for (const phase of ["query-publication/PRIVATE_SENTINEL", "QUERY-SOURCE-READ", "query-source-read "]) {
    assert.equal(normalizeCliTiming({ ...report, commands: [{ ...report.commands[0], phases: [
      { ...report.commands[0]!.phases[0], phase },
    ] }] }), null);
  }
  assert.equal(normalizeCliTiming({ ...report, commands: [{ ...report.commands[0],
    phases: [...report.commands[0]!.phases, report.commands[0]!.phases[0]],
  }] }), null);
  await clocked(async advance => {
    let bounded!: CliTiming;
    await withCliTiming(() => timeCliDispatch("search query", async () => {
      for (let index = 0; index < CLI_TIMING_MAX_SPANS + 2; index += 1) {
        const end = startCliPhase(eventReadPhases[index % eventReadPhases.length]!);
        advance(1);
        end();
      }
    }), value => { bounded = value; });
    assert.equal(bounded.droppedSpans, 3); // Dispatch already owns one of 64.
    assert.equal(bounded.commands[0]!.phases.filter(phase => CLI_TIMING_PHASES.slice(11).some(name => name === phase.phase))
      .reduce((count, phase) => count + phase.count, 0), 63);
    assert.deepEqual(normalizeCliTiming(bounded), bounded);
  });
});

test("event read phases emit wall time on success and throw without retaining payloads or sampling CPU", async () => {
  await clocked(async advance => {
    const originalCpuUsage = process.cpuUsage;
    let cpuReads = 0;
    process.cpuUsage = previous => { cpuReads += 1; return originalCpuUsage(previous); };
    try {
      for (const phase of eventReadPhases) {
        const result = { id: "PRIVATE_SENTINEL", note: "PRIVATE_SENTINEL" };
        const failure = Object.assign(new Error("PRIVATE_SENTINEL"), {
          code: "EVENT_CONTRACT_INVALID", path: "PRIVATE_SENTINEL", record: result,
        });
        for (const fail of [false, true]) {
          let report!: CliTiming;
          const run = () => withCliTiming(async () => {
            await timeCliDispatch("meal show", async () => {
              assert.equal(await timeCliPhase(phase, async () => {
                advance(37);
                if (fail) throw failure;
                return result;
              }), result);
            });
            return result;
          }, value => { report = value; });
          if (fail) await assert.rejects(run(), error => error === failure);
          else assert.equal(await run(), result);
          const command = report.commands[0]!;
          assert.equal(command.outcome, fail ? "error" : "ok");
          assert.equal(command.calls, 1);
          assert.deepEqual(command.phases.find(sample => sample.phase === phase), {
            phase, count: 1, sumUs: 37, maxUs: 37, buckets: [1, 0, 0, 0, 0, 0, 0, 0],
          });
          assert.equal(report.droppedSpans, 0);
          assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
          assert.deepEqual(normalizeCliTiming(report), report);
        }
      }
      assert.equal(cpuReads, 0);
    } finally { process.cpuUsage = originalCpuUsage; }
  });
});

test("event read phases remain inactive without a timing sink and preserve results and thrown identity", async () => {
  const previous = process.env.MURPH_CLI_TIMING_ENDPOINT;
  delete process.env.MURPH_CLI_TIMING_ENDPOINT;
  try {
    for (const phase of eventReadPhases) {
      const result = { synthetic: true };
      assert.equal(await withCliTiming(() => timeCliPhase(phase, async () => {
        assert.equal(isCliTimingActive(), false);
        return result;
      })), result);
      const failure = new Error("PRIVATE_SENTINEL");
      await assert.rejects(withCliTiming(() => timeCliPhase(phase, async () => {
        assert.equal(isCliTimingActive(), false);
        throw failure;
      })), error => error === failure);
    }
  } finally {
    if (previous === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
    else process.env.MURPH_CLI_TIMING_ENDPOINT = previous;
  }
});


test("synchronous query stage timing preserves values, immediate execution and thrown identity", async () => {
  const value = { synthetic: true };
  assert.equal(timeCliPhaseSync("query-entity-read", () => value), value);
  await clocked(async advance => {
    let report!: CliTiming;
    const failure = new Error("synthetic decode failure");
    await assert.rejects(withCliTiming(() => timeCliDispatch("wearables latest", async () => {
      assert.equal(timeCliPhaseSync("query-entity-read", () => { advance(12); return value; }), value);
      timeCliPhaseSync("query-metric-read", () => { advance(34); throw failure; });
    }), captured => { report = captured; }), error => error === failure);
    assert.equal(report.commands[0]!.outcome, "error");
    assert.deepEqual(report.commands[0]!.phases.filter(phase => phase.phase.startsWith("query-")).map(
      phase => [phase.phase, phase.count, phase.sumUs]), [["query-entity-read", 1, 12], ["query-metric-read", 1, 34]]);
    assert.deepEqual(normalizeCliTiming(report), report);
  });
});

// Actual pre-admission reader from history; parent supplies the reviewed base.
for (const [admission, compatibilityBase, admitted] of [
  ["load", process.env.MURPH_CLI_LOAD_PHASE_COMPAT_BASE, 21],
  ["metric-subphase", process.env.MURPH_CLI_METRIC_PHASE_COMPAT_BASE, 24],
  ["wait-load", process.env.MURPH_CLI_WAIT_LOAD_PHASE_COMPAT_BASE, 29],
  ["event-read", process.env.MURPH_CLI_EVENT_READ_PHASE_COMPAT_BASE, 31],
] as const) test.skipIf(!compatibilityBase)(`actual pre-${admission} reader drops the whole optional object; new reader keeps old reports`, async () => {
  assert.match(compatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  if (admission === "event-read") assert.equal(compatibilityBase, "4ec40920fca1872c8324d9325c23a9e50ba39754");
  const source = execFileSync("git", ["show", `${compatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { CLI_TIMING_PHASES: readonly string[]; normalizeCliTiming: typeof normalizeCliTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`,
  );
  assert.deepEqual(old.CLI_TIMING_PHASES, CLI_TIMING_PHASES.slice(0, admitted), "compatibility base must precede admission");
  const legacy = sample(admission === "event-read" ? "meal show" : "wearables latest", 1_000);
  assert.deepEqual(old.normalizeCliTiming(legacy), legacy);
  assert.deepEqual(normalizeCliTiming(legacy), legacy);
  for (const phase of CLI_TIMING_PHASES.slice(admitted)) {
    const report = structuredClone(legacy);
    assert.equal(addCliPhaseSample(report.commands[0]!.phases, phase, 500), true);
    assert.deepEqual(normalizeCliTiming(report), report);
    // No partially stripped (falsely complete) record: the old reader rejects it all.
    assert.equal(old.normalizeCliTiming(report), null);
  }
});

test("new meal edit fields remain absent on every other command", () => {
  for (const [, field, code, missing] of mealEditValidationCases) {
    for (const command of ["meal add", "meal remove-photo", "meal show", "event edit", "other"]) {
      for (const property of ["publicIssues", "fieldErrors", "validation"] as const) {
        const source = { [property]: property === "validation" ? { field, code, missing } : [{ path: field, code, missing }] };
        assert.deepEqual(cliTimingValidationFailure(command, "VALIDATION_ERROR", source, property), {});
      }
    }
  }
});

test("invalid_operation is exact meal remove-photo evidence, never a global failure-code admission", async () => {
  for (const command of ["meal remove-photo", "meal edit", "meal add", "event show", "other"]) {
    const expected = command === "meal remove-photo" ? "invalid_operation" : "unknown";
    assert.equal(cliTimingFailureCode("invalid_operation", command), expected);
    const original = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "invalid_operation", cause: { code: "PRIVATE_SENTINEL" } });
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw original; }),
      value => { report = value; }), caught => caught === original);
    assert.deepEqual(report.commands[0]!.failures, [{ code: expected, stage: "unknown", count: 1 }]);
    assert.deepEqual(normalizeCliTiming(report), report);
    const incoming = { ...report, commands: [{ ...report.commands[0],
      failures: [{ code: "invalid_operation", stage: "unknown", count: 1 }] }] };
    assert.deepEqual(normalizeCliTiming(incoming), report);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
    assert.equal(normalizeCliTiming({ ...incoming, commands: [{ ...incoming.commands[0], outcome: "ok" }] })
      ?.commands[0]!.failures, undefined);
  }
  for (const command of [undefined, "MEAL REMOVE-PHOTO", "meal remove-photo ", "meal remove-photo PRIVATE_SENTINEL"]) {
    assert.equal(cliTimingFailureCode("invalid_operation", command), "unknown");
  }
  for (const code of ["unknown", "PRIVATE_SENTINEL", "INVALID_OPERATION", "invalid_operation ",
    "invalid_operation_PRIVATE_SENTINEL", "invalid-operatiоn", { toString() { throw Error("PRIVATE_SENTINEL"); } }]) {
    assert.equal(cliTimingFailureCode(code, "meal remove-photo"), "unknown");
  }
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  let reads = 0;
  const getter = { get() { reads += 1; throw Error("PRIVATE_SENTINEL"); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const error of [Object.defineProperty({}, "code", getter), Object.create({ code: "invalid_operation" }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error("PRIVATE_SENTINEL"); } }), revoked.proxy,
    { cause: { code: "invalid_operation" } }]) {
    let report!: CliTiming;
    await withCliTiming(() => timeCliDispatch("meal remove-photo", async () => {
      noteCliTimingFailure(error); noteCliTimingExit(1, false);
    }), value => { report = value; });
    assert.deepEqual(report.commands[0]!.failures, [{ code: "unknown", stage: "unknown", count: 1 }]);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
  }
  assert.equal(reads, 0);
});

test("meal edit variants saturate independently of calls and legacy absence", () => {
  const aggregate = emptyCliTiming();
  const variants = mealEditValidationCases.flatMap(([, field]) =>
    ["invalid_type", "custom", "too_small"].map(code => ({ field, code, missing: false })));
  for (const validation of [...variants, variants[0]]) {
    const report = sample("meal edit");
    const incoming = normalizeCliTiming({ ...report, commands: [{ ...report.commands[0], outcome: "error",
      failures: [{ code: "VALIDATION_ERROR", stage: "validation", count: 1, validation }] }] });
    assert.ok(incoming);
    mergeCliTiming(aggregate, incoming);
  }
  assert.equal(aggregate.commands[0]!.calls, 10);
  assert.equal(aggregate.commands[0]!.failures?.length, 8);
  assert.equal(aggregate.commands[0]!.failures?.[0]!.count, 2);
  assert.equal(aggregate.commands[0]!.droppedFailures, 1);
  const legacy = sample("meal edit"); legacy.commands[0]!.outcome = "error";
  mergeCliTiming(aggregate, legacy);
  assert.equal(aggregate.commands[0]!.calls, 11);
  assert.equal(aggregate.commands[0]!.failures?.reduce((sum, failure) => sum + failure.count, 0), 9);
  assert.deepEqual(normalizeCliTiming(aggregate), aggregate);
});

const mealFailureCompatibilityBase = process.env.MURPH_CLI_MEAL_FAILURE_ATTRIBUTION_COMPAT_BASE;
test.skipIf(!mealFailureCompatibilityBase)("actual pre-meal-attribution reader loses specificity, not timing", async () => {
  assert.match(mealFailureCompatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const source = execFileSync("git", ["show", `${mealFailureCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; cliTimingFailureCode: typeof cliTimingFailureCode } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  assert.equal(old.cliTimingFailureCode("invalid_operation", "meal remove-photo"), "unknown");
  const report = sample("meal remove-photo");
  Object.assign(report.commands[0]!, { outcome: "error", calls: 3, droppedFailures: 1,
    failures: [{ code: "invalid_operation", stage: "unknown", count: 1 }, { code: "unknown", stage: "unknown", count: 1 }] });
  const legacy = structuredClone(report);
  legacy.commands[0]!.failures = [{ code: "unknown", stage: "unknown", count: 2 }];
  assert.deepEqual(normalizeCliTiming(report), report);
  assert.deepEqual(old.normalizeCliTiming(report), legacy);
  assert.deepEqual(normalizeCliTiming(legacy), legacy);
  const merged = emptyCliTiming(); mergeCliTiming(merged, report); mergeCliTiming(merged, legacy);
  const oldMerged = emptyCliTiming(); mergeCliTiming(oldMerged, legacy); mergeCliTiming(oldMerged, legacy);
  assert.deepEqual(old.normalizeCliTiming(merged), oldMerged);
  assert.equal(normalizeCliTiming(legacy)?.commands[0]!.failures?.[0]!.code, "unknown", "Never backfill old evidence.");
});

const sourceCauseCases = [
  ["meal edit", ["contract_invalid", "invalid_timestamp", "vault_error"]],
  ["meal remove-photo", ["vault_error"]],
  ["food search-labels-batch", [
    "food_labels_api_auth_failed", "food_labels_api_rate_limited", "food_labels_api_request_timed_out",
    "food_labels_api_service_unavailable", "food_labels_api_response_failed",
    "food_labels_api_response_body_timed_out", "food_labels_api_response_body_failed", "food_labels_api_invalid_response",
  ]],
  ["research scout-batch", [
    "research_exa_auth_failed", "research_exa_rate_limited", "research_exa_unavailable",
    "research_exa_invalid_response", "research_exa_request_rejected", "research_exa_timeout",
  ]],
] as const;

test("source causes preserve original errors, legacy code/stage and first-observation accounting", async () => {
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  for (const [command, codes] of sourceCauseCases) for (const code of codes) {
    const stage = command.startsWith("meal ") ? "unknown" : "response";
    const context = { stage, vaultCode: "MEAL_PHOTO_RETENTION_PRECONDITION_FAILED", value: "PRIVATE_SENTINEL" };
    const original = Object.assign(new Error("PRIVATE_SENTINEL"), { code, context,
      cause: { code: "PRIVATE_SENTINEL" }, sourceCause: { code: "PRIVATE_SENTINEL" } });
    const visible = JSON.stringify(original);
    const sourceCause: CliTimingSourceCause = { code, ...(command === "meal remove-photo"
      ? { vaultCode: "MEAL_PHOTO_RETENTION_PRECONDITION_FAILED" as const } : {}) };
    let report!: CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => {
      noteCliTimingFailure(original);
      noteCliTimingFailure({ code: "PRIVATE_SENTINEL" });
      throw original;
    }), value => { report = value; }), caught => caught === original);
    assert.equal(JSON.stringify(original), visible, "Observation never mutates the original error.");
    assert.equal(cliTimingFailureCode(code, command), "unknown", "Global code admission is unchanged.");
    assert.equal(report.reportCount, 1);
    assert.equal(report.commands[0]!.calls, 1);
    assert.deepEqual(report.commands[0]!.failures, [{ code: "unknown", stage, count: 1, sourceCause }]);
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
    context.vaultCode = "PRIVATE_SENTINEL";
    assert.deepEqual(report.commands[0]!.failures![0]!.sourceCause, sourceCause, "No source object is retained.");
    await withCliTiming(() => timeCliDispatch(command, async () => {
      noteCliTimingFailure(original);
      noteCliTimingExit(0, false);
    }), value => { report = value; });
    assert.equal(report.commands[0]!.outcome, "ok");
    assert.equal(report.commands[0]!.failures, undefined);
  }
});

test("source cause admission is exact, command gated and independent of arbitrary provider strings", () => {
  let reads = 0;
  const uninspected = new Proxy({}, { getOwnPropertyDescriptor() { reads += 1; throw Error("PRIVATE_SENTINEL"); } });
  for (const command of [undefined, "other", "meal add", "meal show", "food search-labels", "research scout",
    "MEAL EDIT", "meal edit ", "meal edit PRIVATE_SENTINEL"]) {
    for (const [, codes] of sourceCauseCases) for (const code of codes) {
      assert.deepEqual(cliTimingSourceCauseFailure(command, code, uninspected, "context"), {});
      assert.deepEqual(cliTimingSourceCauseFailure(command, "unknown", uninspected, "sourceCause"), {});
    }
  }
  for (const [command, codes] of sourceCauseCases) {
    for (const code of [undefined, "unknown", "PRIVATE_SENTINEL", "food_labels_api_credential_missing",
      "food_labels_api_request_failed", "research_exa_aborted", "research_exa_request_failed", "research_exa_request_invalid",
      ...codes.flatMap(value => [value.toUpperCase(), ` ${value}`, `${value} `, `${value}_PRIVATE_SENTINEL`]),
      [codes[0]], new String(codes[0]), { toString() { throw Error("PRIVATE_SENTINEL"); } }]) {
      assert.deepEqual(cliTimingSourceCauseFailure(command, code, uninspected, "context"), {});
    }
    for (const code of [undefined, "not_found", "invalid_payload", "PRIVATE_SENTINEL"]) {
      assert.deepEqual(cliTimingSourceCauseFailure(command, code, uninspected, "sourceCause"), {});
    }
    for (const [otherCommand, otherCodes] of sourceCauseCases) for (const code of otherCodes) {
      if (codes.some(allowed => allowed === code)) continue;
      assert.notEqual(command, otherCommand);
      assert.deepEqual(cliTimingSourceCauseFailure(command, code, uninspected, "context"), {});
    }
  }
  assert.equal(reads, 0, "Gates run before descriptor inspection.");
  for (const command of ["meal edit", "meal remove-photo"]) {
    const context = { vaultCode: "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" };
    const expected = { sourceCause: { code: "vault_error", ...(command === "meal remove-photo" ? context : {}) } };
    assert.deepEqual(cliTimingSourceCauseFailure(command, "vault_error", { context }, "context"), expected);
    assert.deepEqual(cliTimingSourceCauseFailure(command, "unknown", { sourceCause: { code: "vault_error", ...context } }, "sourceCause"), expected);
  }
});

test("source cause own descriptors cannot invoke getters, coercion, prototypes or cause chains", async () => {
  const { noteCliTimingFailure } = await import("../src/node/cli-timing.ts");
  let reads = 0;
  const getter = { get() { reads += 1; throw Error("PRIVATE_SENTINEL"); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw Error("PRIVATE_SENTINEL"); },
    get: getter.get, getPrototypeOf: getter.get, ownKeys: getter.get });
  const cases: Array<[unknown, CliTimingSourceCause | undefined]> = [
    [Object.defineProperty({}, "code", getter), undefined],
    [Object.create({ code: "vault_error", context: { vaultCode: "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" } }), undefined],
    [{ cause: { code: "vault_error" } }, undefined],
    [hostile, undefined], [revoked.proxy, undefined],
    [{ code: "vault_error", context: hostile }, { code: "vault_error" }],
    [Object.defineProperty({ code: "vault_error" }, "context", getter), { code: "vault_error" }],
    [{ code: "vault_error", context: Object.create({ vaultCode: "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" }) }, { code: "vault_error" }],
    [{ code: "vault_error", context: Object.defineProperty({}, "vaultCode", getter) }, { code: "vault_error" }],
    [{ code: "vault_error", context: { vaultCode: "PRIVATE_SENTINEL" } }, { code: "vault_error" }],
    [{ code: "vault_error", context: { vaultCode: new String("MEAL_PHOTO_RETENTION_MANIFEST_INVALID") } }, { code: "vault_error" }],
  ];
  const good = { code: "vault_error", context: { vaultCode: "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" } };
  for (const key of ["name", "message", "cause", "args", "result", "path"]) Object.defineProperty(good, key, getter);
  cases.push([good, { code: "vault_error", vaultCode: "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" }]);
  for (const [error, sourceCause] of cases) {
    let report!: CliTiming;
    // Capture without asking the unchanged application/EPIPE error path to
    // inspect deliberately hostile metadata; this pins the diagnostic boundary.
    await withCliTiming(() => timeCliDispatch("meal remove-photo", async () => {
      noteCliTimingFailure(error); noteCliTimingExit(1, false);
    }), value => { report = value; });
    assert.deepEqual(report.commands[0]!.failures, [{ code: "unknown", stage: "unknown", count: 1,
      ...(sourceCause ? { sourceCause } : {}) }]);
    assert.deepEqual(normalizeCliTiming(report), report);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
  }
  // A proxy can manufacture a descriptor, but only an exact finite primitive
  // can escape it. No getter, enumeration or prototype trap is needed.
  for (const value of ["MEAL_PHOTO_RETENTION_MANIFEST_INVALID", "PRIVATE_SENTINEL", {}, ["MEAL_PHOTO_RETENTION_MANIFEST_INVALID"]]) {
    const context = new Proxy({}, { getOwnPropertyDescriptor: () => ({ value, configurable: true }),
      get: getter.get, ownKeys: getter.get, getPrototypeOf: getter.get });
    assert.deepEqual(cliTimingSourceCauseFailure("meal remove-photo", "vault_error", { context }, "context"),
      { sourceCause: { code: "vault_error", ...(value === "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" ? { vaultCode: value } : {}) } });
  }
  noteCliTimingFailure(hostile); // Inactive observation does no work.
  assert.equal(reads, 0);
});

test("malformed source cause wire detail drops independently of valid failures and legacy timing", () => {
  const report = sample("meal edit");
  const command = report.commands[0]!;
  command.outcome = "error";
  command.failures = [{ code: "unknown", stage: "validation", count: 1 }];
  let reads = 0;
  const getter = { get() { reads += 1; throw Error("PRIVATE_SENTINEL"); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const sourceCause of [undefined, null, [], Object.assign([], { code: "contract_invalid" }),
    "contract_invalid", { code: "PRIVATE_SENTINEL" }, { code: "food_labels_api_invalid_response" },
    Object.create({ code: "contract_invalid" }), Object.defineProperty({}, "code", getter),
    { code: { toString: getter.get } }, new Proxy({}, { getOwnPropertyDescriptor() { throw Error("PRIVATE_SENTINEL"); } }), revoked.proxy]) {
    assert.deepEqual(normalizeCliTiming({ ...report, commands: [{ ...command,
      failures: [{ ...command.failures[0], sourceCause }] }] }), report);
  }
  for (const failure of [Object.defineProperty({ ...command.failures[0] }, "sourceCause", getter),
    Object.assign(Object.create({ sourceCause: { code: "contract_invalid" } }), command.failures[0])]) {
    assert.deepEqual(normalizeCliTiming({ ...report, commands: [{ ...command, failures: [failure] }] }), report);
  }
  assert.equal(reads, 0);
  const withDetail = { ...report, commands: [{ ...command, failures: [{ ...command.failures[0],
    sourceCause: { code: "contract_invalid", vaultCode: "PRIVATE_SENTINEL", message: "PRIVATE_SENTINEL" } }] }] };
  assert.deepEqual(normalizeCliTiming(withDetail)?.commands[0]!.failures,
    [{ ...command.failures[0], sourceCause: { code: "contract_invalid" } }]);
  assert.equal(JSON.stringify(normalizeCliTiming(withDetail)).includes("PRIVATE_SENTINEL"), false);
  for (const code of [undefined, "PRIVATE_SENTINEL", "contract_invalid", "invalid_payload"]) {
    const input = { ...report, commands: [{ ...command, failures: [{ code, stage: "validation", count: 1,
      sourceCause: { code: "contract_invalid" },
    }] }] };
    assert.deepEqual(normalizeCliTiming(input)?.commands[0]!.failures,
      [{ code: code === "invalid_payload" ? code : "unknown", stage: "validation", count: 1 }],
      "Only an own wire code of unknown admits detail; mapping a future code to unknown cannot authorize it.");
  }
  assert.equal(normalizeCliTiming({ ...withDetail, commands: [{ ...withDetail.commands[0], outcome: "ok" }] })
    ?.commands[0]!.failures, undefined);
  for (const vaultCode of [undefined, null, "PRIVATE_SENTINEL", "MEAL_PHOTO_RETENTION_SOURCE_INVALID",
    "MEAL_PHOTO_RETENTION_MANIFEST_INVALID ", { toString: getter.get }]) {
    const input = { ...report, commands: [{ ...command, command: "meal remove-photo", failures: [{
      code: "unknown", stage: "unknown", count: 1, sourceCause: { code: "vault_error", vaultCode },
    }] }] };
    assert.deepEqual(normalizeCliTiming(input)?.commands[0]!.failures,
      [{ code: "unknown", stage: "unknown", count: 1, sourceCause: { code: "vault_error" } }]);
  }
  assert.equal(reads, 0);
});

test("source cause variants share cap eight, preserve drops and copy finite detail independently", () => {
  const aggregate = emptyCliTiming();
  const codes = sourceCauseCases[2][1];
  for (const code of [...codes, undefined, codes[0]]) {
    const incoming = sample("food search-labels-batch");
    Object.assign(incoming.commands[0]!, { outcome: "error", failures: [{ code: "unknown", stage: "response", count: 1,
      ...(code ? { sourceCause: { code } } : {}) }] });
    const before = structuredClone(incoming);
    mergeCliTiming(aggregate, incoming);
    assert.deepEqual(incoming, before);
    const cause = incoming.commands[0]!.failures![0]!.sourceCause;
    if (cause) cause.code = "food_labels_api_invalid_response";
  }
  const legacy = sample("food search-labels-batch"); legacy.commands[0]!.outcome = "error";
  mergeCliTiming(aggregate, legacy);
  const command = aggregate.commands[0]!;
  assert.equal(command.calls, 11);
  assert.equal(command.failures!.length, CLI_TIMING_MAX_FAILURES);
  assert.deepEqual(command.failures!.map(failure => failure.sourceCause?.code), codes);
  assert.equal(command.failures![0]!.count, 2);
  assert.equal(command.droppedFailures, 1);
  assert.equal(command.failures!.reduce((sum, failure) => sum + failure.count, 0) + command.droppedFailures!, 10);
  assert.equal(aggregate.droppedCalls, 0);
  assert.equal(aggregate.droppedSpans, 0);
  assert.deepEqual(normalizeCliTiming(aggregate), aggregate);
  const repeated = { ...command, calls: 2, droppedFailures: 0, failures: [command.failures![1], command.failures![1]] };
  assert.deepEqual(normalizeCliTiming({ ...aggregate, commands: [repeated] })?.commands[0]!.failures,
    [{ ...command.failures![1], count: 2 }]);
  const overflow = structuredClone(aggregate);
  overflow.commands[0]!.calls = Number.MAX_SAFE_INTEGER;
  const unchanged = structuredClone(overflow.commands);
  mergeCliTiming(overflow, legacy);
  assert.deepEqual(overflow.commands, unchanged);
  assert.equal(overflow.droppedCalls, 1);
});

const sourceCauseCompatibilityBase = process.env.MURPH_CLI_SOURCE_CAUSE_COMPAT_BASE;
test.skipIf(!sourceCauseCompatibilityBase)("actual base reader drops only source cause, including capped and mixed reports", async () => {
  assert.equal(sourceCauseCompatibilityBase, "704630e3fda169456458db4c7a0f50121be120ee");
  const source = execFileSync("git", ["show", `${sourceCauseCompatibilityBase}:packages/runtime-state/src/cli-timing.ts`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const old: { normalizeCliTiming: typeof normalizeCliTiming; mergeCliTiming: typeof mergeCliTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  const report = sample("meal remove-photo");
  Object.assign(report.commands[0]!, { outcome: "error", calls: 5, droppedFailures: 1, failures: [
    { code: "unknown", stage: "unknown", count: 1, sourceCause: { code: "vault_error", vaultCode: "MEAL_PHOTO_RETENTION_PRECONDITION_FAILED" } },
    { code: "unknown", stage: "unknown", count: 1, sourceCause: { code: "vault_error", vaultCode: "MEAL_PHOTO_RETENTION_MANIFEST_INVALID" } },
    { code: "unknown", stage: "unknown", count: 1, sourceCause: { code: "vault_error" } },
    { code: "unknown", stage: "unknown", count: 1 },
  ] });
  const expected = structuredClone(report);
  expected.commands[0]!.failures = [{ code: "unknown", stage: "unknown", count: 4 }];
  assert.deepEqual(normalizeCliTiming(report), report);
  assert.deepEqual(old.normalizeCliTiming(report), expected);
  assert.deepEqual(normalizeCliTiming(expected), expected, "Never invent missing historical causes.");
  const mixed = emptyCliTiming(); mergeCliTiming(mixed, report); mergeCliTiming(mixed, expected);
  const oldMixed = emptyCliTiming(); old.mergeCliTiming(oldMixed, report); old.mergeCliTiming(oldMixed, expected);
  assert.deepEqual(old.normalizeCliTiming(mixed), oldMixed);
  assert.equal(oldMixed.commands[0]!.calls, 10);
  assert.equal(oldMixed.commands[0]!.droppedFailures, 2);
  delete expected.commands[0]!.failures; delete expected.commands[0]!.droppedFailures;
  assert.deepEqual(old.normalizeCliTiming(expected), expected);
  assert.deepEqual(normalizeCliTiming(expected), expected);
});
