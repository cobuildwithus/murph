import { createHash } from 'node:crypto'

import type { WorkoutExercise, WorkoutSet } from '@murphai/contracts'

type CompleteNullableProjection<T> = {
  [Key in keyof Required<T>]: T[Key] | null
}

type CanonicalWorkoutSet = CompleteNullableProjection<WorkoutSet>
type CanonicalWorkoutExercise = CompleteNullableProjection<
  Omit<WorkoutExercise, 'sets'>
> & { sets: CanonicalWorkoutSet[] }

export function deriveWorkoutActionBinding(
  workoutEntityId: string,
  lastMemberActionId?: string,
): string {
  return createHash('sha256')
    .update(`workout-action:v2:${workoutEntityId}:${lastMemberActionId ?? ''}`)
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
      mode: exercise.mode ?? null,
      name: exercise.name,
      note: exercise.note ?? null,
      order: exercise.order,
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
      `workout-set-removal:v1:${workoutEntityId}:${JSON.stringify(canonicalExercises)}`,
    )
    .digest('hex')
}
