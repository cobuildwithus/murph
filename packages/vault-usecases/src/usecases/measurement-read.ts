import path from 'node:path'
import { rawImportManifestSchema } from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
  loadQueryRuntime,
  toCommandShowEntity,
  type QueryRecord,
} from '../commands/query-record-command-helpers.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'
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

const DEFAULT_LIST_LIMIT = 50
const TRACKED_MEASUREMENT_EVENT_KINDS = ['measurement', 'body_measurement'] as const

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
