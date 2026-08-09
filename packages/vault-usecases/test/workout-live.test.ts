import assert from 'node:assert/strict'

import { describe, test } from 'vitest'
import { workoutTemplateSchema } from '@murphai/contracts'

import {
  buildLiveWorkoutSessionFromTemplate,
  hasLoggedWorkoutSet,
  isActiveLiveWorkout,
  LIVE_WORKOUT_SOURCE_APP,
} from '../src/usecases/workout-live.js'

describe('live workout model', () => {
  test('starts saved routines as active sessions with unlogged placeholders', () => {
    const template = workoutTemplateSchema.parse({
      routineNote: 'Push day',
      exercises: [
        {
          name: 'Bench press',
          sourceExerciseId: 'EX123',
          order: 1,
          mode: 'weight_reps',
          unitOverride: 'lb',
          plannedSets: [
            {
              order: 1,
              type: 'warmup',
              targetReps: 10,
              targetWeight: 95,
              targetWeightUnit: 'lb',
            },
            {
              order: 2,
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
        order: 1,
        mode: 'weight_reps',
        unitOverride: 'lb',
        sets: [
          { order: 1, type: 'warmup' },
          { order: 2 },
        ],
      },
    ])
    assert.equal(hasLoggedWorkoutSet(workout.exercises[0]!.sets[0]!), false)
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
})
