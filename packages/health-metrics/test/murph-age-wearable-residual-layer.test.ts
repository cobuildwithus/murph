import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  applyMurphAgeWearableResidualLayer,
  assessMurphAgeWearableShadowIncrements,
  summarizeMurphAgeWearableResidualLayerContracts,
  type MetricPoint,
  type MurphAgeReferenceRiskPoint,
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
    packHash: "research-pack-activity-v1",
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
  assert.equal(application.parameterPackHash, "research-pack-activity-v1");
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
      evidenceTier: "true-external-validation",
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
      packHash: `research-pack-${testCase.family.replaceAll("-", "_")}-v1`,
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
