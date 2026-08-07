import { createHash } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import {
  isVaultFilesystemCaseInsensitive,
  normalizeRelativeVaultPathForComparison,
  readBoundedZipDirectory,
  readBoundedZipEntry,
  type BoundedZipEntry,
} from '@murphai/core'
import {
  assistantVaultFileMaxBytes,
  type AssistantOutboxIntent,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { z } from 'zod'
import { isAssistantGeneratedDeliveryRef } from './generated-delivery-files.js'
import { isActiveAssistantOutboxDeliveryIntent } from './outbox/intents.js'
import {
  readAssistantOutboxIntentInventory,
} from './outbox/store.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError } from './shared.js'
import { ensureAssistantState } from './store/persistence.js'

interface AssistantGeneratedExportPackRetirementFile {
  path: string
  sha256: string
  sizeBytes: number
}

interface AssistantGeneratedExportPackRetirement {
  basePath: string
  files: AssistantGeneratedExportPackRetirementFile[]
  packId: string
}

interface AssistantGeneratedDeliveryRetirement {
  archiveRef: string
  archiveSha256: string
  kind: 'sent_export_packs_v1'
  packs: AssistantGeneratedExportPackRetirement[]
}

interface LiveExportPackSnapshot {
  absoluteBasePath: string
  fileStats: Map<string, Stats>
  receipt: AssistantGeneratedExportPackRetirement
  rootStats: Stats
}

interface GeneratedExportArchiveSnapshot {
  bytes: Buffer
  stats: Stats
}

interface GeneratedExportPackCandidate {
  basePath: string
  entries: BoundedZipEntry[]
  manifestEntry: BoundedZipEntry
  manifestPath: string
  packId: string
}

type GeneratedExportArchiveSnapshotRead =
  | { kind: 'invalid' }
  | { kind: 'missing' }
  | { kind: 'snapshot'; snapshot: GeneratedExportArchiveSnapshot }

type GeneratedExportPackCandidateInspection =
  | { kind: 'candidate'; liveSnapshot: LiveExportPackSnapshot }
  | { kind: 'ineligible' }

interface GeneratedExportArchiveInspection {
  candidates: LiveExportPackSnapshot[]
  deferred: boolean
}

export interface SentAssistantGeneratedExportArchive {
  archivePath: string
  file: AssistantVaultFileResponseMedia
}

export interface SentAssistantExportPackRetirementResult {
  bytesPruned: number
  completedArchives: SentAssistantGeneratedExportArchive[]
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

export async function buildAssistantGeneratedDeliveryRetirement(input: {
  archiveBytes: Uint8Array
  file: AssistantVaultFileResponseMedia
  signal?: AbortSignal | null
  vault: string
}): Promise<AssistantGeneratedDeliveryRetirement | null> {
  const archive = Buffer.isBuffer(input.archiveBytes)
    ? input.archiveBytes
    : Buffer.from(input.archiveBytes)
  const inspection = await inspectAssistantGeneratedExportArchive({
    archive,
    file: input.file,
    signal: input.signal,
    vault: input.vault,
  })
  if (inspection.candidates.length === 0) {
    return null
  }
  return {
    archiveRef: input.file.ref,
    archiveSha256: input.file.sha256,
    kind: 'sent_export_packs_v1',
    packs: inspection.candidates.map(({ receipt }) => receipt),
  }
}

export async function retireSentAssistantExportPacks(input: {
  archives: readonly SentAssistantGeneratedExportArchive[]
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
      if (archive.file.sizeBytes > assistantVaultFileMaxBytes) {
        result.completedArchives.push(archive)
        continue
      }
      const archiveRead = await readMatchingGeneratedArchiveSnapshot(
        archive.archivePath,
        archive.file,
        input.signal,
      )
      if (archiveRead.kind === 'missing') {
        result.completedArchives.push(archive)
        continue
      }
      if (archiveRead.kind === 'invalid') {
        return result
      }
      const inspection = await inspectAssistantGeneratedExportArchive({
        archive: archiveRead.snapshot.bytes,
        deferForActiveOutboxOwner: true,
        file: archive.file,
        signal: input.signal,
        vault: input.vault,
      })
      let archiveDeferred = inspection.deferred
      for (const liveSnapshot of inspection.candidates) {
        input.signal?.throwIfAborted()
        const deletion = await deleteProvenAssistantExportPack({
          archive,
          archiveStats: archiveRead.snapshot.stats,
          liveSnapshot,
          signal: input.signal,
          vault: input.vault,
        })
        if (deletion === 'deferred') {
          archiveDeferred = true
          continue
        }
        if (deletion === 'pruned') {
          result.bytesPruned += liveSnapshot.receipt.files.reduce(
            (total, file) => total + file.sizeBytes,
            0,
          )
          result.packsPruned += 1
        }
      }
      if (!archiveDeferred) {
        result.completedArchives.push(archive)
      }
    }
    return result
  } catch (error) {
    input.signal?.throwIfAborted()
    return result
  }
}

async function inspectAssistantGeneratedExportArchive(input: {
  archive: Buffer
  deferForActiveOutboxOwner?: boolean
  file: AssistantVaultFileResponseMedia
  signal?: AbortSignal | null
  vault: string
}): Promise<GeneratedExportArchiveInspection> {
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
    return { candidates: [], deferred: false }
  }

  let entries: BoundedZipEntry[]
  try {
    entries = (await readBoundedZipDirectory(input.archive, {
      maxEntries: ZIP_MAX_ENTRY_COUNT,
      signal: input.signal,
    })).entries
  } catch (error) {
    input.signal?.throwIfAborted()
    return { candidates: [], deferred: false }
  }

  const candidates = buildGeneratedExportPackCandidates(entries)
  let hasDeferredCandidate = false
  const liveSnapshots: LiveExportPackSnapshot[] = []
  for (const possible of candidates) {
    input.signal?.throwIfAborted()
    const rootState = await readAssistantExportPackRootState({
      basePath: possible.basePath,
      signal: input.signal,
      vault: input.vault,
    })
    if (rootState !== 'present') {
      continue
    }
    if (
      input.deferForActiveOutboxOwner
      && await assistantExportPackHasActiveOutboxOwner({
        basePath: possible.basePath,
        signal: input.signal,
        vault: input.vault,
      })
    ) {
      hasDeferredCandidate = true
      continue
    }

    const candidateInspection = await inspectGeneratedExportPackCandidate({
      archive: input.archive,
      candidate: possible,
      signal: input.signal,
      vault: input.vault,
    })
    if (candidateInspection.kind === 'ineligible') {
      continue
    }
    liveSnapshots.push(candidateInspection.liveSnapshot)
  }
  return {
    candidates: liveSnapshots,
    deferred: hasDeferredCandidate,
  }
}

