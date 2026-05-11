import { resolveMetricDefinition, resolveMetricInputKey, uniqueStrings } from "./catalog.ts";
import { normalizeUnit, unitsEquivalent } from "./normalize.ts";
import { selectMetricValue } from "./selectors.ts";
import type {
  MetricConfidence,
  MetricPoint,
  MetricSelection,
  MetricSelectionPolicy,
  MetricSelectionWarning,
} from "./types.ts";

export const MURPH_AGE_RESULT_SCHEMA_VERSION = "murph.age.result.v2" as const;
export const MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION = "murph.age.input-bundle.v1" as const;
export const MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION = "murph.age.display-summary.v4" as const;
export const MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION = "murph.age.public-display-summary.v3" as const;
export const MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION =
  "murph.age.public-calculator-report.v1" as const;
export const MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION =
  "murph.age.wearable-shadow-increment.v1" as const;
export const MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION =
  "murph.age.wearable-bridge-feature.v1" as const;
export const MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION = "murph.age.model-card-artifact.v1" as const;

export type MurphAgeSex = "female" | "male";
export type MurphAgeStatus = "abstain" | "ready";
export type MurphAgeInputBundleStatus = "abstain" | "context-only" | "ready";
export type MurphAgeInputBundleId =
  | "insufficient"
  | "lab5-bp-bmi"
  | "lab9-bp-body"
  | "wearable-context";
export type MurphAgeEvidenceClass =
  | "abstained"
  | "context-only"
  | "custom-model-unreviewed"
  | "product-authorized"
  | "research-internal"
  | "research-transport";

export type MurphAgeWarningCode =
  | "BLOCKED_MODEL_FEATURE"
  | "CONTEXT_NOT_SCORE_BEARING"
  | "INVALID_INPUT"
  | "METRIC_SELECTION_WARNING"
  | "MODEL_CARD_NOT_AUTHORIZED"
  | "MODEL_CARD_POLICY_VIOLATION"
  | "MODEL_FEATURE_MISSING"
  | "OUT_OF_REFERENCE_RANGE"
  | "TRANSFORM_UNSUPPORTED";

export interface MurphAgeWarning {
  code: MurphAgeWarningCode;
  featureKey?: string;
  message: string;
  metricKey?: string;
}

export type MurphAgeFeatureTransform =
  | { kind: "identity" }
  | { kind: "ln"; offset?: number }
  | { clamp?: { max?: number; min?: number }; kind: "z-score"; mean: number; standardDeviation: number };

export interface MurphAgeModelFeatureBase {
  coefficient: number;
  key: string;
  label: string;
  moduleId?: string;
  transform?: MurphAgeFeatureTransform;
}

export type MurphAgeModelFeature =
  | (MurphAgeModelFeatureBase & { kind: "chronological-age" })
  | (MurphAgeModelFeatureBase & { kind: "sex"; sex: MurphAgeSex })
  | (MurphAgeModelFeatureBase & {
      biomarkerKey?: string;
      expectedUnit?: string;
      kind: "metric";
      metricKey: string;
      required?: boolean;
      selectionPolicy?: MetricSelectionPolicy;
    });

export interface MurphAgeReferenceRiskPoint {
  ageYears: number;
  riskProbability: number;
}

export interface MurphAgeRiskModel {
  blockedBiomarkerKeys?: readonly string[];
  blockedMetricKeys?: readonly string[];
  calibration?: {
    intercept: number;
    slope: number;
  };
  endpoint: string;
  features: readonly MurphAgeModelFeature[];
  horizonYears: number;
  intercept: number;
  modelId: string;
  modelVersion?: string;
  referencePopulation: string;
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[];
  uncertainty?: {
    baseYears?: number;
    perLowConfidenceMetricYears?: number;
    perMissingOptionalFeatureYears?: number;
  };
}

export interface MurphAgeCalculationInput {
  asOf?: string;
  chronologicalAgeYears: number;
  model: MurphAgeRiskModel;
  points: readonly MetricPoint[];
  sex: MurphAgeSex;
}

export type MurphAgeModelCardId =
  | "lab5_bp_bmi_transport_research"
  | "lab9_bp_body_10y_acm_research"
  | "wearable_context_no_risk";

export type MurphAgeScoreBearingCardId = Exclude<MurphAgeModelCardId, "wearable_context_no_risk">;
export type MurphAgeCalculatorMode = "product" | "research";
export type MurphAgeValidationGateStatus = "blocked" | "passed";
export type MurphAgeValidationEvidenceTier =
  | "internal-anchor"
  | "murph-native-prospective-validation"
  | "partner-aggregate-validation"
  | "same-family-sanity"
  | "true-external-validation";

export interface MurphAgeLocalModelCardArtifact {
  cardId: MurphAgeScoreBearingCardId;
  model: MurphAgeRiskModel;
  schemaVersion: typeof MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION;
}

