import { Cli, z } from 'incur'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  isoTimestampSchema,
  showResultSchema,
  workoutAddResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  addLiveWorkoutExercise,
  clearLiveWorkoutSet,
  finishLiveWorkout,
  logLiveWorkoutSet,
  setLiveWorkoutExerciseReps,
  startLiveWorkout,
  type StartLiveWorkoutExerciseInput,
} from '@murphai/vault-usecases/workouts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  compactInteger,
  parseCompactFields,
  rejectUnsupportedCompactFields,
  requireCompactString,
} from './compact-field-spec.js'

const workoutIdOption = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u)
  .describe('Canonical workout id returned by workout start or workout show.')

const exerciseModeSchema = z.enum([
  'weight_reps',
  'bodyweight',
  'assisted_bodyweight',
  'weighted_bodyweight',
  'duration',
  'cardio',
])

const initialExerciseFields = new Set([
  'name',
  'reps',
  'sets',
  'sourceExerciseId',
  'groupId',
  'mode',
  'unitOverride',
  'note',
])

function invalidInitialExercise(message: string): never {
  throw new VaultCliError('invalid_option', message)
}

function parseInitialExercise(
  entry: string,
): StartLiveWorkoutExerciseInput {
  const fields = parseCompactFields(
    entry,
    'exercise',
    invalidInitialExercise,
  )
  rejectUnsupportedCompactFields(
    fields,
    'exercise',
    initialExerciseFields,
    invalidInitialExercise,
  )
  const setCount = compactInteger(
    fields,
    'sets',
    'exercise',
    invalidInitialExercise,
  )
  const reps = compactInteger(
    fields,
    'reps',
    'exercise',
    invalidInitialExercise,
  )
  const mode = fields.get('mode')
  const parsedMode = mode === undefined
    ? undefined
    : exerciseModeSchema.safeParse(mode)
  if (parsedMode !== undefined && !parsedMode.success) {
    invalidInitialExercise('--exercise field mode is invalid.')
  }
  const unitOverride = fields.get('unitOverride')
  if (unitOverride !== undefined && unitOverride !== 'lb' && unitOverride !== 'kg') {
    invalidInitialExercise('--exercise field unitOverride must be lb or kg.')
  }
  const parsedUnitOverride = unitOverride === 'lb' || unitOverride === 'kg'
    ? unitOverride
    : undefined

  return {
    name: requireCompactString(
      fields,
      'name',
      'exercise',
      invalidInitialExercise,
    ),
    ...(reps === undefined ? {} : { reps }),
    ...(setCount === undefined ? {} : { setCount }),
    ...(fields.has('sourceExerciseId')
      ? { sourceExerciseId: fields.get('sourceExerciseId') }
      : {}),
    ...(fields.has('groupId') ? { groupId: fields.get('groupId') } : {}),
    ...(parsedMode?.success ? { mode: parsedMode.data } : {}),
    ...(parsedUnitOverride ? { unitOverride: parsedUnitOverride } : {}),
    ...(fields.has('note') ? { note: fields.get('note') } : {}),
  }
}

const exerciseIdOption = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe('Optional stable source exercise id, such as an exercise catalog id.')

const exerciseOrderOption = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Optional one-based exercise order within the exact workout.')

const requiredExerciseOrderOption = z
  .number()
  .int()
  .positive()
  .describe('One-based exercise order within the exact workout.')

const requiredSetOrderOption = z
  .number()
  .int()
  .positive()
  .describe('One-based set order from the exact workout record.')

