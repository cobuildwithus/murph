import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  applyMurphAgeWearableResidualLayer,
  assessMurphAgeWearableShadowIncrements,
  calculateMurphAgeFromInputBundle,
  summarizeMurphAgeWearableResidualLayerContracts,
  validateMurphAgeWearableResidualParameterPack,
  type MetricPoint,
  type MurphAgeReferenceRiskPoint,
  type MurphAgeRiskModel,
  type MurphAgeWearableResidualParameterPack,
} from "../src/index.ts";

test("maps research-only wearable residual deltas onto risk-age equivalents when a reference curve is available", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const points = [
    metricPoint("steps", "count", 10_000, "wearable-summary"),
    metricPoint("activity-minutes", "minutes", 75, "wearable-summary"),
    metricPoint("wearable-valid-day-count-28d", "count", 24, "wearable-summary"),
    metricPoint("wearable-coverage-index", "score", 0.86, "wearable-summary"),
  ];
  const assessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    asOf,
    points,
  });
  const parameterPack: MurphAgeWearableResidualParameterPack = {
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
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
    packHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  };
  const referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[] = [
    { ageYears: 30, riskProbability: 0.05 },
    { ageYears: 40, riskProbability: 0.1 },
    { ageYears: 50, riskProbability: 0.2 },
  ];

  const application = applyMurphAgeWearableResidualLayer({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    anchorRiskProbability: 0.1,
    asOf,
    assessments,
    parameterPack,
    points,
    referenceRiskCurve,
  });

  assert.equal(application.schemaVersion, MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION);
  assert.equal(application.status, "research-parameterized-shadow-delta");
  assert.equal(application.parameterizationAvailable, true);
  assert.equal(application.parameterPackHash, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(application.residualDeltaLogit, -0.1);
  assert.equal(application.anchorRiskAgeEquivalentYears, 40);
  assert.equal(
    application.finalRiskAgeEquivalentYears !== null
      && application.finalRiskAgeEquivalentYears < application.anchorRiskAgeEquivalentYears,
    true,
  );
  assert.equal(application.residualDeltaYears !== null && application.residualDeltaYears < 0, true);
  assert.equal(application.productAuthorized, false);
  assert.equal(application.scoreBearing, false);
  assert.equal(application.scoreContributionAuthorized, false);

  const noReferenceCurveApplication = applyMurphAgeWearableResidualLayer({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    anchorRiskProbability: 0.1,
    asOf,
    assessments,
    parameterPack,
    points,
  });
  assert.equal(noReferenceCurveApplication.anchorRiskAgeEquivalentYears, null);
  assert.equal(noReferenceCurveApplication.finalRiskAgeEquivalentYears, null);
  assert.equal(noReferenceCurveApplication.residualDeltaYears, null);
});

test("accepts research-only sleep and autonomic residual packs without authorizing product scoring", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const points = [
    metricPoint("total-sleep-minutes", "minutes", 450, "sleep-summary"),
    metricPoint("wearable-valid-night-count-28d", "count", 22, "sleep-summary"),
    metricPoint("wearable-coverage-index", "score", 0.91, "wearable-summary"),
    metricPoint("resting-heart-rate", "bpm", 54, "wearable-summary"),
    metricPoint("wearable-valid-day-count-28d", "count", 24, "wearable-summary"),
    metricPoint("hrv-rmssd", "ms", 70, "wearable-summary"),
  ];
  const assessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    asOf,
    points,
  });
  const contracts = summarizeMurphAgeWearableResidualLayerContracts();
  assert.deepEqual(
    contracts.map((contract) => contract.layerId),
    [
      "activity-residual-v1",
      "sleep-residual-v1",
      "resting-heart-rate-residual-v1",
      "hrv-residual-v1",
    ],
  );

  const cases: Array<{
    coefficient: number;
    expectedDelta: number;
    family: MurphAgeWearableResidualParameterPack["family"];
    layerId: MurphAgeWearableResidualParameterPack["layerId"];
    metricKey: string;
    scale: number;
    center: number;
  }> = [
    {
      center: 420,
      coefficient: -0.04,
      expectedDelta: -0.04,
      family: "sleep",
      layerId: "sleep-residual-v1",
      metricKey: "total-sleep-minutes",
      scale: 30,
    },
    {
      center: 60,
      coefficient: 0.05,
      expectedDelta: -0.03,
      family: "resting-heart-rate",
      layerId: "resting-heart-rate-residual-v1",
      metricKey: "resting-heart-rate",
      scale: 10,
    },
    {
      center: 50,
      coefficient: -0.02,
      expectedDelta: -0.02,
      family: "hrv",
      layerId: "hrv-residual-v1",
      metricKey: "hrv-rmssd",
      scale: 20,
    },
  ];

  for (const testCase of cases) {
    const parameterPack: MurphAgeWearableResidualParameterPack = {
      anchorCardId: "l1b_glycemia_body_10y_acm_research",
      calibrationIntercept: 0,
      calibrationSlope: 1,
      deploymentRights: "research-only",
      endpoint: "10-year all-cause mortality",
      evidenceTier: "provisional-local-research",
      family: testCase.family,
      featureWeights: [
        {
          center: testCase.center,
          coefficient: testCase.coefficient,
          metricKey: testCase.metricKey,
          scale: testCase.scale,
          transform: "center-scale",
        },
      ],
      globalWearableCapLogit: 0.25,
      horizonYears: 10,
      intercept: 0,
      layerId: testCase.layerId,
      packHash: `sha256:${"b".repeat(64)}`,
      schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
      sourceRouteId: "all-of-us-fitbit-labs-ehr",
    };

    const application = applyMurphAgeWearableResidualLayer({
      anchorCardId: "l1b_glycemia_body_10y_acm_research",
      anchorRiskProbability: 0.1,
      asOf,
      assessments,
      parameterPack,
      points,
    });

    assert.equal(application.layerId, testCase.layerId);
    assert.equal(application.status, "research-parameterized-shadow-delta");
    assert.equal(application.parameterizationAvailable, true);
    assert.equal(application.residualDeltaLogit, testCase.expectedDelta);
    assert.equal(application.selectedMetricKeys.includes(testCase.metricKey), true);
    assert.equal(application.productAuthorized, false);
    assert.equal(application.scoreBearing, false);
    assert.equal(application.scoreContributionAuthorized, false);
  }
});

