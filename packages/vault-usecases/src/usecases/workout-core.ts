import type {
  ActivitySessionEventRecord,
  BodyMeasurementEventRecord,
  MeasurementEventRecord,
  RawImportKind,
} from '@murphai/contracts'
import type {
  CanonicalMutationResource,
  EventAttachmentSourceInput,
  EventDraftByKind,
} from '@murphai/core'

import { loadRuntimeModule } from '../runtime-import.js'

export type ActivitySessionDraftInput = Omit<EventDraftByKind<'activity_session'>, 'kind'>
export type BodyMeasurementDraftInput = Omit<EventDraftByKind<'body_measurement'>, 'kind'>
export type MeasurementDraftInput = Omit<EventDraftByKind<'measurement'>, 'kind'>

export interface WorkoutRawImportOptions {
  importId?: string
  importKind?: RawImportKind
  importedAt?: string | Date
  source?: string | null
  provenance?: Record<string, unknown>
}

export interface WorkoutCoreRuntime {
  canonicalLogicalResource(
    key: string,
    label?: string,
  ): CanonicalMutationResource
  withCanonicalResourceLocks<TResult>(input: {
    vaultRoot: string
    resources: readonly CanonicalMutationResource[]
    run: () => Promise<TResult>
  }): Promise<TResult>
  addActivitySession(input: {
    vaultRoot: string
    draft: ActivitySessionDraftInput
    attachments?: readonly EventAttachmentSourceInput[]
    rawImport?: WorkoutRawImportOptions
  }): Promise<{
    eventId: string
    ledgerFile: string
    created: boolean
    manifestPath: string | null
    event: ActivitySessionEventRecord
  }>
  addBodyMeasurement(input: {
    vaultRoot: string
    draft: BodyMeasurementDraftInput
    attachments?: readonly EventAttachmentSourceInput[]
    rawImport?: WorkoutRawImportOptions
  }): Promise<{
    eventId: string
    ledgerFile: string
    created: boolean
    manifestPath: string | null
    event: BodyMeasurementEventRecord
  }>
  addMeasurement(input: {
    vaultRoot: string
    draft: MeasurementDraftInput
    attachments?: readonly EventAttachmentSourceInput[]
    rawImport?: WorkoutRawImportOptions
  }): Promise<{
    eventId: string
    ledgerFile: string
    created: boolean
    manifestPath: string | null
    event: MeasurementEventRecord
  }>
}

export async function loadWorkoutCoreRuntime(): Promise<WorkoutCoreRuntime> {
  return loadRuntimeModule<WorkoutCoreRuntime>('@murphai/core')
}
