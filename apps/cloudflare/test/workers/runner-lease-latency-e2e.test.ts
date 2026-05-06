/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface LatencySummary {
  avgMs: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  samples: number;
  totalMs: number;
}

interface LeaseLatencyResponse {
  estimatedAddedLatency: LatencySummary;
  headerOnly: LatencySummary;
  iterations: number;
  liveLease: LatencySummary;
  warmupIterations: number;
}

describe("runner live lease validation latency e2e", () => {
  it("measures the Worker-to-Durable-Object cost over header-only lease checks", async () => {
    const iterations = 250;
    const response = await SELF.fetch("https://worker.test/__test/runner/lease-latency", {
      body: JSON.stringify({
        iterations,
        userId: `member_runner_lease_latency_${Date.now()}`,
        warmupIterations: 25,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    const metrics = await response.json() as LeaseLatencyResponse;

    console.log(
      [
        "Hosted live lease validation latency:",
        `samples=${metrics.iterations}`,
        `headerAvg=${metrics.headerOnly.avgMs}ms`,
        `liveAvg=${metrics.liveLease.avgMs}ms`,
        `addedAvg=${metrics.estimatedAddedLatency.avgMs}ms`,
        `addedP50=${metrics.estimatedAddedLatency.p50Ms}ms`,
        `addedP95=${metrics.estimatedAddedLatency.p95Ms}ms`,
      ].join(" "),
    );

    expect(metrics.iterations).toBe(iterations);
    expect(metrics.warmupIterations).toBe(25);
    expect(metrics.headerOnly.samples).toBe(iterations);
    expect(metrics.liveLease.samples).toBe(iterations);
    expect(metrics.estimatedAddedLatency.samples).toBe(iterations);
    expect(metrics.liveLease.totalMs).toBeGreaterThan(metrics.headerOnly.totalMs);
    expect(metrics.estimatedAddedLatency.avgMs).toBeGreaterThanOrEqual(0);
  });
});
