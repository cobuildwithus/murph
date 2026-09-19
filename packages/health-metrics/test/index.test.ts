import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
  canonicalizeWearableProviderSlug,
  normalizeWearableQueryProviderSlug,
  assessExperimentPrimaryMetricCapture,
  buildMetricSeries,
  createCustomMetricDefinition,
  formatMetricDisplayValue,
  formatTargetValue,
  listMetricPoints,
  listMetricDefinitions,
  normalizeMetricKey,
  normalizeUnit,
  normalizeLabResultMetricValue,
  normalizeMetricValue,
  resolveLabResultMetricDefinition,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
  experimentSessionMetricIsDeclared,
  resolveWearableCanonicalMetricKey,
  resolveWearableProviderDescriptor,
  validateExperimentSessionMetricValue,
  selectMetricGoalProgress,
  selectMetricSeries,
  selectMetricTrend,
  selectMetricValue,
  selectMetricWindowComparison,
  wearableMetricCatalog,
  type GoalMetricTarget,
  type MetricPoint,
  type MetricSeriesPoint,
} from "../src/index.ts";

test("keeps Google Health as a distinct wearable origin with a readable label", () => {
  assert.equal(canonicalizeWearableProviderSlug("google_health"), "google-health");
  assert.equal(resolveWearableProviderDescriptor("google-health")?.displayName, "Google Health");
  assert.notEqual(canonicalizeWearableProviderSlug("google_health"), "fitbit");
});

test("normalizes public wearable query providers without a connector allowlist", () => {
  assert.deepEqual(
    [
      "fitbit",
      "withings",
      "polar",
      "google_health",
      "apple_health",
      "apple_health_kit",
      "apple_healthkit",
      "whoop_v2",
      " future-ring ",
    ].map(normalizeWearableQueryProviderSlug),
    [
      "fitbit",
      "withings",
      "polar",
      "google-health",
      "apple-health",
      "apple-health-kit",
      "apple-health-kit",
      "whoop",
      "future-ring",
    ],
  );

  for (const invalid of [
    "",
    "   ",
    "junction",
    "bad provider",
    "bad/provider",
    "bad--provider",
    "bad\u0000provider",
    "a".repeat(81),
  ]) {
    assert.equal(normalizeWearableQueryProviderSlug(invalid), null, invalid);
  }
});

