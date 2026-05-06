import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  assistantCronJobSchema,
  type AssistantCronJob,
  type AssistantCronSchedule,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockAutomationRecord = {
  automationId: string
  continuityPolicy: 'preserve' | 'reset'
  createdAt: string
  instructions: string
  route: {
    channel: string
    deliveryTarget: string | null
    identityId: string | null
    participantId: string | null
    threadId: string | null
  }
  schedule: AssistantCronSchedule
  slug?: string
  status: 'active' | 'paused' | 'archived'
  summary?: string | null
  tags: string[]
  title: string
  updatedAt: string
}

const cronMocks = vi.hoisted(() => ({
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  automationsByVault: new Map<string, MockAutomationRecord[]>(),
  getAssistantChannelAdapter: vi.fn(),
  listCanonicalAutomations: vi.fn(),
  loadImporterRuntime: vi.fn(),
  loadRuntimeModule: vi.fn(),
  loadVault: vi.fn(),
  nextAutomationId: 1,
  renderAutoLoggedFoodMealNote: vi.fn(),
  resolveAssistantBindingDelivery: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  showCanonicalAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
  withAssistantCronWriteLock: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  loadVault: cronMocks.loadVault,
  upsertAutomation: cronMocks.upsertAutomation,
}))

vi.mock('@murphai/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/query')>()
  return {
    ...actual,
    listAutomations: cronMocks.listCanonicalAutomations,
    showAutomation: cronMocks.showCanonicalAutomation,
  }
})

vi.mock('@murphai/vault-usecases/runtime', () => ({
  loadImporterRuntime: cronMocks.loadImporterRuntime,
  loadRuntimeModule: cronMocks.loadRuntimeModule,
}))

vi.mock('@murphai/vault-usecases/records', () => ({
  renderAutoLoggedFoodMealNote: cronMocks.renderAutoLoggedFoodMealNote,
}))

vi.mock('../src/assistant-service.ts', () => ({
  sendAssistantNotificationLocal: cronMocks.sendAssistantMessageLocal,
  sendAssistantMessageLocal: cronMocks.sendAssistantMessageLocal,
}))

vi.mock('../src/assistant/channel-adapters.ts', () => ({
  getAssistantChannelAdapter: cronMocks.getAssistantChannelAdapter,
}))

vi.mock('../src/assistant/bindings.ts', () => ({
  resolveAssistantBindingDelivery: cronMocks.resolveAssistantBindingDelivery,
}))

vi.mock('../src/assistant/cron/locking.ts', () => ({
  withAssistantCronWriteLock: cronMocks.withAssistantCronWriteLock,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  applyAssistantSelfDeliveryTargetDefaults:
    cronMocks.applyAssistantSelfDeliveryTargetDefaults,
}))

