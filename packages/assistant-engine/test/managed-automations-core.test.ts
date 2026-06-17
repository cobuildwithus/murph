import { rm } from 'node:fs/promises'

import {
  showAutomation,
  upsertAutomation,
} from '@murphai/core'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  applyMurphManagedAutomations,
} from '../src/assistant/managed-automations.ts'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../src/assistant/automation-tags.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  )
})

async function createVaultRoot(): Promise<string> {
  const context = await createTempVaultContext('murph-managed-automations-core-')
  tempRoots.push(context.parentRoot)
  return context.vaultRoot
}

describe('applyMurphManagedAutomations core integration', () => {
  it('creates managed health automations through the canonical automation registry', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 2,
      skipped: 0,
      updated: 0,
    })

    const record = await showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })

    expect(record).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      route: defaultRoute,
      slug: 'weekly-health-digest',
      status: 'active',
      title: 'Weekly health digest',
    })

    const insightRecord = await showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })

    expect(insightRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 13 * * 3',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      title: 'Weekly health insight',
    })
    expect(insightRecord?.tags).toContain('murph-managed:weekly-health-insight')
    expect(insightRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(insightRecord?.instructions).toContain('specific to this user')
    expect(insightRecord?.instructions).toContain('1:00 PM local time')
    expect(insightRecord?.instructions).toContain('knowledge show weekly-health-insights')
    expect(insightRecord?.instructions).toContain('Use `weekly-health-insights` as the dedupe ledger')
    expect(insightRecord?.instructions).toContain('Do not scan every wiki page')
    expect(insightRecord?.instructions).toContain('knowledge append-section weekly-health-insights YYYY-MM-DD')
    expect(insightRecord?.instructions).toContain('section already exists')
    expect(insightRecord?.instructions).toContain('still send the concise note')
    expect(insightRecord?.instructions).toContain('Then send one concise note')
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
    expect(insightRecord?.instructions).toContain('CGM and running food/symptom logs')
    expect(insightRecord?.instructions).toContain('glucose curves')
    expect(insightRecord?.instructions).toContain('brain floor')
    expect(insightRecord?.instructions).toContain('do not diagnose insulin sensitivity')
  })

  it('creates over a Linq participant route with a Linq delivery source, preserving deliverySource', async () => {
    const vaultRoot = await createVaultRoot()
    const linqParticipantRoute = {
      channel: 'linq',
      deliverySource: {
        fromPhoneNumber: '+15550001111',
        kind: 'linq' as const,
      },
      deliveryTarget: null,
      identityId: 'hid_linq_identity_participant',
      participantId: '+15550002222',
      threadId: null,
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute: linqParticipantRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 2,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      route: linqParticipantRoute,
      status: 'active',
    })
    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      route: linqParticipantRoute,
      status: 'active',
    })
  })

  it('skips creation for a Linq participant route without a Linq delivery source', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'hid_linq_identity_participant',
        participantId: '+15550002222',
        threadId: null,
      },
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 2,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
  })

  it('is idempotent against the persisted record: a second apply writes nothing', async () => {
    const vaultRoot = await createVaultRoot()

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    // Guards against seed/persistence normalization drift (trimming, markdown
    // round-tripping, tag dedup order): the persisted record must compare
    // equal to the seed so background wakes never rewrite it.
    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 2,
      updated: 0,
    })
  })

  it('updates an existing weekly health insight to the managed 1:00 PM schedule', async () => {
    const vaultRoot = await createVaultRoot()
    const existingRoute = {
      channel: 'telegram' as const,
      deliveryTarget: 'existing-thread',
      identityId: null,
      participantId: null,
      threadId: null,
    }

    await upsertAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Each Wednesday after lunch, look for one old finding.',
      now: new Date('2026-06-09T12:00:00.000Z'),
      route: existingRoute,
      schedule: {
        kind: 'cron',
        expression: '30 13 * * 3',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'Old weekly insight.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health insight',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 1,
    })

    const insightRecord = await showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })

    expect(insightRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      route: existingRoute,
      schedule: {
        kind: 'cron',
        expression: '0 13 * * 3',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'A weekly scout for one non-obvious personal health/body finding.',
      title: 'Weekly health insight',
    })
    expect(insightRecord?.instructions).toContain('1:00 PM local time')
    expect(insightRecord?.instructions).not.toContain('after lunch')
  })

  it('does not overwrite a user automation that already owns the managed slug', async () => {
    const vaultRoot = await createVaultRoot()
    const userAutomation = await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3F8',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user-owned automation prompt.',
      now: new Date('2026-06-09T12:00:00.000Z'),
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
      vaultRoot,
    })
    const userInsightAutomation = await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3F9',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user-owned insight prompt.',
      now: new Date('2026-06-09T12:00:00.000Z'),
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
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 2,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
    await expect(showAutomation({
      automationId: userAutomation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: userAutomation.record.automationId,
      instructions: 'Keep this user-owned automation prompt.',
      slug: 'weekly-health-digest',
      tags: ['user'],
      title: 'My weekly health digest',
    })
    await expect(showAutomation({
      automationId: userInsightAutomation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: userInsightAutomation.record.automationId,
      instructions: 'Keep this user-owned insight prompt.',
      slug: 'weekly-health-insight',
      tags: ['user'],
      title: 'My weekly health insight',
    })
  })
})
