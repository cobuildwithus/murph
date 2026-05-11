import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { isoTimestampSchema } from '@murphai/operator-config/vault-cli-contracts'
import { calculateMurphAgePublicReportFromVaultInputBundle } from '@murphai/query'
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
  'lab5_bp_bmi_transport_research',
  'lab9_bp_body_10y_acm_research',
  'wearable_context_no_risk',
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

const murphAgePublicWarningSchema = z.object({
  code: murphAgeWarningCodeSchema,
  featureKey: z.string().min(1).optional(),
  metricKey: z.string().min(1).optional(),
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
  status: z.enum(['blocked', 'missing', 'ready']),
  warnings: z.array(murphAgePublicWarningSchema),
})

const murphAgePublicModuleAttributionSchema = z.object({
  contributionYears: z.number().nullable(),
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
  productAgeDisplayReady: z.boolean(),
  productRiskDisplayReady: z.boolean(),
  researchEstimateAvailable: z.boolean(),
  schemaVersion: z.literal('murph.age.public-display-summary.v2'),
  selectedScoreBearingFeatureKeys: z.array(z.string().min(1)),
  selectedScoreBearingMetricKeys: z.array(z.string().min(1)),
  wearableBridge: murphAgePublicWearableBridgeSummarySchema,
  wearableContext: murphAgePublicWearableContextSummarySchema,
})

export const murphAgeReportResultSchema = z.object({
  authorization: murphAgePublicAuthorizationSchema,
  displaySummary: murphAgePublicDisplaySummarySchema,
  mode: murphAgeModeSchema,
  result: murphAgePublicResultSchema.nullable(),
  schemaVersion: z.literal('murph.age.public-calculator-report.v1'),
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

  cli.command(age)
}
