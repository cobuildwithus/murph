import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  initializeVault,
  loadVault,
  patchAutomation,
  showAutomation,
  upsertAutomation,
} from '@murphai/core'
import { buildAutomationSupportSeriesTag } from '@murphai/contracts'
import {
  HOSTED_RUNTIME_PROCESS_ENV,
} from '@murphai/hosted-execution/env'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
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
  type MurphManagedAutomationDiagnosticStage,
  type MurphOnboardingFollowupDiagnostic,
} from '../src/assistant/managed-automations.ts'
import {
  completeAssistantOnboarding,
  readAssistantOnboardingState,
  resolveAssistantOnboardingStatePath,
  startAssistantOnboarding,
} from '../src/assistant/onboarding-state.ts'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../src/assistant/automation-tags.ts'
import { upsertAssistantCronAutomation } from '../src/assistant/cron/authoring.ts'
import { resolveAssistantCronDefaultTimeZone } from '../src/assistant/cron/canonical-jobs.ts'
import { computeAssistantCronFirstRunAfterCurrentLocalDay } from '../src/assistant/cron/schedule.ts'
import * as assistantCronRuntimeState from '../src/assistant/cron/runtime-state.ts'
import {
  resolveMurphOnboardingFollowupActiveUntil,
  resolveMurphOnboardingFollowupSchedule,
} from '../src/assistant/onboarding-followup-automation.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'
import {
  onboardingFollowupPredecessorDefinitions,
} from './onboarding-followup-predecessor-fixtures.ts'

const tempRoots: string[] = []

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

const historicalRecurringOnboardingFollowupDefinition = {
  continuityPolicy: 'preserve' as const,
  instructions: [
    'Goal: advance Murph onboarding through an anchored health aspiration, a finite health-context foundation, and a contextual return without turning it into a drip questionnaire or unsolicited plan. Ordinary health help remains available while onboarding is open. The first scheduled occurrence is intentionally deferred until the next local day after the relationship begins.',
    '',
    'Before deciding, read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md`, run `vault-cli assistant onboarding resume-context --format json`, and read the available recent user messages. The skill is the single owner of conversation order, checkpoint meaning, persistence, and completion; do not create a second state machine in this automation.',
    '',
    'Success criteria: onboarding is no longer open, or exactly one skill-approved, reply-oriented onboarding question usefully advances the relationship.',
    '',
    'If `onboarding.status` is `completed`, return skip. The managed-automation owner archives this follow-up deterministically.',
    '',
    'If the onboarding skill says the visible and saved evidence satisfies answered completion, or shows an overall decline, run its required completion command. Whether completion succeeds or fails, return skip without messaging; the managed-automation owner retires the follow-up after completion.',
    '',
    'Otherwise use exactly the next unresolved step from the onboarding skill, including aspiration capture, explicit parking, foundation questions, contextual return, and its targeted-read rules for omitted, truncated, or errored evidence. If that step is only a reflection or parking transition, combine it with the next skill-approved question when the skill permits; otherwise return skip. Do not compress, reorder, or bypass that policy merely because this is a scheduled run.',
    '',
    'This automation never owns a promised check-in, reminder, or proactive support action. Those use the canonical plan and dedicated automation required by `behavior-followthrough`, which owns timing, due evaluation, delivery, retry, and skip behavior.',
    '',
    'Before sending, triple-check the snapshot and recent messages for an answer, skip, defer, or decline. Do not re-ask known or resolved context. If the latest onboarding question is unanswered, do not rotate to another setup question or repeat it through this daily automation; return skip. Honor requested timing, and return skip whenever there is no timely, useful onboarding continuation.',
    '',
    "Output: send one brief, natural, low-pressure in-chat continuation only when it advances unfinished onboarding. Every user-facing scheduled continuation must include exactly one easy, reply-oriented question; otherwise return skip. Do not mention internal state, setup completion, or this automation, and do not use a fixed script. The user's reply will be handled by the next normal Murph onboarding turn.",
  ].join('\n'),
  slug: 'finish-onboarding-followup',
  summary:
    'Daily aspiration-and-foundation continuation check until Murph onboarding is complete.',
  tags: [
    'assistant',
    'scheduled',
    'murph-managed',
    'onboarding',
    'murph-managed:onboarding-followup',
  ],
  title: 'Finish Murph onboarding follow-up',
} as const

const immediatePreviousOneshotOnboardingFollowupDefinition = {
  continuityPolicy: 'preserve' as const,
  instructions: [
    'Goal: make one finite, low-pressure final attempt to reopen unfinished Murph onboarding and get a reply. This one-shot is consumed whether you send or skip. Never create, re-enable, or reschedule another onboarding follow-up; ordinary health help and reply-driven onboarding remain available after this run.',
    '',
    'Before deciding, read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md`, run `vault-cli assistant onboarding resume-context --format json`, and read the available recent user messages. The skill is the single owner of conversation order, checkpoint meaning, persistence, and completion; do not create a second state machine in this automation.',
    '',
    'Success criteria: onboarding is no longer open, or one brief, skill-compatible question gives the member an easy way to reply and continue.',
    '',
    'If `onboarding.status` is `completed`, return skip. The managed-automation owner archives this follow-up deterministically.',
    '',
    'This background occurrence must never run the onboarding completion command or otherwise mutate onboarding state. If the visible and saved evidence shows onboarding is already answered, declined, deferred, or no longer useful to reopen, return an ordinary skip. Only a later foreground user reply may advance or complete onboarding.',
    '',
    'Otherwise use exactly the next unresolved step from the onboarding skill, including aspiration capture, explicit parking, foundation questions, contextual return, and its targeted-read rules for omitted, truncated, or errored evidence. If that step is only a reflection or parking transition, combine it with the next skill-approved question when the skill permits; otherwise return skip. Do not compress, reorder, or bypass that policy merely because this is a scheduled run.',
    '',
    'This automation never owns a promised check-in, reminder, or proactive support action. Those use the canonical plan and dedicated automation required by `behavior-followthrough`, which owns timing, due evaluation, delivery, retry, and skip behavior.',
    '',
    'Before sending, triple-check the snapshot and recent messages for an answer, skip, defer, decline, or a newer topic that should win. Follow the onboarding skill’s finite next-day recovery rule exactly. Do not re-ask known or resolved context, repeat an unanswered setup question, or rotate to another setup question. Honor requested timing and return skip after an explicit decline, a request not to follow up, or whenever the finite reopening question would not be timely or useful.',
    '',
    "Output: send at most one brief, natural, low-pressure in-chat continuation. It must contain exactly one easy, reply-oriented question; otherwise return an ordinary skip. Do not mention internal state, setup completion, final attempts, schedules, or this automation, and do not use a fixed script. The user's reply will be handled by the next normal Murph onboarding turn.",
  ].join('\n'),
  slug: 'finish-onboarding-followup',
  summary:
    'One finite next-day invitation to continue unfinished Murph onboarding.',
  tags: [
    'assistant',
    'scheduled',
    'murph-managed',
    'onboarding',
    'murph-managed:onboarding-followup',
  ],
  title: 'Final Murph onboarding follow-up',
} as const

function expectCronSchedule(
  schedule: NonNullable<Awaited<ReturnType<typeof showAutomation>>>['schedule'] | undefined,
): void {
  expect(schedule?.kind).toBe('cron')
}

