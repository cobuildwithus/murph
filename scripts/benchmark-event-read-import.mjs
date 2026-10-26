import { spawn } from "node:child_process";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const probe = fileURLToPath(new URL("./event-read-import-probe.mjs", import.meta.url));
const ROOT = "@murphai/core/dist/index.js";
const READ = "@murphai/core/dist/event-read.js";
const OWNER_TIMING_PHASES = ["candidates", "revisions"].flatMap((pass) =>
  ["source", "path", "read", "decode", "parse", "select"].map((operation) => `event-owner-${pass}-${operation}`));
let phase = "configuration";
class BenchmarkError extends Error {}
function check(condition, reason) { if (!condition) throw new BenchmarkError(reason); }
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const emit = (value) => console.log(JSON.stringify(value));

function integer(name, fallback, min, max) {
  const text = process.env[name] ?? String(fallback);
  const value = Number(text);
  check(/^\d+$/u.test(text) && Number.isSafeInteger(value) && value >= min && value <= max,
    `invalid-${name}`);
  return value;
}

export function distribution(values) {
  check(values.length > 0 && values.every(Number.isFinite), "invalid-samples");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0], median: sorted.length % 2 ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2, max: sorted.at(-1) };
}

export function assertOutputParity(actual, expected) {
  check(actual.status === expected.status && actual.stdout.equals(expected.stdout)
    && actual.stderr.equals(expected.stderr), "complete-cli-output-parity-failed");
}

export function telemetrySides(mode, setting = "off") {
  check(["off", "on", "compare"].includes(setting), "invalid-telemetry-mode");
  check(setting !== "compare" || mode === "control", "telemetry-compare-requires-control");
  return { base: setting === "on", candidate: setting !== "off" };
}

// Input has passed the installed public normalizer. Project only fixed phase
// names and numbers; never retain transport keys/ticks or raw envelope extras.
export function assertMealTiming(timing, requireBreakdown = false) {
  check(timing?.reportCount === 1 && timing.batchContainers === 0
    && timing.droppedCalls === 0 && timing.droppedSpans === 0
    && timing.outOfWindowReports === 0 && timing.transportTruncated === false
    && timing.commands?.length === 1, "unexpected-cli-timing-summary");
  const command = timing.commands[0];
  check(command.command === "meal show" && command.outcome === "ok" && command.calls === 1,
    "unexpected-cli-timing-command");
  const hasBreakdown = command.phases.some((sample) => OWNER_TIMING_PHASES.includes(sample.phase));
  const names = ["event-core-load", "event-owner-candidates", "event-owner-revisions",
    ...(requireBreakdown || hasBreakdown ? OWNER_TIMING_PHASES : [])];
  const phases = names.map((name) => {
    const sample = command.phases.find((entry) => entry.phase === name);
    check(sample?.count === 1, "expected-cli-timing-phase-missing");
    return { phase: name, count: sample.count, sumUs: sample.sumUs, maxUs: sample.maxUs };
  });
  return { reportCount: timing.reportCount, command: command.command, outcome: command.outcome,
    calls: command.calls, droppedSpans: timing.droppedSpans, phases };
}

// The production engine receiver deliberately has no awaitable bind/receipt
// API. Use the existing native UDP test pattern, with the artifact's normalizer.
// Bind before invoke starts its spawn timer; receipt wait is after child close.
export async function withCliTimingReceipt(protocol, invoke, requireBreakdown = false) {
  const socket = createSocket("udp4");
  const port = randomInt(49_152, 65_536);
  const key = randomBytes(16).toString("hex");
  const startedUs = Number(process.hrtime.bigint() / 1_000n);
  let packets = 0; let invalid = false; let timing; let settle;
  const received = new Promise((resolve) => { settle = resolve; });
  socket.on("error", () => { invalid = true; settle(); });
  socket.on("message", (bytes, remote) => {
    packets++;
    try {
      check(remote.address === "127.0.0.1" && bytes.length <= protocol.CLI_TIMING_MAX_REPORT_BYTES,
        "invalid-cli-timing-receipt");
      const envelope = JSON.parse(bytes.toString("utf8"));
      check(envelope?.key === key && Number.isSafeInteger(envelope.startedUs)
        && Number.isSafeInteger(envelope.endedUs) && envelope.startedUs >= startedUs
        && envelope.endedUs >= envelope.startedUs
        && envelope.endedUs <= Number(process.hrtime.bigint() / 1_000n), "invalid-cli-timing-receipt");
      const normalized = protocol.normalizeCliTiming(envelope.timing);
      check(normalized, "invalid-cli-timing-receipt");
      timing ??= normalized;
    } catch { invalid = true; }
    settle();
  });
  try {
    const listening = once(socket, "listening");
    socket.bind(port, "127.0.0.1");
    await listening;
    const result = await invoke(`${port}:${key}`);
    const deadline = setTimeout(settle, 1_000);
    try {
      await received;
      await setImmediate(); // Dispatch already-queued duplicate datagrams too.
    } finally { clearTimeout(deadline); }
    check(!invalid, "invalid-cli-timing-receipt");
    check(packets === 1 && timing, "cli-timing-receipt-missing-or-duplicate");
    return { ...result, cliTiming: assertMealTiming(timing, requireBreakdown) };
  } finally { try { socket.close(); } catch { /* Also closes on bind/spawn failure. */ } }
}

