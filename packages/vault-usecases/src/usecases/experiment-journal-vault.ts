import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  EXPERIMENT_STATUSES,
  ID_PREFIXES,
  VAULT_LAYOUT,
  eventSourceSchema,
  experimentAnalysisPlanSchema,
  experimentAssistantSupportSchema,
  experimentExpectedDirectionsSchema,
  experimentPrimaryOutcomeSchema,
  effectiveProtocolSnapshotSchema,
  experimentOutcomeSchema,
  experimentFrontmatterSchema,
  experimentOnboardingCaptureSchema,
  commonsProtocolRefSchema,
  experimentRunLoggingSchema,
  experimentRunPlanSchema,
  experimentRunScheduleIntentSchema,
  healthCommonsKeySchema,
  jsonObjectSchema,
  protocolRefSchema,
  safeParseContract,
  type ExperimentOutcomeStatistic,
  type ExperimentPrimaryOutcome,
  type HealthCommonsBiomarkerDesiredDirection,
  type HealthCommonsExperimentOnboardingPositiveDisposition,
  type ExperimentFrontmatter,
  type ExperimentRunScheduleIntent,
} from '@murphai/contracts'
import {
  deterministicContractId,
  findEventByExternalRef,
  toMonthlyShardRelativePath,
  withCanonicalWriteLock,
} from '@murphai/core'
import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantOutboxIntentIdSchema,
  assistantOutboxIntentSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isoTimestampSchema,
  localDateSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  assessExperimentPrimaryMetricCapture,
  isRegisteredExperimentMetricSource,
  resolveExperimentMetricIdentity,
  resolveExperimentPrimaryOutcome,
  resolveExperimentAdherenceTargets,
  resolveExperimentSessionMetricSpec,
  summarizeExperimentOutcomeEvidencePlan,
  validateExperimentSessionMetricValue,
} from '@murphai/query'
import { resolveAssistantStatePaths } from '@murphai/runtime-state/node'
import {
  loadQueryRuntime,
  type QueryCanonicalEntity,
  type QueryMetricPointFilters,
  type QueryRuntimeModule,
} from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import {
  asListEnvelope,
  readJsonPayload,
  toListEntity,
} from './shared.js'
import {
  compactObject,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  toVaultCliError,
  toVaultMetadataCliError,
  stringArray,
  uniqueStrings,
} from './vault-usecase-helpers.js'
import {
  normalizeExperimentMeasurementAnchorFlagOption,
  normalizeExperimentPlannedMeasurementFlagOption,
} from '../option-utils.js'
import {
  buildExperimentAssistantSupportFromOptions,
  buildExperimentOnboardingCaptureFromOptions,
  normalizeRequiredTextOption,
  normalizeStableIdListOption,
  normalizeStableIdOption,
  normalizeTextListOption,
  type ExperimentAssistantSupportOptions,
  type ExperimentOnboardingCaptureOptions,
} from '../experiment-onboarding-options.js'
import { upsertEventRecord } from './provider-event.js'
import {
  assertExperimentMatchesIntervention,
  attachInterventionSessionToExperiment,
  detachInterventionSessionFromExperiment,
} from './intervention-experiment-link.js'
import type { JsonObject } from '../health-cli-method-types.js'

type EntityFamily = 'experiment' | 'journal'
type JournalLinkKind = 'eventIds' | 'sampleStreams'
type JournalLinkOperation = 'link' | 'unlink'
type JournalLinkRuntimeInput = {
  vaultRoot: string
  date: string
  values: string[]
}
type JournalLinkRuntimeResult = {
  relativePath: string
  created: boolean
  changed: number
  eventIds: string[]
  sampleStreams: string[]
}
type JournalLinkRuntimeAction =
  | 'linkJournalEventIds'
  | 'unlinkJournalEventIds'
  | 'linkJournalStreams'
  | 'unlinkJournalStreams'

interface ExperimentJournalVaultCoreRuntime {
  withCanonicalWriteLock<TResult>(
    vaultRoot: string | undefined,
    run: () => Promise<TResult>,
  ): Promise<TResult>
  createExperiment(input: {
    vaultRoot: string
    slug: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: ExperimentStatusValue
    body?: string
    tags?: string[]
    commonsProtocolRef?: z.infer<typeof experimentFrontmatterSchema>['commonsProtocolRef']
    protocolRef?: z.infer<typeof experimentFrontmatterSchema>['protocolRef']
    effectiveProtocolSnapshot?: z.infer<typeof experimentFrontmatterSchema>['effectiveProtocolSnapshot']
    runPlan?: z.infer<typeof experimentFrontmatterSchema>['runPlan']
    analysisPlan?: z.infer<typeof experimentFrontmatterSchema>['analysisPlan']
    onboarding?: z.infer<typeof experimentFrontmatterSchema>['onboarding']
    assistantSupport?: z.infer<typeof experimentFrontmatterSchema>['assistantSupport']
  }): Promise<{
    created?: boolean
    experiment: {
      id: string
      slug: string
      relativePath: string
    }
  }>
  readExperimentLifecycleFrontmatterDocuments(input: {
    vaultRoot: string
    shouldYield?: (() => boolean) | null
  }): Promise<{
    items: Array<z.infer<typeof experimentFrontmatterSchema>>
    yielded: boolean
  }>
  updateExperiment(input: {
    vaultRoot: string
    relativePath: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: ExperimentStatusValue
    body?: string
    tags?: string[]
    commonsProtocolRef?: z.infer<typeof experimentFrontmatterSchema>['commonsProtocolRef'] | null
    protocolRef?: z.infer<typeof experimentFrontmatterSchema>['protocolRef'] | null
    effectiveProtocolSnapshot?: z.infer<typeof experimentFrontmatterSchema>['effectiveProtocolSnapshot'] | null
    runPlan?: z.infer<typeof experimentFrontmatterSchema>['runPlan'] | null
    analysisPlan?: z.infer<typeof experimentFrontmatterSchema>['analysisPlan'] | null
    onboarding?: z.infer<typeof experimentFrontmatterSchema>['onboarding'] | null
    assistantSupport?: z.infer<typeof experimentFrontmatterSchema>['assistantSupport'] | null
    outcome?: z.infer<typeof experimentFrontmatterSchema>['outcome'] | null
    outcomeRef?: z.infer<typeof experimentFrontmatterSchema>['outcomeRef'] | null
    expectedDocumentSha256?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    updated: true
  }>
  upsertProtocol(input: {
    vaultRoot: string
    protocolId?: string
    slug?: string
    allowSlugRename?: boolean
    title?: string
    frontmatter?: JsonObject
    body?: string
  }): Promise<{
    created: boolean
    record: {
      entity: {
        protocolId: string
        slug: string
        title: string
        effectiveSpecHash: string
        protocolRevisionId: string
        effectiveSpec: {
          doseSignature: string
          modality?: string
          activitySessionEvidence?: z.infer<
            typeof effectiveProtocolSnapshotSchema
          >['activitySessionEvidence']
          frequency?: z.infer<typeof effectiveProtocolSnapshotSchema>['frequency']
          durationMinutes?: z.infer<typeof effectiveProtocolSnapshotSchema>['durationMinutes']
          temperatureC?: z.infer<typeof effectiveProtocolSnapshotSchema>['temperatureC']
          targetSessions?: number
          minimumUsefulSessions?: number
          stopConditions?: string[]
        }
      }
      document: {
        relativePath: string
      }
    }
  }>
  checkpointExperiment(input: {
    vaultRoot: string
    relativePath: string
    occurredAt?: string
    title: string
    note?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    eventId: string
    ledgerFile: string
    updated: true
  }>
  stopExperiment(input: {
    vaultRoot: string
    relativePath: string
    occurredAt?: string
    title: string
    note?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    eventId: string
    ledgerFile: string
    updated: true
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date?: string
  }): Promise<{
    created: boolean
    relativePath: string
  }>
  appendJournal(input: {
    vaultRoot: string
    date: string
    text: string
  }): Promise<{
    relativePath: string
    created: boolean
    updated: true
  }>
  linkJournalEventIds(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  unlinkJournalEventIds(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  linkJournalStreams(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  unlinkJournalStreams(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  updateVaultSummary(input: {
    vaultRoot: string
    title?: string
    timezone?: string
  }): Promise<{
    metadataFile: string
    corePath: string
    title: string
    timezone: string
    updatedAt: string
    updated: true
  }>
  readReferencedExperimentOutcome(input: {
    vaultRoot: string
    relativePath: string
    expectedFrontmatter: z.infer<typeof experimentFrontmatterSchema>
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    outcome: z.infer<typeof experimentOutcomeSchema>
    outcomePath: string
    updatedExperiment: false
  } | null>
  shouldAdvanceReferencedExperimentOutcome(input: {
    frontmatter: ExperimentFrontmatter
    referencedOutcome: z.infer<typeof experimentOutcomeSchema>
    requestedAsOf: string
  }): boolean
  writeExperimentOutcome(input: {
    vaultRoot: string
    relativePath: string
    expectedFrontmatter: z.infer<typeof experimentFrontmatterSchema>
    outcome: z.infer<typeof experimentOutcomeSchema>
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    outcome: z.infer<typeof experimentOutcomeSchema>
    outcomePath: string
    updatedExperiment: boolean
  }>
}

const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)
type ExperimentStatusValue = z.infer<typeof experimentStatusSchema>
const experimentSignalDirectionSchema = z.enum(['increase', 'decrease', 'stabilize'])
type ExperimentFrontmatterValue = z.infer<typeof experimentFrontmatterSchema>
type CommonsProtocolRefValue = z.infer<typeof commonsProtocolRefSchema>
type ExperimentRunLoggingValue = z.infer<typeof experimentRunLoggingSchema>
type ExperimentRunPlanValue = z.infer<typeof experimentRunPlanSchema>
type ExperimentAnalysisPlanValue = z.infer<typeof experimentAnalysisPlanSchema>
const EXPERIMENT_OUTCOME_WRITE_MAX_ATTEMPTS = 3
type HealthCommonsProtocolActivationRecord = {
  key: string
  revision: {
    pageRevisionId: string
    runSpecRevisionId: string
  }
  experimentOnboarding?: {
    safetyScreen?: {
      dispositionIfAnyPositive: HealthCommonsExperimentOnboardingPositiveDisposition
      mustAsk: Array<{
        id: string
        ifPositive?: HealthCommonsExperimentOnboardingPositiveDisposition
        ifNegative?: HealthCommonsExperimentOnboardingPositiveDisposition
      }>
    }
  }
}
type HealthCommonsProtocolActivationRuntime = {
  getGeneratedHealthCommonsProtocolRunSpecReader(): {
    findByLookup(lookup: string): HealthCommonsProtocolActivationRecord | null
  }
}

const healthCommonsSafetyDispositionRank: Record<
  HealthCommonsExperimentOnboardingPositiveDisposition,
  number
> = {
  continue_with_caution: 0,
  clinician_guidance_before_unsupervised_start: 1,
  do_not_start_unsupervised: 2,
  do_not_start_unsupervised_explicit_clinician_clearance_required: 3,
}

const experimentSelectorPayloadSchema = z
  .object({
    lookup: z.string().min(1).optional(),
    experimentId: z.string().min(1).optional(),
    slug: slugSchema.optional(),
  })
  .refine(
    (value) =>
      typeof value.lookup === 'string' ||
      typeof value.experimentId === 'string' ||
      typeof value.slug === 'string',
    'Expected one of lookup, experimentId, or slug.',
  )

export interface ApplyExperimentOnboardingRecordInput
  extends ExperimentOnboardingCaptureOptions,
    ExperimentAssistantSupportOptions {
  vault: string
  lookup: string
  status?: ExperimentStatusValue
  protocolKey?: string
  pageRevisionId?: string
  runSpecRevisionId?: string
  testPlanId?: string
  baselineStart?: string
  baselineEnd?: string
  baselineDays?: number
  interventionStart?: string
  interventionEnd?: string
  interventionDays?: number
  modality?: string
  schedule?: ExperimentRunScheduleIntent
  scheduleInputFile?: string
  scheduleKind?: ExperimentRunScheduleIntent['kind']
  scheduleCron?: string
  scheduleLocalTime?: string
  scheduleTimeZone?: string
  dose?: string
  sessionsPerWeek?: number
  targetSessions?: number
  minimumUsefulSessions?: number
  sessionField?: readonly string[]
  confounderField?: readonly string[]
  stopCondition?: readonly string[]
  primaryBiomarkerKey?: string
  primaryOutcomeKey?: string
  primaryOutcomeKind?: ExperimentPrimaryOutcome['kind']
  primaryOutcomeLabel?: string
  primaryOutcomeSessionField?: string
  primaryOutcomeSourceMetricKey?: string
  primaryOutcomeUnit?: string
  comparisonStatistic?: ExperimentOutcomeStatistic
  secondaryBiomarkerKey?: readonly string[]
  desiredDirection?: z.infer<typeof experimentSignalDirectionSchema>
  expectedDirection?: readonly string[]
  analysisAnchor?: readonly string[]
  plannedMeasurement?: readonly string[]
  analysisNote?: readonly string[]
}

const privateProtocolPlanInputSchema = z
  .object({
    protocolId: z.string().min(1).optional(),
    slug: slugSchema.optional(),
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    frontmatter: jsonObjectSchema.optional(),
  })
  .strict()

const privateProtocolRefInputSchema = protocolRefSchema

const experimentPlanDecisionSchema = z
  .object({
    materialAdaptation: z.boolean().optional(),
    needsPrivateProtocol: z.boolean().optional(),
    reasons: z.array(z.string().min(1)).optional(),
  })
  .strict()

const experimentPlanSourceSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('custom') }).strict(),
    z.object({ kind: z.literal('health_commons_protocol') }).strict(),
    z.object({ kind: z.literal('private_protocol') }).strict(),
  ])

const experimentPlanPayloadSchema = z
  .object({
    schemaVersion: z.literal('murph.experiment-plan.v1').optional(),
    planId: z.string().min(1).optional(),
    source: experimentPlanSourceSchema,
    experiment: z
      .object({
        slug: slugSchema,
        title: z.string().min(1).optional(),
        hypothesis: z.string().min(1).optional(),
        startedOn: localDateSchema.optional(),
        status: experimentStatusSchema.optional(),
        body: z.string().optional(),
      })
      .strict(),
    commonsProtocolRef: commonsProtocolRefSchema.optional(),
    protocol: privateProtocolPlanInputSchema.optional(),
    protocolRef: privateProtocolRefInputSchema.optional(),
    effectiveProtocolSnapshot: effectiveProtocolSnapshotSchema.optional(),
    runPlan: experimentRunPlanSchema.optional(),
    analysisPlan: experimentAnalysisPlanSchema.optional(),
    onboarding: experimentOnboardingCaptureSchema.optional(),
    assistantSupport: experimentAssistantSupportSchema.optional(),
    decision: experimentPlanDecisionSchema.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.source.kind === 'custom' &&
      (payload.commonsProtocolRef !== undefined ||
        payload.protocol !== undefined ||
        payload.protocolRef !== undefined ||
        payload.effectiveProtocolSnapshot !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom experiment plans must not include protocol references or protocol snapshots.',
        path: ['source', 'kind'],
      })
    }

    if (payload.source.kind === 'health_commons_protocol') {
      if (payload.commonsProtocolRef === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Health Commons protocol-backed experiment plans require commonsProtocolRef.',
          path: ['commonsProtocolRef'],
        })
      }
      if (payload.protocol !== undefined || payload.protocolRef !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Health Commons protocol-backed experiment plans must not include private protocol inputs.',
          path: ['source', 'kind'],
        })
      }
    }

    if (
      payload.source.kind === 'private_protocol' &&
      payload.protocol === undefined &&
      payload.protocolRef === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Private protocol-backed experiment plans require protocol or protocolRef.',
        path: ['source', 'kind'],
      })
    }

    if (
      payload.source.kind !== 'health_commons_protocol' &&
      payload.commonsProtocolRef !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'commonsProtocolRef is only valid for Health Commons protocol-backed experiment plans.',
        path: ['commonsProtocolRef'],
      })
    }

    if (payload.protocol !== undefined && payload.protocolRef !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use protocol to create/reuse a private protocol or protocolRef to reuse an existing private protocol, not both.',
        path: ['protocolRef'],
      })
    }

    if (payload.protocolRef !== undefined && payload.effectiveProtocolSnapshot === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Existing protocolRef plans require effectiveProtocolSnapshot.',
        path: ['effectiveProtocolSnapshot'],
      })
    }

    if (
      payload.protocolRef !== undefined &&
      payload.effectiveProtocolSnapshot !== undefined &&
      payload.protocolRef.effectiveSpecHash !== payload.effectiveProtocolSnapshot.effectiveSpecHash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'protocolRef.effectiveSpecHash must match effectiveProtocolSnapshot.effectiveSpecHash.',
        path: ['effectiveProtocolSnapshot', 'effectiveSpecHash'],
      })
    }

    if (
      payload.commonsProtocolRef !== undefined &&
      payload.protocol === undefined &&
      payload.protocolRef === undefined &&
      payload.effectiveProtocolSnapshot === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Health Commons protocol-backed plans require effectiveProtocolSnapshot.',
        path: ['effectiveProtocolSnapshot'],
      })
    }
  })

