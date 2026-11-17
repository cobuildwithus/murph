import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { test } from 'vitest'

import {
  projectRecordListEntity,
  projectRecordReadEntity,
  type SourceRecordEntity,
} from '../src/commands/record-read-projection.js'
import { createVaultCli } from '../src/vault-cli.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

function ledgerEntity(overrides: Partial<SourceRecordEntity> = {}): SourceRecordEntity {
  return {
    id: 'meal_01',
    kind: 'meal',
    title: 'Lunch',
    occurredAt: '2026-04-08T12:00:00.000Z',
    path: 'ledger/events/2026/2026-04.jsonl',
    markdown: 'Rice and beans',
    data: {
      schemaVersion: 'murph.event.v1',
      id: 'evt_01',
      kind: 'meal',
      title: 'Lunch',
      occurredAt: '2026-04-08T12:00:00.000Z',
      recordedAt: '2026-04-08T12:05:00.000Z',
      dayKey: '2026-04-08',
      timeZone: 'America/New_York',
      source: 'manual',
      note: 'Rice and beans',
      mealId: 'meal_01',
      entityId: 'meal_01',
      eventIds: ['evt_01'],
      rawRefs: ['raw/meals/2026/04/meal_01/manifest.json'],
      links: [{ type: 'related_to', targetId: 'meal_01' }],
      lifecycle: { revision: 3 },
      externalRef: { system: 'capture', resourceType: 'photo', resourceId: 'cap-1' },
    },
    links: [
      { id: 'meal_01', kind: 'meal', queryable: true },
      { id: 'evt_01', kind: 'event', queryable: true },
    ],
    ...overrides,
  }
}

test('a show keeps each fact once, its revision, and provenance a skill matches on', () => {
  assert.deepEqual(projectRecordReadEntity(ledgerEntity(), { path: true }), {
    id: 'meal_01',
    kind: 'meal',
    title: 'Lunch',
    occurredAt: '2026-04-08T12:00:00.000Z',
    data: {
      id: 'evt_01',
      recordedAt: '2026-04-08T12:05:00.000Z',
      dayKey: '2026-04-08',
      timeZone: 'America/New_York',
      source: 'manual',
      note: 'Rice and beans',
      rawRefs: ['raw/meals/2026/04/meal_01/manifest.json'],
      lifecycle: { revision: 3 },
      externalRef: { system: 'capture', resourceType: 'photo', resourceId: 'cap-1' },
    },
  })
})

test('a list item also drops raw refs and the time zone', () => {
  const { markdown, ...listed } = ledgerEntity({ excerpt: 'Rice and beans' })
  void markdown
  const item = projectRecordListEntity(listed)
  assert.equal(item.excerpt, undefined)
  assert.equal(item.data.timeZone, undefined)
  assert.equal(item.data.rawRefs, undefined)
  assert.deepEqual(item.data.lifecycle, { revision: 3 })
  assert.equal(item.links, undefined)
})

test('a device import keeps only its provider', () => {
  const item = projectRecordListEntity(ledgerEntity({
    id: 'evt_02',
    kind: 'sleep_session',
    data: {
      id: 'evt_02',
      kind: 'sleep_session',
      source: 'device',
      durationMinutes: 420,
      externalRef: { system: 'junction', resourceType: 'junction-oura-sleep', resourceId: 'sleep-1' },
      dataOrigin: { version: 1, aggregatorProvider: 'junction', sourceProviderSlug: 'oura' },
    },
    links: [],
  }))
  assert.deepEqual(item.data, { source: 'device', durationMinutes: 420, provider: 'oura' })
})

test('generated registry bodies go; written bodies, own files, and other links stay', () => {
  const goal = projectRecordReadEntity({
    id: 'goal_01',
    kind: 'goal',
    title: 'Sleep more',
    occurredAt: null,
    path: 'bank/goals/sleep-more.md',
    markdown: '# Sleep more\n\n- Status: active',
    data: { goalId: 'goal_01', title: 'Sleep more', status: 'active', windowTargetAt: null, relatedGoalIds: [] },
    links: [{ id: 'goal_02', kind: 'goal', queryable: true }],
  }, { path: true })
  assert.deepEqual(goal, {
    id: 'goal_01',
    kind: 'goal',
    title: 'Sleep more',
    path: 'bank/goals/sleep-more.md',
    data: { status: 'active' },
    links: [{ id: 'goal_02', kind: 'goal', queryable: true }],
  })

  const journal = {
    id: 'journal:2026-04-08',
    kind: 'journal_day',
    title: 'April 8',
    occurredAt: null,
    path: 'journal/2026/2026-04-08.md',
    markdown: 'Slept badly; long shift.',
    excerpt: 'Slept badly; long shift.',
    data: {},
    links: [],
  }
  assert.equal(projectRecordReadEntity(journal, { path: true }).markdown, journal.markdown)
  assert.equal(projectRecordReadEntity(journal, { path: false }).path, undefined)
  assert.equal(projectRecordListEntity(journal).excerpt, journal.excerpt)
})

