import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { afterEach, test as baseTest, vi } from 'vitest'

import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import type {
  QueryRuntimeModule,
  QueryVaultReadModel,
} from '@murphai/vault-usecases/runtime'

import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerSearchCommands } from '../src/commands/search.js'
import { requireData, runInProcessJsonCli } from './cli-test-helpers.js'

const test = baseTest.sequential

const { loadQueryRuntimeMock } = vi.hoisted(() => ({
  loadQueryRuntimeMock: vi.fn(),
}))

vi.mock('@murphai/vault-usecases/runtime', async () => {
  const actual = await vi.importActual<typeof import('@murphai/vault-usecases/runtime')>(
    '@murphai/vault-usecases/runtime',
  )

  return {
    ...actual,
    loadQueryRuntime: loadQueryRuntimeMock,
  }
})

type SearchRuntime = Pick<
  QueryRuntimeModule,
  'buildTimeline' | 'getQueryProjectionStatus' | 'readVault' | 'rebuildQueryProjection' | 'searchVaultRuntime'
>

type TimelineCall = {
  filters: Parameters<SearchRuntime['buildTimeline']>[1]
  vault: QueryVaultReadModel
}

function createEmptyQueryVaultReadModel(vaultRoot: string): QueryVaultReadModel {
  return {
    format: 'murph.query.v1',
    vaultRoot,
    metadata: null,
    entities: [],
    byFamily: {},
    coreDocument: null,
    experiments: [],
    journalEntries: [],
    events: [],
    samples: [],
    audits: [],
    assessments: [],
    goals: [],
    conditions: [],
    allergies: [],
    protocols: [],
    familyMembers: [],
    geneticVariants: [],
    foods: [],
    recipes: [],
    providers: [],
    workoutFormats: [],
  }
}

function createSearchRuntime(input?: {
  timelineCalls?: TimelineCall[]
}): SearchRuntime {
  const searchHit = {
    recordId: 'goal_sleep_01',
    aliasIds: ['goal_sleep_01'],
    recordType: 'goal' as const,
    kind: 'goal',
    stream: null,
    title: 'Improve sleep quality',
    occurredAt: null,
    date: '2026-03-12',
    experimentSlug: 'sleep-reset',
    tags: ['sleep', 'focus'],
    path: 'bank/goals/improve-sleep.md',
    snippet: 'Improve sleep quality',
    score: 99,
    matchedTerms: ['sleep'],
    citation: {
      path: 'bank/goals/improve-sleep.md',
      recordId: 'goal_sleep_01',
      aliasIds: ['goal_sleep_01'],
    },
  }

  const timelineEntry = {
    id: 'entry_01',
    entryType: 'event' as const,
    occurredAt: '2026-03-12T12:45:00Z',
    date: '2026-03-12',
    title: 'Sleep clinic intake visit',
    kind: 'encounter',
    stream: null,
    experimentSlug: 'sleep-reset',
    path: 'ledger/events/2026/2026-03.jsonl',
    relatedIds: ['goal_sleep_01'],
    tags: ['sleep', 'clinic'],
    data: {
      title: 'Sleep clinic intake visit',
    },
  }

  return {
    async searchVaultRuntime(vaultRoot, query, filters) {
      assert.equal(vaultRoot, '/vaults/search')
      assert.equal(query, 'magnesium')
      assert.deepEqual(filters, {
        recordTypes: ['goal', 'event', 'sample'],
        kinds: ['goal', 'encounter'],
        streams: ['hrv', 'resting_heart_rate'],
        experimentSlug: 'sleep-reset',
        from: '2026-03-01',
        to: '2026-03-31',
        tags: ['sleep', 'focus'],
        limit: 3,
      })

      return {
        format: 'murph.search.v1',
        query,
        total: 1,
        hits: [searchHit],
      }
    },
    async getQueryProjectionStatus(vaultRoot) {
      assert.equal(vaultRoot, '/vaults/search')

      return {
        dbPath: '.runtime/projections/query.sqlite',
        exists: true,
        schemaVersion: '2026-04-08',
        builtAt: '2026-04-08T00:00:00.000Z',
        entityCount: 12,
        searchDocumentCount: 8,
        fresh: true,
      }
    },
    async readVault(vaultRoot) {
      return createEmptyQueryVaultReadModel(vaultRoot)
    },
    async rebuildQueryProjection(vaultRoot) {
      assert.equal(vaultRoot, '/vaults/search')

      return {
        dbPath: '.runtime/projections/query.sqlite',
        exists: true,
        schemaVersion: '2026-04-08',
        builtAt: '2026-04-08T00:00:00.000Z',
        entityCount: 12,
        searchDocumentCount: 8,
        fresh: true,
        rebuilt: true as const,
      }
    },
    buildTimeline(vault, filters) {
      input?.timelineCalls?.push({
        vault,
        filters,
      })
      return [timelineEntry]
    },
  }
}

function createSearchSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'search coverage cli',
    version: '0.0.0-test',
  })

  cli.use(incurErrorBridge)
  registerSearchCommands(cli, createUnwiredVaultServices())

  return cli
}

async function runSearchCli<TData>(
  cli: Cli.Cli,
  args: string[],
) {
  return await runInProcessJsonCli<TData>(cli, args, {
    env: process.env,
  })
}

afterEach(() => {
  loadQueryRuntimeMock.mockReset()
})

test('search query normalizes repeatable filters and rejects blank text', async () => {
  loadQueryRuntimeMock.mockResolvedValue(createSearchRuntime())
  const cli = createSearchSliceCli()

  const rejected = await runSearchCli(cli, [
    'search',
    'query',
    '--vault',
    '/vaults/search',
  ])
  assert.equal(rejected.envelope.ok, false)
  if (rejected.envelope.ok) {
    throw new Error('Expected search query to reject a missing text filter.')
  }
  assert.equal(rejected.envelope.error.code, 'invalid_query')

  const result = await runSearchCli<{
    filters: {
      recordTypes: string[]
      kinds: string[]
      streams: string[]
      experiment: string | null
      from: string | null
      to: string | null
      tags: string[]
      limit: number
    }
    hits: Array<{
      recordId: string
    }>
    query: string
    total: number
    vault: string
  }>(cli, [
    'search',
    'query',
    '--text',
    '  magnesium  ',
    '--record-type',
    'goal',
    '--record-type',
    'event',
    '--record-type',
    'sample',
    '--kind',
    'goal',
    '--kind',
    'encounter',
    '--stream',
    'hrv',
    '--stream',
    'resting_heart_rate',
    '--experiment',
    'sleep-reset',
    '--from',
    '2026-03-01',
    '--to',
    '2026-03-31',
    '--tag',
    'sleep',
    '--tag',
    'focus',
    '--limit',
    '3',
    '--vault',
    '/vaults/search',
  ])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(result.envelope.meta.command, 'search query')
  assert.equal(requireData(result.envelope).query, 'magnesium')
  assert.deepEqual(requireData(result.envelope).filters, {
    text: 'magnesium',
    recordTypes: ['goal', 'event', 'sample'],
    kinds: ['goal', 'encounter'],
    streams: ['hrv', 'resting_heart_rate'],
    experiment: 'sleep-reset',
    from: '2026-03-01',
    to: '2026-03-31',
    tags: ['sleep', 'focus'],
    limit: 3,
  })
  assert.deepEqual(requireData(result.envelope).hits, [
    {
      recordId: 'goal_sleep_01',
      aliasIds: ['goal_sleep_01'],
      recordType: 'goal',
      kind: 'goal',
      stream: null,
      title: 'Improve sleep quality',
      occurredAt: null,
      date: '2026-03-12',
      experimentSlug: 'sleep-reset',
      tags: ['sleep', 'focus'],
      path: 'bank/goals/improve-sleep.md',
      snippet: 'Improve sleep quality',
      score: 99,
      matchedTerms: ['sleep'],
      citation: {
        path: 'bank/goals/improve-sleep.md',
        recordId: 'goal_sleep_01',
        aliasIds: ['goal_sleep_01'],
      },
    },
  ])
})

test('search query omits optional repeatable filters when none are provided', async () => {
  loadQueryRuntimeMock.mockResolvedValue({
    ...createSearchRuntime(),
    async searchVaultRuntime(
      vaultRoot: string,
      query: string,
      filters: {
        experimentSlug?: string
        from?: string
        kinds?: string[]
        limit: number
        recordTypes?: string[]
        streams?: string[]
        tags?: string[]
        to?: string
      },
    ) {
      assert.equal(vaultRoot, '/vaults/search')
      assert.equal(query, 'sleep quality')
      assert.deepEqual(filters, {
        recordTypes: undefined,
        kinds: undefined,
        streams: undefined,
        experimentSlug: undefined,
        from: undefined,
        to: undefined,
        tags: undefined,
        limit: 20,
      })

      return {
        format: 'murph.search.v1',
        query,
        total: 0,
        hits: [],
      }
    },
  })
  const cli = createSearchSliceCli()

  const result = await runSearchCli<{
    filters: {
      experiment: string | null
      from: string | null
      kinds: string[]
      limit: number
      recordTypes: string[]
      streams: string[]
      tags: string[]
      text: string
      to: string | null
    }
    total: number
  }>(cli, [
    'search',
    'query',
    '--text',
    'sleep quality',
    '--vault',
    '/vaults/search',
  ])

  assert.equal(result.envelope.ok, true)
  assert.equal(result.envelope.meta.command, 'search query')
  assert.equal(requireData(result.envelope).total, 0)
  assert.deepEqual(requireData(result.envelope).filters, {
    text: 'sleep quality',
    recordTypes: [],
    kinds: [],
    streams: [],
    experiment: null,
    from: null,
    to: null,
    tags: [],
    limit: 20,
  })
})

