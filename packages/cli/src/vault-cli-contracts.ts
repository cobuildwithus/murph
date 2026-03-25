import { z } from 'incur'

export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('Timestamp in ISO 8601 format with an explicit UTC offset.')

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected a calendar date in YYYY-MM-DD form.')
  .describe('Calendar date in YYYY-MM-DD form.')

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
})

const strengthExerciseResultSchema = z.object({
  exercise: z.string().min(1),
  setCount: z.number().int().positive(),
  repsPerSet: z.number().int().positive(),
  load: z.number().nonnegative().optional(),
  loadUnit: z.enum(['lb', 'kg']).optional(),
  loadDescription: z.string().min(1).optional(),
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
  distanceKm: z.number().positive().nullable(),
  strengthExercises: z.array(strengthExerciseResultSchema).nullable(),
  note: z.string().min(1),
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
  recordType: z.array(z.string().min(1)).optional(),
  kind: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  stream: z.array(z.string().min(1)).optional(),
  experiment: slugSchema.optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  tag: z.array(z.string().min(1)).optional(),
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
export type ExportPackResult = z.infer<typeof exportPackResultSchema>
