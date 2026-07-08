import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { QUERY_DB_RELATIVE_PATH, openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  METRIC_POINT_SCHEMA_VERSION,
  normalizeMetricValue,
  type MetricPoint,
} from "@murphai/health-metrics";
import {
  MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  listMurphAgeInputBundleMetricKeys,
  listMurphAgeSubmittedCalculatorInputBundleSpecs,
  listMurphAgeSubmittedCalculatorMetricInputSpecs,
  listMurphAgeWearableBridgeFeatureSpecs,
  listMurphAgeWearableShadowIncrementPolicies,
  summarizeMurphAgeCalculatorOutput,
  summarizeMurphAgeCalculatorPublicOutput,
  type MurphAgeFunctionResidualParameterPack,
  type MurphAgeRiskModel,
  type MurphAgeScoreBearingCardId,
  type MurphAgeSubmittedMetricInput,
  type MurphAgeWearableResidualParameterPack,
} from "@murphai/health-metrics/murph-age";
import { rebuildQueryProjection } from "@murphai/query";
import {
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  assessMurphAgeInputReadinessFromVault,
  assessMurphAgeWearableShadowReadinessFromVault,
  calculateMurphAgeFromVaultInputBundle,
  calculateMurphAgePublicReportFromVaultInputBundle,
  calculateMurphAgeForVault,
  defaultMurphAgeModelCardArtifactRoot,
  getMurphAgeResearchPreviewForSubmittedInputs,
  getMurphAgeResearchPreviewForVault,
  getMurphAgeSubmittedCalculatorViewBundle,
  loadMurphAgeLocalModelCardArtifacts,
  metricPointFiltersForMurphAgeInputBundle,
  metricPointFiltersForMurphAgeModel,
  resolveMurphAgeModelCardArtifactRoot,
  summarizeMurphAgeFromVaultInputBundle,
} from "@murphai/query/murph-age";
import { test } from "vitest";

