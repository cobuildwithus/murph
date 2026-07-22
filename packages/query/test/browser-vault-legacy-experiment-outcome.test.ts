import type { ExperimentOutcome } from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import type { MetricPoint, MetricSeriesPoint } from "../src/metrics/index.ts";
import { upgradeLegacyExperimentOutcomeForBrowser } from "../src/browser-replica/legacy-experiment-outcome.ts";

describe("legacy experiment outcome daily snapshots", () => {
  it("upgrades from the browser-selected series when it reproduces the saved result", () => {
    const outcome = legacyOutcome({
      baselineMean: 90,
      biomarkerKey: "biomarker:sleep-efficiency",
      deltaAbs: 5,
      deltaPct: 5.56,
      interventionMean: 95,
      unit: "percent",
    });
    const browserSeriesPoints: MetricSeriesPoint[] = [
      seriesPoint("sleep-efficiency", "2026-04-01", 90, "percent"),
      seriesPoint("sleep-efficiency", "2026-04-02", 95, "percent"),
    ];

    const upgraded = upgradeLegacyExperimentOutcomeForBrowser(outcome, {
      browserSeriesPoints,
      metricPoints: [],
    });

    expect(upgraded.schemaVersion).toBe("murph.experiment-outcome.v2");
    expect(upgraded.metricResults[0]?.points).toEqual([
      { date: "2026-04-01", phase: "baseline", unit: "percent", value: 90 },
      { date: "2026-04-02", phase: "intervention", unit: "percent", value: 95 },
    ]);
  });

  it("uses the current canonical selector when browser rows no longer reproduce the saved result", () => {
    const outcome = legacyOutcome({
      baselineMean: 100,
      biomarkerKey: "biomarker:deep-sleep-minutes",
      deltaAbs: 20,
      deltaPct: 20,
      interventionMean: 120,
      unit: "minutes",
    });

    const upgraded = upgradeLegacyExperimentOutcomeForBrowser(outcome, {
      browserSeriesPoints: [
        seriesPoint("deep-sleep-minutes", "2026-04-01", 100, "minutes"),
        seriesPoint("deep-sleep-minutes", "2026-04-02", 100, "minutes"),
      ],
      metricPoints: [
        metricPoint({ date: "2026-04-01", id: "baseline", value: 100 }),
        metricPoint({ date: "2026-04-02", id: "intervention", value: 120 }),
      ],
    });

    expect(upgraded.schemaVersion).toBe("murph.experiment-outcome.v2");
    expect(upgraded.metricResults[0]?.points).toEqual([
      { date: "2026-04-01", phase: "baseline", unit: "minutes", value: 100 },
      { date: "2026-04-02", phase: "intervention", unit: "minutes", value: 120 },
    ]);
  });

  it("uses the historical selector only when it exactly reproduces a v1 result", () => {
    const outcome = legacyOutcome({
      baselineMean: 100,
      biomarkerKey: "biomarker:deep-sleep-minutes",
      deltaAbs: 20,
      deltaPct: 20,
      interventionMean: 120,
      unit: "minutes",
    });
    const metricPoints = [
      metricPoint({ date: "2026-04-01", id: "baseline", value: 100 }),
      metricPoint({ date: "2026-04-02", id: "current", value: 100 }),
      metricPoint({
        canonicalUnit: "hours",
        date: "2026-04-02",
        id: "legacy",
        observedAt: "2026-04-02T10:00:00.000Z",
        value: 120,
      }),
    ];

    const upgraded = upgradeLegacyExperimentOutcomeForBrowser(outcome, {
      browserSeriesPoints: [
        seriesPoint("deep-sleep-minutes", "2026-04-01", 100, "minutes"),
        seriesPoint("deep-sleep-minutes", "2026-04-02", 100, "minutes"),
      ],
      metricPoints,
    });

    expect(upgraded.schemaVersion).toBe("murph.experiment-outcome.v2");
    expect(upgraded.metricResults[0]?.points).toEqual([
      { date: "2026-04-01", phase: "baseline", unit: "minutes", value: 100 },
      { date: "2026-04-02", phase: "intervention", unit: "minutes", value: 120 },
    ]);
  });

  it("leaves v1 outcomes unchanged when no candidate series reproduces the saved result", () => {
    const outcome = legacyOutcome({
      baselineMean: 100,
      biomarkerKey: "biomarker:deep-sleep-minutes",
      deltaAbs: 21,
      deltaPct: 21,
      interventionMean: 121,
      unit: "minutes",
    });

    const upgraded = upgradeLegacyExperimentOutcomeForBrowser(outcome, {
      browserSeriesPoints: [
        seriesPoint("deep-sleep-minutes", "2026-04-01", 100, "minutes"),
        seriesPoint("deep-sleep-minutes", "2026-04-02", 120, "minutes"),
      ],
      metricPoints: [
        metricPoint({ date: "2026-04-01", id: "baseline", value: 100 }),
        metricPoint({ date: "2026-04-02", id: "intervention", value: 120 }),
      ],
    });

    expect(upgraded).toEqual(outcome);
    expect(upgraded.schemaVersion).toBe("murph.experiment-outcome.v1");
    expect(upgraded.metricResults[0]?.points).toBeUndefined();
  });

  it("keeps every metric aggregate-only when only part of a legacy outcome can be recovered", () => {
    const outcome = legacyOutcome({
      baselineMean: 100,
      biomarkerKey: "biomarker:deep-sleep-minutes",
      deltaAbs: 20,
      deltaPct: 20,
      interventionMean: 120,
      unit: "minutes",
    });
    const secondOutcome = legacyOutcome({
      baselineMean: 40,
      biomarkerKey: "biomarker:hrv-rmssd",
      deltaAbs: 5,
      deltaPct: 12.5,
      interventionMean: 45,
      unit: "ms",
    });
    const secondMetric = secondOutcome.metricResults[0];
    if (!secondMetric) {
      throw new Error("Expected a second legacy metric fixture.");
    }
    outcome.metricResults.push(secondMetric);

    const upgraded = upgradeLegacyExperimentOutcomeForBrowser(outcome, {
      browserSeriesPoints: [
        seriesPoint("deep-sleep-minutes", "2026-04-01", 100, "minutes"),
        seriesPoint("deep-sleep-minutes", "2026-04-02", 120, "minutes"),
        seriesPoint("hrv-rmssd", "2026-04-01", 40, "ms"),
        seriesPoint("hrv-rmssd", "2026-04-02", 44, "ms"),
      ],
      metricPoints: [],
    });

    expect(upgraded).toEqual(outcome);
    expect(upgraded.schemaVersion).toBe("murph.experiment-outcome.v1");
    expect(upgraded.metricResults.every((metric) => metric.points === undefined)).toBe(true);
  });
});

