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
    summary: 'Daily first-thread continuation check until Murph onboarding is complete.',
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
      'Goal: close or gently advance Murph onboarding after hosted signup without turning it into a drip questionnaire. The first scheduled occurrence is intentionally deferred until after the signup day.',
      '',
      'Before deciding, run `vault-cli assistant onboarding resume-context --format json` and read the available recent user messages.',
      '',
      'Success criteria: onboarding is no longer open, or one useful action or question advances the member\'s chosen change, understand, handle, or explore thread.',
      '',
      'If `onboarding.status` is `completed`, archive this automation with `vault-cli automation set-status finish-onboarding-followup --status archived`, then return skip. If archiving fails, still return skip without messaging the user so this check can retry later.',
      '',
      'If `onboarding.status` is `open` but the relationship promise, minimal identity or decline, starting mode, and first useful result or defer are already established, run `vault-cli assistant onboarding complete --reason user_answered`. If recent messages show a clear overall onboarding opt-out, use `--reason user_declined`. If the output shows completed, archive this automation, then return skip. If completion or archiving fails, return skip without messaging so this check can retry later.',
      '',
      'If onboarding is still genuinely open, treat resume-context as evidence rather than required fields. Continue the current goal, question, task, or accepted baseline review with the smallest useful action or one high-value question. Ask for context only when the answer would improve that thread, unlock an action, or resolve a relevant safety uncertainty; briefly explain the benefit when it is not obvious.',
      '',
      'Never rotate through missing profile categories. A wearable, movement history, protocol, supplement or medication inventory, medical history, lab upload, group, and experiment are all optional. If the member has no current thread, gently offer the one-time baseline review only when it has not already been offered; honor any defer or decline without asking again.',
      '',
      'Before sending, triple-check the snapshot and recent messages for an answer or decline. If there is no timely, useful continuation, return skip rather than sending a generic setup nudge.',
      '',
      "Output: send one brief, natural, low-pressure in-chat continuation only when it advances the member's current thread. Ask at most one question. Do not mention internal state or this automation, and do not use a fixed script. The user's reply will be handled by the next normal Murph onboarding turn.",
    ].join('\n'),
  } satisfies MurphOnboardingFollowupAutomationDefinition
