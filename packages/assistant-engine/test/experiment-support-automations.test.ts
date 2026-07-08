import { rm } from 'node:fs/promises'

import { afterEach, expect, it, vi } from 'vitest'

const vaultServicesMocks = vi.hoisted(() => ({
  writeExperimentOutcome: vi.fn(),
  showExperiment: vi.fn(),
}))
const coreMocks = vi.hoisted(() => ({
  patchAutomation: vi.fn(),
}))

vi.mock('@murphai/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    patchAutomation: coreMocks.patchAutomation,
  }
})

vi.mock('@murphai/vault-usecases/vault-services', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createIntegratedVaultServices: () => ({
      core: {
        writeExperimentOutcome: vaultServicesMocks.writeExperimentOutcome,
      },
      query: {
        showExperiment: vaultServicesMocks.showExperiment,
      },
    }),
  }
})

import { createExperiment, initializeVault, updateExperiment, VaultError } from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

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
  // The progress + card commands must pin --as-of to the local milestone
  // date so eastern time zones do not silently compute day three.
  expect(progress?.instructions).toContain(
    'experiment progress sauna-rhr --as-of 2026-04-11 --format json',
  )
  expect(progress?.instructions).toContain(
    'experiment progress-card sauna-rhr --as-of 2026-04-11 --format json',
  )
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
  // Pin --as-of to interventionEnd so the card matches the persisted outcome
  // and stays stable across cron retries.
  expect(finalResults?.instructions).toContain(
    'experiment progress-card sauna-rhr --as-of 2026-04-28 --format json',
  )
  expect(finalResults?.instructions).toContain('opts out of scheduled summaries')
  // The LLM must NOT be asked to run the deterministic write itself —
  // persistence happens in code as a cron precondition so a storage
  // failure surfaces as a retryable cron failure instead of being
  // swallowed by an LLM skip that consumes the one-shot.
  expect(finalResults?.instructions).not.toContain('outcome analyze')
  expect(finalResults?.instructions).not.toContain('vault-cli experiment outcome write')
  expect(finalResults?.instructions).toContain('persisted by the cron precondition')
  expect(finalResults?.instructions).toContain(
    'vault-cli automation set-status experiment-activity-nudge-sauna-rhr --status archived',
  )
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

function buildShowExperimentResult(frontmatter: Record<string, unknown>) {
  return {
    vault: '/tmp/lifecycle-precondition/vault',
    entity: {
      id: frontmatter.experimentId,
      kind: 'experiment',
      title: frontmatter.title ?? null,
      occurredAt: frontmatter.startedOn ?? null,
      path: null,
      markdown: null,
      data: frontmatter,
      links: [],
    },
  }
}

function resetPreconditionMocks() {
  vaultServicesMocks.writeExperimentOutcome.mockReset().mockResolvedValue({})
  vaultServicesMocks.showExperiment.mockReset()
  coreMocks.patchAutomation.mockReset().mockResolvedValue({})
}

const FINAL_RESULTS_AUTOMATION_ID = 'automation_X3GPAWV2CCHNCYHAAJ4CE2M144'
const FINAL_RESULTS_EXPERIMENT_ID = 'exp_X3GPAWV2CCHNCYHAAJ4CE2M144'

const eligibleFrontmatter = {
  schemaVersion: 'murph.frontmatter.experiment.v1' as const,
  docType: 'experiment' as const,
  experimentId: FINAL_RESULTS_EXPERIMENT_ID,
  slug: 'sauna-rhr',
  status: 'active' as const,
  title: 'Sauna RHR',
  startedOn: '2026-04-01',
  runPlan: { interventionStart: '2026-04-08', interventionEnd: '2026-04-28' },
}

function eligibleFrontmatterInTimeZone(timeZone: string) {
  return {
    ...eligibleFrontmatter,
    runPlan: {
      ...eligibleFrontmatter.runPlan,
      schedule: { kind: 'dailyLocal' as const, localTime: '09:00', timeZone },
    },
  }
}

it('persists the deterministic outcome with a pinned asOf for an eligible final-results run', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatter),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    // Reverses the seed builder's ULID mapping
    // (`experimentFinalResultsAutomationId`): the precondition looks up the
    // experiment via its stable id rather than the mutable automation slug.
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['assistant', 'scheduled', 'murph-managed', 'experiment', 'final-results', 'progress-card'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith({
    vault: '/tmp/lifecycle-precondition/vault',
    lookup: FINAL_RESULTS_EXPERIMENT_ID,
    // Pinned to interventionEnd so the outcomeId / filename are stable
    // across cron retries crossing a UTC midnight boundary.
    asOf: '2026-04-28',
    requestId: null,
  })
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
  expect(
    vaultServicesMocks.writeExperimentOutcome.mock.invocationCallOrder[0],
  ).toBeLessThan(coreMocks.patchAutomation.mock.invocationCallOrder[0] ?? 0)
})

it('continues at the Auckland final-results fire instant using the experiment local day', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatterInTimeZone('Pacific/Auckland')),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    now: '2026-04-28T21:00:00.000Z',
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith({
    vault: '/tmp/lifecycle-precondition/vault',
    lookup: FINAL_RESULTS_EXPERIMENT_ID,
    asOf: '2026-04-28',
    requestId: null,
  })
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('keeps the still-running guard on the Auckland intervention-end local day', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatterInTimeZone('Pacific/Auckland')),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    now: '2026-04-27T21:00:00.000Z',
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'skip', reason: 'experiment is still running' })
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
  expect(coreMocks.patchAutomation).not.toHaveBeenCalled()
})

