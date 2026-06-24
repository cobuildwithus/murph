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
    // Vault timezone defaults to UTC, so 09:00 local = 09:00 UTC.
    schedule: { kind: 'at', at: '2026-04-11T09:00:00.000Z' },
    summary: 'A visual progress check after three completed intervention days.',
  })
  expect(progress?.automationId).toMatch(/^automation_[0-9A-F]{26}$/u)
  expect(progress?.tags).toEqual(expect.arrayContaining(['milestone', 'progress-card']))
  expect(progress?.instructions).toContain('experiment progress sauna-rhr')
  expect(progress?.instructions).toContain('experiment progress-card sauna-rhr')
  expect(progress?.instructions).toContain('murph.attach_response_media')
  expect(progress?.instructions).toContain('opts out of scheduled summaries')
  expect(progress?.instructions).toContain('current intervention window no longer spans four days')
  expect(progress?.instructions).toContain('Sparse or unchanged metric data is not a reason to skip')

  const finalResults = seeds.find((seed) => seed.slug === 'experiment-final-results-sauna-rhr')
  expect(finalResults).toMatchObject({
    automationId: `automation_${sauna.experiment.id.replace(/^exp_/u, '')}`,
    continuityPolicy: 'fresh',
    schedule: { kind: 'at', at: '2026-04-29T09:00:00.000Z' },
    summary: 'A celebratory final review after the experiment finishes.',
  })
  expect(finalResults?.tags).toEqual(expect.arrayContaining(['final-results', 'progress-card']))
  expect(finalResults?.instructions).toContain('experiment outcome write sauna-rhr')
  expect(finalResults?.instructions).toContain('experiment progress-card sauna-rhr')
  expect(finalResults?.instructions).toContain('opts out of scheduled summaries')
  // The analyze-and-send fallback must NOT exist: persistence failure has to
  // surface the error so the cron backoff retries instead of delivering an
  // unpersisted review.
  expect(finalResults?.instructions).not.toContain('outcome analyze')
  expect(finalResults?.instructions).toContain('surface the error and stop without delivering anything')
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
  expect(seeds[0]?.schedule).toEqual({ kind: 'at', at: '2026-04-11T09:00:00.000Z' })
})

it('returns no seeds for a vault with no experiments', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-empty-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  expect(await buildExperimentLifecycleSeeds({ vaultRoot })).toEqual([])
})

it('fires lifecycle seeds at local morning in the vault timezone when no per-run schedule is set', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-vault-tz-',
  )
  cleanupRoots.push(parentRoot)
  // America/New_York in April is EDT (UTC-4); 09:00 local = 13:00 UTC.
  await initializeVault({ vaultRoot, timezone: 'America/New_York' })

  const run = await createExperiment({
    slug: 'nyc-run',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'NYC Run',
    vaultRoot,
  })
  await updateExperiment({
    relativePath: run.experiment.relativePath,
    runPlan: { interventionStart: '2026-04-08', interventionEnd: '2026-04-28' },
    vaultRoot,
  })

  const seeds = await buildExperimentLifecycleSeeds({ vaultRoot })
  const progress = seeds.find((seed) => seed.slug === 'experiment-progress-nyc-run-day-4')
  const finalResults = seeds.find((seed) => seed.slug === 'experiment-final-results-nyc-run')

  expect(progress?.schedule).toEqual({ kind: 'at', at: '2026-04-11T13:00:00.000Z' })
  expect(finalResults?.schedule).toEqual({ kind: 'at', at: '2026-04-29T13:00:00.000Z' })
})

it('prefers the per-run schedule timezone over the vault timezone', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-run-tz-',
  )
  cleanupRoots.push(parentRoot)
  // Vault timezone deliberately different from the per-run schedule timezone
  // to prove the per-run choice wins.
  await initializeVault({ vaultRoot, timezone: 'America/New_York' })

  const run = await createExperiment({
    slug: 'nz-run',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'NZ Run',
    vaultRoot,
  })
  // Pacific/Auckland is NZST (UTC+12) on these April dates — NZDT ends 2026-04-05.
  // 09:00 NZST = 21:00 UTC the previous day.
  await updateExperiment({
    relativePath: run.experiment.relativePath,
    runPlan: {
      interventionStart: '2026-04-08',
      interventionEnd: '2026-04-28',
      schedule: { kind: 'dailyLocal', localTime: '08:00', timeZone: 'Pacific/Auckland' },
    },
    vaultRoot,
  })

  const seeds = await buildExperimentLifecycleSeeds({ vaultRoot })
  const progress = seeds.find((seed) => seed.slug === 'experiment-progress-nz-run-day-4')
  const finalResults = seeds.find((seed) => seed.slug === 'experiment-final-results-nz-run')

  expect(progress?.schedule).toEqual({ kind: 'at', at: '2026-04-10T21:00:00.000Z' })
  expect(finalResults?.schedule).toEqual({ kind: 'at', at: '2026-04-28T21:00:00.000Z' })
})