type ExperimentPlanPayload = z.infer<typeof experimentPlanPayloadSchema>

export interface PlanExperimentRecordInput {
  vault: string
  inputFile?: string
  payload?: JsonObject
}

export interface StartExperimentFromPlanInput extends PlanExperimentRecordInput {}

async function assertHealthCommonsProtocolStartAllowed(input: {
  source: ExperimentPlanPayload['source']
  status: ExperimentStatusValue
  commonsProtocolRef: CommonsProtocolRefValue | undefined
  onboarding: ExperimentFrontmatterValue['onboarding']
}) {
  if (input.source.kind !== 'health_commons_protocol') {
    return
  }

  if (!input.commonsProtocolRef) {
    throw new VaultCliError(
      'invalid_payload',
      'Health Commons protocol-backed experiment starts require an exact protocol reference.',
    )
  }

  const protocol = await resolveCurrentHealthCommonsProtocol(
    input.commonsProtocolRef,
    `Health Commons protocol ${input.commonsProtocolRef.key} is no longer available to start. Choose a currently runnable protocol instead.`,
  )
  if (input.status === 'active') {
    assertHealthCommonsProtocolSafetyAllowsActivation({
      protocol,
      onboarding: input.onboarding,
    })
  }
}

async function assertHealthCommonsProtocolActivationAllowed(input: {
  commonsProtocolRef: ExperimentFrontmatterValue['commonsProtocolRef']
  onboarding: ExperimentFrontmatterValue['onboarding']
}) {
  if (!input.commonsProtocolRef) {
    return
  }

  const protocol = await resolveCurrentHealthCommonsProtocol(
    input.commonsProtocolRef,
    `Health Commons protocol ${input.commonsProtocolRef.key} is no longer available to activate. This experiment remains unchanged. Start any currently runnable alternative as a new experiment; never replace this run's protocol lineage. Mark this run abandoned only after the member separately agrees.`,
  )
  assertHealthCommonsProtocolSafetyAllowsActivation({
    protocol,
    onboarding: input.onboarding,
  })
}

async function resolveCurrentHealthCommonsProtocol(
  reference: CommonsProtocolRefValue,
  unavailableMessage: string,
): Promise<HealthCommonsProtocolActivationRecord> {
  const protocol = await findCurrentHealthCommonsProtocol(reference)

  if (!protocol) {
    throw new VaultCliError('invalid_payload', unavailableMessage)
  }

  if (
    protocol.revision.pageRevisionId !== reference.pageRevisionId ||
    protocol.revision.runSpecRevisionId !== reference.runSpecRevisionId
  ) {
    throw new VaultCliError(
      'invalid_payload',
      `Health Commons protocol ${reference.key} changed after this plan was prepared. Refresh or reopen the protocol before starting this experiment.`,
      {
        expectedPageRevisionId: reference.pageRevisionId,
        expectedRunSpecRevisionId: reference.runSpecRevisionId,
        currentPageRevisionId: protocol.revision.pageRevisionId,
        currentRunSpecRevisionId: protocol.revision.runSpecRevisionId,
      },
    )
  }

  return protocol
}

async function findCurrentHealthCommonsProtocol(
  reference: CommonsProtocolRefValue,
): Promise<HealthCommonsProtocolActivationRecord | null> {
  const runtime = await loadRuntimeModule<HealthCommonsProtocolActivationRuntime>(
    '@murphai/health-commons/runtime',
  )
  return runtime
    .getGeneratedHealthCommonsProtocolRunSpecReader()
    .findByLookup(reference.key)
}

function assertHealthCommonsProtocolSafetyAllowsActivation(input: {
  protocol: HealthCommonsProtocolActivationRecord
  onboarding: ExperimentFrontmatterValue['onboarding']
}) {
  const safetyScreen = input.protocol.experimentOnboarding?.safetyScreen
  if (!safetyScreen) {
    return
  }

  if (!input.onboarding?.completedAt) {
    throw new VaultCliError(
      'invalid_payload',
      `Complete the safety screen for ${input.protocol.key} before activating this experiment. Keep the experiment planned until screening is complete.`,
    )
  }

  const questionsById = new Map(
    safetyScreen.mustAsk.map((question) => [question.id, question]),
  )
  const positiveQuestionIds = input.onboarding.safety?.positiveQuestionIds ?? []
  const positiveQuestionIdSet = new Set(positiveQuestionIds)
  let requiredDisposition: HealthCommonsExperimentOnboardingPositiveDisposition | undefined
  let hasPositiveDispositionTrigger = false

  for (const questionId of positiveQuestionIds) {
    if (!questionsById.has(questionId)) {
      throw new VaultCliError(
        'invalid_payload',
        `Safety-screen question ${questionId} does not belong to the current ${input.protocol.key} protocol revision. Refresh or reopen the protocol before starting this experiment.`,
      )
    }
  }

  for (const question of safetyScreen.mustAsk) {
    const answeredPositive = positiveQuestionIdSet.has(question.id)
    const questionDisposition = answeredPositive
      ? question.ifPositive ??
        (question.ifNegative === undefined
          ? safetyScreen.dispositionIfAnyPositive
          : undefined)
      : question.ifNegative
    if (questionDisposition === undefined) {
      continue
    }
    if (answeredPositive) {
      hasPositiveDispositionTrigger = true
    }
    if (
      requiredDisposition === undefined ||
      healthCommonsSafetyDispositionRank[questionDisposition] >
        healthCommonsSafetyDispositionRank[requiredDisposition]
    ) {
      requiredDisposition = questionDisposition
    }
  }

  const recordedDisposition = input.onboarding.safety?.disposition
  if (hasPositiveDispositionTrigger && recordedDisposition === undefined) {
    throw new VaultCliError(
      'invalid_payload',
      `Record the safety-screen disposition for ${input.protocol.key} before activating this experiment.`,
    )
  }

  const blockingDisposition = mostRestrictiveHealthCommonsSafetyDisposition(
    requiredDisposition,
    recordedDisposition,
  )
  if (blockingDisposition && blockingDisposition !== 'continue_with_caution') {
    throw new VaultCliError(
      'invalid_payload',
      `This ${input.protocol.key} safety screen requires ${blockingDisposition}; keep the experiment planned instead of activating an unsupervised run.`,
      { safetyDisposition: blockingDisposition },
    )
  }
}

function mostRestrictiveHealthCommonsSafetyDisposition(
  first: HealthCommonsExperimentOnboardingPositiveDisposition | undefined,
  second: HealthCommonsExperimentOnboardingPositiveDisposition | undefined,
): HealthCommonsExperimentOnboardingPositiveDisposition | undefined {
  if (first === undefined) {
    return second
  }
  if (second === undefined) {
    return first
  }

  return healthCommonsSafetyDispositionRank[first] >=
    healthCommonsSafetyDispositionRank[second]
    ? first
    : second
}

const experimentCheckpointPayloadSchema = experimentSelectorPayloadSchema.extend({
  occurredAt: isoTimestampSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
})
const experimentSessionPayloadSchema = z.object({
  reminderIntentId: assistantOutboxIntentIdSchema.optional(),
  date: localDateSchema.optional(),
  occurredAt: isoTimestampSchema.optional(),
  source: eventSourceSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().optional(),
  interventionType: z.string().min(1).optional(),
  status: z.enum(['completed', 'partial', 'missed', 'skipped']).optional(),
  sessionStatus: z.enum(['completed', 'partial', 'missed', 'skipped']).optional(),
  durationMinutes: z.number().int().positive().optional(),
  protocolId: z.string().min(1).optional(),
  timing: z.string().min(1).max(120).optional(),
  temperatureC: z.number().min(0).max(200).optional(),
  afterExercise: z.boolean().optional(),
  symptoms: z.array(z.string().min(1).max(160)).max(25).optional(),
  confounders: z.union([
    z.array(z.string().min(1)),
    z.record(z.string(), z.union([z.string().min(1), z.number(), z.boolean(), z.null()])),
  ]).optional(),
  fields: z.record(
    z.string().min(1),
    z.union([z.string().min(1).max(240), z.number(), z.boolean(), z.null()]),
  ).optional(),
})
const experimentSimpleContextPayloadSchema = z.object({
  occurredAt: isoTimestampSchema.optional(),
  source: eventSourceSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().optional(),
  contextType: z.string().min(1),
  severity: z.enum(['info', 'potential_confounder', 'safety', 'blocking']).optional(),
  tags: z.array(slugSchema).optional(),
})
const experimentContextPayloadSchema = z.union([
  experimentSimpleContextPayloadSchema,
  z.object({
    kind: z.literal('experiment_context'),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    title: z.string().min(1).optional(),
    note: z.string().optional(),
    contextType: z.string().min(1),
    severity: z.enum(['info', 'potential_confounder', 'safety', 'blocking']).optional(),
    tags: z.array(slugSchema).optional(),
  }),
  z.object({
    kind: z.literal('note'),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    title: z.string().min(1).optional(),
    note: z.string().min(1),
    tags: z.array(slugSchema).optional(),
  }),
  z.object({
    kind: z.literal('supplement_intake'),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    title: z.string().min(1).optional(),
    note: z.string().optional(),
    supplementName: z.string().min(1),
    dose: z.number().nonnegative(),
    unit: z.string().min(1),
    tags: z.array(slugSchema).optional(),
  }),
])
type ExperimentContextPayload = z.infer<typeof experimentContextPayloadSchema>
type ExperimentContextLogKind = 'experiment_context' | 'note' | 'supplement_intake'
type ExperimentContextSeverity = 'info' | 'potential_confounder' | 'safety' | 'blocking'
type ExperimentContextOptionKey =
  | 'contextType'
  | 'dose'
  | 'severity'
  | 'supplementName'
  | 'unit'
const JOURNAL_LINK_RUNTIME_ACTIONS: Record<
  JournalLinkKind,
  Record<JournalLinkOperation, JournalLinkRuntimeAction>
> = {
  eventIds: {
    link: 'linkJournalEventIds',
    unlink: 'unlinkJournalEventIds',
  },
  sampleStreams: {
    link: 'linkJournalStreams',
    unlink: 'unlinkJournalStreams',
  },
}