export interface MurphAgeLocalModelCardArtifactParseResult {
  value: MurphAgeLocalModelCardArtifact | null;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeValidationGateSummary {
  evidenceTiers: readonly MurphAgeValidationEvidenceTier[];
  productPromotionEvidence: boolean;
  status: MurphAgeValidationGateStatus;
  summary: string;
}

export type MurphAgeRiskEndpoint = "all-cause-mortality" | "none";
export type MurphAgeAgeEstimateBasis = "none" | "risk-age-equivalent";

const MURPH_AGE_EMPTY_OUTCOME_CONTEXT = {
  ageEstimateBasis: "none",
  horizonYears: null,
  riskEndpoint: "none",
} satisfies MurphAgeOutcomeContext;

export interface MurphAgeOutcomeContext {
  ageEstimateBasis: MurphAgeAgeEstimateBasis;
  horizonYears: number | null;
  riskEndpoint: MurphAgeRiskEndpoint;
}

export interface MurphAgeModelCardOutcomePolicy extends MurphAgeOutcomeContext {
  modelEndpoint: string | null;
}

export interface MurphAgeModelCardPolicy {
  acceptedBundleIds: readonly MurphAgeInputBundleId[];
  cardId: MurphAgeModelCardId;
  evidenceClass: MurphAgeEvidenceClass;
  evidenceSummary: string;
  outcome: MurphAgeModelCardOutcomePolicy;
  productAuthorized: boolean;
  riskToAgeDisplayAuthorized: boolean;
  scoreBearing: boolean;
  scoreBearingMetricKeys: readonly string[];
  scoreBearingSourceKinds: readonly string[];
  validationGate: MurphAgeValidationGateSummary;
  wearableScoreBearingAuthorized: boolean;
}

const MURPH_AGE_PRODUCT_PROMOTION_EVIDENCE_TIERS = new Set<MurphAgeValidationEvidenceTier>([
  "murph-native-prospective-validation",
  "partner-aggregate-validation",
  "true-external-validation",
]);

export interface MurphAgeCalculatorInput {
  asOf?: string;
  chronologicalAgeYears: number;
  mode?: MurphAgeCalculatorMode;
  models?: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  points: readonly MetricPoint[];
  sex: MurphAgeSex;
}

export interface MurphAgeInputBundleAssessmentInput {
  asOf?: string;
  points: readonly MetricPoint[];
}

export interface MurphAgeInputBundleFeatureStatus {
  featureKey: string;
  label: string;
  metricKeys: string[];
  requiredFor: "lab5-fallback" | "lab9-mainline" | "optional-context" | "wearable-context";
  selectedMetricKey: string | null;
  selectedPointIds: string[];
  status: "missing" | "ready";
  unit: string | null;
  value: number | null;
}

export interface MurphAgeInputBundleAssessment {
  availableFeatureKeys: string[];
  bundleId: MurphAgeInputBundleId;
  featureStatuses: MurphAgeInputBundleFeatureStatus[];
  missingFeatureKeys: string[];
  recommendedCardId:
    | "lab5_bp_bmi_transport_research"
    | "lab9_bp_body_10y_acm_research"
    | "none"
    | "wearable_context_no_risk";
  schemaVersion: typeof MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION;
  selectedMetricKeys: string[];
  selectedPointIds: string[];
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeContextBundleFeatureStatus {
  featureKey: string;
  label: string;
  metricKeys: string[];
  requiredFor: "wearable-context";
  selectedMetricKey: string | null;
  selectedPointIds: string[];
  status: "missing" | "ready";
}

export interface MurphAgeContextBundleAssessment extends Omit<MurphAgeInputBundleAssessment, "bundleId" | "featureStatuses"> {
  bundleId: "wearable-context";
  featureStatuses: MurphAgeContextBundleFeatureStatus[];
}

export interface MurphAgeRiskEstimate {
  endpoint: string;
  horizonYears: number;
  probability: number;
  referencePopulation: string;
}

export interface MurphAgeFeatureAttribution {
  contributionLogit: number | null;
  contributionYears: number | null;
  featureKey: string;
  label: string;
  metricKey: string | null;
  moduleId: string;
  selectedPointIds: string[];
  status: "blocked" | "missing" | "ready";
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeModuleAttribution {
  contributionLogit: number;
  contributionYears: number | null;
  featureKeys: string[];
  moduleId: string;
}

export interface MurphAgeResultAuthorization {
  cardId: MurphAgeModelCardId | null;
  contextOnlyMetricKeys: string[];
  evidenceClass: MurphAgeEvidenceClass;
  evidenceSummary: string;
  productAuthorized: boolean;
  riskToAgeDisplayAuthorized: boolean;
  scoreBearing: boolean;
  scoreBearingMetricKeys: string[];
  scoreBearingSourceKinds: string[];
  wearableScoreBearingAuthorized: boolean;
}

export interface MurphAgeResult {
  ageDeltaYears: number | null;
  authorization: MurphAgeResultAuthorization;
  biologicalAgeYears: number | null;
  chronologicalAgeYears: number;
  featureAttributions: MurphAgeFeatureAttribution[];
  intervalYears: { high: number; low: number } | null;
  modelId: string;
  modelVersion: string | null;
  moduleAttributions: MurphAgeModuleAttribution[];
  risk: MurphAgeRiskEstimate | null;
  schemaVersion: typeof MURPH_AGE_RESULT_SCHEMA_VERSION;
  status: MurphAgeStatus;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeCalculatorOutput {
  authorization: MurphAgeResultAuthorization;
  bundleAssessment: MurphAgeInputBundleAssessment;
  cardPolicy: MurphAgeModelCardPolicy | null;
  contextAssessments: MurphAgeContextBundleAssessment[];
  mode: MurphAgeCalculatorMode;
  result: MurphAgeResult | null;
  schemaVersion: typeof MURPH_AGE_RESULT_SCHEMA_VERSION;
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgeWarning[];
  wearableShadowIncrementAssessments: MurphAgeWearableShadowIncrementAssessment[];
}

export interface MurphAgePublicFeatureAttribution {
  contributionYears: number | null;
  featureKey: string;
  metricKey: string | null;
  status: "blocked" | "missing" | "ready";
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicModuleAttribution {
  contributionYears: number | null;
  moduleId: string;
}

export interface MurphAgePublicRiskEstimate {
  horizonYears: number;
  probability: number;
}

export interface MurphAgePublicWarning {
  code: MurphAgeWarningCode;
  featureKey?: string;
  metricKey?: string;
}

export interface MurphAgePublicAuthorization {
  cardId: MurphAgeModelCardId | null;
  contextOnlyMetricKeys: string[];
  evidenceClass: MurphAgeEvidenceClass;
  productAuthorized: boolean;
  riskToAgeDisplayAuthorized: boolean;
  scoreBearing: boolean;
  scoreBearingMetricKeys: string[];
  scoreBearingSourceKinds: string[];
  wearableScoreBearingAuthorized: boolean;
}

export interface MurphAgePublicResult {
  ageDeltaYears: number | null;
  authorization: MurphAgePublicAuthorization;
  biologicalAgeYears: number | null;
  chronologicalAgeYears: number;
  featureAttributions: MurphAgePublicFeatureAttribution[];
  intervalYears: { high: number; low: number } | null;
  moduleAttributions: MurphAgePublicModuleAttribution[];
  risk: MurphAgePublicRiskEstimate | null;
  status: MurphAgeStatus;
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicCalculatorReport {
  authorization: MurphAgePublicAuthorization;
  displaySummary: MurphAgePublicDisplaySummary;
  mode: MurphAgeCalculatorMode;
  result: MurphAgePublicResult | null;
  schemaVersion: typeof MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION;
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgePublicWarning[];
}

export type MurphAgeDisplayStatus =
  | "abstain"
  | "context-only"
  | "product-age-ready"
  | "product-risk-only"
  | "research-only";

export type MurphAgeDisplayBlockedReason =
  | "age-estimate-unavailable"
  | "context-only"
  | "policy-violation"
  | "product-not-authorized"
  | "risk-estimate-unavailable"
  | "risk-to-age-not-authorized";

export type MurphAgeWearableContextFamily = "activity" | "quality" | "recovery" | "sleep";
export type MurphAgeWearableContextQuality = "none" | "strong-context" | "thin" | "usable-context";
export type MurphAgeWearableShadowIncrementFamily =
  | "activity"
  | "hrv"
  | "resting-heart-rate"
  | "sleep";
export type MurphAgeWearableShadowIncrementStatus = "blocked" | "missing" | "ready";
export type MurphAgeWearableBridgeFeatureFamily =
  | "activity"
  | "hrv"
  | "quality"
  | "resting-heart-rate"
  | "sleep";
export type MurphAgeWearableBridgeFeatureRole =
  | "deferred-context"
  | "quality"
  | "shadow-increment-signal";
export type MurphAgeWearableBridgeMethodQualifier = "not-required" | "recommended" | "required";
export type MurphAgeWearableBridgeSourceKind =
  | "activity-summary"
  | "sleep-summary"
  | "wearable-summary";
export type MurphAgeWearableBridgeReadinessStatus = "missing" | "partial" | "ready";
export type MurphAgeWearableBridgeUnlockPriority = "defer" | "first" | "second";

export interface MurphAgeWearableContextSummary {
  availableFeatureFamilies: MurphAgeWearableContextFamily[];
  availableQualityFeatureKeys: string[];
  missingQualityFeatureKeys: string[];
  quality: MurphAgeWearableContextQuality;
  readyFeatureCount: number;
  readyMetricCount: number;
  readyPointCount: number;
  riskEffect: "not-estimated";
  scoreBearing: false;
  scoreContributionAuthorized: false;
  uncertaintyAction: "context-only" | "none";
}

export interface MurphAgeWearableBridgeFeatureReadiness {
  family: MurphAgeWearableBridgeFeatureFamily;
  featureKey: string;
  label: string;
  methodQualifier: MurphAgeWearableBridgeMethodQualifier;
  metricKeys: string[];
  missingMetricKeys: string[];
  missingQualityMetricKeys: string[];
  productAuthorized: false;
  qualityReady: boolean;
  readyMetricKeys: string[];
  requiredQualityMetricKeys: string[];
  riskEffect: "not-estimated";
  role: MurphAgeWearableBridgeFeatureRole;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  status: MurphAgeWearableBridgeReadinessStatus;
  uncertaintyAction: "context-only" | "none";
  unlockPriority: MurphAgeWearableBridgeUnlockPriority;
}

export interface MurphAgeWearableBridgeSummary {
  candidateFeatureCount: number;
  deferredFeatureKeys: string[];
  features: MurphAgeWearableBridgeFeatureReadiness[];
  firstPriorityIncompleteFeatureKeys: string[];
  firstPriorityReadyFeatureKeys: string[];
  missingFeatureKeys: string[];
  partialFeatureKeys: string[];
  productAuthorized: false;
  readyFeatureKeys: string[];
  riskEffect: "not-estimated";
  scoreBearing: false;
  scoreContributionAuthorized: false;
  secondPriorityIncompleteFeatureKeys: string[];
  secondPriorityReadyFeatureKeys: string[];
}

export interface MurphAgePublicWearableContextSummary extends Omit<
  MurphAgeWearableContextSummary,
  "availableQualityFeatureKeys" | "missingQualityFeatureKeys"
> {
  availableQualityFeatureKeys: string[];
  missingQualityFeatureKeys: string[];
}

export interface MurphAgePublicWearableBridgeFeatureReadiness extends Omit<
  MurphAgeWearableBridgeFeatureReadiness,
  | "featureKey"
  | "label"
  | "metricKeys"
  | "missingMetricKeys"
  | "missingQualityMetricKeys"
  | "readyMetricKeys"
  | "requiredQualityMetricKeys"
> {
  featureKey: string;
  metricKeys: string[];
  missingMetricKeys: string[];
  missingQualityMetricKeys: string[];
  readyMetricKeys: string[];
  requiredQualityMetricKeys: string[];
}

export interface MurphAgePublicWearableBridgeSummary extends Omit<
  MurphAgeWearableBridgeSummary,
  | "deferredFeatureKeys"
  | "features"
  | "firstPriorityIncompleteFeatureKeys"
  | "firstPriorityReadyFeatureKeys"
  | "missingFeatureKeys"
  | "partialFeatureKeys"
  | "readyFeatureKeys"
  | "secondPriorityIncompleteFeatureKeys"
  | "secondPriorityReadyFeatureKeys"
> {
  deferredFeatureKeys: string[];
  features: MurphAgePublicWearableBridgeFeatureReadiness[];
  firstPriorityIncompleteFeatureKeys: string[];
  firstPriorityReadyFeatureKeys: string[];
  missingFeatureKeys: string[];
  partialFeatureKeys: string[];
  readyFeatureKeys: string[];
  secondPriorityIncompleteFeatureKeys: string[];
  secondPriorityReadyFeatureKeys: string[];
}

export interface MurphAgeDisplaySummary {
  ageEstimateAvailable: boolean;
  blockedFeatureKeys: string[];
  contextOnlyFeatureKeys: string[];
  contextOnlyMetricKeys: string[];
  contextOnlyPointIds: string[];
  displayBlockedReason: MurphAgeDisplayBlockedReason | null;
  displayStatus: MurphAgeDisplayStatus;
  missingFeatureKeys: string[];
  outcomeContext: MurphAgeOutcomeContext;
  productAgeDisplayReady: boolean;
  productRiskDisplayReady: boolean;
  researchEstimateAvailable: boolean;
  schemaVersion: typeof MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION;
  selectedScoreBearingFeatureKeys: string[];
  selectedScoreBearingMetricKeys: string[];
  selectedScoreBearingPointIds: string[];
  wearableBridge: MurphAgeWearableBridgeSummary;
  wearableContext: MurphAgeWearableContextSummary;
}

export interface MurphAgePublicDisplaySummary extends Omit<
  MurphAgeDisplaySummary,
  "contextOnlyPointIds" | "schemaVersion" | "selectedScoreBearingPointIds" | "wearableBridge" | "wearableContext"
> {
  schemaVersion: typeof MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION;
  wearableBridge: MurphAgePublicWearableBridgeSummary;
  wearableContext: MurphAgePublicWearableContextSummary;
}

export interface MurphAgeWearableShadowIncrementOutputBoundary {
  aggregateOnly: true;
  coefficientsExportAllowed: false;
  participantLevelExportAllowed: false;
  predictionsExportAllowed: false;
  productDisplayExportAllowed: false;
  rowValuesExportAllowed: false;
}

export interface MurphAgeWearableShadowIncrementPolicy {
  allowedMetricKeys: readonly string[];
  compatibleAnchorCardIds: readonly MurphAgeScoreBearingCardId[];
  evidenceSummary: string;
  family: MurphAgeWearableShadowIncrementFamily;
  outputBoundary: MurphAgeWearableShadowIncrementOutputBoundary;
  productAuthorized: false;
  requiredQualityMetricKeys: readonly string[];
  riskEffect: "not-estimated";
  schemaVersion: typeof MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  signalMetricKeys: readonly string[];
}

type MurphAgeWearableShadowIncrementPolicyDefinition = Omit<
  MurphAgeWearableShadowIncrementPolicy,
  "allowedMetricKeys"
>;

type MurphAgeWearableBridgeFeatureSpecDefinition = Omit<
  MurphAgeWearableBridgeFeatureSpec,
  | "outputBoundary"
  | "productAuthorized"
  | "riskEffect"
  | "schemaVersion"
  | "scoreBearing"
  | "scoreContributionAuthorized"
>;

export interface MurphAgeWearableShadowIncrementAssessmentInput {
  anchorCardId?: MurphAgeScoreBearingCardId | null;
  asOf?: string;
  points: readonly MetricPoint[];
}

export interface MurphAgeWearableShadowIncrementAssessment {
  anchorCardId: MurphAgeScoreBearingCardId | null;
  anchorCompatible: boolean;
  availableMetricKeys: string[];
  compatibleAnchorCardIds: MurphAgeScoreBearingCardId[];
  family: MurphAgeWearableShadowIncrementFamily;
  missingMetricKeys: string[];
  missingQualityMetricKeys: string[];
  outputBoundary: MurphAgeWearableShadowIncrementOutputBoundary;
  productAuthorized: false;
  readySignalMetricKeys: string[];
  riskEffect: "not-estimated";
  schemaVersion: typeof MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectedMetricKeys: string[];
  selectedPointIds: string[];
  status: MurphAgeWearableShadowIncrementStatus;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeWearableBridgeFeatureSpec {
  evidenceSummary: string;
  family: MurphAgeWearableBridgeFeatureFamily;
  featureKey: string;
  label: string;
  measurementWindowDays: readonly number[];
  methodQualifier: MurphAgeWearableBridgeMethodQualifier;
  metricKeys: readonly string[];
  outputBoundary: MurphAgeWearableShadowIncrementOutputBoundary;
  productAuthorized: false;
  requiredQualityMetricKeys: readonly string[];
  riskEffect: "not-estimated";
  role: MurphAgeWearableBridgeFeatureRole;
  schemaVersion: typeof MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  sourceKinds: readonly MurphAgeWearableBridgeSourceKind[];
  unlockPriority: MurphAgeWearableBridgeUnlockPriority;
}

export interface MurphAgeModelValidationResult {
  status: "invalid" | "valid";
  warnings: MurphAgeWarning[];
}

interface EvaluatedFeature {
  attribution: MurphAgeFeatureAttribution;
  confidence: MetricConfidence | null;
  contributionLogit: number;
  required: boolean;
}

interface MurphAgeInputFeatureRequirement {
  featureKey: string;
  label: string;
  metricKeys: readonly string[];
  requiredFor: MurphAgeInputBundleFeatureStatus["requiredFor"];
}

const DEFAULT_BLOCKED_METRIC_KEYS = ["hs-crp"] as const;
const DEFAULT_BLOCKED_BIOMARKER_KEYS = [
  "biomarker:c-reactive-protein",
  "biomarker:crp",
  "biomarker:high-sensitivity-crp",
  "biomarker:hs-crp",
] as const;

const MURPH_AGE_LAB9_FEATURES = [
  { featureKey: "albumin", label: "Albumin", metricKeys: ["albumin"], requiredFor: "lab9-mainline" },
  { featureKey: "creatinine", label: "Creatinine/eGFR", metricKeys: ["creatinine", "egfr"], requiredFor: "lab9-mainline" },
  { featureKey: "glycemia", label: "Glycemia", metricKeys: ["hba1c", "glucose"], requiredFor: "lab9-mainline" },
  {
    featureKey: "alkaline-phosphatase",
    label: "Alkaline phosphatase",
    metricKeys: ["alkaline-phosphatase"],
    requiredFor: "lab9-mainline",
  },
  {
    featureKey: "white-blood-cell-count",
    label: "White blood cells",
    metricKeys: ["white-blood-cell-count"],
    requiredFor: "lab9-mainline",
  },
  {
    featureKey: "lymphocyte-percentage",
    label: "Lymphocyte percentage",
    metricKeys: ["lymphocyte-percentage"],
    requiredFor: "lab9-mainline",
  },
  {
    featureKey: "red-cell-distribution-width",
    label: "Red cell distribution width",
    metricKeys: ["red-cell-distribution-width"],
    requiredFor: "lab9-mainline",
  },
  { featureKey: "hdl-c", label: "HDL-C", metricKeys: ["hdl-c"], requiredFor: "lab9-mainline" },
  { featureKey: "triglycerides", label: "Triglycerides", metricKeys: ["triglycerides"], requiredFor: "lab9-mainline" },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_BP_BODY_FEATURES = [
  {
    featureKey: "systolic-blood-pressure",
    label: "Systolic blood pressure",
    metricKeys: ["systolic-blood-pressure"],
    requiredFor: "lab9-mainline",
  },
  {
    featureKey: "diastolic-blood-pressure",
    label: "Diastolic blood pressure",
    metricKeys: ["diastolic-blood-pressure"],
    requiredFor: "lab9-mainline",
  },
  { featureKey: "bmi", label: "BMI", metricKeys: ["bmi"], requiredFor: "lab9-mainline" },
  {
    featureKey: "waist-circumference",
    label: "Waist circumference",
    metricKeys: ["waist-circumference"],
    requiredFor: "optional-context",
  },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_LAB5_FEATURES = [
  { featureKey: "glycemia", label: "Glycemia", metricKeys: ["hba1c", "glucose"], requiredFor: "lab5-fallback" },
  { featureKey: "hdl-c", label: "HDL-C", metricKeys: ["hdl-c"], requiredFor: "lab5-fallback" },
  { featureKey: "triglycerides", label: "Triglycerides", metricKeys: ["triglycerides"], requiredFor: "lab5-fallback" },
  { featureKey: "creatinine", label: "Creatinine/eGFR", metricKeys: ["creatinine", "egfr"], requiredFor: "lab5-fallback" },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_WEARABLE_CONTEXT_FEATURES = [
  { featureKey: "steps", label: "Steps", metricKeys: ["steps"], requiredFor: "wearable-context" },
  { featureKey: "activity-minutes", label: "Activity minutes", metricKeys: ["activity-minutes"], requiredFor: "wearable-context" },
  { featureKey: "mvpa-minutes", label: "MVPA", metricKeys: ["mvpa-minutes"], requiredFor: "wearable-context" },
  { featureKey: "sedentary-minutes", label: "Sedentary time", metricKeys: ["sedentary-minutes"], requiredFor: "wearable-context" },
  {
    featureKey: "estimated-vo2-max",
    label: "Estimated VO2 max",
    metricKeys: ["estimated-vo2-max"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "total-sleep-minutes",
    label: "Total sleep",
    metricKeys: ["total-sleep-minutes"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-duration-variability-minutes",
    label: "Sleep duration variability",
    metricKeys: ["sleep-duration-variability-minutes"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-efficiency",
    label: "Sleep efficiency",
    metricKeys: ["sleep-efficiency"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-regularity-score",
    label: "Sleep regularity",
    metricKeys: ["sleep-regularity-score"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-midpoint-variability-minutes",
    label: "Sleep timing variability",
    metricKeys: ["sleep-midpoint-variability-minutes"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "resting-heart-rate",
    label: "Resting heart rate",
    metricKeys: ["resting-heart-rate"],
    requiredFor: "wearable-context",
  },
  { featureKey: "hrv-rmssd", label: "HRV", metricKeys: ["hrv-rmssd"], requiredFor: "wearable-context" },
  {
    featureKey: "wearable-valid-day-count-28d",
    label: "Wearable valid days",
    metricKeys: ["wearable-valid-day-count-28d"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "wearable-valid-night-count-28d",
    label: "Wearable valid nights",
    metricKeys: ["wearable-valid-night-count-28d"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "wearable-coverage-index",
    label: "Wearable coverage",
    metricKeys: ["wearable-coverage-index"],
    requiredFor: "wearable-context",
  },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES = {
  activity: [
    "activity-minutes",
    "estimated-vo2-max",
    "mvpa-minutes",
    "sedentary-minutes",
    "steps",
  ],
  quality: [
    "wearable-coverage-index",
    "wearable-valid-day-count-28d",
    "wearable-valid-night-count-28d",
  ],
  recovery: [
    "hrv-rmssd",
    "resting-heart-rate",
  ],
  sleep: [
    "sleep-duration-variability-minutes",
    "sleep-efficiency",
    "sleep-midpoint-variability-minutes",
    "sleep-regularity-score",
    "total-sleep-minutes",
  ],
} satisfies Record<MurphAgeWearableContextFamily, readonly string[]>;

const MURPH_AGE_WEARABLE_QUALITY_FEATURE_KEYS =
  MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES.quality;

const MURPH_AGE_WEARABLE_COVERAGE_QUALITY_METRIC_KEYS = [
  "wearable-coverage-index",
] as const;

const MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS = [
  "wearable-valid-day-count-28d",
  ...MURPH_AGE_WEARABLE_COVERAGE_QUALITY_METRIC_KEYS,
] as const;

const MURPH_AGE_WEARABLE_NIGHT_QUALITY_METRIC_KEYS = [
  "wearable-valid-night-count-28d",
  ...MURPH_AGE_WEARABLE_COVERAGE_QUALITY_METRIC_KEYS,
] as const;

const MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY = {
  aggregateOnly: true,
  coefficientsExportAllowed: false,
  participantLevelExportAllowed: false,
  predictionsExportAllowed: false,
  productDisplayExportAllowed: false,
  rowValuesExportAllowed: false,
} satisfies MurphAgeWearableShadowIncrementOutputBoundary;

const MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS = [
  "lab9_bp_body_10y_acm_research",
  "lab5_bp_bmi_transport_research",
] satisfies readonly MurphAgeScoreBearingCardId[];

const MURPH_AGE_WEARABLE_SHADOW_SOURCE_KINDS = [
  "activity-summary",
  "sleep-summary",
  "wearable-summary",
] as const satisfies readonly MurphAgeWearableBridgeSourceKind[];

const MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPEC_DEFINITIONS = [
  {
    evidenceSummary: "Coverage and valid-day/night counts are bridge quality features only; they gate wearable research readiness but never score Murph Age.",
    family: "quality",
    featureKey: "wearable-coverage-quality",
    label: "Wearable coverage quality",
    measurementWindowDays: [28],
    methodQualifier: "not-required",
    metricKeys: [
      "wearable-coverage-index",
      "wearable-valid-day-count-28d",
      "wearable-valid-night-count-28d",
    ],
    requiredQualityMetricKeys: [],
    role: "quality",
    sourceKinds: MURPH_AGE_WEARABLE_SHADOW_SOURCE_KINDS,
    unlockPriority: "first",
  },
  {
    evidenceSummary: "Activity volume is the first wearable bridge candidate because steps and active-minute features have broad availability and clearer population-level interpretation.",
    family: "activity",
    featureKey: "activity-volume",
    label: "Activity volume",
    measurementWindowDays: [28],
    methodQualifier: "recommended",
    metricKeys: [
      "steps",
      "activity-minutes",
      "mvpa-minutes",
    ],
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    role: "shadow-increment-signal",
    sourceKinds: ["activity-summary", "wearable-summary"],
    unlockPriority: "first",
  },
  {
    evidenceSummary: "Sedentary time is evaluated with activity volume but remains a shadow bridge signal until wear-time handling and external calibration are proven.",
    family: "activity",
    featureKey: "sedentary-time",
    label: "Sedentary time",
    measurementWindowDays: [28],
    methodQualifier: "recommended",
    metricKeys: ["sedentary-minutes"],
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    role: "shadow-increment-signal",
    sourceKinds: ["activity-summary", "wearable-summary"],
    unlockPriority: "first",
  },
  {
    evidenceSummary: "Sleep duration and regularity are second-wave wearable bridge candidates because consumer-device methods and night-level completeness need explicit qualification.",
    family: "sleep",
    featureKey: "sleep-duration-regularity",
    label: "Sleep duration and regularity",
    measurementWindowDays: [28],
    methodQualifier: "required",
    metricKeys: [
      "total-sleep-minutes",
      "sleep-duration-variability-minutes",
      "sleep-regularity-score",
      "sleep-midpoint-variability-minutes",
    ],
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_NIGHT_QUALITY_METRIC_KEYS,
    role: "shadow-increment-signal",
    sourceKinds: ["sleep-summary", "wearable-summary"],
    unlockPriority: "second",
  },
  {
    evidenceSummary: "Resting heart rate is a second-wave autonomic bridge signal; it requires device/source qualification and can only be tested as a residual increment over the lab/BP/body anchor.",
    family: "resting-heart-rate",
    featureKey: "resting-heart-rate",
    label: "Resting heart rate",
    measurementWindowDays: [28],
    methodQualifier: "required",
    metricKeys: ["resting-heart-rate"],
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    role: "shadow-increment-signal",
    sourceKinds: ["wearable-summary"],
    unlockPriority: "second",
  },
  {
    evidenceSummary: "HRV RMSSD is deferred until method, sampling window, and device-source comparability are explicit; it is not a score-bearing Murph Age input.",
    family: "hrv",
    featureKey: "hrv-rmssd",
    label: "HRV RMSSD",
    measurementWindowDays: [28],
    methodQualifier: "required",
    metricKeys: ["hrv-rmssd"],
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    role: "deferred-context",
    sourceKinds: ["wearable-summary"],
    unlockPriority: "defer",
  },
  {
    evidenceSummary: "Estimated VO2 max is deferred because consumer estimates are model-derived and need source/method validation before any residual-increment study.",
    family: "activity",
    featureKey: "estimated-vo2-max",
    label: "Estimated VO2 max",
    measurementWindowDays: [90],
    methodQualifier: "required",
    metricKeys: ["estimated-vo2-max"],
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    role: "deferred-context",
    sourceKinds: ["activity-summary", "wearable-summary"],
    unlockPriority: "defer",
  },
] satisfies readonly MurphAgeWearableBridgeFeatureSpecDefinition[];

const MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS =
  MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPEC_DEFINITIONS.map(completeWearableBridgeFeatureSpec);

const MURPH_AGE_MODEL_CARD_POLICIES = [
  {
    acceptedBundleIds: ["lab9-bp-body"],
    cardId: "lab9_bp_body_10y_acm_research",
    evidenceClass: "research-internal",
    evidenceSummary: "Lab9/BP/body hard-outcome research card; not product-authorized and not validated for score-bearing wearable inputs.",
    outcome: {
      ageEstimateBasis: "risk-age-equivalent",
      horizonYears: 10,
      modelEndpoint: "10-year all-cause mortality",
      riskEndpoint: "all-cause-mortality",
    },
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: true,
    scoreBearingMetricKeys: [
      "albumin",
      "creatinine",
      "egfr",
      "hba1c",
      "glucose",
      "alkaline-phosphatase",
      "white-blood-cell-count",
      "lymphocyte-percentage",
      "red-cell-distribution-width",
      "hdl-c",
      "triglycerides",
      "systolic-blood-pressure",
      "diastolic-blood-pressure",
      "bmi",
      "waist-circumference",
    ],
    scoreBearingSourceKinds: ["measurement", "test-result"],
    validationGate: {
      evidenceTiers: ["internal-anchor"],
      productPromotionEvidence: false,
      status: "blocked",
      summary: "Internal research anchor only; product promotion requires external validation evidence.",
    },
    wearableScoreBearingAuthorized: false,
  },
  {
    acceptedBundleIds: ["lab5-bp-bmi"],
    cardId: "lab5_bp_bmi_transport_research",
    evidenceClass: "research-transport",
    evidenceSummary: "Smaller lab/BP/body transport research card for partial clinical bundles; not product-authorized and not validated for score-bearing wearable inputs.",
    outcome: {
      ageEstimateBasis: "risk-age-equivalent",
      horizonYears: 10,
      modelEndpoint: "10-year all-cause mortality",
      riskEndpoint: "all-cause-mortality",
    },
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: true,
    scoreBearingMetricKeys: [
      "glucose",
      "hba1c",
      "hdl-c",
      "triglycerides",
      "creatinine",
      "egfr",
      "systolic-blood-pressure",
      "diastolic-blood-pressure",
      "bmi",
      "waist-circumference",
    ],
    scoreBearingSourceKinds: ["measurement", "test-result"],
    validationGate: {
      evidenceTiers: ["internal-anchor", "same-family-sanity"],
      productPromotionEvidence: false,
      status: "blocked",
      summary: "Transport research card only; product promotion requires external validation evidence.",
    },
    wearableScoreBearingAuthorized: false,
  },
  {
    acceptedBundleIds: ["wearable-context"],
    cardId: "wearable_context_no_risk",
    evidenceClass: "context-only",
    evidenceSummary: "Wearable inputs may be shown as context, but they are not score-bearing in current Murph Age cards.",
    outcome: {
      ageEstimateBasis: "none",
      horizonYears: null,
      modelEndpoint: null,
      riskEndpoint: "none",
    },
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: false,
    scoreBearingMetricKeys: [],
    scoreBearingSourceKinds: [],
    validationGate: {
      evidenceTiers: [],
      productPromotionEvidence: false,
      status: "blocked",
      summary: "Wearable context card is not a score-bearing Murph Age model.",
    },
    wearableScoreBearingAuthorized: false,
  },
] satisfies readonly MurphAgeModelCardPolicy[];

const MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICY_DEFINITIONS = [
  {
    compatibleAnchorCardIds: MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS,
    evidenceSummary: "Activity features may be evaluated as a shadow increment over the frozen lab/BP/body anchor, but they are not score-bearing.",
    family: "activity",
    outputBoundary: MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY,
    productAuthorized: false,
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    riskEffect: "not-estimated",
    schemaVersion: MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "steps",
      "activity-minutes",
      "mvpa-minutes",
      "sedentary-minutes",
      "estimated-vo2-max",
    ],
  },
  {
    compatibleAnchorCardIds: MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS,
    evidenceSummary: "Sleep features may be evaluated as a shadow increment over the frozen lab/BP/body anchor, but they are not score-bearing.",
    family: "sleep",
    outputBoundary: MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY,
    productAuthorized: false,
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_NIGHT_QUALITY_METRIC_KEYS,
    riskEffect: "not-estimated",
    schemaVersion: MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "total-sleep-minutes",
      "sleep-duration-variability-minutes",
      "sleep-efficiency",
      "sleep-regularity-score",
      "sleep-midpoint-variability-minutes",
    ],
  },
  {
    compatibleAnchorCardIds: MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS,
    evidenceSummary: "Resting-heart-rate features may be evaluated as a shadow increment over the frozen lab/BP/body anchor, but they are not score-bearing.",
    family: "resting-heart-rate",
    outputBoundary: MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY,
    productAuthorized: false,
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    riskEffect: "not-estimated",
    schemaVersion: MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "resting-heart-rate",
    ],
  },
  {
    compatibleAnchorCardIds: MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS,
    evidenceSummary: "HRV features may be evaluated as a shadow increment over the frozen lab/BP/body anchor, but they are not score-bearing.",
    family: "hrv",
    outputBoundary: MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY,
    productAuthorized: false,
    requiredQualityMetricKeys: MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS,
    riskEffect: "not-estimated",
    schemaVersion: MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "hrv-rmssd",
    ],
  },
] satisfies readonly MurphAgeWearableShadowIncrementPolicyDefinition[];

const MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES =
  MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICY_DEFINITIONS.map(completeWearableShadowIncrementPolicy);

const MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS = new Set(
  MURPH_AGE_WEARABLE_CONTEXT_FEATURES.flatMap((feature) => feature.metricKeys),
);

const MURPH_AGE_INPUT_BUNDLE_METRIC_KEYS = new Set([
  ...MURPH_AGE_LAB9_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_BP_BODY_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_LAB5_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS,
]);

const MURPH_AGE_PUBLIC_FEATURE_KEYS = new Set([
  ...MURPH_AGE_LAB9_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_BP_BODY_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_LAB5_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_WEARABLE_CONTEXT_FEATURES.map((feature) => feature.featureKey),
  "chronological-age",
  "sex",
]);

const MURPH_AGE_PUBLIC_WEARABLE_BRIDGE_FEATURE_KEYS = new Set(
  MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS.map((feature) => feature.featureKey),
);

const MURPH_AGE_PUBLIC_METRIC_KEYS = new Set([
  ...MURPH_AGE_LAB9_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_BP_BODY_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_LAB5_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_WEARABLE_CONTEXT_FEATURES.flatMap((feature) => feature.metricKeys),
]);

export function listMurphAgeModelCardPolicies(): MurphAgeModelCardPolicy[] {
  return MURPH_AGE_MODEL_CARD_POLICIES.map(cloneMurphAgeModelCardPolicy);
}

export function listMurphAgeWearableShadowIncrementPolicies(): MurphAgeWearableShadowIncrementPolicy[] {
  return MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.map(cloneMurphAgeWearableShadowIncrementPolicy);
}

export function listMurphAgeWearableBridgeFeatureSpecs(): MurphAgeWearableBridgeFeatureSpec[] {
  return MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS.map(cloneMurphAgeWearableBridgeFeatureSpec);
}

export function listMurphAgeInputBundleMetricKeys(): string[] {
  return [...MURPH_AGE_INPUT_BUNDLE_METRIC_KEYS];
}

export function isMurphAgeInputBundleMetricPointAllowed(
  point: Pick<MetricPoint, "metricKey" | "source">,
): boolean {
  const metricKey = resolveMetricInputKey(point.metricKey);
  if (!MURPH_AGE_INPUT_BUNDLE_METRIC_KEYS.has(metricKey)) return false;
  if (MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS.has(metricKey)) {
    return point.source.kind === "activity-summary"
      || point.source.kind === "sleep-summary"
      || point.source.kind === "wearable-summary";
  }
  return point.source.kind === "measurement" || point.source.kind === "test-result";
}

export function resolveMurphAgeModelCardPolicy(
  cardId: MurphAgeInputBundleAssessment["recommendedCardId"],
): MurphAgeModelCardPolicy | null {
  if (cardId === "none") return null;
  const policy = MURPH_AGE_MODEL_CARD_POLICIES.find((candidate) => candidate.cardId === cardId) ?? null;
  return policy ? cloneMurphAgeModelCardPolicy(policy) : null;
}

export function isMurphAgeModelCardProductAuthorized(policy: MurphAgeModelCardPolicy): boolean {
  return policy.productAuthorized
    && policy.validationGate.status === "passed"
    && policy.validationGate.productPromotionEvidence
    && hasMurphAgeProductPromotionEvidenceTier(policy.validationGate);
}

export function isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy: MurphAgeModelCardPolicy): boolean {
  return policy.riskToAgeDisplayAuthorized && isMurphAgeModelCardProductAuthorized(policy);
}

export function hasMurphAgeProductPromotionEvidenceTier(summary: MurphAgeValidationGateSummary): boolean {
  return summary.evidenceTiers.some((tier) => MURPH_AGE_PRODUCT_PROMOTION_EVIDENCE_TIERS.has(tier));
}

export function resolveMurphAgeWearableShadowIncrementPolicy(
  family: MurphAgeWearableShadowIncrementFamily,
): MurphAgeWearableShadowIncrementPolicy | null {
  const policy = MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.find((candidate) =>
    candidate.family === family
  ) ?? null;
  return policy ? cloneMurphAgeWearableShadowIncrementPolicy(policy) : null;
}

export function resolveMurphAgeWearableBridgeFeatureSpec(
  featureKey: string,
): MurphAgeWearableBridgeFeatureSpec | null {
  const spec = MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS.find((candidate) =>
    candidate.featureKey === featureKey
  ) ?? null;
  return spec ? cloneMurphAgeWearableBridgeFeatureSpec(spec) : null;
}

export function assessMurphAgeWearableShadowIncrements(
  input: MurphAgeWearableShadowIncrementAssessmentInput,
): MurphAgeWearableShadowIncrementAssessment[] {
  return MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.map((policy) =>
    assessMurphAgeWearableShadowIncrementPolicy({ input, policy })
  );
}

export function createMurphAgeAbstainedAuthorization(input: {
  contextOnlyMetricKeys?: readonly string[];
} = {}): MurphAgeResultAuthorization {
  return {
    cardId: null,
    contextOnlyMetricKeys: uniqueStrings(input.contextOnlyMetricKeys ?? []),
    evidenceClass: "abstained",
    evidenceSummary: "No score-bearing Murph Age model-card policy was selected.",
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: false,
    scoreBearingMetricKeys: [],
    scoreBearingSourceKinds: [],
    wearableScoreBearingAuthorized: false,
  };
}

export function createMurphAgeCustomModelAuthorization(model: MurphAgeRiskModel): MurphAgeResultAuthorization {
  return {
    cardId: null,
    contextOnlyMetricKeys: [],
    evidenceClass: "custom-model-unreviewed",
    evidenceSummary: "Direct Murph Age model calculation without a model-card policy; not product-authorized.",
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: true,
    scoreBearingMetricKeys: uniqueStrings(
      model.features
        .filter((feature) => feature.kind === "metric")
        .map((feature) => resolveMetricInputKey(feature.metricKey)),
    ),
    scoreBearingSourceKinds: [],
    wearableScoreBearingAuthorized: false,
  };
}

export function calculateMurphAgeFromInputBundle(input: MurphAgeCalculatorInput): MurphAgeCalculatorOutput {
  const mode = input.mode ?? "product";
  const bundleAssessment = assessMurphAgeInputBundle({
    asOf: input.asOf,
    points: input.points,
  });
  const contextAssessments = assessMurphAgeSecondaryContextBundles({
    asOf: input.asOf,
    points: input.points,
    primaryBundleId: bundleAssessment.bundleId,
  });
  const cardPolicy = resolveMurphAgeModelCardPolicy(bundleAssessment.recommendedCardId);
  const wearableShadowIncrementAssessments = cardPolicy && isScoreBearingCardId(cardPolicy.cardId)
    ? assessMurphAgeWearableShadowIncrements({
      anchorCardId: cardPolicy.cardId,
      asOf: input.asOf,
      points: input.points,
    })
    : [];
  const authorization = createMurphAgeCardPolicyAuthorization({
    bundleAssessment,
    cardPolicy,
    contextAssessments,
  });
  const warnings = [
    ...bundleAssessment.warnings,
    ...contextAssessments.flatMap((assessment) => assessment.warnings),
  ];

  if (!cardPolicy || !cardPolicy.scoreBearing || !isScoreBearingCardId(cardPolicy.cardId)) {
    return buildCalculatorOutput({
      bundleAssessment,
      cardPolicy,
      contextAssessments,
      mode,
      result: null,
      status: bundleAssessment.status,
      authorization,
      warnings,
      wearableShadowIncrementAssessments,
    });
  }

  if (mode === "product" && !authorization.productAuthorized) {
    warnings.push({
      code: "MODEL_CARD_NOT_AUTHORIZED",
      message: `${cardPolicy.cardId} is research-only and is not authorized as a product Murph Age calculator model.`,
    });
    return buildCalculatorOutput({
      bundleAssessment,
      cardPolicy,
      contextAssessments,
      mode,
      result: null,
      status: "abstain",
      authorization,
      warnings,
      wearableShadowIncrementAssessments,
    });
  }

  const model = input.models?.[cardPolicy.cardId];
  if (!model) {
    warnings.push({
      code: "MODEL_FEATURE_MISSING",
      message: `${cardPolicy.cardId} was selected, but no matching score-bearing model was supplied.`,
    });
    return buildCalculatorOutput({
      bundleAssessment,
      cardPolicy,
      contextAssessments,
      mode,
      result: null,
      status: "abstain",
      authorization,
      warnings,
      wearableShadowIncrementAssessments,
    });
  }

  const policyViolation = findModelCardPolicyViolation({
    asOf: input.asOf,
    cardPolicy,
    model,
    points: input.points,
  });
  if (policyViolation) {
    warnings.push(policyViolation);
    const result = withMurphAgeAuthorization(
      emptyMurphAgeResult({
        chronologicalAgeYears: input.chronologicalAgeYears,
        featureAttributions: [],
        model,
        status: "abstain",
        warnings,
      }),
      authorization,
    );
    return buildCalculatorOutput({
      bundleAssessment,
      cardPolicy,
      contextAssessments,
      mode,
      result,
      status: "abstain",
      authorization,
      warnings,
      wearableShadowIncrementAssessments,
    });
  }

  const result = withMurphAgeAuthorization(
    calculateMurphAge({
      asOf: input.asOf,
      chronologicalAgeYears: input.chronologicalAgeYears,
      model,
      points: input.points,
      sex: input.sex,
    }),
    authorization,
  );

  return buildCalculatorOutput({
    bundleAssessment,
    cardPolicy,
    contextAssessments,
    mode,
    result,
    status: result.status === "ready" ? "ready" : "abstain",
    authorization,
    warnings: [...warnings, ...result.warnings],
    wearableShadowIncrementAssessments,
  });
}

export function calculateMurphAge(input: MurphAgeCalculationInput): MurphAgeResult {
  const warnings: MurphAgeWarning[] = [];

  if (!Number.isFinite(input.chronologicalAgeYears) || input.chronologicalAgeYears <= 0) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Chronological age must be a positive finite number of years.",
    });
  }

  warnings.push(...validateMurphAgeRiskModel(input.model).warnings);

  if (warnings.some((warning) => warning.code === "INVALID_INPUT")) {
    return emptyMurphAgeResult({
      chronologicalAgeYears: input.chronologicalAgeYears,
      featureAttributions: [],
      model: input.model,
      status: "abstain",
      warnings,
    });
  }

  const blockedIdentifiers = normalizedBlockedIdentifiers(input.model);
  const evaluatedFeatures = input.model.features.map((feature) =>
    evaluateFeature({ blockedIdentifiers, feature, input })
  );
  const featureAttributions = evaluatedFeatures.map((feature) => feature.attribution);

  for (const attribution of featureAttributions) {
    warnings.push(...attribution.warnings);
  }

  const requiredFeatureMissing = evaluatedFeatures.some((feature) =>
    feature.required && feature.attribution.status === "missing"
  );
  const blockedFeatureSeen = featureAttributions.some((feature) => feature.status === "blocked");

  if (warnings.some((warning) => warning.code === "INVALID_INPUT") || requiredFeatureMissing || blockedFeatureSeen) {
    return emptyMurphAgeResult({
      chronologicalAgeYears: input.chronologicalAgeYears,
      featureAttributions,
      model: input.model,
      status: "abstain",
      warnings,
    });
  }

  const readyFeatures = evaluatedFeatures.filter((feature) => feature.attribution.status === "ready");
  const linearScore = input.model.intercept + readyFeatures.reduce((sum, feature) => sum + feature.contributionLogit, 0);
  const calibratedLogit = applyCalibration(linearScore, input.model.calibration);
  const riskProbability = logistic(calibratedLogit);
  const ageMapping = mapRiskToReferenceAge(riskProbability, input.model.referenceRiskCurve);
  warnings.push(...ageMapping.warnings);

  const biologicalAgeYears = roundYears(ageMapping.ageYears);
  const intervalYears = buildAgeInterval({
    ageYears: biologicalAgeYears,
    lowConfidenceMetricCount: readyFeatures.filter((feature) => feature.confidence === "low").length,
    missingOptionalFeatureCount: evaluatedFeatures.filter((feature) =>
      !feature.required && feature.attribution.status === "missing"
    ).length,
    model: input.model,
  });

  return {
    ageDeltaYears: roundYears(biologicalAgeYears - input.chronologicalAgeYears),
    authorization: createMurphAgeCustomModelAuthorization(input.model),
    biologicalAgeYears,
    chronologicalAgeYears: input.chronologicalAgeYears,
    featureAttributions: withContributionYears({
      ageYears: biologicalAgeYears,
      calibratedLogit,
      features: evaluatedFeatures,
      model: input.model,
    }),
    intervalYears,
    modelId: input.model.modelId,
    modelVersion: input.model.modelVersion ?? null,
    moduleAttributions: buildModuleAttributions({
      ageYears: biologicalAgeYears,
      calibratedLogit,
      features: readyFeatures,
      model: input.model,
    }),
    risk: {
      endpoint: input.model.endpoint,
      horizonYears: input.model.horizonYears,
      probability: roundProbability(riskProbability),
      referencePopulation: input.model.referencePopulation,
    },
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: "ready",
    warnings,
  };
}

export function summarizeMurphAgeCalculatorOutput(
  output: MurphAgeCalculatorOutput,
): MurphAgeDisplaySummary {
  const readyAttributions = output.result?.featureAttributions.filter((feature) =>
    feature.status === "ready" && feature.metricKey !== null
  ) ?? [];
  const missingAttributions = output.result?.featureAttributions.filter((feature) =>
    feature.status === "missing"
  ) ?? [];
  const blockedAttributions = output.result?.featureAttributions.filter((feature) =>
    feature.status === "blocked"
  ) ?? [];
  const contextFeatures = listContextOnlyFeatureStatuses(output);
  const wearableContext = summarizeWearableContext(contextFeatures);
  const wearableBridge = summarizeWearableBridge(contextFeatures);
  const ageEstimateAvailable = output.result?.status === "ready" && output.result.biologicalAgeYears !== null;
  const riskEstimateAvailable = output.result?.risk !== null && output.result?.risk !== undefined;
  const productRiskDisplayReady = riskEstimateAvailable && output.authorization.productAuthorized;
  const productAgeDisplayReady = ageEstimateAvailable
    && productRiskDisplayReady
    && output.authorization.riskToAgeDisplayAuthorized;

  return {
    ageEstimateAvailable,
    blockedFeatureKeys: uniqueStrings(blockedAttributions.map((feature) => feature.featureKey)),
    contextOnlyFeatureKeys: uniqueStrings(contextFeatures.map((feature) => feature.featureKey)),
    contextOnlyMetricKeys: uniqueStrings(contextFeatures.map((feature) => feature.selectedMetricKey)),
    contextOnlyPointIds: uniqueStrings(contextFeatures.flatMap((feature) => feature.selectedPointIds)),
    displayBlockedReason: resolveDisplayBlockedReason({
      ageEstimateAvailable,
      output,
      productRiskDisplayReady,
      riskEstimateAvailable,
    }),
    displayStatus: resolveDisplayStatus({
      ageEstimateAvailable,
      output,
      productAgeDisplayReady,
      productRiskDisplayReady,
    }),
    missingFeatureKeys: uniqueStrings(missingAttributions.map((feature) => feature.featureKey)),
    outcomeContext: resolveMurphAgeOutcomeContext(output.cardPolicy),
    productAgeDisplayReady,
    productRiskDisplayReady,
    researchEstimateAvailable: output.mode === "research" && ageEstimateAvailable,
    schemaVersion: MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION,
    selectedScoreBearingFeatureKeys: uniqueStrings(readyAttributions.map((feature) => feature.featureKey)),
    selectedScoreBearingMetricKeys: uniqueStrings(readyAttributions.map((feature) => feature.metricKey)),
    selectedScoreBearingPointIds: uniqueStrings(readyAttributions.flatMap((feature) => feature.selectedPointIds)),
    wearableBridge,
    wearableContext,
  };
}

export function summarizeMurphAgeCalculatorPublicOutput(
  output: MurphAgeCalculatorOutput,
): MurphAgePublicDisplaySummary {
  return toPublicMurphAgeDisplaySummary(summarizeMurphAgeCalculatorOutput(output));
}

export function toPublicMurphAgeCalculatorReport(
  output: MurphAgeCalculatorOutput,
): MurphAgePublicCalculatorReport {
  return {
    authorization: toPublicMurphAgeAuthorization(output.authorization),
    displaySummary: summarizeMurphAgeCalculatorPublicOutput(output),
    mode: output.mode,
    result: output.result ? toPublicMurphAgeResult(output.result) : null,
    schemaVersion: MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION,
    status: output.status,
    warnings: toPublicMurphAgeWarnings(output.warnings),
  };
}

export function toPublicMurphAgeDisplaySummary(
  summary: MurphAgeDisplaySummary,
): MurphAgePublicDisplaySummary {
  return {
    ageEstimateAvailable: summary.ageEstimateAvailable,
    blockedFeatureKeys: toPublicFeatureKeyList(summary.blockedFeatureKeys),
    contextOnlyFeatureKeys: toPublicFeatureKeyList(summary.contextOnlyFeatureKeys),
    contextOnlyMetricKeys: toPublicMetricKeyList(summary.contextOnlyMetricKeys),
    displayBlockedReason: summary.displayBlockedReason,
    displayStatus: summary.displayStatus,
    missingFeatureKeys: toPublicFeatureKeyList(summary.missingFeatureKeys),
    outcomeContext: toPublicMurphAgeOutcomeContext(summary.outcomeContext),
    productAgeDisplayReady: summary.productAgeDisplayReady,
    productRiskDisplayReady: summary.productRiskDisplayReady,
    researchEstimateAvailable: summary.researchEstimateAvailable,
    schemaVersion: MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION,
    selectedScoreBearingFeatureKeys: toPublicFeatureKeyList(summary.selectedScoreBearingFeatureKeys),
    selectedScoreBearingMetricKeys: toPublicMetricKeyList(summary.selectedScoreBearingMetricKeys),
    wearableBridge: toPublicWearableBridgeSummary(summary.wearableBridge),
    wearableContext: {
      availableFeatureFamilies: [...summary.wearableContext.availableFeatureFamilies],
      availableQualityFeatureKeys: toPublicFeatureKeyList(summary.wearableContext.availableQualityFeatureKeys),
      missingQualityFeatureKeys: toPublicFeatureKeyList(summary.wearableContext.missingQualityFeatureKeys),
      quality: summary.wearableContext.quality,
      readyFeatureCount: summary.wearableContext.readyFeatureCount,
      readyMetricCount: summary.wearableContext.readyMetricCount,
      readyPointCount: summary.wearableContext.readyPointCount,
      riskEffect: "not-estimated",
      scoreBearing: false,
      scoreContributionAuthorized: false,
      uncertaintyAction: summary.wearableContext.uncertaintyAction,
    },
  };
}

function toPublicMurphAgeResult(result: MurphAgeResult): MurphAgePublicResult {
  return {
    ageDeltaYears: result.ageDeltaYears,
    authorization: toPublicMurphAgeAuthorization(result.authorization),
    biologicalAgeYears: result.biologicalAgeYears,
    chronologicalAgeYears: result.chronologicalAgeYears,
    featureAttributions: result.featureAttributions.map(toPublicMurphAgeFeatureAttribution),
    intervalYears: result.intervalYears ? { ...result.intervalYears } : null,
    moduleAttributions: result.moduleAttributions.map(toPublicMurphAgeModuleAttribution),
    risk: result.risk ? {
      horizonYears: result.risk.horizonYears,
      probability: result.risk.probability,
    } : null,
    status: result.status,
    warnings: toPublicMurphAgeWarnings(result.warnings),
  };
}

function toPublicMurphAgeFeatureAttribution(
  feature: MurphAgeFeatureAttribution,
): MurphAgePublicFeatureAttribution {
  return {
    contributionYears: feature.contributionYears,
    featureKey: toPublicFeatureKey(feature),
    metricKey: toPublicMetricKey(feature.metricKey),
    status: feature.status,
    warnings: toPublicMurphAgeWarnings(feature.warnings),
  };
}

function toPublicMurphAgeModuleAttribution(
  module: MurphAgeModuleAttribution,
): MurphAgePublicModuleAttribution {
  return {
    contributionYears: module.contributionYears,
    moduleId: toPublicModuleId(module.moduleId),
  };
}

function toPublicMurphAgeAuthorization(
  authorization: MurphAgeResultAuthorization,
): MurphAgePublicAuthorization {
  return {
    cardId: authorization.cardId,
    contextOnlyMetricKeys: authorization.contextOnlyMetricKeys.map(toPublicMetricKey).filter(isString),
    evidenceClass: authorization.evidenceClass,
    productAuthorized: authorization.productAuthorized,
    riskToAgeDisplayAuthorized: authorization.riskToAgeDisplayAuthorized,
    scoreBearing: authorization.scoreBearing,
    scoreBearingMetricKeys: authorization.scoreBearingMetricKeys.map(toPublicMetricKey).filter(isString),
    scoreBearingSourceKinds: [...authorization.scoreBearingSourceKinds],
    wearableScoreBearingAuthorized: authorization.wearableScoreBearingAuthorized,
  };
}

function toPublicMurphAgeWarnings(warnings: readonly MurphAgeWarning[]): MurphAgePublicWarning[] {
  return warnings.map((warning) => {
    const featureKey = toPublicFeatureKeyFromKey(warning.featureKey);
    const metricKey = toPublicMetricKey(warning.metricKey);
    return {
      code: warning.code,
      ...(featureKey ? { featureKey } : {}),
      ...(metricKey ? { metricKey } : {}),
    };
  });
}

function toPublicFeatureKey(feature: MurphAgeFeatureAttribution): string {
  if (feature.metricKey) return toPublicMetricKey(feature.metricKey) ?? "metric-feature";
  return toPublicFeatureKeyFromKey(feature.featureKey) ?? "model-feature";
}

function toPublicFeatureKeyFromKey(featureKey: string | null | undefined): string | null {
  const simpleKey = toPublicSimpleKey(featureKey);
  if (!simpleKey) return null;
  if (simpleKey === "age") return "chronological-age";
  if (simpleKey === "male" || simpleKey === "female" || simpleKey === "sex") return "sex";
  if (MURPH_AGE_PUBLIC_FEATURE_KEYS.has(simpleKey)) return simpleKey;
  return "model-feature";
}

function toPublicMetricKey(metricKey: string | null | undefined): string | null {
  const simpleKey = toPublicSimpleKey(metricKey);
  return simpleKey && MURPH_AGE_PUBLIC_METRIC_KEYS.has(simpleKey) ? simpleKey : null;
}

function toPublicFeatureKeyList(featureKeys: readonly string[]): string[] {
  return uniqueStrings(featureKeys.map(toPublicFeatureKeyFromKey).filter(isString));
}

function toPublicMetricKeyList(metricKeys: readonly string[]): string[] {
  return uniqueStrings(metricKeys.map(toPublicMetricKey).filter(isString));
}

function toPublicWearableBridgeFeatureKey(featureKey: string | null | undefined): string | null {
  const simpleKey = toPublicSimpleKey(featureKey);
  if (!simpleKey) return null;
  if (MURPH_AGE_PUBLIC_WEARABLE_BRIDGE_FEATURE_KEYS.has(simpleKey)) return simpleKey;
  return "wearable-feature";
}

function toPublicWearableBridgeFeatureKeyList(featureKeys: readonly string[]): string[] {
  return uniqueStrings(featureKeys.map(toPublicWearableBridgeFeatureKey).filter(isString));
}

function toPublicModuleId(moduleId: string): string {
  const simpleKey = toPublicSimpleKey(moduleId);
  if (!simpleKey) return "unknown";
  if ([
    "body",
    "cardiovascular",
    "demographics",
    "hematologic",
    "immune",
    "inflammatory",
    "liver",
    "metabolic",
    "renal",
  ].includes(simpleKey)) {
    return simpleKey;
  }
  return "unknown";
}

function toPublicSimpleKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(normalized) ? normalized : null;
}

function isString(value: string | null): value is string {
  return value !== null;
}

function toPublicWearableBridgeSummary(
  summary: MurphAgeWearableBridgeSummary,
): MurphAgePublicWearableBridgeSummary {
  return {
    candidateFeatureCount: summary.candidateFeatureCount,
    deferredFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.deferredFeatureKeys),
    features: summary.features.map(toPublicWearableBridgeFeatureReadiness),
    firstPriorityIncompleteFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.firstPriorityIncompleteFeatureKeys),
    firstPriorityReadyFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.firstPriorityReadyFeatureKeys),
    missingFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.missingFeatureKeys),
    partialFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.partialFeatureKeys),
    productAuthorized: false,
    readyFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.readyFeatureKeys),
    riskEffect: "not-estimated",
    scoreBearing: false,
    scoreContributionAuthorized: false,
    secondPriorityIncompleteFeatureKeys: toPublicWearableBridgeFeatureKeyList(
      summary.secondPriorityIncompleteFeatureKeys,
    ),
    secondPriorityReadyFeatureKeys: toPublicWearableBridgeFeatureKeyList(summary.secondPriorityReadyFeatureKeys),
  };
}

function toPublicWearableBridgeFeatureReadiness(
  feature: MurphAgeWearableBridgeFeatureReadiness,
): MurphAgePublicWearableBridgeFeatureReadiness {
  return {
    family: feature.family,
    featureKey: toPublicWearableBridgeFeatureKey(feature.featureKey) ?? "wearable-feature",
    methodQualifier: feature.methodQualifier,
    metricKeys: toPublicMetricKeyList(feature.metricKeys),
    missingMetricKeys: toPublicMetricKeyList(feature.missingMetricKeys),
    missingQualityMetricKeys: toPublicMetricKeyList(feature.missingQualityMetricKeys),
    productAuthorized: false,
    qualityReady: feature.qualityReady,
    readyMetricKeys: toPublicMetricKeyList(feature.readyMetricKeys),
    requiredQualityMetricKeys: toPublicMetricKeyList(feature.requiredQualityMetricKeys),
    riskEffect: "not-estimated",
    role: feature.role,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    status: feature.status,
    uncertaintyAction: feature.uncertaintyAction,
    unlockPriority: feature.unlockPriority,
  };
}

export function assessMurphAgeInputBundle(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const lab9FeatureStatuses = assessInputFeatureRequirements(input, MURPH_AGE_LAB9_FEATURES);
  const bpBodyStatuses = assessInputFeatureRequirements(input, MURPH_AGE_BP_BODY_FEATURES);
  const lab9Statuses = [...lab9FeatureStatuses, ...bpBodyStatuses];
  const lab9Required = lab9Statuses.filter((status) => status.requiredFor === "lab9-mainline");
  if (lab9Required.every((status) => status.status === "ready")) {
    return buildInputBundleAssessment({
      bundleId: "lab9-bp-body",
      featureStatuses: lab9Statuses,
      recommendedCardId: "lab9_bp_body_10y_acm_research",
      status: "ready",
      warnings: [],
    });
  }

  const lab5Statuses = assessInputFeatureRequirements(input, MURPH_AGE_LAB5_FEATURES);
  const bloodPressureReady = featureReady(bpBodyStatuses, "systolic-blood-pressure")
    && featureReady(bpBodyStatuses, "diastolic-blood-pressure");
  const bodyContextReady = featureReady(bpBodyStatuses, "bmi");
  if (lab5Statuses.every((status) => status.status === "ready") && (bloodPressureReady || bodyContextReady)) {
    return buildInputBundleAssessment({
      bundleId: "lab5-bp-bmi",
      featureStatuses: [...lab5Statuses, ...bpBodyStatuses.filter((status) => status.status === "ready")],
      recommendedCardId: "lab5_bp_bmi_transport_research",
      status: "ready",
      warnings: [],
    });
  }

  const wearableAssessment = assessMurphAgeWearableContext(input);
  if (wearableAssessment.status === "context-only") return wearableAssessment;

  return buildInputBundleAssessment({
    bundleId: "insufficient",
    featureStatuses: [
      ...lab5Statuses,
      ...bpBodyStatuses,
      ...wearableAssessment.featureStatuses,
    ],
    recommendedCardId: "none",
    status: "abstain",
    warnings: [{
      code: "MODEL_FEATURE_MISSING",
      message: "No current Murph Age research input bundle has enough ready metrics to score or contextualize.",
    }],
  });
}

export function assessMurphAgeSecondaryContextBundles(input: MurphAgeInputBundleAssessmentInput & {
  primaryBundleId: MurphAgeInputBundleId;
}): MurphAgeContextBundleAssessment[] {
  if (input.primaryBundleId === "wearable-context") return [];
  const wearableAssessment = assessMurphAgeWearableContext(input);
  return wearableAssessment.status === "context-only" ? [toContextBundleAssessment(wearableAssessment)] : [];
}

export function mapRiskToReferenceAge(
  riskProbability: number,
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[],
): { ageYears: number; warnings: MurphAgeWarning[] } {
  if (!Number.isFinite(riskProbability) || riskProbability < 0 || riskProbability > 1) {
    throw new TypeError("Risk probability must be between 0 and 1.");
  }

  const curve = validateReferenceRiskCurve(referenceRiskCurve);
  const warnings: MurphAgeWarning[] = [];
  const first = curve[0];
  const last = curve[curve.length - 1];

  if (!first || !last) {
    throw new TypeError("Reference risk curve must include at least two points.");
  }

  if (riskProbability < first.riskProbability) {
    warnings.push({
      code: "OUT_OF_REFERENCE_RANGE",
      message: "Risk is below the reference curve; age was clamped to the lowest reference age.",
    });
    return { ageYears: first.ageYears, warnings };
  }

  if (riskProbability > last.riskProbability) {
    warnings.push({
      code: "OUT_OF_REFERENCE_RANGE",
      message: "Risk is above the reference curve; age was clamped to the highest reference age.",
    });
    return { ageYears: last.ageYears, warnings };
  }

  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1];
    const current = curve[index];
    if (!previous || !current) continue;
    if (riskProbability <= current.riskProbability) {
      const riskSpan = current.riskProbability - previous.riskProbability;
      const ageSpan = current.ageYears - previous.ageYears;
      const fraction = riskSpan === 0 ? 0 : (riskProbability - previous.riskProbability) / riskSpan;
      return { ageYears: previous.ageYears + fraction * ageSpan, warnings };
    }
  }

