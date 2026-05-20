import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { isoTimestampSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  assessMurphAgeInputReadinessFromVault,
  assessMurphAgeWearableShadowReadinessFromVault,
  calculateMurphAgePublicReportFromVaultInputBundle,
  getMurphAgeResearchPreviewForSubmittedInputs,
  loadMurphAgeLocalModelCardArtifacts,
} from '@murphai/query'
import {
  assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard,
  buildMurphAgePublicCalculatorView,
  buildMurphAgeResearchCalculatorView,
  calculateMurphAgePublicReportFromSubmittedInputs,
  isMurphAgePublicFeatureKey,
  isMurphAgePublicMetricKey,
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates,
  listMurphAgeOrdinaryLabWearableSourceRoutes,
  listMurphAgeModelCardPolicies,
  listMurphAgeModelCardProductPromotionBlockers,
  MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT,
  MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
} from '@murphai/health-metrics'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
  loadTextInput,
} from '@murphai/vault-usecases'
import { assertInitializedVaultRoot } from './vault-root-validation.js'

const murphAgeModeSchema = z.enum(['product', 'research'])
const murphAgeSexSchema = z.enum(['female', 'male'])
const murphAgeInputBundleStatusSchema = z.enum(['abstain', 'context-only', 'ready'])
const murphAgeStatusSchema = z.enum(['abstain', 'ready'])
const murphAgeEvidenceClassSchema = z.enum([
  'abstained',
  'context-only',
  'custom-model-unreviewed',
  'product-authorized',
  'research-internal',
  'research-transport',
])
const murphAgeModelCardIdSchema = z.enum([
  'function_context_no_risk',
  'lab5_bp_bmi_transport_research',
  'lab9_bp_body_10y_acm_research',
  'r399_nhis_proxy_10y_acm_research',
  'wearable_context_no_risk',
])
const murphAgeScoreBearingModelCardIdSchema = z.enum([
  'lab5_bp_bmi_transport_research',
  'lab9_bp_body_10y_acm_research',
  'r399_nhis_proxy_10y_acm_research',
])
const murphAgeRecommendedModelCardIdSchema = z.union([
  murphAgeModelCardIdSchema,
  z.literal('none'),
])
const murphAgeWarningCodeSchema = z.enum([
  'BLOCKED_MODEL_FEATURE',
  'CONTEXT_NOT_SCORE_BEARING',
  'INVALID_INPUT',
  'METRIC_SELECTION_WARNING',
  'MODEL_CARD_NOT_AUTHORIZED',
  'MODEL_CARD_POLICY_VIOLATION',
  'MODEL_FEATURE_MISSING',
  'OUT_OF_REFERENCE_RANGE',
  'TRANSFORM_UNSUPPORTED',
])

const murphAgePublicFeatureKeySchema = z.string().min(1).refine(
  isMurphAgePublicFeatureKey,
  'Expected a public Murph Age feature key.',
)
const murphAgePublicMetricKeySchema = z.string().min(1).refine(
  isMurphAgePublicMetricKey,
  'Expected a public Murph Age metric key.',
)
const murphAgePublicWarningSchema = z.object({
  code: murphAgeWarningCodeSchema,
  featureKey: murphAgePublicFeatureKeySchema.optional(),
  metricKey: murphAgePublicMetricKeySchema.optional(),
})

const murphAgeValidationEvidenceTierSchema = z.enum([
  'internal-anchor',
  'murph-native-prospective-validation',
  'partner-aggregate-validation',
  'same-family-sanity',
  'true-external-validation',
])
const murphAgeValidationGateStatusSchema = z.enum(['blocked', 'passed'])
const murphAgeModelCardBlockerSchema = z.enum([
  'MODEL_CARD_NOT_LOADED',
  'NOT_SCORE_BEARING',
  'PRODUCT_NOT_AUTHORIZED',
  'RISK_TO_AGE_NOT_AUTHORIZED',
  'WEARABLE_NOT_SCORE_BEARING',
])
const murphAgeProductPromotionBlockerSchema = z.enum([
  'PRODUCT_POLICY_NOT_AUTHORIZED',
  'PRODUCT_PROMOTION_EVIDENCE_MISSING',
  'PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING',
  'RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED',
  'VALIDATION_GATE_BLOCKED',
])

const murphAgeValidationGateSummarySchema = z.object({
  evidenceTiers: z.array(murphAgeValidationEvidenceTierSchema),
  productPromotionEvidence: z.boolean(),
  status: murphAgeValidationGateStatusSchema,
})
const murphAgePublicValidationGateSummarySchema = murphAgeValidationGateSummarySchema.extend({
  summary: z.enum([
    MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT.blocked,
    MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT.passed,
  ]),
}).superRefine((summary, ctx) => {
  if (summary.summary !== MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT[summary.status]) {
    ctx.addIssue({
      code: 'custom',
      message: 'Validation gate summary must match the public status text.',
      path: ['summary'],
    })
  }
})

const murphAgeOutcomeContextSchema = z.object({
  ageEstimateBasis: z.enum(['none', 'risk-age-equivalent']),
  horizonYears: z.number().nullable(),
  riskEndpoint: z.enum(['all-cause-mortality', 'none']),
})

const murphAgeModelCardStatusPolicySchema = z.object({
  acceptedBundleIds: z.array(z.string().min(1)),
  blockers: z.array(murphAgeModelCardBlockerSchema),
  cardId: murphAgeModelCardIdSchema,
  evidenceClass: murphAgeEvidenceClassSchema,
  loaded: z.boolean(),
  outcomeContext: murphAgeOutcomeContextSchema,
  productAgeReady: z.boolean(),
  productPromotionBlockers: z.array(murphAgeProductPromotionBlockerSchema),
  productRiskReady: z.boolean(),
  researchUsable: z.boolean(),
  scoreBearing: z.boolean(),
  scoreBearingMetricKeys: z.array(z.string().min(1)),
  scoreBearingSourceKinds: z.array(z.string().min(1)),
  validationGate: murphAgeValidationGateSummarySchema,
  wearableScoreBearingAuthorized: z.boolean(),
})

export const murphAgeModelCardStatusResultSchema = z.object({
  loadedCardIds: z.array(murphAgeModelCardIdSchema),
  policies: z.array(murphAgeModelCardStatusPolicySchema),
  productReadyCardIds: z.array(murphAgeModelCardIdSchema),
  researchReadyCardIds: z.array(murphAgeModelCardIdSchema),
  schemaVersion: z.literal('murph.age.model-card-status.v2'),
  warnings: z.array(z.object({
    code: murphAgeWarningCodeSchema,
  })),
})