export async function createExperimentRecord(input: {
  vault: string
  slug: string
  title?: string
  hypothesis?: string
  startedOn?: string
  status?: ExperimentStatusValue
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const result = await core.createExperiment({
    vaultRoot: input.vault,
    slug: input.slug,
    title: normalizeOptionalText(input.title) ?? input.slug,
    hypothesis: normalizeOptionalText(input.hypothesis) ?? undefined,
    startedOn: input.startedOn,
    status: input.status ?? 'active',
  })

  return {
    vault: input.vault,
    experimentId: result.experiment.id,
    lookupId: result.experiment.id,
    slug: result.experiment.slug,
    experimentPath: result.experiment.relativePath,
    created: result.created ?? true,
  }
}

function privateProtocolFrontmatterTitle(
  frontmatter: Record<string, unknown> | undefined,
): string | undefined {
  const title = frontmatter?.title
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined
}

export function buildEffectiveProtocolSnapshotFromPrivateProtocol(
  profile: Awaited<ReturnType<ExperimentJournalVaultCoreRuntime['upsertProtocol']>>['record']['entity'],
): z.infer<typeof effectiveProtocolSnapshotSchema> {
  return effectiveProtocolSnapshotSchema.parse(compactObject({
    effectiveSpecHash: profile.effectiveSpecHash,
    doseSignature: profile.effectiveSpec.doseSignature,
    modality: profile.effectiveSpec.modality,
    activitySessionEvidence: profile.effectiveSpec.activitySessionEvidence,
    frequency: profile.effectiveSpec.frequency,
    durationMinutes: profile.effectiveSpec.durationMinutes,
    temperatureC: profile.effectiveSpec.temperatureC,
    targetSessions: profile.effectiveSpec.targetSessions,
    minimumUsefulSessions: profile.effectiveSpec.minimumUsefulSessions,
    stopConditions: profile.effectiveSpec.stopConditions,
  }))
}

async function readExperimentPlanPayload(inputFile: string): Promise<ExperimentPlanPayload> {
  return experimentPlanPayloadSchema.parse(
    await readJsonPayload(inputFile, 'experiment start payload'),
  )
}

async function resolveExperimentPlanPayload(
  input: PlanExperimentRecordInput,
): Promise<ExperimentPlanPayload> {
  if (input.inputFile !== undefined && input.payload !== undefined) {
    throw new VaultCliError(
      'invalid_payload',
      'Experiment start accepts either an internal payload object or an input file, not both.',
    )
  }

  if (input.payload !== undefined) {
    return experimentPlanPayloadSchema.parse(input.payload)
  }

  if (input.inputFile !== undefined) {
    return readExperimentPlanPayload(input.inputFile)
  }

  throw new VaultCliError(
    'invalid_payload',
    'Experiment start requires a typed plan payload.',
  )
}

function describeExperimentPlan(payload: ExperimentPlanPayload) {
  const needsPrivateProtocol =
    payload.decision?.needsPrivateProtocol ??
    (payload.protocol !== undefined || payload.protocolRef !== undefined)

  return {
    planId: payload.planId ?? null,
    materialAdaptation: payload.decision?.materialAdaptation ?? needsPrivateProtocol,
    needsPrivateProtocol,
    reasons: payload.decision?.reasons ?? [],
    operations: [
      ...(payload.protocol ? ['protocol_upsert'] : []),
      'experiment_create',
    ],
  }
}

function toCurrentProtocolRef(
  ref: z.infer<typeof privateProtocolRefInputSchema> | undefined,
): z.infer<typeof protocolRefSchema> | undefined {
  return ref
    ? protocolRefSchema.parse(ref)
    : undefined
}

function hydrateRunPlanAdherenceTargets(
  runPlan: ExperimentRunPlanValue | undefined,
  effectiveProtocolSnapshot:
    | z.infer<typeof effectiveProtocolSnapshotSchema>
    | undefined,
  protocolKey: string | undefined,
): ExperimentRunPlanValue | undefined {
  if (!runPlan || runPlan.adherenceTargets?.length) {
    return runPlan
  }

  const [adherenceTarget] = resolveExperimentAdherenceTargets({
    protocolActivitySessionEvidence:
      effectiveProtocolSnapshot?.activitySessionEvidence,
    protocolKey,
    protocolSessionsPerDay:
      effectiveProtocolSnapshot?.frequency?.sessionsPerDay,
    runPlan,
  })
  if (!adherenceTarget?.calendar) {
    return runPlan
  }

  return experimentRunPlanSchema.parse({
    ...runPlan,
    adherenceTargets: [adherenceTarget],
  })
}

async function assertActiveExperimentPrimaryOutcomeIsCapturable(input: {
  vault: string
  status: ExperimentStatusValue
  runPlan: ExperimentRunPlanValue | undefined
  analysisPlan: ExperimentAnalysisPlanValue | undefined
}): Promise<void> {
  if (input.status !== 'active') {
    return
  }
  const primaryOutcome = resolveExperimentPrimaryOutcome(input.analysisPlan)
  if (!primaryOutcome) {
    throw new VaultCliError(
      'invalid_payload',
      'Active experiments require a primary outcome identity before the run starts.',
    )
  }
  if (primaryOutcome.kind === 'structured_review') {
    const evidence = summarizeExperimentOutcomeEvidencePlan(
      input.analysisPlan,
      primaryOutcome.key,
    )
    if (!evidence.completePlan) {
      throw new VaultCliError(
        'invalid_payload',
        'Active structured-review experiments require bounded baseline and follow-up evidence.',
      )
    }
    return
  }

  const sessionFields = input.runPlan?.logging?.sessionFields ?? []
  const capture = primaryOutcome.capture
  if (capture.kind === 'session_field') {
    if (
      sessionFields.filter(
        (fieldId) => fieldId === capture.fieldId,
      ).length === 1
    ) {
      return
    }
    throw new VaultCliError(
      'invalid_payload',
      `Active experiments with session-field outcome ${primaryOutcome.key} must declare ${capture.fieldId} exactly once.`,
    )
  }
  if (capture.kind === 'derived_metric') {
    if (isRegisteredExperimentMetricSource(capture.sourceMetricKey)) {
      return
    }

    const query = await loadExperimentJournalVaultQueryRuntime()
    const metricKey = resolveExperimentMetricIdentity(
      capture.sourceMetricKey,
    ).metricKey
    let points: Awaited<ReturnType<QueryRuntimeModule['listMetricPoints']>>
    try {
      points = await query.listMetricPoints(input.vault, {
        limit: 1,
        metricKey,
      })
    } catch (error) {
      throw toVaultMetadataCliError(error)
    }
    if (points.length > 0) {
      return
    }
    throw new VaultCliError(
      'invalid_payload',
      `Active experiment derived outcome source ${capture.sourceMetricKey} has no registered metric producer or existing metric points.`,
    )
  }

  const captureAssessment = assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: primaryOutcome.key,
    sessionFields,
  })
  if (captureAssessment.issue === null) {
    return
  }

  throw new VaultCliError(
    'invalid_payload',
    `Active experiments with primary outcome ${captureAssessment.canonicalBiomarkerKey ?? 'unknown'} must declare exactly one matching session field.`,
    {
      primaryBiomarkerKey: captureAssessment.canonicalBiomarkerKey,
      matchingSessionFieldIds: captureAssessment.matchingSessionFieldIds,
    },
  )
}

export async function planExperimentRecord(input: PlanExperimentRecordInput) {
  const payload = await resolveExperimentPlanPayload(input)
  await assertHealthCommonsProtocolStartAllowed({
    source: payload.source,
    status: payload.experiment.status ?? 'active',
    commonsProtocolRef: payload.commonsProtocolRef,
    onboarding: payload.onboarding,
  })

  return {
    vault: input.vault,
    plan: describeExperimentPlan(payload),
  }
}

export async function startExperimentFromPlanRecord(input: StartExperimentFromPlanInput) {
  const payload = await resolveExperimentPlanPayload(input)
  const core = await loadExperimentJournalVaultCoreRuntime()
  return core.withCanonicalWriteLock(input.vault, async () => {
    await assertHealthCommonsProtocolStartAllowed({
      source: payload.source,
      status: payload.experiment.status ?? 'active',
      commonsProtocolRef: payload.commonsProtocolRef,
      onboarding: payload.onboarding,
    })

    let protocol: {
      protocolId: string
      slug: string
      title: string
      protocolRevisionId: string
      effectiveSpecHash: string
      path: string
      created: boolean
    } | null = null
    let privateProtocolRef = payload.protocolRef
    let effectiveProtocolSnapshot = payload.effectiveProtocolSnapshot

    if (payload.protocol) {
      const result = await core.upsertProtocol({
        vaultRoot: input.vault,
        protocolId: payload.protocol.protocolId,
        slug: payload.protocol.slug,
        allowSlugRename:
          payload.protocol.protocolId !== undefined &&
          payload.protocol.slug !== undefined,
        title:
          payload.protocol.title ??
          privateProtocolFrontmatterTitle(payload.protocol.frontmatter),
        frontmatter: payload.protocol.frontmatter as JsonObject | undefined,
        body: payload.protocol.body,
      })
      const entity = result.record.entity
      privateProtocolRef = {
        protocolId: entity.protocolId,
        protocolRevisionId: entity.protocolRevisionId,
        effectiveSpecHash: entity.effectiveSpecHash,
      }
      effectiveProtocolSnapshot =
        payload.effectiveProtocolSnapshot ??
        buildEffectiveProtocolSnapshotFromPrivateProtocol(entity)
      protocol = {
        protocolId: entity.protocolId,
        slug: entity.slug,
        title: entity.title,
        protocolRevisionId: entity.protocolRevisionId,
        effectiveSpecHash: entity.effectiveSpecHash,
        path: result.record.document.relativePath,
        created: result.created,
      }
    }

    if (privateProtocolRef !== undefined && effectiveProtocolSnapshot === undefined) {
      throw new VaultCliError(
        'invalid_payload',
        'Private protocol-backed experiment starts require effectiveProtocolSnapshot.',
      )
    }

    const runPlan = hydrateRunPlanAdherenceTargets(
      payload.runPlan,
      effectiveProtocolSnapshot,
      payload.commonsProtocolRef?.key,
    )
    const protocolRef = toCurrentProtocolRef(privateProtocolRef)
    const preflight = safeParseContract(experimentFrontmatterSchema, compactObject({
      schemaVersion: 'murph.frontmatter.experiment.v1',
      docType: 'experiment',
      experimentId: 'exp_01K72NVW6Z4QK8VYAVX7GT7S4B',
      slug: payload.experiment.slug,
      status: payload.experiment.status ?? 'active',
      title: payload.experiment.title ?? payload.experiment.slug,
      startedOn: payload.experiment.startedOn ?? '2026-01-01',
      hypothesis: payload.experiment.hypothesis,
      commonsProtocolRef: payload.commonsProtocolRef,
      protocolRef,
      effectiveProtocolSnapshot,
      runPlan,
      analysisPlan: payload.analysisPlan,
      onboarding: payload.onboarding,
      assistantSupport: payload.assistantSupport,
    }))

    if (!preflight.success) {
      throw new VaultCliError(
        'invalid_payload',
        'Experiment plan does not produce valid experiment frontmatter.',
        { errors: preflight.errors },
      )
    }

    await assertActiveExperimentPrimaryOutcomeIsCapturable({
      vault: input.vault,
      status: preflight.data.status,
      runPlan: preflight.data.runPlan,
      analysisPlan: preflight.data.analysisPlan,
    })

    const created = await core.createExperiment({
      vaultRoot: input.vault,
      slug: payload.experiment.slug,
      title: payload.experiment.title ?? payload.experiment.slug,
      hypothesis: payload.experiment.hypothesis,
      startedOn: payload.experiment.startedOn,
      status: payload.experiment.status ?? 'active',
      body: payload.experiment.body,
      commonsProtocolRef: payload.commonsProtocolRef,
      protocolRef,
      effectiveProtocolSnapshot,
      runPlan,
      analysisPlan: payload.analysisPlan,
      onboarding: payload.onboarding,
      assistantSupport: payload.assistantSupport,
    })

    return {
      vault: input.vault,
      plan: describeExperimentPlan(payload),
      protocol,
      experiment: {
        experimentId: created.experiment.id,
        lookupId: created.experiment.id,
        slug: created.experiment.slug,
        experimentPath: created.experiment.relativePath,
        status: preflight.data.status,
        created: created.created ?? true,
        updated: true as const,
      },
    }
  })
}

export async function applyExperimentOnboardingRecord(
  input: ApplyExperimentOnboardingRecordInput,
) {
  if (!hasExperimentOnboardingApplyPatch(input)) {
    throw new VaultCliError(
      'invalid_payload',
      'Experiment edit requires at least one protocol, run plan, analysis, onboarding, assistant-support, or scalar field.',
    )
  }

  const core = await loadExperimentJournalVaultCoreRuntime()
  return core.withCanonicalWriteLock(input.vault, async () => {
    const experiment = await requireEntityFamily(input.vault, input.lookup, 'experiment')
    const frontmatter = requireExperimentFrontmatter(experiment)
    const commonsProtocolRef = buildCommonsProtocolRefForOnboardingApply(
      input,
      frontmatter.commonsProtocolRef,
    )
    const runPlan = await buildRunPlanForOnboardingApply(input, frontmatter.runPlan)
    const analysisPlan = buildAnalysisPlanForOnboardingApply(
      input,
      frontmatter.analysisPlan,
    )
    const onboarding = buildExperimentOnboardingCaptureFromOptions(
      input,
      frontmatter.onboarding,
    )
    const assistantSupport = buildExperimentAssistantSupportFromOptions(
      input,
      frontmatter.assistantSupport,
    )

    if (
      commonsProtocolRef !== undefined &&
      frontmatter.effectiveProtocolSnapshot === undefined
    ) {
      throw new VaultCliError(
        'invalid_payload',
        'Applying a Health Commons protocol reference requires an effectiveProtocolSnapshot; use typed experiment start for protocol-backed runs.',
      )
    }

    if (
      input.status === undefined &&
      commonsProtocolRef === undefined &&
      runPlan === undefined &&
      analysisPlan === undefined &&
      onboarding === undefined &&
      assistantSupport === undefined
    ) {
      throw new VaultCliError(
        'invalid_payload',
        'The provided onboarding options did not map to any canonical experiment fields.',
      )
    }

    return updateExperimentRecord({
      vault: input.vault,
      lookup: input.lookup,
      status: input.status,
      commonsProtocolRef,
      runPlan,
      analysisPlan,
      onboarding,
      assistantSupport,
    })
  })
}

