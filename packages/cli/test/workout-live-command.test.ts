import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'

import { Cli } from 'incur'
import { afterAll } from 'vitest'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import {
  addLiveWorkoutExercise,
  clearLiveWorkoutSet,
  saveWorkoutFormat,
  showActiveLiveWorkout,
  startLiveWorkout,
} from '@murphai/vault-usecases/workouts'

import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWorkoutCommands } from '../src/commands/workout.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'

const cleanupPaths: string[] = []

afterAll(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  )
})

function createWorkoutCli() {
  const cli = Cli.create('vault-cli', {
    description: 'live workout test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerWorkoutCommands(cli, services)
  return cli
}

async function run<T>(cli: Cli.Cli, args: string[]) {
  return runInProcessJsonCli<T>(cli, args, { env: process.env })
}

function isVaultCliErrorCode(error: unknown, code: string): boolean {
  return error instanceof VaultCliError && error.code === code
}

interface WorkoutResult {
  eventId: string
  activityType: string
  distanceKm: number | null
  note: string
  workout: {
    sourceApp?: string
    endedAt?: string
    sessionNote?: string
    exercises: Array<{
      name: string
      sourceExerciseId?: string
      order: number
      sets: Array<Record<string, unknown>>
    }>
  } | null
}

interface ShowResult {
  entity: {
    id: string
    data: {
      durationMinutes?: number
      workout: NonNullable<WorkoutResult['workout']>
    }
  }
}

test('live workout commands keep one canonical session and target one set', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'America/New_York',
  ])
  assert.equal(requireData(initialized.envelope).created, true)

  const saved = await run<{ slug: string }>(cli, [
    'workout', 'format', 'save', 'Push Day',
    '--vault', vaultRoot,
    '--type', 'strength-training',
    '--duration', '45',
    '--distance-km', '5',
    '--routine-note', 'Keep the tempo controlled.',
    '--template-text', 'Planned 5 km cooldown after lifting.',
    '--exercise',
    'order=1;name=Bench press;sourceExerciseId=EX123;mode=weight_reps;unitOverride=lb',
    '--set-template',
    'exercise=1;order=1;type=warmup;targetReps=10;targetWeight=95;targetWeightUnit=lb',
    '--set-template',
    'exercise=1;order=2;targetReps=8;targetWeight=135;targetWeightUnit=lb',
  ])
  assert.equal(requireData(saved.envelope).slug, 'push-day')

  const started = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start',
    '--routine', 'push-day',
    '--type', 'Strength Training',
    '--started-at', '2026-08-09T18:00:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(started.activityType, 'strength-training')
  assert.equal(started.workout?.sourceApp, 'murph-live')
  assert.equal(started.workout?.sessionNote, 'Keep the tempo controlled.')
  assert.equal(started.note, 'Push Day')
  assert.equal(started.distanceKm, null)
  assert.deepEqual(started.workout?.exercises[0]?.sets, [
    { order: 1, type: 'warmup' },
    { order: 2 },
  ])
  const workoutId = started.eventId

  const duplicateStart = await run(cli, [
    'workout', 'start', 'Another workout', '--vault', vaultRoot,
  ])
  assert.equal(duplicateStart.envelope.ok, false)

  const logArgs = [
    'workout', 'set', 'log', 'Bench press',
    '--workout-id', workoutId,
    '--set-order', '2',
    '--reps', '8',
    '--weight', '135',
    '--weight-unit', 'lb',
    '--rpe', '7',
    '--note', 'final rep spotted',
    '--vault', vaultRoot,
  ]
  const logged = requireData((await run<ShowResult>(cli, logArgs)).envelope)
  assert.deepEqual(logged.entity.data.workout.exercises[0]?.sets[1], {
    order: 2,
    note: 'final rep spotted',
    reps: 8,
    weight: 135,
    weightUnit: 'lb',
    rpe: 7,
  })

  const retried = requireData((await run<ShowResult>(cli, logArgs)).envelope)
  assert.equal(retried.entity.data.workout.exercises[0]?.sets.length, 2)

  const added = requireData((await run<ShowResult>(cli, [
    'workout', 'exercise', 'add', 'Cable fly',
    '--workout-id', workoutId,
    '--order', '2',
    '--sets', '2',
    '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(added.entity.data.workout.exercises[1], {
    name: 'Cable fly',
    order: 2,
    sets: [{ order: 1 }, { order: 2 }],
  })

  const cleared = requireData((await run<ShowResult>(cli, [
    'workout', 'set', 'clear', 'Bench press',
    '--workout-id', workoutId,
    '--set-order', '2',
    '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(cleared.entity.data.workout.exercises[0]?.sets[1], {
    order: 2,
  })

  const finishArgs = [
    'workout', 'finish',
    '--workout-id', workoutId,
    '--ended-at', '2026-08-09T18:45:00.000Z',
    '--vault', vaultRoot,
  ]
  const finished = requireData((await run<ShowResult>(cli, finishArgs)).envelope)
  assert.equal(
    finished.entity.data.workout.endedAt,
    '2026-08-09T18:45:00.000Z',
  )
  assert.equal(finished.entity.data.durationMinutes, 45)

  const finishRetry = requireData(
    (await run<ShowResult>(cli, finishArgs)).envelope,
  )
  assert.equal(
    finishRetry.entity.data.workout.endedAt,
    '2026-08-09T18:45:00.000Z',
  )
  assert.equal(finishRetry.entity.data.durationMinutes, 45)

  const noActive = await run(cli, [
    'workout', 'active', '--vault', vaultRoot,
  ])
  assert.equal(noActive.envelope.ok, false)
})

test('live workout usecases fail closed on invalid selectors and coordinates', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-boundary-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'America/New_York',
  ])
  assert.equal(requireData(initialized.envelope).created, true)

  await assert.rejects(
    () => startLiveWorkout({ vault: vaultRoot, routine: '' }),
    (error: unknown) => isVaultCliErrorCode(error, 'invalid_option'),
  )

  await saveWorkoutFormat({
    vault: vaultRoot,
    payload: {
      title: 'Broken Routine',
      status: 'active',
      activityType: 'strength-training',
      template: {
        exercises: [
          {
            name: 'Bench press',
            order: 1,
            plannedSets: [
              { order: 1, targetReps: 8 },
              { order: 1, targetReps: 6 },
            ],
          },
        ],
      },
    },
  })
  await assert.rejects(
    () => startLiveWorkout({ vault: vaultRoot, routine: 'broken-routine' }),
    (error: unknown) => isVaultCliErrorCode(error, 'contract_invalid'),
  )

  const started = await startLiveWorkout({
    vault: vaultRoot,
    name: 'Boundary workout',
    startedAt: '2026-08-09T18:00:00.000Z',
  })
  await assert.rejects(
    () => showActiveLiveWorkout({ vault: vaultRoot, workoutId: '' }),
    (error: unknown) => isVaultCliErrorCode(error, 'invalid_option'),
  )

  await addLiveWorkoutExercise({
    vault: vaultRoot,
    workoutId: started.eventId,
    name: 'Bench press',
    order: 1,
  })
  await assert.rejects(
    () =>
      clearLiveWorkoutSet({
        vault: vaultRoot,
        workoutId: started.eventId,
        exerciseOrder: 1,
        setOrder: 0,
      }),
    (error: unknown) => isVaultCliErrorCode(error, 'invalid_option'),
  )
})

