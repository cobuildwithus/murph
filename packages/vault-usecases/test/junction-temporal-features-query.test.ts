import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as coreRuntime from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { listMetricPoints, rebuildQueryProjection } from "@murphai/query";
import { expect, test } from "vitest";

test("Junction sparse claims stay absent while dense bounded evidence reaches query", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "junction-temporal-query-"));
  const vaultRoot = path.join(parentRoot, "vault");
  const snapshot = {
    accountId: "junction-account-hash-1",
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      blood_oxygen: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T07:00:00Z", unit: "percent", value: 88 },
              { timestamp: "2026-04-22T19:00:00Z", unit: "percent", value: 88 },
              { timestamp: "2026-04-23T07:00:00Z", unit: "percent", value: 88 },
              { timestamp: "2026-04-23T07:01:00Z", unit: "percent", value: 88 },
              { timestamp: "2026-04-23T07:02:00Z", unit: "percent", value: 95 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T07:00:00Z", timezone_offset: 0, value: 20 },
              { timestamp: "2026-04-22T19:00:00Z", timezone_offset: 0, value: 80 },
              { timestamp: "2026-04-23T07:00:00Z", timezone_offset: 0, value: 20 },
              { timestamp: "2026-04-23T07:05:00Z", timezone_offset: 0, value: 30 },
              { timestamp: "2026-04-23T18:00:00Z", timezone_offset: 0, value: 70 },
              { timestamp: "2026-04-23T18:05:00Z", timezone_offset: 0, value: 80 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  };

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });
    await importDeviceProviderSnapshot(
      {
        deliveryMode: "scheduled_reconcile",
        provider: "junction",
        snapshot,
        sourceKind: "poll",
        vaultRoot,
      },
      { corePort: coreRuntime },
    );
    await rebuildQueryProjection(vaultRoot);

    const points = await listMetricPoints(vaultRoot, { limit: null });
    const point = (metricKey: string, effectiveDate: string) => points.find((entry) =>
      entry.metricKey === metricKey && entry.effectiveDate === effectiveDate
    );
    const sparseBurden = point("spo2-samples-below-90-percent", "2026-04-22");
    const denseRun = point("spo2-below-90-run-count", "2026-04-23");
    const denseVariation = point(
      "stress-mean-absolute-successive-difference",
      "2026-04-23",
    );
    const denseDaypart = point("stress-evening-minus-morning-score", "2026-04-23");

    expect(point("spo2-below-90-run-count", "2026-04-22")).toBeUndefined();
    expect(point("spo2-longest-below-90-sample-count", "2026-04-22")).toBeUndefined();
    expect(point("stress-above-daily-mean-run-count", "2026-04-22")).toBeUndefined();
    expect(point("stress-mean-absolute-successive-difference", "2026-04-22"))
      .toBeUndefined();
    expect(point("stress-evening-minus-morning-score", "2026-04-22")).toBeUndefined();

    expect(sparseBurden).toMatchObject({
      confidence: "low",
      value: 100,
    });
    expect(sparseBurden?.context.qualifiers).toMatchObject({
      derived: true,
      evidenceConfidence: "low",
      maxAdjacentGapSeconds: 300,
      qualifyingPairCount: 0,
      sampleCount: 2,
      thresholdSampleCount: 2,
    });
    expect(denseRun).toMatchObject({ confidence: "medium", value: 1 });
    expect(denseVariation).toMatchObject({ confidence: "medium", value: 10 });
    expect(denseDaypart).toMatchObject({ confidence: "medium", value: 50 });
    expect(denseVariation?.context.qualifiers).toMatchObject({
      derived: true,
      evidenceConfidence: "medium",
      evidenceMethod: "distinct-instant-mean-median-gap-2.5x-absolute-cap.v2",
      maxAdjacentGapSeconds: 900,
      qualifyingPairCount: 2,
      sampleCount: 4,
      sampleIntervalSeconds: 300,
    });
    expect(denseDaypart?.context.qualifiers).toMatchObject({
      eveningSampleCount: 2,
      morningSampleCount: 2,
      qualifyingPairCount: 2,
      sampleCount: 4,
    });

    for (const derivedPoint of [sparseBurden, denseRun, denseVariation, denseDaypart]) {
      const qualifiers = derivedPoint?.context.qualifiers;
      expect(qualifiers).toBeDefined();
      expect(Object.values(qualifiers ?? {}).every((value) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      )).toBe(true);
      expect(JSON.stringify(qualifiers)).not.toMatch(/timestamp|samples|recordedAt|observedAt/iu);
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
