import {
  normalizeStrictIsoTimestamp,
  type WorkoutExercise,
  type WorkoutSession,
  type WorkoutSet,
  workoutSessionSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { editWorkoutRecord } from './workout.js'
import {
  listWorkoutRecords,
  showWorkoutRecord,
} from './workout-read.js'
import {
  ACTIVE_WORKOUT_SCAN_LIMIT,
  type LiveWorkoutExerciseLookup,
  type LiveWorkoutLookupInput,
  type LogLiveWorkoutSetInput,
  elapsedDurationMinutes,
  isActiveLiveWorkout,
} from './workout-live-model.js'

const EXERCISES_PATCH_PREFIX = 'workout.exercises='

export type WorkoutShowResult = Awaited<ReturnType<typeof showWorkoutRecord>>

export async function resolveLiveWorkout(
  input: LiveWorkoutLookupInput,
  options: { requireActive: boolean; allowCompleted?: boolean },
): Promise<WorkoutShowResult> {
  if (input.workoutId) {
    const shown = await showWorkoutRecord(input.vault, input.workoutId)
    const workout = parseShownWorkout(shown)
    assertLiveWorkout(workout, shown.entity.id)
    if (options.requireActive && !isActiveLiveWorkout(workout)) {
      throw new VaultCliError('invalid_operation', `Workout ${shown.entity.id} is not active.`)
    }
    if (!options.allowCompleted && workout.endedAt) {
      throw new VaultCliError(
        'invalid_operation',
        `Workout ${shown.entity.id} is already completed.`,
      )
    }
    return shown
  }

  const active = await findActiveLiveWorkouts(input.vault)
  if (active.length === 0) {
    throw new VaultCliError('not_found', 'No active live workout was found.')
  }
  if (active.length > 1) {
    throw new VaultCliError(
      'command_failed',
      'Multiple active live workouts were found. Pass --workout-id explicitly.',
      { activeWorkoutIds: active.map((entry) => entry.entity.id) },
    )
  }
  return active[0]!
}

export async function findActiveLiveWorkouts(vault: string): Promise<WorkoutShowResult[]> {
  const listed = await listWorkoutRecords({
    vault,
    limit: ACTIVE_WORKOUT_SCAN_LIMIT,
  })
  const shown = await Promise.all(
    listed.items.map((item) => showWorkoutRecord(vault, item.id)),
  )
  return shown.filter((entry) => {
    const parsed = workoutSessionSchema.safeParse(entry.entity.data.workout)
    return parsed.success && isActiveLiveWorkout(parsed.data)
  })
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
) {
  workoutSessionSchema.parse({ ...workout, exercises })
  const set = [`${EXERCISES_PATCH_PREFIX}${JSON.stringify(exercises)}`]
  if (workout.startedAt) {
    set.push(
      `durationMinutes=${elapsedDurationMinutes(
        workout.startedAt,
        new Date().toISOString(),
      )}`,
    )
  }

  await editWorkoutRecord({
    vault: shown.vault,
    lookup: shown.entity.id,
    set,
  })
  return showWorkoutRecord(shown.vault, shown.entity.id)
}

export function resolveExerciseIndex(
  exercises: readonly WorkoutExercise[],
  lookup: LiveWorkoutExerciseLookup,
): number {
  let candidates = exercises.map((exercise, index) => ({ exercise, index }))

  if (lookup.exerciseId) {
    const id = lookup.exerciseId.trim()
    candidates = candidates.filter(({ exercise }) => exercise.sourceExerciseId === id)
  }
  if (lookup.exerciseOrder !== undefined) {
    candidates = candidates.filter(
      ({ exercise }) => exercise.order === lookup.exerciseOrder,
    )
  }
  if (lookup.exerciseName) {
    const name = normalizeExerciseName(lookup.exerciseName)
    candidates = candidates.filter(
      ({ exercise }) => normalizeExerciseName(exercise.name) === name,
    )
  }

  if (
    lookup.exerciseId === undefined &&
    lookup.exerciseOrder === undefined &&
    lookup.exerciseName === undefined
  ) {
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

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function assertLiveWorkout(workout: WorkoutSession, workoutId: string): void {
  if (!workout.startedAt || workout.sourceApp !== 'murph-live') {
    throw new VaultCliError(
      'invalid_operation',
      `Workout ${workoutId} was not started through the live workout surface.`,
    )
  }
}
