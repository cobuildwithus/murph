import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
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
import {
  MURPH_AGE_ARCHITECTURE_SUMMARY_SCHEMA_VERSION,
  MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION,
  MURPH_AGE_FUNCTION_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
  MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_STATUS_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT,
  MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
  MURPH_AGE_SUBMITTED_CALCULATOR_INPUT_BUNDLE_SPEC_SCHEMA_VERSION,
  MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_COVERAGE_MIN_VALID_DAYS,
  MURPH_AGE_WEARABLE_COVERAGE_WINDOW_DAYS,
  MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS,
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_SCHEMA_VERSION,
  applyMurphAgeFunctionResidualLayer,
  applyMurphAgeWearableResidualLayer,
  assessMurphAgeInputBundle,
  assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard,
  assessMurphAgeWearableShadowIncrements,
  buildMurphAgePublicCalculatorView,
  buildMurphAgeSubmittedCalculatorViewBundle,
  buildMurphAgeResearchCalculatorView,
  buildMurphAgeIncrementEvaluationCard,
  buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt,
  calculateMurphAge,
  calculateMurphAgeFromInputBundle,
  calculateMurphAgeFromSubmittedInputs,
  calculateMurphAgePublicReportFromInputBundle,
  calculateMurphAgePublicReportFromSubmittedInputs,
  hasMurphAgeProductPromotionEvidenceTier,
  isMurphAgeInputBundleMetricPointAllowed,
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  isMurphAgeWearableBridgeValidDayMetricPoint,
  isMurphAgeWearableBridgeValidNightMetricPoint,
  isMurphAgeWearableShadowAnchorCardId,
  listMurphAgeInputBundleMetricKeys,
  listMurphAgeModelCardPolicies,
  listMurphAgeModelCardProductPromotionBlockers,
  listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates,
  listMurphAgeSubmittedCalculatorInputBundleSpecs,
  listMurphAgeSubmittedCalculatorMetricInputSpecs,
  listMurphAgeWearableBridgeFeatureSpecs,
  listMurphAgeWearableBridgeMetricSourceHints,
  listMurphAgeWearableShadowAnchorCardIds,
  listMurphAgeWearableShadowIncrementPolicies,
  mapRiskToReferenceAge,
  parseMurphAgeLocalModelCardArtifact,
  parseMurphAgeRiskModelArtifact,
  resolveMurphAgeModelCardPolicy,
  resolveMurphAgeWearableBridgeFeatureSpec,
  resolveMurphAgeWearableBridgeMetricSourceHint,
  resolveMurphAgeWearableBridgeMetricSourceKind,
  resolveMurphAgeWearableShadowIncrementPolicy,
  summarizeMurphAgeArchitecture,
  summarizeMurphAgeOrdinaryLabWearableAggregateEvidence,
  summarizeMurphAgeCalculatorOutput,
  summarizeMurphAgeCalculatorPublicOutput,
  summarizeMurphAgePublicLabWearableShadowEvidenceStatus,
  summarizeMurphAgePublicWearableBridgeFromInputBundle,
  summarizeMurphAgeWearableParameterPackContract,
  summarizeMurphAgeWearableResidualLayerContract,
  summarizeMurphAgeWearableScoreBearingStrategy,
  summarizeMurphAgeWearableLabAggregateReceipt,
  toPublicMurphAgeCalculatorReport,
  toPublicMurphAgeDisplaySummary,
  validateMurphAgeLocalModelCardArtifactPolicy,
  validateMurphAgeIncrementEvaluationCard,
  validateMurphAgeRiskModel,
  validateMurphAgeFunctionResidualParameterPack,
  validateMurphAgeWearableLabAggregateReceipt,
  validateMurphAgeWearableResidualParameterPack,
  validateMurphAgeWearableShadowIncrementResultCard,
  type MurphAgeModelCardPolicy,
  type MurphAgeRiskModel,
  type MurphAgeSubmittedCalculatorInputBundleSpecId,
  type MurphAgeValidationEvidenceTier,
  type MurphAgeIncrementEvaluationCard,
  type MurphAgeFunctionResidualParameterPack,
  type MurphAgeWearableLabAggregateReceipt,
  type MurphAgeWearableResidualParameterPack,
  type MurphAgeWearableShadowIncrementResultCard,
} from "@murphai/health-metrics/murph-age";
import {
  MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_SCHEMA_VERSION,
  MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION,
  listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority,
  listMurphAgeOrdinaryLabWearableSourceRoutes,
  listMurphAgePrioritySourceRoutes,
  listMurphAgeSourceRoutes,
  listMurphAgeSourceRoutesByLayer,
  resolveMurphAgeSourceRoute,
  validateMurphAgeOrdinaryLabWearableAutoresearchSourcePriority,
  validateMurphAgeSourceRouteRegistry,
  type MurphAgeOrdinaryLabWearableAutoresearchSourcePriority,
  type MurphAgeSourceRoute,
} from "@murphai/health-metrics/murph-age-source-routes";

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

test("lists Murph Age source routes as metadata-only model strategy", () => {
  const routes = listMurphAgeSourceRoutes();
  assert.equal(validateMurphAgeSourceRouteRegistry().status, "valid");
  assert.deepEqual(validateMurphAgeSourceRouteRegistry().issues, []);
  assert.ok(routes.length >= 10);
  assert.equal(routes[0]?.routeId, "nhis-r399-outcome-anchor");
  assert.equal(routes[0]?.modelUseStatus, "frozen-research-anchor");
  assert.equal(routes[0]?.productAuthorized, false);

  const routeIds = new Set(routes.map((route) => route.routeId));
  assert.equal(routeIds.size, routes.length);
  for (const route of routes) {
    assert.equal(route.schemaVersion, MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION);
    assert.equal(route.productAuthorized, false);
    assert.equal(route.artifactBoundary.aggregateOutputsOnly, true);
    assert.equal(route.artifactBoundary.localPathStorageAllowed, false);
    assert.equal(route.artifactBoundary.modelParameterExportAllowed, false);
    assert.equal(route.artifactBoundary.participantLevelExportAllowed, false);
    assert.equal(route.artifactBoundary.predictionExportAllowed, false);
    assert.equal(route.artifactBoundary.productClaimAllowed, false);
    assert.equal(route.artifactBoundary.rowMaterializationAuthorized, false);
    assert.equal(route.artifactBoundary.rowValueExportAllowed, false);
    assert.equal(route.artifactBoundary.sourceTextStorageAllowed, false);
    assert.ok(
      ["not-ordinary-consumer", "older-adult-skewed", "partial-16-50", "primary-16-50"].includes(
        route.ordinarySubmitterFit.ageBandFit,
      ),
    );
    if (route.ordinarySubmitterFit.rank !== null) {
      assert.equal(Number.isInteger(route.ordinarySubmitterFit.rank), true);
      assert.ok(route.ordinarySubmitterFit.rank > 0);
    }
    assert.ok(route.allowedResearchUses.length >= 1);
    assert.ok(route.blockedCurrentUses.length >= 1);
  }

  const midus = resolveMurphAgeSourceRoute("midus-biomarker-mortality");
  assert.equal(midus?.activationStatus, "terms-activation-required");
  assert.equal(midus?.layers.includes("biomarker-increment"), true);
  assert.equal(midus?.featureFamilies.includes("labs"), true);
  assert.equal(resolveMurphAgeSourceRoute("unknown-route"), null);

  const cardia = resolveMurphAgeSourceRoute("cardia-biomarker-activity");
  assert.equal(cardia?.activationStatus, "terms-activation-required");
  assert.equal(cardia?.layers.includes("biomarker-increment"), true);
  assert.equal(cardia?.layers.includes("wearable-shadow-increment"), true);
  assert.equal(cardia?.layers.includes("transport-validation"), true);
  assert.equal(cardia?.featureFamilies.includes("activity"), true);
  assert.equal(cardia?.featureFamilies.includes("labs"), true);
  assert.equal(cardia?.ordinarySubmitterFit.ageBandFit, "primary-16-50");
  assert.equal(cardia?.ordinarySubmitterFit.inputFamilies.includes("bloodwork-labs"), true);
  assert.equal(cardia?.ordinarySubmitterFit.inputFamilies.includes("daily-activity"), true);
  assert.equal(cardia?.ordinarySubmitterFit.rank, 1);
  assert.equal(cardia?.productAuthorized, false);

  const hchsSol = resolveMurphAgeSourceRoute("hchs-sol-biomarker-activity");
  assert.equal(hchsSol?.activationStatus, "terms-activation-required");
  assert.equal(hchsSol?.layers.includes("biomarker-increment"), true);
  assert.equal(hchsSol?.layers.includes("wearable-shadow-increment"), true);
  assert.equal(hchsSol?.layers.includes("transport-validation"), true);
  assert.equal(hchsSol?.featureFamilies.includes("activity"), true);
  assert.equal(hchsSol?.featureFamilies.includes("labs"), true);
  assert.equal(hchsSol?.ordinarySubmitterFit.ageBandFit, "primary-16-50");
  assert.equal(hchsSol?.ordinarySubmitterFit.inputFamilies.includes("bloodwork-labs"), true);
  assert.equal(hchsSol?.ordinarySubmitterFit.inputFamilies.includes("daily-activity"), true);
  assert.equal(hchsSol?.ordinarySubmitterFit.rank, 2);
  assert.equal(hchsSol?.productAuthorized, false);

  const mipact = resolveMurphAgeSourceRoute("mipact-apple-watch-ehr");
  assert.equal(mipact?.accessMode, "partner-run");
  assert.equal(mipact?.activationStatus, "partner-required");
  assert.equal(mipact?.layers.includes("wearable-shadow-increment"), true);
  assert.equal(mipact?.featureFamilies.includes("autonomic"), true);
  assert.equal(mipact?.ordinarySubmitterFit.rank, 4);
  assert.equal(mipact?.productAuthorized, false);

  const nako = resolveMurphAgeSourceRoute("nako-accelerometer-biobank");
  assert.equal(nako?.accessMode, "controlled-institutional");
  assert.equal(nako?.activationStatus, "admin-required");
  assert.equal(nako?.layers.includes("biomarker-increment"), true);
  assert.equal(nako?.layers.includes("wearable-shadow-increment"), true);
  assert.equal(nako?.ordinarySubmitterFit.inputFamilies.includes("daily-activity"), true);
  assert.equal(nako?.productAuthorized, false);

  const whiOpach = resolveMurphAgeSourceRoute("whi-opach-womens-health-activity");
  assert.equal(whiOpach?.accessMode, "controlled-institutional");
  assert.equal(whiOpach?.activationStatus, "admin-required");
  assert.equal(whiOpach?.layers.includes("wearable-shadow-increment"), true);
  assert.equal(whiOpach?.ordinarySubmitterFit.ageBandFit, "older-adult-skewed");
  assert.equal(whiOpach?.ordinarySubmitterFit.rank, 13);
  assert.equal(whiOpach?.productAuthorized, false);

  const mhas = resolveMurphAgeSourceRoute("mhas-harmonized-aging");
  assert.equal(mhas?.modelUseStatus, "diagnostic-sidecar-candidate");
  assert.equal(mhas?.featureFamilies.includes("function"), true);
  assert.equal(mhas?.productAuthorized, false);
  assert.equal(
    mhas?.blockedCurrentUses.some((blockedUse) => blockedUse.includes("score-bearing product use")),
    true,
  );

  const nhefs = resolveMurphAgeSourceRoute("nhefs-public-lab-vitals-mortality");
  assert.equal(nhefs?.accessMode, "public-use");
  assert.equal(nhefs?.activationStatus, "metadata-candidate");
  assert.equal(nhefs?.layers.includes("biomarker-increment"), true);
  assert.equal(nhefs?.layers.includes("transport-validation"), true);
  assert.equal(nhefs?.featureFamilies.includes("labs"), true);
  assert.equal(nhefs?.featureFamilies.includes("blood-pressure"), true);
  assert.equal(nhefs?.outcomeSignal, "linked-mortality");
  assert.equal(nhefs?.productAuthorized, false);
  assert.equal(
    nhefs?.blockedCurrentUses.some((blockedUse) => blockedUse.includes("score-bearing product use")),
    true,
  );

  const wearableRoutes = listMurphAgeSourceRoutesByLayer("wearable-shadow-increment");
  assert.equal(wearableRoutes.some((route) => route.routeId === "nhanes-activity-shadow-lmf"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "cardia-biomarker-activity"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "hchs-sol-biomarker-activity"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "mipact-apple-watch-ehr"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nako-accelerometer-biobank"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "hunt-activity-sensor-biobank"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "lifelines-activelife-biobank"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "all-of-us-fitbit-labs-ehr"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "project-baseline-sensor-clinical"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "whi-opach-womens-health-activity"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nsrr-shhs-sleep-heart-health"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nsrr-hchs-sol-sleep-actigraphy"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nsrr-mros-sleep-aging"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nsrr-sof-sleep-aging"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nsrr-wsc-sleep-longitudinal"), true);
  assert.equal(wearableRoutes.some((route) => route.routeId === "nsrr-haassa-sleep-aging"), true);
  assert.equal(
    wearableRoutes.every((route) =>
      route.blockedCurrentUses.some((blockedUse) =>
        blockedUse.includes("score") || blockedUse.includes("product") || blockedUse.includes("background")
      )
    ),
    true,
  );

  const priorityRoutes = listMurphAgePrioritySourceRoutes();
  assert.equal(priorityRoutes.some((route) => route.activationStatus === "historical-reference"), false);
  assert.equal(priorityRoutes[0]?.routeId, "nhis-r399-outcome-anchor");
  assert.equal(priorityRoutes[1]?.routeId, "nhanes-activity-shadow-lmf");
  assert.equal(priorityRoutes[2]?.routeId, "cardia-biomarker-activity");
  assert.equal(priorityRoutes[3]?.routeId, "hchs-sol-biomarker-activity");
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "hchs-sol-biomarker-activity")
      > priorityRoutes.findIndex((route) => route.routeId === "cardia-biomarker-activity"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "all-of-us-fitbit-labs-ehr")
      > priorityRoutes.findIndex((route) => route.routeId === "hchs-sol-biomarker-activity"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nsrr-shhs-sleep-heart-health")
      > priorityRoutes.findIndex((route) => route.routeId === "nsrr-mesa-sleep-autonomic"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nsrr-hchs-sol-sleep-actigraphy")
      > priorityRoutes.findIndex((route) => route.routeId === "nsrr-shhs-sleep-heart-health"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nsrr-mros-sleep-aging")
      > priorityRoutes.findIndex((route) => route.routeId === "nsrr-hchs-sol-sleep-actigraphy"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nsrr-sof-sleep-aging")
      > priorityRoutes.findIndex((route) => route.routeId === "nsrr-mros-sleep-aging"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nsrr-wsc-sleep-longitudinal")
      > priorityRoutes.findIndex((route) => route.routeId === "nsrr-sof-sleep-aging"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nsrr-haassa-sleep-aging")
      > priorityRoutes.findIndex((route) => route.routeId === "nsrr-wsc-sleep-longitudinal"),
  );
  assert.ok(priorityRoutes.findIndex((route) => route.routeId === "mhas-harmonized-aging") > 0);
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "mhas-harmonized-aging")
      < priorityRoutes.findIndex((route) => route.routeId === "midus-biomarker-mortality"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nhefs-public-lab-vitals-mortality")
      > priorityRoutes.findIndex((route) => route.routeId === "haalsi-transport-stress"),
  );
  assert.ok(
    priorityRoutes.findIndex((route) => route.routeId === "nhefs-public-lab-vitals-mortality")
      < priorityRoutes.findIndex((route) => route.routeId === "who-sage-south-africa-transport"),
  );
  assert.equal(priorityRoutes.some((route) => route.routeId === "partner-aggregate-evaluator"), true);

  const ordinaryLabWearableRoutes = listMurphAgeOrdinaryLabWearableSourceRoutes();
  assert.deepEqual(ordinaryLabWearableRoutes.map((route) => route.routeId), [
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
    "nako-accelerometer-biobank",
    "hunt-activity-sensor-biobank",
    "lifelines-activelife-biobank",
    "nhanes-activity-shadow-lmf",
    "uk-biobank-integrated",
    "project-baseline-sensor-clinical",
    "framingham-activity-cvd",
    "nsrr-mesa-sleep-autonomic",
    "whi-opach-womens-health-activity",
  ]);
  assert.equal(
    ordinaryLabWearableRoutes.every((route) =>
      route.ordinarySubmitterFit.inputFamilies.includes("bloodwork-labs")
      && route.ordinarySubmitterFit.inputFamilies.some((family) =>
        family === "autonomic" || family === "daily-activity" || family === "sleep"
      )
      && route.productAuthorized === false
    ),
    true,
  );
  assert.equal(
    ordinaryLabWearableRoutes.some((route) => route.routeId === "partner-aggregate-evaluator"),
    false,
  );
  if (ordinaryLabWearableRoutes[0]) {
    ordinaryLabWearableRoutes[0].ordinarySubmitterFit.inputFamilies.push("sleep");
  }
  const freshCardia = resolveMurphAgeSourceRoute("cardia-biomarker-activity");
  assert.equal(freshCardia?.ordinarySubmitterFit.inputFamilies.includes("sleep"), false);

  const ordinaryAutoresearchPriority = listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority();
  assert.deepEqual(ordinaryAutoresearchPriority.map((route) => route.routeId), [
    "nhanes-activity-shadow-lmf",
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
    "framingham-activity-cvd",
    "uk-biobank-integrated",
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
    "nsrr-mesa-sleep-autonomic",
    "whi-opach-womens-health-activity",
    "nako-accelerometer-biobank",
    "hunt-activity-sensor-biobank",
    "lifelines-activelife-biobank",
  ]);
  assert.deepEqual(ordinaryAutoresearchPriority.map((route) => route.executionPriorityRank), [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
  ]);
  assert.equal(ordinaryAutoresearchPriority[0]?.ordinarySubmitterRank, 8);
  assert.equal(ordinaryAutoresearchPriority[0]?.executionMode, "public-locked-benchmark");
  assert.equal(ordinaryAutoresearchPriority[0]?.rankReasonIds.includes("fastest-public-row-path"), true);
  assert.equal(ordinaryAutoresearchPriority[1]?.routeId, "all-of-us-fitbit-labs-ehr");
  assert.equal(ordinaryAutoresearchPriority[1]?.ordinarySubmitterRank, 3);
  assert.equal(ordinaryAutoresearchPriority[1]?.executionMode, "human-admin-workbench");
  assert.equal(ordinaryAutoresearchPriority[2]?.routeId, "mipact-apple-watch-ehr");
  assert.equal(ordinaryAutoresearchPriority[2]?.rankReasonIds.includes("sensor-rich-clinical-fit"), true);
  assert.equal(ordinaryAutoresearchPriority[3]?.routeId, "framingham-activity-cvd");
  assert.equal(ordinaryAutoresearchPriority[3]?.rankReasonIds.includes("lab-activity-linked-outcome"), true);
  assert.equal(ordinaryAutoresearchPriority[5]?.routeId, "cardia-biomarker-activity");
  assert.equal(ordinaryAutoresearchPriority[5]?.executionMode, "free-registered-activation");
  assert.equal(ordinaryAutoresearchPriority[7]?.routeId, "nsrr-mesa-sleep-autonomic");
  assert.equal(ordinaryAutoresearchPriority[7]?.rankReasonIds.includes("sleep-autonomic-fit"), true);
  assert.equal(
    ordinaryAutoresearchPriority.every((route) =>
      route.schemaVersion === MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_SCHEMA_VERSION
      && route.productAuthorized === false
      && route.rowParsingAuthorized === false
      && route.sourceTextStorageAllowed === false
      && route.reviewGptEscalation === "only-after-source-boundary-change-or-real-aggregate-delta"
      && route.blockedUntil.length > 0
      && route.rankReasonIds.length > 0
      && route.inputFamilies.includes("bloodwork-labs")
      && route.inputFamilies.some((family) => family === "autonomic" || family === "daily-activity" || family === "sleep")
    ),
    true,
  );
  if (ordinaryAutoresearchPriority[0]) {
    ordinaryAutoresearchPriority[0].blockedUntil.push("mutated blocker");
    ordinaryAutoresearchPriority[0].inputFamilies.push("sleep");
    ordinaryAutoresearchPriority[0].rankReasonIds.push("partial-age-band-fit");
  }
  const freshOrdinaryAutoresearchPriority = listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority();
  assert.equal(freshOrdinaryAutoresearchPriority[0]?.blockedUntil.includes("mutated blocker"), false);
  assert.equal(freshOrdinaryAutoresearchPriority[0]?.inputFamilies.includes("sleep"), false);
  assert.equal(freshOrdinaryAutoresearchPriority[0]?.rankReasonIds.includes("partial-age-band-fit"), false);
  assert.equal(validateMurphAgeOrdinaryLabWearableAutoresearchSourcePriority().status, "valid");
  assert.deepEqual(validateMurphAgeOrdinaryLabWearableAutoresearchSourcePriority().issues, []);

  const invalidAutoresearchPriority: MurphAgeOrdinaryLabWearableAutoresearchSourcePriority[] =
    freshOrdinaryAutoresearchPriority.map((route) => ({
      ...route,
      blockedUntil: [...route.blockedUntil],
      inputFamilies: [...route.inputFamilies],
      rankReasonIds: [...route.rankReasonIds],
    }));
  if (invalidAutoresearchPriority[0]) {
    invalidAutoresearchPriority[0].blockedUntil = ["/tmp/murph-age-source-cache"];
    (invalidAutoresearchPriority[0] as { executionMode: string }).executionMode = "private-parser";
    invalidAutoresearchPriority[0].executionPriorityRank = 0;
    invalidAutoresearchPriority[0].inputFamilies = ["age-sex"];
    invalidAutoresearchPriority[0].nextAction = "Do not store review material from https://example.invalid.";
    invalidAutoresearchPriority[0].ordinarySubmitterRank = 0;
    (invalidAutoresearchPriority[0] as { productAuthorized: boolean }).productAuthorized = true;
    (invalidAutoresearchPriority[0] as { reviewGptEscalation: string }).reviewGptEscalation = "always";
    (invalidAutoresearchPriority[0] as { rowParsingAuthorized: boolean }).rowParsingAuthorized = true;
    (invalidAutoresearchPriority[0] as { sourceTextStorageAllowed: boolean }).sourceTextStorageAllowed = true;
  }
  if (invalidAutoresearchPriority[1]) {
    invalidAutoresearchPriority[1].executionPriorityRank = 3;
  }
  if (invalidAutoresearchPriority[4]) {
    (invalidAutoresearchPriority[4] as { schemaVersion: string }).schemaVersion =
      "murph.age.ordinary-lab-wearable-autoresearch-source-priority.v0";
    (invalidAutoresearchPriority[4] as { routeId: string }).routeId = "Not A Simple Route";
  }
  const invalidAutoresearchValidation =
    validateMurphAgeOrdinaryLabWearableAutoresearchSourcePriority(invalidAutoresearchPriority);
  assert.equal(invalidAutoresearchValidation.status, "invalid");
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "DUPLICATE_SOURCE_PRIORITY_RANK"), true);
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "INVALID_ROUTE_ID"), true);
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "INVALID_SCHEMA"), true);
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "INVALID_SOURCE_PRIORITY"), true);
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "INVALID_SUBMITTER_FIT"), true);
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "PROHIBITED_TEXT"), true);
  assert.equal(invalidAutoresearchValidation.issues.some((issue) => issue.code === "PRODUCT_AUTHORIZED"), true);

  if (midus) {
    (midus.layers as string[]).push("outcome-anchor");
    (midus.artifactBoundary as { rowValueExportAllowed: boolean }).rowValueExportAllowed = true;
  }
  const freshMidus = resolveMurphAgeSourceRoute("midus-biomarker-mortality");
  assert.equal(freshMidus?.layers.includes("outcome-anchor"), false);
  assert.equal(freshMidus?.artifactBoundary.rowValueExportAllowed, false);

  const invalidRoutes: MurphAgeSourceRoute[] = routes.map((route) => ({
    ...route,
    artifactBoundary: { ...route.artifactBoundary },
  }));
  if (invalidRoutes[0]) {
    (invalidRoutes[0].artifactBoundary as { rowValueExportAllowed: boolean }).rowValueExportAllowed = true;
    invalidRoutes[0].nextAction = "Do not store review material from https://example.invalid.";
  }
  if (invalidRoutes[1]) {
    invalidRoutes[1].sourceFamily = "/tmp/murph-age-source-cache";
  }
  if (invalidRoutes[2]) {
    invalidRoutes[2].allowedResearchUses = ["Codebook: full variable wording"];
  }
  if (invalidRoutes[3]) {
    (invalidRoutes[3] as { schemaVersion: string }).schemaVersion = "murph.age.source-route-registry.v0";
  }
  if (invalidRoutes[4]) {
    (invalidRoutes[4] as { routeId: string }).routeId = "Not A Simple Route";
  }
  if (invalidRoutes[5]) {
    invalidRoutes[5].priorityRank = 0;
  }
  if (invalidRoutes[6]) {
    (invalidRoutes[6] as { productAuthorized: boolean }).productAuthorized = true;
  }
  if (invalidRoutes[7]) {
    invalidRoutes[7].ordinarySubmitterFit = {
      ...invalidRoutes[7].ordinarySubmitterFit,
      rank: -1,
    };
  }
  if (invalidRoutes[7] && invalidRoutes[8]) {
    invalidRoutes[8].routeId = invalidRoutes[7].routeId;
  }
  const invalidValidation = validateMurphAgeSourceRouteRegistry(invalidRoutes);
  assert.equal(invalidValidation.status, "invalid");
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "DUPLICATE_ROUTE_ID"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "INVALID_BOUNDARY"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "INVALID_PRIORITY"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "INVALID_ROUTE_ID"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "INVALID_SCHEMA"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "INVALID_SUBMITTER_FIT"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "PROHIBITED_TEXT"), true);
  assert.equal(invalidValidation.issues.some((issue) => issue.code === "PRODUCT_AUTHORIZED"), true);
});

