import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const MAX_DURATION_MINUTES = 24 * 60

const ambiguousDurationPattern =
  /\b\d+(?:\.\d+)?\s*(?:or|to|\/|-)\s*\d+(?:\.\d+)?\s*(?:minutes?|mins?|min|hours?|hrs?|hr|h)\b/iu
const ambiguousWordHourPatterns = [
  /\b(?:an|one)\s+hour\s*(?:or|to|\/)\s*(?:two|\d+(?:\.\d+)?)(?:\s*(?:hours?|hrs?|hr|h))?\b/iu,
  /\bone\s*(?:or|to|\/)\s*(?:two|\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\b/iu,
] as const
const combinedDurationPatterns = [
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h)\s*(?:and\s+)?(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?|min|m)\b/iu,
  /\b(\d+(?:\.\d+)?)h\s*(\d+(?:\.\d+)?)m\b/iu,
] as const
const wordHourAndHalfPattern =
  /\b(?:an|one)\s+hour\s+and\s+(?:a\s+)?half\b/iu
const wordHourAndMinutesPattern =
  /\b(?:an|one)\s+hour\s+(?:and\s+)?(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?|min|m)\b/iu
const wordHourOnlyPattern = /\b(?:an|one)\s+hour\b/iu
const terminalDurationSuffixPattern = /^\s*[.!?]?\s*$/u
const activityDurationSuffixPattern =
  /^\s+of\s+\p{L}[\p{L}'-]*\s*[.!?]?\s*$/iu
const scheduledDurationSuffixPattern =
  /^\s+(?:before|after)\s+\p{L}[\p{L}'-]*\s*[.!?]?\s*$/iu
const hourOnlyPattern =
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h)\b/iu
const minuteOnlyPatterns = [
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?|min)\b/iu,
  /\b(\d+(?:\.\d+)?)m\b/iu,
] as const
const occurrenceOffsetDurationPatterns = [
  /\b(?:(?:an|one)\s+hour\s+(?:or|to|\/)\s*(?:two|\d+(?:\.\d+)?)(?:\s*(?:hours?|hrs?|hr|h))?|one\s+(?:or|to|\/)\s*(?:two|\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h))\s+ago\b/giu,
  /\b(?:an|one)\s+hour\s+and\s+(?:a\s+half|\d+(?:\.\d+)?\s*-?\s*(?:minutes?|mins?|min|m))\s+ago\b/giu,
  /\b\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?|hr|h)\s+(?:and\s+)?\d+(?:\.\d+)?\s*-?\s*(?:minutes?|mins?|min|m)\s+ago\b/giu,
  /\b(?:half(?:\s+an)?\s+hour|half-hour)\s+ago\b/giu,
  /\b(?:an|one|\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h|minutes?|mins?|min)\s+ago\b/giu,
] as const

export function inferDurationMinutes(text: string): number | 'ambiguous' | null {
  const durationText = occurrenceOffsetDurationPatterns.reduce(
    (value, pattern) => value.replace(pattern, ' '),
    text,
  )

  if (
    ambiguousDurationPattern.test(durationText)
    || ambiguousWordHourPatterns.some((pattern) => pattern.test(durationText))
  ) {
    return 'ambiguous'
  }

  if (
    /\bhalf(?: an)? hour\b/iu.test(durationText)
    || /\bhalf-hour\b/iu.test(durationText)
  ) {
    return 30
  }

  const wordHourDuration = inferBoundedWordHourDuration(durationText)
  if (wordHourDuration !== null) {
    return wordHourDuration
  }

  for (const pattern of combinedDurationPatterns) {
    const match = durationText.match(pattern)
    if (!match) {
      continue
    }

    const hours = Number.parseFloat(match[1] ?? '')
    const minutes = Number.parseFloat(match[2] ?? '')
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return validateDurationMinutes((hours * 60) + minutes)
    }
  }

  const hourMatch = durationText.match(hourOnlyPattern)
  const minuteMatch = findMinuteDurationMatch(durationText)

  if (hourMatch && minuteMatch) {
    return 'ambiguous'
  }

  if (hourMatch) {
    return validateDurationMinutes(
      Number.parseFloat(hourMatch[1] ?? '') * 60,
    )
  }

  if (minuteMatch) {
    return validateDurationMinutes(Number.parseFloat(minuteMatch[1] ?? ''))
  }

  return null
}

function inferBoundedWordHourDuration(
  text: string,
): number | 'ambiguous' | null {
  const halfMatch = text.match(wordHourAndHalfPattern)
  const minutesMatch = text.match(wordHourAndMinutesPattern)
  const match = halfMatch ?? minutesMatch ?? text.match(wordHourOnlyPattern)
  if (!match) {
    return null
  }

  const start = match.index ?? 0
  const end = start + match[0].length
  const prefix = text.slice(0, start)
  const suffix = text.slice(end)
  const remainingText = `${prefix}${' '.repeat(match[0].length)}${suffix}`
  if (
    hourOnlyPattern.test(remainingText)
    || findMinuteDurationMatch(remainingText)
  ) {
    return 'ambiguous'
  }

  const startsRecord = prefix.trim().length === 0
  const framedByFor = /\bfor\s*$/iu.test(prefix)
  const hasBoundedRole =
    (startsRecord
      && (
        terminalDurationSuffixPattern.test(suffix)
        || activityDurationSuffixPattern.test(suffix)
      ))
    || (framedByFor
      && (
        terminalDurationSuffixPattern.test(suffix)
        || scheduledDurationSuffixPattern.test(suffix)
      ))
  if (!hasBoundedRole) {
    return 'ambiguous'
  }

  if (halfMatch) {
    return 90
  }
  if (minutesMatch) {
    return validateDurationMinutes(
      60 + Number.parseFloat(minutesMatch[1] ?? ''),
    )
  }
  return 60
}

export function validateDurationMinutes(value: number, label = 'Duration') {
  if (!Number.isFinite(value)) {
    throw new VaultCliError(
      'invalid_option',
      `${label} must be a positive number of minutes.`,
    )
  }

  const rounded = Math.round(value)
  if (rounded < 1 || rounded > MAX_DURATION_MINUTES) {
    throw new VaultCliError(
      'invalid_option',
      `${label} must be between 1 and ${MAX_DURATION_MINUTES} minutes.`,
    )
  }

  return rounded
}

function findMinuteDurationMatch(text: string) {
  for (const pattern of minuteOnlyPatterns) {
    const match = text.match(pattern)
    if (match) {
      return match
    }
  }

  return null
}
