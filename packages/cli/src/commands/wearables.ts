import { Cli, z } from 'incur'
import { wearablePreferenceProviderValues } from '@murphai/contracts'
import {
  wearableCanonicalMetricKeys,
} from '@murphai/importers/device-providers/metric-catalog'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeRepeatableEnumFlagOption } from '@murphai/vault-usecases'
import {
  localDateSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'

const nullableTimestampSchema = z.string().min(1).nullable()
const nullableTextSchema = z.string().min(1).nullable()
const wearableConfidenceLevelSchema = z.enum(['none', 'low', 'medium', 'high'])
const wearableSourceFamilySchema = z.enum(['canonical', 'event', 'sample', 'derived'])
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

const wearableMetricSelectionSchema = z.object({
  fallbackFromMetric: nullableTextSchema,
  fallbackReason: nullableTextSchema,
  occurredAt: nullableTimestampSchema,
  provider: nullableTextSchema,
  recordedAt: nullableTimestampSchema,
  resolution: z.enum(['direct', 'fallback', 'none']),
  sourceFamily: wearableSourceFamilySchema.nullable(),
  sourceKind: nullableTextSchema,
  title: nullableTextSchema,
  unit: nullableTextSchema,
  value: z.number().nullable(),
})

const wearableMetricConfidenceSchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  conflictingProviders: z.array(z.string().min(1)),
  exactDuplicateCount: z.number().int().nonnegative(),
  level: wearableConfidenceLevelSchema,
  reasons: z.array(z.string()),
})

const wearableResolvedMetricSchema = z.object({
  confidence: wearableMetricConfidenceSchema,
  metric: z.string().min(1),
  selection: wearableMetricSelectionSchema,
})

const wearableSummaryConfidenceSchema = z.object({
  conflictingMetrics: z.array(z.string().min(1)),
  level: wearableConfidenceLevelSchema,
  lowConfidenceMetrics: z.array(z.string().min(1)),
  notes: z.array(z.string()),
  selectedProviders: z.array(z.string().min(1)),
})

const wearableSourceHealthSummarySchema = z.object({
  activityDays: z.number().int().nonnegative(),
  bodyStateDays: z.number().int().nonnegative(),
  candidateMetrics: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  exactDuplicatesSuppressed: z.number().int().nonnegative(),
  firstDate: localDateSchema.nullable(),
  lastDate: localDateSchema.nullable(),
  latestRecordedAt: nullableTimestampSchema,
  metricsContributed: z.array(z.string().min(1)),
  notes: z.array(z.string()),
  provider: z.string().min(1),
  providerDisplayName: z.string().min(1),
  recoveryDays: z.number().int().nonnegative(),
  selectedMetrics: z.number().int().nonnegative(),
  sleepNights: z.number().int().nonnegative(),
  stalenessVsNewestDays: z.number().int().nonnegative().nullable(),
})

const wearableActivitySummarySchema = z.object({
  activityScore: wearableResolvedMetricSchema,
  activeCalories: wearableResolvedMetricSchema,
  activityTypes: z.array(z.string().min(1)),
  altitudeChangeMeters: wearableResolvedMetricSchema,
  date: localDateSchema,
  dayStrain: wearableResolvedMetricSchema,
  distanceKm: wearableResolvedMetricSchema,
  estimatedVo2Max: wearableResolvedMetricSchema,
  maxHeartRate: wearableResolvedMetricSchema,
  notes: z.array(z.string()),
  percentRecorded: wearableResolvedMetricSchema,
  sessionCount: wearableResolvedMetricSchema,
  sessionMinutes: wearableResolvedMetricSchema,
  steps: wearableResolvedMetricSchema,
  summaryConfidence: wearableSummaryConfidenceSchema,
  totalCalories: wearableResolvedMetricSchema,
  totalElevationGainMeters: wearableResolvedMetricSchema,
  workoutStrain: wearableResolvedMetricSchema,
})

const wearableSleepSummarySchema = z.object({
  averageHeartRate: wearableResolvedMetricSchema,
  awakeMinutes: wearableResolvedMetricSchema,
  date: localDateSchema,
  deepMinutes: wearableResolvedMetricSchema,
  hrv: wearableResolvedMetricSchema,
  lightMinutes: wearableResolvedMetricSchema,
  lowestHeartRate: wearableResolvedMetricSchema,
  lowestSpo2: wearableResolvedMetricSchema,
  notes: z.array(z.string()),
  provider: nullableTextSchema,
  remMinutes: wearableResolvedMetricSchema,
  respiratoryRate: wearableResolvedMetricSchema,
  sessionMinutes: wearableResolvedMetricSchema,
  sleepConsistency: wearableResolvedMetricSchema,
  sleepEfficiency: wearableResolvedMetricSchema,
  sleepEndAt: nullableTimestampSchema,
  sleepPerformance: wearableResolvedMetricSchema,
  sleepScore: wearableResolvedMetricSchema,
  sleepStartAt: nullableTimestampSchema,
  sleepWindowProvider: nullableTextSchema,
  spo2: wearableResolvedMetricSchema,
  summaryConfidence: wearableSummaryConfidenceSchema,
  timeInBedMinutes: wearableResolvedMetricSchema,
  totalSleepMinutes: wearableResolvedMetricSchema,
})