export function narrowImports(inventory) {
  const names = inventory.core.map((item) => item.module);
  return inventory.outsideBundle === 0 && names.includes(READ) && !names.includes(ROOT)
    && !names.some((name) => /\/dist\/(automation|memory|scheduled-logs)\.js$/u.test(name));
}

export function importWorkRemoved(base, candidate) {
  return base.core.some((item) => item.module === ROOT) && narrowImports(candidate)
    && candidate.modules < base.modules && candidate.fileBytes < base.fileBytes;
}

// Includes metadata and canonical rows; ignores only the established runtime
// residue owner. The hash and sizes, never paths or file contents, are reported.
async function treeReceipt(root, excludeRuntime = false) {
  const hash = createHash("sha256");
  let files = 0; let bytes = 0;
  async function visit(directory, prefix = "") {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (excludeRuntime && !prefix && entry.name === ".runtime") continue;
      const relative = `${prefix}${entry.name}`;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, `${relative}/`);
      else {
        check(entry.isFile(), "unexpected-fixture-or-bundle-file-type");
        const content = await readFile(file);
        hash.update(relative).update("\0").update(content).update("\0");
        files++; bytes += content.length;
      }
    }
  }
  await visit(root);
  return { files, bytes, sha256: hash.digest("hex") };
}

async function installedBundle(argument) {
  const root = await realpath(argument);
  const cli = path.join(root, "node_modules/@murphai/murph");
  const bin = path.join(cli, ".bundle/bin.js");
  await readFile(bin);
  const manifest = JSON.parse(await readFile(path.join(cli, "package.json"), "utf8"));
  check(manifest.name === "@murphai/murph", "assembled-cli-required");
  return { root, bin, require: createRequire(path.join(cli, "package.json")),
    output: await treeReceipt(path.join(cli, ".bundle")) };
}

export async function runCli(bundle, scratch, vault, args, trace = false, endpoint) {
  const receipt = path.join(scratch, "probe.json");
  await rm(receipt, { force: true });
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", probe, bundle.bin,
      "--no-config", ...args, "--vault", vault, "--format", "json"], {
      cwd: scratch,
      env: {
        HOME: scratch, PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
        TZ: "UTC", LANG: "C", NO_COLOR: "1", NODE_DISABLE_COMPILE_CACHE: "1",
        MURPH_EVENT_READ_BENCH_RECEIPT: receipt,
        MURPH_EVENT_READ_BENCH_BUNDLE: bundle.root,
        MURPH_EVENT_READ_BENCH_TRACE: trace ? "1" : "0",
        ...(endpoint === undefined ? {} : { MURPH_CLI_TIMING_ENDPOINT: endpoint }),
      },
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, killSignal: "SIGKILL",
    });
    const stdout = []; const stderr = []; let bytes = 0;
    for (const [stream, target] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) child.kill("SIGKILL");
        else target.push(chunk);
      });
    }
    child.once("error", () => reject(new BenchmarkError("cli-child-start-failed")));
    child.once("close", (status, signal) => {
      if (signal || status === null || bytes > 4 * 1024 * 1024) {
        reject(new BenchmarkError("cli-child-incomplete")); return;
      }
      resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
        wallMs: performance.now() - started });
    });
  });
  const measured = JSON.parse(await readFile(receipt, "utf8"));
  check(measured.exitCode === result.status && measured.trace === trace, "invalid-child-receipt");
  for (const metric of [measured.cpuMs, measured.childWallMs, result.wallMs]) {
    check(Number.isFinite(metric) && metric > 0, "invalid-child-timing");
  }
  return { ...result, ...measured };
}

function validateSuccess(result, vault, expected, exact = false) {
  check(result.status === 0 && result.stderr.length === 0, "cli-read-failed");
  const event = expected.event;
  const data = {
    vault,
    entity: {
      id: event.mealId, kind: "meal", title: event.title, occurredAt: event.occurredAt,
      path: expected.ledgerFile, markdown: null,
      data: { ...event, entityId: event.mealId, eventIds: [event.id] },
      links: exact ? [{ id: event.id, kind: "event", queryable: true }] : [],
    },
  };
  // Ordinary --format json is the complete data payload, without --full-output's
  // nondeterministic duration. Do not strip or normalize any output field.
  check(isDeepStrictEqual(JSON.parse(result.stdout), data), "unexpected-complete-meal-result");
}

