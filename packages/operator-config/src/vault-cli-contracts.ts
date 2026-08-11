import {
  eventSourceSchema,
  isValidIanaTimeZone,
  mealNutritionSchema,
} from '@murphai/contracts'
import { ALL_QUERY_ENTITY_FAMILIES } from '@murphai/query/entity-families'
import * as z from '@murphai/contracts/zod-runtime'

export const VAULT_CLI_BATCH_RESULT_SCHEMA = 'murph.vault-cli.batch-result.v1'

function describeQueryRecordTypes(values: readonly string[]): string {
  return `Optional query record families. Repeat --record-type for multiple values: ${values.join(', ')}.`
}

const queryRecordTypeValues = ALL_QUERY_ENTITY_FAMILIES
const queryRecordTypeDescription = describeQueryRecordTypes(queryRecordTypeValues)

export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('Timestamp in ISO 8601 format with an explicit UTC offset.')

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected a calendar date in YYYY-MM-DD form.')
  .describe('Calendar date in YYYY-MM-DD form.')

export const occurredAtOptionSchema = z
  .union([isoTimestampSchema, localDateSchema])
  .describe(
    'Occurrence timestamp in ISO 8601 format with an explicit UTC offset, or a calendar date in YYYY-MM-DD form.',
  )

export const timeZoneSchema = z
  .string()
  .min(3)
  .refine((value) => isValidIanaTimeZone(value), 'Expected a valid IANA timezone.')
  .describe('IANA timezone such as Australia/Melbourne.')

export const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    'Expected a lowercase kebab-case slug.',
  )
  .describe('Stable lowercase kebab-case identifier.')

export const pathSchema = z
  .string()
  .min(1)
  .describe('Filesystem path supplied by the operator.')

export const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .optional()
  .describe('Optional caller-supplied request id for audit correlation.')

export const baseCommandOptionsSchema = z.object({
  vault: pathSchema.describe('Vault root to operate against.'),
  requestId: requestIdSchema,
})

export const vaultInitResultSchema = z.object({
  vault: pathSchema,
  created: z.boolean(),
  directories: z.array(pathSchema),
  files: z.array(pathSchema),
})

export const validationIssueSchema = z.object({
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']),
})

export const vaultValidateResultSchema = z.object({
  vault: pathSchema,
  valid: z.boolean(),
  issues: z.array(validationIssueSchema),
})

export const documentImportResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  rawFile: pathSchema,
  manifestFile: pathSchema,
  documentId: z.string().min(1),
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
})

export const mealAddResultSchema = z.object({
  vault: pathSchema,
  mealId: z.string().min(1),
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  occurredAt: isoTimestampSchema.nullable(),
  photoPath: pathSchema.nullable(),
  audioPath: pathSchema.nullable(),
  manifestFile: pathSchema,
  note: z.string().nullable(),
  source: eventSourceSchema.nullable(),
  ingredients: z.array(z.string().min(1)).nullable(),
  nutrition: mealNutritionSchema.nullable(),
})

const workoutSetResultSchema = z.object({
  order: z.number().int().positive(),
  type: z.enum(['normal', 'warmup', 'dropset', 'failure']).optional(),
  reps: z.number().int().nonnegative().optional(),
  weight: z.number().nonnegative().optional(),
  weightUnit: z.enum(['lb', 'kg']).optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  distanceMeters: z.number().nonnegative().optional(),
  rpe: z.number().min(0).max(10).optional(),
  bodyweightKg: z.number().nonnegative().optional(),
  assistanceKg: z.number().nonnegative().optional(),
  addedWeightKg: z.number().nonnegative().optional(),
})

const storedMediaResultSchema = z.object({
  kind: z.enum(['photo', 'video', 'gif', 'image', 'other']),
  relativePath: pathSchema,
  mediaType: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
})

