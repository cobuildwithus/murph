import { rm } from 'node:fs/promises'

import { afterEach, expect, it } from 'vitest'

import { createExperiment, initializeVault, updateExperiment } from '@murphai/core'

import { buildExperimentFinalResultsSeeds } from '../src/assistant/experiment-support-automations.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

it('seeds one final-results automation per active experiment with an intervention end', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-final-results-seeds-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  const sauna = await createExperiment({
    slug: 'sauna-rhr',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'Sauna RHR',
    vaultRoot,
  })
  await updateExperiment({
    relativePath: sauna.experiment.relativePath,
    runPlan: {
      baselineStart: '2026-04-01',
      baselineEnd: '2026-04-07',
      interventionStart: '2026-04-08',
      interventionEnd: '2026-04-28',
    },
    vaultRoot,
  })

  // Active but no intervention end → no seed.
  await createExperiment({
    slug: 'no-window',
    startedOn: '2026-04-02T09:00:00.000Z',
    title: 'No Window',
    vaultRoot,
  })
  // Not active → no seed even with a window.
  const done = await createExperiment({
    slug: 'completed-run',
    startedOn: '2026-03-01T09:00:00.000Z',
    status: 'completed',
    title: 'Completed Run',
    vaultRoot,
  })
  await updateExperiment({
    relativePath: done.experiment.relativePath,
    runPlan: { interventionStart: '2026-03-02', interventionEnd: '2026-03-20' },
    vaultRoot,
  })

  const seeds = await buildExperimentFinalResultsSeeds({ vaultRoot })

  expect(seeds).toHaveLength(1)
  const [seed] = seeds
  expect(seed.slug).toBe('experiment-final-results-sauna-rhr')
  // Deterministic id reuses the experiment's ULID body under the automation prefix.
  expect(seed.automationId).toBe(
    `automation_${sauna.experiment.id.replace(/^exp_/u, '')}`,
  )
  // Fires the morning after the intervention ends, so the last day's data has synced.
  expect(seed.schedule).toEqual({ kind: 'at', at: '2026-04-29T15:00:00.000Z' })
  expect(seed.tags).toContain('final-results')
  expect(seed.instructions).toContain('experiment progress-card sauna-rhr')
  expect(seed.continuityPolicy).toBe('fresh')
})

it('returns no seeds for a vault with no experiments', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-final-results-empty-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  expect(await buildExperimentFinalResultsSeeds({ vaultRoot })).toEqual([])
})
