import { describe, expect, it } from 'vitest'
import type { WorkoutExercise, WorkoutSet } from '@murphai/contracts'

import {
  deriveWorkoutSetRemovalBinding,
} from '../src/workout-action-binding.js'

const BASE_EXERCISES = [{
  mode: 'weight_reps' as const,
  name: 'Leg press',
  order: 1,
  sets: [{ order: 1 }, { order: 2, reps: 8 }],
  unitOverride: 'lb' as const,
}] satisfies WorkoutExercise[]

describe('workout set-removal binding', () => {
  it.each([
    ['name', { name: 'Hack squat' }],
    ['source id', { sourceExerciseId: 'catalog:hack-squat' }],
    ['order', { order: 2 }],
    ['group id', { groupId: 'superset-a' }],
    ['mode', { mode: 'duration' as const }],
    ['unit override', { unitOverride: 'kg' as const }],
    ['note', { note: 'Controlled tempo' }],
  ] satisfies Array<[string, Partial<WorkoutExercise>]>)(
    'changes when canonical exercise %s changes',
    (_label, patch) => {
      const changed: WorkoutExercise[] = structuredClone(BASE_EXERCISES)
      changed[0] = { ...changed[0]!, ...patch }

      expect(deriveWorkoutSetRemovalBinding('evt_workout', changed)).not.toBe(
        deriveWorkoutSetRemovalBinding('evt_workout', BASE_EXERCISES),
      )
    },
  )

  it.each([
    ['type', { type: 'warmup' as const }],
    ['note', { note: 'Pause at the bottom' }],
    ['reps', { reps: 9 }],
    ['weight', { weight: 180 }],
    ['weight unit', { weightUnit: 'kg' as const }],
    ['duration', { durationSeconds: 45 }],
    ['distance', { distanceMeters: 100 }],
    ['RPE', { rpe: 8 }],
    ['bodyweight', { bodyweightKg: 82 }],
    ['assistance', { assistanceKg: 20 }],
    ['added load', { addedWeightKg: 10 }],
  ] satisfies Array<[string, Partial<WorkoutSet>]>)(
    'changes when canonical set %s changes',
    (_label, patch) => {
      const changed: WorkoutExercise[] = structuredClone(BASE_EXERCISES)
      changed[0]!.sets[1] = { ...changed[0]!.sets[1]!, ...patch }

      expect(deriveWorkoutSetRemovalBinding('evt_workout', changed)).not.toBe(
        deriveWorkoutSetRemovalBinding('evt_workout', BASE_EXERCISES),
      )
    },
  )

  it('is stable across array order when canonical order fields are unchanged', () => {
    const exercises: WorkoutExercise[] = structuredClone(BASE_EXERCISES)
    exercises[0]!.sets.reverse()

    expect(deriveWorkoutSetRemovalBinding('evt_workout', exercises)).toBe(
      deriveWorkoutSetRemovalBinding('evt_workout', BASE_EXERCISES),
    )
  })

  it('is scoped to the hidden canonical workout identity', () => {
    expect(deriveWorkoutSetRemovalBinding('evt_workout_2', BASE_EXERCISES)).not.toBe(
      deriveWorkoutSetRemovalBinding('evt_workout', BASE_EXERCISES),
    )
  })
})
