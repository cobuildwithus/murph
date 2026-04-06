import { isValidIanaTimeZone } from '@murphai/contracts'
import { z } from 'zod'

export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('Timestamp in ISO 8601 format with an explicit UTC offset.')

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected a calendar date in YYYY-MM-DD form.')
  .describe('Calendar date in YYYY-MM-DD form.')

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

export const vaultUpgradeStepSchema = z.object({
  description: z.string().min(1),
  fromFormatVersion: z.number().int().nonnegative(),
  toFormatVersion: z.number().int().nonnegative(),
})

export const vaultUpgradeResultSchema = z.object({
  vault: pathSchema,
  metadataFile: pathSchema,
  title: z.string().min(1),
  timezone: z.string().min(1),
  fromFormatVersion: z.number().int().nonnegative(),
  toFormatVersion: z.number().int().nonnegative(),
  steps: z.array(vaultUpgradeStepSchema),
  affectedFiles: z.array(pathSchema),
  rebuildableProjectionStores: z.array(z.string().min(1)),
  updated: z.boolean(),
  dryRun: z.boolean(),
  auditPath: pathSchema.nullable(),
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
})

const strengthExerciseResultSchema = z.object({
  exercise: z.string().min(1),
  setCount: z.number().int().positive(),
  repsPerSet: z.number().int().positive(),
  load: z.number().nonnegative().optional(),
  loadUnit: z.enum(['lb', 'kg']).optional(),
  loadDescription: z.string().min(1).optional(),
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

export const profileUnitPreferencesResultSchema = z.object({
  weight: z.enum(['lb', 'kg']).nullable(),
  distance: z.enum(['km', 'mi']).nullable(),
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

const workoutSessionResultSchema = z.object({
  sourceApp: z.string().min(1).optional(),
  sourceWorkoutId: z.string().min(1).optional(),
  startedAt: isoTimestampSchema.optional(),
  endedAt: isoTimestampSchema.optional(),
  routineId: z.string().min(1).optional(),
  routineName: z.string().min(1).optional(),
  sessionNote: z.string().min(1).optional(),
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
  strengthExercises: z.array(strengthExerciseResultSchema).nullable(),
  workout: workoutSessionResultSchema.nullable(),
  note: z.string().min(1),
})

export const workoutMeasurementAddResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  occurredAt: isoTimestampSchema,
  kind: z.literal('body_measurement'),
  title: z.string().min(1),
  measurements: z.array(bodyMeasurementEntryResultSchema).min(1).max(25),
  media: z.array(storedMediaResultSchema).max(10),
  manifestFile: pathSchema.nullable(),
  note: z.string().min(1).nullable(),
})

export const workoutUnitPreferencesResultSchema = z.object({
  vault: pathSchema,
  snapshotId: z.string().min(1).nullable(),
  updated: z.boolean(),
  recordedAt: isoTimestampSchema.nullable(),
  unitPreferences: profileUnitPreferencesResultSchema,
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

export const workoutFormatListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(z.lazy(() => readEntitySchema)),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
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
  protocolId: z.string().min(1).nullable(),
  note: z.string().min(1),
})

export const samplesImportCsvResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  stream: z.string().min(1),
  importedCount: z.number().int().nonnegative(),
  transformId: z.string().min(1),
  manifestFile: pathSchema,
  lookupIds: z.array(z.string().min(1)).min(1),
  ledgerFiles: z.array(pathSchema).min(1),
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

export const showResultSchema = z.object({
  vault: pathSchema,
  entity: readEntitySchema,
})

export const listFilterSchema = z.object({
  recordType: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional query record families such as event, journal, assessment, profile_snapshot, current_profile, goal, condition, allergy, protocol, history, family, genetics, food, recipe, provider, or sample.',
    ),
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
  limit: z.number().int().positive().max(200).default(50),
})

export const listItemSchema = readEntitySchema

export const listResultSchema = z.object({
  vault: pathSchema,
  filters: listFilterSchema,
  items: z.array(listItemSchema),
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
export type WorkoutAddResult = z.infer<typeof workoutAddResultSchema>
export type WorkoutFormatSaveResult = z.infer<typeof workoutFormatSaveResultSchema>
export type WorkoutFormatListResult = z.infer<typeof workoutFormatListResultSchema>
export type WorkoutImportInspectResult = z.infer<typeof workoutImportInspectResultSchema>
export type WorkoutImportCsvResult = z.infer<typeof workoutImportCsvResultSchema>
export type InterventionAddResult = z.infer<typeof interventionAddResultSchema>
export type SamplesImportCsvResult = z.infer<
  typeof samplesImportCsvResultSchema
>
export type ExperimentCreateResult = z.infer<
  typeof experimentCreateResultSchema
>
export type JournalEnsureResult = z.infer<typeof journalEnsureResultSchema>
export type ReadEntity = z.infer<typeof readEntitySchema>
export type ShowResult = z.infer<typeof showResultSchema>
export type ListFilters = z.infer<typeof listFilterSchema>
export type ListResult = z.infer<typeof listResultSchema>
export type DeleteResult = z.infer<typeof deleteResultSchema>
export type ExportPackResult = z.infer<typeof exportPackResultSchema>