export async function updateExperimentRecord(input: {
  vault: string
  lookup: string
  title?: string
  hypothesis?: string
  startedOn?: string
  status?: ExperimentStatusValue
  body?: string
  tags?: string[]
  commonsProtocolRef?: z.infer<typeof experimentFrontmatterSchema>['commonsProtocolRef'] | null
  protocolRef?: z.infer<typeof experimentFrontmatterSchema>['protocolRef'] | null
  effectiveProtocolSnapshot?: z.infer<typeof experimentFrontmatterSchema>['effectiveProtocolSnapshot'] | null
  runPlan?: z.infer<typeof experimentFrontmatterSchema>['runPlan'] | null
  analysisPlan?: z.infer<typeof experimentFrontmatterSchema>['analysisPlan'] | null
  onboarding?: z.infer<typeof experimentFrontmatterSchema>['onboarding'] | null
  assistantSupport?: z.infer<typeof experimentFrontmatterSchema>['assistantSupport'] | null
  outcome?: z.infer<typeof experimentFrontmatterSchema>['outcome'] | null
  outcomeRef?: z.infer<typeof experimentFrontmatterSchema>['outcomeRef'] | null
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    return await core.withCanonicalWriteLock(input.vault, async () => {
      const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')
      const frontmatter = requireExperimentFrontmatter(entity)
      if (frontmatter.commonsProtocolRef && input.commonsProtocolRef === null) {
        throw new VaultCliError(
          'invalid_payload',
          'A Health Commons-backed experiment must preserve its exact protocol lineage; commonsProtocolRef cannot be cleared.',
        )
      }
      const nextCommonsProtocolRef =
        input.commonsProtocolRef === undefined
          ? frontmatter.commonsProtocolRef
          : input.commonsProtocolRef ?? undefined
      const changesCommonsProtocolRef =
        nextCommonsProtocolRef !== undefined &&
        !isDeepStrictEqual(nextCommonsProtocolRef, frontmatter.commonsProtocolRef)
      const nextEffectiveProtocolSnapshot =
        input.effectiveProtocolSnapshot === undefined
          ? frontmatter.effectiveProtocolSnapshot
          : input.effectiveProtocolSnapshot ?? undefined
      const changesEffectiveProtocolSnapshot = !isDeepStrictEqual(
        nextEffectiveProtocolSnapshot,
        frontmatter.effectiveProtocolSnapshot,
      )
      const nextProtocolRef =
        input.protocolRef === undefined
          ? frontmatter.protocolRef
          : input.protocolRef ?? undefined
      const changesProtocolRef = !isDeepStrictEqual(
        nextProtocolRef,
        frontmatter.protocolRef,
      )
      const nextRunPlan = input.runPlan === undefined
        ? frontmatter.runPlan
        : input.runPlan ?? undefined
      const changesRunPlan = !isDeepStrictEqual(
        nextRunPlan,
        frontmatter.runPlan,
      )
      const nextAnalysisPlan = input.analysisPlan === undefined
        ? frontmatter.analysisPlan
        : input.analysisPlan ?? undefined
      const changesAnalysisPlan = !isDeepStrictEqual(
        nextAnalysisPlan,
        frontmatter.analysisPlan,
      )
      const nextStatus = input.status ?? frontmatter.status
      const preservesActiveRunPlanTuning =
        frontmatter.status === 'active' && nextStatus === 'active'
      const changesWithdrawnProtectedState =
        changesCommonsProtocolRef ||
        changesProtocolRef ||
        changesEffectiveProtocolSnapshot ||
        (
          !preservesActiveRunPlanTuning &&
          (changesRunPlan || changesAnalysisPlan)
        )
      if (
        changesWithdrawnProtectedState &&
        frontmatter.commonsProtocolRef &&
        !(await findCurrentHealthCommonsProtocol(frontmatter.commonsProtocolRef))
      ) {
        throw new VaultCliError(
          'invalid_payload',
          'This experiment is linked to a withdrawn Health Commons protocol, so its protocol lineage, effective snapshot, run plan, and analysis plan cannot be changed in place. Start the alternative as a new experiment; this saved run remains unchanged. Abandonment changes status only and must be a separate member decision.',
        )
      }
      if (
        frontmatter.status !== 'planned' &&
        (
          changesCommonsProtocolRef ||
          changesProtocolRef ||
          changesEffectiveProtocolSnapshot
        )
      ) {
        throw new VaultCliError(
          'invalid_payload',
          'Only a planned experiment may change its protocol lineage or effective snapshot. Start a new experiment to use a different revision.',
        )
      }
      const nextActivationOnboarding = changesCommonsProtocolRef
        ? input.onboarding ?? undefined
        : input.onboarding === undefined
          ? frontmatter.onboarding
          : input.onboarding ?? undefined

      if (
        nextStatus === 'active' &&
        (
          frontmatter.status !== 'active' ||
          changesCommonsProtocolRef ||
          input.onboarding !== undefined
        )
      ) {
        await assertHealthCommonsProtocolActivationAllowed({
          commonsProtocolRef: nextCommonsProtocolRef,
          onboarding: nextActivationOnboarding,
        })
      }

      await assertActiveExperimentPrimaryOutcomeIsCapturable({
        vault: input.vault,
        status: nextStatus,
        runPlan: nextRunPlan,
        analysisPlan: nextAnalysisPlan,
      })

      const expectedDocumentSha256 = createHash('sha256')
        .update(await readFile(path.join(input.vault, entity.path), 'utf8'))
        .digest('hex')
      const result = await core.updateExperiment({
        vaultRoot: input.vault,
        relativePath: entity.path,
        title: input.title,
        hypothesis: input.hypothesis,
        startedOn: input.startedOn,
        status: input.status,
        body: input.body,
        tags: input.tags,
        commonsProtocolRef: input.commonsProtocolRef,
        protocolRef: input.protocolRef,
        effectiveProtocolSnapshot: input.effectiveProtocolSnapshot,
        runPlan: input.runPlan,
        analysisPlan: input.analysisPlan,
        onboarding:
          changesCommonsProtocolRef && input.onboarding === undefined
            ? null
            : input.onboarding,
        assistantSupport: input.assistantSupport,
        outcome: input.outcome,
        outcomeRef: input.outcomeRef,
        expectedDocumentSha256,
      })

      return {
        vault: input.vault,
        experimentId: result.experimentId,
        lookupId: result.experimentId,
        slug: result.slug,
        experimentPath: result.relativePath,
        status: result.status,
        updated: result.updated,
      }
    })
  } catch (error) {
    throw toVaultCliError(error)
  }
}

export async function checkpointExperimentRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  title?: string
  note?: string
}) {
  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    mode: 'checkpoint',
    occurredAt: input.occurredAt,
    title: input.title ?? 'Checkpoint',
    note: input.note,
  })
}

export async function checkpointExperimentRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = experimentCheckpointPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment payload'),
  )

  return checkpointExperimentRecord({
    vault: input.vault,
    lookup: experimentLookupFromPayload(payload),
    occurredAt: payload.occurredAt,
    title: payload.title,
    note: payload.note,
  })
}

export async function stopExperimentRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  note?: string
}) {
  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    mode: 'stop',
    occurredAt: input.occurredAt,
    title: 'Stopped',
    note: input.note,
  })
}

function experimentLookupFromPayload(
  payload: z.infer<typeof experimentSelectorPayloadSchema>,
) {
  return payload.lookup ?? payload.experimentId ?? payload.slug ?? ''
}

export async function showExperimentRecord(vault: string, lookup: string) {
  const entity = await requireEntityFamily(vault, lookup, 'experiment')
  return {
    vault,
    entity: toShowEntity(entity),
  }
}

export async function listExperimentRecords(input: {
  vault: string
  status?: ExperimentStatusValue
  limit: number
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['experiment'],
      statuses: input.status ? [input.status] : undefined,
    })
    .slice(0, input.limit)
    .map(toListItem)

  return asListEnvelope(input.vault, {
    status: input.status ?? null,
    limit: input.limit,
  }, items)
}

/**
 * Full, validated experiment frontmatter for internal lifecycle orchestration.
 * The user-facing list envelope deliberately compacts nested data, so it must
 * not be used to schedule lifecycle support or persist experiment outcomes.
 */
export async function listExperimentLifecycleFrontmatterRecords(input: {
  vault: string
  shouldYield?: (() => boolean) | null
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const listed = await core.readExperimentLifecycleFrontmatterDocuments({
    vaultRoot: input.vault,
    shouldYield: input.shouldYield ?? null,
  })

  return {
    vault: input.vault,
    items: listed.items,
    ...(listed.yielded ? { yielded: true as const } : {}),
  }
}

export async function logExperimentSessionRecordFromInput(input: {
  vault: string
  lookup: string
  inputFile: string
}) {
  const payload = experimentSessionPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment session payload'),
  )

  return logExperimentSessionRecord({
    vault: input.vault,
    lookup: input.lookup,
    ...payload,
  })
}

type ExperimentSessionRecordInput = {
  vault: string
  lookup: string
  reminderIntentId?: string
  date?: string
  occurredAt?: string
  source?: z.infer<typeof eventSourceSchema>
  title?: string
  note?: string
  interventionType?: string
  status?: 'completed' | 'partial' | 'missed' | 'skipped'
  sessionStatus?: 'completed' | 'partial' | 'missed' | 'skipped'
  durationMinutes?: number
  protocolId?: string
  timing?: string
  temperatureC?: number
  afterExercise?: boolean
  symptoms?: string[]
  confounders?: string[] | Record<string, string | number | boolean | null>
  fields?: ExperimentSessionFieldMap
}

type ExperimentReminderOccurrenceProof = {
  plannedOccurrenceAt: string
}

const EXPERIMENT_REMINDER_EXTERNAL_REF_SYSTEM = 'murph-assistant'
const EXPERIMENT_REMINDER_EXTERNAL_REF_RESOURCE_TYPE = 'experiment-reminder'
const EXPERIMENT_REMINDER_REPLAY_EFFECT_FIELDS = [
  'title',
  'note',
  'interventionType',
  'durationMinutes',
  'protocolId',
  'sessionStatus',
  'timing',
  'temperatureC',
  'afterExercise',
  'symptoms',
  'confounders',
  'fields',
] as const

export async function logExperimentSessionRecord(input: ExperimentSessionRecordInput) {
  const experiment = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const frontmatter = requireExperimentFrontmatter(experiment)
  const reminderProof = input.reminderIntentId === undefined
    ? null
    : await resolveExperimentReminderOccurrenceProof({
        experimentId: frontmatter.experimentId,
        reminderIntentId: input.reminderIntentId,
        vault: input.vault,
      })
  if (reminderProof !== null) {
    assertExperimentReminderSessionInput(input)
  }

  const explicitInterventionType = slugifyExperimentValue(input.interventionType)
  const derivedInterventionType =
    slugifyExperimentValue(frontmatter.runPlan?.modality) ??
    inferExperimentInterventionType(frontmatter.commonsProtocolRef?.key)
  const interventionType =
    explicitInterventionType ??
    derivedInterventionType

  if (!interventionType) {
    throw new VaultCliError(
      'invalid_payload',
      'Experiment session logging requires interventionType or runPlan.modality.',
    )
  }

  if (
    input.interventionType !== undefined &&
    explicitInterventionType !== null &&
    derivedInterventionType !== null &&
    explicitInterventionType !== derivedInterventionType
  ) {
    assertExperimentMatchesIntervention({
      experiment: {
        entity: experiment,
        experimentId: frontmatter.experimentId,
        experimentSlug: frontmatter.slug,
        frontmatter,
      },
      interventionType: input.interventionType,
    })
  }

  const title = normalizeOptionalText(input.title) ?? buildExperimentSessionTitle({
    durationMinutes: input.durationMinutes,
    interventionType,
  })
  const fields = validateExperimentSessionFields({
    fields: normalizeExperimentSessionFields(input.fields),
    frontmatter,
  })
  const occurredAt = reminderProof?.plannedOccurrenceAt
    ?? input.occurredAt
    ?? new Date().toISOString()
  const reminderEventId = reminderProof === null
    ? undefined
    : deterministicContractId(
        ID_PREFIXES.event,
        JSON.stringify([
          EXPERIMENT_REMINDER_EXTERNAL_REF_SYSTEM,
          EXPERIMENT_REMINDER_EXTERNAL_REF_RESOURCE_TYPE,
          frontmatter.experimentId,
          reminderProof.plannedOccurrenceAt,
        ]),
      )
  const note = normalizeOptionalText(input.note) ?? undefined
  const protocolId = normalizeOptionalText(input.protocolId) ?? undefined
  const sessionStatus = input.sessionStatus ?? input.status ?? 'completed'
  const timing = normalizeOptionalText(input.timing) ?? undefined
  const symptoms = normalizeExperimentFreeTextList(input.symptoms, 160)
  const confounders = normalizeExperimentConfounders(input.confounders)
  const eventPayload = compactObject({
    kind: 'intervention_session',
    eventId: reminderEventId,
    occurredAt,
    source: input.source ?? 'manual',
    title,
    note,
    experimentId: frontmatter.experimentId,
    experimentSlug: frontmatter.slug,
    links: [{ type: 'related_to', targetId: frontmatter.experimentId }],
    externalRef: reminderProof === null
      ? undefined
      : {
          system: EXPERIMENT_REMINDER_EXTERNAL_REF_SYSTEM,
          resourceType: EXPERIMENT_REMINDER_EXTERNAL_REF_RESOURCE_TYPE,
          resourceId: frontmatter.experimentId,
          version: reminderProof.plannedOccurrenceAt,
        },
    interventionType,
    durationMinutes: input.durationMinutes,
    protocolId,
    sessionStatus,
    sessionLocalDate: input.date,
    timing,
    temperatureC: input.temperatureC,
    afterExercise: input.afterExercise,
    symptoms,
    confounders,
    fields,
  }) as JsonObject
  const reminderReplayEffect = compactObject({
    title: input.title === undefined ? undefined : title,
    note: input.note === undefined ? undefined : note,
    interventionType:
      input.interventionType === undefined ? undefined : interventionType,
    durationMinutes: input.durationMinutes,
    protocolId: input.protocolId === undefined ? undefined : protocolId,
    sessionStatus,
    timing: input.timing === undefined ? undefined : timing,
    temperatureC: input.temperatureC,
    afterExercise: input.afterExercise,
    symptoms: input.symptoms === undefined ? undefined : symptoms,
    confounders: input.confounders === undefined ? undefined : confounders,
    fields: input.fields === undefined ? undefined : fields,
  }) as JsonObject
  const event = reminderProof === null || reminderEventId === undefined
    ? await upsertEventRecord({
        vault: input.vault,
        payload: eventPayload,
      })
    : await writeExperimentReminderSessionEvent({
        eventId: reminderEventId,
        experimentId: frontmatter.experimentId,
        payload: eventPayload,
        proof: reminderProof,
        replayEffect: reminderReplayEffect,
        vault: input.vault,
      })

  const result = {
    vault: input.vault,
    experimentId: frontmatter.experimentId,
    lookupId: frontmatter.experimentId,
    slug: frontmatter.slug,
    eventId: event.eventId,
    ledgerFile: event.ledgerFile,
    created: event.created,
    kind: 'intervention_session' as const,
  }
  if (reminderProof === null) {
    return result
  }

  const readback = await showExperimentProgress({
    vault: input.vault,
    lookup: frontmatter.experimentId,
  })
  return {
    ...result,
    progress: readback.progress,
  }
}

async function resolveExperimentReminderOccurrenceProof(input: {
  experimentId: string
  reminderIntentId: string
  vault: string
}): Promise<ExperimentReminderOccurrenceProof> {
  const parsedIntentId = assistantOutboxIntentIdSchema.safeParse(
    input.reminderIntentId,
  )
  if (!parsedIntentId.success) {
    throw new VaultCliError(
      'invalid_option',
      'reminderIntentId must be an opaque assistant outbox intent id.',
    )
  }
  const intentId = parsedIntentId.data
  const intentPath = path.join(
    resolveAssistantStatePaths(input.vault).outboxDirectory,
    `${intentId}.json`,
  )
  const parsedIntent = assistantOutboxIntentSchema.safeParse(
    await readJsonPayload(intentPath, 'delivered reminder provenance'),
  )
  if (!parsedIntent.success || parsedIntent.data.intentId !== intentId) {
    throw new VaultCliError(
      'contract_invalid',
      `Delivered reminder provenance for "${intentId}" is invalid.`,
    )
  }

  const intent = parsedIntent.data
  if (
    intent.status !== 'sent' ||
    intent.delivery === null ||
    intent.delivery.kind === 'message-reaction' ||
    intent.threadIsDirect !== true ||
    intent.message.trim().length === 0 ||
    intent.operation !== null
  ) {
    throw new VaultCliError(
      'invalid_payload',
      `Outbox intent "${intent.intentId}" is not a provider-accepted private reminder message.`,
    )
  }
  const authority = intent.automationAuthority
  if (authority?.supportSeriesId !== `experiment:${input.experimentId}`) {
    throw new VaultCliError(
      'invalid_payload',
      `Outbox intent "${intent.intentId}" does not own experiment "${input.experimentId}".`,
    )
  }
  if (intent.scheduledOccurrenceAt === undefined || intent.scheduledOccurrenceAt === null) {
    throw new VaultCliError(
      'invalid_payload',
      `Outbox intent "${intent.intentId}" has no scheduled occurrence provenance.`,
    )
  }
  if (intent.plannedOccurrenceAt === undefined || intent.plannedOccurrenceAt === null) {
    throw new VaultCliError(
      'invalid_payload',
      `Outbox intent "${intent.intentId}" has no planned occurrence provenance.`,
    )
  }

  return {
    plannedOccurrenceAt: intent.plannedOccurrenceAt,
  }
}

