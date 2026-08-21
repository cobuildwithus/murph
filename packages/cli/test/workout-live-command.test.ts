import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterAll } from 'vitest'
import { workoutSessionSchema } from '@murphai/contracts'
import {
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import {
  addLiveWorkoutExercise,
  clearLiveWorkoutSet,
  logLiveWorkoutSet,
  saveWorkoutFormat,
  setLiveWorkoutExerciseReps,
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
  created: boolean
  eventId: string
  ledgerFile: string
  activityType: string
  distanceKm: number | null
  note: string
  workout: {
    sourceApp?: string
    endedAt?: string
    sessionNote?: string
    exercises: Array<{
      groupId?: string
      memberRepsPerSet?: number
      mode?: string
      name: string
      note?: string
      sourceExerciseId?: string
      order: number
      setPlanIsFinite?: boolean
      sets: Array<Record<string, unknown>>
      unitOverride?: string
    }>
  } | null
}

interface ShowResult {
  entity: {
    id: string
    data: {
      durationMinutes?: number
      lifecycle?: {
        revision?: number
        state?: string
      }
      workout: NonNullable<WorkoutResult['workout']>
    }
  }
}

function requireShownRevision(shown: ShowResult): number {
  const revision = shown.entity.data.lifecycle?.revision
  assert.equal(typeof revision, 'number')
  return revision!
}

async function removeStoredLifecycle(
  vaultRoot: string,
  workout: Pick<WorkoutResult, 'eventId' | 'ledgerFile'>,
): Promise<void> {
  const ledgerPath = path.join(vaultRoot, workout.ledgerFile)
  const records = (await readFile(ledgerPath, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  let removed = false

  for (const record of records) {
    if (record.id === workout.eventId) {
      delete record.lifecycle
      removed = true
    }
  }
  assert.equal(removed, true)
  await writeFile(
    ledgerPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  )
}

test('live workout commands target exact records without a global active singleton', async () => {
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
  assert.deepEqual(started.workout?.exercises[0], {
    name: 'Bench press',
    sourceExerciseId: 'EX123',
    order: 1,
    mode: 'weight_reps',
    unitOverride: 'lb',
    setPlanIsFinite: true,
    sets: [{ order: 1, type: 'warmup' }, { order: 2 }],
  })
  const workoutId = started.eventId

  const overlapping = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Another workout', '--vault', vaultRoot,
  ])).envelope)
  assert.notEqual(overlapping.eventId, workoutId)
  assert.equal(overlapping.workout?.endedAt, undefined)

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
  assert.equal(logged.entity.data.workout.endedAt, undefined)

  const retried = requireData((await run<ShowResult>(cli, logArgs)).envelope)
  assert.equal(retried.entity.data.workout.exercises[0]?.sets.length, 2)

  const staleCardLog = await run<ShowResult>(cli, [
    'workout', 'set', 'log', 'Bench press',
    '--workout-id', workoutId,
    '--set-order', '3',
    '--require-existing-set',
    '--reps', '8',
    '--vault', vaultRoot,
  ])
  assert.equal(staleCardLog.envelope.ok, false)

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
    setPlanIsFinite: true,
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

  const shownOther = requireData((await run<ShowResult>(cli, [
    'workout', 'show', overlapping.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(shownOther.entity.data.workout.endedAt, undefined)
})

test('workout start writes one complete ordered exercise batch in one canonical creation', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-batch-start-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  assert.equal(requireData((await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'America/Chicago',
  ])).envelope).created, true)
  const otherWorkout = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Unrelated workout',
    '--started-at', '2026-08-20T06:45:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  const persisted: HostedCanonicalWritePersistenceInput[] = []

  const started = requireData((await withHostedCanonicalWritePort(
    {
      async persistCanonicalWrite(input) {
        persisted.push(input)
      },
    },
    () => run<WorkoutResult>(cli, [
      'workout', 'start', 'Ordered blocks',
      '--exercise',
      'name=Run;sets=1;reps=5;sourceExerciseId=run-cardio;groupId=block-a;mode=cardio;note=Easy pace',
      '--exercise',
      'name=Row, neutral grip;sets=2;reps=10;mode=weight_reps;unitOverride=lb',
      '--exercise',
      'name=Run;reps=7;mode=cardio;note=Finish, controlled',
      '--vault', vaultRoot,
    ]),
  )).envelope)

  assert.equal(persisted.length, 1)
  assert.deepEqual(started.workout?.exercises, [
    {
      name: 'Run',
      sourceExerciseId: 'run-cardio',
      order: 1,
      groupId: 'block-a',
      mode: 'cardio',
      note: 'Easy pace',
      memberRepsPerSet: 5,
      setPlanIsFinite: true,
      sets: [{ order: 1 }],
    },
    {
      name: 'Row, neutral grip',
      order: 2,
      mode: 'weight_reps',
      unitOverride: 'lb',
      memberRepsPerSet: 10,
      setPlanIsFinite: true,
      sets: [{ order: 1 }, { order: 2 }],
    },
    {
      name: 'Run',
      order: 3,
      mode: 'cardio',
      note: 'Finish, controlled',
      memberRepsPerSet: 7,
      setPlanIsFinite: false,
      sets: [{ order: 1 }],
    },
  ])

  const terseCompletion = requireData((await run<ShowResult>(cli, [
    'workout', 'set', 'log', 'Row, neutral grip',
    '--workout-id', started.eventId,
    '--exercise-order', '2',
    '--set-order', '1',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(
    terseCompletion.entity.data.workout.exercises[1]?.sets[0]?.reps,
    10,
  )
  const otherStillOpen = requireData((await run<ShowResult>(cli, [
    'workout', 'show', otherWorkout.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(otherStillOpen.entity.data.workout.endedAt, undefined)
})

test('legacy workouts expose effective revision one for guarded replacement deletion', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-legacy-revision-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  assert.equal(requireData((await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])).envelope).created, true)
  const unrelated = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Unrelated workout', '--vault', vaultRoot,
  ])).envelope)

  const approved = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Legacy approved workout', '--vault', vaultRoot,
  ])).envelope)
  await removeStoredLifecycle(vaultRoot, approved)
  const approvedRead = requireData((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(requireShownRevision(approvedRead), 1)

  const replacement = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Verified replacement',
    '--exercise', 'name=Pull-up;sets=2;reps=10;mode=bodyweight',
    '--exercise', 'name=Press;sets=3;reps=8;mode=weight_reps',
    '--vault', vaultRoot,
  ])).envelope)
  const verifiedReplacement = requireData((await run<ShowResult>(cli, [
    'workout', 'show', replacement.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(
    verifiedReplacement.entity.data.workout.exercises.map((exercise) => exercise.name),
    ['Pull-up', 'Press'],
  )
  assert.equal(requireData((await run<{ deleted: true }>(cli, [
    'workout', 'delete', approved.eventId,
    '--expected-revision', String(requireShownRevision(approvedRead)),
    '--vault', vaultRoot,
  ])).envelope).deleted, true)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope.ok, false)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', replacement.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', unrelated.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)

  const staleApproved = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Legacy stale workout', '--vault', vaultRoot,
  ])).envelope)
  await removeStoredLifecycle(vaultRoot, staleApproved)
  const staleApprovedRead = requireData((await run<ShowResult>(cli, [
    'workout', 'show', staleApproved.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(requireShownRevision(staleApprovedRead), 1)
  const retainedReplacement = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Retained replacement',
    '--exercise', 'name=Row;sets=2;reps=12;mode=weight_reps',
    '--vault', vaultRoot,
  ])).envelope)
  await addLiveWorkoutExercise({
    vault: vaultRoot,
    workoutId: staleApproved.eventId,
    name: 'Concurrent correction',
    order: 1,
    setCount: 1,
  })

  const conflict = await run<{ deleted: true }>(cli, [
    'workout', 'delete', staleApproved.eventId,
    '--expected-revision', String(requireShownRevision(staleApprovedRead)),
    '--vault', vaultRoot,
  ])
  assert.equal(conflict.envelope.ok, false)
  if (conflict.envelope.ok) {
    throw new Error('Expected guarded legacy workout deletion to conflict.')
  }
  assert.equal(conflict.envelope.error.code, 'conflict')
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', staleApproved.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', retainedReplacement.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)
})

