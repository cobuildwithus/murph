import { createHash } from 'node:crypto'

import type { WorkoutExercise, WorkoutSession } from '@murphai/contracts'

function projectWorkoutActionExerciseCoordinate(exercise: WorkoutExercise) {
  return {
    groupId: exercise.groupId ?? null,
    memberRepsPerSet: exercise.memberRepsPerSet ?? null,
    mode: exercise.mode ?? null,
    name: exercise.name,
    note: exercise.note ?? null,
    setPlanIsFinite: exercise.setPlanIsFinite ?? null,
    sets: exercise.sets
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((set) => ({
        order: set.order,
        type: set.type ?? null,
      })),
    sourceExerciseId: exercise.sourceExerciseId ?? null,
    targetWeightPerSet: exercise.targetWeightPerSet ?? null,
    targetWeightUnit: exercise.targetWeightUnit ?? null,
    unitOverride: exercise.unitOverride ?? null,
  }
}

export function hasAmbiguousWorkoutActionExerciseCoordinates(
  workout: Pick<WorkoutSession, 'exercises'>,
): boolean {
  const seen = new Set<string>()
  for (const exercise of workout.exercises) {
    const signature = JSON.stringify(
      projectWorkoutActionExerciseCoordinate(exercise),
    )
    if (seen.has(signature)) return true
    seen.add(signature)
  }
  return false
}

export function deriveWorkoutActionBinding(
  workoutEntityId: string,
  workout: Pick<WorkoutSession, 'exercises' | 'lastMemberActionId'>,
): string {
  const orderedExercises = workout.exercises
    .slice()
    .sort((left, right) => left.order - right.order)
  const includesPlannedWeightTargets = orderedExercises.some(
    (exercise) => exercise.targetWeightPerSet !== undefined,
  )
  const positionalIdentity = orderedExercises
    .map((exercise) => {
      const coordinate = projectWorkoutActionExerciseCoordinate(exercise)
      const baseCoordinate = {
        groupId: coordinate.groupId,
        memberRepsPerSet: coordinate.memberRepsPerSet,
        mode: coordinate.mode,
        name: coordinate.name,
        note: coordinate.note,
        order: exercise.order,
        setPlanIsFinite: coordinate.setPlanIsFinite,
        sets: coordinate.sets,
        sourceExerciseId: coordinate.sourceExerciseId,
        unitOverride: coordinate.unitOverride,
      }
      return includesPlannedWeightTargets
        ? {
            ...baseCoordinate,
            targetWeightPerSet: coordinate.targetWeightPerSet,
            targetWeightUnit: coordinate.targetWeightUnit,
          }
        : baseCoordinate
    })

  return createHash('sha256')
    .update(
      `workout-action:v${includesPlannedWeightTargets ? 5 : 4}:${workoutEntityId}:${workout.lastMemberActionId ?? ''}:${JSON.stringify(positionalIdentity)}`,
    )
    .digest('hex')
}

export function deriveWorkoutSetRemovalBinding(
  workoutEntityId: string,
  exercises: WorkoutExercise[],
): string {
  const includesPlannedWeightTargets = exercises.some(
    (exercise) => exercise.targetWeightPerSet !== undefined,
  )
  const canonicalExercises = exercises
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((exercise) => {
      const baseExercise = {
        groupId: exercise.groupId ?? null,
        memberRepsPerSet: exercise.memberRepsPerSet ?? null,
        mode: exercise.mode ?? null,
        name: exercise.name,
        note: exercise.note ?? null,
        order: exercise.order,
        setPlanIsFinite: exercise.setPlanIsFinite ?? null,
        sets: exercise.sets
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((set) => ({
            addedWeightKg: set.addedWeightKg ?? null,
            assistanceKg: set.assistanceKg ?? null,
            bodyweightKg: set.bodyweightKg ?? null,
            distanceMeters: set.distanceMeters ?? null,
            durationSeconds: set.durationSeconds ?? null,
            note: set.note ?? null,
            order: set.order,
            reps: set.reps ?? null,
            rpe: set.rpe ?? null,
            type: set.type ?? null,
            weight: set.weight ?? null,
            weightUnit: set.weightUnit ?? null,
          })),
        sourceExerciseId: exercise.sourceExerciseId ?? null,
        unitOverride: exercise.unitOverride ?? null,
      }
      return includesPlannedWeightTargets
        ? {
            ...baseExercise,
            targetWeightPerSet: exercise.targetWeightPerSet ?? null,
            targetWeightUnit: exercise.targetWeightUnit ?? null,
          }
        : baseExercise
    })

  return createHash('sha256')
    .update(
      `workout-set-removal:v${includesPlannedWeightTargets ? 3 : 2}:${workoutEntityId}:${JSON.stringify(canonicalExercises)}`,
    )
    .digest('hex')
}
