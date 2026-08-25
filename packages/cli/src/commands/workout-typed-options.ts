import {
  workoutSessionSchema,
  type WorkoutSession,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { publicValidationIssue } from './public-validation-issue.js'

/** Assembles typed workout options and maps validation issues back to their owners. */
interface WorkoutScalarOptions {
  workoutEndedAt?: unknown
  workoutRoutineId?: unknown
  workoutRoutineName?: unknown
  workoutSessionNote?: unknown
  workoutSourceApp?: unknown
  workoutSourceWorkoutId?: unknown
  workoutStartedAt?: unknown
}

const workoutScalarOptionByField: Record<string, keyof WorkoutScalarOptions> = {
  endedAt: 'workoutEndedAt',
  routineId: 'workoutRoutineId',
  routineName: 'workoutRoutineName',
  sessionNote: 'workoutSessionNote',
  sourceApp: 'workoutSourceApp',
  sourceWorkoutId: 'workoutSourceWorkoutId',
  startedAt: 'workoutStartedAt',
}

export interface WorkoutOptionPublicFields {
  media: ReadonlySet<string>
  exercise: ReadonlySet<string>
  set: ReadonlySet<string>
}

interface ParsedWorkoutExercise {
  order: number
  sets: Array<Record<string, unknown>>
}

interface ParsedWorkoutSet {
  exerciseOrder: number
  set: Record<string, unknown>
}

interface ParsedWorkoutOptions {
  scalarOptions: WorkoutScalarOptions
  media: readonly Record<string, unknown>[] | undefined
  exercises: readonly ParsedWorkoutExercise[] | undefined
  sets: readonly ParsedWorkoutSet[] | undefined
  publicFields: WorkoutOptionPublicFields
  validationMessage: string
  invalidOption: (message: string) => never
}

export function buildWorkoutFromParsedOptions(
  input: ParsedWorkoutOptions,
): WorkoutSession {
  const exercisesByOrder = new Map<number, ParsedWorkoutExercise>()
  for (const exercise of input.exercises ?? []) {
    if (exercisesByOrder.has(exercise.order)) {
      input.invalidOption(`Duplicate --workout-exercise order ${exercise.order}.`)
    }
    exercisesByOrder.set(exercise.order, exercise)
  }

  for (const { exerciseOrder, set } of input.sets ?? []) {
    const exercise = exercisesByOrder.get(exerciseOrder)
    if (!exercise) {
      input.invalidOption(
        `--workout-set references exercise ${exerciseOrder}, but no matching --workout-exercise was provided.`,
      )
    }
    exercise.sets.push(set)
  }

  const exercises = [...exercisesByOrder.values()].sort((left, right) => left.order - right.order)
  const workout: Record<string, unknown> = {
    exercises,
    ...(input.media ? { media: input.media } : {}),
  }
  for (const [field, option] of Object.entries(workoutScalarOptionByField)) {
    const value = input.scalarOptions[option]
    if (value !== undefined) workout[field] = value
  }

  const parsed = workoutSessionSchema.safeParse(workout)
  if (!parsed.success) {
    throw new VaultCliError('invalid_option', input.validationMessage, {
      issues: parsed.error.issues.flatMap((issue) => {
        const publicPath = workoutOptionPublicPath(
          issue.path,
          input,
          exercises,
          input.publicFields,
        )
        return publicPath === undefined
          ? []
          : [publicValidationIssue(issue, publicPath)]
      }),
      stage: 'validation',
    })
  }

  return parsed.data
}

function repeatedOptionPublicPath(
  option: string,
  occurrence: number | undefined,
  field: PropertyKey | undefined,
  publicFields: ReadonlySet<string>,
): readonly (string | number)[] {
  if (occurrence === undefined || occurrence < 0) return [option]
  return typeof field === 'string' && publicFields.has(field)
    ? [option, occurrence, field]
    : [option, occurrence]
}

export function workoutOptionPublicPath(
  path: readonly PropertyKey[],
  sourceOptions: Pick<ParsedWorkoutOptions, 'media' | 'exercises' | 'sets'>,
  assembledExercises: readonly ParsedWorkoutExercise[],
  publicFields: WorkoutOptionPublicFields,
): readonly (string | number)[] | undefined {
  const [field, index, nestedField, nestedIndex, leafField] = path
  if (typeof field === 'string') {
    const scalarOption = workoutScalarOptionByField[field]
    if (scalarOption !== undefined) {
      return [scalarOption]
    }
  }
  if (field === 'media') {
    return repeatedOptionPublicPath(
      'workoutMedia',
      typeof index === 'number' && sourceOptions.media?.[index] !== undefined
        ? index
        : undefined,
      nestedField,
      publicFields.media,
    )
  }
  if (field === 'exercises' && nestedField === 'sets') {
    const exercise = typeof index === 'number' ? assembledExercises[index] : undefined
    const set = typeof nestedIndex === 'number'
      ? exercise?.sets[nestedIndex]
      : undefined
    return typeof nestedIndex === 'number'
      ? repeatedOptionPublicPath(
          'workoutSet',
          set === undefined
            ? undefined
            : sourceOptions.sets?.findIndex((candidate) => candidate.set === set),
          leafField,
          publicFields.set,
        )
      : ['workoutSet']
  }
  if (field === 'exercises') {
    return repeatedOptionPublicPath(
      'workoutExercise',
      typeof index === 'number' && assembledExercises[index] !== undefined
        ? sourceOptions.exercises?.indexOf(assembledExercises[index])
        : undefined,
      nestedField,
      publicFields.exercise,
    )
  }
  return undefined
}
