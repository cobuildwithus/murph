import { Cli, z } from 'incur'
import { wearablePreferenceProviderValues } from '@murphai/contracts'
import {
  wearableCanonicalMetricKeys,
} from '@murphai/importers/device-providers/metric-catalog'
import {
  canonicalizeDeviceProviderSlug,
} from '@murphai/importers/device-providers/provider-descriptors'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeRepeatableEnumFlagOption } from '@murphai/vault-usecases'
import {
  isoTimestampSchema,
  localDateSchema,
  timeZoneSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'

const nullableTimestampSchema = z.string().min(1).nullable()
const nullableTextSchema = z.string().min(1).nullable()
const wearableConfidenceLevelSchema = z.enum(['none', 'low', 'medium', 'high'])
const wearableCanonicalMetricKeySchema = z.enum(wearableCanonicalMetricKeys)
const wearableWindowDaysOptionSchema = z
  .number()
  .int()
  .positive()
  .max(30)
  .default(7)
  .describe(
    'Rolling local-day window size for recent versus prior summary comparisons.',
  )
const wearableSleepPatternWindowDaysOptionSchema = z
  .number()
  .int()
  .positive()
  .max(366)
  .default(28)
  .describe(
    'Calendar-day sleep-pattern window. Defaults to 28 days and may be at most 366.',
  )
const personalPatternWindowDaysOptionSchema = z
  .number()
  .int()
  .min(28)
  .max(366)
  .default(120)
  .describe(
    'Calendar-day window for matched personal patterns. Defaults to 120 days.',
  )
const repeatableProviderOptionSchema = z
  .array(z.string().min(1))
  .optional()
  .describe(
    'Optional provider filter. Repeat --provider for multiple values such as oura, whoop, or garmin.',
  )
const wearableMetricArgSchema = z.object({
  metric: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Wearable metric key or alias such as hrv, resting-heart-rate, steps, sleep-score, or skin-temp.',
    ),
})
const wearableDayArgSchema = z.object({
  date: localDateSchema.describe('Calendar date in YYYY-MM-DD form.'),
})

const wearableMetricConfidenceSummarySchema = z.object({
  candidateCount: z.number().int().nonnegative().optional(),
  conflictingProviders: z.array(z.string().min(1)).optional(),
  exactDuplicateCount: z.number().int().nonnegative().optional(),
  level: wearableConfidenceLevelSchema,
})

const wearableResolvedMetricSchema = z.object({
  candidateCount: z.number().int().nonnegative().optional(),
  confidence: wearableConfidenceLevelSchema,
  conflictingProviders: z.array(z.string().min(1)).optional(),
  exactDuplicateCount: z.number().int().nonnegative().optional(),
  fallbackFromMetric: nullableTextSchema.optional(),
  fallbackReason: nullableTextSchema.optional(),
  metric: z.string().min(1).optional(),
  occurredAt: nullableTimestampSchema.optional(),
  provider: nullableTextSchema.optional(),
  recordedAt: nullableTimestampSchema.optional(),
  sourceKind: nullableTextSchema.optional(),
  title: nullableTextSchema.optional(),
  unit: nullableTextSchema.optional(),
  value: z.number().nullable(),
})

const wearableSummaryConfidenceSchema = z.object({
  conflictingMetrics: z.array(z.string().min(1)).optional(),
  level: wearableConfidenceLevelSchema,
  lowConfidenceMetrics: z.array(z.string().min(1)).optional(),
  notes: z.array(z.string()).optional(),
  selectedProviders: z.array(z.string().min(1)).optional(),
})

const wearableSourceHealthSummarySchema = z.object({
  activityDays: z.number().int().nonnegative(),
  bodyStateDays: z.number().int().nonnegative(),
  candidateMetrics: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  exactDuplicatesSuppressed: z.number().int().nonnegative(),
  firstDate: localDateSchema.nullable().optional(),
  lastDate: localDateSchema.nullable().optional(),
  latestRecordedAt: nullableTimestampSchema.optional(),
  metricsContributed: z.array(z.string().min(1)).optional(),
  notes: z.array(z.string()).optional(),
  provider: z.string().min(1),
  providerDisplayName: z.string().min(1),
  recoveryDays: z.number().int().nonnegative(),
  selectedMetrics: z.number().int().nonnegative(),
  sleepNights: z.number().int().nonnegative(),
  stalenessVsNewestDays: z.number().int().nonnegative().nullable().optional(),
})

