import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";

afterEach(() => {
  vi.doUnmock("../src/query-projection.ts");
  vi.resetModules();
});

test("query-projection-load times only the public Patterns import resolution and preserves identities", async () => {
  const original = process.hrtime.bigint;
  let clock = 0n;
  const advance = (ms: number) => { clock += BigInt(ms) * 1_000_000n; };
  const report = { synthetic: true };
  const failure = new Error("synthetic report failure");
  const build = vi.fn(async () => { advance(11); return report; })
    .mockImplementationOnce(async () => { advance(11); throw failure; });
  let evaluations = 0;
  vi.resetModules();
  vi.doMock("../src/query-projection.ts", async () => {
    evaluations += 1;
    advance(5);
    return { buildPersonalPatternReportRuntime: build };
  });
  const query = await import("../src/index.ts");
  // The index's static health exports already evaluate query-projection.ts, so the
  // public lazy import is a cached resolution in the normal package graph.
  assert.equal(evaluations, 1);
  // Same post-reset module instance (and AsyncLocalStorage) as the query index.
  const { timeCliDispatch, withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
  const { normalizeCliTiming } = await import("@murphai/runtime-state/cli-timing");
  const timed = async (run: () => Promise<unknown>) => {
    let timing: CliTiming | undefined;
    let settled: { value: unknown } | { error: unknown };
    try {
      let value: unknown;
      await withCliTiming(() => timeCliDispatch("wearables patterns", async () => { value = await run(); }),
        (captured) => { timing = captured; });
      settled = { value };
    } catch (error) {
      settled = { error };
    }
    assert.ok(timing);
    assert.deepEqual(normalizeCliTiming(timing), timing);
    const loads = timing.commands[0]!.phases.filter((phase) => phase.phase.endsWith("-load"))
      .map((phase) => [phase.phase, phase.count, phase.sumUs]);
    return { settled, loads };
  };

  process.hrtime.bigint = () => clock;
  try {
    // Report work (11 ms) is outside the span; the original rejection is unchanged.
    const failed = await timed(() => query.buildPersonalPatternReportRuntime("synthetic-vault", { windowDays: 30 }));
    assert.ok("error" in failed.settled && failed.settled.error === failure);
    assert.deepEqual(failed.loads, [["query-projection-load", 1, 0]]);
    // Node's existing module cache resolves the import; one bounded sample per call.
    const warm = await timed(() => query.buildPersonalPatternReportRuntime("synthetic-vault"));
    assert.ok("value" in warm.settled && warm.settled.value === report);
    assert.deepEqual(warm.loads, [["query-projection-load", 1, 0]]);
    // Other public wrappers are unchanged and record no load phase.
    const other = await timed(() => query.listMetricTargets("synthetic-vault").catch(() => undefined));
    assert.deepEqual(other.loads, []);
    // Telemetry absent: same result object, no scope required.
    assert.equal(await query.buildPersonalPatternReportRuntime("synthetic-vault"), report);
  } finally {
    process.hrtime.bigint = original;
  }
  assert.equal(evaluations, 1);
  assert.deepEqual(build.mock.calls, [
    ["synthetic-vault", { windowDays: 30 }], ["synthetic-vault", {}], ["synthetic-vault", {}],
  ]);
});
