/** Run from repo root: node --import tsx packages/runtime-state/bench/cli-timing.ts
 * Warm, sequential, synthetic primitive overhead, not end-to-end CLI performance.
 * No external I/O, provider, database, or socket flush is included in this microbenchmark.
 */
import { timeCliDispatch, timeCliPhase, withCliTiming } from "../src/node/cli-timing.ts";

const warmup = 2_000;
const iterations = 2_000;
const rounds = 15;
const noop = async () => {};
const previousEndpoint = process.env.MURPH_CLI_TIMING_ENDPOINT;
delete process.env.MURPH_CLI_TIMING_ENDPOINT;
let consumed = 0;
async function original() { await noop(); await noop(); }
async function scoped() {
  await timeCliDispatch("goal list", () => timeCliPhase("query-freshness", async () => {
    await timeCliPhase("query-manifest", noop);
    await timeCliPhase("query-status", noop);
  }));
}
const cases = {
  original,
  disabled: () => withCliTiming(scoped),
  enabled: () => withCliTiming(scoped, (report) => { consumed += report.commands[0]?.calls ?? 0; }),
};
const samples = Object.fromEntries(Object.keys(cases).map((name) => [name, [] as number[]]));
try {
  for (const run of Object.values(cases)) for (let i = 0; i < warmup; i += 1) await run();
  // Rotate order to avoid attributing all warm-up/thermal drift to one mode.
  const entries = Object.entries(cases);
  for (let round = 0; round < rounds; round += 1) {
    for (let offset = 0; offset < entries.length; offset += 1) {
      const [name, run] = entries[(round + offset) % entries.length]!;
      const started = process.hrtime.bigint();
      for (let i = 0; i < iterations; i += 1) await run();
      samples[name]!.push(Number(process.hrtime.bigint() - started) / 1_000 / iterations);
    }
  }
  const results = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [name, { medianBlockMeanUs: sorted[Math.floor(sorted.length / 2)],
      minBlockMeanUs: sorted[0], maxBlockMeanUs: sorted.at(-1) }];
  }));
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    warmupPerMode: warmup, iterationsPerRound: iterations, rounds, results, consumed,
    method: "Rotated sequential warm blocks; means per invocation, NOT per-call percentiles. Enabled uses a synchronous discard sink; transport and actual CLI/query work excluded." }, null, 2));
} finally {
  if (previousEndpoint === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT;
  else process.env.MURPH_CLI_TIMING_ENDPOINT = previousEndpoint;
}