const wearableWorkoutSplitFeatureSchema = z.object({
  averageCadence: z.number().nonnegative().optional(),
  averageHeartRate: z.number().nonnegative().optional(),
  averagePowerWatts: z.number().nonnegative().optional(),
  cadenceUnit: z.string().min(1).optional(),
  distanceMeters: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  endedAt: isoTimestampSchema,
  index: z.number().int().nonnegative(),
})

const wearableWorkoutFeatureSchema = z.object({
  activityType: z.string().min(1).optional(),
  averageCadence: z.number().nonnegative().optional(),
  averageHeartRate: z.number().nonnegative().optional(),
  averagePowerWatts: z.number().nonnegative().optional(),
  averageSpeedMps: z.number().nonnegative().optional(),
  cadenceUnit: z.string().min(1).optional(),
  distanceKm: z.number().nonnegative().optional(),
  durationMinutes: z.number().nonnegative().optional(),
  firstHalfAverageHeartRate: z.number().nonnegative().optional(),
  maxCadence: z.number().nonnegative().optional(),
  maxHeartRate: z.number().nonnegative().optional(),
  maxPowerWatts: z.number().nonnegative().optional(),
  maxSpeedMps: z.number().nonnegative().optional(),
  provider: z.string().min(1),
  secondHalfAverageHeartRate: z.number().nonnegative().optional(),
  splits: z.array(wearableWorkoutSplitFeatureSchema).max(64),
  startedAt: isoTimestampSchema,
})

const wearableActivitySummarySchema = z.object({
  activityScore: wearableResolvedMetricSchema.optional(),
  activeCalories: wearableResolvedMetricSchema.optional(),
  activityMinutes: wearableResolvedMetricSchema.optional(),
  activityTypes: z.array(z.string().min(1)).optional(),
  altitudeChangeMeters: wearableResolvedMetricSchema.optional(),
  averageHeartRate: wearableResolvedMetricSchema.optional(),
  date: localDateSchema,
  dayStrain: wearableResolvedMetricSchema.optional(),
  distanceKm: wearableResolvedMetricSchema.optional(),
  estimatedVo2Max: wearableResolvedMetricSchema.optional(),
  floorsClimbed: wearableResolvedMetricSchema.optional(),
  heartRateZones: z.array(z.object({
    durationMinutes: z.number().nonnegative(),
    label: z.string().min(1).optional(),
    maxHeartRate: z.number().nonnegative().optional(),
    minHeartRate: z.number().nonnegative().optional(),
    zone: z.number().int().nonnegative().optional(),
  })).optional(),
  highActivityMinutes: wearableResolvedMetricSchema.optional(),
  lowActivityMinutes: wearableResolvedMetricSchema.optional(),
  lowestHeartRate: wearableResolvedMetricSchema.optional(),
  maxHeartRate: wearableResolvedMetricSchema.optional(),
  mediumActivityMinutes: wearableResolvedMetricSchema.optional(),
  notes: z.array(z.string()).optional(),
  percentRecorded: wearableResolvedMetricSchema.optional(),
  sessionCount: wearableResolvedMetricSchema.optional(),
  sessionMinutes: wearableResolvedMetricSchema.optional(),
  steps: wearableResolvedMetricSchema.optional(),
  summaryConfidence: wearableSummaryConfidenceSchema,
  totalCalories: wearableResolvedMetricSchema.optional(),
  totalElevationGainMeters: wearableResolvedMetricSchema.optional(),
  walkingAverageHeartRate: wearableResolvedMetricSchema.optional(),
  workoutFeatures: z.array(wearableWorkoutFeatureSchema).max(32).optional(),
  workoutStrain: wearableResolvedMetricSchema.optional(),
})

const wearableSleepSummarySchema = z.object({
  averageHeartRate: wearableResolvedMetricSchema.optional(),
  awakeMinutes: wearableResolvedMetricSchema.optional(),
  date: localDateSchema,
  deepMinutes: wearableResolvedMetricSchema.optional(),
  hrv: wearableResolvedMetricSchema.optional(),
  lightMinutes: wearableResolvedMetricSchema.optional(),
  lowestHeartRate: wearableResolvedMetricSchema.optional(),
  lowestSpo2: wearableResolvedMetricSchema.optional(),
  notes: z.array(z.string()).optional(),
  provider: nullableTextSchema.optional(),
  remMinutes: wearableResolvedMetricSchema.optional(),
  respiratoryRate: wearableResolvedMetricSchema.optional(),
  sessionMinutes: wearableResolvedMetricSchema.optional(),
  sleepConsistency: wearableResolvedMetricSchema.optional(),
  sleepEfficiency: wearableResolvedMetricSchema.optional(),
  sleepEndAt: nullableTimestampSchema.optional(),
  sleepLatencyMinutes: wearableResolvedMetricSchema.optional(),
  sleepPerformance: wearableResolvedMetricSchema.optional(),
  sleepScore: wearableResolvedMetricSchema.optional(),
  sleepStartAt: nullableTimestampSchema.optional(),
  sleepWindowProvider: nullableTextSchema.optional(),
  spo2: wearableResolvedMetricSchema.optional(),
  summaryConfidence: wearableSummaryConfidenceSchema,
  timeInBedMinutes: wearableResolvedMetricSchema.optional(),
  totalSleepMinutes: wearableResolvedMetricSchema.optional(),
})

