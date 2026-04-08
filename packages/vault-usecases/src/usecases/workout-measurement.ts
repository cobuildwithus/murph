import {
  bodyMeasurementEntrySchema,
  profileUnitPreferencesSchema,
  type BodyMeasurementEntry,
  type JsonObject,
  type ProfileUnitPreferences,
  type StoredMedia,
} from '@murphai/contracts'
import {
  appendProfileSnapshot,
  readCurrentProfile,
} from '@murphai/core'
import { loadJsonInputObject } from '../json-input.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  compactObject,
  normalizeOptionalText,
  toEventUpsertVaultCliError,
} from './vault-usecase-helpers.js'
import { type BodyMeasurementDraftInput, loadWorkoutCoreRuntime } from './workout-core.js'

interface MeasurementPayloadInput {
  occurredAt?: string
  title?: string
  note?: string
  measurements?: BodyMeasurementEntry[]
  media?: StoredMedia[]
  rawRefs?: string[]
  source?: 'manual' | 'import' | 'device' | 'derived'
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
  source?: 'manual' | 'import' | 'device' | 'derived'
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
  value: ProfileUnitPreferences | null | undefined,
): { weight: 'lb' | 'kg' | null; distance: 'km' | 'mi' | null; bodyMeasurement: 'cm' | 'in' | null } {
  return {
    weight: value?.weight ?? null,
    distance: value?.distance ?? null,
    bodyMeasurement: value?.bodyMeasurement ?? null,
  }
}

async function readWorkoutUnitPreferences(vault: string): Promise<ProfileUnitPreferences | null> {
  const current = await readCurrentProfile({ vaultRoot: vault })
  const parsed = profileUnitPreferencesSchema.safeParse(current.profile?.unitPreferences)
  return parsed.success ? parsed.data : null
}

