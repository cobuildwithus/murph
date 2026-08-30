import type {
  WorkoutCapturePreferences,
  WorkoutUnitPreferences,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { loadRuntimeModule } from '../runtime-import.js'
import { validateDurationMinutes } from './text-duration.js'
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

const legacyWorkoutDefaultDurationText =
  '(\\d+(?:\\.\\d+)?\\s*-?\\s*(?:minutes?|mins?|min|hours?|hrs?|hr)|half(?:\\s+an)?\\s+hour|half-hour|(?:an|one)\\s+hour)'
const legacyWorkoutDefaultNumericDurationPattern =
  /^(\d+(?:\.\d+)?)\s*-?\s*(minutes?|mins?|min|hours?|hrs?|hr)$/iu
const legacyWorkoutDefaultPatterns = [
  new RegExp(
    `^\\s*workouts?(?:\\s+(?:I\\s+)?report(?:ed)?\\s+here)?\\s+defaults?\\s+to\\s+${legacyWorkoutDefaultDurationText}\\s+unless\\s+(?:(?:(?:another|a\\s+different)\\s+duration\\s+is\\s+(?:stated|specified|provided))|(?:(?:stated|specified|provided)\\s+otherwise))\\b\\s*[.!]?\\s*$`,
    'iu',
  ),
  new RegExp(
    `^\\s*when\\s+(?:the\\s+)?workout\\s+duration\\s+is\\s+(?:omitted|missing|not\\s+(?:stated|specified|provided))\\s*,?\\s*(?:the\\s+)?default\\s+is\\s+${legacyWorkoutDefaultDurationText}\\b\\s*[.!]?\\s*$`,
    'iu',
  ),
] as const

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

function parseLegacyWorkoutDurationDefaults(text: string): number[] {
  const matches = legacyWorkoutDefaultPatterns.flatMap((pattern) => {
    const match = pattern.exec(text)
    return match?.[1] === undefined ? [] : [match[1]]
  })

  return matches.flatMap((match) => {
    try {
      const normalized = match.trim()
      if (/^(?:half(?:\s+an)?\s+hour|half-hour)$/iu.test(normalized)) {
        return [30]
      }
      if (/^(?:an|one)\s+hour$/iu.test(normalized)) {
        return [60]
      }

      const numeric = legacyWorkoutDefaultNumericDurationPattern.exec(normalized)
      if (!numeric) {
        return []
      }
      const value = Number.parseFloat(numeric[1] ?? '')
      const unit = numeric[2]?.toLowerCase() ?? ''
      return [validateDurationMinutes(unit.startsWith('h') ? value * 60 : value)]
    } catch {
      return []
    }
  })
}

function resolveLegacyWorkoutDurationDefault(
  memory: WorkoutMemoryDocument,
): number | null {
  const durations = memory.records
    .filter((record) => record.section === 'Preferences')
    .flatMap((record) => parseLegacyWorkoutDurationDefaults(record.text))
  if (durations.length === 0) {
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
