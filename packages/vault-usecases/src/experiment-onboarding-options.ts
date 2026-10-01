import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
  commonsProtocolRefSchema,
  experimentAnalysisPlanSchema,
  experimentExpectedDirectionsSchema,
  experimentFrontmatterSchema,
  experimentPrimaryOutcomeSchema,
  experimentRunLoggingSchema,
  healthCommonsKeySchema,
  experimentAssistantSupportSchema,
  experimentOnboardingCaptureSchema,
  experimentOnboardingSafetySchema,
  healthCommonsStableIdSchema,
  safeParseContract,
  type ExperimentAssistantSupport,
  type ExperimentOnboardingCapture,
  type ExperimentOnboardingSafety,
  type ExperimentOutcomeStatistic,
  type ExperimentPrimaryOutcome,
  type ExperimentRunScheduleIntent,
  type ExperimentStatus,
  type JsonValue,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import * as z from '@murphai/contracts/zod-runtime'
import type { JsonObject } from './health-cli-method-types.js'
import { localDateSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  normalizeExperimentMeasurementAnchorFlagOption,
  normalizeExperimentPlannedMeasurementFlagOption,
} from './option-utils.js'

const experimentCheckInCadenceSchema = z.enum(['none', 'daily', 'every_3_days', 'weekly'])
const experimentNotificationStyleSchema = z.enum([
  'skip_by_default',
  'send_scheduled_summary',
])

export interface ExperimentOnboardingCaptureOptions {
  onboardingCompletedAt?: string
  setupAnswer?: readonly string[]
  safetyCautionLevel?: (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS)[number]
  safetyDisposition?: (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS)[number]
  positiveQuestionId?: readonly string[]
  safetyNote?: readonly string[]
  contextNote?: readonly string[]
}

export interface ExperimentAssistantSupportOptions {
  reminderPolicy?: string
  reminderOptionId?: string
  remindersEnabled?: boolean
  checkInCadence?: z.infer<typeof experimentCheckInCadenceSchema>
  notificationStyle?: z.infer<typeof experimentNotificationStyleSchema>
  missedLogFollowup?: (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES)[number]
  weeklyDigestEnabled?: boolean
}

const experimentSignalDirectionSchema = z.enum(['increase', 'decrease', 'stabilize'])
type ExperimentFrontmatterValue = z.infer<typeof experimentFrontmatterSchema>
type CommonsProtocolRefValue = z.infer<typeof commonsProtocolRefSchema>
type ExperimentRunLoggingValue = z.infer<typeof experimentRunLoggingSchema>
type ExperimentAnalysisPlanValue = z.infer<typeof experimentAnalysisPlanSchema>

export interface ApplyExperimentOnboardingRecordInput
  extends ExperimentOnboardingCaptureOptions,
    ExperimentAssistantSupportOptions {
  vault: string
  lookup: string
  status?: ExperimentStatus
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

export function buildExperimentOnboardingCaptureFromOptions(
  input: ExperimentOnboardingCaptureOptions,
  existing?: ExperimentOnboardingCapture,
): ExperimentOnboardingCapture | undefined {
  const patch: Partial<ExperimentOnboardingCapture> = {}

  if (input.onboardingCompletedAt !== undefined) {
    patch.completedAt = input.onboardingCompletedAt
  }

  const setupAnswers = buildSetupAnswersFromOptions(
    input.setupAnswer,
    existing?.setupAnswers,
  )
  if (setupAnswers !== undefined) {
    patch.setupAnswers = setupAnswers
  }

  const safety = buildOnboardingSafetyFromOptions(input, existing?.safety)
  if (safety !== undefined) {
    patch.safety = safety
  }

  const contextNotes = normalizeTextListOption(input.contextNote, 'context-note')
  if (contextNotes !== undefined) {
    patch.contextNotes = contextNotes
  }

  if (Object.keys(patch).length === 0) {
    return undefined
  }

  return experimentOnboardingCaptureSchema.parse(
    compactObject({
      ...(existing ?? {}),
      ...patch,
    }),
  )
}

export function buildExperimentAssistantSupportFromOptions(
  input: ExperimentAssistantSupportOptions,
  existing?: ExperimentAssistantSupport,
): ExperimentAssistantSupport | undefined {
  const patch: Partial<ExperimentAssistantSupport> = {}

  if (input.reminderPolicy !== undefined) {
    patch.reminderPolicy = normalizeStableIdOption(
      input.reminderPolicy,
      'reminder-policy',
    )
  }
  if (input.reminderOptionId !== undefined) {
    patch.reminderOptionId = normalizeStableIdOption(
      input.reminderOptionId,
      'reminder-option-id',
    )
  }
  if (input.remindersEnabled !== undefined) {
    patch.remindersEnabled = input.remindersEnabled
  }
  if (input.checkInCadence !== undefined) {
    patch.checkInCadence = experimentCheckInCadenceSchema.parse(input.checkInCadence)
  }
  if (input.notificationStyle !== undefined) {
    patch.notificationStyle = experimentNotificationStyleSchema.parse(
      input.notificationStyle,
    )
  }
  if (input.missedLogFollowup !== undefined) {
    patch.missedLogFollowup = z
      .enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES)
      .parse(input.missedLogFollowup)
  }
  if (input.weeklyDigestEnabled !== undefined) {
    patch.weeklyDigestEnabled = input.weeklyDigestEnabled
  }

  if (Object.keys(patch).length === 0) {
    return undefined
  }

  return experimentAssistantSupportSchema.parse(
    compactObject({
      ...(existing ?? {}),
      ...patch,
    }),
  )
}