export function registerWorkoutLiveCommands(workout: Cli.Cli): void {
  workout.command('start', {
    description:
      'Start one complete canonical live workout, optionally from a saved workout format.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe('Optional session title when starting without a saved routine.'),
    }),
    examples: [
      {
        description: 'Start a saved push routine.',
        args: {},
        options: {
          routine: 'push-day-a',
          vault: './vault',
        },
      },
      {
        description: 'Start an ad-hoc session with its ordered exercises.',
        args: {
          name: "'Hotel gym'",
        },
        options: {
          exercise: [
            "'name=Goblet squat;sets=3;reps=10;mode=weight_reps;unitOverride=lb'",
            "'name=Row, neutral grip;sets=3;reps=12;mode=weight_reps'",
          ],
          vault: './vault',
        },
      },
    ],
    hint:
      'Starting a workout never closes or blocks on another workout. Preserve the returned eventId and use it for every later mutation.',
    options: withBaseOptions({
      routine: z
        .string()
        .min(1)
        .optional()
        .describe('Optional saved workout-format id, slug, or exact title.'),
      exercise: z
        .array(z.string().min(1).max(1000))
        .max(100)
        .optional()
        .describe(
          'Initial exercise grammar: name=... with optional sets/reps/sourceExerciseId/groupId/mode/unitOverride/note. reps is one exact member-stated count for every set. Repeat --exercise; repeat order becomes canonical order. Commas are preserved.',
        ),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe('Optional activity type override. Defaults to strength-training.'),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional session note.'),
      startedAt: isoTimestampSchema
        .optional()
        .describe('Optional live-session start timestamp. Defaults to now.'),
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      return startLiveWorkout({
        vault: options.vault,
        name: args.name,
        routine: options.routine,
        activityType: options.type,
        note: options.note,
        startedAt: options.startedAt,
        exercises: options.exercise?.map(parseInitialExercise) ?? [],
      })
    },
  })

  workout.command('finish', {
    description:
      'Finish the exact live workout and persist its final duration without inventing missing set values.',
    args: z.object({}),
    options: withBaseOptions({
      workoutId: workoutIdOption,
      endedAt: isoTimestampSchema
        .optional()
        .describe('Optional finish timestamp. Defaults to now.'),
    }),
    output: showResultSchema,
    async run({ options }) {
      return finishLiveWorkout({
        vault: options.vault,
        workoutId: options.workoutId,
        endedAt: options.endedAt,
      })
    },
  })

  const exercise = Cli.create('exercise', {
    description: 'Exercise mutations scoped to an exact canonical workout.',
  })

  exercise.command('add', {
    description:
      'Add one exercise with empty set placeholders to the exact live workout.',
    args: z.object({
      name: z.string().min(1).max(160).describe('Exercise name.'),
    }),
    options: withBaseOptions({
      workoutId: workoutIdOption,
      sourceExerciseId: exerciseIdOption,
      order: requiredExerciseOrderOption,
      groupId: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('Optional superset or circuit group id.'),
      mode: exerciseModeSchema.optional(),
      unitOverride: z.enum(['lb', 'kg']).optional(),
      note: z.string().min(1).max(4000).optional(),
      sets: z
        .number()
        .int()
        .positive()
        .max(150)
        .optional()
        .describe(
          'Explicit finite planned set count. Omit it to create one targetless set.',
        ),
    }),
    output: showResultSchema,
    async run({ args, options }) {
      return addLiveWorkoutExercise({
        vault: options.vault,
        workoutId: options.workoutId,
        name: args.name,
        sourceExerciseId: options.sourceExerciseId,
        order: options.order,
        groupId: options.groupId,
        mode: options.mode,
        unitOverride: options.unitOverride,
        note: options.note,
        setCount: options.sets,
      })
    },
  })

  exercise.command('set-reps', {
    description:
      'Store or clear the exact member-stated repetition count that applies to every set of one exercise.',
    args: z.object({
      exercise: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional exact exercise name.'),
    }),
    options: withBaseOptions({
      workoutId: workoutIdOption,
      exerciseId: exerciseIdOption,
      exerciseOrder: exerciseOrderOption,
      reps: z
        .number()
        .int()
        .positive()
        .max(999)
        .optional()
        .describe('Exact member-stated repetitions for every set.'),
      clear: z
        .boolean()
        .optional()
        .describe('Clear the stored member repetition count.'),
    }),
    output: showResultSchema,
    async run({ args, options }) {
      return setLiveWorkoutExerciseReps({
        vault: options.vault,
        workoutId: options.workoutId,
        exerciseId: options.exerciseId,
        exerciseName: args.exercise,
        exerciseOrder: options.exerciseOrder,
        reps: options.reps,
        clear: options.clear,
      })
    },
  })

  const set = Cli.create('set', {
    description: 'Set mutations scoped to an exact canonical workout.',
  })

  set.command('log', {
    description:
      'Log or correct one exact set. Values may be omitted only when the exercise has a stored member repetition count.',
    args: z.object({
      exercise: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional exact exercise name.'),
    }),
    examples: [
      {
        description: 'Log bench set 2 on an exact workout.',
        args: {
          exercise: "'Bench press'",
        },
        options: {
          workoutId: 'evt_01JQ8PWXP5A68SQM1W0GYM41WA',
          setOrder: 2,
          reps: 8,
          weight: 185,
          weightUnit: 'lb',
          vault: './vault',
        },
      },
    ],
    options: withBaseOptions({
      workoutId: workoutIdOption,
      exerciseId: exerciseIdOption,
      exerciseOrder: exerciseOrderOption,
      setOrder: requiredSetOrderOption,
      requireExistingSet: z
        .boolean()
        .optional()
        .describe(
          'Fail instead of appending when the selected set no longer exists.',
        ),
      type: z.enum(['normal', 'warmup', 'dropset', 'failure']).optional(),
      note: z.string().min(1).max(400).optional(),
      reps: z.number().int().nonnegative().optional(),
      weight: z.number().nonnegative().optional(),
      weightUnit: z.enum(['lb', 'kg']).optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
      distanceMeters: z.number().nonnegative().optional(),
      rpe: z.number().min(0).max(10).optional(),
      bodyweightKg: z.number().nonnegative().optional(),
      assistanceKg: z.number().nonnegative().optional(),
      addedWeightKg: z.number().nonnegative().optional(),
    }),
    output: showResultSchema,
    async run({ args, options }) {
      return logLiveWorkoutSet({
        vault: options.vault,
        workoutId: options.workoutId,
        exerciseId: options.exerciseId,
        exerciseName: args.exercise,
        exerciseOrder: options.exerciseOrder,
        setOrder: options.setOrder,
        requireExistingSet: options.requireExistingSet,
        type: options.type,
        note: options.note,
        reps: options.reps,
        weight: options.weight,
        weightUnit: options.weightUnit,
        durationSeconds: options.durationSeconds,
        distanceMeters: options.distanceMeters,
        rpe: options.rpe,
        bodyweightKg: options.bodyweightKg,
        assistanceKg: options.assistanceKg,
        addedWeightKg: options.addedWeightKg,
      })
    },
  })

  set.command('clear', {
    description:
      'Clear one exact set while preserving its planned position and the workout end boundary.',
    args: z.object({
      exercise: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional exact exercise name.'),
    }),
    options: withBaseOptions({
      workoutId: workoutIdOption,
      exerciseId: exerciseIdOption,
      exerciseOrder: exerciseOrderOption,
      setOrder: z
        .number()
        .int()
        .positive()
        .describe('One-based set order to clear.'),
    }),
    output: showResultSchema,
    async run({ args, options }) {
      return clearLiveWorkoutSet({
        vault: options.vault,
        workoutId: options.workoutId,
        exerciseId: options.exerciseId,
        exerciseName: args.exercise,
        exerciseOrder: options.exerciseOrder,
        setOrder: options.setOrder,
      })
    },
  })

  workout.command(exercise)
  workout.command(set)
}