it('continues at the New York final-results fire instant', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatterInTimeZone('America/New_York')),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    now: '2026-04-29T13:00:00.000Z',
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ asOf: '2026-04-28', lookup: FINAL_RESULTS_EXPERIMENT_ID }),
  )
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('does not skip when the experiment timezone cannot be resolved at precondition time', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatter),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    now: '2026-04-28T12:00:00.000Z',
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ asOf: '2026-04-28', lookup: FINAL_RESULTS_EXPERIMENT_ID }),
  )
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('treats a missing activity nudge automation as a successful final-results precondition cleanup', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatter),
  )
  coreMocks.patchAutomation
    .mockReset()
    .mockRejectedValue(new VaultError('VAULT_AUTOMATION_MISSING', 'Automation was not found.'))

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ lookup: FINAL_RESULTS_EXPERIMENT_ID }),
  )
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('does not block outcome persistence when activity nudge archive fails', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatter),
  )
  coreMocks.patchAutomation
    .mockReset()
    .mockRejectedValue(new Error('archive failed'))

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'continue' })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ lookup: FINAL_RESULTS_EXPERIMENT_ID }),
  )
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('still resolves the outcome lookup via automationId when the managed automation slug has been user-edited', async () => {
  // Regression guard: the reconciler intentionally preserves user-edited
  // slugs, so the precondition must route on the immutable automationId.
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult({ ...eligibleFrontmatter, slug: 'whatever-the-user-renamed-it' }),
  )

  await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(vaultServicesMocks.showExperiment).toHaveBeenCalledWith({
    vault: '/tmp/lifecycle-precondition/vault',
    lookup: FINAL_RESULTS_EXPERIMENT_ID,
    requestId: null,
  })
  expect(vaultServicesMocks.writeExperimentOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ lookup: FINAL_RESULTS_EXPERIMENT_ID }),
  )
})

it('skips when the run was stopped early (endedOn before interventionEnd)', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult({
      ...eligibleFrontmatter,
      // The normal stopExperiment path leaves status as completed but with
      // an earlier endedOn — that combination must be filtered before write.
      status: 'completed',
      endedOn: '2026-04-15',
    }),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result.kind).toBe('skip')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('skips when assistant support opts out of scheduled summaries', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult({
      ...eligibleFrontmatter,
      assistantSupport: { notificationStyle: 'skip_by_default' },
    }),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result.kind).toBe('skip')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('skips when the run is no longer in an active or completed state', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult({ ...eligibleFrontmatter, status: 'abandoned' }),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result.kind).toBe('skip')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('does not archive the activity nudge when final results are not due yet', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult({
      ...eligibleFrontmatter,
      runPlan: {
        interventionStart: '2026-04-08',
        interventionEnd: '2026-08-01',
        schedule: { kind: 'dailyLocal', localTime: '09:00', timeZone: 'UTC' },
      },
    }),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    now: '2026-07-07T12:00:00.000Z',
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({ kind: 'skip', reason: 'experiment is still running' })
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
  expect(coreMocks.patchAutomation).not.toHaveBeenCalled()
})

it('does not block a terminal skip verdict when activity nudge archive fails', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult({
      ...eligibleFrontmatter,
      assistantSupport: { notificationStyle: 'skip_by_default' },
    }),
  )
  coreMocks.patchAutomation
    .mockReset()
    .mockRejectedValue(new Error('archive failed'))

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result).toEqual({
    kind: 'skip',
    reason: 'assistant support opts out of scheduled summaries',
  })
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
  expect(coreMocks.patchAutomation).toHaveBeenCalledWith({
    lookup: 'experiment-activity-nudge-sauna-rhr',
    status: 'archived',
    vaultRoot: '/tmp/lifecycle-precondition/vault',
  })
})

it('skips when the authoritative lookup proves absence (not_found)', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockRejectedValue(
    new VaultCliError('not_found', 'No experiment found.'),
  )

  const result = await runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })

  expect(result.kind).toBe('skip')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
})

it('propagates non-not_found lookup failures so the one-shot is not consumed on a transient read', async () => {
  // Regression guard: a bounded prompt-context scanner would silently drop
  // unreadable files and look like absence; the authoritative lookup must
  // surface unreadable/parse errors so cron records failed and retries.
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockRejectedValue(new Error('ENOENT vault read'))

  await expect(runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })).rejects.toThrow('ENOENT vault read')
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
})

it('propagates outcome-write failures so the cron records a failure and retries', async () => {
  resetPreconditionMocks()
  vaultServicesMocks.showExperiment.mockResolvedValue(
    buildShowExperimentResult(eligibleFrontmatter),
  )
  vaultServicesMocks.writeExperimentOutcome
    .mockReset()
    .mockRejectedValue(new Error('outcome write failed'))

  await expect(runExperimentLifecycleOutcomePrecondition({
    automationId: FINAL_RESULTS_AUTOMATION_ID,
    tags: ['experiment', 'final-results'],
    vault: '/tmp/lifecycle-precondition/vault',
  })).rejects.toThrow('outcome write failed')
})

it('returns continue for automations that are not final-results lifecycle cron jobs', async () => {
  resetPreconditionMocks()

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
  expect(vaultServicesMocks.showExperiment).not.toHaveBeenCalled()
  expect(vaultServicesMocks.writeExperimentOutcome).not.toHaveBeenCalled()
})
