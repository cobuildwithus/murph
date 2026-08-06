import { createHash } from 'node:crypto'
import { type Stats } from 'node:fs'
import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'

import {
  assistantVaultFileMaxBytes,
  type AssistantOutboxIntent,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { z } from 'zod'
import { isAssistantGeneratedDeliveryRef } from './generated-delivery-files.js'

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

interface ZipEntry {
  compressedSize: number
  compressionMethod: number
  crc32: number
  flags: number
  localHeaderOffset: number
  name: string
  uncompressedSize: number
}

interface LiveExportPackSnapshot {
  absoluteBasePath: string
  fileStats: Map<string, Stats>
  receipt: AssistantGeneratedExportPackRetirement
  rootStats: Stats
}

export interface SentAssistantGeneratedExportArchive {
  archivePath: string
  file: AssistantVaultFileResponseMedia
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

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP64_MARKER_16 = 0xffff
const ZIP64_MARKER_32 = 0xffffffff
const ZIP_MAX_EOCD_SEARCH_BYTES = 65_557
const ZIP_MAX_ENTRY_COUNT = 20_000
const ZIP_MAX_MANIFEST_BYTES = 1024 * 1024
const EXPORT_PACK_ID_PATTERN = /^[A-Za-z0-9_-]+$/u
const EXPORT_PACK_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const EXPORT_PACK_MANIFEST_PATTERN = /^exports\/packs\/([A-Za-z0-9_-]+)\/manifest\.json$/u

export async function buildAssistantGeneratedDeliveryRetirement(input: {
  archiveBytes: Uint8Array
  file: AssistantVaultFileResponseMedia
  vault: string
}): Promise<AssistantGeneratedDeliveryRetirement | null> {
  if (
    input.file.contentType !== 'application/zip'
    || !isAssistantGeneratedDeliveryRef(input.file.ref)
    || !input.file.ref.toLowerCase().endsWith('.zip')
    || input.file.sha256 !== sha256Hex(input.archiveBytes)
  ) {
    return null
  }

  let entries: Map<string, ZipEntry>
  const archive = Buffer.from(input.archiveBytes)
  try {
    entries = readZipEntries(archive)
  } catch {
    return null
  }

  const packs: AssistantGeneratedExportPackRetirement[] = []
  let extractedBytes = 0
  for (const [manifestPath, manifestEntry] of entries) {
    const match = EXPORT_PACK_MANIFEST_PATTERN.exec(manifestPath)
    if (!match) {
      continue
    }
    const packId = match[1]
    if (!packId || !EXPORT_PACK_ID_PATTERN.test(packId)) {
      continue
    }

    try {
      const manifestBytes = extractZipEntry(
        archive,
        manifestEntry,
        ZIP_MAX_MANIFEST_BYTES,
      )
      extractedBytes += manifestBytes.byteLength
      assertRetirementExtractionWithinLimit(extractedBytes)
      const manifest = exportPackManifestSchema.parse(
        JSON.parse(manifestBytes.toString('utf8')),
      )
      if (manifest.packId !== packId) {
        continue
      }

      const basePath = `exports/packs/${packId}`
      const declaredPaths = manifest.files.map((file) => file.path)
      if (!isExactDirectExportPackFileList(basePath, declaredPaths)) {
        continue
      }
      const archivedPackPaths = [...entries.keys()]
        .filter((entryPath) => entryPath.startsWith(`${basePath}/`) && !entryPath.endsWith('/'))
        .sort((left, right) => left.localeCompare(right))
      const sortedDeclaredPaths = [...declaredPaths]
        .sort((left, right) => left.localeCompare(right))
      if (!sameStrings(archivedPackPaths, sortedDeclaredPaths)) {
        continue
      }

      const archivedFiles: AssistantGeneratedExportPackRetirementFile[] = []
      for (const filePath of declaredPaths) {
        const entry = entries.get(filePath)
        if (!entry) {
          throw new Error('Export-pack ZIP entry is missing.')
        }
        const contents = filePath === manifestPath
          ? manifestBytes
          : extractZipEntry(
              archive,
              entry,
              assistantVaultFileMaxBytes - extractedBytes,
            )
        if (filePath !== manifestPath) {
          extractedBytes += contents.byteLength
          assertRetirementExtractionWithinLimit(extractedBytes)
        }
        archivedFiles.push({
          path: filePath,
          sha256: sha256Hex(contents),
          sizeBytes: contents.byteLength,
        })
      }

      const live = await readLiveExportPackSnapshot({
        basePath,
        expectedFiles: archivedFiles,
        packId,
        vault: input.vault,
      })
      if (live) {
        packs.push(live.receipt)
      }
    } catch {
      // ZIP delivery is user-critical; malformed or stale derived-pack
      // evidence disables retirement without blocking the attachment.
    }
  }

  if (packs.length === 0 || packs.length > 20) {
    return null
  }
  return {
    archiveRef: input.file.ref,
    archiveSha256: input.file.sha256,
    kind: 'sent_export_packs_v1',
    packs,
  }
}

export async function retireSentAssistantExportPacks(input: {
  archives: readonly SentAssistantGeneratedExportArchive[]
  vault: string
}): Promise<{ bytesPruned: number; packsPruned: number }> {
  let bytesPruned = 0
  let packsPruned = 0
  const visitedPackPaths = new Set<string>()

  for (const { archivePath, file } of input.archives) {
    const archiveBytes = await readMatchingGeneratedArchiveBytes(
      archivePath,
      file,
    )
    if (!archiveBytes) {
      continue
    }
    const retirement = await buildAssistantGeneratedDeliveryRetirement({
      archiveBytes,
      file,
      vault: input.vault,
    })
    if (!retirement) {
      continue
    }
    if (!(await archiveMatchesRetirement(archivePath, retirement))) {
      continue
    }
    for (const pack of retirement.packs) {
      if (visitedPackPaths.has(pack.basePath)) {
        continue
      }
      visitedPackPaths.add(pack.basePath)
      try {
        const snapshot = await readLiveExportPackSnapshot({
          basePath: pack.basePath,
          expectedFiles: pack.files,
          packId: pack.packId,
          vault: input.vault,
        })
        if (!snapshot || !(await liveExportPackSnapshotIsUnchanged(snapshot))) {
          continue
        }
        await rm(snapshot.absoluteBasePath, { recursive: true })
        bytesPruned += pack.files.reduce(
          (total, file) => total + file.sizeBytes,
          0,
        )
        packsPruned += 1
      } catch {
        // A changed, missing, or unsafe pack must survive cleanup. Generated
        // delivery cleanup may still reclaim the terminal archive itself.
      }
    }
  }

  return { bytesPruned, packsPruned }
}

export async function retireAssistantExportPacksForSentIntent(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<{ bytesPruned: number; packsPruned: number }> {
  if (input.intent.status !== 'sent') {
    return { bytesPruned: 0, packsPruned: 0 }
  }
  const matchingMedia = input.intent.media.filter(
    (media): media is AssistantVaultFileResponseMedia =>
      media.kind === 'vault_file'
      && media.contentType === 'application/zip'
      && isAssistantGeneratedDeliveryRef(media.ref)
      && media.ref.toLowerCase().endsWith('.zip'),
  )
  if (input.intent.media.length !== 1 || matchingMedia.length !== 1) {
    return { bytesPruned: 0, packsPruned: 0 }
  }
  const file = matchingMedia[0]
  if (!file) {
    return { bytesPruned: 0, packsPruned: 0 }
  }
  try {
    const archivePath = await resolveAssistantVaultPath(
      input.vault,
      file.ref,
      'file path',
    )
    return await retireSentAssistantExportPacks({
      archives: [{ archivePath, file }],
      vault: input.vault,
    })
  } catch {
    // Delivery success is authoritative even if best-effort derived cleanup
    // cannot prove that the archive and pack are still safe to remove.
    return { bytesPruned: 0, packsPruned: 0 }
  }
}

async function readMatchingGeneratedArchiveBytes(
  archivePath: string,
  file: AssistantVaultFileResponseMedia,
): Promise<Buffer | null> {
  try {
    const before = await lstat(archivePath)
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1
      || before.size !== file.sizeBytes
    ) {
      return null
    }
    const bytes = await readFile(archivePath)
    const after = await lstat(archivePath)
    return fileStatsMatch(before, after) && sha256Hex(bytes) === file.sha256
      ? bytes
      : null
  } catch {
    return null
  }
}

async function archiveMatchesRetirement(
  archivePath: string,
  retirement: AssistantGeneratedDeliveryRetirement,
): Promise<boolean> {
  try {
    const before = await lstat(archivePath)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      return false
    }
    const bytes = await readFile(archivePath)
    const after = await lstat(archivePath)
    return fileStatsMatch(before, after)
      && sha256Hex(bytes) === retirement.archiveSha256
  } catch {
    return false
  }
}

async function readLiveExportPackSnapshot(input: {
  basePath: string
  expectedFiles: readonly AssistantGeneratedExportPackRetirementFile[]
  packId: string
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
  const rootStats = await lstat(absoluteBasePath)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    return null
  }
  const directoryEntries = await readdir(absoluteBasePath, {
    withFileTypes: true,
  })
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
    const absoluteFilePath = await resolveAssistantVaultPath(
      input.vault,
      expected.path,
      'file path',
    )
    const before = await lstat(absoluteFilePath)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      return null
    }
    const contents = await readFile(absoluteFilePath)
    const after = await lstat(absoluteFilePath)
    if (
      !fileStatsMatch(before, after)
      || contents.byteLength !== expected.sizeBytes
      || sha256Hex(contents) !== expected.sha256
    ) {
      return null
    }
    fileStats.set(expected.path, after)
    files.push({
      path: expected.path,
      sha256: expected.sha256,
      sizeBytes: expected.sizeBytes,
    })
  }
  const finalRootStats = await lstat(absoluteBasePath)
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
  } catch {
    return false
  }
}

