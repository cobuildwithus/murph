import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { recapFileReceiptSchema, type RecapFileReceipt } from '@murphai/contracts/recap-show'
import { inspectGeneratedMp3Audio } from '@murphai/operator-config/generated-audio'

/** Refuse symlinks, including intermediate components, before trusted file IO. */
export async function recapDirectory(vault: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('Invalid recap directory.')
  let current = await realpath(vault)
  for (const part of relative.split('/')) {
    current = path.join(current, part)
    await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error })
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Recap directories must not be symlinks.')
  }
  return current
}

export async function saveRecapMediaFile(input: {
  vault: string; relativeRoot: string; operationId: string; bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'audio/mpeg';
}): Promise<RecapFileReceipt> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(input.operationId)) throw new TypeError('Invalid media operation.')
  const bytes = input.bytes
  if (!bytes.length || bytes.length > (input.mediaType === 'image/jpeg' ? 2 : 1) * 1024 * 1024) throw new TypeError('Recap media exceeds its byte limit.')
  let dimensions: { width: number; height: number } | { durationMs: number }
  if (input.mediaType === 'image/jpeg') {
    const image = sharp(bytes, { limitInputPixels: 4_000_000, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height || metadata.width > 2048 || metadata.height > 2048) throw new TypeError('Invalid recap JPEG.')
    await image.raw().toBuffer() // Decode all pixels before issuing a receipt.
    dimensions = { width: metadata.width, height: metadata.height }
  } else {
    dimensions = await inspectGeneratedMp3Audio(bytes)
    if (Math.abs(dimensions.durationMs - 20_000) > 500) throw new TypeError('Recap songs must be twenty seconds.')
  }
  const hash = createHash('sha256').update(bytes).digest('hex')
  const directory = await recapDirectory(input.vault, `${input.relativeRoot}/media`)
  const filename = `${input.operationId}-${hash}.${input.mediaType === 'image/jpeg' ? 'jpg' : 'mp3'}`
  const file = path.join(directory, filename)
  try {
    const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(bytes) } finally { await handle.close() }
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error
    const prior = await readRecapFile({ vault: input.vault, relativeRoot: input.relativeRoot, file: `${input.relativeRoot}/media/${filename}`, maxBytes: bytes.length })
    if (createHash('sha256').update(prior).digest('hex') !== hash) throw new TypeError('Existing recap file failed integrity verification.')
  }
  return recapFileReceiptSchema.parse({ operationId: input.operationId, path: `${input.relativeRoot}/media/${filename}`, hash,
    mediaType: input.mediaType, byteLength: bytes.length, ...dimensions })
}

export async function readRecapFile(input: { vault: string; relativeRoot: string; file: string; maxBytes: number }): Promise<Buffer> {
  const prefix = `${input.relativeRoot}/`
  if (!input.file.startsWith(prefix) || path.isAbsolute(input.file) || input.file.split('/').some(part => !part || part === '..' || part === '.')) throw new TypeError('File is outside the recap workspace.')
  const parent = await recapDirectory(input.vault, path.dirname(input.file))
  const handle = await open(path.join(parent, path.basename(input.file)), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > input.maxBytes) throw new TypeError('Recap file exceeds its byte limit.')
    // Read a bounded buffer even if the file grows while open.
    const bytes = Buffer.alloc(input.maxBytes + 1)
    let count = 0
    while (count < bytes.length) {
      const { bytesRead } = await handle.read(bytes, count, bytes.length - count, null)
      if (!bytesRead) break
      count += bytesRead
    }
    if (count > input.maxBytes) throw new TypeError('Recap file exceeds its byte limit.')
    return bytes.subarray(0, count)
  } finally { await handle.close() }
}
