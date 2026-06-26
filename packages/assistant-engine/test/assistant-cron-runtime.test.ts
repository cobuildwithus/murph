import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { inferGatewayReplyRouteForChannel } from '@murphai/gateway-core'
import type { AutomationSchedule } from '@murphai/contracts'
import {
  assistantCronJobSchema,
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
  type AssistantCronJob,
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
  schedule: AutomationSchedule
  relativePath?: string
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
  executeScheduledLogOccurrence: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  listCanonicalScheduledLogs: vi.fn(),
  listCanonicalAutomations: vi.fn(),
  loadImporterRuntime: vi.fn(),
  loadRuntimeModule: vi.fn(),
  loadVault: vi.fn(),
  nextAutomationId: 1,
  renderAutoLoggedFoodMealNote: vi.fn(),
  readAutomationByRelativePath: vi.fn(),
  resolveAssistantBindingDelivery: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  setScheduledLogStatus: vi.fn(),
  scheduledLogsByVault: new Map<string, ScheduledLogQueryRecord[]>(),
  showCanonicalAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
  withAssistantCronWriteLock: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
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
    readAutomationByRelativePath: cronMocks.readAutomationByRelativePath,
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
  buildAssistantCronTargetSnapshot,
} from '../src/assistant/cron/targets.ts'
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import {
  appendAssistantDeviceActivityCronJobMetadata,
  buildAssistantDeviceActivityAuthorityKey,
  buildAssistantDeviceActivityDeliveryIdempotencyKey,
} from '../src/assistant/device-activity-cron-tags.ts'
import {
  completeAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
} from '../src/assistant/onboarding-state.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  dispatchAssistantOutboxIntent,
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
        deliveryKind,
        deliveryTarget,
        threadId,
      }: {
        actorId?: string | null
        channel?: string | null
        deliveryKind?: 'participant' | 'thread' | null
        deliveryTarget?: string | null
        threadId?: string | null
      }) => {
        if (!channel) {
          return null
        }

        return inferGatewayReplyRouteForChannel({
          channel,
          conversation: {
            participantId: actorId,
            threadId,
          },
          deliveryKind,
          deliveryTarget,
        })
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
  cronMocks.readAutomationByRelativePath.mockReset().mockImplementation(
    async (vault: string, relativePath: string) =>
      getVaultAutomationStore(vault).find((record) =>
        record.relativePath === relativePath
      ) ?? null,
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
  cronMocks.upsertAutomation.mockReset().mockImplementation(
    async (input: {
      automationId?: string
      continuityPolicy?: 'fresh' | 'preserve'
      instructions: string
      route: MockAutomationRecord['route']
      schedule: AutomationSchedule
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

  it('rejects Linq participant automation seeds without a Linq delivery source', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-automation-linq-participant-no-source-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    await expect(
      upsertAssistantCronAutomation({
        firstOccurrencePolicy: 'after-current-local-day',
        instructions: 'Check setup progress.',
        now: new Date('2026-04-08T15:00:00.000Z'),
        route: {
          channel: 'linq',
          deliverySource: null,
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
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
    })

    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toBeUndefined()
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

    // The automation outlives the runtime-state write failure; readers
    // synthesize initial runtime state and re-seeding remains idempotent.
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      status: 'active',
    })

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

  it('computes status next run by timestamp order instead of string order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-24T05:11:00.000Z'))
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-status-timestamp-order-',
    )

    getVaultAutomationStore(vaultRoot).push(
      {
        automationId: 'automation-daily-0830',
        continuityPolicy: 'fresh',
        createdAt: '2026-06-24T05:10:00.000Z',
        instructions: 'Send the morning check-in.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'linq_chat_morning',
          identityId: 'identity-1',
          participantId: 'participant-1',
          threadId: 'thread-1',
        },
        schedule: {
          kind: 'dailyLocal',
          localTime: '08:30',
        },
        slug: 'morning-check-in',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: 'Morning check-in',
        updatedAt: '2026-06-24T05:10:00.000Z',
      },
      {
        automationId: 'automation-one-shot-0900',
        continuityPolicy: 'fresh',
        createdAt: '2026-06-24T05:10:00.000Z',
        instructions: 'Send the one-shot check-in.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'linq_chat_morning',
          identityId: 'identity-1',
          participantId: 'participant-1',
          threadId: 'thread-1',
        },
        schedule: {
          at: '2026-06-24T09:00:00-04:00',
          kind: 'at',
        },
        slug: 'one-shot-check-in',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: 'One-shot check-in',
        updatedAt: '2026-06-24T05:10:00.000Z',
      },
    )

    const jobs = await listAssistantCronJobs(vaultRoot)
    const status = await getAssistantCronStatus(vaultRoot)

    expect(jobs.map((job) => [job.name, job.state.nextRunAt])).toEqual([
      ['Morning check-in', '2026-06-24T12:30:00.000Z'],
      ['One-shot check-in', '2026-06-24T09:00:00-04:00'],
    ])
    expect(status.nextRunAt).toBe('2026-06-24T12:30:00.000Z')
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

  it('skips a device activity local job when the parent listener is no longer active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-activity-parent-authority-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const parentAutomationId = 'automation-device-activity-listener'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about imported runs.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'linq_chat_device_activity',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: 'deviceActivity',
        after: '2026-04-08T08:00:00.000Z',
        activityKind: 'run',
        source: 'whoop',
      },
      slug: 'device-activity-listener',
      status: 'paused',
      summary: null,
      tags: ['device'],
      title: 'Device activity listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const localJob = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:59:00.000Z',
      enabled: true,
      jobId: 'cron_device_activity_listener',
      keepAfterRun: true,
      name: appendAssistantDeviceActivityCronJobMetadata(
        'Device activity listener',
        {
          authorityKey: buildDeviceActivityAuthorityKey(parentAutomation),
          occurrenceKey: '1234567890abcdef1234567890abcdef12345678',
          parentAutomationId,
          parentAutomationRelativePath: 'bank/automations/device-activity-listener.md',
        },
      ),
      prompt: 'Ask about the imported run.',
      schedule: {
        at: '2026-04-08T08:59:30.000Z',
        kind: 'at',
      },
      schema: 'murph.assistant-cron-job.v1',
      state: {
        consecutiveFailures: 0,
        lastError: null,
        lastFailedAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        nextRunAt: '2026-04-08T08:59:30.000Z',
        runningAt: null,
        runningPid: null,
      },
      target: {
        alias: null,
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'linq_chat_device_activity',
        identityId: null,
        participantId: null,
        sessionId: null,
        threadId: null,
      },
      updatedAt: '2026-04-08T08:59:00.000Z',
    })
    await writeAssistantCronStore(paths, {
      version: 1,
      jobs: [localJob],
    })

    cronMocks.listCanonicalAutomations.mockClear()
    cronMocks.readAutomationByRelativePath.mockClear()
    await expect(
      processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })

    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(cronMocks.readAutomationByRelativePath).toHaveBeenCalledWith(
      vaultRoot,
      'bank/automations/device-activity-listener.md',
    )
    expect(cronMocks.listCanonicalAutomations).not.toHaveBeenCalledWith(vaultRoot, {
      status: ['active', 'paused', 'archived'],
    })
    const runs = await listAssistantCronRuns({
      job: localJob.jobId,
      vault: vaultRoot,
    })
    expect(runs.runs).toEqual([
      expect.objectContaining({
        error: expect.stringContaining('parent listener is no longer authorized'),
        response: null,
        status: 'skipped',
      }),
    ])
    await expect(getAssistantCronJob(vaultRoot, localJob.jobId)).resolves.toMatchObject({
      enabled: false,
      state: expect.objectContaining({
        lastSucceededAt: '2026-04-08T09:00:00.000Z',
        nextRunAt: null,
      }),
    })
  })

  it('fails queued device activity outbox delivery when parent authority changes before dispatch', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-outbox-stale-',
    )
    const parentAutomationId = 'auto_device_activity_outbox'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about the imported run.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'linq_chat_device_activity',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        after: '2026-04-08T08:00:00.000Z',
        activityKind: 'run',
        kind: 'deviceActivity',
        source: 'whoop',
      },
      slug: 'device-activity-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Device activity listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const metadata = {
      authorityKey: buildDeviceActivityAuthorityKey(parentAutomation),
      occurrenceKey: 'abcdef1234567890abcdef1234567890abcdef12',
      parentAutomationId,
      parentAutomationRelativePath: 'bank/automations/device-activity-listener.md',
    }
    const intent = buildTestLinqOutboxIntent({
      createdAt: '2026-04-08T08:01:00.000Z',
      intentId: 'outbox_device_activity_stale',
      message: 'How did that run feel?',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...intent,
      deliveryIdempotencyKey: buildAssistantDeviceActivityDeliveryIdempotencyKey({
        discriminator: {
          jobId: 'cron_device_activity_listener',
          target: intent.targetFingerprint,
        },
        metadata,
      }),
      nextAttemptAt: '2026-04-08T08:02:00.000Z',
    })

    parentAutomation.status = 'paused'
    cronMocks.listCanonicalAutomations.mockClear()
    cronMocks.readAutomationByRelativePath.mockClear()
    const prepareDispatchIntent = vi.fn()
    const dispatched = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        prepareDispatchIntent,
      },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-04-08T08:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(prepareDispatchIntent).not.toHaveBeenCalled()
    expect(cronMocks.readAutomationByRelativePath).toHaveBeenCalledWith(
      vaultRoot,
      'bank/automations/device-activity-listener.md',
    )
    expect(cronMocks.listCanonicalAutomations).not.toHaveBeenCalled()
    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toEqual(
      expect.objectContaining({
        code: 'ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE',
      }),
    )
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:20:00.000Z'))
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
        serviceTier: null,
        turnEnvironment,
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('passes hosted provider trace callbacks into scheduled notification sends', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:20:00.000Z'))
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

  it('uses flex service tier with a deadline for clean hosted scheduled notification sends', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-flex-tier-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'flex-tier')
    const upstreamAbort = new AbortController()

    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T08:00:00.000Z',
      },
    }))
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (input: { abortSignal?: AbortSignal; serviceTier?: string | null }) => {
        expect(input.serviceTier).toBe('flex')
        expect(input.abortSignal).toBe(upstreamAbort.signal)
        expect(input.abortSignal?.aborted).toBe(false)
        upstreamAbort.abort()
        expect(input.abortSignal?.aborted).toBe(true)

        return {
          response: 'Completed flex scheduled check-in.',
          session: {
            sessionId: 'session-flex-tier',
          },
        }
      },
    )

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-flex-tier',
          userEnvKeys: [],
        },
      },
      limit: 1,
      signal: upstreamAbort.signal,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
  })

  it('uses standard service tier for hosted scheduled notification retries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-flex-retry-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'flex-retry')

    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        consecutiveFailures: 1,
        pendingOccurrenceAt: '2026-04-08T08:00:00.000Z',
      },
    }))

    await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-flex-retry',
          userEnvKeys: [],
        },
      },
      limit: 1,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceTier: null,
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('persists the private summary when a scheduled notification turn returns no response', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:20:00.000Z'))
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
      safeErrorMessage?: string
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
            'Assistant cron notification expired before delivery.',
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

  it('surfaces the typed failure code in cron.job.completed events', async () => {
    // Provider quota exhaustion (June 2026 incident) must be queryable from
    // the persisted runtime log via failureContext.errorCode instead of only
    // living as free text in per-vault run records.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:05:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-error-code-',
    )
    await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'quota failing reminder',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Evening reminder.',
      schedule: {
        kind: 'at',
        at: '2026-04-08T09:00:00.000Z',
      },
      vault: vaultRoot,
    })
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(
      new VaultCliError(
        'ASSISTANT_CODEX_USAGE_LIMIT',
        'Codex app-server turn failed. status failed. You have reached your monthly cap.',
      ),
    )
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
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureContext: expect.objectContaining({
            errorCode: 'ASSISTANT_CODEX_USAGE_LIMIT',
            errorPresent: true,
            runStatus: 'failed',
            scheduleKind: 'at',
            sourceKind: 'automation',
          }),
          safeErrorMessage:
            'Codex app-server turn failed. status failed. You have reached your monthly cap.',
          type: 'cron.job.completed',
        }),
      ]),
    )
  })

  it('skips stale recurring canonical notification cron jobs and advances the schedule', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-stale-recurring-canonical-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'late daily reminder')

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
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'active',
    )

    const updated = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(updated.state.lastRunAt).toBe('2026-04-08T13:00:00.000Z')
    expect(updated.state.lastSucceededAt).toBe('2026-04-08T13:00:00.000Z')
    expect(updated.state.lastError).toBeNull()
    expect(updated.state.consecutiveFailures).toBe(0)
    expect(updated.state.nextRunAt).toBe('2026-04-09T10:00:00.000Z')
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
            'Assistant cron notification expired before delivery.',
          ),
          response: null,
          status: 'skipped',
        }),
      ],
    })
  })

  it('skips stale recurring canonical notification retries by original occurrence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T11:15:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-stale-recurring-canonical-retry-',
    )
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'late daily retry reminder',
    )
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        consecutiveFailures: 1,
        lastError: 'temporary send failure',
        lastFailedAt: '2026-04-08T10:30:00.000Z',
        pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
        retryAfterAt: '2026-04-08T10:40:00.000Z',
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
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'active',
    )

    const updated = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(updated.state.lastRunAt).toBe('2026-04-08T11:15:00.000Z')
    expect(updated.state.lastSucceededAt).toBe('2026-04-08T11:15:00.000Z')
    expect(updated.state.lastError).toBeNull()
    expect(updated.state.consecutiveFailures).toBe(0)
    expect(updated.state.nextRunAt).toBe('2026-04-09T10:00:00.000Z')
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
            'Scheduled occurrence was 75 minute(s) late.',
          ),
          response: null,
          status: 'skipped',
        }),
      ],
    })
  })

  it('skips stale recurring local cron jobs without removing them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:35:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-stale-recurring-local-',
    )
    const job = await createLocalJob(vaultRoot, 'stale-local')

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
    const updated = await getAssistantCronJob(vaultRoot, job.jobId)
    expect(updated.state.lastRunAt).toBe('2026-04-08T10:35:00.000Z')
    expect(updated.state.lastSucceededAt).toBe('2026-04-08T10:35:00.000Z')
    expect(updated.state.lastError).toBeNull()
    expect(updated.state.consecutiveFailures).toBe(0)
    expect(updated.state.nextRunAt).toBe('2026-04-09T09:30:00.000Z')
    await expect(
      listAssistantCronRuns({
        job: job.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: job.jobId,
      runs: [
        expect.objectContaining({
          error: expect.stringContaining(
            'Assistant cron notification expired before delivery.',
          ),
          status: 'skipped',
        }),
      ],
    })
  })

  it('skips stale kept one-shot local cron jobs and disables them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:35:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-stale-kept-one-shot-',
    )
    const job = await createLocalJob(vaultRoot, 'stale-kept-one-shot', {
      kind: 'at',
      at: '2026-04-08T09:30:00.000Z',
    })

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
    const updated = await getAssistantCronJob(vaultRoot, job.jobId)
    expect(updated.enabled).toBe(false)
    expect(updated.state.nextRunAt).toBeNull()
    expect(updated.state.lastError).toBeNull()
    await expect(
      listAssistantCronRuns({
        job: job.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: job.jobId,
      runs: [
        expect.objectContaining({
          error: expect.stringContaining(
            'Assistant cron notification expired before delivery.',
          ),
          status: 'skipped',
        }),
      ],
    })
  })

  it('expires canonical one-shot notification retries by original occurrence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:05:00.000Z'))
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
          error: expect.stringContaining('Scheduled occurrence was 65 minute(s) late.'),
          status: 'skipped',
        }),
      ],
    })
  })

  it('runs canonical one-shot notification cron jobs within the expiry window', async () => {
    vi.useFakeTimers()
    // 55 minutes late: stale under the previous 30-minute window, deliverable
    // under the 60-minute window.
    vi.setSystemTime(new Date('2026-04-08T09:55:00.000Z'))
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

  it('delivers canonical one-shot notifications exactly at the 60-minute expiry boundary', async () => {
    vi.useFakeTimers()
    // Exactly 60 minutes late: the expiry window is inclusive, so this must
    // still deliver.
    vi.setSystemTime(new Date('2026-04-08T10:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-boundary-one-shot-',
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'boundary one-shot reminder',
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

  it('skips canonical one-shot notifications just past the 60-minute expiry boundary', async () => {
    vi.useFakeTimers()
    // One millisecond past the inclusive 60-minute window: must skip and
    // archive instead of delivering.
    vi.setSystemTime(new Date('2026-04-08T10:00:00.001Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-past-boundary-one-shot-',
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'past-boundary one-shot reminder',
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
          error: expect.stringContaining('Scheduled occurrence was 60 minute(s) late.'),
          status: 'skipped',
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:10:00.000Z'))
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
      target: {
        ...job.target,
        channel: 'telegram',
        deliveryTarget: 'local-room-1',
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
                pendingOccurrenceAt: '2026-04-08T12:45:00.000Z',
                runningAt: '2026-04-08T11:30:00.000Z',
                runningPid: 111,
              },
              updatedAt: '2026-04-08T11:30:00.000Z',
            },
            {
              ...freshRecord,
              state: {
                ...freshRecord.state,
                pendingOccurrenceAt: '2026-04-08T12:45:00.000Z',
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
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
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
      vi.setSystemTime(new Date('2026-04-08T11:50:00.000Z'))
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
    expect(current.state.lastSucceededAt).toBe('2026-04-08T11:50:00.000Z')

    const finalizedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    const runtimeRecord = finalizedRuntimeStore.jobs.find((record) => record.jobId === claimed.job.jobId)
    expect(runtimeRecord?.state.runningClaimId).toBeNull()
  })

  it('ignores and clears a stale session pin when a preserve route has conversation locators', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-keyed-preserve-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-keyed-preserve',
      continuityPolicy: 'preserve',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Remind me to stretch.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'linq_chat_real',
        identityId: 'identity-1',
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '10:00',
      },
      slug: 'keyed-preserve-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Keyed preserve reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]

    if (!source) {
      throw new Error('Expected canonical source to exist.')
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeState = {
      ...resolveCanonicalRuntimeState(source, runtimeStore),
      sessionId: 'session-stale-pin',
    }
    const projected = projectCanonicalAssistantCronJob({
      source,
      runtimeState,
    })
    expect(projected.target.sessionId).toBeNull()
    expect(projected.target.threadId).toBe('thread-1')

    const claimed = await claimResolvedAssistantCronJob({
      job: {
        kind: 'canonical',
        source,
        runtimeState,
        job: projected,
      },
      paths,
    })
    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: null,
        threadId: 'thread-1',
      }),
    )
    const finalizedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    const runtimeRecord = finalizedRuntimeStore.jobs.find(
      (record) => record.jobId === claimed.job.jobId,
    )
    expect(runtimeRecord?.sessionId).toBeNull()
  })

  it('executes canonical Telegram cron jobs with a thread-only route', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-telegram-thread-only-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-telegram-thread-only',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the sleep reminder.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: '123456789',
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'telegram-thread-only-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Telegram thread-only reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]

    if (!source) {
      throw new Error('Expected canonical source to exist.')
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)
    const projected = projectCanonicalAssistantCronJob({
      source,
      runtimeState,
    })
    expect(projected.target).toMatchObject({
      channel: 'telegram',
      deliveryTarget: null,
      participantId: null,
      threadId: '123456789',
    })

    const claimed = await claimResolvedAssistantCronJob({
      job: {
        kind: 'canonical',
        source,
        runtimeState,
        job: projected,
      },
      paths,
    })
    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: '123456789',
        channel: 'telegram',
        deliveryKind: 'thread',
        deliveryTarget: null,
        participantId: null,
        sessionId: null,
        threadId: '123456789',
      }),
    )
  })

  it('executes existing email thread routes only when a sender identity is present', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-email-thread-identity-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-email-thread-identity',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Reply to the existing email thread.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: null,
        threadId: 'email-thread-123',
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'email-thread-identity-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Email thread identity reminder',
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
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'email-thread-123',
        channel: 'email',
        deliveryKind: 'thread',
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: null,
        threadId: 'email-thread-123',
      }),
    )
  })

  it('executes existing local email participant routes when a sender identity is present', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-email-participant-identity-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-email-participant-identity',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the email participant reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: 'recipient@example.test',
        threadId: null,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'email-participant-identity-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Email participant identity reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
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
        bindingDeliveryTarget: 'recipient@example.test',
        channel: 'email',
        deliveryDispatchMode: 'queue-only',
        deliveryKind: 'participant',
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: 'recipient@example.test',
        threadId: null,
      }),
    )
  })

  it('executes existing local queue-only email thread routes when a sender identity is present', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-email-thread-identity-queue-only-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-email-thread-identity-queue-only',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Reply to the existing email thread.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: null,
        threadId: 'email-thread-123',
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'email-thread-identity-queue-only-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Email thread identity queue-only reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
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
        bindingDeliveryTarget: 'email-thread-123',
        channel: 'email',
        deliveryDispatchMode: 'queue-only',
        deliveryKind: 'thread',
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        threadId: 'email-thread-123',
      }),
    )
  })

  it('rejects email participant routes before hosted queue-only execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-hosted-email-participant-identity-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-hosted-email-participant-identity',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the hosted email participant reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: 'recipient@example.test',
        threadId: null,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'hosted-email-participant-identity-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Hosted email participant identity reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-email-participant-identity',
          userEnvKeys: [],
        },
      },
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(
      listAssistantCronRuns({
        job: 'automation-hosted-email-participant-identity',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: 'automation-hosted-email-participant-identity',
      runs: [
        expect.objectContaining({
          error: expect.stringContaining('explicit delivery target'),
          status: 'failed',
        }),
      ],
    })
  })

  it('rejects email thread routes before hosted queue-only execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-hosted-email-thread-identity-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-hosted-email-thread-identity',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Reply to the existing email thread.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'agentmail-inbox-1',
        participantId: null,
        threadId: 'email-thread-123',
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'hosted-email-thread-identity-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Hosted email thread identity reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-email-thread-identity',
          userEnvKeys: [],
        },
      },
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(
      listAssistantCronRuns({
        job: 'automation-hosted-email-thread-identity',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: 'automation-hosted-email-thread-identity',
      runs: [
        expect.objectContaining({
          error: expect.stringContaining('explicit delivery target'),
          status: 'failed',
        }),
      ],
    })
  })

  it('rejects existing explicit email targets without a usable sender identity outside hosted execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))

    for (const scenario of [
      {
        automationId: 'automation-explicit-email-target-local',
        identityId: null,
        processInput: {},
        vaultPrefix: 'assistant-cron-runtime-explicit-email-target-local-',
      },
      {
        automationId: 'automation-explicit-email-target-queue-only-local',
        identityId: null,
        processInput: { deliveryDispatchMode: 'queue-only' as const },
        vaultPrefix: 'assistant-cron-runtime-explicit-email-target-queue-only-local-',
      },
      {
        automationId: 'automation-explicit-email-target-private-identity-local',
        identityId: 'hid_email_identity',
        processInput: {},
        vaultPrefix: 'assistant-cron-runtime-explicit-email-target-private-identity-local-',
      },
    ]) {
      const { vaultRoot } = await createRuntimeContext(scenario.vaultPrefix)
      getVaultAutomationStore(vaultRoot).push({
        automationId: scenario.automationId,
        continuityPolicy: 'fresh',
        createdAt: '2026-04-08T08:00:00.000Z',
        instructions: 'Send the explicit email reminder.',
        route: {
          channel: 'email',
          deliverySource: null,
          deliveryTarget: 'team@example.com',
          identityId: scenario.identityId,
          participantId: null,
          threadId: null,
        },
        schedule: {
          at: '2026-04-08T10:00:00.000Z',
          kind: 'at',
        },
        slug: 'explicit-email-target-local-reminder',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: 'Explicit email target local reminder',
        updatedAt: '2026-04-08T08:00:00.000Z',
      })

      const events: unknown[] = []
      const summary = await processDueAssistantCronJobsLocal({
        ...scenario.processInput,
        limit: 1,
        onEvent: (event) => {
          events.push(event)
        },
        vault: vaultRoot,
      })

      expect(summary).toEqual({
        failed: 1,
        processed: 1,
        succeeded: 0,
      })
      expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
      expect(
        (
          await listAssistantCronRuns({
            job: scenario.automationId,
            vault: vaultRoot,
          })
        ).runs[0],
      ).toMatchObject({
        error: expect.stringContaining('sender identity'),
        status: 'failed',
      })
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            failureContext: expect.objectContaining({
              errorCode: 'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
              errorPresent: true,
              runStatus: 'failed',
            }),
            type: 'cron.job.completed',
          }),
        ]),
      )
    }
  })

  it('executes existing explicit hosted email targets without a sender identity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-explicit-email-target-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-explicit-email-target',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the explicit email reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: 'team@example.com',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'explicit-email-target-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Explicit email target reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    const events: unknown[] = []
    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-explicit-email-target',
          userEnvKeys: [],
        },
      },
      limit: 1,
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
        bindingDeliveryTarget: undefined,
        channel: 'email',
        deliveryKind: undefined,
        deliveryTarget: 'team@example.com',
        identityId: null,
        participantId: null,
        threadId: null,
      }),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureContext: expect.objectContaining({
            routeConfigured: true,
          }),
          type: 'cron.scan.job',
        }),
        expect.objectContaining({
          failureContext: expect.objectContaining({
            routeConfigured: true,
            runStatus: 'succeeded',
          }),
          type: 'cron.job.completed',
        }),
      ]),
    )
  })

  it('executes canonical Telegram cron jobs with a mixed participant and thread route by thread id', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-telegram-mixed-route-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-telegram-mixed-route',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the Telegram group reminder.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'telegram-user-123',
        threadId: 'telegram-chat-456',
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'telegram-mixed-route-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Telegram mixed route reminder',
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
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'telegram-chat-456',
        channel: 'telegram',
        deliveryKind: 'thread',
        deliveryTarget: null,
        participantId: 'telegram-user-123',
        sessionId: null,
        threadId: 'telegram-chat-456',
      }),
    )
  })

  it('skips managed weekly health insight cron before provider work while onboarding is open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-managed-insight-onboarding-open-',
    )
    addManagedResearchAutomation({
      tag: 'murph-managed:weekly-health-insight',
      vaultRoot,
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('skipped')
    expect(result.run.error).toBe(
      'Assistant cron research-oriented managed automation skipped because assistant onboarding is open.',
    )
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(
      listAssistantCronRuns({
        job: claimed.job.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'skipped',
        }),
      ],
    })
    const current = await getAssistantCronJob(vaultRoot, claimed.job.jobId)
    expect(current.state.runningAt).toBeNull()
    expect(current.state.pendingDeliveryIntentId).toBeFalsy()
    expect(current.state.nextRunAt).toBe('2026-04-09T10:00:00.000Z')
  })

  it('fails closed before provider work when managed research onboarding state is unreadable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-managed-research-onboarding-unreadable-',
    )
    addManagedResearchAutomation({
      tag: 'murph-managed:weekly-health-research-scout',
      vaultRoot,
    })
    const onboardingStatePath = resolveAssistantOnboardingStatePath(vaultRoot)
    await mkdir(path.dirname(onboardingStatePath), { recursive: true })
    await writeFile(onboardingStatePath, '{ invalid onboarding json', 'utf8')
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('skipped')
    expect(result.run.error).toBe(
      'Assistant cron research-oriented managed automation skipped because assistant onboarding state could not be read.',
    )
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
  })

  it('runs managed research cron normally after onboarding is complete', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-managed-research-onboarding-complete-',
    )
    addManagedResearchAutomation({
      tag: 'murph-managed:weekly-health-research-scout',
      vaultRoot,
    })
    await completeAssistantOnboarding({
      completedAt: '2026-04-08T09:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDedupeToken: expect.stringContaining(claimed.job.jobId),
        instructions: 'Run weekly-health-research-scout.',
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('selects and sends the June 13 Warsaw Telegram thread-only reminder when 32 minutes overdue', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T20:47:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-warsaw-thread-only-reminder-',
    )
    const automationId = 'automation_test_warsaw_thread_only_reminder'
    const threadId = 'hid_test_warsaw_thread_only_reminder'
    getVaultAutomationStore(vaultRoot).push({
      automationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-06-11T08:00:00.000Z',
      instructions: 'Send the red light glasses before bed reminder.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId,
      },
      schedule: {
        at: '2026-06-13T22:15:00+02:00',
        kind: 'at',
      },
      slug: 'experiment-week-one-red-light-glasses-before-bed-2026-06-11-2026-06-13',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Red Light Glasses Before Bed',
      updatedAt: '2026-06-11T08:00:00.000Z',
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
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: threadId,
        channel: 'telegram',
        deliveryDedupeToken: expect.stringContaining(
          `assistant-cron|${automationId}|2026-06-13T22:15:00+02:00`,
        ),
        deliveryKind: 'thread',
        deliveryTarget: null,
        instructions: 'Send the red light glasses before bed reminder.',
        participantId: null,
        sessionId: null,
        threadId,
        turnTrigger: 'automation-cron',
      }),
    )
    await expect(
      listAssistantCronRuns({
        job: automationId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: automationId,
      runs: [
        expect.objectContaining({
          error: null,
          status: 'succeeded',
        }),
      ],
    })
    expect(getVaultAutomationStore(vaultRoot).find(
      (record) => record.automationId === automationId,
    )?.status).toBe('archived')
  })

  it('fails an existing email thread-locator-only automation before running the assistant turn', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T15:00:05.000Z'))
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-email-thread-only-',
    )
    const automationId = 'automation_email_thread_only_reminder'
    getVaultAutomationStore(vaultRoot).push({
      automationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-06-19T14:56:00.000Z',
      instructions: 'Send the 11am reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'h1_333333333333333333333333',
      },
      schedule: {
        expression: '0 11 * * 5',
        kind: 'cron',
      },
      slug: 'email-thread-only-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Email thread-only reminder',
      updatedAt: '2026-06-19T14:56:00.000Z',
    })

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(
      listAssistantCronRuns({
        job: automationId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: automationId,
      runs: [
        expect.objectContaining({
          error: expect.stringContaining('Email assistant cron jobs require an explicit delivery target'),
          status: 'failed',
        }),
      ],
    })
  })

  it('fails an existing email placeholder-target automation before running the assistant turn', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T15:00:05.000Z'))
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-email-placeholder-target-',
    )
    const automationId = 'automation_email_placeholder_target_reminder'
    getVaultAutomationStore(vaultRoot).push({
      automationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-06-19T14:56:00.000Z',
      instructions: 'Send the 11am reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: 'h1_333333333333333333333333',
        identityId: 'identity_email_sender_1',
        participantId: null,
        threadId: null,
      },
      schedule: {
        expression: '0 11 * * 5',
        kind: 'cron',
      },
      slug: 'email-placeholder-target-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Email placeholder-target reminder',
      updatedAt: '2026-06-19T14:56:00.000Z',
    })

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(
      listAssistantCronRuns({
        job: automationId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: automationId,
      runs: [
        expect.objectContaining({
          error: expect.stringContaining(
            'Email assistant cron jobs cannot use redacted conversation placeholders as delivery targets',
          ),
          status: 'failed',
        }),
      ],
    })
  })

  it('keeps pinning the response session for a preserve route without conversation locators', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-keyless-preserve-',
    )
    await createCanonicalJob(vaultRoot, 'keyless-preserve')
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
    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    const finalizedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    const runtimeRecord = finalizedRuntimeStore.jobs.find(
      (record) => record.jobId === claimed.job.jobId,
    )
    expect(runtimeRecord?.sessionId).toBe('session-default')
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
        bindingDeliveryTarget: 'thread-1',
        channel: 'linq',
        deliveryDispatchMode: 'queue-only',
        deliveryDedupeToken: expect.stringContaining(
          'assistant-cron|automation-kl-midnight|2026-05-04T16:00:00.000Z',
        ),
        deliveryKind: 'thread',
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

  it('passes an explicit participant delivery target for a source-backed mixed Linq route', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T16:00:12.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-linq-pinned-mixed-route-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-linq-pinned-mixed-route',
      continuityPolicy: 'preserve',
      createdAt: '2026-05-03T22:17:55.000Z',
      instructions: 'Remind me to stand up.',
      route: {
        channel: 'linq',
        deliverySource: {
          kind: 'linq',
          fromPhoneNumber: '+15550001111',
        },
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '00:00',
      },
      slug: 'stand-up-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Stand Up Reminder',
      updatedAt: '2026-05-03T22:17:55.000Z',
    })

    const paths = resolveAssistantStatePaths(vaultRoot)
    const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]
    if (!source) {
      throw new Error('Expected canonical source to exist.')
    }
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const baseRuntimeState = resolveCanonicalRuntimeState(source, runtimeStore)
    const runtimeState = {
      ...baseRuntimeState,
      sessionId: 'existing-thread-bound-session',
      state: {
        ...baseRuntimeState.state,
        pendingOccurrenceAt: '2026-05-04T16:00:00.000Z',
      },
    }
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [runtimeState],
      version: 1,
    })

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
    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'participant-1',
        deliveryKind: 'participant',
        deliverySource: {
          kind: 'linq',
          fromPhoneNumber: '+15550001111',
        },
        participantId: 'participant-1',
        threadId: 'thread-1',
        turnTrigger: 'automation-cron',
      }),
    )
    const notificationInput = cronMocks.sendAssistantMessageLocal.mock
      .calls[0]?.[0] as Record<string, unknown>
    expect(notificationInput).toHaveProperty('bindingDeliveryTarget', 'participant-1')
    expect(notificationInput).toHaveProperty('deliveryKind', 'participant')
  })

  it('does not snapshot explicit-target Linq cron jobs as participant materialization', () => {
    const target: AssistantCronJob['target'] = {
      alias: null,
      channel: 'linq',
      deliverySource: {
        kind: 'linq',
        fromPhoneNumber: '+15550001111',
      },
      deliveryTarget: 'explicit-thread-target',
      identityId: null,
      participantId: 'participant-1',
      sessionId: null,
      threadId: 'thread-1',
    }
    const snapshot = buildAssistantCronTargetSnapshot({
      jobId: 'automation-linq-explicit-target',
      name: 'Explicit target Linq reminder',
      target,
    })

    expect(snapshot.bindingDelivery).toBeNull()
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

function buildDeviceActivityAuthorityKey(automation: MockAutomationRecord): string {
  if (automation.schedule.kind !== 'deviceActivity') {
    throw new Error('Expected device activity automation.')
  }

  return buildAssistantDeviceActivityAuthorityKey({
    ...automation,
    schedule: {
      activityKind: automation.schedule.activityKind,
      source: automation.schedule.source,
    },
  })
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
  schedule: AssistantCronJob['schedule'] = {
    kind: 'dailyLocal',
    localTime: '09:30',
  },
): Promise<AssistantCronJob> {
  const now = '2026-04-08T08:00:00.000Z'
  const job = assistantCronJobSchema.parse({
    createdAt: now,
    enabled: true,
    jobId: `local-${name}`,
    keepAfterRun: true,
    name,
    prompt: `Check in for ${name}`,
    schedule,
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

async function claimFirstCanonicalCronJob(vaultRoot: string): Promise<{
  claimed: Awaited<ReturnType<typeof claimResolvedAssistantCronJob>>
  paths: ReturnType<typeof resolveAssistantStatePaths>
}> {
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

  return {
    claimed,
    paths,
  }
}

function addManagedResearchAutomation(input: {
  automationId?: string
  instructions?: string
  slug?: string
  tag: 'murph-managed:weekly-health-insight' | 'murph-managed:weekly-health-research-scout'
  title?: string
  vaultRoot: string
}): void {
  const slug =
    input.slug ??
    (input.tag === 'murph-managed:weekly-health-insight'
      ? 'weekly-health-insight'
      : 'weekly-health-research-scout')
  getVaultAutomationStore(input.vaultRoot).push({
    automationId: input.automationId ?? `automation-${slug}`,
    continuityPolicy: 'fresh',
    createdAt: '2026-04-08T08:00:00.000Z',
    instructions: input.instructions ?? `Run ${slug}.`,
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
      localTime: '10:00',
    },
    slug,
    status: 'active',
    summary: null,
    tags: ['assistant', 'scheduled', 'murph-managed', input.tag],
    title: input.title ?? slug,
    updatedAt: '2026-04-08T08:00:00.000Z',
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
