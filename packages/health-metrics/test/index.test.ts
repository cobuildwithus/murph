import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
  createCustomMetricDefinition,
  formatMetricDisplayValue,
  listMetricPoints,
  listMetricDefinitions,
  normalizeMetricKey,
  normalizeMetricValue,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricGoalProgress,
  selectMetricSeries,
  selectMetricTrend,
  selectMetricValue,
  selectMetricWindowComparison,
  type GoalMetricTarget,
  type MetricPoint,
  type MetricSeriesPoint,
} from "../src/index.ts";

test("resolves metric aliases, biomarker primary metrics, and normalized metric keys", () => {
  assert.equal(normalizeMetricKey("restingHeartRate"), "resting-heart-rate");
  assert.equal(normalizeMetricKey(" Apo B / Latest "), "apo-b-latest");
  assert.equal(normalizeMetricKey("  hs_CRP / Latest! "), "hs-crp-latest");
  assert.ok(listMetricDefinitions().length > 10);
  assert.equal(resolveMetricDefinition("LDL_C")?.key, "ldl-c");
  assert.equal(resolveMetricDefinition("unknown metric"), null);
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:resting-heart-rate")?.key,
    "resting-heart-rate",
  );
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:deep-sleep-minutes")?.biomarkerKey,
    "biomarker:deep-sleep-minutes",
  );
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:blood-oxygen-spo2")?.key, "spo2");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:estimated-vo2max")?.key, "estimated-vo2-max");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:apolipoprotein-b")?.key, "apob");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:unknown"), null);
  assert.deepEqual(createCustomMetricDefinition("hydration score", "%"), {
    aliases: [],
    biomarkerKey: null,
    canonicalUnit: null,
    category: "custom",
    displayName: "Hydration Score",
    displayUnit: "%",
    key: "hydration-score",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 90 },
    valuePrecision: 1,
  });
});

test("normalizes supported metric units without hiding unsupported unit mismatches", () => {
  assert.deepEqual(normalizeMetricValue({
    metricKey: "body-weight",
    unit: null,
    value: 81.2,
  }), {
    canonicalUnit: "kg",
    canonicalValue: 81.2,
    unit: "kg",
    warnings: [],
  });

  assert.deepEqual(normalizeMetricValue({
    metricKey: "body-weight",
    unit: "lb",
    value: 180,
  }), {
    canonicalUnit: "kg",
    canonicalValue: 81.6466,
    unit: "lb",
    warnings: [],
  });

  assert.equal(normalizeMetricValue({
    metricKey: "body-weight",
    unit: "stone",
    value: 12,
  }).warnings[0]?.code, "UNIT_NOT_NORMALIZED");

  const glucose = normalizeMetricValue({
    metricKey: "glucose",
    unit: "mmol/L",
    value: 5.1,
  });
  assert.equal(glucose.canonicalUnit, "mg/dL");
  assert.equal(glucose.canonicalValue, 91.8928);

  assert.equal(normalizeMetricValue({
    metricKey: "ldl-c",
    unit: "mmol/L",
    value: 3,
  }).canonicalValue, 116.01);
  assert.equal(normalizeMetricValue({
    metricKey: "triglycerides",
    unit: "mmol/L",
    value: 1.3,
  }).canonicalValue, 115.141);
  assert.equal(normalizeMetricValue({
    metricKey: "body-fat-percentage",
    unit: "%",
    value: 18.4,
  }).canonicalUnit, "percent");
  assert.equal(normalizeMetricValue({
    metricKey: "hba1c",
    unit: "pct",
    value: 5.4,
  }).canonicalValue, 5.4);
  assert.equal(normalizeMetricValue({
    metricKey: "hs-crp",
    unit: "mg_l",
    value: 0.8,
  }).canonicalUnit, "mg/L");
  assert.equal(normalizeMetricValue({
    metricKey: "ferritin",
    unit: "ng_ml",
    value: 40,
  }).canonicalUnit, "ng/mL");
  assert.equal(normalizeMetricValue({
    metricKey: "alt",
    unit: "IU/L",
    value: 22,
  }).canonicalUnit, "U/L");
  assert.equal(normalizeMetricValue({
    metricKey: "resting-heart-rate",
    unit: "bpm",
    value: 58,
  }).canonicalValue, 58);
  assert.equal(normalizeMetricValue({
    metricKey: "resting-heart-rate",
    unit: "beats/minute",
    value: 58,
  }).warnings[0]?.code, "UNIT_NOT_NORMALIZED");
  assert.equal(normalizeMetricValue({
    metricKey: "spo2",
    unit: "%",
    value: 97.2,
  }).canonicalValue, 97.2);
  assert.equal(normalizeMetricValue({
    metricKey: "estimated-vo2-max",
    unit: "ml/kg/min",
    value: 42.4,
  }).canonicalValue, 42.4);
  assert.deepEqual(normalizeMetricValue({
    metricKey: "custom score",
    unit: "",
    value: Number.POSITIVE_INFINITY,
  }), {
    canonicalUnit: null,
    canonicalValue: null,
    unit: null,
    warnings: [],
  });

  const apoB = normalizeMetricValue({
    metricKey: "apob",
    unit: "g/L",
    value: 0.87,
  });
  assert.equal(apoB.canonicalValue, 87);
  assert.deepEqual(apoB.warnings, []);
});

