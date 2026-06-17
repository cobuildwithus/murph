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
  records: new Map<string, StoredAutomationRecord>(),
  showAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  showAutomation: managedAutomationMocks.showAutomation,
  upsertAutomation: managedAutomationMocks.upsertAutomation,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  applyAssistantSelfDeliveryTargetDefaults:
    managedAutomationMocks.applyAssistantSelfDeliveryTargetDefaults,
}))

vi.mock('@murphai/operator-config/assistant/current-delivery-route', () => ({
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
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  applyMurphManagedAutomations,
  type MurphManagedAutomationSeed,
} from '../src/assistant/managed-automations.ts'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../src/assistant/automation-tags.ts'

const vaultRoot = '/tmp/murph-managed-automations/vault'

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

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
})

describe('applyMurphManagedAutomations', () => {
  it('creates the managed health automations in a fresh vault', async () => {
    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 2,
      skipped: 0,
      updated: 0,
    })
    expect(managedAutomationMocks.upsertAutomation).toHaveBeenCalledTimes(2)
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
        expression: '30 14 * * 3',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      title: 'Weekly health insight',
    })
    expect(insightRecord?.tags).toContain('murph-managed:weekly-health-insight')
    expect(insightRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(insightRecord?.instructions).toContain('2:30 PM local time')
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
    expect(insightRecord?.instructions).toContain('Reject tautological findings')
    expect(insightRecord?.instructions).toContain('direct or obvious input')
    expect(insightRecord?.instructions).toContain('WHOOP recovery tracks sleep')
    expect(insightRecord?.instructions).toContain('compare independent signals')
    expect(insightRecord?.instructions).toContain('one or two credible studies')
    expect(insightRecord?.instructions).toContain('Bloodwork plus behavior')
    expect(insightRecord?.instructions).toContain('Biomarkers plus sleep')
    expect(insightRecord?.instructions).toContain('Supplement interplay')
    expect(insightRecord?.instructions).toContain('Treat this as a hypothesis')
    expect(insightRecord?.instructions).toContain('do not block the run')
    expect(insightRecord?.instructions).toContain('Food capture')
    expect(insightRecord?.instructions).toContain('Easy missing measurement')
    expect(insightRecord?.instructions).toContain('Supplement and pill routines')
    expect(insightRecord?.instructions).toContain('Food planning')
    expect(insightRecord?.instructions).toContain('Goal progress')
    expect(insightRecord?.instructions).toContain('Subjective state')
    expect(insightRecord?.instructions).toContain('Adherence friction')
    expect(insightRecord?.instructions).toContain('Fun experiments')
    expect(insightRecord?.instructions).toContain('feel more in control')
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
      skipped: 2,
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
      created: 1,
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
      created: 1,
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
      created: 2,
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
      skipped: 2,
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
      skipped: 2,
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

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 0,
      skipped: 2,
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
      skipped: 2,
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
