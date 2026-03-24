import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import {
  repoRoot,
  requireData,
  runCli,
} from './cli-test-helpers.js'

const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)
const runSourceCli = runCli

interface RetrievalFixture {
  journalPath: string
  mealId: string
  vaultRoot: string
}

async function makeCanonicalHealthFixture(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-canonical-'))

  await writeVaultFile(
    vaultRoot,
    'ledger/assessments/2026/2026-03.jsonl',
    `${JSON.stringify({
      schemaVersion: 'hb.assessment-response.v1',
      id: 'asmt_health_01',
      assessmentType: 'full-intake',
      recordedAt: '2026-03-12T13:00:00Z',
      source: 'import',
      title: 'Sleep intake questionnaire',
      responses: {
        sleep: {
          averageHours: 6.5,
        },
      },
      relatedIds: ['goal_sleep_01'],
    })}\n`,
  )

  await writeVaultFile(
    vaultRoot,
    'ledger/profile-snapshots/2026/2026-03.jsonl',
    `${JSON.stringify({
      schemaVersion: 'hb.profile-snapshot.v1',
      id: 'psnap_health_01',
      recordedAt: '2026-03-12T14:00:00Z',
      source: 'assessment_projection',
      sourceAssessmentIds: ['asmt_health_01'],
      sourceEventIds: ['evt_history_01'],
      profile: {
        topGoalIds: ['goal_sleep_01'],
      },
      summary: 'Sleep remains the primary concern.',
    })}\n`,
  )

  await writeVaultFile(
    vaultRoot,
    'ledger/events/2026/2026-03.jsonl',
    `${JSON.stringify({
      schemaVersion: 'hb.event.v1',
      id: 'evt_history_01',
      kind: 'encounter',
      occurredAt: '2026-03-12T12:45:00Z',
      recordedAt: '2026-03-12T12:50:00Z',
      source: 'manual',
      title: 'Sleep clinic intake visit',
      relatedIds: ['goal_sleep_01'],
      tags: ['sleep', 'clinic'],
    })}\n`,
  )

  await writeVaultFile(
    vaultRoot,
    'bank/goals/improve-sleep.md',
    `---
goalId: goal_sleep_01
slug: improve-sleep
title: Improve sleep quality
status: active
priority: 1
---
# Improve sleep quality

Reduce sleep latency and improve recovery.
`,
  )

  return vaultRoot
}

async function makeRetrievalFixture(): Promise<RetrievalFixture> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-retrieval-'))
  const csvPath = path.join(vaultRoot, 'heart-rate.csv')

  await writeFile(
    csvPath,
    [
      'timestamp,bpm',
      '2026-03-12T18:00:00Z,61',
      '2026-03-12T20:00:00Z,77',
      '',
    ].join('\n'),
    'utf8',
  )

  const initResult = await runCli<{ created: boolean }>([
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)

  const journalResult = await runCli<{ journalPath: string }>([
    'journal',
    'ensure',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ])
  assert.equal(journalResult.ok, true)

  await writeFile(
    path.join(vaultRoot, requireData(journalResult).journalPath),
    `---
dayKey: 2026-03-12
title: March 12
tags:
  - focus
---
# March 12

Steady energy. Afternoon crash after pasta lunch and coffee.
`,
    'utf8',
  )

  const mealResult = await runCli<{ mealId: string }>([
    'meal',
    'add',
    '--photo',
    sampleDocumentPath,
    '--note',
    'Pasta lunch and coffee. Afternoon crash afterward.',
    '--occurred-at',
    '2026-03-12T12:15:00Z',
    '--vault',
    vaultRoot,
  ])
  assert.equal(mealResult.ok, true)

  const samplesResult = await runCli<{ lookupIds: string[] }>([
    'samples',
    'import-csv',
    csvPath,
    '--stream',
    'heart_rate',
    '--ts-column',
    'timestamp',
    '--value-column',
    'bpm',
    '--unit',
    'bpm',
    '--vault',
    vaultRoot,
  ])
  assert.equal(samplesResult.ok, true)
  assert.equal(requireData(samplesResult).lookupIds.length, 2)

  return {
    journalPath: requireData(journalResult).journalPath,
    mealId: requireData(mealResult).mealId,
    vaultRoot,
  }
}

