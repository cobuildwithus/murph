import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { requireData, runCli, runRawCli } from './cli-test-helpers.js'

test('experiment help uses generic id selectors while journal keeps date selectors', async () => {
  const experimentShowHelp = await runRawCli(['experiment', 'show', '--help'])
  const experimentStopHelp = await runRawCli(['experiment', 'stop', '--help'])
  const journalShowHelp = await runRawCli(['journal', 'show', '--help'])

  assert.match(experimentShowHelp, /Usage: vault-cli experiment show <id> \[options\]/u)
  assert.match(experimentStopHelp, /Usage: vault-cli experiment stop <id> \[options\]/u)
  assert.match(journalShowHelp, /Usage: vault-cli journal show <date> \[options\]/u)
})

test.sequential(
  'experiment create accepts richer frontmatter options and experiment reads resolve by slug or id',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-'))

    try {
      const initResult = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const activeExperiment = await runCli<{
        experimentId: string
        experimentPath: string
      }>([
        'experiment',
        'create',
        'focus-sprint',
        '--title',
        'Focus Sprint',
        '--hypothesis',
        'Evening walks reduce the afternoon crash.',
        '--started-on',
        '2026-03-10',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])
      const completedExperiment = await runCli<{
        experimentId: string
      }>([
        'experiment',
        'create',
        'magnesium-trial',
        '--title',
        'Magnesium Trial',
        '--hypothesis',
        'Nighttime magnesium improves sleep onset.',
        '--started-on',
        '2026-03-11',
        '--status',
        'completed',
        '--vault',
        vaultRoot,
      ])

      const showBySlug = await runCli<{
        entity: {
          id: string
          kind: string
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'experiment',
        'show',
        'focus-sprint',
        '--vault',
        vaultRoot,
      ])
      const showById = await runCli<{
        entity: {
          id: string
          title: string | null
        }
      }>([
        'experiment',
        'show',
        requireData(completedExperiment).experimentId,
        '--vault',
        vaultRoot,
      ])
      const completedList = await runCli<{
        filters: {
          status: string | null
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
        }>
      }>([
        'experiment',
        'list',
        '--status',
        'completed',
        '--vault',
        vaultRoot,
      ])

      assert.equal(activeExperiment.ok, true)
      assert.equal(activeExperiment.meta?.command, 'experiment create')
      assert.match(requireData(activeExperiment).experimentPath, /bank\/experiments\/focus-sprint\.md/u)
      assert.equal(completedExperiment.ok, true)

      assert.equal(showBySlug.ok, true)
      assert.equal(showBySlug.meta?.command, 'experiment show')
      assert.equal(requireData(showBySlug).entity.id, requireData(activeExperiment).experimentId)
      assert.equal(requireData(showBySlug).entity.kind, 'experiment')
      assert.equal(requireData(showBySlug).entity.title, 'Focus Sprint')
      assert.equal(requireData(showBySlug).entity.data.startedOn, '2026-03-10')
      assert.equal(requireData(showBySlug).entity.data.status, 'active')
      assert.equal(
        requireData(showBySlug).entity.data.hypothesis,
        'Evening walks reduce the afternoon crash.',
      )

      assert.equal(showById.ok, true)
      assert.equal(requireData(showById).entity.id, requireData(completedExperiment).experimentId)
      assert.equal(requireData(showById).entity.title, 'Magnesium Trial')

      assert.equal(completedList.ok, true)
      assert.equal(requireData(completedList).filters.status, 'completed')
      assert.equal(requireData(completedList).count, 1)
      assert.deepEqual(
        requireData(completedList).items.map((item) => item.id),
        [requireData(completedExperiment).experimentId],
      )
      assert.deepEqual(
        requireData(completedList).items.map((item) => item.kind),
        ['experiment'],
      )
      assert.equal(requireData(completedList).items[0]?.data.status, 'completed')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'journal show and list read journal pages by day and date range',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-journal-'))

    try {
      await runCli(['init', '--vault', vaultRoot])

      const firstJournal = await runCli([
        'journal',
        'ensure',
        '2026-03-10',
        '--vault',
        vaultRoot,
      ])
      const secondJournal = await runCli([
        'journal',
        'ensure',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])

      const showResult = await runCli<{
        entity: {
          id: string
          kind: string
          data: Record<string, unknown>
        }
      }>([
        'journal',
        'show',
        '2026-03-10',
        '--vault',
        vaultRoot,
      ])
      const rangedList = await runCli<{
        filters: {
          kind?: string
          from?: string
          to?: string
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
        }>
      }>([
        'journal',
        'list',
        '--from',
        '2026-03-11',
        '--to',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])

      assert.equal(firstJournal.ok, true)
      assert.equal(secondJournal.ok, true)

      assert.equal(showResult.ok, true)
      assert.equal(showResult.meta?.command, 'journal show')
      assert.equal(requireData(showResult).entity.id, 'journal:2026-03-10')
      assert.equal(requireData(showResult).entity.kind, 'journal_day')
      assert.equal(requireData(showResult).entity.data.dayKey, '2026-03-10')

      assert.equal(rangedList.ok, true)
      assert.equal(requireData(rangedList).filters.kind, 'journal_day')
      assert.equal(requireData(rangedList).filters.from, '2026-03-11')
      assert.equal(requireData(rangedList).filters.to, '2026-03-12')
      assert.equal(requireData(rangedList).count, 1)
      assert.deepEqual(
        requireData(rangedList).items.map((item) => item.id),
        ['journal:2026-03-12'],
      )
      assert.deepEqual(
        requireData(rangedList).items.map((item) => item.kind),
        ['journal_day'],
      )
      assert.equal(requireData(rangedList).items[0]?.data.dayKey, '2026-03-12')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'vault show, stats, and paths surface read-only vault metadata and counts',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-vault-'))

    try {
      await runCli(['init', '--vault', vaultRoot])
      await runCli([
        'experiment',
        'create',
        'focus-sprint',
        '--title',
        'Focus Sprint',
        '--started-on',
        '2026-03-10',
        '--vault',
        vaultRoot,
      ])
      await runCli([
        'journal',
        'ensure',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])

      const showResult = await runCli<{
        schemaVersion: string | null
        vaultId: string | null
        title: string | null
        corePath: string | null
        coreTitle: string | null
      }>([
        'vault',
        'show',
        '--vault',
        vaultRoot,
      ])
      const statsResult = await runCli<{
        counts: {
          experiments: number
          journalEntries: number
          events: number
          audits: number
        }
        latest: {
          journalDate: string | null
          experimentTitle: string | null
        }
      }>([
        'vault',
        'stats',
        '--vault',
        vaultRoot,
      ])
      const pathsResult = await runCli<{
        paths: Record<string, unknown> | null
        shards: Record<string, unknown> | null
      }>([
        'vault',
        'paths',
        '--vault',
        vaultRoot,
      ])

      assert.equal(showResult.ok, true)
      assert.equal(showResult.meta?.command, 'vault show')
      assert.match(requireData(showResult).schemaVersion ?? '', /^hb\./u)
      assert.match(requireData(showResult).vaultId ?? '', /^vault_/u)
      assert.equal(requireData(showResult).corePath, 'CORE.md')
      assert.equal(requireData(showResult).title !== null, true)
      assert.equal(requireData(showResult).coreTitle !== null, true)

      assert.equal(statsResult.ok, true)
      assert.equal(statsResult.meta?.command, 'vault stats')
      assert.equal(requireData(statsResult).counts.experiments, 1)
      assert.equal(requireData(statsResult).counts.journalEntries, 1)
      assert.equal(requireData(statsResult).counts.events >= 1, true)
      assert.equal(requireData(statsResult).counts.audits >= 1, true)
      assert.equal(requireData(statsResult).latest.journalDate, '2026-03-12')
      assert.equal(requireData(statsResult).latest.experimentTitle, 'Focus Sprint')

      assert.equal(pathsResult.ok, true)
      assert.equal(pathsResult.meta?.command, 'vault paths')
      assert.equal(requireData(pathsResult).paths?.experimentsRoot, 'bank/experiments')
      assert.equal(
        requireData(pathsResult).shards?.events,
        'ledger/events/YYYY/YYYY-MM.jsonl',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
