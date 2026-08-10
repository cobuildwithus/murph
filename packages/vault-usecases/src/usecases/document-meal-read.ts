import path from 'node:path'
import { rawImportManifestSchema } from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
  firstString,
  loadQueryRuntime,
  toOwnedEventCommandShowEntity,
  type QueryRecord,
} from '../commands/query-record-command-helpers.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'
import {
  normalizeOptionalRelativePath,
  relativePathEntries,
  relativePathStrings,
} from './vault-usecase-helpers.js'
import {
  deleteEventRecord,
  editEventRecord,
  removeAutomaticMealPhotoEventRecord,
} from './event-record-mutations.js'
import {
  asListEnvelope,
  readRawImportManifest,
  resolveRawImportManifestFile,
  toListEntity,
} from './shared.js'

type DocumentMealKind = 'document' | 'meal'

const DEFAULT_LIST_LIMIT = 10
const OWNED_EVENT_LINK_KEYS: string[] = []

export const documentLookupSchema = z
  .string()
  .regex(
    /^doc_.+/u,
    'Expected a document id (`doc_*`).',
  )
  .describe('Document id (`doc_*`).')

export const mealLookupSchema = z
  .string()
  .regex(
    /^meal_.+/u,
    'Expected a meal id (`meal_*`).',
  )
  .describe('Meal id (`meal_*`).')

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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

function resolveManifestArtifactPaths(record: QueryRecord): string[] {
  const documentPath = normalizeOptionalRelativePath(
    firstString(record.attributes, ['documentPath', 'document_path']),
  )

  return uniqueStrings([
    ...relativePathEntries(record.attributes.attachments),
    ...relativePathStrings(record.attributes.rawRefs),
    ...(documentPath ? [documentPath] : []),
    ...relativePathStrings(record.attributes.photoPaths),
    ...relativePathStrings(record.attributes.photo_paths),
    ...relativePathStrings(record.attributes.audioPaths),
    ...relativePathStrings(record.attributes.audio_paths),
  ])
}

async function resolveManifestFile(
  vault: string,
  record: QueryRecord,
  expectedKind: DocumentMealKind,
): Promise<string> {
  const artifactPaths = resolveManifestArtifactPaths(record)

  if (artifactPaths.length === 0) {
    throw new VaultCliError(
      'manifest_missing',
      `No raw import manifest is associated with ${expectedKind} "${record.entityId}".`,
    )
  }

  const directories = uniqueStrings(
    artifactPaths.map((artifactPath) => path.posix.dirname(artifactPath)),
  )

  if (directories.length !== 1) {
    throw new VaultCliError(
      'manifest_invalid',
      `Raw artifacts for ${expectedKind} "${record.entityId}" do not resolve to a single manifest directory.`,
      {
        artifactPaths,
      },
    )
  }

  return resolveRawImportManifestFile(vault, directories[0]!)
}

async function loadOwnedRecord(
  vault: string,
  lookup: string,
  expectedKind: DocumentMealKind,
): Promise<QueryRecord> {
  const query = await loadQueryRuntime('document/meal query reads')
  const readModel = await query.readVault(vault)
  const record = query.lookupEntityById(readModel, lookup)

  if (!record || record.family !== 'event' || record.kind !== expectedKind) {
    throw new VaultCliError('not_found', `No ${expectedKind} found for "${lookup}".`)
  }

  const normalizedLookup = lookup.trim()
  if (normalizedLookup !== record.entityId && normalizedLookup !== record.primaryLookupId) {
    throw new VaultCliError('not_found', `No ${expectedKind} found for "${lookup}".`)
  }

  return record
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
  limit?: number
  to?: string
}) {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT
  const query = await loadQueryRuntime('document/meal query reads')
  const readModel = await query.readVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: [input.expectedKind],
      from: input.from,
      to: input.to,
    })
    .slice(0, limit)
    .map((record: QueryRecord) => {
      const entity = toOwnedEventCommandShowEntity(record, OWNED_EVENT_LINK_KEYS)
      return toListEntity(entity)
    })

  return asListEnvelope(input.vault, {
    kind: input.expectedKind,
    from: input.from,
    to: input.to,
    limit,
  }, items)
}

export async function listAutomaticMealPhotoCloseoutWorkRecords(input: {
  limit?: number
  occurrenceAt: string
  to?: string
  vault: string
}) {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT
  const occurrenceAt = new Date(input.occurrenceAt)
  if (Number.isNaN(occurrenceAt.getTime())) {
    throw new VaultCliError(
      'invalid_option',
      '--occurrence-at must be a valid ISO timestamp.',
    )
  }
  const occurrenceTime = occurrenceAt.getTime()
  const query = await loadQueryRuntime('automatic meal photo closeout reads')
  const readModel = await query.readVault(input.vault)
  const automaticCaptures = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: ['meal'],
      to: input.to,
    })
    .filter(isAutomaticMealCapture)
  const retryEvidence = automaticCaptures.filter(
    (record) => readTimestamp(record.attributes.recordedAt) >= occurrenceTime,
  )
  const retryEvidenceIds = new Set(
    retryEvidence.map((record) => record.entityId),
  )
  const pending = automaticCaptures.filter(
    (record) =>
      !retryEvidenceIds.has(record.entityId)
      && hasRetainedMealPhoto(record),
  )
  const items = [...retryEvidence, ...pending]
    .slice(0, limit)
    .map((record: QueryRecord) => {
      const entity = toOwnedEventCommandShowEntity(record, OWNED_EVENT_LINK_KEYS)
      return toListEntity(entity)
    })

  return asListEnvelope(input.vault, {
    kind: 'meal',
    limit,
    to: input.to,
  }, items)
}

function isAutomaticMealCapture(record: QueryRecord): boolean {
  const externalRef = readObject(record.attributes.externalRef)
  return externalRef?.system === 'meal-photo-capture'
    && externalRef.resourceType === 'photo'
}

function hasRetainedMealPhoto(record: QueryRecord): boolean {
  const attachments = record.attributes.attachments
  return Array.isArray(attachments) && attachments.some((attachment) => {
    const value = readObject(attachment)
    return value?.kind === 'photo' && value.role === 'photo'
  })
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readTimestamp(value: unknown): number {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

async function showOwnedManifest(
  vault: string,
  lookup: string,
  expectedKind: DocumentMealKind,
) {
  const record = await loadOwnedRecord(vault, lookup, expectedKind)
  const manifestFile = await resolveManifestFile(vault, record, expectedKind)
  const manifest = await readRawImportManifest(vault, manifestFile)

  return {
    vault,
    entityId: record.entityId,
    lookupId: record.entityId,
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
  limit?: number
  to?: string
}) {
  return listOwnedRecords({
    vault: input.vault,
    expectedKind: 'document',
    from: input.from,
    limit: input.limit,
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
  limit?: number
  to?: string
}) {
  return listOwnedRecords({
    vault: input.vault,
    expectedKind: 'meal',
    from: input.from,
    limit: input.limit,
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

  return showDocumentRecord(input.vault, input.lookup)
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

  return showMealRecord(input.vault, input.lookup)
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

export async function removeAutomaticMealPhotoRecord(input: {
  vault: string
  lookup: string
}) {
  await removeAutomaticMealPhotoEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'meal',
    expectedKinds: ['meal'],
  })

  return showMealRecord(input.vault, input.lookup)
}
