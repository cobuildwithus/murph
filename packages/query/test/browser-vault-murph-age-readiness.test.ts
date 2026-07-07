import assert from "node:assert/strict";

import { test } from "vitest";

import {
  METRIC_POINT_SCHEMA_VERSION,
  normalizeMetricValue,
  type MetricPoint,
} from "@murphai/health-metrics";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultMetricSelectionRows,
  createBrowserVaultQueryClient,
  toBrowserVaultMetricRows,
  type BrowserVaultReplica,
} from "../src/browser.ts";
import { selectBrowserVaultMurphAgeReadiness } from "@murphai/query/browser-murph-age";

test("reports current-alpha Murph Age research readiness without leaking values or model outputs", () => {
  const readiness = selectBrowserVaultMurphAgeReadiness(clientFromPoints([
    ...lab9BpBodyPoints(),
    ...wearableShadowPoints(),
  ]));

  assert.equal(readiness.schemaVersion, "murph.browser-vault.murph-age-readiness.v2");
  assert.equal(readiness.primaryBundle.bundleId, "l1b-glycemia-body");
  assert.equal(readiness.primaryBundle.status, "ready");
  assert.equal(readiness.primaryBundle.recommendedCardId, "l1b_glycemia_body_10y_acm_research");
  assert.equal(readiness.primaryBundle.selectedMetricKeys.includes("hba1c"), true);
  assert.equal(readiness.primaryBundle.selectedMetricKeys.includes("bmi"), true);
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
  assert.equal(readiness.scoreReadiness.status, "research-ready-product-blocked");
  assert.equal(readiness.scoreReadiness.researchUsableIfModelLoaded, true);
  assert.equal(readiness.scoreReadiness.productAgePolicyReady, false);
  assert.equal(readiness.scoreReadiness.productRiskPolicyReady, false);
  assert.equal(readiness.scoreReadiness.productPromotionBlockers.includes("PRODUCT_POLICY_NOT_AUTHORIZED"), true);
  assert.equal(readiness.contextBundles.some((bundle) => bundle.bundleId === "wearable-context"), true);

  const activity = readiness.wearableShadow.increments.find((increment) => increment.family === "activity");
  assert.equal(activity?.status, "ready");
  assert.equal(activity?.anchorCardId, "l1b_glycemia_body_10y_acm_research");
  assert.equal(activity?.readySignalMetricKeys.includes("steps"), true);
  assert.equal(activity?.selectedMetricKeys.includes("wearable-coverage-index"), true);
  assert.equal(activity?.scoreBearing, false);
  assert.equal(activity?.scoreContributionAuthorized, false);
  assert.equal(activity?.productAuthorized, false);
  assert.equal(activity?.riskEffect, "not-estimated");

  const sleep = readiness.wearableShadow.increments.find((increment) => increment.family === "sleep");
  assert.equal(sleep?.status, "ready");
  assert.equal(sleep?.readySignalMetricKeys.includes("total-sleep-minutes"), true);
  assert.deepEqual(readiness.wearableShadow.readyFamilies.sort(), [
    "activity",
    "hrv",
    "resting-heart-rate",
    "sleep",
  ]);

  assert.deepEqual(readiness.runtimeInputs.map((input) => input.key), ["chronological-age-years", "sex"]);

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /"value"\s*:/u);
  assert.doesNotMatch(serialized, /"unit"\s*:/u);
  assert.doesNotMatch(serialized, /"pointIds"\s*:/u);
  assert.doesNotMatch(serialized, /"recordIds"\s*:/u);
  assert.doesNotMatch(serialized, /"message"\s*:/u);
  assert.doesNotMatch(serialized, /"modelId"\s*:/u);
  assert.doesNotMatch(serialized, /"coefficient"\s*:/u);
  assert.doesNotMatch(serialized, /"biologicalAgeYears"\s*:/u);
  assert.doesNotMatch(serialized, /"featureAttributions"\s*:/u);
  assert.doesNotMatch(serialized, /metric-point:/u);
  assert.doesNotMatch(serialized, /record:/u);
});