  return { ageYears: last.ageYears, warnings };
}

function assessInputFeatureRequirements(
  input: MurphAgeInputBundleAssessmentInput,
  requirements: readonly MurphAgeInputFeatureRequirement[],
): MurphAgeInputBundleFeatureStatus[] {
  return requirements.map((requirement) => {
    const selections = requirement.metricKeys.map((metricKey) =>
      selectMetricValue({
        metricKey,
        now: input.asOf,
        points: input.points,
      })
    );
    const selected = selections.find((selection) =>
      selection.status === "ready" && selection.value !== null && Number.isFinite(selection.value)
    ) ?? null;

    return {
      featureKey: requirement.featureKey,
      label: requirement.label,
      metricKeys: [...requirement.metricKeys],
      requiredFor: requirement.requiredFor,
      selectedMetricKey: selected?.metricKey ?? null,
      selectedPointIds: selected?.provenance.pointIds ?? [],
      status: selected ? "ready" : "missing",
      unit: selected?.unit ?? null,
      value: selected?.value ?? null,
    };
  });
}

function buildInputBundleAssessment(input: {
  bundleId: MurphAgeInputBundleId;
  featureStatuses: readonly MurphAgeInputBundleFeatureStatus[];
  recommendedCardId: MurphAgeInputBundleAssessment["recommendedCardId"];
  status: MurphAgeInputBundleStatus;
  warnings: readonly MurphAgeWarning[];
}): MurphAgeInputBundleAssessment {
  const readyFeatures = input.featureStatuses.filter((feature) => feature.status === "ready");
  const missingFeatures = input.featureStatuses.filter((feature) => feature.status === "missing");
  return {
    availableFeatureKeys: readyFeatures.map((feature) => feature.featureKey),
    bundleId: input.bundleId,
    featureStatuses: input.featureStatuses.map((feature) => ({
      ...feature,
      metricKeys: [...feature.metricKeys],
      selectedPointIds: [...feature.selectedPointIds],
    })),
    missingFeatureKeys: missingFeatures.map((feature) => feature.featureKey),
    recommendedCardId: input.recommendedCardId,
    schemaVersion: MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
    selectedMetricKeys: uniqueStrings(readyFeatures.map((feature) => feature.selectedMetricKey)),
    selectedPointIds: uniqueStrings(readyFeatures.flatMap((feature) => feature.selectedPointIds)),
    status: input.status,
    warnings: [...input.warnings],
  };
}

function featureReady(statuses: readonly MurphAgeInputBundleFeatureStatus[], featureKey: string): boolean {
  return statuses.some((status) => status.featureKey === featureKey && status.status === "ready");
}

function buildCalculatorOutput(input: {
  authorization: MurphAgeResultAuthorization;
  bundleAssessment: MurphAgeInputBundleAssessment;
  cardPolicy: MurphAgeModelCardPolicy | null;
  contextAssessments: readonly MurphAgeContextBundleAssessment[];
  mode: MurphAgeCalculatorMode;
  result: MurphAgeResult | null;
  status: MurphAgeInputBundleStatus;
  warnings: readonly MurphAgeWarning[];
  wearableShadowIncrementAssessments: readonly MurphAgeWearableShadowIncrementAssessment[];
}): MurphAgeCalculatorOutput {
  return {
    authorization: cloneMurphAgeAuthorization(input.authorization),
    bundleAssessment: cloneInputBundleAssessment(input.bundleAssessment),
    cardPolicy: input.cardPolicy ? cloneMurphAgeModelCardPolicy(input.cardPolicy) : null,
    contextAssessments: input.contextAssessments.map(cloneContextBundleAssessment),
    mode: input.mode,
    result: input.result,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: input.status,
    warnings: [...input.warnings],
    wearableShadowIncrementAssessments: input.wearableShadowIncrementAssessments.map(
      cloneMurphAgeWearableShadowIncrementAssessment,
    ),
  };
}

function assessMurphAgeWearableContext(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const wearableStatuses = assessInputFeatureRequirements(input, MURPH_AGE_WEARABLE_CONTEXT_FEATURES);
  if (wearableStatuses.some((status) => status.status === "ready")) {
    return buildInputBundleAssessment({
      bundleId: "wearable-context",
      featureStatuses: wearableStatuses,
      recommendedCardId: "wearable_context_no_risk",
      status: "context-only",
      warnings: [{
        code: "CONTEXT_NOT_SCORE_BEARING",
        message: "Wearable inputs are available as context, but current Murph Age research cards do not score wearables without lab/BP/body validation.",
      }],
    });
  }

  return buildInputBundleAssessment({
    bundleId: "wearable-context",
    featureStatuses: wearableStatuses,
    recommendedCardId: "none",
    status: "abstain",
    warnings: [],
  });
}

function assessMurphAgeWearableShadowIncrementPolicy(input: {
  input: MurphAgeWearableShadowIncrementAssessmentInput;
  policy: MurphAgeWearableShadowIncrementPolicy;
}): MurphAgeWearableShadowIncrementAssessment {
  const anchorCardId = input.input.anchorCardId ?? null;
  const anchorCompatible = anchorCardId !== null
    && input.policy.compatibleAnchorCardIds.includes(anchorCardId);
  const selectedByMetricKey = new Map<string, MetricSelection>();
  const wearablePoints = input.input.points.filter(isMurphAgeWearableShadowPoint);
  for (const metricKey of input.policy.allowedMetricKeys) {
    const selection = selectMetricValue({
      metricKey,
      now: input.input.asOf,
      points: wearablePoints,
    });
    if (selection.status === "ready" && selection.value !== null && Number.isFinite(selection.value)) {
      selectedByMetricKey.set(metricKey, selection);
    }
  }

  const readySignalMetricKeys = input.policy.signalMetricKeys.filter((metricKey) =>
    selectedByMetricKey.has(metricKey)
  );
  const missingQualityMetricKeys = input.policy.requiredQualityMetricKeys.filter((metricKey) =>
    !selectedByMetricKey.has(metricKey)
  );
  const missingMetricKeys = readySignalMetricKeys.length > 0
    ? missingQualityMetricKeys
    : uniqueStrings([...input.policy.signalMetricKeys, ...missingQualityMetricKeys]);
  const selectedMetricKeys = uniqueStrings([...selectedByMetricKey.keys()]);
  const selectedPointIds = uniqueStrings(
    [...selectedByMetricKey.values()].flatMap((selection) => selection.provenance.pointIds),
  );
  const status: MurphAgeWearableShadowIncrementStatus = !anchorCompatible
    ? "blocked"
    : missingMetricKeys.length === 0
      ? "ready"
      : "missing";
  const warnings = wearableShadowIncrementWarnings({
    anchorCardId,
    family: input.policy.family,
    missingMetricKeys,
    status,
  });

  return {
    anchorCardId,
    anchorCompatible,
    availableMetricKeys: selectedMetricKeys,
    compatibleAnchorCardIds: [...input.policy.compatibleAnchorCardIds],
    family: input.policy.family,
    missingMetricKeys,
    missingQualityMetricKeys,
    outputBoundary: { ...input.policy.outputBoundary },
    productAuthorized: false,
    readySignalMetricKeys,
    riskEffect: "not-estimated",
    schemaVersion: input.policy.schemaVersion,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys,
    selectedPointIds,
    status,
    warnings,
  };
}

function completeWearableShadowIncrementPolicy(
  policy: MurphAgeWearableShadowIncrementPolicyDefinition,
): MurphAgeWearableShadowIncrementPolicy {
  return {
    ...policy,
    allowedMetricKeys: uniqueStrings([
      ...policy.signalMetricKeys,
      ...policy.requiredQualityMetricKeys,
    ]),
  };
}

function completeWearableBridgeFeatureSpec(
  spec: MurphAgeWearableBridgeFeatureSpecDefinition,
): MurphAgeWearableBridgeFeatureSpec {
  return {
    ...spec,
    outputBoundary: MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY,
    productAuthorized: false,
    riskEffect: "not-estimated",
    schemaVersion: MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
  };
}

function isMurphAgeWearableShadowPoint(point: MetricPoint): boolean {
  return MURPH_AGE_WEARABLE_SHADOW_SOURCE_KINDS.includes(
    point.source.kind as typeof MURPH_AGE_WEARABLE_SHADOW_SOURCE_KINDS[number],
  );
}

function cloneInputBundleAssessment(assessment: MurphAgeInputBundleAssessment): MurphAgeInputBundleAssessment {
  return {
    ...assessment,
    availableFeatureKeys: [...assessment.availableFeatureKeys],
    featureStatuses: assessment.featureStatuses.map((feature) => ({
      ...feature,
      metricKeys: [...feature.metricKeys],
      selectedPointIds: [...feature.selectedPointIds],
    })),
    missingFeatureKeys: [...assessment.missingFeatureKeys],
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    selectedPointIds: [...assessment.selectedPointIds],
    warnings: assessment.warnings.map((warning) => ({ ...warning })),
  };
}

function toContextBundleAssessment(assessment: MurphAgeInputBundleAssessment): MurphAgeContextBundleAssessment {
  return {
    ...assessment,
    bundleId: "wearable-context",
    featureStatuses: assessment.featureStatuses.map((feature) => ({
      featureKey: feature.featureKey,
      label: feature.label,
      metricKeys: [...feature.metricKeys],
      requiredFor: "wearable-context",
      selectedMetricKey: feature.selectedMetricKey,
      selectedPointIds: [...feature.selectedPointIds],
      status: feature.status,
    })),
  };
}

function listContextOnlyFeatureStatuses(output: MurphAgeCalculatorOutput): MurphAgeContextBundleFeatureStatus[] {
  const primaryContext = output.bundleAssessment.bundleId === "wearable-context"
    ? toContextBundleAssessment(output.bundleAssessment).featureStatuses
    : [];
  return [...primaryContext, ...output.contextAssessments.flatMap((assessment) => assessment.featureStatuses)]
    .filter((feature) => feature.status === "ready");
}

function summarizeWearableContext(
  features: readonly MurphAgeContextBundleFeatureStatus[],
): MurphAgeWearableContextSummary {
  const readyFeatureKeys = uniqueStrings(features.map((feature) => feature.featureKey));
  const readyFeatureKeySet = new Set(readyFeatureKeys);
  const availableFeatureFamilies = (Object.keys(MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES) as MurphAgeWearableContextFamily[])
    .filter((family) =>
      MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES[family].some((featureKey) =>
        readyFeatureKeySet.has(featureKey)
      )
    );
  const availableQualityFeatureKeys = MURPH_AGE_WEARABLE_QUALITY_FEATURE_KEYS.filter((featureKey) =>
    readyFeatureKeySet.has(featureKey)
  );
  const hasWearableContext = readyFeatureKeys.length > 0;
  const hasQualityMetadata = readyFeatureKeySet.has("wearable-coverage-index");
  const quality = resolveWearableContextQuality({
    availableFeatureFamilies,
    hasQualityMetadata,
    readyFeatureCount: readyFeatureKeys.length,
  });

  return {
    availableFeatureFamilies,
    availableQualityFeatureKeys,
    missingQualityFeatureKeys: hasWearableContext
      ? MURPH_AGE_WEARABLE_QUALITY_FEATURE_KEYS.filter((featureKey) => !readyFeatureKeySet.has(featureKey))
      : [],
    quality,
    readyFeatureCount: readyFeatureKeys.length,
    readyMetricCount: uniqueStrings(features.map((feature) => feature.selectedMetricKey)).length,
    readyPointCount: uniqueStrings(features.flatMap((feature) => feature.selectedPointIds)).length,
    riskEffect: "not-estimated",
    scoreBearing: false,
    scoreContributionAuthorized: false,
    uncertaintyAction: hasWearableContext ? "context-only" : "none",
  };
}

function summarizeWearableBridge(
  features: readonly MurphAgeContextBundleFeatureStatus[],
): MurphAgeWearableBridgeSummary {
  const readyMetricKeySet = new Set(uniqueStrings(features.map((feature) => feature.selectedMetricKey)));
  const bridgeFeatures = MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS.map((spec) =>
    summarizeWearableBridgeFeature({ readyMetricKeySet, spec })
  );

  return {
    candidateFeatureCount: bridgeFeatures.length,
    deferredFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.unlockPriority === "defer"
    ),
    features: bridgeFeatures,
    firstPriorityIncompleteFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.unlockPriority === "first" && feature.status !== "ready"
    ),
    firstPriorityReadyFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.unlockPriority === "first" && feature.status === "ready"
    ),
    missingFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.status === "missing"
    ),
    partialFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.status === "partial"
    ),
    productAuthorized: false,
    readyFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.status === "ready"
    ),
    riskEffect: "not-estimated",
    scoreBearing: false,
    scoreContributionAuthorized: false,
    secondPriorityIncompleteFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.unlockPriority === "second" && feature.status !== "ready"
    ),
    secondPriorityReadyFeatureKeys: listWearableBridgeFeatureKeys(bridgeFeatures, (feature) =>
      feature.unlockPriority === "second" && feature.status === "ready"
    ),
  };
}

