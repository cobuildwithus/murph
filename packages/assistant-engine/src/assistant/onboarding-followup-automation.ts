import { createHash } from 'node:crypto'
import {
  formatTimeZoneDateTimeParts,
  parseDailyTime,
  type AutomationContinuityPolicy,
  type AutomationSchedule,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { computeAssistantCronNextRunAt } from './cron/schedule.js'

export type MurphOnboardingFollowupAutomationSchedule = Extract<
  AutomationSchedule,
  { kind: 'dailyLocal' }
>

export interface MurphOnboardingFollowupAutomationDefinition {
  activeUntilLocalTime: string
  continuityPolicy: AutomationContinuityPolicy
  instructions: string
  jitterMinutes: number
  schedule: MurphOnboardingFollowupAutomationSchedule
  slug: string
  summary: string
  tags: readonly string[]
  title: string
}

export const MURPH_ONBOARDING_FOLLOWUP_AUTOMATION =
  {
    slug: 'finish-onboarding-followup',
    title: 'Final Murph onboarding follow-up',
    summary: 'One finite next-day invitation to continue unfinished Murph onboarding.',
    continuityPolicy: 'preserve',
    schedule: {
      kind: 'dailyLocal',
      localTime: '13:30',
    },
    jitterMinutes: 60,
    activeUntilLocalTime: '15:00',
    tags: [
      'assistant',
      'scheduled',
      'murph-managed',
      'onboarding',
      'murph-managed:onboarding-followup',
    ],
    instructions: [
      'Goal: make one finite, low-pressure final attempt to reopen unfinished Murph onboarding and get a reply. This one-shot is consumed whether you send or skip. Never create, re-enable, or reschedule another onboarding follow-up; ordinary health help and reply-driven onboarding remain available after this run.',
      '',
      'Before deciding, read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md`, run `vault-cli assistant onboarding resume-context --format json`, and read the available recent user messages. The skill is the single owner of conversation order, checkpoint meaning, persistence, and completion; do not create a second state machine in this automation.',
      '',
      'Success criteria: onboarding is no longer open, or one brief, skill-compatible question gives the member an easy way to reply and continue.',
      '',
      'If `onboarding.status` is `completed`, return skip. The managed-automation owner archives this follow-up deterministically.',
      '',
      'For this scheduled occurrence only, do not run the onboarding completion command directly. If the onboarding skill says the visible and saved evidence satisfies answered completion or shows an overall decline, return skip with `onboardingAction: {"kind":"complete","reason":"user_answered"}` or `onboardingAction: {"kind":"complete","reason":"user_declined"}`. The notification boundary applies that action through the canonical onboarding owner and fails the run if completion does not commit.',
      '',
      'Otherwise use exactly the next unresolved step from the onboarding skill, including aspiration capture, explicit parking, foundation questions, contextual return, and its targeted-read rules for omitted, truncated, or errored evidence. If that step is only a reflection or parking transition, combine it with the next skill-approved question when the skill permits; otherwise return skip. Do not compress, reorder, or bypass that policy merely because this is a scheduled run.',
      '',
      'This automation never owns a promised check-in, reminder, or proactive support action. Those use the canonical plan and dedicated automation required by `behavior-followthrough`, which owns timing, due evaluation, delivery, retry, and skip behavior.',
      '',
      'Before sending, triple-check the snapshot and recent messages for an answer, skip, defer, decline, or a newer topic that should win. Follow the onboarding skill’s finite next-day recovery rule exactly. Do not re-ask known or resolved context, repeat an unanswered setup question, or rotate to another setup question. Honor requested timing and return skip after an explicit decline, a request not to follow up, or whenever the finite reopening question would not be timely or useful.',
      '',
      "Output: send at most one brief, natural, low-pressure in-chat continuation. It must contain exactly one easy, reply-oriented question; otherwise return skip. When onboarding is still open and a skip should leave it open, include `onboardingAction: {\"kind\":\"leave_open\"}`. Do not mention internal state, setup completion, final attempts, schedules, or this automation, and do not use a fixed script. The user's reply will be handled by the next normal Murph onboarding turn.",
    ].join('\n'),
  } satisfies MurphOnboardingFollowupAutomationDefinition

export function resolveMurphOnboardingFollowupSchedule(
  stableKey: string,
): MurphOnboardingFollowupAutomationSchedule {
  const normalizedStableKey = stableKey.trim()
  if (normalizedStableKey.length === 0) {
    throw new TypeError('Onboarding follow-up schedule requires a stable key.')
  }

  const baseTime = parseDailyTime(
    MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.schedule.localTime,
  )
  if (!baseTime) {
    throw new TypeError('Onboarding follow-up base time is invalid.')
  }

  const slotCount = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.jitterMinutes
  if (!Number.isSafeInteger(slotCount) || slotCount <= 0) {
    throw new TypeError('Onboarding follow-up jitter requires at least one minute.')
  }

  const slot = createHash('sha256')
    .update(`murph-onboarding-followup:${normalizedStableKey}`)
    .digest()
    .readUInt32BE(0) % slotCount
  const minuteOfDay = baseTime.hour * 60 + baseTime.minute + slot

  return {
    kind: 'dailyLocal',
    localTime: [
      String(Math.floor(minuteOfDay / 60)).padStart(2, '0'),
      String(minuteOfDay % 60).padStart(2, '0'),
    ].join(':'),
  }
}

export function resolveMurphOnboardingFollowupActiveUntil(input: {
  scheduledAt: string
  timeZone: string
}): string {
  const scheduledAt = new Date(input.scheduledAt)
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new TypeError('Onboarding follow-up active window requires a valid occurrence.')
  }

  const activeUntil = computeAssistantCronNextRunAt(
    {
      kind: 'dailyLocal',
      localTime:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.activeUntilLocalTime,
      timeZone: input.timeZone,
    },
    scheduledAt,
  )
  if (!activeUntil) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'Onboarding follow-up active window does not produce a cutoff.',
    )
  }
  if (
    formatTimeZoneDateTimeParts(scheduledAt, input.timeZone).dayKey !==
    formatTimeZoneDateTimeParts(activeUntil, input.timeZone).dayKey
  ) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'Onboarding follow-up cutoff must remain on the occurrence local day.',
    )
  }

  return activeUntil
}