function buildGeneratedExportPackCandidates(
  entries: readonly BoundedZipEntry[],
): GeneratedExportPackCandidate[] {
  const byPackId = new Map<string, GeneratedExportPackCandidate>()
  for (const entry of entries) {
    const match = EXPORT_PACK_MANIFEST_PATTERN.exec(entry.name)
    const packId = match?.[1]
    if (!packId || !EXPORT_PACK_ID_PATTERN.test(packId)) {
      continue
    }
    byPackId.set(packId, {
      basePath: `exports/packs/${packId}`,
      entries: [],
      manifestEntry: entry,
      manifestPath: entry.name,
      packId,
    })
  }
  for (const entry of entries) {
    const packId = EXPORT_PACK_ENTRY_PATTERN.exec(entry.name)?.[1]
    const candidate = packId ? byPackId.get(packId) : undefined
    if (candidate && !entry.name.endsWith('/')) {
      candidate.entries.push(entry)
    }
  }
  return [...byPackId.values()].sort((left, right) =>
    left.basePath.localeCompare(right.basePath),
  )
}

async function inspectGeneratedExportPackCandidate(input: {
  archive: Buffer
  candidate: GeneratedExportPackCandidate
  signal?: AbortSignal | null
  vault: string
}): Promise<GeneratedExportPackCandidateInspection> {
  let archivedFiles: AssistantGeneratedExportPackRetirementFile[]
  try {
    const manifestBytes = (await readBoundedZipEntry(
      input.archive,
      input.candidate.manifestEntry,
      {
        maxOutputBytes: ZIP_MAX_MANIFEST_BYTES,
        signal: input.signal,
      },
    )).bytes
    const manifest = exportPackManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8')),
    )
    if (manifest.packId !== input.candidate.packId) {
      return { kind: 'ineligible' }
    }

    const declaredPaths = manifest.files.map((file) => file.path)
    if (!isExactDirectExportPackFileList(
      input.candidate.basePath,
      declaredPaths,
    )) {
      return { kind: 'ineligible' }
    }
    const archivedPackPaths = input.candidate.entries
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
    const sortedDeclaredPaths = [...declaredPaths]
      .sort((left, right) => left.localeCompare(right))
    if (!sameStrings(archivedPackPaths, sortedDeclaredPaths)) {
      return { kind: 'ineligible' }
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
        return { kind: 'ineligible' }
      }
      aggregateUncompressedBytes += entry.uncompressedSize
    }

    archivedFiles = []
    for (const filePath of declaredPaths) {
      input.signal?.throwIfAborted()
      const entry = entriesByPath.get(filePath)
      if (!entry) {
        return { kind: 'ineligible' }
      }
      const contents = filePath === input.candidate.manifestPath
        ? manifestBytes
        : await readGeneratedExportPackArchiveEntry({
            archive: input.archive,
            entry,
            signal: input.signal,
          })
      archivedFiles.push({
        path: filePath,
        sha256: await sha256HexInterruptible(contents, input.signal),
        sizeBytes: contents.byteLength,
      })
    }
  } catch (error) {
    input.signal?.throwIfAborted()
    return { kind: 'ineligible' }
  }
  const liveSnapshot = await readLiveExportPackSnapshot({
    basePath: input.candidate.basePath,
    expectedFiles: archivedFiles,
    packId: input.candidate.packId,
    signal: input.signal,
    vault: input.vault,
  })
  return liveSnapshot
    ? { kind: 'candidate', liveSnapshot }
    : { kind: 'ineligible' }
}