function summarizeWearableBridgeFeature(input: {
  readyMetricKeySet: ReadonlySet<string>;
  spec: MurphAgeWearableBridgeFeatureSpec;
}): MurphAgeWearableBridgeFeatureReadiness {
  const readyMetricKeys = input.spec.metricKeys.filter((metricKey) =>
    input.readyMetricKeySet.has(metricKey)
  );
  const missingMetricKeys = input.spec.metricKeys.filter((metricKey) =>
    !input.readyMetricKeySet.has(metricKey)
  );
  const missingQualityMetricKeys = input.spec.requiredQualityMetricKeys.filter((metricKey) =>
    !input.readyMetricKeySet.has(metricKey)
  );
  const qualityReady = missingQualityMetricKeys.length === 0;
  const status = resolveWearableBridgeReadinessStatus({
    qualityReady,
    readyMetricCount: readyMetricKeys.length,
    requiredMetricCount: input.spec.metricKeys.length,
    role: input.spec.role,
  });

  return {
    family: input.spec.family,
    featureKey: input.spec.featureKey,
    label: input.spec.label,
    methodQualifier: input.spec.methodQualifier,
    metricKeys: [...input.spec.metricKeys],
    missingMetricKeys,
    missingQualityMetricKeys,
    productAuthorized: false,
    qualityReady,
    readyMetricKeys,
    requiredQualityMetricKeys: [...input.spec.requiredQualityMetricKeys],
    riskEffect: "not-estimated",
    role: input.spec.role,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    status,
    uncertaintyAction: status === "missing" ? "none" : "context-only",
    unlockPriority: input.spec.unlockPriority,
  };
}

