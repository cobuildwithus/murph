import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'

import { Cli } from 'incur'
import { afterEach } from 'vitest'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

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

afterEach(async () => {
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

interface WorkoutResult {
  eventId: string
  workout: {
    sourceApp?: string
    endedAt?: string
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
    '--started-at', '2026-08-09T18:00:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(started.workout?.sourceApp, 'murph-live')
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

  const finished = requireData((await run<ShowResult>(cli, [
    'workout', 'finish',
    '--workout-id', workoutId,
    '--ended-at', '2026-08-09T18:45:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(
    finished.entity.data.workout.endedAt,
    '2026-08-09T18:45:00.000Z',
  )
  assert.equal(finished.entity.data.durationMinutes, 45)

  const noActive = await run(cli, [
    'workout', 'active', '--vault', vaultRoot,
  ])
  assert.equal(noActive.envelope.ok, false)
})
