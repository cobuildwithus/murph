import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  assistantCronJobSchema,
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
  type AssistantCronJob,
  type AssistantCronSchedule,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { ScheduledLogQueryRecord } from '@murphai/query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockAutomationRecord = {
  automationId: string
  continuityPolicy: 'fresh' | 'preserve'
  createdAt: string
  instructions: string
  route: {
    channel: string
    deliverySource: { kind: 'linq'; fromPhoneNumber: string } | null
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
  deleteAutomation: vi.fn(),
  executeScheduledLogOccurrence: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  listCanonicalScheduledLogs: vi.fn(),
  listCanonicalAutomations: vi.fn(),
  loadImporterRuntime: vi.fn(),
  loadRuntimeModule: vi.fn(),
  loadVault: vi.fn(),
  nextAutomationId: 1,
  renderAutoLoggedFoodMealNote: vi.fn(),
  resolveAssistantBindingDelivery: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  setScheduledLogStatus: vi.fn(),
  scheduledLogsByVault: new Map<string, ScheduledLogQueryRecord[]>(),
  showCanonicalAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
  withAssistantCronWriteLock: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  deleteAutomation: cronMocks.deleteAutomation,
  executeScheduledLogOccurrence: cronMocks.executeScheduledLogOccurrence,
  loadVault: cronMocks.loadVault,
  setScheduledLogStatus: cronMocks.setScheduledLogStatus,
  upsertAutomation: cronMocks.upsertAutomation,
}))

