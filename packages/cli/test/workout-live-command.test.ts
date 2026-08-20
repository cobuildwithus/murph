import assert from 'node:assert/strict'
import { cp, rm } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterAll } from 'vitest'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  addActivitySession,
  applyHostedCanonicalWriteReceipt,
  deleteEvent,
  readJsonlRecords,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
} from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import {
  addLiveWorkoutExercise,
  clearLiveWorkoutSet,
  logLiveWorkoutSet,
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
      lifecycle?: {
        revision?: number
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

async function startSingleExerciseWorkout(input: {
  cli: Cli.Cli
  startedAt: string
  title: string
  vaultRoot: string
}) {
  const started = requireData((await run<WorkoutResult>(input.cli, [
    'workout', 'start', input.title,
    '--started-at', input.startedAt,
    '--vault', input.vaultRoot,
  ])).envelope)
  const added = await run<ShowResult>(input.cli, [
    'workout', 'exercise', 'add', 'Pull-up',
    '--workout-id', started.eventId,
    '--order', '1',
    '--sets', '2',
    '--vault', input.vaultRoot,
  ])
  assert.equal(added.envelope.ok, true)
  return started
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

test('one command atomically replaces an explicitly approved active workout', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-replace-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'America/Chicago',
  ])
  assert.equal(requireData(initialized.envelope).created, true)

  const oldWorkout = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Old workout',
    '--started-at', '2026-08-20T06:30:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  const approvedSnapshot = requireData((await run<ShowResult>(cli, [
    'workout', 'active',
    '--workout-id', oldWorkout.eventId,
    '--vault', vaultRoot,
  ])).envelope)
  const approvedRevision = requireShownRevision(approvedSnapshot)

  const missingConfirmation = await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Upper body',
    '--workout-id', oldWorkout.eventId,
    '--expected-revision', String(approvedRevision),
    '--exercise', 'name=Pull-up;sets=3;mode=bodyweight',
    '--vault', vaultRoot,
  ])
  assert.equal(missingConfirmation.envelope.ok, false)
  const stillActive = requireData((await run<ShowResult>(cli, [
    'workout', 'active',
    '--workout-id', oldWorkout.eventId,
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(stillActive.entity.id, oldWorkout.eventId)

  const replacement = requireData((await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Upper body',
    '--workout-id', oldWorkout.eventId,
    '--expected-revision', String(approvedRevision),
    '--confirm-delete',
    '--exercise', 'name=Pull-up;sets=3;mode=bodyweight',
    '--exercise', 'name=Push-up;sets=2;mode=bodyweight',
    '--started-at', '2026-08-20T07:54:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)

  assert.notEqual(replacement.eventId, oldWorkout.eventId)
  assert.deepEqual(replacement.workout?.exercises, [
    {
      name: 'Pull-up',
      order: 1,
      mode: 'bodyweight',
      sets: [{ order: 1 }, { order: 2 }, { order: 3 }],
    },
    {
      name: 'Push-up',
      order: 2,
      mode: 'bodyweight',
      sets: [{ order: 1 }, { order: 2 }],
    },
  ])

  const oldIsGone = await run<ShowResult>(cli, [
    'workout', 'active',
    '--workout-id', oldWorkout.eventId,
    '--vault', vaultRoot,
  ])
  assert.equal(oldIsGone.envelope.ok, false)
  const active = requireData((await run<ShowResult>(cli, [
    'workout', 'active',
    '--vault', vaultRoot,
  ])).envelope)
  assert.equal(active.entity.id, replacement.eventId)
})

test('replacement preserves ordered duplicate exercises and comma-bearing names', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-replace-ordered-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])
  assert.equal(requireData(initialized.envelope).created, true)
  const oldWorkout = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Old workout',
    '--started-at', '2026-08-20T06:30:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  const approvedSnapshot = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--workout-id', oldWorkout.eventId,
    '--vault', vaultRoot,
  ])).envelope)
  const replicaRoot = path.join(parentRoot, 'replica-vault')
  await cp(vaultRoot, replicaRoot, { recursive: true })
  const persisted: HostedCanonicalWritePersistenceInput[] = []

  const replacement = requireData((await withHostedCanonicalWritePort(
    {
      async persistCanonicalWrite(input) {
        persisted.push(input)
      },
    },
    () => run<WorkoutResult>(cli, [
      'workout', 'replace', 'Ordered blocks',
      '--workout-id', oldWorkout.eventId,
      '--expected-revision', String(requireShownRevision(approvedSnapshot)),
      '--confirm-delete',
      '--exercise', 'name=Run;sets=1;mode=cardio',
      '--exercise', 'name=Row, neutral grip;sets=2;mode=weight_reps',
      '--exercise', 'name=Run;sets=1;mode=cardio',
      '--vault', vaultRoot,
    ]),
  )).envelope)

  assert.deepEqual(
    replacement.workout?.exercises.map((exercise) => ({
      name: exercise.name,
      order: exercise.order,
      setCount: exercise.sets.length,
    })),
    [
      { name: 'Run', order: 1, setCount: 1 },
      { name: 'Row, neutral grip', order: 2, setCount: 2 },
      { name: 'Run', order: 3, setCount: 1 },
    ],
  )
  assert.equal(persisted.length, 1)
  const hostedWrite = persisted[0]!
  await applyHostedCanonicalWriteReceipt({
    vaultRoot: replicaRoot,
    receipt: hostedWrite.receipt,
    async readPayload(ref) {
      return hostedWrite.payloads.find(
        (payload) => payload.sha256 === ref.sha256,
      )?.bytes ?? null
    },
  })
  const ledgerBeforeReplay = await readJsonlRecords({
    vaultRoot: replicaRoot,
    relativePath: replacement.ledgerFile,
  })
  const auditBeforeReplay = await readJsonlRecords({
    vaultRoot: replicaRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  })
  const replay = requireData((await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Ordered blocks',
    '--workout-id', oldWorkout.eventId,
    '--expected-revision', String(requireShownRevision(approvedSnapshot)),
    '--confirm-delete',
    '--exercise', 'name=Run;sets=1;mode=cardio',
    '--exercise', 'name=Row, neutral grip;sets=2;mode=weight_reps',
    '--exercise', 'name=Run;sets=1;mode=cardio',
    '--vault', replicaRoot,
  ])).envelope)
  assert.equal(replay.eventId, replacement.eventId)
  assert.equal(replay.created, false)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: replicaRoot,
    relativePath: replacement.ledgerFile,
  }), ledgerBeforeReplay)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: replicaRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  }), auditBeforeReplay)

  const differentWorkout = await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Ordered blocks',
    '--workout-id', oldWorkout.eventId,
    '--expected-revision', String(requireShownRevision(approvedSnapshot)),
    '--confirm-delete',
    '--exercise', 'name=Run;sets=1;mode=cardio',
    '--exercise', 'name=Row, neutral grip;sets=3;mode=weight_reps',
    '--exercise', 'name=Run;sets=1;mode=cardio',
    '--vault', replicaRoot,
  ])
  assert.equal(differentWorkout.envelope.ok, false)

  const differentStart = await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Ordered blocks',
    '--workout-id', oldWorkout.eventId,
    '--expected-revision', String(requireShownRevision(approvedSnapshot)),
    '--confirm-delete',
    '--exercise', 'name=Run;sets=1;mode=cardio',
    '--exercise', 'name=Row, neutral grip;sets=2;mode=weight_reps',
    '--exercise', 'name=Run;sets=1;mode=cardio',
    '--started-at', '2026-08-20T00:00:00.000Z',
    '--vault', replicaRoot,
  ])
  assert.equal(differentStart.envelope.ok, false)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: replicaRoot,
    relativePath: replacement.ledgerFile,
  }), ledgerBeforeReplay)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: replicaRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  }), auditBeforeReplay)

  const active = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--vault', replicaRoot,
  ])).envelope)
  assert.equal(active.entity.id, replacement.eventId)
})

