import path from 'node:path'
import {
  bodyMeasurementEntrySchema,
  eventSourceSchema,
  measurementEntrySchema,
  rawImportManifestSchema,
  type MeasurementEntry,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
  loadQueryRuntime,
  toCommandShowEntity,
  type QueryRecord,
} from '../commands/query-record-command-helpers.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isoTimestampSchema,
  localDateSchema,
  pathSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  asListEnvelope,
  readRawImportManifest,
  resolveRawImportManifestFile,
  toListEntity,
} from './shared.js'
import {
  relativePathEntries,
  relativePathStrings,
} from './vault-usecase-helpers.js'
import {
  normalizeMetricSlug,
} from './measurement.js'

const DEFAULT_LIST_LIMIT = 50
const TRACKED_MEASUREMENT_EVENT_KINDS = ['measurement', 'body_measurement'] as const
const MEASUREMENT_ENTRY_RECORD_KINDS = [
  ...TRACKED_MEASUREMENT_EVENT_KINDS,
  'observation',
] as const
const measurementEntryRecordKindSchema = z.enum(MEASUREMENT_ENTRY_RECORD_KINDS)

type TrackedMeasurementEventKind = (typeof TRACKED_MEASUREMENT_EVENT_KINDS)[number]

export const measurementLookupSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical measurement event id in evt_* form.')
  .describe('Canonical measurement event id such as evt_<ULID>.')

export const measurementImportManifestResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.enum(TRACKED_MEASUREMENT_EVENT_KINDS),
  manifestFile: pathSchema,
  manifest: rawImportManifestSchema,
})

export const measurementEntryListItemSchema = measurementEntrySchema.extend({
  eventId: measurementLookupSchema,
  recordKind: measurementEntryRecordKindSchema,
  measurementIndex: z.number().int().nonnegative().nullable(),
  occurredAt: isoTimestampSchema,
  source: eventSourceSchema.nullable(),
})

export const measurementEntryListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    metric: z.array(slugSchema).min(1),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    limit: z.number().int().positive().max(DEFAULT_LIST_LIMIT * 4),
  }),
  items: z.array(measurementEntryListItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.null(),
})

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

async function resolveManifestFile(
  vault: string,
  record: QueryRecord,
): Promise<string> {
  const rawRefs = uniqueStrings([
    ...relativePathEntries(record.attributes.attachments),
    ...relativePathStrings(record.attributes.rawRefs),
    ...relativePathEntries(record.attributes.media),
  ])

  if (rawRefs.length === 0) {
    throw new VaultCliError(
      'manifest_missing',
      `No raw import manifest is associated with measurement record "${record.entityId}".`,
    )
  }

  const directories = uniqueStrings(rawRefs.map((rawRef) => path.posix.dirname(rawRef)))
  if (directories.length !== 1) {
    throw new VaultCliError(
      'manifest_invalid',
      `Measurement record "${record.entityId}" references raw artifacts in multiple directories.`,
      { rawRefs },
    )
  }

  return resolveRawImportManifestFile(vault, directories[0]!)
}

async function loadTrackedMeasurementRecord(
  vault: string,
  lookup: string,
  allowedKinds: readonly TrackedMeasurementEventKind[],
  label: string,
): Promise<QueryRecord> {
  const query = await loadQueryRuntime(`${label} query reads`)
  const readModel = await query.readVault(vault)
  const record = query.lookupEntityById(readModel, lookup)

  if (!record || record.family !== 'event' || !allowedKinds.includes(record.kind as TrackedMeasurementEventKind)) {
    throw new VaultCliError('not_found', `No ${label} found for "${lookup}".`)
  }

  return record
}

export async function showMeasurementRecord(vault: string, lookup: string) {
  const record = await loadTrackedMeasurementRecord(vault, lookup, TRACKED_MEASUREMENT_EVENT_KINDS, 'measurement')

  return {
    vault,
    entity: toCommandShowEntity(record),
  }
}

export async function listMeasurementRecords(input: {
  vault: string
  from?: string
  to?: string
  limit?: number
}) {
  const query = await loadQueryRuntime('measurement query reads')
  const readModel = await query.readVault(input.vault)
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(DEFAULT_LIST_LIMIT * 4, Math.round(input.limit)))
      : DEFAULT_LIST_LIMIT
  const items = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: [...TRACKED_MEASUREMENT_EVENT_KINDS],
      from: input.from,
      to: input.to,
    })
    .slice(0, limit)
    .map((record: QueryRecord) => toListEntity(toCommandShowEntity(record)))

  return asListEnvelope(input.vault, {
    kind: 'measurement',
    from: input.from,
    to: input.to,
    limit,
  }, items)
}