async function writeExperimentReminderSessionEvent(input: {
  eventId: string
  experimentId: string
  payload: JsonObject
  proof: ExperimentReminderOccurrenceProof
  replayEffect: JsonObject
  vault: string
}) {
  return withCanonicalWriteLock(input.vault, async () => {
    const existing = await findEventByExternalRef({
      vaultRoot: input.vault,
      system: EXPERIMENT_REMINDER_EXTERNAL_REF_SYSTEM,
      resourceType: EXPERIMENT_REMINDER_EXTERNAL_REF_RESOURCE_TYPE,
      resourceId: input.experimentId,
      version: input.proof.plannedOccurrenceAt,
    })
    if (existing !== null) {
      if (
        existing.id !== input.eventId
        || existing.kind !== 'intervention_session'
        || existing.experimentId !== input.experimentId
        || existing.occurredAt !== input.proof.plannedOccurrenceAt
      ) {
        throw new VaultCliError(
          'contract_invalid',
          'Delivered reminder occurrence identity conflicts with an existing canonical event.',
        )
      }
      const changedField = EXPERIMENT_REMINDER_REPLAY_EFFECT_FIELDS.find(
        (field) =>
          Object.hasOwn(input.replayEffect, field) &&
          !isDeepStrictEqual(existing[field], input.replayEffect[field]),
      )
      if (changedField !== undefined) {
        throw new VaultCliError(
          'contract_invalid',
          `Delivered reminder occurrence is already logged with different ${changedField}; edit the existing event instead of replaying the reminder write.`,
          { eventId: existing.id, field: changedField },
        )
      }
      return {
        vault: input.vault,
        eventId: existing.id,
        lookupId: existing.id,
        ledgerFile: toMonthlyShardRelativePath(
          VAULT_LAYOUT.eventLedgerDirectory,
          existing.occurredAt,
          'occurredAt',
        ),
        created: false,
      }
    }

    return await upsertEventRecord({
      vault: input.vault,
      payload: input.payload,
    })
  })
}

function assertExperimentReminderSessionInput(
  input: ExperimentSessionRecordInput,
): void {
  if (
    input.date !== undefined ||
    input.occurredAt !== undefined ||
    input.source !== undefined
  ) {
    throw new VaultCliError(
      'invalid_option',
      'Do not pass date, occurredAt, or source with reminderIntentId; the delivered reminder owns the occurrence and the writer records an explicit manual report.',
    )
  }
}

export async function logExperimentContextRecordFromInput(input: {
  vault: string
  lookup: string
  inputFile: string
}) {
  const payload = experimentContextPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment context payload'),
  )

  return logExperimentContextPayloadRecord({
    vault: input.vault,
    lookup: input.lookup,
    payload,
  })
}

export async function attachExperimentSessionRecord(input: {
  vault: string
  lookup: string
  eventId: string
  replace?: boolean
  allowOutOfWindow?: boolean
}) {
  return attachInterventionSessionToExperiment({
    vault: input.vault,
    experiment: input.lookup,
    eventId: input.eventId,
    replace: input.replace,
    allowOutOfWindow: input.allowOutOfWindow,
  })
}

export async function detachExperimentSessionRecord(input: {
  vault: string
  eventId: string
}) {
  return detachInterventionSessionFromExperiment(input)
}

export async function logExperimentContextRecord(input: {
  vault: string
  lookup: string
  kind?: ExperimentContextLogKind
  occurredAt?: string
  source?: z.infer<typeof eventSourceSchema>
  title?: string
  note?: string
  contextType?: string
  severity?: ExperimentContextSeverity
  tags?: string[]
  supplementName?: string
  dose?: number
  unit?: string
}) {
  return logExperimentContextPayloadRecord({
    vault: input.vault,
    lookup: input.lookup,
    payload: buildExperimentContextPayload(input),
  })
}

async function logExperimentContextPayloadRecord(input: {
  vault: string
  lookup: string
  payload: ExperimentContextPayload
}) {
  const experiment = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const frontmatter = requireExperimentFrontmatter(experiment)
  const payload = input.payload
  const occurredAt = payload.occurredAt ?? new Date().toISOString()
  const source = payload.source ?? 'manual'

  const base = {
    occurredAt,
    source,
    experimentId: frontmatter.experimentId,
    experimentSlug: frontmatter.slug,
    links: [{ type: 'related_to', targetId: frontmatter.experimentId }],
    note: normalizeOptionalText(payload.note) ?? undefined,
    tags: 'tags' in payload ? payload.tags : undefined,
  }

  const event = await upsertEventRecord({
    vault: input.vault,
    payload: (() => {
      if (!('kind' in payload) || payload.kind === 'experiment_context') {
        const contextType = slugifyExperimentValue(payload.contextType)
        if (!contextType) {
          throw new VaultCliError(
            'invalid_payload',
            'Experiment context logging requires a usable contextType.',
          )
        }

        return compactObject({
          kind: 'experiment_context',
          ...base,
          title:
            normalizeOptionalText(payload.title) ??
            `${contextType.replace(/-/gu, ' ')} context (${frontmatter.slug})`,
          contextType,
          severity: payload.severity ?? 'potential_confounder',
        })
      }

      switch (payload.kind) {
        case 'note':
          return compactObject({
            kind: 'note',
            ...base,
            title:
              normalizeOptionalText(payload.title) ??
              `Experiment context note (${frontmatter.slug})`,
            note: payload.note,
          })
        case 'supplement_intake':
          return compactObject({
            kind: 'supplement_intake',
            ...base,
            title:
              normalizeOptionalText(payload.title) ??
              `${payload.supplementName} logged for ${frontmatter.slug}`,
            supplementName: payload.supplementName,
            dose: payload.dose,
            unit: payload.unit,
          })
      }
    })() as JsonObject,
  })

  return {
    vault: input.vault,
    experimentId: frontmatter.experimentId,
    lookupId: frontmatter.experimentId,
    slug: frontmatter.slug,
    eventId: event.eventId,
    ledgerFile: event.ledgerFile,
    created: event.created,
    kind: 'kind' in payload ? payload.kind : 'experiment_context',
  }
}

function buildExperimentContextPayload(input: {
  kind?: ExperimentContextLogKind
  occurredAt?: string
  source?: z.infer<typeof eventSourceSchema>
  title?: string
  note?: string
  contextType?: string
  severity?: ExperimentContextSeverity
  tags?: string[]
  supplementName?: string
  dose?: number
  unit?: string
}): ExperimentContextPayload {
  const kind = resolveExperimentContextLogKind(input)
  validateExperimentContextOptions(kind, input)
  const common = {
    occurredAt: input.occurredAt,
    source: input.source,
    title: input.title,
    note: input.note,
    tags: input.tags,
  }

  switch (kind) {
    case 'experiment_context':
      return experimentContextPayloadSchema.parse({
        kind,
        ...common,
        contextType: input.contextType,
        severity: input.severity,
      })
    case 'note':
      return experimentContextPayloadSchema.parse({
        kind,
        ...common,
      })
    case 'supplement_intake':
      return experimentContextPayloadSchema.parse({
        kind,
        ...common,
        supplementName: input.supplementName,
        dose: input.dose,
        unit: input.unit,
      })
  }
}

function validateExperimentContextOptions(
  kind: ExperimentContextLogKind,
  input: {
    contextType?: string
    dose?: number
    severity?: ExperimentContextSeverity
    supplementName?: string
    unit?: string
  },
) {
  switch (kind) {
    case 'experiment_context':
      rejectExperimentContextOptions(kind, input, ['supplementName', 'dose', 'unit'])
      if (input.contextType === undefined) {
        throw new VaultCliError(
          'invalid_option',
          '--context-type is required for experiment context records.',
        )
      }
      return
    case 'note':
      rejectExperimentContextOptions(kind, input, [
        'contextType',
        'severity',
        'supplementName',
        'dose',
        'unit',
      ])
      return
    case 'supplement_intake':
      rejectExperimentContextOptions(kind, input, ['contextType', 'severity'])
      return
  }
}

function rejectExperimentContextOptions(
  kind: ExperimentContextLogKind,
  input: {
    contextType?: string
    dose?: number
    severity?: ExperimentContextSeverity
    supplementName?: string
    unit?: string
  },
  optionKeys: ExperimentContextOptionKey[],
) {
  const optionNames: Record<ExperimentContextOptionKey, string> = {
    contextType: '--context-type',
    dose: '--dose',
    severity: '--severity',
    supplementName: '--supplement-name',
    unit: '--unit',
  }
  const supplied = optionKeys
    .filter((key) => input[key] !== undefined)
    .map((key) => optionNames[key])

  if (supplied.length > 0) {
    throw new VaultCliError(
      'invalid_option',
      `${supplied.join(', ')} ${supplied.length === 1 ? 'is' : 'are'} not valid for experiment context kind "${kind}".`,
    )
  }
}

function resolveExperimentContextLogKind(input: {
  kind?: ExperimentContextLogKind
  contextType?: string
  severity?: ExperimentContextSeverity
  supplementName?: string
  dose?: number
  unit?: string
}): ExperimentContextLogKind {
  if (input.kind) {
    return input.kind
  }

  if (
    typeof input.supplementName === 'string' ||
    typeof input.dose === 'number' ||
    typeof input.unit === 'string'
  ) {
    return 'supplement_intake'
  }

  if (typeof input.contextType === 'string' || typeof input.severity === 'string') {
    return 'experiment_context'
  }

  return 'note'
}

async function resolveExperimentQueryTarget(input: {
  invalidSlugMessage: string
  lookup: string
  vault: string
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const entity = query.lookupEntityById(readModel, input.lookup)

  if (!entity || entity.family !== 'experiment') {
    throw new VaultCliError('not_found', `No experiment found for "${input.lookup}".`)
  }

  const slug = entity.experimentSlug ?? stringOrNull(entity.attributes.slug)
  if (!slug) {
    throw new VaultCliError('invalid_payload', input.invalidSlugMessage)
  }

  return {
    entity,
    query,
    readModel,
    slug,
  }
}

export async function showExperimentProgress(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const { query, readModel, entity, slug } = await resolveExperimentQueryTarget({
    invalidSlugMessage: 'Experiment progress requires a canonical slug.',
    lookup: input.lookup,
    vault: input.vault,
  })
  const metricPoints = await readExperimentJournalMetricPoints({
    asOf: input.asOf,
    frontmatter: requireExperimentFrontmatter(entity),
    query,
    vault: input.vault,
  })

  const progress = query.summarizeExperimentProgress(readModel, slug, {
    asOf: input.asOf,
    metricPoints,
  })

  return {
    vault: input.vault,
    experimentId: entity.entityId,
    lookupId: entity.entityId,
    slug,
    asOf: progress.asOf,
    progress,
  }
}

export async function showExperimentProgressCard(input: {
  vault: string
  lookup: string
  asOf?: string
  confounders?: ReadonlyArray<{ date: string; label: string }>
}) {
  const { query, readModel, entity, slug } = await resolveExperimentQueryTarget({
    invalidSlugMessage: 'Experiment progress cards require a canonical slug.',
    lookup: input.lookup,
    vault: input.vault,
  })
  const frontmatter = requireExperimentFrontmatter(entity)
  const metricPoints = await readExperimentJournalMetricPoints({
    asOf: input.asOf,
    frontmatter,
    query,
    vault: input.vault,
  })
  const biomarkerKeys = [
    frontmatter.analysisPlan?.primaryBiomarkerKey ?? null,
    ...(frontmatter.analysisPlan?.secondaryBiomarkerKeys ?? []),
  ].filter((biomarkerKey): biomarkerKey is string => biomarkerKey !== null)
  const biomarkerDesiredDirections: Array<{
    biomarkerKey: string
    desiredDirection: HealthCommonsBiomarkerDesiredDirection
  }> = []
  const directionWarnings: string[] = []
  let moverSentimentContext: 'direction_unavailable' | null = null
  if (biomarkerKeys.length > 0) {
    try {
      const healthCommons = await loadHealthCommonsBiomarkerDirectionRuntime()
      for (const biomarkerKey of uniqueStrings(biomarkerKeys)) {
        const desiredDirection =
          healthCommons.resolveGeneratedHealthCommonsBiomarkerDesiredDirection(
            biomarkerKey,
          )
        if (desiredDirection !== null) {
          biomarkerDesiredDirections.push({ biomarkerKey, desiredDirection })
        }
      }
    } catch (error) {
      if (!isMissingHealthCommonsBiomarkerDirectionArtifactError(error)) {
        throw error
      }
      directionWarnings.push(
        'biomarker desired directions unavailable; mover sentiment shown as neutral',
      )
      moverSentimentContext = 'direction_unavailable'
    }
  }

  const { card, warnings: cardWarnings } = query.buildExperimentProgressCard(readModel, slug, {
    asOf: input.asOf,
    biomarkerDesiredDirections,
    confounders: input.confounders,
    metricPoints,
    moverSentimentContext,
  })

  return {
    vault: input.vault,
    experimentId: entity.entityId,
    lookupId: entity.entityId,
    slug,
    asOf: card.asOf,
    card,
    warnings: [...directionWarnings, ...cardWarnings],
  }
}

export async function showExperimentFollowupDue(input: {
  vault: string
  lookup: string
  kind: 'missed-log' | 'weekly-digest'
  date?: string
}) {
  const { query, readModel, entity, slug } = await resolveExperimentQueryTarget({
    invalidSlugMessage: 'Experiment follow-up requires a canonical slug.',
    lookup: input.lookup,
    vault: input.vault,
  })

  const decision = query.decideExperimentFollowupDue(readModel, slug, {
    kind: input.kind,
    date: input.date,
  })

  return {
    experimentId: entity.entityId,
    lookupId: entity.entityId,
    slug,
    kind: decision.kind,
    date: decision.date,
    decision,
  }
}

export async function analyzeExperimentOutcomeRecord(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const { analysis } = await analyzeExperimentOutcomeRecordWithSource(input)
  return analysis
}

async function analyzeExperimentOutcomeRecordWithSource(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const { query, readModel, entity, slug } = await resolveExperimentQueryTarget({
    invalidSlugMessage: 'Experiment outcome analysis requires a canonical slug.',
    lookup: input.lookup,
    vault: input.vault,
  })
  const expectedFrontmatter = requireExperimentFrontmatter(entity)
  const metricPoints = await readExperimentJournalMetricPoints({
    asOf: input.asOf,
    frontmatter: expectedFrontmatter,
    query,
    vault: input.vault,
  })

  const outcome = query.analyzeExperimentOutcome(readModel, slug, {
    asOf: input.asOf,
    metricPoints,
  })

  return {
    analysis: {
      vault: input.vault,
      experimentId: entity.entityId,
      lookupId: entity.entityId,
      slug,
      asOf: outcome.asOf,
      outcome,
    },
    expectedFrontmatter,
    experimentPath: entity.path,
  }
}

export async function writeExperimentOutcomeRecord(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  for (let attempt = 0; attempt < EXPERIMENT_OUTCOME_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await core.withCanonicalWriteLock(input.vault, async () => {
        const requestedAsOf = input.asOf ?? new Date().toISOString().slice(0, 10)
        const target = await resolveExperimentQueryTarget({
          invalidSlugMessage: 'Experiment outcome analysis requires a canonical slug.',
          lookup: input.lookup,
          vault: input.vault,
        })
        const expectedFrontmatter = requireExperimentFrontmatter(target.entity)
        const referenced = await core.readReferencedExperimentOutcome({
          vaultRoot: input.vault,
          relativePath: target.entity.path,
          expectedFrontmatter,
        })
        if (
          referenced !== null &&
          !core.shouldAdvanceReferencedExperimentOutcome({
            frontmatter: expectedFrontmatter,
            referencedOutcome: referenced.outcome,
            requestedAsOf,
          })
        ) {
          return {
            vault: input.vault,
            experimentId: referenced.experimentId,
            lookupId: referenced.experimentId,
            slug: referenced.slug,
            asOf: referenced.outcome.asOf,
            outcome: referenced.outcome,
            outcomePath: referenced.outcomePath,
            updatedExperiment: false,
          }
        }

        const {
          analysis,
          experimentPath,
        } = await analyzeExperimentOutcomeRecordWithSource({
          ...input,
          asOf: requestedAsOf,
        })
        const outcomeId = `${expectedFrontmatter.experimentId}-outcome-${analysis.asOf}`
        const candidateOutcome = experimentOutcomeSchema.parse({
          ...analysis.outcome,
          outcomeId,
        })
        const written = await core.writeExperimentOutcome({
          vaultRoot: input.vault,
          relativePath: experimentPath,
          expectedFrontmatter,
          outcome: candidateOutcome,
        })

        return {
          ...analysis,
          outcome: written.outcome,
          outcomePath: written.outcomePath,
          updatedExperiment: written.updatedExperiment,
        }
      })
    } catch (error) {
      if (
        readErrorCode(error) === 'EXPERIMENT_REVISION_CONFLICT' &&
        attempt + 1 < EXPERIMENT_OUTCOME_WRITE_MAX_ATTEMPTS
      ) {
        continue
      }
      throw toVaultCliError(error)
    }
  }

  throw new VaultCliError(
    'conflict',
    'Experiment kept changing while its outcome was being analyzed. Retry the closeout.',
  )
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : null
}