function legacyOutcome(input: {
  baselineMean: number;
  biomarkerKey: string;
  deltaAbs: number;
  deltaPct: number;
  interventionMean: number;
  unit: string;
}): ExperimentOutcome {
  return {
    adherenceSummary: {
      completedSessions: 1,
      minimumUsefulSessions: 1,
      status: "met_target",
      targetSessions: 1,
    },
    asOf: "2026-04-02",
    commonsProtocolRef: null,
    conclusion: {
      caveats: [],
      headline: "The saved analysis is available.",
      plainLanguage: "The saved windows contain one measurement each.",
    },
    confidence: { level: "low", reasons: [] },
    confounders: [],
    effectiveProtocolSnapshot: null,
    experiment: {
      id: "exp_01JNV4458HYPP53JDQCBP1QJFM",
      slug: "saved-run",
      status: "completed",
      title: "Saved run",
    },
    metricResults: [{
      baseline: {
        daysWithData: 1,
        mean: input.baselineMean,
        totalDays: 1,
        unit: input.unit,
      },
      baselineDayCount: 1,
      baselineMean: input.baselineMean,
      biomarkerKey: input.biomarkerKey,
      completeness: "insufficient",
      deltaAbs: input.deltaAbs,
      deltaPct: input.deltaPct,
      expectedDirection: null,
      intervention: {
        daysWithData: 1,
        mean: input.interventionMean,
        totalDays: 1,
        unit: input.unit,
      },
      interventionDayCount: 1,
      interventionMean: input.interventionMean,
      label: "Saved metric",
      movedAsExpected: null,
      unit: input.unit,
    }],
    outcomeId: "outcome_exp_01JNV4458HYPP53JDQCBP1QJFM",
    protocolRef: null,
    schemaVersion: "murph.experiment-outcome.v1",
    windows: {
      baselineEnd: "2026-04-01",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-02",
      interventionStart: "2026-04-02",
    },
  };
}

function seriesPoint(
  metricKey: string,
  date: string,
  value: number,
  unit: string,
): MetricSeriesPoint {
  return {
    date,
    id: `series:${metricKey}:${date}`,
    metricKey,
    observedAt: `${date}T08:00:00.000Z`,
    unit,
    value,
  };
}

function metricPoint(input: {
  canonicalUnit?: string;
  date: string;
  id: string;
  observedAt?: string;
  value: number;
}): MetricPoint {
  return {
    biomarkerKey: "biomarker:deep-sleep-minutes",
    canonicalUnit: input.canonicalUnit ?? "minutes",
    canonicalValue: input.value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: input.date,
    grain: "day",
    id: `metric-point:${input.id}`,
    metricKey: "deep-sleep-minutes",
    observedAt: input.observedAt ?? `${input.date}T08:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Sleep summary",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: "sleep-summary",
      path: "",
      recordId: `record:${input.id}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: "minutes",
    value: input.value,
  };
}
