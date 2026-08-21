import type { AutomationRoute } from '@murphai/contracts'
import type {
  AssistantCronJob,
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  readAssistantTelegramOnboardingFollowupFirstContactAnchor,
} from './first-contact.js'
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
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { normalizeNullableString } from './shared.js'

export type MurphTelegramOnboardingFollowupSeedResult =
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

export async function seedMurphOnboardingFollowupAfterTelegramFirstContact(
  input: {
    now?: Date
    stableKey: string
    vault: string
  },
): Promise<MurphTelegramOnboardingFollowupSeedResult> {
  const anchor =
    await readAssistantTelegramOnboardingFollowupFirstContactAnchor(input.vault)
  if (anchor === null) {
    return { kind: 'not-applicable' }
  }

  const state = createAssistantRuntimeStateService(input.vault)
  const receipt = await state.turns.readReceipt(anchor.acceptedTurnId)
  if (
    receipt?.status !== 'completed' ||
    receipt.completedAt === null ||
    receipt.deliveryIntentId === null
  ) {
    return { kind: 'not-applicable' }
  }

  const intent = await state.outbox.readIntent(receipt.deliveryIntentId)
  const route = resolveAcceptedTelegramOnboardingFollowupRoute({
    acceptedTurnId: anchor.acceptedTurnId,
    intent,
  })
  if (route === null) {
    return { kind: 'not-applicable' }
  }

  const onboardingState = await readAssistantOnboardingState(input.vault)
  if (onboardingState.status !== 'open') {
    return { kind: 'preserved-closed' }
  }

  const now = input.now ?? new Date()
  const schedule = resolveMurphOnboardingFollowupSchedule(input.stableKey)
  const timeZone = await resolveAssistantCronDefaultTimeZone(input.vault)
  const originalFirstOccurrenceAt =
    computeAssistantCronFirstRunAfterCurrentLocalDay({
      after: new Date(receipt.completedAt),
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
    route,
    stableKey: input.stableKey,
    vault: input.vault,
  })
  return job === null
    ? { kind: 'preserved-closed' }
    : { job, kind: 'ready' }
}

function resolveAcceptedTelegramOnboardingFollowupRoute(input: {
  acceptedTurnId: string
  intent: AssistantOutboxIntent | null
}): AutomationRoute | null {
  if (
    input.intent?.turnId !== input.acceptedTurnId ||
    input.intent.status !== 'sent' ||
    normalizeNullableString(input.intent.channel)?.toLowerCase() !== 'telegram' ||
    normalizeNullableString(input.intent.delivery?.channel)?.toLowerCase() !==
      'telegram' ||
    input.intent.delivery?.targetKind !== 'thread' ||
    input.intent.threadIsDirect !== true
  ) {
    return null
  }

  const deliveryTarget = normalizeNullableString(input.intent.delivery.target)
  if (deliveryTarget === null) {
    return null
  }

  return {
    channel: 'telegram',
    deliveryTarget,
    identityId: normalizeNullableString(input.intent.identityId),
    participantId: normalizeNullableString(input.intent.actorId),
    threadId: normalizeNullableString(input.intent.threadId),
    threadIsDirect: true,
  }
}