export async function ensureJournalRecord(input: {
  vault: string
  date: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const result = await core.ensureJournalDay({
    vaultRoot: input.vault,
    date: input.date,
  })

  return {
    vault: input.vault,
    lookupId: `journal:${input.date}`,
    created: result.created,
    journalPath: result.relativePath,
  }
}

export async function appendJournalText(input: {
  vault: string
  date: string
  text: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const result = await core.appendJournal({
      vaultRoot: input.vault,
      date: input.date,
      text: input.text,
    })

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: result.relativePath,
      created: result.created,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      JOURNAL_DAY_MISSING: {
        code: 'not_found',
      },
    })
  }
}

export async function linkJournalEventIds(input: {
  vault: string
  date: string
  eventIds: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'eventIds',
    values: input.eventIds,
    operation: 'link',
  })
}

export async function unlinkJournalEventIds(input: {
  vault: string
  date: string
  eventIds: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'eventIds',
    values: input.eventIds,
    operation: 'unlink',
  })
}

export async function linkJournalStreams(input: {
  vault: string
  date: string
  sampleStreams: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'sampleStreams',
    values: input.sampleStreams,
    operation: 'link',
  })
}

export async function unlinkJournalStreams(input: {
  vault: string
  date: string
  sampleStreams: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'sampleStreams',
    values: input.sampleStreams,
    operation: 'unlink',
  })
}

export async function showJournalRecord(vault: string, lookup: string) {
  const entity = await requireEntityFamily(vault, lookup, 'journal')
  return {
    vault,
    entity: toShowEntity(entity),
  }
}

export async function listJournalRecords(input: {
  vault: string
  from?: string
  to?: string
  limit: number
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['journal'],
      from: input.from,
      to: input.to,
    })
    .slice(0, input.limit)
    .map(toListItem)

  return asListEnvelope(input.vault, {
    kind: 'journal_day',
    from: input.from,
    to: input.to,
    limit: input.limit,
  }, items)
}

export async function showVaultSummary(vault: string) {
  const readModel = await readExperimentJournalVault(vault)
  const metadata = readModel.metadata

  return {
    vault,
    formatVersion: resolveVaultFormatVersion(metadata),
    vaultId: stringOrNull(metadata?.vaultId),
    title: stringOrNull(metadata?.title),
    timezone: stringOrNull(metadata?.timezone),
    createdAt: normalizeIsoTimestamp(stringOrNull(metadata?.createdAt)),
    corePath: readModel.coreDocument?.path ?? null,
    coreTitle: readModel.coreDocument?.title ?? null,
    coreUpdatedAt: normalizeIsoTimestamp(readModel.coreDocument?.occurredAt),
  }
}

function resolveVaultFormatVersion(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return null
  }

  return typeof metadata.formatVersion === 'number' && Number.isInteger(metadata.formatVersion)
    ? metadata.formatVersion
    : null
}

export async function updateVaultSummary(input: {
  vault: string
  title?: string
  timezone?: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const result = await core.updateVaultSummary({
      vaultRoot: input.vault,
      title: input.title,
      timezone: input.timezone,
    })

    return {
      vault: input.vault,
      metadataFile: result.metadataFile,
      corePath: result.corePath,
      title: result.title,
      timezone: result.timezone,
      updatedAt: result.updatedAt,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error)
  }
}

export async function showVaultStats(vault: string) {
  const readModel = await readExperimentJournalVault(vault)

  return {
    vault,
    counts: {
      totalRecords: readModel.entities.length,
      experiments: readModel.experiments.length,
      journalEntries: readModel.journalEntries.length,
      events: readModel.events.length,
      samples: readModel.samples.length,
      audits: readModel.audits.length,
      assessments: readModel.assessments.length,
      goals: readModel.goals.length,
      conditions: readModel.conditions.length,
      allergies: readModel.allergies.length,
      protocols: readModel.protocols.length,
      familyMembers: readModel.familyMembers.length,
      geneticVariants: readModel.geneticVariants.length,
    },
    latest: {
      eventOccurredAt: latestIsoTimestamp(readModel.events),
      sampleOccurredAt: latestIsoTimestamp(readModel.samples),
      journalDate: latestDate(readModel.journalEntries),
      experimentTitle: readModel.experiments.at(-1)?.title ?? null,
    },
  }
}

async function appendExperimentLifecycleEvent(input: {
  vault: string
  lookup: string
  occurredAt?: string
  title: string
  note?: string
  mode: 'checkpoint' | 'stop'
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')

  try {
    const result =
      input.mode === 'checkpoint'
        ? await core.checkpointExperiment({
            vaultRoot: input.vault,
            relativePath: entity.path,
            occurredAt: input.occurredAt,
            title: input.title,
            note: input.note,
          })
        : await core.stopExperiment({
            vaultRoot: input.vault,
            relativePath: entity.path,
            occurredAt: input.occurredAt,
            title: input.title,
            note: input.note,
          })

    return {
      vault: input.vault,
      experimentId: result.experimentId,
      lookupId: result.experimentId,
      slug: result.slug,
      experimentPath: result.relativePath,
      status: result.status,
      eventId: result.eventId,
      ledgerFile: result.ledgerFile,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      INVALID_TIMESTAMP: {
        code: 'invalid_timestamp',
      },
    })
  }
}

async function mutateJournalLinks(input: {
  vault: string
  date: string
  kind: JournalLinkKind
  values: string[]
  operation: JournalLinkOperation
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const action = JOURNAL_LINK_RUNTIME_ACTIONS[input.kind][input.operation]
    const result = await core[action]({
      vaultRoot: input.vault,
      date: input.date,
      values: input.values,
    })

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: result.relativePath,
      created: result.created,
      changed: result.changed,
      eventIds: result.eventIds,
      sampleStreams: result.sampleStreams,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      JOURNAL_DAY_MISSING: {
        code: 'not_found',
      },
    })
  }
}

async function requireEntityFamily(
  vault: string,
  lookup: string,
  family: EntityFamily,
) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(vault)
  const entity = query.lookupEntityById(readModel, lookup)

  if (!entity || entity.family !== family) {
    throw new VaultCliError('not_found', `No ${family} found for "${lookup}".`, {
      family,
      lookup,
    })
  }

  return entity
}

function toShowEntity(entity: QueryCanonicalEntity) {
  return {
    id: entity.entityId,
    kind: entity.kind,
    title: entity.title ?? null,
    occurredAt: normalizeIsoTimestamp(entity.occurredAt),
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: buildEntityData(entity),
    links: buildEntityLinks(entity),
  }
}

function toListItem(entity: QueryCanonicalEntity) {
  return toListEntity({
    id: entity.entityId,
    kind: entity.kind,
    title: entity.title ?? null,
    occurredAt: normalizeIsoTimestamp(entity.occurredAt),
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: buildEntityData(entity),
    links: buildEntityLinks(entity),
  })
}

function buildEntityData(entity: QueryCanonicalEntity) {
  return compactObject({
    ...entity.attributes,
    status:
      typeof entity.attributes.status === 'string'
        ? entity.attributes.status
        : entity.status,
    experimentSlug:
      typeof entity.attributes.experimentSlug === 'string'
        ? undefined
        : entity.experimentSlug,
    relatedIds:
      Array.isArray(entity.attributes.relatedIds) &&
      entity.attributes.relatedIds.length > 0
        ? undefined
        : entity.relatedIds,
  })
}

function buildEntityLinks(entity: QueryCanonicalEntity) {
  const links = uniqueStrings([
    ...entity.relatedIds,
    ...stringArray(entity.attributes.eventIds),
  ])

  return links.map((id) => ({
    id,
    kind: inferVaultLinkKind(id),
    queryable: isVaultQueryableRecordId(id),
  }))
}

async function loadExperimentJournalVaultQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadQueryRuntime()
}

async function readExperimentJournalVault(vault: string) {
  const query = await loadExperimentJournalVaultQueryRuntime()

  try {
    return await query.readVault(vault)
  } catch (error) {
    throw toVaultMetadataCliError(error)
  }
}

async function readExperimentJournalMetricPoints(input: {
  asOf?: string
  frontmatter: ExperimentFrontmatter
  query: QueryRuntimeModule
  vault: string
}) {
  const filters = buildExperimentMetricPointFilters(input.query, input.frontmatter, input.asOf)
  if (filters.length === 0) {
    return []
  }

  try {
    return await input.query.listMetricPointsBatch(input.vault, filters)
  } catch (error) {
    throw toVaultMetadataCliError(error)
  }
}

function buildExperimentMetricPointFilters(
  query: QueryRuntimeModule,
  frontmatter: ExperimentFrontmatter,
  asOf?: string,
): QueryMetricPointFilters[] {
  const metricKeys = collectExperimentMetricKeys(query, frontmatter)
  if (metricKeys.length === 0) {
    return []
  }

  const dateFilter = buildExperimentMetricPointDateFilter(frontmatter, asOf)
  const anchorMetricKeys = collectExperimentAnchorMetricKeys(query, frontmatter)
  return metricKeys.flatMap((metricKey) => {
    const filters = anchorMetricKeys.has(metricKey)
      ? [buildExperimentAnchorMetricPointDateFilter(asOf)]
      : [dateFilter]
    return filters.map((filter) => ({
      ...filter,
      limit: null,
      metricKey,
    }))
  })
}

function collectExperimentMetricKeys(
  query: QueryRuntimeModule,
  frontmatter: ExperimentFrontmatter,
): string[] {
  const metricKeys = new Set<string>()
  const analysisPlan = frontmatter.analysisPlan
  const primaryOutcome = resolveExperimentPrimaryOutcome(analysisPlan)
  if (primaryOutcome?.kind === 'metric') {
    const primaryMetricKey =
      primaryOutcome.capture.kind === 'derived_metric'
        ? resolveExperimentMetricKey(query, primaryOutcome.capture.sourceMetricKey)
        : resolveExperimentBiomarkerMetricKey(query, primaryOutcome.key)
    if (primaryMetricKey) {
      metricKeys.add(primaryMetricKey)
    }
  }
  for (const biomarkerKey of [
    analysisPlan?.primaryBiomarkerKey,
    ...(analysisPlan?.secondaryBiomarkerKeys ?? []),
  ]) {
    const metricKey = resolveExperimentBiomarkerMetricKey(query, biomarkerKey)
    if (metricKey) {
      metricKeys.add(metricKey)
    }
  }

  for (const target of frontmatter.runPlan?.adherenceTargets ?? []) {
    if (
      target.evidence.kind !== 'metricPresence' &&
      target.evidence.kind !== 'metricThreshold'
    ) {
      continue
    }

    const metricKey = resolveExperimentMetricKey(query, target.evidence.metricKey)
    if (metricKey.length > 0) {
      metricKeys.add(metricKey)
    }
  }

  return [...metricKeys].sort((left, right) => left.localeCompare(right))
}

function collectExperimentAnchorMetricKeys(
  query: QueryRuntimeModule,
  frontmatter: ExperimentFrontmatter,
): Set<string> {
  const metricKeys = new Set<string>()
  const primaryOutcome = resolveExperimentPrimaryOutcome(frontmatter.analysisPlan)
  for (const anchor of frontmatter.analysisPlan?.measurementAnchors ?? []) {
    for (const biomarkerKey of anchor.biomarkerKeys) {
      const metricKey =
        primaryOutcome?.kind === 'metric' &&
        biomarkerKey.trim().toLowerCase() === primaryOutcome.key
          ? resolveExperimentMetricKey(query, primaryOutcome.metricKey)
          : resolveExperimentBiomarkerMetricKey(query, biomarkerKey)
      if (metricKey) {
        metricKeys.add(metricKey)
      }
    }
  }

  return metricKeys
}

function resolveExperimentBiomarkerMetricKey(
  query: QueryRuntimeModule,
  biomarkerKey: string | null | undefined,
): string | null {
  if (!biomarkerKey) {
    return null
  }

  return resolveExperimentMetricKey(query, biomarkerKey)
}

