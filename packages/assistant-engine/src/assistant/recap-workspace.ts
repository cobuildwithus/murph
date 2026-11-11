import { RECAP_SHOW_CRAFT } from '@murphai/hosted-execution/runtime-control'
import { constants } from 'node:fs'
import { recapDirectory } from './recap-files.js'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, open } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import * as z from '@murphai/contracts/zod-runtime'
import { assistantTranscriptEntrySchema } from '@murphai/operator-config/assistant-cli-contracts'
import { recapMaterialSchema, recapTranscriptPageSchema, type RecapMaterial, type RecapTranscriptMessage } from '@murphai/contracts/recap-material'
import type { AssistantHostedGroupTool } from './execution-context.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { resolveAssistantTranscriptPath } from './store/persistence.js'

export function recapTaskDirectory(vault: string, eventId: string): string {
  return path.join(vault, '.runtime/tmp/recap', createHash('sha256').update(eventId).digest('hex').slice(0, 32))
}

/** The trusted context owns material in memory; editable JSON cannot authorize a write. */
export async function materializeRecapWorkspace(input: {
  vault: string; eventId: string; gameId: string; sessionId: string;
  material: unknown; lore: string; tool: AssistantHostedGroupTool;
}): Promise<{ root: string; material: RecapMaterial; chat: RecapTranscriptMessage[]; manifest: unknown }> {
  const material = recapMaterialSchema.parse(input.material)
  const root = recapTaskDirectory(input.vault, input.eventId)
  const relativeRoot = path.relative(input.vault, root)
  for (const name of ['inputs', 'media', 'previews', 'drafts']) await recapDirectory(input.vault, `${relativeRoot}/${name}`)
  const chat: RecapTranscriptMessage[] = []
  let after: string | undefined
  let through: string | undefined
  let incomplete = false
  let retainedSince = material.startedAt
  for (let page = 0; page < 500; page += 1) {
    const response = await input.tool.request({ action: 'read_game', origin: { kind: 'game_recap', gameId: input.gameId, eventId: input.eventId },
      recapRead: { kind: 'transcript', ...(after === undefined ? {} : { after }) } })
    if (response.result.status !== 'ok' || !('recapGame' in response.result)) throw new Error('Recap transcript is unavailable.')
    const result = recapTranscriptPageSchema.parse(response.result.recapGame)
    if (through !== undefined && through !== result.through) throw new Error('Recap transcript watermark changed.')
    through = result.through
    retainedSince = result.retainedSince
    incomplete ||= result.incomplete
    chat.push(...result.messages)
    if (result.next === null) break
    if (result.next === after) throw new Error('Recap transcript cursor did not advance.')
    after = result.next
    if (page === 499) incomplete = true
  }
  const replies = await readCommittedRecapReplies(input.vault, input.sessionId, material.startedAt, material.settledAt)
  chat.push(...replies.messages)
  chat.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.laneSeq && b.laneSeq ? Number(BigInt(a.laneSeq) - BigInt(b.laneSeq)) : a.id.localeCompare(b.id)))
  const initialReferences = material.references.filter(reference => reference.kind === 'profile' || reference.kind === 'murph')
  for (const player of material.result) {
    if (!initialReferences.some(reference => reference.memberId === player.memberId)) {
      const fallback = material.references.find(reference => reference.kind === 'entry' && reference.memberId === player.memberId)
      if (fallback) initialReferences.push(fallback)
    }
  }
  const referenceFiles = []
  for (const reference of initialReferences) referenceFiles.push(await materializeRecapReference({ ...input, root, material, id: reference.id }))
  const manifest = { version: 1, directory: relativeRoot,
    instructions: `${relativeRoot}/inputs/writing-guide.md`, game: `${relativeRoot}/inputs/game.json`, chat: `${relativeRoot}/inputs/chat.jsonl`, lore: `${relativeRoot}/inputs/lore.txt`,
    references: material.references, referenceFiles, coverage: { since: material.startedAt, until: material.settledAt, retainedSince,
      throughConversationLaneSeq: through, incomplete: incomplete || replies.incomplete,
      gaps: [...(incomplete ? ['Some player history is unavailable or exceeds the export bound.'] : []),
        ...(replies.incomplete ? ['Earlier committed Murph replies may have been trimmed.'] : [])] } }
  await Promise.all([
    writeInput(path.join(root, 'inputs/writing-guide.md'), RECAP_SHOW_CRAFT),
    writeInput(path.join(root, 'inputs/material.json'), JSON.stringify(material) + '\n'),
    writeInput(path.join(root, 'inputs/game.json'), JSON.stringify(material.game, null, 2) + '\n'),
    writeInput(path.join(root, 'inputs/chat.jsonl'), chat.map(message => JSON.stringify(message)).join('\n') + '\n'),
    writeInput(path.join(root, 'inputs/lore.txt'), input.lore),
    writeInput(path.join(root, 'inputs/manifest.json'), JSON.stringify(manifest, null, 2) + '\n'),
  ])
  return { root, material, chat, manifest }
}

const referenceBytesSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u), bytes: z.string().max(3 * 1024 * 1024),
  hash: z.string().regex(/^[a-f0-9]{64}$/u), mediaType: z.literal('image/jpeg'),
  byteLength: z.number().int().positive().max(2 * 1024 * 1024),
  width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024),
}).strict()

export async function fetchRecapReference(input: {
  eventId: string; gameId: string; material: RecapMaterial; id: string; tool: AssistantHostedGroupTool;
}) {
  if (!input.material.references.some(reference => reference.id === input.id)) throw new Error('Use an authorized recap reference ID.')
  const response = await input.tool.request({ action: 'read_game', origin: { kind: 'game_recap', eventId: input.eventId, gameId: input.gameId }, recapRead: { kind: 'reference', id: input.id } })
  if (response.result.status !== 'ok' || !('recapGame' in response.result)) throw new Error('Recap reference is no longer available.')
  const value = referenceBytesSchema.parse(response.result.recapGame)
  const bytes = Buffer.from(value.bytes, 'base64')
  if (value.id !== input.id || bytes.length !== value.byteLength || createHash('sha256').update(bytes).digest('hex') !== value.hash) throw new Error('Recap reference integrity failed.')
  return { ...value, bytes }
}

export async function materializeRecapReference(input: Parameters<typeof fetchRecapReference>[0] & { root: string; vault: string }) {
  const reference = await fetchRecapReference(input)
  const file = path.join(input.root, 'inputs', `${reference.id}.jpg`)
  await writeInput(file, reference.bytes)
  return { id: reference.id, path: path.relative(input.vault, file), hash: reference.hash }
}

/** Committed room transcript only. Never read another room or a player's personal vault. */
export async function readCommittedRecapReplies(vault: string, sessionId: string, since: string, until: string) {
  const file = resolveAssistantTranscriptPath(resolveAssistantStatePaths(vault), sessionId)
  const messages: RecapTranscriptMessage[] = []
  let first: string | undefined
  let lineNumber = 0
  try {
    // Check existence before opening the streaming reader so ENOENT remains a coverage gap.
    await access(file)
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        lineNumber += 1
        if (!line.trim()) continue
        const entry = assistantTranscriptEntrySchema.parse(JSON.parse(line))
        first ??= entry.createdAt
        if (entry.kind !== 'assistant' || entry.textRetiredAt || !entry.text || Date.parse(entry.createdAt) < Date.parse(since) || Date.parse(entry.createdAt) > Date.parse(until)) continue
        messages.push({ id: `reply-${lineNumber}`, source: 'assistant', playerName: 'Murph', text: entry.text, at: entry.createdAt })
      }
    } finally { lines.close() }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  return { messages, incomplete: first === undefined || Date.parse(first) > Date.parse(since) }
}

async function writeInput(file: string, data: string | Uint8Array) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(data) } finally { await handle.close() }
}
