import {
  METRIC_POINT_SCHEMA_VERSION,
  normalizeMetricValue,
  resolveMetricDefinition,
  type MetricPoint,
  type MetricSourceKind,
} from "@murphai/health-metrics";
import {
  assessMurphAgeInputBundle,
  assessMurphAgeSecondaryContextBundles,
  assessMurphAgeWearableShadowIncrements,
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  isMurphAgeWearableShadowAnchorCardId,
  listMurphAgeModelCardProductPromotionBlockers,
  listMurphAgeSubmittedCalculatorInputBundleSpecs,
  resolveMurphAgeWearableBridgeMetricSourceKind,
  resolveMurphAgeModelCardPolicy,
  type MurphAgeContextBundleAssessment,
  type MurphAgeInputBundleAssessment,
  type MurphAgeInputBundleId,
  type MurphAgeProductPromotionBlocker,
  type MurphAgeScoreBearingCardId,
  type MurphAgeSubmittedCalculatorInputBundleSpec,
  type MurphAgeWarning,
  type MurphAgeWearableShadowIncrementAssessment,
  type MurphAgeWearableShadowIncrementFamily,
  type MurphAgeWearableShadowIncrementStatus,
} from "@murphai/health-metrics/murph-age";

import type {
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
  BrowserVaultMetricsCapableQueryClient,
} from "./shared.ts";

export const BROWSER_VAULT_MURPH_AGE_READINESS_SCHEMA =
  "murph.browser-vault.murph-age-readiness.v2" as const;

export type BrowserVaultMurphAgeScoreReadinessStatus =
  | "context-only"
  | "input-incomplete"
  | "product-age-policy-ready"
  | "product-risk-policy-ready"
  | "research-ready-product-blocked";
export type BrowserVaultMurphAgeProductBlockedReason =
  | "CONTEXT_ONLY_NOT_SCORE_BEARING"
  | "INPUT_BUNDLE_INCOMPLETE"
  | MurphAgeProductPromotionBlocker;

export interface BrowserVaultMurphAgeWarning {
  code: MurphAgeWarning["code"];
  featureKey?: string;
  metricKey?: string;
}

export interface BrowserVaultMurphAgeRuntimeInputReadiness {
  key: "chronological-age-years" | "sex";
  label: string;
  required: true;
  source: "runtime-option";
  status: "required";
}

export interface BrowserVaultMurphAgeBundleReadiness {
  availableFeatureKeys: string[];
  bundleId: MurphAgeInputBundleId;
  featureStatuses: BrowserVaultMurphAgeFeatureReadiness[];
  missingFeatureKeys: string[];
  recommendedCardId: MurphAgeInputBundleAssessment["recommendedCardId"];
  schemaVersion: MurphAgeInputBundleAssessment["schemaVersion"];
  selectedMetricKeys: string[];
  status: MurphAgeInputBundleAssessment["status"];
  warnings: BrowserVaultMurphAgeWarning[];
}

export interface BrowserVaultMurphAgeFeatureReadiness {
  featureKey: string;
  label: string;
  metricKeys: string[];
  requiredFor: string;
  selectedMetricKey: string | null;
  status: "missing" | "ready";
}

export interface BrowserVaultMurphAgeScoreReadiness {
  bundleId: MurphAgeInputBundleId;
  contextOnly: boolean;
  inputReady: boolean;
  productAgePolicyReady: boolean;
  productBlockedReasons: BrowserVaultMurphAgeProductBlockedReason[];
  productPromotionBlockers: MurphAgeProductPromotionBlocker[];
  productRiskPolicyReady: boolean;
  recommendedCardId: MurphAgeInputBundleAssessment["recommendedCardId"];
  researchModelCardRequired: boolean;
  researchReadiness: "context-only" | "input-incomplete" | "ready-if-local-model-card-loaded";
  researchUsableIfModelLoaded: boolean;
  scoreBearingInput: boolean;
  status: BrowserVaultMurphAgeScoreReadinessStatus;
}

export interface BrowserVaultMurphAgeWearableShadowIncrementReadiness {
  anchorCardId: MurphAgeScoreBearingCardId | null;
  anchorCompatible: boolean;
  availableMetricKeys: string[];
  compatibleAnchorCardIds: MurphAgeScoreBearingCardId[];
  family: MurphAgeWearableShadowIncrementFamily;
  missingMetricKeys: string[];
  missingQualityMetricKeys: string[];
  productAuthorized: false;
  readySignalMetricKeys: string[];
  riskEffect: "not-estimated";
  schemaVersion: MurphAgeWearableShadowIncrementAssessment["schemaVersion"];
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectedMetricKeys: string[];
  status: MurphAgeWearableShadowIncrementStatus;
  warnings: BrowserVaultMurphAgeWarning[];
}

export interface BrowserVaultMurphAgeWearableShadowReadiness {
  anchorCardId: MurphAgeScoreBearingCardId | null;
  blockedFamilies: MurphAgeWearableShadowIncrementFamily[];
  missingFamilies: MurphAgeWearableShadowIncrementFamily[];
  readyFamilies: MurphAgeWearableShadowIncrementFamily[];
  increments: BrowserVaultMurphAgeWearableShadowIncrementReadiness[];
}

