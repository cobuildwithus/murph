// Run facts for a recurring reminder the member or room asked for or agreed to.
// The skip rule itself is stated once, in the scheduled prompt's execution
// context; these lines only say which completion reports fall in this
// occurrence's window.
export const ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_INSTRUCTIONS =
  '- Recurring reminder: one occurrence in a repeating series.'

export const ASSISTANT_CRON_RECURRING_REMINDER_SINGLE_DAILY_TIME_INSTRUCTIONS =
  '- Recurring reminder with one scheduled time per local day: a report that this was done on the occurrence local date counts for this occurrence.'

export const ASSISTANT_CRON_RECURRING_REMINDER_REPEATING_DAILY_INSTRUCTIONS =
  '- Recurring reminder that can fire more than once per local day: a report that this was done counts only when it identifies this time, dose, or step.'
