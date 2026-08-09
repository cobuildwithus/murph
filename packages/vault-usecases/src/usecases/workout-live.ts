import {
  normalizeStrictIsoTimestamp,
  type WorkoutExercise,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutTemplate,
  workoutSessionSchema,
  workoutTemplateSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { showWorkoutFormat } from './workout-format.js'
import {
  listWorkoutRecords,
  showWorkoutRecord,
} from './workout-read.js'
import {
  addWorkoutRecord,
  editWorkoutRecord,
} from './workout.js'
import {
  deriveDurationMinutesFromTimestamps,
  summarizeWorkoutSessionExercises,
} from './workout-model.js'

export const LIVE_WORKOUT_SOURCE_APP = 'murph-live' as const

const ACTIVE_WORKOUT_SCAN_LIMIT = 20
const EXERCISES_PATCH_PREFIX = 'workout.exercises='

type WorkoutShowResult = Awaited<ReturnType<typeof showWorkoutRecord>>
type WorkoutFormatShowResult = Awaited<ReturnType<typeof showWorkoutFormat>>

type ExerciseMode = NonNullable<WorkoutExercise['mode']>
type LoadUnit = NonNullable<WorkoutExercise['unitOverride']>
type SetType = NonNullable<WorkoutSet['type']>

export interface StartLiveWorkoutInput {
  vault: string
  name?: string
  routine?: string
  activityType?: string
  note?: string
  startedAt?: string
}

export interface LiveWorkoutLookupInput {
  vault: string
  workoutId?: string
}

export interface AddLiveWorkoutExerciseInput extends LiveWorkoutLookupInput {
  name: string
  sourceExerciseId?: string
  order: number
  groupId?: string
  mode?: ExerciseMode
  unitOverride?: LoadUnit
  note?: string
  setCount?: number
}

export interface LiveWorkoutExerciseLookup {
  exerciseId?: string
  exerciseName?: string
  exerciseOrder?: number
}

export interface LogLiveWorkoutSetInput
  extends LiveWorkoutLookupInput,
    LiveWorkoutExerciseLookup {
  setOrder: number
  type?: SetType
  note?: string
  reps?: number
  weight?: number
  weightUnit?: 'lb' | 'kg'
  durationSeconds?: number
  distanceMeters?: number
  rpe?: number
  bodyweightKg?: number
  assistanceKg?: number
  addedWeightKg?: number
}

export interface ClearLiveWorkoutSetInput
  extends LiveWorkoutLookupInput,
    LiveWorkoutExerciseLookup {
  setOrder: number
}

export interface FinishLiveWorkoutInput extends LiveWorkoutLookupInput {
  endedAt?: string
}

export function isActiveLiveWorkout(workout: WorkoutSession): boolean {
  return (
    workout.sourceApp === LIVE_WORKOUT_SOURCE_APP &&
    typeof workout.startedAt === 'string' &&
    workout.endedAt === undefined
  )
}

export function hasLoggedWorkoutSet(set: WorkoutSet): boolean {
  return (
    typeof set.note === 'string' ||
    typeof set.reps === 'number' ||
    typeof set.weight === 'number' ||
    typeof set.durationSeconds === 'number' ||
    typeof set.distanceMeters === 'number' ||
    typeof set.rpe === 'number' ||
    typeof set.bodyweightKg === 'number' ||
    typeof set.assistanceKg === 'number' ||
    typeof set.addedWeightKg === 'number'
  )
}

export function buildLiveWorkoutSessionFromTemplate(input: {
  template: WorkoutTemplate
  routineId: string
  routineName: string
  startedAt: string
  sessionNote?: string
}): WorkoutSession {
  return workoutSessionSchema.parse({
    sourceApp: LIVE_WORKOUT_SOURCE_APP,
    startedAt: input.startedAt,
    routineId: input.routineId,
    routineName: input.routineName,
    ...(input.sessionNote ? { sessionNote: input.sessionNote } : {}),
    exercises: input.template.exercises
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((exercise) => ({
        name: exercise.name,
        ...(exercise.sourceExerciseId
          ? { sourceExerciseId: exercise.sourceExerciseId }
          : {}),
        order: exercise.order,
        ...(exercise.groupId ? { groupId: exercise.groupId } : {}),
        ...(exercise.mode ? { mode: exercise.mode } : {}),
        ...(exercise.unitOverride ? { unitOverride: exercise.unitOverride } : {}),
        ...(exercise.note ? { note: exercise.note } : {}),
        sets: exercise.plannedSets
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((set) => ({
            order: set.order,
            ...(set.type ? { type: set.type } : {}),
          })),
      })),
  })
}

export async function startLiveWorkout(input: StartLiveWorkoutInput) {
  const active = await findActiveLiveWorkouts(input.vault)
  if (active.length > 0) {
    throw new VaultCliError(
      'command_failed',
      `Workout ${active[0]?.entity.id ?? ''} is already active. Finish or delete it before starting another live workout.`,
      {
        activeWorkoutIds: active.map((entry) => entry.entity.id),
      },
    )
  }

  const startedAt = normalizeWorkoutTimestamp(
    input.startedAt ?? new Date().toISOString(),
    'startedAt',
  )
  const normalizedName = normalizeOptionalText(input.name)
  const normalizedNote = normalizeOptionalText(input.note)

  if (input.routine) {
    const routine = await loadWorkoutRoutine(input.vault, input.routine)
    const routineTitle = requireString(routine.entity.title, 'Workout routine title is missing.')
    const template = workoutTemplateSchema.parse(routine.entity.data.template)
    const workout = buildLiveWorkoutSessionFromTemplate({
      template,
      routineId: requireString(
        routine.entity.data.workoutFormatId,
        'Workout routine id is missing.',
      ),
      routineName: routineTitle,
      startedAt,
      sessionNote: normalizedNote,
    })

    return addWorkoutRecord({
      vault: input.vault,
      workout,
      text: normalizedNote ?? routineTitle,
      title: normalizedName ?? routineTitle,
      durationMinutes: elapsedDurationMinutes(startedAt, new Date().toISOString()),
      activityType:
        normalizeOptionalText(input.activityType) ??
        optionalString(routine.entity.data.activityType) ??
        'strength-training',
      distanceKm: optionalNumber(routine.entity.data.distanceKm),
      occurredAt: startedAt,
      source: 'manual',
    })
  }

  const title = normalizedName ?? 'Workout'
  const workout = workoutSessionSchema.parse({
    sourceApp: LIVE_WORKOUT_SOURCE_APP,
    startedAt,
    ...(normalizedNote ? { sessionNote: normalizedNote } : {}),
    exercises: [],
  })

  return addWorkoutRecord({
    vault: input.vault,
    workout,
    text: normalizedNote ?? title,
    title,
    durationMinutes: elapsedDurationMinutes(startedAt, new Date().toISOString()),
    activityType: normalizeOptionalText(input.activityType) ?? 'strength-training',
    occurredAt: startedAt,
    source: 'manual',
  })
}

export async function showActiveLiveWorkout(input: LiveWorkoutLookupInput) {
  return resolveLiveWorkout(input, { requireActive: true })
}

export async function addLiveWorkoutExercise(
  input: AddLiveWorkoutExerciseInput,
) {
  const shown = await resolveLiveWorkout(input, { requireActive: true })
  const workout = parseShownWorkout(shown)
  const exercises = structuredClone(workout.exercises)
  const order = input.order
  const name = requireNonEmptyText(input.name, 'Exercise name is required.')
  const sourceExerciseId = normalizeOptionalText(input.sourceExerciseId)
  const groupId = normalizeOptionalText(input.groupId)
  const note = normalizeOptionalText(input.note)
  const setCount = input.setCount ?? 1

  if (!Number.isInteger(order) || order < 1) {
    throw new VaultCliError('invalid_option', 'Exercise order must be a positive integer.')
  }
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 150) {
    throw new Va