test("resolves metric aliases, biomarker primary metrics, and normalized metric keys", () => {
  assert.equal(normalizeMetricKey("restingHeartRate"), "resting-heart-rate");
  assert.equal(normalizeMetricKey(" Apo B / Latest "), "apo-b-latest");
  assert.equal(normalizeMetricKey("  hs_CRP / Latest! "), "hs-crp-latest");
  assert.ok(listMetricDefinitions().length > 10);
  assert.equal(resolveMetricDefinition("LDL_C")?.key, "ldl-c");
  assert.equal(resolveMetricDefinition("serum_albumin")?.key, "albumin");
  assert.equal(resolveMetricDefinition("eGFR")?.key, "egfr");
  assert.equal(resolveMetricDefinition("HbA1c")?.key, "hba1c");
  assert.equal(resolveMetricDefinition("Hemoglobin A1c")?.key, "hba1c");
  assert.equal(resolveMetricDefinition("alk-phos")?.key, "alkaline-phosphatase");
  assert.equal(resolveMetricDefinition("Alkaline phosphatase")?.key, "alkaline-phosphatase");
  assert.equal(resolveMetricDefinition("WBC")?.key, "white-blood-cell-count");
  assert.equal(resolveMetricDefinition("White blood cell count (WBC)")?.key, "white-blood-cell-count");
  assert.equal(resolveMetricDefinition("Lymphocyte pct")?.key, "lymphocyte-percentage");
  assert.equal(resolveMetricDefinition("RDW")?.key, "red-cell-distribution-width");
  assert.equal(resolveMetricDefinition("Red cell distribution width (RDW)")?.key, "red-cell-distribution-width");
  assert.equal(resolveMetricDefinition("BUN")?.key, "blood-urea-nitrogen");
  assert.equal(resolveMetricDefinition("Urea Nitrogen")?.key, "blood-urea-nitrogen");
  assert.equal(resolveMetricDefinition("TSH")?.key, "thyroid-stimulating-hormone");
  assert.equal(resolveMetricDefinition("MCH")?.key, "mean-corpuscular-hemoglobin");
  assert.equal(resolveMetricDefinition("MCHC")?.key, "mean-corpuscular-hemoglobin-concentration");
  assert.equal(resolveMetricDefinition("Testosterone"), null);
  assert.equal(resolveMetricDefinition("BUN/Creatinine Ratio"), null);
  assert.equal(resolveMetricDefinition("Urea"), null);
  assert.equal(resolveLabResultMetricDefinition("Estimated GFR CKD-EPI")?.key, "egfr-ckd-epi");
  assert.equal(resolveLabResultMetricDefinition("HbA1c NGSP")?.key, "hba1c");
  assert.equal(resolveLabResultMetricDefinition("HbA1c SI")?.key, "hba1c");
  assert.equal(resolveLabResultMetricDefinition("Testosterone total")?.key, "total-testosterone");
  assert.equal(resolveMetricDefinition("SBP")?.key, "systolic-blood-pressure");
  assert.equal(resolveMetricDefinition("diastolic_bp")?.key, "diastolic-blood-pressure");
  assert.equal(resolveMetricDefinition("body_mass_index")?.key, "bmi");
  assert.equal(resolveMetricDefinition("bodyfat")?.key, "body-fat-percentage");
  assert.equal(resolveMetricDefinition("bone_mass_percentage")?.key, "bone-mass-percentage");
  assert.equal(resolveMetricDefinition("muscle_mass_percentage")?.key, "muscle-mass-percentage");
  assert.equal(resolveMetricDefinition("visceral_fat_index")?.key, "visceral-fat-index");
  assert.equal(resolveMetricDefinition("water_percentage")?.key, "body-water-percentage");
  assert.equal(resolveMetricDefinition("bodymassindex")?.key, "bmi");
  assert.equal(resolveMetricDefinition("systolicbloodpressure")?.key, "systolic-blood-pressure");
  assert.equal(resolveMetricDefinition("diastolicbloodpressure")?.key, "diastolic-blood-pressure");
  assert.equal(resolveMetricDefinition("self_rated_health")?.key, "self-rated-health");
  assert.equal(resolveMetricDefinition("hypertension_history_proxy_yes")?.key, "hypertension-history-proxy-yes");
  assert.equal(resolveMetricDefinition("diabetes_history_proxy_yes")?.key, "diabetes-history-proxy-yes");
  assert.equal(resolveMetricDefinition("waist")?.key, "waist-circumference");
  assert.equal(resolveMetricDefinition("steps_per_day")?.key, "steps");
  assert.equal(resolveMetricDefinition("activity_counts")?.key, "activity-counts");
  assert.equal(resolveMetricDefinition("active_minutes")?.key, "activity-minutes");
  assert.equal(resolveMetricDefinition("sessionMinutes")?.key, "workout-minutes");
  assert.equal(resolveMetricDefinition("workout_duration")?.key, "workout-minutes");
  assert.equal(resolveMetricDefinition("sessionCount")?.key, "workout-count");
  assert.equal(resolveMetricDefinition("peakCadence")?.key, "peak-30-minute-cadence");
  assert.equal(resolveMetricDefinition("resting_hr")?.key, "resting-heart-rate");
  assert.equal(resolveMetricDefinition("hrv")?.key, "hrv-rmssd");
  assert.equal(resolveMetricDefinition("hrv_sdnn")?.key, "hrv-sdnn");
  assert.equal(resolveMetricDefinition("sdnn")?.biomarkerKey, "biomarker:hrv-sdnn");
  assert.equal(resolveMetricDefinition("whoop-ble-overnight-prv-rmssd")?.biomarkerKey, null);
  assert.equal(
    resolveMetricDefinition("whoop-ble-overnight-prv-rmssd")?.displayName,
    "WHOOP BLE scheduled overnight PRV",
  );
  assert.equal(resolveMetricDefinition("sleep_efficiency")?.key, "sleep-efficiency");
  assert.equal(resolveMetricDefinition("sleep_duration_hours")?.key, "total-sleep-minutes");
  assert.equal(resolveMetricDefinition("sleep_duration_variability")?.key, "sleep-duration-variability-minutes");
  assert.equal(resolveMetricDefinition("sleep_midpoint_variability")?.key, "sleep-midpoint-variability-minutes");
  assert.equal(resolveMetricDefinition("sleep-quality")?.key, "subjective-sleep-quality");
  assert.equal(resolveMetricDefinition("sleep_quality")?.key, "subjective-sleep-quality");
  assert.equal(
    resolveMetricDefinition("subjective_sleep_quality_next_morning")?.key,
    "subjective-sleep-quality",
  );
  assert.equal(resolveMetricDefinition("sleep_score")?.key, "sleep-score");
  assert.equal(resolveMetricDefinition("bedtime_delay_minutes")?.key, "bedtime-delay");
  assert.equal(resolveMetricDefinition("estimated_sleep_onset_minutes")?.key, "sleep-onset-latency");
  assert.equal(
    resolveMetricDefinition("estimated_sleep_onset_latency_minutes")?.key,
    "sleep-onset-latency",
  );
  assert.equal(resolveMetricDefinition("daytime_sleepiness")?.key, "daytime-sleepiness");
  assert.equal(resolveMetricDefinition("pre_sleep_arousal")?.key, "pre-sleep-arousal");
  assert.equal(
    resolveMetricDefinition("wake_after_sleep_onset_minutes")?.key,
    "wake-after-sleep-onset",
  );
  for (const [alias, expectedKey] of [
    ["daily-steps", "steps"],
    ["step-count-per-day", "steps"],
    ["steps_per_day", "steps"],
    ["actigraphy-counts", "activity-counts"],
    ["active-minutes", "activity-minutes"],
    ["activeMinutes", "activity-minutes"],
    ["workouts", "workout-count"],
    ["resting-hr", "resting-heart-rate"],
    ["sleep-hours", "total-sleep-minutes"],
    ["total_sleep_hours", "total-sleep-minutes"],
    ["sleep_midpoint_variability_minutes", "sleep-midpoint-variability-minutes"],
  ] as const) {
    assert.equal(resolveMetricDefinition(alias)?.key, expectedKey);
  }
  assert.equal(resolveMetricDefinition("respiratoryRate")?.key, "respiratory-rate");
  assert.equal(resolveMetricDefinition("temperature_deviation")?.key, "skin-temperature-deviation");
  assert.equal(resolveMetricDefinition("adl-count")?.key, "adl-limitation-count");
  assert.equal(resolveMetricDefinition("mobility-count")?.key, "mobility-limitation-count");
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
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:bun")?.key, "blood-urea-nitrogen");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:tsh")?.key, "thyroid-stimulating-hormone");
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:mch")?.key, "mean-corpuscular-hemoglobin");
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:mchc")?.key,
    "mean-corpuscular-hemoglobin-concentration",
  );
  assert.equal(resolveMetricDefinitionForBiomarker("biomarker:systolic-blood-pressure")?.key, "systolic-blood-pressure");
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:sleep-quality")?.key,
    "subjective-sleep-quality",
  );
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:bedtime-delay")?.key,
    "bedtime-delay",
  );
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:sleep-onset-latency")?.key,
    "sleep-onset-latency",
  );
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:daytime-sleepiness")?.key,
    "daytime-sleepiness",
  );
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:pre-sleep-arousal")?.key,
    "pre-sleep-arousal",
  );
  assert.equal(
    resolveMetricDefinitionForBiomarker("biomarker:wake-after-sleep-onset")?.key,
    "wake-after-sleep-onset",
  );
  assert.deepEqual(resolveExperimentSessionMetricSpec("wake_after_sleep_onset_minutes"), {
    aliases: [
      "wake-after-sleep-onset",
      "wake_after_sleep_onset",
      "wake-after-sleep-onset-minutes",
      "wake_after_sleep_onset_minutes",
      "waso",
      "waso-minutes",
    ],
    biomarkerKey: "biomarker:wake-after-sleep-onset",
    canonicalUnit: "minutes",
    displayName: "Wake after sleep onset",
    key: "wake-after-sleep-onset",
    maximum: 720,
    minimum: 0,
    valuePrecision: 0,
    valueType: "number",
  });
  assert.equal(
    resolveExperimentSessionMetricSpecForBiomarker("biomarker:wake-after-sleep-onset")?.key,
    "wake-after-sleep-onset",
  );
  assert.equal(
    resolveExperimentSessionMetricSpec("bedtime_delay_minutes")?.key,
    "bedtime-delay",
  );
  assert.equal(
    resolveExperimentSessionMetricSpecForBiomarker("biomarker:bedtime-delay")?.key,
    "bedtime-delay",
  );
  assert.deepEqual(validateExperimentSessionMetricValue({
    fieldId: "bedtime_delay_minutes",
    value: 721,
  }), {
    success: false,
    message: "bedtime_delay_minutes must be between 0 and 720 minutes.",
  });
  assert.equal(
    resolveExperimentSessionMetricSpec("soreness_score")?.key,
    "muscle-soreness-score",
  );
  assert.equal(resolveWearableCanonicalMetricKey("activity-minutes"), "activityMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("low-activity-minutes"), "lowActivityMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("medium_activity_minutes"), "mediumActivityMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("high-activity-minutes"), "highActivityMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("average-heart-rate"), "averageHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("walking-average-heart-rate"), "walkingAverageHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("lowest-heart-rate"), "lowestHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("sleep-latency-minutes"), "sleepLatencyMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("sleep_latency_minutes"), "sleepLatencyMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("bone_mass_percentage"), "boneMassPercentage");
  assert.equal(resolveWearableCanonicalMetricKey("muscle_mass_percentage"), "muscleMassPercentage");
  assert.equal(resolveWearableCanonicalMetricKey("visceral_fat_index"), "visceralFatIndex");
  assert.equal(resolveWearableCanonicalMetricKey("water_percentage"), "bodyWaterPercentage");
  assert.equal(resolveWearableCanonicalMetricKey("activity-lowest-heart-rate"), "minimumHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("skin-temp"), "temperatureDeviation");
  assert.equal(resolveWearableCanonicalMetricKey("session-count"), "sessionCount");
  assert.equal(resolveWearableCanonicalMetricKey("workout-minutes"), "sessionMinutes");
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

test("resolves every legacy collapsed body and blood-pressure identity from the owning catalog", () => {
  const relevantDefinitions = listMetricDefinitions().filter((definition) =>
    definition.category === "body"
    || definition.key === "systolic-blood-pressure"
    || definition.key === "diastolic-blood-pressure"
  );

  assert.ok(relevantDefinitions.length >= 6);
  for (const definition of relevantDefinitions) {
    for (const identity of [definition.key, ...definition.aliases]) {
      const collapsedIdentity = normalizeMetricKey(identity).replace(/-/gu, "");
      assert.equal(
        resolveMetricDefinition(collapsedIdentity)?.key,
        definition.key,
        `${identity} must retain its canonical identity after legacy writer collapse`,
      );
    }
  }

  for (const wearableKey of [
    "bmi",
    "bodyFatPercentage",
    "bodyWaterPercentage",
    "boneMassPercentage",
    "leanBodyMassKg",
    "muscleMassPercentage",
    "visceralFatIndex",
    "waistCircumference",
    "weightKg",
  ] as const) {
    const entry = wearableMetricCatalog[wearableKey];
    for (const identity of [entry.key, ...entry.aliases]) {
      const definition = resolveMetricDefinition(identity);
      assert.equal(
        definition?.category,
        "body",
        `${identity} must resolve through the general body identity owner`,
      );
      assert.equal(
        resolveMetricDefinition(normalizeMetricKey(identity).replace(/-/gu, ""))?.key,
        definition?.key,
        `${identity} must retain its general body identity after legacy writer collapse`,
      );
    }
  }
});

test("requires exactly one session capture field for a subjective primary metric", () => {
  assert.deepEqual(assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: "biomarker:sleep-quality",
    sessionFields: [],
  }), {
    canonicalBiomarkerKey: "biomarker:sleep-quality",
    issue: "uncapturable_primary_biomarker",
    matchingSessionFieldIds: [],
    metricKey: "subjective-sleep-quality",
    requiresSessionField: true,
  });
  assert.deepEqual(assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: "biomarker:sleep-quality",
    sessionFields: ["sleep_quality_0_10"],
  }), {
    canonicalBiomarkerKey: "biomarker:sleep-quality",
    issue: null,
    matchingSessionFieldIds: ["sleep_quality_0_10"],
    metricKey: "subjective-sleep-quality",
    requiresSessionField: true,
  });
  assert.deepEqual(assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: "biomarker:sleep-quality",
    sessionFields: ["sleep_quality_0_10", "subjective_sleep_quality"],
  }), {
    canonicalBiomarkerKey: "biomarker:sleep-quality",
    issue: "uncapturable_primary_biomarker",
    matchingSessionFieldIds: ["sleep_quality_0_10", "subjective_sleep_quality"],
    metricKey: "subjective-sleep-quality",
    requiresSessionField: true,
  });
  assert.equal(experimentSessionMetricIsDeclared({
    biomarkerKey: "biomarker:sleep-quality",
    sessionFields: ["sleep_quality_0_10", "subjective_sleep_quality"],
  }), false);

  assert.deepEqual(assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: "biomarker:resting-heart-rate",
    sessionFields: [],
  }), {
    canonicalBiomarkerKey: "biomarker:resting-heart-rate",
    issue: null,
    matchingSessionFieldIds: [],
    metricKey: "resting-heart-rate",
    requiresSessionField: false,
  });
  assert.deepEqual(assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: "biomarker:repetition-capacity",
    sessionFields: [],
  }), {
    canonicalBiomarkerKey: "biomarker:repetition-capacity",
    issue: null,
    matchingSessionFieldIds: [],
    metricKey: "repetition-capacity",
    requiresSessionField: false,
  });
  assert.deepEqual(assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: "biomarker:bun",
    sessionFields: [],
  }), {
    canonicalBiomarkerKey: "biomarker:blood-urea-nitrogen",
    issue: null,
    matchingSessionFieldIds: [],
    metricKey: "blood-urea-nitrogen",
    requiresSessionField: false,
  });
  for (const metricKey of ["body-weight", "sleep-efficiency", "sleep-score"]) {
    assert.deepEqual(assessExperimentPrimaryMetricCapture({
      primaryBiomarkerKey: `biomarker:${metricKey}`,
      sessionFields: [],
    }), {
      canonicalBiomarkerKey: `biomarker:${metricKey}`,
      issue: null,
      matchingSessionFieldIds: [],
      metricKey,
      requiresSessionField: false,
    });
  }
});

