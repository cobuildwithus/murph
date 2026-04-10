import { rm } from 'node:fs/promises'

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
  prompt: string
  route: {
    channel: string
    deliverResponse: boolean
    deliveryTarget: string | null
    identityId: string | null
    participantId: string | null
    sourceThreadId: string | null
  }
  schedule: AssistantCronSchedule
  slug?: string
  status: 'active' | 'paused' | 'archived'
  summary?: string
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
  processDueAssistantCronJobsLocal,
  runAssistantCronJobNow,
  setAssistantCronJobEnabled,
  setAssistantCronJobTarget,
} from '../src/assistant-cron.ts'
import {
  readAssistantCronAutomationRuntimeStore,
  writeAssistantCronAutomationRuntimeStore,
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
      sourceThreadId: input.sourceThreadId ?? null,
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
    readFood: vi.fn(async ({ foodId }: { foodId?: string }) => ({
      foodId: foodId ?? 'food-1',
      title: 'Daily Oats',
    })),
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
      prompt: string
      route: MockAutomationRecord['route']
      schedule: AssistantCronSchedule
      slug?: string
      status: MockAutomationRecord['status']
      summary?: string
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
          prompt: input.prompt,
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
        prompt: input.prompt,
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
    const { vaultRoot } = await createRuntimeContext('assistant-cron-runtime-list-')
    const localJob = await createLocalFoodJob(vaultRoot, 'food-local')
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
        nextRunAt: '2026-04-08T10:00:00.000Z',
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
    const localJob = await addAssistantCronJob({
      foodAutoLog: {
        foodId: 'food-1',
      },
      name: 'local-one-shot',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'auto-log breakfast',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      vault: vaultRoot,
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
    const localJob = await createLocalFoodJob(vaultRoot, 'local-target')

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
        deliverResponse: true,
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
        prompt: 'Check in for raw-prompt-shape',
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('processes due jobs across local and canonical stores and reports mixed outcomes', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-process-due-',
    )
    const localJob = await createLocalFoodJob(vaultRoot, 'local-due')
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
        nextRunAt: '2026-04-08T08:00:00.000Z',
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

    const updatedLocal = await getAssistantCronJob(vaultRoot, localJob.jobId)
    expect(updatedLocal.state.lastSucceededAt).not.toBeNull()
    expect(updatedLocal.state.runningAt).toBeNull()

    const updatedCanonical = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(updatedCanonical.state.consecutiveFailures).toBe(1)
    expect(updatedCanonical.state.lastError).toBe('scheduled send failed')
    expect(updatedCanonical.state.runningAt).toBeNull()
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

async function createLocalFoodJob(
  vaultRoot: string,
  name: string,
): Promise<AssistantCronJob> {
  return addAssistantCronJob({
    foodAutoLog: {
      foodId: `${name}-food`,
    },
    name,
    now: new Date('2026-04-08T08:00:00.000Z'),
    prompt: `Auto-log ${name}`,
    schedule: {
      kind: 'dailyLocal',
      localTime: '09:30',
      timeZone: 'UTC',
    },
    vault: vaultRoot,
  })
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
      timeZone: 'UTC',
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
  automationId: string,
  update: (
    record: Awaited<
      ReturnType<typeof readAssistantCronAutomationRuntimeStore>
    >['automations'][number],
  ) => Awaited<
    ReturnType<typeof readAssistantCronAutomationRuntimeStore>
  >['automations'][number],
): Promise<void> {
  const paths = resolveAssistantStatePaths(vaultRoot)
  const store = await readAssistantCronAutomationRuntimeStore(paths)
  const index = store.automations.findIndex(
    (record) => record.automationId === automationId,
  )
  expect(index).toBeGreaterThanOrEqual(0)
  store.automations[index] = update(store.automations[index]!)
  await writeAssistantCronAutomationRuntimeStore(paths, store)
}
