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

// A summary is numerical evidence, including when a window contains no readings.
test("sample summaries preserve custom thresholds without assigning a health category", () => {
  const empty = summarizeSampleSeries({ stream: "spo2", profile: "oxygen-night", samples: [] });
  assert.equal(empty.numericSampleCount, 0);
  assert.equal(empty.minValue, null);
  assert.equal("screen" in empty, false);
  const summary = summarizeSampleSeries({
    stream: "spo2", profile: "oxygen-night", thresholdsBelow: [92],
    samples: [{ recordedAt: "2026-01-01T00:00:00Z", value: 80 }],
  });
  assert.deepEqual(summary.thresholds.map((row) => row.below), [92]);
  assert.equal("screen" in summary, false);
});

test("sample summaries handle multiple days of second-resolution readings", () => {
  const summary = summarizeSampleSeries({
    stream: "spo2",
    samples: Array.from({ length: 200_000 }, (_, index) => ({
      recordedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      value: 96 + index % 3,
    })),
  });
  assert.equal(summary.numericSampleCount, 200_000);
  assert.equal(summary.minValue, 96);
  assert.equal(summary.maxValue, 98);
});
