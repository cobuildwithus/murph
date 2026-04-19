import {
  bodyMeasurementEntrySchema,
  type BodyMeasurementEntry,
  type EventSource,
  type JsonObject,
  type StoredMedia,
  type WorkoutUnitPreferences,
} from '@murphai/contracts'
import {
  readPreferencesDocument,
  updateWorkoutUnitPreferences,
} from '@murphai/core'
import { loadJsonInputObject } from '../json-input.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  compactObject,
  normalizeOptionalText,
} from './vault-usecase-helpers.js'
import {
  addMeasurementDraftRecord,
  buildMeasurementEventDraft,
  normalizeMetricSlug,
} from './measurement.js'

interface LegacyMeasurementPayloadInput {
  occurredAt?: string
  title?: string
  note?: string
  measurements?: BodyMeasurementEntry[]
  media?: StoredMedia[]
  rawRefs?: string[]
  source?: EventSource
  tags?: string[]
  relatedIds?: string[]
  externalRef?: JsonObject
  links?: unknown
  timeZone?: string
}

export interface AddWorkoutMeasurementInput {
  vault: string
  type?: BodyMeasurementEntry['type']
  value?: number
  unit?: BodyMeasurementEntry['unit']
  note?: string
  title?: string
  occurredAt?: string
  inputFile?: string
  source?: EventSource
  mediaPaths?: string[]
}

function asJsonObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function formatSchemaIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'value'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function normalizeUnitPreferences(
  value: WorkoutUnitPreferences | null | undefined,
): { weight: 'lb' | 'kg' | null; bodyMeasurement: 'cm' | 'in' | null } {
  return {
    weight: value?.weight ?? null,
    bodyMeasurement: value?.bodyMeasurement ?? null,
  }
}

function resolveMeasurementUnit(input: {
  type: BodyMeasurementEntry['type']
  explicitUnit?: BodyMeasurementEntry['unit']
  preferences?: WorkoutUnitPreferences | null
}): BodyMeasurementEntry['unit'] {
  if (input.explicitUnit) {
    return input.explicitUnit
  }

  if (input.type === 'body_fat_pct') {
    return 'percent'
  }

  if (input.type === 'weight') {
    if (input.preferences?.weight) {
      return input.preferences.weight
    }

    throw new VaultCliError(
      'invalid_option',
      'Weight measurements require --unit or a saved workout weight unit preference via `workout units set --weight lb|kg`.',
    )
  }

  if (input.preferences?.bodyMeasurement) {
    return input.preferences.bodyMeasurement
  }

  throw new VaultCliError(
    'invalid_option',
    'Body measurements require --unit or a saved workout body-measurement unit preference via `workout units set --body-measurement cm|in`.',
  )
}

function normalizeLegacyMeasurementEntry(value: unknown, fieldName = 'measurement'): BodyMeasurementEntry {
  const parsed = bodyMeasurementEntrySchema.safeParse(value)
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `${fieldName} is not a valid body-measurement entry. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return parsed.data
}

function convertLegacyEntryToMeasurementEntry(entry: BodyMeasurementEntry) {
  return compactObject({
    metric: normalizeMetricSlug(entry.type.replace(/_/gu, '-')),
    value: entry.value,
    unit: entry.unit,
    note: normalizeOptionalText(entry.note) ?? undefined,
  })
}

async function loadStructuredMeasurementPayload(inputFile: string): Promise<LegacyMeasurementPayloadInput> {
  const payload = await loadJsonInputObject(inputFile, 'body measurement payload')

  if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
    throw new VaultCliError(
      'invalid_payload',
      'Structured body-measurement payloads cannot set attachments[]. Use --media <path> to stage measurement files.',
    )
  }

  const measurements = Array.isArray(payload.measurements)
    ? payload.measurements.map((entry, index) => normalizeLegacyMeasurementEntry(entry, `measurements[${index}]`))
    : undefined

  return {
    occurredAt: valueAsString(payload.occurredAt),
    title: normalizeOptionalText(valueAsString(payload.title)) ?? undefined,
    note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
    measurements,
    media: Array.isArray(payload.media)
      ? payload.media.filter((entry): entry is StoredMedia => {
          const candidate = asJsonObject(entry)
          return Boolean(candidate && typeof candidate.relativePath === 'string')
        })
      : undefined,
    rawRefs: Array.isArray(payload.rawRefs)
      ? payload.rawRefs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : undefined,
    source: valueAsString(payload.source) as LegacyMeasurementPayloadInput['source'] | undefined,
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : undefined,
    relatedIds: Array.isArray(payload.relatedIds)
      ? payload.relatedIds.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : undefined,
    externalRef: asJsonObject(payload.externalRef) ?? undefined,
    links: payload.links,
    timeZone: valueAsString(payload.timeZone),
  }
}

export async function addWorkoutMeasurementRecord(input: AddWorkoutMeasurementInput) {
  const preferencesDocument = await readPreferencesDocument(input.vault)
  const structuredPayload = typeof input.inputFile === 'string'
    ? await loadStructuredMeasurementPayload(input.inputFile)
    : undefined

  const measurements = structuredPayload?.measurements?.map(convertLegacyEntryToMeasurementEntry) ?? (() => {
    if (!input.type) {
      throw new VaultCliError(
        'invalid_option',
        'Measurement type is required unless --input supplies a structured measurements array.',
      )
    }

    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      throw new VaultCliError('invalid_option', 'Measurement value must be a finite number.')
    }

    return [convertLegacyEntryToMeasurementEntry(normalizeLegacyMeasurementEntry({
      type: input.type,
      value: input.value,
      unit: resolveMeasurementUnit({
        type: input.type,
        explicitUnit: input.unit,
        preferences: preferencesDocument.workoutUnitPreferences,
      }),
      note: normalizeOptionalText(input.note) ?? undefined,
    }))]
  })()

  const draft = buildMeasurementEventDraft({
    payload: structuredPayload
      ? compactObject({
          ...structuredPayload,
          measurements,
        })
      : undefined,
    occurredAt: input.occurredAt,
    title: input.title,
    note: input.note,
    measurements,
    source: input.source,
  })

  return addMeasurementDraftRecord({
    vault: input.vault,
    draft,
    mediaPaths: input.mediaPaths,
  })
}

export async function showWorkoutUnitPreferences(vault: string) {
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
  if (JSON.stringify(currentNormalized) === JSON.stringify(nextNormalized)) {
    return {
      vault: input.vault,
      preferencesPath: current.sourcePath,
      updated: false,
      recordedAt: current.updatedAt,
      unitPreferences: nextNormalized,
    }
  }

  const updated = await updateWorkoutUnitPreferences({
    vaultRoot: input.vault,
    updatedAt: input.recordedAt,
    preferences: requested,
  })

  return {
    vault: input.vault,
    preferencesPath: updated.document.sourcePath,
    updated: true,
    recordedAt: updated.document.updatedAt,
    unitPreferences: normalizeUnitPreferences(updated.document.workoutUnitPreferences),
  }
}
