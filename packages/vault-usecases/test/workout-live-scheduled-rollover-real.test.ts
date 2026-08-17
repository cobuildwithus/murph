import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { workoutSessionSchema } from '@murphai/contracts'
import { initializeVault } from '@murphai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({
  failAfterPreviousClose: false,
  failAfterScheduledLog: false,
  failAfterScheduledStart: false,
}))

vi.mock('../src/usecases/workout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/usecases/workout.js')>()
  return {
    ...actual,
    addStructuredWorkoutRecord: vi.fn(async (input) => {
      const result = await actual.addStructuredWorkoutRecord(input)
      if (
        faults.failAfterScheduledStart &&
        input.draft.workout?.startedAt === SCHEDULED_OCCURRENCE_AT &&
        input.draft.workout.lastMemberActionId !== undefined
      ) {
        faults.failAfterScheduledStart = false
        throw new Error('injected failure after scheduled workout start')
      }
      return result
    }),
    editWorkoutRecord: vi.fn(async (input) => {
      const result = await actual.editWorkoutRecord(input)
      if (
        faults.failAfterPreviousClose &&
        input.set?.some((entry) => entry.startsWith('workout.endedAt=')) &&
        input.set.some((entry) => entry.startsWith('workout.lastMemberActionId='))
      ) {
        faults.failAfterPreviousClose = false
        throw new Error('injected failure after prior workout close')
      }
      if (
        faults.failAfterScheduledLog &&
        input.set?.some((entry) => entry.startsWith('workout.exercises=')) &&
        input.set.some((entry) => entry.startsWith('workout.lastMemberActionId='))
      ) {
        faults.failAfterScheduledLog = false
        throw new Error('injected failure after scheduled set log')
      }
      return result
    }),
  }
})

import {
  addStructuredWorkoutRecord,
  logLiveWorkoutSet,
  logScheduledLiveWorkoutSet,
  saveWorkoutFormat,
  showActiveLiveWorkout,
  showWorkoutFormat,
  showWorkoutRecord,
  startLiveWorkout,
} from '../src/workouts.js'
import { parseShownWorkout } from '../src/usecases/workout-live-state.js'

const PRIOR_STARTED_AT = '2026-08-16T18:00:00.000Z'
const PRIOR_FINAL_ACTIVITY_AT = '2026-08-16T18:42:00.000Z'
const SCHEDULED_OCCURRENCE_AT = '2026-08-17T18:00:00.000Z'
const REMINDER_SENT_AT = '2026-08-17T18:00:05.000Z'
const ACCEPTED_AT = '2026-08-17T18:07:00.000Z'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  faults.failAfterPreviousClose = false
  faults.failAfterScheduledLog = false
  faults.failAfterScheduledStart = false
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true }),
    ),
  )
})

interface PreparedRolloverVault {
  nextRoutineId: string
  previousWorkoutId: string
  vault: string
}

async function createRolloverVault(input: {
  logAllPriorSets?: boolean
} = {}): Promise<PreparedRolloverVault> {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-workout-rollover-'))
  cleanupPaths.push(vault)
  await initializeVault({
    createdAt: '2026-08-16T17:00:00.000Z',
    timezone: 'UTC',
    vaultRoot: vault,
  })

  await saveWorkoutFormat({
    payload: {
      activityType: 'strength-training',
      status: 'active',
      template: {
        exercises: [{
          mode: 'weight_reps',
          name: 'Split squat',
          note: 'Keep the rear knee controlled.',
          order: 1,
          plannedSets: [
            {
              order: 1,
              targetReps: 10,
              targetWeight: 35,
              targetWeightUnit: 'lb',
              type: 'warmup',
            },
            {
              order: 2,
              targetReps: 8,
              targetWeight: 45,
              targetWeightUnit: 'lb',
            },
          ],
          sourceExerciseId: 'exercise-prior-split-squat',
          unitOverride: 'lb',
        }],
        routineNote: 'Prior routine note.',
      },
      title: 'Prior Routine',
    },
    vault,
  })
  await saveWorkoutFormat({
    payload: {
      activityType: 'strength-training',
      status: 'active',
      template: {
        exercises: [
          {
            mode: 'weight_reps',
            name: 'Chest-supported row',
            order: 1,
            plannedSets: [
              {
                order: 1,
                targetReps: 12,
                targetWeight: 60,
                targetWeightUnit: 'lb',
                type: 'warmup',
              },
              {
                order: 2,
                targetReps: 9,
                targetWeight: 70,
                targetWeightUnit: 'lb',
              },
            ],
            sourceExerciseId: 'exercise-next-row',
            unitOverride: 'lb',
          },
          {
            mode: 'bodyweight',
            name: 'Push-up',
            order: 2,
            plannedSets: [{ order: 1, targetReps: 15 }],
            sourceExerciseId: 'exercise-next-push-up',
          },
        ],
        routineNote: 'Next routine note.',
      },
      title: 'Next Routine',
    },
    vault,
  })

  const priorRoutine = await showWorkoutFormat(vault, 'prior-routine')
  const nextRoutine = await showWorkoutFormat(vault, 'next-routine')
  const started = await startLiveWorkout({
    note: 'Preserve this prior session note.',
    routine: priorRoutine.entity.data.workoutFormatId,
    startedAt: PRIOR_STARTED_AT,
    vault,
  })

  vi.useFakeTimers()
  vi.setSystemTime(PRIOR_FINAL_ACTIVITY_AT)
  await logLiveWorkoutSet({
    exerciseOrder: 1,
    note: 'Warmup felt smooth.',
    reps: 10,
    requireExistingSet: true,
    setOrder: 1,
    type: 'warmup',
    vault,
    weight: 35,
    weightUnit: 'lb',
    workoutId: started.eventId,
  })
  if (input.logAllPriorSets !== false) {
    await logLiveWorkoutSet({
      exerciseOrder: 1,
      note: 'Last rep was controlled.',
      reps: 8,
      requireExistingSet: true,
      rpe: 8,
      setOrder: 2,
      vault,
      weight: 45,
      weightUnit: 'lb',
      workoutId: started.eventId,
    })
  }

  return {
    nextRoutineId: nextRoutine.entity.data.workoutFormatId,
    previousWorkoutId: started.eventId,
    vault,
  }
}