export function normalizeRequiredTextOption(value: string, optionName: string) {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    throw new VaultCliError('invalid_option', `--${optionName} must not be empty.`)
  }

  return normalized
}

export function normalizeTextListOption(
  values: readonly string[] | undefined,
  optionName: string,
) {
  if (values === undefined) {
    return undefined
  }

  const normalized = uniqueStrings(
    values
      .map((entry) => normalizeOptionalText(entry) ?? '')
      .filter((entry) => entry.length > 0),
  )

  if (normalized.length === 0) {
    throw new VaultCliError('invalid_option', `--${optionName} must not be empty.`)
  }

  return normalized
}

export function normalizeStableIdOption(value: string, optionName: string) {
  const normalized = normalizeRequiredTextOption(value, optionName)
  const parsed = safeParseContract(healthCommonsStableIdSchema, normalized)

  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} must be a Health Commons stable id.`,
    )
  }

  return parsed.data
}

export function normalizeStableIdListOption(
  values: readonly string[] | undefined,
  optionName: string,
) {
  const normalized = normalizeTextListOption(values, optionName)
  if (normalized === undefined) {
    return undefined
  }

  return normalized.map((entry) => normalizeStableIdOption(entry, optionName))
}

function buildOnboardingSafetyFromOptions(
  input: ExperimentOnboardingCaptureOptions,
  existing: ExperimentOnboardingSafety | undefined,
): ExperimentOnboardingSafety | undefined {
  const patch: Partial<ExperimentOnboardingSafety> = {}

  if (input.safetyCautionLevel !== undefined) {
    patch.cautionLevel = z
      .enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS)
      .parse(input.safetyCautionLevel)
  }
  if (input.safetyDisposition !== undefined) {
    patch.disposition = z
      .enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS)
      .parse(input.safetyDisposition)
  }

  const positiveQuestionIds = normalizeStableIdListOption(
    input.positiveQuestionId,
    'positive-question-id',
  )
  if (positiveQuestionIds !== undefined) {
    patch.positiveQuestionIds = positiveQuestionIds
  }

  const notes = normalizeTextListOption(input.safetyNote, 'safety-note')
  if (notes !== undefined) {
    patch.notes = notes
  }

  if (Object.keys(patch).length === 0) {
    return undefined
  }

  return experimentOnboardingSafetySchema.parse(
    compactObject({
      ...(existing ?? {}),
      ...patch,
    }),
  )
}

function buildSetupAnswersFromOptions(
  values: readonly string[] | undefined,
  existing: JsonObject | undefined,
): JsonObject | undefined {
  if (values === undefined) {
    return undefined
  }

  const next: JsonObject = { ...(existing ?? {}) }
  for (const value of values) {
    const { key, answer } = parseSetupAnswerOption(value)
    next[key] = answer
  }

  return next
}

function parseSetupAnswerOption(value: string) {
  const separatorIndex = value.indexOf('=')
  if (separatorIndex <= 0) {
    throw new VaultCliError(
      'invalid_option',
      '--setup-answer must use key=value with a Health Commons setup slot id.',
    )
  }

  const key = value.slice(0, separatorIndex).trim()
  const answerText = value.slice(separatorIndex + 1).trim()
  return {
    key: normalizeStableIdOption(key, 'setup-answer'),
    answer: parseSetupAnswerValue(answerText),
  }
}

function parseSetupAnswerValue(value: string): JsonValue {
  if (value.length === 0) {
    return ''
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (isJsonValue(parsed)) {
      return parsed
    }
  } catch {
    // Plain string answers are expected for most setup slots.
  }

  return value
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (typeof value === 'object') {
    return Object.values(value).every(isJsonValue)
  }

  return false
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function uniqueStrings(values: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }

  return result
}

function compactObject<TRecord extends Record<string, unknown>>(record: TRecord) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as TRecord
}

export function buildCommonsProtocolRefForOnboardingApply(
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

export function buildRunLoggingForOnboardingApply(
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

export function buildAnalysisPlanForOnboardingApply(
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

export function buildRunPlanDatePatch(input: ApplyExperimentOnboardingRecordInput) {
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
