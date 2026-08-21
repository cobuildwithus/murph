import path from 'node:path'
import { Cli, z } from 'incur'
import {
  eventSourceSchema,
  type WorkoutFormatUpsertPayload,
  type WorkoutSession,
  workoutFormatUpsertPayloadSchema,
  workoutImportPayloadSchema,
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
  deleteResultSchema,
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
  appendTypedClear,
  appendTypedSet,
  createDirectEventBackedEntityEditCommandDefinition,
  emptyToUndefined,
  numberOption,
  stringArrayOption,
  stringOption,
} from './record-mutation-command-helpers.js'
import {
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
  createCommonListCommand,
  createPayloadSchemaCommand,
  registerFactoryCommand,
} from './command-factory-primitives.js'
import {
  compactNumber,
  parseCompactFields,
  rejectUnsupportedCompactFields,
  requireCompactInteger,
  requireCompactString,
} from './compact-field-spec.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'
import { registerWorkoutLiveCommands } from './workout-live.js'

const workoutSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const workoutListLimitOptionSchema = z
  .number()
  .int()
  .positive()
  .max(200)
  .default(5)
  .describe('Maximum number of results to return. Defaults to 5.')

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
  'note',
  'reps',
  'weight',
  'durationSeconds',
  'distanceMeters',
  'rpe',
  'bodyweightKg',
  'assistanceKg',
  'addedWeightKg',
])

const workoutAddMediaFieldList = [...workoutAddMediaFields].join(', ')
const workoutAddExerciseFieldList = [...workoutAddExerciseFields].join(', ')
const workoutAddSetFieldList = [...workoutAddSetFields].join(', ')

const workoutImportPayloadExample = {
  title: 'Incline bench and pull-ups',
  note: 'Hey I worked out today 4 sets of 15 incline bench with 25s on each side and 4 sets of 10 pull-ups.',
  activityType: 'strength-training',
  durationMinutes: 20,
  strengthExercises: [
    {
      exercise: 'Incline bench press',
      setCount: 4,
      repsPerSet: 15,
      loadDescription: '25s on each side',
    },
    {
      exercise: 'Pull-up',
      setCount: 4,
      repsPerSet: 10,
    },
  ],
} satisfies Record<string, unknown>

function invalidWorkoutAddOption(message: string): never {
  throw new VaultCliError('invalid_option', message)
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
  const fields = parseCompactFields(entry, 'workout-media', invalidWorkoutAddOption)
  rejectUnsupportedCompactFields(
    fields,
    'workout-media',
    workoutAddMediaFields,
    invalidWorkoutAddOption,
  )
  return {
    kind: requireCompactString(fields, 'kind', 'workout-media', invalidWorkoutAddOption),
    relativePath: normalizeWorkoutMediaRelativePath(
      requireCompactString(
        fields,
        'relativePath',
        'workout-media',
        invalidWorkoutAddOption,
      ),
    ),
    ...(fields.has('mediaType') ? { mediaType: fields.get('mediaType') } : {}),
    ...(fields.has('caption') ? { caption: fields.get('caption') } : {}),
  }
}

