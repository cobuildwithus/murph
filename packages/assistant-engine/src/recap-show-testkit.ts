import { inspectMp3Frames, inspectGeneratedMp3Audio } from '@murphai/operator-config/generated-audio'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import * as z from '@murphai/contracts/zod-runtime'
import type { RecapMaterial, RecapTranscriptMessage } from '@murphai/contracts/recap-material'

import { recapShowWriterSchema, type GameRecapStory, type RecapAsset } from '@murphai/contracts/recap-show'
import type { HostedGameToolResponse, HostedRuntimeGroupToolRequest } from '@murphai/hosted-execution/runtime-control'

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Synthetic transport for the normal-profile Linux sandbox test. Live proof supplies real media transport. */
export async function createRecapShowLiveProviders(input: {
  game: unknown; players: { name: string; memberId: string }[];
  entries: RecapMaterial['entries']; result: RecapMaterial['result'];
  chat: { playerName: string; text: string; at?: string; source?: RecapTranscriptMessage['source'] }[];
  mediaFetch?: typeof fetch; startedAt?: string;
}) {
  const photos = new Map<string, Buffer>()
  const references: RecapMaterial['references'] = []
  for (const [index, player] of input.players.entries()) {
    const id = hash(`synthetic-profile:${player.memberId}`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="${index ? '#c8d7c2' : '#dfc7a9'}"/><circle cx="240" cy="200" r="90" fill="#6b6560"/><path d="M110 560V400Q240 280 370 400V560" fill="#766e91"/></svg>`
    photos.set(id, await sharp(Buffer.from(svg)).jpeg().toBuffer())
    references.push({ id, kind: 'profile', memberId: player.memberId })
  }
  for (const entry of input.entries.filter(entry => entry.kind === 'photo')) {
    const player = input.players.find(player => player.name === entry.playerName)!
    const id = hash(`synthetic-entry:${entry.entryId}`)
    photos.set(id, photos.get(hash(`synthetic-profile:${player.memberId}`))!)
    references.push({ id, kind: 'entry', memberId: player.memberId, entryId: entry.entryId })
  }
  // Production lists Murph's character sheet last, with no local photo path.
  const murph = hash('synthetic-murph')
  photos.set(murph, await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#f5f0e8"/><rect x="170" y="220" width="140" height="200" rx="30" fill="#2d3436"/><circle cx="240" cy="170" r="60" fill="#7a8c6e"/></svg>')).jpeg().toBuffer())
  references.push({ id: murph, kind: 'murph' })
  const startedAt = input.startedAt ?? new Date(Date.now() - 8 * 86_400_000).toISOString()
  const settledAt = new Date().toISOString()
  const material: RecapMaterial = { game: input.game, players: input.players.map(player => player.name), entries: input.entries,
    result: input.result, references, startedAt, settledAt }
  const chat: RecapTranscriptMessage[] = input.chat.map((message, index) => ({ ...message, id: `synthetic-message-${index}`,
    at: message.at ?? new Date(Date.now() - 86_400_000 + index * 1000).toISOString(), source: message.source ?? 'player', laneSeq: String(index + 1) }))
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#2d3436"/><path d="M0 0H768V250Q384 80 0 250Z" fill="#9e5743"/><rect x="100" y="780" width="568" height="80" fill="#d4c4a8"/><circle cx="260" cy="490" r="70" fill="#d4c4a8"/><circle cx="510" cy="490" r="70" fill="#7a8c6e"/><path d="M180 780V600H340V780M430 780V600H590V780" fill="#d4c4a8"/></svg>')).jpeg().toBuffer()
  const song = await readFile(new URL('../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url))
  let generatedSong: Uint8Array = song
  // Sung lyrics come back as timed words plus audio; a plain song is audio alone.
  const songResponse = async (request: Request): Promise<Response> => {
    if (!request.headers.get('accept')?.includes('multipart/mixed')) return new Response(song, { headers: { 'content-type': 'audio/mpeg' } })
    const plan = z.object({ composition_plan: z.object({ chunks: z.array(z.object({ text: z.string(), duration_ms: z.number() })).min(1) }) }).parse(await request.clone().json())
    const chunks = plan.composition_plan.chunks
    const durationMs = chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0)
    const sungStart = durationMs - chunks[chunks.length - 1]!.duration_ms
    const words = chunks[chunks.length - 1]!.text.replace(/\[[^\]]*\]/gu, '').split(/\s+/u).filter(Boolean)
    const audio = syntheticRecapAudio(song, durationMs)
    generatedSong = audio
    const step = 19_000 / words.length
    const timed = words.map((word, index) => ({ word, start_ms: Math.round(sungStart + 500 + index * step), end_ms: Math.round(sungStart + 500 + (index + 0.8) * step) }))
    return new Response(Buffer.concat([
      Buffer.from(`--synthetic\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ words_timestamps: timed })}\r\n--synthetic\r\nContent-Type: audio/mpeg\r\n\r\n`),
      audio, Buffer.from('\r\n--synthetic--\r\n'),
    ]), { headers: { 'content-type': 'multipart/mixed; boundary=synthetic' } })
  }
  const assets: RecapAsset[] = []
  const saved: GameRecapStory[] = []
  const providerCalls: { kind: 'image' | 'song'; references: number }[] = []
  const files: { slot: string; path: string }[] = []
  const control = async (request: HostedRuntimeGroupToolRequest): Promise<HostedGameToolResponse> => {
    if (request.action === 'write_recap') {
      const story = saved[0] ?? recapShowWriterSchema.parse(request.recap)
      if (!saved.length) saved.push(story)
      return { action: 'write_recap', result: { status: 'ok', recap: story, recapOutcome: 'Saved.', chatLine: `${story.chatLine}\nWatch the recap: https://recaps.murph.test/recap/synthetic-game` } }
    }
    if (request.action !== 'read_game') throw new Error('Expected a synthetic recap action.')
    const command = request.recapRead
    let recapGame: unknown
    if (!command) recapGame = { ...(typeof input.game === 'object' ? input.game : {}), material }
    else if (command.kind === 'recover') recapGame = { recovered: false }
    else if (command.kind === 'transcript') recapGame = { messages: chat, next: null, through: String(chat.length), since: startedAt, until: settledAt, retainedSince: startedAt, incomplete: false }
    else if (command.kind === 'reference') {
      const bytes = photos.get(command.id)
      if (!bytes) throw new Error('Unknown synthetic photo.')
      const meta = await sharp(bytes).metadata()
      recapGame = { id: command.id, bytes: bytes.toString('base64'), hash: hash(bytes), mediaType: 'image/jpeg', byteLength: bytes.length, width: meta.width, height: meta.height }
    } else if (command.kind === 'upload') {
      // This synthetic Web predates the recap video, as an older deployed Web would.
      if (command.mediaType === 'video/mp4') throw new Error('The synthetic Web stores no recap video.')
      const bytes = Buffer.from(command.bytes, 'base64')
      const asset: RecapAsset = { slot: command.slot, kind: command.mediaType === 'image/jpeg' ? 'image' : 'song', recipeId: hash(bytes), hash: hash(bytes), storageKey: `recap/synthetic/${hash(bytes)}`, mediaType: command.mediaType, byteLength: bytes.length, references: [] }
      if (asset.kind === 'image') { const meta = await sharp(bytes).metadata(); asset.width = meta.width; asset.height = meta.height }
      else {
        asset.durationMs = (await inspectGeneratedMp3Audio(bytes)).durationMs
        if (command.songStartMs !== undefined) asset.songStartMs = command.songStartMs
        if (command.wordsTimestamps) asset.wordsTimestamps = command.wordsTimestamps
      }
      assets.push(asset)
      recapGame = asset
    } else throw new Error('Unexpected synthetic control.')
    return { action: 'read_game', result: { status: 'ok', recapGame } }
  }
  const providerFetch: typeof fetch = async (url, init) => {
    const request = new Request(url, init)
    const kind = new URL(request.url).hostname === 'api.elevenlabs.io' ? 'song' : 'image'
    let references = 0
    if (request.headers.get('content-type')?.includes('multipart/form-data')) references = (await request.clone().formData()).getAll('image[]').length
    providerCalls.push({ kind, references })
    const response = input.mediaFetch ? await input.mediaFetch(url, init) : kind === 'song' ? await songResponse(request)
      : Response.json({ data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } })
    if (response.ok) {
      const bytes = kind === 'song' ? generatedSong : Buffer.from(z.object({ data: z.array(z.object({ b64_json: z.string() })).min(1) }).parse(await response.clone().json()).data[0]!.b64_json, 'base64')
      files.push({ slot: kind === 'song' ? 'song' : 'scene-0', path: `media/${hash(bytes)}.${kind === 'song' ? 'mp3' : 'jpg'}` })
    }
    return response
  }
  return { material, control, providerFetch, providerCalls, files, saved, assets }
}

export { materializeRecapWorkspace } from './assistant/recap-workspace.js'
export { executeGenerateSongTool } from './assistant-codex/generate-voice-memo-tool.js'

/** Build requested-length synthetic audio from fixture frames, omitting its Info frame. */
export function syntheticRecapAudio(fixture: Uint8Array, durationMs: number): Buffer {
  const stream = inspectMp3Frames(fixture)
  const frames = stream.frames.slice(1).map((frame, index) => fixture.subarray(frame.byteOffset, stream.frames[index + 2]?.byteOffset ?? stream.endOffset))
  const count = Math.round(durationMs / stream.frames[1]!.timeMs)
  return Buffer.concat(Array.from({ length: count }, (_, index) => frames[index % frames.length]!))
}