function readZipEntries(archive: Buffer): Map<string, ZipEntry> {
  const eocdOffset = findZipEndOfCentralDirectory(archive)
  if (eocdOffset < 0) {
    throw new Error('ZIP central directory is missing.')
  }
  assertZipRange(archive, eocdOffset, 22)
  const diskNumber = archive.readUInt16LE(eocdOffset + 4)
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6)
  const diskEntryCount = archive.readUInt16LE(eocdOffset + 8)
  const entryCount = archive.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)
  const commentLength = archive.readUInt16LE(eocdOffset + 20)
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || diskEntryCount !== entryCount
    || entryCount === ZIP64_MARKER_16
    || entryCount > ZIP_MAX_ENTRY_COUNT
    || centralDirectorySize === ZIP64_MARKER_32
    || centralDirectoryOffset === ZIP64_MARKER_32
    || eocdOffset + 22 + commentLength !== archive.byteLength
    || centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    throw new Error('ZIP central directory is unsupported.')
  }

  assertZipRange(
    archive,
    centralDirectoryOffset,
    centralDirectorySize,
  )
  const entries = new Map<string, ZipEntry>()
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    assertZipRange(archive, offset, 46)
    if (archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIP central directory entry is invalid.')
    }
    const flags = archive.readUInt16LE(offset + 8)
    const compressionMethod = archive.readUInt16LE(offset + 10)
    const entryCrc32 = archive.readUInt32LE(offset + 16)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const fileNameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const entryCommentLength = archive.readUInt16LE(offset + 32)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    if (
      compressedSize === ZIP64_MARKER_32
      || uncompressedSize === ZIP64_MARKER_32
      || localHeaderOffset === ZIP64_MARKER_32
      || (flags & 0x1) !== 0
    ) {
      throw new Error('ZIP entry is unsupported.')
    }
    const nameStart = offset + 46
    const nameEnd = nameStart + fileNameLength
    assertZipRange(
      archive,
      nameStart,
      fileNameLength + extraLength + entryCommentLength,
    )
    const name = archive.subarray(nameStart, nameEnd).toString('utf8')
    if (
      name.length === 0
      || name.includes('\uFFFD')
      || name.includes('\\')
      || name.includes('\u0000')
      || entries.has(name)
    ) {
      throw new Error('ZIP entry name is invalid.')
    }
    entries.set(name, {
      compressedSize,
      compressionMethod,
      crc32: entryCrc32,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
    })
    offset = nameEnd + extraLength + entryCommentLength
  }
  if (offset !== eocdOffset) {
    throw new Error('ZIP central directory size is invalid.')
  }
  return entries
}

