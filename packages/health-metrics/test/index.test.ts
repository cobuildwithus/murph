import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
  MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
  assessMurphAgeInputBundle,
  assessMurphAgeWearableShadowIncrements,
  buildMetricSeries,
  calculateMurphAge,
  calculateMurphAgeFromInputBundle,
  createCustomMetricDefinition,
  formatMetricDisplayValue,
  formatTargetValue,
  listMurphAgeInputBundleMetricKeys,
  listMurphAgeModelCardPolicies,
  listMurphAgeWearableBridgeFeatureSpecs,
  listMurphAgeWearableShadowIncrementPolicies,
  listMetricPoints,
  listMetricDefinitions,
  normalizeMetricKey,
  normalizeUnit,
  normalizeMetricValue,
  mapRiskToReferenceAge,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  resolveMurphAgeModelCardPolicy,
  resolveMurphAgeWearableBridgeFeatureSpec,
  resolveMurphAgeWearableShadowIncrementPolicy,
  selectMetricGoalProgress,
  selectMetricSeries,
  selectMetricTrend,
  selectMetricValue,
  selectMetricWindowComparison,
  summarizeMurphAgeCalculatorOutput,
  summarizeMurphAgeCalculatorPublicOutput,
  toPublicMurphAgeDisplaySummary,
  validateMurphAgeRiskModel,
  type GoalMetricTarget,
  type MetricPoint,
  type MetricSeriesPoint,
  type MurphAgeRiskModel,
} from "../src/index.ts";

test("resolves metric aliases, biomarker primary metrics, and normalized metric keys", () => {
  assert.equal(normalizeMetricKey("restingHeartRate"), "resting-heart-rate");
  assert.equal(normalizeMetricKey(" Apo B / Latest "), "apo-b-latest");
  assert.equal(normalizeMetricKey("  hs_CRP / Latest! "), "hs-crp-latest");
  assert.ok(listMetricDefinitions().length > 10);
  assert.equal(resolveMetricDefinition("LDL_C")?.key, "ldl-c");
  assert.equal(resolveMetricDefinition("serum_albumin")?.key, "albumin");
  assert.equal(resolveMetricDefinition("eGFR")?.key, "egfr");
  assert.equal(resolveMetricDefinition("alk-phos")?.key, "alkaline-phosphatase");
  assert.equal(resolveMetricDefinition("WBC")?.key, "white-blood-cell-count");
  assert.equal(resolveMetricDefinition("RDW")?.key, "red-cell-distribution-width");
  assert.equal(resolveMetricDefinition("SBP")?.key, "systolic-blood-pressure");
  assert.equal(resolveMetricDefinition("diastolic_bp")?.key, "diastolic-blood-pressure");
  assert.equal(resolveMetricDefinition("body_mass_index")?.key, "bmi");
  assert.equal(resolveMetricDefinition("waist")?.key, "waist-circumference");
  assert.equal(resolveMetricDefinition("sleep_efficiency")?.key, "sleep-efficiency");
  assert.equal(resolveMetricDefinition("sleep_duration_variability")?.key, "sleep-duration-variability-minutes");
  assert.equal(resolveMetricDefinition("wearable_valid_day_count_28d")?.key, "wearable-valid-day-count-28d");
  assert.equal(resolveMetricDefinition("wearable_valid_night_count_28d")?.key, "wearable-valid-night-count-28d");
  assert.equal(resolveMetricDefinition("wearable_coverage_index_28d")?.key, "wearable-coverage-index");
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
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:egfr")?.key, "egfr");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:apolipoprotein-b")?.key, "apob");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:systolic-blood-pressure")?.key, "systolic-blood-pressure");
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
  assert.equal(normalizeUnit("constructor"), "constructor");
  assert.equal(normalizeUnit("__proto__"), "__proto__");

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
    metricKey: "systolic-blood-pressure",
    unit: "mmHg",
    value: 118,
  }).canonicalValue, 118);
  assert.equal(normalizeMetricValue({
    metricKey: "diastolic-blood-pressure",
    unit: "mm_hg",
    value: 72,
  }).canonicalUnit, "mmHg");
  assert.equal(normalizeMetricValue({
    metricKey: "bmi",
    unit: "kg/m2",
    value: 23.4,
  }).canonicalUnit, "kg/m^2");
  assert.equal(normalizeMetricValue({
    metricKey: "waist-circumference",
    unit: "in",
    value: 32,
  }).canonicalValue, 81.28);
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

  assert.equal(normalizeMetricValue({
    metricKey: "albumin",
    unit: "g/L",
    value: 42,
  }).canonicalValue, 4.2);
  assert.equal(normalizeMetricValue({
    metricKey: "creatinine",
    unit: "umol/L",
    value: 88.42,
  }).canonicalValue, 1);
  assert.equal(normalizeMetricValue({
    metricKey: "egfr",
    unit: "ml/min/1.73m2",
    value: 92,
  }).canonicalUnit, "mL/min/1.73m^2");
  assert.equal(normalizeMetricValue({
    metricKey: "alkaline-phosphatase",
    unit: "u_l",
    value: 72,
  }).canonicalUnit, "U/L");
  assert.equal(normalizeMetricValue({
    metricKey: "mvpa-minutes",
    unit: "min",
    value: 42,
  }).canonicalValue, 42);
  assert.equal(normalizeMetricValue({
    metricKey: "white-blood-cell-count",
    unit: "10^9/L",
    value: 5.4,
  }).canonicalValue, 5.4);
  assert.equal(normalizeMetricValue({
    metricKey: "mean-corpuscular-volume",
    unit: "fl",
    value: 91.2,
  }).canonicalUnit, "fL");
  assert.equal(normalizeMetricValue({
    metricKey: "red-cell-distribution-width",
    unit: "%",
    value: 13.1,
  }).canonicalValue, 13.1);
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

  const blankMetricKey = selectMetricValue({
    metricKey: "   ",
    points: [
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:glucose:2026-04-29:lab:0",
        metricKey: "glucose",
        observedAt: "2026-04-29T08:00:00.000Z",
        recordId: "lab_glucose",
        sourceKind: "test-result",
        value: 90,
      }),
    ],
  });
  assert.equal(blankMetricKey.status, "no_data");
  assert.equal(blankMetricKey.metricKey, "unknown");
  assert.equal(blankMetricKey.point, null);
});

test("latest-lab policy does not silently fall back to non-lab event points", () => {
  const manualMeasurement = metricPoint({
    effectiveDate: "2026-04-30",
    id: "metric-point:glucose:2026-04-30:measurement:0",
    observedAt: "2026-04-30T07:00:00.000Z",
    recordId: "manual_glucose",
    sourceKind: "measurement",
    value: 88,
  });
  const olderLab = metricPoint({
    context: { fastingStatus: "fasting" },
    effectiveDate: "2026-04-01",
    id: "metric-point:glucose:2026-04-01:lab:0",
    observedAt: "2026-04-01T07:00:00.000Z",
    recordId: "lab_glucose",
    sourceKind: "test-result",
    value: 82,
  });

  const selected = selectMetricValue({
    metricKey: "glucose",
    points: [manualMeasurement, olderLab],
  });

  assert.equal(selected.status, "ready");
  assert.equal(selected.point?.source.recordId, "lab_glucose");
  assert.equal(selected.value, 82);

  const noLab = selectMetricValue({
    metricKey: "glucose",
    points: [manualMeasurement],
  });

  assert.equal(noLab.status, "no_data");
  assert.equal(noLab.point, null);
});

test("supports daily aggregate policy selections with contributing provenance", () => {
  const points = [
    metricPoint({
      effectiveDate: "2026-04-27",
      id: "metric-point:resting-heart-rate:2026-04-27:wearable:0",
      metricKey: "resting-heart-rate",
      observedAt: "2026-04-27T07:00:00.000Z",
      recordId: "wearable_rhr_1",
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 52,
    }),
    metricPoint({
      comparator: ">",
      effectiveDate: "2026-04-28",
      id: "metric-point:resting-heart-rate:2026-04-28:wearable:0",
      metricKey: "resting-heart-rate",
      observedAt: "2026-04-28T07:00:00.000Z",
      recordId: "wearable_rhr_2",
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 50,
    }),
    metricPoint({
      effectiveDate: "2026-04-29",
      id: "metric-point:resting-heart-rate:2026-04-29:wearable:0",
      metricKey: "resting-heart-rate",
      observedAt: "2026-04-29T07:00:00.000Z",
      recordId: "wearable_rhr_3",
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 51,
    }),
  ];
  const selected = selectMetricValue({
    metricKey: "resting-heart-rate",
    now: "2026-04-30T00:00:00.000Z",
    points,
    policyOverride: { kind: "daily-aggregate", latestWindowDays: 3, minimumPoints: 3, staleAfterDays: 7, statistic: "median" },
  });

  assert.equal(selected.status, "ready");
  assert.equal(selected.value, 51);
  assert.equal(selected.point?.source.kind, "metric-selection-summary");
  assert.deepEqual(selected.provenance.pointIds, points.map((point) => point.id));
  assert.deepEqual(selected.provenance.recordIds, ["wearable_rhr_1", "wearable_rhr_2", "wearable_rhr_3"]);
  assert.equal(selected.warnings.some((warning) => warning.code === "COMPARATOR_VALUE"), true);

  const mixedUnitAggregate = selectMetricValue({
    metricKey: "body-weight",
    points: [
      metricPoint({
        effectiveDate: "2026-04-28",
        id: "metric-point:body-weight:2026-04-28:manual:0",
        metricKey: "body-weight",
        observedAt: "2026-04-28T07:00:00.000Z",
        recordId: "body_weight_unsupported_unit",
        sourceKind: "measurement",
        unit: "stone",
        value: 12,
      }),
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:manual:0",
        metricKey: "body-weight",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "body_weight_kg",
        sourceKind: "measurement",
        unit: "kg",
        value: 81,
      }),
    ],
    policyOverride: { kind: "daily-aggregate", latestWindowDays: 2, statistic: "mean" },
  });
  assert.equal(mixedUnitAggregate.status, "ready");
  assert.equal(mixedUnitAggregate.value, 81);
  assert.equal(mixedUnitAggregate.unit, "kg");
  assert.equal(mixedUnitAggregate.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"), true);

  const insufficient = selectMetricValue({
    metricKey: "resting-heart-rate",
    points,
    policyOverride: { kind: "daily-aggregate", latestWindowDays: 3, minimumPoints: 4, statistic: "median" },
  });

  assert.equal(insufficient.status, "insufficient_data");
  assert.equal(insufficient.warnings[0]?.code, "LOW_SAMPLE_COUNT");
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

  const overrideFresh = selectMetricValue({
    metricKey: "body-weight",
    now: "2026-04-30T00:00:00.000Z",
    points: [stale.point],
    policyOverride: { kind: "latest-valid", staleAfterDays: 365 },
  });
  assert.equal(overrideFresh.status, "ready");
  assert.equal(
    overrideFresh.warnings.some((warning) => warning.code === "SOURCE_STALE"),
    false,
  );

  const invalidNow = selectMetricValue({
    metricKey: "body-weight",
    now: "not-a-date",
    points: [stale.point],
  });
  assert.equal(invalidNow.status, "ready");

  const overrideStale = selectMetricValue({
    metricKey: "body-weight",
    now: "2026-01-10T00:00:00.000Z",
    points: [stale.point],
    policyOverride: { kind: "latest-valid", staleAfterDays: 5 },
  });
  assert.equal(overrideStale.status, "stale");
  assert.equal(overrideStale.warnings[0]?.code, "SOURCE_STALE");
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
  assert.deepEqual(buildMetricSeries({
    from: "2026-04-29",
    metricKey: "bodyFatPercentage",
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

  const latestObserved = selectMetricSeries({
    duplicatePolicy: "latest-observed",
    metricKey: "body-fat-percentage",
    points: [sameDayDevice, latestMeasurement],
  });
  assert.deepEqual(latestObserved.rows.map((point) => point.pointIds), [[sameDayDevice.id]]);

  const keepAll = selectMetricSeries({
    duplicatePolicy: "keep-all",
    grain: "day",
    metricKey: "body-fat-percentage",
    points: [sameDayDevice, latestMeasurement],
    statistic: "value",
  });
  assert.deepEqual(keepAll.rows.map((point) => point.pointIds), [[latestMeasurement.id], [sameDayDevice.id]]);
});

test("reports empty, insufficient, and warning-rich semantic series states", () => {
  const noData = selectMetricSeries({
    metricKey: "glucose",
    points: [],
  });
  assert.equal(noData.status, "no_data");
  assert.deepEqual(noData.provenance.pointIds, []);

  const blankMetricKey = selectMetricSeries({
    metricKey: "   ",
    points: [
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:glucose:2026-04-29:lab:0",
        metricKey: "glucose",
        observedAt: "2026-04-29T08:00:00.000Z",
        recordId: "lab_glucose",
        sourceKind: "test-result",
        value: 90,
      }),
    ],
  });
  assert.equal(blankMetricKey.status, "no_data");
  assert.equal(blankMetricKey.metricKey, "unknown");
  assert.deepEqual(blankMetricKey.rows, []);

  const bodyWeight = metricPoint({
    comparator: ">",
    context: { measurementMethodKey: "scale-a" },
    effectiveDate: "2026-04-29",
    id: "metric-point:body-weight:2026-04-29:measurement:0",
    metricKey: "body-weight",
    observedAt: "2026-04-29T08:00:00.000Z",
    recordId: "weight_scale_a",
    sourceKind: "measurement",
    unit: "stone",
    value: 12,
  });
  const bodyWeightOtherMethod = metricPoint({
    context: { measurementMethodKey: "scale-b" },
    effectiveDate: "2026-04-30",
    id: "metric-point:body-weight:2026-04-30:measurement:0",
    metricKey: "body-weight",
    observedAt: "2026-04-30T08:00:00.000Z",
    recordId: "weight_scale_b",
    sourceKind: "wearable-summary",
    unit: "kg",
    value: 81,
  });

  const insufficient = selectMetricSeries({
    metricKey: "body-weight",
    minimumPoints: 3,
    points: [bodyWeight, bodyWeightOtherMethod],
  });
  assert.equal(insufficient.status, "insufficient_data");
  assert.deepEqual(
    insufficient.warnings.map((warning) => warning.code).sort(),
    ["COMPARATOR_VALUE", "LOW_SAMPLE_COUNT", "METHOD_CHANGED", "MIXED_SOURCES", "UNIT_NOT_NORMALIZED"],
  );
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
  const aggregations: Array<"count" | "max" | "median" | "min" | "sum"> = ["min", "max", "sum", "median", "count"];
  assert.deepEqual(aggregations.map((aggregation) =>
    selectMetricSeries({
      aggregation,
      metricKey: "body-weight",
      points: [newer, older],
    }).rows.map((point) => point.value)
  ), [
    [82.2, 81.64],
    [82.2, 81.64],
    [82.2, 81.64],
    [82.2, 81.64],
    [1, 1],
  ]);

  const textOnlyCount = selectMetricSeries({
    aggregation: "count",
    metricKey: "body-weight",
    points: [{
      ...older,
      canonicalValue: null,
      textValue: "not measured",
      value: null,
    }],
  });
  assert.equal(textOnlyCount.rows[0]?.value, 0);
  assert.equal(formatMetricDisplayValue(newer), "81.6");
});