test("keeps wearable-only browser-vault data on a context-only Murph Age path", () => {
  const readiness = selectBrowserVaultMurphAgeReadiness(clientFromPoints(wearableShadowPoints()));

  assert.equal(readiness.primaryBundle.bundleId, "wearable-context");
  assert.equal(readiness.primaryBundle.status, "context-only");
  assert.equal(readiness.scoreReadiness.status, "context-only");
  assert.equal(readiness.scoreReadiness.scoreBearingInput, false);
  assert.equal(readiness.scoreReadiness.researchModelCardRequired, false);
  assert.deepEqual(readiness.scoreReadiness.productBlockedReasons, ["CONTEXT_ONLY_NOT_SCORE_BEARING"]);
  assert.equal(readiness.wearableShadow.anchorCardId, null);
  assert.deepEqual(readiness.wearableShadow.readyFamilies, []);
  assert.deepEqual(readiness.wearableShadow.blockedFamilies.sort(), [
    "activity",
    "hrv",
    "resting-heart-rate",
    "sleep",
  ]);
});

test("uses L1 glycemia as a browser-vault wearable shadow anchor", () => {
  const readiness = selectBrowserVaultMurphAgeReadiness(clientFromPoints([
    metricPoint("hba1c", "biomarker:hba1c", 5.3, "percent", "test-result"),
    ...wearableShadowPoints(),
  ]));

  assert.equal(readiness.primaryBundle.bundleId, "l1-glycemia");
  assert.equal(readiness.primaryBundle.status, "ready");
  assert.equal(readiness.primaryBundle.recommendedCardId, "l1_tiny_glycemia_10y_acm_research");
  assert.equal(readiness.scoreReadiness.status, "research-ready-product-blocked");
  assert.equal(readiness.scoreReadiness.researchUsableIfModelLoaded, true);
  assert.equal(readiness.scoreReadiness.productAgePolicyReady, false);
  assert.equal(readiness.scoreReadiness.productRiskPolicyReady, false);
  assert.equal(readiness.wearableShadow.anchorCardId, "l1_tiny_glycemia_10y_acm_research");

  const activity = readiness.wearableShadow.increments.find((increment) => increment.family === "activity");
  assert.equal(activity?.status, "ready");
  assert.equal(activity?.anchorCardId, "l1_tiny_glycemia_10y_acm_research");
  assert.equal(activity?.anchorCompatible, true);
  assert.equal(activity?.selectedMetricKeys.includes("steps"), true);
  assert.equal(activity?.scoreBearing, false);
  assert.equal(activity?.scoreContributionAuthorized, false);

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /"value"\s*:/u);
  assert.doesNotMatch(serialized, /"unit"\s*:/u);
  assert.doesNotMatch(serialized, /"pointIds"\s*:/u);
  assert.doesNotMatch(serialized, /"coefficient"\s*:/u);
  assert.doesNotMatch(serialized, /"biologicalAgeYears"\s*:/u);
  assert.doesNotMatch(serialized, /metric-point:/u);
});

test("infers wearable source kinds from the shared Murph Age bridge contract when rows are absent", () => {
  const generatedAt = "2026-05-10T12:00:00.000Z";
  const points = [
    ...lab9BpBodyPoints(),
    ...wearableShadowPoints(),
  ];
  const readiness = selectBrowserVaultMurphAgeReadiness(createBrowserVaultQueryClient(createReplica({
    generatedAt,
    metricRows: [],
    metricSelectionRows: createBrowserVaultMetricSelectionRows({
      generatedAt,
      metricPoints: points,
      metricRowPointIds: new Set(),
    }),
  })));

  assert.equal(readiness.primaryBundle.status, "ready");
  assert.equal(readiness.scoreReadiness.status, "research-ready-product-blocked");
  assert.deepEqual(readiness.wearableShadow.readyFamilies.sort(), [
    "activity",
    "hrv",
    "resting-heart-rate",
    "sleep",
  ]);
});

test("does not infer Murph Age readiness from raw browser metric rows without selected metric rows", () => {
  const generatedAt = "2026-05-10T12:00:00.000Z";
  const readiness = selectBrowserVaultMurphAgeReadiness(createBrowserVaultQueryClient(createReplica({
    generatedAt,
    metricRows: toBrowserVaultMetricRows({ points: lab9BpBodyPoints() }),
    metricSelectionRows: [],
  })));

  assert.equal(readiness.primaryBundle.bundleId, "insufficient");
  assert.equal(readiness.primaryBundle.status, "abstain");
  assert.deepEqual(readiness.primaryBundle.selectedMetricKeys, []);
  assert.equal(readiness.scoreReadiness.status, "input-incomplete");
  assert.deepEqual(readiness.scoreReadiness.productBlockedReasons, ["INPUT_BUNDLE_INCOMPLETE"]);
  assert.equal(readiness.scoreReadiness.scoreBearingInput, false);
  assert.equal(readiness.wearableShadow.anchorCardId, null);
  assert.deepEqual(readiness.wearableShadow.readyFamilies, []);
});