function resolveExperimentMetricKey(
  query: QueryRuntimeModule,
  metricKey: string,
): string {
  const trimmedMetricKey = metricKey.trim()
  const metricSlug = trimmedMetricKey.split(':').at(-1) ?? trimmedMetricKey
  const definition = trimmedMetricKey.startsWith('biomarker:')
    ? query.resolveMetricDefinitionForBiomarker(trimmedMetricKey) ??
      query.resolveMetricDefinition(metricSlug)
    : query.resolveMetricDefinition(trimmedMetricKey)

  return definition?.key ?? query.normalizeMetricKey(
    trimmedMetricKey.startsWith('biomarker:') ? metricSlug : trimmedMetricKey,
  )
}

function buildExperimentMetricPointDateFilter(
  frontmatter: ExperimentFrontmatter,
  asOf?: string,
): Pick<QueryMetricPointFilters, 'from' | 'to'> {
  const starts: string[] = []
  const ends: string[] = []
  const addRange = (start: string | null | undefined, end: string | null | undefined) => {
    if (start) {
      starts.push(start)
    }
    if (end) {
      ends.push(end)
    }
  }

  addRange(
    frontmatter.runPlan?.baselineStart,
    capExperimentMetricEndDate(frontmatter.runPlan?.baselineEnd, asOf),
  )
  addRange(
    frontmatter.runPlan?.interventionStart,
    capExperimentMetricEndDate(frontmatter.runPlan?.interventionEnd, asOf),
  )

  for (const measurement of frontmatter.analysisPlan?.plannedMeasurements ?? []) {
    addRange(
      measurement.targetWindow?.start,
      capExperimentMetricEndDate(measurement.targetWindow?.end, asOf),
    )
  }

  return {
    ...(starts.length > 0 ? { from: sortedIsoDates(starts)[0] } : {}),
    ...(ends.length > 0 ? { to: sortedIsoDates(ends).at(-1) } : {}),
  }
}

function buildExperimentAnchorMetricPointDateFilter(
  asOf?: string,
): Pick<QueryMetricPointFilters, 'to'> {
  return asOf ? { to: asOf } : {}
}

function capExperimentMetricEndDate(
  configuredEnd: string | null | undefined,
  asOf: string | undefined,
): string | null | undefined {
  if (!asOf) {
    return configuredEnd
  }

  if (!configuredEnd) {
    return asOf
  }

  return configuredEnd < asOf ? configuredEnd : asOf
}

function sortedIsoDates(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

async function loadExperimentJournalVaultCoreRuntime(): Promise<ExperimentJournalVaultCoreRuntime> {
  return loadRuntimeModule<ExperimentJournalVaultCoreRuntime>('@murphai/core')
}

function latestIsoTimestamp(records: readonly QueryCanonicalEntity[]) {
  const latest = [...records]
    .map((record) => normalizeIsoTimestamp(record.occurredAt))
    .filter((value): value is string => value !== null)
    .at(-1)

  return latest ?? null
}

function latestDate(records: readonly QueryCanonicalEntity[]) {
  const latest = [...records]
    .map((record) => record.date)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .at(-1)

  return latest ?? null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function hasExperimentOnboardingApplyPatch(input: ApplyExperimentOnboardingRecordInput) {
  const contextKeys = new Set(['vault', 'requestId', 'lookup'])

  for (const [key, value] of Object.entries(input)) {
    if (contextKeys.has(key) || value === undefined) {
      continue
    }

    if (Array.isArray(value) && value.length === 0) {
      continue
    }

    return true
  }

  return false
}

function buildCommonsProtocolRefForOnboardingApply(
  input: ApplyExperimentOnboardingRecordInput,
  existing: ExperimentFrontmatterValue['commonsProtocolRef'],
): CommonsProtocolRefValue | undefined {
  const touched =
    input.protocolKey !== undefined ||
    input.pageRevisionId !== undefined ||
    input.runSpecRevisionId !== undefined ||
    input.testPlanId !== undefined

  if (!touched) {
    return undefined
  }

  const key =
    input.protocolKey === undefined
      ? existing?.key
      : normalizeProtocolKeyOption(input.protocolKey, 'protocol-key')
  const pageRevisionId =
    input.pageRevisionId === undefined
      ? existing?.pageRevisionId
      : normalizeSha256RevisionOption(input.pageRevisionId, 'page-revision-id')
  const runSpecRevisionId =
    input.runSpecRevisionId === undefined
      ? existing?.runSpecRevisionId
      : normalizeSha256RevisionOption(input.runSpecRevisionId, 'run-spec-revision-id')
  const testPlanId =
    input.testPlanId === undefined
      ? existing?.testPlanId
      : normalizeStableIdOption(input.testPlanId, 'test-plan-id')

  if (!key || !pageRevisionId || !runSpecRevisionId) {
    throw new VaultCliError(
      'invalid_payload',
      'Applying a protocol reference requires --protocol-key, --page-revision-id, and --run-spec-revision-id unless the experiment already has them.',
    )
  }

  return commonsProtocolRefSchema.parse(
    compactObject({
      key,
      pageRevisionId,
      runSpecRevisionId,
      testPlanId,
    }),
  )
}

async function buildRunPlanForOnboardingApply(
  input: ApplyExperimentOnboardingRecordInput,
  existing: ExperimentFrontmatterValue['runPlan'],
): Promise<ExperimentRunPlanValue | undefined> {
  const clearBaselineWindow = input.baselineDays === 0
  const datePatch = buildRunPlanDatePatch(input)
  const logging = buildRunLoggingForOnboardingApply(input, existing?.logging)
  const schedule = await buildRunScheduleForOnboardingApply(input)
  const patch: Partial<ExperimentRunPlanValue> = { ...datePatch }

  if (input.modality !== undefined) {
    patch.modality = normalizeRequiredTextOption(input.modality, 'modality')
  }
  if (schedule !== undefined) {
    patch.schedule = schedule
  }
  if (input.dose !== undefined) {
    patch.dose = normalizeRequiredTextOption(input.dose, 'dose')
  }
  if (input.sessionsPerWeek !== undefined) {
    patch.sessionsPerWeek = input.sessionsPerWeek
  }
  if (input.targetSessions !== undefined) {
    patch.targetSessions = input.targetSessions
  }
  if (input.minimumUsefulSessions !== undefined) {
    patch.minimumUsefulSessions = input.minimumUsefulSessions
  }
  if (logging !== undefined) {
    patch.logging = logging
  }

  const stopConditions = normalizeTextListOption(input.stopCondition, 'stop-condition')
  if (stopConditions !== undefined) {
    patch.stopConditions = stopConditions
  }

  if (Object.keys(patch).length === 0 && (!clearBaselineWindow || existing === undefined)) {
    return undefined
  }

  const baseRunPlan = clearBaselineWindow
    ? omitRunBaselineWindow(existing)
    : existing

  return experimentRunPlanSchema.parse(
    compactObject({
      ...(baseRunPlan ?? {}),
      ...patch,
    }),
  )
}

function omitRunBaselineWindow(
  runPlan: ExperimentFrontmatterValue['runPlan'],
): ExperimentFrontmatterValue['runPlan'] {
  if (runPlan === undefined) {
    return undefined
  }

  const { baselineStart, baselineEnd, ...withoutRunBaselineWindow } = runPlan
  void baselineStart
  void baselineEnd
  return withoutRunBaselineWindow
}

async function buildRunScheduleForOnboardingApply(
  input: ApplyExperimentOnboardingRecordInput,
): Promise<ExperimentRunScheduleIntent | undefined> {
  const hasScheduleFlags =
    input.scheduleKind !== undefined ||
    input.scheduleCron !== undefined ||
    input.scheduleLocalTime !== undefined ||
    input.scheduleTimeZone !== undefined
  const sourceCount =
    (input.schedule === undefined ? 0 : 1) +
    (input.scheduleInputFile === undefined ? 0 : 1) +
    (hasScheduleFlags ? 1 : 0)

  if (sourceCount === 0) {
    return undefined
  }

  if (sourceCount > 1) {
    throw new VaultCliError(
      'invalid_payload',
      'Provide only one schedule source: a structured schedule object, schedule input file, or schedule-kind fields.',
    )
  }

  if (input.schedule !== undefined) {
    return parseExperimentRunScheduleIntent(input.schedule, 'schedule')
  }

  if (input.scheduleInputFile !== undefined) {
    return parseExperimentRunScheduleIntent(
      await readJsonPayload(input.scheduleInputFile, 'ExperimentRunScheduleIntent payload'),
      'schedule input file',
    )
  }

  if (input.scheduleKind === undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--schedule-kind is required when passing run-plan schedule fields.',
    )
  }

  const timeZone = requireScheduleTextOption(input.scheduleTimeZone, 'schedule-time-zone')

  if (input.scheduleKind === 'dailyLocal') {
    if (input.scheduleCron !== undefined) {
      throw new VaultCliError(
        'invalid_option',
        '--schedule-cron is only valid with --schedule-kind cron.',
      )
    }

    return parseExperimentRunScheduleIntent(
      {
        kind: 'dailyLocal',
        localTime: requireScheduleTextOption(
          input.scheduleLocalTime,
          'schedule-local-time',
        ),
        timeZone,
      },
      'schedule',
    )
  }

  if (input.scheduleLocalTime !== undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--schedule-local-time is only valid with --schedule-kind dailyLocal.',
    )
  }

  return parseExperimentRunScheduleIntent(
    {
      kind: 'cron',
      expression: requireScheduleTextOption(input.scheduleCron, 'schedule-cron'),
      timeZone,
    },
    'schedule',
  )
}

function requireScheduleTextOption(
  value: string | undefined,
  optionName: string,
): string {
  if (value === undefined) {
    throw new VaultCliError('invalid_option', `--${optionName} is required for this schedule kind.`)
  }

  return normalizeRequiredTextOption(value, optionName)
}

function parseExperimentRunScheduleIntent(
  value: unknown,
  label: string,
): ExperimentRunScheduleIntent {
  const parsed = safeParseContract(experimentRunScheduleIntentSchema, value)

  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `${label} must be an ExperimentRunScheduleIntent: ${parsed.errors.join('; ')}`,
    )
  }

  return parsed.data
}

function buildRunLoggingForOnboardingApply(
  input: ApplyExperimentOnboardingRecordInput,
  existing: ExperimentRunLoggingValue | undefined,
): ExperimentRunLoggingValue | undefined {
  const sessionFields = normalizeStableIdListOption(input.sessionField, 'session-field')
  const confounderFields = normalizeStableIdListOption(
    input.confounderField,
    'confounder-field',
  )

  if (sessionFields === undefined && confounderFields === undefined) {
    return undefined
  }

  const next = compactObject({
    ...(existing ?? {}),
    ...(sessionFields === undefined ? {} : { sessionFields }),
    ...(confounderFields === undefined ? {} : { confounderFields }),
  })

  if (!Array.isArray(next.sessionFields) || next.sessionFields.length === 0) {
    throw new VaultCliError(
      'invalid_payload',
      '--confounder-field requires --session-field unless the experiment already has runPlan.logging.sessionFields.',
    )
  }

  return experimentRunLoggingSchema.parse(next)
}

function buildAnalysisPlanForOnboardingApply(
  input: ApplyExperimentOnboardingRecordInput,
  existing: ExperimentFrontmatterValue['analysisPlan'],
): ExperimentAnalysisPlanValue | undefined {
  if (
    input.primaryOutcomeKey !== undefined &&
    input.primaryBiomarkerKey !== undefined
  ) {
    throw new VaultCliError(
      'invalid_option',
      'experiment edit accepts either --primary-outcome-key or the legacy --primary-biomarker-key, not both.',
    )
  }
  const patch: Partial<ExperimentAnalysisPlanValue> = {}
  const normalizedPrimaryKey = input.primaryBiomarkerKey === undefined
    ? undefined
    : normalizeHealthCommonsKeyOption(
        input.primaryBiomarkerKey,
        'primary-biomarker-key',
      )

  if (normalizedPrimaryKey !== undefined && existing?.primaryOutcome === undefined) {
    patch.primaryBiomarkerKey = normalizedPrimaryKey
  }

  const primaryOutcome = buildPrimaryOutcomeForOnboardingApply(
    input,
    existing?.primaryOutcome,
    normalizedPrimaryKey ?? existing?.primaryBiomarkerKey,
  )
  if (primaryOutcome !== undefined) {
    patch.primaryOutcome = primaryOutcome
  }

  const secondaryBiomarkerKeys = normalizeHealthCommonsKeyListOption(
    input.secondaryBiomarkerKey,
    'secondary-biomarker-key',
  )
  if (secondaryBiomarkerKeys !== undefined) {
    patch.secondaryBiomarkerKeys = secondaryBiomarkerKeys
  }

  if (input.desiredDirection !== undefined) {
    patch.desiredDirection = experimentSignalDirectionSchema.parse(input.desiredDirection)
  }

  const expectedDirections = normalizeExpectedDirectionEntriesOption(
    input.expectedDirection,
    existing?.expectedDirections,
  )
  if (expectedDirections !== undefined) {
    patch.expectedDirections = expectedDirections
  }

  const measurementAnchors = normalizeExperimentMeasurementAnchorFlagOption(
    input.analysisAnchor,
    existing?.measurementAnchors,
  )
  if (measurementAnchors !== undefined) {
    patch.measurementAnchors = measurementAnchors
  }

  const plannedMeasurements = normalizeExperimentPlannedMeasurementFlagOption(
    input.plannedMeasurement,
    existing?.plannedMeasurements,
  )
  if (plannedMeasurements !== undefined) {
    patch.plannedMeasurements = plannedMeasurements
  }

  const notes = normalizeTextListOption(input.analysisNote, 'analysis-note')
  if (notes !== undefined) {
    patch.notes = notes
  }

  if (Object.keys(patch).length === 0) {
    return undefined
  }

  const next = compactObject({
    ...(existing ?? {}),
    ...patch,
  })
  if (primaryOutcome !== undefined) {
    delete next.primaryBiomarkerKey
  }
  return experimentAnalysisPlanSchema.parse(next)
}

