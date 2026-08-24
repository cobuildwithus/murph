import type { AutomationRoute } from '@murphai/contracts'
import type { AssistantCronJob } from '@murphai/operator-config/assistant-cli-contracts'
import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphOnboardingFollowupActiveUntil,
  resolveMurphOnboardingFollowupSchedule,
} from './onboarding-followup-automation.js'
import { readAssistantOnboardingState } from './onboarding-state.js'
import { upsertAssistantCronAutomation } from './cron/authoring.js'
import { resolveAssistantCronDefaultTimeZone } from './cron/canonical-jobs.js'
import {
  computeAssistantCronFirstRunAfterCurrentLocalDay,
  computeAssistantCronNextRunAt,
} from './cron/schedule.js'

export type MurphOnboardingFollowupSeedResult =
  | { kind: 'not-applicable' }
  | { job: AssistantCronJob; kind: 'ready' }
  | { kind: 'preserved-closed' }

export async function seedMurphOnboardingFollowupAutomation(input: {
  activeUntil?: string
  firstOccurrenceAt?: string
  now?: Date
  route: AutomationRoute
  stableKey: string
  vault: string
}): Promise<AssistantCronJob | null> {
  return await upsertAssistantCronAutomation({
    firstOccurrenceActiveDayCount:
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.opportunityDays,
    firstOccurrenceActiveUntilLocalTime:
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.activeUntilLocalTime,
    ...(input.activeUntil === undefined
      ? {}
      : { activeUntil: input.activeUntil }),
    ...(input.firstOccurrenceAt === undefined
      ? {}
      : { firstOccurrenceAt: input.firstOccurrenceAt }),
    firstOccurrencePolicy: 'after-current-local-day',
    instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
    ...(input.now === undefined ? {} : { now: input.now }),
    route: input.route,
    schedule: resolveMurphOnboardingFollowupSchedule(input.stableKey),
    slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
    tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
    title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    vault: input.vault,
  })
}

export async function seedMurphOnboardingFollowupFromStartedOnboarding(
  input: {
    now?: Date
    route: AutomationRoute
    stableKey: string
    vault: string
  },
): Promise<MurphOnboardingFollowupSeedResult> {
  if (input.route.threadIsDirect !== true) {
    return { kind: 'not-applicable' }
  }
  const onboardingState = await readAssistantOnboardingState(input.vault)
  if (onboardingState.createdAt === null) {
    return { kind: 'not-applicable' }
  }
  if (onboardingState.status !== 'open') {
    return { kind: 'preserved-closed' }
  }

  const now = input.now ?? new Date()
  const schedule = resolveMurphOnboardingFollowupSchedule(input.stableKey)
  const timeZone = await resolveAssistantCronDefaultTimeZone(input.vault)
  const originalFirstOccurrenceAt =
    computeAssistantCronFirstRunAfterCurrentLocalDay({
      after: new Date(onboardingState.createdAt),
      schedule: { ...schedule, timeZone },
    })
  const activeUntil = resolveMurphOnboardingFollowupActiveUntil({
    scheduledAt: originalFirstOccurrenceAt,
    timeZone,
  })
  if (now.getTime() >= Date.parse(activeUntil)) {
    return { kind: 'preserved-closed' }
  }
  const firstOccurrenceAt =
    now.getTime() < Date.parse(originalFirstOccurrenceAt)
      ? originalFirstOccurrenceAt
      : computeAssistantCronNextRunAt(
          { ...schedule, timeZone },
          now,
        )
  if (
    firstOccurrenceAt === null ||
    Date.parse(firstOccurrenceAt) >= Date.parse(activeUntil)
  ) {
    return { kind: 'preserved-closed' }
  }

  const job = await seedMurphOnboardingFollowupAutomation({
    activeUntil,
    firstOccurrenceAt,
    now,
    route: input.route,
    stableKey: input.stableKey,
    vault: input.vault,
  })
  return job === null
    ? { kind: 'preserved-closed' }
    : { job, kind: 'ready' }
}
