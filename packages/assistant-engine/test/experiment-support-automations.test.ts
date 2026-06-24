import { rm } from 'node:fs/promises'

import { afterEach, expect, it, vi } from 'vitest'

const vaultServicesMocks = vi.hoisted(() => ({
  writeExperimentOutcome: vi.fn(),
}))

vi.mock('@murphai/vault-usecases/vault-services', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createIntegratedVaultServices: () => ({
      core: {
        writeExperimentOutcome: vaultServicesMocks.writeExperimentOutcome,
      },
    }),
  }
})

import { createExperiment, initializeVault, updateExperiment } from '@murphai/core'

import {
  buildExperimentFinalResultsSeeds,
  buildExperimentLifecycleSeeds,
  runExperimentLifecycleOutcomePrecondition,
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
  expect(finalResults?.instructions).toContain('experiment progress-card sauna-rhr')
  expect(finalResults?.instructions).toContain('opts out of scheduled summaries')
  // The LLM must NOT be asked to run the deterministic write itself —
  // persistence happens in code as a cron precondition so a storage
  // failure surfaces as a retryable cron failure instead of being
  // swallowed by an LLM skip that consumes the one-shot.
  expect(finalResults?.instructions).not.toContain('outcome analyze')
  expect(finalResults?.instructions).not.toContain('vault-cli experiment outcome write')
  expect(finalResults?.instructions).toContain('persisted by the cron precondition')
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

it('persists the deterministic outcome before the final-results notification turn when the run is eligible', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-precondition-eligible-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  const experiment = await createExperiment({
    slug: 'sauna-rhr',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'Sauna RHR',
    vaultRoot,
  })
  await updateExperiment({
    relativePath: experiment.experiment.relativePath,
    runPlan: { interventionStart: '2026-04-08', interventionEnd: '2026-04-28' },
    vaultRoot,
  })

  vaultServicesMocks.writeExperimentOutcome.mockReset().mockResolvedValue({})

  // Reverse the seed builder's ULID-based mapping
  // (`experimentFinalResultsAutomationId`) so the precondition looks up the
  // experiment via its stable id rather than the mutable automation slug.
  const automationId = `automation_${experiment.experiment.id.replace(/^exp_/u, '')}`
  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId,
    tags: ['assistant', 'scheduled', 'murph-managed', 'experiment', 'final-results', 'progress-card'],
    vault: vaultRoot,
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith({
    vault: vaultRoot,
    lookup: experiment.experiment.id,
    requestId: null,
  })
})

it('still resolves the outcome lookup via automationId when the managed automation slug has been user-edited', async () => {
  // Regression guard: the reconciler intentionally preserves user-edited
  // slugs, so the precondition must route on the immutable automationId.
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-precondition-slug-edit-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  const experiment = await createExperiment({
    slug: 'edited-slug-run',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'Edited Slug Run',
    vaultRoot,
  })
  await updateExperiment({
    relativePath: experiment.experiment.relativePath,
    runPlan: { interventionStart: '2026-04-08', interventionEnd: '2026-04-28' },
    vaultRoot,
  })

  vaultServicesMocks.writeExperimentOutcome.mockReset().mockResolvedValue({})

  const automationId = `automation_${experiment.experiment.id.replace(/^exp_/u, '')}`
  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId,
    tags: ['experiment', 'final-results'],
    vault: vaultRoot,
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith({
    vault: vaultRoot,
    lookup: experiment.experiment.id,
    requestId: null,
  })
})

it('skips outright when the experiment is no longer in an active or completed state', async () => {
  // Reachable production path: the user stops the run early after the
  // automation was already reconciled. The precondition must read canonical
  // state, return skip, and not persist a stray outcome for an ineligible
  // run — otherwise the consumed one-shot leaves an orphaned outcome and no
  // user-visible review.
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-precondition-skip-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  const experiment = await createExperiment({
    slug: 'abandoned-run',
    startedOn: '2026-04-01T09:00:00.000Z',
    status: 'abandoned',
    title: 'Abandoned Run',
    vaultRoot,
  })

  vaultServicesMocks.writeExperimentOutcome.mockReset()

  const automationId = `automation_${experiment.experiment.id.replace(/^exp_/u, '')}`
  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId,
    tags: ['experiment', 'final-results'],
    vault: vaultRoot,
  })

  expect(result.kind).toBe('skip')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
})

it('skips when the targeted experiment is no longer present in the vault', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-precondition-missing-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  vaultServicesMocks.writeExperimentOutcome.mockReset()

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: 'automation_X3GPAWV2CCHNCYHAAJ4CE2M144',
    tags: ['experiment', 'final-results'],
    vault: vaultRoot,
  })

  expect(result.kind).toBe('skip')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
})

it('propagates outcome-write failures so the cron records a failure and retries', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'experiment-lifecycle-precondition-failure-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({ vaultRoot })

  const experiment = await createExperiment({
    slug: 'failure-run',
    startedOn: '2026-04-01T09:00:00.000Z',
    title: 'Failure Run',
    vaultRoot,
  })

  vaultServicesMocks.writeExperimentOutcome
    .mockReset()
    .mockRejectedValue(new Error('outcome write failed'))

  const automationId = `automation_${experiment.experiment.id.replace(/^exp_/u, '')}`
  await expect(runExperimentLifecycleOutcomePrecondition({
    automationId,
    tags: ['experiment', 'final-results'],
    vault: vaultRoot,
  })).rejects.toThrow('outcome write failed')
})

it('returns continue for automations that are not final-results lifecycle cron jobs', async () => {
  vaultServicesMocks.writeExperimentOutcome.mockReset()

  const progressResult = await runExperimentLifecycleOutcomePrecondition({
    automationId: 'automation_PROGRESSAUTOMATIONIDHASH00',
    tags: ['experiment', 'progress-card', 'milestone'],
    vault: '/tmp/lifecycle-precondition/vault',
  })
  const weeklyResult = await runExperimentLifecycleOutcomePrecondition({
    automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FY',
    tags: ['assistant', 'scheduled', 'murph-managed'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(progressResult).toEqual({ kind: 'continue' })
  expect(weeklyResult).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
})