test("normalizes clinical stature and infant weight across source units", () => {
  assert.equal(resolveMetricDefinition("height")?.key, "body-height");
  for (const metricKey of ["height", "head-circumference"]) {
    const result = normalizeMetricValue({ metricKey, unit: "in", value: 15 });
    assert.equal(result.canonicalUnit, "cm");
    assert.equal(result.canonicalValue, 38.1);
    assert.deepEqual(result.warnings, []);
    assert.equal(normalizeMetricValue({ metricKey, unit: "kg", value: 15 }).canonicalValue, null);
  }
  assert.equal(normalizeMetricValue({ metricKey: "body-weight", unit: "g", value: 3500 }).canonicalValue, 3.5);
  assert.equal(normalizeMetricValue({ metricKey: "bmi", unit: "kg/m2", value: 24.2 }).canonicalValue, 24.2);
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

  assert.deepEqual(normalizeMetricValue({
    metricKey: "lean-body-mass",
    unit: "lb",
    value: 150,
  }), {
    canonicalUnit: "kg",
    canonicalValue: 68.0389,
    unit: "lb",
    warnings: [],
  });

  assert.deepEqual(normalizeMetricValue({
    metricKey: "lean-body-mass",
    unit: "kg",
    value: 68,
  }), {
    canonicalUnit: "kg",
    canonicalValue: 68,
    unit: "kg",
    warnings: [],
  });

  assert.equal(normalizeMetricValue({
    metricKey: "body-weight",
    unit: "stone",
    value: 12,
  }).warnings[0]?.code, "UNIT_NOT_NORMALIZED");

  assert.deepEqual(normalizeMetricValue({
    metricKey: "sleep_duration_hours",
    unit: null,
    value: 7.5,
  }), {
    canonicalUnit: "minutes",
    canonicalValue: 450,
    unit: "hours",
    warnings: [],
  });
  for (const unit of ["h", "hr", "hrs", "hour", "hours"]) {
    assert.deepEqual(normalizeMetricValue({
      metricKey: "total-sleep-minutes",
      unit,
      value: 7.5,
    }), {
      canonicalUnit: "minutes",
      canonicalValue: 450,
      unit: "hours",
      warnings: [],
    });
  }

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
  const conversionOnlyLabs = [
    {
      expectedValue: 10,
      metricKeys: ["calcium", "serum-calcium", "total-calcium"],
      unit: "mmol/L",
      value: 2.5,
    },
    {
      expectedValue: 193.35,
      metricKeys: ["cholesterol", "cholesterol-total", "total-cholesterol"],
      unit: "mmol/L",
      value: 5,
    },
    {
      expectedValue: 5.0436,
      metricKeys: ["serum-uric-acid", "urate", "uric-acid"],
      unit: "mmol/L",
      value: 0.3,
    },
    {
      expectedValue: 1,
      metricKeys: ["bilirubin", "bilirubin-total", "total-bilirubin"],
      unit: "umol/L",
      value: 17.1,
    },
  ] as const;
  for (const { expectedValue, metricKeys, unit, value } of conversionOnlyLabs) {
    for (const metricKey of metricKeys) {
      assert.equal(resolveMetricDefinition(metricKey), null);
      assert.deepEqual(normalizeMetricValue({ metricKey, unit, value }), {
        canonicalUnit: "mg/dL",
        canonicalValue: expectedValue,
        unit,
        warnings: [],
      });
    }
  }
  assert.deepEqual(normalizeMetricValue({
    metricKey: "total-protein",
    unit: "g/L",
    value: 70,
  }), {
    canonicalUnit: "g/dL",
    canonicalValue: 7,
    unit: "g/L",
    warnings: [],
  });
  assert.deepEqual(normalizeMetricValue({
    metricKey: "absolute-neutrophils",
    unit: "cells/uL",
    value: 4_000,
  }), {
    canonicalUnit: "10^3/uL",
    canonicalValue: 4,
    unit: "cells/uL",
    warnings: [],
  });
  assert.equal(normalizeMetricValue({
    metricKey: "white-blood-cell-count",
    unit: "cells/µL",
    value: 7_200,
  }).canonicalValue, 7.2);
  assert.equal(normalizeUnit("x10E3/uL"), "10^3/uL");
  assert.equal(normalizeUnit("10*3/µL"), "10^3/uL");
  assert.equal(normalizeUnit("x10^9/L"), "10^3/uL");
  assert.equal(normalizeUnit("Thousand/uL"), "10^3/uL");
  assert.equal(normalizeUnit("x10E6/uL"), "10^6/uL");
  assert.equal(normalizeUnit("10^12/L"), "10^6/uL");
  assert.equal(normalizeUnit("cells/µL"), "cells/uL");
  assert.equal(normalizeUnit("µmol/L"), "umol/L");
  assert.equal(normalizeUnit("calc"), "ratio");
  assert.equal(normalizeUnit("mL/min/1.73sq m"), "mL/min/1.73m^2");
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
  assert.equal(normalizeMetricValue({
    metricKey: "respiratory-rate",
    unit: "breaths/minute",
    value: 14.2,
  }).canonicalUnit, "breaths/min");
  assert.equal(normalizeMetricValue({
    metricKey: "skin-temperature-deviation",
    unit: "celsius",
    value: 0.1,
  }).canonicalUnit, "degC");
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
  assert.deepEqual(normalizeMetricValue({
    metricKey: "urea-nitrogen",
    unit: "mmol/L",
    value: 4,
  }), {
    canonicalUnit: "mg/dL",
    canonicalValue: 11.2045,
    unit: "mmol/L",
    warnings: [],
  });
  assert.deepEqual(normalizeMetricValue({
    metricKey: "TSH",
    unit: "uIU/mL",
    value: 1.25,
  }), {
    canonicalUnit: "mIU/L",
    canonicalValue: 1.25,
    unit: "mIU/L",
    warnings: [],
  });
  assert.equal(normalizeMetricValue({
    metricKey: "MCH",
    unit: "pg",
    value: 29.4,
  }).canonicalUnit, "pg");
  assert.equal(normalizeMetricValue({
    metricKey: "MCHC",
    unit: "g/dL",
    value: 32.5,
  }).canonicalUnit, "g/dL");

  assert.deepEqual(normalizeLabResultMetricValue({
    metricKey: "egfr-ckd-epi",
    unit: "mL/min/1.73m^2",
    value: 89,
  }), {
    canonicalUnit: "mL/min/1.73m^2",
    canonicalValue: 89,
    unit: "mL/min/1.73m^2",
    warnings: [],
  });
  assert.deepEqual(normalizeMetricValue({
    metricKey: "egfr-ckd-epi",
    unit: "mL/min/1.73m^2",
    value: 89,
  }), {
    canonicalUnit: null,
    canonicalValue: null,
    unit: "mL/min/1.73m^2",
    warnings: [],
  });
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

test("reduces report sequence before the legacy fallback without input-order cycles", () => {
  const common = {
    effectiveDate: "2026-08-13",
    metricKey: "steps",
    recordedAt: "2026-08-13T18:00:00.000Z",
    sourceKind: "observation" as const,
    unit: "count",
  };
  const older = metricPoint({
    ...common,
    context: { causalSeq: "41" },
    id: "metric-point:opaque-a",
    observedAt: "2026-08-13T19:00:00.000Z",
    recordId: "evt_older_report",
    value: 8_000,
  });
  const newer = metricPoint({
    ...common,
    context: { causalSeq: "42" },
    id: "metric-point:opaque-z",
    observedAt: "2026-08-13T16:00:00.000Z",
    recordId: "evt_newer_report",
    value: 9_000,
  });
  const legacy = metricPoint({
    ...common,
    context: {},
    id: "metric-point:legacy-manual",
    observedAt: "2026-08-13T17:00:00.000Z",
    recordId: "evt_legacy_manual",
    value: 8_500,
  });

  assert.equal(selectMetricValue({ metricKey: "steps", points: [older, newer] }).value, 9_000);
  for (const points of [
    [newer, legacy, older],
    [newer, older, legacy],
    [legacy, newer, older],
    [legacy, older, newer],
    [older, newer, legacy],
    [older, legacy, newer],
  ]) {
    assert.equal(selectMetricValue({ metricKey: "steps", points }).value, 8_500);
    assert.equal(selectMetricSeries({
      duplicatePolicy: "selection-policy",
      grain: "day",
      metricKey: "steps",
      points,
      statistic: "value",
    }).rows[0]?.value, 8_500);
  }
  assert.equal(selectMetricValue({
    metricKey: "steps",
    points: [
      { ...older, context: {} },
      { ...newer, context: {} },
    ],
  }).value, 8_000);
  assert.equal(selectMetricValue({
    metricKey: "steps",
    points: [
      { ...older, context: {}, observedAt: newer.observedAt },
      { ...newer, context: {} },
    ],
  }).value, 8_000);
});

test("requires truthful unit evidence before catalog metrics become selections or series", () => {
  const unitlessLdl = {
    ...metricPoint({
      biomarkerKey: "biomarker:ldl-c",
      effectiveDate: "2026-04-23",
      id: "metric-point:ldl-c:2026-04-23:lab:0",
      metricKey: "ldl-c",
      observedAt: "2026-04-23T08:00:00.000Z",
      recordId: "lab_ldl_unitless",
      sourceKind: "test-result",
      unit: "mg/dL",
      value: 140,
    }),
    canonicalUnit: null,
    canonicalValue: null,
    unit: null,
  } satisfies MetricPoint;
  const unitfulLdl = metricPoint({
    biomarkerKey: "biomarker:ldl-c",
    effectiveDate: "2026-08-02",
    id: "metric-point:ldl-c:2026-08-02:lab:0",
    metricKey: "ldl-c",
    observedAt: "2026-08-02T08:00:00.000Z",
    recordId: "lab_ldl_unitful",
    sourceKind: "test-result",
    unit: "mg/dL",
    value: 120,
  });

  const unitlessSelection = selectMetricValue({
    metricKey: "ldl-c",
    points: [unitlessLdl],
  });
  assert.equal(unitlessSelection.status, "no_data");
  assert.equal(unitlessSelection.point, null);
  assert.equal(unitlessSelection.value, null);
  assert.equal(
    unitlessSelection.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"),
    true,
  );

  const unitlessSeries = selectMetricSeries({
    duplicatePolicy: "keep-all",
    metricKey: "ldl-c",
    points: [unitlessLdl],
  });
  assert.equal(unitlessSeries.status, "no_data");
  assert.deepEqual(unitlessSeries.rows, []);
  assert.equal(
    unitlessSeries.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"),
    true,
  );

  const staleCanonicalLdl = {
    ...unitlessLdl,
    canonicalUnit: "mg/dL",
    canonicalValue: 140,
  } satisfies MetricPoint;
  assert.equal(
    selectMetricValue({ metricKey: "ldl-c", points: [staleCanonicalLdl] }).status,
    "no_data",
  );
  assert.deepEqual(
    selectMetricSeries({ metricKey: "ldl-c", points: [staleCanonicalLdl] }).rows,
    [],
  );
  const staleCanonicalGoal = selectMetricGoalProgress({
    goalId: "goal_ldl_stale_canonical",
    points: [staleCanonicalLdl],
    target: {
      comparator: "<",
      evaluation: { kind: "selected-value" },
      kind: "metric",
      metricKey: "ldl-c",
      targetId: "ldl-under-130",
      unit: "mg/dL",
      value: 130,
    },
  });
  assert.equal(staleCanonicalGoal.status, "unsupported");
  assert.equal(staleCanonicalGoal.currentValue, null);

  const unitfulSelection = selectMetricValue({
    metricKey: "ldl-c",
    points: [unitfulLdl],
  });
  assert.equal(unitfulSelection.status, "ready");
  assert.equal(unitfulSelection.value, 120);
  assert.equal(unitfulSelection.unit, "mg/dL");
  assert.deepEqual(
    selectMetricSeries({
      duplicatePolicy: "keep-all",
      metricKey: "ldl-c",
      points: [unitfulLdl],
    }).rows.map((row) => [row.value, row.unit]),
    [[120, "mg/dL"]],
  );

  const explicitRawCanonicalUnit = {
    ...unitfulLdl,
    canonicalUnit: null,
    canonicalValue: null,
  } satisfies MetricPoint;
  const explicitRawSelection = selectMetricValue({
    metricKey: "ldl-c",
    points: [explicitRawCanonicalUnit],
  });
  assert.equal(explicitRawSelection.status, "ready");
  assert.equal(explicitRawSelection.value, 120);
  assert.equal(explicitRawSelection.unit, "mg/dL");
  assert.equal(
    explicitRawSelection.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"),
    false,
  );
  assert.deepEqual(
    selectMetricSeries({
      duplicatePolicy: "keep-all",
      metricKey: "ldl-c",
      points: [explicitRawCanonicalUnit],
    }).rows.map((row) => [row.value, row.unit]),
    [[120, "mg/dL"]],
  );

  const explicitRawAggregate = selectMetricValue({
    metricKey: "ldl-c",
    points: [explicitRawCanonicalUnit],
    policyOverride: { kind: "daily-aggregate", statistic: "mean" },
  });
  assert.equal(explicitRawAggregate.status, "ready");
  assert.equal(explicitRawAggregate.value, 120);
  assert.equal(explicitRawAggregate.unit, "mg/dL");
  assert.equal(
    explicitRawAggregate.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"),
    false,
  );

  const incompatibleRawUnit = {
    ...unitfulLdl,
    canonicalUnit: null,
    canonicalValue: null,
    unit: "mmol/L",
    value: 3.1,
  } satisfies MetricPoint;
  assert.equal(
    selectMetricValue({ metricKey: "ldl-c", points: [incompatibleRawUnit] }).status,
    "no_data",
  );
  assert.deepEqual(
    selectMetricSeries({ metricKey: "ldl-c", points: [incompatibleRawUnit] }).rows,
    [],
  );

  const legacyDerivedSummary = {
    ...metricPoint({
      biomarkerKey: "biomarker:resting-heart-rate",
      effectiveDate: "2026-08-02",
      id: "metric-point:resting-heart-rate:2026-08-02:wearable:0",
      metricKey: "resting-heart-rate",
      observedAt: "2026-08-02T08:00:00.000Z",
      recordId: "wearable_rhr_legacy_summary",
      sourceKind: "wearable-summary",
      unit: "bpm",
      value: 52,
    }),
    canonicalUnit: null,
    canonicalValue: null,
    unit: null,
  } satisfies MetricPoint;
  const legacyDerivedSelection = selectMetricValue({
    metricKey: "resting-heart-rate",
    points: [legacyDerivedSummary],
    policyOverride: { kind: "latest-valid" },
  });
  assert.equal(legacyDerivedSelection.status, "ready");
  assert.equal(legacyDerivedSelection.value, 52);
  assert.equal(legacyDerivedSelection.unit, "bpm");
  assert.deepEqual(
    selectMetricSeries({
      duplicatePolicy: "keep-all",
      metricKey: "resting-heart-rate",
      points: [legacyDerivedSummary],
    }).rows.map((row) => [row.value, row.unit]),
    [[52, "bpm"]],
  );

  const mismatchedCanonicalUnit = {
    ...unitfulLdl,
    canonicalUnit: "mmol/L",
    canonicalValue: 3.1,
  } satisfies MetricPoint;
  assert.equal(
    selectMetricValue({ metricKey: "ldl-c", points: [mismatchedCanonicalUnit] }).status,
    "no_data",
  );
  assert.deepEqual(
    selectMetricSeries({ metricKey: "ldl-c", points: [mismatchedCanonicalUnit] }).rows,
    [],
  );

  const customUnitless = {
    ...metricPoint({
      effectiveDate: "2026-04-23",
      id: "metric-point:custom-score:2026-04-23:measurement:0",
      metricKey: "custom-score",
      observedAt: "2026-04-23T08:00:00.000Z",
      recordId: "custom_score_unitless",
      sourceKind: "measurement",
      unit: "score",
      value: 7,
    }),
    canonicalUnit: null,
    canonicalValue: null,
    unit: null,
  } satisfies MetricPoint;
  assert.equal(selectMetricValue({ points: [customUnitless] }).value, 7);
  assert.equal(
    selectMetricSeries({ duplicatePolicy: "keep-all", points: [customUnitless] }).rows[0]?.value,
    7,
  );

  const customUnitlessTestResult = {
    ...customUnitless,
    id: "metric-point:custom-score:2026-04-23:test-result:0",
    source: {
      ...customUnitless.source,
      kind: "test-result",
      recordId: "custom_score_unitless_test_result",
    },
  } satisfies MetricPoint;
  assert.equal(selectMetricValue({ points: [customUnitlessTestResult] }).value, null);
  assert.deepEqual(
    selectMetricSeries({ duplicatePolicy: "keep-all", points: [customUnitlessTestResult] }).rows,
    [],
  );
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

test("catalog metrics require reported units when canonical fields are unavailable", () => {
  const cases = [
    { key: "blood-urea-nitrogen", unit: "mg/dL", unitful: 14, unitless: 7 },
    { key: "thyroid-stimulating-hormone", unit: "mIU/L", unitful: 2.5, unitless: 4 },
    { key: "mean-corpuscular-hemoglobin", unit: "pg", unitful: 30, unitless: 32 },
    { key: "mean-corpuscular-hemoglobin-concentration", unit: "g/dL", unitful: 33, unitless: 35 },
  ] as const;

  for (const testCase of cases) {
    const unitful = metricPoint({
      effectiveDate: "2026-03-01",
      id: `metric-point:${testCase.key}:unitful`,
      metricKey: testCase.key,
      observedAt: "2026-03-01T08:00:00.000Z",
      recordId: `${testCase.key}-unitful`,
      sourceKind: "test-result",
      unit: testCase.unit,
      value: testCase.unitful,
    });
    const unitless = {
      ...unitful,
      canonicalUnit: null,
      canonicalValue: null,
      effectiveDate: "2026-04-01",
      id: `metric-point:${testCase.key}:unitless`,
      observedAt: "2026-04-01T08:00:00.000Z",
      source: { ...unitful.source, recordId: `${testCase.key}-unitless` },
      unit: null,
      value: testCase.unitless,
    } satisfies MetricPoint;

    const selected = selectMetricValue({
      metricKey: testCase.key,
      points: [unitful, unitless],
    });
    const series = selectMetricSeries({
      duplicatePolicy: "keep-all",
      metricKey: testCase.key,
      points: [unitful, unitless],
    });

    assert.equal(selected.point?.id, unitful.id, testCase.key);
    assert.equal(selected.value, testCase.unitful, testCase.key);
    assert.equal(selected.unit, testCase.unit, testCase.key);
    assert.deepEqual(series.rows.map((row) => row.value), [testCase.unitful], testCase.key);
  }
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

test("uses canonical recording order for a non-sleep metric before opaque identity", () => {
  const olderFact = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:opaque-sort-last",
    metricKey: "body-weight",
    observedAt: "2026-04-29T12:00:00.000Z",
    recordedAt: "2026-04-30T08:00:00.000Z",
    recordId: "evt_older_weight",
    sourceKind: "observation",
    unit: "kg",
    value: 80,
  });
  const newerFact = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:opaque-sort-first",
    metricKey: "body-weight",
    observedAt: "2026-04-29T12:00:00.000Z",
    recordedAt: "2026-04-30T09:00:00.000Z",
    recordId: "evt_newer_weight",
    sourceKind: "observation",
    unit: "kg",
    value: 81,
  });
  const unsupportedNewestFact = metricPoint({
    effectiveDate: "2026-04-29",
    id: "metric-point:opaque-invalid-newest",
    metricKey: "body-weight",
    observedAt: "2026-04-29T12:00:00.000Z",
    recordedAt: "2026-04-30T10:00:00.000Z",
    recordId: "evt_unsupported_weight",
    sourceKind: "observation",
    unit: "seconds",
    value: 5_400,
  });

  const selected = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    metricKey: "body-weight",
    points: [olderFact, newerFact, unsupportedNewestFact],
  });

  assert.deepEqual(selected.rows.map((row) => row.pointIds), [[newerFact.id]]);
  assert.ok(selected.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED"));
  const selectedValue = selectMetricValue({
    metricKey: "body-weight",
    points: [olderFact, newerFact, unsupportedNewestFact],
  });
  assert.equal(selectedValue.value, 81);
  assert.equal(selectedValue.point?.id, newerFact.id);
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
  assert.equal(mixedUnits.status, "unsupported");
  assert.equal(mixedUnits.delta, null);

  const unitlessBaseline = selectMetricWindowComparison({
    baselineWindow: { end: "2026-04-01", start: "2026-04-01", totalDays: 1 },
    comparisonWindow: { end: "2026-04-02", start: "2026-04-02", totalDays: 1 },
    metricKey: "resting-heart-rate",
    points: [
      { ...seriesPoint("2026-04-01", 60), unit: null },
      seriesPoint("2026-04-02", 62),
    ],
  });
  assert.equal(unitlessBaseline.status, "unsupported");
  assert.equal(unitlessBaseline.delta, null);
  assert.equal(unitlessBaseline.unit, null);

  const oneSidedUnit = selectMetricWindowComparison({
    baselineWindow: { end: "2026-04-01", start: "2026-04-01", totalDays: 1 },
    comparisonWindow: { end: "2026-04-02", start: "2026-04-02", totalDays: 1 },
    metricKey: "resting-heart-rate",
    points: [seriesPoint("2026-04-01", 60)],
  });
  assert.equal(oneSidedUnit.status, "insufficient_data");
  assert.equal(oneSidedUnit.delta, null);
  assert.equal(oneSidedUnit.unit, "bpm");

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

test("reduces open-ended experiment windows with declared statistics", () => {
  const points = [
    { ...seriesPoint("2026-04-01", 8), id: "row:baseline:1" },
    { ...seriesPoint("2026-04-01", 10), id: "row:baseline:2" },
    { ...seriesPoint("2026-04-02", 9), id: "row:baseline:3" },
    { ...seriesPoint("2026-04-03", 11), id: "row:followup:1" },
    { ...seriesPoint("2026-04-03", 12), id: "row:followup:2" },
    { ...seriesPoint("2026-04-03", 10), id: "row:followup:3" },
  ];
  const windows = {
    baselineWindow: { end: "2026-04-02", start: "2026-04-01", totalDays: 2 },
    comparisonWindow: { end: "2026-04-03", start: "2026-04-03", totalDays: 1 },
    metricKey: "resting-heart-rate",
    points,
  };

  const maximum = selectMetricWindowComparison({
    ...windows,
    statistic: "max",
  });
  assert.equal(maximum.baseline.value, 10);
  assert.equal(maximum.comparison.value, 12);
  assert.equal(maximum.delta, 2);

  const counted = selectMetricWindowComparison({
    ...windows,
    statistic: "count",
  });
  assert.equal(counted.baseline.value, 3);
  assert.equal(counted.comparison.value, 3);
  assert.equal(counted.unit, "count");

  const mean = selectMetricWindowComparison({
    ...windows,
    statistic: "mean",
  });
  assert.equal(mean.baseline.value, 9);
  assert.equal(mean.comparison.value, 11);

  const latest = selectMetricWindowComparison({
    ...windows,
    statistic: "latest",
  });
  assert.equal(latest.baseline.value, 9);
  assert.equal(latest.comparison.value, 10);
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

function metricPoint(input: {
  biomarkerKey?: string | null;
  comparator?: MetricPoint["comparator"];
  context?: MetricPoint["context"];
  effectiveDate: string;
  id: string;
  metricKey?: string;
  observedAt: string;
  recordedAt?: string | null;
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
    recordedAt: input.recordedAt ?? null,
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


test("normalizes percentage-based sleep and recovery scores without treating other score units as equivalent", () => {
  for (const metricKey of ["sleep-score", "readiness-score", "recovery-score"]) {
    for (const unit of ["%", "percent", "percentage"]) {
      const normalized = normalizeMetricValue({ metricKey, unit, value: 78 });
      assert.equal(normalized.canonicalUnit, "score");
      assert.equal(normalized.canonicalValue, 78);
      assert.deepEqual(normalized.warnings, []);
    }
    assert.equal(normalizeMetricValue({ metricKey, unit: "score", value: 78 }).canonicalValue, 78);
    const incompatible = normalizeMetricValue({ metricKey, unit: "kg", value: 78 });
    assert.equal(incompatible.canonicalValue, null);
    assert.equal(incompatible.warnings.length, 1);
  }
  assert.equal(normalizeMetricValue({ metricKey: "sleep-score", unit: "%", value: Number.NaN }).canonicalValue, null);
});