export interface BrowserVaultMurphAgeReadiness {
  contextBundles: BrowserVaultMurphAgeBundleReadiness[];
  generatedAt: string;
  inputBundleSpecs: MurphAgeSubmittedCalculatorInputBundleSpec[];
  primaryBundle: BrowserVaultMurphAgeBundleReadiness;
  runtimeInputs: BrowserVaultMurphAgeRuntimeInputReadiness[];
  schemaVersion: typeof BROWSER_VAULT_MURPH_AGE_READINESS_SCHEMA;
  scoreReadiness: BrowserVaultMurphAgeScoreReadiness;
  wearableShadow: BrowserVaultMurphAgeWearableShadowReadiness;
}

const BROWSER_VAULT_MURPH_AGE_RUNTIME_INPUTS = [
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
] satisfies readonly BrowserVaultMurphAgeRuntimeInputReadiness[];

export function selectBrowserVaultMurphAgeReadiness(
  client: BrowserVaultMetricsCapableQueryClient,
): BrowserVaultMurphAgeReadiness {
  const points = browserVaultMetricPointsForMurphAge(client);
  const primaryBundle = assessMurphAgeInputBundle({
    asOf: client.replica.generatedAt,
    points,
  });
  const contextBundles = assessMurphAgeSecondaryContextBundles({
    asOf: client.replica.generatedAt,
    points,
    primaryBundleId: primaryBundle.bundleId,
  });
  const anchorCardId = inferWearableShadowAnchorCardId(primaryBundle);
  const wearableIncrements = assessMurphAgeWearableShadowIncrements({
    anchorCardId,
    asOf: client.replica.generatedAt,
    points,
  }).map(sanitizeWearableIncrement);

  return {
    contextBundles: contextBundles.map(sanitizeBundle),
    generatedAt: client.replica.generatedAt,
    inputBundleSpecs: listMurphAgeSubmittedCalculatorInputBundleSpecs(),
    primaryBundle: sanitizeBundle(primaryBundle),
    runtimeInputs: BROWSER_VAULT_MURPH_AGE_RUNTIME_INPUTS.map((input) => ({ ...input })),
    schemaVersion: BROWSER_VAULT_MURPH_AGE_READINESS_SCHEMA,
    scoreReadiness: buildScoreReadiness(primaryBundle),
    wearableShadow: {
      anchorCardId,
      blockedFamilies: wearableFamiliesByStatus(wearableIncrements, "blocked"),
      increments: wearableIncrements,
      missingFamilies: wearableFamiliesByStatus(wearableIncrements, "missing"),
      readyFamilies: wearableFamiliesByStatus(wearableIncrements, "ready"),
    },
  };
}

function browserVaultMetricPointsForMurphAge(client: BrowserVaultMetricsCapableQueryClient): MetricPoint[] {
  const metricRowsBySelectionId = new Map(
    client.replica.metricRows.map((row) => [row.id, row]),
  );

  return client.replica.metricSelectionRows.flatMap((selection) => {
    if (selection.status !== "ready" || selection.value === null || selection.effectiveDate === null) {
      return [];
    }

    const row = selection.selectedMetricRowId
      ? metricRowsBySelectionId.get(selection.selectedMetricRowId) ?? null
      : null;
    return [metricPointFromBrowserSelection(selection, row)];
  });
}

