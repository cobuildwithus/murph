import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { rawImportManifestSchema, type RawImportManifest } from '@murphai/contracts'
import { z } from 'zod'
import {
  isJsonObject,
  loadQueryRuntime,
  toCommandShowEntity,
  type QueryRecord,
} from '../commands/query-record-command-helpers.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { pathSchema } from '../vault-cli-contracts.js'
import { asListEnvelope } from './shared.js'

const DEFAULT_LIST_LIMIT = 50
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

function mediaRelativePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.relativePath !== 'string') {
      return []
    }

    return entry.relativePath.trim().length > 0 ? [entry.relativePath] : []
  })
}

function resolveManifestFile(record: QueryRecord): string {
  const workoutAttributes = isJsonObject(record.attributes.workout) ? record.attributes.workout : null
  const rawRefs = uniqueStrings([
    ...stringArray(record.attributes.rawRefs),
    ...mediaRelativePaths(record.attributes.media),
    ...mediaRelativePaths(workoutAttributes?.media),
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

  return path.posix.join(directories[0]!, 'manifest.json')
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

async function readImportManifest(
  vault: string,
  manifestFile: string,
): Promise<RawImportManifest> {
  const manifestPath = path.join(vault, ...manifestFile.split('/'))
  let manifestText: string

  try {
    manifestText = await readFile(manifestPath, 'utf8')
  } catch (error) {
    throw new VaultCliError(
      'manifest_missing',
      `Manifest file "${manifestFile}" is missing from the vault.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  let manifest: unknown

  try {
    manifest = JSON.parse(manifestText)
  } catch (error) {
    throw new VaultCliError(
      'manifest_invalid',
      `Manifest file "${manifestFile}" is not valid JSON.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  if (!isJsonObject(manifest)) {
    throw new VaultCliError(
      'manifest_invalid',
      `Manifest file "${manifestFile}" must contain a JSON object.`,
    )
  }

  try {
    return rawImportManifestSchema.parse(manifest)
  } catch (error) {
    throw new VaultCliError(
      'manifest_invalid',
      `Manifest file "${manifestFile}" does not match the raw import manifest contract.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }
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
      ? Math.max(1, Math.min(DEFAULT_LIST_LIMIT * 4, Math.round(input.limit)))
      : DEFAULT_LIST_LIMIT
  const items = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: [...input.kinds],
      from: input.from,
      to: input.to,
    })
    .slice(0, limit)
    .map((record: QueryRecord) => toCommandShowEntity(record))

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
  const manifestFile = resolveManifestFile(record)
  const manifest = await readImportManifest(vault, manifestFile)

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

export async function showWorkoutMeasurementRecord(vault: string, lookup: string) {
  const record = await loadTrackedWorkoutRecord(vault, lookup, ['body_measurement'], 'body measurement')

  return {
    vault,
    entity: toCommandShowEntity(record),
  }
}

export async function listWorkoutMeasurementRecords(input: {
  vault: string
  from?: string
  to?: string
  limit?: number
}) {
  return listTrackedWorkoutRecords({
    ...input,
    kinds: ['body_measurement'],
  })
}

export async function showWorkoutMeasurementManifest(vault: string, lookup: string) {
  return showTrackedWorkoutManifest(vault, lookup, ['body_measurement'], 'body measurement')
}
