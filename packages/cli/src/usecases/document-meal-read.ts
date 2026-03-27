import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { rawImportManifestSchema, type RawImportManifest } from '@murph/contracts'
import { z } from 'incur'
import {
  firstString,
  isJsonObject,
  loadQueryRuntime,
  toOwnedEventCommandShowEntity,
  type QueryRecord,
} from '../commands/query-record-command-helpers.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { pathSchema } from '../vault-cli-contracts.js'
import {
  deleteEventRecord,
  editEventRecord,
} from './event-record-mutations.js'
import { asListEnvelope } from './shared.js'

type DocumentMealKind = 'document' | 'meal'

const DEFAULT_LIST_LIMIT = 50
const OWNED_EVENT_LINK_KEYS = ['relatedIds', 'eventIds']

export const documentLookupSchema = z
  .string()
  .regex(
    /^(?:doc_|evt_).+/u,
    'Expected a document id (`doc_*`) or event id (`evt_*`).',
  )
  .describe('Document id (`doc_*`) or event lookup id (`evt_*`).')

export const mealLookupSchema = z
  .string()
  .regex(
    /^(?:meal_|evt_).+/u,
    'Expected a meal id (`meal_*`) or event id (`evt_*`).',
  )
  .describe('Meal id (`meal_*`) or event lookup id (`evt_*`).')

export const rawImportManifestResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.string().min(1),
  manifestFile: pathSchema,
  manifest: rawImportManifestSchema,
})

export type RawImportManifestResult = z.infer<
  typeof rawImportManifestResultSchema
>

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

function resolveManifestArtifactPaths(record: QueryRecord): string[] {
  const documentPath = firstString(record.data, ['documentPath', 'document_path'])

  return uniqueStrings([
    ...stringArray(record.data.rawRefs),
    ...(documentPath ? [documentPath] : []),
    ...stringArray(record.data.photoPaths),
    ...stringArray(record.data.photo_paths),
    ...stringArray(record.data.audioPaths),
    ...stringArray(record.data.audio_paths),
  ])
}

function resolveManifestFile(record: QueryRecord, expectedKind: DocumentMealKind): string {
  const artifactPaths = resolveManifestArtifactPaths(record)

  if (artifactPaths.length === 0) {
    throw new VaultCliError(
      'manifest_missing',
      `No raw import manifest is associated with ${expectedKind} "${record.displayId}".`,
    )
  }

  const directories = uniqueStrings(
    artifactPaths.map((artifactPath) => path.posix.dirname(artifactPath)),
  )

  if (directories.length !== 1) {
    throw new VaultCliError(
      'manifest_invalid',
      `Raw artifacts for ${expectedKind} "${record.displayId}" do not resolve to a single manifest directory.`,
      {
        artifactPaths,
      },
    )
  }

  return path.posix.join(directories[0], 'manifest.json')
}

async function loadOwnedRecord(
  vault: string,
  lookup: string,
  expectedKind: DocumentMealKind,
): Promise<QueryRecord> {
  const query = await loadQueryRuntime('document/meal query reads')
  const readModel = await query.readVault(vault)
  const record = query.lookupRecordById(readModel, lookup)

  if (!record || record.recordType !== 'event' || record.kind !== expectedKind) {
    throw new VaultCliError('not_found', `No ${expectedKind} found for "${lookup}".`)
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

async function showOwnedRecord(
  vault: string,
  lookup: string,
  expectedKind: DocumentMealKind,
) {
  const record = await loadOwnedRecord(vault, lookup, expectedKind)

  return {
    vault,
    entity: toOwnedEventCommandShowEntity(record, OWNED_EVENT_LINK_KEYS),
  }
}

async function listOwnedRecords(input: {
  vault: string
  expectedKind: DocumentMealKind
  from?: string
  to?: string
}) {
  const query = await loadQueryRuntime('document/meal query reads')
  const readModel = await query.readVault(input.vault)
  const items = query
    .listRecords(readModel, {
      recordTypes: ['event'],
      kinds: [input.expectedKind],
      from: input.from,
      to: input.to,
    })
    .slice(0, DEFAULT_LIST_LIMIT)
    .map((record: QueryRecord) => toOwnedEventCommandShowEntity(record, OWNED_EVENT_LINK_KEYS))

  return asListEnvelope(input.vault, {
    kind: input.expectedKind,
    from: input.from,
    to: input.to,
    limit: DEFAULT_LIST_LIMIT,
  }, items)
}

async function showOwnedManifest(
  vault: string,
  lookup: string,
  expectedKind: DocumentMealKind,
) {
  const record = await loadOwnedRecord(vault, lookup, expectedKind)
  const manifestFile = resolveManifestFile(record, expectedKind)
  const manifest = await readImportManifest(vault, manifestFile)

  return {
    vault,
    entityId: record.displayId,
    lookupId: record.primaryLookupId,
    kind: expectedKind,
    manifestFile,
    manifest,
  }
}

export async function showDocumentRecord(vault: string, lookup: string) {
  return showOwnedRecord(vault, lookup, 'document')
}

export async function listDocumentRecords(input: {
  vault: string
  from?: string
  to?: string
}) {
  return listOwnedRecords({
    vault: input.vault,
    expectedKind: 'document',
    from: input.from,
    to: input.to,
  })
}

export async function showDocumentManifest(vault: string, lookup: string) {
  return showOwnedManifest(vault, lookup, 'document')
}

export async function showMealRecord(vault: string, lookup: string) {
  return showOwnedRecord(vault, lookup, 'meal')
}

export async function listMealRecords(input: {
  vault: string
  from?: string
  to?: string
}) {
  return listOwnedRecords({
    vault: input.vault,
    expectedKind: 'meal',
    from: input.from,
    to: input.to,
  })
}

export async function showMealManifest(vault: string, lookup: string) {
  return showOwnedManifest(vault, lookup, 'meal')
}

export async function editDocumentRecord(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
  dayKeyPolicy?: 'keep' | 'recompute'
}) {
  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'document',
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    dayKeyPolicy: input.dayKeyPolicy,
    expectedKinds: ['document'],
  })

  return showDocumentRecord(input.vault, result.lookupId)
}

export async function deleteDocumentRecord(input: {
  vault: string
  lookup: string
}) {
  return deleteEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'document',
    expectedKinds: ['document'],
  })
}

export async function editMealRecord(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
  dayKeyPolicy?: 'keep' | 'recompute'
}) {
  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'meal',
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    dayKeyPolicy: input.dayKeyPolicy,
    expectedKinds: ['meal'],
  })

  return showMealRecord(input.vault, result.lookupId)
}

export async function deleteMealRecord(input: {
  vault: string
  lookup: string
}) {
  return deleteEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'meal',
    expectedKinds: ['meal'],
  })
}
