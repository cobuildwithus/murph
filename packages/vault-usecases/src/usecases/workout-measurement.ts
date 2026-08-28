import type {
  WorkoutCapturePreferences,
  WorkoutUnitPreferences,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { loadRuntimeModule } from '../runtime-import.js'
import { inferDurationMinutes } from './text-duration.js'
import { compactObject } from './vault-usecase-helpers.js'

interface WorkoutPreferencesDocument {
  sourcePath: string
  updatedAt: string
  workoutCapturePreferences?: WorkoutCapturePreferences | null
  workoutUnitPreferences: WorkoutUnitPreferences | null
}

interface WorkoutMemoryDocument {
  records: Array<{
    section: string
    text: string
  }>
}

interface WorkoutMeasurementCoreRuntime {
  readMemoryDocument(vaultRoot: string): Promise<WorkoutMemoryDocument>
  readPreferencesDocument(vaultRoot: string): Promise<WorkoutPreferencesDocument>
  updateWorkoutCapturePreferences(input: {
    vaultRoot: string
    preferences: {
      defaultDurationMinutes?: number | null
      legacyMemoryMigrationVersion?: 1
    }
    onlyIfLegacyMigrationPending?: boolean
    updatedAt?: string
  }): Promise<{
    document: WorkoutPreferencesDocument
  }>
  updateWorkoutUnitPreferences(input: {
    vaultRoot: string
    preferences: WorkoutUnitPreferences
    updatedAt?: string
  }): Promise<{
    document: WorkoutPreferencesDocument
  }>
}

const legacyWorkoutDefaultContextPattern =
  /\b(?:workouts?\b[^.!?\n]{0,180}\bdefault(?:s|ed)?\b|default(?:s|ed)?\b[^.!?\n]{0,180}\bworkouts?\b)/iu

const legacyWorkoutDefaultOmissionPattern =
  /\b(?:unless|without|when|whenever|if|omit(?:s|ted|ting)?|missing|not\s+(?:stated|specified))\b/iu
const legacyWorkoutDefaultDurationMentionPattern =
  /\b(?:\d+(?:\.\d+)?\s*-?\s*(?:minutes?|mins?|min|hours?|hrs?|hr)|half(?:\s+an)?\s+hour|half-hour|(?:an|one)\s+hour)\b/giu

async function loadWorkoutMeasurementCoreRuntime(): Promise<WorkoutMeasurementCoreRuntime> {
  return loadRuntimeModule<WorkoutMeasurementCoreRuntime>('@murphai/core')
}

function normalizeUnitPreferences(
  value: WorkoutUnitPreferences | null | undefined,
): { weight: 'lb' | 'kg' | null; bodyMeasurement: 'cm' | 'in' | null } {
  return {
    weight: value?.weight ?? null,
    bodyMeasurement: value?.bodyMeasurement ?? null,
  }
}

function normalizeCapturePreferences(
  value: WorkoutCapturePreferences | null | undefined,
): { durationMinutes: number | null } {
  return {
    durationMinutes: value?.defaultDurationMinutes ?? null,
  }
}

function parseLegacyWorkoutDurationDefault(text: string): number | null {
  if (
    !legacyWorkoutDefaultContextPattern.test(text)
    || !legacyWorkoutDefaultOmissionPattern.test(text)
    || [...text.matchAll(legacyWorkoutDefaultDurationMentionPattern)].length !== 1
  ) {
    return null
  }

  const normalizedDurationText = text.replace(
    /\b(?:an|one)\s+hour\b/giu,
    '1 hour',
  )
  try {
    const duration = inferDurationMinutes(normalizedDurationText)
    return typeof duration === 'number' ? duration : null
  } catch {
    return null
  }
}

function resolveLegacyWorkoutDurationDefault(
  memory: WorkoutMemoryDocument,
): number | null {
  const candidateRecords = memory.records.filter(
    (record) =>
      record.section === 'Preferences'
      && legacyWorkoutDefaultContextPattern.test(record.text)
      && legacyWorkoutDefaultOmissionPattern.test(record.text),
  )
  if (candidateRecords.length === 0) {
    return null
  }

  const durations = candidateRecords.map((record) =>
    parseLegacyWorkoutDurationDefault(record.text),
  )
  if (durations.some((duration) => duration === null)) {
    return null
  }

  const uniqueDurations = new Set(durations)
  return uniqueDurations.size === 1 ? (durations[0] ?? null) : null
}

export async function resolveWorkoutCaptureDurationDefault(
  vault: string,
): Promise<number | null> {
  const runtime = await loadWorkoutMeasurementCoreRuntime()
  const current = await runtime.readPreferencesDocument(vault)
  const currentDuration = normalizeCapturePreferences(
    current.workoutCapturePreferences,
  ).durationMinutes
  if (currentDuration !== null) {
    return currentDuration
  }
  if (current.workoutCapturePreferences?.legacyMemoryMigrationVersion === 1) {
    return null
  }

  const legacyDuration = resolveLegacyWorkoutDurationDefault(
    await runtime.readMemoryDocument(vault),
  )
  if (legacyDuration === null) {
    return null
  }

  const migrated = await runtime.updateWorkoutCapturePreferences({
    vaultRoot: vault,
    onlyIfLegacyMigrationPending: true,
    preferences: {
      defaultDurationMinutes: legacyDuration,
      legacyMemoryMigrationVersion: 1,
    },
  })
  return normalizeCapturePreferences(
    migrated.document.workoutCapturePreferences,
  ).durationMinutes
}

export async function showWorkoutCapturePreferences(vault: string) {
  const { readPreferencesDocument } = await loadWorkoutMeasurementCoreRuntime()
  const preferences = await readPreferencesDocument(vault)

  return {
    vault,
    preferencesPath: preferences.sourcePath,
    updated: false,
    recordedAt: preferences.updatedAt,
    captureDefaults: normalizeCapturePreferences(
      preferences.workoutCapturePreferences,
    ),
  }
}

export async function setWorkoutCapturePreferences(input: {
  vault: string
  durationMinutes?: number
  clearDuration?: boolean
  recordedAt?: string
}) {
  if (input.durationMinutes !== undefined && input.clearDuration === true) {
    throw new VaultCliError(
      'invalid_option',
      'Pass either --duration <minutes> or --clear-duration, not both.',
    )
  }
  if (input.durationMinutes === undefined && input.clearDuration !== true) {
    throw new VaultCliError(
      'invalid_option',
      'Specify --duration <minutes> or --clear-duration.',
    )
  }

  const {
    readPreferencesDocument,
    updateWorkoutCapturePreferences,
  } = await loadWorkoutMeasurementCoreRuntime()
  const current = await readPreferencesDocument(input.vault)
  const currentNormalized = normalizeCapturePreferences(
    current.workoutCapturePreferences,
  )
  const requestedDuration = input.clearDuration === true
    ? null
    : input.durationMinutes

  if (
    currentNormalized.durationMinutes === requestedDuration
    && current.workoutCapturePreferences?.legacyMemoryMigrationVersion === 1
  ) {
    return {
      vault: input.vault,
      preferencesPath: current.sourcePath,
      updated: false,
      recordedAt: current.updatedAt,
      captureDefaults: currentNormalized,
    }
  }

  const result = await updateWorkoutCapturePreferences({
    vaultRoot: input.vault,
    preferences: {
      defaultDurationMinutes: requestedDuration,
      legacyMemoryMigrationVersion: 1,
    },
    updatedAt: input.recordedAt,
  })

  return {
    vault: input.vault,
    preferencesPath: result.document.sourcePath,
    updated: true,
    recordedAt: result.document.updatedAt,
    captureDefaults: normalizeCapturePreferences(
      result.document.workoutCapturePreferences,
    ),
  }
}

export async function showWorkoutUnitPreferences(vault: string) {
  const { readPreferencesDocument } = await loadWorkoutMeasurementCoreRuntime()
  const preferences = await readPreferencesDocument(vault)

  return {
    vault,
    preferencesPath: preferences.sourcePath,
    updated: false,
    recordedAt: preferences.updatedAt,
    unitPreferences: normalizeUnitPreferences(preferences.workoutUnitPreferences),
  }
}

export async function setWorkoutUnitPreferences(input: {
  vault: string
  weight?: 'lb' | 'kg'
  bodyMeasurement?: 'cm' | 'in'
  recordedAt?: string
}) {
  const {
    readPreferencesDocument,
    updateWorkoutUnitPreferences,
  } = await loadWorkoutMeasurementCoreRuntime()
  const requested = compactObject({
    weight: input.weight,
    bodyMeasurement: input.bodyMeasurement,
  }) as WorkoutUnitPreferences

  if (Object.keys(requested).length === 0) {
    throw new VaultCliError(
      'invalid_option',
      'Specify at least one unit preference to update.',
    )
  }

  const current = await readPreferencesDocument(input.vault)
  const currentNormalized = normalizeUnitPreferences(current.workoutUnitPreferences)
  const nextNormalized = normalizeUnitPreferences({
    ...current.workoutUnitPreferences,
    ...requested,
  })

  if (
    currentNormalized.weight === nextNormalized.weight
    && currentNormalized.bodyMeasurement === nextNormalized.bodyMeasurement
  ) {
    return {
      vault: input.vault,
      preferencesPath: current.sourcePath,
      updated: false,
      recordedAt: current.updatedAt,
      unitPreferences: currentNormalized,
    }
  }

  const result = await updateWorkoutUnitPreferences({
    vaultRoot: input.vault,
    preferences: requested,
    updatedAt: input.recordedAt,
  })

  return {
    vault: input.vault,
    preferencesPath: result.document.sourcePath,
    updated: true,
    recordedAt: result.document.updatedAt,
    unitPreferences: normalizeUnitPreferences(
      result.document.workoutUnitPreferences,
    ),
  }
}
