import { VaultCliError } from '../vault-cli-errors.js'

export const MAX_DURATION_MINUTES = 24 * 60

const ambiguousDurationPattern =
  /\b\d+(?:\.\d+)?\s*(?:or|to|\/|-)\s*\d+(?:\.\d+)?\s*(?:minutes?|mins?|min|hours?|hrs?|hr|h)\b/iu
const combinedDurationPatterns = [
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h)\s*(?:and\s+)?(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?|min|m)\b/iu,
  /\b(\d+(?:\.\d+)?)h\s*(\d+(?:\.\d+)?)m\b/iu,
] as const
const hourOnlyPattern =
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|hr|h)\b/iu
const minuteOnlyPatterns = [
  /\b(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?|min)\b/iu,
  /\b(\d+(?:\.\d+)?)m\b/iu,
] as const

export function inferDurationMinutes(text: string): number | 'ambiguous' | null {
  if (ambiguousDurationPattern.test(text)) {
    return 'ambiguous'
  }

  if (/\bhalf(?: an)? hour\b/iu.test(text) || /\bhalf-hour\b/iu.test(text)) {
    return 30
  }

  for (const pattern of combinedDurationPatterns) {
    const match = text.match(pattern)
    if (!match) {
      continue
    }

    const hours = Number.parseFloat(match[1] ?? '')
    const minutes = Number.parseFloat(match[2] ?? '')
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return validateDurationMinutes((hours * 60) + minutes)
    }
  }

  const hourMatch = text.match(hourOnlyPattern)
  const minuteMatch = findMinuteDurationMatch(text)

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
