import type { AutomationRoute } from '@murphai/contracts'
import type { AssistantCronJob } from '@murphai/operator-config/assistant-cli-contracts'

import type { AssistantConversationAudience } from './conversation-policy.js'
import type { AssistantExecutionContext } from './execution-context.js'
import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphOnboardingFollowupSchedule,
} from './onboarding-followup-automation.js'
import { upsertAssistantCronAutomation } from './cron/authoring.js'
import { resolveDeliverableAutomationRoute } from './cron/targets.js'
import { normalizeNullableString } from './shared.js'

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

export async function seedMurphOnboardingFollowupAfterAcceptedTelegramReply(
  input: {
    audience: AssistantConversationAudience
    executionContext?: AssistantExecutionContext | null
    vault: string
  },
): Promise<MurphTelegramOnboardingFollowupSeedResult> {
  const memberId = normalizeNullableString(
    input.executionContext?.hosted?.memberId,
  )
  if (
    input.audience.channel !== 'telegram' ||
    input.audience.effectiveThreadIsDirect !== true ||
    memberId === null
  ) {
    return { kind: 'not-applicable' }
  }

  const route = resolveDeliverableAutomationRoute(
    {
      channel: 'telegram',
      deliverySource: null,
      deliveryTarget: null,
      identityId: input.audience.identityId,
      participantId: null,
      threadId: input.audience.threadId,
      threadIsDirect: true,
    },
    'hosted',
  )
  if (route === null) {
    return { kind: 'not-applicable' }
  }

  const job = await seedMurphOnboardingFollowupAutomation({
    route,
    stableKey: memberId,
    vault: input.vault,
  })
  return job === null
    ? { kind: 'preserved-closed' }
    : { job, kind: 'ready' }
}
