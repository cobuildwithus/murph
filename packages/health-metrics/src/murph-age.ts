import { resolveMetricDefinition, resolveMetricInputKey, uniqueStrings } from "./catalog.ts";
import {
  listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority,
  listMurphAgeOrdinaryLabWearableSourceRoutes,
  listMurphAgePrioritySourceRoutes,
  resolveMurphAgeSourceRoute,
  type MurphAgeSourceRouteArtifactBoundary,
  type MurphAgeSourceRouteId,
  type MurphAgeSourceRouteLayer,
} from "./murph-age-source-routes.ts";
import { normalizeMetricValue, normalizeUnit, unitsEquivalent } from "./normalize.ts";
import { selectMetricValue } from "./selectors.ts";
import {
  METRIC_POINT_SCHEMA_VERSION,
  type MetricConfidence,
  type MetricPoint,
  type MetricPointContext,
  type MetricSelection,
  type MetricSelectionPolicy,
  type MetricSelectionWarning,
} from "./types.ts";

export const MURPH_AGE_RESULT_SCHEMA_VERSION = "murph.age.result.v2" as const;
export const MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION = "murph.age.input-bundle.v1" as const;
export const MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION = "murph.age.display-summary.v5" as const;
export const MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION = "murph.age.public-display-summary.v4" as const;
export const MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION =
  "murph.age.public-calculator-report.v6" as const;
export const MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION =
  "murph.age.public-calculator-view.v5" as const;
export const MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION =
  "murph.age.research-calculator-view.v16" as const;
export const MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION =
  "murph.age.submitted-calculator-view-bundle.v4" as const;
export const MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION =
  "murph.age.submitted-calculator-capability.v2" as const;
export const MURPH_AGE_SUBMITTED_CALCULATOR_INPUT_BUNDLE_SPEC_SCHEMA_VERSION =
  "murph.age.submitted-calculator-input-bundle-spec.v1" as const;
export const MURPH_AGE_ARCHITECTURE_SUMMARY_SCHEMA_VERSION =
  "murph.age.architecture-summary.v4" as const;
export const MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_STATUS_SCHEMA_VERSION =
  "murph.age.public-lab-wearable-shadow-evidence-status.v2" as const;
export const MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION =
  "murph.age.wearable-shadow-increment.v1" as const;
export const MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_SCHEMA_VERSION =
  "murph.age.wearable-shadow-result-card.v1" as const;
export const MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION =
  "murph.age.increment-evaluation-card.v1" as const;
export const MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SCHEMA_VERSION =
  "murph.age.ordinary-lab-wearable-evidence-template.v1" as const;
export const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_SCHEMA_VERSION =
  "murph.age.wearable-activity-benchmark-card.v1" as const;
export const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION =
  "murph.age.wearable-lab-aggregate-receipt.v1" as const;
export const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION =
  "murph.age.wearable-lab-aggregate-receipt-template.v1" as const;
export const MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SCHEMA_VERSION =
  "murph.age.wearable-bridge-feature.v1" as const;
export const MURPH_AGE_WEARABLE_COVERAGE_WINDOW_DAYS = 28 as const;
export const MURPH_AGE_WEARABLE_COVERAGE_MIN_VALID_DAYS = 14 as const;
export const MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION =
  "murph.age.wearable-score-bearing-strategy.v3" as const;
export const MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION =
  "murph.age.wearable-residual-layer-contract.v2" as const;
export const MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION =
  "murph.age.wearable-residual-layer-application.v2" as const;
export const MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION =
  "murph.age.wearable-parameter-pack-contract.v1" as const;
export const MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION =
  "murph.age.wearable-residual-parameter-pack.v1" as const;
export const MURPH_AGE_FUNCTION_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION =
  "murph.age.function-residual-layer-application.v1" as const;
export const MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION =
  "murph.age.function-residual-parameter-pack.v1" as const;
export const MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION = "murph.age.model-card-artifact.v1" as const;
export const MURPH_AGE_WEARABLE_SHADOW_RESULT_EVIDENCE_TIERS = [
  "external-validation",
  "internal-diagnostic",
  "partner-aggregate",
  "same-family-sanity",
] as const;
export const MURPH_AGE_INCREMENT_EVALUATION_LAYERS = [
  "biomarker-increment",
  "wearable-shadow-increment",
] as const satisfies readonly MurphAgeSourceRouteLayer[];
export const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS = [
  "m0-anchor-only",
  "m1-anchor-plus-lab-body-bp",
  "m2-coverage-device-ehr-density-control",
  "m3-wearable-residual",
  "m4-wearable-plus-coverage",
  "m5-residualized-wearable-after-controls",
] as const;

export type MurphAgeSex = "female" | "male";
export type MurphAgeStatus = "abstain" | "ready";
export type MurphAgeInputBundleStatus = "abstain" | "context-only" | "ready";
export type MurphAgeInputBundleId =
  | "function-context"
  | "insufficient"
  | "l1-glycemia"
  | "l1b-glycemia-body"
  | "lab5-bp-bmi"
  | "lab9-bp-body"
  | "r399-nhis-proxy-anchor"
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
  | (MurphAgeModelFeatureBase & { kind: "chronological-age-squared" })
  | (MurphAgeModelFeatureBase & { kind: "age-sex-interaction"; sex: MurphAgeSex })
  | (MurphAgeModelFeatureBase & { kind: "sex"; sex: MurphAgeSex })
  | (MurphAgeModelFeatureBase & {
      biomarkerKey?: string;
      expectedUnit?: string;
      kind: "metric";
      metricKey: string;
      missingValue?: number;
      required?: boolean;
      selectionPolicy?: MetricSelectionPolicy;
    })
  | (MurphAgeModelFeatureBase & {
      biomarkerKey?: string;
      kind: "metric-missingness";
      metricKey: string;
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
  | "function_context_no_risk"
  | "l1b_glycemia_body_10y_acm_research"
  | "l1_tiny_glycemia_10y_acm_research"
  | "lab5_bp_bmi_transport_research"
  | "lab9_bp_body_10y_acm_research"
  | "r399_nhis_proxy_10y_acm_research"
  | "wearable_context_no_risk";

export type MurphAgeScoreBearingCardId =
  | "l1b_glycemia_body_10y_acm_research"
  | "l1_tiny_glycemia_10y_acm_research"
  | "lab5_bp_bmi_transport_research"
  | "lab9_bp_body_10y_acm_research"
  | "r399_nhis_proxy_10y_acm_research";
export type MurphAgeCalculatorMode = "product" | "research";
export type MurphAgeValidationGateStatus = "blocked" | "passed";
export type MurphAgeValidationEvidenceTier =
  | "internal-anchor"
  | "murph-native-prospective-validation"
  | "partner-aggregate-validation"
  | "provisional-local-research"
  | "same-family-sanity"
  | "true-external-validation";
export type MurphAgeProductPromotionBlocker =
  | "PRODUCT_POLICY_NOT_AUTHORIZED"
  | "PRODUCT_PROMOTION_EVIDENCE_MISSING"
  | "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING"
  | "RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED"
  | "VALIDATION_GATE_BLOCKED";

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

export interface MurphAgePublicValidationGateSummary extends Omit<MurphAgeValidationGateSummary, "evidenceTiers"> {
  evidenceTiers: MurphAgeValidationEvidenceTier[];
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

export type MurphAgeArchitectureLayerId =
  | "clinical-lab-body"
  | "function-cognition-context"
  | "outcome-anchor"
  | "product-display"
  | "source-validation"
  | "wearable-shadow";
export type MurphAgeArchitectureLayerMode =
  | "blocked"
  | "context-only"
  | "score-bearing-research"
  | "shadow-only"
  | "validation-only";

export interface MurphAgeArchitectureLayerSummary {
  blockedUntil: string;
  blockerCodes: MurphAgeProductPromotionBlocker[];
  candidateMetricKeys: string[];
  contextMetricKeys: string[];
  currentUse: string;
  evidenceClasses: MurphAgeEvidenceClass[];
  featureFamilies: string[];
  layerId: MurphAgeArchitectureLayerId;
  mode: MurphAgeArchitectureLayerMode;
  modelCardIds: MurphAgeModelCardId[];
  productAuthorized: false;
  riskToAgeDisplayAuthorized: false;
  scoreBearing: boolean;
  scoreBearingMetricKeys: string[];
  scoreContributionAuthorized: boolean;
  shadowMetricKeys: string[];
  sourceRouteIds: MurphAgeSourceRouteId[];
}

export type MurphAgePublicLabWearableShadowEvidencePacketId =
  | "r1038-nhanes-modern-lab-activity-loop"
  | "r1049-nhanes-activity-control-diagnostic"
  | "r1065-nhanes-wrist-activity-shadow-loop"
  | "r1066-nhanes-wrist-activity-robustness-loop"
  | "r1067-nhanes-wrist-final-stress-test";

export type MurphAgePublicLabWearableShadowEvidenceConclusion =
  "public_multi_family_wearable_shadow_signal_mixed_keep_context_only";

export type MurphAgePublicLabWearableShadowEvidenceNextAction =
  "run_external_or_partner_lab_wearable_aggregate_delta";

export interface MurphAgePublicLabWearableShadowEvidenceMetricDeltas {
  auc?: number;
  brier?: number;
  calibrationSlope?: number;
  eOverO?: number;
  logLoss?: number;
}

export interface MurphAgePublicLabWearableShadowEvidencePacket {
  aggregateMetricDeltas: MurphAgePublicLabWearableShadowEvidenceMetricDeltas;
  conclusion: string;
  evidenceRole: "same-family-public-shadow-diagnostic";
  negativeControlsBeaten: boolean | null;
  packetId: MurphAgePublicLabWearableShadowEvidencePacketId;
  productDisplayAuthorized: false;
  sourceRouteId: MurphAgeSourceRouteId;
  usableAsConsumerWearableValidation: false;
  wearableScoreBearingAuthorized: false;
}

export interface MurphAgePublicLabWearableShadowEvidenceStatus {
  conclusion: MurphAgePublicLabWearableShadowEvidenceConclusion;
  externalConsumerLabWearableAggregateStillMissing: true;
  includedPacketIds: MurphAgePublicLabWearableShadowEvidencePacketId[];
  inputPriority: "ordinary-16-50-labs-plus-multi-family-wearables";
  nextAction: MurphAgePublicLabWearableShadowEvidenceNextAction;
  nextExternalOrPartnerRouteIdsByPriority: MurphAgeSourceRouteId[];
  packets: MurphAgePublicLabWearableShadowEvidencePacket[];
  productDisplayAuthorized: false;
  publicAggregateOnly: true;
  reviewGptEscalation: "only-after-source-boundary-change-or-real-aggregate-delta";
  reviewGptRequiredNow: false;
  schemaVersion: typeof MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_STATUS_SCHEMA_VERSION;
  sourceRouteIdsByEvidencePriority: MurphAgeSourceRouteId[];
  usableAsConsumerWearableValidation: false;
  wearableScoreBearingAuthorized: false;
}

export type MurphAgeWearableScoreBearingFamilyCurrentUse =
  | "context-only"
  | "quality-gate-only"
  | "shadow-residual-research";

export type MurphAgeWearableScoreBearingFamilyPriority =
  | "defer"
  | "first"
  | "second"
  | "third";

export type MurphAgeWearableScoreBearingPromotionSignal =
  | "deployable-parameterization-authorized"
  | "m5-beats-m1-proper-score"
  | "m5-beats-m2-coverage-control"
  | "m5-calibration-passes"
  | "negative-controls-pass"
  | "replicates-in-two-source-families"
  | "reverse-causation-washout-passes";

export type MurphAgeWearableResidualLayerId =
  | "activity-residual-v1"
  | "hrv-residual-v1"
  | "multi-wearable-residual-v1"
  | "resting-heart-rate-residual-v1"
  | "sleep-residual-v1";

export type MurphAgeWearableResidualLayerCombinationScale = "logit-residual";

export type MurphAgeWearableResidualLayerDeploymentStatus =
  "contract-only-no-validated-parameters";

export type MurphAgeWearableResidualLayerApplicationStatus =
  | "blocked-incompatible-anchor"
  | "ineligible-insufficient-coverage"
  | "mechanics-ready-zero-delta"
  | "research-parameterized-shadow-delta";

export type MurphAgeWearableParameterPackFamily =
  | "activity"
  | "estimated-vo2-max"
  | "hrv"
  | "resting-heart-rate"
  | "sleep";

export type MurphAgeWearableParameterPackDeploymentRights =
  | "not-authorized"
  | "product-authorized"
  | "research-only";

export type MurphAgeWearableParameterPackRequiredField =
  | "anchorCardId"
  | "calibrationIntercept"
  | "calibrationSlope"
  | "deploymentRights"
  | "deviceMethodQualifier"
  | "eligibleAgeSexBounds"
  | "endpoint"
  | "evidenceTier"
  | "family"
  | "featureNames"
  | "featureTransforms"
  | "globalWearableCap"
  | "horizonYears"
  | "packHash"
  | "promotionGateResults"
  | "sourceRouteId"
  | "validDayNightRules";

export interface MurphAgeWearableParameterPackContract {
  deploymentRightsRequiredForProductScoring: true;
  emptyPackBehavior: "exact-current-zero-delta-behavior";
  familyPriorityOrder: MurphAgeWearableParameterPackFamily[];
  requiredFields: MurphAgeWearableParameterPackRequiredField[];
  requiredForResidualScoring: true;
  schemaVersion: typeof MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION;
  supportedDeploymentRights: MurphAgeWearableParameterPackDeploymentRights[];
}

export interface MurphAgeWearableResidualFeatureSetContract {
  activityVolumeCandidateMetricKeys: string[];
  coverageControlMetricKeys: string[];
  firstPassOnlyFamily: "activity";
  methodQualifierRequired: true;
  proprietaryDeviceScoresExcluded: true;
  trailingWindowDays: 28;
}

export interface MurphAgeWearableResidualParameterPackFeature {
  center: number;
  coefficient: number;
  metricKey: string;
  scale: number;
  transform: "center-scale";
}

export interface MurphAgeWearableResidualParameterPack {
  anchorCardId: MurphAgeScoreBearingCardId;
  calibrationIntercept: number;
  calibrationSlope: number;
  deploymentRights: MurphAgeWearableParameterPackDeploymentRights;
  endpoint: string;
  evidenceTier: MurphAgeValidationEvidenceTier;
  family: MurphAgeWearableShadowIncrementFamily;
  featureWeights: MurphAgeWearableResidualParameterPackFeature[];
  globalWearableCapLogit: number;
  horizonYears: 10;
  intercept: number;
  layerId: MurphAgeWearableResidualLayerId;
  packHash: string;
  schemaVersion: typeof MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION;
  sourceRouteId: MurphAgeSourceRouteId;
}

export interface MurphAgeWearableResidualParameterPackValidationResult {
  status: "invalid" | "valid";
  warnings: MurphAgeWarning[];
}

export interface MurphAgeWearableScoreBearingFamilyPolicy {
  currentUse: MurphAgeWearableScoreBearingFamilyCurrentUse;
  family: MurphAgeWearableBridgeFeatureFamily;
  minimumValidDays28d: number | null;
  minimumValidNights28d: number | null;
  productAuthorized: false;
  productMultiplier: 0;
  qualityMetricKeys: string[];
  requiresDeviceOrMethodQualification: boolean;
  researchMultiplier: 0 | 1;
  scoreBearingPromotionPriority: MurphAgeWearableScoreBearingFamilyPriority;
  scoreContributionAuthorized: false;
  signalMetricKeys: string[];
}

export interface MurphAgeWearableResidualLayerContract {
  anchorCardIds: MurphAgeScoreBearingCardId[];
  parameterPackContract: MurphAgeWearableParameterPackContract;
  combinationScale: MurphAgeWearableResidualLayerCombinationScale;
  coverageScoringPolicy: "gate-and-control-only-not-age-contribution";
  currentDeploymentStatus: MurphAgeWearableResidualLayerDeploymentStatus;
  deployableParameterizationAvailable: false;
  deferredFamilyOrder: Array<"sleep" | "resting-heart-rate" | "hrv" | "estimated-vo2-max">;
  family: MurphAgeWearableShadowIncrementFamily;
  featureSetContract: MurphAgeWearableResidualFeatureSetContract;
  layerId: MurphAgeWearableResidualLayerId;
  minimumValidDays28d: number | null;
  minimumValidNights28d: number | null;
  missingnessPolicy: "missing-or-undercovered-family-zero-delta-widen-uncertainty";
  nuisanceControlMetricKeys: string[];
  primaryDecisionComparisons: Array<"m5-vs-m1-lab-body" | "m5-vs-m2-coverage-control">;
  productAuthorized: false;
  productMultiplier: 0;
  qualityGateMetricKeys: string[];
  requiredPromotionSignals: MurphAgeWearableScoreBearingPromotionSignal[];
  researchMultiplier: 0;
  residualDeltaStatus: "zero-until-validated";
  schemaVersion: typeof MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  signalMetricKeys: string[];
  trailingWindowDays: 28;
}

export interface MurphAgeWearableResidualLayerApplication {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorRiskAgeEquivalentYears: number | null;
  anchorCompatible: boolean;
  anchorLogit: number | null;
  eligibleForResidualResearch: boolean;
  finalRiskAgeEquivalentYears: number | null;
  finalLogit: number | null;
  finalRiskProbability: number | null;
  layerId: MurphAgeWearableResidualLayerId;
  parameterPackHash: string | null;
  parameterizationAvailable: boolean;
  productAuthorized: false;
  residualDeltaYears: number | null;
  residualDeltaLogit: number;
  schemaVersion: typeof MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectedMetricKeys: string[];
  status: MurphAgeWearableResidualLayerApplicationStatus;
  warnings: MurphAgeWarning[];
}

export type MurphAgeFunctionResidualLayerId = "function-mobility-residual-v1";

export type MurphAgeFunctionResidualLayerApplicationStatus =
  | "blocked-incompatible-anchor"
  | "ineligible-insufficient-function-context"
  | "mechanics-ready-zero-delta"
  | "research-parameterized-shadow-delta";

export type MurphAgeFunctionResidualParameterPackDeploymentRights =
  | "not-authorized"
  | "product-authorized"
  | "research-only";

export interface MurphAgeFunctionResidualParameterPackFeature {
  center: number;
  coefficient: number;
  metricKey: string;
  scale: number;
  transform: "center-scale";
}

export interface MurphAgeFunctionResidualParameterPack {
  anchorCardId: MurphAgeScoreBearingCardId;
  calibrationIntercept: number;
  calibrationSlope: number;
  deploymentRights: MurphAgeFunctionResidualParameterPackDeploymentRights;
  endpoint: "10-year all-cause mortality";
  evidenceTier: MurphAgeValidationEvidenceTier;
  featureWeights: MurphAgeFunctionResidualParameterPackFeature[];
  globalFunctionCapLogit: number;
  horizonYears: 10;
  intercept: number;
  layerId: MurphAgeFunctionResidualLayerId;
  packHash: string;
  schemaVersion: typeof MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION;
  sourceRouteId: MurphAgeSourceRouteId;
}

export interface MurphAgeFunctionResidualParameterPackValidationResult {
  status: "invalid" | "valid";
  warnings: MurphAgeWarning[];
}

export interface MurphAgeFunctionResidualLayerApplication {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorRiskAgeEquivalentYears: number | null;
  anchorCompatible: boolean;
  anchorLogit: number | null;
  eligibleForResidualResearch: boolean;
  finalRiskAgeEquivalentYears: number | null;
  finalLogit: number | null;
  finalRiskProbability: number | null;
  layerId: MurphAgeFunctionResidualLayerId;
  parameterPackHash: string | null;
  parameterizationAvailable: boolean;
  productAuthorized: false;
  residualDeltaYears: number | null;
  residualDeltaLogit: number;
  schemaVersion: typeof MURPH_AGE_FUNCTION_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectedMetricKeys: string[];
  status: MurphAgeFunctionResidualLayerApplicationStatus;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeWearableScoreBearingStrategy {
  aggregateReceiptOnlyAuthorizesScienceReview: true;
  architecturePattern: "anchor-plus-wearable-residual-shadow";
  deployableParameterizationRequiredForProductScoring: true;
  familyPolicies: MurphAgeWearableScoreBearingFamilyPolicy[];
  modelForm: "penalized-additive-residual-bounded-and-shrunk";
  primaryDecisionComparisons: Array<"m5-vs-m1-lab-body" | "m5-vs-m2-coverage-control">;
  productStatus: "context-only";
  productWearableMultiplier: 0;
  residualLayerContract: MurphAgeWearableResidualLayerContract;
  requiredPromotionSignals: MurphAgeWearableScoreBearingPromotionSignal[];
  researchResidualMode: "locked-evaluator-only";
  schemaVersion: typeof MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION;
}

export interface MurphAgeArchitectureSummary {
  layerOrder: MurphAgeArchitectureLayerId[];
  layers: MurphAgeArchitectureLayerSummary[];
  ordinaryLabWearableAutoresearchSourceRouteIdsByExecutionPriority: MurphAgeSourceRouteId[];
  ordinaryLabWearableSourceRouteIdsByPriority: MurphAgeSourceRouteId[];
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  publicLabWearableShadowEvidenceStatus: MurphAgePublicLabWearableShadowEvidenceStatus;
  riskToAgeDisplayAuthorized: false;
  schemaVersion: typeof MURPH_AGE_ARCHITECTURE_SUMMARY_SCHEMA_VERSION;
  sourceRouteIdsByPriority: MurphAgeSourceRouteId[];
  wearableScoreBearingStrategy: MurphAgeWearableScoreBearingStrategy;
}

const MURPH_AGE_PRODUCT_PROMOTION_EVIDENCE_TIERS = new Set<MurphAgeValidationEvidenceTier>([
  "murph-native-prospective-validation",
  "partner-aggregate-validation",
  "true-external-validation",
]);

const MURPH_AGE_VALIDATION_EVIDENCE_TIERS = new Set<string>([
  "internal-anchor",
  "murph-native-prospective-validation",
  "partner-aggregate-validation",
  "provisional-local-research",
  "same-family-sanity",
  "true-external-validation",
]);

const MURPH_AGE_PRODUCT_PROMOTION_BLOCKERS = new Set<string>([
  "PRODUCT_POLICY_NOT_AUTHORIZED",
  "PRODUCT_PROMOTION_EVIDENCE_MISSING",
  "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING",
  "RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED",
  "VALIDATION_GATE_BLOCKED",
]);

export const MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT = {
  blocked: "Product promotion validation gate is blocked.",
  passed: "Product promotion validation gate passed.",
} satisfies Record<MurphAgeValidationGateStatus, string>;

export interface MurphAgeCalculatorInput {
  asOf?: string;
  cardId?: MurphAgeScoreBearingCardId;
  chronologicalAgeYears: number;
  functionResidualParameterPack?: MurphAgeFunctionResidualParameterPack | null;
  mode?: MurphAgeCalculatorMode;
  models?: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  points: readonly MetricPoint[];
  sex: MurphAgeSex;
  wearableResidualParameterPack?: MurphAgeWearableResidualParameterPack | null;
  wearableResidualParameterPacks?: readonly MurphAgeWearableResidualParameterPack[] | null;
}

export type MurphAgeSubmittedMetricSourceKind =
  | "activity-summary"
  | "measurement"
  | "profile"
  | "questionnaire"
  | "sleep-summary"
  | "survey-response"
  | "test-result"
  | "wearable-summary";

export type MurphAgeSubmittedCalculatorUserInputFamily =
  | "demographics-age-sex"
  | "bloodwork-common-labs"
  | "vitals-body-composition"
  | "wearable-activity"
  | "wearable-recovery-autonomic"
  | "wearable-sleep";

export interface MurphAgeSubmittedMetricInput {
  confidence?: MetricConfidence;
  context?: MetricPointContext;
  effectiveDate?: string;
  metricKey: string;
  observedAt?: string;
  sourceKind?: string;
  sourceLabel?: string | null;
  unit?: string | null;
  value: number | null;
}

export interface MurphAgeSubmittedCalculatorInput extends Omit<MurphAgeCalculatorInput, "points"> {
  asOf: string;
  submittedMetrics: readonly MurphAgeSubmittedMetricInput[];
}

export type MurphAgeSubmittedCalculatorMetricRole =
  | "bp-body-research"
  | "function-context"
  | "lab-research"
  | "proxy-anchor-research"
  | "wearable-context";

export interface MurphAgeSubmittedCalculatorMetricInputSpec {
  allowedSourceKinds: MurphAgeSubmittedMetricSourceKind[];
  aliases: string[];
  calculatorRoles: MurphAgeSubmittedCalculatorMetricRole[];
  canonicalUnit: string | null;
  category: string;
  displayName: string;
  featureKeys: string[];
  metricKey: string;
  productScoreBearingAuthorized: boolean;
  researchScoreBearingCardIds: MurphAgeScoreBearingCardId[];
  wearableScoreBearingAuthorized: false;
}

export type MurphAgeSubmittedCalculatorInputBundleSpecId =
  | "function-context"
  | "l1-glycemia"
  | "l1b-glycemia-body"
  | "lab5-bp-bmi"
  | "lab9-bp-body"
  | "r399-nhis-proxy-anchor"
  | "wearable-context";

export type MurphAgeSubmittedCalculatorInputBundleReadinessRule =
  | "all-required-features"
  | "all-lab5-features-plus-bmi-or-blood-pressure"
  | "glycemia-plus-body"
  | "one-or-more-context-features"
  | "one-or-more-glycemia-features"
  | "one-or-more-proxy-features";

export interface MurphAgeSubmittedCalculatorInputBundleCompletionRule {
  alternativeFeatureKeyGroups: string[][];
  minReadyFeatureCount: number | null;
  requiredFeatureKeys: string[];
  rule: MurphAgeSubmittedCalculatorInputBundleReadinessRule;
}

export interface MurphAgeSubmittedCalculatorInputBundleFeatureSpec {
  displayName: string;
  featureKey: string;
  metricKeys: string[];
  requiredForCompletion: boolean;
}

export interface MurphAgeSubmittedCalculatorInputBundleSpec {
  bundleId: MurphAgeSubmittedCalculatorInputBundleSpecId;
  cardId: MurphAgeModelCardId;
  completion: MurphAgeSubmittedCalculatorInputBundleCompletionRule;
  displayName: string;
  featureSpecs: MurphAgeSubmittedCalculatorInputBundleFeatureSpec[];
  productScoreBearingAuthorized: boolean;
  researchAgeEstimateEligible: boolean;
  schemaVersion: typeof MURPH_AGE_SUBMITTED_CALCULATOR_INPUT_BUNDLE_SPEC_SCHEMA_VERSION;
  scoreBearing: boolean;
}

export type MurphAgeSubmittedCalculatorRuntimeInputKey =
  | "chronological-age-years"
  | "sex";

export interface MurphAgeSubmittedCalculatorOutputBoundary {
  modelParametersExportAllowed: false;
  participantLevelExportAllowed: false;
  productScoreDisplayAuthorized: boolean;
  researchPreviewRequiresExplicitOptIn: true;
  rowValuesExportAllowed: false;
  submittedMetricScalarEchoAllowed: false;
}

export interface MurphAgeSubmittedCalculatorCapabilitySummary {
  acceptedMetricKeys: string[];
  acceptedSourceKinds: MurphAgeSubmittedMetricSourceKind[];
  acceptedUserInputFamilies: MurphAgeSubmittedCalculatorUserInputFamily[];
  bundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[];
  contextBundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[];
  outputBoundary: MurphAgeSubmittedCalculatorOutputBoundary;
  productAgeDisplayAuthorized: boolean;
  productRiskDisplayAuthorized: boolean;
  productScoreBearingMetricKeys: string[];
  researchAgeEstimateEligibleBundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[];
  researchPreviewSupported: true;
  researchScoreBearingMetricKeys: string[];
  runtimeInputKeys: MurphAgeSubmittedCalculatorRuntimeInputKey[];
  schemaVersion: typeof MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION;
  scoreBearingBundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[];
  wearableContextMetricKeys: string[];
  wearableDeferredFeatureKeys: string[];
  wearableFirstPriorityFeatureKeys: string[];
  wearableFirstPriorityMetricKeys: string[];
  wearableScoreBearingMetricKeys: string[];
  wearableSecondPriorityFeatureKeys: string[];
  wearableSecondPriorityMetricKeys: string[];
}

export interface MurphAgeInputBundleAssessmentInput {
  asOf?: string;
  points: readonly MetricPoint[];
}

export interface MurphAgeInputBundleFeatureStatus {
  featureKey: string;
  label: string;
  metricKeys: string[];
  requiredFor:
    | "function-context"
    | "l1-glycemia"
    | "l1b-glycemia-body"
    | "lab5-fallback"
    | "lab9-mainline"
    | "optional-context"
    | "r399-proxy-anchor"
    | "wearable-context";
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
    | "function_context_no_risk"
    | "l1b_glycemia_body_10y_acm_research"
    | "l1_tiny_glycemia_10y_acm_research"
    | "lab5_bp_bmi_transport_research"
    | "lab9_bp_body_10y_acm_research"
    | "none"
    | "r399_nhis_proxy_10y_acm_research"
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
  requiredFor: "function-context" | "wearable-context";
  selectedMetricKey: string | null;
  selectedPointIds: string[];
  status: "missing" | "ready";
}

export interface MurphAgeContextBundleAssessment extends Omit<MurphAgeInputBundleAssessment, "bundleId" | "featureStatuses"> {
  bundleId: "function-context" | "wearable-context";
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
  status: "blocked" | "imputed" | "missing" | "ready";
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

export type MurphAgeResearchCandidateCardBlockerCode =
  | "INPUT_BUNDLE_INCOMPLETE"
  | "LOCAL_MODEL_CARD_NOT_LOADED"
  | "PRODUCT_MODE_RESEARCH_ONLY"
  | "PROXY_FALLBACK_SUPPRESSED_BY_LAB_INTENT";

export interface MurphAgeResearchCandidateCardAssessment {
  availableFeatureKeys: string[];
  blockerCodes: MurphAgeResearchCandidateCardBlockerCode[];
  bundleId: MurphAgeInputBundleId;
  cardId: MurphAgeScoreBearingCardId;
  inputStatus: MurphAgeInputBundleStatus;
  missingFeatureKeys: string[];
  modelLoaded: boolean;
  selected: boolean;
  selectedMetricKeys: string[];
  warnings: MurphAgeWarning[];
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
  functionResidualLayerApplication: MurphAgeFunctionResidualLayerApplication | null;
  mode: MurphAgeCalculatorMode;
  researchCandidateCards: MurphAgeResearchCandidateCardAssessment[];
  result: MurphAgeResult | null;
  schemaVersion: typeof MURPH_AGE_RESULT_SCHEMA_VERSION;
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgeWarning[];
  wearableResidualLayerApplication: MurphAgeWearableResidualLayerApplication | null;
  wearableShadowIncrementAssessments: MurphAgeWearableShadowIncrementAssessment[];
}

interface MurphAgePrimaryBundleResolution {
  bundleAssessment: MurphAgeInputBundleAssessment;
  cardId: MurphAgeInputBundleAssessment["recommendedCardId"] | MurphAgeModelCardId;
}

export interface MurphAgePublicFeatureAttribution {
  contributionYears: number | null;
  featureKey: string;
  metricKey: string | null;
  moduleId: string;
  status: "blocked" | "imputed" | "missing" | "ready";
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicModuleAttribution {
  contributionYears: number | null;
  featureKeys: string[];
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

export interface MurphAgePublicInputFeatureReadiness {
  featureKey: string;
  metricKeys: string[];
  requiredFor: MurphAgeInputBundleFeatureStatus["requiredFor"];
  selectedMetricKey: string | null;
  status: "missing" | "ready";
}

export interface MurphAgePublicInputBundleReadiness {
  availableFeatureKeys: string[];
  bundleId: MurphAgeInputBundleId;
  featureStatuses: MurphAgePublicInputFeatureReadiness[];
  missingFeatureKeys: string[];
  recommendedCardId: MurphAgeInputBundleAssessment["recommendedCardId"];
  schemaVersion: typeof MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION;
  selectedMetricKeys: string[];
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicInputReadinessSummary {
  bundle: MurphAgePublicInputBundleReadiness;
  contextBundles: MurphAgePublicInputBundleReadiness[];
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

export interface MurphAgePublicResearchCandidateCardAssessment {
  availableFeatureKeys: string[];
  blockerCodes: MurphAgeResearchCandidateCardBlockerCode[];
  bundleId: MurphAgeInputBundleId;
  cardId: MurphAgeScoreBearingCardId;
  inputStatus: MurphAgeInputBundleStatus;
  missingFeatureKeys: string[];
  modelLoaded: boolean;
  selected: boolean;
  selectedMetricKeys: string[];
  warnings: MurphAgePublicWarning[];
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
  functionResidualLayer: MurphAgePublicFunctionResidualLayerView | null;
  inputReadiness: MurphAgePublicInputReadinessSummary;
  mode: MurphAgeCalculatorMode;
  researchCandidateCards: MurphAgePublicResearchCandidateCardAssessment[];
  result: MurphAgePublicResult | null;
  schemaVersion: typeof MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION;
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgePublicWarning[];
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}

export type MurphAgePublicCalculatorViewDisplayCategory =
  | "abstain"
  | "context-only"
  | "product-age-ready"
  | "product-risk-only"
  | "research-preview";

export type MurphAgePublicCalculatorScoreStatus =
  | "context-only-no-score"
  | "input-incomplete"
  | "research-estimate-withheld"
  | "validated-age-ready"
  | "validated-risk-only"
  | "validation-pending";

export type MurphAgePublicCalculatorUnlockRequirement =
  | "complete-score-bearing-inputs"
  | "external-outcome-validation"
  | "product-policy-authorization"
  | "risk-to-age-display-authorization"
  | "validated-wearable-parameter-pack";

export interface MurphAgePublicCalculatorScoreReadinessView {
  biologicalAgeAvailable: boolean;
  contextBundleIds: MurphAgeInputBundleId[];
  contextOnlyFeatureCount: number;
  inputBundleId: MurphAgeInputBundleId;
  missingScoreBearingFeatureCount: number;
  riskAvailable: boolean;
  scoreBearingFeatureCount: number;
  status: MurphAgePublicCalculatorScoreStatus;
  unlockRequirements: MurphAgePublicCalculatorUnlockRequirement[];
  wearableReadyFeatureCount: number;
}

export interface MurphAgePublicAgeEstimateView {
  ageDeltaYears: number | null;
  biologicalAgeYears: number | null;
  chronologicalAgeYears: number;
  intervalYears: { high: number; low: number } | null;
}

export interface MurphAgePublicRiskView {
  ageEstimateBasis: MurphAgeOutcomeContext["ageEstimateBasis"];
  horizonYears: MurphAgeOutcomeContext["horizonYears"];
  probability: number | null;
  riskEndpoint: MurphAgeOutcomeContext["riskEndpoint"];
}

export interface MurphAgePublicFeatureContributionView {
  contributionYears: number | null;
  featureKey: string;
  metricKey: string | null;
  moduleId: string;
  status: MurphAgePublicFeatureAttribution["status"];
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicDomainContributionView {
  contributionYears: number | null;
  featureKeys: string[];
  moduleId: string;
}

export type MurphAgePublicDriverDirection = "neutral" | "older" | "younger";

export interface MurphAgePublicDriverView extends MurphAgePublicFeatureContributionView {
  absoluteContributionYears: number;
  direction: MurphAgePublicDriverDirection;
}

export interface MurphAgePublicDriverSummaryView {
  neutral: MurphAgePublicDriverView[];
  older: MurphAgePublicDriverView[];
  younger: MurphAgePublicDriverView[];
}

export interface MurphAgePublicWearableCalculatorView {
  candidateFeatureCount: number;
  contextOnlyMetricKeys: string[];
  deferredFeatureKeys: string[];
  features: MurphAgePublicWearableBridgeFeatureReadiness[];
  firstPriorityIncompleteFeatureKeys: string[];
  firstPriorityReadyFeatureKeys: string[];
  missingFeatureKeys: string[];
  partialFeatureKeys: string[];
  quality: MurphAgePublicWearableContextSummary["quality"];
  readyFeatureKeys: string[];
  scoreBearing: false;
  scoreContributionAuthorized: false;
  scorePolicy: MurphAgeWearableScoreBearingStrategy;
  secondPriorityIncompleteFeatureKeys: string[];
  secondPriorityReadyFeatureKeys: string[];
}

export interface MurphAgePublicFunctionResidualLayerView {
  anchorCardId: MurphAgePublicAuthorization["cardId"];
  eligibleForResidualResearch: boolean;
  layerId: MurphAgeFunctionResidualLayerId;
  parameterPackHash: string | null;
  parameterizationAvailable: boolean;
  productAuthorized: false;
  residualDeltaYears: number | null;
  residualDeltaLogit: number;
  schemaVersion: typeof MURPH_AGE_FUNCTION_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectedMetricKeys: string[];
  status: MurphAgeFunctionResidualLayerApplicationStatus;
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicWearableResidualLayerView {
  anchorCardId: MurphAgePublicAuthorization["cardId"];
  anchorRiskAgeEquivalentYears: number | null;
  eligibleForResidualResearch: boolean;
  finalRiskAgeEquivalentYears: number | null;
  finalRiskProbability: number | null;
  layerId: MurphAgeWearableResidualLayerId;
  parameterPackHash: string | null;
  parameterizationAvailable: boolean;
  productAuthorized: false;
  residualDeltaYears: number | null;
  residualDeltaLogit: number;
  schemaVersion: typeof MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectedMetricKeys: string[];
  status: MurphAgeWearableResidualLayerApplicationStatus;
  warnings: MurphAgePublicWarning[];
}

export interface MurphAgePublicCalculatorView {
  ageEstimate: MurphAgePublicAgeEstimateView | null;
  blockedFeatureKeys: string[];
  displayCategory: MurphAgePublicCalculatorViewDisplayCategory;
  displayBlockedReason: MurphAgeDisplayBlockedReason | null;
  displayStatus: MurphAgeDisplayStatus;
  domainContributions: MurphAgePublicDomainContributionView[];
  featureContributions: MurphAgePublicFeatureContributionView[];
  featureDrivers: MurphAgePublicDriverSummaryView;
  missingFeatureKeys: string[];
  mode: MurphAgeCalculatorMode;
  product: {
    ageDisplayReady: boolean;
    promotionBlockers: MurphAgeProductPromotionBlocker[];
    riskDisplayReady: boolean;
    validationGate: MurphAgePublicValidationGateSummary | null;
  };
  risk: MurphAgePublicRiskView;
  schemaVersion: typeof MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION;
  scoreReadiness: MurphAgePublicCalculatorScoreReadinessView;
  selectedCardId: MurphAgePublicAuthorization["cardId"];
  selectedScoreBearingFeatureKeys: string[];
  selectedScoreBearingMetricKeys: string[];
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgePublicWarning[];
  wearable: MurphAgePublicWearableCalculatorView;
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}

export type MurphAgeResearchLocalRunEvidenceSignal =
  | "context-only"
  | "glycemia-only-better"
  | "partial"
  | "slight-lift"
  | "supported"
  | "weak";

export interface MurphAgeResearchLocalRunEvidenceItem {
  bundleId?: MurphAgeInputBundleId;
  cohortLabel: "CRELES" | "HAALSI" | "MHAS" | "MIDUS" | "NSHAP" | "wearables";
  evidenceId:
    | "creles-glycemia-transport-local-run"
    | "haalsi-glucose-transport-local-run"
    | "mhas-function-mobility-sidecar-local-run"
    | "midus-lab-lift-local-run"
    | "nshap-hba1c-transport-local-run"
    | "wearables-context-only-local-run";
  productAuthorizationChanged: false;
  scoringMathChanged: false;
  signal: MurphAgeResearchLocalRunEvidenceSignal;
  sourceRouteId?: MurphAgeSourceRouteId;
  summary: string;
  supportedMetricKeys: string[];
}

export type MurphAgeResearchLayerId =
  | "function-disability-sidecar"
  | "r399-outcome-risk-anchor"
  | "selected-lab-body-card"
  | "wearable-activity-residual"
  | "wearable-multi-family-residual";

export type MurphAgeResearchLayerRole =
  | "base-outcome-risk"
  | "function-mobility-residual"
  | "lab-body-risk-adjuster"
  | "wearable-activity-residual"
  | "wearable-multi-family-residual";

export type MurphAgeResearchLayerStatus =
  | "active-research-score"
  | "active-research-shadow-score"
  | "available-as-anchor"
  | "available-research-candidate"
  | "parameter-pack-available-shadow-only"
  | "parameter-pack-needed"
  | "validation-receipt-needed";

export interface MurphAgeResearchLayerContractItem {
  combinationScale: "risk-logit" | "risk-logit-residual";
  layerId: MurphAgeResearchLayerId;
  metricKeys: string[];
  parameterPackAvailable: boolean;
  parameterPackRequired: boolean;
  productAuthorized: false;
  role: MurphAgeResearchLayerRole;
  scoreBearingNow: boolean;
  scoreContributionAuthorized: false;
  selected: boolean;
  sourceEvidenceIds: Array<MurphAgeResearchLocalRunEvidenceItem["evidenceId"]>;
  status: MurphAgeResearchLayerStatus;
  validationStillNeeded: boolean;
}

export interface MurphAgeResearchLayeredPathStatus {
  activeResearchScoreLayerIds: MurphAgeResearchLayerId[];
  architecturePattern: "frozen-r399-anchor-plus-selected-lab-card-plus-function-and-wearable-residuals";
  currentExecutableMode:
    | "single-card-plus-parameterized-residual-shadow-score"
    | "single-card-research-score-layer-contracts-only";
  layerOrder: MurphAgeResearchLayerId[];
  layers: MurphAgeResearchLayerContractItem[];
  parameterPackBlockedLayerIds: MurphAgeResearchLayerId[];
  productAuthorized: false;
  scoreCombinationScale: "risk-logit-residual";
}

export interface MurphAgeResearchModelStatusView {
  blockers: Array<
    | "biomarker-transport-not-confirmed"
    | "product-use-not-authorized"
    | "wearable-increment-not-validated"
  >;
  contextOnlyMetricKeys: string[];
  currentModelFamily: "frozen-nhis-r399-plus-research-increments";
  composition: {
    anchorLayerStatus: "available-as-research-anchor-and-fallback-not-layered";
    currentScoringMode:
      | "single-selected-research-card"
      | "selected-card-plus-parameterized-residual-shadow";
    labBodyStatus: "selected-card-score-not-additive-increment";
    nextArchitectureStep:
      | "parameterize-function-sidecar-for-layered-scoring"
      | "validate-function-sidecar-and-wearable-residuals-before-product-use";
    wearableStatus:
      | "context-only-zero-product-multiplier"
      | "research-shadow-residual-score-product-blocked";
  };
  functionDisability: {
    currentUse: "hardened-research-lead-sidecar-not-product-age";
    nextAction: "parameterize-function-sidecar-for-layered-scoring-then-fresh-validation";
    scoreBearing: false;
  };
  labBody: {
    currentUse: "score-bearing-research-when-selected";
    nextAction: "validate-transport-before-product-use";
    transportStatus: "internal-promising-transport-not-confirmed";
  };
  latestLocalRunEvidence: MurphAgeResearchLocalRunEvidenceItem[];
  latestLocalRunEvidenceStatus: "mixed-research-only-no-product-promotion";
  layeredResearchPath: MurphAgeResearchLayeredPathStatus;
  productUseAuthorized: false;
  scoreBearingFeatureKeys: string[];
  scoreBearingMetricKeys: string[];
  scoreInterpretation: "risk-age-equivalent-research-only";
  selectedResearchCardId: MurphAgePublicAuthorization["cardId"];
  wearable: {
    consumerValidationStatus: "missing";
    currentUse: "context-only-shadow" | "research-shadow-residual-score";
    externalConsumerLabWearableAggregateStillMissing: true;
    nextAction: MurphAgePublicLabWearableShadowEvidenceNextAction;
    nextExternalOrPartnerRouteIdsByPriority: MurphAgeSourceRouteId[];
    researchScoreBearing: boolean;
    scoreBearing: false;
    scoreContributionAuthorized: false;
    shadowEvidenceConclusion: MurphAgePublicLabWearableShadowEvidenceConclusion;
    shadowEvidencePacketIds: MurphAgePublicLabWearableShadowEvidencePacketId[];
    usableAsConsumerWearableValidation: false;
  };
}

export type MurphAgeResearchCardRole =
  | "current-alpha-glycemia-body-core"
  | "minimal-glycemia-first-pass"
  | "outcome-risk-anchor-and-fallback"
  | "primary-lab-bp-body-adjuster"
  | "transport-fallback-and-discordance-guard";

export type MurphAgeResearchArbiterSelectionReason =
  | "anchor-selected"
  | "current-alpha-glycemia-body-selected"
  | "minimal-glycemia-selected"
  | "no-score-bearing-card-selected"
  | "primary-lab-card-selected"
  | "transport-fallback-selected";

export interface MurphAgeResearchArbiterCandidateCardView extends MurphAgePublicResearchCandidateCardAssessment {
  readyForResearchRun: boolean;
  role: MurphAgeResearchCardRole;
}

export interface MurphAgeResearchArbiterView {
  candidateCards: MurphAgeResearchArbiterCandidateCardView[];
  labConflictPolicy: "l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-guard-r399-anchor-fallback";
  selectedCardRole: MurphAgeResearchCardRole | null;
  selectionReason: MurphAgeResearchArbiterSelectionReason;
  strategy: "r399-anchor-l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-function-sidecar-wearables-context";
  wearableScorePolicy: "context-only-not-score-bearing" | "research-residual-shadow-product-blocked";
}

export type MurphAgeResearchLayeredAgeEstimateStatus =
  | "multi-residual-shadow-applied"
  | "selected-card-only"
  | "wearable-shadow-applied";

export interface MurphAgeResearchLayeredAgeEstimateView {
  ageDeltaYears: number | null;
  appliedLayerIds: MurphAgeResearchLayerId[];
  basis: "residual-shadow-risk-age" | "selected-card-risk-age" | "wearable-shadow-risk-age";
  biologicalAgeYears: number | null;
  chronologicalAgeYears: number;
  intervalYears: { high: number; low: number } | null;
  productAuthorized: false;
  residualDeltaYears: number | null;
  residualScoreContributionAuthorized: false;
  riskProbability: number | null;
  status: MurphAgeResearchLayeredAgeEstimateStatus;
  uncertaintyStatus: "not-reestimated-for-shadow" | "selected-card-interval";
}

export interface MurphAgeResearchCalculatorView {
  ageEstimate: MurphAgePublicAgeEstimateView | null;
  arbiter: MurphAgeResearchArbiterView;
  blockedFeatureKeys: string[];
  displayBlockedReason: MurphAgeDisplayBlockedReason | null;
  displayStatus: MurphAgeDisplayStatus;
  domainContributions: MurphAgePublicDomainContributionView[];
  featureContributions: MurphAgePublicFeatureContributionView[];
  featureDrivers: MurphAgePublicDriverSummaryView;
  functionResidualLayer: MurphAgePublicFunctionResidualLayerView | null;
  missingFeatureKeys: string[];
  mode: MurphAgeCalculatorMode;
  model: MurphAgeResearchModelStatusView;
  layeredAgeEstimate: MurphAgeResearchLayeredAgeEstimateView | null;
  product: {
    ageDisplayReady: boolean;
    promotionBlockers: MurphAgeProductPromotionBlocker[];
    productUseAuthorized: false;
    riskDisplayReady: boolean;
    validationGate: MurphAgePublicValidationGateSummary | null;
  };
  researchOnly: true;
  risk: MurphAgePublicRiskView;
  schemaVersion: typeof MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION;
  selectedCardId: MurphAgePublicAuthorization["cardId"];
  selectedScoreBearingFeatureKeys: string[];
  selectedScoreBearingMetricKeys: string[];
  status: MurphAgeInputBundleStatus;
  warnings: MurphAgePublicWarning[];
  wearable: MurphAgePublicWearableCalculatorView;
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}

export interface MurphAgeCalculatorReportAndView {
  report: MurphAgePublicCalculatorReport;
  view: MurphAgePublicCalculatorView;
}

export interface MurphAgeResearchCalculatorReportAndView {
  report: MurphAgePublicCalculatorReport;
  view: MurphAgeResearchCalculatorView;
}

export interface MurphAgeSubmittedCalculatorViewBundle {
  capabilities: MurphAgeSubmittedCalculatorCapabilitySummary;
  inputBundleSpecs: MurphAgeSubmittedCalculatorInputBundleSpec[];
  metricInputSpecs: MurphAgeSubmittedCalculatorMetricInputSpec[];
  product: MurphAgeCalculatorReportAndView;
  researchPreview: MurphAgeResearchCalculatorReportAndView | null;
  schemaVersion: typeof MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION;
}

export interface MurphAgeSubmittedCalculatorViewBundleOptions {
  includeResearchPreview?: boolean;
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
export type MurphAgeWearableShadowIncrementRiskEffect =
  | "aggregate-estimated"
  | "not-estimated";
export type MurphAgeWearableShadowIncrementStatus = "blocked" | "missing" | "ready";
export type MurphAgeWearableShadowResultEvidenceTier =
  typeof MURPH_AGE_WEARABLE_SHADOW_RESULT_EVIDENCE_TIERS[number];
export type MurphAgeIncrementEvaluationEvidenceTier = MurphAgeWearableShadowResultEvidenceTier;
export type MurphAgeIncrementEvaluationLayer = typeof MURPH_AGE_INCREMENT_EVALUATION_LAYERS[number];
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
export type MurphAgeWearableBridgeMeasurementMethod =
  | "consumer-device"
  | "estimated-fitness"
  | "psg-or-ecg"
  | "research-actigraphy"
  | "self-report"
  | "unknown";
export type MurphAgeWearableBridgeSourceKind =
  | "activity-summary"
  | "sleep-summary"
  | "wearable-summary";
export type MurphAgeWearableBridgeCoverageRole = "day" | "night";
export type MurphAgeWearableBridgeQualityMetricRole =
  | "coverage"
  | MurphAgeWearableBridgeCoverageRole;
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
  measurementMethod: MurphAgeWearableBridgeMeasurementMethod;
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
  productPromotionBlockers: MurphAgeProductPromotionBlocker[];
  productRiskDisplayReady: boolean;
  researchEstimateAvailable: boolean;
  schemaVersion: typeof MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION;
  selectedScoreBearingFeatureKeys: string[];
  selectedScoreBearingMetricKeys: string[];
  selectedScoreBearingPointIds: string[];
  validationGate: MurphAgeValidationGateSummary | null;
  wearableBridge: MurphAgeWearableBridgeSummary;
  wearableContext: MurphAgeWearableContextSummary;
}

export interface MurphAgePublicDisplaySummary extends Omit<
  MurphAgeDisplaySummary,
  | "contextOnlyPointIds"
  | "schemaVersion"
  | "selectedScoreBearingPointIds"
  | "validationGate"
  | "wearableBridge"
  | "wearableContext"
> {
  schemaVersion: typeof MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION;
  validationGate: MurphAgePublicValidationGateSummary | null;
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

export interface MurphAgeWearableShadowIncrementOutputBoundaryCandidate {
  aggregateOnly: boolean;
  coefficientsExportAllowed: boolean;
  participantLevelExportAllowed: boolean;
  predictionsExportAllowed: boolean;
  productDisplayExportAllowed: boolean;
  rowValuesExportAllowed: boolean;
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

export interface MurphAgeWearableShadowIncrementAggregateMetricDeltas {
  aucDelta?: number;
  brierDelta?: number;
  calibrationInterceptDelta?: number;
  calibrationSlopeDelta?: number;
  cIndexDelta?: number;
  logLossDelta?: number;
}

export interface MurphAgeWearableShadowIncrementAggregateSampleSummary {
  evaluatedRowCount?: number;
  eventCount?: number;
  minimumCellCount?: number;
  subgroupCount?: number;
  suppressedCellCount?: number;
}

export interface MurphAgeWearableShadowIncrementResultEvaluation {
  aggregateMetricDeltas: MurphAgeWearableShadowIncrementAggregateMetricDeltas;
  aggregateSample?: MurphAgeWearableShadowIncrementAggregateSampleSummary;
  comparator: "anchor-vs-anchor-plus-wearable-shadow-increment";
  evidenceTier: MurphAgeWearableShadowResultEvidenceTier;
  sameDenominator: boolean;
}

export interface MurphAgeWearableShadowIncrementResultEvaluationCandidate {
  aggregateMetricDeltas: MurphAgeWearableShadowIncrementAggregateMetricDeltas;
  aggregateSample?: MurphAgeWearableShadowIncrementAggregateSampleSummary;
  comparator: string;
  evidenceTier: string;
  sameDenominator: boolean;
}

export interface MurphAgeWearableShadowIncrementResultCardCandidate {
  anchorCardId: string;
  evaluation: MurphAgeWearableShadowIncrementResultEvaluationCandidate;
  family: string;
  outputBoundary: MurphAgeWearableShadowIncrementOutputBoundaryCandidate;
  productAuthorized: boolean;
  riskEffect: string;
  schemaVersion: string;
  scoreBearing: boolean;
  scoreContributionAuthorized: boolean;
  sourceRouteId: string;
}

export interface MurphAgeWearableShadowIncrementResultCard {
  anchorCardId: MurphAgeScoreBearingCardId;
  evaluation: MurphAgeWearableShadowIncrementResultEvaluation;
  family: MurphAgeWearableShadowIncrementFamily;
  outputBoundary: MurphAgeWearableShadowIncrementOutputBoundary;
  productAuthorized: false;
  riskEffect: MurphAgeWearableShadowIncrementRiskEffect;
  schemaVersion: typeof MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  sourceRouteId: string;
}

export interface MurphAgeIncrementEvaluationOutputBoundary {
  aggregateOnly: true;
  coefficientsExportAllowed: false;
  localArtifactPathExportAllowed: false;
  modelParametersExportAllowed: false;
  participantIdentifiersExportAllowed: false;
  participantLevelExportAllowed: false;
  predictionsExportAllowed: false;
  productDisplayExportAllowed: false;
  rowValuesExportAllowed: false;
  sourceTextExportAllowed: false;
  splitMembershipExportAllowed: false;
}

export interface MurphAgeIncrementEvaluationOutputBoundaryCandidate {
  aggregateOnly: boolean;
  coefficientsExportAllowed: boolean;
  localArtifactPathExportAllowed: boolean;
  modelParametersExportAllowed: boolean;
  participantIdentifiersExportAllowed: boolean;
  participantLevelExportAllowed: boolean;
  predictionsExportAllowed: boolean;
  productDisplayExportAllowed: boolean;
  rowValuesExportAllowed: boolean;
  sourceTextExportAllowed: boolean;
  splitMembershipExportAllowed: boolean;
}

export interface MurphAgeIncrementEvaluationAggregateMetricDeltas {
  aucDelta?: number;
  brierDelta?: number;
  calibrationInterceptDelta?: number;
  calibrationSlopeDelta?: number;
  cIndexDelta?: number;
  logLossDelta?: number;
}

export interface MurphAgeIncrementEvaluationAggregateMetricSummary {
  auc?: number | null;
  brier?: number;
  calibrationIntercept?: number;
  calibrationSlope?: number;
  cIndex?: number | null;
  events?: number;
  logLoss?: number;
  meanPrediction?: number;
  n?: number;
  observedRate?: number;
}

export interface MurphAgeIncrementEvaluationAggregateSampleSummary {
  evaluatedRowCount?: number;
  eventCount?: number;
  minimumCellCount?: number;
  subgroupCount?: number;
  suppressedCellCount?: number;
}

export interface MurphAgeIncrementEvaluation {
  aggregateMetricDeltas: MurphAgeIncrementEvaluationAggregateMetricDeltas;
  aggregateSample?: MurphAgeIncrementEvaluationAggregateSampleSummary;
  anchorMetrics?: MurphAgeIncrementEvaluationAggregateMetricSummary;
  candidateMetrics?: MurphAgeIncrementEvaluationAggregateMetricSummary;
  comparator: "anchor-vs-anchor-plus-increment";
  evidenceTier: MurphAgeIncrementEvaluationEvidenceTier;
  sameDenominator: boolean;
}

export interface MurphAgeIncrementEvaluationCandidate {
  aggregateMetricDeltas: MurphAgeIncrementEvaluationAggregateMetricDeltas;
  aggregateSample?: MurphAgeIncrementEvaluationAggregateSampleSummary;
  anchorMetrics?: MurphAgeIncrementEvaluationAggregateMetricSummary;
  candidateMetrics?: MurphAgeIncrementEvaluationAggregateMetricSummary;
  comparator: string;
  evidenceTier: string;
  sameDenominator: boolean;
}

export interface MurphAgeIncrementEvaluationCardCandidate {
  anchorCardId: string;
  candidateBatchId: string;
  candidateId: string;
  evaluation: MurphAgeIncrementEvaluationCandidate;
  flatteningAuthorized: boolean;
  layer: string;
  outputBoundary: MurphAgeIncrementEvaluationOutputBoundaryCandidate;
  productAuthorized: boolean;
  riskEffect: string;
  schemaVersion: string;
  scoreBearing: boolean;
  scoreContributionAuthorized: boolean;
  sourceRouteId: string;
}

export interface MurphAgeIncrementEvaluationCard {
  anchorCardId: MurphAgeScoreBearingCardId;
  candidateBatchId: string;
  candidateId: string;
  evaluation: MurphAgeIncrementEvaluation;
  flatteningAuthorized: false;
  layer: MurphAgeIncrementEvaluationLayer;
  outputBoundary: MurphAgeIncrementEvaluationOutputBoundary;
  productAuthorized: false;
  riskEffect: "aggregate-estimated" | "not-estimated";
  schemaVersion: typeof MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  sourceRouteId: string;
}

export interface MurphAgeIncrementEvaluationCardBuildInput {
  aggregateMetricDeltas: MurphAgeIncrementEvaluationAggregateMetricDeltas;
  aggregateSample?: MurphAgeIncrementEvaluationAggregateSampleSummary;
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorMetrics?: MurphAgeIncrementEvaluationAggregateMetricSummary;
  candidateBatchId: string;
  candidateId: string;
  candidateMetrics?: MurphAgeIncrementEvaluationAggregateMetricSummary;
  evidenceTier: MurphAgeIncrementEvaluationEvidenceTier;
  layer: MurphAgeIncrementEvaluationLayer;
  riskEffect: "aggregate-estimated" | "not-estimated";
  sourceRouteId: MurphAgeSourceRouteId;
}

export type MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateDeltaField =
  keyof MurphAgeIncrementEvaluationAggregateMetricDeltas;
export type MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateSampleField =
  keyof MurphAgeIncrementEvaluationAggregateSampleSummary;

export interface MurphAgeOrdinaryLabWearableAggregateEvidenceTemplate {
  acceptedAggregateMetricDeltaFields: MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateDeltaField[];
  anchorCardId: MurphAgeScoreBearingCardId;
  candidateBatchId: string;
  candidateId: string;
  flatteningAuthorized: false;
  layer: MurphAgeIncrementEvaluationLayer;
  outputBoundary: MurphAgeIncrementEvaluationOutputBoundary;
  productAuthorized: false;
  requiredAggregateSampleFields: MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateSampleField[];
  riskEffect: "aggregate-estimated";
  schemaVersion: typeof MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  sourceRouteId: MurphAgeSourceRouteId;
}

export interface MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateListInput {
  anchorCardId?: MurphAgeScoreBearingCardId;
  candidateBatchId?: string;
  layers?: readonly MurphAgeIncrementEvaluationLayer[];
  sourceRouteIds?: readonly MurphAgeSourceRouteId[];
}

export type MurphAgeOrdinaryLabWearableAggregateEvidenceStatus = "blocked" | "ready";

export interface MurphAgeOrdinaryLabWearableAggregateEvidenceAssessment {
  blockers: string[];
  routeId: string | null;
  status: MurphAgeOrdinaryLabWearableAggregateEvidenceStatus;
  validation: MurphAgeModelValidationResult;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeOrdinaryLabWearableAggregateEvidenceSummary {
  assessments: MurphAgeOrdinaryLabWearableAggregateEvidenceAssessment[];
  missingSourceRouteIds: MurphAgeSourceRouteId[];
  readyCardCount: number;
  readySourceRouteIds: MurphAgeSourceRouteId[];
  status: MurphAgeOrdinaryLabWearableAggregateEvidenceStatus;
}

export type MurphAgeWearableActivityBenchmarkCardId =
  | "nhanes_2003_06_hip_activity_lmf_v1"
  | "nhanes_2011_14_wrist_activity_lmf_v1";

export type MurphAgeWearableActivityBenchmarkAccelerometryProtocol =
  | "nhanes-2003-2006-hip-am7164-waking-7d"
  | "nhanes-2011-2014-wrist-gt3x-plus-24h-7d";

export type MurphAgeWearableActivityBenchmarkStatus =
  "locked-card-ready-for-local-adapter";

export type MurphAgeWearableActivityBenchmarkEvidenceClass =
  "public-same-family-shadow-benchmark";

export type MurphAgeWearableActivityBenchmarkFeatureFamily =
  | "activity-volume"
  | "intensity-pattern"
  | "sedentary-time"
  | "wearable-coverage-quality";

export type MurphAgeWearableActivityBenchmarkTransformId =
  | "activity-volume-after-lab-body-anchor"
  | "coverage-quality-control"
  | "intensity-pattern-after-age-sex"
  | "sedentary-time-after-coverage-control";

export type MurphAgeWearableActivityBenchmarkModelRole =
  | "age-sex-reference"
  | "coverage-quality-control"
  | "lab-body-anchor"
  | "residual-wearable-increment"
  | "wearable-activity-block"
  | "wearable-plus-coverage-control";

export interface MurphAgeWearableActivityBenchmarkDenominatorPolicy {
  adultAgeRangeYears: {
    max: number;
    min: number;
  };
  eligibleLinkedMortalityRequired: true;
  labBodyAnchorDenominatorRequired: true;
  objectiveActivityWindowRequired: true;
  publicUseRowsOnly: true;
  sameDenominatorRequired: true;
}

export interface MurphAgeWearableActivityBenchmarkSplitPolicy {
  aggregateSplitCountsExportOnly: true;
  frozenBeforeScoring: true;
  participantIdsExportAllowed: false;
  splitMembershipExportAllowed: false;
}

export interface MurphAgeWearableActivityBenchmarkModelStep {
  modelId: string;
  required: true;
  role: MurphAgeWearableActivityBenchmarkModelRole;
}

export interface MurphAgeWearableActivityBenchmarkNegativeControlPolicy {
  coverageOnlyControlRequired: true;
  earlyEventWashoutRequired: true;
  reverseCausationSensitivityRequired: true;
  shuffledWithinAgeSexBinsRequired: true;
}

export interface MurphAgeWearableActivityBenchmarkSelectionPolicy {
  calibrationFirst: true;
  discriminationOnlySelectionAllowed: false;
  properScoresRequired: true;
  sameDenominatorComparisonsRequired: true;
  testSetMutationAuthorized: false;
}

export interface MurphAgeWearableActivityBenchmarkCard {
  acceptedAggregateMetricDeltaFields: string[];
  accelerometryProtocol: MurphAgeWearableActivityBenchmarkAccelerometryProtocol;
  architecturePattern: "anchor-plus-wearable-residual-shadow";
  benchmarkId: MurphAgeWearableActivityBenchmarkCardId;
  benchmarkStatus: MurphAgeWearableActivityBenchmarkStatus;
  denominatorPolicy: MurphAgeWearableActivityBenchmarkDenominatorPolicy;
  endpoint: {
    endpointFamily: string;
    endpointFrozenBeforeScoring: true;
    horizonYears: number | null;
    indexDateRule: string;
    outcomeAscertainment: string;
    outcomeLinked: true;
    washoutDays: number;
  };
  evidenceClass: MurphAgeWearableActivityBenchmarkEvidenceClass;
  evidenceTierIfExecuted: string;
  featureFamilies: MurphAgeWearableActivityBenchmarkFeatureFamily[];
  measurementMethod: "research-actigraphy";
  modelLadder: MurphAgeWearableActivityBenchmarkModelStep[];
  negativeControlPolicy: MurphAgeWearableActivityBenchmarkNegativeControlPolicy;
  outputBoundary: MurphAgeIncrementEvaluationOutputBoundary;
  productAuthorized: false;
  requiredAggregateSampleFields: string[];
  rowParsingAuthorized: false;
  schemaVersion: typeof MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  selectionPolicy: MurphAgeWearableActivityBenchmarkSelectionPolicy;
  sourceRouteId: "nhanes-activity-shadow-lmf";
  splitPolicy: MurphAgeWearableActivityBenchmarkSplitPolicy;
  transformIds: MurphAgeWearableActivityBenchmarkTransformId[];
}

export type MurphAgeWearableLabAggregateReceiptModelId =
  typeof MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS[number];

export type MurphAgeWearableLabAggregateReceiptEndpointFamily =
  | "all-cause-mortality"
  | "cardiometabolic-event"
  | "cvd-event"
  | "ehr-event-burden"
  | "hospitalization-or-acute-event";

export type MurphAgeWearableLabAggregateReceiptIndexDateRule =
  | "baseline-exam-before-risk-window"
  | "feature-window-end-before-risk-window";

export type MurphAgeWearableLabAggregateReceiptOutcomeAscertainment =
  | "adjudicated-event"
  | "death-registry"
  | "ehr-event"
  | "registry-linked-event";

export type MurphAgeWearableLabAggregateReceiptCalibrationStatus =
  | "fail"
  | "not-reported"
  | "pass"
  | "warn";

export interface MurphAgeWearableLabAggregateReceiptEndpoint {
  endpointFamily: MurphAgeWearableLabAggregateReceiptEndpointFamily;
  endpointFrozenBeforeScoring: true;
  horizonYears: number | null;
  indexDateRule: MurphAgeWearableLabAggregateReceiptIndexDateRule;
  outcomeAscertainment: MurphAgeWearableLabAggregateReceiptOutcomeAscertainment;
  outcomeLinked: true;
  washoutDays: number;
}

export interface MurphAgeWearableLabAggregateReceiptDenominator {
  evaluatedRowCount: number;
  eventCount: number;
  minimumCellCount: number;
  personYears?: number;
  suppressedCellCount: number;
}

export interface MurphAgeWearableLabAggregateReceiptModelResult {
  calibrationStatus: MurphAgeWearableLabAggregateReceiptCalibrationStatus;
  metrics: MurphAgeIncrementEvaluationAggregateMetricSummary;
  modelId: MurphAgeWearableLabAggregateReceiptModelId;
}

export interface MurphAgeWearableLabAggregateReceiptNegativeControls {
  coverageOnlyBeatenByResidualWearable: boolean | null;
  deviceOrEhrDensityDominates: boolean | null;
  earlyEventSensitivityPassed: boolean | null;
  reverseCausationWashoutPassed: boolean | null;
}

export interface MurphAgeWearableLabAggregateReceipt {
  artifactBoundary: MurphAgeIncrementEvaluationOutputBoundary;
  denominator: MurphAgeWearableLabAggregateReceiptDenominator;
  endpoint: MurphAgeWearableLabAggregateReceiptEndpoint;
  evaluatorFrozenBeforeExecution: true;
  evidenceTier: MurphAgeIncrementEvaluationEvidenceTier;
  models: MurphAgeWearableLabAggregateReceiptModelResult[];
  negativeControls: MurphAgeWearableLabAggregateReceiptNegativeControls;
  productAuthorized: false;
  receiptId: string;
  sameDenominator: true;
  schemaVersion: typeof MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  sourceRouteId: MurphAgeSourceRouteId;
}

export interface MurphAgeWearableLabAggregateReceiptMetricDeltas {
  aucDelta: number | null;
  brierDelta: number | null;
  cIndexDelta: number | null;
  logLossDelta: number | null;
}

export type MurphAgeWearableLabAggregateReceiptConclusion =
  | "blocked"
  | "reviewgpt-science-delta"
  | "valid-no-delta";

export type MurphAgeWearableLabAggregateReceiptBlocker =
  | "calibration_not_acceptable"
  | "event_support_under_100"
  | "m5_does_not_beat_coverage_control"
  | "m5_does_not_improve_over_lab_body"
  | "negative_controls_not_passed"
  | "receipt_invalid";

export interface MurphAgeWearableLabAggregateReceiptEvaluationSummary {
  blockers: MurphAgeWearableLabAggregateReceiptBlocker[];
  conclusion: MurphAgeWearableLabAggregateReceiptConclusion;
  denominator: {
    evaluatedRowCount: number | null;
    eventCount: number | null;
    minimumCellCount: number | null;
  };
  m1ToM5Deltas: MurphAgeWearableLabAggregateReceiptMetricDeltas | null;
  m2ToM5Deltas: MurphAgeWearableLabAggregateReceiptMetricDeltas | null;
  modelIdsPresent: MurphAgeWearableLabAggregateReceiptModelId[];
  productAuthorized: false;
  reviewGptRequired: boolean;
  schemaVersion: typeof MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION;
  scoreBearingPromotionAuthorized: false;
  sourceRouteId: MurphAgeSourceRouteId | null;
  validation: MurphAgeModelValidationResult;
  wearableScoreBearingAuthorized: false;
}

export interface MurphAgeWearableLabAggregateReceiptTemplate {
  artifactBoundary: MurphAgeIncrementEvaluationOutputBoundary;
  denominator: {
    minimumEventCountForScienceDelta: 100;
    optionalFields: "personYears"[];
    requiredFields: Array<"evaluatedRowCount" | "eventCount" | "minimumCellCount" | "suppressedCellCount">;
    smallCellSuppressionRequired: true;
  };
  endpoint: {
    acceptedEndpointFamilies: MurphAgeWearableLabAggregateReceiptEndpointFamily[];
    acceptedIndexDateRules: MurphAgeWearableLabAggregateReceiptIndexDateRule[];
    acceptedOutcomeAscertainments: MurphAgeWearableLabAggregateReceiptOutcomeAscertainment[];
    endpointFrozenBeforeScoringRequired: true;
    outcomeLinkedRequired: true;
  };
  evaluatorFrozenBeforeExecutionRequired: true;
  evidenceTierOptions: MurphAgeIncrementEvaluationEvidenceTier[];
  metricFields: Array<
    | "auc"
    | "brier"
    | "calibrationIntercept"
    | "calibrationSlope"
    | "cIndex"
    | "events"
    | "logLoss"
    | "meanPrediction"
    | "n"
    | "observedRate"
  >;
  modelIds: MurphAgeWearableLabAggregateReceiptModelId[];
  negativeControlFields: Array<
    | "coverageOnlyBeatenByResidualWearable"
    | "deviceOrEhrDensityDominates"
    | "earlyEventSensitivityPassed"
    | "reverseCausationWashoutPassed"
  >;
  productAuthorized: false;
  receiptSchemaVersion: typeof MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION;
  sameDenominatorRequired: true;
  schemaVersion: typeof MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION;
  scoreBearing: false;
  scoreContributionAuthorized: false;
  sourceRouteAliases: string[];
  sourceRouteId: MurphAgeSourceRouteId;
}

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SOURCE_ROUTE_ALIASES: Readonly<Record<string, MurphAgeSourceRouteId>> = {
  all_of_us_workbench_aggregate: "all-of-us-fitbit-labs-ehr",
  cardia_authorized_or_aggregate: "cardia-biomarker-activity",
  hchs_sol_biomarker_activity_support: "hchs-sol-biomarker-activity",
  hunt_activity_sensor_biobank_candidate: "hunt-activity-sensor-biobank",
  lifelines_activelife_biobank_candidate: "lifelines-activelife-biobank",
  mipact_apple_watch_ehr_candidate: "mipact-apple-watch-ehr",
  nako_accelerometer_biobank_candidate: "nako-accelerometer-biobank",
  partner_aggregate_evaluator: "partner-aggregate-evaluator",
} as const;

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
  measurementMethod: MurphAgeWearableBridgeMeasurementMethod;
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

export interface MurphAgeWearableBridgeMetricSourceHint {
  defaultSourceKind: MurphAgeWearableBridgeSourceKind;
  featureKeys: string[];
  metricKey: string;
  qualityMetricRole: MurphAgeWearableBridgeQualityMetricRole | null;
  sourceKinds: MurphAgeWearableBridgeSourceKind[];
  validDaySourceKinds: MurphAgeWearableBridgeSourceKind[];
  validNightSourceKinds: MurphAgeWearableBridgeSourceKind[];
  validObservationRoles: MurphAgeWearableBridgeCoverageRole[];
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

const MURPH_AGE_L1_GLYCEMIA_FEATURES = [
  { featureKey: "glycemia", label: "Glycemia", metricKeys: ["hba1c", "glucose"], requiredFor: "l1-glycemia" },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_L1B_GLYCEMIA_BODY_FEATURES = [
  { featureKey: "glycemia", label: "Glycemia", metricKeys: ["hba1c", "glucose"], requiredFor: "l1b-glycemia-body" },
  { featureKey: "bmi", label: "BMI", metricKeys: ["bmi"], requiredFor: "l1b-glycemia-body" },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_WEARABLE_CONTEXT_FEATURES = [
  { featureKey: "steps", label: "Steps", metricKeys: ["steps"], requiredFor: "wearable-context" },
  { featureKey: "activity-minutes", label: "Activity minutes", metricKeys: ["activity-minutes"], requiredFor: "wearable-context" },
  { featureKey: "mvpa-minutes", label: "MVPA", metricKeys: ["mvpa-minutes"], requiredFor: "wearable-context" },
  {
    featureKey: "peak-30-minute-cadence",
    label: "Peak 30-minute cadence",
    metricKeys: ["peak-30-minute-cadence"],
    requiredFor: "wearable-context",
  },
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
    featureKey: "deep-sleep-minutes",
    label: "Deep sleep",
    metricKeys: ["deep-sleep-minutes"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "rem-sleep-minutes",
    label: "REM sleep",
    metricKeys: ["rem-sleep-minutes"],
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
    featureKey: "sleep-score",
    label: "Sleep score",
    metricKeys: ["sleep-score"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-midpoint-variability-minutes",
    label: "Sleep timing variability",
    metricKeys: ["sleep-midpoint-variability-minutes"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-spo2",
    label: "Sleep SpO2",
    metricKeys: ["spo2"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "sleep-respiratory-rate",
    label: "Sleep respiratory rate",
    metricKeys: ["respiratory-rate"],
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
    featureKey: "readiness-score",
    label: "Readiness score",
    metricKeys: ["readiness-score"],
    requiredFor: "wearable-context",
  },
  {
    featureKey: "skin-temperature-deviation",
    label: "Skin temperature deviation",
    metricKeys: ["skin-temperature-deviation"],
    requiredFor: "wearable-context",
  },
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

const MURPH_AGE_FUNCTION_CONTEXT_FEATURES = [
  {
    featureKey: "adl-limitations",
    label: "ADL limitations",
    metricKeys: ["adl-limitation-count"],
    requiredFor: "function-context",
  },
  {
    featureKey: "iadl-limitations",
    label: "IADL limitations",
    metricKeys: ["iadl-limitation-count"],
    requiredFor: "function-context",
  },
  {
    featureKey: "mobility-limitations",
    label: "Mobility limitations",
    metricKeys: ["mobility-limitation-count"],
    requiredFor: "function-context",
  },
  {
    featureKey: "frailty-symptoms",
    label: "Frailty symptoms",
    metricKeys: ["frailty-symptom-count"],
    requiredFor: "function-context",
  },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_R399_PROXY_SOURCE_KINDS = [
  "measurement",
  "profile",
  "questionnaire",
  "survey-response",
  "test-result",
] as const;

const MURPH_AGE_R399_PROXY_FEATURES = [
  { featureKey: "bmi", label: "BMI", metricKeys: ["bmi"], requiredFor: "r399-proxy-anchor" },
  {
    featureKey: "self-rated-health",
    label: "Self-rated health",
    metricKeys: ["self-rated-health"],
    requiredFor: "r399-proxy-anchor",
  },
  {
    featureKey: "hypertension-history",
    label: "Hypertension history",
    metricKeys: ["hypertension-history-proxy-yes"],
    requiredFor: "r399-proxy-anchor",
  },
  {
    featureKey: "diabetes-history",
    label: "Diabetes history",
    metricKeys: ["diabetes-history-proxy-yes"],
    requiredFor: "r399-proxy-anchor",
  },
  {
    featureKey: "smoking-status",
    label: "Smoking status",
    metricKeys: ["smoking-status-proxy"],
    requiredFor: "r399-proxy-anchor",
  },
  {
    featureKey: "physical-activity-proxy",
    label: "Physical activity proxy",
    metricKeys: ["physical-activity-proxy"],
    requiredFor: "r399-proxy-anchor",
  },
] satisfies readonly MurphAgeInputFeatureRequirement[];

const MURPH_AGE_INPUT_FEATURE_REQUIREMENTS: readonly MurphAgeInputFeatureRequirement[] = [
  ...MURPH_AGE_LAB9_FEATURES,
  ...MURPH_AGE_BP_BODY_FEATURES,
  ...MURPH_AGE_LAB5_FEATURES,
  ...MURPH_AGE_R399_PROXY_FEATURES,
  ...MURPH_AGE_WEARABLE_CONTEXT_FEATURES,
  ...MURPH_AGE_FUNCTION_CONTEXT_FEATURES,
];

const MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES = {
  activity: [
    "activity-minutes",
    "estimated-vo2-max",
    "mvpa-minutes",
    "peak-30-minute-cadence",
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
    "readiness-score",
    "resting-heart-rate",
    "skin-temperature-deviation",
  ],
  sleep: [
    "deep-sleep-minutes",
    "rem-sleep-minutes",
    "sleep-respiratory-rate",
    "sleep-duration-variability-minutes",
    "sleep-efficiency",
    "sleep-midpoint-variability-minutes",
    "sleep-regularity-score",
    "sleep-score",
    "sleep-spo2",
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

const MURPH_AGE_WEARABLE_DAY_COVERAGE_OBSERVATION_METRIC_KEYS = [
  "activity-minutes",
  "estimated-vo2-max",
  "mvpa-minutes",
  "peak-30-minute-cadence",
  "sedentary-minutes",
  "steps",
] as const;

const MURPH_AGE_WEARABLE_NIGHT_COVERAGE_OBSERVATION_METRIC_KEYS = [
  "deep-sleep-minutes",
  "rem-sleep-minutes",
  "respiratory-rate",
  "sleep-duration-variability-minutes",
  "sleep-efficiency",
  "sleep-midpoint-variability-minutes",
  "sleep-regularity-score",
  "sleep-score",
  "spo2",
  "total-sleep-minutes",
] as const;

const MURPH_AGE_WEARABLE_SLEEP_SUMMARY_ONLY_NIGHT_COVERAGE_OBSERVATION_METRIC_KEYS = [
  "hrv-rmssd",
] as const;

const MURPH_AGE_WEARABLE_DAY_COVERAGE_OBSERVATION_SOURCE_KINDS = [
  "activity-summary",
  "wearable-summary",
] as const satisfies readonly MurphAgeWearableBridgeSourceKind[];

const MURPH_AGE_WEARABLE_NIGHT_COVERAGE_OBSERVATION_SOURCE_KINDS = [
  "sleep-summary",
  "wearable-summary",
] as const satisfies readonly MurphAgeWearableBridgeSourceKind[];

const MURPH_AGE_WEARABLE_SLEEP_SUMMARY_ONLY_NIGHT_COVERAGE_OBSERVATION_SOURCE_KINDS = [
  "sleep-summary",
] as const satisfies readonly MurphAgeWearableBridgeSourceKind[];

const MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY = {
  aggregateOnly: true,
  coefficientsExportAllowed: false,
  participantLevelExportAllowed: false,
  predictionsExportAllowed: false,
  productDisplayExportAllowed: false,
  rowValuesExportAllowed: false,
} satisfies MurphAgeWearableShadowIncrementOutputBoundary;

const MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY = {
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
} satisfies MurphAgeIncrementEvaluationOutputBoundary;

const MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_DELTA_FIELDS = [
  "aucDelta",
  "brierDelta",
  "calibrationInterceptDelta",
  "calibrationSlopeDelta",
  "cIndexDelta",
  "logLossDelta",
] as const satisfies readonly MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateDeltaField[];

const MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SAMPLE_FIELDS = [
  "evaluatedRowCount",
  "eventCount",
  "minimumCellCount",
] as const satisfies readonly MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateSampleField[];

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_REQUIRED_DENOMINATOR_FIELDS = [
  "evaluatedRowCount",
  "eventCount",
  "minimumCellCount",
  "suppressedCellCount",
] as const;

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OPTIONAL_DENOMINATOR_FIELDS = [
  "personYears",
] as const;

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_METRIC_FIELDS = [
  "auc",
  "brier",
  "calibrationIntercept",
  "calibrationSlope",
  "cIndex",
  "events",
  "logLoss",
  "meanPrediction",
  "n",
  "observedRate",
] as const;

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_NEGATIVE_CONTROL_FIELDS = [
  "coverageOnlyBeatenByResidualWearable",
  "deviceOrEhrDensityDominates",
  "earlyEventSensitivityPassed",
  "reverseCausationWashoutPassed",
] as const;

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_FEATURE_FAMILIES = [
  "activity-volume",
  "intensity-pattern",
  "sedentary-time",
  "wearable-coverage-quality",
] as const satisfies readonly MurphAgeWearableActivityBenchmarkFeatureFamily[];

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_TRANSFORM_IDS = [
  "coverage-quality-control",
  "activity-volume-after-lab-body-anchor",
  "sedentary-time-after-coverage-control",
  "intensity-pattern-after-age-sex",
] as const satisfies readonly MurphAgeWearableActivityBenchmarkTransformId[];

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_MODEL_LADDER = [
  {
    modelId: "m0-anchor-only",
    required: true,
    role: "age-sex-reference",
  },
  {
    modelId: "m1-anchor-plus-lab-body-bp",
    required: true,
    role: "lab-body-anchor",
  },
  {
    modelId: "m2-coverage-device-ehr-density-control",
    required: true,
    role: "coverage-quality-control",
  },
  {
    modelId: "m3-wearable-residual",
    required: true,
    role: "wearable-activity-block",
  },
  {
    modelId: "m4-wearable-plus-coverage",
    required: true,
    role: "wearable-plus-coverage-control",
  },
  {
    modelId: "m5-residualized-wearable-after-controls",
    required: true,
    role: "residual-wearable-increment",
  },
] as const satisfies readonly MurphAgeWearableActivityBenchmarkModelStep[];

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_DEFINITIONS = [
  {
    accelerometryProtocol: "nhanes-2003-2006-hip-am7164-waking-7d",
    benchmarkId: "nhanes_2003_06_hip_activity_lmf_v1",
  },
  {
    accelerometryProtocol: "nhanes-2011-2014-wrist-gt3x-plus-24h-7d",
    benchmarkId: "nhanes_2011_14_wrist_activity_lmf_v1",
  },
] as const satisfies ReadonlyArray<{
  accelerometryProtocol: MurphAgeWearableActivityBenchmarkAccelerometryProtocol;
  benchmarkId: MurphAgeWearableActivityBenchmarkCardId;
}>;

const MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS = [
  "l1b_glycemia_body_10y_acm_research",
  "lab9_bp_body_10y_acm_research",
  "lab5_bp_bmi_transport_research",
  "l1_tiny_glycemia_10y_acm_research",
] satisfies readonly MurphAgeScoreBearingCardId[];

const MURPH_AGE_FUNCTION_RESIDUAL_ANCHOR_CARD_IDS = [
  "l1b_glycemia_body_10y_acm_research",
  "lab9_bp_body_10y_acm_research",
  "lab5_bp_bmi_transport_research",
  "l1_tiny_glycemia_10y_acm_research",
  "r399_nhis_proxy_10y_acm_research",
] satisfies readonly MurphAgeScoreBearingCardId[];

export function listMurphAgeWearableShadowAnchorCardIds(): MurphAgeScoreBearingCardId[] {
  return [...MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS];
}

export function isMurphAgeWearableShadowAnchorCardId(value: string): value is MurphAgeScoreBearingCardId {
  return (MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS as readonly string[]).includes(value);
}

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
    measurementMethod: "consumer-device",
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
    measurementMethod: "consumer-device",
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
    evidenceSummary: "Peak cadence captures movement intensity in a device-portable way and is evaluated with activity volume before richer heart-rate or sleep signals.",
    family: "activity",
    featureKey: "activity-intensity-pattern",
    label: "Activity intensity pattern",
    measurementWindowDays: [28],
    measurementMethod: "consumer-device",
    methodQualifier: "recommended",
    metricKeys: ["peak-30-minute-cadence"],
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
    measurementMethod: "consumer-device",
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
    measurementMethod: "consumer-device",
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
    measurementMethod: "consumer-device",
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
    measurementMethod: "consumer-device",
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
    measurementMethod: "estimated-fitness",
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

const MURPH_AGE_WEARABLE_BRIDGE_METRIC_SOURCE_HINTS =
  buildWearableBridgeMetricSourceHints();

const MURPH_AGE_WEARABLE_SCORE_BEARING_FAMILY_POLICIES = [
  {
    currentUse: "quality-gate-only",
    family: "quality",
    minimumValidDays28d: 14,
    minimumValidNights28d: 14,
    productAuthorized: false,
    productMultiplier: 0,
    qualityMetricKeys: [],
    requiresDeviceOrMethodQualification: false,
    researchMultiplier: 0,
    scoreBearingPromotionPriority: "first",
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "wearable-coverage-index",
      "wearable-valid-day-count-28d",
      "wearable-valid-night-count-28d",
    ],
  },
  {
    currentUse: "shadow-residual-research",
    family: "activity",
    minimumValidDays28d: 14,
    minimumValidNights28d: null,
    productAuthorized: false,
    productMultiplier: 0,
    qualityMetricKeys: [...MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS],
    requiresDeviceOrMethodQualification: false,
    researchMultiplier: 1,
    scoreBearingPromotionPriority: "first",
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "steps",
      "activity-minutes",
      "mvpa-minutes",
      "peak-30-minute-cadence",
      "sedentary-minutes",
    ],
  },
  {
    currentUse: "shadow-residual-research",
    family: "sleep",
    minimumValidDays28d: null,
    minimumValidNights28d: 14,
    productAuthorized: false,
    productMultiplier: 0,
    qualityMetricKeys: [...MURPH_AGE_WEARABLE_NIGHT_QUALITY_METRIC_KEYS],
    requiresDeviceOrMethodQualification: true,
    researchMultiplier: 1,
    scoreBearingPromotionPriority: "third",
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "total-sleep-minutes",
      "sleep-duration-variability-minutes",
      "sleep-regularity-score",
      "sleep-midpoint-variability-minutes",
    ],
  },
  {
    currentUse: "shadow-residual-research",
    family: "resting-heart-rate",
    minimumValidDays28d: 10,
    minimumValidNights28d: null,
    productAuthorized: false,
    productMultiplier: 0,
    qualityMetricKeys: [...MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS],
    requiresDeviceOrMethodQualification: true,
    researchMultiplier: 1,
    scoreBearingPromotionPriority: "second",
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "resting-heart-rate",
    ],
  },
  {
    currentUse: "context-only",
    family: "hrv",
    minimumValidDays28d: null,
    minimumValidNights28d: null,
    productAuthorized: false,
    productMultiplier: 0,
    qualityMetricKeys: [...MURPH_AGE_WEARABLE_DAY_QUALITY_METRIC_KEYS],
    requiresDeviceOrMethodQualification: true,
    researchMultiplier: 0,
    scoreBearingPromotionPriority: "defer",
    scoreContributionAuthorized: false,
    signalMetricKeys: [
      "hrv-rmssd",
    ],
  },
] satisfies readonly MurphAgeWearableScoreBearingFamilyPolicy[];

const MURPH_AGE_MODEL_CARD_POLICIES: readonly MurphAgeModelCardPolicy[] = [
  {
    acceptedBundleIds: ["function-context"],
    cardId: "function_context_no_risk",
    evidenceClass: "context-only",
    evidenceSummary: "Function limitation and disability inputs are the lead bounded research sidecar candidate, but they are not product-authorized and have no fitted score contribution yet.",
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
      summary: "Function sidecar evidence is supportive for research direction only; fitted parameters and fresh validation are still required before scoring.",
    },
    wearableScoreBearingAuthorized: false,
  },
  {
    acceptedBundleIds: ["r399-nhis-proxy-anchor"],
    cardId: "r399_nhis_proxy_10y_acm_research",
    evidenceClass: "research-internal",
    evidenceSummary: "Frozen NHIS/R399 proxy outcome-risk anchor; research-only base model for later biomarker and wearable increments.",
    outcome: {
      ageEstimateBasis: "risk-age-equivalent",
      horizonYears: 10,
      modelEndpoint: "10-year all-cause mortality",
      riskEndpoint: "all-cause-mortality",
    },
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: true,
    scoreBearingMetricKeys: MURPH_AGE_R399_PROXY_FEATURES.flatMap((feature) => feature.metricKeys),
    scoreBearingSourceKinds: MURPH_AGE_R399_PROXY_SOURCE_KINDS,
    validationGate: {
      evidenceTiers: ["internal-anchor"],
      productPromotionEvidence: false,
      status: "blocked",
      summary: "Large NHIS outcome-risk anchor only; product promotion and risk-age display require external validation plus locked user-input mapping.",
    },
    wearableScoreBearingAuthorized: false,
  },
  {
    acceptedBundleIds: ["l1b-glycemia-body"],
    cardId: "l1b_glycemia_body_10y_acm_research",
    evidenceClass: "research-transport",
    evidenceSummary: "Current alpha research card for glycemia plus body context; broad lab panels and wearables remain secondary shadow layers until external receipts clear.",
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
      "bmi",
    ],
    scoreBearingSourceKinds: ["measurement", "test-result"],
    validationGate: {
      evidenceTiers: ["internal-anchor", "same-family-sanity"],
      productPromotionEvidence: false,
      status: "blocked",
      summary: "Research-only current alpha; product promotion requires external aggregate validation and risk-to-age display approval.",
    },
    wearableScoreBearingAuthorized: false,
  },
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
    acceptedBundleIds: ["l1-glycemia"],
    cardId: "l1_tiny_glycemia_10y_acm_research",
    evidenceClass: "research-transport",
    evidenceSummary: "Minimal glycemia-only first-pass research card for glucose or HbA1c inputs; mixed transport evidence and controls keep it research-only.",
    outcome: {
      ageEstimateBasis: "risk-age-equivalent",
      horizonYears: 10,
      modelEndpoint: "10-year all-cause mortality",
      riskEndpoint: "all-cause-mortality",
    },
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: true,
    scoreBearingMetricKeys: ["glucose", "hba1c"],
    scoreBearingSourceKinds: ["measurement", "test-result"],
    validationGate: {
      evidenceTiers: ["internal-anchor", "same-family-sanity"],
      productPromotionEvidence: false,
      status: "blocked",
      summary: "Minimal glycemia research card only; product promotion requires external validation and stronger negative-control performance.",
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
];

const MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICY_DEFINITIONS = [
  {
    compatibleAnchorCardIds: MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS,
    evidenceSummary: "Activity features may be evaluated as a shadow increment over the active research anchor, but they are not score-bearing.",
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
      "peak-30-minute-cadence",
      "sedentary-minutes",
      "estimated-vo2-max",
    ],
  },
  {
    compatibleAnchorCardIds: MURPH_AGE_WEARABLE_SHADOW_ANCHOR_CARD_IDS,
    evidenceSummary: "Sleep features may be evaluated as a shadow increment over the active research anchor, but they are not score-bearing.",
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
    evidenceSummary: "Resting-heart-rate features may be evaluated as a shadow increment over the active research anchor, but they are not score-bearing.",
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
    evidenceSummary: "HRV features may be evaluated as a shadow increment over the active research anchor, but they are not score-bearing.",
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

const MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_KEYS = new Set([
  "anchorCardId",
  "evaluation",
  "family",
  "outputBoundary",
  "productAuthorized",
  "riskEffect",
  "schemaVersion",
  "scoreBearing",
  "scoreContributionAuthorized",
  "sourceRouteId",
]);

const MURPH_AGE_WEARABLE_SHADOW_RESULT_EVALUATION_KEYS = new Set([
  "aggregateMetricDeltas",
  "aggregateSample",
  "comparator",
  "evidenceTier",
  "sameDenominator",
]);

const MURPH_AGE_WEARABLE_SHADOW_RESULT_DELTA_KEYS = new Set([
  "aucDelta",
  "brierDelta",
  "calibrationInterceptDelta",
  "calibrationSlopeDelta",
  "cIndexDelta",
  "logLossDelta",
]);

const MURPH_AGE_WEARABLE_SHADOW_RESULT_SAMPLE_KEYS = new Set([
  "evaluatedRowCount",
  "eventCount",
  "minimumCellCount",
  "subgroupCount",
  "suppressedCellCount",
]);

const MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY_KEYS = new Set([
  "aggregateOnly",
  "coefficientsExportAllowed",
  "participantLevelExportAllowed",
  "predictionsExportAllowed",
  "productDisplayExportAllowed",
  "rowValuesExportAllowed",
]);

const MURPH_AGE_WEARABLE_SHADOW_RESULT_EVIDENCE_TIER_SET = new Set<string>(
  MURPH_AGE_WEARABLE_SHADOW_RESULT_EVIDENCE_TIERS,
);

const MURPH_AGE_INCREMENT_EVALUATION_LAYER_SET = new Set<string>(
  MURPH_AGE_INCREMENT_EVALUATION_LAYERS,
);

const MURPH_AGE_INCREMENT_EVALUATION_CARD_KEYS = new Set([
  "anchorCardId",
  "candidateBatchId",
  "candidateId",
  "evaluation",
  "flatteningAuthorized",
  "layer",
  "outputBoundary",
  "productAuthorized",
  "riskEffect",
  "schemaVersion",
  "scoreBearing",
  "scoreContributionAuthorized",
  "sourceRouteId",
]);

const MURPH_AGE_INCREMENT_EVALUATION_KEYS = new Set([
  "aggregateMetricDeltas",
  "aggregateSample",
  "anchorMetrics",
  "candidateMetrics",
  "comparator",
  "evidenceTier",
  "sameDenominator",
]);

const MURPH_AGE_INCREMENT_EVALUATION_DELTA_KEYS = new Set([
  "aucDelta",
  "brierDelta",
  "calibrationInterceptDelta",
  "calibrationSlopeDelta",
  "cIndexDelta",
  "logLossDelta",
]);

const MURPH_AGE_INCREMENT_EVALUATION_METRIC_KEYS = new Set([
  "auc",
  "brier",
  "calibrationIntercept",
  "calibrationSlope",
  "cIndex",
  "events",
  "logLoss",
  "meanPrediction",
  "n",
  "observedRate",
]);

const MURPH_AGE_INCREMENT_EVALUATION_NULLABLE_METRIC_KEYS = new Set([
  "auc",
  "cIndex",
]);

const MURPH_AGE_INCREMENT_EVALUATION_SAMPLE_KEYS = new Set([
  "evaluatedRowCount",
  "eventCount",
  "minimumCellCount",
  "subgroupCount",
  "suppressedCellCount",
]);

const MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY_KEYS = new Set([
  "aggregateOnly",
  "coefficientsExportAllowed",
  "localArtifactPathExportAllowed",
  "modelParametersExportAllowed",
  "participantIdentifiersExportAllowed",
  "participantLevelExportAllowed",
  "predictionsExportAllowed",
  "productDisplayExportAllowed",
  "rowValuesExportAllowed",
  "sourceTextExportAllowed",
  "splitMembershipExportAllowed",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_KEYS = new Set([
  "acceptedAggregateMetricDeltaFields",
  "accelerometryProtocol",
  "architecturePattern",
  "benchmarkId",
  "benchmarkStatus",
  "denominatorPolicy",
  "endpoint",
  "evidenceClass",
  "evidenceTierIfExecuted",
  "featureFamilies",
  "measurementMethod",
  "modelLadder",
  "negativeControlPolicy",
  "outputBoundary",
  "productAuthorized",
  "requiredAggregateSampleFields",
  "rowParsingAuthorized",
  "schemaVersion",
  "scoreBearing",
  "scoreContributionAuthorized",
  "selectionPolicy",
  "sourceRouteId",
  "splitPolicy",
  "transformIds",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_DENOMINATOR_POLICY_KEYS = new Set([
  "adultAgeRangeYears",
  "eligibleLinkedMortalityRequired",
  "labBodyAnchorDenominatorRequired",
  "objectiveActivityWindowRequired",
  "publicUseRowsOnly",
  "sameDenominatorRequired",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_AGE_RANGE_KEYS = new Set([
  "max",
  "min",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_SPLIT_POLICY_KEYS = new Set([
  "aggregateSplitCountsExportOnly",
  "frozenBeforeScoring",
  "participantIdsExportAllowed",
  "splitMembershipExportAllowed",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_MODEL_STEP_KEYS = new Set([
  "modelId",
  "required",
  "role",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_NEGATIVE_CONTROL_POLICY_KEYS = new Set([
  "coverageOnlyControlRequired",
  "earlyEventWashoutRequired",
  "reverseCausationSensitivityRequired",
  "shuffledWithinAgeSexBinsRequired",
]);

const MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_SELECTION_POLICY_KEYS = new Set([
  "calibrationFirst",
  "discriminationOnlySelectionAllowed",
  "properScoresRequired",
  "sameDenominatorComparisonsRequired",
  "testSetMutationAuthorized",
]);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ROOT_KEYS = new Set([
  "artifactBoundary",
  "denominator",
  "endpoint",
  "evaluatorFrozenBeforeExecution",
  "evidenceTier",
  "models",
  "negativeControls",
  "productAuthorized",
  "receiptId",
  "sameDenominator",
  "schemaVersion",
  "scoreBearing",
  "scoreContributionAuthorized",
  "sourceRouteId",
]);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_KEYS = new Set([
  "endpointFamily",
  "endpointFrozenBeforeScoring",
  "horizonYears",
  "indexDateRule",
  "outcomeAscertainment",
  "outcomeLinked",
  "washoutDays",
]);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_DENOMINATOR_KEYS = new Set([
  "evaluatedRowCount",
  "eventCount",
  "minimumCellCount",
  "personYears",
  "suppressedCellCount",
]);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_KEYS = new Set([
  "calibrationStatus",
  "metrics",
  "modelId",
]);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_NEGATIVE_CONTROL_KEYS = new Set([
  "coverageOnlyBeatenByResidualWearable",
  "deviceOrEhrDensityDominates",
  "earlyEventSensitivityPassed",
  "reverseCausationWashoutPassed",
]);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_FAMILY_VALUES = [
  "all-cause-mortality",
  "cardiometabolic-event",
  "cvd-event",
  "ehr-event-burden",
  "hospitalization-or-acute-event",
] as const satisfies readonly MurphAgeWearableLabAggregateReceiptEndpointFamily[];

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_INDEX_DATE_RULE_VALUES = [
  "baseline-exam-before-risk-window",
  "feature-window-end-before-risk-window",
] as const satisfies readonly MurphAgeWearableLabAggregateReceiptIndexDateRule[];

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OUTCOME_ASCERTAINMENT_VALUES = [
  "adjudicated-event",
  "death-registry",
  "ehr-event",
  "registry-linked-event",
] as const satisfies readonly MurphAgeWearableLabAggregateReceiptOutcomeAscertainment[];

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_CALIBRATION_STATUS_VALUES = [
  "fail",
  "not-reported",
  "pass",
  "warn",
] as const satisfies readonly MurphAgeWearableLabAggregateReceiptCalibrationStatus[];

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_FAMILIES = new Set<string>(
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_FAMILY_VALUES,
);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_INDEX_DATE_RULES = new Set<string>(
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_INDEX_DATE_RULE_VALUES,
);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OUTCOME_ASCERTAINMENTS = new Set<string>(
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OUTCOME_ASCERTAINMENT_VALUES,
);

const MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_CALIBRATION_STATUSES = new Set<string>(
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_CALIBRATION_STATUS_VALUES,
);

const MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS = new Set(
  MURPH_AGE_WEARABLE_CONTEXT_FEATURES.flatMap((feature) => feature.metricKeys),
);

const MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS = new Set(
  MURPH_AGE_FUNCTION_CONTEXT_FEATURES.flatMap((feature) => feature.metricKeys),
);

const MURPH_AGE_R399_PROXY_METRIC_KEYS = new Set(
  MURPH_AGE_R399_PROXY_FEATURES.flatMap((feature) => feature.metricKeys),
);

const MURPH_AGE_BP_BODY_METRIC_KEYS = new Set(
  MURPH_AGE_BP_BODY_FEATURES.flatMap((feature) => feature.metricKeys),
);

const MURPH_AGE_SCORE_BEARING_LAB_METRIC_KEYS = new Set(
  [
    ...MURPH_AGE_LAB9_FEATURES.flatMap((feature) => feature.metricKeys),
    ...MURPH_AGE_LAB5_FEATURES.flatMap((feature) => feature.metricKeys),
  ].filter((metricKey) => !MURPH_AGE_BP_BODY_METRIC_KEYS.has(metricKey)),
);

const MURPH_AGE_INPUT_BUNDLE_METRIC_KEYS = new Set([
  ...MURPH_AGE_LAB9_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_BP_BODY_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_LAB5_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_R399_PROXY_METRIC_KEYS,
  ...MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS,
  ...MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS,
]);

const MURPH_AGE_SUBMITTED_METRIC_SOURCE_KINDS = new Set<MurphAgeSubmittedMetricSourceKind>([
  "activity-summary",
  "measurement",
  "profile",
  "questionnaire",
  "sleep-summary",
  "survey-response",
  "test-result",
  "wearable-summary",
]);
const MURPH_AGE_SUBMITTED_CALCULATOR_USER_INPUT_FAMILIES = [
  "demographics-age-sex",
  "bloodwork-common-labs",
  "vitals-body-composition",
  "wearable-activity",
  "wearable-recovery-autonomic",
  "wearable-sleep",
] as const satisfies readonly MurphAgeSubmittedCalculatorUserInputFamily[];

const MURPH_AGE_PUBLIC_FEATURE_KEYS = new Set([
  ...MURPH_AGE_LAB9_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_BP_BODY_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_LAB5_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_R399_PROXY_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_WEARABLE_CONTEXT_FEATURES.map((feature) => feature.featureKey),
  ...MURPH_AGE_FUNCTION_CONTEXT_FEATURES.map((feature) => feature.featureKey),
  "chronological-age",
  "chronological-age-squared",
  "age-sex-interaction",
  "metric-missingness",
  "sex",
]);

const MURPH_AGE_PUBLIC_FALLBACK_FEATURE_KEYS = new Set([
  "metric-feature",
  "model-feature",
]);

const MURPH_AGE_PUBLIC_WEARABLE_BRIDGE_FEATURE_KEYS = new Set(
  MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS.map((feature) => feature.featureKey),
);

const MURPH_AGE_PUBLIC_MODULE_IDS = new Set([
  "activity",
  "behavior",
  "body",
  "cardiovascular",
  "clinical",
  "data-quality",
  "demographics",
  "function",
  "hematologic",
  "immune",
  "inflammatory",
  "liver",
  "metabolic",
  "renal",
  "recovery",
  "sleep",
]);

const MURPH_AGE_PUBLIC_MODULE_ID_ALIASES: ReadonlyMap<string, string> = new Map([
  ["body-composition", "body"],
  ["immune-hematologic", "immune"],
  ["lipids", "cardiovascular"],
  ["liver-renal", "liver"],
]);

const MURPH_AGE_PUBLIC_METRIC_KEYS = new Set([
  ...MURPH_AGE_LAB9_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_BP_BODY_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_LAB5_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_R399_PROXY_METRIC_KEYS,
  ...MURPH_AGE_WEARABLE_CONTEXT_FEATURES.flatMap((feature) => feature.metricKeys),
  ...MURPH_AGE_FUNCTION_CONTEXT_FEATURES.flatMap((feature) => feature.metricKeys),
]);

const MURPH_AGE_ARCHITECTURE_LAYER_ORDER = [
  "outcome-anchor",
  "clinical-lab-body",
  "function-cognition-context",
  "wearable-shadow",
  "source-validation",
  "product-display",
] as const satisfies readonly MurphAgeArchitectureLayerId[];

const MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_PACKETS: readonly MurphAgePublicLabWearableShadowEvidencePacket[] = [
  {
    aggregateMetricDeltas: {
      auc: -0.00311477,
      brier: 0.00005335,
      calibrationSlope: 1.05308537,
      eOverO: 0.99957721,
      logLoss: 0.00039351,
    },
    conclusion: "wrist_activity_signal_shadow_hold_for_calibration_or_external_validation",
    evidenceRole: "same-family-public-shadow-diagnostic",
    negativeControlsBeaten: false,
    packetId: "r1065-nhanes-wrist-activity-shadow-loop",
    productDisplayAuthorized: false,
    sourceRouteId: "nhanes-activity-shadow-lmf",
    usableAsConsumerWearableValidation: false,
    wearableScoreBearingAuthorized: false,
  },
  {
    aggregateMetricDeltas: {
      auc: 0.00517369,
      brier: -0.00043868,
      logLoss: -0.00111926,
    },
    conclusion: "wrist_activity_robustness_inconclusive_keep_shadow",
    evidenceRole: "same-family-public-shadow-diagnostic",
    negativeControlsBeaten: false,
    packetId: "r1066-nhanes-wrist-activity-robustness-loop",
    productDisplayAuthorized: false,
    sourceRouteId: "nhanes-activity-shadow-lmf",
    usableAsConsumerWearableValidation: false,
    wearableScoreBearingAuthorized: false,
  },
  {
    aggregateMetricDeltas: {},
    conclusion: "activity_wear_signal_unstable_keep_shadow",
    evidenceRole: "same-family-public-shadow-diagnostic",
    negativeControlsBeaten: null,
    packetId: "r1067-nhanes-wrist-final-stress-test",
    productDisplayAuthorized: false,
    sourceRouteId: "nhanes-activity-shadow-lmf",
    usableAsConsumerWearableValidation: false,
    wearableScoreBearingAuthorized: false,
  },
  {
    aggregateMetricDeltas: {
      auc: -0.000688,
      brier: -0.0045907,
      calibrationSlope: 0.9905458,
      eOverO: 0.83820495,
      logLoss: -0.01019197,
    },
    conclusion: "activity_signal_shadow_hold_for_calibration_or_external_validation",
    evidenceRole: "same-family-public-shadow-diagnostic",
    negativeControlsBeaten: true,
    packetId: "r1038-nhanes-modern-lab-activity-loop",
    productDisplayAuthorized: false,
    sourceRouteId: "nhanes-activity-shadow-lmf",
    usableAsConsumerWearableValidation: false,
    wearableScoreBearingAuthorized: false,
  },
  {
    aggregateMetricDeltas: {},
    conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
    evidenceRole: "same-family-public-shadow-diagnostic",
    negativeControlsBeaten: true,
    packetId: "r1049-nhanes-activity-control-diagnostic",
    productDisplayAuthorized: false,
    sourceRouteId: "nhanes-activity-shadow-lmf",
    usableAsConsumerWearableValidation: false,
    wearableScoreBearingAuthorized: false,
  },
];

export function listMurphAgeModelCardPolicies(): MurphAgeModelCardPolicy[] {
  return MURPH_AGE_MODEL_CARD_POLICIES.map(cloneMurphAgeModelCardPolicy);
}

export function listMurphAgeWearableShadowIncrementPolicies(): MurphAgeWearableShadowIncrementPolicy[] {
  return MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.map(cloneMurphAgeWearableShadowIncrementPolicy);
}

export function listMurphAgeWearableBridgeFeatureSpecs(): MurphAgeWearableBridgeFeatureSpec[] {
  return MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS.map(cloneMurphAgeWearableBridgeFeatureSpec);
}

export function listMurphAgeWearableBridgeMetricSourceHints(): MurphAgeWearableBridgeMetricSourceHint[] {
  return MURPH_AGE_WEARABLE_BRIDGE_METRIC_SOURCE_HINTS.map(cloneMurphAgeWearableBridgeMetricSourceHint);
}

export function resolveMurphAgeWearableBridgeMetricSourceKind(
  metricKey: string,
): MurphAgeWearableBridgeSourceKind | null {
  return resolveMurphAgeWearableBridgeMetricSourceHint(metricKey)?.defaultSourceKind ?? null;
}

export function isMurphAgeWearableBridgeValidDayMetricPoint(input: {
  metricKey: string;
  sourceKind: string | null | undefined;
}): boolean {
  const sourceKind = input.sourceKind;
  if (!sourceKind) return false;
  const hint = resolveMurphAgeWearableBridgeMetricSourceHint(input.metricKey);
  return hint?.validDaySourceKinds.some((candidate) => candidate === sourceKind) ?? false;
}

export function isMurphAgeWearableBridgeValidNightMetricPoint(input: {
  metricKey: string;
  sourceKind: string | null | undefined;
}): boolean {
  const sourceKind = input.sourceKind;
  if (!sourceKind) return false;
  const hint = resolveMurphAgeWearableBridgeMetricSourceHint(input.metricKey);
  return hint?.validNightSourceKinds.some((candidate) => candidate === sourceKind) ?? false;
}

export function summarizeMurphAgeWearableParameterPackContract(): MurphAgeWearableParameterPackContract {
  return {
    deploymentRightsRequiredForProductScoring: true,
    emptyPackBehavior: "exact-current-zero-delta-behavior",
    familyPriorityOrder: [
      "activity",
      "resting-heart-rate",
      "sleep",
      "hrv",
      "estimated-vo2-max",
    ],
    requiredFields: [
      "family",
      "sourceRouteId",
      "endpoint",
      "horizonYears",
      "anchorCardId",
      "featureNames",
      "featureTransforms",
      "validDayNightRules",
      "deviceMethodQualifier",
      "calibrationIntercept",
      "calibrationSlope",
      "eligibleAgeSexBounds",
      "evidenceTier",
      "promotionGateResults",
      "deploymentRights",
      "globalWearableCap",
      "packHash",
    ],
    requiredForResidualScoring: true,
    schemaVersion: MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION,
    supportedDeploymentRights: [
      "not-authorized",
      "research-only",
      "product-authorized",
    ],
  };
}

const MURPH_AGE_WEARABLE_RESIDUAL_LAYER_IDS_BY_FAMILY = {
  activity: "activity-residual-v1",
  hrv: "hrv-residual-v1",
  "resting-heart-rate": "resting-heart-rate-residual-v1",
  sleep: "sleep-residual-v1",
} satisfies Record<MurphAgeWearableShadowIncrementFamily, MurphAgeWearableResidualLayerId>;

const MURPH_AGE_MULTI_WEARABLE_RESIDUAL_LAYER_ID =
  "multi-wearable-residual-v1" as const satisfies MurphAgeWearableResidualLayerId;
const MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID =
  "wearable-multi-family-residual" as const satisfies MurphAgeResearchLayerId;

export function summarizeMurphAgeWearableResidualLayerContractForFamily(
  family: MurphAgeWearableShadowIncrementFamily,
): MurphAgeWearableResidualLayerContract {
  const shadowPolicy = resolveMurphAgeWearableShadowIncrementPolicy(family);
  const scorePolicy = MURPH_AGE_WEARABLE_SCORE_BEARING_FAMILY_POLICIES.find((candidate) =>
    candidate.family === family
  ) ?? null;
  const signalMetricKeys = scorePolicy?.signalMetricKeys
    ?? shadowPolicy?.signalMetricKeys
    ?? [];
  const qualityMetricKeys = scorePolicy?.qualityMetricKeys
    ?? shadowPolicy?.requiredQualityMetricKeys
    ?? [];
  const deferredFamilyOrder = ([
    "resting-heart-rate",
    "sleep",
    "hrv",
    "estimated-vo2-max",
  ] as const).filter((candidate) => candidate !== family);

  return {
    anchorCardIds: listMurphAgeWearableShadowAnchorCardIds(),
    parameterPackContract: summarizeMurphAgeWearableParameterPackContract(),
    combinationScale: "logit-residual",
    coverageScoringPolicy: "gate-and-control-only-not-age-contribution",
    currentDeploymentStatus: "contract-only-no-validated-parameters",
    deployableParameterizationAvailable: false,
    deferredFamilyOrder,
    family,
    featureSetContract: {
      activityVolumeCandidateMetricKeys: [
        "steps",
        "activity-minutes",
        "mvpa-minutes",
        "peak-30-minute-cadence",
        "sedentary-minutes",
      ],
      coverageControlMetricKeys: [...qualityMetricKeys],
      firstPassOnlyFamily: "activity",
      methodQualifierRequired: true,
      proprietaryDeviceScoresExcluded: true,
      trailingWindowDays: 28,
    },
    layerId: MURPH_AGE_WEARABLE_RESIDUAL_LAYER_IDS_BY_FAMILY[family],
    minimumValidDays28d: scorePolicy?.minimumValidDays28d ?? null,
    minimumValidNights28d: scorePolicy?.minimumValidNights28d ?? null,
    missingnessPolicy: "missing-or-undercovered-family-zero-delta-widen-uncertainty",
    nuisanceControlMetricKeys: [...qualityMetricKeys],
    primaryDecisionComparisons: [
      "m5-vs-m1-lab-body",
      "m5-vs-m2-coverage-control",
    ],
    productAuthorized: false,
    productMultiplier: 0,
    qualityGateMetricKeys: [...qualityMetricKeys],
    requiredPromotionSignals: murphAgeWearableRequiredPromotionSignals(),
    researchMultiplier: 0,
    residualDeltaStatus: "zero-until-validated",
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    signalMetricKeys: [...signalMetricKeys],
    trailingWindowDays: 28,
  };
}

export function summarizeMurphAgeWearableResidualLayerContract(): MurphAgeWearableResidualLayerContract {
  return summarizeMurphAgeWearableResidualLayerContractForFamily("activity");
}

export function summarizeMurphAgeWearableResidualLayerContracts(): MurphAgeWearableResidualLayerContract[] {
  return [
    "activity",
    "sleep",
    "resting-heart-rate",
    "hrv",
  ].map((family) =>
    summarizeMurphAgeWearableResidualLayerContractForFamily(
      family as MurphAgeWearableShadowIncrementFamily,
    )
  );
}

export function summarizeMurphAgeWearableScoreBearingStrategy(): MurphAgeWearableScoreBearingStrategy {
  const residualLayerContract = summarizeMurphAgeWearableResidualLayerContract();
  return {
    aggregateReceiptOnlyAuthorizesScienceReview: true,
    architecturePattern: "anchor-plus-wearable-residual-shadow",
    deployableParameterizationRequiredForProductScoring: true,
    familyPolicies: MURPH_AGE_WEARABLE_SCORE_BEARING_FAMILY_POLICIES.map(
      cloneMurphAgeWearableScoreBearingFamilyPolicy,
    ),
    modelForm: "penalized-additive-residual-bounded-and-shrunk",
    primaryDecisionComparisons: [
      "m5-vs-m1-lab-body",
      "m5-vs-m2-coverage-control",
    ],
    productStatus: "context-only",
    productWearableMultiplier: 0,
    residualLayerContract: cloneMurphAgeWearableResidualLayerContract(residualLayerContract),
    requiredPromotionSignals: murphAgeWearableRequiredPromotionSignals(),
    researchResidualMode: "locked-evaluator-only",
    schemaVersion: MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION,
  };
}

function murphAgeWearableRequiredPromotionSignals(): MurphAgeWearableScoreBearingPromotionSignal[] {
  return [
    "m5-beats-m1-proper-score",
    "m5-beats-m2-coverage-control",
    "m5-calibration-passes",
    "negative-controls-pass",
    "reverse-causation-washout-passes",
    "replicates-in-two-source-families",
    "deployable-parameterization-authorized",
  ];
}

export function applyMurphAgeWearableResidualLayer(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorRiskProbability: number | null;
  assessments: readonly MurphAgeWearableShadowIncrementAssessment[];
  asOf?: string;
  contract?: MurphAgeWearableResidualLayerContract;
  parameterPack?: MurphAgeWearableResidualParameterPack | null;
  points?: readonly MetricPoint[];
  referenceRiskCurve?: readonly MurphAgeReferenceRiskPoint[];
}): MurphAgeWearableResidualLayerApplication {
  const contract = input.contract
    ?? (input.parameterPack
      ? summarizeMurphAgeWearableResidualLayerContractForFamily(input.parameterPack.family)
      : summarizeMurphAgeWearableResidualLayerContract());
  const familyAssessment = input.assessments.find((assessment) => assessment.family === contract.family) ?? null;
  const anchorLogit = logitFromProbability(input.anchorRiskProbability);
  const anchorCompatible = contract.anchorCardIds.includes(input.anchorCardId)
    && familyAssessment?.anchorCompatible === true;
  const warnings = familyAssessment?.warnings.map((warning) => ({ ...warning })) ?? [];

  if (input.anchorRiskProbability !== null && anchorLogit === null) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual layer application requires a finite anchor risk probability between 0 and 1.",
    });
  }

  const status: MurphAgeWearableResidualLayerApplicationStatus = !anchorCompatible
    ? "blocked-incompatible-anchor"
    : familyAssessment?.status === "ready"
    ? "mechanics-ready-zero-delta"
    : "ineligible-insufficient-coverage";
  const parameterized = status === "mechanics-ready-zero-delta" && input.parameterPack
    ? evaluateMurphAgeWearableResidualParameterPack({
      anchorCardId: input.anchorCardId,
      anchorLogit,
      asOf: input.asOf,
      contract,
      pack: input.parameterPack,
      points: input.points ?? [],
    })
    : null;
  if (parameterized) warnings.push(...parameterized.warnings);
  const residualDeltaLogit = parameterized?.status === "valid" ? parameterized.residualDeltaLogit : 0;
  const finalLogit = anchorLogit === null ? null : roundContribution(anchorLogit + residualDeltaLogit);
  const finalRiskProbability = finalLogit === null ? input.anchorRiskProbability : roundProbability(logistic(finalLogit));
  const parameterizationAvailable = parameterized?.status === "valid";
  const anchorRiskAgeEquivalentYears = mapRiskToReferenceAgeEquivalentOrNull({
    referenceRiskCurve: input.referenceRiskCurve,
    riskProbability: input.anchorRiskProbability,
  });
  const finalRiskAgeEquivalentYears = mapRiskToReferenceAgeEquivalentOrNull({
    referenceRiskCurve: input.referenceRiskCurve,
    riskProbability: finalRiskProbability,
  });

  return {
    anchorCardId: input.anchorCardId,
    anchorRiskAgeEquivalentYears,
    anchorCompatible,
    anchorLogit,
    eligibleForResidualResearch: status === "mechanics-ready-zero-delta",
    finalRiskAgeEquivalentYears,
    finalLogit,
    finalRiskProbability,
    layerId: contract.layerId,
    parameterPackHash: parameterizationAvailable ? input.parameterPack?.packHash ?? null : null,
    parameterizationAvailable,
    productAuthorized: false,
    residualDeltaYears: anchorRiskAgeEquivalentYears !== null && finalRiskAgeEquivalentYears !== null
      ? roundYears(finalRiskAgeEquivalentYears - anchorRiskAgeEquivalentYears)
      : null,
    residualDeltaLogit,
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys: familyAssessment ? [...familyAssessment.selectedMetricKeys] : [],
    status: parameterizationAvailable ? "research-parameterized-shadow-delta" : status,
    warnings,
  };
}

export function applyMurphAgeWearableResidualLayers(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorRiskProbability: number | null;
  assessments: readonly MurphAgeWearableShadowIncrementAssessment[];
  asOf?: string;
  parameterPacks?: readonly MurphAgeWearableResidualParameterPack[] | null;
  points?: readonly MetricPoint[];
  referenceRiskCurve?: readonly MurphAgeReferenceRiskPoint[];
}): MurphAgeWearableResidualLayerApplication {
  const packs = [...(input.parameterPacks ?? [])];
  if (packs.length <= 1) {
    return applyMurphAgeWearableResidualLayer({
      anchorCardId: input.anchorCardId,
      anchorRiskProbability: input.anchorRiskProbability,
      asOf: input.asOf,
      assessments: input.assessments,
      parameterPack: packs[0] ?? null,
      points: input.points,
      referenceRiskCurve: input.referenceRiskCurve,
    });
  }

  const applications = packs.map((pack) =>
    applyMurphAgeWearableResidualLayer({
      anchorCardId: input.anchorCardId,
      anchorRiskProbability: input.anchorRiskProbability,
      asOf: input.asOf,
      assessments: input.assessments,
      parameterPack: pack,
      points: input.points,
      referenceRiskCurve: input.referenceRiskCurve,
    })
  );
  const warnings = applications.flatMap((application) =>
    application.warnings.map((warning) => ({ ...warning }))
  );
  const validApplications = applications.filter((application) =>
    application.parameterizationAvailable
  );
  const residualDeltaLogit = roundContribution(
    validApplications.reduce((sum, application) => sum + application.residualDeltaLogit, 0),
  );
  const anchorLogit = logitFromProbability(input.anchorRiskProbability);
  const finalLogit = anchorLogit === null ? null : roundContribution(anchorLogit + residualDeltaLogit);
  const finalRiskProbability = finalLogit === null
    ? input.anchorRiskProbability
    : roundProbability(logistic(finalLogit));
  const anchorRiskAgeEquivalentYears = mapRiskToReferenceAgeEquivalentOrNull({
    referenceRiskCurve: input.referenceRiskCurve,
    riskProbability: input.anchorRiskProbability,
  });
  const finalRiskAgeEquivalentYears = mapRiskToReferenceAgeEquivalentOrNull({
    referenceRiskCurve: input.referenceRiskCurve,
    riskProbability: finalRiskProbability,
  });
  const parameterizationAvailable = validApplications.length > 0;
  const anchorCompatible = applications.some((application) => application.anchorCompatible);

  return {
    anchorCardId: input.anchorCardId,
    anchorRiskAgeEquivalentYears,
    anchorCompatible,
    anchorLogit,
    eligibleForResidualResearch: applications.some((application) => application.eligibleForResidualResearch),
    finalRiskAgeEquivalentYears,
    finalLogit,
    finalRiskProbability,
    layerId: MURPH_AGE_MULTI_WEARABLE_RESIDUAL_LAYER_ID,
    parameterPackHash: parameterizationAvailable
      ? `multi-${validApplications.map((application) => application.layerId).join("-")}`
      : null,
    parameterizationAvailable,
    productAuthorized: false,
    residualDeltaYears: anchorRiskAgeEquivalentYears !== null && finalRiskAgeEquivalentYears !== null
      ? roundYears(finalRiskAgeEquivalentYears - anchorRiskAgeEquivalentYears)
      : null,
    residualDeltaLogit,
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys: uniqueStrings(applications.flatMap((application) => application.selectedMetricKeys)),
    status: parameterizationAvailable
      ? "research-parameterized-shadow-delta"
      : applications.some((application) => application.status === "ineligible-insufficient-coverage")
      ? "ineligible-insufficient-coverage"
      : applications[0]?.status ?? "blocked-incompatible-anchor",
    warnings,
  };
}

export function validateMurphAgeWearableResidualParameterPack(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  contract?: MurphAgeWearableResidualLayerContract;
  parameterPack: MurphAgeWearableResidualParameterPack;
}): MurphAgeWearableResidualParameterPackValidationResult {
  return validateMurphAgeWearableResidualParameterPackForContract({
    anchorCardId: input.anchorCardId,
    contract: input.contract
      ?? summarizeMurphAgeWearableResidualLayerContractForFamily(input.parameterPack.family),
    pack: input.parameterPack,
  });
}

function wearableResidualParameterPacksForInput(
  input: Pick<MurphAgeCalculatorInput, "wearableResidualParameterPack" | "wearableResidualParameterPacks">,
): MurphAgeWearableResidualParameterPack[] {
  if (input.wearableResidualParameterPacks && input.wearableResidualParameterPacks.length > 0) {
    return [...input.wearableResidualParameterPacks];
  }
  return input.wearableResidualParameterPack ? [input.wearableResidualParameterPack] : [];
}

function evaluateMurphAgeWearableResidualParameterPack(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorLogit: number | null;
  asOf?: string;
  contract: MurphAgeWearableResidualLayerContract;
  pack: MurphAgeWearableResidualParameterPack;
  points: readonly MetricPoint[];
}): {
  residualDeltaLogit: number;
  status: "invalid" | "valid";
  warnings: MurphAgeWarning[];
} {
  const validation = validateMurphAgeWearableResidualParameterPackForContract({
    anchorCardId: input.anchorCardId,
    contract: input.contract,
    pack: input.pack,
  });
  if (validation.status === "invalid") {
    return {
      residualDeltaLogit: 0,
      status: "invalid",
      warnings: validation.warnings,
    };
  }
  if (input.anchorLogit === null) {
    return {
      residualDeltaLogit: 0,
      status: "invalid",
      warnings: [{
        code: "INVALID_INPUT",
        message: "Wearable residual parameter pack requires a valid anchor risk logit.",
      }],
    };
  }

  const warnings: MurphAgeWarning[] = [...validation.warnings];
  let rawDelta = input.pack.intercept;
  for (const feature of input.pack.featureWeights) {
    const selection = selectMetricValue({
      metricKey: feature.metricKey,
      now: input.asOf,
      points: input.points,
    });
    if (selection.status !== "ready" || selection.value === null || !Number.isFinite(selection.value)) {
      warnings.push({
        code: "MODEL_FEATURE_MISSING",
        message: `Wearable residual parameter pack could not select ${feature.metricKey}.`,
        metricKey: feature.metricKey,
      });
      return {
        residualDeltaLogit: 0,
        status: "invalid",
        warnings,
      };
    }
    rawDelta += feature.coefficient * ((selection.value - feature.center) / feature.scale);
  }

  const calibratedDelta = input.pack.calibrationIntercept + input.pack.calibrationSlope * rawDelta;
  const cap = Math.abs(input.pack.globalWearableCapLogit);
  return {
    residualDeltaLogit: roundContribution(Math.max(-cap, Math.min(cap, calibratedDelta))),
    status: "valid",
    warnings,
  };
}

function validateMurphAgeWearableResidualParameterPackForContract(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  contract: MurphAgeWearableResidualLayerContract;
  pack: MurphAgeWearableResidualParameterPack;
}): MurphAgeWearableResidualParameterPackValidationResult {
  const warnings: MurphAgeWarning[] = [];
  const pack = input.pack;
  const sourceRoute = resolveMurphAgeSourceRoute(pack.sourceRouteId);
  const seenMetricKeys = new Set<string>();

  if (pack.schemaVersion !== MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack has an unsupported schema version.",
    });
  }
  if (pack.layerId !== input.contract.layerId) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack does not match the residual layer id.",
    });
  }
  if (pack.family !== input.contract.family) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack does not match the residual layer family.",
    });
  }
  if (pack.anchorCardId !== input.anchorCardId || !input.contract.anchorCardIds.includes(pack.anchorCardId)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable residual parameter pack anchor card is not compatible with the selected anchor.",
    });
  }
  if (pack.endpoint !== "10-year all-cause mortality" || pack.horizonYears !== 10) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable residual parameter pack must target the locked 10-year all-cause mortality endpoint.",
    });
  }
  if (!sourceRoute || !sourceRoute.layers.includes("wearable-shadow-increment")) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable residual parameter pack source route must be a registered wearable shadow increment route.",
    });
  }
  if (pack.deploymentRights === "not-authorized") {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable residual parameter pack is not authorized for residual scoring.",
    });
  }
  if (
    pack.deploymentRights !== "not-authorized"
    && pack.deploymentRights !== "product-authorized"
    && pack.deploymentRights !== "research-only"
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable residual parameter pack deployment rights are not recognized.",
    });
  }
  if (pack.deploymentRights === "product-authorized" && !MURPH_AGE_PRODUCT_PROMOTION_EVIDENCE_TIERS.has(pack.evidenceTier)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Product-authorized wearable residual parameter packs require product-promotion evidence tiers.",
    });
  }
  if (!MURPH_AGE_VALIDATION_EVIDENCE_TIERS.has(pack.evidenceTier)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable residual parameter pack evidence tier is not recognized.",
    });
  }
  if (!Number.isFinite(pack.intercept) || !Number.isFinite(pack.calibrationIntercept)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack intercepts must be finite.",
    });
  }
  if (!Number.isFinite(pack.calibrationSlope) || pack.calibrationSlope <= 0) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack calibration slope must be positive and finite.",
    });
  }
  if (!Number.isFinite(pack.globalWearableCapLogit) || pack.globalWearableCapLogit <= 0 || pack.globalWearableCapLogit > 1) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack global cap must be finite and between 0 and 1 logit.",
    });
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(pack.packHash)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable residual parameter pack hash must be a stable sha256 artifact digest.",
    });
  }
  if (pack.featureWeights.length === 0) {
    warnings.push({
      code: "MODEL_FEATURE_MISSING",
      message: "Wearable residual parameter pack must include at least one feature weight.",
    });
  }
  for (const feature of pack.featureWeights) {
    const metricKey = resolveMetricInputKey(feature.metricKey);
    if (!metricKey || !input.contract.signalMetricKeys.includes(metricKey)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: "Wearable residual parameter pack feature metric must be a residual layer signal metric.",
        metricKey: feature.metricKey,
      });
    }
    if (metricKey && seenMetricKeys.has(metricKey)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: "Wearable residual parameter pack feature metrics must be unique.",
        metricKey,
      });
    }
    if (metricKey) seenMetricKeys.add(metricKey);
    if (feature.transform !== "center-scale") {
      warnings.push({
        code: "TRANSFORM_UNSUPPORTED",
        message: "Wearable residual parameter pack feature transform is not supported.",
        metricKey: feature.metricKey,
      });
    }
    if (
      !Number.isFinite(feature.coefficient)
      || !Number.isFinite(feature.center)
      || !Number.isFinite(feature.scale)
      || feature.scale <= 0
    ) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "Wearable residual parameter pack feature weights must have finite coefficient, center, and positive scale.",
        metricKey: feature.metricKey,
      });
    }
  }
  return {
    status: warnings.length === 0 ? "valid" : "invalid",
    warnings,
  };
}

export function applyMurphAgeFunctionResidualLayer(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorRiskProbability: number | null;
  asOf?: string;
  parameterPack?: MurphAgeFunctionResidualParameterPack | null;
  points?: readonly MetricPoint[];
  referenceRiskCurve?: readonly MurphAgeReferenceRiskPoint[];
}): MurphAgeFunctionResidualLayerApplication {
  const points = input.points ?? [];
  const anchorLogit = logitFromProbability(input.anchorRiskProbability);
  const anchorCompatible = MURPH_AGE_FUNCTION_RESIDUAL_ANCHOR_CARD_IDS.includes(input.anchorCardId);
  const selectedMetricKeys = selectMurphAgeFunctionResidualMetricKeys({ asOf: input.asOf, points });
  const warnings: MurphAgeWarning[] = [];

  if (input.anchorRiskProbability !== null && anchorLogit === null) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual layer application requires a finite anchor risk probability between 0 and 1.",
    });
  }

  const status: MurphAgeFunctionResidualLayerApplicationStatus = !anchorCompatible || anchorLogit === null
    ? "blocked-incompatible-anchor"
    : selectedMetricKeys.length > 0
    ? "mechanics-ready-zero-delta"
    : "ineligible-insufficient-function-context";
  const parameterized = status === "mechanics-ready-zero-delta" && input.parameterPack
    ? evaluateMurphAgeFunctionResidualParameterPack({
      anchorCardId: input.anchorCardId,
      anchorLogit,
      asOf: input.asOf,
      pack: input.parameterPack,
      points,
    })
    : null;
  if (parameterized) warnings.push(...parameterized.warnings);

  const residualDeltaLogit = parameterized?.status === "valid" ? parameterized.residualDeltaLogit : 0;
  const finalLogit = anchorLogit === null ? null : roundContribution(anchorLogit + residualDeltaLogit);
  const finalRiskProbability = finalLogit === null ? input.anchorRiskProbability : roundProbability(logistic(finalLogit));
  const parameterizationAvailable = parameterized?.status === "valid";
  const anchorRiskAgeEquivalentYears = mapRiskToReferenceAgeEquivalentOrNull({
    referenceRiskCurve: input.referenceRiskCurve,
    riskProbability: input.anchorRiskProbability,
  });
  const finalRiskAgeEquivalentYears = mapRiskToReferenceAgeEquivalentOrNull({
    referenceRiskCurve: input.referenceRiskCurve,
    riskProbability: finalRiskProbability,
  });

  return {
    anchorCardId: input.anchorCardId,
    anchorRiskAgeEquivalentYears,
    anchorCompatible,
    anchorLogit,
    eligibleForResidualResearch: status === "mechanics-ready-zero-delta",
    finalRiskAgeEquivalentYears,
    finalLogit,
    finalRiskProbability,
    layerId: "function-mobility-residual-v1",
    parameterPackHash: parameterizationAvailable ? input.parameterPack?.packHash ?? null : null,
    parameterizationAvailable,
    productAuthorized: false,
    residualDeltaYears: anchorRiskAgeEquivalentYears !== null && finalRiskAgeEquivalentYears !== null
      ? roundYears(finalRiskAgeEquivalentYears - anchorRiskAgeEquivalentYears)
      : null,
    residualDeltaLogit,
    schemaVersion: MURPH_AGE_FUNCTION_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys,
    status: parameterizationAvailable ? "research-parameterized-shadow-delta" : status,
    warnings,
  };
}

export function validateMurphAgeFunctionResidualParameterPack(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  parameterPack: MurphAgeFunctionResidualParameterPack;
}): MurphAgeFunctionResidualParameterPackValidationResult {
  return validateMurphAgeFunctionResidualParameterPackForAnchor({
    anchorCardId: input.anchorCardId,
    pack: input.parameterPack,
  });
}

function evaluateMurphAgeFunctionResidualParameterPack(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  anchorLogit: number | null;
  asOf?: string;
  pack: MurphAgeFunctionResidualParameterPack;
  points: readonly MetricPoint[];
}): {
  residualDeltaLogit: number;
  status: "invalid" | "valid";
  warnings: MurphAgeWarning[];
} {
  const validation = validateMurphAgeFunctionResidualParameterPackForAnchor({
    anchorCardId: input.anchorCardId,
    pack: input.pack,
  });
  if (validation.status === "invalid") {
    return {
      residualDeltaLogit: 0,
      status: "invalid",
      warnings: validation.warnings,
    };
  }
  if (input.anchorLogit === null) {
    return {
      residualDeltaLogit: 0,
      status: "invalid",
      warnings: [{
        code: "INVALID_INPUT",
        message: "Function residual parameter pack requires a valid anchor risk logit.",
      }],
    };
  }

  const warnings: MurphAgeWarning[] = [...validation.warnings];
  let rawDelta = input.pack.intercept;
  for (const feature of input.pack.featureWeights) {
    const selection = selectMetricValue({
      metricKey: feature.metricKey,
      now: input.asOf,
      points: input.points,
    });
    if (selection.status !== "ready" || selection.value === null || !Number.isFinite(selection.value)) {
      warnings.push({
        code: "MODEL_FEATURE_MISSING",
        message: `Function residual parameter pack could not select ${feature.metricKey}.`,
        metricKey: feature.metricKey,
      });
      return {
        residualDeltaLogit: 0,
        status: "invalid",
        warnings,
      };
    }
    rawDelta += feature.coefficient * ((selection.value - feature.center) / feature.scale);
  }

  const calibratedDelta = input.pack.calibrationIntercept + input.pack.calibrationSlope * rawDelta;
  const cap = Math.abs(input.pack.globalFunctionCapLogit);
  return {
    residualDeltaLogit: roundContribution(Math.max(-cap, Math.min(cap, calibratedDelta))),
    status: "valid",
    warnings,
  };
}

function validateMurphAgeFunctionResidualParameterPackForAnchor(input: {
  anchorCardId: MurphAgeScoreBearingCardId;
  pack: MurphAgeFunctionResidualParameterPack;
}): MurphAgeFunctionResidualParameterPackValidationResult {
  const warnings: MurphAgeWarning[] = [];
  const pack = input.pack;
  const sourceRoute = resolveMurphAgeSourceRoute(pack.sourceRouteId);
  const seenMetricKeys = new Set<string>();

  if (pack.schemaVersion !== MURPH_AGE_FUNCTION_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual parameter pack has an unsupported schema version.",
    });
  }
  if (pack.layerId !== "function-mobility-residual-v1") {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual parameter pack does not match the residual layer id.",
    });
  }
  if (pack.anchorCardId !== input.anchorCardId || !MURPH_AGE_FUNCTION_RESIDUAL_ANCHOR_CARD_IDS.includes(pack.anchorCardId)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Function residual parameter pack anchor card is not compatible with the selected anchor.",
    });
  }
  if (pack.endpoint !== "10-year all-cause mortality" || pack.horizonYears !== 10) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Function residual parameter pack must target the locked 10-year all-cause mortality endpoint.",
    });
  }
  if (!sourceRoute || !sourceRoute.featureFamilies.includes("function")) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Function residual parameter pack source route must be a registered function/mobility route.",
    });
  }
  if (pack.deploymentRights === "not-authorized") {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Function residual parameter pack is not authorized for residual scoring.",
    });
  }
  if (
    pack.deploymentRights !== "not-authorized"
    && pack.deploymentRights !== "product-authorized"
    && pack.deploymentRights !== "research-only"
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Function residual parameter pack deployment rights are not recognized.",
    });
  }
  if (pack.deploymentRights === "product-authorized" && !MURPH_AGE_PRODUCT_PROMOTION_EVIDENCE_TIERS.has(pack.evidenceTier)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Product-authorized function residual parameter packs require product-promotion evidence tiers.",
    });
  }
  if (!MURPH_AGE_VALIDATION_EVIDENCE_TIERS.has(pack.evidenceTier)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Function residual parameter pack evidence tier is not recognized.",
    });
  }
  if (!Number.isFinite(pack.intercept) || !Number.isFinite(pack.calibrationIntercept)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual parameter pack intercepts must be finite.",
    });
  }
  if (!Number.isFinite(pack.calibrationSlope) || pack.calibrationSlope <= 0) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual parameter pack calibration slope must be positive and finite.",
    });
  }
  if (!Number.isFinite(pack.globalFunctionCapLogit) || pack.globalFunctionCapLogit <= 0 || pack.globalFunctionCapLogit > 1) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual parameter pack global cap must be finite and between 0 and 1 logit.",
    });
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(pack.packHash)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Function residual parameter pack hash must be a stable sha256 artifact digest.",
    });
  }
  if (pack.featureWeights.length === 0) {
    warnings.push({
      code: "MODEL_FEATURE_MISSING",
      message: "Function residual parameter pack must include at least one feature weight.",
    });
  }
  for (const feature of pack.featureWeights) {
    const metricKey = resolveMetricInputKey(feature.metricKey);
    if (!metricKey || !MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS.has(metricKey)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: "Function residual parameter pack feature metric must be a function/mobility context metric.",
        metricKey: feature.metricKey,
      });
    }
    if (metricKey && seenMetricKeys.has(metricKey)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: "Function residual parameter pack feature metrics must be unique.",
        metricKey,
      });
    }
    if (metricKey) seenMetricKeys.add(metricKey);
    if (feature.transform !== "center-scale") {
      warnings.push({
        code: "TRANSFORM_UNSUPPORTED",
        message: "Function residual parameter pack feature transform is not supported.",
        metricKey: feature.metricKey,
      });
    }
    if (
      !Number.isFinite(feature.coefficient)
      || !Number.isFinite(feature.center)
      || !Number.isFinite(feature.scale)
      || feature.scale <= 0
    ) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "Function residual parameter pack feature weights must have finite coefficient, center, and positive scale.",
        metricKey: feature.metricKey,
      });
    }
  }

  return {
    status: warnings.length === 0 ? "valid" : "invalid",
    warnings,
  };
}

function selectMurphAgeFunctionResidualMetricKeys(input: {
  asOf?: string;
  points: readonly MetricPoint[];
}): string[] {
  return [...MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS].filter((metricKey) => {
    const selection = selectMetricValue({
      metricKey,
      now: input.asOf,
      points: input.points,
    });
    return selection.status === "ready" && selection.value !== null && Number.isFinite(selection.value);
  });
}

export function listMurphAgeInputBundleMetricKeys(): string[] {
  return [...MURPH_AGE_INPUT_BUNDLE_METRIC_KEYS];
}

export function listMurphAgeSubmittedCalculatorMetricInputSpecs():
  MurphAgeSubmittedCalculatorMetricInputSpec[] {
  const specs: MurphAgeSubmittedCalculatorMetricInputSpec[] = [];
  for (const metricKey of listMurphAgeInputBundleMetricKeys()) {
    const definition = resolveMetricDefinition(metricKey);
    specs.push({
      allowedSourceKinds: listSubmittedCalculatorAllowedSourceKinds(metricKey),
      aliases: [...(definition?.aliases ?? [])],
      calculatorRoles: listSubmittedCalculatorMetricRoles(metricKey),
      canonicalUnit: definition?.canonicalUnit ?? null,
      category: definition?.category ?? "custom",
      displayName: definition?.displayName ?? metricKey,
      featureKeys: listSubmittedCalculatorFeatureKeys(metricKey),
      metricKey,
      productScoreBearingAuthorized: isSubmittedCalculatorProductScoreBearingAuthorized(metricKey),
      researchScoreBearingCardIds: listSubmittedCalculatorResearchScoreBearingCardIds(metricKey),
      wearableScoreBearingAuthorized: false,
    });
  }
  return specs.sort((left, right) => left.metricKey.localeCompare(right.metricKey));
}

export function listMurphAgeSubmittedCalculatorInputBundleSpecs():
  MurphAgeSubmittedCalculatorInputBundleSpec[] {
  const lab9RequiredFeatureKeys = [
    ...MURPH_AGE_LAB9_FEATURES.map((feature) => feature.featureKey),
    ...MURPH_AGE_BP_BODY_FEATURES
      .filter((feature) => feature.requiredFor === "lab9-mainline")
      .map((feature) => feature.featureKey),
  ];
  const lab5RequiredFeatureKeys = MURPH_AGE_LAB5_FEATURES.map((feature) => feature.featureKey);
  const l1bGlycemiaBodyRequiredFeatureKeys = MURPH_AGE_L1B_GLYCEMIA_BODY_FEATURES.map((feature) => feature.featureKey);
  const l1GlycemiaRequiredFeatureKeys = MURPH_AGE_L1_GLYCEMIA_FEATURES.map((feature) => feature.featureKey);
  return [
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "l1b-glycemia-body",
      cardId: "l1b_glycemia_body_10y_acm_research",
      completion: {
        alternativeFeatureKeyGroups: [],
        minReadyFeatureCount: null,
        requiredFeatureKeys: l1bGlycemiaBodyRequiredFeatureKeys,
        rule: "glycemia-plus-body",
      },
      displayName: "L1b glycemia/body current-alpha research bundle",
      featureRequirements: MURPH_AGE_L1B_GLYCEMIA_BODY_FEATURES,
      requiredFeatureKeys: l1bGlycemiaBodyRequiredFeatureKeys,
      researchAgeEstimateEligible: true,
      scoreBearing: true,
    }),
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "lab9-bp-body",
      cardId: "lab9_bp_body_10y_acm_research",
      completion: {
        alternativeFeatureKeyGroups: [],
        minReadyFeatureCount: null,
        requiredFeatureKeys: lab9RequiredFeatureKeys,
        rule: "all-required-features",
      },
      displayName: "Lab9 BP/body research bundle",
      featureRequirements: [...MURPH_AGE_LAB9_FEATURES, ...MURPH_AGE_BP_BODY_FEATURES],
      requiredFeatureKeys: lab9RequiredFeatureKeys,
      researchAgeEstimateEligible: true,
      scoreBearing: true,
    }),
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "lab5-bp-bmi",
      cardId: "lab5_bp_bmi_transport_research",
      completion: {
        alternativeFeatureKeyGroups: [
          ["bmi"],
          ["systolic-blood-pressure", "diastolic-blood-pressure"],
        ],
        minReadyFeatureCount: null,
        requiredFeatureKeys: lab5RequiredFeatureKeys,
        rule: "all-lab5-features-plus-bmi-or-blood-pressure",
      },
      displayName: "Lab5 BP/BMI fallback research bundle",
      featureRequirements: [
        ...MURPH_AGE_LAB5_FEATURES,
        ...MURPH_AGE_BP_BODY_FEATURES.filter((feature) =>
          ["bmi", "diastolic-blood-pressure", "systolic-blood-pressure"].includes(feature.featureKey)
        ),
      ],
      requiredFeatureKeys: lab5RequiredFeatureKeys,
      researchAgeEstimateEligible: true,
      scoreBearing: true,
    }),
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "l1-glycemia",
      cardId: "l1_tiny_glycemia_10y_acm_research",
      completion: {
        alternativeFeatureKeyGroups: [],
        minReadyFeatureCount: 1,
        requiredFeatureKeys: l1GlycemiaRequiredFeatureKeys,
        rule: "one-or-more-glycemia-features",
      },
      displayName: "L1 glycemia research bundle",
      featureRequirements: MURPH_AGE_L1_GLYCEMIA_FEATURES,
      requiredFeatureKeys: l1GlycemiaRequiredFeatureKeys,
      researchAgeEstimateEligible: true,
      scoreBearing: true,
    }),
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "r399-nhis-proxy-anchor",
      cardId: "r399_nhis_proxy_10y_acm_research",
      completion: {
        alternativeFeatureKeyGroups: [],
        minReadyFeatureCount: 1,
        requiredFeatureKeys: [],
        rule: "one-or-more-proxy-features",
      },
      displayName: "R399 survey/proxy anchor research bundle",
      featureRequirements: MURPH_AGE_R399_PROXY_FEATURES,
      requiredFeatureKeys: [],
      researchAgeEstimateEligible: true,
      scoreBearing: true,
    }),
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "wearable-context",
      cardId: "wearable_context_no_risk",
      completion: {
        alternativeFeatureKeyGroups: [],
        minReadyFeatureCount: 1,
        requiredFeatureKeys: [],
        rule: "one-or-more-context-features",
      },
      displayName: "Wearable activity/sleep context bundle",
      featureRequirements: MURPH_AGE_WEARABLE_CONTEXT_FEATURES,
      requiredFeatureKeys: [],
      researchAgeEstimateEligible: false,
      scoreBearing: false,
    }),
    buildSubmittedCalculatorInputBundleSpec({
      bundleId: "function-context",
      cardId: "function_context_no_risk",
      completion: {
        alternativeFeatureKeyGroups: [],
        minReadyFeatureCount: 1,
        requiredFeatureKeys: [],
        rule: "one-or-more-context-features",
      },
      displayName: "Function/frailty context bundle",
      featureRequirements: MURPH_AGE_FUNCTION_CONTEXT_FEATURES,
      requiredFeatureKeys: [],
      researchAgeEstimateEligible: false,
      scoreBearing: false,
    }),
  ];
}

export function summarizeMurphAgeSubmittedCalculatorCapabilities():
  MurphAgeSubmittedCalculatorCapabilitySummary {
  const metricSpecs = listMurphAgeSubmittedCalculatorMetricInputSpecs();
  const bundleSpecs = listMurphAgeSubmittedCalculatorInputBundleSpecs();
  const wearableBridgeSpecs = listMurphAgeWearableBridgeFeatureSpecs();
  const cardPolicies = listMurphAgeModelCardPolicies();
  let productAgeDisplayAuthorized = false;
  let productRiskDisplayAuthorized = false;
  for (const policy of cardPolicies) {
    if (isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy)) {
      productAgeDisplayAuthorized = true;
    }
    if (isMurphAgeModelCardProductAuthorized(policy)) {
      productRiskDisplayAuthorized = true;
    }
  }

  const acceptedMetricKeys: string[] = [];
  const acceptedSourceKinds = new Set<MurphAgeSubmittedMetricSourceKind>();
  const productScoreBearingMetricKeys: string[] = [];
  const researchScoreBearingMetricKeys: string[] = [];
  const wearableContextMetricKeys: string[] = [];
  const wearableScoreBearingMetricKeys: string[] = [];
  for (const spec of metricSpecs) {
    acceptedMetricKeys.push(spec.metricKey);
    for (const sourceKind of spec.allowedSourceKinds) {
      acceptedSourceKinds.add(sourceKind);
    }
    if (spec.productScoreBearingAuthorized) {
      productScoreBearingMetricKeys.push(spec.metricKey);
    }
    if (spec.researchScoreBearingCardIds.length > 0) {
      researchScoreBearingMetricKeys.push(spec.metricKey);
    }
    if (spec.calculatorRoles.includes("wearable-context")) {
      wearableContextMetricKeys.push(spec.metricKey);
    }
    if (spec.wearableScoreBearingAuthorized) {
      wearableScoreBearingMetricKeys.push(spec.metricKey);
    }
  }

  const bundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[] = [];
  const contextBundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[] = [];
  const researchAgeEstimateEligibleBundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[] = [];
  const scoreBearingBundleIds: MurphAgeSubmittedCalculatorInputBundleSpecId[] = [];
  for (const spec of bundleSpecs) {
    bundleIds.push(spec.bundleId);
    if (!spec.scoreBearing) {
      contextBundleIds.push(spec.bundleId);
    }
    if (spec.researchAgeEstimateEligible) {
      researchAgeEstimateEligibleBundleIds.push(spec.bundleId);
    }
    if (spec.scoreBearing) {
      scoreBearingBundleIds.push(spec.bundleId);
    }
  }

  return {
    acceptedMetricKeys: sortCapabilityStringValues(acceptedMetricKeys),
    acceptedSourceKinds: sortSubmittedMetricSourceKinds([...acceptedSourceKinds]),
    acceptedUserInputFamilies: [...MURPH_AGE_SUBMITTED_CALCULATOR_USER_INPUT_FAMILIES],
    bundleIds,
    contextBundleIds,
    outputBoundary: {
      modelParametersExportAllowed: false,
      participantLevelExportAllowed: false,
      productScoreDisplayAuthorized: productAgeDisplayAuthorized || productRiskDisplayAuthorized,
      researchPreviewRequiresExplicitOptIn: true,
      rowValuesExportAllowed: false,
      submittedMetricScalarEchoAllowed: false,
    },
    productAgeDisplayAuthorized,
    productRiskDisplayAuthorized,
    productScoreBearingMetricKeys: sortCapabilityStringValues(productScoreBearingMetricKeys),
    researchAgeEstimateEligibleBundleIds,
    researchPreviewSupported: true,
    researchScoreBearingMetricKeys: sortCapabilityStringValues(researchScoreBearingMetricKeys),
    runtimeInputKeys: ["chronological-age-years", "sex"],
    schemaVersion: MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
    scoreBearingBundleIds,
    wearableContextMetricKeys: sortCapabilityStringValues(wearableContextMetricKeys),
    wearableDeferredFeatureKeys: listWearableCapabilityFeatureKeys(wearableBridgeSpecs, "defer"),
    wearableFirstPriorityFeatureKeys: listWearableCapabilityFeatureKeys(wearableBridgeSpecs, "first"),
    wearableFirstPriorityMetricKeys: listWearableCapabilityMetricKeys(wearableBridgeSpecs, "first"),
    wearableScoreBearingMetricKeys: sortCapabilityStringValues(wearableScoreBearingMetricKeys),
    wearableSecondPriorityFeatureKeys: listWearableCapabilityFeatureKeys(wearableBridgeSpecs, "second"),
    wearableSecondPriorityMetricKeys: listWearableCapabilityMetricKeys(wearableBridgeSpecs, "second"),
  };
}

function listWearableCapabilityFeatureKeys(
  specs: readonly MurphAgeWearableBridgeFeatureSpec[],
  unlockPriority: MurphAgeWearableBridgeUnlockPriority,
): string[] {
  const featureKeys: string[] = [];
  for (const spec of specs) {
    if (spec.unlockPriority === unlockPriority) {
      featureKeys.push(spec.featureKey);
    }
  }
  return sortCapabilityStringValues(featureKeys);
}

function listWearableCapabilityMetricKeys(
  specs: readonly MurphAgeWearableBridgeFeatureSpec[],
  unlockPriority: MurphAgeWearableBridgeUnlockPriority,
): string[] {
  const metricKeys: string[] = [];
  for (const spec of specs) {
    if (spec.unlockPriority === unlockPriority) {
      metricKeys.push(...spec.metricKeys);
    }
  }
  return sortCapabilityStringValues(uniqueStrings(metricKeys));
}

function sortCapabilityStringValues(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortSubmittedMetricSourceKinds(
  values: readonly MurphAgeSubmittedMetricSourceKind[],
): MurphAgeSubmittedMetricSourceKind[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function buildSubmittedCalculatorInputBundleSpec(input: {
  bundleId: MurphAgeSubmittedCalculatorInputBundleSpecId;
  cardId: MurphAgeModelCardId;
  completion: MurphAgeSubmittedCalculatorInputBundleCompletionRule;
  displayName: string;
  featureRequirements: readonly MurphAgeInputFeatureRequirement[];
  requiredFeatureKeys: readonly string[];
  researchAgeEstimateEligible: boolean;
  scoreBearing: boolean;
}): MurphAgeSubmittedCalculatorInputBundleSpec {
  const requiredFeatureKeys = new Set(input.requiredFeatureKeys);
  return {
    bundleId: input.bundleId,
    cardId: input.cardId,
    completion: {
      alternativeFeatureKeyGroups: input.completion.alternativeFeatureKeyGroups.map((group) => [...group]),
      minReadyFeatureCount: input.completion.minReadyFeatureCount,
      requiredFeatureKeys: [...input.completion.requiredFeatureKeys],
      rule: input.completion.rule,
    },
    displayName: input.displayName,
    featureSpecs: input.featureRequirements.map((feature) => ({
      displayName: feature.label,
      featureKey: feature.featureKey,
      metricKeys: [...feature.metricKeys],
      requiredForCompletion: requiredFeatureKeys.has(feature.featureKey),
    })),
    productScoreBearingAuthorized: isSubmittedCalculatorProductScoreBearingAuthorizedForCard(input.cardId),
    researchAgeEstimateEligible: input.researchAgeEstimateEligible,
    schemaVersion: MURPH_AGE_SUBMITTED_CALCULATOR_INPUT_BUNDLE_SPEC_SCHEMA_VERSION,
    scoreBearing: input.scoreBearing,
  };
}

function isSubmittedCalculatorProductScoreBearingAuthorizedForCard(cardId: MurphAgeModelCardId): boolean {
  const policy = resolveMurphAgeModelCardPolicy(cardId);
  return policy ? isMurphAgeModelCardProductAuthorized(policy) : false;
}

export function summarizeMurphAgePublicLabWearableShadowEvidenceStatus():
  MurphAgePublicLabWearableShadowEvidenceStatus {
  const sourceRouteIdsByExecutionPriority = listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority().map(
    (route) => route.routeId,
  );
  const nextExternalOrPartnerRouteIdsByPriority = sourceRouteIdsByExecutionPriority.filter(
    (routeId) => routeId !== "nhanes-activity-shadow-lmf",
  );

  return {
    conclusion: "public_multi_family_wearable_shadow_signal_mixed_keep_context_only",
    externalConsumerLabWearableAggregateStillMissing: true,
    includedPacketIds: MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_PACKETS.map((packet) => packet.packetId),
    inputPriority: "ordinary-16-50-labs-plus-multi-family-wearables",
    nextAction: "run_external_or_partner_lab_wearable_aggregate_delta",
    nextExternalOrPartnerRouteIdsByPriority,
    packets: MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_PACKETS.map(
      cloneMurphAgePublicLabWearableShadowEvidencePacket,
    ),
    productDisplayAuthorized: false,
    publicAggregateOnly: true,
    reviewGptEscalation: "only-after-source-boundary-change-or-real-aggregate-delta",
    reviewGptRequiredNow: false,
    schemaVersion: MURPH_AGE_PUBLIC_LAB_WEARABLE_SHADOW_EVIDENCE_STATUS_SCHEMA_VERSION,
    sourceRouteIdsByEvidencePriority: uniqueStrings([
      "nhanes-activity-shadow-lmf",
      ...nextExternalOrPartnerRouteIdsByPriority,
    ]) as MurphAgeSourceRouteId[],
    usableAsConsumerWearableValidation: false,
    wearableScoreBearingAuthorized: false,
  };
}

export function summarizeMurphAgeArchitecture(): MurphAgeArchitectureSummary {
  const ordinaryLabWearableAutoresearchSourceRouteIdsByExecutionPriority =
    listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority().map((route) => route.routeId);
  const ordinaryLabWearableSourceRouteIdsByPriority = listMurphAgeOrdinaryLabWearableSourceRoutes().map(
    (route) => route.routeId,
  );
  const publicLabWearableShadowEvidenceStatus = summarizeMurphAgePublicLabWearableShadowEvidenceStatus();
  const sourceRouteIdsByPriority = listMurphAgePrioritySourceRoutes().map((route) => route.routeId);
  const wearableScoreBearingStrategy: MurphAgeWearableScoreBearingStrategy =
    summarizeMurphAgeWearableScoreBearingStrategy();
  const layers: MurphAgeArchitectureLayerSummary[] = [
    architectureLayerFromPolicies({
      blockedUntil: "Keep frozen until external or Murph-native validation supports product promotion and age display.",
      currentUse: "Frozen research outcome-risk anchor for later biomarker, function, and wearable increments.",
      layerId: "outcome-anchor",
      mode: "score-bearing-research",
      modelCardIds: ["r399_nhis_proxy_10y_acm_research"],
      scoreContributionAuthorized: true,
      sourceRouteIds: ["nhis-r399-outcome-anchor"],
    }),
    architectureLayerFromPolicies({
      blockedUntil: "Keep research-only until lab/body increments transport across independent cohorts with calibrated uncertainty.",
      currentUse: "Research-only clinical lab, blood-pressure, and body-composition risk cards.",
      layerId: "clinical-lab-body",
      mode: "score-bearing-research",
      modelCardIds: [
        "l1b_glycemia_body_10y_acm_research",
        "lab9_bp_body_10y_acm_research",
        "lab5_bp_bmi_transport_research",
        "l1_tiny_glycemia_10y_acm_research",
      ],
      scoreContributionAuthorized: true,
      sourceRouteIds: [
        "midus-biomarker-mortality",
        "creles-transport-stress",
        "nhanes-activity-shadow-lmf",
        "cardia-biomarker-activity",
        "hchs-sol-biomarker-activity",
        "nhanes-iii-lmf-sanity",
        "nhanes-bench0-lab-body",
      ],
    }),
    architectureLayerFromPolicies({
      blockedUntil: "Keep out of product and scoring math until a bounded parameter pack plus fresh validation support a score-bearing sidecar.",
      contextMetricKeys: [...MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS],
      currentUse: "Lead bounded research sidecar candidate and explanation context, with scoring pending parameterization.",
      layerId: "function-cognition-context",
      mode: "context-only",
      modelCardIds: ["function_context_no_risk"],
      scoreContributionAuthorized: false,
      sourceRouteIds: ["mhas-harmonized-aging", "nshap-integrated-aging"],
    }),
    architectureLayerFromPolicies({
      blockedUntil: "Wearables stay shadow-only until source-linked hard-outcome evidence validates residual increments over the anchor.",
      contextMetricKeys: [...MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS],
      currentUse: "Wearable bridge and shadow-increment candidates for activity, sleep, resting heart rate, and HRV.",
      layerId: "wearable-shadow",
      mode: "shadow-only",
      modelCardIds: ["wearable_context_no_risk"],
      scoreContributionAuthorized: false,
      shadowMetricKeys: MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.flatMap((policy) => policy.signalMetricKeys),
      sourceRouteIds: sourceRouteIdsByPriority.filter((routeId) =>
        resolveMurphAgeSourceRoute(routeId)?.layers.includes("wearable-shadow-increment") === true
      ),
    }),
    {
      blockedUntil: "Use only aggregate receipts and source cards until a source produces suppressed validation evidence.",
      blockerCodes: [],
      candidateMetricKeys: [],
      contextMetricKeys: [],
      currentUse: "Route-level source prioritization and external/transport validation planning.",
      evidenceClasses: [],
      featureFamilies: featureFamiliesForRoutes(sourceRouteIdsByPriority.filter((routeId) => {
        const route = resolveMurphAgeSourceRoute(routeId);
        return route?.layers.includes("transport-validation") === true
          || route?.layers.includes("partner-aggregate-validation") === true;
      })),
      layerId: "source-validation",
      mode: "validation-only",
      modelCardIds: [],
      productAuthorized: false,
      riskToAgeDisplayAuthorized: false,
      scoreBearing: false,
      scoreBearingMetricKeys: [],
      scoreContributionAuthorized: false,
      shadowMetricKeys: [],
      sourceRouteIds: sourceRouteIdsByPriority.filter((routeId) => {
        const route = resolveMurphAgeSourceRoute(routeId);
        return route?.layers.includes("transport-validation") === true
          || route?.layers.includes("partner-aggregate-validation") === true;
      }),
    },
    {
      blockedUntil: "Do not expose Murph Age in product until a card is product-authorized with promotion evidence and risk-to-age display approval.",
      blockerCodes: uniqueStrings(MURPH_AGE_MODEL_CARD_POLICIES.flatMap((policy) =>
        listMurphAgeModelCardProductPromotionBlockers(policy)
      )) as MurphAgeProductPromotionBlocker[],
      candidateMetricKeys: [],
      contextMetricKeys: [],
      currentUse: "Global product display remains blocked.",
      evidenceClasses: uniqueStrings(MURPH_AGE_MODEL_CARD_POLICIES.map((policy) => policy.evidenceClass)) as MurphAgeEvidenceClass[],
      featureFamilies: [],
      layerId: "product-display",
      mode: "blocked",
      modelCardIds: MURPH_AGE_MODEL_CARD_POLICIES.map((policy) => policy.cardId),
      productAuthorized: false,
      riskToAgeDisplayAuthorized: false,
      scoreBearing: false,
      scoreBearingMetricKeys: [],
      scoreContributionAuthorized: false,
      shadowMetricKeys: [],
      sourceRouteIds: [],
    },
  ];

  return {
    layerOrder: [...MURPH_AGE_ARCHITECTURE_LAYER_ORDER],
    layers,
    ordinaryLabWearableAutoresearchSourceRouteIdsByExecutionPriority,
    ordinaryLabWearableSourceRouteIdsByPriority,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    publicLabWearableShadowEvidenceStatus,
    riskToAgeDisplayAuthorized: false,
    schemaVersion: MURPH_AGE_ARCHITECTURE_SUMMARY_SCHEMA_VERSION,
    sourceRouteIdsByPriority,
    wearableScoreBearingStrategy,
  };
}

function cloneMurphAgePublicLabWearableShadowEvidencePacket(
  packet: MurphAgePublicLabWearableShadowEvidencePacket,
): MurphAgePublicLabWearableShadowEvidencePacket {
  return {
    ...packet,
    aggregateMetricDeltas: { ...packet.aggregateMetricDeltas },
  };
}

function cloneMurphAgeWearableScoreBearingFamilyPolicy(
  policy: MurphAgeWearableScoreBearingFamilyPolicy,
): MurphAgeWearableScoreBearingFamilyPolicy {
  return {
    ...policy,
    qualityMetricKeys: [...policy.qualityMetricKeys],
    signalMetricKeys: [...policy.signalMetricKeys],
  };
}

function cloneMurphAgeWearableParameterPackContract(
  contract: MurphAgeWearableParameterPackContract,
): MurphAgeWearableParameterPackContract {
  return {
    ...contract,
    familyPriorityOrder: [...contract.familyPriorityOrder],
    requiredFields: [...contract.requiredFields],
    supportedDeploymentRights: [...contract.supportedDeploymentRights],
  };
}

function cloneMurphAgeWearableResidualLayerContract(
  contract: MurphAgeWearableResidualLayerContract,
): MurphAgeWearableResidualLayerContract {
  return {
    ...contract,
    anchorCardIds: [...contract.anchorCardIds],
    parameterPackContract: cloneMurphAgeWearableParameterPackContract(contract.parameterPackContract),
    deferredFamilyOrder: [...contract.deferredFamilyOrder],
    featureSetContract: {
      ...contract.featureSetContract,
      activityVolumeCandidateMetricKeys: [...contract.featureSetContract.activityVolumeCandidateMetricKeys],
      coverageControlMetricKeys: [...contract.featureSetContract.coverageControlMetricKeys],
    },
    nuisanceControlMetricKeys: [...contract.nuisanceControlMetricKeys],
    primaryDecisionComparisons: [...contract.primaryDecisionComparisons],
    qualityGateMetricKeys: [...contract.qualityGateMetricKeys],
    requiredPromotionSignals: [...contract.requiredPromotionSignals],
    signalMetricKeys: [...contract.signalMetricKeys],
  };
}

function architectureLayerFromPolicies(input: {
  blockedUntil: string;
  contextMetricKeys?: readonly string[];
  currentUse: string;
  layerId: MurphAgeArchitectureLayerId;
  mode: MurphAgeArchitectureLayerMode;
  modelCardIds: readonly MurphAgeModelCardId[];
  scoreContributionAuthorized: boolean;
  shadowMetricKeys?: readonly string[];
  sourceRouteIds: readonly MurphAgeSourceRouteId[];
}): MurphAgeArchitectureLayerSummary {
  const policies = input.modelCardIds
    .map((cardId) => MURPH_AGE_MODEL_CARD_POLICIES.find((policy) => policy.cardId === cardId) ?? null)
    .filter((policy): policy is MurphAgeModelCardPolicy => policy !== null);
  const scoreBearingMetricKeys = uniqueStrings(policies.flatMap((policy) => policy.scoreBearingMetricKeys));
  const shadowMetricKeys = uniqueStrings(input.shadowMetricKeys ?? []);
  const contextMetricKeys = uniqueStrings(input.contextMetricKeys ?? []);
  return {
    blockedUntil: input.blockedUntil,
    blockerCodes: uniqueStrings(policies.flatMap((policy) =>
      listMurphAgeModelCardProductPromotionBlockers(policy)
    )) as MurphAgeProductPromotionBlocker[],
    candidateMetricKeys: uniqueStrings([
      ...scoreBearingMetricKeys,
      ...shadowMetricKeys,
      ...contextMetricKeys,
    ]),
    contextMetricKeys,
    currentUse: input.currentUse,
    evidenceClasses: uniqueStrings(policies.map((policy) => policy.evidenceClass)) as MurphAgeEvidenceClass[],
    featureFamilies: featureFamiliesForRoutes(input.sourceRouteIds),
    layerId: input.layerId,
    mode: input.mode,
    modelCardIds: [...input.modelCardIds],
    productAuthorized: false,
    riskToAgeDisplayAuthorized: false,
    scoreBearing: policies.some((policy) => policy.scoreBearing),
    scoreBearingMetricKeys,
    scoreContributionAuthorized: input.scoreContributionAuthorized,
    shadowMetricKeys,
    sourceRouteIds: existingSourceRouteIds(input.sourceRouteIds),
  };
}

function existingSourceRouteIds(routeIds: readonly MurphAgeSourceRouteId[]): MurphAgeSourceRouteId[] {
  return uniqueStrings(routeIds.filter((routeId) => resolveMurphAgeSourceRoute(routeId) !== null)) as MurphAgeSourceRouteId[];
}

function featureFamiliesForRoutes(routeIds: readonly MurphAgeSourceRouteId[]): string[] {
  return uniqueStrings(
    routeIds.flatMap((routeId) => resolveMurphAgeSourceRoute(routeId)?.featureFamilies ?? []),
  );
}

export function isMurphAgePublicFeatureKey(value: string): boolean {
  const simpleKey = toPublicSimpleKey(value);
  return simpleKey === value
    && (MURPH_AGE_PUBLIC_FEATURE_KEYS.has(value) || MURPH_AGE_PUBLIC_FALLBACK_FEATURE_KEYS.has(value));
}

export function isMurphAgePublicMetricKey(value: string): boolean {
  const simpleKey = toPublicSimpleKey(value);
  return simpleKey === value && MURPH_AGE_PUBLIC_METRIC_KEYS.has(value);
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
  if (MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS.has(metricKey)) {
    return point.source.kind === "measurement";
  }
  if (MURPH_AGE_R399_PROXY_METRIC_KEYS.has(metricKey)) {
    return MURPH_AGE_R399_PROXY_SOURCE_KINDS.includes(
      point.source.kind as typeof MURPH_AGE_R399_PROXY_SOURCE_KINDS[number],
    );
  }
  return point.source.kind === "measurement" || point.source.kind === "test-result";
}

export function resolveMurphAgeModelCardPolicy(
  cardId: MurphAgeInputBundleAssessment["recommendedCardId"] | MurphAgeModelCardId,
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

export function listMurphAgeModelCardProductPromotionBlockers(
  policy: MurphAgeModelCardPolicy,
): MurphAgeProductPromotionBlocker[] {
  const blockers: MurphAgeProductPromotionBlocker[] = [];
  if (!policy.productAuthorized) blockers.push("PRODUCT_POLICY_NOT_AUTHORIZED");
  if (policy.validationGate.status !== "passed") blockers.push("VALIDATION_GATE_BLOCKED");
  if (!policy.validationGate.productPromotionEvidence) blockers.push("PRODUCT_PROMOTION_EVIDENCE_MISSING");
  if (!hasMurphAgeProductPromotionEvidenceTier(policy.validationGate)) {
    blockers.push("PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING");
  }
  if (!policy.riskToAgeDisplayAuthorized) blockers.push("RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED");
  return blockers;
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

export function resolveMurphAgeWearableBridgeMetricSourceHint(
  metricKey: string,
): MurphAgeWearableBridgeMetricSourceHint | null {
  const resolvedMetricKey = resolveMetricInputKey(metricKey);
  const hint = MURPH_AGE_WEARABLE_BRIDGE_METRIC_SOURCE_HINTS.find((candidate) =>
    candidate.metricKey === resolvedMetricKey
  ) ?? null;
  return hint ? cloneMurphAgeWearableBridgeMetricSourceHint(hint) : null;
}

export function assessMurphAgeWearableShadowIncrements(
  input: MurphAgeWearableShadowIncrementAssessmentInput,
): MurphAgeWearableShadowIncrementAssessment[] {
  return MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.map((policy) =>
    assessMurphAgeWearableShadowIncrementPolicy({ input, policy })
  );
}

export function buildMurphAgeIncrementEvaluationCard(
  input: MurphAgeIncrementEvaluationCardBuildInput,
): MurphAgeIncrementEvaluationCard {
  return {
    anchorCardId: input.anchorCardId,
    candidateBatchId: input.candidateBatchId,
    candidateId: input.candidateId,
    evaluation: {
      aggregateMetricDeltas: { ...input.aggregateMetricDeltas },
      comparator: "anchor-vs-anchor-plus-increment",
      evidenceTier: input.evidenceTier,
      sameDenominator: true,
      ...(input.aggregateSample ? { aggregateSample: { ...input.aggregateSample } } : {}),
      ...(input.anchorMetrics ? { anchorMetrics: { ...input.anchorMetrics } } : {}),
      ...(input.candidateMetrics ? { candidateMetrics: { ...input.candidateMetrics } } : {}),
    },
    flatteningAuthorized: false,
    layer: input.layer,
    outputBoundary: { ...MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY },
    productAuthorized: false,
    riskEffect: input.riskEffect,
    schemaVersion: MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: input.sourceRouteId,
  };
}

export function listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates(
  input: MurphAgeOrdinaryLabWearableAggregateEvidenceTemplateListInput = {},
): MurphAgeOrdinaryLabWearableAggregateEvidenceTemplate[] {
  const requestedRouteIds = input.sourceRouteIds ? new Set(input.sourceRouteIds) : null;
  const requestedLayers = input.layers ? new Set(input.layers) : null;
  const anchorCardId = input.anchorCardId ?? "r399_nhis_proxy_10y_acm_research";
  const candidateBatchId = input.candidateBatchId ?? "ordinary-lab-wearable-aggregate-v1";
  if (!isNonEmptySimpleKey(candidateBatchId)) {
    throw new TypeError("Ordinary lab/wearable evidence template candidate batch id must be a non-empty simple key.");
  }

  return listMurphAgeOrdinaryLabWearableSourceRoutes()
    .filter((route) => !requestedRouteIds || requestedRouteIds.has(route.routeId))
    .flatMap((route) =>
      MURPH_AGE_INCREMENT_EVALUATION_LAYERS
        .filter((layer) => route.layers.includes(layer))
        .filter((layer) => !requestedLayers || requestedLayers.has(layer))
        .map((layer) => ({
          acceptedAggregateMetricDeltaFields: [
            ...MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_DELTA_FIELDS,
          ],
          anchorCardId,
          candidateBatchId,
          candidateId: `${route.routeId}-${layer}`,
          flatteningAuthorized: false,
          layer,
          outputBoundary: { ...MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY },
          productAuthorized: false,
          requiredAggregateSampleFields: [
            ...MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SAMPLE_FIELDS,
          ],
          riskEffect: "aggregate-estimated",
          schemaVersion: MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SCHEMA_VERSION,
          scoreBearing: false,
          scoreContributionAuthorized: false,
          sourceRouteId: route.routeId,
        }))
    );
}

export function listMurphAgeWearableLabAggregateReceiptTemplates(
  input: { sourceRouteIds?: readonly MurphAgeSourceRouteId[] } = {},
): MurphAgeWearableLabAggregateReceiptTemplate[] {
  const requestedRouteIds = input.sourceRouteIds ? new Set(input.sourceRouteIds) : null;
  return listMurphAgeOrdinaryLabWearableSourceRoutes()
    .filter((route) => route.layers.includes("wearable-shadow-increment"))
    .filter((route) => !requestedRouteIds || requestedRouteIds.has(route.routeId))
    .map((route) => ({
      artifactBoundary: { ...MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY },
      denominator: {
        minimumEventCountForScienceDelta: 100,
        optionalFields: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OPTIONAL_DENOMINATOR_FIELDS],
        requiredFields: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_REQUIRED_DENOMINATOR_FIELDS],
        smallCellSuppressionRequired: true,
      },
      endpoint: {
        acceptedEndpointFamilies: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_FAMILY_VALUES].sort(),
        acceptedIndexDateRules: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_INDEX_DATE_RULE_VALUES].sort(),
        acceptedOutcomeAscertainments: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OUTCOME_ASCERTAINMENT_VALUES].sort(),
        endpointFrozenBeforeScoringRequired: true,
        outcomeLinkedRequired: true,
      },
      evaluatorFrozenBeforeExecutionRequired: true,
      evidenceTierOptions: [...MURPH_AGE_WEARABLE_SHADOW_RESULT_EVIDENCE_TIERS],
      metricFields: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_METRIC_FIELDS],
      modelIds: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS],
      negativeControlFields: [...MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_NEGATIVE_CONTROL_FIELDS],
      productAuthorized: false,
      receiptSchemaVersion: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
      sameDenominatorRequired: true,
      schemaVersion: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
      scoreBearing: false,
      scoreContributionAuthorized: false,
      sourceRouteAliases: listWearableLabAggregateReceiptSourceRouteAliases(route.routeId),
      sourceRouteId: route.routeId,
    }));
}

export function listMurphAgeWearableActivityBenchmarkCards(): MurphAgeWearableActivityBenchmarkCard[] {
  const sourceRoute = resolveMurphAgeSourceRoute("nhanes-activity-shadow-lmf");
  if (!sourceRoute) return [];
  return MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_DEFINITIONS.map((definition) => ({
      acceptedAggregateMetricDeltaFields: [
        ...MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_DELTA_FIELDS,
      ],
      accelerometryProtocol: definition.accelerometryProtocol,
      architecturePattern: "anchor-plus-wearable-residual-shadow",
      benchmarkId: definition.benchmarkId,
      benchmarkStatus: "locked-card-ready-for-local-adapter",
      denominatorPolicy: {
        adultAgeRangeYears: {
          max: 79,
          min: 40,
        },
        eligibleLinkedMortalityRequired: true,
        labBodyAnchorDenominatorRequired: true,
        objectiveActivityWindowRequired: true,
        publicUseRowsOnly: true,
        sameDenominatorRequired: true,
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
      evidenceClass: "public-same-family-shadow-benchmark",
      evidenceTierIfExecuted: "same-family-sanity",
      featureFamilies: [...MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_FEATURE_FAMILIES],
      measurementMethod: "research-actigraphy",
      modelLadder: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_MODEL_LADDER.map((step) => ({ ...step })),
      negativeControlPolicy: {
        coverageOnlyControlRequired: true,
        earlyEventWashoutRequired: true,
        reverseCausationSensitivityRequired: true,
        shuffledWithinAgeSexBinsRequired: true,
      },
      outputBoundary: { ...MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY },
      productAuthorized: false,
      requiredAggregateSampleFields: [
        ...MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SAMPLE_FIELDS,
      ],
      rowParsingAuthorized: false,
      schemaVersion: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_SCHEMA_VERSION,
      scoreBearing: false,
      scoreContributionAuthorized: false,
      selectionPolicy: {
        calibrationFirst: true,
        discriminationOnlySelectionAllowed: false,
        properScoresRequired: true,
        sameDenominatorComparisonsRequired: true,
        testSetMutationAuthorized: false,
      },
      sourceRouteId: sourceRoute.routeId === "nhanes-activity-shadow-lmf"
        ? sourceRoute.routeId
        : "nhanes-activity-shadow-lmf",
      splitPolicy: {
        aggregateSplitCountsExportOnly: true,
        frozenBeforeScoring: true,
        participantIdsExportAllowed: false,
        splitMembershipExportAllowed: false,
      },
      transformIds: [...MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_TRANSFORM_IDS],
    }));
}

export function validateMurphAgeWearableActivityBenchmarkCard(
  candidate: unknown,
): MurphAgeModelValidationResult {
  const subject = "Wearable activity benchmark card";
  const warnings: MurphAgeWarning[] = [];
  if (!isPlainRecord(candidate)) {
    return {
      status: "invalid",
      warnings: [{
        code: "INVALID_INPUT",
        message: `${subject} must be an object.`,
      }],
    };
  }

  appendUnknownObjectKeyWarnings({
    allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_KEYS,
    label: "root",
    object: candidate,
    subject,
    warnings,
  });

  const artifactBoundary = readPlainRecordField({
    key: "outputBoundary",
    label: "output boundary",
    object: candidate,
    subject,
    warnings,
  });
  const denominatorPolicy = readPlainRecordField({
    key: "denominatorPolicy",
    label: "denominator policy",
    object: candidate,
    subject,
    warnings,
  });
  const endpoint = readPlainRecordField({ key: "endpoint", label: "endpoint", object: candidate, subject, warnings });
  const negativeControlPolicy = readPlainRecordField({
    key: "negativeControlPolicy",
    label: "negative control policy",
    object: candidate,
    subject,
    warnings,
  });
  const selectionPolicy = readPlainRecordField({
    key: "selectionPolicy",
    label: "selection policy",
    object: candidate,
    subject,
    warnings,
  });
  const splitPolicy = readPlainRecordField({
    key: "splitPolicy",
    label: "split policy",
    object: candidate,
    subject,
    warnings,
  });

  if (candidate.schemaVersion !== MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_SCHEMA_VERSION) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} schema version is not supported.`,
    });
  }
  const expectedBenchmarkDefinition = MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_DEFINITIONS.find((definition) =>
    definition.benchmarkId === candidate.benchmarkId
  );
  if (!expectedBenchmarkDefinition) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} benchmark id is not supported.`,
    });
  }
  if (
    candidate.architecturePattern !== "anchor-plus-wearable-residual-shadow"
    || candidate.benchmarkStatus !== "locked-card-ready-for-local-adapter"
    || candidate.evidenceClass !== "public-same-family-shadow-benchmark"
    || candidate.evidenceTierIfExecuted !== "same-family-sanity"
    || candidate.measurementMethod !== "research-actigraphy"
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} must stay on the locked objective-activity residual-shadow benchmark path.`,
    });
  }
  if (
    expectedBenchmarkDefinition
    && candidate.accelerometryProtocol !== expectedBenchmarkDefinition.accelerometryProtocol
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} accelerometry protocol must match the frozen NHANES benchmark id.`,
    });
  }
  if (
    candidate.productAuthorized !== false
    || candidate.scoreBearing !== false
    || candidate.scoreContributionAuthorized !== false
    || candidate.rowParsingAuthorized !== false
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} must remain research-only, non-score-bearing, product-blocked, and not itself a row-parser authorization.`,
    });
  }
  if (candidate.sourceRouteId !== "nhanes-activity-shadow-lmf") {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} must target the NHANES activity shadow source route.`,
    });
  } else {
    const sourceRoute = resolveMurphAgeSourceRoute(candidate.sourceRouteId);
    if (!sourceRoute || !sourceRoute.layers.includes("wearable-shadow-increment")) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: `${subject} source route must be registered as a wearable shadow increment route.`,
      });
    } else if (sourceRoute.productAuthorized !== false || !isLockedSourceRouteArtifactBoundary(sourceRoute.artifactBoundary)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: `${subject} source route must stay metadata-only and product-blocked.`,
      });
    }
  }
  if (!artifactBoundary || !isLockedIncrementEvaluationOutputBoundary(artifactBoundary)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} output boundary must block rows, identifiers, split memberships, predictions, coefficients, model parameters, local paths, source text, and product display egress.`,
    });
  }
  if (artifactBoundary) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY_KEYS,
      label: "output boundary",
      object: artifactBoundary,
      subject,
      warnings,
    });
  }
  if (denominatorPolicy) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_DENOMINATOR_POLICY_KEYS,
      label: "denominator policy",
      object: denominatorPolicy,
      subject,
      warnings,
    });
    const ageRange = readPlainRecordField({
      key: "adultAgeRangeYears",
      label: "adult age range",
      object: denominatorPolicy,
      subject,
      warnings,
    });
    if (ageRange) {
      appendUnknownObjectKeyWarnings({
        allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_AGE_RANGE_KEYS,
        label: "adult age range",
        object: ageRange,
        subject,
        warnings,
      });
      if (ageRange.min !== 40 || ageRange.max !== 79) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} adult age range must remain frozen before scoring.`,
        });
      }
    }
    for (const key of [
      "eligibleLinkedMortalityRequired",
      "labBodyAnchorDenominatorRequired",
      "objectiveActivityWindowRequired",
      "publicUseRowsOnly",
      "sameDenominatorRequired",
    ]) {
      if (denominatorPolicy[key] !== true) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} denominator policy ${key} must be true.`,
        });
      }
    }
  }
  if (endpoint) {
    validateWearableLabAggregateReceiptEndpoint({ endpoint, subject, warnings });
  }
  if (splitPolicy) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_SPLIT_POLICY_KEYS,
      label: "split policy",
      object: splitPolicy,
      subject,
      warnings,
    });
    for (const [key, expected] of [
      ["aggregateSplitCountsExportOnly", true],
      ["frozenBeforeScoring", true],
      ["participantIdsExportAllowed", false],
      ["splitMembershipExportAllowed", false],
    ] as const) {
      if (splitPolicy[key] !== expected) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} split policy ${key} must be ${String(expected)}.`,
        });
      }
    }
  }
  if (negativeControlPolicy) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_NEGATIVE_CONTROL_POLICY_KEYS,
      label: "negative control policy",
      object: negativeControlPolicy,
      subject,
      warnings,
    });
    for (const key of MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_NEGATIVE_CONTROL_POLICY_KEYS) {
      if (negativeControlPolicy[key] !== true) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} negative control policy ${key} must be true.`,
        });
      }
    }
  }
  if (selectionPolicy) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_SELECTION_POLICY_KEYS,
      label: "selection policy",
      object: selectionPolicy,
      subject,
      warnings,
    });
    for (const [key, expected] of [
      ["calibrationFirst", true],
      ["discriminationOnlySelectionAllowed", false],
      ["properScoresRequired", true],
      ["sameDenominatorComparisonsRequired", true],
      ["testSetMutationAuthorized", false],
    ] as const) {
      if (selectionPolicy[key] !== expected) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} selection policy ${key} must be ${String(expected)}.`,
        });
      }
    }
  }
  validateWearableActivityBenchmarkArrayField({
    allowedValues: MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_DELTA_FIELDS,
    key: "acceptedAggregateMetricDeltaFields",
    object: candidate,
    subject,
    warnings,
  });
  validateWearableActivityBenchmarkArrayField({
    allowedValues: MURPH_AGE_ORDINARY_LAB_WEARABLE_EVIDENCE_TEMPLATE_SAMPLE_FIELDS,
    key: "requiredAggregateSampleFields",
    object: candidate,
    subject,
    warnings,
  });
  validateWearableActivityBenchmarkArrayField({
    allowedValues: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_FEATURE_FAMILIES,
    key: "featureFamilies",
    object: candidate,
    subject,
    warnings,
  });
  validateWearableActivityBenchmarkArrayField({
    allowedValues: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_TRANSFORM_IDS,
    key: "transformIds",
    object: candidate,
    subject,
    warnings,
  });
  validateWearableActivityBenchmarkModelLadder(candidate.modelLadder, warnings);

  return {
    status: warnings.length === 0 ? "valid" : "invalid",
    warnings,
  };
}

export function assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard(
  candidate: unknown,
): MurphAgeOrdinaryLabWearableAggregateEvidenceAssessment {
  const validation = validateMurphAgeIncrementEvaluationCard(candidate);
  const warnings = [...validation.warnings];
  const blockers: string[] = [];
  const routeId = isPlainRecord(candidate) && typeof candidate.sourceRouteId === "string"
    ? candidate.sourceRouteId
    : null;

  if (validation.status !== "valid") {
    appendOrdinaryLabWearableAggregateEvidenceBlocker({
      blockers,
      message: "Ordinary lab/wearable aggregate evidence requires a valid increment evaluation card.",
      reason: "increment_evaluation_card_invalid",
      warnings,
    });
  }
  const ordinaryRouteIds = new Set(listMurphAgeOrdinaryLabWearableSourceRoutes().map((route) => route.routeId));
  if (!routeId || !ordinaryRouteIds.has(routeId as MurphAgeSourceRouteId)) {
    appendOrdinaryLabWearableAggregateEvidenceBlocker({
      blockers,
      message: "Ordinary lab/wearable aggregate evidence must reference a ranked ordinary lab/wearable source route.",
      reason: "source_route_not_ordinary_lab_wearable",
      warnings,
    });
  }
  if (!isPlainRecord(candidate)) {
    return {
      blockers,
      routeId,
      status: "blocked",
      validation,
      warnings,
    };
  }

  const riskEffect = candidate.riskEffect;
  if (riskEffect !== "aggregate-estimated") {
    appendOrdinaryLabWearableAggregateEvidenceBlocker({
      blockers,
      message: "Ordinary lab/wearable aggregate evidence must be aggregate-estimated before it can advance model evidence.",
      reason: "risk_effect_not_aggregate_estimated",
      warnings,
    });
  }

  const evaluation = isPlainRecord(candidate.evaluation) ? candidate.evaluation : null;
  const aggregateMetricDeltas = evaluation && isPlainRecord(evaluation.aggregateMetricDeltas)
    ? evaluation.aggregateMetricDeltas
    : null;
  const aggregateSample = evaluation && isPlainRecord(evaluation.aggregateSample)
    ? evaluation.aggregateSample
    : null;
  if (!aggregateMetricDeltas || !hasFiniteIncrementEvaluationMetricDelta(aggregateMetricDeltas)) {
    appendOrdinaryLabWearableAggregateEvidenceBlocker({
      blockers,
      message: "Ordinary lab/wearable aggregate evidence requires at least one finite aggregate metric delta.",
      reason: "aggregate_metric_delta_missing",
      warnings,
    });
  }
  for (const [key, reason] of [
    ["evaluatedRowCount", "evaluated_row_count_missing"],
    ["eventCount", "event_count_missing"],
    ["minimumCellCount", "minimum_cell_count_missing"],
  ] as const) {
    if (!aggregateSample || !isPositiveIntegerValue(aggregateSample[key])) {
      appendOrdinaryLabWearableAggregateEvidenceBlocker({
        blockers,
        message: `Ordinary lab/wearable aggregate evidence requires a positive integer ${key}.`,
        reason,
        warnings,
      });
    }
  }

  return {
    blockers,
    routeId,
    status: blockers.length === 0 ? "ready" : "blocked",
    validation,
    warnings,
  };
}

export function summarizeMurphAgeOrdinaryLabWearableAggregateEvidence(
  candidates: readonly unknown[],
): MurphAgeOrdinaryLabWearableAggregateEvidenceSummary {
  const assessments = candidates.map(assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard);
  const readyRouteIds = new Set(
    assessments
      .filter((assessment) => assessment.status === "ready" && assessment.routeId)
      .map((assessment) => assessment.routeId),
  );
  const ordinaryRoutes = listMurphAgeOrdinaryLabWearableSourceRoutes();
  const readySourceRouteIds = ordinaryRoutes
    .map((route) => route.routeId)
    .filter((routeId) => readyRouteIds.has(routeId));
  const missingSourceRouteIds = ordinaryRoutes
    .map((route) => route.routeId)
    .filter((routeId) => !readyRouteIds.has(routeId));

  return {
    assessments,
    missingSourceRouteIds,
    readyCardCount: assessments.filter((assessment) => assessment.status === "ready").length,
    readySourceRouteIds,
    status: readySourceRouteIds.length > 0 ? "ready" : "blocked",
  };
}

export function validateMurphAgeWearableLabAggregateReceipt(
  candidate: unknown,
): MurphAgeModelValidationResult {
  const subject = "Wearable/lab aggregate receipt";
  const warnings: MurphAgeWarning[] = [];
  if (!isPlainRecord(candidate)) {
    return {
      status: "invalid",
      warnings: [{
        code: "INVALID_INPUT",
        message: `${subject} must be an object.`,
      }],
    };
  }

  appendUnknownObjectKeyWarnings({
    allowedKeys: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ROOT_KEYS,
    label: "root",
    object: candidate,
    subject,
    warnings,
  });

  const schemaVersion = readStringField({ key: "schemaVersion", label: "schema version", object: candidate, subject, warnings });
  const receiptId = readStringField({ key: "receiptId", label: "receipt id", object: candidate, subject, warnings });
  const sourceRouteId = readStringField({ key: "sourceRouteId", label: "source route id", object: candidate, subject, warnings });
  const evidenceTier = readStringField({ key: "evidenceTier", object: candidate, label: "evidence tier", subject, warnings });
  const sameDenominator = readBooleanField({ key: "sameDenominator", label: "same denominator", object: candidate, subject, warnings });
  const evaluatorFrozen = readBooleanField({
    key: "evaluatorFrozenBeforeExecution",
    label: "evaluator frozen before execution",
    object: candidate,
    subject,
    warnings,
  });
  const productAuthorized = readBooleanField({ key: "productAuthorized", label: "product authorized", object: candidate, subject, warnings });
  const scoreBearing = readBooleanField({ key: "scoreBearing", label: "score bearing", object: candidate, subject, warnings });
  const scoreContributionAuthorized = readBooleanField({
    key: "scoreContributionAuthorized",
    label: "score contribution authorized",
    object: candidate,
    subject,
    warnings,
  });
  const artifactBoundary = readPlainRecordField({ key: "artifactBoundary", label: "artifact boundary", object: candidate, subject, warnings });
  const denominator = readPlainRecordField({ key: "denominator", label: "denominator", object: candidate, subject, warnings });
  const endpoint = readPlainRecordField({ key: "endpoint", label: "endpoint", object: candidate, subject, warnings });
  const negativeControls = readPlainRecordField({
    key: "negativeControls",
    label: "negative controls",
    object: candidate,
    subject,
    warnings,
  });

  if (schemaVersion !== MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} schema version is not supported.`,
    });
  }
  if (!receiptId || !isNonEmptySimpleKey(receiptId)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} receipt id must be a non-empty simple key.`,
    });
  }
  if (!sourceRouteId || !isSupportedWearableLabAggregateReceiptSourceRouteKey(sourceRouteId)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} source route id must be a non-empty simple key.`,
    });
  } else {
    const resolvedSourceRouteId = readRegisteredWearableLabAggregateReceiptSourceRouteId({ sourceRouteId });
    const sourceRoute = resolvedSourceRouteId ? resolveMurphAgeSourceRoute(resolvedSourceRouteId) : null;
    if (!sourceRoute) {
      warnings.push({
        code: "INVALID_INPUT",
        message: `${subject} source route id must reference a registered Murph Age source route.`,
      });
    } else {
      if (!sourceRoute.layers.includes("wearable-shadow-increment")) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} source route must support a wearable shadow increment.`,
        });
      }
      if (sourceRoute.productAuthorized !== false || !isLockedSourceRouteArtifactBoundary(sourceRoute.artifactBoundary)) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${subject} source route must stay metadata-only and product-blocked.`,
        });
      }
    }
  }
  if (!evidenceTier || !isWearableShadowResultEvidenceTier(evidenceTier)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} evidence tier is not supported.`,
    });
  }
  if (
    sameDenominator !== true
    || evaluatorFrozen !== true
    || productAuthorized !== false
    || scoreBearing !== false
    || scoreContributionAuthorized !== false
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} must stay frozen, same-denominator, research-only, non-score-bearing, and product-blocked.`,
    });
  }
  if (!artifactBoundary || !isLockedIncrementEvaluationOutputBoundary(artifactBoundary)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} artifact boundary must block row, identifier, prediction, coefficient, model parameter, path, source text, split membership, and product display egress.`,
    });
  }
  if (artifactBoundary) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY_KEYS,
      label: "artifact boundary",
      object: artifactBoundary,
      subject,
      warnings,
    });
  }
  if (denominator) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_DENOMINATOR_KEYS,
      label: "denominator",
      object: denominator,
      subject,
      warnings,
    });
    appendRequiredPositiveIntegerWarnings({
      keys: ["evaluatedRowCount", "eventCount", "minimumCellCount"],
      object: denominator,
      subject,
      warnings,
    });
    appendRequiredNonnegativeIntegerWarnings({
      keys: ["suppressedCellCount"],
      object: denominator,
      subject,
      warnings,
    });
    appendOptionalFiniteNonnegativeNumberWarning({ key: "personYears", object: denominator, subject, warnings });
  }
  if (endpoint) {
    validateWearableLabAggregateReceiptEndpoint({ endpoint, subject, warnings });
  }
  if (negativeControls) {
    validateWearableLabAggregateReceiptNegativeControls({ negativeControls, subject, warnings });
  }
  validateWearableLabAggregateReceiptModels({ candidate, subject, warnings });

  return {
    status: warnings.length === 0 ? "valid" : "invalid",
    warnings,
  };
}

export function summarizeMurphAgeWearableLabAggregateReceipt(
  candidate: unknown,
): MurphAgeWearableLabAggregateReceiptEvaluationSummary {
  const validation = validateMurphAgeWearableLabAggregateReceipt(candidate);
  const record = isPlainRecord(candidate) ? candidate : null;
  const sourceRouteId = record ? readRegisteredWearableLabAggregateReceiptSourceRouteId(record) : null;
  const denominatorRecord = record && isPlainRecord(record.denominator) ? record.denominator : null;
  const denominator = {
    evaluatedRowCount: readFiniteNumberOrNull(denominatorRecord?.evaluatedRowCount),
    eventCount: readFiniteNumberOrNull(denominatorRecord?.eventCount),
    minimumCellCount: readFiniteNumberOrNull(denominatorRecord?.minimumCellCount),
  };
  const modelMap = validation.status === "valid" && record
    ? readWearableLabAggregateReceiptModelMap(record.models)
    : new Map<MurphAgeWearableLabAggregateReceiptModelId, MurphAgeWearableLabAggregateReceiptModelResult>();
  const modelIdsPresent = MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS.filter((modelId) =>
    modelMap.has(modelId)
  );
  if (validation.status !== "valid") {
    return {
      blockers: ["receipt_invalid"],
      conclusion: "blocked",
      denominator,
      m1ToM5Deltas: null,
      m2ToM5Deltas: null,
      modelIdsPresent,
      productAuthorized: false,
      reviewGptRequired: false,
      schemaVersion: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
      scoreBearingPromotionAuthorized: false,
      sourceRouteId,
      validation,
      wearableScoreBearingAuthorized: false,
    };
  }

  const m1 = modelMap.get("m1-anchor-plus-lab-body-bp");
  const m2 = modelMap.get("m2-coverage-device-ehr-density-control");
  const m5 = modelMap.get("m5-residualized-wearable-after-controls");
  const m1ToM5Deltas = m1 && m5 ? calculateWearableLabAggregateReceiptMetricDeltas(m5.metrics, m1.metrics) : null;
  const m2ToM5Deltas = m2 && m5 ? calculateWearableLabAggregateReceiptMetricDeltas(m5.metrics, m2.metrics) : null;
  const negativeControls = record && isPlainRecord(record.negativeControls) ? record.negativeControls : null;
  const scienceBlockers: MurphAgeWearableLabAggregateReceiptBlocker[] = [];

  if (denominator.eventCount === null || denominator.eventCount < 100) scienceBlockers.push("event_support_under_100");
  if (!m1ToM5Deltas || !hasReceiptProperScoreImprovement(m1ToM5Deltas) || !hasReceiptDiscriminationNonWorse(m1ToM5Deltas)) {
    scienceBlockers.push("m5_does_not_improve_over_lab_body");
  }
  if (!m2ToM5Deltas || !hasReceiptProperScoreImprovement(m2ToM5Deltas) || !hasReceiptDiscriminationNonWorse(m2ToM5Deltas)) {
    scienceBlockers.push("m5_does_not_beat_coverage_control");
  }
  if (!negativeControls || !wearableLabAggregateReceiptNegativeControlsPassed(negativeControls)) {
    scienceBlockers.push("negative_controls_not_passed");
  }
  if (!m5 || m5.calibrationStatus !== "pass") {
    scienceBlockers.push("calibration_not_acceptable");
  }

  return {
    blockers: scienceBlockers,
    conclusion: scienceBlockers.length === 0 ? "reviewgpt-science-delta" : "valid-no-delta",
    denominator,
    m1ToM5Deltas,
    m2ToM5Deltas,
    modelIdsPresent,
    productAuthorized: false,
    reviewGptRequired: scienceBlockers.length === 0,
    schemaVersion: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
    scoreBearingPromotionAuthorized: false,
    sourceRouteId,
    validation,
    wearableScoreBearingAuthorized: false,
  };
}

export function buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt(
  candidate: unknown,
): MurphAgeIncrementEvaluationCard | null {
  const summary = summarizeMurphAgeWearableLabAggregateReceipt(candidate);
  if (
    summary.validation.status !== "valid"
    || summary.conclusion !== "reviewgpt-science-delta"
    || summary.sourceRouteId === null
    || summary.m1ToM5Deltas === null
    || summary.denominator.evaluatedRowCount === null
    || summary.denominator.eventCount === null
    || summary.denominator.minimumCellCount === null
    || !isPlainRecord(candidate)
  ) {
    return null;
  }

  const modelMap = readWearableLabAggregateReceiptModelMap(candidate.models);
  const m1 = modelMap.get("m1-anchor-plus-lab-body-bp");
  const m5 = modelMap.get("m5-residualized-wearable-after-controls");
  if (!m1 || !m5) return null;

  const aggregateMetricDeltas = aggregateReceiptDeltasToIncrementDeltas(summary.m1ToM5Deltas);
  if (!hasFiniteIncrementEvaluationMetricDelta(aggregateMetricDeltas)) return null;
  const aggregateSample: MurphAgeIncrementEvaluationAggregateSampleSummary = {
    evaluatedRowCount: summary.denominator.evaluatedRowCount,
    eventCount: summary.denominator.eventCount,
    minimumCellCount: summary.denominator.minimumCellCount,
  };
  const suppressedCellCount = readFiniteNumberOrNull(
    isPlainRecord(candidate.denominator) ? candidate.denominator.suppressedCellCount : undefined,
  );
  if (suppressedCellCount !== null) aggregateSample.suppressedCellCount = suppressedCellCount;

  return buildMurphAgeIncrementEvaluationCard({
    aggregateMetricDeltas,
    aggregateSample,
    anchorCardId: "r399_nhis_proxy_10y_acm_research",
    anchorMetrics: { ...m1.metrics },
    candidateBatchId: "ordinary-lab-wearable-aggregate-v1",
    candidateId: `${summary.sourceRouteId}-wearable-shadow-increment`,
    candidateMetrics: { ...m5.metrics },
    evidenceTier: candidate.evidenceTier as MurphAgeIncrementEvaluationEvidenceTier,
    layer: "wearable-shadow-increment",
    riskEffect: "aggregate-estimated",
    sourceRouteId: summary.sourceRouteId,
  });
}

export function validateMurphAgeWearableShadowIncrementResultCard(
  candidate: unknown,
): MurphAgeModelValidationResult {
  const warnings: MurphAgeWarning[] = [];
  if (!isPlainRecord(candidate)) {
    return {
      status: "invalid",
      warnings: [{
        code: "INVALID_INPUT",
        message: "Wearable shadow result card must be an object.",
      }],
    };
  }

  const card = candidate;
  const evaluation = readPlainRecordField({
    label: "evaluation",
    object: card,
    key: "evaluation",
    warnings,
  });
  const aggregateMetricDeltas = evaluation
    ? readPlainRecordField({
      label: "aggregate metric deltas",
      object: evaluation,
      key: "aggregateMetricDeltas",
      warnings,
    })
    : null;
  const aggregateSample = evaluation && evaluation.aggregateSample !== undefined
    ? readPlainRecordField({
      label: "aggregate sample",
      object: evaluation,
      key: "aggregateSample",
      warnings,
    })
    : null;
  const outputBoundary = readPlainRecordField({
    label: "output boundary",
    object: card,
    key: "outputBoundary",
    warnings,
  });
  const anchorCardId = readStringField({
    label: "anchor card id",
    object: card,
    key: "anchorCardId",
    warnings,
  });
  const family = readStringField({
    label: "family",
    object: card,
    key: "family",
    warnings,
  });
  const productAuthorized = readBooleanField({
    label: "product authorized",
    object: card,
    key: "productAuthorized",
    warnings,
  });
  const riskEffect = readStringField({
    label: "risk effect",
    object: card,
    key: "riskEffect",
    warnings,
  });
  const schemaVersion = readStringField({
    label: "schema version",
    object: card,
    key: "schemaVersion",
    warnings,
  });
  const scoreBearing = readBooleanField({
    label: "score bearing",
    object: card,
    key: "scoreBearing",
    warnings,
  });
  const scoreContributionAuthorized = readBooleanField({
    label: "score contribution authorized",
    object: card,
    key: "scoreContributionAuthorized",
    warnings,
  });
  const sourceRouteId = readStringField({
    label: "source route id",
    object: card,
    key: "sourceRouteId",
    warnings,
  });
  const comparator = evaluation
    ? readStringField({ label: "comparator", object: evaluation, key: "comparator", warnings })
    : null;
  const evidenceTier = evaluation
    ? readStringField({ label: "evidence tier", object: evaluation, key: "evidenceTier", warnings })
    : null;
  const sameDenominator = evaluation
    ? readBooleanField({ label: "same denominator", object: evaluation, key: "sameDenominator", warnings })
    : null;
  const policy = MURPH_AGE_WEARABLE_SHADOW_INCREMENT_POLICIES.find((policy) =>
    policy.family === family
  ) ?? null;

  appendUnknownObjectKeyWarnings({
    allowedKeys: MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_KEYS,
    label: "card",
    object: card,
    warnings,
  });
  if (evaluation) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_SHADOW_RESULT_EVALUATION_KEYS,
      label: "evaluation",
      object: evaluation,
      warnings,
    });
  }
  if (aggregateMetricDeltas) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_SHADOW_RESULT_DELTA_KEYS,
      label: "aggregate metric deltas",
      object: aggregateMetricDeltas,
      warnings,
    });
    appendAggregateMetricDeltaValueWarnings({ deltas: aggregateMetricDeltas, warnings });
  }
  if (aggregateSample) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_SHADOW_RESULT_SAMPLE_KEYS,
      label: "aggregate sample",
      object: aggregateSample,
      warnings,
    });
    appendAggregateSampleValueWarnings({
      sample: aggregateSample,
      warnings,
    });
  }
  if (outputBoundary) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_SHADOW_OUTPUT_BOUNDARY_KEYS,
      label: "output boundary",
      object: outputBoundary,
      warnings,
    });
  }

  if (schemaVersion !== MURPH_AGE_WEARABLE_SHADOW_RESULT_CARD_SCHEMA_VERSION) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable shadow result card schema version is not supported.",
    });
  }
  if (!policy || !policy.compatibleAnchorCardIds.some((candidateAnchorCardId) =>
    candidateAnchorCardId === anchorCardId
  )) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${family ?? "unknown"} wearable shadow result card is not compatible with ${anchorCardId ?? "unknown"}.`,
    });
  }
  if (productAuthorized !== false || scoreBearing !== false || scoreContributionAuthorized !== false) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable shadow result cards must remain research-only and non-score-bearing.",
    });
  }
  if (!outputBoundary || !isLockedWearableShadowOutputBoundary(outputBoundary)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable shadow result card output boundary must stay aggregate-only with row, prediction, coefficient, and product display export blocked.",
    });
  }
  if (riskEffect !== "not-estimated" && riskEffect !== "aggregate-estimated") {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable shadow result card risk effect is not supported.",
    });
  }
  if (riskEffect === "aggregate-estimated" && (!aggregateMetricDeltas || !hasFiniteAggregateMetricDelta(aggregateMetricDeltas))) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Aggregate-estimated wearable shadow result cards require at least one finite aggregate metric delta.",
    });
  }
  if (comparator !== "anchor-vs-anchor-plus-wearable-shadow-increment") {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable shadow result cards must compare the frozen anchor against the same anchor plus one shadow increment.",
    });
  }
  if (sameDenominator !== true) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Wearable shadow result cards must use the same denominator as their anchor comparator.",
    });
  }
  if (!evidenceTier || !isWearableShadowResultEvidenceTier(evidenceTier)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable shadow result card evidence tier is not supported.",
    });
  }
  if (!sourceRouteId || !isNonEmptySimpleKey(sourceRouteId)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Wearable shadow result card source route id must be a non-empty simple key.",
    });
  } else {
    const sourceRoute = resolveMurphAgeSourceRoute(sourceRouteId);
    if (!sourceRoute) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "Wearable shadow result card source route id must reference a registered Murph Age source route.",
      });
    } else {
      if (!sourceRoute.layers.includes("wearable-shadow-increment")) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: "Wearable shadow result card source route must be registered as a wearable shadow increment route.",
        });
      }
      if (sourceRoute.productAuthorized !== false || !isLockedSourceRouteArtifactBoundary(sourceRoute.artifactBoundary)) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: "Wearable shadow result card source route must stay metadata-only and product-blocked.",
        });
      }
    }
  }

  return {
    status: warnings.length === 0 ? "valid" : "invalid",
    warnings,
  };
}

export function validateMurphAgeIncrementEvaluationCard(
  candidate: unknown,
): MurphAgeModelValidationResult {
  const subject = "Increment evaluation card";
  const warnings: MurphAgeWarning[] = [];
  if (!isPlainRecord(candidate)) {
    return {
      status: "invalid",
      warnings: [{
        code: "INVALID_INPUT",
        message: `${subject} must be an object.`,
      }],
    };
  }

  const card = candidate;
  const evaluation = readPlainRecordField({
    label: "evaluation",
    object: card,
    key: "evaluation",
    subject,
    warnings,
  });
  const aggregateMetricDeltas = evaluation
    ? readPlainRecordField({
      label: "aggregate metric deltas",
      object: evaluation,
      key: "aggregateMetricDeltas",
      subject,
      warnings,
    })
    : null;
  const aggregateSample = evaluation && evaluation.aggregateSample !== undefined
    ? readPlainRecordField({
      label: "aggregate sample",
      object: evaluation,
      key: "aggregateSample",
      subject,
      warnings,
    })
    : null;
  const anchorMetrics = evaluation && evaluation.anchorMetrics !== undefined
    ? readPlainRecordField({
      label: "anchor metrics",
      object: evaluation,
      key: "anchorMetrics",
      subject,
      warnings,
    })
    : null;
  const candidateMetrics = evaluation && evaluation.candidateMetrics !== undefined
    ? readPlainRecordField({
      label: "candidate metrics",
      object: evaluation,
      key: "candidateMetrics",
      subject,
      warnings,
    })
    : null;
  const outputBoundary = readPlainRecordField({
    label: "output boundary",
    object: card,
    key: "outputBoundary",
    subject,
    warnings,
  });
  const anchorCardId = readStringField({
    label: "anchor card id",
    object: card,
    key: "anchorCardId",
    subject,
    warnings,
  });
  const candidateBatchId = readStringField({
    label: "candidate batch id",
    object: card,
    key: "candidateBatchId",
    subject,
    warnings,
  });
  const candidateId = readStringField({
    label: "candidate id",
    object: card,
    key: "candidateId",
    subject,
    warnings,
  });
  const flatteningAuthorized = readBooleanField({
    label: "flattening authorized",
    object: card,
    key: "flatteningAuthorized",
    subject,
    warnings,
  });
  const layer = readStringField({
    label: "layer",
    object: card,
    key: "layer",
    subject,
    warnings,
  });
  const productAuthorized = readBooleanField({
    label: "product authorized",
    object: card,
    key: "productAuthorized",
    subject,
    warnings,
  });
  const riskEffect = readStringField({
    label: "risk effect",
    object: card,
    key: "riskEffect",
    subject,
    warnings,
  });
  const schemaVersion = readStringField({
    label: "schema version",
    object: card,
    key: "schemaVersion",
    subject,
    warnings,
  });
  const scoreBearing = readBooleanField({
    label: "score bearing",
    object: card,
    key: "scoreBearing",
    subject,
    warnings,
  });
  const scoreContributionAuthorized = readBooleanField({
    label: "score contribution authorized",
    object: card,
    key: "scoreContributionAuthorized",
    subject,
    warnings,
  });
  const sourceRouteId = readStringField({
    label: "source route id",
    object: card,
    key: "sourceRouteId",
    subject,
    warnings,
  });
  const comparator = evaluation
    ? readStringField({ label: "comparator", object: evaluation, key: "comparator", subject, warnings })
    : null;
  const evidenceTier = evaluation
    ? readStringField({ label: "evidence tier", object: evaluation, key: "evidenceTier", subject, warnings })
    : null;
  const sameDenominator = evaluation
    ? readBooleanField({ label: "same denominator", object: evaluation, key: "sameDenominator", subject, warnings })
    : null;

  appendUnknownObjectKeyWarnings({
    allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_CARD_KEYS,
    label: "root",
    object: card,
    subject,
    warnings,
  });
  if (evaluation) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_KEYS,
      label: "evaluation",
      object: evaluation,
      subject,
      warnings,
    });
  }
  if (aggregateMetricDeltas) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_DELTA_KEYS,
      label: "aggregate metric deltas",
      object: aggregateMetricDeltas,
      subject,
      warnings,
    });
    appendIncrementEvaluationMetricDeltaValueWarnings({ deltas: aggregateMetricDeltas, subject, warnings });
  }
  if (aggregateSample) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_SAMPLE_KEYS,
      label: "aggregate sample",
      object: aggregateSample,
      subject,
      warnings,
    });
    appendIncrementEvaluationAggregateSampleValueWarnings({ sample: aggregateSample, subject, warnings });
  }
  if (anchorMetrics) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_METRIC_KEYS,
      label: "anchor metrics",
      object: anchorMetrics,
      subject,
      warnings,
    });
    appendIncrementEvaluationAggregateMetricValueWarnings({ metrics: anchorMetrics, subject, warnings });
  }
  if (candidateMetrics) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_METRIC_KEYS,
      label: "candidate metrics",
      object: candidateMetrics,
      subject,
      warnings,
    });
    appendIncrementEvaluationAggregateMetricValueWarnings({ metrics: candidateMetrics, subject, warnings });
  }
  if (outputBoundary) {
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_OUTPUT_BOUNDARY_KEYS,
      label: "output boundary",
      object: outputBoundary,
      subject,
      warnings,
    });
  }

  if (schemaVersion !== MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card schema version is not supported.",
    });
  }
  if (!anchorCardId || !parseScoreBearingCardId(anchorCardId)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Increment evaluation card anchor must reference a score-bearing Murph Age model card.",
    });
  }
  if (!candidateBatchId || !isNonEmptySimpleKey(candidateBatchId)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card candidate batch id must be a non-empty simple key.",
    });
  }
  if (!candidateId || !isNonEmptySimpleKey(candidateId)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card candidate id must be a non-empty simple key.",
    });
  }
  if (!layer || !isMurphAgeIncrementEvaluationLayer(layer)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card layer is not supported.",
    });
  }
  if (
    productAuthorized !== false
    || scoreBearing !== false
    || scoreContributionAuthorized !== false
    || flatteningAuthorized !== false
  ) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Increment evaluation cards must remain research-only, non-score-bearing, and not flattening-authorized.",
    });
  }
  if (!outputBoundary || !isLockedIncrementEvaluationOutputBoundary(outputBoundary)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Increment evaluation card output boundary must stay aggregate-only with rows, identifiers, predictions, coefficients, model parameters, local paths, source text, split membership, and product display export blocked.",
    });
  }
  if (riskEffect !== "not-estimated" && riskEffect !== "aggregate-estimated") {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card risk effect is not supported.",
    });
  }
  if (riskEffect === "aggregate-estimated" && (!aggregateMetricDeltas || !hasFiniteIncrementEvaluationMetricDelta(aggregateMetricDeltas))) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Aggregate-estimated increment evaluation cards require at least one finite aggregate metric delta.",
    });
  }
  if (comparator !== "anchor-vs-anchor-plus-increment") {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Increment evaluation cards must compare the frozen anchor against the same anchor plus one increment.",
    });
  }
  if (sameDenominator !== true) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: "Increment evaluation cards must use the same denominator as their anchor comparator.",
    });
  }
  if (!evidenceTier || !isWearableShadowResultEvidenceTier(evidenceTier)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card evidence tier is not supported.",
    });
  }
  if (!sourceRouteId || !isNonEmptySimpleKey(sourceRouteId)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Increment evaluation card source route id must be a non-empty simple key.",
    });
  } else {
    const sourceRoute = resolveMurphAgeSourceRoute(sourceRouteId);
    if (!sourceRoute) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "Increment evaluation card source route id must reference a registered Murph Age source route.",
      });
    } else {
      if (layer && isMurphAgeIncrementEvaluationLayer(layer) && !sourceRoute.layers.includes(layer)) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: "Increment evaluation card source route must be registered for the requested increment layer.",
        });
      }
      if (sourceRoute.productAuthorized !== false || !isLockedSourceRouteArtifactBoundary(sourceRoute.artifactBoundary)) {
        warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: "Increment evaluation card source route must stay metadata-only and product-blocked.",
        });
      }
    }
  }

  return {
    status: warnings.length === 0 ? "valid" : "invalid",
    warnings,
  };
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
        .map(modelFeatureMetricKey)
        .filter(isString),
    ),
    scoreBearingSourceKinds: [],
    wearableScoreBearingAuthorized: false,
  };
}

const MURPH_AGE_SCORE_BEARING_CARD_BUNDLE_RESOLVERS: Record<
  MurphAgeScoreBearingCardId,
  (input: MurphAgeInputBundleAssessmentInput) => MurphAgeInputBundleAssessment
> = {
  l1b_glycemia_body_10y_acm_research: assessMurphAgeL1bGlycemiaBody,
  l1_tiny_glycemia_10y_acm_research: assessMurphAgeL1Glycemia,
  lab5_bp_bmi_transport_research: assessMurphAgeLab5BpBmi,
  lab9_bp_body_10y_acm_research: assessMurphAgeLab9BpBody,
  r399_nhis_proxy_10y_acm_research: assessMurphAgeR399ProxyAnchor,
};

const MURPH_AGE_EXPLICIT_PRIMARY_BUNDLE_RESOLVERS: Partial<Record<
  MurphAgeModelCardId,
  (input: MurphAgeInputBundleAssessmentInput) => MurphAgeInputBundleAssessment
>> = MURPH_AGE_SCORE_BEARING_CARD_BUNDLE_RESOLVERS;

const MURPH_AGE_SCORE_BEARING_CARD_IDS = [
  "l1b_glycemia_body_10y_acm_research",
  "lab9_bp_body_10y_acm_research",
  "lab5_bp_bmi_transport_research",
  "l1_tiny_glycemia_10y_acm_research",
  "r399_nhis_proxy_10y_acm_research",
] as const satisfies readonly MurphAgeScoreBearingCardId[];

function assessMurphAgeResearchCandidateCards(input: MurphAgeInputBundleAssessmentInput & {
  mode: MurphAgeCalculatorMode;
  models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  selectedCardId: MurphAgeScoreBearingCardId | null;
}): MurphAgeResearchCandidateCardAssessment[] {
  return MURPH_AGE_SCORE_BEARING_CARD_IDS.map((cardId) => {
    const bundleAssessment = MURPH_AGE_SCORE_BEARING_CARD_BUNDLE_RESOLVERS[cardId]({
      asOf: input.asOf,
      points: input.points,
    });
    const modelLoaded = Boolean(input.models[cardId]);
    const cardPolicy = resolveMurphAgeModelCardPolicy(cardId);
    const blockerCodes: MurphAgeResearchCandidateCardBlockerCode[] = [];
    if (bundleAssessment.status !== "ready") blockerCodes.push("INPUT_BUNDLE_INCOMPLETE");
    if (!modelLoaded) blockerCodes.push("LOCAL_MODEL_CARD_NOT_LOADED");
    if (
      cardId === "r399_nhis_proxy_10y_acm_research"
      && bundleAssessment.status === "ready"
      && input.selectedCardId !== cardId
      && hasMurphAgeScoreBearingLabIntent(input)
    ) {
      blockerCodes.push("PROXY_FALLBACK_SUPPRESSED_BY_LAB_INTENT");
    }
    if (input.mode === "product" && !cardPolicy?.productAuthorized) {
      blockerCodes.push("PRODUCT_MODE_RESEARCH_ONLY");
    }

    return {
      availableFeatureKeys: [...bundleAssessment.availableFeatureKeys],
      blockerCodes,
      bundleId: bundleAssessment.bundleId,
      cardId,
      inputStatus: bundleAssessment.status,
      missingFeatureKeys: [...bundleAssessment.missingFeatureKeys],
      modelLoaded,
      selected: input.selectedCardId === cardId,
      selectedMetricKeys: [...bundleAssessment.selectedMetricKeys],
      warnings: bundleAssessment.warnings.map((warning) => ({ ...warning })),
    };
  });
}

export function calculateMurphAgeFromInputBundle(input: MurphAgeCalculatorInput): MurphAgeCalculatorOutput {
  const mode = input.mode ?? "product";
  const models = input.models ?? {};
  const primaryBundle = resolveMurphAgePrimaryBundle({
    asOf: input.asOf,
    mode,
    models,
    points: input.points,
    requestedCardId: input.cardId ?? null,
  });
  const bundleAssessment = primaryBundle.bundleAssessment;
  const researchCandidateCards = assessMurphAgeResearchCandidateCards({
    asOf: input.asOf,
    mode,
    models,
    points: input.points,
    selectedCardId: isScoreBearingCardId(primaryBundle.cardId) ? primaryBundle.cardId : null,
  });
  const contextAssessments = assessMurphAgeSecondaryContextBundles({
    asOf: input.asOf,
    points: input.points,
    primaryBundleId: bundleAssessment.bundleId,
  });
  const cardPolicy = primaryBundle.cardId === "none"
    ? null
    : resolveMurphAgeModelCardPolicy(primaryBundle.cardId);
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
      researchCandidateCards,
      result: null,
      status: bundleAssessment.status,
      authorization,
      warnings,
      wearableShadowIncrementAssessments,
    });
  }

  if (!cardPolicy.acceptedBundleIds.includes(bundleAssessment.bundleId)) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${cardPolicy.cardId} does not authorize the selected ${bundleAssessment.bundleId} input bundle.`,
    });
    return buildCalculatorOutput({
      bundleAssessment,
      cardPolicy,
      contextAssessments,
      mode,
      researchCandidateCards,
      result: null,
      status: "abstain",
      authorization,
      warnings,
      wearableShadowIncrementAssessments,
    });
  }

  if (bundleAssessment.status !== "ready") {
    return buildCalculatorOutput({
      bundleAssessment,
      cardPolicy,
      contextAssessments,
      mode,
      researchCandidateCards,
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
      researchCandidateCards,
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
      researchCandidateCards,
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
      researchCandidateCards,
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
  const functionResidualLayerApplication = applyMurphAgeFunctionResidualLayer({
    anchorCardId: cardPolicy.cardId,
    anchorRiskProbability: result.risk?.probability ?? null,
    asOf: input.asOf,
    parameterPack: mode === "research" ? input.functionResidualParameterPack : null,
    points: input.points,
    referenceRiskCurve: model.referenceRiskCurve,
  });
  const wearableAnchorRiskProbability = functionResidualLayerApplication.parameterizationAvailable
    ? functionResidualLayerApplication.finalRiskProbability
    : result.risk?.probability ?? null;
  const wearableResidualLayerApplication = applyMurphAgeWearableResidualLayers({
    anchorCardId: cardPolicy.cardId,
    anchorRiskProbability: wearableAnchorRiskProbability,
    asOf: input.asOf,
    assessments: wearableShadowIncrementAssessments,
    parameterPacks: mode === "research" ? wearableResidualParameterPacksForInput(input) : null,
    points: input.points,
    referenceRiskCurve: model.referenceRiskCurve,
  });

  return buildCalculatorOutput({
    bundleAssessment,
    cardPolicy,
    contextAssessments,
    functionResidualLayerApplication,
    mode,
    researchCandidateCards,
    result,
    status: result.status === "ready" ? "ready" : "abstain",
    authorization,
    warnings: [...warnings, ...result.warnings],
    wearableResidualLayerApplication,
    wearableShadowIncrementAssessments,
  });
}

function resolveMurphAgePrimaryBundle(input: MurphAgeInputBundleAssessmentInput & {
  mode: MurphAgeCalculatorMode;
  models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  requestedCardId: MurphAgeModelCardId | null;
}): MurphAgePrimaryBundleResolution {
  const explicitResolver = input.requestedCardId
    ? MURPH_AGE_EXPLICIT_PRIMARY_BUNDLE_RESOLVERS[input.requestedCardId]
    : undefined;
  const bundleAssessment = explicitResolver
    ? explicitResolver({
      asOf: input.asOf,
      points: input.points,
    })
    : assessMurphAgeInputBundle({
      asOf: input.asOf,
      points: input.points,
    });

  if (input.requestedCardId || input.mode !== "research") {
    return {
      bundleAssessment,
      cardId: input.requestedCardId ?? bundleAssessment.recommendedCardId,
    };
  }

  const runnableResearchBundle = selectRunnableMurphAgeResearchBundle({
    asOf: input.asOf,
    models: input.models,
    points: input.points,
  });
  if (runnableResearchBundle) return runnableResearchBundle;

  return {
    bundleAssessment,
    cardId: bundleAssessment.recommendedCardId,
  };
}

function selectRunnableMurphAgeResearchBundle(input: MurphAgeInputBundleAssessmentInput & {
  models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
}): MurphAgePrimaryBundleResolution | null {
  for (const cardId of MURPH_AGE_SCORE_BEARING_CARD_IDS) {
    const model = input.models[cardId];
    if (!model) continue;
    if (cardId === "r399_nhis_proxy_10y_acm_research" && hasMurphAgeScoreBearingLabIntent(input)) continue;
    const bundleAssessment = MURPH_AGE_SCORE_BEARING_CARD_BUNDLE_RESOLVERS[cardId]({
      asOf: input.asOf,
      points: input.points,
    });
    if (bundleAssessment.status !== "ready") continue;
    if (!canMurphAgeResearchCardRunWithCurrentInputs({
      asOf: input.asOf,
      cardId,
      model,
      points: input.points,
    })) continue;
    return {
      bundleAssessment,
      cardId,
    };
  }

  return null;
}

function canMurphAgeResearchCardRunWithCurrentInputs(input: MurphAgeInputBundleAssessmentInput & {
  cardId: MurphAgeScoreBearingCardId;
  model: MurphAgeRiskModel;
}): boolean {
  const cardPolicy = resolveMurphAgeModelCardPolicy(input.cardId);
  if (!cardPolicy?.scoreBearing) return false;
  if (findModelCardPolicyViolation({
    asOf: input.asOf,
    cardPolicy,
    model: input.model,
    points: input.points,
  })) {
    return false;
  }

  const blockedIdentifiers = normalizedBlockedIdentifiers(input.model);
  for (const feature of input.model.features) {
    if (feature.kind !== "metric" || !isModelFeatureRequired(feature)) continue;
    if (feature.missingValue !== undefined) continue;
    const metricKey = resolveMetricInputKey(feature.metricKey);
    const selection = selectMetricValue({
      biomarkerKey: feature.biomarkerKey,
      metricKey,
      now: input.asOf,
      points: input.points,
      policyOverride: feature.selectionPolicy,
    });
    if (isBlockedMetricFeature({
      biomarkerKey: selection.biomarkerKey,
      blockedIdentifiers,
      metricKey: selection.metricKey,
    })) {
      return false;
    }
    if (selection.status !== "ready" || selection.value === null || !Number.isFinite(selection.value)) {
      return false;
    }
    if (selection.warnings.some((warning) =>
      warning.code === "COMPARATOR_VALUE" || warning.code === "UNIT_NOT_NORMALIZED"
    )) {
      return false;
    }
    const metricDefinition = resolveMetricDefinition(metricKey);
    const expectedUnit = feature.expectedUnit ?? metricDefinition?.canonicalUnit ?? null;
    if (expectedUnit && !unitsEquivalent(selection.unit, expectedUnit)) return false;
  }

  return true;
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

  const readyFeatures = evaluatedFeatures.filter(isScoreContributingEvaluatedFeature);
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
    (feature.status === "ready" || feature.status === "imputed") && feature.metricKey !== null
  ) ?? [];
  const missingAttributions = output.result?.featureAttributions.filter((feature) =>
    feature.status === "missing"
  ) ?? [];
  const blockedAttributions = output.result?.featureAttributions.filter((feature) =>
    feature.status === "blocked"
  ) ?? [];
  const contextFeatures = listContextOnlyFeatureStatuses(output);
  const wearableFeatures = contextFeatures.filter(isWearableContextFeatureStatus);
  const wearableContext = summarizeWearableContext(wearableFeatures);
  const wearableBridge = summarizeWearableBridge(wearableFeatures);
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
    productPromotionBlockers: output.cardPolicy
      ? listMurphAgeModelCardProductPromotionBlockers(output.cardPolicy)
      : [],
    productRiskDisplayReady,
    researchEstimateAvailable: output.mode === "research" && ageEstimateAvailable,
    schemaVersion: MURPH_AGE_DISPLAY_SUMMARY_SCHEMA_VERSION,
    selectedScoreBearingFeatureKeys: uniqueStrings(readyAttributions.map((feature) => feature.featureKey)),
    selectedScoreBearingMetricKeys: uniqueStrings(readyAttributions.map((feature) => feature.metricKey)),
    selectedScoreBearingPointIds: uniqueStrings(readyAttributions.flatMap((feature) => feature.selectedPointIds)),
    validationGate: output.cardPolicy ? cloneMurphAgeValidationGateSummary(output.cardPolicy.validationGate) : null,
    wearableBridge,
    wearableContext,
  };
}

export function summarizeMurphAgeCalculatorPublicOutput(
  output: MurphAgeCalculatorOutput,
): MurphAgePublicDisplaySummary {
  return toPublicMurphAgeDisplaySummary(summarizeMurphAgeCalculatorOutput(output));
}

export function calculateMurphAgePublicReportFromInputBundle(
  input: MurphAgeCalculatorInput,
): MurphAgePublicCalculatorReport {
  return toPublicMurphAgeCalculatorReport(calculateMurphAgeFromInputBundle(input));
}

export function calculateMurphAgeFromSubmittedInputs(
  input: MurphAgeSubmittedCalculatorInput,
): MurphAgeCalculatorOutput {
  const submitted = buildMurphAgeSubmittedMetricPoints(input);
  const output = calculateMurphAgeFromInputBundle({
    asOf: input.asOf,
    cardId: input.cardId,
    chronologicalAgeYears: input.chronologicalAgeYears,
    functionResidualParameterPack: input.functionResidualParameterPack,
    mode: input.mode,
    models: input.models,
    points: submitted.points,
    sex: input.sex,
    wearableResidualParameterPack: input.wearableResidualParameterPack,
    wearableResidualParameterPacks: input.wearableResidualParameterPacks,
  });
  return prependCalculatorWarnings(output, submitted.warnings);
}

export function calculateMurphAgePublicReportFromSubmittedInputs(
  input: MurphAgeSubmittedCalculatorInput,
): MurphAgePublicCalculatorReport {
  return toPublicMurphAgeCalculatorReport(calculateMurphAgeFromSubmittedInputs(input));
}

export function buildMurphAgeSubmittedCalculatorViewBundle(
  input: MurphAgeSubmittedCalculatorInput,
  options: MurphAgeSubmittedCalculatorViewBundleOptions = {},
): MurphAgeSubmittedCalculatorViewBundle {
  const productReport = calculateMurphAgePublicReportFromSubmittedInputs({
    ...input,
    mode: "product",
  });
  const product = {
    report: productReport,
    view: buildMurphAgePublicCalculatorView(productReport),
  };
  const researchPreview = options.includeResearchPreview === true
    ? buildMurphAgeResearchPreviewFromSubmittedInputs(input)
    : null;
  return {
    capabilities: summarizeMurphAgeSubmittedCalculatorCapabilities(),
    inputBundleSpecs: listMurphAgeSubmittedCalculatorInputBundleSpecs(),
    metricInputSpecs: listMurphAgeSubmittedCalculatorMetricInputSpecs(),
    product,
    researchPreview,
    schemaVersion: MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION,
  };
}

function buildMurphAgeResearchPreviewFromSubmittedInputs(
  input: MurphAgeSubmittedCalculatorInput,
): MurphAgeResearchCalculatorReportAndView {
  const report = calculateMurphAgePublicReportFromSubmittedInputs({
    ...input,
    mode: "research",
  });
  return {
    report,
    view: buildMurphAgeResearchCalculatorView(report),
  };
}

function buildMurphAgeSubmittedMetricPoints(input: {
  asOf: string;
  submittedMetrics: readonly MurphAgeSubmittedMetricInput[];
}): { points: MetricPoint[]; warnings: MurphAgeWarning[] } {
  const points: MetricPoint[] = [];
  const warnings: MurphAgeWarning[] = [];
  for (const [index, submittedMetric] of input.submittedMetrics.entries()) {
    const point = buildMurphAgeSubmittedMetricPoint({
      asOf: input.asOf,
      index,
      submittedMetric,
      warnings,
    });
    if (point) points.push(point);
  }
  return { points, warnings };
}

function buildMurphAgeSubmittedMetricPoint(input: {
  asOf: string;
  index: number;
  submittedMetric: MurphAgeSubmittedMetricInput;
  warnings: MurphAgeWarning[];
}): MetricPoint | null {
  const metricKey = resolveMetricInputKey(input.submittedMetric.metricKey);
  if (!MURPH_AGE_INPUT_BUNDLE_METRIC_KEYS.has(metricKey)) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age metric is not part of the current calculator input registry.", metricKey));
    return null;
  }
  if (input.submittedMetric.value !== null && !Number.isFinite(input.submittedMetric.value)) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age metric value must be finite.", metricKey));
    return null;
  }

  const observedAt = parseSubmittedMetricObservedAt({
    asOf: input.asOf,
    metricKey,
    observedAt: input.submittedMetric.observedAt,
    warnings: input.warnings,
  });
  if (!observedAt) return null;
  const effectiveDate = parseSubmittedMetricEffectiveDate({
    asOf: input.asOf,
    effectiveDate: input.submittedMetric.effectiveDate,
    metricKey,
    observedAt,
    warnings: input.warnings,
  });
  if (!effectiveDate) return null;

  const sourceKind = resolveSubmittedMetricSourceKind({
    metricKey,
    sourceKind: input.submittedMetric.sourceKind,
    warnings: input.warnings,
  });
  if (!sourceKind) return null;
  const normalized = normalizeMetricValue({
    metricKey,
    unit: input.submittedMetric.unit ?? null,
    value: input.submittedMetric.value,
  });
  for (const warning of normalized.warnings) {
    input.warnings.push({
      code: "METRIC_SELECTION_WARNING",
      message: warning.message,
      metricKey,
    });
  }

  const point: MetricPoint = {
    biomarkerKey: resolveMetricDefinition(metricKey)?.biomarkerKey ?? null,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: input.submittedMetric.confidence ?? "medium",
    context: { ...(input.submittedMetric.context ?? {}) },
    effectiveDate,
    grain: inferSubmittedMetricGrain(metricKey),
    id: `metric-point:murph-age-submitted:${metricKey}:${input.index}`,
    metricKey,
    observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: input.submittedMetric.sourceLabel ?? null,
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: "sample",
      kind: sourceKind,
      path: "",
      recordId: `murph-age-submitted:${metricKey}:${input.index}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: normalized.unit,
    value: input.submittedMetric.value,
  };

  if (!isMurphAgeInputBundleMetricPointAllowed(point)) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age metric source is not allowed for that metric.", metricKey));
    return null;
  }
  return point;
}

function parseSubmittedMetricObservedAt(input: {
  asOf: string;
  metricKey: string;
  observedAt?: string;
  warnings: MurphAgeWarning[];
}): string | null {
  const asOf = normalizeSubmittedDateTime(input.asOf);
  if (!asOf) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age calculation requires a valid asOf timestamp.", input.metricKey));
    return null;
  }
  const observedAt = normalizeSubmittedDateTime(input.observedAt ?? input.asOf);
  if (!observedAt) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age metric requires a valid observedAt or asOf timestamp.", input.metricKey));
    return null;
  }
  if (observedAt > asOf) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age metric observedAt is after the calculation asOf timestamp.", input.metricKey));
    return null;
  }
  return observedAt;
}

function parseSubmittedMetricEffectiveDate(input: {
  asOf: string;
  effectiveDate?: string;
  metricKey: string;
  observedAt: string;
  warnings: MurphAgeWarning[];
}): string | null {
  if (!input.effectiveDate) return input.observedAt.slice(0, 10);
  const normalized = normalizeSubmittedDateTime(input.effectiveDate);
  const asOf = normalizeSubmittedDateTime(input.asOf);
  if (normalized && asOf && normalized.slice(0, 10) <= asOf.slice(0, 10)) return normalized.slice(0, 10);
  if (normalized && asOf && normalized.slice(0, 10) > asOf.slice(0, 10)) {
    input.warnings.push(submittedMetricWarning("Submitted Murph Age metric effectiveDate is after the calculation asOf date.", input.metricKey));
    return null;
  }
  input.warnings.push(submittedMetricWarning("Submitted Murph Age metric effectiveDate is not valid.", input.metricKey));
  return null;
}

function normalizeSubmittedDateTime(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveSubmittedMetricSourceKind(input: {
  metricKey: string;
  sourceKind?: string;
  warnings: MurphAgeWarning[];
}): MurphAgeSubmittedMetricSourceKind | null {
  if (!input.sourceKind) return inferSubmittedMetricSourceKind(input.metricKey);
  if (isMurphAgeSubmittedMetricSourceKind(input.sourceKind)) return input.sourceKind;
  input.warnings.push(submittedMetricWarning("Submitted Murph Age metric source kind is not supported.", input.metricKey));
  return null;
}

function isMurphAgeSubmittedMetricSourceKind(value: string): value is MurphAgeSubmittedMetricSourceKind {
  return MURPH_AGE_SUBMITTED_METRIC_SOURCE_KINDS.has(value as MurphAgeSubmittedMetricSourceKind);
}

function inferSubmittedMetricSourceKind(metricKey: string): MurphAgeSubmittedMetricSourceKind {
  if (MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS.has(metricKey)) return "wearable-summary";
  if (MURPH_AGE_R399_PROXY_METRIC_KEYS.has(metricKey)) return "survey-response";
  if (MURPH_AGE_BP_BODY_METRIC_KEYS.has(metricKey) || MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS.has(metricKey)) {
    return "measurement";
  }
  return "test-result";
}

function listSubmittedCalculatorAllowedSourceKinds(metricKey: string): MurphAgeSubmittedMetricSourceKind[] {
  if (MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS.has(metricKey)) {
    return ["activity-summary", "sleep-summary", "wearable-summary"];
  }
  if (MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS.has(metricKey) || MURPH_AGE_BP_BODY_METRIC_KEYS.has(metricKey)) {
    return ["measurement"];
  }
  if (MURPH_AGE_R399_PROXY_METRIC_KEYS.has(metricKey)) {
    return [...MURPH_AGE_R399_PROXY_SOURCE_KINDS] as MurphAgeSubmittedMetricSourceKind[];
  }
  return ["measurement", "test-result"];
}

function listSubmittedCalculatorMetricRoles(metricKey: string): MurphAgeSubmittedCalculatorMetricRole[] {
  const roles: MurphAgeSubmittedCalculatorMetricRole[] = [];
  if (MURPH_AGE_SCORE_BEARING_LAB_METRIC_KEYS.has(metricKey)) roles.push("lab-research");
  if (MURPH_AGE_BP_BODY_METRIC_KEYS.has(metricKey)) roles.push("bp-body-research");
  if (MURPH_AGE_R399_PROXY_METRIC_KEYS.has(metricKey)) roles.push("proxy-anchor-research");
  if (MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS.has(metricKey)) roles.push("wearable-context");
  if (MURPH_AGE_FUNCTION_CONTEXT_METRIC_KEYS.has(metricKey)) roles.push("function-context");
  return roles;
}

function listSubmittedCalculatorResearchScoreBearingCardIds(metricKey: string): MurphAgeScoreBearingCardId[] {
  const cardIds: MurphAgeScoreBearingCardId[] = [];
  for (const policy of MURPH_AGE_MODEL_CARD_POLICIES) {
    if (
      policy.cardId !== "function_context_no_risk"
      && policy.cardId !== "wearable_context_no_risk"
      && policy.scoreBearing
      && policy.scoreBearingMetricKeys.includes(metricKey)
    ) {
      cardIds.push(policy.cardId);
    }
  }
  return cardIds;
}

function isSubmittedCalculatorProductScoreBearingAuthorized(metricKey: string): boolean {
  return MURPH_AGE_MODEL_CARD_POLICIES.some((policy) =>
    policy.scoreBearingMetricKeys.includes(metricKey)
    && isMurphAgeModelCardProductAuthorized(policy)
  );
}

function listSubmittedCalculatorFeatureKeys(metricKey: string): string[] {
  return uniqueStrings(MURPH_AGE_INPUT_FEATURE_REQUIREMENTS
    .filter((requirement) => requirement.metricKeys.includes(metricKey))
    .map((requirement) => requirement.featureKey));
}

function inferSubmittedMetricGrain(metricKey: string): MetricPoint["grain"] {
  return MURPH_AGE_WEARABLE_CONTEXT_METRIC_KEYS.has(metricKey) ? "day" : "event";
}

function submittedMetricWarning(message: string, metricKey: string): MurphAgeWarning {
  return {
    code: "INVALID_INPUT",
    message,
    metricKey,
  };
}

function prependCalculatorWarnings(
  output: MurphAgeCalculatorOutput,
  warnings: readonly MurphAgeWarning[],
): MurphAgeCalculatorOutput {
  if (warnings.length === 0) return output;
  return {
    ...output,
    result: output.result
      ? {
        ...output.result,
        warnings: [...warnings, ...output.result.warnings],
      }
      : null,
    warnings: [...warnings, ...output.warnings],
  };
}

export function toPublicMurphAgeCalculatorReport(
  output: MurphAgeCalculatorOutput,
): MurphAgePublicCalculatorReport {
  return {
    authorization: toPublicMurphAgeAuthorization(output.authorization),
    displaySummary: summarizeMurphAgeCalculatorPublicOutput(output),
    functionResidualLayer: output.mode === "research"
      ? toPublicMurphAgeFunctionResidualLayerView(output.functionResidualLayerApplication)
      : null,
    inputReadiness: toPublicMurphAgeInputReadiness(output),
    mode: output.mode,
    researchCandidateCards: output.researchCandidateCards.map(toPublicMurphAgeResearchCandidateCardAssessment),
    result: output.result ? toPublicMurphAgeResult(output.result) : null,
    schemaVersion: MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION,
    status: output.status,
    warnings: toPublicMurphAgeWarnings(output.warnings),
    wearableResidualLayer: output.mode === "research"
      ? toPublicMurphAgeWearableResidualLayerView(output.wearableResidualLayerApplication)
      : null,
  };
}

export function buildMurphAgePublicCalculatorView(
  report: MurphAgePublicCalculatorReport,
): MurphAgePublicCalculatorView {
  const summary = report.displaySummary;
  const result = report.result;
  const canExposeScoreIdentity = summary.productRiskDisplayReady || summary.productAgeDisplayReady;
  const canExposeAttribution = summary.productAgeDisplayReady;
  const wearableMetricKeys = new Set(summary.wearableBridge.features.flatMap((feature) => feature.metricKeys));
  const contextOnlyWearableMetricKeys = summary.contextOnlyMetricKeys.filter((metricKey) =>
    wearableMetricKeys.has(metricKey)
  );
  const ageEstimate = summary.productAgeDisplayReady && result ? {
    ageDeltaYears: result.ageDeltaYears,
    biologicalAgeYears: result.biologicalAgeYears,
    chronologicalAgeYears: result.chronologicalAgeYears,
    intervalYears: result.intervalYears ? { ...result.intervalYears } : null,
  } : null;
  const featureContributions = canExposeAttribution && result
    ? result.featureAttributions.map(buildMurphAgePublicFeatureContributionView)
    : [];

  return {
    ageEstimate,
    blockedFeatureKeys: [...summary.blockedFeatureKeys],
    displayBlockedReason: summary.displayBlockedReason,
    displayStatus: summary.displayStatus,
    domainContributions: canExposeAttribution && result ? result.moduleAttributions.map((module) => ({
      contributionYears: module.contributionYears,
      featureKeys: [...module.featureKeys],
      moduleId: module.moduleId,
    })) : [],
    featureContributions,
    featureDrivers: buildMurphAgePublicDriverSummaryView(featureContributions),
    displayCategory: resolveMurphAgePublicCalculatorViewDisplayCategory(summary.displayStatus),
    missingFeatureKeys: [...summary.missingFeatureKeys],
    mode: report.mode,
    product: {
      ageDisplayReady: summary.productAgeDisplayReady,
      promotionBlockers: [...summary.productPromotionBlockers],
      riskDisplayReady: summary.productRiskDisplayReady,
      validationGate: summary.validationGate ? {
        ...summary.validationGate,
        evidenceTiers: [...summary.validationGate.evidenceTiers],
      } : null,
    },
    risk: {
      ageEstimateBasis: summary.outcomeContext.ageEstimateBasis,
      horizonYears: summary.outcomeContext.horizonYears,
      probability: summary.productRiskDisplayReady ? result?.risk?.probability ?? null : null,
      riskEndpoint: summary.outcomeContext.riskEndpoint,
    },
    schemaVersion: MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION,
    scoreReadiness: buildMurphAgePublicCalculatorScoreReadinessView(report),
    selectedCardId: canExposeScoreIdentity ? report.authorization.cardId : null,
    selectedScoreBearingFeatureKeys: canExposeScoreIdentity ? [...summary.selectedScoreBearingFeatureKeys] : [],
    selectedScoreBearingMetricKeys: canExposeScoreIdentity ? [...summary.selectedScoreBearingMetricKeys] : [],
    status: report.status,
    warnings: report.warnings.map((warning) => ({ ...warning })),
    wearable: buildMurphAgePublicWearableCalculatorView(summary, contextOnlyWearableMetricKeys),
    wearableResidualLayer: null,
  };
}

function buildMurphAgePublicCalculatorScoreReadinessView(
  report: MurphAgePublicCalculatorReport,
): MurphAgePublicCalculatorScoreReadinessView {
  const summary = report.displaySummary;
  const inputBundle = report.inputReadiness.bundle;
  const unlockRequirements = new Set<MurphAgePublicCalculatorUnlockRequirement>();
  const status = resolveMurphAgePublicCalculatorScoreStatus(report);
  if (status === "validated-risk-only") {
    unlockRequirements.add("risk-to-age-display-authorization");
  } else if (status !== "validated-age-ready") {
    if (inputBundle.status !== "ready") {
      unlockRequirements.add("complete-score-bearing-inputs");
    }
    if (!summary.productRiskDisplayReady) {
      unlockRequirements.add("product-policy-authorization");
    }
    if (!summary.productAgeDisplayReady) {
      unlockRequirements.add("risk-to-age-display-authorization");
    }
    for (const blocker of summary.productPromotionBlockers) {
      if (
        blocker === "VALIDATION_GATE_BLOCKED"
        || blocker === "PRODUCT_PROMOTION_EVIDENCE_MISSING"
        || blocker === "PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING"
      ) {
        unlockRequirements.add("external-outcome-validation");
        break;
      }
    }
    if (summary.wearableBridge.readyFeatureKeys.length > 0 && !summary.wearableBridge.scoreBearing) {
      unlockRequirements.add("validated-wearable-parameter-pack");
    }
  }

  return {
    biologicalAgeAvailable: summary.productAgeDisplayReady,
    contextBundleIds: report.inputReadiness.contextBundles.map((bundle) => bundle.bundleId),
    contextOnlyFeatureCount: summary.contextOnlyFeatureKeys.length,
    inputBundleId: inputBundle.bundleId,
    missingScoreBearingFeatureCount: inputBundle.missingFeatureKeys.length,
    riskAvailable: summary.productRiskDisplayReady,
    scoreBearingFeatureCount: inputBundle.availableFeatureKeys.length,
    status,
    unlockRequirements: [...unlockRequirements],
    wearableReadyFeatureCount: summary.wearableBridge.readyFeatureKeys.length,
  };
}

function resolveMurphAgePublicCalculatorScoreStatus(
  report: MurphAgePublicCalculatorReport,
): MurphAgePublicCalculatorScoreStatus {
  const summary = report.displaySummary;
  if (summary.productAgeDisplayReady) return "validated-age-ready";
  if (summary.productRiskDisplayReady) return "validated-risk-only";
  if (summary.displayStatus === "context-only") return "context-only-no-score";
  if (report.inputReadiness.bundle.status === "abstain") return "input-incomplete";
  if (summary.researchEstimateAvailable) return "research-estimate-withheld";
  return "validation-pending";
}

export function buildMurphAgeResearchCalculatorView(
  report: MurphAgePublicCalculatorReport,
): MurphAgeResearchCalculatorView {
  const summary = report.displaySummary;
  const result = report.mode === "research" ? report.result : null;
  const selectedScoreBearingFeatureKeys = result ? [...summary.selectedScoreBearingFeatureKeys] : [];
  const selectedScoreBearingMetricKeys = result ? [...summary.selectedScoreBearingMetricKeys] : [];
  const wearableMetricKeys = new Set(summary.wearableBridge.features.flatMap((feature) => feature.metricKeys));
  const contextOnlyWearableMetricKeys = summary.contextOnlyMetricKeys.filter((metricKey) =>
    wearableMetricKeys.has(metricKey)
  );
  const modelStatus = buildMurphAgeResearchModelStatusView({
    contextOnlyMetricKeys: summary.contextOnlyMetricKeys,
    functionResidualLayer: report.functionResidualLayer,
    selectedResearchCardId: result ? report.authorization.cardId : null,
    selectedScoreBearingFeatureKeys,
    selectedScoreBearingMetricKeys,
    wearableResidualLayer: report.wearableResidualLayer,
  });
  const layeredAgeEstimate = buildMurphAgeResearchLayeredAgeEstimateView({
    modelStatus,
    report,
    result,
  });
  const featureContributions = buildMurphAgeResearchFeatureContributionViews({
    layeredAgeEstimate,
    report,
    result,
  });
  const domainContributions = buildMurphAgeResearchDomainContributionViews({
    layeredAgeEstimate,
    result,
    wearableResidualLayer: report.wearableResidualLayer,
  });
  const primaryResearchAgeEstimate = layeredAgeEstimate ? {
    ageDeltaYears: layeredAgeEstimate.ageDeltaYears,
    biologicalAgeYears: layeredAgeEstimate.biologicalAgeYears,
    chronologicalAgeYears: layeredAgeEstimate.chronologicalAgeYears,
    intervalYears: layeredAgeEstimate.intervalYears ? { ...layeredAgeEstimate.intervalYears } : null,
  } : result ? {
    ageDeltaYears: result.ageDeltaYears,
    biologicalAgeYears: result.biologicalAgeYears,
    chronologicalAgeYears: result.chronologicalAgeYears,
    intervalYears: result.intervalYears ? { ...result.intervalYears } : null,
  } : null;

  return {
    ageEstimate: primaryResearchAgeEstimate,
    arbiter: buildMurphAgeResearchArbiterView(report),
    blockedFeatureKeys: [...summary.blockedFeatureKeys],
    displayBlockedReason: summary.displayBlockedReason,
    displayStatus: summary.displayStatus,
    domainContributions,
    featureContributions,
    featureDrivers: buildMurphAgePublicDriverSummaryView(featureContributions),
    functionResidualLayer: report.functionResidualLayer
      ? cloneMurphAgePublicFunctionResidualLayerView(report.functionResidualLayer)
      : null,
    missingFeatureKeys: [...summary.missingFeatureKeys],
    mode: report.mode,
    model: modelStatus,
    layeredAgeEstimate,
    product: {
      ageDisplayReady: summary.productAgeDisplayReady,
      productUseAuthorized: false,
      promotionBlockers: [...summary.productPromotionBlockers],
      riskDisplayReady: summary.productRiskDisplayReady,
      validationGate: summary.validationGate ? {
        ...summary.validationGate,
        evidenceTiers: [...summary.validationGate.evidenceTiers],
      } : null,
    },
    researchOnly: true,
    risk: {
      ageEstimateBasis: summary.outcomeContext.ageEstimateBasis,
      horizonYears: summary.outcomeContext.horizonYears,
      probability: layeredAgeEstimate?.riskProbability ?? result?.risk?.probability ?? null,
      riskEndpoint: summary.outcomeContext.riskEndpoint,
    },
    schemaVersion: MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION,
    selectedCardId: result ? report.authorization.cardId : null,
    selectedScoreBearingFeatureKeys,
    selectedScoreBearingMetricKeys,
    status: report.status,
    warnings: report.warnings.map((warning) => ({ ...warning })),
    wearable: buildMurphAgePublicWearableCalculatorView(summary, contextOnlyWearableMetricKeys),
    wearableResidualLayer: report.wearableResidualLayer
      ? cloneMurphAgePublicWearableResidualLayerView(report.wearableResidualLayer)
      : null,
  };
}

function buildMurphAgeResearchFeatureContributionViews(input: {
  layeredAgeEstimate: MurphAgeResearchLayeredAgeEstimateView | null;
  report: MurphAgePublicCalculatorReport;
  result: MurphAgePublicResult | null;
}): MurphAgePublicFeatureContributionView[] {
  if (!input.result) return [];
  const contributions = input.result.featureAttributions.map(buildMurphAgePublicFeatureContributionView);
  const wearableContribution = buildMurphAgeResearchWearableResidualFeatureContributionView({
    layeredAgeEstimate: input.layeredAgeEstimate,
    wearableResidualLayer: input.report.wearableResidualLayer,
  });
  if (wearableContribution) contributions.push(wearableContribution);
  return contributions;
}

function buildMurphAgeResearchDomainContributionViews(input: {
  layeredAgeEstimate: MurphAgeResearchLayeredAgeEstimateView | null;
  result: MurphAgePublicResult | null;
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}): MurphAgePublicDomainContributionView[] {
  if (!input.result) return [];
  const contributions = input.result.moduleAttributions.map((module) => ({
    contributionYears: module.contributionYears,
    featureKeys: [...module.featureKeys],
    moduleId: module.moduleId,
  }));
  const wearableContribution = buildMurphAgeResearchWearableResidualFeatureContributionView({
    layeredAgeEstimate: input.layeredAgeEstimate,
    wearableResidualLayer: input.wearableResidualLayer,
  });
  if (wearableContribution) {
    contributions.push({
      contributionYears: wearableContribution.contributionYears,
      featureKeys: [wearableContribution.featureKey],
      moduleId: wearableContribution.moduleId,
    });
  }
  return contributions;
}

function buildMurphAgeResearchWearableResidualFeatureContributionView(input: {
  layeredAgeEstimate: MurphAgeResearchLayeredAgeEstimateView | null;
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}): MurphAgePublicFeatureContributionView | null {
  const wearableResidualLayer = input.wearableResidualLayer;
  const wearableLayerApplied =
    input.layeredAgeEstimate?.appliedLayerIds.includes(MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID) === true
    && wearableResidualLayer?.status === "research-parameterized-shadow-delta"
    && wearableResidualLayer.residualDeltaYears !== null;
  if (!wearableLayerApplied) return null;

  return {
    contributionYears: wearableResidualLayer.residualDeltaYears,
    featureKey: MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID,
    metricKey: null,
    moduleId: "wearable",
    status: "ready",
    warnings: wearableResidualLayer.warnings.map((warning) => ({ ...warning })),
  };
}

function buildMurphAgePublicFeatureContributionView(
  feature: MurphAgePublicFeatureAttribution,
): MurphAgePublicFeatureContributionView {
  return {
    contributionYears: feature.contributionYears,
    featureKey: feature.featureKey,
    metricKey: feature.metricKey,
    moduleId: feature.moduleId,
    status: feature.status,
    warnings: feature.warnings.map((warning) => ({ ...warning })),
  };
}

function buildMurphAgePublicDriverSummaryView(
  featureContributions: readonly MurphAgePublicFeatureContributionView[],
): MurphAgePublicDriverSummaryView {
  const drivers = featureContributions
    .filter((feature) =>
      feature.metricKey !== null
      && feature.status === "ready"
      && feature.contributionYears !== null
      && feature.contributionYears !== 0
    )
    .map((feature) => ({
      ...feature,
      absoluteContributionYears: Math.abs(feature.contributionYears ?? 0),
      direction: resolveMurphAgePublicDriverDirection(feature.contributionYears ?? 0),
      warnings: feature.warnings.map((warning) => ({ ...warning })),
    }))
    .sort((left, right) =>
      right.absoluteContributionYears - left.absoluteContributionYears
      || left.featureKey.localeCompare(right.featureKey)
    );

  return {
    neutral: drivers.filter((driver) => driver.direction === "neutral"),
    older: drivers.filter((driver) => driver.direction === "older"),
    younger: drivers.filter((driver) => driver.direction === "younger"),
  };
}

function resolveMurphAgePublicDriverDirection(
  contributionYears: number,
): MurphAgePublicDriverDirection {
  if (contributionYears > 0) return "older";
  if (contributionYears < 0) return "younger";
  return "neutral";
}

function buildMurphAgePublicWearableCalculatorView(
  summary: MurphAgePublicDisplaySummary,
  contextOnlyWearableMetricKeys: readonly string[],
): MurphAgePublicWearableCalculatorView {
  return {
    candidateFeatureCount: summary.wearableBridge.candidateFeatureCount,
    contextOnlyMetricKeys: [...contextOnlyWearableMetricKeys],
    deferredFeatureKeys: [...summary.wearableBridge.deferredFeatureKeys],
    features: summary.wearableBridge.features.map(cloneMurphAgePublicWearableBridgeFeatureReadiness),
    firstPriorityIncompleteFeatureKeys: [...summary.wearableBridge.firstPriorityIncompleteFeatureKeys],
    firstPriorityReadyFeatureKeys: [...summary.wearableBridge.firstPriorityReadyFeatureKeys],
    missingFeatureKeys: [...summary.wearableBridge.missingFeatureKeys],
    partialFeatureKeys: [...summary.wearableBridge.partialFeatureKeys],
    quality: summary.wearableContext.quality,
    readyFeatureKeys: [...summary.wearableBridge.readyFeatureKeys],
    scoreBearing: false,
    scoreContributionAuthorized: false,
    scorePolicy: summarizeMurphAgeWearableScoreBearingStrategy(),
    secondPriorityIncompleteFeatureKeys: [...summary.wearableBridge.secondPriorityIncompleteFeatureKeys],
    secondPriorityReadyFeatureKeys: [...summary.wearableBridge.secondPriorityReadyFeatureKeys],
  };
}

function buildMurphAgeResearchLayeredAgeEstimateView(input: {
  modelStatus: MurphAgeResearchModelStatusView;
  report: MurphAgePublicCalculatorReport;
  result: MurphAgePublicResult | null;
}): MurphAgeResearchLayeredAgeEstimateView | null {
  if (!input.result) return null;
  const functionShadow = input.report.functionResidualLayer;
  const wearableShadow = input.report.wearableResidualLayer;
  const appliedResidualLayerIds: MurphAgeResearchLayerId[] = [];
  let finalRiskAgeEquivalentYears: number | null = input.result.biologicalAgeYears;
  let finalRiskProbability: number | null = input.result.risk?.probability ?? null;

  const functionShadowApplied = functionShadow?.status === "research-parameterized-shadow-delta";
  if (
    wearableShadow?.status === "research-parameterized-shadow-delta"
    && wearableShadow.finalRiskAgeEquivalentYears !== null
    && wearableShadow.finalRiskProbability !== null
  ) {
    if (functionShadowApplied) appliedResidualLayerIds.push("function-disability-sidecar");
    appliedResidualLayerIds.push(MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID);
    finalRiskAgeEquivalentYears = wearableShadow.finalRiskAgeEquivalentYears;
    finalRiskProbability = wearableShadow.finalRiskProbability;
  }

  if (appliedResidualLayerIds.length > 0 && finalRiskAgeEquivalentYears !== null && finalRiskProbability !== null) {
    const scoreLayerIds = uniqueMurphAgeResearchLayerIds([
      ...input.modelStatus.layeredResearchPath.activeResearchScoreLayerIds,
      ...appliedResidualLayerIds,
    ]);
    const status: MurphAgeResearchLayeredAgeEstimateStatus =
      appliedResidualLayerIds.length > 1
        ? "multi-residual-shadow-applied"
        : "wearable-shadow-applied";
    const basis = status === "wearable-shadow-applied"
      ? "wearable-shadow-risk-age"
      : "residual-shadow-risk-age";
    return {
      ageDeltaYears: roundYears(finalRiskAgeEquivalentYears - input.result.chronologicalAgeYears),
      appliedLayerIds: scoreLayerIds,
      basis,
      biologicalAgeYears: finalRiskAgeEquivalentYears,
      chronologicalAgeYears: input.result.chronologicalAgeYears,
      intervalYears: null,
      productAuthorized: false,
      residualDeltaYears: input.result.biologicalAgeYears !== null
        ? roundYears(finalRiskAgeEquivalentYears - input.result.biologicalAgeYears)
        : null,
      residualScoreContributionAuthorized: false,
      riskProbability: finalRiskProbability,
      status,
      uncertaintyStatus: "not-reestimated-for-shadow",
    };
  }

  return {
    ageDeltaYears: input.result.ageDeltaYears,
    appliedLayerIds: [...input.modelStatus.layeredResearchPath.activeResearchScoreLayerIds],
    basis: "selected-card-risk-age",
    biologicalAgeYears: input.result.biologicalAgeYears,
    chronologicalAgeYears: input.result.chronologicalAgeYears,
    intervalYears: input.result.intervalYears ? { ...input.result.intervalYears } : null,
    productAuthorized: false,
    residualDeltaYears: null,
    residualScoreContributionAuthorized: false,
    riskProbability: input.result.risk?.probability ?? null,
    status: "selected-card-only",
    uncertaintyStatus: "selected-card-interval",
  };
}

function toPublicMurphAgeFunctionResidualLayerView(
  application: MurphAgeFunctionResidualLayerApplication | null,
): MurphAgePublicFunctionResidualLayerView | null {
  if (!application) return null;
  return {
    anchorCardId: application.anchorCardId,
    eligibleForResidualResearch: application.eligibleForResidualResearch,
    layerId: application.layerId,
    parameterPackHash: application.parameterPackHash,
    parameterizationAvailable: application.parameterizationAvailable,
    productAuthorized: false,
    residualDeltaYears: application.residualDeltaYears,
    residualDeltaLogit: application.residualDeltaLogit,
    schemaVersion: application.schemaVersion,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys: application.selectedMetricKeys.map(toPublicMetricKey).filter(isString),
    status: application.status,
    warnings: toPublicMurphAgeWarnings(application.warnings),
  };
}

function cloneMurphAgePublicFunctionResidualLayerView(
  view: MurphAgePublicFunctionResidualLayerView,
): MurphAgePublicFunctionResidualLayerView {
  return {
    ...view,
    selectedMetricKeys: [...view.selectedMetricKeys],
    warnings: view.warnings.map((warning) => ({ ...warning })),
  };
}

function toPublicMurphAgeWearableResidualLayerView(
  application: MurphAgeWearableResidualLayerApplication | null,
): MurphAgePublicWearableResidualLayerView | null {
  if (!application) return null;
  return {
    anchorCardId: application.anchorCardId,
    anchorRiskAgeEquivalentYears: application.anchorRiskAgeEquivalentYears,
    eligibleForResidualResearch: application.eligibleForResidualResearch,
    finalRiskAgeEquivalentYears: application.finalRiskAgeEquivalentYears,
    finalRiskProbability: application.finalRiskProbability,
    layerId: application.layerId,
    parameterPackHash: application.parameterPackHash,
    parameterizationAvailable: application.parameterizationAvailable,
    productAuthorized: false,
    residualDeltaYears: application.residualDeltaYears,
    residualDeltaLogit: application.residualDeltaLogit,
    schemaVersion: application.schemaVersion,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    selectedMetricKeys: application.selectedMetricKeys.map(toPublicMetricKey).filter(isString),
    status: application.status,
    warnings: toPublicMurphAgeWarnings(application.warnings),
  };
}

function cloneMurphAgePublicWearableResidualLayerView(
  view: MurphAgePublicWearableResidualLayerView,
): MurphAgePublicWearableResidualLayerView {
  return {
    ...view,
    selectedMetricKeys: [...view.selectedMetricKeys],
    warnings: view.warnings.map((warning) => ({ ...warning })),
  };
}

function cloneMurphAgePublicWearableBridgeFeatureReadiness(
  feature: MurphAgePublicWearableBridgeFeatureReadiness,
): MurphAgePublicWearableBridgeFeatureReadiness {
  return {
    family: feature.family,
    featureKey: feature.featureKey,
    measurementMethod: feature.measurementMethod,
    methodQualifier: feature.methodQualifier,
    metricKeys: [...feature.metricKeys],
    missingMetricKeys: [...feature.missingMetricKeys],
    missingQualityMetricKeys: [...feature.missingQualityMetricKeys],
    productAuthorized: false,
    qualityReady: feature.qualityReady,
    readyMetricKeys: [...feature.readyMetricKeys],
    requiredQualityMetricKeys: [...feature.requiredQualityMetricKeys],
    riskEffect: "not-estimated",
    role: feature.role,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    status: feature.status,
    uncertaintyAction: feature.uncertaintyAction,
    unlockPriority: feature.unlockPriority,
  };
}

function buildMurphAgeResearchArbiterView(
  report: MurphAgePublicCalculatorReport,
): MurphAgeResearchArbiterView {
  const selectedCandidateCardId = report.researchCandidateCards.find((candidate) => candidate.selected)?.cardId ?? null;
  const scoredCardId = report.result ? report.authorization.cardId : null;
  return {
    candidateCards: report.researchCandidateCards.map((candidate) => ({
      availableFeatureKeys: [...candidate.availableFeatureKeys],
      blockerCodes: [...candidate.blockerCodes],
      bundleId: candidate.bundleId,
      cardId: candidate.cardId,
      inputStatus: candidate.inputStatus,
      missingFeatureKeys: [...candidate.missingFeatureKeys],
      modelLoaded: candidate.modelLoaded,
      readyForResearchRun: candidate.selected
        && candidate.cardId === scoredCardId
        && report.status === "ready"
        && report.result?.status === "ready"
        && candidate.inputStatus === "ready"
        && candidate.modelLoaded
        && candidate.blockerCodes.length === 0,
      role: resolveMurphAgeResearchCardRole(candidate.cardId),
      selected: candidate.selected,
      selectedMetricKeys: [...candidate.selectedMetricKeys],
      warnings: candidate.warnings.map((warning) => ({ ...warning })),
    })),
    labConflictPolicy: "l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-guard-r399-anchor-fallback",
    selectedCardRole: selectedCandidateCardId
      ? resolveMurphAgeResearchCardRole(selectedCandidateCardId)
      : null,
    selectionReason: resolveMurphAgeResearchArbiterSelectionReason(selectedCandidateCardId),
    strategy: "r399-anchor-l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-function-sidecar-wearables-context",
    wearableScorePolicy:
      report.wearableResidualLayer?.status === "research-parameterized-shadow-delta"
        ? "research-residual-shadow-product-blocked"
        : "context-only-not-score-bearing",
  };
}

function resolveMurphAgeResearchCardRole(cardId: MurphAgeScoreBearingCardId): MurphAgeResearchCardRole {
  switch (cardId) {
    case "l1b_glycemia_body_10y_acm_research":
      return "current-alpha-glycemia-body-core";
    case "lab9_bp_body_10y_acm_research":
      return "primary-lab-bp-body-adjuster";
    case "lab5_bp_bmi_transport_research":
      return "transport-fallback-and-discordance-guard";
    case "l1_tiny_glycemia_10y_acm_research":
      return "minimal-glycemia-first-pass";
    case "r399_nhis_proxy_10y_acm_research":
      return "outcome-risk-anchor-and-fallback";
  }
}

function resolveMurphAgeResearchArbiterSelectionReason(
  cardId: MurphAgePublicAuthorization["cardId"],
): MurphAgeResearchArbiterSelectionReason {
  switch (cardId) {
    case "l1b_glycemia_body_10y_acm_research":
      return "current-alpha-glycemia-body-selected";
    case "lab9_bp_body_10y_acm_research":
      return "primary-lab-card-selected";
    case "lab5_bp_bmi_transport_research":
      return "transport-fallback-selected";
    case "l1_tiny_glycemia_10y_acm_research":
      return "minimal-glycemia-selected";
    case "r399_nhis_proxy_10y_acm_research":
      return "anchor-selected";
    case "function_context_no_risk":
    case "wearable_context_no_risk":
    case null:
      return "no-score-bearing-card-selected";
  }
}

function buildMurphAgeResearchLayeredPathStatus(input: {
  functionResidualLayer: MurphAgePublicFunctionResidualLayerView | null;
  selectedResearchCardId: MurphAgePublicAuthorization["cardId"];
  selectedScoreBearingMetricKeys: readonly string[];
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}): MurphAgeResearchLayeredPathStatus {
  const wearableContracts = summarizeMurphAgeWearableResidualLayerContracts();
  const wearableSignalMetricKeys = uniqueStrings(wearableContracts.flatMap((contract) => contract.signalMetricKeys));
  const selectedCardId = input.selectedResearchCardId;
  const functionParameterPackAvailable = input.functionResidualLayer?.parameterizationAvailable === true;
  const wearableParameterPackAvailable = input.wearableResidualLayer?.parameterizationAvailable === true;
  const functionShadowApplied = input.functionResidualLayer?.status === "research-parameterized-shadow-delta";
  const wearableShadowApplied = input.wearableResidualLayer?.status === "research-parameterized-shadow-delta"
    && input.wearableResidualLayer.finalRiskAgeEquivalentYears !== null
    && input.wearableResidualLayer.finalRiskProbability !== null;
  const r399Selected = selectedCardId === "r399_nhis_proxy_10y_acm_research";
  const labBodySelected = selectedCardId !== null
    && selectedCardId !== "r399_nhis_proxy_10y_acm_research"
    && selectedCardId !== "function_context_no_risk"
    && selectedCardId !== "wearable_context_no_risk";
  const baseResearchScoreLayerIds: MurphAgeResearchLayerId[] = r399Selected
    ? ["r399-outcome-risk-anchor"]
    : labBodySelected
    ? ["selected-lab-body-card"]
    : [];
  const residualResearchScoreLayerIds: MurphAgeResearchLayerId[] = wearableShadowApplied
    ? [
      ...(functionShadowApplied ? ["function-disability-sidecar" as const] : []),
      MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID,
    ]
    : [];
  const activeResearchScoreLayerIds = uniqueMurphAgeResearchLayerIds([
    ...baseResearchScoreLayerIds,
    ...residualResearchScoreLayerIds,
  ]);
  const parameterPackBlockedLayerIds: MurphAgeResearchLayerId[] = [];
  if (!functionParameterPackAvailable) {
    parameterPackBlockedLayerIds.push("function-disability-sidecar");
  }
  if (!wearableParameterPackAvailable) {
    parameterPackBlockedLayerIds.push(MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID);
  }

  return {
    activeResearchScoreLayerIds,
    architecturePattern: "frozen-r399-anchor-plus-selected-lab-card-plus-function-and-wearable-residuals",
    currentExecutableMode: residualResearchScoreLayerIds.length > 0
      ? "single-card-plus-parameterized-residual-shadow-score"
      : "single-card-research-score-layer-contracts-only",
    layerOrder: [
      "r399-outcome-risk-anchor",
      "selected-lab-body-card",
      "function-disability-sidecar",
      MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID,
    ],
    layers: [
      {
        combinationScale: "risk-logit",
        layerId: "r399-outcome-risk-anchor",
        metricKeys: MURPH_AGE_R399_PROXY_FEATURES.flatMap((feature) => feature.metricKeys),
        parameterPackAvailable: true,
        parameterPackRequired: false,
        productAuthorized: false,
        role: "base-outcome-risk",
        scoreBearingNow: r399Selected,
        scoreContributionAuthorized: false,
        selected: r399Selected,
        sourceEvidenceIds: [],
        status: r399Selected ? "active-research-score" : "available-as-anchor",
        validationStillNeeded: true,
      },
      {
        combinationScale: "risk-logit",
        layerId: "selected-lab-body-card",
        metricKeys: [...input.selectedScoreBearingMetricKeys],
        parameterPackAvailable: labBodySelected,
        parameterPackRequired: false,
        productAuthorized: false,
        role: "lab-body-risk-adjuster",
        scoreBearingNow: labBodySelected,
        scoreContributionAuthorized: false,
        selected: labBodySelected,
        sourceEvidenceIds: [
          "midus-lab-lift-local-run",
          "creles-glycemia-transport-local-run",
          "haalsi-glucose-transport-local-run",
          "nshap-hba1c-transport-local-run",
        ],
        status: labBodySelected ? "active-research-score" : "available-research-candidate",
        validationStillNeeded: true,
      },
      {
        combinationScale: "risk-logit-residual",
        layerId: "function-disability-sidecar",
        metricKeys: [
          "adl-limitation-count",
          "iadl-limitation-count",
          "mobility-limitation-count",
          "frailty-symptom-count",
        ],
        parameterPackAvailable: functionParameterPackAvailable,
        parameterPackRequired: true,
        productAuthorized: false,
        role: "function-mobility-residual",
        scoreBearingNow: functionShadowApplied && wearableShadowApplied,
        scoreContributionAuthorized: false,
        selected: functionShadowApplied && wearableShadowApplied,
        sourceEvidenceIds: ["mhas-function-mobility-sidecar-local-run"],
        status: functionShadowApplied && wearableShadowApplied
          ? "active-research-shadow-score"
          : functionParameterPackAvailable
          ? "parameter-pack-available-shadow-only"
          : "parameter-pack-needed",
        validationStillNeeded: true,
      },
      {
        combinationScale: "risk-logit-residual",
        layerId: MURPH_AGE_MULTI_FAMILY_WEARABLE_RESEARCH_LAYER_ID,
        metricKeys: wearableSignalMetricKeys,
        parameterPackAvailable: wearableParameterPackAvailable,
        parameterPackRequired: true,
        productAuthorized: false,
        role: "wearable-multi-family-residual",
        scoreBearingNow: wearableShadowApplied,
        scoreContributionAuthorized: false,
        selected: wearableShadowApplied,
        sourceEvidenceIds: ["wearables-context-only-local-run"],
        status: wearableShadowApplied
          ? "active-research-shadow-score"
          : wearableParameterPackAvailable
          ? "parameter-pack-available-shadow-only"
          : "validation-receipt-needed",
        validationStillNeeded: true,
      },
    ],
    parameterPackBlockedLayerIds,
    productAuthorized: false,
    scoreCombinationScale: "risk-logit-residual",
  };
}

function uniqueMurphAgeResearchLayerIds(ids: readonly MurphAgeResearchLayerId[]): MurphAgeResearchLayerId[] {
  const seen = new Set<MurphAgeResearchLayerId>();
  const uniqueIds: MurphAgeResearchLayerId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }
  return uniqueIds;
}

function buildMurphAgeResearchModelStatusView(input: {
  contextOnlyMetricKeys: readonly string[];
  functionResidualLayer: MurphAgePublicFunctionResidualLayerView | null;
  selectedResearchCardId: MurphAgePublicAuthorization["cardId"];
  selectedScoreBearingFeatureKeys: readonly string[];
  selectedScoreBearingMetricKeys: readonly string[];
  wearableResidualLayer: MurphAgePublicWearableResidualLayerView | null;
}): MurphAgeResearchModelStatusView {
  const shadowEvidence = summarizeMurphAgePublicLabWearableShadowEvidenceStatus();
  const wearableShadowApplied = input.wearableResidualLayer?.status === "research-parameterized-shadow-delta"
    && input.wearableResidualLayer.finalRiskAgeEquivalentYears !== null
    && input.wearableResidualLayer.finalRiskProbability !== null;
  return {
    blockers: [
      "biomarker-transport-not-confirmed",
      "wearable-increment-not-validated",
      "product-use-not-authorized",
    ],
    contextOnlyMetricKeys: [...input.contextOnlyMetricKeys],
    currentModelFamily: "frozen-nhis-r399-plus-research-increments",
    composition: {
      anchorLayerStatus: "available-as-research-anchor-and-fallback-not-layered",
      currentScoringMode: wearableShadowApplied
        ? "selected-card-plus-parameterized-residual-shadow"
        : "single-selected-research-card",
      labBodyStatus: "selected-card-score-not-additive-increment",
      nextArchitectureStep: input.functionResidualLayer?.parameterizationAvailable === true
        ? "validate-function-sidecar-and-wearable-residuals-before-product-use"
        : "parameterize-function-sidecar-for-layered-scoring",
      wearableStatus: wearableShadowApplied
        ? "research-shadow-residual-score-product-blocked"
        : "context-only-zero-product-multiplier",
    },
    functionDisability: {
      currentUse: "hardened-research-lead-sidecar-not-product-age",
      nextAction: "parameterize-function-sidecar-for-layered-scoring-then-fresh-validation",
      scoreBearing: false,
    },
    labBody: {
      currentUse: "score-bearing-research-when-selected",
      nextAction: "validate-transport-before-product-use",
      transportStatus: "internal-promising-transport-not-confirmed",
    },
    latestLocalRunEvidence: [
      {
        cohortLabel: "MIDUS",
        evidenceId: "midus-lab-lift-local-run",
        productAuthorizationChanged: false,
        scoringMathChanged: false,
        signal: "weak",
        sourceRouteId: "midus-biomarker-mortality",
        summary: "MIDUS-family local aggregate runs do not confirm glycemia specificity because negative controls compete in at least one direction.",
        supportedMetricKeys: ["glucose", "egfr", "bmi"],
      },
      {
        cohortLabel: "CRELES",
        evidenceId: "creles-glycemia-transport-local-run",
        productAuthorizationChanged: false,
        scoringMathChanged: false,
        signal: "weak",
        sourceRouteId: "creles-transport-stress",
        summary: "CRELES/MIDUS minimal glycemia transport is not confirmed because negative controls also beat age/sex under recalibrated transport.",
        supportedMetricKeys: ["glucose"],
      },
      {
        cohortLabel: "HAALSI",
        evidenceId: "haalsi-glucose-transport-local-run",
        productAuthorizationChanged: false,
        scoringMathChanged: false,
        signal: "supported",
        sourceRouteId: "haalsi-transport-stress",
        summary: "HAALSI aggregate diagnostics support glucose signal with clean negative controls, still research-only.",
        supportedMetricKeys: ["glucose"],
      },
      {
        cohortLabel: "NSHAP",
        evidenceId: "nshap-hba1c-transport-local-run",
        productAuthorizationChanged: false,
        scoringMathChanged: false,
        signal: "partial",
        sourceRouteId: "nshap-integrated-aging",
        summary: "NSHAP HbA1c replication is directionally useful but partial because controls compete in one wave.",
        supportedMetricKeys: ["hba1c"],
      },
      {
        bundleId: "function-context",
        cohortLabel: "MHAS",
        evidenceId: "mhas-function-mobility-sidecar-local-run",
        productAuthorizationChanged: false,
        scoringMathChanged: false,
        signal: "supported",
        sourceRouteId: "mhas-harmonized-aging",
        summary: "MHAS panel extension, anchor-increment, and deep residual diagnostics support function/mobility as the hardened research lead sidecar, still requiring layered parameterization and fresh validation before product use.",
        supportedMetricKeys: [
          "adl-limitation-count",
          "iadl-limitation-count",
          "mobility-limitation-count",
          "frailty-symptom-count",
        ],
      },
      {
        bundleId: "wearable-context",
        cohortLabel: "wearables",
        evidenceId: "wearables-context-only-local-run",
        productAuthorizationChanged: false,
        scoringMathChanged: false,
        signal: "context-only",
        summary: "Wearable and wearable-adjacent evidence remains context-only until true lab/wearable/outcome validation lands.",
        supportedMetricKeys: [],
      },
    ],
    latestLocalRunEvidenceStatus: "mixed-research-only-no-product-promotion",
    layeredResearchPath: buildMurphAgeResearchLayeredPathStatus({
      functionResidualLayer: input.functionResidualLayer,
      selectedResearchCardId: input.selectedResearchCardId,
      selectedScoreBearingMetricKeys: input.selectedScoreBearingMetricKeys,
      wearableResidualLayer: input.wearableResidualLayer,
    }),
    productUseAuthorized: false,
    scoreBearingFeatureKeys: [...input.selectedScoreBearingFeatureKeys],
    scoreBearingMetricKeys: [...input.selectedScoreBearingMetricKeys],
    scoreInterpretation: "risk-age-equivalent-research-only",
    selectedResearchCardId: input.selectedResearchCardId,
    wearable: {
      consumerValidationStatus: "missing",
      currentUse: wearableShadowApplied ? "research-shadow-residual-score" : "context-only-shadow",
      externalConsumerLabWearableAggregateStillMissing: shadowEvidence.externalConsumerLabWearableAggregateStillMissing,
      nextAction: shadowEvidence.nextAction,
      nextExternalOrPartnerRouteIdsByPriority: [...shadowEvidence.nextExternalOrPartnerRouteIdsByPriority],
      researchScoreBearing: wearableShadowApplied,
      scoreBearing: false,
      scoreContributionAuthorized: false,
      shadowEvidenceConclusion: shadowEvidence.conclusion,
      shadowEvidencePacketIds: [...shadowEvidence.includedPacketIds],
      usableAsConsumerWearableValidation: shadowEvidence.usableAsConsumerWearableValidation,
    },
  };
}

function resolveMurphAgePublicCalculatorViewDisplayCategory(
  displayStatus: MurphAgeDisplayStatus,
): MurphAgePublicCalculatorViewDisplayCategory {
  if (displayStatus === "research-only") return "research-preview";
  return displayStatus;
}

function toPublicMurphAgeResearchCandidateCardAssessment(
  assessment: MurphAgeResearchCandidateCardAssessment,
): MurphAgePublicResearchCandidateCardAssessment {
  return {
    availableFeatureKeys: toPublicFeatureKeyList(assessment.availableFeatureKeys),
    blockerCodes: [...assessment.blockerCodes],
    bundleId: assessment.bundleId,
    cardId: assessment.cardId,
    inputStatus: assessment.inputStatus,
    missingFeatureKeys: toPublicFeatureKeyList(assessment.missingFeatureKeys),
    modelLoaded: assessment.modelLoaded,
    selected: assessment.selected,
    selectedMetricKeys: toPublicMetricKeyList(assessment.selectedMetricKeys),
    warnings: toPublicMurphAgeWarnings(assessment.warnings),
  };
}

function toPublicMurphAgeInputReadiness(
  output: MurphAgeCalculatorOutput,
): MurphAgePublicInputReadinessSummary {
  return {
    bundle: toPublicMurphAgeInputBundleReadiness(output.bundleAssessment),
    contextBundles: output.contextAssessments.map(toPublicMurphAgeInputBundleReadiness),
  };
}

function toPublicMurphAgeInputBundleReadiness(
  assessment: MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
): MurphAgePublicInputBundleReadiness {
  return {
    availableFeatureKeys: toPublicFeatureKeyList(assessment.availableFeatureKeys),
    bundleId: assessment.bundleId,
    featureStatuses: assessment.featureStatuses.map(toPublicMurphAgeInputFeatureReadiness),
    missingFeatureKeys: toPublicFeatureKeyList(assessment.missingFeatureKeys),
    recommendedCardId: assessment.recommendedCardId,
    schemaVersion: assessment.schemaVersion,
    selectedMetricKeys: toPublicMetricKeyList(assessment.selectedMetricKeys),
    status: assessment.status,
    warnings: toPublicMurphAgeWarnings(assessment.warnings),
  };
}

function toPublicMurphAgeInputFeatureReadiness(
  feature: MurphAgeContextBundleFeatureStatus | MurphAgeInputBundleFeatureStatus,
): MurphAgePublicInputFeatureReadiness {
  return {
    featureKey: toPublicFeatureKeyFromKey(feature.featureKey) ?? "model-feature",
    metricKeys: toPublicMetricKeyList(feature.metricKeys),
    requiredFor: feature.requiredFor,
    selectedMetricKey: toPublicMetricKey(feature.selectedMetricKey),
    status: feature.status,
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
    productPromotionBlockers: toPublicMurphAgeProductPromotionBlockers(summary.productPromotionBlockers),
    productRiskDisplayReady: summary.productRiskDisplayReady,
    researchEstimateAvailable: summary.researchEstimateAvailable,
    schemaVersion: MURPH_AGE_PUBLIC_DISPLAY_SUMMARY_SCHEMA_VERSION,
    selectedScoreBearingFeatureKeys: toPublicFeatureKeyList(summary.selectedScoreBearingFeatureKeys),
    selectedScoreBearingMetricKeys: toPublicMetricKeyList(summary.selectedScoreBearingMetricKeys),
    validationGate: summary.validationGate ? toPublicMurphAgeValidationGateSummary(summary.validationGate) : null,
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

function toPublicMurphAgeValidationGateSummary(
  summary: MurphAgeValidationGateSummary,
): MurphAgePublicValidationGateSummary {
  const evidenceTiers = toPublicMurphAgeValidationEvidenceTiers(summary.evidenceTiers);
  const productPromotionEvidence = summary.productPromotionEvidence === true
    && evidenceTiers.some((tier) => MURPH_AGE_PRODUCT_PROMOTION_EVIDENCE_TIERS.has(tier));
  const status = summary.status === "passed" && productPromotionEvidence ? "passed" : "blocked";
  return {
    evidenceTiers,
    productPromotionEvidence,
    status,
    summary: MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT[status],
  };
}

function toPublicMurphAgeProductPromotionBlockers(blockers: unknown): MurphAgeProductPromotionBlocker[] {
  if (!Array.isArray(blockers)) return [];
  const publicBlockers: MurphAgeProductPromotionBlocker[] = [];
  for (const blocker of blockers) {
    if (isMurphAgeProductPromotionBlocker(blocker) && !publicBlockers.includes(blocker)) {
      publicBlockers.push(blocker);
    }
  }
  return publicBlockers;
}

function toPublicMurphAgeValidationEvidenceTiers(evidenceTiers: unknown): MurphAgeValidationEvidenceTier[] {
  if (!Array.isArray(evidenceTiers)) return [];
  const publicEvidenceTiers: MurphAgeValidationEvidenceTier[] = [];
  for (const tier of evidenceTiers) {
    if (isMurphAgeValidationEvidenceTier(tier) && !publicEvidenceTiers.includes(tier)) {
      publicEvidenceTiers.push(tier);
    }
  }
  return publicEvidenceTiers;
}

function isMurphAgeProductPromotionBlocker(value: unknown): value is MurphAgeProductPromotionBlocker {
  return typeof value === "string" && MURPH_AGE_PRODUCT_PROMOTION_BLOCKERS.has(value);
}

function isMurphAgeValidationEvidenceTier(value: unknown): value is MurphAgeValidationEvidenceTier {
  return typeof value === "string" && MURPH_AGE_VALIDATION_EVIDENCE_TIERS.has(value);
}

function toPublicMurphAgeResult(result: MurphAgeResult): MurphAgePublicResult {
  return {
    ageDeltaYears: result.ageDeltaYears,
    authorization: toPublicMurphAgeAuthorization(result.authorization),
    biologicalAgeYears: result.biologicalAgeYears,
    chronologicalAgeYears: result.chronologicalAgeYears,
    featureAttributions: result.featureAttributions.map(toPublicMurphAgeFeatureAttribution),
    intervalYears: result.intervalYears ? { ...result.intervalYears } : null,
    moduleAttributions: toPublicMurphAgeModuleAttributions(result.moduleAttributions, result.featureAttributions),
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
    moduleId: toPublicModuleId(feature.moduleId),
    status: feature.status,
    warnings: toPublicMurphAgeWarnings(feature.warnings),
  };
}

function toPublicMurphAgeModuleAttributions(
  modules: readonly MurphAgeModuleAttribution[],
  features: readonly MurphAgeFeatureAttribution[],
): MurphAgePublicModuleAttribution[] {
  const moduleIds = uniqueStrings(modules.map((module) => toPublicModuleId(module.moduleId)));

  return moduleIds.map((moduleId) => {
    const sourceModules = modules.filter((module) => toPublicModuleId(module.moduleId) === moduleId);
    const featureKeys = uniqueStrings(
      features
        .filter((feature) =>
          (feature.status === "ready" || feature.status === "imputed") && toPublicModuleId(feature.moduleId) === moduleId
        )
        .map(toPublicFeatureKey),
    );
    const contributionYears = sourceModules.some((module) => module.contributionYears === null)
      ? null
      : roundYears(sourceModules.reduce((sum, module) => sum + (module.contributionYears ?? 0), 0));
    return {
      contributionYears,
      featureKeys: featureKeys.length > 0
        ? featureKeys
        : uniqueStrings(sourceModules.flatMap((module) => toPublicFeatureKeyList(module.featureKeys))),
      moduleId,
    };
  });
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
  if (MURPH_AGE_PUBLIC_METRIC_KEYS.has(simpleKey)) return simpleKey;
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
  const aliasedKey = MURPH_AGE_PUBLIC_MODULE_ID_ALIASES.get(simpleKey) ?? simpleKey;
  return MURPH_AGE_PUBLIC_MODULE_IDS.has(aliasedKey) ? aliasedKey : "unknown";
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
    measurementMethod: feature.measurementMethod,
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
  const l1bGlycemiaBodyAssessment = assessMurphAgeL1bGlycemiaBody(input);
  if (l1bGlycemiaBodyAssessment.status === "ready") return l1bGlycemiaBodyAssessment;

  const lab9Assessment = assessMurphAgeLab9BpBody(input);
  if (lab9Assessment.status === "ready") return lab9Assessment;

  const lab5Assessment = assessMurphAgeLab5BpBmi(input);
  if (lab5Assessment.status === "ready") return lab5Assessment;

  const l1GlycemiaAssessment = assessMurphAgeL1Glycemia(input);
  if (l1GlycemiaAssessment.status === "ready") return l1GlycemiaAssessment;

  const r399Assessment = assessMurphAgeR399ProxyAnchor(input);
  if (r399Assessment.status === "ready" && !hasMurphAgeScoreBearingLabIntent(input)) return r399Assessment;

  const wearableAssessment = assessMurphAgeWearableContext(input);
  if (wearableAssessment.status === "context-only") return wearableAssessment;

  const functionAssessment = assessMurphAgeFunctionContext(input);
  if (functionAssessment.status === "context-only") return functionAssessment;

  return buildInputBundleAssessment({
    bundleId: "insufficient",
    featureStatuses: [
      ...l1bGlycemiaBodyAssessment.featureStatuses,
      ...lab5Assessment.featureStatuses,
      ...l1GlycemiaAssessment.featureStatuses,
      ...r399Assessment.featureStatuses,
      ...wearableAssessment.featureStatuses,
      ...functionAssessment.featureStatuses,
    ],
    recommendedCardId: "none",
    status: "abstain",
    warnings: [{
      code: "MODEL_FEATURE_MISSING",
      message: "No current Murph Age research input bundle has enough ready metrics to score or contextualize.",
    }],
  });
}

function hasMurphAgeScoreBearingLabIntent(input: MurphAgeInputBundleAssessmentInput): boolean {
  return input.points.some((point) =>
    MURPH_AGE_SCORE_BEARING_LAB_METRIC_KEYS.has(resolveMetricInputKey(point.metricKey))
    && isMurphAgeInputBundleMetricPointAllowed(point)
  );
}

function assessMurphAgeL1bGlycemiaBody(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const l1bStatuses = assessInputFeatureRequirements(input, MURPH_AGE_L1B_GLYCEMIA_BODY_FEATURES);
  const ready = l1bStatuses.every((status) => status.status === "ready");

  return buildInputBundleAssessment({
    bundleId: "l1b-glycemia-body",
    featureStatuses: l1bStatuses,
    recommendedCardId: "l1b_glycemia_body_10y_acm_research",
    status: ready ? "ready" : "abstain",
    warnings: ready
      ? []
      : [{
        code: "MODEL_FEATURE_MISSING",
        message: "L1b glycemia/body research card requires glucose or HbA1c plus BMI.",
      }],
  });
}

function assessMurphAgeLab9BpBody(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const lab9FeatureStatuses = assessInputFeatureRequirements(input, MURPH_AGE_LAB9_FEATURES);
  const bpBodyStatuses = assessInputFeatureRequirements(input, MURPH_AGE_BP_BODY_FEATURES);
  const lab9Statuses = [...lab9FeatureStatuses, ...bpBodyStatuses];
  const lab9Required = lab9Statuses.filter((status) => status.requiredFor === "lab9-mainline");
  const ready = lab9Required.every((status) => status.status === "ready");

  return buildInputBundleAssessment({
    bundleId: "lab9-bp-body",
    featureStatuses: lab9Statuses,
    recommendedCardId: "lab9_bp_body_10y_acm_research",
    status: ready ? "ready" : "abstain",
    warnings: ready
      ? []
      : [{
        code: "MODEL_FEATURE_MISSING",
        message: "Lab9 BP/body research card requires the full Lab9, blood pressure, and body input bundle.",
      }],
  });
}

function assessMurphAgeLab5BpBmi(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const lab5Statuses = assessInputFeatureRequirements(input, MURPH_AGE_LAB5_FEATURES);
  const bpBodyStatuses = assessInputFeatureRequirements(input, MURPH_AGE_BP_BODY_FEATURES);
  const bloodPressureReady = featureReady(bpBodyStatuses, "systolic-blood-pressure")
    && featureReady(bpBodyStatuses, "diastolic-blood-pressure");
  const bodyContextReady = featureReady(bpBodyStatuses, "bmi");
  const ready = lab5Statuses.every((status) => status.status === "ready")
    && (bloodPressureReady || bodyContextReady);

  return buildInputBundleAssessment({
    bundleId: "lab5-bp-bmi",
    featureStatuses: ready
      ? [...lab5Statuses, ...bpBodyStatuses.filter((status) => status.status === "ready")]
      : [...lab5Statuses, ...bpBodyStatuses],
    recommendedCardId: "lab5_bp_bmi_transport_research",
    status: ready ? "ready" : "abstain",
    warnings: ready
      ? []
      : [{
        code: "MODEL_FEATURE_MISSING",
        message: "Lab5 BP/BMI transport card requires glycemia, HDL-C, triglycerides, creatinine/eGFR, and BMI or blood pressure.",
      }],
  });
}

function assessMurphAgeL1Glycemia(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const l1Statuses = assessInputFeatureRequirements(input, MURPH_AGE_L1_GLYCEMIA_FEATURES);
  const ready = l1Statuses.some((status) => status.status === "ready");

  return buildInputBundleAssessment({
    bundleId: "l1-glycemia",
    featureStatuses: l1Statuses,
    recommendedCardId: "l1_tiny_glycemia_10y_acm_research",
    status: ready ? "ready" : "abstain",
    warnings: ready
      ? []
      : [{
        code: "MODEL_FEATURE_MISSING",
        message: "L1 glycemia research card requires glucose or HbA1c.",
      }],
  });
}

export function assessMurphAgeSecondaryContextBundles(input: MurphAgeInputBundleAssessmentInput & {
  primaryBundleId: MurphAgeInputBundleId;
}): MurphAgeContextBundleAssessment[] {
  return [
    assessMurphAgeWearableContext(input),
    assessMurphAgeFunctionContext(input),
  ]
    .filter((assessment) =>
      assessment.status === "context-only" && assessment.bundleId !== input.primaryBundleId
    )
    .map(toContextBundleAssessment);
}

export function summarizeMurphAgePublicWearableBridgeFromInputBundle(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgePublicWearableBridgeSummary {
  const bundleAssessment = assessMurphAgeInputBundle(input);
  const contextAssessments = assessMurphAgeSecondaryContextBundles({
    ...input,
    primaryBundleId: bundleAssessment.bundleId,
  });
  const primaryContextFeatureStatuses = bundleAssessment.status === "context-only"
    && bundleAssessment.bundleId === "wearable-context"
    ? toContextBundleAssessment(bundleAssessment).featureStatuses
    : [];
  const wearableFeatures = [...primaryContextFeatureStatuses, ...contextAssessments.flatMap((assessment) =>
    assessment.bundleId === "wearable-context" ? assessment.featureStatuses : []
  )]
    .filter((feature) => feature.status === "ready");

  return toPublicWearableBridgeSummary(summarizeWearableBridge(wearableFeatures));
}

function assessMurphAgeR399ProxyAnchor(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const proxyStatuses = assessInputFeatureRequirements(input, MURPH_AGE_R399_PROXY_FEATURES, {
    isPointAllowed: isMurphAgeInputBundleMetricPointAllowed,
  });
  const readyProxyCount = proxyStatuses.filter((status) => status.status === "ready").length;
  const warnings = readyProxyCount === 0
    ? [{
      code: "MODEL_FEATURE_MISSING",
      message: "R399 proxy anchor requires at least one observed proxy input before research scoring.",
    } satisfies MurphAgeWarning]
    : proxyStatuses.some((status) => status.status === "missing")
      ? [{
        code: "MODEL_FEATURE_MISSING",
        message: "R399 proxy anchor can score with imputation, but some proxy inputs are missing and should be treated as lower-confidence research output.",
      } satisfies MurphAgeWarning]
      : [];
  return buildInputBundleAssessment({
    bundleId: "r399-nhis-proxy-anchor",
    featureStatuses: proxyStatuses,
    recommendedCardId: "r399_nhis_proxy_10y_acm_research",
    status: readyProxyCount > 0 ? "ready" : "abstain",
    warnings,
  });
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

function mapRiskToReferenceAgeForAttribution(
  riskProbability: number,
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[],
): number {
  const clamped = mapRiskToReferenceAge(riskProbability, referenceRiskCurve);
  if (clamped.warnings.length === 0) return clamped.ageYears;

  const curve = validateReferenceRiskCurve(referenceRiskCurve);
  const first = curve[0];
  const second = curve[1];
  const nextToLast = curve[curve.length - 2];
  const last = curve[curve.length - 1];
  if (!first || !second || !nextToLast || !last) return clamped.ageYears;

  if (riskProbability < first.riskProbability) {
    return extrapolateReferenceAgeByLogit(riskProbability, first, second);
  }
  if (riskProbability > last.riskProbability) {
    return extrapolateReferenceAgeByLogit(riskProbability, nextToLast, last);
  }
  return clamped.ageYears;
}

function mapRiskToReferenceAgeEquivalentOrNull(input: {
  referenceRiskCurve?: readonly MurphAgeReferenceRiskPoint[];
  riskProbability: number | null;
}): number | null {
  if (
    !input.referenceRiskCurve
    || input.riskProbability === null
    || !Number.isFinite(input.riskProbability)
    || input.riskProbability < 0
    || input.riskProbability > 1
  ) {
    return null;
  }
  return roundYears(mapRiskToReferenceAgeForAttribution(input.riskProbability, input.referenceRiskCurve));
}

function extrapolateReferenceAgeByLogit(
  riskProbability: number,
  left: MurphAgeReferenceRiskPoint,
  right: MurphAgeReferenceRiskPoint,
): number {
  const riskLogit = logitFromProbability(clampProbabilityForAttribution(riskProbability));
  const leftLogit = logitFromProbability(clampProbabilityForAttribution(left.riskProbability));
  const rightLogit = logitFromProbability(clampProbabilityForAttribution(right.riskProbability));
  if (riskLogit === null || leftLogit === null || rightLogit === null || rightLogit === leftLogit) {
    const riskSpan = right.riskProbability - left.riskProbability;
    if (riskSpan === 0) return left.ageYears;
    return left.ageYears + ((riskProbability - left.riskProbability) / riskSpan) * (right.ageYears - left.ageYears);
  }
  return left.ageYears + ((riskLogit - leftLogit) / (rightLogit - leftLogit)) * (right.ageYears - left.ageYears);
}

function clampProbabilityForAttribution(riskProbability: number): number {
  const epsilon = 1e-9;
  return Math.min(1 - epsilon, Math.max(epsilon, riskProbability));
}

function assessInputFeatureRequirements(
  input: MurphAgeInputBundleAssessmentInput,
  requirements: readonly MurphAgeInputFeatureRequirement[],
  options: {
    isPointAllowed?: (point: MetricPoint) => boolean;
  } = {},
): MurphAgeInputBundleFeatureStatus[] {
  const points = options.isPointAllowed ? input.points.filter(options.isPointAllowed) : input.points;
  return requirements.map((requirement) => {
    const selections = requirement.metricKeys.map((metricKey) =>
      selectMetricValue({
        metricKey,
        now: input.asOf,
        points,
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
    availableFeatureKeys: uniqueStrings(readyFeatures.map((feature) => feature.featureKey)),
    bundleId: input.bundleId,
    featureStatuses: input.featureStatuses.map((feature) => ({
      ...feature,
      metricKeys: [...feature.metricKeys],
      selectedPointIds: [...feature.selectedPointIds],
    })),
    missingFeatureKeys: uniqueStrings(missingFeatures.map((feature) => feature.featureKey)),
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
  functionResidualLayerApplication?: MurphAgeFunctionResidualLayerApplication | null;
  mode: MurphAgeCalculatorMode;
  researchCandidateCards: readonly MurphAgeResearchCandidateCardAssessment[];
  result: MurphAgeResult | null;
  status: MurphAgeInputBundleStatus;
  warnings: readonly MurphAgeWarning[];
  wearableResidualLayerApplication?: MurphAgeWearableResidualLayerApplication | null;
  wearableShadowIncrementAssessments: readonly MurphAgeWearableShadowIncrementAssessment[];
}): MurphAgeCalculatorOutput {
  return {
    authorization: cloneMurphAgeAuthorization(input.authorization),
    bundleAssessment: cloneInputBundleAssessment(input.bundleAssessment),
    cardPolicy: input.cardPolicy ? cloneMurphAgeModelCardPolicy(input.cardPolicy) : null,
    contextAssessments: input.contextAssessments.map(cloneContextBundleAssessment),
    functionResidualLayerApplication: input.functionResidualLayerApplication
      ? cloneMurphAgeFunctionResidualLayerApplication(input.functionResidualLayerApplication)
      : null,
    mode: input.mode,
    researchCandidateCards: input.researchCandidateCards.map(cloneMurphAgeResearchCandidateCardAssessment),
    result: input.result,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: input.status,
    warnings: [...input.warnings],
    wearableResidualLayerApplication: input.wearableResidualLayerApplication
      ? cloneMurphAgeWearableResidualLayerApplication(input.wearableResidualLayerApplication)
      : null,
    wearableShadowIncrementAssessments: input.wearableShadowIncrementAssessments.map(
      cloneMurphAgeWearableShadowIncrementAssessment,
    ),
  };
}

function cloneMurphAgeResearchCandidateCardAssessment(
  assessment: MurphAgeResearchCandidateCardAssessment,
): MurphAgeResearchCandidateCardAssessment {
  return {
    availableFeatureKeys: [...assessment.availableFeatureKeys],
    blockerCodes: [...assessment.blockerCodes],
    bundleId: assessment.bundleId,
    cardId: assessment.cardId,
    inputStatus: assessment.inputStatus,
    missingFeatureKeys: [...assessment.missingFeatureKeys],
    modelLoaded: assessment.modelLoaded,
    selected: assessment.selected,
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    warnings: assessment.warnings.map((warning) => ({ ...warning })),
  };
}

function assessMurphAgeWearableContext(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const wearableStatuses = assessInputFeatureRequirements(input, MURPH_AGE_WEARABLE_CONTEXT_FEATURES, {
    isPointAllowed: isMurphAgeInputBundleMetricPointAllowed,
  });
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

function assessMurphAgeFunctionContext(
  input: MurphAgeInputBundleAssessmentInput,
): MurphAgeInputBundleAssessment {
  const functionStatuses = assessInputFeatureRequirements(input, MURPH_AGE_FUNCTION_CONTEXT_FEATURES, {
    isPointAllowed: isMurphAgeInputBundleMetricPointAllowed,
  });
  if (functionStatuses.some((status) => status.status === "ready")) {
    return buildInputBundleAssessment({
      bundleId: "function-context",
      featureStatuses: functionStatuses,
      recommendedCardId: "function_context_no_risk",
      status: "context-only",
      warnings: [{
        code: "CONTEXT_NOT_SCORE_BEARING",
        message: "Function limitation inputs are available as a bounded research sidecar candidate, but current Murph Age product cards do not score them.",
      }],
    });
  }

  return buildInputBundleAssessment({
    bundleId: "function-context",
    featureStatuses: functionStatuses,
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

function buildWearableBridgeMetricSourceHints(): MurphAgeWearableBridgeMetricSourceHint[] {
  interface MutableHint {
    defaultSourceKind: MurphAgeWearableBridgeSourceKind | null;
    featureKeys: Set<string>;
    metricKey: string;
    qualityMetricRole: MurphAgeWearableBridgeQualityMetricRole | null;
    sourceKinds: Set<MurphAgeWearableBridgeSourceKind>;
    validDaySourceKinds: Set<MurphAgeWearableBridgeSourceKind>;
    validNightSourceKinds: Set<MurphAgeWearableBridgeSourceKind>;
  }

  const hintsByMetricKey = new Map<string, MutableHint>();
  const upsertHint = (input: {
    defaultSourceKind: MurphAgeWearableBridgeSourceKind;
    featureKeys?: readonly string[];
    metricKey: string;
    sourceKinds?: readonly MurphAgeWearableBridgeSourceKind[];
    validDaySourceKinds?: readonly MurphAgeWearableBridgeSourceKind[];
    validNightSourceKinds?: readonly MurphAgeWearableBridgeSourceKind[];
  }) => {
    const metricKey = resolveMetricInputKey(input.metricKey);
    const existing = hintsByMetricKey.get(metricKey) ?? {
      defaultSourceKind: null,
      featureKeys: new Set<string>(),
      metricKey,
      qualityMetricRole: resolveWearableBridgeQualityMetricRole(metricKey),
      sourceKinds: new Set<MurphAgeWearableBridgeSourceKind>(),
      validDaySourceKinds: new Set<MurphAgeWearableBridgeSourceKind>(),
      validNightSourceKinds: new Set<MurphAgeWearableBridgeSourceKind>(),
    };
    existing.defaultSourceKind ??= input.defaultSourceKind;
    for (const featureKey of input.featureKeys ?? []) {
      existing.featureKeys.add(featureKey);
    }
    for (const sourceKind of input.sourceKinds ?? [input.defaultSourceKind]) {
      existing.sourceKinds.add(sourceKind);
    }
    for (const sourceKind of input.validDaySourceKinds ?? []) {
      existing.validDaySourceKinds.add(sourceKind);
      existing.sourceKinds.add(sourceKind);
    }
    for (const sourceKind of input.validNightSourceKinds ?? []) {
      existing.validNightSourceKinds.add(sourceKind);
      existing.sourceKinds.add(sourceKind);
    }
    hintsByMetricKey.set(metricKey, existing);
  };

  for (const feature of MURPH_AGE_WEARABLE_CONTEXT_FEATURES) {
    for (const metricKey of feature.metricKeys) {
      upsertHint({
        defaultSourceKind: inferWearableContextMetricDefaultSourceKind(feature.featureKey, metricKey),
        featureKeys: [feature.featureKey],
        metricKey,
      });
    }
  }

  for (const spec of MURPH_AGE_WEARABLE_BRIDGE_FEATURE_SPECS) {
    for (const metricKey of spec.metricKeys) {
      upsertHint({
        defaultSourceKind: inferWearableBridgeSpecDefaultSourceKind(spec, metricKey),
        featureKeys: [spec.featureKey],
        metricKey,
        sourceKinds: spec.sourceKinds,
      });
    }
    for (const metricKey of spec.requiredQualityMetricKeys) {
      upsertHint({
        defaultSourceKind: inferWearableBridgeQualityMetricDefaultSourceKind(metricKey),
        featureKeys: [spec.featureKey],
        metricKey,
        sourceKinds: spec.sourceKinds,
      });
    }
  }

  for (const metricKey of MURPH_AGE_WEARABLE_DAY_COVERAGE_OBSERVATION_METRIC_KEYS) {
    upsertHint({
      defaultSourceKind: "activity-summary",
      metricKey,
      sourceKinds: MURPH_AGE_WEARABLE_DAY_COVERAGE_OBSERVATION_SOURCE_KINDS,
      validDaySourceKinds: MURPH_AGE_WEARABLE_DAY_COVERAGE_OBSERVATION_SOURCE_KINDS,
    });
  }

  for (const metricKey of MURPH_AGE_WEARABLE_NIGHT_COVERAGE_OBSERVATION_METRIC_KEYS) {
    upsertHint({
      defaultSourceKind: "sleep-summary",
      metricKey,
      sourceKinds: MURPH_AGE_WEARABLE_NIGHT_COVERAGE_OBSERVATION_SOURCE_KINDS,
      validNightSourceKinds: MURPH_AGE_WEARABLE_NIGHT_COVERAGE_OBSERVATION_SOURCE_KINDS,
    });
  }

  for (const metricKey of MURPH_AGE_WEARABLE_SLEEP_SUMMARY_ONLY_NIGHT_COVERAGE_OBSERVATION_METRIC_KEYS) {
    upsertHint({
      defaultSourceKind: "sleep-summary",
      metricKey,
      sourceKinds: MURPH_AGE_WEARABLE_SLEEP_SUMMARY_ONLY_NIGHT_COVERAGE_OBSERVATION_SOURCE_KINDS,
      validNightSourceKinds: MURPH_AGE_WEARABLE_SLEEP_SUMMARY_ONLY_NIGHT_COVERAGE_OBSERVATION_SOURCE_KINDS,
    });
  }

  return [...hintsByMetricKey.values()]
    .map((hint) => {
      const validObservationRoles: MurphAgeWearableBridgeCoverageRole[] = [];
      if (hint.validDaySourceKinds.size > 0) validObservationRoles.push("day");
      if (hint.validNightSourceKinds.size > 0) validObservationRoles.push("night");
      return {
        defaultSourceKind: hint.defaultSourceKind ?? "wearable-summary",
        featureKeys: [...hint.featureKeys].sort(),
        metricKey: hint.metricKey,
        qualityMetricRole: hint.qualityMetricRole,
        sourceKinds: [...hint.sourceKinds].sort(),
        validDaySourceKinds: [...hint.validDaySourceKinds].sort(),
        validNightSourceKinds: [...hint.validNightSourceKinds].sort(),
        validObservationRoles,
      };
    })
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey));
}

function inferWearableContextMetricDefaultSourceKind(
  featureKey: string,
  metricKey: string,
): MurphAgeWearableBridgeSourceKind {
  const qualityMetricRole = resolveWearableBridgeQualityMetricRole(metricKey);
  if (qualityMetricRole === "day") return "activity-summary";
  if (qualityMetricRole === "night") return "sleep-summary";
  if (qualityMetricRole === "coverage") return "wearable-summary";
  if (MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES.activity.includes(featureKey)) return "activity-summary";
  if (MURPH_AGE_WEARABLE_CONTEXT_FAMILY_FEATURES.sleep.includes(featureKey)) return "sleep-summary";
  return "wearable-summary";
}

function inferWearableBridgeSpecDefaultSourceKind(
  spec: MurphAgeWearableBridgeFeatureSpec,
  metricKey: string,
): MurphAgeWearableBridgeSourceKind {
  const qualityMetricRole = resolveWearableBridgeQualityMetricRole(metricKey);
  if (qualityMetricRole) return inferWearableBridgeQualityMetricDefaultSourceKind(metricKey);
  if (spec.sourceKinds.includes("sleep-summary")) return "sleep-summary";
  if (spec.sourceKinds.includes("activity-summary")) return "activity-summary";
  return "wearable-summary";
}

function inferWearableBridgeQualityMetricDefaultSourceKind(
  metricKey: string,
): MurphAgeWearableBridgeSourceKind {
  const qualityMetricRole = resolveWearableBridgeQualityMetricRole(metricKey);
  if (qualityMetricRole === "day") return "activity-summary";
  if (qualityMetricRole === "night") return "sleep-summary";
  return "wearable-summary";
}

function resolveWearableBridgeQualityMetricRole(
  metricKey: string,
): MurphAgeWearableBridgeQualityMetricRole | null {
  const resolvedMetricKey = resolveMetricInputKey(metricKey);
  if (MURPH_AGE_WEARABLE_COVERAGE_QUALITY_METRIC_KEYS.includes(
    resolvedMetricKey as typeof MURPH_AGE_WEARABLE_COVERAGE_QUALITY_METRIC_KEYS[number],
  )) {
    return "coverage";
  }
  if (resolvedMetricKey === "wearable-valid-day-count-28d") return "day";
  if (resolvedMetricKey === "wearable-valid-night-count-28d") return "night";
  return null;
}

function isMurphAgeWearableShadowPoint(point: MetricPoint): boolean {
  return MURPH_AGE_WEARABLE_SHADOW_SOURCE_KINDS.includes(
    point.source.kind as typeof MURPH_AGE_WEARABLE_SHADOW_SOURCE_KINDS[number],
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPlainRecordField(input: {
  key: string;
  label: string;
  object: Readonly<Record<string, unknown>>;
  subject?: string;
  warnings: MurphAgeWarning[];
}): Record<string, unknown> | null {
  const value = input.object[input.key];
  if (isPlainRecord(value)) return value;
  input.warnings.push({
    code: "INVALID_INPUT",
    message: `${input.subject ?? "Wearable shadow result card"} ${input.label} must be an object.`,
  });
  return null;
}

function readStringField(input: {
  key: string;
  label: string;
  object: Readonly<Record<string, unknown>>;
  subject?: string;
  warnings: MurphAgeWarning[];
}): string | null {
  const value = input.object[input.key];
  if (typeof value === "string") return value;
  input.warnings.push({
    code: "INVALID_INPUT",
    message: `${input.subject ?? "Wearable shadow result card"} ${input.label} must be a string.`,
  });
  return null;
}

function readBooleanField(input: {
  key: string;
  label: string;
  object: Readonly<Record<string, unknown>>;
  subject?: string;
  warnings: MurphAgeWarning[];
}): boolean | null {
  const value = input.object[input.key];
  if (typeof value === "boolean") return value;
  input.warnings.push({
    code: "INVALID_INPUT",
    message: `${input.subject ?? "Wearable shadow result card"} ${input.label} must be a boolean.`,
  });
  return null;
}

function appendUnknownObjectKeyWarnings(input: {
  allowedKeys: ReadonlySet<string>;
  label: string;
  object: object;
  subject?: string;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of Object.keys(input.object)) {
    if (input.allowedKeys.has(key)) continue;
    input.warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${input.subject ?? "Wearable shadow result card"} ${input.label} contains unsupported field ${key}.`,
    });
  }
}

function appendRequiredPositiveIntegerWarnings(input: {
  keys: readonly string[];
  object: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of input.keys) {
    if (isPositiveIntegerValue(input.object[key])) continue;
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} ${key} must be a positive integer.`,
    });
  }
}

function appendRequiredNonnegativeIntegerWarnings(input: {
  keys: readonly string[];
  object: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of input.keys) {
    if (isNonnegativeIntegerValue(input.object[key])) continue;
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} ${key} must be a nonnegative integer.`,
    });
  }
}

function appendOptionalNonnegativeIntegerWarning(input: {
  key: string;
  object: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  const value = input.object[input.key];
  if (value === undefined || isNonnegativeIntegerValue(value)) return;
  input.warnings.push({
    code: "INVALID_INPUT",
    message: `${input.subject} ${input.key} must be a nonnegative integer.`,
  });
}

function appendOptionalFiniteNonnegativeNumberWarning(input: {
  key: string;
  object: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  const value = input.object[input.key];
  if (value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0)) return;
  input.warnings.push({
    code: "INVALID_INPUT",
    message: `${input.subject} ${input.key} must be a finite nonnegative number.`,
  });
}

function validateWearableLabAggregateReceiptEndpoint(input: {
  endpoint: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  appendUnknownObjectKeyWarnings({
    allowedKeys: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_KEYS,
    label: "endpoint",
    object: input.endpoint,
    subject: input.subject,
    warnings: input.warnings,
  });
  const endpointFamily = readStringField({
    key: "endpointFamily",
    label: "endpoint family",
    object: input.endpoint,
    subject: input.subject,
    warnings: input.warnings,
  });
  const indexDateRule = readStringField({
    key: "indexDateRule",
    label: "index date rule",
    object: input.endpoint,
    subject: input.subject,
    warnings: input.warnings,
  });
  const outcomeAscertainment = readStringField({
    key: "outcomeAscertainment",
    label: "outcome ascertainment",
    object: input.endpoint,
    subject: input.subject,
    warnings: input.warnings,
  });
  const endpointFrozen = readBooleanField({
    key: "endpointFrozenBeforeScoring",
    label: "endpoint frozen before scoring",
    object: input.endpoint,
    subject: input.subject,
    warnings: input.warnings,
  });
  const outcomeLinked = readBooleanField({
    key: "outcomeLinked",
    label: "outcome linked",
    object: input.endpoint,
    subject: input.subject,
    warnings: input.warnings,
  });
  if (!endpointFamily || !MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_ENDPOINT_FAMILIES.has(endpointFamily)) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} endpoint family is not supported.`,
    });
  }
  if (!indexDateRule || !MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_INDEX_DATE_RULES.has(indexDateRule)) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} index date rule is not supported.`,
    });
  }
  if (
    !outcomeAscertainment
    || !MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_OUTCOME_ASCERTAINMENTS.has(outcomeAscertainment)
  ) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} outcome ascertainment is not supported.`,
    });
  }
  if (endpointFrozen !== true || outcomeLinked !== true) {
    input.warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${input.subject} endpoint must be frozen and outcome-linked before scoring.`,
    });
  }
  const horizonYears = input.endpoint.horizonYears;
  if (horizonYears !== null && !(typeof horizonYears === "number" && Number.isFinite(horizonYears) && horizonYears > 0)) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} horizonYears must be a positive finite number or null.`,
    });
  }
  if (!isNonnegativeIntegerValue(input.endpoint.washoutDays)) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} washoutDays must be a nonnegative integer.`,
    });
  }
}

function readRegisteredWearableLabAggregateReceiptSourceRouteId(
  record: Readonly<Record<string, unknown>>,
): MurphAgeSourceRouteId | null {
  if (typeof record.sourceRouteId !== "string") return null;
  const aliasedRouteId = MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SOURCE_ROUTE_ALIASES[record.sourceRouteId];
  return resolveMurphAgeSourceRoute(aliasedRouteId ?? record.sourceRouteId)?.routeId ?? null;
}

function isSupportedWearableLabAggregateReceiptSourceRouteKey(value: string): boolean {
  return isNonEmptySimpleKey(value)
    || MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SOURCE_ROUTE_ALIASES[value] !== undefined;
}

function listWearableLabAggregateReceiptSourceRouteAliases(routeId: MurphAgeSourceRouteId): string[] {
  return Object.entries(MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SOURCE_ROUTE_ALIASES)
    .filter(([, aliasedRouteId]) => aliasedRouteId === routeId)
    .map(([alias]) => alias)
    .sort();
}

function validateWearableLabAggregateReceiptNegativeControls(input: {
  negativeControls: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  appendUnknownObjectKeyWarnings({
    allowedKeys: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_NEGATIVE_CONTROL_KEYS,
    label: "negative controls",
    object: input.negativeControls,
    subject: input.subject,
    warnings: input.warnings,
  });
  for (const key of MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_NEGATIVE_CONTROL_KEYS) {
    const value = input.negativeControls[key];
    if (typeof value === "boolean" || value === null) continue;
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} negative control ${key} must be boolean or null.`,
    });
  }
}

function validateWearableLabAggregateReceiptModels(input: {
  candidate: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  const models = input.candidate.models;
  if (!Array.isArray(models)) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} models must be an array.`,
    });
    return;
  }
  const seenModelIds = new Set<MurphAgeWearableLabAggregateReceiptModelId>();
  for (const model of models) {
    if (!isPlainRecord(model)) {
      input.warnings.push({
        code: "INVALID_INPUT",
        message: `${input.subject} model entries must be objects.`,
      });
      continue;
    }
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_KEYS,
      label: "model",
      object: model,
      subject: input.subject,
      warnings: input.warnings,
    });
    const modelIdValue = readStringField({
      key: "modelId",
      label: "model id",
      object: model,
      subject: input.subject,
      warnings: input.warnings,
    });
    const modelId = parseWearableLabAggregateReceiptModelId(modelIdValue);
    if (!modelId) {
      input.warnings.push({
        code: "INVALID_INPUT",
        message: `${input.subject} model id is not supported.`,
      });
    } else if (seenModelIds.has(modelId)) {
      input.warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: `${input.subject} model id ${modelId} is duplicated.`,
      });
    } else {
      seenModelIds.add(modelId);
    }
    const calibrationStatus = readStringField({
      key: "calibrationStatus",
      label: "calibration status",
      object: model,
      subject: input.subject,
      warnings: input.warnings,
    });
    if (
      !calibrationStatus
      || !MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_CALIBRATION_STATUSES.has(calibrationStatus)
    ) {
      input.warnings.push({
        code: "INVALID_INPUT",
        message: `${input.subject} calibration status is not supported.`,
      });
    }
    const metrics = readPlainRecordField({
      key: "metrics",
      label: "metrics",
      object: model,
      subject: input.subject,
      warnings: input.warnings,
    });
    if (metrics) {
      appendUnknownObjectKeyWarnings({
        allowedKeys: MURPH_AGE_INCREMENT_EVALUATION_METRIC_KEYS,
        label: "model metrics",
        object: metrics,
        subject: input.subject,
        warnings: input.warnings,
      });
      appendIncrementEvaluationAggregateMetricValueWarnings({
        metrics,
        subject: input.subject,
        warnings: input.warnings,
      });
      if (!hasWearableLabAggregateReceiptProperScore(metrics)) {
        input.warnings.push({
          code: "MODEL_CARD_POLICY_VIOLATION",
          message: `${input.subject} model ${modelId ?? "unknown"} metrics must include a finite Brier score or log loss.`,
        });
      }
    }
  }
  for (const requiredModelId of MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_MODEL_IDS) {
    if (seenModelIds.has(requiredModelId)) continue;
    input.warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${input.subject} is missing required model ${requiredModelId}.`,
    });
  }
}

function hasWearableLabAggregateReceiptProperScore(
  metrics: Readonly<Record<string, unknown>>,
): boolean {
  return typeof metrics.brier === "number" && Number.isFinite(metrics.brier)
    || typeof metrics.logLoss === "number" && Number.isFinite(metrics.logLoss);
}

function appendAggregateMetricDeltaValueWarnings(input: {
  deltas: Readonly<Record<string, unknown>>;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of MURPH_AGE_WEARABLE_SHADOW_RESULT_DELTA_KEYS) {
    const value = input.deltas[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `Wearable shadow result card aggregate metric delta ${key} must be a finite number.`,
    });
  }
}

function appendAggregateSampleValueWarnings(input: {
  sample: Readonly<Record<string, unknown>>;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of MURPH_AGE_WEARABLE_SHADOW_RESULT_SAMPLE_KEYS) {
    const value = input.sample[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
      continue;
    }
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `Wearable shadow result card aggregate sample ${key} must be a nonnegative integer.`,
    });
  }
}

function appendIncrementEvaluationMetricDeltaValueWarnings(input: {
  deltas: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of MURPH_AGE_INCREMENT_EVALUATION_DELTA_KEYS) {
    const value = input.deltas[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} aggregate metric delta ${key} must be a finite number.`,
    });
  }
}

function appendIncrementEvaluationAggregateMetricValueWarnings(input: {
  metrics: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of MURPH_AGE_INCREMENT_EVALUATION_METRIC_KEYS) {
    const value = input.metrics[key];
    if (value === undefined) continue;
    if (value === null && MURPH_AGE_INCREMENT_EVALUATION_NULLABLE_METRIC_KEYS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} aggregate metric ${key} must be a finite number${MURPH_AGE_INCREMENT_EVALUATION_NULLABLE_METRIC_KEYS.has(key) ? " or null" : ""}.`,
    });
  }
}

function appendIncrementEvaluationAggregateSampleValueWarnings(input: {
  sample: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  for (const key of MURPH_AGE_INCREMENT_EVALUATION_SAMPLE_KEYS) {
    const value = input.sample[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
      continue;
    }
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} aggregate sample ${key} must be a nonnegative integer.`,
    });
  }
}

function isLockedWearableShadowOutputBoundary(
  boundary: Readonly<Record<string, unknown>>,
): boolean {
  return boundary.aggregateOnly === true
    && boundary.coefficientsExportAllowed === false
    && boundary.participantLevelExportAllowed === false
    && boundary.predictionsExportAllowed === false
    && boundary.productDisplayExportAllowed === false
    && boundary.rowValuesExportAllowed === false;
}

function isLockedIncrementEvaluationOutputBoundary(
  boundary: Readonly<Record<string, unknown>>,
): boolean {
  return boundary.aggregateOnly === true
    && boundary.coefficientsExportAllowed === false
    && boundary.localArtifactPathExportAllowed === false
    && boundary.modelParametersExportAllowed === false
    && boundary.participantIdentifiersExportAllowed === false
    && boundary.participantLevelExportAllowed === false
    && boundary.predictionsExportAllowed === false
    && boundary.productDisplayExportAllowed === false
    && boundary.rowValuesExportAllowed === false
    && boundary.sourceTextExportAllowed === false
    && boundary.splitMembershipExportAllowed === false;
}

function isLockedSourceRouteArtifactBoundary(
  boundary: MurphAgeSourceRouteArtifactBoundary,
): boolean {
  return boundary.aggregateOutputsOnly === true
    && boundary.localPathStorageAllowed === false
    && boundary.modelParameterExportAllowed === false
    && boundary.participantLevelExportAllowed === false
    && boundary.predictionExportAllowed === false
    && boundary.productClaimAllowed === false
    && boundary.rowMaterializationAuthorized === false
    && boundary.rowValueExportAllowed === false
    && boundary.sourceTextStorageAllowed === false;
}

function hasFiniteAggregateMetricDelta(
  deltas: Readonly<Record<string, unknown>>,
): boolean {
  return [
    deltas.aucDelta,
    deltas.brierDelta,
    deltas.calibrationInterceptDelta,
    deltas.calibrationSlopeDelta,
    deltas.cIndexDelta,
    deltas.logLossDelta,
  ].some((value) => value !== undefined && Number.isFinite(value));
}

function hasFiniteIncrementEvaluationMetricDelta(
  deltas: {
    aucDelta?: unknown;
    brierDelta?: unknown;
    calibrationInterceptDelta?: unknown;
    calibrationSlopeDelta?: unknown;
    cIndexDelta?: unknown;
    logLossDelta?: unknown;
  },
): boolean {
  return [
    deltas.aucDelta,
    deltas.brierDelta,
    deltas.calibrationInterceptDelta,
    deltas.calibrationSlopeDelta,
    deltas.cIndexDelta,
    deltas.logLossDelta,
  ].some((value) => value !== undefined && Number.isFinite(value));
}

function appendOrdinaryLabWearableAggregateEvidenceBlocker(input: {
  blockers: string[];
  message: string;
  reason: string;
  warnings: MurphAgeWarning[];
}): void {
  input.blockers.push(input.reason);
  input.warnings.push({
    code: "MODEL_CARD_POLICY_VIOLATION",
    message: input.message,
  });
}

function isPositiveIntegerValue(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isNonnegativeIntegerValue(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function validateWearableActivityBenchmarkArrayField(input: {
  allowedValues: readonly string[];
  key: string;
  object: Readonly<Record<string, unknown>>;
  subject: string;
  warnings: MurphAgeWarning[];
}): void {
  const value = input.object[input.key];
  if (!Array.isArray(value)) {
    input.warnings.push({
      code: "INVALID_INPUT",
      message: `${input.subject} ${input.key} must be an array.`,
    });
    return;
  }
  const expectedValues = [...input.allowedValues].sort();
  const actualValues = value.filter((item): item is string => typeof item === "string").sort();
  if (
    actualValues.length !== value.length
    || actualValues.length !== expectedValues.length
    || actualValues.some((item, index) => item !== expectedValues[index])
  ) {
    input.warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${input.subject} ${input.key} must match the frozen benchmark contract.`,
    });
  }
}

function validateWearableActivityBenchmarkModelLadder(
  value: unknown,
  warnings: MurphAgeWarning[],
): void {
  const subject = "Wearable activity benchmark card";
  if (!Array.isArray(value)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: `${subject} modelLadder must be an array.`,
    });
    return;
  }
  if (value.length !== MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_MODEL_LADDER.length) {
    warnings.push({
      code: "MODEL_CARD_POLICY_VIOLATION",
      message: `${subject} modelLadder must include every frozen comparator step.`,
    });
  }
  for (const [index, expected] of MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_MODEL_LADDER.entries()) {
    const step = value[index];
    if (!isPlainRecord(step)) {
      warnings.push({
        code: "INVALID_INPUT",
        message: `${subject} modelLadder step must be an object.`,
      });
      continue;
    }
    appendUnknownObjectKeyWarnings({
      allowedKeys: MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_MODEL_STEP_KEYS,
      label: "model ladder step",
      object: step,
      subject,
      warnings,
    });
    if (step.modelId !== expected.modelId || step.required !== true || step.role !== expected.role) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        message: `${subject} modelLadder step ${String(index)} must match the frozen comparator order.`,
      });
    }
  }
}

function parseWearableLabAggregateReceiptModelId(
  value: unknown,
): MurphAgeWearableLabAggregateReceiptModelId | null {
  switch (value) {
    case "m0-anchor-only":
    case "m1-anchor-plus-lab-body-bp":
    case "m2-coverage-device-ehr-density-control":
    case "m3-wearable-residual":
    case "m4-wearable-plus-coverage":
    case "m5-residualized-wearable-after-controls":
      return value;
    default:
      return null;
  }
}

function parseWearableLabAggregateReceiptCalibrationStatus(
  value: unknown,
): MurphAgeWearableLabAggregateReceiptCalibrationStatus | null {
  switch (value) {
    case "fail":
    case "not-reported":
    case "pass":
    case "warn":
      return value;
    default:
      return null;
  }
}

function readWearableLabAggregateReceiptModelMap(
  value: unknown,
): Map<MurphAgeWearableLabAggregateReceiptModelId, MurphAgeWearableLabAggregateReceiptModelResult> {
  const modelMap = new Map<MurphAgeWearableLabAggregateReceiptModelId, MurphAgeWearableLabAggregateReceiptModelResult>();
  if (!Array.isArray(value)) return modelMap;
  for (const item of value) {
    if (!isPlainRecord(item) || !isPlainRecord(item.metrics)) continue;
    const modelId = parseWearableLabAggregateReceiptModelId(item.modelId);
    const calibrationStatus = parseWearableLabAggregateReceiptCalibrationStatus(item.calibrationStatus);
    if (!modelId || !calibrationStatus) continue;
    modelMap.set(modelId, {
      calibrationStatus,
      metrics: readIncrementEvaluationAggregateMetricSummary(item.metrics),
      modelId,
    });
  }
  return modelMap;
}

function readIncrementEvaluationAggregateMetricSummary(
  metrics: Readonly<Record<string, unknown>>,
): MurphAgeIncrementEvaluationAggregateMetricSummary {
  const summary: MurphAgeIncrementEvaluationAggregateMetricSummary = {};
  const auc = readFiniteNumberOrNull(metrics.auc);
  if (auc !== null || metrics.auc === null) summary.auc = auc;
  const cIndex = readFiniteNumberOrNull(metrics.cIndex);
  if (cIndex !== null || metrics.cIndex === null) summary.cIndex = cIndex;
  if (typeof metrics.brier === "number" && Number.isFinite(metrics.brier)) summary.brier = metrics.brier;
  if (typeof metrics.calibrationIntercept === "number" && Number.isFinite(metrics.calibrationIntercept)) {
    summary.calibrationIntercept = metrics.calibrationIntercept;
  }
  if (typeof metrics.calibrationSlope === "number" && Number.isFinite(metrics.calibrationSlope)) {
    summary.calibrationSlope = metrics.calibrationSlope;
  }
  if (typeof metrics.events === "number" && Number.isFinite(metrics.events)) summary.events = metrics.events;
  if (typeof metrics.logLoss === "number" && Number.isFinite(metrics.logLoss)) summary.logLoss = metrics.logLoss;
  if (typeof metrics.meanPrediction === "number" && Number.isFinite(metrics.meanPrediction)) {
    summary.meanPrediction = metrics.meanPrediction;
  }
  if (typeof metrics.n === "number" && Number.isFinite(metrics.n)) summary.n = metrics.n;
  if (typeof metrics.observedRate === "number" && Number.isFinite(metrics.observedRate)) {
    summary.observedRate = metrics.observedRate;
  }
  return summary;
}

function readFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function calculateWearableLabAggregateReceiptMetricDeltas(
  candidate: MurphAgeIncrementEvaluationAggregateMetricSummary,
  comparator: MurphAgeIncrementEvaluationAggregateMetricSummary,
): MurphAgeWearableLabAggregateReceiptMetricDeltas {
  return {
    aucDelta: subtractFiniteMetrics(candidate.auc, comparator.auc),
    brierDelta: subtractFiniteMetrics(candidate.brier, comparator.brier),
    cIndexDelta: subtractFiniteMetrics(candidate.cIndex, comparator.cIndex),
    logLossDelta: subtractFiniteMetrics(candidate.logLoss, comparator.logLoss),
  };
}

function aggregateReceiptDeltasToIncrementDeltas(
  deltas: MurphAgeWearableLabAggregateReceiptMetricDeltas,
): MurphAgeIncrementEvaluationAggregateMetricDeltas {
  const incrementDeltas: MurphAgeIncrementEvaluationAggregateMetricDeltas = {};
  if (typeof deltas.aucDelta === "number" && Number.isFinite(deltas.aucDelta)) {
    incrementDeltas.aucDelta = deltas.aucDelta;
  }
  if (typeof deltas.brierDelta === "number" && Number.isFinite(deltas.brierDelta)) {
    incrementDeltas.brierDelta = deltas.brierDelta;
  }
  if (typeof deltas.cIndexDelta === "number" && Number.isFinite(deltas.cIndexDelta)) {
    incrementDeltas.cIndexDelta = deltas.cIndexDelta;
  }
  if (typeof deltas.logLossDelta === "number" && Number.isFinite(deltas.logLossDelta)) {
    incrementDeltas.logLossDelta = deltas.logLossDelta;
  }
  return incrementDeltas;
}

function subtractFiniteMetrics(candidate: number | null | undefined, comparator: number | null | undefined): number | null {
  return typeof candidate === "number" && Number.isFinite(candidate)
      && typeof comparator === "number" && Number.isFinite(comparator)
    ? candidate - comparator
    : null;
}

function hasReceiptProperScoreImprovement(
  deltas: MurphAgeWearableLabAggregateReceiptMetricDeltas,
): boolean {
  return (deltas.brierDelta !== null && deltas.brierDelta < 0)
    || (deltas.logLossDelta !== null && deltas.logLossDelta < 0);
}

function hasReceiptDiscriminationNonWorse(
  deltas: MurphAgeWearableLabAggregateReceiptMetricDeltas,
): boolean {
  const discriminationDeltas = [deltas.aucDelta, deltas.cIndexDelta].filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  return discriminationDeltas.length === 0 || discriminationDeltas.every((value) => value >= -0.001);
}

function wearableLabAggregateReceiptNegativeControlsPassed(
  negativeControls: Readonly<Record<string, unknown>>,
): boolean {
  return negativeControls.coverageOnlyBeatenByResidualWearable === true
    && negativeControls.deviceOrEhrDensityDominates === false
    && negativeControls.earlyEventSensitivityPassed === true
    && negativeControls.reverseCausationWashoutPassed === true;
}

function isMurphAgeIncrementEvaluationLayer(value: string): value is MurphAgeIncrementEvaluationLayer {
  return MURPH_AGE_INCREMENT_EVALUATION_LAYER_SET.has(value);
}

function isWearableShadowResultEvidenceTier(value: string): value is MurphAgeWearableShadowResultEvidenceTier {
  return MURPH_AGE_WEARABLE_SHADOW_RESULT_EVIDENCE_TIER_SET.has(value);
}

function isNonEmptySimpleKey(value: string): boolean {
  return value.trim().length > 0 && toPublicSimpleKey(value) === value;
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
  const bundleId = toContextBundleId(assessment.bundleId);
  return {
    ...assessment,
    bundleId,
    featureStatuses: assessment.featureStatuses.map((feature) => ({
      featureKey: feature.featureKey,
      label: feature.label,
      metricKeys: [...feature.metricKeys],
      requiredFor: bundleId,
      selectedMetricKey: feature.selectedMetricKey,
      selectedPointIds: [...feature.selectedPointIds],
      status: feature.status,
    })),
  };
}

function toContextBundleId(bundleId: MurphAgeInputBundleId): MurphAgeContextBundleAssessment["bundleId"] {
  if (bundleId === "function-context" || bundleId === "wearable-context") return bundleId;
  throw new TypeError(`Murph Age input bundle ${bundleId} is not a context bundle.`);
}

function listContextOnlyFeatureStatuses(output: MurphAgeCalculatorOutput): MurphAgeContextBundleFeatureStatus[] {
  const primaryContext = output.bundleAssessment.status === "context-only"
    ? toContextBundleAssessment(output.bundleAssessment).featureStatuses
    : [];
  return [...primaryContext, ...output.contextAssessments.flatMap((assessment) => assessment.featureStatuses)]
    .filter((feature) => feature.status === "ready");
}

function isWearableContextFeatureStatus(
  feature: MurphAgeContextBundleFeatureStatus,
): boolean {
  return feature.requiredFor === "wearable-context";
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
    measurementMethod: input.spec.measurementMethod,
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

function cloneMurphAgeWearableBridgeMetricSourceHint(
  hint: MurphAgeWearableBridgeMetricSourceHint,
): MurphAgeWearableBridgeMetricSourceHint {
  return {
    ...hint,
    featureKeys: [...hint.featureKeys],
    sourceKinds: [...hint.sourceKinds],
    validDaySourceKinds: [...hint.validDaySourceKinds],
    validNightSourceKinds: [...hint.validNightSourceKinds],
    validObservationRoles: [...hint.validObservationRoles],
  };
}

function cloneMurphAgeWearableResidualLayerApplication(
  application: MurphAgeWearableResidualLayerApplication,
): MurphAgeWearableResidualLayerApplication {
  return {
    ...application,
    selectedMetricKeys: [...application.selectedMetricKeys],
    warnings: application.warnings.map((warning) => ({ ...warning })),
  };
}

function cloneMurphAgeFunctionResidualLayerApplication(
  application: MurphAgeFunctionResidualLayerApplication,
): MurphAgeFunctionResidualLayerApplication {
  return {
    ...application,
    selectedMetricKeys: [...application.selectedMetricKeys],
    warnings: application.warnings.map((warning) => ({ ...warning })),
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
      ...(input.bundleAssessment.status === "context-only" ? input.bundleAssessment.selectedMetricKeys : []),
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
    if (!isMetricLikeModelFeature(feature)) continue;
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

function isScoreBearingCardId(cardId: MurphAgeModelCardId | "none"): cardId is MurphAgeScoreBearingCardId {
  return cardId !== "none" && cardId !== "function_context_no_risk" && cardId !== "wearable_context_no_risk";
}

function evaluateFeature(input: {
  blockedIdentifiers: BlockedIdentifiers;
  feature: MurphAgeModelFeature;
  input: MurphAgeCalculationInput;
}): EvaluatedFeature {
  const moduleId = input.feature.moduleId ?? "demographics";
  const required = isModelFeatureRequired(input.feature);
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
    case "chronological-age-squared":
      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey: null,
          value: input.input.chronologicalAgeYears,
          valueLabel: input.input.chronologicalAgeYears.toFixed(1),
        },
        feature: input.feature,
        moduleId,
        rawValue: input.input.chronologicalAgeYears ** 2,
        required,
      });
    case "age-sex-interaction": {
      const sexValue = input.input.sex === input.feature.sex ? 1 : 0;
      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey: null,
          value: sexValue,
          valueLabel: `${input.input.chronologicalAgeYears.toFixed(1)} x ${input.input.sex}`,
        },
        feature: input.feature,
        moduleId,
        rawValue: input.input.chronologicalAgeYears * sexValue,
        required,
      });
    }
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
    case "metric-missingness":
      return evaluateMetricMissingnessFeature({
        baseAttribution,
        blockedIdentifiers: input.blockedIdentifiers,
        feature: input.feature,
        input: input.input,
        moduleId,
        required,
      });
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
        const imputed = evaluateImputedMetricFeature({
          baseAttribution,
          feature: input.feature,
          metricKey,
          moduleId,
          reason: `${input.feature.label} was imputed because its unit was not normalized for this model.`,
          selection,
          selectionWarnings,
        });
        if (imputed) return imputed;
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
        const imputed = evaluateImputedMetricFeature({
          baseAttribution,
          feature: input.feature,
          metricKey,
          moduleId,
          reason: required
            ? `${input.feature.label} is required by this model but was not available as a ready normalized metric.`
            : `${input.feature.label} is optional in this model and was not available as a ready normalized metric.`,
          selection,
          selectionWarnings,
        });
        if (imputed) return imputed;
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
        const imputed = evaluateImputedMetricFeature({
          baseAttribution,
          feature: input.feature,
          metricKey,
          moduleId,
          reason: `${input.feature.label} was imputed because its selected value is censored by a comparator.`,
          selection,
          selectionWarnings,
        });
        if (imputed) return imputed;
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
        const imputed = evaluateImputedMetricFeature({
          baseAttribution,
          feature: input.feature,
          metricKey,
          moduleId,
          reason: `${input.feature.label} was imputed because its selected unit was not ${normalizeUnit(expectedUnit) ?? expectedUnit}.`,
          selection,
          selectionWarnings,
        });
        if (imputed) return imputed;
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

function isModelFeatureRequired(feature: MurphAgeModelFeature): boolean {
  return feature.kind === "metric" ? feature.required !== false : true;
}

function evaluateMetricMissingnessFeature(input: {
  baseAttribution: Omit<MurphAgeFeatureAttribution, "metricKey" | "status">;
  blockedIdentifiers: BlockedIdentifiers;
  feature: MurphAgeModelFeature & { kind: "metric-missingness" };
  input: MurphAgeCalculationInput;
  moduleId: string;
  required: boolean;
}): EvaluatedFeature {
  const metricKey = resolveMetricInputKey(input.feature.metricKey);
  if (isBlockedMetricFeature({
    biomarkerKey: input.feature.biomarkerKey ?? null,
    blockedIdentifiers: input.blockedIdentifiers,
    metricKey,
  })) {
    return {
      attribution: {
        ...input.baseAttribution,
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
      required: input.required,
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
  const usableSelection = selection.status === "ready"
    && selection.value !== null
    && Number.isFinite(selection.value)
    && !selection.warnings.some((warning) => warning.code === "COMPARATOR_VALUE")
    && !selection.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED");
  const missingnessValue = usableSelection ? 0 : 1;
  return evaluateRawFeature({
    attribution: {
      ...input.baseAttribution,
      metricKey,
      selectedPointIds: usableSelection ? selection.provenance.pointIds : [],
      unit: "binary",
      value: missingnessValue,
      valueLabel: missingnessValue === 1 ? "missing" : "available",
      warnings: selectionWarnings,
    },
    confidence: usableSelection ? selection.confidence : null,
    feature: input.feature,
    moduleId: input.moduleId,
    rawValue: missingnessValue,
    required: input.required,
  });
}

function evaluateImputedMetricFeature(input: {
  baseAttribution: Omit<MurphAgeFeatureAttribution, "metricKey" | "status">;
  feature: MurphAgeModelFeature & { kind: "metric" };
  metricKey: string;
  moduleId: string;
  reason: string;
  selection: MetricSelection;
  selectionWarnings: MurphAgeWarning[];
}): EvaluatedFeature | null {
  if (input.feature.missingValue === undefined) return null;
  return evaluateRawFeature({
    attribution: {
      ...input.baseAttribution,
      metricKey: input.metricKey,
      unit: input.selection.unit,
      value: null,
      valueLabel: "imputed",
      warnings: [{
        code: "MODEL_FEATURE_MISSING",
        featureKey: input.feature.key,
        message: input.reason,
        metricKey: input.metricKey,
      }, ...input.selectionWarnings],
    },
    confidence: null,
    feature: input.feature,
    moduleId: input.moduleId,
    rawValue: input.feature.missingValue,
    required: false,
    status: "imputed",
  });
}

function evaluateRawFeature(input: {
  attribution: Omit<MurphAgeFeatureAttribution, "status">;
  confidence?: MetricConfidence | null;
  feature: MurphAgeModelFeature;
  moduleId: string;
  rawValue: number;
  required: boolean;
  status?: "imputed" | "ready";
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
      status: input.status ?? "ready",
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
  const attributionAgeYears = mapRiskToReferenceAgeForAttribution(
    logistic(input.calibratedLogit),
    input.model.referenceRiskCurve,
  );
  return input.features.map((feature) => {
    if (!isScoreContributingEvaluatedFeature(feature)) {
      return feature.attribution;
    }
    const omittedLogit = input.calibratedLogit - calibratedContribution(feature.contributionLogit, input.model.calibration);
    const omittedAge = mapRiskToReferenceAgeForAttribution(logistic(omittedLogit), input.model.referenceRiskCurve);
    return {
      ...feature.attribution,
      contributionYears: roundYears(attributionAgeYears - omittedAge),
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

  const attributionAgeYears = mapRiskToReferenceAgeForAttribution(
    logistic(input.calibratedLogit),
    input.model.referenceRiskCurve,
  );
  return [...modules.entries()].map(([moduleId, module]) => {
    const omittedLogit = input.calibratedLogit - calibratedContribution(module.contributionLogit, input.model.calibration);
    const omittedAge = mapRiskToReferenceAgeForAttribution(logistic(omittedLogit), input.model.referenceRiskCurve);
    return {
      contributionLogit: roundContribution(module.contributionLogit),
      contributionYears: roundYears(attributionAgeYears - omittedAge),
      featureKeys: module.featureKeys,
      moduleId,
    };
  });
}

function isScoreContributingEvaluatedFeature(feature: EvaluatedFeature): boolean {
  return feature.attribution.status === "ready" || feature.attribution.status === "imputed";
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
    if (feature.kind === "metric" && feature.missingValue !== undefined && !Number.isFinite(feature.missingValue)) {
      warnings.push(invalidModelWarning(`${feature.label} missing value must be finite.`, feature));
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
    if (!isMetricLikeModelFeature(feature)) continue;
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

function modelFeatureMetricKey(feature: MurphAgeModelFeature): string | null {
  return isMetricLikeModelFeature(feature)
    ? resolveMetricInputKey(feature.metricKey)
    : null;
}

function isMetricLikeModelFeature(
  feature: MurphAgeModelFeature,
): feature is MurphAgeModelFeature & { kind: "metric" | "metric-missingness" } {
  return feature.kind === "metric" || feature.kind === "metric-missingness";
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
    case "chronological-age-squared":
      return parseChronologicalAgeSquaredFeature(feature);
    case "age-sex-interaction":
      return parseAgeSexInteractionFeature(feature);
    case "sex":
      return parseSexFeature(feature);
    case "metric":
      return parseMetricFeature(feature);
    case "metric-missingness":
      return parseMetricMissingnessFeature(feature);
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

function parseChronologicalAgeSquaredFeature(feature: Record<string, unknown>): MurphAgeModelFeature | null {
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
  return { ...base, kind: "chronological-age-squared" };
}

function parseAgeSexInteractionFeature(feature: Record<string, unknown>): MurphAgeModelFeature | null {
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
  return { ...base, kind: "age-sex-interaction", sex };
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
    "missingValue",
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
  const missingValue = parseOptionalFiniteNumber(feature.missingValue);
  const required = parseOptionalBoolean(feature.required);
  const selectionPolicy = parseOptionalMetricSelectionPolicy(feature.selectionPolicy);
  if (
    !base ||
    metricKey === null ||
    biomarkerKey === null ||
    expectedUnit === null ||
    missingValue === null ||
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
  if (missingValue !== undefined) parsed.missingValue = missingValue;
  if (required !== undefined) parsed.required = required;
  if (selectionPolicy !== undefined) parsed.selectionPolicy = selectionPolicy;
  return parsed;
}

function parseMetricMissingnessFeature(feature: Record<string, unknown>): MurphAgeModelFeature | null {
  if (!recordHasOnlyKeys(feature, [
    "biomarkerKey",
    "coefficient",
    "key",
    "kind",
    "label",
    "metricKey",
    "moduleId",
    "selectionPolicy",
    "transform",
  ])) {
    return null;
  }
  const base = parseFeatureBase(feature);
  const metricKey = parseNonEmptyString(feature.metricKey);
  const biomarkerKey = parseOptionalNonEmptyString(feature.biomarkerKey);
  const selectionPolicy = parseOptionalMetricSelectionPolicy(feature.selectionPolicy);
  if (!base || metricKey === null || biomarkerKey === null || selectionPolicy === null) {
    return null;
  }

  const parsed: MurphAgeModelFeature & { kind: "metric-missingness" } = {
    ...base,
    kind: "metric-missingness",
    metricKey,
  };
  if (biomarkerKey !== undefined) parsed.biomarkerKey = biomarkerKey;
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
    metricKey: feature?.kind === "metric" || feature?.kind === "metric-missingness"
      ? resolveMetricInputKey(feature.metricKey)
      : undefined,
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
  feature: MurphAgeModelFeature & { kind: "metric" | "metric-missingness" },
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

function logitFromProbability(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0 || value >= 1) return null;
  return Math.log(value / (1 - value));
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
