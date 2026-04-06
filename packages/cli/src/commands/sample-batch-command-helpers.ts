import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  applyLimit,
  arrayOfStrings,
  asObject,
  compareNullableDates,
  firstString,
  isJsonObject,
  isMissingPathError,
  matchesDateRange,
  nullableString,
  numberOrNull,
  readJsonObject,
} from '@murphai/vault-inbox/commands/query-record-command-helpers'

type JsonObject = Record<string, unknown>

interface SampleBatchManifest {
  importId?: string
  importedAt?: string
  source?: string | null
  rawDirectory?: string
  provenance?: JsonObject
  artifacts?: unknown[]
}

export interface SampleBatchDetails {
  batchId: string
  stream: string | null
  manifestFile: string
  rawDirectory: string | null
  importedAt: string | null
  source: string | null
  importedCount: number | null
  sampleIds: string[]
  importConfig: JsonObject
  artifacts: JsonObject[]
  manifest: JsonObject
}

export interface SampleBatchListOptions {
  from?: string
  to?: string
  limit?: number
  stream?: string
}

export async function showSampleBatch(
  vaultRoot: string,
  batchId: string,
): Promise<SampleBatchDetails> {
  const details = await findSampleBatch(vaultRoot, batchId)

  if (!details) {
    throw new VaultCliError('not_found', `No sample batch found for "${batchId}".`)
  }

  return details
}

export async function listSampleBatches(
  vaultRoot: string,
  options: SampleBatchListOptions = {},
): Promise<SampleBatchDetails[]> {
  const manifestFiles = await walkSampleManifestFiles(vaultRoot)
  const batches = (
    await Promise.all(
      manifestFiles.map((manifestFile) => readSampleBatchManifest(vaultRoot, manifestFile)),
    )
  )
    .filter((batch): batch is SampleBatchDetails => batch !== null)
    .filter((batch) => (options.stream ? batch.stream === options.stream : true))
    .filter((batch) => matchesDateRange(batch.importedAt, options.from, options.to))
    .sort((left, right) => compareNullableDates(right.importedAt, left.importedAt))

  return applyLimit(batches, options.limit)
}

async function findSampleBatch(
  vaultRoot: string,
  batchId: string,
): Promise<SampleBatchDetails | null> {
  const manifestFiles = await walkSampleManifestFiles(vaultRoot)

  for (const manifestFile of manifestFiles) {
    const batch = await readSampleBatchManifest(vaultRoot, manifestFile)
    if (batch?.batchId === batchId) {
      return batch
    }
  }

  return null
}

async function readSampleBatchManifest(
  vaultRoot: string,
  manifestFile: string,
): Promise<SampleBatchDetails | null> {
  const manifest = await readJsonObject(
    path.join(vaultRoot, manifestFile),
    `sample batch manifest "${manifestFile}"`,
  )
  const batchId =
    firstString(manifest, ['importId']) ??
    manifestFile.split('/').at(-2) ??
    null

  if (!batchId) {
    return null
  }

  const typedManifest = manifest as SampleBatchManifest
  const provenance = asObject(typedManifest.provenance)
  const artifacts = Array.isArray(typedManifest.artifacts)
    ? typedManifest.artifacts
        .map((artifact) => asObject(artifact))
        .filter(isJsonObject)
    : []
  const sampleIds = arrayOfStrings(provenance?.sampleIds)
  const importConfig = asObject(provenance?.importConfig) ?? {}

  return {
    batchId,
    stream: inferSampleStream(manifestFile, manifest),
    manifestFile,
    rawDirectory: firstString(manifest, ['rawDirectory']),
    importedAt: firstString(manifest, ['importedAt']),
    source: nullableString(typedManifest.source),
    importedCount: numberOrNull(provenance?.importedCount),
    sampleIds,
    importConfig,
    artifacts,
    manifest,
  }
}

async function walkSampleManifestFiles(vaultRoot: string): Promise<string[]> {
  const root = path.join(vaultRoot, 'raw', 'samples')
  return walkRelativeFiles(root, 'raw/samples')
}

async function walkRelativeFiles(
  absoluteDirectory: string,
  relativeDirectory: string,
): Promise<string[]> {
  let entries

  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
  }

  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDirectory, entry.name)
    const relativePath = path.posix.join(relativeDirectory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walkRelativeFiles(absolutePath, relativePath)))
      continue
    }

    if (entry.isFile() && entry.name === 'manifest.json') {
      files.push(relativePath)
    }
  }

  return files.sort()
}

function inferSampleStream(
  manifestFile: string,
  manifest: JsonObject,
): string | null {
  const rawDirectory = firstString(manifest, ['rawDirectory'])
  const sourcePath = rawDirectory ?? manifestFile
  const segments = sourcePath.split('/')
  const samplesIndex = segments.indexOf('samples')
  const streamSegment = samplesIndex >= 0 ? segments[samplesIndex + 1] : null

  return streamSegment ? streamSegment.replace(/-/g, '_') : null
}
