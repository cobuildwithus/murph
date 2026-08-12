import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { inferGatewayReplyRouteForChannel } from '@murphai/gateway-core'
import type {
  AutomationRoute,
  AutomationSchedule,
  AutomationSupportKind,
} from '@murphai/contracts'
import {
  AVAILABILITY_CONFLICT_BLOCK_END,
  AVAILABILITY_CONFLICT_BLOCK_START,
  shouldSkipAutomationOccurrenceForAvailability,
  splitAutomationAvailabilityConflictBlock,
  stripAutomationAvailabilityConflictEvidenceForProvider,
} from '@murphai/core'
import {
  assistantCronJobSchema,
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
  type AssistantCronJob,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { LinqFetch } from '@murphai/operator-config/linq-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { ScheduledLogQueryRecord } from '@murphai/query'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAssistantGroupEmailOutboxTool,
} from '../src/assistant/group-email-outbox.js'
import * as assistantDiagnostics from '../src/assistant/diagnostics.js'
import * as assistantOutboxReceiptRepair from '../src/assistant/outbox/receipt-repair.js'
import {
  onboardingFollowupPredecessorDefinitions,
} from './onboarding-followup-predecessor-fixtures.ts'

type MockAutomationRecord = {
  activeUntil?: string | null
  automationId: string
  assistantTargetOverride?: {
    model?: string | null
    modelProvider?: string | null
    reasoningEffort?: string | null
  } | null
  continuityPolicy: 'fresh' | 'preserve'
  createdAt: string
  scheduleAnchorAt?: string
  instructions: string
  route: AutomationRoute
  schedule: AutomationSchedule
  relativePath?: string
  slug?: string
  status: 'active' | 'paused' | 'archived'
  summary?: string | null
  supportKind?: AutomationSupportKind | null
  tags: string[]
  title: string
  updatedAt: string
}

const cronMocks = vi.hoisted(() => ({
  archiveAutomationIfActiveUntilElapsed: vi.fn(),
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  automationsByVault: new Map<string, MockAutomationRecord[]>(),
  buildExperimentFinalResultsSeeds: vi.fn(),
  executeScheduledLogOccurrence: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  listCanonicalScheduledLogs: vi.fn(),
  listCanonicalAutomations: vi.fn(),
  loadImporterRuntime: vi.fn(),
  loadRuntimeModule: vi.fn(),
  loadVault: vi.fn(),
  nextAutomationId: 1,
  persistDueExperimentOutcomes: vi.fn(),
  prepareExperimentLifecycleAutomations: vi.fn(),
  renderAutoLoggedFoodMealNote: vi.fn(),
  readAutomationByRelativePath: vi.fn(),
  resolveAssistantBindingDelivery: vi.fn(),
  runExperimentLifecycleDeliveryAuthorityPrecondition: vi.fn(),
  runExperimentLifecycleOutcomePrecondition: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  setScheduledLogStatus: vi.fn(),
  scheduledLogsByVault: new Map<string, ScheduledLogQueryRecord[]>(),
  showCanonicalAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
  withAssistantCronWriteLock: vi.fn(),
}))

vi.mock('@murphai/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@murphai/core')>()),
  archiveAutomationIfActiveUntilElapsed:
    cronMocks.archiveAutomationIfActiveUntilElapsed,
  executeScheduledLogOccurrence: cronMocks.executeScheduledLogOccurrence,
  isVaultError: (error: unknown) => Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('VAULT_'),
  ),
  loadVault: cronMocks.loadVault,
  setScheduledLogStatus: cronMocks.setScheduledLogStatus,
  upsertAutomation: cronMocks.upsertAutomation,
}))