test('query projection status and rebuild use the shared query runtime', async () => {
  loadQueryRuntimeMock.mockResolvedValue(createSearchRuntime())
  const cli = createSearchSliceCli()

  const status = await runSearchCli<{
    builtAt: string | null
    dbPath: string
    entityCount: number
    exists: boolean
    fresh: boolean
    searchDocumentCount: number
    schemaVersion: string | null
    vault: string
  }>(cli, [
    'query',
    'projection',
    'status',
    '--vault',
    '/vaults/search',
  ])

  assert.equal(status.envelope.ok, true)
  assert.equal(status.envelope.meta.command, 'query projection status')
  assert.equal(requireData(status.envelope).vault, '/vaults/search')
  assert.equal(requireData(status.envelope).fresh, true)

  const rebuild = await runSearchCli<{
    rebuilt: true
    vault: string
    dbPath: string
    entityCount: number
    exists: boolean
    fresh: boolean
    searchDocumentCount: number
    schemaVersion: string | null
  }>(cli, [
    'query',
    'projection',
    'rebuild',
    '--vault',
    '/vaults/search',
  ])

  assert.equal(rebuild.envelope.ok, true)
  assert.equal(rebuild.envelope.meta.command, 'query projection rebuild')
  assert.equal(requireData(rebuild.envelope).rebuilt, true)
})

test('timeline forwards repeatable filters and selective entry types', async () => {
  const timelineCalls: TimelineCall[] = []
  loadQueryRuntimeMock.mockResolvedValue(createSearchRuntime({
    timelineCalls,
  }))
  const cli = createSearchSliceCli()

  const defaultTimeline = await runSearchCli<{
    filters: {
      entryTypes: string[]
      experiment: string | null
      from: string | null
      kinds: string[]
      limit: number
      streams: string[]
      to: string | null
    }
    items: Array<{
      id: string
    }>
    vault: string
  }>(cli, [
    'timeline',
    '--vault',
    '/vaults/search',
  ])

  assert.equal(defaultTimeline.envelope.ok, true)
  assert.equal(defaultTimeline.envelope.meta.command, 'timeline')
  assert.deepEqual(requireData(defaultTimeline.envelope).filters, {
    from: null,
    to: null,
    experiment: null,
    kinds: [],
    streams: [],
    entryTypes: [],
    limit: 200,
  })
  assert.equal(requireData(defaultTimeline.envelope).items[0]?.id, 'entry_01')
  assert.deepEqual(timelineCalls[0]?.filters, {
    from: undefined,
    to: undefined,
    experimentSlug: undefined,
    kinds: undefined,
    streams: undefined,
    includeJournal: true,
    includeEvents: true,
    includeAssessments: true,
    includeDailySampleSummaries: true,
    limit: 200,
  })

  const filteredTimeline = await runSearchCli<{
    filters: {
      entryTypes: string[]
      experiment: string | null
      from: string | null
      kinds: string[]
      limit: number
      streams: string[]
      to: string | null
    }
    items: Array<{
      id: string
    }>
    vault: string
  }>(cli, [
    'timeline',
    '--from',
    '2026-03-01',
    '--to',
    '2026-03-31',
    '--experiment',
    'sleep-reset',
    '--kind',
    'encounter',
    '--stream',
    'hrv',
    '--entry-type',
    'event',
    '--entry-type',
    'sample_summary',
    '--limit',
    '25',
    '--vault',
    '/vaults/search',
  ])

  assert.equal(filteredTimeline.envelope.ok, true)
  assert.equal(filteredTimeline.envelope.meta.command, 'timeline')
  assert.deepEqual(requireData(filteredTimeline.envelope).filters, {
    from: '2026-03-01',
    to: '2026-03-31',
    experiment: 'sleep-reset',
    kinds: ['encounter'],
    streams: ['hrv'],
    entryTypes: ['event', 'sample_summary'],
    limit: 25,
  })
  assert.deepEqual(timelineCalls[1]?.filters, {
    from: '2026-03-01',
    to: '2026-03-31',
    experimentSlug: 'sleep-reset',
    kinds: ['encounter'],
    streams: ['hrv'],
    includeJournal: false,
    includeEvents: true,
    includeAssessments: false,
    includeDailySampleSummaries: true,
    limit: 25,
  })
})
