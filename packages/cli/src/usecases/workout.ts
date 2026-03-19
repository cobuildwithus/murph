import { type ActivityStrengthExercise } from '@healthybob/contracts'
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
const strengthExercisePattern =
  /(?:^|[.;]\s*)(\d+)\s+sets?\s+of\s+(\d+)\s+([^.;]+?)(?=(?:[.;]|$))/giu
const strengthBarbellLoadPattern =
  /(.+?)\s+with\s+(?:an?\s+)?(\d+(?:\.\d+)?)\s*(lb|lbs?|pounds?|kg|kgs?|kilograms?)\s+bar\s+plus\s+(\d+(?:\.\d+)?)\s*(lb|lbs?|pounds?|kg|kgs?|kilograms?)\s+plates?\s+on\s+both\s+sides$/iu
const strengthSimpleLoadPattern =
  /(.+?)\s+(?:with|at)\s+(?:an?\s+)?(\d+(?:\.\d+)?)\s*(lb|lbs?|pounds?|kg|kgs?|kilograms?)$/iu

interface WorkoutActivityDescriptor {
  activityType: string
  label: string
}

interface ParsedStrengthExerciseDetails {
  exercise: string
  load?: number
  loadUnit?: 'lb' | 'kg'
  loadDescription?: string
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
  const strengthExercises = inferStrengthExercises(note, activity.activityType)
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const payload = compactObject({
    kind: 'activity_session',
    occurredAt,
    source: input.source ?? 'manual',
    title: buildWorkoutTitle(activity.label, durationMinutes),
    activityType: activity.activityType,
    durationMinutes,
    distanceKm: distanceKm ?? undefined,
    strengthExercises: strengthExercises ?? undefined,
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
    strengthExercises: strengthExercises ?? null,
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

function inferStrengthExercises(
  text: string,
  activityType: string,
): ActivityStrengthExercise[] | null {
  if (activityType !== 'strength-training') {
    return null
  }

  const exercises: ActivityStrengthExercise[] = []

  for (const match of text.matchAll(strengthExercisePattern)) {
    const setCount = Number.parseInt(match[1] ?? '', 10)
    const repsPerSet = Number.parseInt(match[2] ?? '', 10)
    const details = parseStrengthExerciseDetails(match[3] ?? '')

    if (
      !details ||
      !Number.isInteger(setCount) ||
      setCount < 1 ||
      !Number.isInteger(repsPerSet) ||
      repsPerSet < 1
    ) {
      continue
    }

    exercises.push(buildStrengthExerciseRecord(details, setCount, repsPerSet))
  }

  return exercises.length > 0 ? exercises : null
}

function parseStrengthExerciseDetails(
  value: string,
): ParsedStrengthExerciseDetails | null {
  const normalized = normalizeExerciseFragment(value)
  if (!normalized) {
    return null
  }

  const barbellLoadMatch = normalized.match(strengthBarbellLoadPattern)
  if (barbellLoadMatch) {
    const exercise = normalizeStrengthExerciseName(barbellLoadMatch[1] ?? '')
    if (!exercise) {
      return null
    }

    const loadDescription = extractStrengthLoadDescription(
      normalized,
      barbellLoadMatch[1] ?? '',
    )
    const barUnit = normalizeStrengthLoadUnit(barbellLoadMatch[3] ?? '')
    const plateUnit = normalizeStrengthLoadUnit(barbellLoadMatch[5] ?? '')
    const barWeight = Number.parseFloat(barbellLoadMatch[2] ?? '')
    const plateWeight = Number.parseFloat(barbellLoadMatch[4] ?? '')

    if (
      barUnit &&
      plateUnit &&
      barUnit === plateUnit &&
      Number.isFinite(barWeight) &&
      Number.isFinite(plateWeight)
    ) {
      const load = normalizeStrengthLoadValue(barWeight + (plateWeight * 2))
      return loadDescription
        ? {
            exercise,
            load,
            loadUnit: barUnit,
            loadDescription,
          }
        : {
            exercise,
            load,
            loadUnit: barUnit,
          }
    }

    return loadDescription
      ? {
          exercise,
          loadDescription,
        }
      : {
          exercise,
        }
  }

  const simpleLoadMatch = normalized.match(strengthSimpleLoadPattern)
  if (simpleLoadMatch) {
    const exercise = normalizeStrengthExerciseName(simpleLoadMatch[1] ?? '')
    const loadUnit = normalizeStrengthLoadUnit(simpleLoadMatch[3] ?? '')
    const load = Number.parseFloat(simpleLoadMatch[2] ?? '')
    if (!exercise) {
      return null
    }

    if (loadUnit && Number.isFinite(load)) {
      const normalizedLoad = normalizeStrengthLoadValue(load)
      const loadDescription = extractStrengthLoadDescription(
        normalized,
        simpleLoadMatch[1] ?? '',
      )
      return loadDescription
        ? {
            exercise,
            load: normalizedLoad,
            loadUnit,
            loadDescription,
          }
        : {
            exercise,
            load: normalizedLoad,
            loadUnit,
          }
    }

    const loadDescription = extractStrengthLoadDescription(
      normalized,
      simpleLoadMatch[1] ?? '',
    )
    return loadDescription
      ? {
          exercise,
          loadDescription,
        }
      : {
          exercise,
        }
  }

  const exercise = normalizeStrengthExerciseName(normalized)
  if (!exercise) {
    return null
  }

  return { exercise }
}

function buildStrengthExerciseRecord(
  details: ParsedStrengthExerciseDetails,
  setCount: number,
  repsPerSet: number,
): ActivityStrengthExercise {
  if (typeof details.load === 'number' && details.loadUnit) {
    return compactObject({
      exercise: details.exercise,
      setCount,
      repsPerSet,
      load: details.load,
      loadUnit: details.loadUnit,
      loadDescription: details.loadDescription,
    }) as ActivityStrengthExercise
  }

  return compactObject({
    exercise: details.exercise,
    setCount,
    repsPerSet,
    loadDescription: details.loadDescription,
  }) as ActivityStrengthExercise
}

function normalizeExerciseFragment(value: string) {
  return normalizeOptionalText(
    value.replace(/[.,;:!?]+$/gu, '').replace(/\s+/gu, ' '),
  )
}

function normalizeStrengthExerciseName(value: string) {
  const normalized = normalizeOptionalText(
    value
      .replace(/[.,;:!?]+$/gu, '')
      .replace(/^(?:an?|the)\s+/iu, '')
      .replace(/\s+/gu, ' '),
  )

  return normalized ? normalized.toLowerCase() : null
}

function extractStrengthLoadDescription(
  fragment: string,
  exerciseText: string,
) {
  const exerciseLength = exerciseText.length
  if (exerciseLength <= 0 || exerciseLength >= fragment.length) {
    return undefined
  }

  return normalizeOptionalText(
    fragment
      .slice(exerciseLength)
      .replace(/^\s+(?:with|at)\s+/iu, '')
      .replace(/^(?:an?\s+)/iu, ''),
  )
}

function normalizeStrengthLoadUnit(value: string) {
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'lb' ||
    normalized === 'lbs' ||
    normalized === 'pound' ||
    normalized === 'pounds'
  ) {
    return 'lb' as const
  }

  if (
    normalized === 'kg' ||
    normalized === 'kgs' ||
    normalized === 'kilogram' ||
    normalized === 'kilograms'
  ) {
    return 'kg' as const
  }

  return undefined
}

function normalizeStrengthLoadValue(value: number) {
  return Number(value.toFixed(3))
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