test("calculateMurphAgeForVault scores a low-level supplied model from stored MetricPoints", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
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
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-05-10",
        id: "metric-point:apob:2026-05-10:lab:0",
        metricKey: "apob",
        observedAt: "2026-05-10T23:59:00.000Z",
        recordId: "same_day_future_lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 300,
      }),
      metricPoint({
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-05-11",
        id: "metric-point:apob:2026-05-11:lab:0",
        metricKey: "apob",
        observedAt: "2026-05-11T08:00:00.000Z",
        recordId: "future_lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 300,
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
    ]);

    const filters = metricPointFiltersForMurphAgeModel(
      fixtureMurphAgeModel(),
      "2026-05-10T00:00:00.000Z",
    );
    assert.deepEqual(filters.map((filter) => filter.to), ["2026-05-10", "2026-05-10", "2026-05-10", "2026-05-10"]);
    assert.equal(filters.every((filter) => filter.limit === null), true);

    const result = await calculateMurphAgeForVault({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      model: fixtureMurphAgeModel(),
      sex: "male",
      vaultRoot,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.biologicalAgeYears, 42.1);
    assert.equal(result.ageDeltaYears, -2.9);
    assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "apob")?.value, 110);
    assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "steps")?.selectedPointIds[0], "metric-point:steps:2026-05-08:wearable:0");
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeForVault preserves flexible asOf compatibility", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
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
        id: "metric-point:steps:2026-05-08:wearable:0",
        metricKey: "steps",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_steps",
        sourceKind: "wearable-summary",
        unit: "count",
        value: 10_000,
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
    ]);

    const dateOnlyResult = await calculateMurphAgeForVault({
      asOf: "2026-05-10",
      chronologicalAgeYears: 45,
      model: fixtureMurphAgeModel(),
      sex: "male",
      vaultRoot,
    });
    const offsetResult = await calculateMurphAgeForVault({
      asOf: "2026-05-10T08:00:00+08:00",
      chronologicalAgeYears: 45,
      model: fixtureMurphAgeModel(),
      sex: "male",
      vaultRoot,
    });

    assert.equal(dateOnlyResult.status, "ready");
    assert.equal(offsetResult.status, "ready");
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle loads lab and wearable context but abstains in product mode", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
      ...functionContextMetricPoints(),
    ]);

    const filters = metricPointFiltersForMurphAgeInputBundle("2026-05-10T00:00:00.000Z");
    assert.equal(filters.every((filter) => filter.to === "2026-05-10"), true);
    assert.equal(filters.every((filter) => filter.limit === null), true);
    assert.equal(filters.some((filter) => filter.metricKey === "albumin"), true);
    assert.equal(filters.some((filter) => filter.metricKey === "steps"), true);
    assert.equal(filters.some((filter) => filter.metricKey === "hrv-rmssd"), true);
    assert.equal(filters.some((filter) => filter.metricKey === "adl-limitation-count"), true);
    assert.deepEqual(
      filters.map((filter) => filter.metricKey).sort(),
      [...listMurphAgeInputBundleMetricKeys()].sort(),
    );

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "abstain");
    assert.equal(output.mode, "product");
    assert.equal(output.result, null);
    assert.equal(output.authorization.cardId, "l1b_glycemia_body_10y_acm_research");
    assert.equal(output.authorization.productAuthorized, false);
    assert.equal(output.authorization.riskToAgeDisplayAuthorized, false);
    assert.equal(output.authorization.contextOnlyMetricKeys.includes("steps"), true);
    assert.equal(output.authorization.contextOnlyMetricKeys.includes("adl-limitation-count"), true);
    assert.equal(output.bundleAssessment.bundleId, "l1b-glycemia-body");
    assert.equal(output.cardPolicy?.cardId, "l1b_glycemia_body_10y_acm_research");
    assert.equal(output.warnings.some((warning) => warning.code === "MODEL_CARD_NOT_AUTHORIZED"), true);
    assert.equal(output.bundleAssessment.selectedPointIds.includes("metric-point:hba1c:2026-05-01:lab:0"), true);
    assert.equal(output.bundleAssessment.selectedPointIds.includes("metric-point:bmi:2026-05-08:measurement:0"), true);
    assert.equal(output.bundleAssessment.selectedPointIds.includes("metric-point:steps:2026-05-08:wearable:0"), false);
    assert.equal(output.contextAssessments[0]?.bundleId, "wearable-context");
    assert.equal(output.contextAssessments[0]?.selectedPointIds.includes("metric-point:steps:2026-05-08:wearable:0"), true);
    assert.equal(output.contextAssessments[1]?.bundleId, "function-context");
    assert.equal(
      output.contextAssessments[1]?.selectedPointIds.includes("metric-point:adl-limitation-count:2026-05-08:measurement:0"),
      true,
    );

    const publicReport = await calculateMurphAgePublicReportFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
    });
    assert.equal(publicReport.status, "abstain");
    assert.equal(publicReport.mode, "product");
    assert.equal(publicReport.result, null);
    assert.equal(publicReport.displaySummary.displayBlockedReason, "product-not-authorized");
    assert.equal(publicReport.displaySummary.validationGate?.status, "blocked");
    assert.equal(
      publicReport.displaySummary.productPromotionBlockers.includes("PRODUCT_POLICY_NOT_AUTHORIZED"),
      true,
    );
    assert.equal(publicReport.displaySummary.wearableBridge.productAuthorized, false);
    assert.equal(publicReport.inputReadiness.contextBundles.some((bundle) => bundle.bundleId === "function-context"), true);
    assert.equal(publicReport.warnings.some((warning) => warning.code === "MODEL_CARD_NOT_AUTHORIZED"), true);
    assert.equal(publicReport.warnings.some((warning) => "message" in warning), false);
    assert.equal("bundleAssessment" in publicReport, false);
    assert.equal("contextAssessments" in publicReport, false);
    assert.equal("wearableShadowIncrementAssessments" in publicReport, false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle keeps wearable registry metrics on the context-only path", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    const wearableMetricKeys = [
      ...new Set([
        ...listMurphAgeWearableBridgeFeatureSpecs().flatMap((spec) => spec.metricKeys),
        ...listMurphAgeWearableBridgeFeatureSpecs().flatMap((spec) => spec.requiredQualityMetricKeys),
        ...listMurphAgeWearableShadowIncrementPolicies().flatMap((policy) => policy.allowedMetricKeys),
        ...listMurphAgeWearableShadowIncrementPolicies().flatMap((policy) => policy.signalMetricKeys),
        ...listMurphAgeWearableShadowIncrementPolicies().flatMap((policy) => policy.requiredQualityMetricKeys),
      ]),
    ];
    insertMetricPoints(vaultRoot, wearableMetricKeys.map((metricKey) =>
      wearablePoint(metricKey, metricKey === "steps" ? null : `biomarker:${metricKey}`, 10, "count")
    ));

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.bundleAssessment.bundleId, "wearable-context");
    assert.equal(output.authorization.scoreBearing, false);
    assert.equal(output.authorization.wearableScoreBearingAuthorized, false);
    assert.equal(output.result, null);
    for (const metricKey of wearableMetricKeys) {
      assert.equal(
        output.authorization.contextOnlyMetricKeys.includes(metricKey),
        true,
        `wearable metric ${metricKey} must remain loadable as context-only`,
      );
    }
    assert.equal(output.authorization.scoreBearingMetricKeys.some((metricKey) => wearableMetricKeys.includes(metricKey)), false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle scores a research lab bundle without wearable score-bearing features", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "ready");
    assert.equal(output.bundleAssessment.bundleId, "lab9-bp-body");
    assert.equal(output.result?.status, "ready");
    assert.equal(output.result?.modelId, "fixture-lab9-research-model");
    assert.equal(output.authorization.evidenceClass, "research-internal");
    assert.equal(output.authorization.wearableScoreBearingAuthorized, false);
    assert.equal(output.result?.authorization.cardId, "lab9_bp_body_10y_acm_research");
    assert.equal(output.result?.authorization.contextOnlyMetricKeys.includes("resting-heart-rate"), true);
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
    assert.equal(output.contextAssessments[0]?.bundleId, "wearable-context");
    assert.equal(output.contextAssessments[0]?.selectedMetricKeys.includes("steps"), true);
    assert.equal(output.contextAssessments[0]?.selectedMetricKeys.includes("resting-heart-rate"), true);
    assert.equal(output.wearableShadowIncrementAssessments.length, 4);
    const activityShadow = output.wearableShadowIncrementAssessments.find((assessment) =>
      assessment.family === "activity"
    );
    assert.equal(activityShadow?.status, "ready");
    assert.equal(activityShadow?.scoreBearing, false);
    assert.equal(activityShadow?.scoreContributionAuthorized, false);
    assert.equal(activityShadow?.selectedMetricKeys.includes("steps"), true);
    assert.equal(activityShadow?.selectedMetricKeys.includes("wearable-coverage-index"), true);
    assert.equal(activityShadow?.selectedPointIds.includes("metric-point:steps:2026-05-08:wearable:0"), true);
    assert.equal(activityShadow ? "value" in activityShadow : true, false);
    assert.equal(activityShadow ? "unit" in activityShadow : true, false);
    const restingHeartRateShadow = output.wearableShadowIncrementAssessments.find((assessment) =>
      assessment.family === "resting-heart-rate"
    );
    assert.equal(restingHeartRateShadow?.status, "ready");
    const hrvShadow = output.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "hrv");
    assert.equal(hrvShadow?.status, "ready");
    const sleepShadow = output.wearableShadowIncrementAssessments.find((assessment) => assessment.family === "sleep");
    assert.equal(sleepShadow?.status, "missing");
    assert.equal(sleepShadow?.missingMetricKeys.includes("total-sleep-minutes"), true);
    const publicSummary = summarizeMurphAgeCalculatorPublicOutput(output);
    assert.equal("wearableShadowIncrementAssessments" in publicSummary, false);
    const publicReport = await calculateMurphAgePublicReportFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
    });
    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.mode, "research");
    assert.equal(publicReport.displaySummary.displayStatus, "research-only");
    assert.equal(publicReport.result?.biologicalAgeYears, output.result?.biologicalAgeYears);
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "albumin"), true);
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
    assert.equal(
      publicReport.result?.featureAttributions.some((feature) => "selectedPointIds" in feature),
      false,
    );
    assert.equal(publicReport.result?.featureAttributions.some((feature) => "value" in feature), false);
    assert.equal(publicReport.result?.moduleAttributions.some((module) => "contributionLogit" in module), false);
    assert.equal(publicReport.displaySummary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
    const contextStepStatus = output.contextAssessments[0]?.featureStatuses.find((status) => status.featureKey === "steps");
    assert.equal(contextStepStatus ? "value" in contextStepStatus : true, false);
    assert.equal(contextStepStatus ? "unit" in contextStepStatus : true, false);
    assert.equal(
      output.result?.featureAttributions.find((feature) => feature.featureKey === "albumin")?.selectedPointIds[0],
      "metric-point:albumin:2026-05-01:lab:0",
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle can use L1 glycemia as the wearable shadow anchor", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      labPoint("hba1c", "biomarker:hba1c", 5.3, "percent"),
      ...wearableContextMetricPoints(),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { l1_tiny_glycemia_10y_acm_research: fixtureL1GlycemiaResearchModel() },
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "ready");
    assert.equal(output.bundleAssessment.bundleId, "l1-glycemia");
    assert.equal(output.result?.authorization.cardId, "l1_tiny_glycemia_10y_acm_research");
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "hba1c"), true);
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);

    const activityShadow = output.wearableShadowIncrementAssessments.find((assessment) =>
      assessment.family === "activity"
    );
    assert.equal(activityShadow?.anchorCardId, "l1_tiny_glycemia_10y_acm_research");
    assert.equal(activityShadow?.anchorCompatible, true);
    assert.equal(activityShadow?.status, "ready");
    assert.equal(activityShadow?.scoreBearing, false);
    assert.equal(activityShadow?.scoreContributionAuthorized, false);
    assert.equal(activityShadow?.selectedMetricKeys.includes("steps"), true);

    const readiness = await assessMurphAgeWearableShadowReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(readiness.anchor.anchorCardId, "l1_tiny_glycemia_10y_acm_research");
    assert.equal(readiness.anchor.bundleId, "l1-glycemia");
    assert.equal(readiness.readyFamilies.includes("activity"), true);
    assert.equal(readiness.assessments.every((assessment) => assessment.productAuthorized === false), true);

    const encoded = JSON.stringify(readiness);
    for (const forbidden of [
      "metric-point:",
      "selectedPointIds",
      "\"value\"",
      "\"unit\"",
      "\"message\"",
      vaultRoot,
    ]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle carries a research-only wearable residual pack as shadow output", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
      wearableResidualParameterPack: fixtureActivityWearableResidualParameterPack(
        "lab9_bp_body_10y_acm_research",
      ),
    });

    assert.equal(output.status, "ready");
    assert.equal(output.result?.authorization.cardId, "lab9_bp_body_10y_acm_research");
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
    assert.equal(output.wearableResidualLayerApplication?.status, "research-parameterized-shadow-delta");
    assert.equal(output.wearableResidualLayerApplication?.parameterizationAvailable, true);
    assert.equal(output.wearableResidualLayerApplication?.parameterPackHash, FIXTURE_ACTIVITY_WEARABLE_PACK_HASH);
    assert.equal(output.wearableResidualLayerApplication?.residualDeltaLogit, -0.08);
    assert.equal(output.wearableResidualLayerApplication?.scoreBearing, false);
    assert.equal(output.wearableResidualLayerApplication?.scoreContributionAuthorized, false);
    assert.equal(output.wearableResidualLayerApplication?.selectedMetricKeys.includes("steps"), true);

    const publicReport = await calculateMurphAgePublicReportFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
      wearableResidualParameterPack: fixtureActivityWearableResidualParameterPack(
        "lab9_bp_body_10y_acm_research",
      ),
    });

    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.result?.risk?.probability, output.result?.risk?.probability);
    assert.equal(publicReport.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
    assert.equal(publicReport.wearableResidualLayer?.parameterizationAvailable, true);
    assert.equal(publicReport.wearableResidualLayer?.parameterPackHash, FIXTURE_ACTIVITY_WEARABLE_PACK_HASH);
    assert.equal(publicReport.wearableResidualLayer?.residualDeltaLogit, -0.08);
    assert.equal(publicReport.wearableResidualLayer?.scoreBearing, false);
    assert.equal(publicReport.wearableResidualLayer?.scoreContributionAuthorized, false);
    assert.equal(
      publicReport.wearableResidualLayer?.finalRiskProbability !== null
        && publicReport.wearableResidualLayer?.finalRiskProbability !== undefined
        && output.result?.risk?.probability !== undefined
        && publicReport.wearableResidualLayer.finalRiskProbability < output.result.risk.probability,
      true,
    );

    const encodedReport = JSON.stringify(publicReport);
    for (const forbidden of [
      vaultRoot,
      "metric-point:",
      "\"value\"",
      "\"unit\"",
      "\"message\"",
      "selectedPointIds",
      "coefficient",
      "10000",
    ]) {
      assert.equal(encodedReport.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assessMurphAgeWearableShadowReadinessFromVault reports sanitized shadow readiness", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-valid-night-count-28d", null, 21, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
      wearablePoint("total-sleep-minutes", null, 450, "minutes"),
      wearablePoint("sleep-duration-variability-minutes", null, 38, "minutes"),
      wearablePoint("sleep-regularity-score", null, 0.72, "score"),
      wearablePoint("sleep-midpoint-variability-minutes", null, 45, "minutes"),
    ]);

    const readiness = await assessMurphAgeWearableShadowReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(readiness.schemaVersion, "murph.age.wearable-shadow-readiness.v1");
    assert.equal(readiness.anchor.anchorCardId, "l1b_glycemia_body_10y_acm_research");
    assert.equal(readiness.anchor.bundleId, "l1b-glycemia-body");
    assert.deepEqual(readiness.blockedFamilies, []);
    assert.equal(readiness.readyFamilies.includes("activity"), true);
    assert.equal(readiness.readyFamilies.includes("sleep"), true);
    assert.equal(readiness.readyFamilies.includes("resting-heart-rate"), true);
    assert.equal(readiness.readyFamilies.includes("hrv"), true);

    const activity = readiness.assessments.find((assessment) => assessment.family === "activity");
    assert.equal(activity?.status, "ready");
    assert.equal(activity?.scoreBearing, false);
    assert.equal(activity?.scoreContributionAuthorized, false);
    assert.equal(activity?.productAuthorized, false);
    assert.equal(activity?.riskEffect, "not-estimated");
    assert.equal(activity?.selectedMetricKeys.includes("steps"), true);
    assert.equal(activity?.selectedMetricKeys.includes("wearable-coverage-index"), true);
    assert.equal(activity?.outputBoundary.aggregateOnly, true);
    assert.equal(activity?.outputBoundary.rowValuesExportAllowed, false);

    const encoded = JSON.stringify(readiness);
    for (const forbidden of [
      "metric-point:",
      "selectedPointIds",
      "\"value\"",
      "\"unit\"",
      "\"message\"",
      "modelId",
      "\"coefficient\"",
      "biologicalAgeYears",
      "featureAttributions",
      "moduleAttributions",
      vaultRoot,
    ]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assessMurphAgeWearableShadowReadinessFromVault blocks missing anchors without reading invalid asOf vaults", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...wearableContextMetricPoints(),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
    ]);

    const readiness = await assessMurphAgeWearableShadowReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(readiness.anchor.anchorCardId, null);
    assert.equal(readiness.anchor.bundleId, "wearable-context");
    assert.deepEqual(readiness.readyFamilies, []);
    assert.deepEqual(readiness.blockedFamilies.sort(), [
      "activity",
      "hrv",
      "resting-heart-rate",
      "sleep",
    ]);
    assert.equal(readiness.assessments.every((assessment) =>
      assessment.scoreBearing === false
        && assessment.scoreContributionAuthorized === false
        && assessment.productAuthorized === false
    ), true);

    const blockedEncoded = JSON.stringify(readiness);
    for (const forbidden of [
      "metric-point:",
      "selectedPointIds",
      "\"value\"",
      "\"unit\"",
      "\"message\"",
      "modelId",
      "\"coefficient\"",
      "biologicalAgeYears",
      "featureAttributions",
      "moduleAttributions",
      vaultRoot,
    ]) {
      assert.equal(blockedEncoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }

  const invalid = await assessMurphAgeWearableShadowReadinessFromVault({
    asOf: "not-a-date",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(invalid.schemaVersion, "murph.age.wearable-shadow-readiness.v1");
  assert.equal(invalid.anchor.anchorCardId, null);
  assert.equal(invalid.assessments.length, 0);
  assert.equal(invalid.warnings[0]?.code, "INVALID_INPUT");
  assert.equal(JSON.stringify(invalid).includes("\"message\""), false);
});

test("calculateMurphAgeFromVaultInputBundle loads ignored local research model-card artifacts", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);
    await writeLocalModelCardArtifact(vaultRoot, "lab9.json", {
      cardId: "lab9_bp_body_10y_acm_research",
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });

    const loaded = await loadMurphAgeLocalModelCardArtifacts({ vaultRoot });
    assert.equal(loaded.warnings.length, 0);
    assert.equal(loaded.models.lab9_bp_body_10y_acm_research?.modelId, "fixture-lab9-research-model");

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "ready");
    assert.equal(output.result?.modelId, "fixture-lab9-research-model");
    assert.equal(output.result?.authorization.evidenceClass, "research-internal");
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle can load server-scoped research model-card artifacts", async () => {
  const vaultRoot = await createProjectionVault();
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);
    await writeModelCardArtifact(modelCardArtifactRoot, "lab9.json", {
      cardId: "lab9_bp_body_10y_acm_research",
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });

    const loaded = await loadMurphAgeLocalModelCardArtifacts({
      modelCardArtifactRoot,
      vaultRoot,
    });
    assert.equal(loaded.warnings.length, 0);
    assert.equal(loaded.models.lab9_bp_body_10y_acm_research?.modelId, "fixture-lab9-research-model");

    const publicReport = await calculateMurphAgePublicReportFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      modelCardArtifactRoot,
      sex: "female",
      vaultRoot,
    });

    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.mode, "research");
    assert.equal(publicReport.displaySummary.displayStatus, "research-only");
    assert.equal(publicReport.authorization.productAuthorized, false);
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "hba1c"), true);
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);

    const encodedReport = JSON.stringify(publicReport);
    assert.equal(encodedReport.includes(modelCardArtifactRoot), false);
    assert.equal(encodedReport.includes(vaultRoot), false);
    assert.equal(encodedReport.includes("metric-point:"), false);
    assert.equal(encodedReport.includes("\"value\""), false);
    assert.equal(encodedReport.includes("fixture-lab9-research-model"), false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle can use configured shared research model-card root", async () => {
  const vaultRoot = await createProjectionVault();
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  const previousRoot = process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT;
  const previousOutputDir = process.env.MURPH_AGE_MODEL_CARD_OUTPUT_DIR;
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);
    await writeModelCardArtifact(modelCardArtifactRoot, "lab9.json", {
      cardId: "lab9_bp_body_10y_acm_research",
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });
    process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = modelCardArtifactRoot;

    assert.equal(resolveMurphAgeModelCardArtifactRoot({ vaultRoot }), modelCardArtifactRoot);
    delete process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT;
    process.env.MURPH_AGE_MODEL_CARD_OUTPUT_DIR = modelCardArtifactRoot;
    assert.equal(resolveMurphAgeModelCardArtifactRoot({ vaultRoot }), modelCardArtifactRoot);
    process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = modelCardArtifactRoot;

    const publicReport = await calculateMurphAgePublicReportFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.mode, "research");
    assert.equal(publicReport.displaySummary.displayStatus, "research-only");
    assert.equal(publicReport.researchCandidateCards.some((card) =>
      card.cardId === "lab9_bp_body_10y_acm_research" && card.modelLoaded && card.selected
    ), true);

    const encodedReport = JSON.stringify(publicReport);
    assert.equal(encodedReport.includes(modelCardArtifactRoot), false);
    assert.equal(encodedReport.includes(vaultRoot), false);
    assert.equal(encodedReport.includes("metric-point:"), false);
    assert.equal(encodedReport.includes("\"value\""), false);
    assert.equal(encodedReport.includes("fixture-lab9-research-model"), false);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT;
    } else {
      process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = previousRoot;
    }
    if (previousOutputDir === undefined) {
      delete process.env.MURPH_AGE_MODEL_CARD_OUTPUT_DIR;
    } else {
      process.env.MURPH_AGE_MODEL_CARD_OUTPUT_DIR = previousOutputDir;
    }
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
  }
});

