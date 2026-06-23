import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoredAutomationRecord = {
  automationId: string
  continuityPolicy: 'fresh' | 'preserve'
  instructions: string
  route: {
    channel: string
    deliveryTarget: string | null
    identityId: string | null
    participantId: string | null
    threadId: string | null
  }
  schedule:
    | { kind: 'at'; at: string }
    | { kind: 'cron'; expression: string }
    | { kind: 'dailyLocal'; localTime: string }
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
  patchAutomation: vi.fn(),
  records: new Map<string, StoredAutomationRecord>(),
  showAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  patchAutomation: managedAutomationMocks.patchAutomation,
  showAutomation: managedAutomationMocks.showAutomation,
  upsertAutomation: managedAutomationMocks.upsertAutomation,
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
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  applyMurphManagedAutomations,
  type MurphManagedAutomationSeed,
} from '../src/assistant/managed-automations.ts'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../src/assistant/automation-tags.ts'
import { findNextAssistantCronOccurrence } from '../src/assistant/cron/schedule.ts'

const vaultRoot = '/tmp/murph-managed-automations/vault'

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

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
  managedAutomationMocks.records.clear()
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
      automationId?: string
      continuityPolicy: 'fresh' | 'preserve'
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
        automationId,
        continuityPolicy: input.continuityPolicy,
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
      continuityPolicy?: 'fresh' | 'preserve'
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
        continuityPolicy: input.continuityPolicy ?? existing.continuityPolicy,
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
})