const bodyMeasurementEntryResultSchema = z.object({
  type: z.enum([
    'weight',
    'body_fat_pct',
    'waist',
    'neck',
    'shoulders',
    'chest',
    'biceps',
    'forearms',
    'abdomen',
    'hips',
    'thighs',
    'calves',
  ]),
  value: z.number().nonnegative(),
  unit: z.enum(['lb', 'kg', 'percent', 'cm', 'in']),
  note: z.string().min(1).optional(),
})

const measurementQualifierValueResultSchema = z.union([
  z.string().min(1),
  z.number(),
  z.boolean(),
])

export const measurementEntryResultSchema = z.object({
  metric: slugSchema,
  value: z.number(),
  unit: z.string().min(1),
  qualifiers: z.record(z.string().min(1), measurementQualifierValueResultSchema).optional(),
  note: z.string().min(1).optional(),
})

export const workoutUnitPreferenceValuesResultSchema = z.object({
  weight: z.enum(['lb', 'kg']).nullable(),
  bodyMeasurement: z.enum(['cm', 'in']).nullable(),
})

const workoutExerciseResultSchema = z.object({
  name: z.string().min(1),
  sourceExerciseId: z.string().min(1).optional(),
  order: z.number().int().positive(),
  groupId: z.string().min(1).optional(),
  mode: z
    .enum([
      'weight_reps',
      'bodyweight',
      'assisted_bodyweight',
      'weighted_bodyweight',
      'duration',
      'cardio',
    ])
    .optional(),
  unitOverride: z.enum(['lb', 'kg']).optional(),
  note: z.string().min(1).optional(),
  sets: z.array(workoutSetResultSchema).min(1).max(150),
})

const workoutSessionMetricsResultSchema = z.object({
  activeCalories: z.number().nonnegative().optional(),
  totalCalories: z.number().nonnegative().optional(),
  averageHeartRate: z.number().nonnegative().optional(),
  maxHeartRate: z.number().nonnegative().optional(),
  hrv: z.number().nonnegative().optional(),
  workoutStrain: z.number().nonnegative().optional(),
  percentRecorded: z.number().nonnegative().optional(),
  totalElevationGainMeters: z.number().nonnegative().optional(),
  altitudeChangeMeters: z.number().optional(),
  averageSpeedMps: z.number().nonnegative().optional(),
  maxSpeedMps: z.number().nonnegative().optional(),
})

const workoutSessionResultSchema = z.object({
  sourceApp: z.string().min(1).optional(),
  sourceWorkoutId: z.string().min(1).optional(),
  startedAt: isoTimestampSchema.optional(),
  endedAt: isoTimestampSchema.optional(),
  routineId: z.string().min(1).optional(),
  routineName: z.string().min(1).optional(),
  sessionNote: z.string().min(1).optional(),
  metrics: workoutSessionMetricsResultSchema.optional(),
  media: z.array(storedMediaResultSchema).max(10).optional(),
  exercises: z.array(workoutExerciseResultSchema).max(100),
})

const workoutTemplateSetResultSchema = z.object({
  order: z.number().int().positive(),
  type: z.enum(['normal', 'warmup', 'dropset', 'failure']).optional(),
  targetReps: z.number().int().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  targetWeightUnit: z.enum(['lb', 'kg']).optional(),
  targetDurationSeconds: z.number().int().nonnegative().optional(),
  targetDistanceMeters: z.number().nonnegative().optional(),
  targetRpe: z.number().min(0).max(10).optional(),
})

const workoutTemplateExerciseResultSchema = z.object({
  name: z.string().min(1),
  sourceExerciseId: z.string().min(1).optional(),
  order: z.number().int().positive(),
  groupId: z.string().min(1).optional(),
  mode: z
    .enum([
      'weight_reps',
      'bodyweight',
      'assisted_bodyweight',
      'weighted_bodyweight',
      'duration',
      'cardio',
    ])
    .optional(),
  unitOverride: z.enum(['lb', 'kg']).optional(),
  note: z.string().min(1).optional(),
  plannedSets: z.array(workoutTemplateSetResultSchema).min(1).max(150),
})

export const workoutTemplateResultSchema = z.object({
  routineNote: z.string().min(1).optional(),
  exercises: z.array(workoutTemplateExerciseResultSchema).min(1).max(100),
})

