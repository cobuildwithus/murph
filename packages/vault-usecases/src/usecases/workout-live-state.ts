import {
  normalizeStrictIsoTimestamp,
  type WorkoutExercise,
  type WorkoutSession,
  type WorkoutSet,
  workoutSessionSchema,
} from '@murphai/contracts'
import {
  deriveWorkoutActionBinding,
  hasAmbiguousWorkoutActionExerciseCoordinates,
} from '@murphai/operator-config/workout-action-binding'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  compareByLatest,
  loadQueryRuntime,
  toCommandShowEntity,
} from '../commands/query-record-command-helpers.js'
import { loadWorkoutCoreRuntime } from './workout-core.js'
import {
  editWorkoutRecordAfterValidatedExerciseReplacement,
} from './workout.js'
import { showWorkoutRecord, workoutLookupSchema } from './workout-read.js'
import {
  LIVE_WORKOUT_SOURCE_APP,
  type LiveWorkoutExerciseLookup,
  type LiveWorkoutLookupInput,
  type LogLiveWorkoutSetInput,
  elapsedDurationMinutes,
  isOpenLiveWorkout,
} from './workout-live-model.js'
import { toVaultCliError } from './vault-usecase-helpers.js'

const LIVE_WORKOUT_RESOURCE_PREFIX = 'events/live-workout-session'

export type WorkoutShowResult = Awaited<ReturnType<typeof showWorkoutRecord>>

export interface LiveWorkoutExerciseUpdateOptions {
  endedAt?: string
  lastMemberActionId?: string
  observedAt: string
}

export async function withLiveWorkoutMutationLock<TResult>(
  vault: string,
  workoutId: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const normalizedWorkoutId = normalizeLiveWorkoutId(workoutId)
  const core = await loadWorkoutCoreRuntime()

  try {
    return await core.withCanonicalResourceLocks({
      vaultRoot: vault,
      resources: [
        core.canonicalLogicalResource(
          `${LIVE_WORKOUT_RESOURCE_PREFIX}/${normalizedWorkoutId}`,
          `live workout ${normalizedWorkoutId}`,
        ),
      ],
      run,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      CANONICAL_RESOURCE_LOCKED: {
        code: 'command_failed',
        details: { retryable: true },
      },
    })
  }
}

export async function resolveLiveWorkout(
  input: LiveWorkoutLookupInput,
  options: { requireOpen?: boolean } = {},
): Promise<WorkoutShowResult> {
  const workoutId = normalizeLiveWorkoutId(input.workoutId)
  const shown = await showWorkoutRecord(input.vault, workoutId)
  const workout = parseShownWorkout(shown)
  assertLiveWorkout(workout, shown.entity.id)
  if (options.requireOpen && !isOpenLiveWorkout(workout)) {
    throw new VaultCliError(
      'invalid_operation',
      `Workout ${shown.entity.id} is already completed.`,
    )
  }
  return shown
}

export async function findLiveWorkoutActionTargets(
  vault: string,
  actionId: string,
  actionBinding: string,
): Promise<{
  bindingMatches: WorkoutShowResult[]
  exactReplays: WorkoutShowResult[]
}> {
  const records = await findStructuredWorkoutRecords(vault)
  const bindingMatches: WorkoutShowResult[] = []
  const exactReplays: WorkoutShowResult[] = []

  for (const { record, workout } of records) {
    if (
      workout.sourceApp !== LIVE_WORKOUT_SOURCE_APP
      || typeof workout.startedAt !== 'string'
    ) {
      continue
    }
    const shown = {
      vault,
      entity: toCommandShowEntity(record),
    }
    if (workout.lastMemberActionId === actionId) {
      exactReplays.push(shown)
    }
    if (
      isOpenLiveWorkout(workout)
      && !hasAmbiguousWorkoutActionExerciseCoordinates(workout)
      && deriveWorkoutActionBinding(shown.entity.id, workout) === actionBinding
    ) {
      bindingMatches.push(shown)
    }
  }

  return { bindingMatches, exactReplays }
}