const murphAgeInputBundleIdSchema = z.enum([
  'function-context',
  'insufficient',
  'lab5-bp-bmi',
  'lab9-bp-body',
  'r399-nhis-proxy-anchor',
  'wearable-context',
])
const murphAgeInputFeatureReadinessSchema = z.object({
  featureKey: z.string().min(1),
  label: z.string().min(1),
  metricKeys: z.array(z.string().min(1)),
  requiredFor: z.enum([
    'function-context',
    'lab5-fallback',
    'lab9-mainline',
    'optional-context',
    'r399-proxy-anchor',
    'wearable-context',
  ]),
  selectedMetricKey: z.string().min(1).nullable(),
  status: z.enum(['missing', 'ready']),
})
const murphAgeInputBundleReadinessSchema = z.object({
  availableFeatureKeys: z.array(z.string().min(1)),
  bundleId: murphAgeInputBundleIdSchema,
  featureStatuses: z.array(murphAgeInputFeatureReadinessSchema),
  missingFeatureKeys: z.array(z.string().min(1)),
  recommendedCardId: murphAgeRecommendedModelCardIdSchema,
  schemaVersion: z.literal('murph.age.input-bundle.v1'),
  selectedMetricKeys: z.array(z.string().min(1)),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
})
const murphAgePublicInputFeatureReadinessSchema = murphAgeInputFeatureReadinessSchema.omit({
  label: true,
  metricKeys: true,
  selectedMetricKey: true,
}).extend({
  featureKey: murphAgePublicFeatureKeySchema,
  metricKeys: z.array(murphAgePublicMetricKeySchema),
  selectedMetricKey: murphAgePublicMetricKeySchema.nullable(),
})
const murphAgePublicInputBundleReadinessSchema = z.object({
  availableFeatureKeys: z.array(murphAgePublicFeatureKeySchema),
  bundleId: murphAgeInputBundleIdSchema,
  featureStatuses: z.array(murphAgePublicInputFeatureReadinessSchema),
  missingFeatureKeys: z.array(murphAgePublicFeatureKeySchema),
  recommendedCardId: murphAgeRecommendedModelCardIdSchema,
  schemaVersion: z.literal('murph.age.input-bundle.v1'),
  selectedMetricKeys: z.array(murphAgePublicMetricKeySchema),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
})
const murphAgePublicInputReadinessSummarySchema = z.object({
  bundle: murphAgePublicInputBundleReadinessSchema,
  contextBundles: z.array(murphAgePublicInputBundleReadinessSchema),
})
const murphAgeResearchCandidateCardBlockerSchema = z.enum([
  'INPUT_BUNDLE_INCOMPLETE',
  'LOCAL_MODEL_CARD_NOT_LOADED',
  'PRODUCT_MODE_RESEARCH_ONLY',
  'PROXY_FALLBACK_SUPPRESSED_BY_LAB_INTENT',
])
const murphAgePublicResearchCandidateCardAssessmentSchema = z.object({
  availableFeatureKeys: z.array(murphAgePublicFeatureKeySchema),
  blockerCodes: z.array(murphAgeResearchCandidateCardBlockerSchema),
  bundleId: murphAgeInputBundleIdSchema,
  cardId: murphAgeScoreBearingModelCardIdSchema,
  inputStatus: murphAgeInputBundleStatusSchema,
  missingFeatureKeys: z.array(murphAgePublicFeatureKeySchema),
  modelLoaded: z.boolean(),
  selected: z.boolean(),
  selectedMetricKeys: z.array(murphAgePublicMetricKeySchema),
  warnings: z.array(murphAgePublicWarningSchema),
})
const murphAgeResearchCardRoleSchema = z.enum([
  'outcome-risk-anchor-and-fallback',
  'primary-lab-bp-body-adjuster',
  'transport-fallback-and-discordance-guard',
])
const murphAgeResearchArbiterCandidateCardViewSchema =
  murphAgePublicResearchCandidateCardAssessmentSchema.extend({
    readyForResearchRun: z.boolean(),
    role: murphAgeResearchCardRoleSchema,
  })
const murphAgeResearchArbiterViewSchema = z.object({
  candidateCards: z.array(murphAgeResearchArbiterCandidateCardViewSchema),
  labConflictPolicy: z.literal('lab9-primary-lab5-transport-guard-r399-anchor-fallback'),
  selectedCardRole: murphAgeResearchCardRoleSchema.nullable(),
  selectionReason: z.enum([
    'anchor-selected',
    'no-score-bearing-card-selected',
    'primary-lab-card-selected',
    'transport-fallback-selected',
  ]),
  strategy: z.literal('r399-anchor-lab9-primary-lab5-transport-wearables-context'),
  wearableScorePolicy: z.literal('context-only-not-score-bearing'),
})
const murphAgeInputScoreReadinessStatusSchema = z.enum([
  'context-only',
  'input-incomplete',
  'product-age-policy-ready',
  'product-risk-policy-ready',
  'research-ready-product-blocked',
])
const murphAgeInputProductBlockedReasonSchema = z.union([
  z.enum([
    'CONTEXT_ONLY_NOT_SCORE_BEARING',
    'INPUT_BUNDLE_INCOMPLETE',
  ]),
  murphAgeProductPromotionBlockerSchema,
])
const murphAgeInputScoreReadinessSchema = z.object({
  bundleId: murphAgeInputBundleIdSchema,
  contextOnly: z.boolean(),
  inputReady: z.boolean(),
  productAgePolicyReady: z.boolean(),
  productBlockedReasons: z.array(murphAgeInputProductBlockedReasonSchema),
  productPromotionBlockers: z.array(murphAgeProductPromotionBlockerSchema),
  productRiskPolicyReady: z.boolean(),
  recommendedCardId: murphAgeRecommendedModelCardIdSchema,
  researchModelCardRequired: z.boolean(),
  researchReadiness: z.enum([
    'context-only',
    'input-incomplete',
    'ready-if-local-model-card-loaded',
  ]),
  researchUsableIfModelLoaded: z.boolean(),
  scoreBearingInput: z.boolean(),
  status: murphAgeInputScoreReadinessStatusSchema,
})
const murphAgeRuntimeInputReadinessSchema = z.object({
  key: z.enum(['chronological-age-years', 'sex']),
  label: z.string().min(1),
  required: z.literal(true),
  source: z.literal('runtime-option'),
  status: z.literal('required'),
})

const murphAgePublicAuthorizationSchema = z.object({
  cardId: murphAgeModelCardIdSchema.nullable(),
  contextOnlyMetricKeys: z.array(z.string().min(1)),
  evidenceClass: murphAgeEvidenceClassSchema,
  productAuthorized: z.boolean(),
  riskToAgeDisplayAuthorized: z.boolean(),
  scoreBearing: z.boolean(),
  scoreBearingMetricKeys: z.array(z.string().min(1)),
  scoreBearingSourceKinds: z.array(z.string().min(1)),
  wearableScoreBearingAuthorized: z.boolean(),
})

const murphAgePublicRiskEstimateSchema = z.object({
  horizonYears: z.number(),
  probability: z.number(),
})

const murphAgePublicFeatureAttributionSchema = z.object({
  contributionYears: z.number().nullable(),
  featureKey: z.string().min(1),
  metricKey: z.string().min(1).nullable(),
  moduleId: z.string().min(1),
  status: z.enum(['blocked', 'imputed', 'missing', 'ready']),
  warnings: z.array(murphAgePublicWarningSchema),
})

const murphAgePublicModuleAttributionSchema = z.object({
  contributionYears: z.number().nullable(),
  featureKeys: z.array(z.string().min(1)),
  moduleId: z.string().min(1),
})

const murphAgePublicResultSchema = z.object({
  ageDeltaYears: z.number().nullable(),
  authorization: murphAgePublicAuthorizationSchema,
  biologicalAgeYears: z.number().nullable(),
  chronologicalAgeYears: z.number(),
  featureAttributions: z.array(murphAgePublicFeatureAttributionSchema),
  intervalYears: z.object({
    high: z.number(),
    low: z.number(),
  }).nullable(),
  moduleAttributions: z.array(murphAgePublicModuleAttributionSchema),
  risk: murphAgePublicRiskEstimateSchema.nullable(),
  status: murphAgeStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
})

