import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildMurphAgeResearchCalculatorView,
  calculateMurphAgePublicReportFromSubmittedInputs,
  type MurphAgeRiskModel,
} from "@murphai/health-metrics/murph-age";

const REFERENCE_RISK_CURVE = [
  { ageYears: 20, riskProbability: 0.01 },
  { ageYears: 40, riskProbability: 0.03 },
  { ageYears: 60, riskProbability: 0.1 },
  { ageYears: 80, riskProbability: 0.3 },
] satisfies MurphAgeRiskModel["referenceRiskCurve"];

test("runs the L1 glycemia research card while keeping wearable inputs context-only", () => {
  const submitted = calculateMurphAgePublicReportFromSubmittedInputs({
    asOf: "2026-05-10T00:00:00.000Z",
    chronologicalAgeYears: 45,
    mode: "research",
    models: { l1_tiny_glycemia_10y_acm_research: fixtureL1GlycemiaResearchModel() },
    sex: "female",
    submittedMetrics: [
      { metricKey: "HbA1c", unit: "%", value: 5.4 },
      { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 9_800 },
    ],
  });
  const view = buildMurphAgeResearchCalculatorView(submitted);

  assert.equal(submitted.status, "ready");
  assert.equal(submitted.inputReadiness.bundle.bundleId, "l1-glycemia");
  assert.equal(submitted.inputReadiness.bundle.recommendedCardId, "l1_tiny_glycemia_10y_acm_research");
  assert.equal(submitted.result?.authorization.cardId, "l1_tiny_glycemia_10y_acm_research");
  assert.equal(submitted.result?.featureAttributions.some((feature) => feature.metricKey === "hba1c"), true);
  assert.equal(submitted.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  assert.equal(view.selectedCardId, "l1_tiny_glycemia_10y_acm_research");
  assert.equal(view.arbiter.selectedCardRole, "minimal-glycemia-first-pass");
  assert.equal(view.arbiter.selectionReason, "minimal-glycemia-selected");
  assert.equal(view.arbiter.wearableScorePolicy, "context-only-not-score-bearing");
});

function fixtureL1GlycemiaResearchModel(): MurphAgeRiskModel {
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
    ],
    horizonYears: 10,
    intercept: -4.7,
    modelId: "fixture-l1-glycemia-research-card-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: REFERENCE_RISK_CURVE,
    uncertainty: { baseYears: 2 },
  };
}