test("summarizes Murph Age architecture layers without product display authorization", () => {
  const summary = summarizeMurphAgeArchitecture();
  assert.equal(summary.schemaVersion, MURPH_AGE_ARCHITECTURE_SUMMARY_SCHEMA_VERSION);
  assert.deepEqual(summary.layerOrder, [
    "outcome-anchor",
    "clinical-lab-body",
    "function-cognition-context",
    "wearable-shadow",
    "source-validation",
    "product-display",
  ]);
  assert.equal(summary.productDisplayAuthorized, false);
  assert.equal(summary.productPromotionAuthorized, false);
  assert.equal(summary.riskToAgeDisplayAuthorized, false);
  assert.deepEqual(
    summary.publicLabWearableShadowEvidenceStatus,
    summarizeMurphAgePublicLabWearableShadowEvidenceStatus(),
  );
  assert.equal(
    summary.publicLabWearableShadowEvidenceStatus.schemaVersion,
    MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_STATUS_SCHEMA_VERSION,
  );
  assert.equal(summary.publicLabWearableShadowEvidenceStatus.wearableScoreBearingAuthorized, false);
  assert.equal(summary.publicLabWearableShadowEvidenceStatus.usableAsConsumerWearableValidation, false);
  assert.equal(summary.publicLabWearableShadowEvidenceStatus.reviewGptRequiredNow, false);
  assert.deepEqual(
    summary.wearableScoreBearingStrategy,
    summarizeMurphAgeWearableScoreBearingStrategy(),
  );
  assert.equal(summary.wearableScoreBearingStrategy.productWearableMultiplier, 0);
  assert.equal(summary.wearableScoreBearingStrategy.architecturePattern, "anchor-plus-wearable-residual-shadow");
  assert.equal(summary.wearableScoreBearingStrategy.researchResidualMode, "locked-evaluator-only");
  assert.equal(summary.wearableScoreBearingStrategy.deployableParameterizationRequiredForProductScoring, true);
  assert.equal(summary.sourceRouteIdsByPriority[0], "nhis-r399-outcome-anchor");
  assert.deepEqual(summary.ordinaryLabWearableSourceRouteIdsByPriority, [
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
    "nako-accelerometer-biobank",
    "hunt-activity-sensor-biobank",
    "lifelines-activelife-biobank",
    "nhanes-activity-shadow-lmf",
    "uk-biobank-integrated",
    "project-baseline-sensor-clinical",
    "framingham-activity-cvd",
    "nsrr-mesa-sleep-autonomic",
    "whi-opach-womens-health-activity",
  ]);
  assert.deepEqual(summary.ordinaryLabWearableAutoresearchSourceRouteIdsByExecutionPriority, [
    "nhanes-activity-shadow-lmf",
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
    "framingham-activity-cvd",
    "uk-biobank-integrated",
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
    "nsrr-mesa-sleep-autonomic",
    "whi-opach-womens-health-activity",
    "nako-accelerometer-biobank",
    "hunt-activity-sensor-biobank",
    "lifelines-activelife-biobank",
  ]);

  const layersById = new Map(summary.layers.map((layer) => [layer.layerId, layer]));
  const outcomeAnchor = layersById.get("outcome-anchor");
  assert.equal(outcomeAnchor?.mode, "score-bearing-research");
  assert.equal(outcomeAnchor?.scoreBearing, true);
  assert.equal(outcomeAnchor?.scoreContributionAuthorized, true);
  assert.equal(outcomeAnchor?.productAuthorized, false);
  assert.equal(outcomeAnchor?.riskToAgeDisplayAuthorized, false);
  assert.equal(outcomeAnchor?.modelCardIds.includes("r399_nhis_proxy_10y_acm_research"), true);
  assert.equal(outcomeAnchor?.sourceRouteIds.includes("nhis-r399-outcome-anchor"), true);
  assert.equal(outcomeAnchor?.scoreBearingMetricKeys.includes("self-rated-health"), true);

  const clinical = layersById.get("clinical-lab-body");
  assert.equal(clinical?.mode, "score-bearing-research");
  assert.equal(clinical?.scoreBearing, true);
  assert.equal(clinical?.modelCardIds.includes("lab9_bp_body_10y_acm_research"), true);
  assert.equal(clinical?.modelCardIds.includes("lab5_bp_bmi_transport_research"), true);
  assert.equal(clinical?.sourceRouteIds.includes("midus-biomarker-mortality"), true);
  assert.equal(clinical?.sourceRouteIds.includes("creles-transport-stress"), true);
  assert.equal(clinical?.sourceRouteIds.includes("nhefs-public-lab-vitals-mortality"), true);
  assert.equal(clinical?.sourceRouteIds.includes("cardia-biomarker-activity"), true);
  assert.equal(clinical?.sourceRouteIds.includes("hchs-sol-biomarker-activity"), true);
  assert.equal(clinical?.candidateMetricKeys.includes("hba1c"), true);
  assert.equal(clinical?.candidateMetricKeys.includes("egfr"), true);
  assert.equal(clinical?.candidateMetricKeys.includes("triglycerides"), true);

  const functionContext = layersById.get("function-cognition-context");
  assert.equal(functionContext?.mode, "context-only");
  assert.equal(functionContext?.scoreBearing, false);
  assert.equal(functionContext?.scoreContributionAuthorized, false);
  assert.equal(functionContext?.sourceRouteIds.includes("mhas-harmonized-aging"), true);
  assert.equal(functionContext?.sourceRouteIds.includes("nshap-integrated-aging"), true);
  assert.equal(functionContext?.contextMetricKeys.includes("adl-limitation-count"), true);

  const wearable = layersById.get("wearable-shadow");
  assert.equal(wearable?.mode, "shadow-only");
  assert.equal(wearable?.scoreBearing, false);
  assert.equal(wearable?.scoreContributionAuthorized, false);
  assert.equal(wearable?.sourceRouteIds.includes("nhanes-activity-shadow-lmf"), true);
  assert.equal(wearable?.sourceRouteIds.includes("cardia-biomarker-activity"), true);
  assert.equal(wearable?.sourceRouteIds.includes("hchs-sol-biomarker-activity"), true);
  assert.equal(wearable?.sourceRouteIds.includes("nsrr-shhs-sleep-heart-health"), true);
  assert.equal(wearable?.sourceRouteIds.includes("nsrr-hchs-sol-sleep-actigraphy"), true);
  assert.equal(wearable?.sourceRouteIds.includes("nsrr-mros-sleep-aging"), true);
  assert.equal(wearable?.sourceRouteIds.includes("nsrr-sof-sleep-aging"), true);
  assert.equal(wearable?.sourceRouteIds.includes("nsrr-wsc-sleep-longitudinal"), true);
  assert.equal(wearable?.sourceRouteIds.includes("nsrr-haassa-sleep-aging"), true);
  assert.equal(wearable?.sourceRouteIds.includes("all-of-us-fitbit-labs-ehr"), true);
  assert.equal(wearable?.shadowMetricKeys.includes("steps"), true);
  assert.equal(wearable?.shadowMetricKeys.includes("resting-heart-rate"), true);
  assert.equal(wearable?.shadowMetricKeys.includes("total-sleep-minutes"), true);

  const validation = layersById.get("source-validation");
  assert.equal(validation?.mode, "validation-only");
  assert.equal(validation?.scoreBearing, false);
  assert.equal(validation?.sourceRouteIds.includes("partner-aggregate-evaluator"), true);
  assert.equal(validation?.sourceRouteIds.includes("cardia-biomarker-activity"), true);
  assert.equal(validation?.sourceRouteIds.includes("hchs-sol-biomarker-activity"), true);
  assert.equal(validation?.sourceRouteIds.includes("nsrr-shhs-sleep-heart-health"), true);
  assert.equal(validation?.sourceRouteIds.includes("nsrr-hchs-sol-sleep-actigraphy"), true);
  assert.equal(validation?.sourceRouteIds.includes("nsrr-mros-sleep-aging"), true);
  assert.equal(validation?.sourceRouteIds.includes("nsrr-sof-sleep-aging"), true);
  assert.equal(validation?.sourceRouteIds.includes("nsrr-wsc-sleep-longitudinal"), true);
  assert.equal(validation?.sourceRouteIds.includes("nsrr-haassa-sleep-aging"), true);
  assert.equal(validation?.sourceRouteIds.includes("haalsi-transport-stress"), true);
  assert.equal(validation?.sourceRouteIds.includes("nhefs-public-lab-vitals-mortality"), true);
  assert.equal(validation?.sourceRouteIds.includes("who-sage-south-africa-transport"), true);

  const product = layersById.get("product-display");
  assert.equal(product?.mode, "blocked");
  assert.equal(product?.scoreBearing, false);
  assert.equal(product?.blockerCodes.includes("PRODUCT_POLICY_NOT_AUTHORIZED"), true);
  assert.equal(product?.blockerCodes.includes("RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED"), true);

  for (const layer of summary.layers) {
    assert.equal(layer.productAuthorized, false);
    assert.equal(layer.riskToAgeDisplayAuthorized, false);
  }

  const serialized = JSON.stringify(summary);
  for (const forbidden of [
    "selectedPointIds",
    "metric-point:",
    "\"value\"",
    "\"unit\"",
    "\"path\"",
    "coefficient",
    "contributionLogit",
    "prediction",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("summarizes public lab and wearable shadow evidence as mixed and non-score-bearing", () => {
  const status = summarizeMurphAgePublicLabWearableShadowEvidenceStatus();

  assert.equal(status.schemaVersion, MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_STATUS_SCHEMA_VERSION);
  assert.equal(status.inputPriority, "ordinary-16-50-labs-plus-multi-family-wearables");
  assert.equal(status.conclusion, "public_multi_family_wearable_shadow_signal_mixed_keep_context_only");
  assert.equal(status.nextAction, "run_external_or_partner_lab_wearable_aggregate_delta");
  assert.equal(status.externalConsumerLabWearableAggregateStillMissing, true);
  assert.equal(status.publicAggregateOnly, true);
  assert.equal(status.productDisplayAuthorized, false);
  assert.equal(status.wearableScoreBearingAuthorized, false);
  assert.equal(status.usableAsConsumerWearableValidation, false);
  assert.equal(status.reviewGptRequiredNow, false);
  assert.equal(status.reviewGptEscalation, "only-after-source-boundary-change-or-real-aggregate-delta");
  assert.deepEqual(status.includedPacketIds, [
    "r1065-nhanes-wrist-activity-shadow-loop",
    "r1066-nhanes-wrist-activity-robustness-loop",
    "r1067-nhanes-wrist-final-stress-test",
    "r1038-nhanes-modern-lab-activity-loop",
    "r1049-nhanes-activity-control-diagnostic",
  ]);
  assert.deepEqual(status.nextExternalOrPartnerRouteIdsByPriority, [
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
    "framingham-activity-cvd",
    "uk-biobank-integrated",
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
    "nsrr-mesa-sleep-autonomic",
    "whi-opach-womens-health-activity",
    "nako-accelerometer-biobank",
    "hunt-activity-sensor-biobank",
    "lifelines-activelife-biobank",
  ]);
  assert.deepEqual(status.sourceRouteIdsByEvidencePriority, [
    "nhanes-activity-shadow-lmf",
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
    "framingham-activity-cvd",
    "uk-biobank-integrated",
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
    "nsrr-mesa-sleep-autonomic",
    "whi-opach-womens-health-activity",
    "nako-accelerometer-biobank",
    "hunt-activity-sensor-biobank",
    "lifelines-activelife-biobank",
  ]);

  const packetsById = new Map(status.packets.map((packet) => [packet.packetId, packet]));
  assert.deepEqual(packetsById.get("r1065-nhanes-wrist-activity-shadow-loop")?.aggregateMetricDeltas, {
    auc: -0.00311477,
    brier: 0.00005335,
    calibrationSlope: 1.05308537,
    eOverO: 0.99957721,
    logLoss: 0.00039351,
  });
  assert.equal(packetsById.get("r1065-nhanes-wrist-activity-shadow-loop")?.negativeControlsBeaten, false);
  assert.equal(packetsById.get("r1066-nhanes-wrist-activity-robustness-loop")?.negativeControlsBeaten, false);
  assert.deepEqual(packetsById.get("r1067-nhanes-wrist-final-stress-test")?.aggregateMetricDeltas, {});
  assert.equal(
    packetsById.get("r1038-nhanes-modern-lab-activity-loop")?.aggregateMetricDeltas.eOverO,
    0.83820495,
  );
  assert.equal(
    packetsById.get("r1049-nhanes-activity-control-diagnostic")?.conclusion,
    "nhanes_activity_signal_control_clean_global_calibration_limited",
  );
  for (const packet of status.packets) {
    assert.equal(packet.productDisplayAuthorized, false);
    assert.equal(packet.wearableScoreBearingAuthorized, false);
    assert.equal(packet.usableAsConsumerWearableValidation, false);
  }

  const cloned = summarizeMurphAgePublicLabWearableShadowEvidenceStatus();
  cloned.packets[0]?.aggregateMetricDeltas && (cloned.packets[0].aggregateMetricDeltas.auc = 99);
  assert.equal(
    summarizeMurphAgePublicLabWearableShadowEvidenceStatus().packets[0]?.aggregateMetricDeltas.auc,
    -0.00311477,
  );

  const serialized = JSON.stringify(status);
  for (const forbidden of [
    "selectedPointIds",
    "metric-point:",
    "\"value\"",
    "\"unit\"",
    "\"path\"",
    "coefficient",
    "contributionLogit",
    "prediction",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
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

test("uses shared causal order before opaque ids and preserves the legacy fallback", () => {
  const common = {
    effectiveDate: "2026-08-13",
    metricKey: "steps",
    observedAt: "2026-08-13T12:00:00.000Z",
    recordedAt: "2026-08-13T18:00:00.000Z",
    sourceKind: "observation" as const,
    unit: "count",
  };
  const older = metricPoint({
    ...common,
    context: { causalSeq: "41" },
    id: "metric-point:opaque-a",
    recordId: "evt_older_report",
    value: 8_000,
  });
  const newer = metricPoint({
    ...common,
    context: { causalSeq: "42" },
    id: "metric-point:opaque-z",
    recordId: "evt_newer_report",
    value: 9_000,
  });

  assert.equal(selectMetricValue({ metricKey: "steps", points: [older, newer] }).value, 9_000);
  assert.equal(selectMetricValue({
    metricKey: "steps",
    points: [
      { ...older, context: {} },
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

test("keeps Murph Age feature attributions informative when displayed risk-age is clamped", () => {
  const result = calculateMurphAge({
    asOf: "2026-05-10T00:00:00.000Z",
    chronologicalAgeYears: 30,
    model: {
      endpoint: "10-year all-cause mortality",
      features: [
        { coefficient: 0.01, key: "age", kind: "chronological-age", label: "Age" },
        {
          coefficient: 0.2,
          expectedUnit: "mg/dL",
          key: "apob",
          kind: "metric",
          label: "ApoB",
          metricKey: "apob",
          moduleId: "biomarkers",
          transform: { kind: "z-score", mean: 90, standardDeviation: 20 },
        },
      ],
      horizonYears: 10,
      intercept: -6.5,
      modelId: "fixture-low-risk-attribution-model",
      referencePopulation: "fixture adult reference curve",
      referenceRiskCurve: fixtureReferenceRiskCurve(),
    },
    points: [
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
    ],
    sex: "male",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.biologicalAgeYears, 20);
  assert.equal(result.warnings.some((warning) => warning.code === "OUT_OF_REFERENCE_RANGE"), true);
  const apoBAttribution = result.featureAttributions.find((feature) => feature.featureKey === "apob");
  assert.ok(apoBAttribution);
  assert.ok(apoBAttribution.contributionYears !== null && apoBAttribution.contributionYears > 1);
  assert.equal(
    result.moduleAttributions.find((module) => module.moduleId === "biomarkers")?.contributionYears,
    apoBAttribution.contributionYears,
  );
});

test("assesses Murph Age research input bundles for current alpha, Lab5 fallback, and wearable context", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const currentAlpha = assessMurphAgeInputBundle({
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

  assert.equal(currentAlpha.status, "ready");
  assert.equal(currentAlpha.bundleId, "l1b-glycemia-body");
  assert.equal(currentAlpha.recommendedCardId, "l1b_glycemia_body_10y_acm_research");
  assert.deepEqual(currentAlpha.availableFeatureKeys.sort(), ["bmi", "glycemia"]);
  assert.equal(currentAlpha.selectedMetricKeys.includes("hba1c"), true);
  assert.equal(currentAlpha.selectedMetricKeys.includes("bmi"), true);
  assert.equal(currentAlpha.selectedMetricKeys.includes("systolic-blood-pressure"), false);

  const lab5 = assessMurphAgeInputBundle({
    asOf,
    points: [
      labMetricPoint("glucose", "mg/dL", 92),
      labMetricPoint("egfr", "mL/min/1.73m^2", 95),
      labMetricPoint("hdl-c", "mg/dL", 58),
      labMetricPoint("triglycerides", "mg/dL", 95),
      measurementMetricPoint("systolic-blood-pressure", "mmHg", 118),
      measurementMetricPoint("diastolic-blood-pressure", "mmHg", 72),
    ],
  });

  assert.equal(lab5.status, "ready");
  assert.equal(lab5.bundleId, "lab5-bp-bmi");
  assert.equal(lab5.recommendedCardId, "lab5_bp_bmi_transport_research");
  assert.deepEqual(lab5.availableFeatureKeys.sort(), [
    "creatinine",
    "diastolic-blood-pressure",
    "glycemia",
    "hdl-c",
    "systolic-blood-pressure",
    "triglycerides",
  ]);
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
  assert.equal(wearable.warnings.some((warning) => warning.message.includes("private research previews can apply residual packs")), true);

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
  assert.equal(keys.includes("adl-limitation-count"), true);
  assert.equal(keys.includes("iadl-limitation-count"), true);
  assert.equal(keys.includes("mobility-limitation-count"), true);
  assert.equal(keys.includes("frailty-symptom-count"), true);
  assert.equal(keys.includes("self-rated-health"), true);
  assert.equal(keys.includes("hypertension-history-proxy-yes"), true);
  assert.equal(keys.includes("diabetes-history-proxy-yes"), true);
  assert.equal(keys.includes("smoking-status-proxy"), true);
  assert.equal(keys.includes("physical-activity-proxy"), true);
  assert.equal(keys.includes("crp"), false);
  assert.equal(keys.includes("hs-crp"), false);
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("steps", "wearable-summary")),
    true,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("steps", "test-result")),
    false,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("hba1c", "test-result")),
    true,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("hba1c", "wearable-summary")),
    false,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("bmi", "measurement")),
    true,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("bmi", "sample-summary")),
    false,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("adl-limitation-count", "measurement")),
    true,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("adl-limitation-count", "test-result")),
    false,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("apob", "test-result")),
    false,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("self-rated-health", "survey-response")),
    true,
  );
  assert.equal(
    isMurphAgeInputBundleMetricPointAllowed(wearableMetricPoint("self-rated-health", "wearable-summary")),
    false,
  );
});

test("exposes submitted Murph Age input bundle specs for calculator integration", () => {
  const specs = listMurphAgeSubmittedCalculatorInputBundleSpecs();
  const byId = new Map(specs.map((spec) => [spec.bundleId, spec]));
  const registryKeys = new Set(listMurphAgeInputBundleMetricKeys());

  assert.deepEqual(specs.map((spec) => spec.bundleId), [
    "l1b-glycemia-body",
    "lab9-bp-body",
    "lab5-bp-bmi",
    "l1-glycemia",
    "r399-nhis-proxy-anchor",
    "wearable-context",
    "function-context",
  ]);
  assert.equal(
    specs.every((spec) => spec.schemaVersion === MURPH_AGE_SUBMITTED_CALCULATOR_INPUT_BUNDLE_SPEC_SCHEMA_VERSION),
    true,
  );
  assert.equal(specs.every((spec) => spec.productScoreBearingAuthorized === false), true);

  const l1b = assertDefined(byId.get("l1b-glycemia-body"), "l1b submitted input bundle spec");
  assert.equal(l1b.researchAgeEstimateEligible, true);
  assert.equal(l1b.scoreBearing, true);
  assert.equal(l1b.cardId, "l1b_glycemia_body_10y_acm_research");
  assert.equal(l1b.completion.rule, "glycemia-plus-body");
  assert.deepEqual(l1b.completion.requiredFeatureKeys, ["glycemia", "bmi"]);
  assert.equal(l1b.completion.alternativeFeatureKeyGroups.length, 0);
  assert.equal(l1b.featureSpecs.find((feature) => feature.featureKey === "glycemia")?.requiredForCompletion, true);
  assert.equal(l1b.featureSpecs.find((feature) => feature.featureKey === "bmi")?.requiredForCompletion, true);

  const lab9 = assertDefined(byId.get("lab9-bp-body"), "lab9 submitted input bundle spec");
  assert.equal(lab9.researchAgeEstimateEligible, true);
  assert.equal(lab9.scoreBearing, true);
  assert.equal(lab9.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(lab9.completion.rule, "all-required-features");
  assert.equal(lab9.completion.requiredFeatureKeys.includes("albumin"), true);
  assert.equal(lab9.completion.requiredFeatureKeys.includes("glycemia"), true);
  assert.equal(lab9.completion.requiredFeatureKeys.includes("systolic-blood-pressure"), true);
  assert.equal(lab9.completion.requiredFeatureKeys.includes("waist-circumference"), false);
  assert.equal(lab9.featureSpecs.find((feature) => feature.featureKey === "waist-circumference")?.requiredForCompletion, false);

  const lab5 = assertDefined(byId.get("lab5-bp-bmi"), "lab5 submitted input bundle spec");
  assert.equal(lab5.completion.rule, "all-lab5-features-plus-bmi-or-blood-pressure");
  assert.deepEqual(lab5.completion.requiredFeatureKeys.sort(), [
    "creatinine",
    "glycemia",
    "hdl-c",
    "triglycerides",
  ]);
  assert.deepEqual(lab5.completion.alternativeFeatureKeyGroups, [
    ["bmi"],
    ["systolic-blood-pressure", "diastolic-blood-pressure"],
  ]);
  assert.equal(lab5.featureSpecs.find((feature) => feature.featureKey === "bmi")?.requiredForCompletion, false);

  const l1Glycemia = assertDefined(byId.get("l1-glycemia"), "l1 glycemia submitted input bundle spec");
  assert.equal(l1Glycemia.completion.rule, "one-or-more-glycemia-features");
  assert.equal(l1Glycemia.completion.minReadyFeatureCount, 1);
  assert.deepEqual(l1Glycemia.completion.requiredFeatureKeys, ["glycemia"]);
  assert.equal(l1Glycemia.cardId, "l1_tiny_glycemia_10y_acm_research");
  assert.equal(l1Glycemia.researchAgeEstimateEligible, true);
  assert.equal(l1Glycemia.scoreBearing, true);

  const r399 = assertDefined(byId.get("r399-nhis-proxy-anchor"), "r399 submitted input bundle spec");
  assert.equal(r399.completion.rule, "one-or-more-proxy-features");
  assert.equal(r399.completion.minReadyFeatureCount, 1);
  assert.equal(r399.researchAgeEstimateEligible, true);
  assert.equal(r399.scoreBearing, true);

  const wearable = assertDefined(byId.get("wearable-context"), "wearable submitted input bundle spec");
  assert.equal(wearable.researchAgeEstimateEligible, false);
  assert.equal(wearable.scoreBearing, false);
  assert.equal(wearable.cardId, "wearable_context_no_risk");
  assert.equal(wearable.completion.rule, "one-or-more-context-features");
  assert.equal(wearable.featureSpecs.some((feature) => feature.featureKey === "resting-heart-rate"), true);
  assert.equal(wearable.featureSpecs.some((feature) => feature.featureKey === "sleep-efficiency"), true);
  assert.equal(wearable.featureSpecs.every((feature) => feature.requiredForCompletion === false), true);

  const functionContext = assertDefined(byId.get("function-context"), "function submitted input bundle spec");
  assert.equal(functionContext.scoreBearing, false);
  assert.equal(functionContext.featureSpecs.some((feature) => feature.featureKey === "frailty-symptoms"), true);

  for (const spec of specs) {
    for (const feature of spec.featureSpecs) {
      for (const metricKey of feature.metricKeys) {
        assert.equal(registryKeys.has(metricKey), true, `${metricKey} must be accepted by the submitted calculator`);
      }
    }
  }
});

test("keeps Murph Age card metrics reachable while wearable research signals stay non-score-bearing", () => {
  const bundleMetricKeys = new Set(listMurphAgeInputBundleMetricKeys());
  const bundleSpecsById = new Map(listMurphAgeSubmittedCalculatorInputBundleSpecs().map((spec) => [spec.bundleId, spec]));
  const submittedSpecMetricKeys = (bundleId: MurphAgeSubmittedCalculatorInputBundleSpecId): Set<string> =>
    new Set(assertDefined(bundleSpecsById.get(bundleId), `submitted bundle ${bundleId} must resolve`)
      .featureSpecs.flatMap((feature) => feature.metricKeys));
  const bundleMetricKeysById = new Map<string, Set<string>>([
    ["l1b-glycemia-body", submittedSpecMetricKeys("l1b-glycemia-body")],
    ["lab9-bp-body", submittedSpecMetricKeys("lab9-bp-body")],
    ["lab5-bp-bmi", submittedSpecMetricKeys("lab5-bp-bmi")],
    ["l1-glycemia", new Set(["hba1c", "glucose"])],
    ["r399-nhis-proxy-anchor", assessedR399ProxyAnchorMetricKeys()],
    ["function-context", assessedBundleMetricKeys("function-context", completeFunctionContextPoints())],
    ["wearable-context", bundleMetricKeys],
  ]);
  const bridgeSpecs = listMurphAgeWearableBridgeFeatureSpecs();
  const shadowPolicies = listMurphAgeWearableShadowIncrementPolicies();
  const wearableResearchMetricKeys = new Set([
    ...bridgeSpecs.flatMap((spec) => spec.metricKeys),
    ...bridgeSpecs.flatMap((spec) => spec.requiredQualityMetricKeys),
    ...shadowPolicies.flatMap((policy) => policy.allowedMetricKeys),
    ...shadowPolicies.flatMap((policy) => policy.signalMetricKeys),
    ...shadowPolicies.flatMap((policy) => policy.requiredQualityMetricKeys),
  ]);

  for (const policy of listMurphAgeModelCardPolicies()) {
    const acceptedBundleMetricKeys = new Set(policy.acceptedBundleIds.flatMap((bundleId) => [
      ...assertDefined(bundleMetricKeysById.get(bundleId), `bundle ${bundleId} must have invariant coverage`),
    ]));

    for (const metricKey of policy.scoreBearingMetricKeys) {
      assert.equal(
        bundleMetricKeys.has(metricKey),
        true,
        `${policy.cardId} score-bearing metric ${metricKey} must be in the input bundle registry`,
      );
      assert.equal(
        acceptedBundleMetricKeys.has(metricKey),
        true,
        `${policy.cardId} score-bearing metric ${metricKey} must be reachable through its accepted bundles`,
      );
      assert.equal(
        wearableResearchMetricKeys.has(metricKey),
        false,
        `${policy.cardId} must not score wearable research metric ${metricKey}`,
      );
    }

    assert.equal(policy.wearableScoreBearingAuthorized, false);
    assert.equal(policy.scoreBearingSourceKinds.includes("activity-summary"), false);
    assert.equal(policy.scoreBearingSourceKinds.includes("sleep-summary"), false);
    assert.equal(policy.scoreBearingSourceKinds.includes("wearable-summary"), false);
  }

  for (const spec of bridgeSpecs) {
    assert.equal(spec.scoreBearing, false);
    for (const metricKey of [...spec.metricKeys, ...spec.requiredQualityMetricKeys]) {
      assert.equal(
        bundleMetricKeys.has(metricKey),
        true,
        `wearable bridge metric ${metricKey} must be loadable through the input bundle registry`,
      );
    }
  }

  for (const policy of shadowPolicies) {
    assert.equal(policy.scoreBearing, false);
    for (const cardId of policy.compatibleAnchorCardIds) {
      assert.ok(resolveMurphAgeModelCardPolicy(cardId), `shadow increment anchor ${cardId} must resolve`);
    }
    for (const metricKey of [
      ...policy.allowedMetricKeys,
      ...policy.signalMetricKeys,
      ...policy.requiredQualityMetricKeys,
    ]) {
      assert.equal(
        bundleMetricKeys.has(metricKey),
        true,
        `wearable shadow metric ${metricKey} must be loadable through the input bundle registry`,
      );
    }
  }
});

test("requires explicit validation-gate evidence before product-authorizing Murph Age cards", () => {
  const policies = listMurphAgeModelCardPolicies();

  for (const policy of policies) {
    assert.equal(policy.validationGate.status, "blocked");
    assert.equal(policy.validationGate.productPromotionEvidence, false);
    assert.equal(isMurphAgeModelCardProductAuthorized(policy), false);
    assert.equal(isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy), false);
    assert.equal(listMurphAgeModelCardProductPromotionBlockers(policy).length > 0, true);
  }

  const lab9Policy = assertDefined(
    policies.find((policy) => policy.cardId === "lab9_bp_body_10y_acm_research"),
    "lab9 policy must resolve",
  );
  const rawProductFlagOnly: MurphAgeModelCardPolicy = {
    ...lab9Policy,
    productAuthorized: true,
    riskToAgeDisplayAuthorized: true,
    validationGate: {
      ...lab9Policy.validationGate,
      productPromotionEvidence: false,
      status: "blocked",
    },
  };
  assert.equal(isMurphAgeModelCardProductAuthorized(rawProductFlagOnly), false);
  assert.equal(isMurphAgeModelCardRiskToAgeDisplayAuthorized(rawProductFlagOnly), false);
  assert.deepEqual(listMurphAgeModelCardProductPromotionBlockers(rawProductFlagOnly), [
    "VALIDATION_GATE_BLOCKED",
    "PRODUCT_PROMOTION_EVIDENCE_MISSING",
    "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING",
  ]);

  const internalOnlyPassedPolicy: MurphAgeModelCardPolicy = {
    ...lab9Policy,
    productAuthorized: true,
    riskToAgeDisplayAuthorized: true,
    validationGate: {
      evidenceTiers: ["internal-anchor", "same-family-sanity"],
      productPromotionEvidence: true,
      status: "passed",
      summary: "Test-only internal evidence fixture.",
    },
  };
  assert.equal(hasMurphAgeProductPromotionEvidenceTier(internalOnlyPassedPolicy.validationGate), false);
  assert.equal(isMurphAgeModelCardProductAuthorized(internalOnlyPassedPolicy), false);
  assert.equal(isMurphAgeModelCardRiskToAgeDisplayAuthorized(internalOnlyPassedPolicy), false);

  const promotionTiers: MurphAgeValidationEvidenceTier[] = [
    "murph-native-prospective-validation",
    "partner-aggregate-validation",
    "true-external-validation",
  ];
  for (const evidenceTier of promotionTiers) {
    const productValidatedPolicy: MurphAgeModelCardPolicy = {
      ...lab9Policy,
      productAuthorized: true,
      riskToAgeDisplayAuthorized: true,
      validationGate: {
        evidenceTiers: [evidenceTier],
        productPromotionEvidence: true,
        status: "passed",
        summary: "Test-only product validation fixture.",
      },
    };
    assert.equal(hasMurphAgeProductPromotionEvidenceTier(productValidatedPolicy.validationGate), true);
    assert.equal(isMurphAgeModelCardProductAuthorized(productValidatedPolicy), true);
    assert.equal(isMurphAgeModelCardRiskToAgeDisplayAuthorized(productValidatedPolicy), true);
    assert.deepEqual(listMurphAgeModelCardProductPromotionBlockers(productValidatedPolicy), []);
  }

  const otherwisePromotionValidatedPolicies: MurphAgeModelCardPolicy[] = [
    {
      ...lab9Policy,
      productAuthorized: false,
      riskToAgeDisplayAuthorized: true,
      validationGate: {
        evidenceTiers: ["true-external-validation"],
        productPromotionEvidence: true,
        status: "passed",
        summary: "Test-only raw product authorization hold fixture.",
      },
    },
    {
      ...lab9Policy,
      productAuthorized: true,
      riskToAgeDisplayAuthorized: true,
      validationGate: {
        evidenceTiers: ["true-external-validation"],
        productPromotionEvidence: true,
        status: "blocked",
        summary: "Test-only blocked validation gate fixture.",
      },
    },
    {
      ...lab9Policy,
      productAuthorized: true,
      riskToAgeDisplayAuthorized: true,
      validationGate: {
        evidenceTiers: ["true-external-validation"],
        productPromotionEvidence: false,
        status: "passed",
        summary: "Test-only promotion evidence hold fixture.",
      },
    },
  ];
  for (const policy of otherwisePromotionValidatedPolicies) {
    assert.equal(hasMurphAgeProductPromotionEvidenceTier(policy.validationGate), true);
    assert.equal(isMurphAgeModelCardProductAuthorized(policy), false);
    assert.equal(isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy), false);
  }

  const riskToAgeHeldPolicy: MurphAgeModelCardPolicy = {
    ...lab9Policy,
    productAuthorized: true,
    riskToAgeDisplayAuthorized: false,
    validationGate: {
      evidenceTiers: ["true-external-validation"],
      productPromotionEvidence: true,
      status: "passed",
      summary: "Test-only risk-to-age held fixture.",
    },
  };
  assert.equal(isMurphAgeModelCardProductAuthorized(riskToAgeHeldPolicy), true);
  assert.equal(isMurphAgeModelCardRiskToAgeDisplayAuthorized(riskToAgeHeldPolicy), false);
  assert.deepEqual(listMurphAgeModelCardProductPromotionBlockers(riskToAgeHeldPolicy), [
    "RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED",
  ]);

  if (lab9Policy.validationGate) {
    (lab9Policy.validationGate.evidenceTiers as string[]).push("true-external-validation");
  }
  const freshLab9Policy = resolveMurphAgeModelCardPolicy("lab9_bp_body_10y_acm_research");
  assert.ok(freshLab9Policy, "fresh lab9 policy must resolve");
  assert.equal(freshLab9Policy.validationGate.evidenceTiers.includes("true-external-validation"), false);
});

test("exposes non-score-bearing wearable bridge feature specs for research routing", () => {
  const specs = listMurphAgeWearableBridgeFeatureSpecs();
  const featureKeys = specs.map((spec) => spec.featureKey);

  assert.equal(new Set(featureKeys).size, featureKeys.length);
  assert.deepEqual(featureKeys, [
    "wearable-coverage-quality",
    "activity-volume",
    "actigraphy-activity-counts",
    "activity-intensity-pattern",
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
    "actigraphy-activity-counts",
    "activity-intensity-pattern",
    "sedentary-time",
  ]);

  const activityVolume = resolveMurphAgeWearableBridgeFeatureSpec("activity-volume");
  assert.equal(activityVolume?.role, "shadow-increment-signal");
  assert.equal(activityVolume?.family, "activity");
  assert.equal(activityVolume?.measurementMethod, "consumer-device");
  assert.equal(activityVolume?.metricKeys.includes("steps"), true);
  assert.equal(activityVolume?.metricKeys.includes("mvpa-minutes"), true);
  assert.equal(activityVolume?.requiredQualityMetricKeys.includes("wearable-valid-day-count-28d"), true);
  assert.equal(activityVolume?.requiredQualityMetricKeys.includes("wearable-coverage-index"), true);

  const actigraphyCounts = resolveMurphAgeWearableBridgeFeatureSpec("actigraphy-activity-counts");
  assert.equal(actigraphyCounts?.role, "shadow-increment-signal");
  assert.equal(actigraphyCounts?.family, "activity");
  assert.equal(actigraphyCounts?.measurementMethod, "research-actigraphy");
  assert.deepEqual(actigraphyCounts?.metricKeys, ["activity-counts"]);

  const intensityPattern = resolveMurphAgeWearableBridgeFeatureSpec("activity-intensity-pattern");
  assert.equal(intensityPattern?.role, "shadow-increment-signal");
  assert.equal(intensityPattern?.family, "activity");
  assert.equal(intensityPattern?.measurementMethod, "consumer-device");
  assert.deepEqual(intensityPattern?.metricKeys, ["peak-30-minute-cadence"]);

  const sleep = resolveMurphAgeWearableBridgeFeatureSpec("sleep-duration-regularity");
  assert.equal(sleep?.unlockPriority, "second");
  assert.equal(sleep?.methodQualifier, "required");
  assert.equal(sleep?.sourceKinds.includes("sleep-summary"), true);
  assert.equal(sleep?.requiredQualityMetricKeys.includes("wearable-valid-night-count-28d"), true);

  const hrv = resolveMurphAgeWearableBridgeFeatureSpec("hrv-rmssd");
  assert.equal(hrv?.role, "deferred-context");
  assert.equal(hrv?.unlockPriority, "defer");
  assert.equal(hrv?.measurementMethod, "consumer-device");
  assert.equal(hrv?.methodQualifier, "required");

  const estimatedFitness = resolveMurphAgeWearableBridgeFeatureSpec("estimated-vo2-max");
  assert.equal(estimatedFitness?.measurementMethod, "estimated-fitness");

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

test("exposes one wearable bridge metric source and coverage contract", () => {
  assert.equal(MURPH_AGE_WEARABLE_COVERAGE_WINDOW_DAYS, 28);
  assert.equal(MURPH_AGE_WEARABLE_COVERAGE_MIN_VALID_DAYS, 14);

  const hints = listMurphAgeWearableBridgeMetricSourceHints();
  assert.equal(new Set(hints.map((hint) => hint.metricKey)).size, hints.length);
  assert.equal(resolveMurphAgeWearableBridgeMetricSourceKind("wearable_valid_day_count_28d"), "activity-summary");
  assert.equal(resolveMurphAgeWearableBridgeMetricSourceKind("wearable_valid_night_count_28d"), "sleep-summary");
  assert.equal(resolveMurphAgeWearableBridgeMetricSourceKind("wearable_coverage_index"), "wearable-summary");
  assert.equal(resolveMurphAgeWearableBridgeMetricSourceKind("activity_counts"), "activity-summary");
  assert.equal(resolveMurphAgeWearableBridgeMetricSourceKind("sleep_efficiency"), "sleep-summary");
  assert.equal(resolveMurphAgeWearableBridgeMetricSourceKind("hrv_rmssd"), "wearable-summary");

  const steps = resolveMurphAgeWearableBridgeMetricSourceHint("steps");
  assert.deepEqual(steps?.validObservationRoles, ["day"]);
  assert.equal(steps?.sourceKinds.includes("activity-summary"), true);
  assert.equal(steps?.sourceKinds.includes("wearable-summary"), true);
  assert.equal(steps?.featureKeys.includes("activity-volume"), true);
  assert.equal(steps?.featureKeys.includes("steps"), true);

  const totalSleep = resolveMurphAgeWearableBridgeMetricSourceHint("total_sleep_minutes");
  assert.deepEqual(totalSleep?.validObservationRoles, ["night"]);
  assert.equal(totalSleep?.sourceKinds.includes("sleep-summary"), true);
  assert.equal(totalSleep?.sourceKinds.includes("wearable-summary"), true);

  const dayQuality = resolveMurphAgeWearableBridgeMetricSourceHint("wearable-valid-day-count-28d");
  assert.equal(dayQuality?.qualityMetricRole, "day");
  assert.deepEqual(dayQuality?.validObservationRoles, []);

  const coverage = resolveMurphAgeWearableBridgeMetricSourceHint("wearable-coverage-index");
  assert.equal(coverage?.qualityMetricRole, "coverage");
  assert.equal(coverage?.defaultSourceKind, "wearable-summary");

  assert.equal(isMurphAgeWearableBridgeValidDayMetricPoint({ metricKey: "steps", sourceKind: "activity-summary" }), true);
  assert.equal(isMurphAgeWearableBridgeValidDayMetricPoint({ metricKey: "mvpa_minutes", sourceKind: "wearable-summary" }), true);
  assert.equal(isMurphAgeWearableBridgeValidDayMetricPoint({ metricKey: "resting-heart-rate", sourceKind: "wearable-summary" }), false);
  assert.equal(isMurphAgeWearableBridgeValidDayMetricPoint({ metricKey: "hrv-rmssd", sourceKind: "wearable-summary" }), false);
  assert.equal(isMurphAgeWearableBridgeValidNightMetricPoint({ metricKey: "total-sleep-minutes", sourceKind: "sleep-summary" }), true);
  assert.equal(isMurphAgeWearableBridgeValidNightMetricPoint({ metricKey: "sleep-score", sourceKind: "wearable-summary" }), true);
  assert.equal(isMurphAgeWearableBridgeValidNightMetricPoint({ metricKey: "respiratory-rate", sourceKind: "sleep-summary" }), true);
  assert.equal(isMurphAgeWearableBridgeValidNightMetricPoint({ metricKey: "hrv-rmssd", sourceKind: "sleep-summary" }), true);
  assert.equal(isMurphAgeWearableBridgeValidNightMetricPoint({ metricKey: "hrv-rmssd", sourceKind: "wearable-summary" }), false);

  if (steps) {
    steps.sourceKinds.push("sleep-summary");
    steps.validObservationRoles.push("night");
  }
  const freshSteps = resolveMurphAgeWearableBridgeMetricSourceHint("steps");
  assert.equal(freshSteps?.sourceKinds.includes("sleep-summary"), false);
  assert.deepEqual(freshSteps?.validObservationRoles, ["day"]);
});

test("keeps the wearable scoring strategy explicit while product contribution stays zero", () => {
  const strategy = summarizeMurphAgeWearableScoreBearingStrategy();
  assert.equal(strategy.schemaVersion, MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION);
  assert.equal(strategy.productStatus, "context-only");
  assert.equal(strategy.productWearableMultiplier, 0);
  assert.equal(strategy.aggregateReceiptOnlyAuthorizesScienceReview, true);
  assert.equal(strategy.deployableParameterizationRequiredForProductScoring, true);
  assert.equal(strategy.residualLayerContract.schemaVersion, MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION);
  assert.equal(strategy.residualLayerContract.layerId, "activity-residual-v1");
  assert.equal(strategy.residualLayerContract.family, "activity");
  assert.equal(strategy.residualLayerContract.combinationScale, "logit-residual");
  assert.equal(strategy.residualLayerContract.currentDeploymentStatus, "contract-only-no-validated-parameters");
  assert.equal(strategy.residualLayerContract.deployableParameterizationAvailable, false);
  assert.equal(strategy.residualLayerContract.researchMultiplier, 0);
  assert.equal(strategy.residualLayerContract.productMultiplier, 0);
  assert.equal(strategy.residualLayerContract.scoreBearing, false);
  assert.equal(strategy.residualLayerContract.scoreContributionAuthorized, false);
  assert.equal(
    strategy.residualLayerContract.parameterPackContract.schemaVersion,
    MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION,
  );
  assert.equal(strategy.residualLayerContract.parameterPackContract.requiredForResidualScoring, true);
  assert.equal(
    strategy.residualLayerContract.parameterPackContract.emptyPackBehavior,
    "exact-current-zero-delta-behavior",
  );
  assert.equal(strategy.residualLayerContract.parameterPackContract.familyPriorityOrder[0], "activity");
  assert.equal(strategy.residualLayerContract.parameterPackContract.requiredFields.includes("packHash"), true);
  assert.equal(strategy.residualLayerContract.parameterPackContract.requiredFields.includes("deploymentRights"), true);
  assert.equal(
    strategy.residualLayerContract.parameterPackContract.supportedDeploymentRights.includes("product-authorized"),
    true,
  );
  assert.equal(strategy.residualLayerContract.anchorCardIds[0], "l1b_glycemia_body_10y_acm_research");
  assert.equal(strategy.residualLayerContract.anchorCardIds.includes("l1b_glycemia_body_10y_acm_research"), true);
  assert.equal(strategy.residualLayerContract.anchorCardIds.includes("lab9_bp_body_10y_acm_research"), true);
  assert.equal(strategy.residualLayerContract.anchorCardIds.includes("lab5_bp_bmi_transport_research"), true);
  assert.equal(strategy.residualLayerContract.anchorCardIds.includes("l1_tiny_glycemia_10y_acm_research"), true);
  assert.deepEqual(strategy.residualLayerContract.anchorCardIds, listMurphAgeWearableShadowAnchorCardIds());
  assert.equal(isMurphAgeWearableShadowAnchorCardId("l1b_glycemia_body_10y_acm_research"), true);
  assert.equal(isMurphAgeWearableShadowAnchorCardId("lab9_bp_body_10y_acm_research"), true);
  assert.equal(isMurphAgeWearableShadowAnchorCardId("lab5_bp_bmi_transport_research"), true);
  assert.equal(isMurphAgeWearableShadowAnchorCardId("l1_tiny_glycemia_10y_acm_research"), true);
  assert.equal(isMurphAgeWearableShadowAnchorCardId("r399_nhis_proxy_10y_acm_research"), false);
  const anchorIds = listMurphAgeWearableShadowAnchorCardIds();
  anchorIds.push("r399_nhis_proxy_10y_acm_research");
  assert.equal(
    listMurphAgeWearableShadowAnchorCardIds().includes("r399_nhis_proxy_10y_acm_research"),
    false,
  );
  assert.deepEqual(strategy.residualLayerContract.featureSetContract.activityVolumeCandidateMetricKeys, [
    "steps",
    "activity-minutes",
    "mvpa-minutes",
    "peak-30-minute-cadence",
    "sedentary-minutes",
  ]);
  assert.equal(strategy.residualLayerContract.featureSetContract.coverageControlMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(strategy.residualLayerContract.featureSetContract.firstPassOnlyFamily, "activity");
  assert.equal(strategy.residualLayerContract.featureSetContract.methodQualifierRequired, true);
  assert.equal(strategy.residualLayerContract.featureSetContract.proprietaryDeviceScoresExcluded, true);
  assert.equal(strategy.residualLayerContract.qualityGateMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(strategy.residualLayerContract.qualityGateMetricKeys.includes("wearable-valid-day-count-28d"), true);
  assert.equal(strategy.residualLayerContract.signalMetricKeys.includes("steps"), true);
  assert.equal(strategy.residualLayerContract.signalMetricKeys.includes("sedentary-minutes"), true);
  assert.equal(strategy.residualLayerContract.deferredFamilyOrder[0], "resting-heart-rate");
  assert.equal(strategy.residualLayerContract.coverageScoringPolicy, "gate-and-control-only-not-age-contribution");
  assert.deepEqual(strategy.primaryDecisionComparisons, [
    "m5-vs-m1-lab-body",
    "m5-vs-m2-coverage-control",
  ]);
  for (const requiredSignal of [
    "m5-beats-m1-proper-score",
    "m5-beats-m2-coverage-control",
    "m5-calibration-passes",
    "negative-controls-pass",
    "reverse-causation-washout-passes",
    "replicates-in-two-source-families",
    "deployable-parameterization-authorized",
  ] as const) {
    assert.equal(strategy.requiredPromotionSignals.includes(requiredSignal), true, requiredSignal);
  }

  const policiesByFamily = new Map(strategy.familyPolicies.map((policy) => [policy.family, policy]));
  const quality = assertDefined(policiesByFamily.get("quality"), "quality strategy must resolve");
  assert.equal(quality.currentUse, "quality-gate-only");
  assert.equal(quality.researchMultiplier, 0);
  assert.equal(quality.minimumValidDays28d, 14);
  assert.equal(quality.minimumValidNights28d, 14);

  const activity = assertDefined(policiesByFamily.get("activity"), "activity strategy must resolve");
  assert.equal(activity.currentUse, "shadow-residual-research");
  assert.equal(activity.scoreBearingPromotionPriority, "first");
  assert.equal(activity.researchMultiplier, 1);
  assert.equal(activity.productMultiplier, 0);
  assert.equal(activity.signalMetricKeys.includes("steps"), true);

  const sleep = assertDefined(policiesByFamily.get("sleep"), "sleep strategy must resolve");
  assert.equal(sleep.scoreBearingPromotionPriority, "third");
  assert.equal(sleep.minimumValidNights28d, 14);
  assert.equal(sleep.requiresDeviceOrMethodQualification, true);

  const restingHeartRate = assertDefined(
    policiesByFamily.get("resting-heart-rate"),
    "resting heart rate strategy must resolve",
  );
  assert.equal(restingHeartRate.scoreBearingPromotionPriority, "second");
  assert.equal(restingHeartRate.minimumValidDays28d, 10);
  assert.equal(restingHeartRate.productMultiplier, 0);

  const hrv = assertDefined(policiesByFamily.get("hrv"), "HRV strategy must resolve");
  assert.equal(hrv.currentUse, "context-only");
  assert.equal(hrv.researchMultiplier, 0);
  assert.equal(hrv.scoreBearingPromotionPriority, "defer");

  strategy.familyPolicies[0]?.signalMetricKeys.push("mutated");
  strategy.residualLayerContract.signalMetricKeys.push("mutated");
  strategy.residualLayerContract.featureSetContract.activityVolumeCandidateMetricKeys.push("mutated");
  strategy.residualLayerContract.parameterPackContract.requiredFields.push("sourceRouteId");
  const freshStrategy = summarizeMurphAgeWearableScoreBearingStrategy();
  assert.equal(freshStrategy.familyPolicies[0]?.signalMetricKeys.includes("mutated"), false);
  assert.equal(freshStrategy.residualLayerContract.signalMetricKeys.includes("mutated"), false);
  assert.equal(
    freshStrategy.residualLayerContract.featureSetContract.activityVolumeCandidateMetricKeys.includes("mutated"),
    false,
  );
  assert.equal(
    freshStrategy.residualLayerContract.parameterPackContract.requiredFields.filter((field) =>
      field === "sourceRouteId"
    ).length,
    1,
  );
  assert.deepEqual(summarizeMurphAgeWearableResidualLayerContract(), freshStrategy.residualLayerContract);
  assert.deepEqual(
    summarizeMurphAgeWearableParameterPackContract(),
    freshStrategy.residualLayerContract.parameterPackContract,
  );
});

test("applies research-only wearable residual parameter packs without making wearables product score-bearing", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const points = [
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:steps:2026-05-08:pack:0",
      metricKey: "steps",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "pack_steps",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 10_000,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:activity-minutes:2026-05-08:pack:0",
      metricKey: "activity-minutes",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "pack_activity_minutes",
      sourceKind: "wearable-summary",
      unit: "minutes",
      value: 75,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-valid-days:2026-05-08:pack:0",
      metricKey: "wearable-valid-day-count-28d",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "pack_valid_days",
      sourceKind: "wearable-summary",
      unit: "count",
      value: 24,
    }),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:wearable-coverage:2026-05-08:pack:0",
      metricKey: "wearable-coverage-index",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "pack_coverage",
      sourceKind: "wearable-summary",
      unit: "score",
      value: 0.86,
    }),
  ];
  const assessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    asOf,
    points,
  });
  const pack = {
    anchorCardId: "lab9_bp_body_10y_acm_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "true-external-validation",
    family: "activity",
    featureWeights: [
      {
        center: 8_000,
        coefficient: -0.08,
        metricKey: "steps",
        scale: 2_000,
        transform: "center-scale",
      },
      {
        center: 45,
        coefficient: -0.02,
        metricKey: "activity-minutes",
        scale: 30,
        transform: "center-scale",
      },
    ],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId: "activity-residual-v1",
    packHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  } satisfies MurphAgeWearableResidualParameterPack;

  assert.deepEqual(validateMurphAgeWearableResidualParameterPack({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    parameterPack: pack,
  }), {
    status: "valid",
    warnings: [],
  });

  const application = applyMurphAgeWearableResidualLayer({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    anchorRiskProbability: 0.1,
    asOf,
    assessments,
    parameterPack: pack,
    points,
  });
  assert.equal(application.status, "research-parameterized-shadow-delta");
  assert.equal(application.parameterizationAvailable, true);
  assert.equal(application.parameterPackHash, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(application.residualDeltaLogit, -0.1);
  assert.equal(application.finalRiskProbability !== null && application.finalRiskProbability < 0.1, true);
  assert.equal(application.productAuthorized, false);
  assert.equal(application.scoreBearing, false);
  assert.equal(application.scoreContributionAuthorized, false);
  assert.equal(JSON.stringify(application).includes("10000"), false);

  const invalidPackValidation = validateMurphAgeWearableResidualParameterPack({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    parameterPack: {
      ...pack,
      deploymentRights: "not-authorized",
      featureWeights: [
        ...pack.featureWeights,
        {
          center: 60,
          coefficient: 0.05,
          metricKey: "resting-heart-rate",
          scale: 10,
          transform: "center-scale",
        },
      ],
      packHash: "/tmp/not-a-pack-hash",
      sourceRouteId: "midus-biomarker-mortality",
    },
  });
  assert.equal(invalidPackValidation.status, "invalid");
  assert.equal(
    invalidPackValidation.warnings.some((warning) => warning.message.includes("not authorized")),
    true,
  );
  assert.equal(
    invalidPackValidation.warnings.some((warning) => warning.message.includes("wearable shadow increment route")),
    true,
  );
  assert.equal(
    invalidPackValidation.warnings.some((warning) => warning.message.includes("signal metric")),
    true,
  );
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
    assert.equal(policy.compatibleAnchorCardIds.includes("l1_tiny_glycemia_10y_acm_research"), true);
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

test("validates aggregate wearable shadow result cards as blocked research evidence", () => {
  const resultCard = {
    anchorCardId: "lab9_bp_body_10y_acm_research",
    evaluation: {
      aggregateMetricDeltas: {
        brierDelta: -0.0012,
        logLossDelta: -0.0021,
      },
      aggregateSample: {
        evaluatedRowCount: 12_500,
        eventCount: 620,
        minimumCellCount: 25,
        suppressedCellCount: 0,
      },
      comparator: "anchor-vs-anchor-plus-wearable-shadow-increment",
      evidenceTier: "internal-diagnostic",
      sameDenominator: true,
    },
    family: "activity",
    outputBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
    },
    productAuthorized: false,
    riskEffect: "aggregate-estimated",
    schemaVersion: MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: "nhanes-activity-shadow-lmf",
  } satisfies MurphAgeWearableShadowIncrementResultCard;

  const validation = validateMurphAgeWearableShadowIncrementResultCard(resultCard);
  assert.equal(validation.status, "valid");
  assert.deepEqual(validation.warnings, []);
  for (const anchorCardId of [
    "lab9_bp_body_10y_acm_research",
    "lab5_bp_bmi_transport_research",
    "l1_tiny_glycemia_10y_acm_research",
  ]) {
    const anchorValidation = validateMurphAgeWearableShadowIncrementResultCard({
      ...resultCard,
      anchorCardId,
    });
    assert.equal(anchorValidation.status, "valid");
    assert.deepEqual(anchorValidation.warnings, []);
  }
  const r399AnchorValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    anchorCardId: "r399_nhis_proxy_10y_acm_research",
  });
  assert.equal(r399AnchorValidation.status, "invalid");
  assert.equal(
    r399AnchorValidation.warnings.some((warning) => warning.message.includes("not compatible")),
    true,
  );

  const notEstimatedValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    evaluation: {
      ...resultCard.evaluation,
      aggregateMetricDeltas: {},
    },
    riskEffect: "not-estimated",
  });
  assert.equal(notEstimatedValidation.status, "valid");

  const unknownRouteValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    sourceRouteId: "unknown-source-route",
  });
  assert.equal(unknownRouteValidation.status, "invalid");
  assert.equal(
    unknownRouteValidation.warnings.some((warning) => warning.message.includes("registered Murph Age source route")),
    true,
  );

  const nonWearableRouteValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    sourceRouteId: "midus-biomarker-mortality",
  });
  assert.equal(nonWearableRouteValidation.status, "invalid");
  assert.equal(
    nonWearableRouteValidation.warnings.some((warning) => warning.message.includes("wearable shadow increment route")),
    true,
  );

  const invalidValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    anchorCardId: "wearable_context_no_risk",
    evaluation: {
      aggregateMetricDeltas: {},
      comparator: "wearable-only-model",
      evidenceTier: "unsupported-tier",
      sameDenominator: false,
    },
    outputBoundary: {
      ...resultCard.outputBoundary,
      coefficientsExportAllowed: true,
      predictionsExportAllowed: true,
      productDisplayExportAllowed: true,
    },
    productAuthorized: true,
    scoreBearing: true,
    scoreContributionAuthorized: true,
    sourceRouteId: "Private Route",
  });
  assert.equal(invalidValidation.status, "invalid");
  assert.equal(invalidValidation.warnings.some((warning) => warning.code === "MODEL_CARD_POLICY_VIOLATION"), true);
  assert.equal(invalidValidation.warnings.some((warning) => warning.message.includes("non-score-bearing")), true);
  assert.equal(invalidValidation.warnings.some((warning) => warning.message.includes("aggregate-only")), true);
  assert.equal(
    invalidValidation.warnings.some((warning) =>
      warning.message.includes("at least one finite aggregate metric delta")
    ),
    true,
  );
  assert.equal(invalidValidation.warnings.some((warning) => warning.message.includes("same denominator")), true);
  assert.equal(invalidValidation.warnings.some((warning) => warning.message.includes("source route id")), true);

  const leakyResultCard = {
    ...resultCard,
    participantIds: ["synthetic-participant"],
    productClaimText: "synthetic claim",
    evaluation: {
      ...resultCard.evaluation,
      aggregateMetricDeltas: {
        ...resultCard.evaluation.aggregateMetricDeltas,
        coefficients: [0.1],
      },
      aggregateSample: {
        ...resultCard.evaluation.aggregateSample,
        rowValues: [1],
      },
      splitMembership: ["synthetic-split"],
    },
    outputBoundary: {
      ...resultCard.outputBoundary,
      predictions: [0.1],
    },
  };
  const leakyValidation = validateMurphAgeWearableShadowIncrementResultCard(leakyResultCard);
  assert.equal(leakyValidation.status, "invalid");
  for (const unsupportedField of [
    "participantIds",
    "productClaimText",
    "splitMembership",
    "coefficients",
    "rowValues",
    "predictions",
  ]) {
    assert.equal(
      leakyValidation.warnings.some((warning) =>
        warning.message.includes(`unsupported field ${unsupportedField}`)
      ),
      true,
    );
  }

  const malformedRootValidation = validateMurphAgeWearableShadowIncrementResultCard(null);
  assert.equal(malformedRootValidation.status, "invalid");
  assert.equal(
    malformedRootValidation.warnings.some((warning) =>
      warning.message.includes("must be an object")
    ),
    true,
  );

  const malformedNestedValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    evaluation: null,
    outputBoundary: "not-an-object",
  });
  assert.equal(malformedNestedValidation.status, "invalid");
  assert.equal(
    malformedNestedValidation.warnings.some((warning) =>
      warning.message.includes("evaluation must be an object")
    ),
    true,
  );
  assert.equal(
    malformedNestedValidation.warnings.some((warning) =>
      warning.message.includes("output boundary must be an object")
    ),
    true,
  );

  const malformedValueValidation = validateMurphAgeWearableShadowIncrementResultCard({
    ...resultCard,
    evaluation: {
      ...resultCard.evaluation,
      aggregateMetricDeltas: {
        brierDelta: -0.0012,
        logLossDelta: "bad-delta",
      },
      aggregateSample: {
        evaluatedRowCount: 12.5,
        eventCount: -1,
        minimumCellCount: Number.POSITIVE_INFINITY,
      },
    },
  });
  assert.equal(malformedValueValidation.status, "invalid");
  assert.equal(
    malformedValueValidation.warnings.some((warning) =>
      warning.message.includes("logLossDelta must be a finite number")
    ),
    true,
  );
  assert.equal(
    malformedValueValidation.warnings.some((warning) =>
      warning.message.includes("evaluatedRowCount must be a nonnegative integer")
    ),
    true,
  );
  assert.equal(
    malformedValueValidation.warnings.some((warning) =>
      warning.message.includes("eventCount must be a nonnegative integer")
    ),
    true,
  );
  assert.equal(
    malformedValueValidation.warnings.some((warning) =>
      warning.message.includes("minimumCellCount must be a nonnegative integer")
    ),
    true,
  );
});

