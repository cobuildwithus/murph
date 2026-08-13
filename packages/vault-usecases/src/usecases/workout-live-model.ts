import {
  renderWorkoutSessionEditorResultV1,
  type WorkoutLiveApplyMemberActionV1,
  type WorkoutMemberActionExpectedSetResultV1,
  type WorkoutSessionDetailV1,
  type WorkoutSessionEditorProjectionV1,
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

export interface ApplyLiveWorkoutMemberActionInput {
  acceptedAt: string
  action: WorkoutLiveApplyMemberActionV1
  vault: string
}

export type ApplyLiveWorkoutMemberActionResult =
  | { status: 'applied' | 'unchanged' }
  | {
      reason:
        | 'multiple_active_workouts'
        | 'no_active_workout'
        | 'workout_changed'
      status: 'rejected'
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

export function buildLiveWorkoutCardEditor(input: {
  presentation: WorkoutSessionDetailV1
  workout: WorkoutSession
}): {
  editor: WorkoutSessionEditorProjectionV1
  workout: WorkoutSessionDetailV1
} | null {
  if (!isActiveLiveWorkout(input.workout) || input.presentation.state !== 'active') {
    return null
  }
  const exercises = input.workout.exercises
    .slice()
    .sort((left, right) => left.order - right.order)
  if (exercises.length !== input.presentation.exercises.length) {
    return null
  }

  const editorExercises: WorkoutSessionEditorProjectionV1['exercises'] = []
  const presentationExercises: WorkoutSessionDetailV1['exercises'] = []
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    const presentationExercise = input.presentation.exercises[exerciseIndex]
    const sets = exercise.sets
      .slice()
      .sort((left, right) => left.order - right.order)
    if (
      !presentationExercise
      || presentationExercise.name !== exercise.name
      || presentationExercise.sets.length !== sets.length
    ) {
      return null
    }

    const editorSets: WorkoutSessionEditorProjectionV1['exercises'][number]['sets'] = []
    const presentationSets: WorkoutSessionDetailV1['exercises'][number]['sets'] = []
    for (const [setIndex, set] of sets.entries()) {
      const cardSet = presentationExercise.sets[setIndex]
      const logged = hasLoggedWorkoutSet(set)
      if (!cardSet || logged !== (cardSet.status === 'completed')) {
        return null
      }
      const result = logged
        ? projectWorkoutSessionEditorResult(exercise, set)
        : null
      const actual = result === null
        ? null
        : renderWorkoutSessionEditorResultV1(
            encodeWorkoutSessionEditorResult(result),
            exercise.unitOverride ?? null,
          )
      if (logged && (actual === null || actual === undefined)) {
        return null
      }
      editorSets.push({ logged, result })
      presentationSets.push({
        status: logged ? 'completed' : 'pending',
        target: cardSet.target,
        actual: logged ? actual ?? 'Logged' : null,
      })
    }
    editorExercises.push({
      sets: editorSets,
      unitOverride: exercise.unitOverride ?? null,
    })
    presentationExercises.push({
      name: exercise.name,
      sets: presentationSets,
    })
  }

  return {
    editor: { exercises: editorExercises, version: 1 },
    workout: {
      exercises: presentationExercises,
      state: 'active',
      version: 1,
    },
  }
}

function projectWorkoutSessionEditorResult(
  exercise: WorkoutExercise,
  set: WorkoutSet,
): WorkoutMemberActionExpectedSetResultV1 {
  const isWeightOriented = exercise.mode === 'weight_reps'
    || typeof set.weight === 'number'
    || exercise.unitOverride !== undefined
    || set.weightUnit !== undefined
  if (
    typeof set.weight === 'number'
    || (typeof set.reps === 'number' && isWeightOriented)
  ) {
    return {
      kind: 'weight_reps',
      reps: set.reps ?? null,
      weight: set.weight ?? null,
      weightUnit: set.weightUnit ?? null,
    }
  }
  if (typeof set.reps === 'number') {
    return { kind: 'reps', reps: set.reps ?? null }
  }
  if (typeof set.note === 'string') {
    return { kind: 'note', note: set.note }
  }
  if (isWeightOriented) {
    return {
      kind: 'weight_reps',
      reps: null,
      weight: null,
      weightUnit: set.weightUnit ?? null,
    }
  }
  return exercise.mode === 'bodyweight'
    ? { kind: 'reps', reps: null }
    : { kind: 'note', note: null }
}

function encodeWorkoutSessionEditorResult(
  result: WorkoutMemberActionExpectedSetResultV1,
): unknown {
  switch (result.kind) {
    case 'note':
      return ['n', result.note]
    case 'reps':
      return ['r', result.reps]
    case 'weight_reps':
      return [
        'w',
        result.reps,
        result.weight,
        result.weightUnit === 'lb'
          ? 'l'
          : result.weightUnit === 'kg'
            ? 'k'
            : null,
      ]
  }
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
