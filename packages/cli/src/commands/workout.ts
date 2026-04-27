import path from 'node:path'
import { Cli, z } from 'incur'
import {
  eventSourceSchema,
  type WorkoutFormatUpsertPayload,
  type WorkoutSession,
  workoutFormatUpsertPayloadSchema,
  workoutSessionSchema,
} from '@murphai/contracts'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
  normalizeRepeatableFlagOption,
} from '@murphai/vault-usecases'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  occurredAtOptionSchema,
  isoTimestampSchema,
  listResultSchema,
  pathSchema,
  showResultSchema,
  workoutAddResultSchema,
  workoutFormatListResultSchema,
  workoutFormatSaveResultSchema,
  workoutImportCsvResultSchema,
  workoutImportInspectResultSchema,
  workoutUnitPreferencesResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  listWorkoutRecords,
  showWorkoutManifest,
  showWorkoutRecord,
  workoutImportManifestResultSchema,
  workoutLookupSchema,
} from '@murphai/vault-usecases/workouts'
import {
  listWorkoutFormats,
  logWorkoutFormat,
  saveWorkoutFormat,
  showWorkoutFormat,
} from '@murphai/vault-usecases/workouts'
import {
  addWorkoutRecord,
  deleteWorkoutRecord,
  editWorkoutRecord,
} from '@murphai/vault-usecases/workouts'
import {
  importWorkoutCsv,
  inspectWorkoutCsvImport,
} from '@murphai/vault-usecases/workouts'
import {
  setWorkoutUnitPreferences,
  showWorkoutUnitPreferences,
} from '@murphai/vault-usecases/workouts'
import {
  createDirectEntityDeleteCommandDefinition,
  createDirectEventBackedEntityEditCommandDefinition,
} from './record-mutation-command-helpers.js'
import {
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
  createCommonListCommand,
  registerFactoryCommand,
} from './command-factory-primitives.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

const workoutSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

interface WorkoutAddExerciseDraft {
  groupId?: string
  mode?: string
  name: string
  note?: string
  order: number
  sets: Array<Record<string, unknown>>
  sourceExerciseId?: string
  unitOverride?: string
}

interface WorkoutAddTypedOptions {
  note?: string
  workoutEndedAt?: string
  workoutExercise?: string[]
  workoutMedia?: string[]
  workoutRoutineId?: string
  workoutRoutineName?: string
  workoutSessionNote?: string
  workoutSet?: string[]
  workoutSourceApp?: string
  workoutSourceWorkoutId?: string
  workoutStartedAt?: string
}

const workoutAddSessionOptionKeys = [
  'workoutSourceApp',
  'workoutSourceWorkoutId',
  'workoutStartedAt',
  'workoutEndedAt',
  'workoutRoutineId',
  'workoutRoutineName',
  'workoutSessionNote',
  'workoutMedia',
  'workoutExercise',
  'workoutSet',
] as const satisfies ReadonlyArray<keyof WorkoutAddTypedOptions>

const workoutAddMediaFields = new Set([
  'kind',
  'relativePath',
  'mediaType',
  'caption',
])

const workoutAddExerciseFields = new Set([
  'name',
  'order',
  'sourceExerciseId',
  'groupId',
  'mode',
  'unitOverride',
  'note',
])

const workoutAddSetFields = new Set([
  'exercise',
  'order',
  'type',
  'weightUnit',
  'reps',
  'weight',
  'durationSeconds',
  'distanceMeters',
  'rpe',
  'bodyweightKg',
  'assistanceKg',
  'addedWeightKg',
])

function invalidWorkoutAddOption(message: string): never {
  throw new VaultCliError('invalid_option', message)
}

function parseCompactWorkoutFields(spec: string, optionName: string): Map<string, string> {
  const fields = new Map<string, string>()

  for (const rawPart of spec.split(';')) {
    const part = rawPart.trim()
    if (part.length === 0) continue

    const separatorIndex = part.indexOf('=')
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()

    if (
      separatorIndex <= 0
      || key.length === 0
      || value.length === 0
    ) {
      invalidWorkoutAddOption(`Each --${optionName} entry must use key=value fields.`)
    }

    if (fields.has(key)) {
      invalidWorkoutAddOption(`Duplicate --${optionName} field "${key}".`)
    }
    fields.set(key, value)
  }

  return fields
}

function rejectUnknownCompactWorkoutFields(
  fields: ReadonlyMap<string, string>,
  supportedFields: ReadonlySet<string>,
  optionName: string,
) {
  for (const key of fields.keys()) {
    if (!supportedFields.has(key)) {
      invalidWorkoutAddOption(`Unsupported --${optionName} field "${key}".`)
    }
  }
}