function resolveWearableBridgeReadinessStatus(input: {
  qualityReady: boolean;
  readyMetricCount: number;
  requiredMetricCount: number;
  role: MurphAgeWearableBridgeFeatureRole;
}): MurphAgeWearableBridgeReadinessStatus {
  if (input.readyMetricCount === 0) return "missing";
  if (input.role === "quality") {
    return input.readyMetricCount === input.requiredMetricCount ? "ready" : "partial";
  }
  return input.qualityReady ? "ready" : "partial";
}

function listWearableBridgeFeatureKeys(
  features: readonly MurphAgeWearableBridgeFeatureReadiness[],
  predicate: (feature: MurphAgeWearableBridgeFeatureReadiness) => boolean,
): string[] {
  return features.filter(predicate).map((feature) => feature.featureKey);
}

function resolveWearableContextQuality(input: {
  availableFeatureFamilies: readonly MurphAgeWearableContextFamily[];
  hasQualityMetadata: boolean;
  readyFeatureCount: number;
}): MurphAgeWearableContextQuality {
  if (input.readyFeatureCount === 0) return "none";
  if (input.readyFeatureCount < 3 || !input.hasQualityMetadata) return "thin";
  const familySet = new Set(input.availableFeatureFamilies);
  if (familySet.has("activity") && familySet.has("recovery") && familySet.has("sleep")) {
    return "strong-context";
  }
  return "usable-context";
}