function scheduledInput(input: PreparedRolloverVault) {
  return {
    acceptedAt: ACCEPTED_AT,
    exerciseName: 'Chest-supported row',
    exerciseOrder: 1,
    previousWorkoutId: input.previousWorkoutId,
    reminderSentAt: REMINDER_SENT_AT,
    reps: 9,
    routineId: input.nextRoutineId,
    scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
    setOrder: 2,
    type: 'failure' as const,
    vault: input.vault,
    weight: 70,
    weightUnit: 'lb' as const,
  }
}

describe('scheduled live-workout rollover', () => {
  it('preserves and truthfully closes the prior session, starts the exact plan, and converges across persisted failures', async () => {
    const prepared = await createRolloverVault()
    const before = await showWorkoutRecord(
      prepared.vault,
      prepared.previousWorkoutId,
    )
    const beforeWorkout = parseShownWorkout(before)

    faults.failAfterPreviousClose = true
    await expect(logScheduledLiveWorkoutSet(scheduledInput(prepared))).rejects.toThrow(
      'injected failure after prior workout close',
    )
    const afterCloseFailure = parseShownWorkout(
      await showWorkoutRecord(prepared.vault, prepared.previousWorkoutId),
    )
    expect(afterCloseFailure.endedAt).toBe(PRIOR_FINAL_ACTIVITY_AT)
    expect(afterCloseFailure.lastMemberActionId).toEqual(expect.any(String))
    const previousActionMarker = afterCloseFailure.lastMemberActionId
    await expect(showActiveLiveWorkout({ vault: prepared.vault })).rejects.toThrow(
      'No active live workout',
    )

    faults.failAfterScheduledStart = true
    await expect(logScheduledLiveWorkoutSet(scheduledInput(prepared))).rejects.toThrow(
      'injected failure after scheduled workout start',
    )

    const afterStartFailure = await showActiveLiveWorkout({
      vault: prepared.vault,
    })
    const startedWorkoutId = afterStartFailure.entity.id
    const startedWorkout = parseShownWorkout(afterStartFailure)
    expect(startedWorkout.startedAt).toBe(SCHEDULED_OCCURRENCE_AT)
    expect(startedWorkout.routineId).toBe(prepared.nextRoutineId)
    expect(startedWorkout.lastMemberActionId).toEqual(expect.any(String))
    expect(startedWorkout.lastMemberActionId).not.toBe(previousActionMarker)
    expect(startedWorkout.exercises[0]?.sets[1]).toEqual({ order: 2 })

    faults.failAfterScheduledLog = true
    await expect(logScheduledLiveWorkoutSet(scheduledInput(prepared))).rejects.toThrow(
      'injected failure after scheduled set log',
    )

    const afterLogFailure = await showActiveLiveWorkout({
      vault: prepared.vault,
      workoutId: startedWorkoutId,
    })
    expect(parseShownWorkout(afterLogFailure).exercises).toEqual([
      {
        mode: 'weight_reps',
        name: 'Chest-supported row',
        order: 1,
        sets: [
          { order: 1, type: 'warmup' },
          {
            order: 2,
            reps: 9,
            type: 'failure',
            weight: 70,
            weightUnit: 'lb',
          },
        ],
        sourceExerciseId: 'exercise-next-row',
        unitOverride: 'lb',
      },
      {
        mode: 'bodyweight',
        name: 'Push-up',
        order: 2,
        sets: [{ order: 1 }],
        sourceExerciseId: 'exercise-next-push-up',
      },
    ])
    expect(afterLogFailure.entity.data.durationMinutes).toBe(7)

    const converged = await logScheduledLiveWorkoutSet(scheduledInput(prepared))
    const replayed = await logScheduledLiveWorkoutSet(scheduledInput(prepared))
    expect(converged.entity.id).toBe(startedWorkoutId)
    expect(replayed.entity.id).toBe(startedWorkoutId)

    const previous = await showWorkoutRecord(
      prepared.vault,
      prepared.previousWorkoutId,
    )
    const previousWorkout = parseShownWorkout(previous)
    expect(previous.entity.id).toBe(prepared.previousWorkoutId)
    expect(previousWorkout.endedAt).toBe(PRIOR_FINAL_ACTIVITY_AT)
    expect(previous.entity.data.durationMinutes).toBe(42)
    expect(previousWorkout.exercises).toEqual(beforeWorkout.exercises)
    expect(previousWorkout.routineId).toBe(beforeWorkout.routineId)
    expect(previousWorkout.routineName).toBe(beforeWorkout.routineName)
    expect(previousWorkout.sessionNote).toBe(beforeWorkout.sessionNote)
  })

  it('refuses pending prior sets, stale authority, missing actuals, ambiguous or mismatched coordinates, and unrelated multiple-active state without retargeting', async () => {
    const pending = await createRolloverVault({ logAllPriorSets: false })
    await expect(logScheduledLiveWorkoutSet(scheduledInput(pending))).rejects.toThrow(
      'pending set coordinates',
    )
    expect(
      parseShownWorkout(
        await showActiveLiveWorkout({
          vault: pending.vault,
          workoutId: pending.previousWorkoutId,
        }),
      ).endedAt,
    ).toBeUndefined()

    const stale = await createRolloverVault()
    await expect(
      logScheduledLiveWorkoutSet({
        ...scheduledInput(stale),
        acceptedAt: '2026-08-17T19:00:06.000Z',
      }),
    ).rejects.toThrow('stale or out of order')
    expect(
      parseShownWorkout(
        await showActiveLiveWorkout({
          vault: stale.vault,
          workoutId: stale.previousWorkoutId,
        }),
      ).endedAt,
    ).toBeUndefined()

    const missingActual = await createRolloverVault()
    await expect(
      logScheduledLiveWorkoutSet({
        ...scheduledInput(missingActual),
        note: 'Member supplied only a note.',
        reps: undefined,
        weight: undefined,
        weightUnit: undefined,
      }),
    ).rejects.toThrow('member-stated actual set result')
    expect(
      parseShownWorkout(
        await showActiveLiveWorkout({
          vault: missingActual.vault,
          workoutId: missingActual.previousWorkoutId,
        }),
      ).endedAt,
    ).toBeUndefined()

    const mismatched = await createRolloverVault()
    await expect(
      logScheduledLiveWorkoutSet({
        ...scheduledInput(mismatched),
        exerciseName: 'Push-up',
      }),
    ).rejects.toThrow('No matching workout exercise')
    expect(
      parseShownWorkout(
        await showActiveLiveWorkout({
          vault: mismatched.vault,
          workoutId: mismatched.previousWorkoutId,
        }),
      ).endedAt,
    ).toBeUndefined()

    const ambiguous = await createRolloverVault()
    await saveWorkoutFormat({
      payload: {
        activityType: 'strength-training',
        status: 'active',
        template: {
          exercises: [{
            name: 'Ambiguous row',
            order: 1,
            plannedSets: [{ order: 1 }, { order: 1 }],
          }],
        },
        title: 'Ambiguous Scheduled Routine',
      },
      vault: ambiguous.vault,
    })
    const ambiguousRoutine = await showWorkoutFormat(
      ambiguous.vault,
      'ambiguous-scheduled-routine',
    )
    await expect(
      logScheduledLiveWorkoutSet({
        ...scheduledInput(ambiguous),
        exerciseName: 'Ambiguous row',
        routineId: ambiguousRoutine.entity.data.workoutFormatId,
        setOrder: 1,
      }),
    ).rejects.toThrow('duplicate set order')
    expect(
      parseShownWorkout(
        await showActiveLiveWorkout({
          vault: ambiguous.vault,
          workoutId: ambiguous.previousWorkoutId,
        }),
      ).endedAt,
    ).toBeUndefined()

    const multiple = await createRolloverVault()
    await addStructuredWorkoutRecord({
      draft: {
        activityType: 'strength-training',
        durationMinutes: 5,
        note: 'Synthetic unrelated active workout.',
        occurredAt: '2026-08-17T17:00:00.000Z',
        source: 'manual',
        title: 'Synthetic unrelated active workout',
        workout: workoutSessionSchema.parse({
          exercises: [{
            mode: 'bodyweight',
            name: 'Air squat',
            order: 1,
            sets: [{ order: 1, reps: 10 }],
          }],
          sourceApp: 'murph-live',
          startedAt: '2026-08-17T17:00:00.000Z',
        }),
      },
      vault: multiple.vault,
    })
    await expect(logScheduledLiveWorkoutSet(scheduledInput(multiple))).rejects.toThrow(
      'Multiple active live workouts',
    )
    const priorAfterMultiple = await showWorkoutRecord(
      multiple.vault,
      multiple.previousWorkoutId,
    )
    expect(parseShownWorkout(priorAfterMultiple).endedAt).toBeUndefined()
  })
})
