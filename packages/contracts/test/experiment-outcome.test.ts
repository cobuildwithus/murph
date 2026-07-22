import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  experimentOutcomeSchema,
} from "../src/zod.ts";

function currentOutcome(): Record<string, unknown> {
  return {
    adherenceSummary: {
      completedSessions: 3,
      minimumUsefulSessions: 2,
      status: "met_target",
      targetSessions: 3,
    },
    asOf: "2026-04-06",
    commonsProtocolRef: null,
    conclusion: {
      caveats: [],
      headline: "The saved result is ready.",
      plainLanguage: "The intervention window improved the measured value.",
    },
    confidence: {
      level: "medium",
      reasons: ["Both windows had daily measurements."],
    },
    confounders: [],
    effectiveProtocolSnapshot: null,
    experiment: {
      id: "exp_01JNV4458HYPP53JDQCBP1QJFM",
      slug: "sauna-rhr",
      status: "completed",
      title: "Sauna and resting heart rate",
    },
    metricResults: [{
      baseline: {
        daysWithData: 2,
        mean: 62,
        totalDays: 2,
        unit: "bpm",
      },
      baselineDayCount: 2,
      baselineMean: 62,
      biomarkerKey: "biomarker:resting-heart-rate",
      completeness: "good",
      deltaAbs: -4,
      deltaPct: -6.45,
      expectedDirection: "decrease",
      intervention: {
        daysWithData: 2,
        mean: 58,
        totalDays: 2,
        unit: "bpm",
      },
      interventionDayCount: 2,
      interventionMean: 58,
      label: "Resting heart rate",
      movedAsExpected: true,
      points: [
        {
          date: "2026-04-01",
          phase: "baseline",
          unit: "bpm",
          value: 63,
        },
        {
          date: "2026-04-02",
          phase: "baseline",
          unit: "bpm",
          value: 61,
        },
        {
          date: "2026-04-05",
          phase: "intervention",
          unit: "bpm",
          value: 59,
        },
        {
          date: "2026-04-06",
          phase: "intervention",
          unit: "bpm",
          value: 57,
        },
      ],
      unit: "bpm",
    }],
    outcomeId: "outcome_exp_01JNV4458HYPP53JDQCBP1QJFM",
    protocolRef: null,
    schema: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
    schemaVersion: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
    windows: {
      baselineEnd: "2026-04-02",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-06",
      interventionStart: "2026-04-05",
    },
  };
}

describe("experiment outcome daily snapshots", () => {
  it("accepts current outcomes whose points reproduce the saved summaries", () => {
    expect(experimentOutcomeSchema.parse(currentOutcome())).toEqual(currentOutcome());
  });

  it("keeps point-free legacy outcomes readable", () => {
    const outcome = currentOutcome();
    outcome.schema = LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION;
    outcome.schemaVersion = LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION;
    const [metric] = outcome.metricResults as Array<Record<string, unknown>>;
    delete metric?.points;

    expect(experimentOutcomeSchema.safeParse(outcome).success).toBe(true);
  });

  it("rejects current outcomes without points and legacy outcomes with points", () => {
    const current = currentOutcome();
    const [currentMetric] = current.metricResults as Array<Record<string, unknown>>;
    delete currentMetric?.points;

    const legacy = currentOutcome();
    legacy.schema = LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION;
    legacy.schemaVersion = LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION;

    expect(experimentOutcomeSchema.safeParse(current).success).toBe(false);
    expect(experimentOutcomeSchema.safeParse(legacy).success).toBe(false);
  });

  it("rejects daily snapshots that disagree with saved counts or means", () => {
    const wrongCount = currentOutcome();
    const [wrongCountMetric] = wrongCount.metricResults as Array<Record<string, unknown>>;
    const wrongCountPoints = wrongCountMetric?.points as unknown[];
    wrongCountPoints.pop();

    const wrongMean = currentOutcome();
    const [wrongMeanMetric] = wrongMean.metricResults as Array<Record<string, unknown>>;
    const wrongMeanPoints = wrongMeanMetric?.points as Array<Record<string, unknown>>;
    const firstPoint = wrongMeanPoints[0];
    if (firstPoint) {
      firstPoint.value = 65;
    }

    expect(experimentOutcomeSchema.safeParse(wrongCount).success).toBe(false);
    expect(experimentOutcomeSchema.safeParse(wrongMean).success).toBe(false);
  });

  it("rejects point units and deltas that disagree with saved summaries", () => {
    const wrongUnit = currentOutcome();
    const [wrongUnitMetric] = wrongUnit.metricResults as Array<Record<string, unknown>>;
    const [wrongUnitPoint] = wrongUnitMetric?.points as Array<Record<string, unknown>>;
    if (wrongUnitPoint) {
      wrongUnitPoint.unit = "ms";
    }

    const wrongDelta = currentOutcome();
    const [wrongDeltaMetric] = wrongDelta.metricResults as Array<Record<string, unknown>>;
    if (wrongDeltaMetric) {
      wrongDeltaMetric.deltaAbs = -3;
    }

    expect(experimentOutcomeSchema.safeParse(wrongUnit).success).toBe(false);
    expect(experimentOutcomeSchema.safeParse(wrongDelta).success).toBe(false);
  });

  it("rejects duplicate daily point dates", () => {
    const duplicateDate = currentOutcome();
    const [duplicateMetric] = duplicateDate.metricResults as Array<Record<string, unknown>>;
    const duplicatePoints = duplicateMetric?.points as Array<Record<string, unknown>>;
    const secondBaselinePoint = duplicatePoints[1];
    if (secondBaselinePoint) {
      secondBaselinePoint.date = "2026-04-01";
    }

    expect(experimentOutcomeSchema.safeParse(duplicateDate).success).toBe(false);
  });

  it("bounds each metric snapshot to the supported analysis horizon", () => {
    const outcome = currentOutcome();
    const [metric] = outcome.metricResults as Array<Record<string, unknown>>;
    if (metric) {
      metric.points = Array.from({ length: 367 }, (_, index) => ({
        date: `2026-04-${String((index % 28) + 1).padStart(2, "0")}`,
        phase: "baseline",
        unit: "bpm",
        value: 62,
      }));
    }

    const result = experimentOutcomeSchema.safeParse(outcome);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "too_big" }),
      ]));
    }
  });
});
