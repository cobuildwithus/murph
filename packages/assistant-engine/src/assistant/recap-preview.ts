import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { gameRecapDraftSchema, presentGameRecap, type GameRecapDraft, type GameRecapEnvelope } from '@murphai/contracts/recap-show'
import { validateGameRecapDetailed, RecapRejectionError, recapSchemaRejections, type RecapRejection } from '@murphai/contracts/recap-validation'
import type { RecapMaterial, RecapTranscriptMessage } from '@murphai/contracts/recap-material'
import { renderRecapPageSvg } from '@murphai/contracts/recap-renderer'
import { readRecapUsages } from './game-recap-lore.js'
import { readRecapFile, recapDirectory } from './recap-files.js'

/** Safe draft feedback contains schema paths and constraints, never file contents. */
export class RecapDraftValidationError extends RecapRejectionError {}

export async function readRecapDraftFile(input: { vault: string; relativeRoot: string; draftPath: string }): Promise<GameRecapDraft> {
  const bytes = await readRecapFile({ ...input, file: input.draftPath, maxBytes: 128 * 1024 }).catch(() => { throw new RecapDraftValidationError([{ rule: 'draft_file', message: 'Read a JSON draft under this task’s drafts directory, at most 128 KiB; use the path returned by read_game.' }]) })
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) }
  catch { throw new RecapDraftValidationError([{ rule: 'draft_json', message: 'Draft must contain valid JSON. Fix JSON syntax before retrying.' }]) }
  const parsed = gameRecapDraftSchema.safeParse(value)
  if (!parsed.success) throw new RecapDraftValidationError(recapSchemaRejections(parsed.error.issues))
  return parsed.data
}

export async function previewRecap(input: {
  vault: string; relativeRoot: string; draftPath: string; material: RecapMaterial;
  chat: readonly RecapTranscriptMessage[]; lore: string;
  validateDraft?: (draft: GameRecapDraft) => Promise<RecapRejection[]>;
  photo: (entryId: string) => Promise<Uint8Array | null>;
}) {
  const draft = await readRecapDraftFile(input)
  const usages = readRecapUsages(input.lore)
  const rejections = input.validateDraft ? await input.validateDraft(draft) : validateGameRecapDetailed({ recap: draft.story, players: input.material.players, entries: input.material.entries,
    result: input.material.result, chatMessages: input.chat.filter(message => message.source === 'player'),
    priorChatLines: usages.map(usage => usage.chatLine), usedTreatments: usages.map(usage => usage.treatment), show: true, group: false })
  const media = new Map<string, string>()
  const assets: GameRecapEnvelope['assets'] = []
  for (const { slot, receipt } of draft.files) {
    const bytes = await readRecapFile({ ...input, file: receipt.path, maxBytes: 2 * 1024 * 1024 })
    if (createHash('sha256').update(bytes).digest('hex') !== receipt.hash || bytes.length !== receipt.byteLength) throw new RecapRejectionError([{ rule: 'media_integrity', message: 'Selected bytes no longer match the receipt. Restore the original generated file; do not edit receipts.' }])
    if (receipt.mediaType === 'image/jpeg') media.set(slot, `data:image/jpeg;base64,${bytes.toString('base64')}`)
    assets.push({ slot, kind: receipt.mediaType === 'image/jpeg' ? 'image' : 'song', recipeId: receipt.operationId,
      storageKey: slot, references: [], hash: receipt.hash, byteLength: receipt.byteLength,
      mediaType: receipt.mediaType, width: receipt.width, height: receipt.height, durationMs: receipt.durationMs })
  }
  const photos = new Map<string, string>()
  const entryIds = [...new Set(draft.story.pages.flatMap(page => page.blocks.flatMap(block => block.entryIds ?? [])))]
  for (const id of entryIds) {
    if (!input.material.entries.some(entry => entry.entryId === id && entry.kind === 'photo' && entry.visibleToBoth)) continue
    const bytes = await input.photo(id)
    if (bytes) photos.set(id, `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`)
  }
  const draftHash = createHash('sha256').update(JSON.stringify(draft)).digest('hex')
  const instant = new Date().toISOString()
  const presentation = presentGameRecap({ stored: { version: 1, generationId: draftHash, story: draft.story, assets,
    acceptedAt: instant, preview: { token: 'local-preview-only'.repeat(3), expiresAt: instant } },
    permittedPhotoIds: new Set(photos.keys()), mediaUrl: slot => `${input.relativeRoot}/media/${slot}` })
  const directory = await recapDirectory(input.vault, `${input.relativeRoot}/previews/${draftHash.slice(0, 16)}`)
  const warnings: string[] = []
  const pages: string[] = []
  const thumbs: Buffer[] = []
  for (const [index, page] of (presentation.show?.pages ?? []).entries()) {
    const image = page.kind === 'cover' || page.kind === 'scene' ? media.get(`scene-${index}`) : undefined
    const rendered = renderRecapPageSvg({ page, treatment: draft.story.treatment ?? '', generatedImage: image, photos, result: input.material.result })
    warnings.push(...rendered.warnings)
    const png = await sharp(Buffer.from(rendered.svg)).png().toBuffer()
    const filename = `page-${String(index + 1).padStart(2, '0')}.png`
    await writePreview(path.join(directory, filename), png)
    pages.push(`${input.relativeRoot}/previews/${draftHash.slice(0, 16)}/${filename}`)
    thumbs.push(await sharp(png).resize(256, 427).png().toBuffer())
  }
  const rows = Math.ceil(thumbs.length / 3)
  const sheet = await sharp({ create: { width: 768, height: Math.max(1, rows) * 427, channels: 3, background: '#eee9df' } })
    .composite(thumbs.map((input, index) => ({ input, left: (index % 3) * 256, top: Math.floor(index / 3) * 427 }))).png().toBuffer()
  await writePreview(path.join(directory, 'contact-sheet.png'), sheet)
  await writePreview(path.join(directory, 'presentation.json'), Buffer.from(JSON.stringify(presentation, null, 2)))
  return { valid: rejections.length === 0, rejections, errors: rejections.map(issue => `[${issue.rule}] ${issue.message}`), warnings, draftHash, pages,
    contactSheet: `${input.relativeRoot}/previews/${draftHash.slice(0, 16)}/contact-sheet.png`,
    selectedMedia: draft.files.map(({ slot, receipt }) => ({ slot, hash: receipt.hash, path: receipt.path })) }
}

async function writePreview(file: string, bytes: Uint8Array) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(bytes) } finally { await handle.close() }
}
