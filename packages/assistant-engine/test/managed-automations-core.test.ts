import { rm } from 'node:fs/promises'

import {
  initializeVault,
  showAutomation,
  upsertAutomation,
} from '@murphai/core'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
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

function expectCronSchedule(
  schedule: NonNullable<Awaited<ReturnType<typeof showAutomation>>>['schedule'] | undefined,
): void {
  expect(schedule?.kind).toBe('cron')
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
  await initializeVault({ vaultRoot: context.vaultRoot })
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
      created: 4,
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
      slug: 'weekly-health-insight',
      status: 'active',
      title: 'Weekly health insight',
    })
    expectCronSchedule(insightRecord?.schedule)
    expect(insightRecord?.tags).toContain('murph-managed:weekly-health-insight')
    expect(insightRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(insightRecord?.instructions).toContain('specific to this user')
    expect(insightRecord?.instructions).toContain('On this scheduled weekly run')
    expect(insightRecord?.instructions).not.toContain('Sunday at noon local time')
    expect(insightRecord?.instructions).not.toContain('assistant onboarding')
    expect(insightRecord?.instructions).not.toContain('14 days')
    expect(insightRecord?.instructions).toContain('knowledge show weekly-health-insights')
    expect(insightRecord?.instructions).toContain('Use `weekly-health-insights` as the dedupe ledger')
    expect(insightRecord?.instructions).toContain('Do not scan every wiki page')
    expect(insightRecord?.instructions).toContain('knowledge append-section weekly-health-insights YYYY-MM-DD')
    expect(insightRecord?.instructions).toContain('section already exists')
    expect(insightRecord?.instructions).toContain('still send the concise note')
    expect(insightRecord?.instructions).toContain('Then send one concise note')
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

    const researchScoutRecord = await showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      vaultRoot,
    })

    expect(researchScoutRecord).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      route: defaultRoute,
      slug: 'weekly-health-research-scout',
      status: 'active',
      title: 'Weekly health research scout',
    })
    expectCronSchedule(researchScoutRecord?.schedule)
    expect(researchScoutRecord?.tags).toContain('murph-managed:weekly-health-research-scout')
    expect(researchScoutRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(researchScoutRecord?.instructions).toContain('On this scheduled weekly run')
    expect(researchScoutRecord?.instructions).not.toContain('Wednesday at 7:30 PM local time')
    expect(researchScoutRecord?.instructions).not.toContain('assistant onboarding')
    expect(researchScoutRecord?.instructions).not.toContain('14 days')
    expect(researchScoutRecord?.instructions).toContain('Use `vault-cli research scout-batch` once')
    expect(researchScoutRecord?.instructions).not.toContain('Use `vault-cli research scout` once')
    expect(researchScoutRecord?.instructions).toContain('Do not send raw lab values')
    expect(researchScoutRecord?.instructions).toContain('lowercase non-identifying category tags')
    expect(researchScoutRecord?.instructions).toContain('vault-cli research scout-batch-payload-schema --format json')
    expect(researchScoutRecord?.instructions).toContain('do not use a generic `tags` field')
    expect(researchScoutRecord?.instructions).toContain('YYYY-MM-DD dates or full ISO timestamps are accepted')
    expect(researchScoutRecord?.instructions).toContain('Suppress the scheduled message')

    const productUpdatesRecord = await showAutomation({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      vaultRoot,
    })

    expect(productUpdatesRecord).toMatchObject({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      route: defaultRoute,
      slug: 'weekly-product-updates',
      status: 'active',
      title: 'This week in Murph',
    })
    expectCronSchedule(productUpdatesRecord?.schedule)
    expect(productUpdatesRecord?.tags).toContain('murph-managed:weekly-product-updates')
    expect(productUpdatesRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(productUpdatesRecord?.instructions).toContain('/api/changelog?days=7&featureLimit=70&improvementLimit=10')
    expect(productUpdatesRecord?.instructions).toContain('scheduled announcement text-only')
    expect(productUpdatesRecord?.instructions).not.toContain('murph.attach_response_media')
    expect(productUpdatesRecord?.instructions).not.toContain('visual digest')
    expect(productUpdatesRecord?.instructions).not.toContain('links.digestCardTemplate')
    expect(productUpdatesRecord?.instructions).toContain('murph.submit_product_feedback')
    expect(productUpdatesRecord?.instructions).toContain('another feature in mind')
    expect(productUpdatesRecord?.instructions).toContain('clear inferred workflow friction')
    expect(productUpdatesRecord?.instructions).toContain('Speculative:')
    expect(productUpdatesRecord?.instructions).toContain('Murph-observed:')
    expect(productUpdatesRecord?.instructions).toContain('Do not log vague low-confidence guesses')
    expect(productUpdatesRecord?.instructions).toContain('concise product-only summary')
    expect(productUpdatesRecord?.instructions).toContain('tags, topics, raw user wording')
    expect(productUpdatesRecord?.instructions).not.toContain('kind/topic')
    expect(productUpdatesRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"Changelog feed unavailable or empty."}',
    )
    expect(productUpdatesRecord?.instructions).not.toContain('finish_without_reply')
  })

  it('creates managed health automations for hosted email targets without a local sender identity', async () => {
    const vaultRoot = await createVaultRoot()
    const hostedEmailTarget = serializeHostedEmailThreadTarget({
      subject: 'Hosted reminder',
      to: ['member@example.test'],
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute: {
        channel: 'email',
        deliveryTarget: hostedEmailTarget,
        identityId: 'hid_email_identity',
        participantId: null,
        threadId: null,
      },
      now: new Date('2026-06-09T12:00:00.000Z'),
      routeValidationProfile: 'hosted',
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      route: {
        channel: 'email',
        deliveryTarget: hostedEmailTarget,
        identityId: 'hid_email_identity',
        participantId: null,
        threadId: null,
      },
      slug: 'weekly-health-digest',
      status: 'active',
    })
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
      created: 4,
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
      skipped: 4,
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
      skipped: 4,
      updated: 0,
    })
  })

  it('does not create onboarding follow-up during managed automation maintenance', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      slug: 'finish-onboarding-followup',
      vaultRoot,
    })).resolves.toBeNull()
  })

  it('updates an existing owned onboarding follow-up without changing route, status, or schedule', async () => {
    const vaultRoot = await createVaultRoot()
    const existingRoute = {
      channel: 'linq' as const,
      deliveryTarget: 'existing-onboarding-thread',
      identityId: 'existing-onboarding-identity',
      participantId: null,
      threadId: null,
    }

    await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC',
      continuityPolicy: 'preserve',
      instructions: 'old onboarding follow-up instructions',
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: existingRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      slug: 'finish-onboarding-followup',
      status: 'paused',
      summary: 'Old onboarding follow-up summary.',
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        'murph-managed:onboarding-followup',
      ],
      title: 'Old onboarding follow-up',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })

    await expect(showAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC',
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC',
      continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      route: existingRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      slug: 'finish-onboarding-followup',
      status: 'paused',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    })
  })

  it('migrates the original unmarked onboarding follow-up seed', async () => {
    const vaultRoot = await createVaultRoot()

    await upsertAutomation({
      automationId: 'automation_01KCM5T5J4VB7D63T0Y29Q6R7A',
      continuityPolicy: 'preserve',
      instructions: legacyOnboardingFollowupInstructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
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
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })

    await expect(showAutomation({
      automationId: 'automation_01KCM5T5J4VB7D63T0Y29Q6R7A',
      vaultRoot,
    })).resolves.toMatchObject({
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

  it('updates an existing weekly health insight without rewriting its schedule', async () => {
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
      instructions: 'Each Wednesday at 6:00 PM local time, look for one old finding.',
      now: new Date('2026-06-09T12:00:00.000Z'),
      route: existingRoute,
      schedule: {
        kind: 'cron',
        expression: '0 18 * * 3',
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
      created: 3,
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
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'A weekly scout for one non-obvious personal health/body finding.',
      title: 'Weekly health insight',
    })
    expect(insightRecord?.schedule).toEqual({
      kind: 'cron',
      expression: '0 18 * * 3',
    })
    expect(insightRecord?.instructions).toContain('On this scheduled weekly run')
    expect(insightRecord?.instructions).not.toContain('Sunday at noon local time')
    expect(insightRecord?.instructions).not.toContain('6:00 PM local time')
  })

  it('preserves a device-activity trigger on an existing weekly health insight', async () => {
    const vaultRoot = await createVaultRoot()
    const existingRoute = {
      channel: 'telegram' as const,
      deliveryTarget: 'existing-thread',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    const deviceActivitySchedule = {
      after: '2026-06-09T12:00:00.000Z',
      activityKind: 'workout',
      kind: 'deviceActivity' as const,
      source: 'whoop' as const,
    }

    await upsertAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'After my next workout, look for one old finding.',
      now: new Date('2026-06-09T12:00:00.000Z'),
      route: existingRoute,
      schedule: deviceActivitySchedule,
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
      created: 3,
      skipped: 0,
      updated: 1,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      instructions: expect.stringContaining('On this scheduled weekly run'),
      schedule: deviceActivitySchedule,
    })
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
    const userResearchScoutAutomation = await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FA',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user-owned research scout prompt.',
      now: new Date('2026-06-09T12:00:00.000Z'),
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
      vaultRoot,
    })
    const userProductUpdatesAutomation = await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FB',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user-owned product update prompt.',
      now: new Date('2026-06-09T12:00:00.000Z'),
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
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 4,
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
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
    await expect(showAutomation({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
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
    await expect(showAutomation({
      automationId: userResearchScoutAutomation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: userResearchScoutAutomation.record.automationId,
      instructions: 'Keep this user-owned research scout prompt.',
      slug: 'weekly-health-research-scout',
      tags: ['user'],
      title: 'My weekly research scout',
    })
    await expect(showAutomation({
      automationId: userProductUpdatesAutomation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: userProductUpdatesAutomation.record.automationId,
      instructions: 'Keep this user-owned product update prompt.',
      slug: 'weekly-product-updates',
      tags: ['user'],
      title: 'My product updates',
    })
  })
})
