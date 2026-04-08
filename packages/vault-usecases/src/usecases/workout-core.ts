import type {
  ActivitySessionEventRecord,
  BodyMeasurementEventRecord,
  RawImportKind,
} from '@murphai/contracts'
import type {
  EventAttachmentSourceInput,
  EventDraftByKind,
} from '@murphai/core'

import { loadRuntimeModule } from '../runtime-import.js'

export type ActivitySessionDraftInput = Omit<EventDraftByKind<'activity_session'>, 'kind'>
export type BodyMeasurementDraftInput = Omit<EventDraftByKind<'body_measurement'>, 'kind'>

export interface WorkoutRawImportOptions {
  importId?: string
  importKind?: RawImportKind
  importedAt?: string | Date
  source?: string | null
  provenance?: Record<string, unknown>
}

export interface WorkoutCoreRuntime {
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
}

export async function loadWorkoutCoreRuntime(): Promise<WorkoutCoreRuntime> {
  return loadRuntimeModule<WorkoutCoreRuntime>('@murphai/core')
}
