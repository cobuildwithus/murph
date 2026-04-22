import { Cli, z } from 'incur'
import {
  resolveWearableCanonicalMetricKey,
  wearableCanonicalMetricKeys,
} from '@murphai/importers/device-providers/metric-catalog'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeRepeatableFlagOption } from '@murphai/vault-usecases'
import {
  localDateSchema,
  pathSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'

const nullableTimestampSchema = z.string().min(1).nullable()
const nullableTextSchema = z.string().min(1).nullable()
const wearableConfidenceLevelSchema = z.enum(['none', 'low', 'medium', 'high'])
const wearableSourceFamilySchema = z.enum(['canonical', 'event', 'sample', 'derived'])
const wearableCanonicalMetricKeySchema = z.enum(wearableCanonicalMetricKeys)
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

const wearableExternalRefSchema = z.object({
  system: nullableTextSchema,
  resourceType: nullableTextSchema,
  resourceId: nullableTextSchema,
  version: nullableTextSchema,
  facet: nullableTextSchema,
})

const wearableMetricCandidateSchema = z.object({
  candidateId: z.string().min(1),
  date: localDateSchema,
  externalRef: wearableExternalRefSchema.nullable(),
  metric: z.string().min(1),
  occurredAt: nullableTimestampSchema,
  paths: z.array(z.string().min(1)),
  provider: z.string().min(1),
  recordedAt: nullableTimestampSchema,
  recordIds: z.array(z.string().min(1)),
  sourceFamily: wearableSourceFamilySchema,
  sourceKind: z.string().min(1),
  title: nullableTextSchema,
  unit: nullableTextSchema,
  value: z.number(),
})

const wearableMetricSelectionSchema = z.object({
  fallbackFromMetric: nullableTextSchema,
  fallbackReason: nullableTextSchema,
  occurredAt: nullableTimestampSchema,
  paths: z.array(z.string().min(1)),
  provider: nullableTextSchema,
  recordedAt: nullableTimestampSchema,
  recordIds: z.array(z.string().min(1)),
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
  candidates: z.array(wearableMetricCandidateSchema),
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
  date: localDateSchema,
  dayStrain: wearableResolvedMetricSchema,
  distanceKm: wearableResolvedMetricSchema,
  notes: z.array(z.string()),
  sessionCount: wearableResolvedMetricSchema,
  sessionMinutes: wearableResolvedMetricSchema,
  steps: wearableResolvedMetricSchema,
  summaryConfidence: wearableSummaryConfidenceSchema,
})

const wearableSleepSummarySchema = z.object({
  averageHeartRate: wearableResolvedMetricSchema,
  awakeMinutes: wearableResolvedMetricSchema,
  date: localDateSchema,
  deepMinutes: wearableResolvedMetricSchema,
  hrv: wearableResolvedMetricSchema,
  lightMinutes: wearableResolvedMetricSchema,
  lowestHeartRate: wearableResolvedMetricSchema,
  notes: z.array(z.string()),
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

export const wearablesDayResultSchema = z.object({
  vault: pathSchema,
  date: localDateSchema,
  filters: wearableDayFiltersSchema,
  summary: wearableDaySummarySchema.nullable(),
})

export const wearablesSleepListResultSchema = z.object({
  vault: pathSchema,
  filters: wearableListFiltersSchema,
  items: z.array(wearableSleepSummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesActivityListResultSchema = z.object({
  vault: pathSchema,
  filters: wearableListFiltersSchema,
  items: z.array(wearableActivitySummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesBodyStateListResultSchema = z.object({
  vault: pathSchema,
  filters: wearableListFiltersSchema,
  items: z.array(wearableBodyStateSummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesRecoveryListResultSchema = z.object({
  vault: pathSchema,
  filters: wearableListFiltersSchema,
  items: z.array(wearableRecoverySummarySchema),
  count: z.number().int().nonnegative(),
})

export const wearablesSourcesListResultSchema = z.object({
  vault: pathSchema,
  filters: wearableListFiltersSchema,
  items: z.array(wearableSourceHealthSummarySchema),
  count: z.number().int().nonnegative(),
})

const wearablesMetricRequestSchema = z.object({
  input: z.string().trim().min(1),
  resolved: wearableCanonicalMetricKeySchema.nullable(),
})

const wearablesLatestSummarySchema = z
  .object({
    activity: wearableActivitySummarySchema.nullable(),
    bodyState: wearableBodyStateSummarySchema.nullable(),
    highlights: z.array(z.string()),
    latestDate: localDateSchema.nullable(),
    providers: z.array(z.string().min(1)),
    recovery: wearableRecoverySummarySchema.nullable(),
    sleep: wearableSleepSummarySchema.nullable(),
    sourceHealth: z.array(wearableSourceHealthSummarySchema),
  })
  .passthrough()

const wearablesMetricPointSchema = z
  .object({
    date: localDateSchema,
    resolvedMetric: wearableResolvedMetricSchema,
    unit: nullableTextSchema.optional(),
    value: z.number().nullable().optional(),
  })
  .passthrough()

const wearablesMetricTrendSummarySchema = z
  .object({
    baseline: wearablesMetricPointSchema.nullable().optional(),
    latest: wearablesMetricPointSchema.nullable().optional(),
    notes: z.array(z.string()).optional(),
    points: z.array(wearablesMetricPointSchema),
    windowDays: z.number().int().positive().optional(),
  })
  .passthrough()

const wearablesDriftMetricSchema = z
  .object({
    baseline: wearablesMetricPointSchema.nullable().optional(),
    direction: z.enum(['up', 'down', 'flat', 'mixed', 'unknown']).optional(),
    latest: wearablesMetricPointSchema.nullable().optional(),
    metric: wearableCanonicalMetricKeySchema,
    notes: z.array(z.string()).optional(),
  })
  .passthrough()

const wearablesDriftSummarySchema = z
  .object({
    latestDate: localDateSchema.nullable().optional(),
    metrics: z.array(wearablesDriftMetricSchema),
    summary: z.array(z.string()),
  })
  .passthrough()

export const wearablesLatestResultSchema = z
  .object({
    summary: wearablesLatestSummarySchema.nullable(),
    vault: pathSchema,
  })
  .passthrough()

export const wearablesMetricLatestResultSchema = z
  .object({
    latest: wearablesMetricPointSchema.nullable(),
    metric: wearablesMetricRequestSchema,
    vault: pathSchema,
  })
  .passthrough()

export const wearablesMetricTrendResultSchema = z
  .object({
    metric: wearablesMetricRequestSchema,
    trend: wearablesMetricTrendSummarySchema.nullable(),
    vault: pathSchema,
  })
  .passthrough()

export const wearablesDriftResultSchema = z
  .object({
    drift: wearablesDriftSummarySchema.nullable(),
    vault: pathSchema,
  })
  .passthrough()

type WearablesLatestResult = z.infer<typeof wearablesLatestResultSchema>
type WearablesMetricLatestResult = z.infer<typeof wearablesMetricLatestResultSchema>
type WearablesMetricTrendResult = z.infer<typeof wearablesMetricTrendResultSchema>
type WearablesDriftResult = z.infer<typeof wearablesDriftResultSchema>

interface WearablesLatestInput {
  requestId: string | null
  vault: string
}

interface WearablesMetricInput extends WearablesLatestInput {
  metric: string
}

type AdditiveWearablesQueryMethod<
  TResult extends object,
  TInput extends WearablesLatestInput,
> = (
  input: TInput,
) => Promise<TResult>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildWearableMetricRequest(metric: string): z.infer<
  typeof wearablesMetricRequestSchema
> {
  const normalizedMetric = metric.trim()
  return {
    input: normalizedMetric,
    resolved: resolveWearableCanonicalMetricKey(normalizedMetric),
  }
}

function hasWearableMetricRequestShape(
  value: unknown,
): value is { metric: z.infer<typeof wearablesMetricRequestSchema> } {
  if (!isRecord(value) || !isRecord(value.metric)) {
    return false
  }

  return (
    typeof value.metric.input === 'string' &&
    (typeof value.metric.resolved === 'string' || value.metric.resolved === null)
  )
}

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

function normalizeWearableProviders(value: readonly string[] | undefined): string[] {
  return normalizeRepeatableFlagOption(value, 'provider') ?? []
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
    options: withBaseOptions(),
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

      return showWearableLatest({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  wearables.command('day', {
    description:
      "Show Murph's deduplicated wearable day mirror for one date, including sleep, activity, body-state, recovery, and source-confidence notes.",
    args: emptyArgsSchema,
    options: withBaseOptions({
      date: localDateSchema.describe('Calendar date in YYYY-MM-DD form.'),
      provider: repeatableProviderOptionSchema,
    }),
    examples: [
      {
        description: 'Inspect one day of wearable evidence before drilling into raw records.',
        options: {
          date: '2026-04-05',
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `wearables day` as the first read for date-specific wearable questions. Use the list subcommands for longer windows and provider/source freshness checks.',
    output: wearablesDayResultSchema,
    async run({ options }) {
      return services.query.showWearableDay({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        providers: normalizeWearableProviders(options.provider),
      })
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
    options: withBaseOptions(),
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
      })

      return hasWearableMetricRequestShape(result)
        ? result
        : Object.assign({}, result, {
            metric: buildWearableMetricRequest(args.metric),
          })
    },
  })

  metric.command('trend', {
    description:
      'Show a compact normalized trend window for one wearable metric key or alias.',
    args: wearableMetricArgSchema,
    options: withBaseOptions(),
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
      })

      return hasWearableMetricRequestShape(result)
        ? result
        : Object.assign({}, result, {
            metric: buildWearableMetricRequest(args.metric),
          })
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
      return services.query.listWearableSleep({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })
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
      return services.query.listWearableActivity({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })
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
      return services.query.listWearableBodyState({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })
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
      return services.query.listWearableRecovery({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })
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
      return services.query.listWearableSources({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: options.date,
        from: options.from,
        to: options.to,
        providers: normalizeWearableProviders(options.provider),
        limit: options.limit,
      })
    },
  })

  wearables.command('drift', {
    description:
      'Explain the biggest normalized wearable drift Murph sees without dropping down to raw device payloads.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
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
        WearablesLatestInput
      >(services.query, 'showWearableDrift')

      return showWearableDrift({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
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