test("validates aggregate increment evaluation cards across biomarker routes", () => {
  const evidenceCard = {
    anchorCardId: "r399_nhis_proxy_10y_acm_research",
    candidateBatchId: "r399-midus2-first-biomarker-increment-batch",
    candidateId: "r399-plus-lab3-bmi-increment",
    evaluation: {
      aggregateMetricDeltas: {
        aucDelta: 0.0018,
        brierDelta: -0.0002,
        logLossDelta: -0.0001,
      },
      aggregateSample: {
        evaluatedRowCount: 217,
        eventCount: 17,
        minimumCellCount: 17,
        suppressedCellCount: 0,
      },
      anchorMetrics: {
        auc: 0.7644,
        brier: 0.0627,
        events: 17,
        logLoss: 0.2323,
        meanPrediction: 0.0714,
        n: 217,
        observedRate: 0.0783,
      },
      candidateMetrics: {
        auc: 0.7662,
        brier: 0.0625,
        events: 17,
        logLoss: 0.2322,
        meanPrediction: 0.0718,
        n: 217,
        observedRate: 0.0783,
      },
      comparator: "anchor-vs-anchor-plus-increment",
      evidenceTier: "internal-diagnostic",
      sameDenominator: true,
    },
    flatteningAuthorized: false,
    layer: "biomarker-increment",
    outputBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      localArtifactPathExportAllowed: false,
      modelParametersExportAllowed: false,
      participantIdentifiersExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
      sourceTextExportAllowed: false,
      splitMembershipExportAllowed: false,
    },
    productAuthorized: false,
    riskEffect: "aggregate-estimated",
    schemaVersion: MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: "midus-biomarker-mortality",
  } satisfies MurphAgeIncrementEvaluationCard;

  const validation = validateMurphAgeIncrementEvaluationCard(evidenceCard);
  assert.equal(validation.status, "valid");
  assert.deepEqual(validation.warnings, []);

  const ordinaryRoutes = listMurphAgeOrdinaryLabWearableSourceRoutes().slice(0, 2);
  assert.deepEqual(ordinaryRoutes.map((route) => route.routeId), [
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
  ]);
  for (const route of ordinaryRoutes) {
    for (const layer of ["biomarker-increment", "wearable-shadow-increment"] as const) {
      const builtCard = buildMurphAgeIncrementEvaluationCard({
        aggregateMetricDeltas: {
          aucDelta: 0.001,
          brierDelta: -0.0001,
        },
        aggregateSample: {
          evaluatedRowCount: 240,
          eventCount: 24,
          minimumCellCount: 24,
          suppressedCellCount: 0,
        },
        anchorCardId: "r399_nhis_proxy_10y_acm_research",
        candidateBatchId: "ordinary-lab-wearable-aggregate-v1",
        candidateId: `${route.routeId}-${layer}`,
        evidenceTier: "external-validation",
        layer,
        riskEffect: "aggregate-estimated",
        sourceRouteId: route.routeId,
      });
      assert.equal(builtCard.productAuthorized, false);
      assert.equal(builtCard.scoreBearing, false);
      assert.equal(builtCard.scoreContributionAuthorized, false);
      assert.equal(builtCard.flatteningAuthorized, false);
      assert.equal(builtCard.outputBoundary.aggregateOnly, true);
      assert.equal(builtCard.outputBoundary.rowValuesExportAllowed, false);
      assert.equal(builtCard.outputBoundary.predictionsExportAllowed, false);
      assert.equal(builtCard.outputBoundary.coefficientsExportAllowed, false);
      assert.equal(builtCard.outputBoundary.modelParametersExportAllowed, false);
      assert.equal(validateMurphAgeIncrementEvaluationCard(builtCard).status, "valid");
      const ordinaryEvidenceAssessment = assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard(builtCard);
      assert.equal(ordinaryEvidenceAssessment.status, "ready");
      assert.deepEqual(ordinaryEvidenceAssessment.blockers, []);
    }
  }
  const readyOrdinaryCard = buildMurphAgeIncrementEvaluationCard({
    aggregateMetricDeltas: { aucDelta: 0.001 },
    aggregateSample: {
      evaluatedRowCount: 240,
      eventCount: 24,
      minimumCellCount: 24,
    },
    anchorCardId: "r399_nhis_proxy_10y_acm_research",
    candidateBatchId: "ordinary-lab-wearable-aggregate-v1",
    candidateId: "cardia-biomarker-activity-biomarker-increment",
    evidenceTier: "external-validation",
    layer: "biomarker-increment",
    riskEffect: "aggregate-estimated",
    sourceRouteId: "cardia-biomarker-activity",
  });
  const blockedOrdinaryCard = {
    ...readyOrdinaryCard,
    evaluation: {
      ...readyOrdinaryCard.evaluation,
      aggregateMetricDeltas: {},
      aggregateSample: {
        evaluatedRowCount: 12,
        minimumCellCount: 12,
      },
    },
    riskEffect: "not-estimated",
    sourceRouteId: "midus-biomarker-mortality",
  };
  const blockedOrdinaryAssessment = assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard(blockedOrdinaryCard);
  assert.equal(blockedOrdinaryAssessment.status, "blocked");
  for (const expectedBlocker of [
    "source_route_not_ordinary_lab_wearable",
    "risk_effect_not_aggregate_estimated",
    "aggregate_metric_delta_missing",
    "event_count_missing",
  ]) {
    assert.equal(blockedOrdinaryAssessment.blockers.includes(expectedBlocker), true, expectedBlocker);
  }
  const readyHchsCard = buildMurphAgeIncrementEvaluationCard({
    aggregateMetricDeltas: { brierDelta: -0.0002 },
    aggregateSample: {
      evaluatedRowCount: 320,
      eventCount: 32,
      minimumCellCount: 16,
    },
    anchorCardId: "r399_nhis_proxy_10y_acm_research",
    candidateBatchId: "ordinary-lab-wearable-aggregate-v1",
    candidateId: "hchs-sol-biomarker-activity-wearable-shadow-increment",
    evidenceTier: "external-validation",
    layer: "wearable-shadow-increment",
    riskEffect: "aggregate-estimated",
    sourceRouteId: "hchs-sol-biomarker-activity",
  });
  const evidenceSummary = summarizeMurphAgeOrdinaryLabWearableAggregateEvidence([
    blockedOrdinaryCard,
    readyHchsCard,
    readyOrdinaryCard,
  ]);
  assert.equal(evidenceSummary.status, "ready");
  assert.equal(evidenceSummary.readyCardCount, 2);
  assert.deepEqual(evidenceSummary.readySourceRouteIds, [
    "cardia-biomarker-activity",
    "hchs-sol-biomarker-activity",
  ]);
  assert.deepEqual(evidenceSummary.missingSourceRouteIds.slice(0, 2), [
    "all-of-us-fitbit-labs-ehr",
    "mipact-apple-watch-ehr",
  ]);
  const emptyEvidenceSummary = summarizeMurphAgeOrdinaryLabWearableAggregateEvidence([]);
  assert.equal(emptyEvidenceSummary.status, "blocked");
  assert.equal(emptyEvidenceSummary.readyCardCount, 0);
  assert.equal(emptyEvidenceSummary.readySourceRouteIds.length, 0);
  assert.equal(emptyEvidenceSummary.missingSourceRouteIds[0], "cardia-biomarker-activity");

  const templates = listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates();
  assert.deepEqual(templates.slice(0, 4).map((template) => template.candidateId), [
    "cardia-biomarker-activity-biomarker-increment",
    "cardia-biomarker-activity-wearable-shadow-increment",
    "hchs-sol-biomarker-activity-biomarker-increment",
    "hchs-sol-biomarker-activity-wearable-shadow-increment",
  ]);
  const firstTemplate = templates[0];
  assert.ok(firstTemplate);
  assert.equal(firstTemplate.riskEffect, "aggregate-estimated");
  assert.equal(firstTemplate.productAuthorized, false);
  assert.equal(firstTemplate.scoreBearing, false);
  assert.equal(firstTemplate.scoreContributionAuthorized, false);
  assert.deepEqual(firstTemplate.requiredAggregateSampleFields, [
    "evaluatedRowCount",
    "eventCount",
    "minimumCellCount",
  ]);
  assert.equal(firstTemplate.acceptedAggregateMetricDeltaFields.includes("aucDelta"), true);
  assert.equal(firstTemplate.acceptedAggregateMetricDeltaFields.includes("logLossDelta"), true);
  assert.deepEqual(firstTemplate.outputBoundary, {
    aggregateOnly: true,
    coefficientsExportAllowed: false,
    localArtifactPathExportAllowed: false,
    modelParametersExportAllowed: false,
    participantIdentifiersExportAllowed: false,
    participantLevelExportAllowed: false,
    predictionsExportAllowed: false,
    productDisplayExportAllowed: false,
    rowValuesExportAllowed: false,
    sourceTextExportAllowed: false,
    splitMembershipExportAllowed: false,
  });
  const filteredTemplates = listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates({
    layers: ["wearable-shadow-increment"],
    sourceRouteIds: ["cardia-biomarker-activity"],
  });
  assert.deepEqual(filteredTemplates.map((template) => template.candidateId), [
    "cardia-biomarker-activity-wearable-shadow-increment",
  ]);
  assert.throws(
    () =>
      listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates({
        candidateBatchId: "/private/source/run-1.csv",
      }),
    /candidate batch id must be a non-empty simple key/u,
  );

  const notEstimatedValidation = validateMurphAgeIncrementEvaluationCard({
    ...evidenceCard,
    evaluation: {
      ...evidenceCard.evaluation,
      aggregateMetricDeltas: {},
    },
    riskEffect: "not-estimated",
  });
  assert.equal(notEstimatedValidation.status, "valid");

  const invalidRouteValidation = validateMurphAgeIncrementEvaluationCard({
    ...evidenceCard,
    layer: "wearable-shadow-increment",
  });
  assert.equal(invalidRouteValidation.status, "invalid");
  assert.equal(
    invalidRouteValidation.warnings.some((warning) => warning.message.includes("requested increment layer")),
    true,
  );

  const invalidValidation = validateMurphAgeIncrementEvaluationCard({
    ...evidenceCard,
    anchorCardId: "wearable_context_no_risk",
    candidateBatchId: "bad batch",
    candidateId: "bad candidate",
    evaluation: {
      aggregateMetricDeltas: {},
      aggregateSample: {
        evaluatedRowCount: 12.5,
      },
      anchorMetrics: {
        auc: "bad-auc",
      },
      candidateMetrics: {
        logLoss: Number.POSITIVE_INFINITY,
      },
      comparator: "candidate-only",
      evidenceTier: "unsupported-tier",
      sameDenominator: false,
    },
    flatteningAuthorized: true,
    layer: "unsupported-layer",
    outputBoundary: {
      ...evidenceCard.outputBoundary,
      coefficientsExportAllowed: true,
      localArtifactPathExportAllowed: true,
      modelParametersExportAllowed: true,
      participantIdentifiersExportAllowed: true,
      predictionsExportAllowed: true,
      productDisplayExportAllowed: true,
      rowValuesExportAllowed: true,
      sourceTextExportAllowed: true,
      splitMembershipExportAllowed: true,
    },
    productAuthorized: true,
    scoreBearing: true,
    scoreContributionAuthorized: true,
    sourceRouteId: "Private Route",
  });
  assert.equal(invalidValidation.status, "invalid");
  for (const expected of [
    "score-bearing Murph Age model card",
    "candidate batch id",
    "candidate id",
    "layer is not supported",
    "non-score-bearing",
    "aggregate-only",
    "at least one finite aggregate metric delta",
    "same denominator",
    "source route id",
  ]) {
    assert.equal(
      invalidValidation.warnings.some((warning) => warning.message.includes(expected)),
      true,
      expected,
    );
  }

  const leakyValidation = validateMurphAgeIncrementEvaluationCard({
    ...evidenceCard,
    participantIds: ["synthetic-participant"],
    productClaimText: "synthetic claim",
    evaluation: {
      ...evidenceCard.evaluation,
      aggregateMetricDeltas: {
        ...evidenceCard.evaluation.aggregateMetricDeltas,
        coefficients: [0.1],
      },
      aggregateSample: {
        ...evidenceCard.evaluation.aggregateSample,
        rowValues: [1],
      },
      anchorMetrics: {
        ...evidenceCard.evaluation.anchorMetrics,
        predictionById: { synthetic: 0.1 },
      },
      splitMembership: ["synthetic-split"],
    },
    outputBoundary: {
      ...evidenceCard.outputBoundary,
      localPath: "/tmp/synthetic",
    },
  });
  assert.equal(leakyValidation.status, "invalid");
  for (const unsupportedField of [
    "participantIds",
    "productClaimText",
    "splitMembership",
    "coefficients",
    "rowValues",
    "predictionById",
    "localPath",
  ]) {
    assert.equal(
      leakyValidation.warnings.some((warning) =>
        warning.message.includes(`unsupported field ${unsupportedField}`)
      ),
      true,
      unsupportedField,
    );
  }
});