const wearableRecoverySummarySchema = z.object({
  bodyBattery: wearableResolvedMetricSchema,
  date: localDateSchema,
  hrv: wearableResolvedMetricSchema,
  notes: z.array(z.string()),
  readinessScore: wearableResolvedMetricSchema,
  recoveryScore: wearableResolvedMetricSchema,
  respiratoryRate: wearableResolvedMetricSchema,
  restingHeartRate: wearableResolvedMetricSchema,
  spo2: wearableResolvedMetricSchema,
  stressLevel: wearableResolvedMetricSchema,
  summaryConfidence: wearableSummaryConfidenceSchema,
  temperature: wearableResolvedMetricSchema,
  temperatureDeviation: wearableResolvedMetricSchema,
})

const wearableBodyStateSummarySchema = z.object({
  bmi: wearableResolvedMetricSchema,
  bodyFatPercentage: wearableResolvedMetricSchema,
  date: localDateSchema,
  notes: z.array(z.string()),
  summaryConfidence: wearableSummaryConfidenceSchema,
  temperature: wearableResolvedMetricSchema,
  weightKg: wearableResolvedMetricSchema,
})

const wearableDaySummarySchema = z.object({
  activity: wearableActivitySummarySchema.nullable(),
  bodyState: wearableBodyStateSummarySchema.nullable(),
  date: localDateSchema,
  notes: z.array(z.string()),
  providers: z.array(z.string().min(1)),
  recovery: wearableRecoverySummarySchema.nullable(),
  sleep: wearableSleepSummarySchema.nullable(),
  sourceHealth: z.array(wearableSourceHealthSummarySchema),
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

const wearableMetricSummaryKindSchema = z.enum([
  'activity',
  'bodyState',
  'recovery',
  'sleep',
])

const wearableMetricWindowStatsSchema = z.object({
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
  from: localDateSchema.nullable(),
  max: z.number().nullable(),
  min: z.number().nullable(),
  to: localDateSchema.nullable(),
})

const wearableMetricTrendPointSchema = z
  .object({
    confidence: wearableConfidenceLevelSchema,
    date: localDateSchema,
    provider: nullableTextSchema,
    recordedAt: nullableTimestampSchema,
    unit: nullableTextSchema,
    value: z.number(),
  })

const wearablesMetricLatestSummarySchema = z
  .object({
    confidence: wearableMetricConfidenceSchema,
    date: localDateSchema.nullable(),
    delta: z.number().nullable(),
    max: z.number().nullable(),
    metric: wearableCanonicalMetricKeySchema,
    min: z.number().nullable(),
    notes: z.array(z.string()),
    percentChange: z.number().nullable(),
    priorWindow: wearableMetricWindowStatsSchema,
    provider: nullableTextSchema,
    recentWindow: wearableMetricWindowStatsSchema,
    recordedAt: nullableTimestampSchema,
    requestedMetric: z.string().trim().min(1),
    resolvedAlias: nullableTextSchema,
    summaryKind: wearableMetricSummaryKindSchema,
    unit: nullableTextSchema,
    value: z.number().nullable(),
    windowDays: z.number().int().positive().max(30),
  })

const wearablesLatestSummarySchema = z
  .object({
    activity: wearableActivitySummarySchema.nullable(),
    bodyState: wearableBodyStateSummarySchema.nullable(),
    day: wearableDaySummarySchema,
    latestDate: localDateSchema,
    notes: z.array(z.string()),
    providers: z.array(z.string().min(1)),
    recovery: wearableRecoverySummarySchema.nullable(),
    sleep: wearableSleepSummarySchema.nullable(),
    sourceHealth: z.array(wearableSourceHealthSummarySchema),
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
      .default(30)
      .describe('Maximum number of daily summaries to return.'),
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

function normalizeWearableProviders(value: readonly string[] | undefined): string[] {
  return normalizeRepeatableEnumFlagOption(
    value?.map((entry) => entry.toLowerCase()),
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
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
      'Use metric aliases such as `hrv`, `resting-heart-rate`, `sleep-score`, or `skin-temp`; the shared wearable metric catalog resolves them to canonical keys.',
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
    },
  })

  const body = Cli.create('body', {
    description:
      'Deduplicated daily body-state summaries with weight, body-fat, BMI, temperature, and source-confidence notes.',
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
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

      return withoutWearableVaultPath(result)
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
