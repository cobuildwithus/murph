import { createHash } from 'node:crypto'

import type { WorkoutExercise, WorkoutSession, WorkoutSet } from '@murphai/contracts'

type CompleteNullableProjection<T> = {
  [Key in keyof Required<T>]: T[Key] | null
}

type CanonicalWorkoutSet = CompleteNullableProjection<WorkoutSet>
type CanonicalWorkoutExercise = CompleteNullableProjection<
  Omit<WorkoutExercise, 'sets'>
> & { sets: CanonicalWorkoutSet[] }

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
  const positionalIdentity = workout.exercises
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((exercise) => {
      const coordinate = projectWorkoutActionExerciseCoordinate(exercise)
      return {
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
    })

  return createHash('sha256')
    .update(
      `workout-action:v4:${workoutEntityId}:${workout.lastMemberActionId ?? ''}:${JSON.stringify(positionalIdentity)}`,
    )
    .digest('hex')
}

export function deriveWorkoutSetRemovalBinding(
  workoutEntityId: string,
  exercises: WorkoutExercise[],
): string {
  const canonicalExercises: CanonicalWorkoutExercise[] = exercises
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((exercise) => ({
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
    }))

  return createHash('sha256')
    .update(
      `workout-set-removal:v2:${workoutEntityId}:${JSON.stringify(canonicalExercises)}`,
    )
    .digest('hex')
}