async function findStructuredWorkoutRecords(vault: string) {
  const query = await loadQueryRuntime('live workout query reads')
  const readModel = await query.readVault(vault)
  return query
    .listEntities(readModel, {
      families: ['event'],
      kinds: ['activity_session'],
    })
    .flatMap((record) => {
      const parsed = workoutSessionSchema.safeParse(record.attributes.workout)
      return parsed.success ? [{ record, workout: parsed.data }] : []
    })
    .sort((left, right) => compareByLatest(left.record, right.record))
}

export function parseShownWorkout(shown: WorkoutShowResult): WorkoutSession {
  const parsed = workoutSessionSchema.safeParse(shown.entity.data.workout)
  if (!parsed.success) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout ${shown.entity.id} does not contain a valid structured workout session.`,
      { issues: parsed.error.issues },
    )
  }
  return parsed.data
}

export async function updateLiveWorkoutExercises(
  shown: WorkoutShowResult,
  workout: WorkoutSession,
  exercises: WorkoutExercise[],
  options: LiveWorkoutExerciseUpdateOptions,
) {
  const update = validateLiveWorkoutExerciseUpdate(
    shown,
    workout,
    exercises,
    options,
  )
  return editWorkoutRecordAfterValidatedExerciseReplacement({
    durationMinutes: update.durationMinutes,
    endedAt: update.endedAt,
    exercises: update.exercises,
    lastMemberActionId: options.lastMemberActionId,
    lookup: shown.entity.id,
    vault: shown.vault,
  })
}

function validateLiveWorkoutExerciseUpdate(
  shown: WorkoutShowResult,
  workout: WorkoutSession,
  exercises: WorkoutExercise[],
  options: LiveWorkoutExerciseUpdateOptions,
) {
  const observedAt = normalizeWorkoutTimestamp(options.observedAt, 'observedAt')
  const endedAt = options.endedAt === undefined
    ? undefined
    : normalizeWorkoutTimestamp(options.endedAt, 'endedAt')
  if (
    endedAt !== undefined
    && workout.startedAt !== undefined
    && Date.parse(endedAt) <= Date.parse(workout.startedAt)
  ) {
    throw new VaultCliError(
      'invalid_timestamp',
      'Workout endedAt must be later than startedAt.',
    )
  }

  const parsed = workoutSessionSchema.safeParse({
    ...workout,
    ...(endedAt === undefined ? {} : { endedAt }),
    exercises,
  })
  if (!parsed.success) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout ${shown.entity.id} would contain an invalid structured workout session.`,
      { issues: parsed.error.issues },
    )
  }
  assertTargetableLiveWorkout(parsed.data, `Workout ${shown.entity.id}`)

  const durationBoundary = endedAt
    ?? (workout.endedAt === undefined ? observedAt : undefined)
  return {
    durationMinutes:
      durationBoundary !== undefined && workout.startedAt !== undefined
        ? elapsedDurationMinutes(workout.startedAt, durationBoundary)
        : undefined,
    endedAt,
    exercises: parsed.data.exercises,
  }
}

export function resolveExerciseIndex(
  exercises: readonly WorkoutExercise[],
  lookup: LiveWorkoutExerciseLookup,
): number {
  const exerciseId = normalizeOptionalText(lookup.exerciseId)
  const exerciseName = normalizeOptionalText(lookup.exerciseName)
  const exerciseOrder = lookup.exerciseOrder

  if (
    exerciseOrder !== undefined &&
    (!Number.isInteger(exerciseOrder) || exerciseOrder < 1)
  ) {
    throw new VaultCliError(
      'invalid_option',
      'Exercise order must be a positive integer.',
    )
  }

  let candidates = exercises.map((exercise, index) => ({ exercise, index }))

  if (exerciseId) {
    candidates = candidates.filter(
      ({ exercise }) => exercise.sourceExerciseId === exerciseId,
    )
  }
  if (exerciseOrder !== undefined) {
    candidates = candidates.filter(
      ({ exercise }) => exercise.order === exerciseOrder,
    )
  }
  if (exerciseName) {
    const name = normalizeExerciseName(exerciseName)
    candidates = candidates.filter(
      ({ exercise }) => normalizeExerciseName(exercise.name) === name,
    )
  }

  if (!exerciseId && exerciseOrder === undefined && !exerciseName) {
    throw new VaultCliError(
      'invalid_option',
      'Identify the exercise by name, source id, or order.',
    )
  }
  if (candidates.length === 0) {
    throw new VaultCliError('not_found', 'No matching workout exercise was found.')
  }
  if (candidates.length > 1) {
    throw new VaultCliError(
      'invalid_option',
      'Exercise lookup is ambiguous. Pass a source id or exercise order.',
    )
  }
  return candidates[0]!.index
}

