import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOSTED_RUNTIME_PROCESS_ENV,
} from '@murphai/hosted-execution/env'
import { AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG } from '@murphai/contracts'

type StoredAutomationRecord = {
  activeUntil?: string | null
  automationId: string
  assistantTargetOverride?: {
    model?: string | null
    modelProvider?: string | null
    reasoningEffort?: string | null
  } | null
  continuityPolicy: 'fresh' | 'preserve'
  contextReferences?: Array<{ entityId: string; entityKind: string }>
  instructions: string
  route: {
    channel: string
    deliverySource?: { kind: 'linq'; fromPhoneNumber: string } | null
    deliveryTarget: string | null
    identityId: string | null
    participantId: string | null
    threadIsDirect?: boolean | null
    threadId: string | null
  }
  schedule:
    | { kind: 'at'; at: string }
    | { kind: 'cron'; expression: string }
    | { kind: 'dailyLocal'; localTime: string }
    | {
        activityKind?: string
        after: string
        kind: 'deviceActivity'
        source?: 'whoop' | 'whoop_v2'
      }
    | { kind: 'every'; everyMs: number }
  slug: string
  status: 'active' | 'paused' | 'archived'
  summary: string | null
  tags: string[]
  title: string
}

const managedAutomationMocks = vi.hoisted(() => ({
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  listAutomations: vi.fn(),
  loadVault: vi.fn(),
  patchAutomation: vi.fn(),
  prepareExperimentLifecycleAutomations: vi.fn(),
  reconcileAutomationSupportSeriesNamespace: vi.fn(),
  records: new Map<string, StoredAutomationRecord>(),
  showAutomation: vi.fn(),
  upsertAssistantCronAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  listAutomations: managedAutomationMocks.listAutomations,
  loadVault: managedAutomationMocks.loadVault,
  patchAutomation: managedAutomationMocks.patchAutomation,
  reconcileAutomationSupportSeriesNamespace:
    managedAutomationMocks.reconcileAutomationSupportSeriesNamespace,
  showAutomation: managedAutomationMocks.showAutomation,
  upsertAutomation: managedAutomationMocks.upsertAutomation,
}))

vi.mock('../src/assistant/experiment-support-automations.ts', () => ({
  prepareExperimentLifecycleAutomations:
    managedAutomationMocks.prepareExperimentLifecycleAutomations,
}))

vi.mock('../src/assistant/cron/authoring.ts', () => ({
  upsertAssistantCronAutomation:
    managedAutomationMocks.upsertAssistantCronAutomation,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  applyAssistantSelfDeliveryTargetDefaults:
    managedAutomationMocks.applyAssistantSelfDeliveryTargetDefaults,
}))

vi.mock('@murphai/operator-config/assistant/current-delivery-route', () => ({
  getAssistantAutomationRouteDeliverabilityIssue: vi.fn((route) => {
    if (!route?.channel) {
      return {
        code: 'channel_required',
        message: 'channel required',
      }
    }

    if (
      route.channel === 'linq' &&
      route.deliveryTarget &&
      /^h1_[a-f0-9]{24}$/iu.test(route.deliveryTarget.trim())
    ) {
      return {
        code: 'linq_private_delivery_target',
        message: 'private delivery target',
      }
    }

    if (!route.deliveryTarget && !route.participantId && !route.threadId) {
      return {
        code: 'route_required',
        message: 'route required',
      }
    }

    return null
  }),
  looksLikePrivateAssistantRoutePlaceholder: vi.fn((value: string | null | undefined) =>
    value !== null &&
    value !== undefined &&
    /^h1_[a-f0-9]{24}$/iu.test(value.trim()),
  ),
  resolveAssistantDeliveryRouteWithCurrentRoute: vi.fn((route) => route),
  stripPrivateAssistantRoutePlaceholders: vi.fn((route) => route),
}))

vi.mock('../src/assistant/channel-adapters.ts', () => ({
  getAssistantChannelAdapter: managedAutomationMocks.getAssistantChannelAdapter,
  // The shared route rules in cron/targets.ts resolve binding deliveries
  // through the channel adapters; managed seeds always carry explicit routes.
  inferAssistantBindingDelivery: vi.fn(() => null),
}))

import {
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION,
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_PRIVATE_SUMMARY,
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  applyMurphManagedAutomations,
  ensureAutomaticMealCloseoutAutomation,
  resolveMurphManagedAutomationSeed,
  resolveMurphManagedMaintenancePolicy,
  type MurphManagedAutomationSeed,
} from '../src/assistant/managed-automations.ts'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../src/assistant/automation-tags.ts'
import {
  computeAssistantCronNextRunAt,
  findNextAssistantCronOccurrence,
} from '../src/assistant/cron/schedule.ts'

const vaultRoot = '/tmp/murph-managed-automations/vault'

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

const groupChatRoute = {
  channel: 'linq',
  deliverySource: null,
  deliveryTarget: 'linq-group-chat',
  identityId: 'linq-identity',
  participantId: 'linq-participant',
  threadId: 'linq-group-thread',
  threadIsDirect: false,
}

const EXPECTED_MANAGED_SPREAD_CRONS = {
  digest: { kind: 'cron', expression: '30 10 * * 2' },
  insight: { kind: 'cron', expression: '0 13 * * 0' },
  researchScout: { kind: 'cron', expression: '0 14 * * 3' },
} as const

const EXPECTED_PRODUCT_NOTES_SCHEDULE = {
  kind: 'every',
  everyMs: 14 * 24 * 60 * 60 * 1000,
} as const

const legacyOnboardingFollowupInstructions = [
  'This scheduled check helps continue Murph setup.',
  '',
  'First inspect onboarding status with `vault-cli assistant onboarding status`.',
  '',
  'If onboarding is completed or declined, run `vault-cli automation set-status finish-onboarding-followup --status archived` and return skip.',
  '',
  'If onboarding is still open, offer one brief, natural in-chat message inviting setup to continue. Keep it low-pressure, do not mention internal state, and do not use a fixed script.',
].join('\n')

beforeEach(() => {
  managedAutomationMocks.prepareExperimentLifecycleAutomations
    .mockReset()
    .mockResolvedValue({ processedCount: 0, seeds: [] })
  managedAutomationMocks.loadVault
    .mockReset()
    .mockResolvedValue({
      metadata: { vaultId: 'vault_managed_automations_test' },
    })
  managedAutomationMocks.records.clear()
  managedAutomationMocks.listAutomations
    .mockReset()
    .mockImplementation(async () => ({
      count: managedAutomationMocks.records.size,
      items: [...managedAutomationMocks.records.values()],
    }))
  managedAutomationMocks.getAssistantChannelAdapter
    .mockReset()
    .mockImplementation((channel) => channel ? { channel } : null)
  managedAutomationMocks.applyAssistantSelfDeliveryTargetDefaults
    .mockReset()
    .mockResolvedValue({
      channel: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    })
  managedAutomationMocks.showAutomation
    .mockReset()
    .mockImplementation(async (input: { automationId?: string; slug?: string }) => {
      if (input.automationId) {
        return managedAutomationMocks.records.get(input.automationId) ?? null
      }
      if (input.slug) {
        return [...managedAutomationMocks.records.values()]
          .find((record) => record.slug === input.slug) ?? null
      }
      return null
    })
  managedAutomationMocks.upsertAutomation
    .mockReset()
    .mockImplementation(async (input: {
      activeUntil?: string | null
      automationId?: string
      assistantTargetOverride?: StoredAutomationRecord['assistantTargetOverride']
      continuityPolicy: 'fresh' | 'preserve'
      contextReferences?: StoredAutomationRecord['contextReferences']
      instructions: string
      route: StoredAutomationRecord['route']
      schedule: StoredAutomationRecord['schedule']
      slug?: string
      status: StoredAutomationRecord['status']
      summary?: string
      tags?: string[]
      title: string
    }) => {
      const automationId = input.automationId ?? `automation_${managedAutomationMocks.records.size + 1}`
      const existing = managedAutomationMocks.records.get(automationId) ?? null
      const record: StoredAutomationRecord = {
        activeUntil:
          input.activeUntil === undefined
            ? existing?.activeUntil ?? null
            : input.activeUntil,
        automationId,
        assistantTargetOverride:
          input.assistantTargetOverride === undefined
            ? existing?.assistantTargetOverride ?? null
            : input.assistantTargetOverride,
        continuityPolicy: input.continuityPolicy,
        contextReferences:
          input.contextReferences === undefined
            ? existing?.contextReferences ?? []
            : [...input.contextReferences],
        instructions: input.instructions,
        route: input.route,
        schedule: input.schedule,
        slug: input.slug ?? existing?.slug ?? input.title.toLowerCase().replace(/\s+/gu, '-'),
        status: input.status,
        summary: input.summary ?? existing?.summary ?? null,
        tags: input.tags ?? [],
        title: input.title,
      }

      managedAutomationMocks.records.set(record.automationId, record)
      return {
        auditPath: 'audit/mock.jsonl',
        created: !existing,
        record,
      }
    })
  managedAutomationMocks.patchAutomation
    .mockReset()
    .mockImplementation(async (input: {
      activeUntil?: string | null
      assistantTargetOverride?: StoredAutomationRecord['assistantTargetOverride']
      continuityPolicy?: 'fresh' | 'preserve'
      contextReferences?: StoredAutomationRecord['contextReferences']
      instructions?: string
      lookup: string
      route?: StoredAutomationRecord['route']
      schedule?: StoredAutomationRecord['schedule']
      slug?: string
      status?: StoredAutomationRecord['status']
      summary?: string | null
      tags?: string[]
      title?: string
    }) => {
      const existing = [...managedAutomationMocks.records.values()]
        .find((record) =>
          record.automationId === input.lookup || record.slug === input.lookup
        )
      if (!existing) {
        throw new Error('Automation was not found.')
      }

      const record: StoredAutomationRecord = {
        ...existing,
        activeUntil:
          input.activeUntil === undefined
            ? existing.activeUntil
            : input.activeUntil,
        assistantTargetOverride:
          input.assistantTargetOverride === undefined
            ? existing.assistantTargetOverride
            : input.assistantTargetOverride,
        continuityPolicy: input.continuityPolicy ?? existing.continuityPolicy,
        contextReferences:
          input.contextReferences === undefined
            ? existing.contextReferences
            : [...input.contextReferences],
        instructions: input.instructions ?? existing.instructions,
        route: input.route ?? existing.route,
        schedule: input.schedule ?? existing.schedule,
        slug: input.slug ?? existing.slug,
        status: input.status ?? existing.status,
        summary: input.summary === undefined ? existing.summary : input.summary,
        tags: input.tags ?? existing.tags,
        title: input.title ?? existing.title,
      }

      managedAutomationMocks.records.set(record.automationId, record)
      return {
        auditPath: 'audit/mock.jsonl',
        created: false,
        record,
      }
    })
  managedAutomationMocks.upsertAssistantCronAutomation
    .mockReset()
    .mockImplementation(async (input: {
      activeUntil?: string | null
      instructions: string
      route: StoredAutomationRecord['route']
      schedule: StoredAutomationRecord['schedule']
      slug: string
      summary?: string | null
      tags?: string[]
      title: string
    }) => {
      const existing = [...managedAutomationMocks.records.values()]
        .find((record) => record.slug === input.slug)
      if (!existing || existing.status === 'archived') {
        return null
      }
      const record: StoredAutomationRecord = {
        ...existing,
        activeUntil:
          input.activeUntil === undefined
            ? existing.activeUntil
            : input.activeUntil,
        instructions: input.instructions,
        route: input.route,
        schedule: input.schedule,
        summary: input.summary ?? existing.summary,
        tags: input.tags ?? existing.tags,
        title: input.title,
      }
      managedAutomationMocks.records.set(record.automationId, record)
      return { jobId: record.automationId }
    })
  managedAutomationMocks.reconcileAutomationSupportSeriesNamespace
    .mockReset()
    .mockImplementation(async (input: {
      desiredSeries: Array<{
        desiredAutomationIds: string[]
        supportSeriesTag: string
      }>
      seriesIdPrefix: string
      shouldYield?: (() => boolean) | null
    }) => {
      const desiredIdsByTag = new Map(
        input.desiredSeries.map((series) => [
          series.supportSeriesTag,
          new Set(series.desiredAutomationIds),
        ]),
      )
      let archivedCount = 0
      let matchedCount = 0
      for (const record of managedAutomationMocks.records.values()) {
        const supportSeriesTag = record.tags.find((tag) =>
          tag.startsWith(`system:support-series:${input.seriesIdPrefix}`)
        )
        if (!supportSeriesTag) {
          continue
        }
        matchedCount += 1
        if (
          desiredIdsByTag.get(supportSeriesTag)?.has(record.automationId) !== true &&
          record.status === 'active'
        ) {
          record.status = 'archived'
          if (!record.tags.includes(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG)) {
            record.tags.push(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG)
          }
          archivedCount += 1
        }
      }
      return {
        archivedCount,
        auditPath: archivedCount > 0 ? 'audit/mock-support-series.jsonl' : null,
        matchedCount,
        missingDesiredAutomationIds: [],
        unchangedCount: matchedCount - archivedCount,
      }
    })
})

