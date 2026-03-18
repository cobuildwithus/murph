import { VaultCliError } from '../vault-cli-errors.js'
import { upsertEventRecord } from './provider-event.js'
import {
  compactObject,
  normalizeOptionalText,
} from './vault-usecase-helpers.js'

const MAX_DURATION_MINUTES = 24 * 60
const MILES_TO_KM = 1.609344

const knownWorkoutTypes = [
  {
    activityType: 'running',
    label: 'Run',
    patterns: [/\brun(?:ning)?\b/iu, /\bjog(?:ging)?\b/iu],
  },
  {
    activityType: 'walking',
    label: 'Walk',
    patterns: [/\bwalk(?:ing)?\b/iu],
  },
  {
    activityType: 'hiking',
    label: 'Hike',
    patterns: [/\bhik(?:e|ing)\b/iu, /\btrail\b/iu],
  },
  {
    activityType: 'cycling',
    label: 'Ride',
    patterns: [
      /\bbik(?:e|ing)\b/iu,
      /\bcycl(?:e|ing)\b/iu,
      /\bspin(?:ning)?\b/iu,
      /\bpeloton\b/iu,
    ],
  },
  {
    activityType: 'swimming',
    label: 'Swim',
    patterns: [/\bswim(?:ming)?\b/iu, /\bpool\b/iu],
  },
  {
    activityType: 'rowing',
    label: 'Row',
    patterns: [/\brow(?:ing)?\b/iu, /\berg\b/iu],
  },
  {
    activityType: 'yoga',
    label: 'Yoga',
    patterns: [/\byoga\b/iu],
  },
  {
    activityType: 'pilates',
    label: 'Pilates',
    patterns: [/\bpilates\b/iu],
  },
  {
    activityType: 'strength-training',
    label: 'Strength training',
    patterns: [
      /\bstrength(?: training)?\b/iu,
      /\bweight(?:s|lifting)?\b/iu,
      /\blift(?:ing)?\b/iu,
      /\bgym\b/iu,
      /\breps?\b/iu,
      /\bsets?\b/iu,
      /\bpush-?ups?\b/iu,
      /\bpull-?ups?\b/iu,
      /\bbench(?: ?press)?\b/iu,
      /\bsquats?\b/iu,
      /\bdeadlifts?\b/iu,
      /\bdumbbells?\b/iu,
      /\bbarbells?\b/iu,
      /\blb\b/iu,
      /\bkg\b/iu,
    ],
  },
] as const

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
const ambiguousDistancePattern =
  /\b\d+(?:\.\d+)?\s*(?:or|to|\/|-)\s*\d+(?:\.\d+)?\s*(?:km|kilometers?|kilometres?|mi|miles?|k)\b/iu
const kilometerDistancePattern =
  /\b(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?)\b/iu
const kilometerShortDistancePattern = /\b(\d+(?:\.\d+)?)k\b/iu
const mileDistancePattern = /\b(\d+(?:\.\d+)?)\s*(?:mi|miles?)\b/iu

interface WorkoutActivityDescriptor {
  activityType: string
  label: string
}

export interface AddWorkoutRecordInput {
  vault: string
  text: string
  occurredAt?: string
  source?: 'manual' | 'import' | 'device' | 'derived'
  durationMinutes?: number
  activityType?: string
  distanceKm?: number
}

export async function addWorkoutRecord(input: AddWorkoutRecordInput) {
  const note = normalizeOptionalText(input.text)
  if (!note) {
    throw new VaultCliError('contract_invalid', 'Workout text is required.')
  }

  const activity = resolveWorkoutActivityDescriptor(note, input.activityType)
  const durationMinutes = resolveDurationMinutes(note, input.durationMinutes)
  const distanceKm = resolveDistanceKm(note, input.distanceKm)
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const payload = compactObject({
    kind: 'activity_session',
    occurredAt,
    source: input.source ?? 'manual',
    title: buildWorkoutTitle(activity.label, durationMinutes),
    activityType: activity.activityType,
    durationMinutes,
    distanceKm: distanceKm ?? undefined,
    note,
  })

  const result = await upsertEventRecord({
    vault: input.vault,
    payload,
  })

  return {
    ...result,
    occurredAt,
    kind: 'activity_session' as const,
    title: String(payload.title),
    activityType: String(payload.activityType),
    durationMinutes,
    distanceKm: distanceKm ?? null,
    note,
  }
}

