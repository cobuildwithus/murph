import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildExperimentRunCardSummary,
  projectBrowserVaultExperimentRunCardSummary,
} from "@/src/lib/experiments/run-card-summary";
import type { ExperimentRunProjection } from "@/src/types/experiments";

test("buildExperimentRunCardSummary projects a compact primary result", () => {
  const summary = buildExperimentRunCardSummary(createRun());

  assert.deepEqual(summary, {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
    metric: {
      baseline: "70 min",
      current: "83 min",
      delta: "+13 min",
      label: "Deep sleep",
      sentiment: "positive",
    },
    metrics: [{
      baseline: "70 min",
      current: "83 min",
      delta: "+13 min",
      label: "Deep sleep",
      sentiment: "positive",
    }],
  });
});

test("buildExperimentRunCardSummary preserves every comparable metric in run order", () => {
  const summary = buildExperimentRunCardSummary(createRun({
    signals: [
      {
        baseline: "20 min",
        delta: "",
        direction: "neutral",
        expected: "",
        label: "Sleep latency",
        unit: "min",
        value: "18",
      },
      {
        baseline: "94.8 percent",
        delta: "-0.7 percent",
        direction: "down",
        expected: "",
        label: "Sleep efficiency",
        sentiment: "negative",
        unit: "percent",
        value: "94.1",
      },
      {
        baseline: "96.4 min",
        delta: "+20.4 min",
        direction: "up",
        expected: "",
        label: "Deep sleep",
        sentiment: "positive",
        unit: "min",
        value: "116.8",
      },
      {
        baseline: "60.6 ms",
        delta: "+0.6 ms",
        direction: "up",
        expected: "",
        label: "HRV RMSSD",
        sentiment: "neutral",
        unit: "ms",
        value: "61.2",
      },
      {
        baseline: "50.4 bpm",
        delta: "-3.3 bpm",
        direction: "down",
        expected: "",
        label: "Resting heart rate",
        sentiment: "positive",
        unit: "bpm",
        value: "47.1",
      },
    ],
    trends: [
      {
        active: [{ day: 4, value: 116.8 }],
        baseline: [{ day: 1, value: 96.4 }],
        baselineAvg: 96.4,
        currentValue: 116.8,
        delta: "+20.4 min",
        history: [],
        label: "Deep sleep",
        startDate: "2026-05-01",
        unit: "min",
      },
      {
        active: [{ day: 4, value: 61.2 }],
        baseline: [{ day: 1, value: 60.6 }],
        baselineAvg: 60.6,
        currentValue: 61.2,
        delta: "+0.6 ms",
        history: [],
        label: "HRV RMSSD",
        startDate: "2026-05-01",
        unit: "ms",
      },
    ],
  }));

  assert.deepEqual(summary.metrics.map((metric) => ({
    delta: metric.delta,
    label: metric.label,
    sentiment: metric.sentiment,
  })), [
    { delta: "-0.7 percent", label: "Sleep efficiency", sentiment: "negative" },
    { delta: "+20.4 min", label: "Deep sleep", sentiment: "positive" },
    { delta: "+0.6 ms", label: "HRV RMSSD", sentiment: "neutral" },
    { delta: "-3.3 bpm", label: "Resting heart rate", sentiment: "positive" },
  ]);
  assert.equal(summary.metric?.label, "Deep sleep");
});

test("buildExperimentRunCardSummary falls back to trend values", () => {
  const run = createRun({ signals: [] });

  const summary = buildExperimentRunCardSummary(run);

  assert.deepEqual(summary.metric, {
    baseline: "70 min",
    current: "83 min",
    delta: "+13 min",
    label: "Deep sleep",
    sentiment: undefined,
  });
  assert.deepEqual(summary.metrics, []);
});

test("buildExperimentRunCardSummary stays honest when no comparable metric exists", () => {
  const run = createRun({ signals: [], trends: [] });

  const summary = buildExperimentRunCardSummary(run);

  assert.deepEqual(summary, {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
    metric: undefined,
    metrics: [],
  });
});

test("projectBrowserVaultExperimentRunCardSummary restores v1 metric sentiment", () => {
  const summary = projectBrowserVaultExperimentRunCardSummary({
    metric: {
      baseline: "70 min",
      biomarkerKey: "biomarker:deep-sleep-minutes",
      current: "83 min",
      delta: "+13 min",
      direction: "up",
      label: "Deep sleep",
    },
    metrics: [{
      baseline: "70 min",
      biomarkerKey: "biomarker:deep-sleep-minutes",
      current: "83 min",
      delta: "+13 min",
      direction: "up",
      label: "Deep sleep",
    }],
  });

  assert.deepEqual(summary.metric, {
    baseline: "70 min",
    current: "83 min",
    delta: "+13 min",
    label: "Deep sleep",
    sentiment: "positive",
  });
  assert.deepEqual(summary.metrics, [summary.metric]);
});

function createRun(
  overrides: Partial<Pick<ExperimentRunProjection, "signals" | "trends">> = {},
): ExperimentRunProjection {
  return {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
    id: "run:red-light-glasses",
    outcomeStatus: "available",
    signals: [{
      baseline: "70 min",
      delta: "+13 min",
      direction: "up",
      expected: "",
      label: "Deep sleep",
      sentiment: "positive",
      unit: "min",
      value: "83",
    }],
    slug: "red-light-glasses",
    snapshotGeneratedAt: "2026-05-15T12:00:00.000Z",
    source: "browser-vault",
    startedOn: "2026-05-01",
    status: "finished",
    statusLabel: "Completed",
    tags: ["sleep"],
    timingKnown: true,
    timeline: [],
    title: "Red Light Glasses Before Bed",
    trends: [{
      active: [
        { day: 3, value: 76 },
        { day: 4, value: 83 },
      ],
      baseline: [
        { day: 1, value: 68 },
        { day: 2, value: 72 },
      ],
      baselineAvg: 70,
      currentValue: 83,
      delta: "+13 min",
      history: [],
      label: "Deep sleep",
      startDate: "2026-05-01",
      unit: "min",
    }],
    ...overrides,
  };
}