test("getMurphAgeResearchPreviewForVault defaults to the shared research calculator surface", async () => {
  const vaultRoot = await createProjectionVault();
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  const previousRoot = process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT;
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);
    await writeModelCardArtifact(modelCardArtifactRoot, "lab9.json", {
      cardId: "lab9_bp_body_10y_acm_research",
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });
    process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = modelCardArtifactRoot;

    const publicReport = await getMurphAgeResearchPreviewForVault({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      sex: "female",
      vaultRoot,
    });

    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.mode, "research");
    assert.equal(publicReport.displaySummary.displayStatus, "research-only");
    assert.equal(publicReport.result?.authorization.cardId, "lab9_bp_body_10y_acm_research");
    assert.equal(JSON.stringify(publicReport).includes(modelCardArtifactRoot), false);
    assert.equal(JSON.stringify(publicReport).includes(vaultRoot), false);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT;
    } else {
      process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = previousRoot;
    }
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
  }
});

test("getMurphAgeResearchPreviewForSubmittedInputs scores sanitized submitted labs without a vault", async () => {
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  try {
    await writeModelCardArtifact(modelCardArtifactRoot, "lab5.json", {
      cardId: "lab5_bp_bmi_transport_research",
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });

    const publicReport = await getMurphAgeResearchPreviewForSubmittedInputs({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics: [
        { metricKey: "HbA1c", unit: "%", value: 5.3 },
        { metricKey: "HDL_C", unit: "mg/dL", value: 60 },
        { metricKey: "Triglycerides", unit: "mg/dL", value: 90 },
        { metricKey: "creatinine", unit: "mg/dL", value: 0.85 },
        { metricKey: "SBP", sourceKind: "measurement", unit: "mmHg", value: 118 },
        { metricKey: "diastolic_bp", sourceKind: "measurement", unit: "mmHg", value: 72 },
        { metricKey: "iadl-limitation-count", sourceKind: "measurement", unit: "count", value: 1 },
        { metricKey: "mobility-limitation-count", sourceKind: "measurement", unit: "count", value: 1 },
        { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 10_000 },
        { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 22 },
        { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.8 },
      ],
      functionResidualParameterPack: fixtureFunctionResidualParameterPack(
        "lab5_bp_bmi_transport_research",
      ),
      wearableResidualParameterPack: fixtureActivityWearableResidualParameterPack(
        "lab5_bp_bmi_transport_research",
      ),
    });

    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.mode, "research");
    assert.equal(publicReport.displaySummary.displayStatus, "research-only");
    assert.equal(publicReport.result?.authorization.cardId, "lab5_bp_bmi_transport_research");
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "hba1c"), true);
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
    assert.equal(publicReport.functionResidualLayer?.status, "research-parameterized-shadow-delta");
    assert.equal(publicReport.functionResidualLayer?.parameterizationAvailable, true);
    assert.equal(
      publicReport.functionResidualLayer?.parameterPackHash,
      "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    );
    assert.equal(publicReport.functionResidualLayer?.residualDeltaLogit, 0.1);
    assert.equal(publicReport.functionResidualLayer?.scoreBearing, false);
    assert.equal(publicReport.functionResidualLayer?.scoreContributionAuthorized, false);
    assert.equal(publicReport.functionResidualLayer?.selectedMetricKeys.includes("mobility-limitation-count"), true);
    const encodedFunctionResidualLayer = JSON.stringify(publicReport.functionResidualLayer);
    assert.equal(encodedFunctionResidualLayer.includes("finalRiskProbability"), false);
    assert.equal(encodedFunctionResidualLayer.includes("finalRiskAgeEquivalentYears"), false);
    assert.equal(encodedFunctionResidualLayer.includes("anchorRiskAgeEquivalentYears"), false);
    assert.equal(publicReport.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
    assert.equal(publicReport.wearableResidualLayer?.parameterizationAvailable, true);
    assert.equal(publicReport.wearableResidualLayer?.parameterPackHash, FIXTURE_ACTIVITY_WEARABLE_PACK_HASH);
    assert.equal(publicReport.wearableResidualLayer?.residualDeltaLogit, -0.08);
    assert.equal(publicReport.wearableResidualLayer?.scoreBearing, false);
    assert.equal(publicReport.wearableResidualLayer?.selectedMetricKeys.includes("steps"), true);
    assert.equal(publicReport.researchCandidateCards.some((card) =>
      card.cardId === "lab5_bp_bmi_transport_research" && card.modelLoaded && card.selected
    ), true);
    const multiWearableReport = await getMurphAgeResearchPreviewForSubmittedInputs({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics: [
        { metricKey: "HbA1c", unit: "%", value: 5.3 },
        { metricKey: "HDL_C", unit: "mg/dL", value: 60 },
        { metricKey: "Triglycerides", unit: "mg/dL", value: 90 },
        { metricKey: "creatinine", unit: "mg/dL", value: 0.85 },
        { metricKey: "SBP", sourceKind: "measurement", unit: "mmHg", value: 118 },
        { metricKey: "diastolic_bp", sourceKind: "measurement", unit: "mmHg", value: 72 },
        { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
        { metricKey: "total-sleep-minutes", sourceKind: "sleep-summary", unit: "minutes", value: 450 },
        { metricKey: "wearable_valid_night_count_28d", sourceKind: "sleep-summary", unit: "count", value: 22 },
        { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.91 },
        { metricKey: "resting-heart-rate", sourceKind: "wearable-summary", unit: "bpm", value: 54 },
        { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
        { metricKey: "hrv-rmssd", sourceKind: "wearable-summary", unit: "ms", value: 70 },
      ],
      wearableResidualParameterPacks: [
        fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
          center: 420,
          coefficient: -0.04,
          family: "sleep",
          layerId: "sleep-residual-v1",
          metricKey: "total-sleep-minutes",
          scale: 30,
        }),
        fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
          center: 60,
          coefficient: 0.05,
          family: "resting-heart-rate",
          layerId: "resting-heart-rate-residual-v1",
          metricKey: "resting-heart-rate",
          scale: 10,
        }),
        fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
          center: 50,
          coefficient: -0.02,
          family: "hrv",
          layerId: "hrv-residual-v1",
          metricKey: "hrv-rmssd",
          scale: 20,
        }),
      ],
    });
    assert.equal(multiWearableReport.wearableResidualLayer?.layerId, "multi-wearable-residual-v1");
    assert.equal(multiWearableReport.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
    assert.equal(multiWearableReport.wearableResidualLayer?.residualDeltaLogit, -0.09);
    assert.equal(multiWearableReport.wearableResidualLayer?.selectedMetricKeys.includes("total-sleep-minutes"), true);
    assert.equal(multiWearableReport.wearableResidualLayer?.selectedMetricKeys.includes("resting-heart-rate"), true);
    assert.equal(multiWearableReport.wearableResidualLayer?.selectedMetricKeys.includes("hrv-rmssd"), true);
    assert.equal(multiWearableReport.wearableResidualLayer?.scoreContributionAuthorized, false);
    const encodedReport = JSON.stringify(publicReport);
    assert.equal(encodedReport.includes(modelCardArtifactRoot), false);
    assert.equal(encodedReport.includes("fixture-lab5-research-model"), false);
    assert.equal(encodedReport.includes("metric-point:"), false);
    assert.equal(encodedReport.includes("\"value\""), false);
    assert.equal(encodedReport.includes("coefficient"), false);
    assert.equal(encodedReport.includes("10000"), false);
  } finally {
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
  }
});

