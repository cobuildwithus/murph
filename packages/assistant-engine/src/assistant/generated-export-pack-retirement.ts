import { createHash } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import { lstat, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'

import {
  isVaultFilesystemCaseInsensitive,
  normalizeRelativeVaultPathForComparison,
  readBoundedZipDirectory,
  readBoundedZipEntry,
  type BoundedZipEntry,
} from '@murphai/core'
import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantVaultFileMaxBytes,
  type AssistantOutboxIntent,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { isAssistantGeneratedDeliveryRef } from './generated-delivery-files.js'
import { isActiveAssistantOutboxDeliveryIntent } from './outbox/intents.js'
import { readAssistantOutboxIntentInventory } from './outbox/store.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError } from './shared.js'
import { ensureAssistantState } from './store/persistence.js'

interface ArchivedExportPackFile {
  path: string
  sha256: string
  sizeBytes: number
}

interface ExportPackIdentity {
  files: Array<{ name: string; stats: Stats }>
  root: Stats
}

interface LiveExportPackSnapshot {
  absoluteBasePath: string
  basePath: string
  files: ArchivedExportPackFile[]
  identity: ExportPackIdentity
}

interface GeneratedExportArchiveSnapshot {
  absolutePath: string
  bytes: Buffer
  stats: Stats
}

interface GeneratedExportPackCandidate {
  basePath: string
  entries: BoundedZipEntry[]
  manifestEntry: BoundedZipEntry
  packId: string
}

export interface SentAssistantExportPackRetirementResult {
  bytesPruned: number
  completedArchives: AssistantVaultFileResponseMedia[]
  inventoryTrusted: boolean
  packsPruned: number
}

const exportPackManifestSchema = z
  .object({
    files: z.array(
      z.object({ path: z.string().min(1).max(1024) }).passthrough(),
    ).min(1).max(32),
    format: z.literal('murph.export-pack.v1'),
    packId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .passthrough()

const ZIP_MAX_ENTRY_COUNT = 20_000
const ZIP_MAX_MANIFEST_BYTES = 1024 * 1024
const HASH_CHUNK_BYTES = 1024 * 1024
const EXPORT_PACK_ID_PATTERN = /^[A-Za-z0-9_-]+$/u
const EXPORT_PACK_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const EXPORT_PACK_MANIFEST_PATTERN = /^exports\/packs\/([A-Za-z0-9_-]+)\/manifest\.json$/u
const EXPORT_PACK_ENTRY_PATTERN = /^exports\/packs\/([A-Za-z0-9_-]+)\/(.+)$/u

export async function retireSentAssistantExportPacks(input: {
  archives: readonly AssistantVaultFileResponseMedia[]
  signal?: AbortSignal | null
  vault: string
}): Promise<SentAssistantExportPackRetirementResult> {
  input.signal?.throwIfAborted()
  const result: SentAssistantExportPackRetirementResult = {
    bytesPruned: 0,
    completedArchives: [],
    inventoryTrusted: true,
    packsPruned: 0,
  }
  try {
    for (const archive of input.archives) {
      input.signal?.throwIfAborted()
      if (archive.sizeBytes > assistantVaultFileMaxBytes) {
        result.completedArchives.push(archive)
        continue
      }
      const snapshot = await readMatchingGeneratedArchiveSnapshot({
        file: archive,
        signal: input.signal,
        vault: input.vault,
      })
      if (snapshot === 'missing') {
        result.completedArchives.push(archive)
        continue
      }
      if (snapshot === null) {
        return result
      }

      const candidates = await inspectGeneratedExportArchive({
        archive: snapshot.bytes,
        file: archive,
        signal: input.signal,
      })
      let deferred = false
      for (const candidate of candidates) {
        input.signal?.throwIfAborted()
        const liveSnapshot = await inspectGeneratedExportPackCandidate({
          archive: snapshot.bytes,
          candidate,
          signal: input.signal,
          vault: input.vault,
        })
        if (!liveSnapshot) {
          continue
        }
        const deletion = await deleteProvenAssistantExportPack({
          archive,
          archiveSnapshot: snapshot,
          liveSnapshot,
          signal: input.signal,
          vault: input.vault,
        })
        if (deletion === 'deferred') {
          deferred = true
        } else if (deletion === 'pruned') {
          result.bytesPruned += liveSnapshot.files.reduce(
            (total, file) => total + file.sizeBytes,
            0,
          )
          result.packsPruned += 1
        }
      }
      if (!deferred) {
        result.completedArchives.push(archive)
      }
    }
    return result
  } catch (error) {
    input.signal?.throwIfAborted()
    if (
      error instanceof VaultCliError
      && (
        error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT'
        || error.code === 'ASSISTANT_RUNTIME_WRITE_LOCKED'
      )
    ) {
      throw error
    }
    return result
  }
}

export function collectSentAssistantGeneratedExportArchiveMedia(
  intents: readonly AssistantOutboxIntent[],
): Map<string, AssistantVaultFileResponseMedia> {
  const byRef = new Map<string, AssistantVaultFileResponseMedia>()
  const conflictedRefs = new Set<string>()
  for (const intent of intents) {
    if (intent.status !== 'sent') continue
    const matchingMedia = intent.media.filter(
      (media): media is AssistantVaultFileResponseMedia =>
        media.kind === 'vault_file'
        && media.contentType === 'application/zip'
        && media.ref.toLowerCase().endsWith('.zip')
        && isAssistantGeneratedDeliveryRef(media.ref),
    )
    if (intent.media.length !== 1 || matchingMedia.length !== 1) {
      for (const media of matchingMedia) {
        byRef.delete(media.ref)
        conflictedRefs.add(media.ref)
      }
      continue
    }
    const file = matchingMedia[0]
    if (!file || conflictedRefs.has(file.ref)) continue
    const existing = byRef.get(file.ref)
    if (!existing || sameAssistantVaultFileDescriptor(existing, file)) {
      byRef.set(file.ref, file)
    } else {
      byRef.delete(file.ref)
      conflictedRefs.add(file.ref)
    }
  }
  return byRef
}

export function sameAssistantVaultFileDescriptor(
  left: AssistantVaultFileResponseMedia,
  right: AssistantVaultFileResponseMedia,
): boolean {
  return left.ref === right.ref
    && left.contentType === right.contentType
    && left.sizeBytes === right.sizeBytes
    && left.sha256 === right.sha256
}

async function inspectGeneratedExportArchive(input: {
  archive: Buffer
  file: AssistantVaultFileResponseMedia
  signal?: AbortSignal | null
}): Promise<GeneratedExportPackCandidate[]> {
  input.signal?.throwIfAborted()
  if (
    input.file.contentType !== 'application/zip'
    || !isAssistantGeneratedDeliveryRef(input.file.ref)
    || !input.file.ref.toLowerCase().endsWith('.zip')
    || input.file.sha256 !== await sha256HexInterruptible(
      input.archive,
      input.signal,
    )
  ) {
    return []
  }
  try {
    const entries = (await readBoundedZipDirectory(input.archive, {
      maxEntries: ZIP_MAX_ENTRY_COUNT,
      signal: input.signal,
    })).entries
    return buildGeneratedExportPackCandidates(entries)
  } catch (error) {
    input.signal?.throwIfAborted()
    return []
  }
}

function buildGeneratedExportPackCandidates(
  entries: readonly BoundedZipEntry[],
): GeneratedExportPackCandidate[] {
  const entriesByPackId = new Map<string, BoundedZipEntry[]>()
  for (const entry of entries) {
    const packId = EXPORT_PACK_ENTRY_PATTERN.exec(entry.name)?.[1]
    if (!packId || entry.name.endsWith('/')) {
      continue
    }
    const packEntries = entriesByPackId.get(packId)
    if (packEntries) packEntries.push(entry)
    else entriesByPackId.set(packId, [entry])
  }
  const candidates: GeneratedExportPackCandidate[] = []
  for (const [packId, packEntries] of entriesByPackId) {
    const manifestEntry = packEntries.find((entry) => (
      EXPORT_PACK_MANIFEST_PATTERN.exec(entry.name)?.[1] === packId
    ))
    if (manifestEntry && EXPORT_PACK_ID_PATTERN.test(packId)) {
      candidates.push({
        basePath: `exports/packs/${packId}`,
        entries: packEntries,
        manifestEntry,
        packId,
      })
    }
  }
  return candidates.sort((left, right) => left.basePath.localeCompare(right.basePath))
}

async function inspectGeneratedExportPackCandidate(input: {
  archive: Buffer
  candidate: GeneratedExportPackCandidate
  signal?: AbortSignal | null
  vault: string
}): Promise<LiveExportPackSnapshot | null> {
  let archivedFiles: ArchivedExportPackFile[]
  try {
    const manifestBytes = (await readBoundedZipEntry(
      input.archive,
      input.candidate.manifestEntry,
      { maxOutputBytes: ZIP_MAX_MANIFEST_BYTES, signal: input.signal },
    )).bytes
    const manifest = exportPackManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8')),
    )
    if (manifest.packId !== input.candidate.packId) {
      return null
    }

    const declaredPaths = manifest.files.map((file) => file.path)
    if (!isExactDirectExportPackFileList(
      input.candidate.basePath,
      declaredPaths,
    )) {
      return null
    }
    const archivedPaths = input.candidate.entries
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
    if (!sameStrings(
      archivedPaths,
      [...declaredPaths].sort((left, right) => left.localeCompare(right)),
    )) {
      return null
    }

    const entriesByPath = new Map(
      input.candidate.entries.map((entry) => [entry.name, entry]),
    )
    let aggregateUncompressedBytes = 0
    for (const filePath of declaredPaths) {
      const entry = entriesByPath.get(filePath)
      if (
        !entry
        || !Number.isSafeInteger(entry.uncompressedSize)
        || entry.uncompressedSize < 0
        || entry.uncompressedSize
          > assistantVaultFileMaxBytes - aggregateUncompressedBytes
      ) {
        return null
      }
      aggregateUncompressedBytes += entry.uncompressedSize
    }

    archivedFiles = []
    for (const filePath of declaredPaths) {
      input.signal?.throwIfAborted()
      const entry = entriesByPath.get(filePath)
      if (!entry) return null
      const contents = entry === input.candidate.manifestEntry
        ? manifestBytes
        : (await readBoundedZipEntry(input.archive, entry, {
            maxOutputBytes: entry.uncompressedSize,
            signal: input.signal,
          })).bytes
      archivedFiles.push({
        path: filePath,
        sha256: await sha256HexInterruptible(contents, input.signal),
        sizeBytes: contents.byteLength,
      })
    }
  } catch (error) {
    input.signal?.throwIfAborted()
    return null
  }
  return await readLiveExportPackSnapshot({
    basePath: input.candidate.basePath,
    expectedFiles: archivedFiles,
    signal: input.signal,
    vault: input.vault,
  })
}

async function deleteProvenAssistantExportPack(input: {
  archive: AssistantVaultFileResponseMedia
  archiveSnapshot: GeneratedExportArchiveSnapshot
  liveSnapshot: LiveExportPackSnapshot
  signal?: AbortSignal | null
  vault: string
}): Promise<'complete' | 'deferred' | 'pruned'> {
  input.signal?.throwIfAborted()
  const caseInsensitive = await isVaultFilesystemCaseInsensitive(input.vault)
  input.signal?.throwIfAborted()
  return await withAssistantRuntimeWriteLock(
    input.vault,
    async (paths) => {
      await ensureAssistantState(paths)
      input.signal?.throwIfAborted()
      const outbox = await readAssistantOutboxIntentInventory({
        directory: paths.outboxDirectory,
        signal: input.signal,
        vault: input.vault,
      })
      if (!outbox.trusted) {
        return 'deferred'
      }
      const intents = outbox.records.map(({ record }) => record)
      if (
        !outboxProvesExactSentArchiveClaim(intents, input.archive)
        || intents.some((intent) => (
          isActiveAssistantOutboxDeliveryIntent(intent)
          && intent.media.some((media) => (
            media.kind === 'vault_file'
            && refIsEqualToOrBeneath(
              media.ref,
              input.liveSnapshot.basePath,
              caseInsensitive,
            )
          ))
        ))
      ) {
        return 'deferred'
      }
      if (!(await generatedArchiveSnapshotIsUnchanged({
        file: input.archive,
        snapshot: input.archiveSnapshot,
        vault: input.vault,
      }))) {
        return 'complete'
      }
      if (!(await liveExportPackSnapshotIsUnchanged(input.liveSnapshot))) {
        return 'complete'
      }
      input.signal?.throwIfAborted()
      for (const file of input.liveSnapshot.files) {
        await unlink(path.join(
          input.liveSnapshot.absoluteBasePath,
          path.posix.basename(file.path),
        ))
        input.signal?.throwIfAborted()
      }
      await rmdir(input.liveSnapshot.absoluteBasePath)
      input.signal?.throwIfAborted()
      return 'pruned'
    },
    input.signal,
  )
}

async function readMatchingGeneratedArchiveSnapshot(input: {
  file: AssistantVaultFileResponseMedia
  signal?: AbortSignal | null
  vault: string
}): Promise<GeneratedExportArchiveSnapshot | 'missing' | null> {
  input.signal?.throwIfAborted()
  const absolutePath = await resolveAssistantVaultPath(
    input.vault,
    input.file.ref,
    'file path',
  )
  try {
    const before = await lstat(absolutePath)
    input.signal?.throwIfAborted()
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1
      || before.size !== input.file.sizeBytes
    ) {
      return null
    }
    const bytes = await readFile(
      absolutePath,
      input.signal ? { signal: input.signal } : undefined,
    )
    input.signal?.throwIfAborted()
    const after = await lstat(absolutePath)
    input.signal?.throwIfAborted()
    return fileStatsMatch(before, after)
      ? { absolutePath, bytes, stats: after }
      : null
  } catch (error) {
    input.signal?.throwIfAborted()
    if (isMissingFileError(error)) return 'missing'
    throw error
  }
}

async function generatedArchiveSnapshotIsUnchanged(input: {
  file: AssistantVaultFileResponseMedia
  snapshot: GeneratedExportArchiveSnapshot
  vault: string
}): Promise<boolean> {
  const resolved = await resolveAssistantVaultPath(
    input.vault,
    input.file.ref,
    'file path',
  )
  if (resolved !== input.snapshot.absolutePath) return false
  try {
    const current = await lstat(resolved)
    return current.isFile()
      && !current.isSymbolicLink()
      && current.nlink === 1
      && fileStatsMatch(input.snapshot.stats, current)
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
}

async function readLiveExportPackSnapshot(input: {
  basePath: string
  expectedFiles: readonly ArchivedExportPackFile[]
  signal?: AbortSignal | null
  vault: string
}): Promise<LiveExportPackSnapshot | null> {
  const packId = input.basePath.split('/').at(-1) ?? ''
  if (
    input.basePath !== `exports/packs/${packId}`
    || !EXPORT_PACK_ID_PATTERN.test(packId)
    || !isExactDirectExportPackFileList(
      input.basePath,
      input.expectedFiles.map((file) => file.path),
    )
  ) {
    return null
  }
  const absoluteBasePath = await resolveAssistantVaultPath(
    input.vault,
    input.basePath,
  )
  const before = await readExportPackIdentity({
    absoluteBasePath,
    expectedFiles: input.expectedFiles,
    signal: input.signal,
  })
  if (!before) return null

  const expectedByName = new Map(input.expectedFiles.map((file) => [
    path.posix.basename(file.path),
    file,
  ]))
  for (const { name } of before.files) {
    input.signal?.throwIfAborted()
    const file = expectedByName.get(name)
    if (!file) return null
    const absolutePath = path.join(absoluteBasePath, name)
    if (await sha256FileInterruptible(absolutePath, input.signal) !== file.sha256) {
      return null
    }
  }
  const after = await readExportPackIdentity({
    absoluteBasePath,
    expectedFiles: input.expectedFiles,
    signal: input.signal,
  })
  if (!after || !exportPackIdentityMatches(before, after)) return null
  const files: ArchivedExportPackFile[] = []
  for (const { name } of after.files) {
    const file = expectedByName.get(name)
    if (!file) return null
    files.push({ ...file })
  }
  return {
    absoluteBasePath,
    basePath: input.basePath,
    files,
    identity: after,
  }
}

async function readExportPackIdentity(input: {
  absoluteBasePath: string
  expectedFiles: readonly ArchivedExportPackFile[]
  signal?: AbortSignal | null
}): Promise<ExportPackIdentity | null> {
  input.signal?.throwIfAborted()
  try {
    const root = await lstat(input.absoluteBasePath)
    if (!root.isDirectory() || root.isSymbolicLink()) return null

    const entries = await readdir(input.absoluteBasePath, { withFileTypes: true })
    input.signal?.throwIfAborted()
    const expectedByName = new Map(input.expectedFiles.map((file) => [
      path.posix.basename(file.path),
      file,
    ]))
    if (
      expectedByName.size !== input.expectedFiles.length
      || entries.some((entry) => (
        !entry.isFile()
        || entry.isSymbolicLink()
        || !expectedByName.has(entry.name)
      ))
    ) {
      return null
    }

    const files: ExportPackIdentity['files'] = []
    for (const entry of entries.sort((left, right) => (
      left.name.localeCompare(right.name)
    ))) {
      input.signal?.throwIfAborted()
      const expected = expectedByName.get(entry.name)
      if (!expected) return null
      const stats = await lstat(path.join(input.absoluteBasePath, entry.name))
      if (
        !stats.isFile()
        || stats.isSymbolicLink()
        || stats.nlink !== 1
        || stats.size !== expected.sizeBytes
      ) {
        return null
      }
      files.push({ name: entry.name, stats })
    }
    const finalRoot = await lstat(input.absoluteBasePath)
    input.signal?.throwIfAborted()
    return fileStatsMatch(root, finalRoot) ? { files, root: finalRoot } : null
  } catch (error) {
    input.signal?.throwIfAborted()
    if (isMissingFileError(error)) return null
    throw error
  }
}

async function liveExportPackSnapshotIsUnchanged(
  snapshot: LiveExportPackSnapshot,
): Promise<boolean> {
  const current = await readExportPackIdentity({
    absoluteBasePath: snapshot.absoluteBasePath,
    expectedFiles: snapshot.files,
  })
  return current !== null && exportPackIdentityMatches(snapshot.identity, current)
}

function exportPackIdentityMatches(
  left: ExportPackIdentity,
  right: ExportPackIdentity,
): boolean {
  return fileStatsMatch(left.root, right.root)
    && left.files.length === right.files.length
    && left.files.every((file, index) => (
      right.files[index] !== undefined
      && file.name === right.files[index].name
      && fileStatsMatch(file.stats, right.files[index].stats)
    ))
}

function isExactDirectExportPackFileList(
  basePath: string,
  filePaths: readonly string[],
): boolean {
  if (filePaths.length === 0 || new Set(filePaths).size !== filePaths.length) {
    return false
  }
  return filePaths.every((filePath) => {
    if (!filePath.startsWith(`${basePath}/`)) return false
    return EXPORT_PACK_FILE_NAME_PATTERN.test(filePath.slice(basePath.length + 1))
  })
}

export function refIsEqualToOrBeneath(
  ref: string,
  basePath: string,
  caseInsensitive: boolean,
): boolean {
  const comparisonOptions = { caseInsensitive }
  const normalizedRef = normalizeRelativeVaultPathForComparison(
    ref,
    comparisonOptions,
  )
  const normalizedBasePath = normalizeRelativeVaultPathForComparison(
    basePath,
    comparisonOptions,
  )
  return normalizedRef === normalizedBasePath
    || normalizedRef.startsWith(`${normalizedBasePath}/`)
}

function outboxProvesExactSentArchiveClaim(
  intents: readonly AssistantOutboxIntent[],
  file: AssistantVaultFileResponseMedia,
): boolean {
  let exactClaims = 0
  for (const intent of intents) {
    const claims = intent.media.filter(
      (media): media is AssistantVaultFileResponseMedia =>
        media.kind === 'vault_file' && media.ref === file.ref,
    )
    if (claims.length === 0) continue
    const [claim] = claims
    if (
      intent.status !== 'sent'
      || intent.media.length !== 1
      || claims.length !== 1
      || !claim
      || !sameAssistantVaultFileDescriptor(claim, file)
    ) {
      return false
    }
    exactClaims += 1
  }
  return exactClaims > 0
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function fileStatsMatch(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

async function sha256HexInterruptible(
  value: Uint8Array,
  signal?: AbortSignal | null,
): Promise<string> {
  const hash = createHash('sha256')
  for (let offset = 0; offset < value.byteLength; offset += HASH_CHUNK_BYTES) {
    signal?.throwIfAborted()
    hash.update(value.subarray(
      offset,
      Math.min(value.byteLength, offset + HASH_CHUNK_BYTES),
    ))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  signal?.throwIfAborted()
  return hash.digest('hex')
}

async function sha256FileInterruptible(
  filePath: string,
  signal?: AbortSignal | null,
): Promise<string> {
  signal?.throwIfAborted()
  const hash = createHash('sha256')
  const stream = createReadStream(filePath, signal ? { signal } : undefined)
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      hash.update(chunk)
    }
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
  signal?.throwIfAborted()
  return hash.digest('hex')
}
