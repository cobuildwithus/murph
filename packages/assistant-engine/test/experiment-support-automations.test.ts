import { rm } from 'node:fs/promises'

import { afterEach, expect, it } from 'vitest'

import { createExperiment, initializeVault, updateExperiment } from '@murphai/core'

import {
  buildExperimentFinalResultsSeeds,
  buildExperimentLifecycleSeeds,
} from '../src/assistant/experiment-support-automations.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

it('seeds stable day-four progress and final-results moments for an eligible active experiment', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-seeds-',
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

  // Active but no intervention end -> no seed.
  await createExperiment({
    slug: 'no-window',
    startedOn: '2026-04-02T09:00:00.000Z',
    title: 'No Window',
    vaultRoot,
  })
  // Not active -> no seed even with a window.
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

  const seeds = await buildExperimentLifecycleSeeds({ vaultRoot })
  const repeatedSeeds = await buildExperimentLifecycleSeeds({ vaultRoot })

  expect(seeds).toHaveLength(2)
  expect(repeatedSeeds.map(({ automationId, slug }) => ({ automationId, slug }))).toEqual(
    seeds.map(({ automationId, slug }) => ({ automationId, slug })),
  )

  const progress = seeds.find((seed) => seed.slug === 'experiment-progress-sauna-rhr-day-4')
  expect(progress).toMatchObject({
    continuityPolicy: 'fresh',
    schedule: { kind: 'at', at: '2026-04-11T15:00:00.000Z' },
    summary: 'A visual progress check after three completed intervention days.',
  })
  expect(progress?.automationId).toMatch(/^automation_[0-9A-F]{26}$/u)
  expect(progress?.tags).toEqual(expect.arrayContaining(['milestone', 'progress-card']))
  expect(progress?.instructions).toContain('experiment progress sauna-rhr')
  expect(progress?.instructions).toContain('experiment progress-card sauna-rhr')
  expect(progress?.instructions).toContain('murph.attach_response_media')
  expect(progress?.instructions).toContain('Sparse or unchanged metric data is not a reason to skip')

  const finalResults = seeds.find((seed) => seed.slug === 'experiment-final-results-sauna-rhr')
  expect(finalResults).toMatchObject({
    automationId: `automation_${sauna.experiment.id.replace(/^exp_/u, '')}`,
    continuityPolicy: 'fresh',
    schedule: { kind: 'at', at: '2026-04-29T15:00:00.000Z' },
    summary: 'A celebratory final review after the experiment finishes.',
  })
  expect(finalResults?.tags).toEqual(expect.arrayContaining(['final-results', 'progress-card']))
  expect(finalResults?.instructions).toContain('experiment outcome write sauna-rhr')
  expect(finalResults?.instructions).toContain('experiment progress-card sauna-rhr')
  expect(finalResults?.instructions).toContain('direct congratulations')
  expect(finalResults?.instructions).toContain('An inconclusive or sparse result is still a result')
  expect(finalResults?.instructions).toContain('voice memo may replace it')

  // Existing managed-automations callers keep receiving the complete lifecycle set.
  expect(await buildExperimentFinalResultsSeeds({ vaultRoot })).toEqual(seeds)
})

it('omits the day-four milestone for experiments shorter than four intervention days', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-short-lifecycle-seeds-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  const shortRun = await createExperiment({
    slug: 'short-run',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'Short Run',
    vaultRoot,
  })
  await updateExperiment({
    relativePath: shortRun.experiment.relativePath,
    runPlan: { interventionStart: '2026-04-08', interventionEnd: '2026-04-10' },
    vaultRoot,
  })

  const seeds = await buildExperimentLifecycleSeeds({ vaultRoot })

  expect(seeds).toHaveLength(1)
  expect(seeds[0]?.slug).toBe('experiment-final-results-short-run')
  expect(seeds[0]?.schedule).toEqual({ kind: 'at', at: '2026-04-11T15:00:00.000Z' })
})

it('returns no seeds for a vault with no experiments', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-empty-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  expect(await buildExperimentLifecycleSeeds({ vaultRoot })).toEqual([])
})