describe('applyMurphManagedAutomations', () => {
  it('stops seed writes at a foreground yield boundary and resumes without duplicating partial state', async () => {
    const seeds: MurphManagedAutomationSeed[] = [
      {
        automationId: 'automation_preemption_first',
        continuityPolicy: 'fresh',
        instructions: 'Create the first bounded maintenance record.',
        schedule: { kind: 'at', at: '2026-06-10T13:00:00.000Z' },
        slug: 'preemption-first',
        title: 'Preemption first',
      },
      {
        automationId: 'automation_preemption_second',
        continuityPolicy: 'fresh',
        instructions: 'Create the second bounded maintenance record.',
        schedule: { kind: 'at', at: '2026-06-10T14:00:00.000Z' },
        slug: 'preemption-second',
        title: 'Preemption second',
      },
    ]
    const shouldYield = vi.fn(
      () => managedAutomationMocks.upsertAutomation.mock.calls.length >= 1,
    )

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      seeds,
      shouldYield,
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
      yielded: true,
    })
    expect(managedAutomationMocks.records.has(seeds[0]!.automationId)).toBe(true)
    expect(managedAutomationMocks.records.has(seeds[1]!.automationId)).toBe(false)
    expect(managedAutomationMocks.reconcileAutomationSupportSeriesNamespace)
      .not.toHaveBeenCalled()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:01.000Z'),
      seeds,
      shouldYield: () => false,
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 1,
      updated: 0,
    })
    expect(managedAutomationMocks.records.has(seeds[0]!.automationId)).toBe(true)
    expect(managedAutomationMocks.records.has(seeds[1]!.automationId)).toBe(true)
  })

  it('threads the foreground yield hook through experiment lifecycle preparation', async () => {
    let shouldYieldNow = false
    const shouldYield = vi.fn(() => shouldYieldNow)
    managedAutomationMocks.prepareExperimentLifecycleAutomations
      .mockImplementationOnce(async (input) => {
        expect(input.shouldYield).toBe(shouldYield)
        shouldYieldNow = true
        return { processedCount: 0, seeds: [], yielded: true }
      })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      shouldYield,
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 0,
      updated: 0,
      yielded: true,
    })
    expect(managedAutomationMocks.showAutomation).toHaveBeenCalledOnce()
    expect(managedAutomationMocks.showAutomation).toHaveBeenCalledWith({
      automationId: 'automation_01K55N7S9X4Q2M6P8R3T0V1WYZ',
      vaultRoot,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('keeps desired experiment support members and archives exact stale series members', async () => {
    const desiredSeriesTag =
      'system:support-series:experiment-lifecycle:exp_DESIRED_SUPPORT_SERIES'
    const progressSeed: MurphManagedAutomationSeed = {
      automationId: 'automation_desired_progress',
      continuityPolicy: 'fresh',
      contextReferences: [{
        entityId: 'exp_DESIRED_SUPPORT_SERIES',
        entityKind: 'experiment',
      }],
      instructions: 'Send the desired progress milestone.',
      schedule: { kind: 'at', at: '2026-06-09T13:00:00.000Z' },
      slug: 'experiment-progress-desired-day-4',
      tags: ['experiment', 'progress-card', desiredSeriesTag],
      title: 'First progress · Desired',
    }
    const finalSeed: MurphManagedAutomationSeed = {
      automationId: 'automation_desired_final',
      continuityPolicy: 'fresh',
      instructions: 'Send the required final review.',
      schedule: { kind: 'at', at: '2026-06-10T13:00:00.000Z' },
      slug: 'experiment-final-results-desired',
      tags: [
        'experiment',
        'final-results',
        desiredSeriesTag,
        ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
      ],
      title: 'Final results · Desired',
    }
    managedAutomationMocks.prepareExperimentLifecycleAutomations.mockResolvedValueOnce({
      processedCount: 0,
      seeds: [progressSeed, finalSeed],
    })

    const staleSameSeries: StoredAutomationRecord = {
      automationId: 'automation_stale_same_series',
      continuityPolicy: 'fresh',
      instructions: 'Obsolete support step.',
      route: defaultRoute,
      schedule: { kind: 'at', at: '2026-06-11T13:00:00.000Z' },
      slug: 'experiment-obsolete-desired',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed', desiredSeriesTag],
      title: 'Obsolete support step',
    }
    const inactiveSeries: StoredAutomationRecord = {
      ...staleSameSeries,
      automationId: 'automation_inactive_series_final',
      slug: 'experiment-final-results-inactive',
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        'system:support-series:experiment-lifecycle:exp_INACTIVE_SUPPORT_SERIES',
      ],
      title: 'Inactive final results',
    }
    const outsideNamespace: StoredAutomationRecord = {
      ...staleSameSeries,
      automationId: 'automation_outside_experiment_namespace',
      slug: 'outside-experiment-support',
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        'system:support-series:experiment:exp_MANUAL_SUPPORT_SERIES',
      ],
      title: 'Outside experiment namespace',
    }
    managedAutomationMocks.records.set(staleSameSeries.automationId, staleSameSeries)
    managedAutomationMocks.records.set(inactiveSeries.automationId, inactiveSeries)
    managedAutomationMocks.records.set(outsideNamespace.automationId, outsideNamespace)

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(managedAutomationMocks.reconcileAutomationSupportSeriesNamespace)
      .toHaveBeenCalledWith({
        desiredSeries: [{
          desiredAutomationIds: [
            progressSeed.automationId,
            finalSeed.automationId,
          ],
          supportSeriesTag: desiredSeriesTag,
        }],
        now: new Date('2026-06-09T12:00:00.000Z'),
        seriesIdPrefix: 'experiment-lifecycle:',
        shouldYield: null,
        vaultRoot,
      })
    expect(managedAutomationMocks.records.get(progressSeed.automationId)).toMatchObject({
      contextReferences: [{
        entityId: 'exp_DESIRED_SUPPORT_SERIES',
        entityKind: 'experiment',
      }],
      status: 'active',
    })
    expect(managedAutomationMocks.records.get(finalSeed.automationId)?.tags)
      .toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(managedAutomationMocks.records.get(staleSameSeries.automationId)?.status)
      .toBe('archived')
    expect(managedAutomationMocks.records.get(inactiveSeries.automationId)?.status)
      .toBe('archived')
    expect(managedAutomationMocks.records.get(outsideNamespace.automationId)?.status)
      .toBe('active')
    expect(result.updated).toBe(2)
  })

  it('propagates an owner-level support reconciliation yield without applying archive counts', async () => {
    const shouldYield = vi.fn(() => false)
    managedAutomationMocks.reconcileAutomationSupportSeriesNamespace
      .mockImplementationOnce(async (input) => {
        expect(input.shouldYield).toBe(shouldYield)
        return {
          archivedCount: 0,
          auditPath: null,
          matchedCount: 0,
          missingDesiredAutomationIds: [],
          unchangedCount: 0,
          yielded: true as const,
        }
      })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      shouldYield,
      vaultRoot,
    })).resolves.toMatchObject({
      yielded: true,
      updated: 0,
    })
  })

  it('propagates experiment support reconciliation failures after partial setup', async () => {
    const reconciliationFailure = new Error('support series reconciliation failed')
    managedAutomationMocks.reconcileAutomationSupportSeriesNamespace
      .mockRejectedValueOnce(reconciliationFailure)

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).rejects.toBe(reconciliationFailure)
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalled()
  })

  it('reactivates a future lifecycle review after consent is revoked then restored', async () => {
    const supportSeriesTag =
      'system:support-series:experiment-lifecycle:exp_RECONSENT'
    const finalSeed: MurphManagedAutomationSeed = {
      activeUntil: '2026-06-17T13:00:00.000Z',
      automationId: 'automation_reconsent_final',
      continuityPolicy: 'fresh',
      instructions: 'Send the consented final review.',
      schedule: { kind: 'at', at: '2026-06-10T13:00:00.000Z' },
      slug: 'experiment-final-results-reconsent',
      tags: [
        'experiment',
        'final-results',
        supportSeriesTag,
        ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
      ],
      title: 'Final results · Reconsent',
    }
    managedAutomationMocks.records.set(finalSeed.automationId, {
      activeUntil: finalSeed.activeUntil,
      automationId: finalSeed.automationId,
      continuityPolicy: 'fresh',
      instructions: finalSeed.instructions,
      route: defaultRoute,
      schedule: finalSeed.schedule,
      slug: finalSeed.slug,
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed', ...(finalSeed.tags ?? [])],
      title: finalSeed.title,
    })
    managedAutomationMocks.prepareExperimentLifecycleAutomations
      .mockResolvedValueOnce({ processedCount: 0, seeds: [] })
      .mockResolvedValueOnce({ processedCount: 0, seeds: [finalSeed] })

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T10:00:00.000Z'),
      vaultRoot,
    })
    expect(managedAutomationMocks.records.get(finalSeed.automationId)).toMatchObject({
      status: 'archived',
      tags: expect.arrayContaining([
        AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
      ]),
    })

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T11:00:00.000Z'),
      vaultRoot,
    })
    expect(managedAutomationMocks.records.get(finalSeed.automationId)).toMatchObject({
      status: 'active',
      tags: expect.not.arrayContaining([
        AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
      ]),
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: finalSeed.automationId,
        status: 'active',
      }),
    )
  })

  it('reactivates a future progress milestone after an experiment pauses then resumes', async () => {
    const supportSeriesTag =
      'system:support-series:experiment-lifecycle:exp_RESUMED'
    const progressSeed: MurphManagedAutomationSeed = {
      automationId: 'automation_resumed_progress',
      continuityPolicy: 'fresh',
      instructions: 'Send the resumed progress milestone.',
      schedule: { kind: 'at', at: '2026-06-10T13:00:00.000Z' },
      slug: 'experiment-progress-resumed-day-4',
      tags: ['experiment', 'progress-card', 'milestone', supportSeriesTag],
      title: 'First progress · Resumed',
    }
    managedAutomationMocks.records.set(progressSeed.automationId, {
      automationId: progressSeed.automationId,
      continuityPolicy: 'fresh',
      instructions: progressSeed.instructions,
      route: defaultRoute,
      schedule: progressSeed.schedule,
      slug: progressSeed.slug,
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed', ...(progressSeed.tags ?? [])],
      title: progressSeed.title,
    })
    managedAutomationMocks.prepareExperimentLifecycleAutomations
      .mockResolvedValueOnce({ processedCount: 0, seeds: [] })
      .mockResolvedValueOnce({ processedCount: 0, seeds: [progressSeed] })

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T10:00:00.000Z'),
      vaultRoot,
    })
    expect(managedAutomationMocks.records.get(progressSeed.automationId)?.status)
      .toBe('archived')

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T11:00:00.000Z'),
      vaultRoot,
    })
    expect(managedAutomationMocks.records.get(progressSeed.automationId)).toMatchObject({
      status: 'active',
      tags: expect.not.arrayContaining([
        AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
      ]),
    })
  })

  it('never reactivates a consumed lifecycle one-shot archived without reconcile ownership', async () => {
    const supportSeriesTag =
      'system:support-series:experiment-lifecycle:exp_CONSUMED'
    const consumedSeed: MurphManagedAutomationSeed = {
      activeUntil: '2026-06-17T13:00:00.000Z',
      automationId: 'automation_consumed_final',
      continuityPolicy: 'fresh',
      instructions: 'Do not deliver this consumed review again.',
      schedule: { kind: 'at', at: '2026-06-10T13:00:00.000Z' },
      slug: 'experiment-final-results-consumed',
      tags: ['experiment', 'final-results', supportSeriesTag],
      title: 'Final results · Consumed',
    }
    managedAutomationMocks.records.set(consumedSeed.automationId, {
      activeUntil: consumedSeed.activeUntil,
      automationId: consumedSeed.automationId,
      continuityPolicy: 'fresh',
      instructions: consumedSeed.instructions,
      route: defaultRoute,
      schedule: consumedSeed.schedule,
      slug: consumedSeed.slug,
      status: 'archived',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed', ...(consumedSeed.tags ?? [])],
      title: consumedSeed.title,
    })
    managedAutomationMocks.prepareExperimentLifecycleAutomations.mockResolvedValueOnce({
      processedCount: 0,
      seeds: [consumedSeed],
    })

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T11:00:00.000Z'),
      vaultRoot,
    })

    expect(managedAutomationMocks.records.get(consumedSeed.automationId)?.status)
      .toBe('archived')
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalledWith(
      expect.objectContaining({ automationId: consumedSeed.automationId }),
    )
  })

  it('does not reactivate a reconcile-marked lifecycle one-shot at its fire boundary', async () => {
    const supportSeriesTag =
      'system:support-series:experiment-lifecycle:exp_BOUNDARY'
    const boundarySeed: MurphManagedAutomationSeed = {
      activeUntil: '2026-06-17T13:00:00.000Z',
      automationId: 'automation_reactivation_boundary',
      continuityPolicy: 'fresh',
      instructions: 'Do not resurrect at the fire boundary.',
      schedule: { kind: 'at', at: '2026-06-10T13:00:00.000Z' },
      slug: 'experiment-final-results-reactivation-boundary',
      tags: ['experiment', 'final-results', supportSeriesTag],
      title: 'Final results · Reactivation Boundary',
    }
    managedAutomationMocks.records.set(boundarySeed.automationId, {
      activeUntil: boundarySeed.activeUntil,
      automationId: boundarySeed.automationId,
      continuityPolicy: 'fresh',
      instructions: boundarySeed.instructions,
      route: defaultRoute,
      schedule: boundarySeed.schedule,
      slug: boundarySeed.slug,
      status: 'archived',
      summary: null,
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        ...(boundarySeed.tags ?? []),
        AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
      ],
      title: boundarySeed.title,
    })
    managedAutomationMocks.prepareExperimentLifecycleAutomations.mockResolvedValueOnce({
      processedCount: 0,
      seeds: [boundarySeed],
    })

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-10T13:00:00.000Z'),
      vaultRoot,
    })

    expect(managedAutomationMocks.records.get(boundarySeed.automationId)?.status)
      .toBe('archived')
  })

  it('keeps the managed weekly health insight seed as the baseline Sunday noon recurrence', () => {
    const insightSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    if (!insightSeed || insightSeed.schedule.kind !== 'cron') {
      throw new Error('Expected the weekly health insight to use a cron schedule.')
    }

    expect(insightSeed.schedule.expression).toBe('0 12 * * 0')
    expect(insightSeed.instructions).toContain('On this scheduled weekly run')
    expect(insightSeed.assistantTargetOverride).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(insightSeed.instructions).not.toContain('Sunday at noon local time')
    expect(insightSeed.instructions).not.toContain('Wednesday')
    expect(insightSeed.instructions).not.toContain('Friday at 2:30 PM local time')
    expect(insightSeed.instructions).toContain(
      'A consumer sleep-stage estimate by itself is never a weekly finding or reason to coach.',
    )
    expect(insightSeed.instructions).toContain('Never infer alcohol use from a bad night')
    expect(insightSeed.instructions).toContain(
      'Do not send a weekly insight whose main point is that drinking or a late Friday/Saturday night hurt sleep or recovery',
    )
    expect(insightSeed.instructions).not.toContain('rough portions, alcohol')
    expect(insightSeed.instructions).not.toContain('drink count')
    expect(insightSeed.instructions).not.toContain('alcohol plus travel day')
    expect(insightSeed.instructions).toContain(
      'One weekly window or a repeated correlation can support "lined up with" or "was associated with," not "caused," "explains," or "proved."',
    )
    expect(insightSeed.instructions).toContain(
      'Check plausible alternatives and confounders.',
    )
    expect(insightSeed.instructions).not.toContain(
      'The recovery dip looked tied to stacking hard days',
    )

    const nextRunAt = findNextAssistantCronOccurrence(
      insightSeed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-06-21T16:00:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the weekly health insight cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      insightSeed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-06-28T16:00:00.000Z')
  })

  it('keeps the managed monthly improvement coach seed on the first day of each month', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) => entry.automationId === MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
    )
    if (!seed || seed.schedule.kind !== 'cron') {
      throw new Error('Expected the monthly improvement coach to use a cron schedule.')
    }

    expect(seed.schedule.expression).toBe('0 17 1 * *')
    expect(seed.slug).toBe('monthly-improvement-coach')
    expect(seed.title).toBe('Monthly improvement coach')
    expect(seed.summary).toBe(
      'A monthly check for one user-relevant health friction worth offering help with.',
    )
    expect(seed.assistantTargetOverride).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(seed.tags).toContain('murph-managed:monthly-improvement-coach')
    expect(seed.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(seed.instructions).toContain('knowledge show improvement-opportunities')
    expect(seed.instructions).toContain(
      'knowledge append-section improvement-opportunities YYYY-MM-DD',
    )
    expect(seed.instructions).toContain(
      '{"kind":"skip","privateSummary":"No monthly improvement opportunity cleared the evidence and taste bars, and no open check-in was due."}',
    )
    expect(seed.instructions).toContain('Every completed run must leave one compact private decision record')
    expect(seed.instructions).toContain('only run and outreach ledger')
    expect(seed.instructions).toContain('at most once in any 30-day window')
    expect(seed.instructions).toContain(
      'If no earlier record has `outreach: delivery_requested`, the unanswered-question gate does not block outreach',
    )
    expect(seed.instructions).toContain(
      'platform context affirmatively proves that request never entered dispatch',
    )
    expect(seed.instructions).toContain('An unrelated inbound does not close it')
    expect(seed.instructions).toContain(
      'answered, declined, acknowledged, or otherwise closed that coach question',
    )
    expect(seed.instructions).toContain('outreach: delivery_requested')
    expect(seed.instructions).toContain(
      'engine-supplied `Occurrence local date` from the Scheduled occurrence context',
    )
    expect(seed.instructions).toContain('the later-occurrence closure gate does not apply')
    expect(seed.instructions).toContain('engine-described valid delivery retry')
    expect(seed.instructions).toContain(
      'stable labels for `outcome`, `evidence_window`, `checked`, `decision`, and `outreach`',
    )
    expect(seed.instructions).toContain('record that exact text under `outbound_text`')
    expect(seed.instructions).toContain('return the exact same text byte-for-byte')
    expect(seed.instructions).toContain('Use `delivery_requested`, never `sent` or `delivered`')
    expect(seed.instructions).toContain(
      'an active health concern, an unanswered proactive health question, a decline, or a request for less outreach',
    )
    expect(seed.instructions).toContain(
      'If the section cannot be appended and read back, send nothing',
    )
    expect(seed.instructions).toContain(
      'Keep the body factual and compact, not a scratchpad or hidden chain of thought',
    )
    expect(seed.instructions).not.toContain('do not append to the ledger')
    expect(seed.instructions).toContain(
      'Never infer absence of a behavior from absence of data',
    )
    expect(seed.instructions).toContain(
      'Start from an explicit active goal, concern, symptom, experiment, request for help, or recurring friction',
    )
    expect(seed.instructions).toContain(
      'Describe a practical friction, mismatch, or design problem—not a deficit, failure, slip, lack of discipline, or compliance problem.',
    )
    expect(seed.instructions).toContain(
      'consumer deep/REM estimates and vendor sleep scores cannot create an opportunity on their own',
    )
    expect(seed.instructions).toContain(
      'A metric being lower than a population target or lower than months ago does not create permission to coach.',
    )
    expect(seed.instructions).not.toContain(
      'Deep sleep or total sleep consistently well below typical reference ranges.',
    )
    expect(seed.instructions).not.toContain('most adults get 1.5 to 2 hours')

    const nextRunAt = findNextAssistantCronOccurrence(
      seed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-07-01T21:00:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the monthly improvement coach cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      seed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-08-01T21:00:00.000Z')
  })

  it('keeps the managed weekly health research scout seed as the baseline Wednesday evening recurrence', () => {
    const researchScoutSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    if (!researchScoutSeed || researchScoutSeed.schedule.kind !== 'cron') {
      throw new Error('Expected the weekly health research scout to use a cron schedule.')
    }

    expect(researchScoutSeed.schedule.expression).toBe('30 19 * * 3')
    expect(researchScoutSeed.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
    })
    expect(researchScoutSeed.instructions).toContain('On this scheduled weekly run')
    expect(researchScoutSeed.instructions).not.toContain('7:30 PM local time')
    expect(researchScoutSeed.instructions).not.toContain('Friday morning')

    const nextRunAt = findNextAssistantCronOccurrence(
      researchScoutSeed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-06-24T23:30:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the weekly health research scout cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      researchScoutSeed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-07-01T23:30:00.000Z')
  })

  it('runs alternating product notes every two weeks', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) => entry.automationId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    if (!seed) {
      throw new Error('Expected managed product notes to exist.')
    }

    expect(seed.schedule).toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)
    expect(seed.title).toBe('Murph product notes')
    expect(seed.summary).toBe('A biweekly personalized note alternating what is new in Murph with things Murph can do for you.')
    expect(seed.instructions).toContain('Goal: every two weeks')
    expect(seed.instructions).toContain('/api/changelog?days=14&featureLimit=70&improvementLimit=10')
    expect(seed.instructions).toContain('/api/feature-catalog')
    expect(seed.instructions).toContain('Read `vault-cli knowledge show murph-product-notes`')
    expect(seed.instructions).toContain('choose the feature discovery kind')
    expect(seed.instructions).toContain('last recorded changelog means feature discovery now')
    expect(seed.instructions).toContain('last recorded feature discovery means changelog now')
    expect(seed.instructions).toContain('Use `murph-product-notes` as the only ledger')
    expect(seed.instructions).toContain('vault-cli knowledge append-section murph-product-notes YYYY-MM-DD')
    expect(seed.instructions).toContain('Fallback is allowed at most once')
    expect(seed.instructions).toContain('never fall back from a fallback')
    expect(seed.instructions).toContain('If both kinds are unavailable, invalid, empty, or below bar')
    expect(seed.instructions).toContain('record only this run\'s kind and the chosen item ids')
    expect(seed.instructions).toContain('do not include reasons, user context, health details, raw user wording, provider data, or copied catalog/changelog text')
    expect(seed.instructions).toContain('another run already recorded today\'s note')
    expect(seed.instructions).toContain('Do not append again and do not switch kinds')
    expect(seed.instructions).toContain('2-3 recently shipped Murph updates')
    expect(seed.instructions).toContain('2-3 things Murph can already do')
    expect(seed.instructions).toContain('Do not pad with weak matches')
    expect(seed.instructions).toContain('member-facing product update, not a dump of release notes')
    expect(seed.instructions).toContain('introduces or materially changes a member-facing action, decision, or visible experience')
    expect(seed.instructions).toContain('Never pitch reliability work.')
    expect(seed.instructions).toContain('only restores or hardens otherwise unchanged behavior or reports internal durability')
    expect(seed.instructions).not.toContain('member encountered the corresponding issue')
    expect(seed.instructions).toContain('lower priority than exciting capabilities')
    expect(seed.instructions).toContain('if neither kind clears, skip')
    expect(seed.instructions).toContain('Drop items the user is already using')
    expect(seed.instructions).toContain('context already surfaced for ordinary assistance')
    expect(seed.instructions).toContain('Require positive eligibility evidence')
    expect(seed.instructions).toContain('any active or reconnect-required wearable means the feature is already in use')
    expect(seed.instructions).toContain('if wearable connection status context is absent or unclear, drop it')
    expect(seed.instructions).toContain('Do not open raw health records, uploaded documents, inbox attachments, provider payloads, transcripts, or raw notes solely to decide whether a feature was used')
    expect(seed.instructions).toContain('Drop items already pitched in any prior ledger section; never repeat a feature pitch')
    expect(seed.instructions).toContain('If an item lists a requires prerequisite')
    expect(seed.instructions).toContain('Drop items this conversation cannot actually do right now')
    expect(seed.instructions).toContain('Keep this scheduled note text-only')
    expect(seed.instructions).toContain('The outbound note must be link-free')
    expect(seed.instructions).toContain('no more than 28 words after the bullet marker')
    expect(seed.instructions).toContain('preserve required prerequisites, availability limits, and approval or confirmation boundaries')
    expect(seed.instructions).toContain('Open every outbound note with one sentence of no more than 20 words before the first bullet')
    expect(seed.instructions).toContain("In Murph's first-person voice")
    expect(seed.instructions).not.toContain('If the ledger page was missing before this run')
    expect(seed.instructions).toContain('Close with one invitation sentence of no more than 12 words')
    expect(seed.instructions).not.toContain('canonical title, summary, URL, and tryIt fields')
    expect(seed.instructions).not.toContain('Choose 3-7 items')
    expect(seed.instructions).not.toContain('murph.attach_response_media')
    expect(seed.instructions).not.toContain('visual digest')
    expect(seed.instructions).not.toContain('links.digestCardTemplate')
    expect(seed.instructions).toContain('murph.submit_product_feedback')
    expect(seed.instructions).toContain('clear inferred workflow friction')
    expect(seed.instructions).toContain('interest in shipped changelog or catalog items')
    expect(seed.instructions).toContain('Speculative:')
    expect(seed.instructions).toContain('Murph-observed:')
    expect(seed.instructions).toContain('Do not log vague low-confidence guesses')
    expect(seed.instructions).toContain('concise product-only summary')
    expect(seed.instructions).toContain('tags, topics, raw user wording')
    expect(seed.instructions).not.toContain('kind/topic')
    expect(seed.instructions).toContain(
      '{"kind":"skip","privateSummary":"No product note cleared the send bar."}',
    )
    expect(computeAssistantCronNextRunAt(
      seed.schedule,
      new Date('2026-06-22T12:00:00.000Z'),
    )).toBe('2026-07-06T12:00:00.000Z')
  })

  it('keeps the group room model as a lightweight twice-weekly group-only maintenance seed', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) =>
        entry.automationId === MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
    )
    if (!seed || seed.schedule.kind !== 'cron') {
      throw new Error('Expected the group room model consolidation cron seed.')
    }

    expect(seed.ownerScope).toBe('authenticated-group')
    expect(seed.automationId).toMatch(/^automation_[0-9A-HJKMNP-TV-Z]{26}$/u)
    expect(seed.schedule.expression).toBe('0 4 * * 2,5')
    expect(seed.continuityPolicy).toBe('fresh')
    expect(seed.hostedRuntimeOnly).toBe(true)
    expect(seed.assistantTargetOverride).toEqual({ reasoningEffort: 'high' })
    expect(seed.instructions).toContain('lightweight list of likely tips')
    expect(seed.instructions).toContain('who gets teased about what')
    expect(seed.instructions).toContain(
      'Never copy a raw handle into the page',
    )
    expect(seed.instructions).toContain('exact `expectedDigest` returned by show')
    expect(seed.instructions).toContain('`## Explicit setup` section')
    expect(seed.instructions).toContain('preserve that section verbatim')
    expect(seed.instructions).toContain('explicit request to revise or forget it')
    expect(seed.instructions).toContain('Target roughly 2-6 KiB')
    expect(seed.instructions).toContain('20 KiB as a generous soft ceiling')
    expect(seed.instructions).toContain('never a write gate')
    expect(seed.instructions).toContain(
      'is itself a material maintenance improvement even when no new room lore emerged',
    )
    expect(seed.instructions).toContain('Treat the page as advisory')
    expect(seed.instructions).toContain(
      'do not encode a blanket "most turns use none" rule',
    )
    expect(seed.instructions).toContain(
      `{"kind":"skip","privateSummary":"${MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_PRIVATE_SUMMARY}"}`,
    )
    expect(resolveMurphManagedMaintenancePolicy(seed.automationId)).toEqual({
      privateSummary: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_PRIVATE_SUMMARY,
      profile: 'group-room-model',
    })
    expect(
      resolveMurphManagedMaintenancePolicy('automation_user_runtime_maintenance'),
    ).toBeNull()
  })

  it('resolves the immutable group-owned seed by id', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) =>
        entry.automationId === MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
    )
    if (!seed || seed.schedule.kind !== 'cron') {
      throw new Error('Expected the group room-model cron seed.')
    }

    expect(seed).toMatchObject({
      automationId: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      hostedRuntimeOnly: true,
      ownerScope: 'authenticated-group',
      schedule: { kind: 'cron', expression: '0 4 * * 2,5' },
      slug: 'group-room-model-consolidation',
    })
    expect(resolveMurphManagedAutomationSeed(seed.automationId)).toBe(seed)
    expect(resolveMurphManagedAutomationSeed('automation_custom')).toBeNull()
  })

  it('installs the automatic meal closeout idempotently at 9pm local time', async () => {
    const onDiagnosticStage = vi.fn()
    const onboardingFollowup: StoredAutomationRecord = {
      automationId: 'automation_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: 'Existing onboarding follow-up instructions.',
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:47',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: 'Existing onboarding follow-up summary.',
      tags: ['assistant', 'scheduled', 'murph-managed', 'murph-managed:onboarding-followup'],
      title: 'Existing onboarding follow-up',
    }
    managedAutomationMocks.records.set(
      onboardingFollowup.automationId,
      onboardingFollowup,
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION).toMatchObject({
      automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
      ownerScope: 'member',
      schedule: {
        kind: 'dailyLocal',
        localTime: '21:00',
      },
      slug: 'automatic-meal-daily-closeout',
    })
    expect(MURPH_MANAGED_AUTOMATIONS).not.toContainEqual(
      MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION,
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain(
      'single owner of the closeout workflow',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain(
      'engine-supplied `Occurrence local date` from the Scheduled occurrence context',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain(
      'even when the wall-clock `Today\'s date` differs',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain(
      'If the skill selects neither a retained photo nor a same-occurrence removal revision',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).not.toContain(
      '`externalRef.system: meal-photo-capture`',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).not.toContain(
      '`vault-cli meal list`',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).not.toContain(
      '`vault-cli meal remove-photo <meal-id>`',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).not.toContain(
      'preceding 31 local days',
    )
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain(
      'A removal failure or any selected photo remaining fails the run',
    )

    await expect(ensureAutomaticMealCloseoutAutomation({
      defaultRoute,
      now: new Date('2026-07-22T15:00:00.000Z'),
      onDiagnosticStage,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '21:00',
      },
      status: 'active',
    })
    await expect(ensureAutomaticMealCloseoutAutomation({
      defaultRoute,
      now: new Date('2026-07-22T15:01:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
    })

    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledTimes(1)
    expect(onDiagnosticStage).not.toHaveBeenCalledWith({
      stage: 'onboarding_followup',
    })
    expect(managedAutomationMocks.patchAutomation).not.toHaveBeenCalled()
    expect(
      managedAutomationMocks.records.get(onboardingFollowup.automationId),
    ).toEqual(onboardingFollowup)

    const stored = managedAutomationMocks.records.get(
      MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
    )
    if (!stored) {
      throw new Error('Expected the automatic meal closeout to be stored.')
    }
    stored.status = 'archived'
    await expect(ensureAutomaticMealCloseoutAutomation({
      defaultRoute,
      now: new Date('2026-07-22T15:02:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
      status: 'archived',
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledTimes(1)
  })

  it('keeps overnight memory consolidation as a hosted-only every-other-night maintenance seed', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) =>
        entry.automationId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    if (!seed || seed.schedule.kind !== 'cron') {
      throw new Error('Expected overnight memory consolidation to use a cron schedule.')
    }

    expect(seed.hostedRuntimeOnly).toBe(true)
    expect(seed.continuityPolicy).toBe('fresh')
    expect(seed.assistantTargetOverride).toEqual({
      reasoningEffort: 'medium',
    })
    expect(seed.schedule.expression).toBe('0 3 * * 1,3,5')
    expect(seed.slug).toBe('overnight-memory-consolidation')
    expect(seed.tags).toContain('murph-managed:overnight-memory-consolidation')
    expect(seed.tags).toContain('runtime-maintenance')
    expect(seed.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(seed.instructions).toContain('Goal: consolidate durable user context')
    expect(seed.instructions).toContain('engine-supplied "Conversation evidence" section')
    expect(seed.instructions).toContain('bounded committed user and assistant conversation messages from the last 7 days')
    expect(seed.instructions).toContain('supplied conversation evidence')
    expect(seed.instructions).toContain('vault-cli memory show --format json')
    expect(seed.instructions).toContain('vault-cli memory upsert')
    expect(seed.instructions).toContain('vault-cli memory update')
    expect(seed.instructions).toContain('hidden Codex memory state')
    expect(seed.instructions).toContain('Do not read transcript files or session storage')
    expect(seed.instructions).toContain('Do not save assistant speculation')
    expect(seed.instructions).toContain('identifiers of any kind, or medical or health details')
    expect(seed.instructions).toContain(
      'clearly supported by the supplied conversation evidence',
    )
    expect(seed.instructions).toContain(
      'deduplication and update targeting only',
    )
    expect(seed.instructions).not.toContain('generated memory extraction')
    expect(seed.instructions).toContain(
      '{"kind":"skip","privateSummary":"Overnight memory consolidation maintenance wake completed."}',
    )
  })

  it('creates the managed automations in a fresh vault', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledTimes(5)
    const digestRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    expect(digestRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      slug: 'weekly-health-digest',
      status: 'active',
      title: 'Weekly health digest',
    })
    expect(digestRecord?.schedule).toEqual(EXPECTED_MANAGED_SPREAD_CRONS.digest)
    expect(digestRecord?.tags).toContain('murph-managed:weekly-health-digest')
    expect(digestRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(digestRecord?.instructions).toContain('still remember ten seconds after reading')
    expect(digestRecord?.instructions).toContain('New data or a decline alone is not substance')
    expect(digestRecord?.instructions).toContain('no connected device accounts, no live wearable, no recent manual logs')
    expect(digestRecord?.instructions).toContain('If the reconnect branch applies, it wins over suppression')
    expect(digestRecord?.instructions).toContain('what was probably noise')
    expect(digestRecord?.instructions).toContain(
      'An official weather alert alone never clears the proactive send bar',
    )
    expect(digestRecord?.instructions).toContain(
      'Never infer an alert from raw weather, AQI, or Murph-defined thresholds',
    )
    expect(digestRecord?.instructions).toContain(
      'Use only a returned alert about extreme heat, extreme cold, or outdoor air quality',
    )
    expect(digestRecord?.instructions).toContain('Never restate single-day metric values')
    expect(digestRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"No weekly digest cleared the memorability bar."}',
    )

    const insightRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    expect(insightRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      slug: 'weekly-health-insight',
      status: 'active',
      title: 'Weekly health insight',
    })
    expect(insightRecord?.schedule).toEqual(EXPECTED_MANAGED_SPREAD_CRONS.insight)
    expect(insightRecord?.tags).toContain('murph-managed:weekly-health-insight')
    expect(insightRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(insightRecord?.instructions).toContain('On this scheduled weekly run')
    expect(insightRecord?.instructions).not.toContain('Sunday at noon local time')
    expect(insightRecord?.instructions).not.toContain('assistant onboarding')
    expect(insightRecord?.instructions).not.toContain('14 days')
    expect(insightRecord?.instructions).toContain('knowledge show weekly-health-insights')
    expect(insightRecord?.instructions).toContain('Use `weekly-health-insights` as the dedupe ledger')
    expect(insightRecord?.instructions).toContain('Do not scan every wiki page')
    expect(insightRecord?.instructions).toContain('vault-cli wearables patterns --date YYYY-MM-DD --format json')
    expect(insightRecord?.instructions).toContain('continue with the existing bounded manual candidate search')
    expect(insightRecord?.instructions).toContain('Do not treat command failure as evidence')
    expect(insightRecord?.instructions).toContain('stages of repeated association, not proof')
    expect(insightRecord?.instructions).toContain('pattern report narrows the search')
    expect(insightRecord?.instructions).toContain('do not create per-week insight pages')
    expect(insightRecord?.instructions).toContain('find zero or one useful')
    expect(insightRecord?.instructions).toContain('better to send nothing')
    expect(insightRecord?.instructions).toContain('knowledge append-section weekly-health-insights YYYY-MM-DD')
    expect(insightRecord?.instructions).toContain('section already exists')
    expect(insightRecord?.instructions).toContain('do not append another section')
    expect(insightRecord?.instructions).toContain('useful enough to repeat now')
    expect(insightRecord?.instructions).toContain('apply the same current interestingness gate')
    expect(insightRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"No weekly health insight cleared the interestingness bar."}',
    )
    expect(insightRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"Existing weekly health insight did not clear the current send bar."}',
    )
    expect(insightRecord?.instructions).not.toContain('finish_without_reply')
    expect(insightRecord?.instructions).toContain('Do not send a process note')
    expect(insightRecord?.instructions).toContain('--body <markdown>')
    expect(insightRecord?.instructions).toContain('--source-path <canonical-vault-path>')
    expect(insightRecord?.instructions).toContain('suppress the scheduled message')
    expect(insightRecord?.instructions).toContain('do not append to the wiki')
    expect(insightRecord?.instructions).toContain('only when the finding clears the bar')
    expect(insightRecord?.instructions).toContain('plain adult language')
    expect(insightRecord?.instructions).toContain('clear claim anchored in recognizable context')
    expect(insightRecord?.instructions).toContain('Use dates for traceability, not as the story')
    expect(insightRecord?.instructions).toContain('Name the outcome before contrasting inputs')
    expect(insightRecord?.instructions).toContain('simple translation')
    expect(insightRecord?.instructions).toContain('raw biomarker names')
    expect(insightRecord?.instructions).toContain('TSH is the brain\'s signal')
    expect(insightRecord?.instructions).toContain('Name the practical takeaway clearly')
    expect(insightRecord?.instructions).toContain('Reject tautological findings')
    expect(insightRecord?.instructions).toContain('direct or obvious input')
    expect(insightRecord?.instructions).toContain('WHOOP recovery tracks sleep')
    expect(insightRecord?.instructions).toContain('compare independent signals')
    expect(insightRecord?.instructions).toContain('one or two credible studies')
    expect(insightRecord?.instructions).toContain('outbound note URL-free')
    expect(insightRecord?.instructions).toContain('Bloodwork plus behavior')
    expect(insightRecord?.instructions).toContain('Biomarkers plus sleep')
    expect(insightRecord?.instructions).toContain('Supplement interplay')
    expect(insightRecord?.instructions).toContain('Treat this as a hypothesis')
    expect(insightRecord?.instructions).toContain('Do not block the run')
    expect(insightRecord?.instructions).toContain('Food capture')
    expect(insightRecord?.instructions).toContain('Easy missing measurement')
    expect(insightRecord?.instructions).toContain('Supplement and pill routines')
    expect(insightRecord?.instructions).toContain('Food planning')
    expect(insightRecord?.instructions).toContain('Goal progress')
    expect(insightRecord?.instructions).toContain('A goal plus missing or messy logs is not enough')
    expect(insightRecord?.instructions).toContain('Subjective state')
    expect(insightRecord?.instructions).toContain('Adherence friction')
    expect(insightRecord?.instructions).toContain('Fun experiments')
    expect(insightRecord?.instructions).toContain('feel more in control')
    expect(insightRecord?.instructions).toContain('CGM and running food/symptom logs')
    expect(insightRecord?.instructions).toContain('glucose curves')
    expect(insightRecord?.instructions).toContain('brain floor')
    expect(insightRecord?.instructions).toContain('do not diagnose insulin sensitivity')
    expect(insightRecord?.instructions).toContain('Interestingness gate')
    expect(insightRecord?.instructions).toContain('worth a short weekly note')
    expect(insightRecord?.instructions).toContain('I did not know that about me')
    expect(insightRecord?.instructions).toContain('hunch-falsifying')
    expect(insightRecord?.instructions).toContain('Suppress true-but-boring findings')
    expect(insightRecord?.instructions).toContain('missing data, messy tags')
    expect(insightRecord?.instructions).toContain('Murph cannot currently see X')
    expect(insightRecord?.instructions).toContain(
      'An official weather alert alone never clears the proactive send bar',
    )

    const improvementCoachRecord = managedAutomationMocks.records.get(
      MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
    )
    expect(improvementCoachRecord).toMatchObject({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      slug: 'monthly-improvement-coach',
      status: 'active',
      title: 'Monthly improvement coach',
    })
    expect(improvementCoachRecord?.assistantTargetOverride).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(improvementCoachRecord?.schedule).toEqual({
      kind: 'cron',
      expression: '0 17 1 * *',
    })
    expect(improvementCoachRecord?.tags).toContain('murph-managed:monthly-improvement-coach')
    expect(improvementCoachRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(improvementCoachRecord?.instructions).toContain(
      'An official weather alert alone never clears the proactive send bar',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'knowledge show improvement-opportunities',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'knowledge append-section improvement-opportunities YYYY-MM-DD',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"No monthly improvement opportunity cleared the evidence and taste bars, and no open check-in was due."}',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'Every completed run must leave one compact private decision record',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'at most once in any 30-day window',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'If no earlier record has `outreach: delivery_requested`, the unanswered-question gate does not block outreach',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'An unrelated inbound does not close it',
    )
    expect(improvementCoachRecord?.instructions).toContain('outreach: delivery_requested')
    expect(improvementCoachRecord?.instructions).toContain(
      'engine-supplied `Occurrence local date` from the Scheduled occurrence context',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'the later-occurrence closure gate does not apply',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'record that exact text under `outbound_text`',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'an active health concern, an unanswered proactive health question, a decline, or a request for less outreach',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'If the section cannot be appended and read back, send nothing',
    )
    expect(improvementCoachRecord?.instructions).toContain(
      'Never infer absence of a behavior from absence of data',
    )

    const researchScoutRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    expect(researchScoutRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      slug: 'weekly-health-research-scout',
      status: 'active',
      title: 'Weekly health research scout',
    })
    expect(researchScoutRecord?.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
    })
    expect(researchScoutRecord?.schedule).toEqual(EXPECTED_MANAGED_SPREAD_CRONS.researchScout)
    expect(researchScoutRecord?.tags).toContain('murph-managed:weekly-health-research-scout')
    expect(researchScoutRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(researchScoutRecord?.instructions).toContain('On this scheduled weekly run')
    expect(researchScoutRecord?.instructions).not.toContain('Wednesday at 7:30 PM local time')
    expect(researchScoutRecord?.instructions).not.toContain('assistant onboarding')
    expect(researchScoutRecord?.instructions).not.toContain('14 days')
    expect(researchScoutRecord?.instructions).toContain('0-1 genuinely useful research-backed insight')
    expect(researchScoutRecord?.instructions).toContain('natural chat message from Murph')
    expect(researchScoutRecord?.instructions).toContain('The unit of value is the insight, not the paper')
    expect(researchScoutRecord?.instructions).toContain('one insight may synthesize several returned sources')
    expect(researchScoutRecord?.instructions).not.toContain('0-3 new studies')
    expect(researchScoutRecord?.instructions).toContain('normal Murph chat language')
    expect(researchScoutRecord?.instructions).toContain('If unclear, use English')
    expect(researchScoutRecord?.instructions).toContain('Do not infer the output language from Telegram')
    expect(researchScoutRecord?.instructions).toContain('Do not mix languages')
    expect(researchScoutRecord?.instructions).toContain('thoughtful chat message')
    expect(researchScoutRecord?.instructions).toContain('Do not use a numbered list of studies')
    expect(researchScoutRecord?.instructions).toContain('Do not use fixed labels')
    expect(researchScoutRecord?.instructions).toContain('Do not lead with journal')
    expect(researchScoutRecord?.instructions).toContain('last two years')
    expect(researchScoutRecord?.instructions).toContain('knowledge show weekly-health-research-scout')
    expect(researchScoutRecord?.instructions).toContain('EXA_API_KEY')
    expect(researchScoutRecord?.instructions).toContain('tag-level only')
    expect(researchScoutRecord?.instructions).not.toContain('lowercase non-identifying category tags')
    expect(researchScoutRecord?.instructions).toContain('Do not send raw lab values')
    expect(researchScoutRecord?.instructions).toContain('Define 1-4 focused, mechanism-shaped research lanes')
    expect(researchScoutRecord?.instructions).toContain('do not create one lane per concept')
    expect(researchScoutRecord?.instructions).toContain('run `vault-cli research scout-batch-payload-schema --format json`')
    expect(researchScoutRecord?.instructions).toContain('sole provider-value catalog')
    expect(researchScoutRecord?.instructions).toContain('every provider value is an exact concept allowed for that field')
    expect(researchScoutRecord?.instructions).toContain('Use `vault-cli research scout-batch` once')
    expect(researchScoutRecord?.instructions).toContain('If none exists, suppress the scheduled message without calling `vault-cli research scout-batch`')
    expect(researchScoutRecord?.instructions).not.toContain('Use `vault-cli research scout` once')
    expect(researchScoutRecord?.instructions).toContain('`topics`, `biomarkers`, `behaviors`, `supplements`, `conditionsOrConcerns`, `goals`, and `activeExperiments`')
    expect(researchScoutRecord?.instructions).toContain('or a generic `tags` field')
    expect(researchScoutRecord?.instructions).not.toContain('Example body:')
    expect(researchScoutRecord?.instructions).not.toContain('blue light glasses')
    expect(researchScoutRecord?.instructions).not.toContain('late meals')
    expect(researchScoutRecord?.instructions).toContain('device and measurement meta-commentary')
    expect(researchScoutRecord?.instructions).toContain('a trend in their own wearable data')
    expect(researchScoutRecord?.instructions).toContain('ignore a metric their own data shows is noisy for them')
    expect(researchScoutRecord?.instructions).not.toContain('wearable hrv reliability')
    expect(researchScoutRecord?.instructions).not.toContain('wearable tracking')
    expect(researchScoutRecord?.instructions).toContain('YYYY-MM-DD dates or full ISO timestamps are accepted')
    expect(researchScoutRecord?.instructions).toContain('cap `--maxCandidatesPerLane` at 8')
    expect(researchScoutRecord?.instructions).not.toContain('capping `--maxCandidates` at 5')
    expect(researchScoutRecord?.instructions).not.toContain('cap `--maxCandidates` at 1')
    expect(researchScoutRecord?.instructions).not.toContain('cap `--maxCandidates` at 3')
    expect(researchScoutRecord?.instructions).toContain('Treat the returned results as a candidate pool')
    expect(researchScoutRecord?.instructions).toContain('The scout-batch call is the retrieval budget')
    expect(researchScoutRecord?.instructions).toContain('Do not perform an open-ended web browsing loop')
    expect(researchScoutRecord?.instructions).toContain('current user question each candidate would answer')
    expect(researchScoutRecord?.instructions).toContain('Recent conversation and automation/regimen changes are veto context')
    expect(researchScoutRecord?.instructions).toContain('stale vault tags')
    expect(researchScoutRecord?.instructions).toContain('incremental value beyond known basics')
    expect(researchScoutRecord?.instructions).toContain('still remember the point ten seconds after reading')
    expect(researchScoutRecord?.instructions).toContain('Hard provenance gate: if the note could have been written without this run\'s retrieved sources')
    expect(researchScoutRecord?.instructions).toContain('Skipping is the expected outcome')
    expect(researchScoutRecord?.instructions).toContain('Do not reuse the provider candidate\'s `actionOrQuestion` as advice')
    expect(researchScoutRecord?.instructions).toContain('Automatically skip generic health news, obvious habit advice')
    expect(researchScoutRecord?.instructions).toContain('`do more support work`, `be consistent`, `sleep better`, `eat protein`, `manage stress`')
    expect(researchScoutRecord?.instructions).toContain('Suppress the scheduled message')
    expect(researchScoutRecord?.instructions).toContain('Send exactly one short note')
    expect(researchScoutRecord?.instructions).toContain('Never send a second item')
    expect(researchScoutRecord?.instructions).not.toContain('Send 1-3 items max')
    expect(researchScoutRecord?.instructions).toContain("Lead with what changes for the user's current thinking")
    expect(researchScoutRecord?.instructions).toContain('small cluster of sources')
    expect(researchScoutRecord?.instructions).toContain('Mention source provenance naturally')
    expect(researchScoutRecord?.instructions).toContain('Keep study names, publication dates, study type, evidence strength')
    expect(researchScoutRecord?.instructions).not.toContain('For each item include:')
    expect(researchScoutRecord?.instructions).not.toContain('one thing not to overinterpret')
    expect(researchScoutRecord?.instructions).not.toContain('plain-English `Basically:` sentence')
    expect(researchScoutRecord?.instructions).toContain('Append one dated section to `weekly-health-research-scout`')
    expect(researchScoutRecord?.instructions).toContain('why close alternatives were suppressed')
    expect(researchScoutRecord?.instructions).toContain('clinician discussion prompt')

    const productUpdatesRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    expect(productUpdatesRecord).toMatchObject({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'A biweekly personalized note alternating what is new in Murph with things Murph can do for you.',
      title: 'Murph product notes',
    })
    expect(productUpdatesRecord?.schedule).toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)
    expect(productUpdatesRecord?.tags).toContain(
      'murph-managed:weekly-product-updates',
    )
    expect(productUpdatesRecord?.tags).not.toContain(
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    )
    expect(productUpdatesRecord?.instructions).toContain('/api/changelog?days=14&featureLimit=70&improvementLimit=10')
    expect(productUpdatesRecord?.instructions).toContain('/api/feature-catalog')
    expect(productUpdatesRecord?.instructions).toContain('Read `vault-cli knowledge show murph-product-notes`')
    expect(productUpdatesRecord?.instructions).toContain('choose the feature discovery kind')
    expect(productUpdatesRecord?.instructions).toContain('Use `murph-product-notes` as the only ledger')
    expect(productUpdatesRecord?.instructions).toContain('vault-cli knowledge append-section murph-product-notes YYYY-MM-DD')
    expect(productUpdatesRecord?.instructions).toContain('Fallback is allowed at most once')
    expect(productUpdatesRecord?.instructions).toContain('never fall back from a fallback')
    expect(productUpdatesRecord?.instructions).toContain('If both kinds are unavailable, invalid, empty, or below bar')
    expect(productUpdatesRecord?.instructions).toContain('record only this run\'s kind and the chosen item ids')
    expect(productUpdatesRecord?.instructions).toContain('do not include reasons, user context, health details, raw user wording, provider data, or copied catalog/changelog text')
    expect(productUpdatesRecord?.instructions).toContain('another run already recorded today\'s note')
    expect(productUpdatesRecord?.instructions).toContain('Do not append again and do not switch kinds')
    expect(productUpdatesRecord?.instructions).toContain('2-3 recently shipped Murph updates')
    expect(productUpdatesRecord?.instructions).toContain('2-3 things Murph can already do')
    expect(productUpdatesRecord?.instructions).toContain('Do not pad with weak matches')
    expect(productUpdatesRecord?.instructions).toContain('Drop items the user is already using')
    expect(productUpdatesRecord?.instructions).toContain('context already surfaced for ordinary assistance')
    expect(productUpdatesRecord?.instructions).toContain('Do not open raw health records, uploaded documents, inbox attachments, provider payloads, transcripts, or raw notes solely to decide whether a feature was used')
    expect(productUpdatesRecord?.instructions).not.toContain('Choose 3-7 items')
    expect(productUpdatesRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"No product note cleared the send bar."}',
    )
    expect(productUpdatesRecord?.instructions).not.toContain('finish_without_reply')
    expect(
      managedAutomationMocks.records.has(MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID),
    ).toBe(false)
  })

  it('creates the hosted overnight memory consolidation automation in hosted runtime', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
        EXA_API_KEY: 'fixture-exa-key',
      },
      vaultRoot,
    })

    expect(result).toEqual({
      created: 6,
      skipped: 0,
      updated: 0,
    })
    const memoryRecord = managedAutomationMocks.records.get(
      MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    )
    expect(memoryRecord).toMatchObject({
      automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 3 * * 1,3,5',
      },
      slug: 'overnight-memory-consolidation',
      status: 'active',
      title: 'Overnight memory consolidation',
    })
    expect(memoryRecord?.assistantTargetOverride).toEqual({
      reasoningEffort: 'medium',
    })
    expect(memoryRecord?.tags).toContain('murph-managed:overnight-memory-consolidation')
    expect(memoryRecord?.tags).toContain('runtime-maintenance')
    expect(memoryRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(memoryRecord?.instructions).toContain('engine-supplied "Conversation evidence" section')
    expect(memoryRecord?.instructions).toContain('bounded committed user and assistant conversation messages from the last 7 days')
    expect(memoryRecord?.instructions).toContain('supplied conversation evidence')
    expect(memoryRecord?.instructions).toContain('vault-cli memory show --format json')
    expect(memoryRecord?.instructions).toContain('vault-cli memory upsert')
    expect(memoryRecord?.instructions).toContain('Do not read transcript files or session storage')
    expect(memoryRecord?.instructions).toContain('Do not save assistant speculation')
    expect(memoryRecord?.instructions).not.toContain('generated memory extraction')
    expect(memoryRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"Overnight memory consolidation maintenance wake completed."}',
    )
  })

  it('creates only the group-owned room model automation for group chat routes', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute: groupChatRoute,
      now: new Date('2026-07-09T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
        EXA_API_KEY: 'fixture-exa-key',
      },
      vaultRoot,
    })

    expect(result).toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.records.size).toBe(1)
    expect(
      managedAutomationMocks.records.get(
        MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
      ),
    ).toMatchObject({
      route: groupChatRoute,
      schedule: { kind: 'cron', expression: '0 4 * * 2,5' },
      status: 'active',
    })
    expect(
      [...managedAutomationMocks.records.values()].some((record) =>
        record.route.threadIsDirect !== false
      ),
    ).toBe(false)
  })

  it('classifies Telegram groups by audience rather than by channel name', async () => {
    const telegramGroupRoute = {
      ...groupChatRoute,
      channel: 'telegram',
      deliveryTarget: 'telegram-group-chat',
      identityId: 'telegram-identity',
      participantId: 'telegram-participant',
      threadId: 'telegram-group-thread',
    }

    const result = await applyMurphManagedAutomations({
      defaultRoute: telegramGroupRoute,
      now: new Date('2026-07-09T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
        EXA_API_KEY: 'fixture-exa-key',
      },
      vaultRoot,
    })

    expect(result).toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })
    expect(
      managedAutomationMocks.records.get(
        MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
      ),
    ).toMatchObject({
      route: telegramGroupRoute,
      status: 'active',
    })
  })

  it('does not install group managed automations on spoofable group-email routes', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute: {
        ...groupChatRoute,
        channel: 'email',
        deliveryTarget: 'group-email-route',
        threadId: 'group-email-thread',
      },
      now: new Date('2026-07-09T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
        EXA_API_KEY: 'fixture-exa-key',
      },
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.records.size).toBe(0)
  })

  it('creates caller-supplied group automations for Linq group chat routes', async () => {
    const groupSeed: MurphManagedAutomationSeed = {
      automationId: 'automation_01KGROUPNEWSLETTER0000000000',
      continuityPolicy: 'fresh',
      instructions: 'Create the explicit group newsletter.',
      schedule: { kind: 'cron', expression: '0 9 * * 1' },
      slug: 'group-health-newsletter-test',
      summary: 'Weekly group health newsletter.',
      tags: ['group-newsletter'],
      title: 'Group health newsletter',
    }

    const result = await applyMurphManagedAutomations({
      defaultRoute: groupChatRoute,
      now: new Date('2026-07-09T14:00:00.000Z'),
      seeds: [groupSeed],
      vaultRoot,
    })

    expect(result).toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.patchAutomation).not.toHaveBeenCalled()
    expect(managedAutomationMocks.records.get(groupSeed.automationId))
      .toMatchObject({
        automationId: groupSeed.automationId,
        instructions: groupSeed.instructions,
        route: groupChatRoute,
        schedule: groupSeed.schedule,
        slug: groupSeed.slug,
        status: 'active',
        summary: groupSeed.summary,
        title: groupSeed.title,
      })
    expect(
      managedAutomationMocks.records.get(groupSeed.automationId)?.tags,
    ).toContain('group-newsletter')
  })

  it('archives existing personal managed automations that are bound to Linq group chat routes', async () => {
    managedAutomationMocks.records.set(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      instructions: 'OLD weekly product updates instructions.',
      route: groupChatRoute,
      schedule: { kind: 'cron', expression: '30 12 * * 5' },
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'Old weekly product updates.',
      tags: ['assistant', 'scheduled', 'murph-managed', 'murph-managed:weekly-product-updates'],
      title: 'Murph product notes',
    })

    const result = await applyMurphManagedAutomations({
      now: new Date('2026-07-09T14:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 4,
      updated: 1,
    })
    expect(managedAutomationMocks.patchAutomation).toHaveBeenCalledWith({
      lookup: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      now: new Date('2026-07-09T14:00:00.000Z'),
      status: 'archived',
      vaultRoot,
    })
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID)?.status,
    ).toBe('archived')
  })

  it('archives paused personal built-ins that are persisted on a group route', async () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) => entry.automationId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    if (!seed) {
      throw new Error('Expected the managed product updates seed.')
    }
    managedAutomationMocks.records.set(seed.automationId, {
      automationId: seed.automationId,
      continuityPolicy: 'fresh',
      instructions: seed.instructions,
      route: groupChatRoute,
      schedule: seed.schedule,
      slug: seed.slug,
      status: 'paused',
      summary: seed.summary ?? null,
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: seed.title,
    })

    await expect(applyMurphManagedAutomations({
      now: new Date('2026-07-09T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
      },
      seeds: [seed],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 0,
      updated: 1,
    })
    expect(managedAutomationMocks.records.get(seed.automationId)?.status)
      .toBe('archived')
  })

  it('archives paused group built-ins that are persisted on a direct route', async () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) =>
        entry.automationId === MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
    )
    if (!seed) {
      throw new Error('Expected the group room-model seed.')
    }
    managedAutomationMocks.records.set(seed.automationId, {
      automationId: seed.automationId,
      continuityPolicy: 'fresh',
      instructions: seed.instructions,
      route: { ...defaultRoute, threadIsDirect: true },
      schedule: seed.schedule,
      slug: seed.slug,
      status: 'paused',
      summary: seed.summary ?? null,
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: seed.title,
    })

    await expect(applyMurphManagedAutomations({
      now: new Date('2026-07-09T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
      },
      seeds: [seed],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 0,
      updated: 1,
    })
    expect(managedAutomationMocks.records.get(seed.automationId)?.status)
      .toBe('archived')
  })

  it('archives a persisted Sunday superlatives record after its seed is removed', async () => {
    const retiredAutomationId = 'automation_01K55N7S9X4Q2M6P8R3T0V1WYZ'
    managedAutomationMocks.records.set(retiredAutomationId, {
      automationId: retiredAutomationId,
      continuityPolicy: 'fresh',
      instructions: 'Legacy group recap instructions.',
      route: groupChatRoute,
      schedule: { kind: 'cron', expression: '0 18 * * 0' },
      slug: 'group-sunday-superlatives',
      status: 'paused',
      summary: null,
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Sunday group superlatives',
    })

    await applyMurphManagedAutomations({
      defaultRoute: groupChatRoute,
      now: new Date('2026-07-26T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
      },
      vaultRoot,
    })

    expect(managedAutomationMocks.records.get(retiredAutomationId)?.status)
      .toBe('archived')
  })

  it('updates existing research-oriented automations without rewriting their cadence', async () => {
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Each Friday at 2:30 PM local time, find one old finding.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '30 14 * * 5',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'Old weekly insight.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health insight',
    })
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Each Friday morning, produce an old research scout.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 11 * * 5',
      },
      slug: 'weekly-health-research-scout',
      status: 'active',
      summary: 'Old weekly research scout.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health research scout',
    })

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-20T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 3,
      skipped: 0,
      updated: 2,
    })
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
      .toEqual(expect.objectContaining({
        assistantTargetOverride: {
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
        },
        schedule: {
          kind: 'cron',
          expression: '30 14 * * 5',
        },
      }))
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID)
        ?.instructions,
    )
      .toContain('On this scheduled weekly run')
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID)
        ?.instructions,
    )
      .not.toContain('Sunday at noon local time')
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID))
      .toEqual(expect.objectContaining({
        schedule: {
          kind: 'cron',
          expression: '0 11 * * 5',
        },
      }))
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID)
        ?.instructions,
    ).toContain('On this scheduled weekly run')
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID)
        ?.instructions,
    ).not.toContain('Wednesday at 7:30 PM local time')
  })

  it('migrates existing weekly product notes to the two-week cadence', async () => {
    const existingSchedule = { kind: 'cron', expression: '30 12 * * 5' } as const
    managedAutomationMocks.records.set(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'OLD weekly product updates instructions with changelog-only behavior.',
      route: defaultRoute,
      schedule: existingSchedule,
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'Old weekly product updates.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly product updates',
    })

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-20T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })
    const productUpdatesRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    expect(productUpdatesRecord?.schedule).toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)
    expect(productUpdatesRecord?.summary).toBe(
      'A biweekly personalized note alternating what is new in Murph with things Murph can do for you.',
    )
    expect(productUpdatesRecord?.instructions).toContain('Goal: every two weeks')
    expect(productUpdatesRecord?.instructions).toContain('/api/feature-catalog')
    expect(productUpdatesRecord?.instructions).toContain('record only this run\'s kind and the chosen item ids')
    expect(productUpdatesRecord?.instructions).toContain('do not include reasons, user context, health details, raw user wording, provider data, or copied catalog/changelog text')
    expect(productUpdatesRecord?.instructions).toContain('Do not append again and do not switch kinds')
    expect(productUpdatesRecord?.instructions).not.toContain('OLD weekly product updates instructions')
  })

  it('removes the legacy require-send tag from an existing active weekly digest', async () => {
    const existingSchedule = { kind: 'cron', expression: '0 9 * * 1' } as const
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      instructions: 'OLD weekly digest instructions with require-send behavior.',
      route: defaultRoute,
      schedule: existingSchedule,
      slug: 'weekly-health-digest',
      status: 'active',
      summary: 'A weekly summary of your recent health data.',
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        'murph-managed:weekly-health-digest',
        ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
      ],
      title: 'Weekly health digest',
    })

    const digestSeed = MURPH_MANAGED_AUTOMATIONS.find((seed) =>
      seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID
    )
    if (!digestSeed) {
      throw new Error('Expected weekly health digest managed seed to exist.')
    }

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-20T12:00:00.000Z'),
      seeds: [digestSeed],
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 0,
      updated: 1,
    })
    const digestRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    expect(digestRecord?.schedule).toBe(existingSchedule)
    expect(digestRecord?.tags).toEqual([
      'assistant',
      'scheduled',
      'murph-managed',
      'murph-managed:weekly-health-digest',
    ])
    expect(digestRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(digestRecord?.instructions).toContain('On this scheduled weekly run')
    expect(digestRecord?.instructions).toContain('If the reconnect branch applies, it wins over suppression')
    expect(digestRecord?.instructions).not.toContain('OLD weekly digest instructions')
  })

  it('preserves an existing device activity cadence on managed reconciliation', async () => {
    const deviceActivitySchedule = {
      after: '2026-06-20T12:00:00.000Z',
      kind: 'deviceActivity' as const,
      source: 'whoop' as const,
      activityKind: 'workout',
    }
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'After my next workout, find one old finding.',
      route: defaultRoute,
      schedule: deviceActivitySchedule,
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'Old weekly insight.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health insight',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-20T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
      .toEqual(expect.objectContaining({
        instructions: expect.stringContaining('On this scheduled weekly run'),
        schedule: deviceActivitySchedule,
      }))
  })

  it('does not overwrite a queued device activity occurrence payload', async () => {
    const queuedSchedule = {
      at: '2026-06-20T12:01:00.000Z',
      kind: 'at' as const,
    }
    const queuedInstructions = [
      'After my next workout, find one old finding.',
      '',
      'Device activity context:',
      'Kind: workout',
      'Occurred at: 2026-06-20T12:00:00.000Z',
      'Source: whoop',
    ].join('\n')
    const queuedTags = [
      'assistant',
      'scheduled',
      'murph-managed',
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    ]
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: queuedInstructions,
      route: defaultRoute,
      schedule: queuedSchedule,
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'Old weekly insight.',
      tags: queuedTags,
      title: 'Weekly health insight',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-20T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 1,
      updated: 0,
    })

    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
      .toEqual(expect.objectContaining({
        instructions: queuedInstructions,
        schedule: queuedSchedule,
        tags: queuedTags,
      }))
  })

  it('spreads managed recurring schedules deterministically by vault id', async () => {
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })
    const firstSchedules = new Map(
      [...managedAutomationMocks.records.entries()].map(([id, record]) => [id, record.schedule]),
    )

    managedAutomationMocks.records.clear()
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-10T12:00:00.000Z'),
      vaultRoot: `${vaultRoot}-moved`,
    })

    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID)?.schedule)
      .toEqual(firstSchedules.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID)?.schedule)
      .toEqual(firstSchedules.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
    expect(managedAutomationMocks.records.get(MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID)?.schedule)
      .toEqual(firstSchedules.get(MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID))
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID)?.schedule)
      .toEqual(firstSchedules.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID))
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)
  })

  it('defers spread-managed creation when vault metadata cannot be read', async () => {
    const metadataError = new Error('metadata unavailable')
    managedAutomationMocks.loadVault.mockRejectedValue(metadataError)

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 2,
      skipped: 3,
      stableKeyFailure: metadataError,
      stableKeyRetryNeeded: true,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledTimes(2)
    expect(managedAutomationMocks.records.get(MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID)?.schedule)
      .toEqual({
        kind: 'cron',
        expression: '0 17 1 * *',
      })
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)

    managedAutomationMocks.loadVault.mockResolvedValue({
      metadata: { vaultId: 'vault_managed_automations_test' },
    })
    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-10T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 3,
      skipped: 2,
      updated: 0,
    })

    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_MANAGED_SPREAD_CRONS.digest)
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_MANAGED_SPREAD_CRONS.insight)
    expect(managedAutomationMocks.records.get(MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID)?.schedule)
      .toEqual({
        kind: 'cron',
        expression: '0 17 1 * *',
      })
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_MANAGED_SPREAD_CRONS.researchScout)
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)
  })

  it('continues non-spread seeds and existing updates when stable-key metadata is unavailable', async () => {
    const existingDigestSchedule = { kind: 'cron', expression: '0 9 * * 2' } as const
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      instructions: 'Old digest prompt.',
      route: defaultRoute,
      schedule: existingDigestSchedule,
      slug: 'weekly-health-digest',
      status: 'active',
      summary: 'Old digest summary.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health digest',
    })
    const metadataError = new Error('metadata unavailable')
    managedAutomationMocks.loadVault.mockRejectedValue(metadataError)

    const digestSeed = MURPH_MANAGED_AUTOMATIONS.find((seed) =>
      seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID
    )
    const productUpdatesSeed = MURPH_MANAGED_AUTOMATIONS.find((seed) =>
      seed.automationId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID
    )
    if (!digestSeed || !productUpdatesSeed) {
      throw new Error('Expected managed seeds to exist.')
    }
    const experimentSeed: MurphManagedAutomationSeed = {
      automationId: 'automation_01KSTABLEKEYTEST000000000000',
      instructions: 'Create the due experiment final-results message.',
      schedule: { kind: 'at', at: '2026-06-09T12:30:00.000Z' },
      slug: 'experiment-final-results-stable-key-test',
      tags: ['experiment', 'final-results'],
      title: 'Final results · Stable key test',
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      seeds: [digestSeed, productUpdatesSeed, experimentSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 2,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))
      .toEqual(expect.objectContaining({
        instructions: expect.stringContaining('On this scheduled weekly run'),
        schedule: existingDigestSchedule,
      }))
    expect(managedAutomationMocks.records.get(experimentSeed.automationId))
      .toEqual(expect.objectContaining({
        instructions: experimentSeed.instructions,
        schedule: experimentSeed.schedule,
      }))
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID)?.schedule)
      .toEqual(EXPECTED_PRODUCT_NOTES_SCHEDULE)
  })

  it('skips the research scout seed when hosted runtime env lacks Exa', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      runtimeEnv: {},
      vaultRoot,
    })

    expect(result).toEqual({
      created: 4,
      skipped: 1,
      updated: 0,
    })
    expect(managedAutomationMocks.records.has(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))
      .toBe(true)
    expect(managedAutomationMocks.records.has(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
      .toBe(true)
    expect(managedAutomationMocks.records.has(MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID))
      .toBe(true)
    expect(managedAutomationMocks.records.has(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID))
      .toBe(false)
  })

  it('does not rewrite an unchanged managed automation', async () => {
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })
    managedAutomationMocks.upsertAutomation.mockClear()

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 5,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('does not reactivate a paused managed automation', async () => {
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      instructions: 'old instructions',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 9 * * 1',
      },
      slug: 'weekly-health-digest',
      status: 'paused',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health digest',
    })

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 4,
      skipped: 1,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      }),
    )
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))
      .toMatchObject({
        status: 'paused',
      })
  })

  it('reconciles and bounds an exact seeded recurring onboarding follow-up', async () => {
    const existingRoute = {
      channel: 'linq',
      deliveryTarget: 'existing-thread',
      identityId: 'identity-1',
      participantId: null,
      threadId: null,
    }
    managedAutomationMocks.records.set('automation_onboarding_followup', {
      automationId: 'automation_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      route: existingRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:47',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        activeUntil: '2026-06-26T15:00:00.000Z',
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        firstOccurrencePolicy: 'after-current-local-day',
        route: existingRoute,
        schedule: {
          localTime: '13:47',
          kind: 'dailyLocal',
        },
        summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
        tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
        title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      }),
    )
    expect(managedAutomationMocks.upsertAssistantCronAutomation.mock.calls[0]?.[0])
      .not.toHaveProperty('status')
    expect(managedAutomationMocks.records.get('automation_onboarding_followup'))
      .toMatchObject({
        activeUntil: '2026-06-26T15:00:00.000Z',
        route: existingRoute,
        schedule: {
          localTime: '13:47',
          kind: 'dailyLocal',
        },
        status: 'active',
      })
  })

  it('updates a paused onboarding follow-up without reactivating it', async () => {
    managedAutomationMocks.records.set('automation_onboarding_followup', {
      automationId: 'automation_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:47',
      },
      slug: 'finish-onboarding-followup',
      status: 'paused',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        firstOccurrencePolicy: 'after-current-local-day',
        route: defaultRoute,
      }),
    )
    expect(managedAutomationMocks.records.get('automation_onboarding_followup'))
      .toMatchObject({
        activeUntil: '2026-06-26T15:00:00.000Z',
        route: defaultRoute,
        schedule: {
          localTime: '13:47',
          kind: 'dailyLocal',
        },
        status: 'paused',
      })
  })

  it('does not overwrite an edited same-slug one-shot with copied managed tags', async () => {
    const scheduledAt = '2026-06-24T14:00:00.000Z'
    managedAutomationMocks.records.set('automation_onboarding_followup', {
      automationId: 'automation_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: 'old onboarding follow-up instructions',
      route: defaultRoute,
      schedule: {
        at: scheduledAt,
        kind: 'at',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'murph-managed:onboarding-followup'],
      title: 'Old onboarding follow-up',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })

    expect(managedAutomationMocks.patchAutomation).not.toHaveBeenCalled()
    expect(managedAutomationMocks.records.get('automation_onboarding_followup'))
      .toMatchObject({
        instructions: 'old onboarding follow-up instructions',
        schedule: {
          at: scheduledAt,
          kind: 'at',
        },
      })
  })

  it('migrates the original unmarked onboarding follow-up seed by exact fingerprint', async () => {
    managedAutomationMocks.records.set('automation_legacy_onboarding_followup', {
      automationId: 'automation_legacy_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: legacyOnboardingFollowupInstructions,
      route: defaultRoute,
      schedule: {
        everyMs: 90_000,
        kind: 'every',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: 'User-edited setup follow-up summary.',
      tags: ['assistant', 'onboarding'],
      title: 'User-edited setup follow-up',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.records.get('automation_legacy_onboarding_followup'))
      .toMatchObject({
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        route: defaultRoute,
        schedule: {
          localTime: expect.stringMatching(
            /^(?:13:[3-5]\d|14:[0-2]\d)$/u,
          ),
          kind: 'dailyLocal',
        },
        status: 'active',
        summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
        tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
        title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      })
  })

  it('does not reconcile archived or user-owned onboarding follow-up slugs', async () => {
    managedAutomationMocks.records.set('automation_archived_onboarding_followup', {
      automationId: 'automation_archived_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: 'old onboarding follow-up instructions',
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      slug: 'finish-onboarding-followup',
      status: 'archived',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'murph-managed:onboarding-followup'],
      title: 'Old onboarding follow-up',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })

    managedAutomationMocks.records.clear()
    managedAutomationMocks.patchAutomation.mockClear()
    managedAutomationMocks.upsertAutomation.mockClear()
    managedAutomationMocks.records.set('automation_user_onboarding_followup', {
      automationId: 'automation_user_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: 'user-owned follow-up instructions',
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      slug: 'finish-onboarding-followup',
      status: 'active',
      summary: 'User summary',
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: 'User follow-up',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.patchAutomation).not.toHaveBeenCalled()
  })

  it('updates active seed-owned fields while preserving the existing route', async () => {
    const existingRoute = {
      channel: 'telegram',
      deliveryTarget: 'existing-thread',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'old instructions',
      route: existingRoute,
      schedule: {
        kind: 'cron',
        expression: '0 10 * * 1',
      },
      slug: 'custom-weekly-digest',
      status: 'active',
      summary: 'Old summary',
      tags: ['assistant'],
      title: 'Old digest',
    })

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
        route: existingRoute,
        slug: 'custom-weekly-digest',
      }),
    )
  })

  it('validates the resolved self-delivery route through the shared rules when no defaultRoute is given', async () => {
    managedAutomationMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValue({
      channel: 'telegram',
      deliveryTarget: 'self-delivery-thread',
      identityId: null,
      participantId: null,
      threadId: null,
    })

    const result = await applyMurphManagedAutomations({
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        route: {
          channel: 'telegram',
          deliverySource: null,
          deliveryTarget: 'self-delivery-thread',
          identityId: null,
          participantId: null,
          threadId: null,
        },
      }),
    )
  })

  it('runs due-outcome maintenance even when no deliverable route exists', async () => {
    managedAutomationMocks.prepareExperimentLifecycleAutomations.mockResolvedValueOnce({
      processedCount: 1,
      seeds: [],
    })
    const result = await applyMurphManagedAutomations({
      defaultRoute: null,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 5,
      updated: 0,
    })
    expect(
      managedAutomationMocks.prepareExperimentLifecycleAutomations,
    ).toHaveBeenCalledWith({
      now: new Date('2026-06-09T12:00:00.000Z'),
      shouldYield: null,
      vaultRoot,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('skips creation for a participant-only route with no resolvable binding delivery', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute: {
        channel: 'telegram',
        deliveryTarget: null,
        identityId: null,
        participantId: 'participant-1',
        threadId: null,
      },
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 5,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('skips creation when managed slugs already belong to other automations', async () => {
    managedAutomationMocks.records.set('automation_user_digest', {
      automationId: 'automation_user_digest',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user prompt.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 8 * * 1',
      },
      slug: 'weekly-health-digest',
      status: 'active',
      summary: 'User-owned automation.',
      tags: ['user'],
      title: 'My weekly health digest',
    })
    managedAutomationMocks.records.set('automation_user_insight', {
      automationId: 'automation_user_insight',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user insight prompt.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 14 * * 3',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'User-owned insight automation.',
      tags: ['user'],
      title: 'My weekly health insight',
    })
    managedAutomationMocks.records.set('automation_user_research_scout', {
      automationId: 'automation_user_research_scout',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user research scout prompt.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 11 * * 5',
      },
      slug: 'weekly-health-research-scout',
      status: 'active',
      summary: 'User-owned research scout automation.',
      tags: ['user'],
      title: 'My weekly research scout',
    })
    managedAutomationMocks.records.set('automation_user_improvement_coach', {
      automationId: 'automation_user_improvement_coach',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user improvement coach prompt.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 17 * * 2',
      },
      slug: 'weekly-improvement-coach',
      status: 'active',
      summary: 'User-owned improvement coach automation.',
      tags: ['user'],
      title: 'My improvement coach',
    })
    managedAutomationMocks.records.set('automation_user_product_updates', {
      automationId: 'automation_user_product_updates',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user product update prompt.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 10 * * 4',
      },
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'User-owned product update automation.',
      tags: ['user'],
      title: 'My product updates',
    })

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 5,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('skips creation when the iMessage delivery target is a private placeholder', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute: {
        channel: 'linq',
        deliveryTarget: 'h1_0123456789abcdef01234567',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 5,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('reconciles an existing one-shot whose desired moment moved earlier within the live window', async () => {
    const previousFinal: StoredAutomationRecord = {
      automationId: 'automation_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      continuityPolicy: 'fresh',
      instructions: 'Old final-results prompt.',
      route: defaultRoute,
      schedule: { kind: 'at', at: '2026-04-29T15:00:00.000Z' },
      slug: 'experiment-final-results-nz-run',
      status: 'active',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'experiment', 'final-results'],
      title: 'Old final results',
    }
    managedAutomationMocks.records.set(previousFinal.automationId, previousFinal)

    const newSeed: MurphManagedAutomationSeed = {
      automationId: previousFinal.automationId,
      slug: previousFinal.slug,
      title: 'Final results · NZ Run',
      // New schedule for a Pacific/Auckland vault: 09:00 NZST on 2026-04-29
      // is 2026-04-28T21:00Z — 18h earlier than the previous 15:00 UTC fire.
      schedule: { kind: 'at', at: '2026-04-28T21:00:00.000Z' },
      instructions: 'New persist-then-deliver prompt.',
    }

    // `now` is before BOTH the new desired fire and the old stored fire, so
    // the new seed is not yet stale and the reconcile must update in place.
    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-04-28T18:00:00.000Z'),
      seeds: [newSeed],
      vaultRoot,
    })).resolves.toMatchObject({ updated: 1 })

    expect(managedAutomationMocks.records.get(previousFinal.automationId))
      .toMatchObject({
        instructions: 'New persist-then-deliver prompt.',
        schedule: { kind: 'at', at: '2026-04-28T21:00:00.000Z' },
        status: 'active',
      })
  })

  it('keeps a legacy still-future occurrence when the new desired moment is already stale', async () => {
    // Migration repro: a pre-PR final-results automation persisted with the
    // old 15:00 UTC fire is still in the future, but the new desired fire
    // (09:00 in Pacific/Auckland → 21:00 UTC the previous day) has already
    // passed by more than the one-shot expiry window. The installer must
    // keep the legacy schedule alive so the user still gets the moment, but
    // adopt the new content. Archiving here would silently lose the final
    // review during rollout.
    const previousFinal: StoredAutomationRecord = {
      automationId: 'automation_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      continuityPolicy: 'fresh',
      instructions: 'Old final-results prompt.',
      route: defaultRoute,
      schedule: { kind: 'at', at: '2026-04-29T15:00:00.000Z' },
      slug: 'experiment-final-results-nz-run',
      status: 'active',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'experiment', 'final-results'],
      title: 'Old final results',
    }
    managedAutomationMocks.records.set(previousFinal.automationId, previousFinal)

    const newSeed: MurphManagedAutomationSeed = {
      activeUntil: '2026-05-05T21:00:00.000Z',
      automationId: previousFinal.automationId,
      slug: previousFinal.slug,
      title: 'Final results · NZ Run',
      schedule: { kind: 'at', at: '2026-04-28T21:00:00.000Z' },
      instructions: 'New persist-then-deliver prompt.',
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      // After the new desired fire by far more than the stale-seed window
      // (1h), but before the obsolete stored fire at 15:00 UTC the next day.
      now: new Date('2026-04-29T08:00:00.000Z'),
      seeds: [newSeed],
      vaultRoot,
    })).resolves.toMatchObject({ updated: 1 })

    expect(managedAutomationMocks.records.get(previousFinal.automationId))
      .toMatchObject({
        activeUntil: '2026-05-05T21:00:00.000Z',
        instructions: 'New persist-then-deliver prompt.',
        // Legacy stored schedule retained so the moment still fires.
        schedule: { kind: 'at', at: '2026-04-29T15:00:00.000Z' },
        status: 'active',
      })
  })

  it('does not preserve a recurring legacy schedule when the new one-shot is stale (would otherwise fire the final review repeatedly)', async () => {
    // Regression guard: only an `at` legacy schedule earns the migration
    // preserve. A `cron`/`every`/`dailyLocal` legacy schedule would fire
    // one-shot instructions on every recurrence, so reconcile must archive.
    const recurringLegacy: StoredAutomationRecord = {
      automationId: 'automation_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      continuityPolicy: 'fresh',
      instructions: 'Old final-results prompt.',
      route: defaultRoute,
      schedule: { kind: 'cron', expression: '0 15 * * *' },
      slug: 'experiment-final-results-nz-run',
      status: 'active',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'experiment', 'final-results'],
      title: 'Old final results',
    }
    managedAutomationMocks.records.set(recurringLegacy.automationId, recurringLegacy)

    const newSeed: MurphManagedAutomationSeed = {
      automationId: recurringLegacy.automationId,
      slug: recurringLegacy.slug,
      title: 'Final results · NZ Run',
      schedule: { kind: 'at', at: '2026-04-28T21:00:00.000Z' },
      instructions: 'New persist-then-deliver prompt.',
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      // After the new desired one-shot's expiry window — a recurring legacy
      // schedule would otherwise be retained and fire repeatedly.
      now: new Date('2026-04-29T08:00:00.000Z'),
      seeds: [newSeed],
      vaultRoot,
    })).resolves.toMatchObject({ updated: 1 })

    expect(managedAutomationMocks.records.get(recurringLegacy.automationId))
      .toMatchObject({
        instructions: 'New persist-then-deliver prompt.',
        status: 'archived',
      })
  })

  it('archives an existing one-shot only when both the new and the legacy occurrence have expired', async () => {
    const previousFinal: StoredAutomationRecord = {
      automationId: 'automation_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      continuityPolicy: 'fresh',
      instructions: 'Old final-results prompt.',
      route: defaultRoute,
      schedule: { kind: 'at', at: '2026-04-29T15:00:00.000Z' },
      slug: 'experiment-final-results-nz-run',
      status: 'active',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'experiment', 'final-results'],
      title: 'Old final results',
    }
    managedAutomationMocks.records.set(previousFinal.automationId, previousFinal)

    const newSeed: MurphManagedAutomationSeed = {
      automationId: previousFinal.automationId,
      slug: previousFinal.slug,
      title: 'Final results · NZ Run',
      schedule: { kind: 'at', at: '2026-04-28T21:00:00.000Z' },
      instructions: 'New persist-then-deliver prompt.',
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      // After both the new desired fire and the legacy stored fire by far
      // more than the one-shot expiry window.
      now: new Date('2026-04-30T18:00:00.000Z'),
      seeds: [newSeed],
      vaultRoot,
    })).resolves.toMatchObject({ updated: 1 })

    expect(managedAutomationMocks.records.get(previousFinal.automationId))
      .toMatchObject({
        instructions: 'New persist-then-deliver prompt.',
        status: 'archived',
      })
  })

  it('creates a timely one-shot seed but skips it once stale', async () => {
    const featureDropSeed: MurphManagedAutomationSeed = {
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3G0',
      slug: 'feature-drop-test',
      title: 'Feature drop test',
      schedule: {
        kind: 'at',
        at: '2026-06-09T14:00:00.000Z',
      },
      instructions: 'Produce one product update.',
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T14:10:00.000Z'),
      seeds: [featureDropSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })

    managedAutomationMocks.records.clear()
    managedAutomationMocks.upsertAutomation.mockClear()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T15:01:00.000Z'),
      seeds: [featureDropSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 1,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('keeps a required one-shot installable until its finite active boundary', async () => {
    const requiredFinalSeed: MurphManagedAutomationSeed = {
      activeUntil: '2026-06-16T12:00:00.000Z',
      automationId: 'automation_required_final_window',
      continuityPolicy: 'fresh',
      instructions: 'Deliver the required final experiment review.',
      schedule: { kind: 'at', at: '2026-06-09T12:00:00.000Z' },
      slug: 'experiment-final-results-required-window',
      tags: ['experiment', 'final-results', ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG],
      title: 'Final results · Required window',
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      // Six days after the fire is beyond the generic one-hour window but
      // still inside this required review's explicit seven-day boundary.
      now: new Date('2026-06-15T12:00:00.000Z'),
      seeds: [requiredFinalSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.records.get(requiredFinalSeed.automationId))
      .toMatchObject({ activeUntil: requiredFinalSeed.activeUntil })

    const extendedSeed = {
      ...requiredFinalSeed,
      activeUntil: '2026-06-17T12:00:00.000Z',
    }
    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-15T12:05:00.000Z'),
      seeds: [extendedSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 0,
      updated: 1,
    })
    expect(managedAutomationMocks.records.get(requiredFinalSeed.automationId))
      .toMatchObject({ activeUntil: extendedSeed.activeUntil })

    managedAutomationMocks.records.clear()
    managedAutomationMocks.upsertAutomation.mockClear()
    await expect(applyMurphManagedAutomations({
      defaultRoute,
      // The boundary is exclusive: no new stale support is installed at it.
      now: new Date(extendedSeed.activeUntil),
      seeds: [extendedSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 1,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
  })

})