test("getMurphAgeSubmittedCalculatorViewBundle loads local wearable packs into the research preview", async () => {
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  const wearablePackRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-wearable-pack-root-"));
  const emptyWearablePackRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-empty-wearable-pack-root-"));
  try {
    await writeModelCardArtifact(modelCardArtifactRoot, "lab5.json", {
      cardId: "lab5_bp_bmi_transport_research",
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });
    await writeWearableResidualParameterPack(
      wearablePackRoot,
      "activity.json",
      fixtureActivityWearableResidualParameterPack("lab5_bp_bmi_transport_research"),
    );
    await writeWearableResidualParameterPack(
      wearablePackRoot,
      "sleep.json",
      fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
        center: 420,
        coefficient: -0.04,
        family: "sleep",
        layerId: "sleep-residual-v1",
        metricKey: "total-sleep-minutes",
        scale: 30,
      }),
    );
    await writeWearableResidualParameterPack(
      wearablePackRoot,
      "resting-heart-rate.json",
      fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
        center: 60,
        coefficient: 0.05,
        family: "resting-heart-rate",
        layerId: "resting-heart-rate-residual-v1",
        metricKey: "resting-heart-rate",
        scale: 10,
      }),
    );
    await writeWearableResidualParameterPack(
      wearablePackRoot,
      "hrv.json",
      fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
        center: 50,
        coefficient: -0.02,
        family: "hrv",
        layerId: "hrv-residual-v1",
        metricKey: "hrv-rmssd",
        scale: 20,
      }),
    );
    const submittedMetrics: MurphAgeSubmittedMetricInput[] = [
      { metricKey: "HbA1c", unit: "%", value: 5.3 },
      { metricKey: "HDL_C", unit: "mg/dL", value: 60 },
      { metricKey: "Triglycerides", unit: "mg/dL", value: 90 },
      { metricKey: "creatinine", unit: "mg/dL", value: 0.85 },
      { metricKey: "SBP", sourceKind: "measurement", unit: "mmHg", value: 118 },
      { metricKey: "diastolic_bp", sourceKind: "measurement", unit: "mmHg", value: 72 },
      { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
      { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 10_000 },
      { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
      { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.91 },
      { metricKey: "total-sleep-minutes", sourceKind: "sleep-summary", unit: "minutes", value: 450 },
      { metricKey: "wearable_valid_night_count_28d", sourceKind: "sleep-summary", unit: "count", value: 22 },
      { metricKey: "resting-heart-rate", sourceKind: "wearable-summary", unit: "bpm", value: 54 },
      { metricKey: "hrv-rmssd", sourceKind: "wearable-summary", unit: "ms", value: 70 },
    ];

    const labOnlyBundle = await getMurphAgeSubmittedCalculatorViewBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      includeResearchPreview: true,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics,
      wearableResidualParameterPackRoot: emptyWearablePackRoot,
    });

    const bundle = await getMurphAgeSubmittedCalculatorViewBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      includeResearchPreview: true,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics,
      wearableResidualParameterPackRoot: wearablePackRoot,
    });

    const researchView = bundle.researchPreview?.view;
    const labOnlyResearchView = labOnlyBundle.researchPreview?.view;
    const labOnlyReportAge = labOnlyBundle.researchPreview?.report.result?.biologicalAgeYears;
    const residualPackReportAge = bundle.researchPreview?.report.result?.biologicalAgeYears;
    assert.equal(bundle.product.view.ageEstimate, null);
    assert.equal(bundle.product.view.scoreReadiness.status, "validation-pending");
    assert.equal(labOnlyResearchView?.model.wearable.researchScoreBearing, false);
    assert.equal(labOnlyResearchView?.layeredAgeEstimate?.appliedLayerIds.includes("wearable-multi-family-residual"), false);
    assert.equal(residualPackReportAge, labOnlyReportAge);
    assert.equal(researchView?.wearableResidualLayer?.layerId, "multi-wearable-residual-v1");
    assert.equal(researchView?.wearableResidualLayer?.status, "research-parameterized-shadow-delta");
    assert.equal(researchView?.wearableResidualLayer?.selectedMetricKeys.includes("steps"), true);
    assert.equal(researchView?.wearableResidualLayer?.selectedMetricKeys.includes("total-sleep-minutes"), true);
    assert.equal(researchView?.wearableResidualLayer?.selectedMetricKeys.includes("resting-heart-rate"), true);
    assert.equal(researchView?.wearableResidualLayer?.selectedMetricKeys.includes("hrv-rmssd"), true);
    assert.equal(researchView?.model.wearable.researchScoreBearing, true);
    assert.deepEqual(researchView?.layeredAgeEstimate?.appliedLayerIds, [
      "selected-lab-body-card",
      "wearable-multi-family-residual",
    ]);
    assert.notEqual(
      researchView?.ageEstimate?.biologicalAgeYears,
      labOnlyResearchView?.ageEstimate?.biologicalAgeYears,
    );
    assert.notEqual(researchView?.ageEstimate?.biologicalAgeYears, residualPackReportAge);
    assert.equal(
      researchView?.ageEstimate?.biologicalAgeYears,
      researchView?.wearableResidualLayer?.finalRiskAgeEquivalentYears,
    );
    assert.equal(researchView?.layeredAgeEstimate?.productAuthorized, false);
    assert.equal(researchView?.layeredAgeEstimate?.residualScoreContributionAuthorized, false);

    const encodedBundle = JSON.stringify(bundle);
    const encodedLabOnlyBundle = JSON.stringify(labOnlyBundle);
    assert.equal(encodedBundle.includes(modelCardArtifactRoot), false);
    assert.equal(encodedLabOnlyBundle.includes(modelCardArtifactRoot), false);
    assert.equal(encodedBundle.includes(wearablePackRoot), false);
    assert.equal(encodedLabOnlyBundle.includes(emptyWearablePackRoot), false);
    assert.equal(encodedBundle.includes("coefficient"), false);
    assert.equal(encodedLabOnlyBundle.includes("coefficient"), false);
    assert.equal(encodedBundle.includes("10000"), false);
    assert.equal(encodedLabOnlyBundle.includes("10000"), false);
  } finally {
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
    await rm(wearablePackRoot, { force: true, recursive: true });
    await rm(emptyWearablePackRoot, { force: true, recursive: true });
  }
});