test('concurrent live workout commands serialize without losing set updates', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-concurrent-',
  )
  cleanupPaths.push(parentRoot)

  const setupCli = createWorkoutCli()
  const initialized = await run<{ created: boolean }>(setupCli, [
    'init', '--vault', vaultRoot, '--timezone', 'America/New_York',
  ])
  assert.equal(requireData(initialized.envelope).created, true)

  const startResults = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      run<WorkoutResult>(createWorkoutCli(), [
        'workout', 'start', `Concurrent workout ${index + 1}`,
        '--started-at', '2026-08-09T18:00:00.000Z',
        '--vault', vaultRoot,
      ]),
    ),
  )
  const successfulStarts = startResults.filter(
    (result) => result.envelope.ok,
  )
  assert.equal(successfulStarts.length, 1)
  const workoutId = requireData(successfulStarts[0]!.envelope).eventId

  const added = requireData((await run<ShowResult>(setupCli, [
    'workout', 'exercise', 'add', 'Bench press',
    '--workout-id', workoutId,
    '--order', '1',
    '--sets', '4',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(added.entity.data.workout.exercises[0]?.sets.length, 4)

  const loggedSets = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      run<ShowResult>(createWorkoutCli(), [
        'workout', 'set', 'log',
        '--workout-id', workoutId,
        '--exercise-order', '1',
        '--set-order', String(index + 1),
        '--reps', String(8 - index),
        '--weight', String(135 + index * 10),
        '--weight-unit', 'lb',
        '--vault', vaultRoot,
      ]),
    ),
  )
  assert.equal(
    loggedSets.filter((result) => result.envelope.ok).length,
    loggedSets.length,
  )

  const active = requireData((await run<ShowResult>(setupCli, [
    'workout', 'active',
    '--workout-id', workoutId,
    '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(active.entity.data.workout.exercises[0]?.sets, [
    { order: 1, reps: 8, weight: 135, weightUnit: 'lb' },
    { order: 2, reps: 7, weight: 145, weightUnit: 'lb' },
    { order: 3, reps: 6, weight: 155, weightUnit: 'lb' },
    { order: 4, reps: 5, weight: 165, weightUnit: 'lb' },
  ])

  const finished = requireData((await run<ShowResult>(setupCli, [
    'workout', 'finish',
    '--workout-id', workoutId,
    '--ended-at', '2026-08-09T19:00:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(finished.entity.data.durationMinutes, 60)
})