test("does not emit misleading aggregates for canonical metrics with unnormalized units", () => {
  const mixed = selectMetricSeries({
    aggregation: "mean",
    metricKey: "body-weight",
    points: [
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:stone:0",
        metricKey: "body-weight",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "weight_stone",
        sourceKind: "measurement",
        unit: "stone",
        value: 12,
      }),
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:kg:0",
        metricKey: "body-weight",
        observedAt: "2026-04-29T08:00:00.000Z",
        recordId: "weight_kg",
        sourceKind: "measurement",
        unit: "kg",
        value: 81,
      }),
    ],
  });

  assert.equal(mixed.status, "no_data");
  assert.deepEqual(mixed.rows, []);
  assert.equal(mixed.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"), true);
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

  assert.equal(selectMetricTrend({
    metricKey: "resting-heart-rate",
    points: [],
    policy: {
      aggregation: "mean",
      comparisonWindowDays: 2,
      latestWindowDays: 2,
      minimumPoints: 2,
    },
  }), null);

  assert.equal(selectMetricWindowComparison({
    baselineWindow: { end: null, start: null },
    comparisonWindow: { end: "2026-04-04", start: "2026-04-03", totalDays: 2 },
    metricKey: "resting-heart-rate",
    points: rows,
  }).status, "unsupported");

  assert.equal(selectMetricWindowComparison({
    baselineWindow: { end: "2026-04-02", start: "2026-04-01", totalDays: 2 },
    comparisonWindow: { end: "2026-04-04", start: "2026-04-03", totalDays: 2 },
    metricKey: "resting-heart-rate",
    minimumPoints: 3,
    points: rows.slice(0, 3),
  }).status, "insufficient_data");

  const mixedUnits = selectMetricWindowComparison({
    baselineWindow: { end: "2026-04-01", start: "2026-04-01", totalDays: 1 },
    comparisonWindow: { end: "2026-04-02", start: "2026-04-02", totalDays: 1 },
    metricKey: "resting-heart-rate",
    points: [
      seriesPoint("2026-04-01", 60),
      { ...seriesPoint("2026-04-02", 62), unit: "beats-per-minute" },
    ],
  });
  assert.equal(mixedUnits.warnings[0]?.code, "UNIT_NOT_NORMALIZED");

  const flatTrend = selectMetricTrend({
    metricKey: "resting-heart-rate",
    points: [
      seriesPoint("2026-04-01", 60),
      seriesPoint("2026-04-02", 60),
      seriesPoint("2026-04-03", 60.4),
      seriesPoint("2026-04-04", 60.4),
    ],
    policy: {
      aggregation: "mean",
      comparisonWindowDays: 2,
      latestWindowDays: 2,
    },
    unit: "bpm",
    valuePrecision: 0,
  });
  assert.equal(flatTrend?.direction, "flat");

  const upwardPercentTrend = selectMetricTrend({
    metricKey: "body-fat-percentage",
    points: [
      { ...seriesPoint("2026-04-01", 20), metricKey: "body-fat-percentage", unit: "percent" },
      { ...seriesPoint("2026-04-02", 20), metricKey: "body-fat-percentage", unit: "percent" },
      { ...seriesPoint("2026-04-03", 21), metricKey: "body-fat-percentage", unit: "percent" },
      { ...seriesPoint("2026-04-04", 21), metricKey: "body-fat-percentage", unit: "percent" },
    ],
    policy: {
      aggregation: "mean",
      comparisonWindowDays: 2,
      latestWindowDays: 2,
    },
    unit: "%",
  });
  assert.equal(upwardPercentTrend?.direction, "up");

  assert.equal(selectMetricWindowComparison({
    baselineWindow: { end: "2026-04-02", start: "2026-04-01", totalDays: 2 },
    comparisonWindow: { end: "2026-04-04", start: "2026-04-03", totalDays: 2 },
    metricKey: "unknown-metric",
    points: rows,
  }).status, "no_data");
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

test("goal progress normalizes target units before comparing", () => {
  const target: GoalMetricTarget = {
    comparator: "<",
    evaluation: { kind: "selected-value" },
    kind: "metric",
    metricKey: "body-weight",
    targetId: "weight-under-180-lb",
    unit: "lb",
    value: 180,
  };

  const point = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:body-weight:2026-04-29:measurement:0",
    metricKey: "body-weight",
    observedAt: "2026-04-29T07:00:00.000Z",
    recordId: "weight_kg",
    sourceKind: "measurement",
    unit: "kg",
    value: 82,
  });
  const progress = selectMetricGoalProgress({
    goalId: "goal_weight",
    now: "2026-04-30T00:00:00.000Z",
    points: [point],
    target,
  });

  assert.equal(progress.status, "not_met");
  assert.equal(Number(progress.deltaToTarget?.toFixed(4)), 0.3534);

  const supportedRange = selectMetricGoalProgress({
    goalId: "goal_weight",
    points: [point],
    target: {
      ...target,
      comparator: "between",
      highValue: 190,
      targetId: "weight-180-to-190-lb",
    },
  });
  assert.equal(supportedRange.status, "met");

  const normalizedRange = selectMetricGoalProgress({
    goalId: "goal_weight",
    points: [{
      ...point,
      canonicalUnit: "kg",
      canonicalValue: 82,
      unit: "kg",
      value: 82,
    }],
    target: {
      comparator: "between",
      evaluation: { kind: "selected-value" },
      highValue: 190,
      kind: "metric",
      metricKey: "body-weight",
      targetId: "weight-between-180-and-190-lb",
      unit: "lb",
      value: 180,
    },
  });
  assert.equal(normalizedRange.status, "met");
  assert.equal(normalizedRange.currentValue, 82);
  assert.equal(normalizedRange.deltaToTarget, 0);

  const unsupported = selectMetricGoalProgress({
    goalId: "goal_weight",
    points: [point],
    target: { ...target, unit: "stone" },
  });

  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"), true);

  const unsupportedCurrent = selectMetricGoalProgress({
    goalId: "goal_weight",
    points: [
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:unsupported-unit:0",
        metricKey: "body-weight",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "weight_stone",
        sourceKind: "measurement",
        unit: "stone",
        value: 12,
      }),
    ],
    target: { ...target, unit: "kg", value: 80 },
  });
  assert.equal(unsupportedCurrent.status, "unsupported");
  assert.equal(unsupportedCurrent.deltaToTarget, null);
  assert.equal(unsupportedCurrent.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"), true);
});

test("goal progress honors daily-aggregate selection policy overrides", () => {
  const target: GoalMetricTarget = {
    comparator: "<=",
    evaluation: { kind: "selected-value" },
    kind: "metric",
    metricKey: "resting-heart-rate",
    selectionPolicyOverride: {
      kind: "daily-aggregate",
      latestWindowDays: 3,
      minimumPoints: 3,
      statistic: "median",
    },
    targetId: "rhr-daily-median-under-52",
    unit: "bpm",
    value: 52,
  };

  const progress = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [
      metricPoint({
        effectiveDate: "2026-04-27",
        id: "metric-point:resting-heart-rate:2026-04-27:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-27T07:00:00.000Z",
        recordId: "wearable_rhr_0",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 200,
      }),
      metricPoint({
        effectiveDate: "2026-04-28",
        id: "metric-point:resting-heart-rate:2026-04-28:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-28T07:00:00.000Z",
        recordId: "wearable_rhr_1",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 60,
      }),
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:resting-heart-rate:2026-04-29:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "wearable_rhr_2",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 50,
      }),
      metricPoint({
        effectiveDate: "2026-04-30",
        id: "metric-point:resting-heart-rate:2026-04-30:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-30T07:00:00.000Z",
        recordId: "wearable_rhr_3",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 52,
      }),
    ],
    target,
  });

  assert.equal(progress.status, "met");
  assert.equal(progress.currentValue, 52);
  assert.deepEqual(progress.selectedPointIds, [
    "metric-point:resting-heart-rate:2026-04-28:wearable:0",
    "metric-point:resting-heart-rate:2026-04-29:wearable:0",
    "metric-point:resting-heart-rate:2026-04-30:wearable:0",
  ]);
  assert.equal(progress.targetValueLabel, "<=52 bpm");
});

