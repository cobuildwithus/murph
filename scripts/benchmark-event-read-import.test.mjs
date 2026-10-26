import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as protocol from "../packages/runtime-state/src/cli-timing.ts";
import {
  assertMealTiming, assertOutputParity, coldPairs, distribution, importWorkRemoved,
  narrowImports, runCli, telemetrySides, withCliTimingReceipt,
} from "./benchmark-event-read-import.mjs";

const root = "@murphai/core/dist/index.js";
const reader = "@murphai/core/dist/event-read.js";
const inventory = (names, modules = 20, fileBytes = 2_000) => ({
  core: names.map((module) => ({ module })), modules, fileBytes, outsideBundle: 0,
});
const output = () => ({ status: 0, stdout: Buffer.from('{"synthetic":true}\n'),
  stderr: Buffer.alloc(0), wallMs: 10, childWallMs: 9, cpuMs: 8 });

test("import acceptance requires real whole-process work removal and the native semantic entry", () => {
  const base = inventory([root], 40, 4_000);
  const candidate = inventory([reader]);
  assert.equal(importWorkRemoved(base, candidate), true);
  for (const rejected of [inventory([reader, root]), inventory([]),
    inventory([reader, "@murphai/core/dist/automation.js"]),
    { ...candidate, outsideBundle: 1 }]) {
    assert.equal(narrowImports(rejected), false);
    assert.equal(importWorkRemoved(base, rejected), false);
  }
  assert.equal(importWorkRemoved(candidate, candidate), false);
  assert.equal(importWorkRemoved(base, { ...candidate, modules: 40 }), false);
  assert.equal(importWorkRemoved(base, { ...candidate, fileBytes: 4_000 }), false);
});

test("parity compares every stdout/stderr byte and exit status without normalization", () => {
  const expected = output();
  assert.doesNotThrow(() => assertOutputParity(output(), expected));
  for (const changed of [{ status: 1 }, { stdout: Buffer.from('{ "synthetic": true }\n') },
    { stderr: Buffer.from("unexpected\n") }]) {
    assert.throws(() => assertOutputParity({ ...output(), ...changed }, expected), /parity-failed/u);
  }
});

test("pairs are sequential, alternate order, discard only two warmup pairs, and retain all measured samples", async () => {
  const order = []; let active = 0;
  const result = await coldPairs(async (label) => {
    assert.equal(active++, 0);
    order.push(label);
    await Promise.resolve();
    active--;
    return { ...output(), wallMs: label === "base" ? 10 : 8 };
  }, 10);
  assert.equal(order.length, 24);
  for (let i = 0; i < 12; i++) {
    assert.deepEqual(order.slice(i * 2, i * 2 + 2), i % 2 ? ["candidate", "base"] : ["base", "candidate"]);
  }
  assert.equal(result.samples.length, 10);
  assert.deepEqual(result.summary.wallMs.candidateMinusBase, { min: -2, median: -2, max: -2 });
  assert.equal(result.summary.wallMs.candidateOverBase.median, 0.8);
  await assert.rejects(coldPairs(async (label) => ({ ...output(), status: label === "base" ? 0 : 1 })), /parity-failed/u);
  await assert.rejects(coldPairs(async () => output(), 3), /invalid-pair-count/u);
  assert.deepEqual(distribution([1, 9, 3, 5]), { min: 1, median: 4, max: 9 });
});

const coarse = ["event-core-load", "event-owner-candidates", "event-owner-revisions"];
const breakdown = ["candidates", "revisions"].flatMap((pass) =>
  ["source", "path", "read", "decode", "parse", "select"].map((operation) => `event-owner-${pass}-${operation}`));
function timingReport(includeBreakdown = true) {
  const report = protocol.emptyCliTiming();
  report.reportCount = 1;
  const phases = [];
  for (const phase of [...coarse, ...(includeBreakdown ? breakdown : [])]) {
    protocol.addCliPhaseSample(phases, phase, 0);
  }
  report.commands.push({ command: "meal show", outcome: "ok", calls: 1, phases });
  return report;
}

