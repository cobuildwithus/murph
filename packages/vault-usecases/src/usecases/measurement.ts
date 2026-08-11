import {
  measurementEntrySchema,
  type EventSource,
  type JsonObject,
  type MeasurementEntry,
  type StoredMedia,
} from '@murphai/contracts'
import { loadJsonInputObject } from '../json-input.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveMetricDefinition } from '@murphai/health-metrics'
import {
  compactObject,
  normalizeOptionalText,
  toEventUpsertVaultCliError,
} from './vault-usecase-helpers.js'
import {
  type MeasurementDraftInput,
  loadWorkoutCoreRuntime,
} from './workout-core.js'

interface MeasurementPayloadInput {
  occurredAt?: string
  title?: string
  note?: string
  measurements?: MeasurementEntry[]
  media?: StoredMedia[]
  rawRefs?: string[]
  source?: EventSource
  tags?: string[]
  relatedIds?: string[]
  externalRef?: JsonObject
  links?: unknown
  timeZone?: string
}

export interface AddMeasurementInput {
  vault: string
  metric?: string
  value?: number
  unit?: string
  qualifiers?: Record<string, string | number | boolean>
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

export function normalizeMetricSlug(value: string, fieldName = 'metric'): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/gu, '-')
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)) {
    throw new VaultCliError(
      'invalid_option',
      `${fieldName} must resolve to a lowercase kebab-case slug.`,
    )
  }

  return normalized
}

function normalizeQualifierMap(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const qualifierEntries: Array<[string, string | number | boolean]> = []
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeMetricSlug(rawKey, 'qualifier key')
    if (typeof rawValue === 'string') {
      const normalizedValue = normalizeOptionalText(rawValue)
      if (normalizedValue) {
        qualifierEntries.push([key, normalizedValue])
      }
      continue
    }

    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      qualifierEntries.push([key, rawValue])
    }
  }

  const qualifiers = Object.fromEntries(qualifierEntries)

  return Object.keys(qualifiers).length > 0 ? qualifiers : undefined
}

export function normalizeMeasurementEntry(value: unknown, fieldName = 'measurement'): MeasurementEntry {
  const candidate = asJsonObject(value)

  const parsed = measurementEntrySchema.safeParse(
    candidate
      ? compactObject({
          ...candidate,
          metric:
            typeof candidate.metric === 'string'
              ? resolveMetricDefinition(candidate.metric)?.key
                ?? normalizeMetricSlug(candidate.metric, `${fieldName}.metric`)
              : candidate.metric,
          qualifiers: normalizeQualifierMap(candidate.qualifiers),
          note:
            typeof candidate.note === 'string'
              ? normalizeOptionalText(candidate.note) ?? undefined
              : candidate.note,
        })
      : value,
  )

  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `${fieldName} is not a valid measurement entry. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return parsed.data
}

function humanizeMetricSlug(metric: string): string {
  return metric
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(' ')
}

function buildMeasurementTitle(measurements: readonly MeasurementEntry[]): string {
  if (measurements.length === 1) {
    const entry = measurements[0]!
    const side = typeof entry.qualifiers?.side === 'string' ? entry.qualifiers.side : null
    return side
      ? `${humanizeMetricSlug(entry.metric)} (${side})`
      : humanizeMetricSlug(entry.metric)
  }

  return 'Measurement check-in'
}

async function loadStructuredMeasurementPayload(inputFile: string): Promise<MeasurementPayloadInput> {
  const payload = await loadJsonInputObject(inputFile, 'measurement payload')

  if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
    throw new VaultCliError(
      'invalid_payload',
      'Structured measurement payloads cannot set attachments[]. Use --media <path> to stage measurement files.',
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

export function buildMeasurementEventDraft(input: {
  payload?: MeasurementPayloadInput
  occurredAt?: string
  title?: string
  note?: string
  measurements: MeasurementEntry[]
  source?: AddMeasurementInput['source']
}): MeasurementDraftInput {
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
  }) as MeasurementDraftInput
}

export async function addMeasurementDraftRecord(input: {
  vault: string
  draft: MeasurementDraftInput
  mediaPaths?: string[]
}) {
  const mediaPaths = Array.isArray(input.mediaPaths)
    ? input.mediaPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const core = await loadWorkoutCoreRuntime()

  try {
    const result = await core.addMeasurement({
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
      kind: 'measurement' as const,
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

export async function addMeasurementRecord(input: AddMeasurementInput) {
  const structuredPayload = typeof input.inputFile === 'string'
    ? await loadStructuredMeasurementPayload(input.inputFile)
    : undefined

  const measurements = structuredPayload?.measurements ?? (() => {
    if (typeof input.metric !== 'string' || normalizeOptionalText(input.metric) === null) {
      throw new VaultCliError(
        'invalid_option',
        'Measurement metric is required unless --input supplies a structured measurements array.',
      )
    }

    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      throw new VaultCliError('invalid_option', 'Measurement value must be a finite number.')
    }

    if (typeof input.unit !== 'string' || normalizeOptionalText(input.unit) === null) {
      throw new VaultCliError('invalid_option', 'Measurement unit is required unless --input supplies it.')
    }

    return [normalizeMeasurementEntry({
      metric: input.metric,
      value: input.value,
      unit: input.unit,
      qualifiers: input.qualifiers,
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

  return addMeasurementDraftRecord({
    vault: input.vault,
    draft,
    mediaPaths: input.mediaPaths,
  })
}