vi.mock('@murphai/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/query')>()
  return {
    ...actual,
    listAutomations: cronMocks.listCanonicalAutomations,
    listScheduledLogs: cronMocks.listCanonicalScheduledLogs,
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
  reconcileAssistantCronDeliveryIntent,
  repairPendingAssistantCronDeliveries,
  runAssistantCronJobNow,
  setAssistantCronJobEnabled,
  setAssistantCronJobTarget,
  upsertAssistantCronAutomation,
} from '../src/assistant-cron.ts'
import {
  listCanonicalAssistantCronRecords,
  projectCanonicalAssistantCronJob,
  resolveCanonicalRuntimeState,
} from '../src/assistant/cron/canonical-jobs.ts'
import {
  claimResolvedAssistantCronJob,
  executeClaimedAssistantCronJob,
} from '../src/assistant/cron/execution.ts'
import {
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import * as assistantCronRuntimeState from '../src/assistant/cron/runtime-state.ts'
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  markAssistantOutboxIntentMirrorTerminalById,
  markAssistantOutboxIntentSentById,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { createTempVaultContext } from './test-helpers.ts'

const LEGACY_ROUTE_CHANNEL_ENV_NAME = [
  'MURPH_ASSISTANT_CURRENT',
  'DELIVERY_ROUTE_CHANNEL',
].join('_')
const LEGACY_ROUTE_TARGET_ENV_NAME = [
  'MURPH_ASSISTANT_CURRENT',
  'DELIVERY_ROUTE_TARGET',
].join('_')

const tempRoots: string[] = []

beforeEach(() => {
  vi.useRealTimers()
  cronMocks.automationsByVault.clear()
  cronMocks.scheduledLogsByVault.clear()
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
  cronMocks.executeScheduledLogOccurrence.mockReset().mockResolvedValue({
    message: 'Auto-logged scheduled log "Morning measurement" as event evt_1.',
  })
  cronMocks.setScheduledLogStatus.mockReset().mockImplementation(
    async (input: {
      scheduledLogId: string
      status: ScheduledLogQueryRecord['status']
      vaultRoot: string
    }) => {
      const records = getVaultScheduledLogStore(input.vaultRoot)
      const index = records.findIndex(
        (record) => record.scheduledLogId === input.scheduledLogId,
      )
      let updated: ScheduledLogQueryRecord | null = null
      if (index >= 0) {
        const existing = records[index] as ScheduledLogQueryRecord
        updated = {
          ...existing,
          status: input.status,
          updatedAt: new Date().toISOString(),
        }
        records.splice(index, 1, updated)
      }
      return {
        record: updated,
      }
    },
  )
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
  cronMocks.listCanonicalScheduledLogs.mockReset().mockImplementation(
    async (
      vault: string,
      options?: {
        status?: ReadonlyArray<'active' | 'paused' | 'archived'>
      },
    ) => {
      const records = getVaultScheduledLogStore(vault)
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
            record.automationId === normalized ||
            record.slug === normalized ||
            record.title === normalized,
        ) ?? null
      )
    })
  cronMocks.deleteAutomation.mockReset().mockImplementation(
    async (input: {
      automationId?: string
      slug?: string
      vaultRoot: string
    }) => {
      const records = getVaultAutomationStore(input.vaultRoot)
      const lookup = input.automationId ?? input.slug
      if (!lookup) {
        throw new Error('Automation lookup is required.')
      }
      const index = records.findIndex(
        (record) => record.automationId === lookup || record.slug === lookup,
      )
      if (index === -1) {
        throw new Error('Automation was not found.')
      }
      const [record] = records.splice(index, 1)
      if (!record) {
        throw new Error('Automation was not found.')
      }
      return {
        automationId: record.automationId,
        deleted: true,
        relativePath: `bank/automations/${record.slug}.md`,
      }
    },
  )
  cronMocks.upsertAutomation.mockReset().mockImplementation(
    async (input: {
      automationId?: string
      continuityPolicy?: 'fresh' | 'preserve'
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
  vi.unstubAllEnvs()
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
  it('preserves explicit private iMessage delivery routes when creating cron jobs', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-linq-route-')

    cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: null,
      participantId: null,
      threadId: 'hid_redacted_thread',
    })

    const job = await addAssistantCronJob({
      name: 'linq-current-route-job',
      prompt: 'Send the check-in.',
      schedule: {
        at: '2026-12-08T12:00:00.000Z',
        kind: 'at',
      },
      deliveryTarget: 'linq_chat_real',
      vault: vaultRoot,
    })

    expect(job.target).toMatchObject({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      threadId: null,
    })
    expect(findCanonicalAutomation(vaultRoot, job.jobId)?.route).toMatchObject({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      threadId: null,
    })
  })

  it('rejects iMessage cron jobs without an explicit delivery target', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-linq-route-required-')
    vi.stubEnv(LEGACY_ROUTE_CHANNEL_ENV_NAME, 'linq')
    vi.stubEnv(LEGACY_ROUTE_TARGET_ENV_NAME, 'linq_chat_real')

    cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
      channel: 'linq',
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: 'hid_redacted_thread',
    })

    await expect(
      addAssistantCronJob({
        name: 'linq-missing-route-job',
        prompt: 'Send the check-in.',
        schedule: {
          at: '2026-12-08T12:00:00.000Z',
          kind: 'at',
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
    })
  })

  it('upserts canonical automations by slug and defers the first run to the next local day', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const job = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress.',
      now: new Date('2026-04-08T15:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      summary: 'Continue setup.',
      tags: ['assistant', 'onboarding'],
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!job) {
      throw new Error('Expected onboarding follow-up automation to be seeded.')
    }

    expect(job.name).toBe('Finish Murph onboarding follow-up')
    expect(job.state.nextRunAt).toBe('2026-04-09T17:30:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      automationId: job.jobId,
      instructions: 'Check setup progress.',
      route: {
        channel: 'telegram',
        deliveryTarget: 'room-1',
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: 'Continue setup.',
      tags: ['assistant', 'onboarding'],
    })

    await updateCanonicalRuntimeState(vaultRoot, job.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        lastSucceededAt: '2026-04-09T17:35:00.000Z',
        pendingOccurrenceAt: '2026-04-10T17:30:00.000Z',
      },
    }))

    const updated = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress with the latest wording.',
      now: new Date('2026-04-08T16:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!updated) {
      throw new Error('Expected onboarding follow-up automation to be updated.')
    }

    expect(updated.jobId).toBe(job.jobId)
    expect(updated.state.lastSucceededAt).toBe('2026-04-09T17:35:00.000Z')
    expect(updated.state.nextRunAt).toBe('2026-04-10T17:30:00.000Z')
    expect(cronMocks.upsertAutomation).toHaveBeenCalledTimes(2)
    expect(getVaultAutomationStore(vaultRoot)).toHaveLength(1)

    const retargeted = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress in another chat.',
      now: new Date('2026-04-08T16:30:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-2',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })

    expect(retargeted).toBeNull()
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')?.route).toMatchObject({
      channel: 'telegram',
      deliveryTarget: 'room-1',
    })
    expect(cronMocks.upsertAutomation).toHaveBeenCalledTimes(2)

    const automation = findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')
    if (!automation) {
      throw new Error('Expected onboarding follow-up automation to exist.')
    }
    automation.status = 'archived'

    const archived = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress after archive.',
      now: new Date('2026-04-08T17:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })

    expect(archived).toBeNull()
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')?.status).toBe(
      'archived',
    )
    expect(cronMocks.upsertAutomation).toHaveBeenCalledTimes(2)
  })

  it('recomputes an existing canonical automation when the schedule cadence changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T15:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-cadence-change-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const job = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress.',
      now: new Date('2026-04-08T15:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!job) {
      throw new Error('Expected onboarding follow-up automation to be seeded.')
    }

    expect(job.state.nextRunAt).toBe('2026-04-09T17:30:00.000Z')

    vi.setSystemTime(new Date('2026-04-08T16:00:00.000Z'))

    const updated = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress soon.',
      now: new Date('2026-04-08T16:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        everyMs: 90_000,
        kind: 'every',
      },
      slug: 'finish-onboarding-followup',
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!updated) {
      throw new Error('Expected onboarding follow-up automation to be updated.')
    }

    expect(updated.jobId).toBe(job.jobId)
    expect(updated.schedule).toEqual({
      everyMs: 90_000,
      kind: 'every',
    })
    expect(updated.state.nextRunAt).toBe('2026-04-08T16:01:30.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')?.schedule).toEqual({
      everyMs: 90_000,
      kind: 'every',
    })
  })

  it('accepts Linq participant automations when a delivery source is available', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-linq-participant-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const job = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress.',
      now: new Date('2026-04-08T15:00:00.000Z'),
      route: {
        channel: 'linq',
        deliverySource: {
          fromPhoneNumber: '+15550001111',
          kind: 'linq',
        },
        deliveryTarget: null,
        identityId: 'hid_linq_identity_participant',
        participantId: '+15550002222',
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      summary: 'Continue setup.',
      tags: ['assistant', 'onboarding'],
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!job) {
      throw new Error('Expected Linq participant automation to be seeded.')
    }

    expect(job.state.nextRunAt).toBe('2026-04-09T17:30:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      route: {
        channel: 'linq',
        deliverySource: {
          fromPhoneNumber: '+15550001111',
          kind: 'linq',
        },
        deliveryTarget: null,
        participantId: '+15550002222',
      },
      status: 'active',
    })
  })

  it('recovers onboarding automation seeds after a first runtime-state write failure', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-write-failure-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const writeSpy = vi.spyOn(
      assistantCronRuntimeState,
      'writeAssistantCronCanonicalRuntimeStore',
    )

    try {
      writeSpy.mockRejectedValueOnce(new Error('state store unavailable'))
      await expect(
        upsertAssistantCronAutomation({
          firstOccurrencePolicy: 'after-current-local-day',
          instructions: 'Check setup progress.',
          now: new Date('2026-04-08T15:00:00.000Z'),
          route: {
            channel: 'telegram',
            deliverySource: null,
            deliveryTarget: 'room-1',
            identityId: null,
            participantId: null,
            threadId: null,
          },
          schedule: {
            kind: 'dailyLocal',
            localTime: '13:30',
          },
          slug: 'finish-onboarding-followup',
          summary: 'Continue setup.',
          tags: ['assistant', 'onboarding'],
          title: 'Finish Murph onboarding follow-up',
          vault: vaultRoot,
        }),
      ).rejects.toThrow('state store unavailable')
    } finally {
      writeSpy.mockRestore()
    }

    expect(cronMocks.deleteAutomation).toHaveBeenCalledWith({
      automationId: 'automation-1',
      vaultRoot,
    })
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toBeUndefined()

    const recovered = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Check setup progress.',
      now: new Date('2026-04-08T16:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      summary: 'Continue setup.',
      tags: ['assistant', 'onboarding'],
      title: 'Finish Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!recovered) {
      throw new Error('Expected retry after incomplete seed to recover.')
    }

    expect(recovered.state.nextRunAt).toBe('2026-04-09T17:30:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      status: 'active',
      tags: ['assistant', 'onboarding'],
    })
    await expect(
      readAssistantCronCanonicalRuntimeStore(resolveAssistantStatePaths(vaultRoot)),
    ).resolves.toMatchObject({
      jobs: [
        expect.objectContaining({
          jobId: recovered.jobId,
        }),
      ],
    })
  })

  it('archives incomplete onboarding automation seeds when rollback delete fails', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-delete-failure-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    cronMocks.deleteAutomation.mockRejectedValueOnce(new Error('delete failed'))
    const writeSpy = vi.spyOn(
      assistantCronRuntimeState,
      'writeAssistantCronCanonicalRuntimeStore',
    )

    try {
      writeSpy.mockRejectedValueOnce(new Error('state store unavailable'))
      await expect(
        upsertAssistantCronAutomation({
          firstOccurrencePolicy: 'after-current-local-day',
          instructions: 'Check setup progress.',
          now: new Date('2026-04-08T15:00:00.000Z'),
          route: {
            channel: 'telegram',
            deliverySource: null,
            deliveryTarget: 'room-1',
            identityId: null,
            participantId: null,
            threadId: null,
          },
          schedule: {
            kind: 'dailyLocal',
            localTime: '13:30',
          },
          slug: 'finish-onboarding-followup',
          summary: 'Continue setup.',
          tags: ['assistant', 'onboarding'],
          title: 'Finish Murph onboarding follow-up',
          vault: vaultRoot,
        }),
      ).rejects.toThrow('state store unavailable')
    } finally {
      writeSpy.mockRestore()
    }

    expect(cronMocks.deleteAutomation).toHaveBeenCalledOnce()
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      status: 'archived',
      tags: ['assistant', 'onboarding'],
    })
  })

  it('restores a previous null summary after existing automation runtime-state write failure', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-restore-null-summary-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-existing',
      continuityPolicy: 'preserve',
      createdAt: '2026-04-08T14:00:00.000Z',
      instructions: 'Original setup check.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: null,
      tags: ['assistant', 'onboarding'],
      title: 'Finish Murph onboarding follow-up',
      updatedAt: '2026-04-08T14:00:00.000Z',
    })
    const writeSpy = vi.spyOn(
      assistantCronRuntimeState,
      'writeAssistantCronCanonicalRuntimeStore',
    )

    try {
      writeSpy.mockRejectedValueOnce(new Error('state store unavailable'))
      await expect(
        upsertAssistantCronAutomation({
          firstOccurrencePolicy: 'after-current-local-day',
          instructions: 'Updated setup check.',
          now: new Date('2026-04-08T15:00:00.000Z'),
          route: {
            channel: 'telegram',
            deliverySource: null,
            deliveryTarget: 'room-1',
            identityId: null,
            participantId: null,
            threadId: null,
          },
          schedule: {
            kind: 'dailyLocal',
            localTime: '13:30',
          },
          slug: 'finish-onboarding-followup',
          summary: 'Updated summary.',
          tags: ['assistant', 'onboarding'],
          title: 'Finish Murph onboarding follow-up',
          vault: vaultRoot,
        }),
      ).rejects.toThrow('state store unavailable')
    } finally {
      writeSpy.mockRestore()
    }

    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      instructions: 'Original setup check.',
      summary: null,
      updatedAt: expect.any(String),
    })
  })

  it('does not restore stale automation state over a concurrent edit after runtime-state write failure', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-concurrent-edit-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-existing',
      continuityPolicy: 'preserve',
      createdAt: '2026-04-08T14:00:00.000Z',
      instructions: 'Original setup check.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: 'Original summary.',
      tags: ['assistant', 'onboarding'],
      title: 'Finish Murph onboarding follow-up',
      updatedAt: '2026-04-08T14:00:00.000Z',
    })
    const writeSpy = vi.spyOn(
      assistantCronRuntimeState,
      'writeAssistantCronCanonicalRuntimeStore',
    )

    try {
      writeSpy.mockImplementationOnce(async () => {
        const automation = findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')
        if (!automation) {
          throw new Error('Expected automation to exist.')
        }
        automation.status = 'archived'
        automation.updatedAt = '2026-04-08T15:00:01.000Z'
        throw new Error('state store unavailable')
      })

      await expect(
        upsertAssistantCronAutomation({
          firstOccurrencePolicy: 'after-current-local-day',
          instructions: 'Updated setup check.',
          now: new Date('2026-04-08T15:00:00.000Z'),
          route: {
            channel: 'telegram',
            deliverySource: null,
            deliveryTarget: 'room-1',
            identityId: null,
            participantId: null,
            threadId: null,
          },
          schedule: {
            kind: 'dailyLocal',
            localTime: '13:30',
          },
          slug: 'finish-onboarding-followup',
          title: 'Finish Murph onboarding follow-up',
          vault: vaultRoot,
        }),
      ).rejects.toThrow('state store unavailable')
    } finally {
      writeSpy.mockRestore()
    }

    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      status: 'archived',
      updatedAt: '2026-04-08T15:00:01.000Z',
    })
  })

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

  it('blocks enable toggles while a canonical delivery confirmation is pending', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-pending-enable-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'pending-enable')
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        lastRunAt: '2026-04-08T10:00:00.000Z',
        pendingDeliveryIntentId: 'outbox_pending_enable',
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
      },
    }))

    await expect(
      setAssistantCronJobEnabled(vaultRoot, canonicalJob.jobId, false),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_PENDING',
    })
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
    const canonicalAutomation = findCanonicalAutomation(vaultRoot, canonicalJob.jobId)
    expect(canonicalAutomation).toBeDefined()
    canonicalAutomation?.tags.push('system:assistant-require-send')

    await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDedupeToken: null,
        instructions: 'Check in for raw-prompt-shape',
        responsePolicy: { kind: 'require_send' },
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('passes hosted turn environment into scheduled notification sends', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-turn-env-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'turn-env')
    const turnEnvironment = {
      currentWorkingDirectory: null,
      env: {
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        PATH: '/bin',
      },
    }

    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T08:00:00.000Z',
      },
    }))
    await processDueAssistantCronJobsLocal({
      limit: 1,
      turnEnvironment,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        turnEnvironment,
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('passes hosted provider trace callbacks into scheduled notification sends', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-trace-callback-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'trace-callback')
    const onTraceEvent = vi.fn()

    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T08:00:00.000Z',
      },
    }))
    await processDueAssistantCronJobsLocal({
      limit: 1,
      onTraceEvent,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        onTraceEvent,
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

  it('expires stale canonical one-shot notification cron jobs without sending', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-expired-one-shot-',
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'expired one-shot reminder',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'First-session prep reminder.',
      schedule: {
        kind: 'at',
        at: '2026-04-08T09:00:00.000Z',
      },
      vault: vaultRoot,
    })
    const events: Array<{
      failureContext?: Record<string, boolean | number | string | null>
      safeDetails?: string
      type: string
    }> = []

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      onEvent: (event) => {
        events.push(event)
      },
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(cronMocks.upsertAutomation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        automationId: canonicalJob.jobId,
        status: 'archived',
      }),
    )
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
    await expect(
      listAssistantCronRuns({
        job: canonicalJob.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: canonicalJob.jobId,
      runs: [
        expect.objectContaining({
          error: expect.stringContaining(
            'Assistant cron one-shot notification expired before delivery.',
          ),
          response: null,
          status: 'skipped',
        }),
      ],
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureContext: expect.objectContaining({
            errorPresent: true,
            runStatus: 'skipped',
            scheduleKind: 'at',
            sourceKind: 'automation',
          }),
          safeDetails: 'cron_job_skipped_error',
          type: 'cron.job.completed',
        }),
      ]),
    )
  })

  it('expires canonical one-shot notification retries by original occurrence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:45:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-expired-one-shot-retry-',
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'expired retry one-shot reminder',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'First-session prep reminder.',
      schedule: {
        kind: 'at',
        at: '2026-04-08T09:00:00.000Z',
      },
      vault: vaultRoot,
    })
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        consecutiveFailures: 1,
        lastError: 'temporary send failure',
        lastFailedAt: '2026-04-08T09:29:00.000Z',
        pendingOccurrenceAt: '2026-04-08T09:00:00.000Z',
        retryAfterAt: '2026-04-08T09:40:00.000Z',
      },
    }))

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
    await expect(
      listAssistantCronRuns({
        job: canonicalJob.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          error: expect.stringContaining('Scheduled occurrence was 45 minute(s) late.'),
          status: 'skipped',
        }),
      ],
    })
  })

  it('runs canonical one-shot notification cron jobs within the expiry window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-fresh-one-shot-',
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'fresh one-shot reminder',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'First-session prep reminder.',
      schedule: {
        kind: 'at',
        at: '2026-04-08T09:00:00.000Z',
      },
      vault: vaultRoot,
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
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDedupeToken: expect.stringContaining(
          `assistant-cron|${canonicalJob.jobId}|2026-04-08T09:00:00.000Z`,
        ),
        instructions: 'First-session prep reminder.',
        turnTrigger: 'automation-cron',
      }),
    )
    await expect(
      listAssistantCronRuns({
        job: canonicalJob.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: canonicalJob.jobId,
      runs: [
        expect.objectContaining({
          error: null,
          status: 'succeeded',
        }),
      ],
    })
  })

  it('runs stale canonical one-shot scheduled-log cron jobs instead of expiring them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-stale-scheduled-log-',
    )
    getVaultScheduledLogStore(vaultRoot).push({
      action: {
        kind: 'measurement.add',
        measurements: [
          {
            metric: 'body-weight',
            unit: 'lb',
            value: 180.8,
          },
        ],
      },
      body: 'Write the morning measurement event.',
      createdAt: '2026-04-08T08:00:00.000Z',
      docType: 'scheduled_log',
      markdown: 'scheduled log markdown',
      relativePath: 'bank/scheduled-logs/morning-measurement.md',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      schemaVersion: 'murph.frontmatter.scheduled-log.v1',
      scheduledLogId: 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBC',
      slug: 'morning-measurement',
      status: 'active',
      summary: 'Record the morning measurement.',
      tags: ['measurement'],
      title: 'Morning measurement',
      updatedAt: '2026-04-08T08:00:00.000Z',
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
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(cronMocks.executeScheduledLogOccurrence).toHaveBeenCalledWith({
      occurrenceAt: '2026-04-08T09:00:00.000Z',
      scheduledLogId: 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBC',
      vaultRoot,
    })
    expect(cronMocks.setScheduledLogStatus).toHaveBeenCalledWith({
      scheduledLogId: 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBC',
      status: 'archived',
      vaultRoot,
    })
    await expect(
      listAssistantCronRuns({
        job: 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBC',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBC',
      runs: [
        expect.objectContaining({
          error: null,
          response: 'Auto-logged scheduled log "Morning measurement" as event evt_1.',
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

  it('does not run or append a canonical cron result after the claim is replaced', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-claim-replaced-',
    )
    await createCanonicalJob(vaultRoot, 'claim-replaced-canonical')
    const paths = resolveAssistantStatePaths(vaultRoot)
    const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]

    if (!source) {
      throw new Error('Expected canonical source to exist.')
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)
    const claimed = await claimResolvedAssistantCronJob({
      job: {
        kind: 'canonical',
        source,
        runtimeState,
        job: projectCanonicalAssistantCronJob({
          source,
          runtimeState,
        }),
      },
      paths,
    })

    await updateCanonicalRuntimeState(vaultRoot, claimed.job.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        runningAt: '2026-04-08T13:01:00.000Z',
        runningClaimId: 'cronclaim_replacement',
        runningPid: 999,
      },
      updatedAt: '2026-04-08T13:01:00.000Z',
    }))

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('failed')
    expect(result.run.error).toBe(
      'Assistant cron job "claim-replaced-canonical" was reclaimed before it started.',
    )
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(
      listAssistantCronRuns({
        job: claimed.job.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      jobId: claimed.job.jobId,
      runs: [],
    })

    const current = await getAssistantCronJob(vaultRoot, claimed.job.jobId)
    expect(current.state.runningAt).toBe('2026-04-08T13:01:00.000Z')
    expect(current.state.lastSucceededAt).toBeNull()
  })

  it('finalizes a canonical cron run when its own claim becomes stale during execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-long-canonical-run-',
    )
    await createCanonicalJob(vaultRoot, 'long-canonical')
    const paths = resolveAssistantStatePaths(vaultRoot)
    const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]

    if (!source) {
      throw new Error('Expected canonical source to exist.')
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)
    const claimed = await claimResolvedAssistantCronJob({
      job: {
        kind: 'canonical',
        source,
        runtimeState,
        job: projectCanonicalAssistantCronJob({
          source,
          runtimeState,
        }),
      },
      paths,
    })

    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-04-08T14:30:00.000Z'))
      return {
        response: 'Completed long scheduled check-in.',
        session: {
          sessionId: 'session-long-run',
        },
      }
    })

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    await expect(
      listAssistantCronRuns({
        job: claimed.job.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: claimed.job.jobId,
      runs: [
        expect.objectContaining({
          status: 'succeeded',
        }),
      ],
    })

    const current = await getAssistantCronJob(vaultRoot, claimed.job.jobId)
    expect(current.state.runningAt).toBeNull()
    expect(current.state.lastSucceededAt).toBe('2026-04-08T14:30:00.000Z')

    const finalizedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    const runtimeRecord = finalizedRuntimeStore.jobs.find((record) => record.jobId === claimed.job.jobId)
    expect(runtimeRecord?.state.runningClaimId).toBeNull()
  })

  it('processes a canonical daily-local midnight job when runtime state is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T16:00:12.000Z'))
    const queuedIntentId = 'outbox_queued_scheduled_delivery'
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued scheduled reminder.',
        text: 'Remember to sleep.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: queuedIntentId,
        session: {
          sessionId: 'session-default',
        },
      },
      response: 'Remember to sleep.',
      session: {
        sessionId: 'session-default',
      },
    })
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
        deliverySource: null,
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
      succeeded: 0,
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
    expect(updated.state.lastSucceededAt).toBeNull()
    expect(updated.state.nextRunAt).toBeNull()
    expect(updated.state.pendingDeliveryIntentId).toBe(queuedIntentId)
    await expect(
      listAssistantCronRuns({
        job: 'automation-kl-midnight',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'skipped',
        }),
      ],
    })
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
            runStatus: 'skipped',
            scheduleKind: 'dailyLocal',
            sourceKind: 'automation',
          }),
          safeDetails: 'cron_job_delivery_pending',
          type: 'cron.job.completed',
        }),
      ]),
    )

    await reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: queuedIntentId,
        lastError: {
          code: 'LINQ_API_REQUEST_FAILED',
          message: 'Linq request POST /chats/[chat]/messages failed with HTTP 400.',
        },
        sentAt: null,
        status: 'failed',
        updatedAt: '2026-05-04T16:00:20.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })

    const failed = await getAssistantCronJob(vaultRoot, 'automation-kl-midnight')
    expect(failed.state.pendingDeliveryIntentId).toBeUndefined()
    expect(failed.state.lastSucceededAt).toBeNull()
    expect(failed.state.lastFailedAt).toBe('2026-05-04T16:00:20.000Z')
    expect(failed.state.lastError).toBe(
      'Linq request POST /chats/[chat]/messages failed with HTTP 400.',
    )
    expect(failed.state.nextRunAt).toBe('2026-05-04T16:00:50.000Z')
  })

  it('keeps queue-only canonical cron pending until sent outbox confirmation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T16:00:12.000Z'))
    const queuedIntentId = 'outbox_queued_sent_scheduled_delivery'
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued scheduled reminder.',
        text: 'Remember to sleep.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: queuedIntentId,
        session: {
          sessionId: 'session-default',
        },
      },
      response: 'Remember to sleep.',
      session: {
        sessionId: 'session-default',
      },
    })
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'Asia/Kuala_Lumpur',
      },
    })
    const { vaultRoot } = await createRuntimeContext('assistant-cron-runtime-kl-pending-sent-')
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-kl-pending-sent',
      continuityPolicy: 'preserve',
      createdAt: '2026-05-03T22:17:55.000Z',
      instructions: 'Remind me to sleep.',
      route: {
        channel: 'linq',
        deliverySource: null,
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

    await expect(
      processDueAssistantCronJobsLocal({
        deliveryDispatchMode: 'queue-only',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()

    const pending = await getAssistantCronJob(vaultRoot, 'automation-kl-pending-sent')
    expect(pending.state.lastSucceededAt).toBeNull()
    expect(pending.state.nextRunAt).toBeNull()
    expect(pending.state.pendingDeliveryIntentId).toBe(queuedIntentId)

    await expect(
      processDueAssistantCronJobsLocal({
        deliveryDispatchMode: 'queue-only',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 0,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()

    await reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: queuedIntentId,
        lastError: null,
        sentAt: '2026-05-04T16:00:20.000Z',
        status: 'sent',
        updatedAt: '2026-05-04T16:00:20.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })

    const sent = await getAssistantCronJob(vaultRoot, 'automation-kl-pending-sent')
    expect(sent.state.pendingDeliveryIntentId).toBeUndefined()
    expect(sent.state.lastSucceededAt).toBe('2026-05-04T16:00:20.000Z')
    expect(sent.state.lastError).toBeNull()
    expect(sent.state.consecutiveFailures).toBe(0)
    expect(sent.state.nextRunAt).toBe('2026-05-05T16:00:00.000Z')
  })

  it('repairs pending canonical cron delivery when the outbox intent is already terminal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T16:00:12.000Z'))
    const queuedIntentId = 'outbox_terminal_before_scan_delivery'
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued scheduled reminder.',
        text: 'Remember to sleep.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: queuedIntentId,
        session: {
          sessionId: 'session-default',
        },
      },
      response: 'Remember to sleep.',
      session: {
        sessionId: 'session-default',
      },
    })
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'Asia/Kuala_Lumpur',
      },
    })
    const { vaultRoot } = await createRuntimeContext('assistant-cron-runtime-repair-terminal-')
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-repair-terminal',
      continuityPolicy: 'preserve',
      createdAt: '2026-05-03T22:17:55.000Z',
      instructions: 'Remind me to sleep.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '00:00',
      },
      slug: 'repair-terminal-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Repair terminal reminder',
      updatedAt: '2026-05-03T22:17:55.000Z',
    })

    await expect(
      processDueAssistantCronJobsLocal({
        deliveryDispatchMode: 'queue-only',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()

    const pending = await getAssistantCronJob(vaultRoot, 'automation-repair-terminal')
    expect(pending.state.pendingDeliveryIntentId).toBe(queuedIntentId)

    await saveAssistantOutboxIntent(vaultRoot, assistantOutboxIntentSchema.parse({
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: queuedIntentId,
      sessionId: 'asst_repair_terminal',
      turnId: 'turn_repair_terminal',
      createdAt: '2026-05-04T16:00:12.000Z',
      updatedAt: '2026-05-04T16:00:20.000Z',
      lastAttemptAt: '2026-05-04T16:00:18.000Z',
      nextAttemptAt: null,
      sentAt: '2026-05-04T16:00:20.000Z',
      attemptCount: 1,
      status: 'sent',
      message: 'Remember to sleep.',
      subject: null,
      dedupeKey: 'dedupe-repair-terminal',
      targetFingerprint: 'target-fingerprint-repair-terminal',
      channel: 'linq',
      identityId: null,
      actorId: 'participant-1',
      threadId: 'thread-1',
      threadIsDirect: true,
      replyToMessageId: null,
      bindingDelivery: null,
      deliverySource: null,
      explicitTarget: null,
      delivery: {
        channel: 'linq',
        idempotencyKey: null,
        messageLength: 'Remember to sleep.'.length,
        providerMessageId: 'linq-message-repair-terminal',
        providerThreadId: 'thread-1',
        sentAt: '2026-05-04T16:00:20.000Z',
        target: 'thread-1',
        targetKind: 'thread',
      },
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
      lastError: null,
    }))

    const events: Array<{
      failureContext?: Record<string, boolean | number | string | null>
      safeDetails?: string
      type: string
    }> = []
    await expect(
      processDueAssistantCronJobsLocal({
        deliveryDispatchMode: 'queue-only',
        onEvent: (event) => {
          events.push(event)
        },
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 0,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()

    const repaired = await getAssistantCronJob(vaultRoot, 'automation-repair-terminal')
    expect(repaired.state.pendingDeliveryIntentId).toBeUndefined()
    expect(repaired.state.lastSucceededAt).toBe('2026-05-04T16:00:20.000Z')
    expect(repaired.state.nextRunAt).toBe('2026-05-05T16:00:00.000Z')
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureContext: expect.objectContaining({
            dueJobs: 0,
            loadedJobs: 1,
          }),
          safeDetails: 'cron_scan_started',
          type: 'cron.scan.started',
        }),
        expect.objectContaining({
          failureContext: expect.objectContaining({
            due: false,
            pendingDelivery: false,
            reason: 'not_due',
          }),
          safeDetails: 'not_due',
          type: 'cron.scan.job',
        }),
      ]),
    )

    await expect(
      runAssistantCronJobNow({
        job: 'automation-repair-terminal',
        trigger: 'manual',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      run: expect.objectContaining({
        status: 'succeeded',
      }),
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(2)
  })

  it('fails a stale pending canonical delivery when its outbox intent is missing', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-missing-pending-delivery-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'missing-pending-delivery')
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        lastRunAt: '2026-04-08T10:00:00.000Z',
        pendingDeliveryIntentId: 'outbox_missing_pending_delivery',
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
      },
    }))

    await expect(
      repairPendingAssistantCronDeliveries({
        missingIntentStaleAfterMs: 1_000,
        now: new Date('2026-04-09T10:00:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      checked: 1,
      reconciled: 1,
    })

    const repaired = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(repaired.state.pendingDeliveryIntentId).toBeUndefined()
    expect(repaired.state.lastFailedAt).toBe('2026-04-09T10:00:00.000Z')
    expect(repaired.state.lastError).toBe(
      'Assistant cron pending delivery outbox intent is no longer available.',
    )
    expect(repaired.state.nextRunAt).toBe('2026-04-09T10:00:30.000Z')
  })

  it('reconciles pending cron deliveries from terminal outbox transitions', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-outbox-hook-',
    )
    const sentJob = await createCanonicalJob(vaultRoot, 'outbox-hook-sent')
    const sentIntentId = 'outbox_hook_sent_delivery'
    await updateCanonicalRuntimeState(vaultRoot, sentJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        lastRunAt: '2026-04-08T10:00:00.000Z',
        pendingDeliveryIntentId: sentIntentId,
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
      },
    }))
    await saveAssistantOutboxIntent(vaultRoot, buildTestLinqOutboxIntent({
      createdAt: '2026-04-08T10:00:00.000Z',
      intentId: sentIntentId,
    }))

    await expect(
      markAssistantOutboxIntentSentById({
        delivery: {
          channel: 'linq',
          idempotencyKey: null,
          messageLength: 'Remember to sleep.'.length,
          providerMessageId: 'linq-message-outbox-hook',
          providerThreadId: 'thread-1',
          sentAt: '2026-04-08T10:00:20.000Z',
          target: 'thread-1',
          targetKind: 'thread',
        },
        intentId: sentIntentId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      status: 'sent',
    })

    const sent = await getAssistantCronJob(vaultRoot, sentJob.jobId)
    expect(sent.state.pendingDeliveryIntentId).toBeUndefined()
    expect(sent.state.lastSucceededAt).toBe('2026-04-08T10:00:20.000Z')
    expect(sent.state.consecutiveFailures).toBe(0)

    const abandonedJob = await createCanonicalJob(vaultRoot, 'outbox-hook-abandoned')
    const abandonedIntentId = 'outbox_hook_abandoned_delivery'
    await updateCanonicalRuntimeState(vaultRoot, abandonedJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        lastRunAt: '2026-04-08T10:00:00.000Z',
        pendingDeliveryIntentId: abandonedIntentId,
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
      },
    }))
    await saveAssistantOutboxIntent(vaultRoot, buildTestLinqOutboxIntent({
      createdAt: '2026-04-08T10:00:00.000Z',
      intentId: abandonedIntentId,
    }))

    await expect(
      markAssistantOutboxIntentMirrorTerminalById({
        error: new Error('provider abandoned delivery'),
        failedAt: new Date('2026-04-08T10:01:00.000Z'),
        intentId: abandonedIntentId,
        status: 'abandoned',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      status: 'abandoned',
    })

    const abandoned = await getAssistantCronJob(vaultRoot, abandonedJob.jobId)
    expect(abandoned.state.pendingDeliveryIntentId).toBeUndefined()
    expect(abandoned.state.lastFailedAt).toBe('2026-04-08T10:01:00.000Z')
    expect(abandoned.state.lastError).toBe('provider abandoned delivery')
    expect(abandoned.state.nextRunAt).toBe('2026-04-08T10:01:30.000Z')
  })

  it('drops stale pending canonical occurrences when delivery fails after a schedule edit', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-outbox-stale-pending-edit-',
    )
    const editedJob = await createCanonicalJob(vaultRoot, 'outbox-stale-pending-edit')
    const staleIntentId = 'outbox_stale_pending_edit_delivery'
    await updateCanonicalRuntimeState(vaultRoot, editedJob.jobId, (record) => ({
      ...record,
      updatedAt: '2026-04-08T09:59:00.000Z',
      state: {
        ...record.state,
        lastRunAt: '2026-04-08T10:00:00.000Z',
        pendingDeliveryIntentId: staleIntentId,
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
      },
    }))
    const source = findCanonicalAutomation(vaultRoot, editedJob.jobId)
    if (!source) {
      throw new Error('Expected canonical automation source to exist.')
    }
    source.schedule = {
      at: '2026-04-08T12:00:00.000Z',
      kind: 'at',
    }
    source.updatedAt = '2026-04-08T10:00:30.000Z'
    const editedSource = (await listCanonicalAssistantCronRecords(vaultRoot))
      .find((record) => record.kind === 'automation' && record.automationId === editedJob.jobId)
    expect(editedSource?.schedule).toEqual({
      at: '2026-04-08T12:00:00.000Z',
      kind: 'at',
    })
    expect(editedSource?.updatedAt).toBe('2026-04-08T10:00:30.000Z')
    const pendingStore = await readAssistantCronCanonicalRuntimeStore(
      resolveAssistantStatePaths(vaultRoot),
    )
    const pendingRecord = pendingStore.jobs.find((record) =>
      record.jobId === editedJob.jobId
    )
    expect(pendingRecord?.updatedAt).toBe('2026-04-08T09:59:00.000Z')
    await saveAssistantOutboxIntent(vaultRoot, buildTestLinqOutboxIntent({
      createdAt: '2026-04-08T10:00:00.000Z',
      intentId: staleIntentId,
    }))

    await expect(
      markAssistantOutboxIntentMirrorTerminalById({
        error: new Error('provider failed delivery after schedule edit'),
        failedAt: new Date('2026-04-08T10:01:00.000Z'),
        intentId: staleIntentId,
        status: 'failed',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
    })

    const failed = await getAssistantCronJob(vaultRoot, editedJob.jobId)
    expect(failed.state.pendingDeliveryIntentId).toBeUndefined()
    expect(failed.state.lastFailedAt).toBe('2026-04-08T10:01:00.000Z')
    expect(failed.state.lastError).toBe('provider failed delivery after schedule edit')
    expect(failed.state.nextRunAt).toBe('2026-04-08T12:00:00.000Z')
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(
      resolveAssistantStatePaths(vaultRoot),
    )
    const runtimeRecord = runtimeStore.jobs.find((record) =>
      record.jobId === editedJob.jobId
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBe('2026-04-08T12:00:00.000Z')
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
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

function getVaultScheduledLogStore(vault: string): ScheduledLogQueryRecord[] {
  const existing = cronMocks.scheduledLogsByVault.get(vault)
  if (existing) {
    return existing
  }

  const created: ScheduledLogQueryRecord[] = []
  cronMocks.scheduledLogsByVault.set(vault, created)
  return created
}

function findCanonicalAutomation(
  vault: string,
  lookup: string,
): MockAutomationRecord | undefined {
  const normalized = lookup.trim()
  return getVaultAutomationStore(vault).find(
    (record) =>
      record.automationId === normalized ||
      record.slug === normalized ||
      record.title === normalized,
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

function buildTestLinqOutboxIntent(input: {
  createdAt: string
  intentId: string
  message?: string
  status?: AssistantOutboxIntent['status']
  updatedAt?: string
}): AssistantOutboxIntent {
  const message = input.message ?? 'Remember to sleep.'
  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId: input.intentId,
    sessionId: `asst_${input.intentId}`,
    turnId: `turn_${input.intentId}`,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    lastAttemptAt: null,
    nextAttemptAt: null,
    sentAt: null,
    attemptCount: 0,
    status: input.status ?? 'pending',
    message,
    subject: null,
    dedupeKey: `dedupe-${input.intentId}`,
    targetFingerprint: `target-fingerprint-${input.intentId}`,
    channel: 'linq',
    identityId: null,
    actorId: 'participant-1',
    threadId: 'thread-1',
    threadIsDirect: true,
    replyToMessageId: null,
    bindingDelivery: null,
    deliverySource: null,
    explicitTarget: null,
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: null,
    deliveryTransportIdempotent: false,
    lastError: null,
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