test("goal progress covers latest-lab, policy overrides, open ranges, and no-data", () => {
  const lab = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:resting-heart-rate:2026-04-29:lab:0",
    metricKey: "resting-heart-rate",
    observedAt: "2026-04-29T07:00:00.000Z",
    recordId: "lab_rhr",
    sourceKind: "test-result",
    unit: "bpm",
    value: 55,
  });
  const device = metricPoint({
    effectiveDate: "2026-04-30",
    id: "metric-point:resting-heart-rate:2026-04-30:wearable:0",
    metricKey: "resting-heart-rate",
    observedAt: "2026-04-30T08:00:00.000Z",
    recordId: "wearable_rhr",
    sourceKind: "wearable-summary",
    unit: "bpm",
    value: 65,
  });

  const latestLab = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [device, lab],
    target: {
      comparator: "<=",
      evaluation: { kind: "latest-lab" },
      kind: "metric",
      metricKey: "resting-heart-rate",
      targetId: "lab-rhr-under-55",
      unit: "bpm",
      value: 55,
    },
  });
  assert.equal(latestLab.status, "met");
  assert.deepEqual(latestLab.selectedPointIds, [lab.id]);
  assert.equal(latestLab.deltaToTarget, 0);

  const selectedDevice = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [lab, device],
    target: {
      comparator: ">",
      evaluation: { kind: "selected-value" },
      kind: "metric",
      metricKey: "resting-heart-rate",
      selectionPolicyOverride: { kind: "latest-device-estimate" },
      targetId: "device-rhr-over-60",
      unit: "bpm",
      value: 60,
    },
  });
  assert.equal(selectedDevice.status, "met");
  assert.deepEqual(selectedDevice.selectedPointIds, [device.id]);
  assert.equal(selectedDevice.deltaToTarget, -5);

  const noData = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [],
    target: {
      comparator: ">=",
      evaluation: { kind: "selected-value" },
      kind: "metric",
      metricKey: "resting-heart-rate",
      targetId: "device-rhr-over-60",
      unit: "bpm",
      value: 60,
    },
  });
  assert.equal(noData.status, "no_data");
  assert.equal(noData.currentValue, null);

  const blankMetricKey = selectMetricGoalProgress({
    goalId: "goal_blank",
    points: [device],
    target: {
      comparator: ">=",
      evaluation: { kind: "selected-value" },
      kind: "metric",
      metricKey: "   ",
      targetId: "blank-metric",
      unit: "bpm",
      value: 60,
    },
  });
  assert.equal(blankMetricKey.status, "no_data");
  assert.equal(blankMetricKey.metricKey, "unknown");
  assert.deepEqual(blankMetricKey.selectedPointIds, []);

  const inRange: GoalMetricTarget = {
    comparator: "between",
    evaluation: { kind: "selected-value" },
    highValue: 70,
    kind: "metric",
    metricKey: "resting-heart-rate",
    targetId: "rhr-range",
    unit: "bpm",
    value: 60,
  };
  assert.equal(formatTargetValue(inRange), "60-70 bpm");
  assert.equal(selectMetricGoalProgress({ goalId: "goal_rhr", points: [device], target: inRange }).status, "met");

  const belowRange = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [{ ...device, canonicalValue: 55, value: 55 }],
    target: inRange,
  });
  assert.equal(belowRange.status, "not_met");
  assert.equal(belowRange.deltaToTarget, 5);

  const aboveRange = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [{ ...device, canonicalValue: 75, value: 75 }],
    target: inRange,
  });
  assert.equal(aboveRange.status, "not_met");
  assert.equal(aboveRange.deltaToTarget, 5);

  const openRange: GoalMetricTarget = { ...inRange, highValue: undefined };
  const openRangeProgress = selectMetricGoalProgress({
    goalId: "goal_rhr",
    points: [device],
    target: openRange,
  });
  assert.equal(formatTargetValue(openRange), "60-? bpm");
  assert.equal(openRangeProgress.status, "unsupported");
  assert.equal(openRangeProgress.deltaToTarget, null);
  assert.equal(openRangeProgress.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"), true);
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

test("goal progress rejects rolling windows with unnormalized canonical metric points", () => {
  const target: GoalMetricTarget = {
    comparator: "<",
    evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 2 },
    kind: "metric",
    metricKey: "body-weight",
    targetId: "weight-under-80",
    unit: "kg",
    value: 80,
  };

  const progress = selectMetricGoalProgress({
    goalId: "goal_weight",
    points: [
      metricPoint({
        effectiveDate: "2026-04-28",
        id: "metric-point:body-weight:2026-04-28:stone:0",
        metricKey: "body-weight",
        observedAt: "2026-04-28T07:00:00.000Z",
        recordId: "weight_stone",
        sourceKind: "measurement",
        unit: "stone",
        value: 12,
      }),
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:kg:0",
        metricKey: "body-weight",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "weight_kg",
        sourceKind: "measurement",
        unit: "kg",
        value: 81,
      }),
    ],
    target,
  });

  assert.equal(progress.status, "unsupported");
  assert.equal(progress.currentValue, null);
  assert.equal(progress.deltaToTarget, null);
  assert.equal(progress.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"), true);
  assert.deepEqual(progress.selectedPointIds.sort(), [
    "metric-point:body-weight:2026-04-28:stone:0",
    "metric-point:body-weight:2026-04-29:kg:0",
  ]);

  const latestUnsupported = selectMetricGoalProgress({
    goalId: "goal_weight",
    points: [
      metricPoint({
        effectiveDate: "2026-04-28",
        id: "metric-point:body-weight:2026-04-28:kg:0",
        metricKey: "body-weight",
        observedAt: "2026-04-28T07:00:00.000Z",
        recordId: "weight_kg_previous",
        sourceKind: "measurement",
        unit: "kg",
        value: 81,
      }),
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:body-weight:2026-04-29:stone:0",
        metricKey: "body-weight",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "weight_stone_latest",
        sourceKind: "measurement",
        unit: "stone",
        value: 12,
      }),
    ],
    target,
  });

  assert.equal(latestUnsupported.status, "unsupported");
  assert.equal(latestUnsupported.currentValue, null);
  assert.equal(latestUnsupported.deltaToTarget, null);
  assert.deepEqual(latestUnsupported.selectedPointIds.sort(), [
    "metric-point:body-weight:2026-04-28:kg:0",
    "metric-point:body-weight:2026-04-29:stone:0",
  ]);
});

test("goal progress surfaces rolling-window stale and low-sample warnings", () => {
  const target: GoalMetricTarget = {
    comparator: "<",
    evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 7 },
    kind: "metric",
    metricKey: "resting-heart-rate",
    selectionPolicyOverride: { kind: "latest-valid", staleAfterDays: 3 },
    targetAt: "2026-04-29",
    targetId: "rhr-under-40",
    unit: "bpm",
    value: 40,
  };

  const progress = selectMetricGoalProgress({
    goalId: "goal_rhr",
    now: "2026-05-10T00:00:00.000Z",
    points: Array.from({ length: 3 }, (_, index) => metricPoint({
      effectiveDate: `2026-04-${String(27 + index).padStart(2, "0")}`,
      id: `metric-point:resting-heart-rate:2026-04-${String(27 + index).padStart(2, "0")}:wearable:0`,
      metricKey: "resting-heart-rate",
      observedAt: `2026-04-${String(27 + index).padStart(2, "0")}T07:00:00.000Z`,
      recordId: `wearable_rhr_sparse_${index}`,
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 45,
    })),
    target,
  });

  assert.equal(progress.status, "stale");
  assert.deepEqual(
    progress.warnings.map((warning) => warning.code).sort(),
    ["LOW_SAMPLE_COUNT", "SOURCE_STALE"],
  );
});

test("goal progress marks rolling windows stale from newest selected point rather than target anchor", () => {
  const target: GoalMetricTarget = {
    comparator: "<",
    evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 14 },
    kind: "metric",
    metricKey: "resting-heart-rate",
    selectionPolicyOverride: { kind: "latest-valid", staleAfterDays: 3 },
    targetAt: "2026-05-10",
    targetId: "rhr-under-40",
    unit: "bpm",
    value: 40,
  };

  const progress = selectMetricGoalProgress({
    goalId: "goal_rhr",
    now: "2026-05-10T00:00:00.000Z",
    points: [
      metricPoint({
        effectiveDate: "2026-04-29",
        id: "metric-point:resting-heart-rate:2026-04-29:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-29T07:00:00.000Z",
        recordId: "wearable_rhr_anchor_0",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 45,
      }),
      metricPoint({
        effectiveDate: "2026-04-30",
        id: "metric-point:resting-heart-rate:2026-04-30:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-04-30T07:00:00.000Z",
        recordId: "wearable_rhr_anchor_1",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 45,
      }),
    ],
    target,
  });

  assert.equal(progress.status, "stale");
  assert.equal(progress.warnings.some((warning) => warning.code === "SOURCE_STALE"), true);
});

test("maps calibrated risk to a reference age curve with interpolation and clamping warnings", () => {
  const curve = fixtureReferenceRiskCurve();

  assert.equal(mapRiskToReferenceAge(0.01, curve).warnings.length, 0);
  assert.equal(mapRiskToReferenceAge(0.3, curve).warnings.length, 0);
  assert.equal(mapRiskToReferenceAge(0.065, curve).ageYears, 50);

  const low = mapRiskToReferenceAge(0.001, curve);
  assert.equal(low.ageYears, 20);
  assert.equal(low.warnings[0]?.code, "OUT_OF_REFERENCE_RANGE");

  const high = mapRiskToReferenceAge(0.4, curve);
  assert.equal(high.ageYears, 80);
  assert.equal(high.warnings[0]?.code, "OUT_OF_REFERENCE_RANGE");

  assert.throws(() => mapRiskToReferenceAge(0.05, [
    { ageYears: 40, riskProbability: 0.08 },
    { ageYears: 60, riskProbability: 0.04 },
  ]), /monotonic/u);
});

test("calculates Murph Age from calibrated demographic, wearable, and lab features", () => {
  const result = calculateMurphAge({
    asOf: "2026-05-10T00:00:00.000Z",
    chronologicalAgeYears: 45,
    model: fixtureMurphAgeModel(),
    points: [
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:steps:2026-05-08:wearable:0",
        metricKey: "steps",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_steps",
        sourceKind: "wearable-summary",
        unit: "count",
        value: 10_000,
      }),
      metricPoint({
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-05-01",
        id: "metric-point:apob:2026-05-01:lab:0",
        metricKey: "apob",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 110,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:rhr:2026-05-08:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_rhr",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 62,
      }),
    ],
    sex: "male",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.schemaVersion, MURPH_AGE_RESULT_SCHEMA_VERSION);
  assert.equal(result.authorization.cardId, null);
  assert.equal(result.authorization.evidenceClass, "custom-model-unreviewed");
  assert.equal(result.authorization.productAuthorized, false);
  assert.equal(result.authorization.riskToAgeDisplayAuthorized, false);
  assert.equal(result.authorization.scoreBearingMetricKeys.includes("steps"), true);
  assert.equal(result.modelId, "fixture-calibrated-risk-age-model");
  assert.equal(result.biologicalAgeYears, 42.1);
  assert.equal(result.ageDeltaYears, -2.9);
  assert.equal(result.risk?.probability, 0.037471);
  assert.deepEqual(result.intervalYears, { high: 45.6, low: 38.6 });
  assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "apob")?.value, 110);
  assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "steps")?.contributionYears, -1.1);
  assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "hrv-optional")?.status, "missing");
  assert.equal(result.moduleAttributions.find((module) => module.moduleId === "activity")?.contributionYears, -1.1);
  assert.equal(result.moduleAttributions.find((module) => module.moduleId === "biomarkers")?.contributionYears, 1.7);
});

