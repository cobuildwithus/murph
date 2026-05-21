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
  buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt,
  buildMurphAgePublicCalculatorView,
  buildMurphAgeResearchCalculatorView,
  buildMurphAgeSubmittedCalculatorViewBundle,
  calculateMurphAgePublicReportFromSubmittedInputs,
  isMurphAgePublicFeatureKey,
  isMurphAgePublicMetricKey,
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  listMurphAgeNsrrDatasetRequests,
  listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates,
  listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority,
  listMurphAgeOrdinaryLabWearableSourceRoutes,
  listMurphAgeModelCardPolicies,
  listMurphAgeModelCardProductPromotionBlockers,
  listMurphAgeWearableActivityBenchmarkCards,
  listMurphAgeWearableLabAggregateReceiptTemplates,
  MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION,
  MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT,
  MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
  MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SCORE_BEARING_STRATEGY_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_SHADOW_INCREMENT_SCHEMA_VERSION,
  resolveMurphAgeSourceRoute,
  type MurphAgeSourceRouteId,
  type MurphAgeSubmittedCalculatorViewBundle,
  type MurphAgeWearableResidualParameterPack,
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
  'l1_tiny_glycemia_10y_acm_research',
  'lab5_bp_bmi_transport_research',
  'lab9_bp_body_10y_acm_research',
  'r399_nhis_proxy_10y_acm_research',
  'wearable_context_no_risk',
])
const murphAgeScoreBearingModelCardIdSchema = z.enum([
  'l1_tiny_glycemia_10y_acm_research',
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
  'l1-glycemia',
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
    'l1-glycemia',
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
const murphAgeSubmittedCalculatorInputBundleFeatureSpecSchema = z.object({
  displayName: z.string().min(1),
  featureKey: z.string().min(1),
  metricKeys: z.array(z.string().min(1)),
  requiredForCompletion: z.boolean(),
})
const murphAgeSubmittedCalculatorInputBundleSpecIdSchema = z.enum([
  'function-context',
  'l1-glycemia',
  'lab5-bp-bmi',
  'lab9-bp-body',
  'r399-nhis-proxy-anchor',
  'wearable-context',
])
const murphAgeSubmittedMetricSourceKindSchema = z.enum([
  'activity-summary',
  'measurement',
  'profile',
  'questionnaire',
  'sleep-summary',
  'survey-response',
  'test-result',
  'wearable-summary',
])
const murphAgeSubmittedCalculatorInputBundleSpecSchema = z.object({
  bundleId: murphAgeSubmittedCalculatorInputBundleSpecIdSchema,
  cardId: murphAgeModelCardIdSchema,
  completion: z.object({
    alternativeFeatureKeyGroups: z.array(z.array(z.string().min(1))),
    minReadyFeatureCount: z.number().int().positive().nullable(),
    requiredFeatureKeys: z.array(z.string().min(1)),
    rule: z.enum([
      'all-required-features',
      'all-lab5-features-plus-bmi-or-blood-pressure',
      'one-or-more-context-features',
      'one-or-more-glycemia-features',
      'one-or-more-proxy-features',
    ]),
  }),
  displayName: z.string().min(1),
  featureSpecs: z.array(murphAgeSubmittedCalculatorInputBundleFeatureSpecSchema),
  productScoreBearingAuthorized: z.boolean(),
  researchAgeEstimateEligible: z.boolean(),
  schemaVersion: z.literal('murph.age.submitted-calculator-input-bundle-spec.v1'),
  scoreBearing: z.boolean(),
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
  'minimal-glycemia-first-pass',
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
  labConflictPolicy: z.literal('lab9-primary-lab5-transport-l1-glycemia-guard-r399-anchor-fallback'),
  selectedCardRole: murphAgeResearchCardRoleSchema.nullable(),
  selectionReason: z.enum([
    'anchor-selected',
    'minimal-glycemia-selected',
    'no-score-bearing-card-selected',
    'primary-lab-card-selected',
    'transport-fallback-selected',
  ]),
  strategy: z.literal('r399-anchor-lab9-primary-lab5-transport-l1-glycemia-function-sidecar-wearables-context'),
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
  measurementMethod: z.enum([
    'consumer-device',
    'estimated-fitness',
    'psg-or-ecg',
    'research-actigraphy',
    'self-report',
    'unknown',
  ]),
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
const murphAgeWearableParameterPackContractSchema = z.object({
  deploymentRightsRequiredForProductScoring: z.literal(true),
  emptyPackBehavior: z.literal('exact-current-zero-delta-behavior'),
  familyPriorityOrder: z.array(z.enum(['activity', 'sleep', 'resting-heart-rate', 'hrv', 'estimated-vo2-max'])),
  requiredFields: z.array(z.enum([
    'anchorCardId',
    'calibrationIntercept',
    'calibrationSlope',
    'deploymentRights',
    'deviceMethodQualifier',
    'eligibleAgeSexBounds',
    'endpoint',
    'evidenceTier',
    'family',
    'featureNames',
    'featureTransforms',
    'globalWearableCap',
    'horizonYears',
    'packHash',
    'promotionGateResults',
    'sourceRouteId',
    'validDayNightRules',
  ])),
  requiredForResidualScoring: z.literal(true),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_PARAMETER_PACK_CONTRACT_SCHEMA_VERSION),
  supportedDeploymentRights: z.array(z.enum(['not-authorized', 'research-only', 'product-authorized'])),
})
const murphAgeSourceRouteIdSchema = z.custom<MurphAgeSourceRouteId>(
  (value): value is MurphAgeSourceRouteId =>
    typeof value === 'string' && resolveMurphAgeSourceRoute(value) !== null,
  { error: 'Expected a known Murph Age source route id.' },
)
const murphAgeWearableResidualParameterPackSchema: z.ZodType<MurphAgeWearableResidualParameterPack> = z.object({
  anchorCardId: murphAgeScoreBearingModelCardIdSchema,
  calibrationIntercept: z.number().finite(),
  calibrationSlope: z.number().finite().positive(),
  deploymentRights: z.enum(['not-authorized', 'research-only', 'product-authorized']),
  endpoint: z.literal('10-year all-cause mortality'),
  evidenceTier: murphAgeValidationEvidenceTierSchema,
  family: z.literal('activity'),
  featureWeights: z.array(z.object({
    center: z.number().finite(),
    coefficient: z.number().finite(),
    metricKey: z.string().min(1).max(128),
    scale: z.number().finite().positive(),
    transform: z.literal('center-scale'),
  })).min(1),
  globalWearableCapLogit: z.number().finite().positive().max(1),
  horizonYears: z.literal(10),
  intercept: z.number().finite(),
  layerId: z.literal('activity-residual-v1'),
  packHash: z.string().min(8).max(128).regex(/^[a-z0-9][a-z0-9._-]+$/u),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION),
  sourceRouteId: murphAgeSourceRouteIdSchema,
})
const murphAgeWearableResidualFeatureSetContractSchema = z.object({
  activityVolumeCandidateMetricKeys: z.array(z.string().min(1)),
  coverageControlMetricKeys: z.array(z.string().min(1)),
  firstPassOnlyFamily: z.literal('activity'),
  methodQualifierRequired: z.literal(true),
  proprietaryDeviceScoresExcluded: z.literal(true),
  trailingWindowDays: z.literal(28),
})
const murphAgeWearableResidualLayerContractSchema = z.object({
  anchorCardIds: z.array(murphAgeScoreBearingModelCardIdSchema),
  parameterPackContract: murphAgeWearableParameterPackContractSchema,
  combinationScale: z.literal('logit-residual'),
  coverageScoringPolicy: z.literal('gate-and-control-only-not-age-contribution'),
  currentDeploymentStatus: z.literal('contract-only-no-validated-parameters'),
  deployableParameterizationAvailable: z.literal(false),
  deferredFamilyOrder: z.array(z.enum(['sleep', 'resting-heart-rate', 'hrv', 'estimated-vo2-max'])),
  family: z.literal('activity'),
  featureSetContract: murphAgeWearableResidualFeatureSetContractSchema,
  layerId: z.literal('activity-residual-v1'),
  minimumValidDays28d: z.literal(14),
  missingnessPolicy: z.literal('missing-or-undercovered-family-zero-delta-widen-uncertainty'),
  nuisanceControlMetricKeys: z.array(z.string().min(1)),
  primaryDecisionComparisons: z.array(z.enum([
    'm5-vs-m1-lab-body',
    'm5-vs-m2-coverage-control',
  ])),
  productAuthorized: z.literal(false),
  productMultiplier: z.literal(0),
  qualityGateMetricKeys: z.array(z.string().min(1)),
  requiredPromotionSignals: z.array(z.enum([
    'deployable-parameterization-authorized',
    'm5-beats-m1-proper-score',
    'm5-beats-m2-coverage-control',
    'm5-calibration-passes',
    'negative-controls-pass',
    'replicates-in-two-source-families',
    'reverse-causation-washout-passes',
  ])),
  researchMultiplier: z.literal(0),
  residualDeltaStatus: z.literal('zero-until-validated'),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_RESIDUAL_LAYER_CONTRACT_SCHEMA_VERSION),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  signalMetricKeys: z.array(z.string().min(1)),
  trailingWindowDays: z.literal(28),
})
const murphAgeWearableScoreBearingStrategySchema = z.object({
  aggregateReceiptOnlyAuthorizesScienceReview: z.literal(true),
  architecturePattern: z.literal('anchor-plus-wearable-residual-shadow'),
  deployableParameterizationRequiredForProductScoring: z.literal(true),
  familyPolicies: z.array(murphAgeWearableScoreBearingFamilyPolicySchema),
  modelForm: z.literal('penalized-additive-residual-bounded-and-shrunk'),
  primaryDecisionComparisons: z.array(z.enum([
    'm5-vs-m1-lab-body',
    'm5-vs-m2-coverage-control',
  ])),
  productStatus: z.literal('context-only'),
  productWearableMultiplier: z.literal(0),
  residualLayerContract: murphAgeWearableResidualLayerContractSchema,
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

const murphAgeWearableResidualLayerViewSchema = z.object({
  anchorCardId: murphAgePublicAuthorizationSchema.shape.cardId,
  anchorRiskAgeEquivalentYears: z.number().nullable(),
  eligibleForResidualResearch: z.boolean(),
  finalRiskAgeEquivalentYears: z.number().nullable(),
  finalRiskProbability: z.number().nullable(),
  layerId: z.literal('activity-residual-v1'),
  parameterPackHash: z.string().min(1).nullable(),
  parameterizationAvailable: z.boolean(),
  productAuthorized: z.literal(false),
  residualDeltaYears: z.number().nullable(),
  residualDeltaLogit: z.number(),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_RESIDUAL_LAYER_APPLICATION_SCHEMA_VERSION),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  selectedMetricKeys: z.array(z.string().min(1)),
  status: z.enum([
    'blocked-incompatible-anchor',
    'ineligible-insufficient-coverage',
    'mechanics-ready-zero-delta',
    'research-parameterized-shadow-delta',
  ]),
  warnings: z.array(murphAgePublicWarningSchema),
})

export const murphAgeInputReadinessResultSchema = z.object({
  bundle: murphAgeInputBundleReadinessSchema,
  contextBundles: z.array(murphAgeInputBundleReadinessSchema),
  inputBundleSpecs: z.array(murphAgeSubmittedCalculatorInputBundleSpecSchema),
  runtimeInputs: z.array(murphAgeRuntimeInputReadinessSchema),
  schemaVersion: z.literal('murph.age.input-readiness.v6'),
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
  schemaVersion: z.literal(MURPH_AGE_PUBLIC_CALCULATOR_REPORT_SCHEMA_VERSION),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
  wearableResidualLayer: murphAgeWearableResidualLayerViewSchema.nullable(),
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
const murphAgePublicDriverViewSchema = murphAgePublicFeatureContributionViewSchema.extend({
  absoluteContributionYears: z.number().nonnegative(),
  direction: z.enum(['neutral', 'older', 'younger']),
})
const murphAgePublicDriverSummaryViewSchema = z.object({
  neutral: z.array(murphAgePublicDriverViewSchema),
  older: z.array(murphAgePublicDriverViewSchema),
  younger: z.array(murphAgePublicDriverViewSchema),
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
const murphAgePublicCalculatorScoreStatusSchema = z.enum([
  'context-only-no-score',
  'input-incomplete',
  'research-estimate-withheld',
  'validated-age-ready',
  'validated-risk-only',
  'validation-pending',
])
const murphAgePublicCalculatorUnlockRequirementSchema = z.enum([
  'complete-score-bearing-inputs',
  'external-outcome-validation',
  'product-policy-authorization',
  'risk-to-age-display-authorization',
  'validated-wearable-parameter-pack',
])
const murphAgePublicCalculatorScoreReadinessViewSchema = z.object({
  biologicalAgeAvailable: z.boolean(),
  contextBundleIds: z.array(murphAgeInputBundleIdSchema),
  contextOnlyFeatureCount: z.number().int().nonnegative(),
  inputBundleId: murphAgeInputBundleIdSchema,
  missingScoreBearingFeatureCount: z.number().int().nonnegative(),
  riskAvailable: z.boolean(),
  scoreBearingFeatureCount: z.number().int().nonnegative(),
  status: murphAgePublicCalculatorScoreStatusSchema,
  unlockRequirements: z.array(murphAgePublicCalculatorUnlockRequirementSchema),
  wearableReadyFeatureCount: z.number().int().nonnegative(),
})
export const murphAgePublicCalculatorViewResultSchema = z.object({
  ageEstimate: murphAgePublicAgeEstimateViewSchema.nullable(),
  blockedFeatureKeys: z.array(z.string().min(1)),
  displayBlockedReason: murphAgeDisplayBlockedReasonSchema.nullable(),
  displayCategory: murphAgePublicCalculatorViewDisplayCategorySchema,
  displayStatus: murphAgeDisplayStatusSchema,
  domainContributions: z.array(murphAgePublicDomainContributionViewSchema),
  featureContributions: z.array(murphAgePublicFeatureContributionViewSchema),
  featureDrivers: murphAgePublicDriverSummaryViewSchema,
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
  scoreReadiness: murphAgePublicCalculatorScoreReadinessViewSchema,
  selectedCardId: murphAgePublicAuthorizationSchema.shape.cardId,
  selectedScoreBearingFeatureKeys: z.array(z.string().min(1)),
  selectedScoreBearingMetricKeys: z.array(z.string().min(1)),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
  wearable: murphAgePublicWearableCalculatorViewSchema,
  wearableResidualLayer: murphAgeWearableResidualLayerViewSchema.nullable(),
})
const murphAgeResearchLocalRunEvidenceItemSchema = z.object({
  bundleId: z.enum([
    'function-context',
    'insufficient',
    'l1-glycemia',
    'lab5-bp-bmi',
    'lab9-bp-body',
    'r399-nhis-proxy-anchor',
    'wearable-context',
  ]).optional(),
  cohortLabel: z.enum(['CRELES', 'HAALSI', 'MHAS', 'MIDUS', 'NSHAP', 'wearables']),
  evidenceId: z.enum([
    'creles-glycemia-transport-local-run',
    'haalsi-glucose-transport-local-run',
    'mhas-function-mobility-sidecar-local-run',
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
    'function-sidecar-parameter-pack-missing',
    'product-use-not-authorized',
    'wearable-increment-not-validated',
  ])),
  contextOnlyMetricKeys: z.array(z.string().min(1)),
  currentModelFamily: z.literal('frozen-nhis-r399-plus-research-increments'),
  composition: z.object({
    anchorLayerStatus: z.literal('available-as-research-anchor-and-fallback-not-layered'),
    currentScoringMode: z.literal('single-selected-research-card'),
    labBodyStatus: z.literal('selected-card-score-not-additive-increment'),
    nextArchitectureStep: z.literal('fit-function-sidecar-before-layered-scoring'),
    wearableStatus: z.literal('context-only-zero-product-multiplier'),
  }),
  functionDisability: z.object({
    currentUse: z.literal('bounded-research-sidecar-supported-pending-parameter-pack'),
    nextAction: z.literal('fit-bounded-function-parameter-pack-then-validate-fresh-source'),
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
  featureDrivers: murphAgePublicDriverSummaryViewSchema,
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
  wearableResidualLayer: murphAgeWearableResidualLayerViewSchema.nullable(),
})
export const murphAgeCalculatorViewResultSchema = z.union([
  murphAgePublicCalculatorViewResultSchema,
  murphAgeResearchCalculatorViewResultSchema,
])
const murphAgeSubmittedCalculatorCapabilitySchema = z.object({
  acceptedMetricKeys: z.array(z.string().min(1)),
  acceptedSourceKinds: z.array(murphAgeSubmittedMetricSourceKindSchema),
  acceptedUserInputFamilies: z.array(z.enum([
    'demographics-age-sex',
    'bloodwork-common-labs',
    'vitals-body-composition',
    'wearable-activity',
    'wearable-recovery-autonomic',
    'wearable-sleep',
  ])),
  bundleIds: z.array(murphAgeSubmittedCalculatorInputBundleSpecIdSchema),
  contextBundleIds: z.array(murphAgeSubmittedCalculatorInputBundleSpecIdSchema),
  outputBoundary: z.object({
    modelParametersExportAllowed: z.literal(false),
    participantLevelExportAllowed: z.literal(false),
    productScoreDisplayAuthorized: z.boolean(),
    researchPreviewRequiresExplicitOptIn: z.literal(true),
    rowValuesExportAllowed: z.literal(false),
    submittedMetricScalarEchoAllowed: z.literal(false),
  }),
  productAgeDisplayAuthorized: z.boolean(),
  productRiskDisplayAuthorized: z.boolean(),
  productScoreBearingMetricKeys: z.array(z.string().min(1)),
  researchAgeEstimateEligibleBundleIds: z.array(murphAgeSubmittedCalculatorInputBundleSpecIdSchema),
  researchPreviewSupported: z.literal(true),
  researchScoreBearingMetricKeys: z.array(z.string().min(1)),
  runtimeInputKeys: z.array(z.enum(['chronological-age-years', 'sex'])),
  schemaVersion: z.literal(MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION),
  scoreBearingBundleIds: z.array(murphAgeSubmittedCalculatorInputBundleSpecIdSchema),
  wearableContextMetricKeys: z.array(z.string().min(1)),
  wearableDeferredFeatureKeys: z.array(z.string().min(1)),
  wearableFirstPriorityFeatureKeys: z.array(z.string().min(1)),
  wearableFirstPriorityMetricKeys: z.array(z.string().min(1)),
  wearableScoreBearingMetricKeys: z.array(z.string().min(1)),
  wearableSecondPriorityFeatureKeys: z.array(z.string().min(1)),
  wearableSecondPriorityMetricKeys: z.array(z.string().min(1)),
})
export const murphAgeSubmittedCalculatorViewBundleResultSchema = z.object({
  capabilities: murphAgeSubmittedCalculatorCapabilitySchema,
  product: z.object({
    report: murphAgeReportResultSchema,
    view: murphAgePublicCalculatorViewResultSchema,
  }),
  researchPreview: z.object({
    report: murphAgeReportResultSchema,
    view: murphAgeResearchCalculatorViewResultSchema,
  }).nullable(),
  schemaVersion: z.literal(MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION),
})

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
const murphAgeWearableLabAggregateReceiptModelIdSchema = z.enum([
  'm0-anchor-only',
  'm1-anchor-plus-lab-body-bp',
  'm2-coverage-device-ehr-density-control',
  'm3-wearable-residual',
  'm4-wearable-plus-coverage',
  'm5-residualized-wearable-after-controls',
])
const murphAgeWearableLabAggregateReceiptMetricFieldSchema = z.enum([
  'auc',
  'brier',
  'calibrationIntercept',
  'calibrationSlope',
  'cIndex',
  'events',
  'logLoss',
  'meanPrediction',
  'n',
  'observedRate',
])
const murphAgeWearableLabAggregateReceiptEndpointFamilySchema = z.enum([
  'all-cause-mortality',
  'cardiometabolic-event',
  'cvd-event',
  'ehr-event-burden',
  'hospitalization-or-acute-event',
])
const murphAgeWearableLabAggregateReceiptIndexDateRuleSchema = z.enum([
  'baseline-exam-before-risk-window',
  'feature-window-end-before-risk-window',
])
const murphAgeWearableLabAggregateReceiptOutcomeAscertainmentSchema = z.enum([
  'adjudicated-event',
  'death-registry',
  'ehr-event',
  'registry-linked-event',
])
const murphAgeWearableLabAggregateReceiptNegativeControlFieldSchema = z.enum([
  'coverageOnlyBeatenByResidualWearable',
  'deviceOrEhrDensityDominates',
  'earlyEventSensitivityPassed',
  'reverseCausationWashoutPassed',
])
const murphAgeIncrementEvaluationOutputBoundarySchema = z.object({
  aggregateOnly: z.literal(true),
  coefficientsExportAllowed: z.literal(false),
  localArtifactPathExportAllowed: z.literal(false),
  modelParametersExportAllowed: z.literal(false),
  participantIdentifiersExportAllowed: z.literal(false),
  participantLevelExportAllowed: z.literal(false),
  predictionsExportAllowed: z.literal(false),
  productDisplayExportAllowed: z.literal(false),
  rowValuesExportAllowed: z.literal(false),
  sourceTextExportAllowed: z.literal(false),
  splitMembershipExportAllowed: z.literal(false),
})
const murphAgeWearableLabAggregateReceiptTemplateSchema = z.object({
  denominator: z.object({
    minimumEventCountForScienceDelta: z.literal(100),
    optionalFields: z.array(z.literal('personYears')),
    requiredFields: z.array(z.enum([
      'evaluatedRowCount',
      'eventCount',
      'minimumCellCount',
      'suppressedCellCount',
    ])),
    smallCellSuppressionRequired: z.literal(true),
  }),
  endpoint: z.object({
    acceptedEndpointFamilies: z.array(murphAgeWearableLabAggregateReceiptEndpointFamilySchema),
    acceptedIndexDateRules: z.array(murphAgeWearableLabAggregateReceiptIndexDateRuleSchema),
    acceptedOutcomeAscertainments: z.array(murphAgeWearableLabAggregateReceiptOutcomeAscertainmentSchema),
    endpointFrozenBeforeScoringRequired: z.literal(true),
    outcomeLinkedRequired: z.literal(true),
  }),
  evaluatorFrozenBeforeExecutionRequired: z.literal(true),
  evidenceTierOptions: z.array(z.enum([
    'external-validation',
    'internal-diagnostic',
    'partner-aggregate',
    'same-family-sanity',
  ])),
  metricFields: z.array(murphAgeWearableLabAggregateReceiptMetricFieldSchema),
  modelIds: z.array(murphAgeWearableLabAggregateReceiptModelIdSchema),
  negativeControlFields: z.array(murphAgeWearableLabAggregateReceiptNegativeControlFieldSchema),
  productAuthorized: z.literal(false),
  receiptSchemaVersion: z.literal(MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION),
  sameDenominatorRequired: z.literal(true),
  schemaVersion: z.literal(MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  sourceRouteAliases: z.array(z.string().min(1)),
  sourceRouteId: z.string().min(1),
})
const murphAgeWearableActivityBenchmarkCardSchema = z.object({
  acceptedAggregateMetricDeltaFields: z.array(z.string().min(1)),
  accelerometryProtocol: z.enum([
    'nhanes-2003-2006-hip-am7164-waking-7d',
    'nhanes-2011-2014-wrist-gt3x-plus-24h-7d',
  ]),
  architecturePattern: z.literal('anchor-plus-wearable-residual-shadow'),
  benchmarkId: z.enum([
    'nhanes_2003_06_hip_activity_lmf_v1',
    'nhanes_2011_14_wrist_activity_lmf_v1',
  ]),
  benchmarkStatus: z.literal('locked-card-ready-for-local-adapter'),
  denominatorPolicy: z.object({
    adultAgeRangeYears: z.object({
      max: z.number().int().positive(),
      min: z.number().int().positive(),
    }),
    eligibleLinkedMortalityRequired: z.literal(true),
    labBodyAnchorDenominatorRequired: z.literal(true),
    objectiveActivityWindowRequired: z.literal(true),
    publicUseRowsOnly: z.literal(true),
    sameDenominatorRequired: z.literal(true),
  }),
  endpoint: z.object({
    endpointFamily: z.string().min(1),
    endpointFrozenBeforeScoring: z.literal(true),
    horizonYears: z.number().positive().nullable(),
    indexDateRule: z.string().min(1),
    outcomeAscertainment: z.string().min(1),
    outcomeLinked: z.literal(true),
    washoutDays: z.number().int().nonnegative(),
  }),
  evidenceClass: z.literal('public-same-family-shadow-benchmark'),
  evidenceTierIfExecuted: z.string().min(1),
  featureFamilies: z.array(z.string().min(1)),
  measurementMethod: z.literal('research-actigraphy'),
  modelLadder: z.array(z.object({
    modelId: z.string().min(1),
    required: z.literal(true),
    role: z.string().min(1),
  })),
  negativeControlPolicy: z.object({
    coverageOnlyControlRequired: z.literal(true),
    earlyEventWashoutRequired: z.literal(true),
    reverseCausationSensitivityRequired: z.literal(true),
    shuffledWithinAgeSexBinsRequired: z.literal(true),
  }),
  outputBoundary: murphAgeIncrementEvaluationOutputBoundarySchema,
  productAuthorized: z.literal(false),
  requiredAggregateSampleFields: z.array(z.string().min(1)),
  rowParsingAuthorized: z.literal(false),
  schemaVersion: z.literal('murph.age.wearable-activity-benchmark-card.v1'),
  scoreBearing: z.literal(false),
  scoreContributionAuthorized: z.literal(false),
  selectionPolicy: z.object({
    calibrationFirst: z.literal(true),
    discriminationOnlySelectionAllowed: z.literal(false),
    properScoresRequired: z.literal(true),
    sameDenominatorComparisonsRequired: z.literal(true),
    testSetMutationAuthorized: z.literal(false),
  }),
  sourceRouteId: z.literal('nhanes-activity-shadow-lmf'),
  splitPolicy: z.object({
    aggregateSplitCountsExportOnly: z.literal(true),
    frozenBeforeScoring: z.literal(true),
    participantIdsExportAllowed: z.literal(false),
    splitMembershipExportAllowed: z.literal(false),
  }),
  transformIds: z.array(z.string().min(1)),
})
const murphAgeNsrrDatasetRequestSchema = z.object({
  datasetId: z.enum([
    'haassa',
    'hchs-sol',
    'mesa-sleep',
    'mros-sleep',
    'shhs',
    'sof-sleep',
    'wsc',
  ]),
  displayName: z.string().min(1),
  includeInLeanRequest: z.boolean(),
  modelUnblockerRoles: z.array(z.string().min(1)),
  nextLocalCheckCommand: z.string().min(1),
  productAuthorized: z.literal(false),
  recommendedDownloadTargets: z.array(z.string().min(1)),
  requestCheckboxLabel: z.string().min(1),
  requestPriorityRank: z.number().int().positive(),
  requestTier: z.enum(['bonus', 'lean-first-five', 'primary']),
  rowParsingAuthorized: z.literal(false),
  schemaVersion: z.literal(MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION),
  sourceRouteId: murphAgeSourceRouteIdSchema,
  whyRequest: z.string().min(1),
})
export const murphAgeAggregateEvidenceStatusResultSchema = z.object({
  assessments: z.array(murphAgeAggregateEvidenceAssessmentSchema),
  benchmarkCards: z.array(murphAgeWearableActivityBenchmarkCardSchema),
  inputCardCount: z.number().int().nonnegative(),
  missingSourceRouteIds: z.array(z.string().min(1)),
  nextExecutionSourceRouteIds: z.array(z.string().min(1)),
  nextMissingSourceRouteIds: z.array(z.string().min(1)),
  nsrrDatasetRequests: z.array(murphAgeNsrrDatasetRequestSchema),
  readyCardCount: z.number().int().nonnegative(),
  readySourceRouteIds: z.array(z.string().min(1)),
  receiptSlots: z.array(murphAgeWearableLabAggregateReceiptTemplateSchema),
  routeSlots: z.array(murphAgeAggregateEvidenceRouteSlotSchema),
  sourceRouteIdsByExecutionPriority: z.array(z.string().min(1)),
  schemaVersion: z.literal('murph.age.aggregate-evidence-status.v5'),
  status: z.enum(['blocked', 'ready']),
})

const strictUtcTimestampSchema = isoTimestampSchema
  .refine((value) => value.endsWith('Z'), 'Expected a UTC timestamp ending in Z.')
const murphAgeReportCardIdSchema = z.enum([
  'l1_tiny_glycemia_10y_acm_research',
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
  wearableResidualParameterPack: murphAgeWearableResidualParameterPackSchema.optional(),
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

  age.command('calculate-bundle', {
    description:
      'Return the product-safe Murph Age calculator bundle with an optional explicit research preview.',
    args: emptyArgsSchema,
    options: z.object({
      input: inputFileOptionSchema.describe('Submitted Murph Age payload in @file.json form or - for stdin.'),
      includeResearchPreview: z.boolean()
        .default(false)
        .describe('Include the internal research-only age/risk preview alongside the product-safe calculator view.'),
      modelCardArtifactRoot: murphAgeModelCardArtifactRootSchema.optional(),
    }),
    examples: [
      {
        description:
          'Return the product-safe calculator bundle. Current research-only cards remain withheld from product display.',
        options: {
          input: '@murph-age-preview.json',
        },
      },
      {
        description:
          'Return the product-safe view plus an explicit local research preview for model development.',
        options: {
          includeResearchPreview: true,
          input: '@murph-age-preview.json',
          modelCardArtifactRoot: './.runtime/operations/murph-age/model-cards',
        },
      },
    ],
    hint:
      'Use this as the stable submitted-data integration boundary. The product view stays safe-by-default; researchPreview is explicit and not user-facing.',
    output: murphAgeSubmittedCalculatorViewBundleResultSchema,
    async run({ options }) {
      return loadMurphAgeSubmittedCalculatorViewBundle(options)
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
        schemaVersion: 'murph.age.input-readiness.v6' as const,
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
      includeBenchmarkCards: z.boolean()
        .default(false)
        .describe('Include locked aggregate-only public benchmark cards for local evaluator setup.'),
      includeNsrrRequests: z.boolean()
        .default(false)
        .describe('Include the safe NSRR dataset-request checklist needed to unblock wearable/sleep validation.'),
    }),
    examples: [
      {
        description:
          'Show the current aggregate receipt slots without providing any receipt cards.',
        options: {
          includeBenchmarkCards: true,
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
      const assessmentCandidates = candidates.map(normalizeMurphAgeAggregateEvidenceCandidateCard)
      const ordinaryRouteIds = new Set(
        listMurphAgeOrdinaryLabWearableSourceRoutes().map((route) => route.routeId),
      )
      const routeSlotTemplateKeys = new Set(
        listMurphAgeOrdinaryLabWearableAggregateEvidenceTemplates()
          .map((template) => buildMurphAgeAggregateEvidenceRouteSlotKey(template))
          .filter((key) => key !== null),
      )
      const assessments = assessmentCandidates.map((candidate) => {
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
      const sourceRouteIdsByExecutionPriority = listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority()
        .map((route) => route.routeId)
      const missingSourceRouteIds = listMurphAgeOrdinaryLabWearableSourceRoutes()
        .map((route) => route.routeId)
        .filter((routeId) => !readyRouteIds.has(routeId))
      const nextExecutionSourceRouteIds = sourceRouteIdsByExecutionPriority
        .filter((routeId) => !readyRouteIds.has(routeId))
        .slice(0, 3)
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
      const receiptSlots = options.includeTemplates
        ? listMurphAgeWearableLabAggregateReceiptTemplates()
          .map(({ artifactBoundary: _artifactBoundary, ...template }) => template)
        : []
      const benchmarkCards = options.includeBenchmarkCards
        ? listMurphAgeWearableActivityBenchmarkCards()
        : []
      const nsrrDatasetRequests = options.includeNsrrRequests
        ? listMurphAgeNsrrDatasetRequests()
        : []

      return {
        assessments,
        benchmarkCards,
        inputCardCount: candidates.length,
        missingSourceRouteIds,
        nextExecutionSourceRouteIds,
        nextMissingSourceRouteIds: missingSourceRouteIds.slice(0, 3),
        nsrrDatasetRequests,
        readyCardCount: assessments.filter((assessment) => assessment.status === 'ready').length,
        readySourceRouteIds: listMurphAgeOrdinaryLabWearableSourceRoutes()
          .map((route) => route.routeId)
          .filter((routeId) => readyRouteIds.has(routeId)),
        receiptSlots,
        routeSlots,
        sourceRouteIdsByExecutionPriority,
        schemaVersion: 'murph.age.aggregate-evidence-status.v5' as const,
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
      { metricKey: 'albumin', unit: 'g/dL', value: 4.3 },
      { metricKey: 'creatinine', unit: 'mg/dL', value: 0.82 },
      { metricKey: 'alkaline-phosphatase', unit: 'U/L', value: 70 },
      { metricKey: 'white-blood-cell-count', unit: '10^3/uL', value: 5.8 },
      { metricKey: 'lymphocyte-percentage', unit: 'percent', value: 32 },
      { metricKey: 'red-cell-distribution-width', unit: 'percent', value: 12.8 },
      { metricKey: 'systolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 118 },
      { metricKey: 'diastolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 72 },
      { metricKey: 'body_mass_index', sourceKind: 'measurement', unit: 'kg/m2', value: 23.2 },
      { metricKey: 'waist-circumference', sourceKind: 'measurement', unit: 'cm', value: 78 },
      { metricKey: 'steps', sourceKind: 'wearable-summary', unit: 'count', value: 9800 },
      { metricKey: 'activity-minutes', sourceKind: 'wearable-summary', unit: 'minutes', value: 62 },
      { metricKey: 'mvpa-minutes', sourceKind: 'wearable-summary', unit: 'minutes', value: 38 },
      { metricKey: 'peak-30-minute-cadence', sourceKind: 'wearable-summary', unit: 'steps/min', value: 92 },
      { metricKey: 'sedentary-minutes', sourceKind: 'wearable-summary', unit: 'minutes', value: 510 },
      { metricKey: 'total-sleep-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 430 },
      { metricKey: 'deep-sleep-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 82 },
      { metricKey: 'rem-sleep-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 96 },
      { metricKey: 'sleep-duration-variability-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 42 },
      { metricKey: 'sleep-efficiency', sourceKind: 'sleep-summary', unit: 'percent', value: 88 },
      { metricKey: 'sleep-regularity-score', sourceKind: 'sleep-summary', unit: 'score', value: 84 },
      { metricKey: 'sleep-score', sourceKind: 'sleep-summary', unit: 'score', value: 82 },
      { metricKey: 'sleep-midpoint-variability-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 36 },
      { metricKey: 'spo2', sourceKind: 'sleep-summary', unit: 'percent', value: 97 },
      { metricKey: 'respiratory-rate', sourceKind: 'sleep-summary', unit: 'breaths/min', value: 14.2 },
      { metricKey: 'resting-heart-rate', sourceKind: 'wearable-summary', unit: 'bpm', value: 58 },
      { metricKey: 'hrv-rmssd', sourceKind: 'wearable-summary', unit: 'ms', value: 55 },
      { metricKey: 'readiness-score', sourceKind: 'wearable-summary', unit: 'score', value: 78 },
      { metricKey: 'skin-temperature-deviation', sourceKind: 'wearable-summary', unit: 'degC', value: 0.1 },
      { metricKey: 'estimated-vo2-max', sourceKind: 'wearable-summary', unit: 'mL/kg/min', value: 45 },
      { metricKey: 'wearable_valid_day_count_28d', sourceKind: 'wearable-summary', unit: 'count', value: 24 },
      { metricKey: 'wearable_valid_night_count_28d', sourceKind: 'sleep-summary', unit: 'count', value: 23 },
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
      ...toMurphAgePublicWarnings(loaded.warnings),
      ...report.warnings,
    ],
  }
}

async function loadMurphAgeSubmittedCalculatorViewBundle(
  options: MurphAgeSubmittedPreviewOptions & { includeResearchPreview: boolean },
): Promise<MurphAgeSubmittedCalculatorViewBundle> {
  const payload = murphAgeSubmittedPreviewPayloadSchema.parse(
    await loadJsonInputObject(options.input, 'Murph Age submitted calculator payload'),
  )
  const {
    modelCardArtifactRoot: payloadModelCardArtifactRoot,
    ...calculatorPayload
  } = payload
  const shouldLoadModelCards = options.includeResearchPreview || options.modelCardArtifactRoot !== undefined
  const loaded = shouldLoadModelCards
    ? await loadMurphAgeLocalModelCardArtifacts({
        modelCardArtifactRoot: options.modelCardArtifactRoot ?? payloadModelCardArtifactRoot,
      })
    : { models: {}, warnings: [] }
  const bundle = buildMurphAgeSubmittedCalculatorViewBundle({
    ...calculatorPayload,
    models: loaded.models,
  }, {
    includeResearchPreview: options.includeResearchPreview,
  })
  const loadWarnings = toMurphAgePublicWarnings(loaded.warnings)
  if (loadWarnings.length === 0) return bundle
  return {
    ...bundle,
    product: {
      report: {
        ...bundle.product.report,
        warnings: [
          ...loadWarnings,
          ...bundle.product.report.warnings,
        ],
      },
      view: {
        ...bundle.product.view,
        warnings: [
          ...loadWarnings,
          ...bundle.product.view.warnings,
        ],
      },
    },
    researchPreview: bundle.researchPreview === null
      ? null
      : {
          report: {
            ...bundle.researchPreview.report,
            warnings: [
              ...loadWarnings,
              ...bundle.researchPreview.report.warnings,
            ],
          },
          view: {
            ...bundle.researchPreview.view,
            warnings: [
              ...loadWarnings,
              ...bundle.researchPreview.view.warnings,
            ],
          },
        },
  }
}

function toMurphAgePublicWarnings(
  warnings: ReadonlyArray<{
    code: z.infer<typeof murphAgeWarningCodeSchema>
    featureKey?: string
    metricKey?: string
  }>,
): Array<z.infer<typeof murphAgePublicWarningSchema>> {
  return warnings.map((warning) => {
    const publicWarning: z.infer<typeof murphAgePublicWarningSchema> = {
      code: warning.code,
    }
    if (warning.featureKey && isMurphAgePublicFeatureKey(warning.featureKey)) {
      publicWarning.featureKey = warning.featureKey
    }
    if (warning.metricKey && isMurphAgePublicMetricKey(warning.metricKey)) {
      publicWarning.metricKey = warning.metricKey
    }
    return publicWarning
  })
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

function normalizeMurphAgeAggregateEvidenceCandidateCard(candidate: unknown): unknown {
  return buildMurphAgeWearableIncrementEvaluationCardFromAggregateReceipt(candidate) ?? candidate
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