function buildPrimaryOutcomeForOnboardingApply(
  input: ApplyExperimentOnboardingRecordInput,
  existing: ExperimentPrimaryOutcome | undefined,
  legacyKey: string | undefined,
): ExperimentPrimaryOutcome | undefined {
  const touched =
    input.primaryOutcomeKey !== undefined ||
    (input.primaryBiomarkerKey !== undefined && existing !== undefined) ||
    input.primaryOutcomeKind !== undefined ||
    input.primaryOutcomeLabel !== undefined ||
    input.comparisonStatistic !== undefined ||
    input.primaryOutcomeSessionField !== undefined ||
    input.primaryOutcomeSourceMetricKey !== undefined ||
    input.primaryOutcomeUnit !== undefined
  if (!touched) {
    return undefined
  }

  const kind = input.primaryOutcomeKind ?? existing?.kind ?? 'metric'
  const key =
    input.primaryOutcomeKey === undefined
      ? input.primaryBiomarkerKey === undefined
        ? existing?.key ?? legacyKey
        : normalizeHealthCommonsKeyOption(
            input.primaryBiomarkerKey,
            'primary-biomarker-key',
          )
      : normalizeHealthCommonsKeyOption(
          input.primaryOutcomeKey,
          'primary-outcome-key',
        )
  if (!key) {
    throw new VaultCliError(
      'invalid_option',
      'A configured primary outcome requires --primary-outcome-key as its stable outcome key.',
    )
  }
  const label =
    input.primaryOutcomeLabel === undefined
      ? existing?.label
      : normalizeRequiredTextOption(
          input.primaryOutcomeLabel,
          'primary-outcome-label',
        )
  if (kind === 'structured_review') {
    if (
      input.comparisonStatistic !== undefined ||
      input.primaryOutcomeSessionField !== undefined ||
      input.primaryOutcomeSourceMetricKey !== undefined ||
      input.primaryOutcomeUnit !== undefined
    ) {
      throw new VaultCliError(
        'invalid_option',
        'Comparison and metric-capture options are only valid for metric outcomes.',
      )
    }
    return experimentPrimaryOutcomeSchema.parse(
      compactObject({ kind, key, label }),
    )
  }

  if (
    input.primaryOutcomeSessionField !== undefined &&
    input.primaryOutcomeSourceMetricKey !== undefined
  ) {
    throw new VaultCliError(
      'invalid_option',
      'A metric outcome cannot use both a session field and a derived source metric.',
    )
  }
  if (
    input.primaryOutcomeUnit !== undefined &&
    input.primaryOutcomeSessionField === undefined
  ) {
    throw new VaultCliError(
      'invalid_option',
      '--primary-outcome-unit requires --primary-outcome-session-field.',
    )
  }
  const existingStatistic = existing?.kind === 'metric' ? existing.statistic : undefined
  const existingCapture = existing?.kind === 'metric' ? existing.capture : undefined
  const capture = input.primaryOutcomeSessionField !== undefined
    ? {
        kind: 'session_field' as const,
        fieldId: normalizeStableIdOption(
          input.primaryOutcomeSessionField,
          'primary-outcome-session-field',
        ),
        unit: input.primaryOutcomeUnit === undefined
          ? undefined
          : normalizeRequiredTextOption(
              input.primaryOutcomeUnit,
              'primary-outcome-unit',
            ),
      }
    : input.primaryOutcomeSourceMetricKey !== undefined
      ? {
          kind: 'derived_metric' as const,
          sourceMetricKey: normalizeRequiredTextOption(
            input.primaryOutcomeSourceMetricKey,
            'primary-outcome-source-metric-key',
          ),
        }
      : existingCapture
  return experimentPrimaryOutcomeSchema.parse(compactObject({
    kind,
    key,
    label,
    statistic: input.comparisonStatistic ?? existingStatistic,
    capture,
  }))
}

function buildRunPlanDatePatch(input: ApplyExperimentOnboardingRecordInput) {
  let baselineStart = normalizeLocalDateOption(input.baselineStart, 'baseline-start')
  let baselineEnd = normalizeLocalDateOption(input.baselineEnd, 'baseline-end')
  let interventionStart = normalizeLocalDateOption(
    input.interventionStart,
    'intervention-start',
  )
  let interventionEnd = normalizeLocalDateOption(input.interventionEnd, 'intervention-end')

  if (input.baselineDays !== undefined) {
    if (input.baselineDays < 0) {
      throw new VaultCliError('invalid_option', '--baseline-days must be zero or greater.')
    }

    if (input.baselineDays === 0) {
      baselineStart = undefined
      baselineEnd = undefined
    } else {
      if (baselineStart) {
        baselineEnd = mergeComputedDate(
          baselineEnd,
          addLocalDays(baselineStart, input.baselineDays - 1, 'baseline-start'),
          'baseline-end',
          'baseline-days',
        )
      } else if (baselineEnd) {
        baselineStart = addLocalDays(baselineEnd, 1 - input.baselineDays, 'baseline-end')
      } else if (interventionStart) {
        baselineEnd = addLocalDays(interventionStart, -1, 'intervention-start')
        baselineStart = addLocalDays(interventionStart, -input.baselineDays, 'intervention-start')
      } else {
        throw new VaultCliError(
          'invalid_payload',
          '--baseline-days requires --baseline-start, --baseline-end, or --intervention-start so Murph can write canonical baseline dates.',
        )
      }
    }
  }

  if (input.interventionDays !== undefined) {
    if (input.interventionDays <= 0) {
      throw new VaultCliError('invalid_option', '--intervention-days must be greater than zero.')
    }

    if (!interventionStart && !interventionEnd && baselineEnd) {
      interventionStart = addLocalDays(baselineEnd, 1, 'baseline-end')
    }

    if (interventionStart) {
      interventionEnd = mergeComputedDate(
        interventionEnd,
        addLocalDays(interventionStart, input.interventionDays - 1, 'intervention-start'),
        'intervention-end',
        'intervention-days',
      )
    } else if (interventionEnd) {
      interventionStart = addLocalDays(
        interventionEnd,
        1 - input.interventionDays,
        'intervention-end',
      )
    } else {
      throw new VaultCliError(
        'invalid_payload',
        '--intervention-days requires --intervention-start, --intervention-end, or a baseline window so Murph can write canonical intervention dates.',
      )
    }
  }

  return compactObject({
    baselineStart,
    baselineEnd,
    interventionStart,
    interventionEnd,
  })
}

function mergeComputedDate(
  existing: string | undefined,
  computed: string,
  optionName: string,
  sourceOptionName: string,
) {
  if (existing !== undefined && existing !== computed) {
    throw new VaultCliError(
      'invalid_payload',
      `--${optionName} conflicts with --${sourceOptionName}; expected ${computed}.`,
    )
  }

  return existing ?? computed
}

function normalizeLocalDateOption(value: string | undefined, optionName: string) {
  if (value === undefined) {
    return undefined
  }

  const parsed = localDateSchema.safeParse(value)
  if (!parsed.success) {
    throw new VaultCliError('invalid_option', `--${optionName} must use YYYY-MM-DD.`)
  }

  assertValidLocalDate(parsed.data, optionName)
  return parsed.data
}

function assertValidLocalDate(value: string, optionName: string) {
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new VaultCliError('invalid_option', `--${optionName} must be a real calendar date.`)
  }
}

function addLocalDays(value: string, days: number, optionName: string) {
  assertValidLocalDate(value, optionName)
  const [yearText, monthText, dayText] = value.split('-')
  const date = new Date(Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText) + days,
  ))
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function normalizeHealthCommonsKeyOption(value: string, optionName: string) {
  const normalized = normalizeRequiredTextOption(value, optionName)
  const parsed = safeParseContract(healthCommonsKeySchema, normalized)

  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} must be a Health Commons key such as protocol:family/variant or biomarker:name.`,
    )
  }

  return parsed.data
}

function normalizeProtocolKeyOption(value: string, optionName: string) {
  const normalized = normalizeHealthCommonsKeyOption(value, optionName)

  if (!normalized.startsWith('protocol_variant:')) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} must be a Health Commons protocol_variant key.`,
    )
  }

  return normalized
}

function normalizeHealthCommonsKeyListOption(
  values: readonly string[] | undefined,
  optionName: string,
) {
  const normalized = normalizeTextListOption(values, optionName)
  if (normalized === undefined) {
    return undefined
  }

  return normalized.map((entry) => normalizeHealthCommonsKeyOption(entry, optionName))
}

function normalizeExpectedDirectionEntriesOption(
  values: readonly string[] | undefined,
  existing: ExperimentAnalysisPlanValue['expectedDirections'] | undefined,
) {
  const normalized = normalizeTextListOption(values, 'expected-direction')
  if (normalized === undefined) {
    return undefined
  }

  const next = new Map<string, z.infer<typeof experimentSignalDirectionSchema>>()
  for (const entry of existing ?? []) {
    next.set(entry.biomarkerKey, entry.direction)
  }

  for (const entry of normalized) {
    const delimiterIndex = entry.lastIndexOf('=')
    if (delimiterIndex <= 0 || delimiterIndex === entry.length - 1) {
      throw new VaultCliError(
        'invalid_option',
        '--expected-direction must use biomarker:key=increase|decrease|stabilize.',
      )
    }

    const biomarkerKey = normalizeHealthCommonsKeyOption(
      entry.slice(0, delimiterIndex),
      'expected-direction',
    )
    const direction = experimentSignalDirectionSchema.safeParse(
      entry.slice(delimiterIndex + 1).trim(),
    )
    if (!direction.success) {
      throw new VaultCliError(
        'invalid_option',
        '--expected-direction values must be increase, decrease, or stabilize.',
      )
    }

    next.set(biomarkerKey, direction.data)
  }

  return experimentExpectedDirectionsSchema.parse(
    [...next].map(([biomarkerKey, direction]) => ({ biomarkerKey, direction })),
  )
}

type HealthCommonsBiomarkerDirectionRuntime = {
  resolveGeneratedHealthCommonsBiomarkerDesiredDirection(
    biomarkerKey: string,
  ): HealthCommonsBiomarkerDesiredDirection | null
}

async function loadHealthCommonsBiomarkerDirectionRuntime(): Promise<
  HealthCommonsBiomarkerDirectionRuntime
> {
  return loadRuntimeModule<HealthCommonsBiomarkerDirectionRuntime>(
    '@murphai/health-commons/runtime',
  )
}

function isMissingHealthCommonsBiomarkerDirectionArtifactError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

function normalizeSha256RevisionOption(value: string, optionName: string) {
  const normalized = normalizeRequiredTextOption(value, optionName)
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} must use sha256:<64 lowercase hex>.`,
    )
  }

  return normalized
}

function requireExperimentFrontmatter(entity: QueryCanonicalEntity) {
  const result = safeParseContract(experimentFrontmatterSchema, entity.attributes)

  if (!result.success) {
    throw new VaultCliError(
      'invalid_payload',
      `Experiment "${entity.entityId}" has invalid frontmatter for rich experiment operations.`,
    )
  }

  return result.data
}

function slugifyExperimentValue(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value ?? undefined)
  if (!normalized) {
    return null
  }

  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return slug.length > 0 ? slug : null
}

function slugifyExperimentValueList(values: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }

  const normalized = values
    .map((value) => slugifyExperimentValue(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined
}

function normalizeExperimentFreeTextList(
  values: readonly string[] | undefined,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }

  const normalized = uniqueStrings(values
    .map((value) => normalizeOptionalText(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.slice(0, maxLength)))

  return normalized.length > 0 ? normalized : undefined
}

function normalizeExperimentConfounders(
  value: string[] | Record<string, string | number | boolean | null> | undefined,
) {
  if (Array.isArray(value)) {
    return slugifyExperimentValueList(value)
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const normalized: Record<string, string | number | boolean | null> = {}

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeOptionalText(key)
    if (!normalizedKey) {
      continue
    }

    if (typeof entry === 'string') {
      const normalizedValue = normalizeOptionalText(entry)
      if (normalizedValue) {
        normalized[normalizedKey] = normalizedValue
      }
      continue
    }

    if (
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null
    ) {
      normalized[normalizedKey] = entry
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

type ExperimentSessionFieldValue = string | number | boolean | null
type ExperimentSessionFieldMap = Record<string, ExperimentSessionFieldValue>

function normalizeExperimentSessionFields(
  value: ExperimentSessionFieldMap | undefined,
): ExperimentSessionFieldMap | undefined {
  if (!value) {
    return undefined
  }

  const normalized: ExperimentSessionFieldMap = {}
  for (const [fieldId, entry] of Object.entries(value)) {
    const normalizedFieldId = normalizeOptionalText(fieldId)
    if (!normalizedFieldId) {
      throw new VaultCliError(
        'invalid_payload',
        'Experiment session fields require a non-empty field id.',
      )
    }

    if (typeof entry === 'string') {
      const normalizedValue = normalizeOptionalText(entry)
      if (!normalizedValue) {
        throw new VaultCliError(
          'invalid_payload',
          `Experiment session field ${normalizedFieldId} requires a non-empty value.`,
        )
      }
      normalized[normalizedFieldId] = normalizedValue
      continue
    }

    normalized[normalizedFieldId] = entry
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function validateExperimentSessionFields(input: {
  fields: ExperimentSessionFieldMap | undefined
  frontmatter: ExperimentFrontmatter
}): ExperimentSessionFieldMap | undefined {
  const declaredFields = input.frontmatter.runPlan?.logging?.sessionFields ?? []
  const seenDeclaredMetrics = new Map<string, string>()
  for (const declaredField of declaredFields) {
    const spec = resolveExperimentSessionMetricSpec(declaredField)
    if (!spec) {
      continue
    }
    const previousField = seenDeclaredMetrics.get(spec.key)
    if (previousField) {
      throw new VaultCliError(
        'invalid_payload',
        `Experiment run declares both ${previousField} and ${declaredField} for the same canonical session metric ${spec.key}.`,
      )
    }
    seenDeclaredMetrics.set(spec.key, declaredField)
  }

  if (!input.fields) {
    return undefined
  }

  const declaredFieldSet = new Set(declaredFields)
  const seenLoggedMetrics = new Map<string, string>()
  for (const [fieldId, value] of Object.entries(input.fields)) {
    if (!declaredFieldSet.has(fieldId)) {
      throw new VaultCliError(
        'invalid_payload',
        `Experiment session field ${fieldId} is not declared in runPlan.logging.sessionFields.`,
      )
    }

    const spec = resolveExperimentSessionMetricSpec(fieldId)
    if (spec) {
      const previousField = seenLoggedMetrics.get(spec.key)
      if (previousField) {
        throw new VaultCliError(
          'invalid_payload',
          `Experiment session fields ${previousField} and ${fieldId} both resolve to canonical metric ${spec.key}.`,
        )
      }
      seenLoggedMetrics.set(spec.key, fieldId)
    }

    const validation = validateExperimentSessionMetricValue({ fieldId, value })
    if (!validation.success) {
      throw new VaultCliError('invalid_payload', validation.message)
    }
  }

  return input.fields
}

function inferExperimentInterventionType(protocolKey: string | undefined): string | null {
  const normalized = normalizeOptionalText(protocolKey)?.toLowerCase() ?? null
  if (!normalized) {
    return null
  }

  if (normalized.includes('sauna')) {
    return 'sauna'
  }

  if (normalized.includes('magnesium')) {
    return 'magnesium'
  }

  const tail = normalized.split('/').at(-1) ?? normalized
  return slugifyExperimentValue(tail)
}

function buildExperimentSessionTitle(input: {
  durationMinutes?: number
  interventionType: string
}) {
  const label = input.interventionType.replace(/-/gu, ' ')
  if (typeof input.durationMinutes === 'number') {
    return `${input.durationMinutes}-minute ${label}`
  }

  return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} session`
}