test("assesses Murph Age research input bundles for Lab9, Lab5 fallback, and wearable context", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const lab9 = assessMurphAgeInputBundle({
    asOf,
    points: [
      labMetricPoint("albumin", "g/dL", 4.4),
      labMetricPoint("creatinine", "mg/dL", 0.9),
      labMetricPoint("hba1c", "percent", 5.2),
      labMetricPoint("alkaline-phosphatase", "U/L", 65),
      labMetricPoint("white-blood-cell-count", "10^3/uL", 5.5),
      labMetricPoint("lymphocyte-percentage", "percent", 32),
      labMetricPoint("red-cell-distribution-width", "percent", 12.5),
      labMetricPoint("hdl-c", "mg/dL", 58),
      labMetricPoint("triglycerides", "mg/dL", 95),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:systolic-blood-pressure:2026-05-08:device:0",
        metricKey: "systolic-blood-pressure",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "device_sbp",
        sourceKind: "measurement",
        unit: "mmHg",
        value: 118,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:diastolic-blood-pressure:2026-05-08:device:0",
        metricKey: "diastolic-blood-pressure",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "device_dbp",
        sourceKind: "measurement",
        unit: "mmHg",
        value: 72,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:bmi:2026-05-08:device:0",
        metricKey: "bmi",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "device_bmi",
        sourceKind: "measurement",
        unit: "kg/m2",
        value: 23.2,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:waist-circumference:2026-05-08:device:0",
        metricKey: "waist-circumference",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "device_waist",
        sourceKind: "measurement",
        unit: "cm",
        value: 82,
      }),
    ],
  });

  assert.equal(lab9.status, "ready");
  assert.equal(lab9.bundleId, "lab9-bp-body");
  assert.equal(lab9.recommendedCardId, "lab9_bp_body_10y_acm_research");
  assert.equal(lab9.availableFeatureKeys.includes("glycemia"), true);
  assert.equal(lab9.selectedMetricKeys.includes("hba1c"), true);
  assert.equal(lab9.selectedMetricKeys.includes("systolic-blood-pressure"), true);

  const lab5 = assessMurphAgeInputBundle({
    asOf,
    points: [
      labMetricPoint("glucose", "mg/dL", 92),
      labMetricPoint("egfr", "mL/min/1.73m^2", 95),
      labMetricPoint("hdl-c", "mg/dL", 58),
      labMetricPoint("triglycerides", "mg/dL", 95),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:bmi:2026-05-08:fallback:0",
        metricKey: "bmi",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "fallback_bmi",
        sourceKind: "measurement",
        unit: "kg/m^2",
        value: 23.2,
      }),
    ],
  });

  assert.equal(lab5.status, "ready");
  assert.equal(lab5.bundleId, "lab5-bp-bmi");
  assert.equal(lab5.recommendedCardId, "lab5_bp_bmi_transport_research");
  assert.deepEqual(lab5.availableFeatureKeys.sort(), ["bmi", "creatinine", "glycemia", "hdl-c", "triglycerides"]);
  assert.equal(lab5.selectedMetricKeys.includes("egfr"), true);

  const wearable = assessMurphAgeInputBundle({
    asOf,
    points: [
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:steps:2026-05-08:wearable:0",
        metricKey: "steps",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_steps_context",
        sourceKind: "wearable-summary",
        unit: "count",
        value: 9000,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:resting-heart-rate:2026-05-08:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_rhr_context",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 60,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:mvpa-minutes:2026-05-08:wearable:0",
        metricKey: "mvpa-minutes",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_mvpa_context",
        sourceKind: "wearable-summary",
        unit: "minutes",
        value: 45,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:sleep-regularity-score:2026-05-08:wearable:0",
        metricKey: "sleep-regularity-score",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_sleep_regularity_context",
        sourceKind: "wearable-summary",
        unit: "score",
        value: 82,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:sleep-efficiency:2026-05-08:wearable:0",
        metricKey: "sleep-efficiency",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_sleep_efficiency_context",
        sourceKind: "wearable-summary",
        unit: "percent",
        value: 88,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:sleep-duration-variability:2026-05-08:wearable:0",
        metricKey: "sleep-duration-variability-minutes",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_sleep_variability_context",
        sourceKind: "wearable-summary",
        unit: "minutes",
        value: 42,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:wearable-valid-days:2026-05-08:wearable:0",
        metricKey: "wearable-valid-day-count-28d",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_valid_days_context",
        sourceKind: "wearable-summary",
        unit: "count",
        value: 24,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:wearable-valid-nights:2026-05-08:wearable:0",
        metricKey: "wearable-valid-night-count-28d",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_valid_nights_context",
        sourceKind: "wearable-summary",
        unit: "count",
        value: 22,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:wearable-coverage:2026-05-08:wearable:0",
        metricKey: "wearable-coverage-index",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_coverage_context",
        sourceKind: "wearable-summary",
        unit: "score",
        value: 0.82,
      }),
    ],
  });

  assert.equal(wearable.status, "context-only");
  assert.equal(wearable.bundleId, "wearable-context");
  assert.equal(wearable.recommendedCardId, "wearable_context_no_risk");
  assert.equal(wearable.availableFeatureKeys.includes("mvpa-minutes"), true);
  assert.equal(wearable.availableFeatureKeys.includes("sleep-regularity-score"), true);
  assert.equal(wearable.availableFeatureKeys.includes("sleep-duration-variability-minutes"), true);
  assert.equal(wearable.availableFeatureKeys.includes("sleep-efficiency"), true);
  assert.equal(wearable.availableFeatureKeys.includes("wearable-valid-day-count-28d"), true);
  assert.equal(wearable.availableFeatureKeys.includes("wearable-valid-night-count-28d"), true);
  assert.equal(wearable.availableFeatureKeys.includes("wearable-coverage-index"), true);
  assert.equal(wearable.warnings.some((warning) => warning.message.includes("do not score wearables")), true);

  const insufficient = assessMurphAgeInputBundle({ asOf, points: [] });
  assert.equal(insufficient.status, "abstain");
  assert.equal(insufficient.recommendedCardId, "none");
});

test("lists Murph Age input bundle metric keys without CRP or hsCRP", () => {
  const keys = listMurphAgeInputBundleMetricKeys();

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.includes("albumin"), true);
  assert.equal(keys.includes("systolic-blood-pressure"), true);
  assert.equal(keys.includes("bmi"), true);
  assert.equal(keys.includes("steps"), true);
  assert.equal(keys.includes("hrv-rmssd"), true);
  assert.equal(keys.includes("sleep-duration-variability-minutes"), true);
  assert.equal(keys.includes("sleep-efficiency"), true);
  assert.equal(keys.includes("wearable-coverage-index"), true);
  assert.equal(keys.includes("wearable-valid-day-count-28d"), true);
  assert.equal(keys.includes("wearable-valid-night-count-28d"), true);
  assert.equal(keys.includes("crp"), false);
  assert.equal(keys.includes("hs-crp"), false);
});

test("exposes non-score-bearing wearable bridge feature specs for research routing", () => {
  const specs = listMurphAgeWearableBridgeFeatureSpecs();
  const featureKeys = specs.map((spec) => spec.featureKey);

  assert.equal(new Set(featureKeys).size, featureKeys.length);
  assert.deepEqual(featureKeys, [
    "wearable-coverage-quality",
    "activity-volume",
    "sedentary-time",
    "sleep-duration-regularity",
    "resting-heart-rate",
    "hrv-rmssd",
    "estimated-vo2-max",
  ]);

  for (const spec of specs) {
    assert.equal(spec.schemaVersion, MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION);
    assert.equal(spec.productAuthorized, false);
    assert.equal(spec.riskEffect, "not-estimated");
    assert.equal(spec.scoreBearing, false);
    assert.equal(spec.scoreContributionAuthorized, false);
    assert.equal(spec.outputBoundary.aggregateOnly, true);
    assert.equal(spec.outputBoundary.rowValuesExportAllowed, false);
    assert.equal(spec.outputBoundary.participantLevelExportAllowed, false);
    assert.equal(spec.outputBoundary.predictionsExportAllowed, false);
    assert.equal(spec.outputBoundary.coefficientsExportAllowed, false);
    assert.equal(spec.outputBoundary.productDisplayExportAllowed, false);
    assert.ok(spec.metricKeys.length >= 1);
    assert.ok(spec.measurementWindowDays.every((days) => Number.isInteger(days) && days > 0));
  }

  const firstWave = specs.filter((spec) => spec.unlockPriority === "first").map((spec) => spec.featureKey);
  assert.deepEqual(firstWave, [
    "wearable-coverage-quality",
    "activity-volume",
    "sedentary-time",
  ]);

  const activityVolume = resolveMurphAgeWearableBridgeFeatureSpec("activity-volume");
  assert.equal(activityVolume?.role, "shadow-increment-signal");
  assert.equal(activityVolume?.family, "activity");
  assert.equal(activityVolume?.metricKeys.includes("steps"), true);
  assert.equal(activityVolume?.metricKeys.includes("mvpa-minutes"), true);
  assert.equal(activityVolume?.requiredQualityMetricKeys.includes("wearable-valid-day-count-28d"), true);
  assert.equal(activityVolume?.requiredQualityMetricKeys.includes("wearable-coverage-index"), true);

  const sleep = resolveMurphAgeWearableBridgeFeatureSpec("sleep-duration-regularity");
  assert.equal(sleep?.unlockPriority, "second");
  assert.equal(sleep?.methodQualifier, "required");
  assert.equal(sleep?.sourceKinds.includes("sleep-summary"), true);
  assert.equal(sleep?.requiredQualityMetricKeys.includes("wearable-valid-night-count-28d"), true);

  const hrv = resolveMurphAgeWearableBridgeFeatureSpec("hrv-rmssd");
  assert.equal(hrv?.role, "deferred-context");
  assert.equal(hrv?.unlockPriority, "defer");
  assert.equal(hrv?.methodQualifier, "required");

  if (activityVolume) {
    (activityVolume.metricKeys as string[]).push("hba1c");
    (activityVolume.outputBoundary as { rowValuesExportAllowed: boolean }).rowValuesExportAllowed = true;
    (activityVolume.requiredQualityMetricKeys as string[]).push("glucose");
  }

  const freshActivityVolume = resolveMurphAgeWearableBridgeFeatureSpec("activity-volume");
  assert.equal(freshActivityVolume?.metricKeys.includes("hba1c"), false);
  assert.equal(freshActivityVolume?.outputBoundary.rowValuesExportAllowed, false);
  assert.equal(freshActivityVolume?.requiredQualityMetricKeys.includes("glucose"), false);
});

test("exposes wearable shadow increment policies without score authorization", () => {
  const policies = listMurphAgeWearableShadowIncrementPolicies();

  assert.deepEqual(policies.map((policy) => policy.family).sort(), [
    "activity",
    "hrv",
    "resting-heart-rate",
    "sleep",
  ]);

  for (const policy of policies) {
    assert.equal(policy.schemaVersion, MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION);
    assert.equal(policy.productAuthorized, false);
    assert.equal(policy.riskEffect, "not-estimated");
    assert.equal(policy.scoreBearing, false);
    assert.equal(policy.scoreContributionAuthorized, false);
    assert.equal(policy.compatibleAnchorCardIds.includes("lab9_bp_body_10y_acm_research"), true);
    assert.equal(policy.compatibleAnchorCardIds.includes("lab5_bp_bmi_transport_research"), true);
    assert.equal(policy.allowedMetricKeys.includes("wearable-coverage-index"), true);
    assert.equal(policy.requiredQualityMetricKeys.includes("wearable-coverage-index"), true);
    assert.ok(policy.signalMetricKeys.length >= 1);
    assert.equal(policy.outputBoundary.aggregateOnly, true);
    assert.equal(policy.outputBoundary.rowValuesExportAllowed, false);
    assert.equal(policy.outputBoundary.participantLevelExportAllowed, false);
    assert.equal(policy.outputBoundary.predictionsExportAllowed, false);
    assert.equal(policy.outputBoundary.coefficientsExportAllowed, false);
    assert.equal(policy.outputBoundary.productDisplayExportAllowed, false);
  }

  const activity = resolveMurphAgeWearableShadowIncrementPolicy("activity");
  assert.equal(activity?.allowedMetricKeys.includes("steps"), true);
  assert.equal(activity?.allowedMetricKeys.includes("mvpa-minutes"), true);
  assert.equal(activity?.allowedMetricKeys.includes("sleep-efficiency"), false);
  assert.equal(activity?.signalMetricKeys.includes("steps"), true);
  assert.equal(activity?.requiredQualityMetricKeys.includes("wearable-valid-day-count-28d"), true);

  const sleep = resolveMurphAgeWearableShadowIncrementPolicy("sleep");
  assert.equal(sleep?.allowedMetricKeys.includes("sleep-duration-variability-minutes"), true);
  assert.equal(sleep?.allowedMetricKeys.includes("wearable-valid-night-count-28d"), true);
  assert.equal(sleep?.requiredQualityMetricKeys.includes("wearable-valid-night-count-28d"), true);

  const restingHeartRate = resolveMurphAgeWearableShadowIncrementPolicy("resting-heart-rate");
  assert.equal(restingHeartRate?.allowedMetricKeys.includes("resting-heart-rate"), true);
  assert.equal(restingHeartRate?.allowedMetricKeys.includes("wearable-valid-day-count-28d"), true);

  const hrv = resolveMurphAgeWearableShadowIncrementPolicy("hrv");
  assert.equal(hrv?.allowedMetricKeys.includes("hrv-rmssd"), true);
  assert.equal(hrv?.allowedMetricKeys.includes("wearable-valid-day-count-28d"), true);

  if (activity) {
    (activity.allowedMetricKeys as string[]).push("hba1c");
    (activity.outputBoundary as { rowValuesExportAllowed: boolean }).rowValuesExportAllowed = true;
    (activity.signalMetricKeys as string[]).push("sleep-efficiency");
  }

  const freshActivity = resolveMurphAgeWearableShadowIncrementPolicy("activity");
  assert.equal(freshActivity?.allowedMetricKeys.includes("hba1c"), false);
  assert.equal(freshActivity?.outputBoundary.rowValuesExportAllowed, false);
  assert.equal(freshActivity?.signalMetricKeys.includes("sleep-efficiency"), false);
});