function validateError(result, code) {
  check(result.status !== 0 && Boolean(result.stdout.length) !== Boolean(result.stderr.length),
    "unexpected-cli-error-streams");
  const output = JSON.parse(result.stdout.length ? result.stdout : result.stderr);
  check(output.code === code, "unexpected-cli-error");
  if (code === "contract_invalid") check(output.retryable === false
    && output.stage === "read" && typeof output.hint === "string", "lost-read-repair-details");
}

export async function coldPairs(invoke, pairs = 10) {
  check(Number.isInteger(pairs) && pairs >= 8 && pairs <= 40, "invalid-pair-count");
  let expected;
  const samples = [];
  const timingReports = { base: 0, candidate: 0 };
  for (let pair = 0; pair < pairs + 2; pair++) {
    const order = pair % 2 ? ["candidate", "base"] : ["base", "candidate"];
    const row = { first: order[0] };
    for (const label of order) {
      const result = await invoke(label);
      expected ??= result;
      assertOutputParity(result, expected);
      row[label] = { wallMs: result.wallMs, childWallMs: result.childWallMs, cpuMs: result.cpuMs };
      if (result.cliTiming) {
        timingReports[label] += result.cliTiming.reportCount;
        row[label].cliTiming = result.cliTiming;
      }
    }
    if (pair >= 2) samples.push(row);
  }
  const summary = Object.fromEntries(["wallMs", "childWallMs", "cpuMs"].map((metric) => [metric, {
    base: distribution(samples.map((item) => item.base[metric])),
    candidate: distribution(samples.map((item) => item.candidate[metric])),
    candidateMinusBase: distribution(samples.map((item) => item.candidate[metric] - item.base[metric])),
    candidateOverBase: distribution(samples.map((item) => item.candidate[metric] / item.base[metric])),
  }]));
  return { warmupPairs: 2, measuredPairs: pairs, samples, summary,
    ...(timingReports.base || timingReports.candidate ? { timingReports } : {}), output: {
    stdoutBytes: expected.stdout.length, stdoutSha256: sha256(expected.stdout),
    stderrBytes: expected.stderr.length, stderrSha256: sha256(expected.stderr), status: expected.status,
  } };
}

async function correctness(bundles, scratch, vault, fixture, core) {
  async function compare(args, expected, errorCode) {
    const before = await treeReceipt(vault, true);
    let prior;
    for (const bundle of bundles) {
      const result = await runCli(bundle, scratch, vault, args);
      check(isDeepStrictEqual(await treeReceipt(vault, true), before), "canonical-input-mutated");
      if (errorCode) validateError(result, errorCode);
      else validateSuccess(result, vault, expected, args[0] === "event");
      if (prior) assertOutputParity(result, prior);
      prior = result;
    }
  }
  await compare(["event", "show", fixture.expected.eventId], fixture.expected);
  await compare(["meal", "show", fixture.oldOwnerId], null, "not_found");
  const shard = path.join(vault, fixture.freshExpected.ledgerFile);
  const original = await readFile(shard);
  try {
    await appendFile(shard, fixture.freshLine);
    await compare(["meal", "show", fixture.ownerId], fixture.freshExpected);
    const freshBytes = await readFile(shard);
    const duplicate = { ...fixture.freshExpected.event,
      id: core.deterministicContractId("evt", "synthetic-meal-read-duplicate"), lifecycle: { revision: 1 } };
    await appendFile(shard, `${JSON.stringify(duplicate)}\n`);
    await compare(["meal", "show", fixture.ownerId], null, "conflict");
    await writeFile(shard, freshBytes);
    const deleted = { ...fixture.freshExpected.event, lifecycle: { revision: 5, state: "deleted" } };
    await appendFile(shard, `${JSON.stringify(deleted)}\n`);
    await compare(["meal", "show", fixture.ownerId], null, "not_found");
    await compare(["event", "show", fixture.expected.eventId], null, "not_found");
    await writeFile(shard, freshBytes);
    await appendFile(shard, "{\n");
    await compare(["meal", "show", fixture.ownerId], null, "contract_invalid");
  } finally { await writeFile(shard, original); }
}

