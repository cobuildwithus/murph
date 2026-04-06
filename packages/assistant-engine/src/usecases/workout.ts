import {
  type ActivityStrengthExercise,
  type JsonObject,
  type StoredMedia,
  type WorkoutSession,
  workoutSessionSchema,
} from '@murphai/contracts'
import { loadJsonInputObject } from '../json-input.js'
import { showWorkoutRecord } from './workout-read.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  deleteEventRecord,
  editEventRecord,
} from './event-record-mutations.js'
import {
  upsertEventRecord,
} from './provider-event.js'
import {
  compactObject,
  normalizeOptionalText,
} from './vault-usecase-helpers.js'
import {
  inferDurationMinutes,
  validateDurationMinutes,
} from './text-duration.js'
import {
  buildWorkoutTitle,
  deriveDurationMinutesFromTimestamps,
  summarizeWorkoutSessionExercises,
} from './workout-model.js'
import {
  cleanupStagedWorkoutMediaBatch,
  stageWorkoutMediaBatch,
} from './workout-artifacts.js'
import { generateUlid } from '@murphai/runtime-state'

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
  text?: string
  inputFile?: string
  occurredAt?: string
  source?: 'manual' | 'import' | 'device' | 'derived'
  durationMinutes?: number
  activityType?: string
  distanceKm?: number
  strengthExercises?: ActivityStrengthExercise[] | null
  workout?: WorkoutSession | null
  title?: string
  mediaPaths?: string[]
}

export interface ResolveWorkoutCaptureInput {
  text: string
  durationMinutes?: number
  activityType?: string
  distanceKm?: number
  strengthExercises?: ActivityStrengthExercise[] | null
}

export interface ResolvedWorkoutCapture {
  note: string
  title: string
  activityType: string
  durationMinutes: number
  distanceKm: number | null
  strengthExercises: ActivityStrengthExercise[] | null
}

export function resolveWorkoutCapture(
  input: ResolveWorkoutCaptureInput,
): ResolvedWorkoutCapture {
  const note = normalizeOptionalText(input.text)
  if (!note) {
    throw new VaultCliError('contract_invalid', 'Workout text is required.')
  }

  const activity = resolveWorkoutActivityDescriptor(note, input.activityType)
  const durationMinutes = resolveDurationMinutes(note, input.durationMinutes)
  const distanceKm = resolveDistanceKm(note, input.distanceKm)
  const strengthExercises =
    input.strengthExercises ?? inferStrengthExercises(note, activity.activityType)

  return {
    note,
    title: buildWorkoutTitle(activity.activityType, durationMinutes),
    activityType: activity.activityType,
    durationMinutes,
    distanceKm: distanceKm ?? null,
    strengthExercises: strengthExercises ?? null,
  }
}

function asJsonObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function mergeStoredMedia(
  existing: StoredMedia[] | undefined,
  additions: readonly StoredMedia[],
): StoredMedia[] {
  const merged = new Map<string, StoredMedia>()

  for (const entry of existing ?? []) {
    merged.set(entry.relativePath, entry)
  }

  for (const entry of additions) {
    merged.set(entry.relativePath, entry)
  }

  return [...merged.values()]
}

function ensureWorkoutEventId(payload: JsonObject): string {
  const explicitId = valueAsString(payload.id)
  if (explicitId) {
    return explicitId
  }

  const eventId = `evt_${generateUlid()}`
  payload.id = eventId
  return eventId
}

function applyStagedWorkoutMedia(input: {
  payload: JsonObject
  eventId: string
  media: readonly StoredMedia[]
  rawRefs: readonly string[]
}): JsonObject {
  if (input.media.length === 0 && input.rawRefs.length === 0) {
    return input.payload
  }

  const payload: JsonObject = { ...input.payload, id: input.eventId }
  const existingWorkout = normalizeStructuredWorkout(payload.workout)
  const mergedRawRefs = [...new Set([...stringArray(payload.rawRefs), ...input.rawRefs])]
  const mergedWorkoutMedia = mergeStoredMedia(existingWorkout?.media, input.media)

  const workout = existingWorkout
    ? {
        ...existingWorkout,
        ...(mergedWorkoutMedia.length > 0 ? { media: mergedWorkoutMedia } : {}),
      }
    : {
        media: mergedWorkoutMedia,
        exercises: [],
      }

  return {
    ...payload,
    rawRefs: mergedRawRefs,
    workout,
  }
}

function formatSchemaIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'value'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function resolveStructuredDurationMinutes(input: {
  explicitDurationMinutes?: number
  payloadDurationMinutes?: number
  structuredWorkout?: WorkoutSession
  fallbackText?: string
}): number {
  const explicitDurationMinutes =
    typeof input.explicitDurationMinutes === 'number'
      ? validateDurationMinutes(input.explicitDurationMinutes)
      : undefined
  if (explicitDurationMinutes !== undefined) {
    return explicitDurationMinutes
  }

  const payloadDurationMinutes =
    typeof input.payloadDurationMinutes === 'number'
      ? validateDurationMinutes(input.payloadDurationMinutes)
      : undefined
  if (payloadDurationMinutes !== undefined) {
    return payloadDurationMinutes
  }

  const derivedDurationMinutes = deriveDurationMinutesFromTimestamps(
    input.structuredWorkout?.startedAt,
    input.structuredWorkout?.endedAt,
  )
  if (derivedDurationMinutes !== null) {
    return derivedDurationMinutes
  }

  if (input.fallbackText) {
    return resolveDurationMinutes(input.fallbackText, undefined)
  }

  throw new VaultCliError(
    'invalid_option',
    'Workout duration is missing. Pass --duration <minutes> to record it explicitly.',
  )
}