const wearableRecoverySummarySchema = z.object({
  bodyBattery: wearableResolvedMetricSchema.optional(),
  date: localDateSchema,
  hrv: wearableResolvedMetricSchema.optional(),
  notes: z.array(z.string()).optional(),
  readinessScore: wearableResolvedMetricSchema.optional(),
  recoveryScore: wearableResolvedMetricSchema.optional(),
  respiratoryRate: wearableResolvedMetricSchema.optional(),
  restingHeartRate: wearableResolvedMetricSchema.optional(),
  spo2: wearableResolvedMetricSchema.optional(),
  stressLevel: wearableResolvedMetricSchema.optional(),
  summaryConfidence: wearableSummaryConfidenceSchema,
  temperature: wearableResolvedMetricSchema.optional(),
  temperatureDeviation: wearableResolvedMetricSchema.optional(),
})

const wearableBodyStateSummarySchema = z.object({
  bmi: wearableResolvedMetricSchema.optional(),
  bodyFatPercentage: wearableResolvedMetricSchema.optional(),
  bodyWaterPercentage: wearableResolvedMetricSchema.optional(),
  boneMassPercentage: wearableResolvedMetricSchema.optional(),
  date: localDateSchema,
  leanBodyMassKg: wearableResolvedMetricSchema.optional(),
  muscleMassPercentage: wearableResolvedMetricSchema.optional(),
  notes: z.array(z.string()).optional(),
  summaryConfidence: wearableSummaryConfidenceSchema,
  temperature: wearableResolvedMetricSchema.optional(),
  visceralFatIndex: wearableResolvedMetricSchema.optional(),
  waistCircumference: wearableResolvedMetricSchema.optional(),
  weightKg: wearableResolvedMetricSchema.optional(),
})

const wearableDaySummarySchema = z.object({
  activity: wearableActivitySummarySchema.nullable().optional(),
  bodyState: wearableBodyStateSummarySchema.nullable().optional(),
  date: localDateSchema,
  notes: z.array(z.string()).optional(),
  providers: z.array(z.string().min(1)),
  recovery: wearableRecoverySummarySchema.nullable().optional(),
  sleep: wearableSleepSummarySchema.nullable().optional(),
  sourceHealth: z.array(wearableSourceHealthSummarySchema).optional(),
  summaryConfidence: wearableConfidenceLevelSchema,
})

const wearableDayFiltersSchema = z.object({
  providers: z.array(z.string().min(1)),
})

const wearableListFiltersSchema = z.object({
  date: localDateSchema.nullable(),
  from: localDateSchema.nullable(),
  to: localDateSchema.nullable(),
  providers: z.array(z.string().min(1)),
  limit: z.number().int().positive().max(200),
})

const wearableSurfaceFiltersSchema = wearableListFiltersSchema.omit({
  limit: true,
})

export const wearablesDayResultSchema = z.object({
  date: localDateSchema,
  filters: wearableDayFiltersSchema,
  summary: wearableDaySummarySchema.nullable(),
})