describe('applyMurphManagedAutomations', () => {
  it('keeps the managed weekly health insight on the Sunday noon local recurrence', () => {
    const insightSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    if (!insightSeed || insightSeed.schedule.kind !== 'cron') {
      throw new Error('Expected the weekly health insight to use a cron schedule.')
    }

    expect(insightSeed.schedule.expression).toBe('0 12 * * 0')
    expect(insightSeed.instructions).toContain('Each Sunday at noon local time')
    expect(insightSeed.instructions).not.toContain('Wednesday')
    expect(insightSeed.instructions).not.toContain('Friday at 2:30 PM local time')

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

  it('keeps the managed weekly health research scout on the Wednesday 1 PM local recurrence', () => {
    const researchScoutSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    if (!researchScoutSeed || researchScoutSeed.schedule.kind !== 'cron') {
      throw new Error('Expected the weekly health research scout to use a cron schedule.')
    }

    expect(researchScoutSeed.schedule.expression).toBe('0 13 * * 3')
    expect(researchScoutSeed.instructions).toContain('Each Wednesday at 1:00 PM local time')
    expect(researchScoutSeed.instructions).not.toContain('Friday morning')

    const nextRunAt = findNextAssistantCronOccurrence(
      researchScoutSeed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-06-24T17:00:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the weekly health research scout cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      researchScoutSeed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-07-01T17:00:00.000Z')
  })

  it('keeps weekly product updates on Thursday at 11:30 AM local time', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) => entry.automationId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    if (!seed || seed.schedule.kind !== 'cron') {
      throw new Error('Expected weekly product updates to use a cron schedule.')
    }

    expect(seed.schedule.expression).toBe('30 11 * * 4')
    expect(seed.instructions).toContain('/api/changelog?days=7')
    expect(seed.instructions).toContain('murph.attach_response_media')
    expect(seed.instructions).toContain('murph.submit_product_feedback')
    expect(seed.instructions).toContain('another feature in mind')
    expect(seed.instructions).toContain('expresses product frustration')
    expect(findNextAssistantCronOccurrence(
      seed.schedule.expression,
      new Date('2026-06-22T12:00:00.000Z'),
      'America/New_York',
    )).toBe('2026-06-25T15:30:00.000Z')
  })

  it('creates the managed automations in a fresh vault', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 4,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledTimes(4)
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))
      .toMatchObject({
        automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
        continuityPolicy: 'fresh',
        route: defaultRoute,
        schedule: {
          kind: 'cron',
          expression: '0 9 * * 1',
        },
        slug: 'weekly-health-digest',
        status: 'active',
        title: 'Weekly health digest',
      })

    const insightRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    expect(insightRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 12 * * 0',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      title: 'Weekly health insight',
    })
    expect(insightRecord?.tags).toContain('murph-managed:weekly-health-insight')
    expect(insightRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(insightRecord?.instructions).toContain('Sunday at noon local time')
    expect(insightRecord?.instructions).not.toContain('assistant onboarding')
    expect(insightRecord?.instructions).not.toContain('14 days')
    expect(insightRecord?.instructions).toContain('knowledge show weekly-health-insights')
    expect(insightRecord?.instructions).toContain('Use `weekly-health-insights` as the dedupe ledger')
    expect(insightRecord?.instructions).toContain('Do not scan every wiki page')
    expect(insightRecord?.instructions).toContain('do not create per-week insight pages')
    expect(insightRecord?.instructions).toContain('knowledge append-section weekly-health-insights YYYY-MM-DD')
    expect(insightRecord?.instructions).toContain('section already exists')
    expect(insightRecord?.instructions).toContain('do not append another section')
    expect(insightRecord?.instructions).toContain('--body <markdown>')
    expect(insightRecord?.instructions).toContain('--source-path <canonical-vault-path>')
    expect(insightRecord?.instructions).toContain('suppress the scheduled message')
    expect(insightRecord?.instructions).toContain('do not append to the wiki')
    expect(insightRecord?.instructions).toContain('plain adult language')
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

    const researchScoutRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    expect(researchScoutRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 13 * * 3',
      },
      slug: 'weekly-health-research-scout',
      status: 'active',
      title: 'Weekly health research scout',
    })
    expect(researchScoutRecord?.tags).toContain('murph-managed:weekly-health-research-scout')
    expect(researchScoutRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(researchScoutRecord?.instructions).toContain('Wednesday at 1:00 PM local time')
    expect(researchScoutRecord?.instructions).not.toContain('assistant onboarding')
    expect(researchScoutRecord?.instructions).not.toContain('14 days')
    expect(researchScoutRecord?.instructions).toContain('0-3 new studies')
    expect(researchScoutRecord?.instructions).toContain('knowledge show weekly-health-research-scout')
    expect(researchScoutRecord?.instructions).toContain('EXA_API_KEY')
    expect(researchScoutRecord?.instructions).toContain('tag-level only')
    expect(researchScoutRecord?.instructions).toContain('lowercase non-identifying category tags')
    expect(researchScoutRecord?.instructions).toContain('Do not send raw lab values')
    expect(researchScoutRecord?.instructions).toContain('Use `vault-cli research scout` once')
    expect(researchScoutRecord?.instructions).toContain('Do not perform an open-ended web browsing loop')
    expect(researchScoutRecord?.instructions).toContain('Deduplicate against prior `weekly-health-research-scout` sections')
    expect(researchScoutRecord?.instructions).toContain('Suppress the scheduled message')
    expect(researchScoutRecord?.instructions).toContain('Append one dated section to `weekly-health-research-scout`')
    expect(researchScoutRecord?.instructions).toContain('clinician discussion prompt')

    const productUpdatesRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    expect(productUpdatesRecord).toMatchObject({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '30 11 * * 4',
      },
      slug: 'weekly-product-updates',
      status: 'active',
      title: 'This week in Murph',
    })
    expect(productUpdatesRecord?.tags).toContain(
      'murph-managed:weekly-product-updates',
    )
    expect(productUpdatesRecord?.tags).not.toContain(
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    )
    expect(productUpdatesRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"Changelog feed unavailable or empty."}',
    )
    expect(productUpdatesRecord?.instructions).not.toContain('finish_without_reply')
  })

  it('updates existing research-oriented automations to the managed cadence', async () => {
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
      created: 2,
      skipped: 0,
      updated: 2,
    })
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
      .toMatchObject({
        schedule: {
          kind: 'cron',
          expression: '0 12 * * 0',
        },
      })
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID)
        ?.instructions,
    )
      .toContain('Sunday at noon local time')
    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID))
      .toMatchObject({
        schedule: {
          kind: 'cron',
          expression: '0 13 * * 3',
        },
      })
    expect(
      managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID)
        ?.instructions,
    ).toContain('Wednesday at 1:00 PM local time')
  })

  it('skips the research scout seed when hosted runtime env lacks Exa', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      runtimeEnv: {},
      vaultRoot,
    })

    expect(result).toEqual({
      created: 3,
      skipped: 1,
      updated: 0,
    })
    expect(managedAutomationMocks.records.has(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))
      .toBe(true)
    expect(managedAutomationMocks.records.has(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))
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
      skipped: 4,
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
      created: 3,
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

  it('reconciles an existing active onboarding follow-up definition by owned slug', async () => {
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
      instructions: 'old onboarding follow-up instructions',
      route: existingRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
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
      created: 4,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.patchAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        lookup: 'automation_onboarding_followup',
        summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
        tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
        title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      }),
    )
    expect(managedAutomationMocks.patchAutomation.mock.calls[0]?.[0])
      .not.toHaveProperty('route')
    expect(managedAutomationMocks.patchAutomation.mock.calls[0]?.[0])
      .not.toHaveProperty('schedule')
    expect(managedAutomationMocks.patchAutomation.mock.calls[0]?.[0])
      .not.toHaveProperty('status')
    expect(managedAutomationMocks.records.get('automation_onboarding_followup'))
      .toMatchObject({
        route: existingRoute,
        schedule: {
          kind: 'dailyLocal',
          localTime: '08:00',
        },
        status: 'active',
      })
  })

  it('updates a paused onboarding follow-up without reactivating it', async () => {
    managedAutomationMocks.records.set('automation_onboarding_followup', {
      automationId: 'automation_onboarding_followup',
      continuityPolicy: 'preserve',
      instructions: 'old onboarding follow-up instructions',
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      slug: 'finish-onboarding-followup',
      status: 'paused',
      summary: 'Old summary',
      tags: ['assistant', 'scheduled', 'murph-managed', 'murph-managed:onboarding-followup'],
      title: 'Old onboarding follow-up',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.patchAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: 'automation_onboarding_followup',
      }),
    )
    expect(managedAutomationMocks.records.get('automation_onboarding_followup'))
      .toMatchObject({
        route: defaultRoute,
        schedule: {
          kind: 'dailyLocal',
          localTime: '08:00',
        },
        status: 'paused',
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
      created: 4,
      skipped: 0,
      updated: 1,
    })

    expect(managedAutomationMocks.records.get('automation_legacy_onboarding_followup'))
      .toMatchObject({
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        route: defaultRoute,
        schedule: {
          everyMs: 90_000,
          kind: 'every',
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
      created: 4,
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
      tags: ['assistant', 'scheduled'],
      title: 'User follow-up',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
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
      created: 3,
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
      created: 4,
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

  it('skips creation when no deliverable route exists', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute: null,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 4,
      updated: 0,
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
      skipped: 4,
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
      skipped: 4,
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
      skipped: 4,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).not.toHaveBeenCalled()
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
})