test("selects metric points by policy and exposes provenance warnings", () => {
  const selected = selectMetricValue({
    metricKey: "glucose",
    now: "2026-04-30T12:00:00.000Z",
    points: [
      metricPoint({
        context: { fastingStatus: "non_fasting" },
        effectiveDate: "2026-04-28",
        id: "metric-point:glucose:2026-04-28:lab:0",
        observedAt: "2026-04-28T08:00:00.000Z",
        recordId: "lab_old",
        sourceKind: "test-result",
        value: 90,
      }),
      metricPoint({
        comparator: "<",
        context: { fastingStatus: "fasting" },
        effectiveDate: "2026-04-28",
        id: "metric-point:glucose:2026-04-28:lab:1",
        observedAt: "2026-04-28T07:30:00.000Z",
        recordId: "lab_fast",
        sourceKind: "test-result",
        value: 82,
      }),
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:glucose:2026-04-29:wearable:0",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "wearable_latest",
        sourceKind: "wearable-summary",
        value: 95,
      }),
    ],
  });

  assert.equal(selected.status, "ready");
  assert.equal(selected.value, 82);
  assert.equal(selected.point?.source.recordId, "lab_fast");
  assert.equal(selected.valueLabel, "<82");
  assert.deepEqual(
    selected.warnings.map((warning) => warning.code).sort(),
    ["COMPARATOR_VALUE", "MIXED_SOURCES"],
  );

  const apoB = selectMetricValue({
    biomarkerKey: "biomarker:apolipoprotein-b",
    points: [
      metricPoint({
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-04-29",
        id: "metric-point:apob:2026-04-29:lab:0",
        metricKey: "apob",
        observedAt: "2026-04-29T08:00:00.000Z",
        recordId: "lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 87,
      }),
    ],
  });

  assert.equal(apoB.status, "ready");
  assert.equal(apoB.value, 87);
  assert.deepEqual(listMetricPoints({
    biomarkerKey: "biomarker:apolipoprotein-b",
    points: [apoB.point].filter((point): point is MetricPoint => point !== null),
  }).map((point) => point.id), ["metric-point:apob:2026-04-29:lab:0"]);
});

test("returns empty and stale selections without losing metric identity", () => {
  const empty = selectMetricValue({
    biomarkerKey: "biomarker:blood-glucose",
    metricKey: "glucose",
    points: [],
  });
  assert.equal(empty.status, "no_data");
  assert.equal(empty.metricKey, "glucose");
  assert.equal(empty.biomarkerKey, "biomarker:blood-glucose");

  const stale = selectMetricValue({
    metricKey: "body-weight",
    now: "2026-04-30T00:00:00.000Z",
    points: [
      metricPoint({
        effectiveDate: "2026-01-01",
        id: "metric-point:body-weight:2026-01-01:measurement:0",
        metricKey: "body-weight",
        observedAt: "2026-01-01T00:00:00.000Z",
        recordId: "weight_stale",
        sourceKind: "measurement",
        unit: "kg",
        value: 80,
      }),
    ],
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.warnings[0]?.code, "SOURCE_STALE");
  assert.ok(stale.point);

  const invalidNow = selectMetricValue({
    metricKey: "body-weight",
    now: "not-a-date",
    points: [stale.point],
  });
  assert.equal(invalidNow.status, "ready");
});

test("sorts source priorities and custom metrics through selection and series helpers", () => {
  const latestMeasurement = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:body-fat-percentage:2026-04-29:measurement:0",
    metricKey: "body-fat-percentage",
    observedAt: "2026-04-29T07:00:00.000Z",
    recordId: "body_fat_measurement",
    sourceKind: "measurement",
    unit: "%",
    value: 18.5,
  });
  const sameDayDevice = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:body-fat-percentage:2026-04-29:device:0",
    metricKey: "body-fat-percentage",
    observedAt: "2026-04-29T09:00:00.000Z",
    recordId: "body_fat_device",
    sourceKind: "wearable-summary",
    unit: "%",
    value: 19.2,
  });
  const custom = metricPoint({
    effectiveDate: "2026-04-28",
    id: "metric-point:hydration-score:2026-04-28:custom:0",
    metricKey: "hydration-score",
    observedAt: "2026-04-28T09:00:00.000Z",
    recordId: "hydration_custom",
    sourceKind: "custom-source",
    unit: "percent",
    value: 92.4,
  });

  const selected = selectMetricValue({
    metricKey: "body-fat-percentage",
    points: [sameDayDevice, latestMeasurement],
  });
  assert.equal(selected.point?.id, latestMeasurement.id);

  const customSelected = selectMetricValue({
    points: [custom],
  });
  assert.equal(customSelected.metricKey, "hydration-score");
  assert.equal(customSelected.valueLabel, "92");

  assert.deepEqual(listMetricPoints({
    from: "2026-04-29",
    metricKey: "body-fat-percentage",
    points: [custom, sameDayDevice, latestMeasurement],
    to: "2026-04-29",
  }).map((point) => point.id), [latestMeasurement.id, sameDayDevice.id]);

  const series = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    metricKey: "bodyFatPercentage",
    points: [sameDayDevice, latestMeasurement],
  });
  assert.equal(series.status, "ready");
  assert.deepEqual(series.rows.map((point) => point.pointIds), [[latestMeasurement.id]]);
  assert.equal(series.warnings.some((warning) => warning.code === "MIXED_SOURCES"), true);
});