function requireCompactWorkoutString(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
): string {
  const value = fields.get(key)
  if (value === undefined) {
    invalidWorkoutAddOption(`--${optionName} requires ${key}=...`)
  }
  return value
}

function compactWorkoutNumber(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
): number | undefined {
  const rawValue = fields.get(key)
  if (rawValue === undefined) return undefined

  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    invalidWorkoutAddOption(`--${optionName} field ${key} must be a finite number.`)
  }
  return value
}

function compactWorkoutInteger(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
): number | undefined {
  const value = compactWorkoutNumber(fields, key, optionName)
  if (value !== undefined && !Number.isInteger(value)) {
    invalidWorkoutAddOption(`--${optionName} field ${key} must be an integer.`)
  }
  return value
}

function requireCompactWorkoutInteger(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
): number {
  const value = compactWorkoutInteger(fields, key, optionName)
  if (value === undefined) {
    invalidWorkoutAddOption(`--${optionName} requires ${key}=...`)
  }
  return value
}

function normalizeWorkoutMediaRelativePath(relativePath: string): string {
  const candidate = relativePath.trim().replace(/\\/gu, '/')
  const normalized = path.posix.normalize(candidate)

  if (
    candidate.length === 0 ||
    candidate !== normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized) ||
    !normalized.startsWith('raw/workouts/')
  ) {
    invalidWorkoutAddOption(
      '--workout-media relativePath must be a normalized raw/workouts/** vault-relative path.',
    )
  }

  return normalized
}

function parseWorkoutAddMediaEntry(entry: string): Record<string, unknown> {
  const fields = parseCompactWorkoutFields(entry, 'workout-media')
  rejectUnknownCompactWorkoutFields(fields, workoutAddMediaFields, 'workout-media')
  return {
    kind: requireCompactWorkoutString(fields, 'kind', 'workout-media'),
    relativePath: normalizeWorkoutMediaRelativePath(
      requireCompactWorkoutString(fields, 'relativePath', 'workout-media'),
    ),
    ...(fields.has('mediaType') ? { mediaType: fields.get('mediaType') } : {}),
    ...(fields.has('caption') ? { caption: fields.get('caption') } : {}),
  }
}

function parseWorkoutAddExerciseEntry(entry: string): WorkoutAddExerciseDraft {
  const fields = parseCompactWorkoutFields(entry, 'workout-exercise')
  rejectUnknownCompactWorkoutFields(fields, workoutAddExerciseFields, 'workout-exercise')
  return {
    name: requireCompactWorkoutString(fields, 'name', 'workout-exercise'),
    order: requireCompactWorkoutInteger(fields, 'order', 'workout-exercise'),
    sets: [],
    ...(fields.has('sourceExerciseId')
      ? { sourceExerciseId: fields.get('sourceExerciseId') }
      : {}),
    ...(fields.has('groupId') ? { groupId: fields.get('groupId') } : {}),
    ...(fields.has('mode') ? { mode: fields.get('mode') } : {}),
    ...(fields.has('unitOverride') ? { unitOverride: fields.get('unitOverride') } : {}),
    ...(fields.has('note') ? { note: fields.get('note') } : {}),
  }
}

function parseWorkoutAddSetEntry(entry: string): {
  exerciseOrder: number
  set: Record<string, unknown>
} {
  const fields = parseCompactWorkoutFields(entry, 'workout-set')
  rejectUnknownCompactWorkoutFields(fields, workoutAddSetFields, 'workout-set')
  const exerciseOrder = requireCompactWorkoutInteger(fields, 'exercise', 'workout-set')
  const set: Record<string, unknown> = {
    order: requireCompactWorkoutInteger(fields, 'order', 'workout-set'),
  }

  for (const key of ['type', 'weightUnit']) {
    if (fields.has(key)) {
      set[key] = fields.get(key)
    }
  }

  for (const key of [
    'reps',
    'weight',
    'durationSeconds',
    'distanceMeters',
    'rpe',
    'bodyweightKg',
    'assistanceKg',
    'addedWeightKg',
  ]) {
    const value = compactWorkoutNumber(fields, key, 'workout-set')
    if (value !== undefined) {
      set[key] = value
    }
  }

  return {
    exerciseOrder,
    set,
  }
}

function hasWorkoutSessionOptions(options: WorkoutAddTypedOptions): boolean {
  return workoutAddSessionOptionKeys.some((key) => options[key] !== undefined)
}