function cloneContextBundleAssessment(assessment: MurphAgeContextBundleAssessment): MurphAgeContextBundleAssessment {
  return {
    ...assessment,
    availableFeatureKeys: [...assessment.availableFeatureKeys],
    featureStatuses: assessment.featureStatuses.map((feature) => ({
      ...feature,
      metricKeys: [...feature.metricKeys],
      selectedPointIds: [...feature.selectedPointIds],
    })),
    missingFeatureKeys: [...assessment.missingFeatureKeys],
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    selectedPointIds: [...assessment.selectedPointIds],
    warnings: assessment.warnings.map((warning) => ({ ...warning })),
  };
}

function resolveDisplayBlockedReason(input: {
  ageEstimateAvailable: boolean;
  output: MurphAgeCalculatorOutput;
  productRiskDisplayReady: boolean;
  riskEstimateAvailable: boolean;
}): MurphAgeDisplayBlockedReason | null {
  if (input.output.warnings.some((warning) => warning.code === "MODEL_CARD_POLICY_VIOLATION")) {
    return "policy-violation";
  }
  if (input.ageEstimateAvailable && input.productRiskDisplayReady && input.output.authorization.riskToAgeDisplayAuthorized) {
    return null;
  }
  if (input.output.status === "context-only") return "context-only";
  if (!input.ageEstimateAvailable) {
    return input.output.authorization.productAuthorized ? "age-estimate-unavailable" : "product-not-authorized";
  }
  if (!input.riskEstimateAvailable) return "risk-estimate-unavailable";
  if (!input.output.authorization.productAuthorized) return "product-not-authorized";
  if (!input.output.authorization.riskToAgeDisplayAuthorized) return "risk-to-age-not-authorized";
  return null;
}

function resolveDisplayStatus(input: {
  ageEstimateAvailable: boolean;
  output: MurphAgeCalculatorOutput;
  productAgeDisplayReady: boolean;
  productRiskDisplayReady: boolean;
}): MurphAgeDisplayStatus {
  if (input.productAgeDisplayReady) return "product-age-ready";
  if (input.productRiskDisplayReady) return "product-risk-only";
  if (input.ageEstimateAvailable) return "research-only";
  if (input.output.status === "context-only") return "context-only";
  return "abstain";
}

function resolveMurphAgeOutcomeContext(cardPolicy: MurphAgeModelCardPolicy | null): MurphAgeOutcomeContext {
  if (!cardPolicy) {
    return {
      ageEstimateBasis: "none",
      horizonYears: null,
      riskEndpoint: "none",
    };
  }
  return cloneMurphAgeOutcomeContext(cardPolicy.outcome);
}

function cloneMurphAgeOutcomeContext(context: MurphAgeOutcomeContext): MurphAgeOutcomeContext {
  return {
    ageEstimateBasis: context.ageEstimateBasis,
    horizonYears: context.horizonYears,
    riskEndpoint: context.riskEndpoint,
  };
}

function toPublicMurphAgeOutcomeContext(value: unknown): MurphAgeOutcomeContext {
  const context = asPlainRecord(value);
  if (!context) return cloneMurphAgeOutcomeContext(MURPH_AGE_EMPTY_OUTCOME_CONTEXT);
  const ageEstimateBasis = context.ageEstimateBasis === "risk-age-equivalent"
    ? "risk-age-equivalent"
    : context.ageEstimateBasis === "none"
    ? "none"
    : null;
  const riskEndpoint = context.riskEndpoint === "all-cause-mortality"
    ? "all-cause-mortality"
    : context.riskEndpoint === "none"
    ? "none"
    : null;
  const horizonYears = context.horizonYears === null
    ? null
    : typeof context.horizonYears === "number" && Number.isFinite(context.horizonYears) && context.horizonYears > 0
    ? context.horizonYears
    : null;

  if (ageEstimateBasis !== "risk-age-equivalent" || riskEndpoint !== "all-cause-mortality" || horizonYears === null) {
    return cloneMurphAgeOutcomeContext(MURPH_AGE_EMPTY_OUTCOME_CONTEXT);
  }
  return {
    ageEstimateBasis,
    horizonYears,
    riskEndpoint,
  };
}

function cloneMurphAgeModelCardOutcomePolicy(outcome: MurphAgeModelCardOutcomePolicy): MurphAgeModelCardOutcomePolicy {
  return {
    ...cloneMurphAgeOutcomeContext(outcome),
    modelEndpoint: outcome.modelEndpoint,
  };
}

function cloneMurphAgeModelCardPolicy(policy: MurphAgeModelCardPolicy): MurphAgeModelCardPolicy {
  return {
    ...policy,
    acceptedBundleIds: [...policy.acceptedBundleIds],
    outcome: cloneMurphAgeModelCardOutcomePolicy(policy.outcome),
    scoreBearingMetricKeys: [...policy.scoreBearingMetricKeys],
    scoreBearingSourceKinds: [...policy.scoreBearingSourceKinds],
    validationGate: cloneMurphAgeValidationGateSummary(policy.validationGate),
  };
}

function cloneMurphAgeValidationGateSummary(summary: MurphAgeValidationGateSummary): MurphAgeValidationGateSummary {
  return {
    ...summary,
    evidenceTiers: [...summary.evidenceTiers],
  };
}

function cloneMurphAgeWearableShadowIncrementPolicy(
  policy: MurphAgeWearableShadowIncrementPolicy,
): MurphAgeWearableShadowIncrementPolicy {
  return {
    ...policy,
    allowedMetricKeys: [...policy.allowedMetricKeys],
    compatibleAnchorCardIds: [...policy.compatibleAnchorCardIds],
    outputBoundary: { ...policy.outputBoundary },
    requiredQualityMetricKeys: [...policy.requiredQualityMetricKeys],
    signalMetricKeys: [...policy.signalMetricKeys],
  };
}

function cloneMurphAgeWearableBridgeFeatureSpec(
  spec: MurphAgeWearableBridgeFeatureSpec,
): MurphAgeWearableBridgeFeatureSpec {
  return {
    ...spec,
    measurementWindowDays: [...spec.measurementWindowDays],
    metricKeys: [...spec.metricKeys],
    outputBoundary: { ...spec.outputBoundary },
    requiredQualityMetricKeys: [...spec.requiredQualityMetricKeys],
    sourceKinds: [...spec.sourceKinds],
  };
}

function cloneMurphAgeWearableShadowIncrementAssessment(
  assessment: MurphAgeWearableShadowIncrementAssessment,
): MurphAgeWearableShadowIncrementAssessment {
  return {
    ...assessment,
    availableMetricKeys: [...assessment.availableMetricKeys],
    compatibleAnchorCardIds: [...assessment.compatibleAnchorCardIds],
    missingMetricKeys: [...assessment.missingMetricKeys],
    missingQualityMetricKeys: [...assessment.missingQualityMetricKeys],
    outputBoundary: { ...assessment.outputBoundary },
    readySignalMetricKeys: [...assessment.readySignalMetricKeys],
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    selectedPointIds: [...assessment.selectedPointIds],
    warnings: assessment.warnings.map((warning) => ({ ...warning })),
  };
}

function wearableShadowIncrementWarnings(input: {
  anchorCardId: MurphAgeScoreBearingCardId | null;
  family: MurphAgeWearableShadowIncrementFamily;
  missingMetricKeys: readonly string[];
  status: MurphAgeWearableShadowIncrementStatus;
}): MurphAgeWarning[] {
  if (input.status === "blocked") {
    return [{
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: input.anchorCardId
        ? `${input.family} wearable shadow increments are not compatible with ${input.anchorCardId}.`
        : `${input.family} wearable shadow increments require a score-bearing lab/BP/body anchor.`,
    }];
  }
  if (input.status === "missing") {
    return [{
      code: "MODEL_FEATURE_MISSING",
      message: `${input.family} wearable shadow increment is missing required signal or quality metrics: ${input.missingMetricKeys.join(", ")}.`,
    }];
  }
  return [{
    code: "CONTEXT_NOT_SCORE_BEARING",
    message: `${input.family} wearable metrics are ready for shadow research assessment, but they are not authorized to affect Murph Age scoring.`,
  }];
}

function createMurphAgeCardPolicyAuthorization(input: {
  bundleAssessment: MurphAgeInputBundleAssessment;
  cardPolicy: MurphAgeModelCardPolicy | null;
  contextAssessments: readonly MurphAgeContextBundleAssessment[];
}): MurphAgeResultAuthorization {
  const contextOnlyMetricKeys = uniqueStrings(
    [
      ...input.contextAssessments.flatMap((assessment) => assessment.selectedMetricKeys),
      ...(input.bundleAssessment.bundleId === "wearable-context" ? input.bundleAssessment.selectedMetricKeys : []),
    ],
  );
  if (!input.cardPolicy) {
    return createMurphAgeAbstainedAuthorization({ contextOnlyMetricKeys });
  }
  return {
    cardId: input.cardPolicy.cardId,
    contextOnlyMetricKeys,
    evidenceClass: input.cardPolicy.evidenceClass,
    evidenceSummary: input.cardPolicy.evidenceSummary,
    productAuthorized: isMurphAgeModelCardProductAuthorized(input.cardPolicy),
    riskToAgeDisplayAuthorized: isMurphAgeModelCardRiskToAgeDisplayAuthorized(input.cardPolicy),
    scoreBearing: input.cardPolicy.scoreBearing,
    scoreBearingMetricKeys: [...input.cardPolicy.scoreBearingMetricKeys],
    scoreBearingSourceKinds: [...input.cardPolicy.scoreBearingSourceKinds],
    wearableScoreBearingAuthorized: input.cardPolicy.wearableScoreBearingAuthorized,
  };
}

function cloneMurphAgeAuthorization(authorization: MurphAgeResultAuthorization): MurphAgeResultAuthorization {
  return {
    ...authorization,
    contextOnlyMetricKeys: [...authorization.contextOnlyMetricKeys],
    scoreBearingMetricKeys: [...authorization.scoreBearingMetricKeys],
    scoreBearingSourceKinds: [...authorization.scoreBearingSourceKinds],
  };
}

function withMurphAgeAuthorization(
  result: MurphAgeResult,
  authorization: MurphAgeResultAuthorization,
): MurphAgeResult {
  return {
    ...result,
    authorization: cloneMurphAgeAuthorization(authorization),
  };
}

function findModelCardPolicyViolation(input: {
  asOf?: string;
  cardPolicy: MurphAgeModelCardPolicy;
  model: MurphAgeRiskModel;
  points: readonly MetricPoint[];
}): MurphAgeWarning | null {
  const outcomePolicyViolation = findModelCardOutcomePolicyViolation(input.cardPolicy, input.model);
  if (outcomePolicyViolation) return outcomePolicyViolation;

  const allowedMetricKeys = new Set(input.cardPolicy.scoreBearingMetricKeys.map(resolveMetricInputKey));
  for (const feature of input.model.features) {
    if (feature.kind !== "metric") continue;
    const metricKey = resolveMetricInputKey(feature.metricKey);
    if (!allowedMetricKeys.has(metricKey)) {
      return {
        code: "MODEL_CARD_POLICY_VIOLATION",
        featureKey: feature.key,
        message: `${input.cardPolicy.cardId} does not authorize ${feature.label} as a score-bearing metric.`,
        metricKey,
      };
    }

    if (input.cardPolicy.wearableScoreBearingAuthorized) continue;
    const selection = selectMetricValue({
      biomarkerKey: feature.biomarkerKey,
      metricKey,
      now: input.asOf,
      points: input.points,
      policyOverride: feature.selectionPolicy,
    });
    const unauthorizedSourceKind = scoreBearingSelectionSourceKinds(selection).find((sourceKind) =>
      !input.cardPolicy.scoreBearingSourceKinds.includes(sourceKind)
    );
    if (unauthorizedSourceKind) {
      return {
        code: "MODEL_CARD_POLICY_VIOLATION",
        featureKey: feature.key,
        message: `${input.cardPolicy.cardId} does not authorize score-bearing ${unauthorizedSourceKind} inputs.`,
        metricKey,
      };
    }
  }
  return null;
}

function findModelCardOutcomePolicyViolation(
  cardPolicy: MurphAgeModelCardPolicy,
  model: MurphAgeRiskModel,
): MurphAgeWarning | null {
  if (!cardPolicy.scoreBearing) return null;
  if (cardPolicy.outcome.modelEndpoint !== null && model.endpoint !== cardPolicy.outcome.modelEndpoint) {
    return {
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${cardPolicy.cardId} does not authorize this model endpoint.`,
    };
  }
  if (cardPolicy.outcome.horizonYears !== null && model.horizonYears !== cardPolicy.outcome.horizonYears) {
    return {
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${cardPolicy.cardId} does not authorize this model horizon.`,
    };
  }
  return null;
}

function scoreBearingSelectionSourceKinds(selection: MetricSelection): string[] {
  if (!selection.point) return [];
  if (selection.point.source.kind === "metric-selection-summary") {
    return selection.provenance.sourceKinds;
  }
  return [selection.point.source.kind];
}

function isScoreBearingCardId(cardId: MurphAgeModelCardId): cardId is MurphAgeScoreBearingCardId {
  return cardId !== "wearable_context_no_risk";
}