async function readGeneratedExportPackArchiveEntry(input: {
  archive: Buffer
  entry: BoundedZipEntry
  signal?: AbortSignal | null
}): Promise<Buffer> {
  return (await readBoundedZipEntry(input.archive, input.entry, {
    maxOutputBytes: input.entry.uncompressedSize,
    signal: input.signal,
  })).bytes
}

async function assistantExportPackHasActiveOutboxOwner(input: {
  basePath: string
  signal?: AbortSignal | null
  vault: string
}): Promise<boolean> {
  input.signal?.throwIfAborted()
  const caseInsensitive = await isVaultFilesystemCaseInsensitive(input.vault)
  input.signal?.throwIfAborted()
  return await withAssistantRuntimeWriteLock(
    input.vault,
    async (paths) => {
      await ensureAssistantState(paths)
      const outbox = await readAssistantOutboxIntentInventory({
        directory: paths.outboxDirectory,
        signal: input.signal,
        vault: input.vault,
      })
      return !outbox.trusted || outbox.records.some(({ record }) =>
        isActiveAssistantOutboxDeliveryIntent(record)
        && record.media.some((media) =>
          media.kind === 'vault_file'
          && refIsEqualToOrBeneath(
            media.ref,
            input.basePath,
            caseInsensitive,
          )
        )
      )
    },
    input.signal,
  )
}

async function deleteProvenAssistantExportPack(input: {
  archive: SentAssistantGeneratedExportArchive
  archiveStats: Stats
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
      if (!outboxProvesExactSentArchiveClaim(
        outbox.records.map(({ record }) => record),
        input.archive.file,
      )) {
        return 'deferred'
      }
      if (outbox.records.some(({ record }) =>
        isActiveAssistantOutboxDeliveryIntent(record)
        && record.media.some((media) =>
          media.kind === 'vault_file'
          && refIsEqualToOrBeneath(
            media.ref,
            input.liveSnapshot.receipt.basePath,
            caseInsensitive,
          )
        )
      )) {
        return 'deferred'
      }
      if (!(await assistantGeneratedArchiveSnapshotIsUnchanged({
        archive: input.archive,
        stats: input.archiveStats,
        vault: input.vault,
      }))) {
        return 'complete'
      }
      if (!(await liveExportPackSnapshotIsUnchanged(input.liveSnapshot))) {
        return 'complete'
      }
      input.signal?.throwIfAborted()
      await rm(input.liveSnapshot.absoluteBasePath, { recursive: true })
      input.signal?.throwIfAborted()
      return 'pruned'
    },
    input.signal,
  )
}

async function readMatchingGeneratedArchiveSnapshot(
  archivePath: string,
  file: AssistantVaultFileResponseMedia,
  signal?: AbortSignal | null,
): Promise<GeneratedExportArchiveSnapshotRead> {
  signal?.throwIfAborted()
  try {
    const before = await lstat(archivePath)
    signal?.throwIfAborted()
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1
      || before.size !== file.sizeBytes
    ) {
      return { kind: 'invalid' }
    }
    const bytes = await readFile(
      archivePath,
      signal ? { signal } : undefined,
    )
    signal?.throwIfAborted()
    const after = await lstat(archivePath)
    signal?.throwIfAborted()
    return fileStatsMatch(before, after)
      ? { kind: 'snapshot', snapshot: { bytes, stats: after } }
      : { kind: 'invalid' }
  } catch (error) {
    signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      return { kind: 'missing' }
    }
    throw error
  }
}