test("explicit wearable packs win over implicit local wearable pack roots", async () => {
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  const wearablePackRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-wearable-pack-root-"));
  const previousPackRoot = process.env.MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_ROOT;
  try {
    await writeModelCardArtifact(modelCardArtifactRoot, "lab5.json", {
      cardId: "lab5_bp_bmi_transport_research",
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });
    await writeWearableResidualParameterPack(
      wearablePackRoot,
      "sleep.json",
      fixtureWearableResidualParameterPack("lab5_bp_bmi_transport_research", {
        center: 420,
        coefficient: -0.04,
        family: "sleep",
        layerId: "sleep-residual-v1",
        metricKey: "total-sleep-minutes",
        scale: 30,
      }),
    );
    process.env.MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_ROOT = wearablePackRoot;

    const publicReport = await getMurphAgeResearchPreviewForSubmittedInputs({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics: [
        { metricKey: "HbA1c", unit: "%", value: 5.3 },
        { metricKey: "HDL_C", unit: "mg/dL", value: 60 },
        { metricKey: "Triglycerides", unit: "mg/dL", value: 90 },
        { metricKey: "creatinine", unit: "mg/dL", value: 0.85 },
        { metricKey: "SBP", sourceKind: "measurement", unit: "mmHg", value: 118 },
        { metricKey: "diastolic_bp", sourceKind: "measurement", unit: "mmHg", value: 72 },
        { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
        { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 10_000 },
        { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
        { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.91 },
        { metricKey: "total-sleep-minutes", sourceKind: "sleep-summary", unit: "minutes", value: 450 },
        { metricKey: "wearable_valid_night_count_28d", sourceKind: "sleep-summary", unit: "count", value: 22 },
      ],
      wearableResidualParameterPack: fixtureActivityWearableResidualParameterPack(
        "lab5_bp_bmi_transport_research",
      ),
    });

    assert.equal(publicReport.wearableResidualLayer?.layerId, "activity-residual-v1");
    assert.equal(publicReport.wearableResidualLayer?.parameterPackHash, FIXTURE_ACTIVITY_WEARABLE_PACK_HASH);
    assert.equal(publicReport.wearableResidualLayer?.selectedMetricKeys.includes("steps"), true);
    assert.equal(publicReport.wearableResidualLayer?.selectedMetricKeys.includes("total-sleep-minutes"), false);
  } finally {
    if (previousPackRoot === undefined) {
      delete process.env.MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_ROOT;
    } else {
      process.env.MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_ROOT = previousPackRoot;
    }
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
    await rm(wearablePackRoot, { force: true, recursive: true });
  }
});

test("explicit wearable packs dedupe local packs by residual slot", async () => {
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  const wearablePackRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-wearable-pack-root-"));
  try {
    await writeModelCardArtifact(modelCardArtifactRoot, "lab5.json", {
      cardId: "lab5_bp_bmi_transport_research",
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });
    await writeWearableResidualParameterPack(
      wearablePackRoot,
      "activity-duplicate.json",
      {
        ...fixtureActivityWearableResidualParameterPack("lab5_bp_bmi_transport_research"),
        featureWeights: [{
          center: 8_000,
          coefficient: -0.2,
          metricKey: "steps",
          scale: 2_000,
          transform: "center-scale",
        }],
        packHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
    );

    const publicReport = await getMurphAgeResearchPreviewForSubmittedInputs({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics: [
        { metricKey: "HbA1c", unit: "%", value: 5.3 },
        { metricKey: "HDL_C", unit: "mg/dL", value: 60 },
        { metricKey: "Triglycerides", unit: "mg/dL", value: 90 },
        { metricKey: "creatinine", unit: "mg/dL", value: 0.85 },
        { metricKey: "SBP", sourceKind: "measurement", unit: "mmHg", value: 118 },
        { metricKey: "diastolic_bp", sourceKind: "measurement", unit: "mmHg", value: 72 },
        { metricKey: "body_mass_index", sourceKind: "measurement", unit: "kg/m2", value: 23.2 },
        { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 10_000 },
        { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 24 },
        { metricKey: "wearable_coverage_index", sourceKind: "wearable-summary", unit: "score", value: 0.91 },
      ],
      wearableResidualParameterPack: fixtureActivityWearableResidualParameterPack(
        "lab5_bp_bmi_transport_research",
      ),
      wearableResidualParameterPackRoot: wearablePackRoot,
    });

    assert.equal(publicReport.wearableResidualLayer?.layerId, "activity-residual-v1");
    assert.equal(publicReport.wearableResidualLayer?.parameterPackHash, FIXTURE_ACTIVITY_WEARABLE_PACK_HASH);
    assert.equal(publicReport.wearableResidualLayer?.residualDeltaLogit, -0.08);
  } finally {
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
    await rm(wearablePackRoot, { force: true, recursive: true });
  }
});

test("getMurphAgeSubmittedCalculatorViewBundle returns product-safe output plus research preview", async () => {
  const modelCardArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-model-card-root-"));
  try {
    await writeModelCardArtifact(modelCardArtifactRoot, "lab5.json", {
      cardId: "lab5_bp_bmi_transport_research",
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });

    const submittedMetrics = [
      { metricKey: "HbA1c", unit: "%", value: 5.3 },
      { metricKey: "HDL_C", unit: "mg/dL", value: 60 },
      { metricKey: "Triglycerides", unit: "mg/dL", value: 90 },
      { metricKey: "creatinine", unit: "mg/dL", value: 0.85 },
      { metricKey: "SBP", sourceKind: "measurement", unit: "mmHg", value: 118 },
      { metricKey: "diastolic_bp", sourceKind: "measurement", unit: "mmHg", value: 72 },
      { metricKey: "steps", sourceKind: "wearable-summary", unit: "count", value: 10_000 },
      { metricKey: "wearable_valid_day_count_28d", sourceKind: "wearable-summary", unit: "count", value: 22 },
      { metricKey: "sleep_duration_hours", sourceKind: "sleep-summary", unit: "h", value: 7.4 },
      { metricKey: "resting_heart_rate", sourceKind: "wearable-summary", unit: "bpm", value: 58 },
      { metricKey: "hrv-rmssd", sourceKind: "wearable-summary", unit: "ms", value: 47 },
    ] as const;
    const wearableResidualParameterPack = fixtureActivityWearableResidualParameterPack(
      "lab5_bp_bmi_transport_research",
    );
    const bundle = await getMurphAgeSubmittedCalculatorViewBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      includeResearchPreview: true,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics,
      wearableResidualParameterPack,
    });

    assert.equal(bundle.product.report.mode, "product");
    assert.equal(bundle.product.report.displaySummary.displayStatus, "abstain");
    assert.equal(bundle.product.view.displayStatus, "abstain");
    assert.equal(bundle.product.view.ageEstimate, null);
    assert.equal(bundle.product.view.risk.probability, null);
    assert.equal(bundle.product.view.selectedCardId, null);
    assert.equal(bundle.product.report.result, null);
    assert.equal(bundle.researchPreview?.report.mode, "research");
    assert.equal(bundle.researchPreview?.view.researchOnly, true);
    assert.equal(bundle.researchPreview?.view.selectedCardId, "lab5_bp_bmi_transport_research");
    assert.equal(typeof bundle.researchPreview?.view.ageEstimate?.biologicalAgeYears, "number");
    assert.equal(bundle.researchPreview?.view.product.productUseAuthorized, false);
    assert.equal(bundle.researchPreview?.report.result?.authorization.cardId, "lab5_bp_bmi_transport_research");
    assert.equal(bundle.researchPreview?.report.wearableResidualLayer?.scoreBearing, false);
    assert.equal(bundle.capabilities.acceptedMetricKeys.includes("hba1c"), true);
    assert.equal(bundle.capabilities.acceptedMetricKeys.includes("steps"), true);
    assert.deepEqual(bundle.inputBundleSpecs, listMurphAgeSubmittedCalculatorInputBundleSpecs());
    assert.deepEqual(bundle.metricInputSpecs, listMurphAgeSubmittedCalculatorMetricInputSpecs());
    assert.equal(
      bundle.inputBundleSpecs.some((spec) =>
        spec.bundleId === "wearable-context" && spec.scoreBearing === false
      ),
      true,
    );
    const submittedMetricSpecByKey = new Map(
      bundle.metricInputSpecs.map((spec) => [spec.metricKey, spec]),
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
      submittedMetricSpecByKey.get("hrv-rmssd")?.calculatorRoles.includes("wearable-context"),
      true,
    );
    assert.equal(
      submittedMetricSpecByKey.get("hrv-rmssd")?.wearableScoreBearingAuthorized,
      false,
    );
    for (const spec of bundle.metricInputSpecs.filter((inputSpec) =>
      inputSpec.calculatorRoles.includes("wearable-context")
    )) {
      assert.deepEqual(spec.researchScoreBearingCardIds, []);
      assert.equal(spec.productScoreBearingAuthorized, false);
      assert.equal(spec.wearableScoreBearingAuthorized, false);
    }
    assert.deepEqual(bundle.capabilities.outputBoundary, {
      modelParametersExportAllowed: false,
      participantLevelExportAllowed: false,
      productScoreDisplayAuthorized: false,
      researchPreviewRequiresExplicitOptIn: true,
      rowValuesExportAllowed: false,
      submittedMetricScalarEchoAllowed: false,
    });
    const productOnlyBundle = await getMurphAgeSubmittedCalculatorViewBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      includeResearchPreview: false,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics,
      wearableResidualParameterPack,
    });
    const defaultBundle = await getMurphAgeSubmittedCalculatorViewBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics,
      wearableResidualParameterPack,
    });
    assert.equal(productOnlyBundle.researchPreview, null);
    assert.equal(defaultBundle.product.view.selectedCardId, null);
    assert.equal(defaultBundle.researchPreview, null);
    const defaultWarningCount = defaultBundle.product.report.warnings.length;
    await writeFile(path.join(modelCardArtifactRoot, "invalid.json"), "{");
    const productOnlyWithInvalidResearchRoot = await getMurphAgeSubmittedCalculatorViewBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      modelCardArtifactRoot,
      sex: "female",
      submittedMetrics,
    });
    assert.equal(productOnlyWithInvalidResearchRoot.product.report.warnings.length, defaultWarningCount);
    assert.equal(productOnlyWithInvalidResearchRoot.product.report.result, null);
    assert.equal(productOnlyWithInvalidResearchRoot.researchPreview, null);
    const encodedBundle = JSON.stringify(bundle);
    assert.equal(encodedBundle.includes(modelCardArtifactRoot), false);
    assert.equal(encodedBundle.includes("fixture-lab5-research-model"), false);
    assert.equal(encodedBundle.includes("metric-point:"), false);
    assert.equal(encodedBundle.includes("\"value\""), false);
    assert.equal(encodedBundle.includes("coefficient"), false);
    assert.equal(encodedBundle.includes("10000"), false);
  } finally {
    await rm(modelCardArtifactRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle scores the explicit R399 local anchor artifact", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...r399ProxyMetricPoints(),
      ...wearableContextMetricPoints(),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
    ]);
    await writeLocalModelCardArtifact(vaultRoot, "r399.json", {
      cardId: "r399_nhis_proxy_10y_acm_research",
      model: fixtureR399ProxyResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      cardId: "r399_nhis_proxy_10y_acm_research",
      chronologicalAgeYears: 52,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "ready");
    assert.equal(output.bundleAssessment.bundleId, "r399-nhis-proxy-anchor");
    assert.equal(output.cardPolicy?.cardId, "r399_nhis_proxy_10y_acm_research");
    assert.equal(output.result?.modelId, "fixture-r399-proxy-anchor-model");
    assert.equal(output.result?.authorization.cardId, "r399_nhis_proxy_10y_acm_research");
    assert.equal(output.result?.authorization.productAuthorized, false);
    assert.equal(output.result?.authorization.riskToAgeDisplayAuthorized, false);
    assert.equal(output.authorization.contextOnlyMetricKeys.includes("steps"), true);
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "bmi"), true);
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "self-rated-health"), true);
    assert.equal(output.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);

    const publicReport = await calculateMurphAgePublicReportFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      cardId: "r399_nhis_proxy_10y_acm_research",
      chronologicalAgeYears: 52,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(publicReport.status, "ready");
    assert.equal(publicReport.displaySummary.displayStatus, "research-only");
    assert.equal(publicReport.inputReadiness.bundle.bundleId, "r399-nhis-proxy-anchor");
    assert.equal(publicReport.result?.authorization.cardId, "r399_nhis_proxy_10y_acm_research");
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.status === "imputed"), true);
    assert.equal(publicReport.result?.featureAttributions.some((feature) => feature.metricKey === "steps"), false);
    assert.equal(publicReport.displaySummary.contextOnlyMetricKeys.includes("steps"), true);
    assert.equal(JSON.stringify(publicReport).includes("metric-point:"), false);
    assert.equal(JSON.stringify(publicReport).includes("\"value\""), false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assessMurphAgeInputReadinessFromVault reports input readiness without values or point ids", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);

    const readiness = await assessMurphAgeInputReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(readiness.schemaVersion, "murph.age.input-readiness.v5");
    assert.deepEqual(readiness.runtimeInputs, [
      {
        key: "chronological-age-years",
        label: "Chronological age",
        required: true,
        source: "runtime-option",
        status: "required",
      },
      {
        key: "sex",
        label: "Sex",
        required: true,
        source: "runtime-option",
        status: "required",
      },
    ]);
    assert.equal(readiness.bundle.bundleId, "l1b-glycemia-body");
    assert.equal(readiness.bundle.status, "ready");
    assert.equal(readiness.bundle.recommendedCardId, "l1b_glycemia_body_10y_acm_research");
    assert.deepEqual(readiness.inputBundleSpecs.map((spec) => spec.bundleId), [
      "l1b-glycemia-body",
      "lab9-bp-body",
      "lab5-bp-bmi",
      "l1-glycemia",
      "r399-nhis-proxy-anchor",
      "wearable-context",
      "function-context",
    ]);
    assert.equal(
      readiness.inputBundleSpecs.find((spec) => spec.bundleId === "lab9-bp-body")
        ?.completion.requiredFeatureKeys.includes("albumin"),
      true,
    );
    assert.equal(
      readiness.inputBundleSpecs.find((spec) => spec.bundleId === "wearable-context")
        ?.scoreBearing,
      false,
    );
    assert.deepEqual(readiness.scoreReadiness, {
      bundleId: "l1b-glycemia-body",
      contextOnly: false,
      inputReady: true,
      productAgePolicyReady: false,
      productBlockedReasons: [
        "PRODUCT_POLICY_NOT_AUTHORIZED",
        "VALIDATION_GATE_BLOCKED",
        "PRODUCT_PROMOTION_EVIDENCE_MISSING",
        "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING",
        "RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED",
      ],
      productPromotionBlockers: [
        "PRODUCT_POLICY_NOT_AUTHORIZED",
        "VALIDATION_GATE_BLOCKED",
        "PRODUCT_PROMOTION_EVIDENCE_MISSING",
        "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING",
        "RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED",
      ],
      productRiskPolicyReady: false,
      recommendedCardId: "l1b_glycemia_body_10y_acm_research",
      researchModelCardRequired: true,
      researchReadiness: "ready-if-local-model-card-loaded",
      researchUsableIfModelLoaded: true,
      scoreBearingInput: true,
      status: "research-ready-product-blocked",
    });
    assert.deepEqual(readiness.bundle.availableFeatureKeys.sort(), ["bmi", "glycemia"]);
    assert.equal(readiness.bundle.selectedMetricKeys.includes("hba1c"), true);
    assert.equal(readiness.bundle.selectedMetricKeys.includes("bmi"), true);
    assert.equal(readiness.contextBundles[0]?.bundleId, "wearable-context");
    assert.equal(readiness.contextBundles[0]?.selectedMetricKeys.includes("steps"), true);
    assert.equal(readiness.wearableBridge.scoreBearing, false);
    assert.equal(readiness.wearableBridge.scoreContributionAuthorized, false);
    assert.equal(readiness.wearableBridge.productAuthorized, false);
    assert.equal(readiness.wearableBridge.partialFeatureKeys.includes("activity-volume"), true);
    assert.equal(readiness.wearableBridge.features.some((feature) =>
      feature.featureKey === "activity-volume"
        && feature.readyMetricKeys.includes("steps")
        && feature.scoreBearing === false
        && feature.scoreContributionAuthorized === false
        && feature.productAuthorized === false
        && feature.riskEffect === "not-estimated"
        && feature.uncertaintyAction === "context-only"
    ), true);

    const encoded = JSON.stringify(readiness);
    for (const forbidden of [
      "selectedPointIds",
      "metric-point:",
      "\"value\"",
      "\"unit\"",
      vaultRoot,
    ]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assessMurphAgeInputReadinessFromVault reports empty vault readiness without leaking paths", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);

    const readiness = await assessMurphAgeInputReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(readiness.schemaVersion, "murph.age.input-readiness.v5");
    assert.deepEqual(readiness.runtimeInputs.map((input) => input.key), ["chronological-age-years", "sex"]);
    assert.equal(readiness.inputBundleSpecs.some((spec) => spec.bundleId === "lab9-bp-body"), true);
    assert.equal(readiness.bundle.bundleId, "insufficient");
    assert.equal(readiness.bundle.status, "abstain");
    assert.equal(readiness.bundle.recommendedCardId, "none");
    assert.deepEqual(readiness.scoreReadiness, {
      bundleId: "insufficient",
      contextOnly: false,
      inputReady: false,
      productAgePolicyReady: false,
      productBlockedReasons: ["INPUT_BUNDLE_INCOMPLETE"],
      productPromotionBlockers: [],
      productRiskPolicyReady: false,
      recommendedCardId: "none",
      researchModelCardRequired: false,
      researchReadiness: "input-incomplete",
      researchUsableIfModelLoaded: false,
      scoreBearingInput: false,
      status: "input-incomplete",
    });
    assert.deepEqual(readiness.bundle.availableFeatureKeys, []);
    assert.deepEqual(readiness.bundle.selectedMetricKeys, []);
    assert.equal(readiness.contextBundles.length, 0);
    assert.deepEqual(readiness.wearableBridge.readyFeatureKeys, []);
    assert.equal(readiness.wearableBridge.scoreBearing, false);
    assert.equal(readiness.wearableBridge.scoreContributionAuthorized, false);
    assert.equal(readiness.wearableBridge.productAuthorized, false);

    const encoded = JSON.stringify(readiness);
    for (const forbidden of [
      "selectedPointIds",
      "metric-point:",
      "\"value\"",
      "\"unit\"",
      vaultRoot,
      "ledger/events",
    ]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assessMurphAgeInputReadinessFromVault reports context-only and invalid asOf score readiness", async () => {
  const wearableVaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(wearableVaultRoot);
    insertMetricPoints(wearableVaultRoot, wearableContextMetricPoints());

    const wearableReadiness = await assessMurphAgeInputReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot: wearableVaultRoot,
    });

    assert.equal(wearableReadiness.bundle.bundleId, "wearable-context");
    assert.equal(wearableReadiness.bundle.status, "context-only");
    assert.deepEqual(wearableReadiness.scoreReadiness, {
      bundleId: "wearable-context",
      contextOnly: true,
      inputReady: true,
      productAgePolicyReady: false,
      productBlockedReasons: ["CONTEXT_ONLY_NOT_SCORE_BEARING"],
      productPromotionBlockers: [],
      productRiskPolicyReady: false,
      recommendedCardId: "wearable_context_no_risk",
      researchModelCardRequired: false,
      researchReadiness: "context-only",
      researchUsableIfModelLoaded: false,
      scoreBearingInput: false,
      status: "context-only",
    });
  } finally {
    await rm(wearableVaultRoot, { force: true, recursive: true });
  }

  const functionVaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(functionVaultRoot);
    insertMetricPoints(functionVaultRoot, functionContextMetricPoints());

    const functionReadiness = await assessMurphAgeInputReadinessFromVault({
      asOf: "2026-05-10T00:00:00.000Z",
      vaultRoot: functionVaultRoot,
    });

    assert.equal(functionReadiness.bundle.bundleId, "function-context");
    assert.equal(functionReadiness.bundle.status, "context-only");
    assert.deepEqual(functionReadiness.scoreReadiness, {
      bundleId: "function-context",
      contextOnly: true,
      inputReady: true,
      productAgePolicyReady: false,
      productBlockedReasons: ["CONTEXT_ONLY_NOT_SCORE_BEARING"],
      productPromotionBlockers: [],
      productRiskPolicyReady: false,
      recommendedCardId: "function_context_no_risk",
      researchModelCardRequired: false,
      researchReadiness: "context-only",
      researchUsableIfModelLoaded: false,
      scoreBearingInput: false,
      status: "context-only",
    });
  } finally {
    await rm(functionVaultRoot, { force: true, recursive: true });
  }

  const invalidReadiness = await assessMurphAgeInputReadinessFromVault({
    asOf: "not-a-date",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(invalidReadiness.schemaVersion, "murph.age.input-readiness.v5");
  assert.equal(invalidReadiness.inputBundleSpecs.some((spec) => spec.bundleId === "wearable-context"), true);
  assert.equal(invalidReadiness.bundle.bundleId, "insufficient");
  assert.equal(invalidReadiness.bundle.warnings[0]?.code, "INVALID_INPUT");
  assert.deepEqual(invalidReadiness.scoreReadiness, {
    bundleId: "insufficient",
    contextOnly: false,
    inputReady: false,
    productAgePolicyReady: false,
    productBlockedReasons: ["INPUT_BUNDLE_INCOMPLETE"],
    productPromotionBlockers: [],
    productRiskPolicyReady: false,
    recommendedCardId: "none",
    researchModelCardRequired: false,
    researchReadiness: "input-incomplete",
    researchUsableIfModelLoaded: false,
    scoreBearingInput: false,
    status: "input-incomplete",
  });
});