test('replacement replay requires the exact approved tombstone revision', async () => {
  const completedContext = await createTempVaultContext(
    'murph-live-workout-replace-completed-old-',
  )
  cleanupPaths.push(completedContext.parentRoot)
  const completedCli = createWorkoutCli()
  assert.equal(requireData((await run<{ created: boolean }>(completedCli, [
    'init', '--vault', completedContext.vaultRoot, '--timezone', 'UTC',
  ])).envelope).created, true)
  const completedOld = requireData((await run<WorkoutResult>(completedCli, [
    'workout', 'start', 'Old workout',
    '--started-at', '2026-08-20T06:30:00.000Z',
    '--vault', completedContext.vaultRoot,
  ])).envelope)
  const completedApproval = requireData((await run<ShowResult>(completedCli, [
    'workout', 'active', '--workout-id', completedOld.eventId,
    '--vault', completedContext.vaultRoot,
  ])).envelope)
  const completed = await run<ShowResult>(completedCli, [
    'workout', 'finish', '--workout-id', completedOld.eventId,
    '--ended-at', '2026-08-20T06:45:00.000Z',
    '--vault', completedContext.vaultRoot,
  ])
  assert.equal(completed.envelope.ok, true)
  const completedCandidate = await startSingleExerciseWorkout({
    cli: completedCli,
    startedAt: '2026-08-20T07:00:00.000Z',
    title: 'Replacement workout',
    vaultRoot: completedContext.vaultRoot,
  })
  const completedLedgerBefore = await readJsonlRecords({
    vaultRoot: completedContext.vaultRoot,
    relativePath: completedCandidate.ledgerFile,
  })
  const completedAuditBefore = await readJsonlRecords({
    vaultRoot: completedContext.vaultRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  })
  const completedReplay = await run<WorkoutResult>(completedCli, [
    'workout', 'replace', 'Replacement workout',
    '--workout-id', completedOld.eventId,
    '--expected-revision', String(requireShownRevision(completedApproval)),
    '--confirm-delete',
    '--exercise', 'name=Pull-up;sets=2',
    '--vault', completedContext.vaultRoot,
  ])
  assert.equal(completedReplay.envelope.ok, false)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: completedContext.vaultRoot,
    relativePath: completedCandidate.ledgerFile,
  }), completedLedgerBefore)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: completedContext.vaultRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  }), completedAuditBefore)
  const completedOldRevisions = completedLedgerBefore.filter(
    (record) => (record as { id?: string }).id === completedOld.eventId,
  ) as Array<{
    lifecycle: { revision: number; state?: string }
    workout?: { endedAt?: string }
  }>
  assert.equal(completedOldRevisions.at(-1)?.lifecycle.state, undefined)
  assert.equal(
    completedOldRevisions.at(-1)?.workout?.endedAt,
    '2026-08-20T06:45:00.000Z',
  )

  const wrongRevisionContext = await createTempVaultContext(
    'murph-live-workout-replace-wrong-tombstone-',
  )
  cleanupPaths.push(wrongRevisionContext.parentRoot)
  const wrongRevisionCli = createWorkoutCli()
  assert.equal(requireData((await run<{ created: boolean }>(wrongRevisionCli, [
    'init', '--vault', wrongRevisionContext.vaultRoot, '--timezone', 'UTC',
  ])).envelope).created, true)
  const revisedOld = requireData((await run<WorkoutResult>(wrongRevisionCli, [
    'workout', 'start', 'Old workout',
    '--started-at', '2026-08-20T06:30:00.000Z',
    '--vault', wrongRevisionContext.vaultRoot,
  ])).envelope)
  const revisedApproval = requireData((await run<ShowResult>(wrongRevisionCli, [
    'workout', 'active', '--workout-id', revisedOld.eventId,
    '--vault', wrongRevisionContext.vaultRoot,
  ])).envelope)
  await addLiveWorkoutExercise({
    vault: wrongRevisionContext.vaultRoot,
    workoutId: revisedOld.eventId,
    name: 'Late edit',
    order: 1,
    setCount: 1,
  })
  await deleteEvent({
    vaultRoot: wrongRevisionContext.vaultRoot,
    eventId: revisedOld.eventId,
  })
  const wrongRevisionCandidate = await startSingleExerciseWorkout({
    cli: wrongRevisionCli,
    startedAt: '2026-08-20T07:00:00.000Z',
    title: 'Replacement workout',
    vaultRoot: wrongRevisionContext.vaultRoot,
  })
  const wrongRevisionLedgerBefore = await readJsonlRecords({
    vaultRoot: wrongRevisionContext.vaultRoot,
    relativePath: wrongRevisionCandidate.ledgerFile,
  })
  const wrongRevisionAuditBefore = await readJsonlRecords({
    vaultRoot: wrongRevisionContext.vaultRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  })
  const wrongTombstoneReplay = await run<WorkoutResult>(wrongRevisionCli, [
    'workout', 'replace', 'Replacement workout',
    '--workout-id', revisedOld.eventId,
    '--expected-revision', String(requireShownRevision(revisedApproval)),
    '--confirm-delete',
    '--exercise', 'name=Pull-up;sets=2',
    '--vault', wrongRevisionContext.vaultRoot,
  ])
  assert.equal(wrongTombstoneReplay.envelope.ok, false)
  const missingOldReplay = await run<WorkoutResult>(wrongRevisionCli, [
    'workout', 'replace', 'Replacement workout',
    '--workout-id', 'evt_00000000000000000000000000',
    '--expected-revision', '1',
    '--confirm-delete',
    '--exercise', 'name=Pull-up;sets=2',
    '--vault', wrongRevisionContext.vaultRoot,
  ])
  assert.equal(missingOldReplay.envelope.ok, false)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: wrongRevisionContext.vaultRoot,
    relativePath: wrongRevisionCandidate.ledgerFile,
  }), wrongRevisionLedgerBefore)
  assert.deepEqual(await readJsonlRecords({
    vaultRoot: wrongRevisionContext.vaultRoot,
    relativePath: 'audit/2026/2026-08.jsonl',
  }), wrongRevisionAuditBefore)
  const revisedOldRevisions = wrongRevisionLedgerBefore.filter(
    (record) => (record as { id?: string }).id === revisedOld.eventId,
  ) as Array<{ lifecycle: { revision: number; state?: string } }>
  assert.deepEqual(revisedOldRevisions.at(-1)?.lifecycle, {
    revision: requireShownRevision(revisedApproval) + 2,
    state: 'deleted',
  })
})

