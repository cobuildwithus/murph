import assert from "node:assert/strict";

import { test } from "vitest";

import { buildExperimentRunCardSummary } from "@/src/lib/experiments/run-card-summary";
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
  });
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
});

test("buildExperimentRunCardSummary stays honest when no comparable metric exists", () => {
  const run = createRun({ signals: [], trends: [] });

  const summary = buildExperimentRunCardSummary(run);

  assert.deepEqual(summary, {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
    metric: undefined,
  });
});

function createRun(
  overrides: Partial<Pick<ExperimentRunProjection, "signals" | "trends">> = {},
): ExperimentRunProjection {
  return {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
    id: "run:red-light-glasses",
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