test("evaluates M0-M5 wearable/lab aggregate receipts without unlocking product scoring", () => {
  assert.deepEqual([...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS], [
    "m0-anchor-only",
    "m1-anchor-plus-lab-body-bp",
    "m2-coverage-device-ehr-density-control",
    "m3-wearable-residual",
    "m4-wearable-plus-coverage",
    "m5-residualized-wearable-after-controls",
  ]);

  const receipt = {
    artifactBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      localArtifactPathExportAllowed: false,
      modelParametersExportAllowed: false,
      participantIdentifiersExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
      sourceTextExportAllowed: false,
      splitMembershipExportAllowed: false,
    },
    denominator: {
      evaluatedRowCount: 18_200,
      eventCount: 140,
      minimumCellCount: 25,
      personYears: 142_000,
      suppressedCellCount: 0,
    },
    endpoint: {
      endpointFamily: "all-cause-mortality",
      endpointFrozenBeforeScoring: true,
      horizonYears: 10,
      indexDateRule: "feature-window-end-before-risk-window",
      outcomeAscertainment: "death-registry",
      outcomeLinked: true,
      washoutDays: 365,
    },
    evaluatorFrozenBeforeExecution: true,
    evidenceTier: "partner-aggregate",
    models: [
      {
        calibrationStatus: "pass",
        metrics: { auc: 0.7, brier: 0.082, calibrationIntercept: 0.01, calibrationSlope: 1.01, logLoss: 0.31 },
        modelId: "m0-anchor-only",
      },
      {
        calibrationStatus: "pass",
        metrics: { auc: 0.75, brier: 0.064, calibrationIntercept: 0.005, calibrationSlope: 0.99, logLoss: 0.23 },
        modelId: "m1-anchor-plus-lab-body-bp",
      },
      {
        calibrationStatus: "pass",
        metrics: { auc: 0.752, brier: 0.0638, calibrationIntercept: 0.006, calibrationSlope: 0.98, logLoss: 0.229 },
        modelId: "m2-coverage-device-ehr-density-control",
      },
      {
        calibrationStatus: "pass",
        metrics: { auc: 0.755, brier: 0.063, calibrationIntercept: 0.004, calibrationSlope: 0.99, logLoss: 0.226 },
        modelId: "m3-wearable-residual",
      },
      {
        calibrationStatus: "pass",
        metrics: { auc: 0.758, brier: 0.0628, calibrationIntercept: 0.004, calibrationSlope: 0.99, logLoss: 0.225 },
        modelId: "m4-wearable-plus-coverage",
      },
      {
        calibrationStatus: "pass",
        metrics: { auc: 0.763, brier: 0.062, calibrationIntercept: 0.003, calibrationSlope: 1.0, logLoss: 0.222 },
        modelId: "m5-residualized-wearable-after-controls",
      },
    ],
    negativeControls: {
      coverageOnlyBeatenByResidualWearable: true,
      deviceOrEhrDensityDominates: false,
      earlyEventSensitivityPassed: true,
      reverseCausationWashoutPassed: true,
    },
    productAuthorized: false,
    receiptId: "all-of-us-m0-m5-wearable-lab-aggregate-v0",
    sameDenominator: true,
    schemaVersion: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  } satisfies MurphAgeWearableLabAggregateReceipt;

  const validation = validateMurphAgeWearableLabAggregateReceipt(receipt);
  assert.equal(validation.status, "valid");
  assert.deepEqual(validation.warnings, []);

  const summary = summarizeMurphAgeWearableLabAggregateReceipt(receipt);
  assert.equal(summary.conclusion, "reviewgpt-science-delta");
  assert.equal(summary.reviewGptRequired, true);
  assert.equal(summary.productAuthorized, false);
  assert.equal(summary.scoreBearingPromotionAuthorized, false);
  assert.equal(summary.wearableScoreBearingAuthorized, false);
  assert.equal(summary.denominator.eventCount, 140);
  assert.deepEqual(summary.modelIdsPresent, [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS]);
  assert.ok(summary.m1ToM5Deltas);
  assert.ok(summary.m2ToM5Deltas);
  assert.ok(summary.m1ToM5Deltas.logLossDelta !== null && summary.m1ToM5Deltas.logLossDelta < 0);
  assert.ok(summary.m2ToM5Deltas.brierDelta !== null && summary.m2ToM5Deltas.brierDelta < 0);
  const convertedEvidenceCard = buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt(receipt);
  assert.ok(convertedEvidenceCard);
  assert.equal(convertedEvidenceCard.sourceRouteId, "all-of-us-fitbit-labs-ehr");
  assert.equal(convertedEvidenceCard.layer, "wearable-shadow-increment");
  assert.equal(convertedEvidenceCard.candidateBatchId, "ordinary-lab-wearable-aggregate-v1");
  assert.equal(convertedEvidenceCard.candidateId, "all-of-us-fitbit-labs-ehr-wearable-shadow-increment");
  assert.equal(convertedEvidenceCard.anchorCardId, "r399_nhis_proxy_10y_acm_research");
  assert.equal(convertedEvidenceCard.productAuthorized, false);
  assert.equal(convertedEvidenceCard.scoreBearing, false);
  assert.equal(convertedEvidenceCard.scoreContributionAuthorized, false);
  assert.equal(convertedEvidenceCard.outputBoundary.coefficientsExportAllowed, false);
  assert.equal(convertedEvidenceCard.outputBoundary.modelParametersExportAllowed, false);
  assert.equal(convertedEvidenceCard.evaluation.aggregateSample?.eventCount, 140);
  assert.ok(
    convertedEvidenceCard.evaluation.aggregateMetricDeltas.logLossDelta !== undefined
      && Math.abs(convertedEvidenceCard.evaluation.aggregateMetricDeltas.logLossDelta + 0.008) < 1e-12,
  );
  assert.equal(validateMurphAgeIncrementEvaluationCard(convertedEvidenceCard).status, "valid");
  assert.equal(
    assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard(convertedEvidenceCard).status,
    "ready",
  );
  assert.equal(JSON.stringify(convertedEvidenceCard).includes("\"coefficients\":"), false);

  const aliasedWorkbenchReceipt = {
    ...receipt,
    receiptId: "all-of-us-workbench-alias-m0-m5-v0",
    sourceRouteId: "all_of_us_workbench_aggregate",
  };
  const aliasedValidation = validateMurphAgeWearableLabAggregateReceipt(aliasedWorkbenchReceipt);
  assert.equal(aliasedValidation.status, "valid");
  const aliasedEvidenceCard = buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt(aliasedWorkbenchReceipt);
  assert.ok(aliasedEvidenceCard);
  assert.equal(aliasedEvidenceCard.sourceRouteId, "all-of-us-fitbit-labs-ehr");
  assert.equal(aliasedEvidenceCard.candidateId, "all-of-us-fitbit-labs-ehr-wearable-shadow-increment");

  const noDeltaReceipt = {
    ...receipt,
    models: receipt.models.map((model) =>
      model.modelId === "m5-residualized-wearable-after-controls"
        ? {
          ...model,
          calibrationStatus: "warn" as const,
          metrics: { ...model.metrics, auc: 0.751, brier: 0.0642, logLoss: 0.231 },
        }
        : model
    ),
    negativeControls: {
      ...receipt.negativeControls,
      coverageOnlyBeatenByResidualWearable: false,
    },
  } satisfies MurphAgeWearableLabAggregateReceipt;
  const noDeltaSummary = summarizeMurphAgeWearableLabAggregateReceipt(noDeltaReceipt);
  assert.equal(buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt(noDeltaReceipt), null);
  assert.equal(noDeltaSummary.validation.status, "valid");
  assert.equal(noDeltaSummary.conclusion, "valid-no-delta");
  assert.equal(noDeltaSummary.reviewGptRequired, false);
  for (const expectedBlocker of [
    "calibration_not_acceptable",
    "m5_does_not_beat_coverage_control",
    "m5_does_not_improve_over_lab_body",
    "negative_controls_not_passed",
  ] as const) {
    assert.equal(noDeltaSummary.blockers.includes(expectedBlocker), true, expectedBlocker);
  }

  const metriclessReceipt = {
    ...receipt,
    models: receipt.models.map((model) => ({ ...model, metrics: {} })),
  } satisfies MurphAgeWearableLabAggregateReceipt;
  const metriclessValidation = validateMurphAgeWearableLabAggregateReceipt(metriclessReceipt);
  assert.equal(metriclessValidation.status, "invalid");
  assert.equal(
    metriclessValidation.warnings.some((warning) =>
      warning.message.includes("must include a finite Brier score or log loss")
    ),
    true,
  );
  assert.equal(summarizeMurphAgeWearableLabAggregateReceipt(metriclessReceipt).conclusion, "blocked");

  const unsafeReceipt = {
    ...receipt,
    productAuthorized: true,
    rowValues: [1],
    models: receipt.models.map((model) =>
      model.modelId === "m0-anchor-only"
        ? { ...model, metrics: { ...model.metrics, rowValues: [1] } }
        : model
    ),
  };
  const unsafeValidation = validateMurphAgeWearableLabAggregateReceipt(unsafeReceipt);
  assert.equal(unsafeValidation.status, "invalid");
  assert.equal(
    unsafeValidation.warnings.some((warning) => warning.message.includes("unsupported field rowValues")),
    true,
  );
  assert.equal(
    unsafeValidation.warnings.some((warning) => warning.message.includes("research-only")),
    true,
  );
  const unsafeSummary = summarizeMurphAgeWearableLabAggregateReceipt(unsafeReceipt);
  assert.equal(unsafeSummary.conclusion, "blocked");
  assert.equal(unsafeSummary.blockers.includes("receipt_invalid"), true);
  assert.equal(buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt(unsafeReceipt), null);
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
  const functionContextPoints = completeFunctionContextPoints();
  const lab9WithAllContextPoints = [
    ...lab9WithWearableContextPoints,
    ...functionContextPoints,
  ];
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
    cardId: "lab9_bp_body_10y_acm_research",
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
  const wearableResidualParameterPack = {
    anchorCardId: "lab9_bp_body_10y_acm_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "true-external-validation",
    family: "activity",
    featureWeights: [{
      center: 8_000,
      coefficient: -0.08,
      metricKey: "steps",
      scale: 2_000,
      transform: "center-scale",
    }],
    globalWearableCapLogit: 0.2,
    horizonYears: 10,
    intercept: 0,
    layerId: "activity-residual-v1",
    packHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  } satisfies MurphAgeWearableResidualParameterPack;
  const researchWithWearablePack = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithWearableContextPoints,
    sex: "female",
    wearableResidualParameterPack,
  });
  const labOnlyResearch = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9Points,
    sex: "female",
  });
  const researchWithFunctionContext = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithAllContextPoints,
    sex: "female",
  });
  const functionResidualParameterPack = {
    anchorCardId: "lab9_bp_body_10y_acm_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "same-family-sanity",
    featureWeights: [{
      center: 0,
      coefficient: 0.04,
      metricKey: "iadl-limitation-count",
      scale: 1,
      transform: "center-scale",
    }, {
      center: 0,
      coefficient: 0.06,
      metricKey: "mobility-limitation-count",
      scale: 1,
      transform: "center-scale",
    }],
    globalFunctionCapLogit: 0.2,
    horizonYears: 10,
    intercept: 0,
    layerId: "function-mobility-residual-v1",
    packHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    schemaVersion: MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "mhas-harmonized-aging",
  } satisfies MurphAgeFunctionResidualParameterPack;
  const researchWithFunctionPack = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    functionResidualParameterPack,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithAllContextPoints,
    sex: "female",
  });
  const productWithFunctionPack = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "lab9_bp_body_10y_acm_research",
    chronologicalAgeYears: 45,
    functionResidualParameterPack,
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithAllContextPoints,
    sex: "female",
  });

  assert.equal(research.status, "ready");
  assert.equal(research.result?.status, "ready");
  assert.equal(research.result?.biologicalAgeYears, labOnlyResearch.result?.biologicalAgeYears);
  assert.equal(research.result?.ageDeltaYears, labOnlyResearch.result?.ageDeltaYears);
  assert.equal(research.result?.risk?.probability, labOnlyResearch.result?.risk?.probability);
  assert.equal(productDefault.functionResidualLayerApplication, null);
  assert.equal(productDefault.wearableResidualLayerApplication, null);
  assert.equal(productWithFunctionPack.status, "abstain");
  assert.equal(productWithFunctionPack.functionResidualLayerApplication, null);
  assert.equal(labOnlyResearch.wearableResidualLayerApplication?.status, "ineligible-insufficient-coverage");
  assert.equal(research.functionResidualLayerApplication?.status, "ineligible-insufficient-function-context");
  assert.equal(researchWithFunctionContext.functionResidualLayerApplication?.schemaVersion, MURPH_AGE_FUNCTION_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION);
  assert.equal(researchWithFunctionContext.functionResidualLayerApplication?.status, "mechanics-ready-zero-delta");
  assert.equal(researchWithFunctionContext.functionResidualLayerApplication?.eligibleForResidualResearch, true);
  assert.equal(researchWithFunctionContext.functionResidualLayerApplication?.parameterizationAvailable, false);
  assert.equal(researchWithFunctionContext.functionResidualLayerApplication?.residualDeltaLogit, 0);
  assert.equal(researchWithFunctionContext.functionResidualLayerApplication?.selectedMetricKeys.includes("mobility-limitation-count"), true);
  assert.deepEqual(validateMurphAgeFunctionResidualParameterPack({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    parameterPack: functionResidualParameterPack,
  }), { status: "valid", warnings: [] });
  const invalidFunctionResidualParameterPack = {
    ...functionResidualParameterPack,
    deploymentRights: "not-authorized",
    packHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  } satisfies MurphAgeFunctionResidualParameterPack;
  assert.equal(validateMurphAgeFunctionResidualParameterPack({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    parameterPack: invalidFunctionResidualParameterPack,
  }).status, "invalid");
  const nonDigestFunctionResidualParameterPack = {
    ...functionResidualParameterPack,
    packHash: "research-pack-function-v1",
  } satisfies MurphAgeFunctionResidualParameterPack;
  const nonDigestFunctionPackValidation = validateMurphAgeFunctionResidualParameterPack({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    parameterPack: nonDigestFunctionResidualParameterPack,
  });
  assert.equal(nonDigestFunctionPackValidation.status, "invalid");
  assert.equal(
    nonDigestFunctionPackValidation.warnings.some((warning) =>
      warning.message === "Function residual parameter pack hash must be a stable sha256 artifact digest."
    ),
    true,
  );
  const malformedFunctionResidualParameterPack = structuredClone(functionResidualParameterPack);
  Object.defineProperty(malformedFunctionResidualParameterPack, "deploymentRights", {
    configurable: true,
    enumerable: true,
    value: "bogus-rights",
    writable: true,
  });
  const malformedFunctionPackValidation = validateMurphAgeFunctionResidualParameterPack({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    parameterPack: malformedFunctionResidualParameterPack,
  });
  assert.equal(malformedFunctionPackValidation.status, "invalid");
  assert.equal(
    malformedFunctionPackValidation.warnings.some((warning) =>
      warning.message === "Function residual parameter pack deployment rights are not recognized."
    ),
    true,
  );
  const directFunctionResidualApplication = applyMurphAgeFunctionResidualLayer({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    anchorRiskProbability: researchWithFunctionContext.result?.risk?.probability ?? null,
    asOf,
    parameterPack: functionResidualParameterPack,
    points: lab9WithAllContextPoints,
    referenceRiskCurve: researchModel.referenceRiskCurve,
  });
  assert.equal(directFunctionResidualApplication.status, "research-parameterized-shadow-delta");
  assert.equal(directFunctionResidualApplication.residualDeltaLogit, 0.1);
  const invalidFunctionResidualApplication = applyMurphAgeFunctionResidualLayer({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    anchorRiskProbability: researchWithFunctionContext.result?.risk?.probability ?? null,
    asOf,
    parameterPack: invalidFunctionResidualParameterPack,
    points: lab9WithAllContextPoints,
    referenceRiskCurve: researchModel.referenceRiskCurve,
  });
  assert.equal(invalidFunctionResidualApplication.status, "mechanics-ready-zero-delta");
  assert.equal(invalidFunctionResidualApplication.parameterizationAvailable, false);
  assert.equal(invalidFunctionResidualApplication.residualDeltaLogit, 0);
  assert.equal(
    invalidFunctionResidualApplication.warnings.some((warning) =>
      warning.message === "Function residual parameter pack is not authorized for residual scoring."
    ),
    true,
  );
  assert.equal(researchWithFunctionPack.result?.risk?.probability, researchWithFunctionContext.result?.risk?.probability);
  assert.equal(researchWithFunctionPack.functionResidualLayerApplication?.status, "research-parameterized-shadow-delta");
  assert.equal(researchWithFunctionPack.functionResidualLayerApplication?.parameterizationAvailable, true);
  assert.equal(
    researchWithFunctionPack.functionResidualLayerApplication?.parameterPackHash,
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  );
  assert.equal(researchWithFunctionPack.functionResidualLayerApplication?.residualDeltaLogit, 0.1);
  assert.equal(researchWithFunctionPack.functionResidualLayerApplication?.scoreBearing, false);
  assert.equal(researchWithFunctionPack.functionResidualLayerApplication?.scoreContributionAuthorized, false);
  const functionShadowRiskProbability = researchWithFunctionPack.functionResidualLayerApplication?.finalRiskProbability;
  assert.equal(
    functionShadowRiskProbability !== null
      && functionShadowRiskProbability !== undefined
      && researchWithFunctionPack.result?.risk?.probability !== undefined
      && functionShadowRiskProbability > researchWithFunctionPack.result.risk.probability,
    true,
  );
  const baseFunctionPackRiskProbability = researchWithFunctionPack.result?.risk?.probability;
  if (typeof baseFunctionPackRiskProbability !== "number" || typeof functionShadowRiskProbability !== "number") {
    assert.fail("Expected function residual test to have base and function-shadow risk probabilities.");
  }
  assert.equal(
    functionShadowRiskProbability,
    expectedResidualRiskProbability(baseFunctionPackRiskProbability, 0.1),
  );
  const publicResearchWithFunctionPackReport = toPublicMurphAgeCalculatorReport(researchWithFunctionPack);
  const researchWithFunctionPackView = buildMurphAgeResearchCalculatorView(publicResearchWithFunctionPackReport);
  assert.equal(publicResearchWithFunctionPackReport.functionResidualLayer?.status, "research-parameterized-shadow-delta");
  assert.equal(
    publicResearchWithFunctionPackReport.functionResidualLayer?.parameterPackHash,
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  );
  assert.equal(publicResearchWithFunctionPackReport.functionResidualLayer?.residualDeltaLogit, 0.1);
  assert.equal(publicResearchWithFunctionPackReport.functionResidualLayer?.scoreBearing, false);
  assert.equal(publicResearchWithFunctionPackReport.functionResidualLayer?.scoreContributionAuthorized, false);
  const encodedPublicFunctionResidualLayer = JSON.stringify(publicResearchWithFunctionPackReport.functionResidualLayer);
  assert.equal(encodedPublicFunctionResidualLayer.includes("coefficient"), false);
  assert.equal(encodedPublicFunctionResidualLayer.includes("metric-point:"), false);
  assert.equal(encodedPublicFunctionResidualLayer.includes("finalRiskProbability"), false);
  assert.equal(encodedPublicFunctionResidualLayer.includes("finalRiskAgeEquivalentYears"), false);
  assert.equal(encodedPublicFunctionResidualLayer.includes("anchorRiskAgeEquivalentYears"), false);
  assert.equal(researchWithFunctionPackView.functionResidualLayer?.status, "research-parameterized-shadow-delta");
  assert.equal(researchWithFunctionPackView.layeredAgeEstimate?.status, "selected-card-only");
  assert.equal(researchWithFunctionPackView.layeredAgeEstimate?.basis, "selected-card-risk-age");
  assert.equal(researchWithFunctionPackView.layeredAgeEstimate?.riskProbability, baseFunctionPackRiskProbability);
  assert.deepEqual(researchWithFunctionPackView.layeredAgeEstimate?.appliedLayerIds, [
    "selected-lab-body-card",
  ]);
  assert.equal(
    researchWithFunctionPackView.layeredAgeEstimate?.biologicalAgeYears,
    researchWithFunctionPack.result?.biologicalAgeYears,
  );
  const parameterizedFunctionLayer = researchWithFunctionPackView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "function-disability-sidecar"
  );
  assert.ok(parameterizedFunctionLayer);
  assert.equal(parameterizedFunctionLayer.status, "parameter-pack-available-shadow-only");
  assert.equal(parameterizedFunctionLayer.parameterPackAvailable, true);
  assert.equal(parameterizedFunctionLayer.scoreBearingNow, false);
  assert.equal(parameterizedFunctionLayer.scoreContributionAuthorized, false);
  assert.deepEqual(researchWithFunctionPackView.model.layeredResearchPath.parameterPackBlockedLayerIds, [
    "wearable-multi-family-residual",
  ]);
  assert.equal(
    researchWithFunctionPackView.model.composition.nextArchitectureStep,
    "validate-function-sidecar-and-wearable-residuals-before-product-use",
  );
  assert.equal(research.wearableResidualLayerApplication?.schemaVersion, MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION);
  assert.equal(research.wearableResidualLayerApplication?.layerId, "activity-residual-v1");
  assert.equal(research.wearableResidualLayerApplication?.status, "mechanics-ready-zero-delta");
  assert.equal(research.wearableResidualLayerApplication?.eligibleForResidualResearch, true);
  assert.equal(research.wearableResidualLayerApplication?.parameterizationAvailable, false);
  assert.equal(research.wearableResidualLayerApplication?.residualDeltaLogit, 0);
  assert.equal(research.wearableResidualLayerApplication?.finalRiskProbability, research.result?.risk?.probability);
  assert.equal(research.wearableResidualLayerApplication?.scoreBearing, false);
  assert.equal(research.wearableResidualLayerApplication?.scoreContributionAuthorized, false);
  assert.equal(research.wearableResidualLayerApplication?.selectedMetricKeys.includes("steps"), true);
  assert.equal(researchWithWearablePack.result?.risk?.probability, research.result?.risk?.probability);
  assert.equal(researchWithWearablePack.wearableResidualLayerApplication?.status, "research-parameterized-shadow-delta");
  assert.equal(researchWithWearablePack.wearableResidualLayerApplication?.parameterizationAvailable, true);
  assert.equal(
    researchWithWearablePack.wearableResidualLayerApplication?.parameterPackHash,
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(researchWithWearablePack.wearableResidualLayerApplication?.residualDeltaLogit, -0.08);
  const shadowRiskProbability = researchWithWearablePack.wearableResidualLayerApplication?.finalRiskProbability;
  const baseRiskProbability = researchWithWearablePack.result?.risk?.probability;
  assert.equal(
    shadowRiskProbability !== null
      && shadowRiskProbability !== undefined
      && baseRiskProbability !== undefined
      && shadowRiskProbability < baseRiskProbability,
    true,
  );
  assert.equal(researchWithWearablePack.wearableResidualLayerApplication?.scoreBearing, false);
  assert.equal(researchWithWearablePack.wearableResidualLayerApplication?.scoreContributionAuthorized, false);
  const publicResearchWithWearablePackReport = toPublicMurphAgeCalculatorReport(researchWithWearablePack);
  const researchWithWearablePackView = buildMurphAgeResearchCalculatorView(publicResearchWithWearablePackReport);
  assert.equal(publicResearchWithWearablePackReport.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
  assert.equal(publicResearchWithWearablePackReport.wearableResidualLayer?.parameterizationAvailable, true);
  assert.equal(
    publicResearchWithWearablePackReport.wearableResidualLayer?.parameterPackHash,
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(publicResearchWithWearablePackReport.wearableResidualLayer?.residualDeltaLogit, -0.08);
  assert.equal(publicResearchWithWearablePackReport.wearableResidualLayer?.scoreBearing, false);
  assert.equal(publicResearchWithWearablePackReport.wearableResidualLayer?.scoreContributionAuthorized, false);
  assert.equal(researchWithWearablePackView.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
  assert.equal(researchWithWearablePackView.arbiter.wearableScorePolicy, "research-residual-shadow-product-blocked");
  assert.equal(researchWithWearablePackView.wearableResidualLayer?.finalRiskProbability, shadowRiskProbability);
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.status, "wearable-shadow-applied");
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.basis, "wearable-shadow-risk-age");
  assert.equal(
    researchWithWearablePackView.layeredAgeEstimate?.biologicalAgeYears,
    researchWithWearablePackView.wearableResidualLayer?.finalRiskAgeEquivalentYears,
  );
  assert.equal(
    researchWithWearablePackView.ageEstimate?.biologicalAgeYears,
    researchWithWearablePackView.layeredAgeEstimate?.biologicalAgeYears,
  );
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.riskProbability, shadowRiskProbability);
  assert.equal(researchWithWearablePackView.risk.probability, shadowRiskProbability);
  assert.equal(
    researchWithWearablePackView.layeredAgeEstimate?.residualDeltaYears,
    researchWithWearablePackView.wearableResidualLayer?.residualDeltaYears,
  );
  assert.deepEqual(researchWithWearablePackView.layeredAgeEstimate?.appliedLayerIds, [
    "selected-lab-body-card",
    "wearable-multi-family-residual",
  ]);
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.intervalYears, null);
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.productAuthorized, false);
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.residualScoreContributionAuthorized, false);
  assert.equal(researchWithWearablePackView.layeredAgeEstimate?.uncertaintyStatus, "not-reestimated-for-shadow");
  const parameterizedWearableLayer = researchWithWearablePackView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "wearable-multi-family-residual"
  );
  assert.ok(parameterizedWearableLayer);
  assert.equal(parameterizedWearableLayer.status, "active-research-shadow-score");
  assert.equal(parameterizedWearableLayer.parameterPackAvailable, true);
  assert.equal(parameterizedWearableLayer.scoreBearingNow, true);
  assert.equal(parameterizedWearableLayer.scoreContributionAuthorized, false);
  assert.equal(researchWithWearablePackView.model.composition.currentScoringMode, "selected-card-plus-parameterized-residual-shadow");
  assert.equal(
    researchWithWearablePackView.model.composition.wearableStatus,
    "research-shadow-residual-score-product-blocked",
  );
  assert.equal(researchWithWearablePackView.model.researchAppliedFeatureKeys.includes("wearable-multi-family-residual"), true);
  assert.equal(researchWithWearablePackView.model.researchAppliedMetricKeys.includes("steps"), true);
  assert.equal(researchWithWearablePackView.model.researchAppliedWearableMetricKeys.includes("steps"), true);
  assert.equal(
    researchWithWearablePackView.model.researchAppliedWearableMetricKeys.includes("wearable-valid-day-count-28d"),
    true,
  );
  assert.equal(
    researchWithWearablePackView.model.researchAppliedWearableMetricKeys.includes("wearable-coverage-index"),
    true,
  );
  assert.equal(researchWithWearablePackView.model.scoreBearingMetricKeys.includes("steps"), false);
  assert.equal(researchWithWearablePackView.model.wearable.currentUse, "research-shadow-residual-score");
  assert.equal(researchWithWearablePackView.model.wearable.researchScoreBearing, true);
  assert.equal(researchWithWearablePackView.model.wearable.scoreBearing, false);
  const wearableResidualFeatureContribution = researchWithWearablePackView.featureContributions.find((feature) =>
    feature.featureKey === "wearable-multi-family-residual"
  );
  assert.ok(wearableResidualFeatureContribution);
  assert.equal(
    wearableResidualFeatureContribution.contributionYears,
    researchWithWearablePackView.wearableResidualLayer?.residualDeltaYears,
  );
  assert.equal(wearableResidualFeatureContribution.metricKey, null);
  assert.equal(wearableResidualFeatureContribution.moduleId, "wearable");
  const wearableResidualDomainContribution = researchWithWearablePackView.domainContributions.find((domain) =>
    domain.moduleId === "wearable"
  );
  assert.ok(wearableResidualDomainContribution);
  assert.deepEqual(wearableResidualDomainContribution.featureKeys, ["wearable-multi-family-residual"]);
  assert.equal(
    wearableResidualDomainContribution.contributionYears,
    researchWithWearablePackView.wearableResidualLayer?.residualDeltaYears,
  );
  assert.deepEqual(researchWithWearablePackView.model.layeredResearchPath.activeResearchScoreLayerIds, [
    "selected-lab-body-card",
    "wearable-multi-family-residual",
  ]);
  assert.equal(
    researchWithWearablePackView.model.layeredResearchPath.currentExecutableMode,
    "single-card-plus-parameterized-residual-shadow-score",
  );
  assert.deepEqual(researchWithWearablePackView.model.layeredResearchPath.parameterPackBlockedLayerIds, [
    "function-disability-sidecar",
  ]);
  const researchWithBothResidualPacks = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    functionResidualParameterPack,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithAllContextPoints,
    sex: "female",
    wearableResidualParameterPack,
  });
  const publicResearchWithBothResidualPacksReport = toPublicMurphAgeCalculatorReport(researchWithBothResidualPacks);
  const researchWithBothResidualPacksView = buildMurphAgeResearchCalculatorView(
    publicResearchWithBothResidualPacksReport,
  );
  assert.equal(
    publicResearchWithBothResidualPacksReport.functionResidualLayer?.status,
    "research-parameterized-shadow-delta",
  );
  assert.equal(
    publicResearchWithBothResidualPacksReport.wearableResidualLayer?.status,
    "research-parameterized-shadow-delta",
  );
  assert.equal(researchWithBothResidualPacksView.layeredAgeEstimate?.status, "multi-residual-shadow-applied");
  assert.equal(researchWithBothResidualPacksView.layeredAgeEstimate?.basis, "residual-shadow-risk-age");
  assert.deepEqual(researchWithBothResidualPacksView.layeredAgeEstimate?.appliedLayerIds, [
    "selected-lab-body-card",
    "function-disability-sidecar",
    "wearable-multi-family-residual",
  ]);
  assert.equal(
    researchWithBothResidualPacksView.layeredAgeEstimate?.riskProbability,
    researchWithBothResidualPacksView.wearableResidualLayer?.finalRiskProbability,
  );
  assert.equal(
    researchWithBothResidualPacksView.ageEstimate?.biologicalAgeYears,
    researchWithBothResidualPacksView.layeredAgeEstimate?.biologicalAgeYears,
  );
  assert.equal(
    researchWithBothResidualPacksView.risk.probability,
    researchWithBothResidualPacksView.layeredAgeEstimate?.riskProbability,
  );
  assert.equal(
    researchWithBothResidualPacksView.wearableResidualLayer?.finalRiskProbability,
    expectedResidualRiskProbability(functionShadowRiskProbability, -0.08),
  );
  assert.deepEqual(researchWithBothResidualPacksView.model.layeredResearchPath.activeResearchScoreLayerIds, [
    "selected-lab-body-card",
    "function-disability-sidecar",
    "wearable-multi-family-residual",
  ]);
  assert.deepEqual(researchWithBothResidualPacksView.model.layeredResearchPath.parameterPackBlockedLayerIds, []);
  assert.equal(JSON.stringify(publicResearchWithWearablePackReport.wearableResidualLayer).includes("metric-point:"), false);
  assert.equal(JSON.stringify(publicResearchWithWearablePackReport.wearableResidualLayer).includes("10000"), false);
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
  const selectedLab9Candidate = research.researchCandidateCards.find((candidate) =>
    candidate.cardId === "lab9_bp_body_10y_acm_research"
  );
  assert.ok(selectedLab9Candidate);
  assert.equal(selectedLab9Candidate.selected, true);
  assert.equal(selectedLab9Candidate.bundleId, "lab9-bp-body");
  assert.equal(selectedLab9Candidate.inputStatus, "ready");
  assert.equal(selectedLab9Candidate.modelLoaded, true);
  assert.equal(selectedLab9Candidate.blockerCodes.length, 0);
  assert.equal(selectedLab9Candidate.selectedMetricKeys.includes("hba1c"), true);
  assert.equal("selectedPointIds" in selectedLab9Candidate, false);
  assert.equal("value" in selectedLab9Candidate, false);
  const lab5CandidateWithoutModel = research.researchCandidateCards.find((candidate) =>
    candidate.cardId === "lab5_bp_bmi_transport_research"
  );
  assert.ok(lab5CandidateWithoutModel);
  assert.equal(lab5CandidateWithoutModel.selected, false);
  assert.equal(lab5CandidateWithoutModel.inputStatus, "ready");
  assert.equal(lab5CandidateWithoutModel.modelLoaded, false);
  assert.equal(lab5CandidateWithoutModel.blockerCodes.includes("LOCAL_MODEL_CARD_NOT_LOADED"), true);
  assert.equal(research.contextAssessments.length, 1);
  assert.equal(research.contextAssessments[0]?.bundleId, "wearable-context");
  assert.equal(research.contextAssessments[0]?.status, "context-only");
  assert.equal(research.contextAssessments[0]?.selectedPointIds.includes("metric-point:steps:2026-05-08:dispatcher-wearable:0"), true);
  assert.equal(researchWithFunctionContext.contextAssessments.length, 2);
  assert.deepEqual(
    researchWithFunctionContext.contextAssessments.map((assessment) => assessment.bundleId).sort(),
    ["function-context", "wearable-context"],
  );
  assert.equal(
    researchWithFunctionContext.authorization.contextOnlyMetricKeys.includes("adl-limitation-count"),
    true,
  );
  assert.equal(
    researchWithFunctionContext.result?.featureAttributions.some((feature) =>
      feature.metricKey === "adl-limitation-count"
    ),
    false,
  );
  const researchWithFunctionSummary = summarizeMurphAgeCalculatorOutput(researchWithFunctionContext);
  assert.equal(researchWithFunctionSummary.contextOnlyMetricKeys.includes("mobility-limitation-count"), true);
  assert.equal(researchWithFunctionSummary.contextOnlyFeatureKeys.includes("mobility-limitations"), true);
  assert.equal(researchWithFunctionSummary.wearableContext.readyFeatureCount, 7);
  assert.equal(researchWithFunctionSummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
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

  const directResidualApplication = applyMurphAgeWearableResidualLayer({
    anchorCardId: "lab9_bp_body_10y_acm_research",
    anchorRiskProbability: research.result?.risk?.probability ?? null,
    assessments: research.wearableShadowIncrementAssessments,
    referenceRiskCurve: researchModel.referenceRiskCurve,
  });
  assert.deepEqual(directResidualApplication, research.wearableResidualLayerApplication);
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
  assert.deepEqual(researchSummary.productPromotionBlockers, [
    "PRODUCT_POLICY_NOT_AUTHORIZED",
    "VALIDATION_GATE_BLOCKED",
    "PRODUCT_PROMOTION_EVIDENCE_MISSING",
    "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING",
    "RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED",
  ]);
  assert.equal(researchSummary.validationGate?.status, "blocked");
  assert.equal(researchSummary.validationGate?.productPromotionEvidence, false);
  assert.equal(researchSummary.researchEstimateAvailable, true);
  assert.equal(researchSummary.selectedScoreBearingFeatureKeys.includes("hba1c"), true);
  assert.equal(researchSummary.selectedScoreBearingFeatureKeys.includes("model-feature"), false);
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
  assert.equal(researchSummary.wearableBridge.candidateFeatureCount, 9);
  assert.deepEqual(researchSummary.wearableBridge.firstPriorityReadyFeatureKeys, [
    "wearable-coverage-quality",
    "activity-volume",
  ]);
  assert.deepEqual(researchSummary.wearableBridge.firstPriorityIncompleteFeatureKeys, [
    "actigraphy-activity-counts",
    "activity-intensity-pattern",
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
    researchSummary.wearableBridge.features.find((feature) => feature.featureKey === "activity-volume")?.measurementMethod,
    "consumer-device",
  );
  assert.equal(
    researchSummary.wearableBridge.features.find((feature) => feature.featureKey === "estimated-vo2-max")?.measurementMethod,
    "estimated-fitness",
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
  assert.equal(publicResearchSummary.validationGate?.status, "blocked");
  assert.equal(publicResearchSummary.productPromotionBlockers.includes("PRODUCT_POLICY_NOT_AUTHORIZED"), true);
  assert.equal(publicResearchSummary.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(publicResearchSummary.wearableContext.readyPointCount, 7);
  assert.equal(publicResearchSummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(publicResearchSummary.wearableBridge.productAuthorized, false);
  assert.equal(
    publicResearchSummary.wearableBridge.features.some((feature) => "selectedPointIds" in feature),
    false,
  );
  for (const forbiddenFeatureKey of [
    "label",
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
    wearableContext: {
      ...researchSummary.wearableContext,
      availableQualityFeatureKeys: [
        "private-quality-feature",
        ...researchSummary.wearableContext.availableQualityFeatureKeys,
      ],
      missingQualityFeatureKeys: [
        "private-quality-feature",
        ...researchSummary.wearableContext.missingQualityFeatureKeys,
      ],
    },
    wearableBridge: {
      ...researchSummary.wearableBridge,
      deferredFeatureKeys: ["private-bridge-feature", ...researchSummary.wearableBridge.deferredFeatureKeys],
      firstPriorityIncompleteFeatureKeys: [
        "private-bridge-feature",
        ...researchSummary.wearableBridge.firstPriorityIncompleteFeatureKeys,
      ],
      firstPriorityReadyFeatureKeys: [
        "private-bridge-feature",
        ...researchSummary.wearableBridge.firstPriorityReadyFeatureKeys,
      ],
      features: researchSummary.wearableBridge.features.map((feature) => ({
        ...feature,
        coefficient: 1,
        contributionLogit: 1,
        contributionYears: 1,
        featureKey: "private-bridge-feature",
        label: "private bridge label",
        metricKeys: ["private-bridge-metric", ...feature.metricKeys],
        missingMetricKeys: ["private-bridge-metric", ...feature.missingMetricKeys],
        missingQualityMetricKeys: ["private-bridge-metric", ...feature.missingQualityMetricKeys],
        prediction: 1,
        readyMetricKeys: ["private-bridge-metric", ...feature.readyMetricKeys],
        requiredQualityMetricKeys: ["private-bridge-metric", ...feature.requiredQualityMetricKeys],
        selectedPointIds: ["metric-point:private-row:0"],
        unit: "count",
        value: 1,
      })),
      missingFeatureKeys: ["private-bridge-feature", ...researchSummary.wearableBridge.missingFeatureKeys],
      partialFeatureKeys: ["private-bridge-feature", ...researchSummary.wearableBridge.partialFeatureKeys],
      readyFeatureKeys: ["private-bridge-feature", ...researchSummary.wearableBridge.readyFeatureKeys],
      secondPriorityIncompleteFeatureKeys: [
        "private-bridge-feature",
        ...researchSummary.wearableBridge.secondPriorityIncompleteFeatureKeys,
      ],
      secondPriorityReadyFeatureKeys: [
        "private-bridge-feature",
        ...researchSummary.wearableBridge.secondPriorityReadyFeatureKeys,
      ],
    },
  });
  for (const forbiddenFeatureKey of [
    "label",
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
  assert.equal(publicFromLeakyBridgeSummary.wearableBridge.readyFeatureKeys.includes("private-bridge-feature"), false);
  assert.equal(publicFromLeakyBridgeSummary.wearableBridge.readyFeatureKeys.includes("wearable-feature"), true);
  assert.equal(
    publicFromLeakyBridgeSummary.wearableBridge.deferredFeatureKeys.includes("private-bridge-feature"),
    false,
  );
  assert.equal(
    publicFromLeakyBridgeSummary.wearableBridge.features.some((feature) => feature.featureKey === "private-bridge-feature"),
    false,
  );
  assert.equal(
    publicFromLeakyBridgeSummary.wearableBridge.features.some((feature) => feature.featureKey === "wearable-feature"),
    true,
  );
  assert.equal(
    publicFromLeakyBridgeSummary.wearableBridge.features.some((feature) =>
      feature.metricKeys.includes("private-bridge-metric")
    ),
    false,
  );
  assert.equal(
    publicFromLeakyBridgeSummary.wearableBridge.features.some((feature) =>
      feature.requiredQualityMetricKeys.includes("private-bridge-metric")
    ),
    false,
  );
  assert.equal(
    publicFromLeakyBridgeSummary.wearableContext.availableQualityFeatureKeys.includes("private-quality-feature"),
    false,
  );
  assert.equal(
    publicFromLeakyBridgeSummary.wearableContext.missingQualityFeatureKeys.includes("private-quality-feature"),
    false,
  );
  const leakyDisplaySummary = {
    ...researchSummary,
    blockedFeatureKeys: ["private-model-feature", ...researchSummary.blockedFeatureKeys],
    contextOnlyFeatureKeys: ["private-model-feature", ...researchSummary.contextOnlyFeatureKeys],
    contextOnlyMetricKeys: ["private-metric-key", ...researchSummary.contextOnlyMetricKeys],
    missingFeatureKeys: ["private-model-feature", ...researchSummary.missingFeatureKeys],
    selectedScoreBearingFeatureKeys: ["private-model-feature", ...researchSummary.selectedScoreBearingFeatureKeys],
    selectedScoreBearingMetricKeys: ["private-metric-key", ...researchSummary.selectedScoreBearingMetricKeys],
  };
  Object.assign(leakyDisplaySummary, {
    outcomeContext: {
      ageEstimateBasis: "private endpoint basis",
      horizonYears: Number.NaN,
      riskEndpoint: "private endpoint",
    },
    productPromotionBlockers: [
      "PRIVATE_PRODUCT_BLOCKER",
      ...researchSummary.productPromotionBlockers,
    ],
    validationGate: {
      evidenceTiers: [
        "private-evidence-tier",
        ...(researchSummary.validationGate?.evidenceTiers ?? []),
      ],
      productPromotionEvidence: true,
      status: "private-status",
      summary: "private validation gate summary",
    },
  });
  const publicFromLeakyDisplaySummary = toPublicMurphAgeDisplaySummary(leakyDisplaySummary);
  assert.equal(publicFromLeakyDisplaySummary.selectedScoreBearingFeatureKeys.includes("private-model-feature"), false);
  assert.equal(publicFromLeakyDisplaySummary.selectedScoreBearingFeatureKeys.includes("model-feature"), true);
  assert.equal(publicFromLeakyDisplaySummary.blockedFeatureKeys.includes("private-model-feature"), false);
  assert.equal(publicFromLeakyDisplaySummary.contextOnlyFeatureKeys.includes("private-model-feature"), false);
  assert.equal(publicFromLeakyDisplaySummary.missingFeatureKeys.includes("private-model-feature"), false);
  assert.equal(publicFromLeakyDisplaySummary.selectedScoreBearingMetricKeys.includes("private-metric-key"), false);
  assert.equal(publicFromLeakyDisplaySummary.contextOnlyMetricKeys.includes("private-metric-key"), false);
  assert.equal(publicFromLeakyDisplaySummary.contextOnlyMetricKeys.includes("steps"), true);
  assert.deepEqual(publicFromLeakyDisplaySummary.outcomeContext, {
    ageEstimateBasis: "none",
    horizonYears: null,
    riskEndpoint: "none",
  });
  const publicPromotionBlockers = new Set<string>(publicFromLeakyDisplaySummary.productPromotionBlockers);
  assert.equal(publicPromotionBlockers.has("PRIVATE_PRODUCT_BLOCKER"), false);
  assert.equal(publicPromotionBlockers.has("PRODUCT_POLICY_NOT_AUTHORIZED"), true);
  const publicEvidenceTiers = new Set<string>(publicFromLeakyDisplaySummary.validationGate?.evidenceTiers ?? []);
  assert.equal(publicEvidenceTiers.has("private-evidence-tier"), false);
  assert.equal(publicEvidenceTiers.has("internal-anchor"), true);
  assert.equal(publicFromLeakyDisplaySummary.validationGate?.status, "blocked");
  assert.notEqual(publicFromLeakyDisplaySummary.validationGate?.summary, "private validation gate summary");
  assert.equal(
    publicFromLeakyDisplaySummary.validationGate?.summary,
    MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT.blocked,
  );
  const strippedPassedGateDisplaySummary = { ...researchSummary };
  Object.assign(strippedPassedGateDisplaySummary, {
    validationGate: {
      evidenceTiers: ["private-evidence-tier", "internal-anchor"],
      productPromotionEvidence: true,
      status: "passed",
      summary: "private validation gate summary",
    },
  });
  const publicFromStrippedPassedGateSummary = toPublicMurphAgeDisplaySummary(strippedPassedGateDisplaySummary);
  assert.equal(publicFromStrippedPassedGateSummary.validationGate?.status, "blocked");
  assert.equal(publicFromStrippedPassedGateSummary.validationGate?.productPromotionEvidence, false);
  assert.equal(
    publicFromStrippedPassedGateSummary.validationGate?.summary,
    MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT.blocked,
  );
  const publicResearchReport = toPublicMurphAgeCalculatorReport(research);
  const directPublicResearchReport = calculateMurphAgePublicReportFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab9WithWearableContextPoints,
    sex: "female",
  });
  assert.deepEqual(directPublicResearchReport, publicResearchReport);
  assert.equal(publicResearchReport.schemaVersion, MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION);
  assert.equal(publicResearchReport.status, "ready");
  assert.equal(publicResearchReport.mode, "research");
  assert.equal(publicResearchReport.authorization.productAuthorized, false);
  assert.equal(publicResearchReport.displaySummary.displayStatus, "research-only");
  assert.equal(publicResearchReport.displaySummary.displayBlockedReason, "product-not-authorized");
  assert.deepEqual(publicResearchReport.displaySummary.outcomeContext, {
    ageEstimateBasis: "risk-age-equivalent",
    horizonYears: 10,
    riskEndpoint: "all-cause-mortality",
  });
  assert.equal(publicResearchReport.result?.biologicalAgeYears, research.result?.biologicalAgeYears);
  assert.equal(publicResearchReport.result?.risk?.probability, research.result?.risk?.probability);
  assert.equal(publicResearchReport.result?.authorization.productAuthorized, false);
  assert.equal(publicResearchReport.wearableResidualLayer?.status, "mechanics-ready-zero-delta");
  assert.equal(publicResearchReport.wearableResidualLayer?.parameterizationAvailable, false);
  assert.equal(publicResearchReport.wearableResidualLayer?.residualDeltaLogit, 0);
  assert.equal(publicResearchReport.wearableResidualLayer?.finalRiskProbability, research.result?.risk?.probability);
  assert.equal(publicResearchReport.wearableResidualLayer?.scoreBearing, false);
  assert.equal(publicResearchReport.wearableResidualLayer?.selectedMetricKeys.includes("steps"), true);
  assert.equal(JSON.stringify(publicResearchReport.wearableResidualLayer).includes("metric-point:"), false);
  assert.equal(JSON.stringify(publicResearchReport.wearableResidualLayer).includes("10000"), false);
  assert.equal(publicResearchReport.researchCandidateCards.length, 5);
  const publicLab9Candidate = publicResearchReport.researchCandidateCards.find((candidate) =>
    candidate.cardId === "lab9_bp_body_10y_acm_research"
  );
  assert.ok(publicLab9Candidate);
  assert.equal(publicLab9Candidate.selected, true);
  assert.equal(publicLab9Candidate.modelLoaded, true);
  assert.equal(publicLab9Candidate.blockerCodes.length, 0);
  assert.equal(publicLab9Candidate.selectedMetricKeys.includes("hba1c"), true);
  for (const forbiddenCandidateKey of [
    "label",
    "selectedPointIds",
    "value",
    "unit",
    "prediction",
    "coefficient",
    "contributionLogit",
    "contributionYears",
  ]) {
    assert.equal(forbiddenCandidateKey in publicLab9Candidate, false);
  }
  assert.equal(publicResearchReport.result ? "modelId" in publicResearchReport.result : true, false);
  assert.equal(publicResearchReport.result ? "modelVersion" in publicResearchReport.result : true, false);
  assert.equal(publicResearchReport.result?.risk ? "endpoint" in publicResearchReport.result.risk : true, false);
  assert.equal(
    publicResearchReport.result?.risk ? "referencePopulation" in publicResearchReport.result.risk : true,
    false,
  );
  assert.equal("evidenceSummary" in publicResearchReport.authorization, false);
  assert.equal(publicResearchReport.result?.featureAttributions.some((feature) => feature.metricKey === "hba1c"), true);
  assert.equal(publicResearchReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  const publicHba1cAttribution = publicResearchReport.result?.featureAttributions.find((feature) =>
    feature.metricKey === "hba1c"
  );
  assert.ok(publicHba1cAttribution);
  assert.equal(publicHba1cAttribution.moduleId, "metabolic");
  assert.equal("selectedPointIds" in publicHba1cAttribution, false);
  assert.equal("value" in publicHba1cAttribution, false);
  assert.equal("unit" in publicHba1cAttribution, false);
  assert.equal("label" in publicHba1cAttribution, false);
  assert.equal("contributionLogit" in publicHba1cAttribution, false);
  const publicMetabolicModule = publicResearchReport.result?.moduleAttributions.find((module) =>
    module.moduleId === "metabolic"
  );
  assert.ok(publicMetabolicModule);
  assert.equal(publicMetabolicModule.featureKeys.includes("hba1c"), true);
  assert.equal("contributionLogit" in publicMetabolicModule, false);
  const internalReadyAttribution = research.result?.featureAttributions.find((feature) => feature.status === "ready");
  assert.ok(internalReadyAttribution);
  const publicReportWithWearableModules = toPublicMurphAgeCalculatorReport({
    ...research,
    result: research.result ? {
      ...research.result,
      featureAttributions: [
        ...research.result.featureAttributions,
        {
          ...internalReadyAttribution,
          contributionYears: -1.2,
          featureKey: "steps",
          label: "Steps",
          metricKey: "steps",
          moduleId: "activity",
          selectedPointIds: ["metric-point:private-row:activity"],
          unit: "count",
          value: 10_000,
          valueLabel: "10,000 steps",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: -0.8,
          featureKey: "total-sleep-minutes",
          label: "Total sleep",
          metricKey: "total-sleep-minutes",
          moduleId: "sleep",
          selectedPointIds: ["metric-point:private-row:sleep"],
          unit: "minutes",
          value: 440,
          valueLabel: "440 minutes",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: 0.4,
          featureKey: "resting-heart-rate",
          label: "Resting heart rate",
          metricKey: "resting-heart-rate",
          moduleId: "recovery",
          selectedPointIds: ["metric-point:private-row:recovery"],
          unit: "bpm",
          value: 65,
          valueLabel: "65 bpm",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: 0.2,
          featureKey: "private-feature",
          label: "Private feature",
          metricKey: "private-metric",
          moduleId: "private-module",
          selectedPointIds: ["metric-point:private-row:private"],
          unit: "private unit",
          value: 1,
          valueLabel: "private value",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: 0.6,
          featureKey: "waist-circumference",
          label: "Waist circumference",
          metricKey: "waist-circumference",
          moduleId: "body-composition",
          selectedPointIds: ["metric-point:private-row:waist"],
          unit: "cm",
          value: 82,
          valueLabel: "82 cm",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: -0.4,
          featureKey: "hdl-c",
          label: "HDL-C",
          metricKey: "hdl-c",
          moduleId: "lipids",
          selectedPointIds: ["metric-point:private-row:hdl"],
          unit: "mg/dL",
          value: 62,
          valueLabel: "62 mg/dL",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: 0.3,
          featureKey: "white-blood-cell-count",
          label: "White blood cells",
          metricKey: "white-blood-cell-count",
          moduleId: "immune-hematologic",
          selectedPointIds: ["metric-point:private-row:wbc"],
          unit: "10^3/uL",
          value: 7,
          valueLabel: "7",
          warnings: [],
        },
        {
          ...internalReadyAttribution,
          contributionYears: -0.2,
          featureKey: "albumin",
          label: "Albumin",
          metricKey: "albumin",
          moduleId: "liver-renal",
          selectedPointIds: ["metric-point:private-row:albumin"],
          unit: "g/dL",
          value: 4.4,
          valueLabel: "4.4 g/dL",
          warnings: [],
        },
      ],
      moduleAttributions: [
        ...research.result.moduleAttributions,
        { contributionLogit: -0.2, contributionYears: -1.2, featureKeys: ["steps"], moduleId: "activity" },
        {
          contributionLogit: -0.1,
          contributionYears: -0.8,
          featureKeys: ["total-sleep-minutes"],
          moduleId: "sleep",
        },
        {
          contributionLogit: 0.05,
          contributionYears: 0.4,
          featureKeys: ["resting-heart-rate"],
          moduleId: "recovery",
        },
        {
          contributionLogit: 0.05,
          contributionYears: 0.2,
          featureKeys: ["private-feature"],
          moduleId: "private-module",
        },
        {
          contributionLogit: 0.06,
          contributionYears: 0.6,
          featureKeys: ["waist-circumference"],
          moduleId: "body-composition",
        },
        { contributionLogit: -0.04, contributionYears: -0.4, featureKeys: ["hdl-c"], moduleId: "lipids" },
        {
          contributionLogit: 0.03,
          contributionYears: 0.3,
          featureKeys: ["white-blood-cell-count"],
          moduleId: "immune-hematologic",
        },
        { contributionLogit: -0.02, contributionYears: -0.2, featureKeys: ["albumin"], moduleId: "liver-renal" },
      ],
    } : null,
  });
  const publicWearableModuleIds = new Set(
    publicReportWithWearableModules.result?.moduleAttributions.map((module) => module.moduleId),
  );
  assert.equal(publicWearableModuleIds.has("activity"), true);
  assert.equal(publicWearableModuleIds.has("sleep"), true);
  assert.equal(publicWearableModuleIds.has("recovery"), true);
  assert.equal(publicWearableModuleIds.has("private-module"), false);
  assert.equal(publicWearableModuleIds.has("unknown"), true);
  const publicBodyModules = publicReportWithWearableModules.result?.moduleAttributions.filter((module) =>
    module.moduleId === "body"
  ) ?? [];
  assert.equal(publicBodyModules.length, 1);
  assert.equal(publicBodyModules[0]?.featureKeys.includes("bmi"), true);
  assert.equal(publicBodyModules[0]?.featureKeys.includes("waist-circumference"), true);
  const publicCardiovascularModule = publicReportWithWearableModules.result?.moduleAttributions.find((module) =>
    module.moduleId === "cardiovascular"
  );
  assert.ok(publicCardiovascularModule);
  assert.equal(publicCardiovascularModule.featureKeys.includes("hdl-c"), true);
  const publicImmuneModule = publicReportWithWearableModules.result?.moduleAttributions.find((module) =>
    module.moduleId === "immune"
  );
  assert.ok(publicImmuneModule);
  assert.equal(publicImmuneModule.featureKeys.includes("white-blood-cell-count"), true);
  const publicLiverModule = publicReportWithWearableModules.result?.moduleAttributions.find((module) =>
    module.moduleId === "liver"
  );
  assert.ok(publicLiverModule);
  assert.equal(publicLiverModule.featureKeys.includes("albumin"), true);
  assert.equal(
    publicReportWithWearableModules.result?.featureAttributions.find((feature) => feature.metricKey === "steps")
      ?.moduleId,
    "activity",
  );
  assert.equal(
    publicReportWithWearableModules.result?.featureAttributions.find((feature) =>
      feature.metricKey === "total-sleep-minutes"
    )?.moduleId,
    "sleep",
  );
  assert.equal(
    publicReportWithWearableModules.result?.featureAttributions.find((feature) =>
      feature.metricKey === "resting-heart-rate"
    )?.moduleId,
    "recovery",
  );
  const publicPrivateMetricAttribution = publicReportWithWearableModules.result?.featureAttributions.find((feature) =>
    feature.featureKey === "metric-feature" && feature.metricKey === null && feature.status === "ready"
  );
  assert.ok(publicPrivateMetricAttribution);
  assert.equal(publicPrivateMetricAttribution.moduleId, "unknown");
  const publicActivityModule = publicReportWithWearableModules.result?.moduleAttributions.find((module) =>
    module.moduleId === "activity"
  );
  assert.ok(publicActivityModule);
  assert.equal(publicActivityModule.featureKeys.includes("steps"), true);
  assert.equal(
    publicReportWithWearableModules.result?.moduleAttributions.some((module) =>
      module.featureKeys.includes("private-feature")
    ),
    false,
  );
  const publicReportFromLeakyResult = toPublicMurphAgeCalculatorReport({
    ...research,
    warnings: [{
      code: "MODEL_FEATURE_MISSING",
      featureKey: "private feature key",
      message: "private report warning",
      metricKey: "private metric key",
    }, {
      code: "MODEL_FEATURE_MISSING",
      featureKey: "private-model-feature",
      message: "private slug report warning",
      metricKey: "private-metric-key",
    }],
    result: research.result ? {
      ...research.result,
      featureAttributions: research.result.featureAttributions.map((feature) => ({
        ...feature,
        coefficient: 1,
        contributionLogit: 1,
        featureKey: "private feature key",
        label: "private artifact label",
        metricKey: "private metric key",
        moduleId: "private artifact module",
        prediction: 1,
        selectedPointIds: ["metric-point:private-row:0"],
        unit: "mg/dL",
        value: 1,
        warnings: [{
          code: "MODEL_FEATURE_MISSING",
          featureKey: "private feature key",
          message: "private artifact warning",
          metricKey: "private metric key",
        }],
      })),
      moduleAttributions: research.result.moduleAttributions.map((module) => ({
        ...module,
        coefficient: 1,
        contributionLogit: 1,
        featureKeys: ["private feature key", "private-model-feature", ...module.featureKeys],
        moduleId: "private artifact module",
      })),
      modelId: "private artifact model id",
      modelVersion: "private artifact model version",
      risk: {
        ...research.result.risk!,
        endpoint: "private artifact endpoint",
        referencePopulation: "private artifact reference population",
      },
      warnings: [{
        code: "MODEL_FEATURE_MISSING",
        featureKey: "private feature key",
        message: "private artifact warning",
        metricKey: "private metric key",
      }],
    } : null,
  });
  for (const forbiddenFeatureKey of [
    "selectedPointIds",
    "value",
    "unit",
    "prediction",
    "coefficient",
    "contributionLogit",
  ]) {
    assert.equal(
      publicReportFromLeakyResult.result?.featureAttributions.some((feature) => forbiddenFeatureKey in feature),
      false,
    );
  }
  assert.equal(
    publicReportFromLeakyResult.result?.moduleAttributions.some((module) => "contributionLogit" in module),
    false,
  );
  assert.equal(publicReportFromLeakyResult.result ? "modelId" in publicReportFromLeakyResult.result : true, false);
  assert.equal(publicReportFromLeakyResult.result?.risk ? "endpoint" in publicReportFromLeakyResult.result.risk : true, false);
  assert.equal(publicReportFromLeakyResult.result?.featureAttributions[0]?.featureKey, "metric-feature");
  assert.equal(publicReportFromLeakyResult.result?.featureAttributions[0]?.metricKey, null);
  assert.equal(publicReportFromLeakyResult.result?.featureAttributions[0]?.moduleId, "unknown");
  assert.equal(publicReportFromLeakyResult.result?.featureAttributions[0]?.warnings[0]?.code, "MODEL_FEATURE_MISSING");
  assert.equal(
    publicReportFromLeakyResult.result?.featureAttributions[0]?.warnings.some((warning) => "message" in warning),
    false,
  );
  assert.equal(publicReportFromLeakyResult.warnings[0]?.code, "MODEL_FEATURE_MISSING");
  assert.equal(publicReportFromLeakyResult.warnings.some((warning) => "message" in warning), false);
  assert.equal(publicReportFromLeakyResult.warnings.some((warning) => warning.featureKey === "private-model-feature"), false);
  assert.equal(publicReportFromLeakyResult.warnings.some((warning) => warning.featureKey === "model-feature"), true);
  assert.equal(publicReportFromLeakyResult.warnings.some((warning) => "metricKey" in warning), false);
  assert.equal(publicReportFromLeakyResult.result?.moduleAttributions[0]?.moduleId, "unknown");
  assert.equal(
    publicReportFromLeakyResult.result?.moduleAttributions.some((module) =>
      module.featureKeys.includes("private-model-feature")
    ),
    false,
  );
  const productDefaultReport = toPublicMurphAgeCalculatorReport(productDefault);
  const productDefaultView = buildMurphAgePublicCalculatorView(productDefaultReport);
  assert.equal(productDefaultReport.status, "abstain");
  assert.equal(productDefaultReport.result, null);
  assert.equal(productDefaultReport.wearableResidualLayer, null);
  assert.equal(productDefaultView.displayCategory, "abstain");
  assert.equal(productDefaultView.selectedCardId, null);
  assert.equal(productDefaultView.ageEstimate, null);
  assert.equal(productDefaultView.risk.probability, null);
  assert.equal(productDefaultView.wearableResidualLayer, null);
  assert.equal(productDefaultView.featureContributions.length, 0);
  assert.equal(productDefaultView.domainContributions.length, 0);
  assert.equal(productDefaultView.scoreReadiness.status, "validation-pending");
  assert.equal(productDefaultView.scoreReadiness.biologicalAgeAvailable, false);
  assert.equal(productDefaultView.scoreReadiness.riskAvailable, false);
  assert.equal(productDefaultView.scoreReadiness.inputBundleId, "lab9-bp-body");
  assert.equal(productDefaultView.scoreReadiness.contextBundleIds.includes("wearable-context"), true);
  assert.equal(productDefaultView.scoreReadiness.scoreBearingFeatureCount > 0, true);
  assert.equal(
    productDefaultView.scoreReadiness.unlockRequirements.includes("external-outcome-validation"),
    true,
  );
  assert.equal(
    productDefaultView.scoreReadiness.unlockRequirements.includes("product-policy-authorization"),
    true,
  );
  assert.equal(
    productDefaultView.scoreReadiness.unlockRequirements.includes("risk-to-age-display-authorization"),
    true,
  );
  assert.equal(
    productDefaultView.scoreReadiness.unlockRequirements.includes("validated-wearable-parameter-pack"),
    true,
  );
  assert.equal(productDefaultReport.inputReadiness.bundle.bundleId, "lab9-bp-body");
  assert.equal(productDefaultReport.inputReadiness.bundle.availableFeatureKeys.includes("glycemia"), true);
  assert.equal(productDefaultReport.inputReadiness.bundle.selectedMetricKeys.includes("hba1c"), true);
  assert.equal(productDefaultReport.inputReadiness.bundle.selectedMetricKeys.includes("steps"), false);
  assert.equal(productDefaultReport.inputReadiness.contextBundles[0]?.bundleId, "wearable-context");
  assert.equal(productDefaultReport.inputReadiness.contextBundles[0]?.selectedMetricKeys.includes("steps"), true);
  const productDefaultReadinessJson = JSON.stringify(productDefaultReport.inputReadiness);
  for (const forbidden of [
    "selectedPointIds",
    "metric-point:",
    "\"value\"",
    "\"unit\"",
    "\"label\"",
    "\"message\"",
    "\"path\"",
    "coefficient",
    "contributionLogit",
    "contributionYears",
    "prediction",
  ]) {
    assert.equal(productDefaultReadinessJson.includes(forbidden), false, forbidden);
  }
  assert.equal(productDefaultReport.displaySummary.displayStatus, "abstain");
  assert.equal(productDefaultReport.displaySummary.displayBlockedReason, "product-not-authorized");
  assert.equal(productDefaultReport.displaySummary.validationGate?.status, "blocked");
  assert.equal(
    productDefaultReport.displaySummary.productPromotionBlockers.includes("PRODUCT_PROMOTION_EVIDENCE_MISSING"),
    true,
  );
  assert.deepEqual(productDefaultReport.displaySummary.outcomeContext, {
    ageEstimateBasis: "risk-age-equivalent",
    horizonYears: 10,
    riskEndpoint: "all-cause-mortality",
  });
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
  const productRiskOnlyReport = toPublicMurphAgeCalculatorReport({
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
  const productRiskOnlyView = buildMurphAgePublicCalculatorView(productRiskOnlyReport);
  assert.equal(productRiskOnlyView.displayCategory, "product-risk-only");
  assert.equal(productRiskOnlyView.risk.probability, productRiskOnlyReport.result?.risk?.probability);
  assert.equal(productRiskOnlyView.ageEstimate, null);
  assert.equal(productRiskOnlyView.featureContributions.length, 0);
  assert.equal(productRiskOnlyView.domainContributions.length, 0);
  assert.equal(productRiskOnlyView.selectedCardId, productRiskOnlyReport.authorization.cardId);
  assert.equal(productRiskOnlyView.scoreReadiness.status, "validated-risk-only");
  assert.equal(productRiskOnlyView.scoreReadiness.riskAvailable, true);
  assert.equal(productRiskOnlyView.scoreReadiness.biologicalAgeAvailable, false);
  assert.deepEqual(productRiskOnlyView.scoreReadiness.unlockRequirements, ["risk-to-age-display-authorization"]);

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
  const productAgeReadyReport = toPublicMurphAgeCalculatorReport({
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
  const productAgeReadyView = buildMurphAgePublicCalculatorView(productAgeReadyReport);
  assert.equal(productAgeReadyView.displayCategory, "product-age-ready");
  assert.equal(productAgeReadyView.ageEstimate?.biologicalAgeYears, productAgeReadyReport.result?.biologicalAgeYears);
  assert.equal(productAgeReadyView.risk.probability, productAgeReadyReport.result?.risk?.probability);
  assert.equal(productAgeReadyView.featureContributions.some((feature) => feature.metricKey === "hba1c"), true);
  assert.equal(productAgeReadyView.domainContributions.some((module) => module.moduleId === "metabolic"), true);
  assert.equal(productAgeReadyView.scoreReadiness.status, "validated-age-ready");
  assert.equal(productAgeReadyView.scoreReadiness.riskAvailable, true);
  assert.equal(productAgeReadyView.scoreReadiness.biologicalAgeAvailable, true);
  assert.deepEqual(productAgeReadyView.scoreReadiness.unlockRequirements, []);
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
  assert.equal(lab5WithoutModel.bundleAssessment.bundleId, "l1b-glycemia-body");
  assert.equal(lab5WithoutModel.cardPolicy?.cardId, "l1b_glycemia_body_10y_acm_research");
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

  const submittedScoreSnapshot = (report: ReturnType<typeof calculateMurphAgePublicReportFromSubmittedInputs>) => ({
    ageDeltaYears: report.result?.ageDeltaYears,
    biologicalAgeYears: report.result?.biologicalAgeYears,
    cardId: report.result?.authorization.cardId,
    displayStatus: report.displaySummary.displayStatus,
    featureAttributions: report.result?.featureAttributions.map((feature) => ({
      contributionYears: feature.contributionYears,
      featureKey: feature.featureKey,
      metricKey: feature.metricKey,
      moduleId: feature.moduleId,
      status: feature.status,
      warnings: feature.warnings,
    })),
    moduleAttributions: report.result?.moduleAttributions,
    riskProbability: report.result?.risk?.probability,
    selectedScoreBearingFeatureKeys: report.displaySummary.selectedScoreBearingFeatureKeys,
    selectedScoreBearingMetricKeys: report.displaySummary.selectedScoreBearingMetricKeys,
    status: report.status,
  });
  const submittedLab5Metrics = [
    { metricKey: "HbA1c", unit: "%", value: 5.4 },
    { metricKey: "glucose", unit: "mg/dL", value: 92 },
    { metricKey: "HDL_C", unit: "mg/dL", value: 58 },
    { metricKey: "Triglycerides", unit: "mg/dL", value: 95 },
    { metricKey: "creatinine", unit: "mg/dL", value: 0.82 },
    { metricKey: "egfr", unit: "mL/min/1.73m^2", value: 95 },
    { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
  ];
  const submittedWearableMetrics = [
    { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 9_800 },
    { metricKey: "activity-minutes", sourceKind: "wearable-summary", unit: "minutes", value: 56 },
    { metricKey: "mvpa-minutes", sourceKind: "wearable-summary", unit: "minutes", value: 34 },
    { metricKey: "sedentary-minutes", sourceKind: "wearable-summary", unit: "minutes", value: 490 },
    { metricKey: "resting-heart-rate", sourceKind: "wearable-summary", unit: "bpm", value: 58 },
    { metricKey: "hrv-rmssd", sourceKind: "wearable-summary", unit: "ms", value: 62 },
    { metricKey: "total-sleep-minutes", sourceKind: "wearable-summary", unit: "minutes", value: 455 },
    { metricKey: "deep-sleep-minutes", sourceKind: "sleep-summary", unit: "minutes", value: 82 },
    { metricKey: "rem-sleep-minutes", sourceKind: "sleep-summary", unit: "minutes", value: 96 },
    { metricKey: "sleep-efficiency", sourceKind: "wearable-summary", unit: "percent", value: 88 },
    { metricKey: "sleep-regularity-score", sourceKind: "wearable-summary", unit: "score", value: 84 },
    { metricKey: "sleep-score", sourceKind: "sleep-summary", unit: "score", value: 82 },
    { metricKey: "spo2", sourceKind: "sleep-summary", unit: "percent", value: 97 },
    { metricKey: "respiratory-rate", sourceKind: "sleep-summary", unit: "breaths/min", value: 14.2 },
    { metricKey: "sleep-duration-variability-minutes", sourceKind: "wearable-summary", unit: "minutes", value: 39 },
    { metricKey: "readiness-score", sourceKind: "wearable-summary", unit: "score", value: 78 },
    { metricKey: "skin-temperature-deviation", sourceKind: "wearable-summary", unit: "degC", value: 0.1 },
    { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
    { metricKey: "wearable_valid_night_count_28d", sourceKind: "wearable-summary", unit: "count", value: 22 },
    { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.86 },
  ];
  const submittedLab5OnlyReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: submittedLab5Metrics,
  });
  const submittedLab5WithWearablesReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: [...submittedLab5Metrics, ...submittedWearableMetrics],
  });

  assert.equal(submittedLab5OnlyReport.status, "ready");
  assert.equal(submittedLab5WithWearablesReport.status, "ready");
  assert.deepEqual(submittedScoreSnapshot(submittedLab5WithWearablesReport), submittedScoreSnapshot(submittedLab5OnlyReport));
  assert.equal(submittedLab5OnlyReport.displaySummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), false);
  assert.equal(submittedLab5WithWearablesReport.displaySummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(
    submittedLab5WithWearablesReport.inputReadiness.contextBundles[0]?.selectedMetricKeys.includes("steps"),
    true,
  );
  assert.equal(
    submittedLab5WithWearablesReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"),
    false,
  );

  const submittedAliasWearableMetrics = [
    { metricKey: "steps_per_day", unit: "count", value: 9_800 },
    { metricKey: "active_minutes", unit: "minutes", value: 56 },
    { metricKey: "resting_hr", unit: "bpm", value: 58 },
    { metricKey: "hrv_rmssd", unit: "ms", value: 62 },
    { metricKey: "sleep_duration_hours", value: 7.5 },
    { metricKey: "sleep_midpoint_variability", unit: "minutes", value: 39 },
    { metricKey: "wearable_valid_day_count_28d", unit: "count", value: 24 },
    { metricKey: "wearable_valid_night_count_28d", unit: "count", value: 22 },
    { metricKey: "wearable_coverage_index", unit: "score", value: 0.86 },
  ];
  // Synthetic fixture pack only; the registered route exercises contract validation without carrying real coefficients.
  const aliasWearableResidualPack = {
    anchorCardId: "lab5_bp_bmi_transport_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "provisional-local-research",
    family: "activity",
    featureWeights: [
      {
        center: 8_000,
        coefficient: -0.08,
        metricKey: "steps",
        scale: 2_000,
        transform: "center-scale",
      },
      {
        center: 45,
        coefficient: -0.02,
        metricKey: "activity-minutes",
        scale: 30,
        transform: "center-scale",
      },
    ],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId: "activity-residual-v1",
    packHash: `sha256:${"c".repeat(64)}`,
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  } satisfies MurphAgeWearableResidualParameterPack;
  const aliasSleepWearableResidualPack = {
    anchorCardId: "lab5_bp_bmi_transport_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "provisional-local-research",
    family: "sleep",
    featureWeights: [
      {
        center: 420,
        coefficient: -0.04,
        metricKey: "total-sleep-minutes",
        scale: 30,
        transform: "center-scale",
      },
    ],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId: "sleep-residual-v1",
    packHash: `sha256:${"d".repeat(64)}`,
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  } satisfies MurphAgeWearableResidualParameterPack;
  const submittedAliasWearablesReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: [...submittedLab5Metrics, ...submittedAliasWearableMetrics],
    wearableResidualParameterPacks: [aliasWearableResidualPack, aliasSleepWearableResidualPack],
  });

  assert.equal(submittedAliasWearablesReport.status, "ready");
  assert.equal(submittedAliasWearablesReport.displaySummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(submittedAliasWearablesReport.displaySummary.wearableBridge.readyFeatureKeys.includes("resting-heart-rate"), true);
  assert.equal(submittedAliasWearablesReport.displaySummary.wearableBridge.readyFeatureKeys.includes("hrv-rmssd"), true);
  assert.equal(submittedAliasWearablesReport.displaySummary.contextOnlyFeatureKeys.includes("total-sleep-minutes"), true);
  assert.equal(submittedAliasWearablesReport.displaySummary.wearableBridge.readyFeatureKeys.includes("sleep-duration-regularity"), true);
  assert.equal(
    submittedAliasWearablesReport.inputReadiness.contextBundles[0]?.selectedMetricKeys.includes("activity-minutes"),
    true,
  );
  assert.equal(
    submittedAliasWearablesReport.inputReadiness.contextBundles[0]?.selectedMetricKeys.includes("total-sleep-minutes"),
    true,
  );
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.residualDeltaLogit, -0.119333);
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.selectedMetricKeys.includes("steps"), true);
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.selectedMetricKeys.includes("activity-minutes"), true);
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.selectedMetricKeys.includes("total-sleep-minutes"), true);
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.productAuthorized, false);
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.scoreBearing, false);
  assert.equal(submittedAliasWearablesReport.wearableResidualLayer?.scoreContributionAuthorized, false);

  const submittedLab9Metrics = [
    { metricKey: "albumin", unit: "g/dL", value: 4.4 },
    { metricKey: "egfr", unit: "mL/min/1.73m^2", value: 96 },
    { metricKey: "hba1c", unit: "%", value: 5.2 },
    { metricKey: "alkaline-phosphatase", unit: "U/L", value: 65 },
    { metricKey: "white-blood-cell-count", unit: "10^3/uL", value: 5.5 },
    { metricKey: "lymphocyte-percentage", unit: "%", value: 32 },
    { metricKey: "red-cell-distribution-width", unit: "%", value: 12.5 },
    { metricKey: "hdl-c", unit: "mg/dL", value: 58 },
    { metricKey: "triglycerides", unit: "mg/dL", value: 95 },
    { metricKey: "systolic-blood-pressure", sourceKind: "measurement", unit: "mmHg", value: 118 },
    { metricKey: "diastolic-blood-pressure", sourceKind: "measurement", unit: "mmHg", value: 72 },
    { metricKey: "bmi", sourceKind: "measurement", unit: "kg/m^2", value: 23.2 },
  ];
  const submittedLab9OnlyReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    submittedMetrics: submittedLab9Metrics,
  });
  const submittedLab9WithWearablesReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    submittedMetrics: [...submittedLab9Metrics, ...submittedWearableMetrics],
  });

  assert.equal(submittedLab9OnlyReport.status, "ready");
  assert.equal(submittedLab9WithWearablesReport.status, "ready");
  assert.deepEqual(submittedScoreSnapshot(submittedLab9WithWearablesReport), submittedScoreSnapshot(submittedLab9OnlyReport));
  assert.equal(submittedLab9WithWearablesReport.result?.authorization.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(
    submittedLab9WithWearablesReport.result?.featureAttributions.some((feature) =>
      feature.metricKey === "resting-heart-rate"
    ),
    false,
  );

  const submittedCalculatorViewBundle = buildMurphAgeSubmittedCalculatorViewBundle({
    asOf,
    chronologicalAgeYears: 45,
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    submittedMetrics: [...submittedLab9Metrics, ...submittedWearableMetrics],
  }, { includeResearchPreview: true });
  assert.equal(
    submittedCalculatorViewBundle.schemaVersion,
    MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION,
  );
  assert.deepEqual(
    submittedCalculatorViewBundle.inputBundleSpecs,
    listMurphAgeSubmittedCalculatorInputBundleSpecs(),
  );
  assert.deepEqual(
    submittedCalculatorViewBundle.metricInputSpecs,
    listMurphAgeSubmittedCalculatorMetricInputSpecs(),
  );
  assert.equal(
    submittedCalculatorViewBundle.inputBundleSpecs.some((spec) =>
      spec.bundleId === "wearable-context" && spec.scoreBearing === false
    ),
    true,
  );
  const submittedMetricSpecByKey = new Map(
    submittedCalculatorViewBundle.metricInputSpecs.map((spec) => [spec.metricKey, spec]),
  );
  assert.deepEqual(
    submittedMetricSpecByKey.get("hba1c")?.researchScoreBearingCardIds,
    [
      "l1b_glycemia_body_10y_acm_research",
      "lab9_bp_body_10y_acm_research",
      "lab5_bp_bmi_transport_research",
      "l1_tiny_glycemia_10y_acm_research",
    ],
  );
  assert.equal(
    submittedMetricSpecByKey.get("albumin")?.researchScoreBearingCardIds.includes(
      "lab9_bp_body_10y_acm_research",
    ),
    true,
  );
  assert.equal(
    submittedMetricSpecByKey.get("creatinine")?.researchScoreBearingCardIds.includes(
      "lab5_bp_bmi_transport_research",
    ),
    true,
  );
  assert.equal(
    submittedMetricSpecByKey.get("resting-heart-rate")?.calculatorRoles.includes(
      "wearable-context",
    ),
    true,
  );
  assert.equal(
    submittedMetricSpecByKey.get("resting-heart-rate")?.wearableScoreBearingAuthorized,
    false,
  );
  for (const spec of submittedCalculatorViewBundle.metricInputSpecs.filter((inputSpec) =>
    inputSpec.calculatorRoles.includes("wearable-context")
  )) {
    assert.deepEqual(spec.researchScoreBearingCardIds, []);
    assert.equal(spec.productScoreBearingAuthorized, false);
    assert.equal(spec.wearableScoreBearingAuthorized, false);
  }
  const submittedCalculatorCapabilities = submittedCalculatorViewBundle.capabilities;
  assert.equal(
    submittedCalculatorCapabilities.schemaVersion,
    MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
  );
  assert.deepEqual(submittedCalculatorCapabilities.acceptedSourceKinds, [
    "activity-summary",
    "measurement",
    "profile",
    "questionnaire",
    "sleep-summary",
    "survey-response",
    "test-result",
    "wearable-summary",
  ]);
  assert.deepEqual(submittedCalculatorCapabilities.acceptedUserInputFamilies, [
    "demographics-age-sex",
    "bloodwork-common-labs",
    "vitals-body-composition",
    "wearable-activity",
    "wearable-recovery-autonomic",
    "wearable-sleep",
  ]);
  assert.deepEqual(submittedCalculatorCapabilities.bundleIds, [
    "l1b-glycemia-body",
    "lab9-bp-body",
    "lab5-bp-bmi",
    "l1-glycemia",
    "r399-nhis-proxy-anchor",
    "wearable-context",
    "function-context",
  ]);
  assert.deepEqual(submittedCalculatorCapabilities.contextBundleIds, [
    "wearable-context",
    "function-context",
  ]);
  assert.deepEqual(submittedCalculatorCapabilities.researchAgeEstimateEligibleBundleIds, [
    "l1b-glycemia-body",
    "lab9-bp-body",
    "lab5-bp-bmi",
    "l1-glycemia",
    "r399-nhis-proxy-anchor",
  ]);
  assert.deepEqual(submittedCalculatorCapabilities.scoreBearingBundleIds, [
    "l1b-glycemia-body",
    "lab9-bp-body",
    "lab5-bp-bmi",
    "l1-glycemia",
    "r399-nhis-proxy-anchor",
  ]);
  assert.deepEqual(submittedCalculatorCapabilities.runtimeInputKeys, [
    "chronological-age-years",
    "sex",
  ]);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("hba1c"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("steps"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("total-sleep-minutes"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("sleep-score"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("deep-sleep-minutes"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("rem-sleep-minutes"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("spo2"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("respiratory-rate"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("readiness-score"), true);
  assert.equal(submittedCalculatorCapabilities.acceptedMetricKeys.includes("skin-temperature-deviation"), true);
  assert.equal(submittedCalculatorCapabilities.researchScoreBearingMetricKeys.includes("albumin"), true);
  assert.equal(submittedCalculatorCapabilities.researchScoreBearingMetricKeys.includes("hba1c"), true);
  assert.deepEqual(submittedCalculatorCapabilities.productScoreBearingMetricKeys, []);
  assert.equal(submittedCalculatorCapabilities.researchPreviewSupported, true);
  assert.equal(submittedCalculatorCapabilities.productAgeDisplayAuthorized, false);
  assert.equal(submittedCalculatorCapabilities.productRiskDisplayAuthorized, false);
  assert.equal(submittedCalculatorCapabilities.wearableContextMetricKeys.includes("steps"), true);
  assert.equal(submittedCalculatorCapabilities.wearableContextMetricKeys.includes("hrv-rmssd"), true);
  assert.equal(submittedCalculatorCapabilities.wearableContextMetricKeys.includes("respiratory-rate"), true);
  assert.equal(submittedCalculatorCapabilities.wearableContextMetricKeys.includes("skin-temperature-deviation"), true);
  assert.equal(
    submittedCalculatorCapabilities.wearableFirstPriorityFeatureKeys.includes("activity-volume"),
    true,
  );
  assert.equal(
    submittedCalculatorCapabilities.wearableSecondPriorityFeatureKeys.includes("resting-heart-rate"),
    true,
  );
  assert.deepEqual(submittedCalculatorCapabilities.wearableScoreBearingMetricKeys, []);
  assert.deepEqual(submittedCalculatorCapabilities.outputBoundary, {
    modelParametersExportAllowed: false,
    participantLevelExportAllowed: false,
    productScoreDisplayAuthorized: false,
    researchPreviewRequiresExplicitOptIn: true,
    rowValuesExportAllowed: false,
    submittedMetricScalarEchoAllowed: false,
  });
  assert.equal(submittedCalculatorViewBundle.product.report.mode, "product");
  assert.equal(submittedCalculatorViewBundle.product.view.ageEstimate, null);
  assert.equal(submittedCalculatorViewBundle.product.view.risk.probability, null);
  assert.equal(submittedCalculatorViewBundle.product.view.selectedCardId, null);
  assert.equal(submittedCalculatorViewBundle.product.view.scoreReadiness.status, "validation-pending");
  assert.ok(submittedCalculatorViewBundle.researchPreview);
  assert.equal(submittedCalculatorViewBundle.researchPreview.report.mode, "research");
  assert.equal(
    submittedCalculatorViewBundle.researchPreview.view.selectedCardId,
    "lab9_bp_body_10y_acm_research",
  );
  assert.equal(
    typeof submittedCalculatorViewBundle.researchPreview.view.ageEstimate?.biologicalAgeYears,
    "number",
  );
  assert.equal(submittedCalculatorViewBundle.researchPreview.view.wearable.scoreBearing, false);
  assert.equal(
    submittedCalculatorViewBundle.researchPreview.view.wearable.readyFeatureKeys.includes("activity-volume"),
    true,
  );
  const submittedCalculatorProductOnlyBundle = buildMurphAgeSubmittedCalculatorViewBundle({
    asOf,
    chronologicalAgeYears: 45,
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    submittedMetrics: [...submittedLab9Metrics, ...submittedWearableMetrics],
  });
  assert.equal(submittedCalculatorProductOnlyBundle.researchPreview, null);
  const submittedCalculatorViewBundleJson = JSON.stringify(submittedCalculatorViewBundle);
  for (const forbidden of [
    "\"value\"",
    "\"unit\"",
    "\"label\"",
    "coefficient",
    "contributionLogit",
    "metric-point:",
    "prediction",
  ]) {
    assert.equal(submittedCalculatorViewBundleJson.includes(forbidden), false, forbidden);
  }

  const submittedLab9InputsWithBothResearchCardsReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: {
      lab5_bp_bmi_transport_research: fixtureLab5ResearchModel(),
      lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel(),
    },
    sex: "female",
    submittedMetrics: [
      ...submittedLab9Metrics,
      { metricKey: "glucose", unit: "mg/dL", value: 92 },
      ...submittedWearableMetrics,
    ],
  });

  assert.equal(submittedLab9InputsWithBothResearchCardsReport.status, "ready");
  assert.equal(
    submittedLab9InputsWithBothResearchCardsReport.result?.authorization.cardId,
    "lab9_bp_body_10y_acm_research",
  );

  const submittedLab9InputsWithOnlyLab5RunnableReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: [
      ...submittedLab9Metrics,
      { metricKey: "glucose", unit: "mg/dL", value: 92 },
      ...submittedWearableMetrics,
    ],
  });

  assert.equal(submittedLab9InputsWithOnlyLab5RunnableReport.status, "ready");
  assert.equal(submittedLab9InputsWithOnlyLab5RunnableReport.inputReadiness.bundle.bundleId, "lab5-bp-bmi");
  assert.equal(
    submittedLab9InputsWithOnlyLab5RunnableReport.result?.authorization.cardId,
    "lab5_bp_bmi_transport_research",
  );
  assert.equal(
    submittedLab9InputsWithOnlyLab5RunnableReport.researchCandidateCards.find((candidate) =>
      candidate.cardId === "lab9_bp_body_10y_acm_research"
    )?.selected,
    false,
  );
  const runnableFallbackLab5Candidate = submittedLab9InputsWithOnlyLab5RunnableReport.researchCandidateCards.find(
    (candidate) => candidate.cardId === "lab5_bp_bmi_transport_research",
  );
  assert.ok(runnableFallbackLab5Candidate);
  assert.equal(runnableFallbackLab5Candidate.selected, true);
  assert.equal(runnableFallbackLab5Candidate.modelLoaded, true);

  const lab9ModelWithMissingRequiredFeature: MurphAgeRiskModel = {
    ...fixtureLab9ResearchModel(),
    features: [
      ...fixtureLab9ResearchModel().features,
      {
        coefficient: 0.03,
        expectedUnit: "ng/mL",
        key: "ferritin",
        kind: "metric",
        label: "Ferritin",
        metricKey: "ferritin",
        moduleId: "inflammatory",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 80, standardDeviation: 40 },
      },
    ],
  };
  const submittedLab9InputsWithUnrunnableLab9ModelReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: {
      lab5_bp_bmi_transport_research: fixtureLab5ResearchModel(),
      lab9_bp_body_10y_acm_research: lab9ModelWithMissingRequiredFeature,
    },
    sex: "female",
    submittedMetrics: [
      ...submittedLab9Metrics,
      { metricKey: "glucose", unit: "mg/dL", value: 92 },
      ...submittedWearableMetrics,
    ],
  });

  assert.equal(submittedLab9InputsWithUnrunnableLab9ModelReport.status, "ready");
  assert.equal(
    submittedLab9InputsWithUnrunnableLab9ModelReport.result?.authorization.cardId,
    "lab5_bp_bmi_transport_research",
  );
  const unrunnableLab9Candidate = submittedLab9InputsWithUnrunnableLab9ModelReport.researchCandidateCards.find(
    (candidate) => candidate.cardId === "lab9_bp_body_10y_acm_research",
  );
  assert.ok(unrunnableLab9Candidate);
  assert.equal(unrunnableLab9Candidate.modelLoaded, true);
  assert.equal(unrunnableLab9Candidate.selected, false);
  const unrunnableLab9Arbiter = buildMurphAgeResearchCalculatorView(
    submittedLab9InputsWithUnrunnableLab9ModelReport,
  ).arbiter;
  const unrunnableLab9ArbiterCandidate = unrunnableLab9Arbiter.candidateCards.find((candidate) =>
    candidate.cardId === "lab9_bp_body_10y_acm_research"
  );
  assert.ok(unrunnableLab9ArbiterCandidate);
  assert.equal(unrunnableLab9ArbiterCandidate.readyForResearchRun, false);
  const fallbackLab5ArbiterCandidate = unrunnableLab9Arbiter.candidateCards.find((candidate) =>
    candidate.cardId === "lab5_bp_bmi_transport_research"
  );
  assert.ok(fallbackLab5ArbiterCandidate);
  assert.equal(fallbackLab5ArbiterCandidate.selected, true);
  assert.equal(fallbackLab5ArbiterCandidate.readyForResearchRun, true);

  const explicitlySelectedButUnscoredLab9Report = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    cardId: "lab9_bp_body_10y_acm_research",
    chronologicalAgeYears: 45,
    mode: "research",
    models: {},
    sex: "female",
    submittedMetrics: [
      ...submittedLab9Metrics,
      ...submittedWearableMetrics,
    ],
  });
  assert.equal(explicitlySelectedButUnscoredLab9Report.result, null);
  const explicitlySelectedButUnscoredLab9View = buildMurphAgeResearchCalculatorView(
    explicitlySelectedButUnscoredLab9Report,
  );
  assert.equal(explicitlySelectedButUnscoredLab9View.arbiter.selectedCardRole, "primary-lab-bp-body-adjuster");
  assert.equal(explicitlySelectedButUnscoredLab9View.arbiter.selectionReason, "primary-lab-card-selected");
  const explicitlySelectedButUnscoredLab9Candidate = explicitlySelectedButUnscoredLab9View.arbiter.candidateCards.find(
    (candidate) => candidate.cardId === "lab9_bp_body_10y_acm_research",
  );
  assert.ok(explicitlySelectedButUnscoredLab9Candidate);
  assert.equal(explicitlySelectedButUnscoredLab9Candidate.selected, true);
  assert.equal(explicitlySelectedButUnscoredLab9Candidate.readyForResearchRun, false);

  const explicitLab5SensitivityWithFullLab9Inputs = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "lab5_bp_bmi_transport_research",
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    points: [...lab9WithWearableContextPoints, labMetricPoint("glucose", "mg/dL", 92)],
    sex: "female",
  });

  assert.equal(explicitLab5SensitivityWithFullLab9Inputs.status, "ready");
  assert.equal(explicitLab5SensitivityWithFullLab9Inputs.bundleAssessment.bundleId, "lab5-bp-bmi");
  assert.equal(explicitLab5SensitivityWithFullLab9Inputs.cardPolicy?.cardId, "lab5_bp_bmi_transport_research");
  assert.equal(explicitLab5SensitivityWithFullLab9Inputs.result?.modelId, "fixture-lab5-research-card-model");
  assert.equal(
    explicitLab5SensitivityWithFullLab9Inputs.warnings.some((warning) =>
      warning.code === "MODEL_CARD_POLICY_VIOLATION"
    ),
    false,
  );
  assert.equal(
    explicitLab5SensitivityWithFullLab9Inputs.result?.featureAttributions.some((feature) =>
      feature.metricKey === "albumin"
    ),
    false,
  );

  const submittedLab5Report = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: [
      { metricKey: "HbA1c", unit: "%", value: 5.4 },
      { metricKey: "glucose", unit: "mg/dL", value: 92 },
      { metricKey: "HDL_C", unit: "mg/dL", value: 58 },
      { metricKey: "Triglycerides", unit: "mg/dL", value: 95 },
      { metricKey: "creatinine", unit: "mg/dL", value: 0.82 },
      { metricKey: "egfr", unit: "mL/min/1.73m^2", value: 95 },
      { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
      { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 9_800 },
      { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
      { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.86 },
      { metricKey: "private metric", unit: "count", value: 1 },
    ],
  });

  assert.equal(submittedLab5Report.status, "ready");
  assert.equal(submittedLab5Report.mode, "research");
  assert.equal(submittedLab5Report.displaySummary.displayStatus, "research-only");
  assert.equal(submittedLab5Report.result?.authorization.cardId, "lab5_bp_bmi_transport_research");
  assert.equal(submittedLab5Report.result?.featureAttributions.some((feature) => feature.metricKey === "glucose"), true);
  assert.equal(submittedLab5Report.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  assert.equal(submittedLab5Report.displaySummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(submittedLab5Report.warnings.some((warning) => warning.code === "INVALID_INPUT"), true);
  assert.equal(JSON.stringify(submittedLab5Report).includes("private metric"), false);
  assert.equal(JSON.stringify(submittedLab5Report).includes("metric-point:"), false);
  assert.equal(JSON.stringify(submittedLab5Report).includes("\"value\""), false);
  const submittedLab5View = buildMurphAgePublicCalculatorView(submittedLab5Report);
  assert.equal(submittedLab5View.schemaVersion, MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION);
  assert.equal(submittedLab5View.status, "ready");
  assert.equal(submittedLab5View.mode, "research");
  assert.equal(submittedLab5View.displayCategory, "research-preview");
  assert.equal(submittedLab5View.displayStatus, "research-only");
  assert.equal(submittedLab5View.displayBlockedReason, "product-not-authorized");
  assert.equal(submittedLab5View.selectedCardId, null);
  assert.equal(submittedLab5View.product.ageDisplayReady, false);
  assert.equal(submittedLab5View.product.riskDisplayReady, false);
  assert.equal(submittedLab5View.scoreReadiness.status, "research-estimate-withheld");
  assert.equal(submittedLab5View.scoreReadiness.inputBundleId, "lab5-bp-bmi");
  assert.equal(submittedLab5View.scoreReadiness.riskAvailable, false);
  assert.equal(submittedLab5View.scoreReadiness.biologicalAgeAvailable, false);
  assert.equal(
    submittedLab5View.scoreReadiness.unlockRequirements.includes("external-outcome-validation"),
    true,
  );
  assert.equal(
    submittedLab5View.scoreReadiness.unlockRequirements.includes("validated-wearable-parameter-pack"),
    true,
  );
  assert.equal(
    submittedLab5View.product.promotionBlockers.includes("PRODUCT_PROMOTION_EVIDENCE_MISSING"),
    true,
  );
  assert.equal(submittedLab5View.ageEstimate, null);
  assert.equal(submittedLab5View.risk.probability, null);
  assert.equal(submittedLab5View.risk.horizonYears, 10);
  assert.equal(submittedLab5View.risk.riskEndpoint, "all-cause-mortality");
  assert.deepEqual(submittedLab5View.selectedScoreBearingMetricKeys, []);
  assert.equal(submittedLab5View.wearable.scoreBearing, false);
  assert.equal(submittedLab5View.wearable.scoreContributionAuthorized, false);
  assert.equal(submittedLab5View.wearable.quality, "usable-context");
  assert.equal(submittedLab5View.wearable.candidateFeatureCount, 9);
  assert.equal(submittedLab5View.wearable.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(submittedLab5View.wearable.firstPriorityReadyFeatureKeys.includes("activity-volume"), true);
  assert.equal(submittedLab5View.wearable.firstPriorityIncompleteFeatureKeys.includes("sedentary-time"), true);
  assert.equal(submittedLab5View.wearable.secondPriorityIncompleteFeatureKeys.includes("resting-heart-rate"), true);
  assert.equal(submittedLab5View.wearable.deferredFeatureKeys.includes("hrv-rmssd"), true);
  assert.equal(
    submittedLab5View.wearable.features.find((feature) => feature.featureKey === "activity-volume")?.qualityReady,
    true,
  );
  assert.equal(submittedLab5View.wearable.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(submittedLab5View.featureContributions.length, 0);
  assert.equal(submittedLab5View.featureDrivers.older.length, 0);
  assert.equal(submittedLab5View.featureDrivers.younger.length, 0);
  assert.equal(submittedLab5View.featureDrivers.neutral.length, 0);
  assert.equal(submittedLab5View.domainContributions.length, 0);
  const submittedLab5ResearchView = buildMurphAgeResearchCalculatorView(submittedLab5Report);
  const submittedLab5ResearchViewJson = JSON.stringify(submittedLab5ResearchView);
  assert.equal(submittedLab5ResearchView.schemaVersion, MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION);
  assert.equal(submittedLab5ResearchView.researchOnly, true);
  assert.equal(submittedLab5ResearchView.product.productUseAuthorized, false);
  assert.equal(submittedLab5ResearchView.displayStatus, "research-only");
  assert.equal(submittedLab5ResearchView.selectedCardId, "lab5_bp_bmi_transport_research");
  assert.equal(
    submittedLab5ResearchView.arbiter.strategy,
    "r399-anchor-l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-function-sidecar-wearables-context",
  );
  assert.equal(
    submittedLab5ResearchView.arbiter.labConflictPolicy,
    "l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-guard-r399-anchor-fallback",
  );
  assert.equal(submittedLab5ResearchView.arbiter.wearableScorePolicy, "context-only-not-score-bearing");
  assert.equal(submittedLab5ResearchView.arbiter.selectedCardRole, "transport-fallback-and-discordance-guard");
  assert.equal(submittedLab5ResearchView.arbiter.selectionReason, "transport-fallback-selected");
  const submittedLab5ResearchArbiterCandidate = submittedLab5ResearchView.arbiter.candidateCards.find(
    (candidate) => candidate.cardId === "lab5_bp_bmi_transport_research",
  );
  assert.ok(submittedLab5ResearchArbiterCandidate);
  assert.equal(submittedLab5ResearchArbiterCandidate.role, "transport-fallback-and-discordance-guard");
  assert.equal(submittedLab5ResearchArbiterCandidate.readyForResearchRun, true);
  assert.equal(submittedLab5ResearchArbiterCandidate.selected, true);

  const contaminatedSubmittedLab5Report = structuredClone(submittedLab5Report);
  Object.assign(contaminatedSubmittedLab5Report.researchCandidateCards[1] ?? {}, {
    coefficient: 1.23,
    label: "private-value-label",
    path: "<PRIVATE_PATH>",
    prediction: 0.45,
    selectedPointIds: ["private-point-id"],
    unit: "secret-unit",
    value: 5.67,
  });
  const contaminatedSubmittedLab5ArbiterJson = JSON.stringify(
    buildMurphAgeResearchCalculatorView(contaminatedSubmittedLab5Report).arbiter,
  );
  for (const forbidden of [
    "private-point-id",
    "private-value-label",
    "<PRIVATE_PATH>",
    "secret-unit",
    "coefficient",
    "prediction",
    "\"value\"",
  ]) {
    assert.equal(contaminatedSubmittedLab5ArbiterJson.includes(forbidden), false, forbidden);
  }
  assert.equal(submittedLab5ResearchView.model.currentModelFamily, "frozen-nhis-r399-plus-research-increments");
  assert.deepEqual(submittedLab5ResearchView.model.composition, {
    anchorLayerStatus: "available-as-research-anchor-and-fallback-not-layered",
    currentScoringMode: "single-selected-research-card",
    labBodyStatus: "selected-card-score-not-additive-increment",
    nextArchitectureStep: "parameterize-function-sidecar-for-layered-scoring",
    wearableStatus: "context-only-zero-product-multiplier",
  });
  assert.equal(
    submittedLab5ResearchView.model.layeredResearchPath.architecturePattern,
    "frozen-r399-anchor-plus-selected-lab-card-plus-function-and-wearable-residuals",
  );
  assert.equal(
    submittedLab5ResearchView.model.layeredResearchPath.currentExecutableMode,
    "single-card-research-score-layer-contracts-only",
  );
  assert.deepEqual(submittedLab5ResearchView.model.layeredResearchPath.layerOrder, [
    "r399-outcome-risk-anchor",
    "selected-lab-body-card",
    "function-disability-sidecar",
    "wearable-multi-family-residual",
  ]);
  assert.deepEqual(submittedLab5ResearchView.model.layeredResearchPath.activeResearchScoreLayerIds, [
    "selected-lab-body-card",
  ]);
  assert.deepEqual(submittedLab5ResearchView.model.layeredResearchPath.parameterPackBlockedLayerIds, [
    "function-disability-sidecar",
    "wearable-multi-family-residual",
  ]);
  assert.equal(submittedLab5ResearchView.model.layeredResearchPath.productAuthorized, false);
  const functionLayer = submittedLab5ResearchView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "function-disability-sidecar"
  );
  assert.ok(functionLayer);
  assert.equal(functionLayer.status, "parameter-pack-needed");
  assert.equal(functionLayer.parameterPackRequired, true);
  assert.equal(functionLayer.parameterPackAvailable, false);
  assert.equal(functionLayer.scoreBearingNow, false);
  assert.equal(functionLayer.scoreContributionAuthorized, false);
  assert.equal(functionLayer.sourceEvidenceIds.join("|"), "mhas-function-mobility-sidecar-local-run");
  assert.equal(
    functionLayer.metricKeys.join("|"),
    "adl-limitation-count|iadl-limitation-count|mobility-limitation-count|frailty-symptom-count",
  );
  const wearableActivityLayer = submittedLab5ResearchView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "wearable-multi-family-residual"
  );
  assert.ok(wearableActivityLayer);
  assert.equal(wearableActivityLayer.status, "validation-receipt-needed");
  assert.equal(wearableActivityLayer.parameterPackRequired, true);
  assert.equal(wearableActivityLayer.parameterPackAvailable, false);
  assert.equal(wearableActivityLayer.scoreBearingNow, false);
  assert.equal(wearableActivityLayer.metricKeys.includes("steps"), true);
  assert.equal(wearableActivityLayer.metricKeys.includes("total-sleep-minutes"), true);
  assert.equal(wearableActivityLayer.metricKeys.includes("resting-heart-rate"), true);
  assert.equal(wearableActivityLayer.metricKeys.includes("hrv-rmssd"), true);
  const selectedLabLayer = submittedLab5ResearchView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "selected-lab-body-card"
  );
  assert.ok(selectedLabLayer);
  assert.equal(selectedLabLayer.status, "active-research-score");
  assert.equal(selectedLabLayer.scoreBearingNow, true);
  assert.equal(selectedLabLayer.metricKeys.join("|"), "glucose|egfr|bmi");
  assert.equal(submittedLab5ResearchView.layeredAgeEstimate?.status, "selected-card-only");
  assert.equal(submittedLab5ResearchView.layeredAgeEstimate?.basis, "selected-card-risk-age");
  assert.deepEqual(submittedLab5ResearchView.layeredAgeEstimate?.appliedLayerIds, [
    "selected-lab-body-card",
  ]);
  assert.equal(
    submittedLab5ResearchView.layeredAgeEstimate?.biologicalAgeYears,
    submittedLab5ResearchView.ageEstimate?.biologicalAgeYears,
  );
  assert.equal(submittedLab5ResearchView.layeredAgeEstimate?.productAuthorized, false);
  assert.equal(submittedLab5ResearchView.layeredAgeEstimate?.residualScoreContributionAuthorized, false);
  assert.equal(submittedLab5ResearchView.layeredAgeEstimate?.uncertaintyStatus, "selected-card-interval");
  assert.equal(submittedLab5ResearchView.model.scoreInterpretation, "risk-age-equivalent-research-only");
  assert.equal(submittedLab5ResearchView.model.selectedResearchCardId, "lab5_bp_bmi_transport_research");
  assert.equal(submittedLab5ResearchView.model.productUseAuthorized, false);
  assert.equal(submittedLab5ResearchViewJson.includes("\"ageDisplayReady\":false"), true);
  assert.equal(submittedLab5ResearchViewJson.includes("\"riskDisplayReady\":false"), true);
  assert.equal(
    submittedLab5ResearchView.model.blockers.join("|"),
    "biomarker-transport-not-confirmed|wearable-increment-not-validated|product-use-not-authorized",
  );
  assert.equal(
    submittedLab5ResearchView.model.functionDisability.currentUse,
    "hardened-research-lead-sidecar-not-product-age",
  );
  assert.equal(
    submittedLab5ResearchView.model.functionDisability.nextAction,
    "parameterize-function-sidecar-for-layered-scoring-then-fresh-validation",
  );
  assert.equal(submittedLab5ResearchView.model.functionDisability.scoreBearing, false);
  assert.equal(submittedLab5ResearchView.model.labBody.currentUse, "score-bearing-research-when-selected");
  assert.equal(submittedLab5ResearchView.model.labBody.nextAction, "validate-transport-before-product-use");
  assert.equal(submittedLab5ResearchView.model.labBody.transportStatus, "internal-promising-transport-not-confirmed");
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidenceStatus,
    "mixed-research-only-no-product-promotion",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.map((item) => item.evidenceId).join("|"),
    "midus-lab-lift-local-run|creles-glycemia-transport-local-run|haalsi-glucose-transport-local-run|nshap-hba1c-transport-local-run|mhas-function-mobility-sidecar-local-run|sage-physiology-shadow-local-run|wearables-context-only-local-run",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "midus-lab-lift-local-run")?.signal,
    "weak",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "midus-lab-lift-local-run")?.supportedMetricKeys.join("|"),
    "glucose|egfr|bmi",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "creles-glycemia-transport-local-run")?.signal,
    "weak",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "creles-glycemia-transport-local-run")?.supportedMetricKeys.join("|"),
    "glucose",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "nshap-hba1c-transport-local-run")?.signal,
    "partial",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "nshap-hba1c-transport-local-run")?.supportedMetricKeys.join("|"),
    "hba1c",
  );
  const mhasFunctionSidecarEvidence = submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) =>
    item.evidenceId === "mhas-function-mobility-sidecar-local-run"
  );
  assert.ok(mhasFunctionSidecarEvidence);
  assert.equal(mhasFunctionSidecarEvidence.cohortLabel, "MHAS");
  assert.equal(mhasFunctionSidecarEvidence.bundleId, "function-context");
  assert.equal(mhasFunctionSidecarEvidence.sourceRouteId, "mhas-harmonized-aging");
  assert.equal(mhasFunctionSidecarEvidence.signal, "supported");
  assert.equal(mhasFunctionSidecarEvidence.scoringMathChanged, false);
  assert.equal(mhasFunctionSidecarEvidence.productAuthorizationChanged, false);
  assert.equal(
    mhasFunctionSidecarEvidence.supportedMetricKeys.join("|"),
    "adl-limitation-count|iadl-limitation-count|mobility-limitation-count|frailty-symptom-count",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.every((item) => item.scoringMathChanged === false),
    true,
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.every((item) => item.productAuthorizationChanged === false),
    true,
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "haalsi-glucose-transport-local-run")?.supportedMetricKeys.join("|"),
    "glucose",
  );
  const sagePhysiologyEvidence = submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) =>
    item.evidenceId === "sage-physiology-shadow-local-run"
  );
  assert.ok(sagePhysiologyEvidence);
  assert.equal(sagePhysiologyEvidence.cohortLabel, "SAGE");
  assert.equal(sagePhysiologyEvidence.sourceRouteId, "who-sage-south-africa-transport");
  assert.equal(sagePhysiologyEvidence.signal, "context-only");
  assert.equal(sagePhysiologyEvidence.scoringMathChanged, false);
  assert.equal(sagePhysiologyEvidence.productAuthorizationChanged, false);
  assert.equal(
    sagePhysiologyEvidence.supportedMetricKeys.join("|"),
    "bmi|systolic-blood-pressure|diastolic-blood-pressure|resting-heart-rate|activity-minutes|total-sleep-minutes",
  );
  assert.equal(
    submittedLab5ResearchView.model.latestLocalRunEvidence.find((item) => item.evidenceId === "wearables-context-only-local-run")?.signal,
    "context-only",
  );
  assert.equal(submittedLab5ResearchView.model.researchAppliedFeatureKeys.join("|"), "glucose|egfr|bmi");
  assert.equal(submittedLab5ResearchView.model.researchAppliedMetricKeys.join("|"), "glucose|egfr|bmi");
  assert.deepEqual(submittedLab5ResearchView.model.researchAppliedWearableMetricKeys, []);
  assert.equal(submittedLab5ResearchView.model.scoreBearingFeatureKeys.join("|"), "glucose|egfr|bmi");
  assert.equal(
    submittedLab5ResearchView.model.scoreBearingMetricKeys.join("|"),
    submittedLab5ResearchView.selectedScoreBearingMetricKeys.join("|"),
  );
  assert.equal(submittedLab5ResearchView.model.scoreBearingMetricKeys.join("|"), "glucose|egfr|bmi");
  assert.equal(submittedLab5ResearchView.model.wearable.currentUse, "context-only-shadow");
  assert.equal(submittedLab5ResearchView.model.wearable.scoreBearing, false);
  assert.equal(submittedLab5ResearchView.model.wearable.scoreContributionAuthorized, false);
  assert.equal(submittedLab5ResearchView.model.wearable.consumerValidationStatus, "missing");
  assert.equal(submittedLab5ResearchViewJson.includes("\"shadowEvidenceConclusion\":\"public_multi_family_wearable_shadow_signal_mixed_keep_context_only\""), true);
  assert.equal(submittedLab5ResearchViewJson.includes("\"externalConsumerLabWearableAggregateStillMissing\":true"), true);
  assert.equal(submittedLab5ResearchViewJson.includes("\"usableAsConsumerWearableValidation\":false"), true);
  assert.equal(submittedLab5ResearchView.model.wearable.nextAction, "run_external_or_partner_lab_wearable_aggregate_delta");
  assert.equal(
    submittedLab5ResearchView.model.wearable.nextExternalOrPartnerRouteIdsByPriority.join("|"),
    "all-of-us-fitbit-labs-ehr|mipact-apple-watch-ehr|framingham-activity-cvd|uk-biobank-integrated|cardia-biomarker-activity|hchs-sol-biomarker-activity|nsrr-mesa-sleep-autonomic|whi-opach-womens-health-activity|nako-accelerometer-biobank|hunt-activity-sensor-biobank|lifelines-activelife-biobank",
  );
  assert.equal(
    submittedLab5ResearchView.model.wearable.shadowEvidencePacketIds.join("|"),
    "r1065-nhanes-wrist-activity-shadow-loop|r1066-nhanes-wrist-activity-robustness-loop|r1067-nhanes-wrist-final-stress-test|r1038-nhanes-modern-lab-activity-loop|r1049-nhanes-activity-control-diagnostic",
  );
  assert.equal(
    submittedLab5ResearchView.model.contextOnlyMetricKeys.includes("steps"),
    true,
  );
  assert.equal(submittedLab5ResearchView.ageEstimate?.biologicalAgeYears, submittedLab5Report.result?.biologicalAgeYears);
  assert.equal(submittedLab5ResearchView.risk.probability, submittedLab5Report.result?.risk?.probability);
  assert.equal(
    submittedLab5ResearchView.featureContributions.some((feature) => feature.metricKey === "glucose"),
    true,
  );
  assert.equal(
    submittedLab5ResearchView.featureContributions.some((feature) => feature.metricKey === "steps"),
    false,
  );
  assert.equal(
    submittedLab5ResearchView.featureDrivers.younger.length
      + submittedLab5ResearchView.featureDrivers.older.length
      + submittedLab5ResearchView.featureDrivers.neutral.length > 0,
    true,
  );
  assert.equal(
    submittedLab5ResearchView.featureDrivers.younger.every((driver) =>
      driver.direction === "younger" && driver.metricKey !== null && driver.contributionYears !== null
    ),
    true,
  );
  assert.equal(
    submittedLab5ResearchView.featureDrivers.older.every((driver) =>
      driver.direction === "older" && driver.metricKey !== null && driver.contributionYears !== null
    ),
    true,
  );
  if (submittedLab5ResearchView.featureDrivers.older.length > 1) {
    assert.equal(
      submittedLab5ResearchView.featureDrivers.older[0]?.absoluteContributionYears
        >= (submittedLab5ResearchView.featureDrivers.older[1]?.absoluteContributionYears ?? 0),
      true,
    );
  }
  assert.equal(
    submittedLab5ResearchView.domainContributions.some((module) => module.moduleId === "metabolic"),
    true,
  );
  assert.equal(submittedLab5ResearchView.wearable.scoreBearing, false);
  assert.equal(submittedLab5ResearchView.wearable.readyFeatureKeys.includes("activity-volume"), true);
  assert.equal(
    submittedLab5ResearchView.wearable.features.find((feature) => feature.featureKey === "resting-heart-rate")
      ?.status,
    "missing",
  );
  assert.equal(
    submittedLab5ResearchView.wearable.features.every((feature) => feature.scoreContributionAuthorized === false),
    true,
  );
  const submittedLab5ViewJson = JSON.stringify(submittedLab5View);
  for (const forbidden of [
    "private metric",
    "metric-point:",
    "\"value\"",
    "\"unit\"",
    "\"label\"",
    "\"message\"",
    "\"path\"",
    "coefficient",
    "contributionLogit",
    "prediction",
  ]) {
    assert.equal(submittedLab5ViewJson.includes(forbidden), false, forbidden);
  }
  for (const forbidden of [
    "private metric",
    "metric-point:",
    "\"value\"",
    "\"unit\"",
    "\"label\"",
    "\"message\"",
    "\"path\"",
    "coefficient",
    "contributionLogit",
    "prediction",
  ]) {
    assert.equal(submittedLab5ResearchViewJson.includes(forbidden), false, forbidden);
  }

  const submittedReportWithFutureInputs = calculateMurphAgeFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: [
      { metricKey: "HbA1c", observedAt: "2026-05-11T00:00:00.000Z", unit: "%", value: 9.9 },
      { metricKey: "HbA1c", observedAt: "2026-05-09T00:00:00.000Z", unit: "%", value: 5.4 },
      { effectiveDate: "2026-05-11", metricKey: "glucose", unit: "mg/dL", value: 300 },
      { metricKey: "glucose", observedAt: "2026-05-09T00:00:00.000Z", unit: "mg/dL", value: 92 },
      { metricKey: "egfr", observedAt: "2026-05-09T00:00:00.000Z", unit: "mL/min/1.73m^2", value: 95 },
      { metricKey: "HDL_C", unit: "mg/dL", value: 58 },
      { metricKey: "Triglycerides", unit: "mg/dL", value: 95 },
      { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
    ],
  });

  assert.equal(submittedReportWithFutureInputs.status, "ready");
  assert.equal(submittedReportWithFutureInputs.warnings.filter((warning) => warning.code === "INVALID_INPUT").length, 2);
  const selectedSubmittedPointIds = submittedReportWithFutureInputs.bundleAssessment.featureStatuses.flatMap((feature) =>
    feature.selectedPointIds
  );
  assert.equal(selectedSubmittedPointIds.includes("metric-point:murph-age-submitted:hba1c:0"), false);
  assert.equal(selectedSubmittedPointIds.includes("metric-point:murph-age-submitted:glucose:2"), false);
  assert.equal(selectedSubmittedPointIds.includes("metric-point:murph-age-submitted:hba1c:1"), true);
  assert.equal(JSON.stringify(submittedReportWithFutureInputs).includes("9.9"), false);
  assert.equal(JSON.stringify(submittedReportWithFutureInputs).includes("300"), false);

  const rejectedSubmittedReport = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
    sex: "female",
    submittedMetrics: [
      { metricKey: "HbA1c", sourceKind: "space-lab", unit: "%", value: 5.4 },
      { metricKey: "steps", sourceKind: "test-result", unit: "count", value: 9_800 },
      { metricKey: "glucose", observedAt: "not-a-date", unit: "mg/dL", value: 92 },
      { metricKey: "creatinine", effectiveDate: "not-a-date", unit: "mg/dL", value: 0.82 },
      { metricKey: "egfr", unit: "mL/min/1.73m^2", value: Number.NaN },
    ],
  });

  assert.equal(rejectedSubmittedReport.status, "abstain");
  assert.equal(rejectedSubmittedReport.warnings.filter((warning) => warning.code === "INVALID_INPUT").length, 5);
  assert.equal(JSON.stringify(rejectedSubmittedReport).includes("space-lab"), false);
  assert.equal(JSON.stringify(rejectedSubmittedReport).includes("not-a-date"), false);
  assert.equal(JSON.stringify(rejectedSubmittedReport).includes("metric-point:"), false);
  assert.equal(JSON.stringify(rejectedSubmittedReport).includes("\"value\""), false);

  const explicitLab9WithLab5OnlyInputs = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "lab9_bp_body_10y_acm_research",
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: researchModel },
    points: lab5Points,
    sex: "female",
  });

  assert.equal(explicitLab9WithLab5OnlyInputs.status, "abstain");
  assert.equal(explicitLab9WithLab5OnlyInputs.result, null);
  assert.equal(explicitLab9WithLab5OnlyInputs.bundleAssessment.bundleId, "lab9-bp-body");
  assert.equal(explicitLab9WithLab5OnlyInputs.cardPolicy?.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(
    explicitLab9WithLab5OnlyInputs.warnings.some((warning) =>
      warning.code === "MODEL_CARD_POLICY_VIOLATION"
    ),
    false,
  );
  assert.equal(
    explicitLab9WithLab5OnlyInputs.warnings.some((warning) =>
      warning.code === "MODEL_FEATURE_MISSING"
    ),
    true,
  );

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
  assert.deepEqual(
    summarizeMurphAgePublicWearableBridgeFromInputBundle({ asOf, points: wearableContextPoints }),
    summarizeMurphAgeCalculatorPublicOutput(wearableOnly).wearableBridge,
  );
  assert.equal(wearableOnlySummary.displayStatus, "context-only");
  assert.equal(wearableOnlySummary.displayBlockedReason, "context-only");
  assert.deepEqual(wearableOnlySummary.outcomeContext, {
    ageEstimateBasis: "none",
    horizonYears: null,
    riskEndpoint: "none",
  });
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
  const wearableOnlyView = buildMurphAgePublicCalculatorView(toPublicMurphAgeCalculatorReport(wearableOnly));
  assert.equal(wearableOnlyView.displayCategory, "context-only");
  assert.equal(wearableOnlyView.selectedCardId, null);
  assert.equal(wearableOnlyView.ageEstimate, null);
  assert.equal(wearableOnlyView.risk.probability, null);
  assert.equal(wearableOnlyView.risk.riskEndpoint, "none");
  assert.equal(wearableOnlyView.wearable.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(wearableOnlyView.scoreReadiness.status, "context-only-no-score");
  assert.equal(wearableOnlyView.scoreReadiness.inputBundleId, "wearable-context");
  assert.equal(wearableOnlyView.scoreReadiness.biologicalAgeAvailable, false);
  assert.equal(wearableOnlyView.scoreReadiness.riskAvailable, false);
  assert.equal(wearableOnlyView.scoreReadiness.wearableReadyFeatureCount > 0, true);
  assert.equal(
    wearableOnlyView.scoreReadiness.unlockRequirements.includes("complete-score-bearing-inputs"),
    true,
  );
  assert.equal(
    wearableOnlyView.scoreReadiness.unlockRequirements.includes("validated-wearable-parameter-pack"),
    true,
  );
  assert.equal(wearableOnlyView.wearable.scorePolicy.productStatus, "context-only");
  assert.equal(wearableOnlyView.wearable.scorePolicy.productWearableMultiplier, 0);
  assert.equal(
    wearableOnlyView.wearable.scorePolicy.familyPolicies.find((policy) =>
      policy.family === "activity"
    )?.researchMultiplier,
    1,
  );
  assert.equal(
    wearableOnlyView.wearable.scorePolicy.familyPolicies.find((policy) =>
      policy.family === "hrv"
    )?.scoreBearingPromotionPriority,
    "defer",
  );
  assert.equal(wearableOnlyView.featureContributions.length, 0);
  assert.equal(wearableOnlyView.domainContributions.length, 0);

  const functionOnly = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    points: functionContextPoints,
    sex: "female",
  });
  assert.equal(functionOnly.status, "context-only");
  assert.equal(functionOnly.bundleAssessment.bundleId, "function-context");
  assert.equal(functionOnly.result, null);
  assert.equal(functionOnly.cardPolicy?.cardId, "function_context_no_risk");
  assert.equal(functionOnly.authorization.scoreBearing, false);
  assert.equal(functionOnly.authorization.contextOnlyMetricKeys.includes("adl-limitation-count"), true);
  assert.equal(functionOnly.contextAssessments.length, 0);
  const functionOnlySummary = summarizeMurphAgeCalculatorOutput(functionOnly);
  assert.equal(functionOnlySummary.displayStatus, "context-only");
  assert.equal(functionOnlySummary.contextOnlyFeatureKeys.includes("adl-limitations"), true);
  assert.equal(functionOnlySummary.contextOnlyMetricKeys.includes("frailty-symptom-count"), true);
  assert.equal(functionOnlySummary.wearableContext.quality, "none");
  assert.equal(functionOnlySummary.wearableContext.readyFeatureCount, 0);
  const publicFunctionOnlyReport = toPublicMurphAgeCalculatorReport(functionOnly);
  assert.equal(publicFunctionOnlyReport.inputReadiness.bundle.bundleId, "function-context");
  assert.equal(publicFunctionOnlyReport.inputReadiness.bundle.selectedMetricKeys.includes("adl-limitation-count"), true);
  assert.equal(publicFunctionOnlyReport.inputReadiness.bundle.featureStatuses.some((feature) => "label" in feature), false);
  assert.equal(publicFunctionOnlyReport.authorization.scoreBearing, false);
  assert.equal(publicFunctionOnlyReport.authorization.scoreBearingMetricKeys.length, 0);
  assert.equal(publicFunctionOnlyReport.displaySummary.selectedScoreBearingMetricKeys.length, 0);
  const publicFunctionReadinessJson = JSON.stringify(publicFunctionOnlyReport.inputReadiness);
  for (const forbidden of [
    "selectedPointIds",
    "metric-point:",
    "\"value\"",
    "\"unit\"",
    "\"label\"",
    "\"message\"",
    "\"path\"",
    "coefficient",
    "contributionLogit",
    "contributionYears",
    "prediction",
  ]) {
    assert.equal(publicFunctionReadinessJson.includes(forbidden), false, forbidden);
  }

  const functionOnlyFromTestResults = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    points: functionContextPoints.map((point) =>
      metricPoint({
        effectiveDate: point.effectiveDate,
        id: point.id.replace(":measurement:", ":test-result:"),
        metricKey: point.metricKey,
        observedAt: point.observedAt,
        recordId: `lab_${point.metricKey.replaceAll("-", "_")}`,
        sourceKind: "test-result",
        unit: point.unit,
        value: point.value ?? 0,
      })
    ),
    sex: "female",
  });
  assert.equal(functionOnlyFromTestResults.status, "abstain");
  assert.equal(functionOnlyFromTestResults.bundleAssessment.bundleId, "insufficient");
  assert.equal(functionOnlyFromTestResults.authorization.contextOnlyMetricKeys.includes("adl-limitation-count"), false);

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

  const countsOnlyWearable = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    points: [
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "activity_counts_1",
        metricKey: "activity-counts",
        observedAt: "2026-05-08T00:00:00.000Z",
        recordId: "activity_counts_record",
        sourceKind: "activity-summary",
        unit: "counts/day",
        value: 123456,
      }),
    ],
    sex: "female",
  });
  const countsOnlySummary = summarizeMurphAgeCalculatorOutput(countsOnlyWearable);
  assert.equal(countsOnlySummary.wearableContext.availableFeatureFamilies.includes("activity"), true);
  assert.equal(countsOnlySummary.wearableContext.readyFeatureCount, 1);
  assert.equal(countsOnlySummary.wearableContext.readyMetricCount, 1);

  const policyViolation = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "lab9_bp_body_10y_acm_research",
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
    cardId: "lab9_bp_body_10y_acm_research",
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
    cardId: "lab9_bp_body_10y_acm_research",
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

  const explicitR399WithLab9BundleDoesNotScore = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 45,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: fixtureR399ProxyResearchModel() },
    points: lab9Points.filter((point) => point.metricKey !== "bmi"),
    sex: "female",
  });
  assert.equal(explicitR399WithLab9BundleDoesNotScore.status, "abstain");
  assert.equal(explicitR399WithLab9BundleDoesNotScore.result, null);
  assert.equal(explicitR399WithLab9BundleDoesNotScore.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(explicitR399WithLab9BundleDoesNotScore.cardPolicy?.cardId, "r399_nhis_proxy_10y_acm_research");
  assert.equal(
    explicitR399WithLab9BundleDoesNotScore.warnings.some((warning) =>
      warning.code === "MODEL_FEATURE_MISSING" && warning.message.includes("at least one observed proxy input")
    ),
    true,
  );
});

