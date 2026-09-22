import { setTimeout as sleep } from "node:timers/promises";
import { runInThisContext } from "node:vm";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
import { startHostedContainerCpuProfiler } from "../src/container-cpu-profiler.ts";

it("captures real V8 stacks and event-loop stalls while the main thread is blocked", async () => {
  const stop = await startHostedContainerCpuProfiler({ emit: mocks.emit });
  try {
    await sleep(100);
    // Synthetic code only; the filename exercises the deployed immutable-asset
    // label boundary without storing a raw profile or using a real local path.
    runInThisContext(`(function syntheticMetricRebuild() {
      const until = performance.now() + 10_500;
      let value = 1;
      while (performance.now() < until) value = Math.sqrt(value + 3);
      return value;
    })()`, { filename: "/app/dist-bundled/synthetic-query.js" });
    await sleep(100);
    const report = mocks.emit.mock.calls.map(([record]) => record.details)
      .find((details) => details.lifecycleStage === "entrypoint-cpu-profile");
    expect(report).toBeDefined();
    expect(report.nodeCpuMs).toBeGreaterThan(500);
    expect(report.profileDurationMs).toBeGreaterThan(10_000);
    expect(report.eventLoopMaxDelayMs).toBeGreaterThan(500);
    expect(report.activeSamples).toBeGreaterThan(10);
    expect(report.topInclusiveFrames.some((frame: { frame: string }) => frame.frame.includes("syntheticMetricRebuild"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("file://");
  } finally { stop(); }
}, 20_000);
