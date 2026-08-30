import {
  type EventRecord,
  type EventSource,
  type ActivityStrengthExercise,
  type JsonObject,
  type WorkoutSession,
  workoutImportPayloadSchema,
  workoutSessionSchema,
} from '@murphai/contracts'
import { loadJsonInputObject } from '../json-input.js'
import { showWorkoutRecord } from './workout-read.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  deleteEventRecord,
  editEventRecord,
} from './event-record-mutations.js'
import {
  compactObject,
  normalizeOptionalText,
  toEventUpsertVaultCliError,
} from './vault-usecase-helpers.js'
import { validateDurationMinutes } from './text-duration.js'
import {
  buildWorkoutTitle,
  buildWorkoutSessionFromSummary,
  deriveDurationMinutesFromTimestamps,
} from './workout-model.js'
import { type ActivitySessionDraftInput, loadWorkoutCoreRuntime } from './workout-core.js'
import { resolveWorkoutCaptureDurationDefault } from './workout-measurement.js'

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

interface WorkoutActivityDescriptor {
  activityType: string
  label: string
}

export interface AddWorkoutRecordInput {
  vault: string
  applyWorkoutDurationDefault?: boolean
  text?: string
  inputFile?: string
  occurredAt?: string
  source?: EventSource
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
  title?: string
  durationMinutes?: number
  defaultDurationMinutes?: number
  activityType?: string
  distanceKm?: number
  strengthExercises?: ActivityStrengthExercise[] | null
}

export interface ResolvedWorkoutCapture {
  note?: string
  title: string
  activityType: string
  durationMinutes: number
  distanceKm: number | null
  strengthExercises: ActivityStrengthExercise[] | null
}

export function resolveWorkoutCapture(
  input: ResolveWorkoutCaptureInput,
): ResolvedWorkoutCapture {
  const note = normalizeOptionalText(input.text) ?? undefined
  const activity = resolveWorkoutActivityDescriptor(input.activityType)
  const durationMinutes = resolveDurationMinutes(
    input.durationMinutes,
    input.defaultDurationMinutes,
  )
  const distanceKm = normalizeExplicitDistanceKm(input.distanceKm)
  const strengthExercises = input.strengthExercises ?? null

  return {
    note,
    title:
      normalizeOptionalText(input.title)
      ?? buildWorkoutTitle(activity.activityType, durationMinutes),
    activityType: activity.activityType,
    durationMinutes,
    distanceKm,
    strengthExercises,
  }
}

