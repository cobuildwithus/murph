import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const WARMUP_PAIRS = 2;
export const MEASURED_PAIRS = 7;
const SCENARIOS = ["cold", "event-only-2", "event-only-3", "event-only-repeated",
  "event-then-global", "global-then-event", "warm-global"];

export function resultSignatures(result) {
  assert.deepEqual(result.scenarios.map(({ scenario }) => scenario), SCENARIOS);
  return result.scenarios.map(({ scenario, steps }) => ({ scenario,
    steps: steps.map(({ operation, setup, hash, bytes, count }) => {
      assert.match(hash, /^[a-f0-9]{64}$/u);
      assert.ok(Number.isSafeInteger(bytes) && bytes > 0);
      assert.ok(Number.isSafeInteger(count) && count > 0);
      assert.equal(typeof setup, "boolean");
      return { operation, setup, hash, bytes, count };
    }),
  }));
}

// One fixed fixture path keeps the complete public envelope byte-comparable.
// Invocation injection exists only to test this benchmark driver without Murph.
export async function runEventListPairs(invoke, emit) {
  let expected;
  const measured = [];
  for (let pair = 0; pair < WARMUP_PAIRS + MEASURED_PAIRS; pair++) {
    const warmup = pair < WARMUP_PAIRS;
    const order = pair % 2 === 0 ? ["base", "head"] : ["head", "base"];
    for (const label of order) {
      const scenarios = [];
      for (const scenario of SCENARIOS) {
        // Await each fresh worker before starting another: the derived DB is shared.
        const result = await invoke(label, scenario);
        assert.equal(result.scenario, scenario, "Worker returned the wrong scenario");
        scenarios.push(result);
      }
      const result = { scenarios };
      const signatures = resultSignatures(result);
      expected ??= signatures;
      assert.deepEqual(signatures, expected, `Full output hash/bytes/count changed: ${label}, pair ${pair}`);
      const row = { label, pair: warmup ? pair + 1 : pair - WARMUP_PAIRS + 1, warmup, ...result };
      emit(row);
      if (!warmup) measured.push(row);
    }
  }
  // Ratios use paired TOTAL sequence time, never the first event alone.
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return expected.map(({ scenario }) => {
    const pairs = Array.from({ length: MEASURED_PAIRS }, (_, index) => {
      const total = (label) => measured.find((row) => row.label === label && row.pair === index + 1)
        .scenarios.find((entry) => entry.scenario === scenario);
      return { base: total("base"), head: total("head") };
    });
    return { scenario, pairs: MEASURED_PAIRS,
      baseMedianWallMs: median(pairs.map(({ base }) => base.wallMs)),
      headMedianWallMs: median(pairs.map(({ head }) => head.wallMs)),
      medianPairedWallRatio: median(pairs.map(({ base, head }) => head.wallMs / base.wallMs)),
      baseMedianCpuMs: median(pairs.map(({ base }) => base.cpuMs)),
      headMedianCpuMs: median(pairs.map(({ head }) => head.cpuMs)),
      // Only warm-global has a separately identified setup call. Total ratios
      // above always include it; these fields expose the already-warm read cost.
      baseMedianReadWallMs: median(pairs.map(({ base }) => base.readWallMs)),
      headMedianReadWallMs: median(pairs.map(({ head }) => head.readWallMs)),
      baseMedianReadCpuMs: median(pairs.map(({ base }) => base.readCpuMs)),
      headMedianReadCpuMs: median(pairs.map(({ head }) => head.readCpuMs)),
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  assert.ok(major > 24 || (major === 24 && (minor > 14 || (minor === 14 && patch >= 1))),
    "Use the repository's Node >=24.14.1 runtime.");
  const [base, head] = process.argv.slice(2);
  assert.ok(base && head, "Usage: node scripts/benchmark-event-list.mjs BASE_WORKER.ts HEAD_WORKER.ts");
  const workers = { base: path.resolve(base), head: path.resolve(head) };
  const workerSha256 = Object.fromEntries(await Promise.all(Object.entries(workers).map(async ([label, file]) =>
    [label, createHash("sha256").update(await readFile(file)).digest("hex")])));
  assert.equal(workerSha256.base, workerSha256.head, "Use identical harness source in both checkouts");
  const vault = await mkdtemp(path.join(tmpdir(), "murph-event-list-bench-"));
  try {
    console.log(JSON.stringify({ benchmark: "event-list", node: process.version,
      scenarioIsolation: "process", workerSha256,
      fixture: { providers: 3, days: 365, observations: 8760, notes: 365 },
    }));
    await execute(process.execPath, [workers.base, "seed", vault]);
    const summary = await runEventListPairs(async (label, scenario) => {
      const { stdout } = await execute(process.execPath, [workers[label], "trial", vault, scenario], {
        maxBuffer: 8 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    }, (row) => console.log(JSON.stringify(row)));
    console.log(JSON.stringify({ summary, syntheticOnly: true, productionSpeedupClaim: false }));
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
}
