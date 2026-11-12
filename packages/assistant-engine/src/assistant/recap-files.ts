import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import { gameRecapDraftSchema, songWordTimestampsSchema } from '@murphai/contracts/recap-show'
import { resolveAssistantStatePaths, writeAssistantStateJson } from '@murphai/runtime-state/node/assistant-state-fs'
import { isMissingFileError } from './shared.js'

const recapMediaSourceSchema = z.object({
  referenceIds: z.array(z.string().min(1).max(256)).max(128),
  mediaType: z.enum(['image/jpeg', 'audio/mpeg']),
  wordsTimestamps: songWordTimestampsSchema.optional(),
}).strict()
type RecapMediaSource = z.infer<typeof recapMediaSourceSchema>
type RecapMediaSourceKey = { vault: string; eventId: string; bytes: Uint8Array }
const recapMediaReceiptSchema = z.object({
  schema: z.literal('murph.recap-media-source.v1'),
  source: recapMediaSourceSchema,
}).strict()

// Host-owned state survives checkpoints and is outside the writer's editable
// workspace. A file's bytes and generation must both match its trusted receipt.
export async function saveRecapMediaSource(input: RecapMediaSourceKey & { source: RecapMediaSource }): Promise<void> {
  await writeAssistantStateJson(recapMediaSourcePath(input), recapMediaReceiptSchema.parse({
    schema: 'murph.recap-media-source.v1', source: input.source,
  }))
}

export async function readRecapMediaSource(input: RecapMediaSourceKey): Promise<RecapMediaSource | null> {
  try {
    const value = recapMediaReceiptSchema.safeParse(JSON.parse(await readFile(recapMediaSourcePath(input), 'utf8')))
    return value.success ? value.data.source : null
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return null
    throw error
  }
}

function recapMediaSourcePath(input: RecapMediaSourceKey): string {
  const generation = createHash('sha256').update(input.eventId).digest('hex')
  const media = createHash('sha256').update(input.bytes).digest('hex')
  return path.join(resolveAssistantStatePaths(input.vault).stateDirectory, 'recap-media', generation, `${media}.json`)
}

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

export async function saveRecapMediaFile(input: { vault: string; relativeRoot: string; bytes: Uint8Array; mediaType: 'image/jpeg' | 'audio/mpeg' }): Promise<string> {
  if (!input.bytes.length || input.bytes.length > 2 * 1024 * 1024) throw new TypeError('Media file exceeds 2 MiB.')
  const hash = createHash('sha256').update(input.bytes).digest('hex')
  const directory = await recapDirectory(input.vault, `${input.relativeRoot}/media`)
  const filename = `${hash}.${input.mediaType === 'image/jpeg' ? 'jpg' : 'mp3'}`
  const handle = await open(path.join(directory, filename), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(input.bytes) } finally { await handle.close() }
  return `${input.relativeRoot}/media/${filename}`
}

export async function readRecapDraftFile(input: { vault: string; relativeRoot: string; draftPath: string }) {
  const bytes = await readRecapFile({ ...input, file: input.draftPath, maxBytes: 128 * 1024 })
  return gameRecapDraftSchema.parse(JSON.parse(bytes.toString('utf8')))
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
