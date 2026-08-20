import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test, vi } from 'vitest'

import {
  addActivitySession,
  applyHostedCanonicalWriteReceipt,
  initializeVault,
  readJsonlRecords,
  replaceActivitySession,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
  type ReplaceActivitySessionInput,
} from '../src/index.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      fs.rm(target, { recursive: true, force: true }),
    ),
  )
})

async function makeVault(): Promise<string> {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'murph-activity-replace-'),
  )
  cleanupPaths.push(vaultRoot)
  await initializeVault({ vaultRoot, timezone: 'UTC' })
  return vaultRoot
}

async function addActiveWorkout(vaultRoot: string) {
  return addActivitySession({
    vaultRoot,
    draft: {
      occurredAt: '2026-08-20T06:30:00.000Z',
      source: 'manual',
      title: 'Old workout',
      activityType: 'strength-training',
      durationMinutes: 30,
      workout: {
        sourceApp: 'murph-live',
        startedAt: '2026-08-20T06:30:00.000Z',
        exercises: [{
          name: 'Old exercise',
          order: 1,
          sets: [{ order: 1, reps: 8 }],
        }],
      },
    },
  })
}

function replacementDraft(): ReplaceActivitySessionInput['draft'] {
  return {
    occurredAt: '2026-08-20T07:54:00.000Z',
    source: 'manual',
    title: 'Replacement workout',
    activityType: 'strength-training',
    durationMinutes: 1,
    workout: {
      sourceApp: 'murph-live',
      startedAt: '2026-08-20T07:54:00.000Z',
      exercises: [
        {
          name: 'Pull-up',
          order: 1,
          mode: 'bodyweight' as const,
          sets: [{ order: 1 }, { order: 2 }, { order: 3 }],
        },
        {
          name: 'Push-up',
          order: 2,
          mode: 'bodyweight' as const,
          sets: [{ order: 1 }, { order: 2 }],
        },
      ],
    },
  }
}

function requireRevision(
  event: Awaited<ReturnType<typeof addActiveWorkout>>['event'],
): number {
  const revision = event.lifecycle?.revision
  assert.equal(typeof revision, 'number')
  return revision!
}

test('activity-session replacement emits one hosted atomic write', async () => {
  const vaultRoot = await makeVault()
  const oldWorkout = await addActiveWorkout(vaultRoot)
  const replicaRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'murph-activity-replace-replica-'),
  )
  cleanupPaths.push(replicaRoot)
  await fs.cp(vaultRoot, replicaRoot, { recursive: true })
  const persisted: HostedCanonicalWritePersistenceInput[] = []

  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T07:54:05.000Z'))
  const replacement = await withHostedCanonicalWritePort(
    {
      async persistCanonicalWrite(input) {
        persisted.push(input)
      },
    },
    () => replaceActivitySession({
      vaultRoot,
      eventId: oldWorkout.eventId,
      expectedRevision: requireRevision(oldWorkout.event),
      draft: replacementDraft(),
    }),
  )

  assert.equal(replacement.replacedEventId, oldWorkout.eventId)
  assert.notEqual(replacement.eventId, oldWorkout.eventId)
  assert.deepEqual(
    replacement.event.workout.exercises.map((exercise) => ({
      name: exercise.name,
      setCount: exercise.sets.length,
    })),
    [
      { name: 'Pull-up', setCount: 3 },
      { name: 'Push-up', setCount: 2 },
    ],
  )
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0]?.receipt.operationType, 'activity_session_replace')
  assert.deepEqual(
    persisted[0]?.receipt.actions.map((action) => action.kind),
    ['jsonl_append', 'jsonl_append', 'jsonl_append', 'jsonl_append'],
  )
  const hostedWrite = persisted[0]!
  await applyHostedCanonicalWriteReceipt({
    vaultRoot: replicaRoot,
    receipt: hostedWrite.receipt,
    async readPayload(ref) {
      return hostedWrite.payloads.find((payload) => payload.sha256 === ref.sha256)?.bytes
        ?? null
    },
  })
  assert.equal(
    await fs.readFile(path.join(replicaRoot, replacement.ledgerFile), 'utf8'),
    await fs.readFile(path.join(vaultRoot, replacement.ledgerFile), 'utf8'),
  )
  assert.equal(
    await fs.readFile(path.join(replicaRoot, 'audit/2026/2026-08.jsonl'), 'utf8'),
    await fs.readFile(path.join(vaultRoot, 'audit/2026/2026-08.jsonl'), 'utf8'),
  )

  const records = await readJsonlRecords({
    vaultRoot,
    relativePath: replacement.ledgerFile,
  })
  const oldRevisions = records.filter(
    (record) => (record as { id?: string }).id === oldWorkout.eventId,
  ) as Array<{ lifecycle: { revision: number; state?: string } }>
  assert.deepEqual(oldRevisions.map((record) => record.lifecycle), [
    { revision: 1 },
    { revision: 2, state: 'deleted' },
  ])
  assert.equal(
    records.some((record) =>
      (record as { id?: string }).id === replacement.eventId,
    ),
    true,
  )
})

test('failed hosted persistence rolls back both sides of replacement', async () => {
  const vaultRoot = await makeVault()
  const oldWorkout = await addActiveWorkout(vaultRoot)
  const ledgerPath = path.join(vaultRoot, oldWorkout.ledgerFile)
  const auditPath = path.join(vaultRoot, 'audit/2026/2026-08.jsonl')
  const before = await fs.readFile(ledgerPath, 'utf8')
  const auditBefore = await fs.readFile(auditPath, 'utf8')

  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T07:54:05.000Z'))
  await assert.rejects(
    withHostedCanonicalWritePort(
      {
        async persistCanonicalWrite() {
          throw new Error('injected replacement persistence failure')
        },
      },
      () => replaceActivitySession({
        vaultRoot,
        eventId: oldWorkout.eventId,
        expectedRevision: requireRevision(oldWorkout.event),
        draft: replacementDraft(),
      }),
    ),
    /injected replacement persistence failure/u,
  )

  assert.equal(await fs.readFile(ledgerPath, 'utf8'), before)
  assert.equal(await fs.readFile(auditPath, 'utf8'), auditBefore)
  const records = await readJsonlRecords({
    vaultRoot,
    relativePath: oldWorkout.ledgerFile,
  })
  assert.equal(records.length, 1)
  assert.deepEqual(
    (records[0] as { lifecycle?: unknown }).lifecycle,
    { revision: 1 },
  )
})

test('activity-session replacement rejects a stale revision without mutation', async () => {
  const vaultRoot = await makeVault()
  const oldWorkout = await addActiveWorkout(vaultRoot)
  const ledgerPath = path.join(vaultRoot, oldWorkout.ledgerFile)
  const before = await fs.readFile(ledgerPath, 'utf8')

  await assert.rejects(
    replaceActivitySession({
      vaultRoot,
      eventId: oldWorkout.eventId,
      expectedRevision: requireRevision(oldWorkout.event) + 1,
      draft: replacementDraft(),
    }),
    (error: unknown) =>
      typeof error === 'object'
      && error !== null
      && Reflect.get(error, 'code') === 'EVENT_REVISION_CONFLICT',
  )
  assert.equal(await fs.readFile(ledgerPath, 'utf8'), before)
})