type ActivitySessionDraft = ActivitySessionDraftInput

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
  defaultDurationMinutes?: number
  payloadDurationMinutes?: number
  structuredWorkout?: WorkoutSession
  allowUnknownDuration?: boolean
}): number | undefined {
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

  if (input.structuredWorkout && input.allowUnknownDuration) {
    return undefined
  }

  if (input.defaultDurationMinutes !== undefined) {
    return validateDurationMinutes(
      input.defaultDurationMinutes,
      'Default workout duration',
    )
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

function assertNoStructuredAttachments(payload: JsonObject): void {
  if (!Array.isArray(payload.attachments) || payload.attachments.length === 0) {
    return
  }

  throw new VaultCliError(
    'invalid_payload',
    'Structured workout payloads cannot set attachments[]. Use --media <path> to stage workout files.',
  )
}

function parseWorkoutImportPayload(payload: JsonObject): JsonObject {
  assertNoStructuredAttachments(payload)
  const parsed = workoutImportPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `workout import-json payload is invalid. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return parsed.data as JsonObject
}

function pickPassthroughDraftFields(payload: JsonObject): Partial<ActivitySessionDraft> {
  const keys = ['rawRefs', 'externalRef', 'relatedIds', 'tags', 'timeZone', 'links'] as const
  const entries = keys.flatMap((key) =>
    payload[key] !== undefined ? [[key, payload[key]] as const] : [],
  )

  return Object.fromEntries(entries) as Partial<ActivitySessionDraft>
}

export function buildStructuredWorkoutActivitySessionDraft(input: {
  payload: JsonObject
  occurredAt?: string
  source?: AddWorkoutRecordInput['source']
  durationMinutes?: number
  defaultDurationMinutes?: number
  activityType?: string
  distanceKm?: number
  strengthExercises?: ActivityStrengthExercise[] | null
  workout?: WorkoutSession | null
  text?: string
  title?: string
  allowUnknownDuration?: boolean
}): ActivitySessionDraft {
  const sourcePayload = parseWorkoutImportPayload(input.payload)
  const explicitStructuredWorkout =
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
    ?? normalizeOptionalText(explicitStructuredWorkout?.sessionNote)
    ?? normalizeOptionalText(explicitStructuredWorkout?.routineName)

  const activityDescriptor = resolveWorkoutActivityDescriptor(
    input.activityType ?? valueAsString(sourcePayload.activityType) ?? 'strength-training',
  )

  const durationMinutes =
    resolveStructuredDurationMinutes({
      explicitDurationMinutes: input.durationMinutes,
      defaultDurationMinutes: input.defaultDurationMinutes,
      payloadDurationMinutes: valueAsNumber(sourcePayload.durationMinutes),
      structuredWorkout: explicitStructuredWorkout,
      allowUnknownDuration: input.allowUnknownDuration,
    })
  const distanceKm =
    typeof input.distanceKm === 'number'
      ? input.distanceKm
      : typeof sourcePayload.distanceKm === 'number'
        ? sourcePayload.distanceKm
        : undefined
  const strengthExercises =
    input.strengthExercises
    ?? (Array.isArray(sourcePayload.strengthExercises)
      ? (sourcePayload.strengthExercises as ActivityStrengthExercise[])
      : null)
    ?? null
  const occurredAt =
    input.occurredAt
    ?? valueAsString(sourcePayload.occurredAt)
    ?? explicitStructuredWorkout?.startedAt
    ?? new Date().toISOString()
  const title =
    normalizeOptionalText(input.title)
    ?? normalizeOptionalText(valueAsString(sourcePayload.title))
    ?? buildWorkoutTitle(
      activityDescriptor.activityType,
      durationMinutes,
    )
  const note = fallbackText ?? title
  const structuredWorkout = explicitStructuredWorkout
    ? {
        ...explicitStructuredWorkout,
        ...(note && !explicitStructuredWorkout.sessionNote
          ? { sessionNote: note }
          : {}),
      }
    : buildWorkoutSessionFromSummary({
        note,
        strengthExercises,
      })

  return compactObject({
    ...pickPassthroughDraftFields(sourcePayload),
    occurredAt,
    source: input.source ?? valueAsString(sourcePayload.source) ?? 'manual',
    title,
    note,
    activityType: activityDescriptor.activityType,
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(typeof distanceKm === 'number' ? { distanceKm } : {}),
    workout: structuredWorkout,
  }) as ActivitySessionDraft
}

async function loadStructuredWorkoutPayload(inputFile: string) {
  return loadJsonInputObject(inputFile, 'workout payload')
}

export async function addStructuredWorkoutRecord(input: {
  vault: string
  draft: ActivitySessionDraft
  mediaPaths?: string[]
}) {
  const durationMinutes = input.draft.durationMinutes
  if (durationMinutes === undefined) {
    throw new VaultCliError(
      'invalid_option',
      'Workout duration is missing. Pass --duration <minutes> to record it explicitly.',
    )
  }
  const mediaPaths = Array.isArray(input.mediaPaths)
    ? input.mediaPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const core = await loadWorkoutCoreRuntime()

  try {
    const result = await core.addActivitySession({
      vaultRoot: input.vault,
      draft: input.draft,
      ...(mediaPaths.length > 0
        ? {
            attachments: mediaPaths.map((sourcePath, index) => ({
              role: `media_${index + 1}`,
              sourcePath,
            })),
          }
        : {}),
    })

    return {
      vault: input.vault,
      eventId: result.eventId,
      lookupId: result.eventId,
      ledgerFile: result.ledgerFile,
      created: result.created,
      occurredAt: result.event.occurredAt,
      kind: 'activity_session' as const,
      title: result.event.title,
      activityType: result.event.activityType,
      durationMinutes,
      distanceKm: typeof result.event.distanceKm === 'number' ? result.event.distanceKm : null,
      workout: result.event.workout ?? null,
      manifestFile: result.manifestPath,
      note: result.event.note ?? result.event.title,
    }
  } catch (error) {
    throw toEventUpsertVaultCliError(error)
  }
}

function shouldReadWorkoutCaptureDefault(input: AddWorkoutRecordInput): boolean {
  if (
    input.applyWorkoutDurationDefault !== true
    || (input.source !== undefined && input.source !== 'manual')
    || input.inputFile !== undefined
    || input.durationMinutes !== undefined
  ) {
    return false
  }

  if (
    deriveDurationMinutesFromTimestamps(
      input.workout?.startedAt,
      input.workout?.endedAt,
    ) !== null
  ) {
    return false
  }

  return true
}

export async function addWorkoutRecord(input: AddWorkoutRecordInput) {
  let draft: ActivitySessionDraft
  const defaultDurationMinutes = shouldReadWorkoutCaptureDefault(input)
    ? await resolveWorkoutCaptureDurationDefault(input.vault)
      ?? undefined
    : undefined

  if (typeof input.inputFile === 'string') {
    draft = buildStructuredWorkoutActivitySessionDraft({
      payload: await loadStructuredWorkoutPayload(input.inputFile),
      occurredAt: input.occurredAt,
      source: input.source,
      durationMinutes: input.durationMinutes,
      defaultDurationMinutes,
      activityType: input.activityType,
      distanceKm: input.distanceKm,
      strengthExercises: input.strengthExercises,
      workout: input.workout,
      text: input.text,
      title: input.title,
    })
  } else if (input.workout) {
    draft = buildStructuredWorkoutActivitySessionDraft({
      payload: {},
      occurredAt: input.occurredAt,
      source: input.source,
      durationMinutes: input.durationMinutes,
      defaultDurationMinutes,
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
      title: input.title,
      durationMinutes: input.durationMinutes,
      defaultDurationMinutes,
      activityType: input.activityType,
      distanceKm: input.distanceKm,
      strengthExercises: input.strengthExercises,
    })
    draft = {
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      source: input.source ?? 'manual',
      title: capture.title,
      ...(capture.note ? { note: capture.note } : {}),
      activityType: capture.activityType,
      durationMinutes: capture.durationMinutes,
      ...(typeof capture.distanceKm === 'number'
        ? { distanceKm: capture.distanceKm }
        : {}),
      workout: buildWorkoutSessionFromSummary({
        note: capture.note,
        strengthExercises: capture.strengthExercises,
      }),
    }
  }

  return addStructuredWorkoutRecord({
    vault: input.vault,
    draft,
    mediaPaths: input.mediaPaths,
  })
}

const WORKOUT_EXERCISES_PATCH_PREFIX = 'workout.exercises='

type WorkoutExercises = NonNullable<WorkoutSession['exercises']>
type WorkoutExercise = WorkoutExercises[number]

function parseWorkoutExerciseReplacement(
  assignments: readonly string[] | undefined,
): WorkoutExercises | null {
  const assignment = assignments
    ?.slice()
    .reverse()
    .find((entry) => entry.startsWith(WORKOUT_EXERCISES_PATCH_PREFIX))
  if (!assignment) {
    return null
  }

  let exercises: unknown
  try {
    exercises = JSON.parse(assignment.slice(WORKOUT_EXERCISES_PATCH_PREFIX.length))
  } catch {
    return null
  }

  const parsed = workoutSessionSchema.safeParse({ exercises })
  return parsed.success ? parsed.data.exercises ?? [] : null
}

function normalizeWorkoutExerciseName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ')
}

function findReplacementExerciseIndex(
  existing: WorkoutExercise,
  replacement: WorkoutExercises,
  usedIndexes: ReadonlySet<number>,
): number | null {
  const findUniqueUnused = (
    predicate: (candidate: WorkoutExercise) => boolean,
  ): number | null => {
    let match: number | null = null
    for (const [candidateIndex, candidate] of replacement.entries()) {
      if (usedIndexes.has(candidateIndex) || !predicate(candidate)) {
        continue
      }
      if (match !== null) {
        return null
      }
      match = candidateIndex
    }
    return match
  }

  if (existing.sourceExerciseId) {
    return findUniqueUnused(
      (candidate) => candidate.sourceExerciseId === existing.sourceExerciseId,
    )
  }

  const normalizedName = normalizeWorkoutExerciseName(existing.name)
  if (existing.groupId) {
    const groupedNameIndex = findUniqueUnused(
      (candidate) =>
        candidate.groupId === existing.groupId &&
        normalizeWorkoutExerciseName(candidate.name) === normalizedName,
    )
    if (groupedNameIndex !== null) {
      return groupedNameIndex
    }
  }

  return findUniqueUnused(
    (candidate) => normalizeWorkoutExerciseName(candidate.name) === normalizedName,
  )
}

const WORKOUT_STRUCTURE_REPAIR =
  'Re-read the workout and include every saved exercise and set. Use --clear-workout only when the member explicitly wants to remove all structured workout details while preserving the event, or workout delete only when they want the entire record removed.'

async function normalizeWorkoutExerciseReplacement(input: {
  vault: string
  lookup: string
  set?: string[]
}): Promise<string[] | undefined> {
  const replacement = parseWorkoutExerciseReplacement(input.set)
  if (replacement === null) {
    return input.set
  }

  const shown = await showWorkoutRecord(input.vault, input.lookup)
  const savedWorkout = shown.entity.data.workout
  if (savedWorkout === null || savedWorkout === undefined) {
    return input.set
  }

  const current = workoutSessionSchema.safeParse(savedWorkout)
  if (!current.success) {
    throw new VaultCliError(
      'invalid_option',
      `Workout edit cannot safely replace exercises because the saved workout structure could not be read. ${WORKOUT_STRUCTURE_REPAIR}`,
    )
  }

  const usedReplacementIndexes = new Set<number>()
  for (const existingExercise of current.data.exercises ?? []) {
    const replacementIndex = findReplacementExerciseIndex(
      existingExercise,
      replacement,
      usedReplacementIndexes,
    )
    if (replacementIndex === null) {
      throw new VaultCliError(
        'invalid_option',
        `Workout edit would remove saved exercise ${existingExercise.order} (${existingExercise.name}). ${WORKOUT_STRUCTURE_REPAIR}`,
      )
    }
    usedReplacementIndexes.add(replacementIndex)

    const replacementExercise = replacement[replacementIndex]
    if (!replacementExercise) {
      throw new VaultCliError(
        'invalid_option',
        `Workout edit could not preserve the saved exercise structure. ${WORKOUT_STRUCTURE_REPAIR}`,
      )
    }

    if (
      replacementExercise.memberRepsPerSet === undefined
      && existingExercise.memberRepsPerSet !== undefined
    ) {
      replacementExercise.memberRepsPerSet = existingExercise.memberRepsPerSet
    }
    if (
      replacementExercise.setPlanIsFinite === undefined
      && existingExercise.setPlanIsFinite !== undefined
    ) {
      replacementExercise.setPlanIsFinite = existingExercise.setPlanIsFinite
    }
    if (
      replacementExercise.targetWeightPerSet === undefined
      && existingExercise.targetWeightPerSet !== undefined
      && existingExercise.targetWeightUnit !== undefined
    ) {
      if (
        replacementExercise.unitOverride !== undefined
        && replacementExercise.unitOverride !== existingExercise.targetWeightUnit
      ) {
        throw new VaultCliError(
          'invalid_option',
          `Workout edit cannot change the weight unit for exercise ${existingExercise.order} (${existingExercise.name}) while preserving its planned ${existingExercise.targetWeightUnit} load. Re-read the workout and preserve that unit, or use the targeted live-workout commands to change the plan explicitly.`,
        )
      }
      replacementExercise.targetWeightPerSet = existingExercise.targetWeightPerSet
      replacementExercise.targetWeightUnit = existingExercise.targetWeightUnit
    }

    for (const existingSet of existingExercise.sets ?? []) {
      if (!replacementExercise.sets.some(
        (candidate) => candidate.order === existingSet.order,
      )) {
        throw new VaultCliError(
          'invalid_option',
          `Workout edit would remove saved set ${existingSet.order} from exercise ${existingExercise.order} (${existingExercise.name}). ${WORKOUT_STRUCTURE_REPAIR}`,
        )
      }
    }
  }

  const assignments = input.set?.slice() ?? []
  for (let index = assignments.length - 1; index >= 0; index -= 1) {
    if (assignments[index]?.startsWith(WORKOUT_EXERCISES_PATCH_PREFIX)) {
      assignments[index] = `${WORKOUT_EXERCISES_PATCH_PREFIX}${
        JSON.stringify(replacement)
      }`
      break
    }
  }
  return assignments
}

interface EditWorkoutRecordInput {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
  dayKeyPolicy?: 'keep' | 'recompute'
  validatedEvent?: {
    event: EventRecord
    ledgerFile: string
  }
}

async function persistWorkoutRecordEdit(input: EditWorkoutRecordInput) {
  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'workout',
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    dayKeyPolicy: input.dayKeyPolicy,
    expectedKinds: ['activity_session'],
    validatedEvent: input.validatedEvent,
  })

  return {
    vault: input.vault,
    entity: result.entity,
  }
}

export async function editWorkoutRecord(input: EditWorkoutRecordInput) {
  const set = await normalizeWorkoutExerciseReplacement(input)
  return persistWorkoutRecordEdit({ ...input, set })
}

/**
 * Persists a validated complete exercise snapshot after its exact-record owner
 * proves one targeted structural mutation. Generic workout edits must use
 * editWorkoutRecord so omissions and ambiguous exercise identity fail closed.
 */
export function editWorkoutRecordAfterValidatedExerciseUpdate(
  input: {
    durationMinutes?: number
    endedAt?: string
    exercises: WorkoutExercise[]
    lastMemberActionId?: string
    lookup: string
    vault: string
    validatedEvent: {
      event: EventRecord
      ledgerFile: string
    }
  },
) {
  const set = [
    `${WORKOUT_EXERCISES_PATCH_PREFIX}${JSON.stringify(input.exercises)}`,
  ]
  if (input.endedAt !== undefined) {
    set.push(`workout.endedAt=${JSON.stringify(input.endedAt)}`)
  }
  if (input.durationMinutes !== undefined) {
    set.push(`durationMinutes=${input.durationMinutes}`)
  }
  if (input.lastMemberActionId !== undefined) {
    set.push(`workout.lastMemberActionId=${input.lastMemberActionId}`)
  }
  return persistWorkoutRecordEdit({
    lookup: input.lookup,
    set,
    vault: input.vault,
    validatedEvent: input.validatedEvent,
  })
}

export async function deleteWorkoutRecord(input: {
  vault: string
  lookup: string
  expectedRevision: number
}) {
  return deleteEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'workout',
    expectedKinds: ['activity_session'],
    expectedRevision: input.expectedRevision,
  })
}

function resolveWorkoutActivityDescriptor(
  requestedActivityType: string | undefined,
): WorkoutActivityDescriptor {
  const requested = normalizeOptionalText(requestedActivityType)

  if (requested) {
    const matched = matchKnownWorkoutType(requested)
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

  return {
    activityType: 'workout',
    label: 'Workout',
  }
}

function matchKnownWorkoutType(value: string): WorkoutActivityDescriptor | null {
  const normalized = value.toLowerCase()

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
  explicitDurationMinutes: number | undefined,
  defaultDurationMinutes: number | undefined = undefined,
): number {
  if (typeof explicitDurationMinutes === 'number') {
    return validateDurationMinutes(explicitDurationMinutes)
  }

  if (defaultDurationMinutes !== undefined) {
    return validateDurationMinutes(
      defaultDurationMinutes,
      'Default workout duration',
    )
  }

  throw new VaultCliError(
    'invalid_option',
    'Workout duration is missing. Pass --duration <minutes> to record it explicitly.',
  )
}

function normalizeExplicitDistanceKm(value: number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : null
  }

  return null
}
