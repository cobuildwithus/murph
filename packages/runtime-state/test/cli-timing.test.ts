import assert from "node:assert/strict";
import { test } from "vitest";

import {
  addCliPhaseSample, CLI_TIMING_MAX_COMMANDS, CLI_TIMING_MAX_SPANS,
  CLI_TIMING_PHASES, cliTimingCommand, emptyCliTiming, mergeCliTiming,
  normalizeCliTiming, type CliTiming,
} from "../src/cli-timing.ts";
import {
  finishCliTimingAction, isCliTimingActive, noteCliTimingExit,
  startCliPhase, timeCliDispatch, timeCliPhase, withCliTiming,
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
  const names = ["age calculate", "age evidence", "age inputs", "age model-cards", "age preview",
    "age preview-view", "age report", "age scaffold", "allergy list", "allergy save", "allergy show",
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


test("optional normalization uses bounded indexed reads and never retains an unchecked accessor value", () => {
  const timing = sample("experiment session log");
  timing.commands[0]!.outcome = "error";
  let countReads = 0;
  const failures = [{ code: "conflict", stage: "write",
    get count() { countReads += 1; return countReads === 1 ? 1 : "PRIVATE_SENTINEL"; },
  }];
  Object.defineProperty(failures, Symbol.iterator, { get() { throw new Error("PRIVATE_SENTINEL"); } });
  const normalized = normalizeCliTiming({ ...timing, commands: [{ ...timing.commands[0], failures }] });
  assert.deepEqual(normalized?.commands[0]!.failures, [{ code: "conflict", stage: "write", count: 1 }]);
  assert.equal(countReads, 1);
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
