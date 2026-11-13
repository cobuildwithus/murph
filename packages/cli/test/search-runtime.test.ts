import { listCanonicalSourceManifest } from '@murphai/query'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { localParallelCliTest as test } from './local-parallel-test.js'
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
const UTC_CLI_ENV = {
  ...process.env,
  TZ: 'UTC',
}
const require = createRequire(import.meta.url)

interface RetrievalFixture {
  journalPath: string
  mealId: string
  vaultRoot: string
}

interface MetricRetrievalFixture extends RetrievalFixture {
  metricSampleId: string
}

async function makeCanonicalHealthFixture(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-canonical-'))

  await writeVaultFile(
    vaultRoot,
    'ledger/assessments/2026/2026-03.jsonl',
    `${JSON.stringify({
      schemaVersion: 'murph.assessment-response.v1',
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
    'ledger/events/2026/2026-03.jsonl',
    `${JSON.stringify({
      schemaVersion: 'murph.event.v1',
      id: 'evt_health_event_01',
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

async function makeRetrievalFixture(): Promise<MetricRetrievalFixture> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-retrieval-'))
  const csvPath = path.join(vaultRoot, 'heart-rate.csv')
  const metricSampleId = 'smp_cli_metric_heart_rate_summary'

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
  ], { env: UTC_CLI_ENV })
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)

  const journalResult = await runCli<{ journalPath: string }>([
    'journal',
    'ensure',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ], { env: UTC_CLI_ENV })
  assert.equal(journalResult.ok, true)

  await writeFile(
    path.join(vaultRoot, requireData(journalResult).journalPath),
    `---
dayKey: 2026-03-12
title: March 12
experimentSlug: retrieval-study
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
    '--name', 'Sample meal',
    '--photo',
    sampleDocumentPath,
    '--note',
    'Pasta lunch and coffee. Afternoon crash afterward.',
    '--occurred-at',
    '2026-03-12T12:15:00Z',
    '--vault',
    vaultRoot,
  ], { env: UTC_CLI_ENV })
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
  ], { env: UTC_CLI_ENV })
  assert.equal(samplesResult.ok, true)
  assert.equal(requireData(samplesResult).lookupIds.length, 2)

  await writeVaultFile(
    vaultRoot,
    'ledger/metric-samples/heart_rate/2026/2026-03.jsonl',
    [
      JSON.stringify({
        schemaVersion: 'murph.metric-sample.v1',
        id: metricSampleId,
        metric: 'heart_rate',
        recordedAt: '2026-03-12T21:00:00.000Z',
        dayKey: '2026-03-12',
        source: 'manual',
        quality: 'normalized',
        qualifiers: { summary: true },
        value: 69,
        unit: 'bpm',
      }),
      '',
    ].join('\n'),
  )

  return {
    journalPath: requireData(journalResult).journalPath,
    mealId: requireData(mealResult).mealId,
    metricSampleId,
    vaultRoot,
  }
}

async function makeSourceRetrievalFixture(): Promise<RetrievalFixture> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-retrieval-'))
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
  ], { env: UTC_CLI_ENV })
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)

  const journalResult = await runSourceCli<{ journalPath: string }>([
    'journal',
    'ensure',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ], { env: UTC_CLI_ENV })
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
    '--name', 'Sample meal',
    '--photo',
    sampleDocumentPath,
    '--note',
    'Pasta lunch and coffee. Afternoon crash afterward.',
    '--occurred-at',
    '2026-03-12T12:15:00Z',
    '--vault',
    vaultRoot,
  ], { env: UTC_CLI_ENV })
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
  ], { env: UTC_CLI_ENV })
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

test('search returns lexical hits and excludes raw sample rows by default', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    const result = await runCli<{
      hits: Array<Record<string, unknown> & {
        aliasIds?: string[]
        recordId: string
        recordType: string
        snippet: string
      }>
      total: number
    }>([
      'search',
      'query',
      'afternoon crash pasta',
      '--limit',
      '10',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(result.meta?.command, 'search query')
    assert.deepEqual(Object.keys(requireData(result)).sort(), ['hits', 'total'])
    assert.equal(requireData(result).total, 2)
    for (const hit of requireData(result).hits) {
      for (const omitted of ['citation', 'matchedTerms', 'path', 'score']) {
        assert.equal(Object.hasOwn(hit, omitted), false, omitted)
      }
      for (const kept of ['date', 'kind', 'occurredAt', 'recordId', 'recordType', 'snippet', 'tags', 'title']) {
        assert.equal(Object.hasOwn(hit, kept), true, kept)
      }
      for (const nullable of ['experimentSlug', 'stream']) {
        assert.notEqual(hit[nullable], null, nullable)
      }
      if (hit.aliasIds) {
        assert.ok(hit.aliasIds.some((id) => id !== hit.recordId))
      }
    }
    assert.equal(
      requireData(result).hits.find((hit) => hit.recordId === 'journal:2026-03-12')?.experimentSlug,
      'retrieval-study',
    )
    assert.deepEqual(
      new Set(requireData(result).hits.map((hit) => hit.recordId)),
      new Set(['journal:2026-03-12', fixture.mealId]),
    )
    for (const { flags, expectedIds } of [
      { flags: ['--record-type', 'event'], expectedIds: [fixture.mealId] },
      { flags: ['--tag', 'focus'], expectedIds: ['journal:2026-03-12'] },
      { flags: ['--kind', 'meal'], expectedIds: [fixture.mealId] },
      { flags: ['--experiment', 'retrieval-study'], expectedIds: ['journal:2026-03-12'] },
      { flags: ['--experiment', 'unrelated-experiment'], expectedIds: [] },
      {
        flags: ['--record-type', 'event', '--record-type', 'journal'],
        expectedIds: [fixture.mealId, 'journal:2026-03-12'],
      },
    ]) {
      const filtered = await runCli<{ hits: Array<{ recordId: string }> }>([
        'search', 'query', 'afternoon crash pasta',
        ...flags, '--vault', fixture.vaultRoot,
      ])
      assert.equal(filtered.ok, true)
      assert.deepEqual(
        requireData(filtered).hits.map((hit) => hit.recordId).sort(),
        [...expectedIds].sort(),
        flags.join(' '),
      )
    }
    assert.match(requireData(result).hits[0]?.snippet ?? '', /afternoon crash|pasta/i)
    assert.equal(
      requireData(result).hits.some((hit) => hit.recordType === 'sample'),
      false,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('search query accepts matching positional and named text on the built CLI', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    const result = await runCli<{
      total: number
    }>([
      'search',
      'query',
      'afternoon crash pasta',
      '--text',
      'afternoon crash pasta',
      '--limit',
      '10',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.equal(result.meta?.command, 'search query')
    assert.equal(requireData(result).total, 2)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('search query rejects blank and conflicting input through the real CLI', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    for (const input of [
      ['--text', '   '],
      ['afternoon crash pasta', '--text', '   '],
      ['   ', '--text', 'afternoon crash pasta'],
      ['afternoon crash pasta', '--text', 'different query'],
    ]) {
      const result = await runCli([
        'search', 'query', ...input, '--vault', fixture.vaultRoot,
      ])
      assert.equal(result.ok, false, JSON.stringify(input))
      assert.equal(result.error?.code, 'invalid_query', JSON.stringify(input))
    }
    assert.equal(
      existsSync(path.join(fixture.vaultRoot, '.runtime/projections/query-entities.sqlite')),
      false,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('search applies date bounds', async () => {
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

test('search includes query-visible metric sample rows when the caller scopes by stream', async () => {
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
        (hit) =>
          hit.recordId === fixture.metricSampleId &&
          hit.recordType === 'sample' &&
          hit.stream === 'heart_rate',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('timeline merges journals, events, and metric sample summaries into one descending feed', async () => {
  const fixture = await makeRetrievalFixture()

  try {
    const result = await runCli<{
      items: Array<Record<string, unknown> & {
        entryType: string
        id: string
        relatedIds?: string[]
        stream?: string
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
    assert.deepEqual(Object.keys(requireData(result)), ['items'])
    for (const item of requireData(result).items) {
      assert.equal(Object.hasOwn(item, 'path'), false)
      for (const nullable of ['experimentSlug', 'stream']) {
        assert.notEqual(item[nullable], null, nullable)
      }
      if (item.relatedIds) {
        assert.ok(item.relatedIds.some((id) => id !== item.id))
      }
    }
    assert.equal(
      requireData(result).items.find((item) => item.id === 'journal:2026-03-12')?.experimentSlug,
      'retrieval-study',
    )
    assert.deepEqual(
      requireData(result).items.slice(0, 3).map((item) => [item.entryType, item.id]),
      [
        ['sample_summary', 'sample-summary:2026-03-12:heart_rate:bpm'],
        ['event', fixture.mealId],
        ['journal', 'journal:2026-03-12'],
      ],
    )
    assert.equal(requireData(result).items[0]?.stream, 'heart_rate')
    for (const item of requireData(result).items) {
      assert.equal(Object.hasOwn(item, 'data'), false)
    }

    for (const { flags, expectedIds } of [
      {
        flags: ['--entry-type', 'event', '--entry-type', 'sample_summary'],
        expectedIds: ['sample-summary:2026-03-12:heart_rate:bpm', fixture.mealId],
      },
      { flags: ['--entry-type', 'journal'], expectedIds: ['journal:2026-03-12'] },
      { flags: ['--kind', 'meal'], expectedIds: [fixture.mealId] },
      {
        flags: ['--entry-type', 'sample_summary', '--stream', 'heart_rate'],
        expectedIds: ['sample-summary:2026-03-12:heart_rate:bpm'],
      },
      { flags: ['--entry-type', 'sample_summary', '--stream', 'hrv'], expectedIds: [] },
      { flags: ['--entry-type', 'journal', '--experiment', 'retrieval-study'], expectedIds: ['journal:2026-03-12'] },
      { flags: ['--entry-type', 'journal', '--experiment', 'unrelated-experiment'], expectedIds: [] },
      { flags: ['--limit', '1'], expectedIds: ['sample-summary:2026-03-12:heart_rate:bpm'] },
    ]) {
      const filtered = await runCli<{ items: Array<{ id: string }>; limit?: number }>([
        'timeline', '--from', '2026-03-12', '--to', '2026-03-12',
        ...flags, '--vault', fixture.vaultRoot,
      ])
      assert.equal(filtered.ok, true)
      assert.deepEqual(
        requireData(filtered).items.map((item) => item.id),
        expectedIds,
        flags.join(' '),
      )
      // Only a full page names its limit, so a truncated read is visible.
      assert.equal(requireData(filtered).limit, flags.includes('--limit') ? 1 : undefined, flags.join(' '))
      for (const item of requireData(filtered).items) {
        assert.equal(Object.hasOwn(item, 'data'), false)
      }
    }
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('query projection status and rebuild expose the shared local projection without creating it early', async () => {
  const fixture = await makeRetrievalFixture()
  const runtimeDatabasePath = path.join(fixture.vaultRoot, '.runtime/projections/query-entities.sqlite')

  try {
    assert.equal(existsSync(runtimeDatabasePath), false)

    const initialStatus = await runCli<{
      exists: boolean
      dbPath: string
      entityCount: number
      searchDocumentCount: number
      fresh: boolean
    }>([
      'query',
      'projection',
      'status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(initialStatus.ok, true)
    assert.equal(requireData(initialStatus).exists, false)
    assert.equal(requireData(initialStatus).dbPath, '.runtime/projections/query-entities.sqlite')
    assert.equal(existsSync(runtimeDatabasePath), false)

    const rebuild = await runCli<{
      exists: boolean
      rebuilt: boolean
      dbPath: string
      entityCount: number
      searchDocumentCount: number
      fresh: boolean
    }>([
      'query',
      'projection',
      'rebuild',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(rebuild.ok, true)
    assert.equal(requireData(rebuild).exists, true)
    assert.equal(requireData(rebuild).rebuilt, true)
    assert.equal(requireData(rebuild).dbPath, '.runtime/projections/query-entities.sqlite')
    assert.equal(requireData(rebuild).entityCount > 0, true)
    assert.equal(requireData(rebuild).searchDocumentCount > 0, true)
    assert.equal(requireData(rebuild).fresh, true)
    assert.equal(existsSync(runtimeDatabasePath), true)

    const indexedSearch = await runCli<{
      hits: Array<{ recordId: string; recordType: string; stream: string | null }>
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

    assert.equal(indexedSearch.ok, true)
    assert.equal(
      requireData(indexedSearch).hits.some(
        (hit) =>
          hit.recordId === fixture.metricSampleId &&
          hit.recordType === 'sample' &&
          hit.stream === 'heart_rate',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('query projection status ignores inbox runtime sqlite state and rebuild leaves it untouched', async () => {
  const fixture = await makeRetrievalFixture()
  const queryDatabasePath = path.join(fixture.vaultRoot, '.runtime/projections/query-entities.sqlite')
  const inboxDatabasePath = path.join(fixture.vaultRoot, '.runtime/projections/inboxd.sqlite')

  try {
    await mkdir(path.dirname(inboxDatabasePath), { recursive: true })
    const inboxDatabase = openDatabaseSync(inboxDatabasePath)
    inboxDatabase.exec('CREATE TABLE inbox_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);')
    inboxDatabase
      .prepare('INSERT INTO inbox_state (id, value) VALUES (?, ?)')
      .run('cursor', '{"offset":1}')
    inboxDatabase.close()

    const status = await runCli<{
      exists: boolean
      dbPath: string
    }>([
      'query',
      'projection',
      'status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(status.ok, true)
    assert.equal(requireData(status).exists, false)
    assert.equal(requireData(status).dbPath, '.runtime/projections/query-entities.sqlite')

    const rebuilt = await runCli<{
      exists: boolean
      rebuilt: boolean
      dbPath: string
    }>([
      'query',
      'projection',
      'rebuild',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(rebuilt.ok, true)
    assert.equal(requireData(rebuilt).exists, true)
    assert.equal(requireData(rebuilt).rebuilt, true)
    assert.equal(requireData(rebuilt).dbPath, '.runtime/projections/query-entities.sqlite')
    assert.equal(existsSync(queryDatabasePath), true)

    const inboxStateDatabase = openDatabaseSync(inboxDatabasePath)
    const inboxState = inboxStateDatabase
      .prepare('SELECT value FROM inbox_state WHERE id = ?')
      .get('cursor') as { value: string } | undefined
    inboxStateDatabase.close()

    assert.equal(inboxState?.value, '{"offset":1}')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('search query refreshes its entity section automatically when canonical files change', async () => {
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
      'query',
      'projection',
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
      '--vault',
      fixture.vaultRoot,
    ])
    const projectionStatus = await runCli<{
      fresh: boolean
    }>([
      'query',
      'projection',
      'status',
      '--vault',
      fixture.vaultRoot,
    ])

    assert.equal(autoAfterRebuild.ok, true)
    assert.equal(
      requireData(autoAfterRebuild).hits.some(
        (hit) => hit.recordId === 'journal:2026-03-12',
      ),
      true,
    )
    assert.equal(projectionStatus.ok, true)
    assert.equal(requireData(projectionStatus).fresh, false)
    const manifest = await listCanonicalSourceManifest(fixture.vaultRoot)
    const certificate = JSON.stringify(manifest.map(({ relativePath, sizeBytes, mtimeMs }) =>
      [relativePath, sizeBytes, mtimeMs]))
    for (const section of ['entities', 'metrics', 'wearables']) {
      const database = openDatabaseSync(path.join(fixture.vaultRoot, `.runtime/projections/query-${section}.sqlite`))
      try {
        const stored = database.prepare("SELECT value FROM query_meta WHERE key = 'source_manifest'").get()?.value
        if (section === 'entities') assert.equal(stored, certificate)
        else assert.notEqual(stored, certificate)
      } finally { database.close() }
    }
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test('search accepts projected health record families', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli<{
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
      'assessment',
      '--record-type',
      'event',
      '--record-type',
      'goal',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.deepEqual(
      new Set(requireData(result).hits.map((hit) => hit.recordType)),
      new Set(['assessment', 'event', 'goal']),
    )
    assert.equal(requireData(result).total, 3)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('timeline exposes projected health entry types', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli<{
      items: Array<{
        entryType: string
      }>
    }>([
      'timeline',
      '--entry-type',
      'assessment',
      '--entry-type',
      'event',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.ok, true)
    assert.deepEqual(
      requireData(result).items.map((item) => item.entryType),
      ['assessment', 'event'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('search rejects audit because it is not part of the query projection', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'search',
      'query',
      '--text',
      'sleep',
      '--record-type',
      'audit',
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

test('search rejects comma-delimited record-type tokens', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'search',
      'query',
      '--text',
      'sleep',
      '--record-type',
      'event,assessment',
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

test('timeline rejects unsupported entry-type values', async () => {
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

test('timeline rejects comma-delimited entry-type tokens', async () => {
  const vaultRoot = await makeCanonicalHealthFixture()

  try {
    const result = await runCli([
      'timeline',
      '--entry-type',
      'assessment,event',
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

function openDatabaseSync(databasePath: string): DatabaseSync {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(databasePath)
}
