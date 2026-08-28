import {
  ASSISTANT_BOUNDED_CONVERSATION_HISTORY_INCOMPLETE_TEXT,
} from '../shared.js'

const ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_HEADING =
  'Recurring reminder conversation (engine-supplied; apply only when the saved request is an ordinary reminder):'

const ASSISTANT_CRON_RECURRING_REMINDER_BASE_POLICY_LINES = [
  '- Direct-message completion takes precedence: return `skip` for only this occurrence when a timestamp or trusted adjacent date context places a user report or assistant acknowledgment that explicitly confirms this exact action was completed in its window. Missing, stale, ambiguous, other-action, or other-occurrence evidence does not qualify; future recurrences remain active.',
  '- Any silence-based cadence policy appended below does not apply to medication, prescribed treatment, clinician-directed care, clinical monitoring, or safety-critical reminders. Send those cues normally unless the direct-conversation completion rule above applies, the member explicitly changes or pauses them, or another authoritative skip condition applies.',
  '- Apply cadence administration only when the engine appends a confirmed-output cadence policy below. Otherwise send the current concise cue normally.',
] as const

export const ASSISTANT_CRON_RECURRING_REMINDER_CADENCE_INSTRUCTIONS = [
  'Confirmed-output reminder cadence policy (engine-supplied; apply only because eligible automation-output history is present above):',
  '- Apply a silence-based cadence question or skip only when the immediately prior confirmed output appears in this request\'s engine-supplied automation-output history. If that output is unavailable under the existing evidence-retention horizon, send the current cue normally. Do not use an assistant transcript entry alone as proof of dispatch because transcript persistence precedes delivery.',
  '- Use recent conversation plus engine delivery evidence. A failed or unconfirmed immediately prior attempt does not count: send the current reminder normally instead of treating that attempt as unanswered.',
  '- Otherwise find the most recent output from this automation whose dispatch was confirmed by provider acceptance or runtime `sent` state.',
  '- If there is no such confirmed output for this revision, send the current reminder normally unless the direct-conversation completion rule above applies.',
  '- If a relevant human reply followed that output, use it when composing the current reminder.',
  `- When a history item with the exact text \`${ASSISTANT_BOUNDED_CONVERSATION_HISTORY_INCOMPLETE_TEXT}\` appears inside this provider request's engine-supplied recent-conversation-history section, the current cold reconstruction is incomplete because an existing retention, count, or byte bound omitted committed details. It is not a human reply and does not prove silence. For this occurrence, do not apply a silence-based cadence question or skip: continue the current cue unless retained conversation or another authoritative owner proves an explicit pause, change, or valid skip condition.`,
  '- That marker expires after the provider request that supplied it. If it is visible only in an earlier turn of a resumed provider thread, ignore it when deciding whether a later confirmed reminder received a relevant reply.',
  '- If no relevant human reply followed and that output already asked whether to keep, change, or pause these interruptions, return `skip`.',
  '- Otherwise send the current concise cue and ask one natural question about whether to keep, change, or pause these interruptions.',
  '- This question administers reminder cadence only. Do not ask whether the action was completed, infer failure or refusal from silence, increase frequency, or manufacture novelty when the same concise cue still fits.',
  '- In a group, address the room collectively. Never assign silence, non-completion, or failure to an individual participant.',
].join('\n')

export const ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_INSTRUCTIONS = [
  ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_HEADING,
  ...ASSISTANT_CRON_RECURRING_REMINDER_BASE_POLICY_LINES,
  ASSISTANT_CRON_RECURRING_REMINDER_CADENCE_INSTRUCTIONS,
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
