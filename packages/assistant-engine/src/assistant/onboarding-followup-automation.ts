import type {
  AutomationContinuityPolicy,
  AutomationSchedule,
} from '@murphai/contracts'

export type MurphOnboardingFollowupAutomationSchedule = Exclude<
  AutomationSchedule,
  { kind: 'deviceActivity' }
>

export interface MurphOnboardingFollowupAutomationDefinition {
  continuityPolicy: AutomationContinuityPolicy
  instructions: string
  schedule: MurphOnboardingFollowupAutomationSchedule
  slug: string
  summary: string
  tags: readonly string[]
  title: string
}

export const MURPH_ONBOARDING_FOLLOWUP_AUTOMATION =
  {
    slug: 'finish-onboarding-followup',
    title: 'Finish Murph onboarding follow-up',
    summary: 'Daily aspiration-and-foundation continuation check until Murph onboarding is complete.',
    continuityPolicy: 'preserve',
    schedule: {
      kind: 'dailyLocal',
      localTime: '13:30',
    },
    tags: [
      'assistant',
      'scheduled',
      'murph-managed',
      'onboarding',
      'murph-managed:onboarding-followup',
    ],
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
  } satisfies MurphOnboardingFollowupAutomationDefinition
