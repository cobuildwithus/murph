import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { isoTimestampSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  assessMurphAgeInputReadinessFromVault,
  calculateMurphAgePublicReportFromVaultInputBundle,
  loadMurphAgeLocalModelCardArtifacts,
} from '@murphai/query'
import {
  isMurphAgePublicFeatureKey,
  isMurphAgePublicMetricKey,
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  listMurphAgeModelCardPolicies,
  listMurphAgeModelCardProductPromotionBlockers,
  MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT,
} from '@murphai/health-metrics'
import type { VaultServices } from '@murphai/vault-usecases'
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
  'wearable_context_no_risk',
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
const murphAgeInputScoreReadinessStatusSchema = z.enum([
  'context-only',
  'input-incomplete',
  'product-age-ready',
  'product-risk-ready',
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
  productAgeReady: z.boolean(),
  productBlockedReasons: z.array(murphAgeInputProductBlockedReasonSchema),
  productPromotionBlockers: z.array(murphAgeProductPromotionBlockerSchema),
  productRiskReady: z.boolean(),
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
  status: z.enum(['blocked', 'missing', 'ready']),
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

export const murphAgeInputReadinessResultSchema = z.object({
  bundle: murphAgeInputBundleReadinessSchema,
  contextBundles: z.array(murphAgeInputBundleReadinessSchema),
  runtimeInputs: z.array(murphAgeRuntimeInputReadinessSchema),
  schemaVersion: z.literal('murph.age.input-readiness.v4'),
  scoreReadiness: murphAgeInputScoreReadinessSchema,
  wearableBridge: murphAgePublicWearableBridgeSummarySchema,
})

const murphAgePublicDisplaySummarySchema = z.object({
  ageEstimateAvailable: z.boolean(),
  blockedFeatureKeys: z.array(z.string().min(1)),
  contextOnlyFeatureKeys: z.array(z.string().min(1)),
  contextOnlyMetricKeys: z.array(z.string().min(1)),
  displayBlockedReason: z.enum([
    'age-estimate-unavailable',
    'context-only',
    'policy-violation',
    'product-not-authorized',
    'risk-estimate-unavailable',
    'risk-to-age-not-authorized',
  ]).nullable(),
  displayStatus: z.enum([
    'abstain',
    'context-only',
    'product-age-ready',
    'product-risk-only',
    'research-only',
  ]),
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
  result: murphAgePublicResultSchema.nullable(),
  schemaVersion: z.literal('murph.age.public-calculator-report.v3'),
  status: murphAgeInputBundleStatusSchema,
  warnings: z.array(murphAgePublicWarningSchema),
})

const strictUtcTimestampSchema = isoTimestampSchema
  .refine((value) => value.endsWith('Z'), 'Expected a UTC timestamp ending in Z.')

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
        chronologicalAgeYears: options.chronologicalAgeYears,
        mode: options.mode,
        sex: options.sex,
        vaultRoot: options.vault,
      })
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

      return assessMurphAgeInputReadinessFromVault({
        asOf: options.asOf,
        vaultRoot: options.vault,
      })
    },
  })

  age.command('model-cards', {
    description:
      'Return metadata-only readiness status for local Murph Age model-card artifacts and current policy blockers.',
    args: emptyArgsSchema,
    options: withBaseOptions({}),
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

  cli.command(age)
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
