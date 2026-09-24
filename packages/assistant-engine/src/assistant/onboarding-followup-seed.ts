import { isVaultError, upsertAutomation } from '@murphai/core'
import type { AutomationRoute } from '@murphai/contracts'
import type { AssistantCronJob } from '@murphai/operator-config/assistant-cli-contracts'
import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  MURPH_ONBOARDING_EARLY_STALL_AUTOMATION,
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
import {
  buildCanonicalAutomationRoute,
  validateAssistantCronDeliveryTarget,
  type AssistantCronDeliveryRouteValidationProfile,
} from './cron/targets.js'

export type MurphOnboardingFollowupSeedResult =
  | { kind: 'not-applicable' }
  | { job: AssistantCronJob; kind: 'ready' }
  | { kind: 'preserved-closed' }
  | { kind: 'yielded' }

export async function seedMurphOnboardingFollowupAutomation(input: {
  activeUntil?: string
  firstOccurrenceAt?: string
  now?: Date
  route: AutomationRoute
  routeValidationProfile?: AssistantCronDeliveryRouteValidationProfile
  shouldYield?: (() => boolean) | null
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
    ...(input.routeValidationProfile === undefined
      ? {}
      : { routeValidationProfile: input.routeValidationProfile }),
    schedule: resolveMurphOnboardingFollowupSchedule(input.stableKey),
    shouldYield: input.shouldYield,
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
    routeValidationProfile?: AssistantCronDeliveryRouteValidationProfile
    shouldYield?: (() => boolean) | null
    stableKey: string
    vault: string
  },
): Promise<MurphOnboardingFollowupSeedResult> {
  if (input.shouldYield?.() === true) return { kind: 'yielded' }
  if (input.route.threadIsDirect !== true) {
    return { kind: 'not-applicable' }
  }
  const onboardingState = await readAssistantOnboardingState(input.vault)
  if (input.shouldYield?.() === true) return { kind: 'yielded' }
  if (onboardingState.createdAt === null) {
    return { kind: 'not-applicable' }
  }
  if (onboardingState.status !== 'open') {
    return { kind: 'preserved-closed' }
  }

  const now = input.now ?? new Date()
  const schedule = resolveMurphOnboardingFollowupSchedule(input.stableKey)
  const timeZone = await resolveAssistantCronDefaultTimeZone(input.vault)
  if (input.shouldYield?.() === true) return { kind: 'yielded' }
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
    ...(input.routeValidationProfile === undefined
      ? {}
      : { routeValidationProfile: input.routeValidationProfile }),
    shouldYield: input.shouldYield,
    stableKey: input.stableKey,
    vault: input.vault,
  })
  if (input.shouldYield?.() === true) return { kind: 'yielded' }
  return job === null
    ? { kind: 'preserved-closed' }
    : { job, kind: 'ready' }
}

/** Enroll once from durable onboarding start; retries never move the deadline. */
export async function seedMurphOnboardingEarlyStallAutomation(input: {
  now?: Date
  route: AutomationRoute
  routeValidationProfile?: AssistantCronDeliveryRouteValidationProfile
  shouldYield?: (() => boolean) | null
  vault: string
}): Promise<'created' | 'skipped' | 'yielded'> {
  if (input.shouldYield?.() === true) return 'yielded'
  if (input.route.threadIsDirect !== true) return 'skipped'
  const state = await readAssistantOnboardingState(input.vault)
  if (input.shouldYield?.() === true) return 'yielded'
  if (state.createdAt === null) return 'skipped'
  if (state.status !== 'open') return 'skipped'
  const definition = MURPH_ONBOARDING_EARLY_STALL_AUTOMATION
  const now = input.now ?? new Date()
  const startedAt = Date.parse(state.createdAt)
  const dueAt = startedAt + definition.delayMs
  const expiresAt = startedAt + definition.windowMs
  // Do not backfill old accounts or turn a delayed maintenance pass into a
  // fresh timer. Existing one-shots remain owned by the cron/outbox lifecycle.
  if (now.getTime() < startedAt || now.getTime() >= dueAt) {
    return 'skipped'
  }
  const route = buildCanonicalAutomationRoute(validateAssistantCronDeliveryTarget(
    input.route, input.routeValidationProfile ?? 'local',
  ))
  if (input.shouldYield?.() === true) return 'yielded'
  // The registry's create-only lock preserves paused, archived, and legacy
  // sources even if another writer wins between eligibility and persistence.
  try {
    await upsertAutomation({
      createOnly: true,
      continuityPolicy: 'fresh',
      status: 'active',
      activeUntil: new Date(expiresAt).toISOString(),
      instructions: definition.instructions,
      now,
      route,
      schedule: { kind: 'at', at: new Date(dueAt).toISOString() },
      slug: definition.slug,
      summary: definition.summary,
      tags: [...definition.tags],
      title: definition.title,
      vaultRoot: input.vault,
    })
  } catch (error) {
    if (isVaultError(error) && error.code === 'VAULT_AUTOMATION_CONFLICT') return 'skipped'
    throw error
  }
  if (input.shouldYield?.() === true) return 'yielded'
  return 'created'
}