vi.mock('../src/assistant/experiment-support-automations.ts', () => ({
  buildExperimentFinalResultsSeeds: cronMocks.buildExperimentFinalResultsSeeds,
  persistDueExperimentOutcomes: cronMocks.persistDueExperimentOutcomes,
  prepareExperimentLifecycleAutomations:
    cronMocks.prepareExperimentLifecycleAutomations,
  runExperimentLifecycleDeliveryAuthorityPrecondition:
    cronMocks.runExperimentLifecycleDeliveryAuthorityPrecondition,
  runExperimentLifecycleOutcomePrecondition:
    cronMocks.runExperimentLifecycleOutcomePrecondition,
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

vi.mock('../src/assistant/channel-adapters.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../src/assistant/channel-adapters.ts')
  >()),
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
  getAssistantCronAutomationTimingProjection,
  getAssistantCronStatus,
  listAssistantCronJobs,
  listAssistantCronPendingDeliveryIntentIds,
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
  resolveAssistantCronJobIndex,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import {
  appendAssistantDeviceActivityCronJobMetadata,
  buildAssistantDeviceActivityAuthorityKey,
  buildAssistantDeviceActivityDeliveryIdempotencyKey,
} from '../src/assistant/device-activity-cron-tags.ts'
import {
  completeAssistantOnboarding,
  reopenAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
} from '../src/assistant/onboarding-state.ts'
import type { AssistantExecutionContext } from '../src/assistant/execution-context.ts'
import type { AssistantChannelDependencies } from '../src/assistant/channels/types.ts'
import { sendLinqMessage } from '../src/assistant/channels/runtime.ts'
import {
  buildOnboardingGoalCheckinSeed,
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
} from '../src/assistant/onboarding-goal-checkin-automation.ts'
import {
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_PRIVATE_SUMMARY,
  MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
} from '../src/assistant/managed-automations.ts'
import type { AssistantRunEvent } from '../src/assistant/automation/shared.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById,
  markAssistantOutboxIntentSentById,
  readAssistantOutboxIntent,
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
  cronMocks.buildExperimentFinalResultsSeeds.mockReset().mockResolvedValue([])
  cronMocks.persistDueExperimentOutcomes
    .mockReset()
    .mockResolvedValue({ processedCount: 0 })
  cronMocks.prepareExperimentLifecycleAutomations
    .mockReset()
    .mockResolvedValue({ processedCount: 0, seeds: [] })
  cronMocks.runExperimentLifecycleDeliveryAuthorityPrecondition
    .mockReset()
    .mockResolvedValue({ kind: 'continue' })
  cronMocks.runExperimentLifecycleOutcomePrecondition
    .mockReset()
    .mockResolvedValue({ kind: 'continue' })

  cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockReset().mockImplementation(
    async (input: Record<string, boolean | string | null | undefined>) => ({
      channel: input.channel ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
      identityId: input.identityId ?? null,
      participantId: input.participantId ?? null,
      threadId: input.threadId ?? null,
      threadIsDirect: input.threadIsDirect ?? null,
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
  cronMocks.sendAssistantMessageLocal.mockReset().mockImplementation(
    async (input: {
      onProviderRequestStarted?: () => Promise<void> | void
    }) => {
      await input.onProviderRequestStarted?.()
      return {
        decision: {
          kind: 'send_message' as const,
          privateSummary: 'Prepared scheduled check-in.',
          text: 'Completed scheduled check-in.',
        },
        response: 'Completed scheduled check-in.',
        session: {
          sessionId: 'session-default',
        },
      }
    },
  )
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
      activeUntil?: string | null
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
      activeUntil?: string | null
      automationId?: string
      assistantTargetOverride?: MockAutomationRecord['assistantTargetOverride']
      continuityPolicy?: 'fresh' | 'preserve'
      instructions: string
      now?: Date
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
      const now = (input.now ?? new Date()).toISOString()
      const existingIndex = input.automationId
        ? records.findIndex((record) => record.automationId === input.automationId)
        : -1

      if (existingIndex >= 0) {
        const existing = records[existingIndex] as MockAutomationRecord
        const scheduleAnchorAt =
          !isDeepStrictEqual(existing.schedule, input.schedule) ||
            (existing.status !== 'active' && input.status === 'active')
            ? now
            : existing.scheduleAnchorAt ?? existing.createdAt
        const updated: MockAutomationRecord = {
          ...existing,
          activeUntil:
            input.activeUntil === undefined
              ? existing.activeUntil ?? null
              : input.activeUntil,
          assistantTargetOverride:
            input.assistantTargetOverride === undefined
              ? existing.assistantTargetOverride ?? null
              : input.assistantTargetOverride,
          continuityPolicy: input.continuityPolicy ?? existing.continuityPolicy,
          instructions: input.instructions,
          route: { ...input.route },
          schedule: input.schedule,
          scheduleAnchorAt,
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

      const automationId = `automation-${cronMocks.nextAutomationId++}`
      const created: MockAutomationRecord = {
        activeUntil: input.activeUntil ?? null,
        automationId,
        assistantTargetOverride: input.assistantTargetOverride ?? null,
        continuityPolicy: input.continuityPolicy ?? 'preserve',
        createdAt: now,
        scheduleAnchorAt: now,
        instructions: input.instructions,
        relativePath: `bank/automations/${input.slug ?? automationId}.md`,
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
      activeUntil: '2026-04-30T17:30:00.000Z',
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
      activeUntil: '2026-04-30T17:30:00.000Z',
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
    expect(cronMocks.upsertAutomation).toHaveBeenCalledTimes(3)
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
    expect(cronMocks.upsertAutomation).toHaveBeenCalledTimes(3)

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
    expect(cronMocks.upsertAutomation).toHaveBeenCalledTimes(3)
  })

  it('keeps an explicit recurring timezone instead of reinterpreting its wall clock in the vault timezone', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-explicit-automation-timezone-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const job = await upsertAssistantCronAutomation({
      activeUntil: '2026-08-16T04:59:59.000Z',
      instructions: 'Send the daily group update.',
      now: new Date('2026-08-09T23:27:19.000Z'),
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'group-room',
        identityId: null,
        participantId: null,
        threadId: 'group-room',
        threadIsDirect: false,
      },
      schedule: {
        kind: 'cron',
        expression: '0 21 * * *',
        timeZone: 'America/Chicago',
      },
      slug: 'daily-group-update',
      title: 'Daily group update',
      vault: vaultRoot,
    })
    if (!job) {
      throw new Error('Expected explicit-timezone automation to be saved.')
    }

    expect(job.schedule).toEqual({
      kind: 'cron',
      expression: '0 21 * * *',
      timeZone: 'America/Chicago',
    })
    expect(job.state.nextRunAt).toBe('2026-08-10T02:00:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'daily-group-update')?.schedule).toEqual({
      kind: 'cron',
      expression: '0 21 * * *',
      timeZone: 'America/Chicago',
    })
  })

  it('reanchors reactivated and revised recurring sources to an exact future occurrence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-revised-automation-timezone-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const created = await upsertAssistantCronAutomation({
      instructions: 'Send the daily group update.',
      now: new Date('2026-08-01T12:00:00.000Z'),
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'group-room',
        identityId: null,
        participantId: null,
        threadId: 'group-room',
        threadIsDirect: false,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '21:00',
        timeZone: 'America/Chicago',
      },
      slug: 'revised-daily-group-update',
      title: 'Revised daily group update',
      vault: vaultRoot,
    })
    if (!created) {
      throw new Error('Expected revised recurring automation to be saved.')
    }

    await setAssistantCronJobEnabled(vaultRoot, created.jobId, false)
    await updateCanonicalRuntimeState(vaultRoot, created.jobId, (record) => ({
      ...record,
      updatedAt: '2026-08-02T02:00:01.000Z',
      state: {
        ...record.state,
        activatedAt: '2026-08-01T12:00:00.000Z',
        lastRunAt: '2026-08-02T02:00:00.000Z',
        lastSucceededAt: '2026-08-02T02:00:00.000Z',
      },
    }))

    vi.setSystemTime(new Date('2026-08-10T00:27:19.000Z'))
    const reactivated = await setAssistantCronJobEnabled(
      vaultRoot,
      created.jobId,
      true,
    )
    expect(reactivated.state.nextRunAt).toBe('2026-08-10T02:00:00.000Z')

    vi.setSystemTime(new Date('2026-08-10T00:28:19.000Z'))
    const source = findCanonicalAutomation(vaultRoot, created.jobId)
    if (!source) {
      throw new Error('Expected revised recurring automation source.')
    }
    source.schedule = {
      kind: 'dailyLocal',
      localTime: '22:00',
      timeZone: 'America/Chicago',
    }
    source.scheduleAnchorAt = '2026-08-10T00:28:19.000Z'
    source.updatedAt = '2026-08-10T00:28:19.000Z'

    const revised = await getAssistantCronJob(vaultRoot, created.jobId)
    expect(revised.updatedAt).toBe('2026-08-10T00:28:19.000Z')
    expect(revised.schedule).toEqual({
      kind: 'dailyLocal',
      localTime: '22:00',
      timeZone: 'America/Chicago',
    })
    expect(revised.state.nextRunAt).toBe('2026-08-10T03:00:00.000Z')

    const { claimed } = await claimFirstCanonicalCronJob(vaultRoot)
    expect(claimed.runtimeState.state.pendingOccurrenceAt).toBe(
      '2026-08-10T03:00:00.000Z',
    )
  })

  it('preserves due work across non-timing edits and replaces it on schedule edits', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-timing-transition-pending-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: { timezone: 'America/New_York' },
    })
    const created = await upsertAssistantCronAutomation({
      instructions: 'Send the scheduled summary.',
      now: new Date('2026-08-01T12:00:00.000Z'),
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'group-room',
        identityId: null,
        participantId: null,
        threadId: 'group-room',
        threadIsDirect: false,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '21:00',
        timeZone: 'America/Chicago',
      },
      slug: 'timing-transition-pending',
      title: 'Timing transition pending',
      vault: vaultRoot,
    })
    if (!created) {
      throw new Error('Expected timing-transition automation to be saved.')
    }

    await updateCanonicalRuntimeState(vaultRoot, created.jobId, (record) => ({
      ...record,
      updatedAt: '2026-08-10T02:00:01.000Z',
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-08-10T02:00:00.000Z',
      },
    }))
    const source = findCanonicalAutomation(vaultRoot, created.jobId)
    if (!source) {
      throw new Error('Expected timing-transition automation source.')
    }

    source.instructions = 'Send the refreshed scheduled summary.'
    source.updatedAt = '2026-08-10T02:05:00.000Z'
    await expect(getAssistantCronJob(vaultRoot, created.jobId)).resolves
      .toMatchObject({
        state: { nextRunAt: '2026-08-10T02:00:00.000Z' },
      })

    source.schedule = {
      kind: 'dailyLocal',
      localTime: '22:00',
      timeZone: 'America/Chicago',
    }
    source.scheduleAnchorAt = '2026-08-10T02:06:00.000Z'
    source.updatedAt = '2026-08-10T02:06:00.000Z'
    await expect(getAssistantCronJob(vaultRoot, created.jobId)).resolves
      .toMatchObject({
        state: { nextRunAt: '2026-08-10T03:00:00.000Z' },
      })
  })

  it('separates deliverable occurrences from finite cutoffs and retry wakes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-deliverable-occurrence-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const created = await upsertAssistantCronAutomation({
      activeUntil: '2026-08-10T17:00:00.000Z',
      instructions: 'Send the finite daily update.',
      now: new Date('2026-08-09T12:00:00.000Z'),
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'finite-room',
        identityId: null,
        participantId: null,
        threadId: 'finite-room',
        threadIsDirect: false,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'America/New_York',
      },
      slug: 'finite-daily-update',
      title: 'Finite daily update',
      vault: vaultRoot,
    })
    if (!created) {
      throw new Error('Expected finite recurring automation to be saved.')
    }
    await setAssistantCronJobEnabled(vaultRoot, created.jobId, false)
    await setAssistantCronJobEnabled(vaultRoot, created.jobId, true)
    await updateCanonicalRuntimeState(vaultRoot, created.jobId, (record) => ({
      ...record,
      updatedAt: '2026-08-10T13:00:01.000Z',
      state: {
        ...record.state,
        lastRunAt: '2026-08-10T13:00:00.000Z',
        lastSucceededAt: '2026-08-10T13:00:00.000Z',
      },
    }))
    const source = findCanonicalAutomation(vaultRoot, created.jobId)
    if (!source?.relativePath) {
      throw new Error('Expected finite recurring automation source.')
    }
    source.instructions = 'Send the revised finite daily update.'
    source.updatedAt = '2026-08-10T16:00:00.000Z'

    const completed = await getAssistantCronAutomationTimingProjection(
      vaultRoot,
      source.relativePath,
      'America/New_York',
    )
    expect(completed.job.state.nextRunAt).toBe('2026-08-10T17:00:00.000Z')
    expect(completed).toMatchObject({
      nextOccurrenceAt: null,
      occurrenceVerified: true,
    })

    await updateCanonicalRuntimeState(vaultRoot, created.jobId, (record) => ({
      ...record,
      updatedAt: '2026-08-10T16:05:00.000Z',
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-08-10T13:00:00.000Z',
        retryAfterAt: '2026-08-10T16:30:00.000Z',
      },
    }))
    const retrying = await getAssistantCronAutomationTimingProjection(
      vaultRoot,
      source.relativePath,
      'America/New_York',
    )
    expect(retrying.job.state.nextRunAt).toBe('2026-08-10T16:30:00.000Z')
    expect(retrying).toMatchObject({
      nextOccurrenceAt: null,
      occurrenceVerified: false,
    })
  })

  it('projects one-shot occurrences with the same freshness boundaries as execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T06:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-one-shot-projection-freshness-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: { timezone: 'America/New_York' },
    })
    const route = {
      channel: 'linq' as const,
      deliverySource: null,
      deliveryTarget: 'projection-room',
      identityId: null,
      participantId: null,
      threadId: 'projection-room',
      threadIsDirect: false,
    }
    const saveOneShot = async (input: {
      activeUntil?: string
      at: string
      slug: string
    }) => {
      const job = await upsertAssistantCronAutomation({
        ...(input.activeUntil === undefined
          ? {}
          : { activeUntil: input.activeUntil }),
        instructions: 'Send the one-time check-in.',
        now: new Date('2026-08-10T06:00:00.000Z'),
        route,
        schedule: { at: input.at, kind: 'at' },
        slug: input.slug,
        title: 'One-time check-in',
        vault: vaultRoot,
      })
      if (!job) {
        throw new Error('Expected one-shot automation to be saved.')
      }
      const source = findCanonicalAutomation(vaultRoot, job.jobId)
      if (!source?.relativePath) {
        throw new Error('Expected one-shot automation source.')
      }
      return { job, relativePath: source.relativePath }
    }

    const future = await saveOneShot({
      at: '2026-08-10T09:30:00.000Z',
      slug: 'future-one-shot-projection',
    })
    const boundary = await saveOneShot({
      at: '2026-08-10T08:00:00.000Z',
      slug: 'boundary-one-shot-projection',
    })
    const stale = await saveOneShot({
      at: '2026-08-10T07:59:59.999Z',
      slug: 'stale-one-shot-projection',
    })
    const finite = await saveOneShot({
      activeUntil: '2026-08-10T11:00:00.000Z',
      at: '2026-08-10T07:00:00.000Z',
      slug: 'finite-one-shot-projection',
    })
    const elapsedFinite = await saveOneShot({
      activeUntil: '2026-08-10T08:45:00.000Z',
      at: '2026-08-10T08:30:00.000Z',
      slug: 'elapsed-finite-one-shot-projection',
    })
    vi.setSystemTime(new Date('2026-08-10T09:00:00.000Z'))

    await expect(getAssistantCronAutomationTimingProjection(
      vaultRoot,
      future.relativePath,
      'America/New_York',
    )).resolves.toMatchObject({
      nextOccurrenceAt: '2026-08-10T09:30:00.000Z',
      occurrenceVerified: true,
    })
    await expect(getAssistantCronAutomationTimingProjection(
      vaultRoot,
      boundary.relativePath,
      'America/New_York',
    )).resolves.toMatchObject({
      nextOccurrenceAt: '2026-08-10T08:00:00.000Z',
      occurrenceVerified: true,
    })
    await expect(getAssistantCronAutomationTimingProjection(
      vaultRoot,
      stale.relativePath,
      'America/New_York',
    )).resolves.toMatchObject({
      nextOccurrenceAt: null,
      occurrenceVerified: true,
    })
    await expect(getAssistantCronAutomationTimingProjection(
      vaultRoot,
      finite.relativePath,
      'America/New_York',
    )).resolves.toMatchObject({
      nextOccurrenceAt: '2026-08-10T07:00:00.000Z',
      occurrenceVerified: true,
    })
    await expect(getAssistantCronAutomationTimingProjection(
      vaultRoot,
      elapsedFinite.relativePath,
      'America/New_York',
    )).resolves.toMatchObject({
      nextOccurrenceAt: null,
      occurrenceVerified: true,
    })
  })

  it('does not certify a stale recurring occurrence that execution will consume', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-recurring-projection-freshness-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: { timezone: 'America/New_York' },
    })
    const job = await upsertAssistantCronAutomation({
      instructions: 'Send the daily check-in.',
      now: new Date('2026-08-01T09:00:00.000Z'),
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'recurring-projection-room',
        identityId: null,
        participantId: null,
        threadId: 'recurring-projection-room',
        threadIsDirect: false,
      },
      schedule: { everyMs: 86_400_000, kind: 'every' },
      slug: 'stale-recurring-projection',
      title: 'Daily check-in',
      vault: vaultRoot,
    })
    if (!job) {
      throw new Error('Expected recurring automation to be saved.')
    }
    const source = findCanonicalAutomation(vaultRoot, job.jobId)
    if (!source?.relativePath) {
      throw new Error('Expected recurring automation source.')
    }

    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    await expect(getAssistantCronAutomationTimingProjection(
      vaultRoot,
      source.relativePath,
      'America/New_York',
    )).resolves.toMatchObject({
      nextOccurrenceAt: null,
      occurrenceVerified: false,
    })
  })

  it('materializes a finite latest-slot occurrence with execution budget and preserves it on reseed', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-one-shot-automation-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const route = {
      channel: 'telegram' as const,
      deliverySource: null,
      deliveryTarget: 'room-1',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    const created = await upsertAssistantCronAutomation({
      firstOccurrenceActiveUntilLocalTime: '15:00',
      firstOccurrencePolicy: 'once-after-current-local-day',
      instructions: 'Make one final setup invitation.',
      now: new Date('2026-04-08T15:00:00.000Z'),
      route,
      schedule: {
        kind: 'dailyLocal',
        localTime: '14:29',
      },
      slug: 'finish-onboarding-followup',
      summary: 'One final setup invitation.',
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: 'Final Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!created) {
      throw new Error('Expected one-shot onboarding follow-up to be seeded.')
    }

    expect(created.keepAfterRun).toBe(false)
    expect(created.schedule).toEqual({
      at: '2026-04-09T18:29:00.000Z',
      kind: 'at',
    })
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup'))
      .toMatchObject({
        activeUntil: '2026-04-09T19:00:00.000Z',
      })
    expect(created.state.nextRunAt).toBe('2026-04-09T18:29:00.000Z')

    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'Asia/Tokyo',
      },
    })
    const reseeded = await upsertAssistantCronAutomation({
      firstOccurrenceActiveUntilLocalTime: '15:00',
      firstOccurrencePolicy: 'once-after-current-local-day',
      instructions: 'Use the latest final invitation wording.',
      now: new Date('2026-04-09T12:00:00.000Z'),
      route,
      schedule: {
        kind: 'dailyLocal',
        localTime: '14:12',
      },
      slug: 'finish-onboarding-followup',
      summary: 'One final setup invitation.',
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: 'Final Murph onboarding follow-up',
      vault: vaultRoot,
    })
    if (!reseeded) {
      throw new Error('Expected one-shot onboarding follow-up to be reseeded.')
    }

    expect(reseeded.jobId).toBe(created.jobId)
    expect(reseeded.schedule).toEqual(created.schedule)
    expect(reseeded.state.nextRunAt).toBe('2026-04-09T18:29:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup'))
      .toMatchObject({
        activeUntil: '2026-04-09T19:00:00.000Z',
        instructions: 'Use the latest final invitation wording.',
        schedule: created.schedule,
      })

    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeCommit?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        beforeProviderAcceptedInputs?: () => Promise<void>
        beforeToolExecution?: () => Promise<void>
      }) => {
        const context = {
          decision: {
            kind: 'send_message' as const,
            privateSummary: 'Prepared the final onboarding continuation.',
            text: 'Want to pick this back up?',
          },
          deliveryOutcome: null,
          response: 'Want to pick this back up?',
        }
        vi.setSystemTime(new Date('2026-04-09T18:30:05.000Z'))
        await notificationInput.beforeProviderAcceptedInputs?.()
        vi.setSystemTime(new Date('2026-04-09T18:32:05.000Z'))
        await notificationInput.beforeToolExecution?.()
        vi.setSystemTime(new Date('2026-04-09T18:33:35.000Z'))
        await notificationInput.beforeDelivery?.(context)
        vi.setSystemTime(new Date('2026-04-09T18:34:05.000Z'))
        await notificationInput.beforeCommit?.(context)
        return {
          deliveryOutcome: {
            delivery: {
              channel: 'telegram',
              sentAt: '2026-04-09T18:34:00.000Z',
              target: 'room-1',
              targetKind: 'thread',
            },
            intentId: 'outbox_onboarding_final_followup',
            kind: 'sent' as const,
            media: [],
            session: {
              sessionId: 'session_onboarding_final_followup',
            },
          },
          response: 'Want to pick this back up?',
          session: {
            sessionId: 'session_onboarding_final_followup',
          },
        }
      },
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T18:29:05.000Z'))
    const completed = await runAssistantCronJobNow({
      job: created.jobId,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        turnPolicy: null,
      }),
    )
    expect(completed.run.outcome).toBe('delivered')
    expect(completed.removedAfterRun).toBe(true)
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')?.status)
      .toBe('archived')
  })

  it('defers a recurring follow-up until tomorrow and caps it after three local days', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-upsert-three-day-automation-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })

    const created = await upsertAssistantCronAutomation({
      firstOccurrenceActiveDayCount: 3,
      firstOccurrenceActiveUntilLocalTime: '15:00',
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: 'Offer one useful setup continuation each day.',
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
        localTime: '14:29',
      },
      slug: 'finite-three-day-followup',
      summary: 'Three finite daily opportunities.',
      title: 'Finite three-day follow-up',
      vault: vaultRoot,
    })
    if (!created) {
      throw new Error('Expected three-day follow-up to be seeded.')
    }

    expect(created.keepAfterRun).toBe(true)
    expect(created.schedule).toEqual({
      kind: 'dailyLocal',
      localTime: '14:29',
    })
    expect(created.state.nextRunAt).toBe('2026-04-09T18:29:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, 'finite-three-day-followup'))
      .toMatchObject({
        activeUntil: '2026-04-11T19:00:00.000Z',
        schedule: {
          kind: 'dailyLocal',
          localTime: '14:29',
        },
      })
  })

  it.each([
    {
      onboardingStatus: 'completed',
      expectedOutcome: 'delivered',
      result: {
        decision: {
          kind: 'send_message',
          privateSummary: 'Delivered the user-owned reminder.',
          text: 'Your own scheduled reminder.',
        },
        deliveryOutcome: {
          delivery: null,
          intentId: 'outbox_user_owned_same_slug',
          kind: 'sent',
          media: [],
          session: {
            sessionId: 'session_user_owned_same_slug',
          },
        },
        response: 'Your own scheduled reminder.',
        session: {
          sessionId: 'session_user_owned_same_slug',
        },
      },
    },
    {
      onboardingStatus: 'open',
      expectedOutcome: 'no_op',
      result: {
        decision: {
          kind: 'skip',
          privateSummary: 'The user-owned reminder had nothing to send.',
        },
        response: null,
        session: {
          sessionId: 'session_user_owned_same_slug',
        },
      },
    },
  ] as const)(
    'keeps a user-owned same-slug automation on the generic $onboardingStatus-onboarding path',
    async ({ expectedOutcome, onboardingStatus, result }) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-09T13:30:05.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-user-owned-onboarding-slug-${onboardingStatus}-`,
      )
      if (onboardingStatus === 'completed') {
        await completeAssistantOnboarding({
          completedAt: '2026-04-08T18:00:00.000Z',
          reason: 'user_answered',
          vault: vaultRoot,
        })
      }
      getVaultAutomationStore(vaultRoot).push({
        activeUntil: '2026-04-09T19:00:00.000Z',
        automationId: `automation_user_owned_onboarding_slug_${onboardingStatus}`,
        continuityPolicy: 'preserve',
        createdAt: '2026-04-08T18:00:00.000Z',
        instructions: 'Run the member-authored reminder.',
        route: {
          channel: 'telegram',
          deliverySource: null,
          deliveryTarget: 'room-1',
          identityId: null,
          participantId: null,
          threadId: null,
          threadIsDirect: true,
        },
        schedule: {
          at: '2026-04-09T18:29:00.000Z',
          kind: 'at',
        },
        slug: 'finish-onboarding-followup',
        status: 'active',
        summary: 'A member-authored reminder.',
        tags: ['assistant', 'scheduled'],
        title: 'Member-authored reminder',
        updatedAt: '2026-04-08T18:00:00.000Z',
      })
      cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce(result)

      const completed = await runAssistantCronJobNow({
        job: `automation_user_owned_onboarding_slug_${onboardingStatus}`,
        vault: vaultRoot,
      })

      expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          turnPolicy: null,
        }),
      )
      expect(completed.run.outcome).toBe(expectedOutcome)
    },
  )

  it('runs at most once on each of three local days and records default-open admission', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T15:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-onboarding-three-day-window-',
    )
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const job = await upsertAssistantCronAutomation({
      firstOccurrenceActiveDayCount:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.opportunityDays,
      firstOccurrenceActiveUntilLocalTime:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.activeUntilLocalTime,
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
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
        localTime: '14:29',
      },
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vault: vaultRoot,
    })
    if (!job) {
      throw new Error('Expected onboarding follow-up to be seeded.')
    }
    cronMocks.sendAssistantMessageLocal.mockResolvedValue({
      decision: {
        kind: 'skip',
        privateSummary: 'No useful continuation today.',
      },
      response: null,
      session: {
        sessionId: 'session_onboarding_three_day_window',
      },
    })
    const events: AssistantRunEvent[] = []

    for (const now of [
      '2026-04-09T18:29:05.000Z',
      '2026-04-10T18:29:05.000Z',
      '2026-04-11T18:29:05.000Z',
    ]) {
      vi.setSystemTime(new Date(now))
      await expect(processDueAssistantCronJobsLocal({
        limit: 1,
        onEvent: (event) => events.push(event),
        vault: vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        processed: 1,
        succeeded: 1,
      })
    }

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(3)
    expect(events.filter((event) =>
      event.type === 'onboarding.followup.completed'
    )).toHaveLength(3)
    expect(events).toContainEqual(expect.objectContaining({
      failureContext: expect.objectContaining({
        activeUntil: '2026-04-11T19:00:00.000Z',
        notificationDecisionKind: 'skip',
        notificationDeliveryOutcomeKind: 'none',
        onboardingStateCreatedAt: null,
        onboardingStateSource: 'default_missing',
        onboardingStateStatus: 'open',
        occurrenceAt: expect.stringMatching(/^2026-04-(?:09|10|11)T/u),
        runOutcome: 'no_op',
        scheduleKind: 'dailyLocal',
      }),
      type: 'onboarding.followup.completed',
    }))

    vi.setSystemTime(new Date('2026-04-11T19:00:00.000Z'))
    await processDueAssistantCronJobsLocal({
      limit: 1,
      onEvent: (event) => events.push(event),
      vault: vaultRoot,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(3)
    expect(findCanonicalAutomation(
      vaultRoot,
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    )?.status).toBe('archived')
  })

  it('blocks a completed onboarding follow-up before provider admission and logs the persisted state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T18:29:05.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-onboarding-completed-gate-',
    )
    await completeAssistantOnboarding({
      completedAt: '2026-04-09T17:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: '2026-04-11T19:00:00.000Z',
      automationId: 'automation_onboarding_completed_gate',
      continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
      createdAt: '2026-04-08T15:00:00.000Z',
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'room-1',
        identityId: null,
        participantId: null,
        threadId: null,
        threadIsDirect: true,
      },
      schedule: {
        at: '2026-04-09T18:29:00.000Z',
        kind: 'at',
      },
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: 'active',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      updatedAt: '2026-04-08T15:00:00.000Z',
    })
    const events: AssistantRunEvent[] = []

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      onEvent: (event) => events.push(event),
      vault: vaultRoot,
    })).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })

    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(events).toContainEqual(expect.objectContaining({
      failureContext: expect.objectContaining({
        notificationDecisionKind: null,
        onboardingStateCreatedAt: '2026-04-09T17:00:00.000Z',
        onboardingStateSource: 'persisted',
        onboardingStateStatus: 'completed',
        onboardingStateUpdatedAt: '2026-04-09T17:00:00.000Z',
        runOutcome: 'skipped_gate',
      }),
      type: 'onboarding.followup.completed',
    }))
  })

  it.each(onboardingFollowupPredecessorDefinitions)(
    'keeps the $label predecessor effect-ineligible when reconciliation has not completed',
    async ({ definition, label, schedule }) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-09T18:29:05.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-onboarding-predecessor-${label.replaceAll(' ', '-')}-`,
      )
      const onboardingStatePath = resolveAssistantOnboardingStatePath(vaultRoot)
      await mkdir(path.dirname(onboardingStatePath), { recursive: true })
      await writeFile(onboardingStatePath, '{ invalid onboarding json', 'utf8')
      addRecognizedOnboardingFollowupPredecessorAutomation({
        automationId: `automation_onboarding_predecessor_${label.replaceAll(' ', '_')}`,
        definition,
        schedule,
        vaultRoot,
      })
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
      const occurrenceAt = claimed.runtimeState.state.pendingOccurrenceAt ??
        claimed.job.state.nextRunAt
      if (!occurrenceAt) {
        throw new Error('Expected predecessor occurrence time.')
      }
      vi.setSystemTime(new Date(Date.parse(occurrenceAt) + 5_000))
      const events: AssistantRunEvent[] = []

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        onEvent: (event) => events.push(event),
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.run).toMatchObject({
        outcome: 'failed',
        reason: 'ASSISTANT_CRON_ONBOARDING_FOLLOWUP_RECONCILIATION_REQUIRED',
        status: 'failed',
      })
      expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
      await expect(readFile(onboardingStatePath, 'utf8')).resolves.toBe(
        '{ invalid onboarding json',
      )
      expect(getVaultAutomationStore(vaultRoot)).toContainEqual(
        expect.objectContaining({
          instructions: definition.instructions,
          schedule,
          status: 'active',
        }),
      )
      const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
      expect(runtimeStore.jobs).toContainEqual(expect.objectContaining({
        jobId: claimed.job.jobId,
        state: expect.objectContaining({
          consecutiveFailures: 1,
          lastError:
            'Assistant onboarding follow-up predecessor is waiting for managed reconciliation.',
          pendingOccurrenceAt: occurrenceAt,
          retryAfterAt: expect.any(String),
        }),
      }))
      expect(events).toContainEqual(expect.objectContaining({
        failureContext: expect.objectContaining({
          notificationDecisionKind: null,
          onboardingStateReadError: 'invalid-json',
          onboardingStateSource: 'read_error',
          onboardingStateStatus: 'unreadable',
          runOutcome: 'failed',
        }),
        type: 'onboarding.followup.completed',
      }))
    },
  )

  it.each([
    'pre-provider',
    'pre-tool',
    'pre-delivery',
    'pre-commit',
  ] as const)(
    'invalidates an exact onboarding follow-up when onboarding completes at the %s gate',
    async (completionGate) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-09T18:29:05.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-onboarding-followup-completed-${completionGate}-`,
      )
      addCurrentOnboardingFollowupAutomation({
        automationId: `automation_onboarding_completed_${completionGate}`,
        vaultRoot,
      })
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
      const events: AssistantRunEvent[] = []
      const completeAtGate = async (gate: typeof completionGate) => {
        if (completionGate !== gate) {
          return
        }
        await completeAssistantOnboarding({
          completedAt: '2026-04-09T18:29:06.000Z',
          reason: 'user_answered',
          vault: vaultRoot,
        })
      }
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
        async (notificationInput: {
          beforeCommit?: (context: {
            decision: {
              kind: 'send_message'
              privateSummary: string
              text: string
            }
            deliveryOutcome: null
            response: string
          }) => Promise<void>
          beforeDelivery?: (context: {
            decision: {
              kind: 'send_message'
              privateSummary: string
              text: string
            }
            deliveryOutcome: null
            response: string
          }) => Promise<void>
          beforeProviderAcceptedInputs?: () => Promise<void>
          beforeToolExecution?: () => Promise<void>
        }) => {
          const context = {
            decision: {
              kind: 'send_message' as const,
              privateSummary: 'Prepared a setup continuation.',
              text: 'Would you like to keep going?',
            },
            deliveryOutcome: null,
            response: 'Would you like to keep going?',
          }
          await completeAtGate('pre-provider')
          await notificationInput.beforeProviderAcceptedInputs?.()
          await completeAtGate('pre-tool')
          await notificationInput.beforeToolExecution?.()
          await completeAtGate('pre-delivery')
          await notificationInput.beforeDelivery?.(context)
          await completeAtGate('pre-commit')
          await notificationInput.beforeCommit?.(context)
          return {
            ...context,
            session: { sessionId: 'session_onboarding_completed_gate' },
          }
        },
      )

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        onEvent: (event) => events.push(event),
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.run).toMatchObject({
        outcome: 'skipped_gate',
        reason: 'lifecycle_precondition',
        status: 'skipped',
      })
      expect(events).toContainEqual(expect.objectContaining({
        failureContext: expect.objectContaining({
          authorityGate: completionGate.replace('-', '_'),
          onboardingStateSource: 'persisted',
          onboardingStateStatus: 'completed',
          runOutcome: 'skipped_gate',
        }),
        type: 'onboarding.followup.completed',
      }))
    },
  )

  it.each([
    'pre-provider',
    'pre-tool',
    'pre-delivery',
    'pre-commit',
  ] as const)(
    'keeps an exact onboarding follow-up retryable when state becomes unreadable at the %s gate',
    async (failureGate) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-09T18:29:05.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-onboarding-followup-unreadable-${failureGate}-`,
      )
      addCurrentOnboardingFollowupAutomation({
        automationId: `automation_onboarding_unreadable_${failureGate}`,
        vaultRoot,
      })
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
      const events: AssistantRunEvent[] = []
      const failAtGate = async (gate: typeof failureGate) => {
        if (failureGate !== gate) {
          return
        }
        await mkdir(
          path.dirname(resolveAssistantOnboardingStatePath(vaultRoot)),
          { recursive: true },
        )
        await writeFile(
          resolveAssistantOnboardingStatePath(vaultRoot),
          '{ invalid onboarding json',
          'utf8',
        )
      }
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
        async (notificationInput: {
          beforeCommit?: (context: {
            decision: {
              kind: 'send_message'
              privateSummary: string
              text: string
            }
            deliveryOutcome: null
            response: string
          }) => Promise<void>
          beforeDelivery?: (context: {
            decision: {
              kind: 'send_message'
              privateSummary: string
              text: string
            }
            deliveryOutcome: null
            response: string
          }) => Promise<void>
          beforeProviderAcceptedInputs?: () => Promise<void>
          beforeToolExecution?: () => Promise<void>
        }) => {
          const context = {
            decision: {
              kind: 'send_message' as const,
              privateSummary: 'Prepared a setup continuation.',
              text: 'Would you like to keep going?',
            },
            deliveryOutcome: null,
            response: 'Would you like to keep going?',
          }
          await failAtGate('pre-provider')
          await notificationInput.beforeProviderAcceptedInputs?.()
          await failAtGate('pre-tool')
          await notificationInput.beforeToolExecution?.()
          await failAtGate('pre-delivery')
          await notificationInput.beforeDelivery?.(context)
          await failAtGate('pre-commit')
          await notificationInput.beforeCommit?.(context)
          return {
            ...context,
            session: { sessionId: 'session_onboarding_unreadable_gate' },
          }
        },
      )

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        onEvent: (event) => events.push(event),
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.removedAfterRun).toBe(false)
      expect(result.run).toMatchObject({
        outcome: 'failed',
        reason: 'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
        status: 'failed',
      })
      expect(result.runErrorCode).toBe(
        'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
      )
      expect(events).toContainEqual(expect.objectContaining({
        failureContext: expect.objectContaining({
          authorityGate: failureGate.replace('-', '_'),
          onboardingStateReadError: 'invalid-json',
          onboardingStateSource: 'read_error',
          onboardingStateStatus: 'unreadable',
          runOutcome: 'failed',
        }),
        type: 'onboarding.followup.completed',
      }))
    },
  )

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

    // The automation outlives the runtime-state write failure, but remains a
    // finite next-day source until the recurring cursor is durable.
    expect(findCanonicalAutomation(vaultRoot, 'finish-onboarding-followup')).toMatchObject({
      schedule: {
        at: '2026-04-09T17:30:00.000Z',
        kind: 'at',
      },
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
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
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
        executionContext: {
          hosted: {
            memberId: 'member-stale-device-activity',
            userEnvKeys: [],
          },
        },
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

  it('uses automation id fallback when device activity parent listener path changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-activity-parent-renamed-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const parentAutomationId = 'automation-device-activity-renamed-listener'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      assistantTargetOverride: {
        reasoningEffort: 'high',
      },
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about imported runs.',
      relativePath: 'bank/automations/renamed-device-activity-listener.md',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'linq_chat_device_activity',
        identityId: null,
        participantId: null,
        threadId: null,
        threadIsDirect: false,
      },
      schedule: {
        kind: 'deviceActivity',
        after: '2026-04-08T08:00:00.000Z',
        activityKind: 'run',
        source: 'whoop',
      },
      slug: 'renamed-device-activity-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Renamed device activity listener',
      updatedAt: '2026-04-08T08:30:00.000Z',
    }
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const localJob = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:59:00.000Z',
      enabled: true,
      jobId: 'cron_device_activity_listener_renamed',
      keepAfterRun: false,
      name: appendAssistantDeviceActivityCronJobMetadata(
        'Device activity listener',
        {
          authorityKey: buildDeviceActivityAuthorityKey(parentAutomation),
          occurrenceKey: '1234567890abcdef1234567890abcdef12345679',
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
    const resolveScheduledLinqRoute = vi.fn().mockResolvedValue({
      deliveryPosture: 'recover',
      target: 'linq_chat_device_activity',
      threadIsDirect: false,
    })
    await expect(
      processDueAssistantCronJobsLocal({
        executionContext: {
          hosted: {
            memberId: 'member-device-activity-group',
            resolveScheduledLinqRoute,
            userEnvKeys: [],
          },
        },
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })

    expect(cronMocks.readAutomationByRelativePath).toHaveBeenCalledWith(
      vaultRoot,
      'bank/automations/device-activity-listener.md',
    )
    expect(cronMocks.listCanonicalAutomations).toHaveBeenCalledWith(vaultRoot, {
      status: ['active', 'paused', 'archived'],
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
        executionContext: {
          hosted: expect.objectContaining({
            dynamicContextPrompts: [expect.stringContaining(
              'weak recent engagement signals',
            )],
          }),
        },
        threadIsDirect: false,
        instructions: 'Ask about the imported run.',
      }),
    )
    expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: false,
        target: 'linq_chat_device_activity',
        targetKind: 'explicit',
      }),
    )
  })

  it('consumes generated device activity jobs when a skip overlaps foreground preemption', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-activity-skip-no-retry-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const parentAutomationId = 'automation-device-activity-skip-listener'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Only send when imported sleep data clearly needs a note.',
      relativePath: 'bank/automations/device-activity-skip-listener.md',
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
        activityKind: 'sleep',
        source: 'whoop',
      },
      slug: 'device-activity-skip-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Device activity skip listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const localJob = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:59:00.000Z',
      enabled: true,
      jobId: 'cron_device_activity_sleep_skip',
      keepAfterRun: false,
      name: appendAssistantDeviceActivityCronJobMetadata(
        'Device activity skip listener',
        {
          authorityKey: buildDeviceActivityAuthorityKey(parentAutomation),
          occurrenceKey: 'abcdef1234567890abcdef1234567890abcdef12',
          parentAutomationId,
          parentAutomationRelativePath: 'bank/automations/device-activity-skip-listener.md',
        },
      ),
      prompt: 'Review the sleep import and skip noisy or duplicate records.',
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
    let shouldYield = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
      beforeCommit?: ((context: {
        decision: {
          kind: 'skip'
          privateSummary: string
        }
        deliveryOutcome: null
        response: null
      }) => Promise<void> | void) | null
      onProviderRequestStarted?: () => Promise<void> | void
    }) => {
      const decision = {
        kind: 'skip',
        privateSummary: 'No user-facing notification needed.',
      } as const
      await input.onProviderRequestStarted?.()
      shouldYield = true
      await input.beforeCommit?.({
        decision,
        deliveryOutcome: null,
        response: null,
      })
      return {
        decision,
        response: null,
        session: {
          sessionId: 'session-device-activity-skip',
        },
      }
    })

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      shouldYield: () => shouldYield,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Review the sleep import and skip noisy or duplicate records.',
        responsePolicy: null,
      }),
    )
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
    await expect(
      listAssistantCronRuns({
        job: localJob.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: localJob.jobId,
      runs: [
        expect.objectContaining({
          error: null,
          notificationDecision: {
            kind: 'skip',
            reasonCode: 'provider_skip',
          },
          outcome: 'no_op',
          reason: 'no_delivery',
          scheduledOccurrenceAt: '2026-04-08T08:59:30.000Z',
          status: 'succeeded',
        }),
      ],
    })
  })

  it('runs queued device activity jobs with legacy no-override authority keys', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-activity-legacy-authority-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const parentAutomationId = 'automation-device-activity-legacy-listener'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about imported runs.',
      relativePath: 'bank/automations/device-activity-legacy-listener.md',
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
      slug: 'device-activity-legacy-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Device activity legacy listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const localJob = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:59:00.000Z',
      enabled: true,
      jobId: 'cron_device_activity_listener_legacy',
      keepAfterRun: false,
      name: appendAssistantDeviceActivityCronJobMetadata(
        'Device activity legacy listener',
        {
          authorityKey: buildLegacyDeviceActivityAuthorityKey(parentAutomation),
          occurrenceKey: '1234567890abcdef1234567890abcdef12345671',
          parentAutomationId,
          parentAutomationRelativePath: 'bank/automations/device-activity-legacy-listener.md',
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

    await expect(
      processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Ask about the imported run.',
      }),
    )
  })

  it('runs queued device activity jobs with the current target override after target-only edits', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-activity-parent-target-stale-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const parentAutomationId = 'automation-device-activity-target-listener'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      assistantTargetOverride: {
        reasoningEffort: 'low',
      },
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about imported runs.',
      relativePath: 'bank/automations/device-activity-target-listener.md',
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
      slug: 'device-activity-target-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Device activity target listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    const originalAuthorityKey = buildDeviceActivityAuthorityKey(parentAutomation)
    parentAutomation.assistantTargetOverride = {
      reasoningEffort: 'high',
    }
    parentAutomation.updatedAt = '2026-04-08T08:30:00.000Z'
    getVaultAutomationStore(vaultRoot).push(parentAutomation)

    const localJob = assistantCronJobSchema.parse({
      createdAt: '2026-04-08T08:59:00.000Z',
      enabled: true,
      jobId: 'cron_device_activity_listener_target_stale',
      keepAfterRun: false,
      name: appendAssistantDeviceActivityCronJobMetadata(
        'Device activity target listener',
        {
          authorityKey: originalAuthorityKey,
          occurrenceKey: '1234567890abcdef1234567890abcdef12345670',
          parentAutomationId,
          parentAutomationRelativePath: 'bank/automations/device-activity-target-listener.md',
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

    cronMocks.readAutomationByRelativePath.mockClear()
    await expect(
      processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
        instructions: 'Ask about the imported run.',
      }),
    )
    expect(cronMocks.readAutomationByRelativePath).toHaveBeenCalledWith(
      vaultRoot,
      'bank/automations/device-activity-target-listener.md',
    )
    const runs = await listAssistantCronRuns({
      job: localJob.jobId,
      vault: vaultRoot,
    })
    expect(runs.runs).toEqual([
      expect.objectContaining({
        error: null,
        status: 'succeeded',
      }),
    ])
  })

  it('accepts queued device activity outbox intents with legacy no-override authority keys', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-outbox-legacy-',
    )
    const parentAutomationId = 'auto_device_activity_outbox_legacy'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about the imported run.',
      relativePath: 'bank/automations/device-activity-outbox-legacy-listener.md',
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
      slug: 'device-activity-outbox-legacy-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Device activity outbox legacy listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const metadata = {
      authorityKey: buildLegacyDeviceActivityAuthorityKey(parentAutomation),
      occurrenceKey: 'abcdef1234567890abcdef1234567890abcdef13',
      parentAutomationId,
      parentAutomationRelativePath: 'bank/automations/device-activity-outbox-legacy-listener.md',
    }
    const intent = buildTestLinqOutboxIntent({
      createdAt: '2026-04-08T08:01:00.000Z',
      intentId: 'outbox_device_activity_legacy',
      message: 'How did that run feel?',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...intent,
      deliveryIdempotencyKey: buildAssistantDeviceActivityDeliveryIdempotencyKey({
        discriminator: {
          jobId: 'cron_device_activity_listener_legacy',
          target: intent.targetFingerprint,
        },
        metadata,
      }),
      nextAttemptAt: '2026-04-08T08:02:00.000Z',
    })

    const prepareDispatchIntent = vi.fn(async () => undefined)
    const dispatched = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        prepareDispatchIntent,
      },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-04-08T08:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(prepareDispatchIntent).toHaveBeenCalledTimes(1)
    expect(prepareDispatchIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          deliveryIdempotencyKey: expect.stringContaining(
            metadata.authorityKey,
          ),
        }),
      }),
    )
    expect(dispatched.deliveryError).not.toEqual(
      expect.objectContaining({
        code: 'ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE',
      }),
    )
  })

  it('accepts queued device activity outbox intents after target-only edits', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-device-outbox-target-edit-',
    )
    const parentAutomationId = 'auto_device_activity_outbox_target_edit'
    const parentAutomation: MockAutomationRecord = {
      automationId: parentAutomationId,
      assistantTargetOverride: {
        reasoningEffort: 'low',
      },
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Ask about the imported run.',
      relativePath: 'bank/automations/device-activity-outbox-target-edit-listener.md',
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
      slug: 'device-activity-outbox-target-edit-listener',
      status: 'active',
      summary: null,
      tags: ['device'],
      title: 'Device activity outbox target edit listener',
      updatedAt: '2026-04-08T08:00:00.000Z',
    }
    const metadata = {
      authorityKey: buildDeviceActivityAuthorityKey(parentAutomation),
      occurrenceKey: 'abcdef1234567890abcdef1234567890abcdef14',
      parentAutomationId,
      parentAutomationRelativePath:
        'bank/automations/device-activity-outbox-target-edit-listener.md',
    }
    parentAutomation.assistantTargetOverride = {
      reasoningEffort: 'high',
    }
    parentAutomation.updatedAt = '2026-04-08T08:01:30.000Z'
    getVaultAutomationStore(vaultRoot).push(parentAutomation)
    const intent = buildTestLinqOutboxIntent({
      createdAt: '2026-04-08T08:01:00.000Z',
      intentId: 'outbox_device_activity_target_edit',
      message: 'How did that run feel?',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...intent,
      deliveryIdempotencyKey: buildAssistantDeviceActivityDeliveryIdempotencyKey({
        discriminator: {
          jobId: 'cron_device_activity_listener_target_edit',
          target: intent.targetFingerprint,
        },
        metadata,
      }),
      nextAttemptAt: '2026-04-08T08:02:00.000Z',
    })

    const prepareDispatchIntent = vi.fn(async () => undefined)
    const dispatched = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        prepareDispatchIntent,
      },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-04-08T08:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(prepareDispatchIntent).toHaveBeenCalledTimes(1)
    expect(dispatched.deliveryError).not.toEqual(
      expect.objectContaining({
        code: 'ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE',
      }),
    )
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

  it('runs a paused canonical job manually without reactivating or rescheduling it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-paused-canonical-manual-run-',
    )
    const canonicalJob = await createCanonicalJob(vaultRoot, 'paused manual check-in')
    await setAssistantCronJobEnabled(vaultRoot, canonicalJob.jobId, false)
    const pausedUpdatedAt = findCanonicalAutomation(
      vaultRoot,
      canonicalJob.jobId,
    )?.updatedAt
    cronMocks.upsertAutomation.mockClear()
    const context = {
      decision: {
        kind: 'send_message' as const,
        privateSummary: 'Prepared the explicitly requested manual check-in.',
        text: 'Here is your manual check-in.',
      },
      deliveryOutcome: {
        delivery: {
          channel: 'telegram' as const,
          sentAt: '2026-04-08T08:00:00.000Z',
          target: 'room-1',
          targetKind: 'thread' as const,
        },
        intentId: 'outbox_paused_manual_check_in',
        kind: 'sent' as const,
        media: [],
        session: { sessionId: 'session-paused-manual-check-in' },
      },
      response: 'Here is your manual check-in.',
    }
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
      beforeCommit?: (value: typeof context) => Promise<void>
      beforeDelivery?: (value: typeof context) => Promise<void>
    }) => {
      await input.beforeDelivery?.(context)
      await input.beforeCommit?.(context)
      return {
        ...context,
        session: { sessionId: 'session-paused-manual-check-in' },
      }
    })

    const result = await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'delivered',
      reason: 'sent',
      status: 'succeeded',
    })
    expect(result.removedAfterRun).toBe(false)
    expect(result.job.enabled).toBe(false)
    expect(result.job.state.nextRunAt).toBeNull()
    expect(result.job.state.lastSucceededAt).toBe('2026-04-08T08:00:00.000Z')
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)).toMatchObject({
      status: 'paused',
      updatedAt: pausedUpdatedAt,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxAutomationAuthority: null,
      }),
    )
    expect(cronMocks.upsertAutomation).not.toHaveBeenCalled()
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
      deliveryOutcome: {
        delivery: {
          channel: 'telegram',
          sentAt: '2026-04-08T12:00:05.000Z',
          target: 'room-1',
          targetKind: 'thread',
        },
        intentId: 'outbox_run_now',
        kind: 'sent',
        media: [],
        session: {
          sessionId: 'session-run-now',
        },
      },
      response: 'Done.',
      session: {
        sessionId: 'session-run-now',
      },
    })

    const result = await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(result.run.outcome).toBe('delivered')
    expect(result.run.reason).toBe('sent')
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

    const result = await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDedupeToken: null,
        instructions: expect.stringContaining('Check in for raw-prompt-shape'),
        responsePolicy: { kind: 'require_send' },
        turnTrigger: 'automation-cron',
      }),
    )
    const providerInput = cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0] as
      | { instructions?: string }
      | undefined
    expect(providerInput?.instructions).toContain(
      'Independent automation authority (engine-supplied):',
    )
    expect(providerInput?.instructions).toContain(
      "Do not treat a related plan or experiment's completion as cancellation",
    )
    expect(providerInput?.instructions).toContain(
      'You may still skip when the saved instructions authorize that outcome or current evidence proves the requested action already happened.',
    )
    expect(result.run).toMatchObject({
      notificationDecision: {
        kind: 'send_message',
        reasonCode: 'provider_send_message',
      },
      scheduledOccurrenceAt: canonicalJob.state.nextRunAt,
    })
  })

  it('keeps an active unowned reminder independent from related plan lifecycle', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-independent-reminder-ownership-',
    )
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'garden reminder',
    )

    const result = await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          'Independent automation authority (engine-supplied):',
        ),
        responsePolicy: null,
      }),
    )
    const providerInput = cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0] as
      | { instructions?: string }
      | undefined
    expect(providerInput?.instructions).toContain(
      "Completion of a broader plan is not proof that this occurrence's requested action already happened.",
    )
    expect(result.run.notificationDecision).toEqual({
      kind: 'send_message',
      reasonCode: 'provider_send_message',
    })
  })

  it('does not let an unowned automation imitate a managed owner with a mutable tag', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-unowned-managed-tag-',
    )
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'copied managed tag',
    )
    const canonicalAutomation = findCanonicalAutomation(
      vaultRoot,
      canonicalJob.jobId,
    )
    expect(canonicalAutomation).toBeDefined()
    canonicalAutomation?.tags.push('murph-managed:copied')

    await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          'Independent automation authority (engine-supplied):',
        ),
      }),
    )
  })

  it.each([
    {
      expectedProviderStarted: false,
      occurrenceAt: '2026-04-08T10:00:00.000Z',
      outcome: 'no_op',
      reason: 'no_delivery',
    },
    {
      expectedProviderStarted: true,
      occurrenceAt: '2026-04-08T11:00:00.000Z',
      outcome: 'no_op',
      reason: 'no_delivery',
    },
  ])(
    'keeps availability evidence as the final owned suffix for occurrence $occurrenceAt',
    async ({ expectedProviderStarted, occurrenceAt, outcome, reason }) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(occurrenceAt))
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-availability-authority-',
      )
      const canonicalJob = await createCanonicalJob(
        vaultRoot,
        'availability authority',
      )
      const canonicalAutomation = findCanonicalAutomation(
        vaultRoot,
        canonicalJob.jobId,
      )
      if (!canonicalAutomation) {
        throw new Error('Expected the canonical automation to exist.')
      }
      canonicalAutomation.instructions = [
        'Send one flexible reminder.',
        'Availability conflict policy: skip-when-busy',
        'Availability source policy: calendar-only',
        'Availability calendar account: googlecalendar / calendar-account',
        '',
        AVAILABILITY_CONFLICT_BLOCK_START,
        'Availability conflict snapshot:',
        '- generatedAt: 2026-04-08T09:00:00.000Z',
        '- expiresAt: 2026-04-09T09:00:00.000Z',
        '- 2026-04-08T09:30:00.000Z / 2026-04-08T10:30:00.000Z',
        AVAILABILITY_CONFLICT_BLOCK_END,
      ].join('\n')
      canonicalAutomation.schedule = {
        kind: 'dailyLocal',
        localTime: occurrenceAt.endsWith('10:00:00.000Z') ? '10:00' : '11:00',
      }
      const providerStarted = vi.fn()
      const deliveryAttempted = vi.fn()
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
        beforeCommit?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        instructions: string
        onProviderRequestStarted?: () => Promise<void> | void
        scheduledAutomationScheduleKind?: AutomationSchedule['kind'] | null
        scheduledOccurrenceAt?: string | null
      }) => {
        const split = splitAutomationAvailabilityConflictBlock(
          input.instructions,
        )
        expect(split.block).not.toBeNull()
        if (shouldSkipAutomationOccurrenceForAvailability({
          instructions: input.instructions,
          occurrenceAt: input.scheduledOccurrenceAt,
          scheduleKind: input.scheduledAutomationScheduleKind,
        })) {
          return {
            decision: {
              kind: 'skip' as const,
              privateSummary: 'Authorized calendar conflict.',
            },
            response: null,
            session: { sessionId: 'session-availability-skip' },
          }
        }

        providerStarted()
        await input.onProviderRequestStarted?.()
        const providerInstructions =
          stripAutomationAvailabilityConflictEvidenceForProvider(
            input.instructions,
          )
        expect(providerInstructions).toContain(
          'Independent automation authority (engine-supplied):',
        )
        expect(providerInstructions).not.toContain(
          AVAILABILITY_CONFLICT_BLOCK_START,
        )
        expect(providerInstructions).not.toContain(
          '2026-04-08T09:30:00.000Z',
        )
        const context = {
          decision: {
            kind: 'send_message' as const,
            privateSummary: 'Prepared the non-overlapping reminder.',
            text: 'Here is your reminder.',
          },
          deliveryOutcome: null,
          response: 'Here is your reminder.',
        }
        await input.beforeDelivery?.(context)
        deliveryAttempted()
        await input.beforeCommit?.(context)
        return {
          ...context,
          session: { sessionId: 'session-availability-send' },
        }
      })

      const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]
      if (!source) {
        throw new Error('Expected canonical source to exist.')
      }
      const paths = resolveAssistantStatePaths(vaultRoot)
      const runtimeState = resolveCanonicalRuntimeState(
        source,
        await readAssistantCronCanonicalRuntimeStore(paths),
      )
      const result = await executeClaimedAssistantCronJob({
        job: await claimResolvedAssistantCronJob({
          job: {
            kind: 'canonical',
            source,
            runtimeState,
            job: {
              ...projectCanonicalAssistantCronJob({ source, runtimeState }),
              state: {
                ...projectCanonicalAssistantCronJob({ source, runtimeState }).state,
                nextRunAt: occurrenceAt,
              },
            },
          },
          occurrenceFallbackAt: occurrenceAt,
          paths,
        }),
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(providerStarted.mock.calls.length > 0).toBe(
        expectedProviderStarted,
      )
      expect(deliveryAttempted.mock.calls.length > 0).toBe(
        expectedProviderStarted,
      )
      expect(result.run).toMatchObject({
        notificationDecision: expectedProviderStarted
          ? {
              kind: 'send_message',
              reasonCode: 'provider_send_message',
            }
          : null,
        outcome,
        reason,
        scheduledOccurrenceAt: occurrenceAt,
      })
    },
  )

  it.each([
    [
      'missing end marker',
      'missing-end',
      'independent',
      'Independent automation authority (engine-supplied):',
    ],
    [
      'markerless snapshot',
      'markerless',
      'independent',
      'Independent automation authority (engine-supplied):',
    ],
    [
      'duplicate start marker with support scope',
      'duplicate-start',
      'support',
      'Accepted support scope (engine-supplied;',
    ],
    [
      'misplaced end marker with retry evidence',
      'misplaced-end',
      'retry',
      'Delivery integrity evidence (engine-supplied):',
    ],
  ] as const)(
    'keeps trusted overlays provider-visible for recurring availability evidence with a %s',
    async (_label, evidenceKind, overlayKind, expectedOverlay) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-malformed-availability-authority-',
    )
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'malformed availability authority',
    )
    const canonicalAutomation = findCanonicalAutomation(
      vaultRoot,
      canonicalJob.jobId,
    )
    if (!canonicalAutomation) {
      throw new Error('Expected the canonical automation to exist.')
    }
    const baseInstructions = [
      'Send one flexible reminder.',
      'Availability conflict policy: skip-when-busy',
      'Availability source policy: calendar-only',
      'Availability calendar account: googlecalendar / calendar-account',
    ]
    const snapshotLines = [
      AVAILABILITY_CONFLICT_BLOCK_START,
      'Availability conflict snapshot:',
      '- generatedAt: 2026-04-08T09:00:00.000Z',
      '- expiresAt: 2026-04-09T09:00:00.000Z',
      '- 2026-04-08T09:30:00.000Z / 2026-04-08T10:30:00.000Z',
      AVAILABILITY_CONFLICT_BLOCK_END,
    ]
    const malformedSnapshot = evidenceKind === 'missing-end'
      ? snapshotLines.slice(0, -1)
      : evidenceKind === 'markerless'
        ? snapshotLines.slice(1, -1)
        : evidenceKind === 'duplicate-start'
          ? [AVAILABILITY_CONFLICT_BLOCK_START, ...snapshotLines]
          : [AVAILABILITY_CONFLICT_BLOCK_END, ...snapshotLines]
    canonicalAutomation.instructions = [
      ...baseInstructions,
      '',
      ...malformedSnapshot,
    ].join('\n')
    if (overlayKind === 'support') {
      canonicalAutomation.supportKind = 'reminder'
    }
    if (overlayKind === 'retry') {
      await updateCanonicalRuntimeState(
        vaultRoot,
        canonicalJob.jobId,
        (record) => ({
          ...record,
          state: {
            ...record.state,
            lastFailedAt: '2026-04-08T09:45:00.000Z',
            lastSucceededAt: null,
          },
        }),
      )
    }
    const providerStarted = vi.fn()
    const deliveryAttempted = vi.fn()
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
      beforeCommit?: (context: {
        decision: {
          kind: 'send_message'
          privateSummary: string
          text: string
        }
        deliveryOutcome: null
        response: string
      }) => Promise<void>
      beforeDelivery?: (context: {
        decision: {
          kind: 'send_message'
          privateSummary: string
          text: string
        }
        deliveryOutcome: null
        response: string
      }) => Promise<void>
      instructions: string
      onProviderRequestStarted?: () => Promise<void> | void
      scheduledAutomationScheduleKind?: AutomationSchedule['kind'] | null
      scheduledOccurrenceAt?: string | null
    }) => {
      expect(shouldSkipAutomationOccurrenceForAvailability({
        instructions: input.instructions,
        occurrenceAt: input.scheduledOccurrenceAt,
        scheduleKind: input.scheduledAutomationScheduleKind,
      })).toBe(false)
      await input.onProviderRequestStarted?.()
      providerStarted()
      const providerInstructions =
        stripAutomationAvailabilityConflictEvidenceForProvider(
          input.instructions,
        )
      expect(providerInstructions).toContain(expectedOverlay)
      expect(providerInstructions).not.toContain(
        AVAILABILITY_CONFLICT_BLOCK_START,
      )
      expect(providerInstructions).not.toContain(
        '2026-04-08T09:30:00.000Z',
      )
      expect(providerInstructions).not.toContain(
        'Availability conflict snapshot:',
      )
      const context = {
        decision: {
          kind: 'send_message' as const,
          privateSummary: 'Prepared the reminder after malformed evidence.',
          text: 'Here is your reminder.',
        },
        deliveryOutcome: null,
        response: 'Here is your reminder.',
      }
      await input.beforeDelivery?.(context)
      deliveryAttempted()
      await input.beforeCommit?.(context)
      return {
        ...context,
        session: { sessionId: 'session-malformed-availability-send' },
      }
    })

    const result = await runAssistantCronJobNow({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })

    expect(providerStarted).toHaveBeenCalledOnce()
    expect(deliveryAttempted).toHaveBeenCalledOnce()
    expect(result.run).toMatchObject({
      notificationDecision: {
        kind: 'send_message',
        reasonCode: 'provider_send_message',
      },
      status: 'succeeded',
    })
    },
  )

  it.each([
    [
      'reminder',
      'Deliver only the agreed reminder purpose, including a consented first-session walkthrough when the automation says so',
      'Do not ask a proactive repair, accountability, reflection, or follow-up question.',
    ],
    [
      'check_in',
      'Ask at most one narrow check-in or repair question about the current plan.',
      'Do not expand into a review, digest, or new coaching agenda.',
    ],
    [
      'review',
      'Conduct only the bounded review',
      'Do not record or apply that decision until the user replies in a later turn.',
    ],
    [
      'weekly_digest',
      'Provide only the agreed weekly summary shape from current evidence.',
      'Do not append a surprise accountability, repair, or coaching question.',
    ],
  ] as const)(
    'passes the exact accepted %s support scope into the provider turn',
    async (supportKind, expectedScope, expectedBoundary) => {
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-${supportKind}-scope-`,
      )
      const canonicalJob = await createCanonicalJob(
        vaultRoot,
        `${supportKind}-scope`,
      )
      const canonicalAutomation = findCanonicalAutomation(
        vaultRoot,
        canonicalJob.jobId,
      )
      expect(canonicalAutomation).toBeDefined()
      if (!canonicalAutomation) {
        throw new Error('Expected the canonical automation to exist.')
      }
      canonicalAutomation.supportKind = supportKind
      canonicalAutomation.tags.push(
        'system:support-series:habit:reg_sleep_support',
      )

      await runAssistantCronJobNow({
        job: canonicalJob.jobId,
        vault: vaultRoot,
      })

      expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: expect.stringContaining(
            `Persisted support kind: ${supportKind}.`,
          ),
        }),
      )
      const providerInput = cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0] as
        | { instructions?: string }
        | undefined
      expect(providerInput?.instructions).toContain(expectedScope)
      expect(providerInput?.instructions).toContain(expectedBoundary)
      if (supportKind === 'review') {
        expect(providerInput?.instructions).toContain(
          "ask at most one question requesting the user's continue, modify, pause, stop, or escalate decision",
        )
        expect(providerInput?.instructions).not.toContain('request or record')
      }
      expect(providerInput?.instructions).toContain(
        'this overrides any broader repair or follow-up option above',
      )
      expect(providerInput?.instructions).not.toContain(
        'Independent automation authority (engine-supplied):',
      )
    },
  )

  it('runs retained Linq overnight maintenance without entering its audience', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-',
    )
    addOvernightMemoryConsolidationAutomation(vaultRoot)

    const result = await runAssistantCronJobNow({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'no_op',
      reason: 'no_delivery',
      status: 'succeeded',
    })
    const notificationInput =
      cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0] as
        | { instructions?: string }
        | undefined
    expect(notificationInput?.instructions).not.toContain(
      'Independent automation authority (engine-supplied):',
    )
    expect(findCanonicalAutomation(
      vaultRoot,
      MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )?.route).toEqual({
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'retained-maintenance-chat',
      identityId: 'retained-maintenance-identity',
      participantId: 'retained-maintenance-participant',
      threadId: 'retained-maintenance-thread',
      threadIsDirect: true,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: undefined,
        channel: null,
        deliveryKind: undefined,
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        instructions: 'Consolidate canonical vault memory.',
        participantId: null,
        responsePolicy: null,
        sessionId: null,
        threadId: null,
        threadIsDirect: null,
        turnPolicy: {
          kind: 'maintenance-exact-skip',
          maintenanceProfile: 'member-memory',
          privateSummary: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
        },
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('runs retained group room-model maintenance silently with the group evidence profile', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-group-room-model-',
    )
    addGroupRoomModelConsolidationAutomation(vaultRoot)

    const result = await runAssistantCronJobNow({
      executionContext: {
        hosted: {
          memberId: 'member-group-runtime',
          resolveScheduledExternalThreadRoute: vi.fn(async () => ({
            channel: 'telegram' as const,
            containerMemberId: 'member-group-runtime',
            threadId: 'retained-group-room',
          })),
          userEnvKeys: [],
        },
      },
      job: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'no_op',
      reason: 'no_delivery',
      status: 'succeeded',
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: undefined,
        channel: null,
        deliveryTarget: null,
        identityId: null,
        instructions: 'Refresh the group room model.',
        participantId: null,
        responsePolicy: null,
        sessionId: null,
        threadId: null,
        threadIsDirect: null,
        turnPolicy: {
          kind: 'maintenance-exact-skip',
          maintenanceProfile: 'group-room-model',
          privateSummary: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_PRIVATE_SUMMARY,
        },
      }),
    )
  })

  it('does not claim overnight memory consolidation from local due scans', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-local-scan-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    const beforeRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const localStatus = await getAssistantCronStatus(vaultRoot)
    const hostedStatus = await getAssistantCronStatus(vaultRoot, {
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
    })
    const hostedTurnEnvironmentStatus = await getAssistantCronStatus(vaultRoot, {
      turnEnvironment: {
        currentWorkingDirectory: null,
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
        },
      },
    })

    expect(localStatus.dueJobs).toBe(0)
    expect(localStatus.nextRunAt).toBeNull()
    expect(hostedStatus.dueJobs).toBe(1)
    expect(hostedStatus.nextRunAt).not.toBeNull()
    expect(hostedTurnEnvironmentStatus.dueJobs).toBe(1)
    expect(hostedTurnEnvironmentStatus.nextRunAt).not.toBeNull()

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 0,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(readAssistantCronCanonicalRuntimeStore(paths))
      .resolves.toEqual(beforeRuntimeStore)
  })

  it('runs late overnight memory consolidation instead of expiring it as a notification', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T04:30:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-late-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'skip',
        privateSummary: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
      },
      response: null,
      session: {
        sessionId: 'session-overnight-maintenance',
      },
    })
    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
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
        bindingDeliveryTarget: undefined,
        channel: null,
        deliveryKind: undefined,
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        sessionId: null,
        threadId: null,
        threadIsDirect: null,
        turnPolicy: {
          kind: 'maintenance-exact-skip',
          maintenanceProfile: 'member-memory',
          privateSummary: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
        },
      }),
    )
    expect(findCanonicalAutomation(
      vaultRoot,
      MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )?.route).toEqual({
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'retained-maintenance-chat',
      identityId: 'retained-maintenance-identity',
      participantId: 'retained-maintenance-participant',
      threadId: 'retained-maintenance-thread',
      threadIsDirect: true,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'succeeded',
        }),
      ],
    })
  })

  it('releases overnight memory consolidation when hosted maintenance yields before the turn starts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-yield-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    let yieldCheckCount = 0
    const shouldYield = () => {
      yieldCheckCount += 1
      return yieldCheckCount >= 2
    }

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYieldBackgroundMaintenance: shouldYield,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.runningAt).toBeNull()
    expect(runtimeRecord?.state.runningClaimId).toBeNull()
    expect(runtimeRecord?.state.runningPid).toBeNull()
    expect(runtimeRecord?.state.pendingOccurrenceAt).not.toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).not.toBeNull()
    expect(runtimeRecord?.state.lastRunAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBeNull()
    expect(runtimeRecord?.state.lastFailedAt).toBeNull()
    await expect(getAssistantCronStatus(vaultRoot, {
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      shouldYieldBackgroundMaintenance: () => true,
    })).resolves.toMatchObject({
      dueJobs: 0,
      nextRunAt: runtimeRecord?.state.retryAfterAt,
    })
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [],
    })
  })

  it('schedules a catch-up wake for a due unclaimed overnight job while foreground yield is active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-preclaim-yield-',
    )
    addOvernightMemoryConsolidationAutomation(vaultRoot)

    // Yield is active before any claim: no retryAfterAt has been persisted,
    // and the yield-filtered projection hides the due job from dueJobs. The
    // status wake must still include a short catch-up retry so the occurrence
    // is not disarmed until an unrelated wake.
    await expect(getAssistantCronStatus(vaultRoot, {
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      shouldYieldBackgroundMaintenance: () => true,
    })).resolves.toMatchObject({
      dueJobs: 0,
      nextRunAt: '2026-04-09T03:10:30.000Z',
    })
  })

  it('aborts and releases overnight memory consolidation when hosted maintenance yields during provider work before side effects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-yield-provider-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    let shouldYield = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (input: { abortSignal?: AbortSignal }) => {
        expect(input.abortSignal?.aborted).toBe(false)
        shouldYield = true
        await vi.advanceTimersByTimeAsync(300)
        expect(input.abortSignal?.aborted).toBe(true)
        throw input.abortSignal?.reason ??
          new VaultCliError(
            'ASSISTANT_TURN_ABORTED',
            'Assistant turn was aborted.',
          )
      },
    )

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYieldBackgroundMaintenance: () => shouldYield,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.runningAt).toBeNull()
    expect(runtimeRecord?.state.runningClaimId).toBeNull()
    expect(runtimeRecord?.state.runningPid).toBeNull()
    expect(runtimeRecord?.state.pendingOccurrenceAt).not.toBeNull()
    expect(runtimeRecord?.state.lastRunAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBeNull()
    expect(runtimeRecord?.state.lastFailedAt).toBeNull()
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [],
    })
  })

  it('releases overnight memory consolidation deterministically when the dual hosted yield predicate flips during provider work', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-dual-yield-provider-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    // Hosted wiring passes the same foreground-arrival predicate as both the
    // generic cron shouldYield and shouldYieldBackgroundMaintenance. The
    // maintenance cancellation must be the only yield owner, so the abort is
    // always classified as a clean maintenance release, never a failed
    // foreground-yield run that depends on poll timing.
    let shouldYield = false
    const yieldPredicate = () => shouldYield
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (input: { abortSignal?: AbortSignal }) => {
        expect(input.abortSignal?.aborted).toBe(false)
        shouldYield = true
        await vi.advanceTimersByTimeAsync(300)
        expect(input.abortSignal?.aborted).toBe(true)
        throw input.abortSignal?.reason ??
          new VaultCliError(
            'ASSISTANT_TURN_ABORTED',
            'Assistant turn was aborted.',
          )
      },
    )

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYield: yieldPredicate,
      shouldYieldBackgroundMaintenance: yieldPredicate,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.runningAt).toBeNull()
    expect(runtimeRecord?.state.pendingOccurrenceAt).not.toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).not.toBeNull()
    expect(runtimeRecord?.state.lastRunAt).toBeNull()
    expect(runtimeRecord?.state.lastFailedAt).toBeNull()
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [],
    })
  })

  it('consumes overnight memory consolidation when yield aborts after provider admission without a completed command event', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-provider-admitted-yield-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    // Once the provider request was admitted, memory writes may have
    // committed even though the completed command event never reached the
    // buffered raw events. The occurrence must be consumed, never replayed.
    let shouldYield = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (input: {
        abortSignal?: AbortSignal
        onProviderRequestStarted?: (event: { startedAt: string }) => void
      }) => {
        input.onProviderRequestStarted?.({
          startedAt: '2026-04-09T03:10:00.000Z',
        })
        shouldYield = true
        await vi.advanceTimersByTimeAsync(300)
        throw input.abortSignal?.reason ??
          new VaultCliError(
            'ASSISTANT_TURN_ABORTED',
            'Assistant turn was aborted.',
          )
      },
    )

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYieldBackgroundMaintenance: () => shouldYield,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.runningAt).toBeNull()
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'skipped',
        }),
      ],
    })
  })

  it('consumes overnight memory consolidation when a non-yield terminal failure follows provider admission', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-admitted-terminal-failure-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    // Provider admitted, then the turn dies without a yield and without the
    // completed memory-command event ever reaching the buffered raw events.
    // Memory writes may have committed; the occurrence must be consumed.
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (input: {
        onProviderRequestStarted?: (event: { startedAt: string }) => void
      }) => {
        input.onProviderRequestStarted?.({
          startedAt: '2026-04-09T03:10:00.000Z',
        })
        throw new VaultCliError(
          'ASSISTANT_PROVIDER_FAILED',
          'Codex app-server process exited unexpectedly.',
        )
      },
    )

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYieldBackgroundMaintenance: () => false,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.runningAt).toBeNull()
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'skipped',
        }),
      ],
    })
  })

  it('consumes overnight memory consolidation when hosted maintenance yields after provider work', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-yield-provider-work-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    let shouldYield = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (input: { abortSignal?: AbortSignal }) => {
        shouldYield = true
        await vi.advanceTimersByTimeAsync(300)
        const error = input.abortSignal?.reason instanceof Error
          ? input.abortSignal.reason
          : new VaultCliError(
              'ASSISTANT_TURN_ABORTED',
              'Assistant turn was aborted.',
            )
        Reflect.set(error, 'details', {
          assistantNotificationProviderNonReplayableWork: true,
        })
        throw error
      },
    )

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYieldBackgroundMaintenance: () => shouldYield,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBe('2026-04-09T03:10:00.300Z')
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          error: expect.stringContaining('occurrence consumed to avoid replay'),
          status: 'skipped',
        }),
      ],
    })
  })

  it('consumes overnight memory consolidation when provider work fails after side effects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-provider-work-failure-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    const error = new VaultCliError(
      'ASSISTANT_NOTIFICATION_MAINTENANCE_DECISION_INVALID',
      'Assistant maintenance notification must return the exact configured skip decision.',
    )
    Reflect.set(error, 'details', {
      assistantNotificationProviderNonReplayableWork: true,
    })
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(error)

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBe('2026-04-09T03:10:00.000Z')
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          error: expect.stringContaining('occurrence consumed to avoid replay'),
          status: 'skipped',
        }),
      ],
    })
  })

  it('retries overnight memory consolidation when read-only provider work fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-read-only-failure-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    const error = new VaultCliError(
      'ASSISTANT_NOTIFICATION_MAINTENANCE_DECISION_INVALID',
      'Assistant maintenance notification must return the exact configured skip decision.',
    )
    Reflect.set(error, 'details', {
      assistantNotificationProviderNonReplayableWork: false,
    })
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(error)

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
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
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).not.toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).not.toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBeNull()
    expect(runtimeRecord?.state.lastFailedAt).toBe('2026-04-09T03:10:00.000Z')
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'failed',
        }),
      ],
    })
  })

  it('consumes overnight memory consolidation when foreground yield appears after maintenance success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-yield-after-success-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    let shouldYield = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async () => {
      shouldYield = true
      return {
        decision: {
          kind: 'skip',
          privateSummary: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
        },
        response: null,
        session: {
          sessionId: 'session-overnight-maintenance',
        },
      }
    })

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYieldBackgroundMaintenance: () => shouldYield,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBe('2026-04-09T03:10:00.000Z')
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'succeeded',
        }),
      ],
    })
  })

  it('consumes overnight memory consolidation when the hosted foreground yield callback flips after success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T03:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-foreground-flip-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    // The hosted lane wires the same yield predicate into both the cron
    // foreground preemption (shouldYield) and the background maintenance
    // yield. A flip after the provider succeeded must not release and replay
    // the occurrence, because the memory writes already happened.
    let shouldYield = false
    const yieldPredicate = () => shouldYield
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async () => {
      shouldYield = true
      return {
        decision: {
          kind: 'skip',
          privateSummary: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
        },
        response: null,
        session: {
          sessionId: 'session-overnight-maintenance',
        },
      }
    })

    const summary = await processDueAssistantCronJobsLocal({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          userEnvKeys: [],
        },
      },
      limit: 1,
      shouldYield: yieldPredicate,
      shouldYieldBackgroundMaintenance: yieldPredicate,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBe('2026-04-09T03:10:00.000Z')
    await expect(listAssistantCronRuns({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: [
        expect.objectContaining({
          status: 'succeeded',
        }),
      ],
    })
  })

  it('rejects local manual overnight memory consolidation before claim', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-overnight-memory-local-run-now-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    addOvernightMemoryConsolidationAutomation(vaultRoot)
    const beforeRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths)

    await expect(runAssistantCronJobNow({
      job: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_RUNTIME_SCOPE_UNAVAILABLE',
    })
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(readAssistantCronCanonicalRuntimeStore(paths))
      .resolves.toEqual(beforeRuntimeStore)
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

  it('does not claim due cron jobs when foreground work is already observed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-yield-before-claim-',
      )
      const canonicalJob = await createCanonicalJob(vaultRoot, 'yield-before-claim')

      const summary = await processDueAssistantCronJobsLocal({
        limit: 1,
        shouldYield: () => true,
        vault: vaultRoot,
      })

      expect(summary).toEqual({
        failed: 0,
        processed: 0,
        succeeded: 0,
      })
      expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
      await expect(
        listAssistantCronRuns({
          job: canonicalJob.jobId,
          vault: vaultRoot,
        }),
      ).resolves.toEqual({
        jobId: canonicalJob.jobId,
        runs: [],
      })
      const current = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
      expect(current.state.runningAt).toBeNull()
      expect(current.state.lastSucceededAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight canonical cron assistant turn when foreground work appears', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-yield-in-flight-',
      )
      const canonicalJob = await createCanonicalJob(vaultRoot, 'yield-in-flight')
      let shouldYield = false
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
        async (input: { abortSignal?: AbortSignal }) => {
          expect(input.abortSignal?.aborted).toBe(false)
          shouldYield = true
          await vi.advanceTimersByTimeAsync(50)
          expect(input.abortSignal?.aborted).toBe(true)
          throw input.abortSignal?.reason ?? new Error('Expected foreground yield abort.')
        },
      )

      const summary = await processDueAssistantCronJobsLocal({
        limit: 1,
        shouldYield: () => shouldYield,
        vault: vaultRoot,
      })

      expect(summary).toEqual({
        failed: 1,
        processed: 1,
        succeeded: 0,
      })
      expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
      await expect(
        listAssistantCronRuns({
          job: canonicalJob.jobId,
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        jobId: canonicalJob.jobId,
        runs: [{
          error: 'Assistant cron yielded to fresh foreground input.',
          status: 'failed',
        }],
      })

      const current = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
      expect(current.state.runningAt).toBeNull()
      expect(current.state.lastFailedAt).toBeNull()
      expect(current.state.consecutiveFailures).toBe(0)
      expect(current.state.nextRunAt).toBe('2026-04-08T10:20:10.050Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('abandons a queued cron outbox intent when foreground work appears before durable commit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-yield-queued-outbox-',
      )
      const canonicalJob = await createCanonicalJob(vaultRoot, 'yield-queued-outbox')
      const queuedIntentId = 'outbox_yield_queued_delivery'
      let shouldYield = false
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
        beforeCommit?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: {
            error: null
            intentId: string
            kind: 'queued'
            session: {
              sessionId: string
            }
          }
          response: string
        }) => Promise<void> | void
        deferCommitUntilDeliveryAccepted?: boolean | null
        onProviderRequestStarted?: () => Promise<void> | void
      }) => {
        await input.onProviderRequestStarted?.()
        await saveAssistantOutboxIntent(
          vaultRoot,
          buildTestLinqOutboxIntent({
            createdAt: '2026-04-08T10:20:00.000Z',
            intentId: queuedIntentId,
          }),
        )
        const decision = {
          kind: 'send_message' as const,
          privateSummary: 'Queued scheduled reminder.',
          text: 'Remember to sleep.',
        }
        const deliveryOutcome = {
          kind: 'queued' as const,
          error: null,
          intentId: queuedIntentId,
          session: {
            sessionId: 'session-default',
          },
        }
        shouldYield = true
        expect(input.deferCommitUntilDeliveryAccepted).toBe(true)
        await input.beforeCommit?.({
          decision,
          deliveryOutcome,
          response: 'Remember to sleep.',
        })
        return {
          decision,
          deliveryOutcome,
          response: 'Remember to sleep.',
          session: {
            sessionId: 'session-default',
          },
        }
      })

      const summary = await processDueAssistantCronJobsLocal({
        deliveryDispatchMode: 'queue-only',
        limit: 1,
        shouldYield: () => shouldYield,
        vault: vaultRoot,
      })

      expect(summary).toEqual({
        failed: 1,
        processed: 1,
        succeeded: 0,
      })
      expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
      const intent = await readAssistantOutboxIntent(vaultRoot, queuedIntentId)
      expect(intent?.status).toBe('abandoned')
      expect(intent?.lastError).toMatchObject({
        code: 'ASSISTANT_CRON_FOREGROUND_YIELDED',
      })
      await expect(
        listAssistantCronRuns({
          job: canonicalJob.jobId,
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        jobId: canonicalJob.jobId,
        runs: [{
          error: 'Assistant cron yielded to fresh foreground input.',
          notificationDecision: {
            kind: 'send_message',
            reasonCode: 'provider_send_message',
          },
          scheduledOccurrenceAt: canonicalJob.state.nextRunAt,
          status: 'failed',
        }],
      })

      const current = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
      expect(current.state.pendingDeliveryIntentId).toBeUndefined()
      expect(current.state.runningAt).toBeNull()
      expect(current.state.lastFailedAt).toBeNull()
      expect(current.state.consecutiveFailures).toBe(0)
      expect(current.state.nextRunAt).toBe('2026-04-08T10:20:10.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an accepted queue-only cron delivery when foreground work appears after durable commit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-yield-after-queued-commit-',
      )
      const canonicalJob = await createCanonicalJob(vaultRoot, 'yield-after-queued-commit')
      const queuedIntentId = 'outbox_yield_after_queued_commit'
      let shouldYield = false
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
        beforeCommit?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: {
            error: null
            intentId: string
            kind: 'queued'
            session: {
              sessionId: string
            }
          }
          response: string
        }) => Promise<void> | void
        deferCommitUntilDeliveryAccepted?: boolean | null
      }) => {
        await saveAssistantOutboxIntent(
          vaultRoot,
          buildTestLinqOutboxIntent({
            createdAt: '2026-04-08T10:20:00.000Z',
            intentId: queuedIntentId,
          }),
        )
        const decision = {
          kind: 'send_message' as const,
          privateSummary: 'Queued scheduled reminder.',
          text: 'Remember to sleep.',
        }
        const deliveryOutcome = {
          kind: 'queued' as const,
          error: null,
          intentId: queuedIntentId,
          session: {
            sessionId: 'session-default',
          },
        }
        expect(input.deferCommitUntilDeliveryAccepted).toBe(true)
        await input.beforeCommit?.({
          decision,
          deliveryOutcome,
          response: 'Remember to sleep.',
        })
        shouldYield = true
        return {
          decision,
          deliveryOutcome,
          response: 'Remember to sleep.',
          session: {
            sessionId: 'session-default',
          },
        }
      })

      const summary = await processDueAssistantCronJobsLocal({
        deliveryDispatchMode: 'queue-only',
        limit: 1,
        shouldYield: () => shouldYield,
        vault: vaultRoot,
      })

      expect(summary).toEqual({
        failed: 0,
        processed: 1,
        succeeded: 0,
      })
      expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
      const intent = await readAssistantOutboxIntent(vaultRoot, queuedIntentId)
      expect(intent?.status).toBe('pending')
      expect(intent?.lastError).toBeNull()
      await expect(
        listAssistantCronRuns({
          job: canonicalJob.jobId,
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        jobId: canonicalJob.jobId,
        runs: [{
          error: null,
          status: 'skipped',
        }],
      })

      const current = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
      expect(current.state.pendingDeliveryIntentId).toBe(queuedIntentId)
      expect(current.state.runningAt).toBeNull()
      expect(current.state.lastFailedAt).toBeNull()
      expect(current.state.consecutiveFailures).toBe(0)
      expect(current.state.nextRunAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
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

  it('makes optional group email authority available at the first natural cron occurrence', async () => {
    async function runOccurrence(occurrenceAt: string) {
      vi.setSystemTime(new Date(occurrenceAt))
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-newsletter-authority-',
      )
      getVaultAutomationStore(vaultRoot).push({
        automationId: 'automation-newsletter-window',
        continuityPolicy: 'fresh',
        createdAt: '2026-06-01T10:00:00.000Z',
        instructions: 'Compose the group health newsletter.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'group-chat-1',
          identityId: null,
          participantId: null,
          threadId: 'group-chat-1',
          threadIsDirect: false,
        },
        schedule: {
          kind: 'cron',
          expression: '0 * * * *',
        },
        scheduleAnchorAt: '2026-07-06T10:00:00.000Z',
        slug: 'group-health-newsletter',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: 'Group Health Newsletter',
        updatedAt: '2026-07-06T10:00:00.000Z',
      })

      const paths = resolveAssistantStatePaths(vaultRoot)
      const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]
      if (!source) {
        throw new Error('Expected newsletter automation source.')
      }
      if (source.kind !== 'automation') {
        throw new Error('Expected newsletter automation source.')
      }
      const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
      const runtimeState = {
        ...resolveCanonicalRuntimeState(source, runtimeStore),
        state: {
          ...resolveCanonicalRuntimeState(source, runtimeStore).state,
          pendingOccurrenceAt: occurrenceAt,
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
      const input = cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0] as
        | { scheduledAutomationAuthority?: unknown }
        | undefined
      if (!input) {
        throw new Error('Expected scheduled notification input.')
      }
      const authority = input.scheduledAutomationAuthority ?? null
      expect(result.run.status).toBe('succeeded')
      return authority
    }

    vi.useFakeTimers()
    try {
      await expect(
        runOccurrence('2026-07-06T11:59:59.999Z'),
      ).resolves.toEqual({
        automationId: 'automation-newsletter-window',
        occurrenceAt: '2026-07-06T11:00:00.000Z',
      })
      await expect(
        runOccurrence('2026-07-06T12:00:00.000Z'),
      ).resolves.toEqual({
        automationId: 'automation-newsletter-window',
        occurrenceAt: '2026-07-06T12:00:00.000Z',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('only grants generic group email authority for group cron schedules', async () => {
    async function runSchedule(
      schedule: AutomationSchedule,
      tags: string[] = ['assistant', 'scheduled'],
    ) {
      vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-newsletter-schedule-kind-',
      )
      getVaultAutomationStore(vaultRoot).push({
        automationId: 'automation-newsletter-schedule-kind',
        continuityPolicy: 'fresh',
        createdAt: '2026-07-06T10:00:00.000Z',
        instructions: 'Compose the group health newsletter.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'group-chat-1',
          identityId: null,
          participantId: null,
          threadId: 'group-chat-1',
          threadIsDirect: false,
        },
        schedule,
        slug: 'group-health-newsletter',
        status: 'active',
        summary: null,
        tags,
        title: 'Group Health Newsletter',
        updatedAt: '2026-07-06T10:00:00.000Z',
      })

      const paths = resolveAssistantStatePaths(vaultRoot)
      const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]
      if (!source) {
        throw new Error('Expected newsletter automation source.')
      }
      if (source.kind !== 'automation') {
        throw new Error('Expected newsletter automation source.')
      }
      const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
      const resolvedRuntimeState = resolveCanonicalRuntimeState(source, runtimeStore)
      const runtimeState = {
        ...resolvedRuntimeState,
        state: {
          ...resolvedRuntimeState.state,
          pendingOccurrenceAt: '2026-07-06T12:00:00.000Z',
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
      const input = cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0] as
        | { instructions?: string; scheduledAutomationAuthority?: unknown }
        | undefined
      if (!input) {
        throw new Error('Expected scheduled notification input.')
      }
      const authority = input.scheduledAutomationAuthority ?? null
      expect(result.run.status).toBe('succeeded')
      return {
        authority,
        instructions: input.instructions ?? '',
        status: result.run.status,
      }
    }

    vi.useFakeTimers()
    try {
      await expect(
        runSchedule({ kind: 'cron', expression: '0 * * * *' }),
      ).resolves.toMatchObject({
        authority: {
          automationId: 'automation-newsletter-schedule-kind',
          occurrenceAt: '2026-07-06T12:00:00.000Z',
        },
        instructions: expect.stringContaining('Compose the group health newsletter.'),
        status: 'succeeded',
      })
      await expect(
        runSchedule({ kind: 'at', at: '2026-07-06T12:00:00.000Z' }),
      ).resolves.toMatchObject({ authority: null, status: 'succeeded' })
      await expect(
        runSchedule({ kind: 'every', everyMs: 3_600_000 }),
      ).resolves.toMatchObject({ authority: null, status: 'succeeded' })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      label: 'every email recipient fails',
      groupEmailSendResult: {
        status: 'unavailable' as const,
        unavailableReason: 'send_failed',
      },
    },
    {
      label: 'recipient authorization changes after preparation',
      groupEmailSendResult: {
        status: 'unavailable' as const,
        unavailableReason: 'group_email_authorization_changed',
      },
    },
    {
      label: 'durable recipient delivery is still pending',
      groupEmailSendResult: {
        participantCount: 2,
        skippedNoEmailMemberIds: [],
        status: 'accepted' as const,
      },
    },
  ])('fails and preserves a scheduled group email occurrence when $label', async ({
    groupEmailSendResult,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-12T13:00:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-newsletter-send-failed-',
      )
      getVaultAutomationStore(vaultRoot).push({
        automationId: 'automation-newsletter-send-failed',
        continuityPolicy: 'fresh',
        createdAt: '2026-07-06T10:00:00.000Z',
        instructions: 'Compose and send the group health newsletter.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'group-chat-1',
          identityId: null,
          participantId: null,
          threadId: 'group-chat-1',
          threadIsDirect: false,
        },
        schedule: {
          kind: 'cron',
          expression: '0 13 * * 0',
        },
        slug: 'group-health-newsletter',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: 'Group Health Newsletter',
        updatedAt: '2026-07-06T10:00:00.000Z',
      })
      const occurrenceAt = '2026-07-12T13:00:00.000Z'
      const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]
      if (!source) {
        throw new Error('Expected newsletter automation source.')
      }
      if (source.kind !== 'automation') {
        throw new Error('Expected newsletter automation source.')
      }
      const paths = resolveAssistantStatePaths(vaultRoot)
      const runtimeState = {
        ...resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths)),
        state: {
          ...resolveCanonicalRuntimeState(
            source,
            await readAssistantCronCanonicalRuntimeStore(paths),
          ).state,
          pendingOccurrenceAt: occurrenceAt,
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
      cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
        decision: {
          kind: 'send_message',
          privateSummary: 'Newsletter delivery failed.',
          text: 'Newsletter delivery failed.',
        },
        ...(groupEmailSendResult
          ? {
              postTurnDeliveryExpectations: { groupEmailSendResult },
            }
          : {}),
        response: 'Newsletter delivery failed.',
        session: {
          sessionId: 'session-newsletter-send-failed',
        },
      })

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.run.status).toBe('failed')
      expect(result.run.error).toBe(
        'Group email delivery did not complete.',
      )
      const currentStore = await readAssistantCronCanonicalRuntimeStore(paths)
      const current = currentStore.jobs.find((record) => record.jobId === source.automationId)
      expect(current?.state.pendingOccurrenceAt).toBe(occurrenceAt)
      expect(current?.state.retryAfterAt).toBe('2026-07-12T13:00:30.000Z')
      expect(current?.state.consecutiveFailures).toBe(1)
      expect(current?.state.lastFailedAt).toBe('2026-07-12T13:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      expectedRunError: null,
      expectedRunOutcome: 'no_op',
      expectedRunReason: 'no_delivery',
      expectedRunStatus: 'succeeded',
      label: 'partial newsletter delivery',
      groupEmailPendingDeliveryIntentId: null,
      groupEmailSendResult: {
        failedRecipientCount: 1,
        participantCount: 3,
        sentRecipientCount: 2,
        skippedNoEmailMemberIds: [],
        status: 'partial_failure' as const,
      },
      throwsAfterAcceptance: false,
    },
    {
      expectedRunError: null,
      expectedRunOutcome: 'no_op',
      expectedRunReason: 'no_delivery',
      expectedRunStatus: 'succeeded',
      label: 'newsletter with no recipients',
      groupEmailPendingDeliveryIntentId: null,
      groupEmailSendResult: {
        participantCount: 0,
        skippedNoEmailMemberIds: ['member_without_email'],
        status: 'no_recipients' as const,
      },
      throwsAfterAcceptance: false,
    },
    {
      expectedRunError: null,
      expectedRunOutcome: 'delivery_pending',
      expectedRunReason: 'delivery_pending',
      expectedRunStatus: 'skipped',
      label: 'durable newsletter fanout is pending',
      groupEmailPendingDeliveryIntentId: 'outbox-newsletter-parent',
      groupEmailSendResult: {
        participantCount: 3,
        skippedNoEmailMemberIds: [],
        status: 'accepted' as const,
      },
      throwsAfterAcceptance: false,
    },
    {
      expectedRunError: 'notification failed after durable newsletter acceptance',
      expectedRunOutcome: 'delivery_pending',
      expectedRunReason:
        'delivery_pending_after_ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
      expectedRunStatus: 'skipped',
      label: 'durable newsletter acceptance precedes a notification error',
      groupEmailPendingDeliveryIntentId:
        'outbox-newsletter-parent-after-error',
      groupEmailSendResult: {
        participantCount: 3,
        skippedNoEmailMemberIds: [],
        status: 'accepted' as const,
      },
      throwsAfterAcceptance: true,
    },
  ])('settles a scheduled newsletter occurrence when $label', async ({
    expectedRunError,
    expectedRunOutcome,
    expectedRunReason,
    expectedRunStatus,
    groupEmailPendingDeliveryIntentId,
    groupEmailSendResult,
    throwsAfterAcceptance,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-12T13:00:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-newsletter-send-succeeded-',
      )
      getVaultAutomationStore(vaultRoot).push({
        automationId: 'automation-newsletter-send-succeeded',
        continuityPolicy: 'fresh',
        createdAt: '2026-07-06T10:00:00.000Z',
        instructions: 'Compose and send the group health newsletter.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'group-chat-1',
          identityId: null,
          participantId: null,
          threadId: 'group-chat-1',
          threadIsDirect: false,
        },
        schedule: {
          kind: 'cron',
          expression: '0 13 * * 0',
        },
        slug: 'group-health-newsletter',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: 'Group Health Newsletter',
        updatedAt: '2026-07-06T10:00:00.000Z',
      })
      const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]
      if (!source) {
        throw new Error('Expected newsletter automation source.')
      }
      if (source.kind !== 'automation') {
        throw new Error('Expected newsletter automation source.')
      }
      const paths = resolveAssistantStatePaths(vaultRoot)
      const baseRuntimeState = resolveCanonicalRuntimeState(
        source,
        await readAssistantCronCanonicalRuntimeStore(paths),
      )
      const runtimeState = {
        ...baseRuntimeState,
        state: {
          ...baseRuntimeState.state,
          pendingOccurrenceAt: '2026-07-12T13:00:00.000Z',
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
      if (throwsAfterAcceptance) {
        cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (
          notificationInput: {
            onGroupEmailPendingDeliveryIntentId?: (intentId: string) => void
          },
        ) => {
          if (!groupEmailPendingDeliveryIntentId) {
            throw new Error('Expected a pending newsletter parent id.')
          }
          notificationInput.onGroupEmailPendingDeliveryIntentId?.(
            groupEmailPendingDeliveryIntentId,
          )
          throw new VaultCliError(
            'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
            expectedRunError ?? 'notification failed',
          )
        })
      } else {
        cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
          decision: {
            kind: 'send_message',
            privateSummary: 'Newsletter handled.',
            text: 'Newsletter handled.',
          },
          postTurnDeliveryExpectations: {
            ...(groupEmailPendingDeliveryIntentId
              ? { groupEmailPendingDeliveryIntentId }
              : {}),
            groupEmailSendResult,
          },
          response: 'Newsletter handled.',
          session: {
            sessionId: 'session-newsletter-send-succeeded',
          },
        })
      }

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.run.status).toBe(expectedRunStatus)
      expect(result.run.outcome).toBe(expectedRunOutcome)
      expect(result.run.reason).toBe(expectedRunReason)
      expect(result.run.error).toBe(expectedRunError)
      const currentStore = await readAssistantCronCanonicalRuntimeStore(paths)
      const current = currentStore.jobs.find((record) => record.jobId === source.automationId)
      expect(current?.state.pendingOccurrenceAt).toBe(
        groupEmailPendingDeliveryIntentId
          ? '2026-07-12T13:00:00.000Z'
          : null,
      )
      expect(current?.state.pendingDeliveryIntentId ?? null).toBe(
        groupEmailPendingDeliveryIntentId,
      )
      expect(current?.state.consecutiveFailures).toBe(0)
      expect(current?.state.lastFailedAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      expectedLastFailedAt: null,
      expectedLastSucceededAt: null,
      label: 'pending',
      status: 'pending' as const,
    },
    {
      expectedLastFailedAt: null,
      expectedLastSucceededAt: '2026-07-12T13:00:05.000Z',
      label: 'sent',
      status: 'sent' as const,
    },
    {
      expectedLastFailedAt: '2026-07-12T13:00:05.000Z',
      expectedLastSucceededAt: null,
      label: 'failed',
      status: 'failed' as const,
    },
  ])('recovers a durable $label newsletter parent before provider admission', async ({
    expectedLastFailedAt,
    expectedLastSucceededAt,
    status,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-12T13:00:10.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-newsletter-restart-${status}-`,
      )
      const occurrenceAt = '2026-07-12T13:00:00.000Z'
      const automationId = `automation-newsletter-restart-${status}`
      const { claimed, paths, source } =
        await createClaimedNewsletterCronJob({
          automationId,
          occurrenceAt,
          vaultRoot,
        })
      const intent = buildTestNewsletterParentIntent({
        automationId,
        expectedUpdatedAt: source.updatedAt,
        intentId: `outbox-newsletter-restart-${status}`,
        occurrenceAt,
      })
      await saveAssistantOutboxIntent(vaultRoot, intent)
      if (status === 'sent') {
        await markAssistantOutboxIntentSentById({
          delivery: {
            channel: 'email',
            idempotencyKey: intent.deliveryIdempotencyKey,
            messageLength: intent.message.length,
            providerMessageId: 'email-newsletter-restart',
            providerThreadId: null,
            sentAt: '2026-07-12T13:00:05.000Z',
            target: intent.explicitTarget ?? 'group',
            targetKind: 'explicit',
          },
          intentId: intent.intentId,
          vault: vaultRoot,
        })
      } else if (status === 'failed') {
        await markAssistantOutboxIntentMirrorTerminalById({
          error: new Error('newsletter fanout failed'),
          failedAt: new Date('2026-07-12T13:00:05.000Z'),
          intentId: intent.intentId,
          status: 'failed',
          vault: vaultRoot,
        })
      }

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
      expect(result.run).toMatchObject({
        outcome: 'delivery_pending',
        reason: 'delivery_pending',
      })
      let current = (
        await readAssistantCronCanonicalRuntimeStore(paths)
      ).jobs.find((record) => record.jobId === source.automationId)
      expect(current?.state.pendingDeliveryIntentId).toBe(intent.intentId)
      expect(current?.state.pendingOccurrenceAt).toBe(occurrenceAt)

      if (status !== 'pending') {
        await expect(
          repairPendingAssistantCronDeliveries({
            now: new Date('2026-07-12T13:00:10.000Z'),
            vault: vaultRoot,
          }),
        ).resolves.toEqual({ checked: 1, reconciled: 1 })
        current = (
          await readAssistantCronCanonicalRuntimeStore(paths)
        ).jobs.find((record) => record.jobId === source.automationId)
        expect(current?.state.pendingDeliveryIntentId).toBeUndefined()
        expect(current?.state.pendingOccurrenceAt).toBeNull()
        expect(current?.state.lastFailedAt).toBe(expectedLastFailedAt)
        expect(current?.state.lastSucceededAt).toBe(expectedLastSucceededAt)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    'outbox receipt repair',
    'outbox diagnostic persistence',
  ])('recovers a parent persisted before %s fails without a callback', async (
    failureStage,
  ) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-12T13:00:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-newsletter-post-write-failure-',
      )
      const occurrenceAt = '2026-07-12T13:00:00.000Z'
      const automationId = `automation-newsletter-${failureStage.replaceAll(' ', '-')}`
      const { claimed, paths, source } =
        await createClaimedNewsletterCronJob({
          automationId,
          occurrenceAt,
          vaultRoot,
        })
      const failure = new Error(
        `${failureStage} failed after the durable write`,
      )
      if (failureStage === 'outbox receipt repair') {
        vi.spyOn(
          assistantOutboxReceiptRepair,
          'repairAssistantOutboxReceiptForIntent',
        ).mockRejectedValueOnce(failure)
      } else {
        vi.spyOn(
          assistantDiagnostics,
          'recordAssistantDiagnosticEvent',
        ).mockRejectedValueOnce(failure)
      }
      cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async () => {
        const tool = createAssistantGroupEmailOutboxTool({
          automationAuthority: {
            automationId,
            expectedUpdatedAt: source.updatedAt,
          },
          authority: { automationId, occurrenceAt },
          groupTool: {
            request: async () => ({
              action: 'prepare_email',
              result: {
                authorizationProof: 'a'.repeat(64),
                groupId: 'group_1',
                missingEmailParticipants: [],
                participants: [{
                  authorizedShares: [],
                  hasEmail: true,
                  memberId: 'member_1',
                }],
                status: 'ok',
              },
            }),
          },
          sessionId: 'session_newsletter_post_write_failure',
          turnId: 'turn_newsletter_post_write_failure',
          vault: vaultRoot,
        })
        await tool.request({ action: 'prepare_email', projectionScopes: [] })
        await tool.request({
          action: 'send_email',
          html: '<p>Weekly</p>',
          subject: 'Weekly',
          text: 'Weekly',
        })
        throw new Error('Expected the injected post-write failure.')
      })

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
      expect(result.run).toMatchObject({
        error: failure.message,
        outcome: 'delivery_pending',
        reason: 'delivery_pending_after_error',
      })
      const intents = await listAssistantOutboxIntents(vaultRoot)
      expect(intents).toHaveLength(1)
      const current = (
        await readAssistantCronCanonicalRuntimeStore(paths)
      ).jobs.find((record) => record.jobId === source.automationId)
      expect(current?.state.pendingDeliveryIntentId).toBe(intents[0]?.intentId)
      expect(current?.state.pendingOccurrenceAt).toBe(occurrenceAt)
    } finally {
      vi.useRealTimers()
    }
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
          outcome: 'no_op',
          reason: 'no_delivery',
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
          outcome: 'expired',
          reason: 'late_occurrence',
          response: null,
          status: 'skipped',
        }),
      ],
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureContext: expect.objectContaining({
            automationSlug: 'expired-one-shot-reminder',
            latenessMinutes: 240,
          }),
          safeDetails: 'cron_occurrence_expired',
          type: 'cron.occurrence.expired',
        }),
        expect.objectContaining({
          failureContext: expect.objectContaining({
            errorPresent: true,
            runOutcome: 'expired',
            scheduleKind: 'at',
            sourceKind: 'automation',
          }),
          safeDetails: 'cron_job_expired',
          type: 'cron.job.completed',
        }),
      ]),
    )
  })

  it('does not invoke the provider when lifecycle consent is revoked before a progress wake', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-revoked-progress-consent-',
    )
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: null,
      automationId: 'automation-revoked-progress-consent',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Share the experiment progress milestone only with current consent.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: { at: '2026-04-08T09:00:00.000Z', kind: 'at' },
      slug: 'revoked-progress-consent',
      status: 'active',
      summary: null,
      tags: [
        'experiment',
        'progress-card',
        'milestone',
        'system:support-series:experiment-lifecycle:exp_progress_revoked',
      ],
      title: 'Revoked progress consent',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    cronMocks.runExperimentLifecycleOutcomePrecondition.mockResolvedValueOnce({
      kind: 'skip',
      reason: 'scheduled summary was not explicitly enabled',
    })

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 1, succeeded: 0 })

    expect(cronMocks.runExperimentLifecycleOutcomePrecondition).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(findCanonicalAutomation(
      vaultRoot,
      'automation-revoked-progress-consent',
    )?.status).toBe('archived')
  })

  it('blocks delivery when lifecycle consent is revoked while a progress response is generated', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-progress-consent-revoked-during-provider-',
    )
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: null,
      automationId: 'automation-progress-consent-revoked-during-provider',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Share progress only while scheduled-summary consent remains current.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: { at: '2026-04-08T09:00:00.000Z', kind: 'at' },
      slug: 'progress-consent-revoked-during-provider',
      status: 'active',
      summary: null,
      tags: [
        'experiment',
        'progress-card',
        'milestone',
        'system:support-series:experiment-lifecycle:exp_progress_revoked_late',
      ],
      title: 'Progress consent revoked during provider',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    cronMocks.runExperimentLifecycleOutcomePrecondition
      .mockResolvedValueOnce({ kind: 'continue' })
    cronMocks.runExperimentLifecycleDeliveryAuthorityPrecondition
      .mockResolvedValueOnce({
        kind: 'skip',
        reason: 'scheduled summary was not explicitly enabled',
      })
    let deliveryAttempted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
      }) => {
        await notificationInput.beforeDelivery?.({
          decision: {
            kind: 'send_message',
            privateSummary: 'Prepared progress update.',
            text: 'Here is your progress update.',
          },
          deliveryOutcome: null,
          response: 'Here is your progress update.',
        })
        deliveryAttempted = true
        throw new Error('Delivery should have been blocked after consent changed.')
      },
    )

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 1, succeeded: 0 })

    expect(cronMocks.runExperimentLifecycleOutcomePrecondition).toHaveBeenCalledOnce()
    expect(
      cronMocks.runExperimentLifecycleDeliveryAuthorityPrecondition,
    ).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(deliveryAttempted).toBe(false)
    expect(findCanonicalAutomation(
      vaultRoot,
      'automation-progress-consent-revoked-during-provider',
    )?.status).toBe('archived')
  })

  it('rechecks generic plan support authority after delivery and before durable commit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-generic-support-revoked-before-commit-',
    )
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: null,
      automationId: 'automation-generic-support-revoked-before-commit',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the accepted sleep-plan check-in only while it remains authorized.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: { at: '2026-04-08T09:00:00.000Z', kind: 'at' },
      slug: 'generic-support-revoked-before-commit',
      status: 'active',
      summary: null,
      tags: [
        'assistant',
        'scheduled',
        'system:support-series:habit:reg_sleep_support',
      ],
      title: 'Generic support revoked before commit',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    cronMocks.runExperimentLifecycleOutcomePrecondition
      .mockResolvedValueOnce({ kind: 'continue' })
    cronMocks.runExperimentLifecycleDeliveryAuthorityPrecondition
      .mockResolvedValueOnce({ kind: 'continue' })
      .mockResolvedValueOnce({
        kind: 'skip',
        reason: 'habit support owner status is paused',
      })
    let deliveryAttempted = false
    let commitCompleted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeCommit?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
      }) => {
        const context = {
          decision: {
            kind: 'send_message' as const,
            privateSummary: 'Prepared the accepted sleep-plan check-in.',
            text: 'How did the wind-down plan go?',
          },
          deliveryOutcome: null,
          response: 'How did the wind-down plan go?',
        }
        await notificationInput.beforeDelivery?.(context)
        deliveryAttempted = true
        await notificationInput.beforeCommit?.(context)
        commitCompleted = true
        return {
          ...context,
          session: { sessionId: 'session-generic-support-revocation' },
        }
      },
    )

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 1, succeeded: 0 })

    expect(cronMocks.runExperimentLifecycleOutcomePrecondition).toHaveBeenCalledOnce()
    expect(
      cronMocks.runExperimentLifecycleDeliveryAuthorityPrecondition,
    ).toHaveBeenCalledTimes(2)
    expect(deliveryAttempted).toBe(true)
    expect(commitCompleted).toBe(false)
    expect(
      findCanonicalAutomation(
        vaultRoot,
        'automation-generic-support-revoked-before-commit',
      )?.status,
    ).toBe('archived')
  })

  it('skips a claimed onboarding goal check-in when onboarding was completed again too recently', async () => {
    vi.useFakeTimers()
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-onboarding-goal-checkin-recompleted-',
    )
    const stableKey = 'vault-onboarding-goal-checkin-recompleted'
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'UTC',
        vaultId: stableKey,
      },
    })
    const initialOnboarding = await completeAssistantOnboarding({
      completedAt: '2026-07-01T14:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    const seed = buildOnboardingGoalCheckinSeed({
      now: new Date('2026-07-02T12:00:00.000Z'),
      onboardingState: initialOnboarding,
      stableKey,
      timeZone: 'UTC',
    })
    if (!seed || seed.schedule.kind !== 'at') {
      throw new Error('Expected an onboarding goal check-in seed.')
    }
    vi.setSystemTime(new Date(seed.schedule.at))
    getVaultAutomationStore(vaultRoot).push({
      ...seed,
      continuityPolicy: seed.continuityPolicy ?? 'preserve',
      createdAt: '2026-07-02T12:00:00.000Z',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'member-thread',
        identityId: null,
        participantId: null,
        threadId: 'member-thread',
        threadIsDirect: true,
      },
      status: 'active',
      tags: [...(seed.tags ?? [])],
      updatedAt: '2026-07-02T12:00:00.000Z',
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
    await completeAssistantOnboarding({
      completedAt: '2026-07-02T15:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'lifecycle_precondition',
      status: 'skipped',
    })
    expect(
      cronMocks.runExperimentLifecycleOutcomePrecondition,
    ).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(
      findCanonicalAutomation(
        vaultRoot,
        MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      )?.status,
    ).toBe('archived')
  })

  it('uses the ordinary notification path and blocks delivery when onboarding reopens during model work', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T13:30:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-onboarding-goal-checkin-reopened-',
    )
    await completeAssistantOnboarding({
      completedAt: '2025-11-03T14:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: '2026-07-13T13:30:00.000Z',
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      createdAt: '2026-07-01T12:00:00.000Z',
      instructions: 'Offer one low-pressure health direction choice.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'member-thread',
        identityId: null,
        participantId: null,
        threadId: 'member-thread',
        threadIsDirect: true,
      },
      schedule: { at: '2026-07-06T13:30:00.000Z', kind: 'at' },
      slug: 'onboarding-goal-checkin',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'First health direction check-in',
      updatedAt: '2026-07-01T12:00:00.000Z',
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
    let deliveryAttempted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        beforeProviderAcceptedInputs?: () => Promise<void>
      }) => {
        await notificationInput.beforeProviderAcceptedInputs?.()
        await reopenAssistantOnboarding({
          reopenedAt: '2026-07-06T13:30:01.000Z',
          vault: vaultRoot,
        })
        await notificationInput.beforeDelivery?.({
          decision: {
            kind: 'send_message',
            privateSummary: 'Prepared a health direction choice.',
            text: 'Does anything feel worth focusing on now?',
          },
          deliveryOutcome: null,
          response: 'Does anything feel worth focusing on now?',
        })
        deliveryAttempted = true
        throw new Error(
          'Delivery should have been blocked after onboarding reopened.',
        )
      },
    )

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'lifecycle_precondition',
      status: 'skipped',
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        turnPolicy: null,
      }),
    )
    expect(deliveryAttempted).toBe(false)
    expect(
      findCanonicalAutomation(
        vaultRoot,
        MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      )?.status,
    ).toBe('archived')
  })

  it.each([
    'initial',
    'pre-provider',
    'pre-tool',
    'pre-delivery',
    'pre-commit',
  ] as const)(
    'keeps an onboarding check-in retryable when authority is unreadable at the %s gate',
    async (failureGate) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-06T13:30:00.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-onboarding-authority-${failureGate}-`,
      )
      await completeAssistantOnboarding({
        completedAt: '2025-11-03T14:00:00.000Z',
        reason: 'user_answered',
        vault: vaultRoot,
      })
      getVaultAutomationStore(vaultRoot).push({
        activeUntil: '2026-07-13T13:30:00.000Z',
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        continuityPolicy: 'preserve',
        createdAt: '2026-07-01T12:00:00.000Z',
        instructions: 'Offer one low-pressure health direction choice.',
        route: {
          channel: 'telegram',
          deliverySource: null,
          deliveryTarget: 'member-thread',
          identityId: null,
          participantId: null,
          threadId: 'member-thread',
          threadIsDirect: true,
        },
        schedule: { at: '2026-07-06T13:30:00.000Z', kind: 'at' },
        slug: 'onboarding-goal-checkin',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled', 'murph-managed'],
        title: 'First health direction check-in',
        updatedAt: '2026-07-01T12:00:00.000Z',
      })
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
      const makeAuthorityUnreadable = async () => {
        await writeFile(
          resolveAssistantOnboardingStatePath(vaultRoot),
          '{ invalid onboarding json',
          'utf8',
        )
      }
      if (failureGate === 'initial') {
        await makeAuthorityUnreadable()
      } else {
        cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
          async (notificationInput: {
            beforeCommit?: (context: {
              decision: {
                kind: 'send_message'
                privateSummary: string
                text: string
              }
              deliveryOutcome: null
              response: string
            }) => Promise<void>
            beforeDelivery?: (context: {
              decision: {
                kind: 'send_message'
                privateSummary: string
                text: string
              }
              deliveryOutcome: null
              response: string
            }) => Promise<void>
            beforeProviderAcceptedInputs?: () => Promise<void>
            beforeToolExecution?: () => Promise<void>
          }) => {
            const context = {
              decision: {
                kind: 'send_message' as const,
                privateSummary: 'Prepared a health direction choice.',
                text: 'Does anything feel worth focusing on now?',
              },
              deliveryOutcome: null,
              response: 'Does anything feel worth focusing on now?',
            }
            if (failureGate === 'pre-provider') {
              await makeAuthorityUnreadable()
            }
            await notificationInput.beforeProviderAcceptedInputs?.()
            if (failureGate === 'pre-tool') {
              await makeAuthorityUnreadable()
            }
            await notificationInput.beforeToolExecution?.()
            if (failureGate === 'pre-delivery') {
              await makeAuthorityUnreadable()
            }
            await notificationInput.beforeDelivery?.(context)
            if (failureGate === 'pre-commit') {
              await makeAuthorityUnreadable()
            }
            await notificationInput.beforeCommit?.(context)
            return {
              ...context,
              session: { sessionId: 'session-onboarding-authority-retry' },
            }
          },
        )
      }

      const failed = await executeClaimedAssistantCronJob({
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(failed.removedAfterRun).toBe(false)
      expect(failed.run).toMatchObject({
        outcome: 'failed',
        reason: 'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
        status: 'failed',
      })
      expect(failed.runErrorCode).toBe(
        'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
      )
      expect(
        findCanonicalAutomation(
          vaultRoot,
          MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        )?.status,
      ).toBe('active')

      await completeAssistantOnboarding({
        completedAt: '2025-11-03T14:00:00.000Z',
        reason: 'user_answered',
        vault: vaultRoot,
      })
      const retryAt = failed.job.state.nextRunAt
      if (!retryAt) {
        throw new Error('Expected a retained next run for unavailable authority.')
      }
      vi.setSystemTime(new Date(retryAt))

      await expect(processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        processed: 1,
        succeeded: 1,
      })
      expect(
        findCanonicalAutomation(
          vaultRoot,
          MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        )?.status,
      ).toBe('archived')
    },
  )

  it('retries final-results lifecycle cleanup before stale one-shot expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:59:50.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-final-results-cleanup-retry-',
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'final results cleanup retry',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Share the final experiment results.',
      schedule: {
        kind: 'at',
        at: '2026-04-08T10:00:00.000Z',
      },
      vault: vaultRoot,
    })
    const automation = getVaultAutomationStore(vaultRoot).find(
      (record) => record.automationId === canonicalJob.jobId,
    )
    if (!automation) {
      throw new Error('Expected the final-results automation fixture.')
    }
    automation.tags = [...automation.tags, 'experiment', 'final-results']
    cronMocks.runExperimentLifecycleOutcomePrecondition
      .mockRejectedValueOnce(new Error('archive failed'))
      .mockResolvedValueOnce({ kind: 'continue' })

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    const failedStore = await readAssistantCronCanonicalRuntimeStore(
      resolveAssistantStatePaths(vaultRoot),
    )
    const failedRecord = failedStore.jobs.find(
      (record) => record.jobId === canonicalJob.jobId,
    )
    expect(failedRecord?.state.pendingOccurrenceAt).toBe(
      '2026-04-08T10:00:00.000Z',
    )
    expect(failedRecord?.state.retryAfterAt).toBe(
      '2026-04-08T11:00:20.000Z',
    )
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-04-08T11:00:20.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })

    expect(
      cronMocks.runExperimentLifecycleOutcomePrecondition,
    ).toHaveBeenCalledTimes(2)
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
    await expect(listAssistantCronRuns({
      job: canonicalJob.jobId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({
          error: 'archive failed',
          status: 'failed',
        }),
        expect.objectContaining({
          outcome: 'expired',
          status: 'skipped',
        }),
      ]),
    })
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
            runOutcome: 'failed',
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

  it('consumes non-retryable delivery failures for scheduled canonical reminders', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-terminal-delivery-failure-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'terminal delivery reminder',
    )
    const error = Object.assign(
      new Error('Hosted Linq egress authority assertion request failed.'),
      {
        code: 'HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH',
        details: {
          assistantNotificationStage: 'delivery',
        },
        retryable: false,
      },
    )
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(error)

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find((record) =>
      record.jobId === canonicalJob.jobId
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    expect(runtimeRecord?.state.lastFailedAt).toBe('2026-04-08T10:00:00.000Z')
    expect(runtimeRecord?.state.lastError).toBe(
      'Hosted Linq egress authority assertion request failed.',
    )
    expect(runtimeRecord?.state.consecutiveFailures).toBe(0)
    await expect(
      listAssistantCronRuns({
        job: canonicalJob.jobId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: canonicalJob.jobId,
      runs: [
        expect.objectContaining({
          error: 'Hosted Linq egress authority assertion request failed.',
          status: 'failed',
        }),
      ],
    })
  })

  it('retries a finite required one-shot after a direct non-retryable delivery failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-required-direct-delivery-retry-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'required direct delivery retry',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Deliver the bounded final check-in.',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      vault: vaultRoot,
    })
    const automation = findCanonicalAutomation(vaultRoot, canonicalJob.jobId)
    if (!automation) {
      throw new Error('Expected the required-delivery automation fixture.')
    }
    automation.activeUntil = '2026-04-15T09:00:00.000Z'
    automation.tags.push('system:assistant-require-send')
    const deliveryError = Object.assign(
      new Error('Hosted Linq egress authority assertion request failed.'),
      {
        code: 'HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH',
        details: {
          assistantNotificationStage: 'delivery',
        },
        retryable: false,
      },
    )
    cronMocks.sendAssistantMessageLocal
      .mockRejectedValueOnce(deliveryError)
      .mockResolvedValueOnce({
        deliveryOutcome: {
          delivery: {
            channel: 'telegram',
            sentAt: '2026-04-08T09:10:30.000Z',
            target: 'room-1',
            targetKind: 'thread',
          },
          intentId: 'outbox_required_direct_delivery_retry',
          kind: 'sent',
          media: [],
          session: { sessionId: 'session-required-direct-delivery-retry' },
        },
        response: 'Here is the bounded final check-in.',
        session: { sessionId: 'session-required-direct-delivery-retry' },
      })

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 1, processed: 1, succeeded: 0 })

    const failedStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const failedRecord = failedStore.jobs.find(
      (record) => record.jobId === canonicalJob.jobId,
    )
    expect(failedRecord?.state).toMatchObject({
      consecutiveFailures: 1,
      lastFailedAt: '2026-04-08T09:10:00.000Z',
      pendingOccurrenceAt: '2026-04-08T09:00:00.000Z',
      retryAfterAt: '2026-04-08T09:10:30.000Z',
    })
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'active',
    )

    vi.setSystemTime(new Date('2026-04-08T09:10:30.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 1, succeeded: 1 })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(2)
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'archived',
    )
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
  })

  it.each([
    ['ambiguous delivery', 'ASSISTANT_DELIVERY_AMBIGUOUS'],
    ['confirmation-pending delivery', 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING'],
    ['retry-exhausted delivery', 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED'],
  ])('does not replace a terminal %s with a fresh required-send intent', async (
    _label,
    code,
  ) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      `assistant-cron-runtime-required-direct-terminal-${code.toLowerCase()}-`,
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: `required direct terminal ${code}`,
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Deliver the bounded final check-in.',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      vault: vaultRoot,
    })
    const automation = findCanonicalAutomation(vaultRoot, canonicalJob.jobId)
    if (!automation) {
      throw new Error('Expected the required-delivery automation fixture.')
    }
    automation.activeUntil = '2026-04-15T09:00:00.000Z'
    automation.tags.push('system:assistant-require-send')
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(Object.assign(
      new Error(`Terminal delivery outcome: ${code}`),
      {
        code,
        details: {
          assistantNotificationStage: 'delivery',
        },
        retryable: false,
      },
    ))

    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 1, processed: 1, succeeded: 0 })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'archived',
    )
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])

    vi.setSystemTime(new Date('2026-04-08T09:10:30.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
  })

  it('keeps hosted control-plane 5xx delivery failures retryable for scheduled canonical reminders', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-transient-delivery-failure-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'transient delivery reminder',
    )
    const error = Object.assign(
      new Error('Hosted Linq egress engagement failed with HTTP 500. Internal error.'),
      {
        code: 'INTERNAL_ERROR',
        details: {
          assistantNotificationStage: 'delivery',
        },
        statusCode: 500,
      },
    )
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(error)

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find((record) =>
      record.jobId === canonicalJob.jobId
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBe(
      '2026-04-08T10:00:00.000Z',
    )
    expect(runtimeRecord?.state.retryAfterAt).toBe('2026-04-08T10:00:30.000Z')
    expect(runtimeRecord?.state.lastFailedAt).toBe('2026-04-08T10:00:00.000Z')
    expect(runtimeRecord?.state.lastError).toBe(
      'Hosted Linq egress engagement failed with HTTP 500. Internal error.',
    )
    expect(runtimeRecord?.state.consecutiveFailures).toBe(1)
  })

  it('retries the same scheduled occurrence and session after a provider-stage failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-provider-resume-retry-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'provider resume retry reminder',
    )
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      sessionId: 'session-provider-resume-retry',
    }))
    const providerError = Object.assign(
      new Error('Provider turn failed after resume-state finalization.'),
      {
        details: {
          assistantNotificationStage: 'provider',
        },
      },
    )
    cronMocks.sendAssistantMessageLocal
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({
        decision: {
          kind: 'skip',
          privateSummary: 'Retry completed without delivery.',
        },
        response: null,
        session: {
          sessionId: 'session-provider-resume-retry',
        },
      })

    await expect(
      processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    const failedStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const failedRecord = failedStore.jobs.find((record) =>
      record.jobId === canonicalJob.jobId
    )
    expect(failedRecord?.state.pendingOccurrenceAt).toBe(
      '2026-04-08T10:00:00.000Z',
    )
    expect(failedRecord?.state.retryAfterAt).toBe(
      '2026-04-08T10:00:30.000Z',
    )

    vi.setSystemTime(new Date('2026-04-08T10:00:30.000Z'))
    await expect(
      processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 1,
    })
    const recoveredStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const recoveredRecord = recoveredStore.jobs.find((record) =>
      record.jobId === canonicalJob.jobId
    )
    expect(recoveredRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(recoveredRecord?.state.retryAfterAt).toBeNull()
    expect(recoveredRecord?.state.consecutiveFailures).toBe(0)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(2)
    for (const [notificationInput] of
      cronMocks.sendAssistantMessageLocal.mock.calls) {
      expect(notificationInput.sessionId).toBe(
        'session-provider-resume-retry',
      )
    }
  })

  it('advances consumed canonical delivery failures after an older success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T10:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-terminal-delivery-after-success-',
    )
    const paths = resolveAssistantStatePaths(vaultRoot)
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'terminal delivery after success',
    )
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      updatedAt: '2026-04-08T10:00:05.000Z',
      state: {
        ...record.state,
        lastRunAt: '2026-04-08T10:00:05.000Z',
        lastSucceededAt: '2026-04-08T10:00:05.000Z',
        lastError: null,
        consecutiveFailures: 0,
      },
    }))
    const error = Object.assign(
      new Error('Hosted Linq egress authority assertion request failed.'),
      {
        code: 'HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH',
        details: {
          assistantNotificationStage: 'delivery',
        },
        retryable: false,
      },
    )
    cronMocks.sendAssistantMessageLocal.mockRejectedValueOnce(error)

    const summary = await processDueAssistantCronJobsLocal({
      limit: 1,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 1,
      processed: 1,
      succeeded: 0,
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find((record) =>
      record.jobId === canonicalJob.jobId
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt).toBeNull()
    expect(runtimeRecord?.state.lastSucceededAt).toBe('2026-04-08T10:00:05.000Z')
    expect(runtimeRecord?.state.lastFailedAt).toBe('2026-04-09T10:00:00.000Z')
    expect(runtimeRecord?.state.consecutiveFailures).toBe(0)
    const projected = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(projected.state.nextRunAt).toBe('2026-04-10T10:00:00.000Z')
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
        instructions: expect.stringContaining('First-session prep reminder.'),
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
        instructions: expect.stringContaining('First-session prep reminder.'),
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

  it('archives recurring automations exactly at activeUntil across a DST fallback', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T05:59:59.999Z'))
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-active-until-dst-',
    )
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: '2026-11-01T06:00:00.000Z',
      automationId: 'automation-active-until-dst',
      continuityPolicy: 'preserve',
      createdAt: '2026-10-31T13:00:00.000Z',
      instructions: 'Send a bounded daily check-in.',
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
        localTime: '09:00',
      },
      slug: 'active-until-dst',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'DST-bounded reminder',
      updatedAt: '2026-10-31T13:00:00.000Z',
    })

    await expect(processDueAssistantCronJobsLocal({ vault: vaultRoot })).resolves.toEqual({
      failed: 0,
      processed: 0,
      succeeded: 0,
    })

    vi.setSystemTime(new Date('2026-11-01T06:00:00.000Z'))
    await expect(processDueAssistantCronJobsLocal({ vault: vaultRoot })).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })

    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    expect(findCanonicalAutomation(vaultRoot, 'automation-active-until-dst')?.status)
      .toBe('archived')
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
    expect(cronMocks.executeScheduledLogOccurrence).toHaveBeenCalledWith(expect.objectContaining({
      beforeWrite: expect.any(Function),
      occurrenceAt: '2026-04-08T09:00:00.000Z',
      scheduledLogId: 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBC',
      vaultRoot,
    }))
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

  it('yields canonical scheduled-log cron before writing when foreground work appears after claim', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:00:00.000Z'))
    try {
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-yield-scheduled-log-',
      )
      const scheduledLogId = 'slog_01JX8VCQY2M5ZBV64ZP4N1DRBD'
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
        relativePath: 'bank/scheduled-logs/morning-measurement-yield.md',
        schedule: {
          at: '2026-04-08T09:00:00.000Z',
          kind: 'at',
        },
        schemaVersion: 'murph.frontmatter.scheduled-log.v1',
        scheduledLogId,
        slug: 'morning-measurement-yield',
        status: 'active',
        summary: 'Record the morning measurement.',
        tags: ['measurement'],
        title: 'Morning measurement',
        updatedAt: '2026-04-08T08:00:00.000Z',
      })
      let shouldYield = false
      let scheduledEventWriteAttempted = false
      cronMocks.executeScheduledLogOccurrence.mockImplementationOnce(async (input: {
        beforeWrite?: () => Promise<void> | void
      }) => {
        shouldYield = true
        await input.beforeWrite?.()
        scheduledEventWriteAttempted = true
        return {
          message: 'Unexpected scheduled event write.',
        }
      })

      const summary = await processDueAssistantCronJobsLocal({
        limit: 1,
        shouldYield: () => shouldYield,
        vault: vaultRoot,
      })

      expect(summary).toEqual({
        failed: 1,
        processed: 1,
        succeeded: 0,
      })
      expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
      expect(cronMocks.executeScheduledLogOccurrence).toHaveBeenCalledWith(expect.objectContaining({
        beforeWrite: expect.any(Function),
        occurrenceAt: '2026-04-08T09:00:00.000Z',
        scheduledLogId,
        vaultRoot,
      }))
      expect(scheduledEventWriteAttempted).toBe(false)
      expect(cronMocks.setScheduledLogStatus).not.toHaveBeenCalled()
      await expect(
        listAssistantCronRuns({
          job: scheduledLogId,
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        jobId: scheduledLogId,
        runs: [{
          error: 'Assistant cron yielded to fresh foreground input.',
          status: 'failed',
        }],
      })

      const current = await getAssistantCronJob(vaultRoot, scheduledLogId)
      expect(current.state.runningAt).toBeNull()
      expect(current.state.lastFailedAt).toBeNull()
      expect(current.state.consecutiveFailures).toBe(0)
      expect(current.state.nextRunAt).toBe('2026-04-08T13:00:10.000Z')
      const runtimeStore = await readAssistantCronCanonicalRuntimeStore(
        resolveAssistantStatePaths(vaultRoot),
      )
      const runtimeRecord = runtimeStore.jobs.find((record) =>
        record.jobId === scheduledLogId
      )
      expect(runtimeRecord?.state.pendingOccurrenceAt).toBe('2026-04-08T09:00:00.000Z')
      expect(runtimeRecord?.state.retryAfterAt).toBe('2026-04-08T13:00:10.000Z')
    } finally {
      vi.useRealTimers()
    }
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

  it('derives the durable scheduled-delivery cohort from every job processed in one pass', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-queued-intent-ids-',
    )
    const firstJob = await createCanonicalJob(vaultRoot, 'queued-first')
    const secondJob = await createCanonicalJob(vaultRoot, 'queued-second')
    await updateCanonicalRuntimeState(vaultRoot, firstJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T07:58:00.000Z',
      },
    }))
    await updateCanonicalRuntimeState(vaultRoot, secondJob.jobId, (record) => ({
      ...record,
      state: {
        ...record.state,
        pendingOccurrenceAt: '2026-04-08T07:59:00.000Z',
      },
    }))

    const queuedIntentIds = ['outbox_queued_first', 'outbox_queued_second']
    let sendCall = 0
    cronMocks.sendAssistantMessageLocal.mockImplementation(async (input: {
      onProviderRequestStarted?: () => Promise<void> | void
    }) => {
      await input.onProviderRequestStarted?.()
      const intentId = queuedIntentIds[sendCall] ?? 'outbox_queued_overflow'
      sendCall += 1
      await saveAssistantOutboxIntent(
        vaultRoot,
        buildTestLinqOutboxIntent({
          createdAt: '2026-04-08T08:10:00.000Z',
          intentId,
        }),
      )
      return {
        decision: {
          kind: 'send_message' as const,
          privateSummary: 'Queued scheduled reminder.',
          text: `Reminder ${intentId}.`,
        },
        deliveryOutcome: {
          kind: 'queued' as const,
          error: null,
          intentId,
          session: {
            sessionId: 'session-default',
          },
        },
        response: `Reminder ${intentId}.`,
        session: {
          sessionId: 'session-default',
        },
      }
    })

    const summary = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 5,
      vault: vaultRoot,
    })

    expect(summary).toEqual({
      failed: 0,
      processed: 2,
      succeeded: 0,
    })

    const updatedFirst = await getAssistantCronJob(vaultRoot, firstJob.jobId)
    expect(updatedFirst.state.pendingDeliveryIntentId).toBe(queuedIntentIds[0])
    expect(updatedFirst.state.nextRunAt).toBeNull()
    const updatedSecond = await getAssistantCronJob(vaultRoot, secondJob.jobId)
    expect(updatedSecond.state.pendingDeliveryIntentId).toBe(queuedIntentIds[1])
    expect(updatedSecond.state.nextRunAt).toBeNull()

    // The cohort is derived from durable owner state, so any later pass can
    // reconstruct it without pass-local bookkeeping.
    await expect(
      listAssistantCronPendingDeliveryIntentIds(vaultRoot),
    ).resolves.toEqual(expect.arrayContaining(queuedIntentIds))
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
        instructions: expect.stringContaining('Check in for stale-canonical'),
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

  it('does not deliver or overwrite an automation paused after its occurrence was claimed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-paused-after-claim-',
    )
    await createCanonicalJob(vaultRoot, 'paused-after-claim')
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
    cronMocks.upsertAutomation.mockClear()
    let deliveryAttempted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
        onProviderRequestStarted?: () => Promise<void> | void
      }) => {
        await notificationInput.onProviderRequestStarted?.()
        const current = findCanonicalAutomation(vaultRoot, claimed.job.jobId)
        if (!current) {
          throw new Error('Expected claimed automation to remain present.')
        }
        current.status = 'paused'
        current.updatedAt = '2026-04-08T10:20:01.000Z'
        await notificationInput.beforeDelivery?.({
          decision: {
            kind: 'send_message',
            privateSummary: 'Prepared a reminder.',
            text: 'Prepared reminder text.',
          },
          deliveryOutcome: null,
          response: 'Prepared reminder text.',
        })
        deliveryAttempted = true
        throw new Error('Delivery should have been blocked by the authority check.')
      },
    )

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      notificationDecision: {
        kind: 'send_message',
        reasonCode: 'provider_send_message',
      },
      outcome: 'skipped_gate',
      reason: 'canonical_source_inactive',
      scheduledOccurrenceAt: claimed.job.state.nextRunAt,
      status: 'skipped',
    })
    expect(deliveryAttempted).toBe(false)
    expect(findCanonicalAutomation(vaultRoot, claimed.job.jobId)?.status).toBe('paused')
    expect(cronMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('does not deliver or overwrite an automation edited after its occurrence was claimed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-edited-after-claim-',
    )
    await createCanonicalJob(vaultRoot, 'edited-after-claim')
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
    cronMocks.upsertAutomation.mockClear()
    let deliveryAttempted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
      }) => {
        const current = findCanonicalAutomation(vaultRoot, claimed.job.jobId)
        if (!current) {
          throw new Error('Expected claimed automation to remain present.')
        }
        current.instructions = 'Use the newly edited reminder instructions.'
        current.updatedAt = '2026-04-08T10:20:01.000Z'
        await notificationInput.beforeDelivery?.({
          decision: {
            kind: 'send_message',
            privateSummary: 'Prepared the stale reminder.',
            text: 'Prepared stale reminder text.',
          },
          deliveryOutcome: null,
          response: 'Prepared stale reminder text.',
        })
        deliveryAttempted = true
        throw new Error('Delivery should have been blocked by the authority check.')
      },
    )

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'canonical_source_changed',
      status: 'skipped',
    })
    expect(result.removedAfterRun).toBe(false)
    expect(deliveryAttempted).toBe(false)
    expect(findCanonicalAutomation(vaultRoot, claimed.job.jobId)).toMatchObject({
      instructions: 'Use the newly edited reminder instructions.',
      status: 'active',
      updatedAt: '2026-04-08T10:20:01.000Z',
    })
    expect(cronMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('does not deliver and clears runtime state when an automation is removed after claim', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-removed-after-claim-',
    )
    await createCanonicalJob(vaultRoot, 'removed-after-claim')
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)
    cronMocks.upsertAutomation.mockClear()
    let deliveryAttempted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(
      async (notificationInput: {
        beforeDelivery?: (context: {
          decision: {
            kind: 'send_message'
            privateSummary: string
            text: string
          }
          deliveryOutcome: null
          response: string
        }) => Promise<void>
      }) => {
        const records = getVaultAutomationStore(vaultRoot)
        const index = records.findIndex(
          (record) => record.automationId === claimed.job.jobId,
        )
        expect(index).toBeGreaterThanOrEqual(0)
        records.splice(index, 1)
        await notificationInput.beforeDelivery?.({
          decision: {
            kind: 'send_message',
            privateSummary: 'Prepared the removed reminder.',
            text: 'Prepared removed reminder text.',
          },
          deliveryOutcome: null,
          response: 'Prepared removed reminder text.',
        })
        deliveryAttempted = true
        throw new Error('Delivery should have been blocked by the authority check.')
      },
    )

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'canonical_source_inactive',
      status: 'skipped',
    })
    expect(result.removedAfterRun).toBe(true)
    expect(deliveryAttempted).toBe(false)
    expect(findCanonicalAutomation(vaultRoot, claimed.job.jobId)).toBeUndefined()
    expect(cronMocks.upsertAutomation).not.toHaveBeenCalled()
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    expect(runtimeStore.jobs.some((record) => record.jobId === claimed.job.jobId))
      .toBe(false)
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
        scheduledOccurrenceAt: '2026-04-08T10:00:00.000Z',
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

  it('executes hosted email targets through their trusted reply envelope binding', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-email-current-route-binding-',
    )
    const deliveryTarget = serializeHostedEmailThreadTarget({
      cc: [],
      lastMessageId: '<latest@example.test>',
      references: ['<first@example.test>'],
      subject: 'Re: Group check-in',
      to: ['group@example.test'],
    })
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-email-current-route-binding',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the group check-in reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget,
        identityId: 'email-sender-identity',
        participantId: null,
        threadId: 'stable-email-thread',
        threadIsDirect: false,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'email-current-route-binding-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Email current route binding reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
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
        job: projectCanonicalAssistantCronJob({ source, runtimeState }),
      },
      paths,
    })
    const result = await executeClaimedAssistantCronJob({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-email-current-route',
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: deliveryTarget,
        channel: 'email',
        deliveryKind: undefined,
        deliveryTarget,
        identityId: 'email-sender-identity',
        threadId: 'stable-email-thread',
        threadIsDirect: false,
      }),
    )
  })

  it.each([
    ['static', MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID],
    ['dynamic onboarding', MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID],
  ] as const)(
    'skips a %s member managed automation on a group route before lifecycle or model work',
    async (_kind, automationId) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-12T18:10:00.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-member-owner-group-rejection-',
      )
      getVaultAutomationStore(vaultRoot).push({
        automationId,
        continuityPolicy: 'fresh',
        createdAt: '2026-04-12T16:00:00.000Z',
        instructions: 'Send the member-owned managed message.',
        route: {
          channel: 'telegram',
          deliverySource: null,
          deliveryTarget: 'wrong-member-group-room',
          identityId: null,
          participantId: null,
          threadId: 'wrong-member-group-room',
          threadIsDirect: false,
        },
        schedule: { at: '2026-04-12T18:00:00.000Z', kind: 'at' },
        slug: 'member-managed-owner-check',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled', 'murph-managed'],
        title: 'Member-owned managed message',
        updatedAt: '2026-04-12T16:00:00.000Z',
      })
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

      const result = await executeClaimedAssistantCronJob({
        executionContext: {
          hosted: { memberId: 'member-owner-group-rejection', userEnvKeys: [] },
        },
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.run).toMatchObject({
        outcome: 'skipped_gate',
        reason: 'managed_owner_scope_mismatch',
        status: 'skipped',
      })
      expect(cronMocks.runExperimentLifecycleOutcomePrecondition).not.toHaveBeenCalled()
      expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    },
  )

  it('does not archive an ordinary one-shot carrying a copied managed tag at the onboarding gate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-copied-managed-tag-one-shot-',
    )
    addManagedResearchAutomation({
      automationId: 'automation-copied-managed-tag-one-shot',
      tag: 'murph-managed:weekly-health-insight',
      vaultRoot,
    })
    const automation = findCanonicalAutomation(
      vaultRoot,
      'automation-copied-managed-tag-one-shot',
    )
    if (!automation) {
      throw new Error('Expected the copied-tag automation to exist.')
    }
    automation.schedule = {
      at: '2026-04-08T10:00:00.000Z',
      kind: 'at',
    }
    const providerStarted = vi.fn()
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
      onProviderRequestStarted?: () => Promise<void> | void
    }) => {
      await input.onProviderRequestStarted?.()
      providerStarted()
      throw new VaultCliError(
        'ASSISTANT_TEST_PROVIDER_FAILURE',
        'Provider failed after admission.',
        { retryable: true },
      )
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(providerStarted).toHaveBeenCalledOnce()
    expect(result.run.status).toBe('failed')
    expect(
      findCanonicalAutomation(vaultRoot, claimed.job.jobId)?.status,
    ).toBe('active')
  })

  it.each([
    ['static group from an unspecified route', MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID, undefined, 'mismatch'],
    ['static group from a direct route', MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID, true, 'mismatch'],
    ['static direct chat from an unspecified route', MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID, undefined, 'direct'],
    ['dynamic onboarding direct chat from an old route', MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID, true, 'direct'],
  ] as const)(
    'enforces a member managed automation when live Linq authority resolves a %s',
    async (_label, automationId, savedThreadIsDirect, liveAuthority) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-12T18:10:00.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        'assistant-cron-runtime-member-owner-live-group-rejection-',
      )
      if (automationId === MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID) {
        await completeAssistantOnboarding({
          completedAt: '2025-11-03T14:00:00.000Z',
          reason: 'user_answered',
          vault: vaultRoot,
        })
      }
      getVaultAutomationStore(vaultRoot).push({
        automationId,
        continuityPolicy:
          automationId === MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID
            ? 'preserve'
            : 'fresh',
        createdAt: '2026-04-12T16:00:00.000Z',
        instructions: 'Send product notes.',
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'saved-member-chat',
          identityId: null,
          participantId: null,
          threadId: 'saved-member-chat',
          ...(savedThreadIsDirect === undefined
            ? {}
            : { threadIsDirect: savedThreadIsDirect }),
        },
        schedule: { at: '2026-04-12T18:00:00.000Z', kind: 'at' },
        slug: 'weekly-product-updates',
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled', 'murph-managed'],
        title: 'Murph product notes',
        updatedAt: '2026-04-12T16:00:00.000Z',
      })
      const resolveScheduledLinqRoute = liveAuthority === 'mismatch'
        ? vi.fn().mockRejectedValue(new VaultCliError(
            'HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH',
            'Linq egress target does not match the runtime user route.',
            { retryable: false },
          ))
        : vi.fn().mockResolvedValue({
            conversationThreadId: 'hid_live_member_chat',
            target: 'live-member-chat',
            threadIsDirect: true,
          })
      const createScheduledGroupTools = vi.fn()
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

      const result = await executeClaimedAssistantCronJob({
        executionContext: {
          hosted: {
            createScheduledGroupTools,
            memberId: 'member-owner-live-group-rejection',
            resolveScheduledLinqRoute,
            userEnvKeys: [],
          },
        },
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          homeRouteFallbackAllowed: true,
          target: 'saved-member-chat',
          targetKind: 'explicit',
        }),
      )
      expect(createScheduledGroupTools).not.toHaveBeenCalled()
      if (liveAuthority === 'direct') {
        expect(result.run).toMatchObject({
          outcome: 'no_op',
          reason: 'no_delivery',
          status: 'succeeded',
        })
        expect(cronMocks.runExperimentLifecycleOutcomePrecondition).toHaveBeenCalled()
        expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
          expect.objectContaining({
            bindingDeliveryTarget: 'live-member-chat',
            deliveryTarget: 'live-member-chat',
            threadId: 'hid_live_member_chat',
            threadIsDirect: true,
          }),
        )
      } else {
        expect(result.run).toMatchObject({
          outcome: 'skipped_gate',
          reason: 'managed_owner_scope_mismatch',
          status: 'skipped',
        })
        expect(cronMocks.runExperimentLifecycleOutcomePrecondition).not.toHaveBeenCalled()
        expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
        const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
        const runtimeRecord = runtimeStore.jobs.find(
          (record) => record.jobId === automationId,
        )
        expect(runtimeRecord?.state.pendingOccurrenceAt ?? null).toBeNull()
        expect(runtimeRecord?.state.retryAfterAt ?? null).toBeNull()
      }
    },
  )

  it('reuses the admitted static member route and rejects a live-route change before provider work', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T18:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-member-owner-live-route-change-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      createdAt: '2026-04-12T16:00:00.000Z',
      instructions: 'Send product notes.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'saved-member-chat',
        identityId: null,
        participantId: null,
        threadId: null,
        threadIsDirect: true,
      },
      schedule: { at: '2026-04-12T18:00:00.000Z', kind: 'at' },
      slug: 'weekly-product-updates',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Murph product notes',
      updatedAt: '2026-04-12T16:00:00.000Z',
    })
    const resolveScheduledLinqRoute = vi.fn()
      .mockResolvedValueOnce({
        conversationThreadId: 'hid_admitted_member_chat',
        target: 'admitted-member-chat',
        threadIsDirect: true,
      })
      .mockRejectedValueOnce(new VaultCliError(
        'HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH',
        'Linq egress target does not match the runtime user route.',
        { retryable: false },
      ))
    const createScheduledGroupTools = vi.fn()
    let providerInputsAccepted = false
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input: {
      beforeProviderAcceptedInputs?: () => Promise<void>
      bindingDeliveryTarget?: string
      deliveryTarget?: string | null
      threadIsDirect?: boolean | null
    }) => {
      expect(input).toMatchObject({
        bindingDeliveryTarget: 'admitted-member-chat',
        deliveryTarget: 'admitted-member-chat',
        threadId: 'hid_admitted_member_chat',
        threadIsDirect: true,
      })
      await input.beforeProviderAcceptedInputs?.()
      providerInputsAccepted = true
      return {
        response: 'Completed scheduled check-in.',
        session: { sessionId: 'session-default' },
      }
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          createScheduledGroupTools,
          memberId: 'member-owner-live-route-change',
          resolveScheduledLinqRoute,
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'managed_owner_scope_mismatch',
      status: 'skipped',
    })
    expect(resolveScheduledLinqRoute).toHaveBeenCalledTimes(2)
    expect(createScheduledGroupTools).not.toHaveBeenCalled()
    expect(providerInputsAccepted).toBe(false)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const runtimeRecord = runtimeStore.jobs.find(
      (record) =>
        record.jobId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    expect(runtimeRecord?.state.pendingOccurrenceAt ?? null).toBeNull()
    expect(runtimeRecord?.state.retryAfterAt ?? null).toBeNull()
  })

  it('skips a static group managed automation on a direct route before lifecycle or model work', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T18:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-group-owner-direct-rejection-',
    )
    addGroupRoomModelConsolidationAutomation(vaultRoot)
    const automation = getVaultAutomationStore(vaultRoot)[0]
    if (!automation) {
      throw new Error('Expected the group room-model automation.')
    }
    automation.route = {
      channel: 'telegram',
      deliverySource: null,
      deliveryTarget: 'direct-room',
      identityId: null,
      participantId: null,
      threadId: 'direct-room',
      threadIsDirect: true,
    }
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          memberId: 'group-owner-direct-rejection',
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'managed_owner_scope_mismatch',
      status: 'skipped',
    })
    expect(cronMocks.runExperimentLifecycleOutcomePrecondition).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
  })

  it('skips a persisted Sunday superlatives occurrence after the seed is retired', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T18:10:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-retired-sunday-superlatives-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation_01K55N7S9X4Q2M6P8R3T0V1WYZ',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-12T16:00:00.000Z',
      instructions: 'Legacy Sunday group recap.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: 'legacy-group-room',
        identityId: null,
        participantId: null,
        threadId: 'legacy-group-room',
        threadIsDirect: false,
      },
      schedule: { at: '2026-04-12T18:00:00.000Z', kind: 'at' },
      slug: 'group-sunday-superlatives',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Sunday group superlatives',
      updatedAt: '2026-04-12T16:00:00.000Z',
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: { memberId: 'retired-group-runtime', userEnvKeys: [] },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'skipped_gate',
      reason: 'managed_automation_retired',
      status: 'skipped',
    })
    expect(cronMocks.runExperimentLifecycleOutcomePrecondition).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
  })

  it.each([
    {
      currentRouteSnapshot: undefined,
      label: 'without the retired route marker',
    },
    {
      currentRouteSnapshot: true,
      label: 'with the retired route marker',
    },
  ] as const)('authorizes a legacy bare Linq target $label and records a successful cron run', async ({
    currentRouteSnapshot,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-legacy-linq-authorized-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-legacy-linq-authorized',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the reminder.',
      route: {
        channel: 'linq',
        ...(currentRouteSnapshot === true ? { currentRouteSnapshot } : {}),
        deliverySource: null,
        deliveryTarget: 'saved-home-chat',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'legacy-linq-authorized-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Legacy Linq authorized reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const resolveScheduledLinqRoute = vi.fn().mockResolvedValue({
      conversationThreadId: 'hid_current_home_chat',
      target: 'current-home-chat',
      threadIsDirect: true,
    })
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
        job: projectCanonicalAssistantCronJob({ source, runtimeState }),
      },
      paths,
    })
    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          memberId: 'member-legacy-linq-authorized',
          resolveScheduledLinqRoute,
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.removedAfterRun).toBe(true)
    expect(result.run).toMatchObject({
      outcome: 'no_op',
      status: 'succeeded',
    })
    expect(result.runErrorCode).toBeNull()
    expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: true,
        target: 'saved-home-chat',
        targetKind: 'explicit',
      }),
    )
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'current-home-chat',
        deliveryTarget: 'current-home-chat',
        threadId: 'hid_current_home_chat',
        threadIsDirect: true,
      }),
    )
  })

  it('skips a scheduled Linq turn before model work when health blocks the route', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-linq-health-blocked-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-linq-health-blocked',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the reminder.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'saved-home-chat',
        identityId: null,
        participantId: null,
        threadId: null,
        threadIsDirect: true,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'linq-health-blocked-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Health-blocked Linq reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const resolveScheduledLinqRoute = vi.fn().mockResolvedValue({
      deliveryBlockCode: 'chat_critical',
      target: 'saved-home-chat',
      threadIsDirect: true,
    })
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          memberId: 'member-linq-health-blocked',
          resolveScheduledLinqRoute,
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      error: 'Scheduled Linq delivery skipped by current line or chat health.',
      outcome: 'skipped_gate',
      reason: 'linq_health_preflight',
      status: 'skipped',
    })
    expect(result.runErrorCode).toBe('ASSISTANT_LINQ_EGRESS_CHAT_CRITICAL')
    expect(resolveScheduledLinqRoute).toHaveBeenCalledOnce()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
  })

  it('resolves hosted Linq participant automations to the current home thread', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-linq-participant-authority-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-linq-participant-authority',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the reminder.',
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
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'linq-participant-authority-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Linq participant authority reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const resolveScheduledLinqRoute = vi.fn().mockResolvedValue({
      conversationThreadId: 'hid_current_home_chat',
      target: 'current-home-chat',
      threadIsDirect: true,
    })
    const createScheduledGroupTools = vi.fn()
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          createScheduledGroupTools,
          memberId: 'member-linq-participant-authority',
          resolveScheduledLinqRoute,
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: '+15550001111',
        homeRouteFallbackAllowed: true,
        target: '+15550002222',
        targetKind: 'explicit',
      }),
    )
    expect(createScheduledGroupTools).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'current-home-chat',
        deliveryKind: 'thread',
        deliveryTarget: null,
        threadId: 'hid_current_home_chat',
        threadIsDirect: true,
      }),
    )
  })

  it('does not fall back from a known Linq group route to the personal home chat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-linq-group-authority-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-linq-group-authority',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the group reminder.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'saved-group-chat',
        threadIsDirect: false,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'linq-group-authority-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Linq group authority reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const sequence: string[] = []
    const resolveScheduledLinqRoute = vi.fn(async () => {
      sequence.push('route_authority')
      return {
        target: 'saved-group-chat',
        threadIsDirect: false,
      }
    })
    const groupTool = {
      request: vi.fn(async () => {
        throw new Error('The cron scope test must not execute the group tool.')
      }),
    }
    type ScheduledGroupToolsFactory = NonNullable<
      NonNullable<AssistantExecutionContext['hosted']>['createScheduledGroupTools']
    >
    const scheduledGroupTools: NonNullable<
      ReturnType<ScheduledGroupToolsFactory>
    > = {
      groupPermissionOfferTool: {
        async request() {
          return {
            action: 'post_join_offer',
            result: {
              group: null,
              status: 'unavailable',
              unavailableReason: 'synthetic_unavailable',
            },
          }
        },
      },
      groupSharedReader: {
        async request() {
          return {
            status: 'unavailable',
            unavailableReason: 'synthetic_unavailable',
          }
        },
      },
      groupTool,
    }
    const createScheduledGroupTools: ScheduledGroupToolsFactory = vi.fn(() => {
      sequence.push('scheduled_group_factory')
      return scheduledGroupTools
    })
    cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (input) => {
      sequence.push('notification_turn')
      await input.beforeToolExecution?.()
      return {
        response: 'Completed scheduled check-in.',
        session: { sessionId: 'session-default' },
      }
    })
    const executionContext: AssistantExecutionContext = {
      hosted: {
        createScheduledGroupTools,
        memberId: 'member-linq-group-authority',
        resolveScheduledLinqRoute,
        userEnvKeys: [],
      },
    }
    const result = await processDueAssistantCronJobsLocal({
      executionContext,
      limit: 1,
      vault: vaultRoot,
    })

    expect(result).toEqual({ failed: 0, processed: 1, succeeded: 1 })
    expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: false,
        target: 'saved-group-chat',
        targetKind: 'thread',
      }),
    )
    expect(createScheduledGroupTools).toHaveBeenCalledWith({
      channel: 'linq',
      target: 'saved-group-chat',
      threadIsDirect: false,
    })
    expect(sequence).toEqual([
      'route_authority',
      'scheduled_group_factory',
      'notification_turn',
      'route_authority',
    ])
    expect(resolveScheduledLinqRoute).toHaveBeenCalledTimes(2)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'saved-group-chat',
        deliveryKind: 'thread',
        deliveryTarget: null,
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            ...scheduledGroupTools,
            groupTool,
          }),
        }),
        threadIsDirect: false,
      }),
    )
    const notificationInput = cronMocks.sendAssistantMessageLocal.mock.calls.at(-1)?.[0]
    expect(notificationInput?.executionContext).not.toBe(executionContext)
    expect(notificationInput?.executionContext?.hosted?.createScheduledGroupTools)
      .toBeUndefined()
    expect(executionContext.hosted?.groupSharedReader).toBeUndefined()
    expect(executionContext.hosted?.groupPermissionOfferTool).toBeUndefined()
  })

  it.each([
    'resolver_failure',
    'changed_target_without_locator',
  ] as const)(
    'records a retryable cron failure when Linq route authority fails before notification: %s',
    async (failureKind) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-linq-authority-failure-',
    )
    const expectedError =
      failureKind === 'resolver_failure'
        ? 'Linq route authority is temporarily unavailable.'
        : 'Hosted Linq route changes require a matching conversation locator.'
    const resolveScheduledLinqRoute =
      failureKind === 'resolver_failure'
        ? vi.fn().mockRejectedValue(
            new VaultCliError(
              'ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE',
              expectedError,
              { retryable: true },
            ),
          )
        : vi.fn().mockResolvedValue({
            target: 'current-home-chat',
            threadIsDirect: true,
          })
    const createScheduledGroupTools = vi.fn()
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-linq-authority-failure',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the morning reminder.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'saved-home-chat',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'linq-authority-failure-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Linq authority failure reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
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
      executionContext: {
        hosted: {
          createScheduledGroupTools,
          memberId: 'member-linq-authority-failure',
          resolveScheduledLinqRoute,
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.removedAfterRun).toBe(false)
    expect(result.run).toMatchObject({
      error: expectedError,
      outcome: 'failed',
      reason: 'ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE',
      status: 'failed',
    })
    expect(result.runErrorCode).toBe(
      'ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE',
    )
    expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: true,
        target: 'saved-home-chat',
        targetKind: 'explicit',
      }),
    )
    expect(createScheduledGroupTools).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
    const finalizedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    expect(finalizedRuntimeStore.jobs).toEqual([
      expect.objectContaining({
        jobId: claimed.job.jobId,
        state: expect.objectContaining({
          consecutiveFailures: 1,
          pendingOccurrenceAt: '2026-04-08T10:00:00.000Z',
          retryAfterAt: '2026-04-08T10:20:30.000Z',
        }),
      }),
    ])
    },
  )

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

  it('scopes scheduled shared reads to canonical Telegram group routes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-telegram-group-tools-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-telegram-group-tools',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the group sleep reminder.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: '-100123456789',
        threadIsDirect: false,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'telegram-group-tools-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Telegram group tools reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const groupSharedReader = {
      async request() {
        return {
          status: 'unavailable' as const,
          unavailableReason: 'synthetic_unavailable',
        }
      },
    }
    const groupTool = {
      async request(): Promise<never> {
        throw new Error('The Telegram cron scope test must not execute the group tool.')
      },
    }
    const createScheduledGroupTools = vi.fn(() => ({ groupSharedReader, groupTool }))
    const routeAuthority = {
      channel: 'telegram' as const,
      containerMemberId: 'member-telegram-group-tools',
      threadId: '-100123456789',
    }
    const resolveScheduledExternalThreadRoute = vi.fn(async () => routeAuthority)
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          createScheduledGroupTools,
          memberId: 'member-telegram-group-tools',
          resolveScheduledExternalThreadRoute,
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(createScheduledGroupTools).toHaveBeenCalledWith({
      channel: 'telegram',
      target: '-100123456789',
      threadIsDirect: false,
    })
    expect(resolveScheduledExternalThreadRoute).toHaveBeenCalledWith({
      channel: 'telegram',
      signal: expect.any(AbortSignal),
      target: routeAuthority.threadId,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        executionContext: {
          hosted: expect.objectContaining({ groupSharedReader }),
        },
        outboxExternalThreadRouteAuthority: routeAuthority,
        threadIsDirect: false,
      }),
    )
    const notificationContext = cronMocks.sendAssistantMessageLocal.mock
      .calls.at(-1)?.[0]?.executionContext
    expect(notificationContext?.hosted?.groupPermissionOfferTool).toBeUndefined()
  })

  it('withholds Telegram group tools from manual canonical and scheduled local cron runs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const groupSharedReader = {
      async request() {
        return {
          status: 'unavailable' as const,
          unavailableReason: 'synthetic_unavailable',
        }
      },
    }
    const groupTool = {
      async request(): Promise<never> {
        throw new Error('Untrusted cron runs must not expose the group tool.')
      },
    }
    const createScheduledGroupTools = vi.fn(() => ({ groupSharedReader, groupTool }))
    const resolveScheduledExternalThreadRoute = vi.fn(async (input: {
      target: string
    }) => ({
      channel: 'telegram' as const,
      containerMemberId: 'member-telegram-untrusted-cron',
      threadId: input.target,
    }))
    const executionContext = {
      hosted: {
        createScheduledGroupTools,
        groupSharedReader,
        groupTool,
        memberId: 'member-telegram-untrusted-cron',
        resolveScheduledExternalThreadRoute,
        userEnvKeys: [],
      },
    }

    const canonicalContext = await createRuntimeContext(
      'assistant-cron-runtime-telegram-manual-group-tools-',
    )
    getVaultAutomationStore(canonicalContext.vaultRoot).push({
      automationId: 'automation-telegram-manual-group-tools',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the manual group reminder.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: '-100123456701',
        threadIsDirect: false,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'telegram-manual-group-tools',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Telegram manual group tools',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const canonical = await claimFirstCanonicalCronJob(canonicalContext.vaultRoot)
    const manualResult = await executeClaimedAssistantCronJob({
      executionContext,
      job: canonical.claimed,
      paths: canonical.paths,
      trigger: 'manual',
      vault: canonicalContext.vaultRoot,
    })

    const localContext = await createRuntimeContext(
      'assistant-cron-runtime-telegram-local-group-tools-',
    )
    const originalLocalJob = await createLocalJob(
      localContext.vaultRoot,
      'telegram-local-group-tools',
    )
    const localPaths = resolveAssistantStatePaths(localContext.vaultRoot)
    const localStore = await readAssistantCronStore(localPaths)
    const localJobIndex = resolveAssistantCronJobIndex(
      localStore,
      originalLocalJob.jobId,
    )
    const localJob = assistantCronJobSchema.parse({
      ...originalLocalJob,
      target: {
        ...originalLocalJob.target,
        channel: 'telegram',
        threadId: '-100123456702',
        threadIsDirect: false,
      },
    })
    localStore.jobs[localJobIndex] = localJob
    await writeAssistantCronStore(localPaths, localStore)
    const claimedLocalJob = await claimResolvedAssistantCronJob({
      job: { job: localJob, kind: 'local' },
      paths: localPaths,
    })
    const localResult = await executeClaimedAssistantCronJob({
      executionContext,
      job: claimedLocalJob,
      paths: localPaths,
      trigger: 'scheduled',
      vault: localContext.vaultRoot,
    })

    expect(manualResult.run.status).toBe('succeeded')
    expect(localResult.run.status).toBe('succeeded')
    expect(createScheduledGroupTools).not.toHaveBeenCalled()
    expect(resolveScheduledExternalThreadRoute).toHaveBeenCalledTimes(2)
    const notificationCalls = cronMocks.sendAssistantMessageLocal.mock.calls.slice(-2)
    expect(notificationCalls).toHaveLength(2)
    for (const [notification] of notificationCalls) {
      expect(notification.executionContext?.hosted?.groupSharedReader).toBeUndefined()
      expect(notification.executionContext?.hosted?.groupTool).toBeUndefined()
    }
  })

  it('fails a hosted Telegram group cron before shared reads when live route authority is unavailable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-telegram-group-route-authority-',
    )
    getVaultAutomationStore(vaultRoot).push({
      automationId: 'automation-telegram-group-route-authority',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Send the group sleep reminder.',
      route: {
        channel: 'telegram',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: '-100987654321',
        threadIsDirect: false,
      },
      schedule: {
        at: '2026-04-08T10:00:00.000Z',
        kind: 'at',
      },
      slug: 'telegram-group-route-authority-reminder',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Telegram group route authority reminder',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })
    const createScheduledGroupTools = vi.fn(() => ({
      groupSharedReader: {
        async request() {
          throw new Error('Shared reads must stay unreachable without route authority.')
        },
      },
      groupTool: {
        async request(): Promise<never> {
          throw new Error('Group tools must stay unreachable without route authority.')
        },
      },
    }))
    const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

    const result = await executeClaimedAssistantCronJob({
      executionContext: {
        hosted: {
          createScheduledGroupTools,
          memberId: 'member-telegram-group-route-authority',
          userEnvKeys: [],
        },
      },
      job: claimed,
      paths,
      trigger: 'scheduled',
      vault: vaultRoot,
    })

    expect(result.run).toMatchObject({
      outcome: 'failed',
      reason: 'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE',
      status: 'failed',
    })
    expect(createScheduledGroupTools).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
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
        identityId: 'hosted-email-identity-1',
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
        identityId: 'hosted-email-identity-1',
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
        threadIsDirect: true,
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
        bindingDeliveryTarget: 'team@example.com',
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
            runOutcome: 'no_op',
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

  it.each([
    ['murph-managed:weekly-health-insight', 'open'],
    ['murph-managed:monthly-improvement-coach', 'open'],
    ['murph-managed:weekly-improvement-coach', 'open'],
    ['murph-managed:weekly-health-research-scout', 'open'],
    ['murph-managed:weekly-health-insight', 'unreadable'],
    ['murph-managed:monthly-improvement-coach', 'unreadable'],
    ['murph-managed:weekly-improvement-coach', 'unreadable'],
    ['murph-managed:weekly-health-research-scout', 'unreadable'],
  ] as const)(
    'lets an unknown automation carrying copied tag %s reach provider work while onboarding is %s',
    async (tag, onboardingState) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-copied-managed-tag-${onboardingState}-`,
      )
      addManagedResearchAutomation({
        automationId: `automation-copied-${tag.replaceAll(':', '-')}-${onboardingState}`,
        tag,
        vaultRoot,
      })
      if (onboardingState === 'unreadable') {
        const onboardingStatePath = resolveAssistantOnboardingStatePath(vaultRoot)
        await mkdir(path.dirname(onboardingStatePath), { recursive: true })
        await writeFile(onboardingStatePath, '{ invalid onboarding json', 'utf8')
      }
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
          instructions: expect.stringContaining(
            'Independent automation authority (engine-supplied):',
          ),
        }),
      )
    },
  )

  it.each([
    [
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      'murph-managed:weekly-health-insight',
      'open',
    ],
    [
      MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      'murph-managed:monthly-improvement-coach',
      'open',
    ],
    [
      MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      'murph-managed:weekly-health-research-scout',
      'open',
    ],
    [
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      'murph-managed:weekly-health-insight',
      'unreadable',
    ],
    [
      MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      'murph-managed:monthly-improvement-coach',
      'unreadable',
    ],
    [
      MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      'murph-managed:weekly-health-research-scout',
      'unreadable',
    ],
  ] as const)(
    'skips exact managed research automation %s tagged %s before provider work while onboarding is %s',
    async (automationId, tag, onboardingState) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
      const { vaultRoot } = await createRuntimeContext(
        `assistant-cron-runtime-managed-research-${onboardingState}-`,
      )
      addManagedResearchAutomation({
        automationId,
        tag,
        vaultRoot,
      })
      if (onboardingState === 'unreadable') {
        const onboardingStatePath = resolveAssistantOnboardingStatePath(vaultRoot)
        await mkdir(path.dirname(onboardingStatePath), { recursive: true })
        await writeFile(onboardingStatePath, '{ invalid onboarding json', 'utf8')
      }
      const { claimed, paths } = await claimFirstCanonicalCronJob(vaultRoot)

      const result = await executeClaimedAssistantCronJob({
        job: claimed,
        paths,
        trigger: 'scheduled',
        vault: vaultRoot,
      })

      expect(result.run.status).toBe('skipped')
      expect(result.run.error).toBe(
        onboardingState === 'open'
          ? 'Assistant cron research-oriented managed automation skipped because assistant onboarding is open.'
          : 'Assistant cron research-oriented managed automation skipped because assistant onboarding state could not be read.',
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
    },
  )

  it('runs managed research cron normally after onboarding is complete', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T10:20:00.000Z'))
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-managed-research-onboarding-complete-',
    )
    addManagedResearchAutomation({
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
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
        instructions: expect.not.stringContaining(
          'Run weekly-health-research-scout.\n\nIndependent automation authority (engine-supplied):',
        ),
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
        instructions: expect.stringContaining(
          'Send the red light glasses before bed reminder.',
        ),
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

  it('fails an existing local email automation before running the assistant turn', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T15:00:05.000Z'))
    cronMocks.loadVault.mockResolvedValue({
      metadata: {
        timezone: 'America/New_York',
      },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-local-email-unsupported-',
    )
    const automationId = 'automation_local_email_unsupported'
    getVaultAutomationStore(vaultRoot).push({
      automationId,
      continuityPolicy: 'fresh',
      createdAt: '2026-06-19T14:56:00.000Z',
      instructions: 'Send the 11am reminder.',
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: 'recipient@example.test',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        expression: '0 11 * * 5',
        kind: 'cron',
      },
      slug: 'local-email-unsupported',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'Unsupported local email reminder',
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
            'Local email automation delivery is not supported',
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
            runOutcome: 'delivery_pending',
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
    expect(failed.state.nextRunAt).toBe('2026-05-05T16:00:00.000Z')
    expect(failed.state.consecutiveFailures).toBe(0)
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
        outboxAutomationAuthority: {
          automationId: 'automation-linq-pinned-mixed-route',
          expectedUpdatedAt: '2026-05-03T22:17:55.000Z',
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
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxAutomationAuthority: {
          automationId: 'automation-kl-pending-sent',
          expectedUpdatedAt: '2026-05-03T22:17:55.000Z',
        },
      }),
    )

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

  it('retries required one-shot delivery past the generic stale window and archives only after sent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:00.000Z'))
    const firstIntentId = 'outbox_final_review_failed'
    const secondIntentId = 'outbox_final_review_sent'
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued final review.',
        text: 'Here are your final results.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: firstIntentId,
        session: { sessionId: 'session-default' },
      },
      response: 'Here are your final results.',
      session: { sessionId: 'session-default' },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-required-final-retry-',
    )
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: '2026-04-15T09:00:00.000Z',
      automationId: 'automation-required-final-retry',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Deliver the saved experiment outcome.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      slug: 'required-final-retry',
      status: 'active',
      summary: null,
      tags: [
        'assistant',
        'scheduled',
        'experiment',
        'final-results',
        'system:assistant-require-send',
      ],
      title: 'Required final review',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      vault: vaultRoot,
    })).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: firstIntentId,
        lastError: {
          code: 'LINQ_API_REQUEST_FAILED',
          message: 'Final review delivery failed.',
        },
        sentAt: null,
        status: 'failed',
        updatedAt: '2026-04-08T10:05:00.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })).resolves.toEqual({ reconciled: 1 })

    const retryable = await getAssistantCronJob(
      vaultRoot,
      'automation-required-final-retry',
    )
    expect(retryable.state).toMatchObject({
      consecutiveFailures: 1,
      lastFailedAt: '2026-04-08T10:05:00.000Z',
      nextRunAt: '2026-04-08T10:05:30.000Z',
    })
    expect(findCanonicalAutomation(
      vaultRoot,
      'automation-required-final-retry',
    )?.status).toBe('active')

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: firstIntentId,
        lastError: { message: 'Final review delivery failed.' },
        sentAt: null,
        status: 'failed',
        updatedAt: '2026-04-08T10:05:00.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })).resolves.toEqual({ reconciled: 0 })

    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued final review retry.',
        text: 'Here are your final results.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: secondIntentId,
        session: { sessionId: 'session-default' },
      },
      response: 'Here are your final results.',
      session: { sessionId: 'session-default' },
    })
    vi.setSystemTime(new Date('2026-04-08T10:05:30.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      vault: vaultRoot,
    })).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          'Do not interpret the absence of a user reply to that attempt as silence',
        ),
      }),
    )

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: secondIntentId,
        lastError: null,
        sentAt: '2026-04-08T10:06:00.000Z',
        status: 'sent',
        updatedAt: '2026-04-08T10:06:00.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })).resolves.toEqual({ reconciled: 1 })

    expect(findCanonicalAutomation(
      vaultRoot,
      'automation-required-final-retry',
    )?.status).toBe('archived')
    expect(cronMocks.runExperimentLifecycleOutcomePrecondition).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
      label: 'revoked automation authority',
      status: 'failed' as const,
    },
    {
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      label: 'ambiguous failed',
      status: 'failed' as const,
    },
    {
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      label: 'abandoned',
      status: 'abandoned' as const,
    },
    {
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      label: 'confirmation-pending',
      status: 'failed' as const,
    },
    {
      code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      label: 'retry-exhausted',
      status: 'failed' as const,
    },
  ])('consumes a required-send occurrence after a terminal $label outbox outcome', async ({
    code,
    label,
    status,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:00.000Z'))
    const queuedIntentId = `outbox_required_terminal_${code.toLowerCase()}_${status}`
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued bounded final review.',
        text: 'Here are your final results.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: queuedIntentId,
        session: { sessionId: 'session-default' },
      },
      response: 'Here are your final results.',
      session: { sessionId: 'session-default' },
    })
    const { vaultRoot } = await createRuntimeContext(
      `assistant-cron-runtime-required-terminal-${label}-`,
    )
    const canonicalJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: `required terminal ${label}`,
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Deliver the bounded final check-in.',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      vault: vaultRoot,
    })
    const automation = findCanonicalAutomation(vaultRoot, canonicalJob.jobId)
    if (!automation) {
      throw new Error('Expected the required-delivery automation fixture.')
    }
    automation.activeUntil = '2026-04-15T09:00:00.000Z'
    automation.tags.push('system:assistant-require-send')

    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({
      failed: 0,
      processed: 1,
      succeeded: 0,
    })

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: queuedIntentId,
        lastError: {
          code,
          message: `Terminal ${label} delivery.`,
        },
        sentAt: null,
        status,
        updatedAt: '2026-04-08T09:11:00.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })).resolves.toEqual({ reconciled: 1 })

    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'archived',
    )
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])

    vi.setSystemTime(new Date('2026-04-08T09:11:30.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
  })

  it('consumes a finite required-send occurrence after confirmed Linq attachment PUT exhaustion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T20:00:00.000Z'))
    const fixture = await createRequiredLinqAttachmentDeliveryFixture({
      intentId: 'outbox_required_linq_attachment_exhausted',
      prefix: 'assistant-cron-runtime-required-linq-attachment-exhausted-',
      target: 'linq_chat_required_attachment_exhausted',
    })
    const {
      canonicalJob,
      imageBytes,
      intent,
      vaultRoot,
    } = fixture
    const reservationFetch = vi.fn<LinqFetch>(async (url) => {
      if (!url.endsWith('/attachments')) {
        throw new Error(`Unexpected Linq provider request: ${url}`)
      }
      return new Response(JSON.stringify({
        attachment_id: 'attachment_required_exhausted',
        expires_at: '2026-08-06T21:00:00.000Z',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'image/png',
        },
        upload_url: 'https://uploads.example.test/private/required-exhausted',
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const uploadFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '0',
        },
        status: 503,
      }))
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: reservationFetch,
        loadVaultImage: async () => imageBytes,
        publicFetchImplementation: uploadFetch,
      }),
    )
    const failed = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(failed.intent).toMatchObject({
      lastError: {
        code: 'LINQ_API_REQUEST_FAILED',
        diagnosticContext: expect.objectContaining({
          failureStage: 'http',
          method: 'PUT',
          operation: 'create_attachment_upload',
          retryable: false,
        }),
      },
      nextAttemptAt: null,
      status: 'failed',
    })
    expect(reservationFetch).toHaveBeenCalledTimes(1)
    expect(uploadFetch).toHaveBeenCalledTimes(3)
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
    expect(findCanonicalAutomation(vaultRoot, canonicalJob.jobId)?.status).toBe(
      'archived',
    )
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])

    vi.setSystemTime(new Date('2026-08-06T20:00:30.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 })

    const intents = await listAssistantOutboxIntents(vaultRoot)
    expect(intents.map((candidate) => candidate.intentId)).toEqual([
      intent.intentId,
    ])
    expect(reservationFetch).toHaveBeenCalledTimes(1)
    expect(uploadFetch).toHaveBeenCalledTimes(3)
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
  })

  it('keeps a finite required-send occurrence on the same intent after provider-skipped reservation entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T20:00:00.000Z'))
    const fixture = await createRequiredLinqAttachmentDeliveryFixture({
      intentId: 'outbox_required_linq_attachment_provider_skipped',
      prefix: 'assistant-cron-runtime-required-linq-provider-skipped-',
      target: 'linq_chat_required_attachment_provider_skipped',
    })
    let providerEntryAllowed = false
    const linqNetworkFetch = vi.fn<LinqFetch>(async (url) => {
      if (url.endsWith('/attachments')) {
        return new Response(JSON.stringify({
          attachment_id: 'attachment_required_provider_skipped',
          expires_at: '2026-08-06T21:00:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'image/png',
          },
          upload_url: 'https://uploads.example.test/private/required-provider-skipped',
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith(`/chats/${fixture.target}/messages`)) {
        return new Response(JSON.stringify({
          message: { id: 'linq_required_provider_skipped_sent' },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected Linq provider request: ${url}`)
    })
    const hostedBoundaryFetch = vi.fn<LinqFetch>(async (url, init) => {
      if (!providerEntryAllowed) {
        throw Object.assign(new Error('foreground work owns provider entry'), {
          assistantDeliveryFailureClass: 'transient' as const,
          assistantDeliveryResumeTrigger: 'fresh_foreground_input' as const,
          deliveryMayHaveSucceeded: false as const,
          retryable: true as const,
        })
      }
      return await linqNetworkFetch(url, init)
    })
    const uploadFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: hostedBoundaryFetch,
        loadVaultImage: async () => fixture.imageBytes,
        publicFetchImplementation: uploadFetch,
      }),
    )

    const deferred = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: fixture.intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: fixture.vaultRoot,
    })

    expect(deferred.intent).toMatchObject({
      intentId: fixture.intent.intentId,
      status: 'retryable',
    })
    expect(findCanonicalAutomation(
      fixture.vaultRoot,
      fixture.canonicalJob.jobId,
    )?.status).toBe('active')
    expect(hostedBoundaryFetch).toHaveBeenCalledTimes(1)
    expect(linqNetworkFetch).not.toHaveBeenCalled()
    expect(uploadFetch).not.toHaveBeenCalled()
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
    await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toMatchObject([
      { intentId: fixture.intent.intentId },
    ])

    vi.setSystemTime(new Date('2026-08-06T20:00:30.000Z'))
    await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: fixture.vaultRoot,
    })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
    expect(findCanonicalAutomation(
      fixture.vaultRoot,
      fixture.canonicalJob.jobId,
    )?.status).toBe('active')
    await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toEqual([
      expect.objectContaining({
        intentId: fixture.intent.intentId,
        status: 'retryable',
      }),
    ])

    providerEntryAllowed = true
    const sent = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: fixture.intent.intentId,
      now: new Date('2026-08-06T20:00:30.000Z'),
      vault: fixture.vaultRoot,
    })

    expect(sent.intent).toMatchObject({
      delivery: {
        providerMessageId: 'linq_required_provider_skipped_sent',
      },
      intentId: fixture.intent.intentId,
      status: 'sent',
    })
    expect(findCanonicalAutomation(
      fixture.vaultRoot,
      fixture.canonicalJob.jobId,
    )?.status).toBe('archived')
    await expect(listAssistantCronJobs(fixture.vaultRoot)).resolves.toEqual([])
    expect(hostedBoundaryFetch).toHaveBeenCalledTimes(3)
    expect(linqNetworkFetch).toHaveBeenCalledTimes(2)
    expect(uploadFetch).toHaveBeenCalledTimes(1)
    expect(sendLinq).toHaveBeenCalledTimes(2)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-08-06T20:01:00.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: fixture.vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 })
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
    await expect(listAssistantOutboxIntents(fixture.vaultRoot)).resolves.toHaveLength(1)
  })

  it.each([
    {
      label: 'missing required fields',
      payload: {
        attachment_id: 'attachment_required_missing_upload_url',
        expires_at: '2026-08-06T21:00:00.000Z',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'image/png',
        },
      },
    },
    {
      label: 'an unsupported upload method',
      payload: {
        attachment_id: 'attachment_required_unsupported_method',
        expires_at: '2026-08-06T21:00:00.000Z',
        http_method: 'POST',
        required_headers: {
          'content-type': 'image/png',
        },
        upload_url: 'https://uploads.example.test/private/required-unsupported-method',
      },
    },
    {
      label: 'empty required headers',
      payload: {
        attachment_id: 'attachment_required_empty_headers',
        expires_at: '2026-08-06T21:00:00.000Z',
        http_method: 'PUT',
        required_headers: {},
        upload_url: 'https://uploads.example.test/private/required-empty-headers',
      },
    },
  ])('consumes a finite required-send occurrence after a 2xx reservation with $label', async ({
    label,
    payload,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T20:00:00.000Z'))
    const fixture = await createRequiredLinqAttachmentDeliveryFixture({
      intentId: `outbox_required_linq_attachment_${label.replaceAll(' ', '_')}`,
      prefix: `assistant-cron-runtime-required-linq-${label.replaceAll(' ', '-')}-`,
      target: 'linq_chat_required_attachment_unusable_reservation',
    })
    const reservationFetch = vi.fn<LinqFetch>(async (url) => {
      if (!url.endsWith('/attachments')) {
        throw new Error(`Unexpected Linq provider request: ${url}`)
      }
      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const uploadFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: reservationFetch,
        loadVaultImage: async () => fixture.imageBytes,
        publicFetchImplementation: uploadFetch,
      }),
    )

    const abandoned = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: fixture.intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: fixture.vaultRoot,
    })

    expect(abandoned.intent).toMatchObject({
      lastError: {
        code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      },
      nextAttemptAt: null,
      status: 'abandoned',
    })
    expect(reservationFetch).toHaveBeenCalledTimes(1)
    expect(uploadFetch).not.toHaveBeenCalled()
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
    expect(findCanonicalAutomation(
      fixture.vaultRoot,
      fixture.canonicalJob.jobId,
    )?.status).toBe('archived')
    await expect(listAssistantCronJobs(fixture.vaultRoot)).resolves.toEqual([])

    vi.setSystemTime(new Date('2026-08-06T20:00:30.000Z'))
    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: fixture.vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 })

    const intents = await listAssistantOutboxIntents(fixture.vaultRoot)
    expect(intents.map((candidate) => candidate.intentId)).toEqual([
      fixture.intent.intentId,
    ])
    expect(reservationFetch).toHaveBeenCalledTimes(1)
    expect(uploadFetch).not.toHaveBeenCalled()
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-08-06T20:11:00.000Z'))
    const staleWake = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      intentId: fixture.intent.intentId,
      now: new Date('2026-08-06T20:11:00.000Z'),
      vault: fixture.vaultRoot,
    })
    expect(staleWake.intent).toMatchObject({
      intentId: fixture.intent.intentId,
      lastError: { code: 'ASSISTANT_DELIVERY_AMBIGUOUS' },
      status: 'abandoned',
    })
    await expect(processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      limit: 1,
      vault: fixture.vaultRoot,
    })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 })

    const staleHorizonIntents = await listAssistantOutboxIntents(fixture.vaultRoot)
    expect(staleHorizonIntents.map((candidate) => candidate.intentId)).toEqual([
      fixture.intent.intentId,
    ])
    expect(reservationFetch).toHaveBeenCalledTimes(1)
    expect(uploadFetch).not.toHaveBeenCalled()
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledTimes(1)
  })

  it('does not retry required delivery without a finite activeUntil boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:00.000Z'))
    const intentId = 'outbox_unbounded_required_delivery'
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued required reminder.',
        text: 'Required reminder.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId,
        session: { sessionId: 'session-default' },
      },
      response: 'Required reminder.',
      session: { sessionId: 'session-default' },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-unbounded-required-delivery-',
    )
    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-1',
      name: 'unbounded required delivery',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Send the bounded reminder.',
      schedule: { at: '2026-04-08T09:00:00.000Z', kind: 'at' },
      vault: vaultRoot,
    })
    const automation = findCanonicalAutomation(vaultRoot, job.jobId)
    if (!automation) {
      throw new Error('Expected required-delivery automation fixture.')
    }
    automation.tags.push('system:assistant-require-send')

    await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      vault: vaultRoot,
    })
    await reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId,
        lastError: { message: 'Required delivery failed.' },
        sentAt: null,
        status: 'failed',
        updatedAt: '2026-04-08T09:11:00.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })

    expect(findCanonicalAutomation(vaultRoot, job.jobId)?.status).toBe('archived')
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
  })

  it('archives a required one-shot when abandoned at its activeUntil boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:00.000Z'))
    const queuedIntentId = 'outbox_final_review_abandoned_at_boundary'
    cronMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
      decision: {
        kind: 'send_message',
        privateSummary: 'Queued bounded final review.',
        text: 'Here are your final results.',
      },
      deliveryOutcome: {
        kind: 'queued',
        error: null,
        intentId: queuedIntentId,
        session: { sessionId: 'session-default' },
      },
      response: 'Here are your final results.',
      session: { sessionId: 'session-default' },
    })
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-required-final-boundary-',
    )
    getVaultAutomationStore(vaultRoot).push({
      activeUntil: '2026-04-08T10:00:00.000Z',
      automationId: 'automation-required-final-boundary',
      continuityPolicy: 'fresh',
      createdAt: '2026-04-08T08:00:00.000Z',
      instructions: 'Deliver a bounded saved outcome.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: 'thread-1',
      },
      schedule: { at: '2026-04-08T09:00:00.000Z', kind: 'at' },
      slug: 'required-final-boundary',
      status: 'active',
      summary: null,
      tags: ['experiment', 'final-results', 'system:assistant-require-send'],
      title: 'Bounded required final review',
      updatedAt: '2026-04-08T08:00:00.000Z',
    })

    await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only',
      vault: vaultRoot,
    })
    await reconcileAssistantCronDeliveryIntent({
      intent: {
        intentId: queuedIntentId,
        lastError: null,
        sentAt: null,
        status: 'abandoned',
        updatedAt: '2026-04-08T10:00:00.000Z',
      } as AssistantOutboxIntent,
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })

    expect(findCanonicalAutomation(
      vaultRoot,
      'automation-required-final-boundary',
    )?.status).toBe('archived')
    expect(cronMocks.sendAssistantMessageLocal).toHaveBeenCalledOnce()
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
    expect(repaired.state.nextRunAt).toBe('2026-04-10T10:00:00.000Z')
    expect(repaired.state.consecutiveFailures).toBe(0)
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
    expect(abandoned.state.nextRunAt).toBe('2026-04-09T10:00:00.000Z')
    expect(abandoned.state.consecutiveFailures).toBe(0)
  })

  it('advances reconciled terminal canonical deliveries after an older success', async () => {
    const { vaultRoot } = await createRuntimeContext(
      'assistant-cron-runtime-outbox-terminal-after-success-',
    )
    const canonicalJob = await createCanonicalJob(
      vaultRoot,
      'outbox terminal after success',
    )
    const intentId = 'outbox_terminal_after_success_delivery'
    await updateCanonicalRuntimeState(vaultRoot, canonicalJob.jobId, (record) => ({
      ...record,
      updatedAt: '2026-04-09T10:00:00.000Z',
      state: {
        ...record.state,
        lastRunAt: '2026-04-09T10:00:00.000Z',
        lastSucceededAt: '2026-04-08T10:00:05.000Z',
        pendingDeliveryIntentId: intentId,
        pendingOccurrenceAt: '2026-04-09T10:00:00.000Z',
      },
    }))
    await saveAssistantOutboxIntent(vaultRoot, buildTestLinqOutboxIntent({
      createdAt: '2026-04-09T10:00:00.000Z',
      intentId,
    }))

    await expect(
      markAssistantOutboxIntentMirrorTerminalById({
        error: new Error('provider failed delivery after prior success'),
        failedAt: new Date('2026-04-09T10:01:00.000Z'),
        intentId,
        status: 'failed',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
    })

    const failed = await getAssistantCronJob(vaultRoot, canonicalJob.jobId)
    expect(failed.state.pendingDeliveryIntentId).toBeUndefined()
    expect(failed.state.lastSucceededAt).toBe('2026-04-08T10:00:05.000Z')
    expect(failed.state.lastFailedAt).toBe('2026-04-09T10:01:00.000Z')
    expect(failed.state.lastError).toBe('provider failed delivery after prior success')
    expect(failed.state.nextRunAt).toBe('2026-04-10T10:00:00.000Z')
    expect(failed.state.consecutiveFailures).toBe(0)
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
    expect(runtimeRecord?.state.pendingOccurrenceAt).toBeNull()
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

function buildLegacyDeviceActivityAuthorityKey(
  automation: MockAutomationRecord,
): string {
  if (automation.schedule.kind !== 'deviceActivity') {
    throw new Error('Expected device activity automation.')
  }

  return createHash('sha256')
    .update(JSON.stringify({
      activityKind: automation.schedule.activityKind ?? null,
      automationId: automation.automationId,
      continuityPolicy: automation.continuityPolicy,
      instructions: automation.instructions,
      route: automation.route,
      source: automation.schedule.source ?? null,
    }))
    .digest('hex')
    .slice(0, 40)
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
    resolveTargetDefaults: false,
    schedule: {
      kind: 'dailyLocal',
      localTime: '10:00',
    },
    threadIsDirect: true,
    vault: vaultRoot,
  })
}

async function claimFirstCanonicalCronJob(vaultRoot: string): Promise<{
  claimed: Extract<
    Awaited<ReturnType<typeof claimResolvedAssistantCronJob>>,
    { kind: 'canonical' }
  >
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
  if (claimed.kind !== 'canonical') {
    throw new Error('Expected claimed canonical source.')
  }

  return {
    claimed,
    paths,
  }
}

function addCurrentOnboardingFollowupAutomation(input: {
  automationId: string
  vaultRoot: string
}): void {
  getVaultAutomationStore(input.vaultRoot).push({
    activeUntil: '2026-04-11T19:00:00.000Z',
    automationId: input.automationId,
    continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
    createdAt: '2026-04-08T13:30:00.000Z',
    instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
    route: {
      channel: 'telegram',
      deliverySource: null,
      deliveryTarget: 'room-1',
      identityId: null,
      participantId: null,
      threadId: null,
      threadIsDirect: true,
    },
    schedule: {
      at: '2026-04-09T18:29:00.000Z',
      kind: 'at',
    },
    slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    status: 'active',
    summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
    tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
    title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    updatedAt: '2026-04-08T13:30:00.000Z',
  })
}

function addRecognizedOnboardingFollowupPredecessorAutomation(input: {
  automationId: string
  definition: (typeof onboardingFollowupPredecessorDefinitions)[number]['definition']
  schedule: (typeof onboardingFollowupPredecessorDefinitions)[number]['schedule']
  vaultRoot: string
}): void {
  getVaultAutomationStore(input.vaultRoot).push({
    automationId: input.automationId,
    continuityPolicy: input.definition.continuityPolicy,
    createdAt: '2026-04-08T15:00:00.000Z',
    instructions: input.definition.instructions,
    route: {
      channel: 'telegram',
      deliverySource: null,
      deliveryTarget: 'room-1',
      identityId: null,
      participantId: null,
      threadId: null,
      threadIsDirect: true,
    },
    schedule: input.schedule,
    slug: input.definition.slug,
    status: 'active',
    summary: input.definition.summary,
    tags: [...input.definition.tags],
    title: input.definition.title,
    updatedAt: '2026-04-08T15:00:00.000Z',
  })
}

function addManagedResearchAutomation(input: {
  automationId?: string
  instructions?: string
  slug?: string
  tag:
    | 'murph-managed:weekly-health-insight'
    | 'murph-managed:monthly-improvement-coach'
    | 'murph-managed:weekly-improvement-coach'
    | 'murph-managed:weekly-health-research-scout'
  title?: string
  vaultRoot: string
}): void {
  const defaultSlugs = {
    'murph-managed:monthly-improvement-coach': 'monthly-improvement-coach',
    'murph-managed:weekly-health-insight': 'weekly-health-insight',
    'murph-managed:weekly-health-research-scout': 'weekly-health-research-scout',
    'murph-managed:weekly-improvement-coach': 'weekly-improvement-coach',
  } as const
  const slug = input.slug ?? defaultSlugs[input.tag]
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

function addGroupRoomModelConsolidationAutomation(vaultRoot: string): void {
  getVaultAutomationStore(vaultRoot).push({
    automationId: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
    continuityPolicy: 'fresh',
    createdAt: '2026-04-08T08:00:00.000Z',
    instructions: 'Refresh the group room model.',
    route: {
      channel: 'telegram',
      deliverySource: null,
      deliveryTarget: 'retained-group-room',
      identityId: null,
      participantId: null,
      threadId: 'retained-group-room',
      threadIsDirect: false,
    },
    schedule: {
      kind: 'cron',
      expression: '0 4 * * *',
    },
    slug: 'group-room-model-consolidation',
    status: 'active',
    summary: null,
    tags: [
      'assistant',
      'scheduled',
      'murph-managed:group-room-model-consolidation',
      'runtime-maintenance',
    ],
    title: 'Group room model consolidation',
    updatedAt: '2026-04-08T08:00:00.000Z',
  })
}

function addOvernightMemoryConsolidationAutomation(vaultRoot: string): void {
  getVaultAutomationStore(vaultRoot).push({
    automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    continuityPolicy: 'fresh',
    createdAt: '2026-04-08T08:00:00.000Z',
    instructions: 'Consolidate canonical vault memory.',
    // Deliberately populated: maintenance never delivers, so the retained
    // route must stay persisted but must not enter the provider turn.
    route: {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'retained-maintenance-chat',
      identityId: 'retained-maintenance-identity',
      participantId: 'retained-maintenance-participant',
      threadId: 'retained-maintenance-thread',
      threadIsDirect: true,
    },
    schedule: {
      kind: 'cron',
      // Daily on purpose: these orchestration tests pin fake clock times and
      // only exercise claim/yield/retry behavior, not the seeded cadence.
      expression: '0 3 * * *',
    },
    slug: 'overnight-memory-consolidation',
    status: 'active',
    summary: null,
    tags: [
      'assistant',
      'scheduled',
      'murph-managed:overnight-memory-consolidation',
      'runtime-maintenance',
    ],
    title: 'Overnight memory consolidation',
    updatedAt: '2026-04-08T08:00:00.000Z',
  })
}

async function createClaimedNewsletterCronJob(input: {
  automationId: string
  occurrenceAt: string
  vaultRoot: string
}) {
  getVaultAutomationStore(input.vaultRoot).push({
    automationId: input.automationId,
    continuityPolicy: 'fresh',
    createdAt: '2026-07-06T10:00:00.000Z',
    instructions: 'Compose and send the group health newsletter.',
    route: {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'group-chat-1',
      identityId: null,
      participantId: null,
      threadId: 'group-chat-1',
          threadIsDirect: false,
    },
    schedule: {
      kind: 'cron',
      expression: '0 13 * * 0',
    },
    slug: 'group-health-newsletter',
    status: 'active',
    summary: null,
    tags: ['assistant', 'scheduled'],
    title: 'Group Health Newsletter',
    updatedAt: '2026-07-06T10:00:00.000Z',
  })
  const source = (await listCanonicalAssistantCronRecords(input.vaultRoot))[0]
  if (!source || source.kind !== 'automation') {
    throw new Error('Expected newsletter automation source.')
  }
  const paths = resolveAssistantStatePaths(input.vaultRoot)
  const baseRuntimeState = resolveCanonicalRuntimeState(
    source,
    await readAssistantCronCanonicalRuntimeStore(paths),
  )
  const runtimeState = {
    ...baseRuntimeState,
    state: {
      ...baseRuntimeState.state,
      pendingOccurrenceAt: input.occurrenceAt,
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
  return { claimed, paths, source }
}

function buildTestNewsletterParentIntent(input: {
  automationId: string
  expectedUpdatedAt: string
  intentId: string
  occurrenceAt: string
}): AssistantOutboxIntent {
  return assistantOutboxIntentSchema.parse({
    ...buildTestLinqOutboxIntent({
      createdAt: input.occurrenceAt,
      intentId: input.intentId,
      message: 'Open this email in an HTML-capable mail client.',
    }),
    automationAuthority: {
      automationId: input.automationId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    },
    channel: 'email',
    deliveryIdempotencyKey: [
      'group-newsletter',
      input.automationId,
      input.occurrenceAt,
      'group_1',
    ].join(':'),
    emailHtml: '<p>Weekly</p>',
    explicitTarget: serializeHostedEmailThreadTarget({
      groupId: 'group_1',
      subject: 'Weekly',
      targetKind: 'group',
    }),
    groupEmailAuthorizationProof: 'a'.repeat(64),
    threadIsDirect: false,
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

async function createRequiredLinqAttachmentDeliveryFixture(input: {
  intentId: string
  prefix: string
  target: string
}): Promise<{
  canonicalJob: Awaited<ReturnType<typeof addAssistantCronJob>>
  imageBytes: Uint8Array
  intent: AssistantOutboxIntent
  target: string
  vaultRoot: string
}> {
  const { vaultRoot } = await createRuntimeContext(input.prefix)
  const canonicalJob = await addAssistantCronJob({
    channel: 'linq',
    deliveryTarget: input.target,
    name: 'required private attachment delivery',
    now: new Date('2026-08-06T19:00:00.000Z'),
    prompt: 'Deliver the private generated image once.',
    schedule: {
      at: '2026-08-06T20:00:00.000Z',
      kind: 'at',
    },
    vault: vaultRoot,
  })
  const automation = findCanonicalAutomation(vaultRoot, canonicalJob.jobId)
  if (!automation) {
    throw new Error('Expected the required-delivery automation fixture.')
  }
  automation.activeUntil = '2026-08-13T20:00:00.000Z'
  automation.tags.push('system:assistant-require-send')

  const imageBytes = new Uint8Array([81, 82, 83, 84])
  const intent = assistantOutboxIntentSchema.parse({
    ...buildTestLinqOutboxIntent({
      createdAt: '2026-08-06T20:00:00.000Z',
      intentId: input.intentId,
      message: 'Private generated image',
    }),
    explicitTarget: input.target,
    media: [{
      alt: 'Private generated image',
      contentType: 'image/png',
      filename: 'required-generated.png',
      kind: 'vault_image',
      ref: 'raw/captures/required-generated.png',
      sha256: createHash('sha256').update(imageBytes).digest('hex'),
      sizeBytes: imageBytes.byteLength,
      source: 'gpt-image-2',
    }],
    threadId: input.target,
  })
  cronMocks.sendAssistantMessageLocal.mockImplementationOnce(async (request: {
    onProviderRequestStarted?: () => Promise<void> | void
  }) => {
    await request.onProviderRequestStarted?.()
    await saveAssistantOutboxIntent(vaultRoot, intent)
    return {
      decision: {
        kind: 'send_message' as const,
        privateSummary: 'Queued the private generated image.',
        text: intent.message,
      },
      deliveryOutcome: {
        kind: 'queued' as const,
        error: null,
        intentId: intent.intentId,
        session: { sessionId: intent.sessionId },
      },
      response: intent.message,
      session: { sessionId: intent.sessionId },
    }
  })

  await expect(processDueAssistantCronJobsLocal({
    deliveryDispatchMode: 'queue-only',
    limit: 1,
    vault: vaultRoot,
  })).resolves.toEqual({
    failed: 0,
    processed: 1,
    succeeded: 0,
  })

  const actualChannelAdapters = await vi.importActual<
    typeof import('../src/assistant/channel-adapters.ts')
  >('../src/assistant/channel-adapters.ts')
  cronMocks.getAssistantChannelAdapter.mockImplementation(
    actualChannelAdapters.getAssistantChannelAdapter,
  )

  return {
    canonicalJob,
    imageBytes,
    intent,
    target: input.target,
    vaultRoot,
  }
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