async function makeSourceRetrievalFixture(): Promise<RetrievalFixture> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-retrieval-'))
  const csvPath = path.join(vaultRoot, 'heart-rate.csv')

  await writeFile(
    csvPath,
    [
      'timestamp,bpm',
      '2026-03-12T18:00:00Z,61',
      '2026-03-12T20:00:00Z,77',
      '',
    ].join('\n'),
    'utf8',
  )

  const initResult = await runSourceCli<{ created: boolean }>([
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)

  const journalResult = await runSourceCli<{ journalPath: string }>([
    'journal',
    'ensure',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ])
  assert.equal(journalResult.ok, true)

  await writeFile(
    path.join(vaultRoot, requireData(journalResult).journalPath),
    `---
dayKey: 2026-03-12
title: March 12
tags:
  - focus
---
# March 12

Steady energy. Afternoon crash after pasta lunch and coffee.
`,
    'utf8',
  )

  const mealResult = await runSourceCli<{ mealId: string }>([
    'meal',
    'add',
    '--photo',
    sampleDocumentPath,
    '--note',
    'Pasta lunch and coffee. Afternoon crash afterward.',
    '--occurred-at',
    '2026-03-12T12:15:00Z',
    '--vault',
    vaultRoot,
  ])
  assert.equal(mealResult.ok, true)

  const samplesResult = await runSourceCli<{ lookupIds: string[] }>([
    'samples',
    'import-csv',
    csvPath,
    '--stream',
    'heart_rate',
    '--ts-column',
    'timestamp',
    '--value-column',
    'bpm',
    '--unit',
    'bpm',
    '--vault',
    vaultRoot,
  ])
  assert.equal(samplesResult.ok, true)
  assert.equal(requireData(samplesResult).lookupIds.length, 2)

  return {
    journalPath: requireData(journalResult).journalPath,
    mealId: requireData(mealResult).mealId,
    vaultRoot,
  }
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  })
  await writeFile(path.join(vaultRoot, relativePath), contents, 'utf8')
}

