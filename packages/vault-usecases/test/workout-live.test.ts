import assert from 'node:assert/strict'

import { describe, test } from 'vitest'
import {
  workoutSessionSchema,
  workoutTemplateSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  buildLiveWorkoutSessionFromTemplate,
  hasLoggedWorkoutSet,
  isActiveLiveWorkout,
  LIVE_WORKOUT_SOURCE_APP,
} from '../src/usecases/workout-live.js'
import {
  assertTargetableLiveWorkout,
  normalizeLiveWorkoutId,
  requireLiveWorkoutSetOrder,
  resolveExerciseIndex,
} from '../src/usecases/workout-live-state.js'

describe('live workout model', () => {
  test('starts saved routines as active sessions with unlogged placeholders', () => {
    const template = workoutTemplateSchema.parse({
      routineNote: 'Push day',
      exercises: [
        {
          name: 'Bench press',
          sourceExerciseId: 'EX123',
          order: 3,
          mode: 'weight_reps',
          unitOverride: 'lb',
          plannedSets: [
            {
              order: 2,
              type: 'warmup',
              targetReps: 10,
              targetWeight: 95,
              targetWeightUnit: 'lb',
            },
            {
              order: 4,
              targetReps: 8,
              targetWeight: 135,
              targetWeightUnit: 'lb',
              targetRpe: 7,
            },
          ],
        },
      ],
    })

    const workout = buildLiveWorkoutSessionFromTemplate({
      template,
      routineId: 'wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      routineName: 'Push Day',
      startedAt: '2026-08-09T18:00:00.000Z',
      sessionNote: 'Gym session',
    })

    assert.equal(workout.sourceApp, LIVE_WORKOUT_SOURCE_APP)
    assert.equal(workout.startedAt, '2026-08-09T18:00:00.000Z')
    assert.equal(workout.endedAt, undefined)
    assert.equal(workout.sessionNote, 'Gym session')
    assert.equal(isActiveLiveWorkout(workout), true)
    assert.deepEqual(workout.exercises, [
      {
        name: 'Bench press',
        sourceExerciseId: 'EX123',
        order: 3,
        mode: 'weight_reps',
        unitOverride: 'lb',
        sets: [
          { order: 2, type: 'warmup' },
          { order: 4 },
        ],
      },
    ])
    assert.equal(hasLoggedWorkoutSet(workout.exercises[0]!.sets[0]!), false)
    assert.equal(
      resolveExerciseIndex(workout.exercises, {
        exerciseName: 'Bench press',
        exerciseOrder: 3,
      }),
      0,
    )
    assert.throws(
      () =>
        resolveExerciseIndex(workout.exercises, {
          exerciseName: 'Bench press',
          exerciseOrder: 1,
        }),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'not_found',
    )
    assert.equal(
      hasLoggedWorkoutSet({ order: 1, reps: 8, weight: 135, weightUnit: 'lb' }),
      true,
    )
    assert.equal(
      isActiveLiveWorkout({
        ...workout,
        endedAt: '2026-08-09T18:45:00.000Z',
      }),
      false,
    )

    const workoutWithRoutineNote = buildLiveWorkoutSessionFromTemplate({
      template,
      routineId: 'wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      routineName: 'Push Day',
      startedAt: '2026-08-09T18:00:00.000Z',
    })
    assert.equal(workoutWithRoutineNote.sessionNote, 'Push day')
  })

  test('validates live mutation coordinates and direct-usecase selectors', () => {
    assert.equal(normalizeLiveWorkoutId(undefined), undefined)
    assert.equal(
      normalizeLiveWorkoutId(' evt_01ARZ3NDEKTSV4RRFFQ69G5FAV '),
      'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    )
    assert.throws(
      () => normalizeLiveWorkoutId(''),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'invalid_option',
    )

    assert.equal(requireLiveWorkoutSetOrder(1), 1)
    assert.throws(
      () => requireLiveWorkoutSetOrder(0),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'invalid_option',
    )

    const duplicateExerciseOrders = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [
        {
          name: 'Bench press',
          order: 1,
          sets: [{ order: 1 }],
        },
        {
          name: 'Row',
          order: 1,
          sets: [{ order: 1 }],
        },
      ],
    })
    assert.throws(
      () =>
        assertTargetableLiveWorkout(
          duplicateExerciseOrders,
          'Workout test',
        ),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'contract_invalid',
    )

    const duplicateSetOrders = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [
        {
          name: 'Bench press',
          order: 1,
          sets: [{ order: 1 }, { order: 1 }],
        },
      ],
    })
    assert.throws(
      () =>
        assertTargetableLiveWorkout(
          duplicateSetOrders,
          'Workout test',
        ),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'contract_invalid',
    )
  })
})
