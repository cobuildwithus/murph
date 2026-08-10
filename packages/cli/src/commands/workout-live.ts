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
  showActiveLiveWorkout,
  startLiveWorkout,
} from '@murphai/vault-usecases/workouts'

const workoutIdOption = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u)
  .optional()
  .describe(
    'Optional canonical workout id. Omit it only when exactly one live workout is active.',
  )

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
  .describe('Optional one-based exercise order within the live workout.')

const requiredExerciseOrderOption = z
  .number()
  .int()
  .positive()
  .describe('One-based exercise order within the live workout.')

const requiredSetOrderOption = z
  .number()
  .int()
  .positive()
  .describe(
    'One-based set order. Read the active workout and pass it explicitly.',
  )

export function registerWorkoutLiveCommands(workout: Cli.Cli): void {
  workout.command('start', {
    description:
      'Start one canonical live workout, optionally from a saved workout format.',
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
        description: 'Start an empty strength session.',
        args: {
          name: "'Hotel gym'",
        },
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Only one Murph live workout may be active in a vault. Saved target values remain in the routine; the new session starts with unlogged set placeholders.',
    options: withBaseOptions({
      routine: z
        .string()
        .min(1)
        .optional()
        .describe('Optional saved workout-format id, slug, or exact title.'),
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
      })
    },
  })

  workout.command('active', {
    description: 'Show the active canonical live workout.',
    args: z.object({}),
    options: withBaseOptions({
      workoutId: workoutIdOption,
    }),
    output: showResultSchema,
    async run({ options }) {
      return showActiveLiveWorkout({
        vault: options.vault,
        workoutId: options.workoutId,
      })
    },
  })

  workout.command('finish', {
    description:
      'Finish one live workout and persist its final duration without inventing missing set values.',
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
    description: 'Targeted exercise mutations for the active live workout.',
  })

  exercise.command('add', {
    description:
      'Add one exercise with empty set placeholders to the active live workout.',
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
      note: z.string().min(1).max(4000).optional(),
      sets: z
        .number()
        .int()
        .positive()
        .max(150)
        .default(1)
        .describe('Number of unlogged set placeholders to create. Defaults to 1.'),
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

  const set = Cli.create('set', {
    description: 'Targeted set mutations for the active live workout.',
  })

  set.command('log', {
    description:
      'Log or correct one set while preserving every other exercise and set.',
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
        description: 'Log bench set 2 with an explicit stable target.',
        args: {
          exercise: "'Bench press'",
        },
        options: {
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
      'Clear the logged values from one set while preserving its planned position.',
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