const exerciseCatalogKindResultSchema = z.enum([
  'exercise',
  'stretch',
  'mobility',
  'breathing',
])

const exerciseCatalogEnvironmentResultSchema = z.enum(['at_home', 'gym'])

const exerciseCatalogLevelResultSchema = z.enum([
  'beginner',
  'intermediate',
  'advanced',
])

const exerciseCatalogCommonnessResultSchema = z.enum([
  'very_common',
  'common',
  'variant',
])

const exerciseCatalogSummaryResultSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  kind: exerciseCatalogKindResultSchema,
  environment: z.array(exerciseCatalogEnvironmentResultSchema),
  category: z.string().min(1),
  targets: z.array(z.string().min(1)),
  level: exerciseCatalogLevelResultSchema,
  equipment: z.array(z.string().min(1)),
  position: z.string().min(1).nullable(),
  modality: z.string().min(1),
  commonness: exerciseCatalogCommonnessResultSchema,
  description: z.string().min(1),
})

const exerciseCatalogImageResultSchema = z.object({
  url: z.string().url(),
  step: z.string().min(1),
  alt: z.string().min(1),
})

const exerciseCatalogItemResultSchema = exerciseCatalogSummaryResultSchema.extend({
  sourceIds: z.array(z.number().int().positive()),
  steps: z.array(z.string().min(1)),
  tips: z.array(z.string().min(1)),
  images: z.array(exerciseCatalogImageResultSchema),
})

const exerciseCatalogSourceResultSchema = z.object({
  id: z.number().int().positive(),
  url: z.string().url(),
})

const exerciseCatalogFiltersResultSchema = z.object({
  query: z.string().min(1).nullable(),
  kind: z.array(exerciseCatalogKindResultSchema),
  environment: z.array(exerciseCatalogEnvironmentResultSchema),
  category: z.array(z.string().min(1)),
  target: z.array(z.string().min(1)),
  level: z.array(exerciseCatalogLevelResultSchema),
  equipment: z.array(z.string().min(1)),
  position: z.array(z.string().min(1)),
  modality: z.array(z.string().min(1)),
  commonness: z.array(exerciseCatalogCommonnessResultSchema),
  limit: z.number().int().positive().max(500),
})

export const exerciseListResultSchema = z.object({
  catalogHash: z.string().min(1),
  filters: exerciseCatalogFiltersResultSchema,
  total: z.number().int().nonnegative(),
  items: z.array(exerciseCatalogSummaryResultSchema),
})

export const exerciseShowResultSchema = z.object({
  catalogHash: z.string().min(1),
  lookup: z.string().min(1),
  item: exerciseCatalogItemResultSchema,
  sources: z.array(exerciseCatalogSourceResultSchema),
})

export const exerciseFacetsResultSchema = z.object({
  catalogHash: z.string().min(1),
  facets: z.object({
    kinds: z.array(exerciseCatalogKindResultSchema),
    environments: z.array(exerciseCatalogEnvironmentResultSchema),
    categories: z.array(z.string().min(1)),
    targets: z.array(z.string().min(1)),
    levels: z.array(exerciseCatalogLevelResultSchema),
    equipment: z.array(z.string().min(1)),
    positions: z.array(z.string().min(1)),
    modalities: z.array(z.string().min(1)),
    commonness: z.array(exerciseCatalogCommonnessResultSchema),
  }),
})

export const workoutAddResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  occurredAt: isoTimestampSchema,
  kind: z.literal('activity_session'),
  title: z.string().min(1),
  activityType: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  distanceKm: z.number().nonnegative().nullable(),
  workout: workoutSessionResultSchema.nullable(),
  note: z.string().min(1),
})

export const captureResultItemSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  stableLookupId: slugSchema.nullable(),
  ledgerFile: pathSchema,
  created: z.boolean(),
  occurredAt: isoTimestampSchema,
  kind: z.literal('capture'),
  title: z.string().min(1),
  label: slugSchema.nullable(),
  bodySite: z.string().min(1).nullable(),
  collection: slugSchema.nullable(),
  tags: z.array(slugSchema),
  media: z.array(storedMediaResultSchema).min(1),
  manifestFile: pathSchema.nullable(),
  note: z.string().min(1).nullable(),
})

