import type { WorkoutUnitPreferences } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { loadRuntimeModule } from '../runtime-import.js'
import { compactObject } from './vault-usecase-helpers.js'

interface WorkoutPreferencesDocument {
  sourcePath: string
  updatedAt: string
  workoutUnitPreferences: WorkoutUnitPreferences | null
}

interface WorkoutMeasurementCoreRuntime {
  readPreferencesDocument(vaultRoot: string): Promise<WorkoutPreferencesDocument>
  updateWorkoutUnitPreferences(input: {
    vaultRoot: string
    preferences: WorkoutUnitPreferences
    updatedAt?: string
  }): Promise<{
    document: WorkoutPreferencesDocument
  }>
}

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
