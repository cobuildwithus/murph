import assert from 'node:assert/strict'

import { describe, test } from 'vitest'
import {
  workoutSessionSchema,
  workoutTemplateSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  deriveWorkoutActionBinding,
  deriveWorkoutSetRemovalBinding,
} from '@murphai/operator-config/workout-action-binding'

import {
  buildLiveWorkoutSessionFromTemplate,
  buildLiveWorkoutCardEditor,
  hasCompletedFiniteLiveWorkoutPlan,
  hasFiniteLiveWorkoutPlan,
  hasLoggedWorkoutSet,
  isOpenLiveWorkout,
  LIVE_WORKOUT_SOURCE_APP,
} from '../src/usecases/workout-live.js'
import {
  assertTargetableLiveWorkout,
  normalizeLiveWorkoutId,
  requireLiveWorkoutSetOrder,
  resolveExerciseIndex,
} from '../src/usecases/workout-live-state.js'

describe('live workout model', () => {
  test('projects exact editable field families from canonical set state', () => {
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [
        {
          name: 'Bench press',
          order: 1,
          mode: 'weight_reps',
          unitOverride: 'lb',
          sets: [
            { order: 1, reps: 8 },
            { order: 2, weight: 0, weightUnit: 'kg' },
            { order: 3 },
          ],
        },
        {
          name: 'Push-up',
          order: 2,
          mode: 'bodyweight',
          sets: [{ note: 'Slow tempo', order: 1 }],
        },
      ],
    })
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [
        {
          name: 'Bench press',
          sets: [
            { status: 'completed' as const, target: null, actual: 'old' },
            { status: 'completed' as const, target: null, actual: 'old' },
            { status: 'pending' as const, target: '185 lb × 8', actual: null },
          ],
        },
        {
          name: 'Push-up',
          sets: [{ status: 'completed' as const, target: null, actual: 'old' }],
        },
      ],
    }

    assert.deepEqual(buildLiveWorkoutCardEditor({
      presentation,
      workout,
      workoutId: 'evt_test_workout',
    }), {
      editor: {
        actionBinding: deriveWorkoutActionBinding('evt_test_workout', workout),
        version: 1,
        setRemovalBinding: deriveWorkoutSetRemovalBinding(
          'evt_test_workout',
          workout.exercises,
        ),
        exercises: [
          {
            unitOverride: 'lb',
            sets: [
              {
                logged: true,
                result: {
                  kind: 'weight_reps',
                  reps: 8,
                  weight: null,
                  weightUnit: null,
                },
              },
              {
                logged: true,
                result: {
                  kind: 'weight_reps',
                  reps: null,
                  weight: 0,
                  weightUnit: 'kg',
                },
              },
              { logged: false, result: null },
            ],
          },
          {
            unitOverride: null,
            sets: [{
              logged: true,
              result: { kind: 'note', note: 'Slow tempo' },
            }],
          },
        ],
      },
      workout: {
        version: 1,
        state: 'active',
        exercises: [
          {
            name: 'Bench press',
            sets: [
              { status: 'completed', target: null, actual: '8 reps' },
              { status: 'completed', target: null, actual: '0 kg' },
              { status: 'pending', target: '185 lb × 8', actual: null },
            ],
          },
          {
            name: 'Push-up',
            sets: [{ status: 'completed', target: null, actual: 'Slow tempo' }],
          },
        ],
      },
    })
  })

  test('keeps hidden canonical notes out of the editable projection', () => {
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [{
        name: 'Plank',
        sets: [{ status: 'completed' as const, target: null, actual: 'Logged' }],
      }],
    }
    const workoutForNote = (note: string) => workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [{
        name: 'Plank',
        order: 1,
        sets: [{ note, order: 1 }],
      }],
    })

    assert.deepEqual(
      buildLiveWorkoutCardEditor({
        presentation,
        workout: workoutForNote('n'.repeat(40)),
        workoutId: 'evt_test_workout',
      })?.editor.exercises[0]?.sets[0]?.result,
      { kind: 'note', note: 'n'.repeat(40) },
    )
    assert.equal(buildLiveWorkoutCardEditor({
      presentation,
      workout: workoutForNote('n'.repeat(41)),
      workoutId: 'evt_test_workout',
    }), null)
    assert.equal(buildLiveWorkoutCardEditor({
      presentation,
      workout: workoutForNote('n'.repeat(400)),
      workoutId: 'evt_test_workout',
    }), null)
  })

  test('changes the editor action binding after a member action', () => {
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [{
        name: 'Push-up',
        sets: [{ status: 'pending' as const, target: null, actual: null }],
      }],
    }
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      lastMemberActionId: '2f1c1fdc-c7b0-4d90-b902-8e6295959243',
      exercises: [{
        name: 'Push-up',
        order: 1,
        sets: [{ order: 1 }],
      }],
    })
    const earlierWorkout = structuredClone(workout)
    delete earlierWorkout.lastMemberActionId

    assert.equal(
      buildLiveWorkoutCardEditor({
        presentation,
        workout,
        workoutId: 'evt_test_workout',
      })?.editor.actionBinding,
      deriveWorkoutActionBinding(
        'evt_test_workout',
        workout,
      ),
    )
    assert.notEqual(
      deriveWorkoutActionBinding('evt_test_workout', earlierWorkout),
      deriveWorkoutActionBinding(
        'evt_test_workout',
        workout,
      ),
    )
  })

  test('keeps coordinate-indistinguishable duplicate exercises on the read-only card', () => {
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [8, 12].map((reps) => ({
        name: 'Single-arm row',
        sets: [{
          status: 'completed' as const,
          target: null,
          actual: `${reps} reps`,
        }],
      })),
    }
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [8, 12].map((reps, index) => ({
        mode: 'bodyweight' as const,
        name: 'Single-arm row',
        order: index + 1,
        sets: [{ order: 1, reps }],
      })),
    })

    assert.equal(buildLiveWorkoutCardEditor({
      presentation,
      workout,
      workoutId: 'evt_test_workout',
    }), null)

    const disambiguated = structuredClone(workout)
    disambiguated.exercises[0]!.groupId = 'left'
    disambiguated.exercises[1]!.groupId = 'right'
    assert.notEqual(buildLiveWorkoutCardEditor({
      presentation,
      workout: disambiguated,
      workoutId: 'evt_test_workout',
    }), null)
  })

  test.each([
    { label: 'duration', set: { durationSeconds: 60 } },
    {
      label: 'distance and duration',
      set: { distanceMeters: 500, durationSeconds: 120 },
    },
    { label: 'RPE', set: { rpe: 8 } },
    { label: 'bodyweight', set: { bodyweightKg: 80, reps: 8 } },
    { label: 'assisted bodyweight', set: { assistanceKg: 20, reps: 8 } },
    { label: 'weighted bodyweight', set: { addedWeightKg: 10, reps: 8 } },
    { label: 'reps with note', set: { note: 'Slow tempo', reps: 8 } },
    { label: 'note with set unit', set: { note: 'Slow tempo', weightUnit: 'kg' as const } },
    { label: 'weight and reps with RPE', set: { reps: 8, rpe: 8, weight: 100 } },
  ])('keeps a canonical $label result on the read-only card', ({ set }) => {
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [{
        name: 'Exercise',
        sets: [{ status: 'completed' as const, target: null, actual: 'Exact result' }],
      }],
    }
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [{
        name: 'Exercise',
        order: 1,
        sets: [{ ...set, order: 1 }],
      }],
    })

    assert.equal(buildLiveWorkoutCardEditor({
      presentation,
      workout,
      workoutId: 'evt_test_workout',
    }), null)
    assert.equal(presentation.exercises[0]?.sets[0]?.actual, 'Exact result')
  })

  test('keeps a pending set with an unprojected unit on the read-only card', () => {
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [{
        name: 'Exercise',
        sets: [{ status: 'pending' as const, target: '8 reps', actual: null }],
      }],
    }
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [{
        name: 'Exercise',
        order: 1,
        sets: [{ order: 1, weightUnit: 'kg' }],
      }],
    })

    assert.equal(buildLiveWorkoutCardEditor({
      presentation,
      workout,
      workoutId: 'evt_test_workout',
    }), null)
  })

  test.each([
    'assisted_bodyweight',
    'weighted_bodyweight',
    'duration',
    'cardio',
  ] as const)('keeps a pending %s exercise on the read-only card', (mode) => {
    const presentation = {
      version: 1 as const,
      state: 'active' as const,
      exercises: [{
        name: 'Exercise',
        sets: [{ status: 'pending' as const, target: null, actual: null }],
      }],
    }
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [{
        mode,
        name: 'Exercise',
        order: 1,
        sets: [{ order: 1 }],
      }],
    })

    assert.equal(buildLiveWorkoutCardEditor({
      presentation,
      workout,
      workoutId: 'evt_test_workout',
    }), null)
  })

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
    assert.equal(isOpenLiveWorkout(workout), true)
    assert.deepEqual(workout.exercises, [
      {
        name: 'Bench press',
        sourceExerciseId: 'EX123',
        order: 3,
        mode: 'weight_reps',
        unitOverride: 'lb',
        setPlanIsFinite: true,
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
      isOpenLiveWorkout({
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

  test('keeps finite-plan intent and member-stated repetitions separate from actual sets', () => {
    const workout = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      exercises: [{
        memberRepsPerSet: 8,
        name: 'Seated row',
        order: 1,
        setPlanIsFinite: true,
        sets: [{ order: 1 }, { order: 2 }],
      }],
    })

    assert.equal(hasFiniteLiveWorkoutPlan(workout), true)
    assert.equal(hasCompletedFiniteLiveWorkoutPlan(workout), false)
    assert.deepEqual(workout.exercises[0]?.sets, [{ order: 1 }, { order: 2 }])
    assert.equal(workout.exercises[0]?.memberRepsPerSet, 8)

    const completed = structuredClone(workout)
    completed.exercises[0]!.sets = [
      { order: 1, reps: 8 },
      { order: 2, reps: 8 },
    ]
    assert.equal(hasCompletedFiniteLiveWorkoutPlan(completed), true)

    const legacyRoutine = workoutSessionSchema.parse({
      sourceApp: LIVE_WORKOUT_SOURCE_APP,
      startedAt: '2026-08-09T18:00:00.000Z',
      routineId: 'wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      exercises: [{
        name: 'Legacy routine exercise',
        order: 1,
        sets: [{ order: 1, reps: 8 }],
      }],
    })
    assert.equal(hasFiniteLiveWorkoutPlan(legacyRoutine), true)

    const legacyRoutineWithTargetlessExercise = structuredClone(legacyRoutine)
    legacyRoutineWithTargetlessExercise.exercises.push({
      name: 'Unplanned extra exercise',
      order: 2,
      setPlanIsFinite: false,
      sets: [{ order: 1, reps: 8 }],
    })
    assert.equal(
      hasFiniteLiveWorkoutPlan(legacyRoutineWithTargetlessExercise),
      false,
    )
  })

  test('validates live mutation coordinates and direct-usecase selectors', () => {
    assert.throws(
      () => normalizeLiveWorkoutId(undefined),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'invalid_option',
    )
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
