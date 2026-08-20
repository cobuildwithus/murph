import type { AutomationRoute } from '@murphai/contracts'
import type { AssistantCronJob } from '@murphai/operator-config/assistant-cli-contracts'

import {
  hasAssistantSeenFirstContact,
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphOnboardingFollowupSchedule,
} from './onboarding-followup-automation.js'
import { readAssistantOnboardingState } from './onboarding-state.js'
import { upsertAssistantCronAutomation } from './cron/authoring.js'

export type MurphTelegramOnboardingFollowupSeedResult =
  | { kind: 'not-applicable' }
  | { job: AssistantCronJob; kind: 'ready' }
  | { kind: 'preserved-closed' }

export async function seedMurphOnboardingFollowupAutomation(input: {
  route: AutomationRoute
  stableKey: string
  vault: string
}): Promise<AssistantCronJob | null> {
  return await upsertAssistantCronAutomation({
    firstOccurrenceActiveDayCount:
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.opportunityDays,
    firstOccurrenceActiveUntilLocalTime:
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.activeUntilLocalTime,
    firstOccurrencePolicy: 'after-current-local-day',
    instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
    route: input.route,
    schedule: resolveMurphOnboardingFollowupSchedule(input.stableKey),
    slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
    tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
    title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    vault: input.vault,
  })
}

export async function seedMurphOnboardingFollowupAfterTelegramFirstContact(
  input: {
    route: AutomationRoute
    stableKey: string
    vault: string
  },
): Promise<MurphTelegramOnboardingFollowupSeedResult> {
  if (
    input.route.channel !== 'telegram' ||
    input.route.threadIsDirect !== true
  ) {
    return { kind: 'not-applicable' }
  }

  const firstContactStateDocIds = resolveAssistantFirstContactStateDocIds({
    channel: input.route.channel,
    identityId: input.route.identityId,
    threadId: input.route.threadId,
    threadIsDirect: input.route.threadIsDirect,
  })
  if (
    firstContactStateDocIds.length === 0 ||
    !await hasAssistantSeenFirstContact({
      docIds: firstContactStateDocIds,
      vault: input.vault,
    })
  ) {
    return { kind: 'not-applicable' }
  }

  const onboardingState = await readAssistantOnboardingState(input.vault)
  if (onboardingState.status !== 'open') {
    return { kind: 'preserved-closed' }
  }

  const job = await seedMurphOnboardingFollowupAutomation({
    route: input.route,
    stableKey: input.stableKey,
    vault: input.vault,
  })
  return job === null
    ? { kind: 'preserved-closed' }
    : { job, kind: 'ready' }
}