export const captureAddResultSchema = z.object({
  vault: pathSchema,
  addedCount: z.number().int().positive(),
  captures: z.array(captureResultItemSchema).min(1),
})

export const measurementAddResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  occurredAt: isoTimestampSchema,
  kind: z.literal('measurement'),
  title: z.string().min(1),
  measurements: z.array(measurementEntryResultSchema).min(1).max(25),
  media: z.array(storedMediaResultSchema).max(10),
  manifestFile: pathSchema.nullable(),
  note: z.string().min(1).nullable(),
})

export const workoutMeasurementAddResultSchema = measurementAddResultSchema

export const workoutUnitPreferencesResultSchema = z.object({
  vault: pathSchema,
  preferencesPath: pathSchema,
  updated: z.boolean(),
  recordedAt: isoTimestampSchema.nullable(),
  unitPreferences: workoutUnitPreferenceValuesResultSchema,
})

export const workoutImportInspectResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  source: z.string().min(1),
  detectedSource: z.string().min(1).nullable(),
  delimiter: z.string().min(1),
  headers: z.array(z.string()),
  rowCount: z.number().int().nonnegative(),
  estimatedWorkouts: z.number().int().nonnegative(),
  importable: z.boolean(),
  warnings: z.array(z.string()),
})

export const workoutImportCsvResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  rawFile: pathSchema,
  manifestFile: pathSchema,
  source: z.string().min(1),
  importedCount: z.number().int().nonnegative(),
  rawOnly: z.boolean(),
  lookupIds: z.array(z.string().min(1)),
  ledgerFiles: z.array(pathSchema),
  warnings: z.array(z.string()),
})

export const workoutFormatSaveResultSchema = z.object({
  vault: pathSchema,
  name: z.string().min(1),
  slug: slugSchema,
  path: pathSchema,
  created: z.boolean(),
})

export const interventionAddResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  occurredAt: isoTimestampSchema,
  kind: z.literal('intervention_session'),
  title: z.string().min(1),
  interventionType: z.string().min(1),
  durationMinutes: z.number().int().positive().nullable(),
  regimenId: z.string().min(1).nullable(),
  experimentId: z.string().min(1).nullable(),
  experimentSlug: slugSchema.nullable(),
  experimentLinkMode: z.enum(['auto', 'explicit']).nullable(),
  note: z.string().min(1),
})

export const samplesImportCsvResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  timeZone: timeZoneSchema,
  tsColumn: z.string().min(1),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  lookupIds: z.array(z.string().min(1)).min(1),
  ledgerFiles: z.array(pathSchema).min(1),
  streams: z.array(z.string().min(1)).min(1),
  imports: z.array(
    z.object({
      stream: z.string().min(1),
      unit: z.string().min(1),
      timeZone: timeZoneSchema,
      tsColumn: z.string().min(1),
      valueColumn: z.string().min(1),
      importedCount: z.number().int().nonnegative(),
      skippedCount: z.number().int().nonnegative(),
      skipReasons: z.array(
        z.object({
          count: z.number().int().positive(),
          reason: z.string().min(1),
        }),
      ),
      transformId: z.string().min(1).nullable(),
      manifestFile: pathSchema.nullable(),
      lookupIds: z.array(z.string().min(1)),
      ledgerFiles: z.array(pathSchema),
    }),
  ).min(1),
  inferred: z.object({
    timeZone: timeZoneSchema,
    tsColumn: z.string().min(1),
    metadataColumns: z.array(z.string().min(1)),
    imports: z.array(
      z.object({
        stream: z.string().min(1),
        valueColumn: z.string().min(1),
      }),
    ).min(1),
  }),
})

const sampleSkipReasonSchema = z.object({
  count: z.number().int().positive(),
  reason: z.string().min(1),
})

