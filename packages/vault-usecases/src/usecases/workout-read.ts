import path from 'node:path'
import { rawImportManifestSchema } from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
  isJsonObject,
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

const DEFAULT_LIST_LIMIT = 5
const MAX_LIST_LIMIT = 200
const TRACKED_WORKOUT_EVENT_KINDS = ['activity_session', 'body_measurement'] as const

type TrackedWorkoutEventKind = (typeof TRACKED_WORKOUT_EVENT_KINDS)[number]

export const workoutLookupSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical workout event id in evt_* form.')
  .describe('Canonical workout event id such as evt_<ULID>.')

export const workoutImportManifestResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.enum(TRACKED_WORKOUT_EVENT_KINDS),
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
  const workoutAttributes = isJsonObject(record.attributes.workout) ? record.attributes.workout : null
  const rawRefs = uniqueStrings([
    ...relativePathEntries(record.attributes.attachments),
    ...relativePathStrings(record.attributes.rawRefs),
    ...relativePathEntries(record.attributes.media),
    ...relativePathEntries(workoutAttributes?.media),
  ])

  if (rawRefs.length === 0) {
    throw new VaultCliError(
      'manifest_missing',
      `No raw import manifest is associated with workout record "${record.entityId}".`,
    )
  }

  const directories = uniqueStrings(rawRefs.map((rawRef) => path.posix.dirname(rawRef)))
  if (directories.length !== 1) {
    throw new VaultCliError(
      'manifest_invalid',
      `Workout record "${record.entityId}" references raw artifacts in multiple directories.`,
      { rawRefs },
    )
  }

  return resolveRawImportManifestFile(vault, directories[0]!)
}

async function loadTrackedWorkoutRecord(
  vault: string,
  lookup: string,
  allowedKinds: readonly TrackedWorkoutEventKind[],
  label: string,
): Promise<QueryRecord> {
  const query = await loadQueryRuntime(`${label} query reads`)
  const readModel = await query.readVault(vault)
  const record = query.lookupEntityById(readModel, lookup)

  if (!record || record.family !== 'event' || !allowedKinds.includes(record.kind as TrackedWorkoutEventKind)) {
    throw new VaultCliError('not_found', `No ${label} found for "${lookup}".`)
  }

  return record
}

async function listTrackedWorkoutRecords(input: {
  vault: string
  from?: string
  to?: string
  limit?: number
  kinds: readonly TrackedWorkoutEventKind[]
}) {
  const query = await loadQueryRuntime('workout query reads')
  const readModel = await query.readVault(input.vault)
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(MAX_LIST_LIMIT, Math.round(input.limit)))
      : DEFAULT_LIST_LIMIT
  const items = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: [...input.kinds],
      from: input.from,
      to: input.to,
    })
    .slice(0, limit)
    .map((record: QueryRecord) => {
      const entity = toCommandShowEntity(record)
      return toListEntity(entity)
    })

  return asListEnvelope(input.vault, {
    kind: input.kinds.length === 1 ? input.kinds[0] : 'workout_event',
    from: input.from,
    to: input.to,
    limit,
  }, items)
}

async function showTrackedWorkoutManifest(
  vault: string,
  lookup: string,
  allowedKinds: readonly TrackedWorkoutEventKind[],
  label: string,
) {
  const record = await loadTrackedWorkoutRecord(vault, lookup, allowedKinds, label)
  const manifestFile = await resolveManifestFile(vault, record)
  const manifest = await readRawImportManifest(vault, manifestFile)

  return {
    vault,
    entityId: record.entityId,
    lookupId: record.primaryLookupId,
    kind: record.kind as TrackedWorkoutEventKind,
    manifestFile,
    manifest,
  }
}

export async function showWorkoutRecord(vault: string, lookup: string) {
  const record = await loadTrackedWorkoutRecord(vault, lookup, ['activity_session'], 'workout')

  return {
    vault,
    entity: toCommandShowEntity(record),
  }
}

export async function listWorkoutRecords(input: {
  vault: string
  from?: string
  to?: string
  limit?: number
}) {
  return listTrackedWorkoutRecords({
    ...input,
    kinds: ['activity_session'],
  })
}

export async function showWorkoutManifest(vault: string, lookup: string) {
  return showTrackedWorkoutManifest(vault, lookup, ['activity_session'], 'workout')
}
