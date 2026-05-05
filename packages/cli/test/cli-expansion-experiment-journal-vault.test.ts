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
  'experiment start accepts typed frontmatter options and experiment reads resolve by slug or id',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-'))

    try {
      const initResult = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const activeExperiment = await runCli<{
        experiment: {
          experimentId: string
          experimentPath: string
        } | null
      }>([
        'experiment',
        'start',
        'focus-sprint',
        '--title',
        'Focus Sprint',
        '--hypothesis',
        'Evening walks reduce the afternoon crash.',
        '--started-on',
        '2026-03-10',
        '--status',
        'active',
        '--intervention-start',
        '2026-03-10',
        '--intervention-days',
        '7',
        '--primary-biomarker-key',
        'biomarker:sleep-efficiency',
        '--vault',
        vaultRoot,
      ])
      const completedExperiment = await runCli<{
        experiment: {
          experimentId: string
        } | null
      }>([
        'experiment',
        'start',
        'magnesium-trial',
        '--title',
        'Magnesium Trial',
        '--hypothesis',
        'Nighttime magnesium improves sleep onset.',
        '--started-on',
        '2026-03-11',
        '--status',
        'completed',
        '--intervention-start',
        '2026-03-11',
        '--intervention-days',
        '7',
        '--primary-biomarker-key',
        'biomarker:sleep-efficiency',
        '--vault',
        vaultRoot,
      ])
      const activeExperimentData = requireData(activeExperiment).experiment
      const completedExperimentData = requireData(completedExperiment).experiment

      assert.ok(activeExperimentData)
      assert.ok(completedExperimentData)

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
        completedExperimentData.experimentId,
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
      assert.equal(activeExperiment.meta?.command, 'experiment start')
      assert.match(activeExperimentData.experimentPath, /bank\/experiments\/focus-sprint\.md/u)
      assert.equal(completedExperiment.ok, true)

      assert.equal(showBySlug.ok, true)
      assert.equal(showBySlug.meta?.command, 'experiment show')
      assert.equal(requireData(showBySlug).entity.id, activeExperimentData.experimentId)
      assert.equal(requireData(showBySlug).entity.kind, 'experiment')
      assert.equal(requireData(showBySlug).entity.title, 'Focus Sprint')
      assert.equal(requireData(showBySlug).entity.data.startedOn, '2026-03-10')
      assert.equal(requireData(showBySlug).entity.data.status, 'active')
      assert.equal(
        requireData(showBySlug).entity.data.hypothesis,
        'Evening walks reduce the afternoon crash.',
      )

      assert.equal(showById.ok, true)
      assert.equal(requireData(showById).entity.id, completedExperimentData.experimentId)
      assert.equal(requireData(showById).entity.title, 'Magnesium Trial')

      assert.equal(completedList.ok, true)
      assert.equal(requireData(completedList).filters.status, 'completed')
      assert.equal(requireData(completedList).count, 1)
      assert.deepEqual(
        requireData(completedList).items.map((item) => item.id),
        [completedExperimentData.experimentId],
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
