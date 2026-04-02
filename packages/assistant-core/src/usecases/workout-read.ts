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

export const workoutLookupSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical workout event id in evt_* form.')
  .describe('Canonical workout event id such as evt_<ULID>.')

export const workoutImportManifestResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.literal('activity_session'),
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

function resolveManifestFile(record: QueryRecord): string {
  const rawRefs = uniqueStrings(stringArray(record.attributes.rawRefs))

  if (rawRefs.length === 0) {
    throw new VaultCliError(
      'manifest_missing',
      `No raw import manifest is associated with workout "${record.entityId}".`,
    )
  }

  const directories = uniqueStrings(rawRefs.map((rawRef) => path.posix.dirname(rawRef)))
  if (directories.length !== 1) {
    throw new VaultCliError(
      'manifest_invalid',
      `Workout "${record.entityId}" references raw artifacts in multiple directories.`,
      { rawRefs },
    )
  }

  return path.posix.join(directories[0]!, 'manifest.json')
}

async function loadWorkoutRecord(vault: string, lookup: string): Promise<QueryRecord> {
  const query = await loadQueryRuntime('workout query reads')
  const readModel = await query.readVault(vault)
  const record = query.lookupEntityById(readModel, lookup)

  if (!record || record.family !== 'event' || record.kind !== 'activity_session') {
    throw new VaultCliError('not_found', `No workout found for "${lookup}".`)
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

export async function showWorkoutRecord(vault: string, lookup: string) {
  const record = await loadWorkoutRecord(vault, lookup)

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
  const query = await loadQueryRuntime('workout query reads')
  const readModel = await query.readVault(input.vault)
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(DEFAULT_LIST_LIMIT * 4, Math.round(input.limit)))
      : DEFAULT_LIST_LIMIT
  const items = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: ['activity_session'],
      from: input.from,
      to: input.to,
    })
    .slice(0, limit)
    .map((record: QueryRecord) => toCommandShowEntity(record))

  return asListEnvelope(input.vault, {
    kind: 'activity_session',
    from: input.from,
    to: input.to,
    limit,
  }, items)
}

export async function showWorkoutManifest(vault: string, lookup: string) {
  const record = await loadWorkoutRecord(vault, lookup)
  const manifestFile = resolveManifestFile(record)
  const manifest = await readImportManifest(vault, manifestFile)

  return {
    vault,
    entityId: record.entityId,
    lookupId: record.primaryLookupId,
    kind: 'activity_session' as const,
    manifestFile,
    manifest,
  }
}