test.sequential('search returns lexical hits and excludes raw sample rows by default', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    const result = await runCli<{
      hits: Array<{
        recordId: string
        recordType: string
        snippet: string
      }>
      query: string
      total: number
    }>([
      'search',
      'query',
      '--text',
      'afternoon crash pasta',
      '--limit',
      '10',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(result.meta?.command, 'search query')
    assert.equal(requireData(result).query, 'afternoon crash pasta')
    assert.equal(requireData(result).total, 2)
    assert.deepEqual(
      new Set(requireData(result).hits.map((hit) => hit.recordId)),
      new Set(['journal:2026-03-12', fixture.mealId]),
    )
    assert.match(requireData(result).hits[0]?.snippet ?? '', /afternoon crash|pasta/i)
    assert.equal(
      requireData(result).hits.some((hit) => hit.recordType === 'sample'),
      false,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search applies date bounds and echoes renamed filter keys', async () => {
  const fixture = await makeSourceRetrievalFixture()

  try {
    const priorJournal = await runSourceCli<{ journalPath: string }>([
      'journal',
      'ensure',
      '2026-03-10',
      '--vault',
      fixture.vaultRoot,
    ])
    assert.equal(priorJournal.ok, true)

    await writeFile(
      path.join(fixture.vaultRoot, requireData(priorJournal).journalPath),
      `---
dayKey: 2026-03-10
title: March 10
tags:
  - focus
---
# March 10

Afternoon crash after pasta lunch returned.
`,
      'utf8',
    )

    const bounded = await runSourceCli<{
      filters: Record<string, unknown>
      hits: Array<{
        recordId: string
      }>
      total: number
    }>([
      'search',
      'query',
      '--text',
      'afternoon crash pasta',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      fixture.vaultRoot,
    ])
    const unbounded = await runSourceCli<{
      hits: Array<{
        recordId: string
      }>
      total: number
    }>([
      'search',
      'query',
      '--text',
      'afternoon crash pasta',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(bounded.ok, true)
    assert.equal(requireData(bounded).filters.from, '2026-03-12')
    assert.equal(requireData(bounded).filters.to, '2026-03-12')
    assert.equal('dateFrom' in requireData(bounded).filters, false)
    assert.equal('dateTo' in requireData(bounded).filters, false)
    assert.equal(requireData(bounded).total, 2)
    assert.deepEqual(
      new Set(requireData(bounded).hits.map((hit) => hit.recordId)),
      new Set(['journal:2026-03-12', fixture.mealId]),
    )
    assert.equal(unbounded.ok, true)
    assert.equal(requireData(unbounded).total, 3)
    assert.equal(
      requireData(unbounded).hits.some(
        (hit) => hit.recordId === 'journal:2026-03-10',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search includes sample rows when the caller scopes by stream', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    const result = await runCli<{
      hits: Array<{
        recordId: string
        recordType: string
        stream: string | null
      }>
    }>([
      'search',
      'query',
      '--text',
      'heart_rate',
      '--stream',
      'heart_rate',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(
      requireData(result).hits.some(
        (hit) => hit.recordType === 'sample' && hit.stream === 'heart_rate',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('timeline merges journals, events, and sample summaries into one descending feed', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    const result = await runCli<{
      items: Array<{
        entryType: string
        id: string
        stream: string | null
      }>
    }>([
      'timeline',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(result.meta?.command, 'timeline')
    assert.deepEqual(
      requireData(result).items.slice(0, 3).map((item) => [item.entryType, item.id]),
      [
        ['sample_summary', 'sample-summary:2026-03-12:heart_rate:bpm'],
        ['event', fixture.mealId],
        ['journal', 'journal:2026-03-12'],
      ],
    )
    assert.equal(requireData(result).items[0]?.stream, 'heart_rate')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search index status and rebuild expose the shared sqlite runtime state without creating it early', async () => {
  const fixture = await makeRetrievalFixture()
  const runtimeDatabasePath = path.join(fixture.vaultRoot, '.runtime/search.sqlite')

  try {
    assert.equal(existsSync(runtimeDatabasePath), false)

    const initialStatus = await runCli<{
      backend: string
      exists: boolean
      documentCount: number
      dbPath: string
    }>([
      'search',
      'index',
      'status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(initialStatus.ok, true)
    assert.equal(requireData(initialStatus).backend, 'sqlite')
    assert.equal(requireData(initialStatus).exists, false)
    assert.equal(requireData(initialStatus).dbPath, '.runtime/search.sqlite')
    assert.equal(existsSync(runtimeDatabasePath), false)

    const rebuild = await runCli<{
      backend: string
      exists: boolean
      rebuilt: boolean
      documentCount: number
      dbPath: string
    }>([
      'search',
      'index',
      'rebuild',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(rebuild.ok, true)
    assert.equal(requireData(rebuild).backend, 'sqlite')
    assert.equal(requireData(rebuild).exists, true)
    assert.equal(requireData(rebuild).rebuilt, true)
    assert.equal(requireData(rebuild).dbPath, '.runtime/search.sqlite')
    assert.equal(requireData(rebuild).documentCount > 0, true)
    assert.equal(existsSync(runtimeDatabasePath), true)

    const indexedSearch = await runCli<{
      filters: { backend: string }
      hits: Array<{ recordId: string; recordType: string; stream: string | null }>
    }>([
      'search',
      'query',
      '--text',
      'heart_rate',
      '--backend',
      'sqlite',
      '--stream',
      'heart_rate',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(indexedSearch.ok, true)
    assert.equal(requireData(indexedSearch).filters.backend, 'sqlite')
    assert.equal(
      requireData(indexedSearch).hits.some(
        (hit) => hit.recordType === 'sample' && hit.stream === 'heart_rate',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search index status ignores a copied inbox search db until index rebuild restores the canonical search db', async () => {
  const fixture = await makeRetrievalFixture()
  const searchDatabasePath = path.join(fixture.vaultRoot, '.runtime/search.sqlite')
  const legacyDatabasePath = path.join(fixture.vaultRoot, '.runtime/inboxd.sqlite')

  try {
    const initialRebuild = await runCli<{
      dbPath: string
      rebuilt: boolean
    }>([
      'search',
      'index',
      'rebuild',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(initialRebuild.ok, true)
    assert.equal(requireData(initialRebuild).dbPath, '.runtime/search.sqlite')

    await mkdir(path.dirname(legacyDatabasePath), { recursive: true })
    await copyFile(searchDatabasePath, legacyDatabasePath)
    await rm(searchDatabasePath, { force: true })

    const legacyStatus = await runCli<{
      backend: string
      exists: boolean
      dbPath: string
    }>([
      'search',
      'index',
      'status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(legacyStatus.ok, true)
    assert.equal(requireData(legacyStatus).backend, 'sqlite')
    assert.equal(requireData(legacyStatus).exists, false)
    assert.equal(requireData(legacyStatus).dbPath, '.runtime/search.sqlite')

    const sqliteSearch = await runCli<{
      filters: { backend: string }
      hits: Array<{ recordId: string }>
    }>([
      'search',
      'query',
      '--text',
      'heart_rate',
      '--backend',
      'sqlite',
      '--stream',
      'heart_rate',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(sqliteSearch.ok, false)
    assert.match(
      sqliteSearch.error.message ?? '',
      /index rebuild|--backend scan/u,
    )

    const rebuilt = await runCli<{
      backend: string
      exists: boolean
      rebuilt: boolean
      dbPath: string
    }>([
      'search',
      'index',
      'rebuild',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(rebuilt.ok, true)
    assert.equal(requireData(rebuilt).backend, 'sqlite')
    assert.equal(requireData(rebuilt).exists, true)
    assert.equal(requireData(rebuilt).rebuilt, true)
    assert.equal(requireData(rebuilt).dbPath, '.runtime/search.sqlite')
    assert.equal(existsSync(searchDatabasePath), true)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search index status treats a pre-existing inbox runtime db as unindexed and sqlite backend returns operator guidance', async () => {
  const fixture = await makeRetrievalFixture()
  const runtimeRoot = path.join(fixture.vaultRoot, '.runtime')
  const runtimeDatabasePath = path.join(runtimeRoot, 'inboxd.sqlite')

  try {
    await mkdir(runtimeRoot, { recursive: true })
    const database = new DatabaseSync(runtimeDatabasePath)
    database.exec('CREATE TABLE inbox_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);')
    database.close()

    const initialStatus = await runCli<{
      backend: string
      exists: boolean
      dbPath: string
    }>([
      'search',
      'index',
      'status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(initialStatus.ok, true)
    assert.equal(requireData(initialStatus).backend, 'sqlite')
    assert.equal(requireData(initialStatus).exists, false)
    assert.equal(requireData(initialStatus).dbPath, '.runtime/search.sqlite')

    const sqliteSearch = await runCli([
      'search',
      'query',
      '--text',
      'pasta',
      '--backend',
      'sqlite',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(sqliteSearch.ok, false)
    assert.match(
      sqliteSearch.error.message ?? '',
      /index rebuild|--backend scan/u,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search backend auto switches from scan results to sqlite-backed stale state after rebuild', async () => {
  const fixture = await makeRetrievalFixture()
  const journalFilePath = path.join(fixture.vaultRoot, fixture.journalPath)

  try {
    await writeFile(
      journalFilePath,
      `---
dayKey: 2026-03-12
title: March 12
tags:
  - focus
---
# March 12

Steady energy after electrolyte drink.
`,
      'utf8',
    )

    const autoBeforeRebuild = await runCli<{
      hits: Array<{ recordId: string }>
    }>([
      'search',
      'query',
      '--text',
      'electrolyte',
      '--backend',
      'auto',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(autoBeforeRebuild.ok, true)
    assert.equal(
      requireData(autoBeforeRebuild).hits.some(
        (hit) => hit.recordId === 'journal:2026-03-12',
      ),
      true,
    )

    const rebuild = await runCli([
      'search',
      'index',
      'rebuild',
      '--vault',
      fixture.vaultRoot,
    ])
    assert.equal(rebuild.ok, true)

    await writeFile(
      journalFilePath,
      `---
dayKey: 2026-03-12
title: March 12
tags:
  - focus
---
# March 12

Steady energy after saffron tea.
`,
      'utf8',
    )

    const autoAfterRebuild = await runCli<{
      total: number
      hits: Array<{ recordId: string }>
    }>([
      'search',
      'query',
      '--text',
      'saffron',
      '--backend',
      'auto',
      '--vault',
      fixture.vaultRoot,
    ])
    const scanAfterRebuild = await runCli<{
      hits: Array<{ recordId: string }>
    }>([
      'search',
      'query',
      '--text',
      'saffron',
      '--backend',
      'scan',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(autoAfterRebuild.ok, true)
    assert.equal(requireData(autoAfterRebuild).total, 0)
    assert.equal(scanAfterRebuild.ok, true)
    assert.equal(
      requireData(scanAfterRebuild).hits.some(
        (hit) => hit.recordId === 'journal:2026-03-12',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search accepts projected health record families', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli<{
      filters: {
        recordTypes: string[]
      }
      hits: Array<{
        recordId: string
        recordType: string
      }>
      total: number
    }>([
      'search',
      'query',
      '--text',
      'sleep',
      '--record-type',
      'history',
      '--record-type',
      'assessment',
      '--record-type',
      'goal',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.deepEqual(requireData(result).filters.recordTypes, [
      'history',
      'assessment',
      'goal',
    ])
    assert.deepEqual(
      new Set(requireData(result).hits.map((hit) => hit.recordType)),
      new Set(['history', 'assessment', 'goal']),
    )
    assert.equal(requireData(result).total, 3)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('timeline exposes projected health entry types', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli<{
      filters: {
        entryTypes: string[]
      }
      items: Array<{
        entryType: string
      }>
    }>([
      'timeline',
      '--entry-type',
      'assessment',
      '--entry-type',
      'history',
      '--entry-type',
      'profile_snapshot',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.deepEqual(requireData(result).filters.entryTypes, [
      'assessment',
      'history',
      'profile_snapshot',
    ])
    assert.deepEqual(
      requireData(result).items.map((item) => item.entryType),
      ['profile_snapshot', 'assessment', 'history'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search rejects unsupported record-type values', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'search',
      'query',
      '--text',
      'sleep',
      '--record-type',
      'not_a_real_record_type',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, false)
    assert.match(
      result.error.message ?? '',
      /unsupported value(?:s)? for --record-type/iu,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search rejects comma-delimited record-type tokens', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'search',
      'query',
      '--text',
      'sleep',
      '--record-type',
      'history,assessment',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, false)
    assert.match(
      result.error.message ?? '',
      /repeat the flag instead|comma-delimited values are not supported/iu,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('timeline rejects unsupported entry-type values', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'timeline',
      '--entry-type',
      'not_a_real_entry_type',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, false)
    assert.match(
      result.error.message ?? '',
      /unsupported value(?:s)? for --entry-type/iu,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('timeline rejects comma-delimited entry-type tokens', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'timeline',
      '--entry-type',
      'assessment,history',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, false)
    assert.match(
      result.error.message ?? '',
      /repeat the flag instead|comma-delimited values are not supported/iu,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
