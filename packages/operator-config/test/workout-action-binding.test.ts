import { describe, expect, it } from 'vitest'
import type { WorkoutExercise, WorkoutSet } from '@murphai/contracts'

import {
  deriveWorkoutActionBinding,
  deriveWorkoutSetRemovalBinding,
  hasAmbiguousWorkoutActionExerciseCoordinates,
} from '../src/workout-action-binding.js'

const BASE_EXERCISES = [{
  mode: 'weight_reps' as const,
  name: 'Leg press',
  order: 1,
  sets: [{ order: 1 }, { order: 2, reps: 8 }],
  unitOverride: 'lb' as const,
}] satisfies WorkoutExercise[]

describe('workout action binding', () => {
  it('changes when hidden same-name exercise identity moves', () => {
    const exercises = [
      {
        groupId: 'left',
        mode: 'weight_reps' as const,
        name: 'Single-arm row',
        order: 1,
        sets: [{ order: 1, reps: 8 }],
      },
      {
        groupId: 'right',
        mode: 'weight_reps' as const,
        name: 'Single-arm row',
        order: 2,
        sets: [{ order: 1, reps: 8 }],
      },
    ] satisfies WorkoutExercise[]
    const reordered = [
      { ...exercises[1]!, order: 1 },
      { ...exercises[0]!, order: 2 },
    ]

    expect(deriveWorkoutActionBinding('evt_workout', { exercises })).not.toBe(
      deriveWorkoutActionBinding('evt_workout', { exercises: reordered }),
    )
  })

  it('detects duplicate exercise coordinates that mutable results cannot distinguish', () => {
    const exercises = [
      {
        mode: 'bodyweight' as const,
        name: 'Single-arm row',
        order: 1,
        sets: [{ order: 1, reps: 8 }, { order: 2, reps: 10 }],
      },
      {
        mode: 'bodyweight' as const,
        name: 'Single-arm row',
        order: 2,
        sets: [{ order: 1, reps: 12 }, { order: 2, reps: 8 }],
      },
    ] satisfies WorkoutExercise[]

    expect(
      hasAmbiguousWorkoutActionExerciseCoordinates({ exercises }),
    ).toBe(true)
    expect(hasAmbiguousWorkoutActionExerciseCoordinates({
      exercises: exercises.map((exercise, index) => ({
        ...exercise,
        groupId: index === 0 ? 'left' : 'right',
      })),
    })).toBe(false)
  })

  it('changes when direct-action generation or positional structure changes', () => {
    const workout = { exercises: BASE_EXERCISES }
    const original = deriveWorkoutActionBinding('evt_workout', workout)

    expect(deriveWorkoutActionBinding('evt_workout', {
      ...workout,
      lastMemberActionId: '2f1c1fdc-c7b0-4d90-b902-8e6295959243',
    })).not.toBe(original)
    expect(deriveWorkoutActionBinding('evt_workout', {
      exercises: [{
        ...BASE_EXERCISES[0]!,
        sets: [...BASE_EXERCISES[0]!.sets, { order: 3 }],
      }],
    })).not.toBe(original)
    expect(deriveWorkoutActionBinding('evt_workout', {
      exercises: [{
        ...BASE_EXERCISES[0]!,
        sets: [
          { ...BASE_EXERCISES[0]!.sets[0]!, type: 'warmup' },
          BASE_EXERCISES[0]!.sets[1]!,
        ],
      }],
    })).not.toBe(original)
  })

  it('preserves the binding across unrelated set result and annotation changes', () => {
    const changed: WorkoutExercise[] = structuredClone(BASE_EXERCISES)
    changed[0]!.sets[1] = {
      ...changed[0]!.sets[1]!,
      note: 'Pause at the bottom',
      reps: 9,
      rpe: 8,
      weight: 180,
      weightUnit: 'kg',
    }

    expect(deriveWorkoutActionBinding('evt_workout', {
      exercises: changed,
    })).toBe(deriveWorkoutActionBinding('evt_workout', {
      exercises: BASE_EXERCISES,
    }))
  })

  it('is scoped to the hidden canonical workout identity', () => {
    expect(deriveWorkoutActionBinding('evt_workout_2', {
      exercises: BASE_EXERCISES,
    })).not.toBe(deriveWorkoutActionBinding('evt_workout', {
      exercises: BASE_EXERCISES,
    }))
  })
})

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