async function main() {
  const [mode, baseArg, candidateArg] = process.argv.slice(2);
  check(["check", "control", "pairs"].includes(mode) && baseArg
    && (mode === "pairs" ? Boolean(candidateArg) : !candidateArg), "usage-check-or-control-BUNDLE-or-pairs-BASE-CANDIDATE");
  const telemetry = process.env.MURPH_EVENT_READ_TELEMETRY ?? "off";
  const enabled = telemetrySides(mode, telemetry);
  phase = "bundle-load";
  const base = await installedBundle(baseArg);
  const candidate = mode === "pairs" ? await installedBundle(candidateArg) : base;
  const timingProtocol = telemetry === "off" ? null
    : await import(pathToFileURL(candidate.require.resolve("@murphai/runtime-state/cli-timing")).href);
  const core = await import(pathToFileURL(base.require.resolve("@murphai/core")).href);
  const { seedFixture } = await import("../packages/core/bench/meal-read.ts");
  const config = mode === "check" ? { rows: 48, months: 3, noteBytes: 128 } : {
    rows: integer("MURPH_MEAL_READ_ROWS", 24_000, 30, 240_000),
    months: integer("MURPH_MEAL_READ_MONTHS", 24, 3, 120),
    noteBytes: integer("MURPH_MEAL_READ_NOTE_BYTES", 512, 64, 4_000),
  };
  check(config.rows >= config.months, "rows-must-cover-months");
  const scratch = await mkdtemp(path.join(tmpdir(), "murph-event-read-import-"));
  const vault = path.join(scratch, "vault");
  try {
    phase = "fixture";
    await mkdir(vault);
    const fixture = await seedFixture(core, vault, config.rows, config.months, config.noteBytes);
    const input = await treeReceipt(vault, true);
    emit({ scenario: "configuration", mode, node: process.version, platform: process.platform,
      ...(telemetry === "off" ? {} : { telemetry }),
      arch: process.arch, fixtureVersion: 1, ...config, counts: fixture.counts,
      byEncoding: fixture.sizes, input, bundleOutputs: { base: base.output, candidate: candidate.output } });
    const args = ["meal", "show", fixture.ownerId];
    const invoke = (label, trace = false) => {
      const run = (endpoint) => runCli(label === "base" ? base : candidate, scratch, vault, args, trace, endpoint);
      return enabled[label] ? withCliTimingReceipt(timingProtocol, run,
        mode === "check" || (label === "candidate" && (mode === "pairs" || telemetry === "compare"))) : run();
    };
    phase = "import-probe";
    const baseline = await invoke("base", true);
    const narrowed = mode === "check" ? baseline : await invoke("candidate", true);
    validateSuccess(baseline, vault, fixture.expected);
    validateSuccess(narrowed, vault, fixture.expected);
    assertOutputParity(narrowed, baseline);
    check(baseline.inventory.outsideBundle === 0 && narrowed.inventory.outsideBundle === 0,
      "bundle-resolves-outside-artifact");
    emit({ scenario: "loaded-work", performanceTimings: false,
      ...(telemetry === "off" ? {} : { cliTiming: { base: baseline.cliTiming ?? null, candidate: narrowed.cliTiming ?? null } }),
      base: baseline.inventory, candidate: narrowed.inventory,
      removedCoreModules: baseline.inventory.core.map((item) => item.module)
        .filter((name) => !narrowed.inventory.core.some((item) => item.module === name)),
      importWorkRemoved: mode === "pairs" ? importWorkRemoved(baseline.inventory, narrowed.inventory) : null });
    if (mode !== "check") {
      phase = "cold-pairs";
      const timings = await coldPairs(async (label) => {
        const result = await invoke(label);
        validateSuccess(result, vault, fixture.expected);
        assertOutputParity(result, baseline);
        return result;
      }, integer("MURPH_EVENT_READ_PAIRS", 10, 8, 40));
      emit({ scenario: "cold-process-pairs", loadHooks: false,
        ...(telemetry === "off" ? {} : { telemetry }), ...timings });
    }
    phase = "correctness";
    await correctness(mode === "check" ? [candidate] : [base, candidate], scratch, vault, fixture, core);
    check(isDeepStrictEqual(await treeReceipt(vault, true), input), "canonical-input-mutated");
    phase = "import-acceptance";
    if (mode === "check") check(narrowImports(narrowed.inventory), "meal-read-still-loads-core-barrel");
    if (mode === "pairs") check(importWorkRemoved(baseline.inventory, narrowed.inventory), "candidate-removes-no-import-work");
  } finally { await rm(scratch, { recursive: true, force: true }); }
  emit({ scenario: "complete", parityPassed: true, correctnessPassed: true,
    canonicalInputUnchanged: true, fixtureRemoved: true, productionSpeedupClaim: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Even failures must not disclose subprocess output, identifiers, or paths.
    emit({ scenario: "failed", phase, reason: error instanceof BenchmarkError ? error.message : "setup-or-proof-failed" });
    process.exitCode = 1;
  });
}