function buildWorkoutFromTypedOptions(options: WorkoutAddTypedOptions): WorkoutSession | undefined {
  if (!hasWorkoutSessionOptions(options)) {
    return undefined
  }

  const workout: Record<string, unknown> = {
    exercises: [],
  }

  if (options.workoutSourceApp !== undefined) workout.sourceApp = options.workoutSourceApp
  if (options.workoutSourceWorkoutId !== undefined) {
    workout.sourceWorkoutId = options.workoutSourceWorkoutId
  }
  if (options.workoutStartedAt !== undefined) workout.startedAt = options.workoutStartedAt
  if (options.workoutEndedAt !== undefined) workout.endedAt = options.workoutEndedAt
  if (options.workoutRoutineId !== undefined) workout.routineId = options.workoutRoutineId
  if (options.workoutRoutineName !== undefined) workout.routineName = options.workoutRoutineName
  if (options.workoutSessionNote !== undefined) workout.sessionNote = options.workoutSessionNote

  const mediaEntries = normalizeRepeatableFlagOption(options.workoutMedia, 'workout-media')
  if (mediaEntries) {
    workout.media = mediaEntries.map(parseWorkoutAddMediaEntry)
  }

  const exercisesByOrder = new Map<number, WorkoutAddExerciseDraft>()
  const exerciseEntries = normalizeRepeatableFlagOption(
    options.workoutExercise,
    'workout-exercise',
  )
  for (const exercise of exerciseEntries?.map(parseWorkoutAddExerciseEntry) ?? []) {
    if (exercisesByOrder.has(exercise.order)) {
      invalidWorkoutAddOption(`Duplicate --workout-exercise order ${exercise.order}.`)
    }
    exercisesByOrder.set(exercise.order, exercise)
  }

  const setEntries = normalizeRepeatableFlagOption(options.workoutSet, 'workout-set')
  for (const { exerciseOrder, set } of setEntries?.map(parseWorkoutAddSetEntry) ?? []) {
    const exercise = exercisesByOrder.get(exerciseOrder)
    if (!exercise) {
      invalidWorkoutAddOption(
        `--workout-set references exercise ${exerciseOrder}, but no matching --workout-exercise was provided.`,
      )
    }
    exercise.sets.push(set)
  }

  workout.exercises = [...exercisesByOrder.values()].sort(
    (left, right) => left.order - right.order,
  )

  const parsed = workoutSessionSchema.safeParse(workout)
  if (!parsed.success) {
    throw new VaultCliError('invalid_option', 'Invalid workout session fields.', {
      issues: parsed.error.issues,
    })
  }

  return parsed.data
}

function resolveWorkoutAddText(argsText: string | undefined, optionNote: string | undefined): string | undefined {
  if (argsText !== undefined && optionNote !== undefined) {
    invalidWorkoutAddOption('Pass either positional workout text or --note, not both.')
  }
  return argsText ?? optionNote
}