const murphAgeWearableContextQualitySchema = z.enum([
  'none',
  'strong-context',
  'thin',
  'usable-context',
])

const murphAgePublicWearableContextSummarySchema = z.object({
  availableFeatureFamilies: z.array(z.enum(['activity', 'quality', 'recovery', 'sleep'])),
  availableQualityFeatureKeys: z.array(z.string().min(1)),
  missingQualityFeatureKeys: z.array(z.string().min(1)),
  quality: murphAgeWearableContextQualitySchema,
  readyFeatureCount: z.number().int().nonnegative(),
  readyMetricCount: z.number().int().nonnegative(),
  readyPointCount: z.number().int().nonnegative(),
  riskEffect: z.literal('not-estimated'),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  uncertaintyAction: z.enum(['context-only', 'none']),
})

const murphAgePublicWearableBridgeFeatureReadinessSchema = z.object({
  family: z.enum(['activity', 'hrv', 'quality', 'resting-heart-rate', 'sleep']),
  featureKey: z.string().min(1),
  methodQualifier: z.enum(['not-required', 'recommended', 'required']),
  metricKeys: z.array(z.string().min(1)),
  missingMetricKeys: z.array(z.string().min(1)),
  missingQualityMetricKeys: z.array(z.string().min(1)),
  productAuthorized: z.literal(false),
  qualityReady: z.boolean(),
  readyMetricKeys: z.array(z.string().min(1)),
  requiredQualityMetricKeys: z.array(z.string().min(1)),
  riskEffect: z.literal('not-estimated'),
  role: z.enum(['deferred-context', 'quality', 'shadow-increment-signal']),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  status: z.enum(['missing', 'partial', 'ready']),
  uncertaintyAction: z.enum(['context-only', 'none']),
  unlockPriority: z.enum(['defer', 'first', 'second']),
})

const murphAgePublicWearableBridgeSummarySchema = z.object({
  candidateFeatureCount: z.number().int().nonnegative(),
  deferredFeatureKeys: z.array(z.string().min(1)),
  features: z.array(murphAgePublicWearableBridgeFeatureReadinessSchema),
  firstPriorityIncompleteFeatureKeys: z.array(z.string().min(1)),
  firstPriorityReadyFeatureKeys: z.array(z.string().min(1)),
  missingFeatureKeys: z.array(z.string().min(1)),
  partialFeatureKeys: z.array(z.string().min(1)),
  productAuthorized: z.literal(false),
  readyFeatureKeys: z.array(z.string().min(1)),
  riskEffect: z.literal('not-estimated'),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  secondPriorityIncompleteFeatureKeys: z.array(z.string().min(1)),
  secondPriorityReadyFeatureKeys: z.array(z.string().min(1)),
})
const murphAgeWearableScoreBearingFamilyPolicySchema = z.object({
  currentUse: z.enum(['context-only', 'quality-gate-only', 'shadow-residual-research']),
  family: z.enum(['activity', 'hrv', 'quality', 'resting-heart-rate', 'sleep']),
  minimumValidDays28d: z.number().int().nonnegative().nullable(),
  minimumValidNights28d: z.number().int().nonnegative().nullable(),
  productAuthorized: z.literal(false),
  productMultiplier: z.literal(0),
  qualityMetricKeys: z.array(z.string().min(1)),
  requiresDeviceOrMethodQualification: z.boolean(),
  researchMultiplier: z.union([z.literal(0), z.literal(1)]),
  scoreBearingPromotionPriority: z.enum(['defer', 'first', 'second', 'third']),
  scoreContributionAuthorized: z.literal(false),
  signalMetricKeys: z.array(z.string().min(1)),
})
const murphAgeWearableScoreBearingStrategySchema = z.object({
  aggregateReceiptOnlyAuthorizesScienceReview: z.literal(true),
  deployableParameterizationRequiredForProductScoring: z.literal(true),
  familyPolicies: z.array(murphAgeWearableScoreBearingFamilyPolicySchema),
  modelForm: z.literal('penalized-additive-residual-bounded-and-shrunk'),
  primaryDecisionComparisons: z.array(z.enum([
    'm5-vs-m1-lab-body',
    'm5-vs-m2-coverage-control',
  ])),
  productStatus: z.literal('context-only'),
  productWearableMultiplier: z.literal(0),
  requiredPromotionSignals: z.array(z.enum([
    'deployable-parameterization-authorized',
    'm5-beats-m1-proper-score',
    'm5-beats-m2-coverage-control',
    'm5-calibration-passes',
    'negative-controls-pass',
    'replicates-in-two-source-families',
    'reverse-causation-washout-passes',
  ])),
  researchResidualMode: z.literal('locked-evaluator-only'),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION),
})

const murphAgeWearableShadowFamilySchema = z.enum([
  'activity',
  'hrv',
  'resting-heart-rate',
  'sleep',
])

const murphAgeWearableShadowOutputBoundarySchema = z.object({
  aggregateOnly: z.literal(true),
  coefficientsExportAllowed: z.literal(false),
  participantLevelExportAllowed: z.literal(false),
  predictionsExportAllowed: z.literal(false),
  productDisplayExportAllowed: z.literal(false),
  rowValuesExportAllowed: z.literal(false),
})

const murphAgeWearableShadowIncrementReadinessSchema = z.object({
  anchorCardId: murphAgeModelCardIdSchema.nullable(),
  anchorCompatible: z.boolean(),
  availableMetricKeys: z.array(z.string().min(1)),
  compatibleAnchorCardIds: z.array(murphAgeModelCardIdSchema),
  family: murphAgeWearableShadowFamilySchema,
  missingMetricKeys: z.array(z.string().min(1)),
  missingQualityMetricKeys: z.array(z.string().min(1)),
  outputBoundary: murphAgeWearableShadowOutputBoundarySchema,
  productAuthorized: z.literal(false),
  readySignalMetricKeys: z.array(z.string().min(1)),
  riskEffect: z.literal('not-estimated'),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  selectedMetricKeys: z.array(z.string().min(1)),
  status: z.enum(['blocked', 'missing', 'ready']),
  warnings: z.array(murphAgePublicWarningSchema),
})

const murphAgeWearableShadowReadinessSchema = z.object({
  anchor: z.object({
    anchorCardId: murphAgeModelCardIdSchema.nullable(),
    bundleId: murphAgeInputBundleIdSchema,
    recommendedCardId: murphAgeRecommendedModelCardIdSchema,
    status: murphAgeInputBundleStatusSchema,
  }),
  assessments: z.array(murphAgeWearableShadowIncrementReadinessSchema),
  blockedFamilies: z.array(murphAgeWearableShadowFamilySchema),
  missingFamilies: z.array(murphAgeWearableShadowFamilySchema),
  readyFamilies: z.array(murphAgeWearableShadowFamilySchema),
  schemaVersion: z.literal('murph.age.wearable-shadow-readiness.v1'),
  warnings: z.array(murphAgePublicWarningSchema),
})

export const murphAgeInputReadinessResultSchema = z.object({
  bundle: murphAgeInputBundleReadinessSchema,
  contextBundles: z.array(murphAgeInputBundleReadinessSchema),
  runtimeInputs: z.array(murphAgeRuntimeInputReadinessSchema),
  schemaVersion: z.literal('murph.age.input-readiness.v5'),
  scoreReadiness: murphAgeInputScoreReadinessSchema,
  wearableBridge: murphAgePublicWearableBridgeSummarySchema,
  wearableShadow: murphAgeWearableShadowReadinessSchema,
})