test("assesses wearable shadow increment readiness without exposing values", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const shadowPoints = [
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:steps:2026-05-08:shadow:0",
      metricKey: "steps",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "shadow_steps",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 9_500,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:resting-heart-rate:2026-05-08:shadow:0",
      metricKey: "resting-heart-rate",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "shadow_rhr",
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 61,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-valid-days:2026-05-08:shadow:0",
      metricKey: "wearable-valid-day-count-28d",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "shadow_valid_days",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 24,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-coverage:2026-05-08:shadow:0",
      metricKey: "wearable-coverage-index",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "shadow_coverage",
      sourceKind: "wearable-summary",
      unit: "score",
      value: 0.82,
    }),
  ];

  const assessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    asOf,
    points: shadowPoints,
  });

  const activity = assessments.find((assessment) => assessment.family === "activity");
  assert.equal(activity?.status, "ready");
  assert.equal(activity?.anchorCompatible, true);
  assert.equal(activity?.scoreBearing, false);
  assert.equal(activity?.scoreContributionAuthorized, false);
  assert.equal(activity?.riskEffect, "not-estimated");
  assert.equal(activity?.readySignalMetricKeys.includes("steps"), true);
  assert.equal(activity?.selectedMetricKeys.includes("steps"), true);
  assert.equal(activity?.selectedMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(activity?.selectedPointIds.includes("metric-point:steps:2026-05-08:shadow:0"), true);
  assert.equal(activity ? "value" in activity : true, false);
  assert.equal(activity ? "unit" in activity : true, false);
  assert.equal(activity?.warnings.some((warning) => warning.code === "CONTEXT_NOT_SCORE_BEARING"), true);

  const restingHeartRate = assessments.find((assessment) => assessment.family === "resting-heart-rate");
  assert.equal(restingHeartRate?.status, "ready");
  assert.equal(restingHeartRate?.readySignalMetricKeys.includes("resting-heart-rate"), true);

  const hrv = assessments.find((assessment) => assessment.family === "hrv");
  assert.equal(hrv?.status, "missing");
  assert.equal(hrv?.missingMetricKeys.includes("hrv-rmssd"), true);

  const sleep = assessments.find((assessment) => assessment.family === "sleep");
  assert.equal(sleep?.status, "missing");
  assert.equal(sleep?.missingMetricKeys.includes("sleep-efficiency"), true);
  assert.equal(sleep?.missingMetricKeys.includes("wearable-valid-night-count-28d"), true);

  const blocked = assessMurphAgeWearableShadowIncrements({ asOf, points: shadowPoints });
  assert.equal(blocked.every((assessment) => assessment.status === "blocked"), true);
  assert.equal(blocked.every((assessment) => assessment.anchorCompatible === false), true);

  const nonWearableAssessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    asOf,
    points: shadowPoints.map((point) => ({
      ...point,
      id: `${point.id}:manual`,
      source: {
        ...point.source,
        family: "event",
        kind: "measurement",
      },
    })),
  });
  const nonWearableActivity = nonWearableAssessments.find((assessment) => assessment.family === "activity");
  assert.equal(nonWearableActivity?.status, "missing");
  assert.equal(nonWearableActivity?.selectedMetricKeys.length, 0);
  assert.equal(nonWearableActivity?.selectedPointIds.length, 0);
  assert.equal(nonWearableActivity?.missingMetricKeys.includes("steps"), true);

  const typedWearableSourceAssessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    asOf,
    points: [
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:steps:2026-05-08:activity-summary:0",
        metricKey: "steps",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "shadow_activity_steps",
        sourceKind: "activity-summary",
        unit: "count",
        value: 9_500,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:total-sleep-minutes:2026-05-08:sleep-summary:0",
        metricKey: "total-sleep-minutes",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "shadow_sleep_duration",
        sourceKind: "sleep-summary",
        unit: "minutes",
        value: 450,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:wearable-valid-days:2026-05-08:activity-summary:0",
        metricKey: "wearable-valid-day-count-28d",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "shadow_activity_valid_days",
        sourceKind: "activity-summary",
        unit: "count",
        value: 24,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:wearable-valid-nights:2026-05-08:sleep-summary:0",
        metricKey: "wearable-valid-night-count-28d",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "shadow_sleep_valid_nights",
        sourceKind: "sleep-summary",
        unit: "count",
        value: 22,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:wearable-coverage:2026-05-08:wearable-summary:0",
        metricKey: "wearable-coverage-index",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "shadow_typed_source_coverage",
        sourceKind: "wearable-summary",
        unit: "score",
        value: 0.82,
      }),
    ],
  });
  const typedSourceActivity = typedWearableSourceAssessments.find((assessment) =>
    assessment.family === "activity"
  );
  assert.equal(typedSourceActivity?.status, "ready");
  assert.equal(typedSourceActivity?.selectedPointIds.includes("metric-point:steps:2026-05-08:activity-summary:0"), true);
  const typedSourceSleep = typedWearableSourceAssessments.find((assessment) => assessment.family === "sleep");
  assert.equal(typedSourceSleep?.status, "ready");
  assert.equal(
    typedSourceSleep?.selectedPointIds.includes("metric-point:total-sleep-minutes:2026-05-08:sleep-summary:0"),
    true,
  );
});