function metricPointFromBrowserSelection(
  selection: BrowserVaultMetricSelectionRow,
  row: BrowserVaultMetricRow | null,
): MetricPoint {
  const sourceKind = inferSourceKind(selection, row);
  const metricKey = selection.metricKey;
  const value = selection.value ?? row?.value ?? null;
  const normalized = normalizeMetricValue({
    metricKey,
    unit: selection.unit ?? row?.unit ?? null,
    value: value ?? 0,
  });

  return {
    biomarkerKey: selection.biomarkerKey,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: selection.confidence,
    context: row?.context ?? {},
    effectiveDate: selection.effectiveDate ?? row?.date ?? selection.observedAt?.slice(0, 10) ?? "",
    grain: row?.grain ?? "day",
    id: `browser-vault-murph-age:${selection.id}`,
    metricKey,
    observedAt: selection.observedAt ?? row?.observedAt ?? `${selection.effectiveDate}T00:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: selection.sourceLabel ?? row?.sourceLabel ?? null,
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: sourceKind === "test-result" ? "event" : "derived",
      kind: sourceKind,
      path: "",
      recordId: selection.id,
      resultIndex: null,
    },
    statistic: row?.statistic ?? "value",
    textValue: null,
    unit: selection.unit ?? row?.unit ?? null,
    value,
  };
}

function inferSourceKind(
  selection: BrowserVaultMetricSelectionRow,
  row: BrowserVaultMetricRow | null,
): MetricSourceKind {
  if (row?.sourceKind) return row.sourceKind;
  const wearableSourceKind = resolveMurphAgeWearableBridgeMetricSourceKind(selection.metricKey);
  if (wearableSourceKind) return wearableSourceKind;

  const category = resolveMetricDefinition(selection.metricKey)?.category;
  if (category === "lab") return "test-result";
  return "measurement";
}

function sanitizeBundle(
  assessment: MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
): BrowserVaultMurphAgeBundleReadiness {
  return {
    availableFeatureKeys: [...assessment.availableFeatureKeys],
    bundleId: assessment.bundleId,
    featureStatuses: assessment.featureStatuses.map((feature) => ({
      featureKey: feature.featureKey,
      label: feature.label,
      metricKeys: [...feature.metricKeys],
      requiredFor: feature.requiredFor,
      selectedMetricKey: feature.selectedMetricKey,
      status: feature.status,
    })),
    missingFeatureKeys: [...assessment.missingFeatureKeys],
    recommendedCardId: assessment.recommendedCardId,
    schemaVersion: assessment.schemaVersion,
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    status: assessment.status,
    warnings: assessment.warnings.map(sanitizeWarning),
  };
}

function sanitizeWearableIncrement(
  assessment: MurphAgeWearableShadowIncrementAssessment,
): BrowserVaultMurphAgeWearableShadowIncrementReadiness {
  return {
    anchorCardId: assessment.anchorCardId,
    anchorCompatible: assessment.anchorCompatible,
    availableMetricKeys: [...assessment.availableMetricKeys],
    compatibleAnchorCardIds: [...assessment.compatibleAnchorCardIds],
    family: assessment.family,
    missingMetricKeys: [...assessment.missingMetricKeys],
    missingQualityMetricKeys: [...assessment.missingQualityMetricKeys],
    productAuthorized: false,
    readySignalMetricKeys: [...assessment.readySignalMetricKeys],
    riskEffect: "not-estimated",
    schemaVersion: assessment.schemaVersion,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    status: assessment.status,
    warnings: assessment.warnings.map(sanitizeWarning),
  };
}

function sanitizeWarning(warning: MurphAgeWarning): BrowserVaultMurphAgeWarning {
  return {
    code: warning.code,
    ...(warning.featureKey ? { featureKey: warning.featureKey } : {}),
    ...(warning.metricKey ? { metricKey: warning.metricKey } : {}),
  };
}

function buildScoreReadiness(
  assessment: MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
): BrowserVaultMurphAgeScoreReadiness {
  const policy = resolveMurphAgeModelCardPolicy(assessment.recommendedCardId);
  const inputReady = assessment.status === "ready" || assessment.status === "context-only";
  const scoreBearingInput = inputReady && Boolean(policy?.scoreBearing);
  const contextOnly = inputReady && !scoreBearingInput;
  const productPromotionBlockers = scoreBearingInput && policy
    ? listMurphAgeModelCardProductPromotionBlockers(policy)
    : [];
  const productRiskPolicyReady = scoreBearingInput && policy
    ? isMurphAgeModelCardProductAuthorized(policy)
    : false;
  const productAgePolicyReady = scoreBearingInput && policy
    ? isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy)
    : false;
  const productBlockedReasons: BrowserVaultMurphAgeProductBlockedReason[] = [];

  if (!inputReady) {
    productBlockedReasons.push("INPUT_BUNDLE_INCOMPLETE");
  } else if (contextOnly) {
    productBlockedReasons.push("CONTEXT_ONLY_NOT_SCORE_BEARING");
  } else {
    productBlockedReasons.push(...productPromotionBlockers);
  }

  const researchUsableIfModelLoaded = scoreBearingInput;
  const researchReadiness = researchUsableIfModelLoaded
    ? "ready-if-local-model-card-loaded"
    : contextOnly
      ? "context-only"
      : "input-incomplete";
  const status = productAgePolicyReady
    ? "product-age-policy-ready"
    : productRiskPolicyReady
      ? "product-risk-policy-ready"
      : researchUsableIfModelLoaded
        ? "research-ready-product-blocked"
        : contextOnly
          ? "context-only"
          : "input-incomplete";

  return {
    bundleId: assessment.bundleId,
    contextOnly,
    inputReady,
    productAgePolicyReady,
    productBlockedReasons,
    productPromotionBlockers,
    productRiskPolicyReady,
    recommendedCardId: assessment.recommendedCardId,
    researchModelCardRequired: researchUsableIfModelLoaded,
    researchReadiness,
    researchUsableIfModelLoaded,
    scoreBearingInput,
    status,
  };
}

function inferWearableShadowAnchorCardId(
  assessment: MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
): MurphAgeScoreBearingCardId | null {
  if (assessment.status !== "ready") return null;
  return isMurphAgeWearableShadowAnchorCardId(assessment.recommendedCardId)
    ? assessment.recommendedCardId
    : null;
}

function wearableFamiliesByStatus(
  assessments: readonly BrowserVaultMurphAgeWearableShadowIncrementReadiness[],
  status: MurphAgeWearableShadowIncrementStatus,
): MurphAgeWearableShadowIncrementFamily[] {
  return assessments
    .filter((assessment) => assessment.status === status)
    .map((assessment) => assessment.family);
}
