import assert from "node:assert/strict";

import { test } from "vitest";

import { summarizeSampleSeries } from "../src/index.ts";

test("summarizeSampleSeries computes threshold burden, runs, and gaps", () => {
  const summary = summarizeSampleSeries({
    stream: "spo2",
    unit: "%",
    profile: "oxygen-night",
    samples: [
      { recordedAt: "2026-04-17T00:00:00.000Z", value: 96 },
      { recordedAt: "2026-04-17T00:00:01.000Z", value: 89 },
      { recordedAt: "2026-04-17T00:00:02.000Z", value: 88 },
      { recordedAt: "2026-04-17T00:00:10.000Z", value: 97 },
      { recordedAt: "2026-04-17T00:00:11.000Z", value: 87 },
    ],
  });

  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.sampleIntervalSeconds, 1);
  assert.deepEqual(summary.gaps.map((gap) => gap.durationSeconds), [8]);
  assert.deepEqual(
    summary.thresholds.map((threshold) => ({
      below: threshold.below,
      sampleCount: threshold.sampleCount,
      runCount: threshold.runCount,
      longestRunSeconds: threshold.longestRunSeconds,
    })),
    [
      { below: 92, sampleCount: 3, runCount: 2, longestRunSeconds: 2 },
      { below: 90, sampleCount: 3, runCount: 2, longestRunSeconds: 2 },
      { below: 88, sampleCount: 1, runCount: 1, longestRunSeconds: 1 },
    ],
  );
});