test("dispatches Murph Age cards while keeping research and wearable boundaries explicit", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const lab9Points = [
    labMetricPoint("albumin", "g/dL", 4.4),
    labMetricPoint("egfr", "mL/min/1.73m^2", 96),
    labMetricPoint("hba1c", "percent", 5.2),
    labMetricPoint("alkaline-phosphatase", "U/L", 65),
    labMetricPoint("white-blood-cell-count", "10^3/uL", 5.5),
    labMetricPoint("lymphocyte-percentage", "percent", 32),
    labMetricPoint("red-cell-distribution-width", "percent", 12.5),
    labMetricPoint("hdl-c", "mg/dL", 58),
    labMetricPoint("triglycerides", "mg/dL", 95),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:systolic-blood-pressure:2026-05-08:dispatcher:0",
      metricKey: "systolic-blood-pressure",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_sbp",
      sourceKind: "measurement",
      unit: "mmHg",
      value: 118,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:diastolic-blood-pressure:2026-05-08:dispatcher:0",
      metricKey: "diastolic-blood-pressure",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_dbp",
      sourceKind: "measurement",
      unit: "mmHg",
      value: 72,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:bmi:2026-05-08:dispatcher:0",
      metricKey: "bmi",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_bmi",
      sourceKind: "measurement",
      unit: "kg/m^2",
      value: 23.2,
    }),
  ];
  const wearableContextPoints = [
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:steps:2026-05-08:dispatcher-wearable:0",
      metricKey: "steps",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_steps",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 10_000,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:resting-heart-rate:2026-05-08:dispatcher-wearable:0",
      metricKey: "resting-heart-rate",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_rhr",
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 62,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:sleep-efficiency:2026-05-08:dispatcher-wearable:0",
      metricKey: "sleep-efficiency",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_sleep_efficiency",
      sourceKind: "wearable-summary",
      unit: "percent",
      value: 88,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:sleep-duration-variability:2026-05-08:dispatcher-wearable:0",
      metricKey: "sleep-duration-variability-minutes",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_sleep_variability",
      sourceKind: "wearable-summary",
      unit: "minutes",
      value: 42,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-valid-days:2026-05-08:dispatcher-wearable:0",
      metricKey: "wearable-valid-day-count-28d",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_valid_days",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 24,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-valid-nights:2026-05-08:dispatcher-wearable:0",
      metricKey: "wearable-valid-night-count-28d",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_valid_nights",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 22,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-coverage:2026-05-08:dispatcher-wearable:0",
      metricKey: "wearable-coverage-index",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_wearable_coverage",
      sourceKind: "wearable-summary",
      unit: "score",
      value: 0.82,
    }),
  ];
  const lab9WithWearableContextPoints = [...lab9Points, ...wearableContextPoints];
  const researchModel = fixtureLab9ResearchModel();

  const lab9Policy = listMurphAgeModelCardPolicies().find((policy) =>
    policy.cardId === "lab9_bp_body_10y_acm_research"
  );
  assert.equal(lab9Policy?.productAuthorized, false);
  assert.equal(lab9Policy?.wearableScoreBearingAuthorized, false);
  assert.equal(lab9Policy?.evidenceClass, "research-internal");
  const resolvedLab9Policy = resolveMurphAgeModelCardPolicy("lab9_bp_body_10y_acm_research");
  if (resolvedLab9Policy) {
    (resolvedLab9Policy as { productAuthorized: boolean }).productAuthorized = true;
    (resolvedLab9Policy.scoreBearingSourceKinds as string[]).push("wearable-summary");
  }

  const productDefault = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithWearableContextPoints,
    sex: "female",
  });

  assert.equal(productDefault.status, "abstain");
  assert.equal(productDefault.result, null);
  assert.equal(productDefault.authorization.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(productDefault.authorization.productAuthorized, false);
  assert.equal(productDefault.authorization.riskToAgeDisplayAuthorized, false);
  assert.equal(productDefault.authorization.scoreBearing, true);
  assert.equal(productDefault.authorization.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(productDefault.cardPolicy?.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(productDefault.contextAssessments[0]?.bundleId, "wearable-context");
  assert.equal(productDefault.wearableShadowIncrementAssessments.length, 4);
  assert.equal(
    productDefault.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "activity")?.status,
    "ready",
  );
  assert.equal(productDefault.cardPolicy?.productAuthorized, false);
  assert.equal(productDefault.warnings.some((warning) => warning.code === "MODEL_CARD_NOT_AUTHORIZED"), true);
  const productDefaultSummary = summarizeMurphAgeCalculatorOutput(productDefault);
  assert.equal(productDefaultSummary.displayStatus, "abstain");
  assert.equal(productDefaultSummary.displayBlockedReason, "product-not-authorized");
  assert.equal(productDefaultSummary.productAgeDisplayReady, false);
  assert.equal(productDefaultSummary.ageEstimateAvailable, false);
  assert.equal(productDefaultSummary.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(productDefaultSummary.selectedScoreBearingMetricKeys.length, 0);
  assert.equal(productDefaultSummary.wearableContext.quality, "strong-context");
  assert.equal(productDefaultSummary.wearableContext.scoreBearing, false);
  assert.equal(productDefaultSummary.wearableContext.scoreContributionAuthorized, false);
  assert.equal(productDefaultSummary.wearableContext.riskEffect, "not-estimated");
  assert.equal(productDefaultSummary.wearableContext.availableFeatureFamilies.includes("activity"), true);
  assert.equal(productDefaultSummary.wearableContext.availableFeatureFamilies.includes("sleep"), true);
  assert.equal(productDefaultSummary.wearableContext.availableFeatureFamilies.includes("recovery"), true);
  assert.equal(productDefaultSummary.wearableContext.availableFeatureFamilies.includes("quality"), true);
  assert.equal(productDefaultSummary.wearableBridge.scoreBearing, false);
  assert.equal(productDefaultSummary.wearableBridge.scoreContributionAuthorized, false);
  assert.equal(productDefaultSummary.wearableBridge.productAuthorized, false);
  assert.equal(productDefaultSummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(productDefaultSummary.wearableBridge.readyFeatureKeys.includes("resting-heart-rate"), true);
  assert.equal(productDefaultSummary.wearableBridge.missingFeatureKeys.includes("estimated-vo2-max"), true);

  const research = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithWearableContextPoints,
    sex: "female",
  });
  const labOnlyResearch = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9Points,
    sex: "female",
  });

  assert.equal(research.status, "ready");
  assert.equal(research.result?.status, "ready");
  assert.equal(research.result?.biologicalAgeYears, labOnlyResearch.result?.biologicalAgeYears);
  assert.equal(research.result?.ageDeltaYears, labOnlyResearch.result?.ageDeltaYears);
  assert.equal(research.result?.risk?.probability, labOnlyResearch.result?.risk?.probability);
  assert.deepEqual(
    research.result?.featureAttributions.map((feature) => ({
      contributionLogit: feature.contributionLogit,
      contributionYears: feature.contributionYears,
      featureKey: feature.featureKey,
      metricKey: feature.metricKey,
      moduleId: feature.moduleId,
      selectedPointIds: feature.selectedPointIds,
      status: feature.status,
    })),
    labOnlyResearch.result?.featureAttributions.map((feature) => ({
      contributionLogit: feature.contributionLogit,
      contributionYears: feature.contributionYears,
      featureKey: feature.featureKey,
      metricKey: feature.metricKey,
      moduleId: feature.moduleId,
      selectedPointIds: feature.selectedPointIds,
      status: feature.status,
    })),
  );
  assert.equal(labOnlyResearch.authorization.contextOnlyMetricKeys.length, 0);
  assert.equal(research.authorization.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(research.authorization.evidenceClass, "research-internal");
  assert.equal(research.authorization.productAuthorized, false);
  assert.equal(research.authorization.wearableScoreBearingAuthorized, false);
  assert.equal(research.authorization.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(research.authorization.contextOnlyMetricKeys.includes("sleep-efficiency"), true);
  assert.equal(research.authorization.contextOnlyMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(research.result?.authorization.cardId, research.authorization.cardId);
  assert.equal(research.result?.authorization.contextOnlyMetricKeys.includes("resting-heart-rate"), true);
  assert.equal(research.bundleAssessment.bundleId, "lab9-bp-body");
  assert.equal(research.bundleAssessment.selectedPointIds.includes("metric-point:steps:2026-05-08:dispatcher-wearable:0"), false);
  assert.equal(research.contextAssessments.length, 1);
  assert.equal(research.contextAssessments[0]?.bundleId, "wearable-context");
  assert.equal(research.contextAssessments[0]?.status, "context-only");
  assert.equal(research.contextAssessments[0]?.selectedPointIds.includes("metric-point:steps:2026-05-08:dispatcher-wearable:0"), true);
  const contextStepStatus = research.contextAssessments[0]?.featureStatuses.find((status) => status.featureKey === "steps");
  assert.equal(contextStepStatus ? "value" in contextStepStatus : true, false);
  assert.equal(contextStepStatus ? "unit" in contextStepStatus : true, false);
  const researchActivityShadow = research.wearableShadowIncrementAssessments.find((assessment) =>
    assessment.family === "activity"
  );
  assert.equal(researchActivityShadow?.status, "ready");
  assert.equal(researchActivityShadow?.scoreBearing, false);
  assert.equal(researchActivityShadow?.scoreContributionAuthorized, false);
  assert.equal(researchActivityShadow?.productAuthorized, false);
  assert.equal(researchActivityShadow?.riskEffect, "not-estimated");
  assert.equal(researchActivityShadow?.selectedMetricKeys.includes("steps"), true);
  assert.equal(researchActivityShadow?.selectedMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(researchActivityShadow ? "value" in researchActivityShadow : true, false);
  assert.equal(researchActivityShadow ? "unit" in researchActivityShadow : true, false);
  const researchSleepShadow = research.wearableShadowIncrementAssessments.find((assessment) =>
    assessment.family === "sleep"
  );
  assert.equal(researchSleepShadow?.status, "ready");
  assert.equal(researchSleepShadow?.readySignalMetricKeys.includes("sleep-efficiency"), true);
  assert.equal(researchSleepShadow?.missingQualityMetricKeys.length, 0);
  const researchHrvShadow = research.wearableShadowIncrementAssessments.find((assessment) =>
    assessment.family === "hrv"
  );
  assert.equal(researchHrvShadow?.status, "missing");
  assert.equal(researchHrvShadow?.missingMetricKeys.includes("hrv-rmssd"), true);
  assert.equal(research.result?.featureAttributions.find((feature) => feature.featureKey === "hba1c")?.status, "ready");
  assert.equal(research.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  assert.equal(research.warnings.some((warning) => warning.code === "CONTEXT_NOT_SCORE_BEARING"), true);
  const researchSummary = summarizeMurphAgeCalculatorOutput(research);
  assert.equal(researchSummary.displayStatus, "research-only");
  assert.equal(researchSummary.displayBlockedReason, "product-not-authorized");
  assert.equal(researchSummary.ageEstimateAvailable, true);
  assert.equal(researchSummary.productAgeDisplayReady, false);
  assert.equal(researchSummary.researchEstimateAvailable, true);
  assert.equal(researchSummary.selectedScoreBearingMetricKeys.includes("hba1c"), true);
  assert.equal(researchSummary.selectedScoreBearingMetricKeys.includes("steps"), false);
  assert.equal(researchSummary.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(researchSummary.contextOnlyMetricKeys.includes("resting-heart-rate"), true);
  assert.equal(researchSummary.contextOnlyMetricKeys.includes("sleep-duration-variability-minutes"), true);
  assert.equal(researchSummary.contextOnlyMetricKeys.includes("wearable-valid-day-count-28d"), true);
  assert.equal(researchSummary.contextOnlyPointIds.includes("metric-point:steps:2026-05-08:dispatcher-wearable:0"), true);
  assert.equal(researchSummary.wearableContext.quality, "strong-context");
  assert.equal(researchSummary.wearableContext.readyFeatureCount, 7);
  assert.equal(researchSummary.wearableContext.readyMetricCount, 7);
  assert.equal(researchSummary.wearableContext.readyPointCount, 7);
  assert.equal(researchSummary.wearableContext.availableQualityFeatureKeys.includes("wearable-coverage-index"), true);
  assert.equal(researchSummary.wearableContext.missingQualityFeatureKeys.length, 0);
  assert.equal(researchSummary.wearableContext.uncertaintyAction, "context-only");
  assert.equal(researchSummary.wearableContext.scoreBearing, false);
  assert.equal(researchSummary.wearableContext.scoreContributionAuthorized, false);
  assert.equal(researchSummary.wearableBridge.candidateFeatureCount, 7);
  assert.deepEqual(researchSummary.wearableBridge.firstPriorityReadyFeatureKeys, [
    "wearable-coverage-quality",
    "activity-volume",
  ]);
  assert.deepEqual(researchSummary.wearableBridge.firstPriorityIncompleteFeatureKeys, [
    "sedentary-time",
  ]);
  assert.deepEqual(researchSummary.wearableBridge.secondPriorityReadyFeatureKeys, [
    "sleep-duration-regularity",
    "resting-heart-rate",
  ]);
  assert.deepEqual(researchSummary.wearableBridge.secondPriorityIncompleteFeatureKeys, []);
  assert.equal(researchSummary.wearableBridge.deferredFeatureKeys.includes("hrv-rmssd"), true);
  assert.equal(researchSummary.wearableBridge.deferredFeatureKeys.includes("estimated-vo2-max"), true);
  assert.equal(
    researchSummary.wearableBridge.features.find((feature) => feature.featureKey === "activity-volume")?.qualityReady,
    true,
  );
  assert.equal(
    researchSummary.wearableBridge.features.find((feature) => feature.featureKey === "hrv-rmssd")?.status,
    "missing",
  );
  assert.equal(researchSummary.wearableBridge.riskEffect, "not-estimated");
  assert.equal(researchSummary.wearableBridge.scoreBearing, false);
  assert.equal(researchSummary.wearableBridge.scoreContributionAuthorized, false);
  assert.equal(researchSummary.wearableBridge.productAuthorized, false);
  const publicResearchSummary = summarizeMurphAgeCalculatorPublicOutput(research);
  assert.equal(publicResearchSummary.schemaVersion, MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION);
  assert.equal(publicResearchSummary.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(publicResearchSummary.wearableContext.readyPointCount, 7);
  assert.equal(publicResearchSummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(publicResearchSummary.wearableBridge.productAuthorized, false);
  assert.equal(
    publicResearchSummary.wearableBridge.features.some((feature) => "selectedPointIds" in feature),
    false,
  );
  for (const forbiddenFeatureKey of [
    "value",
    "unit",
    "prediction",
    "coefficient",
    "contributionLogit",
    "contributionYears",
  ]) {
    assert.equal(
      publicResearchSummary.wearableBridge.features.some((feature) => forbiddenFeatureKey in feature),
      false,
    );
  }
  assert.equal(
    publicResearchSummary.wearableBridge.features.every((feature) => feature.productAuthorized === false),
    true,
  );
  const publicFromLeakyBridgeSummary = toPublicMurphAgeDisplaySummary({
    ...researchSummary,
    wearableBridge: {
      ...researchSummary.wearableBridge,
      features: researchSummary.wearableBridge.features.map((feature) => ({
        ...feature,
        coefficient: 1,
        contributionLogit: 1,
        contributionYears: 1,
        prediction: 1,
        selectedPointIds: ["metric-point:private-row:0"],
        unit: "count",
        value: 1,
      })),
    },
  });
  for (const forbiddenFeatureKey of [
    "selectedPointIds",
    "value",
    "unit",
    "prediction",
    "coefficient",
    "contributionLogit",
    "contributionYears",
  ]) {
    assert.equal(
      publicFromLeakyBridgeSummary.wearableBridge.features.some((feature) => forbiddenFeatureKey in feature),
      false,
    );
  }
  assert.equal("contextOnlyPointIds" in publicResearchSummary, false);
  assert.equal("selectedScoreBearingPointIds" in publicResearchSummary, false);
  assert.equal("wearableShadowIncrementAssessments" in publicResearchSummary, false);
  const productRiskOnlySummary = summarizeMurphAgeCalculatorOutput({
    ...research,
    authorization: {
      ...research.authorization,
      productAuthorized: true,
      riskToAgeDisplayAuthorized: false,
    },
    mode: "product",
    result: research.result ? {
      ...research.result,
      authorization: {
        ...research.result.authorization,
        productAuthorized: true,
        riskToAgeDisplayAuthorized: false,
      },
    } : null,
  });
  assert.equal(productRiskOnlySummary.displayStatus, "product-risk-only");
  assert.equal(productRiskOnlySummary.displayBlockedReason, "risk-to-age-not-authorized");
  assert.equal(productRiskOnlySummary.productRiskDisplayReady, true);
  assert.equal(productRiskOnlySummary.productAgeDisplayReady, false);

  const productAgeReadySummary = summarizeMurphAgeCalculatorOutput({
    ...research,
    authorization: {
      ...research.authorization,
      productAuthorized: true,
      riskToAgeDisplayAuthorized: true,
    },
    mode: "product",
    result: research.result ? {
      ...research.result,
      authorization: {
        ...research.result.authorization,
        productAuthorized: true,
        riskToAgeDisplayAuthorized: true,
      },
    } : null,
  });
  assert.equal(productAgeReadySummary.schemaVersion, MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION);
  assert.equal(productAgeReadySummary.displayStatus, "product-age-ready");
  assert.equal(productAgeReadySummary.displayBlockedReason, null);
  assert.equal(productAgeReadySummary.productRiskDisplayReady, true);
  assert.equal(productAgeReadySummary.productAgeDisplayReady, true);
  assert.equal(productAgeReadySummary.researchEstimateAvailable, false);
  assert.equal(productAgeReadySummary.selectedScoreBearingPointIds.includes("metric-point:hba1c:2026-05-01:lab:0"), true);
  if (research.cardPolicy) {
    (research.cardPolicy.scoreBearingSourceKinds as string[]).push("wearable-summary");
  }

  const lab5Points = [
    labMetricPoint("glucose", "mg/dL", 92),
    labMetricPoint("egfr", "mL/min/1.73m^2", 95),
    labMetricPoint("hdl-c", "mg/dL", 58),
    labMetricPoint("triglycerides", "mg/dL", 95),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:bmi:2026-05-08:dispatcher-lab5:0",
      metricKey: "bmi",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "dispatcher_lab5_bmi",
      sourceKind: "measurement",
      unit: "kg/m^2",
      value: 23.2,
    }),
  ];
  const lab5WithoutModel = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    points: lab5Points,
    sex: "female",
  });

  assert.equal(lab5WithoutModel.status, "abstain");
  assert.equal(lab5WithoutModel.bundleAssessment.bundleId, "lab5-bp-bmi");
  assert.equal(lab5WithoutModel.cardPolicy?.cardId, "lab5_bp_bmi_transport_research");
  assert.equal(lab5WithoutModel.authorization.evidenceClass, "research-transport");
  assert.equal(lab5WithoutModel.warnings.some((warning) => warning.code === "MODEL_FEATURE_MISSING"), true);

  const lab5Research = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    points: lab5Points,
    sex: "female",
  });

  assert.equal(lab5Research.status, "ready");
  assert.equal(lab5Research.result?.status, "ready");
  assert.equal(lab5Research.result?.modelId, "fixture-lab5-research-card-model");
  assert.equal(lab5Research.result?.featureAttributions.find((feature) => feature.featureKey === "egfr")?.status, "ready");

  const lab5ResearchWithWearables = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    points: [...lab5Points, ...wearableContextPoints],
    sex: "female",
  });

  assert.equal(lab5ResearchWithWearables.status, "ready");
  assert.equal(lab5ResearchWithWearables.bundleAssessment.bundleId, "lab5-bp-bmi");
  assert.equal(lab5ResearchWithWearables.result?.biologicalAgeYears, lab5Research.result?.biologicalAgeYears);
  assert.equal(lab5ResearchWithWearables.result?.ageDeltaYears, lab5Research.result?.ageDeltaYears);
  assert.equal(lab5ResearchWithWearables.result?.risk?.probability, lab5Research.result?.risk?.probability);
  assert.equal(lab5ResearchWithWearables.contextAssessments[0]?.bundleId, "wearable-context");
  assert.equal(lab5ResearchWithWearables.contextAssessments[0]?.selectedMetricKeys.includes("steps"), true);
  assert.equal(
    lab5ResearchWithWearables.wearableShadowIncrementAssessments.find((assessment) =>
      assessment.family === "activity"
    )?.anchorCardId,
    "lab5_bp_bmi_transport_research",
  );
  assert.equal(
    lab5ResearchWithWearables.wearableShadowIncrementAssessments.find((assessment) =>
      assessment.family === "activity"
    )?.status,
    "ready",
  );
  assert.equal(lab5ResearchWithWearables.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);

  const wearableOnly = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    points: wearableContextPoints,
    sex: "female",
  });

  assert.equal(wearableOnly.status, "context-only");
  assert.equal(wearableOnly.result, null);
  assert.equal(wearableOnly.cardPolicy?.scoreBearing, false);
  assert.equal(wearableOnly.authorization.evidenceClass, "context-only");
  assert.equal(wearableOnly.authorization.scoreBearing, false);
  assert.equal(wearableOnly.authorization.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(wearableOnly.authorization.contextOnlyMetricKeys.includes("sleep-efficiency"), true);
  assert.equal(wearableOnly.authorization.contextOnlyMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(wearableOnly.contextAssessments.length, 0);
  assert.equal(wearableOnly.wearableShadowIncrementAssessments.length, 0);
  const wearableOnlySummary = summarizeMurphAgeCalculatorOutput(wearableOnly);
  assert.equal(wearableOnlySummary.displayStatus, "context-only");
  assert.equal(wearableOnlySummary.displayBlockedReason, "context-only");
  assert.equal(wearableOnlySummary.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(wearableOnlySummary.contextOnlyMetricKeys.includes("wearable-valid-night-count-28d"), true);
  assert.equal(wearableOnlySummary.contextOnlyFeatureKeys.includes("resting-heart-rate"), true);
  assert.equal(wearableOnlySummary.contextOnlyFeatureKeys.includes("sleep-duration-variability-minutes"), true);
  assert.equal(wearableOnlySummary.selectedScoreBearingMetricKeys.length, 0);
  assert.equal(wearableOnlySummary.ageEstimateAvailable, false);
  assert.equal(wearableOnlySummary.productAgeDisplayReady, false);
  assert.equal(wearableOnlySummary.wearableContext.quality, "strong-context");
  assert.deepEqual(Object.keys(wearableOnlySummary.wearableContext).sort(), [
    "availableFeatureFamilies",
    "availableQualityFeatureKeys",
    "missingQualityFeatureKeys",
    "quality",
    "readyFeatureCount",
    "readyMetricCount",
    "readyPointCount",
    "riskEffect",
    "scoreBearing",
    "scoreContributionAuthorized",
    "uncertaintyAction",
  ]);
  assert.equal(wearableOnlySummary.wearableContext.riskEffect, "not-estimated");
  assert.equal(wearableOnlySummary.wearableContext.scoreBearing, false);
  assert.equal(wearableOnlySummary.wearableContext.scoreContributionAuthorized, false);
  assert.equal(wearableOnlySummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(wearableOnlySummary.wearableBridge.readyFeatureKeys.includes("sleep-duration-regularity"), true);
  assert.equal(wearableOnlySummary.wearableBridge.missingFeatureKeys.includes("hrv-rmssd"), true);

  const thinWearableOnly = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    points: [wearableContextPoints[0]!],
    sex: "female",
  });
  const thinWearableSummary = summarizeMurphAgeCalculatorOutput(thinWearableOnly);
  assert.equal(thinWearableSummary.displayStatus, "context-only");
  assert.equal(thinWearableSummary.wearableContext.quality, "thin");
  assert.equal(thinWearableSummary.wearableContext.availableFeatureFamilies.includes("activity"), true);
  assert.equal(thinWearableSummary.wearableContext.availableFeatureFamilies.includes("quality"), false);
  assert.equal(thinWearableSummary.wearableContext.missingQualityFeatureKeys.includes("wearable-coverage-index"), true);
  assert.equal(thinWearableSummary.wearableContext.readyFeatureCount, 1);
  assert.equal(thinWearableSummary.wearableContext.scoreContributionAuthorized, false);
  assert.equal(thinWearableSummary.wearableBridge.readyFeatureKeys.length, 0);
  assert.deepEqual(thinWearableSummary.wearableBridge.partialFeatureKeys, ["activity-volume"]);
  assert.equal(
    thinWearableSummary.wearableBridge.features.find((feature) => feature.featureKey === "activity-volume")
      ?.missingQualityMetricKeys.includes("wearable-valid-day-count-28d"),
    true,
  );

  const policyViolation = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: {
      lab9_bp_body_10y_acm_research: {
        ...researchModel,
        features: [
          ...researchModel.features,
          {
            coefficient: -0.1,
            key: "steps",
            kind: "metric",
            label: "Steps",
            metricKey: "steps",
            moduleId: "activity",
          },
        ],
      },
    },
    points: lab9Points,
    sex: "female",
  });

  assert.equal(policyViolation.status, "abstain");
  assert.equal(policyViolation.result?.status, "abstain");
  assert.equal(policyViolation.result?.authorization.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(policyViolation.warnings.some((warning) => warning.code === "MODEL_CARD_POLICY_VIOLATION"), true);
  const policyViolationSummary = summarizeMurphAgeCalculatorOutput(policyViolation);
  assert.equal(policyViolationSummary.displayStatus, "abstain");
  assert.equal(policyViolationSummary.displayBlockedReason, "policy-violation");
  assert.equal(policyViolationSummary.selectedScoreBearingMetricKeys.length, 0);

  const wearableSourcedBmiViolation = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: [
      ...lab9Points.filter((point) => point.metricKey !== "bmi"),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:bmi:2026-05-08:dispatcher-wearable-source:0",
        metricKey: "bmi",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "dispatcher_wearable_source_bmi",
        sourceKind: "wearable-summary",
        unit: "kg/m^2",
        value: 23.2,
      }),
    ],
    sex: "female",
  });

  assert.equal(wearableSourcedBmiViolation.status, "abstain");
  assert.equal(
    wearableSourcedBmiViolation.warnings.some((warning) =>
      warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.message.includes("wearable-summary")
    ),
    true,
  );

  const unknownSourceBmiViolation = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: [
      ...lab9Points.filter((point) => point.metricKey !== "bmi"),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:bmi:2026-05-08:dispatcher-unknown-source:0",
        metricKey: "bmi",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "dispatcher_unknown_source_bmi",
        sourceKind: "new-device-summary",
        unit: "kg/m^2",
        value: 23.2,
      }),
    ],
    sex: "female",
  });

  assert.equal(unknownSourceBmiViolation.status, "abstain");
  assert.equal(
    unknownSourceBmiViolation.warnings.some((warning) =>
      warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.message.includes("new-device-summary")
    ),
    true,
  );

  const unselectedWearableBmiDoesNotBlock = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: [
      ...lab9Points,
      metricPoint({
        effectiveDate: "2026-05-07",
        id: "metric-point:bmi:2026-05-07:dispatcher-unselected-wearable:0",
        metricKey: "bmi",
        observedAt: "2026-05-07T08:00:00.000Z",
        recordId: "dispatcher_unselected_wearable_bmi",
        sourceKind: "wearable-summary",
        unit: "kg/m^2",
        value: 23.8,
      }),
    ],
    sex: "female",
  });

  assert.equal(unselectedWearableBmiDoesNotBlock.status, "ready");
  assert.equal(unselectedWearableBmiDoesNotBlock.result?.status, "ready");
});