async function assistantGeneratedArchiveSnapshotIsUnchanged(input: {
  archive: SentAssistantGeneratedExportArchive
  stats: Stats
  vault: string
}): Promise<boolean> {
  const resolved = await resolveAssistantVaultPath(
    input.vault,
    input.archive.file.ref,
    'file path',
  )
  if (resolved !== input.archive.archivePath) {
    return false
  }
  try {
    const current = await lstat(resolved)
    return current.isFile()
      && !current.isSymbolicLink()
      && current.nlink === 1
      && fileStatsMatch(input.stats, current)
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

async function readAssistantExportPackRootState(input: {
  basePath: string
  signal?: AbortSignal | null
  vault: string
}): Promise<'invalid' | 'missing' | 'present'> {
  const absoluteBasePath = await resolveAssistantVaultPath(
    input.vault,
    input.basePath,
  )
  input.signal?.throwIfAborted()
  try {
    const stats = await lstat(absoluteBasePath)
    input.signal?.throwIfAborted()
    return stats.isDirectory() && !stats.isSymbolicLink()
      ? 'present'
      : 'invalid'
  } catch (error) {
    input.signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      return 'missing'
    }
    throw error
  }
}

async function readLiveExportPackSnapshot(input: {
  basePath: string
  expectedFiles: readonly AssistantGeneratedExportPackRetirementFile[]
  packId: string
  signal?: AbortSignal | null
  vault: string
}): Promise<LiveExportPackSnapshot | null> {
  if (
    input.basePath !== `exports/packs/${input.packId}`
    || !EXPORT_PACK_ID_PATTERN.test(input.packId)
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
  input.signal?.throwIfAborted()
  let rootStats: Stats
  try {
    rootStats = await lstat(absoluteBasePath)
  } catch (error) {
    input.signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    return null
  }
  const directoryEntries = await readdir(absoluteBasePath, {
    withFileTypes: true,
  })
  input.signal?.throwIfAborted()
  if (
    directoryEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    || !sameStrings(
      directoryEntries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right)),
      input.expectedFiles
        .map((file) => path.posix.basename(file.path))
        .sort((left, right) => left.localeCompare(right)),
    )
  ) {
    return null
  }

  const fileStats = new Map<string, Stats>()
  const files: AssistantGeneratedExportPackRetirementFile[] = []
  for (const expected of input.expectedFiles) {
    input.signal?.throwIfAborted()
    const absoluteFilePath = await resolveAssistantVaultPath(
      input.vault,
      expected.path,
      'file path',
    )
    let before: Stats
    try {
      before = await lstat(absoluteFilePath)
    } catch (error) {
      input.signal?.throwIfAborted()
      if (isMissingFileError(error)) {
        return null
      }
      throw error
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      return null
    }
    if (before.size !== expected.sizeBytes) {
      return null
    }
    const sha256 = await sha256FileInterruptible(
      absoluteFilePath,
      input.signal,
    )
    input.signal?.throwIfAborted()
    const after = await lstat(absoluteFilePath)
    if (
      !fileStatsMatch(before, after)
      || sha256 !== expected.sha256
    ) {
      return null
    }
    fileStats.set(expected.path, after)
    files.push({ ...expected })
  }
  const finalRootStats = await lstat(absoluteBasePath)
  input.signal?.throwIfAborted()
  if (!fileStatsMatch(rootStats, finalRootStats)) {
    return null
  }

  return {
    absoluteBasePath,
    fileStats,
    receipt: {
      basePath: input.basePath,
      files,
      packId: input.packId,
    },
    rootStats: finalRootStats,
  }
}

async function liveExportPackSnapshotIsUnchanged(
  snapshot: LiveExportPackSnapshot,
): Promise<boolean> {
  try {
    const rootStats = await lstat(snapshot.absoluteBasePath)
    if (!fileStatsMatch(snapshot.rootStats, rootStats)) {
      return false
    }
    const entries = await readdir(snapshot.absoluteBasePath, {
      withFileTypes: true,
    })
    if (
      entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
      || !sameStrings(
        entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right)),
        snapshot.receipt.files
          .map((file) => path.posix.basename(file.path))
          .sort((left, right) => left.localeCompare(right)),
      )
    ) {
      return false
    }
    for (const file of snapshot.receipt.files) {
      const expected = snapshot.fileStats.get(file.path)
      if (!expected) {
        return false
      }
      const current = await lstat(
        path.join(snapshot.absoluteBasePath, path.posix.basename(file.path)),
      )
      if (!fileStatsMatch(expected, current)) {
        return false
      }
    }
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

function isExactDirectExportPackFileList(
  basePath: string,
  filePaths: readonly string[],
): boolean {
  if (filePaths.length === 0 || new Set(filePaths).size !== filePaths.length) {
    return false
  }
  return filePaths.every((filePath) => {
    if (!filePath.startsWith(`${basePath}/`)) {
      return false
    }
    const fileName = filePath.slice(basePath.length + 1)
    return EXPORT_PACK_FILE_NAME_PATTERN.test(fileName)
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
    if (claims.length === 0) {
      continue
    }
    if (
      intent.status !== 'sent'
      || intent.media.length !== 1
      || claims.length !== 1
      || claims[0]?.contentType !== file.contentType
      || claims[0]?.sizeBytes !== file.sizeBytes
      || claims[0]?.sha256 !== file.sha256
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
  const stream = createReadStream(filePath, {
    ...(signal ? { signal } : {}),
  })
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
