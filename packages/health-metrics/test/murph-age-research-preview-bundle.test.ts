import assert from "node:assert/strict";

import { test } from "vitest";

import {
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  buildMurphAgeModelsFromLocalModelCardArtifacts,
  buildMurphAgeResearchPreviewSubmittedCalculatorViewBundle,
  type MurphAgeLocalModelCardArtifact,
  type MurphAgeRiskModel,
  type MurphAgeWearableResidualParameterPack,
} from "../src/index.ts";

test("builds a product-blocked labs plus wearable research preview from model cards and residual packs", () => {
  const modelCard = fixtureL1bModelCard();
  const models = buildMurphAgeModelsFromLocalModelCardArtifacts([modelCard]);
  assert.equal(models.l1b_glycemia_body_10y_acm_research?.modelId, modelCard.model.modelId);

  const bundle = buildMurphAgeResearchPreviewSubmittedCalculatorViewBundle({
    asOf: "2026-05-24T00:00:00.000Z",
    chronologicalAgeYears: 45,
    modelCards: [modelCard],
    sex: "female",
    submittedMetrics: [
      { metricKey: "hba1c", sourceKind: "test-result", unit: "%", value: 5.4 },
      { metricKey: "bmi", sourceKind: "measurement", unit: "kg/m^2", value: 24.2 },
      { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 10_000 },
      { metricKey: "activity-minutes", sourceKind: "wearable-summary", unit: "minutes", value: 70 },
      { metricKey: "total-sleep-minutes", sourceKind: "sleep-summary", unit: "minutes", value: 450 },
      { metricKey: "resting-heart-rate", sourceKind: "wearable-summary", unit: "bpm", value: 54 },
      { metricKey: "hrv-rmssd", sourceKind: "wearable-summary", unit: "ms", value: 70 },
      { metricKey: "wearable-valid-day-count-28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
      { metricKey: "wearable-valid-night-count-28d", sourceKind: "sleep-summary", unit: "count", value: 22 },
      { metricKey: "wearable-coverage-index", sourceKind: "wearable-summary", unit: "score", value: 0.9 },
    ],
    wearableResidualParameterPacks: [
      wearablePack("activity", "activity-residual-v1", "steps", 8_000, 2_000, -0.04),
      wearablePack("sleep", "sleep-residual-v1", "total-sleep-minutes", 420, 30, -0.04),
      wearablePack("resting-heart-rate", "resting-heart-rate-residual-v1", "resting-heart-rate", 60, 10, 0.05),
      wearablePack("hrv", "hrv-residual-v1", "hrv-rmssd", 50, 20, -0.02),
    ],
  });

  assert.equal(bundle.product.view.ageEstimate?.biologicalAgeYears ?? null, null);
  assert.equal(bundle.product.view.product.ageDisplayReady, false);
  assert.equal(bundle.researchPreview?.view.status, "ready");
  assert.equal(bundle.researchPreview.view.selectedCardId, "l1b_glycemia_body_10y_acm_research");
  assert.equal(bundle.researchPreview.view.arbiter.wearableScorePolicy, "research-residual-shadow-product-blocked");
  assert.equal(bundle.researchPreview.view.layeredAgeEstimate?.status, "wearable-shadow-applied");
  assert.equal(
    bundle.researchPreview.view.model.layeredResearchPath.activeResearchScoreLayerIds.includes("wearable-multi-family-residual"),
    true,
  );
  assert.equal(bundle.researchPreview.view.product.productUseAuthorized, false);
  assert.equal(bundle.researchPreview.view.wearable.scoreBearing, false);
});

function fixtureL1bModelCard(): MurphAgeLocalModelCardArtifact {
  return {
    cardId: "l1b_glycemia_body_10y_acm_research",
    model: fixtureL1bResearchModel(),
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
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

function wearablePack(
  family: MurphAgeWearableResidualParameterPack["family"],
  layerId: MurphAgeWearableResidualParameterPack["layerId"],
  metricKey: string,
  center: number,
  scale: number,
  coefficient: number,
): MurphAgeWearableResidualParameterPack {
  return {
    anchorCardId: "l1b_glycemia_body_10y_acm_research",
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "provisional-local-research",
    family,
    featureWeights: [{
      center,
      coefficient,
      metricKey,
      scale,
      transform: "center-scale",
    }],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId,
    packHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  };
}