function resolveWorkoutActivityDescriptor(
  text: string,
  requestedActivityType: string | undefined,
): WorkoutActivityDescriptor {
  const requested = normalizeOptionalText(requestedActivityType)

  if (requested) {
    const matched = inferKnownWorkoutType(requested)
    if (matched) {
      return matched
    }

    const activityType = slugifyWorkoutType(requested)
    if (!activityType) {
      throw new VaultCliError(
        'invalid_option',
        'Workout type must include at least one letter or number.',
      )
    }

    return {
      activityType,
      label: humanizeRequestedWorkoutType(requested),
    }
  }

  return inferKnownWorkoutType(text) ?? {
    activityType: 'workout',
    label: 'Workout',
  }
}

function inferKnownWorkoutType(text: string) {
  for (const candidate of knownWorkoutTypes) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) {
      return {
        activityType: candidate.activityType,
        label: candidate.label,
      }
    }
  }

  return null
}

function resolveDurationMinutes(
  text: string,
  requestedDurationMinutes: number | undefined,
) {
  if (typeof requestedDurationMinutes === 'number') {
    return validateDurationMinutes(requestedDurationMinutes)
  }

  const inferred = inferDurationMinutes(text)
  if (inferred === 'ambiguous') {
    throw new VaultCliError(
      'invalid_option',
      'Workout duration is ambiguous in the note. Pass --duration <minutes> to record it explicitly.',
    )
  }

  if (typeof inferred === 'number') {
    return inferred
  }

  throw new VaultCliError(
    'invalid_option',
    'Could not infer a workout duration from the note. Pass --duration <minutes> to record it explicitly.',
  )
}

function inferDurationMinutes(text: string): number | 'ambiguous' | null {
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
    return validateDurationMinutes(Number.parseFloat(hourMatch[1] ?? '') * 60)
  }

  if (minuteMatch) {
    return validateDurationMinutes(Number.parseFloat(minuteMatch[1] ?? ''))
  }

  return null
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

function resolveDistanceKm(
  text: string,
  requestedDistanceKm: number | undefined,
) {
  if (typeof requestedDistanceKm === 'number') {
    return validateDistanceKm(requestedDistanceKm)
  }

  return inferDistanceKm(text)
}

function inferDistanceKm(text: string) {
  if (ambiguousDistancePattern.test(text)) {
    return null
  }

  const kilometerMatch = text.match(kilometerDistancePattern)
  if (kilometerMatch) {
    return validateDistanceKm(Number.parseFloat(kilometerMatch[1] ?? ''))
  }

  const kilometerShortMatch = text.match(kilometerShortDistancePattern)
  if (kilometerShortMatch) {
    return validateDistanceKm(Number.parseFloat(kilometerShortMatch[1] ?? ''))
  }

  const mileMatch = text.match(mileDistancePattern)
  if (mileMatch) {
    return validateDistanceKm(
      Number.parseFloat(mileMatch[1] ?? '') * MILES_TO_KM,
    )
  }

  return null
}

function validateDurationMinutes(value: number) {
  if (!Number.isFinite(value)) {
    throw new VaultCliError(
      'invalid_option',
      'Workout duration must be a positive number of minutes.',
    )
  }

  const rounded = Math.round(value)
  if (rounded < 1 || rounded > MAX_DURATION_MINUTES) {
    throw new VaultCliError(
      'invalid_option',
      `Workout duration must be between 1 and ${MAX_DURATION_MINUTES} minutes.`,
    )
  }

  return rounded
}

function validateDistanceKm(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new VaultCliError(
      'invalid_option',
      'Workout distance must be a positive number of kilometers.',
    )
  }

  return Number(value.toFixed(3))
}

function buildWorkoutTitle(label: string, durationMinutes: number) {
  const loweredLabel = label.trim().toLowerCase() || 'workout'
  const title = `${durationMinutes}-minute ${loweredLabel}`
  return title.slice(0, 160)
}

function humanizeRequestedWorkoutType(value: string) {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) {
    return 'Workout'
  }

  return normalized[0].toUpperCase() + normalized.slice(1)
}

function slugifyWorkoutType(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}
