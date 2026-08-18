import { AsyncLocalStorage } from 'node:async_hooks'
import {
  EVENT_SOURCES,
  EXPERIMENT_OUTCOME_STATISTICS,
  EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS,
  EXPERIMENT_STATUSES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
  commonsProtocolRefSchema,
  effectiveProtocolSnapshotSchema,
  experimentAnalysisPlanSchema,
  experimentAssistantSupportSchema,
  experimentFrontmatterSchema,
  experimentOutcomeSchema,
  experimentPrimaryOutcomeSchema,
  experimentProgressCardSchema,
  experimentProgressSnapshotSchema,
  experimentRunPlanSchema,
  experimentRunScheduleIntentSchema,
  jsonObjectSchema,
  isStrictIsoDate,
  type ExperimentOutcomeStatistic,
  type ExperimentPrimaryOutcome,
  type ExperimentRunScheduleIntent,
  type HealthCommonsExpectedSignalDescription,
  type HealthCommonsTestPlan,
} from '@murphai/contracts'
import type { HealthCommonsProtocolRunSpec } from '@murphai/health-commons/runtime'
import {
  assessExperimentPrimaryMetricCapture,
  resolveExperimentSessionMetricSpec,
} from '@murphai/health-metrics'
import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { assistantOutboxIntentIdSchema } from '@murphai/operator-config/assistant-cli-contracts'
import {
  experimentCreateResultSchema,
  isoTimestampSchema,
  listEntitySchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  buildExperimentAssistantSupportFromOptions,
  buildExperimentOnboardingCaptureFromOptions,
  normalizeExperimentMeasurementAnchorFlagOption,
  normalizeExperimentPlannedMeasurementFlagOption,
  normalizeRepeatableFlagOption,
  normalizeRepeatableTextFlagOption,
} from '@murphai/vault-usecases'
import { commonListLimitOptionSchema } from './command-factory-primitives.js'
import {
  renderAndSaveExperimentProgressCard,
} from './experiment-progress-card-image.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)
const eventSourceOptionSchema = z.enum(EVENT_SOURCES)
const experimentSignalDirectionSchema = z.enum(['increase', 'decrease', 'stabilize'])
const experimentPrimaryOutcomeKindSchema = z.enum(['metric', 'structured_review'])
const experimentOutcomeStatisticSchema = z.enum(EXPERIMENT_OUTCOME_STATISTICS)
const experimentCheckInCadenceSchema = z.enum(['none', 'daily', 'every_3_days', 'weekly'])
const experimentNotificationStyleSchema = z.enum([
  'skip_by_default',
  'send_scheduled_summary',
])
const experimentRunScheduleKindSchema = z.enum(['dailyLocal', 'cron'])
const experimentSafetyCautionLevelSchema = z.enum(
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
)
const experimentSafetyDispositionSchema = z.enum(
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
)
const experimentMissedLogFollowupSchema = z.enum(
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
)
const experimentFollowupKindSchema = z.enum(['missed-log', 'weekly-digest'])
const experimentFollowupActionSchema = z.enum(['notify', 'skip'])
const experimentFollowupReasonSchema = z.enum([
  'experiment_not_active',
  'not_in_intervention_window',
  'missed_log_followup_disabled',
  'reminders_disabled',
  'session_already_logged',
  'session_assumed',
  'planned_session_log_missing',
  'unsupported_session_schedule',
  'weekly_digest_disabled',
  'weekly_digest_not_due',
  'weekly_digest_due',
])
const experimentCommandArgvStorage = new AsyncLocalStorage<readonly string[]>()
const experimentCommandArgvInstalled = new WeakSet<Cli.Cli>()

function installExperimentCommandArgvContext(cli: Cli.Cli): void {
  if (experimentCommandArgvInstalled.has(cli)) {
    return
  }

  const serve = cli.serve.bind(cli)
  cli.serve = async (argv = process.argv.slice(2), options = {}) =>
    experimentCommandArgvStorage.run([...argv], () => serve(argv, options))
  experimentCommandArgvInstalled.add(cli)
}

function currentCommandIncludesFlag(flag: string): boolean {
  return experimentCommandArgvStorage.getStore()?.includes(flag) === true
}

type ProtocolVariantEntity = HealthCommonsProtocolRunSpec
const sha256RevisionOptionSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/u,
    'Expected sha256: followed by 64 lowercase hexadecimal characters.',
  )
  .describe('Content revision id in sha256:<64 lowercase hex> form.')
const experimentLookupArgSchema = z.object({
  id: z.string().min(1).describe('Experiment id or slug to resolve.'),
})
const experimentJournalLookupArgSchema = z.object({
  lookup: z.string().min(1).describe('Experiment id or slug to resolve.'),
})
const interventionSessionEventIdSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical intervention event id in evt_* form.')
const experimentSessionStatusSchema = z.enum([
  'completed',
  'partial',
  'missed',
  'skipped',
])
const experimentContextKindSchema = z.enum([
  'experiment_context',
  'note',
  'supplement_intake',
])
const experimentContextSeveritySchema = z.enum([
  'info',
  'potential_confounder',
  'safety',
  'blocking',
])

const repeatableTextOptionSchema = (description: string) =>
  z.array(z.string().min(1)).optional().describe(description)

const experimentOnboardingOptionSchemas = {
  onboardingCompletedAt: isoTimestampSchema
    .optional()
    .describe('Timestamp when the protocol onboarding capture completed.'),
  setupAnswer: repeatableTextOptionSchema(
    'Setup answer as key=value. Repeat --setup-answer for multiple setup slots.',
  ),
  safetyCautionLevel: experimentSafetyCautionLevelSchema
    .optional()
    .describe('Onboarding safety caution level.'),
  safetyDisposition: experimentSafetyDispositionSchema
    .optional()
    .describe('Onboarding safety disposition.'),
  positiveQuestionId: repeatableTextOptionSchema(
    'Positive safety question ids. Repeat --positive-question-id for multiple values.',
  ),
  safetyNote: repeatableTextOptionSchema(
    'Safety note. Repeat --safety-note for multiple values.',
  ),
  contextNote: repeatableTextOptionSchema(
    'Context note from onboarding. Repeat --context-note for multiple values.',
  ),
}

const experimentAssistantSupportOptionSchemas = {
  reminderPolicy: z
    .string()
    .min(1)
    .optional()
    .describe('Reminder policy id selected during onboarding.'),
  reminderOptionId: z
    .string()
    .min(1)
    .optional()
    .describe('Reminder option id selected during onboarding.'),
  remindersEnabled: z
    .boolean()
    .optional()
    .describe('Whether assistant reminders are enabled for the run.'),
  checkInCadence: experimentCheckInCadenceSchema
    .optional()
    .describe('Assistant check-in cadence for the run.'),
  notificationStyle: experimentNotificationStyleSchema
    .optional()
    .describe('Assistant notification style for the run.'),
  missedLogFollowup: experimentMissedLogFollowupSchema
    .optional()
    .describe('Assistant follow-up policy for missed logs.'),
  weeklyDigestEnabled: z
    .boolean()
    .optional()
    .describe('Whether weekly assistant digests are enabled for the run.'),
}

function hasRunScheduleFlag(options: {
  scheduleKind?: z.infer<typeof experimentRunScheduleKindSchema>
  scheduleCron?: string
  scheduleLocalTime?: string
  scheduleTimeZone?: string
}) {
  return (
    options.scheduleKind !== undefined ||
    options.scheduleCron !== undefined ||
    options.scheduleLocalTime !== undefined ||
    options.scheduleTimeZone !== undefined
  )
}

function requireRunScheduleOption(value: string | undefined, optionName: string) {
  if (value === undefined || value.trim().length === 0) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} is required for this schedule kind.`,
    )
  }

  return value.trim()
}

function parseRunScheduleOption(value: unknown): ExperimentRunScheduleIntent {
  const parsed = experimentRunScheduleIntentSchema.safeParse(value)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'schedule'}: ${issue.message}`)
      .join('; ')
    throw new VaultCliError(
      'invalid_option',
      `Run-plan schedule must match ExperimentRunScheduleIntent: ${issues}`,
    )
  }

  return parsed.data
}

function buildRunScheduleFromOptions(options: {
  scheduleKind?: z.infer<typeof experimentRunScheduleKindSchema>
  scheduleCron?: string
  scheduleLocalTime?: string
  scheduleTimeZone?: string
}): ExperimentRunScheduleIntent | undefined {
  if (!hasRunScheduleFlag(options)) {
    return undefined
  }

  if (options.scheduleKind === undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--schedule-kind is required when passing run-plan schedule fields.',
    )
  }

  const timeZone = requireRunScheduleOption(options.scheduleTimeZone, 'schedule-time-zone')

  if (options.scheduleKind === 'dailyLocal') {
    if (options.scheduleCron !== undefined) {
      throw new VaultCliError(
        'invalid_option',
        '--schedule-cron is only valid with --schedule-kind cron.',
      )
    }

    return parseRunScheduleOption({
      kind: 'dailyLocal',
      localTime: requireRunScheduleOption(options.scheduleLocalTime, 'schedule-local-time'),
      timeZone,
    })
  }

  if (options.scheduleLocalTime !== undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--schedule-local-time is only valid with --schedule-kind dailyLocal.',
    )
  }

  return parseRunScheduleOption({
    kind: 'cron',
    expression: requireRunScheduleOption(options.scheduleCron, 'schedule-cron'),
    timeZone,
  })
}

const isoDayMilliseconds = 24 * 60 * 60 * 1000

function shiftLocalDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    throw new VaultCliError('invalid_option', `Invalid local date "${date}".`)
  }

  const shifted = new Date(Date.UTC(year, month - 1, day) + days * isoDayMilliseconds)
  return shifted.toISOString().slice(0, 10)
}

