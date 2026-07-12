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
    summary: 'Daily value-and-foundation continuation check until Murph onboarding is complete.',
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
      'Goal: advance Murph onboarding through useful support and a finite health-context foundation without turning it into a drip questionnaire. Ordinary health help remains available while onboarding is open. The first scheduled occurrence is intentionally deferred until the next local day after the relationship begins.',
      '',
      'Before deciding, read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md`, run `vault-cli assistant onboarding resume-context --format json`, and read the available recent user messages. The skill is the single owner of conversation order, checkpoint meaning, persistence, and completion; do not create a second state machine in this automation.',
      '',
      'Success criteria: onboarding is no longer open, or one skill-approved support action or question usefully advances the relationship.',
      '',
      'If `onboarding.status` is `completed`, archive this automation with `vault-cli automation set-status finish-onboarding-followup --status archived`, then return skip. If archiving fails, still return skip without messaging the user so this check can retry later.',
      '',
      'If the onboarding skill says the visible and saved evidence satisfies answered completion, or shows an overall decline, run its required completion command. If completion succeeds, archive this automation, then return skip. If completion or archiving fails, return skip without messaging so this check can retry later.',
      '',
      'If a promised follow-through or next step in the member\'s agreed support loop is due, do that first. Do not append a foundation question when the support reply should stand alone.',
      '',
      'Otherwise use exactly the next unresolved step from the onboarding skill, including its required bridge before foundation questions and its targeted-read rules for omitted, truncated, or errored evidence. Do not compress, reorder, or bypass that policy merely because this is a scheduled run.',
      '',
      'Before sending, triple-check the snapshot and recent messages for an answer, skip, defer, or decline. Do not re-ask known or resolved context. If the latest onboarding question is unanswered, do not rotate to another setup question or repeat it through this daily automation; return skip unless a separate agreed support action is due. Honor requested timing, and return skip whenever there is no timely, useful continuation.',
      '',
      "Output: send one brief, natural, low-pressure in-chat continuation only when it advances the member's support or foundation. Ask at most one question. Do not mention internal state, setup completion, or this automation, and do not use a fixed script. The user's reply will be handled by the next normal Murph onboarding turn.",
    ].join('\n'),
  } satisfies MurphOnboardingFollowupAutomationDefinition
