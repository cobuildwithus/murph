import {
  type WorkoutExercise,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutTemplate,
  workoutSessionSchema,
} from '@murphai/contracts'

import { deriveDurationMinutesFromTimestamps } from './workout-model.js'

export const LIVE_WORKOUT_SOURCE_APP = 'murph-live' as const

export type ExerciseMode = NonNullable<WorkoutExercise['mode']>
export type LoadUnit = NonNullable<WorkoutExercise['unitOverride']>
export type SetType = NonNullable<WorkoutSet['type']>

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
  requireExistingSet?: boolean
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
  const sessionNote = input.sessionNote ?? input.template.routineNote

  return workoutSessionSchema.parse({
    sourceApp: LIVE_WORKOUT_SOURCE_APP,
    startedAt: input.startedAt,
    routineId: input.routineId,
    routineName: input.routineName,
    ...(sessionNote ? { sessionNote } : {}),
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

export function elapsedDurationMinutes(startedAt: string, endedAt: string): number {
  return deriveDurationMinutesFromTimestamps(startedAt, endedAt) ?? 1
}
