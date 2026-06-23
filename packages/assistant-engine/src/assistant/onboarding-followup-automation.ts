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
    summary: 'Daily setup continuation check until Murph onboarding is complete.',
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
      'Goal: close or gently advance Murph onboarding after hosted signup without re-asking setup context the vault already knows. The first scheduled occurrence is intentionally deferred until after the signup day.',
      '',
      'Before deciding, run `vault-cli assistant onboarding resume-context --format json`.',
      '',
      'Success criteria: onboarding is no longer open, or the user receives one brief question for the smallest genuinely unresolved onboarding step.',
      '',
      'If `onboarding.status` is `completed`, archive this automation with `vault-cli automation set-status finish-onboarding-followup --status archived`, then return skip. If archiving fails, still return skip without messaging the user so this check can retry later.',
      '',
      'If `onboarding.status` is `open` but resume-context or the available recent user messages show the onboarding completion criteria are already satisfied through answers, saved setup facts, skipped individual fields, or deferrals, run `vault-cli assistant onboarding complete --reason user_answered`. If recent user messages show a clear overall onboarding opt-out, run `vault-cli assistant onboarding complete --reason user_declined` instead. If the output shows completed, archive this automation, then return skip. If completion or archiving fails, return skip without messaging the user so this check can retry later.',
      '',
      'If onboarding is still genuinely open, use resume-context and the available recent user messages as saved setup evidence. Open status alone is not evidence that setup facts are missing. Treat saved, skipped, declined individual fields, not-relevant, or clearly answered-in-chat setup context as resolved. If most setup context is already present, ask about the next meaningful first-experiment setup or deferral decision instead of more intake.',
      '',
      'Before sending, triple-check resume-context and the available recent user messages for an answer to the question you would ask. The last thing we want is to bug the user after they already answered onboarding. If there is no useful next unresolved question, return skip rather than sending a generic setup nudge.',
      '',
      "Output: send one brief, natural, low-pressure in-chat question only when a real unresolved step remains. Do not mention internal state or this automation, and do not use a fixed script. The user's answer will be handled by the next normal Murph onboarding turn.",
    ].join('\n'),
  } satisfies MurphOnboardingFollowupAutomationDefinition