import {
  addAssistantCronJob,
  getAssistantCronJob,
  getAssistantCronStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobsLocal,
  runAssistantCronJobNow,
  setAssistantCronJobEnabled,
  setAssistantCronJobTarget,
} from '../src/assistant-cron.ts'
import {
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

beforeEach(() => {
  vi.useRealTimers()
  cronMocks.automationsByVault.clear()
  cronMocks.nextAutomationId = 1

  cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockReset().mockImplementation(
    async (input: Record<string, string | null | undefined>) => ({
      channel: input.channel ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
      identityId: input.identityId ?? null,
      participantId: input.participantId ?? null,
      threadId: input.threadId ?? null,
    }),
  )
  cronMocks.getAssistantChannelAdapter.mockReset().mockImplementation((channel) =>
    channel ? { channel } : null,
  )
  cronMocks.resolveAssistantBindingDelivery
    .mockReset()
    .mockImplementation(
      ({
        actorId,
        channel,
        deliveryTarget,
        threadId,
      }: {
        actorId?: string | null
        channel?: string | null
        deliveryTarget?: string | null
        threadId?: string | null
      }) => {
        if (!channel) {
          return null
        }

        if (deliveryTarget) {
          return {
            channel,
            deliveryTarget,
            kind: 'direct',
          }
        }

        if (actorId || threadId) {
          return {
            actorId: actorId ?? null,
            channel,
            kind: 'binding',
            threadId: threadId ?? null,
          }
        }

        return null
      },
    )
  cronMocks.withAssistantCronWriteLock
    .mockReset()
    .mockImplementation(async (_paths, action: () => Promise<unknown>) => action())
  cronMocks.loadVault.mockReset().mockResolvedValue({
    metadata: {
      timezone: 'UTC',
    },
  })
  cronMocks.sendAssistantMessageLocal.mockReset().mockResolvedValue({
    response: 'Completed scheduled check-in.',
    session: {
      sessionId: 'session-default',
    },
  })
  cronMocks.loadRuntimeModule.mockReset().mockResolvedValue({
    acquireCanonicalWriteLock: vi.fn(async () => ({
      release: vi.fn(async () => undefined),
    })),
    findEventByExternalRef: vi.fn(async () => null),
    readFood: vi.fn(async ({ foodId }: { foodId?: string }) => ({
      foodId: foodId ?? 'food-1',
      title: 'Daily Oats',
    })),
    withCanonicalWriteLockScope: vi.fn(async (_vaultRoot: string, run: () => Promise<unknown>) => await run()),
  })
  cronMocks.renderAutoLoggedFoodMealNote
    .mockReset()
    .mockImplementation((food: { title: string }) => `Meal note for ${food.title}`)
  cronMocks.loadImporterRuntime.mockReset().mockResolvedValue({
    addMeal: vi.fn(async () => ({
      mealId: 'meal-1',
    })),
  })
  cronMocks.listCanonicalAutomations.mockReset().mockImplementation(
    async (
      vault: string,
      options?: {
        status?: ReadonlyArray<'active' | 'paused' | 'archived'>
      },
    ) => {
      const records = getVaultAutomationStore(vault)
      const allowed = options?.status
      return records.filter((record) =>
        allowed ? allowed.includes(record.status) : true,
      )
    },
  )
  cronMocks.showCanonicalAutomation
    .mockReset()
    .mockImplementation(async (vault: string, lookup: string) => {
      const normalized = lookup.trim()
      return (
        getVaultAutomationStore(vault).find(
          (record) =>
            record.automationId === normalized || record.title === normalized,
        ) ?? null
      )
    })
  cronMocks.upsertAutomation.mockReset().mockImplementation(
    async (input: {
      automationId?: string
      continuityPolicy?: 'preserve' | 'reset'
      instructions: string
      route: MockAutomationRecord['route']
      schedule: AssistantCronSchedule
      slug?: string
      status: MockAutomationRecord['status']
      summary?: string | null
      tags?: string[]
      title: string
      vaultRoot: string
    }) => {
      const records = getVaultAutomationStore(input.vaultRoot)
      const now = new Date().toISOString()
      const existingIndex = input.automationId
        ? records.findIndex((record) => record.automationId === input.automationId)
        : -1

      if (existingIndex >= 0) {
        const existing = records[existingIndex] as MockAutomationRecord
        const updated: MockAutomationRecord = {
          ...existing,
          continuityPolicy: input.continuityPolicy ?? existing.continuityPolicy,
          instructions: input.instructions,
          route: { ...input.route },
          schedule: input.schedule,
          slug: input.slug,
          status: input.status,
          summary: input.summary,
          tags: input.tags ?? existing.tags,
          title: input.title,
          updatedAt: now,
        }
        records.splice(existingIndex, 1, updated)
        return {
          record: updated,
        }
      }

      const created: MockAutomationRecord = {
        automationId: `automation-${cronMocks.nextAutomationId++}`,
        continuityPolicy: input.continuityPolicy ?? 'preserve',
        createdAt: now,
        instructions: input.instructions,
        route: { ...input.route },
        schedule: input.schedule,
        slug: input.slug,
        status: input.status,
        summary: input.summary,
        tags: input.tags ?? ['assistant', 'scheduled'],
        title: input.title,
        updatedAt: now,
      }
      records.push(created)
      return {
        record: created,
      }
    },
  )
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant cron runtime orchestration', () => {
  it('lists mixed local and canonical jobs and computes status from both stores', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext('assistant-cron-runtime-list-')
    const localJob = await createLocalJob(vaultRoot, 'food-local')
    const canonicalJob = await createCanonicalJob(vaultRoot, 'daily-check-in')

    await updateLocalJob(vaultRoot, localJob.jobId, (job) => ({
      ...job,
      state: {
        ...job.state,
        nextRunAt: '2000-01-01T00:00:00.000Z',
      },
    }))
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
        runningAt: '2026-04-08T10:05:00.000Z',
        runningPid: 42,
      },
      updatedAt: '2026-04-08T10:05:00.000Z',
    }))

    const jobs = await listAssistantCronJobs(vaultRoot)
    const status = await getAssistantCronStatus(vaultRoot)

    expect(jobs.map((job) => job.name)).toEqual(['food-local', 'daily-check-in'])
    expect(status).toEqual({
      dueJobs: 1,
      enabledJobs: 2,
      nextRunAt: '2000-01-01T00:00:00.000Z',
      runningJobs: 1,
      totalJobs: 2,
    })
  })

  it('toggles local jobs and rejects re-enabling expired one-shot schedules', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-local-enable-',
    )
    const localJob = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:00:00.000Z',
      enabled: true,
      jobId: 'local-one-shot',
      keepAfterRun: false,
      name: 'local-one-shot',
      prompt: 'send breakfast reminder',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      schema: 'murph.assistant-cron-job.v1',
      state: {
        consecutiveFailures: 0,
        lastError: null,
        lastFailedAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        nextRunAt: '2026-04-08T09:00:00.000Z',
        runningAt: null,
        runningPid: null,
      },
      target: {
        alias: null,
        channel: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        sessionId: null,
        threadId: null,
      },
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    await writeAssistantCronStore(resolveAssistantStatePaths(vaultRoot), {
      version: 1,
      jobs: [localJob],
    })

    const disabled = await setAssistantCronJobEnabled(vaultRoot, localJob.jobId, false)
    expect(disabled.enabled).toBe(false)
    expect(disabled.state.nextRunAt).toBe('2026-04-08T09:00:00.000Z')

    vi.setSystemTime(new Date('2026-04-08T10:30:00.000Z'))

    await expect(
      setAssistantCronJobEnabled(vaultRoot, localJob.jobId, true),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_INVALID_STATE',
    })
  })

  it('toggles canonical jobs and persists active and paused states through automation storage', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-canonical-enable-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'hydration-check')

    const paused = await setAssistantCronJobEnabled(vaultRoot, canonicalJob.jobId, false)
    expect(paused.enabled).toBe(false)
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'paused',
    )

    const resumed = await setAssistantCronJobEnabled(vaultRoot, canonicalJob.jobId, true)
    expect(resumed.enabled).toBe(true)
    expect(resumed.state.nextRunAt).not.toBeNull()
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'active',
    )
  })

  it('updates local targets with dry-run previews and continuity resets', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-local-target-',
    )
    const localJob = await createLocalJob(vaultRoot, 'local-target')

    const dryRun = await setAssistantCronJobTarget({
      channel: 'telegram',
      deliveryTarget: 'room-2',
      dryRun: true,
      job: localJob.jobId,
      vault: vaultRoot,
    })
    expect(dryRun.changed).toBe(true)
    expect(dryRun.dryRun).toBe(true)
    expect((await getAssistantCronJob(vaultRoot, localJob.jobId)).target.channel).toBe(
      null,
    )

    await updateLocalJob(vaultRoot, localJob.jobId, (job) => ({
      ...job,
      target: {
        ...job.target,
        alias: 'continuity-alias',
        channel: 'telegram',
        deliveryTarget: 'room-1',
        sessionId: 'session-1',
      },
    }))

    const updated = await setAssistantCronJobTarget({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      job: localJob.jobId,
      resetContinuity: true,
      vault: vaultRoot,
    })

    expect(updated.changed).toBe(false)
    expect(updated.continuityReset).toBe(true)
    expect(updated.job.target.alias).toBeNull()
    expect(updated.job.target.sessionId).toBeNull()
  })

  it('updates canonical targets and clears preserved continuity when requested', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-canonical-target-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'evening-summary')

    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      alias: 'continuity-alias',
      sessionId: 'session-1',
    }))

    const result = await setAssistantCronJobTarget({
      channel: 'telegram',
      deliveryTarget: 'room-2',
      job: canonicalJob.jobId,
      resetContinuity: true,
      vault: vaultRoot,
    })

    expect(result.changed).toBe(true)
    expect(result.continuityReset).toBe(true)
    expect(result.job.target.alias).toBeNull()
    expect(result.job.target.sessionId).toBeNull()
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.route.deliveryTarget).toBe(
      'room-2',
    )
  })

  it('runs canonical one-shot jobs immediately and archives them after a successful send', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-runtime-run-now-')
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'one-shot-summary',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'summarize today',
      schedule: {
        at: '2026-04-08T12:00:00.000Z',
        kind: 'at',
      },
      vault: vaultRoot,
    })

    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      response: 'Done.',
      session: {
        sessionId: 'session-run-now',
      },
    })

    const result = await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(result.removedAfterRun).toBe(true)
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'archived',
    )
    expect(await listAssistantCronJobs(vaultRoot)).toEqual([])
  })

  it('passes the raw automation prompt and automation-cron trigger into assistant sends', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-send-shape-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'raw-prompt-shape')

    await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDedupeToken: null,
        instructions: 'Check in for raw-prompt-shape',
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('persists the private summary when a scheduled notification turn returns no response', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-private-summary-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'private-summary')

    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T08:00:00.000Z',
      },
    }))
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'skip',
        privateSummary: 'Skipped because no delivery was required.',
      },
      response: null,
      session: {
        sessionId: 'session-private-summary',
      },
    })

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    await expect(
      listAssistantCronRuns({
        job: canonicalJob.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      jobId: canonicalJob.jobId,
      runs: [
        expect.objectContaining({
          response: 'Skipped because no delivery was required.',
          status: 'succeeded',
        }),
      ],
    })
  })

  it('processes due jobs across local and canonical stores and reports mixed outcomes', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-process-due-',
    )
    const localJob = await createLocalJob(vaultRoot, 'local-due')
    const canonicalJob = await createCanonicalJob(vaultRoot, 'canonical-due')

    await updateLocalJob(vaultRoot, localJob.jobId, (job) => ({
      ...job,
      state: {
        ...job.state,
        nextRunAt: '2026-04-08T07:59:00.000Z',
      },
    }))
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T08:00:00.000Z',
      },
    }))

    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(
      new VaultCliError('ASSISTANT_SEND_FAILED', 'scheduled send failed'),
    )

    const summary = await processDueAssistantCronJobsLocal({
      limit: 5,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 2,
      succeeded: 1,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDedupeToken: expect.stringContaining(
          'assistant-cron|automation-1|2026-04-08T08:00:00.000Z',
        ),
        turnTrigger: 'automation-cron',
      }),
    )

    const updatedLocal = await getAssistantCronJob(vaultRoot, localJob.jobId)
    expect(updatedLocal.state.consecutiveFailures).toBe(1)
    expect(updatedLocal.state.lastError).toBe('scheduled send failed')
    expect(updatedLocal.state.runningAt).toBeNull()

    const updatedCanonical = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(updatedCanonical.state.lastSucceededAt).not.toBeNull()
    expect(updatedCanonical.state.runningAt).toBeNull()
  })

  it('reclaims stale canonical running jobs while preserving fresh running claims', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-stale-canonical-',
    )
    const staleJob = await createCanonicalJob(vaultRoot, 'stale-canonical')
    const freshJob = await createCanonicalJob(vaultRoot, 'fresh-canonical')
    const paths = resolveAssistantStatePaths(vaultRoot)
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const staleRecord = runtimeStore.jobs.find(
      (record) => record.jobId === staleJob.jobId,
    )
    const freshRecord = runtimeStore.jobs.find(
      (record) => record.jobId === freshJob.jobId,
    )

    if (!staleRecord || !freshRecord) {
      throw new Error('Expected canonical runtime records to exist.')
    }
    await mkdir(path.dirname(paths.cronAutomationStatePath), {
      recursive: true,
    })
    await writeFile(
      paths.cronAutomationStatePath,
      JSON.stringify(
        {
          jobs: [
            {
              ...staleRecord,
              state: {
                ...staleRecord.state,
                pendingOccurrenceAt: '2026-04-08T12:00:00.000Z',
                runningAt: '2026-04-08T11:30:00.000Z',
                runningPid: 111,
              },
              updatedAt: '2026-04-08T11:30:00.000Z',
            },
            {
              ...freshRecord,
              state: {
                ...freshRecord.state,
                pendingOccurrenceAt: '2026-04-08T12:00:00.000Z',
                runningAt: '2026-04-08T12:30:00.000Z',
                runningPid: 222,
              },
              updatedAt: '2026-04-08T12:30:00.000Z',
            },
          ],
          version: 1,
        },
        null,
        2,
      ),
      'utf8',
    )

    const summary = await processDueAssistantCronJobsLocal({
      limit: 5,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Check in for stale-canonical',
      }),
    )

    const reclaimed = await getAssistantCronJob(vaultRoot, staleJob.jobId)
    expect(reclaimed.state.runningAt).toBeNull()
    expect(reclaimed.state.lastSucceededAt).toBe('2026-04-08T13:00:00.000Z')

    const stillRunning = await getAssistantCronJob(vaultRoot, freshJob.jobId)
    expect(stillRunning.state.runningAt).toBe('2026-04-08T12:30:00.000Z')
    expect(stillRunning.state.runningPid).toBe(222)
    expect(stillRunning.state.lastSucceededAt).toBeNull()
  })

  it('processes a canonical daily-local midnight job when runtime state is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T16:00:12.000Z'))
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'Asia/Kuala_Lumpur',
      },
    })
    const { vaultRoot } = await createRuntimeContext('assistant-cron-runtime-kl-midnight-')
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-kl-midnight',
      continuityPolicy: 'preserve',
      createdAt: '2026-05-03T22:17:55.000Z',
      instructions: 'Remind me to sleep.',
      route: {
        channel: 'linq',
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '00:00',
      },
      slug: 'midnight-sleep-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Midnight sleep reminder',
      updatedAt: '2026-05-03T22:17:55.000Z',
    })
    const events: Array<{
      failureContext?: Record<string, boolean | number | string | null>
      safeDetails?: string
      type: string
    }> = []

    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      onEvent: (event) => {
        events.push(event)
      },
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'linq',
        deliveryDispatchMode: 'queue-only',
        deliveryDedupeToken: expect.stringContaining(
          'assistant-cron|automation-kl-midnight|2026-05-04T16:00:00.000Z',
        ),
        participantId: 'participant-1',
        threadId: 'thread-1',
        turnTrigger: 'automation-cron',
      }),
    )
    const updated = await getAssistantCronJob(vaultRoot, 'automation-kl-midnight')
    expect(updated.state.lastSucceededAt).toBe('2026-05-04T16:00:12.000Z')
    expect(updated.state.nextRunAt).toBe('2026-05-05T16:00:00.000Z')
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureContext: expect.objectContaining({
            canonicalJobs: 1,
            dueJobs: 1,
            loadedJobs: 1,
          }),
          safeDetails: 'cron_scan_started',
          type: 'cron.scan.started',
        }),
        expect.objectContaining({
          failureContext: expect.objectContaining({
            due: true,
            localTime: '00:00',
            nextRunAt: '2026-05-04T16:00:00.000Z',
            reason: 'due',
            routeConfigured: true,
            scheduleKind: 'dailyLocal',
            sourceKind: 'automation',
            timeZone: 'Asia/Kuala_Lumpur',
            runtimeStatePresent: false,
          }),
          safeDetails: 'due',
          type: 'cron.scan.job',
        }),
        expect.objectContaining({
          failureContext: expect.objectContaining({
            routeConfigured: true,
            runStatus: 'succeeded',
            scheduleKind: 'dailyLocal',
            sourceKind: 'automation',
          }),
          safeDetails: 'cron_job_enqueue_succeeded',
          type: 'cron.job.completed',
        }),
      ]),
    )
  })
})