function normalizeStructuredWorkout(
  value: unknown,
  fieldName = 'workout',
): WorkoutSession | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = workoutSessionSchema.safeParse(value)
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `${fieldName} is not a valid workout session payload. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return parsed.data
}

function pickPassthroughEventFields(payload: JsonObject): JsonObject {
  const keys = ['rawRefs', 'externalRef', 'relatedIds', 'tags', 'timeZone'] as const
  const entries = keys.flatMap((key) =>
    payload[key] !== undefined ? [[key, payload[key]] as const] : [],
  )

  return Object.fromEntries(entries)
}

export function buildStructuredWorkoutEventPayload(input: {
  payload: JsonObject
  occurredAt?: string
  source?: AddWorkoutRecordInput['source']
  durationMinutes?: number
  activityType?: string
  distanceKm?: number
  strengthExercises?: ActivityStrengthExercise[] | null
  workout?: WorkoutSession | null
  text?: string
  title?: string
}): JsonObject {
  const sourcePayload = input.payload
  const structuredWorkout =
    normalizeStructuredWorkout(input.workout, 'workout')
    ?? (sourcePayload.workout !== undefined
      ? normalizeStructuredWorkout(sourcePayload.workout, 'payload.workout')
      : undefined)
    ?? (Array.isArray(sourcePayload.exercises)
      ? normalizeStructuredWorkout(sourcePayload, 'payload')
      : undefined)

  const fallbackText =
    normalizeOptionalText(valueAsString(sourcePayload.note))
    ?? normalizeOptionalText(valueAsString(sourcePayload.text))
    ?? normalizeOptionalText(input.text)
    ?? normalizeOptionalText(structuredWorkout?.sessionNote)
    ?? normalizeOptionalText(structuredWorkout?.routineName)

  const activityDescriptor = fallbackText
    ? resolveWorkoutActivityDescriptor(
        fallbackText,
        input.activityType ?? valueAsString(sourcePayload.activityType) ?? 'strength-training',
      )
    : resolveWorkoutActivityDescriptor(
        input.activityType ?? valueAsString(sourcePayload.activityType) ?? 'strength-training',
        input.activityType ?? valueAsString(sourcePayload.activityType) ?? 'strength-training',
      )

  const durationMinutes =
    resolveStructuredDurationMinutes({
      explicitDurationMinutes: input.durationMinutes,
      payloadDurationMinutes: valueAsNumber(sourcePayload.durationMinutes),
      structuredWorkout,
      fallbackText: fallbackText ?? undefined,
    })
  const distanceKm =
    typeof input.distanceKm === 'number'
      ? input.distanceKm
      : typeof sourcePayload.distanceKm === 'number'
        ? sourcePayload.distanceKm
        : resolveDistanceKm(fallbackText ?? '', undefined)
  const strengthExercises =
    input.strengthExercises
    ?? (Array.isArray(sourcePayload.strengthExercises)
      ? (sourcePayload.strengthExercises as ActivityStrengthExercise[])
      : null)
    ?? summarizeWorkoutSessionExercises(structuredWorkout)
    ?? null
  const occurredAt =
    input.occurredAt
    ?? valueAsString(sourcePayload.occurredAt)
    ?? structuredWorkout?.startedAt
    ?? new Date().toISOString()
  const title =
    normalizeOptionalText(input.title)
    ?? normalizeOptionalText(valueAsString(sourcePayload.title))
    ?? buildWorkoutTitle(
      activityDescriptor.activityType,
      durationMinutes,
    )
  const note = fallbackText ?? title

  return {
    ...pickPassthroughEventFields(sourcePayload),
    kind: 'activity_session',
    occurredAt,
    source: input.source ?? valueAsString(sourcePayload.source) ?? 'manual',
    title,
    activityType: activityDescriptor.activityType,
    durationMinutes,
    ...(typeof distanceKm === 'number' ? { distanceKm } : {}),
    ...(strengthExercises ? { strengthExercises } : {}),
    ...(structuredWorkout ? { workout: structuredWorkout } : {}),
    note,
  }
}

async function loadStructuredWorkoutPayload(inputFile: string) {
  return loadJsonInputObject(inputFile, 'workout payload')
}

export async function addWorkoutRecord(input: AddWorkoutRecordInput) {
  let payload: JsonObject

  if (typeof input.inputFile === 'string') {
    payload = buildStructuredWorkoutEventPayload({
      payload: await loadStructuredWorkoutPayload(input.inputFile),
      occurredAt: input.occurredAt,
      source: input.source,
      durationMinutes: input.durationMinutes,
      activityType: input.activityType,
      distanceKm: input.distanceKm,
      strengthExercises: input.strengthExercises,
      workout: input.workout,
      text: input.text,
      title: input.title,
    })
  } else if (input.workout) {
    payload = buildStructuredWorkoutEventPayload({
      payload: {},
      occurredAt: input.occurredAt,
      source: input.source,
      durationMinutes: input.durationMinutes,
      activityType: input.activityType ?? 'strength-training',
      distanceKm: input.distanceKm,
      strengthExercises: input.strengthExercises,
      workout: input.workout,
      text: input.text,
      title: input.title,
    })
  } else {
    const capture = resolveWorkoutCapture({
      text: input.text ?? '',
      durationMinutes: input.durationMinutes,
      activityType: input.activityType,
      distanceKm: input.distanceKm,
      strengthExercises: input.strengthExercises,
    })
    payload = {
      kind: 'activity_session',
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      source: input.source ?? 'manual',
      title: capture.title,
      activityType: capture.activityType,
      durationMinutes: capture.durationMinutes,
      ...(typeof capture.distanceKm === 'number'
        ? { distanceKm: capture.distanceKm }
        : {}),
      ...(capture.strengthExercises
        ? { strengthExercises: capture.strengthExercises }
        : {}),
      note: capture.note,
    }
  }

  const mediaPaths = Array.isArray(input.mediaPaths)
    ? input.mediaPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  let manifestFile: string | null = null

  if (mediaPaths.length > 0) {
    const eventId = ensureWorkoutEventId(payload)
    const occurredAt = String(payload.occurredAt ?? input.occurredAt ?? new Date().toISOString())
    const stagedMedia = await stageWorkoutMediaBatch({
      vault: input.vault,
      eventId,
      occurredAt,
      family: 'workout',
      source: valueAsString(payload.source) ?? input.source ?? 'manual',
      mediaPaths,
    })

    if (stagedMedia) {
      manifestFile = stagedMedia.manifestFile
      payload = applyStagedWorkoutMedia({
        payload,
        eventId,
        media: stagedMedia.media,
        rawRefs: stagedMedia.rawRefs,
      })
    }
  }

  const result = await (async () => {
    try {
      return await upsertEventRecord({
        vault: input.vault,
        payload,
      })
    } catch (error) {
      if (manifestFile) {
        await cleanupStagedWorkoutMediaBatch({
          vault: input.vault,
          manifestFile,
        })
      }
      throw error
    }
  })()

  return {
    ...result,
    occurredAt: String(payload.occurredAt ?? input.occurredAt ?? new Date().toISOString()),
    kind: 'activity_session' as const,
    title: String(payload.title ?? ''),
    activityType: String(payload.activityType ?? ''),
    durationMinutes: Number(payload.durationMinutes ?? 1),
    distanceKm: typeof payload.distanceKm === 'number' ? payload.distanceKm : null,
    strengthExercises: Array.isArray(payload.strengthExercises)
      ? (payload.strengthExercises as ActivityStrengthExercise[])
      : null,
    workout: normalizeStructuredWorkout(payload.workout) ?? null,
    manifestFile,
    note: String(payload.note ?? payload.title ?? ''),
  }
}

export async function editWorkoutRecord(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
  dayKeyPolicy?: 'keep' | 'recompute'
}) {
  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'workout',
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    dayKeyPolicy: input.dayKeyPolicy,
    expectedKinds: ['activity_session'],
  })

  return showWorkoutRecord(input.vault, result.lookupId)
}

export async function deleteWorkoutRecord(input: {
  vault: string
  lookup: string
}) {
  return deleteEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'workout',
    expectedKinds: ['activity_session'],
  })
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
      label: requested,
    }
  }

  const inferred = inferKnownWorkoutType(text)
  if (inferred) {
    return inferred
  }

  return {
    activityType: 'workout',
    label: 'Workout',
  }
}

function inferKnownWorkoutType(text: string): WorkoutActivityDescriptor | null {
  const normalized = text.toLowerCase()

  for (const candidate of knownWorkoutTypes) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        activityType: candidate.activityType,
        label: candidate.label,
      }
    }
  }

  return null
}

function slugifyWorkoutType(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return normalized.length > 0 ? normalized : null
}

function resolveDurationMinutes(
  text: string,
  explicitDurationMinutes: number | undefined,
): number {
  if (typeof explicitDurationMinutes === 'number') {
    return validateDurationMinutes(explicitDurationMinutes)
  }

  const inferred = inferDurationMinutes(text)
  if (typeof inferred === 'number') {
    return inferred
  }

  if (inferred === 'ambiguous') {
    throw new VaultCliError(
      'invalid_option',
      'Workout duration is ambiguous. Pass --duration <minutes> to record it explicitly.',
    )
  }

  return 30
}

function resolveDistanceKm(
  text: string,
  explicitDistanceKm: number | undefined,
): number | undefined {
  if (typeof explicitDistanceKm === 'number' && Number.isFinite(explicitDistanceKm)) {
    return explicitDistanceKm > 0 ? explicitDistanceKm : undefined
  }

  if (!text || ambiguousDistancePattern.test(text)) {
    return undefined
  }

  const kilometerMatch = kilometerDistancePattern.exec(text)
  if (kilometerMatch) {
    return parseFloat(kilometerMatch[1])
  }

  const shortKilometerMatch = kilometerShortDistancePattern.exec(text)
  if (shortKilometerMatch) {
    return parseFloat(shortKilometerMatch[1])
  }

  const mileMatch = mileDistancePattern.exec(text)
  if (mileMatch) {
    return parseFloat(mileMatch[1]) * MILES_TO_KM
  }

  return undefined
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
    const [, rawSetCount, rawRepsPerSet, rawDescription] = match
    const setCount = Number.parseInt(rawSetCount ?? '', 10)
    const repsPerSet = Number.parseInt(rawRepsPerSet ?? '', 10)
    const details = parseStrengthExerciseDetails(rawDescription ?? '')

    if (!Number.isFinite(setCount) || !Number.isFinite(repsPerSet) || !details) {
      continue
    }

    exercises.push(compactObject({
      exercise: details.exercise,
      setCount,
      repsPerSet,
      load: details.load,
      loadUnit: details.loadUnit,
      loadDescription: details.loadDescription,
    }) as ActivityStrengthExercise)
  }

  return exercises.length > 0 ? exercises : null
}

function parseStrengthExerciseDetails(
  rawDescription: string,
): ParsedStrengthExerciseDetails | null {
  const description = normalizeOptionalText(rawDescription)
  if (!description) {
    return null
  }

  const barbellMatch = description.match(strengthBarbellLoadPattern)
  if (barbellMatch) {
    const [, rawExercise, rawBarWeight, rawBarUnit, rawPlateWeight, rawPlateUnit] = barbellMatch
    const exercise = normalizeOptionalText(rawExercise)
    const barWeight = Number.parseFloat(rawBarWeight ?? '')
    const plateWeight = Number.parseFloat(rawPlateWeight ?? '')
    const barUnit = normalizeLoadUnit(rawBarUnit)
    const plateUnit = normalizeLoadUnit(rawPlateUnit)

    if (exercise && Number.isFinite(barWeight) && Number.isFinite(plateWeight) && barUnit && plateUnit && barUnit === plateUnit) {
      return {
        exercise,
        load: barWeight + plateWeight * 2,
        loadUnit: barUnit,
        loadDescription: `${barWeight} ${barUnit} bar plus ${plateWeight} ${plateUnit} plates on both sides`,
      }
    }
  }

  const simpleLoadMatch = description.match(strengthSimpleLoadPattern)
  if (simpleLoadMatch) {
    const [, rawExercise, rawLoad, rawUnit] = simpleLoadMatch
    const exercise = normalizeOptionalText(rawExercise)
    const load = Number.parseFloat(rawLoad ?? '')
    const loadUnit = normalizeLoadUnit(rawUnit)

    if (exercise && Number.isFinite(load) && loadUnit) {
      return {
        exercise,
        load,
        loadUnit,
      }
    }
  }

  return {
    exercise: description,
  }
}

function normalizeLoadUnit(value: string | undefined): 'lb' | 'kg' | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.toLowerCase()
  if (normalized.startsWith('lb') || normalized.startsWith('pound')) {
    return 'lb'
  }

  if (normalized.startsWith('kg') || normalized.startsWith('kilo')) {
    return 'kg'
  }

  return undefined
}