export function registerWorkoutCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const workout = Cli.create('workout', {
    description:
      'Workout façade commands over activity sessions, workout-format docs, CSV import, and saved unit preferences.',
  })

  workout.command('add', {
    description:
      'Record one workout from typed fields or freeform text.',
    args: z.object({
      text: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe(
          'Optional freeform workout text such as "Went for a 30-minute run."',
        ),
    }),
    examples: [
      {
        description: 'Capture a run directly from one note.',
        args: {
          text: 'Went for a 30-minute run around the neighborhood.',
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Capture a structured strength workout through typed flags.',
        args: {},
        options: {
          vault: './vault',
          note: 'Garage strength session.',
          duration: 45,
          type: 'strength-training',
          workoutExercise: ['order=1;name=Bench press;mode=weight_reps'],
          workoutSet: ['exercise=1;order=1;type=normal;reps=5;weight=185;weightUnit=lb'],
        },
      },
    ],
    hint:
      'Use typed flags for one workout record. Use workout import-json --input @workout.json for bulk/import payloads or advanced nested fields outside the typed surface.',
    options: withBaseOptions({
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional workout note when omitting positional text.'),
      title: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe('Optional explicit workout title.'),
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional duration override in minutes when the note is missing or ambiguous.',
        ),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional workout distance override in kilometers.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe(
          'Optional event source (`manual`, `import`, `device`, or `derived`).',
        ),
      media: z
        .array(pathSchema)
        .optional()
        .describe('Optional workout photo or video file paths to copy into raw/workouts/** and attach to the workout event.'),
      workoutSourceApp: z
        .string()
        .regex(workoutSlugPattern)
        .optional()
        .describe('Optional workout-session source app slug.'),
      workoutSourceWorkoutId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('Optional source workout id for the workout session.'),
      workoutStartedAt: isoTimestampSchema
        .optional()
        .describe('Optional workout started-at timestamp.'),
      workoutEndedAt: isoTimestampSchema
        .optional()
        .describe('Optional workout ended-at timestamp.'),
      workoutRoutineId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('Optional workout routine id.'),
      workoutRoutineName: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional workout routine name.'),
      workoutSessionNote: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional nested workout session note.'),
      workoutMedia: z
        .array(z.string().min(1))
        .optional()
        .describe('Stored workout media as kind=...;relativePath=... with optional mediaType/caption. Repeat --workout-media for multiple entries. Use --media for local file staging.'),
      workoutExercise: z
        .array(z.string().min(1))
        .optional()
        .describe('Workout exercise as order=...;name=... with optional sourceExerciseId/groupId/mode/unitOverride/note. Repeat --workout-exercise for multiple exercises.'),
      workoutSet: z
        .array(z.string().min(1))
        .optional()
        .describe('Workout set as exercise=...;order=... plus optional type/reps/weight/weightUnit/durationSeconds/distanceMeters/rpe/bodyweightKg/assistanceKg/addedWeightKg. Repeat --workout-set for multiple sets.'),
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      const text = resolveWorkoutAddText(args.text, options.note)
      const workout = buildWorkoutFromTypedOptions(options)
      return addWorkoutRecord({
        vault: options.vault,
        text,
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
        title: typeof options.title === 'string' ? options.title : undefined,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string'
              ? options.occurredAt
              : undefined,
        }),
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        workout,
      })
    },
  })

  workout.command('import-json', {
    description:
      'Import one workout from an advanced structured JSON payload file or stdin.',
    args: z.object({
      text: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional freeform workout text used when the payload omits note text.'),
    }),
    examples: [
      {
        description: 'Capture a structured workout payload from disk.',
        args: {},
        options: {
          input: '@workout.json',
          vault: './vault',
        },
      },
    ],
    hint:
      '--input accepts @file.json or - for stdin. The payload retains the full structured workout import surface, including source fields, media/raw refs, exercises, and sets.',
    options: withBaseOptions({
      input: inputFileOptionSchema.describe('Advanced structured workout payload in @file.json form or - for stdin.'),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional workout note when omitting positional text.'),
      title: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe('Optional explicit workout title.'),
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional duration override in minutes when the payload is missing or ambiguous.',
        ),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional workout distance override in kilometers.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe(
          'Optional event source (`manual`, `import`, `device`, or `derived`).',
        ),
      media: z
        .array(pathSchema)
        .optional()
        .describe('Optional workout photo or video file paths to copy into raw/workouts/** and attach to the workout event.'),
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      const text = resolveWorkoutAddText(args.text, options.note)
      return addWorkoutRecord({
        vault: options.vault,
        text,
        inputFile: normalizeInputFileOption(options.input),
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
        title: typeof options.title === 'string' ? options.title : undefined,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string'
              ? options.occurredAt
              : undefined,
        }),
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      })
    },
  })

  workout.command('show', {
    description: 'Show one workout session by canonical event id.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showWorkoutRecord(options.vault, args.id)
    },
  })

  registerFactoryCommand(
    workout,
    createCommonListCommand({
      description: 'List workout sessions with optional date bounds.',
      options: {
        from: {
          description: commonDateRangeOptionDescriptions.from,
          name: 'from',
        },
        to: {
          description: commonDateRangeOptionDescriptions.to,
          name: 'to',
        },
        limit: commonListLimitOptionSchema,
      },
      output: listResultSchema,
      run(input) {
        return listWorkoutRecords({
          vault: input.vault,
          from: input.from,
          to: input.to,
          limit: input.limit,
        })
      },
    }),
  )

  workout.command('manifest', {
    description: 'Show the immutable raw import manifest for an imported workout event.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    options: withBaseOptions(),
    output: workoutImportManifestResultSchema,
    async run({ args, options }) {
      return showWorkoutManifest(options.vault, args.id)
    },
  })

  workout.command('edit', createDirectEventBackedEntityEditCommandDefinition({
    arg: {
      name: 'id',
      schema: workoutLookupSchema,
    },
    description:
      'Edit one workout session by merging a partial JSON patch or one or more path assignments into the saved activity event.',
    run(input) {
      return editWorkoutRecord({
        vault: input.vault,
        lookup: input.lookup,
        inputFile: input.inputFile,
        set: input.set,
        clear: input.clear,
        dayKeyPolicy: input.dayKeyPolicy,
      })
    },
  }))

  workout.command('delete', createDirectEntityDeleteCommandDefinition({
    arg: {
      name: 'id',
      schema: workoutLookupSchema,
    },
    description: 'Delete one workout activity_session event.',
    run(input) {
      return deleteWorkoutRecord({
        vault: input.vault,
        lookup: input.lookup,
      })
    },
  }))

  const units = Cli.create('units', {
    description:
      'Canonical weight and body-measurement unit preferences used by measurement capture flows.',
  })

  units.command('show', {
    description: 'Show the saved workout unit preferences from the canonical preferences singleton.',
    args: z.object({}),
    options: withBaseOptions(),
    output: workoutUnitPreferencesResultSchema,
    async run({ options }) {
      return showWorkoutUnitPreferences(options.vault)
    },
  })

  units.command('set', {
    description: 'Set one or more workout unit preferences on the canonical preferences singleton.',
    args: z.object({}),
    options: withBaseOptions({
      weight: z.enum(['lb', 'kg']).optional(),
      bodyMeasurement: z
        .enum(['cm', 'in'])
        .optional()
        .describe('Preferred circumference/body-measurement unit.'),
      recordedAt: isoTimestampSchema
        .optional()
        .describe('Optional preferences update timestamp override in ISO 8601 form.'),
    }),
    output: workoutUnitPreferencesResultSchema,
    async run({ options }) {
      return setWorkoutUnitPreferences({
        vault: options.vault,
        weight: typeof options.weight === 'string' ? options.weight : undefined,
        bodyMeasurement:
          typeof options.bodyMeasurement === 'string'
            ? options.bodyMeasurement
            : undefined,
        recordedAt:
          typeof options.recordedAt === 'string'
            ? options.recordedAt
            : undefined,
      })
    },
  })

  const importGroup = Cli.create('import', {
    description:
      'Inspect and import Strong/Hevy-style workout CSV exports into immutable raw batches plus canonical workout events.',
  })

  importGroup.command('inspect', {
    description: 'Inspect one workout CSV file without writing anything.',
    args: z.object({
      file: pathSchema.describe('Path to the workout CSV export to inspect.'),
    }),
    options: withBaseOptions({
      source: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('Optional source hint such as strong or hevy.'),
      delimiter: z
        .string()
        .min(1)
        .max(1)
        .optional()
        .describe('Optional single-character CSV delimiter override.'),
    }),
    output: workoutImportInspectResultSchema,
    async run({ args, options }) {
      return inspectWorkoutCsvImport({
        vault: options.vault,
        file: args.file,
        source: typeof options.source === 'string' ? options.source : undefined,
        delimiter: typeof options.delimiter === 'string' ? options.delimiter : undefined,
      })
    },
  })

  importGroup.command('csv', {
    description: 'Copy one workout CSV export into raw/workouts/** and optionally map it into activity_session events.',
    args: z.object({
      file: pathSchema.describe('Path to the workout CSV export to import.'),
    }),
    options: withBaseOptions({
      source: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('Optional source hint such as strong or hevy.'),
      delimiter: z
        .string()
        .min(1)
        .max(1)
        .optional()
        .describe('Optional single-character CSV delimiter override.'),
      storeRawOnly: z
        .boolean()
        .optional()
        .describe('Store the raw CSV + manifest without creating workout events.'),
    }),
    output: workoutImportCsvResultSchema,
    async run({ args, options }) {
      return importWorkoutCsv({
        vault: options.vault,
        file: args.file,
        source: typeof options.source === 'string' ? options.source : undefined,
        delimiter: typeof options.delimiter === 'string' ? options.delimiter : undefined,
        storeRawOnly: options.storeRawOnly === true,
      })
    },
  })

  interface WorkoutFormatExerciseDraft {
    groupId?: string
    mode?: string
    name: string
    note?: string
    order: number
    plannedSets: Array<Record<string, unknown>>
    unitOverride?: string
  }

  interface WorkoutFormatTypedOptions {
    workoutFormatId?: string
    slug?: string
    status?: 'active' | 'archived'
    summary?: string
    tag?: string[]
    note?: string
    templateText?: string
    routineNote?: string
    exercise?: string[]
    setTemplate?: string[]
    duration?: number
    type?: string
    distanceKm?: number
  }

  const workoutFormatPayloadOptionKeys = [
    'workoutFormatId',
    'slug',
    'status',
    'summary',
    'tag',
    'note',
    'templateText',
    'routineNote',
    'exercise',
    'setTemplate',
  ] as const satisfies ReadonlyArray<keyof WorkoutFormatTypedOptions>

  const workoutFormatExerciseFields = new Set([
    'order',
    'name',
    'groupId',
    'mode',
    'unitOverride',
    'note',
  ])

  const workoutFormatSetTemplateFields = new Set([
    'exercise',
    'order',
    'type',
    'targetReps',
    'reps',
    'targetWeight',
    'weight',
    'targetWeightUnit',
    'weightUnit',
    'targetDurationSeconds',
    'durationSeconds',
    'targetDistanceMeters',
    'distanceMeters',
    'targetRpe',
    'rpe',
  ])

  function invalidWorkoutFormatOption(message: string): never {
    throw new VaultCliError('invalid_option', message)
  }

  function rejectUnknownWorkoutFormatFields(
    fields: ReadonlyMap<string, string>,
    supportedFields: ReadonlySet<string>,
    optionName: string,
  ) {
    try {
      rejectUnknownCompactWorkoutFields(fields, supportedFields, optionName)
    } catch (error) {
      if (error instanceof VaultCliError) {
        invalidWorkoutFormatOption(error.message)
      }
      throw error
    }
  }

  function parseWorkoutFormatExerciseEntry(entry: string): WorkoutFormatExerciseDraft {
    const fields = parseCompactWorkoutFields(entry, 'exercise')
    rejectUnknownWorkoutFormatFields(fields, workoutFormatExerciseFields, 'exercise')
    return {
      name: requireCompactWorkoutString(fields, 'name', 'exercise'),
      order: requireCompactWorkoutInteger(fields, 'order', 'exercise'),
      plannedSets: [],
      ...(fields.has('groupId') ? { groupId: fields.get('groupId') } : {}),
      ...(fields.has('mode') ? { mode: fields.get('mode') } : {}),
      ...(fields.has('unitOverride') ? { unitOverride: fields.get('unitOverride') } : {}),
      ...(fields.has('note') ? { note: fields.get('note') } : {}),
    }
  }

  function readWorkoutFormatSetNumber(
    fields: ReadonlyMap<string, string>,
    primaryKey: string,
    fallbackKey: string,
    optionName: string,
  ): number | undefined {
    return compactWorkoutNumber(fields, primaryKey, optionName)
      ?? compactWorkoutNumber(fields, fallbackKey, optionName)
  }

  function parseWorkoutFormatSetTemplateEntry(entry: string): {
    exerciseOrder: number
    set: Record<string, unknown>
  } {
    const fields = parseCompactWorkoutFields(entry, 'set-template')
    rejectUnknownWorkoutFormatFields(
      fields,
      workoutFormatSetTemplateFields,
      'set-template',
    )
    const exerciseOrder = requireCompactWorkoutInteger(fields, 'exercise', 'set-template')
    const set: Record<string, unknown> = {
      order: requireCompactWorkoutInteger(fields, 'order', 'set-template'),
    }

    if (fields.has('type')) set.type = fields.get('type')
    if (fields.has('targetWeightUnit')) {
      set.targetWeightUnit = fields.get('targetWeightUnit')
    } else if (fields.has('weightUnit')) {
      set.targetWeightUnit = fields.get('weightUnit')
    }

    const targetReps = readWorkoutFormatSetNumber(fields, 'targetReps', 'reps', 'set-template')
    if (targetReps !== undefined) {
      if (!Number.isInteger(targetReps)) {
        invalidWorkoutFormatOption('--set-template field targetReps must be an integer.')
      }
      set.targetReps = targetReps
    }

    const targetDurationSeconds = readWorkoutFormatSetNumber(
      fields,
      'targetDurationSeconds',
      'durationSeconds',
      'set-template',
    )
    if (targetDurationSeconds !== undefined) {
      if (!Number.isInteger(targetDurationSeconds)) {
        invalidWorkoutFormatOption('--set-template field targetDurationSeconds must be an integer.')
      }
      set.targetDurationSeconds = targetDurationSeconds
    }

    for (const [outputKey, primaryKey, fallbackKey] of [
      ['targetWeight', 'targetWeight', 'weight'],
      ['targetDistanceMeters', 'targetDistanceMeters', 'distanceMeters'],
      ['targetRpe', 'targetRpe', 'rpe'],
    ] as const) {
      const value = readWorkoutFormatSetNumber(fields, primaryKey, fallbackKey, 'set-template')
      if (value !== undefined) {
        set[outputKey] = value
      }
    }

    return {
      exerciseOrder,
      set,
    }
  }

  function hasWorkoutFormatTypedPayloadOptions(input: {
    options: WorkoutFormatTypedOptions
    text?: string
  }): boolean {
    const { options } = input
    if (workoutFormatPayloadOptionKeys.some((key) => options[key] !== undefined)) {
      return true
    }

    return input.text === undefined
      && (options.duration !== undefined
        || options.type !== undefined
        || options.distanceKm !== undefined)
  }

  function formatWorkoutFormatSchemaIssues(
    issues: readonly { path: PropertyKey[]; message: string }[],
  ): string {
    return issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'value'
        return `${path}: ${issue.message}`
      })
      .join('; ')
  }

  function buildWorkoutFormatPayloadFromOptions(input: {
    name?: string
    text?: string
    options: WorkoutFormatTypedOptions
  }): WorkoutFormatUpsertPayload | undefined {
    if (!hasWorkoutFormatTypedPayloadOptions({
      options: input.options,
      text: input.text,
    })) {
      return undefined
    }

    if (!input.name) {
      invalidWorkoutFormatOption(
        'Workout format name is required when typed workout-format fields are provided.',
      )
    }

    if (input.text !== undefined && input.options.templateText !== undefined) {
      invalidWorkoutFormatOption(
        'Pass either positional workout text or --template-text, not both.',
      )
    }

    const exercisesByOrder = new Map<number, WorkoutFormatExerciseDraft>()
    const exerciseEntries = normalizeRepeatableFlagOption(input.options.exercise, 'exercise')
    for (const exercise of exerciseEntries?.map(parseWorkoutFormatExerciseEntry) ?? []) {
      if (exercisesByOrder.has(exercise.order)) {
        invalidWorkoutFormatOption(`Duplicate --exercise order ${exercise.order}.`)
      }
      exercisesByOrder.set(exercise.order, exercise)
    }

    const setTemplateEntries = normalizeRepeatableFlagOption(
      input.options.setTemplate,
      'set-template',
    )
    for (const { exerciseOrder, set } of setTemplateEntries?.map(parseWorkoutFormatSetTemplateEntry) ?? []) {
      const exercise = exercisesByOrder.get(exerciseOrder)
      if (!exercise) {
        invalidWorkoutFormatOption(
          `--set-template references exercise ${exerciseOrder}, but no matching --exercise was provided.`,
        )
      }
      exercise.plannedSets.push(set)
    }

    const tags = normalizeRepeatableFlagOption(input.options.tag, 'tag')
    const candidate = {
      ...(input.options.workoutFormatId ? { workoutFormatId: input.options.workoutFormatId } : {}),
      ...(input.options.slug ? { slug: input.options.slug } : {}),
      title: input.name,
      status: input.options.status ?? 'active',
      ...(input.options.summary ? { summary: input.options.summary } : {}),
      activityType: input.options.type ?? 'strength-training',
      ...(typeof input.options.duration === 'number'
        ? { durationMinutes: input.options.duration }
        : {}),
      ...(typeof input.options.distanceKm === 'number'
        ? { distanceKm: input.options.distanceKm }
        : {}),
      template: {
        ...(input.options.routineNote ? { routineNote: input.options.routineNote } : {}),
        exercises: [...exercisesByOrder.values()].sort(
          (left, right) => left.order - right.order,
        ),
      },
      ...(tags ? { tags } : {}),
      ...(input.options.note ? { note: input.options.note } : {}),
      ...(input.options.templateText ?? input.text
        ? { templateText: input.options.templateText ?? input.text }
        : {}),
    }

    const parsed = workoutFormatUpsertPayloadSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new VaultCliError(
        'invalid_option',
        `Workout format typed fields are invalid. ${formatWorkoutFormatSchemaIssues(parsed.error.issues)}`,
      )
    }

    return parsed.data
  }

  const format = Cli.create('format', {
    description:
      'Saved workout-format defaults that store structured routine templates in bank/workout-formats.',
  })

  format.command('save', {
    description:
      'Save or update one reusable workout format from typed routine-template fields or freeform text.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Saved workout format name such as "Push Day A".'),
      text: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Saved workout text.'),
    }),
    examples: [
      {
        description: 'Save one reusable strength workout format from freeform text.',
        args: {
          name: 'Push Day A',
          text: '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
        },
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Saved workout formats support typed routine exercises, planned sets, grouping, and persistent notes. Use workout format import-json --input @routine.json for the structured JSON escape hatch.',
    options: withBaseOptions({
      workoutFormatId: z
        .string()
        .regex(/^wfmt_[0-9A-Za-z]+$/u)
        .optional()
        .describe('Optional stable workout-format id such as wfmt_<ULID>.'),
      slug: z
        .string()
        .regex(workoutSlugPattern)
        .optional()
        .describe('Optional saved workout-format slug. Defaults from the name.'),
      status: z
        .enum(['active', 'archived'])
        .optional()
        .describe('Saved workout-format status.'),
      summary: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional short description for the saved workout format.'),
      tag: z
        .array(z.string().regex(workoutSlugPattern))
        .optional()
        .describe('Optional workout-format tag slug. Repeat --tag for multiple tags.'),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional persistent note about the saved workout format.'),
      templateText: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional saved workout text stored with the routine template.'),
      routineNote: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional routine note copied into logged sessions from this format.'),
      exercise: z
        .array(z.string().min(1))
        .optional()
        .describe('Routine exercise as order=...;name=... with optional groupId/mode/unitOverride/note. Repeat --exercise for multiple exercises.'),
      setTemplate: z
        .array(z.string().min(1))
        .optional()
        .describe('Planned set as exercise=...;order=... plus optional type/targetReps/targetWeight/targetWeightUnit/targetDurationSeconds/targetDistanceMeters/targetRpe. Repeat --set-template for multiple sets.'),
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional default duration override in minutes when the saved note is missing or ambiguous.',
        ),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional default workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional default workout distance override in kilometers.'),
    }),
    output: workoutFormatSaveResultSchema,
    async run({ args, options }) {
      const name = typeof args.name === 'string' ? args.name : undefined
      const text = typeof args.text === 'string' ? args.text : undefined
      const payload = buildWorkoutFormatPayloadFromOptions({
        name,
        text,
        options,
      })

      if (!name) {
        throw new VaultCliError(
          'contract_invalid',
          'Workout format name is required.',
        )
      }

      if (!text && !payload) {
        throw new VaultCliError(
          'contract_invalid',
          'Workout format text is required unless typed routine template fields are provided.',
        )
      }

      return saveWorkoutFormat({
        vault: options.vault,
        name,
        text,
        payload,
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
      })
    },
  })

  format.command('import-json', {
    description:
      'Import one reusable workout format from a structured JSON payload file or stdin.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional saved workout format name override such as "Push Day A".'),
      text: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional saved workout text override.'),
    }),
    examples: [
      {
        description: 'Import a structured routine template from disk.',
        args: {},
        options: {
          input: '@routine.json',
          vault: './vault',
        },
      },
    ],
    hint:
      '--input accepts @file.json or - for stdin. The payload retains the full workout-format template surface, including routine exercises, planned sets, grouping, tags, and persistent notes.',
    options: withBaseOptions({
      input: inputFileOptionSchema.describe('Structured workout format payload in @file.json form or - for stdin.'),
    }),
    output: workoutFormatSaveResultSchema,
    async run({ args, options }) {
      const name = typeof args.name === 'string' ? args.name : undefined
      const text = typeof args.text === 'string' ? args.text : undefined
      return saveWorkoutFormat({
        vault: options.vault,
        name,
        text,
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  format.command('show', {
    description: 'Show one saved workout format by name, slug, or id.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .describe('Saved workout format name, slug, or id.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showWorkoutFormat(options.vault, args.name)
    },
  })

  format.command('list', {
    description: 'List saved workout formats.',
    args: z.object({}),
    options: withBaseOptions({
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: workoutFormatListResultSchema,
    async run({ options }) {
      return listWorkoutFormats({
        vault: options.vault,
        limit: options.limit,
      })
    },
  })

  format.command('log', {
    description:
      'Log one dated workout from a saved workout format through the canonical activity_session write path.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .describe('Saved workout format name, slug, or id.'),
    }),
    examples: [
      {
        description: 'Log one saved workout format for today.',
        args: {
          name: 'Push Day A',
        },
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Structured routine templates log directly into the rich workout session payload. Older thin formats still fall back to their saved freeform text.',
    options: withBaseOptions({
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe('Optional duration override in minutes.'),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional workout distance override in kilometers.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe(
          'Optional event source (`manual`, `import`, `device`, or `derived`).',
        ),
      media: z
        .array(pathSchema)
        .optional()
        .describe('Optional workout photo or video file paths to copy into raw/workouts/** and attach to the workout event.'),
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      return logWorkoutFormat({
        vault: options.vault,
        name: args.name,
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string'
              ? options.occurredAt
              : undefined,
        }),
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      })
    },
  })

  workout.command(units)
  workout.command(importGroup)
  workout.command(format)
  cli.command(workout)
}