test('create-first replacement deletes only the exact approved workout revision', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-create-first-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  assert.equal(requireData((await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])).envelope).created, true)
  const approved = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Approved workout', '--vault', vaultRoot,
  ])).envelope)
  const otherWorkout = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Another unfinished workout', '--vault', vaultRoot,
  ])).envelope)
  const proposal = requireData((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope)

  const replacement = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Replacement workout',
    '--exercise', 'name=Pull-up;sets=2;reps=10;mode=bodyweight',
    '--exercise', 'name=Press;sets=3;reps=8;mode=weight_reps',
    '--vault', vaultRoot,
  ])).envelope)
  const verifiedReplacement = requireData((await run<ShowResult>(cli, [
    'workout', 'show', replacement.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(
    verifiedReplacement.entity.data.workout.exercises.map((exercise) => exercise.name),
    ['Pull-up', 'Press'],
  )

  const deleted = requireData((await run<{ deleted: true }>(cli, [
    'workout', 'delete', approved.eventId,
    '--expected-revision', String(requireShownRevision(proposal)),
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(deleted.deleted, true)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope.ok, false)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', replacement.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)
  const otherStillOpen = requireData((await run<ShowResult>(cli, [
    'workout', 'show', otherWorkout.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(otherStillOpen.entity.data.workout.endedAt, undefined)
})

test('failed creation and stale guarded deletion preserve every workout', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-create-first-failure-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  assert.equal(requireData((await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])).envelope).created, true)
  const approved = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Approved workout', '--vault', vaultRoot,
  ])).envelope)
  const proposal = requireData((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope)
  const proposalRevision = requireShownRevision(proposal)
  const persisted: HostedCanonicalWritePersistenceInput[] = []

  const invalidExerciseSpecs = [
    'name=Pull-up;sets=3;reps=0',
    'name=Pull-up;sets=3;reps=1000',
    'name=Pull-up;sets=3;reps=8-10',
    'name=Pull-up;sets=3;reps=AMRAP',
    'name=Pull-up;sets=0;reps=10',
    'name=Pull-up;sets=151;reps=10',
    'name=Pull-up;sets=1.5;reps=10',
  ]
  for (const exerciseSpec of invalidExerciseSpecs) {
    const rejected = await withHostedCanonicalWritePort(
      {
        async persistCanonicalWrite(input) {
          persisted.push(input)
        },
      },
      () => run<WorkoutResult>(cli, [
        'workout', 'start', 'Invalid replacement',
        '--exercise', exerciseSpec,
        '--vault', vaultRoot,
      ]),
    )
    assert.equal(rejected.envelope.ok, false)
  }
  assert.equal(persisted.length, 0)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)

  const replacement = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Verified replacement',
    '--exercise', 'name=Pull-up;sets=2;reps=10;mode=bodyweight',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', replacement.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)

  await addLiveWorkoutExercise({
    vault: vaultRoot,
    workoutId: approved.eventId,
    name: 'Late correction',
    order: 1,
    setCount: 1,
  })
  const conflict = await run<{ deleted: true }>(cli, [
    'workout', 'delete', approved.eventId,
    '--expected-revision', String(proposalRevision),
    '--vault', vaultRoot,
  ])
  assert.equal(conflict.envelope.ok, false)
  if (conflict.envelope.ok) {
    throw new Error('Expected stale workout deletion to conflict.')
  }
  assert.equal(conflict.envelope.error.code, 'conflict')

  const preservedApproved = requireData((await run<ShowResult>(cli, [
    'workout', 'show', approved.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(
    preservedApproved.entity.data.workout.exercises[0]?.name,
    'Late correction',
  )
  assert.equal((await run<ShowResult>(cli, [
    'workout', 'show', replacement.eventId, '--vault', vaultRoot,
  ])).envelope.ok, true)
})

test('live workout usecases fail closed on missing exact selectors and coordinates', async () => {
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

  await assert.rejects(
    () =>
      startLiveWorkout({
        vault: vaultRoot,
        routine: 'saved-routine',
        exercises: [{ name: 'Bench press' }],
      }),
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

  const targetless = await addLiveWorkoutExercise({
    vault: vaultRoot,
    workoutId: started.eventId,
    name: 'Bench press',
    order: 1,
  })
  const targetlessWorkout = workoutSessionSchema.parse(
    targetless.entity.data.workout,
  )
  assert.equal(
    targetlessWorkout.exercises[0]?.setPlanIsFinite,
    false,
  )
  await assert.rejects(
    () =>
      logLiveWorkoutSet({
        vault: vaultRoot,
        workoutId: started.eventId,
        exerciseOrder: 1,
        setOrder: 2,
        requireExistingSet: true,
        reps: 8,
      }),
    (error: unknown) => isVaultCliErrorCode(error, 'not_found'),
  )
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
  await assert.rejects(
    () =>
      setLiveWorkoutExerciseReps({
        vault: vaultRoot,
        workoutId: started.eventId,
        exerciseOrder: 1,
        reps: 8,
        clear: true,
      }),
    (error: unknown) => isVaultCliErrorCode(error, 'invalid_option'),
  )
})

test('clearing fixed exercise repetitions stops value-less set logging', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-clear-reps-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createWorkoutCli()
  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'America/New_York',
  ])
  assert.equal(requireData(initialized.envelope).created, true)

  const started = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Clear repetition rule', '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(cli, [
    'workout', 'exercise', 'add', 'Bench press',
    '--workout-id', started.eventId,
    '--order', '1',
    '--sets', '1',
    '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(cli, [
    'workout', 'exercise', 'set-reps', 'Bench press',
    '--workout-id', started.eventId,
    '--exercise-order', '1',
    '--reps', '9',
    '--vault', vaultRoot,
  ])).envelope)

  const cleared = requireData((await run<ShowResult>(cli, [
    'workout', 'exercise', 'set-reps', 'Bench press',
    '--workout-id', started.eventId,
    '--exercise-order', '1',
    '--clear',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(
    cleared.entity.data.workout.exercises[0]?.memberRepsPerSet,
    undefined,
  )

  const rejected = await run<ShowResult>(cli, [
    'workout', 'set', 'log', 'Bench press',
    '--workout-id', started.eventId,
    '--exercise-order', '1',
    '--set-order', '1',
    '--vault', vaultRoot,
  ])
  assert.equal(rejected.envelope.ok, false)
  if (rejected.envelope.ok) {
    throw new Error('Expected value-less set logging to fail after clearing repetitions.')
  }
  assert.equal(rejected.envelope.error.code, 'invalid_option')

  const unchanged = requireData((await run<ShowResult>(cli, [
    'workout', 'show', started.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(unchanged.entity.data.workout.exercises[0]?.sets, [
    { order: 1 },
  ])
  assert.equal(unchanged.entity.data.workout.endedAt, undefined)
})

test('concurrent exact-workout mutations serialize without losing set updates', async () => {
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
  assert.equal(
    startResults.filter((result) => result.envelope.ok).length,
    startResults.length,
  )
  const workoutIds = startResults.map(
    (result) => requireData(result.envelope).eventId,
  )
  assert.equal(new Set(workoutIds).size, workoutIds.length)
  const workoutId = workoutIds[0]!

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

  const shown = requireData((await run<ShowResult>(setupCli, [
    'workout', 'show', workoutId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(shown.entity.data.workout.exercises[0]?.sets, [
    { order: 1, reps: 8, weight: 135, weightUnit: 'lb' },
    { order: 2, reps: 7, weight: 145, weightUnit: 'lb' },
    { order: 3, reps: 6, weight: 155, weightUnit: 'lb' },
    { order: 4, reps: 5, weight: 165, weightUnit: 'lb' },
  ])
  assert.equal(typeof shown.entity.data.workout.endedAt, 'string')
})

test('fixed repetitions survive fresh command contexts, close a finite plan, and do not block the next workout', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-sequential-',
  )
  cleanupPaths.push(parentRoot)
  const setupCli = createWorkoutCli()
  const initialized = await run<{ created: boolean }>(setupCli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])
  assert.equal(requireData(initialized.envelope).created, true)

  const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const older = requireData((await run<WorkoutResult>(setupCli, [
    'workout', 'start', 'Older unfinished workout',
    '--started-at', startedAt,
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(older.workout?.endedAt, undefined)

  const finite = requireData((await run<WorkoutResult>(setupCli, [
    'workout', 'start', 'Eight set workout',
    '--started-at', startedAt,
    '--vault', vaultRoot,
  ])).envelope)
  const finiteId = finite.eventId
  requireData((await run<ShowResult>(setupCli, [
    'workout', 'exercise', 'add', 'Seated cable curl',
    '--workout-id', finiteId,
    '--order', '1',
    '--sets', '8',
    '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(setupCli, [
    'workout', 'exercise', 'set-reps', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--reps', '9',
    '--vault', vaultRoot,
  ])).envelope)

  let finalWriteStartedAt = 0
  let finalWriteFinishedAt = 0
  for (let setOrder = 1; setOrder <= 8; setOrder += 1) {
    // A new CLI instance carries no assistant/provider thread state. Exact record
    // identity plus the stored exercise fact are the complete mutation context.
    if (setOrder === 8) finalWriteStartedAt = Date.now()
    const logged = await run<ShowResult>(createWorkoutCli(), [
      'workout', 'set', 'log', 'Seated cable curl',
      '--workout-id', finiteId,
      '--exercise-order', '1',
      '--set-order', String(setOrder),
      '--vault', vaultRoot,
    ])
    assert.equal(logged.envelope.ok, true)
    if (setOrder === 8) finalWriteFinishedAt = Date.now()
  }

  const completed = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', finiteId, '--vault', vaultRoot,
  ])).envelope)
  const completedWorkout = completed.entity.data.workout
  assert.equal(completedWorkout.exercises[0]?.memberRepsPerSet, 9)
  assert.deepEqual(
    completedWorkout.exercises[0]?.sets,
    Array.from({ length: 8 }, (_, index) => ({ order: index + 1, reps: 9 })),
  )
  assert.equal(typeof completedWorkout.endedAt, 'string')
  const completedAt = Date.parse(completedWorkout.endedAt!)
  assert.ok(completedAt >= finalWriteStartedAt)
  assert.ok(completedAt <= finalWriteFinishedAt)

  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'log', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--set-order', '1',
    '--reps', '8',
    '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'log', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--set-order', '1',
    '--note', 'Final rep spotted.',
    '--vault', vaultRoot,
  ])).envelope)
  const annotatedCorrection = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', finiteId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(annotatedCorrection.entity.data.workout.exercises[0]?.sets[0], {
    note: 'Final rep spotted.',
    order: 1,
    reps: 8,
  })
  assert.equal(annotatedCorrection.entity.data.workout.endedAt, completedWorkout.endedAt)

  const next = requireData((await run<WorkoutResult>(createWorkoutCli(), [
    'workout', 'start', 'Next workout',
    '--vault', vaultRoot,
  ])).envelope)
  assert.notEqual(next.eventId, finiteId)
  assert.notEqual(next.eventId, older.eventId)
  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'exercise', 'add', 'Push-up',
    '--workout-id', next.eventId,
    '--order', '1',
    '--sets', '1',
    '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'exercise', 'set-reps', 'Push-up',
    '--workout-id', next.eventId,
    '--exercise-order', '1',
    '--reps', '12',
    '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'log', 'Push-up',
    '--workout-id', next.eventId,
    '--exercise-order', '1',
    '--set-order', '1',
    '--vault', vaultRoot,
  ])).envelope)

  const nextCompleted = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', next.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(nextCompleted.entity.data.workout.exercises[0]?.sets, [
    { order: 1, reps: 12 },
  ])
  assert.equal(typeof nextCompleted.entity.data.workout.endedAt, 'string')
  const olderStillOpen = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', older.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(olderStillOpen.entity.data.workout.endedAt, undefined)

  const extraWriteStartedAt = Date.now()
  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'log', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--set-order', '9',
    '--vault', vaultRoot,
  ])).envelope)
  const extraWriteFinishedAt = Date.now()
  const extended = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', finiteId, '--vault', vaultRoot,
  ])).envelope)
  assert.deepEqual(extended.entity.data.workout.exercises[0]?.sets[8], {
    order: 9,
    reps: 9,
  })
  const extendedAt = Date.parse(extended.entity.data.workout.endedAt!)
  assert.ok(extendedAt >= extraWriteStartedAt)
  assert.ok(extendedAt <= extraWriteFinishedAt)
  assert.ok(extendedAt >= completedAt)

  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'log', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--set-order', '9',
    '--vault', vaultRoot,
  ])).envelope)
  const extraRetry = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', finiteId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(extraRetry.entity.data.workout.endedAt, extended.entity.data.workout.endedAt)
  assert.equal(extraRetry.entity.data.workout.exercises[0]?.sets.length, 9)

  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'clear', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--set-order', '8',
    '--vault', vaultRoot,
  ])).envelope)
  requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'set', 'log', 'Seated cable curl',
    '--workout-id', finiteId,
    '--exercise-order', '1',
    '--set-order', '8',
    '--vault', vaultRoot,
  ])).envelope)
  const corrected = requireData((await run<ShowResult>(createWorkoutCli(), [
    'workout', 'show', finiteId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(corrected.entity.data.workout.endedAt, extended.entity.data.workout.endedAt)
})
