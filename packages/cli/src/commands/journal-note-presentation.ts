import {
  isStrictIsoDate,
  JOURNAL_TIMINGS,
  journalTimingTag,
  readJournalIcon,
  readJournalTiming,
  type JournalIcon,
  type JournalTiming,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export function journalNotePresentationTags(input: {
  noteType?: string
  occurredAt?: string
  icon?: JournalIcon
  timing?: JournalTiming
  tags: string[]
}): string[] {
  const isJournal = input.noteType?.startsWith('journal-') === true
  if (!isJournal && !input.icon && !input.timing) return input.tags
  const occurredAt = input.occurredAt?.trim()
  const hasExactTime = Boolean(occurredAt && !isStrictIsoDate(occurredAt))
  const timing = input.timing ?? readJournalTiming(input.tags) ?? (hasExactTime ? 'timed' : 'unknown')
  if (timing === 'timed' && !hasExactTime) {
    throw new VaultCliError('invalid_option', 'Timed notes require --occurred-at with an explicit time and offset. Use unknown or a known period for date-only facts.')
  }
  const timingTags = JOURNAL_TIMINGS.map(journalTimingTag)
  const icon = input.icon ?? readJournalIcon(input.tags) ?? 'note'
  const tags = input.tags.filter((tag) =>
    !tag.startsWith('journal-icon-') && !timingTags.includes(tag),
  )
  return [...tags, journalTimingTag(timing), `journal-icon-${icon}`]
}