test("Murph Age calculator applies model calibration and log feature transforms", () => {
  const calibratedModel: MurphAgeRiskModel = {
    calibration: { intercept: 3, slope: 1 },
    endpoint: "10-year fixture outcome",
    features: [
      { coefficient: 0.02, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.1,
        key: "glucose-log",
        kind: "metric",
        label: "Glucose log",
        metricKey: "glucose",
        moduleId: "biomarkers",
        transform: { kind: "ln", offset: 1 },
      },
    ],
    horizonYears: 10,
    intercept: -3,
    modelId: "fixture-calibration-log-model",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.1 },
      { ageYears: 40, riskProbability: 0.5 },
      { ageYears: 60, riskProbability: 0.9 },
    ],
  };

  const result = calculateMurphAge({
    chronologicalAgeYears: 50,
    model: calibratedModel,
    points: [
      metricPoint({
        effectiveDate: "2026-05-01",
        id: "metric-point:glucose:2026-05-01:lab:0",
        metricKey: "glucose",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "lab_glucose_log",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 99,
      }),
    ],
    sex: "female",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.biologicalAgeYears, 55.6);
  assert.equal(result.ageDeltaYears, 5.6);
  assert.equal(result.risk?.probability, 0.811612);
  assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "glucose-log")?.contributionYears, 4);
});