function evaluateFeature(input: {
  blockedIdentifiers: BlockedIdentifiers;
  feature: MurphAgeModelFeature;
  input: MurphAgeCalculationInput;
}): EvaluatedFeature {
  const moduleId = input.feature.moduleId ?? "demographics";
  const required = input.feature.kind === "metric" ? input.feature.required !== false : true;
  const baseAttribution = {
    contributionLogit: null,
    contributionYears: null,
    featureKey: input.feature.key,
    label: input.feature.label,
    moduleId,
    selectedPointIds: [],
    unit: null,
    value: null,
    valueLabel: null,
    warnings: [] as MurphAgeWarning[],
  };

  switch (input.feature.kind) {
    case "chronological-age":
      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey: null,
          value: input.input.chronologicalAgeYears,
          valueLabel: input.input.chronologicalAgeYears.toFixed(1),
        },
        feature: input.feature,
        moduleId,
        rawValue: input.input.chronologicalAgeYears,
        required,
      });
    case "sex": {
      const sexValue = input.input.sex === input.feature.sex ? 1 : 0;
      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey: null,
          value: sexValue,
          valueLabel: input.input.sex,
        },
        feature: input.feature,
        moduleId,
        rawValue: sexValue,
        required,
      });
    }
    case "metric": {
      const metricKey = resolveMetricInputKey(input.feature.metricKey);
      const metricDefinition = resolveMetricDefinition(metricKey);
      const expectedUnit = input.feature.expectedUnit ?? metricDefinition?.canonicalUnit ?? null;
      if (isBlockedMetricFeature({
        biomarkerKey: input.feature.biomarkerKey ?? null,
        blockedIdentifiers: input.blockedIdentifiers,
        metricKey,
      })) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "blocked",
            warnings: [{
              code: "BLOCKED_MODEL_FEATURE",
              featureKey: input.feature.key,
              message: `${input.feature.label} is blocked for Murph Age calculator models until separately validated.`,
              metricKey,
            }],
          },
          confidence: null,
          contributionLogit: 0,
          required,
        };
      }

      if (!metricDefinition && !expectedUnit) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} is not a registered metric and did not declare an expected unit.`,
              metricKey,
            }],
          },
          confidence: null,
          contributionLogit: 0,
          required,
        };
      }

      const selection = selectMetricValue({
        biomarkerKey: input.feature.biomarkerKey,
        metricKey,
        now: input.input.asOf,
        points: input.input.points,
        policyOverride: input.feature.selectionPolicy,
      });
      const selectionWarnings = mapMetricSelectionWarnings(input.feature, selection);
      if (isBlockedMetricFeature({
        biomarkerKey: selection.biomarkerKey,
        blockedIdentifiers: input.blockedIdentifiers,
        metricKey: selection.metricKey,
      })) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "blocked",
            warnings: [{
              code: "BLOCKED_MODEL_FEATURE",
              featureKey: input.feature.key,
              message: `${input.feature.label} selected a blocked biomarker for Murph Age calculator models.`,
              metricKey: selection.metricKey,
            }],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      if (selection.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED")) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} could not be scored because its unit was not normalized for this model.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      const value = selection.value;
      if (selection.status !== "ready" || value === null || !Number.isFinite(value)) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: required
                ? `${input.feature.label} is required by this model but was not available as a ready normalized metric.`
                : `${input.feature.label} is optional in this model and was not available as a ready normalized metric.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      if (selection.warnings.some((warning) => warning.code === "COMPARATOR_VALUE")) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} could not be scored because its selected value is censored by a comparator.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      if (expectedUnit && !unitsEquivalent(selection.unit, expectedUnit)) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} could not be scored because its selected unit was not ${normalizeUnit(expectedUnit) ?? expectedUnit}.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey,
          selectedPointIds: selection.provenance.pointIds,
          unit: selection.unit,
          value,
          valueLabel: selection.valueLabel,
          warnings: selectionWarnings,
        },
        confidence: selection.confidence,
        feature: input.feature,
        moduleId,
        rawValue: value,
        required,
      });
    }
  }
}

function evaluateRawFeature(input: {
  attribution: Omit<MurphAgeFeatureAttribution, "status">;
  confidence?: MetricConfidence | null;
  feature: MurphAgeModelFeature;
  moduleId: string;
  rawValue: number;
  required: boolean;
}): EvaluatedFeature {
  const transformed = transformFeatureValue(input.rawValue, input.feature.transform ?? { kind: "identity" });
  if (transformed.warning) {
    return {
      attribution: {
        ...input.attribution,
        contributionLogit: null,
        status: "missing",
        warnings: [...input.attribution.warnings, {
          code: "TRANSFORM_UNSUPPORTED",
          featureKey: input.feature.key,
          message: transformed.warning,
          metricKey: input.attribution.metricKey ?? undefined,
        }],
      },
      confidence: input.confidence ?? null,
      contributionLogit: 0,
      required: input.required,
    };
  }

  const contributionLogit = input.feature.coefficient * transformed.value;
  return {
    attribution: {
      ...input.attribution,
      contributionLogit: roundContribution(contributionLogit),
      status: "ready",
    },
    confidence: input.confidence ?? null,
    contributionLogit,
    required: input.required,
  };
}

function transformFeatureValue(
  value: number,
  transform: MurphAgeFeatureTransform,
): { value: number; warning: string | null } {
  switch (transform.kind) {
    case "identity":
      return { value, warning: null };
    case "ln": {
      const adjusted = value + (transform.offset ?? 0);
      return adjusted > 0
        ? { value: Math.log(adjusted), warning: null }
        : { value: 0, warning: "Log transform requires a positive value after offset." };
    }
    case "z-score": {
      if (!Number.isFinite(transform.standardDeviation) || transform.standardDeviation <= 0) {
        return { value: 0, warning: "Z-score transform requires a positive standard deviation." };
      }
      const unclamped = (value - transform.mean) / transform.standardDeviation;
      const min = transform.clamp?.min ?? Number.NEGATIVE_INFINITY;
      const max = transform.clamp?.max ?? Number.POSITIVE_INFINITY;
      return { value: Math.min(max, Math.max(min, unclamped)), warning: null };
    }
  }
}

function withContributionYears(input: {
  ageYears: number;
  calibratedLogit: number;
  features: readonly EvaluatedFeature[];
  model: MurphAgeRiskModel;
}): MurphAgeFeatureAttribution[] {
  return input.features.map((feature) => {
    if (feature.attribution.status !== "ready") {
      return feature.attribution;
    }
    const omittedLogit = input.calibratedLogit - calibratedContribution(feature.contributionLogit, input.model.calibration);
    const omittedAge = mapRiskToReferenceAge(logistic(omittedLogit), input.model.referenceRiskCurve).ageYears;
    return {
      ...feature.attribution,
      contributionYears: roundYears(input.ageYears - omittedAge),
    };
  });
}

function buildModuleAttributions(input: {
  ageYears: number;
  calibratedLogit: number;
  features: readonly EvaluatedFeature[];
  model: MurphAgeRiskModel;
}): MurphAgeModuleAttribution[] {
  const modules = new Map<string, { contributionLogit: number; featureKeys: string[] }>();

  for (const feature of input.features) {
    const moduleId = feature.attribution.moduleId;
    const current = modules.get(moduleId) ?? { contributionLogit: 0, featureKeys: [] };
    current.contributionLogit += feature.contributionLogit;
    current.featureKeys.push(feature.attribution.featureKey);
    modules.set(moduleId, current);
  }

  return [...modules.entries()].map(([moduleId, module]) => {
    const omittedLogit = input.calibratedLogit - calibratedContribution(module.contributionLogit, input.model.calibration);
    const omittedAge = mapRiskToReferenceAge(logistic(omittedLogit), input.model.referenceRiskCurve).ageYears;
    return {
      contributionLogit: roundContribution(module.contributionLogit),
      contributionYears: roundYears(input.ageYears - omittedAge),
      featureKeys: module.featureKeys,
      moduleId,
    };
  });
}

function buildAgeInterval(input: {
  ageYears: number;
  lowConfidenceMetricCount: number;
  missingOptionalFeatureCount: number;
  model: MurphAgeRiskModel;
}): { high: number; low: number } | null {
  const uncertainty = input.model.uncertainty;
  if (!uncertainty) return null;
  const width = (uncertainty.baseYears ?? 0)
    + (uncertainty.perMissingOptionalFeatureYears ?? 0) * input.missingOptionalFeatureCount
    + (uncertainty.perLowConfidenceMetricYears ?? 0) * input.lowConfidenceMetricCount;
  if (!Number.isFinite(width) || width <= 0) return null;
  return {
    high: roundYears(input.ageYears + width),
    low: roundYears(input.ageYears - width),
  };
}

function emptyMurphAgeResult(input: {
  chronologicalAgeYears: number;
  featureAttributions: MurphAgeFeatureAttribution[];
  model: MurphAgeRiskModel;
  status: MurphAgeStatus;
  warnings: MurphAgeWarning[];
}): MurphAgeResult {
  return {
    ageDeltaYears: null,
    authorization: createMurphAgeCustomModelAuthorization(input.model),
    biologicalAgeYears: null,
    chronologicalAgeYears: input.chronologicalAgeYears,
    featureAttributions: input.featureAttributions,
    intervalYears: null,
    modelId: input.model.modelId,
    modelVersion: input.model.modelVersion ?? null,
    moduleAttributions: [],
    risk: null,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: input.status,
    warnings: input.warnings,
  };
}

export function validateMurphAgeRiskModel(model: MurphAgeRiskModel): MurphAgeModelValidationResult {
  const warnings: MurphAgeWarning[] = [];

  if (!Number.isFinite(model.intercept)) {
    warnings.push(invalidModelWarning("Murph Age model intercept must be finite."));
  }
  if (!Number.isFinite(model.horizonYears) || model.horizonYears <= 0) {
    warnings.push(invalidModelWarning("Murph Age model horizon must be a positive finite number of years."));
  }
  if (model.calibration) {
    if (!Number.isFinite(model.calibration.intercept)) {
      warnings.push(invalidModelWarning("Murph Age model calibration intercept must be finite."));
    }
    if (!Number.isFinite(model.calibration.slope)) {
      warnings.push(invalidModelWarning("Murph Age model calibration slope must be finite."));
    }
  }

  try {
    validateReferenceRiskCurve(model.referenceRiskCurve);
  } catch (error) {
    warnings.push(invalidModelWarning(error instanceof Error
      ? error.message
      : "Murph Age model reference risk curve is invalid."));
  }

  const featureKeys = new Set<string>();
  for (const feature of model.features) {
    if (featureKeys.has(feature.key)) {
      warnings.push(invalidModelWarning(`Murph Age model feature ${feature.key} is duplicated.`, feature));
    }
    featureKeys.add(feature.key);

    if (!Number.isFinite(feature.coefficient)) {
      warnings.push(invalidModelWarning(`${feature.label} coefficient must be finite.`, feature));
    }
    if (feature.kind === "metric" && feature.expectedUnit !== undefined && normalizeUnit(feature.expectedUnit) === null) {
      warnings.push(invalidModelWarning(`${feature.label} expected unit must be a non-empty string.`, feature));
    }
    warnings.push(...validateFeatureTransform(feature));
  }

  return {
    status: warnings.length > 0 ? "invalid" : "valid",
    warnings,
  };
}

export function parseMurphAgeRiskModelArtifact(value: unknown): MurphAgeRiskModel | null {
  const model = asPlainRecord(value);
  if (!model || !recordHasOnlyKeys(model, [
    "blockedBiomarkerKeys",
    "blockedMetricKeys",
    "calibration",
    "endpoint",
    "features",
    "horizonYears",
    "intercept",
    "modelId",
    "modelVersion",
    "referencePopulation",
    "referenceRiskCurve",
    "uncertainty",
  ])) {
    return null;
  }

  const endpoint = parseNonEmptyString(model.endpoint);
  const features = parseModelFeatures(model.features);
  const horizonYears = parsePositiveFiniteNumber(model.horizonYears);
  const intercept = parseFiniteNumber(model.intercept);
  const modelId = parseNonEmptyString(model.modelId);
  const modelVersion = parseOptionalNonEmptyString(model.modelVersion);
  const referencePopulation = parseNonEmptyString(model.referencePopulation);
  const referenceRiskCurve = parseReferenceRiskCurveArtifact(model.referenceRiskCurve);
  const blockedBiomarkerKeys = parseOptionalStringArray(model.blockedBiomarkerKeys);
  const blockedMetricKeys = parseOptionalStringArray(model.blockedMetricKeys);
  const calibration = parseOptionalCalibration(model.calibration);
  const uncertainty = parseOptionalUncertainty(model.uncertainty);

  if (
    endpoint === null ||
    features === null ||
    horizonYears === null ||
    intercept === null ||
    modelId === null ||
    modelVersion === null ||
    referencePopulation === null ||
    referenceRiskCurve === null ||
    blockedBiomarkerKeys === null ||
    blockedMetricKeys === null ||
    calibration === null ||
    uncertainty === null
  ) {
    return null;
  }

  const parsed: MurphAgeRiskModel = {
    endpoint,
    features,
    horizonYears,
    intercept,
    modelId,
    referencePopulation,
    referenceRiskCurve,
  };
  if (blockedBiomarkerKeys !== undefined) parsed.blockedBiomarkerKeys = blockedBiomarkerKeys;
  if (blockedMetricKeys !== undefined) parsed.blockedMetricKeys = blockedMetricKeys;
  if (calibration !== undefined) parsed.calibration = calibration;
  if (modelVersion !== undefined) parsed.modelVersion = modelVersion;
  if (uncertainty !== undefined) parsed.uncertainty = uncertainty;

  return validateMurphAgeRiskModel(parsed).status === "valid" ? parsed : null;
}

export function parseMurphAgeLocalModelCardArtifact(value: unknown): MurphAgeLocalModelCardArtifactParseResult {
  const artifact = asPlainRecord(value);
  if (!artifact || artifact.schemaVersion !== MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION) {
    return invalidMurphAgeLocalModelCardArtifactResult();
  }

  const cardId = parseScoreBearingCardId(artifact.cardId);
  if (!cardId) {
    return invalidMurphAgeLocalModelCardArtifactResult();
  }

  const model = parseMurphAgeRiskModelArtifact(artifact.model);
  if (!model) {
    return invalidMurphAgeLocalModelCardArtifactResult();
  }

  return {
    value: {
      cardId,
      model,
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    },
    warnings: [],
  };
}

function invalidMurphAgeLocalModelCardArtifactResult(): MurphAgeLocalModelCardArtifactParseResult {
  return {
    value: null,
    warnings: [createMurphAgeLocalModelCardWarning(
      "A local Murph Age model-card artifact does not match the expected schema.",
    )],
  };
}

function createMurphAgeLocalModelCardWarning(message: string): MurphAgeWarning {
  return {
    code: "INVALID_INPUT",
    message,
  };
}

export function validateMurphAgeLocalModelCardArtifactPolicy(
  artifact: MurphAgeLocalModelCardArtifact,
): MurphAgeWarning[] {
  const modelValidation = validateMurphAgeRiskModel(artifact.model);
  const warnings: MurphAgeWarning[] = [];
  if (modelValidation.status === "invalid") {
    return [createMurphAgeLocalModelCardWarning("A local Murph Age model-card artifact contains an invalid model.")];
  }
  const policy = resolveMurphAgeModelCardPolicy(artifact.cardId);
  if (!policy?.scoreBearing) {
    warnings.push(createMurphAgeLocalModelCardWarning(
      "A local Murph Age model-card artifact selected a non-score-bearing card id.",
    ));
    return warnings;
  }
  const outcomePolicyViolation = findModelCardOutcomePolicyViolation(policy, artifact.model);
  if (outcomePolicyViolation) warnings.push(outcomePolicyViolation);

  const allowedMetricKeys = new Set(policy.scoreBearingMetricKeys.map(resolveMetricInputKey));
  for (const feature of artifact.model.features) {
    if (feature.kind !== "metric") continue;
    const metricKey = resolveMetricInputKey(feature.metricKey);
    if (!allowedMetricKeys.has(metricKey)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        featureKey: feature.key,
        message: `${artifact.cardId} does not authorize a local score-bearing feature for this metric.`,
        metricKey,
      });
    }
  }
  return warnings;
}

function validateFeatureTransform(feature: MurphAgeModelFeature): MurphAgeWarning[] {
  const transform = feature.transform;
  if (!transform) return [];

  switch (transform.kind) {
    case "identity":
      return [];
    case "ln":
      return transform.offset === undefined || Number.isFinite(transform.offset)
        ? []
        : [invalidModelWarning(`${feature.label} log transform offset must be finite.`, feature)];
    case "z-score": {
      const warnings: MurphAgeWarning[] = [];
      if (!Number.isFinite(transform.mean)) {
        warnings.push(invalidModelWarning(`${feature.label} z-score mean must be finite.`, feature));
      }
      if (!Number.isFinite(transform.standardDeviation) || transform.standardDeviation <= 0) {
        warnings.push(invalidModelWarning(`${feature.label} z-score standard deviation must be positive and finite.`, feature));
      }
      const min = transform.clamp?.min;
      const max = transform.clamp?.max;
      if (min !== undefined && !Number.isFinite(min)) {
        warnings.push(invalidModelWarning(`${feature.label} z-score clamp minimum must be finite.`, feature));
      }
      if (max !== undefined && !Number.isFinite(max)) {
        warnings.push(invalidModelWarning(`${feature.label} z-score clamp maximum must be finite.`, feature));
      }
      if (min !== undefined && max !== undefined && min > max) {
        warnings.push(invalidModelWarning(`${feature.label} z-score clamp minimum cannot exceed maximum.`, feature));
      }
      return warnings;
    }
  }
}

function parseScoreBearingCardId(value: unknown): MurphAgeScoreBearingCardId | null {
  if (typeof value !== "string") return null;
  const policy = MURPH_AGE_MODEL_CARD_POLICIES.find((candidate) => candidate.cardId === value);
  return policy && policy.scoreBearing && isScoreBearingCardId(policy.cardId) ? policy.cardId : null;
}

function parseModelFeatures(value: unknown): readonly MurphAgeModelFeature[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const features = value.map(parseModelFeatureArtifact);
  return features.every((feature): feature is MurphAgeModelFeature => feature !== null)
    ? features
    : null;
}

function parseModelFeatureArtifact(value: unknown): MurphAgeModelFeature | null {
  const feature = asPlainRecord(value);
  if (!feature) return null;
  switch (feature.kind) {
    case "chronological-age":
      return parseChronologicalAgeFeature(feature);
    case "sex":
      return parseSexFeature(feature);
    case "metric":
      return parseMetricFeature(feature);
    default:
      return null;
  }
}