function getVaultAutomationStore(vault: string): MockAutomationRecord[] {
  const existing = cronMocks.automationsByVault.get(vault)
  if (existing) {
    return existing
  }

  const created: MockAutomationRecord[] = []
  cronMocks.automationsByVault.set(vault, created)
  return created
}

function findCanonicalAutomation(
  vault: string,
  lookup: string,
): MockAutomationRecord | undefined {
  const normalized = lookup.trim()
  return getVaultAutomationStore(vault).find(
    (record) => record.automationId === normalized || record.title === normalized,
  )
}

async function createRuntimeContext(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

async function createLocalJob(
  vaultRoot: string,
  name: string,
): Promise<AssistantCronJob> {
  const now = '2026-04-08T08:00:00.000Z'
  const job = assistantCronJobSchema.parse({
    createdAt: now,
    enabled: true,
    jobId: `local-${name}`,
    keepAfterRun: true,
    name,
    prompt: `Check in for ${name}`,
    schedule: {
      kind: 'dailyLocal',
      localTime: '09:30',
    },
    schema: 'murph.assistant-cron-job.v1',
    state: {
      consecutiveFailures: 0,
      lastError: null,
      lastFailedAt: null,
      lastRunAt: null,
      lastSucceededAt: null,
      nextRunAt: '2026-04-08T09:30:00.000Z',
      runningAt: null,
      runningPid: null,
    },
    target: {
      alias: null,
      channel: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      sessionId: null,
      threadId: null,
    },
    updatedAt: now,
  })
  const paths = resolveAssistantStatePaths(vaultRoot)
  const store = await readAssistantCronStore(paths)
  store.jobs.push(job)
  await writeAssistantCronStore(paths, store)
  return job
}

async function createCanonicalJob(
  vaultRoot: string,
  name: string,
): Promise<AssistantCronJob> {
  return addAssistantCronJob({
    channel: 'telegram',
    deliveryTarget: 'room-1',
    name,
    now: new Date('2026-04-08T08:00:00.000Z'),
    prompt: `Check in for ${name}`,
    schedule: {
      kind: 'dailyLocal',
      localTime: '10:00',
    },
    vault: vaultRoot,
  })
}

async function updateLocalJob(
  vaultRoot: string,
  jobId: string,
  update: (job: AssistantCronJob) => AssistantCronJob,
): Promise<void> {
  const paths = resolveAssistantStatePaths(vaultRoot)
  const store = await readAssistantCronStore(paths)
  const index = store.jobs.findIndex((job) => job.jobId === jobId)
  expect(index).toBeGreaterThanOrEqual(0)
  store.jobs[index] = assistantCronJobSchema.parse(update(store.jobs[index]!))
  await writeAssistantCronStore(paths, store)
}

async function updateCanonicalRuntimeState(
  vaultRoot: string,
  jobId: string,
  update: (
    record: Awaited<
      ReturnType<typeof readAssistantCronCanonicalRuntimeStore>
    >['jobs'][number],
  ) => Awaited<
    ReturnType<typeof readAssistantCronCanonicalRuntimeStore>
  >['jobs'][number],
): Promise<void> {
  const paths = resolveAssistantStatePaths(vaultRoot)
  const store = await readAssistantCronCanonicalRuntimeStore(paths)
  const index = store.jobs.findIndex((record) => record.jobId === jobId)
  expect(index).toBeGreaterThanOrEqual(0)
  store.jobs[index] = update(store.jobs[index]!)
  await writeAssistantCronCanonicalRuntimeStore(paths, store)
}