function resolveMeasurementUnit(input: {
  type: BodyMeasurementEntry['type']
  explicitUnit?: BodyMeasurementEntry['unit']
  preferences?: ProfileUnitPreferences | null
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

function normalizeMeasurementEntry(value: unknown, fieldName = 'measurement'): BodyMeasurementEntry {
  const parsed = bodyMeasurementEntrySchema.safeParse(value)
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `${fieldName} is not a valid body-measurement entry. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return parsed.data
}

function buildMeasurementTitle(measurements: readonly BodyMeasurementEntry[]): string {
  if (measurements.length === 1) {
    const entry = measurements[0]!
    switch (entry.type) {
      case 'weight':
        return 'Weight check-in'
      case 'body_fat_pct':
        return 'Body-fat check-in'
      default:
        return 'Body measurement check-in'
    }
  }

  return 'Body measurement check-in'
}

async function loadStructuredMeasurementPayload(inputFile: string): Promise<MeasurementPayloadInput> {
  const payload = await loadJsonInputObject(inputFile, 'body measurement payload')

  if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
    throw new VaultCliError(
      'invalid_payload',
      'Structured body-measurement payloads cannot set attachments[]. Use --media <path> to stage body-measurement files.',
    )
  }

  const measurements = Array.isArray(payload.measurements)
    ? payload.measurements.map((entry, index) => normalizeMeasurementEntry(entry, `measurements[${index}]`))
    : undefined
  const media = Array.isArray(payload.media)
    ? payload.media.filter((entry): entry is StoredMedia => {
        const candidate = asJsonObject(entry)
        return Boolean(candidate && typeof candidate.relativePath === 'string')
      })
    : undefined

  return {
    occurredAt: valueAsString(payload.occurredAt),
    title: normalizeOptionalText(valueAsString(payload.title)) ?? undefined,
    note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
    measurements,
    media,
    rawRefs: Array.isArray(payload.rawRefs)
      ? payload.rawRefs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : undefined,
    source: valueAsString(payload.source) as MeasurementPayloadInput['source'] | undefined,
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

function buildMeasurementEventDraft(input: {
  payload?: MeasurementPayloadInput
  occurredAt?: string
  title?: string
  note?: string
  measurements: BodyMeasurementEntry[]
  source?: AddWorkoutMeasurementInput['source']
}): BodyMeasurementDraftInput {
  const payload = input.payload
  return compactObject({
    occurredAt: payload?.occurredAt ?? input.occurredAt ?? new Date().toISOString(),
    source: input.source ?? payload?.source ?? 'manual',
    title: normalizeOptionalText(input.title) ?? payload?.title ?? buildMeasurementTitle(input.measurements),
    note: normalizeOptionalText(input.note) ?? payload?.note,
    measurements: input.measurements,
    media: payload?.media,
    rawRefs: payload?.rawRefs,
    tags: payload?.tags,
    links: payload?.links,
    relatedIds: payload?.relatedIds,
    externalRef: payload?.externalRef,
    timeZone: payload?.timeZone,
  }) as BodyMeasurementDraftInput
}

export async function addWorkoutMeasurementRecord(input: AddWorkoutMeasurementInput) {
  const preferences = await readWorkoutUnitPreferences(input.vault)
  const structuredPayload = typeof input.inputFile === 'string'
    ? await loadStructuredMeasurementPayload(input.inputFile)
    : undefined

  const measurements = structuredPayload?.measurements ?? (() => {
    if (!input.type) {
      throw new VaultCliError(
        'invalid_option',
        'Measurement type is required unless --input supplies a structured measurements array.',
      )
    }

    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      throw new VaultCliError('invalid_option', 'Measurement value must be a finite number.')
    }

    return [normalizeMeasurementEntry({
      type: input.type,
      value: input.value,
      unit: resolveMeasurementUnit({
        type: input.type,
        explicitUnit: input.unit,
        preferences,
      }),
      note: normalizeOptionalText(input.note) ?? undefined,
    })]
  })()

  const draft = buildMeasurementEventDraft({
    payload: structuredPayload,
    occurredAt: input.occurredAt,
    title: input.title,
    note: input.note,
    measurements,
    source: input.source,
  })

  const mediaPaths = Array.isArray(input.mediaPaths)
    ? input.mediaPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const core = await loadWorkoutCoreRuntime()

  try {
    const result = await core.addBodyMeasurement({
      vaultRoot: input.vault,
      draft,
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
      kind: 'body_measurement' as const,
      title: result.event.title,
      measurements: result.event.measurements,
      media: result.event.media ?? [],
      manifestFile: result.manifestPath,
      note: normalizeOptionalText(result.event.note) ?? null,
    }
  } catch (error) {
    throw toEventUpsertVaultCliError(error)
  }
}

export async function showWorkoutUnitPreferences(vault: string) {
  const current = await readCurrentProfile({ vaultRoot: vault })
  const unitPreferences = normalizeUnitPreferences(
    profileUnitPreferencesSchema.safeParse(current.profile?.unitPreferences).success
      ? current.profile?.unitPreferences as ProfileUnitPreferences | undefined
      : null,
  )

  return {
    vault,
    snapshotId: current.snapshot?.id ?? null,
    updated: false,
    recordedAt: current.snapshot?.recordedAt ?? null,
    unitPreferences,
  }
}

export async function setWorkoutUnitPreferences(input: {
  vault: string
  weight?: 'lb' | 'kg'
  distance?: 'km' | 'mi'
  bodyMeasurement?: 'cm' | 'in'
  recordedAt?: string
}) {
  const requested = compactObject({
    weight: input.weight,
    distance: input.distance,
    bodyMeasurement: input.bodyMeasurement,
  }) as ProfileUnitPreferences

  if (Object.keys(requested).length === 0) {
    throw new VaultCliError(
      'invalid_option',
      'Specify at least one unit preference to update.',
    )
  }

  const current = await readCurrentProfile({ vaultRoot: input.vault })
  const currentPreferences = profileUnitPreferencesSchema.safeParse(current.profile?.unitPreferences).success
    ? (current.profile?.unitPreferences as ProfileUnitPreferences | undefined)
    : undefined
  const nextPreferences = compactObject({
    ...currentPreferences,
    ...requested,
  }) as ProfileUnitPreferences

  const currentNormalized = normalizeUnitPreferences(currentPreferences)
  const nextNormalized = normalizeUnitPreferences(nextPreferences)
  if (JSON.stringify(currentNormalized) === JSON.stringify(nextNormalized)) {
    return {
      vault: input.vault,
      snapshotId: current.snapshot?.id ?? null,
      updated: false,
      recordedAt: current.snapshot?.recordedAt ?? null,
      unitPreferences: nextNormalized,
    }
  }

  const snapshot = await appendProfileSnapshot({
    vaultRoot: input.vault,
    recordedAt: input.recordedAt,
    source: 'manual',
    sourceEventIds: current.snapshot?.sourceEventIds,
    sourceAssessmentIds: current.snapshot?.sourceAssessmentIds,
    profile: {
      ...(current.profile ?? {}),
      unitPreferences: nextPreferences,
    },
  })

  return {
    vault: input.vault,
    snapshotId: snapshot.snapshot.id,
    updated: true,
    recordedAt: snapshot.snapshot.recordedAt,
    unitPreferences: normalizeUnitPreferences(snapshot.snapshot.profile.unitPreferences),
  }
}
