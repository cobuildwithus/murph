const ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_HEADING =
  'Recurring reminder conversation (engine-supplied; apply only when the saved request is an ordinary reminder):'

const ASSISTANT_CRON_RECURRING_REMINDER_BASE_POLICY_LINES = [
  '- Direct-message completion takes precedence: return `skip` for only this occurrence when a timestamp or trusted adjacent date context places a user report or assistant acknowledgment that explicitly confirms this exact action was completed in its window. Missing, stale, ambiguous, other-action, or other-occurrence evidence does not qualify; future recurrences remain active.',
  '- Otherwise send the current cue as scheduled with its requested wording. A lack of replies to earlier occurrences never justifies skipping this one or adding a question about keeping, changing, or pausing the reminder.',
] as const

export const ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_INSTRUCTIONS = [
  ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_HEADING,
  ...ASSISTANT_CRON_RECURRING_REMINDER_BASE_POLICY_LINES,
].join('\n')

export function buildAssistantCronRecurringReminderConversationInstructions(
  occurrenceEvidence: string,
): string {
  return [
    ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_HEADING,
    occurrenceEvidence,
    ...ASSISTANT_CRON_RECURRING_REMINDER_BASE_POLICY_LINES,
  ].join('\n')
}