const sampleWindowGapSchema = z.object({
  from: isoTimestampSchema,
  to: isoTimestampSchema,
  durationSeconds: z.number().nonnegative(),
})

const sampleThresholdSummarySchema = z.object({
  below: z.number(),
  sampleCount: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  clusterCount: z.number().int().nonnegative(),
  longestRunSeconds: z.number().nonnegative(),
})

export const sampleWindowSummarySchema = z.object({
  stream: z.string().min(1),
  unit: z.string().min(1).nullable(),
  from: isoTimestampSchema.nullable(),
  to: isoTimestampSchema.nullable(),
  sampleCount: z.number().int().nonnegative(),
  numericSampleCount: z.number().int().nonnegative(),
  firstSampleAt: isoTimestampSchema.nullable(),
  lastSampleAt: isoTimestampSchema.nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  sampleIntervalSeconds: z.number().positive().nullable(),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  averageValue: z.number().nullable(),
  thresholds: z.array(sampleThresholdSummarySchema),
  gaps: z.array(sampleWindowGapSchema),
  warnings: z.array(z.string().min(1)),
  screen: z.object({
    profile: z.literal('oxygen-night'),
    level: z.enum([
      'normal_oxygen_trace',
      'borderline_oxygen_trace',
      'concerning_oxygen_trace',
    ]),
    reasons: z.array(z.string().min(1)),
    caveat: z.string().min(1),
  }).optional(),
})

export const samplesSummarizeResultSchema = z.object({
  vault: pathSchema,
  summary: sampleWindowSummarySchema,
})

export const samplesCsvProfileResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  vaultRoot: pathSchema.optional(),
  sourcePath: pathSchema,
  sourceFileName: z.string().min(1),
  file: z.object({
    kind: z.literal('csv'),
    fileName: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    delimiter: z.string().min(1),
    rowCount: z.number().int().nonnegative(),
    dataRowCount: z.number().int().nonnegative(),
    blankRowCount: z.number().int().nonnegative(),
  }),
  columns: z.array(z.object({
    name: z.string(),
    index: z.number().int().nonnegative(),
    role: z.enum(['timestamp', 'sample_value', 'metadata', 'ignored']),
    stream: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
  })),
  time: z.object({
    timeZone: timeZoneSchema,
    timestampColumn: z.string().min(1),
    firstRecordedAt: isoTimestampSchema.nullable(),
    lastRecordedAt: isoTimestampSchema.nullable(),
    sampleIntervalSeconds: z.number().positive().nullable(),
    gapCount: z.number().int().nonnegative(),
    gaps: z.array(sampleWindowGapSchema),
  }),
  series: z.array(z.object({
    stream: z.string().min(1),
    unit: z.string().min(1),
    valueColumn: z.string().min(1),
    importableCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    skipReasons: z.array(sampleSkipReasonSchema),
    minValue: z.number().nullable(),
    maxValue: z.number().nullable(),
    averageValue: z.number().nullable(),
    confidence: z.number().min(0).max(1),
  })),
  sourceHints: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })),
  warnings: z.array(z.string().min(1)),
  summaries: z.array(sampleWindowSummarySchema).optional(),
})

export const experimentCreateResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  experimentPath: pathSchema,
  created: z.boolean(),
})

export const journalEnsureResultSchema = z.object({
  vault: pathSchema,
  date: localDateSchema,
  lookupId: z.string().min(1),
  journalPath: pathSchema,
  created: z.boolean(),
})

export const entityRefSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  queryable: z.boolean(),
})

export const readEntitySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1).nullable(),
  occurredAt: isoTimestampSchema.nullable(),
  path: pathSchema.nullable(),
  markdown: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  links: z.array(entityRefSchema),
})

export const savedEntitySnapshotSchema = readEntitySchema.omit({
  markdown: true,
})

export const listEntitySchema = readEntitySchema
  .omit({
    markdown: true,
  })
  .extend({
    data: z.record(z.string(), z.any()),
    excerpt: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe('Optional compact body excerpt for list summaries.'),
  })