function clientFromPoints(points: readonly MetricPoint[]) {
  const generatedAt = "2026-05-10T12:00:00.000Z";
  const metricRows = toBrowserVaultMetricRows({ points });
  const metricSelectionRows = createBrowserVaultMetricSelectionRows({
    generatedAt,
    metricPoints: points,
  });
  return createBrowserVaultQueryClient(createReplica({
    generatedAt,
    metricRows,
    metricSelectionRows,
  }));
}

function createReplica(overrides: Partial<BrowserVaultReplica> = {}): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-05-10T12:00:00.000Z",
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "sha256:browser-vault-murph-age-test",
      sourceBundleHash: "sha256:browser-vault-murph-age-source",
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
    ...overrides,
  };
}

function lab9BpBodyPoints(): MetricPoint[] {
  return [
    metricPoint("albumin", "biomarker:albumin", 4.4, "g/dL", "test-result"),
    metricPoint("creatinine", "biomarker:creatinine", 0.9, "mg/dL", "test-result"),
    metricPoint("hba1c", "biomarker:hba1c", 5.1, "percent", "test-result"),
    metricPoint("alkaline-phosphatase", "biomarker:alkaline-phosphatase", 70, "U/L", "test-result"),
    metricPoint("white-blood-cell-count", "biomarker:white-blood-cell-count", 5.6, "10^3/uL", "test-result"),
    metricPoint("lymphocyte-percentage", "biomarker:lymphocyte-percentage", 32, "percent", "test-result"),
    metricPoint("red-cell-distribution-width", "biomarker:red-cell-distribution-width", 12.6, "percent", "test-result"),
    metricPoint("hdl-c", "biomarker:hdl-c", 62, "mg/dL", "test-result"),
    metricPoint("triglycerides", "biomarker:triglycerides", 90, "mg/dL", "test-result"),
    metricPoint("systolic-blood-pressure", "biomarker:systolic-blood-pressure", 118, "mmHg", "measurement"),
    metricPoint("diastolic-blood-pressure", "biomarker:diastolic-blood-pressure", 74, "mmHg", "measurement"),
    metricPoint("bmi", null, 23.5, "kg/m^2", "measurement"),
  ];
}

function wearableShadowPoints(): MetricPoint[] {
  return [
    metricPoint("steps", null, 10_000, "count", "activity-summary"),
    metricPoint("resting-heart-rate", "biomarker:resting-heart-rate", 62, "bpm", "wearable-summary"),
    metricPoint("hrv-rmssd", "biomarker:hrv-rmssd", 48, "ms", "wearable-summary"),
    metricPoint("total-sleep-minutes", null, 450, "minutes", "sleep-summary"),
    metricPoint("wearable-valid-day-count-28d", null, 24, "count", "activity-summary"),
    metricPoint("wearable-valid-night-count-28d", null, 22, "count", "sleep-summary"),
    metricPoint("wearable-coverage-index", null, 0.82, "score", "wearable-summary"),
  ];
}

function metricPoint(
  metricKey: string,
  biomarkerKey: string | null,
  value: number,
  unit: string,
  sourceKind: MetricPoint["source"]["kind"],
): MetricPoint {
  const normalized = normalizeMetricValue({ metricKey, unit, value });
  const sourceFamily = sourceKind === "test-result" ? "event" : "derived";
  const effectiveDate = sourceKind === "test-result" ? "2026-05-01" : "2026-05-08";
  return {
    biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate,
    grain: "day",
    id: `metric-point:${metricKey}:${effectiveDate}:${sourceKind}`,
    metricKey,
    observedAt: `${effectiveDate}T08:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: sourceKind === "test-result" ? "Lab fixture" : "Wearable fixture",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: sourceFamily,
      kind: sourceKind,
      path: "",
      recordId: `record:${metricKey}:${effectiveDate}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}