function extractZipEntry(
  archive: Buffer,
  entry: ZipEntry,
  maxOutputLength: number,
): Buffer {
  if (
    maxOutputLength < 0
    || entry.uncompressedSize > maxOutputLength
    || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
  ) {
    throw new Error('ZIP entry exceeds the retirement inspection limit.')
  }
  assertZipRange(archive, entry.localHeaderOffset, 30)
  if (archive.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error('ZIP local header is invalid.')
  }
  const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6)
  const localCompressionMethod = archive.readUInt16LE(entry.localHeaderOffset + 8)
  const fileNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26)
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28)
  const nameStart = entry.localHeaderOffset + 30
  const contentOffset = nameStart + fileNameLength + extraLength
  assertZipRange(archive, nameStart, fileNameLength + extraLength)
  assertZipRange(archive, contentOffset, entry.compressedSize)
  if (
    localFlags !== entry.flags
    || localCompressionMethod !== entry.compressionMethod
    || archive.subarray(nameStart, nameStart + fileNameLength).toString('utf8') !== entry.name
  ) {
    throw new Error('ZIP local and central entry metadata disagree.')
  }
  const compressed = archive.subarray(
    contentOffset,
    contentOffset + entry.compressedSize,
  )
  const contents = entry.compressionMethod === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, { maxOutputLength })
  if (
    contents.byteLength !== entry.uncompressedSize
    || (crc32(contents) >>> 0) !== entry.crc32
  ) {
    throw new Error('ZIP entry integrity check failed.')
  }
  return contents
}

function findZipEndOfCentralDirectory(archive: Buffer): number {
  const firstOffset = Math.max(
    0,
    archive.byteLength - ZIP_MAX_EOCD_SEARCH_BYTES,
  )
  for (let offset = archive.byteLength - 22; offset >= firstOffset; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE
      && offset + 22 + archive.readUInt16LE(offset + 20) === archive.byteLength
    ) {
      return offset
    }
  }
  return -1
}

function assertZipRange(
  archive: Buffer,
  offset: number,
  length: number,
): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > archive.byteLength
  ) {
    throw new Error('ZIP entry range is invalid.')
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

function assertRetirementExtractionWithinLimit(extractedBytes: number): void {
  if (extractedBytes > assistantVaultFileMaxBytes) {
    throw new Error('Generated ZIP export packs exceed the inspection limit.')
  }
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

function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