test("dispatches the R399 NHIS proxy anchor as an explicit research-only base model", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const r399Points = [
    measurementMetricPoint("bmi", "kg/m^2", 24.2),
    surveyMetricPoint("self-rated-health", "score", 2),
  ];
  const wearableContextPoints = [
    wearableMetricPoint("steps", "wearable-summary"),
    wearableMetricPoint("wearable-valid-day-count-28d", "wearable-summary"),
    wearableMetricPoint("wearable-coverage-index", "wearable-summary"),
  ];
  const functionContextPoints = completeFunctionContextPoints();
  const r399Model = fixtureR399ProxyResearchModel();
  const scoreBearingNumericSnapshot = (output: ReturnType<typeof calculateMurphAgeFromInputBundle>) => {
    assert.ok(output.result);
    return {
      ageDeltaYears: output.result.ageDeltaYears,
      biologicalAgeYears: output.result.biologicalAgeYears,
      featureAttributions: output.result.featureAttributions.map((feature) => ({
        contributionLogit: feature.contributionLogit,
        contributionYears: feature.contributionYears,
        featureKey: feature.featureKey,
        metricKey: feature.metricKey,
        moduleId: feature.moduleId,
        status: feature.status,
        value: feature.value,
      })),
      intervalYears: output.result.intervalYears,
      moduleAttributions: output.result.moduleAttributions,
      riskProbability: output.result.risk?.probability,
    };
  };

  const product = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: [...r399Points, ...wearableContextPoints],
    sex: "female",
  });

  assert.equal(product.status, "abstain");
  assert.equal(product.result, null);
  assert.equal(product.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(product.cardPolicy?.cardId, "r399_nhis_proxy_10y_acm_research");
  assert.equal(product.authorization.evidenceClass, "research-internal");
  assert.equal(product.authorization.productAuthorized, false);
  assert.equal(product.authorization.riskToAgeDisplayAuthorized, false);
  assert.equal(product.warnings.some((warning) => warning.code === "MODEL_CARD_NOT_AUTHORIZED"), true);

  const contextFreeResearch = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: r399Points,
    sex: "female",
  });
  const research = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: [...r399Points, ...wearableContextPoints],
    sex: "female",
  });
  const researchWithAllContext = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: [...r399Points, ...wearableContextPoints, ...functionContextPoints],
    sex: "female",
  });

  assert.equal(contextFreeResearch.status, "ready");
  assert.equal(research.status, "ready");
  assert.equal(researchWithAllContext.status, "ready");
  assert.equal(research.result?.status, "ready");
  const contextFreeScore = scoreBearingNumericSnapshot(contextFreeResearch);
  assert.deepEqual(scoreBearingNumericSnapshot(research), contextFreeScore);
  assert.deepEqual(scoreBearingNumericSnapshot(researchWithAllContext), contextFreeScore);
  assert.equal(contextFreeResearch.contextAssessments.length, 0);
  assert.deepEqual(
    researchWithAllContext.contextAssessments.map((assessment) => assessment.bundleId).sort(),
    ["function-context", "wearable-context"],
  );
  assert.equal(researchWithAllContext.authorization.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(researchWithAllContext.authorization.contextOnlyMetricKeys.includes("adl-limitation-count"), true);
  for (const contextOnlyMetricKey of [
    "steps",
    "wearable-coverage-index",
    "adl-limitation-count",
    "mobility-limitation-count",
  ]) {
    assert.equal(
      researchWithAllContext.result?.featureAttributions.some((feature) =>
        feature.metricKey === contextOnlyMetricKey
      ),
      false,
    );
  }
  assert.equal(research.result?.modelId, "fixture-r399-proxy-anchor-model");
  assert.equal(research.result?.authorization.cardId, "r399_nhis_proxy_10y_acm_research");
  assert.equal(research.result?.authorization.productAuthorized, false);
  assert.equal(research.result?.authorization.riskToAgeDisplayAuthorized, false);
  const researchView = buildMurphAgeResearchCalculatorView(toPublicMurphAgeCalculatorReport(research));
  assert.deepEqual(researchView.model.layeredResearchPath.activeResearchScoreLayerIds, [
    "r399-outcome-risk-anchor",
  ]);
  const r399Layer = researchView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "r399-outcome-risk-anchor"
  );
  assert.ok(r399Layer);
  assert.equal(r399Layer.status, "active-research-score");
  assert.equal(r399Layer.selected, true);
  assert.equal(r399Layer.scoreBearingNow, true);
  const labBodyLayer = researchView.model.layeredResearchPath.layers.find((layer) =>
    layer.layerId === "selected-lab-body-card"
  );
  assert.ok(labBodyLayer);
  assert.equal(labBodyLayer.status, "available-research-candidate");
  assert.equal(labBodyLayer.selected, false);
  assert.equal(labBodyLayer.scoreBearingNow, false);
  assert.equal(research.bundleAssessment.availableFeatureKeys.includes("bmi"), true);
  assert.equal(research.bundleAssessment.availableFeatureKeys.includes("self-rated-health"), true);
  assert.equal(research.bundleAssessment.missingFeatureKeys.includes("smoking-status"), true);
  assert.equal(research.bundleAssessment.selectedMetricKeys.includes("steps"), false);
  assert.equal(research.contextAssessments[0]?.bundleId, "wearable-context");
  assert.equal(research.authorization.contextOnlyMetricKeys.includes("steps"), true);
  assert.equal(
    research.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "activity")?.anchorCardId,
    "r399_nhis_proxy_10y_acm_research",
  );
  assert.equal(
    research.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "activity")?.anchorCompatible,
    false,
  );
  assert.equal(
    research.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "activity")?.status,
    "blocked",
  );
  assert.equal(
    researchWithAllContext.wearableShadowIncrementAssessments.find((assessment) =>
      assessment.family === "activity"
    )?.selectedMetricKeys.includes("steps"),
    true,
  );
  assert.equal(
    research.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "activity")?.scoreBearing,
    false,
  );
  assert.equal(research.result?.featureAttributions.find((feature) => feature.featureKey === "age-squared")?.status, "ready");
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "age-x-female")?.status,
    "ready",
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "age-squared")?.contributionLogit,
    -0.0014,
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "age-x-female")?.contributionLogit,
    -0.02,
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "bmi-missing")?.value,
    0,
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "self-rated-health-missing")
      ?.value,
    0,
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "smoking-status")?.status,
    "imputed",
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "smoking-status")
      ?.contributionLogit,
    0,
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "smoking-status")
      ?.valueLabel,
    "imputed",
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.featureKey === "smoking-status-missing")
      ?.value,
    1,
  );
  assert.equal(
    research.result?.featureAttributions.find((feature) => feature.metricKey === "steps"),
    undefined,
  );
  assert.equal(research.result?.moduleAttributions.some((module) => module.moduleId === "demographics"), true);
  assert.equal(research.result?.moduleAttributions.some((module) => module.moduleId === "behavior"), true);

  const defaultResearch = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: [...r399Points, ...wearableContextPoints],
    sex: "female",
  });

  assert.equal(defaultResearch.status, "ready");
  assert.equal(defaultResearch.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(defaultResearch.cardPolicy?.cardId, "r399_nhis_proxy_10y_acm_research");
  assert.equal(defaultResearch.result?.modelId, "fixture-r399-proxy-anchor-model");
  assert.equal(defaultResearch.contextAssessments[0]?.bundleId, "wearable-context");
  assert.equal(defaultResearch.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  const defaultR399Candidate = defaultResearch.researchCandidateCards.find((candidate) =>
    candidate.cardId === "r399_nhis_proxy_10y_acm_research"
  );
  assert.ok(defaultR399Candidate);
  assert.equal(defaultR399Candidate.selected, true);
  assert.equal(defaultR399Candidate.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(defaultR399Candidate.inputStatus, "ready");
  assert.equal(defaultR399Candidate.modelLoaded, true);
  assert.equal(defaultR399Candidate.blockerCodes.length, 0);
  assert.equal(defaultR399Candidate.selectedMetricKeys.includes("steps"), false);
  const defaultLab9Candidate = defaultResearch.researchCandidateCards.find((candidate) =>
    candidate.cardId === "lab9_bp_body_10y_acm_research"
  );
  assert.ok(defaultLab9Candidate);
  assert.equal(defaultLab9Candidate.selected, false);
  assert.equal(defaultLab9Candidate.inputStatus, "abstain");
  assert.equal(defaultLab9Candidate.blockerCodes.includes("INPUT_BUNDLE_INCOMPLETE"), true);

  const partialLabPoints = [
    measurementMetricPoint("bmi", "kg/m^2", 24.2),
    measurementMetricPoint("hba1c", "%", 5.4),
  ];
  const partialLabResearch = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: partialLabPoints,
    sex: "female",
  });

  assert.equal(partialLabResearch.status, "abstain");
  assert.equal(partialLabResearch.result, null);
  assert.equal(partialLabResearch.bundleAssessment.bundleId, "insufficient");
  assert.equal(partialLabResearch.cardPolicy, null);
  const partialLabR399Candidate = partialLabResearch.researchCandidateCards.find((candidate) =>
    candidate.cardId === "r399_nhis_proxy_10y_acm_research"
  );
  assert.ok(partialLabR399Candidate);
  assert.equal(partialLabR399Candidate.selected, false);
  assert.equal(partialLabR399Candidate.inputStatus, "ready");
  assert.equal(partialLabR399Candidate.modelLoaded, true);
  assert.equal(
    partialLabR399Candidate.blockerCodes.includes("PROXY_FALLBACK_SUPPRESSED_BY_LAB_INTENT"),
    true,
  );
  const partialLabPublicReport = toPublicMurphAgeCalculatorReport(partialLabResearch);
  const partialLabPublicR399Candidate = partialLabPublicReport.researchCandidateCards.find((candidate) =>
    candidate.cardId === "r399_nhis_proxy_10y_acm_research"
  );
  assert.ok(partialLabPublicR399Candidate);
  assert.equal(
    partialLabPublicR399Candidate.blockerCodes.includes("PROXY_FALLBACK_SUPPRESSED_BY_LAB_INTENT"),
    true,
  );

  const explicitR399PartialLabResearch = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: partialLabPoints,
    sex: "female",
  });

  assert.equal(explicitR399PartialLabResearch.status, "ready");
  assert.equal(explicitR399PartialLabResearch.result?.status, "ready");
  assert.equal(explicitR399PartialLabResearch.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(explicitR399PartialLabResearch.cardPolicy?.cardId, "r399_nhis_proxy_10y_acm_research");
  const explicitPartialLabR399Candidate = explicitR399PartialLabResearch.researchCandidateCards.find((candidate) =>
    candidate.cardId === "r399_nhis_proxy_10y_acm_research"
  );
  assert.ok(explicitPartialLabR399Candidate);
  assert.equal(explicitPartialLabR399Candidate.selected, true);
  assert.equal(explicitPartialLabR399Candidate.inputStatus, "ready");
  assert.equal(
    explicitPartialLabR399Candidate.blockerCodes.includes("PROXY_FALLBACK_SUPPRESSED_BY_LAB_INTENT"),
    false,
  );

  const summary = summarizeMurphAgeCalculatorOutput(research);
  assert.equal(summary.displayStatus, "research-only");
  assert.equal(summary.displayBlockedReason, "product-not-authorized");
  assert.equal(summary.ageEstimateAvailable, true);
  assert.equal(summary.productAgeDisplayReady, false);
  assert.equal(summary.selectedScoreBearingMetricKeys.includes("smoking-status-proxy"), true);
  assert.equal(summary.selectedScoreBearingPointIds.includes("metric-point:steps:2026-05-08:wearable-summary:0"), false);
  assert.equal(summary.contextOnlyMetricKeys.includes("steps"), true);

  const publicReport = toPublicMurphAgeCalculatorReport(research);
  assert.equal(publicReport.inputReadiness.bundle.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(publicReport.researchCandidateCards.length, 5);
  const publicR399Candidate = publicReport.researchCandidateCards.find((candidate) =>
    candidate.cardId === "r399_nhis_proxy_10y_acm_research"
  );
  assert.ok(publicR399Candidate);
  assert.equal(publicR399Candidate.selected, true);
  assert.equal(publicR399Candidate.modelLoaded, true);
  assert.equal(publicR399Candidate.blockerCodes.length, 0);
  assert.equal(publicR399Candidate.selectedMetricKeys.includes("steps"), false);
  assert.equal("selectedPointIds" in publicR399Candidate, false);
  assert.equal("value" in publicR399Candidate, false);
  assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.status === "imputed"), true);
  assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  assert.equal(publicReport.result ? "modelId" in publicReport.result : true, false);

  const noProxyResearch = calculateMurphAgeFromInputBundle({
    asOf,
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    mode: "research",
    models: { r399_nhis_proxy_10y_acm_research: r399Model },
    points: wearableContextPoints,
    sex: "female",
  });
  assert.equal(noProxyResearch.status, "abstain");
  assert.equal(noProxyResearch.result, null);
  assert.equal(noProxyResearch.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
  assert.equal(noProxyResearch.bundleAssessment.availableFeatureKeys.length, 0);
  assert.equal(
    noProxyResearch.warnings.some((warning) =>
      warning.code === "MODEL_FEATURE_MISSING" && warning.message.includes("at least one observed proxy input")
    ),
    true,
  );
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

test("Murph Age model-card artifact parser and policy validator stay with model ownership", () => {
  const validArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "lab9_bp_body_10y_acm_research",
    ignoredTopLevelMetadata: "local-only note",
    model: fixtureLab9ResearchModel(),
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });

  assert.equal(validArtifact.warnings.length, 0);
  assert.ok(validArtifact.value);
  assert.equal(validArtifact.value?.cardId, "lab9_bp_body_10y_acm_research");
  assert.equal(validArtifact.value?.model.modelId, "fixture-lab9-research-card-model");
  assert.equal(
    Object.prototype.hasOwnProperty.call(validArtifact.value, "ignoredTopLevelMetadata"),
    false,
  );
  assert.equal(validateMurphAgeLocalModelCardArtifactPolicy(validArtifact.value).length, 0);

  const r399Artifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "r399_nhis_proxy_10y_acm_research",
    model: fixtureR399ProxyResearchModel(),
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });

  assert.equal(r399Artifact.warnings.length, 0);
  assert.ok(r399Artifact.value);
  assert.equal(r399Artifact.value?.cardId, "r399_nhis_proxy_10y_acm_research");
  assert.equal(validateMurphAgeLocalModelCardArtifactPolicy(r399Artifact.value).length, 0);

  const invalidSchema = parseMurphAgeLocalModelCardArtifact({ schemaVersion: "wrong" });
  assert.equal(invalidSchema.value, null);
  assert.equal(invalidSchema.warnings[0]?.code, "INVALID_INPUT");
  assert.equal(invalidSchema.warnings[0]?.message.includes("expected schema"), true);

  const riskModelWithUnknownTopLevelKey = parseMurphAgeRiskModelArtifact({
    ...fixtureLab9ResearchModel(),
    unreviewedLocalNote: "should not be accepted inside the executable model",
  });
  assert.equal(riskModelWithUnknownTopLevelKey, null);

  const riskModelWithUnknownFeatureKey = parseMurphAgeRiskModelArtifact({
    ...fixtureLab9ResearchModel(),
    features: [
      {
        ...fixtureLab9ResearchModel().features[0],
        unreviewedFeatureNote: "should not be accepted inside the executable feature",
      },
    ],
  });
  assert.equal(riskModelWithUnknownFeatureKey, null);

  const unauthorizedArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "lab9_bp_body_10y_acm_research",
    model: {
      ...fixtureLab9ResearchModel(),
      features: [
        ...fixtureLab9ResearchModel().features,
        {
          coefficient: -0.1,
          key: "steps",
          kind: "metric",
          label: "Steps",
          metricKey: "steps",
          moduleId: "activity",
        },
      ],
      modelId: "fixture-lab9-invalid-wearable-model",
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });
  assert.ok(unauthorizedArtifact.value);
  const warnings = validateMurphAgeLocalModelCardArtifactPolicy(unauthorizedArtifact.value);
  assert.equal(warnings.some((warning) => warning.code === "MODEL_CARD_POLICY_VIOLATION"), true);
  assert.equal(warnings.some((warning) => warning.message.includes("Steps")), false);

  const unauthorizedR399MissingnessArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "r399_nhis_proxy_10y_acm_research",
    model: {
      ...fixtureR399ProxyResearchModel(),
      features: [
        ...fixtureR399ProxyResearchModel().features,
        {
          coefficient: 0.1,
          key: "steps-missing",
          kind: "metric-missingness",
          label: "Steps missing",
          metricKey: "steps",
          moduleId: "activity",
        },
      ],
      modelId: "fixture-r399-invalid-wearable-missingness-model",
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });
  assert.ok(unauthorizedR399MissingnessArtifact.value);
  const r399MissingnessWarnings = validateMurphAgeLocalModelCardArtifactPolicy(
    unauthorizedR399MissingnessArtifact.value,
  );
  assert.equal(r399MissingnessWarnings.some((warning) =>
    warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.metricKey === "steps"
  ), true);

  const wrongR399EndpointArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "r399_nhis_proxy_10y_acm_research",
    model: {
      ...fixtureR399ProxyResearchModel(),
      endpoint: "five-year cardiovascular event",
      modelId: "fixture-r399-wrong-endpoint-model",
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });
  assert.ok(wrongR399EndpointArtifact.value);
  const r399EndpointWarnings = validateMurphAgeLocalModelCardArtifactPolicy(wrongR399EndpointArtifact.value);
  assert.equal(r399EndpointWarnings.some((warning) =>
    warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.message.includes("endpoint")
  ), true);

  const wrongR399HorizonArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "r399_nhis_proxy_10y_acm_research",
    model: {
      ...fixtureR399ProxyResearchModel(),
      horizonYears: 5,
      modelId: "fixture-r399-wrong-horizon-model",
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });
  assert.ok(wrongR399HorizonArtifact.value);
  const r399HorizonWarnings = validateMurphAgeLocalModelCardArtifactPolicy(wrongR399HorizonArtifact.value);
  assert.equal(r399HorizonWarnings.some((warning) =>
    warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.message.includes("horizon")
  ), true);

  const wrongEndpointArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "lab9_bp_body_10y_acm_research",
    model: {
      ...fixtureLab9ResearchModel(),
      endpoint: "five-year cardiovascular event",
      modelId: "fixture-lab9-wrong-endpoint-model",
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });
  assert.ok(wrongEndpointArtifact.value);
  const endpointWarnings = validateMurphAgeLocalModelCardArtifactPolicy(wrongEndpointArtifact.value);
  assert.equal(endpointWarnings.some((warning) =>
    warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.message.includes("endpoint")
  ), true);

  const wrongHorizonArtifact = parseMurphAgeLocalModelCardArtifact({
    cardId: "lab9_bp_body_10y_acm_research",
    model: {
      ...fixtureLab9ResearchModel(),
      horizonYears: 5,
      modelId: "fixture-lab9-wrong-horizon-model",
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  });
  assert.ok(wrongHorizonArtifact.value);
  const horizonWarnings = validateMurphAgeLocalModelCardArtifactPolicy(wrongHorizonArtifact.value);
  assert.equal(horizonWarnings.some((warning) =>
    warning.code === "MODEL_CARD_POLICY_VIOLATION" && warning.message.includes("horizon")
  ), true);
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

function fixtureR399ProxyResearchModel(): MurphAgeRiskModel {
  return {
    endpoint: "10-year all-cause mortality",
    features: [
      {
        coefficient: 0.035,
        key: "age",
        kind: "chronological-age",
        label: "Age",
        moduleId: "demographics",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 52, standardDeviation: 14 },
      },
      {
        coefficient: 0.01,
        key: "age-squared",
        kind: "chronological-age-squared",
        label: "Age squared",
        moduleId: "demographics",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 2900, standardDeviation: 1400 },
      },
      {
        coefficient: -0.12,
        key: "female",
        kind: "sex",
        label: "Female",
        moduleId: "demographics",
        sex: "female",
      },
      {
        coefficient: -0.02,
        key: "age-x-female",
        kind: "age-sex-interaction",
        label: "Age by female",
        moduleId: "demographics",
        sex: "female",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 27, standardDeviation: 25 },
      },
      {
        coefficient: 0.05,
        expectedUnit: "kg/m^2",
        key: "bmi",
        kind: "metric",
        label: "BMI",
        metricKey: "bmi",
        missingValue: 27,
        moduleId: "body",
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 27, standardDeviation: 5 },
      },
      {
        coefficient: 0.02,
        key: "bmi-missing",
        kind: "metric-missingness",
        label: "BMI missing",
        metricKey: "bmi",
        moduleId: "data-quality",
      },
      {
        coefficient: 0.09,
        key: "self-rated-health",
        kind: "metric",
        label: "Self-rated health",
        metricKey: "self-rated-health",
        missingValue: 3,
        moduleId: "function",
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 3, standardDeviation: 1 },
      },
      {
        coefficient: 0.03,
        key: "self-rated-health-missing",
        kind: "metric-missingness",
        label: "Self-rated health missing",
        metricKey: "self-rated-health",
        moduleId: "data-quality",
      },
      {
        coefficient: 0.08,
        key: "hypertension-history",
        kind: "metric",
        label: "Hypertension history",
        metricKey: "hypertension-history-proxy-yes",
        missingValue: 0,
        moduleId: "cardiovascular",
        required: false,
      },
      {
        coefficient: 0.03,
        key: "hypertension-history-missing",
        kind: "metric-missingness",
        label: "Hypertension history missing",
        metricKey: "hypertension-history-proxy-yes",
        moduleId: "data-quality",
      },
      {
        coefficient: 0.1,
        key: "diabetes-history",
        kind: "metric",
        label: "Diabetes history",
        metricKey: "diabetes-history-proxy-yes",
        missingValue: 0,
        moduleId: "metabolic",
        required: false,
      },
      {
        coefficient: 0.03,
        key: "diabetes-history-missing",
        kind: "metric-missingness",
        label: "Diabetes history missing",
        metricKey: "diabetes-history-proxy-yes",
        moduleId: "data-quality",
      },
      {
        coefficient: 0.06,
        key: "smoking-status",
        kind: "metric",
        label: "Smoking status",
        metricKey: "smoking-status-proxy",
        missingValue: 1,
        moduleId: "behavior",
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 1, standardDeviation: 0.8 },
      },
      {
        coefficient: 0.02,
        key: "smoking-status-missing",
        kind: "metric-missingness",
        label: "Smoking status missing",
        metricKey: "smoking-status-proxy",
        moduleId: "data-quality",
      },
      {
        coefficient: -0.05,
        key: "physical-activity-proxy",
        kind: "metric",
        label: "Physical activity",
        metricKey: "physical-activity-proxy",
        missingValue: 2,
        moduleId: "activity",
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 2, standardDeviation: 1 },
      },
      {
        coefficient: 0.02,
        key: "physical-activity-proxy-missing",
        kind: "metric-missingness",
        label: "Physical activity missing",
        metricKey: "physical-activity-proxy",
        moduleId: "data-quality",
      },
    ],
    horizonYears: 10,
    intercept: -4.4,
    modelId: "fixture-r399-proxy-anchor-model",
    modelVersion: "test.0",
    referencePopulation: "fixture NHIS proxy reference curve",
    referenceRiskCurve: fixtureReferenceRiskCurve(),
    uncertainty: {
      baseYears: 2,
      perMissingOptionalFeatureYears: 0.5,
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

function assessedBundleMetricKeys(expectedBundleId: string, points: MetricPoint[]): Set<string> {
  const assessment = assessMurphAgeInputBundle({
    asOf: "2026-05-10T00:00:00.000Z",
    points,
  });
  assert.equal(assessment.bundleId, expectedBundleId);
  return new Set(assessment.featureStatuses.flatMap((status) => status.metricKeys));
}

function completeFunctionContextPoints(): MetricPoint[] {
  return [
    measurementMetricPoint("adl-limitation-count", "count", 0),
    measurementMetricPoint("iadl-limitation-count", "count", 1),
    measurementMetricPoint("mobility-limitation-count", "count", 1),
    measurementMetricPoint("frailty-symptom-count", "count", 0),
  ];
}

function completeR399ProxyAnchorPolicyPoints(): MetricPoint[] {
  return [
    measurementMetricPoint("bmi", "kg/m^2", 24.2),
    surveyMetricPoint("self-rated-health", "score", 2),
    surveyMetricPoint("hypertension-history-proxy-yes", "binary", 0),
    surveyMetricPoint("diabetes-history-proxy-yes", "binary", 0),
    surveyMetricPoint("smoking-status-proxy", "score", 1),
    surveyMetricPoint("physical-activity-proxy", "score", 3),
  ];
}

function measurementMetricPoint(metricKey: string, unit: string, value: number): MetricPoint {
  return metricPoint({
    effectiveDate: "2026-05-08",
    id: `metric-point:${metricKey}:2026-05-08:measurement:0`,
    metricKey,
    observedAt: "2026-05-08T08:00:00.000Z",
    recordId: `measurement_${metricKey.replaceAll("-", "_")}`,
    sourceKind: "measurement",
    unit,
    value,
  });
}

function surveyMetricPoint(metricKey: string, unit: string, value: number): MetricPoint {
  return metricPoint({
    effectiveDate: "2026-05-08",
    id: `metric-point:${metricKey}:2026-05-08:survey:0`,
    metricKey,
    observedAt: "2026-05-08T08:00:00.000Z",
    recordId: `survey_${metricKey.replaceAll("-", "_")}`,
    sourceKind: "survey-response",
    unit,
    value,
  });
}

function expectedResidualRiskProbability(baseRiskProbability: number, residualDeltaLogit: number): number {
  const baseLogit = Math.log(baseRiskProbability / (1 - baseRiskProbability));
  const finalLogit = baseLogit + residualDeltaLogit;
  return Math.round((1 / (1 + Math.exp(-finalLogit))) * 1_000_000) / 1_000_000;
}

function assessedR399ProxyAnchorMetricKeys(): Set<string> {
  const output = calculateMurphAgeFromInputBundle({
    asOf: "2026-05-10T00:00:00.000Z",
    cardId: "r399_nhis_proxy_10y_acm_research",
    chronologicalAgeYears: 52,
    mode: "research",
    points: completeR399ProxyAnchorPolicyPoints(),
    sex: "female",
  });
  assert.equal(output.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
  return new Set(output.bundleAssessment.featureStatuses.flatMap((status) => status.metricKeys));
}

function wearableMetricPoint(metricKey: string, sourceKind: MetricPoint["source"]["kind"]): MetricPoint {
  return metricPoint({
    effectiveDate: "2026-05-08",
    id: `metric-point:${metricKey}:2026-05-08:${sourceKind}:0`,
    metricKey,
    observedAt: "2026-05-08T08:00:00.000Z",
    recordId: `${sourceKind}_${metricKey.replaceAll("-", "_")}`,
    sourceKind,
    unit: "count",
    value: 1,
  });
}

function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

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