test("treats actigraphy activity counts as an activity residual signal", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const points = [
    metricPoint("activity-counts", "counts/day", 123_456, "activity-summary"),
    metricPoint("wearable-valid-day-count-28d", "count", 24, "wearable-summary"),
    metricPoint("wearable-coverage-index", "score", 0.86, "wearable-summary"),
  ];
  const assessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    asOf,
    points,
  });
  const contracts = summarizeMurphAgeWearableResidualLayerContracts();
  const activityContract = contracts.find((contract) => contract.family === "activity");
  const activityAssessment = assessments.find((assessment) => assessment.family === "activity");

  assert.equal(activityContract?.signalMetricKeys.includes("activity-counts"), true);
  assert.equal(activityAssessment?.status, "ready");
  assert.equal(activityAssessment?.readySignalMetricKeys.includes("activity-counts"), true);
  assert.equal(activityAssessment?.selectedMetricKeys.includes("activity-counts"), true);
  assert.equal(activityAssessment?.missingMetricKeys.includes("activity-counts"), false);
});

test("calculator applies multiple wearable residual packs together in research mode only", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const points = [
    metricPoint("hba1c", "%", 5.4, "test-result"),
    metricPoint("bmi", "kg/m^2", 24.2, "measurement"),
    metricPoint("steps", "count", 10_000, "wearable-summary"),
    metricPoint("total-sleep-minutes", "minutes", 450, "sleep-summary"),
    metricPoint("wearable-valid-night-count-28d", "count", 22, "sleep-summary"),
    metricPoint("wearable-coverage-index", "score", 0.91, "wearable-summary"),
    metricPoint("resting-heart-rate", "bpm", 54, "wearable-summary"),
    metricPoint("wearable-valid-day-count-28d", "count", 24, "wearable-summary"),
    metricPoint("hrv-rmssd", "ms", 70, "wearable-summary"),
  ];
  const output = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "research",
    models: {
      l1b_glycemia_body_10y_acm_research: fixtureL1bResearchModel(),
    },
    points,
    sex: "female",
    wearableResidualParameterPacks: [
      wearablePack({
        center: 8_000,
        coefficient: -0.04,
        family: "activity",
        layerId: "activity-residual-v1",
        metricKey: "steps",
        scale: 2_000,
      }),
      wearablePack({
        center: 420,
        coefficient: -0.04,
        family: "sleep",
        layerId: "sleep-residual-v1",
        metricKey: "total-sleep-minutes",
        scale: 30,
      }),
      wearablePack({
        center: 60,
        coefficient: 0.05,
        family: "resting-heart-rate",
        layerId: "resting-heart-rate-residual-v1",
        metricKey: "resting-heart-rate",
        scale: 10,
      }),
      wearablePack({
        center: 50,
        coefficient: -0.02,
        family: "hrv",
        layerId: "hrv-residual-v1",
        metricKey: "hrv-rmssd",
        scale: 20,
      }),
    ],
  });

  assert.equal(output.status, "ready");
  assert.equal(output.wearableResidualLayerApplication?.layerId, "multi-wearable-residual-v1");
  assert.equal(output.wearableResidualLayerApplication?.status, "research-parameterized-shadow-delta");
  assert.equal(output.wearableResidualLayerApplication?.parameterizationAvailable, true);
  assert.equal(output.wearableResidualLayerApplication?.residualDeltaLogit, -0.13);
  assert.equal(output.wearableResidualLayerApplication?.selectedMetricKeys.includes("steps"), true);
  assert.equal(output.wearableResidualLayerApplication?.selectedMetricKeys.includes("total-sleep-minutes"), true);
  assert.equal(output.wearableResidualLayerApplication?.selectedMetricKeys.includes("resting-heart-rate"), true);
  assert.equal(output.wearableResidualLayerApplication?.selectedMetricKeys.includes("hrv-rmssd"), true);
  assert.equal(output.wearableResidualLayerApplication?.productAuthorized, false);
  assert.equal(output.wearableResidualLayerApplication?.scoreBearing, false);
  assert.equal(output.wearableResidualLayerApplication?.scoreContributionAuthorized, false);

  const productOutput = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: 45,
    mode: "product",
    models: {
      l1b_glycemia_body_10y_acm_research: fixtureL1bResearchModel(),
    },
    points,
    sex: "female",
    wearableResidualParameterPacks: [
      wearablePack({
        center: 420,
        coefficient: -0.04,
        family: "sleep",
        layerId: "sleep-residual-v1",
        metricKey: "total-sleep-minutes",
        scale: 30,
      }),
    ],
  });
  assert.equal(productOutput.wearableResidualLayerApplication?.parameterizationAvailable ?? false, false);
});