test("telemetry stays opt-in and comparison only switches the two sides of one control artifact", () => {
  for (const mode of ["check", "control", "pairs"]) {
    assert.deepEqual(telemetrySides(mode), { base: false, candidate: false });
    assert.deepEqual(telemetrySides(mode, "on"), { base: true, candidate: true });
  }
  assert.deepEqual(telemetrySides("control", "compare"), { base: false, candidate: true });
  for (const mode of ["check", "pairs"]) assert.throws(() => telemetrySides(mode, "compare"));
  for (const setting of ["", "true", "enabled"]) assert.throws(() => telemetrySides("pairs", setting));
});

test("meal receipt proof rejects loss and partial breakdowns and emits only fixed numeric/enum fields", () => {
  const report = timingReport();
  report.key = "SYNTHETIC_PRIVATE";
  report.commands[0].argv = ["SYNTHETIC_PRIVATE"];
  report.commands[0].phases[0].path = "SYNTHETIC_PRIVATE";
  const safe = assertMealTiming(report, true);
  assert.equal(safe.reportCount, 1);
  assert.equal(safe.command, "meal show");
  assert.equal(safe.outcome, "ok");
  assert.equal(safe.calls, 1);
  assert.equal(safe.droppedSpans, 0);
  assert.equal(JSON.stringify(safe).includes("SYNTHETIC_PRIVATE"), false);
  assert.ok(safe.phases.every((phase) => phase.count === 1 && phase.sumUs === 0 && phase.maxUs === 0));
  assert.doesNotThrow(() => assertMealTiming(timingReport(false)));
  assert.throws(() => assertMealTiming(timingReport(false), true));
  for (const [field, value] of [["reportCount", 0], ["reportCount", 2], ["droppedSpans", 1],
    ["droppedCalls", 1], ["outOfWindowReports", 1], ["batchContainers", 1], ["transportTruncated", true]]) {
    assert.throws(() => assertMealTiming({ ...timingReport(), [field]: value }, true));
  }
  for (const change of [{ command: "event show" }, { outcome: "error" }, { calls: 2 }]) {
    const changed = timingReport();
    Object.assign(changed.commands[0], change);
    assert.throws(() => assertMealTiming(changed, true));
  }
  const duplicateCommand = timingReport();
  duplicateCommand.commands.push(structuredClone(duplicateCommand.commands[0]));
  assert.throws(() => assertMealTiming(duplicateCommand, true));
  const missingCoarse = timingReport();
  missingCoarse.commands[0].phases.shift();
  assert.throws(() => assertMealTiming(missingCoarse, true));
  const repeated = timingReport();
  repeated.commands[0].phases.find((phase) => phase.phase === breakdown[0]).count = 2;
  assert.throws(() => assertMealTiming(repeated, true));
  const partial = timingReport(false);
  protocol.addCliPhaseSample(partial.commands[0].phases, breakdown[0], 0);
  assert.throws(() => assertMealTiming(partial));
});

test("off/on pairs retain receipt proof per enabled sample and count warmup receipts separately from measured pairs", async () => {
  const sides = telemetrySides("control", "compare");
  const proof = assertMealTiming(timingReport(), true);
  const order = [];
  const result = await coldPairs(async (label) => {
    order.push(sides[label]);
    return { ...output(), ...(sides[label] ? { cliTiming: proof } : {}) };
  });
  for (let pair = 0; pair < 12; pair++) {
    assert.deepEqual(order.slice(pair * 2, pair * 2 + 2), pair % 2 ? [true, false] : [false, true]);
  }
  assert.deepEqual(result.timingReports, { base: 0, candidate: 12 });
  assert.equal(result.samples.length, 10);
  for (const sample of result.samples) {
    assert.equal(Object.hasOwn(sample.base, "cliTiming"), false);
    assert.deepEqual(sample.candidate.cliTiming, proof);
  }
  assert.equal(Object.hasOwn(await coldPairs(async () => output()), "timingReports"), false);
});