export const wearablesSleepListResultSchema = z.object({
  filters: wearableListFiltersSchema,
  items: z.array(wearableSleepSummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesActivityListResultSchema = z.object({
  filters: wearableListFiltersSchema,
  items: z.array(wearableActivitySummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesBodyStateListResultSchema = z.object({
  filters: wearableListFiltersSchema,
  items: z.array(wearableBodyStateSummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesRecoveryListResultSchema = z.object({
  filters: wearableListFiltersSchema,
  items: z.array(wearableRecoverySummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesSourcesListResultSchema = z.object({
  filters: wearableListFiltersSchema,
  items: z.array(wearableSourceHealthSummarySchema),
  count: z.number().int().nonnegative(),
})

const wearableSleepNumericPatternSchema = z.object({
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
  median: z.number().nullable(),
  standardDeviation: z.number().nonnegative().nullable(),
})

const wearableSleepClockPatternSchema = z.object({
  count: z.number().int().nonnegative(),
  medianLocalMinutes: z.number().min(0).max(1_440).nullable(),
  medianLocalTime: z.string().regex(/^\d{2}:\d{2}$/u).nullable(),
  standardDeviationMinutes: z.number().nonnegative().nullable(),
})

const wearableSleepSourceFreshnessSchema = z.object({
  lastSleepEvidenceDate: localDateSchema,
  provider: z.string().min(1),
  stalenessVsNewestDays: z.number().int().nonnegative(),
  stalenessVsNowDays: z.number().int().nonnegative(),
})

const wearableSleepPatternSummarySchema = z.object({
  allSourcesStale: z.boolean(),
  asOfDate: localDateSchema,
  asOfInstant: z.string().min(1),
  awakeMinutes: wearableSleepNumericPatternSchema,
  bedtime: wearableSleepClockPatternSchema,
  conflictingNightCount: z.number().int().nonnegative(),
  coveragePercent: z.number().min(0).max(100),
  expectedNightCount: z.number().int().nonnegative(),
  excludedNapOnlyDateCount: z.number().int().nonnegative(),
  reportingTimeZoneFallbackNightCount: z.number().int().nonnegative(),
  from: localDateSchema,
  lateArrivingNightCount: z.number().int().nonnegative(),
  latestRecordedAt: nullableTimestampSchema,
  latestSleepEndAt: nullableTimestampSchema,
  latestNightAgeDays: z.number().int().nonnegative().nullable(),
  latestNightDate: localDateSchema.nullable(),
  midpoint: wearableSleepClockPatternSchema,
  missingNightCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
  overlappingNightCount: z.number().int().nonnegative(),
  providerMix: z.boolean(),
  providers: z.array(z.string().min(1)),
  reportingTimeZone: timeZoneSchema.nullable(),
  reportingTimeZoneSource: z.enum(['canonical', 'none', 'user_filter', 'vault_metadata']),
  sameDateSessionSuppressedCount: z.number().int().nonnegative(),
  sessionDurationMinutes: wearableSleepNumericPatternSchema,
  sleepLatencyMinutes: wearableSleepNumericPatternSchema,
  sourceFreshness: z.array(wearableSleepSourceFreshnessSchema),
  staleAfterDays: z.number().int().nonnegative(),
  suppressedExactDuplicateCount: z.number().int().nonnegative(),
  timeZones: z.array(timeZoneSchema),
  timingTimeZoneMode: z.literal('per_night_canonical_with_reporting_fallback'),
  timingOmittedNightCount: z.number().int().nonnegative(),
  to: localDateSchema,
  totalSleepMinutes: wearableSleepNumericPatternSchema,
  unknownSleepTypeNightCount: z.number().int().nonnegative(),
  validNightCount: z.number().int().nonnegative(),
  wakeTime: wearableSleepClockPatternSchema,
  weekdayWeekendMidpointDriftMinutes: z.number().nonnegative().nullable(),
  weekdayWeekendMidpointSampleCounts: z.object({
    weekday: z.number().int().nonnegative(),
    weekend: z.number().int().nonnegative(),
  }),
})

const wearableSleepPatternFiltersResultSchema = wearableSurfaceFiltersSchema.extend({
  timeZone: timeZoneSchema.nullable(),
  windowDays: z.number().int().positive().max(366),
})

export const wearablesSleepPatternResultSchema = z.object({
  filters: wearableSleepPatternFiltersResultSchema,
  summary: wearableSleepPatternSummarySchema,
})

const personalPatternStageSchema = z.enum([
  'insufficient',
  'no_clear_pattern',
  'new_clue',
  'seen_again',
  'worth_testing',
])

const personalPatternReportSchema = z.object({
  asOfDate: localDateSchema,
  cells: z.array(z.object({
    comparisonDays: z.number().int().nonnegative(),
    comparisonMean: z.number().nullable(),
    delta: z.number().nullable(),
    deltaPercent: z.number().nullable(),
    direction: z.enum(['higher', 'lower', 'flat']),
    exposedDays: z.number().int().nonnegative(),
    exposedMean: z.number().nullable(),
    factorId: z.string().min(1),
    firstExposedDate: localDateSchema.nullable(),
    lastExposedDate: localDateSchema.nullable(),
    outcomeId: z.string().min(1),
    repeatedDirection: z.boolean(),
    stage: personalPatternStageSchema,
  })),
  factors: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['activity', 'intervention', 'mixed']),
    label: z.string().min(1),
    observedDays: z.number().int().nonnegative(),
  })),
  lagDays: z.literal(1),
  notes: z.array(z.string()),
  outcomes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    unit: z.string(),
  })),
  repeatableCellCount: z.number().int().nonnegative(),
  testedCellCount: z.number().int().nonnegative(),
  windowDays: z.number().int().min(28).max(366),
})

export const wearablesPersonalPatternsResultSchema = z.object({
  filters: z.object({
    date: localDateSchema.nullable(),
    windowDays: z.number().int().min(28).max(366),
  }),
  report: personalPatternReportSchema,
})

const wearableMetricSummaryKindSchema = z.enum([
  'activity',
  'bodyState',
  'recovery',
  'sleep',
])

const wearableMetricWindowStatsSchema = z.object({
  average: z.number().nullable().optional(),
  count: z.number().int().nonnegative(),
  from: localDateSchema.nullable().optional(),
  max: z.number().nullable().optional(),
  min: z.number().nullable().optional(),
  to: localDateSchema.nullable().optional(),
})

const wearableMetricTrendPointSchema = z
  .object({
    confidence: wearableConfidenceLevelSchema,
    date: localDateSchema,
    provider: nullableTextSchema.optional(),
    recordedAt: nullableTimestampSchema.optional(),
    unit: nullableTextSchema.optional(),
    value: z.number(),
  })

const wearablesMetricLatestSummarySchema = z
  .object({
    confidence: wearableMetricConfidenceSummarySchema,
    date: localDateSchema.nullable().optional(),
    delta: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    metric: wearableCanonicalMetricKeySchema,
    min: z.number().nullable().optional(),
    notes: z.array(z.string()).optional(),
    percentChange: z.number().nullable().optional(),
    priorWindow: wearableMetricWindowStatsSchema,
    provider: nullableTextSchema.optional(),
    recentWindow: wearableMetricWindowStatsSchema,
    recordedAt: nullableTimestampSchema.optional(),
    requestedMetric: z.string().trim().min(1),
    resolvedAlias: nullableTextSchema.optional(),
    summaryKind: wearableMetricSummaryKindSchema,
    unit: nullableTextSchema.optional(),
    value: z.number().nullable().optional(),
    windowDays: z.number().int().positive().max(30),
  })

const wearablesLatestSummarySchema = z
  .object({
    day: wearableDaySummarySchema,
    latestDate: localDateSchema,
    notes: z.array(z.string()).optional(),
    providers: z.array(z.string().min(1)),
  })

const wearablesMetricTrendSummarySchema = z
  .object({
    ...wearablesMetricLatestSummarySchema.shape,
    points: z.array(wearableMetricTrendPointSchema),
  })

const wearablesDriftSummarySchema = z
  .object({
    latest: wearablesLatestSummarySchema,
    notes: z.array(z.string()),
    signals: z.array(wearablesMetricLatestSummarySchema),
    windowDays: z.number().int().positive().max(30),
  })

const wearableMetricFiltersResultSchema = wearableSurfaceFiltersSchema.extend({
  metric: z.string().trim().min(1),
  windowDays: z.number().int().positive().max(30),
})

const wearableDriftFiltersResultSchema = wearableSurfaceFiltersSchema.extend({
  windowDays: z.number().int().positive().max(30),
})

export const wearablesLatestResultSchema = z
  .object({
    filters: wearableSurfaceFiltersSchema,
    summary: wearablesLatestSummarySchema.nullable(),
  })

export const wearablesMetricLatestResultSchema = z
  .object({
    filters: wearableMetricFiltersResultSchema,
    summary: wearablesMetricLatestSummarySchema.nullable(),
  })

export const wearablesMetricTrendResultSchema = z
  .object({
    filters: wearableMetricFiltersResultSchema,
    summary: wearablesMetricTrendSummarySchema.nullable(),
  })

export const wearablesDriftResultSchema = z
  .object({
    filters: wearableDriftFiltersResultSchema,
    summary: wearablesDriftSummarySchema.nullable(),
  })

type WearablesLatestResult = z.infer<typeof wearablesLatestResultSchema>
type WearablesMetricLatestResult = z.infer<typeof wearablesMetricLatestResultSchema>
type WearablesMetricTrendResult = z.infer<typeof wearablesMetricTrendResultSchema>
type WearablesDriftResult = z.infer<typeof wearablesDriftResultSchema>
type WearablesSleepPatternResult = z.infer<typeof wearablesSleepPatternResultSchema>
type WearablesPersonalPatternsResult = z.infer<typeof wearablesPersonalPatternsResultSchema>

interface WearablesLatestInput {
  requestId: string | null
  vault: string
  date?: string
  from?: string
  to?: string
  providers?: string[]
}

interface WearablesMetricInput extends WearablesLatestInput {
  metric: string
  windowDays?: number
}

interface WearablesDriftInput extends WearablesLatestInput {
  windowDays?: number
}

interface WearablesSleepPatternInput extends WearablesLatestInput {
  timeZone?: string
  windowDays?: number
}

interface WearablesPersonalPatternsInput {
  requestId: string | null
  vault: string
  date?: string
  windowDays?: number
}

type AdditiveWearablesQueryMethod<
  TResult extends object,
  TInput extends WearablesLatestInput,
> = (
  input: TInput,
) => Promise<TResult>

function requireAdditiveWearablesQueryMethod<
  TResult extends object,
  TInput extends WearablesLatestInput,
>(
  query: object,
  methodName: string,
): AdditiveWearablesQueryMethod<TResult, TInput> {
  const method = Reflect.get(query, methodName)

  if (typeof method !== 'function') {
    throw new VaultCliError(
      'not_implemented',
      `CLI integration for query.${methodName} is not wired yet.`,
    )
  }

  return method.bind(query) as AdditiveWearablesQueryMethod<TResult, TInput>
}

function withWearableListOptions() {
  return withBaseOptions({
    date: localDateSchema
      .optional()
      .describe('Optional one-day filter. When present, Murph treats it as both --from and --to.'),
    from: localDateSchema.optional().describe('Inclusive lower date bound.'),
    to: localDateSchema.optional().describe('Inclusive upper date bound.'),
    provider: repeatableProviderOptionSchema,
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .default(3)
      .describe('Maximum number of daily summaries to return. Defaults to 3.'),
  })
}

function withWearableSurfaceOptions() {
  return withBaseOptions({
    date: localDateSchema
      .optional()
      .describe('Optional one-day filter. When present, Murph treats it as both --from and --to.'),
    from: localDateSchema.optional().describe('Inclusive lower date bound.'),
    to: localDateSchema.optional().describe('Inclusive upper date bound.'),
    provider: repeatableProviderOptionSchema,
  })
}

function withWearableComparisonOptions() {
  return withBaseOptions({
    date: localDateSchema
      .optional()
      .describe('Optional one-day filter. When present, Murph treats it as both --from and --to.'),
    from: localDateSchema.optional().describe('Inclusive lower date bound.'),
    to: localDateSchema.optional().describe('Inclusive upper date bound.'),
    provider: repeatableProviderOptionSchema,
    windowDays: wearableWindowDaysOptionSchema,
  })
}

function withWearableSleepPatternOptions() {
  return withBaseOptions({
    date: localDateSchema
      .optional()
      .describe('Optional one-day filter. When present, Murph treats it as both --from and --to.'),
    from: localDateSchema.optional().describe('Inclusive lower date bound.'),
    to: localDateSchema.optional().describe('Inclusive upper date bound.'),
    provider: repeatableProviderOptionSchema,
    timeZone: timeZoneSchema
      .optional()
      .describe('Optional IANA fallback for nights whose provider did not report a canonical time zone. The vault time zone is used when omitted.'),
    windowDays: wearableSleepPatternWindowDaysOptionSchema,
  })
}

function withPersonalPatternOptions() {
  return withBaseOptions({
    date: localDateSchema
      .optional()
      .describe('Optional last action date in YYYY-MM-DD form. Defaults to today.'),
    windowDays: personalPatternWindowDaysOptionSchema,
  })
}

function normalizeWearableProviders(value: readonly string[] | undefined): string[] {
  return normalizeRepeatableEnumFlagOption(
    value?.map((entry) => canonicalizeDeviceProviderSlug(entry)),
    'provider',
    wearablePreferenceProviderValues,
  ) ?? []
}

function withoutWearableVaultPath<TResult extends object>(
  result: TResult,
): Omit<TResult, 'vault'> {
  const safeResult = { ...result } as Record<string, unknown>
  delete safeResult.vault

  return safeResult as Omit<TResult, 'vault'>
}

export function registerWearablesCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const wearables = Cli.create('wearables', {
    description:
      'Semantic wearable read commands that collapse duplicate device evidence into calmer daily sleep, activity, body-state, recovery, and source-health summaries.',
  })

  wearables.command('latest', {
    description:
      'Show the compact latest normalized wearable bundle across sleep, recovery, activity, body-state, and source freshness.',
    args: emptyArgsSchema,
    options: withWearableSurfaceOptions(),
    examples: [
      {
        description:
          'Pull the current normalized wearable snapshot before asking a more specific metric question.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `wearables latest` for a compact cross-category snapshot, then drill into `wearables metric latest <metric>` or `wearables metric trend <metric>` for one metric.',
    output: wearablesLatestResultSchema,
    async run({ options }) {
      const showWearableLatest = requireAdditiveWearablesQueryMethod<
        WearablesLatestResult,
        WearablesLatestInput
      >(services.query, 'showWearableLatest')
      const result = await showWearableLatest({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
      })

      return wearablesLatestResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  wearables.command('day', {
    description:
      "Show Murph's deduplicated wearable day mirror for one date, including sleep, activity, body-state, recovery, and source-confidence notes.",
    args: wearableDayArgSchema,
    options: withBaseOptions({
      provider: repeatableProviderOptionSchema,
    }),
    examples: [
      {
        args: {
          date: '2026-04-05',
        },
        description: 'Inspect one day of wearable evidence before drilling into raw records.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `wearables day` as the first read for date-specific wearable questions. Use the list subcommands for longer windows and provider/source freshness checks.',
    output: wearablesDayResultSchema,
    async run({ args, options }) {
      const result = await services.query.showWearableDay({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: args.date,
        providers: normalizeWearableProviders(options.provider),
      })

      return wearablesDayResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  const metric = Cli.create('metric', {
    description:
      'Metric-specific wearable reads for the latest resolved value and a compact normalized trend window.',
  })

  metric.command('latest', {
    description:
      'Show the latest normalized value Murph can resolve for one wearable metric key or alias.',
    args: wearableMetricArgSchema,
    options: withWearableComparisonOptions(),
    examples: [
      {
        args: {
          metric: 'hrv',
        },
        description: 'Inspect the latest HRV point using the shared wearable metric catalog.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use aliases such as `hrv`, `sleep-score`, `activity-average-heart-rate`, or `activity-lowest-heart-rate`; the shared wearable metric catalog resolves them to canonical keys.',
    output: wearablesMetricLatestResultSchema,
    async run({ args, options }) {
      const showWearableMetricLatest = requireAdditiveWearablesQueryMethod<
        WearablesMetricLatestResult,
        WearablesMetricInput
      >(services.query, 'showWearableMetricLatest')
      const result = await showWearableMetricLatest({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        metric: args.metric,
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        windowDays: options.windowDays,
      })

      return wearablesMetricLatestResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  metric.command('trend', {
    description:
      'Show a compact normalized trend window for one wearable metric key or alias.',
    args: wearableMetricArgSchema,
    options: withWearableComparisonOptions(),
    examples: [
      {
        args: {
          metric: 'resting-heart-rate',
        },
        description: 'Inspect the recent resting heart rate trend without dropping into raw records.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `wearables metric trend <metric>` when you need a compact normalized window rather than a raw per-provider record dump.',
    output: wearablesMetricTrendResultSchema,
    async run({ args, options }) {
      const showWearableMetricTrend = requireAdditiveWearablesQueryMethod<
        WearablesMetricTrendResult,
        WearablesMetricInput
      >(services.query, 'showWearableMetricTrend')
      const result = await showWearableMetricTrend({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        metric: args.metric,
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        windowDays: options.windowDays,
      })

      return wearablesMetricTrendResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  const sleep = Cli.create('sleep', {
    description:
      'Deduplicated daily sleep summaries with provider evidence and source-confidence notes.',
  })

  sleep.command('list', {
    description:
      'List semantic daily sleep summaries instead of raw sleep-session and sample rows.',
    args: emptyArgsSchema,
    options: withWearableListOptions(),
    output: wearablesSleepListResultSchema,
    async run({ options }) {
      const result = await services.query.listWearableSleep({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })

      return wearablesSleepListResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  sleep.command('pattern', {
    description:
      'Summarize recent sleep regularity, timing, duration, missingness, provider mix, and source freshness without treating wearable gaps as proof of no sleep.',
    args: emptyArgsSchema,
    options: withWearableSleepPatternOptions(),
    examples: [
      {
        description: 'Inspect a 28-day sleep pattern using the vault time zone when providers omit one.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `wearables sleep pattern` for longitudinal sleep questions. Check summary.notes before interpreting missing dates, mixed providers, stale sources, naps, or clock timing.',
    output: wearablesSleepPatternResultSchema,
    async run({ options }) {
      const showWearableSleepPattern = requireAdditiveWearablesQueryMethod<
        WearablesSleepPatternResult,
        WearablesSleepPatternInput
      >(services.query, 'showWearableSleepPattern')
      const result = await showWearableSleepPattern({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        timeZone: options.timeZone,
        windowDays: options.windowDays,
      })

      return wearablesSleepPatternResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  const activity = Cli.create('activity', {
    description:
      'Deduplicated daily activity summaries with workout/session collapse, steps, and source-confidence notes.',
  })

  activity.command('list', {
    description:
      'List semantic daily activity summaries instead of raw activity-session and sample rows.',
    args: emptyArgsSchema,
    options: withWearableListOptions(),
    output: wearablesActivityListResultSchema,
    async run({ options }) {
      const result = await services.query.listWearableActivity({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })

      return wearablesActivityListResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  const body = Cli.create('body', {
    description:
      'Deduplicated daily body-state and body-composition summaries with source-confidence notes.',
  })

  body.command('list', {
    description:
      'List semantic daily body-state summaries instead of raw body measurement rows.',
    args: emptyArgsSchema,
    options: withWearableListOptions(),
    output: wearablesBodyStateListResultSchema,
    async run({ options }) {
      const result = await services.query.listWearableBodyState({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })

      return wearablesBodyStateListResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  const recovery = Cli.create('recovery', {
    description:
      'Deduplicated daily recovery summaries with readiness/recovery, HRV, respiratory, temperature, and source-confidence notes.',
  })

  recovery.command('list', {
    description:
      'List semantic daily recovery summaries instead of raw readiness observations and supporting sample rows.',
    args: emptyArgsSchema,
    options: withWearableListOptions(),
    output: wearablesRecoveryListResultSchema,
    async run({ options }) {
      const result = await services.query.listWearableRecovery({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })

      return wearablesRecoveryListResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  const sources = Cli.create('sources', {
    description:
      'Wearable source-health, coverage, and freshness summaries across connected providers.',
  })

  sources.command('list', {
    description:
      'List wearable source-health summaries so you can see which providers contributed evidence and how fresh that evidence is.',
    args: emptyArgsSchema,
    options: withWearableListOptions(),
    output: wearablesSourcesListResultSchema,
    async run({ options }) {
      const result = await services.query.listWearableSources({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })

      return wearablesSourcesListResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  wearables.command('drift', {
    description:
      'Explain the biggest normalized wearable drift Murph sees without dropping down to raw device payloads.',
    args: emptyArgsSchema,
    options: withWearableComparisonOptions(),
    examples: [
      {
        description:
          'Get a compact drift explanation that highlights which wearable metrics moved meaningfully.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `wearables drift` when the question is “what changed?” across wearable surfaces rather than “what is the exact latest value?”.',
    output: wearablesDriftResultSchema,
    async run({ options }) {
      const showWearableDrift = requireAdditiveWearablesQueryMethod<
        WearablesDriftResult,
        WearablesDriftInput
      >(services.query, 'showWearableDrift')
      const result = await showWearableDrift({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        windowDays: options.windowDays,
      })

      return wearablesDriftResultSchema.parse(withoutWearableVaultPath(result))
    },
  })

  wearables.command('patterns', {
    description:
      'Compare repeated activity and intervention days with next-day sleep and recovery outcomes.',
    args: emptyArgsSchema,
    options: withPersonalPatternOptions(),
    examples: [
      {
        description: 'Inspect matched personal patterns from the last 120 days.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Treat these links as clues, not proof. A stage shows how often the same direction appeared and whether it is worth a small test.',
    output: wearablesPersonalPatternsResultSchema,
    async run({ options }) {
      const showPersonalPatterns = requireAdditiveWearablesQueryMethod<
        WearablesPersonalPatternsResult,
        WearablesPersonalPatternsInput
      >(services.query, 'showPersonalPatterns')
      const result = await showPersonalPatterns({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        windowDays: options.windowDays,
      })

      return wearablesPersonalPatternsResultSchema.parse(
        withoutWearableVaultPath(result),
      )
    },
  })

  wearables.command(metric)
  wearables.command(sleep)
  wearables.command(activity)
  wearables.command(body)
  wearables.command(recovery)
  wearables.command(sources)
  cli.command(wearables)
}