test('record reads stay compact and their revision still drives edits and deletes', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-record-read-')
  const cli = createVaultCli()
  const run = async <TData>(args: string[]) => requireData(
    (await runInProcessJsonCli<TData>(cli, [...args, '--vault', vaultRoot])).envelope,
  )

  try {
    await run(['init'])
    const note = await run<{ eventId: string }>([
      'event', 'note', 'add', '--note', 'Headache after a late shift.',
      '--occurred-at', '2026-04-08T14:00:00.000Z',
    ])
    const shown = await run<{ entity: Record<string, any> }>(['event', 'show', note.eventId])
    assert.equal(shown.entity.markdown, undefined)
    assert.equal(shown.entity.path, undefined)
    assert.equal(shown.entity.links, undefined)
    assert.equal(shown.entity.data.schemaVersion, undefined)
    assert.equal(shown.entity.data.id, undefined)
    assert.equal(shown.entity.data.note, 'Headache after a late shift.')
    assert.equal(shown.entity.data.dayKey, '2026-04-08')

    const edited = await run<{ entity: Record<string, any> }>([
      'event', 'edit', note.eventId, '--note', 'Headache after a 12h shift.',
      '--expected-revision', String(shown.entity.data.lifecycle.revision),
    ])
    assert.equal(edited.entity.data.lifecycle.revision, shown.entity.data.lifecycle.revision + 1)

    const workout = await run<{ eventId: string }>([
      'workout', 'add', 'Easy run', '--duration', '30', '--type', 'running',
      '--occurred-at', '2026-04-08T22:00:00.000Z',
    ])
    const workouts = await run<{ items: Array<Record<string, any>> }>([
      'workout', 'list', '--from', '2026-04-08', '--to', '2026-04-08',
    ])
    const listedWorkout = workouts.items.find((item) => item.id === workout.eventId)
    assert.ok(listedWorkout)
    assert.equal(listedWorkout.path, undefined)
    assert.equal(listedWorkout.excerpt, undefined)
    const deleted = await run<{ deleted: boolean }>([
      'workout', 'delete', workout.eventId,
      '--expected-revision', String(listedWorkout.data.lifecycle.revision),
    ])
    assert.equal(deleted.deleted, true)

    const goal = await run<{ goalId: string }>(['goal', 'save', 'Sleep 7.5 hours', '--horizon', 'medium_term'])
    const goalShow = await run<{ entity: Record<string, any> }>(['goal', 'show', goal.goalId])
    assert.equal(goalShow.entity.markdown, undefined)
    assert.equal(goalShow.entity.data.title, undefined)
    assert.equal(goalShow.entity.data.horizon, 'medium_term')
    assert.equal(goalShow.entity.path, 'bank/goals/sleep-7-5-hours.md')

    await run(['supplement', 'save', 'Fish oil', '--status', 'active', '--schedule', 'daily',
      '--ingredient', '{"compound":"EPA","amount":650,"unit":"mg"}'])
    const summary = await run<{ items: Array<Record<string, any>> }>(['supplement', 'list'])
    assert.deepEqual(summary.items[0]?.data.ingredients, ['EPA 650 mg'])
    assert.equal(summary.items[0]?.excerpt, undefined)
    const detailed = await run<{ items: Array<Record<string, any>> }>([
      'supplement', 'list', '--include-details',
    ])
    assert.deepEqual(detailed.items[0]?.data.ingredients, [
      { compound: 'EPA', amount: 650, unit: 'mg', active: true },
    ])
    assert.equal(detailed.items[0]?.markdown, undefined)
    assert.equal(detailed.items[0]?.data.schedule, 'daily')
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
}, 120_000)
