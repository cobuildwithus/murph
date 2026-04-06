import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import path from 'node:path'
import { readFile, rm, stat } from 'node:fs/promises'
import { CONTRACT_SCHEMA_VERSION, type RawImportManifest, type StoredMedia } from '@murphai/contracts'
import { applyCanonicalWriteBatch, resolveVaultPath } from '@murphai/core'
import { generateUlid } from '@murphai/runtime-state'

const RAW_WORKOUTS_ROOT = 'raw/workouts'
const RAW_MEASUREMENTS_ROOT = 'raw/measurements'
const MANIFEST_FILE_NAME = 'manifest.json'

interface StagedMediaBatch {
  manifestFile: string
  media: StoredMedia[]
  rawRefs: string[]
}

type WorkoutArtifactFamily = 'workout' | 'measurement'

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return normalized.length > 0 ? normalized : fallback
}

function sanitizeFileName(fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const safeStem = stem.length > 0 ? stem : 'media'
  return `${safeStem}${ext || ''}`
}

function inferMediaType(fileName: string): string {
  const ext = extname(fileName).toLowerCase()
  switch (ext) {
    case '.gif':
      return 'image/gif'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.json':
      return 'application/json'
    case '.mov':
      return 'video/quicktime'
    case '.mp4':
      return 'video/mp4'
    case '.png':
      return 'image/png'
    case '.webm':
      return 'video/webm'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function inferStoredMediaKind(fileName: string): StoredMedia['kind'] {
  const ext = extname(fileName).toLowerCase()
  if (ext === '.gif') {
    return 'gif'
  }
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return 'photo'
  }
  if (['.mp4', '.mov', '.webm'].includes(ext)) {
    return 'video'
  }
  return 'other'
}

function buildRawMediaDirectory(
  family: WorkoutArtifactFamily,
  occurredAt: string,
  eventId: string,
): string {
  const year = occurredAt.slice(0, 4)
  const month = occurredAt.slice(5, 7)
  const root = family === 'workout' ? RAW_WORKOUTS_ROOT : RAW_MEASUREMENTS_ROOT
  return `${root}/${year}/${month}/${sanitizePathSegment(eventId, family)}`
}

export async function stageWorkoutMediaBatch(input: {
  vault: string
  eventId: string
  occurredAt: string
  family: WorkoutArtifactFamily
  source?: string | null
  mediaPaths: readonly string[]
}): Promise<StagedMediaBatch | null> {
  const uniquePaths = [...new Set(input.mediaPaths.map((entry) => String(entry).trim()).filter(Boolean))]
  if (uniquePaths.length === 0) {
    return null
  }

  const rawDirectory = buildRawMediaDirectory(input.family, input.occurredAt, input.eventId)
  const artifacts: RawImportManifest['artifacts'] = []
  const rawCopies: Array<{
    sourcePath: string
    targetRelativePath: string
    originalFileName: string
    mediaType: string
  }> = []
  const media: StoredMedia[] = []
  const rawRefs: string[] = []

  for (const [index, sourcePath] of uniquePaths.entries()) {
    const originalFileName = basename(sourcePath)
    const safeFileName = sanitizeFileName(originalFileName)
    const mediaType = inferMediaType(safeFileName)
    const targetRelativePath = `${rawDirectory}/${String(index + 1).padStart(2, '0')}-${safeFileName}`
    const fileBuffer = await readFile(sourcePath)
    const fileStats = await stat(sourcePath)

    rawCopies.push({
      sourcePath,
      targetRelativePath,
      originalFileName,
      mediaType,
    })
    rawRefs.push(targetRelativePath)
    media.push({
      kind: inferStoredMediaKind(safeFileName),
      relativePath: targetRelativePath,
      mediaType,
    })
    artifacts.push({
      role: `media_${index + 1}`,
      relativePath: targetRelativePath,
      originalFileName,
      mediaType,
      byteSize: fileStats.size,
      sha256: createHash('sha256').update(fileBuffer).digest('hex'),
    })
  }

  const manifestFile = path.posix.join(rawDirectory, MANIFEST_FILE_NAME)
  const manifest: RawImportManifest = {
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    importId: `xfm_${generateUlid()}`,
    importKind: input.family === 'workout' ? 'workout_batch' : 'measurement_batch',
    importedAt: new Date().toISOString(),
    source: input.source ?? null,
    rawDirectory,
    artifacts,
    provenance: {
      eventId: input.eventId,
      family: input.family,
      mediaCount: artifacts.length,
    },
  }

  await applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: input.family === 'workout' ? 'workout_import_raw' : 'measurement_import_raw',
    summary: input.family === 'workout'
      ? `Stage workout media for ${input.eventId}`
      : `Stage measurement media for ${input.eventId}`,
    occurredAt: input.occurredAt,
    rawCopies,
    rawContents: [{
      targetRelativePath: manifestFile,
      originalFileName: MANIFEST_FILE_NAME,
      mediaType: 'application/json',
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    }],
  })

  return {
    manifestFile,
    media,
    rawRefs,
  }
}

export async function cleanupStagedWorkoutMediaBatch(input: {
  vault: string
  manifestFile: string
}) {
  const rawDirectory = path.posix.dirname(input.manifestFile)
  const resolved = resolveVaultPath(input.vault, rawDirectory)
  await rm(resolved.absolutePath, { recursive: true, force: true })
}