test("formats text-only metric values and missing numeric values", () => {
  const textOnly = {
    ...metricPoint({
      effectiveDate: "2026-04-29",
      id: "metric-point:custom:2026-04-29:text:0",
      metricKey: "custom-status",
      observedAt: "2026-04-29T08:00:00.000Z",
      recordId: "custom_text",
      sourceKind: "custom-source",
      unit: null,
      value: 0,
    }),
    canonicalValue: null,
    textValue: "trace",
    value: null,
  };
  assert.equal(formatMetricDisplayValue(textOnly), "trace");

  const missing = { ...textOnly, textValue: null };
  assert.equal(formatMetricDisplayValue(missing), "—");
});

test("builds chronological metric series and formats display values", () => {
  const newer = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:body-weight:2026-04-29:measurement:0",
    metricKey: "body-weight",
    observedAt: "2026-04-29T08:00:00.000Z",
    recordId: "weight_newer",
    sourceKind: "measurement",
    unit: "kg",
    value: 81.64,
  });
  const older = metricPoint({
    effectiveDate: "2026-04-20",
    id: "metric-point:body-weight:2026-04-20:measurement:0",
    metricKey: "body-weight",
    observedAt: "2026-04-20T08:00:00.000Z",
    recordId: "weight_older",
    sourceKind: "measurement",
    unit: "kg",
    value: 82.2,
  });

  assert.deepEqual(listMetricPoints({
    metricKey: "body-weight",
    points: [newer, older],
  }).map((point) => point.id), [older.id, newer.id]);
  assert.deepEqual(listMetricPoints({
    metricKey: "weightKg",
    points: [newer, older],
  }).map((point) => point.id), [older.id, newer.id]);

  const averaged = selectMetricSeries({
    aggregation: "mean",
    metricKey: "body-weight",
    points: [
      newer,
      older,
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:measurement:1",
        metricKey: "body-weight",
        observedAt: "2026-04-29T09:00:00.000Z",
        recordId: "weight_newer_2",
        sourceKind: "measurement",
        unit: "kg",
        value: 82.16,
      }),
    ],
  });
  assert.deepEqual(averaged.rows.map((point) => ({ date: point.date, value: point.value })), [
    { date: "2026-04-20", value: 82.2 },
    { date: "2026-04-29", value: 81.9 },
  ]);
  assert.equal(formatMetricDisplayValue(newer), "81.6");
});