const murphAgeDisplayBlockedReasonSchema = z.enum([
  'age-estimate-unavailable',
  'context-only',
  'policy-violation',
  'product-not-authorized',
  'risk-estimate-unavailable',
  'risk-to-age-not-authorized',
])
const murphAgeDisplayStatusSchema = z.enum([
  'abstain',
  'context-only',
  'product-age-ready',
  'product-risk-only',
  'research-only',
])
const murphAgePublicDisplaySummarySchema = z.object({
  ageEstimateAvailable: z.boolean(),
  blockedFeatureKeys: z.array(z.string().min(1)),
  contextOnlyFeatureKeys: z.array(z.string().min(1)),
  contextOnlyMetricKeys: z.array(z.string().min(1)),
  displayBlockedReason: murphAgeDisplayBlockedReasonSchema.nullable(),
  displayStatus: murphAgeDisplayStatusSchema,
  missingFeatureKeys: z.array(z.string().min(1)),
  outcomeContext: murphAgeOutcomeContextSchema,
  productAgeDisplayReady: z.boolean(),
  productPromotionBlockers: z.array(murphAgeProductPromotionBlockerSchema),
  productRiskDisplayReady: z.boolean(),
  researchEstimateAvailable: z.boolean(),
  schemaVersion: z.literal('murph.age.public-display-summary.v4'),
  selectedScoreBearingFeatureKeys: z.array(z.string().min(1)),
  selectedScoreBearingMetricKeys: z.array(z.string().min(1)),
  validationGate: murphAgePublicValidationGateSummarySchema.nullable(),
  wearableBridge: murphAgePublicWearableBridgeSummarySchema,
  wearableContext: murphAgePublicWearableContextSummarySchema,
})

export const murphAgeReportResultSchema = z.object({
  authorization: murphAgePublicAuthorizationSchema,
  displaySummary: murphAgePublicDisplaySummarySchema,
  inputReadiness: murphAgePublicInputReadinessSummarySchema,
  mode: murphAgeModeSchema,
  researchCandidateCards: z.array(murphAgePublicResearchCandidateCardAssessmentSchema),
  result: murphAgePublicResultSchema.nullable(),
  schemaVersion: z.literal('murph.age.public-calculator-report.v4'),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
})

const murphAgePublicAgeEstimateViewSchema = z.object({
  ageDeltaYears: z.number().nullable(),
  biologicalAgeYears: z.number().nullable(),
  chronologicalAgeYears: z.number(),
  intervalYears: z.object({
    high: z.number(),
    low: z.number(),
  }).nullable(),
})
const murphAgePublicRiskViewSchema = z.object({
  ageEstimateBasis: z.enum(['none', 'risk-age-equivalent']),
  horizonYears: z.number().nullable(),
  probability: z.number().nullable(),
  riskEndpoint: z.enum(['all-cause-mortality', 'none']),
})
const murphAgePublicFeatureContributionViewSchema = z.object({
  contributionYears: z.number().nullable(),
  featureKey: z.string().min(1),
  metricKey: z.string().min(1).nullable(),
  moduleId: z.string().min(1),
  status: z.enum(['blocked', 'imputed', 'missing', 'ready']),
  warnings: z.array(murphAgePublicWarningSchema),
})
const murphAgePublicDomainContributionViewSchema = z.object({
  contributionYears: z.number().nullable(),
  featureKeys: z.array(z.string().min(1)),
  moduleId: z.string().min(1),
})
const murphAgePublicWearableCalculatorViewSchema = z.object({
  candidateFeatureCount: z.number().int().nonnegative(),
  contextOnlyMetricKeys: z.array(z.string().min(1)),
  deferredFeatureKeys: z.array(z.string().min(1)),
  features: z.array(murphAgePublicWearableBridgeFeatureReadinessSchema),
  firstPriorityIncompleteFeatureKeys: z.array(z.string().min(1)),
  firstPriorityReadyFeatureKeys: z.array(z.string().min(1)),
  missingFeatureKeys: z.array(z.string().min(1)),
  partialFeatureKeys: z.array(z.string().min(1)),
  quality: murphAgeWearableContextQualitySchema,
  readyFeatureKeys: z.array(z.string().min(1)),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  scorePolicy: murphAgeWearableScoreBearingStrategySchema,
  secondPriorityIncompleteFeatureKeys: z.array(z.string().min(1)),
  secondPriorityReadyFeatureKeys: z.array(z.string().min(1)),
})
const murphAgePublicCalculatorViewDisplayCategorySchema = z.enum([
  'abstain',
  'context-only',
  'product-age-ready',
  'product-risk-only',
  'research-preview',
])
export const murphAgePublicCalculatorViewResultSchema = z.object({
  ageEstimate: murphAgePublicAgeEstimateViewSchema.nullable(),
  blockedFeatureKeys: z.array(z.string().min(1)),
  displayBlockedReason: murphAgeDisplayBlockedReasonSchema.nullable(),
  displayCategory: murphAgePublicCalculatorViewDisplayCategorySchema,
  displayStatus: murphAgeDisplayStatusSchema,
  domainContributions: z.array(murphAgePublicDomainContributionViewSchema),
  featureContributions: z.array(murphAgePublicFeatureContributionViewSchema),
  missingFeatureKeys: z.array(z.string().min(1)),
  mode: murphAgeModeSchema,
  product: z.object({
    ageDisplayReady: z.boolean(),
    promotionBlockers: z.array(murphAgeProductPromotionBlockerSchema),
    riskDisplayReady: z.boolean(),
    validationGate: murphAgePublicValidationGateSummarySchema.nullable(),
  }),
  risk: murphAgePublicRiskViewSchema,
  schemaVersion: z.literal(MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION),
  selectedCardId: murphAgePublicAuthorizationSchema.shape.cardId,
  selectedScoreBearingFeatureKeys: z.array(z.string().min(1)),
  selectedScoreBearingMetricKeys: z.array(z.string().min(1)),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
  wearable: murphAgePublicWearableCalculatorViewSchema,
})
const murphAgeResearchLocalRunEvidenceItemSchema = z.object({
  bundleId: z.enum([
    'function-context',
    'insufficient',
    'lab5-bp-bmi',
    'lab9-bp-body',
    'r399-nhis-proxy-anchor',
    'wearable-context',
  ]).optional(),
  cohortLabel: z.enum(['CRELES', 'HAALSI', 'MIDUS', 'NSHAP', 'wearables']),
  evidenceId: z.enum([
    'creles-glycemia-transport-local-run',
    'haalsi-glucose-transport-local-run',
    'midus-lab-lift-local-run',
    'nshap-hba1c-transport-local-run',
    'wearables-context-only-local-run',
  ]),
  productAuthorizationChanged: z.literal(false),
  scoringMathChanged: z.literal(false),
  signal: z.enum([
    'context-only',
    'glycemia-only-better',
    'partial',
    'slight-lift',
    'supported',
    'weak',
  ]),
  sourceRouteId: z.string().min(1).optional(),
  summary: z.string().min(1),
  supportedMetricKeys: z.array(z.string().min(1)),
})
const murphAgeResearchModelStatusViewSchema = z.object({
  blockers: z.array(z.enum([
    'biomarker-transport-not-confirmed',
    'product-use-not-authorized',
    'wearable-increment-not-validated',
  ])),
  contextOnlyMetricKeys: z.array(z.string().min(1)),
  currentModelFamily: z.literal('frozen-nhis-r399-plus-research-increments'),
  functionDisability: z.object({
    currentUse: z.literal('context-only-diagnostic-sidecar'),
    nextAction: z.literal('fresh-source-feasibility-before-promotion'),
    scoreBearing: z.literal(false),
  }),
  labBody: z.object({
    currentUse: z.literal('score-bearing-research-when-selected'),
    nextAction: z.literal('validate-transport-before-product-use'),
    transportStatus: z.literal('internal-promising-transport-not-confirmed'),
  }),
  latestLocalRunEvidence: z.array(murphAgeResearchLocalRunEvidenceItemSchema),
  latestLocalRunEvidenceStatus: z.literal('mixed-research-only-no-product-promotion'),
  productUseAuthorized: z.literal(false),
  scoreBearingFeatureKeys: z.array(z.string().min(1)),
  scoreBearingMetricKeys: z.array(z.string().min(1)),
  scoreInterpretation: z.literal('risk-age-equivalent-research-only'),
  selectedResearchCardId: murphAgePublicAuthorizationSchema.shape.cardId,
  wearable: z.object({
    consumerValidationStatus: z.literal('missing'),
    currentUse: z.literal('context-only-shadow'),
    externalConsumerLabWearableAggregateStillMissing: z.literal(true),
    nextAction: z.literal('run_external_or_partner_lab_wearable_aggregate_delta'),
    nextExternalOrPartnerRouteIdsByPriority: z.array(z.string().min(1)),
    scoreBearing: z.literal(false),
    scoreContributionAuthorized: z.literal(false),
    shadowEvidenceConclusion: z.literal('public_activity_shadow_signal_mixed_keep_wearable_context_only'),
    shadowEvidencePacketIds: z.array(z.enum([
      'r1038-nhanes-modern-lab-activity-loop',
      'r1049-nhanes-activity-control-diagnostic',
      'r1065-nhanes-wrist-activity-shadow-loop',
      'r1066-nhanes-wrist-activity-robustness-loop',
      'r1067-nhanes-wrist-final-stress-test',
    ])),
    usableAsConsumerWearableValidation: z.literal(false),
  }),
})
export const murphAgeResearchCalculatorViewResultSchema = z.object({
  ageEstimate: murphAgePublicAgeEstimateViewSchema.nullable(),
  arbiter: murphAgeResearchArbiterViewSchema,
  blockedFeatureKeys: z.array(z.string().min(1)),
  displayBlockedReason: murphAgeDisplayBlockedReasonSchema.nullable(),
  displayStatus: murphAgeDisplayStatusSchema,
  domainContributions: z.array(murphAgePublicDomainContributionViewSchema),
  featureContributions: z.array(murphAgePublicFeatureContributionViewSchema),
  missingFeatureKeys: z.array(z.string().min(1)),
  mode: murphAgeModeSchema,
  model: murphAgeResearchModelStatusViewSchema,
  product: z.object({
    ageDisplayReady: z.boolean(),
    productUseAuthorized: z.literal(false),
    promotionBlockers: z.array(murphAgeProductPromotionBlockerSchema),
    riskDisplayReady: z.boolean(),
    validationGate: murphAgePublicValidationGateSummarySchema.nullable(),
  }),
  researchOnly: z.literal(true),
  risk: murphAgePublicRiskViewSchema,
  schemaVersion: z.literal(MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION),
  selectedCardId: murphAgePublicAuthorizationSchema.shape.cardId,
  selectedScoreBearingFeatureKeys: z.array(z.string().min(1)),
  selectedScoreBearingMetricKeys: z.array(z.string().min(1)),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
  wearable: murphAgePublicWearableCalculatorViewSchema,
})
export const murphAgeCalculatorViewResultSchema = z.union([
  murphAgePublicCalculatorViewResultSchema,
  murphAgeResearchCalculatorViewResultSchema,
])