test("calculateMurphAgeFromVaultInputBundle ignores local model-card artifacts in product mode", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);
    const modelCardRoot = defaultMurphAgeModelCardArtifactRoot(vaultRoot);
    await mkdir(modelCardRoot, { recursive: true });
    await writeFile(path.join(modelCardRoot, "malformed.json"), "{");

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "abstain");
    assert.equal(output.mode, "product");
    assert.equal(output.result, null);
    assert.equal(output.warnings.some((warning) => warning.code === "MODEL_CARD_NOT_AUTHORIZED"), true);
    assert.equal(output.warnings.some((warning) => warning.message.includes("not valid JSON")), false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle rejects local artifacts that add unauthorized score-bearing metrics", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ]);
    await writeLocalModelCardArtifact(vaultRoot, "lab9-invalid.json", {
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

    const loaded = await loadMurphAgeLocalModelCardArtifacts({ vaultRoot });
    assert.equal(loaded.models.lab9_bp_body_10y_acm_research, undefined);
    assert.equal(loaded.warnings.some((warning) => warning.code === "MODEL_CARD_POLICY_VIOLATION"), true);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "abstain");
    assert.equal(output.result, null);
    assert.equal(output.warnings.some((warning) => warning.code === "MODEL_CARD_POLICY_VIOLATION"), true);
    assert.equal(output.warnings.some((warning) => warning.message.includes("Steps")), false);
    assert.equal(output.warnings.some((warning) => warning.message.includes("no matching score-bearing model")), true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("loadMurphAgeLocalModelCardArtifacts skips missing and malformed local artifacts", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    const missing = await loadMurphAgeLocalModelCardArtifacts({ vaultRoot });
    assert.deepEqual(missing, { models: {}, warnings: [] });

    const root = defaultMurphAgeModelCardArtifactRoot(vaultRoot);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "ignored.txt"), "not a model card\n");
    await writeFile(path.join(root, "invalid-json.json"), "{");
    await writeFile(path.join(root, "invalid-schema.json"), JSON.stringify({ schemaVersion: "wrong" }));
    await writeLocalModelCardArtifact(vaultRoot, "valid.json", {
      cardId: "lab9_bp_body_10y_acm_research",
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    });

    const loaded = await loadMurphAgeLocalModelCardArtifacts({ vaultRoot });
    assert.equal(loaded.models.lab9_bp_body_10y_acm_research?.modelId, "fixture-lab9-research-model");
    assert.equal(loaded.warnings.length, 2);
    assert.equal(loaded.warnings.every((warning) => warning.code === "INVALID_INPUT"), true);
    assert.equal(loaded.warnings.some((warning) => warning.message.includes("not valid JSON")), true);
    assert.equal(loaded.warnings.some((warning) => warning.message.includes("expected schema")), true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle treats wearable-only inputs as context-only", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, wearableContextMetricPoints());

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(output.bundleAssessment.bundleId, "wearable-context");
    assert.equal(output.cardPolicy?.cardId, "wearable_context_no_risk");
    assert.equal(output.result, null);
    assert.equal(output.bundleAssessment.selectedPointIds.includes("metric-point:steps:2026-05-08:wearable:0"), true);
    assert.equal(output.contextAssessments.length, 0);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle accepts activity and sleep summary wearable context", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      wearablePoint("steps", null, 10_000, "count", "activity-summary"),
      wearablePoint("total-sleep-minutes", null, 450, "minutes", "sleep-summary"),
      wearablePoint("sleep-efficiency", null, 91, "percent", "sleep-summary"),
      wearablePoint("sleep-duration-variability-minutes", null, 32, "minutes", "sleep-summary"),
      wearablePoint("resting-heart-rate", "biomarker:resting-heart-rate", 62, "bpm"),
      wearablePoint("hrv-rmssd", "biomarker:hrv-rmssd", 48, "ms"),
      wearablePoint("wearable-valid-day-count-28d", null, 25, "count"),
      wearablePoint("wearable-valid-night-count-28d", null, 24, "count"),
      wearablePoint("wearable-coverage-index", null, 0.86, "ratio"),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(output.bundleAssessment.bundleId, "wearable-context");
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("steps"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("total-sleep-minutes"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("sleep-efficiency"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("sleep-duration-variability-minutes"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("resting-heart-rate"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("hrv-rmssd"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("wearable-valid-day-count-28d"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("wearable-valid-night-count-28d"), true);
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("wearable-coverage-index"), true);

    const summary = summarizeMurphAgeCalculatorOutput(output);
    assert.equal(summary.displayStatus, "context-only");
    assert.equal(summary.wearableContext.quality, "strong-context");
    assert.equal(summary.wearableContext.scoreBearing, false);
    assert.equal(summary.wearableContext.scoreContributionAuthorized, false);
    assert.equal(summary.wearableContext.riskEffect, "not-estimated");
    assert.equal(summary.wearableContext.availableFeatureFamilies.includes("activity"), true);
    assert.equal(summary.wearableContext.availableFeatureFamilies.includes("sleep"), true);
    assert.equal(summary.wearableContext.availableFeatureFamilies.includes("recovery"), true);
    assert.equal(summary.wearableContext.availableFeatureFamilies.includes("quality"), true);
    assert.equal(summary.wearableContext.missingQualityFeatureKeys.length, 0);
    assert.equal(summary.wearableBridge.scoreBearing, false);
    assert.equal(summary.wearableBridge.scoreContributionAuthorized, false);
    assert.equal(summary.wearableBridge.productAuthorized, false);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("sleep-duration-regularity"), true);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("hrv-rmssd"), true);
    assert.equal(summary.wearableBridge.deferredFeatureKeys.includes("hrv-rmssd"), true);
    assert.equal(summary.wearableBridge.missingFeatureKeys.includes("estimated-vo2-max"), true);

    const publicSummary = summarizeMurphAgeCalculatorPublicOutput(output);
    assert.equal(publicSummary.displayStatus, "context-only");
    assert.equal(publicSummary.contextOnlyMetricKeys.includes("wearable-coverage-index"), true);
    assert.equal(publicSummary.wearableContext.readyPointCount, 9);
    assert.equal(publicSummary.wearableBridge.readyFeatureKeys.includes("hrv-rmssd"), true);
    assert.equal(publicSummary.wearableBridge.features.some((feature) => "selectedPointIds" in feature), false);
    assert.equal(publicSummary.wearableBridge.features.every((feature) => feature.productAuthorized === false), true);
    assert.equal("contextOnlyPointIds" in publicSummary, false);
    assert.equal("selectedScoreBearingPointIds" in publicSummary, false);

    const queryPublicSummary = await summarizeMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });
    assert.deepEqual(queryPublicSummary, publicSummary);
    assert.equal("contextOnlyPointIds" in queryPublicSummary, false);
    assert.equal("selectedScoreBearingPointIds" in queryPublicSummary, false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle derives wearable coverage against report asOf", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, wearableCoverageWindowDates("2026-04-11", 28).flatMap((date) => [
      wearablePointOnDate("steps", null, 10_000, "count", date, "activity-summary"),
      wearablePointOnDate("resting-heart-rate", "biomarker:resting-heart-rate", 62, "bpm", date),
      wearablePointOnDate("hrv-rmssd", "biomarker:hrv-rmssd", 48, "ms", date),
      wearablePointOnDate("total-sleep-minutes", null, 450, "minutes", date, "wearable-summary"),
    ]));

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(wearableFeatureValue(output, "wearable-valid-day-count-28d"), 26);
    assert.equal(wearableFeatureValue(output, "wearable-valid-night-count-28d"), 26);
    assert.equal(wearableFeatureValue(output, "wearable-coverage-index"), 0.9286);
    const summary = summarizeMurphAgeCalculatorOutput(output);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("wearable-coverage-quality"), true);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("activity-volume"), true);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("sleep-duration-regularity"), true);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("resting-heart-rate"), true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }

  const thinVaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(thinVaultRoot);
    insertMetricPoints(thinVaultRoot, wearableCoverageWindowDates("2026-04-28", 13).flatMap((date) => [
      wearablePointOnDate("steps", null, 10_000, "count", date, "activity-summary"),
      wearablePointOnDate("total-sleep-minutes", null, 450, "minutes", date, "sleep-summary"),
    ]));

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot: thinVaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(wearableFeatureValue(output, "wearable-valid-day-count-28d"), null);
    assert.equal(wearableFeatureValue(output, "wearable-valid-night-count-28d"), null);
    assert.equal(wearableFeatureValue(output, "wearable-coverage-index"), null);
    const summary = summarizeMurphAgeCalculatorOutput(output);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("wearable-coverage-quality"), false);
    assert.equal(summary.wearableBridge.partialFeatureKeys.includes("activity-volume"), true);
  } finally {
    await rm(thinVaultRoot, { force: true, recursive: true });
  }

  const disjointVaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(disjointVaultRoot);
    insertMetricPoints(disjointVaultRoot, [
      ...wearableCoverageWindowDates("2026-04-26", 14).flatMap((date) => [
        wearablePointOnDate("resting-heart-rate", "biomarker:resting-heart-rate", 62, "bpm", date),
        wearablePointOnDate("hrv-rmssd", "biomarker:hrv-rmssd", 48, "ms", date),
      ]),
      wearablePointOnDate("steps", null, 10_000, "count", "2026-05-09", "activity-summary"),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot: disjointVaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(wearableFeatureValue(output, "wearable-valid-day-count-28d"), null);
    assert.equal(wearableFeatureValue(output, "wearable-valid-night-count-28d"), null);
    assert.equal(wearableFeatureValue(output, "wearable-coverage-index"), null);
    const summary = summarizeMurphAgeCalculatorOutput(output);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("activity-volume"), false);
    assert.equal(summary.wearableBridge.partialFeatureKeys.includes("activity-volume"), true);
    assert.equal(summary.wearableBridge.partialFeatureKeys.includes("resting-heart-rate"), true);
  } finally {
    await rm(disjointVaultRoot, { force: true, recursive: true });
  }

  const sleepSummaryRecoveryVaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(sleepSummaryRecoveryVaultRoot);
    insertMetricPoints(sleepSummaryRecoveryVaultRoot, wearableCoverageWindowDates("2026-04-26", 14).flatMap((date) => [
      wearablePointOnDate("steps", null, 10_000, "count", date, "activity-summary"),
      wearablePointOnDate("hrv-rmssd", "biomarker:hrv-rmssd", 48, "ms", date, "sleep-summary"),
    ]));

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot: sleepSummaryRecoveryVaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(wearableFeatureValue(output, "wearable-valid-day-count-28d"), 14);
    assert.equal(wearableFeatureValue(output, "wearable-valid-night-count-28d"), 14);
    assert.equal(wearableFeatureValue(output, "wearable-coverage-index"), 0.5);
  } finally {
    await rm(sleepSummaryRecoveryVaultRoot, { force: true, recursive: true });
  }

  const oneSidedVaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(oneSidedVaultRoot);
    insertMetricPoints(oneSidedVaultRoot, [
      ...wearableCoverageWindowDates("2026-04-26", 14).flatMap((date) => [
        wearablePointOnDate("steps", null, 10_000, "count", date, "activity-summary"),
      ]),
      wearablePointOnDate("resting-heart-rate", "biomarker:resting-heart-rate", 62, "bpm", "2026-05-09"),
      wearablePointOnDate("total-sleep-minutes", null, 450, "minutes", "2026-05-09", "sleep-summary"),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      sex: "female",
      vaultRoot: oneSidedVaultRoot,
    });

    assert.equal(output.status, "context-only");
    assert.equal(wearableFeatureValue(output, "wearable-valid-day-count-28d"), 14);
    assert.equal(wearableFeatureValue(output, "wearable-valid-night-count-28d"), null);
    assert.equal(wearableFeatureValue(output, "wearable-coverage-index"), null);
    const summary = summarizeMurphAgeCalculatorOutput(output);
    assert.equal(summary.wearableContext.quality, "thin");
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("wearable-coverage-quality"), false);
    assert.equal(summary.wearableBridge.readyFeatureKeys.includes("activity-volume"), false);
    assert.equal(summary.wearableBridge.partialFeatureKeys.includes("activity-volume"), true);
  } finally {
    await rm(oneSidedVaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle ignores sample-derived clinical metrics", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      labPoint("creatinine", "biomarker:creatinine", 0.9, "mg/dL"),
      labPoint("hdl-c", "biomarker:hdl-c", 62, "mg/dL"),
      labPoint("triglycerides", "biomarker:triglycerides", 90, "mg/dL"),
      measurementPoint("systolic-blood-pressure", "biomarker:systolic-blood-pressure", 118, "mmHg"),
      measurementPoint("diastolic-blood-pressure", "biomarker:diastolic-blood-pressure", 74, "mmHg"),
      metricPoint({
        biomarkerKey: "biomarker:blood-glucose",
        effectiveDate: "2026-05-08",
        id: "metric-point:glucose:2026-05-08:sample-summary:0",
        metricKey: "glucose",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "sample_summary_glucose",
        sourceKind: "sample-summary",
        unit: "mg/dL",
        value: 95,
      }),
    ]);

    const output = await calculateMurphAgeFromVaultInputBundle({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      mode: "research",
      models: { lab5_bp_bmi_transport_research: fixtureLab5ResearchModel() },
      sex: "female",
      vaultRoot,
    });

    assert.equal(output.status, "abstain");
    assert.equal(output.bundleAssessment.bundleId, "insufficient");
    assert.equal(output.bundleAssessment.selectedMetricKeys.includes("glucose"), false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeFromVaultInputBundle requires a valid asOf timestamp before reading the vault", async () => {
  const output = await calculateMurphAgeFromVaultInputBundle({
    asOf: "not-a-date",
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(output.status, "abstain");
  assert.equal(output.schemaVersion, MURPH_AGE_RESULT_SCHEMA_VERSION);
  assert.equal(output.authorization.evidenceClass, "abstained");
  assert.equal(output.authorization.scoreBearing, false);
  assert.equal(output.result, null);
  assert.equal(output.warnings[0]?.code, "INVALID_INPUT");
  assert.equal(output.bundleAssessment.bundleId, "insufficient");
});

test("calculateMurphAgeFromVaultInputBundle rejects impossible asOf dates before reading the vault", async () => {
  const output = await calculateMurphAgeFromVaultInputBundle({
    asOf: "2026-02-30T00:00:00.000Z",
    chronologicalAgeYears: 45,
    mode: "research",
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(output.status, "abstain");
  assert.equal(output.schemaVersion, MURPH_AGE_RESULT_SCHEMA_VERSION);
  assert.equal(output.authorization.evidenceClass, "abstained");
  assert.equal(output.authorization.scoreBearing, false);
  assert.equal(output.result, null);
  assert.equal(output.warnings[0]?.code, "INVALID_INPUT");
});

test("calculateMurphAgeFromVaultInputBundle rejects invalid runtime modes before reading the vault", async () => {
  const output = await Reflect.apply(calculateMurphAgeFromVaultInputBundle, null, [{
    asOf: "2026-05-10T00:00:00.000Z",
    chronologicalAgeYears: 45,
    mode: "debug",
    models: { lab9_bp_body_10y_acm_research: fixtureLab9ResearchModel() },
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  }]);

  assert.equal(output.status, "abstain");
  assert.equal(output.schemaVersion, MURPH_AGE_RESULT_SCHEMA_VERSION);
  assert.equal(output.authorization.evidenceClass, "abstained");
  assert.equal(output.authorization.scoreBearing, false);
  assert.equal(output.result, null);
  assert.equal(output.mode, "product");
  assert.equal(output.warnings[0]?.code, "INVALID_INPUT");
});

test("calculateMurphAgeForVault abstains on invalid models before reading the vault", async () => {
  const result = await calculateMurphAgeForVault({
    asOf: "2026-05-10T00:00:00.000Z",
    chronologicalAgeYears: 45,
    model: {
      ...fixtureMurphAgeModel(),
      intercept: Number.NaN,
    },
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(result.status, "abstain");
  assert.equal(result.warnings.some((warning) => warning.code === "INVALID_INPUT"), true);
  assert.equal(result.featureAttributions.length, 0);
});

test("calculateMurphAgeForVault requires a valid asOf timestamp before reading the vault", async () => {
  const result = await calculateMurphAgeForVault({
    asOf: "not-a-date",
    chronologicalAgeYears: 45,
    model: fixtureMurphAgeModel(),
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(result.status, "abstain");
  assert.equal(result.schemaVersion, MURPH_AGE_RESULT_SCHEMA_VERSION);
  assert.equal(result.authorization.evidenceClass, "custom-model-unreviewed");
  assert.equal(result.authorization.scoreBearingMetricKeys.includes("steps"), true);
  assert.equal(result.warnings[0]?.code, "INVALID_INPUT");
  assert.equal(result.warnings[0]?.message, "Murph Age query runtime requires a valid asOf timestamp.");
});

test("calculateMurphAgeForVault rejects impossible asOf dates before reading the vault", async () => {
  const result = await calculateMurphAgeForVault({
    asOf: "2026-02-30T00:00:00.000Z",
    chronologicalAgeYears: 45,
    model: fixtureMurphAgeModel(),
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(result.status, "abstain");
  assert.equal(result.schemaVersion, MURPH_AGE_RESULT_SCHEMA_VERSION);
  assert.equal(result.authorization.evidenceClass, "custom-model-unreviewed");
  assert.equal(result.authorization.scoreBearingMetricKeys.includes("apob"), true);
  assert.equal(result.warnings[0]?.code, "INVALID_INPUT");
});

async function createProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-query-runtime-"));
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: "2026-05-01T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Test Vault",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
    }, null, 2)}\n`,
  );
  await writeFile(path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl"), "");
  return vaultRoot;
}

async function writeLocalModelCardArtifact(vaultRoot: string, fileName: string, artifact: unknown): Promise<void> {
  const root = defaultMurphAgeModelCardArtifactRoot(vaultRoot);
  await writeModelCardArtifact(root, fileName, artifact);
}

async function writeModelCardArtifact(root: string, fileName: string, artifact: unknown): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, fileName), `${JSON.stringify(artifact, null, 2)}\n`);
}

async function writeWearableResidualParameterPack(
  root: string,
  fileName: string,
  parameterPack: MurphAgeWearableResidualParameterPack,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, fileName), `${JSON.stringify(parameterPack, null, 2)}\n`);
}

function insertMetricPoints(vaultRoot: string, points: readonly MetricPoint[]): void {
  const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), { create: false });
  try {
    const insertMetricPoint = database.prepare(`
      INSERT INTO query_metric_points (
        id,
        sort_rank,
        metric_key,
        biomarker_key,
        value,
        text_value,
        comparator,
        unit,
        canonical_value,
        canonical_unit,
        observed_at,
        effective_date,
        recorded_at,
        reported_at,
        grain,
        statistic,
        source_family,
        source_kind,
        source_record_id,
        source_result_index,
        source_path,
        confidence,
        metric_point_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    points.forEach((point, index) => {
      insertMetricPoint.run(
        point.id,
        index,
        point.metricKey,
        point.biomarkerKey,
        point.value,
        point.textValue,
        point.comparator,
        point.unit,
        point.canonicalValue,
        point.canonicalUnit,
        point.observedAt,
        point.effectiveDate,
        point.recordedAt,
        point.reportedAt,
        point.grain,
        point.statistic,
        point.source.family,
        point.source.kind,
        point.source.recordId,
        point.source.resultIndex,
        point.source.path,
        point.confidence,
        JSON.stringify(point),
      );
    });
  } finally {
    database.close();
  }
}

function metricPoint(input: {
  biomarkerKey?: string | null;
  effectiveDate: string;
  id: string;
  metricKey: string;
  observedAt: string;
  recordId: string;
  sourceKind: MetricPoint["source"]["kind"];
  unit: string | null;
  value: number;
}): MetricPoint {
  const normalized = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.unit,
    value: input.value,
  });

  return {
    biomarkerKey: input.biomarkerKey ?? null,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: input.effectiveDate,
    grain: "day",
    id: input.id,
    metricKey: input.metricKey,
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
      family: input.sourceKind === "test-result" ? "event" : "derived",
      kind: input.sourceKind,
      path: "ledger/events/2026/2026-05.jsonl",
      recordId: input.recordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function lab9BpBodyMetricPoints(): MetricPoint[] {
  return [
    labPoint("albumin", "biomarker:albumin", 4.4, "g/dL"),
    labPoint("creatinine", "biomarker:creatinine", 0.9, "mg/dL"),
    labPoint("hba1c", "biomarker:hba1c", 5.1, "percent"),
    labPoint("alkaline-phosphatase", "biomarker:alkaline-phosphatase", 70, "U/L"),
    labPoint("white-blood-cell-count", "biomarker:white-blood-cell-count", 5.6, "10^3/uL"),
    labPoint("lymphocyte-percentage", "biomarker:lymphocyte-percentage", 32, "percent"),
    labPoint("red-cell-distribution-width", "biomarker:red-cell-distribution-width", 12.6, "percent"),
    labPoint("hdl-c", "biomarker:hdl-c", 62, "mg/dL"),
    labPoint("triglycerides", "biomarker:triglycerides", 90, "mg/dL"),
    measurementPoint("systolic-blood-pressure", "biomarker:systolic-blood-pressure", 118, "mmHg"),
    measurementPoint("diastolic-blood-pressure", "biomarker:diastolic-blood-pressure", 74, "mmHg"),
    measurementPoint("bmi", null, 23.5, "kg/m^2"),
  ];
}

function wearableContextMetricPoints(): MetricPoint[] {
  return [
    wearablePoint("steps", null, 10_000, "count"),
    wearablePoint("resting-heart-rate", "biomarker:resting-heart-rate", 62, "bpm"),
    wearablePoint("hrv-rmssd", "biomarker:hrv-rmssd", 48, "ms"),
  ];
}

function functionContextMetricPoints(): MetricPoint[] {
  return [
    measurementPoint("adl-limitation-count", null, 0, "count"),
    measurementPoint("iadl-limitation-count", null, 1, "count"),
    measurementPoint("mobility-limitation-count", null, 1, "count"),
  ];
}

function r399ProxyMetricPoints(): MetricPoint[] {
  return [
    measurementPoint("bmi", null, 24.2, "kg/m^2"),
    metricPoint({
      effectiveDate: "2026-05-08",
      id: "metric-point:self-rated-health:2026-05-08:survey:0",
      metricKey: "self-rated-health",
      observedAt: "2026-05-08T08:00:00.000Z",
      recordId: "survey_self_rated_health",
      sourceKind: "survey-response",
      unit: "score",
      value: 2,
    }),
  ];
}

function labPoint(metricKey: string, biomarkerKey: string, value: number, unit: string): MetricPoint {
  return metricPoint({
    biomarkerKey,
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

function measurementPoint(
  metricKey: string,
  biomarkerKey: string | null,
  value: number,
  unit: string,
): MetricPoint {
  return metricPoint({
    biomarkerKey,
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

function wearablePoint(
  metricKey: string,
  biomarkerKey: string | null,
  value: number,
  unit: string,
  sourceKind: MetricPoint["source"]["kind"] = "wearable-summary",
): MetricPoint {
  return metricPoint({
    biomarkerKey,
    effectiveDate: "2026-05-08",
    id: `metric-point:${metricKey}:2026-05-08:wearable:0`,
    metricKey,
    observedAt: "2026-05-08T08:00:00.000Z",
    recordId: `wearable_${metricKey.replaceAll("-", "_")}`,
    sourceKind,
    unit,
    value,
  });
}

function wearablePointOnDate(
  metricKey: string,
  biomarkerKey: string | null,
  value: number,
  unit: string,
  date: string,
  sourceKind: MetricPoint["source"]["kind"] = "wearable-summary",
): MetricPoint {
  return metricPoint({
    biomarkerKey,
    effectiveDate: date,
    id: `metric-point:${metricKey}:${date}:${sourceKind}:0`,
    metricKey,
    observedAt: `${date}T08:00:00.000Z`,
    recordId: `wearable_${metricKey.replaceAll("-", "_")}_${date}`,
    sourceKind,
    unit,
    value,
  });
}

function wearableCoverageWindowDates(startDate: string, count: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
}

function wearableFeatureValue(
  output: Awaited<ReturnType<typeof calculateMurphAgeFromVaultInputBundle>>,
  featureKey: string,
): number | null {
  return output.bundleAssessment.featureStatuses.find((feature) => feature.featureKey === featureKey)?.value ?? null;
}

function fixtureActivityWearableResidualParameterPack(
  anchorCardId: MurphAgeScoreBearingCardId,
): MurphAgeWearableResidualParameterPack {
  return fixtureWearableResidualParameterPack(anchorCardId, {
    center: 8_000,
    coefficient: -0.08,
    family: "activity",
    layerId: "activity-residual-v1",
    metricKey: "steps",
    scale: 2_000,
  });
}

const FIXTURE_ACTIVITY_WEARABLE_PACK_HASH =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function fixtureWearableResidualParameterPack(
  anchorCardId: MurphAgeScoreBearingCardId,
  input: {
    center: number;
    coefficient: number;
    family: MurphAgeWearableResidualParameterPack["family"];
    layerId: MurphAgeWearableResidualParameterPack["layerId"];
    metricKey: string;
    scale: number;
  },
): MurphAgeWearableResidualParameterPack {
  return {
    anchorCardId,
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: "research-only",
    endpoint: "10-year all-cause mortality",
    evidenceTier: "true-external-validation",
    family: input.family,
    featureWeights: [{
      center: input.center,
      coefficient: input.coefficient,
      metricKey: input.metricKey,
      scale: input.scale,
      transform: "center-scale",
    }],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId: input.layerId,
    packHash: input.family === "activity"
      ? FIXTURE_ACTIVITY_WEARABLE_PACK_HASH
      : "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "all-of-us-fitbit-labs-ehr",
  };
}

function fixtureFunctionResidualParameterPack(
  anchorCardId: MurphAgeScoreBearingCardId,
): MurphAgeFunctionResidualParameterPack {
  return {
    anchorCardId,
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
    packHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    schemaVersion: MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: "mhas-harmonized-aging",
  };
}

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
    modelId: "fixture-query-runtime-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.01 },
      { ageYears: 40, riskProbability: 0.03 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.3 },
    ],
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
      { coefficient: 0.055, key: "age", kind: "chronological-age", label: "Age" },
      { coefficient: 0.12, key: "male", kind: "sex", label: "Male", sex: "male" },
      labFeature("albumin", "Albumin", "albumin", -0.16, 4.2, 0.3, "g/dL"),
      labFeature("creatinine", "Creatinine", "creatinine", 0.08, 0.9, 0.2, "mg/dL"),
      labFeature("hba1c", "HbA1c", "hba1c", 0.12, 5.4, 0.5, "percent"),
      labFeature("alkaline-phosphatase", "Alkaline phosphatase", "alkaline-phosphatase", 0.08, 70, 20, "U/L"),
      labFeature("white-blood-cell-count", "White blood cells", "white-blood-cell-count", 0.08, 6, 1.5, "10^3/uL"),
      labFeature("lymphocyte-percentage", "Lymphocytes", "lymphocyte-percentage", -0.06, 30, 8, "percent"),
      labFeature("red-cell-distribution-width", "RDW", "red-cell-distribution-width", 0.12, 13, 1, "percent"),
      labFeature("hdl-c", "HDL-C", "hdl-c", -0.08, 55, 15, "mg/dL"),
      labFeature("triglycerides", "Triglycerides", "triglycerides", 0.08, 120, 50, "mg/dL"),
      labFeature("systolic-blood-pressure", "Systolic blood pressure", "systolic-blood-pressure", 0.1, 120, 15, "mmHg"),
      labFeature("diastolic-blood-pressure", "Diastolic blood pressure", "diastolic-blood-pressure", 0.04, 75, 10, "mmHg"),
      labFeature("bmi", "BMI", "bmi", 0.08, 25, 4, "kg/m^2"),
    ],
    horizonYears: 10,
    intercept: -6.1,
    modelId: "fixture-lab9-research-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult lab reference curve",
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.005 },
      { ageYears: 40, riskProbability: 0.025 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.28 },
    ],
    uncertainty: {
      baseYears: 2,
      perMissingOptionalFeatureYears: 2,
    },
  };
}

function fixtureLab5ResearchModel(): MurphAgeRiskModel {
  return {
    ...fixtureLab9ResearchModel(),
    features: [
      { coefficient: 0.055, key: "age", kind: "chronological-age", label: "Age" },
      { coefficient: 0.12, key: "male", kind: "sex", label: "Male", sex: "male" },
      labFeature("creatinine", "Creatinine", "creatinine", 0.08, 0.9, 0.2, "mg/dL"),
      labFeature("hba1c", "HbA1c", "hba1c", 0.12, 5.4, 0.5, "percent"),
      labFeature("hdl-c", "HDL-C", "hdl-c", -0.08, 55, 15, "mg/dL"),
      labFeature("triglycerides", "Triglycerides", "triglycerides", 0.08, 120, 50, "mg/dL"),
      labFeature("systolic-blood-pressure", "Systolic blood pressure", "systolic-blood-pressure", 0.1, 120, 15, "mmHg"),
    ],
    modelId: "fixture-lab5-research-model",
  };
}

function fixtureL1GlycemiaResearchModel(): MurphAgeRiskModel {
  return {
    ...fixtureLab9ResearchModel(),
    features: [
      { coefficient: 0.055, key: "age", kind: "chronological-age", label: "Age" },
      { coefficient: 0.12, key: "male", kind: "sex", label: "Male", sex: "male" },
      labFeature("hba1c", "HbA1c", "hba1c", 0.12, 5.4, 0.5, "percent"),
    ],
    modelId: "fixture-l1-glycemia-research-model",
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
    ],
    horizonYears: 10,
    intercept: -4.4,
    modelId: "fixture-r399-proxy-anchor-model",
    modelVersion: "test.0",
    referencePopulation: "fixture NHIS proxy reference curve",
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.01 },
      { ageYears: 40, riskProbability: 0.03 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.3 },
    ],
    uncertainty: {
      baseYears: 2,
      perMissingOptionalFeatureYears: 0.5,
    },
  };
}

function labFeature(
  key: string,
  label: string,
  metricKey: string,
  coefficient: number,
  mean: number,
  standardDeviation: number,
  expectedUnit: string,
): MurphAgeRiskModel["features"][number] {
  return {
    coefficient,
    expectedUnit,
    key,
    kind: "metric",
    label,
    metricKey,
    moduleId: "clinical",
    transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean, standardDeviation },
  };
}
