import { rm } from 'node:fs/promises'

import {
  assistantCronJobSchema,
  type AssistantCronSchedule,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAssistantCronPresetDefinition,
  renderAssistantCronPreset,
} from '../src/assistant/cron/presets.ts'

type MockAutomationRecord = {
  activeUntil?: string | null
  automationId: string
  assistantTargetOverride?: {
    model?: string | null
    modelProvider?: string | null
    reasoningEffort?: string | null
  } | null
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
  summary?: string
  tags: string[]
  title: string
  updatedAt: string
}

const cronMocks = vi.hoisted(() => ({
  archiveAutomationIfActiveUntilElapsed: vi.fn(),
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

vi.mock('@murphai/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@murphai/core')>()),
  archiveAutomationIfActiveUntilElapsed:
    cronMocks.archiveAutomationIfActiveUntilElapsed,
  isVaultError: (error: unknown) => Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('VAULT_'),
  ),
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

vi.mock('../src/assistant/bindings.ts', async (importOriginal) => ({
  // The conversation-key predicate is pure routing logic; keep the real one
  // so continuity gating behaves as in production.
  resolveAssistantConversationKey: (
    await importOriginal<typeof import('../src/assistant/bindings.ts')>()
  ).resolveAssistantConversationKey,
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
  runAssistantCronJobNow,
  setAssistantCronJobEnabled,
} from '../src/assistant-cron.ts'
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
  cronMocks.archiveAutomationIfActiveUntilElapsed
    .mockReset()
    .mockImplementation(async (input: {
      expectedUpdatedAt?: string
      lookup: string
      now?: Date
      vaultRoot: string
    }) => {
      const record = getVaultAutomationStore(input.vaultRoot).find(
        (candidate) =>
          candidate.automationId === input.lookup ||
          candidate.slug === input.lookup,
      )
      if (!record) {
        const error = new Error('Automation was not found.') as Error & { code: string }
        error.code = 'VAULT_AUTOMATION_MISSING'
        throw error
      }
      const activeUntilMs = record.activeUntil
        ? Date.parse(record.activeUntil)
        : Number.NaN
      if (
        input.expectedUpdatedAt !== undefined &&
          input.expectedUpdatedAt !== record.updatedAt ||
        record.status !== 'active' ||
        !Number.isFinite(activeUntilMs) ||
        (input.now ?? new Date()).getTime() < activeUntilMs
      ) {
        return { archived: false, record }
      }
      record.status = 'archived'
      record.updatedAt = (input.now ?? new Date()).toISOString()
      return { archived: true, record }
    })

  cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockReset().mockImplementation(
    async (input: Record<string, string | null | undefined>) => ({
      channel: input.channel ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
      identityId: input.identityId ?? null,
      participantId: input.participantId ?? null,
      threadId: input.threadId ?? null,
    }),
  )
  cronMocks.getAssistantChannelAdapter
    .mockReset()
    .mockImplementation((channel) => (channel ? { channel } : null))
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
  cronMocks.loadRuntimeModule.mockReset().mockResolvedValue({})
  cronMocks.loadImporterRuntime.mockReset().mockResolvedValue({
    addMeal: vi.fn(),
  })
  cronMocks.renderAutoLoggedFoodMealNote.mockReset().mockReturnValue('Meal note')
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
      assistantTargetOverride?: MockAutomationRecord['assistantTargetOverride']
      continuityPolicy?: 'preserve' | 'reset'
      instructions: string
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
          assistantTargetOverride:
            input.assistantTargetOverride === undefined
              ? existing.assistantTargetOverride ?? null
              : input.assistantTargetOverride,
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
        assistantTargetOverride: input.assistantTargetOverride ?? null,
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant cron preset threshold coverage', () => {
  it('renders optional empty variables and reports missing required defaults through the live preset definitions', () => {
    const definition = getAssistantCronPresetDefinition('weekly-health-snapshot')
    const originalVariables = [...definition.variables]

    try {
      definition.variables = [
        {
          ...definition.variables[0],
          defaultValue: null,
          required: false,
        },
        {
          ...definition.variables[1],
        },
      ]

      const optionalRender = renderAssistantCronPreset({
        presetId: definition.id,
        variables: {
          snapshot_focus: 'keep it calm',
        },
      })

      expect(optionalRender.resolvedVariables.goals_and_experiments).toBe('')
      expect(optionalRender.resolvedVariables.snapshot_focus).toBe('keep it calm')

      definition.variables = [
        {
          ...definition.variables[0],
          defaultValue: null,
          required: true,
        },
        {
          ...definition.variables[1],
        },
      ]

      expect(() =>
        renderAssistantCronPreset({
          presetId: definition.id,
          variables: {
            snapshot_focus: 'keep it calm',
          },
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'ASSISTANT_CRON_PRESET_MISSING_VARIABLE',
        }),
      )
    } finally {
      definition.variables = originalVariables
    }
  })

  it('raises an invalid-template error when a live preset definition references an unknown variable', () => {
    const definition = getAssistantCronPresetDefinition('morning-mindfulness')
    const originalTemplate = definition.promptTemplate

    try {
      definition.promptTemplate = 'Prompt with {{unknown_key}}.'

      expect(() =>
        renderAssistantCronPreset({
          presetId: definition.id,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'ASSISTANT_CRON_PRESET_INVALID_TEMPLATE',
        }),
      )
    } finally {
      definition.promptTemplate = originalTemplate
    }
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

async function createRuntimeContext(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

describe('assistant cron runtime threshold coverage', () => {
  it('applies resolved self-delivery defaults when creating canonical cron jobs', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-default-target-')

    cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
      channel: 'telegram',
      deliveryTarget: null,
      identityId: null,
      participantId: 'person-1',
      threadId: 'thread-1',
    })

    const job = await addAssistantCronJob({
      name: 'default-target-job',
      prompt: 'Send the daily check-in.',
      schedule: {
        expression: '0 9 * * *',
        kind: 'cron',
      },
      vault: vaultRoot,
    })

    expect(job.target).toMatchObject({
      channel: 'telegram',
      participantId: 'person-1',
      threadId: 'thread-1',
    })
    expect(job.target.deliveryTarget).toBeNull()
  })

  it('preserves the existing next run when a disabled recurring job succeeds manually', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext('assistant-cron-disabled-success-')

    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-disabled',
      name: 'disabled-success-job',
      prompt: 'Manual check-in.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
      },
      vault: vaultRoot,
    })

    const disabledJob = await setAssistantCronJobEnabled(vaultRoot, job.jobId, false)
    const preservedNextRunAt = disabledJob.state.nextRunAt

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(result.job.enabled).toBe(false)
    expect(result.job.state.nextRunAt).toBe(preservedNextRunAt)
    expect(result.job.state.lastSucceededAt).toBe('2026-04-08T08:00:00.000Z')
  })

  it('escalates failure backoff across repeated manual failures', async () => {
    vi.useFakeTimers()
    const { vaultRoot } = await createRuntimeContext('assistant-cron-failure-backoff-')

    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-failure',
      name: 'failure-backoff-job',
      prompt: 'Retry until it works.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
      },
      vault: vaultRoot,
    })

    cronMocks.sendAssistantMessageLocal.mockRejectedValue(
      new VaultCliError('ASSISTANT_SEND_FAILED', 'scheduled send failed'),
    )

    const attempts = [
      {
        expectedFailures: 1,
        expectedNextRunAt: '2026-04-08T08:00:30.000Z',
        now: '2026-04-08T08:00:00.000Z',
      },
      {
        expectedFailures: 2,
        expectedNextRunAt: '2026-04-08T08:02:00.000Z',
        now: '2026-04-08T08:01:00.000Z',
      },
      {
        expectedFailures: 3,
        expectedNextRunAt: '2026-04-08T08:07:00.000Z',
        now: '2026-04-08T08:02:00.000Z',
      },
      {
        expectedFailures: 4,
        expectedNextRunAt: '2026-04-08T08:18:00.000Z',
        now: '2026-04-08T08:03:00.000Z',
      },
      {
        expectedFailures: 5,
        expectedNextRunAt: '2026-04-08T09:04:00.000Z',
        now: '2026-04-08T08:04:00.000Z',
      },
    ] as const

    for (const attempt of attempts) {
      vi.setSystemTime(new Date(attempt.now))

      const result = await runAssistantCronJobNow({
        job: job.jobId,
        vault: vaultRoot,
      })

      expect(result.run.status).toBe('failed')
      const updated = await getAssistantCronJob(vaultRoot, job.jobId)
      expect(updated.state.consecutiveFailures).toBe(attempt.expectedFailures)
      expect(updated.state.nextRunAt).toBe(attempt.expectedNextRunAt)
    }
  })

  it('records aborted manual runs before any cron work starts', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-aborted-run-')
    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-abort',
      name: 'aborted-job',
      prompt: 'This should not run.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
      },
      vault: vaultRoot,
    })
    const controller = new AbortController()
    controller.abort()

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      signal: controller.signal,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('failed')
    expect(result.run.error).toContain('was aborted before it started')
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
  })

  it('treats local jobs removed mid-finalization as already gone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext('assistant-cron-local-race-')

    const job = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:00:00.000Z',
      enabled: true,
      jobId: 'local-race-job',
      keepAfterRun: true,
      name: 'local-race-job',
      prompt: 'Send reminder during a race.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
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
        channel: 'telegram',
        deliveryTarget: 'local-race-thread',
        identityId: null,
        participantId: null,
        sessionId: null,
        threadId: null,
      },
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    await writeAssistantCronStore(resolveAssistantStatePaths(vaultRoot), {
      version: 1,
      jobs: [job],
    })

    let lockInvocationCount = 0
    cronMocks.withAssistantCronWriteLock.mockImplementation(
      async (paths, action: () => Promise<unknown>) => {
        lockInvocationCount += 1
        if (lockInvocationCount === 2) {
          const store = await readAssistantCronStore(paths)
          store.jobs = store.jobs.filter((entry) => entry.jobId !== job.jobId)
          await writeAssistantCronStore(paths, store)
        }

        return action()
      },
    )

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(result.removedAfterRun).toBe(true)
  })

  it('rejects cron jobs when delivery defaults still leave no outbound route', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-missing-route-')

    cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
      channel: 'telegram',
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    })

    await expect(
      addAssistantCronJob({
        name: 'missing-route-job',
        prompt: 'This should fail.',
        schedule: {
          kind: 'dailyLocal',
          localTime: '09:00',
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
    })
  })
})