const murphAgeIncrementEvaluationLayerSchema = z.enum([
  'biomarker-increment',
  'wearable-shadow-increment',
])
const murphAgeAggregateEvidenceAssessmentSchema = z.object({
  blockers: z.array(z.string().min(1)),
  layer: murphAgeIncrementEvaluationLayerSchema.nullable(),
  routeId: z.string().min(1).nullable(),
  status: z.enum(['blocked', 'ready']),
  validationStatus: z.enum(['invalid', 'valid']),
  warningCodes: z.array(murphAgeWarningCodeSchema),
  warningCount: z.number().int().nonnegative(),
})
const murphAgeAggregateEvidenceRouteSlotSchema = z.object({
  acceptedAggregateMetricDeltaFields: z.array(z.enum([
    'aucDelta',
    'brierDelta',
    'calibrationInterceptDelta',
    'calibrationSlopeDelta',
    'cIndexDelta',
    'logLossDelta',
  ])),
  anchorCardId: z.string().min(1),
  candidateBatchId: z.string().min(1),
  candidateId: z.string().min(1),
  layer: murphAgeIncrementEvaluationLayerSchema,
  requiredAggregateSampleFields: z.array(z.enum([
    'evaluatedRowCount',
    'eventCount',
    'minimumCellCount',
    'subgroupCount',
    'suppressedCellCount',
  ])),
  sourceRouteId: z.string().min(1),
})
export const murphAgeAggregateEvidenceStatusResultSchema = z.object({
  assessments: z.array(murphAgeAggregateEvidenceAssessmentSchema),
  inputCardCount: z.number().int().nonnegative(),
  missingSourceRouteIds: z.array(z.string().min(1)),
  nextMissingSourceRouteIds: z.array(z.string().min(1)),
  readyCardCount: z.number().int().nonnegative(),
  readySourceRouteIds: z.array(z.string().min(1)),
  routeSlots: z.array(murphAgeAggregateEvidenceRouteSlotSchema),
  schemaVersion: z.literal('murph.age.aggregate-evidence-status.v1'),
  status: z.enum(['blocked', 'ready']),
})

const strictUtcTimestampSchema = isoTimestampSchema
  .refine((value) => value.endsWith('Z'), 'Expected a UTC timestamp ending in Z.')
const murphAgeReportCardIdSchema = z.enum([
  'lab5_bp_bmi_transport_research',
  'lab9_bp_body_10y_acm_research',
  'r399_nhis_proxy_10y_acm_research',
])
const murphAgeModelCardArtifactRootSchema = z.string()
  .min(1)
  .optional()
  .describe(
    'Optional local/server model-card artifact root for explicit research mode. Output remains metadata-only and never echoes this path.',
  )
const murphAgeSubmittedMetricInputSchema = z.object({
  confidence: z.enum(['none', 'low', 'medium', 'high']).optional(),
  context: z.object({
    fastingStatus: z.enum(['fasting', 'non_fasting', 'unknown']).optional(),
    flag: z.string().min(1).max(128).optional(),
    measurementMethodKey: z.string().min(1).max(128).optional(),
    qualifiers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    referenceRange: z.object({
      high: z.number().optional(),
      low: z.number().optional(),
      text: z.string().min(1).max(500).optional(),
    }).optional(),
  }).optional(),
  effectiveDate: z.string().min(1).optional(),
  metricKey: z.string().min(1).max(128),
  observedAt: z.string().min(1).optional(),
  sourceKind: z.string().min(1).max(128).optional(),
  sourceLabel: z.string().min(1).max(500).nullable().optional(),
  unit: z.string().min(1).max(128).nullable().optional(),
  value: z.number().nullable(),
})
export const murphAgeSubmittedPreviewPayloadSchema = z.object({
  asOf: strictUtcTimestampSchema
    .describe('UTC timestamp for the calculation cutoff, such as 2026-05-10T00:00:00.000Z.'),
  cardId: murphAgeReportCardIdSchema.optional(),
  chronologicalAgeYears: z
    .number()
    .nonnegative()
    .max(130)
    .describe('Current chronological age in years.'),
  modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema.optional(),
  sex: murphAgeSexSchema,
  submittedMetrics: z.array(murphAgeSubmittedMetricInputSchema).min(1),
})
type MurphAgeSubmittedPreviewPayload = z.infer<typeof murphAgeSubmittedPreviewPayloadSchema>
type MurphAgeSubmittedPreviewOptions = {
  input: string;
  modelCardArtifactRoot?: string;
}