export const showResultSchema = z.object({
  vault: pathSchema,
  entity: readEntitySchema,
})

export const listFilterSchema = z.object({
  recordType: z
    .array(z.string().min(1))
    .optional()
    .describe(queryRecordTypeDescription),
  kind: z
    .string()
    .min(1)
    .optional()
    .describe('Optional canonical kind filter such as meal, note, document, journal_day, or blood_test.'),
  status: z
    .string()
    .min(1)
    .optional()
    .describe('Optional status filter such as active, stopped, accepted, draft, or saved.'),
  stream: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional sample stream filter. Repeat for multiple streams.'),
  experiment: slugSchema
    .optional()
    .describe('Optional experiment slug filter.'),
  from: localDateSchema
    .optional()
    .describe('Inclusive lower date bound in YYYY-MM-DD form.'),
  to: localDateSchema
    .optional()
    .describe('Inclusive upper date bound in YYYY-MM-DD form.'),
  tag: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional tag filter. Repeat for multiple tags.'),
  limit: z.number().int().positive().max(200).default(10),
})

export const listItemSchema = listEntitySchema

export const workoutFormatListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listEntitySchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export const listResultSchema = z.object({
  vault: pathSchema,
  filters: listFilterSchema,
  items: z.array(listEntitySchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export const deleteResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.string().min(1),
  deleted: z.literal(true),
  retainedPaths: z.array(pathSchema),
})

export const exportPackResultSchema = z.object({
  vault: pathSchema,
  from: localDateSchema,
  to: localDateSchema,
  experiment: slugSchema.nullable(),
  outDir: pathSchema.nullable(),
  packId: z.string().min(1),
  files: z.array(pathSchema),
})

export type BaseCommandOptions = z.infer<typeof baseCommandOptionsSchema>
export type VaultInitResult = z.infer<typeof vaultInitResultSchema>
export type VaultValidateResult = z.infer<typeof vaultValidateResultSchema>
export type DocumentImportResult = z.infer<typeof documentImportResultSchema>
export type MealAddResult = z.infer<typeof mealAddResultSchema>
export type CaptureResultItem = z.infer<typeof captureResultItemSchema>
export type CaptureAddResult = z.infer<typeof captureAddResultSchema>
export type WorkoutAddResult = z.infer<typeof workoutAddResultSchema>
export type WorkoutFormatSaveResult = z.infer<typeof workoutFormatSaveResultSchema>
export type WorkoutImportInspectResult = z.infer<typeof workoutImportInspectResultSchema>
export type WorkoutImportCsvResult = z.infer<typeof workoutImportCsvResultSchema>
export type InterventionAddResult = z.infer<typeof interventionAddResultSchema>
export type SamplesImportCsvResult = z.infer<
  typeof samplesImportCsvResultSchema
>
export type SampleWindowSummaryResult = z.infer<
  typeof sampleWindowSummarySchema
>
export type SamplesSummarizeResult = z.infer<
  typeof samplesSummarizeResultSchema
>
export type SamplesCsvProfileResult = z.infer<
  typeof samplesCsvProfileResultSchema
>
export type ExperimentCreateResult = z.infer<
  typeof experimentCreateResultSchema
>
export type JournalEnsureResult = z.infer<typeof journalEnsureResultSchema>
export type ReadEntity = z.infer<typeof readEntitySchema>
export type SavedEntitySnapshot = z.infer<typeof savedEntitySnapshotSchema>
export interface ListEntity extends Omit<ReadEntity, 'markdown' | 'data'> {
  [key: string]: any
  data: any
  excerpt?: string | null
}
export type ListItem = ListEntity
export type ShowResult = z.infer<typeof showResultSchema>
export type ListFilters = z.infer<typeof listFilterSchema>
export type WorkoutFormatListResult = z.infer<typeof workoutFormatListResultSchema>
export type ListResult = z.infer<typeof listResultSchema>
export type DeleteResult = z.infer<typeof deleteResultSchema>
export type ExportPackResult = z.infer<typeof exportPackResultSchema>