test('replacement fails closed when a competing live workout exists', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-replace-conflict-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])
  assert.equal(requireData(initialized.envelope).created, true)
  const approved = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Approved old workout',
    '--started-at', '2026-08-20T06:30:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  const approvedSnapshot = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--workout-id', approved.eventId, '--vault', vaultRoot,
  ])).envelope)
  const competing = await addActivitySession({
    vaultRoot,
    draft: {
      occurredAt: '2026-08-20T07:00:00.000Z',
      source: 'manual',
      title: 'Replacement workout',
      note: 'Replacement workout',
      activityType: 'strength-training',
      durationMinutes: 1,
      workout: {
        sourceApp: 'murph-live',
        startedAt: '2026-08-20T07:00:00.000Z',
        exercises: [{
          name: 'Pull-up',
          order: 1,
          sets: [{ order: 1 }, { order: 2 }],
        }],
      },
    },
  })

  const conflict = await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Replacement workout',
    '--workout-id', approved.eventId,
    '--expected-revision', String(requireShownRevision(approvedSnapshot)),
    '--confirm-delete',
    '--exercise', 'name=Pull-up;sets=2',
    '--vault', vaultRoot,
  ])
  assert.equal(conflict.envelope.ok, false)

  const approvedStillActive = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--workout-id', approved.eventId, '--vault', vaultRoot,
  ])).envelope)
  const competingStillActive = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--workout-id', competing.eventId, '--vault', vaultRoot,
  ])).envelope)
  assert.equal(approvedStillActive.entity.id, approved.eventId)
  assert.equal(competingStillActive.entity.id, competing.eventId)
})