export function compactSetPatch(input: LogLiveWorkoutSetInput): Partial<WorkoutSet> {
  const note = normalizeOptionalText(input.note)
  return {
    ...(input.type ? { type: input.type } : {}),
    ...(note ? { note } : {}),
    ...(input.reps !== undefined ? { reps: input.reps } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
    ...(input.weightUnit ? { weightUnit: input.weightUnit } : {}),
    ...(input.durationSeconds !== undefined
      ? { durationSeconds: input.durationSeconds }
      : {}),
    ...(input.distanceMeters !== undefined
      ? { distanceMeters: input.distanceMeters }
      : {}),
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
    ...(input.bodyweightKg !== undefined
      ? { bodyweightKg: input.bodyweightKg }
      : {}),
    ...(input.assistanceKg !== undefined
      ? { assistanceKg: input.assistanceKg }
      : {}),
    ...(input.addedWeightKg !== undefined
      ? { addedWeightKg: input.addedWeightKg }
      : {}),
  }
}

export function assertTargetableLiveWorkout(
  workout: WorkoutSession,
  label: string,
): void {
  const exerciseOrders = new Set<number>()

  for (const exercise of workout.exercises) {
    if (exerciseOrders.has(exercise.order)) {
      throw new VaultCliError(
        'contract_invalid',
        `${label} contains duplicate exercise order ${exercise.order}. Repair the workout structure before using targeted live commands.`,
        { exerciseOrder: exercise.order },
      )
    }
    exerciseOrders.add(exercise.order)

    const setOrders = new Set<number>()
    for (const set of exercise.sets) {
      if (setOrders.has(set.order)) {
        throw new VaultCliError(
          'contract_invalid',
          `${label} contains duplicate set order ${set.order} for exercise ${exercise.order} (${exercise.name}). Repair the workout structure before using targeted live commands.`,
          {
            exerciseName: exercise.name,
            exerciseOrder: exercise.order,
            setOrder: set.order,
          },
        )
      }
      setOrders.add(set.order)
    }
  }
}

export function normalizeLiveWorkoutId(value: string | undefined): string {
  if (typeof value !== 'string') {
    throw new VaultCliError(
      'invalid_option',
      'A canonical workout id is required.',
    )
  }

  const parsed = workoutLookupSchema.safeParse(value.trim())
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_option',
      'Workout id must be a canonical evt_* identifier.',
    )
  }
  return parsed.data
}

export function requireLiveWorkoutSetOrder(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new VaultCliError(
      'invalid_option',
      'Set order must be a positive integer.',
    )
  }
  return value
}

export function normalizeWorkoutTimestamp(value: string, label: string): string {
  const normalized = normalizeStrictIsoTimestamp(value)
  if (!normalized) {
    throw new VaultCliError(
      'invalid_timestamp',
      `Invalid workout ${label} timestamp.`,
    )
  }
  return normalized
}

export function normalizeLiveWorkoutActivityType(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  if (!normalized) {
    throw new VaultCliError(
      'invalid_option',
      'Workout type must include at least one letter or number.',
    )
  }
  return normalized
}

export function normalizeExerciseName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ')
}

export function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function requireNonEmptyText(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new VaultCliError('invalid_option', message)
  }
  return normalized
}

export function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VaultCliError('contract_invalid', message)
  }
  return value.trim()
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function assertLiveWorkout(workout: WorkoutSession, workoutId: string): void {
  if (!workout.startedAt || workout.sourceApp !== 'murph-live') {
    throw new VaultCliError(
      'invalid_operation',
      `Workout ${workoutId} was not started through the live workout surface.`,
    )
  }
}
