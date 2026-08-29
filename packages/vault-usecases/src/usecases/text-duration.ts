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
const definiteWordHourOnlyPatterns = [
  /^\s*(?:an|one)\s+hour\s*[.!?]?\s*$/iu,
  /^\s*(?:an|one)\s+hour\s+of\b/iu,
  /\bfor\s+(?:an|one)\s+hour(?=\s*[.!?]?\s*$)/iu,
] as const
const hourOnlyPattern =
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h)\b/iu
const minuteOnlyPatterns = [
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?|min)\b/iu,
  /\b(\d+(?:\.\d+)?)m\b/iu,
] as const
const temporalDurationReferencePatterns = [
  /\b(?:(?:an|one)\s+hour\s+(?:or|to|\/)\s*(?:two|\d+(?:\.\d+)?)(?:\s*(?:hours?|hrs?|hr|h))?|one\s+(?:or|to|\/)\s*(?:two|\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h))\s+(?:ago|before|after|later)\b/giu,
  /\b(?:an|one)\s+hour\s+and\s+(?:a\s+half|\d+(?:\.\d+)?\s*-?\s*(?:minutes?|mins?|min|m))\s+(?:ago|before|after|later)\b/giu,
  /\b\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?|hr|h)\s+(?:and\s+)?\d+(?:\.\d+)?\s*-?\s*(?:minutes?|mins?|min|m)\s+(?:ago|before|after|later)\b/giu,
  /\b(?:half(?:\s+an)?\s+hour|half-hour)\s+(?:ago|before|after|later)\b/giu,
  /\b(?:an|one|\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h|minutes?|mins?|min)\s+(?:ago|before|after|later)\b/giu,
] as const

export function inferDurationMinutes(text: string): number | 'ambiguous' | null {
  const durationText = temporalDurationReferencePatterns.reduce(
    (value, pattern) => value.replace(pattern, ' '),
    text,
  )

  if (
    ambiguousDurationPattern.test(durationText)
    || ambiguousWordHourPatterns.some((pattern) => pattern.test(durationText))
  ) {
    return 'ambiguous'
  }

  if (wordHourAndHalfPattern.test(durationText)) {
    return 90
  }

  const wordHourAndMinutesMatch = durationText.match(
    wordHourAndMinutesPattern,
  )
  if (wordHourAndMinutesMatch) {
    const minutes = Number.parseFloat(wordHourAndMinutesMatch[1] ?? '')
    if (Number.isFinite(minutes)) {
      return validateDurationMinutes(60 + minutes)
    }
  }

  if (
    /\bhalf(?: an)? hour\b/iu.test(durationText)
    || /\bhalf-hour\b/iu.test(durationText)
  ) {
    return 30
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

  const wordHourMatch = durationText.match(wordHourOnlyPattern)
  const hourMatch = durationText.match(hourOnlyPattern)
  const minuteMatch = findMinuteDurationMatch(durationText)

  if ((wordHourMatch || hourMatch) && minuteMatch) {
    return 'ambiguous'
  }

  if (wordHourMatch) {
    return definiteWordHourOnlyPatterns.some((pattern) =>
      pattern.test(durationText)
    )
      ? 60
      : 'ambiguous'
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