test("native production sender reaches the receipt gate and runCli strips inherited telemetry by default", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "murph-event-read-transport-"));
  const previous = process.env.MURPH_CLI_TIMING_ENDPOINT;
  try {
    const bin = path.join(scratch, "sender.mjs");
    const sender = new URL("../packages/runtime-state/src/node/cli-timing.ts", import.meta.url).href;
    // Transport-only fixture: exercise the actual production sender through the
    // same child launcher/preload. It does not implement or benchmark a meal read.
    await writeFile(bin, `
import { withCliTiming, timeCliDispatch, recordCliPhase } from ${JSON.stringify(sender)};
if (process.argv.includes('--assert-disabled') && process.env.MURPH_CLI_TIMING_ENDPOINT !== undefined) {
  throw new Error('inherited-telemetry-was-not-stripped');
}
await withCliTiming(() => timeCliDispatch('meal show', async () => {
  for (const phase of ${JSON.stringify([...coarse, ...breakdown])}) recordCliPhase(phase, 37);
  process.stdout.write('{"synthetic":true}\\n');
}));
`);
    process.env.MURPH_CLI_TIMING_ENDPOINT = "65000:0123456789abcdef0123456789abcdef";
    const bundle = { root: scratch, bin };
    const disabled = await runCli(bundle, scratch, scratch, ["--assert-disabled"]);
    const enabled = await withCliTimingReceipt(protocol,
      (endpoint) => runCli(bundle, scratch, scratch, [], false, endpoint), true);
    assertOutputParity(enabled, disabled);
    assert.equal(enabled.status, 0);
    assert.equal(enabled.stderr.length, 0);
    assert.equal(enabled.stdout.toString(), '{"synthetic":true}\n');
    assert.equal(disabled.cliTiming, undefined);
    assert.equal(enabled.cliTiming.reportCount, 1);
    assert.equal(enabled.cliTiming.droppedSpans, 0);
    assert.equal(enabled.cliTiming.phases.filter((phase) => breakdown.includes(phase.phase)).length, 12);
  } finally {
    if (previous === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
    else process.env.MURPH_CLI_TIMING_ENDPOINT = previous;
    await rm(scratch, { recursive: true, force: true });
  }
});

test("missing, unauthenticated and duplicate receipts fail closed; callback failure closes its socket", async () => {
  for (const mode of ["missing", "wrong-key", "duplicate"]) {
    await assert.rejects(withCliTimingReceipt(protocol, async (endpoint) => {
      if (mode === "missing") return output();
      const [port, key] = endpoint.split(":");
      const tick = Number(process.hrtime.bigint() / 1_000n);
      const bytes = Buffer.from(JSON.stringify({ key: mode === "wrong-key" ? "wrong" : key,
        startedUs: tick, endedUs: tick, timing: timingReport() }));
      const socket = createSocket("udp4");
      try {
        for (let index = 0; index < (mode === "duplicate" ? 2 : 1); index++) {
          await new Promise((resolve, reject) => socket.send(bytes, Number(port), "127.0.0.1",
            (error) => error ? reject(error) : resolve()));
        }
      } finally { socket.close(); }
      return output();
    }, true), /cli-timing-receipt/u);
  }
  const failure = new Error("synthetic-callback-failure");
  let port;
  await assert.rejects(withCliTimingReceipt(protocol, async (endpoint) => {
    port = Number(endpoint.split(":")[0]);
    throw failure;
  }), (error) => error === failure);
  const replacement = createSocket("udp4");
  try {
    const ready = once(replacement, "listening");
    replacement.bind(port, "127.0.0.1");
    await ready;
  } finally { replacement.close(); }
});