export function registerMurphAgeCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const age = Cli.create('age', {
    description:
      'Read-only Murph Age commands for calculating the current public age/readiness report from vault data.',
  })

  age.command('report', {
    description:
      'Return the public Murph Age calculator report for labs, body metrics, and wearable context already present in the selected vault.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      asOf: strictUtcTimestampSchema
        .describe('UTC timestamp for the calculation cutoff, such as 2026-05-10T00:00:00.000Z.'),
      chronologicalAgeYears: z
        .number()
        .nonnegative()
        .max(130)
        .describe('Current chronological age in years.'),
      sex: murphAgeSexSchema
        .describe('Sex value used by the current mortality-risk model.'),
      mode: murphAgeModeSchema
        .default('product')
        .describe('Use product for normal safe display, or explicit research for local research-only model-card artifacts.'),
      cardId: murphAgeReportCardIdSchema
        .optional()
        .describe('Explicit research card override for local research model-card artifacts.'),
      modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema,
    }),
    examples: [
      {
        description:
          'Show the safe product-mode Murph Age report. Current research-only cards will abstain until authorized.',
        options: {
          asOf: '2026-05-10T00:00:00.000Z',
          chronologicalAgeYears: 45,
          sex: 'female',
          vault: './vault',
        },
      },
      {
        description:
          'Run explicit local research mode against ignored model-card artifacts under the vault runtime directory.',
        options: {
          asOf: '2026-05-10T00:00:00.000Z',
          chronologicalAgeYears: 45,
          cardId: 'lab5_bp_bmi_transport_research',
          mode: 'research',
          sex: 'female',
          vault: './vault',
        },
      },
    ],
    hint:
      'Product mode is the default and may return abstain while Murph Age remains research-only. Research mode is for local model development, not user-facing product claims.',
    output: murphAgeReportResultSchema,
    async run({ options }) {
      await assertInitializedVaultRoot(options.vault)

      return calculateMurphAgePublicReportFromVaultInputBundle({
        asOf: options.asOf,
        cardId: options.cardId,
        chronologicalAgeYears: options.chronologicalAgeYears,
        modelCardArtifactRoot: options.modelCardArtifactRoot,
        mode: options.mode,
        sex: options.sex,
        vaultRoot: options.vault,
      })
    },
  })

  age.command('scaffold', {
    description:
      'Emit the canonical research-preview JSON payload shape for submitted labs, body metrics, blood pressure, and wearable summaries.',
    args: emptyArgsSchema,
    options: z.object({}),
    examples: [
      {
        description:
          'Print a Murph Age research-preview payload that can be passed to age preview --input @payload.json.',
      },
    ],
    hint:
      'Edit the emitted payload, save it as JSON, then run age preview --input @payload.json. Wearable values are accepted as context but do not affect the score yet.',
    output: murphAgeSubmittedPreviewPayloadSchema,
    run() {
      return scaffoldMurphAgeSubmittedPreviewPayload()
    },
  })

  age.command('preview', {
    description:
      'Return a research-only Murph Age preview from a submitted JSON payload of labs, body metrics, blood pressure, and wearable summaries.',
    args: emptyArgsSchema,
    options: z.object({
      input: inputFileOptionSchema.describe('Submitted Murph Age payload in @file.json form or - for stdin.'),
      modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema.optional(),
    }),
    examples: [
      {
        description:
          'Run a local research preview from a JSON payload without requiring a vault.',
        options: {
          input: '@murph-age-preview.json',
          modelCardArtifactRoot: './.runtime/operations/murph-age/model-cards',
        },
      },
    ],
    hint:
      'This command is research-only. It is for local model development and demos, not product claims or medical recommendations.',
    output: murphAgeReportResultSchema,
    async run({ options }) {
      return loadMurphAgeSubmittedPreviewReport(options)
    },
  })

  age.command('preview-view', {
    description:
      'Return an internal research-only Murph Age calculator view from a submitted JSON payload.',
    args: emptyArgsSchema,
    options: z.object({
      input: inputFileOptionSchema.describe('Submitted Murph Age payload in @file.json form or - for stdin.'),
      modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema.optional(),
    }),
    examples: [
      {
        description:
          'Run a local internal calculator view with age, risk, and feature/domain breakdowns for model development.',
        options: {
          input: '@murph-age-preview.json',
          modelCardArtifactRoot: './.runtime/operations/murph-age/model-cards',
        },
      },
    ],
    hint:
      'This view is internal and research-only. It can show scores for model development, but product use remains unauthorized.',
    output: murphAgeResearchCalculatorViewResultSchema,
    async run({ options }) {
      return buildMurphAgeResearchCalculatorView(await loadMurphAgeSubmittedPreviewReport(options))
    },
  })

  age.command('calculate', {
    description:
      'Return a stable Murph Age calculator view from submitted labs, body metrics, blood pressure, and wearable summaries.',
    args: emptyArgsSchema,
    options: z.object({
      input: inputFileOptionSchema.describe('Submitted Murph Age payload in @file.json form or - for stdin.'),
      mode: murphAgeModeSchema
        .default('product')
        .describe('Use product for normal safe display, or explicit research for local research-only age/risk output.'),
      modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema.optional(),
    }),
    examples: [
      {
        description:
          'Return the product-safe calculator view from submitted data. Current research-only cards will abstain until authorized.',
        options: {
          input: '@murph-age-preview.json',
        },
      },
      {
        description:
          'Return the internal research calculator view with the current local research age/risk breakdown.',
        options: {
          input: '@murph-age-preview.json',
          mode: 'research',
          modelCardArtifactRoot: './.runtime/operations/murph-age/model-cards',
        },
      },
    ],
    hint:
      'This is the site/backend-shaped calculator contract. Product mode is safe-by-default; research mode is explicit and not a product or medical claim.',
    output: murphAgeCalculatorViewResultSchema,
    async run({ options }) {
      const report = await loadMurphAgeSubmittedCalculatorReport(options)
      if (options.mode === 'research') {
        return buildMurphAgeResearchCalculatorView(report)
      }
      return buildMurphAgePublicCalculatorView(report)
    },
  })

  age.command('inputs', {
    description:
      'Return metadata-only Murph Age input readiness for labs, body metrics, blood pressure, and wearable context in the selected vault.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      asOf: strictUtcTimestampSchema
        .describe('UTC timestamp for the readiness cutoff, such as 2026-05-10T00:00:00.000Z.'),
    }),
    examples: [
      {
        description:
          'Show which Murph Age input features are ready or missing without exposing metric values or point ids.',
        options: {
          asOf: '2026-05-10T00:00:00.000Z',
          vault: './vault',
        },
      },
    ],
    hint:
      'This command reports input readiness only. It does not calculate an age, expose metric values, or make product claims.',
    output: murphAgeInputReadinessResultSchema,
    async run({ options }) {
      await assertInitializedVaultRoot(options.vault)
      const [inputReadiness, wearableShadow] = await Promise.all([
        assessMurphAgeInputReadinessFromVault({
          asOf: options.asOf,
          vaultRoot: options.vault,
        }),
        assessMurphAgeWearableShadowReadinessFromVault({
          asOf: options.asOf,
          vaultRoot: options.vault,
        }),
      ])

      return {
        ...inputReadiness,
        schemaVersion: 'murph.age.input-readiness.v5' as const,
        wearableShadow,
      }
    },
  })

  age.command('model-cards', {
    description:
      'Return metadata-only readiness status for local Murph Age model-card artifacts and current policy blockers.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema,
    }),
    examples: [
      {
        description:
          'Show which local Murph Age research cards are loaded and why product age display is still blocked.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'This command reports policy and artifact presence only. It does not expose model internals, row values, predictions, or product claims.',
    output: murphAgeModelCardStatusResultSchema,
    async run({ options }) {
      await assertInitializedVaultRoot(options.vault)

      const loaded = await loadMurphAgeLocalModelCardArtifacts({
        modelCardArtifactRoot: options.modelCardArtifactRoot,
        vaultRoot: options.vault,
      })
      const loadedCardIds = Object.keys(loaded.models)
        .filter(isKnownMurphAgeModelCardId)
        .sort()
      const loadedCardIdSet = new Set(loadedCardIds)
      const policies = listMurphAgeModelCardPolicies()
        .map((policy) => summarizeMurphAgeModelCardPolicy(policy, loadedCardIdSet))
        .sort((left, right) => left.cardId.localeCompare(right.cardId))

      return {
        loadedCardIds,
        policies,
        productReadyCardIds: policies
          .filter((policy) => policy.productAgeReady)
          .map((policy) => policy.cardId),
        researchReadyCardIds: policies
          .filter((policy) => policy.researchUsable)
          .map((policy) => policy.cardId),
        schemaVersion: 'murph.age.model-card-status.v2' as const,
        warnings: loaded.warnings.map((warning) => ({ code: warning.code })),
      }
    },
  })

  age.command('evidence', {
    description:
      'Validate aggregate-only Murph Age lab/wearable evidence receipts and report which source routes are ready.',
    args: emptyArgsSchema,
    options: z.object({
      input: inputFileOptionSchema
        .optional()
        .describe('Aggregate evidence receipt payload in @file.json form or - for stdin.'),
      includeTemplates: z.boolean()
        .default(false)
        .describe('Include safe route-slot templates for the next aggregate receipts to collect.'),
    }),
    examples: [
      {
        description:
          'Show the current aggregate receipt slots without providing any receipt cards.',
        options: {
          includeTemplates: true,
        },
      },
      {
        description:
          'Validate aggregate evidence cards produced by an external or local same-denominator evaluator.',
        options: {
          input: '@murph-age-aggregate-receipts.json',
        },
      },
    ],
    hint:
      'This command accepts only aggregate receipt cards. It does not expose rows, identifiers, predictions, coefficients, local paths, or product claims.',
    output: murphAgeAggregateEvidenceStatusResultSchema,
    async run({ options }) {
      const candidates = options.input
        ? await loadMurphAgeAggregateEvidenceCandidateCards(options.input)
        : []
      const ordinaryRouteIds = new Set(
        listMurphAgeOrdinaryLabWearableSourceRoutes().map((route) => route.routeId),
      )
      const routeSlotTemplateKeys = new Set(
        listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates()
          .map((template) => buildMurphAgeAggregateEvidenceRouteSlotKey(template))
          .filter((key) => key !== null),
      )
      const assessments = candidates.map((candidate) => {
        const assessment = assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard(candidate)
        return summarizeMurphAgeAggregateEvidenceAssessment({
          assessment,
          candidate,
          ordinaryRouteIds,
          routeSlotTemplateKeys,
        })
      })
      const readyRouteIds = new Set(
        assessments
          .filter((assessment) => assessment.status === 'ready' && assessment.routeId)
          .map((assessment) => assessment.routeId),
      )
      const missingSourceRouteIds = listMurphAgeOrdinaryLabWearableSourceRoutes()
        .map((route) => route.routeId)
        .filter((routeId) => !readyRouteIds.has(routeId))
      const routeSlots = options.includeTemplates
        ? listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates()
          .map((template) => ({
            acceptedAggregateMetricDeltaFields: [...template.acceptedAggregateMetricDeltaFields].sort(),
            anchorCardId: template.anchorCardId,
            candidateBatchId: template.candidateBatchId,
            candidateId: template.candidateId,
            layer: template.layer,
            requiredAggregateSampleFields: [...template.requiredAggregateSampleFields],
            sourceRouteId: template.sourceRouteId,
          }))
        : []

      return {
        assessments,
        inputCardCount: candidates.length,
        missingSourceRouteIds,
        nextMissingSourceRouteIds: missingSourceRouteIds.slice(0, 3),
        readyCardCount: assessments.filter((assessment) => assessment.status === 'ready').length,
        readySourceRouteIds: listMurphAgeOrdinaryLabWearableSourceRoutes()
          .map((route) => route.routeId)
          .filter((routeId) => readyRouteIds.has(routeId)),
        routeSlots,
        schemaVersion: 'murph.age.aggregate-evidence-status.v1' as const,
        status: readyRouteIds.size > 0 ? 'ready' as const : 'blocked' as const,
      }
    },
  })

  cli.command(age)
}

