import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { readHostedWorkspaceSnapshotTarInventory } from "../src/workspace-snapshot-local.js";

const SAMPLE_COUNT = 40;
const WARMUP_COUNT = 10;
const PAYLOAD_SIZES = [100, 1_000, 5_000] as const;

describe("workspace snapshot validation benchmark", () => {
  it("reports control versus portable-entry validation at the trust boundary", () => {
    const report = PAYLOAD_SIZES.map((size) => {
      const entries = buildEntries(size);
      const control = measure(entries, false);
      const validated = measure(entries, true);
      return {
        entries: size,
        control,
        validated,
      };
    });

    process.stdout.write(`${JSON.stringify({
      benchmark: "workspace-snapshot-tar-inventory",
      methodology: {
        warmup: WARMUP_COUNT,
        samples: SAMPLE_COUNT,
        statistic: "median and p95 wall-clock milliseconds; same fixed payload per pair",
        control: "enforcePortableEntries=false",
        validated: "enforcePortableEntries=true",
      },
      report,
    })}\n`);

    for (const result of report) {
      expect(result.control.medianMs).toBeGreaterThanOrEqual(0);
      expect(result.validated.medianMs).toBeGreaterThanOrEqual(0);
      expect(result.control.p95Ms).toBeGreaterThanOrEqual(result.control.medianMs);
      expect(result.validated.p95Ms).toBeGreaterThanOrEqual(result.validated.medianMs);
    }
  });
});

function buildEntries(size: number): string[] {
  return Array.from({ length: size }, (_, index) =>
    `- user ${index % 4096} 2026-07-12 00:00 vault/file-${index}.txt`,
  );
}

function measure(entries: readonly string[], enforcePortableEntries: boolean): {
  medianMs: number;
  p95Ms: number;
} {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    readHostedWorkspaceSnapshotTarInventory(entries, { enforcePortableEntries });
  }

  const samples = Array.from({ length: SAMPLE_COUNT }, () => {
    const start = performance.now();
    readHostedWorkspaceSnapshotTarInventory(entries, { enforcePortableEntries });
    return performance.now() - start;
  }).sort((left, right) => left - right);

  return {
    medianMs: samples[Math.floor(samples.length / 2)] ?? 0,
    p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
  };
}
