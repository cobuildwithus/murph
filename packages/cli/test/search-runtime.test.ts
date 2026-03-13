import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { repoRoot, requireData, runCli } from './cli-test-helpers.js'

const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)

interface RetrievalFixture {
  journalPath: string
  mealId: string
  vaultRoot: string
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
      '--text',
      'afternoon crash pasta',
      '--limit',
      '10',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(result.meta?.command, 'search')
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
        ['sample_summary', 'sample-summary:2026-03-12:heart_rate'],
        ['event', fixture.mealId],
        ['journal', 'journal:2026-03-12'],
      ],
    )
    assert.equal(requireData(result).items[0]?.stream, 'heart_rate')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('search index-status and index-rebuild expose the shared sqlite runtime state without creating it early', async () => {
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
      'index-status',
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
      'index-rebuild',
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

test.sequential('search index-status keeps a legacy inbox search db readable until index-rebuild writes the canonical search db', async () => {
  const fixture = await makeRetrievalFixture()
  const searchDatabasePath = path.join(fixture.vaultRoot, '.runtime/search.sqlite')
  const legacyDatabasePath = path.join(fixture.vaultRoot, '.runtime/inboxd.sqlite')

  try {
    const initialRebuild = await runCli<{
      dbPath: string
      rebuilt: boolean
    }>([
      'search',
      'index-rebuild',
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
      'index-status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(legacyStatus.ok, true)
    assert.equal(requireData(legacyStatus).backend, 'sqlite')
    assert.equal(requireData(legacyStatus).exists, true)
    assert.equal(requireData(legacyStatus).dbPath, '.runtime/inboxd.sqlite')

    const sqliteSearch = await runCli<{
      filters: { backend: string }
      hits: Array<{ recordId: string }>
    }>([
      'search',
      '--text',
      'heart_rate',
      '--backend',
      'sqlite',
      '--stream',
      'heart_rate',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(sqliteSearch.ok, true)
    assert.equal(requireData(sqliteSearch).filters.backend, 'sqlite')
    assert.equal(
      requireData(sqliteSearch).hits.some((hit) => hit.recordId.startsWith('smp_')),
      true,
    )

    const rebuilt = await runCli<{
      backend: string
      exists: boolean
      rebuilt: boolean
      dbPath: string
    }>([
      'search',
      'index-rebuild',
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

test.sequential('search index-status treats a pre-existing inbox runtime db as unindexed and sqlite backend returns operator guidance', async () => {
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
      'index-status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(initialStatus.ok, true)
    assert.equal(requireData(initialStatus).backend, 'sqlite')
    assert.equal(requireData(initialStatus).exists, false)
    assert.equal(requireData(initialStatus).dbPath, '.runtime/search.sqlite')

    const sqliteSearch = await runCli([
      'search',
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
      /index-rebuild|--backend scan/u,
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
      'index-rebuild',
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
