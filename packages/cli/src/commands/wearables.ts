import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/assistant-core/command-helpers'
import { normalizeRepeatableFlagOption } from '@murphai/assistant-core/option-utils'
import {
  localDateSchema,
  pathSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
import type { VaultServices } from '@murphai/assistant-core/vault-services'

const nullableTimestampSchema = z.string().min(1).nullable()
const nullableTextSchema = z.string().min(1).nullable()
const wearableConfidenceLevelSchema = z.enum(['none', 'low', 'medium', 'high'])
const wearableSourceFamilySchema = z.enum(['event', 'sample', 'derived'])
const repeatableProviderOptionSchema = z
  .array(z.string().min(1))
  .optional()
  .describe(
    'Optional provider filter. Repeat --provider for multiple values such as oura, whoop, or garmin.',
  )

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

  wearables.command('day', {
    description:
      "Show Murph's deduplicated wearable day mirror for one date, including sleep, activity, body-state, recovery, and source-confidence notes.",
    args: emptyArgsSchema,
    options: withBaseOptions({
      date: localDateSchema.describe('Calendar date in YYYY-MM-DD form.'),
      provider: repeatableProviderOptionSchema,
    }),
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

  wearables.command(sleep)
  wearables.command(activity)
  wearables.command(body)
  wearables.command(recovery)
  wearables.command(sources)
  cli.command(wearables)
}