export async function listMeasurementEntries(input: {
  vault: string
  metrics: readonly string[]
  from?: string
  to?: string
  limit?: number
}) {
  const query = await loadQueryRuntime('measurement entry query reads')
  const metrics = [
    ...new Set(
      input.metrics.map((metric, index) =>
        normalizeMetricSlug(metric, `metric[${index}]`),
      ),
    ),
  ]
  if (metrics.length === 0) {
    throw new VaultCliError(
      'invalid_option',
      'measurement entry list requires at least one metric filter.',
    )
  }
  const metricSet = new Set(metrics)
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(DEFAULT_LIST_LIMIT * 4, Math.round(input.limit)))
      : DEFAULT_LIST_LIMIT
  const [readModel, observationEntries] = await Promise.all([
    query.readVault(input.vault),
    query.listCanonicalObservationMetricEntries(input.vault, {
      from: input.from,
      metrics,
      to: input.to,
      limit: null,
    }),
  ])
  const measurementItems = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: [...TRACKED_MEASUREMENT_EVENT_KINDS],
      from: input.from,
      to: input.to,
    })
    .flatMap((record: QueryRecord) => {
      if (!record.occurredAt) {
        return []
      }

      const parsedRecordKind = measurementEntryRecordKindSchema.safeParse(record.kind)
      if (!parsedRecordKind.success) {
        throw new VaultCliError(
          'invalid_payload',
          `Event "${record.entityId}" is not a supported scalar measurement record.`,
        )
      }
      const recordKind = parsedRecordKind.data
      const occurredAt = record.occurredAt
      const parsedSource = eventSourceSchema.safeParse(record.attributes.source)
      const rawEntries = Array.isArray(record.attributes.measurements)
        ? record.attributes.measurements
        : []
      return rawEntries.flatMap((rawEntry, entryIndex) => {
        let entry: MeasurementEntry
        if (recordKind === 'body_measurement') {
          const parsedEntry = bodyMeasurementEntrySchema.safeParse(rawEntry)
          if (!parsedEntry.success) {
            throw new VaultCliError(
              'invalid_payload',
              `Measurement "${record.entityId}" entry ${entryIndex} is not a valid canonical body-measurement entry.`,
            )
          }
          entry = {
            metric: normalizeMetricSlug(parsedEntry.data.type),
            value: parsedEntry.data.value,
            unit: parsedEntry.data.unit,
            ...(parsedEntry.data.note ? { note: parsedEntry.data.note } : {}),
          }
        } else {
          const parsedEntry = measurementEntrySchema.safeParse(rawEntry)
          if (!parsedEntry.success) {
            throw new VaultCliError(
              'invalid_payload',
              `Measurement "${record.entityId}" entry ${entryIndex} is not a valid canonical measurement entry.`,
            )
          }
          entry = parsedEntry.data
        }
        if (!metricSet.has(entry.metric)) {
          return []
        }

        return [{
          eventId: record.entityId,
          recordKind,
          measurementIndex: entryIndex,
          occurredAt,
          source: parsedSource.success ? parsedSource.data : null,
          ...entry,
        }]
      })
    })
  const observationItems = observationEntries.map((entry) => {
    const parsedSource = eventSourceSchema.safeParse(entry.source)
    return {
      eventId: entry.eventId,
      recordKind: 'observation' as const,
      measurementIndex: null,
      occurredAt: entry.occurredAt,
      source: parsedSource.success ? parsedSource.data : null,
      metric: entry.metric,
      value: entry.value,
      unit: entry.unit,
    }
  })
  const items = [...measurementItems, ...observationItems]
    .sort((left, right) => {
      const occurredAtOrder = Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      if (occurredAtOrder !== 0) {
        return occurredAtOrder
      }

      const eventOrder = left.eventId.localeCompare(right.eventId)
      return eventOrder !== 0
        ? eventOrder
        : (left.measurementIndex ?? -1) - (right.measurementIndex ?? -1)
    })
    .slice(0, limit)

  return measurementEntryListResultSchema.parse(
    asListEnvelope(input.vault, {
      metric: metrics,
      from: input.from,
      to: input.to,
      limit,
    }, items),
  )
}

export async function showMeasurementManifest(vault: string, lookup: string) {
  const record = await loadTrackedMeasurementRecord(vault, lookup, TRACKED_MEASUREMENT_EVENT_KINDS, 'measurement')
  const manifestFile = await resolveManifestFile(vault, record)
  const manifest = await readRawImportManifest(vault, manifestFile)

  return {
    vault,
    entityId: record.entityId,
    lookupId: record.primaryLookupId,
    kind: record.kind as TrackedMeasurementEventKind,
    manifestFile,
    manifest,
  }
}