test('replacement rejects the proposal revision after the approved workout changes', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-live-workout-replace-stale-approval-',
  )
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutCli()

  const initialized = await run<{ created: boolean }>(cli, [
    'init', '--vault', vaultRoot, '--timezone', 'UTC',
  ])
  assert.equal(requireData(initialized.envelope).created, true)
  const approved = requireData((await run<WorkoutResult>(cli, [
    'workout', 'start', 'Approved old workout',
    '--started-at', '2026-08-20T06:30:00.000Z',
    '--vault', vaultRoot,
  ])).envelope)
  const proposalSnapshot = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--workout-id', approved.eventId, '--vault', vaultRoot,
  ])).envelope)
  const proposalRevision = requireShownRevision(proposalSnapshot)

  await addLiveWorkoutExercise({
    vault: vaultRoot,
    workoutId: approved.eventId,
    name: 'Late correction',
    order: 1,
    setCount: 1,
  })

  const conflict = await run<WorkoutResult>(cli, [
    'workout', 'replace', 'Replacement workout',
    '--workout-id', approved.eventId,
    '--expected-revision', String(proposalRevision),
    '--confirm-delete',
    '--exercise', 'name=Pull-up;sets=2',
    '--vault', vaultRoot,
  ])
  assert.equal(conflict.envelope.ok, false)

  const unchanged = requireData((await run<ShowResult>(cli, [
    'workout', 'active', '--vault', vaultRoot,
  ])).envelope)
  assert.equal(unchanged.entity.id, approved.eventId)
  assert.ok(requireShownRevision(unchanged) > proposalRevision)
  assert.equal(unchanged.entity.data.workout.exercises[0]?.name, 'Late correction')
  const records = await readJsonlRecords({
    vaultRoot,
    relativePath: approved.ledgerFile,
  })
  assert.deepEqual(
    [...new Set(records.map((record) => (record as { id?: string }).id))],
    [approved.eventId],
  )
  assert.equal(records.some((record) =>
    (record as { lifecycle?: { state?: string } }).lifecycle?.state === 'deleted'
  ), false)
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