test("Murph Age calculator requires unit contracts for custom model metrics", () => {
  const customMetricModel: MurphAgeRiskModel = {
    endpoint: "10-year fixture outcome",
    features: [
      { coefficient: 0, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.2,
        key: "custom-recovery-index",
        kind: "metric",
        label: "Custom recovery index",
        metricKey: "custom-recovery-index",
        moduleId: "recovery",
      },
    ],
    horizonYears: 10,
    intercept: -3,
    modelId: "fixture-custom-metric-model",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: fixtureReferenceRiskCurve(),
  };
  const customMetricPoint = metricPoint({
    effectiveDate: "2026-05-01",
    id: "metric-point:custom-recovery-index:2026-05-01:wearable:0",
    metricKey: "custom-recovery-index",
    observedAt: "2026-05-01T08:00:00.000Z",
    recordId: "wearable_custom_recovery_index",
    sourceKind: "wearable-summary",
    unit: "score",
    value: 3,
  });

  const blocked = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: customMetricModel,
    points: [customMetricPoint],
    sex: "female",
  });

  assert.equal(blocked.status, "abstain");
  assert.equal(blocked.warnings.some((warning) => warning.message.includes("did not declare an expected unit")), true);

  const explicitUnit = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: {
      ...customMetricModel,
      features: customMetricModel.features.map((feature) =>
        feature.kind === "metric" ? { ...feature, expectedUnit: "score" } : feature
      ),
    },
    points: [customMetricPoint],
    sex: "female",
  });

  assert.equal(explicitUnit.status, "ready");
  assert.equal(
    explicitUnit.featureAttributions.find((feature) => feature.featureKey === "custom-recovery-index")?.value,
    3,
  );
});

test("Murph Age calculator abstains on invalid external model parameters", () => {
  assert.equal(validateMurphAgeRiskModel(fixtureMurphAgeModel()).status, "valid");

  const invalidIntercept = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: {
      ...fixtureMurphAgeModel(),
      intercept: Number.NaN,
    },
    points: [],
    sex: "female",
  });

  assert.equal(invalidIntercept.status, "abstain");
  assert.equal(invalidIntercept.featureAttributions.length, 0);
  assert.equal(invalidIntercept.warnings.some((warning) => warning.message.includes("intercept")), true);

  const invalidFeature = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: {
      ...fixtureMurphAgeModel(),
      features: [
        { coefficient: 0.05, key: "age", kind: "chronological-age", label: "Age" },
        {
          coefficient: 0.1,
          key: "apob",
          kind: "metric",
          label: "ApoB",
          metricKey: "apob",
          moduleId: "biomarkers",
          transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 90, standardDeviation: 0 },
        },
      ],
    },
    points: [],
    sex: "female",
  });

  assert.equal(invalidFeature.status, "abstain");
  assert.equal(invalidFeature.warnings.some((warning) => warning.featureKey === "apob"), true);
  assert.equal(validateMurphAgeRiskModel({
    ...fixtureMurphAgeModel(),
    features: [
      { coefficient: 0.05, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.1,
        key: "apob",
        kind: "metric",
        label: "ApoB",
        metricKey: "apob",
        moduleId: "biomarkers",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 90, standardDeviation: 0 },
      },
    ],
  }).status, "invalid");
});

test("Murph Age calculator abstains when required model features are missing or blocked", () => {
  const missing = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: fixtureMurphAgeModel(),
    points: [],
    sex: "female",
  });

  assert.equal(missing.status, "abstain");
  assert.equal(missing.biologicalAgeYears, null);
  assert.equal(missing.warnings.some((warning) => warning.code === "MODEL_FEATURE_MISSING"), true);

  const blockedModel: MurphAgeRiskModel = {
    ...fixtureMurphAgeModel(),
    features: [
      { coefficient: 0.05, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.1,
        key: "custom-hs-crp-biomarker",
        kind: "metric",
        label: "hs-CRP published-clock comparator feature",
        biomarkerKey: "biomarker:hs-crp",
        metricKey: "custom-inflammation",
        moduleId: "published-clock-comparator",
      },
    ],
  };
  const blocked = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: blockedModel,
    points: [
      metricPoint({
        biomarkerKey: "biomarker:hs-crp",
        effectiveDate: "2026-05-01",
        id: "metric-point:custom-inflammation:2026-05-01:lab:0",
        metricKey: "custom-inflammation",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "lab_hs_crp",
        sourceKind: "test-result",
        unit: "mg/L",
        value: 0.8,
      }),
    ],
    sex: "female",
  });

  assert.equal(blocked.status, "abstain");
  assert.equal(blocked.warnings[0]?.code, "BLOCKED_MODEL_FEATURE");
  assert.deepEqual(blocked.featureAttributions[1]?.selectedPointIds, []);
  assert.equal(blocked.featureAttributions[1]?.value, null);

  const unsupportedUnitModel: MurphAgeRiskModel = {
    ...fixtureMurphAgeModel(),
    features: [
      { coefficient: 0.05, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.1,
        key: "glucose",
        kind: "metric",
        label: "Glucose",
        metricKey: "glucose",
        moduleId: "biomarkers",
      },
    ],
  };
  const unsupportedUnit = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: unsupportedUnitModel,
    points: [
      metricPoint({
        effectiveDate: "2026-05-01",
        id: "metric-point:glucose:2026-05-01:lab:0",
        metricKey: "glucose",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "lab_glucose_bad_unit",
        sourceKind: "test-result",
        unit: "stone",
        value: 90,
      }),
    ],
    sex: "female",
  });

  assert.equal(unsupportedUnit.status, "abstain");
  assert.equal(unsupportedUnit.warnings.some((warning) => warning.message.includes("unit was not normalized")), true);

  const comparatorValue = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: unsupportedUnitModel,
    points: [
      metricPoint({
        comparator: "<",
        effectiveDate: "2026-05-01",
        id: "metric-point:glucose:2026-05-01:lab:1",
        metricKey: "glucose",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "lab_glucose_comparator",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 90,
      }),
    ],
    sex: "female",
  });

  assert.equal(comparatorValue.status, "abstain");
  assert.equal(comparatorValue.warnings.some((warning) => warning.message.includes("censored by a comparator")), true);

  const comparatorAggregateModel: MurphAgeRiskModel = {
    ...fixtureMurphAgeModel(),
    features: [
      { coefficient: 0.05, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.1,
        key: "resting-heart-rate",
        kind: "metric",
        label: "Resting heart rate",
        metricKey: "resting-heart-rate",
        moduleId: "recovery",
        selectionPolicy: { kind: "daily-aggregate", latestWindowDays: 2, statistic: "mean" },
      },
    ],
  };
  const comparatorAggregate = calculateMurphAge({
    chronologicalAgeYears: 45,
    model: comparatorAggregateModel,
    points: [
      metricPoint({
        comparator: ">",
        effectiveDate: "2026-05-01",
        id: "metric-point:resting-heart-rate:2026-05-01:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "wearable_rhr_comparator_0",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 62,
      }),
      metricPoint({
        effectiveDate: "2026-05-02",
        id: "metric-point:resting-heart-rate:2026-05-02:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-05-02T08:00:00.000Z",
        recordId: "wearable_rhr_0",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 60,
      }),
    ],
    sex: "female",
  });

  assert.equal(comparatorAggregate.status, "abstain");
  assert.equal(comparatorAggregate.warnings.some((warning) => warning.message.includes("censored by a comparator")), true);
});

function fixtureMurphAgeModel(): MurphAgeRiskModel {
  return {
    endpoint: "10-year all-cause mortality",
    features: [
      { coefficient: 0.06, key: "age", kind: "chronological-age", label: "Age" },
      { coefficient: 0.15, key: "male", kind: "sex", label: "Male", sex: "male" },
      {
        coefficient: -0.1,
        key: "steps",
        kind: "metric",
        label: "Steps",
        metricKey: "steps",
        moduleId: "activity",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 8_000, standardDeviation: 2_000 },
      },
      {
        coefficient: 0.18,
        key: "apob",
        kind: "metric",
        label: "ApoB",
        metricKey: "apob",
        moduleId: "biomarkers",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 90, standardDeviation: 20 },
      },
      {
        coefficient: 0.12,
        key: "resting-heart-rate",
        kind: "metric",
        label: "Resting heart rate",
        metricKey: "resting-heart-rate",
        moduleId: "recovery",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 60, standardDeviation: 10 },
      },
      {
        coefficient: -0.04,
        key: "hrv-optional",
        kind: "metric",
        label: "HRV",
        metricKey: "hrv-rmssd",
        moduleId: "recovery",
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 45, standardDeviation: 15 },
      },
    ],
    horizonYears: 10,
    intercept: -6.2,
    modelId: "fixture-calibrated-risk-age-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: fixtureReferenceRiskCurve(),
    uncertainty: {
      baseYears: 1.5,
      perMissingOptionalFeatureYears: 2,
    },
  };
}

function fixtureLab9ResearchModel(): MurphAgeRiskModel {
  return {
    endpoint: "10-year all-cause mortality",
    features: [
      { coefficient: 0.04, key: "age", kind: "chronological-age", label: "Age" },
      { coefficient: 0.12, key: "male", kind: "sex", label: "Male", sex: "male" },
      {
        coefficient: 0.18,
        expectedUnit: "percent",
        key: "hba1c",
        kind: "metric",
        label: "HbA1c",
        metricKey: "hba1c",
        moduleId: "metabolic",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 5.5, standardDeviation: 0.5 },
      },
      {
        coefficient: 0.06,
        expectedUnit: "kg/m^2",
        key: "bmi",
        kind: "metric",
        label: "BMI",
        metricKey: "bmi",
        moduleId: "body",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 25, standardDeviation: 4 },
      },
    ],
    horizonYears: 10,
    intercept: -4.8,
    modelId: "fixture-lab9-research-card-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: fixtureReferenceRiskCurve(),
    uncertainty: {
      baseYears: 2,
    },
  };
}

function fixtureLab5ResearchModel(): MurphAgeRiskModel {
  return {
    endpoint: "10-year all-cause mortality",
    features: [
      { coefficient: 0.04, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.12,
        expectedUnit: "mg/dL",
        key: "glucose",
        kind: "metric",
        label: "Glucose",
        metricKey: "glucose",
        moduleId: "metabolic",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 95, standardDeviation: 15 },
      },
      {
        coefficient: -0.08,
        expectedUnit: "mL/min/1.73m^2",
        key: "egfr",
        kind: "metric",
        label: "eGFR",
        metricKey: "egfr",
        moduleId: "renal",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 90, standardDeviation: 15 },
      },
      {
        coefficient: 0.06,
        expectedUnit: "kg/m^2",
        key: "bmi",
        kind: "metric",
        label: "BMI",
        metricKey: "bmi",
        moduleId: "body",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 25, standardDeviation: 4 },
      },
    ],
    horizonYears: 10,
    intercept: -4.6,
    modelId: "fixture-lab5-research-card-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: fixtureReferenceRiskCurve(),
    uncertainty: {
      baseYears: 2,
    },
  };
}

function fixtureReferenceRiskCurve(): MurphAgeRiskModel["referenceRiskCurve"] {
  return [
    { ageYears: 20, riskProbability: 0.01 },
    { ageYears: 40, riskProbability: 0.03 },
    { ageYears: 60, riskProbability: 0.1 },
    { ageYears: 80, riskProbability: 0.3 },
  ];
}

function labMetricPoint(metricKey: string, unit: string, value: number): MetricPoint {
  return metricPoint({
    effectiveDate: "2026-05-01",
    id: `metric-point:${metricKey}:2026-05-01:lab:0`,
    metricKey,
    observedAt: "2026-05-01T08:00:00.000Z",
    recordId: `lab_${metricKey.replaceAll("-", "_")}`,
    sourceKind: "test-result",
    unit,
    value,
  });
}

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