test("selects metric window comparisons and trends through shared selectors", () => {
  const rows = [
    seriesPoint("2026-04-01", 60),
    seriesPoint("2026-04-02", 62),
    seriesPoint("2026-04-03", 58),
    seriesPoint("2026-04-04", 56),
  ];
  const comparison = selectMetricWindowComparison({
    baselineWindow: { end: "2026-04-02", start: "2026-04-01", totalDays: 2 },
    comparisonWindow: { end: "2026-04-04", start: "2026-04-03", totalDays: 2 },
    metricKey: "resting-heart-rate",
    minimumPoints: 2,
    points: rows,
    statistic: "mean",
  });

  assert.equal(comparison.status, "ready");
  assert.equal(comparison.baseline.daysWithData, 2);
  assert.equal(comparison.baseline.value, 61);
  assert.equal(comparison.comparison.value, 57);
  assert.equal(comparison.delta, -4);
  assert.equal(comparison.deltaPercent, -6.557377049180328);
  assert.deepEqual(comparison.baseline.pointIds, ["point:2026-04-01", "point:2026-04-02"]);

  const trend = selectMetricTrend({
    metricKey: "resting-heart-rate",
    points: rows,
    policy: {
      aggregation: "median",
      comparisonWindowDays: 2,
      latestWindowDays: 2,
      minimumPoints: 2,
    },
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(trend?.baselineValue, 61);
  assert.equal(trend?.currentValue, 57);
  assert.equal(trend?.delta, -4);
  assert.equal(trend?.direction, "down");
  assert.equal(trend?.label, "2-day median vs prior 2 days");
});

test("goal progress reports neutral not_met for unscheduled selected-value targets", () => {
  const target: GoalMetricTarget = {
    comparator: "<",
    evaluation: { kind: "selected-value" },
    kind: "metric",
    metricKey: "resting-heart-rate",
    targetId: "rhr-under-40",
    unit: "bpm",
    value: 40,
  };

  const progress = selectMetricGoalProgress({
    goalId: "goal_rhr",
    now: "2026-04-30T00:00:00.000Z",
    points: [
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:resting-heart-rate:2026-04-29:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "wearable_rhr",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 45,
      }),
    ],
    target,
  });

  assert.equal(progress.status, "not_met");
  assert.equal(progress.currentValue, 45);
});

test("goal progress keeps behind for scheduled rolling-window targets that miss target", () => {
  const target: GoalMetricTarget = {
    comparator: "<",
    evaluation: { kind: "rolling-window", statistic: "median", windowDays: 7 },
    kind: "metric",
    metricKey: "resting-heart-rate",
    startAt: "2026-04-01",
    targetAt: "2026-04-29",
    targetId: "rhr-under-40",
    unit: "bpm",
    value: 40,
  };

  const progress = selectMetricGoalProgress({
    goalId: "goal_rhr",
    now: "2026-05-10T00:00:00.000Z",
    points: Array.from({ length: 7 }, (_, index) => metricPoint({
      effectiveDate: `2026-04-${String(23 + index).padStart(2, "0")}`,
      id: `metric-point:resting-heart-rate:2026-04-${String(23 + index).padStart(2, "0")}:wearable:0`,
      metricKey: "resting-heart-rate",
      observedAt: `2026-04-${String(23 + index).padStart(2, "0")}T07:00:00.000Z`,
      recordId: `wearable_rhr_${index}`,
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 45,
    })),
    target,
  });

  assert.equal(progress.status, "behind");
  assert.equal(progress.currentValue, 45);
});

function metricPoint(input: {
  biomarkerKey?: string | null;
  comparator?: MetricPoint["comparator"];
  context?: MetricPoint["context"];
  effectiveDate: string;
  id: string;
  metricKey?: string;
  observedAt: string;
  recordId: string;
  sourceKind: MetricPoint["source"]["kind"];
  unit?: string | null;
  value: number;
}): MetricPoint {
  const metricKey = input.metricKey ?? "glucose";
  const normalized = normalizeMetricValue({
    metricKey,
    unit: input.unit ?? "mg/dL",
    value: input.value,
  });

  return {
    biomarkerKey: input.biomarkerKey ?? (metricKey === "glucose" ? "biomarker:blood-glucose" : null),
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: input.comparator ?? null,
    confidence: "high",
    context: input.context ?? {},
    effectiveDate: input.effectiveDate,
    grain: "day",
    id: input.id,
    metricKey,
    observedAt: input.observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Fixture",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: input.sourceKind === "wearable-summary" ? "derived" : "event",
      kind: input.sourceKind,
      path: "",
      recordId: input.recordId,
      resultIndex: 0,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit ?? "mg/dL",
    value: input.value,
  };
}

function seriesPoint(date: string, value: number): MetricSeriesPoint {
  return {
    biomarkerKey: "biomarker:resting-heart-rate",
    confidence: "high",
    context: {},
    date,
    grain: "day",
    id: `row:${date}`,
    metricKey: "resting-heart-rate",
    observedAt: `${date}T08:00:00.000Z`,
    pointIds: [`point:${date}`],
    recordIds: [`record:${date}`],
    sourceFamily: "derived",
    sourceKind: "wearable-summary",
    sourceKinds: ["wearable-summary"],
    sourceLabel: "Fixture",
    statistic: "mean",
    unit: "bpm",
    value,
    valueLabel: String(value),
  };
}