function expectEveryTwoWeeksSchedule(
  schedule: NonNullable<Awaited<ReturnType<typeof showAutomation>>>['schedule'] | undefined,
): void {
  expect(schedule).toEqual({
    kind: 'every',
    everyMs: 14 * 24 * 60 * 60 * 1000,
  })
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

async function startOnboarding(input: {
  startedAt: string
  vaultRoot: string
}): Promise<void> {
  await startAssistantOnboarding({
    startedAt: input.startedAt,
    vault: input.vaultRoot,
  })
}

describe('applyMurphManagedAutomations core integration', () => {
  it('seeds one finite follow-up from durable onboarding start and preserves archive', async () => {
    const vaultRoot = await createVaultRoot()
    const route = {
      channel: 'telegram',
      deliveryTarget: 'telegram-direct-target',
      identityId: 'telegram-bot-identity',
      participantId: 'telegram-direct-participant',
      threadId: 'telegram-direct-thread',
      threadIsDirect: true,
    }
    const ambientRoute = {
      ...route,
      deliveryTarget: 'different-ambient-target',
      participantId: 'different-ambient-participant',
      threadId: 'different-ambient-thread',
    }
    await applyMurphManagedAutomations({
      defaultRoute: ambientRoute,
      now: new Date('2026-08-20T12:00:00.000Z'),
      vaultRoot,
    })
    await expect(showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })).resolves.toBeNull()

    await startOnboarding({
      startedAt: '2026-08-20T12:01:00.000Z',
      vaultRoot,
    })

    // Replaying activation cannot move the original onboarding window.
    await startOnboarding({
      startedAt: '2026-08-21T12:01:00.000Z',
      vaultRoot,
    })
    await expect(readAssistantOnboardingState(vaultRoot)).resolves.toMatchObject({
      createdAt: '2026-08-20T12:01:00.000Z',
      status: 'open',
    })

    await applyMurphManagedAutomations({
      defaultRoute: null,
      now: new Date('2026-08-22T12:01:30.000Z'),
      vaultRoot,
    })
    await expect(showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })).resolves.toBeNull()

    // The first available direct route completes the activation-owned seed.
    await applyMurphManagedAutomations({
      defaultRoute: route,
      now: new Date('2026-08-22T12:02:00.000Z'),
      vaultRoot,
    })

    const automation = await showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })
    expect(automation).toMatchObject({
      route,
      schedule: { kind: 'dailyLocal' },
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: 'active',
    })
    const timeZone = await resolveAssistantCronDefaultTimeZone(vaultRoot)
    const originalFirstOccurrenceAt =
      computeAssistantCronFirstRunAfterCurrentLocalDay({
        after: new Date('2026-08-20T12:01:00.000Z'),
        schedule: {
          ...resolveMurphOnboardingFollowupSchedule(
            (await loadVault({ vaultRoot })).metadata.vaultId,
          ),
          timeZone,
        },
      })
    expect(automation?.activeUntil).toBe(
      resolveMurphOnboardingFollowupActiveUntil({
        scheduledAt: originalFirstOccurrenceAt,
        timeZone,
      }),
    )

    await applyMurphManagedAutomations({
      now: new Date('2026-08-22T12:03:00.000Z'),
      vaultRoot,
    })
    await expect(showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })).resolves.toMatchObject({ automationId: automation?.automationId })

    await patchAutomation({
      lookup: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: 'archived',
      vaultRoot,
    })
    await applyMurphManagedAutomations({
      now: new Date('2026-08-22T12:04:00.000Z'),
      vaultRoot,
    })
    await expect(showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })).resolves.toMatchObject({ status: 'archived' })
  })

  it('does not turn an expired onboarding start into a new follow-up window', async () => {
    const vaultRoot = await createVaultRoot()
    const route = {
      channel: 'telegram',
      deliveryTarget: 'telegram-historical-target',
      identityId: 'telegram-historical-identity',
      participantId: 'telegram-historical-participant',
      threadId: 'telegram-historical-thread',
      threadIsDirect: true,
    }
    await startOnboarding({
      startedAt: '2026-07-01T12:01:00.000Z',
      vaultRoot,
    })
    await applyMurphManagedAutomations({
      defaultRoute: route,
      now: new Date('2026-08-20T12:02:00.000Z'),
      vaultRoot,
    })

    await expect(showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })).resolves.toBeNull()
  })

  it.each([
    ['a Telegram group', { channel: 'telegram', threadIsDirect: false }, false],
    ['a Linq direct chat', { channel: 'linq', threadIsDirect: true }, true],
  ])('seeds the onboarding follow-up for %s only when direct', async (
    _label,
    override,
    shouldSeed,
  ) => {
    const vaultRoot = await createVaultRoot()
    const route = {
      channel: override.channel,
      deliveryTarget: 'channel-target',
      identityId: 'channel-identity',
      participantId: null,
      threadId: 'channel-thread',
      threadIsDirect: override.threadIsDirect,
    }
    await startAssistantOnboarding({
      startedAt: '2026-08-20T12:01:00.000Z',
      vault: vaultRoot,
    })
    await applyMurphManagedAutomations({
      defaultRoute: route,
      now: new Date('2026-08-20T12:02:00.000Z'),
      vaultRoot,
    })

    const automation = await showAutomation({
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      vaultRoot,
    })
    expect(automation === null).toBe(!shouldSeed)
  })

  it.each([
    ['completed', 'user_answered'],
    ['declined', 'user_declined'],
  ] as const)(
    'does not reopen a %s onboarding relationship after activation',
    async (_label, completionReason) => {
      const vaultRoot = await createVaultRoot()
      const route = {
        channel: 'telegram',
        deliveryTarget: 'telegram-completed-target',
        identityId: 'telegram-completed-identity',
        participantId: null,
        threadId: 'telegram-completed-thread',
        threadIsDirect: true,
      }
      await startOnboarding({
        startedAt: '2026-08-20T12:01:00.000Z',
        vaultRoot,
      })
      await completeAssistantOnboarding({
        completedAt: '2026-08-20T12:02:00.000Z',
        reason: completionReason,
        vault: vaultRoot,
      })

      await applyMurphManagedAutomations({
        defaultRoute: route,
        now: new Date('2026-08-20T12:03:00.000Z'),
        vaultRoot,
      })

      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
        vaultRoot,
      })).resolves.toBeNull()
    },
  )

  it('persists one automatic meal closeout through the canonical automation registry', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(showAutomation({
      automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()

    const first = await ensureAutomaticMealCloseoutAutomation({
      defaultRoute,
      now: new Date('2026-07-22T14:01:00.000Z'),
      vaultRoot,
    })
    const replay = await ensureAutomaticMealCloseoutAutomation({
      defaultRoute,
      now: new Date('2026-07-22T14:02:00.000Z'),
      vaultRoot,
    })

    expect(first).toMatchObject({
      automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '21:00',
      },
      slug: 'automatic-meal-daily-closeout',
      status: 'active',
    })
    expect(replay).toEqual(first)
  })

  it('keeps diagnostic stage reporting best-effort', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      onDiagnosticStage() {
        throw new Error('diagnostic sink unavailable')
      },
      seeds: [],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 0,
      updated: 0,
    })
  })

  it('still creates unrelated automations when experiment lifecycle staging fails', async () => {
    const vaultRoot = await createVaultRoot()
    // A stray Markdown document is the one entry the experiment scan still
    // refuses, and it must not take the rest of the pass down with it.
    await writeFile(
      join(vaultRoot, 'bank/experiments/Stray Copy.md'),
      '---\nslug: stray\n---\n',
      'utf8',
    )

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result.created).toBe(5)
    expect(result.experimentLifecycleFailure).toMatchObject({
      code: 'EXPERIMENT_STORAGE_INVALID',
    })
    expect(
      await showAutomation({
        automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
        vaultRoot,
      }),
    ).toMatchObject({ status: 'active' })
  })

  it('never archives live experiment automations when the experiment scan fails', async () => {
    const vaultRoot = await createVaultRoot()
    // An existing, active experiment support-series automation. A failed scan
    // leaves desired experiment state unknown, so this must survive untouched:
    // reconciling an empty desired set here would archive the user's live
    // experiment check-ins and they cannot all be recovered afterwards.
    const supportSeriesTag = buildAutomationSupportSeriesTag(
      'experiment-lifecycle:sleep-reset',
    )
    const experimentAutomationId = 'automation_01K2WKKY3F8Q4R5S6T7V8W9XAC'
    await upsertAutomation({
      automationId: experimentAutomationId,
      continuityPolicy: 'fresh',
      instructions: 'Existing experiment check-in.',
      route: defaultRoute,
      schedule: { kind: 'every', everyMs: 24 * 60 * 60 * 1000 },
      slug: 'experiment-check-in',
      status: 'active',
      tags: [supportSeriesTag],
      title: 'Experiment check-in',
      vaultRoot,
    })

    await writeFile(
      join(vaultRoot, 'bank/experiments/Stray Copy.md'),
      '---\nslug: stray\n---\n',
      'utf8',
    )

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result.experimentLifecycleFailure).toMatchObject({
      code: 'EXPERIMENT_STORAGE_INVALID',
    })
    expect(result.created).toBe(5)
    expect(
      await showAutomation({ automationId: experimentAutomationId, vaultRoot }),
    ).toMatchObject({ status: 'active' })
  })

  it('creates managed health automations through the canonical automation registry', async () => {
    const vaultRoot = await createVaultRoot()
    const diagnosticStages: MurphManagedAutomationDiagnosticStage[] = []

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      onDiagnosticStage(diagnostic) {
        diagnosticStages.push(diagnostic)
      },
      vaultRoot,
    })
    expect(result).toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    expect(diagnosticStages).toEqual([
      { stage: 'experiment_lifecycle' },
      { stage: 'onboarding_goal_checkin' },
      { stage: 'seed_composition' },
      ...Array.from({ length: 5 }, (_value, seedIndex) => ({
        seedCount: 5,
        seedPosition: seedIndex + 1,
        stage: 'managed_seed' as const,
      })),
      { stage: 'onboarding_followup' },
      { stage: 'experiment_support_series' },
    ])

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
    expect(record?.tags).toContain('murph-managed:weekly-health-digest')
    expect(record?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(record?.instructions).toContain('still remember ten seconds after reading')
    expect(record?.instructions).toContain('murph.device')
    expect(record?.instructions).toContain('vault-cli wearables sources list')
    expect(record?.instructions).toContain('Wearable connected but not delivering')
    expect(record?.instructions).toContain('action: connect')
    expect(record?.instructions).toContain('no connected device accounts, no live wearable, no recent manual logs')
    expect(record?.instructions).toContain('what was probably noise')
    expect(record?.instructions).toContain(
      'An official weather alert alone never clears the proactive send bar',
    )
    expect(record?.instructions).toContain(
      'Never infer an alert from raw weather, AQI, or Murph-defined thresholds',
    )
    expect(record?.instructions).toContain('Never restate single-day metric values')
    expect(record?.instructions).toContain('Proactive health outreach is not a report card')
    expect(record?.instructions).toContain(
      'Persona and tone preferences may shape warmth and phrasing',
    )
    expect(record?.instructions).toContain('Never use steps as a proxy for all exercise')
    expect(record?.instructions).toContain(
      'Never make Murph\'s tracking mismatch the user-facing takeaway',
    )
    expect(record?.instructions).toContain(
      '{"kind":"skip","privateSummary":"No weekly digest cleared the memorability bar."}',
    )

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
    expect(insightRecord?.assistantTargetOverride).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
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
    expect(insightRecord?.instructions).toContain('vault-cli wearables patterns --date YYYY-MM-DD --format json')
    expect(insightRecord?.instructions).toContain('continue with the existing bounded manual candidate search')
    expect(insightRecord?.instructions).toContain('Do not treat command failure as evidence')
    expect(insightRecord?.instructions).toContain('stages of repeated association, not proof')
    expect(insightRecord?.instructions).toContain('pattern report narrows the search')
    expect(insightRecord?.instructions).toContain('find zero or one useful')
    expect(insightRecord?.instructions).toContain('better to send nothing')
    expect(insightRecord?.instructions).toContain('knowledge append-section weekly-health-insights YYYY-MM-DD')
    expect(insightRecord?.instructions).toContain('section already exists')
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
    expect(insightRecord?.instructions).toContain('Then, only when the finding clears the bar')
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
    expect(insightRecord?.instructions).toContain('Never infer alcohol use from a bad night')
    expect(insightRecord?.instructions).toContain(
      'Do not send a weekly insight whose main point is that drinking or a late Friday/Saturday night hurt sleep or recovery',
    )
    expect(insightRecord?.instructions).not.toContain('rough portions, alcohol')
    expect(insightRecord?.instructions).not.toContain('drink count')
    expect(insightRecord?.instructions).not.toContain('alcohol plus travel day')
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
    expect(insightRecord?.instructions).toContain(
      'A plain behavioral decline—fewer steps, fewer workouts, later bedtimes, or less logging—is not an insight by itself.',
    )
    expect(insightRecord?.instructions).toContain(
      'Preserve useful uncomfortable physiological findings',
    )
    expect(insightRecord?.instructions).toContain(
      'Steps are not a substitute for exercise',
    )

    const improvementCoachRecord = await showAutomation({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      vaultRoot,
    })

    expect(improvementCoachRecord).toMatchObject({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      route: defaultRoute,
      schedule: { kind: 'cron', expression: '0 17 1 * *' },
      slug: 'monthly-improvement-coach',
      status: 'active',
      summary: 'A monthly check for one user-relevant health friction worth offering help with.',
      title: 'Monthly improvement coach',
    })
    expect(improvementCoachRecord?.assistantTargetOverride).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(improvementCoachRecord?.tags).toContain('murph-managed:monthly-improvement-coach')
    expect(improvementCoachRecord?.tags).not.toContain('murph-managed:weekly-improvement-coach')
    expect(improvementCoachRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(improvementCoachRecord?.instructions).toContain(
      'An official weather alert alone never clears the proactive send bar',
    )
    expect(improvementCoachRecord?.instructions).toContain('knowledge show improvement-opportunities')
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
    expect(improvementCoachRecord?.instructions).toContain(
      'If it could reasonably read as scolding, disappointment, surveillance, a grade, or "you need to do better," it does not clear the send bar.',
    )

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
    expect(researchScoutRecord?.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
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
    expect(researchScoutRecord?.instructions).not.toContain('lowercase non-identifying category tags')
    expect(researchScoutRecord?.instructions).toContain('run `vault-cli research scout-batch-payload-schema --format json`')
    expect(researchScoutRecord?.instructions).toContain('sole provider-value catalog')
    expect(researchScoutRecord?.instructions).toContain('every provider value is an exact concept allowed for that field')
    expect(researchScoutRecord?.instructions).toContain('If none exists, suppress the scheduled message without calling `vault-cli research scout-batch`')
    expect(researchScoutRecord?.instructions).toContain('If no current question can be represented exactly, suppress the scheduled message without calling `vault-cli research scout-batch`')
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
    expect(researchScoutRecord?.instructions).toContain('Suppress the scheduled message')
    expect(researchScoutRecord?.instructions).toContain('The unit of value is the insight, not the paper')
    expect(researchScoutRecord?.instructions).toContain('The scout-batch call is the retrieval budget')
    expect(researchScoutRecord?.instructions).toContain('Recent conversation and automation/regimen changes are veto context')
    expect(researchScoutRecord?.instructions).toContain('incremental value beyond known basics')
    expect(researchScoutRecord?.instructions).toContain('still remember the point ten seconds after reading')
    expect(researchScoutRecord?.instructions).toContain('Hard provenance gate: if the note could have been written without this run\'s retrieved sources')
    expect(researchScoutRecord?.instructions).toContain('Skipping is the expected outcome')
    expect(researchScoutRecord?.instructions).toContain('Do not reuse the provider candidate\'s `actionOrQuestion` as advice')

    const productUpdatesRecord = await showAutomation({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      vaultRoot,
    })

    expect(productUpdatesRecord).toMatchObject({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      route: defaultRoute,
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'A biweekly personalized note alternating what is new in Murph with things Murph can do for you.',
      title: 'Murph product notes',
    })
    expectEveryTwoWeeksSchedule(productUpdatesRecord?.schedule)
    expect(productUpdatesRecord?.instructions).toContain('Goal: every two weeks')
    expect(productUpdatesRecord?.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
    })
    expect(productUpdatesRecord?.tags).toContain('murph-managed:weekly-product-updates')
    expect(productUpdatesRecord?.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expect(productUpdatesRecord?.instructions).toContain('/api/changelog?days=14&featureLimit=70&improvementLimit=10')
    expect(productUpdatesRecord?.instructions).toContain('/api/feature-catalog')
    expect(productUpdatesRecord?.instructions).toContain('Read `vault-cli knowledge show murph-product-notes`')
    expect(productUpdatesRecord?.instructions).toContain('choose the feature discovery kind')
    expect(productUpdatesRecord?.instructions).toContain('last recorded changelog means feature discovery now')
    expect(productUpdatesRecord?.instructions).toContain('last recorded feature discovery means changelog now')
    expect(productUpdatesRecord?.instructions).toContain('Use `murph-product-notes` as the only ledger')
    expect(productUpdatesRecord?.instructions).toContain('Do not create per-week pages')
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
    expect(productUpdatesRecord?.instructions).toContain(
      'member-facing product update, not a dump of release notes',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'introduces or materially changes a member-facing action, decision, or visible experience',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'Never pitch reliability work.',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'only restores or hardens otherwise unchanged behavior or reports internal durability',
    )
    expect(productUpdatesRecord?.instructions).not.toContain(
      'member encountered the corresponding issue',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'lower priority than exciting capabilities',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'if neither kind clears, skip',
    )
    expect(productUpdatesRecord?.instructions).toContain('Drop items the user is already using')
    expect(productUpdatesRecord?.instructions).toContain('context already surfaced for ordinary assistance')
    expect(productUpdatesRecord?.instructions).toContain('Do not open raw health records, uploaded documents, inbox attachments, provider payloads, transcripts, or raw notes solely to decide whether a feature was used')
    expect(productUpdatesRecord?.instructions).toContain('Drop items already pitched in any prior ledger section; never repeat a feature pitch')
    expect(productUpdatesRecord?.instructions).toContain('If an item lists a requires prerequisite')
    expect(productUpdatesRecord?.instructions).toContain('Drop items this conversation cannot actually do right now')
    expect(productUpdatesRecord?.instructions).toContain('Keep this scheduled note text-only')
    expect(productUpdatesRecord?.instructions).toContain(
      'The outbound note must be link-free',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'no more than 28 words after the bullet marker',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'preserve required prerequisites, availability limits, and approval or confirmation boundaries',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'Open every outbound note with one sentence of no more than 20 words before the first bullet',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      "In Murph's first-person voice",
    )
    expect(productUpdatesRecord?.instructions).not.toContain(
      'If the ledger page was missing before this run',
    )
    expect(productUpdatesRecord?.instructions).toContain(
      'Close with one invitation sentence of no more than 12 words',
    )
    expect(productUpdatesRecord?.instructions).not.toContain(
      'canonical title, summary, URL, and tryIt fields',
    )
    expect(productUpdatesRecord?.instructions).not.toContain('Choose 3-7 items')
    expect(productUpdatesRecord?.instructions).not.toContain('murph.attach_response_media')
    expect(productUpdatesRecord?.instructions).not.toContain('visual digest')
    expect(productUpdatesRecord?.instructions).not.toContain('links.digestCardTemplate')
    expect(productUpdatesRecord?.instructions).toContain('murph.submit_product_feedback')
    expect(productUpdatesRecord?.instructions).toContain('clear inferred workflow friction')
    expect(productUpdatesRecord?.instructions).toContain('interest in shipped changelog or catalog items')
    expect(productUpdatesRecord?.instructions).toContain('Speculative:')
    expect(productUpdatesRecord?.instructions).toContain('Murph-observed:')
    expect(productUpdatesRecord?.instructions).toContain('Do not log vague low-confidence guesses')
    expect(productUpdatesRecord?.instructions).toContain('concise product-only summary')
    expect(productUpdatesRecord?.instructions).toContain('tags, topics, raw user wording')
    expect(productUpdatesRecord?.instructions).not.toContain('kind/topic')
    expect(productUpdatesRecord?.instructions).toContain(
      '{"kind":"skip","privateSummary":"No product note cleared the send bar."}',
    )
    expect(productUpdatesRecord?.instructions).not.toContain('finish_without_reply')
    await expect(showAutomation({
      automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
  })

  it('does not promote legacy managed routes when the current runtime route is a group', async () => {
    const vaultRoot = await createVaultRoot()
    const legacyGroupRoute = {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'legacy-group-chat',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    const digestSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    const insightSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    if (!digestSeed || !insightSeed) {
      throw new Error('Expected the managed legacy route anchor seeds.')
    }

    await applyMurphManagedAutomations({
      defaultRoute: legacyGroupRoute,
      now: new Date('2026-07-10T12:00:00.000Z'),
      seeds: [digestSeed, insightSeed],
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute: {
        ...legacyGroupRoute,
        threadIsDirect: false,
      },
      now: new Date('2026-07-10T12:05:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({ updated: 0 })

    for (const automationId of [
      MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    ]) {
      const record = await showAutomation({ automationId, vaultRoot })
      expect(record?.route).toMatchObject(legacyGroupRoute)
      expect(record?.route).not.toHaveProperty('threadIsDirect')
    }
  })

  it('does not treat one explicitly retargeted managed route as legacy personal home proof', async () => {
    const vaultRoot = await createVaultRoot()
    const originalRoute = {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'original-home-chat',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    const retargetedRoute = {
      ...originalRoute,
      deliveryTarget: 'user-selected-chat',
    }
    const digestSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    if (!digestSeed) {
      throw new Error('Expected the managed weekly health digest seed.')
    }

    await applyMurphManagedAutomations({
      defaultRoute: originalRoute,
      now: new Date('2026-07-10T12:00:00.000Z'),
      seeds: [digestSeed],
      vaultRoot,
    })
    await patchAutomation({
      lookup: digestSeed.automationId,
      now: new Date('2026-07-10T12:01:00.000Z'),
      route: retargetedRoute,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute: {
        ...originalRoute,
        deliveryTarget: 'current-home-chat',
        threadIsDirect: true,
      },
      now: new Date('2026-07-10T12:05:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({ updated: 0 })

    await expect(showAutomation({
      automationId: digestSeed.automationId,
      vaultRoot,
    })).resolves.toMatchObject({ route: retargetedRoute })
  })

  it('does not count an archived managed route toward the two-anchor personal home proof', async () => {
    const vaultRoot = await createVaultRoot()
    const liveLegacyRoute = {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'live-legacy-chat',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    const archivedLegacyRoute = {
      ...liveLegacyRoute,
      deliveryTarget: 'archived-legacy-chat',
    }
    const digestSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    const insightSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    if (!digestSeed || !insightSeed) {
      throw new Error('Expected the managed legacy route anchor seeds.')
    }

    await applyMurphManagedAutomations({
      defaultRoute: liveLegacyRoute,
      now: new Date('2026-07-10T12:00:00.000Z'),
      seeds: [digestSeed],
      vaultRoot,
    })
    await applyMurphManagedAutomations({
      defaultRoute: archivedLegacyRoute,
      now: new Date('2026-07-10T12:00:00.000Z'),
      seeds: [insightSeed],
      vaultRoot,
    })
    await patchAutomation({
      lookup: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      now: new Date('2026-07-10T12:01:00.000Z'),
      status: 'archived',
      vaultRoot,
    })
    for (const [automationId, slug, route] of [
      [
        'automation_01KZ0000000000000000000020',
        'live-target-user-reminder',
        liveLegacyRoute,
      ],
      [
        'automation_01KZ0000000000000000000021',
        'archived-target-user-reminder',
        archivedLegacyRoute,
      ],
    ] as const) {
      await upsertAutomation({
        automationId,
        continuityPolicy: 'fresh',
        instructions: 'Send the saved reminder.',
        now: new Date('2026-07-10T12:00:00.000Z'),
        route,
        schedule: { kind: 'dailyLocal', localTime: '09:00' },
        slug,
        status: 'active',
        summary: null,
        tags: ['assistant', 'scheduled'],
        title: slug,
        vaultRoot,
      })
    }

    await applyMurphManagedAutomations({
      defaultRoute: {
        ...liveLegacyRoute,
        deliveryTarget: 'current-home-chat',
        threadIsDirect: true,
      },
      now: new Date('2026-07-10T12:05:00.000Z'),
      vaultRoot,
    })

    for (const automationId of [
      MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      'automation_01KZ0000000000000000000020',
    ]) {
      const record = await showAutomation({ automationId, vaultRoot })
      expect(record?.route).toMatchObject(liveLegacyRoute)
      expect(record?.route).not.toHaveProperty('threadIsDirect')
    }
    for (const automationId of [
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      'automation_01KZ0000000000000000000021',
    ]) {
      const record = await showAutomation({ automationId, vaultRoot })
      expect(record?.route).toMatchObject(archivedLegacyRoute)
      expect(record?.route).not.toHaveProperty('threadIsDirect')
    }
    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({ status: 'archived' })
  })

  it('does not treat two bare managed records as personal-route authority', async () => {
    const vaultRoot = await createVaultRoot()
    const legacyHomeRoute = {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'legacy-home-chat',
      identityId: null,
      participantId: null,
      threadId: null,
    }
    const digestSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    const insightSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    if (!digestSeed || !insightSeed) {
      throw new Error('Expected the managed legacy route anchor seeds.')
    }

    await applyMurphManagedAutomations({
      defaultRoute: legacyHomeRoute,
      now: new Date('2026-07-10T12:00:00.000Z'),
      seeds: [digestSeed, insightSeed],
      vaultRoot,
    })
    await upsertAutomation({
      automationId: 'automation_01KZ0000000000000000000030',
      continuityPolicy: 'fresh',
      instructions: 'Send the saved reminder.',
      now: new Date('2026-07-10T12:01:00.000Z'),
      route: {
        ...legacyHomeRoute,
        threadIsDirect: true,
      },
      schedule: { kind: 'dailyLocal', localTime: '09:00' },
      slug: 'user-migrated',
      status: 'active',
      summary: null,
      tags: ['assistant', 'scheduled'],
      title: 'user-migrated',
      vaultRoot,
    })

    const currentHomeRoute = {
      ...legacyHomeRoute,
      deliveryTarget: 'current-home-chat',
      threadIsDirect: true,
    }
    await expect(applyMurphManagedAutomations({
      defaultRoute: currentHomeRoute,
      now: new Date('2026-07-10T12:05:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      route: {
        deliveryTarget: 'legacy-home-chat',
      },
    })
    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      route: {
        deliveryTarget: 'legacy-home-chat',
      },
    })
    await expect(applyMurphManagedAutomations({
      defaultRoute: currentHomeRoute,
      now: new Date('2026-07-10T12:10:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({
      created: 0,
      updated: 0,
    })
  })

  it('creates only group room-model maintenance for a hosted group route', async () => {
    const vaultRoot = await createVaultRoot()
    const groupRoute = {
      ...defaultRoute,
      deliveryTarget: 'telegram-group-thread',
      threadId: 'telegram-group-thread',
      threadIsDirect: false,
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute: groupRoute,
      now: new Date('2026-07-25T12:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
        EXA_API_KEY: 'fixture-exa-key',
      },
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
      route: groupRoute,
      schedule: {
        kind: 'cron',
        expression: '0 4 * * 2,5',
      },
      slug: 'group-room-model-consolidation',
      status: 'active',
    })
    await expect(showAutomation({
      automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
  })

  it('archives a persisted Sunday superlatives record during normal reconciliation', async () => {
    const vaultRoot = await createVaultRoot()
    const retiredAutomationId = 'automation_01K55N7S9X4Q2M6P8R3T0V1WYZ'
    const groupRoute = {
      ...defaultRoute,
      deliveryTarget: 'telegram-group-thread',
      threadId: 'telegram-group-thread',
      threadIsDirect: false,
    }
    await upsertAutomation({
      automationId: retiredAutomationId,
      continuityPolicy: 'fresh',
      instructions: 'Legacy group recap instructions.',
      route: groupRoute,
      schedule: { kind: 'cron', expression: '0 18 * * 0' },
      slug: 'group-sunday-superlatives',
      status: 'paused',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Sunday group superlatives',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute: groupRoute,
      now: new Date('2026-07-26T14:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
      },
      vaultRoot,
    })).resolves.toMatchObject({
      created: 1,
      updated: 1,
    })

    await expect(showAutomation({
      automationId: retiredAutomationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: retiredAutomationId,
      status: 'archived',
    })
  })

  it('creates hosted overnight memory consolidation through the canonical automation registry', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      runtimeEnv: {
        [HOSTED_RUNTIME_PROCESS_ENV]: '1',
        EXA_API_KEY: 'fixture-exa-key',
      },
      vaultRoot,
    })).resolves.toEqual({
      created: 6,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      assistantTargetOverride: {
        reasoningEffort: 'medium',
      },
      continuityPolicy: 'fresh',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 3 * * 1,3,5',
      },
      slug: 'overnight-memory-consolidation',
      status: 'active',
      tags: expect.arrayContaining([
        'murph-managed:overnight-memory-consolidation',
        'runtime-maintenance',
      ]),
      title: 'Overnight memory consolidation',
    })
    const automation = await showAutomation({
      automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
      vaultRoot,
    })
    if (automation === null) {
      throw new Error('Expected overnight memory consolidation automation')
    }
    expect(automation.instructions).toContain(
      'engine-supplied "Conversation evidence" section',
    )
    expect(automation.instructions).toContain(
      'bounded committed user and assistant conversation messages from the last 7 days',
    )
    expect(automation.instructions).toContain('supplied conversation evidence')
    expect(automation.instructions).toContain(
      '`murph.member_memory` with `action="show"`',
    )
    expect(automation.instructions).toContain(
      'Do not use the shell or read transcript files, session storage',
    )
    expect(automation.instructions).toContain('Do not save assistant speculation')
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
      created: 5,
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
      created: 5,
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
      skipped: 5,
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
      skipped: 5,
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
      created: 5,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      slug: 'finish-onboarding-followup',
      vaultRoot,
    })).resolves.toBeNull()
  })

  it.each(['active', 'paused'] as const)(
    'bounds the historical recurring %s onboarding follow-up without changing route or status',
    async (status) => {
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
        continuityPolicy: historicalRecurringOnboardingFollowupDefinition.continuityPolicy,
        instructions: historicalRecurringOnboardingFollowupDefinition.instructions,
        now: new Date('2026-06-23T12:00:00.000Z'),
        route: existingRoute,
        schedule: {
          kind: 'dailyLocal',
          localTime: '13:30',
        },
        slug: 'finish-onboarding-followup',
        status,
        summary: historicalRecurringOnboardingFollowupDefinition.summary,
        tags: [...historicalRecurringOnboardingFollowupDefinition.tags],
        title: historicalRecurringOnboardingFollowupDefinition.title,
        vaultRoot,
      })

      await expect(applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-06-23T13:00:00.000Z'),
        vaultRoot,
      })).resolves.toEqual({
        created: 5,
        skipped: 0,
        updated: 1,
      })

      await expect(showAutomation({
        automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC',
        vaultRoot,
      })).resolves.toMatchObject({
        activeUntil: '2026-06-26T15:00:00.000Z',
        automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC',
        continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        route: existingRoute,
        schedule: {
          localTime: expect.stringMatching(
            /^(?:13:[3-5]\d|14:[0-2]\d)$/u,
          ),
          kind: 'dailyLocal',
        },
        slug: 'finish-onboarding-followup',
        status,
        summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
        tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
        title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      })
    },
  )

  it('expands PR 1203\'s exact one-shot fingerprint into the same anchored three-day window', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FG'
    const diagnostics: MurphOnboardingFollowupDiagnostic[] = []

    await upsertAutomation({
      activeUntil: '2026-06-24T15:00:00.000Z',
      automationId,
      continuityPolicy:
        immediatePreviousOneshotOnboardingFollowupDefinition.continuityPolicy,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-24T14:00:00.000Z',
        kind: 'at',
      },
      slug: immediatePreviousOneshotOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: immediatePreviousOneshotOnboardingFollowupDefinition.summary,
      tags: [...immediatePreviousOneshotOnboardingFollowupDefinition.tags],
      title: immediatePreviousOneshotOnboardingFollowupDefinition.title,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      onOnboardingFollowupDiagnostic(diagnostic) {
        diagnostics.push(diagnostic)
      },
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })
    await expect(showAutomation({ automationId, vaultRoot })).resolves.toMatchObject({
      activeUntil: '2026-06-26T15:00:00.000Z',
      schedule: {
        kind: 'dailyLocal',
      },
      status: 'active',
    })
    expect(diagnostics).toEqual([
      expect.objectContaining({
        action: 'migrated_three_day_window',
        activeUntil: '2026-06-26T15:00:00.000Z',
        firstOccurrenceAt: '2026-06-24T14:00:00.000Z',
        onboardingStateSource: 'default_missing',
        onboardingStateStatus: 'open',
        opportunityDays: 3,
        previousScheduleKind: 'at',
        scheduleKind: 'dailyLocal',
      }),
    ])
  })

  it('preserves the signup schedule minute and pending first occurrence without a redundant reconciliation write', async () => {
    const vaultRoot = await createVaultRoot()
    const vault = await loadVault({ vaultRoot })
    const vaultStableKey = vault.metadata.vaultId ?? 'vault-fallback'
    const vaultSchedule = resolveMurphOnboardingFollowupSchedule(vaultStableKey)
    let memberStableKey = 'synthetic-member-schedule-0'
    let memberSchedule = resolveMurphOnboardingFollowupSchedule(memberStableKey)
    for (
      let suffix = 1;
      memberSchedule.localTime === vaultSchedule.localTime;
      suffix += 1
    ) {
      memberStableKey = `synthetic-member-schedule-${suffix}`
      memberSchedule = resolveMurphOnboardingFollowupSchedule(memberStableKey)
    }

    const seeded = await upsertAssistantCronAutomation({
      firstOccurrenceActiveDayCount:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.opportunityDays,
      firstOccurrenceActiveUntilLocalTime:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.activeUntilLocalTime,
      firstOccurrencePolicy: 'after-current-local-day',
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: memberSchedule,
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vault: vaultRoot,
    })
    if (!seeded) {
      throw new Error('Expected the signup follow-up to be seeded.')
    }
    const firstOccurrenceAt = seeded.state.nextRunAt
    expect(firstOccurrenceAt).not.toBeNull()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: seeded.jobId,
      vaultRoot,
    })).resolves.toMatchObject({
      schedule: memberSchedule,
    })
    const runtimeStore = await assistantCronRuntimeState
      .readAssistantCronCanonicalRuntimeStore(resolveAssistantStatePaths(vaultRoot))
    expect(
      assistantCronRuntimeState.findAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        seeded.jobId,
      )?.state.pendingOccurrenceAt,
    ).toBe(firstOccurrenceAt)
  })

  it('archives an expired exact PR 1203 one-shot instead of restarting its window', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FK'
    await upsertAutomation({
      activeUntil: '2026-06-02T15:00:00.000Z',
      automationId,
      continuityPolicy:
        immediatePreviousOneshotOnboardingFollowupDefinition.continuityPolicy,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-01T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-02T14:00:00.000Z',
        kind: 'at',
      },
      slug: immediatePreviousOneshotOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: immediatePreviousOneshotOnboardingFollowupDefinition.summary,
      tags: [...immediatePreviousOneshotOnboardingFollowupDefinition.tags],
      title: immediatePreviousOneshotOnboardingFollowupDefinition.title,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({ updated: 1 })
    await expect(showAutomation({ automationId, vaultRoot })).resolves.toMatchObject({
      status: 'archived',
    })
  })

  it('recovers a partially staged PR 1203 migration through normal managed reconciliation', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FJ'

    await upsertAutomation({
      activeUntil: '2026-06-24T15:00:00.000Z',
      automationId,
      continuityPolicy:
        immediatePreviousOneshotOnboardingFollowupDefinition.continuityPolicy,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-24T14:00:00.000Z',
        kind: 'at',
      },
      slug: immediatePreviousOneshotOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: immediatePreviousOneshotOnboardingFollowupDefinition.summary,
      tags: [...immediatePreviousOneshotOnboardingFollowupDefinition.tags],
      title: immediatePreviousOneshotOnboardingFollowupDefinition.title,
      vaultRoot,
    })

    const writeSpy = vi.spyOn(
      assistantCronRuntimeState,
      'writeAssistantCronCanonicalRuntimeStore',
    )
    try {
      writeSpy.mockRejectedValueOnce(new Error('state store unavailable'))
      await expect(applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-06-23T13:00:00.000Z'),
        vaultRoot,
      })).rejects.toThrow('state store unavailable')
    } finally {
      writeSpy.mockRestore()
    }

    await expect(showAutomation({ automationId, vaultRoot })).resolves.toMatchObject({
      activeUntil: '2026-06-26T15:00:00.000Z',
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      schedule: {
        at: '2026-06-24T14:00:00.000Z',
        kind: 'at',
      },
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:05:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({ updated: 1 })

    await expect(showAutomation({ automationId, vaultRoot })).resolves.toMatchObject({
      activeUntil: '2026-06-26T15:00:00.000Z',
      schedule: { kind: 'dailyLocal' },
    })
    const runtimeStore = await assistantCronRuntimeState
      .readAssistantCronCanonicalRuntimeStore(resolveAssistantStatePaths(vaultRoot))
    expect(
      assistantCronRuntimeState.findAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        automationId,
      )?.state.pendingOccurrenceAt,
    ).toBe('2026-06-24T14:00:00.000Z')
  })

  it('archives an established predecessor after its original three-day window', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FH'
    const diagnostics: MurphOnboardingFollowupDiagnostic[] = []

    await upsertAutomation({
      automationId,
      continuityPolicy: historicalRecurringOnboardingFollowupDefinition.continuityPolicy,
      instructions: historicalRecurringOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-01T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: historicalRecurringOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: historicalRecurringOnboardingFollowupDefinition.summary,
      tags: [...historicalRecurringOnboardingFollowupDefinition.tags],
      title: historicalRecurringOnboardingFollowupDefinition.title,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      onOnboardingFollowupDiagnostic(diagnostic) {
        diagnostics.push(diagnostic)
      },
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })
    await expect(showAutomation({ automationId, vaultRoot })).resolves.toMatchObject({
      status: 'archived',
    })
    expect(diagnostics).toEqual([
      expect.objectContaining({
        action: 'archived_window_elapsed',
        activeUntil: '2026-06-04T15:00:00.000Z',
        onboardingStateSource: 'default_missing',
        onboardingStateStatus: 'open',
        opportunityDays: 3,
        previousScheduleKind: 'dailyLocal',
        scheduleKind: 'dailyLocal',
      }),
    ])
  })

  it('restores the finite shape after a PR 1203 writer overwrites it', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FD'

    await upsertAutomation({
      activeUntil: '2026-06-26T15:00:00.000Z',
      automationId,
      continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '14:00',
      },
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: 'active',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vaultRoot,
    })
    await upsertAutomation({
      activeUntil: '2026-06-24T15:00:00.000Z',
      automationId,
      continuityPolicy:
        immediatePreviousOneshotOnboardingFollowupDefinition.continuityPolicy,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-23T12:30:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-24T14:00:00.000Z',
        kind: 'at',
      },
      slug: immediatePreviousOneshotOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: immediatePreviousOneshotOnboardingFollowupDefinition.summary,
      tags: [...immediatePreviousOneshotOnboardingFollowupDefinition.tags],
      title: immediatePreviousOneshotOnboardingFollowupDefinition.title,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })
    await expect(showAutomation({
      automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      activeUntil: '2026-06-26T15:00:00.000Z',
      automationId,
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      schedule: {
        localTime: '14:00',
        kind: 'dailyLocal',
      },
      status: 'active',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    })
  })

  it('does not migrate an edited PR 1203 one-shot fingerprint', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FE'

    await upsertAutomation({
      automationId,
      continuityPolicy:
        immediatePreviousOneshotOnboardingFollowupDefinition.continuityPolicy,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-24T14:00:00.000Z',
        kind: 'at',
      },
      slug: immediatePreviousOneshotOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: immediatePreviousOneshotOnboardingFollowupDefinition.summary,
      tags: [...immediatePreviousOneshotOnboardingFollowupDefinition.tags],
      title: `${immediatePreviousOneshotOnboardingFollowupDefinition.title} edited`,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    await expect(showAutomation({
      automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      activeUntil: null,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      schedule: {
        at: '2026-06-24T14:00:00.000Z',
        kind: 'at',
      },
      title: `${immediatePreviousOneshotOnboardingFollowupDefinition.title} edited`,
    })
  })

  it('does not migrate a historical recurring predecessor with a user-edited schedule', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FF'

    await upsertAutomation({
      automationId,
      continuityPolicy: historicalRecurringOnboardingFollowupDefinition.continuityPolicy,
      instructions: historicalRecurringOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: historicalRecurringOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: historicalRecurringOnboardingFollowupDefinition.summary,
      tags: [...historicalRecurringOnboardingFollowupDefinition.tags],
      title: historicalRecurringOnboardingFollowupDefinition.title,
      vaultRoot,
    })
    await patchAutomation({
      lookup: automationId,
      now: new Date('2026-06-23T12:30:00.000Z'),
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    await expect(showAutomation({
      automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      activeUntil: null,
      instructions: historicalRecurringOnboardingFollowupDefinition.instructions,
      schedule: {
        kind: 'dailyLocal',
        localTime: '08:00',
      },
      title: historicalRecurringOnboardingFollowupDefinition.title,
    })
  })

  it('archives the managed onboarding follow-up after onboarding completes', async () => {
    const vaultRoot = await createVaultRoot()
    await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FB',
      continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.schedule,
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: 'active',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vaultRoot,
    })
    await completeAssistantOnboarding({
      completedAt: '2026-06-23T12:30:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 6,
      skipped: 0,
      updated: 1,
    })
    await expect(showAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FB',
      vaultRoot,
    })).resolves.toMatchObject({
      status: 'archived',
    })
  })

  it('archives the PR 1203 predecessor after onboarding completes', async () => {
    const vaultRoot = await createVaultRoot()
    const automationId = 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC'
    await upsertAutomation({
      automationId,
      continuityPolicy:
        immediatePreviousOneshotOnboardingFollowupDefinition.continuityPolicy,
      instructions: immediatePreviousOneshotOnboardingFollowupDefinition.instructions,
      now: new Date('2026-06-23T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-24T13:30:00.000Z',
        kind: 'at',
      },
      slug: immediatePreviousOneshotOnboardingFollowupDefinition.slug,
      status: 'active',
      summary: immediatePreviousOneshotOnboardingFollowupDefinition.summary,
      tags: [...immediatePreviousOneshotOnboardingFollowupDefinition.tags],
      title: immediatePreviousOneshotOnboardingFollowupDefinition.title,
      vaultRoot,
    })
    await completeAssistantOnboarding({
      completedAt: '2026-06-23T12:30:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-23T13:00:00.000Z'),
      vaultRoot,
    })

    await expect(showAutomation({ automationId, vaultRoot })).resolves.toMatchObject({
      status: 'archived',
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
      created: 5,
      skipped: 0,
      updated: 1,
    })

    await expect(showAutomation({
      automationId: 'automation_01KCM5T5J4VB7D63T0Y29Q6R7A',
      vaultRoot,
    })).resolves.toMatchObject({
      activeUntil: '2026-06-26T15:00:00.000Z',
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

  it.each(onboardingFollowupPredecessorDefinitions)(
    'leaves the exact $label predecessor unchanged when onboarding authority is unreadable',
    async ({ definition, schedule }) => {
      const vaultRoot = await createVaultRoot()
      const created = await upsertAutomation({
        continuityPolicy: definition.continuityPolicy,
        instructions: definition.instructions,
        now: new Date('2026-04-08T15:00:00.000Z'),
        route: defaultRoute,
        schedule,
        slug: definition.slug,
        status: 'active',
        summary: definition.summary,
        tags: [...definition.tags],
        title: definition.title,
        vaultRoot,
      })
      const onboardingStatePath = resolveAssistantOnboardingStatePath(vaultRoot)
      await mkdir(dirname(onboardingStatePath), { recursive: true })
      await writeFile(onboardingStatePath, '{ invalid onboarding json', 'utf8')

      await expect(applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-04-09T18:29:05.000Z'),
        vaultRoot,
      })).rejects.toMatchObject({
        reason: 'invalid-json',
      })

      await expect(showAutomation({
        automationId: created.record.automationId,
        vaultRoot,
      })).resolves.toMatchObject({
        instructions: definition.instructions,
        schedule,
        status: 'active',
        updatedAt: created.record.updatedAt,
      })

      await rm(onboardingStatePath)
      await applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-04-09T18:29:05.000Z'),
        vaultRoot,
      })

      await expect(showAutomation({
        automationId: created.record.automationId,
        vaultRoot,
      })).resolves.toMatchObject({
        activeUntil: expect.any(String),
        continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        schedule: expect.objectContaining({
          kind: 'dailyLocal',
        }),
        status: 'active',
        summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
        tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
        title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      })
    },
  )

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
      created: 4,
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

  it('migrates an existing weekly product note to the two-week cadence', async () => {
    const vaultRoot = await createVaultRoot()

    await upsertAutomation({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Send the old weekly product update.',
      now: new Date('2026-06-09T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '30 12 * * 5',
      },
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'Old weekly product updates.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly product updates',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })

    const productNotesRecord = await showAutomation({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      vaultRoot,
    })

    expect(productNotesRecord).toMatchObject({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      route: defaultRoute,
      slug: 'weekly-product-updates',
      status: 'active',
      summary: 'A biweekly personalized note alternating what is new in Murph with things Murph can do for you.',
      title: 'Murph product notes',
    })
    expectEveryTwoWeeksSchedule(productNotesRecord?.schedule)
    expect(productNotesRecord?.instructions).toContain('Goal: every two weeks')
    expect(productNotesRecord?.instructions).toContain(
      '/api/changelog?days=14&featureLimit=70&improvementLimit=10',
    )
    expect(productNotesRecord?.instructions).toContain(
      'last recorded changelog means feature discovery now',
    )
    expect(productNotesRecord?.instructions).toContain(
      'last recorded feature discovery means changelog now',
    )
  })

  it('reconciles the product-note introduction for an otherwise-current installed record', async () => {
    const vaultRoot = await createVaultRoot()
    const productNotesSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    )
    if (!productNotesSeed) {
      throw new Error('Expected the managed product-notes seed.')
    }

    const currentIntroduction =
      '- Open every outbound note with one sentence of no more than 20 words before the first bullet. In Murph\'s first-person voice, explain that these occasional updates cover what is new or useful so the user can make use of it.'
    const previousIntroduction =
      '- If the ledger page was missing before this run, open with one sentence of no more than 10 words saying Murph occasionally shares what is new or useful.'
    const previousInstructions = productNotesSeed.instructions.replace(
      currentIntroduction,
      previousIntroduction,
    )
    expect(previousInstructions).not.toBe(productNotesSeed.instructions)

    await upsertAutomation({
      assistantTargetOverride: productNotesSeed.assistantTargetOverride,
      automationId: productNotesSeed.automationId,
      continuityPolicy: productNotesSeed.continuityPolicy,
      instructions: previousInstructions,
      now: new Date('2026-08-06T12:00:00.000Z'),
      route: defaultRoute,
      schedule: productNotesSeed.schedule,
      slug: productNotesSeed.slug,
      status: 'active',
      summary: productNotesSeed.summary,
      tags: [...productNotesSeed.tags],
      title: productNotesSeed.title,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-08-06T13:00:00.000Z'),
      seeds: [productNotesSeed],
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 0,
      updated: 1,
    })

    const productNotesRecord = await showAutomation({
      automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
      vaultRoot,
    })
    expect(productNotesRecord?.instructions).toContain(currentIntroduction)
    expect(productNotesRecord?.instructions).not.toContain(previousIntroduction)
  })

  it('migrates the deployed weekly improvement coach in place to monthly', async () => {
    const vaultRoot = await createVaultRoot()
    const existingRoute = {
      channel: 'telegram' as const,
      deliveryTarget: 'existing-improvement-thread',
      identityId: null,
      participantId: null,
      threadId: null,
    }

    await upsertAutomation({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      instructions: 'Run the deployed weekly improvement coach.',
      now: new Date('2026-06-09T12:00:00.000Z'),
      route: existingRoute,
      schedule: {
        kind: 'cron',
        expression: '0 17 * * 2',
      },
      slug: 'weekly-improvement-coach',
      status: 'active',
      summary: 'A weekly check for one clearly actionable health improvement worth working on.',
      tags: ['murph-managed:weekly-improvement-coach'],
      title: 'Weekly improvement coach',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 4,
      skipped: 0,
      updated: 1,
    })

    const migrated = await showAutomation({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      vaultRoot,
    })

    expect(migrated).toMatchObject({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      assistantTargetOverride: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      },
      route: existingRoute,
      schedule: {
        kind: 'cron',
        expression: '0 17 1 * *',
      },
      slug: 'weekly-improvement-coach',
      status: 'active',
      summary: 'A monthly check for one user-relevant health friction worth offering help with.',
      title: 'Monthly improvement coach',
    })
    expect(migrated?.tags).toContain('murph-managed:monthly-improvement-coach')
    expect(migrated?.tags).not.toContain('murph-managed:weekly-improvement-coach')
    expect(migrated?.instructions).toContain('On this scheduled monthly run')
    await expect(showAutomation({
      slug: 'weekly-improvement-coach',
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
      route: existingRoute,
    })
    await expect(showAutomation({
      slug: 'monthly-improvement-coach',
      vaultRoot,
    })).resolves.toBeNull()
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
      created: 4,
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
    const userImprovementCoachAutomation = await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FG',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user-owned improvement coach prompt.',
      now: new Date('2026-06-09T12:00:00.000Z'),
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
      skipped: 5,
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
      automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
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
      automationId: userImprovementCoachAutomation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: userImprovementCoachAutomation.record.automationId,
      instructions: 'Keep this user-owned improvement coach prompt.',
      slug: 'weekly-improvement-coach',
      tags: ['user'],
      title: 'My improvement coach',
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