function scaffoldMurphAgeSubmittedPreviewPayload(): MurphAgeSubmittedPreviewPayload {
  return {
    asOf: '2026-05-19T00:00:00.000Z',
    chronologicalAgeYears: 45,
    sex: 'female',
    submittedMetrics: [
      { metricKey: 'HbA1c', unit: '%', value: 5.4 },
      { metricKey: 'HDL_C', unit: 'mg/dL', value: 58 },
      { metricKey: 'Triglycerides', unit: 'mg/dL', value: 95 },
      { metricKey: 'creatinine', unit: 'mg/dL', value: 0.82 },
      { metricKey: 'systolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 118 },
      { metricKey: 'diastolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 72 },
      { metricKey: 'body_mass_index', sourceKind: 'measurement', unit: 'kg/m2', value: 23.2 },
      { metricKey: 'steps', sourceKind: 'wearable-summary', unit: 'count', value: 9800 },
      { metricKey: 'total-sleep-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 430 },
      { metricKey: 'resting-heart-rate', sourceKind: 'wearable-summary', unit: 'bpm', value: 58 },
      { metricKey: 'hrv-rmssd', sourceKind: 'wearable-summary', unit: 'ms', value: 55 },
      { metricKey: 'wearable_valid_day_count_28d', sourceKind: 'wearable-summary', unit: 'count', value: 24 },
      { metricKey: 'wearable_coverage_index', sourceKind: 'wearable-summary', unit: 'score', value: 0.86 },
    ],
  }
}

async function loadMurphAgeSubmittedPreviewReport(
  options: MurphAgeSubmittedPreviewOptions,
) {
  const payload = murphAgeSubmittedPreviewPayloadSchema.parse(
    await loadJsonInputObject(options.input, 'Murph Age submitted preview payload'),
  )

  return getMurphAgeResearchPreviewForSubmittedInputs({
    ...payload,
    modelCardArtifactRoot: options.modelCardArtifactRoot ?? payload.modelCardArtifactRoot,
  })
}

async function loadMurphAgeSubmittedCalculatorReport(
  options: MurphAgeSubmittedPreviewOptions & { mode: z.infer<typeof murphAgeModeSchema> },
) {
  const payload = murphAgeSubmittedPreviewPayloadSchema.parse(
    await loadJsonInputObject(options.input, 'Murph Age submitted calculator payload'),
  )
  const {
    modelCardArtifactRoot: payloadModelCardArtifactRoot,
    ...calculatorPayload
  } = payload
  const modelCardArtifactRoot = options.mode === 'research'
    ? options.modelCardArtifactRoot ?? payloadModelCardArtifactRoot
    : options.modelCardArtifactRoot
  if (options.mode === 'research') {
    return getMurphAgeResearchPreviewForSubmittedInputs({
      ...calculatorPayload,
      modelCardArtifactRoot,
    })
  }

  const loaded = options.modelCardArtifactRoot === undefined
    ? { models: {}, warnings: [] }
    : await loadMurphAgeLocalModelCardArtifacts({
        modelCardArtifactRoot,
      })
  const report = calculateMurphAgePublicReportFromSubmittedInputs({
    ...calculatorPayload,
    mode: 'product',
    models: loaded.models,
  })
  return {
    ...report,
    warnings: [
      ...loaded.warnings.map((warning) => ({ ...warning })),
      ...report.warnings,
    ],
  }
}

async function loadMurphAgeAggregateEvidenceCandidateCards(input: string): Promise<unknown[]> {
  const raw = await loadTextInput(input, 'Murph Age aggregate evidence receipt payload', {
    stdinHint: 'Pass --input @file.json or pipe an aggregate receipt object to --input -.',
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new VaultCliError(
      'invalid_payload',
      'Murph Age aggregate evidence receipt payload must contain valid JSON.',
    )
  }
  if (Array.isArray(parsed)) return parsed
  if (!isPlainRecord(parsed)) return []
  if (Array.isArray(parsed.cards)) return parsed.cards
  if (Array.isArray(parsed.receipts)) return parsed.receipts
  if (Array.isArray(parsed.evidenceCards)) return parsed.evidenceCards
  if (Array.isArray(parsed.incrementEvaluationCards)) return parsed.incrementEvaluationCards
  return [parsed]
}

function summarizeMurphAgeAggregateEvidenceAssessment(input: {
  assessment: ReturnType<typeof assessMurphAgeOrdinaryLabWearableAggregateEvidenceCard>
  candidate: unknown
  ordinaryRouteIds: ReadonlySet<string>
  routeSlotTemplateKeys: ReadonlySet<string>
}): z.infer<typeof murphAgeAggregateEvidenceAssessmentSchema> {
  const candidateLayer = isPlainRecord(input.candidate) && typeof input.candidate.layer === 'string'
    ? input.candidate.layer
    : null
  const layer = murphAgeIncrementEvaluationLayerSchema.safeParse(candidateLayer)
  const routeId = input.assessment.routeId && input.ordinaryRouteIds.has(input.assessment.routeId)
    ? input.assessment.routeId
    : null
  const routeSlotTemplateKey = buildMurphAgeAggregateEvidenceRouteSlotKey(input.candidate)
  const routeSlotTemplateMatched = routeSlotTemplateKey !== null &&
    input.routeSlotTemplateKeys.has(routeSlotTemplateKey)
  const templateBlockers = input.assessment.status === 'ready' && !routeSlotTemplateMatched
    ? ['route_slot_template_mismatch']
    : []
  const blockers = [...input.assessment.blockers, ...templateBlockers].sort()

  return {
    blockers,
    layer: layer.success ? layer.data : null,
    routeId,
    status: blockers.length === 0 ? 'ready' : 'blocked',
    validationStatus: input.assessment.validation.status,
    warningCodes: input.assessment.warnings.map((warning) => warning.code),
    warningCount: input.assessment.warnings.length,
  }
}

function buildMurphAgeAggregateEvidenceRouteSlotKey(value: unknown): string | null {
  if (!isPlainRecord(value)) return null
  const anchorCardId = readStringField(value, 'anchorCardId')
  const candidateBatchId = readStringField(value, 'candidateBatchId')
  const candidateId = readStringField(value, 'candidateId')
  const sourceRouteId = readStringField(value, 'sourceRouteId')
  const layer = readStringField(value, 'layer')
  if (
    !anchorCardId ||
    !candidateBatchId ||
    !candidateId ||
    !sourceRouteId ||
    !layer
  ) {
    return null
  }
  return [
    anchorCardId,
    candidateBatchId,
    candidateId,
    sourceRouteId,
    layer,
  ].join('\u0000')
}

function readStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isKnownMurphAgeModelCardId(
  value: string,
): value is z.infer<typeof murphAgeModelCardIdSchema> {
  return murphAgeModelCardIdSchema.safeParse(value).success
}

function summarizeMurphAgeModelCardPolicy(
  policy: ReturnType<typeof listMurphAgeModelCardPolicies>[number],
  loadedCardIds: ReadonlySet<z.infer<typeof murphAgeModelCardIdSchema>>,
): z.infer<typeof murphAgeModelCardStatusPolicySchema> {
  const loaded = loadedCardIds.has(policy.cardId)
  const productRiskAuthorized = isMurphAgeModelCardProductAuthorized(policy)
  const productAgeDisplayAuthorized = isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy)
  const productRiskReady = policy.scoreBearing && loaded && productRiskAuthorized
  const productAgeReady = policy.scoreBearing && loaded && productAgeDisplayAuthorized
  const blockers: Array<z.infer<typeof murphAgeModelCardBlockerSchema>> = []
  if (policy.scoreBearing && !loaded) blockers.push('MODEL_CARD_NOT_LOADED')
  if (!policy.scoreBearing) blockers.push('NOT_SCORE_BEARING')
  if (!productRiskAuthorized) blockers.push('PRODUCT_NOT_AUTHORIZED')
  if (!productAgeDisplayAuthorized) blockers.push('RISK_TO_AGE_NOT_AUTHORIZED')
  if (!policy.wearableScoreBearingAuthorized) blockers.push('WEARABLE_NOT_SCORE_BEARING')

  return {
    acceptedBundleIds: [...policy.acceptedBundleIds].sort(),
    blockers,
    cardId: policy.cardId,
    evidenceClass: policy.evidenceClass,
    loaded,
    outcomeContext: {
      ageEstimateBasis: policy.outcome.ageEstimateBasis,
      horizonYears: policy.outcome.horizonYears,
      riskEndpoint: policy.outcome.riskEndpoint,
    },
    productAgeReady,
    productPromotionBlockers: listMurphAgeModelCardProductPromotionBlockers(policy),
    productRiskReady,
    researchUsable: policy.scoreBearing && loaded,
    scoreBearing: policy.scoreBearing,
    scoreBearingMetricKeys: [...policy.scoreBearingMetricKeys].sort(),
    scoreBearingSourceKinds: [...policy.scoreBearingSourceKinds].sort(),
    validationGate: {
      evidenceTiers: [...policy.validationGate.evidenceTiers].sort(),
      productPromotionEvidence: policy.validationGate.productPromotionEvidence,
      status: policy.validationGate.status,
    },
    wearableScoreBearingAuthorized: policy.wearableScoreBearingAuthorized,
  }
}