function parseChronologicalAgeFeature(feature: Record<string, unknown>): MurphAgeModelFeature | null {
  if (!recordHasOnlyKeys(feature, [
    "coefficient",
    "key",
    "kind",
    "label",
    "moduleId",
    "transform",
  ])) {
    return null;
  }
  const base = parseFeatureBase(feature);
  if (!base) return null;
  return { ...base, kind: "chronological-age" };
}

function parseSexFeature(feature: Record<string, unknown>): MurphAgeModelFeature | null {
  if (!recordHasOnlyKeys(feature, [
    "coefficient",
    "key",
    "kind",
    "label",
    "moduleId",
    "sex",
    "transform",
  ])) {
    return null;
  }
  const base = parseFeatureBase(feature);
  const sex = parseMurphAgeSex(feature.sex);
  if (!base || !sex) return null;
  return { ...base, kind: "sex", sex };
}

function parseMetricFeature(feature: Record<string, unknown>): MurphAgeModelFeature | null {
  if (!recordHasOnlyKeys(feature, [
    "biomarkerKey",
    "coefficient",
    "expectedUnit",
    "key",
    "kind",
    "label",
    "metricKey",
    "moduleId",
    "required",
    "selectionPolicy",
    "transform",
  ])) {
    return null;
  }
  const base = parseFeatureBase(feature);
  const metricKey = parseNonEmptyString(feature.metricKey);
  const biomarkerKey = parseOptionalNonEmptyString(feature.biomarkerKey);
  const expectedUnit = parseOptionalNonEmptyString(feature.expectedUnit);
  const required = parseOptionalBoolean(feature.required);
  const selectionPolicy = parseOptionalMetricSelectionPolicy(feature.selectionPolicy);
  if (
    !base ||
    metricKey === null ||
    biomarkerKey === null ||
    expectedUnit === null ||
    required === null ||
    selectionPolicy === null
  ) {
    return null;
  }

  const parsed: MurphAgeModelFeature & { kind: "metric" } = {
    ...base,
    kind: "metric",
    metricKey,
  };
  if (biomarkerKey !== undefined) parsed.biomarkerKey = biomarkerKey;
  if (expectedUnit !== undefined) parsed.expectedUnit = expectedUnit;
  if (required !== undefined) parsed.required = required;
  if (selectionPolicy !== undefined) parsed.selectionPolicy = selectionPolicy;
  return parsed;
}

function parseFeatureBase(feature: Record<string, unknown>): MurphAgeModelFeatureBase | null {
  const coefficient = parseFiniteNumber(feature.coefficient);
  const key = parseNonEmptyString(feature.key);
  const label = parseNonEmptyString(feature.label);
  const moduleId = parseOptionalNonEmptyString(feature.moduleId);
  const transform = parseOptionalFeatureTransform(feature.transform);
  if (coefficient === null || key === null || label === null || moduleId === null || transform === null) {
    return null;
  }
  const base: MurphAgeModelFeatureBase = { coefficient, key, label };
  if (moduleId !== undefined) base.moduleId = moduleId;
  if (transform !== undefined) base.transform = transform;
  return base;
}

function parseOptionalFeatureTransform(value: unknown): MurphAgeFeatureTransform | undefined | null {
  if (value === undefined) return undefined;
  const transform = asPlainRecord(value);
  if (!transform) return null;
  switch (transform.kind) {
    case "identity":
      return recordHasOnlyKeys(transform, ["kind"]) ? { kind: "identity" } : null;
    case "ln": {
      if (!recordHasOnlyKeys(transform, ["kind", "offset"])) return null;
      const offset = parseOptionalFiniteNumber(transform.offset);
      if (offset === null) return null;
      return offset === undefined ? { kind: "ln" } : { kind: "ln", offset };
    }
    case "z-score":
      return parseZScoreTransform(transform);
    default:
      return null;
  }
}

function parseZScoreTransform(transform: Record<string, unknown>): MurphAgeFeatureTransform | null {
  if (!recordHasOnlyKeys(transform, ["clamp", "kind", "mean", "standardDeviation"])) return null;
  const mean = parseFiniteNumber(transform.mean);
  const standardDeviation = parsePositiveFiniteNumber(transform.standardDeviation);
  const clamp = parseOptionalClamp(transform.clamp);
  if (mean === null || standardDeviation === null || clamp === null) return null;
  const parsed: MurphAgeFeatureTransform = { kind: "z-score", mean, standardDeviation };
  if (clamp !== undefined) parsed.clamp = clamp;
  return parsed;
}

function parseOptionalClamp(value: unknown): { max?: number; min?: number } | undefined | null {
  if (value === undefined) return undefined;
  const clamp = asPlainRecord(value);
  if (!clamp || !recordHasOnlyKeys(clamp, ["max", "min"])) return null;
  const max = parseOptionalFiniteNumber(clamp.max);
  const min = parseOptionalFiniteNumber(clamp.min);
  if (max === null || min === null) return null;
  const parsed: { max?: number; min?: number } = {};
  if (max !== undefined) parsed.max = max;
  if (min !== undefined) parsed.min = min;
  return parsed;
}

function parseOptionalMetricSelectionPolicy(value: unknown): MetricSelectionPolicy | undefined | null {
  if (value === undefined) return undefined;
  const policy = asPlainRecord(value);
  if (!policy) return null;
  switch (policy.kind) {
    case "latest-valid":
      return parseLatestValidPolicy(policy);
    case "latest-lab":
      return parseLatestLabPolicy(policy);
    case "daily-aggregate":
      return parseDailyAggregatePolicy(policy);
    case "latest-device-estimate":
      return parseLatestDeviceEstimatePolicy(policy);
    case "qualified-latest":
      return parseQualifiedLatestPolicy(policy);
    default:
      return null;
  }
}

function parseLatestValidPolicy(policy: Record<string, unknown>): MetricSelectionPolicy | null {
  if (!recordHasOnlyKeys(policy, ["kind", "staleAfterDays"])) return null;
  const staleAfterDays = parseOptionalPositiveFiniteNumber(policy.staleAfterDays);
  if (staleAfterDays === null) return null;
  return staleAfterDays === undefined ? { kind: "latest-valid" } : { kind: "latest-valid", staleAfterDays };
}

function parseLatestLabPolicy(policy: Record<string, unknown>): MetricSelectionPolicy | null {
  if (!recordHasOnlyKeys(policy, ["kind", "preferCollectedAt", "preferFasting", "staleAfterDays"])) return null;
  const staleAfterDays = parseOptionalPositiveFiniteNumber(policy.staleAfterDays);
  const preferFasting = parseOptionalBoolean(policy.preferFasting);
  if (staleAfterDays === null || preferFasting === null || policy.preferCollectedAt !== true) return null;
  const parsed: MetricSelectionPolicy = { kind: "latest-lab", preferCollectedAt: true };
  if (preferFasting !== undefined) parsed.preferFasting = preferFasting;
  if (staleAfterDays !== undefined) parsed.staleAfterDays = staleAfterDays;
  return parsed;
}

function parseDailyAggregatePolicy(policy: Record<string, unknown>): MetricSelectionPolicy | null {
  if (!recordHasOnlyKeys(policy, [
    "kind",
    "latestWindowDays",
    "minimumPoints",
    "staleAfterDays",
    "statistic",
  ])) {
    return null;
  }
  const statistic = parseDailyAggregateStatistic(policy.statistic);
  const latestWindowDays = parseOptionalPositiveFiniteNumber(policy.latestWindowDays);
  const minimumPoints = parseOptionalPositiveFiniteNumber(policy.minimumPoints);
  const staleAfterDays = parseOptionalPositiveFiniteNumber(policy.staleAfterDays);
  if (statistic === null || latestWindowDays === null || minimumPoints === null || staleAfterDays === null) {
    return null;
  }
  const parsed: MetricSelectionPolicy = { kind: "daily-aggregate", statistic };
  if (latestWindowDays !== undefined) parsed.latestWindowDays = latestWindowDays;
  if (minimumPoints !== undefined) parsed.minimumPoints = minimumPoints;
  if (staleAfterDays !== undefined) parsed.staleAfterDays = staleAfterDays;
  return parsed;
}

function parseLatestDeviceEstimatePolicy(policy: Record<string, unknown>): MetricSelectionPolicy | null {
  if (!recordHasOnlyKeys(policy, ["kind", "staleAfterDays"])) return null;
  const staleAfterDays = parseOptionalPositiveFiniteNumber(policy.staleAfterDays);
  if (staleAfterDays === null) return null;
  return staleAfterDays === undefined
    ? { kind: "latest-device-estimate" }
    : { kind: "latest-device-estimate", staleAfterDays };
}

function parseQualifiedLatestPolicy(policy: Record<string, unknown>): MetricSelectionPolicy | null {
  if (!recordHasOnlyKeys(policy, ["kind", "requiredQualifiers", "staleAfterDays"])) return null;
  const requiredQualifiers = parseRequiredQualifiers(policy.requiredQualifiers);
  const staleAfterDays = parseOptionalPositiveFiniteNumber(policy.staleAfterDays);
  if (!requiredQualifiers || staleAfterDays === null) return null;
  const parsed: MetricSelectionPolicy = { kind: "qualified-latest", requiredQualifiers };
  if (staleAfterDays !== undefined) parsed.staleAfterDays = staleAfterDays;
  return parsed;
}

function parseDailyAggregateStatistic(value: unknown): "count" | "max" | "mean" | "median" | "min" | "sum" | null {
  return value === "count" || value === "max" || value === "mean" || value === "median" || value === "min" || value === "sum"
    ? value
    : null;
}

function parseRequiredQualifiers(value: unknown): Record<string, boolean | number | string> | null {
  const qualifiers = asPlainRecord(value);
  if (!qualifiers) return null;
  const parsed: Record<string, boolean | number | string> = {};
  for (const [key, qualifierValue] of Object.entries(qualifiers)) {
    if (
      typeof qualifierValue !== "string" &&
      typeof qualifierValue !== "boolean" &&
      !(typeof qualifierValue === "number" && Number.isFinite(qualifierValue))
    ) {
      return null;
    }
    parsed[key] = qualifierValue;
  }
  return parsed;
}

function parseReferenceRiskCurveArtifact(value: unknown): readonly MurphAgeReferenceRiskPoint[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points = value.map((point) => {
    const record = asPlainRecord(point);
    if (!record || !recordHasOnlyKeys(record, ["ageYears", "riskProbability"])) return null;
    const ageYears = parseFiniteNumber(record.ageYears);
    const riskProbability = parseProbability(record.riskProbability);
    return ageYears === null || riskProbability === null ? null : { ageYears, riskProbability };
  });
  return points.every((point): point is MurphAgeReferenceRiskPoint => point !== null)
    ? points
    : null;
}

function parseOptionalCalibration(value: unknown): MurphAgeRiskModel["calibration"] | undefined | null {
  if (value === undefined) return undefined;
  const calibration = asPlainRecord(value);
  if (!calibration || !recordHasOnlyKeys(calibration, ["intercept", "slope"])) return null;
  const intercept = parseFiniteNumber(calibration.intercept);
  const slope = parseFiniteNumber(calibration.slope);
  return intercept === null || slope === null ? null : { intercept, slope };
}

function parseOptionalUncertainty(value: unknown): MurphAgeRiskModel["uncertainty"] | undefined | null {
  if (value === undefined) return undefined;
  const uncertainty = asPlainRecord(value);
  if (!uncertainty || !recordHasOnlyKeys(uncertainty, [
    "baseYears",
    "perLowConfidenceMetricYears",
    "perMissingOptionalFeatureYears",
  ])) {
    return null;
  }
  const baseYears = parseOptionalNonnegativeFiniteNumber(uncertainty.baseYears);
  const perLowConfidenceMetricYears = parseOptionalNonnegativeFiniteNumber(uncertainty.perLowConfidenceMetricYears);
  const perMissingOptionalFeatureYears = parseOptionalNonnegativeFiniteNumber(uncertainty.perMissingOptionalFeatureYears);
  if (
    baseYears === null ||
    perLowConfidenceMetricYears === null ||
    perMissingOptionalFeatureYears === null
  ) {
    return null;
  }
  const parsed: NonNullable<MurphAgeRiskModel["uncertainty"]> = {};
  if (baseYears !== undefined) parsed.baseYears = baseYears;
  if (perLowConfidenceMetricYears !== undefined) {
    parsed.perLowConfidenceMetricYears = perLowConfidenceMetricYears;
  }
  if (perMissingOptionalFeatureYears !== undefined) {
    parsed.perMissingOptionalFeatureYears = perMissingOptionalFeatureYears;
  }
  return parsed;
}

function parseMurphAgeSex(value: unknown): MurphAgeSex | null {
  return value === "female" || value === "male" ? value : null;
}

function parseNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseOptionalNonEmptyString(value: unknown): string | undefined | null {
  return value === undefined ? undefined : parseNonEmptyString(value);
}

function parseOptionalStringArray(value: unknown): readonly string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === "string" && item.length > 0)
    ? value
    : null;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseOptionalFiniteNumber(value: unknown): number | undefined | null {
  return value === undefined ? undefined : parseFiniteNumber(value);
}

function parsePositiveFiniteNumber(value: unknown): number | null {
  const number = parseFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function parseOptionalPositiveFiniteNumber(value: unknown): number | undefined | null {
  return value === undefined ? undefined : parsePositiveFiniteNumber(value);
}

function parseOptionalNonnegativeFiniteNumber(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const number = parseFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function parseProbability(value: unknown): number | null {
  const number = parseFiniteNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function parseOptionalBoolean(value: unknown): boolean | undefined | null {
  return value === undefined ? undefined : typeof value === "boolean" ? value : null;
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recordHasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function invalidModelWarning(message: string, feature?: MurphAgeModelFeature): MurphAgeWarning {
  return {
    code: "INVALID_INPUT",
    featureKey: feature?.key,
    message,
    metricKey: feature?.kind === "metric" ? resolveMetricInputKey(feature.metricKey) : undefined,
  };
}

interface BlockedIdentifiers {
  biomarkerKeys: ReadonlySet<string>;
  metricKeys: ReadonlySet<string>;
}

function normalizedBlockedIdentifiers(model: MurphAgeRiskModel): BlockedIdentifiers {
  return {
    biomarkerKeys: new Set([...DEFAULT_BLOCKED_BIOMARKER_KEYS, ...(model.blockedBiomarkerKeys ?? [])]),
    metricKeys: new Set([...DEFAULT_BLOCKED_METRIC_KEYS, ...(model.blockedMetricKeys ?? [])].map(resolveMetricInputKey)),
  };
}

function isBlockedMetricFeature(input: {
  biomarkerKey: string | null;
  blockedIdentifiers: BlockedIdentifiers;
  metricKey: string;
}): boolean {
  return input.blockedIdentifiers.metricKeys.has(input.metricKey)
    || input.blockedIdentifiers.biomarkerKeys.has(input.biomarkerKey ?? "")
    || input.metricKey.includes("crp");
}

function mapMetricSelectionWarnings(
  feature: MurphAgeModelFeature & { kind: "metric" },
  selection: MetricSelection,
): MurphAgeWarning[] {
  return selection.warnings.map((warning: MetricSelectionWarning) => ({
    code: "METRIC_SELECTION_WARNING",
    featureKey: feature.key,
    message: warning.message,
    metricKey: selection.metricKey,
  }));
}

function validateReferenceRiskCurve(
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[],
): MurphAgeReferenceRiskPoint[] {
  const curve = [...referenceRiskCurve].sort((left, right) => left.ageYears - right.ageYears);
  if (curve.length < 2) {
    throw new TypeError("Reference risk curve must include at least two points.");
  }

  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index];
    if (!point || !Number.isFinite(point.ageYears) || !Number.isFinite(point.riskProbability)) {
      throw new TypeError("Reference risk curve points must be finite.");
    }
    if (point.riskProbability < 0 || point.riskProbability > 1) {
      throw new TypeError("Reference risk curve probabilities must be between 0 and 1.");
    }
    const previous = curve[index - 1];
    if (previous && point.riskProbability < previous.riskProbability) {
      throw new TypeError("Reference risk curve probabilities must be monotonic by age.");
    }
  }

  return curve;
}

function applyCalibration(linearScore: number, calibration: MurphAgeRiskModel["calibration"]): number {
  return calibration ? calibration.intercept + calibration.slope * linearScore : linearScore;
}

function calibratedContribution(contributionLogit: number, calibration: MurphAgeRiskModel["calibration"]): number {
  return calibration ? calibration.slope * contributionLogit : contributionLogit;
}

function logistic(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function roundContribution(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundYears(value: number): number {
  return Math.round(value * 10) / 10;
}
