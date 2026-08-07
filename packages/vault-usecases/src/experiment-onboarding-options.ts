import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
  experimentAssistantSupportSchema,
  experimentOnboardingCaptureSchema,
  experimentOnboardingSafetySchema,
  healthCommonsStableIdSchema,
  safeParseContract,
  type ExperimentAssistantSupport,
  type ExperimentOnboardingCapture,
  type ExperimentOnboardingSafety,
  type JsonValue,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import * as z from '@murphai/contracts/zod-runtime'
import type { JsonObject } from './health-cli-method-types.js'

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
  )
}