test("rejects wearable residual packs whose anchor card mismatches the selected calculator anchor", () => {
  const asOf = "2026-05-10T00:00:00.000Z";
  const points = [
    metricPoint("steps", "count", 10_000, "wearable-summary"),
    metricPoint("wearable-valid-day-count-28d", "count", 24, "wearable-summary"),
    metricPoint("wearable-coverage-index", "score", 0.86, "wearable-summary"),
  ];
  const assessments = assessMurphAgeWearableShadowIncrements({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    asOf,
    points,
  });
  const parameterPack: MurphAgeWearableResidualParameterPack = {
    ...wearablePack({
      center: 8_000,
      coefficient: -0.08,
      family: "activity",
      layerId: "activity-residual-v1",
      metricKey: "steps",
      scale: 2_000,
    }),
    anchorCardId: "lab9_bp_body_10y_acm_research",
  };

  const application = applyMurphAgeWearableResidualLayer({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    anchorRiskProbability: 0.1,
    asOf,
    assessments,
    parameterPack,
    points,
  });

  assert.equal(application.status, "mechanics-ready-zero-delta");
  assert.equal(application.parameterizationAvailable, false);
  assert.equal(application.parameterPackHash, null);
  assert.equal(application.residualDeltaLogit, 0);
  assert.equal(
    application.warnings.some((warning) =>
      warning.code === "MODEL_CARD_POLICY_VIOLATION"
      && warning.message === "Wearable residual parameter pack anchor card is not compatible with the selected anchor."
    ),
    true,
  );
});

test("does not treat provisional local research evidence as product-promotion evidence", () => {
  const validation = validateMurphAgeWearableResidualParameterPack({
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    parameterPack: {
      ...wearablePack({
        center: 8_000,
        coefficient: -0.08,
        family: "activity",
        layerId: "activity-residual-v1",
        metricKey: "steps",
        scale: 2_000,
      }),
      deploymentRights: "product-authorized",
      evidenceTier: "provisional-local-research",
    },
  });

  assert.equal(validation.status, "invalid");
  assert.equal(
    validation.warnings.some((warning) =>
      warning.code === "MODEL_CARD_POLICY_VIOLATION"
      && warning.message === "Product-authorized wearable residual parameter packs require product-promotion evidence tiers."
    ),
    true,
  );
});

function wearablePack(input: {
  center: number;
  coefficient: number;
  family: MurphAgeWearableResidualParameterPack["family"];
  layerId: MurphAgeWearableResidualParameterPack["layerId"];
  metricKey: string;
  scale: number;
}): MurphAgeWearableResidualParameterPack {
  return {
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "provisional-local-research",
    family: input.family,
    featureWeights: [
      {
        center: input.center,
        coefficient: input.coefficient,
        metricKey: input.metricKey,
        scale: input.scale,
        transform: "center-scale",
      },
    ],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId: input.layerId,
    packHash: `sha256:${"c".repeat(64)}`,
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  };
}

function fixtureL1bResearchModel(): MurphAgeRiskModel {
  return {
    endpoint: "10-year all-cause mortality",
    features: [
      { coefficient: 0.04, key: "age", kind: "chronological-age", label: "Age" },
      {
        coefficient: 0.16,
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
    modelId: "fixture-l1b-glycemia-body-research-card-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.01 },
      { ageYears: 40, riskProbability: 0.03 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.3 },
    ],
    uncertainty: { baseYears: 2 },
  };
}

function metricPoint(
  metricKey: string,
  unit: string,
  value: number,
  sourceKind: MetricPoint["source"]["kind"],
): MetricPoint {
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: "2026-05-08",
    grain: "day",
    id: `metric-point:${metricKey}:2026-05-08:${sourceKind}:0`,
    metricKey,
    observedAt: "2026-05-08T08:00:00.000Z",
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: null,
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: "sample",
      kind: sourceKind,
      path: "test://murph-age-wearable-residual-layer",
      recordId: `${sourceKind}_${metricKey.replaceAll("-", "_")}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}