function normalizeProtocolVariantKey(value: string, optionName = 'protocol-key'): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('protocol_variant:')) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} must be a full protocol_variant:<family>/<variant> key.`,
    )
  }

  return trimmed
}

async function resolveProtocolVariantEntity(
  lookup: string,
  optionName = 'from-protocol',
): Promise<ProtocolVariantEntity> {
  const trimmed = lookup.trim()
  const { getGeneratedHealthCommonsProtocolRunSpecReader } = await import(
    '@murphai/health-commons/runtime'
  )
  const reader = getGeneratedHealthCommonsProtocolRunSpecReader()
  const entity = reader.findByLookup(
    trimmed.startsWith('protocol_variant:')
      ? normalizeProtocolVariantKey(trimmed, optionName)
      : trimmed,
  )

  if (!entity) {
    throw new VaultCliError(
      'not_found',
      `No Health Commons protocol variant matched --${optionName} "${lookup}".`,
    )
  }

  return entity
}

function resolveProtocolTestPlan(input: {
  entity: ProtocolVariantEntity
  testPlanId?: string
}): HealthCommonsTestPlan | undefined {
  const planId =
    input.testPlanId ??
    input.entity.experimentOnboarding?.planDefaults?.testPlanId ??
    (input.entity.testPlans.length === 1 ? input.entity.testPlans[0]?.planId : undefined)

  if (planId === undefined) {
    return undefined
  }

  const testPlan = input.entity.testPlans.find((candidate) => candidate.planId === planId)
  if (!testPlan) {
    throw new VaultCliError(
      'invalid_option',
      `--test-plan-id ${planId} does not exist on ${input.entity.key}.`,
    )
  }

  return testPlan
}

function mapExpectedSignalDirection(
  direction: string | undefined,
): z.infer<typeof experimentSignalDirectionSchema> | undefined {
  switch (direction) {
    case 'up':
    case 'up_or_stable':
      return 'increase'
    case 'down':
    case 'down_or_stable':
      return 'decrease'
    case 'stable':
      return 'stabilize'
    default:
      return undefined
  }
}

function findExpectedSignal(
  entity: ProtocolVariantEntity,
  biomarkerKey: string,
): HealthCommonsExpectedSignalDescription | undefined {
  return entity.expectedSignalDescriptions?.find(
    (signal) => signal.biomarkerKey === biomarkerKey,
  )
}

function normalizeExpectedDirectionEntries(
  values: readonly string[] | undefined,
) {
  if (!Array.isArray(values)) {
    return undefined
  }

  return values.map((entry) => {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex < 0) {
      throw new VaultCliError(
        'invalid_option',
        '--expected-direction entries must use biomarker:key=direction form.',
      )
    }

    return {
      biomarkerKey: entry.slice(0, separatorIndex).trim(),
      direction: experimentSignalDirectionSchema.parse(
        entry.slice(separatorIndex + 1).trim(),
      ),
    }
  })
}

function uniqueNonEmptyStrings(values: readonly (string | undefined)[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function compactRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function truncateBoundedText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (value === undefined || value.length <= maxLength) {
    return value
  }

  return value.slice(0, maxLength - 3).trimEnd() + '...'
}

export function buildEffectiveSnapshotFromCommonsProtocol(
  entity: ProtocolVariantEntity,
) {
  if (!entity.protocol) {
    throw new VaultCliError(
      'invalid_payload',
      `${entity.key} does not expose a runnable protocol spec.`,
    )
  }

  const effectiveSpecHash = entity.revision.runSpecRevisionId
  if (!effectiveSpecHash) {
    throw new VaultCliError(
      'invalid_payload',
      `${entity.key} is missing runSpecRevisionId and cannot be started as an experiment.`,
    )
  }

  return effectiveProtocolSnapshotSchema.parse(
    compactRecord({
      effectiveSpecHash,
      doseSignature: truncateBoundedText(entity.protocol.doseSignature, 240),
      modality: truncateBoundedText(entity.protocol.target, 160),
      activitySessionEvidence: entity.protocol.activitySessionEvidence,
      frequency: entity.protocol.frequency,
      durationMinutes: entity.protocol.durationMinutes,
      temperatureC: entity.protocol.temperatureC,
      targetSessions: entity.protocol.interventionSessionsTarget,
      minimumUsefulSessions: entity.protocol.interventionSessionsMinimum,
      stopConditions: entity.protocol.stopConditions,
    }),
  )
}

function assertProtocolRevisionExpectation(input: {
  actual: string | null | undefined
  expected: string | undefined
  optionName: 'page-revision-id' | 'run-spec-revision-id'
  protocolKey: string
}) {
  if (input.expected === undefined) {
    return
  }

  if (input.expected !== input.actual) {
    throw new VaultCliError(
      'invalid_option',
      `--${input.optionName} revision expectation ${input.expected} does not match current ${input.protocolKey} revision ${input.actual ?? 'none'}. Refresh the protocol and retry.`,
    )
  }
}

function assertPrimaryOutcomeIsCapturable(input: {
  biomarkerKey: string
  primaryOutcome: ExperimentPrimaryOutcome | undefined
  sessionFields: readonly string[] | undefined
}) {
  const seenSessionMetrics = new Map<string, string>()
  for (const sessionField of input.sessionFields ?? []) {
    const spec = resolveExperimentSessionMetricSpec(sessionField)
    if (!spec) {
      continue
    }
    const previousField = seenSessionMetrics.get(spec.key)
    if (previousField) {
      throw new VaultCliError(
        'invalid_option',
        `Session fields ${previousField} and ${sessionField} both resolve to canonical metric ${spec.key}; declare exactly one alias.`,
      )
    }
    seenSessionMetrics.set(spec.key, sessionField)
  }

  if (input.primaryOutcome?.kind === 'structured_review') {
    return
  }
  const configuredCapture =
    input.primaryOutcome?.kind === 'metric'
      ? input.primaryOutcome.capture
      : undefined
  if (configuredCapture?.kind === 'session_field') {
    if (
      (input.sessionFields ?? []).filter(
        (fieldId) => fieldId === configuredCapture.fieldId,
      ).length === 1
    ) {
      return
    }
    throw new VaultCliError(
      'invalid_option',
      `Primary outcome ${input.biomarkerKey} requires --session-field ${configuredCapture.fieldId}.`,
    )
  }
  if (configuredCapture?.kind === 'derived_metric') {
    return
  }

  const capture = assessExperimentPrimaryMetricCapture({
    primaryBiomarkerKey: input.biomarkerKey,
    sessionFields: input.sessionFields,
  })
  if (capture.issue === 'uncapturable_primary_biomarker') {
    throw new VaultCliError(
      'invalid_option',
      `Primary outcome ${input.biomarkerKey} requires a matching declared --session-field so Murph can capture and analyze it.`,
    )
  }
}

function buildPrimaryOutcomeFromOptions(input: {
  comparisonStatistic?: ExperimentOutcomeStatistic
  existing?: ExperimentPrimaryOutcome
  legacyOutcomeKey?: string
  primaryOutcomeKey?: string
  primaryOutcomeSessionField?: string
  primaryOutcomeSourceMetricKey?: string
  primaryOutcomeKind?: z.infer<typeof experimentPrimaryOutcomeKindSchema>
  primaryOutcomeLabel?: string
  primaryOutcomeUnit?: string
}): ExperimentPrimaryOutcome | undefined {
  const touched =
    input.primaryOutcomeKey !== undefined ||
    input.primaryOutcomeKind !== undefined ||
    input.primaryOutcomeLabel !== undefined ||
    input.comparisonStatistic !== undefined ||
    input.primaryOutcomeSessionField !== undefined ||
    input.primaryOutcomeSourceMetricKey !== undefined ||
    input.primaryOutcomeUnit !== undefined
  if (!touched) {
    return input.existing
  }

  const kind = input.primaryOutcomeKind ?? input.existing?.kind ?? 'metric'
  const key =
    input.primaryOutcomeKey?.trim() ||
    input.existing?.key ||
    input.legacyOutcomeKey
  if (!key) {
    throw new VaultCliError(
      'invalid_option',
      'A configured primary outcome requires --primary-outcome-key as its stable outcome key.',
    )
  }
  const label = input.primaryOutcomeLabel?.trim() || input.existing?.label
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
      compactRecord({ kind, key, label }),
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
  const existingStatistic =
    input.existing?.kind === 'metric' ? input.existing.statistic : undefined
  const existingCapture =
    input.existing?.kind === 'metric' ? input.existing.capture : undefined
  const capture = input.primaryOutcomeSessionField !== undefined
    ? {
        kind: 'session_field' as const,
        fieldId: input.primaryOutcomeSessionField,
        unit: input.primaryOutcomeUnit,
      }
    : input.primaryOutcomeSourceMetricKey !== undefined
      ? {
          kind: 'derived_metric' as const,
          sourceMetricKey: input.primaryOutcomeSourceMetricKey,
        }
      : existingCapture
  return experimentPrimaryOutcomeSchema.parse(compactRecord({
    kind,
    key,
    label,
    statistic: input.comparisonStatistic ?? existingStatistic,
    capture,
  }))
}

function resolveStartWindows(input: {
  baselineStart?: string
  baselineEnd?: string
  baselineDays?: number
  clearBaselineWindow?: boolean
  interventionStart?: string
  interventionEnd?: string
  interventionDays?: number
}) {
  let baselineStart = input.clearBaselineWindow ? undefined : input.baselineStart
  let baselineEnd = input.clearBaselineWindow ? undefined : input.baselineEnd
  let interventionStart = input.interventionStart
  let interventionEnd = input.interventionEnd
  const baselineDays = input.baselineDays
  const hasBaselineDays = baselineDays !== undefined && baselineDays > 0

  if (baselineStart && hasBaselineDays) {
    baselineEnd ??= shiftLocalDate(baselineStart, baselineDays - 1)
  }
  if (baselineEnd && hasBaselineDays) {
    baselineStart ??= shiftLocalDate(baselineEnd, 1 - baselineDays)
  }
  if (interventionStart && input.interventionDays !== undefined) {
    interventionEnd ??= shiftLocalDate(interventionStart, input.interventionDays - 1)
  }
  if (interventionEnd && input.interventionDays !== undefined) {
    interventionStart ??= shiftLocalDate(interventionEnd, 1 - input.interventionDays)
  }
  if (!baselineEnd && interventionStart && hasBaselineDays) {
    baselineEnd = shiftLocalDate(interventionStart, -1)
    baselineStart ??= shiftLocalDate(baselineEnd, 1 - baselineDays)
  }
  if (!interventionStart && baselineEnd) {
    interventionStart = shiftLocalDate(baselineEnd, 1)
  }
  if (!interventionEnd && interventionStart && input.interventionDays !== undefined) {
    interventionEnd = shiftLocalDate(interventionStart, input.interventionDays - 1)
  }

  return {
    baselineStart,
    baselineEnd,
    interventionStart,
    interventionEnd,
  }
}

async function buildExperimentPlanPayloadFromTypedOptions(input: {
  slug: string
  options: {
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: z.infer<typeof experimentStatusSchema>
    body?: string
    fromProtocol?: string
    custom?: boolean
    publicProtocol?: boolean
    testPlanId?: string
    pageRevisionId?: string
    runSpecRevisionId?: string
    baselineStart?: string
    baselineEnd?: string
    baselineDays?: number
    interventionStart?: string
    interventionEnd?: string
    interventionDays?: number
    modality?: string
    scheduleKind?: z.infer<typeof experimentRunScheduleKindSchema>
    scheduleCron?: string
    scheduleLocalTime?: string
    scheduleTimeZone?: string
    dose?: string
    sessionsPerWeek?: number
    targetSessions?: number
    minimumUsefulSessions?: number
    sessionField?: string[]
    confounderField?: string[]
    stopCondition?: string[]
    primaryBiomarkerKey?: string
    primaryOutcomeKey?: string
    primaryOutcomeKind?: z.infer<typeof experimentPrimaryOutcomeKindSchema>
    primaryOutcomeLabel?: string
    primaryOutcomeSessionField?: string
    primaryOutcomeSourceMetricKey?: string
    primaryOutcomeUnit?: string
    comparisonStatistic?: z.infer<typeof experimentOutcomeStatisticSchema>
    secondaryBiomarkerKey?: string[]
    desiredDirection?: z.infer<typeof experimentSignalDirectionSchema>
    expectedDirection?: string[]
    analysisAnchor?: string[]
    plannedMeasurement?: string[]
    analysisNote?: string[]
    onboardingCompletedAt?: string
    setupAnswer?: readonly string[]
    safetyCautionLevel?: z.infer<typeof experimentSafetyCautionLevelSchema>
    safetyDisposition?: z.infer<typeof experimentSafetyDispositionSchema>
    positiveQuestionId?: readonly string[]
    safetyNote?: readonly string[]
    contextNote?: readonly string[]
    reminderPolicy?: string
    reminderOptionId?: string
    remindersEnabled?: boolean
    checkInCadence?: z.infer<typeof experimentCheckInCadenceSchema>
    notificationStyle?: z.infer<typeof experimentNotificationStyleSchema>
    missedLogFollowup?: z.infer<typeof experimentMissedLogFollowupSchema>
    weeklyDigestEnabled?: boolean
  }
}) {
  const fromProtocol = input.options.fromProtocol?.trim()
  const custom = input.options.custom === true

  if (fromProtocol !== undefined && custom) {
    throw new VaultCliError(
      'invalid_option',
      'experiment start accepts either --from-protocol or --custom, not both.',
    )
  }

  const noPublicProtocolFallback = input.options.publicProtocol === false
  const explicitNoPublicProtocolFallback = currentCommandIncludesFlag('--no-public-protocol')
  const explicitCustomFallback =
    custom &&
    noPublicProtocolFallback &&
    currentCommandIncludesFlag('--custom') &&
    explicitNoPublicProtocolFallback

  if (explicitNoPublicProtocolFallback && !custom) {
    throw new VaultCliError(
      'invalid_option',
      '--no-public-protocol is only valid with --custom.',
    )
  }

  if (fromProtocol === undefined && !custom) {
    throw new VaultCliError(
      'invalid_option',
      'experiment start must choose a source: use --from-protocol <key-or-route> for a Health Commons protocol-backed run. Only use --custom --no-public-protocol after Health Commons has no matching public protocol.',
    )
  }

  if (custom && !explicitCustomFallback) {
    throw new VaultCliError(
      'invalid_option',
      'custom experiment starts are disabled by default. Use --from-protocol <key-or-route> for protocol-backed runs, or include --custom --no-public-protocol in this command only after `vault-cli commons protocol explore <query> --format json` has no relevant public protocol. Config defaults do not count for this fallback.',
    )
  }

  if (
    custom &&
    (input.options.testPlanId !== undefined ||
      input.options.pageRevisionId !== undefined ||
      input.options.runSpecRevisionId !== undefined)
  ) {
    throw new VaultCliError(
      'invalid_option',
      '--test-plan-id, --page-revision-id, and --run-spec-revision-id are only valid with --from-protocol.',
    )
  }

  const protocol =
    fromProtocol === undefined
      ? undefined
      : await resolveProtocolVariantEntity(fromProtocol, 'from-protocol')
  if (protocol) {
    assertProtocolRevisionExpectation({
      actual: protocol.revision.pageRevisionId,
      expected: input.options.pageRevisionId,
      optionName: 'page-revision-id',
      protocolKey: protocol.key,
    })
    assertProtocolRevisionExpectation({
      actual: protocol.revision.runSpecRevisionId,
      expected: input.options.runSpecRevisionId,
      optionName: 'run-spec-revision-id',
      protocolKey: protocol.key,
    })
  }
  const testPlan = protocol
    ? resolveProtocolTestPlan({
        entity: protocol,
        testPlanId: input.options.testPlanId,
      })
    : undefined
  const onboarding = protocol?.experimentOnboarding
  const baselineDays =
    input.options.baselineDays ?? testPlan?.baselineDays
  const interventionDays =
    input.options.interventionDays ??
    testPlan?.interventionDays
  const windows = resolveStartWindows({
    baselineStart: input.options.baselineStart,
    baselineEnd: input.options.baselineEnd,
    baselineDays,
    clearBaselineWindow: input.options.baselineDays === 0,
    interventionStart: input.options.interventionStart,
    interventionEnd: input.options.interventionEnd,
    interventionDays,
  })

  if (!windows.interventionStart) {
    throw new VaultCliError(
      'invalid_option',
      'experiment start requires --intervention-start or enough typed window fields to derive it.',
    )
  }

  const effectiveProtocolSnapshot = protocol
    ? buildEffectiveSnapshotFromCommonsProtocol(protocol)
    : undefined

  const protocolSpec = protocol?.protocol
  const primaryBiomarkerKey =
    input.options.primaryBiomarkerKey ??
    onboarding?.adaptationPolicy?.measurementPlan?.requiredSignals?.[0] ??
    testPlan?.primaryBiomarkerKey
  if (
    input.options.primaryOutcomeKey !== undefined &&
    input.options.primaryBiomarkerKey !== undefined
  ) {
    throw new VaultCliError(
      'invalid_option',
      'experiment start accepts either --primary-outcome-key or the legacy --primary-biomarker-key, not both.',
    )
  }
  const primaryOutcome = buildPrimaryOutcomeFromOptions({
    comparisonStatistic: input.options.comparisonStatistic,
    legacyOutcomeKey: primaryBiomarkerKey,
    primaryOutcomeKey: input.options.primaryOutcomeKey,
    primaryOutcomeKind: input.options.primaryOutcomeKind,
    primaryOutcomeLabel: input.options.primaryOutcomeLabel,
    primaryOutcomeSessionField: input.options.primaryOutcomeSessionField,
    primaryOutcomeSourceMetricKey: input.options.primaryOutcomeSourceMetricKey,
    primaryOutcomeUnit: input.options.primaryOutcomeUnit,
  })
  const effectivePrimaryOutcomeKey = primaryOutcome?.key ?? primaryBiomarkerKey
  const secondaryBiomarkerKeys = uniqueNonEmptyStrings([
    ...(input.options.secondaryBiomarkerKey ?? []),
    ...(input.options.secondaryBiomarkerKey === undefined
      ? [
          ...(onboarding?.adaptationPolicy?.measurementPlan?.optionalSignals ?? []),
          ...(testPlan?.secondaryBiomarkerKeys ?? []),
        ]
      : []),
  ]).filter((key) => key !== effectivePrimaryOutcomeKey)
  const derivedExpectedDirections =
    effectivePrimaryOutcomeKey === undefined || protocol === undefined
      ? undefined
      : uniqueNonEmptyStrings([effectivePrimaryOutcomeKey, ...secondaryBiomarkerKeys]).flatMap(
          (biomarkerKey) => {
            const direction = mapExpectedSignalDirection(
              findExpectedSignal(protocol, biomarkerKey)?.expectedDirection,
            )
            return direction === undefined ? [] : [{ biomarkerKey, direction }]
          },
        )
  const expectedDirections =
    normalizeExpectedDirectionEntries(input.options.expectedDirection) ??
    (derivedExpectedDirections && derivedExpectedDirections.length > 0
      ? derivedExpectedDirections
      : undefined)
  const desiredDirection =
    input.options.desiredDirection ??
    (effectivePrimaryOutcomeKey && protocol
      ? mapExpectedSignalDirection(
          findExpectedSignal(protocol, effectivePrimaryOutcomeKey)?.expectedDirection,
        )
      : undefined)
  const schedule = buildRunScheduleFromOptions(input.options)
  const sessionFields =
    input.options.sessionField ??
    protocolSpec?.sessionFieldIds
  const confounderFields =
    input.options.confounderField ?? onboarding?.trackingHints?.confounderFields
  const onboardingCapture = buildExperimentOnboardingCaptureFromOptions({
    onboardingCompletedAt: input.options.onboardingCompletedAt,
    setupAnswer: input.options.setupAnswer,
    safetyCautionLevel: input.options.safetyCautionLevel,
    safetyDisposition: input.options.safetyDisposition,
    positiveQuestionId: input.options.positiveQuestionId,
    safetyNote: input.options.safetyNote,
    contextNote: input.options.contextNote,
  })
  const assistantSupport =
    buildExperimentAssistantSupportFromOptions({
      reminderPolicy: input.options.reminderPolicy,
      reminderOptionId: input.options.reminderOptionId,
      remindersEnabled: input.options.remindersEnabled,
      checkInCadence: input.options.checkInCadence,
      notificationStyle: input.options.notificationStyle,
      missedLogFollowup: input.options.missedLogFollowup,
      weeklyDigestEnabled: input.options.weeklyDigestEnabled,
    }) ?? experimentAssistantSupportSchema.parse({})

  const runPlan = experimentRunPlanSchema.parse(
    compactRecord({
      baselineStart: windows.baselineStart,
      baselineEnd: windows.baselineEnd,
      interventionStart: windows.interventionStart,
      interventionEnd: windows.interventionEnd,
      modality: truncateBoundedText(input.options.modality ?? protocolSpec?.target, 160),
      schedule,
      dose: truncateBoundedText(input.options.dose ?? protocolSpec?.doseSignature, 160),
      sessionsPerWeek:
        input.options.sessionsPerWeek ??
        protocolSpec?.frequency?.sessionsPerWeek,
      targetSessions:
        input.options.targetSessions ??
        testPlan?.targetAdherenceSessions ??
        protocolSpec?.interventionSessionsTarget,
      minimumUsefulSessions:
        input.options.minimumUsefulSessions ??
        testPlan?.minimumAdherenceSessions ??
        protocolSpec?.interventionSessionsMinimum,
      logging:
        sessionFields === undefined
          ? undefined
          : compactRecord({
              sessionFields,
              confounderFields,
            }),
      stopConditions: input.options.stopCondition ?? protocolSpec?.stopConditions,
    }),
  )
  const analysisPlan = experimentAnalysisPlanSchema.parse(
    compactRecord({
      primaryBiomarkerKey: primaryOutcome ? undefined : primaryBiomarkerKey,
      primaryOutcome,
      secondaryBiomarkerKeys:
        secondaryBiomarkerKeys.length > 0 ? secondaryBiomarkerKeys : undefined,
      desiredDirection,
      expectedDirections,
      measurementAnchors: normalizeExperimentMeasurementAnchorFlagOption(
        input.options.analysisAnchor,
        undefined,
      ),
      plannedMeasurements: normalizeExperimentPlannedMeasurementFlagOption(
        input.options.plannedMeasurement,
        undefined,
      ),
      notes: input.options.analysisNote,
    }),
  )

  const resolvedPrimaryOutcomeKey =
    analysisPlan.primaryOutcome?.key ?? analysisPlan.primaryBiomarkerKey
  if (!resolvedPrimaryOutcomeKey) {
    const missingPrimaryOutcomeMessage =
      protocol === undefined
        ? 'Custom experiment starts require --primary-outcome-key biomarker:<outcome-slug> because there is no protocol/test-plan default primary outcome.'
        : 'experiment start requires --primary-outcome-key or a protocol/test-plan default primary outcome.'

    throw new VaultCliError(
      'invalid_option',
      missingPrimaryOutcomeMessage,
    )
  }

  assertPrimaryOutcomeIsCapturable({
    biomarkerKey: resolvedPrimaryOutcomeKey,
    primaryOutcome: analysisPlan.primaryOutcome,
    sessionFields: runPlan.logging?.sessionFields,
  })

  return jsonObjectSchema.parse(
    compactRecord({
      schemaVersion: 'murph.experiment-plan.v1',
      source: {
        kind: protocol === undefined ? 'custom' : 'health_commons_protocol',
      },
      experiment: compactRecord({
        slug: input.slug,
        title: input.options.title ?? protocol?.title ?? input.slug,
        hypothesis: input.options.hypothesis,
        startedOn: input.options.startedOn ?? windows.interventionStart,
        status: input.options.status ?? 'active',
        body: input.options.body,
      }),
      commonsProtocolRef:
        protocol === undefined
          ? undefined
          : compactRecord({
              key: protocol.key,
              pageRevisionId: protocol.revision.pageRevisionId,
              runSpecRevisionId: protocol.revision.runSpecRevisionId,
              testPlanId: testPlan?.planId,
            }),
      effectiveProtocolSnapshot,
      runPlan,
      analysisPlan,
      onboarding: onboardingCapture,
      assistantSupport,
    }),
  )
}

async function hydrateExperimentProtocolDefaults(input: {
  services: VaultServices
  vault: string
  requestId: string | null
  lookup: string
  options: {
    status?: z.infer<typeof experimentStatusSchema>
    protocolKey?: string
    testPlanId?: string
    interventionStart?: string
    interventionEnd?: string
    interventionDays?: number
    baselineStart?: string
    baselineEnd?: string
    baselineDays?: number
    onboardingCompletedAt?: string
    setupAnswer?: readonly string[]
    safetyCautionLevel?: z.infer<typeof experimentSafetyCautionLevelSchema>
    safetyDisposition?: z.infer<typeof experimentSafetyDispositionSchema>
    positiveQuestionId?: readonly string[]
    safetyNote?: readonly string[]
    contextNote?: readonly string[]
    skipAnalysisPlanDefaults?: boolean
  }
}) {
  const shown = await input.services.query.showExperiment({
    vault: input.vault,
    requestId: input.requestId,
    lookup: input.lookup,
  })
  const { experimentSlug, relatedIds, ...frontmatterData } = shown.entity.data
  void experimentSlug
  void relatedIds
  const current = experimentFrontmatterSchema.parse(frontmatterData)
  const protocolKey = input.options.protocolKey ?? current.commonsProtocolRef?.key
  const clearBaselineWindow = input.options.baselineDays === 0

  if (protocolKey === undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--hydrate-protocol-defaults requires --protocol-key when the experiment has no commonsProtocolRef.',
    )
  }

  const payload = await buildExperimentPlanPayloadFromTypedOptions({
    slug: current.slug,
    options: {
      fromProtocol: protocolKey,
      testPlanId: input.options.testPlanId ?? current.commonsProtocolRef?.testPlanId,
      baselineStart: input.options.baselineStart ?? current.runPlan?.baselineStart,
      baselineEnd: input.options.baselineEnd ?? current.runPlan?.baselineEnd,
      baselineDays: input.options.baselineDays,
      interventionStart:
        input.options.interventionStart ?? current.runPlan?.interventionStart,
      interventionEnd: input.options.interventionEnd ?? current.runPlan?.interventionEnd,
      interventionDays: input.options.interventionDays,
    },
  })

  const defaultRunPlan = experimentRunPlanSchema.parse(payload.runPlan)
  const currentRunPlan = clearBaselineWindow
    ? omitRunBaselineWindow(current.runPlan)
    : current.runPlan
  const defaultAnalysisPlan =
    input.options.skipAnalysisPlanDefaults === true
      ? undefined
      : experimentAnalysisPlanSchema.parse(payload.analysisPlan)
  const defaultAssistantSupport = experimentAssistantSupportSchema.parse(
    payload.assistantSupport,
  )
  const onboardingCapture = buildExperimentOnboardingCaptureFromOptions(
    {
      onboardingCompletedAt: input.options.onboardingCompletedAt,
      setupAnswer: input.options.setupAnswer,
      safetyCautionLevel: input.options.safetyCautionLevel,
      safetyDisposition: input.options.safetyDisposition,
      positiveQuestionId: input.options.positiveQuestionId,
      safetyNote: input.options.safetyNote,
      contextNote: input.options.contextNote,
    },
    current.onboarding,
  )
  const defaultRunLogging =
    defaultRunPlan.logging === undefined && current.runPlan?.logging === undefined
      ? undefined
      : {
          ...(defaultRunPlan.logging ?? {}),
          ...(current.runPlan?.logging ?? {}),
        }
  const defaultRunBaseline =
    defaultRunPlan.baseline === undefined && current.runPlan?.baseline === undefined
      ? undefined
      : {
          ...(defaultRunPlan.baseline ?? {}),
          ...(current.runPlan?.baseline ?? {}),
        }

  return input.services.core.updateExperiment({
    vault: input.vault,
    requestId: input.requestId,
    lookup: input.lookup,
    status: input.options.status,
    commonsProtocolRef:
      current.commonsProtocolRef ??
      commonsProtocolRefSchema.parse(payload.commonsProtocolRef),
    effectiveProtocolSnapshot:
      current.effectiveProtocolSnapshot ??
      effectiveProtocolSnapshotSchema.parse(payload.effectiveProtocolSnapshot),
    runPlan: experimentRunPlanSchema.parse({
      ...defaultRunPlan,
      ...(currentRunPlan ?? {}),
      logging: defaultRunLogging,
      baseline: defaultRunBaseline,
    }),
    analysisPlan:
      defaultAnalysisPlan === undefined
        ? current.analysisPlan
        : experimentAnalysisPlanSchema.parse({
            ...defaultAnalysisPlan,
            ...(current.analysisPlan ?? {}),
          }),
    assistantSupport: experimentAssistantSupportSchema.parse({
      ...defaultAssistantSupport,
      ...(current.assistantSupport ?? {}),
    }),
    onboarding: onboardingCapture,
  })
}

function omitRunBaselineWindow(
  runPlan: z.infer<typeof experimentRunPlanSchema> | undefined,
) {
  if (runPlan === undefined) {
    return undefined
  }

  const { baselineStart, baselineEnd, ...withoutRunBaselineWindow } = runPlan
  void baselineStart
  void baselineEnd
  return withoutRunBaselineWindow
}

type ExperimentSessionConfounderValue = string | number | boolean | null
type ExperimentSessionConfounderMap = Record<
  string,
  ExperimentSessionConfounderValue
>
type ExperimentSessionFieldMap = ExperimentSessionConfounderMap

function resolveExperimentSessionStatus(input: {
  sessionStatus?: z.infer<typeof experimentSessionStatusSchema>
  status?: z.infer<typeof experimentSessionStatusSchema>
}) {
  if (
    input.status !== undefined &&
    input.sessionStatus !== undefined &&
    input.status !== input.sessionStatus
  ) {
    throw new VaultCliError(
      'invalid_option',
      '--status and --session-status must match when both are provided.',
    )
  }

  return input.sessionStatus ?? input.status
}

function parseExperimentSessionConfounderEntries(
  value: readonly string[] | undefined,
): ExperimentSessionConfounderMap | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const confounders: ExperimentSessionConfounderMap = {}

  for (const entry of value) {
    const separatorIndex = entry.indexOf('=')

    if (separatorIndex < 0) {
      throw new VaultCliError(
        'invalid_option',
        '--confounder entries must use key=value form.',
      )
    }

    const key = entry.slice(0, separatorIndex).trim()
    const rawValue = entry.slice(separatorIndex + 1).trim()

    if (!key) {
      throw new VaultCliError(
        'invalid_option',
        '--confounder entries must include a non-empty key before "=".',
      )
    }

    if (!rawValue) {
      throw new VaultCliError(
        'invalid_option',
        `--confounder ${key}= must include a non-empty value.`,
      )
    }

    confounders[key] = coerceExperimentSessionConfounderValue(rawValue)
  }

  return Object.keys(confounders).length > 0 ? confounders : undefined
}

function parseExperimentSessionFieldEntries(
  value: readonly string[] | undefined,
): ExperimentSessionFieldMap | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const fields: ExperimentSessionFieldMap = {}

  for (const entry of value) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex < 0) {
      throw new VaultCliError(
        'invalid_option',
        '--field entries must use id=value form.',
      )
    }

    const fieldId = entry.slice(0, separatorIndex).trim()
    const rawValue = entry.slice(separatorIndex + 1).trim()
    if (!fieldId) {
      throw new VaultCliError(
        'invalid_option',
        '--field entries must include a non-empty id before "=".',
      )
    }
    if (!rawValue) {
      throw new VaultCliError(
        'invalid_option',
        `--field ${fieldId}= must include a non-empty value.`,
      )
    }
    if (Object.hasOwn(fields, fieldId)) {
      throw new VaultCliError(
        'invalid_option',
        `--field ${fieldId} was provided more than once.`,
      )
    }

    fields[fieldId] = coerceExperimentSessionConfounderValue(rawValue)
  }

  return Object.keys(fields).length > 0 ? fields : undefined
}

function coerceExperimentSessionConfounderValue(
  value: string,
): ExperimentSessionConfounderValue {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  if (value === 'null') {
    return null
  }

  const numericValue = looksLikeNumberLiteral(value) ? Number(value) : undefined
  if (numericValue !== undefined && Number.isFinite(numericValue)) {
    return numericValue
  }

  return value
}

function looksLikeNumberLiteral(value: string): boolean {
  return /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?$/iu.test(value)
}

function resolveExperimentSessionConfounders(input: {
  list?: string[]
  map?: ExperimentSessionConfounderMap
}) {
  if (input.list !== undefined && input.map !== undefined) {
    throw new VaultCliError(
      'invalid_option',
      'Use either repeatable --confounders list entries or repeatable --confounder key=value map entries, not both.',
    )
  }

  return input.map ?? input.list
}

function normalizeSetupAnswerOptions(value: readonly string[] | undefined) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  return entries.length > 0 ? entries : undefined
}

const experimentListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: experimentStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listEntitySchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

const experimentUpdateResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  experimentPath: pathSchema,
  status: experimentStatusSchema,
  updated: z.boolean(),
})

const experimentLifecycleResultSchema = experimentUpdateResultSchema.extend({
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
})

const experimentSessionLogResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  kind: z.literal('intervention_session'),
  progress: experimentProgressSnapshotSchema.optional(),
})

const experimentSessionAttachResultSchema = showResultSchema.extend({
  eventId: interventionSessionEventIdSchema,
  lookupId: interventionSessionEventIdSchema,
  experimentId: z.string().min(1).nullable(),
  experimentSlug: slugSchema.nullable(),
  linked: z.boolean(),
})

const experimentContextLogResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  kind: z.enum(['note', 'supplement_intake', 'experiment_context']),
})

const experimentProgressResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  progress: experimentProgressSnapshotSchema,
})

const experimentProgressCardResultSchema = z.object({
  experimentId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  card: experimentProgressCardSchema,
  media: z.object({
    kind: z.literal('vault_image'),
    ref: z.string().min(1).max(1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    filename: z.string().min(1).max(255),
    contentType: z.literal('image/png'),
    sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
    alt: z.string().min(1).max(500).nullable(),
    source: z.string().min(1).max(200).nullable(),
  }).strict(),
  warnings: z.array(z.string().min(1)),
})

function parseExperimentProgressCardConfounderOptions(
  values: readonly string[] | undefined,
): Array<{ date: string; label: string }> {
  const entries = normalizeRepeatableTextFlagOption(values) ?? []
  if (entries.length > EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS) {
    throw new VaultCliError(
      'invalid_payload',
      `--confounder accepts at most ${EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS} entries.`,
    )
  }

  return entries.map((entry) => {
    const separatorIndex = entry.indexOf(':')
    const date = separatorIndex > 0 ? entry.slice(0, separatorIndex) : ''
    const label = separatorIndex > 0 ? entry.slice(separatorIndex + 1).trim() : ''
    if (!isStrictIsoDate(date) || label.length === 0 || label.length > 60) {
      throw new VaultCliError(
        'invalid_payload',
        `Invalid --confounder value "${entry}". Expected "YYYY-MM-DD:label" with a strict date and a 1-60 character label.`,
      )
    }

    return { date, label }
  })
}

const experimentFollowupDueDecisionSchema = z.object({
  schema: z.literal('murph.experiment-followup-due.v1'),
  kind: experimentFollowupKindSchema,
  action: experimentFollowupActionSchema,
  reason: experimentFollowupReasonSchema,
  date: localDateSchema,
  dedupeKey: z.string().min(1),
  experiment: z.object({
    id: z.string().min(1),
    slug: slugSchema,
    status: experimentStatusSchema,
    title: z.string().min(1),
  }),
  window: z.object({
    sessionDate: localDateSchema.nullable(),
    baselineStart: localDateSchema.nullable(),
    baselineEnd: localDateSchema.nullable(),
    interventionStart: localDateSchema.nullable(),
    interventionEnd: localDateSchema.nullable(),
  }),
})

const experimentFollowupDueResultSchema = z.object({
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  kind: experimentFollowupKindSchema,
  date: localDateSchema,
  decision: experimentFollowupDueDecisionSchema,
})

const experimentOutcomeResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  outcome: experimentOutcomeSchema,
  outcomePath: pathSchema.nullable().optional(),
  updatedExperiment: z.boolean().optional(),
})

const experimentPlanSummarySchema = z.object({
  planId: z.string().min(1).nullable(),
  materialAdaptation: z.boolean(),
  needsPrivateProtocol: z.boolean(),
  reasons: z.array(z.string().min(1)),
  operations: z.array(z.string().min(1)),
})

const experimentPlanResultSchema = z.object({
  vault: pathSchema,
  plan: experimentPlanSummarySchema,
})

const experimentStartResultSchema = z.object({
  vault: pathSchema,
  dryRun: z.boolean(),
  plan: experimentPlanSummarySchema,
  experimentId: z.string().min(1).optional(),
  lookupId: z.string().min(1).optional(),
  slug: slugSchema.optional(),
  experimentPath: pathSchema.optional(),
  status: experimentStatusSchema.optional(),
  created: z.boolean().optional(),
  updated: z.boolean().optional(),
  protocol: z
    .object({
      protocolId: z.string().min(1),
      slug: slugSchema,
      title: z.string().min(1),
      protocolRevisionId: z.string().min(1),
      effectiveSpecHash: z.string().min(1),
      path: pathSchema,
      created: z.boolean(),
    })
    .nullable(),
  experiment: z
    .object({
      experimentId: z.string().min(1),
      lookupId: z.string().min(1),
      slug: slugSchema,
      experimentPath: pathSchema,
      status: experimentStatusSchema,
      created: z.boolean(),
      updated: z.boolean(),
    })
    .nullable(),
})

export function registerExperimentCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  installExperimentCommandArgvContext(cli)

  const experiment = Cli.create('experiment', {
    description: 'Experiment bank commands routed through the core write and query APIs.',
  })

  experiment.command('start', {
    description:
      'Start a typed experiment run from a Health Commons protocol; custom runs require explicit no-public-protocol fallback.',
    args: z.object({
      slug: slugSchema,
    }),
    options: withBaseOptions({
      title: z.string().min(1).optional().describe('Optional human-readable title.'),
      hypothesis: z.string().min(1).optional().describe('Optional experiment hypothesis.'),
      startedOn: localDateSchema.optional().describe('Optional experiment start date.'),
      status: experimentStatusSchema.optional().describe('Optional experiment status.'),
      body: z.string().min(1).optional().describe('Optional markdown body.'),
      fromProtocol: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Health Commons protocol_variant key or experiment route id. This is the default experiment-start path whenever a public protocol exists.',
        ),
      custom: z
        .boolean()
        .optional()
        .describe(
          'Fallback for an intentionally unlinked custom experiment. Requires --no-public-protocol and should only follow a Health Commons protocol search/explore with no relevant match.',
        ),
      publicProtocol: z
        .boolean()
        .optional()
        .describe(
          'Protocol-first guard for experiment starts. Pass --no-public-protocol with --custom in the current command only after confirming no relevant public Health Commons protocol is available; config defaults do not count.',
        ),
      testPlanId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Chosen Health Commons test plan id for this run. Only valid with --from-protocol.',
        ),
      pageRevisionId: sha256RevisionOptionSchema
        .optional()
        .describe('Expected current protocol page revision. Fails on mismatch; only valid with --from-protocol.'),
      runSpecRevisionId: sha256RevisionOptionSchema
        .optional()
        .describe('Expected current protocol run-spec revision. Fails on mismatch; only valid with --from-protocol.'),
      baselineStart: localDateSchema.optional().describe('Baseline window start date.'),
      baselineEnd: localDateSchema.optional().describe('Baseline window end date.'),
      baselineDays: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Baseline length in days when deriving a baseline window.'),
      interventionStart: localDateSchema
        .optional()
        .describe('Intervention window start date.'),
      interventionEnd: localDateSchema.optional().describe('Intervention window end date.'),
      interventionDays: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Intervention length in days when deriving an intervention window.'),
      modality: z.string().min(1).optional().describe('Intervention modality label.'),
      scheduleKind: experimentRunScheduleKindSchema
        .optional()
        .describe('Run-plan schedule discriminator.'),
      scheduleCron: z
        .string()
        .min(1)
        .optional()
        .describe('Five-field cron expression when --schedule-kind=cron.'),
      scheduleLocalTime: z
        .string()
        .min(1)
        .optional()
        .describe('HH:MM local time when --schedule-kind=dailyLocal.'),
      scheduleTimeZone: z
        .string()
        .min(1)
        .optional()
        .describe('IANA time zone for the run-plan schedule.'),
      dose: z.string().min(1).optional().describe('Plain-language dose string.'),
      sessionsPerWeek: z
        .number()
        .nonnegative()
        .optional()
        .describe('Planned sessions per week for adherence calculations.'),
      targetSessions: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Target session count across the intervention window.'),
      minimumUsefulSessions: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Minimum useful session count for interpreting the run.'),
      sessionField: repeatableTextOptionSchema(
        'Logging session field ids. Repeat --session-field for multiple values.',
      ),
      confounderField: repeatableTextOptionSchema(
        'Logging confounder field ids. Repeat --confounder-field for multiple values.',
      ),
      stopCondition: repeatableTextOptionSchema(
        'Stop condition text. Repeat --stop-condition for multiple values.',
      ),
      primaryBiomarkerKey: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Legacy primary biomarker identity. Prefer --primary-outcome-key for new runs.',
        ),
      primaryOutcomeKey: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Stable first-class primary outcome identity. Required for new custom runs; use biomarker:<outcome-slug>.',
        ),
      primaryOutcomeKind: experimentPrimaryOutcomeKindSchema
        .optional()
        .describe(
          'Primary outcome mode: metric for numeric/queryable outcomes or structured_review for qualitative evidence that should not be converted into a score.',
        ),
      primaryOutcomeLabel: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Human-readable primary outcome label for results and reviews.'),
      primaryOutcomeSessionField: z
        .string()
        .min(1)
        .optional()
        .describe('Declared session field that supplies a custom numeric primary outcome.'),
      primaryOutcomeUnit: z
        .string()
        .min(1)
        .optional()
        .describe('Unit for a custom numeric session-field outcome.'),
      primaryOutcomeSourceMetricKey: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Registered metric source or already observed metric source reduced into a deterministic derived outcome. User-authored formulas are not supported.',
        ),
      comparisonStatistic: experimentOutcomeStatisticSchema
        .optional()
        .describe(
          'Reducer for a metric outcome inside each window: count, latest, mean, median, min, max, or sum. Defaults to mean.',
        ),
      secondaryBiomarkerKey: repeatableTextOptionSchema(
        'Secondary metric or biomarker identities. Repeat --secondary-biomarker-key for multiple values.',
      ),
      desiredDirection: experimentSignalDirectionSchema
        .optional()
        .describe('Expected direction for the primary biomarker.'),
      expectedDirection: repeatableTextOptionSchema(
        'Per-biomarker expected direction as biomarker:key=increase|decrease|stabilize. Repeat --expected-direction for multiple biomarkers.',
      ),
      analysisAnchor: repeatableTextOptionSchema(
        'Observed analysis measurement anchor as role=baseline,kind=lab_panel,recordId=evt_...,biomarkerKeys=biomarker:key. Repeat --analysis-anchor for multiple records.',
      ),
      plannedMeasurement: repeatableTextOptionSchema(
        'Planned analysis measurement as role=followup,kind=lab_panel,window=YYYY-MM-DD..YYYY-MM-DD,biomarkerKeys=biomarker:key. Repeat --planned-measurement for multiple records.',
      ),
      analysisNote: repeatableTextOptionSchema(
        'Analysis plan note. Repeat --analysis-note for multiple values.',
      ),
      ...experimentOnboardingOptionSchemas,
      ...experimentAssistantSupportOptionSchemas,
      dryRun: z
        .boolean()
        .optional()
        .describe('Validate the typed start payload without writing vault records.'),
    }),
    output: experimentStartResultSchema,
    async run({ args, options }) {
      const payload = await buildExperimentPlanPayloadFromTypedOptions({
        slug: args.slug,
        options: {
          ...options,
          status: options.status,
          sessionField: normalizeRepeatableFlagOption(
            options.sessionField,
            'session-field',
          ),
          confounderField: normalizeRepeatableFlagOption(
            options.confounderField,
            'confounder-field',
          ),
          stopCondition: normalizeRepeatableTextFlagOption(options.stopCondition),
          secondaryBiomarkerKey: normalizeRepeatableFlagOption(
            options.secondaryBiomarkerKey,
            'secondary-biomarker-key',
          ),
          expectedDirection: normalizeRepeatableFlagOption(
            options.expectedDirection,
            'expected-direction',
          ),
          analysisAnchor: options.analysisAnchor,
          plannedMeasurement: options.plannedMeasurement,
          analysisNote: normalizeRepeatableTextFlagOption(options.analysisNote),
          setupAnswer: normalizeSetupAnswerOptions(options.setupAnswer),
          positiveQuestionId: normalizeRepeatableFlagOption(
            options.positiveQuestionId,
            'positive-question-id',
          ),
          safetyNote: normalizeRepeatableTextFlagOption(options.safetyNote),
          contextNote: normalizeRepeatableTextFlagOption(options.contextNote),
        },
      })

      if (options.dryRun) {
        const result = await services.core.planExperiment({
          vault: String(options.vault ?? ''),
          requestId: requestIdFromOptions(options),
          payload,
        })

        return {
          vault: result.vault,
          dryRun: true,
          plan: result.plan,
          protocol: null,
          experiment: null,
        }
      }

      const result = await services.core.startExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        payload,
      })
      return {
        ...result,
        dryRun: false,
        ...result.experiment,
      }
    },
  })

  experiment.command('show', {
    description: 'Show one experiment by canonical id or slug.',
    args: experimentLookupArgSchema,
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return services.query.showExperiment({
        lookup: args.id,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  experiment.command('list', {
    description: 'List experiments through the query read model.',
    args: z.object({}),
    options: withBaseOptions({
      limit: commonListLimitOptionSchema,
      status: experimentStatusSchema.optional().describe('Optional experiment status filter.'),
    }),
    output: experimentListResultSchema,
    async run({ options }) {
      return services.query.listExperiments({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        status: options.status,
        limit: options.limit,
      })
    },
  })

  experiment.command('edit', {
    description:
      'Edit scalar fields and structured experiment setup fields using typed options.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      title: z.string().min(1).optional().describe('Optional human-readable title.'),
      hypothesis: z.string().min(1).optional().describe('Optional experiment hypothesis.'),
      startedOn: localDateSchema.optional().describe('Optional experiment start date.'),
      status: experimentStatusSchema
        .optional()
        .describe('Optional lifecycle status to set on the experiment.'),
      body: z.string().min(1).optional().describe('Optional replacement markdown body.'),
      tag: z
        .array(slugSchema)
        .optional()
        .describe('Optional tags to store on the experiment. Repeat --tag for multiple values.'),
      protocolKey: z
        .string()
        .min(1)
        .optional()
        .describe('Health Commons protocol variant key to store under commonsProtocolRef.key.'),
      pageRevisionId: sha256RevisionOptionSchema
        .optional()
        .describe('Protocol page content revision id in sha256:<64 lowercase hex> form.'),
      runSpecRevisionId: sha256RevisionOptionSchema
        .optional()
        .describe('Protocol run spec revision id in sha256:<64 lowercase hex> form.'),
      testPlanId: z
        .string()
        .min(1)
        .optional()
        .describe('Chosen Health Commons test plan id for this run.'),
      baselineStart: localDateSchema
        .optional()
        .describe('Canonical baseline window start date.'),
      baselineEnd: localDateSchema.optional().describe('Canonical baseline window end date.'),
      baselineDays: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Baseline length in days; requires baseline-start, baseline-end, or intervention-start.',
        ),
      interventionStart: localDateSchema
        .optional()
        .describe('Canonical intervention window start date.'),
      interventionEnd: localDateSchema
        .optional()
        .describe('Canonical intervention window end date.'),
      interventionDays: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Intervention length in days; requires intervention-start, intervention-end, or a baseline window.',
        ),
      modality: z.string().min(1).optional().describe('Intervention modality label.'),
      scheduleKind: experimentRunScheduleKindSchema
        .optional()
        .describe('Run-plan schedule discriminator for structured schedule flags.'),
      scheduleCron: z
        .string()
        .min(1)
        .optional()
        .describe('Five-field cron expression when --schedule-kind=cron.'),
      scheduleLocalTime: z
        .string()
        .min(1)
        .optional()
        .describe('HH:MM local time when --schedule-kind=dailyLocal.'),
      scheduleTimeZone: z
        .string()
        .min(1)
        .optional()
        .describe('IANA time zone for the run-plan schedule.'),
      dose: z
        .string()
        .min(1)
        .optional()
        .describe('Plain-language dose string for the run plan.'),
      sessionsPerWeek: z
        .number()
        .nonnegative()
        .optional()
        .describe('Planned sessions per week for adherence calculations.'),
      targetSessions: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Target session count across the intervention window.'),
      minimumUsefulSessions: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Minimum useful session count for interpreting the run.'),
      sessionField: repeatableTextOptionSchema(
        'Logging session field ids. Repeat --session-field for multiple values.',
      ),
      confounderField: repeatableTextOptionSchema(
        'Logging confounder field ids. Repeat --confounder-field for multiple values.',
      ),
      stopCondition: repeatableTextOptionSchema(
        'Stop condition text. Repeat --stop-condition for multiple values.',
      ),
      primaryBiomarkerKey: z
        .string()
        .min(1)
        .optional()
        .describe('Legacy primary biomarker identity. Prefer --primary-outcome-key.'),
      primaryOutcomeKey: z
        .string()
        .min(1)
        .optional()
        .describe('Stable first-class primary outcome identity.'),
      primaryOutcomeKind: experimentPrimaryOutcomeKindSchema
        .optional()
        .describe('Primary outcome mode: metric or structured_review.'),
      primaryOutcomeLabel: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Human-readable primary outcome label for results and reviews.'),
      primaryOutcomeSessionField: z
        .string()
        .min(1)
        .optional()
        .describe('Declared session field that supplies a custom numeric primary outcome.'),
      primaryOutcomeUnit: z
        .string()
        .min(1)
        .optional()
        .describe('Unit for a custom numeric session-field outcome.'),
      primaryOutcomeSourceMetricKey: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Registered metric source or already observed metric source reduced into a deterministic derived outcome. User-authored formulas are not supported.',
        ),
      comparisonStatistic: experimentOutcomeStatisticSchema
        .optional()
        .describe('Reducer for a metric outcome: count, latest, mean, median, min, max, or sum.'),
      secondaryBiomarkerKey: repeatableTextOptionSchema(
        'Secondary metric or biomarker identities. Repeat --secondary-biomarker-key for multiple values.',
      ),
      desiredDirection: experimentSignalDirectionSchema
        .optional()
        .describe('Expected direction for the primary biomarker.'),
      expectedDirection: repeatableTextOptionSchema(
        'Per-biomarker expected direction as biomarker:key=increase|decrease|stabilize. Repeat --expected-direction for multiple biomarkers.',
      ),
      analysisAnchor: repeatableTextOptionSchema(
        'Observed analysis measurement anchor as role=baseline,kind=lab_panel,recordId=evt_...,biomarkerKeys=biomarker:key. Repeat --analysis-anchor for multiple records.',
      ),
      plannedMeasurement: repeatableTextOptionSchema(
        'Planned analysis measurement as role=followup,kind=lab_panel,window=YYYY-MM-DD..YYYY-MM-DD,biomarkerKeys=biomarker:key. Repeat --planned-measurement for multiple records.',
      ),
      analysisNote: repeatableTextOptionSchema(
        'Analysis plan note. Repeat --analysis-note for multiple values.',
      ),
      ...experimentOnboardingOptionSchemas,
      ...experimentAssistantSupportOptionSchemas,
      hydrateProtocolDefaults: z
        .boolean()
        .optional()
        .describe(
          'Fill missing structured setup fields from the selected Health Commons protocol without replacing existing values.',
        ),
    }),
    output: experimentUpdateResultSchema,
    async run({ args, options }) {
      const hasStructuredHydration = options.hydrateProtocolDefaults === true
      const hasTypedSetupFields =
        options.protocolKey !== undefined ||
        options.pageRevisionId !== undefined ||
        options.runSpecRevisionId !== undefined ||
        options.testPlanId !== undefined ||
        options.baselineStart !== undefined ||
        options.baselineEnd !== undefined ||
        options.baselineDays !== undefined ||
        options.interventionStart !== undefined ||
        options.interventionEnd !== undefined ||
        options.interventionDays !== undefined ||
        options.modality !== undefined ||
        hasRunScheduleFlag(options) ||
        options.dose !== undefined ||
        options.sessionsPerWeek !== undefined ||
        options.targetSessions !== undefined ||
        options.minimumUsefulSessions !== undefined ||
        options.sessionField !== undefined ||
        options.confounderField !== undefined ||
        options.stopCondition !== undefined ||
        options.primaryBiomarkerKey !== undefined ||
        options.primaryOutcomeKey !== undefined ||
        options.primaryOutcomeKind !== undefined ||
        options.primaryOutcomeLabel !== undefined ||
        options.primaryOutcomeSessionField !== undefined ||
        options.primaryOutcomeSourceMetricKey !== undefined ||
        options.primaryOutcomeUnit !== undefined ||
        options.comparisonStatistic !== undefined ||
        options.secondaryBiomarkerKey !== undefined ||
        options.desiredDirection !== undefined ||
        options.expectedDirection !== undefined ||
        options.analysisAnchor !== undefined ||
        options.plannedMeasurement !== undefined ||
        options.analysisNote !== undefined ||
        options.onboardingCompletedAt !== undefined ||
        options.setupAnswer !== undefined ||
        options.safetyCautionLevel !== undefined ||
        options.safetyDisposition !== undefined ||
        options.positiveQuestionId !== undefined ||
        options.safetyNote !== undefined ||
        options.contextNote !== undefined ||
        options.reminderPolicy !== undefined ||
        options.reminderOptionId !== undefined ||
        options.remindersEnabled !== undefined ||
        options.checkInCadence !== undefined ||
        options.notificationStyle !== undefined ||
        options.missedLogFollowup !== undefined ||
        options.weeklyDigestEnabled !== undefined
      const hasStructuredFields = hasStructuredHydration || hasTypedSetupFields
      const hasScalarWriteFields =
        options.title !== undefined ||
        options.hypothesis !== undefined ||
        options.startedOn !== undefined ||
        (options.status !== undefined && !hasStructuredFields) ||
        options.body !== undefined ||
        options.tag !== undefined
      const hasAnyUserField =
        hasScalarWriteFields ||
        options.status !== undefined ||
        hasStructuredFields

      if (!hasAnyUserField) {
        throw new VaultCliError(
          'invalid_option',
          'experiment edit requires at least one typed field to change.',
        )
      }

      if (!hasStructuredFields) {
        if (!hasScalarWriteFields) {
          throw new VaultCliError(
            'invalid_option',
            'experiment edit requires at least one typed field to change.',
          )
        }
        return services.core.updateExperiment({
          vault: String(options.vault ?? ''),
          requestId: requestIdFromOptions(options),
          lookup: args.id,
          title: options.title,
          hypothesis: options.hypothesis,
          startedOn: options.startedOn,
          status: options.status,
          body: options.body,
          tags: normalizeRepeatableFlagOption(options.tag, 'tag'),
        })
      }

      const hydrationResult = hasStructuredHydration
        ? await hydrateExperimentProtocolDefaults({
            services,
            vault: String(options.vault ?? ''),
            requestId: requestIdFromOptions(options),
            lookup: args.id,
            options: {
              status: options.status,
              protocolKey: options.protocolKey,
              testPlanId: options.testPlanId,
              baselineStart: options.baselineStart,
              baselineEnd: options.baselineEnd,
              baselineDays: options.baselineDays,
              interventionStart: options.interventionStart,
              interventionEnd: options.interventionEnd,
              interventionDays: options.interventionDays,
              onboardingCompletedAt: options.onboardingCompletedAt,
              setupAnswer: normalizeSetupAnswerOptions(options.setupAnswer),
              safetyCautionLevel: options.safetyCautionLevel,
              safetyDisposition: options.safetyDisposition,
              positiveQuestionId: normalizeRepeatableFlagOption(
                options.positiveQuestionId,
                'positive-question-id',
              ),
              safetyNote: normalizeRepeatableTextFlagOption(options.safetyNote),
              contextNote: normalizeRepeatableTextFlagOption(options.contextNote),
              skipAnalysisPlanDefaults:
                options.primaryBiomarkerKey !== undefined ||
                options.primaryOutcomeKey !== undefined ||
                options.primaryOutcomeKind !== undefined ||
                options.primaryOutcomeLabel !== undefined ||
                options.primaryOutcomeSessionField !== undefined ||
                options.primaryOutcomeSourceMetricKey !== undefined ||
                options.primaryOutcomeUnit !== undefined ||
                options.comparisonStatistic !== undefined ||
                options.secondaryBiomarkerKey !== undefined ||
                options.desiredDirection !== undefined ||
                options.expectedDirection !== undefined ||
                options.analysisAnchor !== undefined ||
                options.plannedMeasurement !== undefined ||
                options.analysisNote !== undefined,
            },
          })
        : undefined

      if (!hasTypedSetupFields && options.status === undefined) {
        if (hydrationResult === undefined) {
          throw new VaultCliError(
            'invalid_option',
            'experiment edit requires at least one typed field to change.',
          )
        }
        if (!hasScalarWriteFields) {
          return hydrationResult
        }
        return services.core.updateExperiment({
          vault: String(options.vault ?? ''),
          requestId: requestIdFromOptions(options),
          lookup: args.id,
          title: options.title,
          hypothesis: options.hypothesis,
          startedOn: options.startedOn,
          body: options.body,
          tags: normalizeRepeatableFlagOption(options.tag, 'tag'),
        })
      }

      const structuredResult = await services.core.applyExperimentOnboarding({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        status: options.status,
        protocolKey: options.protocolKey,
        pageRevisionId: options.pageRevisionId,
        runSpecRevisionId: options.runSpecRevisionId,
        testPlanId: options.testPlanId,
        baselineStart: options.baselineStart,
        baselineEnd: options.baselineEnd,
        baselineDays: options.baselineDays,
        interventionStart: options.interventionStart,
        interventionEnd: options.interventionEnd,
        interventionDays: options.interventionDays,
        modality: options.modality,
        schedule: buildRunScheduleFromOptions(options),
        dose: options.dose,
        sessionsPerWeek: options.sessionsPerWeek,
        targetSessions: options.targetSessions,
        minimumUsefulSessions: options.minimumUsefulSessions,
        sessionField: normalizeRepeatableFlagOption(
          options.sessionField,
          'session-field',
        ),
        confounderField: normalizeRepeatableFlagOption(
          options.confounderField,
          'confounder-field',
        ),
        stopCondition: normalizeRepeatableTextFlagOption(options.stopCondition),
        primaryBiomarkerKey: options.primaryBiomarkerKey,
        primaryOutcomeKey: options.primaryOutcomeKey,
        primaryOutcomeKind: options.primaryOutcomeKind,
        primaryOutcomeLabel: options.primaryOutcomeLabel,
        primaryOutcomeSessionField: options.primaryOutcomeSessionField,
        primaryOutcomeSourceMetricKey: options.primaryOutcomeSourceMetricKey,
        primaryOutcomeUnit: options.primaryOutcomeUnit,
        comparisonStatistic: options.comparisonStatistic,
        secondaryBiomarkerKey: normalizeRepeatableFlagOption(
          options.secondaryBiomarkerKey,
          'secondary-biomarker-key',
        ),
        desiredDirection: options.desiredDirection,
        expectedDirection: normalizeRepeatableFlagOption(
          options.expectedDirection,
          'expected-direction',
        ),
        analysisAnchor: options.analysisAnchor,
        plannedMeasurement: options.plannedMeasurement,
        analysisNote: normalizeRepeatableTextFlagOption(options.analysisNote),
        onboardingCompletedAt: options.onboardingCompletedAt,
        setupAnswer: normalizeSetupAnswerOptions(options.setupAnswer),
        safetyCautionLevel: options.safetyCautionLevel,
        safetyDisposition: options.safetyDisposition,
        positiveQuestionId: normalizeRepeatableFlagOption(
          options.positiveQuestionId,
          'positive-question-id',
        ),
        safetyNote: normalizeRepeatableTextFlagOption(options.safetyNote),
        contextNote: normalizeRepeatableTextFlagOption(options.contextNote),
        reminderPolicy: options.reminderPolicy,
        reminderOptionId: options.reminderOptionId,
        remindersEnabled: options.remindersEnabled,
        checkInCadence: options.checkInCadence,
        notificationStyle: options.notificationStyle,
        missedLogFollowup: options.missedLogFollowup,
        weeklyDigestEnabled: options.weeklyDigestEnabled,
      })

      if (!hasScalarWriteFields) {
        return structuredResult
      }

      return services.core.updateExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        title: options.title,
        hypothesis: options.hypothesis,
        startedOn: options.startedOn,
        body: options.body,
        tags: normalizeRepeatableFlagOption(options.tag, 'tag'),
      })
    },
  })

  experiment.command('checkpoint', {
    description: 'Append one experiment checkpoint event using typed fields.',
    args: experimentJournalLookupArgSchema,
    options: withBaseOptions({
      occurredAt: z
        .string()
        .min(1)
        .optional()
        .describe('Optional checkpoint timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      title: z.string().min(1).optional().describe('Optional checkpoint title.'),
      note: z.string().min(1).optional().describe('Optional checkpoint note.'),
    }),
    output: experimentLifecycleResultSchema,
    async run({ args, options }) {
      return services.core.checkpointExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.lookup,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        }),
        title: options.title,
        note: options.note,
      })
    },
  })

  experiment.command('stop', {
    description: 'Stop one experiment by id or slug and append a stop lifecycle event.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      occurredAt: z
        .string()
        .min(1)
        .optional()
        .describe('Optional stop timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      note: z.string().min(1).optional().describe('Optional stop note.'),
    }),
    output: experimentLifecycleResultSchema,
    async run({ args, options }) {
      return services.core.stopExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        }),
        note: typeof options.note === 'string' ? options.note : undefined,
      })
    },
  })

  experiment.command('progress', {
    description: 'Read the deterministic progress summary for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentProgressResultSchema,
    async run({ args, options }) {
      return services.query.showExperimentProgress({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  experiment.command('progress-card', {
    description:
      'Render one experiment progress card into a private vault image attachment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
      confounder: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Confounder annotation in "YYYY-MM-DD:label" form. Repeat --confounder for up to four entries.',
        ),
    }),
    output: experimentProgressCardResultSchema,
    async run({ args, options }) {
      const result = await services.query.showExperimentProgressCard({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
        confounders: parseExperimentProgressCardConfounderOptions(
          options.confounder,
        ),
      })
      const media = await renderAndSaveExperimentProgressCard({
        card: result.card,
        experimentId: result.experimentId,
        vaultRoot: options.vault,
      })
      return {
        experimentId: result.experimentId,
        slug: result.slug,
        asOf: result.asOf,
        card: result.card,
        media,
        warnings: [...result.warnings],
      }
    },
  })

  const followup = Cli.create('followup', {
    description: 'Experiment follow-up decision commands.',
  })

  followup.command('due', {
    description: 'Return the deterministic follow-up due decision for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      kind: experimentFollowupKindSchema.describe('Follow-up kind to evaluate.'),
      date: localDateSchema.optional().describe('Optional local session date in YYYY-MM-DD form.'),
    }),
    output: experimentFollowupDueResultSchema,
    async run({ args, options }) {
      return services.query.showExperimentFollowupDue({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        kind: options.kind,
        date: options.date,
      })
    },
  })

  const session = Cli.create('session', {
    description: 'Experiment session logging commands.',
  })

  session.command('log', {
    description: 'Log one structured intervention session for an experiment using typed fields.',
    args: experimentJournalLookupArgSchema,
    options: withBaseOptions({
      reminderIntentId: assistantOutboxIntentIdSchema
        .optional()
        .describe(
          'Provider-accepted private reminder intent id from trusted ordered conversation context. The canonical writer derives and deduplicates the occurrence from it.',
        ),
      date: localDateSchema
        .optional()
        .describe('Optional intended local session date in YYYY-MM-DD form.'),
      occurredAt: z
        .string()
        .min(1)
        .optional()
        .describe('Optional session timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceOptionSchema
        .optional()
        .describe('Optional event source for the session.'),
      title: z.string().min(1).optional().describe('Optional session title.'),
      note: z.string().optional().describe('Optional session note.'),
      interventionType: z
        .string()
        .min(1)
        .optional()
        .describe('Intervention type, inferred from the experiment run plan when omitted.'),
      status: experimentSessionStatusSchema
        .optional()
        .describe('Optional shorthand session status.'),
      sessionStatus: experimentSessionStatusSchema
        .optional()
        .describe('Optional canonical session status.'),
      durationMinutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Session duration in minutes.'),
      protocolId: z.string().min(1).optional().describe('Optional linked protocol id.'),
      timing: z.string().min(1).max(120).optional().describe('Optional timing label.'),
      temperatureC: z
        .number()
        .min(0)
        .max(200)
        .optional()
        .describe('Optional session temperature in degrees Celsius.'),
      afterExercise: z
        .boolean()
        .optional()
        .describe('Whether the session occurred after exercise.'),
      symptoms: z
        .array(z.string().min(1).max(160))
        .optional()
        .describe('Observed symptoms. Repeat --symptoms for multiple values.'),
      confounders: z
        .array(z.string().min(1))
        .optional()
        .describe('Potential confounders. Repeat --confounders for multiple values.'),
      confounder: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Potential confounder map entry in key=value form. Repeat --confounder for multiple entries.',
        ),
      field: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Declared session field in id=value form. Repeat --field for multiple typed values.',
        ),
    }),
    output: experimentSessionLogResultSchema,
    async run({ args, options }) {
      const sessionStatus = resolveExperimentSessionStatus({
        status: options.status,
        sessionStatus: options.sessionStatus,
      })
      const confounders = resolveExperimentSessionConfounders({
        list: normalizeRepeatableFlagOption(options.confounders, 'confounders'),
        map: parseExperimentSessionConfounderEntries(options.confounder),
      })
      const fields = parseExperimentSessionFieldEntries(options.field)

      return services.core.logExperimentSession({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.lookup,
        reminderIntentId: options.reminderIntentId,
        date: options.date,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        }),
        source: options.source,
        title: options.title,
        note: options.note,
        interventionType: options.interventionType,
        sessionStatus,
        durationMinutes: options.durationMinutes,
        protocolId: options.protocolId,
        timing: options.timing,
        temperatureC: options.temperatureC,
        afterExercise: options.afterExercise,
        symptoms: normalizeRepeatableFlagOption(options.symptoms, 'symptoms'),
        confounders,
        fields,
      })
    },
  })

  session.command('attach', {
    description: 'Attach an existing intervention session event to one experiment.',
    args: z.object({
      lookup: z.string().min(1).describe('Experiment id or slug to resolve.'),
      eventId: interventionSessionEventIdSchema.describe('Intervention session event id.'),
    }),
    options: withBaseOptions({
      replace: z
        .boolean()
        .optional()
        .describe('Replace an existing different experiment link on the session.'),
      allowOutOfWindow: z
        .boolean()
        .optional()
        .describe('Allow linking a session outside the experiment intervention window.'),
    }),
    output: experimentSessionAttachResultSchema,
    async run({ args, options }) {
      return services.core.attachExperimentSession({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.lookup,
        eventId: args.eventId,
        replace: options.replace === true,
        allowOutOfWindow: options.allowOutOfWindow === true,
      })
    },
  })

  session.command('detach', {
    description: 'Remove any experiment link from an intervention session event.',
    args: z.object({
      eventId: interventionSessionEventIdSchema.describe('Intervention session event id.'),
    }),
    options: withBaseOptions(),
    output: experimentSessionAttachResultSchema,
    async run({ args, options }) {
      return services.core.detachExperimentSession({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        eventId: args.eventId,
      })
    },
  })

  const context = Cli.create('context', {
    description: 'Experiment context and confounder logging commands.',
  })

  context.command('log', {
    description: 'Log one experiment-linked context, note, or supplement-intake record using typed fields.',
    args: experimentJournalLookupArgSchema,
    options: withBaseOptions({
      kind: experimentContextKindSchema
        .optional()
        .describe('Context record kind. Inferred from supplied fields when omitted.'),
      occurredAt: z
        .string()
        .min(1)
        .optional()
        .describe('Optional context timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceOptionSchema
        .optional()
        .describe('Optional event source for the context record.'),
      title: z.string().min(1).optional().describe('Optional context record title.'),
      note: z.string().optional().describe('Optional context note.'),
      contextType: z
        .string()
        .min(1)
        .optional()
        .describe('Experiment context type, such as travel or illness.'),
      severity: experimentContextSeveritySchema
        .optional()
        .describe('Experiment context severity.'),
      tag: z
        .array(slugSchema)
        .optional()
        .describe('Optional tags to store on the context event. Repeat --tag for multiple values.'),
      supplementName: z
        .string()
        .min(1)
        .optional()
        .describe('Supplement name for supplement-intake context records.'),
      dose: z
        .number()
        .nonnegative()
        .optional()
        .describe('Supplement dose for supplement-intake context records.'),
      unit: z
        .string()
        .min(1)
        .optional()
        .describe('Supplement dose unit for supplement-intake context records.'),
    }),
    output: experimentContextLogResultSchema,
    async run({ args, options }) {
      return services.core.logExperimentContext({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.lookup,
        kind: options.kind,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        }),
        source: options.source,
        title: options.title,
        note: options.note,
        contextType: options.contextType,
        severity: options.severity,
        tags: normalizeRepeatableFlagOption(options.tag, 'tag'),
        supplementName: options.supplementName,
        dose: options.dose,
        unit: options.unit,
      })
    },
  })

  const outcome = Cli.create('outcome', {
    description: 'Experiment outcome analysis commands.',
  })

  outcome.command('analyze', {
    description: 'Run the deterministic final analysis for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentOutcomeResultSchema,
    async run({ args, options }) {
      return services.query.analyzeExperimentOutcome({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  outcome.command('write', {
    description: 'Run the deterministic final analysis for one experiment and persist the outcome record.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentOutcomeResultSchema,
    async run({ args, options }) {
      return services.core.writeExperimentOutcome({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  experiment.command(session)
  experiment.command(context)
  experiment.command(outcome)
  experiment.command(followup)

  cli.command(experiment)
}