function parseWorkoutAddExerciseEntry(entry: string): WorkoutAddExerciseDraft {
  const fields = parseCompactFields(entry, 'workout-exercise', invalidWorkoutAddOption)
  rejectUnsupportedCompactFields(
    fields,
    'workout-exercise',
    workoutAddExerciseFields,
    invalidWorkoutAddOption,
  )
  return {
    name: requireCompactString(fields, 'name', 'workout-exercise', invalidWorkoutAddOption),
    order: requireCompactInteger(
      fields,
      'order',
      'workout-exercise',
      invalidWorkoutAddOption,
    ),
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
  const fields = parseCompactFields(entry, 'workout-set', invalidWorkoutAddOption)
  rejectUnsupportedCompactFields(
    fields,
    'workout-set',
    workoutAddSetFields,
    invalidWorkoutAddOption,
  )
  const exerciseOrder = requireCompactInteger(
    fields,
    'exercise',
    'workout-set',
    invalidWorkoutAddOption,
  )
  const set: Record<string, unknown> = {
    order: requireCompactInteger(fields, 'order', 'workout-set', invalidWorkoutAddOption),
  }

  for (const key of ['type', 'weightUnit', 'note']) {
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
    const value = compactNumber(fields, key, 'workout-set', invalidWorkoutAddOption)
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

function hasWorkoutExerciseReplacementOptions(options: Pick<WorkoutAddTypedOptions, 'workoutExercise' | 'workoutSet'>): boolean {
  return options.workoutExercise !== undefined || options.workoutSet !== undefined
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

  registerWorkoutLiveCommands(workout)

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
          text: "'Went for a 30-minute run around the neighborhood.'",
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Capture workout media plus one structured exercise and set.',
        args: {},
        options: {
          vault: './vault',
          note: "'Upper body session.'",
          type: 'strength-training',
          duration: 45,
          workoutMedia: ["'kind=photo;relativePath=raw/workouts/2026/03/upper/bench.jpg;mediaType=image/jpeg;caption=Bench setup'"],
          workoutExercise: [
            "'order=1;name=Bench press;mode=weight_reps;unitOverride=lb'",
          ],
          workoutSet: [
            "'exercise=1;order=1;type=normal;reps=5;weight=185;weightUnit=lb'",
          ],
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
        .describe(`Compact workoutMedia grammar: kind=...;relativePath=... with optional mediaType/caption. Shell-quote each semicolon-separated value. Supported keys: ${workoutAddMediaFieldList}. Repeat --workout-media for multiple entries. Use --media for local file staging.`),
      workoutExercise: z
        .array(z.string().min(1))
        .optional()
        .describe(`Compact workoutExercise grammar: order=...;name=... with optional sourceExerciseId/groupId/mode/unitOverride/note. Shell-quote each semicolon-separated value. Supported keys: ${workoutAddExerciseFieldList}. Repeat --workout-exercise for multiple exercises.`),
      workoutSet: z
        .array(z.string().min(1))
        .optional()
        .describe(`Compact workoutSet grammar: exercise=...;order=... plus optional set fields. Shell-quote each semicolon-separated value. Supported keys: ${workoutAddSetFieldList}. Repeat --workout-set for multiple sets.`),
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
      'Generate the file body from workout payload-schema. --input accepts @file.json or - for stdin and retains the full structured workout import surface, including source fields, media/raw refs, exercises, and sets.',
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

  registerFactoryCommand(
    workout,
    createPayloadSchemaCommand({
      command: 'workout import-json',
      description: 'Emit the JSON payload schema for workout import-json file bodies.',
      examples: [
        {
          description: 'Show the compact workout import payload contract.',
          args: {},
          options: {},
        },
      ],
      hint:
        'Use strengthExercises for compact repeated strength sets. Pipe a matching JSON object into workout import-json --input -.',
      mediaType: 'application/json',
      schema: workoutImportPayloadSchema,
      schemaName: 'workout-import-payload',
      payloadExamples: [workoutImportPayloadExample],
    }),
  )

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
        limit: workoutListLimitOptionSchema,
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
      'Edit one workout session from typed fields.',
    examples: [
      {
        description: 'Replace workout media plus one structured exercise and set.',
        args: {
          id: 'evt_01JQY2Z0R9Z5K6BT4CB4D9F4CA',
        },
        options: {
          vault: './vault',
          workoutMedia: ["'kind=photo;relativePath=raw/workouts/2026/03/upper/bench.jpg;mediaType=image/jpeg;caption=Bench setup'"],
          workoutExercise: [
            "'order=1;name=Bench press;mode=weight_reps;unitOverride=lb'",
          ],
          workoutSet: [
            "'exercise=1;order=1;type=normal;reps=5;weight=185;weightUnit=lb'",
          ],
        },
      },
    ],
    options: {
      duration: z.number().int().positive().max(24 * 60).optional().describe('Replace duration in minutes.'),
      type: z.string().min(1).max(120).optional().describe('Replace workout activity type.'),
      distanceKm: z.number().positive().max(1_000).optional().describe('Replace workout distance in kilometers.'),
      workoutSourceApp: z.string().regex(workoutSlugPattern).optional().describe('Replace nested workout-session source app slug.'),
      workoutSourceWorkoutId: z.string().min(1).max(200).optional().describe('Replace nested source workout id.'),
      workoutStartedAt: isoTimestampSchema.optional().describe('Replace nested workout started-at timestamp.'),
      workoutEndedAt: isoTimestampSchema.optional().describe('Replace nested workout ended-at timestamp.'),
      workoutRoutineId: z.string().min(1).max(200).optional().describe('Replace nested workout routine id.'),
      workoutRoutineName: z.string().min(1).max(160).optional().describe('Replace nested workout routine name.'),
      workoutSessionNote: z.string().min(1).max(4000).optional().describe('Replace nested workout session note.'),
      workoutMedia: z.array(z.string().min(1)).optional().describe(`Replace stored media with the compact workoutMedia grammar: kind=...;relativePath=... plus optional mediaType/caption. Shell-quote each semicolon-separated value. Supported keys: ${workoutAddMediaFieldList}. Repeat --workout-media for multiple entries.`),
      workoutExercise: z.array(z.string().min(1)).optional().describe(`Replace exercises with the compact workoutExercise grammar: order=...;name=... plus optional sourceExerciseId/groupId/mode/unitOverride/note. Shell-quote each semicolon-separated value. Supported keys: ${workoutAddExerciseFieldList}. Repeat --workout-exercise for multiple exercises.`),
      workoutSet: z.array(z.string().min(1)).optional().describe(`Attach replacement sets with the compact workoutSet grammar: exercise=...;order=... plus optional set fields. Shell-quote each semicolon-separated value. Supported keys: ${workoutAddSetFieldList}. Repeat --workout-set for multiple sets.`),
      clearDuration: z.boolean().optional().describe('Clear saved duration.'),
      clearDistance: z.boolean().optional().describe('Clear saved distance.'),
      clearWorkout: z.boolean().optional().describe('Clear the nested workout session payload.'),
    },
    buildPatch(options) {
      const set: string[] = []
      const clear: string[] = []
      appendTypedSet(set, 'durationMinutes', numberOption(options.duration))
      appendTypedSet(set, 'activityType', stringOption(options.type))
      appendTypedSet(set, 'distanceKm', numberOption(options.distanceKm))
      appendTypedSet(set, 'workout.sourceApp', stringOption(options.workoutSourceApp))
      appendTypedSet(set, 'workout.sourceWorkoutId', stringOption(options.workoutSourceWorkoutId))
      appendTypedSet(set, 'workout.startedAt', stringOption(options.workoutStartedAt))
      appendTypedSet(set, 'workout.endedAt', stringOption(options.workoutEndedAt))
      appendTypedSet(set, 'workout.routineId', stringOption(options.workoutRoutineId))
      appendTypedSet(set, 'workout.routineName', stringOption(options.workoutRoutineName))
      appendTypedSet(set, 'workout.sessionNote', stringOption(options.workoutSessionNote))
      const workoutDraft = buildWorkoutFromTypedOptions({
        workoutMedia: stringArrayOption(options.workoutMedia),
        workoutExercise: stringArrayOption(options.workoutExercise),
        workoutSet: stringArrayOption(options.workoutSet),
      })
      if (workoutDraft?.media !== undefined) appendTypedSet(set, 'workout.media', workoutDraft.media)
      if (workoutDraft?.exercises !== undefined && hasWorkoutExerciseReplacementOptions({
        workoutExercise: stringArrayOption(options.workoutExercise),
        workoutSet: stringArrayOption(options.workoutSet),
      })) {
        appendTypedSet(set, 'workout.exercises', workoutDraft.exercises)
      }
      appendTypedClear(clear, 'durationMinutes', options.clearDuration === true)
      appendTypedClear(clear, 'distanceKm', options.clearDistance === true)
      appendTypedClear(clear, 'workout', options.clearWorkout === true)
      return {
        set: emptyToUndefined(set),
        clear: emptyToUndefined(clear),
      }
    },
    run(input) {
      return editWorkoutRecord({
        vault: input.vault,
        lookup: input.lookup,
        set: input.set,
        clear: input.clear,
        dayKeyPolicy: input.dayKeyPolicy,
      })
    },
  }))

  workout.command('delete', {
    description:
      'Delete one exact workout only when its canonical lifecycle revision is unchanged.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    examples: [
      {
        description: 'Delete the exact workout revision approved by the member.',
        args: {
          id: 'evt_01JABC123',
        },
        options: {
          expectedRevision: 3,
          vault: './vault',
        },
      },
    ],
    hint:
      'Read the exact workout first and pass its lifecycle.revision. A conflict leaves the workout unchanged.',
    options: withBaseOptions({
      expectedRevision: z
        .number()
        .int()
        .positive()
        .describe('Exact lifecycle revision observed when deletion was approved.'),
    }),
    output: deleteResultSchema,
    async run({ args, options }) {
      return deleteWorkoutRecord({
        vault: options.vault,
        lookup: args.id,
        expectedRevision: options.expectedRevision,
      })
    },
  })

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
      'Inspect and bulk-import Strong/Hevy-style workout CSV exports without sending individual sets through the model.',
  })

  importGroup.command('inspect', {
    description: 'Inspect one workout CSV file without writing anything.',
    args: z.object({
      file: pathSchema.describe('Path to the workout CSV export to inspect.'),
    }),
    options: withBaseOptions({
      source: z
        .enum(['strong', 'hevy'])
        .optional()
        .describe('Strong or Hevy dialect; required when the headers are shared by both apps.'),
      delimiter: z
        .string()
        .min(1)
        .max(1)
        .optional()
        .describe('Optional single-character CSV delimiter override.'),
      weightUnit: z
        .enum(['lb', 'kg'])
        .optional()
        .describe('Required when positive CSV weights do not include unit metadata.'),
      distanceUnit: z
        .enum(['m', 'km', 'mi'])
        .optional()
        .describe('Required when positive CSV distances do not include unit metadata.'),
    }),
    output: workoutImportInspectResultSchema,
    async run({ args, options }) {
      return inspectWorkoutCsvImport({
        vault: options.vault,
        file: args.file,
        source: typeof options.source === 'string' ? options.source : undefined,
        delimiter: typeof options.delimiter === 'string' ? options.delimiter : undefined,
        weightUnit: options.weightUnit,
        distanceUnit: options.distanceUnit,
      })
    },
  })

  importGroup.command('csv', {
    description: 'Validate one complete workout CSV, preserve raw evidence, and commit all mapped sessions through one canonical batch.',
    args: z.object({
      file: pathSchema.describe('Path to the workout CSV export to import.'),
    }),
    options: withBaseOptions({
      source: z
        .enum(['strong', 'hevy'])
        .optional()
        .describe('Strong or Hevy dialect; required when the headers are shared by both apps.'),
      delimiter: z
        .string()
        .min(1)
        .max(1)
        .optional()
        .describe('Optional single-character CSV delimiter override.'),
      weightUnit: z
        .enum(['lb', 'kg'])
        .optional()
        .describe('Required when positive CSV weights do not include unit metadata.'),
      distanceUnit: z
        .enum(['m', 'km', 'mi'])
        .optional()
        .describe('Required when positive CSV distances do not include unit metadata.'),
      storeRawOnly: z
        .boolean()
        .optional()
        .describe('Store the raw CSV + manifest without creating workout events.'),
      correctUnits: z
        .boolean()
        .optional()
        .describe('Explicitly supersede an exact prior import after correcting its unit choice.'),
    }),
    output: workoutImportCsvResultSchema,
    async run({ args, options }) {
      return importWorkoutCsv({
        vault: options.vault,
        file: args.file,
        source: typeof options.source === 'string' ? options.source : undefined,
        delimiter: typeof options.delimiter === 'string' ? options.delimiter : undefined,
        weightUnit: options.weightUnit,
        distanceUnit: options.distanceUnit,
        storeRawOnly: options.storeRawOnly === true,
        correctUnits: options.correctUnits === true,
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
    sourceExerciseId?: string
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
    'sourceExerciseId',
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

  const workoutFormatExerciseFieldList = [...workoutFormatExerciseFields].join(', ')
  const workoutFormatSetTemplateFieldList = [...workoutFormatSetTemplateFields].join(', ')

  function invalidWorkoutFormatOption(message: string): never {
    throw new VaultCliError('invalid_option', message)
  }

  function parseWorkoutFormatExerciseEntry(entry: string): WorkoutFormatExerciseDraft {
    const fields = parseCompactFields(entry, 'exercise', invalidWorkoutFormatOption)
    rejectUnsupportedCompactFields(
      fields,
      'exercise',
      workoutFormatExerciseFields,
      invalidWorkoutFormatOption,
    )
    return {
      name: requireCompactString(fields, 'name', 'exercise', invalidWorkoutFormatOption),
      order: requireCompactInteger(fields, 'order', 'exercise', invalidWorkoutFormatOption),
      plannedSets: [],
      ...(fields.has('sourceExerciseId') ? { sourceExerciseId: fields.get('sourceExerciseId') } : {}),
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
    return compactNumber(fields, primaryKey, optionName, invalidWorkoutFormatOption)
      ?? compactNumber(fields, fallbackKey, optionName, invalidWorkoutFormatOption)
  }

  function parseWorkoutFormatSetTemplateEntry(entry: string): {
    exerciseOrder: number
    set: Record<string, unknown>
  } {
    const fields = parseCompactFields(entry, 'set-template', invalidWorkoutFormatOption)
    rejectUnsupportedCompactFields(
      fields,
      'set-template',
      workoutFormatSetTemplateFields,
      invalidWorkoutFormatOption,
    )
    const exerciseOrder = requireCompactInteger(
      fields,
      'exercise',
      'set-template',
      invalidWorkoutFormatOption,
    )
    const set: Record<string, unknown> = {
      order: requireCompactInteger(fields, 'order', 'set-template', invalidWorkoutFormatOption),
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
          name: "'Push Day A'",
          text: "'20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.'",
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Save a typed routine template with planned sets.',
        args: {
          name: "'Upper Body A'",
        },
        options: {
          vault: './vault',
          type: 'strength-training',
          duration: 45,
          exercise: [
            "'order=1;name=Bench press;mode=weight_reps;unitOverride=lb'",
          ],
          setTemplate: [
            "'exercise=1;order=1;type=normal;targetReps=5;targetWeight=185;targetWeightUnit=lb;targetRpe=8'",
          ],
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
        .describe(`Compact exercise grammar: order=...;name=... with optional sourceExerciseId/groupId/mode/unitOverride/note. Shell-quote each semicolon-separated value. Supported keys: ${workoutFormatExerciseFieldList}. Repeat --exercise for multiple exercises.`),
      setTemplate: z
        .array(z.string().min(1))
        .optional()
        .describe(`Compact setTemplate grammar: exercise=...;order=... plus optional planned set targets. Shell-quote each semicolon-separated value. Prefer targetReps, targetWeight, targetWeightUnit, targetDurationSeconds, targetDistanceMeters, and targetRpe. Supported keys: ${workoutFormatSetTemplateFieldList}. Repeat --set-template for multiple sets.`),
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
      limit: z.number().int().positive().max(200).default(10),
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
          name: "'Push Day A'",
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
